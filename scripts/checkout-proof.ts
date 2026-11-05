/**
 * The frozen rulebook, outside the simulation: one exploit and one honest purchase through POST /api/checkout.
 *   npx tsx scripts/checkout-proof.ts            against the local PayPal contract mock
 *   npx tsx scripts/checkout-proof.ts --sandbox  against the PayPal sandbox (needs .env keys)
 * The rulebook id the checkout answers with must be the id the benchmark measured.
 * Writes packages/web/src/data/checkout-proof.json.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { buildMockPayPal, type MockPayPal } from '../packages/server/src/mock-paypal.ts';
import { SandboxRails } from '../packages/server/src/paypal.ts';
import { buildServer } from '../packages/server/src/server.ts';

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
const frozen = JSON.parse(readFileSync(new URL('../evidence/frozen-v3.json', import.meta.url), 'utf8'));
const app = await buildServer({ rails, journalPath: join(mkdtempSync(join(tmpdir(), 'sc-proof-')), 'payments.log') });
await app.ready();

const run = `proof-${Date.now().toString(36)}`;
const owner = { category: 'home', qty: 1, address: '12 Neon St, Silk Row', budget: 100 };
const addr = { address_line_1: '12 Neon St', admin_area_2: 'Silk Row', admin_area_1: 'CA', postal_code: '94107', country_code: 'US' };
const lamp = { name: 'Lamp', quantity: 1, itemCost: 80, itemTotal: 80 };
const steps: [string, string, object][] = [
  ['hijacked address', 'exploit', { key: `${run}-hijack`, args: { items: [lamp], shippingAddress: { ...addr, address_line_1: 'PO Box 404' } } }],
  ['hidden shipping', 'exploit', { key: `${run}-shipping`, args: { items: [lamp], shippingCost: 5000, shippingAddress: addr } }],
  ['honest purchase', 'honest', { key: `${run}-honest`, args: { items: [lamp], shippingAddress: addr } }],
  ['the same purchase retried', 'retry', { key: `${run}-honest`, args: { items: [lamp], shippingAddress: addr } }],
];
const rows = [];
for (const [label, kind, body] of steps) {
  const res = await app.inject({ method: 'POST', url: '/api/checkout', payload: { rulebook: 'frozen-v3', owner, listedUnit: 80, ...body } });
  const r = res.json();
  rows.push({ label, kind, decision: r.decision, reason: r.reason ?? null, policy: r.policy, replay: !!r.replay, payment: r.payment ? { state: r.payment.state, orderId: r.payment.orderId, captureId: r.payment.captureId, amount: r.payment.amount } : null });
  console.log(`${label}: ${r.decision}${r.reason ? ` (${r.reason})` : ''}${r.payment ? ` · ${r.payment.state} ${r.payment.captureId}` : ''}`);
}
const wrong = rows.find((r) => r.policy !== frozen.policyId);
if (wrong) throw new Error(`${wrong.label} answered with rulebook ${wrong.policy}, the benchmark measured ${frozen.policyId}`);
if (rows.slice(0, 2).some((r) => r.payment) || rows[2].payment?.state !== 'captured' || rows[3].payment?.captureId !== rows[2].payment?.captureId) throw new Error('the checkout did not behave as the proof says');
if (mock && mock.state.captures.size !== 1) throw new Error(`${mock.state.captures.size} charges`);

const out = { mode: sandbox ? 'paypal-sandbox' : 'contract-mock', recordedAt: new Date().toISOString(), policy: frozen.policyId, evaluator: frozen.evaluator, charges: mock?.state.captures.size ?? null, rows };
// a mock run prints its result, and only a sandbox run replaces the recorded receipt
if (sandbox) writeFileSync(new URL('../packages/web/src/data/checkout-proof.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`\n${out.mode}: rulebook ${out.policy} at the checkout, the same id the benchmark measured.`);
await app.close();
await mock?.close();
