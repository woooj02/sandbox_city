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

/** Types a shell command out one keystroke at a time. */
function Typed({ text, cps = 46, onDone }: { text: string; cps?: number; onDone?: () => void }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const t0 = performance.now();
    const iv = setInterval(() => {
      const k = Math.min(text.length, Math.floor(((performance.now() - t0) / 1000) * cps));
      setN(k);
      if (k >= text.length) { clearInterval(iv); onDone?.(); }
    }, 16);
    return () => clearInterval(iv);
  }, [text]);
  return <>{text.slice(0, n)}</>;
}

const NOISE = 'ABCDEF0123456789#$%&@*+=/<>';
/** Decrypts a line into place: scrambled glyphs settle left to right. */
function Decode({ text, ms = 750 }: { text: string; ms?: number }) {
  const [out, setOut] = useState(() => text.replace(/\S/g, '·'));
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const step = () => {
      const u = Math.min(1, (performance.now() - t0) / ms);
      const fixed = Math.floor(u * text.length);
      setOut(text.split('').map((ch, i) => (i < fixed || ch === ' ' ? ch : NOISE[(Math.random() * NOISE.length) | 0])).join(''));
      if (u < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text]);
  return <>{out}</>;
}

function TitleCardView() {
  const c = useStore((s) => s.cinema.card);
  const [typed, setTyped] = useState(false);
  useEffect(() => setTyped(false), [c?.id]);
  if (!c) return null;
  return (
    <div className={`cine-card ${c.big ? 'big' : ''}`} key={c.id}>
      <div className="cc-grid" />
      <div className="cc-sweep" />
      <div className="cc-term">
        <div className="cc-prompt"><span className="cc-host">root@sandbox-city</span><span className="cc-path">:~$</span> <Typed text={c.cmd} onDone={() => setTyped(true)} /><i className="cc-cursor" /></div>
        {typed && (
          <>
            {c.lines?.map((l, i) => <div key={i} className={`cc-log ${l.startsWith('[warn]') ? 'warn' : ''}`} style={{ animationDelay: `${i * 0.14}s` }}>{l}</div>)}
            {c.act && <div className="cc-act">[ {c.act} ]</div>}
            <div className="cc-title" data-text={c.title}><Decode text={c.title} /></div>
            {c.sub && <div className="cc-sub">&gt; {c.sub}</div>}
          </>
        )}
      </div>
    </div>
  );
}

/** The gate's decision log, scrolling in the corner like a terminal in a heist film. */
function Trace() {
  const lines = useStore((s) => s.trace);
  const card = useStore((s) => s.cinema.card);
  const report = useStore((s) => s.showReport || s.tune.open || s.forge.open);
  const multi = useStore((s) => s.lanes.length > 1);
  // split screen has its own two-lane story; the trace belongs to single-lane shots
  if (card || report || multi || !lines.length) return null;
  return (
    <div className="cine-trace">
      <div className="ct-head">gate.trace · live decisions <i /></div>
      {lines.slice(0, 7).reverse().map((l, i, all) => (
        <div key={l.id} className={`ct-line v-${l.verdict.replace(/[^A-Z]/g, '')}`} style={{ opacity: 1 - (all.length - 1 - i) * 0.12 }}>
          <span className="ct-t">{clock(l.t)}</span><b>{l.verdict.padEnd(6)}</b><span className="ct-x">{l.text}</span>{l.note && <em>{l.note}</em>}
        </div>
      ))}
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
      if (e.key >= '1' && e.key <= '6') director.roll(Number(e.key));
      if (e.key === 'Escape') director.stop();
    };
    window.addEventListener('keydown', key);
    const q = new URLSearchParams(location.search);
    // #film rolls from the top; #act5 and friends start at that act (hash links survive where query strings do not)
    const h = /^#(?:film|act([1-6]))$/.exec(location.hash);
    if (q.get('roll') === '1') setTimeout(() => director.roll(Number(q.get('act') ?? 1)), 300);
    else if (h) setTimeout(() => director.roll(Number(h[1] ?? 1)), 300);
    return () => window.removeEventListener('keydown', key);
  }, []);

  if (!on) return null;
  return (
    <div className={`cinema-layer ${rolling ? 'rolling' : ''}`}>
      <div className="cine-vignette" />
      <div className="cine-grain" />
      <div className="cine-bar top">
        <span className="cb-brand"><i className="cb-rec" /><b>SANDBOX//CITY</b>gate.trace</span>
        <span className="cb-act">{act}</span>
        <span className="cb-right">
          <span className={`cb-rail ${paypal}`}><i />{paypal === 'sandbox' ? 'LIVE · PAYPAL SANDBOX' : 'PAYPAL TWIN'}</span>
          <span className="cb-clock">{t >= 1440 ? 'END OF DAY' : clock(t)}</span>
        </span>
      </div>
      <Caption />
      <Trace />
      <TitleCardView />
      <div className="cine-bar bottom">
        <div className="cine-lanes">{Array.from({ length: lanes }, (_, i) => <LaneStrip key={i} lane={i} />)}</div>
        <LastCall />
      </div>
      {!rolling && (
        <button className="cine-roll" onClick={() => director.roll()}>
          <span>▶ ROLL</span><small>R roll · 1–5 start at act · Esc cut · C leave cinema</small>
        </button>
      )}
    </div>
  );
}
