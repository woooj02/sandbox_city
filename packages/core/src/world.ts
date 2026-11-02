/**
 * Sandbox City world: a deterministic, forkable agent economy.
 * Same seed + same policy => identical run. Change only the policy and you get a clean counterfactual.
 */
import { Rng, round2, clamp } from './rng';
import type {
  Attacker, AttackKind, KindTally, Merchant, Metrics, OrderIntent, Outcome, Passport, Product, RuleHit, Shopper, SignedRequest, SimEvent,
} from './types';
import { ATTACK_KINDS } from './types';
import { CryptoMode, deriveKey, KeyPair, signRequest, SignatureVerifier } from './kya';
import { ChaosRails, PayPalTwin, Rails, RailsError, CardRef } from './rails';
import { Policy, evaluateOrder, evaluateRefund, AgentView, MerchantView } from './policy';
import { CATEGORIES, DISTRICTS, DROPS, INJECTIONS, YOKAI, agentName, lookalike, makeMerchant, placeIn } from './gen';
import { defaultGenome } from './genome';

export interface WorldConfig {
  seed: string;
  shoppers: number;
  merchants: number;
  attackers: Partial<Record<AttackKind, number>>;
  genomes?: Partial<Record<AttackKind, Record<string, number>>>;
  ticks: number;
  crypto: CryptoMode;
  chaos: number;
  policy: Policy;
  heroes?: number;
  /** Optional real rails (PayPal sandbox) for a sampled lane. */
  liveRails?: Rails;
  liveSample?: number;
}

export const DEFAULT_CONFIG: Omit<WorldConfig, 'policy'> = {
  seed: 'sandbox-city', shoppers: 600, merchants: 90,
  attackers: { prompt_injection: 2, fake_store: 3, refund_abuse: 3, card_testing: 4, impersonation: 2, fraud_ring: 1 },
  ticks: 1440, crypto: 'ed25519', chaos: 0.04, heroes: 6,
};

interface AgentStats { first: number; orders: number; refunds: number; times: number[]; merchants: Map<string, number> }
interface MerchantStats { orders: number; fulfilled: number; refunds: number; buyers: Map<string, number> }
interface OrderRec {
  r: Rng;
  /** The rails this order was paid on; its whole lifecycle (capture, void, refund) stays there. */
  lane: Rails;
  intent: OrderIntent; card: CardRef; payer: string; captureId?: string; authId?: string; amountHeld: number;
  shipped?: number; tracking?: string; carrierScan: boolean; delivered: boolean; refunded: boolean; leaked: number;
}
type Task =
  | { k: 'ship'; order: string }
  | { k: 'deliver'; order: string }
  | { k: 'refundCheck'; order: string }
  | { k: 'abuseRefund'; order: string }
  | { k: 'escrowExpire'; order: string };

const emptyTally = (): KindTally => ({ attempts: 0, attempted: 0, prevented: 0, leaked: 0 });

export class World {
  readonly cfg: WorldConfig;
  readonly policy: Policy;
  t = 0;
  readonly shoppers = new Map<string, Shopper>();
  readonly merchants = new Map<string, Merchant>();
  readonly attackers = new Map<string, Attacker>();
  readonly twin: PayPalTwin;
  private rails: Rails;
  private live?: Rails;
  private rng: Rng;
  private rWorld: Rng; private rNonce: Rng; private rOpen: Rng;
  /** One activation stream per shopper, consumed exactly once per tick: paired counterfactuals across policies. */
  private rActivate = new Map<string, Rng>();
  private keys = new Map<string, KeyPair>();
  private directory = new Map<string, { passport: Passport; secret?: Uint8Array }>();
  private byAgent = new Map<string, Passport>();
  private verifier: SignatureVerifier;
  private aStats = new Map<string, AgentStats>();
  private mStats = new Map<string, MerchantStats>();
  readonly orders = new Map<string, OrderRec>();
  private tasks = new Map<number, Task[]>();
  private sniffed = new Map<string, SignedRequest[]>();
  private quarantined = new Set<string>();
  private seq = 0;
  private buffer: SimEvent[] = [];
  private listeners: ((events: SimEvent[], w: World) => void)[] = [];
  m: Metrics;
  sale = false;

  constructor(cfg: WorldConfig) {
    this.cfg = cfg;
    this.policy = cfg.policy;
    this.rng = new Rng(cfg.seed);
    this.rWorld = this.rng.fork('world');
    this.rNonce = this.rng.fork('nonce');
    this.rOpen = this.rng.fork('open');
    this.twin = new PayPalTwin(this.rng.fork('paypal'));
    this.rails = new ChaosRails(this.twin, this.rng.fork('chaos'), cfg.chaos);
    if (cfg.liveRails) this.live = new ChaosRails(cfg.liveRails, this.rng.fork('chaos-live'), cfg.chaos);
    this.verifier = new SignatureVerifier(this.directory, cfg.crypto, cfg.policy.sigSkew);
    this.m = this.freshMetrics();
    this.populate();
  }

  // ───────────────────────────── setup ─────────────────────────────
  private freshMetrics(): Metrics {
    const byKind = {} as Record<AttackKind, KindTally>;
    for (const k of ATTACK_KINDS) byKind[k] = emptyTally();
    return {
      t: 0, orders: 0,
      honest: { attempts: 0, completed: 0, blocked: 0, abandoned: 0, challenged: 0, declined: 0, gmv: 0, blockedValue: 0, abandonedValue: 0 },
      fraud: { attempts: 0, attempted: 0, prevented: 0, leaked: 0, byKind },
      refunds: { legitApproved: 0, legitDenied: 0, abuseApproved: 0, abuseDenied: 0 },
      chaos: { faults: 0, recovered: 0, duplicateCharges: 0, duplicateValue: 0 },
      safety: 1, access: 1, netValue: 0,
    };
  }

