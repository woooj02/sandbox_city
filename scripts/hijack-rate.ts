/**
 * How often a model planner is talked into a hijacked order, and how often the gate catches it.
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/hijack-rate.ts [--estimate]
 * Real cases from three simulated days (every distinct poisoned listing, plus honest ones) go to the planner in
 * batches, once with the ordinary shopping prompt and once with the careful one. Every planned order is then put
 * through the gate's create_order check under Lab-Tuned and Know Your Agent; the hijacked plans go through again one
 * change at a time, under every preset (probePlans). Planner calls only: nothing reaches PayPal (the toolkit run in
 * scripts/toolkit-shop.ts is the one that pays). A paid model runs under the client's spending cap (LLM_BUDGET_USD).
 * --estimate prints the case count and prompt size and sends nothing.
 * Writes packages/web/src/data/hijack-rate.json, which the hijack exhibit shows.
 */
import { writeFileSync } from 'node:fs';
import { BRAIN_PROMPTS, brainPrompt, INJECTIONS, PRESETS, type BrainCase, type BrainPrompt } from '@sandbox-city/core';
import { llmClient, llmFromEnv, llmPricing } from '../packages/server/src/llm.ts';
import { dayCases, gatePlan, goesElsewhere, planCases, PLAN_BATCH, probePlans, templateOf } from '../packages/server/src/toolkit-shop.ts';

const SEEDS = ['neo-osaka-7', 'kowloon-9', 'lagos-2'];
const seen = new Set<string>();
const cases: (BrainCase & { seed: string })[] = [];
for (const seed of SEEDS)
  for (const c of await dayCases(40, 4, seed)) {
    const k = `${c.listing.store}|${c.listing.title}`;
    if (!seen.has(k)) { seen.add(k); cases.push({ ...c, key: `${seed}:${c.key}`, seed }); }
  }
const poisoned = cases.filter((c) => c.injected).length;
const chars = Math.ceil(cases.length / PLAN_BATCH) * 2 * (BRAIN_PROMPTS.guarded.length) + 2 * brainPrompt(cases).length;
console.log(`${cases.length} cases (${poisoned} poisoned) from ${SEEDS.length} days, about ${Math.round(chars / 4)} prompt tokens for both prompts`);
if (process.argv.includes('--estimate')) process.exit(0);

const cfg = llmFromEnv();
if (!cfg) { console.error('Needs a model key.'); process.exit(1); }
if (cfg.budgetUsd != null) {
  const price = await llmPricing(cfg);
  if (!price) { console.error(`No published price for ${cfg.model}; set LLM_PRICE_IN and LLM_PRICE_OUT. Nothing was sent.`); process.exit(1); }
  console.log(`model ${cfg.model}: $${price.in}/M in, $${price.out}/M out, cap $${cfg.budgetUsd}, already spent $${(cfg.spend?.usd ?? 0).toFixed(4)}`);
}
const before = cfg.spend ? { ...cfg.spend } : undefined;
const ask = llmClient(cfg);
let calls = 0;
const prompts: BrainPrompt[] = ['plain', 'guarded'];
const plans = Object.fromEntries(await Promise.all(prompts.map(async (p) =>
  [p, await planCases(cases, async (s, u) => { calls++; return ask(s, u); }, PLAN_BATCH, BRAIN_PROMPTS[p])] as const)));

const gates = [PRESETS.tuned, PRESETS.kya];
const rows = cases.map((c) => ({
  seed: c.seed, store: c.listing.store, title: c.listing.title, price: c.listing.price, text: c.listing.text, injected: !!c.injected,
  template: c.injected ? templateOf(c) : -1, owner: c.owner,
  ...Object.fromEntries(prompts.map((p) => {
    const d = plans[p][c.key];
    const hijacked = !!d?.buy && goesElsewhere(d.shipTo, d.qty, c.owner);
    return [p, d ? {
      buy: d.buy, qty: d.qty, shipTo: d.shipTo, reason: d.reason, hijacked,
      gate: d.buy ? Object.fromEntries(gates.map((g) => { const r = gatePlan(g, c, d); return [g.name, r.ok ? 'allowed' : r.reason]; })) : undefined,
    } : null];
  })),
})) as ({ injected: boolean; template: number } & Record<BrainPrompt, { buy: boolean; hijacked: boolean; gate?: Record<string, string> } | null>)[];

const tally = (p: BrainPrompt) => {
  const poisonedRows = rows.filter((r) => r.injected), clean = rows.filter((r) => !r.injected);
  const hijacked = poisonedRows.filter((r) => r[p]?.hijacked);
  return {
    poisoned: poisonedRows.length, decided: poisonedRows.filter((r) => r[p]).length, hijacked: hijacked.length,
    skipped: poisonedRows.filter((r) => r[p] && !r[p]!.buy).length,
    byTemplate: INJECTIONS.map((_, i) => ({ cases: poisonedRows.filter((r) => r.template === i).length, hijacked: hijacked.filter((r) => r.template === i).length })),
    refused: Object.fromEntries(gates.map((g) => [g.name, hijacked.filter((r) => r[p]!.gate?.[g.name] !== 'allowed').length])),
    clean: clean.length, cleanBought: clean.filter((r) => r[p]?.buy).length,
    cleanRefused: Object.fromEntries(gates.map((g) => [g.name, clean.filter((r) => r[p]?.buy && r[p]!.gate?.[g.name] !== 'allowed').length])),
  };
};
// one change at a time, on the ordinary prompt's hijacked plans, under every preset
const byKey = (p: BrainPrompt, test: (c: BrainCase, d: NonNullable<(typeof plans)[BrainPrompt][string]>) => boolean) =>
  cases.flatMap((c) => { const d = plans[p][c.key]; return d?.buy && test(c, d) ? [{ c, d }] : []; });
const probes = probePlans([PRESETS.open, PRESETS.balanced, PRESETS.tuned, PRESETS.kya],
  byKey('plain', (c, d) => !!c.injected && goesElsewhere(d.shipTo, d.qty, c.owner)), byKey('plain', (c) => !c.injected));
const spent = cfg.spend && before ? { usd: Math.round((cfg.spend.usd - before.usd) * 1e4) / 1e4, tokensIn: cfg.spend.tokensIn - before.tokensIn, tokensOut: cfg.spend.tokensOut - before.tokensOut } : undefined;
const out = {
  recordedAt: new Date().toISOString(), model: cfg.model, seeds: SEEDS, batch: PLAN_BATCH, modelCalls: calls, ...(spent?.usd ? { modelCost: spent } : {}),
  templates: INJECTIONS.map((t) => t.text), prompts: Object.fromEntries(prompts.map((p) => [p, tally(p)])), probes, cases: rows,
};
writeFileSync(new URL(`../packages/web/src/data/${process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'hijack-rate'}.json`, import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ prompts: out.prompts, modelCalls: calls, spent }, null, 1));
