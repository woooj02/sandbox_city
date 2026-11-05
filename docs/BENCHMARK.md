# Benchmark

Every number here is rechecked by `npm run claims`. Simulated days are simulation: they show how rulebooks compare under stated assumptions, not what would happen in production.

## Protocol

1. Tune on development days only (`dev-1` to `dev-4`) and freeze the winner by hash in `evidence/`.
2. Run it once on 30 days nobody has read. A day is the unit of uncertainty. Intervals are 95% percentile bootstraps over days, paired where two rulebooks are compared.
3. Run each day to its terminal state, so refunds and holds have settled.
4. Keep every result. If a result is read and acted on, those days are spent, and the next rulebook gets new ones.

| Round | Rulebook | Days | What changed before it |
| --- | --- | --- | --- |
| 1 | Frozen v1, `dbde3259db4a3156` | `test-01` to `test-30` | First freeze. It left the mandate off, because no simulated attack needed it |
| 2 | Frozen v2, `db609437ac0c792b` | `final-01` to `final-30` | Wash and empty box became development data. Invariants became a floor |
| 3 | Frozen v3, `f5dc2c8ff6099bdd` | `last-01` to `last-30` | The empty-box repair had failed, so held money now waits out the complaint window |

Each search tried about 150 rulebooks. The rule evaluator takes about 2 microseconds a decision at the median on a laptop, without signature checks or network.

## Results

### Round three

| Rulebook | Value kept / day | Stolen / day | Honest access | New stores refused | Step-ups / 100 | Held $·hours | Sleeper stolen | Sleeper profit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Wild West | $63,717 [$60,395, $67,097] | $43,932 [$42,192, $45,823] | 100.0% | 0.0% | 0 | $0 | $3,805 | $4,966 |
| Simple limits | $73,755 [$70,526, $76,949] | $37,395 [$35,914, $39,053] | 100.0% | 0.1% | 0 | $0 | $3,803 | $4,959 |
| Fortress | $47,433 [$45,586, $49,294] | $2,972 [$2,695, $3,271] | 43.0% | 93.0% | 9.6 | $0 | $0 | -$215 |
| Lab-Tuned | $93,815 [$91,533, $96,187] | $9,302 [$8,739, $9,871] | 91.0% | 8.9% | 4.1 | $32,678 | $2,830 | $3,925 |
| Hand-written | $94,085 [$91,859, $96,417] | $9,031 [$8,540, $9,540] | 91.0% | 8.9% | 4.1 | $32,795 | $2,561 | $3,666 |
| Frozen v1 | $104,080 [$101,554, $106,654] | $6,620 [$6,270, $6,996] | 98.0% | 2.0% | 5.3 | $47,728 | $445 | $1,734 |
| Frozen v2 | $97,768 [$95,756, $99,675] | $6,098 [$5,681, $6,508] | 95.0% | 4.0% | 17.5 | $110,972 | $24 | $1,205 |
| Frozen v3 | $104,110 [$101,646, $106,560] | $5,191 [$4,876, $5,508] | 96.0% | 4.0% | 17.5 | $713,722 | $54 | $1,180 |

### Round two

| Rulebook | Value kept / day | Stolen / day | Honest access | New stores refused | Step-ups / 100 | Held $·hours | Sleeper stolen | Sleeper profit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Wild West | $65,032 [$62,407, $67,655] | $43,083 [$41,324, $45,094] | 100.0% | 0.0% | 0 | $0 | $3,903 | $4,890 |
| Simple limits | $75,423 [$72,922, $77,930] | $36,317 [$34,696, $38,181] | 100.0% | 0.1% | 0 | $0 | $3,901 | $4,887 |
| Fortress | $47,979 [$46,261, $49,721] | $3,016 [$2,782, $3,248] | 43.0% | 93.9% | 9.5 | $0 | $0 | -$218 |
| Lab-Tuned | $94,704 [$92,687, $96,795] | $9,495 [$8,869, $10,164] | 91.0% | 8.3% | 4.3 | $32,178 | $2,925 | $3,966 |
| Hand-written | $95,177 [$93,106, $97,272] | $9,021 [$8,518, $9,539] | 91.0% | 8.3% | 4.3 | $32,407 | $2,453 | $3,511 |
| Frozen v1 | $104,604 [$102,461, $106,759] | $6,526 [$6,193, $6,883] | 98.0% | 1.9% | 5.3 | $48,574 | $437 | $1,700 |
| Frozen v2 | $99,119 [$97,082, $101,232] | $5,790 [$5,519, $6,076] | 95.0% | 4.0% | 17.5 | $112,551 | $33 | $1,240 |

### Round one

| Rulebook | Value kept / day | Stolen / day | Honest access | New stores refused | Step-ups / 100 | Held $·hours | Sleeper stolen | Sleeper profit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Wild West | $65,750 [$63,242, $68,122] | $42,911 [$41,345, $44,544] | 100.0% | 0.0% | 0 | $0 | $4,022 | $5,037 |
| Simple limits | $75,468 [$72,975, $78,082] | $36,863 [$35,209, $38,484] | 100.0% | 0.1% | 0 | $0 | $4,018 | $5,032 |
| Fortress | $48,218 [$46,134, $50,239] | $3,064 [$2,704, $3,415] | 43.0% | 94.1% | 9.7 | $0 | $0 | -$219 |
| Lab-Tuned | $94,705 [$92,519, $96,733] | $9,731 [$9,162, $10,268] | 91.0% | 8.9% | 4.5 | $33,794 | $2,911 | $3,872 |
| Hand-written | $95,129 [$92,925, $97,251] | $9,307 [$8,767, $9,788] | 91.0% | 8.9% | 4.5 | $33,908 | $2,486 | $3,465 |
| Frozen | $104,702 [$102,446, $106,882] | $6,915 [$6,436, $7,397] | 98.0% | 2.2% | 5.5 | $49,989 | $426 | $1,597 |

