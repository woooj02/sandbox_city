/**
 * Seven defects an outside review found in the checkout and the durable worker, kept as regressions. Each test here
 * failed before its fix. Passing the older tests did not catch any of them: those covered a narrower promise.
 */
import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PRESETS, policyId, type CreateOrderInput } from '@sandbox-city/core';
import { frozenRulebooks, registerCheckout } from '../src/checkout-api';
import { buildMockPayPal, type MockPayPal } from '../src/mock-paypal';
import { PaymentJournal, PaymentWorker, type PaymentApi } from '../src/payments';
import { SandboxRails } from '../src/paypal';

const addr = { address_line_1: '12 Neon St', admin_area_2: 'Silk Row', admin_area_1: 'CA', postal_code: '94107', country_code: 'US' };
const owner = { category: 'home', qty: 1, address: '12 Neon St, Silk Row', budget: 1000 };
const line = (price: number) => ({ items: [{ name: 'Lamp', quantity: 1, itemCost: price, itemTotal: price }], shippingAddress: addr });
const v3 = frozenRulebooks()['frozen-v3'];

let mock: MockPayPal, base: string, app: FastifyInstance, journalPath: string, dir: string;
const rails = () => new SandboxRails({ clientId: 'mock-client', clientSecret: 'mock-secret', base });
const build = async () => {
  const a = Fastify();
  const c = registerCheckout(a, { rails, journalPath, rulebooks: { 'frozen-v3': v3, open: PRESETS.open, tuned: PRESETS.tuned }, labToken: 'lab' });
  await a.ready();
  return { a, c };
};
const event = (a: FastifyInstance, payload: object, token = 'lab') => a.inject({ method: 'POST', url: '/api/history/events', headers: { authorization: `Bearer ${token}` }, payload });
/** A buyer with a long record elsewhere, and a store with one too, stated as imports. */
const buyer = (a: FastifyInstance, id: string) => event(a, { type: 'import-agent', id, source: 'test fixture', age: 90000, orders: 40 });
const store = (a: FastifyInstance, id: string, independent: number) => event(a, { type: 'import-merchant', id, source: 'test fixture', age: 20000, verified: true, orders: 50, deliveries: 50, fulfilled: independent, independent });
const post = (a: FastifyInstance, body: object) => a.inject({ method: 'POST', url: '/api/checkout', payload: { rulebook: 'frozen-v3', owner, ...body } });

