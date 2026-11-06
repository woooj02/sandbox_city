import { useStore } from '../store';
export function Welcome() {
  const select = useStore((s) => s.selectTask);
  return <main className="task-home">
    <p className="eyebrow">SANDBOX CITY · A LAB FOR DEVELOPERS OF SPENDING AGENTS</p>
    <h1>What do you want to test?</h1>
    <p className="task-lede">Find a financial failure, compare a defense with honest trade, and export the result.</p>
    <div className="at-row"><button className="btn hot" onClick={() => select('agent-authority')}>Run a guided example</button><button className="btn" onClick={() => { useStore.setState((s) => ({ agentDraft: { ...s.agentDraft, method: 'pasted-answer' } })); select('agent-authority'); }}>Use my own agent</button></div>
    <div className="task-cards">
      <button onClick={() => select('agent-authority')}><span>01 · OWNER AUTHORITY</span><h2>Can my agent buy only what its owner allowed?</h2><p>Check a sample or pasted answer, compare a checkout gate, and download the case and verdict.</p></button>
      <button onClick={() => select('policy-cost')}><span>02 · DEFENSE COST</span><h2>Which payment defense is worth using?</h2><p>Reprice 30 recorded simulated days using your costs. Keep honest trade and held capital in view.</p></button>
      <button onClick={() => select('payment-recovery')}><span>03 · PAYMENT RECOVERY</span><h2>Will a payment recover safely?</h2><p>Inspect a recorded sandbox recovery and its control, with IDs and local reproduction commands.</p></button>
    </div>
    <p>Sample answers and simulated dollars are bounded evidence, not a certification of safety or a merchant forecast. Recorded model behavior covers the stated model and prompts only.</p>
    <div className="at-row"><button className="simple-link" onClick={() => useStore.setState({ showEvidence: true })}>Read the evidence</button><button className="simple-link" onClick={() => { select('city'); useStore.setState({ fullLab: true }); }}>Advanced lab</button></div>
  </main>;
}
