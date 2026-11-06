import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { breakEven, DEFAULT_PRICES, priceDefense, rankDefenses, type DefenseArm, type Policy, type PriceKnob, type Prices } from '@sandbox-city/core';
import { useStore } from '../store';
import { useModal } from './useModal';
import { money } from './meta';
import raw from '../data/evidence.json';

interface Arm { key: string; name: string; rules: Policy; exact?: { access: number }; fulfilled: { mean: number }; stolen: { mean: number }; access: { mean: number }; heldDollarHours: { mean: number }; challengedPer100: number; ordersPerDay: number; sleeper: { stolen: { mean: number } } }
const round = (raw as unknown as { fourth: { arms: Arm[]; protocol: { testDays: number }; heldOut: { label: string; arms: { name: string; stolen: { mean: number } }[] }[] } | null }).fourth;

const arms: (DefenseArm & { rules: Policy })[] = (round?.arms ?? []).map((a) => ({
  key: a.key, name: a.name, rules: a.rules, fulfilled: a.fulfilled.mean, stolen: a.stolen.mean, access: a.exact?.access ?? a.access.mean,
  heldDollarHours: a.heldDollarHours.mean, stepUps: (a.challengedPer100 / 100) * a.ordersPerDay,
}));

const KNOBS: { key: PriceKnob; label: string; help: string; min: number; max: number; step: number; show: (n: number) => string; flip: (n: string, more: boolean) => string }[] = [
  { key: 'stolenDollar', label: 'One stolen dollar costs you', help: '$1 is the dollar alone. More counts fees, disputes and lost trust.', min: 1, max: 5, step: 0.05, show: (n) => `$${n.toFixed(2)}`, flip: (n, more) => `a stolen dollar costs you ${more ? 'more' : 'less'} than ${n}` },
  { key: 'stepUp', label: 'One step-up costs you', help: 'Support time, and owners who give up when asked to approve.', min: 0, max: 5, step: 0.05, show: (n) => `$${n.toFixed(2)}`, flip: (n, more) => `a step-up costs you ${more ? 'more' : 'less'} than ${n}` },
  { key: 'holdThousandDay', label: 'Holding $1,000 for a day costs you', help: "A store's cash waiting on a hold. Think of what that money would earn, or what the store would pay to get it sooner.", min: 0, max: 20, step: 0.1, show: (n) => `$${n.toFixed(2)}`, flip: (n, more) => `holding $1,000 for a day costs you ${more ? 'more' : 'less'} than ${n}` },
];

/** Names the checkout knows, so the rulebook chosen here is the rulebook a call can ask for. */
const AT_CHECKOUT: Record<string, string> = { frozen: 'frozen-v4', frozen_v3: 'frozen-v3', frozen_v2: 'frozen-v2', frozen_v1: 'frozen-v1-safeguards' };

/**
 * The standard days have no store that ships empty boxes, so a price on those days alone would hide that risk. With it on,
 * each arm's sleeper theft is swapped for what the held-out run measured. An arm the run left out is dropped, not guessed.
 */
const emptyBox = round?.heldOut.find((h) => h.label === 'Empty box');
const withEmptyBoxes = arms.flatMap((a) => {
  const raw = round?.arms.find((x) => x.key === a.key), held = emptyBox?.arms.find((x) => x.name === a.name);
  return raw && held ? [{ ...a, stolen: a.stolen - raw.sleeper.stolen.mean + held.stolen.mean }] : [];
});

