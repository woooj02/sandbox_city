/**
 * Records the model shoppers' tape for one seed (pass `tape` to add another day to an existing one). The engine never waits on the model: each pass plays the day
 * under every preset with the tape so far, collects the cases nobody has answered yet, sends them to the model
 * in batches, and plays again until every case a shopper meets has an answer.
 */
import { BRAIN_PROMPTS, DEFAULT_CONFIG, PRESETS, World, brainPrompt, parseChoices, type BrainCase, type BrainPrompt, type BrainTape, type Genomes, type Policy } from '@sandbox-city/core';

export interface RecordOptions {
  seed: string;
  chaos?: number;
  shoppers?: number;
  policies?: Policy[];
  genomes?: Genomes;
  model: string;
  /** Standing instructions to record under (default plain). */
  prompt?: BrainPrompt;
  chat: (system: string, user: string) => Promise<string>;
  batch?: number;
  maxPasses?: number;
  tape?: BrainTape;
  log?: (line: string) => void;
}

export async function recordTape(o: RecordOptions): Promise<BrainTape & { misses: number; calls: number }> {
  const prompt = o.prompt ?? 'plain';
  const tape: BrainTape = {
    model: o.model, prompt, recordedAt: new Date().toISOString(),
    seeds: [...new Set([...(o.tape?.seeds ?? []), o.seed])], choices: { ...(o.tape?.choices ?? {}) },
  };
  const policies = o.policies ?? Object.values(PRESETS);
  const shoppers = o.shoppers ?? DEFAULT_CONFIG.shoppers;
  const batch = o.batch ?? 16;
  let calls = 0, misses = 0;
  for (let pass = 1; pass <= (o.maxPasses ?? 6); pass++) {
    const open = new Map<string, BrainCase>();
    for (const policy of policies) {
      const w = new World({ ...DEFAULT_CONFIG, seed: o.seed, chaos: o.chaos ?? DEFAULT_CONFIG.chaos, shoppers, crypto: 'modeled', policy, genomes: o.genomes, brain: { shoppers, tape: tape.choices } });
      await w.run();
      for (const [k, c] of w.brainMisses) open.set(k, c);
    }
    misses = open.size;
    o.log?.(`pass ${pass}: ${open.size} unanswered case${open.size === 1 ? '' : 's'}`);
    if (!open.size) break;
    const cases = [...open.values()];
    for (let i = 0; i < cases.length; i += batch) {
      const chunk = cases.slice(i, i + batch);
      const got = parseChoices(await o.chat(BRAIN_PROMPTS[prompt], brainPrompt(chunk)), chunk);
      calls++;
      Object.assign(tape.choices, got);
      o.log?.(`  call ${calls}: ${Object.keys(got).length}/${chunk.length} answered`);
    }
  }
  return { ...tape, misses, calls };
}
