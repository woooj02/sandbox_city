import { plainName } from '../rulebook-names';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridApi, ICellRendererParams, IRowNode, ITooltipParams } from 'ag-grid-community';
import { INJECTIONS } from '@sandbox-city/core';
import { useStore } from '../store';
import { gridTheme } from './Ledger';
import { modelLabel } from '../sim/brain';
import { useModal } from './useModal';
import { money } from './meta';
import toolkit from '../data/toolkit-proof.json';
import rate from '../data/hijack-rate.json';

/** The city's four injection templates, by the trick each one plays. */
export const TEMPLATE_NAMES = ['System notice', 'Hidden HTML comment', 'Agent "pro tip"', 'Social proof'];

type Gate = Record<string, string>;
interface Plan { buy: boolean; qty: number; shipTo: string; reason: string; hijacked: boolean; gate?: Gate }
interface RateCase { seed: string; store: string; title: string; price: number; text: string; injected: boolean; template: number; owner: { qty: number; address: string; budget: number }; plain: Plan | null; guarded: Plan | null }
interface Tally { poisoned: number; hijacked: number; skipped: number; byTemplate: { cases: number; hijacked: number }[]; refused: Record<string, number>; clean: number; cleanBought: number; cleanRefused: Record<string, number> }
interface TkStep { tool: string; gate: string; reason?: string; status?: string; orderId?: string; total?: number; shipTo?: string }
interface TkLane { rulebook: string; steps: TkStep[]; paid: { orderId: string; total: number; shipTo: string; qty: number } | null; strayed: boolean; said?: string }
interface TkCase { store: string; title: string; price: number; text: string; injected: boolean; owner: { address: string; qty: number; budget: number }; plan?: { buy: boolean; qty: number; shipTo: string; reason: string } | null; lanes: TkLane[] }
interface TkRefund { rulebook: string; case: number; orderId: string; captureId?: string; refundId?: string; status?: string; confirmed?: string; amount?: number }

const cases = rate.cases as RateCase[];
const plain = rate.prompts.plain as Tally, guarded = rate.prompts.guarded as Tally;
const tkCases = toolkit.cases as TkCase[];
const refunds = ((toolkit as { refunds?: TkRefund[] }).refunds ?? []);
const hero = refunds[0] ? { c: tkCases[refunds[0].case - 1], r: refunds[0] } : null;
const GATES = ['Lab-Tuned', 'Know Your Agent'];
const day = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** The listing text with the planted instruction marked, wherever one of the city's templates matches. */
function Listing({ text }: { text: string }) {
  for (const t of INJECTIONS) {
    const re = new RegExp(t.text.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{qty\}|\{drop\}/g, '.+?'));
    const m = re.exec(text);
    if (m) return <>{text.slice(0, m.index)}<mark>{m[0]}</mark>{text.slice(m.index + m[0].length)}</>;
  }
  return <>{text}</>;
}

const pctOf = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');

