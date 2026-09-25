const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const FS = require('./load.js')();
require('../js/game/coach.js');
require('../js/game/coach-prompt.js');
require('../js/game/llm.js');
const C = FS.cards;

/** Build a hand where seat 0 (hero) has given cards; others fold/act via script. */
function setup(n, heroCards, opts = {}) {
  const seats = Array.from({ length: 9 }, (_, i) => (i < n ? { id: 'p' + i, name: 'P' + i, stack: opts.stack || 20000 } : null));
  const h = new FS.engine.Hand({ seats, button: opts.button != null ? opts.button : n - 1, sb: 100, bb: 200, ante: 200, rng: FS.util.makeRng(5) }).start();
  const hc = C.parseCards(heroCards);
  // swap hero's cards in (remove from other hands/deck)
  for (const p of h.players) if (p) p.cards = p.cards.filter((c) => !hc.includes(c));
  h.deck = h.deck.filter((c) => !hc.includes(c));
  h.players[0].cards = hc;
  for (const p of h.players) if (p && p.cards.length < 2) while (p.cards.length < 2) p.cards.push(h.deck.pop());
  return h;
}
const rec = (h, seat = 0) => FS.strategy.analyze(h, seat, { iterations: 3000, rng: FS.util.makeRng(9) });

test('preflop: premium hands raise, junk folds from early position', () => {
  let h = setup(9, 'As Ad', { button: 6 }); // hero seat 0 = UTG+? — let others fold to hero
  while (h.actor !== 0) h.act(h.actor, { type: 'fold' });
  assert.strictEqual(rec(h).rec.type, 'raise');
  h = setup(9, '7c 2d', { button: 6 });
  while (h.actor !== 0) h.act(h.actor, { type: 'fold' });
  assert.strictEqual(rec(h).rec.type, 'fold');
});

test('preflop: short stack shoves or folds (no small raises)', () => {
  const h = setup(6, 'Ah 9c', { button: 1, stack: 1600 }); // 8 BB
  while (h.actor !== 0) h.act(h.actor, { type: 'fold' });
  const A = rec(h);
  assert.strictEqual(A.rec.type, 'raise');
  assert.ok(A.rec.allIn, 'should be all-in');
});

test('facing an all-in: AA calls, weak hand folds', () => {
  for (const [cards, want] of [['Ks Kd', 'call'], ['8c 3d', 'fold']]) {
    const h = setup(3, cards, { button: 2 });
    // button (seat 2) shoves, SB (seat 0 is SB? order: BTN=2, SB=0, BB=1)
    h.act(2, { type: 'raise', to: 20000 });
    assert.strictEqual(h.actor, 0);
    assert.strictEqual(rec(h).rec.type, want, cards);
  }
});

test('postflop: bet the nuts, fold air to a big bet', () => {
  let h = setup(2, 'Ah Kh', { button: 1 });
  h.act(1, { type: 'call' }); h.act(0, { type: 'check' });
  h.board = C.parseCards('Qh Jh Th'); // royal flush for hero
  h.street = 'flop'; for (const p of h.seated) { p.bet = 0; p.acted = false; } h.currentBet = 0; h.actor = 0;
  let A = rec(h);
  assert.strictEqual(A.rec.type, 'raise', 'value bet with the nuts');
  h = setup(2, '7c 2d', { button: 1 });
  h.act(1, { type: 'call' }); h.act(0, { type: 'check' });
  h.board = C.parseCards('As Kd Qh 9s 4c'); h.street = 'river';
  for (const p of h.seated) { p.bet = 0; p.acted = false; } h.currentBet = 0; h.actor = 0;
  h.act(0, { type: 'check' });
  h.act(1, { type: 'raise', to: 1200 }); // pot-size bet
  A = rec(h);
  assert.strictEqual(A.rec.type, 'fold');
  const g = FS.coach.grade(A, { type: 'call' }, h, 0);
  assert.ok(['mistake', 'blunder'].includes(g.grade), 'calling with air graded as mistake');
  assert.strictEqual(FS.coach.grade(A, { type: 'fold' }, h, 0).grade, 'good');
});

