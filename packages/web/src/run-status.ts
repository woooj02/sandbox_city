/** The city starts at 06:00. Its day counter must advance when the clock passes midnight. */
export function runClock(t: number, done = false) {
  const elapsed = Math.max(0, Math.floor(t)) + 360;
  const day = Math.floor(elapsed / 1440) + 1;
  const time = `${String(Math.floor(elapsed / 60) % 24).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  return `${done ? 'COMPLETE · ' : ''}DAY ${day} · ${time}`;
}

export function waitingMetrics(ready: boolean, running: boolean) {
  return !ready ? { title: 'Preparing city…', detail: 'Loading the simulation.' }
    : running ? { title: 'Collecting measurements…', detail: 'Metrics appear as orders are processed.' }
    : { title: 'Ready to run', detail: 'Press RUN to start the city and collect metrics.' };
}
