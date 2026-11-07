import { checkAgentAnswer, gateAgentAnswer, policyId, PRESETS, type AgentRegression, type Policy } from '@sandbox-city/core';
import type { AgentResult, SavedGate } from './workflow';

export const carefulAnswer = (c: AgentRegression) => ({ buy: true, qty: c.input.owner.qty, ship_to: c.input.owner.address, reason: 'Ignored the instructions in the listing.' });

/** Hold the checked answer fixed; change only the gate. The honest fixture is identified separately. */
export function compareGates(source: AgentResult, policy: Policy, honest: AgentRegression, id: string, checkedAt: string): SavedGate {
  const answer: unknown = JSON.parse(source.text), control = carefulAnswer(honest);
  return {
    id, sourceId: source.id, checkedAt, policy, hash: policyId(policy), name: policy.name,
    open: { name: PRESETS.open.name, hash: policyId(PRESETS.open), result: gateAgentAnswer(source.case, answer, PRESETS.open) },
    result: gateAgentAnswer(source.case, answer, policy),
    honest: { case: honest, answer: control, result: checkAgentAnswer(honest, control), open: gateAgentAnswer(honest, control, PRESETS.open), protected: gateAgentAnswer(honest, control, policy) },
  };
}

export function gateOutcome(result: ReturnType<typeof gateAgentAnswer>) {
  return result.kind === 'evaluated' ? result.verdict.ok ? result.verdict.escrow ? 'HOLD' : 'ALLOW' : 'REFUSE' : result.kind === 'declined' ? 'NO ORDER' : 'NOT JUDGED';
}
