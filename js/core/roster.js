/* The cast: 48 recurring opponents. Each has a playing style (which drives the AI),
   a look (drives the low-poly avatar renderer) and a voice (drives the babble synth).
   Their records against you persist in localStorage (see js/game/store.js). */
(function (root) {
  'use strict';
  const FS = root.FS;

  const STYLES = {
    rock:    { label: 'Rock',           looseness: 0.6,  aggression: 0.35, bluff: 0.05, station: 0,    trap: 0.12, foldToPressure: 0.75, sizing: 0.6,  noise: 0.15,
               plain: 'Plays very few hands. When a Rock bets big, believe them.', exploit: 'Steal their blinds often; fold when they suddenly get aggressive.' },
    nit:     { label: 'Nit',            looseness: 0.7,  aggression: 0.5,  bluff: 0.08, station: 0,    trap: 0.05, foldToPressure: 0.7,  sizing: 0.55, noise: 0.15,
               plain: 'Tight and scared of losing chips. Folds a lot under pressure.', exploit: 'Bet at pots they check; respect their raises.' },
    tag:     { label: 'Solid Regular',  looseness: 1.0,  aggression: 0.7,  bluff: 0.22, station: 0,    trap: 0.1,  foldToPressure: 0.5,  sizing: 0.66, noise: 0.2,
               plain: 'Plays good hands and bets them hard — the textbook style.', exploit: 'No easy leak. Avoid big pots without a strong hand.' },
    lag:     { label: 'Loose-Aggressive', looseness: 1.45, aggression: 0.85, bluff: 0.42, station: 0,  trap: 0.1,  foldToPressure: 0.35, sizing: 0.75, noise: 0.25,
               plain: 'Plays lots of hands and bets constantly. Often bluffing.', exploit: 'Call them down lighter; let them bet into your good hands.' },
    maniac:  { label: 'Maniac',         looseness: 2.2,  aggression: 0.95, bluff: 0.65, station: 0.05, trap: 0,    foldToPressure: 0.2,  sizing: 0.9,  noise: 0.35,
               plain: 'Raises almost everything. Wild and unpredictable.', exploit: 'Wait for a good hand, then let them do the betting for you.' },
    station: { label: 'Calling Station', looseness: 1.6, aggression: 0.2,  bluff: 0.04, station: 0.7,  trap: 0,    foldToPressure: 0.15, sizing: 0.5,  noise: 0.2,
               plain: 'Calls with anything and hates folding. Rarely raises.', exploit: 'Never bluff them. Bet your good hands big — they will pay you.' },
    fish:    { label: 'Recreational',   looseness: 1.8,  aggression: 0.3,  bluff: 0.15, station: 0.45, trap: 0.05, foldToPressure: 0.4,  sizing: 0.5,  noise: 0.4,
               plain: 'Here for fun. Plays too many hands and chases draws.', exploit: 'Value-bet relentlessly; skip the fancy bluffs.' },
    shark:   { label: 'Shark',          looseness: 1.15, aggression: 0.75, bluff: 0.33, station: 0,    trap: 0.15, foldToPressure: 0.45, sizing: 0.7,  noise: 0.15,
               plain: 'A strong, balanced pro. Hard to read.', exploit: 'Play straightforward and pick easier targets.' },
    trapper: { label: 'Trapper',        looseness: 0.9,  aggression: 0.45, bluff: 0.12, station: 0.1,  trap: 0.45, foldToPressure: 0.5,  sizing: 0.6,  noise: 0.2,
               plain: 'Loves to slow-play monsters. A sudden raise means danger.', exploit: 'Be careful when they check-raise or wake up late in a hand.' },
  };

  // id, name, nickname, hometown, style, voice [pitchHz, timbre], look, bio, catchphrase
  // look: [skin, hair, hairColor, hat, glasses, beard, shirt, top, headW, jaw]
  const S = { pale: '#f1c9a5', light: '#e0ac86', tan: '#c68a5e', olive: '#b98355', brown: '#8d5a3a', deep: '#5e3a24', rosy: '#f0b8a0' };
  const RAW = [
    ['dutch', 'Dutch Kowalski', 'The Ironside', 'Scranton, PA', 'rock', [95, 'm'], [S.light, 'buzz', '#8a8a8a', 'cap', null, 'mustache', '#2d4a7a', 'jacket', 1.08, 1.15], 'Retired steelworker. Has folded 40 hands in a row and been happy about it.', 'I can wait all day.'],
    ['lulu', 'Lulu Vance', 'Lucky Lulu', 'Reno, NV', 'fish', [230, 'f'], [S.pale, 'curly', '#e05a8a', null, 'round', null, '#f28bc0', 'tee', 0.95, 0.85], 'Wins bingo twice a week. Thinks every suited hand is a winner.', 'Ooh, pretty cards!'],
    ['viktor', 'Viktor Balan', 'The Accountant', 'Bucharest', 'nit', [110, 'm'], [S.pale, 'slick', '#222222', null, 'square', null, '#3b3b44', 'suit', 0.98, 1.0], 'Counts his chips after every hand. Twice.', 'The numbers do not lie.'],
    ['marisol', 'Marisol Reyes', 'La Tiburona', 'San Antonio, TX', 'shark', [200, 'f'], [S.olive, 'long', '#1a1110', null, 'shades', null, '#7a1f2b', 'jacket', 0.96, 0.9], 'Pays her mortgage with tournament cashes.', 'Your move, cariño.'],
    ['boone', 'Boone Tackett', 'Tex', 'Amarillo, TX', 'lag', [100, 'm'], [S.tan, 'short', '#6b4423', 'cowboy', null, 'stubble', '#c0772f', 'jacket', 1.1, 1.1], 'Bets like the chips are on fire.', 'Yeehaw, let\'s gamble!'],
    ['mei', 'Mei Tanaka', 'Quiet Storm', 'Seattle, WA', 'tag', [215, 'f'], [S.light, 'bob', '#141414', null, null, null, '#2f7a6b', 'hoodie', 0.94, 0.88], 'Software engineer. Treats poker like a debugging session.', 'Interesting.'],
    ['sal', 'Sal Moretti', 'Big Sal', 'Providence, RI', 'station', [90, 'm'], [S.light, 'bald', '#333', null, null, 'full', '#ffffff', 'tee', 1.18, 1.2], 'Owns a pizzeria. Will call your river bet out of curiosity.', 'I gotta see it.'],
    ['priya', 'Priya Natarajan', 'The Professor', 'Chicago, IL', 'shark', [205, 'f'], [S.brown, 'bun', '#1b1010', null, 'round', null, '#3e2f6b', 'suit', 0.95, 0.9], 'Stats professor who plays on weekends and wins on weekends.', 'Probably.'],
    ['rocco', 'Rocco Dimarco', 'The Bull', 'Newark, NJ', 'maniac', [105, 'm'], [S.tan, 'spiky', '#2a1a10', null, 'shades', 'goatee', '#d22f2f', 'tee', 1.12, 1.15], 'Has never limped in his life. Barely checks.', 'All in! ...no? Fine, raise.'],
    ['gert', 'Gertrude Olsen', 'Granny G', 'Duluth, MN', 'trapper', [240, 'f'], [S.rosy, 'bun', '#dddddd', null, 'round', null, '#8a6fb0', 'cardigan', 0.97, 0.85], 'Knits between hands. Check-raises you with a smile.', 'Oh dear, I raise.'],
    ['jamal', 'Jamal Brooks', 'J-Smooth', 'Atlanta, GA', 'lag', [120, 'm'], [S.deep, 'fade', '#111111', null, null, 'goatee', '#e0b020', 'jacket', 1.0, 1.05], 'Former college point guard. Plays fast, talks faster.', 'Too easy.'],
    ['hank', 'Hank Pruitt', 'Hank the Tank', 'Tulsa, OK', 'rock', [88, 'm'], [S.rosy, 'short', '#b0b0b0', 'cap', null, 'full', '#5a6b2a', 'flannel', 1.15, 1.2], 'Plays one hand an hour. That hand is usually aces.', 'Yep.'],
    ['sofia', 'Sofia Petrakis', 'The Oracle', 'Astoria, NY', 'tag', [210, 'f'], [S.olive, 'wavy', '#3b2314', null, null, null, '#1f5f8b', 'blouse', 0.95, 0.88], 'Claims she can read souls. Mostly reads bet sizes.', 'I saw that coming.'],
    ['chet', 'Chet Walker III', 'Trust Fund', 'Greenwich, CT', 'maniac', [125, 'm'], [S.pale, 'slick', '#d9b25b', null, 'shades', null, '#f2e6c8', 'polo', 1.0, 1.0], 'Rebuys are just a lifestyle.', 'Daddy\'s money, baby!'],
    ['ada', 'Ada Okafor', 'The Engineer', 'Houston, TX', 'shark', [195, 'f'], [S.deep, 'afro', '#1a1a1a', null, 'square', null, '#e06a2a', 'blouse', 0.97, 0.9], 'Builds bridges by day and traps by night.', 'Calculated.'],
    ['pete', 'Pete Duffy', 'Pistol Pete', 'Boston, MA', 'fish', [115, 'm'], [S.rosy, 'curly', '#c4582a', 'cap', null, 'stubble', '#1d6e3a', 'tee', 1.05, 1.0], 'Here for the free drinks and the bad beat stories.', 'Any two can win!'],
    ['yuki', 'Yuki Mori', 'Ice Queen', 'Osaka', 'nit', [225, 'f'], [S.light, 'long', '#0f0f0f', null, null, null, '#d8d8e8', 'blouse', 0.93, 0.86], 'Has not smiled at a poker table since 2019.', '...'],
    ['bruno', 'Bruno Castellano', 'The Butcher', 'Philadelphia, PA', 'lag', [92, 'm'], [S.tan, 'buzz', '#222', null, null, 'full', '#8b1d1d', 'apron', 1.16, 1.2], 'Actually a butcher. Chops stacks too.', 'Fresh meat.'],
    ['nadia', 'Nadia Volkov', 'Siberia', 'Brighton Beach, NY', 'rock', [190, 'f'], [S.pale, 'ponytail', '#e8d8a8', null, null, null, '#224466', 'jacket', 0.95, 0.9], 'Cold, patient, lethal.', 'Is cold in here? No. Is me.'],
    ['lenny', 'Lenny "Two-Cents" Fisk', 'Two-Cents', 'Cleveland, OH', 'station', [130, 'm'], [S.light, 'combover', '#5b4a3a', null, 'square', 'mustache', '#b8a070', 'sweater', 1.02, 0.95], 'Gives unsolicited advice. Calls everything.', 'Lemme give you my two cents...'],
    ['kai', 'Kai Nakoa', 'Big Wave', 'Honolulu, HI', 'lag', [118, 'm'], [S.tan, 'long', '#1a120d', null, null, 'stubble', '#29a3a3', 'hawaiian', 1.05, 1.05], 'Surfs in the morning, bluffs in the evening.', 'Riding the wave, brah.'],
    ['beatrice', 'Beatrice Hale', 'Bea', 'Savannah, GA', 'trapper', [220, 'f'], [S.pale, 'wavy', '#a0522d', 'fedora', null, null, '#6b8e23', 'blouse', 0.96, 0.86], 'Sweet as tea, sneaky as a fox.', 'Well bless your heart.'],
    ['omar', 'Omar Haddad', 'The Sultan', 'Dearborn, MI', 'tag', [108, 'm'], [S.olive, 'short', '#1c1410', null, null, 'full', '#1f3b73', 'suit', 1.04, 1.05], 'Runs three restaurants and a very tight game.', 'Patience pays.'],
    ['trixie', 'Trixie LaRue', 'Showgirl', 'Las Vegas, NV', 'maniac', [245, 'f'], [S.rosy, 'bighair', '#ffcc33', null, 'shades', null, '#e02090', 'sequin', 0.96, 0.85], 'Retired showgirl. Every hand is a performance.', 'Showtime, darling!'],
    ['gus', 'Gus Papadakis', 'Uncle Gus', 'Tarpon Springs, FL', 'fish', [98, 'm'], [S.tan, 'bald', '#ccc', 'bucket', null, 'mustache', '#4aa0d8', 'hawaiian', 1.12, 1.1], 'Sponge diver. Plays every hand with a king in it.', 'Opa!'],
    ['ren', 'Ren Zhao', 'Zen', 'Vancouver, BC', 'shark', [112, 'm'], [S.light, 'short', '#101010', null, 'round', null, '#2b2b2b', 'turtleneck', 0.97, 0.95], 'Meditates at the break. Never tilts.', 'Breathe.'],
    ['dolores', 'Dolores "Dot" Finch', 'Dot', 'Omaha, NE', 'rock', [235, 'f'], [S.rosy, 'curly', '#e8e8e8', null, 'square', null, '#c05050', 'cardigan', 0.95, 0.85], 'Has played the same Tuesday game for 31 years.', 'Not this one, dear.'],
    ['ty', 'Ty Bellamy', 'The Kid', 'Phoenix, AZ', 'lag', [140, 'm'], [S.light, 'spiky', '#f0d060', 'cap', 'shades', null, '#101010', 'hoodie', 0.98, 0.95], 'Twenty-two, learned from streams, fears nothing.', 'GG EZ.'],
    ['ingrid', 'Ingrid Sørensen', 'The Viking', 'Minneapolis, MN', 'tag', [185, 'f'], [S.pale, 'braid', '#f0e0a0', null, null, null, '#4b6a8a', 'sweater', 1.0, 0.95], 'Hockey coach. Plays poker like a power play.', 'Skål.'],
    ['moose', 'Marcus "Moose" Delaney', 'Moose', 'Green Bay, WI', 'station', [85, 'm'], [S.rosy, 'short', '#6b4b2b', 'beanie', null, 'full', '#1e5a2e', 'flannel', 1.2, 1.25], 'Friendliest guy at the table. Never folds a pair.', 'Aw shucks, I call.'],
    ['celeste', 'Celeste Moreau', 'Madame', 'New Orleans, LA', 'trapper', [200, 'f'], [S.brown, 'bighair', '#2a1a12', 'fedora', null, null, '#5c2a6e', 'suit', 0.96, 0.88], 'Owns a jazz club. Plays slow, strikes fast.', 'Mm-hmm.'],
    ['dex', 'Dexter Pham', 'Dex', 'San Jose, CA', 'nit', [128, 'm'], [S.light, 'short', '#151515', null, 'square', null, '#4a7ab0', 'polo', 0.96, 0.95], 'Only plays premium hands and premium coffee.', 'Fold. Obviously.'],
    ['rosa', 'Rosa Delgado', 'Abuela', 'El Paso, TX', 'fish', [225, 'f'], [S.tan, 'bun', '#bbbbbb', null, 'round', null, '#e07a3a', 'cardigan', 0.98, 0.9], 'Brought tamales for the whole table.', '¡Ay, qué bonito!'],
    ['felix', 'Felix Grant', 'The Fox', 'London', 'shark', [118, 'm'], [S.pale, 'wavy', '#7a4a2a', null, null, 'stubble', '#6a1f2f', 'suit', 1.0, 1.0], 'Former bookmaker. Prices every pot.', 'Cheeky.'],
    ['junior', 'Junior Tuilagi', 'The Wall', 'Salt Lake City, UT', 'rock', [82, 'm'], [S.brown, 'buzz', '#101010', null, null, null, '#2050a0', 'tee', 1.2, 1.25], 'Former lineman. Folds like a mountain doesn\'t.', 'Nope.'],
    ['vera', 'Vera Lindqvist', 'Black Widow', 'Stockholm', 'trapper', [195, 'f'], [S.pale, 'bob', '#111111', null, null, null, '#111111', 'suit', 0.94, 0.86], 'Nobody knows what she does for a living.', 'Welcome to my web.'],
    ['ollie', 'Ollie Banks', 'Sunshine', 'San Diego, CA', 'fish', [135, 'm'], [S.tan, 'long', '#e0c070', null, 'shades', null, '#f0a030', 'tank', 1.0, 1.0], 'Plays poker the way he surfs: with good vibes.', 'Whoa, dude.'],
    ['charlene', 'Charlene Watts', 'Char', 'Memphis, TN', 'lag', [210, 'f'], [S.deep, 'bighair', '#1a1010', null, null, null, '#b02040', 'jacket', 0.98, 0.9], 'Blues singer. Raises with the rhythm.', 'Feel it!'],
    ['ahmed', 'Ahmed Karim', 'The Pharaoh', 'Jersey City, NJ', 'tag', [115, 'm'], [S.olive, 'short', '#1a1410', null, null, 'goatee', '#c0a040', 'polo', 1.02, 1.05], 'Cab driver who knows every route — and every out.', 'Traffic\'s heavy tonight.'],
    ['nell', 'Nell Brody', 'Nervous Nell', 'Portland, ME', 'nit', [250, 'f'], [S.pale, 'ponytail', '#b85a2a', null, 'round', null, '#90b0d0', 'sweater', 0.93, 0.85], 'First big tournament. Folds when a chip falls over.', 'Oh gosh, oh gosh.'],
    ['diesel', 'Dwayne "Diesel" Parks', 'Diesel', 'Bakersfield, CA', 'maniac', [88, 'm'], [S.light, 'mohawk', '#303030', null, 'shades', 'goatee', '#404040', 'vest', 1.15, 1.2], 'Long-haul trucker. Never touches the brakes.', 'Pedal to the metal!'],
    ['pearl', 'Pearl Nguyen', 'Pearl', 'Garden Grove, CA', 'shark', [215, 'f'], [S.light, 'long', '#201010', null, null, null, '#f0f0f0', 'blouse', 0.94, 0.86], 'Runs a nail salon and a spreadsheet of every opponent.', 'Noted.'],
    ['wendell', 'Wendell Crane', 'Professor Crane', 'Princeton, NJ', 'station', [125, 'm'], [S.rosy, 'combover', '#d0d0d0', null, 'round', 'full', '#6b4f2f', 'tweed', 1.0, 1.0], 'Philosophy professor. Calls to "gather data."', 'Fascinating... I call.'],
    ['kiki', 'Kiki Alvarez', 'Firecracker', 'Miami, FL', 'lag', [235, 'f'], [S.tan, 'ponytail', '#d04020', null, 'shades', null, '#f04a7a', 'tank', 0.95, 0.86], 'Bartender. Pours strong, bets stronger.', '¡Vamos!'],
    ['otis', 'Otis Freeman', 'Old Man River', 'St. Louis, MO', 'trapper', [80, 'm'], [S.deep, 'bald', '#ccc', 'fedora', null, 'mustache', '#3a3a5a', 'suit', 1.05, 1.05], 'Has seen every trick. Uses most of them.', 'Slow and easy.'],
    ['zara', 'Zara Khan', 'Checkmate', 'Toronto, ON', 'tag', [205, 'f'], [S.olive, 'wavy', '#1a0f0a', null, 'square', null, '#2a6a4a', 'jacket', 0.95, 0.88], 'Chess master. Always three moves ahead.', 'Check.'],
    ['buck', 'Buck Harlan', 'Buckshot', 'Cheyenne, WY', 'fish', [95, 'm'], [S.rosy, 'short', '#8a6a4a', 'cowboy', null, 'mustache', '#8a3a20', 'flannel', 1.1, 1.1], 'Rancher. Plays every ace like it\'s the nuts.', 'Giddy-up!'],
    ['lottie', 'Lottie Graham', 'Lady Luck', 'Atlantic City, NJ', 'station', [230, 'f'], [S.pale, 'curly', '#f0d080', null, null, null, '#40c0a0', 'sequin', 0.96, 0.86], 'Blows on her cards. Calls anything shiny.', 'Come on, lucky!'],
  ];

  const roster = RAW.map((r) => {
    const [id, name, nick, from, style, voice, look, bio, quip] = r;
    return {
      id, name, nick, from, style, bio, quip,
      voice: { pitch: voice[0], timbre: voice[1] },
      look: { skin: look[0], hair: look[1], hairColor: look[2], hat: look[3], glasses: look[4], beard: look[5], shirt: look[6], top: look[7], headW: look[8], jaw: look[9] },
    };
  });
  const byId = Object.fromEntries(roster.map((p) => [p.id, p]));

  const HERO = { id: 'hero', name: 'You', nick: 'You', style: 'hero', voice: { pitch: 140, timbre: 'm' },
    look: { skin: '#e0ac86', hair: 'short', hairColor: '#3a2a1a', hat: 'cap', glasses: null, beard: null, shirt: '#2a60c0', top: 'hoodie', headW: 1, jaw: 1 } };

  // Generic table talk by event, flavored by style
  const TALK = {
    winBig: { any: ['Ship it!', 'Come to papa.', 'Thank you very much.', 'That\'s how it\'s done.'], maniac: ['WOOO!', 'Who wants some more?'], nit: ['Finally.', 'As expected.'], fish: ['I can\'t believe that worked!', 'Yay!'] },
    loseBig: { any: ['Unbelievable.', 'Every time...', 'Nice hand.', 'Ugh.'], maniac: ['Rigged!', 'Run it back!'], rock: ['Hm.', 'Well.'], fish: ['Aww, I really liked that hand.'] },
    allIn: { any: ['I\'m all in.', 'Let\'s dance.', 'All of it.'], maniac: ['SHOVE!', 'Chips in the middle!'], nit: ['...I\'m all in. Sorry.'] },
    bust: { any: ['Good game, everyone.', 'That\'s poker.', 'See you next time.'], maniac: ['I\'ll be back!'], fish: ['That was so fun!'] },
    badBeat: { any: ['Are you KIDDING me?', 'The river hates me.', 'How do you call that?!'] },
  };
  function talk(event, player, rng) {
    const t = TALK[event]; if (!t) return '';
    const pool = (t[player.style] || []).concat(t.any);
    if (rng() < 0.18 && player.quip && event !== 'bust') return player.quip;
    return pool[Math.floor(rng() * pool.length)];
  }

  FS.roster = { STYLES, roster, byId, HERO, talk };
})(typeof window !== 'undefined' ? window : globalThis);
