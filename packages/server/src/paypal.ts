/**
 * Real PayPal sandbox rails: Orders v2 + Payments v2 over REST.
 *
 * Agents pay server-side with a card payment_source (no buyer redirect), every call carries a
 * PayPal-Request-Id for idempotent retries, and risk declines decided by the twin's risk model are
 * enacted through PayPal's own negative-testing header (PayPal-Mock-Response) so the decline comes
 * back from PayPal itself.
 */
import { RailsError, type CreateOrderInput, type OrderResult, type Rails } from '@sandbox-city/core';

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  base?: string; // https://api-m.sandbox.paypal.com
  /** Sandbox business accounts that receive payments, assigned to city stores round-robin. */
  payeeEmails?: string[];
  card?: { number: string; expiry: string; securityCode: string };
  maxConcurrent?: number;
  fetchImpl?: typeof fetch;
}

export interface CallLog { at: number; method: string; path: string; status: number; ms: number; requestId?: string; debugId?: string }

export class SandboxRails implements Rails {
  readonly name = 'sandbox' as const;
  private token: { value: string; exp: number } | null = null;
  private base: string;
  private inflight = 0;
  private queue: (() => void)[] = [];
  private payee = new Map<string, string>();
  readonly calls: CallLog[] = [];
  private f: typeof fetch;
  /** Namespaces idempotency keys and invoice ids per run, so replaying a seed never collides at PayPal. */
  runId = `r${Date.now().toString(36)}`;
  onCall?: (c: CallLog) => void;
  /** Fired as a request leaves for PayPal, so a UI can show the call in flight. */
  onStart?: (c: { method: string; path: string; requestId?: string }) => void;
  /** Every capture and refund PayPal reported back to this adapter, keyed by PayPal id, so idempotent replays count once.
   *  Includes responses the sim never saw (e.g. a timeout after PayPal had already committed). */
  readonly moves = new Map<string, { kind: 'capture' | 'refund'; id: string; amount: number }>();
  private authAmount = new Map<string, number>();

  constructor(private cfg: PayPalConfig) {
    this.base = cfg.base ?? 'https://api-m.sandbox.paypal.com';
    this.f = cfg.fetchImpl ?? fetch;
  }

