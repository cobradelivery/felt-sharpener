/* Bridge to the Android app shell (android/). In a normal browser this file does nothing.
   The shell exposes window.FeltAndroid; HTTP goes through native code so the AI coach can reach any
   endpoint (including plain-http servers on your LAN) without browser CORS limits. */
(function (root) {
  'use strict';
  const FS = root.FS;
  const bridge = root.FeltAndroid || null;
  const pending = {};
  let seq = 0;

  /** request(url, {method, headers, body}) -> Promise<{status, text}> */
  function request(url, opts) {
    opts = opts || {};
    if (!bridge) {
      return fetch(url, { method: opts.method || 'GET', headers: opts.headers, body: opts.body, signal: opts.signal })
        .then((r) => r.text().then((text) => ({ status: r.status, text })));
    }
    return new Promise((resolve, reject) => {
      const id = 'r' + (++seq);
      pending[id] = { resolve, reject };
      bridge.httpRequest(id, url, opts.method || 'GET', JSON.stringify(opts.headers || {}), opts.body || '', opts.timeoutMs || 180000);
    });
  }
  // Called from Java when a request finishes
  function done(id, status, text, error) {
    const p = pending[id];
    if (!p) return;
    delete pending[id];
    if (error) p.reject(new Error(error)); else p.resolve({ status, text });
  }

  /** Android back button: close a modal, open the pause menu, go back a screen, or exit. */
  function back() {
    const modals = document.querySelectorAll('#modal-root .modal-back');
    if (modals.length) { const c = modals[modals.length - 1].querySelector('[data-close]'); if (c) c.click(); else modals[modals.length - 1].remove(); return 'handled'; }
    const sb = document.getElementById('sidebar');
    if (sb && sb.classList.contains('open')) { sb.classList.remove('open'); return 'handled'; }
    const cur = FS.ui.current;
    if (cur === 'game') { FS.screens.pauseMenu(); return 'handled'; }
    if (cur !== 'title') { FS.ui.showScreen('title'); return 'handled'; }
    return 'exit';
  }
  function onPause() { if (FS.audio && FS.audio.suspend) FS.audio.suspend(); if (FS.store) FS.store.save(true); }
  function onResume() { if (FS.audio && FS.audio.resume) FS.audio.resume(); }

  if (bridge) document.documentElement.classList.add('android');
  FS.native = { available: !!bridge, request, done, back, onPause, onResume };
})(typeof window !== 'undefined' ? window : globalThis);
