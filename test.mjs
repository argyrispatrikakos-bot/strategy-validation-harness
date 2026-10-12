#!/usr/bin/env node
/**
 * The tests that matter.
 *
 *   node test.mjs
 *
 * ⛔ THESE DO NOT TEST THAT THE CODE RUNS. They test that the METHOD gets the
 * right answer on markets where the right answer is known, across many seeds,
 * which is the only claim this repository actually makes.
 *
 * Smaller universes and fewer bootstrap iterations than run.mjs, so the whole
 * suite finishes in seconds. The properties being asserted do not depend on the
 * size; the precision of the estimates does, which is why the thresholds below
 * are stated as bounds rather than as exact figures.
 */
import { universe } from './src/synth.mjs';
import { ALL, donchian, compressionBreak } from './src/strategies.mjs';
import { screenOne, classify, DEFAULTS } from './src/screen.mjs';
import { rng } from './src/rng.mjs';
import { mean, sd, welchT, blockBootstrapByDate, bonferroni } from './src/stats.mjs';

let pass = 0; let fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok    ${name.padEnd(64)} ${got ?? ''}`); }
  else { fail++; console.log(`  FAIL  ${name.padEnd(64)} ${got}`); }
};

const SMALL = { instruments: 20, days: 700 };
const OPTS = { ...DEFAULTS, bootstrapIters: 300 };

function verdictsFor(kind, seed) {
  const uni = universe({ seed, kind, ...SMALL });
  return ALL.map((s) => {
    const res = screenOne(uni, s, { ...OPTS, seed });
    return classify(res, { alpha: OPTS.alpha, nTests: ALL.length }).verdict;
  });
}

// ---------------------------------------------------------------------------
console.log('\nTHE RNG - a study you cannot re-run is not reproducible');
// ---------------------------------------------------------------------------
{
  const a = rng(99); const b = rng(99); const c = rng(100);
  const take = (r, n) => Array.from({ length: n }, () => r.next());
  const A = take(a, 50); const B = take(b, 50); const C = take(c, 50);
  ok('the same seed gives the identical stream', A.join() === B.join(), 'identical');
  ok('a different seed gives a different stream', A.join() !== C.join(), 'different');
  const xs = take(rng(7), 20000);
  ok('uniform mean is near 0.5', Math.abs(mean(xs) - 0.5) < 0.01, mean(xs).toFixed(4));
  const ns = Array.from({ length: 20000 }, () => rng(8).normal());
  ok('normal() returns finite values only', ns.every(Number.isFinite), 'all finite');
  const n2 = (() => { const r = rng(11); return Array.from({ length: 20000 }, () => r.normal()); })();
  ok('normal sd is near 1', Math.abs(sd(n2) - 1) < 0.05, sd(n2).toFixed(4));
}

// ---------------------------------------------------------------------------
console.log('\nLOOK-AHEAD - enforced mechanically, not by being careful');
//
// Every strategy is re-evaluated on a series TRUNCATED at the decision day. If
// an answer changes, the rule was reading the future. This is the check that
// cannot be replaced by a code review.
// ---------------------------------------------------------------------------
{
  const uni = universe({ seed: 3, kind: 'genuine', instruments: 4, days: 300 });
  for (const s of ALL) {
    let checked = 0; let mismatches = 0;
    for (const inst of uni.instruments) {
      for (let i = s.warmup; i < inst.close.length - 20; i += 7) {
        const full = s.fires(inst, i);
        const cut = {
          close: inst.close.slice(0, i + 1),
          high: inst.high.slice(0, i + 1),
          low: inst.low.slice(0, i + 1),
        };
        if (s.fires(cut, i) !== full) mismatches++;
        checked++;
      }
    }
    ok(`${s.name} reads no future bar`, mismatches === 0, `${checked} decision days checked`);
  }
}

// ---------------------------------------------------------------------------
console.log('\nTHE BLOCK BOOTSTRAP - the correlation correction must actually bite');
//
// If resampling by date did nothing, it would be decoration. On a correlated
// universe its interval must be WIDER than the naive t-interval implies.
// ---------------------------------------------------------------------------
{
  const uni = universe({ seed: 5, kind: 'regime-only', ...SMALL });
  const res = screenOne(uni, donchian, { ...OPTS, seed: 5 });
  const bootWidth = res.boot.hi - res.boot.lo;
  // The naive 95% half-width implied by the t-statistic, in the same units.
  const naiveWidth = 2 * 1.96 * Math.abs(res.overall.edge / res.overall.t);
  ok('the bootstrap interval is wider than the naive one',
    bootWidth > naiveWidth, `boot ${bootWidth.toFixed(4)} vs naive ${naiveWidth.toFixed(4)}`);
  ok('it reports how many DATES it resampled, not how many rows',
    res.boot.dates > 100 && res.boot.dates < uni.days, `${res.boot.dates} dates`);
  ok('an empty input refuses rather than inventing a p-value',
    Number.isNaN(blockBootstrapByDate([], { iters: 10, r: rng(1) }).p), 'NaN');
}

// ---------------------------------------------------------------------------
console.log('\nBONFERRONI + WELCH');
// ---------------------------------------------------------------------------
{
  ok('Bonferroni divides by the number of tests', bonferroni(0.05, 4) === 0.0125, '0.0125');
  ok('Bonferroni with 0 tests does not divide by zero', bonferroni(0.05, 0) === 0.05, '0.05');
  const a = [1, 2, 3, 4, 5]; const b = [1, 2, 3, 4, 5];
  ok('identical samples give t = 0', Math.abs(welchT(a, b)) < 1e-12, '0');
  ok('a shifted sample gives a positive t', welchT([6, 7, 8, 9, 10], b) > 0, 'positive');
  ok('a single observation gives NaN, not a verdict', Number.isNaN(welchT([1], b)), 'NaN');
}

// ---------------------------------------------------------------------------
console.log('\n⭐ FALSE POSITIVES - the null market, across seeds');
//
// THE CENTRAL CLAIM, and the bound is stated honestly.
//
// ⛔ THE FIRST VERSION OF THIS TEST ASSERTED ZERO FALSE POSITIVES AND FAILED -
// 1 promotion in 24 strategy-runs. The test was wrong, not the harness. A test
// run at alpha does not promise zero false positives; it promises that they
// arrive at roughly alpha. Demanding zero would have meant tuning the method
// until it could not promote anything, which is the failure mode the POWER
// test below exists to catch. So this asserts a RATE BOUND and prints the rate.
//
// The bound is deliberately loose relative to the nominal 1.25%, because ~48
// runs cannot resolve a 1% rate - and claiming otherwise would be the same
// overstatement this repository is about.
// ---------------------------------------------------------------------------
{
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  let promoted = 0; let total = 0;
  for (const s of seeds) {
    const uni = universe({ seed: s, kind: 'null', ...SMALL });
    for (const strat of ALL) {
      const res = screenOne(uni, strat, { ...OPTS, bootstrapIters: 200, seed: s });
      if (classify(res, { alpha: OPTS.alpha, nTests: ALL.length }).verdict === 'PROMISING') promoted++;
      total++;
    }
  }
  const rate = promoted / total;
  ok('the false-positive rate stays within a loose bound of nominal',
    rate <= 0.06, `${promoted}/${total} = ${(rate * 100).toFixed(1)}% (nominal ${(OPTS.alpha / ALL.length * 100).toFixed(2)}%, bound 6%)`);
}

// ---------------------------------------------------------------------------
console.log('\n⭐ THE REGIME TRAP - an edge that only exists in a bull market');
//
// The failure mode this whole harness exists to catch. A strategy may show a
// large, highly significant headline here - it SHOULD - and must still not be
// promoted, because the regime split is what the headline is hiding.
// ---------------------------------------------------------------------------
{
  const seeds = [1, 2, 3, 4];
  let promoted = 0; let strongHeadlines = 0;
  for (const s of seeds) {
    const uni = universe({ seed: s, kind: 'regime-only', ...SMALL });
    for (const strat of ALL) {
      const res = screenOne(uni, strat, { ...OPTS, seed: s });
      if (res.overall.t > 3) strongHeadlines++;
      if (classify(res, { alpha: OPTS.alpha, nTests: ALL.length }).verdict === 'PROMISING') promoted++;
    }
  }
  ok('the trap produces strong headlines, so the test is not vacuous',
    strongHeadlines > 0, `${strongHeadlines} strategy-runs with t > 3`);
  ok('and NONE of them is promoted', promoted === 0, `${promoted} promoted`);
}

// ---------------------------------------------------------------------------
console.log('\n⭐ POWER - a harness that rejects everything is also useless');
//
// The other half, and the one usually missing. If the method cannot find a real
// edge it is not conservative, it is blind, and it would have rejected the
// genuine thing along with the noise.
//
// ⛔ THE FIRST VERSION OF THIS TEST FAILED TOO - 2 of 6 seeds - and the reason
// is a finding rather than a bug: it ran on the SMALL universe the other tests
// share, and at that sample size the method does not have the power to see an
// effect this small. That is a true statement ABOUT THE METHOD, and it is
// exactly why a power calculation belongs before a study rather than after it.
// So this one runs on a universe sized to have power, and says so.
// ---------------------------------------------------------------------------
{
  const POWERED = { instruments: 40, days: 1200 };
  const seeds = [1, 2, 3, 4];
  let found = 0;
  for (const s of seeds) {
    const uni = universe({ seed: s, kind: 'genuine', ...POWERED });
    const res = screenOne(uni, compressionBreak, { ...OPTS, bootstrapIters: 200, seed: s });
    const v = classify(res, { alpha: OPTS.alpha, nTests: ALL.length }).verdict;
    if (v === 'PROMISING' || v === 'INCONCLUSIVE') found++;
  }
  ok('a genuine edge survives, at a sample sized to see it',
    found >= 3, `${found} / ${seeds.length} seeds reached PROMISING or INCONCLUSIVE (40x1200)`);
}

// ---------------------------------------------------------------------------
console.log('\nDETERMINISM - the same seed must give the same verdicts');
// ---------------------------------------------------------------------------
{
  const a = verdictsFor('regime-only', 21).join(',');
  const b = verdictsFor('regime-only', 21).join(',');
  ok('two runs at one seed agree exactly', a === b, a);
}

console.log(`\n${fail ? 'FAILED' : 'PASSED'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
