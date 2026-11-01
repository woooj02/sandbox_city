import { describe, expect, it } from 'vitest';
import { World, DEFAULT_CONFIG, PRESETS, SimEvent, round2, WorldConfig } from '../src/index';

const small = (over: Partial<WorldConfig> = {}): WorldConfig => ({
  ...DEFAULT_CONFIG, shoppers: 250, merchants: 40, ticks: 720, crypto: 'modeled', policy: PRESETS.balanced, ...over,
});

async function runAll(cfg: WorldConfig) {
  const w = new World(cfg);
  const events: SimEvent[] = [];
  w.on((ev) => events.push(...ev));
  const m = await w.run();
  return { w, m, events };
}

describe('determinism', () => {
  it('same seed + same policy => identical run', async () => {
    const a = await runAll(small());
    const b = await runAll(small());
    expect(JSON.stringify(a.events)).toEqual(JSON.stringify(b.events));
  });

  it('different seeds diverge', async () => {
    const a = await runAll(small());
    const b = await runAll(small({ seed: 'other' }));
    expect(a.m.netValue).not.toEqual(b.m.netValue);
  });

  it('modeled crypto makes the exact same decisions as real Ed25519', async () => {
    const a = await runAll(small({ ticks: 300, crypto: 'modeled', policy: PRESETS.kya }));
    const b = await runAll(small({ ticks: 300, crypto: 'ed25519', policy: PRESETS.kya }));
    expect(b.m).toEqual(a.m);
  });
});

describe('paired counterfactuals', () => {
  it('attack pressure is identical across rulebooks; only outcomes change', async () => {
    const open = await runAll(small({ policy: PRESETS.open }));
    const fort = await runAll(small({ policy: PRESETS.fortress }));
    expect(fort.m.fraud.byKind.card_testing.attempted).toEqual(open.m.fraud.byKind.card_testing.attempted);
    expect(fort.m.fraud.byKind.impersonation.attempts).toEqual(open.m.fraud.byKind.impersonation.attempts);
    expect(fort.m.safety).toBeGreaterThan(open.m.safety);
    expect(fort.m.access).toBeLessThan(open.m.access);
  });
});

describe('money', () => {
  for (const key of ['open', 'balanced'] as const) {
    it(`event ledger reconciles with the PayPal twin to the cent (${key})`, async () => {
      const { w, events } = await runAll(small({ policy: PRESETS[key], chaos: 0.08 }));
      let net = 0;
      for (const e of events) {
        if (e.type === 'order' && !e.escrow) net += e.amount * e.charges;
        if (e.type === 'capture') net += e.amount;
        if (e.type === 'refund' && e.approved) net -= e.amount;
      }
      const rec = w.reconcile();
      expect(round2(net)).toEqual(rec.net);
      expect(rec.balanceSum).toEqual(0); // money is conserved
    });
  }

  it('PayPal-Request-Id reuse eliminates double charges under chaos', async () => {
    const off = await runAll(small({ policy: { ...PRESETS.open, idempotencyKeys: false }, chaos: 0.1 }));
    const on = await runAll(small({ policy: { ...PRESETS.open, idempotencyKeys: true }, chaos: 0.1 }));
    expect(off.m.chaos.duplicateCharges).toBeGreaterThan(0);
    expect(on.m.chaos.duplicateValue).toBeLessThan(off.m.chaos.duplicateValue / 5);
  });

  it('harm ledger is consistent', async () => {
    const { m } = await runAll(small({ policy: PRESETS.open }));
    expect(round2(m.fraud.prevented + m.fraud.leaked)).toBeLessThanOrEqual(m.fraud.attempted + 0.01);
    for (const k of Object.values(m.fraud.byKind)) expect(k.leaked).toBeGreaterThanOrEqual(-0.01);
  });
});
