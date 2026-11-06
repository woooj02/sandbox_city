/**
 * Durable payments: an order is paid exactly once, across crashes and lost responses, and a hold stays a hold.
 *
 * The one rule: the call that moves money only ever acts on a resource we already know by id, and its intent is on
 * disk before it leaves. Creating an order moves no money, so losing that response costs nothing. Capture is
 * journaled first, so after a crash the worker reads the order back by id and sees what really happened. It never
 * re-sends a capture it cannot account for, and it does not lean on how long PayPal keeps a PayPal-Request-Id
 * (PayPal documents that only as "a period of time").
 *
 *   recorded -> created -> approved -> capturing -> captured -> refunded
 *                                  |            \-> pending -> captured
 *                                  \-> authorizing -> held -> releasing -> captured
 *                                                         \-> voiding -> voided
 *   declined and unresolved can follow any step. Unresolved means a person looks at it.
 *
 * Only a COMPLETED capture of the right amount is `captured`. What the worker cannot prove it reports as unresolved.
 * It never invents a success. The journal also holds the decision behind each payment and what happened to the goods,
 * so a payment, its receipt and the store's record cannot disagree after a crash.
 */
import { closeSync, existsSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { RailsError, sentQty, type CreateOrderInput, type PostalAddress } from '@sandbox-city/core';
import type { AgentView, MerchantView } from '@sandbox-city/core';

export type PayState = 'recorded' | 'created' | 'approved' | 'authorizing' | 'held' | 'capturing' | 'releasing' | 'voiding' | 'pending' | 'captured' | 'refunded' | 'declined' | 'voided' | 'unresolved';
const RANK: Record<PayState, number> = { recorded: 0, created: 1, approved: 2, authorizing: 3, held: 4, capturing: 5, releasing: 5, voiding: 5, pending: 6, captured: 7, refunded: 8, declined: 9, voided: 9, unresolved: 9 };
/** States that wait for something outside the worker. A restart leaves them alone. */
const RESTING = new Set<PayState>(['held', 'captured', 'refunded', 'declined', 'voided', 'unresolved']);
/** A call may have landed, so an error here is settled by reading back, never by giving up. */
const IN_FLIGHT = new Set<PayState>(['capturing', 'releasing', 'voiding', 'pending', 'authorizing']);

const cents = (n?: number) => (n == null ? null : Math.round(n * 100));

/** What was decided, by what, and from which facts. A retry answers with this, whatever the caller asks for now. */
export interface DecisionContext {
  session: string; owner: string; rulebook: string; policy: string; evaluator: string;
  decision: string; escrow: boolean; merchant: string; agent: string; decidedAt: string;
  /** The history the evaluator saw. */
  facts: { merchant: MerchantView; agent: AgentView };
}

export interface PayRecord {
  key: string; state: PayState; input: CreateOrderInput;
  orderId?: string; captureId?: string; authorizationId?: string; refundId?: string;
  /** Dollars refunded so far, and the refunds counted, so a repeated event cannot count twice. */
  refunded?: number; refundIds?: string[];
  /** Set when a restart resolved this payment by reading it back. */
  recovered?: boolean;
  context?: DecisionContext;
  /** What happened to the goods. A carrier scan, a complaint, and whether the delivery earned the store a record. */
  delivered?: boolean; disputed?: boolean; credited?: boolean; independent?: boolean;
  reason?: string; at: string;
}

/** A store's or agent's record brought in from elsewhere, stated as such. */
export interface ImportedRecord {
  kind: 'merchant' | 'agent'; id: string; at: string; source: string;
  age: number; orders: number; refunds: number; verified?: boolean; deliveries?: number; fulfilled?: number; independent?: number;
  /** Money already paid and not delivered when the record was taken. It stays counted until someone proves otherwise. */
  exposure?: number;
}

export interface OrderReadBack {
  status: string; captureCount?: number; orderAmount?: number; currency?: string; qty?: number; address?: Partial<PostalAddress>;
  captureId?: string; captureStatus?: string; amount?: number; customId?: string; authorizationId?: string; authorizationStatus?: string;
}

/** The PayPal calls the worker needs. SandboxRails implements them; tests run them against the contract mock. */
export interface PaymentApi {
  createPending(input: CreateOrderInput, requestId: string): Promise<{ orderId: string }>;
  confirmSource(orderId: string, requestId: string): Promise<{ status: string }>;
  captureOrder(orderId: string, requestId: string): Promise<{ captureId?: string; status: string; amount?: number }>;
  readOrder(orderId: string): Promise<OrderReadBack | null>;
  authorizeOrder?(orderId: string, requestId: string): Promise<{ authorizationId?: string; status: string }>;
  captureAuthorization?(authId: string, requestId: string): Promise<{ captureId?: string; status: string; amount?: number }>;
  voidAuthorization?(authId: string, requestId: string): Promise<{ status: string }>;
}

/**
 * An append-only log, synced to disk before a write returns. A crash can tear the last line, so opening the file cuts
 * it back to the last whole record first: otherwise the next write would join the torn line and be lost with it.
 */
export class PaymentJournal {
  private records = new Map<string, PayRecord>();
  private seenEvents = new Set<string>();
  private imports = new Map<string, ImportedRecord>();
  private fd: number;

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) this.load();
    this.fd = openSync(path, 'a');
  }

  private load() {
    const raw = readFileSync(this.path);
    const end = raw.lastIndexOf(0x0a) + 1;
    if (end < raw.length) {
      const fd = openSync(this.path, 'r+');
      ftruncateSync(fd, end);
      fsyncSync(fd);
      closeSync(fd);
    }
    for (const line of raw.subarray(0, end).toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      let entry: { event?: string; import?: ImportedRecord; eventId?: string } & Partial<PayRecord>;
      try { entry = JSON.parse(line); } catch { continue; } // written by an older version that joined lines
      if (entry.event) { this.seenEvents.add(entry.event); continue; }
      if (entry.import) { this.imports.set(`${entry.import.kind}:${entry.import.id}`, entry.import); continue; }
      const { eventId, ...change } = entry;
      if (eventId) this.seenEvents.add(eventId);
      const prev = this.records.get(entry.key!);
      this.records.set(entry.key!, { ...prev, ...change } as PayRecord);
    }
  }

  get(key: string) { return this.records.get(key); }
  all() { return [...this.records.values()]; }
  byCapture(captureId: string) { return this.all().find((r) => r.captureId === captureId); }
  byAuthorization(id: string) { return this.all().find((r) => r.authorizationId === id); }
  sawEvent(id: string) { return this.seenEvents.has(id); }
  imported(kind: ImportedRecord['kind'], id: string) { return this.imports.get(`${kind}:${id}`); }

  private write(line: string) { writeSync(this.fd, line + '\n'); fsyncSync(this.fd); }

  /** With `eventId`, the event and its effect are one line, so a crash leaves both or neither. */
  put(key: string, change: Partial<PayRecord> & { state: PayState }, eventId?: string): PayRecord {
    const next = { ...this.records.get(key), ...change, key, at: new Date().toISOString() } as PayRecord;
    this.write(JSON.stringify(eventId ? { ...next, eventId } : next));
    this.records.set(key, next);
    if (eventId) this.seenEvents.add(eventId);
    return next;
  }

  addImport(record: ImportedRecord) { this.write(JSON.stringify({ import: record })); this.imports.set(`${record.kind}:${record.id}`, record); }
  markEvent(id: string) { this.write(JSON.stringify({ event: id })); this.seenEvents.add(id); }
  close() { closeSync(this.fd); }
}