function download(a: DefenseArm & { rules: Policy }) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(a.rules, null, 2)], { type: 'application/json' }));
  link.download = `rulebook-${a.key}.json`;
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
  const set = boxes ? withEmptyBoxes : arms;
  const ranked = useMemo(() => rankDefenses(set, p), [set, p]);
  if (!open || !round) return null;
  const top = ranked[0], next = ranked[1];
  const qualified = ranked.filter((r) => !r.out);
  const flips = next && !next.out ? KNOBS.flatMap((k) => {
    const x = breakEven(top.arm, next.arm, k.key, p);
    if (x === null) return [];
    const more = priceDefense(next.arm, { ...p, [k.key]: x * 2 }).net > priceDefense(top.arm, { ...p, [k.key]: x * 2 }).net;
    return [`${next.arm.name} wins if ${k.flip(k.show(x), more)}.`];
  }) : [];
  const chosen = arms.find((a) => a.key === top.arm.key)!;
  const evidence = () => { close(); useStore.setState({ showEvidence: true }); setTimeout(() => document.getElementById('ev-checkout')?.scrollIntoView({ behavior: 'smooth' }), 500); };

  return createPortal(
    <div className="report-wrap" onClick={close}>
      <div className="report panel hijack worth" ref={panel} tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Is it worth it?">
        <div className="report-head">
          <span className="glyph ev-glyph">$</span>
          <div>
            <h2>IS IT WORTH IT?</h2>
            <p>Every defense costs something. These are {round.protocol.testDays} simulated days, the same for every rulebook, and all of them carry the same four safeguards. The results are measured here. The prices are yours, and they decide the answer.</p>
          </div>
        </div>
        <div className="worth-grid">
          <section className="worth-prices" aria-label="Your prices">
            <h3 className="simple-h"><i>1</i>Your prices</h3>
            {KNOBS.map((k) => (
              <label key={k.key} className="worth-knob">
                <span>{k.label} <b>{k.show(p[k.key])}</b></span>
                <input type="range" min={k.min} max={k.max} step={k.step} value={p[k.key]} onChange={(e) => setP({ ...p, [k.key]: Number(e.target.value) })} />
                <small>{k.help}</small>
              </label>
            ))}
            <label className="worth-knob">
              <span>Honest purchases you must accept <b>{(p.minAccess * 100).toFixed(0)}%</b></span>
              <input type="range" min={0.8} max={1} step={0.01} value={p.minAccess} onChange={(e) => setP({ ...p, minAccess: Number(e.target.value) })} />
              <small>A defense below this is out, whatever it saves.</small>
            </label>
            <label className="worth-check">
              <input type="checkbox" checked={boxes} onChange={(e) => setBoxes(e.target.checked)} />
              <span><b>Stores on my platform could ship empty boxes</b><small>The standard days do not include this attack. Tick it to add what the held-out run measured for each rulebook.</small></span>
            </label>
            <button className="simple-link" onClick={() => { setP(DEFAULT_PRICES); setBoxes(false); }}>Reset my prices</button>
          </section>
          <section aria-label="Your answer">
            <h3 className="simple-h"><i>2</i>Your answer</h3>
            {qualified.length ? (
              <div className="worth-answer">
                <label>At your prices, use</label>
                <b>{top.arm.name}</b>
                <span>{money(top.net)} a day after every cost</span>
              </div>
            ) : <div className="worth-answer"><label>No rulebook here accepts that many honest purchases.</label><span>Lower the floor to compare them.</span></div>}
            {flips.length > 0 && <ul className="worth-flips">{flips.map((f) => <li key={f}>{f}</li>)}</ul>}
            <div className="worth-table" role="region" aria-label="Every rulebook, priced" tabIndex={0}>
              <table>
                <thead><tr><th>Rulebook</th><th>Delivered</th><th>Theft</th><th>Step-ups</th><th>Holding</th><th>Worth / day</th></tr></thead>
                <tbody>
                  {ranked.map((r, i) => (
                    <tr key={r.arm.key} className={r.out ? 'out' : i === 0 ? 'top' : ''}>
                      <th>{r.arm.name}{r.out && <small> {(r.arm.access * 100).toFixed(1)}% accepted</small>}</th>
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
          <button className="btn" disabled={!qualified.length} onClick={() => download(chosen)}>DOWNLOAD THIS RULEBOOK</button>
          <button className="btn" onClick={evidence}>SEE A RULEBOOK AT THE CHECKOUT</button>
        </div>
        <p className="at-p">Simulated days, and prices you chose: this ranks these rulebooks in this world. It does not predict your fraud rate. The rulebook is the JSON the gate reads. {AT_CHECKOUT[chosen.key] ? <>At the checkout, ask for <code>"rulebook": "{AT_CHECKOUT[chosen.key]}"</code>. </> : null}<code>docs/CHECKOUT.md</code> shows the call.</p>
      </div>
    </div>,
    document.body,
  );
}
