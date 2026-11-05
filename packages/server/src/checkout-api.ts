/**
 * The checkout an outside agent can call. One request goes through the evaluator the benchmark measured (same code,
 * same rulebook hash) and, if allowed, through the durable worker, so a retry or a restart cannot pay twice.
 *
 *   POST /api/checkout          gate, then pay or hold. Answers with the decision, the facts it saw and the payment.
 *   GET  /api/payments/:key     what the journal knows about one payment, and the decision behind it.
 *   POST /api/history/events    deliveries, complaints, closed windows and imported records. Needs the lab token.
 *   GET  /api/history/merchants/:id   a store's record as the evaluator sees it.
 *   POST /webhooks/paypal       applied only after PayPal verifies the signature.
 *
 * A hold is a PayPal authorization: no money moves until the goods arrive and the rulebook's window closes, and it is
 * voided if they do not. History comes from a HistorySource. The default folds the payment journal.
 *
 * The owner's mandate arrives in the request here because this is a lab. In production it would come from a passport
 * the owner signed: a caller that writes its own mandate can give itself any budget.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { canonicalAddress, CheckoutSession, policyId, PRESETS, settlement, type CheckoutArgs, type CreateOrderInput, type Policy, type PostalAddress, type Verdict } from '@sandbox-city/core';
import { JournalHistory, type HistorySource } from './history';
import { PaymentJournal, PaymentWorker, type DecisionContext, type PayRecord } from './payments';
import type { SandboxRails } from './paypal';

export interface CheckoutOptions {
  rails: () => SandboxRails | null;
  journalPath: string;
  webhookId?: string;
  rulebooks?: Record<string, Policy>;
  perMinute?: number;
  log?: (msg: string) => void;
  /** Where store and agent history comes from. Default: folded from the payment journal. */
  history?: HistorySource;
  /** Bearer token for POST /api/history/events, which can release held money. Unset turns the route off. */
  labToken?: string;
}

interface Owner { category: string; qty: number; address: string; budget: number }
interface Body { key?: unknown; session?: unknown; rulebook?: unknown; owner?: Partial<Owner>; listedUnit?: unknown; args?: CheckoutArgs; merchant?: unknown; agent?: unknown }
interface HistoryEvent { type?: string; key?: unknown; id?: unknown; source?: unknown; age?: number; orders?: number; refunds?: number; verified?: boolean; deliveries?: number; fulfilled?: number; independent?: number; exposure?: number }

/** A request that names no store is judged as an unknown one: a new store with no record. */
const UNKNOWN_STORE = 'unknown-store';
const ID = /^[\w-]{1,64}$/;

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
  for (const k of ['session', 'merchant', 'agent'] as const) if (b[k] != null && (typeof b[k] !== 'string' || !ID.test(b[k] as string))) return `${k}: 1 to 64 letters, digits, - or _`;
  const o = b.owner;
  if (!o || typeof o.address !== 'string' || !o.address.trim() || typeof o.category !== 'string') return 'owner: needs category and address';
  if (!Number.isInteger(o.qty) || o.qty! < 1 || typeof o.budget !== 'number' || !(o.budget > 0)) return 'owner: needs a whole qty and a positive budget';
  if (!b.args || typeof b.args !== 'object' || !Array.isArray(b.args.items) || !b.args.items.length) return 'args: a create_order call with items';
  if (b.listedUnit != null && !(typeof b.listedUnit === 'number' && b.listedUnit > 0)) return 'listedUnit: a positive price';
  return null;
}

const sameOrder = (a: CreateOrderInput, b: CreateOrderInput) => a.amount === b.amount && a.shipTo === b.shipTo && a.item.qty === b.item.qty && JSON.stringify(a.address) === JSON.stringify(b.address);

