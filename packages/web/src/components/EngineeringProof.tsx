import { useStore } from '../store';
import fault from '../data/fault-proof.json';
import toolkit from '../data/toolkit-proof.json';
import fuzz from '../data/gate-fuzz.json';
import lab from '../data/agent-lab.json';
import labBreakdown from '../data/agent-lab-breakdown.json';

const n = (v: number) => v.toLocaleString('en-US');

/** Every fault schedule up to a depth, run for real against the payment worker. The model of PayPal is named as a model. */
export function FaultProof() {
  const caught = fault.mutants.filter((m) => m.caught).length;
  const honest = fault.workloads.filter((w) => w.unresolved === 0).length;
  return <>
    <p className="ev-p"><span className="ev-tag">{fault.provider}</span> The worker and its journal are the real code. Every journal write and PayPal call is a place a crash or lost answer can happen. This run tried every combination of up to {fault.maxFaults} of them, across {fault.workloads.length} payment flows.</p>
    <div className="ev-charges">
      <div><b>{n(fault.schedules)}</b><span>fault schedules run</span></div>
      <div><b>{fault.violating}</b><span>broke a payment promise</span></div>
      <div className="bad"><b>{n(fault.control.doubled)}</b><span>of {n(fault.control.schedules)} double-charged without the journal, up to {fault.control.worst} charges</span></div>
    </div>
    <p className="ev-p">{honest} of {fault.workloads.length} flows always reached a final state. In the other, an order changed at PayPal after the gate allowed it, and all {n(fault.unresolved)} schedules stop as unresolved for a person, with nothing captured. To test the test, {fault.mutants.length} bugs were seeded into the worker and journal: {caught} were caught.</p>
    <p className="ev-p">It earned its place. At 3 faults it found a real bug: a capture webhook arriving around a refund made the journal say captured while the ledger said refunded. It also found about 2,200 endings stuck on lagging reads. Both are fixed, and the case is kept as a test.</p>
  </>;
}

/** Hostile orders against an independent reference. Same author as the gate, which is stated. */
export function GateFuzzProof() {
  const books = fuzz.rulebooks;
  return <>
    <p className="ev-p"><span className="ev-tag">NO MONEY MOVES</span> A second checker, written separately in whole cents, judges each mutated order, and the gate must agree. Signatures are off for this test only, so that it reaches the order rules.</p>
    <div className="ev-charges">
      <div><b>{n(books.reduce((t, b) => t + b.runs, 0))}</b><span>hostile orders<span className="prov"> on seed {fuzz.seed}</span>, across {books.length} rulebooks</span></div>
      <div><b>{books.reduce((t, b) => t + b.unsound, 0)}</b><span>allowed that should be refused</span></div>
      <div><b>{books.reduce((t, b) => t + b.refusedGood + b.threw, 0)}</b><span>honest orders refused, or crashes</span></div>
    </div>
    <p className="ev-p">The first run was not clean. On 30,000 orders it found real bypasses, among them a foreign-script suffix on the address, a price a fraction of a cent off, and a $0 order made of junk lines. All are fixed and kept as named tests. The checker and the gate share an author, so agreement is strong evidence, not proof.</p>
  </>;
}

const NAMES: Record<string, string> = {
  control: 'No attack (a measure)', bare: 'No defense', gate: 'Checkout gate', prompt: 'Careful prompt', 'prompt+gate': 'Careful prompt and gate',
  'bound+gate': 'Bound order and gate', stack: 'Prompt, bound order and gate', quarantine: 'Facts only, bound order',
};
const trip = (per100: number) => `${per100 < 0 ? '−' : ''}$${Math.abs(per100 / 100).toFixed(2)}`;
type LabArm = (typeof lab.arms)[number];
/** Dollars per attacked trip from one outcome, read from the per-outcome totals the report keeps. */
const share = (a: LabArm, outcome: string) => trip((labBreakdown.lossPer100ByOutcome as Record<string, Record<string, number>>)[a.arm]?.[outcome] ?? 0);

