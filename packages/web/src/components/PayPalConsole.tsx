import { useStore } from '../store';

/** Raw PayPal REST traffic from the live lane: method, path, status, latency, debug id. */
export function PayPalConsole() {
  const live = useStore((s) => s.paypal === 'sandbox');
  const calls = useStore((s) => s.paypalCalls);
  if (!live) return null;
  return (
    <div className="ppc">
      <div className="panel-title"><span>PAYPAL WIRE</span><em>/paypal/api</em></div>
      <ul>
        {calls.slice(0, 4).map((c) => (
          <li key={c.id} className={c.status >= 500 ? 'err' : c.status >= 400 ? 'warn' : 'ok'}>
            <b>{c.status}</b>
            <span className="m">{c.method}</span>
            <span className="p">{c.path.replace(/\/v2\/(checkout|payments)\//, '').replace(/[A-Z0-9]{17}/g, '…')}</span>
            <span className="ms">{c.ms}ms</span>
            {c.debugId && <code title="paypal-debug-id">{c.debugId.slice(0, 13)}</code>}
          </li>
        ))}
        {!calls.length && <li className="idle">waiting for the first live payment…</li>}
      </ul>
    </div>
  );
}
