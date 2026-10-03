/* Math Drills — pot odds, outs and call/fold practice until the math is automatic.
   The question generators below are pure functions (seedable rng in, plain question object out) so they
   load and get tested under Node; only the "UI" half at the bottom touches the DOM. */
(function (root) {
  'use strict';
  const FS = root.FS;
  const C = FS.cards, U = FS.util;

  const TYPES = ['potodds', 'outs', 'callfold', 'betsize', 'equity'];
  const TYPE_INFO = {
    potodds: { label: 'Pot odds', short: 'Pot odds', sub: '% you need to call' },
    outs: { label: 'Count the outs', short: 'Outs', sub: 'cards that complete your draw' },
    callfold: { label: 'Call or fold', short: 'Call / fold', sub: 'outs vs. price' },
    betsize: { label: 'Bet-size shortcuts', short: 'Bet sizes', sub: '½ pot → 25% …' },
    equity: { label: 'Estimate equity', short: 'Equity', sub: 'who’s ahead, and by how much' },
  };
  /** A percentage answer counts as right when it is within this distance of the exact value. */
  const TOL = 0.02;
  /** Options are kept at least this far apart, so exactly one can be within TOL of the truth. */
  const GAP = 0.04;
  /** Call/fold spots must clear the break-even point by at least this much. */
  const MARGIN = 0.04;
  const TIMER_MS = 15000;

  // ---------- math ----------
  /** Win % needed to call `bet` into `pot` (pot before the bet): you risk bet to win pot + bet + your bet. */
  const potOddsNeeded = (pot, bet) => bet / (pot + 2 * bet);
  const BET_SIZES = [
    { f: 1 / 3, label: '⅓ pot' }, { f: 1 / 2, label: '½ pot' }, { f: 2 / 3, label: '⅔ pot' },
    { f: 3 / 4, label: '¾ pot' }, { f: 1, label: 'pot' }, { f: 2, label: '2× pot' },
  ];
  /** Same thing for a bet expressed as a fraction of the pot. */
  const betSizeNeeded = (f) => f / (1 + 2 * f);
  /** "28.6%" / "25%" — one decimal only when it matters. */
  function fmtPct(x) {
    const p = Math.round(x * 1000) / 10;
    return (Math.abs(p - Math.round(p)) < 0.05 ? String(Math.round(p)) : p.toFixed(1)) + '%';
  }
  const fmtPct0 = (x) => Math.round(x * 100) + '%';
  const fc = (n) => U.fmtChips(n);
  const cardsTxt = (cs) => cs.map(C.cardPretty).join(' ');

  function shuffled(arr, rng) { return U.shuffleInPlace(arr.slice(), rng); }

  /** Four percentage options: the truth plus distractors (in order of preference), all >= GAP apart. */
  function pctOptions(truth, distractors, rng, fmt) {
    const vals = [truth];
    const ok = (v) => v > 0.02 && v < 0.95 && vals.every((x) => Math.abs(x - v) >= GAP);
    for (const d of distractors) { if (vals.length >= 4) break; if (ok(d)) vals.push(d); }
    for (const d of [0.08, -0.08, 0.14, -0.14, 0.2, -0.2, 0.27, 0.34, 0.41]) { if (vals.length >= 4) break; if (ok(truth + d)) vals.push(truth + d); }
    return shuffled(vals, rng).map((v) => ({ value: v, label: fmt(v), correct: Math.abs(v - truth) <= TOL }));
  }

  function potAndBet(rng, fracs) {
    const unit = rng.pick([50, 100, 100, 200, 250, 500, 1000]);
    const pot = unit * (6 + rng.int(19));
    const f = rng.pick(fracs || [0.25, 0.33, 0.4, 0.5, 0.5, 0.6, 0.66, 0.75, 0.75, 0.8, 1, 1, 1.25, 1.5]);
    const bet = Math.max(unit, Math.round((pot * f) / unit) * unit);
    return { pot, bet };
  }

  // ---------- 1. pot odds ----------
  function genPotOdds(rng) {
    const { pot, bet } = potAndBet(rng);
    const truth = potOddsNeeded(pot, bet);
    const total = pot + 2 * bet;
    const options = pctOptions(truth, shuffled([bet / (pot + bet), bet / pot, bet / (2 * (pot + bet)), bet / (pot + 3 * bet)], rng), rng, fmtPct0);
    return {
      type: 'potodds', kind: 'choice', pot, bet, truth, options,
      prompt: `The pot is **${fc(pot)}**. Your opponent bets **${fc(bet)}**. What % do you need to win to call?`,
      answerText: fmtPct(truth),
      explain: [
        `You call **${fc(bet)}** to win the pot (${fc(pot)}) + their bet (${fc(bet)}) + your own call (${fc(bet)}) = **${fc(total)}** in total.`,
        `${fc(bet)} ÷ ${fc(total)} = **${fmtPct(truth)}**. That is your [[pot odds]]: if your [[equity]] (chance to win) is higher than that, calling makes money in the long run.`,
        `Common slip: ${fc(bet)} ÷ ${fc(pot + bet)} = ${fmtPct(bet / (pot + bet))} forgets to count your own call in the final pot.`,
      ],
    };
  }

  // ---------- 4. bet-size shortcuts ----------
  function genBetSize(rng) {
    const bs = rng.pick(BET_SIZES);
    const truth = betSizeNeeded(bs.f);
    const others = shuffled(BET_SIZES.filter((b) => b !== bs).map((b) => betSizeNeeded(b.f)), rng);
    const options = pctOptions(truth, [bs.f / (1 + bs.f)].concat(others, [Math.min(bs.f, 0.6), 0.5, 0.15]), rng, fmtPct);
    const pot = 300, bet = Math.round(pot * bs.f), total = pot + 2 * bet; // 300 divides cleanly by every size
    return {
      type: 'betsize', kind: 'choice', fraction: bs.f, sizeLabel: bs.label, truth, options,
      prompt: `Your opponent bets **${bs.label}**${bs.f === 1 ? ' (the size of the pot)' : ''}. What % do you need to win to call?`,
      answerText: fmtPct(truth),
      explain: [
        `Picture a pot of ${pot}. A ${bs.label} bet is **${bet}**. You call ${bet} to win ${pot} + ${bet} + ${bet} = **${fc(total)}**.`,
        `${bet} ÷ ${fc(total)} = **${fmtPct(truth)}** — that’s the [[pot odds]] for this bet size, whatever the actual chip amounts.`,
        'Memorise the ladder: ⅓ pot → 20% · ½ → 25% · ⅔ → 28.6% · ¾ → 30% · pot → 33% · 2× pot → 40%.',
      ],
    };
  }

  // ---------- draws (shared by "count the outs" and "call or fold") ----------
  function rankMask(cards) { let m = 0; for (const c of cards) m |= 1 << C.rankOf(c); return m; }
  const hasRank = (mask, r) => !!(mask & (1 << (r === 1 ? 14 : r)));
  const isStraight = (cards) => C.straightHigh(rankMask(cards)) > 0;
  function isFlush(cards) { const n = [0, 0, 0, 0]; for (const c of cards) n[C.suitOf(c)]++; return Math.max(...n) >= 5; }

  /** Name a straight draw from the ranks that complete it. */
  function straightDrawName(ranks, mask) {
    if (!ranks.length) return '';
    if (ranks.length === 2) {
      const lo = ranks.map((r) => (r === 14 && ranks.includes(6) ? 1 : r));
      const a = Math.min(...lo), b = Math.max(...lo);
      if (b - a === 5 && [1, 2, 3, 4].every((k) => hasRank(mask, a + k))) return 'open-ended straight draw';
      return 'double gutshot straight draw';
    }
    const r = ranks[0];
    const run = (from) => [0, 1, 2, 3].every((k) => from + k >= 1 && from + k <= 14 && hasRank(mask, from + k));
    if (run(r + 1) || run(r - 4) || (r === 14 && run(2))) return 'one-ended straight draw';
    return 'gutshot straight draw';
  }

  /**
   * Analyse a hero hand + flop/turn as a clean drawing spot, or return null when it is not one.
   * Outs are exactly what the game engine counts (FS.cards.analyzeHand): unseen cards that give the
   * hero a straight or better. Clean = hero has no pair (so no pair-improvement outs), the board is
   * unpaired with at most two cards of a suit, and on the turn no river card can make a straight on
   * the board by itself.
   */
  function drawInfo(hero, board) {
    const a = C.analyzeHand(hero, board);
    if (a.cat !== 0 || !a.outs) return null;
    const sc = [0, 0, 0, 0];
    for (const c of board) sc[C.suitOf(c)]++;
    if (Math.max(...sc) > 2) return null;
    const bmask = rankMask(board);
    if (board.length === 4) for (let r = 2; r <= 14; r++) if (!(bmask & (1 << r)) && C.straightHigh(bmask | (1 << r))) return null;
    const all = hero.concat(board);
    const mask = rankMask(all);
    const flushOuts = [], straightOuts = [];
    const sRanks = new Set();
    for (const c of a.outCards) {
      const seven = all.concat([c]);
      if (isFlush(seven)) flushOuts.push(c);
      if (isStraight(seven)) { straightOuts.push(c); sRanks.add(C.rankOf(c)); }
    }
    if (flushOuts.length + straightOuts.length < a.outs) return null; // safety: an out we can't name
    const ranks = Array.from(sRanks).sort((x, y) => x - y);
    if (ranks.length > 2) return null;
    const draws = [];
    if (flushOuts.length) draws.push('flush draw');
    const sName = straightDrawName(ranks, mask);
    if (sName) draws.push(sName);
    const both = flushOuts.filter((c) => straightOuts.includes(c));
    const kind = flushOuts.length && ranks.length ? 'combo' : flushOuts.length ? 'flush' : sName.startsWith('open') || sName.startsWith('double') ? 'oesd' : 'gutshot';
    const unseen = 52 - all.length;
    return { outs: a.outs, outCards: a.outCards.slice().sort((x, y) => y - x), flushOuts, straightOuts, overlap: both, straightRanks: ranks, draws, kind, unseen, street: board.length === 3 ? 'flop' : 'turn' };
  }

  /** Deal a random clean drawing spot of the requested kind ('flush' | 'oesd' | 'gutshot' | 'combo'). */
  function dealDrawSpot(rng, kind, street) {
    kind = kind || rng.pick(['flush', 'flush', 'oesd', 'oesd', 'gutshot', 'combo']);
    street = street || (rng() < 0.7 ? 'flop' : 'turn');
    const nb = street === 'flop' ? 3 : 4;
    for (let tries = 0; tries < 20000; tries++) {
      let hero, board;
      if (kind === 'flush' || kind === 'combo') {
        const s = rng.int(4);
        const suited = shuffled([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((r) => C.makeCard(r + 2, s)), rng);
        hero = suited.slice(0, 2);
        board = suited.slice(2, 4);
        const rest = shuffled(C.newDeck().filter((c) => C.suitOf(c) !== s), rng);
        board = shuffled(board.concat(rest.slice(0, nb - 2)), rng);
      } else {
        const d = shuffled(C.newDeck(), rng);
        hero = d.slice(0, 2); board = d.slice(2, 2 + nb);
      }
      const info = drawInfo(hero, board);
      if (!info || info.kind !== kind) continue;
      return { hero, board, info };
    }
    throw new Error('could not deal a ' + kind + ' spot');
  }

  function drawLabel(info) {
    if (info.kind === 'combo') return 'combo draw (' + info.draws.join(' + ') + ')';
    return info.draws.join(' + ');
  }
  /** Plain-English breakdown of where the outs come from. */
  function outsBreakdown(info) {
    const parts = [];
    if (info.flushOuts.length) parts.push(`**${info.flushOuts.length}** cards of your suit complete the flush`);
    if (info.straightRanks.length) {
      const names = info.straightRanks.map((r) => C.RANK_PLURAL[r]).join(' or ');
      const extra = info.straightOuts.length - info.overlap.length;
      const ov = info.overlap.length;
      parts.push(info.flushOuts.length ? `**${extra}** more ${names} make the straight (${ov === 1 ? 'the other one is' : ov + ' of them are'} already counted as a flush card — count each card once)` : `the four ${names} make the straight — **${info.straightOuts.length}** cards`);
    }
    return parts.join('; ') + '.';
  }

  // ---------- 2. count the outs ----------
  function genOuts(rng) {
    const { hero, board, info } = dealDrawSpot(rng);
    const n = info.outs;
    const pool = shuffled([4, 6, 8, 9, 12, 15, n - 1, n + 1, n + 2, n - 2, n + 3, n + 4].filter((x, i, a) => x > 0 && x !== n && a.indexOf(x) === i), rng);
    const prefer = pool.filter((x) => [4, 8, 9, 12, 15].includes(x)).concat(pool.filter((x) => ![4, 8, 9, 12, 15].includes(x)));
    const vals = shuffled([n].concat(prefer.slice(0, 3)), rng);
    const options = vals.map((v) => ({ value: v, label: String(v), correct: v === n }));
    const next = n / info.unseen;
    const explain = [
      `You have a **${drawLabel(info)}**: ${outsBreakdown(info)}`,
      `That’s **${n} [[outs]]**. On the ${info.street} there are ${info.unseen} cards you can’t see, so the exact chance to hit on the next card is ${n} ÷ ${info.unseen} = **${fmtPct(next)}**.`,
      info.street === 'flop'
        ? `[[rule of 2 and 4|Rule of 2 and 4]]: ${n} × 2 ≈ **${n * 2}%** for the turn card alone; ${n} × 4 ≈ **${Math.min(n * 4, 100)}%** by the river — but only if you get to see both cards (e.g. someone is all-in).`
        : `[[rule of 2 and 4|Rule of 2]]: with one card to come, ${n} × 2 ≈ **${n * 2}%**.`,
    ];
    if (hero.some((c) => C.rankOf(c) > Math.max(...board.map(C.rankOf)))) explain.push('Pairing an overcard might also win, but those are weak “maybe” outs — here we only count cards that make a straight or flush.');
    return {
      type: 'outs', kind: 'choice', hero, board, info, truth: n, options,
      prompt: `How many [[outs]] do you have to make a **straight or a flush** on the next card?`,
      answerText: `${n} outs`,
      explain,
    };
  }

  // ---------- 3. call or fold ----------
  function genCallFold(rng) {
    const want = rng() < 0.5 ? 'call' : 'fold';
    let spot = null;
    for (let tries = 0; tries < 400 && !spot; tries++) {
      const kind = want === 'call' ? rng.pick(['flush', 'oesd', 'combo', 'combo']) : rng.pick(['flush', 'oesd', 'gutshot', 'gutshot', 'combo']);
      const d = dealDrawSpot(rng, kind);
      for (let k = 0; k < 12; k++) {
        const pb = potAndBet(rng, want === 'call' ? [0.25, 0.25, 0.33, 0.4, 0.5, 0.66] : [0.5, 0.66, 0.75, 1, 1, 1.5, 2]);
        const need = potOddsNeeded(pb.pot, pb.bet), hit = d.info.outs / d.info.unseen;
        if (Math.abs(hit - need) < MARGIN) continue;
        if ((hit > need ? 'call' : 'fold') !== want && tries < 300) continue;
        spot = Object.assign({}, d, pb, { need, hit });
        break;
      }
    }
    const { hero, board, info, pot, bet, need, hit } = spot;
    const answer = hit > need ? 'call' : 'fold';
    const total = pot + 2 * bet;
    const explain = [
      `**Outs:** your ${drawLabel(info)} gives you **${info.outs}** [[outs]].`,
      `**Chance to hit:** ${info.outs} ÷ ${info.unseen} unseen cards = **${fmtPct(hit)}** on the next card (rule of 2: ${info.outs} × 2 ≈ ${info.outs * 2}%).` +
        (info.street === 'flop' ? ' Count one card at a time: if you miss the turn you will probably face another bet, so use the next-card odds, not the ×4 river odds.' : ''),
      `**Price:** call ${fc(bet)} to win ${fc(pot)} + ${fc(bet)} + ${fc(bet)} = ${fc(total)} → ${fc(bet)} ÷ ${fc(total)} = **${fmtPct(need)}** needed ([[pot odds]]).`,
      `**Decision:** ${fmtPct(hit)} ${answer === 'call' ? '>' : '<'} ${fmtPct(need)} → **${answer === 'call' ? 'CALL' : 'FOLD'}**${answer === 'call' ? ' — your [[equity]] is bigger than the price.' : ' — the price is higher than your chance to hit.'}`,
    ];
    if (answer === 'fold' && need - hit < 0.1) explain.push('It’s not far off: with [[implied odds]] (extra chips you expect to win later when you hit) some players call here. We grade on direct odds — the safe habit for your first tournament.');
    else if (answer === 'call') explain.push('Bonus: when you hit, you may win more chips later ([[implied odds]]), which makes the call even better.');
    return {
      type: 'callfold', kind: 'callfold', hero, board, info, pot, bet, hit, need, answer,
      prompt: `The pot is **${fc(pot)}**. Your opponent bets **${fc(bet)}**. You’re on a draw — call or fold?`,
      note: 'Assume hitting your draw wins and missing loses.',
      answerText: answer === 'call' ? 'Call' : 'Fold',
      explain,
    };
  }

  // ---------- 5. estimate equity ----------
  const EQ_ITERS = 24000;
  /** Exact equity (wins + ties/2) of hero vs one known hand by enumerating every runout (flop / turn / river). */
  function exactEquity(hero, opp, board) {
    const dead = new Uint8Array(52);
    hero.concat(opp, board).forEach((c) => (dead[c] = 1));
    const live = [];
    for (let c = 0; c < 52; c++) if (!dead[c]) live.push(c);
    const need = 5 - board.length;
    let eq = 0, n = 0;
    const score = (run) => { const b = board.concat(run); const h = C.evaluate(hero.concat(b)), o = C.evaluate(opp.concat(b)); eq += h > o ? 1 : h === o ? 0.5 : 0; n++; };
    if (need === 0) score([]);
    else if (need === 1) for (const c of live) score([c]);
    else if (need === 2) for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) score([live[i], live[j]]);
    else throw new Error('exactEquity needs a flop, turn or river');
    return eq / n;
  }
  /** Hero equity vs a known hand: exact postflop, seeded Monte Carlo preflop (±~0.5%). */
  function equityVsHand(hero, opp, board, rng) {
    if (board.length >= 3) return exactEquity(hero, opp, board);
    return C.equity(hero, board, [() => opp], EQ_ITERS, rng || U.makeRng(1)).equity;
  }
  /** Hero equity vs the top `p` of starting hands (Monte Carlo). */
  function equityVsRange(hero, p, rng) {
    return C.equity(hero, [], [FS.preflop.rangeSampler(0, p)], EQ_ITERS, rng || U.makeRng(1)).equity;
  }

  const RNAME = (r) => C.RANK_NAME[r];
  /** Name a starting hand in words: "pocket Nines", "Ace-King suited". */
  function holeName(h) {
    const [a, b] = h.map(C.rankOf).sort((x, y) => y - x);
    if (a === b) return 'pocket ' + C.RANK_PLURAL[a];
    return RNAME(a) + '-' + RNAME(b) + (C.suitOf(h[0]) === C.suitOf(h[1]) ? ' suited' : '');
  }

  /**
   * Preflop matchup category between two hands, from hero's side, with the classic rule of thumb.
   * thumb = hero's rough equity; myth = a tempting wrong estimate + what that misconception is.
   */
  function preflopMatchup(hero, opp) {
    const hr = hero.map(C.rankOf).sort((x, y) => y - x), or = opp.map(C.rankOf).sort((x, y) => y - x);
    const hp = hr[0] === hr[1], op = or[0] === or[1];
    const flip = (m) => Object.assign({}, m, { thumb: 1 - m.thumb, hero: m.opp, opp: m.hero, side: m.side === 'fav' ? 'dog' : m.side === 'dog' ? 'fav' : m.side });
    if (hp && op) {
      if (hr[0] === or[0]) return { key: 'samepair', label: 'same pair', rule: 'same pair ≈ a split pot', thumb: 0.5, side: 'even' };
      const m = { key: 'overunder', label: 'overpair vs underpair', rule: 'bigger pair vs smaller pair ≈ 80/20 — the small pair needs to hit a set (about 1 time in 5)', thumb: 0.81, side: 'fav' };
      return hr[0] > or[0] ? m : flip(m);
    }
    if (hp || op) {
      const P = hp ? hr[0] : or[0], [x, y] = hp ? or : hr;
      let m;
      if (y > P) m = { key: 'pairovers', label: 'pair vs two overcards', rule: 'pair vs two higher cards ≈ a coin flip, 55/45 for the pair', thumb: 0.55, side: 'fav' };
      else if (x > P) m = { key: 'pairone', label: 'pair vs one overcard', rule: 'pair vs one higher card ≈ 70/30 for the pair', thumb: 0.7, side: 'fav' };
      else m = { key: 'pairunders', label: 'pair vs two undercards', rule: 'pair vs two lower cards ≈ 80–85% for the pair', thumb: 0.83, side: 'fav' };
      return hp ? m : flip(m);
    }
    const shared = hr.find((r) => or.includes(r));
    if (shared) {
      const hk = hr[0] === shared ? hr[1] : hr[0], ok = or[0] === shared ? or[1] : or[0];
      if (hk === ok) return { key: 'samehand', label: 'same hand', rule: 'same two ranks ≈ a split pot (a flush can break the tie)', thumb: 0.5, side: 'even' };
      const m = { key: 'dominated', label: 'dominated hand', rule: `when you share a card, the better [[kicker]] dominates: the dominated hand has only ≈ 25–30%`, thumb: 0.72, side: 'fav' };
      return hk > ok ? m : flip(m);
    }
    if (hr[1] > or[0] || or[1] > hr[0]) {
      const m = { key: 'oversunders', label: 'two overcards vs two undercards', rule: 'two higher cards vs two lower cards ≈ 60–65% for the higher cards', thumb: 0.63, side: 'fav' };
      return hr[1] > or[0] ? m : flip(m);
    }
    if ((hr[0] > or[0] && hr[1] < or[1]) || (or[0] > hr[0] && or[1] < hr[1])) {
      const m = { key: 'bigvsmiddle', label: 'one big card vs two middle cards', rule: 'one high card + one low card vs two middle cards ≈ 55/45 to 60/40 for the high card', thumb: 0.56, side: 'fav' };
      return hr[0] > or[0] ? m : flip(m);
    }
    const m = { key: 'interleaved', label: 'high card + middle card vs middle + low', rule: 'interleaved cards (e.g. A-T vs K-9) ≈ 60–65% for the hand with the top card', thumb: 0.62, side: 'fav' };
    return hr[0] > or[0] ? m : flip(m);
  }

  const RANGES = [
    { p: 0.06, name: 'a very tight player who re-raised', short: 'top 6% of hands' },
    { p: 0.1, name: 'a tight raiser', short: 'top 10% of hands' },
    { p: 0.2, name: 'a solid player opening from late position', short: 'top 20% of hands' },
    { p: 0.35, name: 'a loose player', short: 'top 35% of hands' },
    { p: 1, name: 'a maniac who shoves any two cards', short: 'any two cards' },
  ];
  /** Combo-weighted breakdown of a range against hero's hand by preflop matchup type. */
  function rangeBreakdown(hero, p) {
    const PF = FS.preflop;
    const out = { crushed: 0, flip: 0, ahead: 0, total: 0 };
    for (const code of PF.ORDER) {
      if (PF.PCT[code] > Math.max(p, 0.02)) continue;
      for (const h of PF.COMBOS[code]) {
        if (hero.includes(h[0]) || hero.includes(h[1])) continue;
        const t = preflopMatchup(hero, h).thumb;
        out.total++;
        if (t < 0.4) out.crushed++; else if (t <= 0.6) out.flip++; else out.ahead++; // ≈30% or worse / 40–60% / 60%+
      }
    }
    return out;
  }
  function rangeExamples(p) {
    const codes = FS.preflop.topCodes(p);
    if (p >= 1) return 'every hand, even 7-2 offsuit';
    return codes.slice(0, Math.min(codes.length, 9)).join(', ') + (codes.length > 9 ? ` … (${codes.length} hand types)` : '');
  }

  /** Hand description for the explanation: made hand + label + draws, from the engine. */
  function postflopDesc(h, board) {
    const a = C.analyzeHand(h, board);
    let s = a.cat === 0 ? RNAME((a.score >> 16) & 15) + ' high' : a.name;
    if (a.madeLabel) s += ' (' + a.madeLabel + ')';
    if (a.draws.length) s += (a.cat === 0 ? ' with a ' : ' plus a ') + a.draws.join(' and a ');
    return s;
  }

  function dealPreflopMatchup(rng) {
    const key = rng.pick(['pairovers', 'pairovers', 'pairone', 'overunder', 'dominated', 'dominated', 'oversunders', 'bigvsmiddle']);
    const ranks = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    const between = (lo, hi) => ranks.filter((r) => r > lo && r < hi);
    const pick2 = (arr) => { const s = shuffled(arr, rng); return [s[0], s[1]]; };
    let A, B; // rank pairs: A = the favourite by category, B = the other
    for (;;) {
      if (key === 'pairovers') { const P = rng.pick(between(1, 13)); A = [P, P]; B = pick2(between(P, 15)); }
      else if (key === 'pairone') { const P = rng.pick(between(2, 14)); A = [P, P]; B = [rng.pick(between(P, 15)), rng.pick(between(1, P))]; }
      else if (key === 'overunder') { const [p, q] = pick2(ranks); A = [Math.max(p, q), Math.max(p, q)]; B = [Math.min(p, q), Math.min(p, q)]; }
      else if (key === 'dominated') { const s = rng.pick(between(9, 15)); const [k1, k2] = pick2(ranks.filter((r) => r !== s)); A = [s, Math.max(k1, k2)]; B = [s, Math.min(k1, k2)]; }
      else if (key === 'oversunders') { const r4 = shuffled(ranks, rng).slice(0, 4).sort((x, y) => y - x); A = [r4[0], r4[1]]; B = [r4[2], r4[3]]; }
      else { const r4 = shuffled(ranks, rng).slice(0, 4).sort((x, y) => y - x); A = [r4[0], r4[3]]; B = [r4[1], r4[2]]; }
      if (A[0] && A[1] && B[0] && B[1]) break;
    }
    const used = new Set();
    const mk = (pair) => {
      const suited = pair[0] !== pair[1] && rng() < 0.3;
      const out = [];
      for (let i = 0; i < 2; i++) {
        const suits = shuffled([0, 1, 2, 3], rng);
        if (suited && i === 1) suits.unshift(C.suitOf(out[0]));
        const s = suits.find((su) => !used.has(C.makeCard(pair[i], su)));
        const c = C.makeCard(pair[i], s); used.add(c); out.push(c);
      }
      return out;
    };
    const fav = mk(A), dog = mk(B);
    return rng() < 0.5 ? { hero: fav, opp: dog } : { hero: dog, opp: fav };
  }

  function dealPostflopMatchup(rng, street) {
    const nb = street === 'flop' ? 3 : 4;
    for (let tries = 0; tries < 20000; tries++) {
      const d = shuffled(C.newDeck(), rng);
      const hero = d.slice(0, 2), opp = d.slice(2, 4), board = d.slice(4, 4 + nb);
      const aH = C.analyzeHand(hero, board), aO = C.analyzeHand(opp, board);
      const made = (a) => a.cat >= 1 && !/board|on board/.test(a.madeLabel);
      const draw = (a) => a.draws.length > 0;
      if (!((made(aH) && draw(aO)) || (made(aO) && draw(aH)) || (made(aH) && made(aO) && aH.cat !== aO.cat) || (made(aH) && made(aO) && tries > 4000))) continue;
      const eq = exactEquity(hero, opp, board);
      if (eq < 0.08 || eq > 0.92) continue;
      return { hero, opp, board, eq };
    }
    throw new Error('no postflop matchup');
  }

  /** Three options: the truth (whole %) + two misconception-based distractors, >= 12 points apart. */
  function equityOptions(truthPct, myths, rng) {
    const vals = [{ v: truthPct, why: null }];
    const ok = (v) => v >= 1 && v <= 99 && vals.every((x) => Math.abs(x.v - v) >= 12);
    for (const m of myths) { if (vals.length >= 3) break; const v = Math.round(U.clamp(m.v, 1, 99)); if (ok(v)) vals.push({ v, why: m.why }); }
    for (const d of [20, -20, 30, -30, 15, -15, 40, -40, 50, -50]) {
      if (vals.length >= 3) break;
      const v = truthPct + d;
      if (ok(v)) vals.push({ v, why: d > 0 ? 'too optimistic — you gave your hand more equity than it really has.' : 'too pessimistic — your hand does better than that.' });
    }
    return shuffled(vals, rng).map((x) => ({ value: x.v / 100, label: x.v + '%', correct: x.v === truthPct, why: x.why }));
  }

  function genEquity(rng) {
    const r = rng();
    const street = r < 0.25 ? 'range' : r < 0.55 ? 'preflop' : r < 0.82 ? 'flop' : 'turn';
    const lines = [];
    const myths = [];
    let q;
    if (street === 'range') {
      const R = rng.pick(RANGES);
      const code = rng.pick(FS.preflop.topCodes(0.3));
      const hero = rng.pick(FS.preflop.COMBOS[code]);
      const eq = equityVsRange(hero, R.p, rng);
      const bd = rangeBreakdown(hero, R.p);
      const pc = (n) => Math.round(n / bd.total * 100) + '%';
      lines.push(`You hold **${holeName(hero)}** against ${R.name}: their [[range]] is the ${R.short} — ${rangeExamples(R.p)}.`);
      lines.push(`Of the ${bd.total} hand combos they could have (minus the ones your cards block): you’re an underdog (about 30% or worse) against **${pc(bd.crushed)}** (bigger pairs, or the same card with a better [[kicker]]), roughly a coin flip against **${pc(bd.flip)}**, and ahead of **${pc(bd.ahead)}**.`);
      lines.push(`Averaged over that whole range your [[equity]] is **${Math.round(eq * 100)}%** (simulated over ${EQ_ITERS.toLocaleString('en-US')} deals; split pots count half).`);
      lines.push(R.p <= 0.1 ? 'Tight ranges are full of big pairs and big aces, so even good hands lose value against them.' : R.p >= 1 ? 'Against any two cards almost every decent hand is a favourite — that’s why you can call shoves from wild players much lighter.' : 'The wider their range, the more weak hands it contains and the better your hand does.');
      myths.push({ v: Math.round(preflopMatchup(hero, rng.pick(FS.preflop.COMBOS[FS.preflop.topCodes(R.p)[0]])).thumb * 100), why: 'that’s roughly how you’d do against their very best hand only — a range also contains plenty of weaker hands.' });
      myths.push({ v: Math.round((1 - eq) * 100), why: 'that’s their share, not yours — you flipped it around.' });
      myths.push({ v: R.p >= 0.35 ? eq * 100 - 22 : eq * 100 + 22, why: R.p >= 0.35 ? 'too pessimistic — a wide range is full of hands you beat.' : 'too optimistic — a tight range is full of hands that have you crushed or are coin flips.' });
      q = { hero, range: R, board: [], street: 'preflop', truth: eq };
    } else if (street === 'preflop') {
      const { hero, opp } = dealPreflopMatchup(rng);
      const eq = equityVsHand(hero, opp, [], rng);
      const m = preflopMatchup(hero, opp);
      lines.push(`You: **${holeName(hero)}**. Opponent: **${holeName(opp)}**. That’s a **${m.label}** matchup${m.side === 'fav' ? ' and you’re the favourite' : m.side === 'dog' ? ' and you’re the underdog' : ''}.`);
      lines.push(`Rule of thumb: ${m.rule}.`);
      const hs = C.suitOf(hero[0]) === C.suitOf(hero[1]) && hero[0] >> 2 !== hero[1] >> 2, os = C.suitOf(opp[0]) === C.suitOf(opp[1]) && opp[0] >> 2 !== opp[1] >> 2;
      if (hs || os) lines.push(`${hs && os ? 'Both hands are' : hs ? 'Your hand is' : 'Their hand is'} [[suited]] — being suited adds about 2–3% (a flush chance).`);
      lines.push(`Exact: your [[equity]] is **${Math.round(eq * 100)}%** (simulated over ${EQ_ITERS.toLocaleString('en-US')} deals; split pots count half).`);
      const T = Math.round(m.thumb * 100);
      if (m.key === 'pairovers') myths.push(m.side === 'fav' ? { v: 80, why: 'a pair vs two overcards isn’t 80/20 — two live overcards have six outs twice, so it’s close to a coin flip (≈55/45).' } : { v: 20, why: 'two overcards aren’t a big underdog to a small pair — it’s close to a coin flip (≈45/55).' });
      if (m.key === 'dominated') myths.push(m.side === 'dog' ? { v: 45, why: 'that treats a dominated hand like a coin flip — when you share a card and have the worse [[kicker]], you have only ≈25–30%.' } : { v: 55, why: 'that treats it like a coin flip — when you share a card and have the better [[kicker]], you’re ≈70–75%.' });
      if (m.key === 'overunder') myths.push(m.side === 'dog' ? { v: 45, why: 'a smaller pair against a bigger pair is not a coin flip — it needs to hit a set, about 1 time in 5 (≈20%).' } : { v: 55, why: 'a bigger pair against a smaller pair is not a coin flip — you’re about 80/20.' });
      if (m.key === 'pairone') myths.push(m.side === 'fav' ? { v: 50, why: 'pair vs ONE overcard isn’t a coin flip — they only have three outs to the overcard, so the pair is ≈70%.' } : { v: 45, why: 'with just one overcard you’re not close to a coin flip — only three cards pair it, so you have ≈30%.' });
      myths.push({ v: 100 - Math.round(eq * 100), why: 'that’s your opponent’s share, not yours — you flipped the matchup around.' });
      myths.push({ v: m.side === 'dog' ? T - 18 : T + 18, why: m.side === 'dog' ? 'too pessimistic — you’re behind, but not drawing that thin.' : 'too optimistic — being ahead preflop is rarely a lock; five cards are still to come.' });
      q = { hero, opp, board: [], street: 'preflop', truth: eq, matchup: m.key };
    } else {
      const { hero, opp, board, eq } = dealPostflopMatchup(rng, street);
      const sH = C.evaluate(hero.concat(board)), sO = C.evaluate(opp.concat(board));
      const heroAhead = sH > sO || (sH === sO && eq >= 0.5);
      const lead = heroAhead ? hero : opp, trail = heroAhead ? opp : hero;
      const dead = new Set(hero.concat(opp, board));
      const outs = [];
      for (let c = 0; c < 52; c++) if (!dead.has(c)) { const nb = board.concat([c]); if (C.evaluate(trail.concat(nb)) > C.evaluate(lead.concat(nb))) outs.push(c); }
      const unseen = 52 - dead.size;
      const trailEq = heroAhead ? 1 - eq : eq;
      const est = Math.min(outs.length * (street === 'flop' ? 4 : 2), 100);
      lines.push(`On the ${street}: you have **${postflopDesc(hero, board)}**; your opponent has **${postflopDesc(opp, board)}**. ${sH === sO ? 'Right now it’s a tie' : heroAhead ? '**You’re ahead** right now' : '**They’re ahead** right now'}.`);
      lines.push(`${heroAhead ? 'Their' : 'Your'} [[outs]]: **${outs.length}** of the ${unseen} unseen cards put ${heroAhead ? 'them' : 'you'} ahead on the ${street === 'flop' ? 'turn' : 'river'}${outs.length && outs.length <= 15 ? ` (${outs.map(C.cardPretty).join(' ')})` : ''}.`);
      lines.push(`[[rule of 2 and 4|Rule of ${street === 'flop' ? '4' : '2'}]]: ${outs.length} × ${street === 'flop' ? 4 : 2} ≈ **${est}%** for ${heroAhead ? 'them' : 'you'}. Exact (every ${street === 'flop' ? 'turn + river' : 'river'} card checked): **${Math.round(trailEq * 100)}%**.` +
        (street === 'flop' && Math.abs(est - trailEq * 100) >= 5 ? ` The gap comes from ${est > trailEq * 100 ? 'outs that don’t always win (they can hit and still lose, or the leader improves too)' : 'two-card “backdoor” runouts and extra ways to improve that a simple out count misses'}.` : ''));
      lines.push(`So your [[equity]] is **${Math.round(eq * 100)}%**${heroAhead ? ' — you’re the favourite, but not a lock.' : ' — you’re drawing, so you need the right price to continue.'}`);
      const aH = C.analyzeHand(hero, board), aO = C.analyzeHand(opp, board);
      if (aH.cat === 1 && aO.cat === 1 && ((aH.score >> 16) & 15) === ((aO.score >> 16) & 15)) {
        const kick = (h) => Math.max(...h.map(C.rankOf).filter((r) => r !== ((aH.score >> 16) & 15)));
        lines.splice(1, 0, `Same pair, so the [[kicker]] decides: ${RNAME(kick(lead))} beats ${RNAME(kick(trail))}. The weaker kicker needs help from the board — a dominated hand usually has only ≈ 15–30%.`);
      }
      if (!heroAhead) myths.push({ v: eq * 100 + 25, why: C.analyzeHand(trail, board).draws.length ? 'that overestimates the draw — a draw is usually an underdog to a made hand until it hits.' : `too optimistic — you’re behind and need one of your ${outs.length} outs.` });
      else myths.push({ v: Math.max(eq * 100 + 15, 92), why: 'that’s overconfident — the trailing hand still has real outs.' });
      myths.push({ v: 100 - Math.round(eq * 100), why: 'that’s your opponent’s share, not yours — you flipped it around.' });
      myths.push({ v: (heroAhead ? 100 - est : est) + (heroAhead ? -12 : 12), why: heroAhead ? 'too pessimistic — the trailing hand needs to hit to win.' : 'too optimistic — count your outs and use the rule of 2 and 4.' });
      q = { hero, opp, board, street, truth: eq, outCards: outs, trailing: heroAhead ? 'opp' : 'hero' };
    }
    const truthPct = Math.round(q.truth * 100);
    const options = equityOptions(truthPct, myths, rng);
    return Object.assign(q, {
      type: 'equity', kind: 'choice', options, truth: truthPct / 100, exact: q.truth,
      prompt: q.range ? `You’re all-in preflop against **${q.range.name}** (${q.range.short}). What’s your [[equity]]?` : `What’s your [[equity]] (chance to win, ties count half) in this all-in?`,
      answerText: truthPct + '%',
      explain: lines,
    });
  }

  const GENERATORS = { potodds: genPotOdds, outs: genOuts, callfold: genCallFold, betsize: genBetSize, equity: genEquity };
  /** Make one question. type: one of TYPES or 'mixed'. */
  function generate(type, rng) {
    rng = rng || U.makeRng((Math.random() * 2 ** 32) >>> 0);
    const t = type === 'mixed' || !GENERATORS[type] ? rng.pick(TYPES) : type;
    return GENERATORS[t](rng);
  }
  /** answer: option index for choice questions, 'call' / 'fold' for call-or-fold, null = timed out. */
  function isCorrect(q, answer) {
    if (answer == null) return false;
    if (q.kind === 'callfold') return answer === q.answer;
    const o = q.options[answer];
    return !!(o && o.correct);
  }

  // ---------- stats (pure; operate on the store's `drills` object) ----------
  function emptyTypeStats() { return { attempts: 0, correct: 0, streak: 0, bestStreak: 0, timeMs: 0, last: [] }; }
  function record(drills, type, ok, ms) {
    const s = drills[type] || (drills[type] = emptyTypeStats());
    s.attempts++;
    if (ok) { s.correct++; s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak); } else s.streak = 0;
    s.timeMs += Math.max(0, Math.round(ms || 0));
    s.last = (s.last || []).concat([ok ? 1 : 0]).slice(-20);
    return s;
  }
  const accuracy = (s) => (s && s.attempts ? s.correct / s.attempts : null);
  const avgSec = (s) => (s && s.attempts ? s.timeMs / s.attempts / 1000 : null);

  FS.drills = {
    TYPES, TYPE_INFO, TOL, GAP, MARGIN, TIMER_MS, BET_SIZES,
    potOddsNeeded, betSizeNeeded, fmtPct, drawInfo, dealDrawSpot,
    genPotOdds, genOuts, genCallFold, genBetSize, genEquity, generate, isCorrect,
    exactEquity, equityVsHand, equityVsRange, preflopMatchup, rangeBreakdown, RANGES, EQ_ITERS,
    emptyTypeStats, record, accuracy, avgSec,
  };

  if (typeof document === 'undefined' || !FS.ui) return;

  // =====================================================================================
  // UI
  // =====================================================================================
  const { $, $$ } = FS.ui;
  const g = (t) => FS.coach.glossaryHTML(t);
  const DR = () => FS.store.get().drills;
  let S = null; // current session
  let timerIv = null;

  function prefs() { return DR().prefs; }

  function setupHTML() {
    const p = prefs();
    const row = (key, label, opts) => `<div class="opt-row"><label>${label}</label><div class="opt-choices" data-key="${key}">${opts.map(([v, t, sub]) => `<button class="opt ${String(p[key]) === String(v) ? 'sel' : ''}" data-v="${v}">${t}${sub ? `<small>${sub}</small>` : ''}</button>`).join('')}</div></div>`;
    const d = DR();
    const acc = (t) => { const a = accuracy(d[t]); return a == null ? 'new' : Math.round(a * 100) + '% right'; };
    return `<div class="drill-setup panel">
      <p class="drill-intro">Quick-fire practice for the math you’ll use at a live table. Get it automatic here so at the tournament you can focus on your opponents. <button class="linkish" data-learn>How does this work?</button></p>
      ${row('type', 'Drill', [['mixed', 'Mixed', 'a bit of everything']].concat(TYPES.map((t) => [t, TYPE_INFO[t].label, acc(t)])))}
      ${row('length', 'Session', [[10, '10', 'questions'], [20, '20', 'questions'], [0, 'Endless', 'stop any time']])}
      ${row('timer', 'Timer', [[0, 'Off', 'take your time'], [1, '15 s', 'per question']])}
      <div class="setup-actions"><button class="btn gold big" id="drill-go">START DRILL ▶</button></div>
    </div>`;
  }

  function renderSetup() {
    stopTimer();
    S = null;
    const body = $('#drills-body');
    body.innerHTML = setupHTML();
    $$('.opt-choices', body).forEach((grp) => $$('.opt', grp).forEach((b) => (b.onclick = () => {
      const v = b.dataset.v;
      prefs()[grp.dataset.key] = isNaN(+v) ? v : +v;
      FS.store.save();
      FS.audio.sfx.blip();
      renderSetup();
    })));
    $('#drill-go').onclick = () => { FS.audio.sfx.select(); start(); };
    bindLearn(body);
    $('#scr-drills').scrollTop = 0;
  }

  function bindLearn(el) {
    $$('[data-learn]', el).forEach((b) => (b.onclick = () => { FS.audio.sfx.select(); stopTimer(); FS.learn.open('odds'); }));
  }

  function start() {
    const p = prefs();
    S = { type: p.type, length: +p.length || 0, timer: !!+p.timer, n: 0, correct: 0, streak: 0, bestStreak: 0, timeMs: 0, per: {}, q: null, answered: false, done: false,
      rng: U.makeRng((Date.now() ^ (Math.random() * 2 ** 32)) >>> 0) };
    nextQuestion();
  }

  function nextQuestion() {
    if (S.length && S.n >= S.length) return finish();
    S.q = generate(S.type, S.rng);
    S.answered = false; S.choice = undefined;
    S.t0 = performance.now();
    renderQuestion();
    if (S.timer) startTimer();
  }

  function spotHTML(q) {
    if (!q.hero) return '';
    const row = (label, cs) => `<div class="drill-cards"><span class="lbl">${label}</span><div class="cards">${cs.map((c) => FS.ui.cardHTML(c)).join('')}</div></div>`;
    const boardLbl = q.board.length === 3 ? 'Flop' : q.board.length === 4 ? 'Turn' : '';
    let opp = '';
    if (q.opp) opp = row('Opponent', q.opp);
    else if (q.range) opp = `<div class="drill-cards"><span class="lbl">Opponent</span><div class="cards">${FS.ui.cardHTML(null, { back: true })}${FS.ui.cardHTML(null, { back: true })}<span class="drill-range">${U.esc(q.range.short)}</span></div></div>`;
    return `<div class="drill-spot ${q.opp || q.range ? 'vs' : ''}">${row('Your hand', q.hero)}${opp}${q.board.length ? row(boardLbl, q.board) : q.type === 'equity' ? '<div class="drill-cards"><span class="lbl">Board</span><div class="cards preflop-tag">Preflop — all five cards to come</div></div>' : ''}</div>`;
  }
  function chipsLine(q) {
    if (q.pot == null) return '';
    return `<div class="drill-money"><span><i>Pot</i><b>${fc(q.pot)}</b></span><span><i>Bet</i><b>${fc(q.bet)}</b></span></div>`;
  }

  function hudHTML() {
    const avg = S.n ? (S.timeMs / S.n / 1000).toFixed(1) + 's' : '—';
    return `<div class="drill-hud panel">
      <span class="hs"><b>${S.length ? Math.min(S.n + (S.answered ? 0 : 1), S.length) + '/' + S.length : '#' + (S.n + (S.answered ? 0 : 1))}</b><i>Question</i></span>
      <span class="hs"><b>${S.correct}/${S.n}</b><i>Score</i></span>
      <span class="hs ${S.streak >= 3 ? 'hot' : ''}"><b>${S.streak}</b><i>Streak</i></span>
      <span class="hs"><b>${avg}</b><i>Avg time</i></span>
      <span class="sp"></span>
      <button class="btn small" id="drill-end">${S.length ? 'End' : 'Finish'}</button>
    </div>`;
  }

  function renderQuestion() {
    const q = S.q;
    const body = $('#drills-body');
    const keyHint = (k) => `<span class="key">${k}</span>`;
    const answers = q.kind === 'callfold'
      ? `<div class="drill-answers two"><button class="btn drill-opt" data-a="fold">${keyHint('F')}FOLD</button><button class="btn drill-opt" data-a="call">${keyHint('C')}CALL ${fc(q.bet)}</button></div>`
      : `<div class="drill-answers n${q.options.length}">${q.options.map((o, i) => `<button class="btn drill-opt" data-a="${i}">${keyHint(i + 1)}${U.esc(o.label)}</button>`).join('')}</div>`;
    body.innerHTML = `${hudHTML()}
      ${S.timer ? '<div class="drill-timer"><i id="drill-timebar"></i></div>' : ''}
      <div class="drill-card panel ${q.hero ? 'has-spot' : ''}">
        <div class="drill-kind">${TYPE_INFO[q.type].label}</div>
        ${spotHTML(q)}
        <div class="drill-ask">
          ${chipsLine(q)}
          <div class="drill-q">${g(q.prompt)}</div>
          ${q.note ? `<div class="small-note">${U.esc(q.note)}</div>` : ''}
          ${answers}
        </div>
      </div>
      <div id="drill-fb"></div>`;
    $$('.drill-opt', body).forEach((b) => (b.onclick = () => answer(q.kind === 'callfold' ? b.dataset.a : +b.dataset.a)));
    $('#drill-end').onclick = () => { FS.audio.sfx.back(); endEarly(); };
    $('#scr-drills').scrollTop = 0;
  }

  function startTimer() {
    stopTimer();
    timerIv = setInterval(() => {
      if (!S || S.answered || FS.ui.current !== 'drills') { stopTimer(); return; }
      const left = Math.max(0, TIMER_MS - (performance.now() - S.t0));
      const bar = $('#drill-timebar');
      if (bar) { bar.style.width = (left / TIMER_MS * 100) + '%'; bar.classList.toggle('low', left < 5000); }
      if (left <= 0) { stopTimer(); answer(null); }
    }, 100);
  }
  function stopTimer() { if (timerIv) { clearInterval(timerIv); timerIv = null; } }

  function answer(a) {
    if (!S || S.answered) return;
    stopTimer();
    const q = S.q;
    const ms = a == null ? TIMER_MS : Math.min(performance.now() - S.t0, 120000);
    const ok = isCorrect(q, a);
    S.answered = true; S.choice = a;
    S.n++; S.timeMs += ms;
    if (ok) { S.correct++; S.streak++; S.bestStreak = Math.max(S.bestStreak, S.streak); } else S.streak = 0;
    const per = S.per[q.type] || (S.per[q.type] = { n: 0, c: 0 });
    per.n++; if (ok) per.c++;
    record(DR(), q.type, ok, ms);
    FS.store.save();
    if (ok) FS.audio.sfx.select(); else FS.audio.sfx.back();
    S.ok = ok;
    showFeedback();
  }

  /** Mark the answer buttons and show the explanation for the answered question. */
  function showFeedback() {
    const q = S.q, a = S.choice, ok = S.ok;
    $$('.drill-opt').forEach((b) => {
      b.disabled = true;
      const v = q.kind === 'callfold' ? b.dataset.a : +b.dataset.a;
      const right = q.kind === 'callfold' ? v === q.answer : q.options[v].correct;
      if (right) b.classList.add('right');
      else if (v === a) b.classList.add('wrong');
    });
    $('.drill-hud').outerHTML = hudHTML();
    $('#drill-end').onclick = () => { FS.audio.sfx.back(); endEarly(); };
    const last = S.length && S.n >= S.length;
    const fb = $('#drill-fb');
    const outsRow = q.info && q.type === 'outs'
      ? `<div class="drill-outs"><span class="lbl">Your ${q.info.outs} outs</span><div class="cards">${q.info.outCards.map((c) => FS.ui.cardHTML(c, { cls: 'mini' })).join('')}</div></div>` : '';
    fb.innerHTML = `<div class="drill-fb panel feedback ${ok ? 'g-good' : 'g-mistake'}">
      <div class="fb-head"><span class="g">${ok ? '✔ Correct!' : a == null ? '⏱ Time’s up' : '✘ Not quite'}</span>
        <span class="fb-ans">Answer: <b>${U.esc(q.answerText)}</b></span>
        <button class="btn gold" id="drill-next">${last ? 'See results ▶' : 'Next ▶'}</button></div>
      ${outsRow}${eqBar(q)}
      ${!ok && a != null && q.options && q.options[a] && q.options[a].why ? `<p class="fb-why">You picked <b>${U.esc(q.options[a].label)}</b>: ${g(q.options[a].why)}</p>` : ''}
      <ul class="fb-explain">${q.explain.map((l) => `<li>${g(l)}</li>`).join('')}</ul>
      <div class="fb-foot"><button class="linkish" data-learn>How does this work? (Lesson 5: Pot odds &amp; outs)</button><span class="small-note kbd-note">Enter / Space = next</span></div>
    </div>`;
    $('#drill-next').onclick = () => { FS.audio.sfx.tick(); nextQuestion(); };
    bindLearn(fb);
    setTimeout(() => { const el = $('.drill-fb'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 30);
  }

  /** Animated equity bar (hero vs opponent) for the equity drill. */
  function eqBar(q) {
    if (q.type !== 'equity') return '';
    const h = Math.round(q.exact * 100);
    setTimeout(() => { const el = $('#eqbar-hero'); if (el) el.style.width = h + '%'; }, 60);
    return `<div class="eqbar"><div class="eqbar-track"><i id="eqbar-hero" style="width:50%"></i></div>
      <div class="eqbar-lbl"><span>You <b>${h}%</b></span><span>${q.range ? 'Their range' : 'Opponent'} <b>${100 - h}%</b></span></div></div>`;
  }

  function endEarly() {
    stopTimer();
    if (!S || !S.n) return renderSetup();
    finish();
  }

  function finish() {
    stopTimer();
    S.done = true;
    DR().sessions = (DR().sessions || 0) + 1;
    FS.store.save();
    const acc = S.n ? S.correct / S.n : 0;
    FS.audio.sfx[acc >= 0.8 ? 'win' : 'select']();
    const verdict = acc >= 0.9 ? 'Sharp! That math is becoming automatic.' : acc >= 0.7 ? 'Solid. A few more sessions and it’ll be second nature.' : acc >= 0.5 ? 'Getting there — read the explanations on the ones you missed.' : 'Keep at it. Lesson 5 explains every step in plain English.';
    const rows = TYPES.filter((t) => S.per[t]).map((t) => {
      const p = S.per[t], life = DR()[t];
      return `<tr><td>${TYPE_INFO[t].label}</td><td class="num">${p.c}/${p.n}</td><td class="num">${Math.round(p.c / p.n * 100)}%</td><td class="num">${Math.round(accuracy(life) * 100)}%</td></tr>`;
    }).join('');
    $('#drills-body').innerHTML = `<div class="drill-summary">
      <div class="kpis">
        <div class="kpi panel"><b>${Math.round(acc * 100)}%</b><span>Accuracy</span></div>
        <div class="kpi panel"><b>${S.correct}/${S.n}</b><span>Correct</span></div>
        <div class="kpi panel"><b>${S.bestStreak}</b><span>Best streak</span></div>
        <div class="kpi panel"><b>${(S.timeMs / S.n / 1000).toFixed(1)}s</b><span>Avg time</span></div>
      </div>
      <div class="section panel"><h2>Session complete</h2>
        <p>${verdict}</p>
        <table class="grid"><tr><th>Drill</th><th class="num">This session</th><th class="num">Accuracy</th><th class="num">All-time</th></tr>${rows}</table>
        <div class="setup-actions"><button class="linkish" data-learn>How does this work?</button><span class="sp"></span><button class="btn" id="drill-change">Change drill</button><button class="btn gold" id="drill-again">Practice again ▶</button></div>
      </div></div>`;
    $('#drill-again').onclick = () => { FS.audio.sfx.select(); start(); };
    $('#drill-change').onclick = () => { FS.audio.sfx.back(); renderSetup(); };
    bindLearn($('#drills-body'));
    $('#scr-drills').scrollTop = 0;
  }

  // ---------- Your Progress section ----------
  function statsHTML() {
    const d = DR();
    const any = TYPES.some((t) => d[t] && d[t].attempts);
    if (!any) return `<div class="section panel"><h2>Math drills</h2><p class="muted">No drills yet — try <b>Math Drills</b> from the title menu to practise pot odds and outs.</p></div>`;
    return `<div class="section panel drill-stats"><h2>Math drills</h2>
      <table class="grid"><tr><th>Drill</th><th class="num">Accuracy</th><th class="num">Answered</th><th class="num">Best streak</th><th class="num">Avg time</th><th>Last 20</th></tr>
      ${TYPES.map((t) => {
        const s = d[t];
        if (!s || !s.attempts) return `<tr><td>${TYPE_INFO[t].label}</td><td class="num muted" colspan="4">not tried yet</td><td></td></tr>`;
        return `<tr data-drill="${t}"><td>${TYPE_INFO[t].label}</td><td class="num"><b>${Math.round(accuracy(s) * 100)}%</b></td><td class="num">${s.attempts}</td><td class="num">${s.bestStreak}</td><td class="num">${avgSec(s).toFixed(1)}s</td><td class="dots">${(s.last || []).map((x) => `<i class="${x ? 'y' : 'n'}"></i>`).join('')}</td></tr>`;
      }).join('')}</table>
      <p class="small-note">${d.sessions || 0} session${d.sessions === 1 ? '' : 's'} completed. Aim for 90%+ before your tournament — speed comes with repetition.</p></div>`;
  }

  // ---------- keyboard ----------
  document.addEventListener('keydown', (e) => {
    if (FS.ui.current !== 'drills' || FS.ui.anyModalOpen() || !S || S.done) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (S.answered) {
      if (k === 'enter' || k === ' ') { e.preventDefault(); const b = $('#drill-next'); if (b) b.click(); }
      return;
    }
    if (S.q.kind === 'callfold') {
      if (k === 'c') { e.preventDefault(); answer('call'); }
      if (k === 'f') { e.preventDefault(); answer('fold'); }
    } else if (/^[1-4]$/.test(k) && +k <= S.q.options.length) { e.preventDefault(); answer(+k - 1); }
  });

  FS.ui.onScreen('drills', (arg, prev) => {
    // coming back from the lesson link: resume the session where it was
    if (S && !S.done && prev === 'learn') {
      renderQuestion();
      if (S.answered) showFeedback(); else { S.t0 = performance.now(); if (S.timer) startTimer(); }
      return;
    }
    renderSetup();
  });

  Object.assign(FS.drills, { statsHTML, renderSetup });
  Object.defineProperty(FS.drills, 'session', { get: () => S }); // the live session (read by tests)
})(typeof window !== 'undefined' ? window : globalThis);
