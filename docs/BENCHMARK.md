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
| 4 | Frozen v4, `21f9e9e058929585` | `fair-01` to `fair-30` | Same safeguards on every arm, corrected measure, rule declared first: [evidence/round-four.md](../evidence/round-four.md) |

Each search tried about 150 rulebooks. The rule evaluator takes about 2 microseconds a decision at the median on a laptop, without signature checks or network.

## Results

### Round four

An outside review pointed out that v1 left the owner mandate off, so comparing it with v3 mixed two things. Here every arm carries the same four safeguards, including the baselines, so these rows are not the rulebooks of earlier rounds. The rule for picking a winner was written before v4 was tuned.

| Rulebook | Value kept / day | Stolen / day | Honest access | New stores refused | Step-ups / 100 | Held $·hours | Sleeper stolen | Sleeper profit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Wild West | $79,918 [$77,975, $81,976] | $24,698 [$23,697, $25,841] | 96.9% | 2.7% | 17.2 | $0 | $3,150 | $4,017 |
| Simple limits | $83,565 [$81,544, $85,566] | $20,958 [$20,157, $21,892] | 96.8% | 2.8% | 17.2 | $0 | $3,150 | $4,016 |
| Fortress | $45,879 [$44,264, $47,423] | $2,781 [$2,536, $3,031] | 41.9% | 94.3% | 9.5 | $0 | $0 | -$212 |
| Lab-Tuned | $89,274 [$87,415, $91,222] | $8,609 [$8,131, $9,096] | 88.8% | 10.7% | 17.2 | $32,280 | $2,490 | $3,367 |
| Hand-written | $89,578 [$87,684, $91,552] | $8,305 [$7,878, $8,742] | 88.8% | 10.7% | 17.2 | $32,512 | $2,186 | $3,075 |
| Frozen v1 | $98,546 [$96,713, $100,303] | $6,343 [$5,909, $6,765] | 95.5% | 4.0% | 18.1 | $45,878 | $382 | $1,429 |
| Frozen v2 | $98,186 [$96,331, $100,050] | $5,651 [$5,290, $6,008] | 94.9% | 3.9% | 17.8 | $111,794 | $22 | $1,062 |
| Frozen v3 | $98,674 [$96,902, $100,463] | $5,062 [$4,652, $5,485] | 95.6% | 4.0% | 17.6 | $710,776 | $48 | $1,016 |
| Frozen v4 | $99,118 [$97,195, $100,955] | $5,940 [$5,526, $6,379] | 95.6% | 4.0% | 17.6 | $113,458 | $23 | $1,097 |

| Rulebook | Honest access, exact | Fraud stopped | Meets the bar |
| --- | --- | --- | --- |
| Frozen v4 | 95.61% | 88.31% | Yes |
| Frozen v3 | 95.61% | 89.41% | Yes |
| Frozen v1 | 95.54% | 87.51% | Yes |
| Frozen v2 | 94.90% | 88.87% | No, access |
| Lab-Tuned | 88.84% | 83.08% | No, both |
| Hand-written | 88.84% | 83.65% | No, both |
| Simple limits | 96.78% | 58.65% | No, fraud |
| Wild West | 96.87% | 51.34% | No, fraud |
| Fortress | 41.87% | 94.42% | No, access |

**The declared rule picks Frozen v4.** It leads v3 by $443 a day ($233 to $647), so the tie rule does not apply. That is under half a percent of value, and it is a lead on one objective, not a safest rulebook.

**What it costs.** v3 stops $878 a day more ($750 to $1,013). Held out, a store shipping empty boxes takes $2,953 a day under v4 and $48 under v3, and v3 is the only rulebook that stops it. Those stores are not on these days, so this table alone would hide that. v4 holds 84% less honest money than v3.

**Where one is better than the other depends on your prices.** v3 passes v4 once a stolen dollar costs more than $1.50. **Is it worth it?** in the app prices every rulebook this way.

**A correction.** Earlier versions of this page put 17.5 step-ups per 100 down to v3, against 5.3 for v1. Here every arm but Fortress is between 17.2 and 18.1, so nearly all of that gap was the owner mandate. Safeguards cost step-ups. v3's own cost is the money it holds.

