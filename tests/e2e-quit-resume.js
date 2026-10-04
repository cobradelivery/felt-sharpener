// Regression: Save & quit during an AI "think" pause, then Continue immediately, must not leave two game
// loops running. Plays on after resuming and checks chip conservation + no page errors.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.stack));
  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await p.evaluate(() => { const st = FS.store.get(); st.seenIntro = true; st.settings.speed = 'slow'; st.settings.confirmAllIn = false; FS.store.save(true); });
  await p.click('#press-start'); await p.click('.menu-item[data-id=sng]');
  const fail = (m) => { throw new Error(m); };
  for (let round = 0; round < 3; round++) {
    // wait until an AI opponent is thinking mid-hand
    // (answer our own turns by folding/checking so the game keeps moving and the hero survives)
    const t1 = Date.now();
    for (;;) {
      const st = await p.evaluate(() => ({ think: !!(FS.game.G.hand && !FS.game.G.hand.done && !FS.game.G.waiter && /thinking/.test(document.querySelector('#action-bar').textContent)), w: !!FS.game.G.waiter, bt: FS.game.G.betweenHands }));
      if (st.think) break;
      if (st.w) await p.click((await p.$('#ab-fold')) ? '#ab-fold' : '#ab-call').catch(() => {});
      else if (st.bt) await p.click('#ab-next').catch(() => {});
      if (Date.now() - t1 > 90000) fail('never saw an opponent thinking');
      await p.waitForTimeout(50);
    }
    await p.evaluate(() => { FS.game.stop(); FS.ui.showScreen('title'); FS.game.resume(); });
  }
  // play on a few hands
  await p.evaluate(() => { FS.store.get().settings.speed = 'turbo'; });
  const t0 = Date.now(); let hands = 0, last = await p.evaluate(() => FS.game.G.handNo);
  while (hands < 6 && Date.now() - t0 < 120000) {
    const s = await p.evaluate(() => ({ w: !!FS.game.G.waiter, bt: FS.game.G.betweenHands, no: FS.game.G.handNo, scr: FS.ui.current }));
    if (s.scr !== 'game') break;
    if (s.no !== last) { last = s.no; hands++; }
    if (s.w) await p.click((await p.$('#ab-fold')) ? '#ab-fold' : '#ab-call').catch(() => {});
    else if (s.bt) await p.click('#ab-next').catch(() => {});
    await p.waitForTimeout(100);
  }
  const endScreen = await p.evaluate(() => FS.ui.current);
  if (hands < 4 && endScreen === 'game') fail(`game stalled after resuming (only ${hands} hands played)`);
  if (endScreen !== 'game' && hands < 1) fail('game ended without playing after resuming');
  console.log('after resume:', hands, 'hands, now on screen', endScreen);
  const chk = await p.evaluate(() => { const T = FS.game.G.T; return { total: T.players.reduce((a, x) => a + x.stack, 0), expect: T.field * T.startStack }; });
  // chips sitting in the current hand's pot are not yet back in stacks: compare between hands only
  for (const t2 = Date.now(); Date.now() - t2 < 60000;) {
    const st = await p.evaluate(() => ({ done: FS.game.G.betweenHands || FS.ui.current !== 'game', w: !!FS.game.G.waiter }));
    if (st.done) break;
    if (st.w) await p.click((await p.$('#ab-fold')) ? '#ab-fold' : '#ab-call').catch(() => {});
    await p.waitForTimeout(80);
  }
  const chk2 = await p.evaluate(() => { const T = FS.game.G.T; return { total: T.players.reduce((a, x) => a + x.stack, 0), expect: T.field * T.startStack }; });
  if (chk2.total !== chk2.expect) fail(`chips not conserved: ${chk2.total} vs ${chk2.expect}`);
  if (errs.length) fail(errs.join('\n'));
  await b.close();
  console.log(`QUIT/RESUME E2E OK (${hands} hands after 3 mid-hand quit+continue cycles; chips ${chk2.total})`);
  void chk;
})().catch((e) => { console.error(e); process.exit(1); });
