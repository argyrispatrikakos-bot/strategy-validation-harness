#!/usr/bin/env node
/**
 * Run the screen and print a report.
 *
 *   node run.mjs                     the regime-only market (the interesting one)
 *   node run.mjs --market null       no edge exists. Everything should be rejected
 *   node run.mjs --market genuine    a real edge. It should be found
 *   node run.mjs --seed 7            a different sample
 *
 * No dependencies, no network, no API key. Clone and run.
 */
import { universe } from './src/synth.mjs';
import { ALL } from './src/strategies.mjs';
import { screenOne, classify, DEFAULTS } from './src/screen.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const market = arg('--market', 'regime-only');
const seed = Number(arg('--seed', 42));
const instruments = Number(arg('--instruments', 40));
const days = Number(arg('--days', 1200));

if (!['null', 'regime-only', 'genuine'].includes(market)) {
  console.error(`unknown --market ${market}. Use null | regime-only | genuine`);
  process.exit(2);
}

const opts = { ...DEFAULTS, seed };
const uni = universe({ seed, instruments, days, kind: market });
const nTests = ALL.length;

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const risingDays = uni.regime.filter((x) => x > 0).length;

console.log('='.repeat(78));
console.log('STRATEGY VALIDATION HARNESS');
console.log('='.repeat(78));
console.log(`market            ${market}   (synthetic, ground truth KNOWN)`);
console.log(`seed              ${seed}        - the whole run is reproducible from this`);
console.log(`universe          ${instruments} instruments x ${days} days, one shared regime path`);
console.log(`regime mix        ${pct(risingDays / days)} rising / ${pct(1 - risingDays / days)} falling`);
console.log(`test definition   entry at close, stop ${opts.stopSigma} sigma (${opts.volLookback}d), exit ${opts.holdDays}d or stop`);
console.log(`control           every NON-firing day, same instruments, same dates`);
console.log(`multiple testing  ${nTests} strategies -> Bonferroni alpha ${(opts.alpha / nTests).toFixed(4)}`);
console.log(`inference         block bootstrap by DATE, ${opts.bootstrapIters} iterations`);
console.log('');

const verdicts = [];
for (const s of ALL) {
  const res = screenOne(uni, s, { ...opts, nTests });
  const dec = classify(res, { alpha: opts.alpha, nTests });
  verdicts.push({ name: s.name, ...dec });

  console.log('-'.repeat(78));
  console.log(s.name);
  console.log(`  headline   edge ${res.overall.edge.toFixed(4)}R   t=${res.overall.t.toFixed(2)}   n=${res.overall.n} fired / ${res.overall.nControl} control`);
  console.log(`  rising     edge ${res.rising.edge.toFixed(4)}R   t=${res.rising.t.toFixed(2)}   n=${res.rising.n}`);
  console.log(`  falling    edge ${res.falling.edge.toFixed(4)}R   t=${res.falling.t.toFixed(2)}   n=${res.falling.n}`);
  console.log(`  bootstrap  p=${res.boot.p.toFixed(4)}   95% CI [${res.boot.lo.toFixed(4)}, ${res.boot.hi.toFixed(4)}]   over ${res.boot.dates} dates`);
  console.log(`  VERDICT    ${dec.verdict}`);
  for (const r of dec.reasons) console.log(`             ${r}`);
}

console.log('='.repeat(78));
const tally = verdicts.reduce((acc, v) => ({ ...acc, [v.verdict]: (acc[v.verdict] || 0) + 1 }), {});
console.log('SUMMARY  ' + Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' · '));

// What the ground truth says SHOULD have happened. Printed so the reader can
// check the harness against the answer instead of taking the report on trust.
const expectation = {
  'null': 'no strategy should be PROMISING - every pass here is a false positive',
  'regime-only': 'no strategy should be PROMISING - the planted edge exists only in rising markets, and a headline that survives the regime split would be a failure of this harness',
  'genuine': 'the planted edge is real in BOTH regimes - a harness that rejects everything here has no power, which is just as useless as one that accepts everything',
};
console.log(`GROUND TRUTH  ${expectation[market]}`);
console.log('='.repeat(78));
