import { describe, expect, it } from 'vitest';
import { BASELINES, bootstrap, DEFAULT_CONFIG, DEV_WORLD, HELD_OUT, pairedDifference, policyId, PRESETS, runDay, World } from '../src';

const small = { ...DEV_WORLD, shoppers: 300, merchants: 45 };

describe('the sleeper store', () => {
  it('earns a real record, then takes money for goods it never ships', async () => {
    const notes: string[] = [];
    const w = new World({ ...DEFAULT_CONFIG, ...DEV_WORLD, seed: 'sleeper', policy: PRESETS.open });
    await w.run((evs) => { for (const e of evs) if (e.type === 'attack' && e.kind === 'sleeper_store') notes.push(e.note); });
    const m = await w.settle();
    expect(notes.some((n) => n.includes('trading honestly'))).toBe(true);
    expect(notes.some((n) => n.includes('turns'))).toBe(true);
    expect(m.fraud.byKind.sleeper_store.leaked).toBeGreaterThan(0);
    expect(m.attackers.sleeper_store.cost).toBeGreaterThan(0); // goods, fees and ads are on its books
    expect(m.attackers.sleeper_store.take - m.attackers.sleeper_store.cost).toBeGreaterThan(0); // and it still pays
  });

  it('leaves the days that do not include it untouched: the world is the same without one', async () => {
    const a = new World({ ...DEFAULT_CONFIG, seed: 'same', crypto: 'modeled', policy: PRESETS.tuned });
    const b = new World({ ...DEFAULT_CONFIG, seed: 'same', crypto: 'modeled', policy: PRESETS.tuned, attackers: { ...DEFAULT_CONFIG.attackers, sleeper_store: 0 } });
    expect((await a.run()).netValue).toBe((await b.run()).netValue);
  });
});

describe('the exposure bound', () => {
  it.each([
    ['ratio 0.5, floor 300', 0.5, 300, false],
    ['ratio 0.1, floor 0', 0.1, 0, false],
    ['independent credit', 0.25, 200, true],
  ])('no store ever holds more unfulfilled money than the rulebook allows: %s', async (_n, exposureRatio, exposureFloor, independentCredit) => {
    for (const seed of ['b1', 'b2', 'b3']) {
      const d = await runDay({ ...PRESETS.tuned, exposureRatio, exposureFloor, independentCredit }, seed, small);
      expect(d.overBound).toBeLessThanOrEqual(0);
    }
  });

  it('the hold delays honest stores instead of refusing them', async () => {
    const off = await runDay(PRESETS.open, 'hold', small);
    const on = await runDay({ ...PRESETS.open, exposureRatio: 0.1, exposureFloor: 0 }, 'hold', small);
    expect(on.access).toBe(off.access);
    expect(on.heldDollarHours).toBeGreaterThan(off.heldDollarHours);
  });
});

describe('settling a day', () => {
  it('runs every pending order to the end: nothing is left in the air', async () => {
    const w = new World({ ...DEFAULT_CONFIG, ...small, seed: 'settle', policy: PRESETS.balanced });
    const before = await w.run();
    const after = await w.settle();
    expect(after.settled).toBe(true);
    expect(after.honest.fulfilledValue).toBeGreaterThan(before.honest.fulfilledValue);
    expect(after.honest.fulfilledValue).toBeLessThanOrEqual(after.honest.gmv);
    for (const rec of w.orders.values()) if (rec.authId) expect(rec.amountHeld).toBe(0);
  });
});

describe('the held-out mechanisms run', () => {
  it.each(Object.keys(HELD_OUT))('%s', async (key) => {
    const d = await runDay(BASELINES.open, 'held', { ...HELD_OUT[key].world, shoppers: 300, merchants: 45 });
    const family = key === 'subscription' ? 'subscription_trap' : key === 'triangulation' ? 'triangulation' : 'sleeper_store';
    expect(d.attacks[family].take).toBeGreaterThan(0);
  });
});

describe('the statistics', () => {
  it('replays, and a constant has no spread', () => {
    expect(bootstrap([1, 2, 3, 4, 5], 's')).toEqual(bootstrap([1, 2, 3, 4, 5], 's'));
    expect(bootstrap([7, 7, 7])).toEqual({ mean: 7, lo: 7, hi: 7 });
  });
  it('pairs day by day', () => {
    const d = pairedDifference([10, 20, 30], [9, 19, 29]);
    expect(d).toEqual({ mean: 1, lo: 1, hi: 1 });
    expect(() => pairedDifference([1], [1, 2])).toThrow();
  });
});

describe('exposure under concurrency', () => {
  it('orders decided in the same tick see each other: the bound holds across a whole busy day, any ratio', async () => {
    for (const exposureRatio of [0.05, 0.1, 0.2, 0.4]) {
      const d = await runDay({ ...PRESETS.open, exposureRatio, exposureFloor: 0 }, 'busy', { ...DEV_WORLD, shoppers: 900 });
      expect(d.overBound).toBeLessThanOrEqual(0);
    }
  });
});

describe('the complaint window', () => {
  const world = { ...DEV_WORLD, shoppers: 240, merchants: 12, attackers: { sleeper_store: 3 }, rising: 0, genomes: { sleeper_store: { emptyBox: 0.95 } } };
  const held = { ...PRESETS.tuned, exposureRatio: 0.05, exposureFloor: 0, independentCredit: true, releaseLag: 720 };

  it('a scan alone does not release held money from an empty box', async () => {
    const atScan = await runDay(held, 'window-1', world);
    const afterWindow = await runDay({ ...held, captureAfterRelease: true }, 'window-1', world);
    expect(atScan.attacks.sleeper_store.leaked).toBeGreaterThan(0);
    expect(afterWindow.attacks.sleeper_store.leaked).toBeLessThan(atScan.attacks.sleeper_store.leaked * 0.5);
  });

  it('does not change a rulebook that leaves the rule off', () => {
    expect(policyId({ ...held, captureAfterRelease: false })).toBe(policyId(held));
  });
});
