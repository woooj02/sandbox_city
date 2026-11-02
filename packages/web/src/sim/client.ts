import { ATTACK_LABEL, Policy, PRESETS, SimEvent } from '@sandbox-city/core';
import { bus } from './bus';
import type { FromSim, ToSim, WorldSnapshot } from '@sandbox-city/core';
import { resetLanes, useStore } from '../store';

const worlds: WorldSnapshot[] = [];
const names = (lane: number) => {
  const w = worlds[lane];
  const map = new Map<string, string>();
  if (!w) return map;
  for (const m of w.merchants) map.set(m.id, m.name);
  for (const s of w.shoppers) map.set(s.id, s.name);
  for (const a of w.attackers) map.set(a.id, a.name);
  return map;
};
const nameCache: Map<string, string>[] = [];
const nm = (lane: number, id?: string) => (id ? nameCache[lane]?.get(id) ?? id : '');
const ATTACK_CODE: Record<string, string> = { prompt_injection: 'INJ', fake_store: 'FAKE', refund_abuse: 'RFND', card_testing: 'CARD', impersonation: 'SPOOF', fraud_ring: 'RING' };
const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const RULE_LABEL: Record<string, string> = {
  requirePassport: 'passport check', verifySignatures: 'signature check', enforceMandate: 'owner mandate', shipLock: 'ship-to lock',
  velocity: 'velocity limit', newAgentCap: 'new-agent cap', merchantRepMin: 'store reputation', verifiedMerchantsOnly: 'verified stores',
  ringDetection: 'ring detector', refundRatioCap: 'refund ratio cap', refundTrackingCheck: 'tracking check',
};
const ruleName = (r?: string) => (r ? RULE_LABEL[r] ?? r : 'the gate');

let lastCut = 0;
const seenAttackers = new Set<string>();

