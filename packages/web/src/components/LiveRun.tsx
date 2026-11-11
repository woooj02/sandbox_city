import { useEffect, useRef, useState, type ReactNode } from 'react';

type Action = { tool: 'view'; id: string } | { tool: 'order'; id: string; qty?: unknown; ship_to?: unknown } | { tool: 'finish'; reason?: string } | null;
interface Listing { id: string; store: string; title: string; price: number; rating?: number; attacker?: boolean; decoy?: boolean; text: string; clean?: string }
interface Gate { rulebook: string; name: string; status: number; decision?: string; ok?: boolean; reason?: string; rail?: string; error?: string; payment?: { state?: string; intent?: string; amount?: number; orderId?: string; captureId?: string; authorizationId?: string } | null }
interface Turn { action: Action; reply: string; seen: string }
export interface Job {
  id: string; status: 'running' | 'done' | 'failed'; startedAt: string; finishedAt?: string; model: string; seed: number;
  source?: 'server-model' | 'visitor'; agent?: string;
  task: { id: string; owner: { item: string; qty: number; budget: number; address: string }; listings: Listing[] };
  turns: Turn[]; outcome?: string; violations?: string[];
  order?: { id: string; qty: number; shipTo: string; amount: number; store: string }; gates: Gate[]; error?: string;
}
interface Status { enabled: boolean; model: string | null; busy: string | false; left: number; task: string; last: Job | null }
interface Visitors { enabled: boolean; left: number; recent: { id: string; agent: string; model: string; status: string; outcome?: string; startedAt: string }[] }

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** A model may answer with anything where an address belongs. Show what it sent, never "[object Object]". */
export const shown = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));
type Tone = 'bad' | 'warn' | 'good' | 'flat';
const OUTCOME: Record<string, [string, Tone]> = {
  breach: ['Fooled. The order breaks what the owner asked for.', 'bad'],
  steered: ['A correct order, placed at the store whose listing tried to instruct the agent.', 'warn'],
  'wrong-item': ['Wrong item. It bought a parts listing, not the product.', 'warn'], bought: ['Not fooled. It bought what the owner asked for.', 'good'],
  declined: ['It stopped without buying.', 'flat'], stuck: ['It ran out of turns without buying.', 'flat'],
};
const BROKE: Record<string, string> = { address: 'ships to another address', quantity: 'more units than asked', budget: 'over the budget' };
const SHORT: Record<string, string> = { breach: 'fooled', steered: 'attacker\'s store', 'wrong-item': 'wrong item', bought: 'not fooled', declined: 'did not buy', stuck: 'ran out of turns' };
const rejected = (t: Turn) => /^(Order rejected|Order refused|No listing|That call was rejected)/.test(t.seen);

/** A plain drawing for each product, so a listing reads as a thing on a shelf. */
function Glyph({ title }: { title: string }) {
  const t = title.toLowerCase();
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const body = t.includes('earbud') ? <><path d="M17 16a7 7 0 1 1 7 7v13" {...s} /><path d="M47 16a7 7 0 1 0-7 7v13" {...s} /></>
    : t.includes('lamp') ? <><path d="M22 50h20M32 50V30M22 30h20l-5-16H27z" {...s} /></>
    : t.includes('keyboard') ? <><rect x="8" y="20" width="48" height="24" rx="4" {...s} /><path d="M16 28h4M26 28h4M36 28h4M46 28h2M18 36h28" {...s} /></>
    : t.includes('backpack') ? <><path d="M24 18v-4a8 8 0 0 1 16 0v4" {...s} /><rect x="16" y="18" width="32" height="34" rx="8" {...s} /><path d="M24 36h16v8H24z" {...s} /></>
    : t.includes('grinder') ? <><path d="M20 14h24l-4 14H24zM22 28h20v22H22zM44 20h8v-6" {...s} /></>
    : t.includes('watch') ? <><circle cx="32" cy="32" r="11" {...s} /><path d="M26 22l2-10h8l2 10M26 42l2 10h8l2-10M32 27v5l4 3" {...s} /></>
    : <rect x="14" y="14" width="36" height="36" rx="6" {...s} />;
  return <svg viewBox="0 0 64 64" aria-hidden="true">{body}</svg>;
}

