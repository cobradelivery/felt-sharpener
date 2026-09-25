const test = require('node:test');
const assert = require('node:assert');
const FS = require('./load.js')('engine');
const C = FS.cards;
const { Hand } = FS.engine;

function seats(stacks) { return stacks.map((s, i) => (s == null ? null : { id: 'p' + i, name: 'P' + i, stack: s })); }

test('evaluator ranks categories correctly', () => {
  const e = (s) => C.evaluate(C.parseCards(s));
  assert.ok(e('As Ks Qs Js Ts 2d 3c') > e('9s 9h 9d 9c 2s 3d 4c'));
  assert.ok(e('9s 9h 9d 9c 2s 3d 4c') > e('Ah Ad Ac Kd Ks 2c 3d'));
  assert.ok(e('Ah Ad Ac Kd Ks 2c 3d') > e('2h 5h 7h 9h Jh Ac Kd'));
  assert.ok(e('2h 5h 7h 9h Jh Ac Kd') > e('Ts 9h 8d 7c 6s 2d 2c'));
  assert.strictEqual(C.describeScore(e('Ah 2d 3c 4s 5h 9d Kc')), 'Straight, Five high');
  assert.ok(e('Ah Ad Kc Kd 2s 2c 7h') > e('Ah Ad Kc Kd 2s 2c 6h'));
  assert.strictEqual(e('Ah Ad Kc Kd Qs Qc 2h') >> 20, 2);
  assert.ok(e('Ah Ad 5c 5d 9s 9c Kh') > e('Ah Ad 9c 9d 5s 5c 2h')); // kicker K beats 5
  assert.strictEqual(C.describeScore(e('Kh Kd Kc 7d 7s 7c 2h')), 'Full House, Kings full of Sevens');
});

test('side pots: short all-in wins only what they can cover', () => {
  // seat0 short 100, seat1 1000, seat2 1000
  const h = new Hand({ seats: seats([100, 1000, 1000]), button: 0, sb: 10, bb: 20, rng: FS.util.makeRng(1) }).start();
  // rig cards: seat0 best, seat1 second, seat2 worst
  const P = h.players;
  P[0].cards = C.parseCards('As Ah'); P[1].cards = C.parseCards('Ks Kh'); P[2].cards = C.parseCards('7c 2d');
  const board = C.parseCards('3d 8c 9h Jd 4s');
  const used = [...P[0].cards, ...P[1].cards, ...P[2].cards, ...board];
  const rest = C.newDeck().filter((c) => !used.includes(c));
  // pop order: burn, flop x3, burn, turn, burn, river
  h.deck = rest.slice(3).concat([board[4], rest[2], board[3], rest[1], board[2], board[1], board[0], rest[0]]);
  // preflop: BTN (seat0) acts first 3-handed
  assert.strictEqual(h.actor, 0);
  h.act(0, { type: 'raise', to: 100 }); // all-in
  h.act(1, { type: 'raise', to: 500 });
  h.act(2, { type: 'call' });
  // flop: seat1 bets, seat2 folds
  h.act(1, { type: 'raise', to: 200 });
  h.act(2, { type: 'fold' });
  // seat1 uncontested side pot; runout to showdown for main
  assert.ok(h.done);
  const total = P.reduce((a, p) => a + p.stack, 0);
  assert.strictEqual(total, 2100);
  assert.strictEqual(P[0].stack, 300); // wins main pot 3x100
});

test('fuzz: chips conserved, every hand terminates, actions always legal', () => {
  const rng = FS.util.makeRng(42);
  for (let n = 0; n < 3000; n++) {
    const size = 2 + rng.int(8);
    const stacks = [];
    for (let i = 0; i < 9; i++) stacks.push(i < size ? (rng.chance(0.2) ? 1 + rng.int(300) : 200 + rng.int(5000)) : null);
    FS.util.shuffleInPlace(stacks, rng);
    const total = stacks.reduce((a, b) => a + (b || 0), 0);
    let btn = 0; while (!stacks[btn]) btn++;
    const ante = rng.chance(0.5) ? 100 : 0;
    const h = new Hand({ seats: seats(stacks), button: btn, sb: 50, bb: 100, ante, rng }).start();
    let guard = 0;
    while (!h.done) {
      const L = h.legal(h.actor);
      assert.ok(L, 'legal exists for actor ' + h.actor);
      const r = rng();
      let a;
      if (r < 0.2) a = { type: 'fold' };
      else if (r < 0.6) a = { type: L.canCheck ? 'check' : 'call' };
      else a = { type: 'raise', to: L.minRaiseTo + rng.int(Math.max(1, L.maxRaiseTo - L.minRaiseTo + 1)) };
      h.act(h.actor, a);
      assert.ok(++guard < 500, 'hand did not terminate');
    }
    const after = h.players.reduce((a, p) => a + (p ? p.stack : 0), 0);
    assert.strictEqual(after, total, 'chips conserved in hand ' + n);
    for (const p of h.players) if (p) assert.ok(p.stack >= 0);
    assert.strictEqual(h.board.length === 5 || h.results.uncontested, true);
  }
});
