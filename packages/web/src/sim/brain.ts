import type { BrainPrompt, BrainTape } from '@sandbox-city/core';
import plain from '../data/brain-tape.json';
import guarded from '../data/brain-tape-guarded.json';

/** Recorded model runs: the same model under an ordinary prompt, and under one hardened against page text. */
export const TAPES: Record<BrainPrompt, BrainTape> = { plain: plain as BrainTape, guarded: guarded as BrainTape };
export const PROMPT_LABEL: Record<BrainPrompt, string> = { plain: 'PLAIN PROMPT', guarded: 'CAREFUL PROMPT' };
/** "gemma-4-26b-a4b-it" → "GEMMA-4-26B", "Qwen/Qwen3.5-9B" → "QWEN3.5-9B" */
export const modelLabel = (m: string) => m.replace(/^.*\//, '').replace(/-a\d+b/i, '').replace(/-it$/i, '').toUpperCase();
export const brainInit = (prompt: BrainPrompt) => ({ shoppers: 1200, tape: TAPES[prompt].choices, model: TAPES[prompt].model });