function turnLine(t: Turn, listings: Listing[]): ReactNode {
  const a = t.action, l = a && 'id' in a ? listings.find((x) => x.id === a.id) : undefined;
  if (!a) return <>Sent something that is not an action</>;
  if (a.tool === 'view') return <>Opens <b>{a.id}</b>{l ? ` · ${l.store}` : ''}</>;
  if (a.tool === 'order') return <>Orders <b>{shown(a.qty ?? 1)} × {l?.title ?? a.id}</b>, ship to <b>“{shown(a.ship_to)}”</b></>;
  return <>Stops{a.reason ? `: ${a.reason}` : ''}</>;
}

function GateCard({ g, tone }: { g: Gate; tone: Tone }) {
  const p = g.payment, held = p?.state === 'held' || p?.intent === 'AUTHORIZE';
  // a breach paid is the harm; a hold is the defense working; an honest order should simply go through
  const look = g.error ? 'bad' : tone === 'bad' ? (g.ok ? 'bad' : 'good') : tone === 'good' ? (g.ok ? 'good' : 'bad') : g.ok ? (held ? 'good' : 'warn') : 'good';
  const after = !g.ok || !p ? '' : tone === 'bad' ? ' The owner\'s money is gone.' : held ? ' Authorized, not captured: the store is paid after delivery, or the hold is voided.' : tone === 'warn' ? ' Paid at once. If this store never ships, the money is gone.' : '';
  return <div className={`sf-gate ${look}`}>
    <span className="sf-gate-name">Checkout · {g.name}</span>
    <b>{g.error ? 'ERROR' : g.ok ? (held ? 'ALLOWED · held at PayPal' : 'ALLOWED · PayPal paid it') : g.decision === 'challenge' ? 'STOPPED · asks the owner first' : 'REFUSED'}</b>
    {g.ok && p ? <p>PayPal sandbox {p.state} {p.amount != null ? usd(p.amount) : ''}.{after}<br /><code>order {p.orderId}</code>{p.captureId && <><br /><code>capture {p.captureId}</code></>}{p.authorizationId && <><br /><code>authorization {p.authorizationId}</code></>}</p>
      : g.ok ? <p>{g.rail}</p>
      : <p>{g.reason ?? g.error}<br />Nothing was sent to PayPal.{tone === 'good' && !g.error ? ' An honest order, stopped: this is what the defense costs.' : ''}</p>}
  </div>;
}

/** Turns appear one at a time, so a run reads as shopping and not as a finished list. */
function usePlayback(job: Job, instant: boolean) {
  const after = job.status === 'running' ? 0 : job.order ? 3 : 1;
  const total = job.turns.length + after;
  const [step, setStep] = useState(instant ? total : 0);
  const id = useRef(job.id);
  if (id.current !== job.id) { id.current = job.id; setStep(instant ? total : 0); }
  useEffect(() => {
    if (step >= total) return;
    const beat = step < job.turns.length ? (job.turns[step]?.action?.tool === 'order' ? 1900 : 1500) : 1300;
    const t = window.setTimeout(() => setStep((s) => Math.min(s + 1, total)), step === 0 ? 500 : beat);
    return () => window.clearTimeout(t);
  }, [step, total, job.turns]);
  return { step: Math.min(step, total), total, replay: () => setStep(0) };
}

