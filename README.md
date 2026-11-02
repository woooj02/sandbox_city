# Sandbox City

A crash-test lab for agentic commerce. AI shoppers, AI stores and AI attackers spend a full day trading in a living city, and every payment runs on PayPal rails. You choose the safeguards at the gate. Sandbox City measures how much financial harm each rulebook prevents, and how many honest shoppers it still lets through.

You can test a rule here before it ever touches a real customer.

## What happens in a day

- **1,440 simulated minutes.** Shoppers browse, compare and buy through their own AI agents. Stores list, ship and refund.
- **Six attack families run throughout the day:**
  - prompt injection hidden in listings
  - fake stores that take the money and vanish
  - refund abuse
  - stolen-card testing
  - agent impersonation and signature replay
  - fraud rings that launder through a closed loop of buyers
- **Faults on the payment rail.** Chaos mode injects them the way production does:
  - a 503 before commit
  - a timeout after commit, where the money moved but the agent never heard back
- **Duplicate charges show up.** An agent that retries without a `PayPal-Request-Id` charges its customer twice, and the ledger shows it.

Every number on screen comes from the harm ledger:

| Measure | Meaning |
| --- | --- |
| **Fraud stopped** | Share of attempted fraud dollars that never reached an attacker |
| **Honest through** | Share of genuine purchases that completed |
| **Net value** | Honest sales, minus money stolen, minus double charges, minus the cost of turning good customers away |

## The gate

Agents carry a Know-Your-Agent passport. It is bound to a verified owner and signed with Ed25519 (Web Bot Auth, RFC 9421). The rulebook decides what the gate checks:

| Rule | What it does |
| --- | --- |
| Agent passport | Only agents with an owner-bound passport may pay |
| Signature verification | Signature, expiry and nonce replay check on every request |
| Owner mandate | Orders above the owner's cap, or outside allowed categories, go to the owner |
| Ship-to lock | Shipping anywhere but the owner's address needs approval |
| Velocity limit, new-agent cap | Throttle young or hyperactive agents |
| Merchant reputation, verified merchants | Refuse to pay doubtful stores |
| Escrow new merchants | Authorize only; capture when the carrier scans the parcel, void otherwise |
| Listing injection filter | Quarantine listings that try to instruct AI agents |
| Refund tracking check, refund ratio cap | Deny refund claims the carrier contradicts |
| Fraud-ring detector | Block stores whose revenue is a closed loop |
| `PayPal-Request-Id` on retries | Timeouts never double-charge |
| Challenge instead of block | Borderline orders go to the human owner instead of being refused |

Presets range from **Wild West** (no rules) through **Passport Theater**, **Know Your Agent**, **Balanced** and **Fortress**. **Lab-Tuned** is a rulebook found by the auto-tuner.

## Features

- **Live city.** A WebGL map of six districts. Every payment flies as a comet from buyer to store. Breaches, blocks, double charges and vanishing stores trigger terminal-style alerts: ACCESS GRANTED when an attack gets through, ACCESS DENIED when the gate stops it.
- **X-ray.** Reveals which agents, stores and listings are malicious. The gate never sees this.
- **Fork.** Runs the same day, with the same seed, under two rulebooks side by side.
- **What-if.** At the end of the day, the same day is replayed under every other rulebook. You see what each would have saved, or cost.
- **Auto-tune.** An evolutionary search over the rulebook. Candidates are trained on two other days, so the day on screen stays unseen and the replay is a fair test. You can require a safety floor, for example "at least 85% of fraud stopped", and it finds the most value above it.
- **Attack forge.** The red team. Attack tactics evolve against your rulebook on two other days. Each attack family keeps whichever variant got the most money past the gate. Attack frequency is a fixed budget, so the forge finds smarter attacks, not more of them. You can unleash the forged attackers on the city, or re-tune the rulebook against them.
- **Ledger.** Every order, refund and PayPal call, in AG Grid. Filter by view or grep, see totals for what is in view, and export it as CSV.
- **Rule matrix.** Every rule against every preset in one grid. Edit your rulebook in place and replay the same day.
- **Cinema mode.** A directed, letterboxed cut of the whole story for presenting:
  - the camera pushes in and locks a reticle on breaches, injections and double charges
  - every chapter opens with the command that runs it, typed out on a terminal
  - a live `gate.trace` prints the gate's real decisions as they happen
  - the sim slows down on the biggest moments
  - chapter cards play between acts
  - five acts: the Wild West, auto-tune, the race, the reckoning, and the attackers adapting (forge, re-tune, rematch)

