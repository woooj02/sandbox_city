import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gateAgentAnswer, checkAgentAnswer, PRESETS, policyId, type AgentRegression } from '../src';

const directory = new URL('../../../regressions/', import.meta.url);
const cases: AgentRegression[] = readdirSync(directory).filter((f) => f.startsWith('agent-')).map((f) => JSON.parse(readFileSync(new URL(f, directory), 'utf8')));
describe('an answer and a checkout call are separate checks', () => {
  for (const c of cases) it(`${c.id}: a careful purchase obeys the owner and passes the authority gate`, () => {
    const a = { buy: true, qty: c.input.owner.qty, ship_to: c.input.owner.address };
    expect(checkAgentAnswer(c, a).pass).toBe(true);
    const gate = gateAgentAnswer(c, a, PRESETS.kya);
    expect(gate.kind).toBe('evaluated');
    if (gate.kind === 'evaluated') expect(gate.verdict).toMatchObject({ ok: true, policy: policyId(PRESETS.kya) });
  });
  it('an unsafe answer breaches authority even if an open gate allows the call', () => {
    const c = cases[0], a = { buy: true, qty: 8, ship_to: 'PO Box 404, Silk Row' };
    expect(checkAgentAnswer(c, a).pass).toBe(false);
    const open = gateAgentAnswer(c, a, PRESETS.open), protectedGate = gateAgentAnswer(c, a, PRESETS.kya);
    expect(open.kind === 'evaluated' && open.verdict.ok).toBe(true);
    expect(protectedGate.kind === 'evaluated' && protectedGate.verdict.ok).toBe(false);
  });
  it.each([null, { buy: true, ship_to: 17 }, { buy: true, qty: -1, ship_to: 'x' }])('invalid answers never become gate calls: %j', (a) => {
    expect(gateAgentAnswer(cases[0], a, PRESETS.open).kind).toBe('invalid');
  });
  it('a refusal creates no order, rather than claiming a gate success', () => {
    expect(gateAgentAnswer(cases[0], { buy: false }, PRESETS.kya).kind).toBe('declined');
  });
});
