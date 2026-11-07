import { Scope } from './Scope';
import { prefersReducedMotion } from '../sim/motion';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef } from 'ag-grid-community';
import { useStore } from '../store';
import { gridTheme } from './Ledger';
import { useModal } from './useModal';
import { money } from './meta';
import raw from '../data/evidence.json';

interface Ci { mean: number; lo: number; hi: number }
interface Cohort { attempts: number; refused: number }
interface ArmRow {
  key: string; name: string; label?: string; policyId?: string; stolen: Ci; fulfilled: Ci; kept: Ci; access: Ci; heldDollarHours: Ci; challengedPer100: number; overBound: number;
  sleeper: { stolen: Ci; profit: Ci }; cohorts: { new_store: Cohort };
}
interface HeldArm { name: string; stolen: Ci; profit: Ci; kept: Ci; access: Ci }
interface Held { label: string; family: string; arms: HeldArm[] }
interface Round { label: string; evals: number; sleeperProfit: { before: Ci; after: Ci }; stolen: { before: Ci; after: Ci }; overBound: number }
interface Bench {
  frozen: { policyId: string; evaluator: string }; protocol: { testDays: number; mode: string }; arms: ArmRow[]; heldOut: Held[];
  sensitivity?: { rows: { key: string; label: string; ranking: string[] }[] }; adaptive?: { rounds: Round[] };
}
interface Recovery { mode: string; steps: { step: string; detail: string }[]; charges: { afterRecovery?: number; afterControl?: number } }
interface CheckoutRow { label: string; kind: string; decision: string; reason: string | null; policy: string; replay: boolean; payment: { state: string; captureId?: string } | null }
interface Checkout { mode: string; policy: string; rows: CheckoutRow[] }
interface SleeperRow { amount: number; escrow: boolean; finalState: string; provider: { capture: string | null; authorization: string | null } }
interface SleeperArm { label: string; ships: boolean; total: number; captured: number; keptByBuyers: number; rows: SleeperRow[] }
interface SleeperCheckout { mode: string; seed: string; policy: string; bound: number; record: { independent: number }; stated: string; arms: SleeperArm[] }
interface Reg { id: string; kind: string; title: string; minimized: { from?: Record<string, number>; to?: Record<string, number> } | null }
interface AgentTally { n: number; bought: number; breached: number; noAnswer: number }
const ev = raw as unknown as {
  first: Bench | null; second: Bench | null; third: Bench | null; fourth: Bench | null; recovery: Recovery | null; checkout: Checkout | null; sleeperCheckout: SleeperCheckout | null; regressions: Reg[]; sleeperCase: unknown;
  agents: Record<string, { poisoned: AgentTally; clean: AgentTally }> | null;
  defender: { model: string; budget: number; rows: { kind: string; rejected: number; accepted: number }[] } | null;
};

/** Which proofs ran against what. A mock is never called PayPal. */
const RAIL: Record<string, string> = { 'contract-mock': 'LOCAL CONTRACT MOCK, NOT PAYPAL', 'paypal-sandbox': 'PAYPAL SANDBOX' };
const Missing = ({ what }: { what: string }) => <p className="ev-missing">Not run yet: {what}. Nothing is shown in its place.</p>;
const ci = (c: Ci) => `${money(c.mean)} [${money(c.lo)}, ${money(c.hi)}]`;
const arm = (b: Bench, key: string) => b.arms.find((a) => a.key === key);
const heldArm = (h: Held, name: string) => h.arms.find((a) => a.name === name);

