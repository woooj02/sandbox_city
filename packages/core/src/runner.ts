/**
 * Tick runner shared by the in-browser Web Worker and the live server.
 * Same protocol either way, so the UI doesn't care whether money is moving in a twin or at PayPal.
 */
import type { BrainConfig } from './brain';
import { World, DEFAULT_CONFIG, WorldConfig } from './world';
import type { Merchant, Shopper } from './types';
import type { FromSim, MerchantLite, ShopperLite, ToSim } from './protocol';
import type { Rails } from './rails';
import { whatIf } from './whatif';
import { searchRulebook } from './search';
import { forgeAttacks } from './forge';
import { PRESETS, type Policy } from './policy';
import { INVARIANT_FLOOR } from './policy-patch';

export const mLite = (m: Merchant): MerchantLite => ({
  id: m.id, name: m.name, x: m.x, y: m.y, district: m.district, honest: m.honest, verified: m.verified, owner: m.owner, category: m.catalog[0]?.category ?? 'home',
});
export const sLite = (s: Shopper): ShopperLite => ({ id: s.id, name: s.name, x: s.x, y: s.y, district: s.district, hero: !!s.hero, model: !!s.model, controlledBy: s.controlledBy, passport: !!s.passport });

export interface RunnerOptions {
  mode: 'local' | 'server';
  crypto?: WorldConfig['crypto'];
  /** Live rails for lane 0 (server mode with PayPal credentials). */
  liveRails?: () => Rails | undefined;
  liveSample?: number;
}

/** A tape arrives from the browser: keep well-formed entries only, and not too many of them. */
function clampBrain(b: BrainConfig | undefined): BrainConfig | undefined {
  if (!b || typeof b !== 'object' || !b.tape || typeof b.tape !== 'object') return undefined;
  const tape: BrainConfig['tape'] = {};
  for (const [k, c] of Object.entries(b.tape).slice(0, 20000)) {
    if (!/^[0-9a-f]{16}$/.test(k) || !c || typeof c !== 'object') continue;
    tape[k] = { buy: c.buy === true, qty: Math.max(0, Math.min(50, Math.round(Number(c.qty)) || 0)), shipTo: String(c.shipTo ?? '').slice(0, 120), reason: String(c.reason ?? '').slice(0, 140) };
  }
  return { shoppers: clampN(b.shoppers, 0, 1200) ?? 0, tape, model: String(b.model ?? '').slice(0, 80) };
}

const clampN = (v: number | undefined, lo: number, hi: number) => (v === undefined || !Number.isFinite(v) ? undefined : Math.max(lo, Math.min(hi, Math.round(v))));

/** A rulebook from outside: only known rules, of the right type, in a sane range. Anything else is not a rulebook. */
function cleanPolicy(p: unknown): Policy | null {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const clean = { ...PRESETS.open } as unknown as Record<string, unknown>;
  const given = p as Record<string, unknown>;
  for (const k of [...Object.keys(PRESETS.open), 'releaseLag', 'captureAfterRelease']) {
    const v = given[k];
    if (v === undefined) continue;
    const want = typeof (PRESETS.open as unknown as Record<string, unknown>)[k];
    if (k === 'name') { if (typeof v !== 'string') return null; clean.name = v.slice(0, 80); continue; }
    if (k === 'captureAfterRelease' || want === 'boolean') { if (typeof v !== 'boolean') return null; clean[k] = v; continue; }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e6) return null;
    clean[k] = v;
  }
  return clean as unknown as Policy;
}

const COMMANDS = new Set(['init', 'play', 'pause', 'speed', 'whatif', 'tune', 'tune_stop', 'forge', 'forge_stop']);

/** The one door into the runner. Says what is wrong with a command, or returns a clean copy of it. */
function checkMsg(raw: unknown): { msg: ToSim } | { problem: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { problem: 'a command is an object' };
  const m = raw as Record<string, unknown>;
  if (typeof m.cmd !== 'string' || !COMMANDS.has(m.cmd)) return { problem: 'unknown command' };
  if (m.cmd === 'init') {
    if (typeof m.seed !== 'string' || !m.seed || m.seed.length > 120) return { problem: 'init needs a seed' };
    if (!Array.isArray(m.lanes) || m.lanes.length < 1) return { problem: 'init needs at least one lane' };
    const lanes = m.lanes.slice(0, 2).map((l: { policy?: unknown } | null) => cleanPolicy(l?.policy));
    if (lanes.some((p) => !p)) return { problem: 'a lane needs a valid rulebook' };
    if (m.genomes !== undefined && (!m.genomes || typeof m.genomes !== 'object' || Array.isArray(m.genomes))) return { problem: 'genomes must be an object' };
    return { msg: { ...m, lanes: lanes.map((policy) => ({ policy: policy! })) } as unknown as ToSim };
  }
  if (m.cmd === 'forge') {
    const policy = cleanPolicy(m.policy);
    if (!policy) return { problem: 'forge needs a valid rulebook' };
    return { msg: { ...m, policy } as unknown as ToSim };
  }
  return { msg: m as unknown as ToSim };
}

