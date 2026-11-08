/**
 * Differential fuzzing of the checkout gate. The generator mutates a valid order, field by field, and the reference
 * below decides what the order would really do at PayPal without sharing a line with the gate: integer cents, Unicode
 * tokens, the exact address the server would send. Two properties:
 *   sound:    if the gate allows an order, the reference finds nothing wrong with it.
 *   usable:   if the reference finds nothing wrong, the gate allows it. A gate that refuses honest orders is broken too.
 * Nothing may throw, whatever the agent sends: agent output is untrusted input.
 */
import { canonicalAddress, CheckoutSession, type CheckoutArgs, type CheckoutLine } from './checkout';
import type { Policy } from './policy';
import { Rng } from './rng';

export const FUZZ_OWNER = { category: 'audio', qty: 1, address: '12 Neon St, Silk Row', budget: 304 };
const LISTED = 289.5;

const words = (s: unknown) => (typeof s === 'string' ? s.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [] : []);
const sameWords = (a: string[], b: string[]) => a.length === b.length && a.every((w, i) => w === b[i]);
const plainNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const exactCents = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

/** What is wrong with this order, read independently of the gate. Empty means the owner would accept it. */
export function reference(args: CheckoutArgs, listedUnit: number | undefined, sent: ReturnType<typeof canonicalAddress>): string[] {
  const bad: string[] = [];
  if (!Array.isArray(args?.items) || !args.items.length) return ['no lines'];
  let cents = 0, qty = 0;
  for (const l of args.items as (CheckoutLine | null)[]) {
    if (!l || typeof l !== 'object' || Array.isArray(l)) { bad.push('line is not an object'); continue; }
    const q = l.quantity ?? 1, unit = l.itemCost ?? 0, tax = l.taxPercent ?? 0;
    if (!Number.isSafeInteger(q) || q < 1) { bad.push('bad quantity'); continue; }
    if (!plainNumber(unit) || unit <= 0 || !exactCents(unit)) { bad.push('bad unit price'); continue; }
    if (!plainNumber(tax) || tax < 0) { bad.push('bad tax'); continue; }
    if (listedUnit != null && Math.round(unit * 100) !== Math.round(listedUnit * 100)) bad.push('not the listed price');
    if (l.itemTotal != null && (!plainNumber(l.itemTotal) || Math.round(l.itemTotal * 100) !== Math.round(unit * 100) * q)) bad.push('line total does not add up');
    qty += q;
    cents += Math.round(unit * 100) * q * (1 + tax / 100);
  }
  const shipping = args.shippingCost ?? 0, discount = args.discount ?? 0;
  if (!plainNumber(shipping) || shipping < 0 || !exactCents(shipping)) bad.push('bad shipping');
  else cents += Math.round(shipping * 100);
  if (!plainNumber(discount) || discount < 0 || !exactCents(discount)) bad.push('bad discount');
  else cents -= Math.round(discount * 100);
  if (args.currencyCode != null && args.currencyCode !== 'USD') bad.push('not dollars');
  if (qty > FUZZ_OWNER.qty) bad.push('too many units');
  if (Math.round(cents) > FUZZ_OWNER.budget * 100) bad.push('over budget');
  if (Math.round(cents) <= 0) bad.push('charge is not positive');
  const fields = args.shippingAddress as unknown;
  if (fields != null && (typeof fields !== 'object' || Object.values(fields as object).some((v) => v != null && typeof v !== 'string'))) bad.push('an address field is not text');
  // the address PayPal would really get, against the owner's, field by field
  if (!sent) bad.push('no address');
  else {
    const place = [...words(sent.address_line_1), ...(sameWords(words(sent.address_line_1), words(FUZZ_OWNER.address)) ? [] : words(sent.admin_area_2))];
    if (!sameWords(place, words(FUZZ_OWNER.address))) bad.push('ships to another street or city');
    if (sameWords(words(sent.address_line_1), words(FUZZ_OWNER.address)) && words(sent.admin_area_2).join(' ') !== 'silk row') bad.push('ships to another city');
    if (sent.address_line_2?.trim()) bad.push('second address line');
    if (sent.admin_area_1.trim().toUpperCase() !== 'CA') bad.push('another state');
    if (sent.postal_code.trim() !== '94107') bad.push('another postal code');
    if (sent.country_code.trim().toUpperCase() !== 'US') bad.push('another country');
  }
  return bad;
}

