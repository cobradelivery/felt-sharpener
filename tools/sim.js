// Quick sanity sim: bots of different styles play a long heads-up/9-max session; print chip results & stats.
const FS = require('../tests/load.js')();
const rng = FS.util.makeRng(+process.argv[2] || 7);
const styles = (process.argv[3] || 'tag,rock,lag,maniac,station,fish,shark,nit,trapper').split(',');
const stacks = styles.map(() => 10000);
const stats = styles.map(() => ({ hands: 0, vpip: 0, pfr: 0, net: 0 }));
let btn = 0; const t0 = Date.now(); let N = +process.argv[4] || 400;
for (let n = 0; n < N; n++) {
  const seats = styles.map((s, i) => ({ id: s + i, name: s, stack: 10000 }));
  const h = new FS.engine.Hand({ seats, button: btn, sb: 50, bb: 100, ante: 100, rng }).start();
  btn = (btn + 1) % styles.length;
  const vp = new Set(), pr = new Set();
  while (!h.done) {
    const s = h.actor;
    const d = FS.ai.decide(h, s, { style: styles[s], tilt: 0 }, { rng, fast: true, readLookup: (id) => FS.roster.STYLES[id.replace(/\d+$/, '')] });
    if (h.street === 'preflop') { if (d.action.type === 'call' || d.action.type === 'raise') vp.add(s); if (d.action.type === 'raise') pr.add(s); }
    h.act(s, d.action);
  }
  h.players.forEach((p, i) => { stats[i].hands++; stats[i].net += p.stack - 10000; if (vp.has(i)) stats[i].vpip++; if (pr.has(i)) stats[i].pfr++; });
}
console.log('ms/hand', ((Date.now() - t0) / N).toFixed(1));
stats.forEach((s, i) => console.log(styles[i].padEnd(8), 'VPIP', (s.vpip / s.hands * 100).toFixed(0).padStart(3) + '%', 'PFR', (s.pfr / s.hands * 100).toFixed(0).padStart(3) + '%', 'net bb/100', (s.net / 100 / s.hands * 100).toFixed(1)));
