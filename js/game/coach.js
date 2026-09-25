/* The built-in coach: turns the strategy analysis into plain-English guidance at three levels,
   grades the player's decisions, keeps a glossary for jargon, and narrates hands. */
(function (root) {
  'use strict';
  const FS = root.FS;
  const C = FS.cards, U = FS.util, PF = FS.preflop;
  const fc = (n) => U.fmtChips(n);

  // ---------- glossary ----------
  // Text in hints can contain [[term]] or [[term|shown text]] — rendered as hover-to-explain.
  const GLOSSARY = {
    'blinds': 'Forced bets that start the pot. The two players left of the dealer button post them every hand: the small blind (half) and the big blind (full).',
    'big blind': 'The larger forced bet, posted by the second player left of the button. Stack sizes are measured in big blinds (“BB”).',
    'small blind': 'The smaller forced bet (half the big blind), posted by the player directly left of the button.',
    'ante': 'Extra dead money in the pot. In this tournament the big-blind player pays it for the whole table (a “big blind ante”). Antes make stealing the blinds more worthwhile.',
    'button': 'The dealer marker. The player on the button acts last after the flop — the best seat at the table.',
    'position': 'Where you sit relative to the button. Acting later is a big advantage: you see what everyone else does before you decide.',
    'in position': 'You act after your opponent on each betting round — an advantage.',
    'out of position': 'You must act before your opponent on each betting round — a disadvantage.',
    'early position': 'The first seats to act before the flop (left of the big blind). Play tight here — many players still to act behind you.',
    'late position': 'The cutoff and the button — the last seats to act before the blinds. You can play more hands here.',
    'UTG': '“Under the gun”: first to act before the flop. The toughest seat, so play only strong hands.',
    'cutoff': 'The seat just right of the button. The second-best seat.',
    'hijack': 'Two seats right of the button.',
    'preflop': 'The first betting round, after you get your two cards and before any community cards.',
    'flop': 'The first three community cards, dealt face up together.',
    'turn': 'The fourth community card.',
    'river': 'The fifth and final community card. Then the last betting round.',
    'showdown': 'After the final bet, remaining players reveal cards; the best five-card hand wins.',
    'check': 'Pass without betting (only allowed when nobody has bet this round).',
    'call': 'Match the current bet to stay in the hand.',
    'bet': 'Put chips in when nobody has yet this round.',
    'raise': 'Increase the current bet. Others must match your new amount to continue.',
    '3-bet': 'A re-raise: someone raised, and another player raised again. Usually means a strong hand.',
    'all-in': 'Betting every chip you have. You can’t be forced out, but you can only win as much as you put in from each opponent.',
    'shove': 'Slang for going all-in.',
    'fold': 'Give up the hand and any chips already put in.',
    'limp': 'Just calling the big blind before the flop instead of raising. Usually a sign of a weaker or passive player.',
    'open': 'Being the first player to raise before the flop.',
    'c-bet': '“Continuation bet”: the player who raised before the flop bets again on the flop, continuing the story of a strong hand.',
    'value bet': 'A bet made because you think you have the best hand and worse hands will call.',
    'bluff': 'A bet with a weak hand, hoping better hands fold.',
    'semi-bluff': 'Betting with a drawing hand: you might win right away if they fold, and if called you can still improve.',
    'pot odds': 'The price you are getting. If you must call 100 to win a pot of 300, you pay 100 to win 400 total — you need to win at least 25% of the time to break even.',
    'equity': 'Your share of the pot if all cards were dealt out right now — basically your chance of winning (ties count half).',
    'outs': 'Unseen cards that would improve your hand to a likely winner.',
    'rule of 2 and 4': 'Quick math: outs × 2 ≈ % chance to hit on the next card; outs × 4 ≈ % chance by the river (from the flop, if you see both cards).',
    'draw': 'A hand that is not strong yet but could become strong, like four cards to a flush.',
    'flush draw': 'Four cards of the same suit — one more of that suit makes a flush. Usually 9 outs.',
    'open-ended straight draw': 'Four cards in a row (like 8-9-10-J): either end completes a straight. 8 outs.',
    'gutshot': 'A straight draw missing a middle card (like 8-9-_-J-Q). 4 outs.',
    'top pair': 'Pairing the highest card on the board with one of your cards.',
    'kicker': 'Your unpaired side card. With the same pair, the higher kicker wins.',
    'overpair': 'A pocket pair higher than every card on the board.',
    'set': 'Three of a kind using a pocket pair — very strong and well disguised.',
    'nuts': 'The best possible hand given the board.',
    'range': 'All the hands an opponent could have, based on how they have played. Good players think in ranges, not single hands.',
    'stack': 'The chips a player has in front of them.',
    'effective stack': 'The smaller of your stack and your opponent’s — the most you can win or lose between you.',
    'BB': 'Big blinds. “20 BB” means your stack equals 20 big blinds — the key measure of how deep you are.',
    'SPR': 'Stack-to-pot ratio: your stack divided by the pot. Low SPR = you are pot-committed; high SPR = plenty of room to maneuver.',
    'bubble': 'The point where one more elimination puts everyone else in the money.',
    'in the money': 'Among the finishers who win a prize.',
    'ICM': 'Independent Chip Model: in tournaments, chips you lose hurt more than chips you win help, because busting ends your run. So avoid coin-flips for your tournament life when you don’t need them.',
    'push/fold': 'Short-stack strategy (about 12 BB or less): either go all-in or fold. Small raises commit too many chips to fold anyway.',
    'fold equity': 'The extra value from the chance your opponent folds to your bet.',
    'tilt': 'Playing emotionally (usually too loose/aggressive) after a bad beat or big loss.',
    'slow-play': 'Checking or calling with a monster hand to trap opponents into betting.',
    'pot control': 'Checking a medium-strength hand to keep the pot small, so you don’t lose a big pot to a better hand.',
    'calling station': 'A player who calls too much and rarely folds. Don’t bluff them; bet your good hands.',
    'nit': 'A very tight, cautious player.',
    'side pot': 'When a player is all-in, extra bets between the others go to a separate pot the all-in player can’t win.',
    'isolate': 'Raising after a limper to get heads-up with them, usually with position.',
    'steal': 'Raising from late position mainly to win the blinds and antes.',
    'suited': 'Both hole cards share a suit (like A♥ 5♥). Slightly better: they can make flushes.',
    'offsuit': 'Hole cards of different suits.',
    'pocket pair': 'Two hole cards of the same rank (like 7♣ 7♦).',
    'connectors': 'Hole cards next to each other in rank (like 8-9). Good for making straights.',
    'board': 'The community cards in the middle, shared by everyone.',
    'check-raise': 'Checking, then raising after an opponent bets. A strong (or bluffing) move.',
    'heads-up': 'Only two players in the hand (or at the table).',
    'implied odds': 'Extra chips you expect to win later if you hit your draw — lets you call slightly worse pot odds with strong, hidden draws.',
    'M': 'How many rounds of blinds+antes your stack can survive without playing.',
    'dry board': 'Community cards that don’t connect: few straight/flush possibilities (like K♠ 7♦ 2♣).',
    'wet board': 'Connected or suited community cards with many draws possible (like 9♥ 8♥ 6♠).',
  };
  function glossaryHTML(text) {
    return U.esc(text).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, key, shownText) => {
      const shown = shownText || key;
      const k = Object.keys(GLOSSARY).find((g) => g.toLowerCase() === key.toLowerCase()) || key;
      const def = GLOSSARY[k];
      if (!def) return shown;
      return `<span class="term" tabindex="0" data-def="${U.esc(def)}">${shown}</span>`;
    }).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  }

  // ---------- helpers ----------
  const POS_PLAIN = {
    BTN: 'on the [[button]] — the best seat; you act last after the flop',
    SB: 'in the [[small blind]] — you already have half a bet in, but you act first after the flop',
    BB: 'in the [[big blind]] — you already have a full bet in, so calling is cheap, but you act early after the flop',
    UTG: '[[UTG|UTG]] (first to act) — the toughest seat; many players act after you',
    'UTG+1': 'in [[early position]], right after the first player — play tight',
    MP: 'in middle position — several players still act after you',
    LJ: 'in the lojack (middle position) — a few players act after you',
    HJ: 'in the [[hijack]] — getting close to the good seats',
    CO: 'in the [[cutoff]] — the second-best seat; only the button and blinds act after you',
  };
  function handName(cards) {
    const code = C.handCode(cards[0], cards[1]);
    const r1 = C.RANK_NAME[C.rankOf(cards[0])], r2 = C.RANK_NAME[C.rankOf(cards[1])];
    let hi = r1, lo = r2;
    if (C.rankOf(cards[1]) > C.rankOf(cards[0])) { hi = r2; lo = r1; }
    if (code.length === 2) return 'a pair of ' + C.RANK_PLURAL[C.rankOf(cards[0])];
    return hi + '-' + lo + (code[2] === 's' ? ' [[suited]]' : ' [[offsuit]]');
  }
  const prettyCards = (cards) => cards.map(C.cardPretty).join(' ');
  function boardTexture(board) {
    if (board.length < 3) return null;
    const suits = [0, 0, 0, 0]; board.forEach((c) => suits[C.suitOf(c)]++);
    const maxSuit = Math.max(...suits);
    const ranks = [...new Set(board.map(C.rankOf))].sort((a, b) => a - b);
    let connected = 0;
    for (let i = 1; i < ranks.length; i++) if (ranks[i] - ranks[i - 1] <= 2) connected++;
    const paired = ranks.length < board.length;
    const notes = [];
    if (maxSuit >= 3) notes.push(maxSuit >= 4 ? 'four cards of one suit are out — any player with one more of that suit has a flush' : 'three cards share a suit — a flush is possible');
    else if (maxSuit === 2 && board.length < 5) notes.push('two cards share a suit — flush draws are possible');
    if (connected >= 2) notes.push('the cards are close in rank — straights and straight draws are likely');
    if (paired) notes.push('the board is paired — full houses and trips are possible');
    const river = board.length === 5;
    const wet = maxSuit >= 3 || connected >= 2 || (!river && maxSuit === 2 && connected >= 1);
    return { wet, notes, label: wet ? '[[wet board|wet]]' : notes.length ? 'fairly [[dry board|dry]]' : '[[dry board|dry]]' };
  }

  // ---------- tier 1: big picture ----------
  function bigPicture(ctx) {
    const { A, T, hand } = ctx;
    const out = [];
    const bb = hand.bbAmt;
    const effBB = A ? A.effBB : 0;
    const heroP = hand.players[ctx.heroSeat];
    const stackBB = (heroP.stack + heroP.bet) / bb;
    const TM = FS.tournament;
    if (T) {
      const alive = TM.alive(T).length, paid = T.payouts.length;
      if (alive === 2) out.push('**Heads-up for the title.** With only two players, you’re in the blinds every hand — play far more hands than usual and be aggressive.');
      else if (TM.onBubble(T)) out.push(`**Bubble time!** ${alive} players left and ${paid} get paid. The next person out gets nothing. Medium stacks should avoid risky all-ins; big stacks can pressure everyone.`);
      else if (alive <= paid + 3 && !TM.inTheMoney(T)) out.push(`**Approaching the money.** ${alive} left, ${paid} paid. Survival has extra value now ([[ICM]]) — avoid marginal all-ins unless you’re short.`);
      else if (TM.inTheMoney(T)) out.push(`**You’re in the money!** Every elimination now increases the prize. Play to climb: pick your spots, but don’t just wait around.`);
      if (TM.isFinalTable(T) && T.field > 9 && alive > 2) out.push('**Final table.** Payouts jump with each place — watch the short stacks; they’re likely to go all-in with wide ranges.');
    }
    if (stackBB <= 10) out.push(`**Short stack: ${stackBB.toFixed(1)} [[BB]].** You’re in [[push/fold]] mode: when you play, go all-in; don’t make small raises or limp. Waiting too long lets the blinds eat you.`);
    else if (stackBB <= 20) out.push(`**Getting short: ${stackBB.toFixed(0)} [[BB]].** Raising and folding costs a lot now. Prefer going all-in over calling raises, and look for chances to be the first one in.`);
    else if (stackBB <= 40) out.push(`**Middle stack: ${stackBB.toFixed(0)} [[BB]].** Open-raise to take the [[blinds]] and [[ante]] from late seats. Avoid calling big raises with medium hands.`);
    else out.push(`**Deep stack: ${stackBB.toFixed(0)} [[BB]].** Lots of room to play. Stick to solid hands, use [[position]], and don’t risk everything on one pair.`);
    if (heroP.pos && POS_PLAIN[heroP.pos]) {
      const early = ['UTG', 'UTG+1', 'MP'].includes(heroP.pos);
      const late = ['BTN', 'CO'].includes(heroP.pos);
      out.push(`**Your seat:** You are ${POS_PLAIN[heroP.pos]}. ${early ? 'Only play strong hands from here.' : late ? 'You can play more hands from here, especially if everyone folds to you.' : ''}`);
    }
    if (hand.street !== 'preflop') out.push('**After the flop:** Bet when you are likely ahead (or have a strong draw), check when unsure, and fold when the price is too high for your chances.');
    return out;
  }

  // ---------- tier 2: table read ----------
  function tableRead(ctx) {
    const { hand, heroSeat, profiles, A } = ctx;
    const out = [];
    const bb = hand.bbAmt;
    const me = hand.players[heroSeat];
    const acts = hand.actions.filter((a) => a.street === hand.street);
    const nameOf = (s) => (s === heroSeat ? 'You' : hand.players[s].name.split(' ')[0]);
    if (hand.street === 'preflop') {
      const raisers = acts.filter((a) => a.type === 'raise');
      const limpers = acts.filter((a) => a.type === 'call' && !raisers.some((r) => hand.actions.indexOf(r) < hand.actions.indexOf(a)));
      if (!raisers.length && !limpers.length) out.push(me.seat === hand.bbSeat ? 'Everyone folded or just called to you in the big blind.' : 'Nobody has entered the pot yet — you can be the first one in ([[open]]).');
      else {
        const parts = [];
        if (limpers.length) parts.push(`${limpers.map((a) => nameOf(a.seat)).join(', ')} just called the big blind ([[limp|limped]])`);
        raisers.forEach((r, i) => parts.push(`${nameOf(r.seat)} ${i === 0 ? 'raised' : 're-raised ([[3-bet]])'} to ${fc(r.amount)} (${(r.amount / bb).toFixed(1)} BB)${r.allIn ? ' — all-in' : ''}`));
        out.push(parts.join('; ') + '.');
      }
    } else {
      const tex = boardTexture(hand.board);
      out.push(`The [[board]] is ${prettyCards(hand.board)} — a ${tex.label} board${tex.notes.length ? ': ' + tex.notes.join('; ') : ''}.`);
      const pfa = hand.preflopAggressor;
      if (pfa >= 0 && !hand.players[pfa].folded) out.push(`${pfa === heroSeat ? 'You were' : nameOf(pfa) + ' was'} the preflop raiser, so ${pfa === heroSeat ? 'your' : 'their'} story is “strong hand”.`);
      if (acts.length) out.push('This round: ' + acts.map((a) => `${nameOf(a.seat)} ${verb(a)}`).join(', ') + '.');
    }
    // Opponents worth talking about: anyone who has put money in voluntarily (or is still in after the flop).
    // Players who haven't acted yet preflop are summarised in one line.
    const opps = hand.inHand.filter((p) => p.seat !== heroSeat);
    const acted = new Set(hand.actions.filter((a) => a.type === 'raise' || a.type === 'call').map((a) => a.seat));
    const featured = hand.street === 'preflop' ? opps.filter((o) => acted.has(o.seat)) : opps;
    if (hand.street === 'preflop') {
      const behind = opps.filter((o) => !acted.has(o.seat) && !hand.actions.some((a) => a.seat === o.seat));
      if (behind.length) {
        const lbl = (o) => { const pr = profiles && profiles(o.id); const st = pr && FS.roster.STYLES[pr.style]; return `${o.name.split(' ')[0]}${st ? ' (' + st.label + ')' : ''}${o.seat === hand.bbSeat ? ' in the big blind' : o.seat === hand.sbSeat ? ' in the small blind' : ''}`; };
        out.push(`Still to act after you: ${behind.map(lbl).join(', ')}.`);
      }
    }
    for (const o of featured.slice(0, 4)) {
      const pr = profiles && profiles(o.id);
      const st = pr && FS.roster.STYLES[pr.style];
      let line = `**${o.name}**`;
      if (st) line += ` (${st.label}): ${st.plain}`;
      if (A && A.ranges && A.ranges[o.seat]) line += ` Likely holding ${A.ranges[o.seat].desc}.`;
      if (pr && pr.observed && pr.observed.hands >= 8) line += ` You’ve seen them play ${Math.round(pr.observed.vpip * 100)}% of hands.`;
      out.push(line);
    }
    if (A && A.legal && A.legal.toCall > 0) {
      out.push(`It costs **${fc(A.legal.toCall)}** to call into a pot of **${fc(A.pot)}**.`);
    } else if (A && A.legal) out.push(`The pot is **${fc(A.pot)}**. Nobody has bet — you can [[check]] or [[bet]].`);
    return out;
  }
  function verb(a) {
    if (a.type === 'fold') return 'folded';
    if (a.type === 'check') return 'checked';
    if (a.type === 'call') return 'called' + (a.allIn ? ' all-in' : '');
    if (a.type === 'raise') return (a.isBet ? 'bet ' : 'raised to ') + fc(a.amount) + (a.allIn ? ' (all-in)' : '');
    return a.type;
  }

  // ---------- tier 3: hand coach ----------
  const KIND_WHY = {
    open: (A) => `Nobody has raised yet, and your hand is inside the top ${Math.round(A.threshold * 100)}% of hands worth raising from this seat. Raising gives you two ways to win: everyone folds now, or you have the better hand later.`,
    isolate: () => 'Someone limped. Raising punishes the weak limp, usually gets you heads-up, and you have the stronger hand.',
    shove: (A) => `With only ${A.effBB.toFixed(1)} [[BB]], a normal raise would commit most of your chips anyway. Going [[all-in]] wins the blinds and antes often, and when called you still have a fair chance.`,
    'push-fold': (A) => `At ${A.effBB.toFixed(1)} BB, you should either go all-in or fold. This hand isn’t in the ~${Math.round((A.threshold || 0) * 100)}% worth shoving from this seat. Wait for a better spot — but don’t wait too long.`,
    'fold-weak': (A) => `From this seat you want roughly the top ${Math.round((A.threshold || 0.2) * 100)}% of hands. This one is ${strength(A.pctile)}. Folding costs nothing.`,
    free: () => 'You can see the next card for free — no reason to fold.',
    limp: () => 'Completing/calling cheaply to see a flop. Only reasonable when it’s cheap and others already limped.',
    '3bet': () => 'Your hand is well ahead of the hands they would raise with. Re-raising ([[3-bet]]) builds the pot while you’re ahead and can take it down right now.',
    '3bet-bluff': () => 'A re-raise as a bluff: your hand has some playability, and many opponents fold to a 3-bet.',
    'call-raise': () => 'Good enough to call and see a flop, but not strong enough to re-raise. Having position helps you play after the flop.',
    'bb-defend': () => 'You already have a big blind in the pot, so calling is cheap. You get a good price to defend with a reasonable hand.',
    'fold-vs-raise': (A) => `A raise usually means a solid hand. Against the hands this player raises with, yours isn’t strong enough to continue profitably.`,
    reshove: () => 'Your stack is too short to call and play after the flop. Going all-in over their raise puts maximum pressure on them with a hand that’s ahead of their range.',
    defend: () => 'The price is good and your hand does well enough against their range.',
    '4bet': () => 'This is one of the very best starting hands. Raise again to build the pot (or get all-in) while you’re ahead.',
    'call-3bet': () => 'Strong enough to continue against a re-raise, but not strong enough to raise again.',
    'fold-vs-3bet': () => 'A re-raise (3-bet) usually means a very strong hand. Most hands should fold here.',
    'call-allin': (A) => `You need to win at least ${Math.round(A.potOdds * 100)}% to make this call profitable (pot odds), and against their likely hands you win about ${Math.round(A.equity * 100)}%.`,
    'fold-allin': (A) => `You need ${Math.round(A.potOdds * 100)}% to call profitably, but against their likely all-in hands you only win about ${Math.round(A.equity * 100)}%. Save your chips.`,
    'raise-value': (A) => `You’re very likely ahead (${Math.round(A.equity * 100)}% vs their likely hands). Raise to make worse hands pay more.`,
    'semi-bluff-raise': () => 'You have a big draw. Raising might win the pot now, and if called you can still hit.',
    call: (A) => `The pot is giving you ${oddsRatio(A)}. You need ${Math.round(A.potOdds * 100)}% and you estimate about ${Math.round(A.equity * 100)}%. Calling is profitable; raising risks getting re-raised by better hands.`,
    'call-draw': (A) => `You’re drawing: ${A.handInfo.outs} [[outs]]. The price (${Math.round(A.potOdds * 100)}% needed) is close to your chances${A.implied ? ', and you can win more later when you hit ([[implied odds]])' : ''}.`,
    'fold-post': (A) => `You need to win ${Math.round(A.potOdds * 100)}% of the time to call, but against the hands they’re likely betting with you only win about ${Math.round(A.equity * 100)}%. Folding saves chips.`,
    'value-bet': (A) => `You’re likely ahead (about ${Math.round(A.equity * 100)}%). Bet so worse hands pay you — checking gives free cards that might beat you.`,
    'semi-bluff': (A) => `You have a strong draw (${A.handInfo.outs} [[outs]]). A [[semi-bluff]] can win now if they fold, and you can still improve if called.`,
    'c-bet': () => 'You raised before the flop, so opponents expect a strong hand. A small [[c-bet]] often wins right here, even when you missed.',
    bluff: () => 'A bluff: your hand is weak, but they may fold.',
    'pot-control': () => 'Your hand is decent but not strong enough to build a big pot. Checking keeps the pot small ([[pot control]]) and lets weaker hands try to bluff.',
    'check-weak': () => 'Your hand is weak and betting would rarely make better hands fold. Check and see what happens.',
    slowplay: () => 'A trap (slow-play).',
  };
  /** Plain-English strength of a starting hand from its percentile (0 = best). */
  function strength(p) {
    const n = Math.max(1, Math.round(p * 100));
    return p <= 0.5 ? `in the top ${n}% of starting hands` : `weaker than about ${n}% of starting hands`;
  }
  function oddsRatio(A) {
    if (!A.toCall) return '';
    const r = A.pot / A.toCall;
    return `${r.toFixed(1)}-to-1 ([[pot odds]])`;
  }
  function recLabel(rec, A) {
    if (!rec) return '';
    if (rec.type === 'raise') {
      const bet = A.legal && A.legal.currentBet === 0;
      if (rec.allIn) return 'ALL-IN (' + fc(rec.to) + ')';
      return (bet ? 'BET ' : 'RAISE TO ') + fc(rec.to);
    }
    if (rec.type === 'call') return 'CALL ' + fc(A.toCall);
    return rec.type.toUpperCase();
  }
  function handCoach(ctx) {
    const { A, hand, heroSeat } = ctx;
    const out = [];
    if (!A) return out;
    const me = hand.players[heroSeat];
    if (hand.street === 'preflop') {
      out.push(`You hold **${prettyCards(me.cards)}** — ${handName(me.cards)}. That’s **${A.tier.label}** (${A.tier.blurb}; roughly the top ${Math.max(1, Math.round(PF.PCT_TOP[A.code] * 100))}% of starting hands).`);
    } else {
      const hi = A.handInfo;
      let s = `You have **${hi.name}**${hi.madeLabel ? ' — ' + termize(hi.madeLabel) : ''}.`;
      if (['board pair', 'two pair on board', 'trips on board'].includes(hi.madeLabel)) {
        const hiCard = Math.max(...me.cards.map(C.rankOf));
        s = `The board itself has the ${hi.name.toLowerCase().replace(/^pair of /, 'pair of ')} — everyone shares that. Your own cards add only a ${C.RANK_NAME[hiCard]}-high [[kicker]], so treat this as a weak hand unless you improve.`;
      }
      if (!hi.usesHole && hand.board.length === 5) s += ' (That hand is entirely on the board — everyone shares it.)';
      out.push(s);
      if (hi.draws.length) {
        const nx = hand.street === 'flop' ? `~${hi.outs * 4}% by the river, ~${hi.outs * 2}% on the next card` : `~${hi.outs * 2}% on the river`;
        out.push(`Draws: ${hi.draws.map(termize).join(' + ')} with **${hi.outs} [[outs]]**. [[rule of 2 and 4|Rule of 2 and 4]]: ${nx}.`);
      }
    }
    const opp = A.eqOpps ? A.eqOpps.length : A.nOpp;
    if (A.eqVsRandom) out.push(`Against a random hand you’d win about **${Math.round(A.equity * 100)}%** of the time ([[equity]]). Nobody has shown strength yet — what matters is how many players are left to act behind you.`);
    else out.push(`Against the hands ${opp > 1 ? 'the ' + opp + ' players in the pot' : 'your opponent'} likely ${opp > 1 ? 'have' : 'has'}, you win about **${Math.round(A.equity * 100)}%** of the time ([[equity]]).${opp > 1 ? ` (With ${opp + 1} players, an even share would be ${Math.round(100 / (opp + 1))}%.)` : ''}`);
    if (A.toCall > 0) out.push(`[[pot odds|Pot odds]]: call ${fc(A.toCall)} to win ${fc(A.pot + A.toCall)} total → you need at least **${Math.round(A.potOdds * 100)}%** to break even.`);
    return out;
  }
  function termize(label) {
    return label.replace(/top pair/, '[[top pair]]').replace(/overpair/, '[[overpair]]').replace(/^set$/, '[[set]]').replace(/kicker/, '[[kicker]]')
      .replace(/flush draw/, '[[flush draw]]').replace(/open-ended straight draw/, '[[open-ended straight draw]]').replace(/gutshot straight draw/, '[[gutshot]] straight draw');
  }
  function recommendation(ctx) {
    const { A } = ctx;
    if (!A || !A.rec) return null;
    const why = KIND_WHY[A.rec.kind];
    return { label: recLabel(A.rec, A), type: A.rec.type, to: A.rec.to, allIn: !!A.rec.allIn, why: why ? why(A) : '', kind: A.rec.kind };
  }

  // ---------- grading ----------
  /** Compare the player's action to the coach's recommendation. */
  function grade(A, action, hand, heroSeat) {
    if (!A || !A.rec) return null;
    const rec = A.rec.type;
    let took = action.type === 'bet' ? 'raise' : action.type;
    if (took === 'call' && A.toCall === 0) took = 'check';
    const eq = A.equity, need = A.potOdds;
    const me = hand.players[heroSeat];
    const stake = A.toCall / Math.max(1, me.stack + me.bet); // how much of stack is at risk
    const big = stake > 0.25 || (took === 'raise' && action.to >= (me.stack + me.bet) * 0.5);
    const r = (g, text) => ({ grade: g, text, rec: recLabel(A.rec, A), took, street: hand.street });
    if (took === rec) {
      if (rec === 'raise' && action.to && A.rec.to) {
        const ratio = action.to / A.rec.to;
        if (ratio > 2.5 && !A.rec.allIn && hand.street === 'preflop' && action.to >= (me.stack + me.bet) * 0.9) return r('ok', 'Right idea to raise, but going all-in risks your whole stack when a normal raise gets the job done.');
        if (ratio < 0.5 && hand.street !== 'preflop') return r('ok', 'Right idea to bet, but your size was small — bigger bets win more from worse hands.');
      }
      return r('good', 'Matches the coach’s play. ' + stripTerms(KIND_WHY[A.rec.kind] ? KIND_WHY[A.rec.kind](A) : ''));
    }
    if (took === 'fold') {
      if (rec === 'check') return r('mistake', 'You folded when you could check for free!');
      if (A.toCall > 0 && eq > need + 0.15) return r('mistake', `Too tight. You needed ${Math.round(need * 100)}% and had about ${Math.round(eq * 100)}% — this was a profitable ${rec}.`);
      if (hand.street === 'preflop' && rec === 'raise' && A.pctile < 0.08) return r('mistake', 'Folding a premium hand. This hand should be played aggressively.');
      return r('ok', `Folding is a bit cautious — the coach would ${rec} — but it’s not a big error.`);
    }
    if (took === 'call') {
      if (rec === 'fold') {
        if (hand.street === 'preflop' && A.facing && (A.facing === 'unopened' || A.facing === 'limpers') && A.pctile > (A.threshold || 0.3) * 1.6) return r('mistake', `Limping with a weak hand (${strength(A.pctile)}). From this seat, hands this weak should fold; limping invites raises and tough spots after the flop.`);
        if (eq < need - 0.07) return r(big ? 'blunder' : 'mistake', `Calling cost ${fc(A.toCall)} but you needed ${Math.round(need * 100)}% to win and had only about ${Math.round(eq * 100)}% against their likely hands.`);
        return r('ok', 'A loose call — close to break-even. The coach prefers folding.');
      }
      if (rec === 'raise') return r('ok', `Calling is fine, but with ${Math.round(eq * 100)}% equity a raise wins more (or takes the pot now).`);
    }
    if (took === 'check') {
      if (rec === 'raise') return r('ok', `Checking gives free cards. With about ${Math.round(eq * 100)}% equity, a bet would earn more from worse hands.`);
      if (rec === 'call') return r('ok', 'Checked.');
    }
    if (took === 'raise') {
      if (rec === 'fold') {
        if (hand.street === 'preflop' && A.rec.kind === 'push-fold') {
          if (A.effBB <= 3 || A.pctile <= (A.threshold || 0) * 1.3) return r('ok', `Close. With ${A.effBB.toFixed(1)} BB almost any hand can be shoved soon; the coach would wait one more hand with this one.`);
          return r('mistake', `Too loose a shove. At ${A.effBB.toFixed(1)} BB from this seat, shove roughly the top ${Math.round((A.threshold || 0) * 100)}% of hands; this one is ${strength(A.pctile)}.`);
        }
        if (hand.street === 'preflop' && A.pctile > 0.45) return r(big ? 'blunder' : 'mistake', `Raising with a weak hand (${strength(A.pctile)}). When called, you’ll usually be behind.`);
        return r(big ? 'mistake' : 'ok', big ? `Big raise as a bluff with only ~${Math.round(eq * 100)}% equity. Risky — the coach would fold.` : 'An aggressive bluff. Occasionally OK, but the coach would fold here.');
      }
      if (rec === 'check') {
        if (eq < 0.3 && big) return r('mistake', `A big bet with a weak hand (~${Math.round(eq * 100)}% equity). If they call, you’re likely beaten.`);
        return r('ok', eq < 0.35 ? 'A bluff. Fine occasionally, especially against cautious players — not against calling stations.' : 'Betting a medium hand. It can work, but checking keeps the pot small.');
      }
      if (rec === 'call') return r('ok', 'Raising here is aggressive; calling was the steadier play.');
    }
    return r('ok', 'Reasonable.');
  }
  function stripTerms(s) { return (s || '').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, k, sh) => sh || k); }

  // ---------- narration ----------
  function describeAction(a, hand) {
    const name = hand.players[a.seat].name;
    return `${name} ${verb(a)}`;
  }
  /** Full plain-text hand history (used for the review screen and the AI coach). */
  function narrate(hand, heroSeat, grades) {
    const lines = [];
    const nameOf = (s) => (s === heroSeat ? 'Hero (you)' : hand.players[s].name);
    lines.push(`Blinds ${fc(hand.sbAmt)}/${fc(hand.bbAmt)}${hand.anteAmt ? ' ante ' + fc(hand.anteAmt) : ''}. ${hand.seated.length} players.`);
    lines.push('Seats: ' + hand.order.map((s) => `${nameOf(s)} [${hand.players[s].pos}] ${fc(hand.players[s].startStack)}`).join(', '));
    if (heroSeat != null && hand.players[heroSeat]) lines.push(`Hero's cards: ${prettyCards(hand.players[heroSeat].cards)}`);
    let street = null;
    let gi = 0;
    for (const a of hand.actions) {
      if (a.street !== street) {
        street = a.street;
        const nb = street === 'flop' ? 3 : street === 'turn' ? 4 : street === 'river' ? 5 : 0;
        lines.push(`— ${street.toUpperCase()}${nb ? ' [' + prettyCards(hand.board.slice(0, nb)) + ']' : ''} —`);
      }
      let ln = `${nameOf(a.seat)} ${verb(a)}`;
      if (a.seat === heroSeat && grades && grades[gi]) { ln += `   ⟵ coach: ${grades[gi].grade.toUpperCase()} (suggested ${grades[gi].rec})`; gi++; }
      lines.push(ln);
    }
    const shownBoard = { flop: 3, turn: 4, river: 5 }[street] || 0;
    if (hand.board.length > shownBoard) lines.push(`Board ran out: ${prettyCards(hand.board)}`);
    const R = hand.results;
    if (R) {
      if (!R.uncontested) for (const s of R.shown) lines.push(`${nameOf(+s)} shows ${prettyCards(hand.players[s].cards)} (${R.handNames[s]})`);
      for (const [s, amt] of Object.entries(R.winnings)) lines.push(`${nameOf(+s)} wins ${fc(amt)}${R.uncontested ? ' (everyone else folded)' : ''}`);
    }
    return lines.join('\n');
  }

  FS.coach = { GLOSSARY, glossaryHTML, bigPicture, tableRead, handCoach, recommendation, grade, narrate, describeAction, verb, handName, prettyCards, boardTexture, recLabel, POS_PLAIN };
})(typeof window !== 'undefined' ? window : globalThis);
