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
import { chat, runEpisode, type Turn } from './agent-lab/agent';
import { corpus } from './agent-lab/tasks';
import type { Episode, LabTask } from './agent-lab/shop';

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
}

export interface GateResult { rulebook: string; name: string; status: number; decision?: string; ok?: boolean; reason?: string; rail?: string; payment?: { state?: string; intent?: string; amount?: number; orderId?: string; captureId?: string; authorizationId?: string } | null; error?: string }
export interface LiveJob {
  id: string; status: 'running' | 'done' | 'failed'; startedAt: string; finishedAt?: string;
  model: string; seed: number; task: { id: string; style?: string; goal?: string; owner: LabTask['owner']; listings: { id: string; store: string; title: string; price: number; attacker?: boolean; decoy?: boolean; text: string }[] };
  turns: { action: Turn['action']; reply: string; seen: string }[];
  outcome?: Episode['outcome']; violations?: string[]; order?: Episode['order'] & { store: string };
  gates: GateResult[];
  error?: string;
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

  async function run(job: LiveJob) {
    try {
      const ep = await runEpisode(task, 'bare', PRESETS.open, { url: o.ollamaUrl, model: job.model, temperature: 0.7, seed: job.seed, threads: o.threads, keepAlive: '10m' }, o.ask ?? chat,
        (t) => job.turns.push({ action: t.action, reply: t.reply.slice(0, 400), seen: t.seen.slice(0, 600) }));
      job.outcome = ep.outcome; job.violations = ep.violations;
      const listing = ep.order && task.listings.find((l) => l.id === ep.order!.id);
      if (ep.order && listing) {
        job.order = { ...ep.order, store: listing.store };
        const ow = task.owner;
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
      job.status = 'done';
    } catch (e) {
      job.status = 'failed'; job.error = e instanceof Error ? e.message : String(e);
    } finally {
      job.finishedAt = new Date().toISOString();
      running = null;
      if (job.status === 'done' && o.lastPath) try { writeFileSync(o.lastPath, JSON.stringify(job)); } catch { /* the fallback is optional */ }
      app.log.info(`live run ${job.id}: ${job.status} ${job.outcome ?? ''} ${job.gates.map((g) => `${g.rulebook}=${g.decision}`).join(' ')}`);
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
      id, status: 'running', startedAt: new Date().toISOString(), model: o.model, seed: randomBytes(3).readUIntBE(0, 3),
      task: { id: task.id, style: task.style, goal: task.goal, owner: task.owner, listings: task.listings.map((l) => ({ id: l.id, store: l.store, title: l.title, price: l.price, attacker: l.attacker, decoy: l.decoy, text: l.text })) },
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
    return job ?? reply.code(404).send({ error: 'no such run' });
  });
}
