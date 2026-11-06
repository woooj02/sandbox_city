import type { Metrics } from '@sandbox-city/core';

/** Payment confirmation and delivery are separate facts. */
export function MoneyStates({ m }: { m: Metrics }) {
  return (
    <div className="money-states simple-note">
      {(m.money.pending > 0 || m.money.unresolved > 0) && <p role="status">{m.money.pending} pending, {m.money.unresolved} unresolved. No unconfirmed capture, refund or fraud saving is counted.</p>}
      <details>
        <summary>What the money states mean</summary>
        <dl>
          <dt>Authorized</dt><dd>A hold on funds; the store has not been paid.</dd>
          <dt>Pending</dt><dd>PayPal has not finished. Read back before counting the result.</dd>
          <dt>Captured</dt><dd>PayPal confirmed the payment. The goods may still be on their way.</dd>
          <dt>Delivered</dt><dd>The goods arrived. Delivered value also needs a confirmed payment that stayed paid.</dd>
          <dt>Refunded / voided</dt><dd>PayPal confirmed money returned / a hold cancelled.</dd>
          <dt>Unresolved</dt><dd>A failed or unclear operation, including a declined held capture. Its result needs review.</dd>
        </dl>
      </details>
    </div>
  );
}
