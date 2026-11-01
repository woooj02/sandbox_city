import { useEffect, useRef } from 'react';
import { CityRenderer } from '../city/CityRenderer';
import { bus } from '../sim/bus';
import { useStore } from '../store';
import { LANE_NAMES, clock } from './meta';

function Lane({ lane }: { lane: number }) {
  const host = useRef<HTMLDivElement>(null);
  const policy = useStore((s) => s.policies[lane]);
  const sale = useStore((s) => s.lanes[lane]?.sale);
  const multi = useStore((s) => s.lanes.length > 1);
  useEffect(() => {
    const r = new CityRenderer(host.current!, { lane, xray: () => useStore.getState().xray });
    let alive = true;
    r.init().then(() => {
      if (!alive) return;
      const w = useStore.getState().lanes[lane]?.world;
      if (w) r.setWorld(w);
    });
    const offs = [
      bus.on('world', (w) => { if (w.lane === lane) r.setWorld(w); }),
      bus.on('tick', (m) => { if (m.lane === lane) r.onTick(m); }),
      useStore.subscribe((s) => r.setSpeed(s.tps)),
    ];
    return () => { alive = false; offs.forEach((o) => o()); r.destroy(); };
  }, [lane]);
  return (
    <div className="lane">
      <div ref={host} className="lane-canvas" />
      {multi && (
        <div className={`lane-tag lane-${lane}`}>
          <b>{LANE_NAMES[lane]}</b><span>{policy?.name}</span>
        </div>
      )}
      {sale && <div className="sale-banner">タイムセール · FLASH SALE</div>}
    </div>
  );
}

export function CityView() {
  const n = useStore((s) => s.lanes.length);
  const t = useStore((s) => s.lanes[0]?.t ?? 0);
  return (
    <div className={`city n${n}`}>
      {Array.from({ length: n }, (_, i) => <Lane key={`${i}-${n}`} lane={i} />)}
      <div className="city-clock"><span>{clock(t)}</span></div>
    </div>
  );
}