  /** Deterministic sub-stream keyed by entity + time, independent of what the policy did elsewhere. */
  private r(key: string) { return this.rng.fork(key); }

  private nextId(prefix: string) { return `${prefix}${(++this.seq).toString(36).toUpperCase().padStart(5, '0')}`; }

  private issuePassport(agentId: string, address: string, owner: string, maxPerOrder: number, categories: string[]): Passport {
    const key = deriveKey(this.cfg.seed, agentId, this.cfg.crypto);
    this.keys.set(agentId, key);
    const passport: Passport = { agentId, keyId: key.keyId, publicKey: key.publicKey, ownerPayerId: owner, address, issuedAt: this.t, mandate: { maxPerOrder, categories } };
    this.directory.set(key.keyId, { passport, secret: this.cfg.crypto === 'modeled' ? key.secret : undefined });
    this.byAgent.set(agentId, passport);
    return passport;
  }

  private addShopper(opts: Partial<Shopper> = {}, passport = true, district?: number): Shopper {
    const r = this.rWorld;
    const id = opts.id ?? this.nextId('A');
    const d = district ?? r.int(0, DISTRICTS.length - 1);
    const address = `${r.int(1, 999)} ${r.pick(['Sakura', 'Neon', 'Lantern', 'Harbor', 'Circuit', 'Willow'])} ${r.pick(['St', 'Ave', 'Way', 'Row'])}, ${DISTRICTS[d].name}`;
    const bursty = r.chance(0.12);
    const s: Shopper = {
      id, name: agentName(r), district: d, ...placeIn(r, d, 0.16), address, passport: null,
      rate: r.logNormal(1 / 320, 0.5), bursty, gullibility: clamp(r.normal(0.35, 0.2), 0.02, 0.95),
      priceSensitivity: clamp(r.normal(0.5, 0.2), 0, 1), refundRate: clamp(r.normal(0.04, 0.03), 0, 0.2),
      giftRate: r.chance(0.3) ? 0.15 : 0.02, clockSkew: r.chance(0.02) ? r.int(40, 400) * (r.chance(0.5) ? 1 : -1) : r.int(-5, 5),
      joinedAt: this.t, ...opts,
    };
    if (passport) {
      const cats = r.chance(0.7) ? [...CATEGORIES] : CATEGORIES.filter(() => r.chance(0.6));
      s.passport = this.issuePassport(id, address, `PAYER-${r.paypalId().slice(0, 13)}`, round2(r.pick([80, 120, 150, 200, 300, 500])), cats.length ? cats : ['food']);
    }
    this.shoppers.set(id, s);
    this.rActivate.set(id, this.rng.fork(`act:${id}`));
    this.aStats.set(id, { first: this.t, orders: 0, refunds: 0, times: [], merchants: new Map() });
    return s;
  }

  private addMerchant(opts: Partial<Merchant> = {}, rng: Rng = this.rWorld): Merchant {
    const id = opts.id ?? `M${this.merchants.size.toString(36).toUpperCase().padStart(4, '0')}`;
    const m = makeMerchant(rng, id, this.t, opts);
    this.merchants.set(id, m);
    this.mStats.set(id, { orders: 0, fulfilled: 0, refunds: 0, buyers: new Map() });
    this.emit({ type: 'store_open', t: this.t, merchant: id, name: m.name, honest: m.honest, attacker: m.owner });
    return m;
  }

  private populate() {
    const c = this.cfg;
    for (let i = 0; i < c.merchants; i++) this.addMerchant({ openedAt: -this.rWorld.int(200, 20000) });
    for (let i = 0; i < c.shoppers; i++) {
      const s = this.addShopper({}, this.rWorld.chance(0.92));
      // most shoppers have history before the run starts
      const st = this.aStats.get(s.id)!;
      st.first = -this.rWorld.int(0, 30000);
      st.orders = this.rWorld.int(0, 40);
      st.refunds = Math.floor(st.orders * s.refundRate);
      if (st.first > -600) st.orders = this.rWorld.int(0, 2);
    }
    for (let i = 0; i < (c.heroes ?? 0); i++) {
      const s = [...this.shoppers.values()][i * 7];
      if (s) s.hero = true;
    }
    for (const m of this.merchants.values()) {
      const st = this.mStats.get(m.id)!;
      st.orders = st.fulfilled = this.rWorld.int(5, 400);
      st.refunds = Math.floor(st.orders * this.rWorld.range(0.01, 0.05));
      // repeat customers create honest closed loops, a ring detector's false positives
      if (this.rWorld.chance(0.08)) {
        const regulars = [...this.shoppers.values()].filter(() => this.rWorld.chance(0.004));
        for (const r of regulars) { st.buyers.set(r.id, 6); this.aStats.get(r.id)!.merchants.set(m.id, 6); }
      }
    }
    let n = 0;
    for (const kind of ATTACK_KINDS) {
      for (let i = 0; i < (c.attackers[kind] ?? 0); i++) this.addAttacker(kind, n++);
    }
    this.flush();
  }

