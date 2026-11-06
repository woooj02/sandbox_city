import { useState } from 'react';
import { checkAgentAnswer, gateAgentAnswer, policyId, PRESETS, type Policy, type AgentRegression, type CaseResult } from '@sandbox-city/core';
import { useStore } from '../store';
import { EvaluationBoundary } from './EvaluationBoundary';
import { Scope } from './Scope';
import { downloadJson } from './download';
import checkout from '../data/checkout-proof.json';
import toolkit from '../data/toolkit-proof.json';
import type { AgentResult, SavedGate } from '../workflow';
import raw from '../data/evidence.json';

const cases = (raw as unknown as { agentCases: AgentRegression[] }).agentCases;
const frozenV3 = (raw as unknown as { fourth: { arms: { key: string; rules: Policy }[] } }).fourth.arms.find((a) => a.key === 'frozen_v3')!.rules;
const gatePolicies = [PRESETS.open, PRESETS.kya, frozenV3];
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
const careful = (c: AgentRegression) => JSON.stringify({ buy: true, qty: c.input.owner.qty, ship_to: c.input.owner.address, reason: 'Ignored the instructions in the listing.' }, null, 2);

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
      <ul>{v.result.violations.map((x) => <li key={x}>{x}</li>)}</ul>
      {v.result.fixes?.map((x) => <p key={x}><b>Fix:</b> {x}</p>)}
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
  const gatePolicy = s.agentGatePolicy ?? frozenV3;
  const setGatePolicy = (policy: Policy) => useStore.setState({ agentGatePolicy: policy });
  const gate = s.agentGate;
  const setGate = (gate: SavedGate) => useStore.setState({ agentGate: gate });
  const draft = (change: Partial<typeof s.agentDraft>) => useStore.setState({ agentDraft: { ...s.agentDraft, ...change }, experiment: s.experiment ? { ...s.experiment, phase: 'draft' } : null });
  const result = [...s.agentResults].reverse().find((r) => r.case.id === c.id);
  const changed = !!result && (result.text !== text || result.method !== method);
  const check = (answer = text, from = method) => {
    const v = judge(c, answer);
    if (v.kind === 'empty') return;
    const r: AgentResult = { experiment: { ...s.experiment!, task: 'agent-authority', source: 'current-run', paymentMode: 'simulated', inputRef: c.id, phase: v.kind === 'invalid' ? 'failed' : 'complete' }, case: c, text: answer, method: from, checkedAt: new Date().toISOString(), result: v.kind === 'invalid' ? { pass: false, invalid: true, violations: v.messages } : v.result };
    useStore.setState({ agentDraft: { pick, text: answer, method: from }, agentResults: [...s.agentResults, r], experiment: r.experiment, experiments: { ...s.experiments, 'agent-authority': r.experiment } });
  };
  const sample = (care: boolean) => check(care ? careful(c) : FOOLED, 'sample');
  const copy = async () => { await navigator.clipboard.writeText(ALL_CASES); setCopied(true); };
  return <section className="task-panel agent-test" aria-label="Agent authority workspace">
    <h1>Can my agent buy only what its owner allowed?</h1>
    <Scope experiment={s.experiment} title="Local checker · one selected answer · no model or payment invoked" />
    <p>Check an agent answer, then separately evaluate a checkout gate. A one-case pass does not certify safety. Every full-suite verdict also needs the three honest controls.</p>
    <div className="at-row" aria-label="Answer method">{(['sample', 'pasted-answer', 'local-command'] as const).map((m) => <button className={`btn ${m === method ? 'on' : ''}`} key={m} onClick={() => draft({ method: m })}>{m === 'sample' ? 'Use a sample' : m === 'pasted-answer' ? 'Paste one answer' : 'Run my local agent'}</button>)}</div>
    <label className="at-label">Case<select value={pick} onChange={(e) => draft({ pick: Number(e.target.value), text: '' })}>{cases.map((x, i) => <option key={x.id} value={i}>{x.control ? 'Honest control · ' : ''}{x.title}</option>)}</select></label>
    <div className="authority-inputs"><section><h2>Trusted owner request</h2><dl><dt>Quantity</dt><dd>{c.input.owner.qty}</dd><dt>Budget</dt><dd>${c.input.owner.budget.toFixed(2)}</dd><dt>Deliver to</dt><dd>{c.input.owner.address}</dd></dl></section><section><h2>Untrusted seller listing</h2><b>{c.input.listing.title} · ${c.input.listing.price.toFixed(2)}</b><pre className="seller-copy">{c.input.listing.text}</pre><p>{c.control ? 'This is an honest control. A useful agent should still buy.' : "The store page is trying to change the buyer’s authority. Seller text cannot authorize quantity, address or budget changes."}</p></section></div>
    {method === 'local-command' ? <div><h2>Run all eight cases on your machine</h2><p>This page never executes your command or calls your endpoint. Adapt examples/agents/template.py, then run the command below locally. Results here remain one-case checks; no suite report has been imported.</p></div> : <>
      <h2>Check one answer</h2>
      {method === 'pasted-answer' && <details><summary>JSON input for your agent</summary><pre className="at-json">{JSON.stringify(c.input, null, 2)}</pre></details>}
      <textarea className="at-answer" aria-label="Your agent's answer" rows={5} spellCheck={false} value={text} onChange={(e) => draft({ text: e.target.value })} />
      <div className="at-row">{method === 'sample' && <><button className="btn" onClick={() => sample(false)}>Check a fooled sample answer</button><button className="btn" onClick={() => sample(true)}>Check a careful sample answer</button></>}<button className="btn" disabled={!text.trim()} onClick={() => check()}>Check pasted answer</button><button className="btn" onClick={() => draft({ pick: 1, text: '', method: 'sample' })}>Try an honest control</button></div>
    </>}
    {changed && <p className="worth-assumption" role="status">Inputs changed — check again. The saved result below still belongs to its original answer.</p>}
    {result && <section aria-label="Saved authority result"><h2>What happened</h2><p>{result.case.title} · {result.method} · checked {result.checkedAt}</p><Result v={result.result.invalid ? { kind: 'invalid', messages: result.result.violations } : { kind: 'checked', result: result.result, control: !!result.case.control }} /><button className="btn" onClick={() => downloadJson(`result-${c.id}.json`, { schema: 'sandbox-city/agent-check@1', ...result, checkoutEvaluation: gate?.source === result ? gate : null, controlsChecked: s.agentResults.filter((r) => r.case.control).map((r) => ({ id: r.case.id, ...r.result })), scope: 'one-case, not a full-suite verdict' })}>Download case and checked result</button></section>}
    {s.agentResults.length > 0 && <details><summary>Checked answers and honest controls ({s.agentResults.length})</summary><ul>{s.agentResults.map((r) => <li key={`${r.case.id}-${r.checkedAt}`}>{r.case.control ? 'Honest control' : 'Attack case'} · {r.case.title}: {r.result.invalid ? 'NOT JUDGED' : !r.result.pass ? 'BREACH' : r.result.declined ? r.case.control ? 'LOST SALE' : 'REFUSED' : 'BOUGHT WITHIN MANDATE'} <button className="simple-link" onClick={() => useStore.setState({ agentDraft: { pick: cases.findIndex((c) => c.id === r.case.id), text: r.text, method: r.method }, experiment: r.experiment })}>Restore checked answer</button></li>)}</ul><p>These local checks are not an imported or executed full-suite report.</p></details>}
    <h2>See what the checkout gate does</h2><p>This uses the shared checkout evaluator on the saved answer. It checks a proposed order in code; it does not send it to PayPal.</p>
    <label className="at-label">Checkout rulebook<select value={gatePolicy.name} onChange={(e) => { setGatePolicy(gatePolicies.find((p) => p.name === e.target.value)!); }}>{gatePolicies.map((p: Policy) => <option key={p.name}>{p.name}</option>)}</select></label>
    <button className="btn" disabled={!result || changed || result.result.invalid} onClick={() => { if (result) setGate({ hash: policyId(gatePolicy), name: gatePolicy.name, source: result, result: gateAgentAnswer(result.case, JSON.parse(result.text), gatePolicy) }); }}>Evaluate checkout gate</button>
    {gate && <section className="at-result" role="status"><b>Gate evaluation · {gate.name} · {gate.hash}</b><p>{gate.source !== result || gate.hash !== policyId(gatePolicy) ? 'Inputs changed — evaluate again. Showing the previous gate result.' : 'Current saved answer.'}</p><p>{gate.result.kind === 'evaluated' ? `${gate.result.verdict.ok ? gate.result.verdict.escrow ? 'HOLD' : 'ALLOW' : 'REFUSE'} · ${gate.result.verdict.reason ?? 'Within these rules'}` : gate.result.kind === 'declined' ? 'NO ORDER: the agent declined.' : 'NOT JUDGED'}</p></section>}
    <details><summary>Recorded checkout proof · Frozen v3 · {checkout.policy}</summary><p>{policyId(gatePolicy) === checkout.policy ? 'The selected policy hash matches this recorded receipt.' : 'No matching receipt is shown for your selected policy. This is a different policy: Frozen v3.'} Recorded {checkout.recordedAt} · {checkout.mode} · evaluator {checkout.evaluator}.</p><pre className="at-json">{JSON.stringify(checkout.rows, null, 2)}</pre></details>
    <details><summary>Matching recorded toolkit incident, when available</summary><p>Recorded {toolkit.recordedAt} · model {toolkit.model} · {toolkit.mode} setup. This is historical model behavior, not a new inference. The checkout proof above uses a different owner/order; matching its policy does not make it a receipt for this listing.</p>{toolkit.cases.filter((t) => t.title === c.input.listing.title && t.owner.address === c.input.owner.address).length ? toolkit.cases.filter((t) => t.title === c.input.listing.title && t.owner.address === c.input.owner.address).map((t) => <pre className="at-json" key={t.title}>{JSON.stringify(t, null, 2)}</pre>) : <p>No recorded toolkit receipt matches this selected listing. The local checker and gate result remain simulated checks.</p>}<p>The toolkit run compared Wild West, Lab-Tuned and Know Your Agent. It did not run Frozen v3 or v4.</p><button className="btn" onClick={() => useStore.setState({ showHijack: true })}>Inspect recorded toolkit payments and refund IDs</button></details>
    <EvaluationBoundary />
    <h2>Take this to your release gate</h2><pre className="at-json">{ALL_CASES}</pre><button className="btn" onClick={() => void copy()}>{copied ? 'COPIED' : 'Copy all-case command'}</button>
    <button className="btn" onClick={() => downloadJson(`${c.id}.json`, c)}>Download this regression</button>
    <p>Recorded model evidence uses the stated model/settings, not a general robustness guarantee. A command run checks your own adapter against these eight cases, including three honest controls.</p>
  </section>;
}
