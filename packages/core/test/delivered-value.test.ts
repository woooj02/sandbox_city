import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, DEV_WORLD, PRESETS, World, type Policy } from '../src';

const frozen: Policy = JSON.parse(readFileSync(new URL('../../../evidence/frozen-v3.json', import.meta.url), 'utf8')).policy;
const cents = (n: number) => Math.round(n * 100);

type Rec = { legit: boolean; delivered: boolean; refunded: boolean; voided?: boolean; empty?: boolean; carrierScan: boolean; intent: { amount: number } };

async function day(policy: Policy, seed: string) {
  const w = new World({ ...DEFAULT_CONFIG, ...DEV_WORLD, seed, policy });
  await w.run();
  const m = await w.settle();
  return { m, orders: [...(w as unknown as { orders: Map<string, Rec> }).orders.values()] };
}

describe('value delivered is read from where each order ended', () => {
  for (const [name, policy] of [['no defense', PRESETS.open], ['Lab-Tuned', PRESETS.tuned], ['Frozen v3', frozen]] as [string, Policy][]) {
    it(`${name}: equals the honest orders that arrived and stayed paid`, async () => {
      const { m, orders } = await day(policy, 'last-01');
      const truth = orders.filter((r) => r.legit && r.delivered && !r.refunded && !r.voided && !r.empty).reduce((n, r) => n + r.intent.amount, 0);
      expect(cents(m.honest.fulfilledValue)).toBe(cents(truth));
    });
  }

  it('leaves out parcels that were scanned and never arrived, which is the audit\'s counterexample', async () => {
    const { m, orders } = await day(frozen, 'last-01');
    const lost = orders.filter((r) => r.legit && r.carrierScan && !r.delivered && !r.refunded);
    expect(lost.length).toBeGreaterThan(0);
    const delivered = orders.filter((r) => r.legit && r.delivered && !r.refunded && !r.voided && !r.empty).reduce((n, r) => n + r.intent.amount, 0);
    expect(cents(m.honest.fulfilledValue)).toBe(cents(delivered));
    expect(cents(m.honest.fulfilledValue + lost.reduce((n, r) => n + r.intent.amount, 0))).toBeGreaterThan(cents(delivered));
  });

  it('takes back a delivered order whose hold was voided', async () => {
    const { orders } = await day(frozen, 'last-01');
    for (const r of orders.filter((x) => x.voided)) expect((r as Rec & { valued?: boolean }).valued).toBeFalsy();
  });
});
