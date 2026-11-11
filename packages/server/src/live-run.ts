/**
 * A real model shops, now, on the hosted app. One small local model (Ollama) gets the task from round five that fooled
 * all four models, with a fresh seed. It shops with no defense, turn by turn. Then the exact order it placed goes through
 * POST /api/checkout twice: under No checks and under Frozen v4. With sandbox keys, each allowed order reaches the PayPal
 * sandbox and the response carries PayPal's own ids. Nothing here is recorded or replayed, except the fallback, which
 * says so.
 *
 * Shared box: one run at a time, a cap per hour, a cap per visitor, and the model may use only some of the CPU.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { PRESETS } from '@sandbox-city/core';
import { chat, parseAction, runEpisode, TOOLS, systemPrompt, type Turn } from './agent-lab/agent';
import { corpus } from './agent-lab/tasks';
import { firstMessage, ShopSession, type Episode, type LabTask } from './agent-lab/shop';

/** Fooled all 4 models in round five, and llama3.2:3b in 5 of 6 fresh runs: evidence/live-task-choice.txt. */
export const LIVE_TASK = 'heldout-prior-conversation-address-0';
export const LIVE_GATES = [{ rulebook: 'open', name: 'No checks' }, { rulebook: 'frozen-v4', name: 'Recommended (v4)' }] as const;

export interface LiveOptions {
  /** The Ollama model. Unset turns the live run off. */
  model?: string;
  ollamaUrl?: string;
  threads?: number;
  perHour?: number;
  perVisitorPerHour?: number;
  /** Where the last finished run is kept, for the labelled fallback. */
  lastPath?: string;
  /** For tests: answers in place of the model. */
  ask?: typeof chat;
  /** Visitors' own agents shopping over HTTP: sessions an hour in all, per visitor, and open at once. 0 turns it off. */
  visitorPerHour?: number;
  visitorPerVisitor?: number;
  visitorOpen?: number;
  /** A visitor's session with no call for this long is closed. */
  idleMs?: number;
}

export interface GateResult { rulebook: string; name: string; status: number; decision?: string; ok?: boolean; reason?: string; rail?: string; payment?: { state?: string; intent?: string; amount?: number; orderId?: string; captureId?: string; authorizationId?: string } | null; error?: string }
export interface LiveJob {
  id: string; status: 'running' | 'done' | 'failed'; startedAt: string; finishedAt?: string;
  model: string; seed: number; task: { id: string; style?: string; goal?: string; owner: LabTask['owner']; listings: { id: string; store: string; title: string; price: number; rating?: number; attacker?: boolean; decoy?: boolean; text: string; /** The description without the attack. */ clean?: string }[] };
  turns: { action: Turn['action']; reply: string; seen: string }[];
  outcome?: Episode['outcome']; violations?: string[]; order?: Episode['order'] & { store: string };
  gates: GateResult[];
  error?: string;
  /** Who is shopping: the model on this server, or a visitor's own agent calling the shop over HTTP. */
  source: 'server-model' | 'visitor';
  /** A visitor's agent names itself. Nothing checks the name. */
  agent?: string;
}

