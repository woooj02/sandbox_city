import { ATTACK_KINDS, DEFAULT_CONFIG, Metrics } from '@sandbox-city/core';

/** Families the default day runs. The others appear on the board only when a world has them. */
const STOCK_ATTACKERS = DEFAULT_CONFIG.attackers;
import { useStore } from '../store';
import { ATTACK_CODE, ATTACK_SHORT, LANE_NAMES, money, pct } from './meta';

function Gauge({ value, label, sub, color, code }: { value: number; label: string; sub: string; color: string; code: string }) {
  const r = 46, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, value));
  return (
    <div className="gauge" style={{ ['--c' as string]: color }}>
      <svg viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} className="g-track" />
        <circle cx="60" cy="60" r={r} className="g-ticks" strokeDasharray="1 5.3" />
        <circle cx="60" cy="60" r={r} className="g-val" strokeDasharray={`${c * v} ${c}`} transform="rotate(-90 60 60)" />
      </svg>
      <div className="g-center">
        <div className="g-num">{(v * 100).toFixed(1)}<small>%</small></div>
        <div className="g-code">{code}</div>
      </div>
      <div className="g-label">{label}</div>
      <div className="g-sub">{sub}</div>
    </div>
  );
}

function Spark({ data, k, color }: { data: { safety: number; access: number }[]; k: 'safety' | 'access'; color: string }) {
  if (data.length < 2) return <svg className="spark" />;
  const pts = data.map((d, i) => `${(i / (data.length - 1)) * 100},${30 - d[k] * 28}`).join(' ');
  return <svg className="spark" viewBox="0 0 100 32" preserveAspectRatio="none"><polyline points={pts} fill="none" stroke={color} strokeWidth="1.4" vectorEffect="non-scaling-stroke" /></svg>;
}

function AttackBoard({ m }: { m: Metrics }) {
  const max = Math.max(1, ...ATTACK_KINDS.map((k) => m.fraud.byKind[k].attempted));
  return (
    <div className="board">
      {ATTACK_KINDS.filter((k) => k in STOCK_ATTACKERS || m.fraud.byKind[k].attempted > 0).map((k) => {
        const t = m.fraud.byKind[k];
        const leakedW = (Math.max(0, t.leaked) / max) * 100, prevW = (t.prevented / max) * 100;
        return (
          <div className="board-row" key={k}>
            <span className="glyph">{ATTACK_CODE[k]}</span>
            <span className="bname">{ATTACK_SHORT[k]}</span>
            <span className="bar"><i className="prev" style={{ width: `${prevW}%` }} /><i className="leak" style={{ width: `${leakedW}%` }} /></span>
            <span className={`bval ${t.leaked > 0.5 ? 'bad' : ''}`}>{t.attempted ? money(Math.max(0, t.leaked)) : '—'}</span>
          </div>
        );
      })}
      <div className="board-legend"><span><i className="prev" />stopped</span><span><i className="leak" />got through</span></div>
    </div>
  );
}

function LaneHud({ lane }: { lane: number }) {
  const L = useStore((s) => s.lanes[lane]);
  const policy = useStore((s) => s.policies[lane]);
  const multi = useStore((s) => s.lanes.length > 1);
  const m = L?.metrics;
  if (!m) return <div className="hud-lane"><div className="hud-wait">booting city…</div></div>;
  return (
    <div className="hud-lane">
      {multi && <div className={`hud-lane-title lane-${lane}`}><b>{LANE_NAMES[lane]}</b> {policy?.name}</div>}
      <div className="gauges">
        <Gauge value={m.safety} label="FRAUD STOPPED" sub={`${money(m.fraud.prevented)} of ${money(m.fraud.prevented + m.fraud.leaked)}`} color="#4cf2ff" code="SAFE" />
        <Gauge value={m.access} label="HONEST GET THROUGH" sub={`${m.honest.completed.toLocaleString()} of ${m.honest.attempts.toLocaleString()} buys`} color="#7dff9a" code="PASS" />
      </div>
      <div className="sparks"><Spark data={L.history} k="safety" color="#4cf2ff" /><Spark data={L.history} k="access" color="#7dff9a" /></div>
      <div className="kpis">
        <div><label>STOLEN</label><b className="bad">{money(m.fraud.leaked)}</b></div>
        <div><label>WRONGLY BLOCKED</label><b className="warn">{m.honest.blocked + m.honest.abandoned}</b></div>
        <div><label>DOUBLE CHARGES</label><b className={m.chaos.duplicateCharges ? 'warn' : ''}>{m.chaos.duplicateCharges}</b></div>
        <div><label>NET VALUE</label><b>{money(m.netValue)}</b></div>
      </div>
      {!multi && <AttackBoard m={m} />}
    </div>
  );
}

function Delta() {
  const a = useStore((s) => s.lanes[0]?.metrics), b = useStore((s) => s.lanes[1]?.metrics);
  if (!a || !b) return null;
  const dStolen = b.fraud.leaked - a.fraud.leaked;
  const dBlocked = (b.honest.blocked + b.honest.abandoned) - (a.honest.blocked + a.honest.abandoned);
  return (
    <div className="delta">
      <div className="delta-title">B vs A · same city, same attackers</div>
      <div className={dStolen <= 0 ? 'good' : 'bad'}>{dStolen <= 0 ? '▼' : '▲'} {money(Math.abs(dStolen))} {dStolen <= 0 ? 'less' : 'more'} stolen</div>
      <div className={dBlocked <= 0 ? 'good' : 'warn'}>{dBlocked <= 0 ? '▼' : '▲'} {Math.abs(dBlocked)} {dBlocked <= 0 ? 'fewer' : 'more'} honest shoppers turned away</div>
      <div className={b.netValue >= a.netValue ? 'good' : 'bad'}>net value {b.netValue >= a.netValue ? '+' : '−'}{money(Math.abs(b.netValue - a.netValue))}</div>
    </div>
  );
}

export function Hud() {
  const n = useStore((s) => s.lanes.length);
  return (
    <aside className="hud panel">
      <div className="panel-title"><span>METRICS</span><em>/harm/metrics</em></div>
      {n > 1 && <Delta />}
      {Array.from({ length: n }, (_, i) => <LaneHud key={i} lane={i} />)}
    </aside>
  );
}
