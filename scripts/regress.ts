/**
 * Runs portable regressions.
 *   npx tsx scripts/regress.ts [case.json | dir] [--agent "<command>"] [--json]
 * Agent cases need --agent: any command that reads a case as JSON on stdin and prints {"buy", "qty", "ship_to"}.
 * Gate and day cases need nothing. Exits 1 if any case fails, so it fits in CI.
 */
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { checkAgentAnswer, checkDayCase, checkGateCase, REGRESSION_SCHEMA, type AgentAnswer, type AgentRegression, type CaseResult, type Regression } from '@sandbox-city/core';

const args = process.argv.slice(2);
const flagAt = args.indexOf('--agent');
const agent = flagAt >= 0 ? args[flagAt + 1] : undefined;
const asJson = args.includes('--json');
const target = args.find((a, i) => !a.startsWith('--') && i !== flagAt + 1 || (flagAt < 0 && !a.startsWith('--'))) ?? 'regressions';
const files = statSync(target).isDirectory() ? readdirSync(target).filter((f) => f.endsWith('.json')).sort().map((f) => join(target, f)) : [target];

export function askAgent(command: string, input: unknown): Promise<AgentAnswer> {
  return new Promise((resolve, reject) => {
    const p = spawn('sh', ['-c', command], { stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`the agent exited with ${code}`));
      try { resolve(JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1))); } catch { reject(new Error(`the agent printed something that is not JSON: ${out.slice(0, 120)}`)); }
    });
    p.stdin.end(JSON.stringify(input));
  });
}

async function runCase(c: Regression): Promise<CaseResult & { skipped?: boolean; answer?: AgentAnswer }> {
  if (c.schema !== REGRESSION_SCHEMA) return { pass: false, violations: [`unknown schema ${c.schema}`] };
  if (c.kind === 'gate') return checkGateCase(c);
  if (c.kind === 'day') return checkDayCase(c);
  if (!agent) return { pass: true, violations: [], skipped: true };
  const answer = await askAgent(agent, (c as AgentRegression).input);
  return { ...checkAgentAnswer(c, answer), answer };
}

const results = [];
for (const f of files) {
  const c = JSON.parse(readFileSync(f, 'utf8')) as Regression;
  const r = await runCase(c);
  results.push({ id: c.id, kind: c.kind, ...r });
  if (!asJson) {
    console.log(`${r.skipped ? '–' : r.pass ? '✓' : '✕'} ${c.kind.padEnd(5)} ${c.id}${r.skipped ? '  (needs --agent)' : ''}`);
    for (const v of r.violations) console.log(`        ${v}`);
  }
}
const failed = results.filter((r) => !r.pass).length, ran = results.filter((r) => !r.skipped).length;
if (asJson) console.log(JSON.stringify(results, null, 2));
else console.log(`\n${ran - failed} of ${ran} passed${results.length > ran ? `, ${results.length - ran} need an agent` : ''}.`);
process.exit(failed ? 1 : 0);
