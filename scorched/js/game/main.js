/* Scorched — app controller: the frame loop, input, and the flow between menu, shop, battle and
   results. The menu runs an all-CPU demo battle in the background. */
(function (root) {
  'use strict';
  const SE = root.SE;
  const { Game, C } = SE.game;
  const { clamp, DEG } = SE.util;
  const $ = (id) => document.getElementById(id);
  const ui = SE.ui;

  const canvas = $('view');
  const renderer = new SE.render.Renderer(canvas);
  let speedUp = false;
  try { speedUp = localStorage.getItem('scorched.speedUp') === '1'; } catch (e) { /* storage blocked */ }
  const app = { game: null, demo: null, paused: false, setup: ui.loadSetup(), shopQueue: [], resultsTimer: 0 };
  root.SE.app = app; // handy for debugging and the e2e tests

  // ---------- layout: fit the 16:9 battlefield into the window ----------

  function resize() {
    const vw = root.innerWidth, vh = root.innerHeight;
    const s = Math.min(vw / C.WIDTH, vh / C.HEIGHT);
    const f = $('frame');
    f.style.width = Math.floor(C.WIDTH * s) + 'px';
    f.style.height = Math.floor(C.HEIGHT * s) + 'px';
  }
  root.addEventListener('resize', resize);
  resize();

  // ---------- flow ----------

  function startDemo() {
    const names = ui.CPU_NAMES.slice(0, 5);
    const demo = new Game({ rounds: 9999, startCash: 40000, wind: 'medium', players: names.map((n, i) => ({ name: n, color: ui.COLORS[i + 1], ai: ['sniper', 'poolshark', 'shooter', 'poolshark', 'sniper'][i] })) });
    demo.on((type) => { if (type === 'roundOver') setTimeout(() => { if (app.demo === demo) { demo.aiShop(); demo.startRound(); } }, 1500); });
    demo.aiShop();
    demo.startRound();
    app.demo = demo; app.game = null;
    renderer.attach(demo);
  }

  function toMenu() {
    clearTimeout(app.resultsTimer);
    app.paused = false;
    $('hud').classList.add('hidden');
    ui.renderSetup(app.setup, startGame);
    ui.show('scr-menu');
    startDemo();
  }

  function startGame(setup) {
    SE.audio.init();
    const humans = setup.players.filter((p) => p.ai === 'human');
    const game = new Game({
      rounds: setup.rounds, startCash: setup.startCash, wind: setup.wind, windChanges: setup.windChanges,
      walls: setup.walls, terrain: setup.terrain,
      players: setup.players.map((p) => ({ name: p.name, color: p.color, ai: p.ai === 'human' ? null : p.ai })),
    });
    app.demo = null; app.game = game; app.paused = false;
    game.on(onGameEvent);
    renderer.attach(game);
    ui.resetHud();
    game.aiShop();
    if (setup.startCash > 0 && humans.length) shopThenRound(game, 'Stock up before the first round.');
    else beginRound(game);
  }

  function shopThenRound(game, sub) {
    app.shopQueue = game.players.filter((p) => !p.ai);
    const next = () => {
      const p = app.shopQueue.shift();
      if (!p) return beginRound(game);
      ui.renderShop(game, p, sub, next);
    };
    next();
  }

  function beginRound(game) {
    ui.hideAll();
    $('hud').classList.remove('hidden');
    game.startRound();
  }

  function onGameEvent(type, d) {
    const game = app.game;
    const A = SE.audio;
    switch (type) {
      case 'fire': A.play('fire'); break;
      case 'boom': A.play('boom', d.r); break;
      case 'dirt': A.play('dirt'); break;
      case 'fizzle': A.play('fizzle'); break;
      case 'split': A.play('split'); break;
      case 'napalm': A.play('napalm'); break;
      case 'dig': A.play('dig'); break;
      case 'death': {
        A.play('death');
        ui.banner(ui.isYou(d.player) ? 'You were destroyed!' : `${d.player.name} was destroyed!`, d.player.color, 1100);
        if (!d.player.ai && spectating(game) && game.alive().length > 1) {
          const out = game.players.filter((p) => !p.ai).length > 1 ? 'All humans are out' : (ui.isYou(d.player) ? "You're out" : `${d.player.name} is out`);
          setTimeout(() => { if (spectating(game)) ui.banner(`${out}. ⏩ (F) speeds up the rest of the round`, '#9fe0ff', 2600); }, 1300);
        }
        break;
      }
      case 'chute': A.play('chute'); break;
      case 'item': A.play(d.id === 'battery' ? 'buy' : 'shield'); break;
      case 'roundStart': ui.banner(`Round ${d.round}`, '#ffc23d', 1200); break;
      case 'turn': {
        if (d.player.ai) break;
        A.play('turn');
        if (game.players.filter((p) => !p.ai).length > 1 || game.turns > 1) setTimeout(() => { if (game.current === d.player && game.phase === 'aim') ui.banner(ui.isYou(d.player) ? 'Your turn' : `${d.player.name}'s turn`, d.player.color, 900); }, game.turns === 1 ? 1300 : 0);
        break;
      }
      case 'roundOver': {
        const winner = d.winner != null ? game.players[d.winner] : null;
        if (winner && !winner.ai) A.play('win');
        ui.banner(!winner ? 'Mutual destruction!' : ui.isYou(winner) ? 'You win the round!' : `${winner.name} wins the round!`, winner ? winner.color : '#fff', 1800);
        app.resultsTimer = setTimeout(() => showResults(game, d), 2000);
        break;
      }
    }
  }

  function showResults(game, summary) {
    if (app.game !== game) return;
    $('hud').classList.add('hidden');
    if (game.phase === 'gameOver') {
      ui.renderResults(game, summary, [
        ['Main menu', '', toMenu],
        ['Play again', 'primary', () => startGame(app.setup)],
      ]);
    } else {
      ui.renderResults(game, summary, [['Continue', 'primary', () => {
        game.aiShop();
        if (game.players.some((p) => !p.ai)) shopThenRound(game, `Round ${game.round + 1} of ${game.opts.rounds} is next.`);
        else beginRound(game);
      }]]);
    }
  }

  function setPaused(p) {
    if (!app.game) return;
    app.paused = p;
    $('p-sound').textContent = 'Sound: ' + (SE.audio.isMuted() ? 'off' : 'on');
    const g = app.game;
    $('p-skip').disabled = !(g.canAct() && !g.current.ai);
    ui.show(p ? 'scr-pause' : null);
  }
  $('p-resume').onclick = () => setPaused(false);
  $('p-sound').onclick = () => { SE.audio.setMuted(!SE.audio.isMuted()); $('p-sound').textContent = 'Sound: ' + (SE.audio.isMuted() ? 'off' : 'on'); };
  $('p-skip').onclick = () => { setPaused(false); app.game.skipTurn(); };
  $('p-quit').onclick = () => { app.game = null; toMenu(); };

  // ---------- input ----------

  /** True while a round is still being fought but no human tank is left in it. */
  function spectating(g) {
    return !!g && g === app.game && (g.phase === 'aim' || g.phase === 'flight') && !g.players.some((p) => !p.ai && p.alive);
  }
  function setSpeedUp(on) {
    speedUp = !!on;
    try { localStorage.setItem('scorched.speedUp', speedUp ? '1' : '0'); } catch (e) { /* storage blocked */ }
    SE.audio.play('click');
  }
  function syncSpeedButton() {
    const g = app.game, spec = spectating(g), b = $('hud-speed');
    $('hud').classList.toggle('spectating', spec);
    b.classList.toggle('hidden', !spec);
    b.textContent = speedUp ? '⏩ 3×' : '⏩ 1×';
    b.setAttribute('aria-pressed', String(speedUp));
  }

  const humanTurn = () => { const g = app.game; return g && !app.paused && g.canAct() && !g.current.ai && !document.querySelector('.overlay.active'); };

  // Continuous actions: [immediate step, rate per second once held].
  const RATES = {
    'angle+': [1, 40], 'angle-': [1, 40], 'power+': [5, 300], 'power-': [5, 300],
    'drive-': [0, 0], 'drive+': [0, 0],
  };
  const held = new Map(); // action -> {t: seconds held, fine}

  function applyStep(act, amount) {
    const g = app.game;
    if (act === 'angle+') g.adjustAim(amount, 0);
    else if (act === 'angle-') g.adjustAim(-amount, 0);
    else if (act === 'power+') g.adjustAim(0, amount);
    else if (act === 'power-') g.adjustAim(0, -amount);
  }
  function press(act, fine) {
    if (!humanTurn()) return;
    if (RATES[act]) {
      if (held.has(act)) return;
      held.set(act, { t: 0, fine });
      applyStep(act, RATES[act][0] * (fine ? 0.2 : 1));
      return;
    }
    const g = app.game;
    if (act === 'fire') g.fire();
    else if (act === 'weapon+') { g.cycleWeapon(1); SE.audio.play('click'); }
    else if (act === 'weapon-') { g.cycleWeapon(-1); SE.audio.play('click'); }
    else if (act.startsWith('item:')) { if (!g.useItem(act.slice(5))) SE.audio.play('deny'); }
    else if (act === 'shield') { if (!g.useItem('heavyshield') && !g.useItem('shield')) SE.audio.play('deny'); }
    else if (act === 'battery') { if (!g.useItem('battery')) SE.audio.play('deny'); }
  }
  function release(act) { held.delete(act); }

  function tickHeld(dt) {
    if (!held.size) return;
    if (!humanTurn()) { held.clear(); return; }
    for (const [act, h] of held) {
      h.t += dt;
      if (act === 'drive-' || act === 'drive+') { app.game.drive(act === 'drive+' ? 1 : -1, dt); continue; }
      if (h.t > 0.28) applyStep(act, RATES[act][1] * dt * (h.fine ? 0.15 : 1) * Math.min(2.5, 1 + (h.t - 0.28)));
    }
  }

  const KEYMAP = {
    ArrowLeft: 'angle+', ArrowRight: 'angle-', ArrowUp: 'power+', ArrowDown: 'power-',
    KeyA: 'drive-', KeyD: 'drive+', Space: 'fire', Enter: 'fire', KeyS: 'shield', KeyB: 'battery',
  };
  let fastForward = false;
  root.addEventListener('keydown', (e) => {
    SE.audio.init();
    if (document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
    if (e.code === 'Escape' || e.code === 'KeyP') { if (app.game && app.game.phase !== 'roundOver' && app.game.phase !== 'gameOver' && !document.querySelector('#scr-shop.active, #scr-results.active')) setPaused(!app.paused); return; }
    if (e.code === 'KeyM') { SE.audio.setMuted(!SE.audio.isMuted()); ui.banner(SE.audio.isMuted() ? 'Sound off' : 'Sound on', '#fff', 700); return; }
    if (e.code === 'KeyF') { if (spectating(app.game)) { if (!e.repeat) setSpeedUp(!speedUp); } else fastForward = true; return; }
    if (e.code === 'Tab') { e.preventDefault(); if (!e.repeat) press(e.shiftKey ? 'weapon-' : 'weapon+'); return; }
    const act = KEYMAP[e.code];
    if (!act) return;
    if (document.querySelector('.overlay.active')) return; // let buttons handle Enter/Space
    e.preventDefault();
    if (e.repeat && !RATES[act]) return;
    press(act, e.shiftKey);
  });
  root.addEventListener('keyup', (e) => {
    if (e.code === 'KeyF') fastForward = false;
    const act = KEYMAP[e.code]; if (act) release(act);
  });
  root.addEventListener('blur', () => { held.clear(); fastForward = false; });

  // HUD buttons: tap or hold.
  const hud = $('hud');
  ui.buildHud((act) => press(act));
  hud.addEventListener('pointerdown', (e) => {
    SE.audio.init();
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'pause') { setPaused(true); return; }
    if (act === 'speed') { e.preventDefault(); setSpeedUp(!speedUp); return; }
    e.preventDefault();
    press(act, false);
    if (RATES[act]) {
      const up = () => { release(act); root.removeEventListener('pointerup', up); root.removeEventListener('pointercancel', up); };
      root.addEventListener('pointerup', up); root.addEventListener('pointercancel', up);
    }
  });

  // Drag on the battlefield to aim: direction sets the angle, distance sets the power.
  let dragging = false;
  function aimAt(e) {
    const g = app.game, t = g.current;
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * (g.w / r.width), y = (e.clientY - r.top) * (g.h / r.height);
    const dx = x - t.x, dy = (t.y - C.PIVOT_UP) - y;
    let a = Math.atan2(dy, dx) / DEG;
    if (a < 0) a = dx >= 0 ? 0 : 180;
    g.setAim(a, clamp(Math.hypot(dx, dy) / 300, 0, 1) * 1000);
  }
  canvas.addEventListener('pointerdown', (e) => {
    SE.audio.init();
    if (!humanTurn()) return;
    dragging = true; canvas.setPointerCapture(e.pointerId); aimAt(e);
  });
  canvas.addEventListener('pointermove', (e) => { if (dragging && humanTurn()) aimAt(e); });
  const endDrag = () => { dragging = false; };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);

  // ---------- frame loop ----------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const g = app.game || app.demo;
    if (g && !app.paused) {
      tickHeld(dt);
      const aiTurnOrFlight = app.game && (g.phase === 'flight' || (g.current && g.current.ai));
      const fast = (spectating(g) && speedUp) || (fastForward && aiTurnOrFlight);
      g.update(dt * (fast ? 3 : 1));
      renderer.showAim = true;
      renderer.draw(dt);
      if (app.game) { ui.updateHud(app.game); syncSpeedButton(); }
    } else if (g) renderer.draw(0);
    requestAnimationFrame(frame);
  }

  toMenu();
  requestAnimationFrame(frame);
})(typeof globalThis !== 'undefined' ? globalThis : this);