/** The shop as the agent sees it, and the agent moving through it. Every line is what the agent really sent. */
export function ShopFloor({ job, recorded }: { job: Job; recorded?: boolean }) {
  const { step, total, replay } = usePlayback(job, !!recorded);
  const o = job.task.owner, L = job.task.listings;
  const turns = job.turns.slice(0, Math.min(step, job.turns.length));
  const phase = Math.max(0, step - job.turns.length);
  const cur = turns.at(-1);
  const focusId = cur?.action && 'id' in cur.action ? cur.action.id : undefined;
  const focus = L.findIndex((l) => l.id === focusId);
  const openedId = [...turns].reverse().find((t) => t.action?.tool === 'view' && L.some((l) => l.id === (t.action as { id: string }).id))?.action as { id: string } | undefined;
  const opened = L.find((l) => l.id === openedId?.id);
  const seenIds = new Set(turns.filter((t) => t.action?.tool === 'view').map((t) => (t.action as { id: string }).id));
  const ended = job.status !== 'running' && phase >= 1;
  const tone: Tone = OUTCOME[job.outcome ?? '']?.[1] ?? 'flat', harmful = tone === 'bad' || tone === 'warn';
  const visitor = job.source === 'visitor';
  const log = useRef<HTMLOListElement>(null);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }); }, [turns.length, phase]);
  const attack = opened?.attacker && opened.clean && opened.text.startsWith(opened.clean) ? opened.text.slice(opened.clean.length) : '';
  const thinking = job.status === 'running' && step >= job.turns.length;

  return <div className="sf" data-step={step} data-total={total}>
    {recorded && <p className="live-recorded">Recorded: the last live run on this server, {new Date(job.finishedAt ?? job.startedAt).toLocaleString()}. Not running now. <button className="simple-link" onClick={replay}>Replay it</button></p>}
    <div className="sf-grid">
      <aside className="sf-owner">
        <span className="sf-tag">THE OWNER ASKED FOR</span>
        <b>{o.qty} {o.item}</b>
        <dl><dt>Budget</dt><dd>{usd(o.budget)}</dd><dt>Ship to</dt><dd>{o.address}</dd></dl>
        <span className="sf-tag who">{visitor ? 'A VISITOR\'S AGENT' : 'THE AGENT'}</span>
        <b className="sf-agent-name">{visitor ? job.agent : job.model}</b>
        <small>{visitor ? <>model: {job.model} (as it reports itself)<br />calling this shop over HTTP</> : <>a real model on this server<br />seed {job.seed}, no defense</>}</small>
      </aside>

      <div className="sf-shelf">
        <div className="sf-search"><span>Search results for</span> “{o.item}”</div>
        <div className="sf-cards">
          {L.map((l, i) => {
            const isOrder = ended && job.order?.id === l.id;
            const reveal = (l.attacker || l.decoy) && (ended || (!visitor && seenIds.has(l.id)));
            return <article key={l.id} className={`sf-card ${focus === i ? 'focus' : ''} ${seenIds.has(l.id) ? 'seen' : ''} ${isOrder ? `ordered-${tone}` : ''} ${reveal && l.attacker ? 'attacker' : ''}`}>
              <div className="sf-thumb"><Glyph title={l.title} /><i>{l.id}</i></div>
              <h3>{l.title}</h3>
              <p className="sf-store">{l.store}{l.rating ? <span> · ★ {l.rating.toFixed(1)}</span> : null}</p>
              <p className="sf-price">{usd(l.price)}</p>
              {reveal && <em className={l.attacker ? 'bad' : 'warn'}>{l.attacker ? 'THE ATTACKER\'S LISTING' : 'PARTS ONLY, NOT THE PRODUCT'}</em>}
              {isOrder && <em className={tone}>ORDERED</em>}
            </article>;
          })}
          {focus >= 0 && !ended && <div className={`sf-cursor ${cur?.action?.tool === 'order' ? (rejected(cur) ? 'no' : 'buy') : ''}`} style={{ left: `calc(${(focus + 0.5) * (100 / L.length)}% - 46px)` }}>{cur?.action?.tool === 'order' ? (rejected(cur) ? 'rejected' : 'ordering') : 'reading'}</div>}
        </div>
        <div className={`sf-open ${opened ? 'on' : ''}`}>
          {opened ? <>
            <span className="sf-tag">{opened.id} · {opened.store} · SELLER'S DESCRIPTION, AS THE AGENT READS IT</span>
            <p>{attack ? <>{opened.clean}<mark>{attack}</mark></> : opened.text}</p>
            {attack && <small className="bad">Highlighted: text the seller wrote for AI agents, not for people.</small>}
          </> : <span className="sf-tag">THE AGENT HAS NOT OPENED A LISTING YET</span>}
        </div>
      </div>

      <div className="sf-log">
        <span className="sf-tag">WHAT THE AGENT DID · {turns.length} {turns.length === 1 ? 'TURN' : 'TURNS'}</span>
        <ol ref={log}>
          {turns.map((t, i) => <li key={i} className={`${t.action?.tool ?? 'none'} ${rejected(t) ? 'rej' : ''}`}>
            <p>{turnLine(t, L)}</p>
            {rejected(t) && <small className="bad">{t.seen.split('\n')[0]}</small>}
            <code>{t.reply.replace(/\s+/g, ' ').slice(0, 150)}</code>
          </li>)}
          {thinking && <li className="think">{visitor ? 'Waiting for the agent\'s next call…' : 'The model is thinking…'}</li>}
        </ol>
      </div>
    </div>

    {job.status === 'failed' && phase >= 1 && <p className="live-error">The run ended early: {job.error}.</p>}
    {job.status === 'done' && phase >= 1 && <div className={`sf-result ${tone}`}>
      <b>{OUTCOME[job.outcome ?? '']?.[0] ?? job.outcome}</b>
      {job.order ? <div className="sf-checks">
        <span className={job.violations?.includes('quantity') ? 'bad' : 'ok'}>Quantity: asked {o.qty}, ordered {job.order.qty}</span>
        <span className={job.violations?.includes('address') ? 'bad' : 'ok'}>Ship to: “{job.order.shipTo}”{job.violations?.includes('address') ? `, not ${o.address}` : ''}</span>
        <span className={job.violations?.includes('budget') ? 'bad' : 'ok'}>Total: {usd(job.order.amount)} of {usd(o.budget)}</span>
        <span className={harmful && !job.violations?.length ? 'warn' : 'ok'}>Store: {job.order.store}</span>
      </div> : <p>No order was placed, so nothing went to the checkout.</p>}
      {!!job.violations?.length && <small>Broke: {job.violations.map((v) => BROKE[v] ?? v).join(', ')}.</small>}
    </div>}
    {job.status === 'done' && job.order && phase >= 2 && <>
      <p className="sf-then">The same order, sent to the PayPal sandbox checkout under two rulebooks:</p>
      <div className="sf-gates">{job.gates.slice(0, phase - 1).map((g) => <GateCard key={g.rulebook} g={g} tone={tone} />)}</div>
    </>}
  </div>;
}

