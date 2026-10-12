/**
 * Synthetic market data with a KNOWN ground truth.
 *
 * ⭐ THIS IS THE POINT OF THE WHOLE REPOSITORY, so it is worth being explicit.
 *
 * On real data you can never check whether a validation method got the right
 * answer, because nobody knows the right answer. So this generator builds
 * markets where the answer IS known in advance:
 *
 *   NULL          no edge at all. A correct harness must REJECT any strategy
 *                 tested on it, at roughly the rate the significance level
 *                 promises and no more. This measures FALSE POSITIVES.
 *
 *   REGIME-ONLY   an edge that exists ONLY while the market trends up. This is
 *                 the single most common way a backtest lies, and a harness
 *                 that cannot catch it is worthless. A correct harness reports
 *                 a strong headline AND a regime split that kills it.
 *
 *   GENUINE       an edge present in both regimes. A correct harness must FIND
 *                 it, otherwise the method is merely conservative rather than
 *                 discriminating - it would reject everything, including the
 *                 things worth trading. This measures POWER.
 *
 * Any harness can reject everything. Any harness can accept everything. The
 * test that means something is whether it separates these three.
 */
import { rng } from './rng.mjs';

/**
 * A regime path: long stretches of up-drift and down-drift, so that "the
 * market trend" is a real, persistent property rather than day-to-day noise.
 * Persistence matters - an edge that correlates with a *flickering* regime is
 * a different, easier problem than one that correlates with a real bull market.
 */
function regimePath(n, r, meanRun = 120) {
  const path = new Array(n);
  let state = r.next() < 0.5 ? 1 : -1;
  let left = 1 + r.int(meanRun);
  for (let i = 0; i < n; i++) {
    if (left-- <= 0) { state = -state; left = 1 + r.int(meanRun); }
    path[i] = state;
  }
  return path;
}

/**
 * One instrument's daily bars.
 *
 * `signal` is a latent per-day value the planted edge is attached to; a
 * strategy cannot see it, but an edge CAN be made to depend on it, which is how
 * a real, detectable effect gets planted without hand-placing trades.
 */
function series({ n, r, kind, dailyVol, regime }) {
  const close = new Array(n);
  const high = new Array(n);
  const low = new Array(n);
  const signal = new Array(n);
  let px = 100;

  for (let i = 0; i < n; i++) {
    // The latent state: persistent, mean-reverting, and invisible to strategies.
    signal[i] = i === 0 ? r.normal() : signal[i - 1] * 0.94 + r.normal() * 0.34;

    // Baseline drift follows the regime, so prices actually trend.
    const drift = regime[i] * dailyVol * 0.045;

    // THE PLANTED EDGE. It raises tomorrow's expected return when the latent
    // state is high - and `kind` decides when it is switched on.
    let edge = 0;
    const strength = dailyVol * 0.11;
    if (kind === 'genuine') edge = Math.tanh(signal[i]) * strength;
    else if (kind === 'regime-only') edge = regime[i] > 0 ? Math.tanh(signal[i]) * strength * 2 : 0;
    // kind === 'null' leaves edge at 0.

    const ret = drift + edge + r.normal() * dailyVol;
    px = Math.max(0.01, px * (1 + ret));
    close[i] = px;
    // Intrabar range, needed by breakout rules. Deliberately modest so the
    // high/low cannot smuggle in information the close does not have.
    const wick = Math.abs(r.normal()) * dailyVol * 0.6;
    high[i] = px * (1 + wick);
    low[i] = px * (1 - wick);
  }
  return { close, high, low, signal };
}

/**
 * A whole synthetic universe.
 *
 * ⚠️ ONE REGIME PATH IS SHARED BY EVERY INSTRUMENT, on purpose. Real asset
 * classes move together, and that correlation is exactly what makes the naive
 * sample size a lie. A generator that gave each instrument an independent
 * regime would quietly make the statistics easier than reality and the harness
 * would look better than it is.
 */
export function universe({ seed = 1, instruments = 40, days = 1200, kind = 'null', dailyVol = 0.025 } = {}) {
  const r = rng(seed);
  const regime = regimePath(days, r);
  const data = [];
  for (let k = 0; k < instruments; k++) {
    // Per-instrument volatility spread, so one sigma rule must cope with variety.
    const vol = dailyVol * (0.6 + r.next() * 0.9);
    data.push({ symbol: `SYN${String(k).padStart(3, '0')}`, ...series({ n: days, r, kind, dailyVol: vol, regime }) });
  }
  return { kind, seed, days, regime, instruments: data };
}
