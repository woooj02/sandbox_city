# Round four: declared before it ran

Written on 2026-11-05, before the rulebook below was tuned and before any `fair-` day existed. An outside review asked for this: earlier rounds compared rulebooks that did not all carry the same safeguards, and all of them were tuned on a measure that has since been corrected.

## The question

With the same mandatory safeguards on every rulebook, and with value counted only when an order arrives and stays paid, which defense is worth its cost?

## What is fixed

- **Safeguards.** Owner mandate, ship-to lock, order checks and idempotency keys are on in every arm, baselines included.
- **Measure.** `kept`: honest orders that arrived and stayed paid, minus money stolen, once every order has settled.
- **New rulebook.** Frozen v4 is tuned on `dev-1` to `dev-4`, on `DEV_WORLD_V2`, with the corrected measure, search seed `freeze-4`, 14 generations of 12. It is frozen by hash before any fresh day runs.
- **Arms.** Wild West, Simple limits, Fortress, Lab-Tuned, Hand-written, Frozen v1, Frozen v2, Frozen v3, Frozen v4. Each carries the safeguards. Rules other than those four are not changed, and v1, v2 and v3 are not retuned.
- **Days.** `fair-01` to `fair-30`, on `DEV_WORLD`, run once.

## How the answer is picked

1. An arm qualifies if, over the 30 days, honest access is at least 95%, fraud stopped is at least 85%, and the exposure bound is never passed.
2. Of the arms that qualify, the one with the highest mean `kept` leads.
3. If the paired 95% interval between the top two includes zero, they tie on value, and the one holding fewer honest dollar-hours leads.
4. If no arm qualifies, that is the result.

The thresholds were chosen after seeing development days and earlier rounds, not fresh ones. They are a stated preference, not a law.

## What is reported whatever happens

Value kept, stolen, honest access, new stores refused, step-ups, held dollar-hours, sleeper theft and profit, the held-out mechanisms and the 12 changed assumptions. Every arm stays in the table. If v4 loses, it stays in the record as a loss.

## What this round cannot show

The attacks, the defense and this protocol share an author, and the days are simulated. A fresh seed is a new draw from the same world, not an independent test.