let feedBudget = 0, feedClock = 0;
let traceBudget = 0, traceClock = 0;
function narrate(lane: number, events: SimEvent[], focusLane: number) {
  const st = useStore.getState();
  const feed: (Parameters<typeof st.pushFeed>[0][number] & { p?: number })[] = [];
  const now = performance.now();
  const canCut = lane === focusLane && now - lastCut > 2600 && st.cutins.length < 2;
  let best: { score: number; c: Parameters<typeof st.pushCutIn>[0] } | null = null;
  const consider = (score: number, c: Parameters<typeof st.pushCutIn>[0]) => { if (!best || score > best.score) best = { score, c }; };
  // the gate's own decisions, printed like a terminal: every attack line, plus a sample of honest traffic
  const trace: Parameters<typeof st.pushTrace>[0] = [];
  let allow: Parameters<typeof st.pushTrace>[0][number] | null = null;
  const cash = (n: number) => `$${n.toFixed(2)}`.padStart(8);

  for (const e of events) {
    switch (e.type) {
      case 'inject':
        feed.push({ t: e.t, lane, tone: 'attack', text: `${nm(lane, e.attacker)} planted agent instructions in a listing at ${nm(lane, e.merchant)}` });
        trace.push({ t: e.t, lane, verdict: 'INJECT', text: `${nm(lane, e.attacker)} → ${nm(lane, e.merchant)}`, note: 'listing poisoned' });
        if (!seenAttackers.has(`${lane}:${e.attacker}`)) { seenAttackers.add(`${lane}:${e.attacker}`); consider(5, { kind: 'attack', lane, tag: 'INTRUSION DETECTED', code: 'INJ', title: 'PROMPT INJECTION', who: nm(lane, e.attacker), line: `“${e.text.slice(0, 90)}${e.text.length > 90 ? '…' : ''}”`, sub: `hidden in a listing at ${nm(lane, e.merchant)}` }); }
        break;
      case 'attack':
        feed.push({ t: e.t, lane, tone: 'attack', text: `${nm(lane, e.attacker)} — ${e.note}` });
        consider(4, { kind: 'attack', lane, tag: 'INTRUSION DETECTED', code: ATTACK_CODE[e.kind], title: ATTACK_LABEL[e.kind].toUpperCase(), who: nm(lane, e.attacker), line: e.note });
        break;
      case 'store_open':
        if (!e.honest) feed.push({ t: e.t, lane, tone: 'attack', text: `A new store “${e.name}” opened in the city` });
        break;
      case 'hijack':
        if (e.sanitized) feed.push({ t: e.t, lane, tone: 'good', text: `Injection filter quarantined a poisoned listing before ${nm(lane, e.shopper)} read it` });
        else if (!e.resisted) feed.push({ t: e.t, lane, tone: 'bad', text: `${nm(lane, e.shopper)} obeyed hidden instructions at ${nm(lane, e.merchant)}` });
        break;
      case 'chaos':
        if (!e.recovered) feed.push({ t: e.t, lane, tone: 'warn', text: `PayPal call failed 4× for ${e.order}: ${e.fault}` });
        break;
      case 'order': {
        const tr = e.truth;
        const firstRule = e.hits.find((h) => h.action === e.decision)?.rule;
        const who = tr.malicious ? nm(lane, tr.attacker ?? e.buyer) : nm(lane, e.buyer);
        const path = `${cash(tr.malicious && tr.harm > 0 ? tr.harm : e.amount)}  ${who} → ${nm(lane, e.merchant)}`;
        if (e.duplicateCharge) trace.push({ t: e.t, lane, verdict: 'DUP×2', text: path, note: 'no PayPal-Request-Id' });
        else if (tr.malicious && e.outcome === 'completed') trace.push({ t: e.t, lane, verdict: 'GRANT', text: path, note: ATTACK_CODE[tr.attack!] });
        else if (tr.malicious && (e.outcome === 'blocked' || e.outcome === 'abandoned')) trace.push({ t: e.t, lane, verdict: 'DENY', text: path, note: ruleName(firstRule) });
        else if (e.outcome === 'escrowed') trace.push({ t: e.t, lane, verdict: 'HOLD', text: path, note: 'escrow' });
        else if (!tr.malicious && e.outcome === 'blocked') trace.push({ t: e.t, lane, verdict: 'FALSE+', text: path, note: ruleName(firstRule) });
        else if (e.outcome === 'completed') allow = { t: e.t, lane, verdict: 'ALLOW', text: path, note: 'captured' };
        if (e.duplicateCharge) {
          feed.push({ t: e.t, lane, tone: 'bad', text: `Double charge on ${nm(lane, e.buyer)}: retry without PayPal-Request-Id` });
          consider(6, { kind: 'double', lane, tag: 'DUPLICATE TXN', code: '×2', title: 'DOUBLE CHARGE', amount: e.amount, line: `${nm(lane, e.buyer)} charged twice after a timeout`, sub: 'retried without a PayPal-Request-Id' });
        }
        if (tr.malicious && tr.harm > 0) {
          if (e.outcome === 'completed') {
            if (tr.harm >= 40) feed.push({ t: e.t, lane, tone: 'bad', text: `BREACH ${money(tr.harm)} — ${ATTACK_LABEL[tr.attack!]} by ${nm(lane, tr.attacker)} at ${nm(lane, e.merchant)}` });
            consider(tr.harm > 120 ? 9 : 3, { kind: 'breach', lane, tag: 'ACCESS GRANTED', code: '201', title: 'BREACH', amount: tr.harm, who: nm(lane, tr.attacker), line: `${ATTACK_LABEL[tr.attack!]} got through at ${nm(lane, e.merchant)}`, sub: tr.victim ? `victim: ${nm(lane, tr.victim)}` : undefined });
          } else if (e.outcome === 'blocked' || e.outcome === 'abandoned') {
            if (tr.harm >= 60) feed.push({ t: e.t, lane, tone: 'good', text: `Stopped ${money(tr.harm)} ${ATTACK_LABEL[tr.attack!]} — ${ruleName(firstRule)}` });
            if (tr.attack === 'impersonation' && e.hits.some((h) => h.reason.includes('replayed'))) {
              consider(8, { kind: 'replay', lane, tag: 'REPLAY REJECTED', code: '401', title: 'REPLAY CAUGHT', amount: tr.harm, who: nm(lane, tr.attacker), line: 'a stolen signed request was replayed', sub: 'Web Bot Auth nonce already used: rejected' });
            } else consider(tr.harm > 150 ? 7 : 2, { kind: 'blocked', lane, tag: 'ACCESS DENIED', code: '403', title: 'BLOCKED', amount: tr.harm, who: nm(lane, tr.attacker), line: `${ATTACK_LABEL[tr.attack!]} stopped by ${ruleName(firstRule)}`, sub: e.hits.find((h) => h.rule === firstRule)?.reason });
          } else if (e.outcome === 'escrowed') {
            consider(2, { kind: 'escrow', lane, tag: 'FUNDS ON HOLD', code: '202', title: 'FUNDS HELD', amount: e.amount, line: `payment to ${nm(lane, e.merchant)} authorised, not captured`, sub: 'captured only when a carrier scans the parcel' });
          }
        } else if (!tr.malicious && e.outcome === 'blocked') {
          if (e.amount > 60) feed.push({ t: e.t, lane, tone: 'warn', text: `False positive: honest ${nm(lane, e.buyer)} blocked by ${ruleName(firstRule)} (${money(e.amount)})` });
          consider(e.amount > 90 ? 6 : 1, { kind: 'falsepos', lane, tag: 'FALSE POSITIVE', code: '403', title: 'FALSE POSITIVE', amount: e.amount, who: nm(lane, e.buyer), line: `an honest shopper was turned away by ${ruleName(firstRule)}`, sub: e.hits[0]?.reason });
        }
        break;
      }
      case 'refund':
        if (e.truth.malicious) trace.push({ t: e.t, lane, verdict: e.approved ? 'GRANT' : 'DENY', text: `${cash(e.amount)}  refund claim`, note: e.approved ? 'RFND paid out' : 'carrier says delivered' });
        if (e.truth.malicious) feed.push({ t: e.t, lane, tone: e.approved ? 'bad' : 'good', text: `${e.approved ? 'Paid out' : 'Denied'} a false refund claim of ${money(e.amount)} (${e.reason})` });
        break;
    }
  }
  // the wire is curated: a few lines per second, never a firehose
  const now2 = performance.now();
  feedBudget = Math.min(4, feedBudget + (now2 - feedClock) / 600);
  feedClock = now2;
  const take = Math.floor(feedBudget);
  if (feed.length && take > 0) {
    const pick = feed.slice(-take);
    feedBudget -= pick.length;
    st.pushFeed(pick);
  }
  if (st.cinema.on && lane === focusLane) {
    const now3 = performance.now();
    traceBudget = Math.min(4, traceBudget + (now3 - traceClock) / 260);
    traceClock = now3;
    const lines = [...trace, ...(allow ? [allow] : [])].slice(0, Math.floor(traceBudget));
    if (lines.length) { traceBudget -= lines.length; st.pushTrace(lines.reverse()); }
  }
  if (canCut && best) { lastCut = now; st.pushCutIn((best as { c: Parameters<typeof st.pushCutIn>[0] }).c); }
}

