/* Game controller: runs the tournament hand by hand at the hero's table, takes the player's input,
   drives the coach panels, records stats, and builds the context for the AI coach. */
(function (root) {
  'use strict';
  const FS = root.FS;
  const { $, $$, h, sleep, toast, modal } = FS.ui;
  const TV = FS.tableView, TM = FS.tournament, CO = FS.coach, U = FS.util, C = FS.cards;
  const fc = U.fmtChips;

  const G = {
    T: null, hand: null, heroSeat: -1, running: false, analysis: null, grades: [], obs: {}, meta: null,
    chat: [], waiter: null, lastFeedback: null, handNo: 0, betweenHands: false, advanceResolver: null,
  };
  const S = () => FS.store.get().settings;

  // ---------- lifecycle ----------
  function newMeta() {
    return { hands: 0, vpip: 0, pfr: 0, grades: { good: 0, ok: 0, mistake: 0, blunder: 0 }, mistakes: [], history: [], biggestWin: 0, biggestLoss: 0, startedAt: Date.now(), itmAnnounced: false, bubbleAnnounced: false };
  }
  function start(opts) {
    const st = FS.store.get();
    const T = TM.create(Object.assign({ heroName: st.settings.heroName || 'You' }, opts));
    G.T = T; G.meta = newMeta(); G.obs = {}; G.chat = []; G.handNo = 0;
    st.tourney = null; st.tourneyMeta = null;
    FS.store.save(true);
    enterGame();
  }
  function resume() {
    const st = FS.store.get();
    if (!st.tourney) return false;
    G.T = JSON.parse(st.tourney);
    const m = st.tourneyMeta ? JSON.parse(st.tourneyMeta) : {};
    G.meta = Object.assign(newMeta(), m.meta || {});
    G.obs = m.obs || {}; G.chat = m.chat || []; G.handNo = m.handNo || 0;
    enterGame();
    return true;
  }
  function saveProgress() {
    const st = FS.store.get();
    if (!G.T || G.T.over || TM.hero(G.T).busted) { st.tourney = null; st.tourneyMeta = null; }
    else {
      st.tourney = JSON.stringify(G.T);
      st.tourneyMeta = JSON.stringify({ meta: G.meta, obs: G.obs, chat: G.chat.slice(-20), handNo: G.handNo });
    }
    FS.store.save();
  }
  function enterGame() {
    FS.ui.showScreen('game');
    G.running = true;
    renderHUD();
    renderHintsPanel();
    renderChat();
    renderLog();
    renderOpps();
    FS.audio.setMood(TM.onBubble(G.T) ? 'tense' : 'normal');
    setTimeout(loop, 250);
  }
  function stop() {
    G.running = false;
    if (G.waiter) { G.waiter.reject(new Error('stopped')); G.waiter = null; }
    if (G.advanceResolver) { G.advanceResolver(); G.advanceResolver = null; }
  }

  function infoFor(id) {
    const p = TM.player(G.T, id);
    const style = FS.roster.STYLES[p.style];
    return { name: id === 'hero' ? (S().heroName || 'You') : p.name, stack: p.stack, tag: style ? style.label : 'You' };
  }
  function profileFor(id) {
    const p = TM.player(G.T, id);
    if (!p) return null;
    const o = G.obs[id];
    return { style: p.style, observed: o && o.hands ? { hands: o.hands, vpip: o.vpip / o.hands, pfr: o.pfr / o.hands } : null };
  }
  /** What the coach assumes about each opponent: their style (a regular) blended with what you've seen. */
  function readFor(id) {
    const p = TM.player(G.T, id);
    if (!p || p.isHero) return null;
    return FS.roster.STYLES[p.style] || null;
  }

  // ---------- main loop ----------
  async function loop() {
    try {
      while (G.running) {
        const T = G.T;
        if (T.over || TM.hero(T).busted) { await finishTournament(); return; }
        const table = TM.heroTable(T);
        if (table.seats.filter(Boolean).length < 2) { await handleRoundEvents(TM.afterRound(T)); continue; }
        await playHand(table);
        if (!G.running) return;
        const events = TM.afterRound(T);
        saveProgress();
        await handleRoundEvents(events);
        renderHUD();
        if (TM.hero(T).busted || T.over) { saveProgress(); await sleep(TV.dur(1200)); await finishTournament(); return; }
        saveProgress();
        await betweenHands();
      }
    } catch (e) {
      if (e && e.message === 'stopped') return;
      console.error(e);
      toast('Something went wrong: ' + e.message, 'red', 6000);
    }
  }

  async function playHand(table) {
    const T = G.T;
    const hand = TM.makeHand(T, table).start();
    G.hand = hand; G.grades = []; G.handNo++;
    G.heroSeat = table.seats.indexOf('hero');
    G.ff = false; TV.V.ff = false;
    G.lastFeedback = null;
    G.heroAnalyses = [];
    TV.setTable(table.seats, G.heroSeat, infoFor);
    TV.renderSeats(hand);
    TV.renderBoard([]);
    TV.renderPot(hand);
    TV.highlightWinners([]);
    TV.clearBanner();
    renderActionBar('wait');
    renderHUD();
    for (const p of hand.seated) {
      const o = G.obs[p.id] || (G.obs[p.id] = { hands: 0, vpip: 0, pfr: 0 });
      o.hands++;
    }
    FS.audio.sfx.chip(2, 0.1);
    await TV.dealIn(hand, G.heroSeat);
    renderLog(); renderOpps();
    const pfVol = new Set(), pfRaise = new Set();
    let evIdx = hand.events.length;
    while (!hand.done && G.running) {
      const seat = hand.actor;
      TV.setActing(seat);
      TV.renderSeats(hand);
      TV.renderHole(hand, G.heroSeat);
      let action;
      if (seat === G.heroSeat) {
        const A = await analyzeHero(hand);
        G.analysis = A;
        renderHintsPanel();
        FS.audio.sfx.blip(660);
        action = await heroInput(hand, A);
        const gr = CO.grade(A, action, hand, G.heroSeat);
        if (gr) { G.grades.push(gr); G.meta.grades[gr.grade] = (G.meta.grades[gr.grade] || 0) + 1; G.lastFeedback = gr; }
        G.analysis = null;
        renderActionBar('wait');
      } else {
        if (!G.analysis) renderHintsPanel();
        const pl = TM.player(T, hand.players[seat].id);
        const d = FS.ai.decide(hand, seat, pl, { rng: hand.rng, readLookup: readFor });
        renderActionBar('wait', hand.players[seat].name);
        const think = TV.dur(d.thinkMs);
        if (think > 1400 && Math.random() < 0.35) FS.audio.vox.say('hmm', voiceOf(pl.id), panOf(seat));
        await sleep(think);
        action = d.action;
      }
      if (!G.running) return;
      if (hand.street === 'preflop') {
        const id = hand.players[seat].id;
        if (action.type === 'call' || action.type === 'raise') pfVol.add(id);
        if (action.type === 'raise') pfRaise.add(id);
      }
      hand.act(seat, action);
      const evs = hand.events.slice(evIdx);
      evIdx = hand.events.length;
      await playEvents(hand, evs);
      if (seat === G.heroSeat) renderHintsPanel();
    }
    if (!G.running) return;
    TV.setActing(-1);
    for (const id of pfVol) G.obs[id].vpip++;
    for (const id of pfRaise) G.obs[id].pfr++;
    await finishHand(hand, table, pfVol, pfRaise);
  }

  async function analyzeHero(hand) {
    await sleep(10);
    const reads = {};
    for (const p of hand.inHand) if (p.seat !== G.heroSeat) reads[p.seat] = readFor(p.id);
    const rng = U.makeRng(U.hashString(G.T.seed + ':' + G.handNo + ':' + hand.street + ':' + hand.actions.length));
    const A = FS.strategy.analyze(hand, G.heroSeat, { iterations: 2600, rng, reads });
    G.heroAnalyses.push(A);
    return A;
  }

  const voiceOf = (id) => (id === 'hero' ? FS.roster.HERO.voice : (FS.roster.byId[id] || {}).voice);
  const panOf = (seat) => { const d = (seat - G.heroSeat + 9) % 9; return Math.sin((90 + d * 40) * Math.PI / 180 - Math.PI / 2) * -0.6; };

  async function playEvents(hand, evs) {
    for (const e of evs) {
      if (e.type === 'action') {
        TV.actionBubble(e);
        playActionSound(e, hand);
        TV.renderSeats(hand);
        TV.renderHole(hand, G.heroSeat);
        appendLogLine(hand, e);
        await sleep(TV.dur(e.allIn ? 700 : 380));
      } else if (e.type === 'refund') {
        TV.renderBets(hand);
      } else if (e.type === 'allin-runout') {
        TV.renderHole(hand, G.heroSeat);
        await TV.collectBets(hand);
        await TV.banner('ALL-IN!', 'Cards up — running it out', 'red', TV.dur(1300));
      } else if (e.type === 'street') {
        await TV.collectBets(hand);
        await sleep(TV.dur(200));
        await TV.revealBoard(e.board, e.board.length - e.cards.length);
        appendLogLine(hand, e);
        if (hand.runout) await sleep(TV.dur(700));
        if (G.analysis == null) renderHintsPanel();
      } else if (e.type === 'showdown') {
        await TV.collectBets(hand);
        TV.renderHole(hand, G.heroSeat, e.results.shown);
        FS.audio.sfx.flip();
        await sleep(TV.dur(900));
      }
    }
  }

  function playActionSound(e, hand) {
    const S_ = FS.audio.sfx;
    const pan = panOf(e.seat);
    const act = e;
    if (act.allIn) {
      S_.chip(8, 0, pan); S_.chipsSlide(0.1);
      if (Math.random() < 0.6) FS.audio.vox.crowd('ooh');
      const pl = TM.player(G.T, hand.players[e.seat].id);
      if (!pl.isHero && Math.random() < 0.5) talk(e.seat, pl, 'allIn');
      return;
    }
    const ty = act.action;
    if (ty === 'fold') S_.fold();
    else if (ty === 'check') S_.check();
    else if (ty === 'call') S_.chip(Math.min(6, 1 + Math.round((act.added || 0) / hand.bbAmt / 2)), 0, pan);
    else if (ty === 'raise') S_.chip(Math.min(8, 2 + Math.round((act.added || 0) / hand.bbAmt / 2)), 0, pan);
  }

  function talk(seat, pl, event) {
    const txt = FS.roster.talk(event, FS.roster.byId[pl.id] || pl, Math.random);
    if (!txt) return;
    TV.bubble(seat, txt, 'talk', TV.dur(2600));
    FS.audio.vox.say('talk', voiceOf(pl.id), panOf(seat));
  }

  async function finishHand(hand, table, pfVol, pfRaise) {
    const R = hand.results;
    const heroP = hand.players[G.heroSeat];
    // Final display
    await TV.collectBets(hand);
    const winners = Object.keys(R.winnings).map(Number);
    let bannerText = '', bannerSub = '';
    if (R.uncontested) {
      const w = winners[0];
      bannerText = `${nameAt(hand, w)} win${w === G.heroSeat ? '' : 's'} ${fc(R.winnings[w])}`;
      bannerSub = 'Everyone else folded';
    } else {
      const main = R.pots[0];
      const w = main.winners;
      const best = C.bestFive(hand.players[w[0]].cards.concat(hand.board));
      TV.renderBoard(hand.board, best);
      w.forEach((s) => TV.highlightHole(s, best));
      bannerText = w.length > 1 ? 'Split pot!' : `${nameAt(hand, w[0])} win${w[0] === G.heroSeat ? '' : 's'} ${fc(R.winnings[w[0]])}`;
      bannerSub = main.handName + (R.pots.length > 1 ? ` · ${R.pots.length - 1} side pot${R.pots.length > 2 ? 's' : ''}` : '');
    }
    TV.highlightWinners(winners);
    const heroWon = winners.includes(G.heroSeat);
    TV.banner(bannerText, bannerSub, heroWon ? '' : 'blue', TV.dur(2300));
    await sleep(TV.dur(500));
    await TV.pushPot(R.winnings);
    TV.renderSeats(hand);
    // Reactions
    const net = (s) => hand.players[s].stack - hand.players[s].startStack;
    const potSize = Object.values(R.winnings).reduce((a, b) => a + b, 0);
    const bigPot = potSize >= hand.bbAmt * 12;
    if (heroWon) { FS.audio.sfx.win(); if (bigPot) FS.audio.vox.crowd('cheer'); }
    for (const p of hand.seated) {
      if (p.seat === G.heroSeat) continue;
      const n = net(p.seat);
      const pl = TM.player(G.T, p.id);
      if (n > hand.bbAmt * 8 && winners.includes(p.seat)) {
        TV.setExpr(p.seat, 'happy');
        if (bigPot && Math.random() < 0.7) { FS.audio.vox.say(Math.random() < 0.5 ? 'laugh' : 'cheer', voiceOf(p.id), panOf(p.seat)); if (Math.random() < 0.5) talk(p.seat, pl, 'winBig'); }
      } else if (n < -hand.bbAmt * 8) {
        TV.setExpr(p.seat, 'grumpy');
        if (Math.random() < 0.6) FS.audio.vox.say(Math.random() < 0.5 ? 'grumble' : 'groan', voiceOf(p.id), panOf(p.seat));
        if (p.stack > 0 && Math.random() < 0.35) talk(p.seat, pl, R.uncontested ? 'loseBig' : 'badBeat');
      }
    }
    // Stats
    const heroNet = net(G.heroSeat);
    G.meta.hands++;
    if (pfVol.has('hero')) G.meta.vpip++;
    if (pfRaise.has('hero')) G.meta.pfr++;
    G.meta.biggestWin = Math.max(G.meta.biggestWin, heroNet);
    G.meta.biggestLoss = Math.min(G.meta.biggestLoss, heroNet);
    const st = FS.store.get();
    st.hero.hands++; if (pfVol.has('hero')) st.hero.vpip++; if (pfRaise.has('hero')) st.hero.pfr++;
    for (const g of G.grades) st.hero.grades[g.grade] = (st.hero.grades[g.grade] || 0) + 1;
    for (const p of hand.seated) {
      if (p.id === 'hero') continue;
      const o = FS.store.opp(p.id);
      o.obs.hands++; if (pfVol.has(p.id)) o.obs.vpip++; if (pfRaise.has(p.id)) o.obs.pfr++;
      o.handsVsHero++;
      const n = net(p.seat);
      if (heroNet > 0 && n < 0) o.heroNet += Math.min(-n, heroNet);
      if (heroNet < 0 && n > 0) o.heroNet -= Math.min(n, -heroNet);
    }
    const narrative = CO.narrate(hand, G.heroSeat, G.grades);
    const rec = {
      no: G.handNo, level: G.T.level + 1, t: Date.now(), cards: heroP.cards, board: hand.board.slice(), net: heroNet, pot: potSize,
      pos: heroP.pos, narrative, grades: G.grades.map((g) => ({ grade: g.grade, text: g.text, rec: g.rec, took: g.took, street: g.street })),
      title: `${CO.prettyCards(heroP.cards)} · ${heroP.pos} · ${heroNet > 0 ? '+' : ''}${fc(heroNet)}`,
    };
    G.meta.history.push(rec);
    if (G.meta.history.length > 40) G.meta.history = G.meta.history.slice(-40);
    for (const g of G.grades) if (g.grade === 'mistake' || g.grade === 'blunder') G.meta.mistakes.push({ hand: G.handNo, text: g.text, rec: g.rec, took: g.took, street: g.street, cards: CO.prettyCards(heroP.cards), grade: g.grade });
    FS.store.addHand(rec);
    // Apply to tournament
    const busted = TM.applyHand(G.T, table, hand);
    for (const id of busted) {
      const seat = hand.players.findIndex((p) => p && p.id === id);
      const pl = TM.player(G.T, id);
      if (id === 'hero') {
        winners.forEach((w) => { const o = FS.store.opp(hand.players[w].id); if (o) o.knockedOutHero++; });
        FS.audio.sfx.sting();
        await TV.banner('You’re out!', `Finished ${U.ordinal(pl.finish)}${pl.prize ? ' — won ' + U.fmtMoney(pl.prize) : ''}`, 'red', TV.dur(2600));
      } else {
        if (heroWon) FS.store.opp(id).heroKnockedOut++;
        talk(seat, pl, 'bust');
        toast(`${pl.name} is eliminated in ${U.ordinal(pl.finish)} place${pl.prize ? ' (' + U.fmtMoney(pl.prize) + ')' : ''}`, '', 3200);
        await sleep(TV.dur(900));
      }
    }
    FS.store.save();
    renderLog(); renderOpps(); renderHUD();
    renderHintsPanel();
  }
  function nameAt(hand, seat) { return seat === G.heroSeat ? 'You' : hand.players[seat].name; }

  async function handleRoundEvents(events) {
    const T = G.T;
    for (const e of events) {
      if (e.type === 'bust' && e.table !== T.heroTableId) {
        const p = TM.player(T, e.id);
        toast(`Table ${e.table}: ${p.name} busts in ${U.ordinal(p.finish)}`, '', 2600);
      } else if (e.type === 'level') {
        FS.audio.sfx.fanfare();
        await TV.banner(`Level ${e.level + 1}`, `Blinds ${fc(e.blinds.sb)} / ${fc(e.blinds.bb)}${e.blinds.ante ? ' · ante ' + fc(e.blinds.ante) : ''}`, '', TV.dur(2000));
      } else if (e.type === 'move') {
        const p = TM.player(T, e.id);
        if (e.to === T.heroTableId) toast(`${p.name} joins your table from Table ${e.from}`, 'gold', 2800);
        else if (e.from === T.heroTableId) toast(`${p.name} moves to Table ${e.to} (balancing)`, '', 2600);
      } else if (e.type === 'break') {
        toast(`Table ${e.table} is broken — players reseated`, '', 2600);
      } else if (e.type === 'final-table') {
        FS.audio.sfx.fanfare(); FS.audio.vox.crowd('cheer');
        await TV.banner('FINAL TABLE', `${TM.alive(T).length} players left`, '', TV.dur(2400));
      }
    }
    if (!G.meta.bubbleAnnounced && TM.onBubble(T) && !TM.hero(T).busted) {
      G.meta.bubbleAnnounced = true;
      FS.audio.setMood('tense');
      await TV.banner('BUBBLE!', `Next elimination and ${T.payouts.length} players are paid`, 'red', TV.dur(2400));
    }
    if (!G.meta.itmAnnounced && TM.inTheMoney(T) && !TM.hero(T).busted && !T.over) {
      G.meta.itmAnnounced = true;
      FS.audio.setMood('normal');
      FS.audio.sfx.fanfare(); FS.audio.vox.crowd('cheer');
      await TV.banner('IN THE MONEY!', `You’ve locked up at least ${U.fmtMoney(TM.prizeFor(T, TM.alive(T).length))}`, '', TV.dur(2600));
    }
    const table = TM.heroTable(T);
    TV.setTable(table.seats, table.seats.indexOf('hero'), infoFor);
  }

  async function betweenHands() {
    G.betweenHands = true;
    renderActionBar('between');
    const auto = S().autoAdvance;
    await new Promise((res) => {
      G.advanceResolver = res;
      if (auto) G.advanceTimer = setTimeout(res, TV.dur(2600));
    });
    clearTimeout(G.advanceTimer);
    G.advanceResolver = null;
    G.betweenHands = false;
    TV.highlightWinners([]);
  }
  function advance() { if (G.advanceResolver) G.advanceResolver(); }

  async function finishTournament() {
    G.running = false;
    const T = G.T;
    const hero = TM.hero(T);
    if (!T.over) {
      TV.banner('Simulating the rest…', 'Playing out the other tables', 'blue', 60000);
      renderActionBar('none');
      await new Promise((res) => {
        const step = () => { let n = 0; while (!T.over && n++ < 12) TM.afterRound(T); if (T.over) res(); else setTimeout(step, 0); };
        step();
      });
      TV.clearBanner();
    }
    // lifetime records
    const st = FS.store.get();
    const H = st.hero;
    H.tournaments++; H.totalBuyIns += T.buyIn;
    if (hero.prize) { H.cashes++; H.totalPrize += hero.prize; }
    if (hero.finish === 1) H.wins++;
    if (!H.bestFinish || hero.finish < H.bestFinish) H.bestFinish = hero.finish;
    const g = G.meta.grades, tot = (g.good || 0) + (g.ok || 0) + (g.mistake || 0) + (g.blunder || 0);
    H.history.push({ t: Date.now(), field: T.field, finish: hero.finish, prize: hero.prize || 0, hands: G.meta.hands, accuracy: tot ? (g.good + g.ok * 0.5) / tot : null, speed: T.speed, difficulty: T.difficulty });
    if (H.history.length > 50) H.history = H.history.slice(-50);
    for (const p of T.players) {
      if (p.isHero) continue;
      const o = FS.store.opp(p.id);
      o.tourneys++;
      if (p.finish === 1) o.wins++;
      if (p.prize) o.cashes++;
      if (!o.bestFinish || p.finish < o.bestFinish) o.bestFinish = p.finish;
    }
    st.tourney = null; st.tourneyMeta = null;
    st.lastResult = JSON.stringify({ T: { field: T.field, buyIn: T.buyIn, payouts: T.payouts, name: T.name, players: T.players.map((p) => ({ id: p.id, name: p.name, finish: p.finish, prize: p.prize || 0, style: p.style })) }, meta: G.meta });
    FS.store.save(true);
    if (hero.finish === 1) { FS.audio.sfx.win(); FS.audio.vox.crowd('cheer'); }
    FS.ui.showScreen('results');
  }

  // ---------- hero input ----------
  function heroInput(hand, A) {
    return new Promise((resolve, reject) => {
      G.waiter = { resolve: (a) => { G.waiter = null; resolve(a); }, reject };
      renderActionBar('hero', null, A);
    });
  }
  function submit(action) {
    if (!G.waiter) return;
    const L = G.hand.legal(G.heroSeat);
    if (!L) return;
    if (action.type === 'raise' && S().confirmAllIn && action.to >= L.maxRaiseTo && L.maxRaiseTo > G.hand.bbAmt * 3) {
      const m = modal('Go all-in?', `<p>You’re about to put <b>all ${fc(L.maxRaiseTo)}</b> chips in. Sure?</p><div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn red" id="ai-yes">ALL-IN</button></div><p class="small-note">You can turn this confirmation off in Settings.</p>`);
      $('#ai-yes', m.el).onclick = () => { m.close(); G.waiter && G.waiter.resolve(action); };
      return;
    }
    FS.audio.sfx.select();
    G.waiter.resolve(action);
  }

  function presetAmounts(hand, L) {
    const bb = hand.bbAmt;
    const pot = hand.pot();
    const out = [];
    const clampTo = (x) => U.clamp(Math.round(x), L.minRaiseTo, L.maxRaiseTo);
    if (hand.street === 'preflop' && hand.currentBet <= bb) {
      out.push(['2.5 BB', clampTo(bb * 2.5)], ['3 BB', clampTo(bb * 3)], ['4 BB', clampTo(bb * 4)]);
    } else {
      const potAfterCall = pot + L.toCall;
      out.push(['½ Pot', clampTo(hand.currentBet + potAfterCall * 0.5)], ['¾ Pot', clampTo(hand.currentBet + potAfterCall * 0.75)], ['Pot', clampTo(hand.currentBet + potAfterCall)]);
    }
    out.unshift(['Min', L.minRaiseTo]);
    out.push(['All-in', L.maxRaiseTo]);
    return out;
  }

  function renderActionBar(mode, who, A) {
    const bar = $('#action-bar');
    const hand = G.hand;
    if (mode === 'none') { bar.innerHTML = ''; return; }
    if (mode === 'between') {
      const auto = S().autoAdvance;
      bar.innerHTML = `<button class="btn gold act-btn" id="ab-next">NEXT HAND<small>${auto ? 'auto in a moment · Space' : 'Space'}</small></button>
        <button class="btn act-btn" id="ab-review">REVIEW<small>last hand</small></button>
        <button class="btn act-btn" id="ab-lobby">LOBBY<small>standings</small></button>
        <label class="small-note" style="display:flex;gap:6px;align-items:center;cursor:pointer"><span class="switch ${auto ? 'on' : ''}" id="ab-auto"></span>Auto-deal</label>`;
      $('#ab-next').onclick = advance;
      $('#ab-review').onclick = () => { clearTimeout(G.advanceTimer); reviewHand(G.meta.history[G.meta.history.length - 1]); };
      $('#ab-lobby').onclick = () => { clearTimeout(G.advanceTimer); FS.screens.lobby(); };
      $('#ab-auto').onclick = () => { S().autoAdvance = !S().autoAdvance; FS.store.save(); if (!S().autoAdvance) clearTimeout(G.advanceTimer); renderActionBar('between'); };
      return;
    }
    if (mode === 'wait' || !hand) {
      const heroIn = hand && hand.players[G.heroSeat] && !hand.players[G.heroSeat].folded;
      bar.innerHTML = `<div class="wait-msg">${hand && !hand.done ? '<div class="spinner"></div>' : ''}${who ? U.esc(who) + ' is thinking…' : hand && !hand.done ? 'Dealing…' : ''}</div>
        ${hand && !hand.done && !heroIn ? `<button class="btn small" id="ab-ff">${G.ff ? '⏩ Fast-forwarding' : '⏩ Fast-forward hand'}</button>` : ''}`;
      const ff = $('#ab-ff');
      if (ff) ff.onclick = () => { G.ff = !G.ff; TV.V.ff = G.ff; renderActionBar('wait', who); };
      return;
    }
    // hero's turn
    const L = hand.legal(G.heroSeat);
    const rec = A && A.rec;
    const showRec = S().hints.hand && S().hints.rec && rec;
    const recCls = (t) => (showRec && rec.type === t ? ' recommended' : '');
    const isBet = L.currentBet === 0;
    const callAll = L.toCall >= L.stack;
    let html = '';
    if (!L.canCheck) html += `<button class="btn red act-btn${recCls('fold')}" id="ab-fold"><span class="key">F</span>FOLD</button>`;
    html += L.canCheck
      ? `<button class="btn act-btn${recCls('check')}" id="ab-call"><span class="key">C</span>CHECK</button>`
      : `<button class="btn act-btn${recCls('call')}" id="ab-call"><span class="key">C</span>${callAll ? 'CALL ALL-IN' : 'CALL'}<small>${fc(L.toCall)}</small></button>`;
    if (L.canRaise) {
      const start = rec && rec.type === 'raise' && showRec ? rec.to : (hand.street === 'preflop' && L.currentBet <= hand.bbAmt ? Math.min(L.maxRaiseTo, Math.max(L.minRaiseTo, hand.bbAmt * 2.5)) : L.minRaiseTo);
      html += `<button class="btn green act-btn${recCls('raise')}" id="ab-raise"><span class="key">R</span><span id="ab-rlabel">${isBet ? 'BET' : 'RAISE TO'}</span><small id="ab-ramt">${fc(start)}</small></button>
        <div class="sizer">
          <div class="sizer-top"><input type="range" id="ab-range" min="${L.minRaiseTo}" max="${L.maxRaiseTo}" step="${Math.max(1, Math.round(hand.bbAmt / 4))}" value="${start}" aria-label="Bet size">
          <input type="number" id="ab-num" min="${L.minRaiseTo}" max="${L.maxRaiseTo}" value="${start}" aria-label="Bet amount"></div>
          <div class="presets">${presetAmounts(hand, L).map(([l, v], i) => `<button class="btn small" data-v="${v}" title="Key ${i + 1}">${l}</button>`).join('')}</div>
        </div>`;
    }
    bar.innerHTML = html;
    const fold = $('#ab-fold'), call = $('#ab-call'), raise = $('#ab-raise');
    if (fold) fold.onclick = () => submit({ type: 'fold' });
    call.onclick = () => submit({ type: L.canCheck ? 'check' : 'call' });
    if (raise) {
      const range = $('#ab-range'), num = $('#ab-num');
      const set = (v) => {
        v = U.clamp(Math.round(+v || 0), L.minRaiseTo, L.maxRaiseTo);
        range.value = v; num.value = v;
        $('#ab-ramt').textContent = fc(v) + (v === L.maxRaiseTo ? ' (ALL-IN)' : '');
        raise.dataset.v = v;
      };
      set(range.value);
      range.oninput = () => set(range.value);
      num.onchange = () => set(num.value);
      $$('.presets .btn', bar).forEach((b) => (b.onclick = () => { set(b.dataset.v); FS.audio.sfx.tick(); }));
      raise.onclick = () => submit({ type: 'raise', to: +raise.dataset.v });
      G.setBet = set;
    } else G.setBet = null;
  }

  function onKey(e) {
    if (FS.ui.current !== 'game' || FS.ui.anyModalOpen()) return;
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target.type !== 'range') return;
    const k = e.key.toLowerCase();
    if (G.waiter) {
      if (k === 'f' && $('#ab-fold')) { e.preventDefault(); $('#ab-fold').click(); }
      else if (k === 'c' || k === 'k') { e.preventDefault(); $('#ab-call').click(); }
      else if (k === 'r' && $('#ab-raise')) { e.preventDefault(); $('#ab-raise').click(); }
      else if (/^[1-6]$/.test(k)) { const b = $$('.presets .btn')[+k - 1]; if (b) { e.preventDefault(); b.click(); } }
    } else if (G.betweenHands && (k === ' ' || k === 'enter' || k === 'n')) { e.preventDefault(); advance(); }
    if (k === 'h') { toggleAllHints(); }
    if (k === 'escape') FS.screens.pauseMenu();
  }

  // ---------- coach panel ----------
  function toggleAllHints() {
    const hs = S().hints;
    const anyOn = hs.big || hs.table || hs.hand;
    hs.big = hs.table = hs.hand = !anyOn;
    FS.store.save(); renderHintsPanel(); renderHUD();
    toast(anyOn ? 'Coach hints hidden (press H to show)' : 'Coach hints on', '', 1600);
  }
  function renderHintsPanel() {
    const el = $('#panel-hints');
    if (!el || !G.hand || !G.T) return;
    const hs = S().hints;
    const hand = G.hand;
    const A = G.analysis;
    const inHand = hand.players[G.heroSeat] && !hand.players[G.heroSeat].folded && !hand.done;
    const ctx = { A, T: G.T, hand, heroSeat: G.heroSeat, profiles: profileFor };
    const para = (arr) => arr.map((t) => `<p>${CO.glossaryHTML(t)}</p>`).join('');
    const tier = (key, cls, title, lvl, body) => `<div class="tier ${cls} ${hs[key] ? '' : 'off'}" data-tier="${key}">
      <div class="tier-head"><span class="switch ${hs[key] ? 'on' : ''}" data-sw="${key}" role="switch" aria-checked="${hs[key]}" tabindex="0"></span><h3>${title}</h3><span class="lvl">${lvl}</span></div>
      <div class="tier-body">${body}</div></div>`;
    let fb = '';
    if (G.lastFeedback && hs.feedback) {
      const g = G.lastFeedback;
      const label = { good: '✔ Good play', ok: '≈ Acceptable', mistake: '✘ Mistake', blunder: '✘✘ Big mistake' }[g.grade];
      fb = `<div class="feedback g-${g.grade}"><div class="g">${label}</div>${CO.glossaryHTML(g.text)}${g.grade !== 'good' ? `<div class="small-note">Coach suggested: ${U.esc(g.rec)}</div>` : ''}</div>`;
    }
    let t3 = '';
    if (A && inHand) {
      const rec = CO.recommendation(ctx);
      const eqPct = Math.round(A.equity * 100), need = Math.round(A.potOdds * 100);
      t3 = para(CO.handCoach(ctx)) +
        `<div class="meter" title="Your estimated chance to win vs. the price"><div class="fill" style="width:${eqPct}%"></div>${A.toCall ? `<div class="need" style="left:${need}%"></div>` : ''}</div>
         <div class="meter-legend"><span>Your equity ${eqPct}%</span>${A.toCall ? `<span style="color:var(--bad)">Needed ${need}%</span>` : '<span>No bet to call</span>'}</div>`;
      if (rec) t3 += `<div class="rec-box ${hs.rec ? '' : 'hidden-rec'}" id="rec-box"><div class="small-note">${hs.rec ? 'Coach recommends' : 'Coach recommends (click to reveal)'}</div><div class="rec-act">${U.esc(rec.label)}</div><p style="margin:4px 0 0">${CO.glossaryHTML(rec.why)}</p></div>`;
    } else if (inHand) {
      const me = hand.players[G.heroSeat];
      t3 = `<p class="muted">Waiting for your turn…</p>` + (me.cards.length ? `<p>${CO.glossaryHTML('Your cards: **' + CO.prettyCards(me.cards) + '** — ' + CO.handName(me.cards) + (hand.board.length ? ' · you have **' + C.analyzeHand(me.cards, hand.board).name + '**' : '') + '.')}</p>` : '');
    } else t3 = `<p class="muted">${hand.done ? 'Hand over.' : 'You’re out of this hand.'} Watch how others play — the Table Read explains what they’re doing.</p>`;
    el.innerHTML = `
      <div class="coach-opts">
        <label><span class="switch ${hs.rec ? 'on' : ''}" data-sw="rec"></span>Show recommended action (★ on buttons)</label>
        <label><span class="switch ${hs.feedback ? 'on' : ''}" data-sw="feedback"></span>Grade my decisions</label>
      </div>
      ${fb}
      ${tier('big', 'tier-t1', 'Big Picture', 'LEVEL 1 · BROAD', para(CO.bigPicture(ctx)))}
      ${tier('table', 'tier-t2', 'Table Read', 'LEVEL 2 · SITUATION', para(CO.tableRead(ctx)))}
      ${tier('hand', 'tier-t3', 'Hand Coach', 'LEVEL 3 · THIS HAND', t3)}
      <p class="small-note">Hover or tap <span class="term" data-def="Like this! Dotted words have plain-English explanations.">dotted words</span> for definitions. Press <b>H</b> to hide/show all hints.</p>`;
    $$('[data-sw]', el).forEach((sw) => {
      const flip = (ev) => { ev.stopPropagation(); const k = sw.dataset.sw; hs[k] = !hs[k]; FS.store.save(); FS.audio.sfx.tick(); renderHintsPanel(); renderHUD(); if (G.waiter) renderActionBar('hero', null, G.analysis); };
      sw.onclick = flip;
      sw.onkeydown = (ev) => { if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); flip(ev); } };
    });
    $$('.tier-head', el).forEach((th) => (th.onclick = (ev) => { if (!ev.target.closest('[data-sw]')) th.querySelector('[data-sw]').click(); }));
    const rb = $('#rec-box', el);
    if (rb && !hs.rec) rb.onclick = () => rb.classList.remove('hidden-rec');
  }

  // ---------- log / opponents ----------
  function appendLogLine() { renderLog(); }
  function renderLog() {
    const el = $('#panel-log');
    if (!el) return;
    const hand = G.hand;
    let cur = '';
    if (hand) {
      const lines = [];
      const nameOf = (s) => (s === G.heroSeat ? 'You' : hand.players[s].name);
      lines.push(`<div class="log-line street">Hand #${G.handNo} · Blinds ${fc(hand.sbAmt)}/${fc(hand.bbAmt)}${hand.anteAmt ? ' · ante ' + fc(hand.anteAmt) : ''}</div>`);
      lines.push(`<div class="log-line">${nameOf(hand.sbSeat)} posts small blind ${fc(hand.sbAmt)}; ${nameOf(hand.bbSeat)} posts big blind ${fc(hand.bbAmt)}${hand.anteAmt ? ' + ante' : ''}.</div>`);
      let street = 'preflop';
      const boardAt = { flop: 3, turn: 4, river: 5 };
      for (const a of hand.actions) {
        if (a.street !== street) { street = a.street; lines.push(`<div class="log-line street">${street.toUpperCase()} ${CO.prettyCards(hand.board.slice(0, boardAt[street]))}</div>`); }
        lines.push(`<div class="log-line ${a.seat === G.heroSeat ? 'hero' : ''}">${U.esc(nameOf(a.seat))} ${U.esc(CO.verb(a))}</div>`);
      }
      if (hand.board.length > (boardAt[street] || 0)) lines.push(`<div class="log-line street">BOARD ${CO.prettyCards(hand.board)}</div>`);
      if (hand.done && hand.results) {
        const R = hand.results;
        if (!R.uncontested) for (const s of R.shown) lines.push(`<div class="log-line">${U.esc(nameOf(+s))} shows ${CO.prettyCards(hand.players[s].cards)} — ${R.handNames[s]}</div>`);
        for (const [s, amt] of Object.entries(R.winnings)) lines.push(`<div class="log-line win">${U.esc(nameOf(+s))} win${+s === G.heroSeat ? '' : 's'} ${fc(amt)}</div>`);
      }
      cur = `<div class="log-hand">${lines.join('')}</div>`;
    }
    const hist = (G.meta ? G.meta.history : []).slice().reverse().slice(0, 25);
    el.innerHTML = cur + `<h3 class="chrome-title" style="font-size:15px;margin:12px 0 6px">Previous hands</h3>` +
      (hist.length ? hist.map((r, i) => `<div class="hist-item" data-i="${i}"><span>#${r.no} ${U.esc(r.title)}</span><span>${gradeDots(r.grades)}</span></div>`).join('') : '<p class="small-note">Finished hands appear here. Click one to review it.</p>');
    $$('.hist-item', el).forEach((it) => (it.onclick = () => reviewHand(hist[+it.dataset.i])));
    el.scrollTop = 0;
  }
  function gradeDots(grades) {
    return (grades || []).map((g) => `<span title="${g.grade}" style="color:var(--${g.grade === 'good' ? 'good' : g.grade === 'ok' ? 'ok' : 'bad'})">●</span>`).join('');
  }
  function reviewHand(rec) {
    if (!rec) return;
    const body = h(`<div>
      <div style="display:flex;gap:6px;align-items:center;--cw:44px;--ch:62px;margin-bottom:10px">${FS.ui.cardsInline(rec.cards)}<span style="width:14px"></span>${FS.ui.cardsInline(rec.board)}</div>
      <pre class="prompt" style="max-height:none;font-size:12.5px;color:var(--ink)">${U.esc(rec.narrative)}</pre>
      <h3>Coach’s notes</h3>
      ${rec.grades.length ? rec.grades.map((g) => `<div class="feedback g-${g.grade}"><div class="g">${g.street.toUpperCase()}: ${g.grade.toUpperCase()} — you ${g.took}, coach: ${U.esc(g.rec)}</div>${CO.glossaryHTML(g.text)}</div>`).join('') : '<p class="muted">You didn’t make any decisions this hand (folded before acting or everyone else acted first).</p>'}
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn gold" id="rv-ask">Ask the AI coach about this hand</button></div>
    </div>`);
    const m = modal(`Hand #${rec.no} review`, body);
    $('#rv-ask', body).onclick = () => { m.close(); openChatWith(`Review hand #${rec.no} for me: what did I do well, what was my biggest mistake, and what should I have done instead?\n\n${rec.narrative}`); };
  }
  function renderOpps() {
    const el = $('#panel-opps');
    if (!el || !G.T) return;
    const table = TM.heroTable(G.T);
    const ids = table.seats.filter((id) => id && id !== 'hero');
    el.innerHTML = `<p class="small-note">The regulars at your table. Knowing a player’s <span class="term" data-def="${U.esc(CO.GLOSSARY.range)}">style</span> tells you how to play against them.</p>` + ids.map((id) => {
      const p = TM.player(G.T, id), ch = FS.roster.byId[id], st = FS.roster.STYLES[p.style];
      const o = G.obs[id], life = FS.store.opp(id);
      const obs = o && o.hands ? `This tournament: ${o.hands} hands · plays ${Math.round(o.vpip / o.hands * 100)}% · raises ${Math.round(o.pfr / o.hands * 100)}%` : 'No hands observed yet';
      return `<div class="opp-card"><img src="${FS.ui.portrait(id)}" alt="">
        <div><h4>${U.esc(p.name)} <span class="muted" style="font-weight:normal;font-size:11px">“${U.esc(ch.nick)}”</span></h4>
        <span class="sty">${st.label}</span> <span class="muted" style="font-size:11px">${fc(p.stack)} (${(p.stack / TM.blinds(G.T).bb).toFixed(0)} BB)</span>
        <p>${U.esc(st.plain)}</p><p class="exploit">➜ ${U.esc(st.exploit)}</p>
        <div class="nums">${obs}</div>
        <div class="nums muted">vs you all-time: ${life.handsVsHero} hands · your net ${life.heroNet >= 0 ? '+' : ''}${fc(life.heroNet)}</div></div></div>`;
    }).join('');
  }

  // ---------- HUD ----------
  function renderHUD() {
    const el = $('#hud');
    const T = G.T;
    if (!el || !T) return;
    const lv = TM.blinds(T), nx = TM.nextBlinds(T);
    const hero = TM.hero(T);
    const alive = TM.alive(T).length;
    const hs = S().hints;
    const stackBB = hero.stack / lv.bb;
    el.innerHTML = `<div class="hud-logo" id="hud-menu" title="Menu (Esc)">☰ FELT SHARPENER</div>
      <div class="hud-stat"><span>Level ${T.level + 1}</span><b>${fc(lv.sb)}/${fc(lv.bb)}${lv.ante ? ' <small style="font-size:10px;color:var(--ink-dim)">ante ' + fc(lv.ante) + '</small>' : ''}</b></div>
      <div class="hud-stat opt ${TM.handsToNextLevel(T) <= 2 ? 'alert' : ''}"><span>Next: ${fc(nx.sb)}/${fc(nx.bb)}</span><b>${TM.handsToNextLevel(T)} hands</b></div>
      <div class="hud-stat ${TM.onBubble(T) ? 'alert' : ''}"><span>${TM.onBubble(T) ? 'BUBBLE' : TM.inTheMoney(T) ? 'In the money' : 'Players'}</span><b>${alive}/${T.field}</b></div>
      <div class="hud-stat opt"><span>Avg stack</span><b>${fc(TM.avgStack(T))}</b></div>
      <div class="hud-stat ${stackBB < 12 ? 'alert' : ''}"><span>You · Rank ${hero.busted ? '—' : TM.heroRank(T)}</span><b>${fc(hero.stack)} <small style="font-size:10px;color:var(--ink-dim)">${stackBB.toFixed(0)} BB</small></b></div>
      <div class="hud-stat opt"><span>Paid</span><b>${T.payouts.length} · 1st ${U.fmtMoney(T.payouts[0])}</b></div>
      <div class="hud-spacer"></div>
      <button class="btn" id="hud-lobby" title="Standings, tables, blinds, payouts">🏆 Lobby</button>
      <button class="btn" id="hud-hints" title="Toggle all coach hints (H)">Hints <span class="hint-pips"><i class="${hs.big ? 'on' : ''}"></i><i class="${hs.table ? 'on' : ''}"></i><i class="${hs.hand ? 'on' : ''}"></i></span></button>
      <button class="btn" id="hud-music" title="Music on/off">${S().muted ? '🔇' : '♪'}</button>
      <button class="btn" id="hud-settings" title="Settings">⚙</button>`;
    $('#hud-menu').onclick = () => FS.screens.pauseMenu();
    $('#hud-lobby').onclick = () => FS.screens.lobby();
    $('#hud-hints').onclick = toggleAllHints;
    $('#hud-music').onclick = () => { S().muted = !S().muted; FS.audio.setVolumes({ muted: S().muted }); FS.store.save(); renderHUD(); };
    $('#hud-settings').onclick = () => FS.screens.settings();
  }

  // ---------- AI coach chat ----------
  function renderChat() {
    const el = $('#panel-chat');
    if (!el) return;
    const cfg = S().llm;
    el.innerHTML = `<div class="chat-status"><span class="led" id="chat-led"></span><span id="chat-route">Checking AI coach…</span><span style="flex:1"></span><button class="btn small" id="chat-cfg">Settings</button></div>
      <div class="chat-log" id="chat-log"></div>
      <div class="chat-quick">
        <button class="btn small" data-q="What should I do right now, and why?">What should I do?</button>
        <button class="btn small" data-q="How did I play my last hand? What did I do well and what should I improve?">Review last hand</button>
        <button class="btn small" data-q="What is my opponent likely holding here, based on how they played?">Their likely hand?</button>
        <button class="btn small" data-q="Explain what is going on in this hand in simple terms.">Explain this spot</button>
        <button class="btn small" data-q="Looking at my stats and mistakes so far, what is the #1 thing I should work on?">What to work on?</button>
        <button class="btn small" data-q="What should my overall strategy be right now for this stage of the tournament and my stack size?">Strategy now?</button>
      </div>
      <div class="chat-input"><textarea id="chat-text" placeholder="Ask your coach anything… (Enter to send, Shift+Enter for new line)"></textarea><button class="btn gold" id="chat-send">Ask</button></div>`;
    const log = $('#chat-log', el);
    if (!G.chat.length) log.appendChild(h(`<div class="msg bot"><span class="who">COACH</span>Hi! I’m your AI coach. Ask me anything, anytime — what to do now, why a play works, or how you played a hand. I can see the table, your cards and the hand history.${cfg.endpoint ? '' : '\n\nTip: connect an AI endpoint in Settings → AI Coach. Until then I’ll answer with the built-in coach’s analysis.'}</div>`));
    for (const m of G.chat) log.appendChild(msgEl(m.role, m.content, m.meta));
    log.scrollTop = log.scrollHeight;
    $$('.chat-quick .btn', el).forEach((b) => (b.onclick = () => sendChat(b.dataset.q)));
    $('#chat-send', el).onclick = () => { const t = $('#chat-text').value.trim(); if (t) { $('#chat-text').value = ''; sendChat(t); } };
    $('#chat-text', el).onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chat-send').click(); } };
    $('#chat-cfg', el).onclick = () => FS.screens.settings('ai');
    updateChatStatus();
  }
  async function updateChatStatus() {
    const led = $('#chat-led'), route = $('#chat-route');
    if (!led) return;
    const cfg = S().llm;
    const harness = await FS.llm.harnessAvailable();
    if (harness) { led.className = 'led on'; route.textContent = `AI coach via local harness${cfg.model ? ' · ' + cfg.model : ''}${cfg.endpoint ? '' : ' (endpoint from harness env or unset)'}`; }
    else if (cfg.endpoint) { led.className = 'led on'; route.textContent = `AI coach direct · ${cfg.model || 'default model'}`; }
    else { led.className = 'led warn'; route.textContent = 'AI not connected — using built-in coach'; }
  }
  function mdLite(s) {
    return U.esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/^#{1,4}\s*(.+)$/gm, '<b>$1</b>');
  }
  function msgEl(role, content, meta) {
    if (role === 'user') { const d = h('<div class="msg user"></div>'); d.textContent = content; return d; }
    return h(`<div class="msg bot ${meta === 'err' ? 'err' : ''}"><span class="who">${meta === 'builtin' ? 'BUILT-IN COACH' : meta === 'err' ? 'COACH (error)' : 'AI COACH'}</span>${mdLite(content)}</div>`);
  }
  function openChatWith(q) {
    FS.screens.openSideTab('chat');
    sendChat(q);
  }
  async function sendChat(q) {
    const log = $('#chat-log');
    if (!log) return;
    const history = G.chat.filter((m) => m.meta !== 'err' && m.meta !== 'builtin').map((m) => ({ role: m.role, content: m.content }));
    G.chat.push({ role: 'user', content: q });
    log.appendChild(msgEl('user', q));
    const typing = h('<div class="msg bot"><span class="who">COACH</span><span class="spinner" style="display:inline-block;vertical-align:middle"></span> thinking…</div>');
    log.appendChild(typing);
    log.scrollTop = log.scrollHeight;
    FS.audio.sfx.blip(990);
    const context = buildContext();
    try {
      const r = await FS.llm.ask(q, history, context, S().llm);
      G.chat.push({ role: 'assistant', content: r.reply });
      typing.replaceWith(msgEl('assistant', r.reply));
    } catch (e) {
      let text, meta = 'err';
      if (e.message === 'NOT_CONFIGURED' || /No AI endpoint configured/.test(e.message)) { text = builtinAnswer() + '\n\n(Connect a real AI in Settings → AI Coach for free-form answers.)'; meta = 'builtin'; }
      else text = e.message + '\n\nMeanwhile, the built-in coach says:\n' + builtinAnswer();
      G.chat.push({ role: 'assistant', content: text, meta });
      typing.replaceWith(msgEl('assistant', text, meta));
    }
    log.scrollTop = log.scrollHeight;
    saveProgress();
  }
  function builtinAnswer() {
    const hand = G.hand;
    if (!hand) return 'No hand in progress.';
    const A = G.analysis;
    const ctx = { A, T: G.T, hand, heroSeat: G.heroSeat, profiles: profileFor };
    const strip = (s) => s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, k, sh) => sh || k);
    const parts = [];
    if (A) {
      const rec = CO.recommendation(ctx);
      parts.push(...CO.handCoach(ctx).map(strip));
      if (rec) parts.push(`Recommendation: **${rec.label}**. ${strip(rec.why)}`);
    } else {
      parts.push(...CO.bigPicture(ctx).map(strip));
      const last = G.meta.history[G.meta.history.length - 1];
      if (last && last.grades.length) parts.push('Last hand: ' + last.grades.map((g) => `${g.street} ${g.grade} — ${g.text}`).join(' '));
    }
    return parts.join('\n');
  }

  /** Everything the AI coach needs to know, as compact plain text. */
  function buildContext() {
    const T = G.T;
    if (!T) return '(no tournament in progress)';
    const hand = G.hand;
    const lv = TM.blinds(T);
    const hero = TM.hero(T);
    const L = [];
    L.push(`TOURNAMENT: ${T.field} players started, ${TM.alive(T).length} left, ${T.payouts.length} paid (1st ${U.fmtMoney(T.payouts[0])}, min cash ${U.fmtMoney(T.payouts[T.payouts.length - 1])}). ${TM.onBubble(T) ? 'ON THE BUBBLE. ' : TM.inTheMoney(T) ? 'In the money. ' : ''}${TM.isFinalTable(T) ? 'Final table. ' : ''}`);
    L.push(`Level ${T.level + 1}: blinds ${lv.sb}/${lv.bb}${lv.ante ? ', big-blind ante ' + lv.ante : ''}; ${TM.handsToNextLevel(T)} hands until blinds go up. Average stack ${Math.round(TM.avgStack(T))} (${(TM.avgStack(T) / lv.bb).toFixed(0)} BB).`);
    L.push(`HERO: stack ${hero.stack} (${(hero.stack / lv.bb).toFixed(1)} BB), rank ${hero.busted ? 'eliminated' : TM.heroRank(T) + ' of ' + TM.alive(T).length}.`);
    if (hand) {
      L.push('');
      L.push('TABLE (seat order from the button):');
      for (const s of hand.order) {
        const p = hand.players[s];
        const pl = TM.player(T, p.id);
        const st = FS.roster.STYLES[pl.style];
        const o = G.obs[p.id];
        L.push(`- ${s === G.heroSeat ? 'HERO (the player you coach)' : p.name} [${p.pos}] stack ${p.stack} (${(p.stack / hand.bbAmt).toFixed(0)} BB)${p.folded ? ', folded' : ''}${p.allIn ? ', ALL-IN' : ''}${s !== G.heroSeat && st ? ` — style: ${st.label} (${st.plain})` : ''}${s !== G.heroSeat && o && o.hands >= 5 ? `; observed VPIP ${Math.round(o.vpip / o.hands * 100)}% PFR ${Math.round(o.pfr / o.hands * 100)}% over ${o.hands} hands` : ''}`);
      }
      L.push('');
      L.push(hand.done ? 'LAST HAND (finished):' : `CURRENT HAND (#${G.handNo}, street: ${hand.street}):`);
      L.push(CO.narrate(hand, G.heroSeat, G.grades));
      if (!hand.done) {
        L.push(`Pot: ${hand.pot()}. Board: ${hand.board.length ? CO.prettyCards(hand.board) : '(none yet)'}.`);
        if (hand.actor === G.heroSeat && G.analysis) {
          const A = G.analysis;
          const rec = CO.recommendation({ A, T, hand, heroSeat: G.heroSeat });
          L.push(`IT IS HERO'S TURN. To call: ${A.toCall}. Hero hand: ${A.handInfo.name}${A.handInfo.madeLabel ? ' (' + A.handInfo.madeLabel + ')' : ''}${A.handInfo.draws.length ? ', draws: ' + A.handInfo.draws.join(', ') + ' (' + A.handInfo.outs + ' outs)' : ''}.`);
          L.push(`Simulator numbers: hero equity vs estimated opponent ranges ≈ ${Math.round(A.equity * 100)}%; pot odds require ${Math.round(A.potOdds * 100)}%; effective stack ${A.effBB.toFixed(1)} BB; starting-hand tier: ${A.tier.label}.`);
          for (const [s, r] of Object.entries(A.ranges)) L.push(`  Estimated range for ${hand.players[s].name}: ${r.desc}.`);
          if (rec) L.push(`Built-in coach suggestion: ${rec.label} (${rec.kind}).`);
        } else if (hand.actor >= 0) L.push(`Waiting on ${hand.players[hand.actor].name} to act.`);
      }
    }
    const m = G.meta;
    if (m) {
      L.push('');
      L.push(`HERO SESSION STATS: ${m.hands} hands, played ${m.hands ? Math.round(m.vpip / m.hands * 100) : 0}% of hands, raised preflop ${m.hands ? Math.round(m.pfr / m.hands * 100) : 0}%. Decision grades: ${m.grades.good || 0} good, ${m.grades.ok || 0} ok, ${m.grades.mistake || 0} mistakes, ${m.grades.blunder || 0} big mistakes.`);
      const recent = m.mistakes.slice(-4);
      if (recent.length) L.push('Recent mistakes: ' + recent.map((x) => `hand #${x.hand} (${x.cards}, ${x.street}): ${x.text}`).join(' | '));
      const prev = m.history.slice(-3).filter((r) => !hand || !hand.done || r.no !== G.handNo);
      if (prev.length) { L.push(''); L.push('RECENT HANDS:'); for (const r of prev.slice(-2)) L.push(`[Hand #${r.no}]\n${r.narrative}`); }
    }
    return L.join('\n');
  }

  document.addEventListener('keydown', onKey);

  FS.game = { G, start, resume, stop, advance, renderHUD, renderHintsPanel, renderChat, renderLog, renderOpps, buildContext, reviewHand, openChatWith, sendChat, updateChatStatus, saveProgress, profileFor };
})(typeof window !== 'undefined' ? window : globalThis);
