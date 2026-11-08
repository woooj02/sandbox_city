/**
 * Enumerates fault schedules against the real payment worker. See packages/server/src/fault-explorer.ts.
 *   npx tsx scripts/fault-explore.ts [--faults=3] [--write]
 * --write records the result in packages/web/src/data/fault-proof.json.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { explore, exploreNaive, WORKLOADS, type WorkloadReport } from '../packages/server/src/fault-explorer.ts';
import { MUTANTS } from '../packages/server/src/fault-mutants.ts';

const opt = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const faults = Number(opt('faults') ?? 3);
const dir = join(existsSync('/dev/shm') ? '/dev/shm' : tmpdir(), `sandbox-city-faults-${process.pid}`);
const workloads: (WorkloadReport & { ms: number })[] = [];
for (const w of WORKLOADS) {
  const t = Date.now();
  const r = { ...await explore(w, faults, dir), ms: Date.now() - t };
  workloads.push(r);
  console.log(`${r.workload}: ${r.schedules} schedules, ${r.violating} broke a promise, ${r.unresolved} unresolved`, r.outcomes);
  for (const [why, n] of Object.entries(r.reasons)) console.log(`    ${n} x ${why}`);
  if (r.firstViolation) console.log('    FIRST', r.firstViolation.faults.join(' -> '), '=>', r.firstViolation.violations.join('; '));
}
const mutants = [];
for (const m of MUTANTS) {
  const w = WORKLOADS.find((x) => x.name === m.workload)!;
  const r = await explore(w, faults, dir, { Worker: m.Worker, Journal: m.Journal, stopAtFirst: true });
  mutants.push({ name: m.name, workload: m.workload, caught: r.violating > 0, schedules: r.schedules, faults: r.firstViolation?.faults ?? [], violations: r.firstViolation?.violations ?? [] });
  console.log(`mutant "${m.name}": ${r.violating ? `caught after ${r.schedules} schedules by ${r.firstViolation!.faults.join(' -> ') || 'no fault at all'} => ${r.firstViolation!.violations[0]}` : `SURVIVED ${r.schedules} schedules`}`);
}
const control = await exploreNaive(faults);
console.log('no-journal control:', control);
rmSync(dir, { recursive: true, force: true });
if (process.argv.includes('--write')) {
  const total = workloads.reduce((a, r) => a + r.schedules, 0);
  writeFileSync(new URL('../packages/web/src/data/fault-proof.json', import.meta.url), JSON.stringify({
    schema: 'sandbox-city/fault-proof@1', maxFaults: faults, schedules: total, violating: workloads.reduce((a, r) => a + r.violating, 0),
    unresolved: workloads.reduce((a, r) => a + r.unresolved, 0), workloads, mutants, control, provider: 'in-process model of PayPal, not PayPal',
  }, null, 2) + '\n');
}