export interface SimSource { send(m: ToSim): void }

/** Where the sim runs: an in-browser worker (twin rails), or the lab server (real PayPal sandbox lane). */
function makeSource(onMsg: (m: FromSim) => void): SimSource {
  const q = new URLSearchParams(location.search);
  const local = (): SimSource => {
    const w = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<FromSim>) => onMsg(ev.data);
    return { send: (m) => w.postMessage(m) };
  };
  if (q.get('live') !== '1') return local();
  const url = q.get('server') ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const pending: ToSim[] = [];
  let fallback: SimSource | null = null;
  let open = false;
  const ws = new WebSocket(url);
  ws.onopen = () => { open = true; for (const m of pending.splice(0)) ws.send(JSON.stringify(m)); };
  ws.onmessage = (ev) => onMsg(JSON.parse(String(ev.data)) as FromSim);
  const toLocal = () => {
    if (fallback) return;
    useStore.getState().pushFeed([{ t: 0, lane: 0, tone: 'warn', text: 'Lab server unreachable: running on the local PayPal twin' }]);
    fallback = local();
    for (const m of pending.splice(0)) fallback.send(m);
  };
  ws.onerror = () => { if (!open) toLocal(); };
  ws.onclose = () => { if (open) useStore.setState({ running: false }); else toLocal(); };
  return {
    send: (m) => {
      if (fallback) return fallback.send(m);
      if (open && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
      else pending.push(m);
    },
  };
}

class Client {
  private src: SimSource;
  focusLane = 0;
  private lastSale: boolean[] = [];
  constructor() {
    this.src = makeSource((m) => this.receive(m));
  }
  send(m: ToSim) { this.src.send(m); }

  start(policies: Policy[]) {
    const st = useStore.getState();
    resetLanes(policies.length);
    seenAttackers.clear();
    worlds.length = 0;
    useStore.setState({ policies, paypalCalls: [], inFlight: [], runId: null, whatif: null });
    bus.emit('reset');
    // while the film rolls only hero shoppers pay on the live sandbox, so real PayPal latency never stalls the shot
    this.send({ cmd: 'init', seed: st.seed, lanes: policies.map((policy) => ({ policy })), chaos: st.chaos, ...(st.cinema.rolling ? { liveSample: 0 } : {}), ...(st.genomes ? { genomes: st.genomes } : {}) });
  }

