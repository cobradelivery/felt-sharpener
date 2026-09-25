/* Preflop hand strength ordering + range helpers.
   ORDER was produced by tools/gen-preflop.js (simulated equity vs 1 and 2 random hands),
   with small pocket pairs nudged up for their set-mining value. */
(function (root) {
  'use strict';
  const FS = root.FS;
  const C = FS.cards;
  const ORDER = ["AA", "KK", "QQ", "JJ", "TT", "99", "88", "AKs", "AQs", "AKo", "AJs", "ATs", "77", "AQo", "KQs", "KJs", "66", "AJo", "A9s", "KTs", "ATo", "A8s", "KQo", "55", "QJs", "KJo", "A7s", "QTs", "K9s", "A9o", "KTo", "A5s", "A6s", "A8o", "44", "JTs", "QJo", "A4s", "Q9s", "K8s", "A7o", "QTo", "A3s", "K9o", "K7s", "A2s", "33", "J9s", "A6o", "A5o", "Q8s", "JTo", "K6s", "A4o", "T9s", "Q9o", "K5s", "K8o", "22", "J8s", "A3o", "K4s", "K7o", "Q7s", "T8s", "J9o", "A2o", "K3s", "Q6s", "K6o", "Q8o", "J7s", "T9o", "98s", "Q5s", "K2s", "K5o", "Q4s", "J8o", "Q7o", "T7s", "K4o", "97s", "J6s", "T8o", "Q3s", "J5s", "K3o", "Q2s", "Q6o", "87s", "T6s", "J7o", "98o", "K2o", "Q5o", "J4s", "96s", "T7o", "86s", "J3s", "Q4o", "T5s", "76s", "J2s", "Q3o", "J6o", "97o", "T4s", "Q2o", "95s", "J5o", "85s", "T3s", "87o", "T6o", "65s", "75s", "J4o", "T2s", "96o", "94s", "86o", "J3o", "54s", "93s", "76o", "84s", "T5o", "64s", "74s", "J2o", "92s", "T4o", "95o", "53s", "85o", "T3o", "83s", "75o", "65o", "73s", "82s", "63s", "T2o", "43s", "94o", "54o", "84o", "52s", "64o", "74o", "93o", "62s", "72s", "92o", "42s", "32s", "53o", "83o", "63o", "73o", "82o", "43o", "52o", "62o", "72o", "42o", "32o"];

  const combosOf = (code) => (code.length === 2 ? 6 : code[2] === 's' ? 4 : 12);
  const PCT = {};      // code -> percentile (0 = best, 1 = worst), combo-weighted, midpoint
  const PCT_TOP = {};  // code -> cumulative fraction including this hand
  (function build() {
    let cum = 0;
    for (const code of ORDER) {
      const n = combosOf(code);
      PCT[code] = (cum + n / 2) / 1326;
      cum += n;
      PCT_TOP[code] = cum / 1326;
    }
  })();
  const COMBOS = {};
  ORDER.forEach((code) => (COMBOS[code] = C.codeCombos(code)));

  function percentile(c1, c2) { return PCT[C.handCode(c1, c2)]; }
  function codePercentile(code) { return PCT[code]; }
  /** Codes in the top `p` fraction of hands. */
  function topCodes(p) { return ORDER.filter((code) => PCT[code] <= p); }

  /**
   * Build a hand sampler for equity calc: picks a combo whose percentile is in [lo, hi],
   * weighted by combos, skipping dead cards. `filter(hand)` may reject hands (e.g. post-flop narrowing).
   */
  function rangeSampler(lo, hi, filter) {
    lo = Math.max(0, lo); hi = Math.min(1, Math.max(hi, lo + 0.02));
    const pool = [];
    for (const code of ORDER) if (PCT[code] >= lo && PCT[code] <= hi) for (const h of COMBOS[code]) pool.push(h);
    if (!pool.length) return null;
    return function (rng, dead) {
      for (let tries = 0; tries < 40; tries++) {
        const h = pool[Math.floor(rng() * pool.length)];
        if (dead[h[0]] || dead[h[1]]) continue;
        if (filter && !filter(h, rng)) continue;
        return h;
      }
      return null;
    };
  }

  /** Short-stack shove range (fraction of hands) — approximates push/fold equilibrium charts. */
  function pushRange(bb, playersBehind, hasAnte) {
    const base = [0.62, 0.62, 0.42, 0.32, 0.26, 0.22, 0.19, 0.17, 0.15][Math.min(8, Math.max(1, playersBehind))];
    let r = base * Math.pow(10 / Math.max(1.5, bb), 0.65);
    if (hasAnte) r *= 1.12;
    return Math.min(1, Math.max(0.05, r));
  }
  /** Standard open-raise range by players left to act behind (9-max full ring). */
  function openRange(playersBehind) {
    return [0.40, 0.40, 0.44, 0.29, 0.23, 0.19, 0.16, 0.14, 0.12][Math.min(8, Math.max(1, playersBehind))];
  }

  /** Plain-English tier of a starting hand. */
  function tierOf(code) {
    const p = PCT_TOP[code];
    if (p <= 0.03) return { tier: 1, label: 'Premium', blurb: 'one of the very best starting hands' };
    if (p <= 0.08) return { tier: 2, label: 'Strong', blurb: 'a strong hand you usually want to raise' };
    if (p <= 0.18) return { tier: 3, label: 'Good', blurb: 'a good hand, playable from most seats' };
    if (p <= 0.32) return { tier: 4, label: 'Playable', blurb: 'playable, mostly from later seats' };
    if (p <= 0.50) return { tier: 5, label: 'Marginal', blurb: 'marginal — only worth playing from the best seats or when it’s cheap' };
    return { tier: 6, label: 'Weak', blurb: 'a weak hand that is usually folded' };
  }

  FS.preflop = { ORDER, PCT, PCT_TOP, COMBOS, combosOf, percentile, codePercentile, topCodes, rangeSampler, pushRange, openRange, tierOf };
})(typeof window !== 'undefined' ? window : globalThis);
