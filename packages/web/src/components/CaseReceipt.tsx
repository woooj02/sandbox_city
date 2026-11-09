import { plainName } from '../rulebook-names';
import receipt from '../data/case-receipt.json';
import sleeper from '../data/sleeper-checkout-v4.json';
import type { AgentResult, SavedGate } from '../workflow';

interface Row { label: string; source: string; decision: string; reason?: string | null; amount?: number; qty?: number; shipTo?: string; payment: { state?: string; orderId?: string; captureId?: string; readBack?: string; refund?: { refundId?: string } } | null }

const rows = receipt.rows as unknown as Row[];
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What the selected answer asked for, against what the owner asked for. Read from the saved answer, never restated by hand. */
export function CaseSummary({ observation }: { observation: AgentResult }) {
  let answer: { buy?: boolean; qty?: number; ship_to?: string } = {};
  try { answer = JSON.parse(observation.text); } catch { return null; }
  if (!answer.buy) return null;
  const { owner, listing } = observation.case.input, qty = answer.qty ?? 1, total = Math.round(qty * listing.price * 100) / 100;
  const moved = observation.result.violations.some((v) => v.startsWith('shipped to'));
  return <dl className="case-summary" aria-label="What this answer asked for">
    <div><dt>Owner asked for</dt><dd>{owner.qty}</dd></div>
    <div className={qty > owner.qty ? 'bad' : ''}><dt>Answer proposed</dt><dd>{qty}</dd></div>
    <div className={moved ? 'bad' : ''}><dt>Destination</dt><dd>{moved ? 'Changed' : "Owner's address"}</dd></div>
    <div className={total > owner.budget ? 'bad' : ''}><dt>Total against budget</dt><dd>{money(total)} of {money(owner.budget)}</dd></div>
  </dl>;
}

/**
 * The next step after a comparison: what PayPal really recorded. A receipt is shown as matching only when both the case
 * and the rulebook hash match. Anything else says so, because a receipt for another order proves nothing about this one.
 */
export function CaseReceipt({ observation, comparison }: { observation: AgentResult; comparison: SavedGate }) {
  const sameCase = observation.case.id === receipt.case, sameBook = comparison.hash === receipt.policy;
  const hijack = rows[0], honest = rows.find((r) => r.payment?.captureId), model = rows.filter((r) => r.source === receipt.model);
  const refused = model.filter((r) => r.decision === 'challenge' || r.decision === 'block'), held = model.filter((r) => r.payment?.state === 'held').length, declined = model.filter((r) => r.decision === 'declined').length;
  const fits = receipt.listing.price * receipt.owner.qty <= receipt.owner.budget;
  const units = (r: Row) => `${r.qty} ${r.qty === 1 ? 'unit' : 'units'} to “${r.shipTo}”`;
  const sleeperArm = sleeper.arms.find((a) => a.policy === receipt.policy && !a.ships), honestArm = sleeper.arms.find((a) => a.policy === receipt.policy && a.ships), open = sleeper.arms.find((a) => a.label.startsWith('Lab-Tuned'));
  return <section className="case-receipt" aria-label="Recorded PayPal receipt">
    <h2>What PayPal recorded</h2>
    <p className="observation-id">PayPal sandbox · recorded {receipt.recordedAt.slice(0, 10)} · {plainName(receipt.rulebook)} <code className="prov">{receipt.policy}</code> · not a payment made by this page</p>
    {sameCase && sameBook
      ? <p className="receipt-match">This receipt is for this listing under this rulebook. It went through <code>POST /api/checkout</code> on a local server.</p>
      : <p className="worth-assumption">{sameCase ? `This receipt used ${plainName(receipt.rulebook)}, not the rulebook selected above.` : `This receipt is for ${receipt.listing.title}, not the case selected above.`} It shows what the same gate did at PayPal, not what happened to this answer.</p>}
    <div className="comparison-cards">
      <article className="good"><h3>{hijack.label}</h3><strong>{money(hijack.amount ?? 0)} refused</strong><p>{hijack.reason}. No PayPal order was created.</p></article>
      {honest && <article className="good"><h3>{honest.label}</h3><strong>{money(honest.amount ?? 0)} captured, then refunded</strong><p>Read back as {honest.payment!.readBack}.</p><code>Order {honest.payment!.orderId}</code><code>Capture {honest.payment!.captureId}</code><code>Refund {honest.payment!.refund?.refundId}</code></article>}
      <article><h3>A real model, same listing</h3><strong>{model.length} runs of {receipt.model}</strong><p>Refused: {refused.map(units).join('; ')}. The model declined {declined} times{fits ? ', though one unit fit the budget' : ''}. {held} correct order was held as a PayPal authorization. Nothing refused reached PayPal.</p></article>
    </div>
    {sleeperArm && honestArm && open && <p>A separate proof, same rulebook: a store with a good record stops shipping. It keeps {money(sleeperArm.captured)} of {money(sleeperArm.total)} under {plainName(receipt.rulebook)} and {money(open.captured)} under {plainName(open.label.split(',')[0])}. An honest store with the same record is paid {money(honestArm.captured)}. Delivery and complaints in that proof come from a script.</p>}
    <p className="observation-id">Store and shopper history were imported as established for this proof, and it says so in the file. The earlier incident on this listing, with its own order and refund, used No checks, Auto-tuned and Agent checks. It is shown under Recorded toolkit incident.</p>
  </section>;
}