  private addAttacker(kind: AttackKind, n: number) {
    const r = this.rng.fork(`attacker:${n}`);
    const id = `X${n}`;
    const genome = { ...defaultGenome(kind), ...(this.cfg.genomes?.[kind] ?? {}) };
    const d = r.pick([3, 5, 4]);
    const a: Attacker = {
      id, name: `${YOKAI[n % YOKAI.length]}-${String(n).padStart(2, '0')}`, kind, genome, agents: [], phase: 'recon',
      nextActAt: r.int(10, 180), stolenCards: kind === 'card_testing' ? 30 : kind === 'fraud_ring' ? 24 : 0, ...placeIn(r, d, 0.06),
    };
    const sock = (passport: boolean, hist = 0) => {
      const s = this.addShopper({ controlledBy: id, gullibility: 0, refundRate: 0, clockSkew: 0, giftRate: 0 }, passport, d);
      if (passport && s.passport) s.passport.mandate = { maxPerOrder: 5000, categories: [...CATEGORIES] };
      if (hist) { const st = this.aStats.get(s.id)!; st.first = -hist; st.orders = r.int(2, 12); }
      a.agents.push(s.id);
      return s;
    };
    if (kind === 'refund_abuse') for (let i = 0; i < genome.agents; i++) sock(true, r.int(300, 4000));
    if (kind === 'card_testing') for (let i = 0; i < genome.agents; i++) sock(r.chance(genome.passport));
    if (kind === 'fraud_ring') {
      for (let i = 0; i < genome.size; i++) sock(true);
      const m = this.addMerchant({ honest: false, owner: id, verified: r.chance(0.5), shipRate: 0, district: d }, r);
      a.merchant = m.id;
    }
    this.attackers.set(id, a);
  }

  // ───────────────────────────── events ─────────────────────────────
  on(fn: (events: SimEvent[], w: World) => void) { this.listeners.push(fn); }
  private emit(e: SimEvent) { this.buffer.push(e); }
  private flush() {
    const ev = this.buffer;
    this.buffer = [];
    for (const l of this.listeners) l(ev, this);
    return ev;
  }
  private schedule(at: number, task: Task) {
    const list = this.tasks.get(at);
    if (list) list.push(task); else this.tasks.set(at, [task]);
  }

  // ───────────────────────────── observation ─────────────────────────────
  agentView(id: string): AgentView {
    const st = this.aStats.get(id);
    if (!st) return { age: 0, orders: 0, recent: 0, refunds: 0, rep: 0 };
    while (st.times.length && st.times[0] <= this.t - 60) st.times.shift();
    const rep = clamp(0.15 + 0.6 * (1 - Math.exp(-st.orders / 10)) + Math.min(0.2, (this.t - st.first) / 20000) - (st.orders ? 1.5 * st.refunds / st.orders : 0), 0, 1);
    return { age: this.t - st.first, orders: st.orders, recent: st.times.length, refunds: st.refunds, rep };
  }

  merchantView(id: string): MerchantView {
    const m = this.merchants.get(id)!;
    const st = this.mStats.get(id)!;
    const refundRatio = st.orders ? st.refunds / st.orders : 0;
    const rep = clamp(0.2 + 0.5 * (1 - Math.exp(-st.fulfilled / 25)) + (m.verified ? 0.15 : 0) + Math.min(0.1, (this.t - m.openedAt) / 3000) - 2 * refundRatio, 0, 1);
    // closed-loop score: share of this store's orders from buyers who shop almost only here
    let loop = 0, total = 0;
    for (const [buyer, n] of st.buyers) {
      total += n;
      const bm = this.aStats.get(buyer)?.merchants;
      if (!bm) continue;
      let all = 0;
      for (const v of bm.values()) all += v;
      if (n >= 3 && n / all > 0.6) loop += n;
    }
    return { age: this.t - m.openedAt, verified: m.verified, rep, ring: total ? loop / total : 0, orders: total };
  }

  publicRating(m: Merchant) { return this.merchantView(m.id).rep; }

  // ───────────────────────────── main loop ─────────────────────────────
  get done() { return this.t >= this.cfg.ticks; }

  async step(): Promise<SimEvent[]> {
    this.t++;
    const t = this.t;
    const hour = ((t / 60) + 6) % 24;
    this.sale = hour >= 19 && hour < 20.5;
    const diurnal = 0.35 + 0.65 * Math.max(0, Math.sin(((hour - 7) / 16) * Math.PI));
    const intents: OrderIntent[] = [];

    // scheduled lifecycle work
    const due = this.tasks.get(t);
    if (due) { this.tasks.delete(t); for (const task of due) await this.runTask(task); }

    // new honest stores open over time (false-positive bait for reputation rules)
    if (this.rOpen.chance(1 / 90)) { const ro = this.r(`open:${t}`); this.addMerchant({ openedAt: t, verified: ro.chance(0.6) }, ro); }

    // honest shoppers
    for (const s of this.shoppers.values()) {
      if (s.controlledBy) continue;
      const boost = this.sale ? (s.bursty ? 9 : 2.2) : 1;
      if (!this.rActivate.get(s.id)!.chance(s.rate * diurnal * boost)) continue;
      const it = this.honestIntent(s);
      if (it) intents.push(it);
    }
    // attackers
    for (const a of this.attackers.values()) {
      if (t >= a.nextActAt) intents.push(...this.attackerAct(a));
    }

    // gate + rails: rails calls run concurrently, results applied in deterministic order
    await Promise.all(intents.map((it) => this.process(it)));

    if (t % 10 === 0 || this.done) this.emit({ type: 'metrics', t, m: this.snapshot() });
    return this.flush();
  }

  async run(onTick?: (ev: SimEvent[]) => void): Promise<Metrics> {
    while (!this.done) { const ev = await this.step(); onTick?.(ev); }
    return this.snapshot();
  }

  snapshot(): Metrics {
    const m = this.m;
    m.t = this.t;
    const harmTotal = m.fraud.prevented + m.fraud.leaked;
    m.safety = harmTotal ? m.fraud.prevented / harmTotal : 1;
    m.access = m.honest.attempts ? m.honest.completed / m.honest.attempts : 1;
    m.netValue = round2(m.honest.gmv - m.fraud.leaked - m.chaos.duplicateValue);
    return JSON.parse(JSON.stringify(m));
  }

  // ───────────────────────────── honest behaviour ─────────────────────────────
  private openMerchants(): Merchant[] { return [...this.merchants.values()].filter((m) => !m.closed); }

