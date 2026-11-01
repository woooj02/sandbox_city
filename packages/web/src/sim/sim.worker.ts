/// <reference lib="webworker" />
import { World, DEFAULT_CONFIG, Merchant, Shopper } from '@sandbox-city/core';
import type { FromSim, MerchantLite, ToSim, ShopperLite } from './protocol';

let worlds: World[] = [];
let running = false;
let tps = 6;
let timer: ReturnType<typeof setTimeout> | null = null;
let gen = 0;

const post = (m: FromSim) => (self as unknown as Worker).postMessage(m);

const mLite = (m: Merchant): MerchantLite => ({
  id: m.id, name: m.name, x: m.x, y: m.y, district: m.district, honest: m.honest, verified: m.verified, owner: m.owner,
  category: m.catalog[0]?.category ?? 'home',
});
const sLite = (s: Shopper): ShopperLite => ({ id: s.id, name: s.name, x: s.x, y: s.y, district: s.district, hero: !!s.hero, controlledBy: s.controlledBy, passport: !!s.passport });

async function loop(g: number) {
  if (!running || g !== gen) return;
  const t0 = performance.now();
  // at high speeds run several ticks per frame so the browser stays smooth
  const batch = tps > 60 ? Math.ceil(tps / 30) : 1;
  for (let b = 0; b < batch; b++) {
    if (worlds.every((w) => w.done)) break;
    for (let lane = 0; lane < worlds.length; lane++) {
      const w = worlds[lane];
      if (w.done) continue;
      const events = await w.step();
      const spawn: MerchantLite[] = [];
      for (const e of events) if (e.type === 'store_open') { const m = w.merchants.get(e.merchant); if (m) spawn.push(mLite(m)); }
      const attackerPhase: Record<string, string> = {};
      for (const a of w.attackers.values()) attackerPhase[a.id] = a.phase;
      post({ type: 'tick', lane, t: w.t, events, spawn, sale: w.sale, attackerPhase });
      if (w.done) post({ type: 'done', lane });
    }
  }
  if (worlds.every((w) => w.done)) { running = false; post({ type: 'status', running, tps, mode: 'local' }); return; }
  const interval = batch > 1 ? 1000 / 30 : 1000 / tps;
  timer = setTimeout(() => loop(g), Math.max(0, interval - (performance.now() - t0)));
}

self.onmessage = (ev: MessageEvent<ToSim>) => {
  const msg = ev.data;
  if (msg.cmd === 'init') {
    gen++;
    running = false;
    if (timer) clearTimeout(timer);
    worlds = msg.lanes.map((l) => new World({ ...DEFAULT_CONFIG, seed: msg.seed, chaos: msg.chaos, shoppers: msg.shoppers ?? DEFAULT_CONFIG.shoppers, crypto: 'ed25519', policy: l.policy }));
    worlds.forEach((w, lane) => post({
      type: 'world',
      world: { lane, policy: w.policy, ticks: w.cfg.ticks, merchants: [...w.merchants.values()].map(mLite), shoppers: [...w.shoppers.values()].map(sLite),
        attackers: [...w.attackers.values()].map((a) => ({ id: a.id, name: a.name, kind: a.kind, x: a.x, y: a.y, agents: a.agents })) },
    }));
    post({ type: 'status', running, tps, mode: 'local' });
  } else if (msg.cmd === 'play') {
    if (running) return;
    running = true;
    post({ type: 'status', running, tps, mode: 'local' });
    loop(gen);
  } else if (msg.cmd === 'pause') {
    running = false;
    post({ type: 'status', running, tps, mode: 'local' });
  } else if (msg.cmd === 'speed') {
    tps = msg.tps;
    post({ type: 'status', running, tps, mode: 'local' });
  }
};
