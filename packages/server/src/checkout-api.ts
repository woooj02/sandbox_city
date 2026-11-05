/**
 * The checkout an outside agent can call. One request goes through the evaluator the benchmark measured (same code,
 * same rulebook hash) and, if allowed, through the durable worker, so a retry or a restart cannot pay twice.
 *
 *   POST /api/checkout          gate, then pay. Answers with the decision, the rulebook id and the payment.
 *   GET  /api/payments/:key     what the journal knows about one payment.
 *   POST /webhooks/paypal       applied only after PayPal verifies the signature.
 *
 * The owner's mandate arrives in the request here because this is a lab. In production it would come from a passport
 * the owner signed: a caller that writes its own mandate can give itself any budget.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { CheckoutSession, policyId, PRESETS, type CheckoutArgs, type CreateOrderInput, type Policy, type Verdict } from '@sandbox-city/core';
import { PaymentJournal, PaymentWorker, type PayRecord } from './payments';
import type { SandboxRails } from './paypal';

export interface CheckoutOptions {
  rails: () => SandboxRails | null;
  journalPath: string;
  webhookId?: string;
  rulebooks?: Record<string, Policy>;
  perMinute?: number;
  log?: (msg: string) => void;
}

interface Owner { category: string; qty: number; address: string; budget: number }
interface Body { key?: unknown; session?: unknown; rulebook?: unknown; owner?: Partial<Owner>; listedUnit?: unknown; args?: CheckoutArgs }

/** The frozen rulebooks by name, read from the files the benchmark checked. */
export function frozenRulebooks(): Record<string, Policy> {
  const out: Record<string, Policy> = { open: PRESETS.open, fortress: PRESETS.fortress, tuned: PRESETS.tuned };
  for (const [name, file] of [['frozen-v1', 'frozen.json'], ['frozen-v2', 'frozen-v2.json'], ['frozen-v3', 'frozen-v3.json']] as const) {
    const url = new URL(`../../../evidence/${file}`, import.meta.url);
    if (!existsSync(url)) continue;
    const f = JSON.parse(readFileSync(url, 'utf8')) as { policy: Policy; policyId: string };
    if (policyId(f.policy) !== f.policyId) throw new Error(`${file} does not match its hash`);
    out[name] = f.policy;
  }
  return out;
}

function invalid(b: Body): string | null {
  if (typeof b.key !== 'string' || !/^[\w-]{1,64}$/.test(b.key)) return 'key: 1 to 64 letters, digits, - or _';
  if (b.session != null && (typeof b.session !== 'string' || !/^[\w-]{1,64}$/.test(b.session))) return 'session: 1 to 64 letters, digits, - or _';
  const o = b.owner;
  if (!o || typeof o.address !== 'string' || !o.address.trim() || typeof o.category !== 'string') return 'owner: needs category and address';
  if (!Number.isInteger(o.qty) || o.qty! < 1 || typeof o.budget !== 'number' || !(o.budget > 0)) return 'owner: needs a whole qty and a positive budget';
  if (!b.args || typeof b.args !== 'object' || !Array.isArray(b.args.items) || !b.args.items.length) return 'args: a create_order call with items';
  if (b.listedUnit != null && !(typeof b.listedUnit === 'number' && b.listedUnit > 0)) return 'listedUnit: a positive price';
  return null;
}

const sameOrder = (a: CreateOrderInput, b: CreateOrderInput) => a.amount === b.amount && a.shipTo === b.shipTo && a.item.qty === b.item.qty;

