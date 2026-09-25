const test = require('node:test');
const assert = require('node:assert');
const FS = require('./load.js')();
const TM = FS.tournament;

for (const field of [9, 18, 27, 45]) {
  test(`tournament of ${field} runs to completion with a hero auto-playing`, () => {
    const T = TM.create({ field, seed: 1000 + field, speed: 'turbo', difficulty: 'casino' });
    const total = field * T.startStack;
    let rounds = 0;
    while (!T.over && rounds++ < 3000) {
      const hero = TM.hero(T);
      if (!hero.busted) {
        const table = TM.heroTable(T);
        assert.ok(table.seats.includes('hero'), 'hero seated');
        if (table.seats.filter(Boolean).length >= 2) {
          const hand = TM.makeHand(T, table).start();
          while (!hand.done) {
            const s = hand.actor;
            const pl = TM.player(T, hand.players[s].id);
            const d = FS.ai.decide(hand, s, pl.isHero ? { style: 'tag', tilt: 0 } : pl, { fast: true, rng: hand.rng });
            hand.act(s, d.action);
          }
          TM.applyHand(T, table, hand);
        }
      }
      TM.afterRound(T);
      const chips = T.players.reduce((a, p) => a + p.stack, 0);
      assert.strictEqual(chips, total, 'chips conserved');
      for (const t of T.tables) assert.ok(t.seats.filter(Boolean).length <= 9);
      const seated = T.tables.flatMap((t) => t.seats.filter(Boolean));
      assert.strictEqual(seated.length, TM.alive(T).length, 'every live player seated once');
      assert.strictEqual(new Set(seated).size, seated.length);
    }
    assert.ok(T.over, 'finished');
    const places = T.players.map((p) => p.finish).sort((a, b) => a - b);
    assert.deepStrictEqual(places, Array.from({ length: field }, (_, i) => i + 1));
    const paid = T.players.reduce((a, p) => a + (p.prize || 0), 0);
    assert.ok(Math.abs(paid - field * T.buyIn) <= T.payouts.length, 'prize pool paid out');
    console.log(`  field ${field}: ${rounds} rounds, final level ${T.level + 1}, hero finished ${TM.hero(T).finish}`);
  });
}
