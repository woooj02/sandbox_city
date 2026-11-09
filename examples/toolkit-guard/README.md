# Toolkit guard

A checkout gate for an agent that pays through PayPal's Agent Toolkit. Wrap the toolkit, keep the rest of your agent.

```js
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/openai';
import { guardToolkit } from './toolkit-guard.mjs';

const toolkit = guardToolkit(new PayPalAgentToolkit({ clientId, clientSecret, configuration }), {
  owner: { category: 'home', qty: 1, address: '12 Neon St, Silk Row', budget: 100 }, // what the owner asked for
  rulebook: 'frozen-v4',  // or 'frozen-v3', or a rulebook downloaded from the app
});
// give the model toolkit.getTools(), and answer each tool call with toolkit.handleToolCall(call), as before
```

`toolkit-guard.mjs` is one file with the rulebooks inside it and no dependencies. Copy it into your project.

## What it does

- **`create_order`** goes through the evaluator the benchmark measured, under the rulebook you name. A refused order never
  reaches PayPal. The model gets the reason as the tool result, so it can tell its owner.
- **`pay_order`** is allowed only for an order this guard approved, and only if the amount PayPal holds for it (read back
  with `get_order`) is the amount the guard approved. If the order can't be read back, nothing is captured.
- Every other tool passes through. `toolkit.decisions` lists every allow and refuse, and `onDecision` gets each as it happens.

## Try it on the sandbox

```bash
node --env-file=.env examples/toolkit-guard/demo.mjs
```

It refuses an order a seller's page talked the agent into (8 lamps to a PO box), lets the owner's order through, captures
it, and refuses to capture an order it never saw. The tool calls are scripted so the run repeats; in your agent a model makes
them. A recorded run: [evidence/toolkit-guard-sandbox.txt](../../evidence/toolkit-guard-sandbox.txt).

## Limits

- Tested with `@paypal/agent-toolkit` 1.11.0 and its OpenAI-style `handleToolCall`. Other toolkit flavours need the same
  two checks wired to their tool runner.
- The guard knows the owner's mandate, the listing price you pass and the orders it saw. It has no store or agent history,
  so history rules (new store holds, velocity, reputation) treat every store and agent as established. For those, use
  `POST /api/checkout` with a history feed: [docs/CHECKOUT.md](../../docs/CHECKOUT.md).
- One guard is one owner request. Make a new one for the next request.

Source: `packages/server/src/toolkit-guard.ts`. Tests: `packages/server/test/toolkit-guard.test.ts` run the real toolkit
against the local PayPal contract mock. Rebuild the file with `npm run build:guard`.
