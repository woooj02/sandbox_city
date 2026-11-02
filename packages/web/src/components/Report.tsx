import { ATTACK_KINDS, Metrics, PRESETS, type Policy } from '@sandbox-city/core';
import { client } from '../sim/client';
import { startTune } from './AutoTune';
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { WhatIf } from './WhatIf';
import proof from '../data/paypal-proof.json';
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

interface Recon {
  sim: { net: number; orders: number; refunds: number };
  observed: { captures: number; refunds: number };
  paypal: { net: number; transactions: number; missing: string[] };
  search: { available: boolean; net?: number };
  delta: number; matched: boolean;
}

function LiveReconcile() {
  const runId = useStore((s) => s.runId);
  const [r, setR] = useState<Recon | { error: string } | null>(null);
  useEffect(() => {
    if (!runId) return;
    fetch(`/api/reconcile/${runId}`).then((x) => x.json()).then(setR, (e: Error) => setR({ error: e.message }));
  }, [runId]);
  if (!runId) return null;
  if (!r) return <div className="recon">Reading every live payment back from PayPal…</div>;
  if ('error' in r) return <div className="recon warn">Reconciliation unavailable: {r.error}</div>;
  return (
    <div className={`recon ${r.matched ? 'ok' : 'warn'}`}>
      <b>{r.matched ? '✓ RECONCILED WITH PAYPAL, TO THE CENT' : '✗ PAYPAL DOES NOT MATCH'}</b>
      <span>
        sim says {money(r.sim.net, 2)} moved over {r.sim.orders} live orders / {r.sim.refunds} refunds · PayPal confirms {money(r.paypal.net, 2)} across {r.observed.captures} captures and {r.observed.refunds} refunds, each read back by id
        {r.search.available ? ` · Transaction Search ${money(r.search.net ?? 0, 2)}` : ''}
        {r.matched ? '' : ` · Δ ${money(r.delta, 2)}${r.paypal.missing.length ? ` · ${r.paypal.missing.length} not found` : ''}`}
      </span>
    </div>
  );
}

/** On the twin nothing is reconciled, so show the last real sandbox run instead, labelled as such. */
function SandboxProof() {
  const when = new Date(proof.at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' });
  return (
    <div className={`recon proof ${proof.matched ? 'ok' : 'warn'}`}>
      <b>{proof.matched ? '✓ LAST LIVE RUN RECONCILED WITH PAYPAL, TO THE CENT' : '✗ LAST LIVE RUN DID NOT MATCH'}</b>
      <span>
        {proof.rulebook} on the PayPal sandbox, {when}: {proof.orders} orders and {proof.refunds} refunds, {money(proof.net, 2)} net, all {proof.readBack} payments read back from PayPal by id · run {proof.runId}
        {proof.sampleCaptures.length ? ` · captures ${proof.sampleCaptures.slice(0, 2).join(', ')}…` : ''}
      </span>
      <em>This day ran on the twin. Run the lab server with sandbox keys and open ?live=1 to reconcile your own.</em>
    </div>
  );
}

export function Report() {
  const show = useStore((s) => s.showReport);
  const lanes = useStore((s) => s.lanes);
  const policies = useStore((s) => s.policies);
  const live = useStore((s) => s.paypal === 'sandbox');
  const rolling = useStore((s) => s.cinema.rolling);
  const w = useStore((s) => s.whatif);
  if (!show) return null;
  const close = () => useStore.setState({ showReport: false });
  // the best preset this day, if it beats the first lane: one click races it on the same seed
  const mine = w && w !== 'pending' ? w.mine[0] : null;
  const top = w && w !== 'pending' ? [...w.alternatives].sort((a, b) => b.net - a.net)[0] : null;
  const better: Policy | null = mine && top && top.net > mine.net ? PRESETS[top.key] ?? null : null;
  const race = (p: Policy) => { close(); client.start([policies[0], p]); setTimeout(() => client.send({ cmd: 'play' }), 300); };
  return (
    <div className="report-wrap" onClick={() => useStore.setState({ showReport: false })}>
      <div className="report panel" onClick={(e) => e.stopPropagation()}>
        <div className="report-head"><span className="glyph">EOD</span><div><h2>END OF DAY REPORT</h2><p>{live ? '24 simulated hours · lane A paid on the PayPal sandbox, reconciled below' : '24 simulated hours · every payment on the PayPal twin, a contract-tested model of the Orders v2 API'}</p></div></div>
        <div className={`report-cols n${lanes.length}`}>
          {lanes.map((l, i) => l.metrics && (
            <div className="report-col" key={i}>
              <h3>{lanes.length > 1 ? `${LANE_NAMES[i]} · ` : ''}{policies[i]?.name}</h3>
              <div className="report-big">
                <div><b className="cy">{pct(l.metrics.safety)}</b><span>fraud $ stopped</span></div>
                <div><b className="gr">{pct(l.metrics.access)}</b><span>honest buys completed</span></div>
              </div>
              <div className="report-row"><span>Stolen</span><b className="bad">{money(l.metrics.fraud.leaked)}</b></div>
              <div className="report-row"><span>Double charges</span><b className={l.metrics.chaos.duplicateValue > 0.5 ? 'warn' : ''}>{money(l.metrics.chaos.duplicateValue)}</b></div>
              <div className="report-row"><span>Lost (stolen + double charges)</span><b className="bad">{money(l.metrics.fraud.leaked + l.metrics.chaos.duplicateValue)}</b></div>
              <div className="report-row"><span>Honest GMV</span><b>{money(l.metrics.honest.gmv)}</b></div>
              <div className="report-row"><span>Net value</span><b>{money(l.metrics.netValue)}</b></div>
              <ul>{findings(l.metrics).map((f, k) => <li key={k}>{f}</li>)}</ul>
            </div>
          ))}
        </div>
        <WhatIf />
        {live ? <LiveReconcile /> : <SandboxProof />}
        <div className="report-foot">
          {!rolling && better && <button className="btn hot" onClick={() => race(better)}>⑂ RACE {better.name.toUpperCase()} AGAINST {policies[0]?.name.toUpperCase()}</button>}
          {!rolling && <button className="btn tune-btn" onClick={() => { close(); startTune('safe'); }}>✦ AUTO-TUNE A RULEBOOK</button>}
          <button className="btn" onClick={close}>CLOSE</button>
        </div>
      </div>
    </div>
  );
}
