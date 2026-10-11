const test = require('node:test');
const assert = require('node:assert');
const SE = require('./load.js')();
const { Terrain } = SE.terrain;
const { Game, C } = SE.game;
const { makeRng } = SE.util;

const flat = (w, h, ground) => { const t = new Terrain(w, h); for (let x = 0; x < w; x++) for (let y = ground; y < h; y++) t.cells[y * w + x] = 5; return t; };

/** A two-tank game on flat ground, ready for the first player to act. */
function duel(opts) {
  const g = new Game(Object.assign({ seed: 7, wind: 'none', players: [{ name: 'A' }, { name: 'B' }] }, opts));
  g.startRound();
  g.terrain = flat(g.w, g.h, 600);
  const [a, b] = g.players;
  a.x = 200; b.x = 1000; a.y = b.y = 600;
  g.order = [a, b]; g.turnIdx = 0; g.phase = 'aim';
  return g;
}
function runUntilIdle(g, max = 20000) { for (let i = 0; i < max && g.phase === 'flight'; i++) g.step(C.DT); }

test('terrain generation: every style stays in bounds and is deterministic', () => {
  for (const style of SE.terrain.STYLES) {
    const a = Terrain.generate(400, 300, makeRng(5), style), b = Terrain.generate(400, 300, makeRng(5), style);
    assert.deepStrictEqual(a.cells, b.cells, style + ' not deterministic');
    for (let x = 0; x < 400; x += 7) {
      const s = a.surface(x);
      assert.ok(s >= 300 * 0.18 - 1 && s <= 300 * 0.94 + 1, `${style} surface ${s} out of range`);
      assert.ok(a.solid(x, 299), 'bottom row must be solid');
    }
  }
});

test('carve removes a circle; unsupported dirt falls and settles', () => {
  const t = flat(100, 100, 50);
  t.anyDirty = false;
  const n = t.carve(50, 70, 10);
  assert.ok(n > 250 && n < 400, 'carved ' + n);
  assert.ok(!t.solid(50, 70));
  t.settleAll();
  // The column over the cave dropped; total dirt is conserved.
  assert.strictEqual(t.surface(50), 50 + 21);
  assert.strictEqual(t.surface(0), 50);
  const total = t.cells.reduce((s, c) => s + (c ? 1 : 0), 0);
  assert.strictEqual(total, 100 * 50 - n);
});

test('fill adds dirt only into air', () => {
  const t = flat(100, 100, 50);
  const n = t.fill(50, 50, 10);
  assert.ok(n > 100 && n < 320, 'filled ' + n);
  assert.ok(t.solid(50, 42));
});

test('ballistics: 45° at full power on flat ground lands near v²/g', () => {
  const g = duel();
  const t = g.players[0];
  const hit = g.simulateShot(t, 45, 1000, 0);
  // No terrain in range → the shell leaves the field; use more ground to measure.
  const g2 = duel(); g2.players[1].x = 1270;
  const short = g2.simulateShot(g2.players[0], 45, 500, 0);
  const range = (C.VMAX * 0.5) ** 2 / C.GRAVITY;
  assert.ok(Math.abs(short.x - 200 - range) < 25, `range ${short.x - 200} vs ${range}`);
  assert.ok(hit === null || hit.x > 1000);
});

test('wind pushes shells downwind', () => {
  const g = duel();
  const still = g.simulateShot(g.players[0], 60, 500, 0);
  const tail = g.simulateShot(g.players[0], 60, 500, 50);
  const head = g.simulateShot(g.players[0], 60, 500, -50);
  assert.ok(tail.x > still.x + 20 && head.x < still.x - 20);
});

test('a direct hit damages, pays the shooter and a kill scores', () => {
  const g = duel();
  const [a, b] = g.players;
  const cash0 = a.cash;
  const s = SE.ai.solve(g, a, b, 0, 0);
  assert.strictEqual(s.miss, 0, 'solver should find a direct hit on flat ground');
  a.weapon = 'baby';
  g.setAim(s.angle, s.power); g.fire();
  runUntilIdle(g);
  assert.ok(b.health < 100 && b.health > 50, 'health ' + b.health);
  assert.ok(a.cash > cash0);
  g.damage(b, 1000, a);
  assert.strictEqual(b.alive, false);
  assert.strictEqual(a.kills, 1);
});

test('shields absorb damage before health', () => {
  const g = duel();
  const b = g.players[1];
  b.shield = b.shieldMax = 50;
  g.damage(b, 30, g.players[0]);
  assert.strictEqual(b.health, 100); assert.strictEqual(b.shield, 20);
  g.damage(b, 30, g.players[0]);
  assert.strictEqual(b.shield, 0); assert.strictEqual(b.health, 90);
});

