/**
 * The Gate: the rulebook every order and refund passes through.
 * It sees only what a real merchant / PSP could observe. It never reads ground truth.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import type { Decision, GateResult, OrderIntent, Passport, RuleHit } from './types';
import type { VerifyResult } from './kya';

/** Bump when evaluateOrder or evaluateRefund changes what they decide. Stamped on every decision with the policy hash. */
export const EVALUATOR_VERSION = 'gate-2';

export interface Policy {
  name: string;
  requirePassport: boolean;
  verifySignatures: boolean;
  sigSkew: number;           // seconds of clock skew tolerated
  enforceMandate: boolean;
  velocity: number;          // max orders per agent per hour, 0 = off
  newAgentCap: number;       // $ cap for young agents, 0 = off
  newAgentAge: number;       // ticks
  merchantRepMin: number;    // 0..1, 0 = off
  verifiedMerchantsOnly: boolean;
  escrowNewMerchants: number;// merchant age (ticks) below which payments are held, 0 = off
  sanitizer: number;         // listing-injection filter strictness 0..1, 0 = off
  shipLock: boolean;
  refundTrackingCheck: boolean;
  refundRatioCap: number;    // 0 = off
  ringDetection: number;     // 0 = off, else closed-loop score threshold
  idempotencyKeys: boolean;
  softMode: boolean;         // rules that can challenge (step-up to the owner) do so instead of blocking
  /** Refuse orders that do not add up: bad numbers, a declared total that disagrees with its lines, a price off the listing. */
  strictOrders: boolean;
  /** Hold capture until the carrier scans once a store's unfulfilled money passes floor + ratio x fulfilled value. 0 = off. */
  exposureRatio: number;
  exposureFloor: number;     // $ a store may have unfulfilled before the ratio applies
  /** Count only fulfilled value from buyers who are independent of the store. */
  independentCredit: boolean;
  /** Minutes after the scan before a delivery earns credit, so an empty parcel can be complained about first. 0 or absent = at the scan. */
  releaseLag?: number;
  /** Held money also waits out the complaint window, so a scan alone never releases it. A disputed order is voided. */
  captureAfterRelease?: boolean;
}