**Reading round three.** Against Frozen v1, Frozen v3 keeps the same value (the difference is $29 a day, with an interval of -$495 to $567) and stops $1,429 more a day ($1,287 to $1,571). The cost is friction: 17.5 step-ups per 100 orders against 5.3, and about 15 times the honest money held, for longer. Honest access is 96.0% against 98.0%.

Frozen v2 is a worse rulebook than v1 on the standard world: it kept $5,486 a day less on the final days. It is here because it is what happened.

The exposure bound was never passed on any test day, in any round.

## Held out

"Blind" is the only clean test: Frozen v1 had never seen these mechanisms, and they were written after it was frozen. Wash and empty box then became development data, so later rows for them are repairs, not blind results. Subscription and triangulation were never tuned on and never repaired, though we have read how earlier rulebooks did on them.

| Mechanism | No defense | v1, blind | v2 | v3 | Attacker profit under v3 |
| --- | --- | --- | --- | --- | --- |
| Wash warm-up | $3,883 [$3,471, $4,384] | $1,210 | $26 [$18, $35] | $58 [$44, $73] | $9 |
| Empty box | $3,815 [$3,339, $4,281] | $3,835 | $3,296 [$2,868, $3,783] | $54 [$42, $66] | $804 |
| Subscription trap | $4,048 [$3,434, $4,722] | $4,202 | $2,906 [$2,533, $3,285] | $2,963 [$2,598, $3,366] | $3,206 |
| Triangulation | $4,073 [$3,494, $4,652] | $4,164 | $3,781 [$3,234, $4,333] | $3,857 [$3,321, $4,383] | $5,460 |

- **Wash warm-up.** Blind, v1 cut it by about 70%. Independent credit closed the rest.
- **Empty box.** Blind, v1 missed it. The first repair missed it too: it delayed the store's credit, but money still captured at the scan. v3 cut it by about 99%. Some attacker profit remains.
- **Subscription trap.** Cut by about a quarter, as a side effect of other rules. Nothing targets it, and an attacker still clears about $3,200 a day.
- **Triangulation.** Missed by every rulebook but Fortress, which only stops it by refusing most trade. Every signal the gate has looks honest.

## Adaptive attacker

A search for the most profitable sleeper against Frozen v3, on development days, scored on 12 of the test days. "Declared" keeps to the first threat model. "Unlocked" may also wash and ship empty. "Random" is the same budget with no evolution.

| Attacker | Tries | Profit before | Profit after | Stolen after | Over the bound |
| --- | --- | --- | --- | --- | --- |
| declared | 32 | $1,345 | $4,175 [$3,108, $5,323] | $10,951 | $0 |
| unlocked | 32 | $1,345 | $3,905 [$2,836, $4,946] | $8,634 | $0 |
| random | 32 | $1,345 | $3,806 [$2,802, $4,825] | $8,693 | $0 |

The bound held. **Frozen v3 does not make the sleeper unprofitable:** a small search takes it from about $1,345 to about $4,000 a day. Against v1 the unlocked attacker reached $11,422, and against v2 $10,248. At 32 tries, evolution did little better than random, so this says little about a stronger attacker.

## Assumptions

Twelve changed assumptions, on 12 days each: owner approval rates, how easily agents are fooled, cost of goods, rising stores, sleeper stores, doubled attackers and no faults.

The order of the top two is not stable. Frozen v1 came first under 7 and Frozen v3 under 5, and the two are close. Every other rulebook stayed below both in all 12. v3 led with more sleepers, with doubled attackers, with owners who approve nearly every step-up, and with the number of rising stores changed either way. v1 led in the rest, including the assumptions as stated. So v3 is the more defensive choice, not a free upgrade.

## Can the search be trusted?

At a matched budget of 36 rulebooks on 8 days, evolution kept $101,818 a day on average over five runs. Random search kept $96,560 in all five: none of its draws beat the best preset it started with, so that figure is a preset.

## Can a model repair a rulebook?

Not in this test. Llama 3.1 8B read the incident and proposed rule changes, with blind mutation as the control, at 10 tries over three runs each, both through `applyPatch`. **None of the model's changes were kept.** `applyPatch` rejected 11 of its 30 proposals, mostly attempts to change an invariant. Mutation had 4 changes kept. A larger model may do better; this has not been tested. Containment held in every case, and `policy-patch.test.ts` covers malformed and hostile patches.

## What this cannot tell you

- The attacks and the defense share an author. Round-one hold-outs were written after the freeze, but by the same people.
- Fees, cost of goods and approval rates are assumptions, listed in `ASSUMPTIONS` in `packages/core/src/world.ts`.
- Rulebooks were tuned on `kept`, so results favour that measure.
- v1 was tuned before the exposure race was fixed.
- Lab-Tuned and Hand-written are baselines we wrote. A stronger team would write stronger ones.