beforeAll(async () => {
  mock = buildMockPayPal();
  await mock.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}`;
});
afterAll(() => mock.close());
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sc-audit-'));
  journalPath = join(dir, 'payments.log');
  mock.state.captures.clear();
  ({ a: app } = await build());
});

const input = (customId: string, amount = 42.5): CreateOrderInput => ({
  intent: 'CAPTURE', amount, currency: 'USD', payeeMerchantId: 'M1', payerId: 'A1', card: { last4: '1111', state: 'ok', holder: 'A1' },
  item: { name: 'Lamp', sku: 'SKU1', unit: amount, qty: 1 }, shipTo: '12 Neon St, Silk Row', customId,
});
/** A provider that answers a capture with whatever status the case needs. */
const provider = (status: string): PaymentApi & { reads: number } => ({
  reads: 0,
  createPending: async () => ({ orderId: 'O1' }),
  confirmSource: async () => ({ status: 'APPROVED' }),
  captureOrder: async () => ({ captureId: 'C1', status, amount: 42.5 }),
  async readOrder() { return this.reads++ === 0 ? { status: 'APPROVED', orderAmount: 42.5 } : { status: 'COMPLETED', orderAmount: 42.5, captureId: 'C1', captureStatus: status, amount: 42.5 }; },
} as PaymentApi & { reads: number });

describe('1. a hold decision is enforced', () => {
  const hold = async (key: string, a = app) => {
    await buyer(a, 'shopper');
    return (await post(a, { key, agent: 'shopper', merchant: 'fresh-store', args: line(300) })).json();
  };

  it('money the rulebook said to hold is authorized, not captured', async () => {
    const r = await hold('k1');
    expect(r.ok).toBe(true);
    expect(r.escrow).toBe(true);
    expect(r.payment.state).toBe('held');
    expect(r.payment.authorizationId).toBeTruthy();
    expect(mock.state.captures.size).toBe(0);
  });

  it('releases once the goods arrived and the window closed, and only then', async () => {
    await hold('k1');
    expect((await event(app, { type: 'delivered', key: 'k1' })).json().payment.state).toBe('held'); // a scan is not enough: an empty box scans too
    const r = (await event(app, { type: 'window-closed', key: 'k1' })).json();
    expect(r.steps).toEqual(['release', 'credit']);
    expect(r.payment.state).toBe('captured');
    expect(r.payment.credited).toBe(true);
    expect(mock.state.captures.size).toBe(1);
  });

  it.each([
    ['nothing was delivered', ['window-closed']],
    ['the buyer complained about what arrived', ['delivered', 'complaint', 'window-closed']],
  ])('voids the hold when %s, and no money moves', async (_n, types) => {
    await hold('k1');
    let last;
    for (const type of types) last = (await event(app, { type, key: 'k1' })).json();
    expect(last.payment.state).toBe('voided');
    expect(mock.state.captures.size).toBe(0);
    expect(last.merchant.fulfilled).toBe(0);
  });

  it('a voided hold gives the mandate back', async () => {
    await hold('k1');
    await event(app, { type: 'window-closed', key: 'k1' });
    expect((await post(app, { key: 'k2', session: 'k1', agent: 'shopper', merchant: 'fresh-store', args: line(300) })).json().ok).toBe(true);
  });

  it('a released hold keeps the mandate spent', async () => {
    await hold('k1');
    await event(app, { type: 'delivered', key: 'k1' });
    await event(app, { type: 'window-closed', key: 'k1' });
    expect((await post(app, { key: 'k2', session: 'k1', agent: 'shopper', merchant: 'fresh-store', args: line(300) })).json().ok).toBe(false);
  });

  it('a hold still counts against the mandate while it waits', async () => {
    await hold('k1');
    expect((await post(app, { key: 'k2', session: 'k1', agent: 'shopper', merchant: 'fresh-store', args: line(300) })).json().ok).toBe(false);
  });

  it('a retry of a held key neither captures nor makes a second hold', async () => {
    const first = await hold('k1');
    const again = (await post(app, { key: 'k1', agent: 'shopper', merchant: 'fresh-store', args: line(300) })).json();
    expect(again.replay).toBe(true);
    expect(again.payment.authorizationId).toBe(first.payment.authorizationId);
    expect(mock.state.auths.size).toBeGreaterThan(0);
    expect(mock.state.captures.size).toBe(0);
  });

  it('a restart leaves a hold on hold', async () => {
    await hold('k1');
    const { a, c } = await build();
    expect(await c.recover()).toEqual([]);
    expect((await a.inject({ url: '/api/payments/k1' })).json().state).toBe('held');
    expect(mock.state.captures.size).toBe(0);
  });

  it('a crash halfway through a release finishes on restart, once', async () => {
    await hold('k1');
    await event(app, { type: 'delivered', key: 'k1' });
    const j = new PaymentJournal(journalPath);
    j.put('k1', { state: 'releasing' });
    j.close();
    const { c } = await build();
    const [r] = await c.recover();
    expect(r.state).toBe('captured');
    expect(mock.state.captures.size).toBe(1);
  });
});

describe('2. history is real input, and it moves', () => {
  it('an unknown store is new, not established', async () => {
    await buyer(app, 'shopper');
    const r = (await post(app, { key: 'k1', agent: 'shopper', args: line(80) })).json();
    expect(r.history.merchant.independent).toBe(0);
    expect(r.escrow).toBe(true);
  });

  it('an unknown agent is new, and the new-agent cap applies to it', async () => {
    const r = (await post(app, { key: 'k1', merchant: 'x', args: line(300) })).json();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/newAgentCap/);
  });

  it('exposure grows with each paid order, until the store has to wait', async () => {
    await store(app, 'lumen', 3000); // a bound of $150
    const states = [];
    for (const k of ['a', 'b', 'c']) {
      await buyer(app, `b-${k}`);
      states.push((await post(app, { key: k, agent: `b-${k}`, merchant: 'lumen', args: line(70) })).json().payment.state);
    }
    expect(states).toEqual(['captured', 'captured', 'held']);
    expect((await app.inject({ url: '/api/history/merchants/lumen' })).json().exposure).toBe(140);
  });

  it('a delivery earns independent credit, which raises the bound', async () => {
    await store(app, 'lumen', 3000);
    await buyer(app, 'b1');
    await post(app, { key: 'a', agent: 'b1', merchant: 'lumen', args: line(70) });
    await event(app, { type: 'delivered', key: 'a' });
    const r = (await event(app, { type: 'window-closed', key: 'a' })).json();
    expect(r.merchant.exposure).toBe(0);
    expect(r.merchant.independent).toBe(3070);
  });

  it('a store cannot buy its own record: a new account earns it no independent credit', async () => {
    await store(app, 'lumen', 3000);
    await post(app, { key: 'a', agent: 'own-agent', merchant: 'lumen', args: line(70) });
    await event(app, { type: 'delivered', key: 'a' });
    const r = (await event(app, { type: 'window-closed', key: 'a' })).json();
    expect(r.merchant.fulfilled).toBe(3070);
    expect(r.merchant.independent).toBe(3000);
  });

  it('a complaint earns nothing, and the money stays exposure', async () => {
    await store(app, 'lumen', 3000);
    await buyer(app, 'b1');
    await post(app, { key: 'a', agent: 'b1', merchant: 'lumen', args: line(70) });
    await event(app, { type: 'complaint', key: 'a' });
    const r = (await event(app, { type: 'window-closed', key: 'a' })).json();
    expect(r.merchant.exposure).toBe(70);
    expect(r.merchant.independent).toBe(3000);
  });

  it('the record survives a restart', async () => {
    await store(app, 'lumen', 3000);
    await buyer(app, 'b1');
    await post(app, { key: 'a', agent: 'b1', merchant: 'lumen', args: line(70) });
    const { a } = await build();
    expect((await a.inject({ url: '/api/history/merchants/lumen' })).json().exposure).toBe(70);
  });

  it('two orders in the same moment cannot both fit under the bound', async () => {
    await store(app, 'lumen', 3000);
    await Promise.all(['a', 'b', 'c'].map((k) => buyer(app, `b-${k}`)));
    const rs = await Promise.all(['a', 'b', 'c'].map((k) => post(app, { key: k, agent: `b-${k}`, merchant: 'lumen', args: line(100) })));
    expect(rs.map((r) => r.json().payment.state).sort()).toEqual(['captured', 'held', 'held']);
  });

  it('only the lab token can report events, because they can release money', async () => {
    expect((await event(app, { type: 'import-merchant', id: 'x', source: 'me' }, 'wrong')).statusCode).toBe(401);
    const a = Fastify();
    registerCheckout(a, { rails, journalPath, rulebooks: { 'frozen-v3': v3 } });
    await a.ready();
    expect((await event(a, { type: 'import-merchant', id: 'x', source: 'me' })).statusCode).toBe(503);
  });

  it('an import has to say where its record came from', async () => {
    expect((await event(app, { type: 'import-merchant', id: 'x', age: 1 })).statusCode).toBe(400);
  });

  it('every answer shows the facts the evaluator saw, and keeps them', async () => {
    await store(app, 'lumen', 3000);
    await buyer(app, 'b1');
    const r = (await post(app, { key: 'a', agent: 'b1', merchant: 'lumen', args: line(70) })).json();
    expect(r.history.merchant.independent).toBe(3000);
    expect((await app.inject({ url: '/api/payments/a' })).json().decision.facts.merchant.independent).toBe(3000);
  });
});

describe('3. a mandate survives a restart', () => {
  it('a new key in the same session cannot spend it again', async () => {
    const tight = { ...owner, budget: 100 };
    const session = 's1';
    await post(app, { key: 'a', session, owner: tight, args: line(80) });
    expect((await post(app, { key: 'b', session, owner: tight, args: line(80) })).json().ok).toBe(false);
    const { a, c } = await build();
    await c.recover();
    const after = (await post(a, { key: 'c', session, owner: tight, args: line(80) })).json();
    expect(after.ok).toBe(false);
    expect(after.reason).toMatch(/enforceMandate/);
  });
});

describe('4. only a completed capture counts', () => {
  it('a pending capture finishes when PayPal says so, and not before', async () => {
    const api = provider('PENDING');
    const j = new PaymentJournal(join(dir, 'p.log'));
    const w = new PaymentWorker(api, j);
    expect((await w.pay('o1', input('o1'))).state).toBe('pending');
    expect(w.applyEvent({ id: 'E1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'C1', amount: { value: '42.50' } } })).toBe('applied');
    expect(j.get('o1')?.state).toBe('captured');
  });

  it('a denied pending capture is declined, and a completed event of the wrong amount changes nothing', async () => {
    const j = new PaymentJournal(join(dir, 'd.log'));
    const w = new PaymentWorker(provider('PENDING'), j);
    await w.pay('o1', input('o1'));
    expect(w.applyEvent({ id: 'E1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'C1', amount: { value: '1.00' } } })).toBe('stale');
    expect(w.applyEvent({ id: 'E2', event_type: 'PAYMENT.CAPTURE.DENIED', resource: { id: 'C1' } })).toBe('applied');
    expect(j.get('o1')?.state).toBe('declined');
  });

  it('an unresolved payment keeps its mandate reserved', async () => {
    const j = new PaymentJournal(journalPath);
    j.put('stuck', { state: 'unresolved', input: { ...input('stuck', 80), item: { name: 'Lamp', sku: 'S', unit: 80, qty: 1 } }, context: { session: 's9', owner: JSON.stringify({ ...owner, budget: 100 }), rulebook: 'frozen-v3', policy: 'x', evaluator: 'y', decision: 'allow', escrow: false, merchant: 'm', agent: 'a', decidedAt: new Date().toISOString(), facts: { merchant: { age: 0, verified: false, rep: 0, ring: 0, orders: 0 }, agent: { age: 0, orders: 0, recent: 0, refunds: 0, rep: 0 } } } });
    j.close();
    const { a } = await build();
    expect((await post(a, { key: 'next', session: 's9', owner: { ...owner, budget: 100 }, args: line(80) })).json().reason).toMatch(/enforceMandate/);
  });

  it.each(['PENDING', 'FAILED', 'DECLINED'])('a %s capture is not recorded as captured', async (status) => {
    const j = new PaymentJournal(join(dir, `${status}.log`));
    expect((await new PaymentWorker(provider(status), j).pay('o1', input('o1'))).state).not.toBe('captured');
  });

  it.each(['PENDING', 'FAILED'])('a restart does not turn a %s capture into a success', async (status) => {
    const j = new PaymentJournal(join(dir, `r-${status}.log`));
    j.put('o1', { state: 'capturing', input: input('o1'), orderId: 'O1' });
    const api = provider(status);
    api.reads = 1;
    expect((await new PaymentWorker(api, j).recover())[0].state).not.toBe('captured');
  });
});

describe('5. a receipt names the decision that was really made', () => {
  it('a retry under a stricter rulebook does not say that rulebook allowed it', async () => {
    const box = { ...line(80), shippingAddress: { ...addr, address_line_1: 'PO Box 404' } };
    const first = (await post(app, { key: 'k5', session: 'one', rulebook: 'open', args: box })).json();
    expect(first.payment.state).toBe('captured');
    const res = await post(app, { key: 'k5', session: 'two', rulebook: 'frozen-v3', args: box });
    expect(res.statusCode).toBe(409);
    expect(res.json().policy).toBeUndefined();
    expect(res.json().original.policy).toBe(policyId(PRESETS.open));
  });

  it('a same-session retry still answers with the original decision', async () => {
    const first = (await post(app, { key: 'k5', session: 'one', rulebook: 'open', args: line(80) })).json();
    const again = (await post(app, { key: 'k5', session: 'one', rulebook: 'open', args: line(80) })).json();
    expect(again.replay).toBe(true);
    expect(again.policy).toBe(policyId(PRESETS.open));
    expect(again.history).toEqual(first.history);
  });
});

describe('6. a torn journal tail', () => {
  it('does not swallow the next record', () => {
    const path = join(dir, 'torn.log');
    const j = new PaymentJournal(path);
    j.put('old', { state: 'recorded', input: input('old') });
    j.close();
    appendFileSync(path, '{"key":"half","sta');
    const k = new PaymentJournal(path);
    k.put('new', { state: 'recorded', input: input('new') });
    k.close();
    const l = new PaymentJournal(path);
    expect(l.get('old')).toBeTruthy();
    expect(l.get('new')).toBeTruthy();
    expect(l.get('half')).toBeUndefined();
  });

  it('keeps working across repeated crashes', () => {
    const path = join(dir, 'twice.log');
    new PaymentJournal(path).close();
    for (const k of ['a', 'b', 'c']) {
      const j = new PaymentJournal(path);
      j.put(k, { state: 'recorded', input: input(k) });
      j.close();
      appendFileSync(path, '{"torn":');
    }
    const l = new PaymentJournal(path);
    expect(l.all().map((r) => r.key)).toEqual(['a', 'b', 'c']);
  });
});

describe('7. the address the gate checked is the address PayPal gets', () => {
  it('a different address at PayPal stops the capture', async () => {
    const api = provider('COMPLETED');
    api.readOrder = async () => ({ status: 'APPROVED', orderAmount: 42.5, address: { ...addr, postal_code: '94105' } });
    const j = new PaymentJournal(join(dir, 'addr.log'));
    const r = await new PaymentWorker(api, j).pay('o1', { ...input('o1'), address: addr });
    expect(r.state).toBe('unresolved');
    expect(r.reason).toMatch(/postal_code/);
  });

  it.each([['quantity', { qty: 8 }], ['currency', { currency: 'EUR' }], ['identity', { customId: 'run:someone-else' }]])('a different %s at PayPal stops the capture', async (_n, change) => {
    const api = provider('COMPLETED');
    api.readOrder = async () => ({ status: 'APPROVED', orderAmount: 42.5, ...change });
    expect((await new PaymentWorker(api, new PaymentJournal(join(dir, `${_n}.log`))).pay('o1', input('o1'))).state).toBe('unresolved');
  });

  it('end to end, PayPal holds the postal code the owner gave', async () => {
    await buyer(app, 'b1');
    await post(app, { key: 'a', agent: 'b1', merchant: 'x', args: line(80) });
    const j = new PaymentJournal(journalPath);
    expect((await rails().readOrder(j.get('a')!.orderId!))?.address?.postal_code).toBe('94107');
  });

  it('postal details survive into the order', () => {
    const body = SandboxRails.orderBody({ ...input('o1'), address: addr } as CreateOrderInput, undefined, undefined);
    expect(body.purchase_units[0].shipping.address.postal_code).toBe('94107');
    expect(body.purchase_units[0].shipping.address.admin_area_2).toBe('Silk Row');
  });
});
