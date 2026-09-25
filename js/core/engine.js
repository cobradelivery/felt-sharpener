/* No-limit Texas Hold'em hand engine.
   Handles blinds, big-blind ante, betting rules (min-raise, short all-in not reopening action),
   uncalled bets, side pots, showdown, split pots. Pure state machine: UI/AI call act(). */
(function (root) {
  'use strict';
  const FS = root.FS;
  const C = FS.cards;

  const STREETS = ['preflop', 'flop', 'turn', 'river', 'showdown'];

  /** Position names for n players, ordered starting from the button. */
  function positionNames(n) {
    if (n === 2) return ['BTN', 'BB'];
    if (n === 3) return ['BTN', 'SB', 'BB'];
    const k = n - 3;
    const middle = ['UTG'].concat(['UTG+1', 'MP', 'LJ', 'HJ', 'CO'].slice(6 - k));
    return ['BTN', 'SB', 'BB'].concat(middle);
  }

  class Hand {
    /**
     * opts: { seats: [ {id, name, stack} | null ] (length = table size), button, sb, bb, ante, rng, handNo }
     */
    constructor(opts) {
      this.rng = opts.rng || Math.random;
      this.handNo = opts.handNo || 1;
      this.sbAmt = opts.sb; this.bbAmt = opts.bb; this.anteAmt = opts.ante || 0;
      this.size = opts.seats.length;
      this.players = opts.seats.map((s, i) => s && s.stack > 0 ? {
        seat: i, id: s.id, name: s.name, startStack: s.stack, stack: s.stack,
        bet: 0, committed: 0, folded: false, allIn: false, cards: [], acted: false, level: -1, shown: false,
      } : null);
      this.button = opts.button;
      this.board = [];
      this.street = 'preflop';
      this.events = [];
      this.actions = []; // {street, seat, type, amount(total bet to), added}
      this.dead = 0;     // antes (dead money, main pot)
      this.currentBet = 0;
      this.lastRaise = this.bbAmt;
      this.raiseLevel = 0;
      this.actor = -1;
      this.done = false;
      this.results = null;
      this.lastAggressor = -1;      // seat that made the last bet/raise this street
      this.preflopAggressor = -1;
    }

    get seated() { return this.players.filter(Boolean); }
    get inHand() { return this.players.filter((p) => p && !p.folded); }
    nextSeat(from, pred) {
      for (let k = 1; k <= this.size; k++) {
        const s = (from + k) % this.size;
        const p = this.players[s];
        if (p && pred(p)) return s;
      }
      return -1;
    }
    pot() {
      let t = this.dead;
      for (const p of this.players) if (p) t += p.committed;
      return t;
    }
    /** Pot excluding the current street's outstanding bets. */
    potBeforeBets() { let t = this.pot(); for (const p of this.players) if (p) t -= p.bet; return t; }

    emit(e) { this.events.push(e); }

    start() {
      const deck = C.newDeck();
      FS.util.shuffleInPlace(deck, this.rng);
      this.deck = deck;
      const seated = this.seated;
      if (seated.length < 2) throw new Error('need 2+ players');
      if (!this.players[this.button]) this.button = this.nextSeat(this.button, () => true);
      // Positions
      const order = [this.button];
      let s = this.button;
      for (let i = 1; i < seated.length; i++) { s = this.nextSeat(s, () => true); order.push(s); }
      this.order = order;
      const names = positionNames(seated.length);
      order.forEach((seat, i) => (this.players[seat].pos = names[i]));
      if (seated.length === 2) { this.sbSeat = this.button; this.bbSeat = order[1]; }
      else { this.sbSeat = order[1]; this.bbSeat = order[2]; }
      this.emit({ type: 'start', button: this.button, sbSeat: this.sbSeat, bbSeat: this.bbSeat });
      this._post(this.sbSeat, this.sbAmt, 'small blind');
      this._post(this.bbSeat, this.bbAmt, 'big blind');
      if (this.anteAmt) {
        const p = this.players[this.bbSeat];
        const a = Math.min(this.anteAmt, p.stack);
        if (a > 0) {
          p.stack -= a; this.dead += a;
          if (p.stack === 0) p.allIn = true;
          this.emit({ type: 'post', seat: p.seat, amount: a, kind: 'ante' });
        }
      }
      this.currentBet = Math.max(this.players[this.sbSeat].bet, this.players[this.bbSeat].bet, this.bbAmt);
      this.lastRaise = this.bbAmt;
      // Deal, starting left of the button
      for (let r = 0; r < 2; r++) for (let i = 1; i <= order.length; i++) {
        const seat = order[i % order.length];
        this.players[seat].cards.push(this.deck.pop());
      }
      this.emit({ type: 'deal' });
      // First to act preflop: left of BB
      this._advance(this.bbSeat);
      return this;
    }

    _post(seat, amount, kind) {
      const p = this.players[seat];
      const a = Math.min(amount, p.stack);
      p.stack -= a; p.bet += a; p.committed += a;
      if (p.stack === 0) p.allIn = true;
      this.emit({ type: 'post', seat, amount: a, kind });
    }

    /** Legal options for the player to act. */
    legal(seat) {
      if (seat == null) seat = this.actor;
      const p = this.players[seat];
      if (!p || this.done || seat !== this.actor) return null;
      const toCall = Math.min(this.currentBet - p.bet, p.stack);
      const others = this.inHand.filter((q) => q.seat !== seat && !q.allIn).length;
      const reopened = !p.acted || p.level < this.raiseLevel;
      const canRaise = p.stack > toCall && reopened && others > 0;
      const maxRaiseTo = p.bet + p.stack;
      const minRaiseTo = Math.min(this.currentBet + this.lastRaise, maxRaiseTo);
      return {
        seat, toCall, canCheck: toCall === 0, canRaise,
        minRaiseTo, maxRaiseTo, currentBet: this.currentBet, pot: this.pot(),
        isBet: this.currentBet === 0, stack: p.stack, bet: p.bet,
      };
    }

    /** action: {type:'fold'|'check'|'call'|'raise', to?:number} ('bet' == 'raise' with no bet) */
    act(seat, action) {
      const L = this.legal(seat);
      if (!L) throw new Error('not your turn: seat ' + seat + ' actor ' + this.actor);
      const p = this.players[seat];
      let type = action.type === 'bet' ? 'raise' : action.type;
      if (type === 'check' && !L.canCheck) type = 'call';
      if (type === 'call' && L.toCall === 0) type = 'check';
      if (type === 'raise' && !L.canRaise) type = L.toCall ? 'call' : 'check';
      if (type === 'fold' && L.canCheck) type = 'check'; // never fold for free
      const rec = { street: this.street, seat, type, pos: p.pos, potBefore: this.pot(), toCall: L.toCall, stackBefore: p.stack };
      if (type === 'fold') {
        p.folded = true;
      } else if (type === 'check') {
        // nothing
      } else if (type === 'call') {
        const a = L.toCall;
        p.stack -= a; p.bet += a; p.committed += a; rec.amount = p.bet; rec.added = a;
        if (p.stack === 0) p.allIn = true;
      } else if (type === 'raise') {
        let to = Math.round(action.to || L.minRaiseTo);
        to = Math.max(L.minRaiseTo, Math.min(L.maxRaiseTo, to));
        const add = to - p.bet;
        const increment = to - this.currentBet;
        p.stack -= add; p.bet = to; p.committed += add;
        if (p.stack === 0) p.allIn = true;
        if (increment >= this.lastRaise) { this.lastRaise = increment; this.raiseLevel++; }
        const wasBet = this.currentBet === 0;
        this.currentBet = Math.max(this.currentBet, to);
        rec.amount = to; rec.added = add; rec.isBet = wasBet;
        this.lastAggressor = seat;
        if (this.street === 'preflop') this.preflopAggressor = seat;
      }
      rec.allIn = p.allIn && type !== 'fold' && type !== 'check';
      p.acted = true; p.level = this.raiseLevel;
      this.actions.push(rec);
      this.emit(Object.assign({}, rec, { type: 'action', action: rec.type }));
      // One player left?
      if (this.inHand.length === 1) { this._finishUncontested(); return; }
      this._advance(seat);
    }

    _needsAction(q) { return !q.folded && !q.allIn && (!q.acted || q.bet < this.currentBet); }

    _roundComplete() {
      const live = this.inHand.filter((p) => !p.allIn);
      if (live.length === 0) return true;
      if (live.length === 1 && live[0].bet >= this.currentBet) return true;
      return !live.some((p) => this._needsAction(p));
    }

    /** Move action to the next player after `fromSeat`, or close the betting round. */
    _advance(fromSeat) {
      if (this._roundComplete()) { this._endStreet(); return; }
      this.actor = this.nextSeat(fromSeat, (q) => this._needsAction(q));
    }

    _refundUncalled() {
      const live = this.players.filter((p) => p && p.bet > 0);
      if (!live.length) return;
      const sorted = live.slice().sort((a, b) => b.bet - a.bet);
      const top = sorted[0];
      const second = sorted[1] ? sorted[1].bet : 0;
      if (top.bet > second) {
        const r = top.bet - second;
        top.bet -= r; top.committed -= r; top.stack += r;
        if (top.stack > 0) top.allIn = false;
        this.emit({ type: 'refund', seat: top.seat, amount: r });
      }
    }

    _endStreet() {
      this._refundUncalled();
      for (const p of this.seated) { p.bet = 0; p.acted = false; p.level = -1; }
      this.currentBet = 0; this.lastRaise = this.bbAmt; this.raiseLevel = 0; this.lastAggressor = -1;
      const idx = STREETS.indexOf(this.street);
      if (this.street === 'river') { this._showdown(); return; }
      // deal next street
      const next = STREETS[idx + 1];
      this.deck.pop(); // burn
      const n = next === 'flop' ? 3 : 1;
      const cards = [];
      for (let i = 0; i < n; i++) cards.push(this.deck.pop());
      this.board.push(...cards);
      this.street = next;
      if (!this.runout && this.inHand.filter((p) => !p.allIn).length <= 1) {
        this.runout = true;
        for (const p of this.inHand) p.shown = true; // all-in: cards are turned face up
        this.emit({ type: 'allin-runout' });
      }
      this.emit({ type: 'street', street: next, cards, board: this.board.slice() });
      this._advance(this.button);
    }

    _finishUncontested() {
      this._refundUncalled();
      for (const p of this.seated) p.bet = 0;
      const w = this.inHand[0];
      const amount = this.pot();
      w.stack += amount;
      this.done = true; this.actor = -1;
      this.results = { uncontested: true, pots: [{ amount, winners: [w.seat], eligible: [w.seat] }], winnings: { [w.seat]: amount }, shown: [] };
      this.emit({ type: 'win', seat: w.seat, amount, uncontested: true });
      this.emit({ type: 'end' });
    }

    /** Build main/side pots from committed chips. */
    buildPots() {
      const contrib = this.players.map((p) => (p ? p.committed : 0));
      const pots = [];
      for (;;) {
        const liveLevels = this.players.filter((p) => p && !p.folded && contrib[p.seat] > 0).map((p) => contrib[p.seat]);
        if (!liveLevels.length) {
          const rest = contrib.reduce((a, b) => a + b, 0);
          if (rest > 0 && pots.length) pots[pots.length - 1].amount += rest;
          break;
        }
        const lvl = Math.min(...liveLevels);
        let amount = 0;
        const eligible = [];
        for (let s = 0; s < this.size; s++) {
          const take = Math.min(contrib[s], lvl);
          if (take > 0) { amount += take; contrib[s] -= take; }
          const p = this.players[s];
          if (p && !p.folded && take === lvl) eligible.push(s);
        }
        pots.push({ amount, eligible });
      }
      if (pots.length) pots[0].amount += this.dead;
      else pots.push({ amount: this.dead, eligible: this.inHand.map((p) => p.seat) });
      // merge pots with identical eligibility
      const merged = [];
      for (const pt of pots) {
        const prev = merged[merged.length - 1];
        if (prev && prev.eligible.join() === pt.eligible.join()) prev.amount += pt.amount;
        else merged.push(pt);
      }
      return merged;
    }

    _showdown() {
      this.street = 'showdown';
      this.actor = -1;
      const scores = {};
      for (const p of this.inHand) { scores[p.seat] = C.evaluate(p.cards.concat(this.board)); p.shown = true; }
      const pots = this.buildPots();
      const winnings = {};
      // odd chips go to first winner left of the button
      const leftOrder = [];
      for (let k = 1; k <= this.size; k++) leftOrder.push((this.button + k) % this.size);
      for (const pot of pots) {
        let best = -1, winners = [];
        for (const s of pot.eligible) {
          if (scores[s] > best) { best = scores[s]; winners = [s]; } else if (scores[s] === best) winners.push(s);
        }
        winners.sort((a, b) => leftOrder.indexOf(a) - leftOrder.indexOf(b));
        const share = Math.floor(pot.amount / winners.length);
        let odd = pot.amount - share * winners.length;
        for (const s of winners) {
          const amt = share + (odd > 0 ? 1 : 0); if (odd > 0) odd--;
          winnings[s] = (winnings[s] || 0) + amt;
          this.players[s].stack += amt;
        }
        pot.winners = winners;
        pot.handName = C.describeScore(best);
      }
      this.done = true;
      this.results = {
        uncontested: false, pots, winnings, scores,
        shown: this.inHand.map((p) => p.seat),
        handNames: Object.fromEntries(Object.entries(scores).map(([s, v]) => [s, C.describeScore(v)])),
      };
      this.emit({ type: 'showdown', results: this.results });
      for (const s of Object.keys(winnings)) this.emit({ type: 'win', seat: +s, amount: winnings[s] });
      this.emit({ type: 'end' });
    }

    /** Public info snapshot for a given viewer seat (hides others' hole cards unless shown). */
    view(viewer) {
      return {
        street: this.street, board: this.board.slice(), pot: this.pot(), button: this.button, actor: this.actor,
        currentBet: this.currentBet, bb: this.bbAmt, sb: this.sbAmt, ante: this.anteAmt,
        players: this.players.map((p) => p && {
          seat: p.seat, id: p.id, name: p.name, stack: p.stack, bet: p.bet, committed: p.committed,
          folded: p.folded, allIn: p.allIn, pos: p.pos,
          cards: (p.seat === viewer || p.shown) ? p.cards.slice() : null,
        }),
      };
    }
  }

  FS.engine = { Hand, positionNames, STREETS };
})(typeof window !== 'undefined' ? window : globalThis);
