import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeQuartz, colorSchemeDark, ColDef, GridApi, ICellRendererParams, IRowNode } from 'ag-grid-community';
import { SimEvent } from '@sandbox-city/core';
import { ATTACK_SHORT } from './meta';
import { bus } from '../sim/bus';
import { useStore } from '../store';
import { clock, LANE_NAMES } from './meta';

ModuleRegistry.registerModules([AllCommunityModule]);

export const gridTheme = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: 'rgba(6,8,22,0.0)', foregroundColor: '#cfd8ff', headerBackgroundColor: 'rgba(20,24,60,0.85)', headerTextColor: '#8fa2ff',
  borderColor: 'rgba(110,130,255,0.14)', rowHoverColor: 'rgba(76,242,255,0.08)', fontFamily: 'JetBrains Mono, monospace', fontSize: 13,
  headerFontFamily: 'Chakra Petch, sans-serif', headerFontSize: 12.5, headerFontWeight: 700, rowHeight: 30, headerHeight: 34, spacing: 5,
  oddRowBackgroundColor: 'rgba(255,255,255,0.015)', accentColor: '#4cf2ff', wrapperBorder: false,
});

interface Row {
  key: string; lane: string; t: number; kind: 'ORDER' | 'REFUND'; id: string; paypal: string; rail: string; buyer: string; store: string;
  amount: number; gate: string; outcome: string; rules: string; truth: string; harm: number; tone: string;
}

/** How many rows the grid keeps on screen. The full run is kept separately, for the export. */
const CAP = 2500;

const COLUMNS: [string, (r: Row) => string | number][] = [
  ['lane', (r) => r.lane], ['time', (r) => clock(r.t)], ['type', (r) => r.kind], ['order', (r) => r.id], ['paypal_id', (r) => r.paypal], ['rail', (r) => r.rail || 'twin'],
  ['agent', (r) => r.buyer], ['store', (r) => r.store], ['amount', (r) => r.amount.toFixed(2)], ['gate', (r) => r.gate], ['outcome', (r) => r.outcome],
  ['ground_truth', (r) => r.truth], ['harm', (r) => r.harm], ['why', (r) => r.rules],
];
const cell = (v: string | number) => {
  const s = String(v);
  return /^[=+\-@]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows: Row[]) => [COLUMNS.map(([h]) => h).join(','), ...rows.map((r) => COLUMNS.map(([, f]) => cell(f(r))).join(','))].join('\n') + '\n';

const names = new Map<string, string>();
/** Rows arrive by transaction; a stable empty array keeps re-renders from wiping the grid. */
const NO_ROWS: Row[] = [];

function toRow(lane: number, e: SimEvent): Row | null {
  if (e.type === 'order') {
    const tr = e.truth;
    const mal = tr.malicious && tr.harm > 0;
    let tone = 'ok';
    if (mal) tone = e.outcome === 'completed' ? 'breach' : e.outcome === 'escrowed' ? 'held' : e.outcome === 'pending' || e.outcome === 'unresolved' ? 'unresolved' : 'stopped';
    else if (e.outcome === 'blocked') tone = 'falsepos';
    else if (e.outcome === 'abandoned') tone = 'friction';
    if (e.duplicateCharge) tone = 'double';
    return {
      key: `${lane}-${e.id}`, lane: LANE_NAMES[lane], t: e.t, kind: 'ORDER', id: e.id, paypal: e.paypal?.captureId ?? e.paypal?.authId ?? e.paypal?.orderId ?? '—',
      rail: e.rail === 'sandbox' ? 'PayPal sandbox' : 'twin', buyer: names.get(e.buyer) ?? e.buyer, store: names.get(e.merchant) ?? e.merchant,
      amount: e.amount, gate: e.escrow && e.decision === 'allow' ? 'hold' : e.decision, outcome: e.duplicateCharge ? 'charged ×2' : e.outcome === 'escrowed' ? 'authorized' : e.outcome === 'completed' ? 'captured' : e.outcome,
      rules: e.hits.map((h) => h.reason).join(' · '), truth: tr.malicious ? (tr.attack ? ATTACK_SHORT[tr.attack] : 'attacker') : 'honest', harm: tr.harm, tone,
    };
  }
  if (e.type === 'refund') {
    const mal = e.truth.malicious;
    return {
      key: `${lane}-${e.id}`, lane: LANE_NAMES[lane], t: e.t, kind: 'REFUND', id: e.id, paypal: '—', rail: e.rail === 'sandbox' ? 'PayPal sandbox' : 'twin', buyer: names.get(e.buyer) ?? e.buyer,
      store: names.get(e.merchant) ?? e.merchant, amount: e.amount, gate: e.pending || e.unresolved ? 'wait' : e.approved ? 'approve' : 'deny', outcome: e.pending ? 'pending' : e.unresolved ? 'unresolved' : e.approved ? 'refunded' : 'denied',
      rules: [e.reason, ...e.hits.map((h) => h.reason)].join(' · '), truth: mal ? 'Refund abuse' : 'honest', harm: e.truth.harm,
      tone: e.pending || e.unresolved ? 'unresolved' : mal ? (e.approved ? 'breach' : 'stopped') : e.approved ? 'ok' : 'falsepos',
    };
  }
  return null;
}

