import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, PRESETS, World, type Merchant, type OrderIntent, type OrderResult, type Rails, type SimEvent } from '../src';

type Rec = NonNullable<ReturnType<World['orders']['get']>>;
type Lifecycle = { process(o: OrderIntent): Promise<void>; captureHeld(r: Rec, m: Merchant): Promise<void>; voidHeld(r: Rec): Promise<void>; arrived(r: Rec): void; refund(r: Rec, reason: string, abuse: boolean): Promise<void> };

async function order(over: Partial<Rails> = {}, held = false, malicious = false) {
  const rails: Rails = {
    name: 'sandbox',
    createOrder: vi.fn(async (): Promise<OrderResult> => ({ id: 'O1', status: 'COMPLETED', ...(held ? { authorizationId: 'A1' } : { captureId: 'C1', captureStatus: 'COMPLETED' }), debugId: 'D1', rail: 'sandbox' })),
    captureAuthorization: vi.fn(async () => ({ captureId: 'C1', status: 'COMPLETED' })),
    voidAuthorization: vi.fn(async () => ({ status: 'VOIDED' })),
    refundCapture: vi.fn(async () => ({ refundId: 'R1', status: 'COMPLETED' })),
    ...over,
  };
  const w = new World({ ...DEFAULT_CONFIG, seed: 'live-settlement', shoppers: 10, merchants: 3, attackers: {}, heroes: 0, ticks: 1, chaos: 0, crypto: 'modeled', liveRails: rails, liveSample: 1, policy: { ...PRESETS.open, idempotencyKeys: true, escrowNewMerchants: held ? 720 : 0 } });
  const api = w as unknown as Lifecycle;
  const s = [...w.shoppers.values()][0], m = [...w.merchants.values()][0];
  m.openedAt = 0;
  const events: SimEvent[] = [];
  w.on((batch) => events.push(...batch));
  const input: OrderIntent = { id: 'local-1', t: 0, buyer: s.id, claimedAgent: s.id, merchant: m.id, sku: m.catalog[0].sku, category: m.catalog[0].category, qty: 1, unit: 50, amount: 50, shipTo: s.address, request: null, truth: malicious ? { malicious: true, attack: 'prompt_injection', hijacked: true, harm: 50 } : { malicious: false, harm: 0 } };
  await api.process(input);
  return { w, api, m, rails, events, rec: w.orders.get(input.id)! };
}

