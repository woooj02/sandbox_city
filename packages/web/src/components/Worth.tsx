import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { breakEven, DEFAULT_PRICES, policyId, priceDefense, rankDefenses, type DefenseArm, type Policy, type PriceKnob, type Prices } from '@sandbox-city/core';
import { useStore } from '../store';
import { client } from '../sim/client';
import { prefersReducedMotion } from '../sim/motion';
import { useModal } from './useModal';
import { money } from './meta';
import raw from '../data/evidence.json';

interface Arm { key: string; name: string; label: string; policyId: string; rules: Policy; exact?: { access: number }; fulfilled: { mean: number }; stolen: { mean: number }; access: { mean: number }; heldDollarHours: { mean: number }; challengedPer100: number; ordersPerDay: number; sleeper: { stolen: { mean: number } } }
const round = (raw as unknown as { fourth: { version: string; evaluatorSource: string; frozen: { evaluator: string; policyId: string }; arms: Arm[]; protocol: { testDays: number }; heldOut: { label: string; arms: { name: string; stolen: { mean: number } }[] }[] } | null }).fourth;

type PricedArm = DefenseArm & { rules: Policy; label: string; policyId: string };
const arms: PricedArm[] = (round?.arms ?? []).map((a) => ({
  key: a.key, name: a.name, label: a.label, policyId: policyId(a.rules), rules: a.rules, fulfilled: a.fulfilled.mean, stolen: a.stolen.mean, access: a.exact?.access ?? a.access.mean,
  heldDollarHours: a.heldDollarHours.mean, stepUps: (a.challengedPer100 / 100) * a.ordersPerDay,
}));

const KNOBS: { key: PriceKnob; label: string; help: string; min: number; max: number; step: number; show: (n: number) => string; flip: (n: string, more: boolean) => string }[] = [
  { key: 'stolenDollar', label: 'One stolen dollar costs you', help: '$1 is the dollar alone. More counts fees, disputes and lost trust.', min: 1, max: 5, step: 0.05, show: (n) => `$${n.toFixed(2)}`, flip: (n, more) => `a stolen dollar costs you ${more ? 'more' : 'less'} than ${n}` },
  { key: 'stepUp', label: 'One step-up costs you', help: 'Support time, and owners who give up when asked to approve.', min: 0, max: 5, step: 0.05, show: (n) => `$${n.toFixed(2)}`, flip: (n, more) => `a step-up costs you ${more ? 'more' : 'less'} than ${n}` },
  { key: 'holdThousandDay', label: 'Holding $1,000 for a day costs you', help: "A store's cash waiting on a hold. Think of what that money would earn, or what the store would pay to get it sooner.", min: 0, max: 20, step: 0.1, show: (n) => `$${n.toFixed(2)}`, flip: (n, more) => `holding $1,000 for a day costs you ${more ? 'more' : 'less'} than ${n}` },
];

/** Names the checkout knows, so the rulebook chosen here is the rulebook a call can ask for. */
const AT_CHECKOUT: Record<string, string> = {
  open: 'open-safeguards', simple: 'simple-safeguards', fortress: 'fortress-safeguards', tuned: 'tuned-safeguards', expert: 'expert-safeguards',
  frozen: 'frozen-v4', frozen_v3: 'frozen-v3', frozen_v2: 'frozen-v2', frozen_v1: 'frozen-v1-safeguards',
};
const CI_COMMAND = 'npx tsx scripts/regress.ts regressions --agent "python3 my_agent.py" --report=agent-report.md';
const EMPTY_BOX_LIMIT = 'Approximation: held-out empty-box theft replaces standard-day sleeper theft. Delivered value, holding, step-ups and honest access remain from the standard days; these are not one complete measured scenario.';
const LEFT_OUT = 'Cost of goods, ordinary payment fees, operating costs and any loss of trust not included in your prices.';

/**
 * The standard days have no store that ships empty boxes, so a price on those days alone would hide that risk. With it on,
 * each arm's sleeper theft is swapped for what the held-out run measured. An arm the run left out is dropped, not guessed.
 */
const emptyBox = round?.heldOut.find((h) => h.label === 'Empty box');
const withEmptyBoxes = arms.flatMap((a) => {
  const raw = round?.arms.find((x) => x.key === a.key), held = emptyBox?.arms.find((x) => x.name === a.name);
  return raw && held ? [{ ...a, stolen: a.stolen - raw.sleeper.stolen.mean + held.stolen.mean }] : [];
});

