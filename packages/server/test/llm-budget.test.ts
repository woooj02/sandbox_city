import { describe, expect, it } from 'vitest';
import { BudgetExceeded, llmAgent, llmFromEnv, llmPricing, type LlmConfig } from '../src/llm';

// a provider that counts what reaches it and bills 1,000 tokens in and 100 out per call
const provider = () => {
  let calls = 0;
  const f = (async (url: string) => {
    if (String(url).endsWith('/models')) return new Response(JSON.stringify([{ id: 'small-model', pricing: { input: 0.2, output: 0.2 } }]));
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }));
  }) as unknown as typeof fetch;
  return { f, calls: () => calls };
};
const cfg = (over: Partial<LlmConfig> = {}): LlmConfig => ({
  baseUrl: 'https://paid.test/v1', apiKey: 'k', model: 'small-model', minGapMs: 0, budgetUsd: 0.01,
  spend: { usd: 0, tokensIn: 0, tokensOut: 0, calls: 0 }, ...over,
});
const ask = (c: LlmConfig, f: typeof fetch) => llmAgent(c, f)([{ role: 'user', content: 'hi' }], []);

describe('spending cap on paid models', () => {
  it('sends nothing to a paid model whose price is unknown', async () => {
    const p = provider();
    await expect(ask(cfg(), p.f)).rejects.toBeInstanceOf(BudgetExceeded);
    expect(p.calls()).toBe(0);
  });

  it('reads the price from the provider and adds up what each call cost', async () => {
    const p = provider();
    const c = cfg();
    expect(await llmPricing(c, p.f)).toEqual({ in: 0.2, out: 0.2 });
    await ask(c, p.f);
    expect(c.spend).toMatchObject({ calls: 1, tokensIn: 1000, tokensOut: 100 });
    expect(c.spend!.usd).toBeCloseTo(0.00022, 8);
  });

  it('refuses the call that could cross the cap, before sending it', async () => {
    const p = provider();
    const c = cfg({ price: { in: 0.2, out: 0.2 }, budgetUsd: 0.0005 });
    await ask(c, p.f);
    await ask(c, p.f);
    // two calls spent $0.00044; the next one could cost more than the $0.00006 left
    await expect(ask(c, p.f)).rejects.toThrow(/spending cap/);
    expect(p.calls()).toBe(2);
    expect(c.spend!.usd).toBeLessThanOrEqual(0.0005);
  });

  it('puts a key for a paid provider under a cap by default', () => {
    const c = llmFromEnv({ TOGETHER_API_KEY: 'k' } as NodeJS.ProcessEnv)!;
    expect(c.baseUrl).toContain('together');
    expect(c.budgetUsd).toBe(0.25);
    expect(llmFromEnv({ GEMINI_API_KEY: 'k' } as NodeJS.ProcessEnv)!.budgetUsd).toBeUndefined();
  });
});
