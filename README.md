# Strategy validation harness

**A reproducible test rig for deciding whether a trading edge is real — and a way to check that the rig itself works.**

No dependencies. No network. No API key. Clone it and run it.

```bash
node run.mjs                   # an edge that exists only in a bull market
node run.mjs --market null     # no edge at all
node run.mjs --market genuine  # a real edge, in both regimes
node test.mjs                  # the assertions
```

---

## The problem this exists for

A backtest tells you what a rule would have done. It does not tell you whether the rule has an edge, because the most common cause of a good backtest is that the sample contained a bull market and the rule was long.

That failure is easy to describe and hard to catch, because **the headline number looks excellent while it is happening.** In the default run below, a strategy posts **+0.18R at t = 6.15** — and it is worthless.

## What makes this testable

Most validation code cannot be validated. You run it on real data, it gives an answer, and nobody knows whether the answer is right.

So this runs on **synthetic markets whose ground truth is known in advance:**

| market | what is planted | what a correct harness must do |
|---|---|---|
| `null` | nothing | **reject everything.** Promotions here are false positives |
| `regime-only` | an edge present only while the market trends up | **reject everything** — and still show a strong headline, because that is the trap |
| `genuine` | an edge present in both regimes | **find it.** A harness that rejects this has no power |

**Any method can reject everything. Any method can accept everything. The only interesting question is whether it separates these three** — and that is what `test.mjs` asserts, across many seeds.

## The default run

```
Donchian breakout (20)
  headline   edge 0.1762R   t=6.15   n=5808 fired / 40752 control
  rising     edge 0.2341R   t=5.45   n=3212
  falling    edge -0.0102R  t=-0.28  n=2596
  bootstrap  p=0.0000   95% CI [0.1241, 0.2299]   over 1164 dates
  VERDICT    REJECT
             the edge inverts in falling markets: 0.2341R rising against
             -0.0102R falling - the edge IS the regime
```

**t = 6.15 on nearly six thousand signals, and it is nothing.** That is the entire point of the repository in one block of output.

## Method

**R, not percentage return.** `R = (exit − entry) / (entry − stop)`. A percentage return mixes signal quality with position size; R measures the move against the risk taken, so a strategy cannot look good by betting more. A stopped trade is −1R by construction, and the stop is checked against the **low**, because a stop that can only be hit by a close pretends gaps do not happen.

**The control is not a random entry.** It is every *non-firing* day, on the same instruments and the same dates, scored with the identical stop and horizon. A random-entry control measures a strategy against nothing in particular; a same-day control removes the market's own drift — the thing most likely to be mistaken for an edge.

**A block bootstrap by calendar date, not a naive t-test.** Forty instruments in one asset class on one day are largely *one* observation wearing forty hats. The nominal sample size overstates the evidence, often by a lot. Resampling whole dates keeps that correlation intact and widens the interval to something honest. `test.mjs` asserts the bootstrap interval is actually wider than the naive one — otherwise the correction would be decoration.

**Bonferroni over the number of strategies tested**, passed in as an explicit argument so the count is something a person has to supply rather than quietly forget between the screen and the write-up.

**A verdict, not a number.** `classify()` applies fixed rules to every strategy identically: an edge that needs a rising market is REJECT; surviving both regimes on thin falling-regime evidence is INCONCLUSIVE, which is **not** a pass; PROMISING requires clearing the corrected threshold in both regimes.

**Look-ahead is prevented mechanically.** Every strategy is re-run on a series truncated at the decision day, and the answer must not change. "We were careful" is not a control.

## What the tests actually assert

```
PASSED  22 passed, 0 failed

false positives   1/48 = 2.1% on the null market (nominal 1.25%, bound 6%)
the regime trap   6 strategy-runs with t > 3, and 0 of them promoted
power             3/4 seeds find the genuine edge at a sample sized to see it
look-ahead        4 strategies x ~150 decision days, 0 future reads
bootstrap         interval wider than the naive one, on a correlated universe
determinism       two runs at one seed give identical verdicts
```

### Two of these tests failed when first written, and the failures were the useful part

**The false-positive test originally asserted zero.** It failed: 1 promotion in 24 runs. **The test was wrong, not the harness** — a test run at α does not promise zero false positives, it promises they arrive at about α. Demanding zero would have meant tuning the method until it could not promote anything at all, which is precisely the blindness the power test exists to catch. It now asserts a *rate bound* and prints the rate. The bound is deliberately loose, because ~48 runs cannot resolve a 1% rate and pretending otherwise would be the same overstatement this repository is about.

**The power test also failed**, at 2 of 6 seeds. The reason is a finding rather than a bug: it was running on the small universe the other tests share, and at that sample size the method cannot see an effect that small. That is a true statement *about the method*, and it is exactly why a power calculation belongs before a study rather than after it. It now runs on a universe sized to have power, and says so.

## Limitations, stated rather than discovered later

- **Synthetic data is not a market.** It has no microstructure, no liquidity, no fat tails worth the name, no news. It is a controlled environment for testing the *method*, not evidence about any real strategy.
- **Results are gross of costs.** Fees and slippage move every number down. They cannot rescue a rejection, but they would matter for a marginal pass.
- **One regime variable, specified in advance.** Richer regime definitions are a different study and would need their own pre-registration.
- **Bonferroni is conservative.** With many correlated strategies it over-corrects. That is a deliberate direction to err in.

## Layout

```
run.mjs             the report
test.mjs            the assertions, including the ground-truth recovery tests
src/rng.mjs         seeded RNG - every run is reproducible from one integer
src/synth.mjs       the three synthetic markets, and why one shared regime path
src/strategies.mjs  four published rules, each a pure function of bars <= i
src/stats.mjs       Welch, Bonferroni, and the block bootstrap by date
src/screen.mjs      scoring, the control, the regime split, and the verdict
```

MIT.
