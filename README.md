# Felt Sharpener

**An offline Texas Hold'em tournament trainer.** Play full multi-table tournaments against 48 recurring
opponents, with a coach that explains every spot in plain English and an optional AI coach you can
ask anything.

Everything runs locally in your browser. It has no install step, no build and no internet
requirement. All graphics (low-poly PS2-style portraits, table, chips) and all audio (a jazz-lounge
soundtrack, card and chip sounds, character voices) are generated in code.

---

## Quick start

**Option A: just play.** Double-click `index.html` (Chrome, Edge, Firefox or Safari).

**Option B: play with the AI coach harness (recommended if you use the AI coach).**

```sh
./start.sh            # macOS / Linux   (or: python3 server/harness.py)
start.bat             # Windows
```

This starts a tiny local server at <http://127.0.0.1:8765/> and opens the game. It needs Python 3
and nothing else.

Then: **Press Start → New Tournament → Shuffle Up & Deal.**

## What's inside

| | |
|---|---|
| **Real tournament** | 9 / 18 / 27 / 45 players, 20,000-chip stacks, rising blinds with big-blind antes, background tables, table balancing and breaking, bubble, final table, payouts. Save and resume at any time. |
| **Full no-limit rules** | Min-raises, short all-ins that don't reopen betting, uncalled bets, side pots, split pots. Everything is verified by 3,000 fuzzed test hands. |
| **48 regulars** | Named characters with bios, hometowns, catchphrases and 3D portraits. Each plays one of nine real-world styles (Rock, Nit, Solid Regular, Loose-Aggressive, Maniac, Calling Station, Recreational, Shark, Trapper). Their records against you persist between tournaments. |
| **3-level coach** | **Big Picture** (stage, stack size, seat), **Table Read** (what's happened, who you're up against, what they likely hold), **Hand Coach** (hand strength, outs, win %, pot odds, recommended action and why). Toggle each level on or off as you improve. |
| **Decision grading** | Every decision you make is graded (good / OK / mistake / big mistake) with an explanation. Review any hand afterwards. |
| **AI coach** | Ask anything at any time. It sees the live table, your cards, the action, opponent profiles, the simulator's numbers and your recent hands. |
| **Learn section** | Rules, hand rankings, position, starting hands, pot odds and outs, post-flop play, tournament strategy, player types, and a chapter on **how a live tournament actually works** (declarations, string bets, protecting your cards, etiquette). |
| **Glossary everywhere** | Every dotted word in the coach text shows a plain-English definition on hover or tap. |

**Keyboard:** `F` fold · `C` check/call · `R` bet/raise · `1`–`6` bet-size presets · `Space` next hand · `H` hide/show hints · `Esc` menu.

## Connecting the AI coach

Open **⚙ Settings → AI Coach** and fill in:

- **Endpoint URL:** any OpenAI-compatible `/v1` base URL, for example:
  - Ollama: `http://localhost:11434/v1`
  - LM Studio: `http://localhost:1234/v1`
  - llama.cpp server / vLLM: `http://localhost:8080/v1`
  - OpenAI: `https://api.openai.com/v1` · OpenRouter: `https://openrouter.ai/api/v1`
- **API key:** leave blank for local servers.
- **Model:** e.g. `llama3.1:8b`, `qwen2.5:14b`, `gpt-4o-mini`.

Click **Test connection**.

**How requests are routed**

- **Via the harness** (when you launched with `start.sh` / `harness.py`): the browser sends your
  question and the game state to `server/harness.py`. The harness wraps them in the coach prompt
  (`server/coach_prompt.md`, which begins *"You are a Texas Hold'em expert here to help the player
  understand…"*) and forwards the request to your endpoint. No CORS setup is needed.
- **Direct** (when you opened `index.html` as a file): the browser calls your endpoint itself with the
  same prompt. The endpoint must allow browser (CORS) requests. For Ollama, start it with
  `OLLAMA_ORIGINS=*`. For LM Studio, enable CORS in the server settings.

The harness can also take defaults from environment variables. They are used when the in-game fields
are blank:

```sh
FELT_LLM_ENDPOINT=http://localhost:11434/v1 FELT_LLM_MODEL=llama3.1:8b python3 server/harness.py
```

To change the coach's personality or instructions, edit `server/coach_prompt.md`, then run
`node tools/sync-prompt.js` so direct mode uses the same text.

Without an AI endpoint, the chat still answers from the built-in coach.

## Project layout

```
index.html              the app (open this)
css/main.css            PS2-era styling
js/core/                pure game logic (also runs under Node for tests)
  cards.js              deck, 7-card evaluator, Monte Carlo equity, outs
  preflop.js            169-hand strength ranking, ranges, push/fold charts
  engine.js             no-limit hand engine (blinds, antes, betting, side pots)
  strategy.js           shared "brain": range estimation + recommendations
  ai.js                 personality-driven opponents
  roster.js             the 48 characters and 9 playing styles
  tournament.js         multi-table tournament manager
js/game/                browser UI: table view, controller, coach text, audio, avatars, screens, lessons
server/harness.py       local server + AI-coach proxy (Python standard library only)
server/coach_prompt.md  the coach's system prompt
tests/                  unit, integration and browser end-to-end tests
tools/                  dev helpers (preflop table generator, prompt sync, bot simulator)
```

## Tests

```sh
npm test               # engine, evaluator, strategy, tournaments, coach, harness (Node 18+, Python 3)
npm run test:e2e       # browser end-to-end tests (needs Playwright + Chromium)
```

Your progress (settings, stats, opponent records, hand histories, any tournament in progress) is
stored in your browser's localStorage.
