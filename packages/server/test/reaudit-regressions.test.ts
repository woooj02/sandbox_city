/**
 * Each case here failed on commit b3571f3. They come from a second outside review, which showed the durable checkout
 * was careful and the paths around it were not: the socket, the live adapter, reconciliation and webhooks.
 */
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRESETS, type CreateOrderInput } from '@sandbox-city/core';
import { JournalHistory } from '../src/history';
import { PaymentJournal, PaymentWorker, type DecisionContext } from '../src/payments';
import { SandboxRails } from '../src/paypal';
import { buildServer } from '../src/server';

const dir = () => mkdtempSync(join(tmpdir(), 'sc-reaudit-'));
const input: CreateOrderInput = {
  intent: 'CAPTURE', amount: 80, currency: 'USD', payeeMerchantId: 'M1', payerId: 'A1', card: { last4: '1111', state: 'ok', holder: 'A1' },
  item: { name: 'Lamp', sku: 'S1', unit: 80, qty: 1 }, shipTo: '12 Neon St, Silk Row', customId: 'p1',
};
const context = { session: 's1', owner: 'owner', rulebook: 'open', policy: 'test', evaluator: 'gate-2', decision: 'allow', escrow: false, merchant: 'M1', agent: 'A1', decidedAt: new Date().toISOString(), facts: {} } as unknown as DecisionContext;
const refund = (id: string, value: string, refundId = 'R1') => ({ id, event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: refundId, amount: { value }, links: [{ rel: 'up', href: 'https://x/v2/payments/captures/C1' }] } });
const captured = (path: string) => { const j = new PaymentJournal(path); j.put('p1', { state: 'captured', input, captureId: 'C1', context }); return j; };

