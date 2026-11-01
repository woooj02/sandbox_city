import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { RailsError, type CreateOrderInput, type FromSim, PRESETS } from '@sandbox-city/core';
import { buildMockPayPal } from '../src/mock-paypal';
import { SandboxRails } from '../src/paypal';
import { buildServer } from '../src/server';

const creds = { clientId: 'test-client', clientSecret: 'test-secret' };
let mock: ReturnType<typeof buildMockPayPal>;
let base = '';

beforeAll(async () => {
  mock = buildMockPayPal(creds);
  await mock.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}`;
});
afterAll(async () => { await mock.close(); });

const rails = () => new SandboxRails({ ...creds, base });
const order = (over: Partial<CreateOrderInput> = {}): CreateOrderInput => ({
  intent: 'CAPTURE', amount: 59.97, currency: 'USD', payeeMerchantId: 'm1', payerId: 'payer-1',
  card: { last4: '4242', state: 'ok', holder: 'payer-1' } as CreateOrderInput['card'],
  item: { name: 'Neon kettle', sku: 'SKU-1', unit: 19.99, qty: 3 }, shipTo: '12 Lantern Row, Sandbox City', customId: `o${Math.random().toString(36).slice(2)}`,
  ...over,
});

describe('SandboxRails against the PayPal contract mock', () => {
  it('rejects bad credentials', async () => {
    const r = new SandboxRails({ clientId: 'nope', clientSecret: 'nope', base });
    await expect(r.createOrder(order(), 'x1')).rejects.toBeInstanceOf(RailsError);
  });

  it('creates and captures an order in one call', async () => {
    const r = rails();
    const res = await r.createOrder(order(), 'c1');
    expect(res.status).toBe('COMPLETED');
    expect(res.captureId).toMatch(/^[A-Z0-9]{17}$/);
    expect(res.debugId).toBeTruthy();
    expect(r.calls.at(-1)?.requestId).toBe('c1');
  });

  it('keeps item math exact when unit x qty does not equal the amount', async () => {
    const res = await rails().createOrder(order({ amount: 10, item: { name: 'Odd', sku: 'S', unit: 3.33, qty: 3 } }), 'c2');
    expect(res.status).toBe('COMPLETED');
  });

  it('same PayPal-Request-Id never charges twice', async () => {
    const r = rails();
    const before = mock.state.captures.size;
    const input = order();
    const a = await r.createOrder(input, 'dup');
    const b = await r.createOrder(input, 'dup');
    expect(b.captureId).toBe(a.captureId);
    expect(mock.state.captures.size).toBe(before + 1);
  });

  it('namespaces request ids per run so replaying a seed is a new charge', async () => {
    const input = order();
    const a = await rails().createOrder({ ...input }, 'replay');
    const r2 = rails(); r2.runId = `${r2.runId}x`;
    const b = await r2.createOrder({ ...input }, 'replay');
    expect(b.captureId).not.toBe(a.captureId);
  });

  it('enacts risk declines through the negative-testing header', async () => {
    const res = await rails().createOrder(order({ mockCode: 'INSTRUMENT_DECLINED' }), 'd1');
    expect(res.status).toBe('DECLINED');
    expect(res.issue).toBe('INSTRUMENT_DECLINED');
  });

  it('authorizes, captures, refunds, and voids', async () => {
    const r = rails();
    const auth = await r.createOrder(order({ intent: 'AUTHORIZE' }), 'a1');
    expect(auth.authorizationId).toBeTruthy();
    const cap = await r.captureAuthorization(auth.authorizationId!, 'a1-cap');
    expect(cap.status).toBe('COMPLETED');
    await expect(r.captureAuthorization(auth.authorizationId!, 'a1-cap2')).rejects.toMatchObject({ issue: 'AUTHORIZATION_ALREADY_CAPTURED' });
    const rf = await r.refundCapture(cap.captureId, 59.97, 'a1-rf');
    expect(rf.status).toBe('COMPLETED');
    await expect(r.refundCapture(cap.captureId, 1, 'a1-rf2')).rejects.toMatchObject({ issue: 'REFUND_AMOUNT_EXCEEDED' });
    const auth2 = await r.createOrder(order({ intent: 'AUTHORIZE' }), 'a2');
    expect((await r.voidAuthorization(auth2.authorizationId!, 'a2-void')).status).toBe('VOIDED');
  });

  it('finds this run in Transaction Search by custom_id', async () => {
    const r = rails(); r.runId = 'rsearch';
    await r.createOrder(order({ amount: 5, item: { name: 'A', sku: 'A', unit: 5, qty: 1 } }), 's1');
    const txns = await r.searchTransactions(new Date(Date.now() - 3600_000), new Date());
    const mine = txns.filter((t) => t.transaction_info.custom_field?.startsWith('rsearch:'));
    expect(mine).toHaveLength(1);
    expect(mine[0].transaction_info.transaction_amount.value).toBe('5.00');
  });
});

describe('live server', () => {
  // open = no idempotency keys, so chaos produces real duplicate and ghost charges on the sandbox
  it.each(['open', 'balanced'] as const)('runs a day with a sandbox lane and reconciles to the cent with PayPal (%s)', async (preset) => {
    const app = await buildServer({ rails: () => new SandboxRails({ ...creds, base, maxConcurrent: 8 }), liveSample: 0.08 });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    expect(health.paypal).toBe('sandbox');

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const msgs: FromSim[] = [];
    let runId = '';
    const done = new Promise<void>((resolve, reject) => {
      ws.onmessage = (ev) => {
        const m = JSON.parse(String(ev.data)) as FromSim;
        msgs.push(m);
        if (m.type === 'run') runId = m.runId;
        if (m.type === 'error') reject(new Error(m.message));
        if (m.type === 'done') resolve();
      };
    });
    await new Promise<void>((r) => (ws.onopen = () => r()));
    ws.send(JSON.stringify({ cmd: 'init', seed: 'live-test', chaos: 0.12, shoppers: 150, lanes: [{ policy: PRESETS[preset] }] }));
    ws.send(JSON.stringify({ cmd: 'speed', tps: 100000 }));
    ws.send(JSON.stringify({ cmd: 'play' }));
    await done;
    ws.close();

    expect(runId).toBeTruthy();
    const calls = msgs.filter((m) => m.type === 'paypal_call');
    expect(calls.length).toBeGreaterThan(5);
    const events = msgs.flatMap((m) => (m.type === 'tick' ? m.events : []));
    expect(events.filter((e) => e.type === 'order' && e.rail === 'sandbox').length).toBeGreaterThan(0);
    if (preset === 'open') expect(events.some((e) => e.type === 'order' && e.rail === 'sandbox' && e.duplicateCharge)).toBe(true);

    const rec = await (await fetch(`http://127.0.0.1:${port}/api/reconcile/${runId}`)).json();
    expect(rec.sim.captured).toBeGreaterThan(0);
    expect(rec.delta).toBe(0);
    expect(rec.matched).toBe(true);
    await app.close();
  }, 120_000);
});