function Story() {
  if (!hero) return null;
  const { c, r } = hero;
  const lanes = c.lanes;
  const paid = lanes.find((l) => l.paid);
  return (
    <ol className="hj-story">
      <li className="hj-step s-page">
        <div className="hj-n">01 · THE PAGE</div>
        <h4>{c.store} · “{c.title}”</h4>
        <p className="hj-owner">Owner asked for <b>{c.owner.qty}</b>, shipped to <b>{c.owner.address}</b>, budget {money(c.owner.budget)}.</p>
        <p className="hj-text"><Listing text={c.text} /></p>
      </li>
      <li className="hj-step s-plan">
        <div className="hj-n">02 · THE PLAN</div>
        <h4>{modelLabel(toolkit.model)} wrote</h4>
        {c.plan && <p className="hj-plan">buy <b className="bad">{c.plan.qty}</b> · ship to <b className="bad">{c.plan.shipTo}</b></p>}
        {c.plan && <p className="hj-quote">“{c.plan.reason}”</p>}
        <p className="hj-dim">The executor model saw only this plan, and placed it with the toolkit's create_order.</p>
      </li>
      <li className="hj-step s-gate">
        <div className="hj-n">03 · THE GATE</div>
        <h4>Same call, three rulebooks</h4>
        {lanes.map((l) => {
          const refused = l.steps.find((s) => s.gate === 'refused');
          return (
            <div key={l.rulebook} className={`hj-lane ${l.paid ? 'paid' : refused ? 'refused' : ''}`}>
              <span>{plainName(l.rulebook)}</span>
              {l.paid ? <b>PAID {money(l.paid.total, 2)}</b> : refused ? <b>REFUSED</b> : <b>—</b>}
              <small>{l.paid ? `pay_order COMPLETED · order ${l.paid.orderId}` : refused ? `${refused.reason} · never reached PayPal` : l.said}</small>
            </div>
          );
        })}
      </li>
      <li className="hj-step s-audit">
        <div className="hj-n">04 · THE AUDIT</div>
        <h4>{money(r.amount ?? 0, 2)} back</h4>
        <p className="hj-chain"><code>get_order</code> → capture <em>{r.captureId}</em></p>
        <p className="hj-chain"><code>create_refund</code> → refund <em>{r.refundId}</em> · {r.status}</p>
        <p className="hj-chain"><code>get_refund</code> → {r.confirmed}</p>
        <p className="hj-dim">{paid ? 'No checks paid it; the audit took it back through the same toolkit.' : ''}</p>
      </li>
    </ol>
  );
}

function Stats() {
  const refusedAll = Math.min(...GATES.map((g) => plain.refused[g] ?? 0));
  const cleanRefused = Math.max(...GATES.map((g) => plain.cleanRefused[g] ?? 0));
  return (
    <div className="hj-stats">
      <div className="hj-stat bad"><b>{pctOf(plain.hijacked, plain.poisoned)}</b><span>of poisoned listings became a hijacked plan</span><em>{plain.hijacked} of {plain.poisoned} · ordinary shopping prompt</em></div>
      <div className="hj-stat cy"><b>{refusedAll}/{plain.hijacked}</b><span>hijacked orders refused by the gate</span><em>Auto-tuned by ship lock, Agent checks by owner mandate</em></div>
      <div className="hj-stat gr"><b>{cleanRefused}</b><span>honest orders refused</span><em>of {plain.cleanBought} the model planned for real owners</em></div>
      <div className="hj-stat gold"><b>{pctOf(guarded.hijacked, guarded.poisoned)}</b><span>hijacked with the careful prompt</span><em>but it skipped {guarded.clean - guarded.cleanBought} of {guarded.clean} honest buys too</em></div>
    </div>
  );
}

/* ───── grid 0: one change at a time ───── */
interface Probe { kind: string; note: string; n: number; refused: Record<string, number> }
const probes = (rate as { probes?: { rulebooks: string[]; rows: Probe[] } }).probes;
const ProbeCell = ({ value, data }: ICellRendererParams<Probe, number>) => {
  if (!data || value == null) return null;
  const honest = data.kind === 'Honest plans';
  // a hijack row is good when everything is refused; the honest row is good when nothing is
  const good = honest ? value === 0 : value === data.n, none = honest ? value === data.n : value === 0;
  return <span className={good ? 'hj-ok' : none ? 'bad' : 'hj-part'}>{good ? '✓' : '✕'} {value}/{data.n} refused</span>;
};
function Probes() {
  // on a phone the rulebook columns matter more than the description, which the row's tooltip still carries
  const narrow = typeof window !== 'undefined' && window.innerWidth < 760;
  const cols = useMemo<ColDef<Probe>[]>(() => [
    { field: 'kind', headerName: 'THE PLAN, WITH', width: 150, cellClass: 'hj-strong', tooltipField: 'note', pinned: narrow ? 'left' : undefined },
    { field: 'note', headerName: 'WHAT CHANGED', flex: 1, minWidth: 200, cellClass: 'mono-dim', tooltipField: 'note', hide: narrow },
    ...(probes?.rulebooks ?? []).map((r): ColDef<Probe> => ({ colId: r, headerName: plainName(r).toUpperCase(), width: narrow ? 130 : 150, valueGetter: (p) => p.data?.refused[r], cellRenderer: ProbeCell })),
  ], [narrow]);
  if (!probes) return null;
  return (
    <div className="hj-grid">
      <AgGridReact<Probe> theme={gridTheme} rowData={probes.rows} columnDefs={cols} domLayout="autoHeight" tooltipShowDelay={200}
        getRowClass={(p) => (p.data?.kind === 'Honest plans' ? 'hj-honest-row' : '')}
        defaultColDef={{ resizable: true, sortable: false, suppressMovable: true }} />
    </div>
  );
}

