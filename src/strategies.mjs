/**
 * The strategies under test.
 *
 * Each is a pure function of bars UP TO AND INCLUDING day i, returning true if
 * it would enter on that day's close.
 *
 * ⛔ THE LOOK-AHEAD RULE, enforced by the signature rather than by care: a
 * strategy receives `bars` and an index `i`, and may only read indices <= i.
 * `assertNoLookAhead` in test.mjs checks this mechanically by truncating the
 * series at i and asserting the answer does not change. Look-ahead is the
 * single most common way a backtest becomes fiction, and "we were careful" is
 * not a control.
 */

const highest = (xs, i, n) => {
  let m = -Infinity;
  for (let k = Math.max(0, i - n + 1); k <= i; k++) if (xs[k] > m) m = xs[k];
  return m;
};
const lowest = (xs, i, n) => {
  let m = Infinity;
  for (let k = Math.max(0, i - n + 1); k <= i; k++) if (xs[k] < m) m = xs[k];
  return m;
};
const sma = (xs, i, n) => {
  if (i + 1 < n) return NaN;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += xs[k];
  return s / n;
};

/** Donchian channel breakout: close at the highest close of the window. */
export const donchian = {
  name: 'Donchian breakout (20)',
  warmup: 21,
  fires: (b, i) => b.close[i] >= highest(b.close, i - 1, 20),
};

/** Moving-average cross: fast above slow, having been below the day before. */
export const smaCross = {
  name: 'SMA cross (10/40)',
  warmup: 41,
  fires: (b, i) => {
    const f0 = sma(b.close, i, 10); const s0 = sma(b.close, i, 40);
    const f1 = sma(b.close, i - 1, 10); const s1 = sma(b.close, i - 1, 40);
    return Number.isFinite(f0) && Number.isFinite(f1) && f1 <= s1 && f0 > s0;
  },
};

/** Dual Thrust: close above yesterday's open plus a fraction of the recent range. */
export const dualThrust = {
  name: 'Dual Thrust (10, k=0.5)',
  warmup: 12,
  fires: (b, i) => {
    const hh = highest(b.high, i - 1, 10); const ll = lowest(b.low, i - 1, 10);
    return b.close[i] > b.close[i - 1] + 0.5 * (hh - ll);
  },
};

/**
 * A compression-and-breakout rule: a quiet range followed by a close near its
 * top. Included because it fires often enough to give the null case a decent
 * sample, which is what makes a false-positive rate measurable at all.
 */
export const compressionBreak = {
  name: 'Range compression break (10/30)',
  warmup: 32,
  fires: (b, i) => {
    const sHi = highest(b.high, i, 10); const sLo = lowest(b.low, i, 10);
    const lHi = highest(b.high, i, 30); const lLo = lowest(b.low, i, 30);
    const shortRange = sHi - sLo; const longRange = lHi - lLo;
    if (!(longRange > 0)) return false;
    const compressed = shortRange / longRange < 0.62;
    const nearTop = (b.close[i] - sLo) / (shortRange || 1) > 0.55;
    return compressed && nearTop;
  },
};

export const ALL = [donchian, smaCross, dualThrust, compressionBreak];
