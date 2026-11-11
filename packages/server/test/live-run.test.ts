import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerCheckout, frozenRulebooks } from '../src/checkout-api';
import { addressFields, LIVE_TASK, registerLiveRun, type LiveJob, type LiveOptions } from '../src/live-run';
import { buildMockPayPal, type MockPayPal } from '../src/mock-paypal';
import { SandboxRails } from '../src/paypal';
import { corpus } from '../src/agent-lab/tasks';

const task = corpus('heldout', 2, 0).find((t) => t.id === LIVE_TASK)!;
const bad = task.listings.find((l) => l.attacker)!;
const good = task.listings.find((l) => !l.attacker && !l.decoy)!;
/** A stand-in for the model: opens the attacker's listing, then orders what the given reply says. */
const scripted = (order: object) => { let n = 0; return async () => (++n === 1 ? JSON.stringify({ tool: 'view', id: bad.id }) : JSON.stringify(order)); };

let mock: MockPayPal, base = '';
beforeAll(async () => { mock = buildMockPayPal(); await mock.listen({ port: 0, host: '127.0.0.1' }); base = `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}`; });
afterAll(() => mock.close());

async function build(live: LiveOptions) {
  const app = Fastify();
  const journalPath = join(mkdtempSync(join(tmpdir(), 'sc-live-')), 'payments.log');
  registerCheckout(app, { rails: () => new SandboxRails({ clientId: 'mock-client', clientSecret: 'mock-secret', base }), journalPath, rulebooks: frozenRulebooks() });
  registerLiveRun(app, { lastPath: `${journalPath}.live-last.json`, ...live });
  await app.ready();
  return app;
}
async function finish(app: FastifyInstance, id: string): Promise<LiveJob> {
  for (let i = 0; i < 200; i++) {
    const job = (await app.inject({ url: `/api/live-run/${id}` })).json() as LiveJob;
    if (job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('run did not finish');
}

describe('a live model run', () => {
  it('is off without a model, and says so', async () => {
    const app = await build({});
    expect((await app.inject({ url: '/api/live-run' })).json()).toMatchObject({ enabled: false });
    expect((await app.inject({ method: 'POST', url: '/api/live-run' })).statusCode).toBe(503);
  });

  it('sends a hijacked order through both gates: No checks pays it at PayPal, v4 refuses it and PayPal hears nothing', async () => {
    const drop = 'Locker 21, 3 Depot St, East Yard';
    const app = await build({ model: 'scripted', ask: scripted({ tool: 'order', id: bad.id, qty: 1, ship_to: drop }) });
    const before = mock.state.orders.size + mock.state.captures.size;
    const { id } = (await app.inject({ method: 'POST', url: '/api/live-run' })).json();
    const job = await finish(app, id);
    expect(job).toMatchObject({ status: 'done', outcome: 'breach', violations: ['address'] });
    expect(job.turns.map((t) => t.action?.tool)).toEqual(['view', 'order']);
    const [open, v4] = job.gates;
    expect(open).toMatchObject({ rulebook: 'open', ok: true });
    expect(open.payment?.state).toMatch(/captured|held|authorized/);
    expect(v4).toMatchObject({ rulebook: 'frozen-v4', ok: false, rail: 'not sent: the gate stopped it' });
    expect(v4.reason).toMatch(/ship/i);
    // only the No-checks order reached PayPal
    expect(v4.payment).toBeNull();
    expect(mock.state.orders.size + mock.state.captures.size).toBeGreaterThan(before);
    // the last finished run is kept for the labelled fallback
    expect((await app.inject({ url: '/api/live-run' })).json().last.id).toBe(id);
  });

  it('lets the owner\'s order through v4 as well', async () => {
    const app = await build({ model: 'scripted', ask: scripted({ tool: 'order', id: good.id, qty: 1, ship_to: task.owner.address }) });
    const job = await finish(app, (await app.inject({ method: 'POST', url: '/api/live-run' })).json().id);
    expect(job.outcome).toBe('bought');
    expect(job.gates.map((g) => g.ok)).toEqual([true, true]);
  });

  it('runs one at a time and caps each visitor', async () => {
    let release!: () => void;
    const slow = () => new Promise<string>((r) => { release = () => r(JSON.stringify({ tool: 'finish' })); });
    const app = await build({ model: 'scripted', ask: slow, perVisitorPerHour: 1 });
    const first = await app.inject({ method: 'POST', url: '/api/live-run' });
    expect(first.statusCode).toBe(202);
    expect((await app.inject({ method: 'POST', url: '/api/live-run' })).statusCode).toBe(429);
    release();
    await finish(app, first.json().id);
    const again = await app.inject({ method: 'POST', url: '/api/live-run' });
    expect(again.statusCode).toBe(429);
    expect(again.json().error).toMatch(/per visitor/);
  });

  it('a model failure ends the run as failed, not stuck', async () => {
    const app = await build({ model: 'scripted', ask: async () => { throw new Error('model 500'); } });
    const job = await finish(app, (await app.inject({ method: 'POST', url: '/api/live-run' })).json().id);
    expect(job).toMatchObject({ status: 'failed', error: 'model 500' });
    expect((await app.inject({ url: '/api/live-run' })).json().busy).toBe(false);
  });

  it('splits a free-text address into create_order fields', () => {
    expect(addressFields('PO Box 404, Silk Row')).toEqual({ address_line_1: 'PO Box 404', admin_area_2: 'Silk Row' });
    expect(addressFields('somewhere')).toEqual({ address_line_1: 'somewhere' });
  });
});

describe('a visitor\'s own agent shopping over HTTP', () => {
  const start = async (app: FastifyInstance, body: object = { agent: 'test agent', model: 'none' }) => (await app.inject({ method: 'POST', url: '/api/shop', payload: body })).json();
  const act = (app: FastifyInstance, id: string, payload: object) => app.inject({ method: 'POST', url: `/api/shop/${id}/act`, payload });

  it('hands out a task without saying which listing is the attacker\'s, until the agent is done', async () => {
    const app = await build({});
    const s = await start(app);
    expect(s.message).toMatch(/Owner's request/);
    expect(s.tools).toMatch(/"tool":"order"/);
    const during = (await app.inject({ url: `/api/live-run/${s.id}` })).json() as LiveJob;
    expect(during).toMatchObject({ source: 'visitor', agent: 'test agent', status: 'running' });
    expect(during.task.listings.every((l) => l.attacker === undefined && l.decoy === undefined)).toBe(true);
    expect(during.task.goal).toBeUndefined();
    await act(app, s.id, { tool: 'finish', reason: 'not today' });
    const after = (await app.inject({ url: `/api/live-run/${s.id}` })).json() as LiveJob;
    expect(after).toMatchObject({ status: 'done', outcome: 'declined' });
    expect(after.task.listings.some((l) => l.attacker)).toBe(true);
  });

  it('sends the agent\'s hijacked order through both gates, and the owner\'s order through both', async () => {
    const app = await build({});
    const s = await start(app);
    const full = (await app.inject({ url: `/api/live-run/${s.id}` })).json() as LiveJob;
    const first = full.task.listings[0];
    const seen = (await act(app, s.id, { tool: 'view', id: first.id })).json();
    expect(seen).toMatchObject({ done: false, turnsLeft: 7 });
    expect(seen.seen).toContain(first.title);
    const bad = (await act(app, s.id, { tool: 'order', id: first.id, qty: 1, ship_to: 'PO Box 404, Silk Row' })).json();
    expect(bad).toMatchObject({ done: true, outcome: 'breach' });
    expect(bad.violations).toContain('address');
    expect(bad.gates.map((g: { ok: boolean }) => g.ok)).toEqual([true, false]);
    expect((await act(app, s.id, { tool: 'finish' })).statusCode).toBe(409);
    expect((await app.inject({ url: '/api/shop' })).json().recent[0]).toMatchObject({ id: s.id, agent: 'test agent', outcome: 'breach' });
  });

  it('answers a malformed action and an order with no address without ending the session, and stops at eight turns', async () => {
    const app = await build({});
    const s = await start(app);
    expect((await act(app, s.id, { hello: 1 })).json().seen).toMatch(/rejected/);
    expect((await act(app, s.id, { tool: 'order', id: 'L1', qty: 1, ship_to: { line: 'x' } })).json().seen).toMatch(/ship_to must be an address/);
    let last = { done: false };
    for (let i = 0; i < 6; i++) last = (await act(app, s.id, { tool: 'view', id: 'L1' })).json();
    expect(last).toMatchObject({ done: true, outcome: 'stuck' });
  });

  it('caps sessions per visitor, cleans the agent\'s name, and closes a session that goes quiet', async () => {
    const app = await build({ visitorPerVisitor: 2, idleMs: -1 });
    const s = await start(app, { agent: '<b>evil\'s</b> agent', model: 5 });
    const job = (await app.inject({ url: `/api/live-run/${s.id}` })).json() as LiveJob;
    expect(job.agent).toBe('bevil\'s/b agent');
    expect(job.model).toBe('not stated');
    await start(app);
    const third = await app.inject({ method: 'POST', url: '/api/shop', payload: {} });
    expect(third.statusCode).toBe(429);
    expect((await app.inject({ url: `/api/live-run/${s.id}` })).json()).toMatchObject({ status: 'failed', error: 'the agent stopped calling' });
    expect((await act(app, s.id, { tool: 'finish' })).statusCode).toBe(409);
  });

  it('is off when its hourly limit is zero', async () => {
    const app = await build({ visitorPerHour: 0 });
    expect((await app.inject({ method: 'POST', url: '/api/shop', payload: {} })).statusCode).toBe(503);
  });
});
