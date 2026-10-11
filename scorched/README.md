# Scorched

**A modern browser remake of the classic DOS artillery game *Scorched Earth*.** Tanks on procedurally
generated, fully destructible ground take turns lobbing shells through gravity and wind. Between
rounds you spend your winnings at the arms dealer.

It needs no install, no build step and no internet. Open `scorched/index.html` in Chrome, Edge, Firefox
or Safari. All graphics and sound are generated in code.

## How to play

1. Set up 2–8 players. Each one is a **Human** (hot-seat on one device) or a CPU: **Moron**, **Shooter**,
   **Poolshark** or **Sniper**. Pick the number of rounds, starting cash, wind, side walls and terrain,
   then press **START WAR**.
2. On your turn, set the barrel **angle** and shot **power**, choose a weapon and **FIRE**.
3. The last tank standing wins the round. Everyone earns money (damage dealt, kills, surviving,
   winning, plus a base allowance and interest), then shops before the next round.
4. After the last round, the highest score wins. Points come from damage, kills and round wins.

| Control | Keyboard | Mouse / touch |
|---|---|---|
| Angle | `←` `→` (hold to speed up, `Shift` for fine) | ◀ ▶ buttons, or drag on the battlefield |
| Power | `↑` `↓` | − + buttons, or drag (distance from the tank) |
| Fire | `Space` / `Enter` | **FIRE** |
| Weapon | `Tab` / `Shift+Tab` | ‹ › |
| Shield / battery | `S` / `B` (free actions) | item buttons |
| Drive (needs fuel) | `A` `D` | ◀ ▶ beside the fuel can |
| Fast-forward CPU turns | hold `F` | |
| 3× speed once every human is out | `F` toggles | ⏩ button |
| Mute / menu | `M` / `Esc` | ☰ |

**Rules of the battlefield**

- Dirt falls. Blow a hole under a tank and it drops. Falls hurt unless you own a **parachute**.
- Damage never reduces your power, so a battered tank can always hit back.
- Explosions hurt your own tank too, and a destroyed tank explodes and can hurt its neighbours.
- Wind varies per round, and can shift every turn. Walls can be open, wrap around or bounce.
- Your previous shot's path stays on screen as a dotted line while you aim.

## Arsenal

| Weapon | What it does |
|---|---|
| Baby Missile | Free and unlimited. |
| Missile, Baby Nuke, Nuke | Ever bigger blasts. |
| MIRV, Death's Head | Split into 5 or 9 warheads at the top of the arc. |
| Funky Bomb | Bursts and scatters bomblets. |
| Leapfrog | Explodes and bounces forward, three times. |
| Roller, Heavy Roller | Roll downhill on landing until they hit a tank or a wall. |
| Napalm | Burning liquid that flows downhill and roasts tanks in valleys. |
| Baby Digger, Digger, Sandhog | Tunnel underground to undermine tanks. The Sandhog's heads explode. |
| Riot Bomb | Clears dirt without damage. Use it to dig yourself out. |
| Dirt Clod, Dirt Ball, Ton of Dirt | Add ground. Bury an enemy so their shots blow up in their face, or build cover. |
| Tracer | Harmless test shot. |

**Items:** Parachute (automatic), Shield and Heavy Shield (absorb 40 / 80 damage; a direct hit on the bubble counts in full), Battery (+15 health),
Fuel (lets you drive).

## CPU opponents

The CPU aims by simulating real shots through the game's own physics: it sweeps elevations and
bisects the power at each. Then it adds skill-based error. Weaker CPUs only partly allow for the wind,
and every CPU gets more accurate with repeated shots at the same target. Smarter CPUs shop sensibly,
raise shields, use batteries when hurt, avoid blowing themselves up, and dig out when buried.

## Code layout

```
index.html            the game (open this)
css/style.css
js/core/              pure simulation, no DOM. Also runs under Node for the tests
  util.js             seeded RNG and helpers
  terrain.js          procedural generation (5 styles), carving, filling, falling dirt
  weapons.js          weapon and item catalogue, prices, economy and scoring rules
  game.js             rounds, turns, fixed-step ballistics, weapon behaviours, damage, falling, money
  ai.js               CPU aiming, target/weapon choice, shopping
js/game/              browser layer
  render.js           canvas renderer (sky themes, terrain bitmap, tanks, effects), shop icons
  audio.js            Web Audio sound effects
  ui.js               setup, shop, results, HUD
  main.js             frame loop, input, screen flow, menu demo battle
tests/
  core.test.js        unit tests for the simulation
  e2e.js              browser test that drives the real UI and fires every weapon
```

The simulation is deterministic: a fixed 120 Hz step and a seeded RNG mean the same seed and the same
inputs always give the same game. The renderer only reads game state and listens to game events,
which keeps the planned 3D version contained. It needs a new renderer, plus a heightfield/voxel
version of `terrain.js` and a third axis in the ballistics. The rules, economy, weapons and AI
carry over.

## Tests

```sh
npm run scorched:test     # unit tests (Node 18+)
npm run scorched:e2e      # browser end-to-end test (needs Playwright + Chromium)
```
