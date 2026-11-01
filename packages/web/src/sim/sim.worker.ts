/// <reference lib="webworker" />
import { SimRunner, type FromSim, type ToSim } from '@sandbox-city/core';

const runner = new SimRunner((m: FromSim) => (self as unknown as Worker).postMessage(m), { mode: 'local', crypto: 'ed25519' });
self.onmessage = (ev: MessageEvent<ToSim>) => runner.handle(ev.data);
