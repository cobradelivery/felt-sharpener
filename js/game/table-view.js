/* Renders the hero's table: seats around an oval, hole cards, bets, pot, board, dealer button,
   speech bubbles and banners, with dealing/chip animations. Hero is always drawn at the bottom. */
(function (root) {
  'use strict';
  const FS = root.FS;
  const { $, $$, h, cardHTML, chipsHTML, sleep } = FS.ui;
  const U = FS.util, C = FS.cards;
  const SEATS = 9;

  const V = { rot: 0, seatEls: [], geo: null, ids: [], hand: null, betEls: {}, dealerEl: null };

  function speed() { return { slow: 1.5, normal: 1, fast: 0.55, turbo: 0.28 }[FS.store.get().settings.speed] || 1; }
  const dur = (ms) => Math.round(ms * speed() * (V.ff ? 0.25 : 1));

  function init() {
    const seats = $('#seats');
    seats.innerHTML = '';
    V.seatEls = [];
    for (let i = 0; i < SEATS; i++) {
      const el = h(`<div class="seat empty" data-seat="${i}">
        <div class="avatar-frame"><img alt=""><span class="pos-badge hidden"></span></div>
        <div class="nameplate"><div class="nm"></div><div class="stk"></div><div class="tag"></div></div>
        <div class="hole"></div></div>`);
      seats.appendChild(el);
      V.seatEls.push(el);
    }
    V.dealerEl = h('<div class="dealer-btn" aria-label="Dealer button">D</div>');
    $('#table-area').appendChild(V.dealerEl);
    if (root.ResizeObserver) new ResizeObserver(() => layout()).observe($('#table-area'));
    window.addEventListener('resize', layout);
  }

  /** display index (0 = bottom, clockwise) for a real table seat */
  const disp = (seat) => (seat - V.rot + SEATS) % SEATS;

  function layout() {
    const area = $('#table-area');
    if (!area || !area.offsetWidth) return;
    const fw = $('.felt-wrap', area);
    const ar = area.getBoundingClientRect(), fr = fw.getBoundingClientRect();
    const cx = fr.left - ar.left + fr.width / 2, cy = fr.top - ar.top + fr.height / 2;
    const rx = fr.width / 2, ry = fr.height / 2;
    V.geo = { cx, cy, rx, ry, w: ar.width, h: ar.height };
    V.seatEls.forEach((el, seat) => {
      const p = seatPoint(seat, 1.13, 1.2);
      el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
      const d = disp(seat);
      const hole = $('.hole', el);
      hole.classList.toggle('side-r', d >= 1 && d <= 4);
      hole.classList.toggle('side-l', d >= 5);
    });
    positionBets();
    positionDealer();
  }
  function seatPoint(seat, kx, ky) {
    const g = V.geo;
    const d = disp(seat);
    const th = (90 + d * 40) * Math.PI / 180;
    let x = g.cx + Math.cos(th) * g.rx * kx, y = g.cy + Math.sin(th) * g.ry * ky;
    if (kx > 1) {
      // keep seats fully on screen
      const el = V.seatEls[seat];
      const hw = el ? el.offsetWidth / 2 : 60, hh = el ? el.offsetHeight / 2 : 60;
      x = Math.min(Math.max(x, hw + 4), g.w - hw - 4);
      y = Math.min(Math.max(y, hh * 0.8 + 6), g.h - hh - 4);
    }
    return { x, y };
  }

  /** Assign the tournament table to the view. ids: array of player ids by seat (null if empty). */
  function setTable(ids, heroSeat, getInfo) {
    V.ids = ids.slice();
    V.rot = heroSeat >= 0 ? heroSeat : 0;
    V.getInfo = getInfo;
    layout();
    renderSeats(null);
  }

  function renderSeats(hand) {
    V.hand = hand;
    V.seatEls.forEach((el, seat) => {
      const id = V.ids[seat];
      el.classList.toggle('empty', !id);
      if (!id) return;
      const info = V.getInfo(id);
      const hp = hand && hand.players[seat];
      el.classList.toggle('hero', id === 'hero');
      el.classList.toggle('folded', !!(hp && hp.folded));
      el.classList.toggle('out', !!(hand && !hp));
      const img = $('img', el);
      const expr = el.dataset.expr || 'neutral';
      const src = FS.ui.portrait(id, expr);
      if (img.getAttribute('src') !== src) img.src = src;
      img.alt = info.name;
      $('.nm', el).textContent = info.name;
      const stack = hp ? hp.stack : info.stack;
      $('.stk', el).textContent = hp && hp.allIn && !hand.done ? 'ALL-IN' : U.fmtChips(stack);
      $('.tag', el).textContent = info.tag || '';
      const pb = $('.pos-badge', el);
      if (hp && hp.pos) { pb.textContent = hp.pos; pb.classList.remove('hidden'); } else pb.classList.add('hidden');
      el.dataset.id = id;
    });
    renderBets(hand);
    positionDealer();
  }

  function renderHole(hand, heroSeat, reveal) {
    V.seatEls.forEach((el, seat) => {
      const hole = $('.hole', el);
      const hp = hand && hand.players[seat];
      if (!hp || !hp.cards.length || (hp.folded && seat !== heroSeat)) { hole.innerHTML = ''; return; }
      const show = seat === heroSeat || hp.shown || (reveal && reveal.includes(seat));
      hole.classList.toggle('shown', !!show && seat !== heroSeat);
      const want = show ? hp.cards.map((c) => cardHTML(c, { cls: hp.folded ? 'dim' : '' })).join('') : cardHTML(null, { back: true }) + cardHTML(null, { back: true });
      if (hole.dataset.sig !== want) { hole.innerHTML = want; hole.dataset.sig = want; }
    });
  }

  function renderBets(hand) {
    const area = $('#table-area');
    for (const k of Object.keys(V.betEls)) { V.betEls[k].remove(); delete V.betEls[k]; }
    if (!hand) return;
    for (const p of hand.players) {
      if (!p || !p.bet) continue;
      const el = h(`<div class="bet">${chipsHTML(p.bet)}<span class="amt">${U.fmtChips(p.bet)}</span></div>`);
      area.appendChild(el);
      V.betEls[p.seat] = el;
    }
    positionBets();
  }
  function positionBets() {
    if (!V.geo) return;
    for (const [seat, el] of Object.entries(V.betEls)) {
      const p = seatPoint(+seat, 0.66, 0.6);
      el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
    }
  }
  function positionDealer() {
    if (!V.geo || !V.hand) { if (V.dealerEl) V.dealerEl.style.display = V.hand ? '' : 'none'; return; }
    V.dealerEl.style.display = '';
    const seat = V.hand.button;
    const g = V.geo, d = disp(seat);
    const th = (90 + d * 40 + 17) * Math.PI / 180;
    V.dealerEl.style.left = g.cx + Math.cos(th) * g.rx * 0.84 + 'px';
    V.dealerEl.style.top = g.cy + Math.sin(th) * g.ry * 0.78 + 'px';
  }

  function renderBoard(board, highlight) {
    const el = $('#board');
    let html = '';
    for (let i = 0; i < 5; i++) {
      const c = board[i];
      html += c == null ? '<div class="slot"></div>' : cardHTML(c, { cls: highlight ? (highlight.includes(c) ? 'hi' : 'dim') : '' });
    }
    el.innerHTML = html;
  }
  function renderPot(hand) {
    const el = $('#pot');
    if (!hand) { el.innerHTML = ''; return; }
    const collected = hand.potBeforeBets();
    const total = hand.pot();
    el.innerHTML = (collected ? chipsHTML(collected, 4) : '') +
      `<div class="pot-label">POT ${U.fmtChips(collected)}</div>` +
      (total !== collected ? `<div class="pot-label sub">Total ${U.fmtChips(total)}</div>` : '');
  }

  function setActing(seat) {
    V.seatEls.forEach((el, i) => el.classList.toggle('acting', i === seat));
  }

  function bubble(seat, text, cls, ms) {
    const el = V.seatEls[seat];
    if (!el) return;
    $$('.bubble', el).forEach((b) => b.remove());
    const b = h(`<div class="bubble ${cls || ''}"></div>`);
    b.textContent = text;
    el.appendChild(b);
    setTimeout(() => b.remove(), ms || dur(1600));
  }
  function actionBubble(rec) {
    const map = { fold: 'Fold', check: 'Check', call: 'Call' };
    const type = rec.action || rec.type;
    let text = map[type] || '';
    let cls = 'act-' + type;
    if (type === 'call') text = 'Call ' + U.fmtChips(rec.added);
    if (type === 'raise') text = (rec.isBet ? 'Bet ' : 'Raise to ') + U.fmtChips(rec.amount);
    if (rec.allIn) { text = 'ALL-IN ' + U.fmtChips(rec.amount); cls = 'act-allin'; }
    bubble(rec.seat, text, cls, dur(1500));
  }
  function setExpr(seat, expr, ms) {
    const el = V.seatEls[seat];
    if (!el || !el.dataset.id) return;
    el.dataset.expr = expr;
    $('img', el).src = FS.ui.portrait(el.dataset.id, expr);
    clearTimeout(el._exprT);
    el._exprT = setTimeout(() => { el.dataset.expr = 'neutral'; $('img', el).src = FS.ui.portrait(el.dataset.id, 'neutral'); }, ms || 2600);
  }

  function banner(text, sub, cls, ms) {
    const el = $('#table-banner');
    el.innerHTML = `<div class="banner ${cls || ''}">${text}${sub ? `<small>${sub}</small>` : ''}</div>`;
    clearTimeout(V.bannerT);
    return new Promise((res) => { V.bannerT = setTimeout(() => { el.innerHTML = ''; res(); }, ms || 1800); });
  }
  function clearBanner() { $('#table-banner').innerHTML = ''; }

  // ---------- animations ----------
  function fly(el, fromEl, opts) {
    if (!el || !fromEl || !el.animate) return Promise.resolve();
    const a = fromEl.getBoundingClientRect(), b = el.getBoundingClientRect();
    const dx = a.left + a.width / 2 - (b.left + b.width / 2), dy = a.top + a.height / 2 - (b.top + b.height / 2);
    const anim = el.animate([
      { transform: `translate(${dx}px, ${dy}px) rotate(${(opts && opts.rot) || -25}deg) scale(.55)`, opacity: 0.2 },
      { transform: 'none', opacity: 1 },
    ], { duration: (opts && opts.duration) || dur(260), easing: 'cubic-bezier(.2,.8,.3,1)' });
    return anim.finished.catch(() => {});
  }
  async function dealIn(hand, heroSeat) {
    renderHole(null);
    V.seatEls.forEach((el) => { const hl = $('.hole', el); hl.innerHTML = ''; hl.dataset.sig = ''; });
    FS.audio.sfx.shuffle();
    await sleep(dur(650));
    const order = hand.order.slice(1).concat(hand.order[0]);
    const deck = $('#deck-spot');
    for (let r = 0; r < 2; r++) {
      for (const seat of order) {
        const hp = hand.players[seat];
        const hole = $('.hole', V.seatEls[seat]);
        const show = seat === heroSeat;
        hole.insertAdjacentHTML('beforeend', show ? cardHTML(hp.cards[r]) : cardHTML(null, { back: true }));
        FS.audio.sfx.deal();
        fly(hole.lastElementChild, deck);
        await sleep(dur(70));
      }
    }
    await sleep(dur(250));
    renderHole(hand, heroSeat);
  }
  async function collectBets(hand) {
    const pot = $('#pot');
    const els = Object.values(V.betEls);
    if (els.length) {
      FS.audio.sfx.chipsSlide();
      await Promise.all(els.map((el) => {
        const a = pot.getBoundingClientRect(), b = el.getBoundingClientRect();
        return el.animate([{ transform: 'translate(-50%,-50%)' }, { transform: `translate(calc(-50% + ${a.left + a.width / 2 - b.left - b.width / 2}px), calc(-50% + ${a.top + a.height / 2 - b.top - b.height / 2}px))`, opacity: 0.2 }],
          { duration: dur(300), easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {});
      }));
    }
    renderBets(null);
    renderPot(hand);
  }
  async function revealBoard(board, from) {
    const el = $('#board');
    for (let i = from; i < board.length; i++) {
      const slot = el.children[i];
      const cardEl = h(cardHTML(board[i]));
      if (slot) el.replaceChild(cardEl, slot); else el.appendChild(cardEl);
      FS.audio.sfx.flip();
      if (cardEl.animate) cardEl.animate([{ transform: 'rotateY(90deg) translateY(-12px)', filter: 'brightness(2)' }, { transform: 'none', filter: 'none' }], { duration: dur(240), easing: 'ease-out' });
      await sleep(dur(i < 3 && from === 0 ? 160 : 260));
    }
  }
  async function pushPot(winnings) {
    const pot = $('#pot');
    const area = $('#table-area');
    const flights = [];
    for (const [seat, amt] of Object.entries(winnings)) {
      const target = V.seatEls[seat];
      if (!target) continue;
      const el = h(`<div class="bet">${chipsHTML(amt, 4)}</div>`);
      area.appendChild(el);
      const a = pot.getBoundingClientRect(), ar = area.getBoundingClientRect();
      el.style.left = a.left - ar.left + a.width / 2 + 'px'; el.style.top = a.top - ar.top + a.height / 2 + 'px';
      const t = target.getBoundingClientRect(), b = el.getBoundingClientRect();
      flights.push(el.animate([{ transform: 'translate(-50%,-50%)' }, { transform: `translate(calc(-50% + ${t.left + t.width / 2 - b.left - b.width / 2}px), calc(-50% + ${t.top + t.height / 2 - b.top - b.height / 2}px))`, opacity: 0.3 }],
        { duration: dur(520), easing: 'cubic-bezier(.3,.1,.3,1)', fill: 'forwards' }).finished.catch(() => {}).then(() => el.remove()));
    }
    FS.audio.sfx.potWin();
    $('#pot').innerHTML = '';
    await Promise.all(flights);
  }
  function highlightWinners(seats) {
    V.seatEls.forEach((el, i) => el.classList.toggle('winner', seats.includes(i)));
  }
  function highlightHole(seat, cards) {
    const hole = $('.hole', V.seatEls[seat]);
    $$('.card', hole).forEach((c) => c.classList.toggle('hi', cards.includes(+c.dataset.card)));
  }

  FS.tableView = { init, layout, setTable, renderSeats, renderHole, renderBets, renderBoard, renderPot, setActing, bubble, actionBubble, setExpr, banner, clearBanner, dealIn, collectBets, revealBoard, pushPot, highlightWinners, highlightHole, dur, V, seatEl: (s) => V.seatEls[s] };
})(typeof window !== 'undefined' ? window : globalThis);