export const RULES: { key: keyof Policy; label: string; kind: 'bool' | 'num'; min?: number; max?: number; step?: number; blurb: string }[] = [
  { key: 'requirePassport', label: 'Require agent passport', kind: 'bool', blurb: 'Only agents with a passport tied to their owner may pay. Passports are simulated in this lab.' },
  { key: 'verifySignatures', label: 'Verify Web Bot Auth signatures', kind: 'bool', blurb: 'RFC 9421 signature, expiry and nonce replay check on every request.' },
  { key: 'enforceMandate', label: 'Enforce owner mandate', kind: 'bool', blurb: 'Orders over the owner\'s per-order cap or outside allowed categories go to the owner.' },
  { key: 'shipLock', label: 'Lock shipping to owner address', kind: 'bool', blurb: 'Shipping anywhere but the passport address needs owner approval.' },
  { key: 'velocity', label: 'Velocity limit (orders / hr)', kind: 'num', min: 0, max: 20, step: 1, blurb: 'Too many orders per agent per hour.' },
  { key: 'newAgentCap', label: 'New-agent spend cap ($)', kind: 'num', min: 0, max: 500, step: 10, blurb: 'Young agents can only spend so much per order.' },
  { key: 'merchantRepMin', label: 'Min merchant reputation', kind: 'num', min: 0, max: 0.9, step: 0.05, blurb: 'Refuse to pay low-reputation stores.' },
  { key: 'verifiedMerchantsOnly', label: 'Verified merchants only', kind: 'bool', blurb: 'Payee must be a business verified through Log In with PayPal.' },
  { key: 'escrowNewMerchants', label: 'Hold new merchants (minutes)', kind: 'num', min: 0, max: 1440, step: 60, blurb: 'A PayPal authorization, not escrow: capture when the carrier scans the parcel, void otherwise.' },
  { key: 'sanitizer', label: 'Listing injection filter', kind: 'num', min: 0, max: 1, step: 0.05, blurb: 'Quarantine listings that try to instruct AI agents. Simulated: the lab knows which ones are poisoned.' },
  { key: 'refundTrackingCheck', label: 'Refunds check tracking', kind: 'bool', blurb: 'Deny "not received" claims when the carrier shows delivered.' },
  { key: 'refundRatioCap', label: 'Refund ratio cap', kind: 'num', min: 0, max: 1, step: 0.05, blurb: 'Agents who refund too often are cut off.' },
  { key: 'ringDetection', label: 'Fraud-ring detector', kind: 'num', min: 0, max: 1, step: 0.05, blurb: 'Block stores whose revenue comes from a closed loop of buyers.' },
  { key: 'idempotencyKeys', label: 'PayPal-Request-Id on retries', kind: 'bool', blurb: 'Retry payments with the same idempotency key so timeouts never double-charge.' },
  { key: 'softMode', label: 'Challenge instead of block', kind: 'bool', blurb: 'Send borderline orders to the human owner rather than refusing them.' },
  { key: 'strictOrders', label: 'Orders must add up', kind: 'bool', blurb: 'Refuse orders whose numbers disagree: hidden shipping or tax, a false total, a price off the listing.' },
  { key: 'exposureRatio', label: 'Exposure hold (x fulfilled)', kind: 'num', min: 0, max: 2, step: 0.05, blurb: 'Hold capture until the carrier scans when a store owes more goods than this share of what it has delivered.' },
  { key: 'exposureFloor', label: 'Exposure floor ($)', kind: 'num', min: 0, max: 3000, step: 50, blurb: 'Unfulfilled money every store may carry before the exposure hold applies.' },
  { key: 'independentCredit', label: 'Count independent buyers only', kind: 'bool', blurb: 'Fulfilled value only earns exposure credit when it came from buyers independent of the store.' },
  { key: 'releaseLag', label: 'Credit after complaint window', kind: 'num', min: 0, max: 720, step: 60, blurb: 'A scan only earns the store credit this many minutes later, if nobody has disputed the order. An empty parcel scans like a full one.' },
  { key: 'captureAfterRelease', label: 'Hold money through the window', kind: 'bool', blurb: 'Held money is captured after the complaint window, not at the scan. A disputed order is voided. Needs the complaint window on.' },
];

export const OPEN: Policy = {
  name: 'Wild West', requirePassport: false, verifySignatures: false, sigSkew: 30, enforceMandate: false, velocity: 0,
  newAgentCap: 0, newAgentAge: 360, merchantRepMin: 0, verifiedMerchantsOnly: false, escrowNewMerchants: 0, sanitizer: 0,
  shipLock: false, refundTrackingCheck: false, refundRatioCap: 0, ringDetection: 0, idempotencyKeys: false, softMode: false,
  strictOrders: false, exposureRatio: 0, exposureFloor: 0, independentCredit: false,
};

export const PRESETS: Record<string, Policy> = {
  open: OPEN,
  passport: { ...OPEN, name: 'Passport Theater', requirePassport: true },
  kya: { ...OPEN, name: 'Know Your Agent', requirePassport: true, verifySignatures: true, enforceMandate: true, idempotencyKeys: true, softMode: true, strictOrders: true },
  fortress: {
    ...OPEN, name: 'Fortress', requirePassport: true, verifySignatures: true, enforceMandate: true, velocity: 3, newAgentCap: 60,
    merchantRepMin: 0.55, verifiedMerchantsOnly: true, sanitizer: 0.9, shipLock: true, refundTrackingCheck: true, refundRatioCap: 0.2,
    ringDetection: 0.5, idempotencyKeys: true, strictOrders: true,
  },
  balanced: {
    ...OPEN, name: 'Balanced', requirePassport: false, verifySignatures: true, enforceMandate: true, velocity: 8, newAgentCap: 120,
    escrowNewMerchants: 720, sanitizer: 0.6, shipLock: true, refundTrackingCheck: true, refundRatioCap: 0.5, ringDetection: 0.7,
    idempotencyKeys: true, softMode: true, strictOrders: true,
  },
  /** Found by scripts/tune.ts (most net value with >= 85% of fraud stopped), validated on held-out days. */
  tuned: {
    ...OPEN, name: 'Lab-Tuned', requirePassport: true, velocity: 8, newAgentCap: 90, escrowNewMerchants: 840, shipLock: true,
    refundTrackingCheck: true, idempotencyKeys: true, strictOrders: true,
  },
};

