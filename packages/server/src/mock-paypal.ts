/**
 * Local contract mock of the PayPal REST endpoints Sandbox City uses. It is deliberately strict
 * (auth, amount formats, breakdown totals, idempotency, negative-testing header) so the real
 * adapter is exercised end-to-end without network access. Run standalone with `npm run mock-paypal`.
 */
import Fastify, { type FastifyInstance } from 'fastify';

interface Cap { id: string; amount: number; refunded: number; custom: string; invoice?: string; at: string }
interface Auth { id: string; amount: number; status: 'CREATED' | 'CAPTURED' | 'VOIDED'; custom: string; invoice?: string }

const id = () => Array.from({ length: 17 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 34)]).join('');
const err = (name: string, issue: string, status = 422) => ({ status, body: { name, message: issue, debug_id: id().toLowerCase(), details: [{ issue }] } });

export function buildMockPayPal(opts: { clientId?: string; clientSecret?: string } = {}): FastifyInstance & { state: { captures: Map<string, Cap>; auths: Map<string, Auth>; refunds: { id: string; capture: string; amount: number; at: string; custom: string }[]; requests: number } } {
  const app = Fastify() as unknown as FastifyInstance & { state: { captures: Map<string, Cap>; auths: Map<string, Auth>; refunds: { id: string; capture: string; amount: number; at: string; custom: string }[]; requests: number } };
  const cid = opts.clientId ?? 'mock-client', secret = opts.clientSecret ?? 'mock-secret';
  const tokens = new Set<string>();
  const idem = new Map<string, { status: number; body: unknown }>();
  const invoices = new Set<string>();
  const state = { captures: new Map<string, Cap>(), auths: new Map<string, Auth>(), refunds: [] as { id: string; capture: string; amount: number; at: string; custom: string }[], requests: 0 };
  app.decorate('state', state);
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_r, body, done) => done(null, body));

  app.post('/v1/oauth2/token', async (req, reply) => {
    const auth = req.headers.authorization ?? '';
    if (auth !== `Basic ${Buffer.from(`${cid}:${secret}`).toString('base64')}`) return reply.code(401).send({ error: 'invalid_client' });
    if (req.body !== 'grant_type=client_credentials') return reply.code(400).send({ error: 'unsupported_grant_type' });
    const t = `A21AA${id()}`;
    tokens.add(t);
    return { scope: 'https://uri.paypal.com/services/payments/payment', access_token: t, token_type: 'Bearer', app_id: 'APP-MOCK', expires_in: 32400, nonce: id() };
  });

  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/v1/oauth2')) return;
    state.requests++;
    const tok = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!tokens.has(tok)) return reply.code(401).send({ name: 'AUTHENTICATION_FAILURE', message: 'Authentication failed due to invalid authentication credentials' });
    reply.header('paypal-debug-id', id().toLowerCase());
  });

  /** Idempotency: same PayPal-Request-Id + same path => same response, no new side effects. */
  const once = (req: { headers: Record<string, unknown>; url: string }, fn: () => { status: number; body: unknown }) => {
    const rid = req.headers['paypal-request-id'] as string | undefined;
    const key = rid ? `${req.url}#${rid}` : null;
    if (key && idem.has(key)) return idem.get(key)!;
    const r = fn();
    if (key) idem.set(key, r);
    return r;
  };
  const money = (m: { value?: string; currency_code?: string } | undefined) => {
    if (!m || m.currency_code !== 'USD' || !/^\d+(\.\d{1,2})?$/.test(m.value ?? '')) return null;
    return Number(m.value);
  };

  app.post('/v2/checkout/orders', async (req, reply) => {
    const r = once(req as never, () => {
      const b = req.body as any;
      if (!['CAPTURE', 'AUTHORIZE'].includes(b?.intent)) return err('INVALID_REQUEST', 'INVALID_PARAMETER_VALUE', 400);
      const pu = b.purchase_units?.[0];
      const amount = money(pu?.amount);
      if (amount === null || amount <= 0) return err('UNPROCESSABLE_ENTITY', 'INVALID_AMOUNT');
      const itemTotal = money(pu.amount?.breakdown?.item_total);
      const sumItems = (pu.items ?? []).reduce((s: number, it: any) => s + Math.round((money(it.unit_amount) ?? NaN) * 100) * Number(it.quantity), 0) / 100;
      if (itemTotal === null || Math.abs(itemTotal - amount) > 0.001) return err('UNPROCESSABLE_ENTITY', 'AMOUNT_MISMATCH');
      if (Math.round(sumItems * 100) !== Math.round(itemTotal * 100)) return err('UNPROCESSABLE_ENTITY', 'ITEM_TOTAL_MISMATCH');
      if (!b.payment_source?.card?.number || !/^\d{4}-\d{2}$/.test(b.payment_source.card.expiry ?? '')) return err('INVALID_REQUEST', 'MISSING_REQUIRED_PARAMETER', 400);
      if (pu.invoice_id) { if (invoices.has(pu.invoice_id)) return err('UNPROCESSABLE_ENTITY', 'DUPLICATE_INVOICE_ID'); invoices.add(pu.invoice_id); }
      const mock = req.headers['paypal-mock-response'];
      if (mock) {
        const code = JSON.parse(String(mock)).mock_application_codes;
        return err('UNPROCESSABLE_ENTITY', code);
      }
      const oid = id(), at = new Date().toISOString();
      if (b.intent === 'AUTHORIZE') {
        const a: Auth = { id: id(), amount, status: 'CREATED', custom: pu.custom_id, invoice: pu.invoice_id };
        state.auths.set(a.id, a);
        return { status: 201, body: { id: oid, status: 'COMPLETED', purchase_units: [{ reference_id: pu.reference_id, payments: { authorizations: [{ id: a.id, status: 'CREATED', amount: pu.amount }] } }] } };
      }
      const c: Cap = { id: id(), amount, refunded: 0, custom: pu.custom_id, invoice: pu.invoice_id, at };
      state.captures.set(c.id, c);
      return { status: 201, body: { id: oid, status: 'COMPLETED', purchase_units: [{ reference_id: pu.reference_id, payments: { captures: [{ id: c.id, status: 'COMPLETED', amount: pu.amount, custom_id: pu.custom_id }] } }] } };
    });
    return reply.code(r.status).send(r.body);
  });

  app.post('/v2/payments/authorizations/:id/capture', async (req, reply) => {
    const r = once(req as never, () => {
      const a = state.auths.get((req.params as { id: string }).id);
      if (!a) return err('RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 404);
      if (a.status !== 'CREATED') return err('UNPROCESSABLE_ENTITY', 'AUTHORIZATION_ALREADY_CAPTURED');
      a.status = 'CAPTURED';
      const c: Cap = { id: id(), amount: a.amount, refunded: 0, custom: a.custom, invoice: a.invoice, at: new Date().toISOString() };
      state.captures.set(c.id, c);
      return { status: 201, body: { id: c.id, status: 'COMPLETED' } };
    });
    return reply.code(r.status).send(r.body);
  });

  app.post('/v2/payments/authorizations/:id/void', async (req, reply) => {
    const r = once(req as never, () => {
      const a = state.auths.get((req.params as { id: string }).id);
      if (!a) return err('RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 404);
      if (a.status !== 'CREATED') return err('UNPROCESSABLE_ENTITY', 'PREVIOUSLY_CAPTURED');
      a.status = 'VOIDED';
      return { status: 204, body: '' };
    });
    return reply.code(r.status).send(r.body || undefined);
  });

  app.post('/v2/payments/captures/:id/refund', async (req, reply) => {
    const r = once(req as never, () => {
      const c = state.captures.get((req.params as { id: string }).id);
      if (!c) return err('RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 404);
      const amt = money((req.body as any)?.amount) ?? c.amount - c.refunded;
      if (c.refunded + amt > c.amount + 0.001) return err('UNPROCESSABLE_ENTITY', 'REFUND_AMOUNT_EXCEEDED');
      c.refunded += amt;
      const rf = { id: id(), capture: c.id, amount: amt, at: new Date().toISOString(), custom: c.custom };
      state.refunds.push(rf);
      return { status: 201, body: { id: rf.id, status: 'COMPLETED' } };
    });
    return reply.code(r.status).send(r.body);
  });

  app.get('/v1/reporting/transactions', async (req) => {
    const q = req.query as Record<string, string>;
    if (!q.start_date || !q.end_date) return { name: 'INVALID_REQUEST' };
    const rows = [
      ...[...state.captures.values()].map((c) => ({ transaction_info: { transaction_id: c.id, transaction_event_code: 'T0006', transaction_amount: { value: c.amount.toFixed(2), currency_code: 'USD' }, custom_field: c.custom, invoice_id: c.invoice, transaction_status: 'S' } })),
      ...state.refunds.map((r) => ({ transaction_info: { transaction_id: r.id, transaction_event_code: 'T1107', transaction_amount: { value: (-r.amount).toFixed(2), currency_code: 'USD' }, custom_field: r.custom, transaction_status: 'S' } })),
    ];
    const size = Number(q.page_size ?? 100), page = Number(q.page ?? 1);
    return { transaction_details: rows.slice((page - 1) * size, page * size), total_pages: Math.max(1, Math.ceil(rows.length / size)), page };
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildMockPayPal({ clientId: process.env.PAYPAL_CLIENT_ID, clientSecret: process.env.PAYPAL_CLIENT_SECRET });
  const port = Number(process.env.MOCK_PORT ?? 8788);
  app.listen({ port, host: '0.0.0.0' }).then(() => console.log(`mock PayPal on http://localhost:${port}`));
}
