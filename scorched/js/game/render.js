/* Scorched — 2D canvas renderer. Draws a Game; owns only visual state (particles, shake, damage
   numbers), which it derives from the game's events. The canvas is the world's size and CSS scales
   it to the window. */
(function (root) {
  'use strict';
  const SE = root.SE || (root.SE = {});
  const { clamp, DEG, makeRng } = SE.util;
  const C = SE.game.C;

  // Sky + ground themes. Ground: [crust, light dirt, deep dirt].
  const THEMES = [
    { name: 'day', sky: ['#3d7fd6', '#9ccbf2', '#f4e6c4'], hills: ['#7ea9cf', '#5f8db8'], ground: ['#5fbf3f', '#b07a44', '#3d2716'], stars: 0 },
    { name: 'dusk', sky: ['#24154a', '#b2456e', '#ffb35c'], hills: ['#6b2f5c', '#4a1f45'], ground: ['#d38b3a', '#8a4a2a', '#2a120c'], stars: 0.3, sun: '#ffd27a' },
    { name: 'night', sky: ['#02030d', '#0b1640', '#1d3570'], hills: ['#14244a', '#0e1a36'], ground: ['#8fa6c9', '#4b5873', '#141a26'], stars: 1, moon: true },
    { name: 'toxic', sky: ['#081a0c', '#1e5233', '#9be36b'], hills: ['#1d4a2a', '#143820'], ground: ['#c7f05a', '#5d6b2a', '#1b1f0c'], stars: 0.2 },
    { name: 'mars', sky: ['#2b0a06', '#8c2a12', '#f08a4b'], hills: ['#7a2a14', '#5a1c0c'], ground: ['#f2a65a', '#a8441f', '#3a1208'], stars: 0.4 },
  ];

  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  /** 64 shades × 4 grain variants, indexed shade * 4 + variant. */
  function buildPalette(theme) {
    const pal = new Uint32Array(256);
    const crust = hex(theme.ground[0]), light = hex(theme.ground[1]), deep = hex(theme.ground[2]);
    const pack = (c) => (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]; // little-endian RGBA
    pal[1] = pack(crust);
    for (let s = 2; s < 64; s++) {
      const t = Math.min(1, (s - 2) / 50);
      const c = mix(light, deep, t);
      const band = (s % 3 === 0) ? 0.92 : 1; // subtle strata
      pal[s] = pack(c.map((v) => Math.round(v * band)));
    }
    pal[60] = pack([28, 22, 18]); pal[61] = pack([40, 30, 24]); pal[62] = pack([22, 18, 16]); pal[63] = pack(deep.map((v) => v * 0.7));
    const out = new Uint32Array(256);
    const grain = [1, 0.94, 1.05, 0.9];
    for (let s = 1; s < 64; s++) {
      const c = [pal[s] & 255, (pal[s] >> 8) & 255, (pal[s] >> 16) & 255];
      for (let v = 0; v < 4; v++) out[s * 4 + v] = pack(c.map((ch) => Math.min(255, Math.round(ch * grain[v]))));
    }
    return out;
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.particles = []; this.texts = []; this.wrecks = [];
      this.shake = 0; this.flash = 0;
      this.game = null; this.unsub = null;
      this.rng = makeRng(1234);
      this.showAim = false;
    }

    attach(game) {
      if (this.unsub) this.unsub();
      this.game = game;
      this.canvas.width = game.w; this.canvas.height = game.h;
      this.terrainCanvas = document.createElement('canvas');
      this.terrainCanvas.width = game.w; this.terrainCanvas.height = game.h;
      this.tctx = this.terrainCanvas.getContext('2d');
      this.image = this.tctx.createImageData(game.w, game.h);
      this.pixels = new Uint32Array(this.image.data.buffer);
      this.terrainRef = null;
      this.unsub = game.on((type, d) => this.onEvent(type, d));
    }

    onEvent(type, d) {
      const rng = this.rng;
      if (type === 'roundStart') { this.particles = []; this.texts = []; this.wrecks = []; }
      if (type === 'boom') {
        this.shake = Math.max(this.shake, d.shake || 4);
        if (d.r > 60) this.flash = 0.6;
        const n = Math.min(70, 8 + d.r);
        for (let i = 0; i < n; i++) {
          const a = rng.range(0, Math.PI * 2), v = rng.range(40, 120 + d.r * 3);
          this.particles.push({ x: d.x, y: d.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: rng.range(0.4, 1.2), max: 1.2,
            kind: rng() < 0.55 ? 'spark' : 'dirt', size: rng.range(1, 2.6) });
        }
        for (let i = 0; i < Math.min(14, 3 + d.r / 6); i++) {
          this.particles.push({ x: d.x + rng.range(-d.r, d.r) * 0.5, y: d.y + rng.range(-d.r, d.r) * 0.3, vx: rng.range(-12, 12), vy: rng.range(-35, -10),
            life: rng.range(1.2, 2.6), max: 2.6, kind: 'smoke', size: rng.range(6, 10 + d.r / 5) });
        }
      }
      if (type === 'dirt') {
        for (let i = 0; i < 25; i++) {
          const a = rng.range(0, Math.PI * 2);
          this.particles.push({ x: d.x, y: d.y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90 - 40, life: 0.6, max: 0.6, kind: 'dirt', size: 2 });
        }
      }
      if (type === 'hit' || type === 'shieldHit') {
        const p = d.player, shield = type === 'shieldHit';
        const tx = this.texts.find((t) => t.id === p.id && t.shield === shield && t.age < 0.6);
        if (tx) { tx.amount += d.amount; tx.age = Math.min(tx.age, 0.2); }
        else this.texts.push({ id: p.id, shield, x: p.x + (shield ? -14 : 0), y: p.y - (shield ? 38 : 26), amount: d.amount, age: 0 });
      }
      if (type === 'death') {
        const p = d.player;
        this.wrecks.push({ x: p.x, y: p.y, color: p.color, id: p.id });
      }
    }

    // ---------- static layers ----------

    buildSky() {
      const g = this.game, w = g.w, h = g.h;
      const theme = THEMES[g.sky % THEMES.length];
      this.theme = theme;
      this.palette = buildPalette(theme);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d');
      const grad = x.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, theme.sky[0]); grad.addColorStop(0.55, theme.sky[1]); grad.addColorStop(1, theme.sky[2]);
      x.fillStyle = grad; x.fillRect(0, 0, w, h);
      const rng = makeRng(g.opts.seed + g.round * 977);
      if (theme.stars) {
        for (let i = 0; i < 220 * theme.stars; i++) {
          x.fillStyle = `rgba(255,255,255,${rng.range(0.2, 0.9)})`;
          const s = rng() < 0.1 ? 2 : 1;
          x.fillRect(rng() * w, rng() * h * 0.6, s, s);
        }
      }
      if (theme.moon) {
        x.fillStyle = '#f2f0dc'; x.beginPath(); x.arc(w * 0.82, h * 0.16, 26, 0, Math.PI * 2); x.fill();
        x.fillStyle = theme.sky[0]; x.beginPath(); x.arc(w * 0.82 + 11, h * 0.16 - 6, 23, 0, Math.PI * 2); x.fill();
      }
      if (theme.sun) {
        const sg = x.createRadialGradient(w * 0.25, h * 0.62, 10, w * 0.25, h * 0.62, 160);
        sg.addColorStop(0, theme.sun); sg.addColorStop(0.25, rgba(hex(theme.sun), 0.5)); sg.addColorStop(1, rgba(hex(theme.sun), 0));
        x.fillStyle = sg; x.fillRect(0, 0, w, h);
      }
      // Two layers of distant hills for depth.
      theme.hills.forEach((col, layer) => {
        x.fillStyle = col; x.globalAlpha = 0.55 + layer * 0.2;
        x.beginPath(); x.moveTo(0, h);
        const base = h * (0.42 + layer * 0.1), ph = rng() * 6, k = rng.range(2, 5);
        for (let px = 0; px <= w; px += 8) {
          const y = base + Math.sin(ph + (px / w) * Math.PI * k) * 40 + Math.sin(ph * 2 + px * 0.013) * 18 + Math.sin(px * 0.05 + ph) * 4;
          x.lineTo(px, y);
        }
        x.lineTo(w, h); x.closePath(); x.fill();
      });
      x.globalAlpha = 1;
      this.skyCanvas = c;
      this.skyRound = g.round + ':' + g.opts.seed;
    }

    syncTerrain() {
      const T = this.game.terrain;
      if (T !== this.terrainRef) { this.terrainRef = T; T.markAll(); this.buildSky(); }
      const d = T.dirty; if (!d) return;
      T.dirty = null;
      const { w, cells } = T, px = this.pixels, pal = this.palette;
      for (let y = d.y0; y <= d.y1; y++) {
        let i = y * w + d.x0;
        for (let x = d.x0; x <= d.x1; x++, i++) {
          const c = cells[i];
          px[i] = c ? pal[c * 4 + (((x * 374761393 + y * 668265263) ^ (x * y)) >>> 13 & 3)] : 0;
        }
      }
      this.tctx.putImageData(this.image, 0, 0, d.x0, d.y0, d.x1 - d.x0 + 1, d.y1 - d.y0 + 1);
    }

    // ---------- frame ----------

    draw(dt) {
      const g = this.game; if (!g || !g.terrain) return;
      const ctx = this.ctx;
      this.syncTerrain();
      this.stepFx(dt);
      ctx.save();
      if (this.shake > 0.3) ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      ctx.drawImage(this.skyCanvas, 0, 0);
      ctx.drawImage(this.terrainCanvas, 0, 0);
      this.drawTrails(ctx);
      for (const wk of this.wrecks) this.drawWreck(ctx, wk);
      for (const t of g.players) if (t.alive) this.drawTank(ctx, t, t === g.current && (g.phase === 'aim'));
      this.drawFlames(ctx);
      this.drawProjectiles(ctx);
      this.drawExplosions(ctx);
      this.drawParticles(ctx);
      this.drawTexts(ctx);
      if (this.showAim && g.phase === 'aim' && g.current && !g.current.ai) this.drawAimGuide(ctx, g.current);
      ctx.restore();
      if (this.flash > 0) { ctx.fillStyle = `rgba(255,250,230,${this.flash * 0.6})`; ctx.fillRect(0, 0, g.w, g.h); }
    }

    stepFx(dt) {
      this.shake *= Math.pow(0.02, dt);
      this.flash = Math.max(0, this.flash - dt * 1.5);
      const T = this.game.terrain;
      for (const p of this.particles) {
        p.life -= dt;
        if (p.kind === 'smoke') { p.x += p.vx * dt; p.y += p.vy * dt; p.size += dt * 6; continue; }
        p.vy += C.GRAVITY * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.kind === 'dirt' && T.solid(p.x, p.y)) p.life = 0;
      }
      this.particles = this.particles.filter((p) => p.life > 0);
      for (const t of this.texts) { t.age += dt; t.y -= dt * 22; }
      this.texts = this.texts.filter((t) => t.age < 1.6);
      // Smoke drifting off wrecks.
      for (const wk of this.wrecks) {
        if (this.rng() < dt * 5) this.particles.push({ x: wk.x + this.rng.range(-5, 5), y: wk.y - 6, vx: this.game.wind * 0.3, vy: -20,
          life: 2, max: 2, kind: 'smoke', size: 4 });
        wk.y = Math.min(T.surface(wk.x, wk.y - 2), T.h);
      }
    }

    drawTank(ctx, t, active) {
      const x = Math.round(t.x), y = Math.round(t.y);
      const a = t.angle * DEG;
      // Shield bubble.
      if (t.shield > 0) {
        const s = t.shield / Math.max(1, t.shieldMax), r = C.SHIELD_R;
        const gr = ctx.createRadialGradient(x, y - 4, r * 0.4, x, y - 4, r);
        gr.addColorStop(0, 'rgba(120,220,255,0)'); gr.addColorStop(1, `rgba(140,230,255,${0.25 + 0.4 * s})`);
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y - 4, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = `rgba(190,245,255,${0.4 + 0.5 * s})`; ctx.lineWidth = 1.2; ctx.stroke();
      }
      // Parachute.
      if (t.chute && t.falling) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x - 9, y - 8); ctx.lineTo(x - 14, y - 30); ctx.moveTo(x + 9, y - 8); ctx.lineTo(x + 14, y - 30); ctx.stroke();
        ctx.fillStyle = '#f4f4f4'; ctx.beginPath(); ctx.arc(x, y - 30, 16, Math.PI, 0); ctx.fill();
        ctx.fillStyle = t.color; ctx.beginPath(); ctx.arc(x, y - 30, 16, Math.PI * 1.33, Math.PI * 1.66); ctx.lineTo(x, y - 30); ctx.fill();
      }
      // Barrel.
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y - C.PIVOT_UP); ctx.lineTo(x + Math.cos(a) * C.BARREL, y - C.PIVOT_UP - Math.sin(a) * C.BARREL); ctx.stroke();
      ctx.strokeStyle = '#d8d8d8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y - C.PIVOT_UP); ctx.lineTo(x + Math.cos(a) * C.BARREL, y - C.PIVOT_UP - Math.sin(a) * C.BARREL); ctx.stroke();
      // Dome, hull, tracks.
      ctx.fillStyle = t.color;
      ctx.beginPath(); ctx.arc(x, y - 7, 5.5, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - 10, y - 3.5); ctx.lineTo(x - 8, y - 7.5); ctx.lineTo(x + 8, y - 7.5); ctx.lineTo(x + 10, y - 3.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x - 7, y - 7.5, 14, 1.2);
      ctx.fillStyle = '#222'; ctx.beginPath(); ctx.roundRect(x - 10.5, y - 4, 21, 4.5, 2.2); ctx.fill();
      ctx.fillStyle = '#555'; for (let i = -8; i <= 8; i += 4) ctx.fillRect(x + i - 0.6, y - 2.6, 1.2, 1.6);
      // Health bar (when hurt) and the active marker.
      if (t.health < C.MAX_HEALTH || t.shield > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 11, y - 22, 22, 3.5);
        ctx.fillStyle = t.health > 50 ? '#5fe05f' : t.health > 25 ? '#f0c040' : '#f04040';
        ctx.fillRect(x - 10.5, y - 21.5, 21 * (t.health / C.MAX_HEALTH), 2.5);
      }
      if (t.shield > 0) { // remaining shield strength
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 11, y - 26.5, 22, 3.5);
        ctx.fillStyle = '#7fe3ff'; ctx.fillRect(x - 10.5, y - 26, 21 * (t.shield / Math.max(1, t.shieldMax)), 2.5);
      }
      if (active) {
        const bob = Math.sin(this.game.time * 6) * 3;
        ctx.fillStyle = t.color; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y - 27 + bob); ctx.lineTo(x - 6, y - 36 + bob); ctx.lineTo(x + 6, y - 36 + bob); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.strokeText(t.name, x, y - 40 + bob);
        ctx.fillStyle = '#fff'; ctx.fillText(t.name, x, y - 40 + bob);
      }
    }

    drawWreck(ctx, wk) {
      const x = Math.round(wk.x), y = Math.round(wk.y);
      ctx.fillStyle = '#1c1916';
      ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.lineTo(x - 7, y - 5); ctx.lineTo(x - 1, y - 7); ctx.lineTo(x + 6, y - 4); ctx.lineTo(x + 10, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = wk.color; ctx.globalAlpha = 0.35; ctx.fillRect(x - 6, y - 4, 10, 2); ctx.globalAlpha = 1;
    }

    drawTrails(ctx) {
      const g = this.game, w = g.w;
      const line = (pts, color, alpha, dash) => {
        if (pts.length < 4) return;
        ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = 1.2; ctx.setLineDash(dash || []);
        ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) {
          if (Math.abs(pts[i] - pts[i - 2]) > w / 2) ctx.moveTo(pts[i], pts[i + 1]); else ctx.lineTo(pts[i], pts[i + 1]);
        }
        ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      };
      if (g.phase === 'aim' && g.current && g.lastTrail[g.current.id]) line(g.lastTrail[g.current.id].pts, g.current.color, 0.45, [3, 4]);
      if (g.phase === 'flight') for (const t of g.trails) line(t.pts, t.color, 0.7);
    }

    drawProjectiles(ctx) {
      for (const p of this.game.projectiles) {
        if (p.kind === 'digger') continue;
        const r = p.kind === 'roller' ? 3.5 : 2.4;
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (p.kind === 'shell' && p.y < 0) { // off the top: show a marker
          ctx.fillStyle = p.owner.color; ctx.beginPath(); ctx.moveTo(p.x, 3); ctx.lineTo(p.x - 5, 11); ctx.lineTo(p.x + 5, 11); ctx.fill();
        }
      }
    }

    drawExplosions(ctx) {
      for (const e of this.game.explosions) {
        if (e.t < 0 || e.r <= 0) continue;
        const grow = Math.min(1, e.t / e.grow);
        const fade = e.t > e.grow ? 1 - (e.t - e.grow) / (e.life - e.grow) : 1;
        const r = Math.max(1, e.r * Math.sqrt(grow));
        const harmless = !e.dmg;
        const gr = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
        if (harmless) { gr.addColorStop(0, `rgba(220,240,255,${fade})`); gr.addColorStop(1, `rgba(120,170,255,0)`); }
        else {
          const flick = 0.85 + Math.random() * 0.15;
          gr.addColorStop(0, `rgba(255,255,240,${fade})`);
          gr.addColorStop(0.3, `rgba(255,230,90,${fade * flick})`);
          gr.addColorStop(0.65, `rgba(255,110,20,${fade * 0.9})`);
          gr.addColorStop(1, 'rgba(180,20,0,0)');
        }
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.fill();
        if (e.t > e.grow) { // shock ring
          const k = (e.t - e.grow) / (e.life - e.grow);
          ctx.strokeStyle = `rgba(255,240,200,${0.5 * (1 - k)})`; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1 + k * 0.5), 0, Math.PI * 2); ctx.stroke();
        }
      }
    }

    drawFlames(ctx) {
      const t = this.game.time;
      for (const f of this.game.flames) {
        const s = 3 + Math.sin(t * 20 + f.seed * 40) * 1.5 + Math.min(1, f.life) * 2;
        const gr = ctx.createRadialGradient(f.x, f.y - s * 0.6, 0, f.x, f.y - s * 0.6, s * 2);
        gr.addColorStop(0, 'rgba(255,240,140,0.95)'); gr.addColorStop(0.5, 'rgba(255,120,20,0.7)'); gr.addColorStop(1, 'rgba(200,30,0,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(f.x, f.y - s * 0.6, s * 2, 0, Math.PI * 2); ctx.fill();
      }
    }

    drawParticles(ctx) {
      for (const p of this.particles) {
        const k = clamp(p.life / p.max, 0, 1);
        if (p.kind === 'smoke') {
          ctx.fillStyle = `rgba(60,55,50,${0.35 * k})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        } else if (p.kind === 'spark') {
          ctx.fillStyle = `rgba(255,${180 + 70 * k | 0},80,${k})`; ctx.fillRect(p.x, p.y, p.size, p.size);
        } else {
          ctx.fillStyle = `rgba(90,60,35,${Math.min(1, k * 2)})`; ctx.fillRect(p.x, p.y, p.size, p.size);
        }
      }
    }

    drawTexts(ctx) {
      ctx.font = 'bold 14px system-ui, sans-serif'; ctx.textAlign = 'center';
      for (const t of this.texts) {
        const a = clamp(1.6 - t.age, 0, 1);
        ctx.globalAlpha = a; ctx.lineWidth = 3; ctx.strokeStyle = '#000';
        const s = (t.shield ? '⛨ -' : '-') + Math.max(1, Math.round(t.amount));
        ctx.strokeText(s, t.x, t.y); ctx.fillStyle = t.shield ? '#8eeaff' : '#ffdf5a'; ctx.fillText(s, t.x, t.y);
      }
      ctx.globalAlpha = 1;
    }

    /** A short dotted line out of the barrel, whose length shows power. */
    drawAimGuide(ctx, t) {
      const a = t.angle * DEG, len = 20 + (t.power / 1000) * 70;
      const x0 = t.x + Math.cos(a) * 16, y0 = t.y - C.PIVOT_UP - Math.sin(a) * 16;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.setLineDash([2, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + Math.cos(a) * len, y0 - Math.sin(a) * len); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  /** Small icons for the shop and HUD, drawn in code. */
  function drawIcon(canvas, id) {
    const s = canvas.width, x = canvas.getContext('2d');
    x.clearRect(0, 0, s, s);
    const it = SE.weapons.get(id), c = s / 2;
    const ball = (bx, by, r, col) => { x.fillStyle = col; x.beginPath(); x.arc(bx, by, r, 0, Math.PI * 2); x.fill(); };
    const boom = (bx, by, r) => {
      const g = x.createRadialGradient(bx, by, 0, bx, by, r);
      g.addColorStop(0, '#fff8d0'); g.addColorStop(0.4, '#ffd040'); g.addColorStop(0.8, '#ff6010'); g.addColorStop(1, 'rgba(200,30,0,0)');
      x.fillStyle = g; x.beginPath(); x.arc(bx, by, r, 0, Math.PI * 2); x.fill();
    };
    const arc = (dash) => { x.strokeStyle = '#ddd'; x.lineWidth = 1.5; x.setLineDash(dash || []); x.beginPath(); x.moveTo(s * 0.1, s * 0.85); x.quadraticCurveTo(c, -s * 0.2, s * 0.9, s * 0.85); x.stroke(); x.setLineDash([]); };
    switch (it.kind || it.id) {
      case 'blast': if (it.damage) boom(c, c, s * (0.18 + it.radius / 200)); else { ball(c, c, s * 0.35, '#9ec5ff'); ball(c, c, s * 0.2, '#e8f2ff'); } break;
      case 'mirv': arc([2, 3]); for (let i = 0; i < Math.min(it.warheads, 7); i++) boom(s * (0.15 + i * 0.7 / Math.min(it.warheads - 1, 6)), s * 0.75, s * (it.radius > 30 ? 0.13 : 0.1)); break;
      case 'funky': boom(c, c, s * 0.22); ['#f4f', '#4ff', '#ff4', '#4f4', '#f84'].forEach((col, i) => ball(c + Math.cos(i * 1.3) * s * 0.33, c + Math.sin(i * 1.3) * s * 0.33, s * 0.07, col)); break;
      case 'leapfrog': x.strokeStyle = '#ddd'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(s * 0.05, s * 0.8);
        x.quadraticCurveTo(s * 0.2, s * 0.1, s * 0.35, s * 0.8); x.quadraticCurveTo(s * 0.5, s * 0.3, s * 0.65, s * 0.8); x.quadraticCurveTo(s * 0.78, s * 0.5, s * 0.9, s * 0.8); x.stroke();
        boom(s * 0.35, s * 0.8, s * 0.1); boom(s * 0.65, s * 0.8, s * 0.1); boom(s * 0.9, s * 0.8, s * 0.1); break;
      case 'roller': x.fillStyle = '#7a5230'; x.beginPath(); x.moveTo(0, s * 0.35); x.lineTo(s, s * 0.95); x.lineTo(0, s); x.fill();
        ball(s * 0.45, s * 0.5, s * (it.radius > 30 ? 0.16 : 0.12), '#eee'); break;
      case 'napalm': for (let i = 0; i < 3; i++) boom(s * (0.25 + i * 0.25), s * (0.6 - (i % 2) * 0.12), s * 0.22); break;
      case 'digger': x.fillStyle = '#7a5230'; x.fillRect(0, s * 0.3, s, s * 0.7); x.fillStyle = '#1a120a';
        x.beginPath(); x.arc(s * 0.3, s * 0.45, it.radius * 0.6 + 2, 0, Math.PI * 2); x.arc(c, s * 0.6, it.radius * 0.6 + 2, 0, Math.PI * 2); x.arc(s * 0.7, s * 0.75, it.radius * 0.6 + 2, 0, Math.PI * 2); x.fill();
        if (it.endRadius) boom(s * 0.75, s * 0.78, s * 0.2); break;
      case 'dirt': x.fillStyle = '#8a5a30'; x.beginPath(); x.arc(c, s * 0.95, s * (0.15 + it.radius / 140), Math.PI, 0); x.fill(); break;
      case 'tracer': arc([2, 3]); break;
      case 'parachute': x.fillStyle = '#eee'; x.beginPath(); x.arc(c, s * 0.4, s * 0.35, Math.PI, 0); x.fill();
        x.strokeStyle = '#eee'; x.beginPath(); x.moveTo(s * 0.15, s * 0.4); x.lineTo(c, s * 0.85); x.lineTo(s * 0.85, s * 0.4); x.stroke(); ball(c, s * 0.85, s * 0.08, '#c33'); break;
      case 'shield': case 'heavyshield': x.strokeStyle = id === 'shield' ? '#8ef' : '#4cf'; x.lineWidth = id === 'shield' ? 2 : 4;
        x.beginPath(); x.arc(c, c, s * 0.36, 0, Math.PI * 2); x.stroke(); ball(c, c * 1.1, s * 0.12, '#ccc'); break;
      case 'battery': x.fillStyle = '#ddd'; x.fillRect(s * 0.25, s * 0.25, s * 0.5, s * 0.6); x.fillRect(s * 0.4, s * 0.15, s * 0.2, s * 0.1);
        x.fillStyle = '#4c4'; x.fillRect(s * 0.3, s * 0.5, s * 0.4, s * 0.3); break;
      case 'fuel': x.fillStyle = '#c33'; x.fillRect(s * 0.25, s * 0.3, s * 0.5, s * 0.55); x.fillRect(s * 0.55, s * 0.18, s * 0.15, s * 0.14);
        x.fillStyle = '#fc4'; x.font = `bold ${s * 0.3}px sans-serif`; x.textAlign = 'center'; x.fillText('F', c, s * 0.72); break;
      default: boom(c, c, s * 0.3);
    }
  }

  SE.render = { Renderer, THEMES, drawIcon };
})(typeof globalThis !== 'undefined' ? globalThis : this);