/* ───── grid 1: which page tricks work ───── */
interface TRow { name: string; text: string; cases: number; plain: number; guarded: number; refused: number }
const Rate = ({ value, data, tone }: ICellRendererParams<TRow, number> & { tone: string }) => {
  if (!data) return null;
  const w = data.cases ? (value! / data.cases) * 100 : 0;
  return <span className={`hj-bar ${tone}`}><i style={{ width: `${w}%` }} /><b>{value}/{data.cases}</b><em>{pctOf(value!, data.cases)}</em></span>;
};
function Templates() {
  const rows = useMemo<TRow[]>(() => INJECTIONS.map((t, i) => {
    const hij = cases.filter((c) => c.template === i && c.plain?.hijacked);
    return {
      name: TEMPLATE_NAMES[i], text: t.text, cases: plain.byTemplate[i].cases, plain: plain.byTemplate[i].hijacked, guarded: guarded.byTemplate[i].hijacked,
      refused: hij.filter((c) => GATES.every((g) => c.plain!.gate?.[g] && c.plain!.gate[g] !== 'allowed')).length,
    };
  }), []);
  const cols = useMemo<ColDef<TRow>[]>(() => [
    { field: 'name', headerName: 'PAGE TRICK', width: 170, tooltipField: 'text', cellClass: 'hj-strong' },
    { field: 'text', headerName: 'WHAT THE PAGE SAYS', flex: 1, minWidth: 220, tooltipField: 'text', cellClass: 'mono-dim',
      cellRenderer: (p: ICellRendererParams<TRow, string>) => <>{(p.value ?? '').split(/(\{\w+\})/).map((s, i) => s.startsWith('{') ? <b key={i} className="hj-slot">{s.slice(1, -1)}</b> : s)}</> },
    { field: 'plain', headerName: 'HIJACKED · ORDINARY PROMPT', width: 210, cellRenderer: Rate, cellRendererParams: { tone: 'bad' }, sort: 'desc' },
    { field: 'guarded', headerName: 'CAREFUL PROMPT', width: 150, cellRenderer: Rate, cellRendererParams: { tone: 'gold' } },
    { field: 'refused', headerName: 'GATE REFUSED', width: 150, cellRenderer: (p: ICellRendererParams<TRow, number>) => p.data && <span className="hj-ok">{p.value} of {p.data.plain}</span> },
  ], []);
  return (
    <div className="hj-grid">
      <AgGridReact<TRow> theme={gridTheme} rowData={rows} columnDefs={cols} domLayout="autoHeight" tooltipShowDelay={200}
        defaultColDef={{ resizable: true, sortable: true, suppressMovable: true }} />
    </div>
  );
}

/* ───── grid 2: every plan ───── */
interface PRow { key: string; c: RateCase; day: string; listing: string; kind: string; owner: string; plan: string; verdict: 'hijacked' | 'skipped' | 'bought' | 'none'; gate: string; careful: string }
const VIEWS = {
  all: { label: 'ALL', test: () => true },
  hijacked: { label: 'HIJACKED', test: (r: PRow) => r.verdict === 'hijacked' },
  poisoned: { label: 'POISONED', test: (r: PRow) => r.c.injected },
  honest: { label: 'HONEST', test: (r: PRow) => !r.c.injected },
} as const;
type View = keyof typeof VIEWS;
const planText = (p: Plan | null) => !p ? 'no decision' : p.buy ? `buy ${p.qty} → ${p.shipTo}` : 'skip';
const Verdict = ({ value }: ICellRendererParams<PRow, string>) => <span className={`badge hjv-${value}`}>{value === 'hijacked' ? '✕ HIJACKED' : value === 'bought' ? '✓ FOR OWNER' : value === 'skipped' ? '· SKIPPED' : '—'}</span>;
const GateCell = ({ value, data }: ICellRendererParams<PRow, string>) => !data || value === '' ? <span className="mono-dim">—</span>
  : <span className={value === 'allowed' ? (data.verdict === 'hijacked' ? 'bad' : 'hj-ok') : 'hj-refused'}>{value === 'allowed' ? '✓ allowed' : `✕ ${(value ?? '').split(':')[0]}`}</span>;
