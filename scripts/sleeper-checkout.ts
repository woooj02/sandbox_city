/**
 * The benchmark's main failure, carried out of the simulation and through POST /api/checkout.
 *   npx tsx scripts/sleeper-checkout.ts                                  against the local PayPal contract mock
 *   npx tsx --env-file=.env scripts/sleeper-checkout.ts --sandbox        against the PayPal sandbox
 *
 * The inputs come from one simulated day: the sleeper's record at the minute it turns, and the orders it then took.
 * Under each rulebook those orders go through the real checkout. The store ships nothing, every buyer complains and
 * every window closes. An honest store with the same record ships the same orders, as the control.
 * The carrier and the complaint desk are this script, stated as such in the receipt. The money is PayPal's answer.
 * --rulebook=frozen-v4 runs another frozen rulebook. Only v3 carries a claim to check: another one's result is written whatever it is.
 * Writes packages/web/src/data/sleeper-checkout.json, or sleeper-checkout-v4.json for v4.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { DEFAULT_CONFIG, deriveKey, DEV_WORLD, evaluateOrder, policyId, PRESETS, requestPassport, World, type MerchantView, type Policy, type SimEvent } from '@sandbox-city/core';
import { buildMockPayPal, type MockPayPal } from '../packages/server/src/mock-paypal.ts';
import { SandboxRails } from '../packages/server/src/paypal.ts';
import { buildServer } from '../packages/server/src/server.ts';

const SEED = 'last-01', ORDERS = 6;
const sandbox = process.argv.includes('--sandbox');
let mock: MockPayPal | undefined, rails = () => SandboxRails.fromEnv();
if (sandbox) {
  if (!rails()) { console.error('--sandbox needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET'); process.exit(1); }
} else {
  mock = buildMockPayPal();
  await mock.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}`;
  rails = () => new SandboxRails({ clientId: 'mock-client', clientSecret: 'mock-secret', base });
}
const book = process.argv.find((a) => a.startsWith('--rulebook='))?.split('=')[1] ?? 'frozen-v3';
const frozen = JSON.parse(readFileSync(new URL(`../evidence/${book}.json`, import.meta.url), 'utf8'));
const v3: Policy = frozen.policy, bookName: string = frozen.policy.name;

/**
 * One simulated day, read from the sleeper's side: its record as it starts collecting, and the money it collected.
 * Time passes on a simulated day and not in this replay, so the record is taken the minute before the first order
 * the simulation really captured after the turn, with the age of that minute.
 */
async function theDay(policy: Policy) {
  const w = new World({ ...DEFAULT_CONFIG, ...DEV_WORLD, seed: SEED, policy });
  let id: string | undefined, record: MerchantView | undefined, before: MerchantView | undefined, minute = 0, turned = 0;
  const sold: { amount: number; qty: number }[] = [];
  await w.run((evs: SimEvent[]) => {
    for (const e of evs) {
      if (e.type === 'attack' && e.kind === 'sleeper_store' && e.note.includes('turns') && !id) {
        id = (w as unknown as { attackers: Map<string, { merchant: string }> }).attackers.get(e.attacker)!.merchant;
        turned = e.t;
      }
      if (e.type === 'order' && id && e.merchant === id && e.outcome === 'completed') {
        if (!record) { record = { ...(before ?? w.merchantView(id)), age: w.merchantView(id).age }; minute = e.t; }
        sold.push({ amount: e.amount, qty: e.qty });
      }
    }
    if (id) before = w.merchantView(id);
  });
  return { record, minute, turned, sold, turnedRecord: before };
}
// both rulebooks start from one record, the one the store earned where nothing slowed it down, so the only difference is the rulebook
const earned = await theDay(PRESETS.tuned), underV3 = await theDay(v3);
if (!earned.record) throw new Error(`no sleeper collected money on ${SEED}`);
const orders = earned.sold.slice(0, ORDERS);
if (orders.length < ORDERS) throw new Error(`only ${orders.length} orders after the turn`);
console.log(`${SEED}: the sleeper turns at minute ${earned.turned}. Under Lab-Tuned it starts collecting at minute ${earned.minute}, with $${earned.record.independent} of independent credit and $${earned.record.exposure} exposed, and collects ${earned.sold.length} orders`);
console.log(`${SEED}: under ${bookName} itself it collects ${underV3.sold.length} orders after the turn`);