## PayPal integration

By default the sim runs on a deterministic PayPal twin, so any seed replays exactly. Start the lab server with sandbox credentials and lane A also moves real money on the PayPal sandbox:

- **Hero shoppers.** Every hero shopper's orders go to the sandbox.
- **City sample.** A sampled share of the rest of the city (`LIVE_SAMPLE`) goes to the sandbox too.
- **API calls.** Orders v2 create and capture with a card payment source; authorize, capture and void for escrow; refunds.
- **Idempotency.** `PayPal-Request-Id` is namespaced per run. Lanes without the idempotency rule really do double-charge on the sandbox.
- **Declines.** Risk declines are enacted with PayPal's negative-testing header.
- **Reconciliation.** At the end of the day, the server reconciles three ways:
  1. what the sim says moved
  2. what PayPal returned to the adapter
  3. every capture and refund read back from PayPal by id

  Transaction Search is checked too when the app has it enabled. The report shows `✓ RECONCILED WITH PAYPAL, TO THE CENT` only when all three agree.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. Everything runs in the browser on the PayPal twin.

### With the PayPal sandbox

```bash
cp .env.example .env
```

Fill in `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and a sandbox test card, then:

```bash
npm run build && npm run server
```

Open http://localhost:8787/?live=1. If the server is unreachable, the page falls back to the twin.

On a public server, two environment variables bound the load:

| Variable | Default | Effect |
| --- | --- | --- |
| `MAX_SESSIONS` | 8 | Cities that can run on the server at once |
| `MAX_LIVE` | 2 | Of those, how many pay on the PayPal sandbox; the rest run on the twin |
| `LIVE_SAMPLE` | 0.02 | Share of ordinary shoppers whose payments also go to the sandbox |

Request sizes are clamped, searches stop when the browser disconnects, and the engine yields to the event loop every 15 simulated minutes, so one visitor's auto-tune never freezes another's city. `npm run dev` proxies `/api` and `/ws` to the lab server, so http://localhost:5173/?live=1 works too.

### Deep links

| URL parameter | Effect |
| --- | --- |
| `?preset=balanced` | Start with a preset rulebook |
| `?fork=open,tuned` | Split screen, two rulebooks, same day |
| `?seed=neo-osaka-7` | Choose the day |
| `?speed=24` | Simulated minutes per second |
| `?cinema=1` | Cinema mode. Press **R** to roll, **Esc** to cut, **C** to toggle |
| `?cinema=1&roll=1` | Start rolling immediately |
| `?cinema=1&roll=1&act=5` | Start the film at a given act (1 to 5) |
| `#film`, `#act5` | Same as above, for hosts that drop query strings |
| `?live=1` | Use the lab server and the PayPal sandbox |

### Command line

```bash
npm test
```

Runs the engine, the policy search and the PayPal adapter against a strict contract mock, plus full live-server days that reconcile to the cent.

```bash
npx tsx scripts/tune.ts 8 10 0.85
```

Runs the rulebook search from a terminal and prints how each rulebook does on held-out days.

```bash
npx tsx scripts/compare.ts
```

Plays the default day under every preset and prints the scores.

```bash
npx tsx scripts/paypal-proof.ts
```

With the lab server running on sandbox keys, plays one Lab-Tuned day on the live lane, reconciles it with PayPal and saves the receipt that the twin's end-of-day report shows.

## Layout

| Path | Contents |
| --- | --- |
| `packages/core` | Deterministic engine: world, agents, attackers, KYA passports, gate policies, PayPal twin, chaos rails, what-if replays, rulebook search. Runs in a Web Worker or in Node. |
| `packages/server` | Fastify lab server: WebSocket streaming, PayPal sandbox adapter, reconciliation API, PayPal contract mock |
| `packages/web` | React, PixiJS and AG Grid front end |
