/**
 * Which defense is worth its cost to you? Plain arithmetic over measured days, with your own prices.
 * The measurements come from a benchmark. The prices are the developer's: this lab does not know them.
 */

export interface DefenseArm {
  key: string; name: string;
  /** Per day: honest orders delivered and kept paid, money stolen, step-ups, dollar-hours of honest money held. */
  fulfilled: number; stolen: number; stepUps: number; heldDollarHours: number;
  /** Share of honest purchases accepted, 0..1. */
  access: number;
}

export interface Prices {
  /** What one stolen dollar really costs: 1 is the dollar alone, more adds fees, disputes and lost trust. */
  stolenDollar: number;
  /** What one step-up costs: support time, and owners who give up. */
  stepUp: number;
  /** What it costs to hold $1,000 of a store's money for a day. */
  holdThousandDay: number;
  /** The lowest share of honest purchases you will accept. Below it a defense is out, whatever it saves. */
  minAccess: number;
}

export const DEFAULT_PRICES: Prices = { stolenDollar: 1, stepUp: 0, holdThousandDay: 0, minAccess: 0.95 };

/** Example price sets: assumptions to start from, not measurements. Each one is a different kind of business. */
export interface PriceExample { key: string; name: string; note: string; prices: Prices; boxes: boolean }
export const PRICE_EXAMPLES: PriceExample[] = [
  { key: 'cash', name: 'Sellers need their cash', note: 'An owner approval costs $1 of support time; holding $1,000 for a day costs $5.', prices: { stolenDollar: 1, stepUp: 1, holdThousandDay: 5, minAccess: 0.95 }, boxes: false },
  { key: 'dollar', name: 'Theft is only the dollar', note: 'A stolen dollar costs one dollar. Approvals and holds cost nothing.', prices: DEFAULT_PRICES, boxes: false },
  { key: 'chargebacks', name: 'Each theft brings a dispute', note: 'A stolen dollar costs $2.50 with dispute fees and handling; approvals $1; holds $0.50.', prices: { stolenDollar: 2.5, stepUp: 1, holdThousandDay: 0.5, minAccess: 0.95 }, boxes: false },
  { key: 'marketplace', name: 'Open marketplace', note: 'As the dispute example, on days where some stores ship empty boxes.', prices: { stolenDollar: 2.5, stepUp: 1, holdThousandDay: 0.5, minAccess: 0.95 }, boxes: true },
];

export interface Priced { arm: DefenseArm; delivered: number; theft: number; friction: number; holding: number; net: number; out: boolean }

export function priceDefense(arm: DefenseArm, p: Prices): Priced {
  const theft = arm.stolen * p.stolenDollar, friction = arm.stepUps * p.stepUp, holding = (arm.heldDollarHours / 24 / 1000) * p.holdThousandDay;
  return { arm, delivered: arm.fulfilled, theft, friction, holding, net: arm.fulfilled - theft - friction - holding, out: arm.access < p.minAccess };
}

/** Best first. A defense under your access floor goes last, however much it would save. */
export function rankDefenses(arms: DefenseArm[], p: Prices): Priced[] {
  return arms.map((a) => priceDefense(a, p)).sort((a, b) => Number(a.out) - Number(b.out) || b.net - a.net);
}

export type PriceKnob = 'stolenDollar' | 'stepUp' | 'holdThousandDay';

/** The price at which two defenses tie, others held still. Null if no sensible price does it. Net is linear in each price. */
export function breakEven(a: DefenseArm, b: DefenseArm, knob: PriceKnob, p: Prices): number | null {
  const gap = (x: number) => priceDefense(a, { ...p, [knob]: x }).net - priceDefense(b, { ...p, [knob]: x }).net;
  const at0 = gap(0), slope = gap(1) - at0;
  if (Math.abs(slope) < 1e-9) return null;
  const x = -at0 / slope;
  return x > 0 && Number.isFinite(x) ? x : null;
}

/**
 * The nearest price at which the current winner loses, and who to. Net is linear in each price, so the first rulebook to
 * overtake the winner is the true next winner. That need not be the runner-up, which is why this looks at all of them.
 */
export function nextWinner(ranked: Priced[], knob: PriceKnob, p: Prices, min = 0): { arm: DefenseArm; price: number } | null {
  const [top, ...rest] = ranked;
  if (!top || top.out) return null;
  const crossings = rest.filter((r) => !r.out).flatMap((r) => {
    const price = breakEven(top.arm, r.arm, knob, p);
    return price !== null && price >= min ? [{ arm: r.arm, price }] : [];
  });
  return crossings.sort((a, b) => Math.abs(a.price - p[knob]) - Math.abs(b.price - p[knob]))[0] ?? null;
}
