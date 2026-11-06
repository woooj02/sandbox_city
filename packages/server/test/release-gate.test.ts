import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { agentVerdict } from '@sandbox-city/core';

const root = resolve(import.meta.dirname, '../../..');
const scratch = mkdtempSync(join(tmpdir(), 'release-gate-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function run(...args: string[]) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/regress.ts', ...args, '--json'], {
    cwd: root, encoding: 'utf8', timeout: 30000, env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
  });
  expect(result.error).toBeUndefined();
  return { status: result.status, data: JSON.parse(result.stdout) };
}
const careful = 'python3 examples/agents/careful.py';
const cases = (file: string) => join('regressions', file);

describe('the release CLI requires evidence', () => {
  it.each([{ args: ['--kind=agnet'] }, { args: ['--kind', 'agnet'] }])('rejects a misspelled kind ($args)', ({ args }) => {
    const r = run(...args);
    expect(r.status).toBe(1);
    expect(r.data.blocked).toBe(true);
  });

  it('blocks an empty folder and writes the reason to a report', () => {
    const report = join(scratch, 'empty-report.md');
    const r = run(scratch, '--report', report);
    expect(r.status).toBe(1);
    expect(r.data.problems.join(' ')).toContain('No cases were executed');
    expect(readFileSync(report, 'utf8')).toContain('BLOCK THIS RELEASE');
  });

  it('blocks agent cases without a runner', () => {
    const r = run('--kind=agent');
    expect(r.status).toBe(1);
    expect(r.data.verdict.verdict).toBe('block');
    expect(r.data.problems.join(' ')).toContain('need --agent');
    expect(run(cases('agent-honest-listing-1.json')).status).toBe(1);
  });

  it.each(['agent-honest-listing-1.json', 'agent-injection-style-1.json'])('blocks incomplete agent coverage in %s', (file) => {
    const r = run(cases(file), '--agent', careful);
    expect(r.status).toBe(1);
    expect(r.data.verdict.why).toContain('both attack and honest-control');
  });

  it('passes day and gate cases without an agent', () => {
    const folder = mkdtempSync(join(scratch, 'local-'));
    for (const f of ['day-empty-box.json', 'gate-hidden-tax.json']) copyFileSync(join(root, cases(f)), join(folder, f));
    const r = run(folder);
    expect(r.status).toBe(0);
    expect(r.data.results).toHaveLength(2);
    expect(r.data.blocked).toBe(false);
  });

  it('passes a complete careful-agent run with separated flag values', () => {
    const r = run('--kind', 'agent', '--timeout', '5', '--agent', careful);
    expect(r.status).toBe(0);
    expect(r.data.verdict.verdict).toBe('pass');
    expect(r.data.verdict.attacks).toBeGreaterThan(0);
    expect(r.data.verdict.cleanTotal).toBeGreaterThan(0);
  });

  it('blocks an agent runner selected for a folder containing no agent cases', () => {
    expect(run(cases('gate-hidden-tax.json'), '--agent', careful).status).toBe(1);
  });

  it.each(['', '0', '-1', 'NaN', 'Infinity'])('rejects a timeout of %s', (value) => {
    expect(run(`--timeout=${value}`).status).toBe(1);
  });
});

describe('coverage is required even for callers outside the CLI', () => {
  it.each([
    { rows: [] },
    { rows: [{ id: 'attack', pass: true, violations: [] }] },
    { rows: [{ id: 'honest', control: true, pass: true, violations: [] }] },
  ])('blocks incomplete rows ($rows)', ({ rows }) => {
    expect(agentVerdict(rows).verdict).toBe('block');
  });
});
