/* Scorched — destructible, procedurally generated terrain.
   The ground is a W×H grid of cells. 0 is air; any other value is a "shade" (1–63) the renderer maps
   to a colour, so dirt keeps its colour when it falls or is thrown around. Unsupported dirt falls
   column by column (settleStep), which is what makes craters cave in. */
(function (root) {
  'use strict';
  const SE = root.SE || (root.SE = {});
  const { clamp } = SE.util;

  const STYLES = ['rolling', 'mountains', 'plains', 'canyon', 'islands'];
  const MAX_SHADE = 63;

  /** Midpoint displacement on [0, n) returning values roughly in [-1, 1]. */
  function midpoint(n, rng, roughness) {
    let size = 1; while (size < n) size *= 2;
    const a = new Float32Array(size + 1);
    a[0] = rng.range(-1, 1); a[size] = rng.range(-1, 1);
    let amp = 1;
    for (let step = size; step > 1; step >>= 1) {
      const half = step >> 1;
      for (let i = half; i < size; i += step) a[i] = (a[i - half] + a[i + half]) / 2 + rng.range(-amp, amp);
      amp *= roughness;
    }
    return a.subarray(0, n);
  }

  function smooth(a, passes) {
    const n = a.length; let b = new Float32Array(n);
    for (let p = 0; p < passes; p++) {
      for (let i = 0; i < n; i++) b[i] = (a[Math.max(0, i - 1)] + a[i] * 2 + a[Math.min(n - 1, i + 1)]) / 4;
      const t = a; a = b; b = t;
    }
    return a;
  }

  /** Surface heights (y of the first solid cell, measured from the top) for a terrain style. */
  function heightProfile(w, h, rng, style) {
    const ys = new Float32Array(w);
    const mp = (r) => midpoint(w, rng, r);
    let base, amp, prof;
    switch (style) {
      case 'mountains': prof = smooth(mp(0.54), 7); base = 0.56; amp = 0.34; break;
      case 'plains': prof = smooth(mp(0.45), 12); base = 0.7; amp = 0.1; break;
      case 'canyon': {
        prof = smooth(mp(0.5), 6); base = 0.55; amp = 0.18;
        const cx = rng.range(0.35, 0.65) * w, cw = rng.range(0.08, 0.16) * w;
        for (let x = 0; x < w; x++) { // a deep central valley
          const d = (x - cx) / cw;
          prof[x] = prof[x] - 1.6 * Math.exp(-d * d);
        }
        break;
      }
      case 'islands': {
        prof = smooth(mp(0.55), 5); base = 0.68; amp = 0.25;
        const k = 2 + rng.int(3), ph = rng.range(0, Math.PI * 2);
        for (let x = 0; x < w; x++) prof[x] = prof[x] * 0.6 + 0.9 * Math.sin(ph + (x / w) * Math.PI * k);
        break;
      }
      default: { // rolling hills
        prof = smooth(mp(0.5), 8); base = 0.62; amp = 0.22;
        const ph = rng.range(0, Math.PI * 2), k = rng.range(1.5, 3.5);
        for (let x = 0; x < w; x++) prof[x] = prof[x] * 0.7 + 0.5 * Math.sin(ph + (x / w) * Math.PI * k);
      }
    }
    // Normalise to [-1, 1], then map to screen rows.
    let lo = Infinity, hi = -Infinity;
    for (let x = 0; x < w; x++) { lo = Math.min(lo, prof[x]); hi = Math.max(hi, prof[x]); }
    const span = hi - lo || 1;
    for (let x = 0; x < w; x++) {
      const n = ((prof[x] - lo) / span) * 2 - 1; // -1 low … 1 high
      ys[x] = clamp(h * (base - amp * n), h * 0.18, h * 0.94);
    }
    return ys;
  }

  class Terrain {
    constructor(w, h) {
      this.w = w; this.h = h;
      this.cells = new Uint8Array(w * h);
      this.dirtyCols = new Uint8Array(w);  // columns that may have floating dirt
      this.anyDirty = false;
      this.dirty = null;                   // {x0,y0,x1,y1} region the renderer must redraw
      this.style = 'rolling';
    }

    static generate(w, h, rng, style) {
      if (!style || style === 'random') style = rng.pick(STYLES);
      const t = new Terrain(w, h);
      t.style = style;
      const ys = heightProfile(w, h, rng, style);
      const ph1 = rng.range(0, 6.28), ph2 = rng.range(0, 6.28);
      for (let x = 0; x < w; x++) {
        const top = Math.round(ys[x]);
        const wave = 7 * Math.sin(x * 0.013 + ph1) + 4 * Math.sin(x * 0.041 + ph2);
        for (let y = top; y < h; y++) {
          const depth = y - top;
          // Thin grass/crust on top, then wavy strata getting darker with depth.
          const shade = depth < 3 ? 1 : 2 + Math.floor((depth + wave + 10) / 11) * 3 + ((x * 7 + y * 3) % 5 === 0 ? 1 : 0);
          t.cells[y * w + x] = Math.min(MAX_SHADE, Math.max(2, shade));
        }
      }
      t.markAll();
      return t;
    }

    markAll() { this.dirty = { x0: 0, y0: 0, x1: this.w - 1, y1: this.h - 1 }; }
    markRegion(x0, y0, x1, y1) {
      x0 = clamp(Math.floor(x0), 0, this.w - 1); x1 = clamp(Math.ceil(x1), 0, this.w - 1);
      y0 = clamp(Math.floor(y0), 0, this.h - 1); y1 = clamp(Math.ceil(y1), 0, this.h - 1);
      const d = this.dirty;
      if (!d) this.dirty = { x0, y0, x1, y1 };
      else { d.x0 = Math.min(d.x0, x0); d.y0 = Math.min(d.y0, y0); d.x1 = Math.max(d.x1, x1); d.y1 = Math.max(d.y1, y1); }
    }

    /** Cell value; below the floor counts as solid bedrock, beside or above the world as air. */
    get(x, y) {
      x |= 0; y |= 0;
      if (y >= this.h) return MAX_SHADE;
      if (x < 0 || x >= this.w || y < 0) return 0;
      return this.cells[y * this.w + x];
    }
    solid(x, y) { return this.get(x, y) !== 0; }

    /** Y of the first solid cell in column x scanning down from `from` (default: the top). */
    surface(x, from) {
      x |= 0;
      if (x < 0 || x >= this.w) return this.h;
      const { w, h, cells } = this;
      for (let y = Math.max(0, from | 0); y < h; y++) if (cells[y * w + x]) return y;
      return h;
    }

    /** Removes every cell inside the circle. Returns how many cells were removed. */
    carve(cx, cy, r) {
      const { w, h, cells } = this;
      const r2 = r * r; let n = 0;
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, span = Math.sqrt(Math.max(0, r2 - dx * dx));
        const y0 = Math.max(0, Math.floor(cy - span)), y1 = Math.min(h - 1, Math.ceil(cy + span));
        let hit = false;
        for (let y = y0; y <= y1; y++) {
          const i = y * w + x;
          if (cells[i]) { cells[i] = 0; n++; hit = true; }
        }
        if (hit) { this.dirtyCols[x] = 1; this.anyDirty = true; }
      }
      this.markRegion(cx - r, cy - r, cx + r, cy + r);
      return n;
    }

    /** Fills the air inside the circle with dirt (dirt bombs). Returns cells added. */
    fill(cx, cy, r, rng) {
      const { w, h, cells } = this;
      const r2 = r * r; let n = 0;
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, span = Math.sqrt(Math.max(0, r2 - dx * dx));
        const y0 = Math.max(0, Math.floor(cy - span)), y1 = Math.min(h - 1, Math.ceil(cy + span));
        for (let y = y0; y <= y1; y++) {
          const i = y * w + x;
          if (!cells[i]) { cells[i] = 14 + (rng ? rng.int(10) : (x + y) % 10); n++; }
        }
        this.dirtyCols[x] = 1; this.anyDirty = true;
      }
      this.markRegion(cx - r, cy - r, cx + r, cy + r);
      return n;
    }

    /** Moves floating dirt down by up to `passes` cells. Returns true while anything is still falling. */
    settleStep(passes) {
      if (!this.anyDirty) return false;
      const { w, h, cells, dirtyCols } = this;
      let any = false;
      for (let x = 0; x < w; x++) {
        if (!dirtyCols[x]) continue;
        let top = 0; while (top < h && !cells[top * w + x]) top++;
        let moved = false, lowest = -1;
        for (let p = 0; p < passes; p++) {
          let movedPass = false;
          for (let y = h - 2; y >= top; y--) {
            const i = y * w + x;
            if (cells[i] && !cells[i + w]) {
              cells[i + w] = cells[i]; cells[i] = 0; movedPass = true;
              if (y + 1 > lowest) lowest = y + 1;
            }
          }
          if (!movedPass) break;
          moved = true; top++;
        }
        if (moved) { any = true; this.markRegion(x, Math.max(0, top - passes - 1), x, lowest); }
        else dirtyCols[x] = 0;
      }
      this.anyDirty = any;
      return any;
    }

    /** Settles everything instantly (used by tests and the headless simulator). */
    settleAll() { while (this.settleStep(64)); }

    /** Levels a small pad (used when placing tanks): fills below `y`, clears above it. */
    flatten(cx, y, halfWidth) {
      const { w, h, cells } = this;
      for (let x = Math.max(0, cx - halfWidth); x <= Math.min(w - 1, cx + halfWidth); x++) {
        for (let yy = 0; yy < h; yy++) {
          const i = yy * w + x;
          if (yy < y) cells[i] = 0;
          else if (!cells[i]) cells[i] = yy - y < 3 ? 1 : Math.min(MAX_SHADE, 2 + Math.floor((yy - y + 10) / 11) * 3);
        }
      }
      this.markRegion(cx - halfWidth, 0, cx + halfWidth, h - 1);
    }
  }

  SE.terrain = { Terrain, STYLES, MAX_SHADE };
  if (typeof module !== 'undefined' && module.exports) module.exports = SE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
