import { useStore } from '../store';
import { AgentGuide } from './AgentGuide';
export function Welcome() {
  const select = useStore((s) => s.selectTask);
  const begin = (method: 'sample' | 'pasted-answer') => { useStore.setState({ agentDraft: { pick: 0, text: '', method }, agentSelectedId: null }); select('agent-authority'); };
  return <main className="task-home">
    <section className="lab-hero">
      <div><p className="eyebrow">ADVERSARIAL COMMERCE LAB</p>
        <h1>Test spending agents.<br /><em>Keep the evidence.</em></h1>
        <p className="task-lede">A store listing can give an AI agent the wrong instructions. Test the answer, compare checkout defenses, and see whether honest purchases still get through.</p>
        <div className="lab-tags"><span>Agent authority</span><span>Payment defenses</span><span>Reproducible cases</span></div>
      </div>
      <aside className="boundary-preview" aria-label="How the lab works"><div className="preview-title"><span className="status-dot" /> THE TRUST BOUNDARY <span>Illustrative example</span></div>
        <div className="boundary-node"><span>01 / TRUSTED</span><b>Owner request</b><p>One item. My address. Within my budget.</p></div>
        <div className="boundary-node untrusted"><span>02 / UNTRUSTED</span><b>Seller listing</b><p>Content the agent reads — including instructions an attacker planted.</p></div>
        <div className="preview-flow"><span>Agent answer</span><i>→</i><span>Checkout gate</span><i>→</i><span>Evidence JSON</span></div>
      </aside>
    </section>
    <section className="entry-paths" aria-label="Start testing">
      <article><span className="path-label">JUST EXPLORING</span><h2>See a failure. Test the defense.</h2><p>No agent, account or API key needed. Follow a sample answer through open and protected checkout gates, then export what happened.</p><button className="btn hot" onClick={() => begin('sample')}>Run a guided example <span aria-hidden="true">↗</span></button></article>
      <article><span className="path-label">BRING YOUR OWN AGENT</span><h2>Put your agent's answer on trial.</h2><p>Download a case, run your agent locally, then paste or import its answer JSON. Your code and credentials stay on your machine.</p><button className="btn" onClick={() => begin('pasted-answer')}>Use my own agent <span aria-hidden="true">↗</span></button></article>
    </section>
    <div className="lab-section-title"><h2>Choose an experiment</h2><span>One question. A result you can inspect.</span></div>
    <div className="task-cards">
      <button onClick={() => select('agent-authority')}><span>01 · OWNER AUTHORITY</span><h2>Can my agent buy only what its owner allowed?</h2><p>Check a sample or pasted answer, compare a checkout gate, and download the case and verdict.</p></button>
      <button onClick={() => select('policy-cost')}><span>02 · DEFENSE COST</span><h2>Which payment defense is worth using?</h2><p>Reprice 30 recorded simulated days using your costs. Keep honest trade and held capital in view.</p></button>
      <button onClick={() => select('payment-recovery')}><span>03 · PAYMENT RECOVERY</span><h2>Will a payment recover safely?</h2><p>Inspect a recorded sandbox recovery and its control, with IDs and local reproduction commands.</p></button>
    </div>
    <footer className="lab-home-footer"><div className="at-row"><button className="simple-link" onClick={() => useStore.setState({ showEvidence: true })}>Read the evidence</button><button className="simple-link" onClick={() => { select('city'); useStore.setState({ fullLab: true }); }}>Advanced lab</button><AgentGuide /></div><p>Sample answers and simulated dollars are bounded evidence, not a certification of safety or a merchant forecast. Recorded model behavior covers the stated model and prompts only.</p></footer>
  </main>;
}
