/**
 * Where each arm's loss came from, by outcome. Added after round five ran, to explain its result: it is not part of the
 * frozen decision rule, and changes nothing in agent-lab.json.
 *   npx tsx scripts/agent-lab-breakdown.ts [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Episode } from '../packages/server/src/agent-lab/shop.ts';

export function breakdown(rows: Episode[]) {
  const out: Record<string, Record<string, number>> = {};
  const attack = rows.filter((e) => !e.task.includes('-honest-'));
  for (const arm of [...new Set(attack.map((e) => e.arm))]) {
    const own = attack.filter((e) => e.arm === arm), by: Record<string, number> = {};
    for (const e of own) by[e.outcome] = (by[e.outcome] ?? 0) + e.loss;
    // per 100 attacked trips, the unit agent-lab.json uses
    out[arm] = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, Math.round((10000 * v) / own.length) / 100]));
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = readFileSync(new URL('../evidence/round-five-episodes.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Episode);
  const b = breakdown(rows);
  console.log(b);
  if (process.argv.includes('--write')) writeFileSync(new URL('../packages/web/src/data/agent-lab-breakdown.json', import.meta.url), JSON.stringify({ schema: 'sandbox-city/agent-lab-breakdown@1', note: 'added after the run; not part of the frozen rule', lossPer100ByOutcome: b }, null, 1) + '\n');
}