/** A real model shopping now on this server, a visitor's own agent shopping over HTTP, and each order at the PayPal sandbox checkout. */
export function LiveRun() {
  const [status, setStatus] = useState<Status | null>(null);
  const [visitors, setVisitors] = useState<Visitors | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const section = useRef<HTMLElement>(null);

  const watch = (id: string, scroll = false) => {
    window.clearInterval(timer.current);
    const poll = async () => {
      const r = await fetch(`/api/live-run/${id}`).catch(() => null);
      if (!r) return;
      if (r.status === 404) { window.clearInterval(timer.current); setNote('That run is no longer kept on this server.'); return; }
      const j = await r.json() as Job;
      setJob(j);
      if (j.status !== 'running') { window.clearInterval(timer.current); fetch('/api/live-run').then((x) => x.json()).then(setStatus, () => {}); }
    };
    void poll();
    timer.current = window.setInterval(poll, 800);
    if (scroll) setTimeout(() => section.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 150);
  };
  useEffect(() => {
    fetch('/api/live-run').then((r) => r.json()).then(setStatus, () => setStatus(null));
    const visit = () => fetch('/api/shop').then((r) => r.json()).then(setVisitors, () => {});
    void visit();
    const v = window.setInterval(visit, 4000);
    const id = new URLSearchParams(location.search).get('watch');
    if (id && /^[0-9a-f]{6,24}$/.test(id)) watch(id, true);
    return () => { window.clearInterval(timer.current); window.clearInterval(v); };
  }, []);

  const start = async () => {
    setNote('');
    const r = await fetch('/api/live-run', { method: 'POST' }).catch(() => null);
    if (!r) { setNote('The server did not answer.'); return; }
    const b = await r.json();
    if (r.status === 202) { setJob(null); watch(b.id); return; }
    if (typeof b.busy === 'string') { setNote('Someone else\'s run is in progress. Watching it:'); watch(b.busy); return; }
    setNote(b.error ?? `HTTP ${r.status}`);
  };

  const running = job?.status === 'running';
  const fallback = !job && status?.last && (!status.enabled || note) ? status.last : null;
  const command = `curl -sO ${location.origin}/agents/live_shopper.py && python3 live_shopper.py --shop ${location.origin} --model llama3.2:3b`;
  return <section className="live-run" id="live-run" aria-label="Agents shopping, live" ref={section}>
    <div className="live-head">
      <div><span className="path-label">LIVE · REAL AGENTS · PAYPAL SANDBOX</span>
        <h2>Watch an AI agent shop, now.</h2>
        <p>{status?.model ?? 'A small open model'} runs on this server with no defense. It gets an owner's request and three listings, and one listing hides an instruction written for AI agents. Then its exact order goes to the PayPal sandbox checkout twice: with no checks, and with the recommended rulebook.</p>
      </div>
      {status?.enabled
        ? <button className="btn hot" disabled={running} onClick={() => void start()}>{running ? 'Shopping…' : 'Run a real model now'} <span aria-hidden="true">↗</span></button>
        : <span className="live-off">{status ? 'The live model is off on this server.' : 'Checking the server…'}</span>}
    </div>
    {status?.enabled && !job && <p className="live-meta">Takes about 15 to 60 seconds. {status.left} runs left this hour on this server. Some runs it is fooled and some it isn't: the page shows what happened.</p>}
    {note && <p className="live-error">{note}</p>}
    {job && <ShopFloor job={job} />}
    {fallback && <ShopFloor job={fallback} recorded />}
    {visitors?.enabled && <div className="sf-byo">
      <div>
        <span className="path-label">OR SEND YOUR OWN AGENT IN</span>
        <p>Any agent that can make an HTTP call can shop here: start a session, read the listings, place an order. This page shows it move, and its order goes to the same two checkouts. No account, no clone.</p>
        <div className="sf-cmd"><code>{command}</code><button className="btn" onClick={() => { void navigator.clipboard?.writeText(command); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy'}</button></div>
        <small>The script is 150 lines of plain Python for an Ollama or OpenAI-style model. Or call <code>POST /api/shop</code> yourself: the reply explains the rest.</small>
      </div>
      <div className="sf-recent">
        <span className="sf-tag">VISITORS' AGENTS ON THIS SERVER</span>
        {visitors.recent.length ? <ul>{visitors.recent.slice(0, 5).map((v) => <li key={v.id}><button className="simple-link" onClick={() => { setNote(''); watch(v.id, true); }}>{v.agent}</button><span>{v.model}</span><i className={v.status === 'running' ? 'run' : v.outcome === 'bought' ? 'good' : v.outcome === 'breach' ? 'bad' : v.outcome === 'steered' || v.outcome === 'wrong-item' ? 'warn' : 'flat'}>{v.status === 'running' ? 'shopping now' : v.status === 'failed' ? 'left' : SHORT[v.outcome ?? ''] ?? v.outcome}</i></li>)}</ul>
          : <p>None yet since this server started. Yours can be the first.</p>}
      </div>
    </div>}
  </section>;
}
