/**
 * Bundles the recorded runs into the one file the Evidence exhibit reads. Computes nothing new.
 *   npx tsx scripts/evidence.ts
 * A proof that has not been run is left out, and the exhibit says so instead of showing a stand-in.
 */
import { BASELINES, INVARIANT_FLOOR, type Policy } from '@sandbox-city/core';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const data = (f: string) => new URL(`../packages/web/src/data/${f}`, import.meta.url);
const load = (f: string) => (existsSync(data(f)) ? JSON.parse(readFileSync(data(f), 'utf8')) : null);

/** The per-day columns stay in the source files; the exhibit shows means and intervals. */
function compact(b: { arms?: { days?: unknown; policy?: unknown }[] } | null) {
  if (!b) return null;
  return { ...b, arms: b.arms?.map(({ days: _days, policy: _policy, ...a }) => a) };
}

/** Round four's arms store a name. These are the rulebooks that ran, so the one a developer chooses is real. */
const rulebook = (f: string): Policy => JSON.parse(readFileSync(new URL(`../evidence/${f}`, import.meta.url), 'utf8')).policy;
const fourthRules: Record<string, Policy> = { ...BASELINES, frozen_v1: rulebook('frozen.json'), frozen_v2: rulebook('frozen-v2.json'), frozen_v3: rulebook('frozen-v3.json'), frozen: rulebook('frozen-v4.json') };

const dir = new URL('../regressions/', import.meta.url);
const cases = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));

writeFileSync(data('evidence.json'), JSON.stringify({
  first: compact(load('benchmark.json')), second: compact(load('benchmark-v2.json')), third: compact(load('benchmark-v3.json')),
  // round four keeps each arm's rulebook, so a developer can take the one they choose
  fourth: ((b) => b && { ...b, arms: b.arms?.map(({ days: _days, ...a }: { days?: unknown; key: string; name: string; access: { mean: number }; exact: { access: number } }) => ({ ...a, access: { ...a.access, mean: a.exact.access }, rules: { ...fourthRules[a.key], ...INVARIANT_FLOOR, name: a.name } })) })(load('benchmark-v4.json')),
  recovery: load('recovery-proof.json'), checkout: load('checkout-proof.json'), sleeperCheckout: load('sleeper-checkout.json'), agents: load('agent-rate.json'), defender: load('defender.json'),
  agentCases: cases.filter((c) => c.kind === 'agent').map(({ id, kind, title, input, control }) => ({ id, kind, title, input, control })),
  regressions: cases.map((c) => ({ id: c.id, kind: c.kind, title: c.title, minimized: c.minimized ?? null, threat: c.threat })),
  sleeperCase: cases.find((c) => c.id === 'day-sleeper-store') ?? null,
}) + '\n');
console.log(`evidence.json: ${cases.length} regressions`);
