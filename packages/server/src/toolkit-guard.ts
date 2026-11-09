/**
 * A checkout gate for PayPal's Agent Toolkit, in one wrapper.
 *
 *   import { PayPalAgentToolkit } from '@paypal/agent-toolkit/openai';
 *   import { guardToolkit } from './toolkit-guard';
 *   const toolkit = guardToolkit(new PayPalAgentToolkit({ ... }), { owner: { category: 'home', qty: 1, address: '12 Neon St, Silk Row', budget: 100 } });
 *   // hand toolkit.getTools() to the model, and answer each tool call with toolkit.handleToolCall(call), as before
 *
 * create_order goes through the same evaluator the benchmark measured, under a named rulebook (Frozen v4 by default).
 * A refused call never reaches PayPal: the model gets the reason as the tool result. pay_order is allowed only for an
 * order this gate approved, and only when the amount PayPal holds for it, read back with get_order, is the amount
 * the gate approved. Other tools pass through untouched.
 *
 * `npm run build:guard` bundles this file and the rulebooks into dist/toolkit-guard.mjs, with no other dependency.
 */
import { CheckoutSession, policyId, type CheckoutArgs, type Policy, type Verdict } from '@sandbox-city/core';
import v3 from '../../../evidence/frozen-v3.json';
import v4 from '../../../evidence/frozen-v4.json';

/** The rulebooks the guard knows by name. Each file's hash is checked before use. */
const NAMED: Record<string, { policy: unknown; policyId: string }> = { 'frozen-v4': v4, 'frozen-v3': v3 };

export function guardRulebook(rulebook: string | Policy = 'frozen-v4'): Policy {
  if (typeof rulebook !== 'string') return rulebook;
  const f = NAMED[rulebook];
  if (!f) throw new Error(`unknown rulebook "${rulebook}": use ${Object.keys(NAMED).join(' or ')}, or pass a rulebook object`);
  if (policyId(f.policy as Policy) !== f.policyId) throw new Error(`${rulebook} does not match its hash`);
  return f.policy as Policy;
}

export interface ToolCall { id: string; type?: 'function'; function: { name: string; arguments: string } }
export interface ToolMessage { role: 'tool'; tool_call_id: string; content: string }
/** The shape of `PayPalAgentToolkit` from `@paypal/agent-toolkit/openai`. */
export interface HandlesToolCalls { getTools(): unknown; handleToolCall(tc: ToolCall): Promise<ToolMessage | { content: unknown; tool_call_id?: string }> }

export interface GuardOptions {
  /** What the owner asked for. The mandate is exactly this: category, units, ship-to address and budget. */
  owner: { category: string; qty: number; address: string; budget: number };
  /** A name ("frozen-v4", "frozen-v3") or a rulebook object, such as one downloaded from the app. */
  rulebook?: string | Policy;
  /** The listing's price, when your agent knows it: an order priced off the listing is refused. */
  listedUnit?: number;
  /** Called with every decision, allowed or refused. */
  onDecision?: (d: GuardDecision) => void;
}

export interface GuardDecision { tool: string; allowed: boolean; reason?: string; policy?: string; orderId?: string; amount?: number }

export interface GuardedToolkit {
  getTools(): unknown;
  handleToolCall(tc: ToolCall): Promise<ToolMessage>;
  /** Every decision this guard made, in order. */
  decisions: GuardDecision[];
}

const parse = (s: string): Record<string, unknown> | null => { try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } };
const text = (c: unknown) => (typeof c === 'string' ? c : JSON.stringify(c));

export function guardToolkit(toolkit: HandlesToolCalls, opts: GuardOptions): GuardedToolkit {
  const policy = guardRulebook(opts.rulebook);
  const session = new CheckoutSession(policy, { owner: opts.owner, listedUnit: opts.listedUnit });
  const decisions: GuardDecision[] = [];
  const decide = (d: GuardDecision) => { decisions.push(d); opts.onDecision?.(d); };
  const reply = (tc: ToolCall, content: unknown): ToolMessage => ({ role: 'tool', tool_call_id: tc.id, content: text(content) });
  const refuse = (tc: ToolCall, v: Pick<Verdict, 'reason' | 'decision' | 'policy'>, extra: Partial<GuardDecision> = {}) => {
    const reason = v.reason ?? v.decision;
    decide({ tool: tc.function.name, allowed: false, reason, policy: v.policy, ...extra });
    return reply(tc, { error: `The payment gate refused this call (${reason}). Nothing was sent to PayPal.` });
  };
  const pass = async (tc: ToolCall) => { const r = await toolkit.handleToolCall(tc); return reply(tc, r.content); };
  /** The amount PayPal holds for an order, read with the toolkit's own get_order. */
  const held = async (orderId: string) => {
    const r = await toolkit.handleToolCall({ id: `guard-read-${orderId}`, type: 'function', function: { name: 'get_order', arguments: JSON.stringify({ id: orderId }) } });
    const v = (parse(text(r.content)) as { purchase_units?: { amount?: { value?: string } }[] } | null)?.purchase_units?.[0]?.amount?.value;
    return v != null && Number.isFinite(Number(v)) ? Number(v) : undefined;
  };

  return {
    decisions,
    getTools: () => toolkit.getTools(),
    async handleToolCall(tc) {
      const name = tc.function.name;
      if (name !== 'create_order' && name !== 'pay_order') return pass(tc);
      const args = parse(tc.function.arguments);
      if (!args) return refuse(tc, { decision: 'block', reason: 'the arguments are not a JSON object', policy: policyId(policy) });
      if (name === 'create_order') {
        const v = session.checkOrder(args as CheckoutArgs);
        if (!v.ok) return refuse(tc, v, { amount: v.order?.amount });
        const r = await toolkit.handleToolCall(tc);
        const id = (parse(text(r.content)) as { id?: unknown } | null)?.id;
        if (typeof id === 'string' && v.order) session.created(id, v.order);
        decide({ tool: name, allowed: true, policy: v.policy, orderId: typeof id === 'string' ? id : undefined, amount: v.order?.amount });
        return reply(tc, r.content);
      }
      const id = typeof args.id === 'string' ? args.id : '';
      const first = session.checkPay(id);
      if (!first.ok) return refuse(tc, first, { orderId: id });
      const amount = policy.strictOrders ? await held(id) : undefined;
      // fail closed: an order whose amount cannot be read back is not captured
      if (policy.strictOrders && amount === undefined) return refuse(tc, { decision: 'block', reason: `order ${id} could not be read back from PayPal`, policy: first.policy }, { orderId: id });
      const v = session.checkPay(id, { amount });
      if (!v.ok) return refuse(tc, v, { orderId: id, amount });
      decide({ tool: name, allowed: true, policy: v.policy, orderId: id });
      return pass(tc);
    },
  };
}
