# Paying exactly once

`packages/server/src/payments.ts` is the durable path. `POST /api/checkout` uses it.

## The rule

The call that moves money only ever acts on an order we already know by id, and its intent is on disk before it leaves.

```text
recorded -> created -> approved -> capturing -> captured -> refunded
                               |            \-> pending -> captured
                               \-> authorizing -> held -> releasing -> captured
                                                      \-> voiding -> voided
declined and unresolved can follow any step
```

- **Create** moves no money, so losing its response costs nothing.
- **Approved** is read back first. If the order PayPal holds is not the order the gate allowed, nothing is captured.
- **Capturing** is written and synced to disk before the capture is sent.
- **After a crash** the worker reads the order by id. A capture is there or it is not. It never re-sends a capture it cannot account for.
- **Only a `COMPLETED` capture of the right amount is `captured`.** `PENDING` stays pending, and `FAILED` and `DECLINED` are declined. The same holds on a restart and for a webhook.
- **A hold is a PayPal authorization.** No money moves until it is released, and a hold survives a restart as a hold.
- **The read-back compares the whole order:** amount, currency, quantity, identity and every address field. The address is sent as the gate read it.
- **A torn last line is cut off when the journal opens,** so the next record cannot join it and be lost.
- **A webhook and its effect are one journal line.** A crash leaves both or neither, so a redelivered event is either applied or truly a repeat.
- **Refunds add up.** A record keeps the dollars refunded and the refund ids, and it is `refunded` only when the whole amount is back.
- **The journal also holds the decision behind each payment and what happened to the goods.** A receipt, a mandate and a store's record come back with it after a restart.

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
| Capture answers `PENDING` or `FAILED`, live or on restart | Pending or declined, never captured | `audit-regressions.test.ts` |
| Rulebook says hold | Authorized, not captured | `audit-regressions.test.ts`, `scripts/sleeper-checkout.ts` |
| Killed halfway through a release | Finishes on restart, one capture | `audit-regressions.test.ts` |
| New key in a spent session, after a restart | Challenged | `audit-regressions.test.ts` |
| Retry under another rulebook | 409, and the original decision is named | `audit-regressions.test.ts` |
| Torn journal tail, then a new payment | Both kept right | `audit-regressions.test.ts` |
| Address differs at PayPal | Unresolved, no capture | `audit-regressions.test.ts` |
| Malformed command on the public socket | An error back, the server keeps serving | `reaudit-regressions.test.ts` |
| Live adapter gets a `PENDING` capture | Reported pending, no money counted | `reaudit-regressions.test.ts` |
| Reconciling a pending capture, every total equal | Not matched | `reaudit-regressions.test.ts` |
| $1 refunded on $80 | Stays captured, $79 at stake | `reaudit-regressions.test.ts` |
| One refund delivered twice, under one id or two | Counted once | `reaudit-regressions.test.ts` |
| Refund event with no amount | Changes nothing, can come again | `reaudit-regressions.test.ts` |
| Crash before, during or after a webhook's write | Redelivery leaves the right state | `reaudit-regressions.test.ts` |
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

## Every crash, up to a depth

One SIGKILL proves one crash. `scripts/fault-explore.ts` proves more. Every journal write and PayPal call in the real worker is a choice point: crash before, crash after, tear the write, lose the answer, deliver a webhook there. It runs every combination of up to 4 faults, fewest first, across 9 payment flows, so the first failure found is a smallest one.

- 1,797,160 schedules ran. None broke a promise: no double charge, no money the journal denies, no held order captured, no refund lost.
- Every flow reached a final state, except an order changed at PayPal after the gate allowed it. All 22,996 of those stop as `unresolved` with nothing captured, which is the intended ending.
- Without the journal, 2,892 of 16,105 schedules charged twice or more, up to 4 charges.
- 9 seeded bugs went into the worker and journal to test the test. All 9 were caught within 2 faults.

It found a real bug at 3 faults: `webhook@capture -> dashboard refund -> webhook@capture` left the journal saying captured while the ledger said refunded. A worker that had just written a result could overwrite a newer one a webhook had settled. Lagging reads also left about 2,200 schedules unresolved. The worker now re-reads the journal before each write, and treats a read that is behind the journal as a retry, not a difference.

PayPal in this run is an in-process model, not PayPal. It proves the worker's logic against the failures the model can produce. The sandbox receipts above are the evidence about PayPal itself.

```bash
npx tsx scripts/fault-explore.ts --faults=4 --write   # about 25 minutes
```

## Limits

### Live city

The city uses `World`, separate from the durable checkout worker. It only counts a capture or refund after PayPal says `COMPLETED`, and a void after `VOIDED`. A failed void or declined held capture stays unresolved, with its hold visible. It is never counted as a capture, refund or fraud saving.

Known pending capture and refund ids are read back while the city runs, and every five seconds while paused or finished. An id and amount must match before the result is folded into that run. Repeated or overlapping reads cannot count it twice. The ledger and its CSV update too.

A stopped city can update money without advancing its delivery clock. The city is in memory: closing its socket or restarting the server ends its polling. A pending authorization, or a response lost before a payment id is known, needs a person; it stays pending or unresolved and is not counted. Use the durable checkout for payments that must survive a restart.

### Durable checkout

- The recorded receipts are from the PayPal sandbox, not production. Each receipt is one run. The script counts charges by reading the orders back from PayPal: one capture on the recovered order, and a second order and capture for the client with no journal.
- The unit tests use the mock. It enforces PayPal's documented rules; it is not PayPal.
- `verifyWebhook` sends the parsed event back to PayPal, not the original bytes. That passed for a real capture event on the sandbox, but other event types have not been tried, and a re-serialised body could fail on one.
- A journal on one disk is one machine's durability. Several workers would need a shared store and a lock per key.
- A payment left `unresolved` needs a person.