const base = (): CheckoutArgs => ({
  currencyCode: 'USD', items: [{ name: 'Velvet Earbuds', quantity: 1, itemCost: LISTED, itemTotal: LISTED }],
  shippingAddress: { address_line_1: '12 Neon St, Silk Row', admin_area_1: 'CA', postal_code: '94107', country_code: 'US' },
});

const JUNK: unknown[] = [null, 0, -1, 0.5, 1e21, Number.MAX_VALUE, NaN, Infinity, -Infinity, '', ' ', '1', '289.50', true, [], {}, [1], { valueOf: 1 }];
const SUFFIX = [' 東京都', ' Москва', ' c/o Viper', ' PO Box 404', ' Apt 9', ' #2', ' ‮', '​', ' 北京', ' ١٢'];
const FORMATS: ((s: string) => string)[] = [
  (s) => s.toUpperCase(), (s) => s.toLowerCase(), (s) => `  ${s}  `, (s) => s.replace(', ', ',  '), (s) => s.replace(', ', ' , '), (s) => `${s}.`, (s) => s.replace('St', 'St.'),
];
const STREETS = ['1 2 Neon St, Silk Row', '12 Ne on St, Silk Row', '12 Neon St Silk Row', '12 Neon, St Silk Row', '21 Neon St, Silk Row', '12 Neon St, Silk Rowe', '12 Nеon St, Silk Row', '１２ Neon St, Silk Row', '12 Neon St, Lantern Quarter', 'PO Box 404, Silk Row', '12 Neon St'];
const CITIES = ['Row', 'Silk', 'S', 'k R', 'Neon', 'Silk Row', 'silk row', 'St', 'Lantern Quarter', '12', 'Reno'];

type Mutation = (a: CheckoutArgs, r: Rng) => void;
const addr = (a: CheckoutArgs) => (a.shippingAddress ??= {});
const line = (a: CheckoutArgs) => a.items![0];
const pick = <T,>(r: Rng, xs: T[]) => xs[Math.floor(r.next() * xs.length)];

const MUTATIONS: Record<string, Mutation> = {
  'address suffix': (a, r) => { addr(a).address_line_1 += pick(r, SUFFIX); },
  'address format': (a, r) => { addr(a).address_line_1 = pick(r, FORMATS)(addr(a).address_line_1!); },
  'another street': (a, r) => { addr(a).address_line_1 = pick(r, STREETS); },
  'city field': (a, r) => { addr(a).admin_area_2 = pick(r, CITIES); },
  'street and city split': (a, r) => { addr(a).address_line_1 = '12 Neon St'; addr(a).admin_area_2 = pick(r, CITIES); },
  'second line': (a, r) => { addr(a).address_line_2 = pick(r, ['Apt 9', ' ', 'c/o Viper', '​', '東京', '#', '-']); },
  'state': (a, r) => { addr(a).admin_area_1 = pick(r, ['ca', ' CA ', 'NV', 'C A', 'Ｃ Ａ', '']); },
  'postal': (a, r) => { addr(a).postal_code = pick(r, ['94107', ' 94107', '94108', '9 4107', '９４１０７', '']); },
  'country': (a, r) => { addr(a).country_code = pick(r, ['US', 'us', 'CA', 'U S', 'ＵＳ', '']); },
  'no address': (a, r) => { a.shippingAddress = pick(r, [null, undefined, {}, { address_line_1: ' ' }]) as never; },
  'quantity': (a, r) => { const q = pick(r, [0, 1, 2, 8, -1, 1.5, 1e21, 2 ** 53]); line(a).quantity = q; line(a).itemTotal = q * LISTED; },
  'line total': (a, r) => { line(a).itemTotal = pick(r, [0, 1, LISTED - 0.01, LISTED + 0.01, LISTED * 8]); },
  'unit price': (a, r) => { const u = pick(r, [0, 0.001, 0.004, 0.005, 1, 289.499, 289.504, LISTED + 1, 1e9]); line(a).itemCost = u; line(a).itemTotal = u; },
  'tax': (a, r) => { line(a).taxPercent = pick(r, [0, 1, 5, 5.01, 900, 1e-9]); },
  'shipping': (a, r) => { a.shippingCost = pick(r, [0, 1, 14.49, 14.5, 14.51, 5000, 0.004, 0.009]); },
  'discount': (a, r) => { a.discount = pick(r, [0, 1, 289.5, 289.51, 1000, 0.004]); },
  'discount hides a dear order': (a) => { line(a).quantity = 8; line(a).itemTotal = LISTED * 8; a.discount = LISTED * 7; },
  'discount hides shipping': (a) => { a.shippingCost = 5000; a.discount = 5000; },
  'second item': (a, r) => { a.items!.push({ name: 'Extra', quantity: 1, itemCost: pick(r, [LISTED, 0.01, 1]), itemTotal: undefined }); },
  'currency': (a, r) => { a.currencyCode = pick(r, ['USD', 'usd', 'EUR', 'JPY', '']); },
  'junk in a number': (a, r) => { const k = pick(r, ['quantity', 'itemCost', 'itemTotal', 'taxPercent'] as const); (line(a) as Record<string, unknown>)[k] = pick(r, JUNK); },
  'junk in the order': (a, r) => { const k = pick(r, ['shippingCost', 'discount', 'currencyCode', 'items', 'shippingAddress'] as const); (a as Record<string, unknown>)[k] = pick(r, JUNK); },
  'junk in an address': (a, r) => { const k = pick(r, ['address_line_1', 'address_line_2', 'admin_area_1', 'admin_area_2', 'postal_code', 'country_code'] as const); (addr(a) as Record<string, unknown>)[k] = pick(r, JUNK); },
  'junk line': (a, r) => { a.items = [pick(r, JUNK) as CheckoutLine]; },
};

