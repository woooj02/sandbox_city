import { describe, expect, it } from 'vitest';
import { checkoutOrder, DEFAULT_CONFIG, EVALUATOR_VERSION, evaluateOrder, observe, policyId, PRESETS, World, type CheckoutArgs, type GateContext, type GateResult, type OrderIntent } from '../src';

/** An order from the simulated day, written as the toolkit call that would place it. */
function asToolCall(o: OrderIntent): CheckoutArgs {
  const [line, ...rest] = o.shipTo.split(',');
  return {
    currencyCode: 'USD', items: [{ name: o.sku, quantity: o.qty, itemCost: o.unit, itemTotal: Math.round(o.unit * 100) * o.qty / 100 }],
    shippingAddress: { address_line_1: line.trim(), admin_area_2: rest.join(',').trim() || undefined },
  };
}

async function day(policy: typeof PRESETS.open) {
  const seen: { o: OrderIntent; ctx: GateContext; gate: GateResult }[] = [];
  const w = new World({ ...DEFAULT_CONFIG, seed: 'parity-day', shoppers: 200, merchants: 40, crypto: 'modeled', policy, gateTap: (o, ctx, gate) => seen.push({ o, ctx, gate }) });
  await w.run();
  return seen;
}

describe('one evaluator, two front doors', () => {
  it.each(Object.keys(PRESETS))('a day of orders under %s decides the same through the checkout contract', async (key) => {
    const policy = PRESETS[key];
    const seen = await day(policy);
    expect(seen.length).toBeGreaterThan(300);
    let compared = 0;
    for (const { o, ctx, gate } of seen) {
      if (Math.round(o.amount * 100) !== Math.round(o.unit * 100) * o.qty) continue; // replayed requests carry a rounded unit
      const order = checkoutOrder(asToolCall(o), { passport: ctx.passport ?? ({ address: '' } as never), category: o.category });
      expect(order.malformed).toBeUndefined();
      expect(evaluateOrder(policy, order, ctx)).toEqual(gate);
      compared++;
    }
    expect(compared).toBeGreaterThan(300);
  });

  it('the gate cannot see ground truth: flipping every label changes no decision', async () => {
    const policy = PRESETS.balanced;
    for (const { o, ctx, gate } of await day(policy)) {
      const relabelled = { ...o, truth: { malicious: !o.truth.malicious, harm: 99999, attack: 'fraud_ring' as const, attacker: 'X', hijacked: true } };
      expect(evaluateOrder(policy, observe(relabelled), ctx)).toEqual(gate);
      expect(Object.keys(observe(o))).not.toContain('truth');
    }
  });

  it('a rulebook has one id wherever it runs, whatever it is called', () => {
    expect(policyId({ ...PRESETS.tuned, name: 'Renamed' })).toBe(policyId(PRESETS.tuned));
    expect(policyId({ ...PRESETS.tuned, velocity: 9 })).not.toBe(policyId(PRESETS.tuned));
    expect(EVALUATOR_VERSION).toMatch(/^gate-/);
  });
});
