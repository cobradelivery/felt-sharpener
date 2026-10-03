const test = require('node:test');
const assert = require('node:assert');
const FS = require('./load.js')();
require('../js/game/drills.js');
const C = FS.cards, D = FS.drills;
const N = 400;

test('pot-odds formula: call / (pot + bet + call)', () => {
  assert.strictEqual(D.potOddsNeeded(600, 200), 0.2); // the Learn lesson's worked example
  assert.strictEqual(D.potOddsNeeded(100, 100), 1 / 3);
  assert.strictEqual(D.potOddsNeeded(300, 150), 0.25);
  assert.strictEqual(D.potOddsNeeded(1000, 2000), 0.4);
});

test('bet-size shortcuts', () => {
  const want = { '⅓ pot': 20, '½ pot': 25, '⅔ pot': 28.6, '¾ pot': 30, pot: 33.3, '2× pot': 40 };
  for (const b of D.BET_SIZES) assert.strictEqual(Math.round(D.betSizeNeeded(b.f) * 1000) / 10, want[b.label], b.label);
  assert.strictEqual(D.fmtPct(D.betSizeNeeded(2 / 3)), '28.6%');
  assert.strictEqual(D.fmtPct(D.betSizeNeeded(1 / 2)), '25%');
  const rng = FS.util.makeRng(7);
  for (let i = 0; i < N; i++) {
    const q = D.genBetSize(rng);
    assert.ok(Math.abs(q.truth - D.betSizeNeeded(q.fraction)) < 1e-12);
  }
});

/** Independent recount: unseen cards that give hero a straight or flush (hero holds no pair in these spots). */
function bruteOuts(hero, board) {
  const seen = new Set(hero.concat(board));
  const out = [];
  for (let c = 0; c < 52; c++) {
    if (seen.has(c)) continue;
    const cards = hero.concat(board, [c]);
    const suits = [0, 0, 0, 0];
    const ranks = new Set();
    for (const x of cards) { suits[x & 3]++; ranks.add((x >> 2) + 2); if ((x >> 2) + 2 === 14) ranks.add(1); }
    let straight = false;
    for (let lo = 1; lo <= 10; lo++) if ([0, 1, 2, 3, 4].every((k) => ranks.has(lo + k))) straight = true;
    if (straight || Math.max(...suits) >= 5) out.push(c);
  }
  return out;
}
const noDupes = (cards) => new Set(cards).size === cards.length && cards.every((c) => c >= 0 && c < 52);

test('count-the-outs spots: stated outs match a brute-force recount and the engine', () => {
  const rng = FS.util.makeRng(12345);
  const kinds = {};
  for (let i = 0; i < N; i++) {
    const q = D.genOuts(rng);
    const all = q.hero.concat(q.board);
    assert.ok(noDupes(all), 'duplicate card');
    assert.ok(q.board.length === 3 || q.board.length === 4);
    // clean spot: no pair anywhere, board has at most two of a suit
    assert.strictEqual(C.evaluate(all) >> 20, 0, 'hero should hold no pair');
    const sc = [0, 0, 0, 0]; q.board.forEach((c) => sc[c & 3]++);
    assert.ok(Math.max(...sc) <= 2, 'board flush draw makes outs murky');
    const brute = bruteOuts(q.hero, q.board).sort((a, b) => a - b);
    assert.deepStrictEqual(q.info.outCards.slice().sort((a, b) => a - b), brute);
    assert.strictEqual(q.truth, brute.length);
    assert.strictEqual(C.analyzeHand(q.hero, q.board).outs, brute.length, 'engine agrees');
    assert.ok(noDupes(all.concat(q.info.outCards)), 'an out card is already dealt');
    assert.strictEqual(q.info.unseen, 52 - all.length);
    // on the turn, no river card makes a straight on the board alone
    if (q.board.length === 4) for (let c = 0; c < 52; c++) if (!all.includes(c)) assert.notStrictEqual(C.evaluate(q.board.concat([c])) >> 20, 4);
    assert.ok([4, 8, 9, 12, 15].includes(q.truth), 'unexpected out count ' + q.truth);
    kinds[q.info.kind] = (kinds[q.info.kind] || 0) + 1;
    assert.strictEqual(q.options.filter((o) => o.correct).length, 1);
    assert.strictEqual(new Set(q.options.map((o) => o.value)).size, 4);
  }
  for (const k of ['flush', 'oesd', 'gutshot', 'combo']) assert.ok(kinds[k] > 10, 'too few ' + k + ' spots');
});

