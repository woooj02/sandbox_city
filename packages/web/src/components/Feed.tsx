import { useStore } from '../store';
import { clock, LANE_NAMES } from './meta';

export function Feed() {
  const feed = useStore((s) => s.feed);
  const multi = useStore((s) => s.lanes.length > 1);
  return (
    <aside className="feed panel">
      <div className="panel-title"><span>CITY WIRE</span><em>速報</em></div>
      <ul>
        {feed.map((f) => (
          <li key={f.id} className={`tone-${f.tone}`}>
            <time>{clock(f.t)}</time>{multi && <b className={`lane-${f.lane}`}>{LANE_NAMES[f.lane]}</b>}<span>{f.text}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
