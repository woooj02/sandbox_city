/**
 * A rule change proposed by something we do not trust, such as a model reading an incident. It only ever reaches a
 * rulebook through this function: plain code decides what is a legal change, and the invariants are not negotiable.
 */
import { RULES, type Policy } from './policy';

/** Owner authority and payment integrity. No score trades these away, so no proposal may switch them off. */
export const INVARIANTS = ['enforceMandate', 'shipLock', 'strictOrders', 'idempotencyKeys'] as const;
/** The same invariants as a floor for any search over rulebooks. */
export const INVARIANT_FLOOR = Object.fromEntries(INVARIANTS.map((k) => [k, true])) as Partial<Policy>;
export const MAX_CHANGES = 4;

export type PatchResult = { ok: true; policy: Policy; changed: string[] } | { ok: false; reason: string };

export function applyPatch(base: Policy, patch: unknown): PatchResult {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return { ok: false, reason: 'a patch is an object of rule changes' };
  const entries = Object.entries(patch);
  if (!entries.length) return { ok: false, reason: 'the patch changes nothing' };
  if (entries.length > MAX_CHANGES) return { ok: false, reason: `at most ${MAX_CHANGES} rules per patch` };
  const next = { ...base } as unknown as Record<string, unknown>;
  const changed: string[] = [];
  for (const [key, value] of entries) {
    const rule = RULES.find((r) => r.key === key);
    if (!rule) return { ok: false, reason: `${key} is not a rule` };
    if ((INVARIANTS as readonly string[]).includes(key) && value !== true) return { ok: false, reason: `${key} is an invariant and stays on` };
    if (rule.kind === 'bool') {
      if (typeof value !== 'boolean') return { ok: false, reason: `${key} takes true or false` };
    } else {
      const min = rule.min ?? 0, max = rule.max ?? 1, step = rule.step ?? 1;
      if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, reason: `${key} takes a number` };
      if (value !== 0 && (value < min || value > max)) return { ok: false, reason: `${key} must be 0 or between ${min} and ${max}` };
      const steps = (value - min) / step;
      if (value !== 0 && Math.abs(steps - Math.round(steps)) > 1e-6) return { ok: false, reason: `${key} moves in steps of ${step}` };
    }
    if (next[key] !== value && !(next[key] === undefined && value === 0)) changed.push(key);
    next[key] = value;
  }
  if (!changed.length) return { ok: false, reason: 'the patch changes nothing' };
  return { ok: true, policy: next as unknown as Policy, changed };
}