/** A stable id for what a rulebook decides: the same id means the same decisions, wherever it runs. The name is not part of it. */
export function policyId(p: Policy): string {
  const { name: _name, releaseLag, captureAfterRelease, ...rest } = p;
  const rules = { ...rest, ...(releaseLag ? { releaseLag } : {}), ...(captureAfterRelease ? { captureAfterRelease } : {}) };
  const canon = JSON.stringify(Object.entries(rules).sort(([a], [b]) => a.localeCompare(b)));
  const bytes = sha256(new TextEncoder().encode(`${EVALUATOR_VERSION}\n${canon}`));
  return Array.from(bytes.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Same street, same order: forgive case and punctuation. */
export const sameAddress = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The owner's address, whole or with the district left off (the rest of a postal address is checked separately). An empty address never matches. */
export function addressMatches(shipTo: string, owner: string): boolean {
  if (!shipTo.trim()) return false;
  if (sameAddress(shipTo, owner)) return true;
  return !shipTo.includes(',') && sameAddress(`${shipTo}, ${owner.split(',').slice(1).join(',').trim()}`, owner);
}

/** Everything about an order the gate may read. Ground truth is not in this type, so no rule can reach it. */
export interface GateOrder {
  amount: number;
  qty: number;
  category: string;
  shipTo: string;
  /** Set when the order's own numbers disagree; says how. */
  malformed?: string;
}

/** The observable half of an order: what a real merchant or PSP can see at decision time. */
export const observe = (o: OrderIntent): GateOrder => ({ amount: o.amount, qty: o.qty, category: o.category, shipTo: o.shipTo });

export interface AgentView { age: number; orders: number; recent: number; refunds: number; rep: number }
export interface MerchantView {
  age: number; verified: boolean; rep: number; ring: number; orders: number;
  /** $ captured and not yet scanned by a carrier. */
  exposure?: number;
  /** $ the carrier has scanned for this store, from all buyers and from independent buyers. */
  fulfilled?: number; independent?: number;
}

export interface GateContext {
  verify: VerifyResult | null; // null when signature verification is off
  identity: string;
  /** The (unverified) Signature-Agent claim names an agent that holds a passport. */
  claimsPassportHolder: boolean;
  passport: Passport | null;
  agent: AgentView;
  merchant: MerchantView;
  /** What this agent already ordered in this session, for a mandate that covers the whole request. */
  session?: { qty: number; total: number };
}

const SEV: Record<Decision, number> = { allow: 0, challenge: 1, block: 2 };

export function evaluateOrder(p: Policy, o: GateOrder, c: GateContext): GateResult {
  const hits: RuleHit[] = [];
  const hit = (rule: string, action: Decision, reason: string) => hits.push({ rule, action, reason });
  const soft = (rule: string, reason: string) => hit(rule, p.softMode ? 'challenge' : 'block', reason);

  if (p.strictOrders && o.malformed) hit('strictOrders', 'block', o.malformed);
  if (p.verifySignatures && c.verify) {
    if (!c.verify.ok && c.verify.failure !== 'missing_signature') hit('verifySignatures', 'block', `signature ${c.verify.failure}`);
    if (c.verify.failure === 'missing_signature' && p.requirePassport) hit('verifySignatures', 'block', 'unsigned request');
    else if (c.verify.failure === 'missing_signature' && c.claimsPassportHolder) hit('verifySignatures', 'block', 'unsigned claim of a passport identity');
  }
  if (p.requirePassport && !c.passport) hit('requirePassport', 'block', 'no KYA passport');
  if (p.enforceMandate && c.passport) {
    const m = c.passport.mandate, amount = Math.round((o.amount + (c.session?.total ?? 0)) * 100) / 100, qty = o.qty + (c.session?.qty ?? 0);
    if (amount > m.maxPerOrder) hit('enforceMandate', 'challenge', `$${amount} > mandate $${m.maxPerOrder}`);
    else if (m.maxQty != null && qty > m.maxQty) hit('enforceMandate', 'challenge', `${qty} units > mandate ${m.maxQty}`);
    else if (!m.categories.includes(o.category)) hit('enforceMandate', 'challenge', `category ${o.category} not in mandate`);
  }
  if (p.shipLock && c.passport && !addressMatches(o.shipTo, c.passport.address)) hit('shipLock', 'challenge', 'ship-to differs from owner address');
  if (p.velocity > 0 && c.agent.recent >= p.velocity) soft('velocity', `${c.agent.recent + 1} orders this hour`);
  if (p.newAgentCap > 0 && c.agent.age < p.newAgentAge && o.amount > p.newAgentCap) soft('newAgentCap', `agent ${c.agent.age}m old, $${o.amount} > $${p.newAgentCap}`);
  if (p.refundRatioCap > 0 && c.agent.orders >= 3 && c.agent.refunds / c.agent.orders > p.refundRatioCap) hit('refundRatioCap', 'block', `refund ratio ${(c.agent.refunds / c.agent.orders).toFixed(2)}`);
  if (p.merchantRepMin > 0 && c.merchant.rep < p.merchantRepMin) hit('merchantRepMin', 'block', `store rep ${c.merchant.rep.toFixed(2)}`);
  if (p.verifiedMerchantsOnly && !c.merchant.verified) hit('verifiedMerchantsOnly', 'block', 'store not verified');
  if (p.ringDetection > 0 && c.merchant.orders >= 8 && c.merchant.ring > p.ringDetection) hit('ringDetection', 'block', `closed-loop score ${c.merchant.ring.toFixed(2)}`);

  let decision: Decision = 'allow';
  for (const h of hits) if (SEV[h.action] > SEV[decision]) decision = h.action;
  const credit = (p.independentCredit ? c.merchant.independent : c.merchant.fulfilled) ?? 0;
  const exposed = p.exposureRatio > 0 && (c.merchant.exposure ?? 0) + o.amount > p.exposureFloor + p.exposureRatio * credit;
  if (exposed && decision !== 'block') hit('exposureHold', 'allow', `$${Math.round((c.merchant.exposure ?? 0) + o.amount)} unfulfilled against $${Math.round(credit)} delivered: held until delivery is proven`);
  const escrow = decision !== 'block' && (exposed || (p.escrowNewMerchants > 0 && c.merchant.age < p.escrowNewMerchants));
  return { decision, hits, escrow };
}

export interface RefundContext { trackingDelivered: boolean; agent: AgentView }

export function evaluateRefund(p: Policy, c: RefundContext): { approved: boolean; hits: RuleHit[] } {
  const hits: RuleHit[] = [];
  if (p.refundTrackingCheck && c.trackingDelivered) hits.push({ rule: 'refundTrackingCheck', action: 'block', reason: 'carrier shows delivered' });
  if (p.refundRatioCap > 0 && c.agent.orders >= 3 && c.agent.refunds / c.agent.orders > p.refundRatioCap)
    hits.push({ rule: 'refundRatioCap', action: 'block', reason: `refund ratio ${(c.agent.refunds / c.agent.orders).toFixed(2)}` });
  return { approved: hits.length === 0, hits };
}
