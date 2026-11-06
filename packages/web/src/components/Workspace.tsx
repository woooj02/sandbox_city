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
    <header className="task-header"><button className="brand-link" onClick={() => select('home')}>⌬ SANDBOX CITY</button><span>Choose → configure → check → inspect → export</span></header>
    {!home && <nav className="task-nav" aria-label="Test question"><button className="btn" onClick={() => select('home')}>All questions</button><button className={`btn ${s.task === 'agent-authority' ? 'on' : ''}`} onClick={() => select('agent-authority')}>Agent authority</button><button className={`btn ${s.task === 'policy-cost' ? 'on' : ''}`} onClick={() => select('policy-cost')}>Defense cost</button><button className={`btn ${s.task === 'payment-recovery' ? 'on' : ''}`} onClick={() => select('payment-recovery')}>Payment recovery</button><button className="simple-link" onClick={() => useStore.setState({ showEvidence: true })}>Evidence and provenance</button></nav>}
    {home ? <Welcome /> : <main className="task-workspace">{s.task === 'agent-authority' ? <AgentTest /> : s.task === 'policy-cost' ? <Worth /> : <RecoveryTask />}</main>}
    {s.runComplete && !home && <aside className="run-notice">A city run completed. Your task result is preserved. <button className="simple-link" onClick={() => { select('city'); useStore.setState({ showReport: true }); }}>Inspect city result</button></aside>}
  </>;
}