export interface FuzzFinding { kind: 'unsound' | 'refused-good' | 'threw'; mutations: string[]; args: string; reference: string[]; gate: string }
export interface FuzzReport { runs: number; allowed: number; refused: number; unsound: number; refusedGood: number; threw: number; byMutation: Record<string, number>; findings: FuzzFinding[] }

export function fuzzGate(policy: Policy, runs: number, seed = 'gate-fuzz-1', keep = 40): FuzzReport {
  const r = new Rng(seed), names = Object.keys(MUTATIONS);
  // a session changes only when an order is created, and none is here: one per price keeps each check independent
  // and every call here would be validly signed, so the signature, which costs more than the rest, is left out
  const unsigned = { ...policy, verifySignatures: false };
  const sessions = new Map([LISTED, undefined].map((listedUnit) => [listedUnit, new CheckoutSession(unsigned, { owner: FUZZ_OWNER, listedUnit })]));
  const report: FuzzReport = { runs, allowed: 0, refused: 0, unsound: 0, refusedGood: 0, threw: 0, byMutation: {}, findings: [] };
  const seen = new Set<string>();
  const note = (f: FuzzFinding) => { const id = `${f.kind}|${f.mutations.join('+')}|${f.reference.join(',')}`; if (seen.has(id) || report.findings.length >= keep) return; seen.add(id); report.findings.push(f); };
  for (let i = 0; i < runs; i++) {
    const a = base(), chosen: string[] = [];
    for (let n = Math.floor(r.next() * 3); n >= 0; n--) {
      const m = pick(r, names);
      chosen.push(m);
      try { MUTATIONS[m](a, r); } catch { /* an earlier mutation broke the shape this one expected: that is a valid input too */ }
    }
    const listed = r.next() < 0.8 ? LISTED : undefined;
    const text = () => { try { return JSON.stringify(a, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v)); } catch { return '?'; } };
    for (const m of chosen) report.byMutation[m] = (report.byMutation[m] ?? 0) + 1;
    try {
      const session = sessions.get(listed)!;
      const v = session.checkOrder(a);
      const sent = canonicalAddress(a.shippingAddress, session.scope);
      const wrong = reference(a, listed, sent);
      if (v.ok) { report.allowed++; if (wrong.length) { report.unsound++; note({ kind: 'unsound', mutations: chosen, args: text(), reference: wrong, gate: `allowed $${v.order?.amount}` }); } }
      else { report.refused++; if (!wrong.length) { report.refusedGood++; note({ kind: 'refused-good', mutations: chosen, args: text(), reference: [], gate: v.reason ?? v.decision }); } }
    } catch (e) { report.threw++; note({ kind: 'threw', mutations: chosen, args: text(), reference: [], gate: (e as Error).message.slice(0, 120) }); }
  }
  return report;
}
