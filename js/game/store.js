/* Persistence (localStorage): settings, the player's lifetime stats, durable opponent records,
   recent hand histories, and the in-progress tournament. */
(function (root) {
  'use strict';
  const FS = root.FS;
  const KEY = 'feltSharpener.v1';

  const DEFAULTS = {
    settings: {
      heroName: 'You',
      music: 0.45, sfx: 0.8, vox: 0.7, muted: false,
      speed: 'normal', autoAdvance: true, fourColor: false, confirmAllIn: true,
      hints: { big: true, table: true, hand: true, rec: true, feedback: true },
      llm: { endpoint: '', apiKey: '', model: '', temperature: 0.2, mode: 'auto' },
      lastSetup: { field: 27, speed: 'standard', difficulty: 'casino' },
    },
    hero: { tournaments: 0, cashes: 0, wins: 0, bestFinish: null, totalPrize: 0, totalBuyIns: 0, hands: 0, vpip: 0, pfr: 0,
      grades: { good: 0, ok: 0, mistake: 0, blunder: 0 }, history: [] },
    drills: {
      prefs: { type: 'mixed', length: 10, timer: 0 },
      sessions: 0,
      potodds: { attempts: 0, correct: 0, streak: 0, bestStreak: 0, timeMs: 0, last: [] },
      outs: { attempts: 0, correct: 0, streak: 0, bestStreak: 0, timeMs: 0, last: [] },
      callfold: { attempts: 0, correct: 0, streak: 0, bestStreak: 0, timeMs: 0, last: [] },
      betsize: { attempts: 0, correct: 0, streak: 0, bestStreak: 0, timeMs: 0, last: [] },
      equity: { attempts: 0, correct: 0, streak: 0, bestStreak: 0, timeMs: 0, last: [] },
    },
    opponents: {},
    hands: [],
    tourney: null,
    tourneyMeta: null,
  };

  let data = null;
  function load() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(KEY);
      data = raw ? JSON.parse(raw) : {};
    } catch (e) { data = {}; }
    data = merge(JSON.parse(JSON.stringify(DEFAULTS)), data);
    return data;
  }
  function merge(def, v) {
    if (v == null || typeof v !== 'object' || Array.isArray(v)) return v == null ? def : v;
    const out = Array.isArray(def) ? [] : Object.assign({}, def);
    for (const k of Object.keys(v)) out[k] = (def && typeof def[k] === 'object' && def[k] && !Array.isArray(def[k])) ? merge(def[k], v[k]) : v[k];
    return out;
  }
  let saveTimer = null;
  function save(now) {
    if (!data) return;
    const write = () => {
      if (!root.localStorage) return;
      const json = JSON.stringify(data);
      // The storage quota is shared with the tournament archive: when full, free archive space
      // (oldest tournaments' hand histories first), then the recent-hands list, then warn.
      for (let attempt = 0; attempt < 60; attempt++) {
        try { root.localStorage.setItem(KEY, attempt < 50 ? json : JSON.stringify(data)); return; } catch (e) {
          if (attempt < 50 && FS.archive && FS.archive.freeSpace()) continue;
          if (data.hands.length > 15) { data.hands = data.hands.slice(-15); attempt = 50; continue; }
          break;
        }
      }
      if (FS.ui && FS.ui.toast) FS.ui.toast('Storage is full — progress could not be saved. Export saved tournaments, then delete some.', 'red', 6000);
    };
    clearTimeout(saveTimer);
    if (now) write(); else saveTimer = setTimeout(write, 150);
  }
  function get() { return data || load(); }
  function opp(id) {
    const d = get();
    return d.opponents[id] || (d.opponents[id] = { tourneys: 0, wins: 0, cashes: 0, bestFinish: null, handsVsHero: 0, heroNet: 0, obs: { hands: 0, vpip: 0, pfr: 0 }, knockedOutHero: 0, heroKnockedOut: 0 });
  }
  function addHand(rec) {
    const d = get();
    d.hands.push(rec);
    if (d.hands.length > 60) d.hands = d.hands.slice(-60);
  }
  function reset() { data = JSON.parse(JSON.stringify(DEFAULTS)); if (FS.archive) FS.archive.clearAll(); save(true); }
  function resetStatsKeepSettings() { const s = get().settings; data = JSON.parse(JSON.stringify(DEFAULTS)); data.settings = s; save(true); }

  FS.store = { load, save, get, opp, addHand, reset, resetStatsKeepSettings, DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);
