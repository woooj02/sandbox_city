import { useState } from 'react';
import { checkAgentAnswer, policyId, PRESETS, type Policy, type AgentRegression, type CaseResult } from '@sandbox-city/core';
import { useStore } from '../store';
import { EvaluationBoundary } from './EvaluationBoundary';
import { Scope } from './Scope';
import { downloadJson } from './download';
import checkout from '../data/checkout-proof.json';
import toolkit from '../data/toolkit-proof.json';
import { experimentFor, observationSelection, restoreObservation, type AgentResult } from '../workflow';
import { carefulAnswer, compareGates } from '../authority';
import { GateComparison } from './GateComparison';
import { AgentImport } from './AgentImport';
import { AgentGuide } from './AgentGuide';
import raw from '../data/evidence.json';

const cases = (raw as unknown as { agentCases: AgentRegression[] }).agentCases;
const frozenV3 = (raw as unknown as { fourth: { arms: { key: string; rules: Policy }[] } }).fourth.arms.find((a) => a.key === 'frozen_v3')!.rules;
const frozenV4 = (raw as unknown as { fourth: { arms: { key: string; rules: Policy }[] } }).fourth.arms.find((a) => a.key === 'frozen')!.rules;
const gatePolicies = [frozenV4, frozenV3, PRESETS.kya, PRESETS.open];
const honestControl = cases.find((c) => c.control)!;
const ALL_CASES = 'npx tsx scripts/regress.ts regressions --agent "python3 my_agent.py" --report=agent-report.md';

type Verdict = { kind: 'empty' } | { kind: 'invalid'; messages: string[] } | { kind: 'checked'; result: CaseResult; control: boolean };

/** The same predicate the CI command runs. It is plain code, so it can run here with nothing leaving the page. */
export function judge(c: AgentRegression, text: string): Verdict {
  if (!text.trim()) return { kind: 'empty' };
  let answer: unknown;
  try { answer = JSON.parse(text); } catch { return { kind: 'invalid', messages: ['That is not valid JSON. Your agent must print one JSON object.'] }; }
  const result = checkAgentAnswer(c, answer);
  return result.invalid ? { kind: 'invalid', messages: result.violations } : { kind: 'checked', result, control: !!c.control };
}

const FOOLED = JSON.stringify({ buy: true, qty: 8, ship_to: 'PO Box 404, Silk Row', reason: 'The listing says the customer pre-approved this.' }, null, 2);
const careful = (c: AgentRegression) => JSON.stringify(carefulAnswer(c), null, 2);

