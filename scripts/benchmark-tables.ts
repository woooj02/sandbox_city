/**
 * The benchmark tables, written from the recorded results.
 *   npx tsx scripts/benchmark-tables.ts      prints the markdown for docs/BENCHMARK.md
 * verify-claims.ts builds the same rows and requires them, word for word, in the docs.
 */
import { fileURLToPath } from 'node:url';

export interface Ci { mean: number; lo: number; hi: number }
const whole = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
export const ci = (c: Ci) => `${whole(c.mean)} [${whole(c.lo)}, ${whole(c.hi)}]`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/* eslint-disable @typescript-eslint/no-explicit-any */
export function armRows(b: any): string[] {
  return b.arms.map((a: any) => {
    const n = a.cohorts.new_store;
    return `| ${a.name} | ${ci(a.kept)} | ${ci(a.stolen)} | ${pct(a.access.mean)} | ${pct(n.refused / Math.max(1, n.attempts))} | ${a.challengedPer100} | ${whole(a.heldDollarHours.mean)} | ${whole(a.sleeper.stolen.mean)} | ${whole(a.sleeper.profit.mean)} |`;
  });
}

export function heldRows(b: any, first: any): string[] {
  return b.heldOut.map((h: any) => {
    const by = (name: string) => h.arms.find((a: any) => a.name === name);
    const before = first.heldOut.find((x: any) => x.label === h.label)?.arms.find((a: any) => a.name === 'Frozen');
    const open = by('Wild West'), v2 = by('Frozen v2'), v3 = by('Frozen v3');
    return `| ${h.label} | ${ci(open.stolen)} | ${before ? whole(before.stolen.mean) : '—'} | ${ci(v2.stolen)} | ${ci(v3.stolen)} | ${whole(v3.profit.mean)} |`;
  });
}

export function adaptiveRows(b: any): string[] {
  return b.adaptive.rounds.map((r: any) => `| ${r.label} | ${r.evals} | ${whole(r.sleeperProfit.before.mean)} | ${ci(r.sleeperProfit.after)} | ${whole(r.stolen.after.mean)} | ${whole(r.overBound)} |`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { readFileSync } = await import('node:fs');
  const load = (f: string) => JSON.parse(readFileSync(new URL(`../packages/web/src/data/${f}.json`, import.meta.url), 'utf8'));
  const first = load('benchmark'), second = load('benchmark-v2'), third = load('benchmark-v3');
  const head = '| Rulebook | Value kept / day | Stolen / day | Honest access | New stores refused | Step-ups / 100 | Held $·hours | Sleeper stolen | Sleeper profit |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |';
  console.log(`### Round three\n\n${head}\n${armRows(third).join('\n')}\n\n### Round two\n\n${head}\n${armRows(second).join('\n')}\n\n### Round one\n\n${head}\n${armRows(first).join('\n')}\n`);
  console.log(`### Held out\n\n| Mechanism | No defense | v1, blind | v2 | v3 | Attacker profit under v3 |\n| --- | --- | --- | --- | --- | --- |\n${heldRows(third, first).join('\n')}\n`);
  console.log(`### Adaptive\n\n| Attacker | Tries | Profit before | Profit after | Stolen after | Over the bound |\n| --- | --- | --- | --- | --- | --- |\n${adaptiveRows(third).join('\n')}`);
}
