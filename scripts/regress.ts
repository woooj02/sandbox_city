/**
 * Runs portable regressions, and says what they mean for a release.
 *   npx tsx scripts/regress.ts [case.json | dir] [--agent "<command>" | --agent-url <url>] [--kind=agent] [--timeout=60] [--report=out.md] [--json]
 * Agent cases need an agent: a command that reads a case as JSON on stdin and prints {"buy", "qty", "ship_to"},
 * or an HTTP endpoint that takes the same JSON as a POST and answers with the same object.
 * Gate and day cases need nothing. Exits 1 if the run should block a release, so it fits in CI.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { agentVerdict, checkAgentAnswer, checkDayCase, checkGateCase, REGRESSION_SCHEMA, type AgentRegression, type AgentRow, type CaseResult, type Regression } from '@sandbox-city/core';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
function configurationError(message: string): never {
  if (asJson) console.log(JSON.stringify({ verdict: null, results: [], blocked: true, problems: [message] }, null, 2));
  else console.error(`BLOCK THIS RELEASE: ${message}`);
  process.exit(1);
}
const { values, positionals } = (() => {
  try {
    return parseArgs({ args, allowPositionals: true, options: {
      agent: { type: 'string' }, 'agent-url': { type: 'string' }, kind: { type: 'string' },
      timeout: { type: 'string' }, report: { type: 'string' }, json: { type: 'boolean' },
    } });
  } catch (e) { return configurationError(e instanceof Error ? e.message : String(e)); }
})();
const { agent, 'agent-url': agentUrl, kind, report } = values;
if (kind !== undefined && !['agent', 'gate', 'day'].includes(kind)) configurationError(`Unknown kind "${kind}". Use agent, gate or day.`);
if (positionals.length > 1) configurationError('Give one case file or folder.');
if (agent !== undefined && !agent.trim() || agentUrl !== undefined && !agentUrl.trim()) configurationError('The agent command or URL must not be blank.');
if (agent && agentUrl) configurationError('Choose either --agent or --agent-url.');
const timeoutMs = Number(values.timeout ?? 60) * 1000;
if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) configurationError('--timeout must be a positive number of seconds, at most 2147483.647.');
const target = positionals[0] ?? 'regressions';
const files = statSync(target).isDirectory() ? readdirSync(target).filter((f) => f.endsWith('.json')).sort().map((f) => join(target, f)) : [target];

const parseAnswer = (out: string): unknown => {
  try { return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)); } catch { throw new Error(`the agent printed something that is not JSON: ${out.slice(0, 120).trim() || '(nothing)'}`); }
};

function askCommand(command: string, input: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const p = spawn('sh', ['-c', command], { stdio: ['pipe', 'pipe', 'inherit'] });
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`the agent gave no answer in ${timeoutMs / 1000}s`)); }, timeoutMs);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stdin.on('error', () => undefined); // an agent that quits without reading is reported by its exit code
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`the agent exited with ${code}`));
      try { resolve(parseAnswer(out)); } catch (e) { reject(e); }
    });
    p.stdin.end(JSON.stringify(input));
  });
}

async function askUrl(url: string, input: unknown): Promise<unknown> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`the agent answered HTTP ${res.status}`);
  return parseAnswer(await res.text());
}

const ask = (input: unknown) => (agentUrl ? askUrl(agentUrl, input) : askCommand(agent as string, input));

type Result = CaseResult & { skipped?: boolean; answer?: unknown };

async function runCase(c: Regression): Promise<Result> {
  if (c.schema !== REGRESSION_SCHEMA) return { pass: false, violations: [`unknown schema ${c.schema}`] };
  if (c.kind === 'gate') return checkGateCase(c);
  if (c.kind === 'day') return checkDayCase(c);
  if (!agent && !agentUrl) return { pass: true, violations: [], skipped: true };
  try {
    const answer = await ask((c as AgentRegression).input);
    return { ...checkAgentAnswer(c as AgentRegression, answer), answer };
  } catch (e) {
    // one bad call is that case's result, not the end of the run
    return { pass: false, invalid: true, violations: [e instanceof Error ? e.message : String(e)], fixes: ['Make the agent answer every case: exit 0 and print one JSON object.'] };
  }
}

const mark = (r: Result, control?: boolean) => (r.skipped ? '–' : r.invalid ? '?' : !r.pass ? '✕' : r.declined && control ? '!' : '✓');
const results: (Result & { id: string; kind: string; title: string; control?: boolean })[] = [];
for (const f of files) {
  const c = JSON.parse(readFileSync(f, 'utf8')) as Regression;
  if (kind && c.kind !== kind) continue;
  const r = await runCase(c);
  const control = c.kind === 'agent' ? c.control : undefined;
  results.push({ id: c.id, kind: c.kind, title: c.title, control, ...r });
  if (asJson) continue;
  console.log(`${mark(r, control)} ${c.kind.padEnd(5)} ${c.id}${r.skipped ? '  (needs --agent)' : r.declined && control ? '  (declined an honest listing)' : ''}`);
  for (const v of r.violations) console.log(`        ${v}`);
  for (const x of new Set(r.fixes)) console.log(`        fix: ${x}`);
}

const ranAgent = results.filter((r) => r.kind === 'agent' && !r.skipped);
const agentRun = kind === 'agent' || !!agent || !!agentUrl || ranAgent.length > 0;
const verdict = agentRun ? agentVerdict(ranAgent as AgentRow[]) : null;
const otherFailed = results.filter((r) => r.kind !== 'agent' && !r.pass).length;
const failed = results.filter((r) => !r.pass).length, ran = results.filter((r) => !r.skipped).length;
const problems: string[] = [];
if (!ran) problems.push('No cases were executed. Check the folder, --kind and agent command.');
if (kind === 'agent' && !agent && !agentUrl) problems.push('Agent cases need --agent "<command>" or --agent-url <url>.');
const blocked = verdict?.verdict === 'block' || otherFailed > 0 || problems.length > 0;
const LABEL = { block: 'BLOCK THIS RELEASE', review: 'REVIEW BEFORE RELEASE', pass: 'NO FAILURE FOUND' };

function markdown() {
  const v = verdict;
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const rows = ranAgent.map((r) => {
    const what = r.declined ? (r.control ? 'Declined an honest listing' : 'Declined') : r.pass ? (r.control ? 'Bought it' : 'Kept to the mandate') : r.violations.join('; ');
    return `| ${mark(r, r.control)} | ${cell(r.title)} | ${cell(what)} | ${cell([...new Set(r.fixes)].join(' '))} |`;
  });
  return [
    `## Regressions: ${blocked ? LABEL.block : v ? LABEL[v.verdict] : LABEL.pass}`, '',
    ...problems.map((p) => `- ${p}`), ...(v ? [v.why, '',
      `- Attack listings: ${v.attacks}, breaches: ${v.breaches}, unjudged answers: ${v.invalid}`,
      `- Honest listings bought: ${v.cleanBought} of ${v.cleanTotal}`] : []),
    `- Cases executed: ${ran}; failed: ${failed}`, '',
    '| | Case | What the agent did | Fix |', '| --- | --- | --- | --- |', ...rows, '',
    'Checked by plain code against the owner\'s mandate, no model. A clean run covers these cases only.', '',
  ].join('\n');
}

if (asJson) console.log(JSON.stringify({ verdict, results, blocked, problems }, null, 2));
else {
  console.log(`\n${ran - failed} of ${ran} passed${results.length > ran ? `, ${results.length - ran} need an agent` : ''}.`);
  if (verdict) console.log(`${LABEL[verdict.verdict]}: ${verdict.why}\nHonest listings bought: ${verdict.cleanBought} of ${verdict.cleanTotal}.`);
  for (const problem of problems) console.log(`${LABEL.block}: ${problem}`);
}
if (report) writeFileSync(report, markdown());
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown());
process.exit(blocked ? 1 : 0);
