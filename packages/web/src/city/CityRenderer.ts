import { Application, Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import { AdvancedBloomFilter, GlitchFilter, ShockwaveFilter } from 'pixi-filters';
import { DISTRICTS, SimEvent } from '@sandbox-city/core';
import type { MerchantLite, TickMsg, WorldSnapshot } from '@sandbox-city/core';
import { makeTextures, Textures } from './textures';
import { C, CATEGORY_COLORS, DISTRICT_COLORS } from './palette';

const VH = 1000, PAD = 40;

interface Building { c: Container; light: Sprite; body: Graphics; x: number; y: number; m: MerchantLite; infected: number; pulse: number; dying?: number; born: number }
interface Person { s: Sprite; ring?: Sprite; hx: number; hy: number; ph: number; flash: number; tint: number; baseScale: number }
interface Comet {
  head: Sprite; trail: Sprite[]; x0: number; y0: number; x1: number; y1: number; cx: number; cy: number;
  age: number; dur: number; color: number; arrive?: () => void; hist: { x: number; y: number }[];
}
interface Fx { s: Sprite | Text; age: number; dur: number; kind: 'ring' | 'spark' | 'text' | 'flash'; vx?: number; vy?: number; s0: number; s1: number; a0: number; rot?: number }

export interface RendererOptions {
  xray: () => boolean; lane: number; compact?: boolean;
  /** Directed camera: push in on big moments, drift between districts otherwise. */
  cinema?: () => boolean;
  /** Called when the camera cuts to a dramatic moment (the director can slow the sim down). */
  onMoment?: (m: Moment) => void;
}

export interface Moment { kind: 'breach' | 'inject' | 'vanish' | 'double' | 'blocked' | 'hijack'; weight: number }

interface Shot { x: number; y: number; z: number; until: number; weight: number }

export class CityRenderer {
  app = new Application();
  /** Virtual width adapts to the lane's aspect so split view isn't letterboxed. */
  private VW = 1600;
  private px(x: number) { return PAD + x * (this.VW - PAD * 2); }
  private py(y: number) { return PAD + y * (VH - PAD * 2); }
  private tex!: Textures;
  private root = new Container();
  private world = new Container();
  private layers = { bg: new Container(), roads: new Container(), districts: new Container(), people: new Container(), buildings: new Container(), attackers: new Container(), fx: new Container(), labels: new Container() };
  private night = new Graphics();
  private buildings = new Map<string, Building>();
  private people = new Map<string, Person>();
  private attackers = new Map<string, { c: Container; ring: Sprite; core: Sprite; label: Text; flash: number; x: number; y: number; kind: string }>();
  private comets: Comet[] = [];
  private fx: Fx[] = [];
  private traffic: { s: Sprite; path: number[][]; u: number; v: number }[] = [];
  private districtPlates: Graphics[] = [];
  private bloom!: AdvancedBloomFilter;
  private shock!: ShockwaveFilter;
  private glitch!: GlitchFilter;
  private shockT = -1; private glitchT = -1; private shake = 0;
  private time = 0; private hour = 6; private sale = false;
  private tps = 8;
  private textCount = 0;
  private ready = false;
  private snapshot: WorldSnapshot | null = null;
  // camera: current pose eases toward the active shot; drift + shake are layered on top
  private cam = { x: 0, y: 0, z: 1 };
  private shot: Shot | null = null;
  private lastShot = -99;
  private idleShot: Shot | null = null;
  private slowUntil = 0; private slowK = 1;
  private punch = 0;

  constructor(private host: HTMLElement, private opts: RendererOptions) {}

  async init() {
    const aspect = (this.host.clientWidth || 16) / (this.host.clientHeight || 10);
    this.VW = Math.round(Math.max(820, Math.min(2200, VH * aspect)));
    await this.app.init({ resizeTo: this.host, background: '#03030a', antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true, preference: 'webgl' });
    this.host.appendChild(this.app.canvas);
    this.tex = makeTextures();
    this.app.stage.addChild(this.root);
    this.root.addChild(this.world);
    for (const l of Object.values(this.layers)) this.world.addChild(l);
    this.world.addChild(this.night);
    this.layers.fx.blendMode = 'add';
    this.layers.people.blendMode = 'add';

    this.bloom = new AdvancedBloomFilter({ threshold: 0.24, bloomScale: 0.95, brightness: 1.0, blur: 6, quality: 6 });
    this.shock = new ShockwaveFilter({ center: { x: 0, y: 0 }, amplitude: 26, wavelength: 140, speed: 900, brightness: 1.25, radius: 520 });
    this.glitch = new GlitchFilter({ slices: 14, offset: 22, red: { x: 4, y: 0 }, green: { x: -3, y: 2 }, blue: { x: 0, y: -2 }, fillMode: 2 });
    this.root.filters = [this.bloom];

    this.drawStatic();
    this.cam = { x: this.VW / 2, y: VH / 2, z: 1 };
    this.resize();
    this.app.renderer.on('resize', () => this.resize());
    this.app.ticker.add((tk) => this.frame(tk.deltaMS));
    this.ready = true;
    if (this.snapshot) this.setWorld(this.snapshot);
  }

  destroy() { try { this.app.destroy(true, { children: true }); } catch { /* noop */ } }

  setSpeed(tps: number) { this.tps = tps; }

  private get cinema() { return this.opts.cinema?.() ?? false; }

  /**
   * Push the camera in on a point for a moment. Heavier moments can interrupt lighter ones;
   * otherwise there is a cooldown so the edit never feels frantic.
   */
  focus(x: number, y: number, z: number, hold: number, weight: number, kind?: Moment['kind']) {
    if (!this.cinema) return false;
    const T = this.time;
    const busy = this.shot && T < this.shot.until;
    if (busy && weight <= this.shot!.weight) return false;
    if (!busy && T - this.lastShot < 2.4 && weight < 8) return false;
    this.shot = { x, y, z, until: T + hold, weight };
    this.lastShot = T;
    this.punch = Math.min(0.06, 0.012 * weight);
    if (kind) this.opts.onMoment?.({ kind, weight });
    return true;
  }
  /** Bullet time for the visuals only (comets, sparks, text): the sim keeps its own clock. */
  slowmo(sec: number, k: number) { if (this.cinema) { this.slowUntil = this.time + sec; this.slowK = k; } }

  private resize() {
    const w = this.app.renderer.width / this.app.renderer.resolution, h = this.app.renderer.height / this.app.renderer.resolution;
    const s = Math.min(w / this.VW, h / VH);
    this.root.scale.set(s);
    this.root.position.set((w - this.VW * s) / 2, (h - VH * s) / 2);
  }

  // ─────────────── static city ───────────────
  private drawStatic() {
    const bg = new Sprite(this.tex.bg(this.VW, VH));
    this.layers.bg.addChild(bg);

    // circuit roads between districts (orthogonal routing)
    const roads = new Graphics();
    const centers = DISTRICTS.map((d) => [this.px(d.x), this.py(d.y)]);
    const links = [[0, 1], [1, 2], [3, 4], [4, 5], [0, 3], [2, 5], [1, 4], [0, 4], [2, 4], [1, 3], [1, 5]];
    for (const [a, b] of links) {
      const [x0, y0] = centers[a], [x1, y1] = centers[b];
      const mid = (y0 + y1) / 2;
      const path = [[x0, y0], [x0, mid], [x1, mid], [x1, y1]];
      roads.moveTo(x0, y0).lineTo(x0, mid).lineTo(x1, mid).lineTo(x1, y1).stroke({ width: 7, color: 0x2a3a8a, alpha: 0.18 });
      roads.moveTo(x0, y0).lineTo(x0, mid).lineTo(x1, mid).lineTo(x1, y1).stroke({ width: 1.5, color: 0x6c8cff, alpha: 0.45 });
      for (let i = 0; i < 3; i++) {
        const s = new Sprite(this.tex.dot);
        s.anchor.set(0.5); s.scale.set(0.45); s.tint = i % 2 ? 0x6c8cff : 0xff6ad5; s.blendMode = 'add';
        this.layers.roads.addChild(s);
        this.traffic.push({ s, path, u: Math.random(), v: 0.04 + Math.random() * 0.06 });
      }
    }
    this.layers.roads.addChildAt(roads, 0);

    // district plates
    DISTRICTS.forEach((d, i) => {
      const cx = this.px(d.x), cy = this.py(d.y), rw = 0.135 * (this.VW - PAD * 2) * 1.25, rh = 0.135 * (VH - PAD * 2) * 1.1;
      const g = new Graphics();
      const col = DISTRICT_COLORS[i];
      const pts: number[] = [];
      for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; pts.push(cx + Math.cos(a) * rw, cy + Math.sin(a) * rh); }
      g.poly(pts).fill({ color: col, alpha: 0.035 }).stroke({ width: 2, color: col, alpha: 0.35 });
      const inner: number[] = [];
      for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; inner.push(cx + Math.cos(a) * rw * 0.96, cy + Math.sin(a) * rh * 0.96); }
      g.poly(inner).stroke({ width: 1, color: col, alpha: 0.18 });
      this.layers.districts.addChild(g);
      this.districtPlates.push(g);
      const label = new Text({ text: d.name.toUpperCase(), style: new TextStyle({ fontFamily: 'Chakra Petch', fontSize: 15, fontWeight: '700', fill: col, letterSpacing: 4 }) });
      label.alpha = 0.85;
      label.position.set(cx - rw * 0.52, cy - rh * 0.98);
      const jp = new Text({ text: d.jp, style: new TextStyle({ fontFamily: 'Dela Gothic One', fontSize: 30, fill: col }) });
      jp.alpha = 0.16;
      jp.position.set(cx - rw * 0.55, cy - rh * 0.86);
      this.layers.labels.addChild(label, jp);
    });
  }

  // ─────────────── world ───────────────
  setWorld(w: WorldSnapshot) {
    this.snapshot = w;
    if (!this.ready) return;
    for (const b of this.buildings.values()) b.c.destroy({ children: true });
    for (const p of this.people.values()) { p.s.destroy(); p.ring?.destroy(); }
    for (const a of this.attackers.values()) a.c.destroy({ children: true });
    this.buildings.clear(); this.people.clear(); this.attackers.clear();
    for (const c of this.comets) { c.head.destroy(); c.trail.forEach((t) => t.destroy()); }
    this.comets = [];
    for (const f of this.fx) f.s.destroy();
    this.fx = []; this.textCount = 0;

    for (const s of w.shoppers) {
      const sp = new Sprite(this.tex.dot);
      sp.anchor.set(0.5);
      const sock = !!s.controlledBy;
      const tint = sock ? 0xff3355 : s.hero ? 0xffffff : DISTRICT_COLORS[s.district];
      const sc = s.hero ? 0.9 : sock ? 0.42 : 0.34;
      sp.tint = tint; sp.scale.set(sc); sp.alpha = sock ? 0.75 : s.hero ? 1 : 0.55;
      sp.position.set(this.px(s.x), this.py(s.y));
      this.layers.people.addChild(sp);
      let ring: Sprite | undefined;
      if (s.hero) {
        ring = new Sprite(this.tex.ring);
        ring.anchor.set(0.5); ring.scale.set(0.11); ring.tint = 0x9ffcff; ring.alpha = 0.55;
        this.layers.people.addChild(ring);
      }
      this.people.set(s.id, { s: sp, ring, hx: this.px(s.x), hy: this.py(s.y), ph: Math.random() * 10, flash: 0, tint, baseScale: sc });
    }
    for (const m of w.merchants) this.addBuilding(m, false);
    for (const a of w.attackers) {
      const c = new Container();
      c.position.set(this.px(a.x), this.py(a.y));
      const aura = new Sprite(this.tex.glow); aura.anchor.set(0.5); aura.tint = C.attack; aura.alpha = 0.35; aura.scale.set(1.3); aura.blendMode = 'add';
      const ring = new Sprite(this.tex.dashRing); ring.anchor.set(0.5); ring.scale.set(0.34); ring.tint = C.attack; ring.alpha = 0.8;
      const core = new Sprite(this.tex.diamond); core.anchor.set(0.5); core.scale.set(0.42); core.tint = 0xff3d6e;
      const label = new Text({ text: a.name.toUpperCase(), style: new TextStyle({ fontFamily: 'Chakra Petch', fontSize: 11, fontWeight: '700', fill: 0xff7a9a, letterSpacing: 2 }) });
      label.anchor.set(0.5, 0); label.position.set(0, 20); label.alpha = 0.9;
      c.addChild(aura, ring, core, label);
      this.layers.attackers.addChild(c);
      this.attackers.set(a.id, { c, ring, core, label, flash: 0, x: this.px(a.x), y: this.py(a.y), kind: a.kind });
    }
  }

  private addBuilding(m: MerchantLite, spawn: boolean) {
    const c = new Container();
    const x = this.px(m.x), y = this.py(m.y);
    c.position.set(x, y);
    const col = CATEGORY_COLORS[m.category] ?? C.neutral;
    const h = 8 + (hashN(m.id) % 14);
    const body = new Graphics();
    const w = 12;
    // isometric-ish tower: front face, side face, roof
    body.poly([-w / 2, 0, w / 2, 0, w / 2, -h, -w / 2, -h]).fill({ color: 0x0b0f2a, alpha: 0.95 }).stroke({ width: 1.2, color: col, alpha: 0.9 });
    body.poly([w / 2, 0, w / 2 + 5, -4, w / 2 + 5, -h - 4, w / 2, -h]).fill({ color: col, alpha: 0.12 }).stroke({ width: 1, color: col, alpha: 0.5 });
    body.poly([-w / 2, -h, w / 2, -h, w / 2 + 5, -h - 4, -w / 2 + 5, -h - 4]).fill({ color: col, alpha: 0.55 });
    for (let wy = -h + 4; wy < -2; wy += 4) body.rect(-w / 2 + 3, wy, w - 6, 1.4).fill({ color: col, alpha: 0.5 });
    const light = new Sprite(this.tex.glow);
    light.anchor.set(0.5); light.position.set(2, -h - 2); light.scale.set(0.42); light.tint = col; light.alpha = 0.5; light.blendMode = 'add';
    c.addChild(light, body);
    this.layers.buildings.addChild(c);
    const b: Building = { c, light, body, x, y: y - h / 2, m, infected: 0, pulse: 0, born: spawn ? this.time : -9999 };
    this.buildings.set(m.id, b);
    if (spawn) { c.alpha = 0; this.burst(x, y - 6, m.honest ? col : C.attack, 0.5, 6); }
  }

  // ─────────────── events ───────────────
  onTick(msg: TickMsg) {
    if (!this.ready) return;
    this.hour = ((msg.t / 60) + 6) % 24;
    this.sale = msg.sale;
    for (const m of msg.spawn) if (!this.buildings.has(m.id)) this.addBuilding(m, true);
    const budget = this.tps > 40 ? 0.35 : this.tps > 16 ? 0.7 : 1;
    for (const e of msg.events) this.handle(e, budget);
  }

  private pos(id: string): [number, number] | null {
    const p = this.people.get(id);
    if (p) return [p.s.x, p.s.y];
    const b = this.buildings.get(id);
    if (b) return [b.x, b.y];
    return null;
  }

  private handle(e: SimEvent, budget: number) {
    const xr = this.opts.xray();
    switch (e.type) {
      case 'order': {
        const from = this.pos(e.buyer) ?? this.pos(e.truth.attacker ?? '');
        const b = this.buildings.get(e.merchant);
        if (!from || !b) return;
        const big = e.truth.harm > 120 || e.duplicateCharge;
        if (!big && Math.random() > budget) return;
        const mal = e.truth.malicious && e.truth.harm > 0;
        const color = !xr ? C.neutral : mal ? C.attack : e.truth.malicious ? 0xff7a9a : C.honest;
        // attackers launch from their lair when the agent is theirs
        const atk = e.truth.attacker ? this.attackers.get(e.truth.attacker) : undefined;
        if (atk && !e.truth.hijacked && e.truth.attack !== 'fake_store') atk.flash = 1;
        this.comet(from[0], from[1], b.x, b.y, color, () => this.arrive(e, b));
        if (mal && e.outcome === 'completed' && e.truth.harm > 150) this.focus((from[0] + b.x * 2) / 3, (from[1] + b.y * 2) / 3, 1.9, 2.4, 6);
        const p = this.people.get(e.buyer);
        if (p) p.flash = 1;
        break;
      }
      case 'refund': {
        const b = this.buildings.get(e.merchant), to = this.pos(e.buyer);
        if (!b || !to || Math.random() > budget) return;
        const col = !e.approved ? C.abandoned : e.truth.malicious && xr ? C.attack : C.refund;
        this.comet(b.x, b.y, to[0], to[1], col, () => {
          if (e.approved && e.truth.malicious) this.floatText(to[0], to[1] - 10, `-$${Math.round(e.amount)}`, C.breach, 13);
          else if (!e.approved && e.truth.malicious) { this.ringFx(to[0], to[1], C.blocked, 0.05, 0.35, 0.5); this.floatText(to[0], to[1] - 10, 'DENIED', C.blocked, 11); }
        });
        break;
      }
      case 'inject': {
        const a = this.attackers.get(e.attacker), b = this.buildings.get(e.merchant);
        if (!a || !b) return;
        a.flash = 1; b.infected = 1;
        this.bolt(a.x, a.y, b.x, b.y, C.injection);
        this.focus((a.x + b.x) / 2, (a.y + b.y) / 2, 1.55, 2.6, 5, 'inject');
        this.floatText(b.x, b.y - 22, '注入', C.injection, 16, 'Dela Gothic One');
        break;
      }
      case 'hijack': {
        const b = this.buildings.get(e.merchant), p = this.people.get(e.shopper);
        if (!b || !p) return;
        if (e.sanitized) { this.ringFx(b.x, b.y, C.blocked, 0.05, 0.5, 0.7); this.floatText(b.x, b.y - 20, 'QUARANTINED', C.blocked, 10); b.infected = 0; }
        else if (!e.resisted) { this.bolt(b.x, b.y, p.s.x, p.s.y, C.injection); p.flash = 2; this.floatText(p.s.x, p.s.y - 12, 'HIJACKED', C.injection, 11); this.focus(p.s.x, p.s.y, 2.1, 2.2, 6, 'hijack'); }
        break;
      }
      case 'store_close': {
        const b = this.buildings.get(e.merchant);
        if (!b) return;
        b.dying = this.time;
        this.burst(b.x, b.y, C.attack, 0.8, 18);
        if (this.focus(b.x, b.y, 2.3, 2.8, 7, 'vanish')) this.slowmo(1.1, 0.3);
        this.floatText(b.x, b.y - 24, '消失 VANISHED', C.attack, 13);
        break;
      }
      case 'attack': {
        const a = this.attackers.get(e.attacker);
        if (a) { a.flash = 1.5; this.ringFx(a.x, a.y, C.attack, 0.1, 0.9, 0.9); }
        break;
      }
      case 'ship': {
        const b = this.buildings.get(e.merchant);
        if (b && Math.random() < 0.25 * budget) b.pulse = 0.6;
        break;
      }
      case 'capture': break;
      case 'chaos': {
        if (Math.random() > (this.tps > 12 ? 0.08 : 0.35)) return;
        const cx = this.VW / 2 + (Math.random() - 0.5) * 300, cy = 30;
        this.floatText(cx, cy, e.fault.startsWith('TIMEOUT') ? 'TIMEOUT · RETRY' : '503 · RETRY', C.falsepos, 10);
        break;
      }
    }
  }

  private arrive(e: Extract<SimEvent, { type: 'order' }>, b: Building) {
    const mal = e.truth.malicious && e.truth.harm > 0;
    const x = b.x, y = b.y;
    b.pulse = 1;
    if (e.duplicateCharge) { this.ringFx(x, y, C.falsepos, 0.1, 0.8, 0.8); this.floatText(x, y - 26, '二重 ×2 CHARGE', C.falsepos, 13); this.kick(5); this.focus(x, y, 2.2, 2.2, 6, 'double'); }
    switch (e.outcome) {
      case 'completed':
        if (mal) {
          this.burst(x, y, C.breach, 1, 16);
          this.ringFx(x, y, C.breach, 0.1, 1.1, 0.75);
          this.floatText(x, y - 18, `-$${Math.round(e.truth.harm)}`, C.breach, e.truth.harm > 150 ? 20 : 14);
          if (e.truth.harm > 150) {
            this.shockAt(x, y); this.glitchFor(0.22); this.kick(10);
            if (this.focus(x, y, 2.6, 2.6, e.truth.harm > 300 ? 9 : 7, 'breach')) this.slowmo(0.9, 0.25);
          }
        } else this.ringFx(x, y, C.refund, 0.04, 0.28, 0.45);
        break;
      case 'escrowed': {
        const s = new Sprite(this.tex.lock); s.anchor.set(0.5); s.tint = C.escrow; s.position.set(x, y - 16); s.scale.set(0.3);
        this.layers.fx.addChild(s);
        this.fx.push({ s, age: 0, dur: 1.2, kind: 'flash', s0: 0.3, s1: 0.4, a0: 1, vy: -14 });
        this.ringFx(x, y, C.escrow, 0.05, 0.5, 0.6);
        break;
      }
      case 'blocked':
      case 'abandoned':
        if (e.truth.malicious) {
          const hx = new Sprite(this.tex.hex); hx.anchor.set(0.5); hx.tint = C.blocked; hx.position.set(x, y);
          this.layers.fx.addChild(hx);
          this.fx.push({ s: hx, age: 0, dur: 0.7, kind: 'flash', s0: 0.12, s1: 0.55, a0: 1, rot: 0.6 });
          this.ringFx(x, y, C.blocked, 0.08, 0.9, 0.6);
          this.floatText(x, y - 20, e.outcome === 'abandoned' ? 'OWNER SAID NO' : '阻止 BLOCKED', C.blocked, e.truth.harm > 150 ? 15 : 11);
          if (e.truth.harm > 200) { this.kick(3); this.focus(x, y, 2.0, 1.8, 4, 'blocked'); }
        } else {
          const s = new Sprite(this.tex.cross); s.anchor.set(0.5); s.tint = e.outcome === 'blocked' ? C.falsepos : C.abandoned; s.position.set(x, y - 4);
          this.layers.fx.addChild(s);
          this.fx.push({ s, age: 0, dur: 0.8, kind: 'flash', s0: 0.2, s1: 0.35, a0: 1 });
          if (e.outcome === 'blocked' && e.amount > 40) this.floatText(x, y - 18, 'FALSE +', C.falsepos, 10);
        }
        break;
      case 'declined':
        this.ringFx(x, y, C.declined, 0.05, 0.4, 0.5);
        if (mal) this.floatText(x, y - 16, 'DECLINED', C.declined, 10);
        break;
      case 'failed':
        this.ringFx(x, y, C.falsepos, 0.05, 0.4, 0.5);
        break;
    }
  }

  // ─────────────── fx primitives ───────────────
  private comet(x0: number, y0: number, x1: number, y1: number, color: number, arrive?: () => void) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
    const bend = (Math.random() - 0.5) * 0.5 * len;
    const cx = (x0 + x1) / 2 - (dy / len) * bend, cy = (y0 + y1) / 2 + (dx / len) * bend - len * 0.15;
    const head = new Sprite(this.tex.glow);
    head.anchor.set(0.5); head.tint = color; head.scale.set(0.28);
    this.layers.fx.addChild(head);
    const trail: Sprite[] = [];
    for (let i = 0; i < 7; i++) {
      const t = new Sprite(this.tex.dot); t.anchor.set(0.5); t.tint = color; t.alpha = 0;
      this.layers.fx.addChild(t);
      trail.push(t);
    }
    const speedK = this.tps > 30 ? 0.45 : this.tps > 12 ? 0.7 : 1;
    const dur = (0.55 + Math.min(0.7, len / 1400)) * speedK;
    this.comets.push({ head, trail, x0, y0, x1, y1, cx, cy, age: 0, dur, color, arrive, hist: [] });
  }

  private ringFx(x: number, y: number, color: number, s0: number, s1: number, dur: number) {
    const s = new Sprite(this.tex.ring); s.anchor.set(0.5); s.tint = color; s.position.set(x, y);
    this.layers.fx.addChild(s);
    this.fx.push({ s, age: 0, dur, kind: 'ring', s0, s1, a0: 1 });
  }

  private burst(x: number, y: number, color: number, power: number, n: number) {
    for (let i = 0; i < n; i++) {
      const s = new Sprite(this.tex.spark); s.anchor.set(1, 0.5); s.tint = color; s.position.set(x, y);
      const a = Math.random() * Math.PI * 2, v = (120 + Math.random() * 260) * power;
      s.rotation = a;
      this.layers.fx.addChild(s);
      this.fx.push({ s, age: 0, dur: 0.45 + Math.random() * 0.4, kind: 'spark', vx: Math.cos(a) * v, vy: Math.sin(a) * v, s0: 0.5 * power, s1: 0.1, a0: 1 });
    }
    const g = new Sprite(this.tex.glow); g.anchor.set(0.5); g.tint = color; g.position.set(x, y);
    this.layers.fx.addChild(g);
    this.fx.push({ s: g, age: 0, dur: 0.5, kind: 'flash', s0: 0.6 * power, s1: 2.2 * power, a0: 0.9 });
  }

  private bolt(x0: number, y0: number, x1: number, y1: number, color: number) {
    const g = new Graphics();
    const n = 9;
    g.moveTo(x0, y0);
    for (let i = 1; i < n; i++) {
      const u = i / n;
      g.lineTo(x0 + (x1 - x0) * u + (Math.random() - 0.5) * 26, y0 + (y1 - y0) * u + (Math.random() - 0.5) * 26);
    }
    g.lineTo(x1, y1).stroke({ width: 2.2, color, alpha: 1 });
    this.layers.fx.addChild(g);
    this.fx.push({ s: g as unknown as Sprite, age: 0, dur: 0.5, kind: 'flash', s0: 1, s1: 1, a0: 1 });
  }

  private floatText(x: number, y: number, text: string, color: number, size: number, font = 'Chakra Petch') {
    if (this.textCount > 26) return;
    const t = new Text({ text, style: new TextStyle({ fontFamily: font, fontSize: size, fontWeight: '700', fill: color, letterSpacing: 1.5, stroke: { color: 0x05060f, width: 3 } }) });
    t.anchor.set(0.5); t.position.set(x, y);
    this.layers.labels.addChild(t);
    this.textCount++;
    this.fx.push({ s: t, age: 0, dur: 1.3, kind: 'text', vy: -26, s0: 1.35, s1: 1, a0: 1 });
  }

  private lastShock = -9; private lastGlitch = -9;
  private shockAt(x: number, y: number) {
    if (this.time - this.lastShock < 2.2) return;
    this.lastShock = this.time;
    const gp = this.world.toGlobal({ x, y });
    this.shock.center = { x: gp.x, y: gp.y };
    this.shock.time = 0;
    this.shockT = 0;
    this.applyFilters();
  }
  private glitchFor(sec: number) {
    if (this.time - this.lastGlitch < 4) return;
    this.lastGlitch = this.time;
    this.glitchT = sec; this.applyFilters();
  }
  private kick(n: number) { this.shake = Math.max(this.shake, n); }
  private applyFilters() {
    const f: (AdvancedBloomFilter | ShockwaveFilter | GlitchFilter)[] = [];
    if (this.shockT >= 0) f.push(this.shock);
    if (this.glitchT > 0) f.push(this.glitch);
    f.push(this.bloom);
    this.root.filters = f;
  }

  // ─────────────── camera ───────────────
  private camera(dt: number) {
    const T = this.time;
    const W = this.VW, H = VH;
    let target: { x: number; y: number; z: number } = { x: W / 2, y: H / 2, z: 1 };
    if (this.shot && T < this.shot.until) target = this.shot;
    else if (this.cinema) {
      // between moments: slow dolly across the city, alternating wide and medium shots
      if (!this.idleShot || T > this.idleShot.until) {
        const wide = !this.idleShot || this.idleShot.z > 1.2;
        const d = DISTRICTS[Math.floor(Math.random() * DISTRICTS.length)];
        this.idleShot = wide ? { x: W / 2, y: H / 2, z: 1.04, until: T + 5, weight: 0 } : { x: this.px(d.x), y: this.py(d.y), z: 1.35, until: T + 6, weight: 0 };
      }
      target = this.idleShot;
    }
    const pushing = this.shot && T < this.shot.until;
    const k = 1 - Math.exp(-dt * (pushing ? 3.6 : 0.9));
    this.cam.z += (target.z - this.cam.z) * k;
    this.cam.x += (target.x - this.cam.x) * k;
    this.cam.y += (target.y - this.cam.y) * k;
    this.punch *= 0.9;
    const z = this.cam.z * (1 + this.punch);
    // keep the frame inside the city
    const hw = W / (2 * z), hh = H / (2 * z);
    const cx = Math.max(hw, Math.min(W - hw, this.cam.x)), cy = Math.max(hh, Math.min(H - hh, this.cam.y));
    this.shake *= 0.86;
    const drift = this.cinema ? 0.5 : 1;
    this.world.scale.set(z);
    this.world.position.set(
      W / 2 - cx * z + Math.sin(T * 0.13) * 6 * drift + (Math.random() - 0.5) * this.shake,
      H / 2 - cy * z + Math.cos(T * 0.11) * 4 * drift + (Math.random() - 0.5) * this.shake,
    );
  }

  // ─────────────── frame loop ───────────────
  private frame(dms: number) {
    const real = Math.min(0.05, dms / 1000);
    this.time += real;
    const T = this.time;
    // bullet time eases back to normal speed instead of snapping
    const slow = T < this.slowUntil ? this.slowK + (1 - this.slowK) * Math.max(0, 1 - (this.slowUntil - T) / 0.25) ** 3 : 1;
    const dt = real * slow;

    this.camera(real);

    // night tint
    const h = this.hour;
    const dark = h < 6 || h > 20 ? 0.32 : h < 8 ? 0.32 * (1 - (h - 6) / 2) : h > 18 ? 0.32 * ((h - 18) / 2) : 0;
    this.night.clear().rect(-50, -50, this.VW + 100, VH + 100).fill({ color: 0x050018, alpha: dark });

    // districts pulse on flash sale
    this.districtPlates.forEach((g, i) => { g.alpha = this.sale ? 0.7 + 0.6 * Math.abs(Math.sin(T * 4 + i)) : 1; });

    for (const tr of this.traffic) {
      tr.u = (tr.u + tr.v * dt) % 1;
      const [x, y] = along(tr.path, tr.u);
      tr.s.position.set(x, y);
    }

    for (const p of this.people.values()) {
      p.ph += dt;
      p.s.x = p.hx + Math.sin(p.ph * 0.7) * 2.2;
      p.s.y = p.hy + Math.cos(p.ph * 0.9) * 1.6;
      if (p.ring) { p.ring.position.copyFrom(p.s.position); p.ring.rotation += dt; p.ring.scale.set(0.11 + Math.sin(p.ph * 2) * 0.01); }
      if (p.flash > 0) {
        p.flash = Math.max(0, p.flash - dt * 2.2);
        p.s.scale.set(p.baseScale * (1 + p.flash * 1.4));
        p.s.alpha = Math.min(1, 0.55 + p.flash);
        p.s.tint = p.flash > 1 ? C.injection : p.tint;
      }
    }

    const xr = this.opts.xray();
    for (const b of this.buildings.values()) {
      if (b.born > 0) b.c.alpha = Math.min(1, (T - b.born) / 0.6) * (0.6 + 0.4 * Math.random());
      if (b.born > 0 && T - b.born > 0.6) { b.c.alpha = 1; b.born = -9999; }
      if (b.dying !== undefined) { const k = (T - b.dying) / 1.2; b.c.alpha = Math.max(0, 1 - k); b.c.scale.set(1 + k * 0.5, Math.max(0.01, 1 - k)); if (k >= 1) b.c.visible = false; continue; }
      b.pulse = Math.max(0, b.pulse - dt * 2.5);
      b.light.alpha = 0.45 + b.pulse * 1.2 + (this.sale ? 0.25 * Math.abs(Math.sin(T * 6 + b.x)) : 0);
      b.light.scale.set(0.42 + b.pulse * 0.6);
      if (b.infected > 0) { b.infected = Math.max(0, b.infected - dt * 0.03); b.light.tint = Math.sin(T * 20) > 0 ? C.injection : CATEGORY_COLORS[b.m.category]; }
      if (xr && !b.m.honest) {
        b.body.tint = Math.random() > 0.08 ? 0xffffff : 0xff0040;
        b.light.tint = Math.sin(T * 9) > 0 ? C.attack : 0x880022;
        b.c.x = b.x + (Math.random() > 0.95 ? (Math.random() - 0.5) * 6 : 0);
      } else if (!b.m.honest) { b.body.tint = 0xffffff; b.light.tint = CATEGORY_COLORS[b.m.category]; b.c.x = b.x; }
    }

    for (const a of this.attackers.values()) {
      a.ring.rotation += dt * (0.6 + a.flash * 4);
      a.flash = Math.max(0, a.flash - dt * 1.2);
      a.core.scale.set(0.42 + a.flash * 0.25 + Math.sin(T * 3) * 0.02);
      a.c.alpha = xr ? 1 : 0.25;
      a.core.alpha = 0.75 + Math.random() * 0.25;
    }

    // comets
    for (let i = this.comets.length - 1; i >= 0; i--) {
      const c = this.comets[i];
      c.age += dt;
      const u = Math.min(1, c.age / c.dur);
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      const x = (1 - e) * (1 - e) * c.x0 + 2 * (1 - e) * e * c.cx + e * e * c.x1;
      const y = (1 - e) * (1 - e) * c.y0 + 2 * (1 - e) * e * c.cy + e * e * c.y1;
      c.head.position.set(x, y);
      c.hist.unshift({ x, y });
      if (c.hist.length > 14) c.hist.pop();
      c.trail.forEach((t, k) => {
        const hp = c.hist[Math.min(c.hist.length - 1, k * 2)];
        t.position.set(hp.x, hp.y); t.alpha = 0.7 * (1 - k / c.trail.length); t.scale.set(0.5 * (1 - k / c.trail.length));
      });
      if (u >= 1) {
        c.arrive?.();
        c.head.destroy(); c.trail.forEach((t) => t.destroy());
        this.comets.splice(i, 1);
      }
    }

    // fx
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.age += dt;
      const u = Math.min(1, f.age / f.dur);
      const ease = 1 - Math.pow(1 - u, 3);
      if (f.kind === 'ring' || f.kind === 'flash') {
        f.s.scale.set(f.s0 + (f.s1 - f.s0) * ease);
        f.s.alpha = f.a0 * (1 - u);
        if (f.rot) f.s.rotation += f.rot * dt;
        if (f.vy) f.s.y += f.vy * dt;
      } else if (f.kind === 'spark') {
        f.s.x += (f.vx ?? 0) * dt; f.s.y += (f.vy ?? 0) * dt;
        f.vx! *= 0.9; f.vy! *= 0.9;
        f.s.scale.set(f.s0 * (1 - u) + f.s1 * u, 0.6);
        f.s.alpha = 1 - u;
      } else if (f.kind === 'text') {
        f.s.y += (f.vy ?? 0) * dt;
        f.s.scale.set(u < 0.12 ? f.s0 - (f.s0 - 1) * (u / 0.12) : 1);
        f.s.alpha = u > 0.7 ? (1 - u) / 0.3 : 1;
      }
      if (u >= 1) {
        if (f.kind === 'text') this.textCount--;
        f.s.destroy();
        this.fx.splice(i, 1);
      }
    }

    if (this.shockT >= 0) {
      this.shockT += dt;
      this.shock.time = this.shockT;
      if (this.shockT > 0.9) { this.shockT = -1; this.applyFilters(); }
    }
    if (this.glitchT > 0) {
      this.glitchT -= dt;
      this.glitch.seed = Math.random();
      this.glitch.offset = 10 + Math.random() * 30;
      if (this.glitchT <= 0) this.applyFilters();
    }
  }
}

function along(path: number[][], u: number): [number, number] {
  let total = 0;
  const seg: number[] = [];
  for (let i = 1; i < path.length; i++) { const d = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); seg.push(d); total += d; }
  let target = u * total;
  for (let i = 1; i < path.length; i++) {
    if (target <= seg[i - 1]) { const k = seg[i - 1] ? target / seg[i - 1] : 0; return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * k, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * k]; }
    target -= seg[i - 1];
  }
  const l = path[path.length - 1];
  return [l[0], l[1]];
}
function hashN(s: string) { let h = 0; for (const c of s) h = (h * 33 + c.charCodeAt(0)) >>> 0; return h; }
export type { Texture };
