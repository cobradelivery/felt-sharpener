// E2E for the AI coach: runs the Python harness + a mock OpenAI-compatible server, opens the game
// through the harness, asks the coach a question from the chat panel, and checks the round trip
// (prompt wrapping + live game context + reply rendering). Also checks direct (browser) mode.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

(async () => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    // CORS so direct mode works too
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const j = JSON.parse(body);
      seen.push(j);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: 'mock', choices: [{ message: { content: '**Fold.** Mock coach reply #' + seen.length } }] }));
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const upPort = upstream.address().port;
  const port = 19000 + Math.floor(Math.random() * 900);
  const py = spawn('python3', [path.join(__dirname, '..', 'server', 'harness.py'), '--port', String(port), '--no-browser'], { stdio: 'ignore' });
  const b = await chromium.launch();
  let ok = false;
  try {
    for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${port}/api/health`); break; } catch (e) { await new Promise((r) => setTimeout(r, 150)); } }
    const p = await b.newPage({ viewport: { width: 1366, height: 800 } });
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.stack));
    await p.goto(`http://127.0.0.1:${port}/`);
    await p.evaluate((up) => { localStorage.clear(); FS.store.get().seenIntro = true; const s = FS.store.get().settings; s.speed = 'turbo'; s.llm.endpoint = `http://127.0.0.1:${up}/v1`; s.llm.model = 'mock-model'; FS.store.save(true); }, upPort);
    await p.reload();
    await p.click('#press-start');
    await p.click('.menu-item[data-id=sng]');
    await p.waitForFunction(() => FS.game.G.waiter, null, { timeout: 60000 });
    await p.click('[data-tab="chat"]');
    await p.waitForFunction(() => /harness/.test(document.querySelector('#chat-route').textContent));
    await p.click('.chat-quick .btn:first-child');
    await p.waitForFunction(() => /Mock coach reply #1/.test(document.querySelector('#chat-log').textContent), null, { timeout: 10000 });
    const sys = seen[0].messages[0].content;
    if (!sys.startsWith("You are a Texas Hold'em expert here to help the player understand")) throw new Error('prompt not wrapped');
    if (!/IT IS HERO'S TURN/.test(sys) || !/Hero's cards:/.test(sys)) throw new Error('context missing live hand');
    if (seen[0].model !== 'mock-model') throw new Error('model not passed');
    // follow-up keeps history
    await p.fill('#chat-text', 'Why fold?');
    await p.press('#chat-text', 'Enter');
    await p.waitForFunction(() => /Mock coach reply #2/.test(document.querySelector('#chat-log').textContent));
    const roles = seen[1].messages.map((m) => m.role).join(',');
    if (roles !== 'system,user,assistant,user') throw new Error('history not sent: ' + roles);
    await p.screenshot({ path: path.join(process.argv[2] || '/tmp', '30-chat-harness.png') });
    // direct mode from file://
    const p2 = await b.newPage();
    p2.on('pageerror', (e) => errors.push(e.stack));
    await p2.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
    const r = await p2.evaluate(async (up) => FS.llm.ask('hi', [], 'CTX-DIRECT', { endpoint: `http://127.0.0.1:${up}/v1`, model: 'm2', mode: 'auto' }), upPort);
    if (r.route !== 'direct' || !/Mock coach reply #3/.test(r.reply)) throw new Error('direct mode failed ' + JSON.stringify(r));
    if (!seen[2].messages[0].content.includes('CTX-DIRECT')) throw new Error('direct prompt missing context');
    if (errors.length) throw new Error(errors.join('\n'));
    ok = true;
  } finally {
    await b.close(); py.kill(); upstream.close();
  }
  console.log(ok ? 'COACH E2E OK' : 'FAILED');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
