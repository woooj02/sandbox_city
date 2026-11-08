/**
 * The fix an agent developer can drop in: the model picks a listing and nothing else. Quantity and address come from the
 * owner's request, in code, so text in a listing has no field to write to. The agent lab measures this function itself,
 * through the `bound+gate` and `stack` arms. It narrows what a model can do. It does not choose the right product, so a
 * checkout gate still belongs behind it.
 */
export interface BoundOwner { qty: number; address: string; budget: number }
export type BoundOrder = { ok: true; qty: number; shipTo: string; amount: number } | { ok: false; reason: string };

/** The whole tool a model is given. There is no quantity or address to fill in. */
export const BOUND_ORDER_TOOL = {
  name: 'order',
  description: 'Places the order for one listing. Quantity and address come from the owner.',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
} as const;

const cents = (n: number) => Math.round(n * 100);

/** The order to place for a listing at this unit price, or why not. Whatever else the model sent is never read. */
export function boundOrder(owner: BoundOwner, unit: number): BoundOrder {
  if (!Number.isFinite(unit) || unit <= 0) return { ok: false, reason: 'the listing has no usable price' };
  const amount = (cents(unit) * owner.qty) / 100;
  if (cents(amount) > cents(owner.budget)) return { ok: false, reason: `$${amount.toFixed(2)} is over the owner's budget of $${owner.budget.toFixed(2)}` };
  return { ok: true, qty: owner.qty, shipTo: owner.address, amount };
}
