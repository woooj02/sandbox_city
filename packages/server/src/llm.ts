/**
 * A small client for the common chat-completions API that most model providers serve
 * (OpenAI-style `POST {base}/chat/completions` with a bearer key).
 *
 * Defaults to Google's Gemini endpoint; point LLM_BASE_URL and LLM_MODEL elsewhere to use another provider.
 *   LLM_API_KEY (or GEMINI_API_KEY)  required
 *   LLM_BASE_URL                     default https://generativelanguage.googleapis.com/v1beta/openai
 *   LLM_MODEL                        default gemma-4-26b-a4b-it (an open-weight model with no paid tier)
 *   LLM_MIN_GAP_MS                   default 8000 (keeps free tiers under their per-minute limit)
 * Paid providers (TOGETHER_API_KEY selects Together's endpoint) run under a hard spending cap:
 *   LLM_PRICE_IN / LLM_PRICE_OUT     USD per million tokens (read from the provider's model list when it publishes one)
 *   LLM_BUDGET_USD                   default 0.25: no request is sent that could take the total past it
 *   LLM_SPEND_FILE                   optional file that carries the total across runs
 *   LLM_THINKING=off                 asks a thinking model to answer directly (Together's `reasoning: {enabled: false}`);
 *                                    otherwise its hidden reasoning can use up the reply length and cut a tool call short
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface Spend { usd: number; tokensIn: number; tokensOut: number; calls: number }
export interface LlmConfig {
  baseUrl: string; apiKey: string; model: string; minGapMs: number;
  /** Set for paid models: prices per million tokens and the most this process may spend. */
  price?: { in: number; out: number }; budgetUsd?: number; spendFile?: string;
  spend?: Spend;
  /** false: ask the model not to think before answering. */
  thinking?: boolean;
}

export class BudgetExceeded extends Error {}

const TOGETHER = 'https://api.together.xyz/v1';

