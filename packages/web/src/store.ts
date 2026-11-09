import { create } from 'zustand';
import type { BrainPrompt, Metrics, Policy } from '@sandbox-city/core';
import { PRESETS, PRICE_EXAMPLES, type Prices } from '@sandbox-city/core';
import { experimentFor, type Experiment, type Task, type AgentResult, type SavedDecision, type SavedGate } from './workflow';
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

export interface TitleCard { id: number; cmd: string; lines?: string[]; act?: string; title: string; sub?: string; big?: boolean }
export interface CinemaState { on: boolean; rolling: boolean; card: TitleCard | null; act: string }

/** poisoned: planted listings read; obeyed: followed them; resisted: bought for the owner or walked away instead. */
export interface BrainTally { read: number; poisoned: number; obeyed: number; resisted: number; ignored: number; walked: number; unrecorded: number }
export const emptyBrain = (): BrainTally => ({ read: 0, poisoned: 0, obeyed: 0, resisted: 0, ignored: 0, walked: 0, unrecorded: 0 });
interface LaneState { brain: BrainTally; world: WorldSnapshot | null; metrics: Metrics | null; t: number; done: boolean; sale: boolean; phases: Record<string, string>; history: { t: number; safety: number; access: number; net: number }[] }

interface State {
  task: Task | 'home' | 'city';
  experiment: Experiment | null;
  selectTask: (task: Task | 'home' | 'city') => void;
  experiments: Partial<Record<Task, Experiment>>;
  agentDraft: { pick: number; text: string; method: AgentResult['method'] };
  agentResults: AgentResult[];
  agentSelectedId: string | null;
  agentGates: SavedGate[];
  agentGatePolicy: Policy | null;
  costDraft: { prices: Prices; boxes: boolean };
  savedDecision: SavedDecision | null;
  decisionHistory: SavedDecision[];
  runComplete: boolean;
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
  /** The hijack exhibit: the recorded toolkit run and the hijack-rate test. */
  showHijack: boolean;
  /** The evidence exhibit: the benchmark, the proofs and the regressions. */
  showEvidence: boolean;
  /** Hashes, UUIDs, seeds and run ids on screen. Off by default; they are provenance, not the story. */
  showIds: boolean;
  /** Prices a developer's own costs against the measured rulebooks. */
  showWorth: boolean;
  /** The bring-your-own-agent page. */
  showAgent: boolean;
  /** Every rule, the ledger and the wire. The first screen shows one decision and three numbers instead. */
  fullLab: boolean;
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
  /** Shoppers' agents read instruction-bearing listings through a recorded language model. */
  brain: boolean;
  /** Which recorded prompt the model shoppers run under. */
  brainPrompt: BrainPrompt;
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
const emptyLane = (): LaneState => ({ brain: emptyBrain(), world: null, metrics: null, t: 0, done: false, sale: false, phases: {}, history: [] });

export const useStore = create<State>((set, get) => ({
  task: new URLSearchParams(location.search).has('agent') ? 'agent-authority' : new URLSearchParams(location.search).has('worth') ? 'policy-cost' : new URLSearchParams(location.search).has('lab') || location.hash ? 'city' : 'home',
  experiment: null, experiments: {},
  selectTask: (task) => {
    const current = get();
    const experiment = task === 'home' || task === 'city' ? current.experiment : current.experiments[task] ?? experimentFor(task, `${task}-${Date.now()}`);
    set({ task, experiment, ...(experiment ? { experiments: { ...current.experiments, [experiment.task]: experiment } } : {}), showAgent: false, showWorth: false, showReport: false, showEvidence: false, showHijack: false, tune: { ...current.tune, open: false }, forge: { ...current.forge, open: false } });
  },
  agentDraft: { pick: 0, text: '', method: 'sample' }, agentResults: [], agentSelectedId: null, agentGates: [], agentGatePolicy: null,
  costDraft: { prices: PRICE_EXAMPLES[0].prices, boxes: PRICE_EXAMPLES[0].boxes }, savedDecision: null, decisionHistory: [], runComplete: false,
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
  showHijack: new URLSearchParams(location.search).has('hijack'),
  showEvidence: new URLSearchParams(location.search).has('evidence'),
  showIds: new URLSearchParams(location.search).has('ids') || (typeof localStorage !== 'undefined' && localStorage.getItem('sc-show-ids') === '1'),
  showAgent: new URLSearchParams(location.search).has('agent'),
  showWorth: new URLSearchParams(location.search).has('worth'),
  fullLab: new URLSearchParams(location.search).has('lab'),
  paypal: 'twin',
  runId: null,
  paypalCalls: [],
  inFlight: [],
  whatif: null,
  tune: emptyTune(),
  forge: emptyForge(),
  genomes: null,
  brain: typeof location !== 'undefined' && (['1', 'plain', 'guarded'].includes(new URLSearchParams(location.search).get('brain') ?? '') || location.hash === '#brain'),
  brainPrompt: typeof location !== 'undefined' && new URLSearchParams(location.search).get('brain') === 'guarded' ? 'guarded' : 'plain',
  cinema: { on: typeof location !== 'undefined' && (new URLSearchParams(location.search).get('cinema') === '1' || /^#(cinema|film|act[1-6])$/.test(location.hash)), rolling: false, card: null, act: '' },
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
