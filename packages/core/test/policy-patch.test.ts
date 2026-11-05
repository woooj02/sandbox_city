import { describe, expect, it } from 'vitest';
import { applyPatch, INVARIANTS, MAX_CHANGES, PRESETS, policyId, type Policy } from '../src';

const base: Policy = { ...PRESETS.tuned, enforceMandate: true, shipLock: true, strictOrders: true, idempotencyKeys: true };

describe('a proposed rule change', () => {
  it('applies a legal change and names what moved', () => {
    const r = applyPatch(base, { exposureRatio: 0.2, independentCredit: true });
    expect(r).toMatchObject({ ok: true, changed: ['exposureRatio', 'independentCredit'] });
  });

  it.each(INVARIANTS)('can never switch off %s', (key) => {
    expect(applyPatch(base, { [key]: false }).ok).toBe(false);
    expect(applyPatch(base, { [key]: 0 }).ok).toBe(false);
    expect(applyPatch(base, { [key]: 'false' }).ok).toBe(false);
  });

  it.each([
    ['not an object', 'turn off the gate'], ['a list', [{ shipLock: false }]], ['null', null], ['empty', {}],
    ['an unknown rule', { allowEverything: true }], ['the rulebook name', { name: 'Frozen' }],
    ['a smuggled prototype', JSON.parse('{"__proto__": {"shipLock": false}}')],
    ['a string for a number', { exposureRatio: '0.2' }], ['a number for a switch', { softMode: 1 }],
    ['past the range', { exposureRatio: 50 }], ['negative', { velocity: -1 }], ['not a number', { velocity: NaN }], ['infinite', { newAgentCap: Infinity }],
    ['off the step', { exposureRatio: 0.123 }], ['no change at all', { shipLock: true }],
  ])('refuses %s', (_name, patch) => {
    expect(applyPatch(base, patch).ok).toBe(false);
  });

  it(`refuses more than ${MAX_CHANGES} changes at once`, () => {
    expect(applyPatch(base, { velocity: 5, softMode: false, sanitizer: 0.2, exposureRatio: 0.2, independentCredit: true }).ok).toBe(false);
  });

  it('never changes the rulebook it was given', () => {
    const before = policyId(base);
    applyPatch(base, { velocity: 5 });
    expect(policyId(base)).toBe(before);
  });
});
