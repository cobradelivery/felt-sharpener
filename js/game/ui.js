/* Shared UI helpers: DOM, screens, toasts, modals, tooltips, card + chip rendering. */
(function (root) {
  'use strict';
  const FS = root.FS;
  const C = FS.cards, U = FS.util;

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

  let current = 'title';
  const screenHooks = {};
  function showScreen(name, arg) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'scr-' + name));
    const prev = current;
    current = name;
    if (screenHooks[name]) screenHooks[name](arg, prev);
  }
  function onScreen(name, fn) { screenHooks[name] = fn; }

  function toast(text, cls, ms) {
    const el = h(`<div class="toast ${cls || ''}">${text}</div>`);
    $('#toast-root').appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 450); }, ms || 2600);
  }

  function modal(title, body, opts) {
    opts = opts || {};
    const back = h(`<div class="modal-back"><div class="modal panel" role="dialog" aria-modal="true" aria-label="${U.esc(title)}">
      <div class="modal-head"><h2>${U.esc(title)}</h2><button class="btn small" data-close>✕ Close</button></div>
      <div class="modal-body"></div></div></div>`);
    const bodyEl = $('.modal-body', back);
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    if (opts.wide) $('.modal', back).style.width = 'min(1040px, 100%)';
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); if (opts.onClose) opts.onClose(); FS.audio.sfx.back(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
    $('#modal-root').appendChild(back);
    FS.audio.sfx.select();
    return { el: back, body: bodyEl, close };
  }
  const anyModalOpen = () => !!$('#modal-root').children.length;

  // Tooltips for [[glossary]] terms and [data-tip]
  function initTooltips() {
    const tip = $('#tooltip');
    const show = (el) => {
      const text = el.getAttribute('data-def') || el.getAttribute('data-tip');
      if (!text) return;
      tip.textContent = text;
      tip.classList.add('show');
      const r = el.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 8;
      if (y < 4) y = r.bottom + 8;
      x = U.clamp(x, 6, window.innerWidth - tw - 6);
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    };
    const hide = () => tip.classList.remove('show');
    document.addEventListener('mouseover', (e) => { const el = e.target.closest('.term,[data-tip]'); if (el) show(el); });
    document.addEventListener('mouseout', (e) => { if (e.target.closest('.term,[data-tip]')) hide(); });
    document.addEventListener('focusin', (e) => { const el = e.target.closest('.term,[data-tip]'); if (el) show(el); });
    document.addEventListener('focusout', hide);
    document.addEventListener('click', (e) => { const el = e.target.closest('.term'); if (el) show(el); else hide(); });
  }

  // ---------- cards ----------
  function cardHTML(c, opts) {
    opts = opts || {};
    if (c == null || opts.back) return `<div class="card back ${opts.cls || ''}"></div>`;
    const r = C.rankOf(c), s = C.suitOf(c);
    const rs = r === 10 ? '10' : C.RANKS[r - 2];
    const four = FS.store.get().settings.fourColor;
    const colorCls = four ? (s === 1 ? 'red' : s === 2 ? 'four-d' : s === 3 ? 'four-c' : '') : (s === 1 || s === 2 ? 'red' : '');
    const g = C.SUIT_GLYPH[s];
    return `<div class="card ${colorCls} ${opts.cls || ''}" data-card="${c}" aria-label="${C.RANK_NAME[r]} of ${['spades', 'hearts', 'diamonds', 'clubs'][s]}"><div class="ci"><span>${rs}</span><span class="s">${g}</span></div><div class="cc">${g}</div></div>`;
  }
  function cardsInline(cards) { return cards.map((c) => cardHTML(c)).join(''); }

  // ---------- chips ----------
  const DENOMS = [[100000, '#e87a1e'], [25000, '#2f6fd6'], [5000, '#d63a3a'], [1000, '#e6b422'], [500, '#7b3fc4'], [100, '#262626'], [25, '#2fa84f'], [5, '#e84a8a'], [1, '#dddddd']];
  function chipsHTML(amount, maxCols) {
    maxCols = maxCols || 3;
    let rest = Math.round(amount);
    const cols = [];
    for (const [v, col] of DENOMS) {
      if (rest >= v) { const n = Math.floor(rest / v); rest -= n * v; cols.push([col, n]); }
      if (cols.length >= maxCols) break;
    }
    if (!cols.length) return '';
    return `<div class="chipstack">${cols.map(([col, n]) => {
      const k = Math.min(n, 7);
      let s = `<div class="chipcol" style="height:calc(var(--chiph, 18px) + ${k * 3}px)">`;
      for (let i = 0; i < k; i++) s += `<div class="chip" style="--cc:${col};bottom:${i * 3}px"></div>`;
      return s + '</div>';
    }).join('')}</div>`;
  }

  function portrait(id, expr) {
    const c = id === 'hero' ? FS.roster.HERO : FS.roster.byId[id];
    return c ? FS.avatars.portrait(c, expr, 160) : '';
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function feltTexture() {
    // low-res noise baked into a tiny tile, scaled up — the PS2 "texture" look
    const cv = document.createElement('canvas'); cv.width = cv.height = 96;
    const x = cv.getContext('2d');
    const img = x.createImageData(96, 96);
    const rng = U.makeRng(99);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (rng() - 0.5) * 70;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    document.documentElement.style.setProperty('--felt-tex', `url(${cv.toDataURL()})`);
  }

  FS.ui = { $, $$, h, showScreen, onScreen, toast, modal, anyModalOpen, initTooltips, cardHTML, cardsInline, chipsHTML, portrait, sleep, feltTexture, get current() { return current; } };
})(typeof window !== 'undefined' ? window : globalThis);
