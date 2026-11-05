/**
 * Can a model read an incident and repair a rulebook? Compared with blind mutation at the same budget.
 *   OLLAMA_MODEL=llama3.1:8b npx tsx scripts/llm-defender.ts [--budget=10] [--runs=3]
 * Both start from Lab-Tuned with the invariants on, on the round-two development world. Both may only change rules
 * through applyPatch. A change is kept if it keeps more value on development days with access at or above 85%.
 * The winners are then scored on days neither saw. Writes packages/web/src/data/defender.json.
 */
import { writeFileSync } from 'node:fs';
import { applyPatch, ATTACK_KINDS, DEV_WORLD_V2, mean, mutate, policyId, PRESETS, RULES, runArm, Rng, TEST_SEEDS, TRAIN_SEEDS, type DayResult, type Policy } from '@sandbox-city/core';

const opt = (n: string, d: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const budget = Number(opt('budget', '10')), runs = Number(opt('runs', '3'));
const model = process.env.OLLAMA_MODEL ?? 'llama3.1:8b', url = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const train = TRAIN_SEEDS.slice(0, 2), test = TEST_SEEDS.slice(0, 8);
const start: Policy = { ...PRESETS.tuned, name: 'Start', enforceMandate: true, shipLock: true, strictOrders: true, idempotencyKeys: true };

const score = async (p: Policy, seeds: string[]) => {
  const a = await runArm('x', p, seeds, DEV_WORLD_V2);
  const col = (f: (d: DayResult) => number) => mean(a.days.map(f));
  const families = Object.fromEntries(ATTACK_KINDS.map((k) => [k, Math.round(col((d) => d.attacks[k].leaked))]).filter(([, v]) => (v as number) > 0));
  return { kept: col((d) => d.kept), stolen: col((d) => d.stolen), access: col((d) => d.access), families };
};
type Score = Awaited<ReturnType<typeof score>>;

const rules = RULES.map((r) => `${r.key} (${r.kind === 'bool' ? 'true/false' : `0 or ${r.min}..${r.max} step ${r.step}`}): ${r.blurb}`).join('\n');
async function propose(p: Policy, s: Score, seed: number, tried: string[]): Promise<unknown> {
  const now = Object.fromEntries(RULES.map((r) => [r.key, p[r.key] ?? 0]));
  const prompt = `A payment gate for shopping agents. Current rules: ${JSON.stringify(now)}
Result per simulated day: value kept $${Math.round(s.kept)}, stolen $${Math.round(s.stolen)}, honest access ${(s.access * 100).toFixed(1)}%.
Money stolen by attack family: ${JSON.stringify(s.families)}.
sleeper_store: a store earns a good record, then takes orders and never ships, or ships empty parcels, or fakes its record by buying from itself.
Rules you can change:\n${rules}
Already tried and not better: ${tried.join(' | ') || 'nothing yet'}.
Propose one change that keeps more value. Reply with JSON only: the rules to change and their new values, at most 4.`;
  const res = await fetch(`${url}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: false, format: 'json', options: { temperature: 0.7, seed }, messages: [{ role: 'user', content: prompt }] }) });
  const text = ((await res.json()) as { message: { content: string } }).message.content;
  try { return JSON.parse(text); } catch { return text; }
}

// the search space is the same for both, and the third round's rule is in it
async function climb(kind: 'model' | 'mutation', run: number) {
  const r = new Rng(`defender-${run}`);
  let best = start, s = await score(start, train);
  let rejected = 0, kept = 0;
  const reasons: string[] = [], tried: string[] = [];
  for (let i = 0; i < budget; i++) {
    let patch: unknown;
    if (kind === 'model') patch = await propose(best, s, run * 100 + i, tried);
    else {
      const m = mutate(best, r);
      patch = Object.fromEntries(RULES.filter((x) => m[x.key] !== best[x.key]).map((x) => [x.key, m[x.key]]));
    }
    const a = applyPatch(best, patch);
    if (!a.ok) { rejected++; if (reasons.length < 8) reasons.push(a.reason); continue; }
    const t = await score(a.policy, train);
    if (t.kept > s.kept && t.access >= 0.85) { best = a.policy; s = t; kept++; } else tried.push(JSON.stringify(patch).slice(0, 80));
  }
  const held = await score(best, test);
  console.log(`${kind} ${run}: rejected ${rejected}/${budget}, kept ${kept}, dev $${Math.round(s.kept)}, unseen $${Math.round(held.kept)}`);
  return { kind, run, rejected, accepted: kept, devKept: Math.round(s.kept), testKept: Math.round(held.kept), testStolen: Math.round(held.stolen), access: held.access, policy: policyId(best), reasons };
}

const base = await score(start, test);
const rows = [];
for (let run = 1; run <= runs; run++) for (const kind of ['model', 'mutation'] as const) rows.push(await climb(kind, run));
writeFileSync(new URL('../packages/web/src/data/defender.json', import.meta.url), JSON.stringify({ model, budget, runs, trainDays: train.length, testDays: test.length, startKept: Math.round(base.kept), rows }, null, 2) + '\n');
