/**
 * Counterfactual replays: the same city, shoppers and attackers on the same day, with only the
 * rulebook changed. Uses modeled crypto, which makes identical decisions to ed25519 (tested) and
 * runs much faster.
 */
import { World, DEFAULT_CONFIG, type WorldConfig } from './world';
import { PRESETS, type Policy } from './policy';
import type { Metrics } from './types';
import { round2 } from './rng';

export interface DaySummary {
  key: string;
  name: string;
  stolen: number;
  duplicate: number;
  honestLost: number;
  gmv: number;
  net: number;
  safety: number;
  access: number;
  fraudAttempted: number;
  /** Honest value that was delivered and kept, the measure of commerce that finished. */
  fulfilled: number;
  /** Fulfilled value, minus money stolen, minus double charges. */
  kept: number;
}

export const summarize = (key: string, name: string, m: Metrics): DaySummary => ({
  key, name, stolen: m.fraud.leaked, duplicate: m.chaos.duplicateValue, honestLost: round2(m.honest.blockedValue + m.honest.abandonedValue),
  gmv: m.honest.gmv, net: m.netValue, safety: m.safety, access: m.access, fraudAttempted: m.fraud.prevented + m.fraud.leaked,
  fulfilled: m.honest.fulfilledValue, kept: round2(m.honest.fulfilledValue - m.fraud.leaked - m.chaos.duplicateValue),
});

export const samePolicy = (a: Policy, b: Policy) => {
  const strip = ({ name: _n, ...rest }: Policy) => JSON.stringify(Object.entries(rest).sort(([x], [y]) => x.localeCompare(y)));
  return strip(a) === strip(b);
};

export interface WhatIfInput { seed: string; chaos: number; shoppers?: number; mine: Policy[] }

const yieldNow = () => new Promise<void>((r) => setTimeout(r, 0));

/** Replays the day for each lane's own rulebook plus every preset not already covered. */
export async function whatIf(input: WhatIfInput, base: Partial<WorldConfig> = {}): Promise<{ mine: DaySummary[]; alternatives: DaySummary[] }> {
  const run = async (policy: Policy) => {
    const w = new World({ ...DEFAULT_CONFIG, ...base, seed: input.seed, chaos: input.chaos, shoppers: input.shoppers ?? DEFAULT_CONFIG.shoppers, crypto: 'modeled', policy, liveRails: undefined });
    const m = await w.run();
    await yieldNow();
    return m;
  };
  const mine: DaySummary[] = [];
  for (const [i, p] of input.mine.entries()) mine.push(summarize(`lane${i}`, p.name, await run(p)));
  const alternatives: DaySummary[] = [];
  for (const [key, p] of Object.entries(PRESETS)) {
    if (input.mine.some((q) => samePolicy(p, q))) continue;
    alternatives.push(summarize(key, p.name, await run(p)));
  }
  return { mine, alternatives };
}
