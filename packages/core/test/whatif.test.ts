import { INVARIANT_FLOOR } from '../src/policy-patch';
import { describe, expect, it } from 'vitest';
import { World, DEFAULT_CONFIG, PRESETS, whatIf, summarize, samePolicy, searchRulebook } from '../src/index';

describe('what-if replays', () => {
  const base = { shoppers: 200, merchants: 36, ticks: 600 };

  it('replaying your own rulebook reproduces the day you just watched, to the cent', async () => {
    const live = await new World({ ...DEFAULT_CONFIG, ...base, seed: 'wi', chaos: 0.05, crypto: 'ed25519', policy: PRESETS.kya }).run();
    const r = await whatIf({ seed: 'wi', chaos: 0.05, shoppers: base.shoppers, mine: [PRESETS.kya] }, base);
    expect(r.mine[0]).toEqual(summarize('lane0', PRESETS.kya.name, live));
  });

  it('compares against every preset not already on screen', async () => {
    const r = await whatIf({ seed: 'wi', chaos: 0.05, shoppers: base.shoppers, mine: [PRESETS.open, { ...PRESETS.balanced, name: 'renamed' }] }, base);
    expect(r.alternatives.map((a) => a.key).sort()).toEqual(['fortress', 'kya', 'passport', 'tuned']);
    expect(samePolicy(PRESETS.kya, { ...PRESETS.kya, velocity: 99 })).toBe(false);
  });
});

describe('rulebook search', () => {
  it('never does worse than the best preset with the invariants on, and is reproducible', async () => {
    const opts = { trainSeeds: ['s1'], testSeeds: [], generations: 2, children: 3, world: { shoppers: 120, merchants: 30, ticks: 480 } };
    const a = await searchRulebook(opts);
    const b = await searchRulebook(opts);
    expect(a.best.policy).toEqual(b.best.policy);
    const presets = await Promise.all(Object.values(PRESETS).map((p) => new World({ ...DEFAULT_CONFIG, ...opts.world, seed: 's1', crypto: 'modeled', policy: { ...p, ...INVARIANT_FLOOR } }).run()));
    expect(a.best.score).toBeGreaterThanOrEqual(Math.max(...presets.map((m) => m.netValue)) - 0.01);
  });

  it('respects the safety floor', async () => {
    const r = await searchRulebook({ trainSeeds: ['s2'], testSeeds: [], generations: 2, children: 3, minSafety: 0.85, world: { shoppers: 120, merchants: 30, ticks: 480 } });
    expect(r.best.mean.safety).toBeGreaterThanOrEqual(0.85);
  });
});
