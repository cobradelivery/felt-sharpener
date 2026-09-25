/* Multi-table tournament: blind structure, seating, table balancing/breaking, background tables,
   eliminations, payouts. Fully JSON-serializable so a tournament can be saved and resumed. */
(function (root) {
  'use strict';
  const FS = root.FS;
  const U = FS.util;

  const LEVELS = [
    [100, 200, 0], [100, 200, 200], [150, 300, 300], [200, 400, 400], [300, 600, 600], [400, 800, 800],
    [500, 1000, 1000], [600, 1200, 1200], [800, 1600, 1600], [1000, 2000, 2000], [1200, 2400, 2400],
    [1500, 3000, 3000], [2000, 4000, 4000], [2500, 5000, 5000], [3000, 6000, 6000], [4000, 8000, 8000],
    [5000, 10000, 10000], [6000, 12000, 12000], [8000, 16000, 16000], [10000, 20000, 20000],
    [15000, 30000, 30000], [20000, 40000, 40000], [30000, 60000, 60000], [50000, 100000, 100000],
  ].map(([sb, bb, ante]) => ({ sb, bb, ante }));

  const PAYOUTS = {
    2: [65, 35],
    3: [50, 30, 20],
    4: [40, 27, 19, 14],
    5: [37, 24, 17, 12, 10],
    6: [34, 22, 15, 11, 10, 8],
    7: [32, 20, 14, 11, 9, 7.5, 6.5],
  };
  const SPEEDS = { turbo: { label: 'Turbo', hands: 6 }, standard: { label: 'Standard', hands: 10 }, deep: { label: 'Deep Stack', hands: 15 } };
  const DIFFICULTY = {
    friendly: { label: 'Friendly Home Game', weights: { fish: 5, station: 5, rock: 2, nit: 2, trapper: 1, tag: 1, lag: 1, maniac: 1, shark: 0.3 } },
    casino:   { label: 'Local Casino',       weights: { fish: 2, station: 2, rock: 2, nit: 2, trapper: 2, tag: 2, lag: 2, maniac: 1, shark: 1 } },
    sharks:   { label: 'Shark Tank',         weights: { fish: 0.5, station: 0.5, rock: 1, nit: 1, trapper: 2, tag: 4, lag: 3, maniac: 1, shark: 4 } },
  };
  const TABLE_SIZE = 9;

  function paidPlaces(field) { return Math.min(7, Math.max(2, Math.round(field * 0.15))); }
  function payoutTable(field, buyIn) {
    const paid = field <= 6 ? 2 : Math.max(3, paidPlaces(field));
    const pool = field * buyIn;
    return PAYOUTS[paid].map((p) => Math.round((pool * p) / 100));
  }

  function create(opts) {
    const field = opts.field || 27;
    const seed = opts.seed || (Date.now() >>> 0);
    const rng = U.makeRng(seed);
    const diff = DIFFICULTY[opts.difficulty || 'casino'];
    // choose opponents weighted by style
    const pool = FS.roster.roster.slice();
    const chosen = [];
    while (chosen.length < field - 1 && pool.length) {
      const total = pool.reduce((a, p) => a + (diff.weights[p.style] || 1), 0);
      let r = rng() * total, i = 0;
      for (; i < pool.length; i++) { r -= diff.weights[pool[i].style] || 1; if (r <= 0) break; }
      chosen.push(pool.splice(Math.min(i, pool.length - 1), 1)[0]);
    }
    const startStack = opts.startStack || 20000;
    const players = [{ id: 'hero', name: opts.heroName || 'You', style: 'hero', stack: startStack, busted: false, finish: null, tilt: 0, isHero: true }]
      .concat(chosen.map((c) => ({ id: c.id, name: c.name, style: c.style, stack: startStack, busted: false, finish: null, tilt: 0 })));
    const nTables = Math.ceil(field / TABLE_SIZE);
    const tables = [];
    for (let t = 0; t < nTables; t++) tables.push({ id: t + 1, seats: new Array(TABLE_SIZE).fill(null), button: rng.int(TABLE_SIZE), hands: 0 });
    // Deal players round-robin to tables so they're balanced, random seats
    const order = U.shuffleInPlace(players.map((p) => p.id), rng);
    order.forEach((id, i) => {
      const t = tables[i % nTables];
      const empty = t.seats.map((s, k) => (s ? -1 : k)).filter((k) => k >= 0);
      t.seats[empty[rng.int(empty.length)]] = id;
    });
    const heroTable = tables.find((t) => t.seats.includes('hero'));
    const T = {
      version: 1, seed, field, buyIn: opts.buyIn || 100, startStack, speed: opts.speed || 'standard',
      difficulty: opts.difficulty || 'casino', name: opts.name || 'Felt Sharpener Classic',
      handsPerLevel: SPEEDS[opts.speed || 'standard'].hands,
      players, tables, heroTableId: heroTable.id, level: 0, handsThisLevel: 0, heroHands: 0, round: 0,
      payouts: payoutTable(field, opts.buyIn || 100), finishedOrder: [], log: [], over: false, startedAt: Date.now(),
    };
    return T;
  }

  const api = {};
  api.player = (T, id) => T.players.find((p) => p.id === id);
  api.alive = (T) => T.players.filter((p) => !p.busted);
  api.table = (T, id) => T.tables.find((t) => t.id === id);
  api.heroTable = (T) => api.table(T, T.heroTableId);
  api.blinds = (T) => LEVELS[Math.min(T.level, LEVELS.length - 1)];
  api.nextBlinds = (T) => LEVELS[Math.min(T.level + 1, LEVELS.length - 1)];
  api.handsToNextLevel = (T) => T.handsPerLevel - T.handsThisLevel;
  api.paidPlaces = (T) => T.payouts.length;
  api.prizeFor = (T, place) => T.payouts[place - 1] || 0;
  api.onBubble = (T) => api.alive(T).length === T.payouts.length + 1;
  api.inTheMoney = (T) => api.alive(T).length <= T.payouts.length;
  api.standings = (T) => api.alive(T).slice().sort((a, b) => b.stack - a.stack);
  api.heroRank = (T) => api.standings(T).findIndex((p) => p.id === 'hero') + 1;
  api.avgStack = (T) => { const a = api.alive(T); return a.reduce((s, p) => s + p.stack, 0) / Math.max(1, a.length); };
  api.hero = (T) => api.player(T, 'hero');
  api.isFinalTable = (T) => T.tables.length === 1;

  function nextButton(table) {
    for (let k = 1; k <= TABLE_SIZE; k++) {
      const s = (table.button + k) % TABLE_SIZE;
      if (table.seats[s]) return s;
    }
    return table.button;
  }

  /** Build an engine Hand for a table. Advances the button. */
  api.makeHand = function (T, table) {
    table.button = nextButton(table);
    const lv = api.blinds(T);
    const seats = table.seats.map((id) => {
      if (!id) return null;
      const p = api.player(T, id);
      return { id: p.id, name: p.name, stack: p.stack };
    });
    table.hands++;
    const rng = U.makeRng((T.seed ^ U.hashString(table.id + ':' + table.hands + ':' + T.round)) >>> 0);
    return new FS.engine.Hand({ seats, button: table.button, sb: lv.sb, bb: lv.bb, ante: lv.ante, rng, handNo: table.hands });
  };

  /** Apply a finished hand's stacks back to the tournament; returns busted player ids. */
  api.applyHand = function (T, table, hand) {
    const busted = [];
    const bustList = [];
    for (const hp of hand.players) {
      if (!hp) continue;
      const p = api.player(T, hp.id);
      const before = p.stack;
      p.stack = hp.stack;
      if (p.tilt > 0) p.tilt--;
      if (!p.isHero && p.stack > 0 && before - p.stack > before * 0.4) p.tilt = 5;
      if (p.stack <= 0) bustList.push({ p, before: hp.startStack });
    }
    // Players busting in the same hand: bigger starting stack finishes higher
    bustList.sort((a, b) => a.before - b.before);
    for (const { p } of bustList) {
      p.busted = true; p.stack = 0;
      p.finish = api.alive(T).length + 1;
      p.prize = api.prizeFor(T, p.finish);
      T.finishedOrder.push(p.id);
      const seat = table.seats.indexOf(p.id);
      if (seat >= 0) table.seats[seat] = null;
      busted.push(p.id);
      T.log.push({ type: 'bust', id: p.id, place: p.finish, table: table.id, level: T.level });
    }
    checkWinner(T);
    return busted;
  };

  function checkWinner(T) {
    const alive = api.alive(T);
    if (alive.length === 1 && !T.over) {
      alive[0].finish = 1; alive[0].prize = api.prizeFor(T, 1);
      T.over = true;
      T.log.push({ type: 'win', id: alive[0].id });
    }
  }

  /** Play one full hand on a background table with fast AI. */
  api.simulateTableHand = function (T, table) {
    const ids = table.seats.filter(Boolean);
    if (ids.length < 2) return [];
    const hand = api.makeHand(T, table).start();
    const rng = hand.rng;
    let guard = 0;
    while (!hand.done && guard++ < 400) {
      const seat = hand.actor;
      const pl = api.player(T, hand.players[seat].id);
      const d = FS.ai.decide(hand, seat, pl, { fast: true, rng, readLookup: (id) => readFor(T, id) });
      hand.act(seat, d.action);
    }
    return api.applyHand(T, table, hand);
  };

  function readFor(T, id) {
    const p = api.player(T, id);
    if (!p || p.isHero) return null; // bots treat the hero as an unknown
    return FS.roster.STYLES[p.style] || null;
  }
  api.readFor = readFor;

  /** After the hero's table hand: progress the other tables, levels, balancing. Returns events. */
  api.afterRound = function (T) {
    const events = [];
    T.round++;
    for (const t of T.tables) {
      if (t.id === T.heroTableId && !api.hero(T).busted) continue;
      if (T.over) break;
      const b = api.simulateTableHand(T, t);
      b.forEach((id) => events.push({ type: 'bust', id, table: t.id }));
    }
    T.handsThisLevel++;
    if (T.handsThisLevel >= T.handsPerLevel && T.level < LEVELS.length - 1) {
      T.level++; T.handsThisLevel = 0;
      events.push({ type: 'level', level: T.level, blinds: api.blinds(T) });
    }
    events.push(...api.balance(T));
    return events;
  };

  /** Break tables / move players so table sizes differ by at most one. Hero's table is never broken. */
  api.balance = function (T) {
    const events = [];
    const rng = U.makeRng((T.seed + T.round * 31) >>> 0);
    const heroAlive = !api.hero(T).busted;
    const count = (t) => t.seats.filter(Boolean).length;
    const emptySeats = (t) => t.seats.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
    const seatPlayer = (id, to, from) => {
      const e = emptySeats(to);
      const seat = e[rng.int(e.length)];
      to.seats[seat] = id;
      events.push({ type: 'move', id, from: from.id, to: to.id, seat });
    };
    // Break tables when the field fits in fewer tables
    let alive = api.alive(T).length;
    while (T.tables.length > 1 && Math.ceil(alive / TABLE_SIZE) < T.tables.length) {
      const candidates = T.tables.filter((t) => !(heroAlive && t.id === T.heroTableId));
      candidates.sort((a, b) => count(a) - count(b));
      const brk = candidates[0];
      T.tables = T.tables.filter((t) => t !== brk);
      events.push({ type: 'break', table: brk.id });
      for (const id of brk.seats.filter(Boolean)) {
        const to = T.tables.slice().sort((a, b) => count(a) - count(b))[0];
        seatPlayer(id, to, brk);
      }
      if (!heroAlive && !T.tables.find((t) => t.id === T.heroTableId)) T.heroTableId = T.tables[0].id;
    }
    // Even out
    let guard = 0;
    while (T.tables.length > 1 && guard++ < 50) {
      const sorted = T.tables.slice().sort((a, b) => count(b) - count(a));
      const big = sorted[0], small = sorted[sorted.length - 1];
      if (count(big) - count(small) <= 1) break;
      const movable = big.seats.filter((id) => id && id !== 'hero');
      const id = movable[rng.int(movable.length)];
      big.seats[big.seats.indexOf(id)] = null;
      seatPlayer(id, small, big);
    }
    if (T.tables.length === 1 && !T.finalTableAnnounced) { T.finalTableAnnounced = true; events.push({ type: 'final-table' }); }
    return events;
  };

  /** Hero is out: play the rest of the tournament out quickly. */
  api.simulateToEnd = function (T, maxRounds) {
    let n = 0;
    while (!T.over && n++ < (maxRounds || 5000)) api.afterRound(T);
    return T;
  };

  FS.tournament = Object.assign(api, { LEVELS, PAYOUTS, SPEEDS, DIFFICULTY, TABLE_SIZE, create, payoutTable });
})(typeof window !== 'undefined' ? window : globalThis);
