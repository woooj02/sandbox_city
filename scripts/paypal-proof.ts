/**
 * Plays one Lab-Tuned day against a running lab server (npm run server), with lane A on the PayPal sandbox,
 * then reads every payment back from PayPal and writes the receipt the twin shows in its report.
 *   npx tsx scripts/paypal-proof.ts [ws://localhost:8787/ws]
 */
import { writeFileSync } from 'node:fs';
import { PRESETS, type FromSim, type SimEvent } from '../packages/core/src/index.ts';

const url = process.argv[2] ?? 'ws://localhost:8787/ws';
const http = url.replace(/^ws/, 'http').replace(/\/ws$/, '');
const seed = 'neo-osaka-7';
const ws = new WebSocket(url);
let runId = '';
const captures: { id: string; amount: number }[] = [];
const debugIds: string[] = [];

ws.onopen = () => {
  ws.send(JSON.stringify({ cmd: 'init', seed, lanes: [{ policy: PRESETS.tuned }], chaos: 0.04, liveSample: 0 }));
  ws.send(JSON.stringify({ cmd: 'speed', tps: 2400 }));
  ws.send(JSON.stringify({ cmd: 'play' }));
};
ws.onmessage = async (ev) => {
  const m = JSON.parse(String(ev.data)) as FromSim;
  if (m.type === 'run') runId = m.runId;
  if (m.type === 'error') console.error('server:', m.message);
  if (m.type === 'paypal_call' && m.debugId && debugIds.length < 5) debugIds.push(m.debugId);
  if (m.type === 'tick') for (const e of m.events as SimEvent[]) {
    if (e.type === 'order' && e.rail === 'sandbox' && e.paypal?.captureId) captures.push({ id: e.paypal.captureId, amount: e.amount });
  }
  if (m.type === 'done') {
    const r = await (await fetch(`${http}/api/reconcile/${runId}`)).json();
    const proof = {
      at: new Date().toISOString(), seed, rulebook: PRESETS.tuned.name, runId,
      orders: r.sim.orders, refunds: r.sim.refunds, net: r.paypal.net, simNet: r.sim.net,
      readBack: r.paypal.transactions, matched: r.matched,
      sampleCaptures: captures.slice(0, 4).map((c) => c.id), debugIds: debugIds.slice(0, 3),
    };
    writeFileSync('packages/web/src/data/paypal-proof.json', JSON.stringify(proof, null, 2) + '\n');
    console.log(JSON.stringify({ ...proof, sampleCaptures: proof.sampleCaptures.length, debugIds: proof.debugIds.length }));
    ws.close(); process.exit(r.matched ? 0 : 1);
  }
};