export interface WorkerOptions {
  /** Called at each step; a crash test kills the process from here. */
  fault?: (point: 'before-capture' | 'after-capture-response') => void;
  attempts?: number;
}

const same = (a?: string, b?: string) => (a ?? '').trim().toUpperCase() === (b ?? '').trim().toUpperCase();

/** How the order PayPal holds differs from the order the gate allowed, or null if it does not. */
function disagreement(held: OrderReadBack, input: CreateOrderInput): string | null {
  if (cents(held.orderAmount) !== cents(input.amount)) return `order reads back at $${held.orderAmount}, the gate allowed $${input.amount}`;
  if (held.currency && held.currency !== input.currency) return `order reads back in ${held.currency}, the gate allowed ${input.currency}`;
  if (held.qty != null && held.qty !== sentQty(input)) return `order reads back with ${held.qty} units, the gate allowed ${sentQty(input)}`;
  if (held.customId && !held.customId.endsWith(`:${input.customId}`)) return `order reads back as ${held.customId}, not ${input.customId}`;
  if (input.address) {
    for (const k of ['address_line_1', 'address_line_2', 'admin_area_2', 'admin_area_1', 'postal_code', 'country_code'] as const)
      if (!same(held.address?.[k], input.address[k])) return `order reads back with ${k} "${held.address?.[k] ?? ''}", the gate allowed "${input.address[k] ?? ''}"`;
  }
  return null;
}