describe('live-city settlement waits for confirmation', () => {
  it.each(['PENDING', 'DECLINED', 'FAILED', 'UNKNOWN'])('a held capture answering %s is not a capture or a saving', async (status) => {
    const { w, api, m, rec } = await order({ captureAuthorization: vi.fn(async () => ({ captureId: 'C1', status })) }, true, true);
    await api.captureHeld(rec, m);
    expect(rec.amountHeld).toBe(50);
    expect(rec.captureBooked).toBeFalsy();
    expect(rec.state).toBe(status === 'PENDING' ? 'pending' : 'unresolved');
    expect(w.snapshot().fraud).toMatchObject({ leaked: 0, prevented: 0 });
    expect(w.snapshot().money.heldNow).toBe(50);
  });

  it.each(['throw', 'PENDING', 'FAILED'])('a void that returns %s keeps the hold unresolved', async (status) => {
    const { w, api, rec } = await order({ voidAuthorization: vi.fn(async () => { if (status === 'throw') throw new Error('lost response'); return { status }; }) }, true, true);
    await api.voidHeld(rec);
    expect(rec).toMatchObject({ state: 'unresolved', amountHeld: 50 });
    expect(rec.voided).toBeFalsy();
    expect(w.snapshot().fraud.prevented).toBe(0);
    expect((await w.settle(0)).settled).toBe(false);
  });

  it('a confirmed void ends a hold and counts prevention once', async () => {
    const { w, api, rec, rails } = await order({}, true, true);
    await api.voidHeld(rec);
    await api.voidHeld(rec);
    expect(rec).toMatchObject({ state: 'voided', amountHeld: 0, voided: true });
    expect(w.snapshot().fraud.prevented).toBe(50);
    expect(rails.voidAuthorization).toHaveBeenCalledTimes(1);
  });

  it('a pending initial capture is retained and later repairs access and cash exactly once', async () => {
    let status = 'PENDING';
    const { w, rec, rails } = await order({
      createOrder: vi.fn(async (): Promise<OrderResult> => ({ id: 'O1', status: 'PENDING', captureId: 'C1', captureStatus: 'PENDING', debugId: '', rail: 'sandbox' })),
      getPayment: vi.fn(async () => ({ id: 'C1', status, amount: 50 })),
    });
    expect(rec.state).toBe('pending');
    expect(w.merchantView(rec.intent.merchant).exposure).toBe(50);
    expect(w.snapshot().honest).toMatchObject({ completed: 0, gmv: 0, declined: 0, fulfilledValue: 0 });
    await w.pollPayments();
    expect(w.snapshot().honest.gmv).toBe(0);
    status = 'COMPLETED';
    const confirmed = await w.pollPayments();
    const second = await w.pollPayments();
    expect(rec.state).toBe('captured');
    expect(w.snapshot().honest).toMatchObject({ completed: 1, gmv: 50 });
    expect(w.merchantView(rec.intent.merchant).exposure).toBe(50);
    expect(confirmed.filter((e) => e.type === 'capture')).toHaveLength(1);
    expect(second.filter((e) => e.type === 'capture')).toHaveLength(0);
    expect(rails.createOrder).toHaveBeenCalledTimes(1);
  });

  it('later completion of a held capture counts delivered value and theft once', async () => {
    const { w, api, rec, m } = await order({ captureAuthorization: vi.fn(async () => ({ captureId: 'C1', status: 'PENDING' })), getPayment: vi.fn(async () => ({ id: 'C1', status: 'COMPLETED', amount: 50 })) }, true);
    api.arrived(rec);
    expect(w.snapshot().honest.fulfilledValue).toBe(0);
    await api.captureHeld(rec, m);
    const first = await w.pollPayments();
    const second = await w.pollPayments();
    expect(rec).toMatchObject({ state: 'captured', amountHeld: 0 });
    expect(w.snapshot().honest.fulfilledValue).toBe(50);
    expect(first.filter((e) => e.type === 'capture')).toHaveLength(1);
    expect(second.filter((e) => e.type === 'capture')).toHaveLength(0);
  });

  it('a pending attack is neither prevented nor leaked until the capture completes', async () => {
    const { w } = await order({ createOrder: vi.fn(async (): Promise<OrderResult> => ({ id: 'O1', status: 'PENDING', captureId: 'C1', captureStatus: 'PENDING', debugId: '', rail: 'sandbox' })), getPayment: vi.fn(async () => ({ id: 'C1', status: 'COMPLETED', amount: 50 })) }, false, true);
    expect(w.snapshot().fraud).toMatchObject({ leaked: 0, prevented: 0 });
    await Promise.all([w.reconcilePending(), w.reconcilePending()]);
    expect(w.snapshot().fraud).toMatchObject({ leaked: 50, prevented: 0 });
  });

  it.each([{ id: 'OTHER', status: 'COMPLETED', amount: 50 }, { id: 'C1', status: 'COMPLETED', amount: 49 }, { id: 'C1', status: 'COMPLETED', amount: 50.001 }, { id: 'C1', status: 'DECLINED', amount: 50 }])('does not turn a mismatched or declined read-back into money: %j', async (payment) => {
    const { w, rec } = await order({ createOrder: vi.fn(async (): Promise<OrderResult> => ({ id: 'O1', status: 'PENDING', captureId: 'C1', captureStatus: 'PENDING', debugId: '', rail: 'sandbox' })), getPayment: vi.fn(async () => payment) });
    await w.pollPayments();
    expect(rec.state).toBe('unresolved');
    expect(w.snapshot().honest.gmv).toBe(0);
  });

  it('a pending refund is counted only on later completion, once', async () => {
    let status = 'PENDING';
    const { w, api, rec, rails } = await order({ refundCapture: vi.fn(async () => ({ refundId: 'R1', status: 'PENDING' })), getPayment: vi.fn(async () => ({ id: 'R1', status, amount: 50 })) });
    api.arrived(rec);
    await api.refund(rec, 'return', false);
    expect(rec.refunded).toBe(false);
    expect(w.snapshot().refunds.legitApproved).toBe(0);
    expect(w.snapshot().honest.fulfilledValue).toBe(50);
    status = 'COMPLETED';
    await w.pollPayments();
    await w.pollPayments();
    expect(rec.refunded).toBe(true);
    expect(w.snapshot().refunds.legitApproved).toBe(1);
    expect(w.snapshot().honest.fulfilledValue).toBe(0);
    expect(rails.refundCapture).toHaveBeenCalledTimes(1);
  });
});