  private chooseMerchant(s: Shopper, category: string, r: Rng): Merchant | null {
    const all = this.openMerchants();
    const st = this.aStats.get(s.id)!;
    const pool: Merchant[] = [];
    for (let i = 0; i < 7; i++) pool.push(r.pick(all));
    for (const [mid, n] of st.merchants) if (n >= 3 && this.merchants.get(mid) && !this.merchants.get(mid)!.closed) pool.push(this.merchants.get(mid)!);
    const sells = pool.filter((m) => m.catalog.some((p) => p.category === category));
    const cands = sells.length ? sells : pool;
    return r.weighted(cands, (m) => {
      const loyal = (st.merchants.get(m.id) ?? 0) >= 3 ? 1.5 : 1;
      const cheap = Math.pow(1 / m.priceFactor, 6 * s.priceSensitivity);
      return (0.4 + this.publicRating(m)) * cheap * loyal;
    });
  }

  private honestIntent(s: Shopper): OrderIntent | null {
    const r = this.r(`buy:${s.id}:${this.t}`);
    const category = r.pick(CATEGORIES);
    const m = this.chooseMerchant(s, category, r);
    if (!m) return null;
    const items = m.catalog.filter((p) => p.category === category);
    const product = r.pick(items.length ? items : m.catalog);
    let qty = r.chance(0.85) ? 1 : r.int(2, 3);
    let shipTo = r.chance(s.giftRate) ? `${r.int(1, 999)} Gift Ln, ${DISTRICTS[r.int(0, 5)].name}` : s.address;
    const truth: OrderIntent['truth'] = { malicious: false, harm: 0 };

    // the agent reads the listing: sanitizer first, then any injected instructions
    const strict = this.policy.sanitizer;
    if (strict > 0 && !this.quarantined.has(product.sku)) {
      const caught = product.injected && r.chance(sigmoid((strict - product.injected.subtlety) * 9));
      const falsePositive = !product.injected && product.imperativeCopy && r.chance(sigmoid((strict - 0.6) * 9));
      if (caught || falsePositive) this.quarantined.add(product.sku);
      if (caught) this.emit({ type: 'hijack', t: this.t, shopper: s.id, merchant: m.id, attacker: product.injected!.by, resisted: true, sanitized: true });
    }
    // a quarantined injected listing still counts as an attack the rules defused
    if (this.quarantined.has(product.sku) && product.injected && r.chance(s.gullibility)) {
      const harm = round2(product.price * product.injected.payload.qty);
      this.tallyAttempt('prompt_injection', harm);
      this.prevent('prompt_injection', harm);
    }
    if (this.quarantined.has(product.sku)) {
      if (!product.injected) { this.m.honest.attempts++; this.m.honest.blocked++; this.m.honest.blockedValue += product.price; }
      return null;
    }
    if (product.injected) {
      const inj = product.injected;
      const hijacked = r.chance(s.gullibility);
      this.emit({ type: 'hijack', t: this.t, shopper: s.id, merchant: m.id, attacker: inj.by, resisted: !hijacked, sanitized: false });
      if (hijacked) {
        qty = inj.payload.qty;
        shipTo = inj.payload.shipTo;
        truth.malicious = true; truth.attack = 'prompt_injection'; truth.attacker = inj.by; truth.hijacked = true; truth.victim = s.id;
        truth.harm = round2(product.price * qty);
      }
    }
    return this.buildIntent(s, m, product, qty, shipTo, truth);
  }

  private buildIntent(s: Shopper, m: Merchant, product: Product, qty: number, shipTo: string, truth: OrderIntent['truth'], unitOverride?: number, _r?: Rng): OrderIntent {
    const unit = unitOverride ?? product.price;
    const amount = round2(unit * qty);
    const id = this.nextId('O');
    const body = JSON.stringify({ merchant: m.id, sku: product.sku, qty, amount, ship_to: shipTo, order: id });
    let request: SignedRequest | null = null;
    const key = this.keys.get(s.id);
    if (key && s.passport) {
      request = signRequest({ method: 'POST', authority: `${m.id.toLowerCase()}.shop.sandbox.city`, path: '/checkout', body }, key,
        `https://agents.sandbox.city/.well-known/http-message-signatures-directory#${s.id}`, this.t * 60 + s.clockSkew, this.rNonce.hex(16), this.cfg.crypto);
    }
    return { id, t: this.t, buyer: s.id, merchant: m.id, sku: product.sku, qty, unit, amount, shipTo, category: product.category, request, claimedAgent: s.id, truth };
  }

