/* Cards, 7-card hand evaluator, Monte Carlo equity.
   Card = integer 0..51. rank = (c>>2)+2 (2..14, 14 = Ace). suit = c&3 (0♠ 1♥ 2♦ 3♣). */
(function (root) {
  'use strict';
  const FS = root.FS;
  const RANKS = '23456789TJQKA';
  const SUITS = 'shdc';
  const SUIT_GLYPH = ['♠', '♥', '♦', '♣'];
  const RANK_NAME = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
  const RANK_PLURAL = { 2: 'Twos', 3: 'Threes', 4: 'Fours', 5: 'Fives', 6: 'Sixes', 7: 'Sevens', 8: 'Eights', 9: 'Nines', 10: 'Tens', 11: 'Jacks', 12: 'Queens', 13: 'Kings', 14: 'Aces' };
  const CAT_NAME = ['High Card', 'One Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];

  const rankOf = (c) => (c >> 2) + 2;
  const suitOf = (c) => c & 3;
  const makeCard = (rank, suit) => ((rank - 2) << 2) | suit;
  const cardStr = (c) => RANKS[rankOf(c) - 2] + SUITS[suitOf(c)];
  const cardPretty = (c) => (rankOf(c) === 10 ? '10' : RANKS[rankOf(c) - 2]) + SUIT_GLYPH[suitOf(c)];
  function parseCard(s) {
    const r = RANKS.indexOf(s[0].toUpperCase());
    const su = SUITS.indexOf(s[1].toLowerCase());
    if (r < 0 || su < 0) throw new Error('bad card ' + s);
    return makeCard(r + 2, su);
  }
  const parseCards = (s) => s.trim().split(/\s+/).filter(Boolean).map(parseCard);

  function newDeck() { const d = []; for (let i = 0; i < 52; i++) d.push(i); return d; }

  // ---------- evaluator ----------
  const rc = new Int8Array(15);
  const sc = new Int8Array(4);
  const sm = new Int32Array(4);

  function straightHigh(mask) {
    if (mask & (1 << 14)) mask |= 2; // wheel: ace plays low (bit 1)
    for (let h = 14; h >= 5; h--) {
      if (((mask >> (h - 4)) & 31) === 31) return h;
    }
    return 0;
  }
  function topBits(mask, n) {
    let out = 0, k = 0;
    for (let r = 14; r >= 2 && k < n; r--) if (mask & (1 << r)) { out = (out << 4) | r; k++; }
    while (k < n) { out <<= 4; k++; }
    return out;
  }

  /** Evaluate 5..7 cards. Returns an integer; higher is better. category = score >> 20. */
  function evaluate(cards) {
    rc.fill(0); sc.fill(0); sm.fill(0);
    let mask = 0;
    const n = cards.length;
    for (let i = 0; i < n; i++) {
      const c = cards[i];
      const r = (c >> 2) + 2, s = c & 3;
      rc[r]++; sc[s]++; sm[s] |= 1 << r; mask |= 1 << r;
    }
    let flushSuit = -1;
    for (let s = 0; s < 4; s++) if (sc[s] >= 5) flushSuit = s;
    if (flushSuit >= 0) {
      const sf = straightHigh(sm[flushSuit]);
      if (sf) return (8 << 20) | sf;
    }
    let quad = 0, t1 = 0, t2 = 0, p1 = 0, p2 = 0, p3 = 0;
    for (let r = 14; r >= 2; r--) {
      const k = rc[r];
      if (k === 4) quad = r;
      else if (k === 3) { if (!t1) t1 = r; else if (!t2) t2 = r; }
      else if (k === 2) { if (!p1) p1 = r; else if (!p2) p2 = r; else if (!p3) p3 = r; }
    }
    if (quad) return (7 << 20) | (quad << 16) | (topBits(mask & ~(1 << quad), 1) << 12);
    if (t1 && (t2 || p1)) return (6 << 20) | (t1 << 16) | ((t2 > p1 ? t2 : p1) << 12);
    if (flushSuit >= 0) return (5 << 20) | topBits(sm[flushSuit], 5);
    const st = straightHigh(mask);
    if (st) return (4 << 20) | st;
    if (t1) return (3 << 20) | (t1 << 16) | (topBits(mask & ~(1 << t1), 2) << 8);
    if (p1 && p2) return (2 << 20) | (p1 << 16) | (p2 << 12) | (topBits(mask & ~(1 << p1) & ~(1 << p2), 1) << 8);
    if (p1) return (1 << 20) | (p1 << 16) | (topBits(mask & ~(1 << p1), 3) << 4);
    return topBits(mask, 5);
  }
  const category = (score) => score >> 20;

  function describeScore(score) {
    const cat = score >> 20;
    const a = (score >> 16) & 15, b = (score >> 12) & 15;
    switch (cat) {
      case 8: return (score & 15) === 14 ? 'Royal Flush' : 'Straight Flush, ' + RANK_NAME[score & 15] + ' high';
      case 7: return 'Four ' + RANK_PLURAL[a];
      case 6: return 'Full House, ' + RANK_PLURAL[a] + ' full of ' + RANK_PLURAL[b];
      case 5: return 'Flush, ' + RANK_NAME[(score >> 16) & 15] + ' high';
      case 4: return 'Straight, ' + RANK_NAME[score & 15] + ' high';
      case 3: return 'Three ' + RANK_PLURAL[a];
      case 2: return 'Two Pair, ' + RANK_PLURAL[a] + ' and ' + RANK_PLURAL[b];
      case 1: return 'Pair of ' + RANK_PLURAL[a];
      default: return RANK_NAME[(score >> 16) & 15] + ' high';
    }
  }

  /** Pick the 5 cards that make the best hand (for highlighting). */
  function bestFive(cards) {
    const best = evaluate(cards);
    if (cards.length <= 5) return cards.slice();
    const n = cards.length;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      const five = cards.filter((_, i) => i !== a && i !== b);
      if (n === 7) { if (evaluate(five) === best) return five; }
    }
    if (n === 6) for (let a = 0; a < n; a++) { const five = cards.filter((_, i) => i !== a); if (evaluate(five) === best) return five; }
    return cards.slice(0, 5);
  }

  // ---------- starting hand codes ----------
  /** "AKs", "AKo", "TT" */
  function handCode(c1, c2) {
    let r1 = rankOf(c1), r2 = rankOf(c2);
    if (r2 > r1) { const t = r1; r1 = r2; r2 = t; }
    const a = RANKS[r1 - 2], b = RANKS[r2 - 2];
    if (r1 === r2) return a + b;
    return a + b + (suitOf(c1) === suitOf(c2) ? 's' : 'o');
  }
  function allCodes() {
    const out = [];
    for (let i = 12; i >= 0; i--) for (let j = 12; j >= 0; j--) {
      if (i === j) out.push(RANKS[i] + RANKS[j]);
      else if (j < i) { out.push(RANKS[i] + RANKS[j] + 's'); out.push(RANKS[i] + RANKS[j] + 'o'); }
    }
    return out;
  }
  function codeCombos(code) {
    const r1 = RANKS.indexOf(code[0]) + 2, r2 = RANKS.indexOf(code[1]) + 2;
    const out = [];
    if (r1 === r2) {
      for (let s1 = 0; s1 < 4; s1++) for (let s2 = s1 + 1; s2 < 4; s2++) out.push([makeCard(r1, s1), makeCard(r2, s2)]);
    } else if (code[2] === 's') {
      for (let s = 0; s < 4; s++) out.push([makeCard(r1, s), makeCard(r2, s)]);
    } else {
      for (let s1 = 0; s1 < 4; s1++) for (let s2 = 0; s2 < 4; s2++) if (s1 !== s2) out.push([makeCard(r1, s1), makeCard(r2, s2)]);
    }
    return out;
  }

  // ---------- equity ----------
  /**
   * Monte Carlo equity for hero vs opponents.
   * opponents: array of samplers. Each sampler is a function(rng, dead:Uint8Array) returning [c1,c2] or null (random hand).
   * Returns { win, tie, equity } where equity counts split pots fractionally.
   */
  function equity(hero, board, opponents, iterations, rng) {
    rng = rng || Math.random;
    const nOpp = opponents.length;
    if (nOpp === 0) return { win: 1, tie: 0, equity: 1 };
    let eqSum = 0, wins = 0, ties = 0, done = 0;
    const dead = new Uint8Array(52);
    const need = 5 - board.length;
    const seven = new Array(7);
    const oppCards = new Array(nOpp);
    for (let it = 0; it < iterations; it++) {
      dead.fill(0);
      dead[hero[0]] = 1; dead[hero[1]] = 1;
      for (let i = 0; i < board.length; i++) dead[board[i]] = 1;
      let ok = true;
      for (let o = 0; o < nOpp; o++) {
        let h = opponents[o] ? opponents[o](rng, dead) : null;
        if (!h || dead[h[0]] || dead[h[1]]) h = randomHand(rng, dead);
        if (!h) { ok = false; break; }
        dead[h[0]] = 1; dead[h[1]] = 1;
        oppCards[o] = h;
      }
      if (!ok) continue;
      const runout = board.slice();
      for (let k = 0; k < need; k++) {
        let c;
        do { c = Math.floor(rng() * 52); } while (dead[c]);
        dead[c] = 1; runout.push(c);
      }
      for (let i = 0; i < 5; i++) seven[i] = runout[i];
      seven[5] = hero[0]; seven[6] = hero[1];
      const hs = evaluate(seven);
      let best = 0, nBest = 0;
      for (let o = 0; o < nOpp; o++) {
        seven[5] = oppCards[o][0]; seven[6] = oppCards[o][1];
        const s = evaluate(seven);
        if (s > best) { best = s; nBest = 1; } else if (s === best) nBest++;
      }
      if (hs > best) { wins++; eqSum += 1; }
      else if (hs === best) { ties++; eqSum += 1 / (nBest + 1); }
      done++;
    }
    if (!done) return { win: 0, tie: 0, equity: 0 };
    return { win: wins / done, tie: ties / done, equity: eqSum / done };
  }
  function randomHand(rng, dead) {
    let a, b, guard = 0;
    do { a = Math.floor(rng() * 52); } while (dead[a] && ++guard < 500);
    do { b = Math.floor(rng() * 52); } while ((dead[b] || b === a) && ++guard < 1000);
    if (guard >= 1000) return null;
    return [a, b];
  }

  // ---------- draws / made-hand analysis (used by coach + AI) ----------
  /** Describe the hero's hand on a board in plain terms: made hand + draws + outs. */
  function analyzeHand(hole, board) {
    const all = hole.concat(board);
    const score = evaluate(all);
    const cat = score >> 20;
    const res = { score, cat, name: describeScore(score), draws: [], outs: 0, outCards: [], madeLabel: '', usesHole: true };
    if (board.length < 3) return res;
    const boardScore = board.length >= 5 ? evaluate(board) : -1;
    res.usesHole = boardScore !== score;
    // Pair-quality labels
    const boardRanks = board.map(rankOf).sort((a, b) => b - a);
    const topBoard = boardRanks[0];
    const pairRank = (score >> 16) & 15;
    if (cat === 1) {
      const holeR = hole.map(rankOf);
      const pocket = holeR[0] === holeR[1];
      if (pocket && pairRank > topBoard) res.madeLabel = 'overpair';
      else if (pocket) res.madeLabel = 'underpair';
      else if (!holeR.includes(pairRank)) res.madeLabel = 'board pair';
      else if (pairRank === topBoard) {
        const kicker = holeR[0] === pairRank ? holeR[1] : holeR[0];
        res.madeLabel = kicker >= 12 ? 'top pair, strong kicker' : kicker >= 9 ? 'top pair, medium kicker' : 'top pair, weak kicker';
      } else if (pairRank === boardRanks[1]) res.madeLabel = 'middle pair';
      else res.madeLabel = 'bottom pair';
    } else if (cat === 3) {
      const holeR = hole.map(rankOf);
      res.madeLabel = holeR[0] === holeR[1] ? 'set' : (holeR.includes(pairRank) ? 'trips' : 'trips on board');
    } else if (cat === 2) {
      const holeR = hole.map(rankOf);
      const a = (score >> 16) & 15, b = (score >> 12) & 15;
      res.madeLabel = (holeR.includes(a) && holeR.includes(b)) ? 'two pair (both cards)' : (holeR.includes(a) || holeR.includes(b)) ? 'two pair (one card + board pair)' : 'two pair on board';
    }
    if (board.length === 5) return res;
    // Outs: cards that improve to a clearly stronger category (and use a hole card)
    const dead = new Uint8Array(52);
    all.forEach((c) => (dead[c] = 1));
    let flushOuts = 0, straightOuts = 0;
    const outs = [];
    for (let c = 0; c < 52; c++) {
      if (dead[c]) continue;
      const nb = board.concat([c]);
      const s = evaluate(hole.concat(nb));
      const nc = s >> 20;
      const boardOnly = evaluate(nb);
      if (nc >= 4 && nc > cat && (nb.length < 5 || s !== boardOnly)) {
        if (nc === 5 || nc === 8) flushOuts++;
        if (nc === 4) straightOuts++;
        outs.push(c);
      } else if (cat <= 1 && nc > cat && nc >= 2 && board.length === 3 && hole.some((h) => rankOf(h) === rankOf(c))) {
        // improving to two pair / trips with a hole-card rank
        outs.push(c);
      }
    }
    if (flushOuts >= 8) res.draws.push('flush draw');
    if (straightOuts >= 8) res.draws.push('open-ended straight draw');
    else if (straightOuts >= 4) res.draws.push('gutshot straight draw');
    res.outs = outs.length;
    res.outCards = outs;
    return res;
  }

  FS.cards = {
    RANKS, SUITS, SUIT_GLYPH, RANK_NAME, RANK_PLURAL, CAT_NAME,
    rankOf, suitOf, makeCard, cardStr, cardPretty, parseCard, parseCards, newDeck,
    evaluate, category, describeScore, bestFive, handCode, allCodes, codeCombos,
    equity, randomHand, analyzeHand, straightHigh,
  };
})(typeof window !== 'undefined' ? window : globalThis);
