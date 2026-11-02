import { useState } from 'react';
import { Policy, PRESETS, RULES } from '@sandbox-city/core';
import { useStore } from '../store';
import { client } from '../sim/client';
import { LANE_NAMES } from './meta';
import { startTune } from './AutoTune';
import { startForge } from './Forge';

export function Rulebook() {
  const policies = useStore((s) => s.policies);
  const multi = policies.length > 1;
  const [edit, setEdit] = useState(0);
  const lane = Math.min(edit, policies.length - 1);
  const [draft, setDraft] = useState<Policy[] | null>(null);
  const cur = (draft ?? policies)[lane];
  const dirty = draft !== null;

  const update = (p: Partial<Policy>) => {
    const next = (draft ?? policies).slice();
    next[lane] = { ...next[lane], ...p, name: p.name ?? (next[lane].name.endsWith('*') ? next[lane].name : `${next[lane].name}*`) };
    setDraft(next);
  };
  const apply = () => { client.start(draft ?? policies); setDraft(null); setTimeout(() => client.send({ cmd: 'play' }), 300); };

  return (
    <aside className="rulebook panel">
      <div className="panel-title"><span>RULEBOOK</span><em>/gate/rules</em></div>
      {multi && (
        <div className="seg lanes">
          {policies.map((p, i) => <button key={i} className={`${lane === i ? 'on' : ''} lane-${i}`} onClick={() => setEdit(i)}>{LANE_NAMES[i]} · {(draft ?? policies)[i].name}</button>)}
        </div>
      )}
      <div className="presets">
        {Object.entries(PRESETS).map(([k, p]) => (
          <button key={k} className={`chip ${cur.name.replace('*', '') === p.name ? 'on' : ''}`} onClick={() => update({ ...p, name: p.name })}>{p.name}</button>
        ))}
      </div>
      <div className="rules">
        {RULES.map((r) => {
          const v = cur[r.key];
          const on = r.kind === 'bool' ? !!v : (v as number) > 0;
          return (
            <div className={`rule ${on ? 'on' : ''}`} key={r.key} title={r.blurb}>
              {r.kind === 'bool' ? (
                <label className="toggle">
                  <input type="checkbox" checked={!!v} onChange={(e) => update({ [r.key]: e.target.checked } as Partial<Policy>)} />
                  <i />
                  <span>{r.label}</span>
                </label>
              ) : (
                <div className="slider">
                  <div className="slider-head"><span>{r.label}</span><b>{(v as number) === 0 ? 'off' : r.key === 'merchantRepMin' || r.key === 'sanitizer' || r.key === 'refundRatioCap' || r.key === 'ringDetection' ? (v as number).toFixed(2) : v}</b></div>
                  <input type="range" min={r.min} max={r.max} step={r.step} value={v as number} onChange={(e) => update({ [r.key]: Number(e.target.value) } as Partial<Policy>)} />
                </div>
              )}
              <div className="blurb">{r.blurb}</div>
            </div>
          );
        })}
      </div>
      <div className="rule-foot">
        <div className="rule-actions">
          <button className={`btn apply ${dirty ? 'hot' : ''}`} onClick={apply}>{dirty ? '⟳ REPLAY WITH THESE RULES' : '⟳ REPLAY'}</button>
          <button className="btn tune-btn" title="Search for a better rulebook automatically" onClick={() => startTune('safe')}>✦ AUTO-TUNE</button>
          <button className="btn forge-btn" title="Evolve the attackers against these rules" onClick={() => startForge()}>☠ ATTACK FORGE</button>
        </div>
        <p>Same seed: same city, same shoppers, same attackers. Only the rules change.</p>
      </div>
    </aside>
  );
}
