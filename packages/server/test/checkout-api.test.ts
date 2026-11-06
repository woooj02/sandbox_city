import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { policyId, PRESETS, type Policy } from '@sandbox-city/core';
import { frozenRulebooks, registerCheckout } from '../src/checkout-api';
import { buildMockPayPal, type MockPayPal } from '../src/mock-paypal';
import { SandboxRails } from '../src/paypal';

const owner = { category: 'home', qty: 1, address: '12 Neon St, Silk Row', budget: 100 };
const addr = { address_line_1: '12 Neon St', admin_area_2: 'Silk Row', admin_area_1: 'CA', postal_code: '94107', country_code: 'US' };
const honest = { items: [{ name: 'Lamp', quantity: 1, itemCost: 80, itemTotal: 80 }], shippingAddress: addr };
const rulebook: Policy = { ...PRESETS.kya, name: 'Test', strictOrders: true, shipLock: true };

let mock: MockPayPal, base: string, app: FastifyInstance, journalPath: string;
const rails = () => new SandboxRails({ clientId: 'mock-client', clientSecret: 'mock-secret', base });
const build = async (extra: Partial<Parameters<typeof registerCheckout>[1]> = {}) => {
  const a = Fastify();
  const c = registerCheckout(a, { rails, journalPath, rulebooks: { test: rulebook, open: PRESETS.open }, webhookId: 'WH-MOCK', ...extra });
  await a.ready();
  return { a, c };
};
const post = (a: FastifyInstance, body: object) => a.inject({ method: 'POST', url: '/api/checkout', payload: { rulebook: 'test', owner, listedUnit: 80, ...body } });

beforeAll(async () => {
  mock = buildMockPayPal();
  await mock.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}`;
});
afterAll(() => mock.close());
beforeEach(async () => {
  journalPath = join(mkdtempSync(join(tmpdir(), 'sc-api-')), 'payments.log');
  mock.state.captures.clear();
  ({ a: app } = await build());
});

describe('POST /api/checkout', () => {
  it('pays an honest order once and names the rulebook that allowed it', async () => {
    const r = (await post(app, { key: 'k1', args: honest })).json();
    expect(r.decision).toBe('allow');
    expect(r.policy).toBe(policyId(rulebook));
    expect(r.payment.state).toBe('captured');
    expect(r.rail).toBe('contract-mock');
    expect(mock.state.captures.size).toBe(1);
  });

  it('refuses the hijack before PayPal hears about it', async () => {
    const before = mock.state.requests;
    const r = (await post(app, { key: 'k2', args: { ...honest, shippingAddress: { ...addr, address_line_1: 'PO Box 404' } } })).json();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/shipLock/);
    expect(r.payment).toBeNull();
    expect(mock.state.requests).toBe(before);
  });

  it('a retry answers from the journal and charges nothing', async () => {
    const first = (await post(app, { key: 'k3', args: honest })).json();
    const again = (await post(app, { key: 'k3', args: honest })).json();
    expect(again.replay).toBe(true);
    expect(again.payment.captureId).toBe(first.payment.captureId);
    expect(mock.state.captures.size).toBe(1);
  });

  it('the same key cannot pay for a different order', async () => {
    await post(app, { key: 'k4', args: honest });
    const other = { ...honest, items: [{ name: 'Lamp', quantity: 1, itemCost: 90, itemTotal: 90 }] };
    expect((await post(app, { key: 'k4', args: other })).statusCode).toBe(409);
  });

  it('a mandate covers the whole session, even for calls in the same moment', async () => {
    const rs = await Promise.all(['a', 'b', 'c'].map((k) => post(app, { key: `k5${k}`, session: 's1', args: honest })));
    expect(rs.filter((r) => r.json().ok).length).toBe(1);
    expect(mock.state.captures.size).toBe(1);
  });

  it('a session cannot change owner', async () => {
    await post(app, { key: 'k6', session: 's2', args: honest });
    expect((await post(app, { key: 'k7', session: 's2', owner: { ...owner, budget: 9000 }, args: honest })).statusCode).toBe(409);
  });

  it.each([
    [{ key: 'bad key!', args: honest }], [{ key: 'k8', args: {} }], [{ key: 'k8', args: honest, owner: { ...owner, qty: 0 } }],
    [{ key: 'k8', args: honest, owner: { ...owner, address: ' ' } }], [{ key: 'k8', args: honest, rulebook: 'nope' }], [{ key: 'k8', args: honest, listedUnit: -1 }],
  ])('rejects a malformed request %#', async (body) => {
    expect((await post(app, body)).statusCode).toBe(400);
  });

  it('with no PayPal keys it still gates, and says nothing was paid', async () => {
    const { a } = await build({ rails: () => null });
    const r = (await post(a, { key: 'k9', args: honest })).json();
    expect(r.ok).toBe(true);
    expect(r.payment).toBeNull();
    expect(r.rail).toMatch(/nothing was paid/);
  });

  it('limits how fast a public lab can be called', async () => {
    const { a } = await build({ perMinute: 1 });
    await post(a, { key: 'k10', args: honest });
    expect((await post(a, { key: 'k11', args: honest })).statusCode).toBe(429);
  });

  it('keeps its idempotency namespace across a restart', async () => {
    const first = (await post(app, { key: 'k12', args: honest })).json();
    const { a, c } = await build();
    await c.recover();
    const again = (await post(a, { key: 'k12', args: honest })).json();
    expect(again.payment.captureId).toBe(first.payment.captureId);
    expect(mock.state.captures.size).toBe(1);
  });
});

describe('POST /webhooks/paypal', () => {
  const headers = (sig: string) => ({ 'paypal-transmission-sig': sig, 'paypal-transmission-id': 't', 'paypal-transmission-time': 'now', 'paypal-auth-algo': 'a', 'paypal-cert-url': 'c' });

  it('a forged event changes nothing', async () => {
    const paid = (await post(app, { key: 'k13', args: honest })).json();
    const event = { id: 'WH-1', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'R1', amount: { value: String(paid.payment.amount) }, links: [{ rel: 'up', href: `/x/${paid.payment.captureId}` }] } };
    const res = await app.inject({ method: 'POST', url: '/webhooks/paypal', headers: headers('forged'), payload: event });
    expect(res.statusCode).toBe(401);
    expect((await app.inject({ url: '/api/payments/k13' })).json().state).toBe('captured');
    const ok = await app.inject({ method: 'POST', url: '/webhooks/paypal', headers: headers('mock-valid-signature'), payload: event });
    expect(ok.json().result).toBe('applied');
    expect((await app.inject({ url: '/api/payments/k13' })).json().state).toBe('refunded');
  });
});

describe('the rulebooks it serves', () => {
  it('are the frozen files, checked against their hashes', () => {
    const books = frozenRulebooks();
    expect(Object.keys(books)).toContain('frozen-v1');
  });
});
