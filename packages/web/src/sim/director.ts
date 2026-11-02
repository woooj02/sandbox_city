/**
 * Cinema director: plays the whole story as one continuous, recordable take.
 *   I    Wild West: a day with no rules
 *   II   Auto-tune: rulebooks evolve on days the city has not seen
 *   III  The race: Wild West vs the tuned rulebook on the same day, split screen
 *   IV   The reckoning: end-of-day report, what-if replays, PayPal reconciliation
 * The camera work lives in the renderer; this file decides pacing, chapter cards and bullet time.
 */
import { PRESETS, type Metrics, type Policy } from '@sandbox-city/core';
import type { Moment } from '../city/CityRenderer';
import { useStore, type TitleCard } from '../store';
import { client } from './client';
import { startTune } from '../components/AutoTune';
import { startForge } from '../components/Forge';

const FILM_TPS = 22;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

let cardId = 1;
class Director {
  private take = 0;
  private slowUntil = 0;
  private baseTps = FILM_TPS;
  /** The rulebook act II found, reused by act V when the film runs on. */
  private lastBest: Policy | null = null;

  private get st() { return useStore.getState(); }
  private alive(take: number) { return take === this.take && this.st.cinema.rolling; }
  private patch(p: Partial<ReturnType<typeof useStore.getState>['cinema']>) { useStore.setState({ cinema: { ...this.st.cinema, ...p } }); }

