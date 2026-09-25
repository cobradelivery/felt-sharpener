/* Strategy brain shared by the AI opponents and the built-in coach.
   analyze(hand, seat, opts) reads the public state (plus the seat's own cards), estimates what
   each opponent could hold from their actions, runs a Monte Carlo equity sim and recommends an
   action with plain-English reasons. AI personalities bend the thresholds via `style`. */
(function (root) {
  'use strict';
  const FS = root.FS;
  const C = FS.cards, PF = FS.preflop, U = FS.util;

  const COACH_STYLE = { name: 'coach', looseness: 1, aggression: 0.65, bluff: 0.25, station: 0, trap: 0, foldToPressure: 0.5, sizing: 0.66, noise: 0 };

  // ---------- helpers ----------
  function roundBet(x, bb) {
    const unit = bb >= 1000 ? bb / 10 : bb >= 100 ? 25 : 5;
    return Math.max(unit, Math.round(x / unit) * unit);
  }

  /** Quick strength tier of a 2-card hand on a board (cheap, for range filtering).
      0 air, 1 weak (ace-high / weak draw), 2 weak pair, 3 top pair / strong draw, 4 two pair+, 5 straight+ */
  function quickStrength(h, board) {
    if (board.length < 3) return 2;
    const all = [h[0], h[1], ...board];
    const score = C.evaluate(all);
    const cat = score >> 20;
    const bScore = C.evaluate(board);
    if (cat >= 4 && score !== bScore) return 5;
    if (cat >= 2 && (cat > (bScore >> 20))) return 4;
    const r0 = C.rankOf(h[0]), r1 = C.rankOf(h[1]);
    let topB = 0; for (const c of board) topB = Math.max(topB, C.rankOf(c));
    // draws
    let strongDraw = false, weakDraw = false;
    if (board.length < 5) {
      const suitCount = [0, 0, 0, 0];
      for (const c of all) suitCount[c & 3]++;
      if ((suitCount[h[0] & 3] >= 4) || (suitCount[h[1] & 3] >= 4)) strongDraw = true;
      let mask = 0; for (const c of all) mask |= 1 << C.rankOf(c);
      if (mask & (1 << 14)) mask |= 2;
      for (let lo = 1; lo <= 10; lo++) {
        const w = (mask >> lo) & 31;
        const bits = (w & 1) + ((w >> 1) & 1) + ((w >> 2) & 1) + ((w >> 3) & 1) + ((w >> 4) & 1);
        if (bits >= 4) {
          const hole = [r0, r1].some((r) => (r >= lo && r <= lo + 4) || (r === 14 && lo === 1));
          if (hole) { if ((w & 15) === 15 || (w & 30) === 30) strongDraw = true; else weakDraw = true; }
        }
      }
    }
    if (cat === 1) {
      const pr = (score >> 16) & 15;
      if (r0 === r1 && r0 > topB) return 3;
      if ((r0 === pr || r1 === pr) && pr === topB) return 3;
      if (r0 !== pr && r1 !== pr && r0 !== r1) return strongDraw ? 3 : (Math.max(r0, r1) >= 13 ? 1 : 0); // board pair
      return strongDraw ? 3 : 2;
    }
    if (strongDraw) return 3;
    if (weakDraw || Math.max(r0, r1) === 14) return 1;
    return 0;
  }

  // ---------- reading the preflop action ----------
  function preflopSummary(hand) {
    const acts = hand.actions.filter((a) => a.street === 'preflop');
    let raises = 0, limpers = 0, lastRaiser = -1, lastRaiseTo = hand.bbAmt;
    const bySeat = {};
    for (const a of acts) {
      const rec = bySeat[a.seat] || (bySeat[a.seat] = { raised: 0, called: 0, limped: false, threeBet: false, shoved: false, calledRaise: false });
      if (a.type === 'raise') {
        raises++; rec.raised++; lastRaiser = a.seat; lastRaiseTo = a.amount;
        if (raises >= 2) rec.threeBet = true;
        if (a.allIn) rec.shoved = true;
      } else if (a.type === 'call') {
        rec.called++;
        if (raises === 0) { limpers++; rec.limped = true; } else rec.calledRaise = true;
        if (a.allIn) rec.shoved = true;
      }
    }
    return { raises, limpers, lastRaiser, lastRaiseTo, bySeat };
  }

  /** Estimate an opponent's range as [lo, hi] percentiles + postflop filter strength. */
  function estimateRange(hand, oppSeat, read) {
    const p = hand.players[oppSeat];
    const looseness = read ? read.looseness : 1;
    const pre = preflopSummary(hand);
    const r = pre.bySeat[oppSeat];
    let lo = 0, hi = 1, desc = 'any two cards';
    const bb = hand.bbAmt;
    const open = U.clamp(PF.openRange(behindForSeat(hand, oppSeat)) * looseness, 0.05, 0.9);
    if (r) {
      if (r.threeBet && r.raised >= 2) { hi = U.clamp(0.03 * looseness, 0.02, 0.1); desc = 'only premium hands (they re-raised twice)'; }
      else if (r.threeBet) { hi = U.clamp(0.07 * looseness, 0.03, 0.25); desc = 'a strong range (they re-raised)'; }
      else if (r.shoved) { const bbs = p.startStack / bb; hi = U.clamp(PF.pushRange(bbs, behindForSeat(hand, oppSeat), !!hand.anteAmt) * looseness, 0.04, 0.9); desc = 'a short-stack all-in range'; }
      else if (r.raised) { hi = open; desc = 'the hands they would raise with from ' + (p.pos || 'their seat'); }
      else if (r.calledRaise) { lo = U.clamp(0.02 / looseness, 0, 0.04); hi = U.clamp(0.35 * looseness, 0.15, 0.85); desc = 'medium-strength hands that call a raise'; }
      else if (r.limped) { lo = 0.05; hi = U.clamp(0.55 * looseness, 0.3, 0.95); desc = 'weaker hands that limp in'; }
      else if (oppSeat === hand.bbSeat || oppSeat === hand.sbSeat) { desc = 'almost anything (they were in the blind)'; }
    } else if (oppSeat === hand.bbSeat) { desc = 'any two cards (big blind checked)'; }
    // Postflop aggression narrows the range
    const post = hand.actions.filter((a) => a.seat === oppSeat && a.street !== 'preflop');
    const aggr = post.filter((a) => a.type === 'raise').length;
    const calls = post.filter((a) => a.type === 'call').length;
    const bluffy = read ? U.clamp(read.aggression, 0.1, 1) : 0.5;
    const board = hand.board;
    let filter = null;
    if (board.length >= 3 && (aggr || calls)) {
      const need = aggr >= 2 ? 4 : aggr === 1 ? 3 : 2;
      const leak = aggr >= 2 ? 0.08 * bluffy : aggr === 1 ? 0.3 * bluffy : 0.35;
      filter = (h, rng) => quickStrength(h, board) >= need || rng() < leak;
      if (aggr) desc += aggr >= 2 ? ', narrowed to very strong hands by their big betting' : ', narrowed by their betting';
      else desc += ', narrowed to hands that would keep calling';
    }
    return { lo, hi, desc, filter, sampler: PF.rangeSampler(lo, hi, filter) };
  }

  /** Players left to act after this seat preflop (including blinds), for position-based ranges. */
  function behindForSeat(hand, seat) {
    const order = hand.order; // BTN, SB, BB, UTG...
    const n = order.length;
    const pre = order.slice(3).concat(order.slice(0, 3)); // preflop acting order (n>=3)
    if (n === 2) return seat === hand.button ? 1 : 0.5;
    const idx = pre.indexOf(seat);
    return Math.max(1, n - 1 - idx);
  }

  function effectiveStack(hand, seat) {
    const me = hand.players[seat];
    const mine = me.stack + me.bet;
    let other = 0;
    for (const p of hand.inHand) if (p.seat !== seat) other = Math.max(other, p.stack + p.bet);
    return Math.min(mine, other);
  }

  // ---------- main analysis ----------
  /**
   * opts: { style, iterations, rng, reads: {seat: {looseness, aggression}}, forCoach }
   * returns analysis object with .rec = {type, to, label, kind}
   */
  function analyze(hand, seat, opts) {
    opts = opts || {};
    const style = Object.assign({}, COACH_STYLE, opts.style || {});
    const rng = opts.rng || Math.random;
    const iters = opts.iterations || 600;
    const L = hand.legal(seat);
    const me = hand.players[seat];
    const bb = hand.bbAmt;
    const pot = hand.pot();
    const toCall = L ? L.toCall : 0;
    const opps = hand.inHand.filter((p) => p.seat !== seat);
    const eff = effectiveStack(hand, seat);
    const code = C.handCode(me.cards[0], me.cards[1]);
    const A = {
      seat, street: hand.street, code, pos: me.pos, bb, pot, toCall, eff, effBB: eff / bb,
      stackBB: (me.stack + me.bet) / bb, nOpp: opps.length, legal: L, reasons: [], style: style.name,
      potOdds: toCall > 0 ? toCall / (pot + toCall) : 0,
      pctile: PF.PCT[code], tier: PF.tierOf(code),
    };
    A.ranges = {};
    for (const o of opps) A.ranges[o.seat] = estimateRange(hand, o.seat, opts.reads && opts.reads[o.seat]);
    // equity vs estimated ranges
    const samplers = opps.map((o) => A.ranges[o.seat].sampler);
    const eqIters = hand.street === 'preflop' ? Math.round(iters * 0.6) : iters;
    const eq = C.equity(me.cards, hand.board, samplers, eqIters, rng);
    A.equity = eq.equity;
    A.handInfo = C.analyzeHand(me.cards, hand.board);
    if (!L) { A.rec = null; return A; }
    if (hand.street === 'preflop') preflopRec(hand, seat, A, style, rng);
    else postflopRec(hand, seat, A, style, rng);
    // sanitize amounts
    if (A.rec.type === 'raise') {
      let to = Math.round(A.rec.to);
      if (to >= L.maxRaiseTo * 0.8 || to >= L.maxRaiseTo) to = L.maxRaiseTo; // commit instead of leaving crumbs
      to = U.clamp(to, L.minRaiseTo, L.maxRaiseTo);
      if (to < L.maxRaiseTo) to = Math.min(L.maxRaiseTo, Math.max(L.minRaiseTo, roundBet(to, bb)));
      A.rec.to = to;
      A.rec.allIn = to === L.maxRaiseTo;
      if (!L.canRaise) A.rec = { type: toCall ? 'call' : 'check', kind: A.rec.kind };
    }
    if (A.rec.type === 'fold' && toCall === 0) A.rec = { type: 'check', kind: 'free' };
    if (A.rec.type === 'call' && toCall === 0) A.rec.type = 'check';
    return A;
  }

  function preflopRec(hand, seat, A, style, rng) {
    const pre = preflopSummary(hand);
    const L = A.legal, bb = A.bb;
    const p = A.pctile;
    const loose = style.looseness * (1 + (style.noise ? (rng() - 0.5) * style.noise : 0));
    const behind = behindForSeat(hand, seat);
    const isBB = seat === hand.bbSeat, isSB = seat === hand.sbSeat;
    A.facing = pre.raises === 0 ? (pre.limpers ? 'limpers' : 'unopened') : pre.raises === 1 ? 'raise' : pre.raises === 2 ? '3bet' : '4bet';
    A.pre = pre;
    A.behind = behind;
    const shortPush = A.effBB <= 11 || (A.facing === 'unopened' && A.effBB <= 14);
    const raiserSeat = pre.lastRaiser;
    const raiserRange = raiserSeat >= 0 ? A.ranges[raiserSeat] : null;
    const facingShove = raiserSeat >= 0 && hand.players[raiserSeat].allIn;
    A.facingShove = facingShove;
    const need = A.potOdds;

    // Facing an all-in (or a raise that commits us) — pure equity vs their range decision.
    if (A.facing !== 'unopened' && A.facing !== 'limpers' && (facingShove || L.toCall >= (hand.players[seat].stack) * 0.5)) {
      const margin = 0.02 + (style.foldToPressure - 0.5) * 0.08 - style.station * 0.08;
      if (A.equity >= need + margin) A.rec = { type: 'call', kind: 'call-allin' };
      else A.rec = { type: 'fold', kind: 'fold-allin' };
      A.threshold = need;
      return;
    }
    if (A.facing === 'unopened' || A.facing === 'limpers') {
      if (shortPush && A.facing === 'unopened') {
        const pr = PF.pushRange(A.effBB, behind, !!hand.anteAmt) * loose;
        A.threshold = pr;
        if (p <= pr) A.rec = { type: 'raise', to: L.maxRaiseTo, kind: 'shove' };
        else A.rec = { type: isBB ? 'check' : 'fold', kind: 'push-fold' };
        return;
      }
      let r = (hand.seated.length === 2 ? 0.8 : PF.openRange(behind)) * loose;
      if (A.facing === 'limpers') r *= 0.6;
      A.threshold = r;
      const size = (isSB ? 3 : A.effBB < 25 ? 2.2 : 2.5) * bb + pre.limpers * bb;
      if (p <= r) {
        if (A.effBB <= 18 && p <= r * 0.5 && A.facing === 'limpers') A.rec = { type: 'raise', to: L.maxRaiseTo, kind: 'shove' };
        else if (style.aggression < 0.35 && p > 0.06 && !isBB && rng() < (1 - style.aggression) * 0.75) A.rec = { type: 'call', kind: 'limp' };
        else A.rec = { type: 'raise', to: size, kind: A.facing === 'limpers' ? 'isolate' : 'open' };
      } else if (isBB) A.rec = { type: 'check', kind: 'free' };
      else if ((A.facing === 'limpers' || isSB) && p <= Math.min(0.85, r * 1.9 + style.station * 0.4) && A.effBB > 20) A.rec = { type: 'call', kind: 'limp' };
      else if (style.station > 0.5 && p <= 0.5 + style.station * 0.3 && A.effBB > 15) A.rec = { type: 'call', kind: 'limp' };
      else A.rec = { type: 'fold', kind: 'fold-weak' };
      return;
    }
    // Facing a raise / 3-bet
    const R = raiserRange ? raiserRange.hi : 0.2;
    const callers = hand.actions.filter((a) => a.street === 'preflop' && a.type === 'call').length;
    const raiseBB = pre.lastRaiseTo / bb;
    const commitFrac = pre.lastRaiseTo / Math.max(1, A.eff);
    const posBonus = (seat === hand.button || behind <= 2) ? 1.15 : 1;
    if (A.facing === 'raise') {
      const valueR = R * 0.3 * loose;
      let callR = R * 0.65 * loose * posBonus / (1 + callers * 0.15);
      if (isBB) callR = Math.max(callR, R * (raiseBB <= 2.6 ? 1.1 : 0.85) * loose);
      callR += style.station * 0.2;
      A.threshold = callR;
      A.valueThreshold = valueR;
      if (commitFrac > 0.3 || A.effBB <= 20) {
        // too shallow to call and fold later: re-shove or fold
        if (p <= R * 0.45 * loose) A.rec = { type: 'raise', to: L.maxRaiseTo, kind: 'reshove' };
        else if (A.equity >= A.potOdds + 0.05 && p <= callR) A.rec = { type: 'call', kind: 'defend' };
        else A.rec = { type: 'fold', kind: 'fold-vs-raise' };
        return;
      }
      if (p <= valueR || (rng() < style.bluff * 0.15 && p <= 0.45 && style.aggression > 0.6)) {
        const to = pre.lastRaiseTo * (seat === hand.button ? 3 : 3.5) + callers * pre.lastRaiseTo;
        A.rec = { type: 'raise', to, kind: p <= valueR ? '3bet' : '3bet-bluff' };
      } else if (p <= callR) A.rec = { type: 'call', kind: isBB ? 'bb-defend' : 'call-raise' };
      else A.rec = { type: 'fold', kind: 'fold-vs-raise' };
      return;
    }
    // 3-bet or more
    const myRaised = pre.bySeat[seat] && pre.bySeat[seat].raised;
    const strongR = (A.facing === '4bet' ? 0.018 : 0.03) * loose;
    let callR = (myRaised ? 0.08 : 0.05) * loose + style.station * 0.08;
    A.threshold = callR;
    if (p <= strongR) A.rec = { type: 'raise', to: commitFrac > 0.25 ? L.maxRaiseTo : pre.lastRaiseTo * 2.3, kind: '4bet' };
    else if (p <= callR && commitFrac < 0.35) A.rec = { type: 'call', kind: 'call-3bet' };
    else if (p <= callR * 1.2 && A.equity > A.potOdds + 0.04) A.rec = { type: 'call', kind: 'call-3bet' };
    else A.rec = { type: 'fold', kind: 'fold-vs-3bet' };
  }

  function postflopRec(hand, seat, A, style, rng) {
    const L = A.legal, bb = A.bb, pot = A.pot;
    const n = A.nOpp;
    const eq = A.equity;
    const hi = A.handInfo;
    const street = hand.street;
    const strongDraw = hi.outs >= 8 && street !== 'river';
    const valueT = [0.6, 0.6, 0.47, 0.38, 0.32, 0.28][Math.min(5, n)] - (style.aggression - 0.5) * 0.08;
    const isPFA = hand.preflopAggressor === seat;
    const lastToAct = isLastToAct(hand, seat);
    const spr = A.eff / Math.max(1, pot);
    A.valueThreshold = valueT;
    A.spr = spr;
    A.strongDraw = strongDraw;
    A.inPosition = lastToAct;
    const sizing = (frac) => roundBet(Math.max(bb, pot * frac), bb);

    if (L.toCall > 0) {
      const need = A.potOdds;
      let implied = 0;
      if (strongDraw && street === 'flop' && spr > 3) implied = 0.06;
      else if (strongDraw && street === 'turn' && spr > 2) implied = 0.04;
      const margin = 0.01 + (style.foldToPressure - 0.5) * 0.06 - style.station * 0.12;
      A.threshold = need - implied + margin;
      A.implied = implied;
      const raiseT = Math.max(valueT + 0.12, 0.66) - (style.aggression - 0.5) * 0.06;
      if (eq >= raiseT && !(style.trap && rng() < style.trap)) {
        const to = hand.currentBet * 2.8 + (pot - hand.currentBet) * 0.3;
        A.rec = { type: 'raise', to: spr < 1.5 ? L.maxRaiseTo : to, kind: 'raise-value' };
      } else if (strongDraw && n === 1 && rng() < style.aggression * 0.35 && street === 'flop' && L.canRaise) {
        A.rec = { type: 'raise', to: hand.currentBet * 3, kind: 'semi-bluff-raise' };
      } else if (eq >= A.threshold) {
        A.rec = { type: 'call', kind: strongDraw && eq < need + 0.05 ? 'call-draw' : 'call' };
      } else A.rec = { type: 'fold', kind: 'fold-post' };
      return;
    }
    // No bet to us
    let frac = style.sizing;
    if (eq >= valueT) {
      if (style.trap && rng() < style.trap && street !== 'river') { A.rec = { type: 'check', kind: 'slowplay' }; return; }
      if (eq > 0.85 && street === 'river') frac = Math.max(frac, 0.8);
      const to = sizing(frac);
      A.rec = { type: 'raise', to: to >= A.eff * 0.6 ? L.maxRaiseTo : to, kind: 'value-bet' };
      return;
    }
    if (strongDraw && (n === 1 || lastToAct) && (style.name === 'coach' || rng() < 0.3 + style.aggression * 0.5)) {
      A.rec = { type: 'raise', to: sizing(Math.min(0.6, frac)), kind: 'semi-bluff' };
      return;
    }
    if (isPFA && street === 'flop' && n <= 2 && (style.name === 'coach' ? (n === 1 && eq >= 0.3) : rng() < 0.45 + style.aggression * 0.4)) {
      A.rec = { type: 'raise', to: sizing(0.4), kind: 'c-bet' };
      return;
    }
    if (style.name !== 'coach' && n === 1 && eq < 0.3 && rng() < style.bluff * (street === 'river' ? 0.5 : 0.35)) {
      A.rec = { type: 'raise', to: sizing(Math.max(0.5, frac)), kind: 'bluff' };
      return;
    }
    if (eq >= valueT - 0.12 && lastToAct && n === 1 && street !== 'river' && style.name === 'coach') {
      A.rec = { type: 'check', kind: 'pot-control' };
      return;
    }
    A.rec = { type: 'check', kind: eq >= valueT - 0.15 ? 'pot-control' : 'check-weak' };
  }

  function isLastToAct(hand, seat) {
    // In position = every other live player acts before us post-flop (we are closest to the button)
    const live = hand.inHand.filter((p) => !p.allIn).map((p) => p.seat);
    if (live.length <= 1) return true;
    const dist = (s) => (s - hand.button + hand.size) % hand.size || hand.size;
    return live.every((s) => dist(s) <= dist(seat));
  }

  FS.strategy = { analyze, estimateRange, preflopSummary, quickStrength, behindForSeat, effectiveStack, isLastToAct, roundBet, COACH_STYLE };
})(typeof window !== 'undefined' ? window : globalThis);
