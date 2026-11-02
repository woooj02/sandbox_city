/**
 * Live lab server. Runs the same SimRunner the browser uses, but lane 0 can move money on the
 * real PayPal sandbox (hero shoppers plus a sampled share of the city). Everything that touched
 * PayPal is reconcilable afterwards against Transaction Search.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SimRunner, round2, type FromSim, type SimEvent, type ToSim } from '@sandbox-city/core';
import { SandboxRails, type CallLog } from './paypal';

export interface ServerOptions {
  /** Builds fresh rails per run (new runId), or null when PayPal isn't configured. */
  rails?: () => SandboxRails | null;
  liveSample?: number;
  staticDir?: string;
  logger?: boolean;
}

/** What the sim says moved on the sandbox lane, summed the same way the twin ledger is. */
export interface LiveLedger { runId: string; startedAt: number; captured: number; refunded: number; orders: number; refunds: number; captureIds: Set<string> }

export function sandboxMoves(ledger: LiveLedger, events: SimEvent[]) {
  for (const e of events) {
    if (e.type === 'order' && e.rail === 'sandbox' && !e.escrow && e.charges > 0) {
      ledger.captured = round2(ledger.captured + e.amount * e.charges);
      ledger.orders++;
      if (e.paypal?.captureId) ledger.captureIds.add(e.paypal.captureId);
    } else if (e.type === 'capture' && e.rail === 'sandbox') {
      ledger.captured = round2(ledger.captured + e.amount);
    } else if (e.type === 'refund' && e.rail === 'sandbox' && e.approved) {
      ledger.refunded = round2(ledger.refunded + e.amount);
      ledger.refunds++;
    }
  }
}

export async function buildServer(opts: ServerOptions = {}): Promise<FastifyInstance & { runs: Map<string, { ledger: LiveLedger; rails: SandboxRails }> }> {
  const app = Fastify({ logger: opts.logger ?? false }) as unknown as FastifyInstance & { runs: Map<string, { ledger: LiveLedger; rails: SandboxRails }> };
  const makeRails = opts.rails ?? (() => SandboxRails.fromEnv());
  const runs = new Map<string, { ledger: LiveLedger; rails: SandboxRails }>();
  app.decorate('runs', runs);
  const recentCalls: CallLog[] = [];

  await app.register(websocket);

  app.get('/api/health', async () => {
    const probe = makeRails();
    return { ok: true, paypal: probe ? 'sandbox' : 'twin', runs: runs.size };
  });

  app.get('/api/calls', async () => ({ calls: recentCalls.slice(-200) }));

  app.get('/api/runs', async () => ({
    runs: [...runs.values()].map(({ ledger }) => ({ runId: ledger.runId, startedAt: ledger.startedAt, captured: ledger.captured, refunded: ledger.refunded, orders: ledger.orders, refunds: ledger.refunds })),
  }));

  /**
   * Three-way check of the sandbox lane:
   *  1. sim:      what the harm ledger says moved (including duplicate and ghost charges)
   *  2. observed: every capture/refund PayPal returned to the adapter, deduplicated by PayPal id
   *  3. paypal:   each of those read back from PayPal by id, so it reflects PayPal's own books now
   * Transaction Search is reported as a bonus when the app has it enabled (it can lag by hours).
   */
  app.get<{ Params: { runId: string } }>('/api/reconcile/:runId', async (req, reply) => {
    const run = runs.get(req.params.runId);
    if (!run) return reply.code(404).send({ error: 'unknown run' });
    const { ledger, rails } = run;
    const sim = { captured: ledger.captured, refunded: ledger.refunded, net: round2(ledger.captured - ledger.refunded), orders: ledger.orders, refunds: ledger.refunds };
    const observed = rails.observed();
    const checks = await Promise.all([...rails.moves.values()].map(async (m) => ({ m, got: await rails.getPayment(m.kind, m.id).catch(() => null) })));
    let captured = 0, refunded = 0;
    const missing: string[] = [];
    for (const { m, got } of checks) {
      if (!got || (m.kind === 'refund' && got.status !== 'COMPLETED')) { missing.push(m.id); continue; }
      if (m.kind === 'capture') captured += got.amount; else refunded += got.amount;
    }
    const paypal = { captured: round2(captured), refunded: round2(refunded), net: round2(captured - refunded), transactions: checks.length - missing.length, missing };
    let search: { available: boolean; net?: number; transactions?: number; reason?: string };
    try {
      const txns = (await rails.searchTransactions(new Date(ledger.startedAt - 60_000), new Date(Date.now() + 60_000))).filter((t) => t.transaction_info.custom_field?.startsWith(`${ledger.runId}:`));
      const net = txns.reduce((s2, t) => s2 + Number(t.transaction_info.transaction_amount.value), 0);
      search = { available: true, net: round2(net), transactions: txns.length };
    } catch (e) {
      search = { available: false, reason: (e as Error).message };
    }
    const delta = round2(sim.net - paypal.net);
    return { runId: ledger.runId, sim, observed, paypal, search, delta, matched: delta === 0 && observed.net === paypal.net && missing.length === 0 };
  });

  app.get('/ws', { websocket: true }, (socket) => {
    let current: { ledger: LiveLedger; rails: SandboxRails } | null = null;
    const send = (m: FromSim) => { if (socket.readyState === 1) socket.send(JSON.stringify(m)); };
    const post = (m: FromSim) => {
      if (m.type === 'tick' && current) sandboxMoves(current.ledger, m.events);
      send(m);
    };
    const runner = new SimRunner(post, {
      mode: 'server', crypto: 'ed25519', liveSample: opts.liveSample ?? 0.02,
      liveRails: () => {
        const rails = makeRails();
        if (!rails) { current = null; return undefined; }
        const ledger: LiveLedger = { runId: rails.runId, startedAt: Date.now(), captured: 0, refunded: 0, orders: 0, refunds: 0, captureIds: new Set() };
        current = { ledger, rails };
        runs.set(rails.runId, current);
        rails.onCall = (c) => {
          recentCalls.push(c);
          if (recentCalls.length > 1000) recentCalls.splice(0, recentCalls.length - 1000);
          send({ type: 'paypal_call', lane: 0, method: c.method, path: c.path.split('?')[0], status: c.status, ms: c.ms, debugId: c.debugId, requestId: c.requestId });
        };
        return rails;
      },
    });
    socket.on('message', (raw: Buffer) => {
      let msg: ToSim;
      try { msg = JSON.parse(raw.toString()) as ToSim; } catch { return send({ type: 'error', message: 'bad message' }); }
      runner.handle(msg);
      if (msg.cmd === 'init' && current) send({ type: 'run', runId: current.ledger.runId });
    });
    socket.on('close', () => runner.stop());
  });

  const here = dirname(fileURLToPath(import.meta.url));
  const staticDir = opts.staticDir ?? resolve(here, '../../web/dist');
  if (existsSync(staticDir)) {
    await app.register(fastifyStatic, { root: staticDir });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html')));
  }
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8787);
  buildServer({ logger: true, liveSample: Number(process.env.LIVE_SAMPLE ?? 0.02) }).then(async (app) => {
    await app.listen({ port, host: '0.0.0.0' });
    console.log(SandboxRails.fromEnv() ? 'PayPal sandbox: configured' : 'PayPal sandbox: not configured (twin only)');
  });
}
