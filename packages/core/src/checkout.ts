/**
 * The checkout contract: how a real payment call becomes the same gate input the simulated day uses.
 *
 * The lab and the shop share one evaluator (evaluateOrder). What can still drift between them is the input, so
 * this file owns that mapping: a toolkit `create_order` call becomes a GateOrder, an owner's request becomes a
 * passport and mandate, and a CheckoutSession remembers what the agent already did. The rules run unchanged.
 *
 * Every number PayPal would charge is counted (lines, tax, shipping, discount). Every address field is compared.
 * Anything the gate cannot read fails closed under a rulebook that checks it.
 */
import { deriveKey, signRequest, SignatureVerifier, type KeyPair, type VerifyResult } from './kya';
import { addressMatches, evaluateOrder, EVALUATOR_VERSION, policyId, sameAddress, type AgentView, type GateContext, type GateOrder, type MerchantView, type Policy } from './policy';
import type { PostalAddress } from './rails';
import type { GateResult, Mandate, Passport } from './types';

export interface CheckoutLine { name?: string; quantity?: number; itemCost?: number; itemTotal?: number; taxPercent?: number }
export interface CheckoutAddress { address_line_1?: string; address_line_2?: string; admin_area_2?: string; admin_area_1?: string; postal_code?: string; country_code?: string }
export interface CheckoutArgs { currencyCode?: string; items?: CheckoutLine[]; discount?: number; shippingCost?: number; shippingAddress?: CheckoutAddress | null }

/** The owner's postal details. The city's districts all sit in one ZIP. */
export const OWNER_POSTAL = { admin_area_1: 'CA', postal_code: '94107', country_code: 'US' } as const;

/** What a request is allowed to do: the owner's mandate, address and the listing being bought. */
export interface CheckoutScope {
  passport: Passport;
  category: string;
  /** The listing's price, when the checkout knows it. */
  listedUnit?: number;
  postal?: typeof OWNER_POSTAL;
}

const cents = (n: number) => Math.round(n * 100);
const money = (c: number) => c / 100;
/** How an order is read. The rules have their own version: this one moves when the reading gets stricter, not the rules. */
export const ORDER_READER_VERSION = 'read-2';

/** Agent output is untrusted: an address field that is not text is no address, invisible characters are not part of one, and a number that is not a number counts as zero and is reported. */
const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\p{Cf}/gu, '').trim() : '');
const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** Dollars and whole cents. A price of $289.499 is not $289.50, however it rounds. */
const wholeCents = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const ownerDistrict = (scope: CheckoutScope) => scope.passport.address.split(',').slice(1).join(',').trim() || 'Sandbox City';

/** The address as one string, in the owner's "street, district" form, with anything that makes it a different place kept in. */
export function shipToOfArgs(a: CheckoutAddress | null | undefined, scope: CheckoutScope): string {
  const line = text(a?.address_line_1), city = text(a?.admin_area_2);
  if (!line) return '';
  // a city only repeats the line if it is the line's whole last part: "Row" is not "Silk Row"
  const repeats = (line.includes(',') && sameAddress(line.split(',').pop()!, city)) || (sameAddress(line, scope.passport.address) && sameAddress(city, ownerDistrict(scope)));
  const base = city && !repeats ? `${line}, ${city}` : line;
  const postal = scope.postal ?? OWNER_POSTAL;
  const extra: string[] = [];
  const line2 = text(a?.address_line_2), state = text(a?.admin_area_1), zip = text(a?.postal_code), country = text(a?.country_code);
  if (line2) extra.push(line2);
  if (state && state.toUpperCase() !== postal.admin_area_1) extra.push(state);
  if (zip && zip !== postal.postal_code) extra.push(zip);
  if (country && country.toUpperCase() !== postal.country_code) extra.push(country);
  return extra.length ? `${base} / ${extra.join(' / ')}` : base;
}

/**
 * The address the gate just read, whole, for the order PayPal will hold. A field the caller left out is one the gate
 * read as the owner's own, so it is filled the same way here. Nothing is replaced.
 */
export function canonicalAddress(a: CheckoutAddress | null | undefined, scope: CheckoutScope): PostalAddress | undefined {
  const line = text(a?.address_line_1);
  if (!line) return undefined;
  const postal = scope.postal ?? OWNER_POSTAL;
  const [first, ...rest] = line.split(/,\s*/);
  const city = text(a?.admin_area_2), line2 = text(a?.address_line_2);
  return {
    address_line_1: (city ? line : first).trim(),
    ...(line2 ? { address_line_2: line2 } : {}),
    admin_area_2: city || rest.join(', ').trim() || ownerDistrict(scope),
    admin_area_1: text(a?.admin_area_1) || postal.admin_area_1,
    postal_code: text(a?.postal_code) || postal.postal_code,
    country_code: text(a?.country_code) || postal.country_code,
  };
}

/** Fields an order may carry as text; one that holds anything else is reported, because the gate reads it as absent. */
const ADDRESS_FIELDS = ['address_line_1', 'address_line_2', 'admin_area_2', 'admin_area_1', 'postal_code', 'country_code'] as const;

