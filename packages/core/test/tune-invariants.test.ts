import { describe, expect, it } from 'vitest';
import { DEV_WORLD, INVARIANTS, PRESETS, searchRulebook, SimRunner, type FromSim, type Policy } from '../src';

const holds = (p: Policy) => INVARIANTS.every((k) => p[k] === true);

describe('no search can trade away an invariant', () => {
  it('every candidate keeps all four, even when the caller asks otherwise', async () => {
    const seen: Policy[] = [];
    const r = await searchRulebook({
      trainSeeds: ['inv-1'], testSeeds: [], world: { ...DEV_WORLD, shoppers: 80 }, generations: 2, children: 3, seed: 'inv', label: 'test',
      floor: { enforceMandate: false, shipLock: false } as Partial<Policy>,
    }, (e) => { if (e.type === 'eval') seen.push(e.candidate.policy); });
    expect(seen.length).toBeGreaterThan(5);
    expect(seen.filter((p) => !holds(p))).toEqual([]);
    expect(holds(r.best.policy)).toBe(true);
  }, 120000);

  it('the Auto-Tune button returns a winner that keeps them, the case the review reproduced', async () => {
    const tuned = await new Promise<Extract<FromSim, { type: 'tune' }>>((resolve, reject) => {
      const runner = new SimRunner((m) => {
        if (m.type === 'tune' && m.phase === 'done') { runner.stop(); resolve(m); }
        if (m.type === 'error') reject(new Error(m.message));
      }, { mode: 'local', crypto: 'modeled' });
      runner.handle({ cmd: 'init', seed: 'sandbox-city', chaos: 0.04, shoppers: 80, lanes: [{ policy: PRESETS.open }] });
      runner.handle({ cmd: 'tune', generations: 1, children: 1, trainDays: 1, minSafety: 0.85, minAccess: 0.8 });
    });
    expect(holds(tuned.best!.policy)).toBe(true);
  }, 120000);
});

describe('the runner refuses what is not a command', () => {
  const run = (msg: unknown) => {
    const out: FromSim[] = [];
    new SimRunner((m) => out.push(m), { mode: 'local', crypto: 'modeled' }).handle(msg);
    return out;
  };

  it('answers with an error and does not throw', () => {
    for (const msg of [null, undefined, 7, 'x', [], {}, { cmd: 'init' }, { cmd: 'init', seed: 's', lanes: [{ policy: { sanitizer: 'x' } }] }]) {
      expect(run(msg).map((m) => m.type)).toEqual(['error']);
    }
  });

  it('keeps a real rulebook exactly, the frozen fields included', () => {
    const policy = { ...PRESETS.tuned, name: 'Mine', exposureRatio: 0.05, releaseLag: 600, captureAfterRelease: true };
    const world = run({ cmd: 'init', seed: 's', chaos: 0, shoppers: 50, lanes: [{ policy }] }).find((m) => m.type === 'world');
    expect(world && 'world' in world && world.world.policy).toMatchObject(policy);
  });
});