export function llmFromEnv(env = process.env): LlmConfig | null {
  const together = !env.LLM_API_KEY && !!env.TOGETHER_API_KEY;
  const apiKey = env.LLM_API_KEY || env.TOGETHER_API_KEY || env.GEMINI_API_KEY || '';
  if (!apiKey) return null;
  const spendFile = env.LLM_SPEND_FILE || undefined;
  const spend: Spend = spendFile && existsSync(spendFile) ? JSON.parse(readFileSync(spendFile, 'utf8')) : { usd: 0, tokensIn: 0, tokensOut: 0, calls: 0 };
  const priced = env.LLM_PRICE_IN != null && env.LLM_PRICE_OUT != null;
  const thinking = env.LLM_THINKING === 'off' ? false : undefined;
  if (together) return {
    apiKey, baseUrl: TOGETHER, thinking,
    model: env.LLM_MODEL || 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    minGapMs: Number(env.LLM_MIN_GAP_MS ?? 500),
    price: priced ? { in: Number(env.LLM_PRICE_IN), out: Number(env.LLM_PRICE_OUT) } : undefined,
    budgetUsd: Number(env.LLM_BUDGET_USD ?? 0.25), spendFile, spend,
  };
  return {
    apiKey, thinking,
    price: priced ? { in: Number(env.LLM_PRICE_IN), out: Number(env.LLM_PRICE_OUT) } : undefined,
    budgetUsd: priced || env.LLM_BUDGET_USD ? Number(env.LLM_BUDGET_USD ?? 0.25) : undefined,
    spendFile, spend,
    baseUrl: (env.LLM_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/+$/, ''),
    model: env.LLM_MODEL || 'gemma-4-26b-a4b-it',
    minGapMs: Number(env.LLM_MIN_GAP_MS ?? 8000),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fills in the model's price from the provider's model list, for providers that publish it (Together does). */
export async function llmPricing(cfg: LlmConfig, fetchImpl: typeof fetch = fetch): Promise<LlmConfig['price']> {
  if (cfg.price) return cfg.price;
  const res = await fetchImpl(`${cfg.baseUrl}/models`, { headers: { authorization: `Bearer ${cfg.apiKey}` } });
  if (!res.ok) return undefined;
  type M = { id: string; pricing?: { input?: number; output?: number } };
  const list = await res.json() as M[] | { data?: M[] };
  const m = (Array.isArray(list) ? list : list.data ?? []).find((x) => x.id === cfg.model);
  if (m?.pricing?.input == null || m.pricing.output == null) return undefined;
  cfg.price = { in: m.pricing.input, out: m.pricing.output };
  return cfg.price;
}

const MAX_OUT = 700;
const cost = (p: { in: number; out: number }, tin: number, tout: number) => (tin * p.in + tout * p.out) / 1e6;

export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface AgentMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_calls?: ToolCall[]; tool_call_id?: string; [extra: string]: unknown }
/** One turn of a tool-using agent: the model either calls tools or answers in text. */
export type AgentTurn = (messages: AgentMessage[], tools: unknown[]) => Promise<AgentMessage>;

// some models think out loud first; only the answer after the thought block is the reply
const dropThoughts = (s: string) => s.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();

function poster(cfg: LlmConfig, fetchImpl: typeof fetch) {
  let last = 0;
  return async function post(body: Record<string, unknown>): Promise<AgentMessage> {
    for (let attempt = 0; ; attempt++) {
      if (cfg.budgetUsd != null) {
        if (!cfg.price) throw new BudgetExceeded(`no price known for ${cfg.model}; refusing to call a paid model blind`);
        // worst case for this call: every character a token, and the longest reply allowed
        const worst = cost(cfg.price, JSON.stringify(body).length, MAX_OUT);
        const spent = cfg.spend?.usd ?? 0;
        if (spent + worst > cfg.budgetUsd) throw new BudgetExceeded(`spending cap: $${spent.toFixed(4)} spent, the next call could cost up to $${worst.toFixed(4)}, cap $${cfg.budgetUsd}`);
      }
      const wait = last + cfg.minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, temperature: 0, ...(cfg.budgetUsd != null ? { max_tokens: MAX_OUT } : {}),
          ...(cfg.thinking === false ? { reasoning: { enabled: false } } : {}), ...body }),
      });
      if (res.ok) {
        const data = await res.json() as { choices?: { message?: AgentMessage }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        if (cfg.spend) {
          const tin = data.usage?.prompt_tokens ?? 0, tout = data.usage?.completion_tokens ?? 0;
          cfg.spend = { usd: cfg.spend.usd + (cfg.price ? cost(cfg.price, tin, tout) : 0), tokensIn: cfg.spend.tokensIn + tin, tokensOut: cfg.spend.tokensOut + tout, calls: cfg.spend.calls + 1 };
          if (cfg.spendFile) writeFileSync(cfg.spendFile, JSON.stringify(cfg.spend));
        }
        const m = data.choices?.[0]?.message ?? { role: 'assistant', content: '' };
        return { ...m, role: 'assistant', content: dropThoughts(m.content ?? '') };
      }
      // rate limits and overloads are normal on free tiers: back off and try again
      // paid providers get fewer retries, so a failing endpoint cannot run up a bill
      if ((res.status === 429 || res.status >= 500) && attempt < (cfg.budgetUsd != null ? 2 : 5)) { await sleep(Math.min(60000, 4000 * 2 ** attempt)); continue; }
      throw new Error(`model API answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
  };
}

export function llmClient(cfg: LlmConfig, fetchImpl: typeof fetch = fetch) {
  const post = poster(cfg, fetchImpl);
  return async (system: string, user: string): Promise<string> =>
    (await post({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })).content;
}

export function llmAgent(cfg: LlmConfig, fetchImpl: typeof fetch = fetch): AgentTurn {
  const post = poster(cfg, fetchImpl);
  return (messages, tools) => post({ messages, tools });
}
