import { afterEach, describe, expect, it, vi } from 'vitest';
import { ATTACK_KINDS, defaultGenome, GENOME_SPACE, PRESETS, randomGenome, Rng, SimRunner, type FromSim, type Genomes, type SimEvent, type World } from '../src';

const init = { cmd: 'init', seed: 'runner-input', chaos: 0, shoppers: 50, lanes: [{ policy: PRESETS.open }] };
const makeRunner = () => {
  const messages: FromSim[] = [];
  const runner = new SimRunner((m) => messages.push(m), { mode: 'local', crypto: 'modeled' });
  return { runner, messages };
};

describe('nested public runner input', () => {
  it('rejects malformed genes before replacing an existing city', () => {
    const { runner, messages } = makeRunner();
    runner.handle(init);
    const worlds = runner.worlds;
    const bad: unknown[] = [
      null, [], 5, 'x', true,
      { unknown: {} }, JSON.parse('{"__proto__": {}}'), { constructor: {} },
      ...[null, [], 5, 'x', true].map((genes) => ({ card_testing: genes })),
      ...[100, 0, -1, 7.5, '8', null, {}, NaN, Infinity, -Infinity].map((agents) => ({ card_testing: { agents } })),
      { card_testing: { probes: 100 } }, { card_testing: { bigs: 100 } }, { card_testing: { interval: 0 } },
      { fraud_ring: { size: 100 } }, { refund_abuse: { agents: 100 } },
      { prompt_injection: { subtlety: 1.01 } }, { sleeper_store: { emptyBox: -0.01 } },
      { sleeper_store: { surprise: 1 } }, JSON.parse('{"card_testing": {"__proto__": 8}}'),
    ];
    for (const genomes of bad) {
      messages.length = 0;
      expect(() => runner.handle({ ...init, genomes })).not.toThrow();
      expect(messages.map((m) => m.type)).toEqual(['error']);
      expect(runner.worlds).toBe(worlds);
    }
    runner.stop();
  });

  it('accepts partial genomes and copies their nested values', () => {
    const { runner, messages } = makeRunner();
    const genomes = { card_testing: { agents: 8 }, sleeper_store: { emptyBox: 1 } };
    runner.handle({ ...init, genomes });
    expect(messages.some((m) => m.type === 'error')).toBe(false);
    expect([...runner.worlds[0].attackers.values()].filter((a) => a.kind === 'card_testing').every((a) => a.agents.length === 8)).toBe(true);
    genomes.card_testing.agents = 100;
    expect(runner.worlds[0].cfg.genomes?.card_testing?.agents).toBe(8);
    runner.stop();
  });

  it('keeps default init and forge-generated genomes valid', () => {
    const { runner, messages } = makeRunner();
    runner.handle({ ...init, shoppers: undefined });
    expect(runner.worlds[0].cfg.shoppers).toBe(600);
    const genomes: Genomes = Object.fromEntries(ATTACK_KINDS.map((kind) => [kind, randomGenome(kind, defaultGenome(kind), new Rng(`runner-${kind}`))]));
    runner.handle({ ...init, genomes });
    expect(messages.some((m) => m.type === 'error')).toBe(false);
    expect(runner.worlds[0].cfg.genomes).toEqual(genomes);
    runner.stop();
  });

  for (const side of [0, 1] as const) {
    it(`accepts every declared ${side ? 'maximum' : 'minimum'} and caps the expanded workload`, () => {
      const { runner, messages } = makeRunner();
      const genomes = Object.fromEntries(ATTACK_KINDS.map((kind) => [kind, Object.fromEntries(Object.entries(GENOME_SPACE[kind]).map(([gene, limits]) => [gene, limits[side]]))]));
      runner.handle({ ...init, shoppers: 1e9, lanes: [{ policy: PRESETS.open }, { policy: PRESETS.fortress }, { policy: PRESETS.open }], genomes });
      expect(messages.some((m) => m.type === 'error')).toBe(false);
      expect(runner.worlds).toHaveLength(2);
      expect(runner.worlds.map((w) => w.shoppers.size)).toEqual([1200, 1200]);
      expect(runner.worlds.reduce((sum, w) => sum + w.shoppers.size, 0)).toBe(2400);
      if (side) expect(runner.worlds[0].cfg.shoppers).toBe(1140);
      runner.stop();
    });
  }
});

