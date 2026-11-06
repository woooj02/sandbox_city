import { useMemo, useState } from 'react';
import { DEFAULT_PRICES, nextWinner, policyId, rankDefenses, type DefenseArm, type Policy, type PriceKnob, type Prices } from '@sandbox-city/core';
import { useStore } from '../store';
import { client } from '../sim/client';
import { prefersReducedMotion } from '../sim/motion';
import { Scope } from './Scope';
import { money } from './meta';
import raw from '../data/evidence.json';

interface Arm { key: string; name: string; label: string; policyId: string; rules: Policy; exact?: { access: number }; fulfilled: { mean: number }; stolen: { mean: number }; access: { mean: number }; heldDollarHours: { mean: number }; challengedPer100: number; ordersPerDay: number }
const round = (raw as unknown as { fourth: { version: string; evaluatorSource: string; frozen: { evaluator: string; policyId: string }; arms: Arm[]; protocol: { testDays: number }; heldOut: { label: string; arms: { name: string; scenario?: Pick<DefenseArm, 'fulfilled' | 'stolen' | 'access' | 'heldDollarHours' | 'stepUps'> }[] }[] } | null }).fourth;

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
const EMPTY_BOX_DAYS = 'Every column comes from the same held-out days, with empty-box stores in them. The rulebooks were not retuned for this.';
const LEFT_OUT = 'Cost of goods, ordinary payment fees, operating costs and any loss of trust not included in your prices.';

/**
 * The standard days have no store that ships empty boxes, so a price on those days alone would hide that risk. With it on,
 * every number comes from the held-out days that do have them. An arm that run left out is dropped, not guessed.
 */
