import { useMemo } from 'react';
import { ATTACK_KINDS, describeGenome, type AttackKind, type ForgeScore, type Policy } from '@sandbox-city/core';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { gridTheme } from './Ledger';
import { emptyForge, useStore } from '../store';
import { client } from '../sim/client';
import { startTune } from './AutoTune';
import { ATTACK_CODE, ATTACK_SHORT, money } from './meta';
import { useModal } from './useModal';

/** Red team: evolve attacker tactics against a rulebook (lane B's if forked, else lane A's). */
export function startForge(target?: Policy, size?: { generations: number; children: number }) {
  const st = useStore.getState();
  const policy = target ?? st.policies[st.policies.length - 1];
  useStore.setState({ forge: { ...emptyForge(), open: true, running: true, target: policy } });
  client.send({ cmd: 'forge', policy, ...size });
}

const W = 560, H = 300, PADL = 64, PADR = 16, PADT = 16, PADB = 36;

function Curve() {
  const { curve, baseline, total } = useStore((s) => s.forge);
  if (!curve.length || !baseline) return <div className="tune-plot empty">sharpening the first attacks…</div>;
  const ys = [...curve.map((c) => Math.max(c.best, c.candidate)), baseline.stolen];
  const lo = 0, hi = Math.max(...ys) * 1.12;
  const n = Math.max(total, curve.length);
  const x = (e: number) => PADL + ((e - 1) / Math.max(1, n - 1)) * (W - PADL - PADR);
  const y = (v: number) => PADT + (1 - (v - lo) / (hi - lo)) * (H - PADT - PADB);
  const line = curve.map((c) => `${x(c.evals)},${y(c.best)}`).join(' ');
  const area = `${x(curve[0].evals)},${y(0)} ${line} ${x(curve[curve.length - 1].evals)},${y(0)}`;
  const yt = [0.25, 0.5, 0.75, 1].map((k) => hi * k / 1.12);
  const last = curve[curve.length - 1];
  return (
    <svg className="tune-plot forge-plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Money stolen per day by the best attackers found so far">
      {yt.map((v) => <g key={v}><line x1={PADL} x2={W - PADR} y1={y(v)} y2={y(v)} className="grid" /><text x={PADL - 8} y={y(v) + 4} className="ax" textAnchor="end">{money(v / 1000, 1)}k</text></g>)}
      <text x={(PADL + W - PADR) / 2} y={H - 8} className="ax-title" textAnchor="middle">ATTACK VARIANTS TRIED →</text>
      <text x={14} y={(PADT + H - PADB) / 2} className="ax-title" textAnchor="middle" transform={`rotate(-90 14 ${(PADT + H - PADB) / 2})`}>STOLEN / DAY →</text>
      <line x1={PADL} x2={W - PADR} y1={y(baseline.stolen)} y2={y(baseline.stolen)} className="base-line" />
      <text x={W - PADR - 4} y={y(baseline.stolen) + 14} className="base-label" textAnchor="end">stock attackers {money(baseline.stolen)}</text>
      {curve.map((c) => <circle key={c.evals} cx={x(c.evals)} cy={y(c.candidate)} r={2.6} className="cand" />)}
      <polygon points={area} className="area" />
      <polyline points={line} className="best-line" />
      <circle cx={x(last.evals)} cy={y(last.best)} r={9} className="halo" />
      <circle cx={x(last.evals)} cy={y(last.best)} r={4} className="head" />
    </svg>
  );
}

interface KRow { kind: AttackKind; code: string; family: string; was: number; now: number; gain: number; tactics: string }

const Gain = ({ data }: ICellRendererParams<KRow>) => {
  if (!data) return null;
  const up = data.now > data.was + 1;
  return <span className={`fg-gain ${up ? 'up' : ''}`}>{up ? `+${money(data.now - data.was)}` : '—'}{up && data.was > 0 && <small>×{(data.now / data.was).toFixed(1)}</small>}</span>;
};

