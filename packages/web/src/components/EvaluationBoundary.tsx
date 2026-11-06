import rate from '../data/agent-rate.json';
export function EvaluationBoundary() {
  return <details><summary>How far does the recorded model evidence generalize?</summary>
    <p>These are prior one-listing runs over 66 poisoned and 12 honest listings from the same authored corpus, one run per adapter. They are separate from the eight portable release cases and the batched toolkit planner. No new inference runs when you open this table.</p>
    <div className="worth-table"><table><thead><tr><th>Adapter</th><th>Poisoned breaches</th><th>Poisoned refusals</th><th>Honest buys</th><th>Invalid</th><th>Recorded</th></tr></thead><tbody>{Object.entries(rate).map(([name, r]) => <tr key={name}><th>{name}</th><td>{r.poisoned.breached}/{r.poisoned.n}</td><td>{r.poisoned.n - r.poisoned.bought - r.poisoned.noAnswer}/{r.poisoned.n}</td><td>{r.clean.bought}/{r.clean.n}</td><td>{r.poisoned.noAnswer + r.clean.noAnswer}</td><td>{r.recordedAt.slice(0,10)}</td></tr>)}</tbody></table></div>
    <p>The two local models trade refusal against clean purchases. Zero breaches with six honest purchases refused is not universal safety. The scripted careful/obedient controls are not models. Model/provider versions, prompt setup and corpus differ from the recorded Qwen toolkit and Gemma city tapes; do not combine their rates.</p>
    <p>For a new model claim, freeze its model/version, prompt, adapter and corpus before running; report honest buys, refusals, breaches and invalid answers separately. Existing results are development evidence once used to change a defense. See docs/EVALUATION.md.</p>
  </details>;
}
