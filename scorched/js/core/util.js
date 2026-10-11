/* Scorched — shared namespace + small helpers.
   Every script attaches to the global SE object so the game runs from file://
   (no ES modules, no build step) and the core files load under Node for tests. */
(function (root) {
  'use strict';
  const SE = root.SE || (root.SE = {});

  // Mulberry32 — small, fast, seedable PRNG.
  function makeRng(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    const rng = function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.int = (n) => Math.floor(rng() * n);
    rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
    rng.range = (lo, hi) => lo + rng() * (hi - lo);
    rng.chance = (p) => rng() < p;
    rng.gauss = () => { // Box-Muller, mean 0, sd 1
      let u = 0; while (u === 0) u = rng();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
    };
    return rng;
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const DEG = Math.PI / 180;

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  const money = (n) => '$' + Math.floor(n).toLocaleString('en-US');

  SE.util = { makeRng, clamp, lerp, DEG, shuffle, money };
  if (typeof module !== 'undefined' && module.exports) module.exports = SE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
