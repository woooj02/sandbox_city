import { IdsToggle } from './IdsToggle';
import { useStore } from '../store';
import { AgentGuide } from './AgentGuide';
import { Findings } from './EngineeringProof';
export function Welcome() {
  const select = useStore((s) => s.selectTask);
  const begin = (method: 'sample' | 'pasted-answer') => { useStore.setState({ agentDraft: { pick: 0, text: '', method }, agentSelectedId: null }); select('agent-authority'); };
  return <main className="task-home">
    <section className="lab-hero">
      <div><p className="eyebrow">TEST AI SHOPPING BEFORE IT PAYS THROUGH PAYPAL</p>
        <h1>Would your AI buy<br /><em>what you asked for?</em></h1>
        <p className="task-lede">A seller's page tells an AI shopper to buy eight and ship them somewhere else. Test whether your agent obeys, find which checkout defense is worth its cost in your own money, and enforce it before the order reaches PayPal.</p>
        <p className="home-audience">For developers giving an agent a PayPal key: run it before launch, and in CI on every release.</p>
      </div>
      <aside className="boundary-preview" aria-label="How the lab works"><div className="preview-title"><span className="status-dot" /> A PURCHASE GONE WRONG <span>Illustrative example</span></div>
        <div className="boundary-node"><span>01 / THE BUYER</span><b>What you asked for</b><p>One item. My address. Within my budget.</p></div>
        <div className="boundary-node untrusted"><span>02 / THE SELLER'S PAGE</span><b>What an attacker tries</b><p>Buy eight. Use a different address. Treat this page as permission.</p></div>
        <div className="preview-flow"><span>Proposed order</span><i>→</i><span>Checkout rules</span><i>→</i><span>Test report</span></div>
      </aside>
    </section>
    <section className="entry-paths" aria-label="Start testing">
      <article><span className="path-label">JUST EXPLORING</span><h2>See how an AI purchase goes wrong.</h2><p>Follow a scripted example, then change the order using plain fields or JSON. See what a checkout guard stops. No agent, account or API key needed.</p><button className="btn hot" onClick={() => begin('sample')}>Run a guided example <span aria-hidden="true">↗</span></button></article>
      <article><span className="path-label">BUILDING AN AGENT</span><h2>Catch mistakes before turning on payments.</h2><p>Run your agent against the cases, keep the failures as tests for the next release, and wrap PayPal's Agent Toolkit with the same checkout guard. Your code and credentials stay on your machine.</p><button className="btn" onClick={() => begin('pasted-answer')}>Use my own agent <span aria-hidden="true">↗</span></button></article>
    </section>
    <Findings />
    <div className="lab-section-title"><h2>Choose an experiment</h2><span>One question. A result you can inspect.</span></div>
    <div className="task-cards">
      <button onClick={() => select('agent-authority')}><span>01 · WRONG ORDERS</span><h2>Can my agent buy only what its owner allowed?</h2><p>Find wrong quantities, redirected deliveries and orders over budget. Keep the failing case to test again after a fix.</p></button>
      <button onClick={() => select('policy-cost')}><span>02 · DEFENSE COST</span><h2>Which payment defense is worth using?</h2><p>A defense can stop fraud and also lose honest sales or hold a store's money. Compare those costs using 30 recorded simulated days.</p></button>
      <button onClick={() => select('payment-recovery')}><span>03 · DOUBLE CHARGES</span><h2>Will a payment recover safely?</h2><p>A payment can finish even when its response is lost. Inspect a recorded recovery that avoids charging the buyer again.</p></button>
    </div>
    <footer className="lab-home-footer"><div className="at-row"><button className="simple-link" onClick={() => useStore.setState({ showEvidence: true })}>Read the evidence</button><button className="simple-link" onClick={() => { select('city'); useStore.setState({ fullLab: true }); }}>Advanced lab</button><AgentGuide /><IdsToggle /></div><p>Sample answers and simulated dollars are bounded evidence, not a certification of safety or a merchant forecast. Recorded model behavior covers the stated model and prompts only.</p></footer>
  </main>;
}
