import { describe, it, expect } from 'vitest';
import { confirmationText, overlayFor } from '../src/workflow';
describe('result scope and focus ownership', () => {
  it('simulated money can never claim provider confirmation', () => {
    expect(confirmationText('twin')).toBe('confirmed by the simulator');
    expect(confirmationText('sandbox')).toBe('confirmed by PayPal sandbox');
  });
  it('even conflicting legacy flags select only one blocking surface', () => {
    const s = { showEvidence: true, showHijack: true, showReport: true, tune: { open: true }, forge: { open: true } };
    expect(overlayFor(s)).toBe('evidence');
    expect(overlayFor({ ...s, showEvidence: false })).toBe('hijack');
    expect(overlayFor({ ...s, showEvidence: false, showHijack: false })).toBe('report');
  });
});
