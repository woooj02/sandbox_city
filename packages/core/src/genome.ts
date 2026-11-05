import type { AttackKind } from './types';

/** Tunable "DNA" of each attack. The forge evolves these against the current rulebook. */
export const GENOME_SPACE: Record<AttackKind, Record<string, [number, number]>> = {
  prompt_injection: { interval: [20, 200], subtlety: [0, 1], qty: [2, 14] },
  fake_store: { interval: [20, 120], discount: [0.05, 0.6], verify: [0, 1], cashout: [200, 1200], fakeTracking: [0, 1] },
  refund_abuse: { interval: [15, 150], agents: [1, 6], snad: [0, 1] },
  card_testing: { interval: [3, 60], agents: [1, 8], passport: [0, 1], probes: [1, 9], bigs: [1, 6], bigMin: [60, 400] },
  impersonation: { interval: [10, 120], replay: [0, 1], raw: [0, 1], qty: [1, 4] },
  fraud_ring: { interval: [4, 30], size: [3, 10], washTicks: [200, 900], bustTicks: [100, 500] },
  /**
   * warm: minutes of real trading. warmPromo, promo: paid reach before and after it turns (share of shoppers who see it).
   * discount: the bait once it turns. bundle: how much bigger its baskets get once it turns.
   * wash: share of its own record it buys with its own agents. emptyBox: chance a turned store ships an empty parcel to earn a real carrier scan.
   */
  sleeper_store: { interval: [6, 60], warm: [200, 1100], warmPromo: [0, 0.3], promo: [0, 0.6], discount: [0.05, 0.6], bundle: [1, 4], bustTicks: [100, 500], wash: [0, 1], emptyBox: [0, 1] },
  /** Held out of tuning. A store whose listing talks agents into small repeat orders, each one inside every limit. */
  subscription_trap: { interval: [20, 120], repeats: [2, 10], every: [30, 240] },
  /** Held out of tuning. A store that really delivers, buying the goods with stolen cards: the harm lands on someone the gate never sees. */
  triangulation: { interval: [20, 120], promo: [0, 0.3] },
};

export function defaultGenome(kind: AttackKind): Record<string, number> {
  const d: Record<AttackKind, Record<string, number>> = {
    prompt_injection: { interval: 70, subtlety: 0.4, qty: 8 },
    fake_store: { interval: 40, discount: 0.3, verify: 0.5, cashout: 600, fakeTracking: 0.5 },
    refund_abuse: { interval: 45, agents: 3, snad: 0.3 },
    card_testing: { interval: 18, agents: 4, passport: 0.5, probes: 6, bigs: 3, bigMin: 120 },
    impersonation: { interval: 40, replay: 0.6, raw: 0.5, qty: 2 },
    fraud_ring: { interval: 8, size: 5, washTicks: 500, bustTicks: 300 },
    sleeper_store: { interval: 15, warm: 800, warmPromo: 0.06, promo: 0.25, discount: 0.35, bundle: 2, bustTicks: 350, wash: 0, emptyBox: 0 },
    subscription_trap: { interval: 60, repeats: 5, every: 90 },
    triangulation: { interval: 60, promo: 0.1 },
  };
  return { ...d[kind] };
}
