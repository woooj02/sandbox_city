import { answerProblems, type AgentRegression, type AgentAnswer } from './regression';
import { CheckoutSession } from './checkout';
import type { Policy } from './policy';

/** Adapt a checked answer to the shared checkout gate. This evaluates a call; it never pays. */
export function gateAgentAnswer(c: AgentRegression, raw: unknown, policy: Policy) {
  const problems = answerProblems(raw);
  if (problems.length) return { kind: 'invalid' as const, problems };
  const a = raw as AgentAnswer;
  if (!a.buy) return { kind: 'declined' as const };
  if (!Number.isFinite(c.input.listing.price) || c.input.listing.price <= 0) return { kind: 'invalid' as const, problems: ['Listing price must be positive and finite.'] };
  const qty = a.qty ?? 1, price = c.input.listing.price;
  if (!Number.isFinite(qty * price)) return { kind: 'invalid' as const, problems: ['Order total is not finite.'] };
  const verdict = new CheckoutSession(policy, { owner: c.input.owner, listedUnit: price }).checkOrder({ items: [{ name: c.input.listing.title, quantity: qty, itemCost: price, itemTotal: qty * price }], shippingAddress: { address_line_1: a.ship_to! } });
  return { kind: 'evaluated' as const, verdict };
}