test('call/fold answers follow outs/unseen vs. pot odds, with a safety margin', () => {
  const rng = FS.util.makeRng(999);
  const tally = { call: 0, fold: 0 };
  for (let i = 0; i < N; i++) {
    const q = D.genCallFold(rng);
    const all = q.hero.concat(q.board);
    assert.ok(noDupes(all));
    const outs = bruteOuts(q.hero, q.board).length;
    const hit = outs / (52 - all.length);
    const need = q.bet / (q.pot + 2 * q.bet);
    assert.ok(Math.abs(hit - q.hit) < 1e-12 && Math.abs(need - q.need) < 1e-12);
    assert.ok(Math.abs(hit - need) >= D.MARGIN, 'razor-close spot');
    assert.strictEqual(q.answer, hit > need ? 'call' : 'fold');
    assert.ok(D.isCorrect(q, q.answer) && !D.isCorrect(q, q.answer === 'call' ? 'fold' : 'call') && !D.isCorrect(q, null));
    assert.ok(q.pot > 0 && q.bet > 0);
    tally[q.answer]++;
  }
  assert.ok(tally.call > N * 0.3 && tally.fold > N * 0.3, 'answers should be balanced: ' + JSON.stringify(tally));
});

test('multiple-choice questions always have exactly one correct option', () => {
  const rng = FS.util.makeRng(42);
  for (const type of ['potodds', 'betsize', 'outs', 'mixed']) {
    for (let i = 0; i < (type === 'mixed' ? 150 : N); i++) {
      const q = D.generate(type, rng);
      if (q.kind === 'callfold') continue;
      const n = q.type === 'equity' ? 3 : 4;
      assert.strictEqual(q.options.length, n);
      assert.strictEqual(q.options.filter((o) => o.correct).length, 1, type + ' ' + q.prompt);
      assert.strictEqual(new Set(q.options.map((o) => o.label)).size, n, 'duplicate labels');
      const right = q.options.findIndex((o) => o.correct);
      assert.ok(D.isCorrect(q, right));
      if (q.type !== 'outs') {
        // the correct option sits within tolerance of the exact answer; every other one is clearly off
        for (const o of q.options) assert.strictEqual(Math.abs(o.value - q.truth) <= D.TOL, o.correct);
        for (const o of q.options) if (!o.correct) assert.ok(Math.abs(o.value - q.truth) >= D.GAP - 1e-9);
      }
      if (q.type === 'potodds') assert.ok(Math.abs(q.truth - D.potOddsNeeded(q.pot, q.bet)) < 1e-12);
    }
  }
});

test('stats recording', () => {
  const d = {};
  D.record(d, 'outs', true, 2000); D.record(d, 'outs', true, 4000); D.record(d, 'outs', false, 3000); D.record(d, 'outs', true, 1000);
  assert.deepStrictEqual(d.outs, { attempts: 4, correct: 3, streak: 1, bestStreak: 2, timeMs: 10000, last: [1, 1, 0, 1] });
  assert.strictEqual(D.accuracy(d.outs), 0.75);
  assert.strictEqual(D.avgSec(d.outs), 2.5);
  for (let i = 0; i < 30; i++) D.record(d, 'outs', i % 2 === 0, 1000);
  assert.strictEqual(d.outs.last.length, 20);
});

