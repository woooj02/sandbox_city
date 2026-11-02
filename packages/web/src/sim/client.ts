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
function narrate(lane: number, events: SimEvent[], focusLane: number) {
  const st = useStore.getState();
  const feed: (Parameters<typeof st.pushFeed>[0][number] & { p?: number })[] = [];
  const now = performance.now();
  const canCut = lane === focusLane && now - lastCut > 2600 && st.cutins.length < 2;
  let best: { score: number; c: Parameters<typeof st.pushCutIn>[0] } | null = null;
  const consider = (score: number, c: Parameters<typeof st.pushCutIn>[0]) => { if (!best || score > best.score) best = { score, c }; };

  for (const e of events) {
    switch (e.type) {
      case 'inject':
        feed.push({ t: e.t, lane, tone: 'attack', text: `${nm(lane, e.attacker)} planted agent instructions in a listing at ${nm(lane, e.merchant)}` });
        if (!seenAttackers.has(`${lane}:${e.attacker}`)) { seenAttackers.add(`${lane}:${e.attacker}`); consider(5, { kind: 'attack', lane, kanji: '侵入', title: 'PROMPT INJECTION', who: nm(lane, e.attacker), line: `“${e.text.slice(0, 90)}${e.text.length > 90 ? '…' : ''}”`, sub: `hidden in a listing at ${nm(lane, e.merchant)}` }); }
        break;
      case 'attack':
        feed.push({ t: e.t, lane, tone: 'attack', text: `${nm(lane, e.attacker)} — ${e.note}` });
        consider(4, { kind: 'attack', lane, kanji: '偽装', title: ATTACK_LABEL[e.kind].toUpperCase(), who: nm(lane, e.attacker), line: e.note });
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
        if (e.duplicateCharge) {
          feed.push({ t: e.t, lane, tone: 'bad', text: `Double charge on ${nm(lane, e.buyer)}: retry without PayPal-Request-Id` });
          consider(6, { kind: 'double', lane, kanji: '二重請求', title: 'DOUBLE CHARGE', amount: e.amount, line: `${nm(lane, e.buyer)} charged twice after a timeout`, sub: 'retried without a PayPal-Request-Id' });
        }
        if (tr.malicious && tr.harm > 0) {
          if (e.outcome === 'completed') {
            if (tr.harm >= 40) feed.push({ t: e.t, lane, tone: 'bad', text: `BREACH ${money(tr.harm)} — ${ATTACK_LABEL[tr.attack!]} by ${nm(lane, tr.attacker)} at ${nm(lane, e.merchant)}` });
            consider(tr.harm > 120 ? 9 : 3, { kind: 'breach', lane, kanji: '突破', title: 'BREACH', amount: tr.harm, who: nm(lane, tr.attacker), line: `${ATTACK_LABEL[tr.attack!]} got through at ${nm(lane, e.merchant)}`, sub: tr.victim ? `victim: ${nm(lane, tr.victim)}` : undefined });
          } else if (e.outcome === 'blocked' || e.outcome === 'abandoned') {
            if (tr.harm >= 60) feed.push({ t: e.t, lane, tone: 'good', text: `Stopped ${money(tr.harm)} ${ATTACK_LABEL[tr.attack!]} — ${ruleName(firstRule)}` });
            if (tr.attack === 'impersonation' && e.hits.some((h) => h.reason.includes('replayed'))) {
              consider(8, { kind: 'replay', lane, kanji: '再送', title: 'REPLAY CAUGHT', amount: tr.harm, who: nm(lane, tr.attacker), line: 'a stolen signed request was replayed', sub: 'Web Bot Auth nonce already used: rejected' });
            } else consider(tr.harm > 150 ? 7 : 2, { kind: 'blocked', lane, kanji: '阻止', title: 'BLOCKED', amount: tr.harm, who: nm(lane, tr.attacker), line: `${ATTACK_LABEL[tr.attack!]} stopped by ${ruleName(firstRule)}`, sub: e.hits.find((h) => h.rule === firstRule)?.reason });
          } else if (e.outcome === 'escrowed') {
            consider(2, { kind: 'escrow', lane, kanji: '保留', title: 'FUNDS HELD', amount: e.amount, line: `payment to ${nm(lane, e.merchant)} authorised, not captured`, sub: 'captured only when a carrier scans the parcel' });
          }
        } else if (!tr.malicious && e.outcome === 'blocked') {
          if (e.amount > 60) feed.push({ t: e.t, lane, tone: 'warn', text: `False positive: honest ${nm(lane, e.buyer)} blocked by ${ruleName(firstRule)} (${money(e.amount)})` });
          consider(e.amount > 90 ? 6 : 1, { kind: 'falsepos', lane, kanji: '誤検知', title: 'FALSE POSITIVE', amount: e.amount, who: nm(lane, e.buyer), line: `an honest shopper was turned away by ${ruleName(firstRule)}`, sub: e.hits[0]?.reason });
        }
        break;
      }
      case 'refund':
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
    useStore.setState({ policies, paypalCalls: [], runId: null, whatif: null });
    bus.emit('reset');
    this.send({ cmd: 'init', seed: st.seed, lanes: policies.map((policy) => ({ policy })), chaos: st.chaos });
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
      if (m.sale && !this.lastSale[m.lane] && m.lane === this.focusLane) st.pushCutIn({ kind: 'sale', lane: m.lane, kanji: 'タイムセール', title: 'FLASH SALE', line: 'every agent in the city starts buying at once', sub: 'velocity rules are about to be tested' });
      this.lastSale[m.lane] = m.sale;
      narrate(m.lane, m.events, this.focusLane);
    } else if (m.type === 'done') {
      st.setLane(m.lane, { done: true });
      if (useStore.getState().lanes.every((l) => l.done)) {
        useStore.setState({ showReport: true, whatif: 'pending' });
        this.send({ cmd: 'whatif' });
      }
    } else if (m.type === 'status') {
      useStore.setState({ running: m.running, tps: m.tps, paypal: m.paypal ?? 'twin' });
    } else if (m.type === 'whatif') {
      useStore.setState({ whatif: { mine: m.mine, alternatives: m.alternatives } });
    } else if (m.type === 'run') {
      useStore.setState({ runId: m.runId });
    } else if (m.type === 'paypal_call') {
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