  private receive(m: FromSim) {
    const st = useStore.getState();
    if (m.type === 'world') {
      worlds[m.world.lane] = m.world;
      nameCache[m.world.lane] = names(m.world.lane);
      st.setLane(m.world.lane, { world: m.world });
      bus.emit('world', m.world);
    } else if (m.type === 'tick') {
      for (const s of m.spawn) nameCache[m.lane]?.set(s.id, s.name);
      bus.emit('tick', m);
      const metrics = m.events.find((e) => e.type === 'metrics');
      const patch: Parameters<typeof st.setLane>[1] = { t: m.t, sale: m.sale, phases: m.attackerPhase };
      if (metrics && metrics.type === 'metrics') {
        patch.metrics = metrics.m;
        const hist = st.lanes[m.lane]?.history ?? [];
        patch.history = [...hist, { t: m.t, safety: metrics.m.safety, access: metrics.m.access, net: metrics.m.netValue }];
      }
      st.setLane(m.lane, patch);
      if (m.sale && !this.lastSale[m.lane] && m.lane === this.focusLane) st.pushCutIn({ kind: 'sale', lane: m.lane, tag: 'FLASH SALE', code: '%', title: 'FLASH SALE', line: 'every agent in the city starts buying at once', sub: 'velocity rules are about to be tested' });
      this.lastSale[m.lane] = m.sale;
      narrate(m.lane, m.events, this.focusLane);
    } else if (m.type === 'done') {
      st.setLane(m.lane, { done: true });
      const now = useStore.getState();
      if (now.lanes.every((l) => l.done)) {
        // while the film is rolling the director decides when the report appears
        const rolling = now.cinema.rolling;
        if (!rolling || now.lanes.length > 1) { useStore.setState({ whatif: 'pending' }); this.send({ cmd: 'whatif' }); }
        if (!rolling) useStore.setState({ showReport: true });
      }
    } else if (m.type === 'status') {
      useStore.setState({ running: m.running, tps: m.tps, paypal: m.paypal ?? 'twin' });
    } else if (m.type === 'tune') {
      const tune = useStore.getState().tune;
      if (m.phase === 'eval') useStore.setState({ tune: { ...tune, points: [...tune.points, m.point], best: m.best, evals: m.evals, total: m.total, generation: m.generation } });
      else useStore.setState({ tune: { ...tune, running: false, best: m.best, evals: m.evals, total: m.evals, ms: m.ms } });
    } else if (m.type === 'forge') {
      const f = useStore.getState().forge;
      if (m.phase === 'eval') useStore.setState({ forge: { ...f, best: m.best, baseline: m.baseline, evals: m.evals, total: m.total, curve: [...f.curve, { evals: m.evals, best: m.best.stolen, candidate: m.candidate }] } });
      else useStore.setState({ forge: { ...f, running: false, best: m.best, baseline: m.baseline, evals: m.evals, total: m.evals, ms: m.ms } });
    } else if (m.type === 'whatif') {
      useStore.setState({ whatif: { mine: m.mine, alternatives: m.alternatives } });
    } else if (m.type === 'run') {
      useStore.setState({ runId: m.runId });
    } else if (m.type === 'paypal_call') {
      const fl = useStore.getState().inFlight;
      if (m.status === 0) { useStore.setState({ inFlight: [...fl, { method: m.method, path: m.path, at: performance.now() }].slice(-8) }); return; }
      const i = fl.findIndex((f) => f.method === m.method && f.path === m.path);
      if (i >= 0) useStore.setState({ inFlight: fl.filter((_, k) => k !== i) });
      st.pushCall({ method: m.method, path: m.path, status: m.status, ms: m.ms, debugId: m.debugId, requestId: m.requestId });
    } else if (m.type === 'error') {
      st.pushFeed([{ t: st.lanes[0]?.t ?? 0, lane: 0, tone: 'warn', text: `Sim error: ${m.message}` }]);
    }
  }
}

export const client = new Client();

/** Demo deep links: ?preset=balanced  ?fork=open,balanced  ?speed=24  ?seed=xyz */
export function policiesFromUrl(fallback: Policy[]): Policy[] {
  const q = new URLSearchParams(location.search);
  const fork = q.get('fork');
  const preset = q.get('preset');
  if (q.get('seed')) useStore.setState({ seed: q.get('seed')! });
  if (q.get('speed')) useStore.setState({ tps: Number(q.get('speed')) });
  if (fork) return fork.split(',').slice(0, 2).map((k) => PRESETS[k] ?? PRESETS.open);
  if (preset && PRESETS[preset]) return [PRESETS[preset]];
  return fallback;
}
