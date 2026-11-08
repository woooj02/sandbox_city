/**
 * Runs real local models through the sandboxed shop. Appends one line per episode, and resumes where it stopped.
 *   npx tsx scripts/agent-lab.ts --split=dev --models=llama3.1:8b --arms=bare,gate --reps=1 --honest=6 --out=<file.jsonl>
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import type { Policy } from '@sandbox-city/core';
import { runEpisode } from '../packages/server/src/agent-lab/agent.ts';
import { ARMS, type Arm, type Episode, type LabTask } from '../packages/server/src/agent-lab/shop.ts';
import { corpus } from '../packages/server/src/agent-lab/tasks.ts';

const opt = (n: string, d?: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const split = opt('split', 'dev') as LabTask['split'], out = opt('out')!, temperature = Number(opt('temperature', '0.7'));
const models = opt('models', 'llama3.1:8b')!.split(','), arms = (opt('arms') ? opt('arms')!.split(',') : ARMS) as Arm[];
const tasks = corpus(split, Number(opt('reps', '1')), Number(opt('honest', '6'))), limit = Number(opt('limit', '0'));
const rulebook = JSON.parse(readFileSync(new URL('../evidence/frozen-v4.json', import.meta.url), 'utf8')).policy as Policy;
const done = new Set(existsSync(out) ? readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => { const e = JSON.parse(l) as Episode; return `${e.model}|${e.arm}|${e.task}`; }) : []);
const match = opt('match', '')!, picked = tasks.filter((t) => t.id.includes(match));
const list = limit ? picked.filter((_t, i) => i % Math.ceil(picked.length / limit) === 0) : picked;
console.log(`${list.length} tasks x ${arms.length} arms x ${models.length} models, ${done.size} already done`);
for (const model of models) for (const [i, task] of list.entries()) for (const arm of arms) {
  if (done.has(`${model}|${arm}|${task.id}`)) continue;
  const t = Date.now();
  try {
    const e = await runEpisode(task, arm, rulebook, { model, temperature, seed: 1000 + i });
    appendFileSync(out, JSON.stringify(e) + '\n');
    if (process.argv.includes('--verbose')) console.log(model, arm, task.id, e.outcome, `$${e.loss}`, `${e.steps} steps`, `${Date.now() - t}ms`);
  } catch (err) { console.error(model, arm, task.id, (err as Error).message); }
}
console.log('finished');
