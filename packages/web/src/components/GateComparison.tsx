import { gateOutcome } from '../authority';
import { CaseReceipt, CaseSummary } from './CaseReceipt';
import type { AgentResult, SavedGate } from '../workflow';

export function GateComparison({ observation, comparison }: { observation: AgentResult; comparison: SavedGate }) {
  const open = gateOutcome(comparison.open.result), protectedGate = gateOutcome(comparison.result);
  const honest = gateOutcome(comparison.honest.protected);
  const harmful = !observation.result.pass && !observation.result.invalid;
  return <section className="gate-comparison" aria-label="Same answer, different gates">
    <h2>Same answer. Different gates.</h2>
    <p className="observation-id">Case <code>{observation.case.id}</code> · comparison <code>{comparison.id}</code> · {comparison.checkedAt}</p>
    <CaseSummary observation={observation} />
    <div className="comparison-cards">
      <article className={harmful && open === 'ALLOW' ? 'bad' : ''}><h3>1 · Open gate</h3><strong>{open}{harmful && open === 'ALLOW' ? ' · harmful order' : ''}</strong><p>{open === 'ALLOW' ? 'The proposed order passes these rules.' : 'The proposed order does not proceed freely.'}</p><code>{comparison.open.name} · {comparison.open.hash}</code></article>
      <article className={protectedGate === 'REFUSE' && harmful ? 'good' : ''}><h3>2 · Selected gate</h3><strong>{protectedGate}{harmful && protectedGate === 'REFUSE' ? ' · harmful order stopped' : ''}</strong><p>{comparison.result.kind === 'evaluated' ? comparison.result.verdict.reason ?? 'Within these rules.' : 'The agent proposed no valid order.'}</p><code>{comparison.name} · {comparison.hash}</code></article>
      <article className={honest === 'ALLOW' || honest === 'HOLD' ? 'good' : 'bad'}><h3>3 · Ordinary purchase</h3><strong>{honest === 'ALLOW' ? 'ALLOW · honest purchase' : honest === 'HOLD' ? 'HOLD · honest purchase' : `${honest} · honest purchase`}</strong><p>An honest listing under the same rules. Open: {gateOutcome(comparison.honest.open)} → selected: {honest}. {honest === 'HOLD' ? 'Accepted with a hold; delivery and payment are not executed here.' : ''}</p><code>{comparison.honest.case.id}</code></article>
    </div>
    <p>First two columns use exactly the selected answer and case. The third uses the named honest listing and a scripted owner-compliant answer under both gates. These are local checkout evaluations; no model or payment runs.</p>
    <CaseReceipt observation={observation} comparison={comparison} />
  </section>;
}
