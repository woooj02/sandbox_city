import { describe, expect, it } from 'vitest';
import { runClock, waitingMetrics } from '../src/run-status';

describe('city readiness and completion', () => {
  it('distinguishes waiting for RUN from initializing and collecting measurements', () => {
    expect(waitingMetrics(false, false).title).toBe('Preparing city…');
    expect(waitingMetrics(true, false)).toEqual({ title: 'Ready to run', detail: 'Press RUN to start the city and collect metrics.' });
    expect(waitingMetrics(true, true).title).toBe('Collecting measurements…');
  });
  it('advances the date instead of displaying the initial clock at the end of a day', () => {
    expect(runClock(0)).toBe('DAY 1 · 06:00');
    expect(runClock(1079)).toBe('DAY 1 · 23:59');
    expect(runClock(1080)).toBe('DAY 2 · 00:00');
    expect(runClock(1440, true)).toBe('COMPLETE · DAY 2 · 06:00');
    expect(runClock(1439, true)).toBe('COMPLETE · DAY 2 · 05:59');
  });
});