describe('a malformed command cannot take the server down', () => {
  let app: Awaited<ReturnType<typeof buildServer>>, url: string;
  beforeAll(async () => {
    const d = dir();
    app = await buildServer({ rails: () => null, journalPath: join(d, 'p.log'), staticDir: join(d, 'none') });
    await app.listen({ host: '127.0.0.1', port: 0 });
    url = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws`;
  });
  afterAll(() => app.close());

  const open = () => new Promise<WebSocket>((res, rej) => { const ws = new WebSocket(url); ws.addEventListener('open', () => res(ws)); ws.addEventListener('error', () => rej(new Error('no socket'))); });
  const good = { cmd: 'init', seed: 'ok', chaos: 0, shoppers: 50, lanes: [{ policy: PRESETS.open }] };

  const bad: unknown[] = [
    null, 1, 'x', [], {}, { cmd: 5 }, { cmd: 'nope' }, { cmd: 'init' }, { cmd: 'init', seed: 's' }, { cmd: 'init', seed: 5, lanes: [{ policy: PRESETS.open }] },
    { cmd: 'init', seed: 's', lanes: 5 }, { cmd: 'init', seed: 's', lanes: [] }, { cmd: 'init', seed: 's', lanes: [null] }, { cmd: 'init', seed: 's', lanes: [{}] },
    { cmd: 'init', seed: 's', lanes: [{ policy: null }] }, { cmd: 'init', seed: 's', lanes: [{ policy: 'x' }] }, { cmd: 'init', seed: 's', lanes: [{ policy: { velocity: 'fast' } }] },
    { cmd: 'init', seed: 's', lanes: [{ policy: { name: 5 } }] }, { cmd: 'init', seed: 's', lanes: [{ policy: PRESETS.open }], genomes: 'x' },
    { cmd: 'init', seed: 's', lanes: [{ policy: PRESETS.open }], genomes: { sleeper_store: 5 }, shoppers: 50 }, { cmd: 'init', seed: 's', lanes: [{ policy: PRESETS.open }], brain: 5, shoppers: 50 },
    { cmd: 'speed' }, { cmd: 'speed', tps: 'fast' }, { cmd: 'speed', tps: null }, { cmd: 'tune' }, { cmd: 'tune', generations: 'x', children: {}, trainDays: [] },
    { cmd: 'forge' }, { cmd: 'forge', policy: null }, { cmd: 'forge', policy: 7 }, { cmd: 'whatif' }, { cmd: 'play' }, { cmd: 'pause' }, { cmd: 'tune_stop' }, { cmd: 'forge_stop' },
  ];

  it('answers every one of them, and the next client still gets a city', async () => {
    const ws = await open();
    const errors: string[] = [];
    ws.addEventListener('message', (e) => { const m = JSON.parse(String(e.data)); if (m.type === 'error') errors.push(m.message); });
    ws.send('{not json');
    for (const m of bad) ws.send(JSON.stringify(m));
    // wait for the answers, not for a guess at how long they take on a busy machine
    for (let waited = 0; errors.length <= 15 && waited < 8000; waited += 50) await new Promise((r) => setTimeout(r, 50));
    expect(errors.length).toBeGreaterThan(15);
    ws.close();

    const next = await open();
    const world = new Promise<boolean>((res) => next.addEventListener('message', (e) => { if (JSON.parse(String(e.data)).type === 'world') res(true); }));
    next.send(JSON.stringify(good));
    expect(await world).toBe(true);
    next.close();
    expect((await app.inject({ url: '/api/health' })).json().ok).toBe(true);
  }, 15000);
});

describe('a capture is money only when PayPal says COMPLETED', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const railsSaying = (status: string) => new SandboxRails({
    clientId: 'x', clientSecret: 'x', runId: 'r', base: 'https://provider.invalid',
    fetchImpl: (async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith('/v1/oauth2/token')) return json({ access_token: 'x', expires_in: 3600 });
      if (u.includes('/v1/reporting/')) return json({ name: 'NOT_AUTHORIZED' }, 403);
      if (u.includes('/v2/payments/captures/')) return json({ id: 'CP', status, amount: { currency_code: 'USD', value: '80.00' } });
      return json({ id: 'OP', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CP', status, amount: { currency_code: 'USD', value: '80.00' } }] } }] }, 201);
    }) as typeof fetch,
  });
  const reconcile = async (rails: SandboxRails, simCaptured: number) => {
    const d = dir();
    const app = await buildServer({ rails: () => null, journalPath: join(d, 's.log'), staticDir: join(d, 'none') });
    (app as unknown as { runs: Map<string, unknown> }).runs.set('run', { ledger: { runId: 'run', startedAt: Date.now(), captured: simCaptured, refunded: 0, orders: 1, refunds: 0, captureIds: new Set(['CP']) }, rails });
    const body = (await app.inject({ url: '/api/reconcile/run' })).json();
    await app.close();
    return body;
  };

  it('the live adapter reports a pending capture as pending, and counts no money', async () => {
    const rails = railsSaying('PENDING');
    const r = await rails.createOrder(input, 'k');
    expect(r.status).toBe('PENDING');
    expect(rails.observed()).toMatchObject({ captured: 0, captures: 0, unfinished: 1 });
  });

  it('reports a failed capture as declined', async () => {
    const rails = railsSaying('FAILED');
    expect((await rails.createOrder(input, 'k')).status).toBe('DECLINED');
    expect(rails.observed().captured).toBe(0);
  });

  it('never reconciles a pending capture, even when every total agrees', async () => {
    for (const sim of [0, 80]) {
      const rails = railsSaying('PENDING');
      await rails.createOrder(input, 'k');
      const body = await reconcile(rails, sim);
      expect(body.matched).toBe(false);
      expect(body.paypal.unfinished).toEqual([{ id: 'CP', status: 'PENDING' }]);
    }
  });

  it('still reconciles a completed capture', async () => {
    const rails = railsSaying('COMPLETED');
    await rails.createOrder(input, 'k');
    expect((await reconcile(rails, 80)).matched).toBe(true);
  });
});

describe('a partial refund keeps the rest of the payment', () => {
  it('$1 back on $80 leaves $79 at stake', () => {
    const j = captured(join(dir(), 'j.log'));
    const w = new PaymentWorker({} as never, j);
    expect(new JournalHistory(j).merchant('M1').exposure).toBe(80);
    expect(w.applyEvent(refund('E1', '1.00'))).toBe('applied');
    expect(j.get('p1')).toMatchObject({ state: 'captured', refunded: 1 });
    expect(new JournalHistory(j).merchant('M1').exposure).toBe(79);
  });

  it('adds refunds up until the payment is whole', () => {
    const j = captured(join(dir(), 'j.log'));
    const w = new PaymentWorker({} as never, j);
    w.applyEvent(refund('E1', '30.00', 'R1'));
    w.applyEvent(refund('E2', '50.00', 'R2'));
    expect(j.get('p1')).toMatchObject({ state: 'refunded', refunded: 80 });
    expect(new JournalHistory(j).merchant('M1').exposure).toBe(0);
  });

  it('cannot count one refund twice, by event id or by refund id', () => {
    const j = captured(join(dir(), 'j.log'));
    const w = new PaymentWorker({} as never, j);
    w.applyEvent(refund('E1', '30.00', 'R1'));
    expect(w.applyEvent(refund('E1', '30.00', 'R1'))).toBe('duplicate');
    expect(w.applyEvent(refund('E9', '30.00', 'R1'))).toBe('stale');
    expect(j.get('p1')?.refunded).toBe(30);
  });

  it('survives a restart', () => {
    const path = join(dir(), 'j.log');
    const j = captured(path);
    new PaymentWorker({} as never, j).applyEvent(refund('E1', '1.00'));
    j.close();
    const again = new PaymentJournal(path);
    expect(again.get('p1')).toMatchObject({ state: 'captured', refunded: 1, refundIds: ['R1'] });
    expect(new JournalHistory(again).merchant('M1').exposure).toBe(79);
  });

  it('will not guess at a refund that states no amount', () => {
    const j = captured(join(dir(), 'j.log'));
    const w = new PaymentWorker({} as never, j);
    const e = refund('E1', '1.00');
    delete (e.resource as { amount?: unknown }).amount;
    expect(w.applyEvent(e)).toBe('unknown');
    expect(j.get('p1')?.state).toBe('captured');
    expect(j.sawEvent('E1')).toBe(false);
  });
});

describe('a webhook and its effect are one durable write', () => {
  it('a crash before the write loses nothing: redelivery applies it', async () => {
    const path = join(dir(), 'j.log');
    const j = captured(path);
    const w = new PaymentWorker({} as never, j);
    j.put = () => { throw new Error('crash at the write'); };
    expect(() => w.applyEvent(refund('E1', '80.00'))).toThrow();
    j.close();
    const again = new PaymentJournal(path);
    expect(again.sawEvent('E1')).toBe(false);
    expect(new PaymentWorker({} as never, again).applyEvent(refund('E1', '80.00'))).toBe('applied');
    expect(again.get('p1')?.state).toBe('refunded');
  });

  it('a crash halfway through the line loses nothing: the torn line is cut and redelivery applies it', () => {
    const path = join(dir(), 'j.log');
    const j = captured(path);
    new PaymentWorker({} as never, j).applyEvent(refund('E1', '80.00'));
    j.close();
    const raw = readFileSync(path, 'utf8');
    writeFileSync(path, raw.slice(0, raw.length - 25));
    const again = new PaymentJournal(path);
    expect(again.get('p1')?.state).toBe('captured');
    expect(again.sawEvent('E1')).toBe(false);
    expect(new PaymentWorker({} as never, again).applyEvent(refund('E1', '80.00'))).toBe('applied');
  });

  it('a crash after the write repeats nothing: the event and the effect came back together', () => {
    const path = join(dir(), 'j.log');
    const j = captured(path);
    new PaymentWorker({} as never, j).applyEvent(refund('E1', '30.00'));
    j.close();
    const again = new PaymentJournal(path);
    expect(new PaymentWorker({} as never, again).applyEvent(refund('E1', '30.00'))).toBe('duplicate');
    expect(again.get('p1')?.refunded).toBe(30);
  });

  it('reads a journal written before events shared a line', () => {
    const path = join(dir(), 'j.log');
    captured(path).close();
    appendFileSync(path, `${JSON.stringify({ event: 'OLD' })}\n`);
    expect(new PaymentJournal(path).sawEvent('OLD')).toBe(true);
  });
});

describe('a value that refuses to become text gets a refusal, not a 500', () => {
  // found by an outside review: {"toString":null} is valid JSON, and a template string throws on it
  const poison = () => JSON.parse('{"toString":null}');
  const body = () => ({
    key: 'poison-1', rulebook: 'frozen-v4', listedUnit: 202.58,
    owner: { category: 'electronics', qty: 1, address: '679 Willow Row, Data Docks', budget: 304 },
    args: { currencyCode: 'USD', shippingCost: 0, discount: 0, items: [{ name: 'Velvet Earbuds', quantity: 1, itemCost: 202.58, itemTotal: 202.58, taxPercent: 0 }], shippingAddress: { address_line_1: '679 Willow Row, Data Docks', admin_area_1: 'CA', postal_code: '94107', country_code: 'US' } },
  });
  const leaves = (o: unknown, path: string[] = []): string[][] => (o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => [[...path, k], ...leaves(v, [...path, k])]) : []);
  const set = (o: Record<string, unknown>, path: string[], v: unknown) => { let x = o; for (const k of path.slice(0, -1)) x = x[k] as Record<string, unknown>; x[path.at(-1)!] = v; };

  it('every field of the request, one at a time', async () => {
    const app = await buildServer({ rails: () => null, journalPath: join(dir(), 'payments.log') });
    const paths = leaves(body());
    expect(paths.length).toBeGreaterThan(20);
    for (const [i, path] of paths.entries()) {
      const b = body() as unknown as Record<string, unknown>;
      set(b, path, poison());
      (b as { key: string }).key = `poison-${i}`;
      const res = await app.inject({ method: 'POST', url: '/api/checkout', payload: b });
      expect(res.statusCode, path.join('.')).toBeLessThan(500);
    }
    await app.close();
  });

  it('names the field and never reaches PayPal', async () => {
    const app = await buildServer({ rails: () => null, journalPath: join(dir(), 'payments.log') });
    const b = body();
    (b.args.items[0] as Record<string, unknown>).quantity = poison();
    const r = (await app.inject({ method: 'POST', url: '/api/checkout', payload: b })).json();
    expect(r.ok).toBe(false);
    expect(r.payment ?? null).toBeNull();
    expect(JSON.stringify(r)).toContain('quantity an object');
    await app.close();
  });
});

describe('a decision records which reader and which build made it', () => {
  // an outside review: parsing can change while a policy hash stays the same, so the hash alone does not name the code
  it('in the response, and nothing is invented when there is no build', async () => {
    const app = await buildServer({ rails: () => null, journalPath: join(dir(), 'payments.log') });
    const r = (await app.inject({ method: 'POST', url: '/api/checkout', payload: {
      key: 'reader-1', rulebook: 'frozen-v4', owner: { category: 'electronics', qty: 1, address: '679 Willow Row, Data Docks', budget: 304 },
      args: { currencyCode: 'USD', items: [{ name: 'Velvet Earbuds', quantity: 8, itemCost: 202.58, itemTotal: 1620.64 }], shippingAddress: { address_line_1: 'PO Box 404, Silk Row' } },
    } })).json();
    expect(r.reader).toBe('read-2');
    expect(r).toHaveProperty('source');
    await app.close();
  });

  it('an older decision without them is reported as unknown', async () => {
    const path = join(dir(), 'payments.log');
    captured(path);
    const app = await buildServer({ rails: () => null, journalPath: path });
    const r = (await app.inject({ url: '/api/payments/p1' })).json();
    expect(r.decision).toMatchObject({ reader: null, source: null, policy: 'test' });
    await app.close();
  });
});
