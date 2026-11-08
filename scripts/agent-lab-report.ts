/**
 * Turns an agent lab run into its report. A held-out report checks the frozen harness first and refuses a partial run.
 *   npx tsx scripts/agent-lab-report.ts <run.jsonl> [--write]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { ARMS, type Episode } from '../packages/server/src/agent-lab/shop.ts';
import { analyse, missing } from '../packages/server/src/agent-lab/report.ts';
import { corpus } from '../packages/server/src/agent-lab/tasks.ts';

const file = process.argv[2], write = process.argv.includes('--write');
const rows = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Episode);
const r = analyse(rows, ARMS);
const sha = (p: string) => createHash('sha256').update(readFileSync(new URL(p, import.meta.url))).digest('hex').slice(0, 16);

if (write) {
  const protocol = readFileSync(new URL('../evidence/round-five-protocol.md', import.meta.url), 'utf8');
  for (const [, path, hash] of protocol.matchAll(/^\| `([^`]+)` \| `([0-9a-f]{16})` \|$/gm).map((m) => [m[0], m[1], m[2]])) if (sha(`../${path}`) !== hash) throw new Error(`${path} changed after the freeze`);
  const tasks = corpus('heldout', 2, 32).map((t) => t.id), gap = missing(rows, r.models, ARMS, tasks);
  if (gap.length) throw new Error(`${gap.length} episodes are missing, first ${gap[0]}`);
  writeFileSync(new URL('../packages/web/src/data/agent-lab.json', import.meta.url), JSON.stringify({ schema: 'sandbox-city/agent-lab@1', protocol: sha('../evidence/round-five-protocol.md'), episodes: rows.length, ...r }, null, 1) + '\n');
}
for (const a of r.arms) console.log(`${a.arm.padEnd(12)} attack ${String(a.attack).padStart(4)} loss/100 $${String(a.lossPer100).padStart(9)} ${a.vsBare ? `vs bare ${a.vsBare.loss.mean} [${a.vsBare.loss.lo}, ${a.vsBare.loss.hi}]` : ''} | honest ${a.honestBought}/${a.honest} ${a.vsBare ? `[${a.vsBare.honest.lo}, ${a.vsBare.honest.hi}]` : ''} ${a.helps ? 'HELPS' : ''} ${a.usable ? '' : 'NOT USABLE'}`);
console.log(`injection effect per 100: ${r.injection.mean} [${r.injection.lo}, ${r.injection.hi}] | breaches past a gate ${r.gateBreaches} | pick ${r.pick}`);
