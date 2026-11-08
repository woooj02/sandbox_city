# Threat model

What the gate protects, who it protects it from, and what it does not cover.

## Assets

- The owner's money and the owner's authority: what to buy, how many, how much, where it ships.
- Buyers' money at a store that has not delivered yet.
- The record of what was paid: one order, one charge, provable after a crash.

## Attackers and their powers

Each attacker has only the powers listed. Nothing else is assumed.

| Attacker | Can | Cannot |
| --- | --- | --- |
| Listing author | Write any text on a listing an agent reads | Touch the agent, its keys, the gate or PayPal |
| Sleeper store | Open a store, sell honestly, buy reach, discount, bundle, stop shipping, ship empty parcels, buy from itself | Touch the gate, PayPal or other stores |
| Subscription trap | Talk an agent into small repeat orders to the owner's own address | Change the address or go over the mandate in one order |
| Triangulator | Deliver real goods bought with stolen cards | Be seen stealing: every signal the gate has looks honest |
| Fake store, refund abuser, card tester, impersonator, fraud ring | The six stock families in `packages/core/src/world.ts` | The same limits |
| Compromised agent | Emit any `create_order` call the toolkit schema accepts | Forge a passport, or capture an order the gate never saw |

## Trust boundaries

| Boundary | Rule |
| --- | --- |
| Listing text to agent | Untrusted. A prompt may help; the gate does not depend on it |
| Agent to gate | Untrusted. The gate reads every field PayPal would act on, including tax, shipping, discount and both address lines |
| Model to rulebook | Untrusted. A proposed change passes `applyPatch` or it does not exist. Invariants cannot be switched off |
| Gate to PayPal | The order is read back and compared with what the gate allowed before capture |
| PayPal to us | Webhooks count only after PayPal verifies the signature. A restart believes PayPal's read-back, not its own memory |
| Simulation truth to gate | `GateOrder` has no ground-truth field, and a test flips the truth to prove decisions do not move |

## Invariants

Plain code, not scored and not searchable:

1. An order within the mandate is the only order that pays: amount, quantity, category and address.
2. A retry, a restart or a repeated webhook never makes a second charge.
3. A store's unfulfilled money stays under `floor + ratio x credit` when the exposure rule is on.
4. A state the worker cannot prove is reported as unresolved. It never invents a success.

An early search dropped invariant 1 and the strict order check twice, because no simulated attack needed them. So they are now a floor the search cannot touch. A rule that protects the owner's authority should not be up for a statistical trade.

## Found while building

Eight bypasses passed the first toolkit gate, even under Fortress: $5,000 hidden in `shippingCost`, 900% tax, an understated line total, no address, an attacker's postal code and country, `address_line_2`, `pay_order` on an unseen id, and repeated `create_order` calls. All are fixed, and six are kept as regressions in `regressions/`.

A property test also found a race: two orders in the same tick both read exposure before either was captured, and the bound was passed by $26.38. Exposure is now reserved before the payment call yields. The first frozen rulebook was tuned before that fix.

The first repair for empty parcels failed. It delayed the store's credit, but held orders still captured at the scan, so the money left anyway. The benchmark caught it. The fix holds the money itself through the complaint window, and voids a disputed order.

Hostile orders found more. `scripts/gate-fuzz.ts` mutates orders and judges each with a second checker in whole cents and Unicode tokens, in `packages/core/src/gate-fuzz.ts`. The first 30,000 orders found real bypasses: a suffix in another script on the owner's address, digits moved apart, a city matching part of the line, a sub-cent price rounding to the listed one, a $0 order of junk lines, a discount above the total, an invisible second line, and crashes on fields that were not text. At 200,000 it found one more that 15,000 had missed: number fields inside the address. Those never reached PayPal, because the address is rebuilt from named fields, but the gate now refuses them. Each is a named test.

The last recorded run tried 200,000 orders on each of Frozen v3 and v4 on a fresh seed, with no disagreement, and the seed that found the last bug is clean too. Signatures are off in this test so it reaches the order rules. The checker and the gate share an author.

## What this does not cover

- **The owner.** A stolen owner account can sign any mandate. In the lab API the caller states the mandate, so that endpoint proves the gate, not owner identity.
- **The carrier.** A scan is treated as an honest signal. An attacker who corrupts the carrier is out of scope. The complaint window limits the damage from an empty parcel; it does not prove what was in it.
- **PayPal's own protections.** Purchase Protection, seller holds and PayPal's risk engine are not modelled, so real losses would differ.
- **Triangulation.** No signal at the gate separates it from honest trade, so the gate cannot stop it. It belongs to card-network and marketplace controls.
- **Model weights and tools.** Attacks on the model provider or the toolkit package are out of scope.

## At the checkout

- **Claiming a good record.** The store and agent ids in a request are looked up, never believed. Unknown means new, so its orders are held. Ids are not authenticated yet, so a caller can name another party's id. Production needs them bound to a signed identity.
- **Faking delivery.** Delivery events can release money, so they need `LAB_TOKEN`, and imported records must state a source.
- **Retrying under a softer rulebook.** A key stays bound to its first decision. Anything else gets a 409.
- **Breaking the demo.** Every socket command passes one check in `runner.ts`, and a rulebook from outside is rebuilt from known rules. A bad command gets an error. No search can switch off an invariant, whoever calls it.

## Dependency reachability (Nov 7, 2026)

The production tree now has no alerts: `npm audit --omit=dev` reports 0. `@paypal/agent-toolkit` moved to a pinned development dependency, because the server never loads it, and a deployed install prunes the development tree after building. A pruned install was built, started, and refused the hijacked order under Frozen v4. The whole tree still reports the 12 below, all through the toolkit, and they apply when `scripts/toolkit-shop.ts` is run by hand.

The whole tree reports 12 affected packages: 11 high and one moderate, down from 15. The static-file branch is fixed by `@fastify/static` 10.1.10, with `glob` 14.0.3 and `minimatch` 11.0.5 in the lockfile. See the [plugin release](https://github.com/fastify/fastify-static/releases/tag/v10.1.10) and [glob fix](https://github.com/isaacs/node-glob/releases/tag/v14.0.2).

All remaining entries come through `@paypal/agent-toolkit` 1.11.0, the latest release, which the entry uses. `npm audit` offers only a downgrade to 1.3.5, and most fixes need a new major version of something the toolkit depends on, so we did not force them. This is a review of the calls in this repo, not a claim that installed code is safe:

- The public HTTP server uses `SandboxRails` and the durable checkout. It does not import the toolkit. The toolkit runs through `scripts/toolkit-shop.ts`, with sandbox credentials, and the code selects its `/openai` adapter.
- **Zod is reached:** the toolkit parses a model's `create_order` arguments with it. Oversized collections are a [memory-exhaustion risk](https://github.com/colinhacks/zod/pull/6652). These calls are in the local recording script, not a public toolkit endpoint. The toolkit's Zod 3 dependency cannot take the Zod 4 fix as a compatible update.
- **Mathjs is loaded**, but the selected adapter calls only `round` on order totals. This code does not pass model text to its [vulnerable expression parser](https://github.com/josdejong/mathjs/security/advisories/GHSA-29qv-4j9f-fjw5). Its fix needs mathjs 15; the toolkit asks for 14.
- The LangChain, LangSmith and AI SDK adapters, HTML diff formatter and UUID buffer APIs are not called by this entry. Their packages remain installed and reported. Adding one of those paths needs another review.

No forced upgrades, toolkit downgrade or major dependency overrides were applied. The remaining alerts need compatible upstream releases or a separately tested toolkit migration.
