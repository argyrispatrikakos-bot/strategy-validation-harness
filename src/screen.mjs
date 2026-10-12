/**
 * The harness: score a strategy against a control, split by regime, correct
 * for the number of tests, and return a decision rather than a number.
 */
import { rng } from './rng.mjs';
import { mean, welchT, blockBootstrapByDate, bonferroni } from './stats.mjs';

/** Trailing daily volatility, used only for the stop. Reads bars <= i. */
function dailyVol(close, i, lookback) {
  const start = Math.max(1, i - lookback + 1);
  const rets = [];
  for (let k = start; k <= i; k++) rets.push(close[k] / close[k - 1] - 1);
  if (rets.length < 5) return NaN;
  const m = mean(rets);
  return Math.sqrt(rets.reduce((a, x) => a + (x - m) ** 2, 0) / (rets.length - 1));
}

/**
 * ⛔ R, NOT PERCENTAGE RETURN, and the distinction is the whole measurement.
 *
 * A percentage return mixes the quality of the signal with the size of the
 * position. R = (exit - entry) / (entry - stop) measures the move against the
 * risk actually taken, so a strategy cannot look good merely by betting more.
 * A stopped-out trade is -1R by construction.
 */
function scoreOne(bars, i, { holdDays, stopSigma, volLookback }) {
  const entry = bars.close[i];
  const sigma = dailyVol(bars.close, i, volLookback);
  if (!Number.isFinite(sigma) || sigma <= 0) return null;
  const stop = entry * (1 - stopSigma * sigma);
  const risk = entry - stop;
  if (!(risk > 0)) return null;

  const last = Math.min(bars.close.length - 1, i + holdDays);
  if (last <= i) return null;

  for (let k = i + 1; k <= last; k++) {
    // The stop is checked against the LOW, because a stop that can only be hit
    // by a close is a stop that pretends gaps do not happen.
    if (bars.low[k] <= stop) return -1;
  }
  return (bars.close[last] - entry) / risk;
}

/**
 * Score every instrument-day for one strategy.
 *
 * ⭐ THE CONTROL IS NOT A RANDOM ENTRY. It is every NON-firing day, on the same
 * instruments and the same dates, scored by the identical stop and horizon. A
 * random-entry control measures the strategy against nothing in particular; a
 * same-day control removes the market's own drift, which is the thing most
 * likely to be mistaken for an edge.
 */
export function scoreStrategy(uni, strategy, opts) {
  const rows = [];
  for (const inst of uni.instruments) {
    const n = inst.close.length;
    for (let i = strategy.warmup; i < n - opts.holdDays - 1; i++) {
      const R = scoreOne(inst, i, opts);
      if (R === null) continue;
      rows.push({
        symbol: inst.symbol,
        date: i,                     // the index IS the calendar date here
        fired: strategy.fires(inst, i),
        regime: uni.regime[i] > 0 ? 'rising' : 'falling',
        R,
      });
    }
  }
  return rows;
}

const summarise = (rows) => {
  const fired = rows.filter((x) => x.fired).map((x) => x.R);
  const ctrl = rows.filter((x) => !x.fired).map((x) => x.R);
  return {
    n: fired.length,
    nControl: ctrl.length,
    edge: fired.length && ctrl.length ? mean(fired) - mean(ctrl) : NaN,
    t: welchT(fired, ctrl),
  };
};

/**
 * The full screen for one strategy: headline, both regimes, and a bootstrap.
 */
export function screenOne(uni, strategy, opts) {
  const rows = scoreStrategy(uni, strategy, opts);
  const r = rng(opts.seed ^ 0x5bf03635);

  const overall = summarise(rows);
  const rising = summarise(rows.filter((x) => x.regime === 'rising'));
  const falling = summarise(rows.filter((x) => x.regime === 'falling'));
  const boot = blockBootstrapByDate(rows, { iters: opts.bootstrapIters, r });
  const bootFalling = blockBootstrapByDate(rows.filter((x) => x.regime === 'falling'),
    { iters: opts.bootstrapIters, r });

  return { strategy: strategy.name, overall, rising, falling, boot, bootFalling };
}

/**
 * THE DECISION. A screen that returns numbers and leaves the verdict to the
 * reader is a screen that will be read optimistically. The rules are fixed
 * here, in code, and applied identically to every strategy:
 *
 *   REJECT          the headline does not clear the corrected threshold, OR it
 *                   clears it only in one regime. An edge that needs a rising
 *                   market IS the rising market.
 *   INCONCLUSIVE    survives both regimes but the falling-regime evidence is
 *                   too thin to call. Not a pass. Explicitly not a pass.
 *   PROMISING       clears the corrected threshold in BOTH regimes, and the
 *                   bootstrap agrees on the direction in each.
 */
export function classify(res, { alpha, nTests }) {
  const a = bonferroni(alpha, nTests);
  const reasons = [];

  if (!(res.overall.edge > 0) || !(res.boot.p < a)) {
    reasons.push(`headline edge ${res.overall.edge?.toFixed(4)} with bootstrap p=${res.boot.p?.toFixed(4)} does not clear the corrected threshold ${a.toFixed(4)}`);
    return { verdict: 'REJECT', reasons, alpha: a };
  }
  if (!(res.falling.edge > 0)) {
    reasons.push(`the edge inverts in falling markets: ${res.rising.edge.toFixed(4)}R rising against ${res.falling.edge.toFixed(4)}R falling - the edge IS the regime`);
    return { verdict: 'REJECT', reasons, alpha: a };
  }
  if (!(res.bootFalling.p < a)) {
    reasons.push(`survives both regimes (${res.rising.edge.toFixed(4)}R / ${res.falling.edge.toFixed(4)}R) but the falling-regime bootstrap p=${res.bootFalling.p?.toFixed(4)} does not clear ${a.toFixed(4)} - too thin to call, and thin is not a pass`);
    return { verdict: 'INCONCLUSIVE', reasons, alpha: a };
  }
  reasons.push(`clears the corrected threshold in BOTH regimes: ${res.rising.edge.toFixed(4)}R rising, ${res.falling.edge.toFixed(4)}R falling`);
  return { verdict: 'PROMISING', reasons, alpha: a };
}

export const DEFAULTS = {
  holdDays: 14,
  stopSigma: 1.5,
  volLookback: 120,
  alpha: 0.05,
  bootstrapIters: 1000,
};
