// Exercises the Android bridge code path (js/game/native.js) in Chromium with a mock window.FeltAndroid
// that behaves like the Java side: the AI coach request goes through the bridge, the back button
// closes modals / opens the pause menu / reports "exit" on the title screen.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const path = require('path');
(async () => {
  let seen = null;
  const up = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { seen = JSON.parse(b); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ model: 'm', choices: [{ message: { content: 'Bridge reply' } }] })); }); });
  await new Promise((r) => up.listen(0, '127.0.0.1', r));
  const port = up.address().port;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 915, height: 411 }, isMobile: true, hasTouch: true });
  // Node-side "native" HTTP, like the Java bridge (no CORS involved)
  await ctx.exposeFunction('__nativeHttp', async (url, method, headers, body) => {
    const r = await fetch(url, { method, headers: JSON.parse(headers), body: body || undefined });
    return [r.status, await r.text()];
  });
  await ctx.addInitScript(() => {
    window.__bridgeCalls = 0;
    window.FeltAndroid = {
      httpRequest(id, url, method, headers, body) {
        window.__bridgeCalls++;
        window.__nativeHttp(url, method, headers, body).then(([s, t]) => FS.native.done(id, s, t, null), (e) => FS.native.done(id, 0, '', String(e)));
      },
      platform() { return 'android test'; },
    };
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  const fail = (m) => { throw new Error(m); };
  if (!(await p.evaluate(() => FS.native.available && document.documentElement.classList.contains('android')))) fail('bridge not detected');
  const r = await p.evaluate((port) => FS.llm.ask('hi', [], 'CTX-ANDROID', { endpoint: `http://127.0.0.1:${port}/v1`, model: 'x' }), port);
  if (r.reply !== 'Bridge reply' || r.route !== 'app') fail('ask via bridge: ' + JSON.stringify(r));
  if (!seen.messages[0].content.includes('CTX-ANDROID')) fail('context not sent');
  if ((await p.evaluate(() => window.__bridgeCalls)) !== 1) fail('request did not go through the bridge');
  // unreachable endpoint -> friendly LAN hint
  const err = await p.evaluate(() => FS.llm.ask('hi', [], '', { endpoint: 'http://127.0.0.1:1/v1' }).catch((e) => e.message));
  if (!/LAN IP/.test(err)) fail('no LAN hint: ' + err);
  // back button
  if ((await p.evaluate(() => FS.native.back())) !== 'exit') fail('title should exit');
  await p.evaluate(() => { localStorage.clear(); FS.store.get().seenIntro = true; FS.store.get().settings.speed = 'turbo'; FS.store.save(true); });
  await p.tap('#press-start');
  await p.tap('.menu-item[data-id=sng]');
  await p.waitForFunction(() => FS.game.G.waiter, null, { timeout: 60000 });
  if ((await p.evaluate(() => FS.native.back())) !== 'handled' || !(await p.$('.modal'))) fail('back in game should open pause menu');
  await p.evaluate(() => FS.native.back());
  if (await p.$('.modal')) fail('back should close the modal');
  await p.evaluate(() => { FS.native.onPause(); FS.native.onResume(); });
  // settings shows phone instructions
  await p.evaluate(() => FS.screens.settings('ai'));
  if (!/LAN IP/.test(await p.textContent('.modal'))) fail('settings should show phone instructions');
  await b.close(); up.close();
  if (errs.length) fail(errs.join('\n'));
  console.log('ANDROID SHIM OK');
})().catch((e) => { console.error(e); process.exit(1); });
