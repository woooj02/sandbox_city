import { useStore } from '../store';
import { Scope } from './Scope';
import recovery from '../data/recovery-proof.json';
import checkout from '../data/checkout-proof.json';
import { downloadJson } from './download';
import { experimentFor, recoveryExperiment } from '../workflow';

export function RecoveryTask() {
  const current = useStore((s) => s.experiment);
  const experiment = recoveryExperiment(current ?? experimentFor('payment-recovery', 'recovery-inspection'));
  return <section className="task-panel" aria-label="Payment recovery">
    <h2>Will a payment recover safely?</h2>
    <Scope experiment={experiment} title="Recorded crash recovery · PayPal sandbox · not a new payment" />
    <p>A response was lost after money moved. Restarting the worker read the known order back instead of charging again. You are inspecting a prior run; no account is connected by this page.</p>
    <p>Recorded {recovery.recordedAt} · run <code>{recovery.run}</code> · amount ${recovery.amount.toFixed(2)}.</p>
    <ol className="incident-trace">{recovery.steps.map((s) => <li key={s.step}><b>{s.step}</b><p>{s.detail}</p></li>)}</ol>
    <div className="worth-answer"><b>One charge after recovery</b><span>{recovery.charges.before} before restart → {recovery.charges.afterRecovery} after recovery. The client without a journal made {recovery.charges.afterControl} charges.</span></div>
    <p>This recovery receipt is a worker experiment with no policy hash attached. A separate recorded checkout proof uses Frozen v3, policy <code>{checkout.policy}</code>, evaluator {checkout.evaluator}, recorded {checkout.recordedAt}. It is not a receipt for a selected v4 policy.</p>
    <details><summary>Inspect the separate Frozen v3 checkout receipt</summary><pre className="at-json">{JSON.stringify(checkout, null, 2)}</pre></details>
    <h3>Reproduce locally</h3><p>These commands use the local contract mock by default. Sandbox setup is described in docs/RELIABILITY.md; this page does not run commands.</p>
    <pre className="at-json">npx tsx scripts/crash-recovery.ts{'\n'}npx tsx scripts/checkout-proof.ts{'\n'}npm test -- packages/server/test/live-city-settlement.test.ts packages/core/test/runner-input.test.ts</pre>
    <p>The last tests exercise pending repair through provider fixtures, including the paused runner. They are not new PayPal receipts.</p>
    <button className="btn" onClick={() => downloadJson('recovery-trace.json', { schema: 'sandbox-city/recovery-inspection@1', experiment, recovery, checkout, source: 'recorded-proof' })}>Download recorded trace</button>
  </section>;
}
