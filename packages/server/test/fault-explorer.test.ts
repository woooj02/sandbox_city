import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { explore, exploreNaive, runSchedule, WORKLOADS } from '../src/fault-explorer';
import { MUTANTS } from '../src/fault-mutants';

// thousands of synced journals: memory-backed where the system has it, because the sync is not what is under test
const dir = mkdtempSync(join(existsSync('/dev/shm') ? '/dev/shm' : tmpdir(), 'sc-faults-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const workload = (name: string) => WORKLOADS.find((w) => w.name === name)!;

describe('every fault schedule up to two faults', () => {
  for (const w of WORKLOADS) it(`keeps every promise: ${w.name}`, async () => {
    const r = await explore(w, 2, dir);
    expect(r.firstViolation).toBeUndefined();
    expect(r.schedules).toBeGreaterThan(200);
  });
});

describe('the checker can fail', () => {
  for (const m of MUTANTS) it(`finds the planted bug: ${m.name}`, async () => {
    const r = await explore(workload(m.workload), 2, dir, { Worker: m.Worker, Journal: m.Journal, stopAtFirst: true });
    expect(r.violating, r.firstViolation?.violations.join('; ')).toBe(1);
  });

  it('a client with no journal charges more than once under the same faults', async () => {
    const r = await exploreNaive(2);
    expect(r.doubled).toBeGreaterThan(0);
    expect(r.worst).toBeGreaterThan(1);
  });
});

describe('what the explorer found', () => {
  it('a refund that lands while the capture answer is in flight stays refunded', async () => {
    const w = workload('pay, then refund mid-flight');
    // the capture webhook arrives, the dashboard refunds, the refund webhook arrives, and only then the capture answers
    const script = new Map<number, number>();
    for (const site of ['webhook@capture:after', 'dashboard:refund', 'webhook@capture:after']) {
      const { schedule } = await runSchedule(w, script, dir);
      const after = Math.max(-1, ...script.keys());
      script.set(schedule.trace.findIndex((c, i) => i > after && c.site === site), 1);
    }
    const r = await runSchedule(w, script, dir);
    expect(r.schedule.faults()).toEqual(['webhook@capture:after=deliver', 'dashboard:refund=now', 'webhook@capture:after=deliver']);
    expect(r.violations).toEqual([]);
    expect(r.final).toBe('refunded');
  });

  it('a read that lags behind the journal is asked again, not escalated to a person', async () => {
    const r = await explore(workload('hold, then release'), 2, dir);
    expect(r.unresolved).toBe(0);
  });
});
