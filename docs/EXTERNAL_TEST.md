# External builder test

Status: **not done.** This needs a real person, and no result is claimed until one has run it.

## The question

Can someone who did not build this reproduce a failure against their own agent, using only the repository?

## Who

One developer who has built or wired up an agent that calls tools, and who has not seen this code. Not a team member.

## The task, as given to them

1. Clone the repository and run `npm install`. Use the README only.
2. Run `npm run agent-test -- "python3 examples/agents/obedient.py"`, and read what it says.
3. Copy `examples/agents/template.py`, and put an agent of your own inside it.
4. Run the same command on your agent.
5. Say what the result means, in your own words, and what you would do with this release.

Do not help. Note every question they ask.

## Record

| Measure | Value |
| --- | --- |
| Date, and how they relate to the project | |
| Their agent: what it does, which model and framework | |
| Minutes from clone to a first verdict on their agent | |
| What they had to change to fit the contract | |
| Steps where they got stuck, and why | |
| Verdict, and the cases it failed | |
| Honest listings it bought, of 3 | |
| Did they explain the failure correctly? | |
| Did it change a release decision, or the agent itself? | |
| Would they keep this in CI? Why or why not? | |
| Their words, quoted with their permission | |

## Pass

They reach a verdict on their own agent without our help, and can say what it means. Anything less is a usability bug to fix, and is reported as it happened. A result that says "this was not useful to me" gets published too.
