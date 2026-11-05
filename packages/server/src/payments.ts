/**
 * Durable payments: an order is paid exactly once, across crashes and lost responses.
 *
 * The one rule: the call that moves money only ever acts on a resource we already know by id, and its intent is on
 * disk before it leaves. Creating an order moves no money, so losing that response costs nothing. Capture is
 * journaled first, so after a crash the worker reads the order back by id and sees what really happened. It never
 * re-sends a capture it cannot account for, and it does not lean on how long PayPal keeps a PayPal-Request-Id
 * (PayPal documents that only as "a period of time").
 *
 *   recorded -> created -> approved -> capturing -> captured -> refunded
 *                                  \-> declined        any -> unresolved (a person looks at it)
 *
 * What the worker cannot prove it reports as unresolved. It never invents a success.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { RailsError, type CreateOrderInput } from '@sandbox-city/core';

export type PayState = 'recorded' | 'created' | 'approved' | 'capturing' | 'captured' | 'refunded' | 'declined' | 'unresolved';
const RANK: Record<PayState, number> = { recorded: 0, created: 1, approved: 2, capturing: 3, captured: 4, refunded: 5, declined: 6, unresolved: 6 };
const TERMINAL = new Set<PayState>(['captured', 'refunded', 'declined', 'unresolved']);

const cents = (n?: number) => (n == null ? null : Math.round(n * 100));

export interface PayRecord {
  key: string; state: PayState; input: CreateOrderInput;
  orderId?: string; captureId?: string; refundId?: string;
  /** Set when a restart resolved this payment by reading it back. */
  recovered?: boolean;
  reason?: string; at: string;
}

/** The PayPal calls the worker needs. SandboxRails implements them; tests run them against the contract mock. */
export interface PaymentApi {
  createPending(input: CreateOrderInput, requestId: string): Promise<{ orderId: string }>;
  confirmSource(orderId: string, requestId: string): Promise<{ status: string }>;
  captureOrder(orderId: string, requestId: string): Promise<{ captureId?: string; status: string; amount?: number }>;
  readOrder(orderId: string): Promise<{ status: string; captureCount?: number; orderAmount?: number; captureId?: string; captureStatus?: string; amount?: number; customId?: string } | null>;
}

/** An append-only log, synced to disk before a write returns. A line torn by a crash is ignored on the way back in. */
export class PaymentJournal {
  private records = new Map<string, PayRecord>();
  private seenEvents = new Set<string>();
  private fd: number;

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) this.load();
    this.fd = openSync(path, 'a');
  }

  private load() {
    for (const line of readFileSync(this.path, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let entry: { event?: string } & Partial<PayRecord>;
      try { entry = JSON.parse(line); } catch { continue; } // the last line of a crash
      if (entry.event) { this.seenEvents.add(entry.event); continue; }
      const prev = this.records.get(entry.key!);
      this.records.set(entry.key!, { ...prev, ...entry } as PayRecord);
    }
  }

  get(key: string) { return this.records.get(key); }
  all() { return [...this.records.values()]; }
  byCapture(captureId: string) { return this.all().find((r) => r.captureId === captureId); }
  sawEvent(id: string) { return this.seenEvents.has(id); }

  private write(line: string) { writeSync(this.fd, line + '\n'); fsyncSync(this.fd); }

  put(key: string, change: Partial<PayRecord> & { state: PayState }): PayRecord {
    const next = { ...this.records.get(key), ...change, key, at: new Date().toISOString() } as PayRecord;
    this.write(JSON.stringify(next));
    this.records.set(key, next);
    return next;
  }

  markEvent(id: string) { this.write(JSON.stringify({ event: id })); this.seenEvents.add(id); }
  close() { closeSync(this.fd); }
}

export interface WorkerOptions {
  /** Called at each step; a crash test kills the process from here. */
  fault?: (point: 'before-capture' | 'after-capture-response') => void;
  attempts?: number;
}

export class PaymentWorker {
  private inflight = new Map<string, Promise<PayRecord>>();

  constructor(private api: PaymentApi, readonly journal: PaymentJournal, private opts: WorkerOptions = {}) {}