  static fromEnv(env = process.env): SandboxRails | null {
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) return null;
    return new SandboxRails({
      clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET, base: env.PAYPAL_API_BASE,
      payeeEmails: env.PAYPAL_PAYEE_EMAILS?.split(',').map((s) => s.trim()).filter(Boolean),
      card: env.PAYPAL_TEST_CARD ? { number: env.PAYPAL_TEST_CARD, expiry: env.PAYPAL_TEST_CARD_EXPIRY ?? '2030-12', securityCode: env.PAYPAL_TEST_CARD_CVV ?? '123' } : undefined,
    });
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    const max = this.cfg.maxConcurrent ?? 4;
    if (this.inflight >= max) await new Promise<void>((r) => this.queue.push(r));
    this.inflight++;
    try { return await fn(); } finally { this.inflight--; this.queue.shift()?.(); }
  }

  async accessToken(): Promise<string> {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const res = await this.f(`${this.base}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new RailsError(res.status, `OAUTH_FAILED ${await res.text()}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  async call<T>(method: string, path: string, body?: unknown, requestId?: string, extra: Record<string, string> = {}): Promise<{ status: number; json: T; debugId?: string }> {
    return this.slot(async () => {
      const t0 = Date.now();
      const headers: Record<string, string> = { Authorization: `Bearer ${await this.accessToken()}`, Prefer: 'return=representation', ...extra };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (requestId) headers['PayPal-Request-Id'] = `${this.runId}-${requestId}`;
      let res: Response;
      this.onStart?.({ method, path: path.split('?')[0], requestId });
      try {
        res = await this.f(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
      } catch (e) {
        // network error / timeout: we cannot know whether PayPal committed it
        throw new RailsError(504, `NETWORK ${(e as Error).name}`, true);
      }
      const debugId = res.headers.get('paypal-debug-id') ?? undefined;
      const text = await res.text();
      const json = (text ? JSON.parse(text) : {}) as T;
      const log = { at: t0, method, path: path.split('?')[0], status: res.status, ms: Date.now() - t0, requestId, debugId };
      this.calls.push(log);
      this.onCall?.(log);
      if (this.calls.length > 2000) this.calls.shift();
      return { status: res.status, json, debugId };
    });
  }

  private payeeFor(merchantId: string): string | undefined {
    const pool = this.cfg.payeeEmails;
    if (!pool?.length) return undefined;
    if (!this.payee.has(merchantId)) this.payee.set(merchantId, pool[this.payee.size % pool.length]);
    return this.payee.get(merchantId);
  }

  static orderBody(input: CreateOrderInput, payeeEmail: string | undefined, card: PayPalConfig['card'], runId = 'r0', requestId = input.customId) {
    const money = (n: number) => ({ currency_code: input.currency, value: n.toFixed(2) });
    const [line1, rest] = input.shipTo.split(/,\s*/);
    // PayPal requires item_total == sum(unit_amount * quantity) to the cent
    const exact = Math.round(input.item.unit * 100) * input.item.qty === Math.round(input.amount * 100);
    const qty = exact ? input.item.qty : 1, unit = exact ? input.item.unit : input.amount;
    return {
      intent: input.intent,
      purchase_units: [{
        reference_id: input.customId,
        custom_id: `${runId}:${input.customId}`,
        // one invoice per request: a retry under the same PayPal-Request-Id replays, a fresh id is a fresh charge
        invoice_id: `SC-${runId}-${requestId}`,
        description: `Sandbox City order ${input.customId}`,
        soft_descriptor: 'SANDBOXCITY',
        amount: { ...money(input.amount), breakdown: { item_total: money(input.amount) } },
        items: [{ name: input.item.name.slice(0, 127), sku: input.item.sku, quantity: String(qty), unit_amount: money(unit), category: 'PHYSICAL_GOODS' }],
        ...(payeeEmail ? { payee: { email_address: payeeEmail } } : {}),
        shipping: {
          name: { full_name: `Agent ${input.payerId}` },
          address: { address_line_1: line1.slice(0, 300), admin_area_2: (rest ?? 'Sandbox City').slice(0, 120), admin_area_1: 'CA', postal_code: '94105', country_code: 'US' },
        },
      }],
      payment_source: {
        card: {
          number: card?.number ?? '4111111111111111',
          expiry: card?.expiry ?? '2030-12',
          security_code: card?.securityCode ?? '123',
          name: `Agent ${input.card.holder}`,
          billing_address: { address_line_1: '1 Market St', admin_area_2: 'San Francisco', admin_area_1: 'CA', postal_code: '94105', country_code: 'US' },
        },
      },
    };
  }

  async createOrder(input: CreateOrderInput, requestId: string): Promise<OrderResult> {
    const extra: Record<string, string> = {};
    if (input.mockCode) extra['PayPal-Mock-Response'] = JSON.stringify({ mock_application_codes: input.mockCode });
    const { status, json, debugId } = await this.call<PayPalOrder>('POST', '/v2/checkout/orders', SandboxRails.orderBody(input, this.payeeFor(input.payeeMerchantId), this.cfg.card, this.runId, requestId), requestId, extra);
    if (status === 422 || status === 400) {
      const issue = (json as unknown as PayPalError).details?.[0]?.issue ?? (json as unknown as PayPalError).name ?? 'UNPROCESSABLE_ENTITY';
      if (DECLINES.has(issue)) return { id: (json as unknown as { id?: string }).id ?? '', status: 'DECLINED', captureStatus: 'DECLINED', issue, debugId: debugId ?? '', rail: 'sandbox' };
      throw new RailsError(status, issue);
    }
    if (status >= 500 || status === 429) throw new RailsError(status, (json as unknown as PayPalError).name ?? 'SERVER_ERROR', false);
    if (status >= 300) throw new RailsError(status, (json as unknown as PayPalError).name ?? 'ERROR');
    const pu = json.purchase_units?.[0];
    const cap = pu?.payments?.captures?.[0];
    const auth = pu?.payments?.authorizations?.[0];
    const declined = cap?.status === 'DECLINED' || json.status === 'DECLINED' || auth?.status === 'DENIED';
    if (cap?.id && cap.status !== 'DECLINED') this.moves.set(cap.id, { kind: 'capture', id: cap.id, amount: input.amount });
    if (auth?.id) this.authAmount.set(auth.id, input.amount);
    return {
      id: json.id, status: declined ? 'DECLINED' : 'COMPLETED', captureId: cap?.id, captureStatus: cap?.status as OrderResult['captureStatus'],
      authorizationId: auth?.id, debugId: debugId ?? '', rail: 'sandbox', issue: declined ? cap?.status_details?.reason ?? 'DECLINED' : undefined,
    };
  }

  async captureAuthorization(authId: string, requestId: string) {
    const { status, json } = await this.call<{ id: string; status: string; amount?: { value: string } } & PayPalError>('POST', `/v2/payments/authorizations/${authId}/capture`, {}, requestId);
    if (status >= 300) throw new RailsError(status, json.details?.[0]?.issue ?? json.name ?? 'ERROR', status >= 500);
    const amount = json.amount ? Number(json.amount.value) : this.authAmount.get(authId);
    if (amount !== undefined) this.moves.set(json.id, { kind: 'capture', id: json.id, amount });
    return { captureId: json.id, status: json.status };
  }

  async voidAuthorization(authId: string, requestId: string) {
    const { status, json } = await this.call<PayPalError>('POST', `/v2/payments/authorizations/${authId}/void`, undefined, requestId);
    if (status >= 300) throw new RailsError(status, json.details?.[0]?.issue ?? json.name ?? 'ERROR', status >= 500);
    return { status: 'VOIDED' };
  }

  async refundCapture(captureId: string, amount: number, requestId: string) {
    const { status, json } = await this.call<{ id: string; status: string } & PayPalError>('POST', `/v2/payments/captures/${captureId}/refund`, { amount: { value: amount.toFixed(2), currency_code: 'USD' } }, requestId);
    if (status >= 300) throw new RailsError(status, json.details?.[0]?.issue ?? json.name ?? 'ERROR', status >= 500);
    this.moves.set(json.id, { kind: 'refund', id: json.id, amount });
    return { refundId: json.id, status: json.status };
  }

  /** Read back a capture or refund straight from PayPal (no reporting lag). */
  async getPayment(kind: 'capture' | 'refund', id: string): Promise<{ id: string; status: string; amount: number } | null> {
    const { status, json } = await this.call<{ id: string; status: string; amount?: { value: string } }>('GET', `/v2/payments/${kind}s/${id}`);
    if (status >= 300 || !json.amount) return null;
    return { id: json.id, status: json.status, amount: Number(json.amount.value) };
  }

  observed() {
    let captured = 0, refunded = 0, captures = 0, refunds = 0;
    for (const m of this.moves.values()) m.kind === 'capture' ? (captured += m.amount, captures++) : (refunded += m.amount, refunds++);
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return { captured: r2(captured), refunded: r2(refunded), net: r2(captured - refunded), captures, refunds };
  }

  /** Transaction Search (Reporting API) for reconciliation. Windows are limited to 31 days. */
  async searchTransactions(start: Date, end: Date) {
    const out: TxnDetail[] = [];
    let page = 1, pages = 1;
    do {
      const q = new URLSearchParams({ start_date: start.toISOString().replace(/\.\d+Z$/, 'Z'), end_date: end.toISOString().replace(/\.\d+Z$/, 'Z'), fields: 'transaction_info', page_size: '500', page: String(page) });
      const { status, json } = await this.call<{ transaction_details: TxnDetail[]; total_pages: number } & PayPalError>('GET', `/v1/reporting/transactions?${q}`);
      if (status >= 300) throw new RailsError(status, json.name ?? 'REPORTING_ERROR');
      out.push(...(json.transaction_details ?? []));
      pages = json.total_pages ?? 1;
      page++;
    } while (page <= pages);
    return out;
  }
}

const DECLINES = new Set(['INSTRUMENT_DECLINED', 'TRANSACTION_REFUSED', 'CARD_EXPIRED', 'CARD_CLOSED', 'PAYER_CANNOT_PAY', 'COMPLIANCE_VIOLATION', 'DUPLICATE_INVOICE_ID']);

interface PayPalError { name?: string; message?: string; debug_id?: string; details?: { issue: string; description?: string }[] }
interface PayPalOrder {
  id: string; status: string;
  purchase_units?: { payments?: { captures?: { id: string; status: string; status_details?: { reason: string } }[]; authorizations?: { id: string; status: string }[] } }[];
}
export interface TxnDetail { transaction_info: { transaction_id: string; transaction_event_code: string; transaction_amount: { value: string; currency_code: string }; custom_field?: string; invoice_id?: string; transaction_status: string } }
