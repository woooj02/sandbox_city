import type { AttackKind, SimEvent } from './types';
import type { Policy } from './policy';
import type { DaySummary } from './whatif';

export interface TunePoint { id: number; generation: number; safety: number; access: number; net: number; score: number; preset?: string }

export interface MerchantLite { id: string; name: string; x: number; y: number; district: number; honest: boolean; category: string; verified: boolean; owner?: string }
export interface ShopperLite { id: string; name: string; x: number; y: number; district: number; hero: boolean; controlledBy?: string; passport: boolean }
export interface AttackerLite { id: string; name: string; kind: AttackKind; x: number; y: number; agents: string[] }

export interface WorldSnapshot {
  lane: number;
  policy: Policy;
  ticks: number;
  merchants: MerchantLite[];
  shoppers: ShopperLite[];
  attackers: AttackerLite[];
}

export interface TickMsg { type: 'tick'; lane: number; t: number; events: SimEvent[]; spawn: MerchantLite[]; sale: boolean; attackerPhase: Record<string, string> }

export type FromSim =
  | { type: 'world'; world: WorldSnapshot }
  | TickMsg
  | { type: 'done'; lane: number }
  | { type: 'status'; running: boolean; tps: number; mode: 'local' | 'server'; paypal?: 'sandbox' | 'twin' }
  /** status 0 = request in flight; anything else = PayPal answered. */
  | { type: 'paypal_call'; lane: number; method: string; path: string; status: number; ms: number; debugId?: string; requestId?: string }
  | { type: 'run'; runId: string }
  | { type: 'whatif'; mine: DaySummary[]; alternatives: DaySummary[] }
  | { type: 'tune'; phase: 'eval'; point: TunePoint; best: { policy: Policy; mean: DaySummary }; evals: number; total: number; generation: number }
  | { type: 'tune'; phase: 'done'; best: { policy: Policy; mean: DaySummary }; evals: number; ms: number }
  | { type: 'error'; message: string };

export interface LaneSpec { policy: Policy }

export type ToSim =
  | { cmd: 'init'; seed: string; lanes: LaneSpec[]; chaos: number; shoppers?: number;
      /** Share of non-hero orders sent to the live sandbox lane; capped by the server's own setting. 0 = heroes only. */
      liveSample?: number }
  | { cmd: 'play' }
  | { cmd: 'pause' }
  | { cmd: 'speed'; tps: number }
  /** Replay the last initialised day under every preset (counterfactual savings). */
  | { cmd: 'whatif' }
  /** Search for a better rulebook on days other than the one on screen. */
  | { cmd: 'tune'; minSafety: number; minAccess: number; generations?: number; children?: number }
  | { cmd: 'tune_stop' };
