/**
 * Records how a language model shops, so the twin can replay it without a key.
 *   GEMINI_API_KEY=... npx tsx scripts/record-brain.ts [--prompt=plain|guarded] [--seeds=a,b,c]
 * Any provider with a chat-completions endpoint works: set LLM_BASE_URL, LLM_MODEL and LLM_API_KEY instead.
 * Default days: the film's seed plus the three training days auto-tune uses for it.
 * Writes packages/web/src/data/brain-tape.json (plain) or brain-tape-guarded.json, and adds to an existing tape
 * recorded with the same model and prompt, so an interrupted run picks up where it stopped.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { BrainPrompt, BrainTape } from '@sandbox-city/core';
import { llmClient, llmFromEnv } from '../packages/server/src/llm.ts';
import { recordTape } from '../packages/server/src/brain-record.ts';

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const cfg = llmFromEnv();
if (!cfg) { console.error('Set GEMINI_API_KEY (or LLM_API_KEY) first.'); process.exit(1); }
const prompt: BrainPrompt = arg('prompt') === 'guarded' ? 'guarded' : 'plain';
const base = 'neo-osaka-7';
const seeds = arg('seeds')?.split(',').filter(Boolean) ?? [base, `${base}~train-1`, `${base}~train-2`, `${base}~train-3`];
const file = new URL(`../packages/web/src/data/${prompt === 'plain' ? 'brain-tape' : 'brain-tape-guarded'}.json`, import.meta.url);

let tape: BrainTape | undefined;
if (existsSync(file)) {
  const old = JSON.parse(readFileSync(file, 'utf8')) as BrainTape & { seed?: string };
  if (old.model === cfg.model && (old.prompt ?? 'plain') === prompt) tape = { ...old, prompt, seeds: old.seeds ?? (old.seed ? [old.seed] : []) };
}

const t0 = Date.now();
let calls = 0, misses = 0;
for (const seed of seeds) {
  console.log(`day ${seed} (${prompt})`);
  const r = await recordTape({ seed, model: cfg.model, prompt, chat: llmClient(cfg), tape, log: (l) => console.log(l) });
  misses += r.misses;
  calls += r.calls;
  const { misses: _m, calls: _c, ...out } = r;
  tape = out;
  // saved after every day, so a stopped run keeps what it has
  writeFileSync(file, JSON.stringify({ model: tape.model, prompt: tape.prompt, recordedAt: tape.recordedAt, seeds: tape.seeds, choices: tape.choices }, null, 1) + '\n');
}
console.log(JSON.stringify({ model: cfg.model, prompt, seeds: tape?.seeds, cases: Object.keys(tape?.choices ?? {}).length, calls, unanswered: misses, seconds: Math.round((Date.now() - t0) / 1000) }));
process.exit(misses ? 2 : 0);
