import { useState } from 'react';
import { useStore } from '../store';
import { director } from '../sim/director';
import { useModal } from './useModal';

const KEY = 'sandbox-city:welcomed';
const seen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const remember = () => { try { localStorage.setItem(KEY, '1'); } catch { /* storage blocked: show again next time */ } };

/** First visit only, and never over a deep link: what this is, and the two ways in. */
export function Welcome() {
  const cinema = useStore((s) => s.cinema.on);
  const [open, setOpen] = useState(() => !seen() && !location.search && !location.hash);
  const explore = () => { remember(); setOpen(false); };
  const panel = useModal<HTMLDivElement>(open && !cinema, explore);
  if (!open || cinema) return null;
  const film = () => {
    remember(); setOpen(false);
    useStore.setState((s) => ({ cinema: { ...s.cinema, on: true } }));
    setTimeout(() => director.roll(1), 200);
  };
  const hijack = () => { explore(); useStore.setState({ showHijack: true }); };
  return (
    <div className="report-wrap welcome-wrap" onClick={explore}>
      <div className="welcome panel" ref={panel} tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Welcome to Sandbox City">
        <div className="wl-prompt"><span>root@sandbox-city:~$</span> ./intro</div>
        <h2>SANDBOX CITY</h2>
        <p className="wl-lede">A crash-test lab for AI commerce. Try every payment rule before a single real cent moves.</p>
        <ol className="wl-steps">
          <li><b>A whole city trades for one day.</b> AI shoppers, stores and six crews of attackers, every payment on PayPal rails.</li>
          <li><b>You set the rules at the gate.</b> Passports, signatures, spend caps, escrow, idempotency keys.</li>
          <li><b>The lab keeps score.</b> Fraud stopped, honest buyers let through, and net value, on the same day every time.</li>
        </ol>
        <button className="wl-hijack" onClick={hijack}>
          <span className="wl-tag">RECORDED ON THE PAYPAL SANDBOX</span>
          <b>A real model was talked into shipping 8 units to an attacker's PO Box.</b>
          <span>Wild West paid it. Lab-Tuned and Know Your Agent refused the call before PayPal saw it. The audit refunded it through PayPal's Agent Toolkit. See the hijack →</span>
        </button>
        <div className="wl-actions">
          <button className="btn hot" onClick={film}>▶ WATCH THE FILM <small>about 9 min · Esc to stop</small></button>
          <button className="btn" onClick={explore}>EXPLORE THE LAB</button>
        </div>
        <p className="wl-keys">Keys: <kbd>C</kbd> cinema · <kbd>R</kbd> roll the film · <kbd>1</kbd>–<kbd>5</kbd> jump to an act · <kbd>H</kbd> the hijack</p>
      </div>
    </div>
  );
}
