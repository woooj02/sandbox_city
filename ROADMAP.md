# Roadmap

Product work in progress. Items are ticked as they land on `main`.

## Now

- [x] **Welcome screen.** First visit offers "Watch the film" or "Explore the lab", with a three-line explanation.
- [x] **Report fixes.** Honest subtitle on the twin, buttons to race the winning rulebook or run auto-tune, one word for money lost everywhere.
- [x] **PayPal proof on the twin.** Show the last verified sandbox reconcile (orders, refunds, total, run id, PayPal ids).
- [x] **Server hardening.** Clamp request sizes, cancel searches on disconnect, cap concurrent live sessions, run heavy searches off the main thread.
- [x] **Small screens.** Fix 1366×768 (clock wrap, metrics panel); one column on phones, city first.
- [x] **AG Grid extras.** Editable rulebook grid, ledger CSV export, totals row for the filtered view.
- [x] **Quieter alerts when exploring.** Full-screen alerts only for large breaches outside the film.

## Next

- [x] **Model-driven shoppers.** A lane where a language model reads real listing text (injections included) and decides what to buy through the same gate. Runs are recorded so a seed still replays exactly. Recorded with Gemma 4 26B (open weights, no paid tier): 288 cases on the default day. The model followed the planted instructions in every poisoned listing it read (42 of 42 under Wild West); the gate is what limits the damage. Try `?brain=1`.
- [x] **Model shoppers in the film.** Act VI: every honest shopper's agent is the recorded model, racing Wild West against Lab-Tuned with a plain prompt and then a careful one (`#act6`, and after Act V).
- [x] **A careful agent.** The same model recorded with a prompt that treats page text as untrusted, to show what a better prompt fixes and what still has to be stopped at the gate (`?brain=guarded`, or click the model badge again).
- [x] **More recorded days.** Both prompts cover the default day and the three training days auto-tune uses, so tuning with model shoppers on stays on recorded decisions.
- [x] **PayPal Agent Toolkit shop.** A model shopper pays through `@paypal/agent-toolkit` on the sandbox, calling its tools itself, with the gate checking every call and every paid order read back by id.

## Evidence

- [x] **One evaluator.** The simulation and the checkout share `evaluateOrder` and a rulebook hash.
- [x] **Frozen benchmark.** Three rounds on separate days, with held-out mechanisms and misses reported.
- [x] **Paying exactly once.** Durable worker, crash proof, one real capture webhook verified on the hosted app. Other event types are untested.
- [x] **Portable regressions.** A stdin and stdout agent contract, with reduced cases.
- [x] **Durable path on the PayPal sandbox.** Crash recovery, checkout and holds all ran there.
- [x] **Every exposed path holds the same line.** Socket input, live adapter, reconciliation, partial refunds and webhooks.
- [x] **Value delivered means delivered.** Re-scored on all three rounds.
- [x] **The sleeper at the checkout.** Real holds, voids and evolving history, from one simulated day's record.
- [ ] **Webhooks on the PayPal sandbox.** Needs a public URL, and may need the raw request body.
- [ ] **External builder test.** Needs a real person.

