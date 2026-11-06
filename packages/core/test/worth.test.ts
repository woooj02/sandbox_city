import { describe, expect, it } from 'vitest';
import { breakEven, DEFAULT_PRICES, priceDefense, rankDefenses, type DefenseArm } from '../src/index';

const light: DefenseArm = { key: 'light', name: 'Light', fulfilled: 100_000, stolen: 6_000, stepUps: 100, heldDollarHours: 50_000, access: 0.98 };
const heavy: DefenseArm = { key: 'heavy', name: 'Heavy', fulfilled: 99_000, stolen: 4_000, stepUps: 400, heldDollarHours: 700_000, access: 0.96 };
const wall: DefenseArm = { key: 'wall', name: 'Wall', fulfilled: 60_000, stolen: 1_000, stepUps: 900, heldDollarHours: 0, access: 0.43 };

describe('what a defense is worth', () => {
  it('at default prices, is value delivered minus money stolen', () => {
    expect(priceDefense(light, DEFAULT_PRICES).net).toBe(94_000);
  });

  it('turns dollar-hours held into a cost per $1,000 a day', () => {
    // $24,000 dollar-hours is $1,000 held for a day
    expect(priceDefense({ ...light, heldDollarHours: 24_000, stolen: 0, stepUps: 0 }, { ...DEFAULT_PRICES, holdThousandDay: 2 }).holding).toBeCloseTo(2);
  });

  it('changes its answer when your prices change', () => {
    expect(rankDefenses([light, heavy], DEFAULT_PRICES)[0].arm.key).toBe('heavy');
    expect(rankDefenses([light, heavy], { ...DEFAULT_PRICES, stepUp: 5 })[0].arm.key).toBe('light');
  });

  it('puts a defense under your access floor last, however much it saves', () => {
    const ranked = rankDefenses([wall, light, heavy], { ...DEFAULT_PRICES, stolenDollar: 50 });
    expect(ranked[2].arm.key).toBe('wall');
    expect(ranked[2].out).toBe(true);
  });

  it('finds the price where two defenses tie, and that price really ties them', () => {
    const x = breakEven(light, heavy, 'stepUp', DEFAULT_PRICES)!;
    expect(x).toBeCloseTo(1000 / 300, 6);
    const p = { ...DEFAULT_PRICES, stepUp: x };
    expect(priceDefense(light, p).net).toBeCloseTo(priceDefense(heavy, p).net, 6);
  });

  it('says so when no price can tie them', () => {
    expect(breakEven(light, { ...light, fulfilled: 90_000 }, 'stepUp', DEFAULT_PRICES)).toBeNull();
    expect(breakEven(light, { ...heavy, stolen: 9_000 }, 'stolenDollar', { ...DEFAULT_PRICES })).toBeNull();
  });
});
