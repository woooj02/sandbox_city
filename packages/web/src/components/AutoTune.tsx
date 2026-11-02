import { useMemo } from 'react';
import { describePolicy, type Policy, type TunePoint } from '@sandbox-city/core';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef } from 'ag-grid-community';
import { gridTheme } from './Ledger';
import { emptyTune, useStore } from '../store';
import { client } from '../sim/client';
import { money, pct } from './meta';

const MODES = {
  safe: { label: 'SAFE', sub: 'most value with ≥ 85% of fraud stopped', minSafety: 0.85, minAccess: 0.8 },
  value: { label: 'MAX VALUE', sub: 'most value for honest people, any fraud rate', minSafety: 0, minAccess: 0.85 },
} as const;

export function startTune(mode: keyof typeof MODES, size?: { generations?: number; children?: number; trainDays?: number; minSafety?: number }) {
  const m = MODES[mode];
  const minSafety = size?.minSafety ?? m.minSafety;
  useStore.setState({ tune: { ...emptyTune(mode), open: true, running: true, floor: minSafety, trainDays: size?.trainDays ?? 2 } });
  client.send({ cmd: 'tune', minAccess: m.minAccess, generations: size?.generations, children: size?.children, trainDays: size?.trainDays, minSafety });
}

const W = 560, H = 330, PADL = 64, PADR = 16, PADT = 16, PADB = 40;

function Scatter() {
  const { points, best, mode, floor: used } = useStore((s) => s.tune);
  if (!points.length) return <div className="tune-plot empty">warming up the first rulebooks…</div>;
  const nets = points.map((p) => p.net);
  const lo = Math.min(...nets), hi = Math.max(...nets);
  const pad = (hi - lo) * 0.08 || 1000;
  const y0 = lo - pad, y1 = hi + pad;
  const x = (s: number) => PADL + s * (W - PADL - PADR);
  const y = (n: number) => PADT + (1 - (n - y0) / (y1 - y0)) * (H - PADT - PADB);
  const floor = used ?? MODES[mode].minSafety;
  const bestNet = best?.mean.net, bestSafety = best?.mean.safety;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const yt = Array.from({ length: 4 }, (_, i) => y0 + ((i + 0.5) / 4) * (y1 - y0));
  const maxGen = Math.max(1, ...points.map((p) => p.generation));
  return (
    <svg className="tune-plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Every rulebook tried: fraud stopped vs net value per day">
      {ticks.map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={PADT} y2={H - PADB} className="grid" /><text x={x(t)} y={H - PADB + 16} className="ax" textAnchor="middle">{Math.round(t * 100)}%</text></g>)}
      {yt.map((v) => <g key={v}><line x1={PADL} x2={W - PADR} y1={y(v)} y2={y(v)} className="grid" /><text x={PADL - 8} y={y(v) + 4} className="ax" textAnchor="end">{money(v / 1000)}k</text></g>)}
      <text x={(PADL + W - PADR) / 2} y={H - 6} className="ax-title" textAnchor="middle">FRAUD $ STOPPED →</text>
      <text x={14} y={(PADT + H - PADB) / 2} className="ax-title" textAnchor="middle" transform={`rotate(-90 14 ${(PADT + H - PADB) / 2})`}>NET VALUE / DAY →</text>
      {floor > 0 && <g><rect x={PADL} y={PADT} width={x(floor) - PADL} height={H - PADT - PADB} className="floor" /><line x1={x(floor)} x2={x(floor)} y1={PADT} y2={H - PADB} className="floor-line" /><text x={x(floor) - 6} y={PADT + 14} className="floor-label" textAnchor="end">below the safety floor</text></g>}
      {points.filter((p) => !p.preset).map((p) => (
        <circle key={p.id} cx={x(p.safety)} cy={y(p.net)} r={3.2} className="pt" style={{ opacity: 0.25 + 0.75 * (p.generation / maxGen) }} />
      ))}
      {points.filter((p) => p.preset).map((p) => (
        <g key={p.id} className="preset"><rect x={x(p.safety) - 4} y={y(p.net) - 4} width={8} height={8} transform={`rotate(45 ${x(p.safety)} ${y(p.net)})`} /><text x={p.safety > 0.8 ? x(p.safety) - 8 : x(p.safety) + 8} y={y(p.net) - 7} textAnchor={p.safety > 0.8 ? 'end' : 'start'}>{p.preset}</text></g>
      ))}
      {bestNet !== undefined && bestSafety !== undefined && (
        <g className="best"><circle cx={x(bestSafety)} cy={y(bestNet)} r={11} className="halo" /><circle cx={x(bestSafety)} cy={y(bestNet)} r={5} /></g>
      )}
    </svg>
  );
}

interface LRow extends TunePoint { rank: number; label: string; fresh: boolean; passes: boolean }

const RULES = { 'lb-top': (p: { data?: LRow }) => p.data?.rank === 1, 'lb-fresh': (p: { data?: LRow }) => !!p.data?.fresh };

