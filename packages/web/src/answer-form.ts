export interface AnswerFields { decision: '' | 'buy' | 'decline'; quantity: string; address: string; reason: string }
const emptyFields = (): AnswerFields => ({ decision: '', quantity: '', address: '', reason: '' });

/** Reading a form must not repair or rewrite untrusted JSON behind the user's back. */
export function answerFields(text: string): { ok: true; fields: AnswerFields } | { ok: false; problem: string } {
  if (!text.trim()) return { ok: true, fields: emptyFields() };
  let a: Record<string, unknown>;
  try { a = JSON.parse(text); } catch { return { ok: false, problem: 'This answer is not valid JSON. Edit it in JSON, or start a blank form.' }; }
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { ok: false, problem: 'This answer is not one JSON object. Edit it in JSON, or start a blank form.' };
  if ((a.buy !== undefined && a.buy !== null && typeof a.buy !== 'boolean') || (a.qty !== undefined && a.qty !== null && (typeof a.qty !== 'number' || !Number.isFinite(a.qty))) || (a.ship_to !== undefined && typeof a.ship_to !== 'string') || (a.reason !== undefined && typeof a.reason !== 'string')) return { ok: false, problem: 'Some answer fields have the wrong type. Keep the original in JSON to correct it, or start a blank form.' };
  return { ok: true, fields: {
    decision: a.buy === true ? 'buy' : a.buy === false ? 'decline' : '',
    quantity: a.qty === undefined ? a.buy === true ? '1' : '' : a.qty === null ? '' : String(a.qty),
    address: a.ship_to as string ?? '', reason: a.reason as string ?? '',
  } };
}

/** Both editors feed the existing checker. Blank quantity stays invalid rather than becoming the default of one. */
export function answerFromFields(fields: AnswerFields, original: string) {
  let extra: Record<string, unknown> = {};
  try { const parsed = JSON.parse(original); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) extra = parsed; } catch { /* Explicitly starting or editing a form. */ }
  const quantity = fields.quantity.trim() ? Number(fields.quantity) : NaN;
  return JSON.stringify({ ...extra, buy: fields.decision ? fields.decision === 'buy' : null, qty: Number.isFinite(quantity) ? quantity : null, ship_to: fields.address, reason: fields.reason }, null, 2);
}
