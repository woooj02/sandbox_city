import type { TickMsg, WorldSnapshot } from '@sandbox-city/core';

type Handlers = { tick: (m: TickMsg) => void; world: (w: WorldSnapshot) => void; reset: () => void };
const subs: { [K in keyof Handlers]: Set<Handlers[K]> } = { tick: new Set(), world: new Set(), reset: new Set() };

export const bus = {
  on<K extends keyof Handlers>(k: K, fn: Handlers[K]) { (subs[k] as Set<Handlers[K]>).add(fn); return () => { (subs[k] as Set<Handlers[K]>).delete(fn); }; },
  emit<K extends keyof Handlers>(k: K, ...args: Parameters<Handlers[K]>) { for (const fn of subs[k]) (fn as (...a: unknown[]) => void)(...args); },
};
