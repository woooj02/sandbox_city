# Sandbox City

Sandbox City helps developers test payment-capable agents before release: reproduce a financial failure, compare defenses and their cost to honest buyers, then carry the result into checkout and CI.

Try it: https://sandbox-city.91.99.162.43.sslip.io (press **E** for the evidence).

[![verify](https://github.com/woooj02/Sandbox-City/actions/workflows/verify.yml/badge.svg)](https://github.com/woooj02/Sandbox-City/actions/workflows/verify.yml)

## In two minutes

Needs Node 22.9 or later (`nvm use` reads `.nvmrc`).

```bash
npm install
npm run dev
```

Open http://localhost:5173 and press **E** for the evidence, **H** for the recorded hijack, or choose **▶ WATCH THE FILM**.

To check the numbers yourself, with no keys and no network:

```bash
npm run verify
```

This typechecks, runs the tests, rebuilds the front end and runs `scripts/verify-claims.ts`, which recomputes the numbers in this README and in `docs/` from the recorded runs. It rechecks the frozen rulebook hashes, replays sampled days exactly and reruns the regressions.

## The failure

A store sells honestly and earns a good record. A good record unlocks instant capture: the money reaches the store when the buyer pays. Then the store buys reach, stops shipping and vanishes. No single order breaks a rule.

The full scenario, with victim, attacker powers and the honest users a simple defense blocks: [docs/SCENARIO.md](docs/SCENARIO.md).

## What stopping it costs

Thirty simulated days nobody had read when this rulebook was frozen. Each cell is a mean with a 95% interval.

| Rulebook | Value kept / day | Stolen / day | Honest access | New stores refused | Step-ups / 100 | Held $·hours | Sleeper stolen | Sleeper profit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Wild West | $63,717 [$60,395, $67,097] | $43,932 [$42,192, $45,823] | 100.0% | 0.0% | 0 | $0 | $3,805 | $4,966 |
| Simple limits | $73,755 [$70,526, $76,949] | $37,395 [$35,914, $39,053] | 100.0% | 0.1% | 0 | $0 | $3,803 | $4,959 |
| Fortress | $47,433 [$45,586, $49,294] | $2,972 [$2,695, $3,271] | 43.0% | 93.0% | 9.6 | $0 | $0 | -$215 |
| Lab-Tuned | $93,815 [$91,533, $96,187] | $9,302 [$8,739, $9,871] | 91.0% | 8.9% | 4.1 | $32,678 | $2,830 | $3,925 |
| Frozen v1 | $104,080 [$101,554, $106,654] | $6,620 [$6,270, $6,996] | 98.0% | 2.0% | 5.3 | $47,728 | $445 | $1,734 |
| Frozen v3 | $104,110 [$101,646, $106,560] | $5,191 [$4,876, $5,508] | 96.0% | 4.0% | 17.5 | $713,722 | $54 | $1,180 |

- **It works on the failure.** The sleeper's theft falls from $2,830 under Lab-Tuned to $54.
- **A simple rule does not.** Simple limits leave $3,803 of $3,805 stolen. Blocking the unproven works, and turns away most honest trade.
- **It has a price.** Against the first frozen rulebook, v3 stops $1,429 more a day for the same value kept, but owners see 17.5 step-ups per 100 orders instead of 5.3, and honest stores wait about 15 times as long for money.
- **It still misses things.** Triangulation gets through. The subscription trap is only cut by about a quarter. An attacker that adapts gets its profit back to about $4,000 a day.
- **We got it wrong along the way.** The first frozen rulebook lost to three of four mechanisms written after it. Our first repair for one of them did not work. Those results stay in the record.

Protocol, all three rounds and the raw tables: [docs/BENCHMARK.md](docs/BENCHMARK.md).

## The hijack

A real model was talked into a $1,620.64 order to an attacker's PO box on the PayPal sandbox. Wild West paid it, Lab-Tuned and Know Your Agent refused it at the gate, and PayPal's Agent Toolkit refunded it. Across 66 poisoned listings, that planner followed 27 of 66 (41%). Details: [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md).

## Paying exactly once

`POST /api/checkout` runs the evaluator the benchmark measured, then a durable worker. The capture intent is on disk before the capture leaves. After a crash, the worker reads the order back from PayPal by id and never re-sends a capture it cannot account for.

```bash
npx tsx scripts/crash-recovery.ts
```

This kills a real process with SIGKILL after the capture succeeds and before it can write that down. Recovery finds the capture and makes no new charge. A client with no journal, retrying, charges twice.

## The same failure at the checkout

Sharing an evaluator proves little unless the checkout acts on it. So the sleeper leaves the simulation: its record and its orders from one simulated day go through `POST /api/checkout`. It ships nothing, and every buyer complains.

| On the PayPal sandbox | Sold | Store got | What PayPal shows |
| --- | --- | --- | --- |
| Lab-Tuned, sleeper | $574.82 | **$574.82** | 6 captures |
| Frozen v3, sleeper | $574.82 | **$64.48** | 1 capture, 5 authorizations voided |
| Frozen v3, honest store, same record | $574.82 | **$574.82** | 1 capture, 5 authorizations captured after delivery |

The bound was $83.96, so one order paid and the rest were held. The honest store got everything, later. That wait is the cost shown above. This is 6 orders on one day's record: it shows the checkout enforces the rule, and the benchmark is what measures how much it matters. How it works: [docs/CHECKOUT.md](docs/CHECKOUT.md).

The recorded receipts ran against the PayPal sandbox, so no real money moved, and each says `paypal-sandbox`. Without keys the same scripts run on a local mock, say so, and leave the receipts alone. Add `--sandbox` and keys to record your own. Details: [docs/RELIABILITY.md](docs/RELIABILITY.md).

## Run a failure against your agent

```bash
npx tsx scripts/regress.ts regressions --agent "python3 examples/agents/careful.py"
```

Your agent is any command that reads a case as JSON on stdin and prints its order. There are 13 cases, and passing is decided by plain code, with no model grading. Exit code 1 fits CI. Format: [docs/REGRESSION.md](docs/REGRESSION.md).

## What this does not show

- **Simulated economics.** The days are simulated. Fees, cost of goods and owner approval rates are stated assumptions, not measurements. PayPal's own protections are not modelled.
- **One author.** The attacks, the held-out mechanisms and the defense come from the same team. No outside builder has tried it yet: [docs/EXTERNAL_TEST.md](docs/EXTERNAL_TEST.md).
- **Sandbox, not production.** The crash recovery, the checkout and the holds below ran on the PayPal sandbox, as did the hijack and the refund. Webhooks have only run against the mock.
- **A script plays the carrier.** Deliveries, complaints and closing windows reach the checkout through an adapter, and in this lab a script sends them. Every store settles to one sandbox account.
- **One paid hijack.** The 41% comes from plans put through the gate; one hijacked order was actually paid.
- **Closer work exists.** See [docs/PRIOR_ART.md](docs/PRIOR_ART.md).

Full threat model and known gaps: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## What happens in a day

1,440 simulated minutes. Shoppers buy through their own AI agents, and stores list, ship and refund. Six attack families run throughout: prompt injection, fake stores, refund abuse, card testing, impersonation and fraud rings. Chaos mode injects faults on the rail, including a timeout after commit, so an agent that retries without a `PayPal-Request-Id` charges its customer twice.

| Measure | Meaning |
| --- | --- |
| **Fraud stopped** | Share of attempted fraud dollars that never reached an attacker |
| **Honest through** | Share of genuine purchases that completed |
| **Net value** | Honest sales, minus money stolen, minus double charges |
| **Value kept** | Honest value actually delivered, minus money stolen, once every order has settled. The benchmark scores this |

## The gate

Agents carry a Know-Your-Agent passport bound to a verified owner and signed with Ed25519 (Web Bot Auth, RFC 9421). The rulebook decides what the gate checks:

| Rule | What it does |
| --- | --- |
| Agent passport, signature verification | Only owner-bound agents may pay; signature, expiry and nonce replay are checked |
| Owner mandate | Orders over the owner's budget or quantity, or outside allowed categories, go to the owner, counted across the session |
| Ship-to lock | Shipping anywhere but the owner's address needs approval |
| Orders must add up | Refuses bad numbers, hidden shipping or tax, and a price off the listing |
| Velocity limit, new-agent cap | Throttle young or hyperactive agents |
| Merchant reputation, verified merchants | Refuse to pay doubtful stores |
| Escrow new merchants | Authorize only; capture later, void otherwise |
| Exposure hold | A store's unfulfilled money stays under `floor + ratio x credit` |
| Independent credit | Only buyers independent of the store earn it credit |
| Complaint window | Credit waits for the buyer to be able to complain; with the hold-through rule, so does held money |
| Listing injection filter | Quarantine listings that try to instruct AI agents |
| Refund tracking check, ratio cap | Deny refund claims the carrier contradicts |
| Fraud-ring detector | Block stores whose revenue is a closed loop |
| `PayPal-Request-Id` on retries | Timeouts never double-charge |
| Challenge instead of block | Borderline orders go to the human owner |

Owner mandate, ship-to lock, orders-must-add-up and idempotency are invariants: the search cannot remove them, and a model's proposal cannot switch them off.

## Features

- **Live city.** A WebGL map of six districts, with every payment drawn as a comet from buyer to store.
- **Evidence.** Press **E**. The failure, its cost, what still gets through, the checkout and the crash, in that order.
- **X-ray, Fork, What-if.** See what is malicious, run one day under two rulebooks, replay the day under every rulebook.
- **Auto-tune and attack forge.** Evolve a rulebook on other days; evolve attacks against yours.
- **Ledger and rule matrix.** Every order and PayPal call, and every rule against every preset, in AG Grid.
- **Model shoppers.** A language model writes the orders (`?brain=1`), replayed from recordings in the browser.
- **Cinema mode.** A directed cut of the whole story, in six acts.

## PayPal integration

By default the sim runs on a deterministic PayPal twin, so any seed replays exactly. With sandbox keys, lane A also moves money on the PayPal sandbox:

- **Orders v2** create and capture, authorize, capture and void for escrow, and refunds.
- **Reconciliation.** What the sim says moved, what PayPal returned, and every capture and refund read back by id. The report shows `✓ RECONCILED WITH PAYPAL, TO THE CENT` only when all three agree.
- **Agent Toolkit.** A model pays through `@paypal/agent-toolkit` with `create_order`, `pay_order` and `get_order`, and the gate checks each call, including the amount PayPal holds before capture.

```bash
cp .env.example .env
npm run build && npm run server
```

Fill in `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and a sandbox test card, then open http://localhost:8787/?live=1. The server reads `.env` itself. Scripts need it passed: `npx tsx --env-file=.env scripts/sleeper-checkout.ts --sandbox`. If the server is unreachable, the page falls back to the twin.

| Variable | Default | Effect |
| --- | --- | --- |
| `HOST` | 0.0.0.0 | Address the server binds. Use 127.0.0.1 behind a proxy |
| `LAB_TOKEN` | off | Lets a caller report deliveries and complaints, which can release held money |
| `PAYPAL_WEBHOOK_ID` | off | Turns on `POST /webhooks/paypal` |
| `MAX_SESSIONS` | 8 | Cities that can run on the server at once |
| `MAX_LIVE` | 2 | Of those, how many pay on the PayPal sandbox |
| `LIVE_SAMPLE` | 0.02 | Share of ordinary shoppers whose payments also go to the sandbox |
| `PAYMENT_JOURNAL` | `.data/payments.log` | Where durable payments are journaled |
| `PAYPAL_WEBHOOK_ID` | none | Turns on `POST /webhooks/paypal` |

## Reproduce the benchmark

```bash
npx tsx scripts/freeze.ts --v3
npx tsx scripts/benchmark.ts core heldout sensitivity adaptive --frozen=evidence/frozen-v3.json --seeds=last --out=mine
```

`?evidence=1`, `?hijack=1`, `?preset=balanced`, `?fork=open,tuned`, `?seed=neo-osaka-7` and `?cinema=1` open the app in those states.

## Tools and AI use

Built with TypeScript, React, PixiJS, AG Grid, Fastify and PayPal's Agent Toolkit. Models used in the experiments are named in [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md).

## Layout

| Path | Contents |
| --- | --- |
| `packages/core` | Deterministic engine: world, attackers, passports, gate, checkout contract, experiment, regressions. Runs in a Web Worker or in Node |
| `packages/server` | Fastify lab server, PayPal adapter, durable payments, checkout API, PayPal contract mock |
| `packages/web` | React, PixiJS and AG Grid front end |
| `regressions/` | Portable failure cases |
| `examples/agents/` | Agents that do not import this project |
| `evidence/` | Frozen rulebooks |
| `docs/` | Scenario, benchmark, threat model, reliability, regressions, prior art, experiments |

MIT licensed.
