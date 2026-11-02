import { useEffect } from 'react';
import { useStore } from '../store';
import { money } from './meta';

export function CutIns() {
  const cut = useStore((s) => s.cutins[0]);
  const pop = useStore((s) => s.popCutIn);
  const multi = useStore((s) => s.lanes.length > 1);
  const card = useStore((s) => s.cinema.card !== null);
  useEffect(() => {
    if (!cut) return;
    const t = setTimeout(pop, 2500);
    return () => clearTimeout(t);
  }, [cut?.id]);
  if (!cut || card) return null;
  return (
    <div className={`cutin k-${cut.kind} ${multi ? `onlane-${cut.lane}` : ''}`} key={cut.id}>
      <div className="impact" />
      <div className="band">
        <div className="speedlines" />
        <div className="scanbars" />
        <div className="tag-bg">{cut.tag}</div>
        <div className="content">
          <div className="title-row">
            <span className="title">{cut.title}</span>
            {cut.amount !== undefined && <span className="amount">{money(cut.amount)}</span>}
          </div>
          {cut.who && <div className="who">{cut.who}</div>}
          <div className="line">{cut.line}</div>
          {cut.sub && <div className="sub">{cut.sub}</div>}
        </div>
        <div className="stamp"><small>{/^\d+$/.test(cut.code) ? 'HTTP' : 'SIG'}</small>{cut.code}</div>
      </div>
    </div>
  );
}
