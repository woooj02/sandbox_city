/**
 * Tick runner shared by the in-browser Web Worker and the live server.
 * Same protocol either way, so the UI doesn't care whether money is moving in a twin or at PayPal.
 */
import { World, DEFAULT_CONFIG, WorldConfig } from './world';
import type { Merchant, Shopper } from './types';
import type { FromSim, MerchantLite, ShopperLite, ToSim } from './protocol';
import type { Rails } from './rails';
import { whatIf } from './whatif';
import { searchRulebook } from './search';
import { PRESETS } from './policy';

export const mLite = (m: Merchant): MerchantLite => ({
  id: m.id, name: m.name, x: m.x, y: m.y, district: m.district, honest: m.honest, verified: m.verified, owner: m.owner, category: m.catalog[0]?.category ?? 'home',
});
export const sLite = (s: Shopper): ShopperLite => ({ id: s.id, name: s.name, x: s.x, y: s.y, district: s.district, hero: !!s.hero, controlledBy: s.controlledBy, passport: !!s.passport });

export interface RunnerOptions {
  mode: 'local' | 'server';
  crypto?: WorldConfig['crypto'];
  /** Live rails for lane 0 (server mode with PayPal credentials). */
  liveRails?: () => Rails | undefined;
  liveSample?: number;
}

export class SimRunner {
  worlds: World[] = [];
  running = false;
  tps = 8;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private gen = 0;
  private tuneGen = 0;
  private lastInit: Extract<ToSim, { cmd: 'init' }> | null = null;

  constructor(private post: (m: FromSim) => void, private opts: RunnerOptions) {}

  private status() {
    this.post({ type: 'status', running: this.running, tps: this.tps, mode: this.opts.mode, paypal: this.worlds.some((w) => w.cfg.liveRails) ? 'sandbox' : 'twin' });
  }

  handle(msg: ToSim) {
    if (msg.cmd === 'init') {
      this.lastInit = msg;
      this.gen++;
      this.running = false;
      if (this.timer) clearTimeout(this.timer);
      this.worlds = msg.lanes.map((l, lane) => new World({
        ...DEFAULT_CONFIG, seed: msg.seed, chaos: msg.chaos, shoppers: msg.shoppers ?? DEFAULT_CONFIG.shoppers, crypto: this.opts.crypto ?? 'ed25519', policy: l.policy,
        liveRails: lane === 0 ? this.opts.liveRails?.() : undefined, liveSample: this.opts.liveSample,
      }));
      this.worlds.forEach((w, lane) => this.post({
        type: 'world',
        world: {
          lane, policy: w.policy, ticks: w.cfg.ticks, merchants: [...w.merchants.values()].map(mLite), shoppers: [...w.shoppers.values()].map(sLite),
          attackers: [...w.attackers.values()].map((a) => ({ id: a.id, name: a.name, kind: a.kind, x: a.x, y: a.y, agents: a.agents })),
        },
      }));
      this.status();
    } else if (msg.cmd === 'play') {
      if (this.running) return;
      this.running = true;
      this.status();
      void this.loop(this.gen);
    } else if (msg.cmd === 'pause') {
      this.running = false;
      this.status();
    } else if (msg.cmd === 'speed') {
      this.tps = msg.tps;
      this.status();
    } else if (msg.cmd === 'tune_stop') {
      this.tuneGen++;
    } else if (msg.cmd === 'tune') {
      const init = this.lastInit;
      if (!init) return;
      const tg = ++this.tuneGen, t0 = Date.now();
      const presetOf = (name: string) => Object.values(PRESETS).find((p) => p.name === name)?.name;
      let id = 0;
      // trained on other days; the day on screen stays held out for the replay
      searchRulebook({
        trainSeeds: [`${init.seed}~train-1`, `${init.seed}~train-2`], testSeeds: [], chaos: init.chaos,
        generations: msg.generations ?? 6, children: msg.children ?? 8, minSafety: msg.minSafety, minAccess: msg.minAccess,
        seed: `${init.seed}~search`, label: msg.minSafety ? `Tuned ≥${Math.round(msg.minSafety * 100)}%` : 'Tuned · max value',
        world: init.shoppers ? { shoppers: init.shoppers } : undefined,
      }, (e) => {
        if (tg !== this.tuneGen) throw new Error('tune cancelled');
        if (e.type !== 'eval') return;
        const c = e.candidate;
        this.post({
          type: 'tune', phase: 'eval', evals: e.evals, total: e.total, generation: e.generation,
          point: { id: id++, generation: e.generation, safety: c.mean.safety, access: c.mean.access, net: c.mean.net, score: c.score, preset: e.generation === 0 ? presetOf(c.policy.name) : undefined },
          best: { policy: e.best.policy, mean: e.best.mean },
        });
      }).then((r) => {
        if (tg === this.tuneGen) this.post({ type: 'tune', phase: 'done', best: { policy: r.best.policy, mean: r.best.mean }, evals: r.evals, ms: Date.now() - t0 });
      }).catch((e: Error) => { if (e.message !== 'tune cancelled') this.post({ type: 'error', message: `tune: ${e.message}` }); });
    } else if (msg.cmd === 'whatif') {
      const init = this.lastInit;
      if (!init) return;
      const g = this.gen;
      whatIf({ seed: init.seed, chaos: init.chaos, shoppers: init.shoppers, mine: init.lanes.map((l) => l.policy) })
        .then((r) => { if (g === this.gen) this.post({ type: 'whatif', ...r }); })
        .catch((e: Error) => this.post({ type: 'error', message: `what-if: ${e.message}` }));
    }
  }

  stop() { this.running = false; this.gen++; if (this.timer) clearTimeout(this.timer); }

  private async loop(g: number) {
    if (!this.running || g !== this.gen) return;
    const t0 = Date.now();
    const batch = this.tps > 60 ? Math.ceil(this.tps / 30) : 1;
    try {
      for (let b = 0; b < batch; b++) {
        if (this.worlds.every((w) => w.done)) break;
        for (let lane = 0; lane < this.worlds.length; lane++) {
          const w = this.worlds[lane];
          if (w.done) continue;
          const events = await w.step();
          if (g !== this.gen) return;
          const spawn: MerchantLite[] = [];
          for (const e of events) if (e.type === 'store_open') { const m = w.merchants.get(e.merchant); if (m) spawn.push(mLite(m)); }
          const attackerPhase: Record<string, string> = {};
          for (const a of w.attackers.values()) attackerPhase[a.id] = a.phase;
          this.post({ type: 'tick', lane, t: w.t, events, spawn, sale: w.sale, attackerPhase });
          if (w.done) this.post({ type: 'done', lane });
        }
      }
    } catch (e) {
      this.post({ type: 'error', message: (e as Error).message });
    }
    if (this.worlds.every((w) => w.done)) { this.running = false; this.status(); return; }
    const interval = batch > 1 ? 1000 / 30 : 1000 / this.tps;
    this.timer = setTimeout(() => void this.loop(g), Math.max(0, interval - (Date.now() - t0)));
  }
}
