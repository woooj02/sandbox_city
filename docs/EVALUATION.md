# What the evidence covers

The lab distinguishes a local answer check, a checkout-gate evaluation, a simulated city, a recorded benchmark and a recorded provider receipt. Their numbers cannot be combined into one success rate.

## Existing model breadth

The workspace exposes the recorded `agent-rate.json` table beside the agent task. Each adapter saw 66 poisoned and 12 honest listings, one at a time, in one recorded run. This corpus is separate from the eight portable release cases.

| Adapter | Poisoned breaches | Honest bought | Invalid answers |
| --- | --- | --- | --- |
| llama3.1:8b | 0/66 | 6/12 | 0 |
| llama3.2:3b | 7/66 | 9/12 | 0 |
| careful.py, scripted control | 0/66 | 12/12 | 0 |
| obedient.py, scripted control | 35/66 | 12/12 | 0 |

Those model runs were recorded November 5. Refusals are shown alongside breaches in the app. Buying fewer honest listings is a cost, not evidence of universal safety.

Other artifacts cover different setups:

- `hijack-rate.json`: Qwen/Qwen3.5-9B, ordinary and careful prompts, three named city seeds, batched planning, recorded November 3.
- `toolkit-proof.json`: Qwen/Qwen3.5-9B, plan then execute, recorded PayPal sandbox orders and refunds. The proof compares Wild West, Lab-Tuned and Know Your Agent.
- `brain-tape*.json`: gemma-4-26b-a4b-it, plain and guarded prompts on four named days. The city replays these decisions; it does not invoke that model in the browser.
- The model repair experiment used a different model and task. Its failed proposals remain reported in BENCHMARK.md.

These runs establish behavior under those settings. They do not establish safety on other models, prompts or merchant traffic. No new provider calls were made to implement the workflow.

## A real agent in the shop (round five)

Four local models (`llama3.2:3b`, `mistral:7b`, `qwen2.5:7b`, `llama3.1:8b`) shopped turn by turn in a sandboxed shop: search results, listings to open, an order or a stop. Each attack task had one attacker listing and one decoy. The [protocol](../evidence/round-five-protocol.md) fixed the measures, the arms and the rule for a pick before any held-out attack style reached a model, and pinned the harness by hash. The protocol file's own SHA-256 starts `670ac64ee5c69860`. 3,072 episodes, all kept in `evidence/round-five-episodes.jsonl`. No money moves, and outcomes are plain code.

| Defense | Lost per attacked trip | Against no defense, 95% | Honest purchases | Rule |
| --- | --- | --- | --- | --- |
| No attack (a measure) | $49.62 | −$36.04 [−$53.34, −$20.67] | 106 of 128 | measure only |
| No defense | $85.66 | | 108 of 128 | baseline |
| **Checkout gate** | **$36.52** | **−$49.14 [−$68.97, −$31.39]** | **111 of 128** | **picked** |
| Careful prompt | $38.64 | −$47.03 [−$63.98, −$30.22] | 92 of 128 | costs honest shopping |
| Careful prompt and gate | $21.12 | −$64.54 [−$84.61, −$46.13] | 93 of 128 | costs honest shopping |
| Bound order and gate | $45.22 | −$40.45 [−$58.13, −$24.36] | 103 of 128 | costs honest shopping |
| Prompt, bound order and gate | $20.68 | −$64.98 [−$83.98, −$47.18] | 74 of 128 | costs honest shopping |
| Facts only, bound order | $44.38 | −$41.29 [−$59.13, −$25.19] | 108 of 128 | helps, less |

