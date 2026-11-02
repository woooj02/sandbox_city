import { describe, expect, it } from 'vitest';
import { forgeAttacks, describeGenome, defaultGenome, PRESETS, ATTACK_KINDS, World, DEFAULT_CONFIG } from '../src/index';

describe('attack forge', () => {
  const opts = { policy: PRESETS.tuned, seeds: ['forge-test-1'], generations: 2, children: 3, seed: 'ft' };

  it('is reproducible and never reports less than the default attackers', async () => {
    const a = await forgeAttacks(opts);
    const b = await forgeAttacks(opts);
    expect(a.best.stolen).toBe(b.best.stolen);
    expect(a.best.genomes).toEqual(b.best.genomes);
    expect(a.evals).toBe(1 + 2 * 3 + 1);
    // the reported total is a real day with all forged tactics together
    const w = new World({ ...DEFAULT_CONFIG, seed: 'forge-test-1', crypto: 'modeled', policy: PRESETS.tuned, genomes: a.best.genomes });
    const m = await w.run();
    expect(a.best.stolen).toBeCloseTo(m.fraud.leaked, 1);
  }, 60_000);

  it('keeps the attack budget fixed and only changes tactics', async () => {
    const r = await forgeAttacks({ ...opts, generations: 3 });
    for (const k of ATTACK_KINDS) expect(r.best.genomes[k]!.interval).toBe(defaultGenome(k).interval);
    for (const k of ATTACK_KINDS) for (const line of describeGenome(k, r.best.genomes[k]!)) expect(line).toMatch(/→/);
  }, 60_000);
});