describe('pending payments after trading pauses or ends', () => {
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
  const capture: SimEvent = { type: 'capture', t: 1440, order: 'pending-1', amount: 80, rail: 'sandbox', captureId: 'C1' };
  const paused = () => {
    vi.useFakeTimers();
    const { runner, messages } = makeRunner();
    let pending = true;
    const world = {
      cfg: {}, t: 1440, sale: false, attackers: new Map(),
      get done() { return this.t >= 1440; },
      get hasPendingPayments() { return pending; },
      pollPayments: vi.fn(async (): Promise<SimEvent[]> => { pending = false; return [capture]; }),
      step: vi.fn(async (): Promise<SimEvent[]> => []),
    };
    runner.worlds = [world as unknown as World];
    return { runner, messages, world };
  };

  it('emits a later confirmation once through the original tick path', async () => {
    const { runner, messages, world } = paused();
    runner.handle({ cmd: 'pause' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(world.pollPayments).toHaveBeenCalledTimes(1);
    expect(messages.filter((m) => m.type === 'tick')).toEqual([{ type: 'tick', lane: 0, t: 1440, events: [capture], spawn: [], sale: false, attackerPhase: {} }]);
    await vi.advanceTimersByTimeAsync(15000);
    expect(world.pollPayments).toHaveBeenCalledTimes(1);
    runner.stop();
  });

  it('starts polling when the day ends during play', async () => {
    const { runner, messages, world } = paused();
    world.t = 1439;
    world.step.mockImplementation(async () => { world.t++; return []; });
    runner.handle({ cmd: 'play' });
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.running).toBe(false);
    expect(messages.some((m) => m.type === 'done')).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(world.pollPayments).toHaveBeenCalledTimes(1);
    runner.stop();
  });

  it('waits for an in-flight step before polling a newly paused world', async () => {
    const { runner, world } = paused();
    world.t = 1439;
    let finish!: (events: SimEvent[]) => void;
    world.step.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    runner.handle({ cmd: 'play' });
    await vi.advanceTimersByTimeAsync(0);
    runner.handle({ cmd: 'pause' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(world.pollPayments).not.toHaveBeenCalled();
    finish([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(world.pollPayments).toHaveBeenCalledTimes(1);
    runner.stop();
  });

  it('waits for an in-flight poll before stepping a resumed world', async () => {
    const { runner, world } = paused();
    world.t = 1439;
    let finish!: (events: SimEvent[]) => void;
    world.pollPayments.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    world.step.mockImplementation(async () => { world.t++; return []; });
    runner.handle({ cmd: 'pause' });
    await vi.advanceTimersByTimeAsync(5000);
    runner.handle({ cmd: 'play' });
    await vi.advanceTimersByTimeAsync(0);
    expect(world.step).not.toHaveBeenCalled();
    finish([capture]);
    await vi.advanceTimersByTimeAsync(0);
    expect(world.step).toHaveBeenCalledTimes(1);
    runner.stop();
  });

  it('does not queue extra polls while a provider read is still running', async () => {
    const { runner, world } = paused();
    let finish!: (events: SimEvent[]) => void;
    world.pollPayments.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    runner.handle({ cmd: 'pause' });
    await vi.advanceTimersByTimeAsync(5000);
    runner.handle({ cmd: 'pause' });
    await vi.advanceTimersByTimeAsync(10000);
    finish([capture]);
    await vi.advanceTimersByTimeAsync(0);
    expect(world.pollPayments).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(world.pollPayments).toHaveBeenCalledTimes(2);
    runner.stop();
  });

  for (const action of ['stop', 'init'] as const) {
    it(`discards an old run's delayed read after ${action}`, async () => {
      const { runner, messages, world } = paused();
      let finish!: (events: SimEvent[]) => void;
      world.pollPayments.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      runner.handle({ cmd: 'pause' });
      await vi.advanceTimersByTimeAsync(5000);
      if (action === 'stop') runner.stop(); else runner.handle(init);
      finish([capture]);
      await vi.advanceTimersByTimeAsync(10000);
      expect(messages.some((m) => m.type === 'tick')).toBe(false);
      expect(world.pollPayments).toHaveBeenCalledTimes(1);
      runner.stop();
    });
  }

  it('reports a read failure and retries without losing the pending payment', async () => {
    const { runner, messages, world } = paused();
    world.pollPayments.mockRejectedValueOnce(new Error('provider unavailable'));
    runner.handle({ cmd: 'pause' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(messages.some((m) => m.type === 'error' && m.message.includes('provider unavailable'))).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(world.pollPayments).toHaveBeenCalledTimes(2);
    expect(messages.filter((m) => m.type === 'tick')).toHaveLength(1);
    runner.stop();
  });
});
