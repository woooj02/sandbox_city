/**
 * Attack forge: the red team. Attack genomes evolve against a fixed rulebook to find the
 * variants that steal the most. Attack families are scored separately (each one's own leaked $),
 * so every generation keeps, per family, whichever variant got the most past the gate.
 */
import { World, DEFAULT_CONFIG, type WorldConfig } from './world';
import { GENOME_SPACE, defaultGenome } from './genome';
import { ATTACK_KINDS, type AttackKind } from './types';
import type { Policy } from './policy';
import { Rng, round2, clamp } from './rng';

export type Genomes = Partial<Record<AttackKind, Record<string, number>>>;
export type KindHarm = Record<AttackKind, number>;

export interface ForgeOptions {
  policy: Policy;
  seeds: string[];
  chaos?: number;
  generations?: number;
  children?: number;
  seed?: string;
  world?: Partial<WorldConfig>;
  /** Tactics to start from (e.g. the last forge round's), defaults otherwise. */
  start?: Genomes;
}

export interface ForgeScore { genomes: Genomes; stolen: number; byKind: KindHarm; attempted: number }
export type ForgeEvent = { type: 'eval'; generation: number; evals: number; total: number; candidate: ForgeScore; best: ForgeScore; baseline: ForgeScore };
export interface ForgeResult { best: ForgeScore; baseline: ForgeScore; evals: number }

/** Attack frequency is the attacker's budget; the forge keeps it fixed and only searches tactics. */
const BUDGET = new Set(['interval']);

/** Genes that are counts or durations, not probabilities. */
const isInt = (lo: number, hi: number) => Number.isInteger(lo) && Number.isInteger(hi) && hi > 1;

export function mutateGenome(kind: AttackKind, g: Record<string, number>, r: Rng): Record<string, number> {
  const space = GENOME_SPACE[kind];
  const q = { ...g };
  const keys = Object.keys(space).filter((k) => !BUDGET.has(k));
  const n = 1 + r.int(0, 1);
  for (let i = 0; i < n; i++) {
    const k = r.pick(keys);
    const [lo, hi] = space[k];
    let v = r.chance(0.2) ? lo + r.next() * (hi - lo) : q[k] + (r.next() * 2 - 1) * 0.25 * (hi - lo);
    v = clamp(v, lo, hi);
    q[k] = isInt(lo, hi) ? Math.round(v) : round2(v);
  }
  return q;
}

export async function forgeAttacks(opts: ForgeOptions, onEvent?: (e: ForgeEvent) => void): Promise<ForgeResult> {
  const r = new Rng(opts.seed ?? 'forge');
  const gens = opts.generations ?? 6, kids = opts.children ?? 6;
  const total = 1 + gens * kids;
  let evals = 0;

  const score = async (genomes: Genomes): Promise<ForgeScore> => {
    const byKind = Object.fromEntries(ATTACK_KINDS.map((k) => [k, 0])) as KindHarm;
    let stolen = 0, attempted = 0;
    for (const seed of opts.seeds) {
      const w = new World({ ...DEFAULT_CONFIG, ...opts.world, seed, chaos: opts.chaos ?? DEFAULT_CONFIG.chaos, crypto: 'modeled', policy: opts.policy, liveRails: undefined, genomes });
      const m = await w.run();
      await new Promise<void>((res) => setTimeout(res, 0));
      stolen += m.fraud.leaked; attempted += m.fraud.attempted;
      for (const k of ATTACK_KINDS) byKind[k] += Math.max(0, m.fraud.byKind[k].leaked);
    }
    const d = opts.seeds.length;
    for (const k of ATTACK_KINDS) byKind[k] = round2(byKind[k] / d);
    evals++;
    return { genomes, stolen: round2(stolen / d), attempted: round2(attempted / d), byKind };
  };

  const start: Genomes = Object.fromEntries(ATTACK_KINDS.map((k) => [k, { ...defaultGenome(k), ...(opts.start?.[k] ?? {}) }]));
  const baseline = await score(start);
  // per-family champions: each family's genome and the $ it got through
  const champ = Object.fromEntries(ATTACK_KINDS.map((k) => [k, { g: start[k]!, harm: baseline.byKind[k] }])) as Record<AttackKind, { g: Record<string, number>; harm: number }>;
  const assemble = (): ForgeScore => {
    const genomes = Object.fromEntries(ATTACK_KINDS.map((k) => [k, champ[k].g])) as Genomes;
    const byKind = Object.fromEntries(ATTACK_KINDS.map((k) => [k, champ[k].harm])) as KindHarm;
    return { genomes, byKind, stolen: round2(ATTACK_KINDS.reduce((s, k) => s + champ[k].harm, 0)), attempted: 0 };
  };
  let best = { ...assemble(), attempted: baseline.attempted };
  onEvent?.({ type: 'eval', generation: 0, evals, total, candidate: baseline, best, baseline });

  for (let gen = 1; gen <= gens; gen++) {
    for (let i = 0; i < kids; i++) {
      // every family mutates at once; the day's per-family harm tells us which mutations paid off
      const child = Object.fromEntries(ATTACK_KINDS.map((k) => [k, mutateGenome(k, champ[k].g, r)])) as Genomes;
      const s = await score(child);
      for (const k of ATTACK_KINDS) if (s.byKind[k] > champ[k].harm) champ[k] = { g: child[k]!, harm: s.byKind[k] };
      best = { ...assemble(), attempted: s.attempted };
      onEvent?.({ type: 'eval', generation: gen, evals, total, candidate: s, best, baseline });
    }
  }
  // the champions were found in different days; score them together once so the total is honest
  const final = await score(best.genomes);
  return { best: final, baseline, evals };
}

export const GENE_LABEL: Record<string, string> = {
  'prompt_injection.qty': 'units the injected agent is told to buy', 'impersonation.qty': 'items per impersonated order',
  interval: 'minutes between waves', subtlety: 'injection subtlety', qty: 'quantity', discount: 'bait discount', verify: 'gets the store verified',
  cashout: 'cashes out at $', fakeTracking: 'fake tracking numbers', agents: 'agents', snad: '"not as described" claims', passport: 'passported agents',
  probes: 'probe charges', bigs: 'big orders', bigMin: 'big orders from $', replay: 'replays stolen signatures', raw: 'replays left untampered',
  size: 'ring members', washTicks: 'minutes laundering', bustTicks: 'minutes before bust-out',
};

/** What the forge changed in one attack family, largest moves first. */
export function describeGenome(kind: AttackKind, g: Record<string, number>): string[] {
  const d = defaultGenome(kind), space = GENOME_SPACE[kind];
  return Object.keys(space)
    .map((k) => ({ k, move: Math.abs(g[k] - d[k]) / (space[k][1] - space[k][0]) }))
    .filter((x) => x.move > 0.08)
    .sort((a, b) => b.move - a.move)
    .slice(0, 3)
    .map(({ k }) => {
      const [lo, hi] = space[k];
      const v = g[k], was = d[k];
      const fmt = (x: number) => (isInt(lo, hi) ? String(Math.round(x)) : `${Math.round(x * 100)}%`);
      return `${GENE_LABEL[`${kind}.${k}`] ?? GENE_LABEL[k] ?? k}: ${fmt(was)} → ${fmt(v)}`;
    });
}
