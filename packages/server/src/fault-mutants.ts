/**
 * Bugs put into the worker on purpose. A checker that has never failed proves nothing, so each of these is a mistake a
 * payment worker could really make, and the explorer has to find a schedule that exposes it.
 */
import { readFileSync } from 'node:fs';
import { RailsError } from '@sandbox-city/core';
import { PaymentJournal, PaymentWorker, type PaymentApi, type PayRecord } from './payments';
import type { JournalClass, WorkerClass } from './fault-explorer';

type Loose = Record<string, (...a: never[]) => unknown>;

/** The worker with one private method replaced, or the PayPal client with one call replaced. */
const worker = (patch: (w: Loose, api: PaymentApi, journal: PaymentJournal) => void): WorkerClass => class extends PaymentWorker {
  constructor(api: PaymentApi, journal: PaymentJournal) {
    const wrapped = Object.create(api) as PaymentApi;
    for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(api))) if (k !== 'constructor') (wrapped as unknown as Loose)[k] = (api as unknown as Loose)[k].bind(api);
    super(wrapped, journal);
    patch(this as unknown as Loose, wrapped, journal);
  }
};

class NoTornTailCut extends PaymentJournal {}
(NoTornTailCut.prototype as unknown as { load(): void }).load = function load(this: { path: string; records: Map<string, PayRecord>; seenEvents: Set<string> }) {
  for (const line of readFileSync(this.path).toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const { eventId, event, ...change } = JSON.parse(line) as PayRecord & { eventId?: string; event?: string };
      if (event) { this.seenEvents.add(event); continue; }
      if (eventId) this.seenEvents.add(eventId);
      this.records.set(change.key, { ...this.records.get(change.key), ...change });
    } catch { /* the next record joined this torn line, and went with it */ }
  }
};

export interface Mutant { name: string; workload: string; Worker?: WorkerClass; Journal?: JournalClass }

export const MUTANTS: Mutant[] = [
  { name: 'a restart starts the payment over with a new order', workload: 'pay, PayPal forgets request ids', Worker: worker((w, _a, j) => {
    const recover = w.recover.bind(w);
    w.recover = (async () => { for (const r of j.all()) if (r.state === 'capturing') j.put(r.key, { state: 'recorded', orderId: undefined, key: `${r.key}` }); return recover(); }) as never;
    const api = (w as unknown as { api: PaymentApi }).api, create = api.createPending.bind(api);
    let n = 0;
    api.createPending = (input, id) => create(input, `${id}-${++n}`);
  }) },
  { name: 'a lost capture answer is treated as declined', workload: 'pay', Worker: worker((_w, api) => {
    const capture = api.captureOrder.bind(api);
    api.captureOrder = async (id, rid) => { try { return await capture(id, rid); } catch (e) { if (e instanceof RailsError) return { status: 'DECLINED' }; throw e; } };
  }) },
  { name: 'PENDING is counted as captured', workload: 'pay', Worker: worker((_w, api) => {
    const capture = api.captureOrder.bind(api);
    api.captureOrder = async (id, rid) => { const r = await capture(id, rid); return r.status === 'PENDING' ? { ...r, status: 'COMPLETED' } : r; };
  }) },
  { name: 'the read-back before capture is skipped', workload: 'order changed at PayPal', Worker: worker((_w, api) => {
    const read = api.readOrder.bind(api);
    api.readOrder = async (id) => { const r = await read(id); return r && { ...r, orderAmount: 42.5, amount: r.amount && 42.5 }; };
  }) },
  { name: 'a void that failed is recorded as voided', workload: 'hold, then void', Worker: worker((_w, api) => {
    const voidHold = api.voidAuthorization!.bind(api);
    api.voidAuthorization = async (id, rid) => { try { return await voidHold(id, rid); } catch (e) { if (e instanceof RailsError) return { status: 'VOIDED' }; throw e; } };
  }) },
  { name: 'a webhook is marked seen before its effect is written', workload: 'pay, then refund mid-flight', Worker: worker((_w, _a, j) => {
    const put = j.put.bind(j);
    j.put = (key, change, eventId) => { if (eventId) j.markEvent(eventId); return put(key, change); };
  }) },
  { name: 'giving up reports success', workload: 'order changed at PayPal', Worker: worker((w, _a, j) => {
    w.unresolved = ((r: PayRecord) => j.put(r.key, { state: 'captured', captureId: 'CAP-unknown' })) as never;
  }) },
  { name: 'a hold is reported released before PayPal answers', workload: 'hold, then release', Worker: worker((_w, api) => {
    const release = api.captureAuthorization!.bind(api);
    api.captureAuthorization = async (id, rid) => { try { return await release(id, rid); } catch (e) { if (e instanceof RailsError) return { status: 'COMPLETED', captureId: 'CAP-assumed' }; throw e; } };
  }) },
  { name: 'a torn journal tail is not cut off', workload: 'pay, then refund mid-flight', Journal: NoTornTailCut },
];