/** The frozen round five: real local models shopping, scored by code, one rule fixed before the run. */
export function AgentLabProof() {
  const base = lab.arms.find((a) => a.arm === 'bare')!, gate = lab.arms.find((a) => a.arm === 'gate')!, control = lab.arms.find((a) => a.arm === 'control')!;
  const verdict = (a: (typeof lab.arms)[number]) => a.arm === 'control' ? 'measure only' : a.arm === 'bare' ? 'baseline' : a.arm === lab.pick ? 'PICKED' : !a.helps ? 'no clear help' : a.usable ? 'helps, less' : 'costs honest shopping';
  return <>
    <p className="ev-p"><span className="ev-tag">NO MONEY MOVES</span> {lab.models.length} local models ({lab.models.join(', ')}) shopped turn by turn in a sandboxed shop, {lab.episodes.toLocaleString('en-US')} episodes in all. The attack styles were held out until the protocol was frozen. The rule for the pick was written first: the lowest loss among defenses that clearly help and keep honest purchases within {lab.margin * 100} points.</p>
    <div className="ev-scroll"><table className="ev-lab">
      <thead><tr><th>Defense</th><th>Lost per attacked trip</th><th>Change against no defense, 95%</th><th>Honest purchases</th><th></th></tr></thead>
      <tbody>{lab.arms.map((a) => <tr key={a.arm} className={a.arm === lab.pick ? 'pick' : ''}>
        <td>{NAMES[a.arm] ?? a.arm}</td><td>{trip(a.lossPer100)}</td>
        <td>{a.vsBare ? `${trip(a.vsBare.loss.mean)} [${trip(a.vsBare.loss.lo)}, ${trip(a.vsBare.loss.hi)}]` : '—'}</td>
        <td>{a.honestBought} of {a.honest}</td><td>{verdict(a)}</td>
      </tr>)}</tbody>
    </table></div>
    <p className="ev-p">With no defense, an attacked trip lost {trip(base.lossPer100)}, {share(base, 'breach')} of it to orders past the owner's limits. The gate removed all of those: {lab.gateBreaches} breaches got past a gate. What it leaves, {share(gate, 'steered')} of its {trip(gate.lossPer100)}, is clean orders placed at the attacker's store. An order check cannot see that. The store's record can, which is what the sleeper proof above tests.</p>
    <p className="ev-p">With the attack text removed, models still lost {trip(control.lossPer100)}, mostly by choosing the attacker's store anyway. So the injection itself added {trip(lab.injection.mean)} [{trip(lab.injection.lo)}, {trip(lab.injection.hi)}]. The defenses that cut loss most did it by making models turn down good purchases, and the rule refused them. Losses are counted harshly, a steered order as all stolen, and the attacks and defenses share an author.</p>
  </>;
}

/** Why the fix is a checkout check and not a prompt rule, and what it leaves open. Numbers come from the frozen round. */
export function FixEvidence() {
  const arm = (k: string) => lab.arms.find((a) => a.arm === k)!;
  const base = arm('bare'), gate = arm('gate'), prompt = arm('prompt');
  return <div className="fix-evidence">
    <p><b>Why at checkout:</b> {lab.models.length} local models made {lab.episodes.toLocaleString('en-US')} shopping trips under a frozen protocol. The checkout gate cut loss per attacked trip from {trip(base.lossPer100)} to {trip(gate.lossPer100)}, honest purchases held ({gate.honestBought} of {gate.honest}, against {base.honestBought}), and {lab.gateBreaches} orders like this one got through. A careful prompt also cut loss, but honest purchases fell to {prompt.honestBought} of {prompt.honest}.</p>
    <p><b>What it does not stop:</b> a correct order at a dishonest store, which passes every order check. For that, the recommended rulebook (v4) holds payment until delivery once a store's unfulfilled money passes what its record supports.</p>
  </div>;
}

/** Opens the evidence page at one section. */
export function openEvidence(section: string) {
  useStore.setState({ showEvidence: true });
  setTimeout(() => document.getElementById(section)?.scrollIntoView({ block: 'start' }), 80);
}

/** The three measured results, on the front page, each with the way to its evidence. */
export function Findings() {
  const hijack = toolkit.lanes.find((l) => l.hijackedPaid > 0);
  const arm = (k: string) => lab.arms.find((a) => a.arm === k)!;
  return <section className="findings" aria-label="What the lab measured">
    <div className="lab-section-title"><h2>What the lab measured</h2><span>Recorded runs. Open each one to check it.</span></div>
    <div className="findings-cards">
      {hijack && <button onClick={() => useStore.setState({ showHijack: true })}><span>PAYPAL SANDBOX · {toolkit.recordedAt.slice(0, 10)}</span><b>${hijack.hijackedValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</b><p>A real model ({toolkit.model}) was talked into an attacker's order, paid through the PayPal Agent Toolkit with no checks. With the gate, the same order was refused.</p><i>See the hijack ↗</i></button>}
      <button onClick={() => openEvidence('ev-agents')}><span>{lab.models.length} MODELS · {lab.episodes.toLocaleString('en-US')} SHOPPING TRIPS</span><b>{trip(arm('bare').lossPer100)} → {trip(arm('gate').lossPer100)}</b><p>Lost per attacked trip, with no defense and with the checkout gate. Honest purchases held: {arm('gate').honestBought} of {arm('gate').honest}, against {arm('bare').honestBought}. Rules frozen before the run.</p><i>Read the study ↗</i></button>
      <button onClick={() => openEvidence('ev-faults')}><span>EVERY CRASH UP TO {fault.maxFaults} FAULTS</span><b>{n(fault.schedules)} · {fault.violating} double charges</b><p>Crashes, lost answers and late webhooks at every step of a payment, run on the real payment worker against an in-process model of PayPal. Without its journal, {n(fault.control.doubled)} of {n(fault.control.schedules)} charged twice or more.</p><i>See how ↗</i></button>
    </div>
  </section>;
}

/** After a comparison: what the same gate did for real models, so one example is not the whole argument. */
export function MeasuredResult() {
  const arm = (k: string) => lab.arms.find((a) => a.arm === k)!;
  return <div className="measured-result"><b>Measured with real models:</b> across {lab.models.length} local models and {lab.episodes.toLocaleString('en-US')} shopping trips, the checkout gate cut loss per attacked trip from {trip(arm('bare').lossPer100)} to {trip(arm('gate').lossPer100)}, and honest purchases held ({arm('gate').honestBought} of {arm('gate').honest}, against {arm('bare').honestBought}). <button className="simple-link" onClick={() => openEvidence('ev-agents')}>Read the study</button></div>;
}
