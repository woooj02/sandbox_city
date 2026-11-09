import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_POSTAL } from '@sandbox-city/core';
import { buildMockPayPal, type MockPayPal } from '../src/mock-paypal';
import { guardRulebook, guardToolkit, type HandlesToolCalls, type ToolCall } from '../src/toolkit-guard';

// The real @paypal/agent-toolkit, pointed at the local contract mock of PayPal: no network, no keys.
const { PayPalAgentToolkit } = createRequire(import.meta.url)('@paypal/agent-toolkit/openai');
const owner = { category: 'home', qty: 1, address: '12 Neon St, Silk Row', budget: 100 };
const ship = { address_line_1: '12 Neon St', admin_area_2: 'Silk Row', ...OWNER_POSTAL };
const call = (name: string, args: unknown, id = name): ToolCall => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const lamp = (quantity = 1, shippingAddress: object = ship) => call('create_order', { currencyCode: 'USD', items: [{ name: 'Lamp', quantity, itemCost: 80, itemTotal: 80 * quantity }], shippingAddress });
const body = (m: { content: string }) => JSON.parse(m.content);

let mock: MockPayPal, base = '';
beforeAll(async () => { mock = buildMockPayPal({ clientId: 'guard-id', clientSecret: 'guard-secret' }); base = await mock.listen({ port: 0, host: '127.0.0.1' }); });
afterAll(() => mock.close());

function toolkit(): HandlesToolCalls {
  const tk = new PayPalAgentToolkit({ clientId: 'guard-id', clientSecret: 'guard-secret', configuration: { actions: { orders: { create: true, get: true, capture: true } }, context: { sandbox: true } } });
  tk.client._baseUrl = base;
  return tk;
}
async function approve(orderId: string) {
  const token = (await (await fetch(`${base}/v1/oauth2/token`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from('guard-id:guard-secret').toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })).json()).access_token;
  await fetch(`${base}/v2/checkout/orders/${orderId}/confirm-payment-source`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ payment_source: { card: { number: '4111111111111111', expiry: '2030-12', security_code: '123', name: 'Agent Owner' } } }) });
}

describe('guardToolkit around the real Agent Toolkit', () => {
  it('refuses a hijacked order before PayPal sees it, and the model is told why', async () => {
    const before = mock.state.orders.size;
    const g = guardToolkit(toolkit(), { owner, listedUnit: 80 });
    const r = await g.handleToolCall(lamp(8, { address_line_1: 'PO Box 404', admin_area_2: 'Silk Row', ...OWNER_POSTAL }));
    expect(body(r).error).toMatch(/refused/);
    expect(mock.state.orders.size).toBe(before);
    expect(g.decisions).toMatchObject([{ tool: 'create_order', allowed: false }]);
    expect(g.decisions[0].reason).toMatch(/mandate|ship|qty|budget/i);
  });

  it('lets the owner\'s order through, and captures only what it approved', async () => {
    const g = guardToolkit(toolkit(), { owner, listedUnit: 80 });
    const created = body(await g.handleToolCall(lamp()));
    expect(created.id).toMatch(/\w{10,}/);
    expect(mock.state.orders.get(created.id)?.amount).toBe(80);
    await approve(created.id);
    const paid = body(await g.handleToolCall(call('pay_order', { id: created.id })));
    expect(paid.error).toBeUndefined();
    expect(mock.state.orders.get(created.id)?.status).toBe('COMPLETED');
    expect(g.decisions.map((d) => [d.tool, d.allowed])).toEqual([['create_order', true], ['pay_order', true]]);
  });

  it('refuses to capture an order it never approved', async () => {
    const other = body(await toolkit().handleToolCall(lamp()) as { content: string });
    const g = guardToolkit(toolkit(), { owner });
    expect(body(await g.handleToolCall(call('pay_order', { id: other.id }))).error).toMatch(/never passed this gate/);
    expect(mock.state.orders.get(other.id)?.status).not.toBe('COMPLETED');
  });

  it('refuses to capture when PayPal holds a different amount than the gate approved', async () => {
    const g = guardToolkit(toolkit(), { owner, listedUnit: 80 });
    const created = body(await g.handleToolCall(lamp()));
    await approve(created.id);
    mock.state.orders.get(created.id)!.amount = 95;
    expect(body(await g.handleToolCall(call('pay_order', { id: created.id }))).error).toMatch(/reads back at \$95/);
    expect(mock.state.orders.get(created.id)?.status).not.toBe('COMPLETED');
  });

  it('refuses arguments that are not an object, and passes other tools through', async () => {
    const g = guardToolkit(toolkit(), { owner });
    expect(body(await g.handleToolCall({ id: 'x', function: { name: 'create_order', arguments: '[1]' } })).error).toMatch(/not a JSON object/);
    const created = body(await guardToolkit(toolkit(), { owner }).handleToolCall(lamp()));
    expect(body(await g.handleToolCall(call('get_order', { id: created.id }))).id).toBe(created.id);
  });

  it('the one-file bundle behaves the same', async () => {
    const bundled = await import('../../../examples/toolkit-guard/toolkit-guard.mjs');
    const g = bundled.guardToolkit(toolkit(), { owner, listedUnit: 80 });
    expect(body(await g.handleToolCall(lamp(8))).error).toMatch(/refused/);
    expect(body(await g.handleToolCall(lamp())).id).toMatch(/\w{10,}/);
  });

  it('knows its rulebooks by name and checks their hashes', () => {
    expect(guardRulebook('frozen-v4').enforceMandate).toBe(true);
    expect(() => guardRulebook('frozen-v9')).toThrow(/unknown rulebook/);
  });
});