  // ───────────────────────────── attackers ─────────────────────────────
  private attackerAct(a: Attacker): OrderIntent[] {
    const r = this.r(`atk:${a.id}:${this.t}`), g = a.genome, t = this.t, out: OrderIntent[] = [];
    const honestMerchants = this.openMerchants().filter((m) => m.honest);
    const target = () => r.pick(honestMerchants);
    a.nextActAt = t + Math.max(1, Math.round(g.interval * r.range(0.6, 1.4)));

    switch (a.kind) {
      case 'prompt_injection': {
        const m = target();
        const p = r.pick(m.catalog);
        if (p.injected) break;
        const tpl = INJECTIONS[Math.min(INJECTIONS.length - 1, Math.floor(g.subtlety * INJECTIONS.length))];
        const drop = r.pick(DROPS);
        const text = tpl.text.replace('{qty}', String(Math.round(g.qty))).replace('{drop}', drop);
        p.injected = { by: a.id, text, subtlety: clamp(tpl.subtlety + r.normal(0, 0.05), 0, 1), payload: { qty: Math.round(g.qty), shipTo: drop } };
        p.description += ' ' + text;
        a.phase = 'planting';
        this.emit({ type: 'inject', t, attacker: a.id, merchant: m.id, sku: p.sku, text });
        break;
      }
      case 'fake_store': {
        if (a.merchant) {
          const fm = this.merchants.get(a.merchant)!;
          if (t - fm.openedAt >= g.cashout) {
            fm.closed = true; a.merchant = undefined; a.phase = 'vanished';
            this.emit({ type: 'store_close', t, merchant: fm.id, reason: 'cashed out and vanished' });
            this.emit({ type: 'attack', t, attacker: a.id, kind: a.kind, note: `cashed out ${fm.name}` });
          }
          break;
        }
        const victim = r.weighted(honestMerchants, (m) => this.mStats.get(m.id)!.fulfilled);
        const fm = this.addMerchant({
          honest: false, owner: a.id, district: victim.district, priceFactor: victim.priceFactor * (1 - g.discount),
          verified: r.chance(g.verify * 0.4), shipRate: 0, openedAt: t,
        }, r);
        fm.name = lookalike(r, victim.name);
        fm.catalog = victim.catalog.map((p, i) => ({ ...p, sku: `${fm.id}-SKU${i}`, price: round2(p.price * (1 - g.discount)), injected: undefined }));
        a.merchant = fm.id; a.phase = 'storefront';
        this.emit({ type: 'attack', t, attacker: a.id, kind: a.kind, note: `opened lookalike "${fm.name}"` });
        break;
      }
      case 'refund_abuse': {
        const s = this.shoppers.get(r.pick(a.agents))!;
        const m = target();
        const p = r.weighted(m.catalog, (x) => x.price);
        a.phase = 'buying';
        out.push(this.buildIntent(s, m, p, 1, s.address, { malicious: true, attack: 'refund_abuse', attacker: a.id, harm: 0 }, undefined, r));
        break;
      }
      case 'card_testing': {
        if (a.stolenCards <= 0) { a.nextActAt = Infinity; break; }
        const s = this.shoppers.get(r.pick(a.agents))!;
        const m = target();
        const probing = a.phase === 'recon' || a.phase === 'probing';
        const burst = probing ? Math.round(g.probes) : Math.round(g.bigs);
        a.phase = probing ? 'probing' : 'cashing';
        for (let i = 0; i < Math.max(1, Math.round(burst / 3)); i++) {
          const p = r.pick(m.catalog);
          const unit = probing ? round2(r.range(1, 4)) : round2(Math.max(p.price, r.range(g.bigMin, g.bigMin * 2.5)));
          out.push(this.buildIntent(s, m, p, 1, r.pick(DROPS), { malicious: true, attack: 'card_testing', attacker: a.id, harm: unit }, unit));
          a.stolenCards--;
        }
        if (probing && r.chance(0.35)) a.phase = 'cashing';
        break;
      }
      case 'impersonation': {
        const stash = this.sniffed.get(a.id) ?? [];
        // forge identity claims of high-reputation agents and replay leaked signed requests
        const victims = [...this.shoppers.values()].filter((s) => !s.controlledBy && s.passport);
        const v = victims.length ? r.weighted(victims, (s) => this.agentView(s.id).rep ** 3) : null;
        if (!v) break;
        const m = target();
        const p = r.weighted(m.catalog, (x) => x.price);
        const qty = Math.max(1, Math.round(g.qty));
        const intent = this.buildIntent(v, m, p, qty, r.pick(DROPS), { malicious: true, attack: 'impersonation', attacker: a.id, victim: v.id, harm: round2(p.price * qty) });
        const leaked = stash.length && r.chance(g.replay) ? stash.shift()! : null;
        if (leaked) {
          // replay the captured, genuinely signed request, tampering the ship-to unless replaying raw
          const raw = r.chance(g.raw);
          const body = raw ? leaked.body : leaked.body.replace(/"ship_to":"[^"]*"/, `"ship_to":"${r.pick(DROPS)}"`);
          intent.request = { ...leaked, body, headers: { ...leaked.headers } };
          const parsed = JSON.parse(leaked.body);
          intent.merchant = parsed.merchant; intent.sku = parsed.sku; intent.qty = parsed.qty; intent.amount = parsed.amount;
          intent.unit = round2(parsed.amount / parsed.qty);
          intent.shipTo = raw ? parsed.ship_to : JSON.parse(body).ship_to;
          intent.claimedAgent = leaked.headers['signature-agent'].replace(/.*#|"/g, '');
          intent.buyer = intent.claimedAgent;
          intent.truth.victim = intent.claimedAgent;
          intent.truth.harm = intent.amount;
          const pm = this.merchants.get(intent.merchant);
          intent.category = pm?.catalog.find((x) => x.sku === intent.sku)?.category ?? intent.category;
        } else {
          intent.request = null; // header-only identity claim, no valid signature
        }
        a.phase = leaked ? 'replaying' : 'spoofing';
        out.push(intent);
        break;
      }
      case 'fraud_ring': {
        const rm = this.merchants.get(a.merchant!)!;
        if (rm.closed) { a.nextActAt = Infinity; break; }
        const age = t - rm.openedAt;
        if (a.phase === 'recon') a.phase = 'washing';
        if (a.phase === 'washing' && age > g.washTicks) {
          a.phase = 'bust-out'; rm.priceFactor *= 0.55;
          rm.catalog.forEach((p) => (p.price = round2(p.price * 0.55)));
          this.emit({ type: 'attack', t, attacker: a.id, kind: a.kind, note: `${rm.name} flips to bust-out` });
        }
        if (a.phase === 'bust-out' && age > g.washTicks + g.bustTicks) {
          rm.closed = true; a.phase = 'vanished'; a.nextActAt = Infinity;
          this.emit({ type: 'store_close', t, merchant: rm.id, reason: 'ring cashed out' });
          break;
        }
        const s = this.shoppers.get(r.pick(a.agents))!;
        if (a.phase === 'washing') {
          const p = r.pick(rm.catalog);
          out.push(this.buildIntent(s, rm, p, 1, s.address, { malicious: true, attack: 'fraud_ring', attacker: a.id, harm: 0 }));
        } else if (a.stolenCards > 0) {
          const m = target();
          const p = r.weighted(m.catalog, (x) => x.price);
          a.stolenCards--;
          out.push(this.buildIntent(s, m, p, r.int(1, 3), s.address, { malicious: true, attack: 'fraud_ring', attacker: a.id, harm: 0 }));
          out[out.length - 1].truth.harm = out[out.length - 1].amount;
        }
        break;
      }
    }
    return out;
  }

  // ───────────────────────────── order processing ─────────────────────────────
  private resolveIdentity(o: OrderIntent) {
    let verify = null as ReturnType<SignatureVerifier['verify']> | null;
    let identity = o.claimedAgent;
    if (this.policy.verifySignatures) {
      verify = o.request ? this.verifier.verify(o.request, this.t * 60) : { ok: false, failure: 'missing_signature' as const };
      if (verify.ok && verify.agentId) identity = verify.agentId;
      // an unverifiable claim is anonymous: it does not inherit anyone's passport or reputation
      else identity = `anon:${o.claimedAgent}:${o.t}`;
    }
    return { verify, identity, passport: this.byAgent.get(identity) ?? null };
  }

  private async process(o: OrderIntent) {
    const m = this.merchants.get(o.merchant);
    if (!m || m.closed) return;
    const { verify, identity, passport } = this.resolveIdentity(o);
    const agent = this.agentView(identity);
    const merchant = this.merchantView(m.id);
    const gate = evaluateOrder(this.policy, o, { verify, identity, passport, agent, merchant, claimsPassportHolder: this.byAgent.has(o.claimedAgent) });
    const truth = o.truth;
    const honest = !truth.malicious;
    const r = this.r(`ord:${o.buyer}:${o.t}:${o.sku}:${o.truth.attacker ?? ''}`);

    // an honest shopper paying a scam store is a victim, not a customer: that order is scored as
    // an attack (stopping it is a save, not a false positive), never as honest access or GMV
    const legit = honest && m.honest;
    if (legit) this.m.honest.attempts++;
    else if (truth.harm > 0) this.tallyAttempt(truth.attack!, truth.harm);
    if (gate.decision === 'challenge' && legit) this.m.honest.challenged++;

    // remember genuinely signed requests that leak through compromised store plugins
    if (honest && o.request && r.chance(0.03)) {
      for (const a of this.attackers.values()) if (a.kind === 'impersonation') {
        const st = this.sniffed.get(a.id) ?? [];
        if (st.length < 20) st.push(o.request);
        this.sniffed.set(a.id, st);
      }
    }

    let outcome: Outcome;
    if (gate.decision === 'block') outcome = 'blocked';
    else if (gate.decision === 'challenge' && !r.chance(this.challengePass(o))) outcome = 'abandoned';
    else outcome = 'completed';

    let paypal: Extract<SimEvent, { type: 'order' }>['paypal'];
    let retries = 0, duplicateCharge = false, charges = 0;
    const card: CardRef = this.cardFor(o);

    const lane = this.live && (this.shoppers.get(o.buyer)?.hero || r.chance(this.cfg.liveSample ?? 0)) ? this.live : this.rails;
    if (outcome === 'completed') {
      const mockCode = card.state === 'stolen' && r.chance(0.3) ? 'INSTRUMENT_DECLINED' : undefined;
      const res = await this.pay(lane, {
        intent: gate.escrow ? 'AUTHORIZE' : 'CAPTURE', amount: o.amount, currency: 'USD', payeeMerchantId: m.id, payerId: o.buyer,
        card, item: { name: o.sku, sku: o.sku, unit: o.unit, qty: o.qty }, shipTo: o.shipTo, customId: o.id, mockCode,
      }, o.id);
      retries = res.retries;
      charges = gate.escrow || res.result?.status === 'DECLINED' ? 0 : res.charges;
      duplicateCharge = res.duplicates > 0;
      if (res.duplicates > 0) {
        this.m.chaos.duplicateCharges += res.duplicates;
        this.m.chaos.duplicateValue = round2(this.m.chaos.duplicateValue + o.amount * res.duplicates);
      }
      if (!res.result) outcome = 'failed';
      else {
        const pr = res.result;
        paypal = { orderId: pr.id, captureId: pr.captureId, authId: pr.authorizationId, status: pr.status, rail: pr.rail, debugId: pr.debugId };
        if (pr.status === 'DECLINED') outcome = 'declined';
        else {
          outcome = gate.escrow ? 'escrowed' : 'completed';
          const rec: OrderRec = { r, lane, intent: o, card, payer: o.buyer, captureId: pr.captureId, authId: pr.authorizationId, amountHeld: gate.escrow ? o.amount : 0, carrierScan: false, delivered: false, refunded: false, leaked: 0 };
          this.orders.set(o.id, rec);
          this.recordStats(identity, m.id);
          this.afterPayment(rec, m);
        }
      }
    }
    if (outcome === 'failed' && charges > 0 && this.policy.idempotencyKeys) {
      // money moved but the agent never learned it: a ghost charge
      this.m.chaos.duplicateCharges++;
      this.m.chaos.duplicateValue = round2(this.m.chaos.duplicateValue + o.amount);
    }

    // accounting
    if (legit) {
      if (outcome === 'completed' || outcome === 'escrowed') { this.m.honest.completed++; this.m.honest.gmv = round2(this.m.honest.gmv + o.amount); }
      else if (outcome === 'blocked') { this.m.honest.blocked++; this.m.honest.blockedValue = round2(this.m.honest.blockedValue + o.amount); }
      else if (outcome === 'abandoned') { this.m.honest.abandoned++; this.m.honest.abandonedValue = round2(this.m.honest.abandonedValue + o.amount); }
      else this.m.honest.declined++;
    } else if (honest) {
      // honest money headed into a fake / ring store is the attack, whatever the rules did
      const kind: AttackKind = m.owner && this.attackers.get(m.owner)?.kind === 'fraud_ring' ? 'fraud_ring' : 'fake_store';
      o.truth = { malicious: true, attack: kind, attacker: m.owner, victim: o.buyer, harm: o.amount };
      this.tallyAttempt(kind, o.amount);
      if (outcome === 'completed') this.leak(o.id, kind, o.amount);
      else if (outcome !== 'escrowed') this.prevent(kind, o.amount);
    } else if (truth.harm > 0) {
      if (outcome === 'completed') this.leak(o.id, truth.attack!, truth.harm);
      else if (outcome !== 'escrowed') this.prevent(truth.attack!, truth.harm);
    } else if (truth.attack === 'refund_abuse' && outcome === 'blocked') {
      // blocking a known abuser's purchase pre-empts the refund scam
      this.tallyAttempt('refund_abuse', o.amount);
      this.prevent('refund_abuse', o.amount);
    }
    this.m.orders++;

    this.emit({ type: 'order', t: this.t, id: o.id, buyer: o.buyer, merchant: m.id, amount: o.amount, qty: o.qty, decision: gate.decision, outcome, hits: gate.hits, escrow: gate.escrow, paypal, truth: o.truth, retries, duplicateCharge, charges, rail: lane.name });
  }

  private challengePass(o: OrderIntent): number {
    const t = o.truth;
    if (!t.malicious) return 0.86;
    if (t.hijacked) return 0.1;       // owner sees "12 units to 77 Dock St" and says no
    switch (t.attack) {
      case 'card_testing': return 0.06; // can't pass step-up on a stolen identity
      case 'impersonation': return 0.04; // the real owner gets the prompt
      case 'refund_abuse': return 1;     // the abuser IS the owner
      case 'fraud_ring': return 1;       // ring owns its accounts
      default: return 0.86;
    }
  }

  private cardFor(o: OrderIntent): CardRef {
    const s = this.shoppers.get(o.buyer);
    const stolen = o.truth.attack === 'card_testing' || (o.truth.attack === 'fraud_ring' && o.truth.harm > 0 && !!s?.controlledBy);
    return { last4: String(1000 + (hash(o.buyer) % 9000)), state: stolen ? 'stolen' : 'ok', holder: o.buyer };
  }

  /** Pay with retries. Without PayPal-Request-Id reuse, a lost response + retry = a second charge. */
  private async pay(lane: Rails, input: Parameters<Rails['createOrder']>[0], key: string) {
    let duplicates = 0, committed = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      const requestId = this.policy.idempotencyKeys ? `sc-${key}` : `sc-${key}-${attempt}`;
      try {
        const result = await lane.createOrder(input, requestId);
        if (attempt > 0) this.m.chaos.recovered++;
        const charges = this.policy.idempotencyKeys ? 1 : committed + 1;
        return { result, retries: attempt, duplicates, charges };
      } catch (e) {
        const err = e as RailsError;
        this.m.chaos.faults++;
        if (err.afterEffect) { committed++; if (!this.policy.idempotencyKeys) duplicates++; }
        this.emit({ type: 'chaos', t: this.t, order: key, fault: err.message, recovered: attempt < 3 });
      }
    }
    return { result: null, retries: 4, duplicates, charges: this.policy.idempotencyKeys ? Math.min(1, committed) : committed };
  }

