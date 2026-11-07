import { useStore } from '../store';
import { client } from '../sim/client';
import { Welcome } from './Welcome';
import { AgentTest } from './AgentTest';
import { Worth } from './Worth';
import { RecoveryTask } from './RecoveryTask';
export function Workspace({ home }: { home: boolean }) {
  const s = useStore();
  const select = (task: Parameters<typeof s.selectTask>[0]) => { client.send({ cmd: 'pause' }); s.selectTask(task); };
  return <>
    <header className="task-header"><button className="brand-link" onClick={() => select('home')}><svg viewBox="0 0 28 28" width="28" height="28" fill="none" aria-hidden="true"><rect x="1" y="1" width="26" height="26" rx="7" stroke="currentColor" /><path d="M8 8L20 20M20 8L8 20M8 8H20V20H8Z" stroke="currentColor" opacity=".5" /><circle cx="14" cy="14" r="3" fill="currentColor" /></svg><span>SANDBOX CITY<small>Adversarial commerce lab</small></span></button><span className="workspace-status"><i className="status-dot" /> Browser workspace <small>Simulation & recorded evidence</small></span></header>
    {!home && <nav className="task-nav" aria-label="Test question"><button className="btn" onClick={() => select('home')}>All questions</button><button className={`btn ${s.task === 'agent-authority' ? 'on' : ''}`} onClick={() => select('agent-authority')}>Agent authority</button><button className={`btn ${s.task === 'policy-cost' ? 'on' : ''}`} onClick={() => select('policy-cost')}>Defense cost</button><button className={`btn ${s.task === 'payment-recovery' ? 'on' : ''}`} onClick={() => select('payment-recovery')}>Payment recovery</button><button className="simple-link" onClick={() => useStore.setState({ showEvidence: true })}>Evidence and provenance</button></nav>}
    {home ? <Welcome /> : <main className="task-workspace">{s.task === 'agent-authority' ? <AgentTest /> : s.task === 'policy-cost' ? <Worth /> : <RecoveryTask />}</main>}
    {s.runComplete && !home && <aside className="run-notice">A city run completed. Your task result is preserved. <button className="simple-link" onClick={() => { select('city'); useStore.setState({ showReport: true }); }}>Inspect city result</button></aside>}
  </>;
}
