import { useEffect, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeQuartz, colorSchemeDark, ColDef, GridApi, ICellRendererParams } from 'ag-grid-community';
import { SimEvent } from '@sandbox-city/core';
import { ATTACK_SHORT } from './meta';
import { bus } from '../sim/bus';
import { useStore } from '../store';
import { clock, LANE_NAMES } from './meta';

ModuleRegistry.registerModules([AllCommunityModule]);

export const gridTheme = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: 'rgba(6,8,22,0.0)', foregroundColor: '#cfd8ff', headerBackgroundColor: 'rgba(20,24,60,0.85)', headerTextColor: '#8fa2ff',
  borderColor: 'rgba(110,130,255,0.14)', rowHoverColor: 'rgba(76,242,255,0.08)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5,
  headerFontFamily: 'Chakra Petch, sans-serif', headerFontSize: 11, headerFontWeight: 700, rowHeight: 26, headerHeight: 30, spacing: 5,
  oddRowBackgroundColor: 'rgba(255,255,255,0.015)', accentColor: '#4cf2ff', wrapperBorder: false,
});

interface Row {
  key: string; lane: string; t: number; kind: 'ORDER' | 'REFUND'; id: string; paypal: string; rail: string; buyer: string; store: string;
  amount: number; gate: string; outcome: string; rules: string; truth: string; harm: number; tone: string;
}

const names = new Map<string, string>();

function toRow(lane: number, e: SimEvent): Row | null {
  if (e.type === 'order') {
    const tr = e.truth;
    const mal = tr.malicious && tr.harm > 0;
    let tone = 'ok';
    if (mal) tone = e.outcome === 'completed' ? 'breach' : e.outcome === 'escrowed' ? 'held' : 'stopped';
    else if (e.outcome === 'blocked') tone = 'falsepos';
    else if (e.outcome === 'abandoned') tone = 'friction';
    if (e.duplicateCharge) tone = 'double';
    return {
      key: `${lane}-${e.id}`, lane: LANE_NAMES[lane], t: e.t, kind: 'ORDER', id: e.id, paypal: e.paypal?.captureId ?? e.paypal?.authId ?? e.paypal?.orderId ?? '—',
      rail: e.rail === 'sandbox' ? 'PayPal sandbox' : 'twin', buyer: names.get(e.buyer) ?? e.buyer, store: names.get(e.merchant) ?? e.merchant,
      amount: e.amount, gate: e.escrow && e.decision === 'allow' ? 'escrow' : e.decision, outcome: e.duplicateCharge ? 'charged ×2' : e.outcome,
      rules: e.hits.map((h) => h.reason).join(' · '), truth: tr.malicious ? (tr.attack ? ATTACK_SHORT[tr.attack] : 'attacker') : 'honest', harm: tr.harm, tone,
    };
  }
  if (e.type === 'refund') {
    const mal = e.truth.malicious;
    return {
      key: `${lane}-${e.id}-${e.t}`, lane: LANE_NAMES[lane], t: e.t, kind: 'REFUND', id: e.id, paypal: '—', rail: '', buyer: names.get(e.buyer) ?? e.buyer,
      store: names.get(e.merchant) ?? e.merchant, amount: e.amount, gate: e.approved ? 'approve' : 'deny', outcome: e.approved ? 'refunded' : 'denied',
      rules: [e.reason, ...e.hits.map((h) => h.reason)].join(' · '), truth: mal ? 'Refund abuse' : 'honest', harm: e.truth.harm,
      tone: mal ? (e.approved ? 'breach' : 'stopped') : e.approved ? 'ok' : 'falsepos',
    };
  }
  return null;
}

const Badge = (p: ICellRendererParams<Row>) => <span className={`badge b-${String(p.value).replace(/[^a-z×0-9]/gi, '')}`}>{p.value}</span>;
const Truth = (p: ICellRendererParams<Row>) => <span className={`truth ${p.value === 'honest' ? 'h' : 'a'}`}>{p.value === 'honest' ? '● honest' : `◆ ${p.value}`}</span>;

export function Ledger() {
  const api = useRef<GridApi<Row> | null>(null);
  const rows = useRef<Row[]>([]);
  const multi = useStore((s) => s.lanes.length > 1);
  const cols = useMemo<ColDef<Row>[]>(() => [
    ...(multi ? [{ field: 'lane' as const, headerName: '', width: 44, cellClass: (p: { value: string }) => `lanecell lane-${p.value === 'A' ? 0 : 1}` }] : []),
    { field: 't', headerName: 'TIME', width: 70, valueFormatter: (p) => clock(p.value) },
    { field: 'kind', headerName: 'TYPE', width: 78 },
    { field: 'paypal', headerName: 'PAYPAL ID', width: 170, cellClass: 'mono-dim' },
    { field: 'buyer', headerName: 'AGENT', width: 110 },
    { field: 'store', headerName: 'STORE', flex: 1, minWidth: 150 },
    { field: 'amount', headerName: 'AMOUNT', width: 96, type: 'rightAligned', valueFormatter: (p) => `$${p.value.toFixed(2)}` },
    { field: 'gate', headerName: 'GATE', width: 92, cellRenderer: Badge },
    { field: 'outcome', headerName: 'OUTCOME', width: 110, cellRenderer: Badge },
    { field: 'truth', headerName: 'GROUND TRUTH', width: 170, cellRenderer: Truth },
    { field: 'rules', headerName: 'WHY', flex: 1.4, minWidth: 200, cellClass: 'why' },
  ], [multi]);

  useEffect(() => {
    const CAP = 2500;
    let pending: Row[] = [];
    const seen = new Set<string>();
    const offW = bus.on('world', (w) => { for (const m of w.merchants) names.set(m.id, m.name); for (const s of w.shoppers) names.set(s.id, s.name); });
    // a new run reuses order ids (same seed), so drop anything still queued from the old one
    const offR = bus.on('reset', () => { pending = []; seen.clear(); rows.current = []; api.current?.flushAsyncTransactions(); api.current?.setGridOption('rowData', []); });
    const offT = bus.on('tick', (m) => {
      for (const s of m.spawn) names.set(s.id, s.name);
      for (const e of m.events) { const r = toRow(m.lane, e); if (r && !seen.has(r.key)) { seen.add(r.key); pending.push(r); } }
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
    }, 250);
    return () => { offW(); offR(); offT(); clearInterval(iv); };
  }, []);

  return (
    <section className="ledger panel">
      <div className="panel-title"><span>LIVE LEDGER</span><em>/ledger/tx</em><small>every order and refund on the PayPal rails · what the gate decided · what was really going on</small></div>
      <div className="grid-wrap">
        <AgGridReact<Row>
          theme={gridTheme}
          columnDefs={cols}
          rowData={[]}
          getRowId={(p) => p.data.key}
          getRowClass={(p) => `tone-${p.data?.tone}`}
          onGridReady={(e) => (api.current = e.api)}
          animateRows={false}
          suppressCellFocus
          defaultColDef={{ sortable: true, resizable: true, filter: true }}
        />
      </div>
    </section>
  );
}
