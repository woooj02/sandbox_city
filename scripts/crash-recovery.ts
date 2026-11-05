/**
 * The lost-response proof, with real processes.
 *   npx tsx scripts/crash-recovery.ts            against the local PayPal contract mock
 *   npx tsx scripts/crash-recovery.ts --sandbox  against the PayPal sandbox (needs .env keys)
 *
 * 1. A process journals its intent, captures, gets PayPal's answer and is killed with SIGKILL before it can write it down.
 * 2. Control: a client with no journal does what a retry loop does, and starts the order again.
 * 3. A new process reads the journal, asks PayPal about the order by id and finishes without paying again.
 * The receipt records which of the two it ran against. Writes packages/web/src/data/recovery-proof.json.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { buildMockPayPal, type MockPayPal } from '../packages/server/src/mock-paypal.ts';
import { PaymentJournal, PaymentWorker } from '../packages/server/src/payments.ts';
import { SandboxRails } from '../packages/server/src/paypal.ts';

const sandbox = process.argv.includes('--sandbox');
let mock: MockPayPal | undefined;
const env: NodeJS.ProcessEnv = { ...process.env };
if (sandbox) {
  if (!process.env.PAYPAL_CLIENT_ID) { console.error('--sandbox needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET'); process.exit(1); }
} else {
  mock = buildMockPayPal();
  await mock.listen({ port: 0, host: '127.0.0.1' });
  Object.assign(env, { PAYPAL_CLIENT_ID: 'mock-client', PAYPAL_CLIENT_SECRET: 'mock-secret', PAYPAL_API_BASE: `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}` });
}
const run = `crash-${Date.now().toString(36)}`, key = `${run}-order`, amount = '64.20';
const journalPath = join(mkdtempSync(join(tmpdir(), 'sc-crash-')), 'payments.log');
env.PAYPAL_RUN_ID = run;
const rails = (runId = run) => new SandboxRails({ clientId: env.PAYPAL_CLIENT_ID!, clientSecret: env.PAYPAL_CLIENT_SECRET!, base: env.PAYPAL_API_BASE, runId,
  card: env.PAYPAL_TEST_CARD ? { number: env.PAYPAL_TEST_CARD, expiry: env.PAYPAL_TEST_CARD_EXPIRY ?? '2030-12', securityCode: env.PAYPAL_TEST_CARD_CVV ?? '123' } : undefined });
const steps: { step: string; detail: string }[] = [];
const note = (step: string, detail: string) => { steps.push({ step, detail }); console.log(`${step}: ${detail}`); };

// async on purpose: this process may be hosting the mock the child is talking to
// node directly, not through npx, so the SIGKILL lands on the process that holds the journal
const child = await new Promise<{ signal: string | null; status: number | null; stderr: string }>((done) => {
  const p = spawn(process.execPath, ['--import', 'tsx', 'scripts/crash-child.ts', journalPath, key, amount, 'after-capture-response'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  p.stderr.on('data', (d) => { stderr += d; });
  p.on('close', (status, signal) => done({ signal, status, stderr }));
});
const killed = child.signal === 'SIGKILL';
const lines = readFileSync(journalPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const lastOnDisk = lines[lines.length - 1];
note('process killed', `signal ${child.signal ?? child.status}, journal stops at "${lastOnDisk.state}", order ${lastOnDisk.orderId}`);
if (!killed || lastOnDisk.state !== 'capturing') throw new Error(`the crash did not happen where it should: ${child.stderr}`);

// charges are counted by asking the payment provider, on the mock and the sandbox alike
const charged = async (ids: string[]) => { let n = 0; for (const id of ids) n += (await rails().readOrder(id))?.captureCount ?? 0; return n; };
const read = await rails().readOrder(lastOnDisk.orderId);
note(sandbox ? 'PayPal says' : 'the mock says', `order ${read?.status}, capture ${read?.captureId}: the money moved and the process never learned it`);

const worker = new PaymentWorker(rails(), new PaymentJournal(journalPath));
const before = await charged([lastOnDisk.orderId]);
const [recovered] = await worker.recover();
note('restart', `read the order back by id, state ${recovered.state}, capture ${recovered.captureId}, no new charge`);
const afterRecovery = await charged([lastOnDisk.orderId]);

// the control, on a separate run so the two stay apart: no journal, a retry loop starts the order over
const control = new PaymentWorker(rails(`${run}-retry`), new PaymentJournal(`${journalPath}.none`));
const input = lines[0].input;
const second = await control.pay(key, input);
note('control', `a client with no journal retried: new order ${second.orderId}, new capture ${second.captureId}, the buyer is charged twice`);
const afterControl = await charged([lastOnDisk.orderId, second.orderId!]);

const receipt = {
  mode: sandbox ? 'paypal-sandbox' : 'contract-mock', run, amount: Number(amount), recordedAt: new Date().toISOString(), steps,
  crash: { signal: child.signal ?? child.status, lastOnDisk: lastOnDisk.state, orderId: lastOnDisk.orderId },
  readBack: { status: read?.status, captureId: read?.captureId },
  recovered: { state: recovered.state, captureId: recovered.captureId, recovered: recovered.recovered },
  charges: { before, afterRecovery, afterControl },
  control: { orderId: second.orderId, captureId: second.captureId },
};
if (recovered.captureId !== read?.captureId) throw new Error('recovery found a different capture');
if (before !== 1 || afterRecovery !== 1 || afterControl !== 2) throw new Error(`charges were ${before}/${afterRecovery}/${afterControl}`);
// a mock run prints its result, and only a sandbox run replaces the recorded receipt
if (sandbox) writeFileSync(new URL('../packages/web/src/data/recovery-proof.json', import.meta.url), JSON.stringify(receipt, null, 2) + '\n');
console.log(`\n${receipt.mode}: one crash, one charge after recovery, two without it.`);
await mock?.close();
