import { useState } from 'react';
import { policyId, PRESETS, type Policy } from '@sandbox-city/core';
import { useStore } from '../store';
import { waitingMetrics } from '../run-status';
import { client } from '../sim/client';
import { money } from './meta';
import raw from '../data/evidence.json';
import { MoneyStates } from './MoneyStates';

/** The rulebooks the evidence is about. The presets on their own would leave them out of the first screen. */
const ev = raw as unknown as { third: { frozen: { rules: Policy } } | null; fourth: { frozen: { rules: Policy } } | null };

const CHOICES: { policy: Policy; plain: string }[] = [
  { policy: PRESETS.open, plain: 'No checks. Every order is paid.' },
  { policy: PRESETS.passport, plain: 'Agents must show a passport. Nothing else is checked.' },
  { policy: PRESETS.kya, plain: 'Checks the agent, its signature and what its owner allowed.' },
  { policy: PRESETS.tuned, plain: 'Tuned in the lab to stop fraud and keep honest buyers.' },
  { policy: PRESETS.fortress, plain: 'Every check, set strict. Honest buyers pay for it.' },
  ...(ev.third ? [{ policy: { ...ev.third.frozen.rules, name: 'Frozen v3' }, plain: 'Stops the most theft of the top rulebooks, and holds the most money.' }] : []),
  ...(ev.fourth ? [{ policy: { ...ev.fourth.frozen.rules, name: 'Frozen v4' }, plain: 'Keeps the most value. Picked by a rule written before the test.' }] : []),
];

const replay = (p: Policy) => { client.start([p]); setTimeout(() => client.send({ cmd: 'play' }), 300); };

/** The first screen's left panel: one decision, in words. Every rule and slider is one click away in the full lab. */
export function SimpleRules() {
  const current = useStore((s) => s.policies[0]);
  const hash = current && policyId(current);
  const [advanced, setAdvanced] = useState(false);
  const choices = advanced ? CHOICES : CHOICES.filter(({ policy }) => policy.name === 'Frozen v3' || policy.name === 'Frozen v4');
  return (
    <aside className="rulebook panel simple-rules">
      <h2 className="simple-h"><i>1</i>Pick a rulebook</h2>
      <div className="choices" role="radiogroup" aria-label="Rulebook">
        {choices.map(({ policy, plain }) => (
          <button key={policy.name} role="radio" aria-checked={hash === policyId(policy)} className={`choice ${hash === policyId(policy) ? 'on' : ''}`} onClick={() => replay(policy)}>
            <b>{policy.name === 'Frozen v3' ? 'Wait through the complaint window' : policy.name === 'Frozen v4' ? 'Release earlier with an exposure limit' : policy.name}</b><span>{policy.name} · {plain}</span>
          </button>
        ))}
      </div>
      <button className="simple-link" onClick={() => setAdvanced(!advanced)}>{advanced ? 'Show the main tradeoff' : 'All historical rulebooks'}</button>
      {current && <p className="simple-note">City: {current.name} · policy <code>{hash}</code>. The comparison labels safeguards added to its benchmark arms.</p>}
      <p className="simple-note">Same shoppers, same attackers, every time. Only the rules change.</p>
      <button className="simple-link" onClick={() => useStore.setState({ fullLab: true })}>Change individual rules →</button>
    </aside>
  );
}

/** The first screen's right panel: three numbers and one sentence. */
export function SimpleHud() {
  const m = useStore((s) => s.lanes[0]?.metrics);
  const ready = useStore((s) => !!s.lanes[0]?.world), running = useStore((s) => s.running);
  if (!m) { const wait = waitingMetrics(ready, running); return <aside className="hud panel simple-hud"><h2 className="simple-h"><i>2</i>Read the result</h2><p className="simple-note" role="status"><b>{wait.title}</b> {wait.detail}</p></aside>; }
  const held = m.honest.heldDollarMinutes / Math.max(m.t, 60);
  const waiting = m.money.pending + m.money.unresolved > 0;
  const resolvedFraud = m.fraud.prevented + m.fraud.leaked;
  const safety = waiting && !resolvedFraud ? 'Awaiting confirmed payment results' : `${(m.safety * 100).toFixed(0)}% of ${waiting ? 'resolved fraud stopped; pending excluded' : 'attempted fraud stopped'}`;
  return (
    <aside className="hud panel simple-hud">
      <h2 className="simple-h"><i>2</i>Read the result</h2>
      <div className="stat bad"><label>Money stolen</label><b>{money(m.fraud.leaked)}</b><span>{safety}</span></div>
      <div className="stat good"><label>Value delivered</label><b>{money(m.honest.fulfilledValue)}</b><span>honest orders that arrived and stayed paid</span></div>
      <div className="stat"><label>Honest purchases accepted</label><b>{(m.access * 100).toFixed(1)}%</b><span>{m.honest.completed.toLocaleString('en-US')} of {m.honest.attempts.toLocaleString('en-US')}. Accepted is not yet delivered</span></div>
      <div className="stat warnc"><label>Honest money held now</label><b>{money(m.money.honestHeldNow)}</b><span>Average over this run: {money(held)}, counting holds that have ended</span></div>
      <MoneyStates m={m} />
      <button className="simple-cta" onClick={() => useStore.setState({ showWorth: true })}>Is it worth it? →</button>
      <button className="simple-link" onClick={() => useStore.setState({ showEvidence: true })}>See the evidence →</button>
    </aside>
  );
}

/** One line under the city, so what is happening can be read without the event feed. */
export function Caption() {
  const f = useStore((s) => s.feed[0]);
  if (!f) return null;
  return <div className={`caption tone-${f.tone}`} aria-live="off">{f.text}</div>;
}