/**
 * An untrusted value, safe to put in a message. It is never converted implicitly: valid JSON such as {"toString":null}
 * throws when a template string tries, so an object is named by its kind, and text is quoted and cut short.
 */
export function show(v: unknown): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v);
  if (v === null) return 'null';
  if (v === undefined) return 'missing';
  return Array.isArray(v) ? 'a list' : 'an object';
}
const price = (v: unknown) => (typeof v === 'number' ? `$${v}` : show(v));

/** What the order will really charge, in the order's own terms. Anything that does not add up is reported, not corrected. */
export function checkoutOrder(args: CheckoutArgs, scope: CheckoutScope): GateOrder {
  const problems: string[] = [];
  const lines: unknown[] = Array.isArray(args?.items) ? args.items : [];
  if (!lines.length) problems.push('no items');
  let qty = 0, total = 0;
  for (const raw of lines) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { problems.push('a line is not an item'); continue; }
    const l = raw as CheckoutLine;
    const q = l.quantity ?? 1, unit = l.itemCost ?? 0, tax = l.taxPercent ?? 0;
    if (!Number.isSafeInteger(q) || q < 1) problems.push(`quantity ${show(q)}`);
    if (!wholeCents(unit) || (unit as number) <= 0) problems.push(`item cost ${show(unit)}`);
    if (typeof tax !== 'number' || !Number.isFinite(tax) || tax < 0) problems.push(`tax ${show(tax)}`);
    const count = Math.max(1, Math.round(finite(q)) || 1), line = cents(finite(unit)) * count;
    if (l.itemTotal != null && (typeof l.itemTotal !== 'number' || cents(l.itemTotal) !== line)) problems.push(`line total ${price(l.itemTotal)} is not ${show(q)} x ${price(unit)}`);
    if (scope.listedUnit != null && cents(finite(unit)) !== cents(scope.listedUnit)) problems.push(`${price(unit)} is not the listed $${scope.listedUnit}`);
    qty += count;
    // count the larger of what was declared and what the lines say: a hidden charge must not lower the total the gate sees
    total += Math.max(line, cents(finite(l.itemTotal))) * (1 + Math.max(0, finite(tax)) / 100);
  }
  const shipping = args?.shippingCost ?? 0, discount = args?.discount ?? 0;
  if (!wholeCents(shipping) || (shipping as number) < 0) problems.push(`shipping ${show(shipping)}`);
  if (!wholeCents(discount) || (discount as number) < 0) problems.push(`discount ${show(discount)}`);
  if (args?.currencyCode != null && args.currencyCode !== 'USD') problems.push(`currency ${show(args.currencyCode)}`);
  const address = args?.shippingAddress as unknown;
  if (address != null && (typeof address !== 'object' || Array.isArray(address))) problems.push('the address is not an address');
  else for (const k of new Set([...ADDRESS_FIELDS, ...Object.keys(address ?? {})])) {
    const v = (address as Record<string, unknown> | null | undefined)?.[k];
    // a field the gate does not read is refused too: it would be dropped here, and the next reader may not drop it
    if (v != null && typeof v !== 'string') problems.push(`${show(k)} is not text`);
    // "#" compares equal to nothing, and would still reach PayPal
    else if (text(v) && !/[\p{L}\p{N}]/u.test(text(v))) problems.push(`${show(k)} has no letters or digits`);
  }
  total += cents(Math.max(0, finite(shipping))) - cents(Math.max(0, finite(discount)));
  if (lines.length && Math.round(total) <= 0) problems.push('the order charges nothing');
  const order: GateOrder = { amount: money(Math.round(total)), qty, category: scope.category, shipTo: shipToOfArgs(args?.shippingAddress, scope) };
  if (problems.length) order.malformed = problems.join('; ');
  return order;
}

/** A passport for one owner request: the mandate is exactly what the owner asked for. */
export function requestPassport(owner: { category: string; qty: number; address: string; budget: number }, agentId: string, key: Pick<KeyPair, 'keyId' | 'publicKey'>): Passport {
  const mandate: Mandate = { maxPerOrder: owner.budget, categories: [owner.category], maxQty: owner.qty };
  return { agentId, keyId: key.keyId, publicKey: key.publicKey, ownerPayerId: `OWNER-${agentId}`, address: owner.address, issuedAt: 0, mandate };
}

/** Facts for a session with no history feed: an established agent buying from an established store. The toolkit shop uses this; POST /api/checkout supplies real history. */
export const ESTABLISHED_AGENT: AgentView = { age: 30000, orders: 20, recent: 0, refunds: 0, rep: 0.8 };
export const ESTABLISHED_STORE: MerchantView = { age: 20000, verified: true, rep: 0.8, ring: 0, orders: 50, exposure: 0, fulfilled: 5000, independent: 5000 };

export interface Verdict extends GateResult {
  ok: boolean;
  reason?: string;
  /** Which rulebook and which evaluator decided: the same pair in the lab and at the checkout. */
  policy: string;
  evaluator: string;
  /** Which reading of the order the evaluator was given. */
  reader: string;
  order?: GateOrder;
}

