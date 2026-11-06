import { useEffect } from 'react';
import { Welcome } from './Welcome';
import { useStore } from '../store';
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
import { AgentTest } from './AgentTest';
import { Worth } from './Worth';
import { Caption, SimpleHud, SimpleRules } from './Simple';

export function App() {
  const lanes = useStore((s) => s.lanes.length);
  const cinema = useStore((s) => s.cinema.on);
  // a forked city compares two rulebooks, which only the full board can show
  const full = useStore((s) => s.fullLab) || lanes > 1;
  useEffect(() => {
    const p = policiesFromUrl(useStore.getState().policies);
    client.start(p);
    client.send({ cmd: 'speed', tps: useStore.getState().tps });
    const auto = new URLSearchParams(location.search).get('autoplay');
    if (auto !== '0') setTimeout(() => client.send({ cmd: 'play' }), 600);
    // H opens the hijack exhibit from anywhere outside a text field (not over the film: Esc leaves cinema first)
    const key = (e: KeyboardEvent) => {
      if ((e.key === 'h' || e.key === 'H') && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !useStore.getState().cinema.on)
        useStore.setState((s) => ({ showHijack: !s.showHijack }));
      if ((e.key === 'e' || e.key === 'E') && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !useStore.getState().cinema.on)
        useStore.setState((s) => ({ showEvidence: !s.showEvidence }));
      if ((e.key === 'l' || e.key === 'L') && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !useStore.getState().cinema.on)
        useStore.setState((s) => ({ fullLab: !s.fullLab }));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <div className={`app lanes-${lanes} ${cinema ? 'cinema' : ''} ${full ? '' : 'simple'}`}>
      <div className="scanlines" />
      <TopBar />
      {full ? <Rulebook /> : <SimpleRules />}
      <main className="stage">
        <CityView />
        <CutIns />
        {!full && <Caption />}
      </main>
      {full ? <Hud /> : <SimpleHud />}
      <Ledger />
      <Feed />
      <Report />
      <AutoTune />
      <Forge />
      <Hijack />
      <Evidence />
      <AgentTest />
      <Worth />
      <Cinema />
      <Welcome />
    </div>
  );
}
