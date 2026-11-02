import { useEffect, useRef, useState } from 'react';
import { useStore, type FeedItem } from '../store';
import { director } from '../sim/director';
import { LANE_NAMES, clock, money, pct } from './meta';

/** Movie subtitles: the most dramatic line on the wire, held long enough to read. */
function Caption() {
  const [line, setLine] = useState<FeedItem | null>(null);
  const shownAt = useRef(0);
  const queued = useRef<FeedItem | null>(null);
  useEffect(() => {
    const cur = { id: -1 };
    const show = (f: FeedItem) => { setLine(f); cur.id = f.id; shownAt.current = performance.now(); queued.current = null; };
    const off = useStore.subscribe((s, prev) => {
      if (s.feed === prev.feed || !s.feed[0]) return;
      const f = s.feed.find((x) => x.tone === 'bad' || x.tone === 'good' || x.tone === 'attack');
      if (!f || f.id === cur.id || f.id === queued.current?.id) return;
      if (performance.now() - shownAt.current > 2600) show(f); else queued.current = f;
    });
    const iv = setInterval(() => {
      if (queued.current && performance.now() - shownAt.current > 2600) show(queued.current);
      else if (!queued.current && performance.now() - shownAt.current > 5000) setLine(null);
    }, 250);
    return () => { off(); clearInterval(iv); };
  }, []);
  const card = useStore((s) => s.cinema.card);
  if (!line || card) return null;
  return <div className={`cine-caption tone-${line.tone}`} key={line.id}>{line.lane > 0 || useStore.getState().lanes.length > 1 ? <b className={`lane-${line.lane}`}>{LANE_NAMES[line.lane]}</b> : null}<span>{line.text}</span></div>;
}

function TitleCardView() {
  const c = useStore((s) => s.cinema.card);
  if (!c) return null;
  return (
    <div className={`cine-card ${c.big ? 'big' : ''}`} key={c.id}>
      <div className="cc-wipe" />
      <div className="cc-kanji">{c.kanji.split('').map((ch, i) => <span key={i} style={{ animationDelay: `${0.08 + i * 0.11}s` }}>{ch}</span>)}</div>
      <div className="cc-text">
        {c.act && <div className="cc-act">{c.act}</div>}
        <div className="cc-title">{c.title}</div>
        {c.sub && <div className="cc-sub">{c.sub}</div>}
      </div>
    </div>
  );
}

function LaneStrip({ lane }: { lane: number }) {
  const m = useStore((s) => s.lanes[lane]?.metrics);
  const name = useStore((s) => s.policies[lane]?.name);
  const multi = useStore((s) => s.lanes.length > 1);
  if (!m) return <div className="cine-lane" />;
  const lost = m.fraud.leaked + m.chaos.duplicateValue;
  return (
    <div className={`cine-lane lane-${lane}`}>
      {multi && <b className="cl-tag">{LANE_NAMES[lane]}</b>}
      <span className="cl-name">{name}</span>
      <span className="cl-k"><i>LOST</i><em className={lost > 0.5 ? 'bad' : ''}>{money(lost)}</em></span>
      <span className="cl-k"><i>FRAUD STOPPED</i><em className="cy">{pct(m.safety)}</em></span>
      <span className="cl-k"><i>HONEST THROUGH</i><em className="gr">{pct(m.access)}</em></span>
      <span className="cl-k"><i>NET VALUE</i><em className="gold">{money(m.netValue)}</em></span>
    </div>
  );
}

function LastCall() {
  const c = useStore((s) => s.paypalCalls[0]);
  const fl = useStore((s) => s.inFlight[s.inFlight.length - 1]);
  const [, tick] = useState(0);
  useEffect(() => { if (!fl) return; const iv = setInterval(() => tick((n) => n + 1), 100); return () => clearInterval(iv); }, [fl?.at]);
  if (fl) return <div className="cine-call flight"><i className="spin" />CALLING PAYPAL SANDBOX · {fl.method} {fl.path.replace(/[A-Z0-9]{12,}/g, '…')} · {((performance.now() - fl.at) / 1000).toFixed(1)}s</div>;
  if (!c) return null;
  return <div className="cine-call" key={c.id}><i className={c.status < 300 ? 'ok' : c.status < 500 ? 'warn' : 'bad'} />{c.method} {c.path.replace(/[A-Z0-9]{12,}/g, '…')} · {c.status} · {c.ms}ms</div>;
}

export function Cinema() {
  const on = useStore((s) => s.cinema.on);
  const rolling = useStore((s) => s.cinema.rolling);
  const act = useStore((s) => s.cinema.act);
  const lanes = useStore((s) => s.lanes.length);
  const t = useStore((s) => s.lanes[0]?.t ?? 0);
  const paypal = useStore((s) => s.paypal);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const st = useStore.getState();
      if (e.key === 'c' || e.key === 'C') useStore.setState({ cinema: { ...st.cinema, on: !st.cinema.on } });
      if (!st.cinema.on) return;
      if (e.key === 'r' || e.key === 'R') director.roll();
      if (e.key >= '1' && e.key <= '4') director.roll(Number(e.key));
      if (e.key === 'Escape') director.stop();
    };
    window.addEventListener('keydown', key);
    const q = new URLSearchParams(location.search);
    if (q.get('roll') === '1') setTimeout(() => director.roll(Number(q.get('act') ?? 1)), 300);
    return () => window.removeEventListener('keydown', key);
  }, []);

  if (!on) return null;
  return (
    <div className={`cinema-layer ${rolling ? 'rolling' : ''}`}>
      <div className="cine-vignette" />
      <div className="cine-grain" />
      <div className="cine-bar top">
        <span className="cb-brand"><b>砂箱都市</b> SANDBOX CITY</span>
        <span className="cb-act">{act}</span>
        <span className="cb-right">
          <span className={`cb-rail ${paypal}`}><i />{paypal === 'sandbox' ? 'LIVE · PAYPAL SANDBOX' : 'PAYPAL TWIN'}</span>
          <span className="cb-clock">{t >= 1440 ? 'END OF DAY' : clock(t)}</span>
        </span>
      </div>
      <Caption />
      <TitleCardView />
      <div className="cine-bar bottom">
        <div className="cine-lanes">{Array.from({ length: lanes }, (_, i) => <LaneStrip key={i} lane={i} />)}</div>
        <LastCall />
      </div>
      {!rolling && (
        <button className="cine-roll" onClick={() => director.roll()}>
          <span>▶ ROLL</span><small>R roll · 1–4 start at act · Esc cut · C leave cinema</small>
        </button>
      )}
    </div>
  );
}
