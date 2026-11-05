/**
 * Step 2 of the benchmark: read the frozen rulebook, confirm nothing has moved, and run it on the test days.
 *   npx tsx scripts/benchmark.ts [--frozen=evidence/frozen.json] [--out=benchmark] core heldout sensitivity adaptive search latency
 * Each section merges into packages/web/src/data/<out>.json. Nothing is dropped from the results: negative results stay.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  BASELINES, bootstrap, DEFAULT_CONFIG, DEV_WORLD, evaluateOrder, FINAL_SEEDS, LAST_SEEDS, EVALUATOR_VERSION, forgeAttacks, HELD_OUT, mean, observe, pairedDifference, policyId, PRESETS, runArm, searchRulebook,
  TEST_SEEDS, TRAIN_SEEDS, World, type Arm, type DayResult, type GateContext, type OrderIntent, type Policy, type WorldConfig,
} from '@sandbox-city/core';

const flag = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const sections = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const frozenPath = flag('frozen', 'evidence/frozen.json');
const seeds = flag('seeds', '') === 'final' ? FINAL_SEEDS : flag('seeds', '') === 'last' ? LAST_SEEDS : flag('seeds', '') ? flag('seeds', '').split(',') : TEST_SEEDS;
const outFile = new URL(`../packages/web/src/data/${flag('out', 'benchmark')}.json`, import.meta.url);

const frozen = JSON.parse(readFileSync(frozenPath, 'utf8'));
const policy: Policy = frozen.policy;
if (policyId(policy) !== frozen.policyId) throw new Error(`frozen rulebook does not match its hash: ${policyId(policy)} is not ${frozen.policyId}`);
const out: Record<string, unknown> = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : {};
const save = () => writeFileSync(outFile, JSON.stringify(out) + '\n');
out.frozen = { policyId: frozen.policyId, evaluator: EVALUATOR_VERSION, tunedOn: frozen.tunedOn, rules: policy };
out.protocol = { testDays: seeds.length, trainDays: TRAIN_SEEDS.length, unit: 'one simulated day, run to its terminal state', interval: '95% percentile bootstrap over days, paired where compared', mode: 'simulation on the PayPal twin' };

const earlier = (flag('compare', '') ? flag('compare', '').split(',') : []).map((f, i): [string, Policy] => [`frozen_v${i + 1}`, { ...JSON.parse(readFileSync(f, 'utf8')).policy, name: `Frozen v${i + 1}` }]);
const arms = (): [string, Policy][] => [...Object.entries(BASELINES), ...earlier, ['frozen', { ...policy, name: policy.name ?? 'Frozen' }]];
const col = (a: Arm, f: (d: DayResult) => number) => a.days.map(f);
const tag = (s: string) => `${frozen.policyId}:${s}`;

function summary(a: Arm, ref: Arm) {
  const refused = (d: DayResult, c: 'new_store' | 'gift' | 'repeat' | 'regular') => d.cohorts[c];
  const rate = (c: 'new_store' | 'gift' | 'repeat' | 'regular') => {
    const n = a.days.reduce((s, d) => s + refused(d, c).attempts, 0);
    return { attempts: n, refused: a.days.reduce((s, d) => s + refused(d, c).refused, 0) };
  };
  return {
    key: a.key, name: a.name, policy: a.policy,
    stolen: bootstrap(col(a, (d) => d.stolen), tag(`${a.key}:stolen`)), fulfilled: bootstrap(col(a, (d) => d.fulfilled), tag(`${a.key}:ful`)), kept: bootstrap(col(a, (d) => d.kept), tag(`${a.key}:kept`)),
    access: bootstrap(col(a, (d) => d.access), tag(`${a.key}:acc`)), refusedValue: bootstrap(col(a, (d) => d.refusedValue), tag(`${a.key}:ref`)),
    challengedPer100: Math.round(1000 * a.days.reduce((s, d) => s + d.challenged, 0) / a.days.reduce((s, d) => s + d.orders, 0)) / 10,
    heldDollarHours: bootstrap(col(a, (d) => d.heldDollarHours), tag(`${a.key}:held`)),
    sleeper: { stolen: bootstrap(col(a, (d) => d.attacks.sleeper_store.leaked), tag(`${a.key}:sl`)), profit: bootstrap(col(a, (d) => d.attacks.sleeper_store.profit), tag(`${a.key}:slp`)) },
    cohorts: { new_store: rate('new_store'), gift: rate('gift'), repeat: rate('repeat'), regular: rate('regular') },
    overBound: Math.max(...col(a, (d) => d.overBound)),
    vsFrozen: a === ref ? null : { kept: pairedDifference(col(ref, (d) => d.kept), col(a, (d) => d.kept), tag(`${a.key}:dk`)), stolen: pairedDifference(col(ref, (d) => d.stolen), col(a, (d) => d.stolen), tag(`${a.key}:ds`)) },
    days: { seeds: a.days.map((d) => d.seed), kept: col(a, (d) => d.kept), stolen: col(a, (d) => d.stolen) },
  };
}

if (sections.includes('core')) {
  const done: Arm[] = [];
  for (const [key, p] of arms()) { done.push(await runArm(key, p, seeds, DEV_WORLD)); console.log(`core ${p.name}: done`); }
  const ref = done[done.length - 1];
  out.arms = done.map((a) => summary(a, ref));
  save();
}

if (sections.includes('heldout')) {
  const rows = [];
  const contenders = arms().filter(([k]) => k !== 'simple');
  for (const [key, h] of Object.entries(HELD_OUT)) {
    const family = key === 'subscription' ? 'subscription_trap' : key === 'triangulation' ? 'triangulation' : 'sleeper_store';
    const results: unknown[] = [];
    for (const [k, p] of contenders) {
      const a = await runArm(k, p, seeds, h.world);
      results.push({ key: k, name: a.name, stolen: bootstrap(col(a, (d) => d.attacks[family].leaked), tag(`${key}:${k}:s`)), profit: bootstrap(col(a, (d) => d.attacks[family].profit), tag(`${key}:${k}:p`)), kept: bootstrap(col(a, (d) => d.kept), tag(`${key}:${k}:k`)), access: bootstrap(col(a, (d) => d.access), tag(`${key}:${k}:a`)), overBound: Math.max(...col(a, (d) => d.overBound)) });
    }
    rows.push({ key, label: h.label, blindSpot: h.blindSpot, family, arms: results });
    console.log(`heldout ${h.label}: done`);
    out.heldOut = rows; save();
  }
}

if (sections.includes('sensitivity')) {
  const days = seeds.slice(0, 12);
  const scenarios: [string, string, Partial<WorldConfig>][] = [
    ['base', 'As assumed', {}],
    ['approve_low', 'Owners approve 60% of step-ups, not 86%', { assumptions: { ownerApproves: 0.6 } }],
    ['approve_high', 'Owners approve 97% of step-ups', { assumptions: { ownerApproves: 0.97 } }],
    ['hijack_approve', 'Owners approve 40% of hijacked orders, not 10%', { assumptions: { ownerApprovesHijack: 0.4 } }],
    ['gullible', 'Agents twice as easy to fool', { assumptions: { gullibility: 2 } }],
    ['careful', 'Agents half as easy to fool', { assumptions: { gullibility: 0.5 } }],
    ['cogs_low', 'Goods cost 40% of the price, not 60%', { assumptions: { cogs: 0.4 } }],
    ['many_rising', '15 honest rising stores, not 5', { rising: 15 }],
    ['no_rising', 'No rising stores', { rising: 0 }],
    ['more_sleepers', '9 sleeper stores, not 3', { attackers: { ...DEV_WORLD.attackers, sleeper_store: 9 } }],
    ['double_attackers', 'Every attack family doubled', { attackers: Object.fromEntries(Object.entries(DEV_WORLD.attackers!).map(([k, v]) => [k, (v ?? 0) * 2])) }],
    ['no_chaos', 'No rail faults', { chaos: 0 }],
  ];
  const rows = [];
  const contenders = arms().filter(([k]) => k !== 'open');
  for (const [key, label, change] of scenarios) {
    const results: { key: string; name: string; kept: number; stolen: number; access: number }[] = [];
    for (const [k, p] of contenders) {
      const a = await runArm(k, p, days, { ...DEV_WORLD, ...change });
      results.push({ key: k, name: a.name, kept: Math.round(mean(col(a, (d) => d.kept))), stolen: Math.round(mean(col(a, (d) => d.stolen))), access: mean(col(a, (d) => d.access)) });
    }
    rows.push({ key, label, ranking: [...results].sort((x, y) => y.kept - x.kept).map((r) => r.key), results });
    console.log(`sensitivity ${key}: ${[...results].sort((x, y) => y.kept - x.kept).map((r) => r.key).join(' > ')}`);
    out.sensitivity = { days: days.length, rows }; save();
  }
}

if (sections.includes('adaptive')) {
  const train = TRAIN_SEEDS.slice(0, 2), test = seeds.slice(0, 12);
  const budget = { generations: 5, children: 6 };
  const run = async (label: string, opts: Partial<Parameters<typeof forgeAttacks>[0]>) => {
    const r = await forgeAttacks({ policy, seeds: train, world: DEV_WORLD, settle: true, objective: 'profit', seed: `adaptive-${label}`, ...budget, ...opts });
    const before = await runArm('default', policy, test, DEV_WORLD), after = await runArm(label, policy, test, { ...DEV_WORLD, genomes: r.best.genomes });
    const profit = (a: Arm) => bootstrap(col(a, (d) => d.attacks.sleeper_store.profit), tag(`adaptive:${label}:${a.key}`));
    const stolen = (a: Arm) => bootstrap(col(a, (d) => d.stolen), tag(`adaptive:${label}:${a.key}:s`));
    console.log(`adaptive ${label}: sleeper profit ${profit(before).mean} -> ${profit(after).mean}`);
    return { label, evals: r.evals, genome: r.best.genomes.sleeper_store, sleeperProfit: { before: profit(before), after: profit(after) }, stolen: { before: stolen(before), after: stolen(after) }, overBound: Math.max(...col(after, (d) => d.overBound)) };
  };
  out.adaptive = {
    days: test.length, trainDays: train.length,
    rounds: [await run('declared', { locked: ['wash', 'emptyBox'] }), await run('unlocked', {}), await run('random', { strategy: 'random', locked: ['wash', 'emptyBox'] })],
  };
  save();
}

if (sections.includes('search')) {
  const train = TRAIN_SEEDS.slice(0, 2), test = seeds.slice(0, 8), budget = 36;
  const rows = [];
  for (let i = 1; i <= 5; i++) for (const strategy of ['evolve', 'random'] as const) {
    const r = await searchRulebook({ trainSeeds: train, testSeeds: [], world: DEV_WORLD, settle: true, generations: 12, children: 6, minAccess: 0.85, seed: `matched-${i}`, strategy, budget });
    const a = await runArm(strategy, r.best.policy, test, DEV_WORLD);
    rows.push({ strategy, run: i, evals: r.evals, trainKept: r.best.mean.kept, testKept: Math.round(mean(col(a, (d) => d.kept))) });
    console.log(`search ${strategy} ${i}: test kept ${rows[rows.length - 1].testKept}`);
    out.search = { budget, trainDays: train.length, testDays: test.length, rows }; save();
  }
}

if (sections.includes('latency')) {
  const tapped: { o: OrderIntent; ctx: GateContext }[] = [];
  const w = new World({ ...DEFAULT_CONFIG, ...DEV_WORLD, seed: 'latency', policy, gateTap: (o, ctx) => tapped.push({ o, ctx }) });
  await w.run();
  const us: number[] = [];
  for (let pass = 0; pass < 20; pass++) for (const { o, ctx } of tapped) { const t = process.hrtime.bigint(); evaluateOrder(policy, observe(o), ctx); us.push(Number(process.hrtime.bigint() - t) / 1000); }
  us.sort((a, b) => a - b);
  out.latency = { decisions: us.length, p50us: Math.round(us[Math.floor(us.length * 0.5)] * 10) / 10, p99us: Math.round(us[Math.floor(us.length * 0.99)] * 10) / 10, note: 'rule evaluation only, on a laptop; signature checks and network not included' };
  save();
}
const sourceHash = createHash('sha256').update(readFileSync(new URL('../packages/core/src/policy.ts', import.meta.url))).digest('hex').slice(0, 16);
out.evaluatorSource = sourceHash;
save();
console.log('saved', outFile.pathname);
