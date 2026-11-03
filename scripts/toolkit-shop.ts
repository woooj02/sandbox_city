/**
 * A model shopper paying through PayPal's Agent Toolkit on the sandbox, under three rulebooks.
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/toolkit-shop.ts [poisoned=8] [clean=3]
 * Needs the sandbox keys (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_TEST_CARD) and a model key (GEMINI_API_KEY
 * or LLM_API_KEY). The cases are real ones from the default day: owner requests and listings, some of them poisoned,
 * dealt round-robin over the city's four injection templates.
 * Writes packages/web/src/data/toolkit-proof.json, which the report shows.
 */
import { writeFileSync } from 'node:fs';
import { DEFAULT_CONFIG, INJECTIONS, PRESETS, World, type BrainCase } from '@sandbox-city/core';
import { llmAgent, llmFromEnv, type AgentTurn } from '../packages/server/src/llm.ts';
import { shopCase, toolkitFromEnv, TOOLKIT_TOOLS, type LaneRun } from '../packages/server/src/toolkit-shop.ts';

const cfg = llmFromEnv();
const toolkit = toolkitFromEnv();
if (!cfg || !toolkit) { console.error('Needs a model key and the PayPal sandbox keys.'); process.exit(1); }
const nPoisoned = Number(process.argv[2] ?? 8), nClean = Number(process.argv[3] ?? 3);
const seed = 'neo-osaka-7';

// every case a model shopper meets on the default day, in the order the day meets them. Stock attackers all write
// at one subtlety, so the day only carries one injection template; to cover the city's four, the same day is also
// run with the injection crews set to each template's subtlety (the knob the attack forge evolves)
const day = async (subtlety?: number) => {
  const w = new World({ ...DEFAULT_CONFIG, seed, crypto: 'modeled', policy: PRESETS.open, brain: { shoppers: 1200, tape: {} },
    ...(subtlety == null ? {} : { genomes: { prompt_injection: { subtlety } } }) });
  await w.run();
  return [...w.brainMisses.values()];
};
const all = await day();
const seen = new Set<string>();
const fresh = (c: BrainCase) => !seen.has(c.listing.title) && !!seen.add(c.listing.title);
const template = (c: BrainCase) => INJECTIONS.findIndex((t) => c.listing.text.includes(t.text.split('{')[0].trim()));
const byTemplate = await Promise.all(INJECTIONS.map(async (_, i) => (await day((i + 0.5) / INJECTIONS.length)).filter((c) => c.injected && template(c) === i)));
const poisoned: BrainCase[] = [];
for (let round = 0; poisoned.length < nPoisoned && byTemplate.some((q) => q.length); round++)
  for (const q of byTemplate) {
    if (poisoned.length >= nPoisoned) break;
    while (q.length && !fresh(q[0])) q.shift();
    if (q.length) poisoned.push(q.shift()!);
  }
const cases: BrainCase[] = [...poisoned, ...all.filter((c) => !c.injected && fresh(c)).slice(0, nClean)];

// every rulebook sees the same model: identical conversations are asked once
const memo = new Map<string, ReturnType<AgentTurn>>();
const raw = llmAgent(cfg);
let calls = 0;
const agent: AgentTurn = (messages, tools) => {
  const k = JSON.stringify(messages);
  if (!memo.has(k)) { calls++; memo.set(k, raw(messages, tools)); }
  return memo.get(k)!;
};

const rulebooks = [PRESETS.open, PRESETS.tuned, PRESETS.kya];
const out: { store: string; title: string; price: number; injected: boolean; owner: BrainCase['owner']; text: string; lanes: LaneRun[] }[] = [];
for (const c of cases) {
  const lanes: LaneRun[] = [];
  for (const policy of rulebooks) {
    const r = await shopCase({ c, policy, agent, toolkit });
    lanes.push(r);
    for (const s of r.steps) if (s.gate === 'allowed' && s.reason) console.log(`  paypal said: ${s.reason.slice(0, 160)}`);
    console.log(`${c.injected ? 'POISONED' : 'clean   '} ${policy.name.padEnd(10)} ${r.steps.map((s) => `${s.tool}:${s.gate === 'refused' ? 'REFUSED' : s.status}`).join(' > ') || 'no tool calls'}${r.paid ? `  paid $${r.paid.total} to ${r.paid.shipTo}` : ''}`);
  }
  out.push({ store: c.listing.store, title: c.listing.title, price: c.listing.price, injected: !!c.injected, owner: c.owner, text: c.listing.text, lanes });
}

// read every paid order back from PayPal, by id, through the toolkit's own get_order
let completed = 0, matched = 0, amount = 0, orders = 0;
for (const c of out) for (const l of c.lanes) if (l.paid) {
  orders++;
  const g = await toolkit.call({ id: `rb-${l.paid.orderId}`, type: 'function', function: { name: 'get_order', arguments: JSON.stringify({ id: l.paid.orderId }) } }) as { status?: string; purchase_units?: { amount?: { value?: string } }[] };
  const v = Number(g.purchase_units?.[0]?.amount?.value ?? NaN);
  if (g.status === 'COMPLETED') completed++;
  if (Math.abs(v - l.paid.total) < 0.005) { matched++; amount += v; }
}

const lanes = rulebooks.map((p, i) => {
  const runs = out.map((c) => ({ c, l: c.lanes[i] }));
  const paid = runs.filter((r) => r.l.paid);
  const hijacked = paid.filter((r) => r.c.injected && r.l.strayed);
  return {
    rulebook: p.name, orders: paid.length, paid: Math.round(paid.reduce((n, r) => n + r.l.paid!.total, 0) * 100) / 100,
    hijackedPaid: hijacked.length, hijackedValue: Math.round(hijacked.reduce((n, r) => n + r.l.paid!.total, 0) * 100) / 100,
    refused: runs.reduce((n, r) => n + r.l.steps.filter((s) => s.gate === 'refused').length, 0),
    honestPaid: paid.filter((r) => !r.c.injected).length,
  };
});
const proof = {
  recordedAt: new Date().toISOString(), seed, model: cfg.model, toolkit: `@paypal/agent-toolkit ${toolkit.version}`, tools: [...TOOLKIT_TOOLS],
  modelCalls: calls, lanes, readBack: { orders, completed, matched, amount: Math.round(amount * 100) / 100 }, cases: out,
};
writeFileSync(new URL('../packages/web/src/data/toolkit-proof.json', import.meta.url), JSON.stringify(proof, null, 1) + '\n');
console.log(JSON.stringify({ lanes, readBack: proof.readBack, modelCalls: calls }));