const token = randomBytes(16).toString('hex');
const app = await buildServer({ rails, labToken: token, journalPath: join(mkdtempSync(join(tmpdir(), 'sc-sleeper-')), 'payments.log') });
await app.ready();
const run = `sl-${Date.now().toString(36)}`;
const event = async (payload: object) => {
  const res = await app.inject({ method: 'POST', url: '/api/history/events', headers: { authorization: `Bearer ${token}` }, payload });
  if (res.statusCode !== 200) throw new Error(`event refused: ${res.body}`);
  return res.json();
};
const address = { address_line_1: '12 Neon St', admin_area_2: 'Silk Row', admin_area_1: 'CA', postal_code: '94107', country_code: 'US' };
const ownerOf = (amount: number, qty: number) => ({ category: 'home', qty, address: '12 Neon St, Silk Row', budget: Math.ceil(amount) + 1 });
const source = `the sleeper's record at minute ${earned.minute} of simulated day ${SEED}, under Lab-Tuned`;
const r = earned.record!;

/** The orders the store took under one rulebook. Nothing is delivered unless `ships`. */
async function arm(label: string, rulebook: string, policy: Policy, ships: boolean) {
  const store = `${run}-${rulebook}-${ships ? 'honest' : 'sleeper'}`;
  await event({ type: 'import-merchant', id: store, source, age: r.age, verified: r.verified, orders: r.orders, deliveries: r.orders, fulfilled: r.fulfilled, independent: r.independent, exposure: r.exposure });
  const rows = [];
  let worstOverBound = -Infinity;
  for (const [i, o] of orders.entries()) {
    const agent = `${store}-buyer-${i}`, key = `${store}-${i}`;
    await event({ type: 'import-agent', id: agent, source: 'an established shopper, stated', age: 90000, orders: 40 });
    const unit = Math.round(o.amount / o.qty * 100) / 100;
    const res = await app.inject({ method: 'POST', url: '/api/checkout', payload: {
      key, rulebook, agent, merchant: store, owner: ownerOf(o.amount, o.qty),
      args: { items: [{ name: 'Sleeper listing', quantity: o.qty, itemCost: unit, itemTotal: Math.round(unit * o.qty * 100) / 100 }], shippingAddress: address },
    } });
    const a = res.json();
    if (!a.ok) throw new Error(`${key}: the gate stopped an honest-looking order: ${a.reason}`);
    if (a.policy !== policyId(policy)) throw new Error(`${key} answered with ${a.policy}`);
    // the facts the checkout saw, put through the evaluator directly, must give the same answer
    const passport = requestPassport(ownerOf(o.amount, o.qty), agent, deriveKey('replay', agent, 'ed25519'));
    const direct = evaluateOrder(policy, { amount: a.order.amount, qty: a.order.qty, category: 'home', shipTo: a.order.shipTo }, { verify: null, identity: agent, claimsPassportHolder: true, passport, agent: a.history.agent, merchant: a.history.merchant });
    if (direct.escrow !== a.escrow || direct.decision !== a.decision) throw new Error(`${key}: the checkout said ${a.decision}/${a.escrow}, the evaluator ${direct.decision}/${direct.escrow}`);
    const credit = (policy.independentCredit ? a.history.merchant.independent : a.history.merchant.fulfilled) ?? 0;
    if (policy.exposureRatio > 0) worstOverBound = Math.max(worstOverBound, a.history.merchant.exposure - (policy.exposureFloor + policy.exposureRatio * credit));
    rows.push({ key, amount: a.order.amount, escrow: a.escrow, exposureBefore: a.history.merchant.exposure, state: a.payment.state, orderId: a.payment.orderId, captureId: a.payment.captureId, authorizationId: a.payment.authorizationId, reason: a.payment.reason });
    console.log(`  ${label} order ${i + 1}: $${a.order.amount} ${a.escrow ? 'HELD' : 'paid'} -> ${a.payment.state} (store exposed $${a.history.merchant.exposure})`);
  }
  for (const row of rows) {
    if (ships) await event({ type: 'delivered', key: row.key });
    else await event({ type: 'complaint', key: row.key });
    const done = await event({ type: 'window-closed', key: row.key });
    Object.assign(row, { finalState: done.payment.state, steps: done.steps, finalCapture: done.payment.captureId, credited: done.payment.credited });
  }
  // what the provider says, not what the worker recorded
  const reader = rails()!;
  let captured = 0, charges = 0;
  for (const row of rows) {
    const o = await reader.readOrder(row.orderId);
    if (!o) throw new Error(`${row.key}: the provider has no such order`);
    Object.assign(row, { provider: { order: o.status, capture: o.captureStatus ?? null, authorization: o.authorizationStatus ?? null, address: o.address?.postal_code ?? null } });
    if (o.captureStatus === 'COMPLETED') { charges += o.captureCount ?? 0; captured += o.amount ?? 0; }
  }
  const total = rows.reduce((n, x) => n + x.amount, 0);
  const round = (n: number) => Math.round(n * 100) / 100;
  const store0 = (await app.inject({ url: `/api/history/merchants/${store}` })).json();
  return { label, rulebook, policy: policyId(policy), ships, store, rows, total: round(total), captured: round(captured), charges, keptByBuyers: round(total - captured), worstOverBound: policy.exposureRatio > 0 ? round(worstOverBound) : null, record: { exposure: store0.exposure, independent: store0.independent } };
}

