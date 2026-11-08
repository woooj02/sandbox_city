import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalAddress, CheckoutSession, fuzzGate, FUZZ_OWNER, type CheckoutArgs, type Policy } from '../src';

const book = (n: string) => JSON.parse(readFileSync(new URL(`../../../evidence/${n}.json`, import.meta.url), 'utf8')).policy as Policy;
const owner = { address_line_1: '12 Neon St, Silk Row', admin_area_1: 'CA', postal_code: '94107', country_code: 'US' };
const order = (address: object = owner, line: object = {}, extra: object = {}): CheckoutArgs => ({ currencyCode: 'USD', items: [{ name: 'Earbuds', quantity: 1, itemCost: 289.5, itemTotal: 289.5, ...line }], shippingAddress: address, ...extra });
const session = () => new CheckoutSession({ ...book('frozen-v4'), verifySignatures: false }, { owner: FUZZ_OWNER, listedUnit: 289.5 });
const allowed = (a: CheckoutArgs) => session().checkOrder(a).ok;

describe('differential fuzz of the gate', () => {
  for (const name of ['frozen-v3', 'frozen-v4']) it(`${name}: allows nothing the reference rejects, refuses nothing it accepts, never throws`, () => {
    const r = fuzzGate(book(name), 15000, `test-${name}`);
    expect(r.findings).toEqual([]);
    expect(r.allowed).toBeGreaterThan(1000);
    expect(r.refused).toBeGreaterThan(1000);
  });
});

describe('bypasses the fuzzer found, kept as cases', () => {
  it.each([
    ['text in another script after the owner address', { ...owner, address_line_1: '12 Neon St, Silk Row 東京都' }],
    ['digits in another script', { ...owner, address_line_1: '12 Neon St, Silk Row ١٢' }],
    ['a Cyrillic letter in the street', { ...owner, address_line_1: '12 Nеon St, Silk Row' }],
    ['digits moved apart', { ...owner, address_line_1: '1 2 Neon St, Silk Row' }],
    ['a city that is only part of the line', { ...owner, admin_area_2: 'Row' }],
    ['a city that is a word of the street', { ...owner, admin_area_2: 'Neon' }],
    ['a punctuation second line', { ...owner, address_line_2: '#' }],
    ['a number for a street', { ...owner, address_line_1: 12 }],
    ['order fields inside the address, found only at 200,000 orders', { ...owner, quantity: 8, itemTotal: 2316 }],
  ])('refuses %s', (_n, address) => expect(allowed(order(address))).toBe(false));

  it.each([
    ['a sub-cent price that rounds to the listed one', order(owner, { itemCost: 289.499, itemTotal: 289.499 })],
    ['a sub-cent shipping charge', order(owner, {}, { shippingCost: 0.004 })],
    ['a discount larger than the order', order(owner, {}, { discount: 1000 })],
    ['a line that is not an item', { items: [1e21 as never], shippingAddress: owner }],
    ['an empty currency', order(owner, {}, { currencyCode: '' })],
    ['items that are not a list', { items: 'all' as never, shippingAddress: owner }],
  ])('refuses %s', (_n, args) => expect(allowed(args)).toBe(false));

  it('reads junk without throwing', () => {
    for (const junk of [null, 0, 'x', [], {}, [null], { items: [null] }, { items: [[]], shippingAddress: 7 }]) expect(() => session().checkOrder(junk as never)).not.toThrow();
  });
});

describe('the honest order still passes', () => {
  it.each([
    ['as written', owner],
    ['in capitals', { ...owner, address_line_1: '12 NEON ST, SILK ROW' }],
    ['with a full stop', { ...owner, address_line_1: '12 Neon St., Silk Row.' }],
    ['with the city in its own field', { ...owner, address_line_1: '12 Neon St', admin_area_2: 'Silk Row' }],
    ['with the city repeated', { ...owner, admin_area_2: 'silk row' }],
    ['with lower-case state', { ...owner, admin_area_1: 'ca', country_code: 'us' }],
  ])('%s', (_n, address) => expect(allowed(order(address))).toBe(true));

  it("an address with no district is sent with the owner's, not a placeholder", () => {
    const s = session();
    expect(canonicalAddress({ ...owner, address_line_1: '12 Neon St' }, s.scope)?.admin_area_2).toBe('Silk Row');
  });

  it('invisible characters never reach PayPal', () => {
    const s = session();
    const sent = canonicalAddress({ ...owner, address_line_2: '​', address_line_1: '12 Neon St, Silk Row‮' }, s.scope);
    expect(sent?.address_line_2).toBeUndefined();
    expect(sent?.address_line_1).toBe('12 Neon St');
  });
});
