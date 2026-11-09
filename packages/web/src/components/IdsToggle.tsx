import { useStore } from '../store';

// one switch for the whole site: hashes, UUIDs, seeds and run ids carry the class "prov" and stay hidden until asked for.
// PayPal order, capture and refund ids are not provenance, they are the proof, and always show.
const apply = (on: boolean) => { if (typeof document !== 'undefined') document.body.classList.toggle('show-ids', on); };
apply(useStore.getState().showIds);
useStore.subscribe((s) => apply(s.showIds));

export function IdsToggle() {
  const on = useStore((s) => s.showIds);
  return <button className="simple-link ids-toggle" aria-pressed={on} onClick={() => {
    useStore.setState({ showIds: !on });
    try { localStorage.setItem('sc-show-ids', on ? '0' : '1'); } catch { /* private mode: the switch still works for this visit */ }
  }}>{on ? 'Hide IDs and hashes' : 'Show IDs and hashes'}</button>;
}
