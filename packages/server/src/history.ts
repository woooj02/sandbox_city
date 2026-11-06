/**
 * The checkout's history adapter: what a store and an agent look like right now, as the evaluator's input.
 *
 * It is folded from the payment journal, so a payment and the record it earned cannot disagree after a crash, and it
 * uses the same formulas as the simulated day. A store or agent nobody has seen is new, with no record: an unknown
 * is never treated as established. A record from elsewhere comes in through an import, and says where it came from.
 */
import { agentRep, closedLoop, isIndependentBuyer, merchantRep, type AgentView, type MerchantView } from '@sandbox-city/core';
import type { PaymentJournal, PayRecord } from './payments';

const MINUTE = 60_000;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Implement this to feed the checkout from your own systems. */
export interface HistorySource {
  merchant(id: string): MerchantView;
  agent(id: string): AgentView;
  /** Whether this buyer's delivery counts as independent credit for this store. */
  independent(agent: string, merchant: string): boolean;
}

/** What is left of a payment after its refunds: $1 back on $80 leaves $79 at stake. */
const kept = (r: PayRecord) => r.input.amount - (r.refunded ?? 0);

export class JournalHistory implements HistorySource {
  constructor(private journal: PaymentJournal, private now: () => number = Date.now) {}

  private records(field: 'merchant' | 'agent', id: string) { return this.journal.all().filter((r) => r.context?.[field] === id); }
  private live(r: PayRecord) { return r.state !== 'declined' && r.state !== 'voided'; }
  private firstOf(rs: PayRecord[]) { return rs.length ? Math.min(...rs.map((r) => Date.parse(r.context!.decidedAt))) : this.now(); }

  /** When this party first existed: its import says so, otherwise its first order. */
  private since(kind: 'merchant' | 'agent', id: string, rs: PayRecord[]) {
    const base = this.journal.imported(kind, id);
    return base ? Date.parse(base.at) - base.age * MINUTE : this.firstOf(rs);
  }

  merchant(id: string): MerchantView {
    const base = this.journal.imported('merchant', id), rs = this.records('merchant', id);
    const age = (this.now() - this.since('merchant', id, rs)) / MINUTE;
    const paid = rs.filter((r) => this.live(r));
    const refunds = (base?.refunds ?? 0) + rs.filter((r) => r.state === 'refunded' || r.refunded).length;
    const orders = (base?.orders ?? 0) + paid.length;
    const delivered = (base?.deliveries ?? 0) + rs.filter((r) => r.delivered).length;
    const buyers = new Map<string, number>();
    for (const r of paid) buyers.set(r.context!.agent, (buyers.get(r.context!.agent) ?? 0) + 1);
    const { loop, total } = closedLoop(buyers, (b) => this.agentOrders(b));
    const credited = rs.filter((r) => r.credited);
    // held money is not exposure: it has not reached the store. An unresolved capture counts until someone proves otherwise.
    const owed = paid.filter((r) => !r.context!.escrow && !r.credited && r.state !== 'refunded');
    return {
      age, verified: base?.verified ?? false, orders,
      rep: merchantRep(delivered, base?.verified ?? false, age, orders ? refunds / orders : 0),
      ring: total ? loop / total : 0,
      exposure: r2((base?.exposure ?? 0) + owed.reduce((n, r) => n + kept(r), 0)),
      fulfilled: r2((base?.fulfilled ?? 0) + credited.reduce((n, r) => n + kept(r), 0)),
      independent: r2((base?.independent ?? 0) + credited.filter((r) => r.independent).reduce((n, r) => n + kept(r), 0)),
    };
  }

  private agentOrders(id: string) { return (this.journal.imported('agent', id)?.orders ?? 0) + this.records('agent', id).filter((r) => this.live(r)).length; }

  agent(id: string): AgentView {
    const base = this.journal.imported('agent', id), rs = this.records('agent', id);
    if (!base && !rs.length) return { age: 0, orders: 0, recent: 0, refunds: 0, rep: 0 };
    const age = (this.now() - this.since('agent', id, rs)) / MINUTE;
    const orders = this.agentOrders(id), refunds = (base?.refunds ?? 0) + rs.filter((r) => r.state === 'refunded').length;
    const recent = rs.filter((r) => this.live(r) && this.now() - Date.parse(r.context!.decidedAt) < 60 * MINUTE).length;
    return { age, orders, recent, refunds, rep: agentRep(orders, refunds, age) };
  }

  independent(agent: string, merchant: string): boolean {
    const here = this.journal.all().filter((r) => r.context?.agent === agent && r.context.merchant === merchant && this.live(r)).length;
    return isIndependentBuyer(this.since('agent', agent, this.records('agent', agent)), this.since('merchant', merchant, this.records('merchant', merchant)), here, this.agentOrders(agent));
  }
}
