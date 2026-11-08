/**
 * Differential fuzzing of the checkout gate. See packages/core/src/gate-fuzz.ts.
 *   npx tsx scripts/gate-fuzz.ts [--runs=200000] [--seed=gate-fuzz-2] [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fuzzGate } from '../packages/core/src/gate-fuzz.ts';
import { policyId, type Policy } from '@sandbox-city/core';

const opt = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const runs = Number(opt('runs') ?? 200000), seed = opt('seed') ?? 'gate-fuzz-1';
const books = ['frozen-v3', 'frozen-v4'].map((n) => JSON.parse(readFileSync(new URL(`../evidence/${n}.json`, import.meta.url), 'utf8')).policy as Policy);
const out = [];
for (const b of books) {
  const r = fuzzGate(b, runs, seed);
  out.push({ rulebook: b.name, policy: policyId(b), ...r });
  console.log(`${b.name}: ${r.runs} orders, ${r.allowed} allowed, ${r.refused} refused, ${r.unsound} unsound, ${r.refusedGood} honest refused, ${r.threw} threw`);
  for (const f of r.findings.slice(0, Number(opt('show') ?? 14))) console.log(`  ${f.kind} [${f.mutations.join(' + ')}] ${f.reference.join(', ')} | gate: ${f.gate}\n     ${f.args.slice(0, 230)}`);
}
if (process.argv.includes('--write')) writeFileSync(new URL('../packages/web/src/data/gate-fuzz.json', import.meta.url), JSON.stringify({ schema: 'sandbox-city/gate-fuzz@1', seed, rulebooks: out }, null, 2) + '\n');