const tuned = await arm('Lab-Tuned, sleeper', 'tuned', PRESETS.tuned, false);
const sleeper = await arm(`${bookName}, sleeper`, book, v3, false);
const honest = await arm(`${bookName}, honest store`, book, v3, true);

// the claim this proof exists for, checked here so a bad run writes no receipt
// Lab-Tuned captured these orders on the simulated day, so it must capture them here: this is the replay's own check
if (tuned.rows.some((x) => x.escrow)) throw new Error('Lab-Tuned held an order the simulated day captured: the replay does not match the day');
if (book === 'frozen-v3' && sleeper.captured >= tuned.captured) throw new Error(`Frozen v3 took $${sleeper.captured}, Lab-Tuned $${tuned.captured}`);
if ((sleeper.worstOverBound ?? 0) > 0) throw new Error(`exposure passed the bound by $${sleeper.worstOverBound}`);
if (book === 'frozen-v3' && honest.captured !== honest.total) throw new Error(`the honest store received $${honest.captured} of $${honest.total}`);
if (sleeper.rows.some((x) => x.escrow && (x as { provider?: { capture: string | null } }).provider?.capture)) throw new Error('a hold was captured');

const out = {
  mode: sandbox ? 'paypal-sandbox' : 'contract-mock', recordedAt: new Date().toISOString(), seed: SEED, turnMinute: earned.minute, evaluator: frozen.evaluator,
  policy: frozen.policyId, record: { independent: r.independent, fulfilled: r.fulfilled, exposure: r.exposure, age: Math.round(r.age), orders: r.orders }, simulatedDay: { turned: earned.turned, collectedUnderTuned: earned.sold.length, collectedUnderV3: underV3.sold.length }, bound: Math.round((v3.exposureFloor + v3.exposureRatio * (r.independent ?? 0)) * 100) / 100,
  stated: 'The record and order amounts come from a simulated day, and both rulebooks start from the record the store earned under Lab-Tuned. The carrier, the complaints and the window closing are this script. All stores settle to one sandbox business account.',
  arms: [tuned, sleeper, honest],
};
// a mock run prints its result, and only a sandbox run replaces the recorded receipt
if (sandbox) writeFileSync(new URL(`../packages/web/src/data/${book === 'frozen-v3' ? 'sleeper-checkout' : `sleeper-checkout-${book.split('-')[1]}`}.json`, import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`\n${out.mode}: of $${tuned.total} sold after the turn, the sleeper keeps $${tuned.captured} under Lab-Tuned and $${sleeper.captured} under ${bookName}. The honest store receives $${honest.captured} of $${honest.total}.`);
await app.close();
await mock?.close();
