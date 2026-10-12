/**
 * A seeded random number generator.
 *
 * ⛔ WHY NOT Math.random(): a study you cannot re-run is not reproducible, and
 * "reproducible" is the entire claim this repository makes. Every number in
 * every output here traces back to one integer seed printed at the top of the
 * report. Change the seed and you get a different sample; keep it and you get
 * the identical sample on any machine, forever.
 *
 * mulberry32 - small, fast, well-distributed enough for Monte Carlo work, and
 * short enough to audit in one sitting. It is NOT cryptographic and must never
 * be used as if it were.
 */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** Standard normal, Box-Muller. Rejects u=0 so log() cannot return -Infinity. */
  const normal = () => {
    let u = 0;
    while (u === 0) u = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };

  /** Integer in [0, n). */
  const int = (n) => Math.floor(next() * n);

  /** One element of an array. */
  const pick = (arr) => arr[int(arr.length)];

  return { next, normal, int, pick };
}