  /** Pays this key once. Concurrent calls and repeats return the same payment. */
  pay(key: string, input: CreateOrderInput): Promise<PayRecord> {
    const running = this.inflight.get(key);
    if (running) return running;
    const job = (async () => {
      const known = this.journal.get(key);
      if (known && TERMINAL.has(known.state)) return known;
      return this.advance(known ?? this.journal.put(key, { state: 'recorded', input }));
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  /** After a restart: every payment that was not finished, carried to a state we can prove. */
  async recover(): Promise<PayRecord[]> {
    const open = this.journal.all().filter((r) => !TERMINAL.has(r.state));
    const done: PayRecord[] = [];
    for (const r of open) done.push(await this.pay(r.key, r.input));
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
            if (cents(held.orderAmount) !== cents(r.input.amount)) return this.unresolved(r, `order reads back at $${held.orderAmount}, the gate allowed $${r.input.amount}`);
            r = this.journal.put(r.key, { state: 'capturing' });
            this.opts.fault?.('before-capture');
            const res = await this.api.captureOrder(r.orderId!, `${r.key}-capture`);
            this.opts.fault?.('after-capture-response');
            if (res.status === 'DECLINED') return this.journal.put(r.key, { state: 'declined', reason: 'capture declined' });
            r = this.journal.put(r.key, { state: 'captured', captureId: res.captureId });
            break;
          }
          case 'capturing': r = await this.resolveCapture(r); break;
          default: return r;
        }
      } catch (e) {
        // anything but a rail error is ours: stop here, the journal already says where to resume
        if (!(e instanceof RailsError)) throw e;
        const err = e;
        // a refused request changed nothing we can build on; a lost one is resolved by reading back on the next pass
        if (err.status >= 400 && err.status < 500 && err.status !== 429 && r.state !== 'capturing') return this.unresolved(r, `${err.status} ${err.issue}`);
      }
      if (TERMINAL.has(r.state)) return r;
    }
    return this.unresolved(r, 'ran out of attempts before PayPal could confirm the outcome');
  }

  /** We may or may not have captured. Ask PayPal about this order, by id, and believe only that. */
  private async resolveCapture(r: PayRecord): Promise<PayRecord> {
    const order = await this.api.readOrder(r.orderId!);
    if (!order) throw new RailsError(503, 'READ_BACK_FAILED', false);
    if (order.captureId) {
      if (cents(order.amount) !== cents(r.input.amount)) return this.unresolved(r, `order reads back at $${order.amount}, expected $${r.input.amount}`);
      return this.journal.put(r.key, { state: 'captured', captureId: order.captureId, recovered: true });
    }
    if (order.status === 'APPROVED') return this.journal.put(r.key, { state: 'approved' }); // the capture never landed; safe to send
    return this.unresolved(r, `order is ${order.status} with no capture`);
  }

  /**
   * A verified webhook. Events can repeat and arrive in any order, so one only ever moves a payment forward,
   * and only for a resource this worker already knows.
   */
  applyEvent(e: { id: string; event_type: string; resource: { id?: string; custom_id?: string; supplementary_data?: { related_ids?: { order_id?: string } }; links?: { href: string; rel: string }[] } }): 'applied' | 'duplicate' | 'stale' | 'unknown' {
    if (this.journal.sawEvent(e.id)) return 'duplicate';
    const to: PayState | null = e.event_type === 'PAYMENT.CAPTURE.COMPLETED' ? 'captured' : e.event_type === 'PAYMENT.CAPTURE.REFUNDED' ? 'refunded' : null;
    const refundOf = e.resource.links?.find((l) => l.rel === 'up')?.href.split('/').pop();
    const orderId = e.resource.supplementary_data?.related_ids?.order_id;
    const r = (e.resource.id && this.journal.byCapture(e.resource.id)) || (refundOf && this.journal.byCapture(refundOf)) || this.journal.all().find((x) => orderId && x.orderId === orderId);
    if (!to || !r) return 'unknown';
    this.journal.markEvent(e.id);
    if (RANK[to] <= RANK[r.state] || r.state === 'declined' || r.state === 'unresolved') return 'stale';
    this.journal.put(r.key, to === 'captured' ? { state: to, captureId: e.resource.id } : { state: to, refundId: e.resource.id });
    return 'applied';
  }
}
