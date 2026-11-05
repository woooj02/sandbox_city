# External builder test

Status: **not done.** This needs a real person, and no result is claimed until one has run it.

## The question

Can someone who did not build this reproduce a failure against their own agent, using only the repository?

## Who

One developer who has built or wired up an agent that calls tools, and who has not seen this code. Not a team member.

## The task, as given to them

1. Clone the repository. Follow the README only.
2. Run `npm run verify`.
3. Run `npx tsx scripts/regress.ts regressions`.
4. Wrap an agent of your own in the stdin and stdout contract in `docs/REGRESSION.md`.
5. Run the agent cases against it.
6. Say what the failing case means, in your own words.

Do not help. Note every question they ask.

## Record

| Measure | Value |
| --- | --- |
| Date, and how they relate to the project | |
| Minutes to a first failing case on their agent | |
| Steps where they got stuck, and why | |
| Cases their agent failed | |
| Did they explain the failure correctly? | |
| Would they keep this in CI? Why or why not? | |
| Their words, quoted with their permission | |

## Pass

They reach a failing or passing verdict on their own agent without our help, and can say what it means. Anything less is a usability bug to fix, and is reported as it happened.