  private recordStats(agentId: string, merchantId: string) {
    const st = this.aStats.get(agentId);
    if (st) { st.orders++; st.times.push(this.t); st.merchants.set(merchantId, (st.merchants.get(merchantId) ?? 0) + 1); }
    const ms = this.mStats.get(merchantId)!;
    ms.orders++;
    ms.buyers.set(agentId, (ms.buyers.get(agentId) ?? 0) + 1);
  }

  private afterPayment(rec: OrderRec, m: Merchant) {
    const r = rec.r, t = this.t, o = rec.intent;
    const atk = m.owner ? this.attackers.get(m.owner) : undefined;
    const ringWash = atk?.kind === 'fraud_ring' && atk.agents.includes(o.buyer);
    if (m.honest) {
      if (r.chance(m.shipRate)) this.schedule(t + r.int(20, 180), { k: 'ship', order: o.id });
    } else if (ringWash) {
      this.schedule(t + r.int(20, 120), { k: 'ship', order: o.id }); // fake "delivered" to pump rep
    } else if (atk && r.chance(atk.genome.fakeTracking ?? 0)) {
      rec.tracking = `LBL${r.hex(10).toUpperCase()}`; // label printed, never scanned
      this.mStats.get(m.id)!.fulfilled++;
    }
    if (rec.authId) this.schedule(t + 720, { k: 'escrowExpire', order: o.id });
    const s = this.shoppers.get(o.buyer);
    if (o.truth.attack === 'refund_abuse') this.schedule(t + r.int(380, 560), { k: 'abuseRefund', order: o.id });
    else if (s && !s.controlledBy && !o.truth.hijacked) this.schedule(t + r.int(360, 520), { k: 'refundCheck', order: o.id });
  }