The extra columns were recorded by rerunning the same days after the first pass, because the first pass rounded access and did not keep fraud stopped. Every other field came back identical. Frozen v2 would have passed on the rounded figure.

Under the 12 changed assumptions, v4 came first under 11 and v3 under doubled attackers. Subscription traps and triangulation got through every rulebook.

### Round three

| Rulebook | Value kept / day | Stolen / day | Honest access | New stores refused | Step-ups / 100 | Held $·hours | Sleeper stolen | Sleeper profit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Wild West | $63,717 [$60,395, $67,097] | $43,932 [$42,192, $45,823] | 100.0% | 0.0% | 0 | $0 | $3,805 | $4,966 |
| Simple limits | $73,755 [$70,526, $76,949] | $37,395 [$35,914, $39,053] | 100.0% | 0.1% | 0 | $0 | $3,803 | $4,959 |
| Fortress | $47,422 [$45,567, $49,291] | $2,972 [$2,695, $3,271] | 43.0% | 93.0% | 9.6 | $0 | $0 | -$215 |
| Lab-Tuned | $93,815 [$91,533, $96,187] | $9,302 [$8,739, $9,871] | 91.0% | 8.9% | 4.1 | $32,678 | $2,830 | $3,925 |
| Hand-written | $94,085 [$91,859, $96,417] | $9,031 [$8,540, $9,540] | 91.0% | 8.9% | 4.1 | $32,795 | $2,561 | $3,666 |
| Frozen v1 | $104,080 [$101,554, $106,654] | $6,620 [$6,270, $6,996] | 98.0% | 2.0% | 5.3 | $47,728 | $445 | $1,734 |
| Frozen v2 | $97,768 [$95,756, $99,675] | $6,098 [$5,681, $6,508] | 95.0% | 4.0% | 17.5 | $110,972 | $24 | $1,205 |
| Frozen v3 | $99,146 [$96,874, $101,525] | $5,191 [$4,876, $5,508] | 96.0% | 4.0% | 17.5 | $713,722 | $54 | $1,180 |

### Round two

| Rulebook | Value kept / day | Stolen / day | Honest access | New stores refused | Step-ups / 100 | Held $·hours | Sleeper stolen | Sleeper profit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Wild West | $65,032 [$62,407, $67,655] | $43,083 [$41,324, $45,094] | 100.0% | 0.0% | 0 | $0 | $3,903 | $4,890 |
| Simple limits | $75,424 [$72,928, $77,930] | $36,317 [$34,696, $38,181] | 100.0% | 0.1% | 0 | $0 | $3,901 | $4,887 |
| Fortress | $47,974 [$46,256, $49,714] | $3,016 [$2,782, $3,248] | 43.0% | 93.9% | 9.5 | $0 | $0 | -$218 |
| Lab-Tuned | $94,704 [$92,687, $96,795] | $9,495 [$8,869, $10,164] | 91.0% | 8.3% | 4.3 | $32,178 | $2,925 | $3,966 |
| Hand-written | $95,177 [$93,106, $97,272] | $9,021 [$8,518, $9,539] | 91.0% | 8.3% | 4.3 | $32,407 | $2,453 | $3,511 |
| Frozen v1 | $104,604 [$102,461, $106,759] | $6,526 [$6,193, $6,883] | 98.0% | 1.9% | 5.3 | $48,574 | $437 | $1,700 |
| Frozen v2 | $99,119 [$97,082, $101,232] | $5,790 [$5,519, $6,076] | 95.0% | 4.0% | 17.5 | $112,551 | $33 | $1,240 |

### Round one