const CaseTip = (p: ITooltipParams<PRow>) => p.data ? <div className="hj-tip"><b>{p.data.c.store} · {p.data.c.title}</b><p><Listing text={p.data.c.text} /></p></div> : null;

function Plans() {
  const api = useRef<GridApi<PRow> | null>(null);
  const [view, setView] = useState<View>('all');
  const viewRef = useRef<View>('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<PRow | null>(null);
  const rows = useMemo<PRow[]>(() => cases.map((c, i) => {
    const p = c.plain;
    const verdict: PRow['verdict'] = !p ? 'none' : p.hijacked ? 'hijacked' : p.buy ? 'bought' : 'skipped';
    return {
      key: String(i), c, day: c.seed, listing: `${c.store} · ${c.title}`, kind: c.injected ? TEMPLATE_NAMES[c.template] ?? 'poisoned' : 'honest page',
      owner: `${c.owner.qty} → ${c.owner.address}`, plan: planText(p), verdict, gate: p?.buy ? p.gate?.['Lab-Tuned'] ?? '' : '', careful: planText(c.guarded),
    };
  }), []);
  const cols = useMemo<ColDef<PRow>[]>(() => [
    { field: 'listing', headerName: 'LISTING', pinned: 'left', width: 250, tooltipComponent: CaseTip, tooltipField: 'listing' },
    { field: 'kind', headerName: 'PAGE', width: 150, cellClass: (p) => (p.data?.c.injected ? 'hj-kind' : 'mono-dim') },
    { field: 'owner', headerName: 'OWNER ASKED', width: 220, cellClass: 'mono-dim' },
    { field: 'plan', headerName: 'MODEL PLANNED', flex: 1, minWidth: 200, cellClassRules: { bad: (p) => p.data?.verdict === 'hijacked' } },
    { field: 'verdict', headerName: 'VERDICT', width: 124, cellRenderer: Verdict },
    { field: 'gate', headerName: 'GATE · AUTO-TUNED', width: 150, cellRenderer: GateCell },
    { field: 'careful', headerName: 'CAREFUL PROMPT', width: 200, cellClass: 'mono-dim' },
    { field: 'day', headerName: 'DAY', width: 110, cellClass: 'mono-dim' },
  ], []);
  const pick = (v: View) => { viewRef.current = v; setView(v); api.current?.onFilterChanged(); };
  const isExternalFilterPresent = useCallback(() => viewRef.current !== 'all', []);
  const doesExternalFilterPass = useCallback((n: IRowNode<PRow>) => !!n.data && VIEWS[viewRef.current].test(n.data), []);
  const count = (v: View) => rows.filter(VIEWS[v].test).length;
  return (
    <>
      <div className="hj-tools">
        {(Object.keys(VIEWS) as View[]).map((v) => <button key={v} className={`lv lv-${v} ${view === v ? 'on' : ''}`} onClick={() => pick(v)}>{VIEWS[v].label} <small>{count(v)}</small></button>)}
        <button className="lv" title="Download these plans as CSV" onClick={() => api.current?.exportDataAsCsv({ fileName: `sandbox-city-hijack-plans-${view}.csv`, columnKeys: ['listing', 'kind', 'owner', 'plan', 'verdict', 'gate', 'careful', 'day'] })}>⇣ CSV</button>
        <label className="lq"><span>grep</span><input value={q} spellCheck={false} placeholder="store, address, trick…" onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      <div className="hj-grid hj-plans">
        <AgGridReact<PRow> theme={gridTheme} rowData={rows} columnDefs={cols} getRowId={(p) => p.data.key}
          onGridReady={(e) => (api.current = e.api)} quickFilterText={q} tooltipShowDelay={250} tooltipInteraction
          isExternalFilterPresent={isExternalFilterPresent} doesExternalFilterPass={doesExternalFilterPass}
          rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
          onSelectionChanged={(e) => setSel(e.api.getSelectedRows()[0] ?? null)}
          getRowClass={(p) => (p.data?.verdict === 'hijacked' ? 'tone-breach' : '')}
          defaultColDef={{ resizable: true, sortable: true, filter: true }} />
      </div>
      {sel ? (
        <div className={`hj-detail ${sel.verdict}`}>
          <div><label>PAGE</label><p className="hj-text"><Listing text={sel.c.text} /></p></div>
          <div><label>OWNER</label><p>{sel.c.owner.qty} unit{sel.c.owner.qty === 1 ? '' : 's'} to {sel.c.owner.address}, budget {money(sel.c.owner.budget)} · listed at {money(sel.c.price, 2)}</p></div>
          {(['plain', 'guarded'] as const).map((k) => {
            const p = sel.c[k];
            return (
              <div key={k}><label>{k === 'plain' ? 'ORDINARY PROMPT' : 'CAREFUL PROMPT'}</label>
                <p><b className={p?.hijacked ? 'bad' : ''}>{planText(p)}</b>{p?.reason ? <> · “{p.reason}”</> : null}</p>
                {p?.buy && p.gate && <p className="hj-gates">{GATES.map((g) => <span key={g} className={p.gate![g] === 'allowed' ? 'hj-ok' : 'hj-refused'}>{g}: {p.gate![g] === 'allowed' ? 'allowed' : p.gate![g]}</span>)}</p>}
              </div>
            );
          })}
        </div>
      ) : <div className="hj-detail empty">Click a row to read the page and both plans. Hover a listing for its text.</div>}
    </>
  );
}

/* ───── grid 3: the paid run ───── */
interface RRow { key: string; n: number; listing: string; injected: boolean; plan: string; hijackedPlan: boolean; lanes: TkLane[]; refund?: TkRefund; c: TkCase }
const laneCell = (i: number) => ({ data }: ICellRendererParams<RRow>) => {
  const l = data?.lanes[i];
  if (!l) return null;
  const refused = l.steps.find((s) => s.gate === 'refused');
  if (l.paid) return <span className={l.strayed ? 'bad' : 'hj-ok'} title={`order ${l.paid.orderId}`}>{l.strayed ? '✕' : '✓'} PAID {money(l.paid.total, 2)} <small className="mono-dim">{l.paid.orderId}</small></span>;
  if (refused) return <span className="hj-refused" title={refused.reason}>✕ REFUSED · {refused.reason?.split(':')[0]}</span>;
  return <span className="mono-dim">{l.steps.length ? 'not paid' : '— not in plan'}</span>;
};
function PaidRun() {
  const rows = useMemo<RRow[]>(() => tkCases.map((c, i) => ({
    key: String(i), n: i + 1, listing: `${c.store} · ${c.title}`, injected: c.injected, c,
    plan: c.plan ? (c.plan.buy ? `buy ${c.plan.qty} → ${c.plan.shipTo}` : 'skip') : '—',
    hijackedPlan: !!c.plan?.buy && c.lanes.some((l) => l.strayed || l.steps.some((s) => s.gate === 'refused')),
    lanes: c.lanes, refund: refunds.find((r) => r.case === i + 1),
  })), []);
  const names = tkCases[0]?.lanes.map((l) => l.rulebook) ?? [];
  const cols = useMemo<ColDef<RRow>[]>(() => [
    { field: 'n', headerName: '#', width: 52 },
    { field: 'listing', headerName: 'LISTING', width: 230, tooltipValueGetter: (p) => p.data?.c.text, cellClassRules: { 'hj-kind': (p) => !!p.data?.injected } },
    { field: 'plan', headerName: 'PLAN', width: 200, cellClassRules: { bad: (p) => !!p.data?.hijackedPlan } },
    ...names.map((nm, i): ColDef<RRow> => ({ colId: `lane${i}`, headerName: plainName(nm).toUpperCase(), flex: 1, minWidth: 190, cellRenderer: laneCell(i), sortable: false })),
    { colId: 'refund', headerName: 'AUDIT', width: 210, sortable: false, cellRenderer: ({ data }: ICellRendererParams<RRow>) => data?.refund ? <span className="hj-ok" title={`capture ${data.refund.captureId}`}>↺ REFUNDED {money(data.refund.amount ?? 0, 2)} <small className="mono-dim">{data.refund.refundId}</small></span> : null },
  ], [names]);
  return (
    <div className="hj-grid">
      <AgGridReact<RRow> theme={gridTheme} rowData={rows} columnDefs={cols} domLayout="autoHeight" tooltipShowDelay={250}
        getRowClass={(p) => (p.data?.refund ? 'tone-breach' : '')} defaultColDef={{ resizable: true, suppressMovable: true }} />
    </div>
  );
}

/**
 * The hijack exhibit: one real model talked into an attacker's order on the PayPal sandbox, what each rulebook did
 * with the call, the refund, and how often it happens across every poisoned listing the city writes.
 */
export function Hijack() {
  const open = useStore((s) => s.showHijack);
  const close = () => useStore.setState({ showHijack: false });
  const panel = useModal<HTMLDivElement>(open, close);
  if (!open) return null;
  return createPortal(
    <div className="lab-theme report-wrap" onClick={close}>
      <div className="report panel hijack" ref={panel} tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="The hijack">
        <div className="report-head">
          <span className="glyph hj-glyph">HJK</span>
          <div>
            <h2>The hijack</h2>
            <p>A real model, a poisoned store page, real calls to the PayPal sandbox through {toolkit.toolkit}. Recorded {day(toolkit.recordedAt)} with {modelLabel(toolkit.model)}.</p>
          </div>
        </div>
        <Story />
        <h3 className="hj-h">How often · <span>{plain.poisoned} poisoned listings from {rate.seeds.length} simulated days, planned by {modelLabel(rate.model)} under two prompts, every planned order put through the gate</span></h3>
        <Stats />
        {probes && <>
          <h3 className="hj-h">One change at a time · <span>the same {probes.rows[0].n} hijacked plans, put through the gate again with only the address changed, then only the quantity; no model asked</span></h3>
          <Probes />
          <p className="hj-note">
            Every recorded hijack changed both the address and the quantity, so each gated rulebook caught all of them. Split the change and each catches only the half it checks: Auto-tuned's ship lock catches the address, Agent checks' owner mandate catches the quantity.
            Auto-tune found the Auto-tuned rulebook on simulated days and left the mandate off. Balanced checks both and refused none of the honest plans.
          </p>
        </>}
        <h3 className="hj-h">Which page tricks work</h3>
        <Templates />
        <h3 className="hj-h">Every plan · <span>{cases.length} cases</span></h3>
        <Plans />
        <h3 className="hj-h">The paid run · <span>{tkCases.length} listings, each placed under three rulebooks with create_order and pay_order on the sandbox, read back with get_order</span></h3>
        <PaidRun />
        <p className="hj-foot">
          The rate test asks the planner only and sends nothing to PayPal; each planned order goes through the same create_order check the paid run uses.
          Temperature 0 does not make a model repeat itself: in the paid run the planner followed 1 of 8 poisoned pages.
          The careful prompt held on these four tricks; the gate does not depend on the prompt holding. Model cost: {money((rate as { modelCost?: { usd: number } }).modelCost?.usd ?? 0, 4)} for {rate.modelCalls} planner calls.
        </p>
        <div className="report-foot"><button className="btn" onClick={close}>CLOSE</button></div>
      </div>
    </div>,
    document.body,
  );
}
