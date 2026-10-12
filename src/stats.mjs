/**
 * The statistics. Deliberately small, and deliberately conservative.
 */

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function sd(xs) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Welch's t for two samples of unequal variance and size. */
export function welchT(a, b) {
  if (a.length < 2 || b.length < 2) return NaN;
  const va = sd(a) ** 2 / a.length;
  const vb = sd(b) ** 2 / b.length;
  const denom = Math.sqrt(va + vb);
  return denom > 0 ? (mean(a) - mean(b)) / denom : NaN;
}

/**
 * ⛔ THE BLOCK BOOTSTRAP BY CALENDAR DATE, and it is the most important
 * function in this repository.
 *
 * A naive t-test treats every row as an independent observation. In a single
 * asset class that is false: forty instruments on one day are largely one
 * observation wearing forty hats, because they move together. The nominal
 * sample size is therefore an overstatement of the evidence, often a large one,
 * and a t-statistic computed from it will clear any threshold you like.
 *
 * Resampling whole DATES - every row from a sampled day, kept together -
 * preserves that cross-sectional correlation. The resulting interval is wider,
 * frequently much wider, and it is the honest one.
 *
 * Returns the share of resamples in which the effect reverses sign. Call it a
 * one-sided bootstrap p-value: the probability, under resampling, of not even
 * getting the direction right.
 */
export function blockBootstrapByDate(rows, { iters = 2000, r }) {
  const byDate = new Map();
  for (const row of rows) {
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date).push(row);
  }
  const dates = [...byDate.keys()];
  if (dates.length < 2) return { p: NaN, lo: NaN, hi: NaN, dates: dates.length };

  const effect = (sample) => {
    const fired = []; const ctrl = [];
    for (const row of sample) (row.fired ? fired : ctrl).push(row.R);
    return fired.length && ctrl.length ? mean(fired) - mean(ctrl) : NaN;
  };

  const point = effect(rows);
  const draws = [];
  for (let i = 0; i < iters; i++) {
    const sample = [];
    for (let d = 0; d < dates.length; d++) sample.push(...byDate.get(dates[r.int(dates.length)]));
    const e = effect(sample);
    if (Number.isFinite(e)) draws.push(e);
  }
  draws.sort((a, b) => a - b);
  const q = (p) => draws[Math.min(draws.length - 1, Math.max(0, Math.floor(p * draws.length)))];
  const wrongSign = point >= 0
    ? draws.filter((d) => d <= 0).length
    : draws.filter((d) => d >= 0).length;

  return {
    point,
    p: draws.length ? wrongSign / draws.length : NaN,
    lo: q(0.025),
    hi: q(0.975),
    dates: dates.length,
    iters: draws.length,
  };
}

/**
 * Bonferroni. Trivial arithmetic, stated as a function so that the number of
 * tests is an explicit argument someone has to supply rather than a thing
 * quietly forgotten between the screen and the write-up.
 */
export const bonferroni = (alpha, nTests) => alpha / Math.max(1, nTests);
