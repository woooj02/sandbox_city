import { useMemo } from 'react';
import type { DaySummary } from '@sandbox-city/core';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { useStore } from '../store';
import { LANE_NAMES, money } from './meta';
import { gridTheme } from './Ledger';

interface WRow extends DaySummary { mine: boolean; label: string; best: boolean; delta: number | null }

/** A value with a bar behind it, scaled to the largest value in its column. */
function Bar({ value, data, colDef, tone, max }: ICellRendererParams<WRow, number> & { tone: string; max: number }) {
  return (
    <div className={`wi-bar ${tone}`}>
      <i style={{ width: `${Math.max(0, Math.min(1, (value ?? 0) / (max || 1))) * 100}%` }} />
      <span>{money(value ?? 0)}</span>
      {data?.best && colDef!.field === 'net' && <b className="crown">BEST</b>}
    </div>
  );
}

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;

function verdict(me: DaySummary, alts: DaySummary[]): string {
  if (!alts.length) return '';
  const best = [...alts].sort((a, b) => b.net - a.net)[0];
  const safest = [...alts].sort((a, b) => a.stolen - b.stolen)[0];
  const lost = (x: DaySummary) => x.stolen + x.duplicate;
  if (best.net > me.net) {
    return `Switching to ${best.name} would have kept ${money(best.net - me.net)} more value: ${money(Math.max(0, lost(me) - lost(best)))} less lost to fraud and double charges, ${best.honestLost > me.honestLost ? `at the cost of ${money(best.honestLost - me.honestLost)} more honest sales turned away` : `and ${money(me.honestLost - best.honestLost)} fewer honest sales turned away`}.`;
  }
  if (safest.stolen < me.stolen) {
    return `No preset beats your rules on net value. ${safest.name} would have stopped ${money(me.stolen - safest.stolen)} more fraud, but turned away ${money(Math.max(0, safest.honestLost - me.honestLost))} more honest sales.`;
  }
  return 'Your rules beat every preset on this day, on both fraud stopped and net value.';
}

function WhatIfGrid({ rows, ctx, vs }: { rows: WRow[]; ctx: Record<string, number>; vs: string }) {
  const cols = useMemo<ColDef<WRow>[]>(() => [
    { field: 'label', headerName: 'RULEBOOK', flex: 1.3, minWidth: 170, cellClass: (p) => `wi-name ${p.data?.mine ? 'mine' : ''}` },
    { field: 'stolen', headerName: 'STOLEN', flex: 1, cellRenderer: Bar, cellRendererParams: { tone: 'bad', max: ctx.stolen } },
    { field: 'duplicate', headerName: 'DOUBLE CHARGES', flex: 1, cellRenderer: Bar, cellRendererParams: { tone: 'warn', max: ctx.duplicate } },
    { field: 'honestLost', headerName: 'HONEST SALES LOST', flex: 1, cellRenderer: Bar, cellRendererParams: { tone: 'warn', max: ctx.honestLost } },
    { field: 'net', headerName: 'NET VALUE', flex: 1.2, sort: 'desc', cellRenderer: Bar, cellRendererParams: { tone: 'gold', max: ctx.net } },
    { field: 'delta', headerName: vs, width: 120, type: 'rightAligned', valueFormatter: (p) => (p.value == null ? '—' : signed(p.value)), cellClass: (p) => (p.value == null ? 'dim' : p.value >= 0 ? 'good' : 'bad') },
  ], [vs, ctx]);
  return (
    <div className="whatif-grid">
      <AgGridReact<WRow>
        theme={gridTheme}
        rowData={rows.filter((r) => !r.mine)}
        pinnedTopRowData={rows.filter((r) => r.mine)}
        columnDefs={cols}
        getRowId={(p) => p.data.key}
        getRowClass={(p) => `${p.data?.mine ? 'wi-mine' : ''} ${p.data?.best ? 'wi-best' : ''}`}
        domLayout="autoHeight"
        animateRows
        suppressCellFocus
        suppressMovableColumns
        defaultColDef={{ sortable: true, resizable: false }}
      />
    </div>
  );
}

/** Same city, same attackers, same day — only the rulebook changes. */
export function WhatIf() {
  const w = useStore((s) => s.whatif);
  const live = useStore((s) => s.paypal === 'sandbox');
  if (!w) return null;
  if (w === 'pending') return <div className="whatif"><div className="whatif-head"><b>WHAT IF</b><em>/replay</em><span>replaying this exact day under every other rulebook…</span></div><div className="whatif-loading"><i /></div></div>;
  const me = w.mine[0];
  const rows = [...w.mine.map((m, i) => ({ ...m, mine: true, label: w.mine.length > 1 ? `${LANE_NAMES[i]} · ${m.name}` : `${m.name} (yours)` })), ...[...w.alternatives].sort((a, b) => b.net - a.net).map((a) => ({ ...a, mine: false, label: a.name }))];
  const bestNet = Math.max(...rows.map((r) => r.net));
  const data: WRow[] = rows.map((r) => ({ ...r, best: r.net === bestNet, delta: r.key === me.key ? null : r.net - me.net }));
  const ctx = { stolen: Math.max(...data.map((r) => r.stolen)), duplicate: Math.max(...data.map((r) => r.duplicate)), honestLost: Math.max(...data.map((r) => r.honestLost)), net: Math.max(...data.map((r) => r.net)) };
  return (
    <div className="whatif">
      <div className="whatif-head"><b>WHAT IF</b><em>/replay</em><span>same city, same shoppers, same attackers — only the rules change{live ? ' · replayed on the PayPal twin' : ''}</span></div>
      <WhatIfGrid rows={data} ctx={ctx} vs={w.mine.length > 1 ? 'VS LANE A' : 'VS YOURS'} />
      <p className="whatif-verdict">{verdict(me, w.alternatives)}</p>
    </div>
  );
}
