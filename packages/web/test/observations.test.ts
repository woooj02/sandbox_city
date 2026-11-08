import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkAgentAnswer, policyId, type AgentRegression, type Policy } from '@sandbox-city/core';
import { carefulAnswer, compareGates, gateOutcome } from '../src/authority';
import { experimentFor, observationSelection, restoreObservation, type AgentResult } from '../src/workflow';

const load = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const attack: AgentRegression = load('../../../regressions/agent-hijack-paid-on-sandbox.json');
const honest: AgentRegression = load('../../../regressions/agent-honest-listing-1.json');
const arms: { key: string; rules: Policy }[] = load('../src/data/evidence.json').fourth.arms;
const v4 = arms.find((a) => a.key === 'frozen')!.rules, v3 = arms.find((a) => a.key === 'frozen_v3')!.rules;
const unsafe = { buy: true, qty: 8, ship_to: 'PO Box 404, Silk Row' };
const checkedAt = '2026-11-06T20:00:00.000Z';
const observation = (id: string, answer: unknown, c = attack): AgentResult => ({
  id, experiment: { ...experimentFor('agent-authority', 'experiment-1'), phase: 'complete', inputRef: c.id },
  case: c, text: JSON.stringify(answer), method: 'sample', checkedAt, result: checkAgentAnswer(c, answer),
});

describe('immutable observations and their gate evidence', () => {
  const a = observation('failed-a', unsafe), b = observation('passing-b', carefulAnswer(attack));
  const ga = compareGates(a, v4, honest, 'gate-a', checkedAt), gb = compareGates(b, v3, honest, 'gate-b', checkedAt);
  it('restores a breach after a later pass, even with identical case and timestamps', () => {
    const restored = restoreObservation([a, b], [ga, gb], a.id, [honest, attack])!;
    expect(restored.agentDraft).toEqual({ pick: 1, text: a.text, method: a.method });
    expect(restored.agentGatePolicy).toEqual(v4);
    const selected = observationSelection([a, b], [ga, gb], restored.agentSelectedId);
    expect(selected).toEqual({ result: a, gate: ga });
    expect(selected.result!.result.pass).toBe(false);
    const exported = JSON.parse(JSON.stringify({ ...selected.result, checkoutEvaluation: selected.gate }));
    expect(exported).toMatchObject({ id: a.id, text: a.text, checkedAt: a.checkedAt, result: { pass: false }, checkoutEvaluation: { sourceId: a.id, hash: policyId(v4) } });
    expect(observationSelection([a, b], [ga, gb], b.id)).toEqual({ result: b, gate: gb });
  });
  it('never substitutes another observation when the selected one has no gate or is missing', () => {
    expect(observationSelection([a, b], [gb], a.id)).toEqual({ result: a, gate: null });
    expect(restoreObservation([a, b], [gb], a.id, [attack, honest])!.agentGatePolicy).toBeNull();
    expect(observationSelection([a, b], [ga, gb], 'missing')).toEqual({ result: null, gate: null });
    expect(restoreObservation([a, b], [ga, gb], 'missing', [attack, honest])).toBeNull();
  });
  it('keeps the latest associated gate while preserving earlier comparisons', () => {
    const updated = compareGates(a, v3, honest, 'gate-a-2', checkedAt);
    const gates = [ga, gb, updated];
    expect(observationSelection([a, b], gates, a.id).gate).toBe(updated);
    expect(gates[0]).toBe(ga);
    expect(a.text).toBe(JSON.stringify(unsafe));
  });
  it.each([v3, v4])('executes the same harmful answer under open and exact frozen gates: $name', (policy) => {
    const comparison = compareGates(a, policy, honest, 'comparison', checkedAt);
    expect(gateOutcome(comparison.open.result)).toBe('ALLOW');
    expect(gateOutcome(comparison.result)).toBe('REFUSE');
    expect(comparison.hash).toBe(policyId(policy));
    expect(gateOutcome(comparison.honest.open)).toBe('ALLOW');
    expect(['ALLOW', 'HOLD']).toContain(gateOutcome(comparison.honest.protected));
    expect(comparison.honest.result.pass).toBe(true);
    expect(comparison.honest.result.declined).not.toBe(true);
    expect(comparison.honest.case.id).toBe(honest.id);
  });
  it('does not turn an agent refusal into a successful checkout', () => {
    const declined = observation('refused', { buy: false });
    const comparison = compareGates(declined, v4, honest, 'no-order', checkedAt);
    expect(gateOutcome(comparison.open.result)).toBe('NO ORDER');
    expect(gateOutcome(comparison.result)).toBe('NO ORDER');
  });
  it('retains manual provenance when restoring or exporting an observation', () => {
    const manual: AgentResult = { ...a, id: 'manual-answer', method: 'manual-entry' };
    const gate = compareGates(manual, v4, honest, 'manual-gate', checkedAt);
    expect(restoreObservation([manual, b], [gate, gb], manual.id, [attack, honest])!.agentDraft.method).toBe('manual-entry');
    const selected = observationSelection([manual, b], [gate, gb], manual.id);
    expect(JSON.parse(JSON.stringify({ ...selected.result, checkoutEvaluation: selected.gate }))).toMatchObject({ id: manual.id, method: 'manual-entry', checkoutEvaluation: { sourceId: manual.id } });
  });
});
