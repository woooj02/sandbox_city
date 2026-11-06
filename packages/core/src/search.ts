/**
 * Rulebook search: evolve a policy that keeps the most value for honest people, measured on
 * training days, then check it on held-out days it never saw (different city layout, shoppers,
 * attacker placement and timing).
 */
import { INVARIANT_FLOOR } from './policy-patch';
import { World, DEFAULT_CONFIG, type WorldConfig } from './world';
import { PRESETS, RULES, type Policy } from './policy';
import { Rng, round2, clamp } from './rng';
import { summarize, type DaySummary } from './whatif';

export interface SearchOptions {
  trainSeeds: string[];
  testSeeds: string[];
  chaos?: number;
  generations?: number;
  children?: number;
  survivors?: number;
  /** Minimum share of honest purchases that must get through; candidates below it are penalised. */
  minAccess?: number;
  /** Minimum share of attempted fraud $ that must be stopped; candidates below it are penalised. */
  minSafety?: number;
  seed?: string;
  world?: Partial<WorldConfig>;
  /** Run each day to its terminal state and score what was delivered and kept, not what was paid for. */
  settle?: boolean;
  /** 'evolve' breeds from the best so far; 'random' draws every candidate fresh, the baseline for a fair budget. */
  strategy?: 'evolve' | 'random';
  /** Rules the search may not turn off: they are not up for statistical trade. */
  floor?: Partial<Policy>;
  /** Stop after this many evaluated rulebooks, so two strategies can be compared on the same budget. */
  budget?: number;
}

export interface Scored { policy: Policy; score: number; days: DaySummary[]; mean: DaySummary }

export type SearchEvent =
  | { type: 'eval'; generation: number; evals: number; total: number; candidate: Scored; best: Scored }
  | { type: 'generation'; generation: number; best: Scored; frontier: Scored[] }
  | { type: 'test'; name: string; train: DaySummary; test: DaySummary };

export interface SearchResult { best: Scored; tested: { name: string; policy: Policy; train: DaySummary; test: DaySummary }[]; evals: number }

const TUNABLE = RULES.filter((r) => r.key !== 'idempotencyKeys');

export const policyKey = (p: Policy) => RULES.map((r) => `${r.key}=${p[r.key]}`).join('&');

function mean(days: DaySummary[], key: string, name: string): DaySummary {
  const raw = (f: (d: DaySummary) => number) => days.reduce((s, d) => s + f(d), 0) / days.length;
  const avg = (f: (d: DaySummary) => number) => round2(raw(f));
  return {
    key, name, stolen: avg((d) => d.stolen), duplicate: avg((d) => d.duplicate), honestLost: avg((d) => d.honestLost), gmv: avg((d) => d.gmv),
    net: avg((d) => d.net), safety: raw((d) => d.safety), access: raw((d) => d.access), fraudAttempted: avg((d) => d.fraudAttempted),
    fulfilled: avg((d) => d.fulfilled), kept: avg((d) => d.kept),
  };
}

export function mutate(p: Policy, r: Rng, n = 1 + r.int(0, 2)): Policy {
  const q: Policy = { ...p };
  for (let i = 0; i < n; i++) {
    const rule = r.pick(TUNABLE);
    if (rule.kind === 'bool') (q[rule.key] as boolean) = !(q[rule.key] as boolean);
    else {
      const min = rule.min ?? 0, max = rule.max ?? 1, step = rule.step ?? 1;
      const cur = (q[rule.key] as number | undefined) ?? 0;
      let next: number;
      const roll = r.next();
      if (roll < 0.2) next = cur === 0 ? min + step * r.int(1, Math.round((max - min) / step)) : 0; // switch on / off
      else if (roll < 0.35) next = min + step * r.int(0, Math.round((max - min) / step));     // jump anywhere
      else next = cur + step * r.int(-3, 3);                                                   // nudge
      (q[rule.key] as number) = Math.round(clamp(next, min, max) / step) * step;
      (q[rule.key] as number) = round2(q[rule.key] as number);
    }
  }
  return q;
}

/** Every switch and dial drawn uniformly: what a search with no memory would try. */
export function randomPolicy(r: Rng): Policy {
  const q: Policy = { ...PRESETS.open };
  for (const rule of TUNABLE) {
    if (rule.kind === 'bool') (q[rule.key] as boolean) = r.chance(0.5);
    else {
      const step = rule.step ?? 1, min = rule.min ?? 0, max = rule.max ?? 1;
      (q[rule.key] as number) = r.chance(0.5) ? 0 : round2(min + step * r.int(0, Math.round((max - min) / step)));
    }
  }
  return q;
}

