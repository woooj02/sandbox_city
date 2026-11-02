import { describe, expect, it } from 'vitest';
import { World, DEFAULT_CONFIG, PRESETS, whatIf, summarize, samePolicy } from '../src/index';

describe('what-if replays', () => {
  const base = { shoppers: 200, merchants: 36, ticks: 600 };

  it('replaying your own rulebook reproduces the day you just watched, to the cent', async () => {
    const live = await new World({ ...DEFAULT_CONFIG, ...base, seed: 'wi', chaos: 0.05, crypto: 'ed25519', policy: PRESETS.kya }).run();
    const r = await whatIf({ seed: 'wi', chaos: 0.05, shoppers: base.shoppers, mine: [PRESETS.kya] }, base);
    expect(r.mine[0]).toEqual(summarize('lane0', PRESETS.kya.name, live));
  });

  it('compares against every preset not already on screen', async () => {
    const r = await whatIf({ seed: 'wi', chaos: 0.05, shoppers: base.shoppers, mine: [PRESETS.open, { ...PRESETS.balanced, name: 'renamed' }] }, base);
    expect(r.alternatives.map((a) => a.key).sort()).toEqual(['fortress', 'kya', 'passport']);
    expect(samePolicy(PRESETS.kya, { ...PRESETS.kya, velocity: 99 })).toBe(false);
  });
});