/** The search's live top six: rows re-rank in place as each generation lands. */
function Leaderboard() {
  const { points, generation, mode, floor: used } = useStore((s) => s.tune);
  const floor = used ?? MODES[mode].minSafety;
  const rows = useMemo<LRow[]>(() => {
    const ok = (p: TunePoint) => p.safety >= floor;
    return [...points]
      .sort((a, b) => Number(ok(b)) - Number(ok(a)) || b.score - a.score)
      .slice(0, 6)
      .map((p, i) => ({ ...p, rank: i + 1, label: p.preset ?? `gen ${p.generation} · #${String(p.id).padStart(3, '0')}`, fresh: !p.preset && p.generation === generation, passes: ok(p) }));
  }, [points, generation, floor]);
  const cols = useMemo<ColDef<LRow>[]>(() => [
    { field: 'rank', headerName: '#', width: 52, valueFormatter: (p) => String(p.value).padStart(2, '0'), cellClass: 'lb-rank' },
    { field: 'label', headerName: 'RULEBOOK', flex: 1.4, minWidth: 160, cellClass: (p) => (p.data?.preset ? 'lb-preset' : 'lb-name') },
    { field: 'safety', headerName: 'FRAUD STOPPED', flex: 1, type: 'rightAligned', valueFormatter: (p) => pct(p.value), cellClass: (p) => `ag-right-aligned-cell ${p.data?.passes ? 'cy' : 'lb-fail'}` },
    { field: 'access', headerName: 'HONEST THROUGH', flex: 1, type: 'rightAligned', valueFormatter: (p) => pct(p.value), cellClass: 'ag-right-aligned-cell gr' },
    { field: 'net', headerName: 'NET VALUE / DAY', flex: 1.1, type: 'rightAligned', valueFormatter: (p) => money(p.value), cellClass: 'ag-right-aligned-cell gold' },
  ], []);
  if (!rows.length) return null;
  return (
    <div className="tune-board">
      <div className="tb-head"><b>LEADERBOARD</b><em>/tune/top</em><span>ranked by the search's own score, rulebooks under the {Math.round(floor * 100)}% safety floor sink</span></div>
      <AgGridReact<LRow>
        theme={gridTheme}
        rowData={rows}
        columnDefs={cols}
        getRowId={(p) => String(p.data.id)}
        rowClassRules={RULES}
        domLayout="autoHeight"
        animateRows
        suppressCellFocus
        suppressMovableColumns
        rowHeight={24}
        headerHeight={26}
        defaultColDef={{ sortable: false, resizable: false }}
      />
    </div>
  );
}

export function AutoTune() {
  const tune = useStore((s) => s.tune);
  const policies = useStore((s) => s.policies);
  const forged = useStore((s) => s.genomes !== null);
  if (!tune.open) return null;
  const close = () => { if (tune.running) client.send({ cmd: 'tune_stop' }); useStore.setState({ tune: { ...tune, open: false, running: false } }); };
  const replay = (lanes: Policy[]) => { useStore.setState({ tune: { ...tune, open: false } }); client.start(lanes); setTimeout(() => client.send({ cmd: 'play' }), 300); };
  const b = tune.best;
  const progress = tune.total ? tune.evals / tune.total : 0;
  const isPreset = b && !b.policy.name.startsWith('Tuned');
  return (
    <div className="report-wrap" onClick={close}>
      <div className="tune panel" onClick={(e) => e.stopPropagation()}>
        <div className="report-head">
          <span className="glyph">./tune</span>
          <div>
            <h2>AUTO-TUNE</h2>
            <p>Evolving rulebooks on {['', 'one other day', 'two other days', 'three other days', 'four other days', 'five other days'][tune.trainDays ?? 2]}{forged ? ', against the forged attackers' : ''}. The day on screen stays unseen, so the replay is a fair test.</p>
          </div>
        </div>
        <div className="tune-modes">
          {(Object.keys(MODES) as (keyof typeof MODES)[]).map((k) => (
            <button key={k} className={`chip ${tune.mode === k ? 'on' : ''}`} disabled={tune.running} onClick={() => startTune(k)}>{MODES[k].label}<small>{MODES[k].sub}</small></button>
          ))}
        </div>
        <div className="tune-body">
          <Scatter />
          <div className="tune-side">
            <div className="tune-status">
              <b>{tune.running ? `GENERATION ${tune.generation}` : tune.ms !== null ? 'SEARCH COMPLETE' : 'STOPPED'}</b>
              <span>{tune.evals} / {tune.total || '…'} rulebooks · {tune.ms !== null ? `${(tune.ms / 1000).toFixed(0)}s` : `each one plays ${tune.trainDays ?? 2} full days`}</span>
              <div className="progress"><i style={{ width: `${progress * 100}%` }} /></div>
            </div>
            {b && (
              <>
                <div className="tune-best">
                  <div><b className="gold">{money(b.mean.net)}</b><span>net value / day</span></div>
                  <div><b className="cy">{pct(b.mean.safety)}</b><span>fraud stopped</span></div>
                  <div><b className="gr">{pct(b.mean.access)}</b><span>honest get through</span></div>
                </div>
                <div className="tune-rules">
                  <h4>{isPreset ? `BEST SO FAR: ${b.policy.name.toUpperCase()}` : 'BEST RULEBOOK SO FAR'}</h4>
                  <ul>{describePolicy(b.policy).map((r) => <li key={r}>{r}</li>)}</ul>
                </div>
              </>
            )}
          </div>
        </div>
        <Leaderboard />
        <div className="tune-foot">
          {tune.running
            ? <button className="btn" onClick={() => { client.send({ cmd: 'tune_stop' }); useStore.setState({ tune: { ...tune, running: false } }); }}>■ STOP</button>
            : <button className="btn" onClick={() => startTune(tune.mode)}>↺ SEARCH AGAIN</button>}
          {b && !tune.running && <button className="btn apply hot" onClick={() => replay([policies[0], b.policy])}>⑂ RACE IT AGAINST {policies[0].name.toUpperCase()}</button>}
          {b && !tune.running && <button className="btn" onClick={() => replay([b.policy])}>APPLY & REPLAY</button>}
          <button className="btn" onClick={close}>CLOSE</button>
        </div>
      </div>
    </div>
  );
}
