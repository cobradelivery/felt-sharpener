/* AI opponents: personality-driven decisions on top of the shared strategy brain. */
(function (root) {
  'use strict';
  const FS = root.FS;
  const U = FS.util;

  /** How a style "reads" other players (reads come from their real style for bots, or the hero's observed stats). */
  function readsFor(hand, seat, lookup) {
    const reads = {};
    for (const p of hand.inHand) {
      if (p.seat === seat) continue;
      reads[p.seat] = lookup ? lookup(p.id) : null;
    }
    return reads;
  }

  /**
   * decide(hand, seat, player, opts) -> { action:{type,to}, analysis, thinkMs }
   * player: { style, tilt } ; opts: { fast, rng, readLookup }
   */
  function decide(hand, seat, player, opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const base = FS.roster.STYLES[player.style] || FS.roster.STYLES.tag;
    const style = Object.assign({ name: player.style }, base);
    if (player.tilt > 0) {
      style.looseness *= 1.35; style.aggression = Math.min(1, style.aggression + 0.2); style.bluff += 0.15; style.foldToPressure *= 0.7;
    }
    const A = FS.strategy.analyze(hand, seat, {
      style, rng, iterations: opts.fast ? 90 : 450,
      reads: readsFor(hand, seat, opts.readLookup),
    });
    let rec = A.rec || { type: 'check' };
    const L = A.legal;
    // Bet sizing personality noise
    if (rec.type === 'raise' && !rec.allIn) {
      const jitter = 1 + (rng() - 0.5) * 0.25;
      rec = Object.assign({}, rec, { to: U.clamp(Math.round(rec.to * jitter), L.minRaiseTo, L.maxRaiseTo) });
      rec.to = FS.strategy.roundBet(rec.to, hand.bbAmt);
      rec.to = U.clamp(rec.to, L.minRaiseTo, L.maxRaiseTo);
    }
    // Think time: longer for big decisions
    let think = 500 + rng() * 900;
    if (L.toCall > (hand.players[seat].stack + hand.players[seat].bet) * 0.3) think += 900 + rng() * 1400;
    if (rec.type === 'raise' && rec.allIn) think += 600;
    if (hand.street === 'river') think += 300;
    return { action: { type: rec.type, to: rec.to }, analysis: A, thinkMs: think };
  }

  FS.ai = { decide };
})(typeof window !== 'undefined' ? window : globalThis);
