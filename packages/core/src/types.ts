export type AttackKind =
  | 'prompt_injection'
  | 'fake_store'
  | 'refund_abuse'
  | 'card_testing'
  | 'impersonation'
  | 'fraud_ring';

export const ATTACK_KINDS: AttackKind[] = [
  'prompt_injection', 'fake_store', 'refund_abuse', 'card_testing', 'impersonation', 'fraud_ring',
];

export const ATTACK_LABEL: Record<AttackKind, string> = {
  prompt_injection: 'Prompt Injection',
  fake_store: 'Fake Store',
  refund_abuse: 'Refund Abuse',
  card_testing: 'Stolen Card Testing',
  impersonation: 'Agent Impersonation',
  fraud_ring: 'Fraud Ring',
};

export type Decision = 'allow' | 'challenge' | 'block';

export interface Vec { x: number; y: number }

export interface Injection {
  by: string;
  text: string;
  /** 0..1, how hard it is to tell this apart from normal listing copy. */
  subtlety: number;
  payload: { qty: number; shipTo: string };
}

export interface Product {
  sku: string;
  title: string;
  price: number;
  category: string;
  description: string;
  /** Legit listings that happen to contain imperative "instructions" (care labels etc.). */
  imperativeCopy: boolean;
  injected?: Injection;
}

export interface Merchant extends Vec {
  id: string;
  name: string;
  district: number;
  catalog: Product[];
  /** Ground truth, invisible to the gate. */
  honest: boolean;
  owner?: string; // attacker id when dishonest
  openedAt: number;
  /** Business identity verified through Log In with PayPal. */
  verified: boolean;
  shipRate: number;
  priceFactor: number;
  closed?: boolean;
}

export interface Mandate {
  /** Max amount per order the human owner authorised (AP2-style intent mandate). */
  maxPerOrder: number;
  categories: string[];
}

/** KYA "agent passport": binds an agent key to a verified human owner (Log In with PayPal). */
export interface Passport {
  agentId: string;
  keyId: string;
  publicKey: string; // hex
  ownerPayerId: string;
  address: string;
  issuedAt: number;
  mandate: Mandate;
}

export interface Shopper extends Vec {
  id: string;
  name: string;
  district: number;
  passport: Passport | null;
  address: string;
  /** Purchases per tick (base rate). */
  rate: number;
  bursty: boolean;
  gullibility: number;
  priceSensitivity: number;
  refundRate: number;
  giftRate: number;
  clockSkew: number;
  joinedAt: number;
  hero?: boolean;
  /** Ground truth controller. undefined => honest human-owned agent. */
  controlledBy?: string;
}

export interface Attacker extends Vec {
  id: string;
  name: string;
  kind: AttackKind;
  genome: Record<string, number>;
  /** Shopper-shaped identities this attacker drives. */
  agents: string[];
  merchant?: string;
  phase: string;
  nextActAt: number;
  stolenCards: number;
}

export interface SignedRequest {
  method: string;
  authority: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface OrderIntent {
  id: string;
  t: number;
  buyer: string;
  merchant: string;
  sku: string;
  qty: number;
  unit: number;
  amount: number;
  shipTo: string;
  category: string;
  request: SignedRequest | null;
  /** What the agent claims to be (Signature-Agent header). */
  claimedAgent: string;
  /** Ground truth (lab-only, never read by the gate). */
  truth: {
    malicious: boolean;
    attack?: AttackKind;
    attacker?: string;
    hijacked?: boolean;
    victim?: string;
    /** $ the honest world loses if this succeeds. */
    harm: number;
  };
}

export interface RuleHit { rule: string; action: Decision; reason: string }

export interface GateResult { decision: Decision; hits: RuleHit[]; escrow: boolean }

export type Outcome =
  | 'completed'      // money moved, goods ship
  | 'escrowed'       // authorised, held until tracking
  | 'blocked'        // gate said no
  | 'abandoned'      // challenge failed / owner declined
  | 'declined'       // PayPal declined (risk / instrument)
  | 'failed';        // rails error after retries

export type SimEvent =
  | { type: 'order'; t: number; id: string; buyer: string; merchant: string; amount: number; qty: number;
      decision: Decision; outcome: Outcome; hits: RuleHit[]; escrow: boolean;
      paypal?: { orderId?: string; captureId?: string; authId?: string; status: string; rail: 'twin' | 'sandbox'; debugId?: string };
      truth: OrderIntent['truth']; retries: number; duplicateCharge: boolean; charges: number;
      /** Rails the payment was attempted on (set even when every attempt failed). */
      rail: 'twin' | 'sandbox' }
  | { type: 'refund'; t: number; id: string; order: string; buyer: string; merchant: string; amount: number;
      approved: boolean; reason: string; hits: RuleHit[]; rail: 'twin' | 'sandbox'; truth: { malicious: boolean; attack?: AttackKind; harm: number } }
  | { type: 'capture'; t: number; order: string; amount: number; rail: 'twin' | 'sandbox' }
  | { type: 'ship'; t: number; order: string; merchant: string; buyer: string; tracking: string }
  | { type: 'store_open'; t: number; merchant: string; name: string; honest: boolean; attacker?: string }
  | { type: 'store_close'; t: number; merchant: string; reason: string }
  | { type: 'inject'; t: number; attacker: string; merchant: string; sku: string; text: string }
  | { type: 'hijack'; t: number; shopper: string; merchant: string; attacker: string; resisted: boolean; sanitized: boolean }
  | { type: 'attack'; t: number; attacker: string; kind: AttackKind; note: string }
  | { type: 'chaos'; t: number; order: string; fault: string; recovered: boolean }
  | { type: 'metrics'; t: number; m: Metrics };

export interface KindTally { attempts: number; attempted: number; prevented: number; leaked: number }

export interface Metrics {
  t: number;
  honest: { attempts: number; completed: number; blocked: number; abandoned: number; challenged: number; declined: number; gmv: number; blockedValue: number };
  fraud: { attempts: number; attempted: number; prevented: number; leaked: number; byKind: Record<AttackKind, KindTally> };
  refunds: { legitApproved: number; legitDenied: number; abuseApproved: number; abuseDenied: number };
  chaos: { faults: number; recovered: number; duplicateCharges: number; duplicateValue: number };
  /** % of attempted fraud $ stopped. */
  safety: number;
  /** % of honest purchase attempts that completed. */
  access: number;
  /** honest GMV - leaked harm - friction cost. */
  netValue: number;
  orders: number;
}
