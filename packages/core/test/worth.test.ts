import { describe, expect, it } from 'vitest';
import { breakEven, DEFAULT_PRICES, nextWinner, priceDefense, rankDefenses, type DefenseArm } from '../src/index';

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

  it('names the rulebook that really wins next, even when it is not the runner-up', () => {
    const top: DefenseArm = { key: 'top', name: 'Top', fulfilled: 100_000, stolen: 0, stepUps: 0, heldDollarHours: 2_400_000, access: 0.98 };
    const second: DefenseArm = { ...top, key: 'second', fulfilled: 99_000, heldDollarHours: 1_200_000 };
    const third: DefenseArm = { ...top, key: 'third', fulfilled: 98_500, heldDollarHours: 0 };
    const ranked = rankDefenses([top, second, third], DEFAULT_PRICES);
    expect(ranked.map((r) => r.arm.key)).toEqual(['top', 'second', 'third']);
    const next = nextWinner(ranked, 'holdThousandDay', DEFAULT_PRICES)!;
    expect(next.arm.key).toBe('third');
    expect(rankDefenses([top, second, third], { ...DEFAULT_PRICES, holdThousandDay: next.price + 0.01 })[0].arm.key).toBe('third');
    expect(rankDefenses([top, second, third], { ...DEFAULT_PRICES, holdThousandDay: next.price - 0.01 })[0].arm.key).toBe('top');
  });

  it('skips a rulebook under the access floor, and prices below the smallest allowed', () => {
    const cheap: DefenseArm = { ...light, key: 'cheap', fulfilled: 99_000, stolen: 0, access: 0.5 };
    const ranked = rankDefenses([light, cheap], { ...DEFAULT_PRICES, stolenDollar: 0.1 });
    expect(nextWinner(ranked, 'stolenDollar', { ...DEFAULT_PRICES, stolenDollar: 0.1 })).toBeNull();
    const open = { ...DEFAULT_PRICES, stolenDollar: 0.1, minAccess: 0 };
    expect(nextWinner(rankDefenses([light, cheap], open), 'stolenDollar', open, 1)).toBeNull();
    expect(nextWinner(rankDefenses([light, cheap], open), 'stolenDollar', open)?.arm.key).toBe('cheap');
  });

  it('offers no next winner when nothing meets the floor', () => {
    const floor = { ...DEFAULT_PRICES, minAccess: 1 };
    expect(nextWinner(rankDefenses([light, heavy], floor), 'stepUp', floor)).toBeNull();
  });
});