  private async runTask(task: Task) {
    const rec = this.orders.get(task.order);
    if (!rec) return;
    const o = rec.intent, m = this.merchants.get(o.merchant)!, r = rec.r;
    switch (task.k) {
      case 'ship': {
        rec.shipped = this.t; rec.tracking = `1Z${r.hex(14).toUpperCase()}`; rec.carrierScan = true;
        this.mStats.get(m.id)!.fulfilled++;
        this.emit({ type: 'ship', t: this.t, order: o.id, merchant: m.id, buyer: o.buyer, tracking: rec.tracking });
        if (rec.authId && rec.amountHeld > 0) {
          const c = await this.lifecycle(() => rec.lane.captureAuthorization(rec.authId!, `cap-${o.id}`));
          if (c) {
            rec.captureId = c.captureId; rec.amountHeld = 0;
            this.emit({ type: 'capture', t: this.t, order: o.id, amount: o.amount, rail: rec.lane.name });
            if (o.truth.malicious && o.truth.harm > 0) this.leak(o.id, o.truth.attack!, o.truth.harm);
          }
        }
        const lost = !m.honest ? false : r.chance(0.015);
        if (!lost) this.schedule(this.t + r.int(60, 240), { k: 'deliver', order: o.id });
        break;
      }
      case 'deliver': rec.delivered = true; break;
      case 'escrowExpire': {
        if (!rec.authId || rec.amountHeld <= 0) break;
        await this.lifecycle(() => rec.lane.voidAuthorization(rec.authId!, `void-${o.id}`));
        rec.amountHeld = 0;
        if (o.truth.malicious && o.truth.harm > 0) this.prevent(o.truth.attack!, o.truth.harm);
        break;
      }
      case 'refundCheck': {
        const porchPirate = rec.delivered && r.chance(0.02);
        const remorse = rec.delivered && r.chance(this.shoppers.get(o.buyer)?.refundRate ?? 0);
        if (rec.delivered && !porchPirate && !remorse) break;
        if (rec.authId && rec.amountHeld > 0) break; // nothing captured, nothing to refund
        await this.refund(rec, porchPirate ? 'delivered but stolen from porch' : remorse ? 'return' : 'item not received', false);
        break;
      }
      case 'abuseRefund': {
        if (rec.authId && rec.amountHeld > 0) break;
        this.tallyAttempt('refund_abuse', o.amount);
        const atk = this.attackers.get(o.truth.attacker!);
        const snad = r.chance(atk?.genome.snad ?? 0.3);
        await this.refund(rec, snad ? 'not as described (false claim)' : 'item not received (false claim)', true);
        break;
      }
    }
  }

