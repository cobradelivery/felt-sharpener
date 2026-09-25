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
      try { root.localStorage && root.localStorage.setItem(KEY, JSON.stringify(data)); }
      catch (e) {
        // quota: trim hand history and retry once
        data.hands = data.hands.slice(-15);
        try { root.localStorage.setItem(KEY, JSON.stringify(data)); } catch (e2) { /* give up silently */ }
      }
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
  function reset() { data = JSON.parse(JSON.stringify(DEFAULTS)); save(true); }
  function resetStatsKeepSettings() { const s = get().settings; data = JSON.parse(JSON.stringify(DEFAULTS)); data.settings = s; save(true); }

  FS.store = { load, save, get, opp, addHand, reset, resetStatsKeepSettings, DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);
