/* Scorched — the arsenal, defensive items and the economy.
   Weapons are data: `kind` picks the behaviour in game.js, the rest are its parameters.
   Prices buy a bundle of `qty` (as in the original), and anything can be sold back at half price. */
(function (root) {
  'use strict';
  const SE = root.SE || (root.SE = {});

  // kind: blast | mirv | funky | roller | digger | dirt | leapfrog | napalm | tracer
  const WEAPONS = [
    { id: 'baby', name: 'Baby Missile', kind: 'blast', radius: 18, damage: 30, price: 0, qty: Infinity,
      desc: 'Small, free and unlimited.' },
    { id: 'missile', name: 'Missile', kind: 'blast', radius: 28, damage: 55, price: 1500, qty: 5,
      desc: 'A solid all-round warhead.' },
    { id: 'babynuke', name: 'Baby Nuke', kind: 'blast', radius: 48, damage: 75, price: 5000, qty: 3,
      desc: 'Big crater, heavy damage.' },
    { id: 'nuke', name: 'Nuke', kind: 'blast', radius: 85, damage: 100, price: 12000, qty: 1, shake: 14,
      desc: 'Flattens everything nearby. Mind your own tank.' },
    { id: 'mirv', name: 'MIRV', kind: 'mirv', radius: 26, damage: 45, warheads: 5, spread: 45, price: 10000, qty: 2,
      desc: 'Splits into 5 warheads at the top of its arc.' },
    { id: 'deathshead', name: "Death's Head", kind: 'mirv', radius: 40, damage: 65, warheads: 9, spread: 70, price: 20000, qty: 1,
      desc: 'Splits into 9 heavy warheads. Devastating.' },
    { id: 'funky', name: 'Funky Bomb', kind: 'funky', radius: 24, damage: 40, bomblets: 7, bombletRadius: 18, bombletDamage: 30,
      price: 7000, qty: 2, desc: 'Bursts and scatters bomblets all over.' },
    { id: 'leapfrog', name: 'Leapfrog', kind: 'leapfrog', radius: 22, damage: 40, bounces: 3, price: 6000, qty: 3,
      desc: 'Explodes, bounces forward and explodes again (3×).' },
    { id: 'roller', name: 'Roller', kind: 'roller', radius: 26, damage: 50, price: 3000, qty: 5,
      desc: 'Rolls downhill on landing until it hits something.' },
    { id: 'heavyroller', name: 'Heavy Roller', kind: 'roller', radius: 42, damage: 70, price: 5000, qty: 3,
      desc: 'A bigger roller for tanks hiding in valleys.' },
    { id: 'napalm', name: 'Napalm', kind: 'napalm', radius: 12, damage: 10, flames: 24, burn: 2.2, price: 8000, qty: 3,
      desc: 'Liquid fire that pours downhill and burns tanks.' },
    { id: 'babydigger', name: 'Baby Digger', kind: 'digger', radius: 5, damage: 0, dig: 0.6, price: 1000, qty: 5,
      desc: 'Bores a short tunnel. No damage.' },
    { id: 'digger', name: 'Digger', kind: 'digger', radius: 8, damage: 0, dig: 1.2, price: 2000, qty: 5,
      desc: 'Bores a long tunnel to undermine a tank.' },
    { id: 'sandhog', name: 'Sandhog', kind: 'digger', radius: 7, damage: 0, dig: 1.0, heads: 3, endRadius: 22, endDamage: 45,
      price: 8000, qty: 3, desc: 'Three tunnelling warheads that explode underground.' },
    { id: 'riot', name: 'Riot Bomb', kind: 'blast', radius: 40, damage: 0, price: 3000, qty: 5,
      desc: 'Clears dirt without hurting anyone. Dig yourself out.' },
    { id: 'dirtclod', name: 'Dirt Clod', kind: 'dirt', radius: 22, damage: 0, price: 1000, qty: 5,
      desc: 'Dumps a clod of dirt.' },
    { id: 'dirtball', name: 'Dirt Ball', kind: 'dirt', radius: 38, damage: 0, price: 2000, qty: 5,
      desc: 'Buries a tank so its shots explode in its face.' },
    { id: 'tonofdirt', name: 'Ton of Dirt', kind: 'dirt', radius: 62, damage: 0, price: 5000, qty: 2,
      desc: 'A mountain out of nowhere. Great for cover.' },
    { id: 'tracer', name: 'Tracer', kind: 'tracer', radius: 0, damage: 0, price: 500, qty: 10,
      desc: 'Harmless shot that shows the flight path.' },
  ];

  const ITEMS = [
    { id: 'parachute', name: 'Parachute', price: 3000, qty: 2, desc: 'Opens automatically when you fall. No fall damage.' },
    { id: 'shield', name: 'Shield', price: 8000, qty: 3, strength: 50, desc: 'Absorbs 50 damage. Use on your turn (free action).' },
    { id: 'heavyshield', name: 'Heavy Shield', price: 15000, qty: 2, strength: 110, desc: 'Absorbs 110 damage.' },
    { id: 'battery', name: 'Battery', price: 4000, qty: 5, heal: 15, desc: 'Repairs 15 health. Use on your turn (free action).' },
    { id: 'fuel', name: 'Fuel', price: 3000, qty: 100, desc: 'Lets you drive your tank. Uphill burns more.' },
  ];

  const byId = {};
  for (const w of WEAPONS) byId[w.id] = Object.assign(w, { type: 'weapon' });
  for (const it of ITEMS) byId[it.id] = Object.assign(it, { type: 'item' });

  // Money rules (per round).
  const ECONOMY = {
    perDamage: 50,        // $ per point of damage dealt to an opponent
    selfDamage: -50,      // $ per point of damage to yourself
    perKill: 4000,
    roundWin: 6000,
    survive: 2000,
    allowance: 3000,      // everyone gets this each round, so busted players can still shop
    interest: 0.05,       // on cash carried into the next round
    interestCap: 5000,
    sellBack: 0.5,
  };

  const SCORING = { perDamage: 0.1, perKill: 10, roundWin: 20 };

  SE.weapons = { WEAPONS, ITEMS, byId, ECONOMY, SCORING, get: (id) => byId[id] };
  if (typeof module !== 'undefined' && module.exports) module.exports = SE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
