/* AI coach client. Two routes:
   - harness: when the page is served by server/harness.py, POST /api/coach (the server wraps the
     question in the expert prompt and forwards it — no CORS issues, key stays out of page requests).
   - direct: the browser calls the OpenAI-compatible endpoint itself (needs CORS enabled on it,
     e.g. OLLAMA_ORIGINS=* for Ollama or "Enable CORS" in LM Studio). */
(function (root) {
  'use strict';
  const FS = root.FS;

  function normalizeEndpoint(url) {
    url = (url || '').trim().replace(/\/+$/, '');
    if (!url) return '';
    if (/\/chat\/completions$/.test(url)) return url;
    if (/\/(v1|api\/v1|openai)$/.test(url)) return url + '/chat/completions';
    return url + '/v1/chat/completions';
  }

  let harnessState = null; // null unknown, true/false
  async function harnessAvailable() {
    if (harnessState !== null) return harnessState;
    if (!/^https?:$/.test(root.location ? root.location.protocol : '')) return (harnessState = false);
    try {
      const r = await fetch('api/health', { cache: 'no-store' });
      const j = await r.json();
      harnessState = !!(j && j.ok);
    } catch (e) { harnessState = false; }
    return harnessState;
  }

  function buildMessages(question, history, context) {
    const system = (FS.COACH_PROMPT || 'You are a Texas Hold\'em expert coach.\n{{GAME_CONTEXT}}').replace('{{GAME_CONTEXT}}', context || '(no game in progress)');
    const msgs = [{ role: 'system', content: system }];
    for (const m of (history || []).slice(-12)) if ((m.role === 'user' || m.role === 'assistant') && m.content) msgs.push({ role: m.role, content: String(m.content).slice(0, 8000) });
    msgs.push({ role: 'user', content: String(question).slice(0, 4000) });
    return msgs;
  }

  async function withTimeout(promise, ms, ctl) {
    let t;
    const timeout = new Promise((_, rej) => { t = setTimeout(() => { if (ctl) ctl.abort(); rej(new Error('The AI took too long to answer (over ' + Math.round(ms / 1000) + 's).')); }, ms); });
    try { return await Promise.race([promise, timeout]); } finally { clearTimeout(t); }
  }

  /** Returns { reply, route, model } or throws Error with a friendly message. */
  async function ask(question, history, context, cfg) {
    cfg = cfg || {};
    const mode = cfg.mode || 'auto';
    const useHarness = mode === 'harness' || (mode === 'auto' && await harnessAvailable());
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (useHarness) {
      const r = await withTimeout(fetch('api/coach', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl && ctl.signal,
        body: JSON.stringify({ question, history, context, config: { endpoint: cfg.endpoint, apiKey: cfg.apiKey, model: cfg.model, temperature: cfg.temperature } }),
      }), 190000, ctl);
      const j = await r.json().catch(() => ({ error: 'Bad response from harness' }));
      if (!r.ok || j.error) throw new Error(j.error || ('Harness error ' + r.status));
      return { reply: j.reply, route: 'harness', model: j.model };
    }
    const url = normalizeEndpoint(cfg.endpoint);
    if (!url) throw new Error('NOT_CONFIGURED');
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
    let r;
    try {
      r = await withTimeout(fetch(url, {
        method: 'POST', headers, signal: ctl && ctl.signal,
        body: JSON.stringify({ model: cfg.model || 'gpt-4o-mini', messages: buildMessages(question, history, context), temperature: Number(cfg.temperature) || 0.4 }),
      }), 180000, ctl);
    } catch (e) {
      if (/too long/.test(e.message)) throw e;
      throw new Error('Could not reach ' + url + '. If it is a local server, make sure it is running and allows browser (CORS) requests — or start the game with the harness (see README), which avoids CORS entirely.');
    }
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error('The AI endpoint returned ' + r.status + (j && j.error ? ': ' + (j.error.message || JSON.stringify(j.error)) : ''));
    const reply = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!reply) throw new Error('Unexpected response from the AI endpoint.');
    return { reply, route: 'direct', model: j.model || cfg.model };
  }

  function isConfigured(cfg) { return !!(cfg && cfg.endpoint) || harnessState === true; }

  FS.llm = { ask, normalizeEndpoint, harnessAvailable, buildMessages, isConfigured, resetHarnessCheck: () => { harnessState = null; } };
})(typeof window !== 'undefined' ? window : globalThis);