export class PaymentWorker {
  private inflight = new Map<string, Promise<PayRecord>>();

  constructor(private api: PaymentApi, readonly journal: PaymentJournal, private opts: WorkerOptions = {}) {}

  /** One job per key at a time: concurrent calls get the same answer. */
  private once(key: string, work: () => Promise<PayRecord>): Promise<PayRecord> {
    const running = this.inflight.get(key);
    if (running) return running;
    const job = work().finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  /** Pays this key once, or holds it if the input says AUTHORIZE. Concurrent calls and repeats return the same payment. */
  pay(key: string, input: CreateOrderInput, context?: DecisionContext): Promise<PayRecord> {
    return this.once(key, async () => {
      const known = this.journal.get(key);
      if (known && RESTING.has(known.state)) return known;
      return this.advance(known ?? this.journal.put(key, { state: 'recorded', input, context }));
    });
  }

  /** The goods arrived and the window closed: capture the held money. */
  release(key: string): Promise<PayRecord> { return this.settle(key, 'releasing'); }

  /** Nobody delivered, or the buyer complained: give the hold back. No money moved. */
  void(key: string): Promise<PayRecord> { return this.settle(key, 'voiding'); }

  private settle(key: string, state: 'releasing' | 'voiding') {
    return this.once(key, async () => {
      const r = this.journal.get(key);
      if (!r) throw new Error(`no payment ${key}`);
      if (r.state !== 'held') return r;
      return this.advance(this.journal.put(key, { state }));
    });
  }

  /** After a restart: every payment that was not finished, carried to a state we can prove. */
  async recover(): Promise<PayRecord[]> {
    const open = this.journal.all().filter((r) => !RESTING.has(r.state));
    const done: PayRecord[] = [];
    for (const r of open) done.push(await this.once(r.key, () => this.advance(r)));
    return done;
  }

  private unresolved(r: PayRecord, reason: string) { return this.journal.put(r.key, { state: 'unresolved', reason }); }

  private async advance(start: PayRecord): Promise<PayRecord> {
    let r = start;
    const tries = this.opts.attempts ?? 4;
    for (let attempt = 0; attempt < tries * 4; attempt++) {
      try {
        switch (r.state) {
          case 'recorded': {
            const { orderId } = await this.api.createPending(r.input, `${r.key}-create`);
            r = this.journal.put(r.key, { state: 'created', orderId });
            break;
          }
          case 'created': {
            const { status } = await this.api.confirmSource(r.orderId!, `${r.key}-confirm`);
            r = this.journal.put(r.key, status === 'APPROVED' ? { state: 'approved' } : { state: 'declined', reason: `payment source ${status}` });
            break;
          }
          case 'approved': {
            // the last look before money moves: the order PayPal holds must be the order the gate allowed
            const held = await this.api.readOrder(r.orderId!);
            if (!held) throw new RailsError(503, 'READ_BACK_FAILED', false);
            const differs = disagreement(held, r.input);
            if (differs) return this.unresolved(r, differs);
            if (r.input.intent === 'AUTHORIZE') { r = this.journal.put(r.key, { state: 'authorizing' }); break; }
            r = this.journal.put(r.key, { state: 'capturing' });
            this.opts.fault?.('before-capture');
            const res = await this.api.captureOrder(r.orderId!, `${r.key}-capture`);
            this.opts.fault?.('after-capture-response');
            r = this.afterCapture(r, res);
            break;
          }
          case 'authorizing': r = await this.resolveAuthorization(r); break;
          case 'capturing': case 'pending': {
            const before = r.state;
            r = await this.resolveCapture(r);
            if (before === 'pending' && r.state === 'pending') return r; // PayPal has not finished; a webhook or a later read will
            break;
          }
          case 'releasing': r = await this.resolveRelease(r); break;
          case 'voiding': r = await this.resolveVoid(r); break;
          default: return r;
        }
      } catch (e) {
        // anything but a rail error is ours: stop here, the journal already says where to resume
        if (!(e instanceof RailsError)) throw e;
        const err = e;
        // a refused request changed nothing we can build on; a lost one is resolved by reading back on the next pass
        if (err.status >= 400 && err.status < 500 && err.status !== 429 && !IN_FLIGHT.has(r.state)) return this.unresolved(r, `${err.status} ${err.issue}`);
      }
      if (RESTING.has(r.state)) return r;
    }
    return this.unresolved(r, 'ran out of attempts before PayPal could confirm the outcome');
  }

  /** What a capture answer means. Only COMPLETED, with an id and the right amount, is money that moved. */
  private afterCapture(r: PayRecord, res: { captureId?: string; status: string; amount?: number }): PayRecord {
    if (res.status === 'COMPLETED' && res.captureId) {
      if (res.amount != null && cents(res.amount) !== cents(r.input.amount)) return this.unresolved(r, `capture reads $${res.amount}, expected $${r.input.amount}`);
      return this.journal.put(r.key, { state: 'captured', captureId: res.captureId });
    }
    if (res.status === 'PENDING') return this.journal.put(r.key, { state: 'pending', captureId: res.captureId });
    if (res.status === 'DECLINED' || res.status === 'FAILED') return this.journal.put(r.key, { state: 'declined', reason: `capture ${res.status}` });
    return r; // stays in flight: the next pass reads the order back
  }

  /** We may or may not have captured. Ask PayPal about this order, by id, and believe only that. */
  private async resolveCapture(r: PayRecord): Promise<PayRecord> {
    const order = await this.api.readOrder(r.orderId!);
    if (!order) throw new RailsError(503, 'READ_BACK_FAILED', false);
    if (order.captureId) return this.fromCapture(r, order);
    if (order.status === 'APPROVED' && r.state === 'capturing') return this.journal.put(r.key, { state: 'approved' }); // the capture never landed; safe to send
    return this.unresolved(r, `order is ${order.status} with no capture`);
  }

  private fromCapture(r: PayRecord, order: OrderReadBack): PayRecord {
    if (cents(order.amount) !== cents(r.input.amount)) return this.unresolved(r, `order reads back at $${order.amount}, expected $${r.input.amount}`);
    const recovered = r.state === 'pending' ? {} : { recovered: true };
    switch (order.captureStatus) {
      case 'COMPLETED': return this.journal.put(r.key, { state: 'captured', captureId: order.captureId, ...recovered });
      case 'PENDING': return r.state === 'pending' ? r : this.journal.put(r.key, { state: 'pending', captureId: order.captureId, ...recovered });
      case 'DECLINED': case 'FAILED': return this.journal.put(r.key, { state: 'declined', captureId: order.captureId, reason: `capture ${order.captureStatus}` });
      case 'REFUNDED': return this.journal.put(r.key, { state: 'refunded', captureId: order.captureId });
      default: return this.unresolved(r, `capture ${order.captureId} is ${order.captureStatus ?? 'of unknown status'}`);
    }
  }

  /** The authorization may already exist. Read first, so a retry after a crash cannot make a second hold. */
  private async resolveAuthorization(r: PayRecord): Promise<PayRecord> {
    const order = await this.api.readOrder(r.orderId!);
    if (!order) throw new RailsError(503, 'READ_BACK_FAILED', false);
    if (order.authorizationId) return this.fromAuthorization(r, order.authorizationId, order.authorizationStatus);
    if (order.status !== 'APPROVED') return this.unresolved(r, `order is ${order.status} with no authorization`);
    const a = await this.api.authorizeOrder!(r.orderId!, `${r.key}-authorize`);
    return a.authorizationId ? this.fromAuthorization(r, a.authorizationId, a.status) : r;
  }

  private fromAuthorization(r: PayRecord, authorizationId: string, status?: string) {
    if (status === 'CREATED' || status === 'PENDING') return this.journal.put(r.key, { state: 'held', authorizationId });
    if (status === 'DENIED') return this.journal.put(r.key, { state: 'declined', authorizationId, reason: 'authorization denied' });
    return this.unresolved(r, `authorization ${authorizationId} is ${status ?? 'of unknown status'}`);
  }

  private async resolveRelease(r: PayRecord): Promise<PayRecord> {
    const order = await this.api.readOrder(r.orderId!);
    if (!order) throw new RailsError(503, 'READ_BACK_FAILED', false);
    if (order.captureId) return this.fromCapture(r, order);
    if (order.authorizationStatus === 'VOIDED') return this.journal.put(r.key, { state: 'voided' });
    if (order.authorizationStatus !== 'CREATED' && order.authorizationStatus !== 'PENDING') return this.unresolved(r, `authorization is ${order.authorizationStatus} with no capture`);
    this.opts.fault?.('before-capture');
    const res = await this.api.captureAuthorization!(r.authorizationId!, `${r.key}-release`);
    this.opts.fault?.('after-capture-response');
    return this.afterCapture(r, res);
  }

  private async resolveVoid(r: PayRecord): Promise<PayRecord> {
    const order = await this.api.readOrder(r.orderId!);
    if (!order) throw new RailsError(503, 'READ_BACK_FAILED', false);
    if (order.authorizationStatus === 'VOIDED') return this.journal.put(r.key, { state: 'voided' });
    if (order.captureId) return this.unresolved(r, `asked to void, but capture ${order.captureId} exists`);
    await this.api.voidAuthorization!(r.authorizationId!, `${r.key}-void`);
    return this.journal.put(r.key, { state: 'voided' });
  }

  /**
   * A verified webhook. Events can repeat and arrive in any order, so one only ever moves a payment forward,
   * and only for a resource this worker already knows.
   */
  applyEvent(e: { id: string; event_type: string; resource: { id?: string; custom_id?: string; status?: string; amount?: { value?: string }; supplementary_data?: { related_ids?: { order_id?: string } }; links?: { href: string; rel: string }[] } }): 'applied' | 'duplicate' | 'stale' | 'unknown' {
    if (this.journal.sawEvent(e.id)) return 'duplicate';
    const to: PayState | null = ({ 'PAYMENT.CAPTURE.COMPLETED': 'captured', 'PAYMENT.CAPTURE.REFUNDED': 'refunded', 'PAYMENT.CAPTURE.DENIED': 'declined', 'PAYMENT.AUTHORIZATION.VOIDED': 'voided' } as Record<string, PayState>)[e.event_type] ?? null;
    const refundOf = e.resource.links?.find((l) => l.rel === 'up')?.href.split('/').pop();
    const orderId = e.resource.supplementary_data?.related_ids?.order_id;
    const r = (e.resource.id && (this.journal.byCapture(e.resource.id) ?? this.journal.byAuthorization(e.resource.id))) || (refundOf && this.journal.byCapture(refundOf)) || this.journal.all().find((x) => orderId && x.orderId === orderId);
    if (!to || !r) return 'unknown';
    // a refund event must say how much: guessing would either erase exposure or invent it. Left unmarked, so it can come again
    if (to === 'refunded' && e.resource.amount?.value == null) return 'unknown';
    const stale = () => { this.journal.markEvent(e.id); return 'stale' as const; };
    if (RANK[to] <= RANK[r.state] && to !== 'declined' && to !== 'voided') return stale();
    if (r.state === 'declined' || r.state === 'unresolved' || r.state === 'voided') return stale();
    if (to === 'declined' && !['pending', 'capturing', 'releasing'].includes(r.state)) return stale();
    if (to === 'voided' && !['held', 'voiding'].includes(r.state)) return stale();
    if (to === 'captured' && e.resource.amount?.value != null && cents(Number(e.resource.amount.value)) !== cents(r.input.amount)) return stale();
    if (to === 'refunded') {
      if (e.resource.id && r.refundIds?.includes(e.resource.id)) return stale();
      const paid = cents(r.input.amount)!, total = Math.min(paid, cents(r.refunded ?? 0)! + cents(Number(e.resource.amount!.value))!);
      const whole = total >= paid;
      this.journal.put(r.key, { state: whole ? 'refunded' : r.state, refunded: total / 100, refundId: e.resource.id, refundIds: [...(r.refundIds ?? []), ...(e.resource.id ? [e.resource.id] : [])] }, e.id);
      return 'applied';
    }
    this.journal.put(r.key, to === 'captured' ? { state: to, captureId: e.resource.id } : { state: to, reason: e.event_type }, e.id);
    return 'applied';
  }
}
