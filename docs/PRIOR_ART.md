# Prior art

The closest work we have read, what it does, and where this project differs. Nothing here says Sandbox City is first or better: these are different instruments, compared on features, and we have not run any of them.

| | Agentic Commerce Bench / gordonguard | APort Vault | AIP-Bench | Sandbox City |
| --- | --- | --- | --- | --- |
| Reference | arXiv 2609.35886 | arXiv 2609.22076 | arXiv 2607.21824 | this repository |
| Main question | Can a guard classify fraud in agent commerce? | Can attackers get past a pre-action check? | Agent payment benchmark | What does a rulebook cost, and does the attacker still profit? |
| Scale | 20 fraud classes | 4,371 CTF attacks, 14 models | Not read in depth | One simulated city, 30 frozen test days per round |
| Check | Offline replay and inline guard | Deterministic check on recipients | Not read in depth | Deterministic evaluator, shared by simulation and checkout |
| Reported honest cost | 6.5% clean flag rate | Not read in depth | Not read in depth | Honest access, by cohort, with intervals |

Agentic Commerce Bench also reports that 8 of 20 classes do no better than chance. It is broader than this project on fraud classes. APort Vault has far more real attack attempts. Our attacks are written by the same author as the defense.

## What this project adds, for a reader to judge

- Attacker books: take, costs and profit after warm-up, not only a detection rate.
- A stated exposure bound, checked as an invariant on every simulated day.
- Mechanisms held out from tuning, with misses reported.
- Failures exported as reduced, replayable regressions.
- The payment path across a crash, with a real process kill and a double-charge control.

## Older ideas this builds on

Reserves and rolling holds on new sellers are standard marketplace practice, and the exposure bound is a version of that idea. Delta debugging (Zeller and Hildebrandt) is the method behind the reducers. Idempotency keys and read-your-own-writes recovery are standard payment engineering. Web Bot Auth builds on RFC 9421.