/** Requests can come from anyone on a public lab server: keep every size inside what the lab itself ever asks for. */
function clampMsg(msg: ToSim): ToSim {
  switch (msg.cmd) {
    case 'init': return { ...msg, lanes: msg.lanes.slice(0, 2), shoppers: clampN(msg.shoppers, 50, 1200), chaos: Math.max(0, Math.min(1, Number(msg.chaos) || 0)), brain: clampBrain(msg.brain) };
    case 'speed': return { ...msg, tps: clampN(msg.tps, 1, 2400) ?? 8 };
    case 'tune': return { ...msg, generations: clampN(msg.generations, 1, 8), children: clampN(msg.children, 1, 12), trainDays: clampN(msg.trainDays, 1, 5) };
    case 'forge': return { ...msg, generations: clampN(msg.generations, 1, 8), children: clampN(msg.children, 1, 10) };
    default: return msg;
  }
}

export class SimRunner {
  worlds: World[] = [];
  running = false;
  tps = 8;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private gen = 0;
  private tuneGen = 0;
  private forgeGen = 0;
  private lastInit: Extract<ToSim, { cmd: 'init' }> | null = null;

  constructor(private post: (m: FromSim) => void, private opts: RunnerOptions) {}

  private status() {
    this.post({ type: 'status', running: this.running, tps: this.tps, mode: this.opts.mode, paypal: this.worlds.some((w) => w.cfg.liveRails) ? 'sandbox' : 'twin' });
  }

  /** Never throws: one bad command gets one error back, and the process and every other client carry on. */
  handle(raw: unknown) {
    const checked = checkMsg(raw);
    if ('problem' in checked) { this.post({ type: 'error', message: `bad command: ${checked.problem}` }); return; }
    try { this.dispatch(clampMsg(checked.msg)); } catch (e) { this.post({ type: 'error', message: `command failed: ${(e as Error).message}` }); }
  }

  private dispatch(msg: ToSim) {
    if (msg.cmd === 'init') {
      this.lastInit = msg;
      this.gen++;
      this.running = false;
      if (this.timer) clearTimeout(this.timer);
      this.worlds = msg.lanes.map((l, lane) => new World({
        ...DEFAULT_CONFIG, seed: msg.seed, chaos: msg.chaos, shoppers: msg.shoppers ?? DEFAULT_CONFIG.shoppers, crypto: this.opts.crypto ?? 'ed25519', policy: l.policy,
        liveRails: lane === 0 ? this.opts.liveRails?.() : undefined,
        liveSample: Math.min(this.opts.liveSample ?? 0, msg.liveSample ?? Infinity),
        genomes: msg.genomes,
        brain: msg.brain,
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
        trainSeeds: Array.from({ length: Math.max(1, Math.min(5, msg.trainDays ?? 2)) }, (_, i) => `${init.seed}~train-${i + 1}`), testSeeds: [], chaos: init.chaos,
        generations: msg.generations ?? 6, children: msg.children ?? 8, minSafety: Number(msg.minSafety) || undefined, minAccess: Number(msg.minAccess) || undefined,
        // the benchmark's protocol: invariants stay on and each day runs to its end. What differs is the number of days
        floor: INVARIANT_FLOOR, settle: true,
        seed: `${init.seed}~search`, label: msg.minSafety ? `Tuned ≥${Math.round(msg.minSafety * 100)}%` : 'Tuned · max value',
        world: { ...(init.shoppers ? { shoppers: init.shoppers } : {}), genomes: init.genomes, brain: init.brain },
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
    } else if (msg.cmd === 'forge_stop') {
      this.forgeGen++;
    } else if (msg.cmd === 'forge') {
      const init = this.lastInit;
      if (!init) return;
      const fg = ++this.forgeGen, t0 = Date.now();
      forgeAttacks({
        policy: msg.policy, seeds: [`${init.seed}~forge-1`, `${init.seed}~forge-2`], chaos: init.chaos,
        generations: msg.generations ?? 5, children: msg.children ?? 6, seed: `${init.seed}~forge`, start: init.genomes,
        world: init.shoppers ? { shoppers: init.shoppers } : undefined,
      }, (e) => {
        if (fg !== this.forgeGen) throw new Error('forge cancelled');
        this.post({ type: 'forge', phase: 'eval', generation: e.generation, evals: e.evals, total: e.total, candidate: e.candidate.stolen, best: e.best, baseline: e.baseline });
      }).then((r) => {
        if (fg === this.forgeGen) this.post({ type: 'forge', phase: 'done', best: r.best, baseline: r.baseline, evals: r.evals, ms: Date.now() - t0 });
      }).catch((e: Error) => { if (e.message !== 'forge cancelled') this.post({ type: 'error', message: `forge: ${e.message}` }); });
    } else if (msg.cmd === 'whatif') {
      const init = this.lastInit;
      if (!init) return;
      const g = this.gen;
      whatIf({ seed: init.seed, chaos: init.chaos, shoppers: init.shoppers, mine: init.lanes.map((l) => l.policy) }, { genomes: init.genomes, brain: init.brain })
        .then((r) => { if (g === this.gen) this.post({ type: 'whatif', ...r }); })
        .catch((e: Error) => this.post({ type: 'error', message: `what-if: ${e.message}` }));
    }
  }

  /** Ends everything this runner started, searches included, so a closed socket leaves no work behind. */
  stop() { this.running = false; this.gen++; this.tuneGen++; this.forgeGen++; if (this.timer) clearTimeout(this.timer); }

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
      this.running = false; this.status(); return;
    }
    if (this.worlds.every((w) => w.done)) { this.running = false; this.status(); return; }
    const interval = batch > 1 ? 1000 / 30 : 1000 / this.tps;
    this.timer = setTimeout(() => void this.loop(g), Math.max(0, interval - (Date.now() - t0)));
  }
}
