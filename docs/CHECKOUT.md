# The checkout

`POST /api/checkout` is where a rulebook leaves the lab. An outside review found the first version shared the evaluator and little else: it discarded hold decisions, and judged every order against a fixed, established store. Those seven findings are now tests in `packages/server/test/audit-regressions.test.ts`. A second review found the paths around it were less careful: `reaudit-regressions.test.ts`. Each case failed before its fix.

## What transfers

| | Simulated day | Checkout |
| --- | --- | --- |
| Decision | `evaluateOrder` | The same function |
| Reputation, independence, closed-loop score | `packages/core/src/history.ts` | The same functions |
| What happens to held money | World tasks | `settlement()` in the same file, with the rules tested in `history.test.ts` |
| A hold | `AUTHORIZE` on the rails | A PayPal authorization, then capture or void |
| Store and agent history | World state | Folded from the payment journal |
| Time | Simulated minutes | Wall clock for ages. The complaint window closes when an event says so |

The settlement rules are written twice, once in the world's tasks and once in `settlement()`. Their agreement is tested by example, not by construction.

## A request

```json
{ "key": "order-1", "session": "request-1", "rulebook": "frozen-v3", "merchant": "lumen", "agent": "shopper-7",
  "owner": { "category": "home", "qty": 1, "address": "12 Neon St, Silk Row", "budget": 100 },
  "args": { "items": [{ "name": "Lamp", "quantity": 1, "itemCost": 80, "itemTotal": 80 }], "shippingAddress": { "address_line_1": "12 Neon St", "admin_area_2": "Silk Row" } } }
```

The answer has the decision, the rulebook id, whether it was held, the facts the evaluator saw and the payment. A retry returns the original decision. A retry under another rulebook, owner or session gets a 409 that names the original.

`rulebook` can be `frozen-v4`, `frozen-v3`, `frozen-v2`, `frozen-v1`, or `frozen-v1-safeguards`, the version round four measured. **Is it worth it?** in the app names the one to ask for.

**Unknowns are not trusted.** A store nobody has seen is new, with no credit, so its orders are held. An agent nobody has seen is new, so the new-agent cap applies.

## The history adapter

`HistorySource` in `packages/server/src/history.ts` is the contract: `merchant(id)`, `agent(id)` and `independent(agent, merchant)`. The default folds the journal, so a payment and the record it earned cannot disagree after a crash. Pass your own to read from your systems.

`POST /api/history/events` is how the outside world reaches it. It needs `LAB_TOKEN`, because these events can release money.

| Event | Effect |
| --- | --- |
| `delivered` | The carrier scanned the order. Under a rulebook with no window, a hold releases now |
| `complaint` | The order earns nothing, and a hold will be voided |
| `window-closed` | Delivered and undisputed: release and credit. Otherwise a hold is voided |
| `import-merchant`, `import-agent` | A record from elsewhere. It must state its `source` |

## The sleeper, on the sandbox

`scripts/sleeper-checkout.ts` takes the sleeper's record the minute before it starts collecting on simulated day `last-01`: $1679.29 of independent credit, so a bound of $83.96 under Frozen v3. It sends the first 6 orders that day's Lab-Tuned run captured through the checkout under each rulebook, then has the script play carrier and complaint desk. The receipt is `packages/web/src/data/sleeper-checkout.json`.

| Arm | Sold | Store got | Held |
| --- | --- | --- | --- |
| Lab-Tuned, sleeper | $574.82 | $574.82 | 0 of 6 |
| Frozen v3, sleeper | $574.82 | $64.48 | 5 of 6, all voided |
| Frozen v3, honest store | $574.82 | $574.82 | 5 of 6, all released |

The script refuses to write a receipt if Lab-Tuned holds an order the simulated day captured, if a hold is captured, if exposure passes the bound, or if the checkout and the evaluator disagree on any order.

Both rulebooks start from the record earned under Lab-Tuned, so the rulebook is the only difference. Under Frozen v3 itself, the same store would have collected 2 orders that day, not 18, because held money earns no credit until its window closes.

## The exact case, on the sandbox

`scripts/case-receipt.ts` sends the listing the workspace shows through `POST /api/checkout` under Frozen v4, on a local server against the PayPal sandbox. The record is in `case-receipt.json`.

- The recorded hijacked order, eight units for $1,620.64 to another address, was refused by the mandate. PayPal never saw it.
- One unit to the hijacked address was refused by the ship lock.
- The order the owner asked for was captured, read back as `COMPLETED`, and refunded.
- A real local model, `llama3.2:3b`, answered the same listing eight times. Two units to the attacker's address were refused, and so was one unit to the literal placeholder `<address>`. It declined five times, wrongly saying one unit was over budget. Its one correct order was held as an authorization. That is a small sample from a weak model, shown as what happened, not as a rate.

Store and shopper history are imported as established for this proof, and the file says so. `scripts/sleeper-checkout.ts --rulebook=frozen-v4` repeats the sleeper under v4: $64.48 of $574.82 kept, and the honest store paid in full. Delivery and complaints there come from a script.

## What this does not show

- **Six orders, one record.** This shows the checkout enforces the rule. The benchmark's 30 days are what measure how much it matters.
- **The carrier is a script.** No real parcel or complaint is involved, and a real deployment needs a real feed and a timer for the window.
- **One payee.** Every store settles to one sandbox business account, so a store's id is checked by the journal, not by PayPal.
- **A PayPal authorization has limits.** PayPal honours one for a set period and it can expire. Nothing here tests a hold running past that.
- **The caller states the mandate.** This is a lab: anyone calling the API writes their own owner and budget. In production the mandate must come from something the owner signed.
- **Webhooks.** One signed `PAYMENT.CAPTURE.COMPLETED` from the sandbox verified on the hosted app, and a forged event got a 401. The other event types have only run against the mock.
- **The hosted app is a demo.** `POST /api/checkout` is open and limited to 20 a minute per address by nginx, not by the app. The lab route's token stays on the server, so a visitor's held order stays held.
