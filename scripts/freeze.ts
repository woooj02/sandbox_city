/**
 * Step 1 of the benchmark: tune on the development world and days only, then freeze the winner by hash.
 *   npx tsx scripts/freeze.ts [generations] [children]
 * Reads no test day. Writes evidence/frozen.json, which every later step checks before it runs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DEV_WORLD, DEV_WORLD_V2, describePolicy, EVALUATOR_VERSION, policyId, searchRulebook, TRAIN_SEEDS } from '@sandbox-city/core';

const v3 = process.argv.includes('--v3'), v2 = v3 || process.argv.includes('--v2');
const [g, k] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const gens = Number(g ?? 14), kids = Number(k ?? 12);
const res = await searchRulebook({
  trainSeeds: TRAIN_SEEDS, testSeeds: [], world: v2 ? DEV_WORLD_V2 : DEV_WORLD, floor: v2 ? { enforceMandate: true, shipLock: true, strictOrders: true, idempotencyKeys: true } : undefined, settle: true, generations: gens, children: kids, minAccess: 0.85, seed: v3 ? 'freeze-3' : v2 ? 'freeze-2' : 'freeze-1', label: v3 ? 'Frozen v3' : v2 ? 'Frozen v2' : 'Frozen',
}, (e) => { if (e.type === 'generation') console.log(`gen ${e.generation}: kept $${Math.round(e.best.mean.kept).toLocaleString('en-US')} · stolen $${Math.round(e.best.mean.stolen).toLocaleString('en-US')} · access ${(e.best.mean.access * 100).toFixed(1)}%`); });

const source = (f: string) => createHash('sha256').update(readFileSync(new URL(`../packages/core/src/${f}`, import.meta.url))).digest('hex').slice(0, 16);
const frozen = {
  policy: res.best.policy, policyId: policyId(res.best.policy), evaluator: EVALUATOR_VERSION,
  tunedOn: { seeds: TRAIN_SEEDS, world: v2 ? 'DEV_WORLD_V2: DEV_WORLD with sleeper stores using wash 0.5 and empty box 0.5; owner mandate, ship lock, strict orders and idempotency fixed on' : 'DEV_WORLD: six stock families, 3 sleeper stores, 5 rising stores', rulebooksTried: res.evals },
  train: res.best.mean, sources: { 'policy.ts': source('policy.ts') },
};
mkdirSync(new URL('../evidence/', import.meta.url), { recursive: true });
writeFileSync(new URL(v3 ? '../evidence/frozen-v3.json' : v2 ? '../evidence/frozen-v2.json' : '../evidence/frozen.json', import.meta.url), JSON.stringify(frozen, null, 2) + '\n');
console.log(`\nfrozen ${frozen.policyId} after ${res.evals} rulebooks\n  - ${describePolicy(res.best.policy).join('\n  - ')}`);