function Incident({ b }: { b: Bench }) {
  const tuned = arm(b, 'tuned'), fz = arm(b, 'frozen'), open = arm(b, 'open');
  if (!tuned || !fz || !open) return null;
  return (
    <ol className="hj-story">
      <li className="hj-step s-page"><div className="hj-n">01 · THE RECORD</div><h4>A store sells honestly</h4><p>It ships what it sells. A good record is what unlocks <b>instant capture</b>: money reaches the store when the buyer pays, not when the parcel moves.</p></li>
      <li className="hj-step s-plan"><div className="hj-n">02 · THE TURN</div><h4>Then it stops shipping</h4><p>It buys reach, discounts and bundles, and takes orders for goods that will never leave. It breaks no rule at the gate: every order is a normal order.</p></li>
      <li className="hj-step s-gate"><div className="hj-n">03 · THE LOSS</div><h4>Buyers pay, the store is gone</h4><p>The rule it breaks: no store may hold more unfulfilled money than its delivered record supports. Under Lab-Tuned it takes <b>{money(tuned.sleeper.stolen.mean)}</b> a day and clears <b>{money(tuned.sleeper.profit.mean)}</b> after warm-up and ad costs.</p></li>
      <li className="hj-step s-audit"><div className="hj-n">04 · THE BOUND</div><h4>Exposure is capped by record</h4><p>Past the bound, capture waits for proof of delivery. The frozen rulebook takes the attacker to <b>{money(fz.sleeper.stolen.mean)}</b> stolen and <b>{money(fz.sleeper.profit.mean)}</b> profit a day, over {b.protocol.testDays} simulated days. What profit remains is margin on goods it delivered.</p></li>
    </ol>
  );
}