| Rulebook | Value kept / day | Stolen / day | Honest access | New stores refused | Step-ups / 100 | Held $·hours | Sleeper stolen | Sleeper profit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Wild West | $65,750 [$63,242, $68,122] | $42,911 [$41,345, $44,544] | 100.0% | 0.0% | 0 | $0 | $4,022 | $5,037 |
| Simple limits | $75,468 [$72,975, $78,082] | $36,863 [$35,209, $38,484] | 100.0% | 0.1% | 0 | $0 | $4,018 | $5,032 |
| Fortress | $48,207 [$46,124, $50,231] | $3,064 [$2,704, $3,415] | 43.0% | 94.1% | 9.7 | $0 | $0 | -$219 |
| Lab-Tuned | $94,705 [$92,519, $96,733] | $9,731 [$9,162, $10,268] | 91.0% | 8.9% | 4.5 | $33,794 | $2,911 | $3,872 |
| Hand-written | $95,129 [$92,925, $97,251] | $9,307 [$8,767, $9,788] | 91.0% | 8.9% | 4.5 | $33,908 | $2,486 | $3,465 |
| Frozen | $104,702 [$102,446, $106,882] | $6,915 [$6,436, $7,397] | 98.0% | 2.2% | 5.5 | $49,989 | $426 | $1,597 |

**Reading round three.** Frozen v3 keeps $4,935 a day less than Frozen v1 ($4,420 to $5,498). Frozen v3 stops $1,429 more a day ($1,287 to $1,571), and it is the rulebook that holds the sleeper to $54 and the empty box to $54. It shows 17.5 step-ups per 100 orders against 5.3 and about 15 times the honest money held, for longer, but v1 here has no owner mandate, so round four is the fair comparison. Honest access is 96.0% against 98.0%.

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

Frozen v1 came first under all 12. Frozen v3 came second under 11, and fell below Hand-written and Lab-Tuned when owners approve 60% of step-ups, because it asks them far more often. So v3 is the defensive choice and it costs value. It is not the better rulebook on value under any of these assumptions.

## Can the search be trusted?

At a matched budget of 36 rulebooks on 8 days, evolution kept $100,012 a day on average over five runs. Random search kept $96,560 in all five: none of its draws beat the best preset it started with, so that figure is a preset.

## Can a model repair a rulebook?

Not in this test. Llama 3.1 8B read the incident and proposed rule changes, with blind mutation as the control, at 10 tries over three runs each, both through `applyPatch`. **None of the model's changes were kept.** `applyPatch` rejected 11 of its 30 proposals, mostly attempts to change an invariant. Mutation had 4 changes kept. A larger model may do better; this has not been tested. Containment held in every case, and `policy-patch.test.ts` covers malformed and hostile patches.

## A measure we corrected

An outside review found that `kept` credited an honest order when the carrier scanned it, so an order scanned and then voided or never delivered still counted. The measure now credits an order only when it arrives and stays paid.

We re-scored all three rounds on their own days, with the same rulebooks and no retuning. The order flow did not change: stolen money, access, holds, step-ups and every attacker figure came out identical, and only `fulfilled` and `kept` moved. These days had already been read, so this is a corrected score, not a fresh test.

| What moved | Before | After |
| --- | --- | --- |
| Frozen v3, value kept a day | $104,110 | $99,146 |
| Frozen v3 against v1 | $29 ahead, no real difference | $4,935 behind |
| First place under 12 changed assumptions | v1 under 7, v3 under 5 | v1 under all 12 |
| Evolved rulebooks, value kept a day | $101,818 | $100,012 |

Almost all of the change is Frozen v3. It holds far more honest money, so far more complaints ended in a void, and the old measure kept counting those orders once they were scanned: about $5,250 a day on a sample of ten days. Other rulebooks moved by $11 a day or less.

## What this cannot tell you

- The attacks and the defense share an author. Round-one hold-outs were written after the freeze, but by the same people.
- Fees, cost of goods and approval rates are assumptions, listed in `ASSUMPTIONS` in `packages/core/src/world.ts`.
- Rulebooks were tuned on `kept`, so results favour that measure. v1, v2 and v3 were tuned on the earlier `kept`, described above, and v4 on the corrected one, so round four favours v4.
- Round four's lead is small, and its thresholds are a stated preference chosen after seeing development days.
- v1 was tuned before the exposure race was fixed.
- Lab-Tuned and Hand-written are baselines we wrote. A stronger team would write stronger ones.
