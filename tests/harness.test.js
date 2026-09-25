// Starts a mock OpenAI-compatible server and the Python harness, then checks the harness wraps the
// question in the coach prompt + game context and relays the reply.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

function listen(server) { return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))); }
async function waitFor(url, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('timeout waiting for ' + url);
}

test('harness wraps the prompt and proxies to an OpenAI-compatible endpoint', async () => {
  let seen = null;
  const upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: 'mock-1', choices: [{ message: { role: 'assistant', content: 'Fold. Your hand is too weak.' } }] }));
    });
  });
  const upPort = await listen(upstream);
  const port = 18000 + Math.floor(Math.random() * 1000);
  const py = spawn('python3', [path.join(__dirname, '..', 'server', 'harness.py'), '--port', String(port), '--no-browser'], { stdio: 'ignore' });
  try {
    await waitFor(`http://127.0.0.1:${port}/api/health`, 8000);
    const page = await fetch(`http://127.0.0.1:${port}/index.html`);
    assert.strictEqual(page.status, 200, 'serves the game');
    const r = await fetch(`http://127.0.0.1:${port}/api/coach`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'What should I do?', history: [{ role: 'user', content: 'earlier q' }, { role: 'assistant', content: 'earlier a' }], context: 'HERO holds 7c 2d', config: { endpoint: `http://127.0.0.1:${upPort}/v1`, apiKey: 'sk-test', model: 'my-model', temperature: 0.3 } }),
    });
    const j = await r.json();
    assert.strictEqual(r.status, 200, JSON.stringify(j));
    assert.strictEqual(j.reply, 'Fold. Your hand is too weak.');
    assert.strictEqual(seen.url, '/v1/chat/completions');
    assert.strictEqual(seen.auth, 'Bearer sk-test');
    assert.strictEqual(seen.body.model, 'my-model');
    const sys = seen.body.messages[0];
    assert.strictEqual(sys.role, 'system');
    assert.ok(sys.content.startsWith("You are a Texas Hold'em expert here to help the player understand"));
    assert.ok(sys.content.includes('HERO holds 7c 2d'));
    assert.deepStrictEqual(seen.body.messages.slice(1).map((m) => m.role), ['user', 'assistant', 'user']);
    // no endpoint -> friendly 400
    const r2 = await fetch(`http://127.0.0.1:${port}/api/coach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'x', config: {} }) });
    assert.strictEqual(r2.status, 400);
    // unreachable endpoint -> 502 with message
    const r3 = await fetch(`http://127.0.0.1:${port}/api/coach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'x', config: { endpoint: 'http://127.0.0.1:1/v1' } }) });
    assert.strictEqual(r3.status, 502);
    assert.ok((await r3.json()).error.includes('Could not reach'));
  } finally {
    py.kill();
    upstream.close();
  }
});
