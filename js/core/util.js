/* Felt Sharpener — shared namespace + small helpers.
   Every script attaches to the global FS object so the app runs from file://
   (no ES modules, no build step) and the same files load under Node for tests. */
(function (root) {
  'use strict';
  const FS = root.FS || (root.FS = {});

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
    return rng;
  }

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  function shuffleInPlace(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function fmtChips(n) {
    n = Math.round(n);
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 2).replace(/\.?0+$/, '') + 'M';
    if (Math.abs(n) >= 1e5) return (n / 1e3).toFixed(0) + 'K';
    return n.toLocaleString('en-US');
  }
  function fmtMoney(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(x, digits) { return (x * 100).toFixed(digits == null ? 0 : digits) + '%'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  FS.util = { makeRng, hashString, clamp, lerp, shuffleInPlace, fmtChips, fmtMoney, pct, esc, ordinal, deepClone };
  if (typeof module !== 'undefined' && module.exports) module.exports = FS;
})(typeof window !== 'undefined' ? window : globalThis);