function crossover(a: Policy, b: Policy, r: Rng): Policy {
  const q: Policy = { ...a };
  for (const rule of TUNABLE) if (r.chance(0.5)) (q as unknown as Record<string, unknown>)[rule.key] = b[rule.key];
  return q;
}

export async function searchRulebook(opts: SearchOptions & { label?: string }, onEvent?: (e: SearchEvent) => void): Promise<SearchResult> {
  const r = new Rng(opts.seed ?? 'rule-search');
  const gens = opts.generations ?? 8, kids = opts.children ?? 10, keep = opts.survivors ?? 5;
  const minAccess = opts.minAccess ?? 0, minSafety = opts.minSafety ?? 0;
  const cache = new Map<string, Scored>();
  let evals = 0;
  const total = (Object.keys(PRESETS).length + gens * kids);

  const day = async (policy: Policy, seed: string) => {
    const w = new World({ ...DEFAULT_CONFIG, ...opts.world, seed, chaos: opts.chaos ?? DEFAULT_CONFIG.chaos, crypto: 'modeled', policy, liveRails: undefined });
    let m = await w.run();
    if (opts.settle) m = await w.settle();
    await new Promise<void>((res) => setTimeout(res, 0));
    return summarize(seed, policy.name, m);
  };
  const score = (d: DaySummary) => (opts.settle ? d.kept : d.net)
    - (d.access < minAccess ? (minAccess - d.access) * d.gmv * 4 : 0)
    - (d.safety < minSafety ? (minSafety - d.safety) * d.fraudAttempted * 4 : 0);

  let best: Scored | null = null;
  const evaluate = async (policy: Policy, generation: number): Promise<Scored> => {
    const k = policyKey(policy);
    const hit = cache.get(k);
    if (hit) return hit;
    const days: DaySummary[] = [];
    for (const s of opts.trainSeeds) days.push(await day(policy, s));
    const m = mean(days, k, policy.name);
    const sc: Scored = { policy, days, mean: m, score: round2(score(m)) };
    cache.set(k, sc);
    evals++;
    if (!best || sc.score > best.score) best = sc;
    onEvent?.({ type: 'eval', generation, evals, total, candidate: sc, best });
    return sc;
  };

  // no caller can search its way past these, and the floor is applied last so a mutation cannot undo it
  const floor = { ...opts.floor, ...INVARIANT_FLOOR };
  let pop: Scored[] = [];
  // presets as shipped, so they plot where they really are; every candidate after them retries safely
  for (const p of Object.values(PRESETS)) pop.push(await evaluate({ ...p, ...floor }, 0));
  pop.sort((a, b) => b.score - a.score);

  const spent = () => opts.budget != null && evals >= opts.budget;
  for (let g = 1; g <= gens && !spent(); g++) {
    const parents = pop.slice(0, keep);
    for (let i = 0; i < kids && !spent(); i++) {
      const a = r.pick(parents).policy;
      const child = opts.strategy === 'random' ? randomPolicy(r) : r.chance(0.3) ? mutate(crossover(a, r.pick(parents).policy, r), r, 1) : mutate(a, r);
      child.name = 'Tuned';
      child.idempotencyKeys = true;
      Object.assign(child, floor);
      pop.push(await evaluate(child, g));
    }
    const seen = new Set<string>();
    pop = pop.sort((a, b) => b.score - a.score).filter((s) => (seen.has(policyKey(s.policy)) ? false : (seen.add(policyKey(s.policy)), true))).slice(0, keep * 2);
    onEvent?.({ type: 'generation', generation: g, best: pop[0], frontier: pop.slice(0, keep) });
  }

  const label = opts.label ?? 'Tuned';
  const winner = { ...pop[0], policy: { ...pop[0].policy, name: label } };
  const tested: SearchResult['tested'] = [];
  const contenders: [string, Policy][] = [[label, winner.policy], ...Object.values(PRESETS).map((p) => [p.name, p] as [string, Policy])];
  for (const [name, policy] of opts.testSeeds.length ? contenders : []) {
    const days: DaySummary[] = [];
    for (const s of opts.testSeeds) days.push(await day(policy, s));
    const trainDays: DaySummary[] = [];
    for (const s of opts.trainSeeds) trainDays.push(await day(policy, s));
    const t = { name, policy, train: mean(trainDays, name, name), test: mean(days, name, name) };
    tested.push(t);
    onEvent?.({ type: 'test', name, train: t.train, test: t.test });
  }
  return { best: winner, tested, evals };
}

/** Human-readable diff of a policy against Wild West: what the search turned on and how far. */
export function describePolicy(p: Policy): string[] {
  const out: string[] = [];
  for (const rule of RULES) {
    const v = p[rule.key];
    if (rule.kind === 'bool') { if (v) out.push(rule.label); }
    else if ((v as number) > 0) out.push(`${rule.label}: ${v}`);
  }
  return out;
}
