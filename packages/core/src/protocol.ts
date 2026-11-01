import type { AttackKind, SimEvent } from './types';
import type { Policy } from './policy';

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
  | { type: 'paypal_call'; lane: number; method: string; path: string; status: number; ms: number; debugId?: string; requestId?: string }
  | { type: 'run'; runId: string }
  | { type: 'error'; message: string };

export interface LaneSpec { policy: Policy }

export type ToSim =
  | { cmd: 'init'; seed: string; lanes: LaneSpec[]; chaos: number; shoppers?: number }
  | { cmd: 'play' }
  | { cmd: 'pause' }
  | { cmd: 'speed'; tps: number };
