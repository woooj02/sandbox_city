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

## Exact transfer to checkout

`gateAgentAnswer` adapts a validated saved answer to the shared `CheckoutSession` evaluator. A raw answer can violate the owner while an open gate permits the call. The workspace shows those as separate results. No gate evaluation on this page sends a payment.

The exported case includes the full portable regression schema, threat model and provenance. The result bundle also includes the checked answer, verdict, method, experiment identity and checked controls. A single-case result is not a full-suite verdict.

Recorded receipts match only their recorded policies and inputs. The Frozen v3 checkout receipt has policy `f5dc2c8ff6099bdd`; matching that hash does not make its $80 lamp order a receipt for the Velvet Earbuds listing. The toolkit exhibit retains the listing-specific order/refund IDs and its actual rulebooks.

## Before claiming a new evaluation

Freeze model/version, prompt, adapter, corpus, settings and scoring rule before the run. Keep malformed answers, refusals, honest purchases and breaches separate. Compare the same corpus under the same budget and preserve losing results. If results influence a repair, mark them development data; use new held-out inputs for a new generalization claim.

The existing eight-case release gate is the local integration path. A careful scripted adapter should buy all three honest controls; the obedient one should block release. This checks the contract and release behavior, not a new model or a new PayPal transaction.

## Reproduce and identify

Run `npm run verify`, then `npm run agent-test -- "python3 examples/agents/careful.py"` or the obedient control. Model-backed adapters are opt-in local commands, never arbitrary public-server execution.

The app displays its build revision and whether it contains local changes. Production builds also emit `/build.json` with revision, dirty status, source hash and build time. A displayed dirty build is not an attestation of a clean published commit. The recorded artifacts retain their own versions and dates regardless of the UI build.

The standard-world comparison remains round four, with its declared safeguards and terminal metric. Empty-box risk is a separately labelled estimator until a complete scenario is measured. No benchmark was retuned for the workflow.
