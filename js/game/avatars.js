/* Tiny flat-shaded software 3D renderer for PS2-style low-poly character portraits.
   Heads are lathed ellipsoids deformed per character, with hair/hat/glasses/beard meshes. */
(function (root) {
  'use strict';
  const FS = root.FS;
  const PI = Math.PI;

  // ---------- color helpers ----------
  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const scaleC = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

  // ---------- mesh builder ----------
  class Mesh {
    constructor() { this.v = []; this.f = []; }
    vert(x, y, z) { this.v.push([x, y, z]); return this.v.length - 1; }
    tri(a, b, c, color, mat) { this.f.push({ i: [a, b, c], color, mat: mat || 'matte' }); }
    quad(a, b, c, d, color, mat) { this.tri(a, b, c, color, mat); this.tri(a, c, d, color, mat); }
    /** Lathe/param surface: fn(u,v) -> [x,y,z]; u around (0..1), v top->bottom (0..1). */
    surface(fn, us, vs, colorFn, mat, opts) {
      opts = opts || {};
      const idx = [];
      for (let j = 0; j <= vs; j++) {
        idx.push([]);
        for (let i = 0; i <= us; i++) {
          const p = fn(i / us, j / vs);
          idx[j].push(p ? this.vert(p[0], p[1], p[2]) : -1);
        }
      }
      for (let j = 0; j < vs; j++) for (let i = 0; i < us; i++) {
        const a = idx[j][i], b = idx[j][i + 1], c = idx[j + 1][i + 1], d = idx[j + 1][i];
        if (a < 0 || b < 0 || c < 0 || d < 0) continue;
        const col = colorFn((i + 0.5) / us, (j + 0.5) / vs, i, j);
        if (!col) continue;
        if (opts.flip) this.quad(a, d, c, b, col, mat); else this.quad(a, b, c, d, col, mat);
      }
    }
  }

  // Head surface (unit-ish), theta: angle around Y (0 = facing camera +z), phi: 0 top .. PI bottom
  function headFn(L) {
    const w = 0.78 * (L.headW || 1), jaw = L.jaw || 1;
    return function (theta, phi, grow) {
      grow = grow || 0;
      let rx = w, ry = 1.02, rz = 0.86;
      const sy = Math.cos(phi), sr = Math.sin(phi);
      let x = Math.sin(theta) * sr * rx, z = Math.cos(theta) * sr * rz, y = sy * ry;
      if (phi > PI * 0.55) {
        const t = (phi - PI * 0.55) / (PI * 0.45);
        const narrow = 1 - t * 0.38 * (2 - jaw);
        x *= narrow;
        z *= 1 - t * 0.12;
        y -= t * 0.12 * jaw;
      }
      // flatten the back of the head slightly, cheekbones
      if (Math.cos(theta) < 0) z *= 0.92;
      if (phi > PI * 0.45 && phi < PI * 0.7) x *= 1 + 0.05 * Math.sin((phi - PI * 0.45) / (PI * 0.25) * PI);
      const len = Math.hypot(x, y, z) || 1;
      return [x + (x / len) * grow, y + (y / len) * grow, z + (z / len) * grow];
    };
  }

  // ---------- character mesh ----------
  function buildCharacter(L, expr, rng) {
    const m = new Mesh();
    const skin = hexToRgb(L.skin);
    const hairC = hexToRgb(L.hairColor || '#333');
    const shirt = hexToRgb(L.shirt || '#446');
    const H = headFn(L);
    const U = 12, V = 9;
    const style = L.hair;
    const stubble = L.beard === 'stubble';
    // head
    m.surface((u, v) => H(u * 2 * PI, v * PI), U, V, (u, v) => {
      let c = skin;
      const th = u * 2 * PI, fr = Math.cos(th);
      if (stubble && v > 0.66 && fr > -0.1) c = mix(skin, hairC, 0.35);
      if (v < 0.12) c = scaleC(c, 0.97);
      return c;
    });
    const at = (theta, phi, out) => H(theta, phi, out || 0);
    // ears
    for (const s of [-1, 1]) {
      const th = s * PI * 0.5;
      const a = m.vert(...at(th - s * 0.12, PI * 0.47, 0.01)), b = m.vert(...at(th + s * 0.1, PI * 0.47, 0.12)),
        c = m.vert(...at(th + s * 0.1, PI * 0.62, 0.1)), d = m.vert(...at(th - s * 0.12, PI * 0.62, 0.01));
      const col = scaleC(skin, 0.9);
      if (s > 0) m.quad(a, b, c, d, col); else m.quad(a, d, c, b, col);
    }
    // eyes
    const eyeY = PI * 0.49, eyeX = 0.36;
    const browTilt = expr === 'grumpy' ? 0.06 : expr === 'happy' ? -0.03 : (L.brow || 0);
    for (const s of [-1, 1]) {
      const cx = s * eyeX;
      const q = (dx0, dy0, dx1, dy1, out, col, mat) => {
        const a = m.vert(...at(cx + dx0, eyeY + dy0, out)), b = m.vert(...at(cx + dx1, eyeY + dy0, out)),
          c = m.vert(...at(cx + dx1, eyeY + dy1, out)), d = m.vert(...at(cx + dx0, eyeY + dy1, out));
        m.quad(a, b, c, d, col, mat);
      };
      q(-0.13, -0.05, 0.13, 0.06, 0.012, [245, 245, 240]);
      const lookX = -0.02;
      q(-0.05 + lookX, -0.045, 0.05 + lookX, 0.055, 0.02, hexToRgb(L.eyes || '#3a2616'), 'gloss');
      q(-0.022 + lookX, -0.02, 0.022 + lookX, 0.03, 0.024, [10, 10, 10], 'gloss');
      // brows
      const inner = s < 0 ? 0.12 : -0.12;
      const b1 = m.vert(...at(cx - 0.15, eyeY - 0.13 + (s < 0 ? 0 : browTilt), 0.03)), b2 = m.vert(...at(cx + 0.15, eyeY - 0.13 + (s < 0 ? browTilt : 0), 0.03));
      const b3 = m.vert(...at(cx + 0.15, eyeY - 0.09 + (s < 0 ? browTilt : 0), 0.03)), b4 = m.vert(...at(cx - 0.15, eyeY - 0.09 + (s < 0 ? 0 : browTilt), 0.03));
      void inner;
      m.quad(b1, b2, b3, b4, mix(hairC, [30, 20, 15], 0.4));
    }
    // nose (pyramid)
    {
      const tip = at(0, PI * 0.585, 0.2);
      const t = m.vert(...tip);
      const top = m.vert(...at(0, PI * 0.49, 0.02));
      const l = m.vert(...at(-0.14, PI * 0.61, 0.0)), r = m.vert(...at(0.14, PI * 0.61, 0.0));
      const nc = mix(skin, [200, 110, 90], 0.12);
      m.tri(top, l, t, scaleC(nc, 0.95)); m.tri(top, t, r, nc); m.tri(l, r, t, scaleC(nc, 0.8));
    }
    // mouth: curved strip
    {
      const my = PI * 0.7, curve = expr === 'happy' ? 0.05 : expr === 'grumpy' ? -0.035 : 0.012;
      const pts = [-0.24, -0.1, 0.1, 0.24];
      const lipC = mix(skin, [150, 40, 50], 0.45);
      const open = expr === 'happy' ? 0.05 : 0.025;
      const top = pts.map((x, i) => m.vert(...at(x, my - (i === 0 || i === 3 ? curve : 0), 0.015)));
      const bot = pts.map((x, i) => m.vert(...at(x, my + open * (i === 0 || i === 3 ? 0.2 : 1) - (i === 0 || i === 3 ? curve : 0), 0.015)));
      for (let i = 0; i < 3; i++) m.quad(top[i], top[i + 1], bot[i + 1], bot[i], expr === 'happy' ? [60, 20, 25] : lipC);
      if (expr === 'happy') { const a = m.vert(...at(-0.14, my + 0.005, 0.02)), b = m.vert(...at(0.14, my + 0.005, 0.02)), c = m.vert(...at(0.14, my + 0.022, 0.02)), d = m.vert(...at(-0.14, my + 0.022, 0.02)); m.quad(a, b, c, d, [240, 240, 235]); }
    }
    // beard / mustache
    if (L.beard === 'full' || L.beard === 'goatee') {
      const full = L.beard === 'full';
      m.surface((u, v) => {
        const th = (u - 0.5) * (full ? 2.6 : 0.7);
        const ph = PI * (full ? 0.6 : 0.72) + v * PI * (full ? 0.33 : 0.22);
        return H(th, ph, 0.05 + Math.sin(v * PI) * 0.05);
      }, full ? 8 : 3, 3, (u, v) => {
        if (full && v < 0.4 && Math.abs(u - 0.5) < 0.18) return null; // mouth gap
        return mix(hairC, [0, 0, 0], 0.1 + (u * 7 % 1) * 0.1);
      });
    }
    if (L.beard === 'mustache' || L.beard === 'full' || L.beard === 'goatee') {
      const my = PI * 0.655;
      const a = m.vert(...at(-0.27, my + 0.05, 0.05)), b = m.vert(...at(-0.05, my - 0.02, 0.07)), c = m.vert(...at(0.05, my - 0.02, 0.07)), d = m.vert(...at(0.27, my + 0.05, 0.05));
      const e = m.vert(...at(0.2, my + 0.02, 0.06)), f = m.vert(...at(0, my + 0.03, 0.08)), g = m.vert(...at(-0.2, my + 0.02, 0.06));
      const mc = scaleC(hairC, 0.85);
      m.quad(a, b, f, g, mc); m.quad(b, c, e, f, mc); m.tri(c, d, e, mc);
    }
    buildHair(m, L, H, hairC, rng);
    buildHat(m, L, H, rng);
    buildGlasses(m, L, H);
    buildBody(m, L, skin, shirt, rng);
    return m;
  }

  function buildHair(m, L, H, hairC, rng) {
    const style = L.hair;
    if (!style || style === 'bald') {
      if (style === 'bald') {
        // side fringe
        m.surface((u, v) => H(PI * 0.55 + u * PI * 0.9, PI * (0.42 + v * 0.18), 0.03), 6, 1, () => scaleC(hairC, 0.95));
      }
      return;
    }
    const hc = (u, v, i, j) => mix(hairC, scaleC(hairC, 0.72), ((i * 3 + j * 5) % 4) / 6);
    const hat = !!L.hat;
    // hairline: how far down (phi fraction) the hair goes at angle theta (0 front)
    const P = {
      buzz: { grow: 0.025, front: 0.26, back: 0.62 }, fade: { grow: 0.03, front: 0.25, back: 0.58 },
      short: { grow: 0.06, front: 0.27, back: 0.66 }, slick: { grow: 0.05, front: 0.24, back: 0.68 },
      spiky: { grow: 0.06, front: 0.26, back: 0.64 }, combover: { grow: 0.03, front: 0.3, back: 0.62 },
      curly: { grow: 0.12, front: 0.26, back: 0.7, bumpy: 0.07 }, afro: { grow: 0.38, front: 0.25, back: 0.72, bumpy: 0.06 },
      wavy: { grow: 0.09, front: 0.24, back: 0.82, bumpy: 0.03, sides: 0.7 }, long: { grow: 0.08, front: 0.22, back: 0.9, sides: 0.78 },
      bob: { grow: 0.1, front: 0.24, back: 0.78, sides: 0.72 }, bighair: { grow: 0.3, front: 0.24, back: 0.86, bumpy: 0.05, sides: 0.75 },
      bun: { grow: 0.05, front: 0.24, back: 0.64 }, ponytail: { grow: 0.05, front: 0.24, back: 0.64 }, braid: { grow: 0.05, front: 0.24, back: 0.64 },
      mohawk: { grow: 0.02, front: 0.3, back: 0.5 },
    }[style] || { grow: 0.06, front: 0.27, back: 0.66 };
    const U = 12, V = 7;
    const cut = (theta) => {
      const f = (Math.cos(theta) + 1) / 2; // 1 front, 0 back
      const sideness = Math.abs(Math.sin(theta));
      let c = P.front * f + P.back * (1 - f);
      if (P.sides && sideness > 0.6 && Math.cos(theta) > -0.2) c = Math.max(c, P.sides * (sideness - 0.3) / 0.7);
      return c;
    };
    if (style === 'mohawk') {
      m.surface((u, v) => { const th = PI * 0.0 + (u - 0.5) * 0.35; const ph = v * PI * 0.9; return H(th + PI * (v > 0.001 ? 0 : 0), ph * 0.95, 0.02 + 0.28 * Math.sin(Math.min(1, v * 1.6) * PI * 0.5)); }, 2, 8, hc, 'gloss');
      m.surface((u, v) => H(u * 2 * PI, v * PI * 0.62, 0.015), U, 5, () => scaleC(hairC, 0.55));
      return;
    }
    m.surface((u, v) => {
      const th = u * 2 * PI;
      const ph = v * PI * cut(th);
      let g = P.grow * (1 - v * 0.3);
      if (P.bumpy) g += Math.sin(th * 5 + v * 7) * P.bumpy * 0.6 + Math.cos(th * 3 - v * 11) * P.bumpy * 0.4;
      if (style === 'slick') g = 0.05;
      return H(th, ph, g);
    }, U, V, (u, v, i, j) => (style === 'combover' && j < 2 && (i % 2 === 0) ? null : hc(u, v, i, j)), style === 'slick' ? 'gloss' : 'matte');
    // fringe / bangs
    if (['bob', 'bighair', 'wavy', 'long'].includes(style) && !hat) {
      m.surface((u, v) => H((u - 0.5) * 1.6, PI * (0.18 + v * 0.14), P.grow * 0.7 + 0.02), 5, 1, hc);
    }
    if (style === 'spiky' && !hat) {
      for (let k = 0; k < 9; k++) {
        const th = (k / 9) * 2 * PI * 0.8 - PI * 0.8, ph = PI * (0.08 + (k % 3) * 0.1);
        const base = [H(th - 0.25, ph + 0.1, 0.05), H(th + 0.25, ph + 0.1, 0.05), H(th, ph - 0.1, 0.05)];
        const tip = H(th, ph, 0.38);
        const ids = base.map((p) => m.vert(...p)), t = m.vert(...tip);
        m.tri(ids[0], ids[1], t, hairC, 'gloss'); m.tri(ids[1], ids[2], t, scaleC(hairC, 0.8)); m.tri(ids[2], ids[0], t, scaleC(hairC, 0.9));
      }
    }
    if (style === 'long' || style === 'wavy' || style === 'bighair') {
      // hanging back panel down to shoulders
      const drop = style === 'bighair' ? 0.6 : 0.95;
      m.surface((u, v) => {
        const th = PI * 0.5 + u * PI;
        const p = H(th, PI * 0.8, P.grow + 0.02);
        return [p[0] * (1 + v * 0.25), p[1] - v * drop, p[2] - 0.05 * v];
      }, 6, 2, hc);
    }
    if (style === 'bun' && !hat) {
      const c = H(PI, PI * 0.22, 0.2);
      addBlob(m, c, 0.26, hairC, 6, 4);
    }
    if (style === 'ponytail' || style === 'braid') {
      const base = H(PI, PI * 0.45, 0.05);
      for (let k = 0; k < (style === 'braid' ? 5 : 3); k++) addBlob(m, [base[0], base[1] - k * 0.28, base[2] - 0.15 - k * 0.05], 0.17 - k * 0.015, mix(hairC, [0, 0, 0], k % 2 ? 0.15 : 0), 5, 3);
    }
  }

  function addBlob(m, c, r, col, us, vs) {
    m.surface((u, v) => {
      const th = u * 2 * PI, ph = v * PI;
      return [c[0] + Math.sin(th) * Math.sin(ph) * r, c[1] + Math.cos(ph) * r, c[2] + Math.cos(th) * Math.sin(ph) * r];
    }, us, vs, (u, v, i, j) => mix(col, [0, 0, 0], ((i + j) % 2) * 0.12));
  }

  function buildHat(m, L, H) {
    if (!L.hat) return;
    const hatColors = { cap: '#c03030', cowboy: '#8a5a2b', fedora: '#2b2b33', beanie: '#b8452a', bucket: '#d8c890' };
    const hc = hexToRgb(L.hatColor || hatColors[L.hat] || '#333');
    const ring = (y, r, rz) => (u) => [Math.sin(u * 2 * PI) * r, y, Math.cos(u * 2 * PI) * (rz || r)];
    const W = 0.8 * (L.headW || 1);
    if (L.hat === 'cap' || L.hat === 'beanie') {
      m.surface((u, v) => H(u * 2 * PI, v * PI * 0.34, 0.08), 12, 4, (u, v, i) => (i % 3 === 0 ? scaleC(hc, 0.85) : hc));
      if (L.hat === 'cap') {
        // brim
        const y = H(0, PI * 0.34, 0.08)[1];
        m.surface((u, v) => { const th = (u - 0.5) * 1.8; const r = 0.86 + v * 0.45; return [Math.sin(th) * r * W * 1.05, y - v * 0.06, Math.cos(th) * r]; }, 6, 1, () => scaleC(hc, 0.75));
        const btn = H(0, 0.01, 0.1); addBlob(m, btn, 0.05, hc, 4, 2);
      } else {
        m.surface((u, v) => H(u * 2 * PI, PI * (0.3 + v * 0.07), 0.12), 12, 1, (u, v, i) => (i % 2 ? scaleC(hc, 0.8) : scaleC(hc, 0.7)));
      }
      return;
    }
    const top = L.hat === 'cowboy' ? 1.45 : L.hat === 'fedora' ? 1.32 : 1.2;
    const base = 0.62;
    const brimR = L.hat === 'cowboy' ? 1.65 : L.hat === 'fedora' ? 1.28 : 1.12;
    // crown
    m.surface((u, v) => {
      const y = base + v * (top - base);
      const r = (L.hat === 'bucket' ? 0.95 - v * 0.2 : 0.9 - v * 0.08) ;
      const pinch = L.hat !== 'bucket' ? 1 - 0.12 * Math.max(0, Math.cos(u * 2 * PI)) * v : 1;
      return [Math.sin(u * 2 * PI) * r * W * pinch, top + base - y, Math.cos(u * 2 * PI) * r * 0.95 * pinch];
    }, 10, 2, (u, v, i) => (v > 0.6 ? scaleC(hc, 0.75) : hc), 'matte', { flip: false });
    m.surface((u) => ring(top + 0.01, 0.001)(u), 10, 0, () => hc);
    // top cap
    const c = m.vert(0, top + 0.02, 0);
    const pts = [];
    for (let i = 0; i < 10; i++) { const u = i / 10; pts.push(m.vert(Math.sin(u * 2 * PI) * 0.72 * W * (L.hat === 'bucket' ? 0.95 : 1), top - 0.02, Math.cos(u * 2 * PI) * 0.68)); }
    for (let i = 0; i < 10; i++) m.tri(c, pts[i], pts[(i + 1) % 10], scaleC(hc, 0.95));
    // band
    m.surface((u, v) => { const r = 0.9 * (1.005); return [Math.sin(u * 2 * PI) * r * W, base + 0.14 - v * 0.12, Math.cos(u * 2 * PI) * r * 0.95]; }, 10, 1, () => (L.hat === 'bucket' ? scaleC(hc, 0.8) : [30, 25, 20]));
    // brim (ring), cowboy brim curls up at the sides
    m.surface((u, v) => {
      const th = u * 2 * PI; const r = 0.88 + v * (brimR - 0.88);
      let y = base + 0.02;
      if (L.hat === 'cowboy') y += Math.pow(Math.abs(Math.sin(th)), 2) * v * 0.3;
      if (L.hat === 'bucket') y -= v * 0.18;
      if (L.hat === 'fedora') y -= Math.max(0, Math.cos(th)) * v * 0.08;
      return [Math.sin(th) * r * W, y, Math.cos(th) * r * 0.95];
    }, 14, 1, (u) => scaleC(hc, 0.85 + 0.1 * Math.sin(u * 20)));
    m.surface((u, v) => {
      const th = u * 2 * PI; const r = 0.88 + (1 - v) * (brimR - 0.88);
      let y = base + 0.0;
      if (L.hat === 'cowboy') y += Math.pow(Math.abs(Math.sin(th)), 2) * (1 - v) * 0.3;
      if (L.hat === 'bucket') y -= (1 - v) * 0.18;
      if (L.hat === 'fedora') y -= Math.max(0, Math.cos(th)) * (1 - v) * 0.08;
      return [Math.sin(th) * r * W, y, Math.cos(th) * r * 0.95];
    }, 14, 1, () => scaleC(hc, 0.6));
  }

  function buildGlasses(m, L, H) {
    if (!L.glasses) return;
    const shades = L.glasses === 'shades';
    const frame = shades ? [20, 20, 25] : L.glasses === 'round' ? [120, 90, 40] : [30, 30, 35];
    const lens = shades ? [25, 25, 35] : [200, 220, 235];
    const eyeY = PI * 0.49;
    for (const s of [-1, 1]) {
      const cx = s * 0.36;
      const n = L.glasses === 'round' ? 8 : 4;
      const center = m.vert(...H(cx, eyeY, 0.1));
      const rim = [], rimO = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 2 * PI + (n === 4 ? PI / 4 : 0);
        const rx = n === 4 ? 0.2 : 0.16, ry = n === 4 ? 0.12 : 0.14;
        rim.push(m.vert(...H(cx + Math.cos(a) * rx, eyeY + Math.sin(a) * ry, 0.1)));
        rimO.push(m.vert(...H(cx + Math.cos(a) * (rx + 0.03), eyeY + Math.sin(a) * (ry + 0.03), 0.1)));
      }
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        m.tri(center, rim[k2], rim[k], lens, 'glass');
        m.quad(rim[k], rim[k2], rimO[k2], rimO[k], frame, 'gloss');
      }
      // arm to ear
      const a1 = m.vert(...H(s * 0.58, eyeY - 0.02, 0.08)), a2 = m.vert(...H(s * 1.45, eyeY - 0.02, 0.06)), a3 = m.vert(...H(s * 1.45, eyeY + 0.03, 0.06)), a4 = m.vert(...H(s * 0.58, eyeY + 0.03, 0.08));
      if (s > 0) m.quad(a1, a2, a3, a4, frame); else m.quad(a1, a4, a3, a2, frame);
    }
    const b1 = m.vert(...H(-0.17, eyeY - 0.03, 0.12)), b2 = m.vert(...H(0.17, eyeY - 0.03, 0.12)), b3 = m.vert(...H(0.17, eyeY + 0.01, 0.12)), b4 = m.vert(...H(-0.17, eyeY + 0.01, 0.12));
    m.quad(b1, b2, b3, b4, frame, 'gloss');
  }

  function buildBody(m, L, skin, shirt, rng) {
    const top = L.top || 'tee';
    // neck
    m.surface((u, v) => [Math.sin(u * 2 * PI) * 0.3, -0.85 - v * 0.45, Math.cos(u * 2 * PI) * 0.28 - 0.05], 8, 1, (u) => scaleC(skin, 0.85 + 0.1 * Math.cos(u * 2 * PI)));
    // torso: shoulders
    const pattern = (u, v, i, j) => {
      let c = shirt;
      if (top === 'flannel' && (i + j) % 2) c = mix(shirt, [20, 20, 20], 0.35);
      if (top === 'hawaiian' && (i * 7 + j * 3) % 5 === 0) c = [240, 220, 90];
      if (top === 'hawaiian' && (i * 5 + j * 2) % 7 === 0) c = [240, 90, 90];
      if (top === 'sequin' && rng() < 0.3) c = mix(shirt, [255, 255, 255], 0.5);
      if (top === 'tweed' && (i + j * 2) % 3 === 0) c = scaleC(shirt, 0.85);
      if (top === 'sweater' && j === 1) c = mix(shirt, [255, 255, 255], 0.3);
      return c;
    };
    m.surface((u, v) => {
      const th = u * 2 * PI;
      const y = -1.22 - v * 1.0;
      const w = 0.45 + Math.min(1, v * 2.2) * 0.95;
      const d = 0.4 + Math.min(1, v * 2) * 0.22;
      return [Math.sin(th) * w, y, Math.cos(th) * d - 0.1];
    }, 12, 3, pattern, top === 'sequin' || top === 'suit' ? 'gloss' : 'matte');
    // collars / details on the front
    const front = (x0, x1, y0, y1, z, col, mat) => {
      const a = m.vert(x0, y0, z), b = m.vert(x1, y0, z), c = m.vert(x1, y1, z + 0.02), d = m.vert(x0, y1, z + 0.02);
      m.quad(a, b, c, d, col, mat);
    };
    if (top === 'suit' || top === 'tweed' || top === 'jacket' || top === 'vest') {
      // V opening with shirt/tie
      const shirtC = top === 'jacket' ? [30, 30, 30] : [240, 240, 240];
      const a = m.vert(-0.28, -1.25, 0.33), b = m.vert(0.28, -1.25, 0.33), c = m.vert(0, -1.85, 0.52);
      m.tri(a, b, c, shirtC);
      if (top === 'suit' || top === 'tweed') {
        const t1 = m.vert(-0.06, -1.3, 0.38), t2 = m.vert(0.06, -1.3, 0.38), t3 = m.vert(0, -1.8, 0.53);
        m.tri(t1, t2, t3, top === 'tweed' ? [120, 30, 30] : [160, 30, 40], 'gloss');
      }
    }
    if (top === 'hoodie') {
      m.surface((u, v) => { const th = PI * 0.55 + u * PI * 0.9; return [Math.sin(th) * (0.55 + v * 0.1), -1.05 - v * 0.2, Math.cos(th) * (0.5 + v * 0.1) - 0.1]; }, 8, 1, () => scaleC(shirt, 0.8));
      front(-0.12, -0.09, -1.35, -1.75, 0.5, [230, 230, 230]); front(0.09, 0.12, -1.35, -1.75, 0.5, [230, 230, 230]);
    }
    if (top === 'polo' || top === 'blouse' || top === 'cardigan') {
      const a = m.vert(-0.32, -1.2, 0.3), b = m.vert(0, -1.4, 0.42), c = m.vert(-0.18, -1.45, 0.4);
      const d = m.vert(0.32, -1.2, 0.3), e = m.vert(0.18, -1.45, 0.4);
      const cc = mix(shirt, [255, 255, 255], 0.35);
      m.tri(a, b, c, cc); m.tri(d, e, b, cc);
    }
    if (top === 'apron') front(-0.45, 0.45, -1.5, -2.2, 0.55, [235, 235, 230]);
  }

  // ---------- rasterizer ----------
  function render(mesh, ctx, W, Hh, cam) {
    const yaw = cam.yaw || 0, pitch = cam.pitch || 0, dist = cam.dist || 5.2;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const tv = mesh.v.map(([x, y, z]) => {
      y -= cam.lookY || 0;
      let x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      let y1 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      return [x1, y1, z2];
    });
    const f = cam.fov || 3.2;
    const proj = tv.map(([x, y, z]) => {
      const k = f / (dist - z);
      return [W / 2 + x * k * W / 4, Hh / 2 - y * k * W / 4, z];
    });
    const light = normalize(cam.light || [-0.5, 0.7, 0.8]);
    const rim = normalize([0.8, 0.3, -0.4]);
    const faces = [];
    for (const face of mesh.f) {
      const [a, b, c] = face.i;
      const A = tv[a], B = tv[b], Cc = tv[c];
      const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [Cc[0] - A[0], Cc[1] - A[1], Cc[2] - A[2]];
      let n = normalize([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
      // No culling (hand-built feature quads have mixed winding): painter's order + normals flipped toward the camera.
      const P = proj[a], Q = proj[b], R = proj[c];
      if (n[2] < 0) n = n.map((x) => -x);
      const z = (A[2] + B[2] + Cc[2]) / 3;
      faces.push({ P, Q, R, z, n, face });
    }
    faces.sort((a, b) => a.z - b.z);
    for (const fc of faces) {
      const { n, face } = fc;
      const diff = Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
      const rimL = Math.max(0, n[0] * rim[0] + n[1] * rim[1] + n[2] * rim[2]) * 0.25;
      let k = 0.42 + diff * 0.7 + rimL;
      let col = scaleC(face.color, k);
      if (face.mat === 'gloss' || face.mat === 'glass') {
        const h = normalize([light[0], light[1], light[2] + 1]);
        const spec = Math.pow(Math.max(0, n[0] * h[0] + n[1] * h[1] + n[2] * h[2]), 18) * (face.mat === 'glass' ? (face.color[0] > 100 ? 1.0 : 0.45) : 0.8);
        col = mix(col, [255, 255, 255], Math.min(1, spec));
      }
      const fill = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
      ctx.globalAlpha = face.mat === 'glass' && face.color[0] > 100 ? 0.35 : 1;
      ctx.fillStyle = fill; ctx.strokeStyle = fill; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(fc.P[0], fc.P[1]); ctx.lineTo(fc.Q[0], fc.Q[1]); ctx.lineTo(fc.R[0], fc.R[1]); ctx.closePath();
      ctx.fill(); if (face.mat !== 'glass') ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function normalize(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

  // ---------- public: portrait ----------
  const cache = new Map();
  const BG = ['#1b2a4a', '#3a1b4a', '#1b4a3a', '#4a2a1b', '#2a2a2a', '#1b3a4a', '#4a1b2a'];
  function portrait(character, expr, size) {
    expr = expr || 'neutral'; size = size || 160;
    const key = character.id + ':' + expr + ':' + size;
    if (cache.has(key)) return cache.get(key);
    if (typeof document === 'undefined') return '';
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d');
    const seed = FS.util.hashString(character.id);
    const rng = FS.util.makeRng(seed);
    // backdrop: PS2 menu gradient with a soft vignette + scanlines
    const bgc = character.id === 'hero' ? '#1c3f7a' : BG[seed % BG.length];
    const g = ctx.createRadialGradient(size * 0.5, size * 0.38, size * 0.08, size * 0.5, size * 0.5, size * 0.75);
    g.addColorStop(0, shade(bgc, 1.9)); g.addColorStop(1, shade(bgc, 0.5));
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    const L = Object.assign({ brow: { maniac: 0.05, lag: 0.03, rock: 0.02, nit: -0.02, fish: -0.03 }[character.style] || 0 }, character.look);
    const mesh = buildCharacter(L, expr, rng);
    const yaw = ((seed % 7) - 3) * 0.07 + (expr === 'grumpy' ? 0.12 : 0);
    render(mesh, ctx, size, size, { yaw, pitch: -0.08, dist: 6.4, lookY: -0.42, fov: 5.3 });
    ctx.fillStyle = 'rgba(0,0,0,0.07)';
    for (let y = 0; y < size; y += 3) ctx.fillRect(0, y, size, 1);
    const url = cv.toDataURL();
    cache.set(key, url);
    return url;
  }
  function shade(hex, k) { const c = scaleC(hexToRgb(hex), k).map((x) => Math.min(255, x | 0)); return `rgb(${c[0]},${c[1]},${c[2]})`; }

  // ---------- title-screen spinning chip ----------
  function chipMesh(color) {
    const m = new Mesh();
    const base = hexToRgb(color || '#c02828');
    const white = [240, 240, 235];
    const N = 24;
    const r = 1, h = 0.18;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * 2 * PI, a1 = ((i + 1) / N) * 2 * PI;
      const col = Math.floor(i / 2) % 2 ? base : white;
      const p = (a, y, rr) => m.vert(Math.cos(a) * rr, y, Math.sin(a) * rr);
      m.quad(p(a0, h, r), p(a1, h, r), p(a1, -h, r), p(a0, -h, r), col, 'gloss'); // edge
      for (const [y, flip] of [[h, false], [-h, true]]) {
        const c0 = m.vert(0, y, 0);
        const i0 = p(a0, y, r * 0.62), i1 = p(a1, y, r * 0.62), o0 = p(a0, y, r), o1 = p(a1, y, r);
        const inner = base;
        if (!flip) { m.tri(c0, i1, i0, inner); m.quad(i0, i1, o1, o0, col); }
        else { m.tri(c0, i0, i1, inner); m.quad(i0, o0, o1, i1, col); }
      }
    }
    return m;
  }

  FS.avatars = { portrait, render, buildCharacter, chipMesh, Mesh, hexToRgb };
})(typeof window !== 'undefined' ? window : globalThis);
