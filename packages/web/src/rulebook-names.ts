/**
 * The names a visitor reads. The docs, data files and benchmark keep the original names, and a policy hash never
 * includes a name (policyId in packages/core/src/policy.ts), so this changes only what the screen says.
 */
export const PLAIN: Record<string, string> = {
  'Wild West': 'No checks',
  'Passport Theater': 'Agent ID only',
  'Know Your Agent': 'Agent checks',
  Fortress: 'Strictest',
  Balanced: 'Balanced',
  'Lab-Tuned': 'Auto-tuned',
  'Hand-written': 'Expert rules',
  'Simple limits': 'Simple limits',
  'Frozen v1': 'First pick (v1)',
  'Frozen v2': 'Second pick (v2)',
  'Frozen v3': 'Strict hold (v3)',
  // picked by a decision rule written before round four ran
  'Frozen v4': 'Recommended (v4)',
};

/** "Lab-Tuned + safeguards*" reads "Auto-tuned + safeguards*", "Lab-Tuned, sleeper" reads "Auto-tuned, sleeper". Unknown names are kept. */
export function plainName(name: string): string {
  for (const [k, v] of Object.entries(PLAIN)) if (name === k || (name.startsWith(k) && /^(,| \+|\*)/.test(name.slice(k.length)))) return v + name.slice(k.length);
  return name;
}

/** One line that ties the screen's names to the names in the docs and data. */
export const NAME_KEY = Object.entries(PLAIN).filter(([k, v]) => k !== v).map(([k, v]) => `${v} = ${k}`).join(' · ');