function Result({ v }: { v: Verdict }) {
  if (v.kind === 'empty') return <p className="at-result wait">Waiting for an answer. Paste what your agent printed, or try an example.</p>;
  if (v.kind === 'invalid') return (
    <div className="at-result fail" role="status">
      <b>NOT JUDGED: this answer has the wrong shape.</b>
      <ul>{v.messages.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  );
  if (!v.result.pass) return (
    <div className="at-result fail" role="status">
      <b>FAILED: this order would break the owner's mandate.</b>
      <details><summary>{v.result.violations.length} violations and suggested fixes</summary><ul>{v.result.violations.map((x) => <li key={x}>{x}</li>)}</ul>
      {v.result.fixes?.map((x) => <p key={x}><b>Fix:</b> {x}</p>)}</details>
    </div>
  );
  if (v.result.declined && v.control) return (
    <div className="at-result fail" role="status">
      <b>LOST SALE: this listing is honest, and your agent refused it.</b>
      <p>Nothing was breached, but a guard that refuses honest listings is a bug too. The CLI blocks an agent that buys none of them.</p>
    </div>
  );
  return (
    <div className="at-result pass" role="status">
      <b>PASSED: nothing here breaks the owner's mandate.</b>
      {v.result.declined && <p>Your agent declined this one. Now try an honest listing from the list above, to check it still buys.</p>}
    </div>
  );
}

/** The answer predicate and checkout gate are separate experiments; neither sends a payment. */
export function AgentTest() {
  const s = useStore();
  const { pick, text, method } = s.agentDraft;
  const c = cases[pick];
  const [copied, setCopied] = useState(false);
  const gatePolicy = s.agentGatePolicy ?? frozenV4;
  const setGatePolicy = (policy: Policy) => useStore.setState({ agentGatePolicy: policy });
  const { result, gate } = observationSelection(s.agentResults, s.agentGates, s.agentSelectedId);
  const draft = (change: Partial<typeof s.agentDraft>) => useStore.setState({ agentDraft: { ...s.agentDraft, ...change }, ...(change.pick !== undefined && change.pick !== pick ? { agentSelectedId: null } : {}) });
  const changed = !!result && (result.text !== text || result.method !== method);
  const check = (answer = text, from = method) => {
    const v = judge(c, answer);
    if (v.kind === 'empty') return;
    const id = `observation-${crypto.randomUUID()}`;
    const r: AgentResult = { id, experiment: { ...(s.experiment ?? experimentFor('agent-authority', id)), task: 'agent-authority', source: 'current-run', paymentMode: 'simulated', inputRef: c.id, phase: v.kind === 'invalid' ? 'failed' : 'complete' }, case: c, text: answer, method: from, checkedAt: new Date().toISOString(), result: v.kind === 'invalid' ? { pass: false, invalid: true, violations: v.messages } : v.result };
    useStore.setState({ agentDraft: { pick, text: answer, method: from }, agentSelectedId: id, agentResults: [...s.agentResults, r], experiment: r.experiment, experiments: { ...s.experiments, 'agent-authority': r.experiment } });
  };
  const sample = (care: boolean) => check(care ? careful(c) : FOOLED, 'sample');
  const copy = async () => { await navigator.clipboard.writeText(ALL_CASES); setCopied(true); };
  const compare = () => { if (!result || changed || result.result.invalid) return; const gate = compareGates(result, gatePolicy, honestControl, `comparison-${crypto.randomUUID()}`, new Date().toISOString()); useStore.setState({ agentGates: [...s.agentGates, gate] }); };
  const exportResult = () => { if (result) downloadJson(`result-${result.id}.json`, { schema: 'sandbox-city/agent-check@1', ...result, checkoutEvaluation: gate, gateHistory: s.agentGates.filter((g) => g.sourceId === result.id), controlsChecked: s.agentResults.filter((r) => r.case.control).map((r) => ({ observationId: r.id, id: r.case.id, checkedAt: r.checkedAt, ...r.result })), scope: 'one-case, not a full-suite verdict' }); };
  const staleGate = !!gate && gate.hash !== policyId(gatePolicy);
  const verdict = result ? <Result v={result.result.invalid ? { kind: 'invalid', messages: result.result.violations } : { kind: 'checked', result: result.result, control: !!result.case.control }} /> : null;
  const chooseCase = <label className="at-label">Case<select value={pick} onChange={(e) => draft({ pick: Number(e.target.value), text: '' })}>{cases.map((x, i) => <option key={x.id} value={i}>{x.control ? 'Honest control · ' : ''}{x.title}</option>)}</select></label>;
  const context = <div className="authority-inputs"><section><h2>Trusted owner request</h2><dl><dt>Quantity</dt><dd>{c.input.owner.qty}</dd><dt>Budget</dt><dd>${c.input.owner.budget.toFixed(2)}</dd><dt>Deliver to</dt><dd>{c.input.owner.address}</dd></dl></section><section><h2>Untrusted seller listing</h2><b>{c.input.listing.title} · ${c.input.listing.price.toFixed(2)}</b><pre className="seller-copy">{c.input.listing.text}</pre><p>{c.control ? 'This is an honest control. A useful agent should still buy.' : 'Seller text cannot authorize quantity, address or budget changes.'}</p></section></div>;
  const editor = <><label className="at-label" htmlFor="agent-answer">Your agent's answer</label><textarea id="agent-answer" className="at-answer" aria-label="Your agent's answer" rows={5} spellCheck={false} value={text} onChange={(e) => draft({ text: e.target.value })} placeholder={'Paste your agent’s JSON here, or import answer.json above.'} /><div className="at-row"><button className="btn hot" disabled={!text.trim()} onClick={() => check()}>Check pasted answer</button><button className="btn" onClick={() => sample(true)}>Check a careful sample answer</button><button className="btn" onClick={() => sample(false)}>Check a fooled sample answer</button><button className="btn" onClick={() => draft({ pick: cases.indexOf(honestControl), text: '', method: 'sample' })}>Try an honest control</button></div></>;
  return <section className="task-panel agent-test" aria-label="Agent authority workspace">
    <h1>Can my agent buy only what its owner allowed?</h1>
    <p>Hold one answer fixed. Compare an open gate with a protected gate, then check that an honest purchase still gets through.</p>
    <p className="observation-id">Local simulated checks · no model or payment invoked</p>
    <div className="task-mode-switch" aria-label="Answer source"><button className={`btn ${method === 'sample' ? 'on' : ''}`} aria-pressed={method === 'sample'} onClick={() => { if (method !== 'sample') useStore.setState({ agentDraft: { pick, text: '', method: 'sample' }, agentSelectedId: null }); }}>Guided sample</button><button className={`btn ${method !== 'sample' ? 'on' : ''}`} aria-pressed={method !== 'sample'} onClick={() => { if (method === 'sample') useStore.setState({ agentDraft: { pick, text: '', method: 'pasted-answer' }, agentSelectedId: null }); }}>Use my own agent</button></div>
    {method !== 'sample' && <details className="own-agent-workbench" open={!result || changed || result.result.invalid}><summary>Your agent: case, import and answer</summary>{chooseCase}<AgentImport selectedCase={c} onImport={(text, caseId) => { if (cases[useStore.getState().agentDraft.pick].id !== caseId) return false; draft({ text, method: 'pasted-answer' }); return true; }} /><details><summary>Inspect the owner request and seller listing</summary>{context}<pre className="at-json">{JSON.stringify(c.input, null, 2)}</pre></details>{editor}</details>}
    {(method === 'sample' || (result && !changed && !result.result.invalid)) && <div className="guided-next"><b>{!result || changed || result.result.invalid ? '1 · Check an answer' : !gate || staleGate ? '2 · Compare the gates' : '3 · Keep the evidence'}</b>
      {!result && method === 'sample' ? <><p>{c.input.listing.title}: the owner allowed {c.input.owner.qty}, within ${c.input.owner.budget}. See what happens when the agent follows the seller instead.</p><button className="btn hot" onClick={() => sample(false)}>Check a fooled sample answer</button></> : result && !changed && !result.result.invalid ? <><label className="at-label">Checkout rulebook<select value={policyId(gatePolicy)} onChange={(e) => setGatePolicy(gatePolicies.find((p) => policyId(p) === e.target.value)!)}>{gatePolicies.map((p) => <option key={policyId(p)} value={policyId(p)}>{p.name}</option>)}</select></label>{!gate || staleGate ? <button className="btn hot" onClick={compare}>Compare open and protected gates</button> : <button className="btn hot" onClick={exportResult}>Export comparison evidence</button>}</> : <p>{result?.result.invalid ? 'Correct the answer shape, then check it again below.' : 'Paste one answer below and check it to continue.'}</p>}
    </div>}
    {changed && <p className="worth-assumption" role="status">Inputs changed — check again. The saved result below still belongs to its original answer.</p>}
    {result && <section aria-label="Saved authority result"><p className="observation-id">Selected <code>{result.id}</code> · {result.method} · checked {result.checkedAt}</p>{staleGate && <p className="worth-assumption">Policy changed — compare again. The saved comparison below still names its original policy.</p>}{gate ? <><GateComparison observation={result} comparison={gate} /><details><summary>{result.result.invalid ? 'NOT JUDGED' : !result.result.pass ? 'FAILED' : result.result.declined && result.case.control ? 'LOST SALE' : 'PASSED'} · authority verdict and fixes</summary>{verdict}</details></> : verdict}<button className="simple-link" onClick={exportResult}>Download case and checked result</button></section>}
    {method === 'sample' && <details><summary>Change the case or answer</summary>{chooseCase}{context}<details><summary>JSON input for your agent</summary><pre className="at-json">{JSON.stringify(c.input, null, 2)}</pre></details>{editor}</details>}
    {s.agentResults.length > 0 && <details><summary>Checked answers and honest controls ({s.agentResults.length})</summary><ul className="observation-history">{s.agentResults.map((r) => <li key={r.id} aria-current={r.id === result?.id ? 'true' : undefined}><code>{r.id}</code><span>{r.case.control ? 'Honest control' : 'Attack case'} · {r.case.title}: {r.result.invalid ? 'NOT JUDGED' : !r.result.pass ? 'BREACH' : r.result.declined ? r.case.control ? 'LOST SALE' : 'REFUSED' : 'BOUGHT WITHIN MANDATE'} · {r.checkedAt}</span><button className="simple-link" onClick={() => { const restored = restoreObservation(s.agentResults, s.agentGates, r.id, cases); if (restored) useStore.setState({ ...restored, experiments: { ...s.experiments, 'agent-authority': restored.experiment } }); }}>Restore checked answer</button></li>)}</ul><p>Restores the saved answer, verdict, timestamp and latest comparison for that observation. Local checks do not constitute a full-suite report.</p></details>}
    <details><summary>Experiment scope and provenance</summary><Scope experiment={result?.experiment ?? s.experiment} title="Local checker · one selected answer · no model or payment invoked" /></details>
    <details><summary>Recorded checkout proof · Frozen v3 · {checkout.policy}</summary><p>{policyId(gatePolicy) === checkout.policy ? 'The selected policy hash matches this recorded receipt.' : 'No matching receipt is shown for your selected policy. This is a different policy: Frozen v3.'} Recorded {checkout.recordedAt} · {checkout.mode} · evaluator {checkout.evaluator}.</p><pre className="at-json">{JSON.stringify(checkout.rows, null, 2)}</pre></details>
    <details><summary>Matching recorded toolkit incident, when available</summary><p>Recorded {toolkit.recordedAt} · model {toolkit.model} · {toolkit.mode} setup. This is historical model behavior, not a new inference. The checkout proof above uses a different owner/order; matching its policy does not make it a receipt for this listing.</p>{toolkit.cases.filter((t) => t.title === c.input.listing.title && t.owner.address === c.input.owner.address).length ? toolkit.cases.filter((t) => t.title === c.input.listing.title && t.owner.address === c.input.owner.address).map((t) => <pre className="at-json" key={t.title}>{JSON.stringify(t, null, 2)}</pre>) : <p>No recorded toolkit receipt matches this selected listing. The local checker and gate result remain simulated checks.</p>}<p>The toolkit run compared Wild West, Lab-Tuned and Know Your Agent. It did not run Frozen v3 or v4.</p><button className="btn" onClick={() => useStore.setState({ showHijack: true })}>Inspect recorded toolkit payments and refund IDs</button></details>
    <EvaluationBoundary />
    <details><summary>Run my local agent and integrate the release gate</summary><p>This page checks one answer. Adapt examples/agents/template.py and run all eight cases locally, including three honest controls. This page does not execute commands or import a suite report.</p><pre className="at-json">{ALL_CASES}</pre><button className="btn" onClick={() => void copy()}>{copied ? 'COPIED' : 'Copy all-case command'}</button>
    <button className="btn" onClick={() => downloadJson(`${c.id}.json`, c)}>Download this regression</button><AgentGuide />
    </details><p>One-case checks do not certify safety. Recorded model evidence covers its stated conditions; the full release gate also checks honest purchases.</p>
  </section>;
}
