import { describe, expect, it } from 'vitest';
import { policyId, PRESETS } from '@sandbox-city/core';
import { NAME_KEY, plainName } from '../src/rulebook-names';

describe('plain rulebook names', () => {
  it('renames what a visitor reads and keeps the suffixes', () => {
    expect(plainName('Wild West')).toBe('No checks');
    expect(plainName('Lab-Tuned + safeguards')).toBe('Auto-tuned + safeguards');
    expect(plainName('Frozen v4 + safeguards*')).toBe('Recommended (v4) + safeguards*');
    expect(plainName('Lab-Tuned, sleeper')).toBe('Auto-tuned, sleeper');
    expect(plainName('Frozen v3, honest store')).toBe('Strict hold (v3), honest store');
  });

  it("keeps a name it does not know, such as a visitor's own", () => {
    expect(plainName('My rules*')).toBe('My rules*');
  });

  it('cannot change a policy hash: names are not part of it', () => {
    for (const p of Object.values(PRESETS)) expect(policyId({ ...p, name: plainName(p.name) })).toBe(policyId(p));
  });

  it('every renamed rulebook is in the key that ties the screen to the docs', () => {
    for (const k of ['Wild West', 'Lab-Tuned', 'Know Your Agent', 'Frozen v4']) expect(NAME_KEY).toContain(`= ${k}`);
  });
});
