/**
 * Search for a rulebook that keeps the most value for honest people, then check it on unseen days.
 *   npx tsx scripts/tune.ts [generations] [children] [minSafety 0..1]
 */
import { searchRulebook, describePolicy } from '../packages/core/src/index';

const gens = Number(process.argv[2] ?? 8), kids = Number(process.argv[3] ?? 10), minSafety = Number(process.argv[4] ?? 0);
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const t0 = Date.now();

const res = await searchRulebook({
  trainSeeds: ['train-1', 'train-2', 'train-3'],
  testSeeds: ['neo-osaka-7', 'test-a', 'test-b', 'test-c', 'test-d'],
  generations: gens, children: kids, minAccess: 0.85, minSafety, label: minSafety ? `Tuned ≥${Math.round(minSafety * 100)}% safe` : 'Tuned',
}, (e) => {
  if (e.type === 'generation') console.log(`gen ${e.generation}: best net ${money(e.best.mean.net)} · safety ${pct(e.best.mean.safety)} · access ${pct(e.best.mean.access)}`);
});

console.log(`\n${res.evals} rulebooks tried in ${((Date.now() - t0) / 1000).toFixed(0)}s\nTuned rulebook:\n  - ${describePolicy(res.best.policy).join('\n  - ')}\n`);
console.log('Held-out days (never seen during search), mean per day:');
console.log('rulebook'.padEnd(18), 'net'.padStart(10), 'stolen'.padStart(9), 'dup'.padStart(7), 'honest lost'.padStart(12), 'safety'.padStart(8), 'access'.padStart(8), '| train net');
for (const t of res.tested.sort((a, b) => b.test.net - a.test.net)) {
  const d = t.test;
  console.log(t.name.padEnd(18), money(d.net).padStart(10), money(d.stolen).padStart(9), money(d.duplicate).padStart(7), money(d.honestLost).padStart(12), pct(d.safety).padStart(8), pct(d.access).padStart(8), '|', money(t.train.net));
}
console.log('\nJSON', JSON.stringify(res.best.policy));