export function registerCheckout(app: FastifyInstance, opts: CheckoutOptions) {
  const rulebooks = opts.rulebooks ?? frozenRulebooks();
  const fallback = ['frozen-v3', 'frozen-v2', 'frozen-v1'].find((k) => rulebooks[k]) ?? 'tuned';
  const sessions = new Map<string, { session: CheckoutSession; owner: string; rulebook: string }>();
  const limit = opts.perMinute ?? 60;
  let windowStart = 0, used = 0;

  // the journal is the checkout's memory, keys or no keys: history and mandates live in it
  let opened: PaymentJournal | undefined, source: HistorySource | undefined;
  const journal = () => (opened ??= new PaymentJournal(opts.journalPath));
  const history = () => (source ??= opts.history ?? new JournalHistory(journal()));

  // one run id for the life of the journal: idempotency keys and invoice ids must survive a restart
  const runFile = `${opts.journalPath}.run`;
  let lazy: { worker: PaymentWorker; rails: SandboxRails } | null | undefined;
  const payments = () => {
    if (lazy !== undefined) return lazy;
    const rails = opts.rails();
    if (!rails) return (lazy = null);
    journal();
    if (!existsSync(runFile)) writeFileSync(runFile, `c${randomBytes(6).toString('hex')}\n`);
    rails.runId = readFileSync(runFile, 'utf8').trim();
    return (lazy = { worker: new PaymentWorker(rails, journal()), rails });
  };

  /** Finishes whatever a previous process left open. Call once at startup. */
  const recover = async (): Promise<PayRecord[]> => {
    const p = payments();
    return p ? p.worker.recover() : [];
  };

  const view = (r: PayRecord | null | undefined) => r && {
    key: r.key, state: r.state, intent: r.input.intent, amount: r.input.amount, orderId: r.orderId, captureId: r.captureId, authorizationId: r.authorizationId,
    recovered: r.recovered, reason: r.reason, delivered: !!r.delivered, disputed: !!r.disputed, credited: !!r.credited,
  };

  /** A session's memory comes from the journal, so a restart or an eviction cannot refill a spent mandate. */
  const sessionFor = (id: string, owner: Owner, ownerId: string, name: string, listedUnit?: number) => {
    const live = sessions.get(id);
    if (live) return live;
    const past = journal().all().filter((r) => r.context?.session === id);
    const stored = past[0]?.context;
    if (stored && (stored.owner !== ownerId || stored.rulebook !== name)) return null;
    if (sessions.size >= 500) sessions.delete(sessions.keys().next().value!);
    const entry = { session: new CheckoutSession(rulebooks[name], { owner, listedUnit, agentId: `agent-${id}` }), owner: ownerId, rulebook: name };
    // anything not proven to have given the money back still counts, an unresolved payment included
    for (const r of past) if (r.state !== 'declined' && r.state !== 'voided') entry.session.created(r.key, { amount: r.input.amount, qty: r.input.item.qty, category: owner.category, shipTo: r.input.shipTo });
    sessions.set(id, entry);
    return entry;
  };

  /** Gives a mandate back once money provably did not move. */
  const giveBack = (r: PayRecord) => {
    if ((r.state === 'declined' || r.state === 'voided') && r.context) sessions.get(r.context.session)?.session.release(r.key);
  };

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
    const merchant = (b.merchant as string | undefined) ?? UNKNOWN_STORE, agent = (b.agent as string | undefined) ?? `agent-${sessionId}`;

    // a key is bound to the decision that spent it: a retry cannot borrow another rulebook's name
    const known = journal().get(key);
    const was = known?.context;
    if (known && (!was || was.session !== sessionId || was.owner !== ownerId || was.rulebook !== name))
      return reply.code(409).send({ error: 'this key was decided under another session, owner or rulebook', original: was && { rulebook: was.rulebook, policy: was.policy, decision: was.decision } });

    const entry = sessionFor(sessionId, owner, ownerId, name, b.listedUnit as number | undefined);
    if (!entry || entry.owner !== ownerId || entry.rulebook !== name) return reply.code(409).send({ error: 'this session belongs to another owner or rulebook' });

    const p = payments();
    // a retry of a finished key is answered from the journal: the gate already decided, and PayPal hears nothing
    if (known) {
      const asked = input(key, agent, merchant, entry.session.checkOrderShape(b.args!), known.input.intent === 'AUTHORIZE', canonicalAddress(b.args!.shippingAddress, entry.session.scope));
      if (!sameOrder(known.input, asked)) return reply.code(409).send({ error: 'this key already paid for a different order' });
      if (!p) return reply.code(503).send({ error: 'PayPal keys are not configured' });
      const r = await p.worker.pay(key, known.input);
      return { decision: was!.decision, ok: true, replay: true, decidedAt: was!.decidedAt, rulebook: was!.rulebook, policy: was!.policy, evaluator: was!.evaluator, escrow: was!.escrow, history: was!.facts, payment: view(r), rail: rail(p.rails) };
    }

    const facts = { merchant: history().merchant(merchant), agent: history().agent(agent) };
    const v: Verdict = entry.session.checkOrder(b.args!, facts);
    const head = { decision: v.decision, ok: v.ok, reason: v.reason, rulebook: name, policy: v.policy, evaluator: v.evaluator, hits: v.hits, escrow: v.escrow, history: facts, order: v.order && { amount: v.order.amount, qty: v.order.qty, shipTo: v.order.shipTo } };
    if (!v.ok) return { ...head, payment: null, rail: 'not sent: the gate stopped it' };
    if (!p) return { ...head, payment: null, rail: 'none: PayPal keys are not configured, so the gate ran and nothing was paid' };

    // reserved before the first await, so two calls in the same moment cannot both spend the same mandate.
    // pay() journals synchronously, so the store's exposure is on record before the next call is judged too.
    entry.session.created(key, v.order!);
    const context: DecisionContext = { session: sessionId, owner: ownerId, rulebook: name, policy: v.policy, evaluator: v.evaluator, decision: v.decision, escrow: v.escrow, merchant, agent, decidedAt: new Date().toISOString(), facts };
    const r = await p.worker.pay(key, input(key, agent, merchant, v.order!, v.escrow, canonicalAddress(b.args!.shippingAddress, entry.session.scope)), context);
    giveBack(r);
    return { ...head, payment: view(r), rail: rail(p.rails) };
  });

  app.get<{ Params: { key: string } }>('/api/payments/:key', async (req, reply) => {
    const r = journal().get(req.params.key);
    if (!r) return reply.code(404).send({ error: 'no such payment' });
    const c = r.context;
    return { ...view(r), decision: c && { rulebook: c.rulebook, policy: c.policy, evaluator: c.evaluator, decision: c.decision, escrow: c.escrow, merchant: c.merchant, decidedAt: c.decidedAt, facts: c.facts } };
  });

  app.get<{ Params: { id: string } }>('/api/history/merchants/:id', async (req) => history().merchant(req.params.id));

  /** The adapter's way in: a carrier feed, a complaint desk and a clock. In this lab a script plays all three. */
  app.post<{ Body: HistoryEvent }>('/api/history/events', async (req, reply) => {
    if (!opts.labToken) return reply.code(503).send({ error: 'history events are not configured' });
    if (!sameToken(req.headers.authorization, opts.labToken)) return reply.code(401).send({ error: 'history events need the lab token' });
    const e = req.body ?? ({} as HistoryEvent);

    if (e.type === 'import-merchant' || e.type === 'import-agent') {
      const kind = e.type === 'import-merchant' ? 'merchant' : 'agent';
      if (typeof e.id !== 'string' || !ID.test(e.id) || typeof e.source !== 'string' || !e.source.trim()) return reply.code(400).send({ error: 'an import needs an id and says where the record came from' });
      for (const k of ['age', 'orders', 'refunds', 'deliveries', 'fulfilled', 'independent', 'exposure'] as const) if (e[k] != null && !(typeof e[k] === 'number' && e[k]! >= 0)) return reply.code(400).send({ error: `${k}: a number, zero or more` });
      journal().addImport({ kind, id: e.id, at: new Date().toISOString(), source: e.source, age: e.age ?? 0, orders: e.orders ?? 0, refunds: e.refunds ?? 0, verified: !!e.verified, deliveries: e.deliveries, fulfilled: e.fulfilled, independent: e.independent, exposure: e.exposure });
      return { imported: kind, id: e.id, view: kind === 'merchant' ? history().merchant(e.id) : history().agent(e.id) };
    }

    if (e.type !== 'delivered' && e.type !== 'complaint' && e.type !== 'window-closed') return reply.code(400).send({ error: 'type: delivered, complaint, window-closed, import-merchant or import-agent' });
    const r0 = typeof e.key === 'string' ? journal().get(e.key) : undefined;
    if (!r0?.context) return reply.code(404).send({ error: 'no such payment' });
    const key = r0.key, c = r0.context, policy = rulebooks[c.rulebook];
    if (!policy) return reply.code(409).send({ error: `rulebook ${c.rulebook} is not loaded` });
    const p = payments();
    if (!p) return reply.code(503).send({ error: 'PayPal keys are not configured' });

    if (e.type === 'complaint') { if (!r0.disputed) journal().put(key, { state: r0.state, disputed: true }); return { steps: [], payment: view(journal().get(key)), merchant: history().merchant(c.merchant) }; }
    if (e.type === 'delivered' && !r0.delivered) journal().put(key, { state: r0.state, delivered: true });

    const now = journal().get(key)!;
    const held = now.state === 'held';
    if (!held && now.state !== 'captured') return { steps: [], payment: view(now), merchant: history().merchant(c.merchant) }; // nothing was paid, so nothing can earn
    const steps = settlement(policy, e.type, { held, delivered: !!now.delivered, disputed: !!now.disputed, credited: !!now.credited });
    for (const step of steps) {
      if (step === 'release') await p.worker.release(key);
      if (step === 'void') giveBack(await p.worker.void(key));
      const r = journal().get(key)!;
      if (step === 'credit' && r.state === 'captured') journal().put(key, { state: r.state, credited: true, independent: history().independent(c.agent, c.merchant) });
    }
    return { steps, payment: view(journal().get(key)), merchant: history().merchant(c.merchant) };
  });

  app.post('/webhooks/paypal', async (req, reply) => {
    const p = payments();
    if (!p || !opts.webhookId) return reply.code(503).send({ error: 'webhooks are not configured' });
    const event = req.body as Parameters<PaymentWorker['applyEvent']>[0];
    if (!event?.id || !event.event_type || !event.resource) return reply.code(400).send({ error: 'not a webhook event' });
    if (!await p.rails.verifyWebhook(req.headers, event, opts.webhookId)) return reply.code(401).send({ error: 'signature did not verify' });
    const result = p.worker.applyEvent(event);
    for (const r of journal().all()) giveBack(r);
    return { result };
  });

  return { recover };
}

const rail = (r: SandboxRails) => (r.isSandbox ? 'paypal-sandbox' : 'contract-mock');

function sameToken(header: string | undefined, token: string) {
  const a = createHash('sha256').update(header ?? '').digest(), b = createHash('sha256').update(`Bearer ${token}`).digest();
  return timingSafeEqual(a, b);
}

function input(key: string, agent: string, merchant: string, o: { amount: number; qty: number; shipTo: string }, hold: boolean, address: PostalAddress | undefined): CreateOrderInput {
  return {
    intent: hold ? 'AUTHORIZE' : 'CAPTURE', amount: o.amount, currency: 'USD', payeeMerchantId: merchant, payerId: agent, card: { last4: '1111', state: 'ok', holder: agent },
    item: { name: 'Agent checkout order', sku: 'CHECKOUT', unit: o.amount / o.qty, qty: o.qty }, shipTo: o.shipTo, address, customId: key,
  };
}