const emptyBox = round?.heldOut.find((h) => h.label === 'Empty box');
const withEmptyBoxes = arms.flatMap((a) => {
  const held = emptyBox?.arms.find((x) => x.name === a.name)?.scenario;
  return held ? [{ ...a, ...held }] : [];
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
  const state = useStore();
  const p = state.costDraft.prices, boxes = state.costDraft.boxes;
  const setP = (prices: Prices) => useStore.setState({ costDraft: { prices, boxes } });
  const setBoxes = (boxes: boolean) => useStore.setState({ costDraft: { prices: p, boxes } });
  const [copied, setCopied] = useState<'checkout' | 'ci' | null>(null);
  const set = boxes ? withEmptyBoxes : arms;
  const ranked = useMemo(() => rankDefenses(set, p), [set, p]);
  if (!round) return null;
  const top = ranked[0];
  const qualified = ranked.filter((r) => !r.out);
  const flips = KNOBS.flatMap((k) => {
    const flip = nextWinner(ranked, k.key, p, k.min);
    return flip ? [`${arms.find((a) => a.key === flip.arm.key)?.label ?? flip.arm.name} wins if ${k.flip(k.show(flip.price), flip.price > p[k.key])}.`] : [];
  });
  const chosen = qualified.length ? arms.find((a) => a.key === top.arm.key) : undefined;
  const reason = chosen ? `${chosen.label} meets your ${(p.minAccess * 100).toFixed(2)}% honest-access floor and has the highest value after your priced costs among ${qualified.length} qualifying rulebooks: ${money(top.net)} per simulated day.` : '';
  const decision = chosen ? {
    schema: 'sandbox-city/decision@1',
    experiment: { ...state.experiment!, task: 'policy-cost' as const, phase: 'complete' as const, source: 'recorded-benchmark' as const, paymentMode: 'simulated' as const, scenario: { id: boxes ? 'empty-box' : 'standard', version: 'benchmark-v4' }, candidatePolicyHash: chosen.policyId, prices: { ...p } },
    selected: { key: chosen.key, name: chosen.name, label: chosen.label, policyHash: chosen.policyId },
    prices: p, accessFloor: p.minAccess,
    scenario: { key: boxes ? 'empty-box' : 'standard', assumption: boxes ? EMPTY_BOX_DAYS : 'All columns come from the same standard simulated days.' },
    evidence: { version: round.version, evaluator: round.frozen.evaluator, evaluatorSource: round.evaluatorSource, benchmarkPolicyHash: round.frozen.policyId, testDays: round.protocol.testDays },
    result: { perDay: { delivered: top.delivered, theftCost: top.theft, stepUpCost: top.friction, holdingCost: top.holding, net: top.net }, honestAccess: top.arm.access },
    reason, costsLeftOut: LEFT_OUT, rules: chosen.rules,
  } : null;
  const evidence = () => { if (decision) useStore.setState({ savedDecision: decision, decisionHistory: [...state.decisionHistory, decision], experiment: decision.experiment, experiments: { ...state.experiments, 'policy-cost': decision.experiment } }); useStore.setState({ showEvidence: true }); setTimeout(() => document.getElementById('ev-checkout')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'instant' : 'smooth' }), 500); };
  const keep = () => { if (decision) useStore.setState({ savedDecision: decision, decisionHistory: [...state.decisionHistory, decision], experiment: decision.experiment, experiments: { ...state.experiments, 'policy-cost': decision.experiment } }); };
  const apply = () => { if (!chosen) return; keep(); client.send({ cmd: 'pause' }); client.start([chosen.rules]); state.selectTask('city'); };
  const checkout = chosen ? `curl -sS http://localhost:8787/api/checkout \\\n  -H 'content-type: application/json' \\\n  --data '${JSON.stringify({ key: `worth-${chosen.key}-example`, rulebook: AT_CHECKOUT[chosen.key], owner: { category: 'home', qty: 1, address: '12 Neon St, Silk Row', budget: 100 }, listedUnit: 80, args: { items: [{ name: 'Lamp', quantity: 1, itemCost: 80, itemTotal: 80 }], shippingAddress: { address_line_1: '12 Neon St', admin_area_2: 'Silk Row' } } })}'` : '';
  const copy = async (value: string, kind: 'checkout' | 'ci') => { await navigator.clipboard.writeText(value); setCopied(kind); setTimeout(() => setCopied(null), 1500); };

  return (
      <section className="task-panel worth" aria-label="Defense cost workspace">
        <div className="report-head">
          <span className="glyph ev-glyph">$</span>
          <div>
            <h1>Which payment defense is worth using?</h1>
            <p>Every defense costs something. These are {round.protocol.testDays} simulated days, the same for every rulebook, and all of them carry the same four safeguards. The results are measured here. The prices are yours, and they decide the answer.</p>
          </div>

        </div>
        <Scope experiment={decision?.experiment ?? state.experiment} title={`${boxes ? 'Recorded empty-box days' : 'Recorded standard world'} · ${round.protocol.testDays} simulated days · identical safeguards · terminal outcomes`} />
        <p><b>Reprice recorded results.</b> Prices change the arithmetic instantly; they do not rerun agents or the benchmark.</p>
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
              <span><b>Stores on my platform could ship empty boxes</b><small>The standard days do not include this attack. Tick it to use the days that do.</small></span>
            </label>
            <button className="simple-link" onClick={() => { useStore.setState({ costDraft: { prices: DEFAULT_PRICES, boxes: false } }); }}>Reset my prices</button>
          </section>
          <section aria-label="Your answer">
            <h3 className="simple-h"><i>2</i>Your answer</h3>
            {boxes && <p className="worth-assumption" role="status"><b>EMPTY-BOX DAYS</b> {EMPTY_BOX_DAYS}</p>}
            {chosen ? (
              <div className="worth-answer">
                <label>At your prices, use</label>
                <b>{chosen.key === 'frozen_v3' ? 'Wait through the complaint window' : chosen.key === 'frozen' ? 'Release earlier with an exposure limit' : chosen.label}</b><span>{chosen.label}</span>
                <code>Policy {chosen.policyId}</code>
                <span>{money(top.net)} a day after the costs you priced</span>
              </div>
            ) : <div className="worth-answer"><label>No rulebook here accepts that many honest purchases.</label><span>Lower the floor to compare them.</span></div>}
            {chosen && <p>Honest purchases accepted: {(top.arm.access * 100).toFixed(2)}% · held capital: {top.arm.heldDollarHours.toLocaleString('en-US')} dollar-hours/day.</p>}
            {!boxes && <p>v4 leads v3 by about $443/day at principal-only theft cost (paired 95% interval $233–$647). v3 stops about $878/day more theft. These intervals describe the recorded default comparison, not arbitrary repriced objectives.</p>}
            {!boxes && <p className="worth-assumption">Held-out failure: empty-box sellers took $2,953/day under v4 and $48 under v3. Standard days omit this attack. Tick empty boxes under Your prices to price the days that include it.</p>}
            {chosen && <p className="cost-equation">{money(top.delivered)} delivered and paid − {money(top.theft)} theft − {money(top.friction)} step-ups − {money(top.holding)} holding = {money(top.net)} / day</p>}
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
          <button className="btn" disabled={!chosen} onClick={apply}>Explore these rules in a new city</button>
          <button className="btn" disabled={!decision} onClick={keep}>Keep this decision</button>
          <button className="btn" disabled={!chosen} onClick={() => chosen && download(`rulebook-${chosen.key}.json`, chosen.rules)}>DOWNLOAD THIS RULEBOOK</button>
          <button className="btn" disabled={!decision} onClick={() => { keep(); if (decision) download(`decision-${decision.selected.key}.json`, decision); }}>EXPORT THE WHOLE DECISION</button>
          <button className="btn" onClick={evidence}>SEE A RULEBOOK AT THE CHECKOUT</button>
        </div>
        <p className="scope-banner">Exploring carries over the policy only. The new default city has a different population and seed; it does not replay these benchmark days or create empty-box sellers. Your decision stays pinned beside it. The new city starts paused.</p>
        {state.savedDecision && <p>Kept decision: {state.savedDecision.selected.label} · {state.savedDecision.experiment?.id} · {state.savedDecision.scenario.key}. Export or keep again to replace this saved snapshot.</p>}
        <p className="at-p">Simulated days, and prices you chose: this ranks these rulebooks in this world. It does not predict your fraud rate. The rulebook is the JSON the gate reads. {chosen && AT_CHECKOUT[chosen.key] ? <>At the checkout, ask for <code>"rulebook": "{AT_CHECKOUT[chosen.key]}"</code>. </> : null}<code>docs/CHECKOUT.md</code> shows the call.</p>
        {chosen && <>
          <h4>Use these rules at your local checkout</h4>
          <p className="at-p">Start your local server, then send this example order. Its response names the policy hash and says whether it paid, held or refused the order.</p>
          <pre className="at-json">{checkout}</pre>
          <div className="at-row"><button className="btn" onClick={() => void copy(checkout, 'checkout')}>{copied === 'checkout' ? 'COPIED' : 'COPY CHECKOUT COMMAND'}</button></div>
        </>}
        {state.decisionHistory.length > 0 && <details><summary>Kept decision history ({state.decisionHistory.length})</summary><ul>{state.decisionHistory.map((d, i) => <li key={i}><b>{d.selected.label}</b> · {d.scenario.key} · theft price ${d.prices.stolenDollar.toFixed(2)} · {d.reason}<button className="simple-link" onClick={() => useStore.setState({ costDraft: { prices: { ...d.prices }, boxes: d.scenario.key === 'empty-box' } })}>Reprice with these saved inputs</button></li>)}</ul><p>Saved snapshots stay unchanged when you edit the current prices.</p></details>}
        <h4>Check your agent before release</h4>
        <p className="at-p">Replace the example command with your agent. This runs every portable case, including honest controls, and writes the release verdict.</p>
        <pre className="at-json">{CI_COMMAND}</pre>
        <div className="at-row"><button className="btn" onClick={() => void copy(CI_COMMAND, 'ci')}>{copied === 'ci' ? 'COPIED' : 'COPY CI COMMAND'}</button></div>
      </section>
  );
}
