/**
 * A small client for the common chat-completions API that most model providers serve
 * (OpenAI-style `POST {base}/chat/completions` with a bearer key).
 *
 * Defaults to Google's Gemini endpoint; point LLM_BASE_URL and LLM_MODEL elsewhere to use another provider.
 *   LLM_API_KEY (or GEMINI_API_KEY)  required
 *   LLM_BASE_URL                     default https://generativelanguage.googleapis.com/v1beta/openai
 *   LLM_MODEL                        default gemini-2.5-flash
 *   LLM_MIN_GAP_MS                   default 6500 (keeps free tiers under their per-minute limit)
 */
export interface LlmConfig { baseUrl: string; apiKey: string; model: string; minGapMs: number }

export function llmFromEnv(env = process.env): LlmConfig | null {
  const apiKey = env.LLM_API_KEY || env.GEMINI_API_KEY || '';
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.LLM_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/+$/, ''),
    model: env.LLM_MODEL || 'gemini-2.5-flash',
    minGapMs: Number(env.LLM_MIN_GAP_MS ?? 6500),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function llmClient(cfg: LlmConfig, fetchImpl: typeof fetch = fetch) {
  let last = 0;
  return async function chat(system: string, user: string): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      const wait = last + cfg.minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
      if (res.ok) {
        const data = await res.json() as { choices?: { message?: { content?: string } }[] };
        return data.choices?.[0]?.message?.content ?? '';
      }
      // rate limits and overloads are normal on free tiers: back off and try again
      if ((res.status === 429 || res.status >= 500) && attempt < 5) { await sleep(Math.min(60000, 4000 * 2 ** attempt)); continue; }
      throw new Error(`model API answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
  };
}
