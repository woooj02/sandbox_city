import { World, DEFAULT_CONFIG, PRESETS, ATTACK_KINDS } from '../packages/core/src/index';
const crypto = (process.argv[2] as any) ?? 'modeled';
for (const [key, policy] of Object.entries(PRESETS)) {
  const t0 = performance.now();
  const w = new World({ ...DEFAULT_CONFIG, crypto, policy });
  const m = await w.run();
  const ms = performance.now() - t0;
  const byKind = ATTACK_KINDS.map((k) => `${k.slice(0, 6)}:${m.fraud.byKind[k].leaked.toFixed(0)}/${m.fraud.byKind[k].attempted.toFixed(0)}`).join(' ');
  console.log(`${policy.name.padEnd(16)} safety ${(m.safety * 100).toFixed(1)}%  access ${(m.access * 100).toFixed(1)}%  net $${m.netValue.toFixed(0)}  gmv $${m.honest.gmv.toFixed(0)} leaked $${m.fraud.leaked.toFixed(0)} dup $${m.chaos.duplicateValue} orders ${m.orders} blocked ${m.honest.blocked} aband ${m.honest.abandoned} | ${byKind} | ${ms.toFixed(0)}ms`);
  if (key === 'open') console.log('  reconcile', w.reconcile(), 'refunds', m.refunds);
}
