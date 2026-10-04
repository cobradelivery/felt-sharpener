// Storage behaviour under a full quota (fake localStorage): the archive trims the OLDEST tournament's
// hands, the main save frees archive space instead of failing, imports are sanitised.
const test = require('node:test');
const assert = require('node:assert');

function fakeStorage(limitChars) {
  const m = new Map();
  const used = () => [...m.values()].reduce((a, v) => a + v.length, 0);
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { const prev = m.get(k) || ''; if (used() - prev.length + String(v).length > limitChars) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}
globalThis.localStorage = fakeStorage(1e9);
const FS = require('./load.js')();
require('../js/game/store.js');
require('../js/game/ui.js');
FS.ui.toast = () => {}; // no DOM in Node
require('../js/game/coach.js');
require('../js/game/native.js');
require('../js/game/llm.js');
require('../js/game/archive.js');
FS.store.load();

const hand = (no, t) => ({ no, level: 1, t, cards: [0, 1], board: [], net: 0, pot: 0, pos: 'BTN', narrative: 'x'.repeat(2000), title: 'h', grades: [] });
const rec = (id, t) => ({ app: 'felt-sharpener', version: 1, id, savedAt: t, finishedAt: t, name: 'T', field: 9, finish: 3, prize: 0, payouts: [1], heroName: 'You',
  players: [{ id: 'hero', finish: 3 }], meta: { hands: 5, grades: {}, mistakes: [], history: [hand(1, t), hand(2, t)] }, chat: [], review: [], notes: '' });

test('archive full: trims the OLDEST tournament, keeps the newest intact', () => {
  globalThis.localStorage = fakeStorage(1e9);
  FS.archive.clearAll();
  FS.archive.add(rec('t1', 1000));
  FS.archive.add(rec('t2', 2000));
  const size = globalThis.localStorage.getItem(FS.archive.KEY).length;
  globalThis.localStorage = fakeStorage(size + 3000); // room for only part of one more tournament
  for (const [k, v] of [[FS.archive.KEY, JSON.stringify(FS.archive.all())]]) globalThis.localStorage.setItem(k, v);
  FS.archive.add(rec('t3', 3000)); // newest
  assert.strictEqual(FS.archive.get('t3').meta.history.length, 2, 'newest tournament keeps its hands');
  assert.strictEqual(FS.archive.get('t1').meta.history.length, 0, 'oldest tournament was trimmed');
  assert.ok(FS.archive.get('t1').historyTrimmed);
});

test('main save frees archive space when the shared quota is full', () => {
  globalThis.localStorage = fakeStorage(1e9);
  FS.archive.clearAll();
  FS.archive.add(rec('a', 1000)); FS.archive.add(rec('b', 2000));
  const archiveSize = globalThis.localStorage.getItem(FS.archive.KEY).length;
  const big = 'y'.repeat(3000);
  FS.store.get().settings.heroName = 'Big'; FS.store.get().blob = big;
  const mainSize = JSON.stringify(FS.store.get()).length;
  globalThis.localStorage = fakeStorage(archiveSize + mainSize - 2500); // not enough for both
  globalThis.localStorage.setItem(FS.archive.KEY, JSON.stringify(FS.archive.all()));
  FS.store.save(true);
  assert.ok(globalThis.localStorage.getItem('feltSharpener.v1'), 'main save written after freeing archive space');
  assert.strictEqual(FS.archive.get('a').meta.history.length, 0, 'oldest archive hands were freed');
  delete FS.store.get().blob;
});

test('import sanitises untrusted fields (no HTML/script can survive in numeric/enum fields)', () => {
  globalThis.localStorage = fakeStorage(1e9);
  FS.archive.clearAll();
  const evil = rec('t9', 9000);
  evil.field = '<img src=x onerror=alert(1)>';
  evil.finish = '<script>1</script>';
  evil.meta.mistakes = [{ hand: '<b>', street: '<img onerror=x>', took: '<svg/onload=1>', grade: '"><x', rec: 'R', text: 't', cards: 'c' }];
  evil.meta.history[0].grades = [{ grade: 'x" onmouseover="1', street: '<i>', took: '<u>' }];
  evil.meta.history[0].cards = ['<b>', 99, 3];
  const n = FS.archive.importText(JSON.stringify(evil));
  assert.strictEqual(n, 1);
  const r = FS.archive.get('t9');
  assert.strictEqual(r.field, 0);
  assert.strictEqual(r.finish, 0);
  assert.strictEqual(r.meta.mistakes[0].street, 'preflop');
  assert.strictEqual(r.meta.mistakes[0].grade, 'mistake');
  assert.strictEqual(r.meta.history[0].grades[0].grade, 'ok');
  assert.deepStrictEqual(r.meta.history[0].cards, [3]);
  assert.ok(!/[<>]/.test(JSON.stringify([r.field, r.finish, r.meta.mistakes[0].street, r.meta.history[0].grades[0].grade])));
});

test('erase all also clears the archive', () => {
  globalThis.localStorage = fakeStorage(1e9);
  FS.archive.add(rec('z', 1));
  FS.store.reset();
  assert.strictEqual(FS.archive.all().length, 0);
  assert.strictEqual(globalThis.localStorage.getItem(FS.archive.KEY), null);
});

test('fmtChips shows millions correctly', () => {
  const f = FS.util.fmtChips;
  assert.deepStrictEqual([1e6, 1.5e6, 1e7, 2e7, 999999, 250000, 25000].map(f), ['1M', '1.5M', '10M', '20M', '1M', '250K', '25,000']);
});
