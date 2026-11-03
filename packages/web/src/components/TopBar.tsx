import { PRESETS } from '@sandbox-city/core';
import { PROMPT_LABEL, TAPES, modelLabel } from '../sim/brain';
import { useStore } from '../store';
import { client } from '../sim/client';
import { clock } from './meta';

const SPEEDS = [2, 8, 24, 80, 240];
const SPEED_LABEL: Record<number, string> = { 2: '¼×', 8: '1×', 24: '3×', 80: '10×', 240: 'MAX' };

export function TopBar() {
  const { running, tps, xray, policies, paypal } = useStore();
  const forged = useStore((s) => s.genomes !== null);
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
        <div className="logo-text">
          <div className="logo-title glitch" data-text="SANDBOX CITY">SANDBOX CITY</div>
          <div className="logo-sub">crash-test lab for AI commerce</div>
        </div>
      </div>
      <div className={`rail-badge ${paypal}`} title={paypal === 'sandbox' ? 'Lane A moves real money on the PayPal sandbox' : 'All payments run on the in-browser PayPal twin'}>
        <i />{paypal === 'sandbox' ? 'LIVE · PAYPAL SANDBOX' : 'PAYPAL TWIN'}
      </div>
      {forged && (
        <button className="rail-badge forged" title="Attackers in this city use tactics evolved by the forge. Click to go back to the stock attackers." onClick={() => { useStore.setState({ genomes: null }); client.start(useStore.getState().policies); setTimeout(() => client.send({ cmd: 'play' }), 300); }}>
          <i />☠ FORGED ATTACKERS
        </button>
      )}
      <ModelBadge />
      <button className="rail-badge hijack" title="A real model talked into an attacker's order on the PayPal sandbox, and what the gate did (H)" onClick={() => useStore.setState({ showHijack: true })}><i />◆ THE HIJACK</button>
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

/**
 * Switches shoppers' agents to a recorded language model and shows what it did with planted instructions.
 * Clicks cycle: stock agents → model with a plain prompt → model with a careful prompt → stock agents.
 */
function ModelBadge() {
  const on = useStore((s) => s.brain);
  const prompt = useStore((s) => s.brainPrompt);
  const b = useStore((s) => s.lanes[0]?.brain);
  const cycle = () => {
    useStore.setState(!on ? { brain: true, brainPrompt: 'plain' } : prompt === 'plain' ? { brainPrompt: 'guarded' } : { brain: false, brainPrompt: 'plain' });
    client.start(useStore.getState().policies);
    setTimeout(() => client.send({ cmd: 'play' }), 300);
  };
  const tape = TAPES[prompt];
  const recorded = !!tape.model;
  const title = on
    ? recorded
      ? `Shoppers' agents read listings that try to give instructions through ${tape.model}, ${prompt === 'guarded' ? 'told to treat page text as untrusted' : 'with an ordinary shopping prompt'} (recorded ${tape.recordedAt.slice(0, 10)}, ${tape.seeds.length} day${tape.seeds.length === 1 ? '' : 's'}). Click for ${prompt === 'plain' ? 'the careful prompt' : 'the stock agents'}.`
      : 'No model run recorded for this prompt yet: run scripts/record-brain.ts with a model key. Until then the stock agents decide.'
    : 'Let a language model read the listings for the shoppers (replays a recorded run)';
  return (
    <button className={`rail-badge model ${on ? 'on' : ''} ${on && prompt === 'guarded' ? 'guarded' : ''}`} title={title} onClick={cycle}>
      <i />◈ {on ? (recorded ? `${modelLabel(tape.model)} · ${PROMPT_LABEL[prompt]} · ${b?.obeyed ?? 0} OBEYED · ${b?.resisted ?? 0} RESISTED` : 'MODEL · NOT RECORDED') : 'MODEL SHOPPERS'}
    </button>
  );
}
