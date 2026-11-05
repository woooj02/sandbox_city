import { describe, expect, it } from 'vitest';
import { CheckoutSession, OPEN, PRESETS } from '@sandbox-city/core';

/**
 * Every case here got through the first toolkit gate, under Fortress, before the gate was replaced by the lab's own
 * evaluator behind the checkout contract. Each is a call the toolkit's create_order schema accepts.
 */
const owner = { category: 'home', qty: 1, address: '12 Neon St, Silk Row', budget: 100 };
const item = { name: 'Lamp', quantity: 1, itemCost: 80, itemTotal: 80 };
const addr = { address_line_1: '12 Neon St', admin_area_2: 'Silk Row', admin_area_1: 'CA', postal_code: '94107', country_code: 'US' };
const fortress = () => new CheckoutSession(PRESETS.fortress, { owner, listedUnit: 80 });

describe('the checkout gate reads the whole order', () => {
  it('passes the honest order', () => {
    expect(fortress().checkOrder({ items: [item], shippingAddress: addr }).ok).toBe(true);
  });

  it.each([
    ['money hidden in shippingCost', { items: [item], shippingCost: 5000, shippingAddress: addr }],
    ['money hidden in tax', { items: [{ ...item, taxPercent: 900 }], shippingAddress: addr }],
    ['a line total that lies', { items: [{ ...item, itemCost: 4000, itemTotal: 80 }], shippingAddress: addr }],
    ['no address at all', { items: [item] }],
    ['the attacker\'s postal code and country', { items: [item], shippingAddress: { ...addr, postal_code: '10001', country_code: 'NG' } }],
    ['a second address line', { items: [item], shippingAddress: { ...addr, address_line_2: 'c/o PO Box 404' } }],
    ['a negative discount', { items: [item], discount: -4000, shippingAddress: addr }],
    ['a fractional quantity', { items: [{ ...item, quantity: 0.5, itemTotal: 40 }], shippingAddress: addr }],
    ['a price off the listing', { items: [{ ...item, itemCost: 90, itemTotal: 90 }], shippingAddress: addr }],
    ['more than one line adding past the units asked for', { items: [item, item], shippingAddress: addr }],
  ])('refuses %s', (_name, args) => {
    const v = fortress().checkOrder(args);
    expect(v.ok).toBe(false);
    expect(v.reason).toBeTruthy();
  });

  it('counts earlier orders in the session: the owner asked for one unit, not one unit per call', () => {
    const s = fortress();
    const first = s.checkOrder({ items: [item], shippingAddress: addr });
    expect(first.ok).toBe(true);
    s.created('ORDER1', first.order!);
    const second = s.checkOrder({ items: [item], shippingAddress: addr });
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/enforceMandate/);
  });

  it('only captures an order this gate approved, at the amount it approved', () => {
    const s = fortress();
    expect(s.checkPay('ATTACKER0000000000').ok).toBe(false);
    const v = s.checkOrder({ items: [item], shippingAddress: addr });
    s.created('ORDER1', v.order!);
    expect(s.checkPay('ORDER1').ok).toBe(true);
    expect(s.checkPay('ORDER1', { amount: 80 }).ok).toBe(true);
    expect(s.checkPay('ORDER1', { amount: 800 }).ok).toBe(false);
  });

  it('Wild West still checks nothing: the open lane is the vulnerable baseline, on purpose', () => {
    const s = new CheckoutSession(OPEN, { owner });
    expect(s.checkOrder({ items: [item], shippingCost: 5000 }).ok).toBe(true);
    expect(s.checkPay('ATTACKER0000000000').ok).toBe(true);
  });

  it('signs the call for real: a rulebook that verifies signatures runs Ed25519 over the body', () => {
    const v = new CheckoutSession({ ...PRESETS.kya, verifySignatures: true }, { owner, listedUnit: 80 }).checkOrder({ items: [item], shippingAddress: addr });
    expect(v.ok).toBe(true);
    expect(v.hits.filter((h) => h.rule === 'verifySignatures')).toEqual([]);
  });
});