test('coach text: three tiers render with glossary tooltips and no raw markup', () => {
  const h = setup(6, 'Jh Th', { button: 3 });
  while (h.actor !== 0) h.act(h.actor, { type: h.actor === 4 ? 'raise' : 'call', to: 600 });
  const A = rec(h);
  const ctx = { A, T: null, hand: h, heroSeat: 0, profiles: () => ({ style: 'lag' }) };
  const all = [...FS.coach.bigPicture(ctx), ...FS.coach.tableRead(ctx), ...FS.coach.handCoach(ctx)];
  assert.ok(all.length >= 5);
  const html = all.map(FS.coach.glossaryHTML).join('\n');
  assert.ok(html.includes('class="term"'), 'has glossary terms');
  assert.ok(!/\[\[|\]\]/.test(html), 'no raw [[markup]]');
  assert.ok(!/board board/.test(html));
  const r = FS.coach.recommendation(ctx);
  assert.ok(r && r.label && r.why);
  const narrative = FS.coach.narrate(h, 0, []);
  assert.ok(narrative.includes('Hero (you)'));
});

test('glossary markup: [[term|shown]] shows the display text', () => {
  const out = FS.coach.glossaryHTML('a [[dry board|dry]] board and [[pot odds]]');
  assert.ok(out.includes('>dry</span> board'));
  assert.ok(out.includes('>pot odds</span>'));
});

test('browser prompt copy is in sync with server/coach_prompt.md', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', 'server', 'coach_prompt.md'), 'utf8');
  assert.strictEqual(FS.COACH_PROMPT, md, 'run: node tools/sync-prompt.js');
  assert.ok(md.startsWith('You are a Texas Hold\'em expert here to help the player understand'));
  assert.ok(md.includes('{{GAME_CONTEXT}}'));
});

test('endpoint normalization', () => {
  const n = FS.llm.normalizeEndpoint;
  assert.strictEqual(n('http://localhost:11434/v1'), 'http://localhost:11434/v1/chat/completions');
  assert.strictEqual(n('http://localhost:11434/'), 'http://localhost:11434/v1/chat/completions');
  assert.strictEqual(n('https://openrouter.ai/api/v1'), 'https://openrouter.ai/api/v1/chat/completions');
  assert.strictEqual(n('https://x.y/v1/chat/completions'), 'https://x.y/v1/chat/completions');
  const msgs = FS.llm.buildMessages('What now?', [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }], 'CTX');
  assert.strictEqual(msgs[0].role, 'system');
  assert.ok(msgs[0].content.includes('CTX'));
  assert.strictEqual(msgs[msgs.length - 1].content, 'What now?');
});

test('hand facts for the AI coach: folded hero vs shown hands (K2 on 6-5-2-9-9)', () => {
  const seats = [{ id: 'hero', name: 'You', stack: 5000 }, { id: 'b', name: 'Beatrice', stack: 5000 }, { id: 'w', name: 'Wendell', stack: 5000 }];
  const h = new FS.engine.Hand({ seats, button: 2, sb: 50, bb: 100, rng: FS.util.makeRng(1) }).start();
  const hc = { 0: 'Kc 2c', 1: 'Ad Kd', 2: 'Jh Th' };
  for (const s of [0, 1, 2]) h.players[s].cards = C.parseCards(hc[s]);
  const bd = C.parseCards('6h 5d 2s 9h 9s');
  const used = [...bd, ...C.parseCards('Kc 2c Ad Kd Jh Th')];
  const rest = C.newDeck().filter((c) => !used.includes(c));
  h.deck = rest.slice(3).concat([bd[4], rest[2], bd[3], rest[1], bd[2], bd[1], bd[0], rest[0]]);
  h.act(2, { type: 'call' }); h.act(0, { type: 'fold' });
  while (!h.done) h.act(h.actor, { type: 'check' });
  const text = FS.coach.narrate(h, 0, []);
  assert.ok(text.includes('Beatrice holds A♦ K♦ → Pair of Nines'));
  assert.ok(text.includes('Two Pair, Nines and Twos'));
  assert.ok(/Two Pair, Nines and Twos BEATS the best shown hand/.test(text));
  assert.ok(text.includes('no other ranks are on the board'));
});