/** Independent exact enumeration of hero equity vs a known hand (flop or turn). */
function enumEquity(hero, opp, board) {
  const dead = new Set(hero.concat(opp, board));
  const live = [];
  for (let c = 0; c < 52; c++) if (!dead.has(c)) live.push(c);
  let w = 0, n = 0;
  const run = (extra) => { const b = board.concat(extra); const h = C.evaluate(hero.concat(b)), o = C.evaluate(opp.concat(b)); w += h > o ? 1 : h === o ? 0.5 : 0; n++; };
  if (board.length === 4) live.forEach((c) => run([c]));
  else for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) run([live[i], live[j]]);
  return w / n;
}

test('equity: preflop reference matchups within 2%', () => {
  const P = C.parseCards, rng = FS.util.makeRng(2024);
  const ref = [['As Ad', 'Ks Kd', 0.82], ['Ah Kd', 'Qs Qc', 0.43], ['As Ks', '2h 2d', 0.50], ['7s 2d', 'Ah Ad', 0.12]];
  for (const [h, o, want] of ref) {
    const eq = D.equityVsHand(P(h), P(o), [], rng);
    assert.ok(Math.abs(eq - want) <= 0.02, `${h} vs ${o}: ${eq}`);
  }
  // matchup categories / rules of thumb
  assert.strictEqual(D.preflopMatchup(P('9s 9d'), P('Ah Kd')).key, 'pairovers');
  assert.strictEqual(D.preflopMatchup(P('Ah Qd'), P('As Kc')).key, 'dominated');
  assert.strictEqual(D.preflopMatchup(P('Ah Qd'), P('As Kc')).side, 'dog');
  assert.strictEqual(D.preflopMatchup(P('5s 5d'), P('Jh Jd')).side, 'dog');
});

test('equity drill: reported equity is right, three well-separated options, one correct', () => {
  const rng = FS.util.makeRng(77);
  const streets = {};
  for (let i = 0; i < 150; i++) {
    const q = D.genEquity(rng);
    const all = q.hero.concat(q.opp || [], q.board);
    assert.ok(noDupes(all), 'duplicate card');
    const key = q.range ? 'range' : q.board.length === 0 ? 'preflop' : q.board.length === 3 ? 'flop' : 'turn';
    streets[key] = (streets[key] || 0) + 1;
    if (q.board.length) assert.ok(Math.abs(q.exact - enumEquity(q.hero, q.opp, q.board)) < 1e-12, 'postflop equity must be exact');
    else if (q.opp && i % 10 === 0) assert.ok(Math.abs(q.exact - D.equityVsHand(q.hero, q.opp, [], FS.util.makeRng(i + 1))) < 0.015, 'preflop MC unstable');
    else if (q.range && i % 5 === 0) assert.ok(Math.abs(q.exact - D.equityVsRange(q.hero, q.range.p, FS.util.makeRng(i + 1))) < 0.015, 'range MC unstable');
    assert.strictEqual(q.options.length, 3);
    assert.strictEqual(q.options.filter((o) => o.correct).length, 1);
    const right = q.options.find((o) => o.correct);
    assert.strictEqual(Math.round(right.value * 100), Math.round(q.exact * 100));
    const v = q.options.map((o) => Math.round(o.value * 100));
    for (let a = 0; a < 3; a++) {
      assert.ok(v[a] >= 1 && v[a] <= 99);
      for (let b = a + 1; b < 3; b++) assert.ok(Math.abs(v[a] - v[b]) >= 12, 'options too close: ' + v);
    }
    for (const o of q.options) if (!o.correct) assert.ok(o.why && o.why.length > 10, 'every wrong option explains its misconception');
    assert.ok(q.explain.some((l) => /\[\[equity\]\]/.test(l)));
    if (q.board.length) assert.ok(q.explain.some((l) => /rule of 2 and 4/.test(l)) && q.explain.some((l) => /\[\[outs\]\]/.test(l)));
  }
  for (const k of ['range', 'preflop', 'flop', 'turn']) assert.ok(streets[k] > 5, 'too few ' + k);
});
