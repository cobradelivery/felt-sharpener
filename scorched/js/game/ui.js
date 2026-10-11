/* Scorched — DOM screens: setup, shop, round results, HUD and the turn banner. */
(function (root) {
  'use strict';
  const SE = root.SE || (root.SE = {});
  const { money } = SE.util;
  const W = SE.weapons;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  /** The default human is literally named "You", so messages need second-person grammar for them. */
  const isYou = (p) => /^you$/i.test(String(p.name).trim());
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const COLORS = ['#ff4b4b', '#4aa8ff', '#5be05b', '#ffd23a', '#d35bff', '#3fe3cf', '#ff8f2a', '#f2f2f2', '#ff6fb5', '#a0ff4a'];
  const CPU_NAMES = ['Boomer', 'Crater', 'Shrapnel', 'Kaboom', 'Dusty', 'Mortimer', 'Ricochet', 'Napalm Ned', 'Sarge', 'Big Bertha', 'Howitzer', 'Ballistic Barb'];
  const TYPES = [['human', 'Human'], ['moron', 'CPU: Moron'], ['shooter', 'CPU: Shooter'], ['poolshark', 'CPU: Poolshark'], ['sniper', 'CPU: Sniper']];
  const OPTS = [
    ['rounds', 'Rounds', [[1, '1'], [3, '3'], [5, '5'], [10, '10'], [15, '15'], [20, '20']]],
    ['startCash', 'Starting cash', [[0, '$0'], [5000, '$5,000'], [10000, '$10,000'], [25000, '$25,000'], [50000, '$50,000'], [100000, '$100,000']]],
    ['wind', 'Wind', [['none', 'None'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'Gale']]],
    ['windChanges', 'Wind shifts', [[true, 'Every turn'], [false, 'Per round']]],
    ['walls', 'Side walls', [['open', 'Open (shots fly off)'], ['wrap', 'Wrap around'], ['bounce', 'Bounce']]],
    ['terrain', 'Terrain', [['random', 'Random'], ['rolling', 'Rolling hills'], ['mountains', 'Mountains'], ['plains', 'Plains'], ['canyon', 'Canyon'], ['islands', 'Islands']]],
  ];

  function defaultSetup() {
    return {
      players: [
        { name: 'You', color: COLORS[0], ai: 'human' },
        { name: 'Boomer', color: COLORS[1], ai: 'shooter' },
        { name: 'Crater', color: COLORS[2], ai: 'shooter' },
        { name: 'Shrapnel', color: COLORS[3], ai: 'poolshark' },
      ],
      rounds: 5, startCash: 10000, wind: 'medium', windChanges: true, walls: 'open', terrain: 'random',
    };
  }
  function loadSetup() {
    try {
      const s = JSON.parse(localStorage.getItem('scorched.setup'));
      if (s && Array.isArray(s.players) && s.players.length >= 2) return Object.assign(defaultSetup(), s);
    } catch (e) { /* storage blocked or corrupt */ }
    return defaultSetup();
  }
  function saveSetup(s) { try { localStorage.setItem('scorched.setup', JSON.stringify(s)); } catch (e) { /* storage blocked */ } }

  // ---------- screens ----------

  function show(id) {
    for (const s of document.querySelectorAll('.overlay')) s.classList.toggle('active', s.id === id);
  }
  function hideAll() { show(null); }

  // ---------- setup ----------

  function renderSetup(setup, onStart) {
    const list = $('setup-players');
    const draw = () => {
      list.innerHTML = '';
      setup.players.forEach((p, i) => {
        const row = el('div', 'prow');
        const cb = el('button', 'color-btn'); cb.style.background = p.color; cb.title = 'Change colour';
        cb.onclick = () => { const used = setup.players.map((q) => q.color); let k = COLORS.indexOf(p.color);
          do { k = (k + 1) % COLORS.length; } while (used.includes(COLORS[k]) && used.length < COLORS.length); p.color = COLORS[k]; draw(); };
        const nm = el('input'); nm.value = p.name; nm.maxLength = 16; nm.setAttribute('aria-label', 'Player name');
        nm.oninput = () => { p.name = nm.value; };
        const ty = el('select'); ty.setAttribute('aria-label', 'Player type');
        for (const [v, l] of TYPES) { const o = el('option', null, l); o.value = v; ty.appendChild(o); }
        ty.value = p.ai; ty.onchange = () => { p.ai = ty.value; };
        const rm = el('button', 'rm', '✕'); rm.title = 'Remove'; rm.disabled = setup.players.length <= 2;
        rm.onclick = () => { setup.players.splice(i, 1); draw(); };
        row.append(cb, nm, ty, rm); list.appendChild(row);
      });
      $('add-player').disabled = setup.players.length >= 8;
    };
    $('add-player').onclick = () => {
      if (setup.players.length >= 8) return;
      const used = setup.players.map((q) => q.color), names = setup.players.map((q) => q.name);
      setup.players.push({ name: CPU_NAMES.find((n) => !names.includes(n)) || 'CPU', color: COLORS.find((c) => !used.includes(c)), ai: 'shooter' });
      draw();
    };
    const opts = $('setup-opts'); opts.innerHTML = '';
    for (const [key, label, choices] of OPTS) {
      const lab = el('label', null, label); lab.htmlFor = 'opt-' + key;
      const sel = el('select'); sel.id = 'opt-' + key;
      choices.forEach(([v, l], i) => { const o = el('option', null, l); o.value = String(i); if (v === setup[key]) o.selected = true; sel.appendChild(o); });
      sel.onchange = () => { setup[key] = choices[+sel.value][0]; };
      opts.append(lab, sel);
    }
    $('start-game').onclick = () => {
      setup.players.forEach((p, i) => { p.name = (p.name || '').trim() || (p.ai === 'human' ? 'Player ' + (i + 1) : 'CPU ' + (i + 1)); });
      saveSetup(setup); onStart(setup);
    };
    draw();
  }

  // ---------- shop ----------

  function renderShop(game, player, sub, onDone) {
    let tab = 'weapon';
    $('shop-swatch').style.background = player.color;
    $('shop-title').textContent = isYou(player) ? 'Your Arms Dealer' : player.name + "'s Arms Dealer";
    $('shop-sub').textContent = sub;
    const grid = $('shop-grid');
    const draw = () => {
      $('shop-cash').textContent = money(player.cash);
      for (const t of document.querySelectorAll('#shop-tabs .tab')) t.classList.toggle('active', t.dataset.tab === tab);
      grid.innerHTML = '';
      const list = (tab === 'weapon' ? W.WEAPONS : W.ITEMS).filter((x) => isFinite(x.qty));
      for (const it of list) {
        const card = el('div', 'card' + (player.cash < it.price ? ' cant' : ''));
        const cv = el('canvas'); cv.width = cv.height = 88; SE.render.drawIcon(cv, it.id);
        const own = player.inv[it.id];
        card.append(cv,
          el('div', 'nm', `<span>${esc(it.name)}</span><span class="own">${own ? (it.id === 'fuel' ? Math.round(own) : own) : ''}</span>`),
          el('div', 'ds', esc(it.desc)));
        const acts = el('div', 'acts', `<span class="price"><b>${money(it.price)}</b> for ${it.qty}</span>`);
        const sell = el('button', 'btn', 'Sell'); sell.disabled = !(own > 0);
        sell.onclick = () => { if (game.sell(player, it.id)) { SE.audio.play('click'); draw(); } };
        const buy = el('button', 'btn primary', 'Buy'); buy.disabled = player.cash < it.price;
        buy.onclick = () => { if (game.buy(player, it.id)) { SE.audio.play('buy'); draw(); } else SE.audio.play('deny'); };
        acts.append(sell, buy); card.appendChild(acts);
        grid.appendChild(card);
      }
    };
    for (const t of document.querySelectorAll('#shop-tabs .tab')) t.onclick = () => { tab = t.dataset.tab; draw(); };
    $('shop-done').onclick = () => { SE.audio.play('click'); onDone(); };
    draw(); show('scr-shop');
  }

  // ---------- results ----------

  function renderResults(game, summary, buttons) {
    const over = game.phase === 'gameOver';
    const winner = summary.winner != null ? game.players[summary.winner] : null;
    if (over) {
      const champ = game.standings()[0];
      $('res-title').textContent = isYou(champ) ? 'You win the war!' : `${champ.name} wins the war!`;
      $('res-sub').textContent = `Final standings after ${game.round} round${game.round > 1 ? 's' : ''}.`;
    } else {
      $('res-title').textContent = `Round ${summary.round} of ${game.opts.rounds}`;
      $('res-sub').textContent = !winner ? 'Nobody survived this round.' : isYou(winner) ? 'You are the last tank standing.' : `${winner.name} is the last tank standing.`;
    }
    const rows = over ? game.standings().map((p) => summary.rows.find((r) => r.id === p.id)) : summary.rows.slice().sort((a, b) => b.score - a.score);
    const body = $('res-body'); body.innerHTML = '';
    rows.forEach((r, i) => {
      const p = game.players[r.id];
      const tr = el('tr', (!over && !r.alive ? 'dead' : '') + (i === 0 ? ' top' : ''));
      tr.innerHTML = `<td><span class="swatch" style="background:${r.color};display:inline-block"></span></td><td>${esc(r.name)}${p.ai ? ' <small style="color:var(--muted)">' + SE.ai.LEVELS[p.ai].label + '</small>' : ''}</td>` +
        `<td>${over ? Math.round(p.damageDealt) : r.damage}</td><td>${over ? p.kills : r.kills}</td><td>${r.earned >= 0 ? '+' : ''}${money(r.earned).replace('$-', '-$')}</td>` +
        `<td>${money(r.cash)}</td><td>${p.wins}</td><td>${r.score}</td>`;
      body.appendChild(tr);
    });
    const foot = $('res-foot'); foot.innerHTML = '';
    for (const [label, cls, fn] of buttons) { const b = el('button', 'btn ' + cls, label); b.onclick = () => { SE.audio.play('click'); fn(); }; foot.appendChild(b); }
    show('scr-results');
    const first = foot.querySelector('.primary'); if (first) first.focus();
  }

  // ---------- HUD ----------

  const HUD_ITEMS = ['shield', 'heavyshield', 'battery', 'parachute'];
  let hudKey = '';
  function buildHud(onAct) {
    const box = $('hud-items'); box.innerHTML = '';
    for (const id of HUD_ITEMS) {
      const b = el('button', 'item-btn'); b.dataset.item = id; b.title = W.get(id).name + (id === 'parachute' ? ' (automatic)' : '');
      const cv = el('canvas'); cv.width = cv.height = 44; SE.render.drawIcon(cv, id);
      b.append(cv, el('span', null, '0'));
      if (id !== 'parachute') b.onclick = () => onAct('item:' + id);
      box.appendChild(b);
    }
    const fuel = el('div', 'hud-group');
    const l = el('button', 'hb', '◀'); l.dataset.act = 'drive-'; l.title = 'Drive left (A)';
    const f = el('button', 'item-btn'); f.title = 'Fuel'; f.disabled = true;
    const cv = el('canvas'); cv.width = cv.height = 44; SE.render.drawIcon(cv, 'fuel');
    f.append(cv, el('span', null, '0')); f.dataset.item = 'fuel';
    const r = el('button', 'hb', '▶'); r.dataset.act = 'drive+'; r.title = 'Drive right (D)';
    fuel.append(l, f, r); box.appendChild(fuel);
  }

  function updateHud(game) {
    const t = game.current;
    if (!t) return;
    const wp = W.get(t.weapon);
    const key = [t.id, t.angle.toFixed(1), Math.round(t.power), t.weapon, t.inv[t.weapon], Math.floor(t.cash), game.wind, game.round,
      t.shield > 0, Math.round(t.health), Math.round(t.inv.fuel), HUD_ITEMS.map((i) => t.inv[i]).join(), game.phase].join('|');
    if (key === hudKey) return;
    hudKey = key;
    $('hud').classList.toggle('ai-turn', !!t.ai || game.phase !== 'aim');
    $('hud-swatch').style.background = t.color;
    $('hud-name').textContent = t.name + (t.ai ? ' (CPU)' : '');
    $('hud-cash').textContent = money(t.cash) + ' · ♥ ' + Math.ceil(t.health);
    let a = t.angle;
    $('hud-angle').textContent = (a > 90 ? '↖ ' + (180 - a).toFixed(0) : (a < 90 ? '↗ ' + a.toFixed(0) : '↑ 90')) + '°';
    $('hud-power').textContent = Math.round(t.power);
    $('hud-power-bar').style.width = (t.power / 10) + '%';
    $('hud-wname').textContent = wp.name;
    $('hud-wcount').textContent = isFinite(t.inv[t.weapon]) ? '× ' + t.inv[t.weapon] : '∞';
    SE.render.drawIcon($('hud-wicon'), t.weapon);
    for (const b of document.querySelectorAll('#hud-items .item-btn')) {
      const id = b.dataset.item, n = t.inv[id];
      b.querySelector('span').textContent = id === 'fuel' ? Math.round(n) : n;
      if (id !== 'fuel') b.disabled = !(n > 0) || id === 'parachute';
      b.classList.toggle('on', (id === 'shield' || id === 'heavyshield') && t.shield > 0 && t.shieldMax === W.get(id).strength);
    }
    const wnd = game.wind;
    $('hud-wind').textContent = Math.abs(wnd);
    const arrow = $('hud-wind-arrow');
    arrow.textContent = wnd === 0 ? '•' : wnd > 0 ? '→' : '←';
    arrow.style.transform = `scale(${1 + Math.min(1, Math.abs(wnd) / 100)})`;
    $('hud-round').textContent = `Round ${game.round}/${game.opts.rounds}`;
  }

  let bannerTimer = 0;
  function banner(text, color, ms) {
    const b = $('banner');
    b.textContent = text; b.style.color = color || '#fff';
    b.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.remove('show'), ms || 1300);
  }

  SE.ui = { isYou, COLORS, CPU_NAMES, loadSetup, renderSetup, renderShop, renderResults, buildHud, updateHud, banner, show, hideAll, resetHud: () => { hudKey = ''; } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
