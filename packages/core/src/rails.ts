/**
 * Payment rails. The engine only ever talks to this PayPal-shaped interface:
 *  - PayPalTwin   : in-memory, contract-faithful twin of Orders v2 / Payments v2 (ids, statuses,
 *                   PayPal-Request-Id idempotency, webhooks, negative-testing style declines).
 *  - SandboxRails : (server package) the real PayPal sandbox REST API.
 *  - ChaosRails   : wraps either one and injects timeouts / 5xx / lost responses.
 */
import { Rng, round2 } from './rng';

export type CardState = 'ok' | 'stolen';

export interface CardRef { last4: string; state: CardState; holder: string }

/** How many units the order line PayPal holds will show. PayPal needs item totals exact, so a total that is not unit x qty goes as one line of 1. */
export const sentQty = (i: { amount: number; item: { unit: number; qty: number } }) => (Math.round(i.item.unit * 100) * i.item.qty === Math.round(i.amount * 100) ? i.item.qty : 1);

/** A delivery address the way PayPal takes it. */
export interface PostalAddress { address_line_1: string; address_line_2?: string; admin_area_2: string; admin_area_1: string; postal_code: string; country_code: string }

export interface CreateOrderInput {
  intent: 'CAPTURE' | 'AUTHORIZE';
  amount: number;
  currency: 'USD';
  payeeMerchantId: string;
  payerId: string;
  card: CardRef;
  item: { name: string; sku: string; unit: number; qty: number };
  shipTo: string;
  /** The address the gate checked. When set, this is what PayPal gets, field for field. */
  address?: PostalAddress;
  customId: string;
  /** PayPal negative testing hook (PayPal-Mock-Response) set by the twin risk model. */
  mockCode?: string;
}

export interface OrderResult {
  id: string;
  /** COMPLETED means the money moved, or a hold was placed. PENDING means PayPal has not finished the capture. */
  status: 'COMPLETED' | 'DECLINED' | 'PENDING';
  captureId?: string;
  captureStatus?: 'COMPLETED' | 'DECLINED' | 'PENDING';
  authorizationId?: string;
  issue?: string;
  debugId: string;
  rail: 'twin' | 'sandbox';
}

export interface Webhook {
  id: string;
  event_type:
    | 'CHECKOUT.ORDER.COMPLETED' | 'PAYMENT.CAPTURE.COMPLETED' | 'PAYMENT.CAPTURE.DENIED'
    | 'PAYMENT.AUTHORIZATION.CREATED' | 'PAYMENT.AUTHORIZATION.VOIDED' | 'PAYMENT.CAPTURE.REFUNDED';
  resource: { id: string; amount: number; payee: string; payer: string; custom_id: string };
}

export class RailsError extends Error {
  constructor(public status: number, public issue: string, public afterEffect = false) {
    super(`${status} ${issue}`);
  }
}

export interface Rails {
  readonly name: 'twin' | 'sandbox';
  createOrder(input: CreateOrderInput, requestId: string): Promise<OrderResult>;
  captureAuthorization(authId: string, requestId: string): Promise<{ captureId: string; status: string }>;
  voidAuthorization(authId: string, requestId: string): Promise<{ status: string }>;
  refundCapture(captureId: string, amount: number, requestId: string): Promise<{ refundId: string; status: string }>;
}

interface Capture { id: string; amount: number; payee: string; payer: string; refunded: number; custom: string }
interface Auth { id: string; amount: number; payee: string; payer: string; status: 'CREATED' | 'CAPTURED' | 'VOIDED'; custom: string }

/** Contract-faithful in-memory twin of the PayPal Orders v2 + Payments v2 APIs. */
export class PayPalTwin implements Rails {
  readonly name = 'twin' as const;
  private idem = new Map<string, unknown>();
  readonly captures = new Map<string, Capture>();
  readonly auths = new Map<string, Auth>();
  /** Net money per account (payer negative, payee positive). Used for to-the-cent reconciliation. */
  readonly balances = new Map<string, number>();
  readonly transactions: { id: string; type: 'capture' | 'refund'; amount: number; payer: string; payee: string; custom: string }[] = [];
  private listeners: ((w: Webhook) => void)[] = [];

  constructor(private rng: Rng) {}

  onWebhook(fn: (w: Webhook) => void) { this.listeners.push(fn); }
  private emit(event_type: Webhook['event_type'], resource: Webhook['resource']) {
    const w: Webhook = { id: `WH-${this.rng.paypalId()}`, event_type, resource };
    for (const l of this.listeners) l(w);
  }
  private move(payer: string, payee: string, amount: number) {
    this.balances.set(payer, round2((this.balances.get(payer) ?? 0) - amount));
    this.balances.set(payee, round2((this.balances.get(payee) ?? 0) + amount));
  }
  private once<T>(requestId: string, fn: () => T): T {
    if (this.idem.has(requestId)) return this.idem.get(requestId) as T;
    const r = fn();
    this.idem.set(requestId, r);
    return r;
  }