export function registerCheckout(app: FastifyInstance, opts: CheckoutOptions) {
  const rulebooks = opts.rulebooks ?? frozenRulebooks();
  const fallback = ['frozen-v3', 'frozen-v2', 'frozen-v1'].find((k) => rulebooks[k]) ?? 'tuned';
  const sessions = new Map<string, { session: CheckoutSession; owner: string; rulebook: string }>();
  const limit = opts.perMinute ?? 60;
  let windowStart = 0, used = 0;

  // one run id for the life of the journal: idempotency keys and invoice ids must survive a restart
  const runFile = `${opts.journalPath}.run`;
  let lazy: { worker: PaymentWorker; rails: SandboxRails } | null | undefined;
  const payments = () => {
    if (lazy !== undefined) return lazy;
    const rails = opts.rails();
    if (!rails) return (lazy = null);
    mkdirSync(dirname(opts.journalPath), { recursive: true });
    if (!existsSync(runFile)) writeFileSync(runFile, `c${randomBytes(6).toString('hex')}\n`);
    rails.runId = readFileSync(runFile, 'utf8').trim();
    return (lazy = { worker: new PaymentWorker(rails, new PaymentJournal(opts.journalPath)), rails });
  };

  /** Finishes whatever a previous process left open. Call once at startup. */
  const recover = async (): Promise<PayRecord[]> => {
    const p = payments();
    return p ? p.worker.recover() : [];
  };

  const view = (r: PayRecord | null | undefined) => r && { key: r.key, state: r.state, amount: r.input.amount, orderId: r.orderId, captureId: r.captureId, recovered: r.recovered, reason: r.reason };

  app.post<{ Body: Body }>('/api/checkout', async (req, reply) => {
    const now = Date.now();
    if (now - windowStart > 60_000) { windowStart = now; used = 0; }
    if (++used > limit) return reply.code(429).send({ error: 'too many checkouts this minute' });

    const b = req.body ?? {};
    const bad = invalid(b);
    if (bad) return reply.code(400).send({ error: bad });
    const name = typeof b.rulebook === 'string' ? b.rulebook : fallback;
    const policy = rulebooks[name];
    if (!policy) return reply.code(400).send({ error: `unknown rulebook; one of ${Object.keys(rulebooks).join(', ')}` });
    const owner = b.owner as Owner, key = b.key as string, sessionId = (b.session as string | undefined) ?? key, ownerId = JSON.stringify(owner);

    let entry = sessions.get(sessionId);
    if (entry && (entry.owner !== ownerId || entry.rulebook !== name)) return reply.code(409).send({ error: 'this session belongs to another owner or rulebook' });
    if (!entry) {
      if (sessions.size >= 500) sessions.delete(sessions.keys().next().value!);
      entry = { session: new CheckoutSession(policy, { owner, listedUnit: b.listedUnit as number | undefined, agentId: `agent-${sessionId}` }), owner: ownerId, rulebook: name };
      sessions.set(sessionId, entry);
    }

    const p = payments();
    const known = p?.worker.journal.get(key);
    // a retry of a finished key is answered from the journal: the gate already decided, and PayPal hears nothing
    if (known) {
      const again = entry.session.checkOrderShape(b.args!);
      const asked = input(key, sessionId, again);
      if (!sameOrder(known.input, asked)) return reply.code(409).send({ error: 'this key already paid for a different order' });
      const r = await p!.worker.pay(key, known.input);
      return { decision: 'allow', ok: true, replay: true, rulebook: name, policy: policyId(policy), payment: view(r), rail: rail(p!.rails) };
    }

    const v: Verdict = entry.session.checkOrder(b.args!);
    const head = { decision: v.decision, ok: v.ok, reason: v.reason, rulebook: name, policy: v.policy, evaluator: v.evaluator, hits: v.hits, order: v.order && { amount: v.order.amount, qty: v.order.qty, shipTo: v.order.shipTo } };
    if (!v.ok) return { ...head, payment: null, rail: 'not sent: the gate stopped it' };
    if (!p) return { ...head, payment: null, rail: 'none: PayPal keys are not configured, so the gate ran and nothing was paid' };

    // reserved before the first await, so two calls in the same moment cannot both spend the same mandate
    entry.session.created(key, v.order!);
    const r = await p.worker.pay(key, input(key, sessionId, v.order!)).catch((e: Error) => { entry!.session.release(key); throw e; });
    if (r.state !== 'captured') entry.session.release(key);
    return { ...head, payment: view(r), rail: rail(p.rails) };
  });

  app.get<{ Params: { key: string } }>('/api/payments/:key', async (req, reply) => {
    const r = payments()?.worker.journal.get(req.params.key);
    return r ? view(r) : reply.code(404).send({ error: 'no such payment' });
  });

  app.post('/webhooks/paypal', async (req, reply) => {
    const p = payments();
    if (!p || !opts.webhookId) return reply.code(503).send({ error: 'webhooks are not configured' });
    const event = req.body as Parameters<PaymentWorker['applyEvent']>[0];
    if (!event?.id || !event.event_type || !event.resource) return reply.code(400).send({ error: 'not a webhook event' });
    if (!await p.rails.verifyWebhook(req.headers, event, opts.webhookId)) return reply.code(401).send({ error: 'signature did not verify' });
    return { result: p.worker.applyEvent(event) };
  });

  return { recover };
}

const rail = (r: SandboxRails) => (r.isSandbox ? 'paypal-sandbox' : 'contract-mock');

function input(key: string, agent: string, o: { amount: number; qty: number; shipTo: string }): CreateOrderInput {
  return {
    intent: 'CAPTURE', amount: o.amount, currency: 'USD', payeeMerchantId: 'checkout', payerId: agent, card: { last4: '1111', state: 'ok', holder: agent },
    item: { name: 'Agent checkout order', sku: 'CHECKOUT', unit: o.amount / o.qty, qty: o.qty }, shipTo: o.shipTo, customId: key,
  };
}
