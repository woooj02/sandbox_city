/**
 * Stateless model checking of the payment worker. Instead of testing the crashes someone thought of, this enumerates them.
 *
 * Every journal write and every PayPal call is a choice point: it may crash the process before, during or after the
 * write, lose the request, land the request and lose the answer, return stale data, or deliver a webhook early.
 * `explore` runs a workload once per schedule, for every schedule with up to `maxFaults` faults, then turns faults
 * off, restarts, drains the webhooks and compares the journal with the provider's ledger, which is ground truth.
 *
 * The real PaymentWorker and PaymentJournal run here, on a real file. Only PayPal is a model, so a clean result says
 * this code keeps its promises against this model of PayPal. It does not say PayPal behaves like the model.
 */
import { mkdirSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { RailsError, type CreateOrderInput } from '@sandbox-city/core';
import { PaymentJournal, PaymentWorker, type OrderReadBack, type PaymentApi, type PayRecord } from './payments';

export class Crash extends Error {}

const cents = (n: number) => Math.round(n * 100);

export interface Choice { site: string; options: string[]; pick: number }

/** Replays a sparse script of (position, option) and records every choice point it passes. */
export class Schedule {
  trace: Choice[] = [];
  quiet = false;
  constructor(private script: Map<number, number>) {}
  choose(site: string, options: string[]): string {
    if (this.quiet) return options[0];
    const pick = this.script.get(this.trace.length) ?? 0;
    this.trace.push({ site, options, pick });
    return options[pick];
  }
  faults() { return this.trace.filter((c) => c.pick).map((c) => `${c.site}=${c.options[c.pick]}`); }
}

interface Capture { id: string; status: 'COMPLETED' | 'PENDING' | 'DECLINED' | 'REFUNDED'; amount: number; fate?: string }
interface Order {
  id: string; status: 'CREATED' | 'APPROVED' | 'COMPLETED'; input: CreateOrderInput; amount: number;
  capture?: Capture; auth?: { id: string; status: 'CREATED' | 'VOIDED' | 'CAPTURED' };
  /** What a lagging read returns: the order before its last change. */
  before?: OrderReadBack;
}

type Event = Parameters<PaymentWorker['applyEvent']>[0];

const TRANSPORT = ['ok', 'never-arrived', 'landed-answer-lost', 'rate-limited'];

/** PayPal's rules as the worker relies on them. The ledger is the truth the journal is judged against. */
export class ProviderModel implements PaymentApi {
  orders = new Map<string, Order>();
  queue: Event[] = [];
  delivered: Event[] = [];
  private seen = new Map<string, unknown>();
  private n = 0;
  deliver: (e: Event) => void = () => {};

  constructor(private s: Schedule, private rules: { forgetsRequestIds?: boolean; tamper?: boolean; webhooks?: boolean; outcomes?: boolean; staleReads?: boolean } = {}) {}

  private id(p: string) { return `${p}${++this.n}`; }

  /** A webhook can arrive while the worker is between any two steps. */
  private maybeDeliver(where: string) {
    if (!this.rules.webhooks) return;
    while (this.queue.length && this.s.choose(`webhook@${where}`, ['hold', 'deliver']) === 'deliver') this.flushOne();
  }
  /** An event counts as delivered once the worker has answered it. A crash mid-delivery means PayPal sends it again. */
  flushOne() {
    const e = this.queue.shift();
    if (!e) return;
    try { this.deliver(e); } catch (err) { this.queue.unshift(e); throw err; }
    this.delivered.push(e);
  }

  private async call<T>(name: string, effect: () => T): Promise<T> {
    this.maybeDeliver(`${name}:before`);
    const fault = this.s.choose(`paypal:${name}`, TRANSPORT);
    if (fault === 'never-arrived') throw new RailsError(503, 'SERVICE_UNAVAILABLE');
    if (fault === 'rate-limited') throw new RailsError(429, 'RATE_LIMIT_REACHED');
    const out = effect();
    await Promise.resolve();
    if (fault === 'landed-answer-lost') throw new RailsError(504, 'GATEWAY_TIMEOUT', true);
    this.maybeDeliver(`${name}:after`);
    return out;
  }

  private idem<T>(requestId: string, make: () => T): T {
    if (!this.rules.forgetsRequestIds && this.seen.has(requestId)) return this.seen.get(requestId) as T;
    const v = make();
    this.seen.set(requestId, v);
    return v;
  }

  private order(id: string) { const o = this.orders.get(id); if (!o) throw new RailsError(404, 'INVALID_RESOURCE_ID'); return o; }
  private remember(o: Order) { o.before = this.view(o); }

  private event(type: string, resource: Event['resource']) { this.queue.push({ id: this.id('WH-'), event_type: type, resource }); }
  private captureEvent(o: Order, c: Capture, type: string) {
    this.event(type, { id: c.id, status: c.status, amount: { value: c.amount.toFixed(2) }, supplementary_data: { related_ids: { order_id: o.id } } });
  }

  createPending(input: CreateOrderInput, requestId: string) {
    return this.call('create', () => this.idem(requestId, () => {
      const o: Order = { id: this.id('ORD-'), status: 'CREATED', input, amount: input.amount };
      this.orders.set(o.id, o);
      return { orderId: o.id };
    }));
  }

  confirmSource(orderId: string, requestId: string) {
    return this.call('confirm', () => this.idem(requestId, () => {
      const o = this.order(orderId);
      this.remember(o);
      o.status = 'APPROVED';
      if (this.rules.tamper) o.amount = o.amount + 100;
      return { status: 'APPROVED' };
    }));
  }

  private outcome(site: string): Capture['status'] {
    if (!this.rules.outcomes) return 'COMPLETED';
    return this.s.choose(site, ['COMPLETED', 'PENDING', 'DECLINED']) as Capture['status'];
  }

  private land(o: Order, status: Capture['status']) {
    const c: Capture = { id: this.id('CAP-'), status, amount: o.amount };
    o.capture = c;
    o.status = 'COMPLETED';
    if (status === 'PENDING') c.fate = this.s.choose('paypal:pending-fate', ['completes', 'denied']);
    if (status === 'COMPLETED') this.captureEvent(o, c, 'PAYMENT.CAPTURE.COMPLETED');
    if (status === 'DECLINED') this.captureEvent(o, c, 'PAYMENT.CAPTURE.DENIED');
    return c;
  }

  captureOrder(orderId: string, requestId: string) {
    return this.call('capture', () => this.idem(requestId, () => {
      const o = this.order(orderId);
      if (o.status === 'COMPLETED') throw new RailsError(422, 'ORDER_ALREADY_CAPTURED');
      if (o.status !== 'APPROVED') throw new RailsError(422, 'ORDER_NOT_APPROVED');
      this.remember(o);
      const c = this.land(o, this.outcome('paypal:capture-outcome'));
      return { captureId: c.id, status: c.status, amount: c.amount };
    }));
  }

  private view(o: Order): OrderReadBack {
    return {
      status: o.status, orderAmount: o.amount, currency: o.input.currency, qty: o.input.item.qty, customId: `run:${o.input.customId}`,
      captureCount: o.capture ? 1 : 0, captureId: o.capture?.id, captureStatus: o.capture?.status, amount: o.capture?.amount,
      authorizationId: o.auth?.id, authorizationStatus: o.auth?.status,
    };
  }

  async readOrder(orderId: string) {
    const lag = this.rules.staleReads ? this.s.choose('paypal:read-freshness', ['fresh', 'stale']) : 'fresh';
    const o = await this.call('read', () => this.order(orderId));
    return lag === 'stale' && o.before ? o.before : this.view(o);
  }

  authorizeOrder(orderId: string, requestId: string) {
    return this.call('authorize', () => this.idem(requestId, () => {
      const o = this.order(orderId);
      if (o.auth) throw new RailsError(422, 'ORDER_ALREADY_AUTHORIZED');
      if (o.status !== 'APPROVED') throw new RailsError(422, 'ORDER_NOT_APPROVED');
      this.remember(o);
      o.auth = { id: this.id('AUTH-'), status: 'CREATED' };
      return { authorizationId: o.auth.id, status: 'CREATED' };
    }));
  }

  private byAuth(id: string) { for (const o of this.orders.values()) if (o.auth?.id === id) return o; throw new RailsError(404, 'INVALID_RESOURCE_ID'); }

  captureAuthorization(authId: string, requestId: string) {
    return this.call('capture-hold', () => this.idem(requestId, () => {
      const o = this.byAuth(authId);
      if (o.auth!.status !== 'CREATED') throw new RailsError(422, 'AUTHORIZATION_ALREADY_CAPTURED');
      this.remember(o);
      o.auth!.status = 'CAPTURED';
      const c = this.land(o, this.outcome('paypal:release-outcome'));
      return { captureId: c.id, status: c.status, amount: c.amount };
    }));
  }

  voidAuthorization(authId: string, requestId: string) {
    return this.call('void', () => this.idem(requestId, () => {
      const o = this.byAuth(authId);
      if (o.auth!.status === 'CAPTURED') throw new RailsError(422, 'AUTHORIZATION_ALREADY_CAPTURED');
      if (o.auth!.status === 'VOIDED') throw new RailsError(422, 'AUTHORIZATION_VOIDED');
      this.remember(o);
      o.auth!.status = 'VOIDED';
      this.event('PAYMENT.AUTHORIZATION.VOIDED', { id: authId, status: 'VOIDED' });
      return { status: 'VOIDED' };
    }));
  }

  /** The dashboard or a dispute, outside the worker. */
  refund(key: string) {
    for (const o of this.orders.values()) if (o.input.customId === key && o.capture?.status === 'COMPLETED') {
      o.capture.status = 'REFUNDED';
      this.event('PAYMENT.CAPTURE.REFUNDED', { id: this.id('REF-'), status: 'COMPLETED', amount: { value: o.capture.amount.toFixed(2) }, links: [{ rel: 'up', href: `https://paypal/v2/payments/captures/${o.capture.id}` }] });
      return true;
    }
    return false;
  }

  /** Time passes: a pending capture finishes. */
  settlePending() {
    for (const o of this.orders.values()) if (o.capture?.status === 'PENDING') {
      const denied = o.capture.fate === 'denied';
      o.capture.status = denied ? 'DECLINED' : 'COMPLETED';
      this.captureEvent(o, o.capture, denied ? 'PAYMENT.CAPTURE.DENIED' : 'PAYMENT.CAPTURE.COMPLETED');
    }
  }

  captures(customId: string) { return [...this.orders.values()].filter((o) => o.input.customId === customId && o.capture && o.capture.status !== 'DECLINED'); }
}

export const SAMPLE_INPUT = (intent: CreateOrderInput['intent']): CreateOrderInput => ({
  intent, amount: 42.5, currency: 'USD', payeeMerchantId: 'M1', payerId: 'A1', card: { last4: '1111', state: 'ok', holder: 'A1' },
  item: { name: 'Lamp', sku: 'SKU1', unit: 42.5, qty: 1 }, shipTo: '12 Neon St, Silk Row', customId: 'job',
});

type Op = (w: PaymentWorker, p: ProviderModel, s: Schedule) => Promise<unknown>;
const KEY = 'job';
export interface Workload { name: string; intent: CreateOrderInput['intent']; ops: Op[]; rules: ConstructorParameters<typeof ProviderModel>[1]; expectNoCapture?: boolean }

const pay = (intent: CreateOrderInput['intent']): Op => (w) => w.pay(KEY, SAMPLE_INPUT(intent));

export const WORKLOADS: Workload[] = [
  { name: 'pay', intent: 'CAPTURE', ops: [pay('CAPTURE'), pay('CAPTURE')], rules: { outcomes: true, staleReads: true } },
  { name: 'pay, PayPal forgets request ids', intent: 'CAPTURE', ops: [pay('CAPTURE')], rules: { forgetsRequestIds: true, staleReads: true } },
  { name: 'pay with webhooks in any order', intent: 'CAPTURE', ops: [pay('CAPTURE')], rules: { webhooks: true, outcomes: true } },
  { name: 'pay, then refund mid-flight', intent: 'CAPTURE', ops: [async (w, p, s) => {
    const origin = p.deliver;
    p.deliver = (e) => { origin(e); if (e.event_type === 'PAYMENT.CAPTURE.COMPLETED' && s.choose('dashboard:refund', ['later', 'now']) === 'now') p.refund(KEY); };
    return w.pay(KEY, SAMPLE_INPUT('CAPTURE'));
  }, async (_w, p) => { p.refund(KEY); }, async (_w, p) => { while (p.queue.length) p.flushOne(); }], rules: { webhooks: true } },
  { name: 'hold, then release', intent: 'AUTHORIZE', ops: [pay('AUTHORIZE'), (w) => w.release(KEY)], rules: { outcomes: true, staleReads: true } },
  { name: 'hold, then void', intent: 'AUTHORIZE', ops: [pay('AUTHORIZE'), (w) => w.void(KEY)], rules: { staleReads: true } },
  { name: 'hold, release and void race', intent: 'AUTHORIZE', ops: [pay('AUTHORIZE'), (w) => Promise.all([w.release(KEY), w.void(KEY)])], rules: { webhooks: true } },
  { name: 'hold, void and release race', intent: 'AUTHORIZE', ops: [pay('AUTHORIZE'), (w) => Promise.all([w.void(KEY), w.release(KEY)])], rules: { webhooks: true } },
  { name: 'order changed at PayPal', intent: 'CAPTURE', ops: [pay('CAPTURE')], rules: { tamper: true }, expectNoCapture: true },
];

/** Promises the worker makes. Each returns what went wrong, or null. */
export function checkInvariants(r: PayRecord | undefined, p: ProviderModel, w: Workload): string[] {
  const bad: string[] = [];
  const moved = p.captures(KEY);
  const c = moved[0]?.capture;
  const state = r?.state;
  if (moved.length > 1) bad.push(`charged twice: ${moved.length} captures for one key`);
  if (w.expectNoCapture && moved.length) bad.push('captured an order that differs from the one the gate allowed');
  if (w.expectNoCapture && state !== 'unresolved') bad.push(`a changed order ended ${state}, not unresolved`);
  if (state === 'captured' && !(c && c.status === 'COMPLETED' && c.id === r!.captureId)) bad.push(`journal says captured, the ledger has ${c ? `${c.id} ${c.status}` : 'no capture'}`);
  if (state === 'captured' && c && cents(c.amount) !== cents(r!.input.amount)) bad.push('journal says captured at a different amount');
  if (state === 'refunded' && !(c && c.status === 'REFUNDED')) bad.push(`journal says refunded, the ledger has ${c?.status ?? 'no capture'}`);
  if (c?.status === 'REFUNDED' && state !== 'refunded' && state !== 'unresolved') bad.push(`money came back but the journal says ${state}`);
  if (c?.status === 'COMPLETED' && state !== 'captured' && state !== 'unresolved') bad.push(`money moved but the journal says ${state}`);
  if (state === 'voided' && moved.length) bad.push('journal says voided, the ledger has a capture');
  if (state === 'voided' && ![...p.orders.values()].some((o) => o.auth?.status === 'VOIDED')) bad.push('journal says voided, the ledger shows no void');
  if (state === 'held' && moved.length) bad.push('journal says held, the ledger has a capture');
  if (state === 'held' && ![...p.orders.values()].some((o) => o.auth?.status === 'CREATED')) bad.push('journal says held, the ledger shows no live hold');
  if (r && !['captured', 'refunded', 'declined', 'voided', 'held', 'unresolved'].includes(r.state)) bad.push(`never settled: still ${r.state}`);
  return bad;
}

export interface RunResult { schedule: Schedule; violations: string[]; final?: string; unresolved: boolean; crashes: number; reason?: string }
export type WorkerClass = new (api: PaymentApi, journal: PaymentJournal) => PaymentWorker;
export type JournalClass = new (path: string, tap?: (line: string, fd: number) => void) => PaymentJournal;

export async function runSchedule(w: Workload, script: Map<number, number>, dir: string, Worker: WorkerClass = PaymentWorker, Journal: JournalClass = PaymentJournal): Promise<RunResult> {
  const s = new Schedule(script), p = new ProviderModel(s, w.rules);
  const file = join(dir, 'journal.log');
  rmSync(file, { force: true });
  const tap = (line: string, fd: number) => {
    const entry = JSON.parse(line) as { state?: string; event?: string };
    const fault = s.choose(`journal:${entry.state ?? 'event'}`, ['ok', 'crash-before-write', 'crash-torn-write', 'crash-after-write']);
    if (fault === 'crash-before-write') throw new Crash();
    if (fault === 'crash-torn-write') { writeSync(fd, line.slice(0, line.length >> 1)); throw new Crash(); }
    if (fault === 'crash-after-write') { writeSync(fd, line + '\n'); throw new Crash(); }
  };
  let journal = new Journal(file, tap), worker = new Worker(p, journal), crashes = 0;
  p.deliver = (e) => { worker.applyEvent(e); };
  const restart = () => { journal.close(); journal = new Journal(file, tap); worker = new Worker(p, journal); crashes++; };
  const violations: string[] = [];
  let pc = 0, recovering = false;
  for (let guard = 0; pc < w.ops.length && guard < 40; guard++) {
    try {
      if (recovering) { await worker.recover(); recovering = false; }
      await w.ops[pc](worker, p, s);
      pc++;
    } catch (e) {
      if (e instanceof Crash) { restart(); recovering = true; continue; }
      if (e instanceof RailsError) { pc++; continue; }
      violations.push(`worker threw: ${(e as Error).message}`);
      break;
    }
  }
  // faults off: the process restarts, time passes, and PayPal delivers what it has not delivered. Acknowledged events
  // do not come back here, so a journal that lost one is caught. Then every event repeats, and nothing may change.
  s.quiet = true;
  const settle = async (repeat: boolean) => {
    for (let round = 0; round < 3; round++) {
      journal.close(); journal = new Journal(file, tap); worker = new Worker(p, journal);
      try {
        await worker.recover();
        p.settlePending();
        while (p.queue.length) p.flushOne();
        if (repeat) for (const e of [...p.delivered]) worker.applyEvent(e);
        await worker.recover();
      } catch (e) { violations.push(`recovery threw: ${(e as Error).message}`); }
    }
  };
  await settle(false);
  violations.push(...checkInvariants(journal.get(KEY), p, w));
  await settle(true);
  const final = journal.get(KEY);
  journal.close();
  violations.push(...checkInvariants(final, p, w).map((v) => `after repeats: ${v}`));
  return { schedule: s, violations, final: final?.state, unresolved: final?.state === 'unresolved', crashes, reason: final?.reason };
}

export interface WorkloadReport {
  workload: string; schedules: number; choicePoints: number; maxFaults: number; violating: number; unresolved: number; crashes: number;
  outcomes: Record<string, number>; reasons: Record<string, number>; firstViolation?: { faults: string[]; violations: string[] };
}

/** Every schedule with up to maxFaults faults, fewest faults first, so the first counterexample is a smallest one. */
export async function explore(w: Workload, maxFaults: number, dir: string, opts: { Worker?: WorkerClass; Journal?: JournalClass; stopAtFirst?: boolean } = {}): Promise<WorkloadReport> {
  mkdirSync(dir, { recursive: true });
  let level: [number, number][][] = [[]];
  const report: WorkloadReport = { workload: w.name, schedules: 0, choicePoints: 0, maxFaults, violating: 0, unresolved: 0, crashes: 0, outcomes: {}, reasons: {} };
  for (let depth = 0; depth <= maxFaults; depth++) {
    const next: [number, number][][] = [];
    for (const script of level) {
      const r = await runSchedule(w, new Map(script), dir, opts.Worker, opts.Journal);
      report.schedules++;
      report.choicePoints = Math.max(report.choicePoints, r.schedule.trace.length);
      report.crashes += r.crashes;
      if (r.unresolved) { report.unresolved++; const why = (r.reason ?? '?').replace(/[A-Z]+-\d+/g, 'ID'); report.reasons[why] = (report.reasons[why] ?? 0) + 1; }
      report.outcomes[r.final ?? 'none'] = (report.outcomes[r.final ?? 'none'] ?? 0) + 1;
      if (r.violations.length) {
        report.violating++;
        report.firstViolation ??= { faults: r.schedule.faults(), violations: r.violations };
        if (opts.stopAtFirst) return report;
      }
      if (depth === maxFaults) continue;
      const from = script.length ? script[script.length - 1][0] + 1 : 0;
      for (let at = from; at < r.schedule.trace.length; at++)
        for (let alt = 1; alt < r.schedule.trace[at].options.length; alt++) next.push([...script, [at, alt]]);
    }
    level = next;
  }
  return report;
}

/**
 * The same faults against a client with no journal: on any failure it starts again, as a retry button or a queue would.
 * The control for the explorer. Each run reports how many charges one purchase made.
 */
export async function runNaive(script: Map<number, number>) {
  const s = new Schedule(script), p = new ProviderModel(s, {});
  let tries = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    tries++;
    try {
      const rid = `try-${attempt}`, { orderId } = await p.createPending(SAMPLE_INPUT('CAPTURE'), `${rid}-create`);
      await p.confirmSource(orderId, `${rid}-confirm`);
      if (s.choose('client:after-confirm', ['ok', 'crash']) === 'crash') continue;
      await p.captureOrder(orderId, `${rid}-capture`);
      if (s.choose('client:after-capture', ['ok', 'crash']) === 'crash') continue;
      break;
    } catch (e) { if (!(e instanceof RailsError)) throw e; }
  }
  return { schedule: s, charges: p.captures(KEY).length, tries };
}

export async function exploreNaive(maxFaults: number) {
  let level: [number, number][][] = [[]], schedules = 0, doubled = 0, worst = 0, first: string[] | undefined;
  for (let depth = 0; depth <= maxFaults; depth++) {
    const next: [number, number][][] = [];
    for (const script of level) {
      const r = await runNaive(new Map(script));
      schedules++;
      worst = Math.max(worst, r.charges);
      if (r.charges > 1) { doubled++; first ??= r.schedule.faults(); }
      if (depth === maxFaults) continue;
      const from = script.length ? script[script.length - 1][0] + 1 : 0;
      for (let at = from; at < r.schedule.trace.length; at++)
        for (let alt = 1; alt < r.schedule.trace[at].options.length; alt++) next.push([...script, [at, alt]]);
    }
    level = next;
  }
  return { schedules, doubled, worst, first };
}
