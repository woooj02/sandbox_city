/**
 * Records how a language model shops on the default day, so the twin can replay it without a key.
 *   GEMINI_API_KEY=... npx tsx scripts/record-brain.ts [seed]
 * Any provider with a chat-completions endpoint works: set LLM_BASE_URL, LLM_MODEL and LLM_API_KEY instead.
 * Writes packages/web/src/data/brain-tape.json.
 */
import { writeFileSync } from 'node:fs';
import { llmClient, llmFromEnv } from '../packages/server/src/llm.ts';
import { recordTape } from '../packages/server/src/brain-record.ts';

const cfg = llmFromEnv();
if (!cfg) { console.error('Set GEMINI_API_KEY (or LLM_API_KEY) first.'); process.exit(1); }
const seed = process.argv[2] ?? 'neo-osaka-7';
const t0 = Date.now();
const tape = await recordTape({ seed, model: cfg.model, chat: llmClient(cfg), log: (l) => console.log(l) });
const { misses, calls, ...out } = tape;
writeFileSync(new URL('../packages/web/src/data/brain-tape.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ model: cfg.model, cases: Object.keys(out.choices).length, calls, unanswered: misses, seconds: Math.round((Date.now() - t0) / 1000) }));
process.exit(misses ? 2 : 0);
