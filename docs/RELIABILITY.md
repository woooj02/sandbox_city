# Paying exactly once

`packages/server/src/payments.ts` is the durable path. `POST /api/checkout` uses it.

## The rule

The call that moves money only ever acts on an order we already know by id, and its intent is on disk before it leaves.

```text
recorded -> created -> approved -> capturing -> captured -> refunded
                                \-> declined      any -> unresolved
```

- **Create** moves no money, so losing its response costs nothing.
- **Approved** is read back first. If the order PayPal holds is not the order the gate allowed, nothing is captured.
- **Capturing** is written and synced to disk before the capture is sent.
- **After a crash** the worker reads the order by id. A capture is there or it is not. It never re-sends a capture it cannot account for.

Recovery does not depend on how long PayPal remembers a `PayPal-Request-Id`, which its documentation gives only as "a period of time". The ids are still stable across restarts, because the run id lives next to the journal.

## What can go wrong, and what happens

| Failure | Result | Test |
| --- | --- | --- |
| Killed after capture, before writing it down | Read back, one charge | `scripts/crash-recovery.ts`, real SIGKILL |
| Killed before the capture reached PayPal | Sent once | `payments.test.ts` |
| Idempotency key forgotten | Still one charge | `payments.test.ts` |
| Eight requests for one key at once | One payment | `payments.test.ts` |
| Same key, different order | 409, nothing moves | `checkout-api.test.ts` |
| Order changed after the gate allowed it | Unresolved, no capture | `payments.test.ts` |
| Read-back disagrees with the intent | Unresolved | `payments.test.ts` |
| Journal line torn by the crash | Ignored, the rest loads | `payments.test.ts` |
| Webhook repeated, or late after a refund | No change | `payments.test.ts` |
| Webhook forged | 401, no change | `checkout-api.test.ts` |
| A payment fails after reserving the mandate | Reservation given back | `checkout-api.test.ts` |

## Run it

```bash
npx tsx scripts/crash-recovery.ts
npx tsx scripts/checkout-proof.ts
```

Without keys they run on the local mock and print `contract-mock`. With `--sandbox` and `.env` keys they run on the PayPal sandbox and write a `paypal-sandbox` receipt. A mock run never replaces a receipt.

## Limits

- The recorded receipts are from the PayPal sandbox, not production. Each receipt is one run. The script counts charges by reading the orders back from PayPal: one capture on the recovered order, and a second order and capture for the client with no journal.
- The unit tests use the mock. It enforces PayPal's documented rules; it is not PayPal.
- `verifyWebhook` sends the parsed event back to PayPal. PayPal checks the signature against the original bytes, so a real deployment may need the raw request body. This path has not run against the sandbox.
- A journal on one disk is one machine's durability. Several workers would need a shared store and a lock per key.
- A payment left `unresolved` needs a person.
