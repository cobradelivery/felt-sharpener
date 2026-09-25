// E2E: play a Sit & Go, shrink the hero's stack, shove every hand until busted, then check the
// results screen (remaining tournament is simulated) and the progress screen.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const OUT = process.argv[2] || null;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 760 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.stack));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await p.evaluate(() => { localStorage.clear(); });
  await p.reload();
  await p.evaluate(() => { FS.store.get().seenIntro = true; const s = FS.store.get().settings; s.speed = 'turbo'; s.confirmAllIn = false; s.autoAdvance = true; FS.store.save(true); });
  await p.click('#press-start');
  await p.click('.menu-item[data-id=sng]');
  await p.waitForSelector('#scr-game.active');
  let shrunk = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    const st = await p.evaluate(() => ({ screen: FS.ui.current, waiting: !!FS.game.G.waiter, between: FS.game.G.betweenHands }));
    if (st.screen === 'results') break;
    if (st.between && !shrunk) {
      shrunk = true;
      await p.evaluate(() => { const T = FS.game.G.T; const h = FS.tournament.hero(T); const other = T.players.find((x) => !x.isHero && !x.busted); other.stack += h.stack - 400; h.stack = 400; });
    }
    if (st.waiting) {
      if (await p.$('#ab-raise')) { await p.click('.presets .btn:last-child'); await p.click('#ab-raise'); }
      else await p.click('#ab-call');
    }
    await p.waitForTimeout(100);
  }
  await p.waitForSelector('#scr-results.active', { timeout: 60000 });
  await p.waitForTimeout(500);
  const txt = await p.textContent('#results-body');
  if (!/of 9 players/.test(txt)) throw new Error('results missing: ' + txt.slice(0, 200));
  if (OUT) await p.screenshot({ path: path.join(OUT, '20-results.png'), fullPage: true });
  await p.click('#res-ask');
  await p.waitForTimeout(300);
  await p.click('#res-stats');
  await p.waitForSelector('#scr-stats.active');
  if (OUT) await p.screenshot({ path: path.join(OUT, '21-stats.png'), fullPage: true });
  const stats = await p.evaluate(() => FS.store.get().hero);
  if (stats.tournaments !== 1) throw new Error('tournament not recorded');
  const opp = await p.evaluate(() => Object.values(FS.store.get().opponents).filter((o) => o.tourneys === 1).length);
  if (opp !== 8) throw new Error('opponent records: ' + opp);
  await b.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('BUST E2E OK — finished', stats.history[0].finish, 'of 9');
})().catch((e) => { console.error(e); process.exit(1); });
