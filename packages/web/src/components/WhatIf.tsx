import type { DaySummary } from '@sandbox-city/core';
import { useStore } from '../store';
import { LANE_NAMES, money } from './meta';

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;

function verdict(me: DaySummary, alts: DaySummary[]): string {
  if (!alts.length) return '';
  const best = [...alts].sort((a, b) => b.net - a.net)[0];
  const safest = [...alts].sort((a, b) => a.stolen - b.stolen)[0];
  const lost = (x: DaySummary) => x.stolen + x.duplicate;
  if (best.net > me.net) {
    return `Switching to ${best.name} would have kept ${money(best.net - me.net)} more value: ${money(Math.max(0, lost(me) - lost(best)))} less lost to fraud and double charges, ${best.honestLost > me.honestLost ? `at the cost of ${money(best.honestLost - me.honestLost)} more honest sales turned away` : `and ${money(me.honestLost - best.honestLost)} fewer honest sales turned away`}.`;
  }
  if (safest.stolen < me.stolen) {
    return `No preset beats your rules on net value. ${safest.name} would have stopped ${money(me.stolen - safest.stolen)} more fraud, but turned away ${money(Math.max(0, safest.honestLost - me.honestLost))} more honest sales.`;
  }
  return 'Your rules beat every preset on this day, on both fraud stopped and net value.';
}

/** Same city, same attackers, same day — only the rulebook changes. */
export function WhatIf() {
  const w = useStore((s) => s.whatif);
  if (!w) return null;
  if (w === 'pending') return <div className="whatif"><div className="whatif-head"><b>WHAT IF</b><em>もしも</em><span>replaying this exact day under every other rulebook…</span></div><div className="whatif-loading"><i /></div></div>;
  const me = w.mine[0];
  const rows = [...w.mine.map((m, i) => ({ ...m, mine: true, label: w.mine.length > 1 ? `${LANE_NAMES[i]} · ${m.name}` : `${m.name} (yours)` })), ...[...w.alternatives].sort((a, b) => b.net - a.net).map((a) => ({ ...a, mine: false, label: a.name }))];
  const bestNet = Math.max(...rows.map((r) => r.net));
  return (
    <div className="whatif">
      <div className="whatif-head"><b>WHAT IF</b><em>もしも</em><span>same city, same shoppers, same attackers — only the rules change</span></div>
      <table>
        <thead><tr><th>Rulebook</th><th>Stolen</th><th>Double charges</th><th>Honest sales lost</th><th>Net value</th><th>vs {w.mine.length > 1 ? 'lane A' : 'yours'}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={`${r.mine ? 'mine' : ''} ${r.net === bestNet ? 'best' : ''}`}>
              <td>{r.label}{r.net === bestNet && <i className="crown">BEST</i>}</td>
              <td className="bad">{money(r.stolen)}</td>
              <td className={r.duplicate ? 'warn' : 'dim'}>{money(r.duplicate)}</td>
              <td className={r.honestLost ? 'warn' : 'dim'}>{money(r.honestLost)}</td>
              <td><b>{money(r.net)}</b></td>
              <td className={r.key === me.key ? 'dim' : r.net >= me.net ? 'good' : 'bad'}>{r.key === me.key ? '—' : signed(r.net - me.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="whatif-verdict">{verdict(me, w.alternatives)}</p>
    </div>
  );
}
