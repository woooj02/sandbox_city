import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, PRESETS, World, type CreateOrderInput, type OrderIntent } from '@sandbox-city/core';
import { SandboxRails } from '../src/paypal';
import { sandboxMoves, type LiveLedger } from '../src/server';

const input: CreateOrderInput = { intent: 'CAPTURE', amount: 50, currency: 'USD', payerId: 'buyer', payeeMerchantId: 'store', card: { last4: '1111', state: 'ok', holder: 'buyer' }, item: { name: 'Lamp', sku: 'lamp', unit: 50, qty: 1 }, shipTo: '12 Neon St, Silk Row', customId: 'one' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

describe('live payment confirmation reaches both city ledgers', () => {
  it('repairs pending money once in the World, server ledger and adapter, without another charge', async () => {
    let status = 'PENDING', creates = 0;
    const rails = new SandboxRails({ clientId: 'x', clientSecret: 'x', runId: 'local', base: 'https://provider.invalid', fetchImpl: (async (url: string | URL) => {
      if (String(url).endsWith('/v1/oauth2/token')) return json({ access_token: 'x', expires_in: 3600 });
      if (String(url).includes('/v2/payments/captures/')) return json({ id: 'C1', status, amount: { value: '50.00' } });
      creates++;
      return json({ id: 'O1', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'C1', status: 'PENDING' }] } }] }, 201);
    }) as typeof fetch });
    const w = new World({ ...DEFAULT_CONFIG, seed: 'pending-ledger', shoppers: 10, merchants: 3, attackers: {}, heroes: 0, crypto: 'modeled', chaos: 0, liveRails: rails, liveSample: 1, policy: PRESETS.open });
    const ledger: LiveLedger = { runId: 'local', startedAt: Date.now(), captured: 0, refunded: 0, orders: 0, refunds: 0, captureIds: new Set() };
    const buyer = [...w.shoppers.values()][0], store = [...w.merchants.values()][0];
    const o: OrderIntent = { id: 'one', t: 0, buyer: buyer.id, claimedAgent: buyer.id, merchant: store.id, sku: 'lamp', category: store.catalog[0].category, qty: 1, unit: 50, amount: 50, shipTo: buyer.address, request: null, truth: { malicious: false, harm: 0 } };
    await (w as unknown as { process(o: OrderIntent): Promise<void> }).process(o);
    sandboxMoves(ledger, await w.pollPayments());
    expect(ledger.captured).toBe(0);
    expect(rails.observed().captured).toBe(0);
    status = 'COMPLETED';
    sandboxMoves(ledger, await w.pollPayments());
    sandboxMoves(ledger, await w.pollPayments());
    expect(w.snapshot().honest).toMatchObject({ completed: 1, gmv: 50 });
    expect(ledger).toMatchObject({ captured: 50, orders: 1 });
    expect(ledger.captureIds.has('C1')).toBe(true);
    expect(rails.observed()).toMatchObject({ captured: 50, captures: 1, unfinished: 0 });
    expect(creates).toBe(1);
  });

  it.each([{}, { authorizations: [{ id: 'A1', status: 'PENDING' }] }, { captures: [{ id: 'C1', status: 'PENDING' }] }])('does not mistake an outer COMPLETED order for settled funds: %j', async (payments) => {
    const rails = new SandboxRails({ clientId: 'x', clientSecret: 'x', base: 'https://provider.invalid', fetchImpl: (async (url: string | URL) => String(url).endsWith('/v1/oauth2/token') ? json({ access_token: 'x', expires_in: 3600 }) : json({ id: 'O1', status: 'COMPLETED', purchase_units: [{ payments }] })) as typeof fetch });
    expect((await rails.createOrder(input, 'one')).status).toBe('PENDING');
    expect(rails.observed().captured).toBe(0);
  });

  it('a refunded capture still records the original gross payment after read-back', async () => {
    const rails = new SandboxRails({ clientId: 'x', clientSecret: 'x', base: 'https://provider.invalid', fetchImpl: (async (url: string | URL) => String(url).endsWith('/v1/oauth2/token') ? json({ access_token: 'x', expires_in: 3600 }) : json({ id: 'C1', status: 'REFUNDED', amount: { value: '50.00' } })) as typeof fetch });
    await rails.getPayment('capture', 'C1');
    expect(rails.observed()).toMatchObject({ captured: 50, captures: 1, unfinished: 0 });
  });
});
