/**
 * A small client for the common chat-completions API that most model providers serve
 * (OpenAI-style `POST {base}/chat/completions` with a bearer key).
 *
 * Defaults to Google's Gemini endpoint; point LLM_BASE_URL and LLM_MODEL elsewhere to use another provider.
 *   LLM_API_KEY (or GEMINI_API_KEY)  required
 *   LLM_BASE_URL                     default https://generativelanguage.googleapis.com/v1beta/openai
 *   LLM_MODEL                        default gemma-4-26b-a4b-it (an open-weight model with no paid tier)
 *   LLM_MIN_GAP_MS                   default 8000 (keeps free tiers under their per-minute limit)
 */
export interface LlmConfig { baseUrl: string; apiKey: string; model: string; minGapMs: number }

export function llmFromEnv(env = process.env): LlmConfig | null {
  const apiKey = env.LLM_API_KEY || env.GEMINI_API_KEY || '';
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.LLM_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/+$/, ''),
    model: env.LLM_MODEL || 'gemma-4-26b-a4b-it',
    minGapMs: Number(env.LLM_MIN_GAP_MS ?? 8000),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
      const wait = last + cfg.minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, temperature: 0, ...body }),
      });
      if (res.ok) {
        const data = await res.json() as { choices?: { message?: AgentMessage }[] };
        const m = data.choices?.[0]?.message ?? { role: 'assistant', content: '' };
        return { ...m, role: 'assistant', content: dropThoughts(m.content ?? '') };
      }
      // rate limits and overloads are normal on free tiers: back off and try again
      if ((res.status === 429 || res.status >= 500) && attempt < 5) { await sleep(Math.min(60000, 4000 * 2 ** attempt)); continue; }
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
