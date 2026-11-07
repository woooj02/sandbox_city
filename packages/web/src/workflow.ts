import type { gateAgentAnswer, AgentRegression, CaseResult, Policy, Prices } from '@sandbox-city/core';

declare const __BUILD__: string;
export type Task = 'agent-authority' | 'policy-cost' | 'payment-recovery';
export interface Experiment {
  id: string; build?: string; task: Task; phase: 'draft' | 'running' | 'pending' | 'complete' | 'failed';
  source: 'current-run' | 'recorded-benchmark' | 'recorded-proof';
  paymentMode: 'simulated' | 'paypal-sandbox' | 'fixture';
  scenario: { id: string; version: string };
  inputRef: string; seedOrDataset: string; candidatePolicyHash?: string; prices?: Prices;
}
export const experimentFor = (task: Task, id: string): Experiment => ({
  id, task, build: typeof __BUILD__ === 'undefined' ? 'local development' : __BUILD__, phase: 'draft', source: task === 'policy-cost' ? 'recorded-benchmark' : task === 'payment-recovery' ? 'recorded-proof' : 'current-run',
  paymentMode: task === 'payment-recovery' ? 'paypal-sandbox' : 'simulated',
  scenario: { id: task === 'policy-cost' ? 'standard' : task === 'payment-recovery' ? 'crash-recovery' : 'listing-authority', version: task === 'policy-cost' ? 'benchmark-v4' : '1' },
  inputRef: task === 'policy-cost' ? 'benchmark-v4' : task === 'payment-recovery' ? 'recovery-proof' : 'agent-hijack-paid-on-sandbox',
  seedOrDataset: task === 'policy-cost' ? 'fair-01…fair-30' : task === 'payment-recovery' ? 'crash-mw42uwv6' : 'portable-regressions@1',
});
export interface AgentResult {
  id: string;
  experiment: Experiment; case: AgentRegression; text: string; method: 'sample' | 'pasted-answer' | 'local-command';
  result: CaseResult; checkedAt: string;
}
export interface SavedDecision {
  schema: string; selected: { key: string; name: string; label: string; policyHash: string };
  prices: Prices; scenario: { key: string; assumption: string }; rules: Policy;
  reason: string; experiment?: Experiment;
}
export const confirmationText = (rail: 'twin' | 'sandbox') => rail === 'sandbox' ? 'confirmed by PayPal sandbox' : 'confirmed by the simulator';

/** One blocking surface owns focus, even when an older control sets several flags. */
export function overlayFor(s: { showHijack: boolean; showEvidence: boolean; showReport: boolean; tune: { open: boolean }; forge: { open: boolean } }) {
  return s.showEvidence ? 'evidence' : s.showHijack ? 'hijack' : s.showReport ? 'report' : s.tune.open ? 'tune' : s.forge.open ? 'forge' : null;
}

export interface SavedGate {
  id: string; sourceId: string; checkedAt: string; policy: Policy;
  hash: string; name: string; result: ReturnType<typeof gateAgentAnswer>;
  open: { hash: string; name: string; result: ReturnType<typeof gateAgentAnswer> };
  honest: { case: AgentRegression; answer: unknown; result: CaseResult; open: ReturnType<typeof gateAgentAnswer>; protected: ReturnType<typeof gateAgentAnswer> };
}

/** Selection is by observation identity, never by case, text or timestamp. */
export function observationSelection(results: AgentResult[], gates: SavedGate[], id: string | null) {
  const result = results.find((r) => r.id === id) ?? null;
  const gate = result ? [...gates].reverse().find((g) => g.sourceId === result.id) ?? null : null;
  return { result, gate };
}

export function restoreObservation(results: AgentResult[], gates: SavedGate[], id: string, cases: AgentRegression[]) {
  const { result, gate } = observationSelection(results, gates, id);
  if (!result) return null;
  const pick = cases.findIndex((c) => c.id === result.case.id);
  if (pick < 0) return null;
  return { agentSelectedId: result.id, agentDraft: { pick, text: result.text, method: result.method }, agentGatePolicy: gate?.policy ?? null, experiment: result.experiment };
}

/** The screen and download both inspect this completed recorded experiment. */
export function recoveryExperiment(experiment: Experiment): Experiment {
  return { ...experiment, task: 'payment-recovery', phase: 'complete', source: 'recorded-proof', paymentMode: 'paypal-sandbox', scenario: { id: 'crash-recovery', version: '1' }, inputRef: 'recovery-proof', seedOrDataset: 'crash-mw42uwv6' };
}
