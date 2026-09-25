/* Menus and screens: title, setup, pause menu, lobby, settings, roster, stats, results. */
(function (root) {
  'use strict';
  const FS = root.FS;
  const { $, $$, h, modal, toast } = FS.ui;
  const U = FS.util, TM = FS.tournament;
  const fc = U.fmtChips;
  const S = () => FS.store.get().settings;

  // ---------- title ----------
  let titleAnim = null;
  function titleCanvas() {
    const cv = $('#title-canvas');
    const ctx = cv.getContext('2d');
    const chips = [
      { m: FS.avatars.chipMesh('#c02828'), x: 0.16, y: 0.3, s: 0.12, sp: 0.9, ph: 0 },
      { m: FS.avatars.chipMesh('#1f58c8'), x: 0.84, y: 0.26, s: 0.1, sp: -1.1, ph: 1 },
      { m: FS.avatars.chipMesh('#1d8a3a'), x: 0.12, y: 0.78, s: 0.085, sp: 1.3, ph: 2 },
      { m: FS.avatars.chipMesh('#111111'), x: 0.88, y: 0.74, s: 0.11, sp: -0.8, ph: 3 },
    ];
    const suits = ['♠', '♥', '♦', '♣'];
    const floaters = Array.from({ length: 16 }, (_, i) => ({ x: Math.random(), y: Math.random(), v: 0.02 + Math.random() * 0.04, s: suits[i % 4], r: Math.random() * 6 }));
    let last = performance.now();
    function frame(t) {
      if (FS.ui.current !== 'title') { titleAnim = null; return; }
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      const w = cv.clientWidth, hh = cv.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, hh);
      // light rays
      ctx.save(); ctx.translate(w / 2, hh * 0.42); ctx.rotate(t / 9000);
      for (let i = 0; i < 12; i++) {
        ctx.rotate(Math.PI / 6);
        const g = ctx.createLinearGradient(0, 0, Math.max(w, hh), 0);
        g.addColorStop(0, 'rgba(120,180,255,0.10)'); g.addColorStop(1, 'rgba(120,180,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.max(w, hh), -60); ctx.lineTo(Math.max(w, hh), 60); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      // floating suits
      ctx.font = 'bold 28px "Arial Black", sans-serif';
      for (const f of floaters) {
        f.y -= f.v * dt; if (f.y < -0.1) { f.y = 1.1; f.x = Math.random(); }
        ctx.save(); ctx.translate(f.x * w, f.y * hh); ctx.rotate(Math.sin(t / 2000 + f.r) * 0.5);
        ctx.fillStyle = f.s === '♥' || f.s === '♦' ? 'rgba(255,90,90,0.18)' : 'rgba(200,220,255,0.14)';
        ctx.fillText(f.s, 0, 0); ctx.restore();
      }
      // spinning chips (software 3D)
      for (const c of chips) {
        const size = Math.min(w, hh) * c.s * 2.6;
        const sub = c.sub || (c.sub = document.createElement('canvas'));
        if (sub.width !== Math.round(size)) sub.width = sub.height = Math.round(size);
        const sctx = sub.getContext('2d');
        sctx.clearRect(0, 0, sub.width, sub.height);
        FS.avatars.render(c.m, sctx, sub.width, sub.height, { yaw: t / 1000 * c.sp + c.ph, pitch: 0.9 + Math.sin(t / 1400 + c.ph) * 0.35, dist: 4, fov: 2.6, light: [-0.4, 0.8, 0.6] });
        ctx.drawImage(sub, c.x * w - size / 2, c.y * hh - size / 2 + Math.sin(t / 900 + c.ph) * 8);
      }
      titleAnim = requestAnimationFrame(frame);
    }
    if (!titleAnim) titleAnim = requestAnimationFrame(frame);
  }

  let menuSel = 0;
  function menuItems() {
    const st = FS.store.get();
    const items = [];
    if (st.tourney) {
      let sub = 'Pick up where you left off';
      try { const T = JSON.parse(st.tourney); sub = `${T.field}-player · Level ${T.level + 1} · ${TM.alive(T).length} left`; } catch (e) { /* ignore */ }
      items.push({ id: 'continue', label: 'Continue Tournament', sub, act: () => FS.game.resume() });
    }
    items.push({ id: 'new', label: 'New Tournament', sub: 'Multi-table tournament with the regulars', act: () => FS.ui.showScreen('setup') });
    items.push({ id: 'sng', label: 'Quick Sit & Go', sub: '9 players, one table, turbo blinds', act: () => { if (confirmOverwrite()) FS.game.start({ field: 9, speed: 'turbo', difficulty: S().lastSetup.difficulty || 'casino' }); } });
    items.push({ id: 'learn', label: 'Learn the Game', sub: 'Rules, hand rankings, strategy, live etiquette', act: () => FS.ui.showScreen('learn') });
    items.push({ id: 'roster', label: 'The Regulars', sub: 'Meet your 48 opponents', act: () => FS.ui.showScreen('roster') });
    items.push({ id: 'stats', label: 'Your Progress', sub: 'Results, stats and past hands', act: () => FS.ui.showScreen('stats') });
    items.push({ id: 'settings', label: 'Settings', sub: 'Audio, coach, AI endpoint', act: () => settings() });
    return items;
  }
  function confirmOverwrite() {
    if (!FS.store.get().tourney) return true;
    return window.confirm('Starting a new tournament will abandon the one in progress. Continue?');
  }
  function renderMenu() {
    const nav = $('#main-menu');
    const items = menuItems();
    menuSel = Math.min(menuSel, items.length - 1);
    nav.innerHTML = items.map((it, i) => `<button class="menu-item ${i === menuSel ? 'sel' : ''}" data-i="${i}" data-id="${it.id}">${U.esc(it.label)}<small>${U.esc(it.sub)}</small></button>`).join('');
    $$('.menu-item', nav).forEach((b) => {
      b.onclick = () => { FS.audio.sfx.select(); items[+b.dataset.i].act(); };
      b.onmouseenter = () => { if (menuSel !== +b.dataset.i) { menuSel = +b.dataset.i; $$('.menu-item', nav).forEach((x, j) => x.classList.toggle('sel', j === menuSel)); FS.audio.sfx.blip(); } };
    });
  }
  function pressStart() {
    FS.audio.init();
    FS.audio.setVolumes(pickAudio());
    FS.audio.startMusic();
    FS.audio.sfx.select();
    $('#press-start').classList.add('hidden');
    $('#main-menu').classList.remove('hidden');
    renderMenu();
    setTimeout(() => { const b = $('.menu-item.sel'); if (b) b.focus(); }, 50);
    updateSong();
  }
  function updateSong() { const el = $('#title-song'); if (el && FS.audio.playing) el.textContent = '♪ Now playing: ' + FS.audio.songName; }
  function pickAudio() { const s = S(); return { music: s.music, sfx: s.sfx, vox: s.vox, muted: s.muted }; }

  document.addEventListener('keydown', (e) => {
    if (FS.ui.current !== 'title' || FS.ui.anyModalOpen()) return;
    const menuOpen = !$('#main-menu').classList.contains('hidden');
    if (!menuOpen) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pressStart(); } return; }
    const n = menuItems().length;
    if (e.key === 'ArrowDown') { menuSel = (menuSel + 1) % n; FS.audio.sfx.blip(); renderMenu(); $('.menu-item.sel').focus(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { menuSel = (menuSel - 1 + n) % n; FS.audio.sfx.blip(); renderMenu(); $('.menu-item.sel').focus(); e.preventDefault(); }
  });

  // ---------- setup ----------
  function renderSetup() {
    const ls = S().lastSetup;
    const sel = { field: ls.field || 27, speed: ls.speed || 'standard', difficulty: ls.difficulty || 'casino', coach: ls.coach || 'full' };
    const body = $('#setup-body');
    const row = (key, label, opts) => `<div class="opt-row"><label>${label}</label><div class="opt-choices" data-key="${key}">${opts.map(([v, t, sub]) => `<button class="opt ${String(sel[key]) === String(v) ? 'sel' : ''}" data-v="${v}">${t}${sub ? `<small>${sub}</small>` : ''}</button>`).join('')}</div></div>`;
    const draw = () => {
      const payouts = TM.payoutTable(sel.field, 100);
      const hands = TM.SPEEDS[sel.speed].hands;
      body.innerHTML =
        row('field', 'Field size', [[9, '9', 'Sit & Go'], [18, '18', '2 tables'], [27, '27', '3 tables'], [45, '45', '5 tables']]) +
        row('speed', 'Blind speed', [['turbo', 'Turbo', '6 hands/level'], ['standard', 'Standard', '10 hands/level'], ['deep', 'Deep', '15 hands/level']]) +
        row('difficulty', 'Opponents', Object.entries(TM.DIFFICULTY).map(([k, d]) => [k, d.label.split(' ').slice(-2).join(' '), k === 'friendly' ? 'lots of loose players' : k === 'casino' ? 'a realistic mix' : 'tough regulars'])) +
        row('coach', 'Coaching', [['full', 'Full', 'all 3 levels + ★'], ['guided', 'Guided', 'levels 1–2'], ['light', 'Light', 'big picture only'], ['off', 'Off', 'test yourself']]) +
        `<div class="setup-summary">Buy-in <b>$100</b> (practice money) · Prize pool <b>${U.fmtMoney(sel.field * 100)}</b> · <b>${payouts.length}</b> places paid: ${payouts.map((p, i) => `${U.ordinal(i + 1)} ${U.fmtMoney(p)}`).join(', ')}.<br>
          Everyone starts with <b>20,000</b> chips (100 big blinds). Blinds rise every <b>${hands}</b> hands you play. Other tables play in the background; players get moved as tables break.<br>
          <span class="muted">Coaching can be changed any time during play (press H or use the switches in the Coach panel).</span></div>
        <div class="setup-actions"><button class="btn" data-nav="title">Cancel</button><button class="btn gold" id="setup-go" style="font-size:16px;padding:12px 26px">SHUFFLE UP & DEAL ▶</button></div>`;
      $$('.opt-choices', body).forEach((g) => $$('.opt', g).forEach((b) => (b.onclick = () => { sel[g.dataset.key] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v; FS.audio.sfx.blip(); draw(); })));
      $('[data-nav]', body).onclick = () => { FS.audio.sfx.back(); FS.ui.showScreen('title'); };
      $('#setup-go').onclick = () => {
        if (!confirmOverwrite()) return;
        S().lastSetup = Object.assign({}, sel);
        const hs = S().hints;
        const preset = { full: [1, 1, 1, 1], guided: [1, 1, 0, 0], light: [1, 0, 0, 0], off: [0, 0, 0, 0] }[sel.coach];
        hs.big = !!preset[0]; hs.table = !!preset[1]; hs.hand = !!preset[2]; hs.rec = !!preset[3];
        FS.store.save(true);
        FS.game.start({ field: sel.field, speed: sel.speed, difficulty: sel.difficulty });
      };
    };
    draw();
  }

  // ---------- in-game menus ----------
  function pauseMenu() {
    const m = modal('Paused', `<div style="display:flex;flex-direction:column;gap:10px;max-width:360px;margin:0 auto">
      <button class="btn gold" data-a="resume">▶ Resume</button>
      <button class="btn" data-a="lobby">🏆 Tournament lobby</button>
      <button class="btn" data-a="learn">📖 Glossary</button>
      <button class="btn" data-a="settings">⚙ Settings</button>
      <button class="btn red" data-a="quit">Save & quit to title</button>
      <p class="small-note">Progress is saved after every hand. Quitting mid-hand replays the current hand’s deal when you continue.</p></div>`);
    m.body.onclick = (e) => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      m.close();
      if (a.dataset.a === 'lobby') lobby();
      if (a.dataset.a === 'settings') settings();
      if (a.dataset.a === 'learn') glossaryModal();
      if (a.dataset.a === 'quit') { FS.game.stop(); FS.ui.showScreen('title'); }
    };
  }
  function glossaryModal() {
    const G = FS.coach.GLOSSARY;
    modal('Glossary', `<table class="grid">${Object.keys(G).sort((a, b) => a.localeCompare(b)).map((k) => `<tr><td style="white-space:nowrap"><b>${U.esc(k)}</b></td><td>${U.esc(G[k])}</td></tr>`).join('')}</table>`, { wide: true });
  }

  function lobby() {
    const T = FS.game.G.T;
    if (!T) return;
    const lv = TM.blinds(T);
    const standings = T.players.slice().sort((a, b) => (a.busted - b.busted) || (b.stack - a.stack) || ((a.finish || 0) - (b.finish || 0)));
    const tableOf = (id) => { const t = T.tables.find((tb) => tb.seats.includes(id)); return t ? t.id : '—'; };
    const body = h(`<div>
      <div class="side-tabs" style="border-radius:8px;overflow:hidden;margin-bottom:10px">
        <button class="side-tab active" data-t="st">Standings</button><button class="side-tab" data-t="tb">Tables</button><button class="side-tab" data-t="bl">Blinds</button><button class="side-tab" data-t="po">Payouts</button></div>
      <div data-p="st"><table class="grid"><tr><th>#</th><th>Player</th><th>Style</th><th class="num">Chips</th><th class="num">BB</th><th class="num">Table</th></tr>
        ${standings.map((p, i) => `<tr class="${p.isHero ? 'me' : ''} ${p.busted ? 'busted' : ''}"><td>${p.busted ? U.ordinal(p.finish) : i + 1}</td><td>${U.esc(p.isHero ? S().heroName || 'You' : p.name)}</td><td>${p.isHero ? '' : FS.roster.STYLES[p.style].label}</td><td class="num">${p.busted ? (p.prize ? U.fmtMoney(p.prize) : 'out') : fc(p.stack)}</td><td class="num">${p.busted ? '' : (p.stack / lv.bb).toFixed(0)}</td><td class="num">${p.busted ? '' : tableOf(p.id)}</td></tr>`).join('')}</table></div>
      <div data-p="tb" class="hidden">${T.tables.map((t) => `<h3>Table ${t.id}${t.id === T.heroTableId ? ' (yours)' : ''}</h3><table class="grid">${t.seats.map((id, s) => id ? `<tr class="${id === 'hero' ? 'me' : ''}"><td>Seat ${s + 1}</td><td>${U.esc(id === 'hero' ? S().heroName || 'You' : TM.player(T, id).name)}</td><td class="num">${fc(TM.player(T, id).stack)}</td></tr>` : '').join('')}</table>`).join('')}</div>
      <div data-p="bl" class="hidden"><p class="small-note">Blinds go up every ${T.handsPerLevel} hands. “Ante” is a big-blind ante: the big blind pays it for everyone.</p><table class="grid"><tr><th>Level</th><th class="num">Small</th><th class="num">Big</th><th class="num">Ante</th><th class="num">Your stack in BB</th></tr>
        ${TM.LEVELS.slice(0, Math.max(T.level + 8, 12)).map((l, i) => `<tr class="${i === T.level ? 'cur' : ''}"><td>${i + 1}${i === T.level ? ' ◀ now' : ''}</td><td class="num">${fc(l.sb)}</td><td class="num">${fc(l.bb)}</td><td class="num">${l.ante ? fc(l.ante) : '—'}</td><td class="num">${(TM.hero(T).stack / l.bb).toFixed(1)}</td></tr>`).join('')}</table></div>
      <div data-p="po" class="hidden"><p>Prize pool ${U.fmtMoney(T.field * T.buyIn)} · ${T.payouts.length} places paid.</p><table class="grid"><tr><th>Place</th><th class="num">Prize</th></tr>${T.payouts.map((p, i) => `<tr><td>${U.ordinal(i + 1)}</td><td class="num">${U.fmtMoney(p)}</td></tr>`).join('')}</table></div>
    </div>`);
    $$('.side-tab', body).forEach((b) => (b.onclick = () => {
      $$('.side-tab', body).forEach((x) => x.classList.toggle('active', x === b));
      $$('[data-p]', body).forEach((p) => p.classList.toggle('hidden', p.dataset.p !== b.dataset.t));
    }));
    modal(`${T.name} — ${TM.alive(T).length} of ${T.field} left`, body, { wide: true });
  }

  // ---------- settings ----------
  function settings(tab) {
    const s = S();
    const body = h(`<div>
      <div class="side-tabs" style="border-radius:8px;overflow:hidden;margin-bottom:12px">
        <button class="side-tab" data-t="audio">Audio</button><button class="side-tab" data-t="play">Gameplay</button><button class="side-tab" data-t="coach">Coach</button><button class="side-tab" data-t="ai">AI Coach</button><button class="side-tab" data-t="data">Profile & Data</button></div>
      <div data-p="audio">
        <div class="form-row"><label>Music</label><input type="range" min="0" max="1" step="0.05" data-k="music" value="${s.music}"></div>
        <div class="form-row"><label>Sound effects</label><input type="range" min="0" max="1" step="0.05" data-k="sfx" value="${s.sfx}"></div>
        <div class="form-row"><label>Voices</label><input type="range" min="0" max="1" step="0.05" data-k="vox" value="${s.vox}"></div>
        <div class="form-row"><label>Mute everything</label><span class="switch ${s.muted ? 'on' : ''}" data-b="muted"></span></div>
        <div class="form-row"><label>Soundtrack</label><div><button class="btn small" id="st-next">⏭ Next tune</button> <span class="small-note" id="st-song">${FS.audio.playing ? FS.audio.songName : ''}</span></div></div>
        <div class="form-row"><label>Test sounds</label><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn small" data-snd="deal">Card</button><button class="btn small" data-snd="chip">Chips</button><button class="btn small" data-snd="shuffle">Shuffle</button><button class="btn small" data-snd="cheer">Cheer</button><button class="btn small" data-snd="grumble">Grumble</button></div></div>
      </div>
      <div data-p="play">
        <div class="form-row"><label>Game speed</label><select data-k="speed"><option value="slow">Slow (learning)</option><option value="normal">Normal</option><option value="fast">Fast</option><option value="turbo">Turbo</option></select></div>
        <div class="form-row"><label>Auto-deal next hand</label><span class="switch ${s.autoAdvance ? 'on' : ''}" data-b="autoAdvance"></span></div>
        <div class="form-row"><label>Confirm all-in</label><span class="switch ${s.confirmAllIn ? 'on' : ''}" data-b="confirmAllIn"></span></div>
        <div class="form-row"><label>Four-color deck</label><span class="switch ${s.fourColor ? 'on' : ''}" data-b="fourColor"></span></div>
        <p class="small-note">Keyboard: F fold · C check/call · R bet/raise · 1–6 bet-size presets · Space next hand · H hints · Esc menu.</p>
      </div>
      <div data-p="coach">
        <p class="small-note">Turn coaching down as you improve. These are the same switches as in the Coach panel.</p>
        <div class="form-row"><label>Level 1 · Big Picture</label><span class="switch ${s.hints.big ? 'on' : ''}" data-h="big"></span></div>
        <div class="form-row"><label>Level 2 · Table Read</label><span class="switch ${s.hints.table ? 'on' : ''}" data-h="table"></span></div>
        <div class="form-row"><label>Level 3 · Hand Coach</label><span class="switch ${s.hints.hand ? 'on' : ''}" data-h="hand"></span></div>
        <div class="form-row"><label>Show recommended action</label><span class="switch ${s.hints.rec ? 'on' : ''}" data-h="rec"></span></div>
        <div class="form-row"><label>Grade my decisions</label><span class="switch ${s.hints.feedback ? 'on' : ''}" data-h="feedback"></span></div>
      </div>
      <div data-p="ai">
        <p style="margin-top:0">The AI coach answers free-form questions using any <b>OpenAI-compatible</b> chat endpoint — your own local model (Ollama, LM Studio, llama.cpp, vLLM…) or a hosted provider.</p>
        <div class="form-row"><label>Route</label><select data-l="mode"><option value="auto">Auto (harness if available, else direct)</option><option value="harness">Local harness (server/harness.py)</option><option value="direct">Direct from browser</option></select></div>
        <div class="form-row"><label>Endpoint URL</label><input type="url" data-l="endpoint" placeholder="http://localhost:11434/v1" value="${U.esc(s.llm.endpoint)}"></div>
        <div class="form-row"><label>API key</label><input type="password" data-l="apiKey" placeholder="(leave blank for local servers)" value="${U.esc(s.llm.apiKey)}" autocomplete="off"></div>
        <div class="form-row"><label>Model</label><input type="text" data-l="model" placeholder="e.g. llama3.1:8b, qwen2.5:14b, gpt-4o-mini" value="${U.esc(s.llm.model)}"></div>
        <div class="form-row"><label>Temperature <span id="temp-v">${s.llm.temperature}</span></label><input type="range" min="0" max="1.2" step="0.05" data-l="temperature" value="${s.llm.temperature}"></div>
        <div class="form-row"><label></label><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn gold small" id="ai-test">Test connection</button><span id="ai-test-out" class="small-note"></span></div></div>
        <p class="small-note">Examples — Ollama: <code>http://localhost:11434/v1</code> · LM Studio: <code>http://localhost:1234/v1</code> · OpenAI: <code>https://api.openai.com/v1</code> · OpenRouter: <code>https://openrouter.ai/api/v1</code>.<br>
        Opening <code>index.html</code> directly? The browser calls the endpoint itself, so it must allow CORS (Ollama: set <code>OLLAMA_ORIGINS=*</code>; LM Studio: enable CORS). Running <code>python3 server/harness.py</code> avoids CORS entirely. Your key is stored only in this browser.</p>
        <details><summary class="small-note" style="cursor:pointer">View the coach prompt that wraps your questions</summary><pre class="prompt">${U.esc(FS.COACH_PROMPT || '')}</pre></details>
      </div>
      <div data-p="data">
        <div class="form-row"><label>Your name</label><input type="text" data-k="heroName" value="${U.esc(s.heroName)}" maxlength="18"></div>
        <div class="form-row"><label>Reset stats</label><div><button class="btn small red" id="reset-stats">Reset stats & records</button> <span class="small-note">Keeps your settings.</span></div></div>
        <div class="form-row"><label>Reset everything</label><div><button class="btn small red" id="reset-all">Erase all data</button></div></div>
      </div>
    </div>`);
    const m = modal('Settings', body, { wide: true, onClose: () => { FS.store.save(true); if (FS.ui.current === 'game') { FS.game.renderHUD(); FS.game.renderHintsPanel(); FS.game.renderChat(); } } });
    const show = (t) => { $$('.side-tab', body).forEach((x) => x.classList.toggle('active', x.dataset.t === t)); $$('[data-p]', body).forEach((p) => p.classList.toggle('hidden', p.dataset.p !== t)); };
    $$('.side-tab', body).forEach((b) => (b.onclick = () => show(b.dataset.t)));
    show(tab || 'audio');
    $('[data-k=speed]', body).value = s.speed;
    $('[data-l=mode]', body).value = s.llm.mode || 'auto';
    $$('[data-k]', body).forEach((inp) => (inp.oninput = inp.onchange = () => {
      const k = inp.dataset.k;
      s[k] = inp.type === 'range' ? +inp.value : inp.value;
      if (['music', 'sfx', 'vox'].includes(k)) FS.audio.setVolumes({ [k]: +inp.value });
      FS.store.save();
    }));
    $$('[data-b]', body).forEach((sw) => (sw.onclick = () => {
      const k = sw.dataset.b; s[k] = !s[k]; sw.classList.toggle('on', s[k]);
      if (k === 'muted') FS.audio.setVolumes({ muted: s.muted });
      FS.store.save();
    }));
    $$('[data-h]', body).forEach((sw) => (sw.onclick = () => { const k = sw.dataset.h; s.hints[k] = !s.hints[k]; sw.classList.toggle('on', s.hints[k]); FS.store.save(); }));
    $$('[data-l]', body).forEach((inp) => (inp.oninput = inp.onchange = () => {
      const k = inp.dataset.l;
      s.llm[k] = inp.type === 'range' ? +inp.value : inp.value.trim();
      if (k === 'temperature') $('#temp-v', body).textContent = inp.value;
      if (k === 'mode') FS.llm.resetHarnessCheck();
      FS.store.save();
    }));
    $('#st-next', body).onclick = () => { FS.audio.init(); if (!FS.audio.playing) FS.audio.startMusic(); else { FS.audio.stopMusic(); FS.audio.nextSong(); FS.audio.startMusic(); } $('#st-song', body).textContent = FS.audio.songName; updateSong(); };
    $$('[data-snd]', body).forEach((b) => (b.onclick = () => {
      const k = b.dataset.snd; FS.audio.init();
      if (k === 'deal') FS.audio.sfx.deal(); else if (k === 'chip') FS.audio.sfx.chip(5); else if (k === 'shuffle') FS.audio.sfx.shuffle();
      else if (k === 'cheer') FS.audio.vox.crowd('cheer'); else FS.audio.vox.say('grumble', { pitch: 100, timbre: 'm' });
    }));
    $('#ai-test', body).onclick = async () => {
      const out = $('#ai-test-out', body);
      out.textContent = 'Contacting the AI…';
      try {
        const r = await FS.llm.ask('Reply with one short friendly sentence confirming you are ready to coach Texas Hold\'em.', [], '(connection test — no game state)', s.llm);
        out.innerHTML = `<span style="color:var(--good)">✔ Connected via ${r.route}${r.model ? ' (' + U.esc(r.model) + ')' : ''}:</span> “${U.esc(r.reply.slice(0, 160))}”`;
      } catch (e) {
        out.innerHTML = `<span style="color:var(--bad)">✘ ${U.esc(e.message === 'NOT_CONFIGURED' ? 'Enter an endpoint URL first.' : e.message)}</span>`;
      }
    };
    $('#reset-stats', body).onclick = () => { if (confirm('Reset all stats, hand histories and opponent records?')) { FS.store.resetStatsKeepSettings(); toast('Stats reset'); m.close(); } };
    $('#reset-all', body).onclick = () => { if (confirm('Erase ALL data, including settings and any tournament in progress?')) { FS.game.stop(); FS.store.reset(); location.reload(); } };
  }

  // ---------- roster ----------
  function renderRoster() {
    const body = $('#roster-body');
    body.innerHTML = '<p class="small-note" style="grid-column:1/-1">Rendering portraits…</p>';
    setTimeout(() => {
      body.innerHTML = FS.roster.roster.map((c) => {
        const o = FS.store.opp(c.id), st = FS.roster.STYLES[c.style];
        const vpip = o.obs.hands ? Math.round(o.obs.vpip / o.obs.hands * 100) + '%' : '—';
        return `<div class="r-card panel"><div class="top"><img src="${FS.avatars.portrait(c, 'neutral', 160)}" alt="${U.esc(c.name)}">
          <div><h3>${U.esc(c.name)}</h3><div class="nick">“${U.esc(c.nick)}”</div><div class="from">${U.esc(c.from)}</div><span class="sty" style="display:inline-block;font-size:10px;text-transform:uppercase;padding:1px 6px;border-radius:6px;background:rgba(82,227,255,.18);color:var(--cyan);margin-top:3px">${st.label}</span></div></div>
          <p>${U.esc(c.bio)}</p><p><i>“${U.esc(c.quip)}”</i></p>
          <p class="muted" style="font-size:12px"><b>How they play:</b> ${U.esc(st.plain)}<br><b>How to beat them:</b> ${U.esc(st.exploit)}</p>
          <div class="rec">${!o.tourneys && !o.handsVsHero ? 'You haven’t played against them yet.' : `Tournaments with you: ${o.tourneys} · Wins: ${o.wins} · Best: ${o.bestFinish ? U.ordinal(o.bestFinish) : '—'}<br>Hands vs you: ${o.handsVsHero} · Plays ${vpip} of hands<br>Your net vs them: ${o.heroNet >= 0 ? '+' : ''}${fc(o.heroNet)} · KOs: you ${o.heroKnockedOut} / them ${o.knockedOutHero}`}</div></div>`;
      }).join('');
    }, 30);
  }

  // ---------- stats ----------
  function renderStats() {
    const st = FS.store.get();
    const H = st.hero;
    const g = H.grades, tot = (g.good || 0) + (g.ok || 0) + (g.mistake || 0) + (g.blunder || 0);
    const acc = tot ? Math.round(((g.good || 0) + (g.ok || 0) * 0.5) / tot * 100) + '%' : '—';
    const roi = H.totalBuyIns ? Math.round((H.totalPrize - H.totalBuyIns) / H.totalBuyIns * 100) + '%' : '—';
    const hist = H.history.slice(-20);
    const body = $('#stats-body');
    const seg = (n, col) => (tot && n ? `<div style="width:${n / tot * 100}%;background:${col}" title="${n}"></div>` : '');
    body.innerHTML = `
      <div class="kpis">
        <div class="kpi panel"><b>${H.tournaments}</b><span>Tournaments</span></div>
        <div class="kpi panel"><b>${H.cashes}</b><span>Cashes</span></div>
        <div class="kpi panel"><b>${H.wins}</b><span>Wins</span></div>
        <div class="kpi panel"><b>${H.bestFinish ? U.ordinal(H.bestFinish) : '—'}</b><span>Best finish</span></div>
        <div class="kpi panel"><b>${roi}</b><span>Return on buy-ins</span></div>
        <div class="kpi panel"><b>${acc}</b><span>Decision score</span></div>
      </div>
      <div class="section panel"><h2>How you play</h2>
        <p>Hands dealt: <b>${H.hands}</b> · Played voluntarily: <b>${H.hands ? Math.round(H.vpip / H.hands * 100) : 0}%</b> · Raised before the flop: <b>${H.hands ? Math.round(H.pfr / H.hands * 100) : 0}%</b></p>
        <p class="small-note">For a solid tournament player at a full table, “played” is typically around 15–25% and “raised” close behind (most hands you play, you should raise, not just call). Much higher means you’re too loose; much lower, too tight.</p>
        <p style="margin-top:12px">Decision grades (${tot} graded decisions):</p>
        <div class="gradebar">${seg(g.good, 'var(--good)')}${seg(g.ok, 'var(--ok)')}${seg(g.mistake, '#ff8a5b')}${seg(g.blunder, 'var(--bad)')}</div>
        <div class="legend"><span><i style="background:var(--good)"></i>Good ${g.good || 0}</span><span><i style="background:var(--ok)"></i>OK ${g.ok || 0}</span><span><i style="background:#ff8a5b"></i>Mistake ${g.mistake || 0}</span><span><i style="background:var(--bad)"></i>Big mistake ${g.blunder || 0}</span></div>
      </div>
      <div class="section panel"><h2>Recent tournaments</h2>
        ${hist.length ? `<div class="bars">${hist.map((r) => { const pctile = 1 - (r.finish - 1) / Math.max(1, r.field - 1); return `<div class="bar" style="height:${Math.max(6, pctile * 100)}%;${r.prize ? 'background:linear-gradient(180deg,var(--gold),#b86d00)' : ''}" title="${U.ordinal(r.finish)} of ${r.field}${r.prize ? ' · ' + U.fmtMoney(r.prize) : ''}"><span>${r.finish}</span></div>`; }).join('')}</div><p class="small-note">Bar height = how deep you went (gold = cashed). Number = finishing place.</p>` : '<p class="muted">No tournaments finished yet.</p>'}
      </div>
      <div class="section panel"><h2>Recent hands</h2>
        ${st.hands.length ? st.hands.slice().reverse().slice(0, 30).map((r, i) => `<div class="hist-item" data-i="${i}"><span>${new Date(r.t).toLocaleDateString()} · #${r.no} ${U.esc(r.title)}</span><span>${(r.grades || []).map((x) => `<span style="color:var(--${x.grade === 'good' ? 'good' : x.grade === 'ok' ? 'ok' : 'bad'})">●</span>`).join('')}</span></div>`).join('') : '<p class="muted">Play some hands!</p>'}
      </div>`;
    const recent = st.hands.slice().reverse().slice(0, 30);
    $$('.hist-item', body).forEach((it) => (it.onclick = () => FS.game.reviewHand(recent[+it.dataset.i])));
  }

  // ---------- results ----------
  function renderResults() {
    const st = FS.store.get();
    const body = $('#results-body');
    if (!st.lastResult) { body.innerHTML = '<p>No results.</p>'; return; }
    const { T, meta } = JSON.parse(st.lastResult);
    const hero = T.players.find((p) => p.id === 'hero');
    const g = meta.grades, tot = (g.good || 0) + (g.ok || 0) + (g.mistake || 0) + (g.blunder || 0);
    const acc = tot ? Math.round(((g.good || 0) + (g.ok || 0) * 0.5) / tot * 100) : null;
    const top = T.players.slice().sort((a, b) => a.finish - b.finish).slice(0, 10);
    const headline = hero.finish === 1 ? 'CHAMPION!' : hero.prize ? 'In the money!' : hero.finish <= T.payouts.length + 2 ? 'So close!' : 'Good game';
    body.innerHTML = `
      <div class="results-hero panel"><div class="chrome-title" style="font-size:26px">${headline}</div>
        <div class="place">${U.ordinal(hero.finish)}</div><div class="muted">of ${T.field} players</div>
        <div class="prize">${hero.prize ? 'You won <b style="color:var(--gold)">' + U.fmtMoney(hero.prize) + '</b>' : 'No cash this time — ' + (T.payouts.length) + ' places paid.'}</div></div>
      <div class="kpis">
        <div class="kpi panel"><b>${meta.hands}</b><span>Hands dealt</span></div>
        <div class="kpi panel"><b>${meta.hands ? Math.round(meta.vpip / meta.hands * 100) : 0}%</b><span>Hands played</span></div>
        <div class="kpi panel"><b>${meta.hands ? Math.round(meta.pfr / meta.hands * 100) : 0}%</b><span>Raised preflop</span></div>
        <div class="kpi panel"><b>${acc == null ? '—' : acc + '%'}</b><span>Decision score</span></div>
        <div class="kpi panel"><b>+${fc(meta.biggestWin)}</b><span>Biggest pot won</span></div>
      </div>
      <div class="section panel"><h2>Coach’s notes: mistakes to learn from</h2>
        ${meta.mistakes.length ? meta.mistakes.slice(-6).reverse().map((x) => `<div class="mistake-item"><b>Hand #${x.hand}</b> (${U.esc(x.cards)}, ${x.street}) — you ${x.took}, coach suggested ${U.esc(x.rec)}.<br>${FS.coach.glossaryHTML(x.text)}</div>`).join('') : '<p>No flagged mistakes. Nice discipline!</p>'}
      </div>
      <div class="section panel"><h2>Final standings</h2><table class="grid"><tr><th>Place</th><th>Player</th><th>Style</th><th class="num">Prize</th></tr>
        ${top.map((p) => `<tr class="${p.id === 'hero' ? 'me' : ''}"><td>${U.ordinal(p.finish)}</td><td>${U.esc(p.id === 'hero' ? S().heroName || 'You' : p.name)}</td><td>${p.id === 'hero' ? '' : FS.roster.STYLES[p.style].label}</td><td class="num">${p.prize ? U.fmtMoney(p.prize) : ''}</td></tr>`).join('')}</table></div>
      <div class="section panel" id="res-ai"><h2>AI coach review</h2><p class="muted">Get a personalised review of your tournament from the AI coach.</p><button class="btn gold" id="res-ask">Review my tournament</button><div id="res-ai-out" style="margin-top:10px"></div></div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:20px"><button class="btn gold" id="res-again" style="padding:12px 24px">Play again ▶</button><button class="btn" id="res-stats">Your progress</button><button class="btn" id="res-title">Title screen</button></div>`;
    $('#res-again').onclick = () => { const ls = S().lastSetup; FS.game.start({ field: T.field, speed: ls.speed, difficulty: ls.difficulty }); };
    $('#res-stats').onclick = () => FS.ui.showScreen('stats');
    $('#res-title').onclick = () => FS.ui.showScreen('title');
    $('#res-ask').onclick = async () => {
      const out = $('#res-ai-out');
      out.innerHTML = '<span class="spinner" style="display:inline-block"></span> The coach is reviewing your tournament…';
      const ctx = [
        `TOURNAMENT RESULT: finished ${U.ordinal(hero.finish)} of ${T.field}${hero.prize ? ', won ' + U.fmtMoney(hero.prize) : ', no cash'}. ${T.payouts.length} places paid.`,
        `Hands dealt ${meta.hands}; played ${meta.hands ? Math.round(meta.vpip / meta.hands * 100) : 0}%; raised preflop ${meta.hands ? Math.round(meta.pfr / meta.hands * 100) : 0}%.`,
        `Decision grades: ${g.good || 0} good, ${g.ok || 0} ok, ${g.mistake || 0} mistakes, ${g.blunder || 0} big mistakes.`,
        'Flagged mistakes:', ...meta.mistakes.slice(-8).map((x) => `- hand #${x.hand} (${x.cards}, ${x.street}): took ${x.took}, suggested ${x.rec}. ${x.text}`),
        'Last hands:', ...meta.history.slice(-3).map((r) => r.narrative),
      ].join('\n');
      try {
        const r = await FS.llm.ask('Review my tournament. Give me: 1) what I did well, 2) my two biggest leaks with concrete examples from the hands, 3) three specific things to practice before my live tournament.', [], ctx, S().llm);
        out.innerHTML = `<div class="msg bot" style="max-width:100%"><span class="who">AI COACH</span>${U.esc(r.reply).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')}</div>`;
      } catch (e) {
        out.innerHTML = `<div class="msg bot err" style="max-width:100%">${U.esc(e.message === 'NOT_CONFIGURED' ? 'Connect an AI endpoint in Settings → AI Coach to get a written review. The Coach’s notes above are from the built-in coach.' : e.message)}</div>`;
      }
    };
  }

  function openSideTab(name) {
    $$('.side-tab', $('#sidebar')).forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.side-panel', $('#sidebar')).forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
    $('#sidebar').classList.add('open');
    if (name === 'chat') { const t = $('#chat-text'); if (t) setTimeout(() => t.focus(), 50); FS.game.updateChatStatus(); }
  }

  function init() {
    FS.ui.onScreen('title', () => { if (!$('#main-menu').classList.contains('hidden')) renderMenu(); titleCanvas(); updateSong(); });
    FS.ui.onScreen('setup', renderSetup);
    FS.ui.onScreen('roster', renderRoster);
    FS.ui.onScreen('stats', renderStats);
    FS.ui.onScreen('results', renderResults);
    $('#press-start').onclick = pressStart;
    $$('[data-nav]').forEach((b) => (b.onclick = () => { FS.audio.sfx.back(); FS.ui.showScreen(b.dataset.nav); }));
    $$('.side-tab', $('#sidebar')).forEach((b) => (b.onclick = () => { FS.audio.sfx.tick(); openSideTab(b.dataset.tab); }));
    $('#sidebar-toggle').onclick = () => $('#sidebar').classList.toggle('open');
    titleCanvas();
  }

  FS.screens = { init, settings, lobby, pauseMenu, openSideTab, glossaryModal, renderMenu };
})(typeof window !== 'undefined' ? window : globalThis);
