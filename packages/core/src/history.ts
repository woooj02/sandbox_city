/**
 * What a store's and an agent's record mean, and what happens to held money. The simulated day and the checkout both
 * call these, so the facts the evaluator sees are computed the same way in each place, not just judged the same way.
 */
import type { Policy } from './policy';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** An agent's standing, from its orders, its refunds and its age in minutes. */
export function agentRep(orders: number, refunds: number, age: number): number {
  return clamp(0.15 + 0.6 * (1 - Math.exp(-orders / 10)) + Math.min(0.2, age / 20000) - (orders ? 1.5 * refunds / orders : 0), 0, 1);
}

/** A store's standing, from what it delivered, whether it is verified, its age in minutes and its refund ratio. */
export function merchantRep(delivered: number, verified: boolean, age: number, refundRatio: number): number {
  return clamp(0.2 + 0.5 * (1 - Math.exp(-delivered / 25)) + (verified ? 0.15 : 0) + Math.min(0.1, age / 3000) - 2 * refundRatio, 0, 1);
}

/** The share of a store's orders from buyers who shop almost only here. `totalOf` is how much a buyer ordered anywhere. */
export function closedLoop(buyers: Iterable<[string, number]>, totalOf: (buyer: string) => number | undefined): { loop: number; total: number } {
  let loop = 0, total = 0;
  for (const [buyer, n] of buyers) {
    total += n;
    const all = totalOf(buyer);
    if (all === undefined) continue;
    if (n >= 3 && n / all > 0.6) loop += n;
  }
  return { loop, total };
}

/** A buyer whose account predates the store and whose history is mostly elsewhere: a record a store cannot buy from itself. */
export function isIndependentBuyer(buyerFirstSeen: number, storeOpened: number, ordersHere: number, ordersAnywhere: number): boolean {
  return buyerFirstSeen <= storeOpened && ordersHere / Math.max(1, ordersAnywhere) <= 0.5;
}

export type SettleStep = 'release' | 'void' | 'credit';
export interface SettleFacts { held: boolean; delivered: boolean; disputed: boolean; credited: boolean }

/** Held money waits for the complaint window, not just the scan: an empty parcel scans like a full one. */
export const holdsToRelease = (p: Policy) => !!p.captureAfterRelease && (p.releaseLag ?? 0) > 0;

/**
 * What a rulebook does with an order when the carrier scans it, or when its complaint window closes.
 * A disputed order earns nothing. A hold nobody delivered on is voided, so the buyer keeps the money.
 */
export function settlement(p: Policy, event: 'delivered' | 'window-closed', o: SettleFacts): SettleStep[] {
  const steps: SettleStep[] = [];
  const earns = !o.disputed && !o.credited;
  if (event === 'delivered') {
    if (o.held && !holdsToRelease(p)) steps.push('release');
    if (!(p.releaseLag ?? 0) && earns) steps.push('credit');
    return steps;
  }
  if (o.held) {
    if (holdsToRelease(p) && o.delivered && !o.disputed) steps.push('release');
    else return ['void'];
  }
  if (o.delivered && earns) steps.push('credit');
  return steps;
}
