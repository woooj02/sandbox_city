import { describe, expect, it } from 'vitest';
import { isIndependentBuyer, PRESETS, settlement, type Policy } from '../src';

const holds: Policy = { ...PRESETS.open, releaseLag: 600, captureAfterRelease: true };
const lagged: Policy = { ...PRESETS.open, releaseLag: 600 };
const fresh = { held: true, delivered: false, disputed: false, credited: false };

describe('settlement', () => {
  it('holds through the window under a rulebook that says so', () => {
    expect(settlement(holds, 'delivered', { ...fresh, delivered: true })).toEqual([]);
    expect(settlement(holds, 'window-closed', { ...fresh, delivered: true })).toEqual(['release', 'credit']);
  });
  it('voids a hold nobody delivered on, or that the buyer disputed', () => {
    expect(settlement(holds, 'window-closed', fresh)).toEqual(['void']);
    expect(settlement(holds, 'window-closed', { ...fresh, delivered: true, disputed: true })).toEqual(['void']);
  });
  it('releases at the scan under a rulebook without the window', () => {
    expect(settlement(PRESETS.open, 'delivered', { ...fresh, delivered: true })).toEqual(['release', 'credit']);
    expect(settlement(lagged, 'delivered', { ...fresh, delivered: true })).toEqual(['release']);
    expect(settlement(lagged, 'window-closed', { ...fresh, held: false, delivered: true })).toEqual(['credit']);
  });
  it('a captured order earns once, and a disputed one never', () => {
    const paid = { ...fresh, held: false, delivered: true };
    expect(settlement(holds, 'window-closed', paid)).toEqual(['credit']);
    expect(settlement(holds, 'window-closed', { ...paid, credited: true })).toEqual([]);
    expect(settlement(holds, 'window-closed', { ...paid, disputed: true })).toEqual([]);
  });
});

describe('independent buyers', () => {
  it('needs an account older than the store and a history mostly elsewhere', () => {
    expect(isIndependentBuyer(0, 100, 1, 10)).toBe(true);
    expect(isIndependentBuyer(200, 100, 1, 10)).toBe(false);
    expect(isIndependentBuyer(0, 100, 6, 10)).toBe(false);
  });
});
