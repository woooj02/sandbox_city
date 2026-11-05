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

## What this does not cover

- **The owner.** A stolen owner account can sign any mandate. In the lab API the caller states the mandate, so that endpoint proves the gate, not owner identity.
- **The carrier.** A scan is treated as an honest signal. An attacker who corrupts the carrier is out of scope. The complaint window limits the damage from an empty parcel; it does not prove what was in it.
- **PayPal's own protections.** Purchase Protection, seller holds and PayPal's risk engine are not modelled, so real losses would differ.
- **Triangulation.** No signal at the gate separates it from honest trade, so the gate cannot stop it. It belongs to card-network and marketplace controls.
- **Model weights and tools.** Attacks on the model provider or the toolkit package are out of scope.