function download(name: string, value: unknown) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** The decision the lab exists for. The measurements are ours and simulated; the prices are the developer's. */
export function Worth() {
  const open = useStore((s) => s.showWorth);
  const close = () => useStore.setState({ showWorth: false });
  const panel = useModal<HTMLDivElement>(open, close);
  const [p, setP] = useState<Prices>(DEFAULT_PRICES);
  const [boxes, setBoxes] = useState(false);
  const [copied, setCopied] = useState<'checkout' | 'ci' | null>(null);
  const set = boxes ? withEmptyBoxes : arms;
  const ranked = useMemo(() => rankDefenses(set, p), [set, p]);
  if (!open || !round) return null;
  const top = ranked[0], next = ranked[1];
  const qualified = ranked.filter((r) => !r.out);
  const flips = next && !next.out ? KNOBS.flatMap((k) => {
    const x = breakEven(top.arm, next.arm, k.key, p);
    if (x === null || x < k.min) return [];
    const more = priceDefense(next.arm, { ...p, [k.key]: x * 2 }).net > priceDefense(top.arm, { ...p, [k.key]: x * 2 }).net;
    return [`${arms.find((a) => a.key === next.arm.key)?.label ?? next.arm.name} wins if ${k.flip(k.show(x), more)}.`];
  }) : [];
  const chosen = qualified.length ? arms.find((a) => a.key === top.arm.key) : undefined;
  const reason = chosen ? `${chosen.label} meets your ${(p.minAccess * 100).toFixed(2)}% honest-access floor and has the highest value after your priced costs among ${qualified.length} qualifying rulebooks: ${money(top.net)} per simulated day.` : '';
  const decision = chosen ? {
    schema: 'sandbox-city/decision@1',
    selected: { key: chosen.key, name: chosen.name, label: chosen.label, policyHash: chosen.policyId },
    prices: p, accessFloor: p.minAccess,
    scenario: { key: boxes ? 'empty-box-approximation' : 'standard', approximation: boxes, assumption: boxes ? EMPTY_BOX_LIMIT : 'All columns come from the same standard simulated days.' },
    evidence: { version: round.version, evaluator: round.frozen.evaluator, evaluatorSource: round.evaluatorSource, benchmarkPolicyHash: round.frozen.policyId, testDays: round.protocol.testDays },
    result: { perDay: { delivered: top.delivered, theftCost: top.theft, stepUpCost: top.friction, holdingCost: top.holding, net: top.net }, honestAccess: top.arm.access },
    reason, costsLeftOut: LEFT_OUT, rules: chosen.rules,
  } : null;
  const evidence = () => { close(); useStore.setState({ showEvidence: true }); setTimeout(() => document.getElementById('ev-checkout')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'instant' : 'smooth' }), 500); };
  const apply = () => { if (!chosen) return; client.start([chosen.rules]); close(); setTimeout(() => client.send({ cmd: 'play' }), 300); };
  const checkout = chosen ? `curl -sS http://localhost:8787/api/checkout \\\n  -H 'content-type: application/json' \\\n  --data '${JSON.stringify({ key: `worth-${chosen.key}-example`, rulebook: AT_CHECKOUT[chosen.key], owner: { category: 'home', qty: 1, address: '12 Neon St, Silk Row', budget: 100 }, listedUnit: 80, args: { items: [{ name: 'Lamp', quantity: 1, itemCost: 80, itemTotal: 80 }], shippingAddress: { address_line_1: '12 Neon St', admin_area_2: 'Silk Row' } } })}'` : '';
  const copy = async (value: string, kind: 'checkout' | 'ci') => { await navigator.clipboard.writeText(value); setCopied(kind); setTimeout(() => setCopied(null), 1500); };

  return createPortal(
    <div className="report-wrap" onClick={close}>
      <div className="report panel hijack worth" ref={panel} tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Is it worth it?">
        <div className="report-head">
          <span className="glyph ev-glyph">$</span>
          <div>
            <h2>IS IT WORTH IT?</h2>
            <p>Every defense costs something. These are {round.protocol.testDays} simulated days, the same for every rulebook, and all of them carry the same four safeguards. The results are measured here. The prices are yours, and they decide the answer.</p>
          </div>
          <button className="btn dialog-close" aria-label="Close Is it worth it?" onClick={close}>CLOSE ×</button>
        </div>
        <div className="worth-grid">
          <section className="worth-prices" aria-label="Your prices">
            <h3 className="simple-h"><i>1</i>Your prices</h3>
            {KNOBS.map((k) => (
              <div key={k.key} className="worth-knob">
                <span>{k.label} <b>{k.show(p[k.key])}</b></span>
                <div className="worth-inputs">
                  <input type="range" aria-label={k.label} min={k.min} max={k.max} step={k.step} value={Math.max(k.min, Math.min(k.max, p[k.key]))} onChange={(e) => setP({ ...p, [k.key]: Number(e.target.value) })} />
                  <input type="number" aria-label={`${k.label} (number)`} min={k.min} step="any" value={p[k.key]} onChange={(e) => { const n = e.currentTarget.valueAsNumber; if (Number.isFinite(n) && n >= k.min) setP({ ...p, [k.key]: n }); }} />
                </div>
                <small>{k.help}</small>
              </div>
            ))}
            <div className="worth-knob">
              <span>Honest purchases you must accept <b>{(p.minAccess * 100).toFixed(0)}%</b></span>
              <div className="worth-inputs">
                <input type="range" aria-label="Honest purchases you must accept" min={0} max={1} step={0.01} value={p.minAccess} onChange={(e) => setP({ ...p, minAccess: Number(e.target.value) })} />
                <input type="number" aria-label="Honest purchases you must accept (percent)" min={0} max={100} step="any" value={Number((p.minAccess * 100).toPrecision(12))} onChange={(e) => { const n = e.currentTarget.valueAsNumber; if (Number.isFinite(n) && n >= 0 && n <= 100) setP({ ...p, minAccess: n / 100 }); }} />
              </div>
              <small>A defense below this is out, whatever it saves.</small>
            </div>
            <label className="worth-check">
              <input type="checkbox" checked={boxes} onChange={(e) => setBoxes(e.target.checked)} />
              <span><b>Stores on my platform could ship empty boxes</b><small>Estimate this risk using held-out theft. Other measurements stay from standard days.</small></span>
            </label>
            <button className="simple-link" onClick={() => { setP(DEFAULT_PRICES); setBoxes(false); }}>Reset my prices</button>
          </section>
          <section aria-label="Your answer">
            <h3 className="simple-h"><i>2</i>Your answer</h3>
            {boxes && <p className="worth-assumption" role="status"><b>EMPTY-BOX APPROXIMATION</b> {EMPTY_BOX_LIMIT}</p>}
            {chosen ? (
              <div className="worth-answer">
                <label>At your prices, use</label>
                <b>{chosen.label}</b>
                <code>Policy {chosen.policyId}</code>
                <span>{money(top.net)} a day after the costs you priced</span>
              </div>
            ) : <div className="worth-answer"><label>No rulebook here accepts that many honest purchases.</label><span>Lower the floor to compare them.</span></div>}
            {flips.length > 0 && <ul className="worth-flips">{flips.map((f) => <li key={f}>{f}</li>)}</ul>}
            {chosen && <p className="at-p">{reason}</p>}
            <p className="at-p">Delivered value less theft, step-up and holding costs at your prices. Left out: {LEFT_OUT}</p>
            <div className="worth-table" role="region" aria-label="Every rulebook, priced" tabIndex={0}>
              <table>
                <thead><tr><th>Rulebook</th><th>Delivered</th><th>Theft</th><th>Step-ups</th><th>Holding</th><th>Worth / day</th></tr></thead>
                <tbody>
                  {ranked.map((r, i) => (
                    <tr key={r.arm.key} className={r.out ? 'out' : i === 0 ? 'top' : ''}>
                      <th>{arms.find((a) => a.key === r.arm.key)?.label ?? r.arm.name}<code className="policy-hash">{arms.find((a) => a.key === r.arm.key)?.policyId}</code>{r.out && <small> {(r.arm.access * 100).toFixed(1)}% accepted</small>}</th>
                      <td>{money(r.delivered)}</td><td>-{money(r.theft)}</td><td>-{money(r.friction)}</td><td>-{money(r.holding)}</td><td><b>{r.out ? 'out' : money(r.net)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <h3 className="simple-h"><i>3</i>Take it with you</h3>
        <div className="at-row">
          <button className="btn" disabled={!chosen} onClick={apply}>APPLY TO CITY</button>
          <button className="btn" disabled={!chosen} onClick={() => chosen && download(`rulebook-${chosen.key}.json`, chosen.rules)}>DOWNLOAD THIS RULEBOOK</button>
          <button className="btn" disabled={!decision} onClick={() => decision && download(`decision-${decision.selected.key}.json`, decision)}>EXPORT THE WHOLE DECISION</button>
          <button className="btn" onClick={evidence}>SEE A RULEBOOK AT THE CHECKOUT</button>
        </div>
        <p className="at-p">Simulated days, and prices you chose: this ranks these rulebooks in this world. It does not predict your fraud rate. The rulebook is the JSON the gate reads. {chosen && AT_CHECKOUT[chosen.key] ? <>At the checkout, ask for <code>"rulebook": "{AT_CHECKOUT[chosen.key]}"</code>. </> : null}<code>docs/CHECKOUT.md</code> shows the call.</p>
        {chosen && <>
          <h4>Use these rules at your local checkout</h4>
          <p className="at-p">Start your local server, then send this example order. Its response names the policy hash and says whether it paid, held or refused the order.</p>
          <pre className="at-json">{checkout}</pre>
          <div className="at-row"><button className="btn" onClick={() => void copy(checkout, 'checkout')}>{copied === 'checkout' ? 'COPIED' : 'COPY CHECKOUT COMMAND'}</button></div>
        </>}
        <h4>Check your agent before release</h4>
        <p className="at-p">Replace the example command with your agent. This runs every portable case, including honest controls, and writes the release verdict.</p>
        <pre className="at-json">{CI_COMMAND}</pre>
        <div className="at-row"><button className="btn" onClick={() => void copy(CI_COMMAND, 'ci')}>{copied === 'ci' ? 'COPIED' : 'COPY CI COMMAND'}</button></div>
      </div>
    </div>,
    document.body,
  );
}