/** One row per attack family: what the stock crews stole, what the forged crews steal, and the tactics that did it. */
function ForgeGrid({ best, base }: { best: ForgeScore; base: ForgeScore }) {
  const rows = useMemo<KRow[]>(() => ATTACK_KINDS.filter((k) => base.byKind[k] || best.byKind[k]).map((k) => {
    const tactics = describeGenome(k, best.genomes[k] ?? {});
    return { kind: k, code: ATTACK_CODE[k], family: ATTACK_SHORT[k], was: base.byKind[k], now: best.byKind[k], gain: best.byKind[k] - base.byKind[k], tactics: tactics.length ? tactics.join(' · ') : 'no better tactic found' };
  }), [best, base]);
  const cols = useMemo<ColDef<KRow>[]>(() => [
    { field: 'code', headerName: 'SIG', width: 70, cellClass: 'fg-code' },
    { field: 'family', headerName: 'ATTACK', width: 150 },
    { field: 'was', headerName: 'STOCK / DAY', width: 116, type: 'rightAligned', valueFormatter: (p) => money(p.value), cellClass: 'ag-right-aligned-cell fg-dim' },
    { field: 'now', headerName: 'FORGED / DAY', width: 122, type: 'rightAligned', valueFormatter: (p) => money(p.value), cellClass: 'ag-right-aligned-cell fg-now', enableCellChangeFlash: true },
    { field: 'gain', headerName: 'GAIN', width: 130, type: 'rightAligned', sort: 'desc', cellRenderer: Gain },
    { field: 'tactics', headerName: 'WHAT THEY LEARNED', flex: 1, minWidth: 240, wrapText: true, autoHeight: true, cellClass: (p) => `fg-tactics ${p.data && p.data.gain <= 1 ? 'fg-dim' : ''}` },
  ], []);
  return (
    <div className="forge-grid">
      <AgGridReact<KRow>
        theme={gridTheme}
        rowData={rows}
        columnDefs={cols}
        getRowId={(p) => p.data.kind}
        rowClassRules={{ 'fg-up': (p) => !!p.data && p.data.gain > 1 }}
        domLayout="autoHeight"
        animateRows
        suppressCellFocus
        suppressMovableColumns
        headerHeight={26}
        defaultColDef={{ sortable: true, resizable: false }}
      />
    </div>
  );
}

export function Forge() {
  const f = useStore((s) => s.forge);
  const policies = useStore((s) => s.policies);
  const close = () => { if (f.running) client.send({ cmd: 'forge_stop' }); useStore.setState({ forge: { ...f, open: false, running: false } }); };
  const panel = useModal<HTMLDivElement>(f.open, close);
  if (!f.open) return null;
  const b = f.best, base = f.baseline;
  const progress = f.total ? f.evals / f.total : 0;
  const name = f.target?.name ?? 'your rulebook';
  // forged attackers become the city's attackers: every later run, tune and what-if uses them
  const unleash = (then?: 'tune') => {
    if (!b) return;
    useStore.setState({ genomes: b.genomes, forge: { ...f, open: false } });
    client.start(policies);
    if (then === 'tune') setTimeout(() => startTune('safe'), 200);
    else setTimeout(() => client.send({ cmd: 'play' }), 300);
  };
  return (
    <div className="report-wrap" onClick={close}>
      <div className="tune forge panel" ref={panel} tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Attack forge">
        <div className="report-head">
          <span className="glyph">./forge</span>
          <div>
            <h2>ATTACK FORGE</h2>
            <p>Attackers evolve against <b>{name}</b> on two other days. Each wave comes as often as before; only tactics change. Every generation keeps the variant of each attack that got the most money past the gate.</p>
          </div>
        </div>
        <div className="tune-body">
          <Curve />
          <div className="tune-side">
            <div className="tune-status">
              <b>{f.running ? 'FORGING' : f.ms !== null ? 'FORGE COMPLETE' : 'STOPPED'}</b>
              <span>{f.evals} / {f.total || '…'} attack variants · {f.ms !== null ? `${(f.ms / 1000).toFixed(0)}s` : 'each one plays two full days'}</span>
              <div className="progress red"><i style={{ width: `${progress * 100}%` }} /></div>
            </div>
            {b && base && (
              <div className="forge-big">
                <div><span>stock attackers</span><b>{money(base.stolen)}</b></div>
                <div className="arrow">→</div>
                <div><span>forged attackers</span><b className="rd">{money(b.stolen)}</b></div>
                <em>{base.stolen > 0 ? `×${(b.stolen / base.stolen).toFixed(1)} stolen per day` : ''}</em>
              </div>
            )}
          </div>
        </div>
        {b && base && <ForgeGrid best={b} base={base} />}
        <div className="tune-foot">
          {f.running
            ? <button className="btn" onClick={() => { client.send({ cmd: 'forge_stop' }); useStore.setState({ forge: { ...f, running: false } }); }}>■ STOP</button>
            : <button className="btn" onClick={() => startForge(f.target ?? undefined)}>↺ FORGE AGAIN</button>}
          {b && !f.running && <button className="btn apply hot" onClick={() => unleash()}>☠ UNLEASH ON THE CITY</button>}
          {b && !f.running && <button className="btn tune-btn" onClick={() => unleash('tune')}>✦ RE-TUNE AGAINST THEM</button>}
          <button className="btn" onClick={close}>CLOSE</button>
        </div>
      </div>
    </div>
  );
}