test('falling: damage without a parachute, none with one', () => {
  for (const chute of [0, 1]) {
    const g = duel();
    const a = g.players[0];
    a.inv.parachute = chute;
    g.terrain.carve(a.x, 640, 50); // dig the ground out from under A
    g.phase = 'flight'; g.idle = 0;
    runUntilIdle(g);
    assert.ok(a.y > 640, 'A should have fallen');
    if (chute) { assert.strictEqual(a.health, 100); assert.strictEqual(a.inv.parachute, 0); }
    else assert.ok(a.health < 100);
  }
});

test('max power drops as health drops', () => {
  const g = duel();
  const a = g.players[0];
  assert.strictEqual(g.maxPower(a), 1000);
  g.damage(a, 50, g.players[1]);
  assert.strictEqual(g.maxPower(a), 650);
  g.setAim(null, 1000);
  assert.strictEqual(a.power, 650);
});

test('shop: buy charges per bundle, sell refunds half, no credit', () => {
  const g = duel({ startCash: 5000 });
  const a = g.players[0];
  assert.ok(g.buy(a, 'missile'));
  assert.strictEqual(a.inv.missile, 5); assert.strictEqual(a.cash, 3500);
  assert.ok(!g.buy(a, 'nuke'));
  assert.ok(g.sell(a, 'missile'));
  assert.strictEqual(a.inv.missile, 0); assert.strictEqual(a.cash, 4250);
  assert.ok(!g.buy(a, 'baby'), 'baby missiles are free and unlimited, not for sale');
});

test('MIRV splits into its warheads at the apex', () => {
  const g = duel();
  const a = g.players[0];
  a.inv.mirv = 1; g.selectWeapon('mirv');
  let splits = 0, booms = 0;
  g.on((t) => { if (t === 'split') splits++; if (t === 'boom') booms++; });
  g.setAim(60, 600); g.fire();
  runUntilIdle(g);
  assert.strictEqual(splits, 1);
  assert.ok(booms >= SE.weapons.get('mirv').warheads, 'booms ' + booms);
  assert.strictEqual(a.inv.mirv, 0);
});

test('dirt weapons add ground, riot bombs remove it harmlessly', () => {
  const g = duel();
  const [a, b] = g.players;
  const count = () => g.terrain.cells.reduce((s, c) => s + (c ? 1 : 0), 0);
  const s = SE.ai.solve(g, a, b, 0, 0);
  a.inv.dirtball = 1; g.selectWeapon('dirtball'); g.setAim(s.angle, s.power);
  const c0 = count(); g.fire(); runUntilIdle(g);
  assert.ok(count() > c0 + 1000);
  assert.strictEqual(b.health, 100);
  g.turnIdx = 0; g.phase = 'aim';
  a.inv.riot = 1; g.selectWeapon('riot'); g.setAim(s.angle, s.power);
  const c1 = count(); g.fire(); runUntilIdle(g);
  assert.ok(count() < c1 - 1000);
  assert.strictEqual(b.health, 100);
});

test('round end pays bonuses and the game ends after the last round', () => {
  const g = new Game({ seed: 3, rounds: 1, startCash: 0, wind: 'none', players: [{ name: 'A' }, { name: 'B' }] });
  g.startRound();
  const [a, b] = g.players;
  g.damage(b, 1000, a);
  g.endTurn();
  assert.strictEqual(g.phase, 'gameOver');
  const E = SE.weapons.ECONOMY;
  assert.strictEqual(a.wins, 1);
  const earned = 100 * E.perDamage + E.perKill; // paid during the round, so it earns interest
  assert.strictEqual(Math.round(a.cash), Math.round(earned + Math.min(earned * E.interest, E.interestCap) + E.allowance + E.survive + E.roundWin));
  assert.strictEqual(g.standings()[0], a);
});

test('a full all-CPU game plays to the end, deterministically', () => {
  const play = (seed) => {
    const g = new Game({ seed, rounds: 2, players: ['moron', 'shooter', 'poolshark', 'sniper'].map((ai) => ({ name: ai, ai })) });
    g.startRound();
    for (let i = 0; i < 1e6 && g.phase !== 'gameOver'; i++) {
      if (g.phase === 'roundOver') { g.aiShop(); g.startRound(); }
      g.step(C.DT);
    }
    return g;
  };
  const a = play(11), b = play(11);
  assert.strictEqual(a.phase, 'gameOver');
  assert.strictEqual(a.history.length, 2);
  assert.deepStrictEqual(a.history, b.history);
});