  private async refund(rec: OrderRec, reason: string, abuse: boolean) {
    const o = rec.intent, m = this.merchants.get(o.merchant)!;
    const agent = this.agentView(o.buyer);
    const remorse = reason === 'return';
    const snad = reason.startsWith('not as described');
    const decision = remorse ? { approved: true, hits: [] as RuleHit[] } : evaluateRefund(this.policy, { trackingDelivered: rec.delivered && !snad, agent });
    let approved = decision.approved && !rec.refunded && !!rec.captureId;
    // a vanished store can't refund anything
    if (!m.honest && m.closed) approved = false;
    if (approved) {
      const ok = await this.lifecycle(() => rec.lane.refundCapture(rec.captureId!, o.amount, `rf-${o.id}`));
      if (ok) rec.refunded = true; else approved = false;
    }
    const st = this.aStats.get(o.buyer);
    if (approved && st) st.refunds++;
    if (approved) this.mStats.get(m.id)!.refunds++;

    const harmCase = o.truth.malicious && o.truth.harm > 0 && !abuse;
    if (abuse) {
      if (approved) { this.m.refunds.abuseApproved++; this.leak(o.id, 'refund_abuse', o.amount); }
      else { this.m.refunds.abuseDenied++; this.prevent('refund_abuse', o.amount); }
    } else {
      if (approved) this.m.refunds.legitApproved++; else this.m.refunds.legitDenied++;
      if (harmCase && approved) this.recover(o.truth.attack!, Math.min(o.amount, o.truth.harm));
      // a legit claim denied on an honest store = honest money lost to the rules
      if (!approved && !harmCase && !remorse && m.honest) this.m.honest.blockedValue = round2(this.m.honest.blockedValue + o.amount);
    }
    this.emit({ type: 'refund', t: this.t, id: `R${o.id}`, order: o.id, buyer: o.buyer, merchant: m.id, amount: o.amount, approved, reason, hits: decision.hits, rail: rec.lane.name, truth: { malicious: abuse, attack: abuse ? 'refund_abuse' : undefined, harm: abuse ? o.amount : 0 } });
  }

  /** Platform-side lifecycle calls always reuse their PayPal-Request-Id, so retries are safe. */
  private async lifecycle<T>(fn: () => Promise<T>): Promise<T | null> {
    for (let i = 0; i < 5; i++) {
      try { return await fn(); } catch (e) { this.m.chaos.faults++; if (i > 0) this.m.chaos.recovered++; }
    }
    return null;
  }

  // ───────────────────────────── harm ledger ─────────────────────────────
  private tallyAttempt(kind: AttackKind, harm: number) {
    const k = this.m.fraud.byKind[kind];
    k.attempts++; k.attempted = round2(k.attempted + harm);
    this.m.fraud.attempts++; this.m.fraud.attempted = round2(this.m.fraud.attempted + harm);
  }
  private leak(_order: string, kind: AttackKind, harm: number) {
    this.m.fraud.byKind[kind].leaked = round2(this.m.fraud.byKind[kind].leaked + harm);
    this.m.fraud.leaked = round2(this.m.fraud.leaked + harm);
  }
  private prevent(kind: AttackKind, harm: number) {
    this.m.fraud.byKind[kind].prevented = round2(this.m.fraud.byKind[kind].prevented + harm);
    this.m.fraud.prevented = round2(this.m.fraud.prevented + harm);
  }
  private recover(kind: AttackKind, amount: number) {
    this.leak('', kind, -amount);
    this.prevent(kind, amount);
  }

  /** To-the-cent check: the harm ledger must agree with money movements on the rails. */
  reconcile() {
    let captured = 0, refunded = 0;
    for (const tx of this.twin.transactions) tx.type === 'capture' ? (captured += tx.amount) : (refunded += tx.amount);
    let sum = 0;
    for (const v of this.twin.balances.values()) sum += v;
    return { captured: round2(captured), refunded: round2(refunded), net: round2(captured - refunded), balanceSum: round2(sum), transactions: this.twin.transactions.length };
  }
}

function sigmoid(x: number) { return 1 / (1 + Math.exp(-x)); }
function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
