/** One process that pays and dies. Run by scripts/crash-recovery.ts; it is killed for real, with SIGKILL, at the named point. */
import { PaymentJournal, PaymentWorker } from '../packages/server/src/payments.ts';
import { SandboxRails } from '../packages/server/src/paypal.ts';

const [journal, key, amount, killAt] = process.argv.slice(2);
const rails = SandboxRails.fromEnv()!;
const input = {
  intent: 'CAPTURE' as const, amount: Number(amount), currency: 'USD' as const, payeeMerchantId: 'M1', payerId: 'agent-1', card: { last4: '1111', state: 'ok' as const, holder: 'agent-1' },
  item: { name: 'Lamp', sku: 'SKU1', unit: Number(amount), qty: 1 }, shipTo: '12 Neon St, Silk Row', customId: key,
};
const worker = new PaymentWorker(rails, new PaymentJournal(journal), {
  fault: (p) => { if (p === killAt) process.kill(process.pid, 'SIGKILL'); },
});
const r = await worker.pay(key, input);
console.log(JSON.stringify(r));
