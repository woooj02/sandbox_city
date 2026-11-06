import { useShallow } from 'zustand/react/shallow';
import type { Experiment } from '../workflow';
import { useStore } from '../store';
import { policyId } from '@sandbox-city/core';
declare const __BUILD__: string;
export function Scope({ experiment, title }: { experiment?: Experiment | null; title?: string }) {
  return <aside className="scope-banner" aria-label="Experiment scope">
    <b>{title ?? (experiment?.source === 'recorded-benchmark' ? 'Recorded benchmark · terminal outcomes' : experiment?.source === 'recorded-proof' ? 'Recorded payment proof' : 'Local answer check · one case')}</b>
    {experiment && <><span>{experiment.paymentMode} · {experiment.scenario.id} · {experiment.phase}</span>
      <details><summary>Input and provenance</summary><p>Experiment {experiment.id} · {experiment.inputRef} · {experiment.seedOrDataset} · version {experiment.scenario.version}{experiment.candidatePolicyHash ? ` · policy ${experiment.candidatePolicyHash}` : ''}</p></details></>}
    <small>Build {typeof __BUILD__ === 'undefined' ? 'local development' : __BUILD__}</small>
  </aside>;
}
export function CityScope() {
  const s = useStore(useShallow((s) => ({ seed: s.seed, shoppers: s.lanes[0]?.world?.shoppers.length ?? 600, settled: s.lanes[0]?.metrics?.settled, done: s.lanes[0]?.done, running: s.running, paypal: s.paypal, policy: s.policies[0] })));
  return <Scope title={`Current city · ${s.seed} · ${s.shoppers} shoppers · ${s.paypal === 'sandbox' ? 'PayPal sandbox sample + simulator' : 'simulator'} · ${s.settled ? 'settled' : s.running ? 'running, provisional' : s.done ? 'trading ended, lifecycle not settled' : 'paused, provisional'} · policy ${policyId(s.policy)}`} />;
}
