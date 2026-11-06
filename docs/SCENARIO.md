# The sleeper store

The flagship failure, stated so that someone else can check it. All figures are per simulated day, on the 30 round-three days. Tables: [BENCHMARK.md](BENCHMARK.md).

## The eight questions

**Who is the victim?** Honest buyers, through their shopping agents. They pay for goods that never ship, and a vanished store cannot refund them.

**What can the attacker do?** Open a store, run it honestly, buy paid reach, discount and bundle, stop shipping. In the held-out versions, also buy from itself and ship empty parcels. It cannot touch the gate, PayPal or another store.

**What permission does reputation unlock?** Instant capture. A new store's orders are held by a PayPal authorization, while a store with a record gets the money when the buyer pays, and that record also earns it reach with agents choosing a store.

**What action causes the loss?** After warm-up the store stops shipping and keeps taking orders. Each order is normal. Nothing at the gate is wrong with any single one.

**Which rule is violated?** No store may hold more unfulfilled money than its delivered record supports: `exposure <= floor + ratio x credit`.

**What does it cost?** Under Wild West, $3,805 stolen. Under Lab-Tuned, $2,830.

**Does the attacker profit after warm-up?** Yes, without the bound: $4,966 under Wild West and $3,925 under Lab-Tuned, after goods, fees and ads. Under Frozen v3 it clears $1,180, of which only $54 is stolen. The rest is margin on goods it really delivered. An adapted attacker gets back to about $4,000, so the bound limits this attack without ending it.

**Which honest users does a simple defense block?** Simple limits stop almost none of it: $3,803 of $3,805 still goes. Blocking anything unproven does stop it, but Fortress refuses 93.0% of orders at new stores and honest access falls to 43.0%. Frozen v3 refuses 4.0% of those orders, and its cost lands elsewhere: more step-ups for owners and money held longer for honest stores.

## How to see it

- Press **E** in the app.
- `npx tsx --env-file=.env scripts/sleeper-checkout.ts --sandbox` runs it through the real checkout. On the PayPal sandbox the store kept $574.82 under Lab-Tuned and $64.48 under Frozen v3. See [CHECKOUT.md](CHECKOUT.md).
- `npx tsx scripts/regress.ts regressions/day-sleeper-store.json` replays the failure to the cent under two rulebooks.
- `regressions/day-empty-box.json` is the variant that beat the first two rulebooks.
