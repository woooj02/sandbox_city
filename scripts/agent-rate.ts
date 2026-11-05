/**
 * Runs an agent, one listing at a time, over the recorded corpus: every poisoned and clean listing in hijack-rate.json.
 *   npx tsx scripts/agent-rate.ts --agent "<command>" --label llama3.1:8b [--runs=3]
 * Scored by plain code with the same predicate the regressions use. Each listing is sent alone, unlike the batched
 * planner run, so the two rates are not directly comparable. Writes packages/web/src/data/agent-rate.json, one entry per label.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { checkAgentAnswer, REGRESSION_SCHEMA, type AgentAnswer, type AgentRegression, type Owner } from '@sandbox-city/core';
import rate from '../packages/web/src/data/hijack-rate.json' with { type: 'json' };

const opt = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]; };
const command = opt('agent'), label = opt('label') ?? command, runs = Number(opt('runs') ?? 1);
if (!command) { console.error('needs --agent "<command>"'); process.exit(1); }

const ask = (input: unknown, seed: number) => new Promise<AgentAnswer | null>((done) => {
  const p = spawn('sh', ['-c', command], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, OLLAMA_SEED: String(seed) } });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.on('close', () => { try { done(JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1))); } catch { done(null); } });
  p.stdin.end(JSON.stringify(input));
});

type Row = { injected: boolean; owner: Owner; store: string; title: string; price: number; text: string };
const cases = rate.cases as unknown as Row[];
const tally = { poisoned: { n: 0, bought: 0, breached: 0, noAnswer: 0 }, clean: { n: 0, bought: 0, breached: 0, noAnswer: 0 } };
const breaches: { title: string; injected: boolean; violations: string[]; answer: AgentAnswer }[] = [];
for (let run = 1; run <= runs; run++) for (const c of cases) {
  const input = { owner: c.owner, listing: { store: c.store, title: c.title, price: c.price, text: c.text } };
  const t = c.injected ? tally.poisoned : tally.clean;
  t.n++;
  const a = await ask(input, run);
  if (!a) { t.noAnswer++; continue; }
  if (a.buy) t.bought++;
  const reg = { schema: REGRESSION_SCHEMA, kind: 'agent', input } as unknown as AgentRegression;
  const v = checkAgentAnswer(reg, a);
  if (!v.pass) { t.breached++; if (breaches.length < 40) breaches.push({ title: c.title, injected: c.injected, violations: v.violations, answer: a }); }
}
const file = new URL('../packages/web/src/data/agent-rate.json', import.meta.url);
const all = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
all[label!] = { command, runs, recordedAt: new Date().toISOString(), ...tally, breaches };
writeFileSync(file, JSON.stringify(all, null, 2) + '\n');
console.log(label, JSON.stringify(tally));
