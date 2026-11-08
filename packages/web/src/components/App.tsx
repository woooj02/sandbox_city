import { useShallow } from 'zustand/react/shallow';
import { useEffect } from 'react';
import { useStore } from '../store';
import { pageShortcut } from '../shortcuts';
import { client, policiesFromUrl } from '../sim/client';
import { TopBar } from './TopBar';
import { CityView } from './CityView';
import { Hud } from './Hud';
import { Ledger } from './Ledger';
import { Rulebook } from './Rulebook';
import { CutIns } from './CutIn';
import { Feed } from './Feed';
import { Report } from './Report';
import { AutoTune } from './AutoTune';
import { Cinema } from './Cinema';
import { Forge } from './Forge';
import { Hijack } from './Hijack';
import { Evidence } from './Evidence';
import { Caption, SimpleHud, SimpleRules } from './Simple';
import { Workspace } from './Workspace';
import { CityScope } from './Scope';
import { policyId } from '@sandbox-city/core';
import { overlayFor } from '../workflow';

export function App() {
  const state = useStore(useShallow((s) => ({ task: s.task, savedDecision: s.savedDecision, selectTask: s.selectTask, runComplete: s.runComplete, policies: s.policies, showAgent: s.showAgent, showWorth: s.showWorth, experiment: s.experiment })));
  const task = state.task;
  const overlay = useStore(overlayFor);
  const lanes = useStore((s) => s.lanes.length);
  const cinema = useStore((s) => s.cinema.on);
  // a forked city compares two rulebooks, which only the full board can show
  const full = useStore((s) => s.fullLab) || lanes > 1;
  useEffect(() => {
    const p = policiesFromUrl(useStore.getState().policies);
    client.start(p);
    client.send({ cmd: 'speed', tps: useStore.getState().tps });
    const auto = new URLSearchParams(location.search).get('autoplay');
    if (auto === '1') setTimeout(() => client.send({ cmd: 'play' }), 600);
    // H opens the hijack exhibit from anywhere outside a text field (not over the film: Esc leaves cinema first)
    const key = (e: KeyboardEvent) => {
      if (!pageShortcut(e) || useStore.getState().cinema.on) return;
      const k = e.key.toLowerCase();
      if (k === 'h') useStore.setState((st) => ({ showHijack: !st.showHijack }));
      if (k === 'e') useStore.setState((st) => ({ showEvidence: !st.showEvidence }));
      if (k === 'l') useStore.setState((st) => ({ fullLab: !st.fullLab }));
    };
    const unsubscribe = useStore.subscribe((next, previous) => {
      const requested = next.showEvidence && !previous.showEvidence ? 'evidence' : next.showHijack && !previous.showHijack ? 'hijack' : next.showReport && !previous.showReport ? 'report' : next.tune.open && !previous.tune.open ? 'tune' : next.forge.open && !previous.forge.open ? 'forge' : null;
      if (requested) useStore.setState({ showEvidence: requested === 'evidence', showHijack: requested === 'hijack', showReport: requested === 'report', tune: { ...next.tune, open: requested === 'tune' }, forge: { ...next.forge, open: requested === 'forge' } });
    });
    window.addEventListener('keydown', key);
    return () => { unsubscribe(); window.removeEventListener('keydown', key); };
  }, []);
  useEffect(() => {
    const task = state.showAgent ? 'agent-authority' : state.showWorth ? 'policy-cost' : null;
    if (task) { client.send({ cmd: 'pause' }); state.selectTask(task); }
  }, [state.showAgent, state.showWorth]);
  useEffect(() => { if (!state.experiment && task !== 'home' && task !== 'city') state.selectTask(task); }, [task]);
  const overlays = <>{overlay === 'report' ? <Report /> : overlay === 'evidence' ? <Evidence /> : overlay === 'hijack' ? <Hijack /> : overlay === 'tune' ? <AutoTune /> : overlay === 'forge' ? <Forge /> : null}</>;
  if (task !== 'city' && !cinema) return <div className="lab-theme task-app"><Workspace home={task === 'home'} />{overlays}</div>;
  return (
    <div className={`app lanes-${lanes} ${cinema ? 'cinema' : 'lab-theme'} ${full ? '' : 'simple'}`}>
      <div className="scanlines" />
      <TopBar />
      <div className="city-context"><button className="simple-link" onClick={() => { client.send({ cmd: 'pause' }); state.selectTask('home'); }}>Choose a question</button><CityScope />{state.savedDecision && <div className="decision-reference"><b>Pinned decision · {state.savedDecision.selected.label} · {state.savedDecision.experiment?.id}</b>{state.savedDecision.selected.policyHash !== policyId(state.policies[0]) && <strong>Current city policy differs from the kept decision.</strong>}<span>{state.savedDecision.reason}</span><p>Carries over: policy only. This default city has a different population and seed; it does not replay benchmark days or the empty-box days.</p><button className="btn" onClick={() => state.selectTask('policy-cost')}>Return to priced decision</button></div>}{state.runComplete && <button className="btn" onClick={() => useStore.setState({ showReport: true })}>Run complete — inspect result</button>}</div>
      {full ? <Rulebook /> : <SimpleRules />}
      <main className="stage">
        <CityView />
        <CutIns />
        {!full && <Caption />}
      </main>
      {full ? <Hud /> : <SimpleHud />}
      <Ledger />
      <Feed />
      {overlays}
      <Cinema />
    </div>
  );
}
