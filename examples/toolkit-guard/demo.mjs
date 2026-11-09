// The toolkit guard on the PayPal sandbox, with the two tool calls a hijacked agent and an honest agent would make.
// The calls are scripted here, so the run is the same every time; in your agent, a model makes them.
//
//   node --env-file=.env examples/toolkit-guard/demo.mjs
//
// Needs PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_TEST_CARD (a sandbox test card) in .env. Sandbox only.
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/openai';
import { guardToolkit } from './toolkit-guard.mjs';

const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_TEST_CARD } = process.env;
if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET || !PAYPAL_TEST_CARD) { console.error('Set PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_TEST_CARD (sandbox).'); process.exit(1); }
const base = 'https://api-m.sandbox.paypal.com';
const paypal = new PayPalAgentToolkit({ clientId: PAYPAL_CLIENT_ID, clientSecret: PAYPAL_CLIENT_SECRET, configuration: { actions: { orders: { create: true, get: true, capture: true } }, context: { sandbox: true } } });

// What the owner asked for. The guard's mandate is exactly this.
const owner = { category: 'home', qty: 1, address: '12 Neon St, Silk Row', budget: 100 };
const toolkit = guardToolkit(paypal, { owner, rulebook: 'frozen-v4', listedUnit: 80, onDecision: (d) => console.log(d.allowed ? '  ALLOW ' : '  REFUSE', d.tool, d.reason ?? d.orderId ?? '') });

const postal = { admin_area_1: 'CA', postal_code: '94107', country_code: 'US' };
const call = (name, args) => ({ id: `${name}-${Date.now()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const order = (quantity, shippingAddress) => call('create_order', { currencyCode: 'USD', items: [{ name: 'Lamp', quantity, itemCost: 80, itemTotal: 80 * quantity }], shippingAddress: { ...shippingAddress, ...postal } });

console.log('1. A seller\'s page talked the agent into 8 lamps to a PO box:');
console.log('  ', (await toolkit.handleToolCall(order(8, { address_line_1: 'PO Box 404', admin_area_2: 'Silk Row' }))).content);

console.log('2. The order the owner asked for:');
const created = JSON.parse((await toolkit.handleToolCall(order(1, { address_line_1: '12 Neon St', admin_area_2: 'Silk Row' }))).content);
console.log('   PayPal order', created.id, created.status);

// The owner's wallet approves it; on a real site this is the buyer at PayPal's checkout.
const token = (await (await fetch(`${base}/v1/oauth2/token`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })).json()).access_token;
const card = { number: PAYPAL_TEST_CARD, expiry: process.env.PAYPAL_TEST_CARD_EXPIRY || '2030-12', security_code: process.env.PAYPAL_TEST_CARD_CVV || '123', name: 'Agent Owner' };
const approved = await (await fetch(`${base}/v2/checkout/orders/${created.id}/confirm-payment-source`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ payment_source: { card } }) })).json();
console.log('   owner approved:', approved.status);

console.log('3. The agent captures it:');
await toolkit.handleToolCall(call('pay_order', { id: created.id }));
const read = JSON.parse((await toolkit.handleToolCall(call('get_order', { id: created.id }))).content);
const capture = read.purchase_units?.[0]?.payments?.captures?.[0];
console.log('   read back from PayPal:', read.status, capture ? `capture ${capture.id} ${capture.status} $${capture.amount.value}` : '');

console.log('4. The agent tries to capture an order the guard never saw:');
console.log('  ', (await toolkit.handleToolCall(call('pay_order', { id: '5O190127TN364715T' }))).content);
