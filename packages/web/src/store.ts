import { create } from 'zustand';
import type { Metrics, Policy } from '@sandbox-city/core';
import { PRESETS } from '@sandbox-city/core';
import type { WorldSnapshot } from '@sandbox-city/core';

export type CutInKind = 'attack' | 'blocked' | 'breach' | 'double' | 'sale' | 'falsepos' | 'replay' | 'escrow';
export interface CutIn { id: number; kind: CutInKind; lane: number; title: string; kanji: string; line: string; sub?: string; amount?: number; who?: string }
export interface FeedItem { id: number; t: number; lane: number; tone: 'attack' | 'good' | 'bad' | 'warn' | 'info'; text: string }

export interface PayPalCall { id: number; method: string; path: string; status: number; ms: number; debugId?: string; requestId?: string }

interface LaneState { world: WorldSnapshot | null; metrics: Metrics | null; t: number; done: boolean; sale: boolean; phases: Record<string, string>; history: { t: number; safety: number; access: number; net: number }[] }

interface State {
  seed: string;
  chaos: number;
  policies: Policy[];
  lanes: LaneState[];
  running: boolean;
  tps: number;
  xray: boolean;
  cutins: CutIn[];
  feed: FeedItem[];
  showReport: boolean;
  paypal: 'twin' | 'sandbox';
  runId: string | null;
  paypalCalls: PayPalCall[];
  pushCall: (c: Omit<PayPalCall, 'id'>) => void;
  set: (p: Partial<State>) => void;
  setLane: (lane: number, p: Partial<LaneState>) => void;
  pushCutIn: (c: Omit<CutIn, 'id'>) => void;
  popCutIn: () => void;
  pushFeed: (f: Omit<FeedItem, 'id'>[]) => void;
}

let nid = 1;
const emptyLane = (): LaneState => ({ world: null, metrics: null, t: 0, done: false, sale: false, phases: {}, history: [] });

export const useStore = create<State>((set, get) => ({
  seed: 'neo-osaka-7',
  chaos: 0.04,
  policies: [PRESETS.open],
  lanes: [emptyLane()],
  running: false,
  tps: 8,
  xray: true,
  cutins: [],
  feed: [],
  showReport: false,
  paypal: 'twin',
  runId: null,
  paypalCalls: [],
  pushCall: (c) => set({ paypalCalls: [{ ...c, id: nid++ }, ...get().paypalCalls].slice(0, 40) }),
  set: (p) => set(p),
  setLane: (lane, p) => {
    const lanes = get().lanes.slice();
    lanes[lane] = { ...(lanes[lane] ?? emptyLane()), ...p };
    set({ lanes });
  },
  pushCutIn: (c) => {
    const q = get().cutins;
    if (q.length >= 3) return;
    set({ cutins: [...q, { ...c, id: nid++ }] });
  },
  popCutIn: () => set({ cutins: get().cutins.slice(1) }),
  pushFeed: (f) => set({ feed: [...f.map((x) => ({ ...x, id: nid++ })), ...get().feed].slice(0, 60) }),
}));

export const resetLanes = (n: number) => useStore.setState({ lanes: Array.from({ length: n }, emptyLane), cutins: [], feed: [], showReport: false });
