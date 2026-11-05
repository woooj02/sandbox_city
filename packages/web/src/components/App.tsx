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

export function App() {
  const lanes = useStore((s) => s.lanes.length);
  const cinema = useStore((s) => s.cinema.on);
  useEffect(() => {
    const p = policiesFromUrl(useStore.getState().policies);
    client.start(p);
    client.send({ cmd: 'speed', tps: useStore.getState().tps });
    const auto = new URLSearchParams(location.search).get('autoplay');
    if (auto !== '0') setTimeout(() => client.send({ cmd: 'play' }), 600);
    // H opens the hijack exhibit from anywhere outside a text field (not over the film: Esc leaves cinema first)
    const key = (e: KeyboardEvent) => {
      if ((e.key === 'h' || e.key === 'H') && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement) && !useStore.getState().cinema.on)
        useStore.setState((s) => ({ showHijack: !s.showHijack }));
      if ((e.key === 'e' || e.key === 'E') && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement) && !useStore.getState().cinema.on)
        useStore.setState((s) => ({ showEvidence: !s.showEvidence }));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <div className={`app lanes-${lanes} ${cinema ? 'cinema' : ''}`}>
      <div className="scanlines" />
      <TopBar />
      <Rulebook />
      <main className="stage">
        <CityView />
        <CutIns />
      </main>
      <Hud />
      <Ledger />
      <Feed />
      <Report />
      <AutoTune />
      <Forge />
      <Hijack />
      <Evidence />
      <Cinema />
      <Welcome />
    </div>
  );
}
