import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RailsError, type CreateOrderInput } from '@sandbox-city/core';
import { buildMockPayPal, type MockPayPal } from '../src/mock-paypal';
import { PaymentJournal, PaymentWorker, type PaymentApi } from '../src/payments';
import { SandboxRails } from '../src/paypal';

const input = (customId: string, amount = 42.5): CreateOrderInput => ({
  intent: 'CAPTURE', amount, currency: 'USD', payeeMerchantId: 'M1', payerId: 'A1', card: { last4: '1111', state: 'ok', holder: 'A1' },
  item: { name: 'Lamp', sku: 'SKU1', unit: amount, qty: 1 }, shipTo: '12 Neon St, Silk Row', customId,
});

let mock: MockPayPal, base: string, dir: string, rails: SandboxRails;
const journalAt = (n = 'j.log') => new PaymentJournal(join(dir, n));
beforeAll(async () => {
  mock = buildMockPayPal();
  await mock.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}`;
});
afterAll(() => mock.close());
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sc-pay-'));
  rails = new SandboxRails({ clientId: 'mock-client', clientSecret: 'mock-secret', base, runId: `t${Math.random().toString(36).slice(2)}` });
  mock.state.captures.clear();
});

class Crash extends Error {}
/** An order that reads back as approved before the capture, and as `after` once the capture was attempted. */
const reads = (after: Awaited<ReturnType<PaymentApi['readOrder']>>) => {
  let n = 0;
  return async () => (n++ === 0 ? { status: 'APPROVED', orderAmount: 42.5 } : after);
};

describe('paying once', () => {
  it('walks an order to captured and leaves the id trail on disk', async () => {
    const j = journalAt();
    const r = await new PaymentWorker(rails, j).pay('o1', input('o1'));
    expect(r.state).toBe('captured');
    expect(r.orderId && r.captureId).toBeTruthy();
    expect(mock.state.captures.size).toBe(1);
    expect(new PaymentJournal(j.path).get('o1')?.state).toBe('captured');
  });

  it('a repeat of a finished key makes no call', async () => {
    const w = new PaymentWorker(rails, journalAt());
    const first = await w.pay('o1', input('o1'));
    const before = mock.state.requests;
    expect((await w.pay('o1', input('o1'))).captureId).toBe(first.captureId);
    expect(mock.state.requests).toBe(before);
  });

  it('concurrent requests for one key make one payment', async () => {
    const w = new PaymentWorker(rails, journalAt());
    const all = await Promise.all(Array.from({ length: 8 }, () => w.pay('o1', input('o1'))));
    expect(new Set(all.map((r) => r.captureId)).size).toBe(1);
    expect(mock.state.captures.size).toBe(1);
  });
});

describe('losing the capture response', () => {
  /** The process dies with PayPal's answer in the air: money moved, the journal says only "capturing". */
  async function crashAfterCapture() {
    const j = journalAt();
    const w = new PaymentWorker(rails, j, { fault: (p) => { if (p === 'after-capture-response') throw new Crash(); } });
    // the fault is not a RailsError: this stands in for the process dying at that line
    await w.pay('o1', input('o1')).catch(() => undefined);
    return j;
  }

  it('a restart reads the order back and does not charge again', async () => {
    const j = await crashAfterCapture();
    expect(mock.state.captures.size).toBe(1);
    const restarted = new PaymentWorker(rails, new PaymentJournal(j.path));
    const [r] = await restarted.recover();
    expect(r.state).toBe('captured');
    expect(r.recovered).toBe(true);
    expect(r.captureId).toBe([...mock.state.captures.keys()][0]);
    expect(mock.state.captures.size).toBe(1);
  });

  it('does not depend on the idempotency key still being remembered', async () => {
    const j = await crashAfterCapture();
    // a new namespace means every PayPal-Request-Id is fresh: any re-sent capture would be a new request
    const amnesia = new SandboxRails({ clientId: 'mock-client', clientSecret: 'mock-secret', base, runId: 'expired' });
    const [r] = await new PaymentWorker(amnesia, new PaymentJournal(j.path)).recover();
    expect(r.state).toBe('captured');
    expect(mock.state.captures.size).toBe(1);
  });

  it('a capture that never landed is sent, once', async () => {
    const j = journalAt();
    const w = new PaymentWorker(rails, j, { fault: (p) => { if (p === 'before-capture') throw new Crash(); } });
    await w.pay('o1', input('o1')).catch(() => undefined);
    expect(mock.state.captures.size).toBe(0);
    const [r] = await new PaymentWorker(rails, new PaymentJournal(j.path)).recover();
    expect(r.state).toBe('captured');
    expect(mock.state.captures.size).toBe(1);
  });

  it('a client with no journal, retrying from scratch, charges twice: the control', async () => {
    await crashAfterCapture();
    const naive = new SandboxRails({ clientId: 'mock-client', clientSecret: 'mock-secret', base, runId: 'restarted' });
    const w = new PaymentWorker(naive, journalAt('fresh.log'));
    await w.pay('o1', input('o1'));
    expect(mock.state.captures.size).toBe(2);
  });

  it('never invents a success: an order it cannot read stays unresolved', async () => {
    const api: PaymentApi = { createPending: async () => ({ orderId: 'X' }), confirmSource: async () => ({ status: 'APPROVED' }), captureOrder: async () => { throw new RailsError(504, 'GATEWAY_TIMEOUT', true); }, readOrder: reads({ status: 'VOIDED' }) };
    const r = await new PaymentWorker(api, journalAt()).pay('o1', input('o1'));
    expect(r.state).toBe('unresolved');
    expect(r.reason).toMatch(/VOIDED/);
  });

  it('refuses a read-back that disagrees with the intent', async () => {
    const api: PaymentApi = { createPending: async () => ({ orderId: 'X' }), confirmSource: async () => ({ status: 'APPROVED' }), captureOrder: async () => { throw new RailsError(504, 'GATEWAY_TIMEOUT', true); }, readOrder: reads({ status: 'COMPLETED', captureId: 'C', amount: 999 }) };
    const r = await new PaymentWorker(api, journalAt()).pay('o1', input('o1'));
    expect(r.state).toBe('unresolved');
    expect(r.captureId).toBeUndefined();
  });

  it('refuses to capture an order that changed after the gate allowed it', async () => {
    let captured = false;
    const api: PaymentApi = { createPending: async () => ({ orderId: 'X' }), confirmSource: async () => ({ status: 'APPROVED' }), captureOrder: async () => { captured = true; return { status: 'COMPLETED' }; }, readOrder: async () => ({ status: 'APPROVED', orderAmount: 4200 }) };
    const r = await new PaymentWorker(api, journalAt()).pay('o1', input('o1'));
    expect(r.state).toBe('unresolved');
    expect(captured).toBe(false);
  });

  it('survives a line torn by the crash', async () => {
    const j = journalAt();
    await new PaymentWorker(rails, j).pay('o1', input('o1'));
    appendFileSync(j.path, '{"key":"o2","sta');
    const back = new PaymentJournal(j.path);
    expect(back.get('o1')?.state).toBe('captured');
    expect(back.get('o2')).toBeUndefined();
  });
});

describe('webhooks', () => {
  const event = (id: string, event_type: string, resource: object) => ({ id, event_type, resource });

  it('moves a payment forward only: repeats and old news change nothing', async () => {
    const w = new PaymentWorker(rails, journalAt());
    const r = await w.pay('o1', input('o1'));
    const refunded = event('E2', 'PAYMENT.CAPTURE.REFUNDED', { id: 'RF1', amount: { value: "42.50" }, links: [{ rel: 'up', href: `/v2/payments/captures/${r.captureId}` }] });
    expect(w.applyEvent(refunded)).toBe('applied');
    expect(w.journal.get('o1')?.state).toBe('refunded');
    expect(w.applyEvent(refunded)).toBe('duplicate');
    // the capture event arrives late, after the refund: it must not pull the payment backwards
    expect(w.applyEvent(event('E1', 'PAYMENT.CAPTURE.COMPLETED', { id: r.captureId }))).toBe('stale');
    expect(w.journal.get('o1')?.state).toBe('refunded');
  });

  it('remembers events across a restart', async () => {
    const j = journalAt();
    const w = new PaymentWorker(rails, j);
    const r = await w.pay('o1', input('o1'));
    const e = event('E1', 'PAYMENT.CAPTURE.REFUNDED', { id: 'RF1', amount: { value: "42.50" }, links: [{ rel: 'up', href: `/x/${r.captureId}` }] });
    w.applyEvent(e);
    expect(new PaymentWorker(rails, new PaymentJournal(j.path)).applyEvent(e)).toBe('duplicate');
  });

  it('ignores a resource it never created', () => {
    expect(new PaymentWorker(rails, journalAt()).applyEvent(event('E9', 'PAYMENT.CAPTURE.COMPLETED', { id: 'NOT-OURS' }))).toBe('unknown');
  });

  it('asks PayPal to verify the signature', async () => {
    const event1 = { id: 'E1' };
    expect(await rails.verifyWebhook({ 'paypal-transmission-sig': 'mock-valid-signature' }, event1, 'WH-MOCK')).toBe(true);
    expect(await rails.verifyWebhook({ 'paypal-transmission-sig': 'forged' }, event1, 'WH-MOCK')).toBe(false);
  });
});

afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } });
