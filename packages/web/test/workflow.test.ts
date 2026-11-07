import { describe, it, expect } from 'vitest';
import { confirmationText, experimentFor, overlayFor, recoveryExperiment } from '../src/workflow';
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
  it('a recorded recovery inspection has one complete descriptor for screen and export', () => {
    const draft = experimentFor('payment-recovery', 'inspection-1');
    const display = recoveryExperiment(draft);
    const exported = JSON.parse(JSON.stringify({ experiment: display }));
    expect(exported.experiment).toEqual(display);
    expect(display).toMatchObject({ id: draft.id, phase: 'complete', source: 'recorded-proof', inputRef: 'recovery-proof', seedOrDataset: 'crash-mw42uwv6', paymentMode: 'paypal-sandbox' });
    expect(recoveryExperiment(display)).toEqual(display);
    expect(draft.phase).toBe('draft');
  });
});
