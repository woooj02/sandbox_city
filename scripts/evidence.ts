/**
 * Bundles the recorded runs into the one file the Evidence exhibit reads. Computes nothing new.
 *   npx tsx scripts/evidence.ts
 * A proof that has not been run is left out, and the exhibit says so instead of showing a stand-in.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const data = (f: string) => new URL(`../packages/web/src/data/${f}`, import.meta.url);
const load = (f: string) => (existsSync(data(f)) ? JSON.parse(readFileSync(data(f), 'utf8')) : null);

/** The per-day columns stay in the source files; the exhibit shows means and intervals. */
function compact(b: { arms?: { days?: unknown; policy?: unknown }[] } | null) {
  if (!b) return null;
  return { ...b, arms: b.arms?.map(({ days: _days, policy: _policy, ...a }) => a) };
}

const dir = new URL('../regressions/', import.meta.url);
const cases = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));

writeFileSync(data('evidence.json'), JSON.stringify({
  first: compact(load('benchmark.json')), second: compact(load('benchmark-v2.json')), third: compact(load('benchmark-v3.json')),
  recovery: load('recovery-proof.json'), checkout: load('checkout-proof.json'), sleeperCheckout: load('sleeper-checkout.json'), agents: load('agent-rate.json'), defender: load('defender.json'),
  regressions: cases.map((c) => ({ id: c.id, kind: c.kind, title: c.title, minimized: c.minimized ?? null, threat: c.threat })),
  sleeperCase: cases.find((c) => c.id === 'day-sleeper-store') ?? null,
}) + '\n');
console.log(`evidence.json: ${cases.length} regressions`);
