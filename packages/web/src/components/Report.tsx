import { ATTACK_KINDS, Metrics } from '@sandbox-city/core';
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { WhatIf } from './WhatIf';
import { ATTACK_SHORT, LANE_NAMES, money, pct } from './meta';

function findings(m: Metrics) {
  const out: string[] = [];
  const leaks = ATTACK_KINDS.map((k) => ({ k, v: m.fraud.byKind[k].leaked })).filter((x) => x.v > 1).sort((a, b) => b.v - a.v);
  if (leaks[0]) out.push(`Biggest hole: ${ATTACK_SHORT[leaks[0].k].toLowerCase()} (${money(leaks[0].v)} got through).`);
  const sealed = ATTACK_KINDS.filter((k) => m.fraud.byKind[k].attempted > 0 && m.fraud.byKind[k].leaked <= 0.5);
  if (sealed.length) out.push(`Fully sealed: ${sealed.map((k) => ATTACK_SHORT[k].toLowerCase()).join(', ')}.`);
  if (m.chaos.duplicateCharges) out.push(`${m.chaos.duplicateCharges} customers were charged twice when PayPal timed out and the agent retried without an idempotency key.`);
  else if (m.chaos.faults) out.push(`${m.chaos.faults} PayPal faults injected; zero double charges.`);
  const turned = m.honest.blocked + m.honest.abandoned;
  out.push(`${turned} honest purchases were turned away (${money(m.honest.blockedValue + (m.honest.abandonedValue ?? 0))} of good business lost).`);
  return out;
}

interface Recon { sim: { net: number; orders: number; refunds: number }; paypal: { net: number; transactions: number }; delta: number; matched: boolean }

function LiveReconcile() {
  const runId = useStore((s) => s.runId);
  const [r, setR] = useState<Recon | { error: string } | null>(null);
  useEffect(() => {
    if (!runId) return;
    fetch(`/api/reconcile/${runId}`).then((x) => x.json()).then(setR, (e: Error) => setR({ error: e.message }));
  }, [runId]);
  if (!runId) return null;
  if (!r) return <div className="recon">Reconciling with PayPal Transaction Search…</div>;
  if ('error' in r) return <div className="recon warn">Reconciliation unavailable: {r.error}</div>;
  return (
    <div className={`recon ${r.matched ? 'ok' : 'warn'}`}>
      <b>{r.matched ? '✓ RECONCILED WITH PAYPAL' : 'PAYPAL NOT YET SETTLED'}</b>
      <span>sim says {money(r.sim.net)} moved over {r.sim.orders} orders / {r.sim.refunds} refunds · PayPal reports {money(r.paypal.net)} across {r.paypal.transactions} transactions{r.matched ? '' : ` · Δ ${money(r.delta)} (Transaction Search can lag)`}</span>
    </div>
  );
}

export function Report() {
  const show = useStore((s) => s.showReport);
  const lanes = useStore((s) => s.lanes);
  const policies = useStore((s) => s.policies);
  if (!show) return null;
  return (
    <div className="report-wrap" onClick={() => useStore.setState({ showReport: false })}>
      <div className="report panel" onClick={(e) => e.stopPropagation()}>
        <div className="report-head"><span className="kanji">結果</span><div><h2>END OF DAY REPORT</h2><p>24 simulated hours · every payment on PayPal-shaped rails · reconciled to the cent</p></div></div>
        <div className={`report-cols n${lanes.length}`}>
          {lanes.map((l, i) => l.metrics && (
            <div className="report-col" key={i}>
              <h3>{lanes.length > 1 ? `${LANE_NAMES[i]} · ` : ''}{policies[i]?.name}</h3>
              <div className="report-big">
                <div><b className="cy">{pct(l.metrics.safety)}</b><span>fraud $ stopped</span></div>
                <div><b className="gr">{pct(l.metrics.access)}</b><span>honest buys completed</span></div>
              </div>
              <div className="report-row"><span>Stolen</span><b className="bad">{money(l.metrics.fraud.leaked)}</b></div>
              <div className="report-row"><span>Honest GMV</span><b>{money(l.metrics.honest.gmv)}</b></div>
              <div className="report-row"><span>Net value</span><b>{money(l.metrics.netValue)}</b></div>
              <ul>{findings(l.metrics).map((f, k) => <li key={k}>{f}</li>)}</ul>
            </div>
          ))}
        </div>
        <WhatIf />
        <LiveReconcile />
        <button className="btn" onClick={() => useStore.setState({ showReport: false })}>CLOSE</button>
      </div>
    </div>
  );
}
