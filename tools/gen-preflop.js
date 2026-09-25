// Generates the 169-hand preflop strength ordering used by js/core/preflop.js.
// Blend of heads-up equity vs a random hand and 3-way equity vs two random hands
// (the 3-way term rewards suitedness/connectedness the way real play does).
const FS = require('../tests/load.js')('cards');
const C = FS.cards;
const rng = FS.util.makeRng(12345);
const codes = C.allCodes();
const N = +process.argv[2] || 30000;
const rows = codes.map((code) => {
  const combos = C.codeCombos(code);
  let hu = 0, tri = 0;
  for (let i = 0; i < combos.length; i++) {
    hu += C.equity(combos[i], [], [null], N / combos.length, rng).equity;
    tri += C.equity(combos[i], [], [null, null], N / combos.length, rng).equity;
  }
  hu /= combos.length; tri /= combos.length;
  return { code, hu, tri, score: hu / 0.5 * 0.45 + tri / 0.333 * 0.55 };
});
rows.sort((a, b) => b.score - a.score);
console.log(JSON.stringify(rows.map((r) => r.code)));
console.error(rows.slice(0, 40).map((r) => r.code + ' ' + r.hu.toFixed(3) + ' ' + r.tri.toFixed(3)).join('\n'));
