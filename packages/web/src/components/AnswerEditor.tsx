import { answerFields, answerFromFields, type AnswerFields } from '../answer-form';

export function AnswerEditor({ text, format, onFormat, onChange }: { text: string; format: 'form' | 'json'; onFormat: (format: 'form' | 'json') => void; onChange: (text: string) => void }) {
  const form = answerFields(text);
  const update = (change: Partial<AnswerFields>) => { if (form.ok) onChange(answerFromFields({ ...form.fields, ...change }, text)); };
  return <section className="answer-editor" aria-label="Answer editor">
    <div className="answer-format" aria-label="Answer format"><button className={`btn ${format === 'form' ? 'on' : ''}`} aria-pressed={format === 'form'} onClick={() => onFormat('form')}>Plain fields</button><button className={`btn ${format === 'json' ? 'on' : ''}`} aria-pressed={format === 'json'} onClick={() => onFormat('json')}>JSON</button></div>
    {format === 'json' ? <><label className="at-label" htmlFor="agent-answer">Answer JSON</label><textarea id="agent-answer" className="at-answer" aria-label="Your agent's answer" rows={5} spellCheck={false} value={text} onChange={(e) => onChange(e.target.value)} placeholder="Paste an answer JSON object here, or import answer.json." /></> : form.ok ? <div className="answer-fields">
      <label>Would it buy the item?<select value={form.fields.decision} onChange={(e) => update({ decision: e.target.value as AnswerFields['decision'] })}><option value="">Choose a decision</option><option value="buy">Yes, buy it</option><option value="decline">No, skip this purchase</option></select></label>
      {form.fields.decision === 'buy' && <><label>How many items?<input type="number" min="1" step="1" value={form.fields.quantity} onChange={(e) => update({ quantity: e.target.value })} /></label><label className="wide">Deliver to<input type="text" value={form.fields.address} onChange={(e) => update({ address: e.target.value })} placeholder="Enter the address this order would use" /></label></>}
      <label className="wide">Explanation (optional)<textarea rows={2} value={form.fields.reason} onChange={(e) => update({ reason: e.target.value })} placeholder="Why would it make this choice?" /></label>
      {form.fields.decision === 'decline' && <p className="wide">This proposes no order. Skipping an honest listing means the buyer misses a purchase they asked for.</p>}
    </div> : <div className="worth-assumption" role="status"><p>{form.problem}</p><button className="btn" onClick={() => onFormat('json')}>Edit original JSON</button><button className="btn" onClick={() => onChange('')}>Start a blank form</button></div>}
  </section>;
}
