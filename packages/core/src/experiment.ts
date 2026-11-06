/**
 * The experiment contract: which days are for tuning, which are for testing, what a day measures and how two
 * rulebooks are compared. Everything the benchmark reports goes through here, so a number can be rerun and checked.
 *
 * Rules of the protocol:
 *  - Tuning only ever sees TRAIN_SEEDS on the development world.
 *  - The defense is frozen by hash (frozen.json) before anything on TEST_SEEDS is read.
 *  - The day, not the order, is the unit of uncertainty: orders inside a day interact.
 *  - Every comparison is paired: both rulebooks face the same city, shoppers and attackers.
 */
import { World, DEFAULT_CONFIG, type WorldConfig } from './world';
import { policyId, PRESETS, type Policy } from './policy';
import { Rng, round2 } from './rng';
import { COHORTS, type AttackKind, type Cohort } from './types';

export const TRAIN_SEEDS = ['dev-1', 'dev-2', 'dev-3', 'dev-4'];
export const TEST_SEEDS = Array.from({ length: 30 }, (_, i) => `test-${String(i + 1).padStart(2, '0')}`);

/** Fresh days for the second frozen rulebook: the test days above were read to decide what to repair. */
export const FINAL_SEEDS = Array.from({ length: 30 }, (_, i) => `final-${String(i + 1).padStart(2, '0')}`);

/** Fresh days for the third frozen rulebook: the final days above were read and showed the empty-box repair had failed. */
export const LAST_SEEDS = Array.from({ length: 30 }, (_, i) => `last-${String(i + 1).padStart(2, '0')}`);

/** Fresh days for round four, declared in evidence/round-four.md: same safeguards on every arm, corrected value measure. */
export const FAIR_SEEDS = Array.from({ length: 30 }, (_, i) => `fair-${String(i + 1).padStart(2, '0')}`);

/** The world the defense is developed on: the six stock attack families, three sleeper stores and five honest rising stores. */
export const DEV_WORLD: Partial<WorldConfig> = {
  crypto: 'modeled',
  attackers: { ...DEFAULT_CONFIG.attackers, sleeper_store: 3 },
  rising: 5,
};

/** Round two: the two tricks that beat the first rulebook are now development data. Subscription and triangulation are not. */
export const DEV_WORLD_V2: Partial<WorldConfig> = { ...DEV_WORLD, genomes: { sleeper_store: { wash: 0.5, emptyBox: 0.5 } } };

/** Baselines the audit asked for, written down before any test day was read. */
export const BASELINES: Record<string, Policy> = {
  open: PRESETS.open,
  /** The rule most teams ship first: an amount cap and a rate limit. */
  simple: { ...PRESETS.open, name: 'Simple limits', newAgentCap: 150, velocity: 6, idempotencyKeys: true },
  /** Block anything unproven. */
  fortress: PRESETS.fortress,
  /** The best rulebook before this round of work. */
  tuned: PRESETS.tuned,
  /** A competent hand-written answer to the sleeper store. */
  expert: { ...PRESETS.tuned, name: 'Hand-written', exposureRatio: 0.5, exposureFloor: 300 },
};

/**
 * Mechanisms the defense never saw while it was tuned. Written after frozen.json was committed to disk.
 * The same author wrote the attacks and the defense, so this holds out the mechanism, not the author's knowledge.
 */
export const HELD_OUT: Record<string, { label: string; blindSpot: string; world: Partial<WorldConfig> }> = {
  wash: {
    label: 'Wash warm-up', blindSpot: 'A store buys its own record with its own agents, so delivered value stops meaning customers served.',
    world: { ...DEV_WORLD, genomes: { sleeper_store: { wash: 0.95 } } },
  },
  empty_box: {
    label: 'Empty box', blindSpot: 'A turned store ships empty parcels. The carrier scan is real, so a hold that trusts the scan releases the money.',
    world: { ...DEV_WORLD, genomes: { sleeper_store: { emptyBox: 0.95 } } },
  },
  subscription: {
    label: 'Subscription trap', blindSpot: 'A listing talks agents into small repeat orders to the owner\'s own address, each one inside every limit.',
    world: { ...DEV_WORLD, attackers: { ...DEV_WORLD.attackers, subscription_trap: 3 } },
  },
  triangulation: {
    label: 'Triangulation', blindSpot: 'A store delivers real goods bought with stolen cards. Everything the gate can see looks like a healthy store.',
    world: { ...DEV_WORLD, attackers: { ...DEV_WORLD.attackers, triangulation: 3 } },
  },
};