/** Ledger views: each one is an AG Grid external filter over the tone and ground truth of a row. */
const VIEWS = {
  all: { label: 'ALL', test: () => true },
  attacks: { label: 'ATTACKS', test: (r: Row) => r.truth !== 'honest' },
  breach: { label: 'GOT THROUGH', test: (r: Row) => r.tone === 'breach' },
  stopped: { label: 'STOPPED', test: (r: Row) => r.tone === 'stopped' || r.tone === 'held' },
  hurt: { label: 'HONEST HURT', test: (r: Row) => r.tone === 'falsepos' || r.tone === 'double' },
} as const;
type View = keyof typeof VIEWS;

const Badge = (p: ICellRendererParams<Row>) => p.node.rowPinned ? null : <span className={`badge b-${String(p.value).replace(/[^a-z×0-9]/gi, '')}`}>{p.value}</span>;
const Truth = (p: ICellRendererParams<Row>) => p.node.rowPinned ? <span className="tot-truth">{p.value}</span> : <span className={`truth ${p.value === 'honest' ? 'h' : 'a'}`}>{p.value === 'honest' ? '● honest' : `◆ ${p.value}`}</span>;

export function Ledger() {
  const api = useRef<GridApi<Row> | null>(null);
  const rows = useRef<Row[]>([]);
  const everyRow = useRef<Row[]>([]);
  const [counted, setCounted] = useState(0);
  const multi = useStore((s) => s.lanes.length > 1);
  const [view, setView] = useState<View>('all');
  const [q, setQ] = useState('');
  const [total, setTotal] = useState<Row[]>([]);
  const lastTotal = useRef('');
  /** One pinned row that sums whatever the current view and grep leave visible. */
  const sum = useCallback(() => {
    const a = api.current;
    if (!a) return;
    let n = 0, amt = 0, stolen = 0, stopped = 0, hurt = 0;
    a.forEachNodeAfterFilter((node) => {
      const r = node.data;
      if (!r) return;
      n++; amt += r.amount;
      if (r.tone === 'breach') stolen += r.harm;
      else if (r.tone === 'stopped' || r.tone === 'held') stopped += r.amount;
      else if (r.tone === 'falsepos' || r.tone === 'double') hurt += r.amount;
    });
    const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
    const sig = `${n}|${amt.toFixed(2)}|${stolen}|${stopped}|${hurt}`;
    if (sig === lastTotal.current) return;
    lastTotal.current = sig;
    setTotal(n ? [{
      key: 'total', lane: '', t: 0, kind: 'TOTAL' as Row['kind'], id: '', paypal: `${n.toLocaleString('en-US')} rows`, rail: '', buyer: '', store: '',
      amount: amt, gate: '', outcome: '', rules: `stopped ${usd(stopped)} · honest hurt ${usd(hurt)}`,
      truth: `stolen ${usd(stolen)}`, harm: 0, tone: 'total',
    }] : []);
  }, []);
  const exportRun = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([toCsv(everyRow.current)], { type: 'text/csv' }));
    a.download = `sandbox-city-full-run-${everyRow.current.length}-rows.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const viewRef = useRef<View>('all');
  const pick = (v: View) => { viewRef.current = v; setView(v); api.current?.onFilterChanged(); };
  const isExternalFilterPresent = useCallback(() => viewRef.current !== 'all', []);
  const doesExternalFilterPass = useCallback((n: IRowNode<Row>) => !!n.data && VIEWS[viewRef.current].test(n.data), []);
  const cols = useMemo<ColDef<Row>[]>(() => [
    ...(multi ? [{ field: 'lane' as const, headerName: '', width: 44, cellClass: (p: { value: string }) => `lanecell lane-${p.value === 'A' ? 0 : 1}` }] : []),
    { field: 't', headerName: 'TIME', width: 70, valueFormatter: (p) => (p.node?.rowPinned ? 'Σ' : clock(p.value)) },
    { field: 'kind', headerName: 'TYPE', width: 78 },
    { field: 'paypal', headerName: 'PAYPAL ID', width: 170, cellClass: 'mono-dim' },
    { field: 'rail', headerName: 'RAIL', width: 120, cellClass: 'mono-dim', valueFormatter: (p) => (p.node?.rowPinned ? '' : p.value || 'twin') },
    { field: 'buyer', headerName: 'AGENT', width: 110 },
    { field: 'store', headerName: 'STORE', flex: 1, minWidth: 150 },
    { field: 'amount', headerName: 'AMOUNT', width: 96, type: 'rightAligned', valueFormatter: (p) => `$${p.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
    { field: 'gate', headerName: 'GATE', width: 92, cellRenderer: Badge },
    { field: 'outcome', headerName: 'OUTCOME', width: 110, cellRenderer: Badge },
    { field: 'truth', headerName: 'GROUND TRUTH', width: 170, cellRenderer: Truth },
    { field: 'rules', headerName: 'WHY', flex: 1.4, minWidth: 200, cellClass: 'why' },
  ], [multi]);

  useEffect(() => {
    let pending: Row[] = [];
    const seen = new Set<string>();
    const byKey = new Map<string, Row>();
    const offW = bus.on('world', (w) => { for (const m of w.merchants) names.set(m.id, m.name); for (const s of w.shoppers) names.set(s.id, s.name); });
    // a new run reuses order ids (same seed), so drop anything still queued from the old one
    const offR = bus.on('reset', () => { pending = []; seen.clear(); byKey.clear(); rows.current = []; everyRow.current = []; setCounted(0); api.current?.flushAsyncTransactions(); api.current?.setGridOption('rowData', []); });
    const offT = bus.on('tick', (m) => {
      for (const s of m.spawn) names.set(s.id, s.name);
      for (const e of m.events) {
        if (e.type === 'payment') {
          const r = byKey.get(`${m.lane}-${e.order}`);
          if (r) {
            r.outcome = e.state;
            r.tone = e.state === 'pending' || e.state === 'unresolved' ? 'unresolved' : e.state === 'authorized' ? 'held' : r.truth === 'honest' ? 'ok' : e.state === 'captured' ? 'breach' : 'stopped';
            if (seen.has(r.key) && !pending.includes(r)) api.current?.applyTransactionAsync({ update: [r] });
          }
          continue;
        }
        const r = toRow(m.lane, e);
        if (!r) continue;
        const old = byKey.get(r.key);
        if (old) {
          Object.assign(old, r);
          if (seen.has(old.key) && !pending.includes(old)) api.current?.applyTransactionAsync({ update: [old] });
        } else {
          byKey.set(r.key, r); seen.add(r.key); pending.push(r); everyRow.current.push(r);
        }
      }
    });
    const iv = setInterval(() => {
      if (!api.current || !pending.length) return;
      // a fast-forwarded day can queue more rows than the grid keeps: never add and remove the same row in one batch
      const add = pending.reverse().slice(0, CAP);
      pending = [];
      const keep = CAP - add.length;
      const remove = rows.current.length > keep ? rows.current.splice(keep) : [];
      rows.current = [...add, ...rows.current];
      for (const r of remove) seen.delete(r.key);
      api.current.applyTransactionAsync({ add, addIndex: 0, remove });
      setCounted(everyRow.current.length);
    }, 250);
    return () => { offW(); offR(); offT(); clearInterval(iv); };
  }, []);

  return (
    <section className="ledger panel">
      <div className="panel-title">
        <span>LIVE LEDGER</span><em>/ledger/tx</em><small>{counted > CAP ? `showing the latest ${CAP.toLocaleString('en-US')} of ${counted.toLocaleString('en-US')} rows` : `all ${counted.toLocaleString('en-US')} rows of this run`} · the total below covers what is shown</small>
        <div className="ledger-tools">
          {(Object.keys(VIEWS) as View[]).map((v) => <button key={v} className={`lv lv-${v} ${view === v ? 'on' : ''}`} onClick={() => pick(v)}>{VIEWS[v].label}</button>)}
          <button className="lv lv-csv" title="Download every row of this run as CSV, including rows the grid no longer shows" onClick={exportRun}>⇣ FULL RUN CSV</button>
          <label className="lq"><span>grep</span><input value={q} spellCheck={false} placeholder="agent, store, id…" onChange={(e) => setQ(e.target.value)} /></label>
        </div>
      </div>
      <div className="grid-wrap">
        <AgGridReact<Row>
          theme={gridTheme}
          columnDefs={cols}
          rowData={NO_ROWS}
          getRowId={(p) => p.data.key}
          getRowClass={(p) => `tone-${p.data?.tone}`}
          onGridReady={(e) => (api.current = e.api)}
          animateRows={false}
          suppressCellFocus
          quickFilterText={q}
          pinnedBottomRowData={total}
          onModelUpdated={sum}
          isExternalFilterPresent={isExternalFilterPresent}
          doesExternalFilterPass={doesExternalFilterPass}
          defaultColDef={{ sortable: true, resizable: true, filter: true }}
        />
      </div>
    </section>
  );
}
