// End-to-end browser test: boots the app from file://, starts a tournament, plays hands through the
// real UI (clicking buttons), exercises menus/modals, and fails on any page error.
// usage: node tests/e2e.js [hands=12] [outDir]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const HANDS = +(process.argv[2] || 12);
const OUT = process.argv[3] || null;
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.stack));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  await page.goto(url);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  // speed up
  await page.evaluate(() => { FS.store.get().seenIntro = true; const s = FS.store.get().settings; s.speed = 'turbo'; s.confirmAllIn = false; FS.store.save(true); });
  const shot = async (name) => { if (OUT) await page.screenshot({ path: path.join(OUT, name + '.png') }); };
  await page.click('#press-start');
  await page.waitForSelector('.menu-item');
  await shot('01-menu');
  // Learn screen
  await page.click('.menu-item[data-id=learn]');
  await page.waitForSelector('.lesson');
  for (const id of ['rank', 'start', 'odds', 'live']) { await page.click(`[data-l="${id}"]`); await page.waitForTimeout(80); }
  await shot('02-learn');
  await page.click('#scr-learn [data-nav=title]');
  // Roster
  await page.click('.menu-item[data-id=roster]');
  await page.waitForSelector('.r-card', { timeout: 15000 });
  await shot('03-roster');
  await page.click('#scr-roster [data-nav=title]');
  // New tournament
  await page.click('.menu-item[data-id=new]');
  await page.waitForSelector('#setup-go');
  await page.click('.opt[data-v="18"]');
  await page.click('.opt[data-v="turbo"]');
  await shot('04-setup');
  await page.click('#setup-go');
  await page.waitForSelector('#scr-game.active');
  let played = 0, decisions = 0, lastNo = 0; const shots = {};
  const t0 = Date.now();
  while (played < HANDS && Date.now() - t0 < 240000) {
    const state = await page.evaluate(() => ({ waiting: !!FS.game.G.waiter, between: FS.game.G.betweenHands, screen: FS.ui.current, no: FS.game.G.handNo, street: FS.game.G.hand && FS.game.G.hand.street, sd: !!(FS.game.G.hand && FS.game.G.hand.done && FS.game.G.hand.results && !FS.game.G.hand.results.uncontested) }));
    if (state.waiting && state.street !== 'preflop' && !shots.post) { shots.post = 1; await page.waitForTimeout(300); await shot('12-postflop'); }
    if (state.between && state.sd && !shots.sd) { shots.sd = 1; await shot('13-showdown'); }
    if (state.screen !== 'game') break;
    if (state.no !== lastNo) { lastNo = state.no; played++; }
    if (state.waiting) {
      decisions++;
      if (decisions === 2) await shot('05-decision');
      // mostly follow the coach, sometimes deviate to exercise grading
      const btn = await page.$('.act-btn.recommended') ;
      const r = Math.random();
      if (r < 0.15 && await page.$('#ab-raise')) { await page.click('.presets .btn:nth-child(2)'); await page.click('#ab-raise'); }
      else if (r < 0.25) await page.click('#ab-call');
      else if (btn) await btn.click();
      else await page.click('#ab-call');
    } else if (state.between) {
      if (played === 3) {
        await page.click('#ab-lobby'); await page.waitForSelector('.modal'); await shot('06-lobby');
        await page.click('.modal [data-t="bl"]'); await page.click('.modal [data-close]');
        await page.click('[data-tab="log"]'); await shot('07-log');
        await page.click('[data-tab="opps"]'); await shot('08-opps');
        await page.click('[data-tab="chat"]');
        await page.click('.chat-quick .btn:first-child');
        await page.waitForTimeout(400); await shot('09-chat');
        await page.click('[data-tab="hints"]');
        await page.click('#hud-settings'); await page.waitForSelector('.modal'); await page.click('.modal [data-t="ai"]'); await shot('10-settings'); await page.click('.modal [data-close]');
      }
      await page.click('#ab-next').catch(() => {});
    }
    await page.waitForTimeout(120);
  }
  const ctx = await page.evaluate(() => FS.game.buildContext());
  const hero = await page.evaluate(() => ({ stack: FS.tournament.hero(FS.game.G.T).stack, grades: FS.game.G.meta.grades, level: FS.game.G.T.level }));
  console.log(`played ${played} hands, ${decisions} decisions in ${((Date.now() - t0) / 1000).toFixed(0)}s; hero`, JSON.stringify(hero));
  console.log('context chars:', ctx.length);
  // Pause/quit/resume path
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal');
  await page.click('.modal [data-a="quit"]');
  await page.waitForSelector('#scr-title.active');
  const hasContinue = await page.$('.menu-item[data-id=continue]');
  console.log('continue offered:', !!hasContinue);
  if (hasContinue) { await hasContinue.click(); await page.waitForSelector('#scr-game.active'); await page.waitForTimeout(1500); await shot('11-resumed'); }
  await browser.close();
  if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1); }
  console.log('E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