/** Each rulebook as one point: what it keeps against what it loses. Whiskers are 95% intervals over days. */
function Frontier({ b }: { b: Bench }) {
  const [hover, setHover] = useState<ArmRow | null>(null);
  const W = 760, H = 300, L = 84, R = 24, T = 14, B = 40;
  const maxX = Math.max(...b.arms.map((a) => a.stolen.hi)) * 1.08, top = Math.max(...b.arms.map((a) => a.kept.hi)) * 1.06;
  const x = (v: number) => L + (v / maxX) * (W - L - R), y = (v: number) => H - B - (v / top) * (H - T - B);
  // rulebooks that land on each other get a label column, each tied to its own point by a line
  const near = (p: ArmRow, q: ArmRow) => Math.abs(x(p.stolen.mean) - x(q.stolen.mean)) < 90 && Math.abs(y(p.kept.mean) - y(q.kept.mean)) < 24;
  const close = b.arms.filter((a) => a.key === 'frozen');
  for (const seen of close) for (const a of b.arms) if (!close.includes(a) && near(seen, a)) close.push(a);
  const columnX = Math.max(0, ...close.map((a) => x(a.stolen.mean))) + 70, columnTop = Math.min(H, ...close.map((a) => y(a.kept.mean))) - 12;
  const slot = new Map([...close].sort((p, q) => q.kept.mean - p.kept.mean || p.stolen.mean - q.stolen.mean).map((a, i) => [a.key, columnTop + i * 17]));
  const ticks = (m: number) => { const s = m > 60000 ? 20000 : 10000; return Array.from({ length: Math.floor(m / s) + 1 }, (_, i) => i * s); };
  return (
    <div className="ev-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Value kept against money stolen for each rulebook. The table below has the same numbers.">
        {ticks(top).map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="ev-grid" /><text x={L - 8} y={y(v) + 4} textAnchor="end" className="ev-tick">{money(v)}</text></g>)}
        {ticks(maxX).map((v) => <text key={v} x={x(v)} y={H - B + 16} textAnchor="middle" className="ev-tick">{money(v)}</text>)}
        <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" className="ev-axis">stolen per day (less is better)</text>
        <text transform={`translate(13 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle" className="ev-axis">value kept per day</text>
        {b.arms.map((a) => {
          const mine = a.key === 'frozen', px = x(a.stolen.mean), py = y(a.kept.mean), left = px > W - 210;
          return (
            <g key={a.key} onMouseEnter={() => setHover(a)} onMouseLeave={() => setHover(null)}>
              <line x1={x(a.stolen.lo)} x2={x(a.stolen.hi)} y1={py} y2={py} className="ev-whisker" />
              <line x1={px} x2={px} y1={y(a.kept.lo)} y2={y(a.kept.hi)} className="ev-whisker" />
              <circle cx={px} cy={py} r={mine ? 7 : 5} className={mine ? 'ev-dot mine' : 'ev-dot'} />
              <circle cx={px} cy={py} r={16} fill="transparent" />
              {slot.has(a.key)
                ? <><line x1={px} y1={py} x2={columnX - 4} y2={slot.get(a.key)! - 4} className="ev-leader" /><text x={columnX} y={slot.get(a.key)} className={mine ? 'ev-label mine' : 'ev-label'}>{a.label ?? a.name}</text></>
                : <text x={px + (left ? -11 : 11)} y={left ? py + 20 : py - 8} textAnchor={left ? 'end' : 'start'} className={mine ? 'ev-label mine' : 'ev-label'}>{a.label ?? a.name}</text>}
            </g>
          );
        })}
      </svg>
      {hover && <div className="ev-tip"><b>{hover.label ?? hover.name}</b> kept {ci(hover.kept)} · stolen {ci(hover.stolen)} · honest access {(hover.access.mean * 100).toFixed(1)}%{hover.policyId && <> · policy <code>{hover.policyId}</code></>}</div>}
    </div>
  );
}

/** The declared winner, and in the same breath what it does not do. */
function FairPick({ b }: { b: Bench }) {
  const v4 = b.arms.find((a) => a.key === 'frozen'), v3 = b.arms.find((a) => a.key === 'frozen_v3');
  const box = b.heldOut?.find((h) => h.label === 'Empty box')?.arms;
  if (!v4 || !v3 || !box) return null;
  const stolen = (n: string) => money(box.find((a) => a.name === n)?.stolen.mean ?? 0);
  return (
    <>
      <p className="ev-p"><b>The declared rule picks Frozen v4:</b> the most value among rulebooks that meet the bar, {money(v4.kept.mean - v3.kept.mean)} a day more than v3, holding {Math.round(100 * (1 - v4.heldDollarHours.mean / v3.heldDollarHours.mean))}% less honest money. <b>It is not the safest.</b> v3 stops {money(v4.stolen.mean - v3.stolen.mean)} a day more, and it is the only rulebook that stops empty boxes: {stolen('Frozen v3')} a day against {stolen('Frozen v4')}. Those stores are not on these days. Which to use depends on what these things cost you.</p>
      <p className="ev-p"><button className="btn" onClick={() => useStore.setState({ showEvidence: false, showWorth: true })}>PRICE THEM WITH MY NUMBERS</button></p>
    </>
  );
}

function CostTable({ b }: { b: Bench }) {
  const cols = useMemo<ColDef<ArmRow>[]>(() => [
    { headerName: 'RULEBOOK', width: 220, pinned: 'left', valueGetter: (p) => p.data?.label ?? p.data?.name },
    { field: 'policyId', headerName: 'POLICY HASH', width: 170 },
    { headerName: 'VALUE KEPT', flex: 1, minWidth: 170, valueGetter: (p) => p.data?.kept.mean, valueFormatter: (p) => (p.data ? ci(p.data.kept) : '') },
    { headerName: 'STOLEN', flex: 1, minWidth: 160, valueGetter: (p) => p.data?.stolen.mean, valueFormatter: (p) => (p.data ? ci(p.data.stolen) : '') },
    { headerName: 'HONEST ACCESS', width: 118, valueGetter: (p) => p.data?.access.mean, valueFormatter: (p) => `${((p.value ?? 0) * 100).toFixed(1)}%` },
    { headerName: 'NEW STORES REFUSED', width: 142, valueGetter: (p) => (p.data ? p.data.cohorts.new_store.refused / Math.max(1, p.data.cohorts.new_store.attempts) : 0), valueFormatter: (p) => `${((p.value ?? 0) * 100).toFixed(1)}%` },
    { field: 'challengedPer100', headerName: 'STEP-UPS /100', width: 112 },
    { headerName: 'HELD $·HOURS', width: 112, valueGetter: (p) => p.data?.heldDollarHours.mean, valueFormatter: (p) => money(p.value ?? 0) },
  ], []);
  return <div className="hj-grid"><AgGridReact<ArmRow> theme={gridTheme} rowData={b.arms} columnDefs={cols} domLayout="autoHeight" getRowClass={(p) => (p.data?.key === 'frozen' ? 'ev-mine' : '')} defaultColDef={{ resizable: true, suppressMovable: true }} /></div>;
}

/** Plain arithmetic on the intervals, so a miss cannot be worded into a catch. */
function verdict(open?: HeldArm, mine?: HeldArm) {
  if (!open || !mine) return 'no data';
  const cut = 1 - mine.stolen.mean / Math.max(1, open.stolen.mean);
  if (mine.stolen.hi >= open.stolen.lo) return 'MISSED';
  return cut >= 0.8 ? 'CAUGHT' : 'PARTLY';
}

function HeldOut({ first, second, third }: { first: Bench | null; second: Bench | null; third: Bench }) {
  const repaired = new Set(['Wash warm-up', 'Empty box']);
  return (
    <div className="ev-held">
      {third.heldOut.map((h) => {
        const open = heldArm(h, 'Wild West'), mine = heldArm(h, 'Frozen v3'), before = first?.heldOut.find((x) => x.label === h.label)?.arms.find((a) => a.name === 'Frozen');
        const repair = second?.heldOut.find((x) => x.label === h.label)?.arms.find((a) => a.name === 'Frozen v2');
        const v = verdict(open, mine);
        return (
          <div key={h.label} className={`ev-case v-${v.toLowerCase().replace(' ', '-')}`}>
            <div className="ev-case-head"><b>{h.label}</b><span>{v}</span></div>
            <small>{repaired.has(h.label) ? 'beat the first rulebook, then became development data: not a blind result any more' : 'never tuned on and not repaired'}</small>
            <dl>
              {before && <><dt>Frozen v1, blind</dt><dd>{money(before.stolen.mean)}</dd></>}
              {repair && <><dt>Frozen v2</dt><dd>{money(repair.stolen.mean)}</dd></>}
              <dt>No defense</dt><dd>{open ? money(open.stolen.mean) : '—'}</dd>
              <dt>Frozen v3</dt><dd>{mine ? money(mine.stolen.mean) : '—'}</dd>
            </dl>
          </div>
        );
      })}
    </div>
  );
}

function Adaptive({ b }: { b: Bench }) {
  const rounds = b.adaptive?.rounds;
  if (!rounds) return <Missing what="the attacker search against the frozen rulebook" />;
  return (
    <ul className="ev-list">
      {rounds.map((r) => <li key={r.label}><b>{r.label}</b> attacker, {r.evals} tries: sleeper profit {money(r.sleeperProfit.before.mean)} → <b>{money(r.sleeperProfit.after.mean)}</b> a day. The exposure bound was exceeded by {money(r.overBound)}.</li>)}
    </ul>
  );
}

/** The negative result, in the same place as the positive ones. */
function Defender({ d }: { d: NonNullable<typeof ev.defender> }) {
  const total = (kind: string, f: (r: { rejected: number; accepted: number }) => number) => d.rows.filter((r) => r.kind === kind).reduce((n, r) => n + f(r), 0);
  const tries = d.rows.filter((r) => r.kind === 'model').length * d.budget;
  return <p className="ev-p"><b>Can a model repair the rulebook?</b> Not in this test. {d.model} read the incident and proposed changes: {total('model', (r) => r.accepted)} were kept, and containment rejected {total('model', (r) => r.rejected)} of {tries}. Blind mutation had {total('mutation', (r) => r.accepted)} kept at the same budget.</p>;
}

/** The benchmark's failure, carried out of the simulation: what PayPal says happened to each order. */
function SleeperAtCheckout({ s }: { s: SleeperCheckout }) {
  const cents = (n: number) => `$${n.toFixed(2)}`;
  return (
    <>
      <p className="ev-p"><span className="ev-tag">{RAIL[s.mode]}</span> The store's record and its orders come from simulated day <code>{s.seed}</code>: {cents(s.record.independent)} of independent credit, so a bound of {cents(s.bound)} under rulebook <code>{s.policy}</code>. Past the bound the checkout places a PayPal authorization, so no money moves. The evaluator sees the store's exposure grow with each order.</p>
      <div className="ev-held" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {s.arms.map((a) => {
          const held = a.rows.filter((r) => r.escrow).length, voided = a.rows.filter((r) => r.provider.authorization === 'VOIDED').length, released = a.rows.filter((r) => r.provider.authorization === 'CAPTURED').length;
          return (
            <div key={a.label} className={`ev-case ${a.captured < a.total || a.ships ? 'v-caught' : 'v-missed'}`}>
              <div className="ev-case-head"><b>{a.label}</b></div>
              <small>{a.ships ? 'ships everything, nobody complains' : 'ships nothing, every buyer complains'}</small>
              <dl>
                <dt>Sold</dt><dd>{cents(a.total)}</dd>
                <dt>{a.ships ? 'Store received' : 'Store kept'}</dt><dd>{cents(a.captured)}</dd>
                <dt>Orders held</dt><dd>{held} of {a.rows.length}</dd>
                {held > 0 && <><dt>{a.ships ? 'Released' : 'Voided'}</dt><dd>{a.ships ? released : voided}</dd></>}
              </dl>
            </div>
          );
        })}
      </div>
      <p className="ev-p ev-note">{s.stated}</p>
    </>
  );
}

function CheckoutProof({ c }: { c: Checkout }) {
  return (
    <>
      <p className="ev-p"><span className="ev-tag">{RAIL[c.mode]}</span> Every answer below names rulebook <code>{c.policy}</code>, the id the benchmark measured. The evaluator is one function, called by the simulation and by <code>POST /api/checkout</code>.</p>
      <div className="ev-rows">
        {c.rows.map((r) => (
          <div key={r.label} className={`ev-row ${r.payment ? 'paid' : 'stop'}`}>
            <b>{r.label}</b>
            <span>{r.replay ? 'answered from the journal, no new charge' : r.decision.toUpperCase()}</span>
            <small>{r.reason ?? (r.payment ? `${r.payment.state} · capture ${r.payment.captureId}` : '')}</small>
          </div>
        ))}
      </div>
    </>
  );
}

function RecoveryProof({ r }: { r: Recovery }) {
  return (
    <>
      <p className="ev-p"><span className="ev-tag">{RAIL[r.mode]}</span> A real process, killed with SIGKILL after the capture succeeded and before it could write that down.</p>
      <ol className="ev-steps">{r.steps.map((s) => <li key={s.step}><b>{s.step}</b> {s.detail}</li>)}</ol>
      <div className="ev-charges"><div><b>{r.charges.afterRecovery ?? '—'}</b><span>charge with the journal</span></div><div className="bad"><b>{r.charges.afterControl ?? '—'}</b><span>charges for a client that retries without one</span></div></div>
    </>
  );
}

function Regressions() {
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(ev.sleeperCase, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'day-sleeper-store.json' });
    a.click();
    URL.revokeObjectURL(url);
  };
  const m = ev.regressions.find((c) => c.id === 'day-sleeper-store')?.minimized;
  return (
    <>
      <p className="ev-p">{ev.regressions.length} cases in <code>regressions/</code>. Any agent in any language can run them: it reads a case as JSON on stdin and prints its order. Passing is decided by plain code.{m?.from && m.to ? ` The sleeper day was reduced from ${m.from.shoppers} shoppers and ${m.from.merchants} stores to ${m.to.shoppers} and ${m.to.merchants}, and replays to the cent.` : ''}</p>
      <pre className="ev-cmd">npx tsx scripts/regress.ts regressions --agent "python3 examples/agents/careful.py"</pre>
      {ev.agents && <div className="ev-rows">{Object.entries(ev.agents).map(([k, a]) => (
        <div key={k} className="ev-row"><b>{k}</b><span>{a.poisoned.breached} of {a.poisoned.n} poisoned listings breached the mandate</span><small>bought {a.clean.bought} of {a.clean.n} clean listings{a.poisoned.noAnswer + a.clean.noAnswer ? ` · ${a.poisoned.noAnswer + a.clean.noAnswer} unreadable answers` : ''}</small></div>
      ))}</div>}
      {!!ev.sleeperCase && <button className="btn" onClick={download}>DOWNLOAD THE SLEEPER CASE</button>}
    </>
  );
}

/** The case for the project in the order an auditor asks: the failure, its cost, what it misses, and whether the money is safe. */
export function Evidence() {
  const open = useStore((s) => s.showEvidence);
  const experiment = useStore((s) => s.experiment);
  const decision = useStore((s) => s.savedDecision);
  const close = () => useStore.setState({ showEvidence: false });
  const panel = useModal<HTMLDivElement>(open, close);
  if (!open) return null;
  const b = ev.third ?? ev.second ?? ev.first;
  const f = ev.fourth ?? b;
  const flips = f?.sensitivity?.rows.filter((r) => r.ranking[0] !== 'frozen') ?? [];
  return createPortal(
    <div className="lab-theme report-wrap" onClick={close}>
      <div className="report panel hijack" ref={panel} tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="The evidence">
        <div className="report-head">
          <span className="glyph ev-glyph">EVD</span>
          <div>
            <h2>THE EVIDENCE</h2>
            <p>One failure, what stopping it costs, what still gets through, and what happens to the money when a process dies. Simulated days are simulation; each proof says what it ran against.</p>
          </div>
        </div>
        <Scope experiment={experiment} title="Evidence library · recorded runs with separate populations, policies and dates" />
        {decision && <p className="worth-assumption">Kept decision: {decision.selected.label} · policy {decision.selected.policyHash} · experiment {decision.experiment?.id}. Receipts below retain their recorded policies; they are not executions of this decision unless their hashes match. Owner/order context must match too.</p>}
        <button className="btn" onClick={close}>Return to the same task and result</button>
        {!b ? <Missing what="the benchmark" /> : <>
          <nav className="ev-path" aria-label="The path through the evidence">
            {[['ev-cost', 'Compare what stopping it costs'], ['ev-missed', 'See what still gets through'], ['ev-checkout', 'Watch it at the checkout'], ['ev-regressions', 'Take it into CI']].map(([id, label], i) => (
              <button key={id} onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'instant' : 'smooth' })}><i>{i + 2}</i>{label}</button>
            ))}
          </nav>
          <Incident b={b} />
          <h3 className="hj-h" id="ev-cost">THE COST OF STOPPING IT · <span>{f!.protocol.testDays} fresh simulated days, the same safeguards on every rulebook, the rule for a winner written first</span></h3>
          <Frontier b={f!} />
          <CostTable b={f!} />
          <FairPick b={f!} />
          <p className="ev-p">{f!.sensitivity ? (flips.length === f!.sensitivity.rows.length ? `On value kept, this rulebook did not come first under any of ${f!.sensitivity.rows.length} changed assumptions. Frozen v1 keeps more; v3 stops more.` : flips.length ? `The frozen rulebook lost first place under ${flips.length} of ${f!.sensitivity.rows.length} changed assumptions: ${flips.map((f) => f.label).join('; ')}.` : `The frozen rulebook kept first place under all ${f!.sensitivity.rows.length} changed assumptions.`) : ''} Fees, cost of goods and owner approval rates are stated assumptions, not measurements.</p>
          <h3 className="hj-h" id="ev-missed">WHAT IT WAS NOT TUNED ON · <span>stolen per day. A miss is reported as a miss. Each round ran on its own days, so compare within a round, not across them</span></h3>
          {ev.third ? <HeldOut first={ev.first} second={ev.second} third={ev.third} /> : <Missing what="the third frozen rulebook" />}
          <h3 className="hj-h">AN ATTACKER THAT ADAPTS · <span>a search for the most profitable sleeper against the frozen rulebook</span></h3>
          <Adaptive b={b} />
          {ev.defender && <Defender d={ev.defender} />}
        </>}
        <h3 className="hj-h" id="ev-checkout">THE SAME FAILURE AT THE CHECKOUT · <span>orders PayPal really held, voided or captured</span></h3>
        {ev.sleeperCheckout ? <SleeperAtCheckout s={ev.sleeperCheckout} /> : <Missing what="the sleeper at the checkout" />}
        <h3 className="hj-h">THE SAME RULEBOOK, ORDER BY ORDER</h3>
        {ev.checkout ? <CheckoutProof c={ev.checkout} /> : <Missing what="the checkout proof" />}
        <h3 className="hj-h">THE LOST RESPONSE</h3>
        {ev.recovery ? <RecoveryProof r={ev.recovery} /> : <Missing what="the crash recovery proof" />}
        <h3 className="hj-h" id="ev-regressions">TAKE THE FAILURE WITH YOU</h3>
        <Regressions />
        <div className="report-foot"><button className="btn" onClick={close}>CLOSE</button></div>
      </div>
    </div>,
    document.body,
  );
}
