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
