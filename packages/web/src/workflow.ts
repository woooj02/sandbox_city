import type { gateAgentAnswer, AgentRegression, CaseResult, Policy, Prices } from '@sandbox-city/core';

declare const __BUILD__: string;
export type Task = 'agent-authority' | 'policy-cost' | 'payment-recovery';
export interface Experiment {
  id: string; build?: string; task: Task; phase: 'draft' | 'running' | 'pending' | 'complete' | 'failed';
  source: 'current-run' | 'recorded-benchmark' | 'recorded-proof';
  paymentMode: 'simulated' | 'paypal-sandbox' | 'fixture';
  scenario: { id: string; version: string; approximation: boolean };
  inputRef: string; seedOrDataset: string; candidatePolicyHash?: string; prices?: Prices;
}
export const experimentFor = (task: Task, id: string): Experiment => ({
  id, task, build: typeof __BUILD__ === 'undefined' ? 'local development' : __BUILD__, phase: 'draft', source: task === 'policy-cost' ? 'recorded-benchmark' : task === 'payment-recovery' ? 'recorded-proof' : 'current-run',
  paymentMode: task === 'payment-recovery' ? 'paypal-sandbox' : 'simulated',
  scenario: { id: task === 'policy-cost' ? 'standard' : task === 'payment-recovery' ? 'crash-recovery' : 'listing-authority', version: task === 'policy-cost' ? 'benchmark-v4' : '1', approximation: false },
  inputRef: task === 'policy-cost' ? 'benchmark-v4' : task === 'payment-recovery' ? 'recovery-proof' : 'agent-hijack-paid-on-sandbox',
  seedOrDataset: task === 'policy-cost' ? 'fair-01…fair-30' : task === 'payment-recovery' ? 'crash-mw42uwv6' : 'portable-regressions@1',
});
export interface AgentResult {
  experiment: Experiment; case: AgentRegression; text: string; method: 'sample' | 'pasted-answer' | 'local-command';
  result: CaseResult; checkedAt: string;
}
export interface SavedDecision {
  schema: string; selected: { key: string; name: string; label: string; policyHash: string };
  prices: Prices; scenario: { key: string; approximation: boolean; assumption: string }; rules: Policy;
  reason: string; experiment?: Experiment;
}
export const confirmationText = (rail: 'twin' | 'sandbox') => rail === 'sandbox' ? 'confirmed by PayPal sandbox' : 'confirmed by the simulator';

/** One blocking surface owns focus, even when an older control sets several flags. */
export function overlayFor(s: { showHijack: boolean; showEvidence: boolean; showReport: boolean; tune: { open: boolean }; forge: { open: boolean } }) {
  return s.showEvidence ? 'evidence' : s.showHijack ? 'hijack' : s.showReport ? 'report' : s.tune.open ? 'tune' : s.forge.open ? 'forge' : null;
}

export interface SavedGate {
  hash: string; name: string; source: AgentResult; result: ReturnType<typeof gateAgentAnswer>;
}