  async createOrder(input: CreateOrderInput, requestId: string): Promise<OrderResult> {
    return this.once(requestId, () => {
      const id = this.rng.paypalId();
      const debugId = this.rng.hex(13);
      if (input.amount <= 0) throw new RailsError(422, 'AMOUNT_MISMATCH');
      if (input.mockCode) {
        return { id, status: 'DECLINED' as const, captureStatus: 'DECLINED' as const, issue: input.mockCode, debugId, rail: 'twin' as const };
      }
      if (input.intent === 'AUTHORIZE') {
        const auth: Auth = { id: this.rng.paypalId(), amount: input.amount, payee: input.payeeMerchantId, payer: input.payerId, status: 'CREATED', custom: input.customId };
        this.auths.set(auth.id, auth);
        this.emit('PAYMENT.AUTHORIZATION.CREATED', { id: auth.id, amount: auth.amount, payee: auth.payee, payer: auth.payer, custom_id: auth.custom });
        return { id, status: 'COMPLETED' as const, authorizationId: auth.id, debugId, rail: 'twin' as const };
      }
      const cap = this.capture(input.amount, input.payeeMerchantId, input.payerId, input.customId);
      this.emit('CHECKOUT.ORDER.COMPLETED', { id, amount: input.amount, payee: input.payeeMerchantId, payer: input.payerId, custom_id: input.customId });
      return { id, status: 'COMPLETED' as const, captureId: cap.id, captureStatus: 'COMPLETED' as const, debugId, rail: 'twin' as const };
    });
  }

  private capture(amount: number, payee: string, payer: string, custom: string): Capture {
    const cap: Capture = { id: this.rng.paypalId(), amount, payee, payer, refunded: 0, custom };
    this.captures.set(cap.id, cap);
    this.move(payer, payee, amount);
    this.transactions.push({ id: cap.id, type: 'capture', amount, payer, payee, custom });
    this.emit('PAYMENT.CAPTURE.COMPLETED', { id: cap.id, amount, payee, payer, custom_id: custom });
    return cap;
  }

  async captureAuthorization(authId: string, requestId: string) {
    return this.once(requestId, () => {
      const a = this.auths.get(authId);
      if (!a) throw new RailsError(404, 'RESOURCE_NOT_FOUND');
      if (a.status !== 'CREATED') throw new RailsError(422, 'AUTHORIZATION_ALREADY_CAPTURED');
      a.status = 'CAPTURED';
      const cap = this.capture(a.amount, a.payee, a.payer, a.custom);
      return { captureId: cap.id, status: 'COMPLETED' };
    });
  }

  async voidAuthorization(authId: string, requestId: string) {
    return this.once(requestId, () => {
      const a = this.auths.get(authId);
      if (!a) throw new RailsError(404, 'RESOURCE_NOT_FOUND');
      if (a.status !== 'CREATED') throw new RailsError(422, 'PREVIOUSLY_CAPTURED');
      a.status = 'VOIDED';
      this.emit('PAYMENT.AUTHORIZATION.VOIDED', { id: a.id, amount: a.amount, payee: a.payee, payer: a.payer, custom_id: a.custom });
      return { status: 'VOIDED' };
    });
  }

  async refundCapture(captureId: string, amount: number, requestId: string) {
    return this.once(requestId, () => {
      const c = this.captures.get(captureId);
      if (!c) throw new RailsError(404, 'RESOURCE_NOT_FOUND');
      if (round2(c.refunded + amount) > c.amount) throw new RailsError(422, 'REFUND_AMOUNT_EXCEEDED');
      c.refunded = round2(c.refunded + amount);
      this.move(c.payee, c.payer, amount);
      const refundId = this.rng.paypalId();
      this.transactions.push({ id: refundId, type: 'refund', amount, payer: c.payee, payee: c.payer, custom: c.custom });
      this.emit('PAYMENT.CAPTURE.REFUNDED', { id: refundId, amount, payee: c.payee, payer: c.payer, custom_id: c.custom });
      return { refundId, status: 'COMPLETED' };
    });
  }
}

/**
 * Chaos monkey for payment rails. Two fault classes:
 *  - pre  : 503 / connection reset before the request lands (safe to retry)
 *  - post : the request succeeded at PayPal but the response was lost (timeout). Retrying
 *           WITHOUT the same PayPal-Request-Id double-charges the buyer.
 */
export class ChaosRails implements Rails {
  constructor(private inner: Rails, private rng: Rng, public rate: number, private onFault?: (fault: string) => void) {}
  get name() { return this.inner.name; }
  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    if (this.rate > 0 && this.rng.chance(this.rate / 2)) {
      this.onFault?.('503 SERVICE_UNAVAILABLE');
      throw new RailsError(503, 'SERVICE_UNAVAILABLE', false);
    }
    const r = await fn();
    if (this.rate > 0 && this.rng.chance(this.rate / 2)) {
      this.onFault?.('TIMEOUT after commit');
      throw new RailsError(504, 'GATEWAY_TIMEOUT', true);
    }
    return r;
  }
  createOrder(i: CreateOrderInput, r: string) { return this.wrap(() => this.inner.createOrder(i, r)); }
  captureAuthorization(a: string, r: string) { return this.wrap(() => this.inner.captureAuthorization(a, r)); }
  voidAuthorization(a: string, r: string) { return this.wrap(() => this.inner.voidAuthorization(a, r)); }
  refundCapture(c: string, amt: number, r: string) { return this.wrap(() => this.inner.refundCapture(c, amt, r)); }
}
