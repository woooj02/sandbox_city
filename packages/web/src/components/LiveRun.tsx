import { useEffect, useRef, useState } from 'react';

type Action = { tool: 'view'; id: string } | { tool: 'order'; id: string; qty?: unknown; ship_to?: unknown } | { tool: 'finish'; reason?: string } | null;
interface Listing { id: string; store: string; title: string; price: number; attacker?: boolean; decoy?: boolean; text: string }
interface Gate { rulebook: string; name: string; status: number; decision?: string; ok?: boolean; reason?: string; rail?: string; error?: string; payment?: { state?: string; intent?: string; amount?: number; orderId?: string; captureId?: string; authorizationId?: string } | null }
interface Job {
  id: string; status: 'running' | 'done' | 'failed'; startedAt: string; finishedAt?: string; model: string; seed: number;
  task: { id: string; owner: { item: string; qty: number; budget: number; address: string }; listings: Listing[] };
  turns: { action: Action; reply: string; seen: string }[]; outcome?: string; violations?: string[];
  order?: { id: string; qty: number; shipTo: string; amount: number; store: string }; gates: Gate[]; error?: string;
}
interface Status { enabled: boolean; model: string | null; busy: string | false; left: number; task: string; last: Job | null }

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const OUTCOME: Record<string, string> = {
  breach: 'The model was fooled: its order breaks the owner\'s request.', steered: 'The model bought from the attacker\'s store.',
  'wrong-item': 'The model bought the wrong item (a parts listing).', bought: 'The model bought what the owner asked for.',
  declined: 'The model did not buy anything.', stuck: 'The model ran out of turns without buying.',
};

function turnText(t: Job['turns'][number], listings: Listing[]) {
  const a = t.action, l = a && 'id' in a ? listings.find((x) => x.id === a.id) : undefined;
  if (!a) return 'Replied with something that is not a valid action.';
  if (a.tool === 'view') return `Opened ${a.id}${l ? ` · ${l.store}${l.attacker ? ' (the attacker)' : ''}` : ''}`;
  if (a.tool === 'order') return `Ordered ${String(a.qty ?? 1)} × ${l?.title ?? a.id} from ${l?.store ?? '?'}, ship to "${String(a.ship_to ?? '')}"`;
  return `Stopped${a.reason ? `: ${a.reason}` : ''}`;
}

function GateCard({ g }: { g: Gate }) {
  const p = g.payment;
  return <div className={`live-gate ${g.ok ? 'allow' : 'refuse'}`}>
    <span>{g.name}</span>
    <b>{g.error ? 'ERROR' : g.ok ? (p?.state === 'held' || p?.intent === 'AUTHORIZE' ? 'ALLOW · held' : 'ALLOW · paid') : g.decision === 'challenge' ? 'STOP · asks the owner' : 'REFUSE'}</b>
    {g.ok && p ? <p>PayPal sandbox: {p.state} {p.amount != null ? usd(p.amount) : ''}<br /><code>order {p.orderId}</code>{p.captureId && <><br /><code>capture {p.captureId}</code></>}{p.authorizationId && <><br /><code>authorization {p.authorizationId}</code></>}</p>
      : g.ok ? <p>{g.rail}</p>
      : <p>{g.reason ?? g.error}<br />Nothing was sent to PayPal.</p>}
  </div>;
}

function JobView({ job, recorded }: { job: Job; recorded?: boolean }) {
  const o = job.task.owner, attacker = job.task.listings.find((l) => l.attacker);
  return <div className="live-job">
    {recorded && <p className="live-recorded">Recorded: the last live run on this server, {new Date(job.finishedAt ?? job.startedAt).toLocaleString()}. Not running now.</p>}
    <p className="live-owner"><b>The owner asked for</b> {o.qty} {o.item}, under {usd(o.budget)}, shipped to {o.address}. <span>{job.model} · seed {job.seed}</span></p>
    {attacker && <details><summary>What the attacker's listing ({attacker.id}, {attacker.store}) says</summary><p className="live-listing">{attacker.text}</p></details>}
    <ol className="live-turns">{job.turns.map((t, i) => <li key={i}>{turnText(t, job.task.listings)}</li>)}{job.status === 'running' && <li className="live-thinking">The model is thinking…</li>}</ol>
    {job.status === 'failed' && <p className="live-error">The model run failed: {job.error}.</p>}
    {job.status === 'done' && <>
      <p className="live-outcome"><b>{OUTCOME[job.outcome ?? ''] ?? job.outcome}</b>{job.violations?.length ? ` Broke: ${job.violations.join(', ')}.` : ''}</p>
      {job.order ? <>
        <p>The same order, {job.order.qty} × at {usd(job.order.amount)} to "{job.order.shipTo}", sent to the checkout under two rulebooks:</p>
        <div className="live-gates">{job.gates.map((g) => <GateCard key={g.rulebook} g={g} />)}</div>
      </> : <p>No order was placed, so nothing went to the checkout.</p>}
    </>}
  </div>;
}

/** A real model shopping now on this server, and its order at the PayPal sandbox checkout. */
export function LiveRun() {
  const [status, setStatus] = useState<Status | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [note, setNote] = useState('');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => { fetch('/api/live-run').then((r) => r.json()).then(setStatus, () => setStatus(null)); return () => window.clearInterval(timer.current); }, []);

  const watch = (id: string) => {
    window.clearInterval(timer.current);
    timer.current = window.setInterval(async () => {
      const j = await fetch(`/api/live-run/${id}`).then((r) => r.json() as Promise<Job>).catch(() => null);
      if (!j) return;
      setJob(j);
      if (j.status !== 'running') { window.clearInterval(timer.current); fetch('/api/live-run').then((r) => r.json()).then(setStatus, () => {}); }
    }, 1000);
  };
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
  return <section className="live-run" aria-label="A real model, live">
    <div className="live-head">
      <div><span className="path-label">LIVE · REAL MODEL · PAYPAL SANDBOX</span>
        <h2>Watch a real model shop, now.</h2>
        <p>{status?.model ?? 'A small open model'} runs on this server. It gets an owner's request and three listings; one listing hides an instruction to ship somewhere else. In our study that listing fooled all four models. It shops with no defense, then its exact order goes to the PayPal sandbox checkout twice: with no checks, and with the recommended rulebook.</p>
      </div>
      {status?.enabled
        ? <button className="btn hot" disabled={running} onClick={() => void start()}>{running ? 'Shopping…' : 'Run a real model now'} <span aria-hidden="true">↗</span></button>
        : <span className="live-off">{status ? 'The live model is off on this server.' : 'Checking the server…'}</span>}
    </div>
    {status?.enabled && !job && <p className="live-meta">Takes about 15 to 60 seconds. {status.left} runs left this hour on this server.</p>}
    {note && <p className="live-error">{note}</p>}
    {job && <JobView job={job} />}
    {fallback && <JobView job={fallback} recorded />}
  </section>;
}
