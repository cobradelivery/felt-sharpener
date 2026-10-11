/* Scorched — the simulation: rounds, turns, ballistics, weapon behaviours, damage, falling tanks
   and money. It has no DOM dependencies: the browser renders `game` and feeds it input, and the tests
   run whole AI-only games headless. Everything runs on a fixed 120 Hz step, so a shot simulated by
   the AI flies exactly like the real one. Screen coordinates: x right, y down. Angles in degrees,
   0 = right, 90 = straight up, 180 = left. */
(function (root) {
  'use strict';
  const SE = root.SE || (root.SE = {});
  const { makeRng, clamp, DEG, shuffle } = SE.util;
  const { Terrain } = SE.terrain;
  const W = SE.weapons;

  const C = {
    WIDTH: 1280, HEIGHT: 720,
    DT: 1 / 120,
    GRAVITY: 300,          // px/s²
    VMAX: 720,             // muzzle speed at power 1000
    WIND_ACCEL: 0.5,       // px/s² per wind unit
    TANK_HALF: 10, TANK_H: 9, TANK_R: 11, SHIELD_R: 22,
    BARREL: 13, PIVOT_UP: 8,
    MAX_HEALTH: 100, MAX_POWER: 1000,
    FALL_SAFE: 20, FALL_DMG: 0.45, CHUTE_AT: 14, CHUTE_SPEED: 45,
    DRIVE_SPEED: 40, CLIMB_MAX: 5,
    SETTLE_PASSES: 3,
  };

  const WIND_LEVELS = { none: 0, low: 20, medium: 50, high: 100 };

  function defaults(o) {
    return Object.assign({
      width: C.WIDTH, height: C.HEIGHT,
      rounds: 5, startCash: 10000, wind: 'medium', windChanges: true,
      walls: 'open',            // open | wrap | bounce
      terrain: 'random',        // random | one of SE.terrain.STYLES
      seed: (Math.random() * 2 ** 32) >>> 0,
      maxTurns: 0,              // 0 = unlimited turns per round
      players: [],
    }, o || {});
  }

  // ---------- ballistics (shared with the AI) ----------

  /** Advances a shell one step and checks what it hits along the way.
      Returns null (still flying), {lost:true}, or {x, y, px, py, tank} for an impact
      (px/py is the last free point before the impact). */
  function shellStep(world, p, dt) {
    const { terrain, tanks, walls } = world;
    const w = terrain.w;
    p.vx += world.wind * C.WIND_ACCEL * dt;
    p.vy += C.GRAVITY * dt;
    const x0 = p.x, y0 = p.y;
    let x1 = x0 + p.vx * dt; const y1 = y0 + p.vy * dt;
    if (walls === 'bounce' && (x1 < 0 || x1 >= w)) {
      x1 = x1 < 0 ? -x1 : 2 * (w - 1) - x1;
      p.vx = -p.vx * 0.85;
    }
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2));
    let px = x0, py = y0;
    for (let k = 1; k <= n; k++) {
      let x = x0 + (x1 - x0) * (k / n);
      const y = y0 + (y1 - y0) * (k / n);
      if (walls === 'wrap') x = ((x % w) + w) % w;
      if (y >= 0 && terrain.solid(x, y)) return { x, y, px, py, tank: null };
      for (const t of tanks) {
        if (!t.alive) continue;
        const cx = t.x, cy = t.y - C.TANK_H / 2;
        const d = Math.hypot(x - cx, y - cy);
        const r = t.shield > 0 ? C.SHIELD_R : C.TANK_R;
        if (t === p.owner && !p.armed) { if (d > r + 1) p.armed = true; continue; }
        if (d < r) return { x, y, px, py, tank: t };
      }
      px = x; py = y;
    }
    p.x = walls === 'wrap' ? ((x1 % w) + w) % w : x1;
    p.y = y1;
    if (walls === 'open' && (p.x < -300 || p.x > w + 300)) return { lost: true };
    if (p.y > terrain.h + 50) return { lost: true };
    return null;
  }

  function muzzle(t, angle, power) {
    const a = angle * DEG;
    const v = (power / 1000) * C.VMAX;
    const ox = t.x + Math.cos(a) * C.BARREL, oy = t.y - C.PIVOT_UP - Math.sin(a) * C.BARREL;
    return { x: ox, y: oy, vx: Math.cos(a) * v, vy: -Math.sin(a) * v };
  }

  // ---------- the game ----------

  class Game {
    constructor(opts) {
      this.opts = defaults(opts);
      this.w = this.opts.width; this.h = this.opts.height;
      this.rng = makeRng(this.opts.seed);
      this.listeners = [];
      this.round = 0;
      this.phase = 'setup';        // setup | aim | flight | roundOver | gameOver
      this.players = this.opts.players.map((p, i) => this.makePlayer(p, i));
      this.terrain = null;
      this.projectiles = []; this.explosions = []; this.flames = [];
      this.trails = [];            // trails of the shot in flight
      this.lastTrail = {};         // player id -> trail of their previous shot
      this.acc = 0; this.time = 0;
      this.history = [];           // per-round summaries
    }

    makePlayer(p, i) {
      const inv = { baby: Infinity };
      for (const x of W.WEAPONS) if (!(x.id in inv)) inv[x.id] = 0;
      for (const x of W.ITEMS) inv[x.id] = 0;
      return {
        id: i, name: p.name || 'Player ' + (i + 1), color: p.color || '#ff4040', ai: p.ai || null,
        cash: this.opts.startCash, score: 0, kills: 0, wins: 0, damageDealt: 0, inv,
        x: 0, y: 0, health: C.MAX_HEALTH, alive: false, angle: 60, power: 500,
        weapon: 'baby', shield: 0, shieldMax: 0, vy: 0, falling: false, fallFrom: 0, chute: false,
        round: null, ai_: null,
      };
    }

    on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }
    emit(type, data) { for (const fn of this.listeners) fn(type, data || {}); }

    get current() { return this.order ? this.order[this.turnIdx] : null; }
    alive() { return this.players.filter((p) => p.alive); }
    world() { return { terrain: this.terrain, tanks: this.players, wind: this.wind, walls: this.opts.walls }; }
    maxPower() { return C.MAX_POWER; } // damage never limits power, so a hurt tank can still hit back

    // ----- rounds -----

    startRound() {
      this.round++;
      const rng = this.rng;
      this.terrain = Terrain.generate(this.w, this.h, rng, this.opts.terrain);
      this.projectiles = []; this.explosions = []; this.flames = []; this.trails = []; this.lastTrail = {};
      const maxWind = WIND_LEVELS[this.opts.wind] != null ? WIND_LEVELS[this.opts.wind] : 50;
      this.maxWind = maxWind;
      this.wind = Math.round(rng.range(-maxWind, maxWind));
      this.sky = rng.int(5);
      // Spread tanks out evenly, with some jitter, in random order.
      const ps = shuffle(this.players.slice(), rng), n = ps.length;
      const margin = 50, slot = (this.w - margin * 2) / n;
      ps.forEach((p, i) => {
        const x = Math.round(margin + slot * (i + 0.5) + rng.range(-0.22, 0.22) * slot);
        let top = this.h;
        for (let dx = -C.TANK_HALF; dx <= C.TANK_HALF; dx++) top = Math.min(top, this.terrain.surface(x + dx));
        top = Math.min(top, this.h - 20);
        this.terrain.flatten(x, top, C.TANK_HALF + 3);
        Object.assign(p, {
          x, y: top, health: C.MAX_HEALTH, alive: true, shield: 0, shieldMax: 0, vy: 0, falling: false, chute: false,
          angle: x < this.w / 2 ? 60 : 120, power: 500, weapon: p.inv[p.weapon] > 0 ? p.weapon : 'baby', ai_: null,
          round: { damage: 0, kills: 0, earned: 0, startCash: p.cash },
        });
      });
      this.terrain.markAll();
      this.order = shuffle(this.players.slice(), rng);
      this.turnIdx = 0; this.turns = 0;
      this.emit('roundStart', { round: this.round });
      this.beginTurn();
    }

    beginTurn() {
      const t = this.current;
      this.phase = 'aim';
      this.turns++;
      t.power = Math.min(t.power, this.maxPower(t));
      if (!(t.inv[t.weapon] > 0)) t.weapon = 'baby';
      if (t.ai && SE.ai) {
        const plan = SE.ai.plan(this, t);
        for (const id of plan.items || []) this.useItem(id);
        t.weapon = plan.weapon;
        t.ai_ = { plan, think: 0.5 + this.rng() * 0.5 };
      }
      this.emit('turn', { player: t });
    }

    endTurn() {
      const alive = this.alive();
      if (alive.length <= 1 || (this.opts.maxTurns && this.turns >= this.opts.maxTurns)) return this.endRound();
      if (this.opts.windChanges && this.maxWind > 0) {
        this.wind = Math.round(clamp(this.wind + this.rng.gauss() * this.maxWind * 0.12, -this.maxWind, this.maxWind));
      }
      do { this.turnIdx = (this.turnIdx + 1) % this.order.length; } while (!this.current.alive);
      this.beginTurn();
    }

    endRound() {
      const E = W.ECONOMY, alive = this.alive();
      const winner = alive.length === 1 ? alive[0] : null;
      for (const p of this.players) {
        const interest = Math.min(Math.max(0, p.cash) * E.interest, E.interestCap);
        let gain = interest + E.allowance;
        if (p.alive) gain += E.survive;
        if (p === winner) { gain += E.roundWin; p.wins++; p.score += W.SCORING.roundWin; }
        p.cash += gain; p.round.earned += gain;
        p.shield = 0;
      }
      const summary = {
        round: this.round, winner: winner ? winner.id : null,
        rows: this.players.map((p) => ({ id: p.id, name: p.name, color: p.color, alive: p.alive, damage: Math.round(p.round.damage),
          kills: p.round.kills, earned: Math.round(p.cash - p.round.startCash), cash: Math.floor(p.cash), score: Math.round(p.score) })),
      };
      this.history.push(summary);
      this.phase = this.round >= this.opts.rounds ? 'gameOver' : 'roundOver';
      this.emit('roundOver', summary);
      if (this.phase === 'gameOver') this.emit('gameOver', { standings: this.standings() });
    }

    standings() {
      return this.players.slice().sort((a, b) => b.score - a.score || b.wins - a.wins || b.kills - a.kills || b.cash - a.cash);
    }

    // ----- shop -----

    buy(p, id) {
      const it = W.get(id);
      if (!it || !isFinite(it.qty) || p.cash < it.price) return false;
      p.cash -= it.price; p.inv[id] += it.qty;
      return true;
    }
    sell(p, id) {
      const it = W.get(id);
      if (!it || !isFinite(it.qty) || !(p.inv[id] > 0)) return false;
      const n = Math.min(p.inv[id], it.qty);
      p.inv[id] -= n; p.cash += Math.floor((it.price * W.ECONOMY.sellBack * n) / it.qty);
      return true;
    }
    aiShop() { if (SE.ai) for (const p of this.players) if (p.ai) SE.ai.shop(this, p); }

    // ----- player actions (only for the current tank while aiming) -----

    canAct() { return this.phase === 'aim' && this.current && this.current.alive; }
    skipTurn() { if (this.canAct()) { this.current.ai_ = null; this.endTurn(); } }

    setAim(angle, power) {
      if (!this.canAct()) return;
      const t = this.current;
      if (angle != null) t.angle = clamp(Math.round(angle * 10) / 10, 0, 180);
      if (power != null) t.power = clamp(Math.round(power), 0, this.maxPower(t));
    }
    adjustAim(da, dp) { const t = this.current; if (t) this.setAim(t.angle + (da || 0), t.power + (dp || 0)); }

    ownedWeapons(t) { return W.WEAPONS.filter((w) => t.inv[w.id] > 0); }
    selectWeapon(id) {
      const t = this.current;
      if (this.canAct() && t.inv[id] > 0 && W.get(id).type === 'weapon') { t.weapon = id; this.emit('select', { id }); }
    }
    cycleWeapon(dir) {
      const t = this.current; if (!this.canAct()) return;
      const list = this.ownedWeapons(t), i = list.findIndex((w) => w.id === t.weapon);
      this.selectWeapon(list[(i + dir + list.length) % list.length].id);
    }

    /** Shields and batteries are free actions. */
    useItem(id) {
      const t = this.current; if (!this.canAct() || !(t.inv[id] > 0)) return false;
      const it = W.get(id);
      if (id === 'shield' || id === 'heavyshield') {
        if (t.shield >= it.strength) return false;
        t.shield = t.shieldMax = it.strength;
      } else if (id === 'battery') {
        if (t.health >= C.MAX_HEALTH) return false;
        t.health = Math.min(C.MAX_HEALTH, t.health + it.heal);
      } else return false;
      t.inv[id]--;
      this.emit('item', { player: t, id });
      return true;
    }

    /** Drives the current tank left (-1) or right (+1) for dt seconds, burning fuel. */
    drive(dir, dt) {
      const t = this.current; if (!this.canAct() || t.falling || !(t.inv.fuel > 0)) return false;
      const step = dir * Math.min(C.DRIVE_SPEED * dt, t.inv.fuel);
      const nx = clamp(t.x + step, C.TANK_HALF, this.w - 1 - C.TANK_HALF);
      if (nx === t.x) return false;
      const ground = this.supportY({ x: nx, y: t.y - C.CLIMB_MAX - 1 });
      const climb = t.y - ground;
      if (climb > C.CLIMB_MAX) return false; // too steep
      t.inv.fuel = Math.max(0, t.inv.fuel - Math.abs(nx - t.x) * (1 + Math.max(0, climb) * 0.6));
      t.x = nx; if (climb > 0) t.y = ground;
      return true;
    }

    fire() {
      if (!this.canAct()) return false;
      const t = this.current;
      let wid = t.weapon;
      if (!(t.inv[wid] > 0)) wid = 'baby';
      if (isFinite(t.inv[wid])) t.inv[wid]--;
      const wpn = W.get(wid);
      const m = muzzle(t, t.angle, t.power);
      this.trails = [];
      const p = this.spawnShell(m.x, m.y, m.vx, m.vy, wpn, t);
      p.armed = false;
      this.lastTrail[t.id] = p.trail;
      this.phase = 'flight'; this.idle = 0;
      this.emit('fire', { player: t, weapon: wpn });
      return true;
    }

    // ----- simulation -----

    spawnShell(x, y, vx, vy, weapon, owner) {
      const trail = { color: owner.color, pts: [x, y] };
      this.trails.push(trail);
      const p = { kind: 'shell', x, y, vx, vy, weapon, owner, armed: true, trail, age: 0, bounces: 0 };
      this.projectiles.push(p);
      return p;
    }

    update(dt) {
      this.acc += Math.min(dt, 0.25);
      let n = 0;
      while (this.acc >= C.DT && n++ < 60) { this.step(C.DT); this.acc -= C.DT; }
    }

    step(dt) {
      this.time += dt;
      if (!this.terrain) return;
      if (this.phase === 'aim') this.stepAi(dt);

      const projs = this.projectiles; this.projectiles = [];
      for (const p of projs) if (this.stepProjectile(p, dt)) this.projectiles.push(p);
      this.stepExplosions(dt);
      this.stepFlames(dt);
      this.terrain.settleStep(C.SETTLE_PASSES);
      const falling = this.stepTanks(dt);

      if (this.phase === 'flight') {
        const busy = this.projectiles.length || this.explosions.length || this.flames.length || this.terrain.anyDirty || falling;
        this.idle = busy ? 0 : this.idle + dt;
        if (this.idle > 0.45) this.endTurn();
      }
    }

    stepAi(dt) {
      const t = this.current, s = t && t.ai_;
      if (!s) return;
      if (s.think > 0) { s.think -= dt; return; }
      const { angle, power } = s.plan;
      const da = angle - t.angle, dp = power - t.power;
      t.angle += clamp(da, -110 * dt, 110 * dt);
      t.power += clamp(dp, -900 * dt, 900 * dt);
      if (Math.abs(da) < 0.01 && Math.abs(dp) < 0.5) {
        t.angle = angle; t.power = Math.min(power, this.maxPower(t));
        s.hold = (s.hold || 0) + dt;
        if (s.hold > 0.25) { t.ai_ = null; this.fire(); }
      }
    }

    stepProjectile(p, dt) {
      p.age += dt;
      if (p.kind === 'shell') {
        const vy0 = p.vy;
        const hit = shellStep(this.world(), p, dt);
        if (!hit) {
          if ((p.trail.pts.length < 1600) && (Math.round(p.age / dt) % 2 === 0)) p.trail.pts.push(p.x, p.y);
          if (p.weapon.kind === 'mirv' && vy0 < 0 && p.vy >= 0) { this.splitMirv(p); return false; }
          return true;
        }
        if (hit.lost) { this.emit('lost', { x: p.x, y: p.y }); return false; }
        p.trail.pts.push(hit.x, hit.y);
        return this.impact(p, hit);
      }
      if (p.kind === 'roller') return this.stepRoller(p, dt);
      if (p.kind === 'digger') return this.stepDigger(p, dt);
      return false;
    }

    splitMirv(p) {
      const w = p.weapon, n = w.warheads;
      const head = { id: w.id + '-head', name: w.name, kind: 'blast', radius: w.radius, damage: w.damage };
      for (let i = 0; i < n; i++) {
        const off = n === 1 ? 0 : ((i / (n - 1)) * 2 - 1) * w.spread;
        this.spawnShell(p.x, p.y, p.vx + off, p.vy, head, p.owner);
      }
      this.emit('split', { x: p.x, y: p.y });
    }

    /** Resolves a shell hitting something. Returns true if the projectile lives on (e.g. as a roller). */
    impact(p, hit) {
      const w = p.weapon, o = p.owner, rng = this.rng;
      switch (w.kind) {
        case 'tracer': this.emit('fizzle', { x: hit.x, y: hit.y }); return false;
        case 'dirt': this.terrain.fill(hit.px, hit.py, w.radius, rng); this.emit('dirt', { x: hit.px, y: hit.py, r: w.radius }); return false;
        case 'funky': {
          this.explode(hit.x, hit.y, w.radius, w.damage, o, w, hit.tank);
          const b = { id: 'funky-b', name: 'Bomblet', kind: 'blast', radius: w.bombletRadius, damage: w.bombletDamage };
          for (let i = 0; i < w.bomblets; i++) {
            const a = rng.range(25, 155) * DEG, v = rng.range(110, 300);
            this.spawnShell(hit.px, hit.py - 2, Math.cos(a) * v, -Math.sin(a) * v, b, o);
          }
          return false;
        }
        case 'leapfrog': {
          this.explode(hit.x, hit.y, w.radius, w.damage, o, w, hit.tank);
          if (p.bounces < w.bounces - 1) {
            const c = this.spawnShell(hit.px, hit.py - 3, p.vx * 0.8, -Math.max(120, Math.abs(p.vy) * 0.55), w, o);
            c.bounces = p.bounces + 1;
          }
          return false;
        }
        case 'roller': {
          if (hit.tank) { this.explode(hit.x, hit.y, w.radius, w.damage, o, w, hit.tank); return false; }
          const x = hit.px, s = (dx) => this.terrain.surface(x + dx, hit.py - 20);
          const l = s(-5), r = s(5);
          p.kind = 'roller'; p.x = x; p.y = s(0) - 3; p.age = 0;
          p.dir = Math.abs(l - r) > 2 ? (r > l ? 1 : -1) : (Math.sign(p.vx) || 1);
          p.speed = 40;
          return true;
        }
        case 'digger': {
          const a = Math.atan2(p.vy, p.vx);
          const heads = w.heads || 1;
          for (let i = 0; i < heads; i++) {
            const da = heads === 1 ? 0 : ((i / (heads - 1)) * 2 - 1) * 0.5;
            this.projectiles.push({ kind: 'digger', x: hit.x, y: hit.y, a: a + da, left: w.dig, weapon: w, owner: o, dist: 0, age: 0 });
          }
          this.emit('dig', { x: hit.x, y: hit.y });
          return false;
        }
        case 'napalm': {
          this.explode(hit.x, hit.y, w.radius, w.damage, o, w, hit.tank);
          for (let i = 0; i < w.flames; i++) {
            this.flames.push({ x: hit.px + rng.range(-4, 4), y: hit.py - 2, vx: rng.range(-70, 70) + p.vx * 0.1, vy: rng.range(-120, -20),
              ground: false, life: rng.range(3, 5.5), weapon: w, owner: o, seed: rng() });
          }
          this.emit('napalm', { x: hit.x, y: hit.y });
          return false;
        }
        default: this.explode(hit.x, hit.y, w.radius, w.damage, o, w, hit.tank); return false;
      }
    }

    stepRoller(p, dt) {
      const T = this.terrain, w = p.weapon;
      const surf = (x) => T.surface(x, p.y - 20);
      const ahead = surf(p.x + p.dir * 3);
      if (ahead < p.y + 3 - 9) return this.rollerBoom(p);         // ran into a wall
      const slope = (surf(p.x + p.dir * 4) - surf(p.x)) / 4;       // + is downhill
      p.speed = clamp(p.speed + slope * 420 * dt - 18 * dt, 0, 260);
      if ((p.speed < 6 && p.age > 0.4) || p.age > 8) return this.rollerBoom(p);
      p.x += p.dir * p.speed * dt;
      if (p.x < 0 || p.x >= T.w) {
        if (this.opts.walls === 'wrap') p.x = (p.x + T.w) % T.w;
        else if (this.opts.walls === 'bounce') { p.dir = -p.dir; p.x = clamp(p.x, 0, T.w - 1); }
        else return false;
      }
      p.y = surf(p.x) - 3;
      if ((Math.round(p.age / dt) % 3) === 0) p.trail.pts.push(p.x, p.y);
      for (const t of this.players) {
        if (!t.alive) continue;
        const d = Math.hypot(p.x - t.x, p.y - (t.y - C.TANK_H / 2));
        if (d < (t.shield > 0 ? C.SHIELD_R : C.TANK_R + 3) && (t !== p.owner || p.age > 0.5)) return this.rollerBoom(p, t);
      }
      return true;
    }
    rollerBoom(p, direct) { this.explode(p.x, p.y, p.weapon.radius, p.weapon.damage, p.owner, p.weapon, direct); return false; }

    stepDigger(p, dt) {
      const w = p.weapon, sp = 110 * dt;
      p.left -= dt;
      p.a += this.rng.gauss() * 0.12;
      p.x += Math.cos(p.a) * sp; p.y += Math.sin(p.a) * sp;
      p.dist += sp;
      if (p.dist >= w.radius * 0.5) { p.dist = 0; this.terrain.carve(p.x, p.y, w.radius); }
      const out = p.x < 0 || p.x >= this.w || p.y >= this.h;
      if (p.left <= 0 || out) {
        if (w.endRadius && !out) this.explode(p.x, p.y, w.endRadius, w.endDamage, p.owner, w);
        return false;
      }
      return true;
    }

    /** `direct` is the tank the warhead struck (body or shield): it takes the full damage. */
    explode(x, y, r, dmg, owner, weapon, direct) {
      const grow = 0.12 + r / 280;
      this.explosions.push({ x, y, r, dmg, owner, weapon, direct: direct || null, t: 0, grow, life: grow + 0.35, applied: false });
      this.emit('launchBoom', { x, y, r });
    }

    stepExplosions(dt) {
      for (const e of this.explosions) {
        e.t += dt;
        if (!e.applied && e.t >= e.grow) {
          e.applied = true;
          if (e.r > 0) this.terrain.carve(e.x, e.y, e.r);
          this.blastDamage(e);
          this.emit('boom', { x: e.x, y: e.y, r: e.r, shake: (e.weapon && e.weapon.shake) || Math.min(10, e.r / 8) });
        }
      }
      this.explosions = this.explosions.filter((e) => e.t < e.life);
    }

    blastDamage(e) {
      if (!e.dmg) return;
      for (const t of this.players) {
        if (!t.alive) continue;
        // A warhead that hits a shield bursts at its edge, so without this a shielded tank
        // would only ever take glancing damage.
        const d = t === e.direct ? 0 : Math.hypot(e.x - t.x, e.y - (t.y - C.TANK_H / 2));
        const reach = e.r + C.TANK_R;
        if (d >= reach) continue;
        const dmg = e.dmg * clamp(1.15 - d / reach, 0, 1);
        this.damage(t, dmg, e.owner);
      }
    }

    /** Applies damage (shield first), pays the attacker and handles kills. */
    damage(t, amount, attacker) {
      if (!t.alive || amount <= 0) return;
      if (t.shield > 0) {
        const absorbed = Math.min(t.shield, amount);
        t.shield -= absorbed; amount -= absorbed;
        this.emit('shieldHit', { player: t, amount: absorbed });
        if (t.shield <= 0.01) { t.shield = 0; this.emit('shieldDown', { player: t }); }
      }
      if (amount <= 0) return;
      amount = Math.min(amount, t.health);
      t.health -= amount;
      const E = W.ECONOMY;
      if (attacker && attacker !== t) {
        attacker.cash += amount * E.perDamage;
        attacker.round.damage += amount; attacker.damageDealt += amount;
        attacker.score += amount * W.SCORING.perDamage;
      } else if (attacker === t) {
        t.cash = Math.max(0, t.cash + amount * E.selfDamage);
      }
      this.emit('hit', { player: t, amount });
      if (t.health <= 0.5) {
        t.health = 0; t.alive = false; t.shield = 0;
        if (attacker && attacker !== t) {
          attacker.kills++; attacker.round.kills++;
          attacker.cash += E.perKill; attacker.score += W.SCORING.perKill;
        }
        this.emit('death', { player: t, by: attacker });
        // The wreck goes up too, and can take neighbours with it.
        this.explosions.push({ x: t.x, y: t.y - 4, r: 26, dmg: 30, owner: attacker || t, weapon: null, t: -0.35, grow: 0.25, life: 0.6, applied: false });
      }
    }

    stepFlames(dt) {
      if (!this.flames.length) return;
      const T = this.terrain;
      for (const f of this.flames) {
        f.life -= dt;
        if (!f.ground) {
          f.vy += C.GRAVITY * dt; f.x += f.vx * dt; f.y += f.vy * dt;
          if (f.x < 0 || f.x >= T.w) { f.life = 0; continue; }
          if (T.solid(f.x, f.y + 1)) { f.ground = true; f.y = T.surface(f.x, f.y - 6) - 1; }
        } else {
          const s = (x) => T.surface(x, f.y - 10);
          const l = s(f.x - 2), r = s(f.x + 2), here = f.y + 1;
          const dir = (l > here + 0.5 || r > here + 0.5) ? (r >= l ? 1 : -1) : 0;
          if (dir) f.x = clamp(f.x + dir * 70 * dt, 0, T.w - 1);
          f.y = s(f.x) - 1;
          if (this.rng() < 0.05) { // scorch the ground
            const i = (Math.floor(f.y) + 1) * T.w + Math.floor(f.x);
            if (T.cells[i]) { T.cells[i] = 60; T.markRegion(f.x, f.y + 1, f.x, f.y + 1); }
          }
        }
        for (const t of this.players) {
          if (t.alive && Math.abs(f.x - t.x) < 13 && Math.abs(f.y - (t.y - 4)) < 14) this.damage(t, f.weapon.burn * dt, f.owner);
        }
      }
      this.flames = this.flames.filter((f) => f.life > 0);
    }

    /** Lowest point a tank at (x, y) would rest on: first solid row at/below y under its tracks. */
    supportY(t) {
      let s = this.h;
      for (let dx = -C.TANK_HALF + 3; dx <= C.TANK_HALF - 3; dx++) s = Math.min(s, this.terrain.surface(t.x + dx, Math.floor(t.y)));
      return s;
    }

    stepTanks(dt) {
      let any = false;
      for (const t of this.players) {
        if (!t.alive) continue;
        const ground = this.supportY(t);
        if (ground > t.y + 0.01) {
          if (!t.falling) { t.falling = true; t.fallFrom = t.y; t.vy = 0; }
          t.vy += C.GRAVITY * dt;
          if (!t.chute && t.y - t.fallFrom > C.CHUTE_AT && t.inv.parachute > 0) {
            t.chute = true; t.inv.parachute--; this.emit('chute', { player: t });
          }
          if (t.chute) t.vy = Math.min(t.vy, C.CHUTE_SPEED);
          t.y = Math.min(ground, t.y + t.vy * dt);
          any = true;
        } else if (t.falling) {
          const dist = t.y - t.fallFrom;
          t.falling = false; t.vy = 0;
          if (!t.chute && dist > C.FALL_SAFE) this.damage(t, (dist - C.FALL_SAFE) * C.FALL_DMG, this.current);
          t.chute = false;
          this.emit('land', { player: t, dist });
        }
      }
      return any;
    }

    /** Simulates a shell shot (no splitting) and returns where it lands. Used by the AI. */
    simulateShot(t, angle, power, wind) {
      const m = muzzle(t, angle, power);
      const p = { x: m.x, y: m.y, vx: m.vx, vy: m.vy, owner: t, armed: false };
      const world = { terrain: this.terrain, tanks: this.players, wind: wind == null ? this.wind : wind, walls: this.opts.walls };
      for (let i = 0; i < 2400; i++) {
        const hit = shellStep(world, p, C.DT);
        if (hit) return hit.lost ? null : hit;
      }
      return null;
    }
  }

  SE.game = { Game, C, WIND_LEVELS, shellStep, muzzle };
  if (typeof module !== 'undefined' && module.exports) module.exports = SE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
