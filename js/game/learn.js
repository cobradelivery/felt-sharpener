/* "Learn the Game" lessons — plain-English Hold'em course, from rules to live-tournament etiquette. */
(function (root) {
  'use strict';
  const FS = root.FS;
  const { $, $$ } = FS.ui;
  const C = FS.cards, PF = FS.preflop, U = FS.util;
  const g = (t) => FS.coach.glossaryHTML(t);
  const cards = (s) => `<span class="cards-row">${C.parseCards(s).map((c) => FS.ui.cardHTML(c)).join('')}</span>`;

  function positionSVG() {
    const names = ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'];
    const col = { BTN: '#ffcf3f', SB: '#b37bff', BB: '#b37bff', UTG: '#ff6b5b', 'UTG+1': '#ff6b5b', MP: '#ff9f45', LJ: '#ff9f45', HJ: '#a6e36a', CO: '#43e07a' };
    let s = `<svg class="pos-diagram" viewBox="0 0 520 320" role="img" aria-label="Table positions"><ellipse cx="260" cy="160" rx="200" ry="115" fill="#17753f" stroke="#5a2d12" stroke-width="16"/>
      <text x="260" y="150" text-anchor="middle" fill="rgba(255,255,255,.55)" font-size="13">Action moves clockwise →</text><text x="260" y="170" text-anchor="middle" fill="rgba(255,255,255,.55)" font-size="12">(preflop starts at UTG, after the flop at SB)</text>`;
    names.forEach((n, i) => {
      const th = (90 + i * 40) * Math.PI / 180;
      const x = 260 + Math.cos(th) * 228, y = 160 + Math.sin(th) * 136;
      s += `<circle cx="${x}" cy="${y}" r="25" fill="${col[n]}" stroke="#0a1733" stroke-width="3"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="${n.length > 3 ? 10 : 12}" font-weight="bold" fill="#10131c">${n}</text>`;
    });
    return s + '</svg>';
  }
  function handGrid() {
    const R = C.RANKS.split('').reverse();
    let out = '<div class="hand-grid">';
    for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
      const code = i === j ? R[i] + R[j] : i < j ? R[i] + R[j] + 's' : R[j] + R[i] + 'o';
      const t = PF.tierOf(code);
      out += `<div class="tier${t.tier}" data-tip="${code}: ${t.label} — top ${Math.max(1, Math.round(PF.PCT_TOP[code] * 100))}% of hands">${code.replace(/[so]$/, (m) => `<small>${m}</small>`)}</div>`;
    }
    return out + '</div>';
  }

  const LESSONS = [
    { id: 'hand', title: '1. How a hand works', html: () => `
      <h2>How a hand of Hold'em works</h2>
      <p>Every player gets <b>two private cards</b> (“hole cards”). Five <b>shared cards</b> are dealt face-up in the middle over three stages. You make the best five-card hand from any combination of your two cards and the five shared cards.</p>
      <h3>Step by step</h3>
      <ol>
        <li><b>The button.</b> A disc marks the “dealer” seat. It moves one seat left (clockwise) every hand. In a casino a professional dealer deals; the button just marks who is “last to act”.</li>
        <li><b>Blinds.</b> The two players left of the button post forced bets: the ${g('[[small blind]]')} and ${g('[[big blind]]')}. In modern tournaments the big blind also posts an ${g('[[ante]]')} for the whole table. These give everyone something to fight for.</li>
        <li><b>Deal.</b> Two cards each, one at a time, starting left of the button.</li>
        <li><b>Preflop betting.</b> Starts with the player left of the big blind (“under the gun”) and goes clockwise. Each player can <b>fold</b>, <b>call</b> (match the big blind or current bet), or <b>raise</b>.</li>
        <li><b>The flop.</b> Three shared cards. Another betting round, starting with the first active player left of the button. Now you can also <b>check</b> (pass) if no one has bet.</li>
        <li><b>The turn.</b> A fourth card. Betting round.</li>
        <li><b>The river.</b> The fifth card. Final betting round.</li>
        <li><b>Showdown.</b> Remaining players reveal; best five-card hand wins. If everyone else folds at any point, the last player wins without showing.</li>
      </ol>
      <h3>No-limit betting rules you need</h3>
      <ul>
        <li><b>No-limit</b> means you can bet any amount up to all your chips at any time.</li>
        <li>The <b>minimum bet</b> is one big blind. A <b>raise</b> must be at least as big as the previous bet or raise. (If someone bets 400, you can raise to at least 800.)</li>
        <li><b>All-in:</b> you can always call with fewer chips than the bet — you just can only win that much from each other player. Extra bets go into a ${g('[[side pot]]')}.</li>
        <li>If an all-in is <i>less than a full raise</i>, players who already acted can only call or fold — it doesn’t “reopen” the betting.</li>
      </ul>
      <div class="callout">The simulator enforces all of these rules, so playing here builds the right habits.</div>` },
    { id: 'rank', title: '2. Hand rankings', html: () => {
      const H = [
        ['Royal Flush', 'As Ks Qs Js Ts', 'A-K-Q-J-10 of one suit. The best hand.'],
        ['Straight Flush', '9h 8h 7h 6h 5h', 'Five in a row, same suit.'],
        ['Four of a Kind', 'Qc Qd Qh Qs 4d', 'Four cards of one rank (“quads”).'],
        ['Full House', 'Kh Kd Kc 7s 7d', 'Three of a kind plus a pair (“boat”). Higher three-of-a-kind wins first.'],
        ['Flush', 'Ad Jd 8d 6d 2d', 'Any five of one suit. Compare highest card, then next…'],
        ['Straight', 'Tc 9d 8h 7s 6c', 'Five in a row, mixed suits. Ace can be high (A-K-Q-J-10) or low (5-4-3-2-A).'],
        ['Three of a Kind', '8s 8h 8d Kc 3d', '“Trips”, or a “set” when you hold a pocket pair.'],
        ['Two Pair', 'Jh Jc 4s 4d Ac', 'Two different pairs. Higher pair decides, then lower pair, then kicker.'],
        ['One Pair', 'Ts Td Kh 7c 3s', 'Two cards of one rank. Ties are broken by the highest side cards (“kickers”).'],
        ['High Card', 'Ac Jd 8h 5s 3c', 'Nothing — the highest card plays.'],
      ];
      return `<h2>Hand rankings (best to worst)</h2><div class="rank-list">${H.map(([n, c, d], i) => `<div class="rank-item"><span class="n">${i + 1}</span><span>${cards(c)}</span><span class="desc"><b>${n}</b> — ${d}</span></div>`).join('')}</div>
        <h3>Things beginners miss</h3>
        <ul><li>Only <b>five cards</b> count. With A-K on a board of Q-Q-J-J-9, both “Queens and Jacks, Ace kicker”.</li>
        <li>Suits never break ties. Two identical straights split the pot.</li>
        <li>If the best hand is entirely on the board, everyone still in <b>splits</b> (“the board plays”).</li>
        <li>A <b>flush beats a straight</b>. A <b>full house beats a flush</b>.</li></ul>`;
    } },
    { id: 'pos', title: '3. Position', html: () => `
      <h2>Position: the most underrated edge</h2>
      ${positionSVG()}
      <p>Acting <b>last</b> is a huge advantage: you see what everyone does before you decide. The ${g('[[button]]')} acts last on every street after the flop, so it’s the best seat. The blinds act first after the flop, so they’re the worst.</p>
      <table class="grid"><tr><th>Seat</th><th>Meaning</th><th>How to play</th></tr>
        <tr><td><b style="color:#ff6b5b">UTG, UTG+1</b></td><td>Early position — first to act</td><td>Tightest: only strong hands (~12–15%).</td></tr>
        <tr><td><b style="color:#ff9f45">MP, LJ</b></td><td>Middle position</td><td>A bit wider (~16–20%).</td></tr>
        <tr><td><b style="color:#a6e36a">HJ</b>, <b style="color:#43e07a">CO</b></td><td>Late position</td><td>Wider (~23–30%), especially if everyone folded.</td></tr>
        <tr><td><b style="color:#ffcf3f">BTN</b></td><td>The button</td><td>Widest (~40–45%) when folded to you — steal those blinds!</td></tr>
        <tr><td><b style="color:#b37bff">SB, BB</b></td><td>The blinds</td><td>Already have chips in. Defend the big blind with decent hands against small raises; play carefully after the flop.</td></tr>
      </table>
      <div class="callout">Rule of thumb: <b>the later your seat, the more hands you can play.</b> The same hand can be a raise on the button and a fold under the gun.</div>` },
    { id: 'start', title: '4. Starting hands', html: () => `
      <h2>Which hands to play</h2>
      <p>The grid shows all 169 starting hands. Pairs run down the diagonal; <b>suited</b> hands (same suit, marked “s”) are above it; <b>offsuit</b> (“o”) below. Hover for details.</p>
      <div class="legend"><span><i class="tier1"></i>Premium</span><span><i class="tier2"></i>Strong</span><span><i class="tier3"></i>Good</span><span><i class="tier4"></i>Playable (late seats)</span><span><i class="tier5"></i>Marginal</span><span><i class="tier6"></i>Usually fold</span></div>
      ${handGrid()}
      <h3>Simple opening guide (when nobody has raised yet)</h3>
      <ul><li><b>Early seats:</b> red, orange and yellow hands.</li><li><b>Middle:</b> add some green.</li><li><b>Cutoff/Button:</b> most green and some blue.</li></ul>
      <h3>When someone has already raised</h3>
      <ul><li>Tighten up a lot. Re-raise (${g('[[3-bet]]')}) with premium hands (big pairs, A-K). Call with good hands, especially in position. Fold the rest.</li>
      <li>A re-raise from a tight player usually means Q-Q+ or A-K.</li></ul>
      <div class="callout"><b>Raise, don’t limp.</b> If a hand is good enough to play and no one has raised, raise to about 2–2.5× the big blind. Just calling (“limping”) gives up the initiative.</div>` },
    { id: 'odds', title: '5. Pot odds & outs', html: () => `
      <h2>Should I call? Pot odds in plain English</h2>
      <p>${g('[[pot odds|Pot odds]]')} compare the price of a call with what you can win.</p>
      <div class="callout"><b>Needed win % = call ÷ (pot after you call)</b><br>Pot is 600, opponent bets 200 (pot now 800). You call 200 to win 1,000 total → 200 ÷ 1,000 = <b>20%</b>. If you win more than 20% of the time, calling makes money long-term.</div>
      <h3>Counting outs</h3>
      <p>${g('[[outs|Outs]]')} are cards that turn your hand into a likely winner.</p>
      <table class="grid"><tr><th>Draw</th><th class="num">Outs</th><th class="num">Hit next card</th><th class="num">Hit by river (from flop)</th></tr>
        <tr><td>Flush draw</td><td class="num">9</td><td class="num">~19%</td><td class="num">~35%</td></tr>
        <tr><td>Open-ended straight draw</td><td class="num">8</td><td class="num">~17%</td><td class="num">~31%</td></tr>
        <tr><td>Gutshot straight draw</td><td class="num">4</td><td class="num">~9%</td><td class="num">~17%</td></tr>
        <tr><td>Two overcards (to pair up)</td><td class="num">6</td><td class="num">~13%</td><td class="num">~24%</td></tr>
        <tr><td>Flush + straight draw</td><td class="num">15</td><td class="num">~32%</td><td class="num">~54%</td></tr></table>
      <p>${g('[[rule of 2 and 4|The rule of 2 and 4]]')}: multiply outs by <b>2</b> for the next card, or by <b>4</b> for both turn and river (only if you’ll see both, e.g. you or they are all-in).</p>
      <h3>Put together</h3>
      <p>You have a flush draw (≈19% to hit on the turn). Opponent bets half the pot → you need 25%. Strictly, that’s a fold — unless you expect to win extra chips when you hit (${g('[[implied odds]]')}). Against a third-pot bet you need 20%: a call.</p>
      <div class="callout">Common bet sizes → % you need to call: ¼ pot → 17% · ⅓ pot → 20% · ½ pot → 25% · ¾ pot → 30% · pot → 33% · 2× pot → 40%.</div>` },
    { id: 'post', title: '6. Playing after the flop', html: () => `
      <h2>After the flop</h2>
      <h3>1. How strong am I really?</h3>
      <ul><li><b>Monsters:</b> sets, two pair, straights, flushes. Bet for value; build the pot.</li>
      <li><b>Good:</b> ${g('[[top pair]]')} with a good kicker, ${g('[[overpair]]')}s. Usually bet; be careful if the betting gets big.</li>
      <li><b>Medium:</b> middle pair, weak top pair. Keep the pot small (${g('[[pot control]]')}); call small bets, fold to big pressure.</li>
      <li><b>Draws:</b> flush and straight draws — bet or call depending on price (${g('[[semi-bluff]]')}).</li>
      <li><b>Air:</b> nothing. Give up unless a bluff has a real chance.</li></ul>
      <h3>2. What does the board do?</h3>
      <p>A ${g('[[dry board]]')} (K♠ 7♦ 2♣) rarely helps anyone: your top pair is probably good. A ${g('[[wet board]]')} (9♥ 8♥ 6♠) gives lots of straights and flushes: bet your strong hands so draws pay to chase.</p>
      <h3>3. Why bet?</h3>
      <p>Only two good reasons: <b>value</b> (worse hands call) or <b>bluff</b> (better hands fold). If neither is likely, check. Betting a medium hand often makes worse hands fold and better hands call — the worst of both worlds.</p>
      <h3>4. The continuation bet</h3>
      <p>If you raised before the flop and one player called, a small bet (⅓–½ pot) on the flop often wins even when you missed — they miss most flops too. This is the ${g('[[c-bet]]')}. Do it less against several opponents or calling stations.</p>
      <h3>5. Big bets mean big hands</h3>
      <div class="callout">At low-stakes live tournaments, most players <b>under-bluff</b>. When a cautious player suddenly raises big on the turn or river, they usually have it. Folding one pair there is often correct.</div>` },
    { id: 'tourn', title: '7. Tournament strategy', html: () => `
      <h2>Tournament strategy</h2>
      <p>In a tournament you can’t buy more chips, the blinds keep rising, and when you’re out, you’re out. Measure everything in <b>big blinds (BB)</b>: 12,000 chips at 300/600 blinds = 20 BB.</p>
      <table class="grid"><tr><th>Stack</th><th>Mode</th><th>What to do</th></tr>
        <tr><td>50+ BB</td><td>Deep</td><td>Play solid, position-based poker. Don’t risk it all with one pair.</td></tr>
        <tr><td>25–50 BB</td><td>Normal</td><td>Open-raise, steal blinds from late seats, re-raise premiums.</td></tr>
        <tr><td>12–25 BB</td><td>Short</td><td>Fewer calls. Raise-or-fold. Re-shove all-in over late-position raises with good hands.</td></tr>
        <tr><td>&lt; 12 BB</td><td>Push/fold</td><td>${g('[[push/fold]]')}: either all-in or fold before the flop. Being first in is key — you win the blinds when they fold.</td></tr></table>
      <h3>Stages</h3>
      <ul><li><b>Early:</b> stacks are deep; blinds small. Play tight and avoid big early confrontations without a great hand.</li>
      <li><b>Middle:</b> antes arrive. Stealing blinds becomes important — with antes, there’s a lot of free money in the middle.</li>
      <li><b>The ${g('[[bubble]]')}:</b> one elimination before prizes. Medium stacks should tighten up; big stacks can pressure them. Short stacks must still shove when it’s right.</li>
      <li><b>In the money:</b> each elimination is a pay jump. Play to win — first place usually pays several times more than the min-cash.</li>
      <li><b>Final table / heads-up:</b> play much wider as the table gets short-handed; the blinds come around fast.</li></ul>
      <div class="callout">${g('[[ICM]]')} in one sentence: <b>busting costs more than doubling up gains</b>, so avoid coin-flips for your whole stack when you’re comfortable — but don’t blind away hoping for aces.</div>` },
    { id: 'opp', title: '8. Reading opponents', html: () => `
      <h2>The nine types of player</h2>
      <p>Every regular in this simulator plays one of these styles, the same types you’ll meet in a real card room. Knowing a player’s type tells you how to beat them.</p>
      <table class="grid"><tr><th>Type</th><th>How they play</th><th>How to beat them</th></tr>
        ${Object.values(FS.roster.STYLES).map((s) => `<tr><td><b>${s.label}</b></td><td>${U.esc(s.plain)}</td><td>${U.esc(s.exploit)}</td></tr>`).join('')}</table>
      <h3>Live tells worth knowing (and hiding)</h3>
      <ul><li>Players who look at their chips right after seeing the flop often liked it.</li>
      <li>Big, loud, theatrical bets are more often weak; quiet, still players are more often strong.</li>
      <li>A fast call usually means a medium hand or a draw; a long pause then a big raise is usually strong.</li>
      <li>Your own defense: take the same amount of time for every decision and stack your chips the same way.</li></ul>` },
    { id: 'live', title: '9. Your first live tournament', html: () => `
      <h2>Your first live tournament: how it actually works</h2>
      <h3>Before you sit down</h3>
      <ul><li>Register at the cage/desk; you get a <b>seat card</b> (table and seat number). Bring ID.</li>
      <li>Your starting chips are waiting at your seat. Count them and tell the dealer if something’s off.</li>
      <li>Learn the chip colors (ask the dealer!). Blinds go up on a clock — check the screen for level, blinds and time left.</li></ul>
      <h3>At the table: the rules that trip up beginners</h3>
      <ul>
        <li><b>Act in turn.</b> Wait until the action is on you. Acting early (even folding) is bad form and can be binding.</li>
        <li><b>Say it out loud.</b> Verbal declarations are binding: say “call”, “raise to 1,200”, “fold”, “check” clearly. Then put chips in.</li>
        <li><b>No string bets.</b> Put your raise out in <b>one motion</b>, or announce the amount first. Going back to your stack for more chips without announcing is a “string bet” — only the first amount counts.</li>
        <li><b>The single-chip rule.</b> Tossing in one oversized chip (e.g. a 5,000 chip facing a 1,000 bet) is only a <b>call</b> unless you say “raise” first.</li>
        <li><b>Check</b> by tapping the table. <b>Fold</b> by sliding your cards face-down to the dealer.</li>
        <li><b>Protect your cards.</b> Keep a hand or a chip on them — if the dealer mucks them by accident, your hand is dead.</li>
        <li><b>Keep your chips visible,</b> big denominations in front. Players can ask “how much do you have?” and you must show.</li>
        <li><b>Don’t talk about a hand in progress</b>, even if you folded. Don’t show your cards to a neighbor.</li>
        <li><b>At showdown, turn both cards face-up</b> (“cards speak”). Never throw away a hand you think lost until the dealer awards the pot. The last aggressor shows first.</li>
        <li>Ask the dealer anytime: “How much is it to me?” “What’s the pot?” (In no-limit they’ll count bets, not always the pot.) “Is that a raise?”</li>
      </ul>
      <h3>Etiquette</h3>
      <ul><li>Be quick when the decision is easy; it’s fine to take your time on big ones. Someone may “call the clock” if you take ages.</li>
      <li>No gloating, no berating anyone’s play. Say “nice hand” and move on.</li>
      <li>If you cash, it’s customary to tip the dealers (often a few percent of your cash) — ask what’s standard at your venue.</li></ul>
      <div class="callout">Nervous? Everyone was new once. Tell the dealer it’s your first live tournament — they’ll happily guide you.</div>` },
    { id: 'gloss', title: '10. Glossary', html: () => {
      const G = FS.coach.GLOSSARY;
      return `<h2>Glossary</h2><table class="grid">${Object.keys(G).sort((a, b) => a.localeCompare(b)).map((k) => `<tr><td style="white-space:nowrap"><b>${U.esc(k)}</b></td><td>${U.esc(G[k])}</td></tr>`).join('')}</table>`;
    } },
  ];

  let cur = 'hand';
  function render() {
    const body = $('#learn-body');
    const L = LESSONS.find((l) => l.id === cur) || LESSONS[0];
    body.innerHTML = `<nav class="learn-nav panel">${LESSONS.map((l) => `<button data-l="${l.id}" class="${l.id === cur ? 'sel' : ''}">${l.title}</button>`).join('')}</nav>
      <article class="lesson panel">${L.html()}
        <div style="display:flex;justify-content:space-between;margin-top:18px">${prevNext()}</div></article>`;
    $$('[data-l]', body).forEach((b) => (b.onclick = () => { cur = b.dataset.l; FS.audio.sfx.blip(); render(); $('#scr-learn').scrollTop = 0; }));
  }
  function prevNext() {
    const i = LESSONS.findIndex((l) => l.id === cur);
    return `<span>${i > 0 ? `<button class="btn small" data-l="${LESSONS[i - 1].id}">◀ ${LESSONS[i - 1].title}</button>` : ''}</span><span>${i < LESSONS.length - 1 ? `<button class="btn small gold" data-l="${LESSONS[i + 1].id}">${LESSONS[i + 1].title} ▶</button>` : ''}</span>`;
  }
  FS.ui.onScreen('learn', render);
  FS.learn = { LESSONS, render };
})(typeof window !== 'undefined' ? window : globalThis);