  private async card(take: number, c: Omit<TitleCard, 'id'>, ms: number) {
    if (!this.alive(take)) return;
    this.patch({ card: { ...c, id: cardId++ } });
    await sleep(ms);
    if (this.alive(take)) this.patch({ card: null });
    await sleep(500);
  }
  private async until(take: number, pred: () => boolean, maxMs = Infinity) {
    const end = performance.now() + maxMs;
    while (this.alive(take) && !pred() && performance.now() < end) await sleep(120);
  }
  /** Slow, eased scroll through a panel, so the whole report reads on camera. */
  private pan(take: number, sel: string, ms: number) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return Promise.resolve();
    const from = el.scrollTop, to = el.scrollHeight - el.clientHeight;
    if (to <= from) return Promise.resolve();
    const t0 = performance.now();
    return new Promise<void>((done) => {
      const step = () => {
        const u = Math.min(1, (performance.now() - t0) / ms);
        el.scrollTop = from + (to - from) * (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2);
        if (u < 1 && this.alive(take)) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
  }
  private speed(tps: number) { client.send({ cmd: 'speed', tps }); }

  /** Bullet time: the sim itself slows down for a beat when the camera cuts to something big. */
  moment(lane: number, m: Moment) {
    if (!this.st.cinema.rolling || lane !== 0 || m.weight < 7) return;
    const now = performance.now();
    if (now < this.slowUntil + 2500) return;
    this.slowUntil = now + 1400;
    this.speed(Math.max(3, Math.round(this.baseTps * 0.18)));
    setTimeout(() => { if (this.st.cinema.rolling) this.speed(this.baseTps); }, 1400);
  }

  stop() {
    this.take++;
    this.patch({ rolling: false, card: null, act: '' });
  }

  /** Plays a day at full speed off camera, so a later act can start from the same state. */
  private async silentDay(take: number, lanes: Policy[]) {
    client.start(lanes);
    this.speed(100000);
    client.send({ cmd: 'play' });
    await this.until(take, () => this.done());
  }
  private done() { return this.st.lanes.length > 0 && this.st.lanes.every((l) => l.done); }

  /** Roll the film; `from` starts at a later act so a single scene can be re-shot. */
  async roll(from = 1) {
    const take = ++this.take;
    this.patch({ rolling: true, card: null, act: '' });
    useStore.setState({ showReport: false, tune: { ...this.st.tune, open: false }, forge: { ...this.st.forge, open: false } });
    if (from >= 5) return this.adapt(take);
    useStore.setState({ genomes: null });
    let best: Policy = PRESETS.tuned;

    if (from <= 1) {
      // ── cold open, then act I
      client.start([PRESETS.open]);
      this.speed(4);
      await sleep(400);
      client.send({ cmd: 'play' });
      const w = this.st.lanes[0]?.world;
      const live = this.st.paypal === 'sandbox';
      const boot = w ? [
        `[ ok ] city loaded · 6 districts · ${w.merchants.length} stores · ${w.shoppers.length} shopper agents`,
        `[ ok ] ${w.attackers.length} attacker crews online · 6 attack families`,
        `[ ok ] rails: ${live ? 'PayPal sandbox, live orders v2' : 'PayPal twin, orders v2 contract'}`,
        '[warn] gate rulebook: none',
      ] : undefined;
      await this.card(take, { lines: boot, cmd: 'ssh gate@sandbox.city --rails=paypal', title: 'SANDBOX CITY', sub: 'AI shoppers, AI stores and AI attackers, all paying on PayPal rails', big: true }, 5600);
      this.patch({ act: 'I · WILD WEST' });
      await this.card(take, { cmd: 'gate --rules=none --day=1', act: 'ACT I', title: 'THE WILD WEST', sub: 'one day in the city with no rules at the gate' }, 3600);
      this.baseTps = FILM_TPS; this.speed(this.baseTps);
      await this.until(take, () => this.done());
      if (!this.alive(take)) return;
      useStore.setState({ showReport: false });
      const m1 = this.st.lanes[0].metrics as Metrics;
      await sleep(600);
      await this.card(take, {
        cmd: 'ledger --audit --day=1', act: 'END OF DAY', title: `${money(m1.fraud.leaked + m1.chaos.duplicateValue)} LOST`,
        sub: `${money(m1.fraud.leaked)} stolen · ${m1.chaos.duplicateCharges} customers charged twice · ${(m1.safety * 100).toFixed(0)}% of fraud stopped`,
      }, 4200);
    } else if (from === 2) await this.silentDay(take, [PRESETS.open]);

    if (from <= 2) {
      // ── act II
      this.patch({ act: 'II · AUTO-TUNE' });
      await this.card(take, { cmd: 'tune --search=evolve --holdout=today', act: 'ACT II', title: 'THE MACHINE LEARNS', sub: 'rulebooks evolve on two days this city has never seen' }, 3600);
      if (!this.alive(take)) return;
      startTune('safe', { generations: 4, children: 8 });
      await this.until(take, () => !this.st.tune.running);
      await sleep(3500);
      best = this.st.tune.best?.policy ?? best;
      this.lastBest = best;
      useStore.setState({ tune: { ...this.st.tune, open: false } });
      if (!this.alive(take)) return;
    }

    const tuned = { ...best, name: 'Lab-Tuned' };
    if (from <= 3) {
      // ── act III
      this.patch({ act: 'III · THE RACE' });
      client.start([PRESETS.open, tuned]);
      this.speed(4);
      await sleep(400);
      client.send({ cmd: 'play' });
      await this.card(take, { cmd: 'fork --left=wild-west --right=lab-tuned', act: 'ACT III', title: 'SAME DAY. TWO RULEBOOKS.', sub: `Wild West on the left · ${tuned.name} on the right` }, 3600);
      this.baseTps = FILM_TPS; this.speed(this.baseTps);
      await this.until(take, () => this.done());
      if (!this.alive(take)) return;
      useStore.setState({ showReport: false });
      await sleep(800);
    } else await this.silentDay(take, [PRESETS.open, tuned]);

    // ── act IV
    if (!this.alive(take)) return;
    this.patch({ act: 'IV · THE RECKONING' });
    const [a, b] = this.st.lanes.map((l) => l.metrics as Metrics);
    await this.card(take, { cmd: 'reconcile --whatif --all-rulebooks', act: 'ACT IV', title: 'THE RECKONING', sub: `${money(b.netValue - a.netValue)} more value for honest people, on a day the rulebook never trained on` }, 3600);
    await this.report(take);
    await this.endCard(take);
  }

  private async report(take: number) {
    if (!this.alive(take)) return;
    useStore.setState({ showReport: true });
    await this.until(take, () => this.st.whatif !== 'pending', 30_000);
    await sleep(3500);
    await this.pan(take, '.report', 7000);
    await sleep(6000);
    if (this.alive(take)) useStore.setState({ showReport: false });
  }
  private async endCard(take: number) {
    await this.card(take, { cmd: 'exit 0', title: 'SANDBOX CITY', sub: 'crash-test every rule before a single real cent moves', big: true }, 6000);
    if (this.alive(take)) this.patch({ rolling: false, act: '' });
  }

  /** Act V: the red team evolves against the tuned rulebook, then the rulebook is re-tuned against them. */
  private async adapt(take: number) {
    const target: Policy = { ...(this.lastBest ?? PRESETS.tuned), name: 'Lab-Tuned' };
    useStore.setState({ genomes: null });
    client.start([target]);
    this.baseTps = 8; this.speed(8);
    await sleep(400);
    client.send({ cmd: 'play' });
    this.patch({ act: 'V · THE ATTACKERS ADAPT' });
    await this.card(take, { cmd: 'forge --target=lab-tuned --budget=fixed', act: 'ACT V', title: 'THE ATTACKERS ADAPT', sub: 'same number of attacks, tactics evolved against Lab-Tuned' }, 3800);
    if (!this.alive(take)) return;
    startForge(target, { generations: 4, children: 6 });
    await this.until(take, () => !this.st.forge.running);
    await sleep(4500);
    const f = this.st.forge;
    useStore.setState({ forge: { ...f, open: false } });
    if (!this.alive(take) || !f.best || !f.baseline) return;
    await this.card(take, {
      cmd: 'forge --report', act: 'RED TEAM', title: `${money(f.best.stolen)} STOLEN A DAY`,
      sub: `Lab-Tuned held stock attackers to ${money(f.baseline.stolen)}. The forged ones take ×${(f.best.stolen / Math.max(1, f.baseline.stolen)).toFixed(1)}.`,
    }, 4000);

    // the forged tactics become the city's; the rulebook search now trains against them
    useStore.setState({ genomes: f.best.genomes });
    client.start([target]);
    client.send({ cmd: 'play' });
    await this.card(take, { cmd: 'tune --against=forged --days=3', act: 'BLUE TEAM', title: 'RE-TUNE AGAINST THEM', sub: 'the rulebook search runs again, on three days full of forged attackers' }, 3600);
    if (!this.alive(take)) return;
    // three training days and an 80% floor: chosen on held-out days, where it beat Lab-Tuned on both value and theft
    startTune('safe', { generations: 4, children: 8, trainDays: 3, minSafety: 0.8 });
    await this.until(take, () => !this.st.tune.running);
    await sleep(3500);
    const hardened: Policy = { ...(this.st.tune.best?.policy ?? target), name: 'Hardened' };
    useStore.setState({ tune: { ...this.st.tune, open: false } });
    if (!this.alive(take)) return;

    this.patch({ act: 'V · REMATCH' });
    client.start([target, hardened]);
    this.speed(4);
    await sleep(400);
    client.send({ cmd: 'play' });
    await this.card(take, { cmd: 'fork --left=lab-tuned --right=hardened', act: 'REMATCH', title: 'FORGED ATTACKERS. TWO RULEBOOKS.', sub: 'Lab-Tuned on the left · Hardened on the right' }, 3600);
    this.baseTps = FILM_TPS; this.speed(this.baseTps);
    await this.until(take, () => this.done());
    if (!this.alive(take)) return;
    await sleep(800);
    const [a, b] = this.st.lanes.map((l) => l.metrics as Metrics);
    await this.card(take, { cmd: 'diff lab-tuned hardened', act: 'RESULT', title: b.netValue >= a.netValue ? `${money(b.netValue - a.netValue)} WON BACK` : `${money(a.netValue - b.netValue)} SHORT`, sub: `stolen ${money(a.fraud.leaked)} → ${money(b.fraud.leaked)} on a day neither rulebook trained on` }, 4200);
    await this.report(take);
    await this.endCard(take);
  }
}

export const director = new Director();