export interface DayResult {
  seed: string;
  stolen: number; fulfilled: number; kept: number; gmv: number;
  /** Share of honest attempts that completed, and honest $ refused by the rules. */
  access: number; refusedValue: number;
  challenged: number; orders: number;
  /** Unrounded, for gates that sit near a threshold: share of attempted fraud dollars stopped. */
  safety: number;
  /** Honest money held waiting on a scan, in dollar-hours. */
  heldDollarHours: number;
  duplicates: number;
  /** Per attack family: stolen, and the books after costs. */
  attacks: Record<string, { leaked: number; take: number; cost: number; profit: number }>;
  cohorts: Record<Cohort, { attempts: number; refused: number; refusedValue: number }>;
  exposurePeak: number; overBound: number;
}

export async function runDay(policy: Policy, seed: string, world: Partial<WorldConfig> = DEV_WORLD): Promise<DayResult> {
  const w = new World({ ...DEFAULT_CONFIG, ...world, seed, policy, liveRails: undefined });
  await w.run();
  const m = await w.settle();
  const attacks: DayResult['attacks'] = {};
  for (const k of Object.keys(m.attackers) as AttackKind[]) {
    const b = m.attackers[k];
    attacks[k] = { leaked: round2(m.fraud.byKind[k].leaked), take: b.take, cost: b.cost, profit: round2(b.take - b.cost) };
  }
  const cohorts = Object.fromEntries(COHORTS.map((c) => [c, { attempts: m.cohorts[c].attempts, refused: m.cohorts[c].refused, refusedValue: m.cohorts[c].refusedValue }])) as DayResult['cohorts'];
  return {
    seed, stolen: m.fraud.leaked, fulfilled: m.honest.fulfilledValue, kept: round2(m.honest.fulfilledValue - m.fraud.leaked - m.chaos.duplicateValue), gmv: m.honest.gmv,
    access: m.access, safety: m.safety, refusedValue: round2(m.honest.blockedValue + m.honest.abandonedValue), challenged: m.honest.challenged, orders: m.orders,
    heldDollarHours: round2(m.honest.heldDollarMinutes / 60), duplicates: m.chaos.duplicateValue, attacks, cohorts,
    exposurePeak: m.exposure.peak, overBound: m.exposure.worstOverBound,
  };
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export interface Interval { mean: number; lo: number; hi: number }

/** Percentile bootstrap over days, seeded so the interval itself replays. */
export function bootstrap(xs: number[], seed = 'bootstrap', resamples = 2000): Interval {
  const r = new Rng(seed), n = xs.length, means: number[] = [];
  for (let b = 0; b < resamples; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += xs[r.int(0, n - 1)];
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  return { mean: round2(mean(xs)), lo: round2(means[Math.floor(resamples * 0.025)]), hi: round2(means[Math.ceil(resamples * 0.975) - 1]) };
}

/** a minus b, day by day, on the same days. An interval that excludes zero is a difference the days support. */
export function pairedDifference(a: number[], b: number[], seed?: string): Interval {
  if (a.length !== b.length) throw new Error('paired comparison needs the same days');
  return bootstrap(a.map((x, i) => x - b[i]), seed);
}

export interface Arm { key: string; name: string; policy: string; days: DayResult[] }

export async function runArm(key: string, policy: Policy, seeds: string[], world?: Partial<WorldConfig>): Promise<Arm> {
  const days: DayResult[] = [];
  for (const s of seeds) days.push(await runDay(policy, s, world));
  return { key, name: policy.name, policy: policyId(policy), days };
}
