import { ATTACK_KINDS, describeGenome, type Policy } from '@sandbox-city/core';
import { emptyForge, useStore } from '../store';
import { client } from '../sim/client';
import { startTune } from './AutoTune';
import { ATTACK_CODE, ATTACK_SHORT, money } from './meta';

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

export function Forge() {
  const f = useStore((s) => s.forge);
  const policies = useStore((s) => s.policies);
  if (!f.open) return null;
  const close = () => { if (f.running) client.send({ cmd: 'forge_stop' }); useStore.setState({ forge: { ...f, open: false, running: false } }); };
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
      <div className="tune forge panel" onClick={(e) => e.stopPropagation()}>
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
        {b && base && (
          <div className="forge-kinds">
            {ATTACK_KINDS.map((k) => {
              const was = base.byKind[k], now = b.byKind[k];
              const tactics = describeGenome(k, b.genomes[k] ?? {});
              return (
                <div key={k} className={`fk ${now > was + 1 ? 'up' : ''}`}>
                  <span className="glyph">{ATTACK_CODE[k]}</span>
                  <div className="fk-main">
                    <div className="fk-head"><b>{ATTACK_SHORT[k]}</b><span>{money(was)} → <em>{money(now)}</em></span></div>
                    <ul>{tactics.length ? tactics.map((t) => <li key={t}>{t}</li>) : <li className="dim">no better tactic found</li>}</ul>
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
