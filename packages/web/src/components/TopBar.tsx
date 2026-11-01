import { PRESETS } from '@sandbox-city/core';
import { useStore } from '../store';
import { client } from '../sim/client';
import { clock } from './meta';

const SPEEDS = [2, 8, 24, 80, 240];
const SPEED_LABEL: Record<number, string> = { 2: '¼×', 8: '1×', 24: '3×', 80: '10×', 240: 'MAX' };

export function TopBar() {
  const { running, tps, xray, policies } = useStore();
  const lane0 = useStore((s) => s.lanes[0]);
  const t = lane0?.t ?? 0, total = lane0?.world?.ticks ?? 1440;
  const fork = () => {
    const p = useStore.getState().policies;
    client.start(p.length > 1 ? [p[0]] : [p[0], p[0].name === PRESETS.balanced.name ? PRESETS.kya : PRESETS.balanced]);
    setTimeout(() => client.send({ cmd: 'play' }), 300);
  };
  return (
    <header className="topbar">
      <div className="logo">
        <div className="logo-mark">⌬</div>
        <div>
          <div className="logo-title glitch" data-text="SANDBOX CITY">SANDBOX CITY</div>
          <div className="logo-sub">サンドボックス・シティ · crash-test lab for AI commerce</div>
        </div>
      </div>
      <div className="clockbox">
        <div className="clock-big">DAY 1 · {clock(t)}</div>
        <div className="progress"><i style={{ width: `${(t / total) * 100}%` }} /></div>
      </div>
      <div className="controls">
        <button className={`btn play ${running ? 'on' : ''}`} onClick={() => client.send({ cmd: running ? 'pause' : 'play' })}>{running ? '❚❚ PAUSE' : '▶ RUN'}</button>
        <div className="seg">
          {SPEEDS.map((s) => <button key={s} className={tps === s ? 'on' : ''} onClick={() => client.send({ cmd: 'speed', tps: s })}>{SPEED_LABEL[s]}</button>)}
        </div>
        <button className={`btn ${xray ? 'on' : ''}`} title="Show the ground truth the gate can't see" onClick={() => useStore.setState({ xray: !xray })}>◉ X-RAY</button>
        <button className={`btn fork ${policies.length > 1 ? 'on' : ''}`} onClick={fork}>⑂ {policies.length > 1 ? 'UNFORK' : 'FORK'}</button>
        <button className="btn" onClick={() => { client.start(useStore.getState().policies); setTimeout(() => client.send({ cmd: 'play' }), 300); }}>↺ RERUN</button>
      </div>
    </header>
  );
}