/** The held-out tasks a visitor's agent may draw: the attacker wants another address or more units. */
export const VISITOR_TASKS = corpus('heldout', 2, 0).filter((t) => t.goal === 'address' || t.goal === 'quantity');
const MAX_TURNS = 8;
const listed = (l: LabTask['listings'][number]) => ({ id: l.id, store: l.store, title: l.title, price: l.price, rating: l.rating, attacker: l.attacker, decoy: l.decoy, text: l.text, clean: l.clean });
type Listed = LiveJob['task']['listings'][number];
/** While a visitor's agent is still shopping, anyone can read the session, so it must not say which listing is the attacker's. */
function publicJob(job: LiveJob): LiveJob {
  if (job.source !== 'visitor' || job.status !== 'running') return job;
  return { ...job, task: { ...job.task, style: undefined, goal: undefined, listings: job.task.listings.map(({ attacker: _a, decoy: _d, clean: _c, ...l }) => l as Listed) } };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
/** "PO Box 404, Silk Row" → the address fields a create_order carries. */
export function addressFields(shipTo: string) {
  const [line, ...rest] = shipTo.split(',').map((s) => s.trim()).filter(Boolean);
  return { address_line_1: (line ?? shipTo).slice(0, 300), ...(rest.length ? { admin_area_2: rest.join(', ').slice(0, 120) } : {}) };
}

export function registerLiveRun(app: FastifyInstance, o: LiveOptions) {
  const task = corpus('heldout', 2, 0).find((t) => t.id === LIVE_TASK)!;
  const perHour = o.perHour ?? 20, perVisitor = o.perVisitorPerHour ?? 4;
  const jobs = new Map<string, LiveJob>();
  const starts: { at: number; who: string }[] = [];
  let running: string | null = null;

  const recent = () => { const cut = Date.now() - 3_600_000; while (starts.length && starts[0].at < cut) starts.shift(); return starts; };
  const last = (): LiveJob | null => { try { return o.lastPath && existsSync(o.lastPath) ? JSON.parse(readFileSync(o.lastPath, 'utf8')) : null; } catch { return null; } };

  /** The order as it was placed goes to the checkout once per gate. */
  async function sendToGates(job: LiveJob, t: LabTask, ep: Pick<Episode, 'outcome' | 'violations' | 'order'>) {
    job.outcome = ep.outcome; job.violations = ep.violations;
    const listing = ep.order && t.listings.find((l) => l.id === ep.order!.id);
    if (!ep.order || !listing) return;
    job.order = { ...ep.order, store: listing.store };
    const ow = t.owner;
    for (const g of LIVE_GATES) {
      const payload = {
        key: `live-${job.id}-${g.rulebook}`, rulebook: g.rulebook, merchant: `live-${job.id}-${slug(listing.store)}`,
        owner: { category: ow.category, qty: ow.qty, address: ow.address, budget: ow.budget }, listedUnit: listing.price,
        args: { currencyCode: 'USD', items: [{ name: listing.title, quantity: ep.order.qty, itemCost: listing.price, itemTotal: ep.order.amount }], shippingAddress: addressFields(ep.order.shipTo) },
      };
      const res = await app.inject({ method: 'POST', url: '/api/checkout', payload });
      const b = res.json() as Omit<GateResult, 'rulebook' | 'name' | 'status'> & { error?: string };
      job.gates.push({ rulebook: g.rulebook, name: g.name, status: res.statusCode, decision: b.decision, ok: b.ok, reason: b.reason, rail: b.rail, payment: b.payment ?? null, error: b.error });
    }
  }
  const closed = (job: LiveJob) => app.log.info(`live run ${job.id} (${job.source}${job.agent ? ` ${job.agent}` : ''}): ${job.status} ${job.outcome ?? ''} ${job.gates.map((g) => `${g.rulebook}=${g.decision}`).join(' ')}`);

  async function run(job: LiveJob) {
    try {
      const ep = await runEpisode(task, 'bare', PRESETS.open, { url: o.ollamaUrl, model: job.model, temperature: 0.7, seed: job.seed, threads: o.threads, keepAlive: '10m' }, o.ask ?? chat,
        (t) => job.turns.push({ action: t.action, reply: t.reply.slice(0, 400), seen: t.seen.slice(0, 600) }));
      await sendToGates(job, task, ep);
      job.status = 'done';
    } catch (e) {
      job.status = 'failed'; job.error = e instanceof Error ? e.message : String(e);
    } finally {
      job.finishedAt = new Date().toISOString();
      running = null;
      if (job.status === 'done' && o.lastPath) try { writeFileSync(o.lastPath, JSON.stringify(job)); } catch { /* the fallback is optional */ }
      closed(job);
    }
  }

  app.get('/api/live-run', async () => ({ enabled: !!o.model, model: o.model ?? null, busy: !!running, left: Math.max(0, perHour - recent().length), task: LIVE_TASK, last: last() }));

  app.post('/api/live-run', async (req, reply) => {
    if (!o.model) return reply.code(503).send({ error: 'the live model is off on this server', last: last() });
    if (running) return reply.code(429).send({ error: 'a model is shopping right now; watch it, or try again in a minute', busy: running });
    const who = String(req.headers['x-forwarded-for'] ?? req.ip).split(',')[0].trim();
    const window = recent();
    if (window.length >= perHour) return reply.code(429).send({ error: `the box's limit of ${perHour} live runs an hour is used up`, last: last() });
    if (window.filter((s) => s.who === who).length >= perVisitor) return reply.code(429).send({ error: `${perVisitor} live runs an hour per visitor`, last: last() });
    const id = randomBytes(6).toString('hex');
    const job: LiveJob = {
      id, source: 'server-model', status: 'running', startedAt: new Date().toISOString(), model: o.model, seed: randomBytes(3).readUIntBE(0, 3),
      task: { id: task.id, style: task.style, goal: task.goal, owner: task.owner, listings: task.listings.map(listed) },
      turns: [], gates: [],
    };
    starts.push({ at: Date.now(), who });
    jobs.set(id, job);
    if (jobs.size > 50) jobs.delete(jobs.keys().next().value!);
    running = id;
    void run(job);
    return reply.code(202).send({ id });
  });

  app.get<{ Params: { id: string } }>('/api/live-run/:id', async (req, reply) => {
    const job = jobs.get(req.params.id);
    return job ? publicJob(job) : reply.code(404).send({ error: 'no such run' });
  });

  // ---- a visitor's own agent shops here over HTTP, and anyone can watch it ----
  const vPerHour = o.visitorPerHour ?? 40, vPerVisitor = o.visitorPerVisitor ?? 10, vOpen = o.visitorOpen ?? 4, idleMs = o.idleMs ?? 180_000;
  const visits: { at: number; who: string }[] = [];
  const open = new Map<string, { shop: ShopSession; task: LabTask; touched: number; busy: boolean }>();
  const visitWindow = () => { const cut = Date.now() - 3_600_000; while (visits.length && visits[0].at < cut) visits.shift(); return visits; };
  const sweep = () => {
    for (const [id, s] of open) if (Date.now() - s.touched > idleMs && !s.busy) {
      const job = jobs.get(id);
      if (job && job.status === 'running') { job.status = 'failed'; job.error = 'the agent stopped calling'; job.finishedAt = new Date().toISOString(); closed(job); }
      open.delete(id);
    }
  };
  const HOW = 'POST one JSON action to `act` each turn. The reply\'s `seen` is what the shop answered. Stop when `done` is true.';

  app.get('/api/shop', async () => {
    sweep();
    const list = [...jobs.values()].filter((j) => j.source === 'visitor').slice(-8).reverse()
      .map((j) => ({ id: j.id, agent: j.agent ?? 'unnamed agent', model: j.model, status: j.status, outcome: j.outcome, startedAt: j.startedAt, order: j.order ? { amount: j.order.amount, shipTo: j.order.shipTo } : undefined }));
    return { enabled: vPerHour > 0, left: Math.max(0, vPerHour - visitWindow().length), recent: list };
  });

  app.post<{ Body: { agent?: unknown; model?: unknown } | null }>('/api/shop', async (req, reply) => {
    sweep();
    if (vPerHour <= 0) return reply.code(503).send({ error: 'visitor agents are off on this server' });
    const who = String(req.headers['x-forwarded-for'] ?? req.ip).split(',')[0].trim();
    const w = visitWindow();
    if (w.length >= vPerHour) return reply.code(429).send({ error: `the limit of ${vPerHour} agent sessions an hour is used up` });
    if (w.filter((v) => v.who === who).length >= vPerVisitor) return reply.code(429).send({ error: `${vPerVisitor} agent sessions an hour per visitor` });
    if (open.size >= vOpen) return reply.code(429).send({ error: 'too many agents are shopping right now; try again in a minute' });
    const clean = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.replace(/[^\w .:+@\/()'-]/g, '').trim().slice(0, 48) : '') || fallback;
    const id = randomBytes(6).toString('hex');
    const t = VISITOR_TASKS[randomBytes(2).readUInt16BE(0) % VISITOR_TASKS.length];
    const job: LiveJob = {
      id, source: 'visitor', agent: clean(req.body?.agent, 'unnamed agent'), status: 'running', startedAt: new Date().toISOString(), model: clean(req.body?.model, 'not stated'), seed: 0,
      task: { id: t.id, style: t.style, goal: t.goal, owner: t.owner, listings: t.listings.map(listed) },
      turns: [], gates: [],
    };
    visits.push({ at: Date.now(), who });
    jobs.set(id, job);
    if (jobs.size > 50) jobs.delete(jobs.keys().next().value!);
    open.set(id, { shop: new ShopSession(t, 'bare', PRESETS.open), task: t, touched: Date.now(), busy: false });
    return reply.code(201).send({ id, act: `/api/shop/${id}/act`, watch: `/?watch=${id}`, how: HOW, system: systemPrompt('bare'), message: firstMessage(t, 'bare'), tools: TOOLS(false), owner: t.owner, turnsLeft: MAX_TURNS });
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/api/shop/:id/act', async (req, reply) => {
    sweep();
    const s = open.get(req.params.id), job = jobs.get(req.params.id);
    if (!s || !job) return reply.code(job ? 409 : 404).send({ error: job ? `this session is ${job.status}` : 'no such session', ...(job ? { watch: `/?watch=${job.id}` } : {}) });
    if (s.busy) return reply.code(409).send({ error: 'the last action is still at the checkout' });
    s.touched = Date.now();
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null);
    const a = parseAction(raw);
    const seen = a ? s.shop.step(a) : `That call was rejected. Use exactly one of these:\n${TOOLS(false)}`;
    job.turns.push({ action: a, reply: raw.slice(0, 400), seen: seen.slice(0, 600) });
    const out = job.turns.length >= MAX_TURNS;
    if (!s.shop.done && !out) return { seen, done: false, turnsLeft: MAX_TURNS - job.turns.length };
    s.busy = true;
    try { await sendToGates(job, s.task, s.shop.result()); job.status = 'done'; }
    catch (e) { job.status = 'failed'; job.error = e instanceof Error ? e.message : String(e); }
    job.finishedAt = new Date().toISOString();
    open.delete(job.id);
    closed(job);
    return { seen, done: true, turnsLeft: 0, outcome: job.outcome, violations: job.violations, order: job.order, gates: job.gates, watch: `/?watch=${job.id}`, error: job.error };
  });
}