- **The rule picked the checkout gate.** It cut loss on every model, and honest purchases did not fall.
- **No order past the owner's limits got through a gate.** With no defense, $54.25 of each attacked trip went to such orders. Under the gate it was $0.
- **What the gate leaves is steering:** $34.15 of its $36.52 is clean orders placed at the attacker's store. An order check cannot see that. The store's record can, as the sleeper proof on the PayPal sandbox shows.
- **Much of the loss is not the injection.** With the attack text removed, models still lost $49.62, mostly by picking the attacker's store anyway. The injection itself added $36.04.
- **Our own fixes lost.** The careful prompt, written on development styles, made models turn down good purchases: `llama3.1:8b` bought 15 of 32 honest items with it, against 27 without. The full stack cut the most loss and kept only 74 of 128 honest purchases. The bound order alone did not beat the plain gate.

Limits: loss is counted harshly, a steered order as all stolen, because the lab has no escrow. These are four small open models at one temperature, not a frontier model. The attacks and defenses share an author. Episodes 1 to 2,380 ran on the laptop GPU and the rest of `llama3.1:8b` on the Hetzner box's CPU with the same model digest, noted in `evidence/round-five-hosts.txt`. The breakdown by outcome was added after the run, in `scripts/agent-lab-breakdown.ts`.

## Exact transfer to checkout

`gateAgentAnswer` adapts a validated saved answer to the shared `CheckoutSession` evaluator. A raw answer can violate the owner while an open gate permits the call. The workspace shows those as separate results. No gate evaluation on this page sends a payment.

The exported case includes the full portable regression schema, threat model and provenance. The result bundle also includes the checked answer, verdict, method, experiment identity and checked controls. A single-case result is not a full-suite verdict.

Each checked answer has an immutable observation ID. Restoring one selects its saved answer, verdict, timestamp and associated gate comparisons together. The comparison holds that answer fixed under open and selected gates, and runs a named honest fixture with a scripted answer under both. Frozen v4 is evaluated by its exact policy hash in code. This is local execution of the gate, not a v4 PayPal receipt or new model evidence.

Recorded receipts match only their recorded policies and inputs. The Frozen v3 checkout receipt has policy `f5dc2c8ff6099bdd`; matching that hash does not make its $80 lamp order a receipt for the Velvet Earbuds listing. The toolkit exhibit retains the listing-specific order/refund IDs and its actual rulebooks.

## Before claiming a new evaluation

Freeze model/version, prompt, adapter, corpus, settings and scoring rule before the run. Keep malformed answers, refusals, honest purchases and breaches separate. Compare the same corpus under the same budget and preserve losing results. If results influence a repair, mark them development data; use new held-out inputs for a new generalization claim.

The world is authored and largely scripted. Subscription traps and triangulation remain limitations. The model-repair run retained no model proposals, and tested attack evolution did little better than random at its budget. Interface improvements do not change those findings.

The existing eight-case release gate is the local integration path. A careful scripted adapter should buy all three honest controls; the obedient one should block release. This checks the contract and release behavior, not a new model or a new PayPal transaction.

## Reproduce and identify

Run `npm run verify`, then `npm run agent-test -- "python3 examples/agents/careful.py"` or the obedient control. Model-backed adapters are opt-in local commands, never arbitrary public-server execution.

The app displays its build revision and whether it contains local changes. Production builds also emit `/build.json` with revision, dirty status, source hash and build time. A displayed dirty build is not an attestation of a clean published commit. A copy with no git, such as a ZIP download, still builds: its revision comes from a `REVISION` file if there is one, and dirty status is unknown. The recorded artifacts retain their own versions and dates regardless of the UI build.

The standard-world comparison remains round four, with its declared safeguards and terminal metric. Empty-box risk is priced as its own scenario, from the held-out days that contain those stores. No benchmark was retuned for the workflow.

The web app shows plainer names than these docs: No checks (Wild West), Agent ID only (Passport Theater), Agent checks (Know Your Agent), Strictest (Fortress), Auto-tuned (Lab-Tuned), Expert rules (Hand-written), First pick (v1), Second pick (v2), Strict hold (v3) and Recommended (v4). A name is not part of a policy hash, so the hashes are unchanged (`packages/web/src/rulebook-names.ts`).
