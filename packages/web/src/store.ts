import { create } from 'zustand';
import type { Metrics, Policy } from '@sandbox-city/core';
import { PRESETS } from '@sandbox-city/core';
import type { DaySummary, ForgeScore, Genomes, Policy as PolicyT, TunePoint, WorldSnapshot } from '@sandbox-city/core';

export type CutInKind = 'attack' | 'blocked' | 'breach' | 'double' | 'sale' | 'falsepos' | 'replay' | 'escrow';
export interface CutIn { id: number; kind: CutInKind; lane: number; title: string; tag: string; code: string; line: string; sub?: string; amount?: number; who?: string }
/** One line of the gate's decision trace, as the cinema terminal prints it. */
export interface TraceLine { id: number; t: number; lane: number; verdict: 'ALLOW' | 'GRANT' | 'DENY' | 'HOLD' | 'DUP×2' | 'FALSE+' | 'INJECT' | 'REFUND'; text: string; note?: string }
export interface FeedItem { id: number; t: number; lane: number; tone: 'attack' | 'good' | 'bad' | 'warn' | 'info'; text: string }

export interface PayPalCall { id: number; method: string; path: string; status: number; ms: number; debugId?: string; requestId?: string }

export interface TuneState {
  open: boolean; running: boolean; mode: 'safe' | 'value';
  points: TunePoint[]; best: { policy: PolicyT; mean: DaySummary } | null;
  evals: number; total: number; generation: number; ms: number | null;
  /** Safety floor actually used, when it differs from the mode's default. */
  floor?: number; trainDays?: number;
}
export const emptyTune = (mode: TuneState['mode'] = 'safe'): TuneState => ({ open: false, running: false, mode, points: [], best: null, evals: 0, total: 0, generation: 0, ms: null });

export interface ForgeState {
  open: boolean; running: boolean; target: PolicyT | null;
  curve: { evals: number; best: number; candidate: number }[];
  best: ForgeScore | null; baseline: ForgeScore | null; evals: number; total: number; ms: number | null;
}
export const emptyForge = (): ForgeState => ({ open: false, running: false, target: null, curve: [], best: null, baseline: null, evals: 0, total: 0, ms: null });

export interface TitleCard { id: number; cmd: string; act?: string; title: string; sub?: string; big?: boolean }
export interface CinemaState { on: boolean; rolling: boolean; card: TitleCard | null; act: string }

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
  trace: TraceLine[];
  showReport: boolean;
  paypal: 'twin' | 'sandbox';
  runId: string | null;
  paypalCalls: PayPalCall[];
  /** Requests to the real PayPal sandbox that have not answered yet. */
  inFlight: { method: string; path: string; at: number }[];
  tune: TuneState;
  cinema: CinemaState;
  forge: ForgeState;
  /** Attacker tactics in this city: null = the stock attackers, otherwise a forged set. */
  genomes: Genomes | null;
  whatif: { mine: DaySummary[]; alternatives: DaySummary[] } | 'pending' | null;
  pushCall: (c: Omit<PayPalCall, 'id'>) => void;
  set: (p: Partial<State>) => void;
  setLane: (lane: number, p: Partial<LaneState>) => void;
  pushCutIn: (c: Omit<CutIn, 'id'>) => void;
  popCutIn: () => void;
  pushFeed: (f: Omit<FeedItem, 'id'>[]) => void;
  pushTrace: (t: Omit<TraceLine, 'id'>[]) => void;
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
  trace: [],
  showReport: false,
  paypal: 'twin',
  runId: null,
  paypalCalls: [],
  inFlight: [],
  whatif: null,
  tune: emptyTune(),
  forge: emptyForge(),
  genomes: null,
  cinema: { on: typeof location !== 'undefined' && (new URLSearchParams(location.search).get('cinema') === '1' || /^#(cinema|film|act[1-5])$/.test(location.hash)), rolling: false, card: null, act: '' },
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
  pushTrace: (t) => set({ trace: [...t.map((x) => ({ ...x, id: nid++ })), ...get().trace].slice(0, 9) }),
  pushFeed: (f) => set({ feed: [...f.map((x) => ({ ...x, id: nid++ })), ...get().feed].slice(0, 60) }),
}));

export const resetLanes = (n: number) => useStore.setState({ lanes: Array.from({ length: n }, emptyLane), cutins: [], feed: [], trace: [], showReport: false });
