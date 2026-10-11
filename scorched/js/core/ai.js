/* Scorched — computer opponents.
   An AI aims by simulating real shots through the game's own physics (a sweep of elevations with a
   power bisection at each), then spoils the answer with skill-dependent noise. Weaker AIs only
   partly account for the wind, and every AI tightens up with repeated shots at the same target. */
(function (root) {
  'use strict';
  const SE = root.SE || (root.SE = {});
  const { clamp } = SE.util;
  const W = SE.weapons;

  const LEVELS = {
    moron:     { label: 'Moron',     angleNoise: 12,  powerNoise: 0.16,  wind: 0,   learn: 0.1,  smart: 0 },
    shooter:   { label: 'Shooter',   angleNoise: 4,   powerNoise: 0.07,  wind: 0.2, learn: 0.25, smart: 0.5 },
    poolshark: { label: 'Poolshark', angleNoise: 1.8, powerNoise: 0.035, wind: 0.7, learn: 0.3,  smart: 0.8 },
    sniper:    { label: 'Sniper',    angleNoise: 0.6, powerNoise: 0.012, wind: 1,   learn: 0.3,  smart: 1 },
  };
  const ATTACK = ['deathshead', 'nuke', 'babynuke', 'mirv', 'funky', 'heavyroller', 'napalm', 'leapfrog', 'roller', 'missile', 'sandhog', 'baby'];

  function level(t) { return LEVELS[t.ai] || LEVELS.shooter; }

  function chooseTarget(game, t, L) {
    const foes = game.alive().filter((p) => p !== t);
    const mem = t.aiMem;
    if (mem) {
      const prev = foes.find((p) => p.id === mem.target);
      if (prev && game.rng() < 0.75) return prev;
    }
    if (L.smart === 0) return game.rng.pick(foes);
    let best = null, bs = Infinity;
    for (const p of foes) {
      const s = Math.abs(p.x - t.x) + p.health * 3 + (p.shield || 0) * 2 + game.rng() * 150;
      if (s < bs) { bs = s; best = p; }
    }
    return best;
  }

  function isBuried(game, t) {
    let n = 0;
    for (let dy = 6; dy <= 22; dy += 2) for (let dx = -8; dx <= 8; dx += 2) if (game.terrain.solid(t.x + dx, t.y - dy)) n++;
    return n > 12;
  }

  function chooseWeapon(game, t, target, L) {
    const owned = game.ownedWeapons(t);
    if (L.smart === 0) return game.rng.pick(owned).id;
    const dist = Math.hypot(target.x - t.x, target.y - t.y);
    const ok = ATTACK.filter((id) => {
      if (!(t.inv[id] > 0)) return false;
      const w = W.get(id), reach = (w.kind === 'mirv' ? w.radius + w.spread * 0.9 : w.radius) + 30;
      return id === 'baby' || dist > reach;
    });
    // Don't waste a nuke on a nearly dead tank.
    const pick = ok.find((id) => {
      const w = W.get(id);
      return !(target.health + target.shield < 35 && w.damage > 60 && game.rng() < L.smart) || id === 'baby';
    });
    return (game.rng() < 0.85 ? pick : ok[ok.length - 1]) || 'baby';
  }

  /** Finds angle/power that land a shell nearest the target, given the wind the AI believes in. */
  function solve(game, t, target, wind, selfRadius) {
    const tx = target.x, ty = target.y - 4;
    const d = tx >= t.x ? 1 : -1;
    const maxP = game.maxPower(t);
    let best = { angle: d > 0 ? 60 : 120, power: maxP * 0.6, miss: Infinity };
    const evalShot = (angle, power) => {
      const hit = game.simulateShot(t, angle, power, wind);
      if (!hit) return { err: Infinity, miss: Infinity };
      let miss = hit.tank === target ? 0 : Math.hypot(hit.x - tx, hit.y - ty);
      if (Math.hypot(hit.x - t.x, hit.y - t.y) < selfRadius + 14) miss += 2000;
      return { err: (hit.x - tx) * d, miss };
    };
    for (let e = 18; e <= 82; e += 4) {
      const angle = d > 0 ? e : 180 - e;
      let lo = 60, hi = maxP, r;
      r = evalShot(angle, hi);
      if (r.err < 0) { if (r.miss < best.miss) best = { angle, power: hi, miss: r.miss }; continue; }
      for (let i = 0; i < 13; i++) {
        const mid = (lo + hi) / 2;
        r = evalShot(angle, mid);
        if (r.miss < best.miss) best = { angle, power: mid, miss: r.miss };
        if (r.miss === 0) break;
        if (r.err > 0) hi = mid; else lo = mid;
      }
      if (best.miss === 0) break;
    }
    return best;
  }

  /** Decides this turn: uses free items immediately, returns {weapon, angle, power}. */
  function plan(game, t) {
    const L = level(t), rng = game.rng;
    if (L.smart > 0) {
      if (!t.shield) { if (t.inv.heavyshield > 0) game.useItem('heavyshield'); else if (t.inv.shield > 0) game.useItem('shield'); }
      while (t.health < 60 && t.inv.battery > 0 && game.useItem('battery'));
    }
    if (L.smart > 0 && isBuried(game, t)) {
      if (t.inv.riot > 0) return { weapon: 'riot', angle: 90, power: 120 };
    }
    const target = chooseTarget(game, t, L);
    const mem = t.aiMem && t.aiMem.target === target.id ? t.aiMem : { target: target.id, shots: 0 };
    t.aiMem = mem;
    const weapon = chooseWeapon(game, t, target, L);
    const w = W.get(weapon);
    const windKnow = clamp(L.wind + L.learn * mem.shots, 0, 1);
    const sol = solve(game, t, target, game.wind * windKnow, w.kind === 'mirv' ? 0 : w.radius);
    const decay = Math.max(0.3, 1 - 0.18 * mem.shots);
    mem.shots++;
    const angle = clamp(sol.angle + rng.gauss() * L.angleNoise * decay, 0, 180);
    const power = clamp(sol.power * (1 + rng.gauss() * L.powerNoise * decay), 30, game.maxPower(t));
    return { weapon, angle: Math.round(angle * 10) / 10, power: Math.round(power) };
  }

  /** Between rounds: spends money on a level-appropriate shopping list. */
  function shop(game, p) {
    const L = level(p), rng = game.rng;
    const wish = L.smart === 0
      ? W.WEAPONS.concat(W.ITEMS).filter((x) => isFinite(x.qty)).map((x) => [x.id, 1])
      : [['parachute', p.inv.parachute < 2 ? 5 : 0], ['shield', 3 * L.smart], ['heavyshield', 2 * L.smart], ['battery', 2 * L.smart],
        ['missile', 4], ['babynuke', 4], ['nuke', 2.5], ['mirv', 3], ['deathshead', 2], ['funky', 2], ['roller', 1.5],
        ['heavyroller', 1.5], ['napalm', 2], ['leapfrog', 1.5], ['riot', p.inv.riot > 0 ? 0 : 1.2 * L.smart]];
    for (let n = 0; n < 10; n++) {
      const can = wish.filter(([id, wt]) => wt > 0 && W.get(id).price <= p.cash);
      if (!can.length) break;
      let r = rng() * can.reduce((s, [, wt]) => s + wt, 0), pick = can[0][0];
      for (const [id, wt] of can) { r -= wt; if (r <= 0) { pick = id; break; } }
      game.buy(p, pick);
    }
  }

  SE.ai = { LEVELS, plan, shop, solve };
  if (typeof module !== 'undefined' && module.exports) module.exports = SE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
