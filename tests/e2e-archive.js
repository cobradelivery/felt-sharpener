// E2E: tournament archive + AI review conversation with free-form follow-ups, export/import, and
// migration of the legacy single "lastResult" save.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const path = require('path');
const fs = require('fs');
(async () => {
  const seen = [];
  const up = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
      const j = JSON.parse(b); seen.push(j);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: `Coach reply ${seen.length}. Want me to dig deeper on anything?` } }] }));
    });
  });
  await new Promise((r) => up.listen(0, '127.0.0.1', r));
  const port = up.address().port;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.stack));
  const fail = (m) => { throw new Error(m); };
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  await p.goto(url);
  // 1) legacy save from an older version: only st.lastResult, no archive
  await p.evaluate(() => {
    FS.store.save = () => {}; // don't let the unload handler overwrite the planted legacy save
    localStorage.clear();
    const legacy = { settings: { heroName: 'Ace' }, hero: {}, lastResult: JSON.stringify({
      T: { field: 9, buyIn: 100, payouts: [450, 270, 180], name: 'Old Classic', players: [{ id: 'hero', name: 'You', finish: 1, prize: 450, style: 'hero' }, { id: 'dutch', name: 'Dutch Kowalski', finish: 2, prize: 270, style: 'rock' }] },
      meta: { hands: 3, vpip: 1, pfr: 1, grades: { good: 2, ok: 1, mistake: 0, blunder: 0 }, mistakes: [], biggestWin: 900, startedAt: 1700000000000,
        history: [{ no: 1, level: 1, title: 'A♠ K♠ · BTN · +900', narrative: 'Hand one narrative', grades: [{ grade: 'good', text: 'x', rec: 'RAISE', took: 'raise', street: 'preflop' }], cards: [48, 44], board: [], net: 900 }] } }) };
    localStorage.setItem('feltSharpener.v1', JSON.stringify(legacy));
  });
  await p.reload();
  await p.evaluate(() => FS.ui.showScreen('stats'));
  const legacyRow = await p.$('.hist-item[data-id="t1700000000000"]');
  if (!legacyRow) fail('legacy result not migrated into the archive');
  await legacyRow.click();
  await p.waitForSelector('#scr-results.active');
  if (!/CHAMPION/.test(await p.textContent('#results-body'))) fail('legacy report not shown');

  // 2) play a real Sit & Go to the end (shove every hand), with the AI endpoint configured
  await p.evaluate(() => { FS.store.save = () => {}; localStorage.clear(); });
  await p.reload();
  await p.evaluate((port) => { const st = FS.store.get(); st.seenIntro = true; Object.assign(st.settings, { speed: 'turbo', confirmAllIn: false }); st.settings.llm.endpoint = `http://127.0.0.1:${port}/v1`; st.settings.llm.mode = 'direct'; FS.store.save(true); }, port);
  await p.click('#press-start'); await p.click('.menu-item[data-id=sng]');
  await p.waitForSelector('#scr-game.active');
  const t0 = Date.now();
  let shrunk = false;
  while (Date.now() - t0 < 200000) {
    const s = await p.evaluate(() => ({ scr: FS.ui.current, w: !!FS.game.G.waiter, bt: FS.game.G.betweenHands }));
    if (s.scr === 'results') break;
    // After the first hand, leave the hero a tiny stack so shoving busts quickly (keeps the test fast and deterministic in length)
    if (s.bt && !shrunk) {
      shrunk = true;
      await p.evaluate(() => { const T = FS.game.G.T; const h = FS.tournament.hero(T); const other = T.players.find((x) => !x.isHero && !x.busted); other.stack += h.stack - 400; h.stack = 400; });
    }
    if (s.w) { if (await p.$('#ab-raise')) { await p.click('.presets .btn:last-child'); await p.click('#ab-raise'); } else await p.click('#ab-call'); }
    await p.waitForTimeout(80);
  }
  await p.waitForSelector('#scr-results.active', { timeout: 60000 });
  const recId = await p.evaluate(() => FS.store.get().lastResultId);
  const handCount = await p.evaluate((id) => FS.archive.get(id).meta.history.length, recId);
  if (!handCount) fail('no hand histories archived');
  // review + free-form follow-up mentioning a hand number
  await p.click('#rep-convo .convo-start .btn');
  await p.waitForFunction(() => /Coach reply 1/.test(document.querySelector('#rep-convo').textContent));
  await p.fill('#rep-convo textarea', 'Dig deeper on hand 1 please');
  await p.press('#rep-convo textarea', 'Enter');
  await p.waitForFunction(() => /Coach reply 2/.test(document.querySelector('#rep-convo').textContent));
  const second = seen[1];
  if (second.messages.map((m) => m.role).join(',') !== 'system,user,assistant,user') fail('follow-up history missing');
  if (!/\[Hand #1\]/.test(second.messages[0].content)) fail('mentioned hand not attached to context');
  if (!/HAND INDEX/.test(second.messages[0].content)) fail('hand index missing');
  await p.fill('#rep-notes', 'Remember: shove less');
  await p.dispatchEvent('#rep-notes', 'change');
  // 3) exports
  const [dlMd] = await Promise.all([p.waitForEvent('download'), p.click('#rep-md')]);
  const md = fs.readFileSync(await dlMd.path(), 'utf8');
  if (!/# Felt Sharpener/.test(md) || !/Coach reply 2/.test(md) || !/### Hand #1/.test(md) || !/shove less/.test(md)) fail('markdown export incomplete');
  const [dlJson] = await Promise.all([p.waitForEvent('download'), p.click('#rep-json')]);
  const jsonText = fs.readFileSync(await dlJson.path(), 'utf8');
  if (JSON.parse(jsonText).review.length !== 4) fail('json export missing conversation');
  // 4) persistence across reload, reopen from Saved tournaments, conversation still there
  await p.reload();
  await p.evaluate(() => FS.ui.showScreen('stats'));
  await p.click(`.hist-item[data-id="${recId}"]`);
  await p.waitForSelector('#scr-results.active');
  if (!/Coach reply 2/.test(await p.textContent('#rep-convo'))) fail('conversation not persisted');
  if (!(await p.$('#rep-del'))) fail('archived view should offer delete');
  // 5) delete then import the JSON back
  p.once('dialog', (d) => d.accept());
  await p.click('#rep-del');
  await p.waitForSelector('#scr-stats.active');
  if (await p.evaluate((id) => !!FS.archive.get(id), recId)) fail('delete failed');
  const n = await p.evaluate((t) => FS.archive.importText(t), jsonText);
  if (n !== 1 || !(await p.evaluate((id) => !!FS.archive.get(id), recId))) fail('import failed');
  await p.screenshot({ path: path.join(process.argv[2] || '/tmp', '40-archive.png'), fullPage: false });
  await b.close(); up.close();
  if (errs.length) fail(errs.join('\n'));
  console.log(`ARCHIVE E2E OK (${handCount} hands archived)`);
})().catch((e) => { console.error(e); process.exit(1); });