const verdict = (policy: Policy, gate: GateResult, order?: GateOrder): Verdict => {
  const stop = gate.hits.find((h) => h.action === gate.decision && gate.decision !== 'allow');
  const reason = stop ? `${stop.rule}: ${stop.reason}` : undefined;
  return { ...gate, ok: gate.decision === 'allow', reason, policy: policyId(policy), evaluator: EVALUATOR_VERSION, reader: ORDER_READER_VERSION, order };
};

/** What the checkout knows about this store and this agent at the moment of the order. */
export interface HistoryFacts { merchant: MerchantView; agent: AgentView }

export interface SessionOptions {
  owner: { category: string; qty: number; address: string; budget: number };
  listedUnit?: number;
  agentId?: string;
  agent?: AgentView;
  merchant?: MerchantView;
  /** Seconds since epoch for signature windows. */
  now?: () => number;
}

/**
 * One agent working on one owner request. It holds the state a stateless check would miss: which orders the gate
 * approved, what they add up to, and the agent's signing key. Every tool call the agent makes goes through check().
 */
export class CheckoutSession {
  readonly passport: Passport;
  private key: KeyPair;
  private verifier: SignatureVerifier;
  private spent = { qty: 0, total: 0 };
  private approved = new Map<string, { amount: number; qty: number; shipTo: string }>();
  private nonce = 0;
  private now: () => number;

  constructor(readonly policy: Policy, private opts: SessionOptions) {
    const agentId = opts.agentId ?? 'checkout-agent';
    this.key = deriveKey(`checkout:${agentId}`, agentId, 'ed25519');
    this.passport = requestPassport(opts.owner, agentId, this.key);
    this.verifier = new SignatureVerifier(new Map([[this.key.keyId, { passport: this.passport }]]), 'ed25519', policy.sigSkew);
    this.now = opts.now ?? (() => 1_800_000_000);
  }

  get scope(): CheckoutScope { return { passport: this.passport, category: this.opts.owner.category, listedUnit: this.opts.listedUnit }; }

  /** The agent's signature over the exact call body, the way it would arrive at a checkout. */
  sign(body: string) {
    return signRequest({ method: 'POST', authority: 'checkout.sandbox.city', path: '/create_order', body }, this.key,
      `https://agents.sandbox.city/.well-known/http-message-signatures-directory#${this.passport.agentId}`, this.now(), `n${++this.nonce}`, 'ed25519');
  }

  private context(verify: VerifyResult | null, facts?: HistoryFacts): GateContext {
    return {
      verify, identity: this.passport.agentId, claimsPassportHolder: true, passport: this.passport,
      agent: facts?.agent ?? this.opts.agent ?? ESTABLISHED_AGENT, merchant: facts?.merchant ?? this.opts.merchant ?? ESTABLISHED_STORE, session: this.spent,
    };
  }

  /** A create_order call: signed, read in full, and put through the same evaluator the simulated day uses. */
  checkOrder(args: CheckoutArgs, facts?: HistoryFacts): Verdict {
    const order = checkoutOrder(args, this.scope);
    const verify = this.policy.verifySignatures ? this.verifier.verify(this.sign(JSON.stringify(args)), this.now()) : null;
    return verdict(this.policy, evaluateOrder(this.policy, order, this.context(verify, facts)), order);
  }

  /** The order this call describes, read the way the gate reads it, without deciding anything. */
  checkOrderShape(args: CheckoutArgs): GateOrder { return checkoutOrder(args, this.scope); }

  /** Records an order PayPal created after the gate allowed it; pay_order will accept this id and no other. */
  created(orderId: string, order: GateOrder) {
    this.spent = { qty: this.spent.qty + order.qty, total: Math.round((this.spent.total + order.amount) * 100) / 100 };
    this.approved.set(orderId, { amount: order.amount, qty: order.qty, shipTo: order.shipTo });
  }

  /** Gives back a reservation for an order that never completed, so a failed payment does not eat the mandate. */
  release(orderId: string) {
    const known = this.approved.get(orderId);
    if (!known) return;
    this.approved.delete(orderId);
    this.spent = { qty: this.spent.qty - known.qty, total: Math.round((this.spent.total - known.amount) * 100) / 100 };
  }

  /** A pay_order call. Only orders this session's gate approved may be captured. */
  checkPay(orderId: string, readBack?: { amount?: number }): Verdict {
    const known = this.approved.get(orderId);
    const allow: GateResult = { decision: 'allow', hits: [], escrow: false };
    if (!this.policy.strictOrders) return verdict(this.policy, allow);
    if (!known) return verdict(this.policy, { decision: 'block', escrow: false, hits: [{ rule: 'strictOrders', action: 'block', reason: `order ${orderId} never passed this gate` }] });
    if (readBack?.amount != null && cents(readBack.amount) !== cents(known.amount))
      return verdict(this.policy, { decision: 'block', escrow: false, hits: [{ rule: 'strictOrders', action: 'block', reason: `order reads back at $${readBack.amount}, the gate approved $${known.amount}` }] });
    return verdict(this.policy, allow);
  }
}

export { addressMatches };
