/* Tournament archive: every finished tournament is saved (results, stats, full hand histories,
   coach notes and AI conversations), can be reopened, exported (Markdown report / JSON) and imported.
   Stored under its own localStorage key so a big archive can never break the main save. */
(function (root) {
  'use strict';
  const FS = root.FS;
  const U = FS.util;
  const { $, $$, h, modal, toast } = FS.ui;
  const KEY = 'feltSharpener.archive.v1';
  const MAX_TOURNEYS = 40;
  const fc = (n) => U.fmtChips(n);

  // ---------- storage ----------
  let list = null;
  function load() {
    if (list) return list;
    try { list = JSON.parse(root.localStorage.getItem(KEY) || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    migrateLastResult();
    return list;
  }
  function persist() {
    for (let attempt = 0; attempt < 30; attempt++) {
      try { root.localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) {
        // Out of space: drop full hand histories from the oldest record that still has them.
        const victim = list.slice().reverse().find((r) => r.meta && r.meta.history && r.meta.history.length);
        if (!victim) break;
        victim.meta.history = [];
        victim.historyTrimmed = true;
      }
    }
    toast('Could not save the tournament archive (storage full). Export your tournaments to keep them.', 'red', 5000);
    return false;
  }
  /** Older versions kept only the last result in the main save; bring it into the archive once. */
  function migrateLastResult() {
    const st = FS.store.get();
    if (!st.lastResult || st.lastResultId) return;
    try {
      const { T, meta } = JSON.parse(st.lastResult);
      const rec = makeRecord({ T, meta, chat: [], startedAt: meta.startedAt });
      if (!list.some((r) => r.id === rec.id)) list.push(rec);
      st.lastResultId = rec.id;
      persist(); FS.store.save(true);
    } catch (e) { /* ignore broken legacy data */ }
  }

  function makeRecord({ T, meta, chat, startedAt }) {
    const hero = T.players.find((p) => p.id === 'hero');
    return {
      version: 1, app: 'felt-sharpener',
      id: 't' + (startedAt || Date.now()),
      savedAt: Date.now(), startedAt: startedAt || null,
      name: T.name || 'Tournament', field: T.field, buyIn: T.buyIn, payouts: T.payouts,
      speed: T.speed || null, difficulty: T.difficulty || null,
      heroName: FS.store.get().settings.heroName || 'You',
      finish: hero ? hero.finish : null, prize: hero ? hero.prize || 0 : 0,
      players: T.players.map((p) => ({ id: p.id, name: p.name, finish: p.finish, prize: p.prize || 0, style: p.style })),
      meta, chat: chat || [], review: [], notes: '',
    };
  }
  function add(rec) {
    load();
    list = list.filter((r) => r.id !== rec.id);
    list.push(rec);
    while (list.length > MAX_TOURNEYS) list.shift();
    persist();
    return rec;
  }
  const all = () => load().slice().sort((a, b) => b.savedAt - a.savedAt);
  const get = (id) => load().find((r) => r.id === id) || null;
  function update(rec) { const i = load().findIndex((r) => r.id === rec.id); if (i >= 0) { list[i] = rec; persist(); } }
  function remove(id) { list = load().filter((r) => r.id !== id); persist(); }

  // ---------- export / import ----------
  function fileStamp(rec) {
    const d = new Date(rec.startedAt || rec.savedAt);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  }
  function toMarkdown(rec) {
    const m = rec.meta || {};
    const g = m.grades || {};
    const L = [];
    const when = new Date(rec.startedAt || rec.savedAt).toLocaleString();
    L.push(`# Felt Sharpener — ${rec.name}`, '');
    L.push(`- **Date:** ${when}`);
    L.push(`- **Field:** ${rec.field} players · ${rec.speed || ''} blinds · opponents: ${rec.difficulty || ''}`);
    L.push(`- **Result:** ${U.ordinal(rec.finish)} of ${rec.field}${rec.prize ? ' — won ' + U.fmtMoney(rec.prize) : ' — no cash'} (${(rec.payouts || []).length} paid)`);
    L.push(`- **Hands dealt:** ${m.hands || 0} · played ${m.hands ? Math.round(m.vpip / m.hands * 100) : 0}% · raised preflop ${m.hands ? Math.round(m.pfr / m.hands * 100) : 0}%`);
    L.push(`- **Decision grades:** ${g.good || 0} good · ${g.ok || 0} OK · ${g.mistake || 0} mistakes · ${g.blunder || 0} big mistakes`);
    if (m.biggestWin) L.push(`- **Biggest pot won:** +${fc(m.biggestWin)}`);
    if (rec.notes) L.push('', '## My notes', '', rec.notes);
    L.push('', '## Final standings', '', '| Place | Player | Style | Prize |', '|---|---|---|---|');
    for (const p of rec.players.slice().sort((a, b) => a.finish - b.finish)) {
      const st = FS.roster.STYLES[p.style];
      L.push(`| ${U.ordinal(p.finish)} | ${p.id === 'hero' ? rec.heroName + ' (you)' : p.name} | ${p.id === 'hero' ? '' : st ? st.label : p.style} | ${p.prize ? U.fmtMoney(p.prize) : ''} |`);
    }
    if ((m.mistakes || []).length) {
      L.push('', '## Coach’s notes: flagged mistakes', '');
      for (const x of m.mistakes) L.push(`- **Hand #${x.hand}** (${x.cards}, ${x.street}) — you ${x.took}, coach suggested ${x.rec}. ${strip(x.text)}`);
    }
    const convo = (title, msgs) => {
      if (!msgs || !msgs.length) return;
      L.push('', `## ${title}`, '');
      for (const c of msgs) L.push(`**${c.role === 'user' ? 'You' : 'Coach'}:** ${c.content}`, '');
    };
    convo('AI coach tournament review', rec.review);
    convo('AI coach chat during the tournament', (rec.chat || []).filter((c) => c.meta !== 'err'));
    const hist = (m.history || []);
    L.push('', `## Hand histories (${hist.length}${rec.historyTrimmed ? ', older hands trimmed for space' : ''})`);
    for (const r of hist) {
      L.push('', `### Hand #${r.no} — Level ${r.level} — ${r.title}`, '', '```', r.narrative, '```');
      for (const gr of r.grades || []) L.push(`- ${gr.street}: **${gr.grade.toUpperCase()}** — you ${gr.took}, coach: ${gr.rec}. ${strip(gr.text)}`);
    }
    L.push('', '_Exported from Felt Sharpener._', '');
    return L.join('\n');
  }
  const strip = (s) => (s || '').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, k, sh) => sh || k).replace(/\*\*/g, '');

  function exportMarkdown(rec) { FS.native.saveFile(`felt-sharpener_${fileStamp(rec)}_${U.ordinal(rec.finish)}-of-${rec.field}.md`, 'text/markdown', toMarkdown(rec)); }
  function exportJSON(rec) { FS.native.saveFile(`felt-sharpener_${fileStamp(rec)}.json`, 'application/json', JSON.stringify(rec, null, 1)); }
  function exportAll() {
    const recs = all();
    if (!recs.length) return toast('No saved tournaments yet');
    FS.native.saveFile(`felt-sharpener_all-tournaments_${fileStamp({ savedAt: Date.now() })}.json`, 'application/json', JSON.stringify({ app: 'felt-sharpener', version: 1, tournaments: recs }, null, 1));
  }
  /** Accepts one exported tournament, or an "all tournaments" bundle. Returns number imported. */
  function importText(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('That file isn’t valid JSON.'); }
    const recs = Array.isArray(data) ? data : data && Array.isArray(data.tournaments) ? data.tournaments : [data];
    let n = 0;
    for (const r of recs) {
      if (!r || r.app !== 'felt-sharpener' || !r.id || !Array.isArray(r.players) || !r.meta) continue;
      add(r); n++;
    }
    if (!n) throw new Error('No Felt Sharpener tournaments found in that file.');
    return n;
  }
  function pickImport(onDone) {
    const inp = h('<input type="file" accept=".json,application/json" style="display:none">');
    document.body.appendChild(inp);
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      inp.remove();
      if (!f) return;
      f.text().then((t) => {
        try { const n = importText(t); toast(`Imported ${n} tournament${n > 1 ? 's' : ''}`, 'gold'); if (onDone) onDone(); }
        catch (e) { toast(e.message, 'red', 4000); }
      });
    };
    inp.click();
  }

  // ---------- AI coach context for a finished tournament ----------
  function contextFor(rec, question) {
    const m = rec.meta || {};
    const g = m.grades || {};
    const L = [
      `FINISHED TOURNAMENT: "${rec.name}", ${rec.field} players. Hero finished ${U.ordinal(rec.finish)}${rec.prize ? ', won ' + U.fmtMoney(rec.prize) : ', no cash'}. ${(rec.payouts || []).length} places paid.`,
      `Hands dealt ${m.hands || 0}; played ${m.hands ? Math.round(m.vpip / m.hands * 100) : 0}%; raised preflop ${m.hands ? Math.round(m.pfr / m.hands * 100) : 0}%.`,
      `Decision grades: ${g.good || 0} good, ${g.ok || 0} ok, ${g.mistake || 0} mistakes, ${g.blunder || 0} big mistakes.`,
      'Top finishers: ' + rec.players.slice().sort((a, b) => a.finish - b.finish).slice(0, 6).map((p) => `${U.ordinal(p.finish)} ${p.id === 'hero' ? 'HERO' : p.name}${p.id !== 'hero' && FS.roster.STYLES[p.style] ? ' (' + FS.roster.STYLES[p.style].label + ')' : ''}`).join(', '),
    ];
    if ((m.mistakes || []).length) { L.push('Flagged mistakes:'); for (const x of m.mistakes.slice(-12)) L.push(`- hand #${x.hand} (${x.cards}, ${x.street}): took ${x.took}, suggested ${x.rec}. ${strip(x.text)}`); }
    const hist = m.history || [];
    if (hist.length) {
      L.push('', 'HAND INDEX (number · level · your cards · position · result · coach grades):');
      for (const r of hist) L.push(`#${r.no} L${r.level} ${r.title}${(r.grades || []).length ? ' · ' + r.grades.map((x) => x.grade).join('/') : ''}`);
    }
    // Hands the player mentions ("hand 12", "#12") get their full history attached.
    const wanted = new Set();
    String(question || '').replace(/(?:hand\s*#?|#)(\d{1,4})/gi, (_, n) => wanted.add(+n));
    const full = hist.filter((r) => wanted.has(r.no));
    const extra = full.length ? full : hist.filter((r) => (r.grades || []).some((x) => x.grade === 'mistake' || x.grade === 'blunder')).slice(-3).concat(hist.slice(-2));
    const seen = new Set();
    for (const r of extra) { if (seen.has(r.no)) continue; seen.add(r.no); L.push('', `[Hand #${r.no}]`, r.narrative); }
    L.push('', 'If the player asks about a hand that is only in the index, say which hand number they can name so its full history is included.');
    return L.join('\n');
  }

  // ---------- conversation widget ----------
  function mdLite(s) {
    return U.esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/^#{1,4}\s*(.+)$/gm, '<b>$1</b>');
  }
  /**
   * A chat thread with a free-form reply box.
   * opts: { messages: array (mutated), context: (question) => string, starter: {label, question}, onChange, placeholder }
   */
  function conversation(container, opts) {
    const msgs = opts.messages;
    container.innerHTML = `<div class="convo-log" style="display:flex;flex-direction:column;gap:10px"></div>
      <div class="convo-start" style="margin-top:8px"></div>
      <div class="convo-reply chat-input" style="padding:10px 0 0">
        <textarea placeholder="${U.esc(opts.placeholder || 'Ask a follow-up… (Enter to send, Shift+Enter for a new line)')}"></textarea>
        <button class="btn gold">Send</button></div>`;
    const log = $('.convo-log', container), start = $('.convo-start', container), ta = $('textarea', container), send = $('.convo-reply .btn', container);
    const bubble = (role, content, meta) => (role === 'user'
      ? (() => { const d = h('<div class="msg user"></div>'); d.textContent = content; return d; })()
      : h(`<div class="msg bot ${meta === 'err' ? 'err' : ''}" style="max-width:100%"><span class="who">${meta === 'err' ? 'COACH (error)' : 'AI COACH'}</span>${mdLite(content)}</div>`));
    const draw = () => {
      log.innerHTML = '';
      msgs.forEach((m) => log.appendChild(bubble(m.role, m.content, m.meta)));
      start.innerHTML = !msgs.length && opts.starter ? `<button class="btn gold">${U.esc(opts.starter.label)}</button>` : '';
      const sb = $('button', start); if (sb) sb.onclick = () => ask(opts.starter.question);
    };
    let busy = false;
    async function ask(q) {
      q = (q || '').trim();
      if (!q || busy) return;
      busy = true; send.disabled = true;
      const history = msgs.filter((m) => m.meta !== 'err').map((m) => ({ role: m.role, content: m.content }));
      msgs.push({ role: 'user', content: q });
      draw();
      const typing = h('<div class="msg bot" style="max-width:100%"><span class="who">AI COACH</span><span class="spinner" style="display:inline-block;vertical-align:middle"></span> thinking…</div>');
      log.appendChild(typing);
      typing.scrollIntoView({ block: 'nearest' });
      try {
        const r = await FS.llm.ask(q, history, opts.context(q), FS.store.get().settings.llm);
        msgs.push({ role: 'assistant', content: r.reply });
      } catch (e) {
        msgs.push({ role: 'assistant', meta: 'err', content: e.message === 'NOT_CONFIGURED' ? 'Connect an AI endpoint in Settings → AI Coach to chat with the coach.' : e.message });
      }
      busy = false; send.disabled = false;
      draw();
      if (opts.onChange) opts.onChange();
      const last = log.lastElementChild; if (last) last.scrollIntoView({ block: 'nearest' });
    }
    send.onclick = () => { const q = ta.value; ta.value = ''; ask(q); };
    ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send.click(); } };
    draw();
    return { ask };
  }

  /** Ask the AI about one hand outside the game screen (e.g. from Your Progress). */
  function askAboutHand(rec, record) {
    const msgs = [];
    const box = h('<div></div>');
    modal(`Hand #${rec.no} — AI coach`, box, { wide: true });
    const ctx = () => (record ? contextFor(record, '#' + rec.no) : '') + `\n\n[Hand #${rec.no} — the hand being discussed]\n${rec.narrative}`;
    const c = conversation(box, { messages: msgs, context: ctx });
    c.ask(`Review hand #${rec.no} for me: what did I do well, what was my biggest mistake, and what should I have done instead?`);
  }

  // ---------- tournament report (results screen + archive viewer) ----------
  function renderReport(body, rec, opts) {
    opts = opts || {};
    const S = FS.store.get().settings;
    const meta = rec.meta || { grades: {}, mistakes: [], history: [] };
    const g = meta.grades || {}, tot = (g.good || 0) + (g.ok || 0) + (g.mistake || 0) + (g.blunder || 0);
    const acc = tot ? Math.round(((g.good || 0) + (g.ok || 0) * 0.5) / tot * 100) : null;
    const top = rec.players.slice().sort((a, b) => a.finish - b.finish).slice(0, 10);
    const headline = rec.finish === 1 ? 'CHAMPION!' : rec.prize ? 'In the money!' : rec.finish <= (rec.payouts || []).length + 2 ? 'So close!' : 'Good game';
    const hist = (meta.history || []).slice().reverse();
    body.innerHTML = `
      ${opts.archived ? `<div class="screen-head" style="padding:0"><button class="btn back" id="rep-back">◀ Back</button><h1 class="chrome-title" style="font-size:22px">${U.esc(rec.name)} · ${new Date(rec.startedAt || rec.savedAt).toLocaleDateString()}</h1></div>` : ''}
      <div class="results-hero panel"><div class="chrome-title" style="font-size:26px">${headline}</div>
        <div class="place">${U.ordinal(rec.finish)}</div><div class="muted">of ${rec.field} players</div>
        <div class="prize">${rec.prize ? 'You won <b style="color:var(--gold)">' + U.fmtMoney(rec.prize) + '</b>' : 'No cash this time — ' + (rec.payouts || []).length + ' places paid.'}</div></div>
      <div class="kpis">
        <div class="kpi panel"><b>${meta.hands || 0}</b><span>Hands dealt</span></div>
        <div class="kpi panel"><b>${meta.hands ? Math.round(meta.vpip / meta.hands * 100) : 0}%</b><span>Hands played</span></div>
        <div class="kpi panel"><b>${meta.hands ? Math.round(meta.pfr / meta.hands * 100) : 0}%</b><span>Raised preflop</span></div>
        <div class="kpi panel"><b>${acc == null ? '—' : acc + '%'}</b><span>Decision score</span></div>
        <div class="kpi panel"><b>+${fc(meta.biggestWin || 0)}</b><span>Biggest pot won</span></div>
      </div>
      <div class="section panel"><h2>AI coach review</h2>
        <p class="muted" style="margin-top:0">Ask for a review, then reply with follow-ups — mention a hand number (e.g. “hand 23”) and its full history is sent along. The conversation is saved with this tournament.</p>
        <div id="rep-convo"></div></div>
      <div class="section panel"><h2>Coach’s notes: mistakes to learn from</h2>
        ${(meta.mistakes || []).length ? meta.mistakes.slice(-8).reverse().map((x) => `<div class="mistake-item"><b>Hand #${x.hand}</b> (${U.esc(x.cards)}, ${x.street}) — you ${x.took}, coach suggested ${U.esc(x.rec)}.<br>${FS.coach.glossaryHTML(x.text)}</div>`).join('') : '<p>No flagged mistakes. Nice discipline!</p>'}
      </div>
      <div class="section panel"><h2>Final standings</h2><table class="grid"><tr><th>Place</th><th>Player</th><th>Style</th><th class="num">Prize</th></tr>
        ${top.map((p) => `<tr class="${p.id === 'hero' ? 'me' : ''}"><td>${U.ordinal(p.finish)}</td><td>${U.esc(p.id === 'hero' ? rec.heroName || 'You' : p.name)}</td><td>${p.id === 'hero' ? '' : (FS.roster.STYLES[p.style] || {}).label || ''}</td><td class="num">${p.prize ? U.fmtMoney(p.prize) : ''}</td></tr>`).join('')}</table></div>
      <div class="section panel"><h2>Every hand (${hist.length}${rec.historyTrimmed ? ', older ones trimmed for space' : ''})</h2>
        ${hist.length ? `<div style="max-height:320px;overflow-y:auto">${hist.map((r, i) => `<div class="hist-item" data-i="${i}"><span>#${r.no} · L${r.level} · ${U.esc(r.title)}</span><span>${(r.grades || []).map((x) => `<span style="color:var(--${x.grade === 'good' ? 'good' : x.grade === 'ok' ? 'ok' : 'bad'})">●</span>`).join('')}</span></div>`).join('')}</div>` : '<p class="muted">No hand histories saved.</p>'}
      </div>
      <div class="section panel"><h2>My notes</h2>
        <textarea id="rep-notes" style="width:100%;min-height:70px;padding:8px;border-radius:8px;border:1px solid var(--line);background:#06102a;color:#fff;font-family:inherit" placeholder="Anything you want to remember about this tournament…">${U.esc(rec.notes || '')}</textarea></div>
      <div class="section panel"><h2>Save this tournament</h2>
        <p class="muted" style="margin-top:0">It’s already saved on this device under <b>Your Progress → Saved tournaments</b>. Export a copy to keep it anywhere:</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn gold" id="rep-md">📄 Export report (.md)</button><button class="btn" id="rep-json">💾 Export data (.json)</button></div>
        <p class="small-note">The report is readable anywhere (hand histories, coach notes, AI conversations). The data file can be imported back into Felt Sharpener on any device.</p></div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:20px">
        ${opts.archived ? '<button class="btn" id="rep-del" style="border-color:var(--red)">Delete</button>' : `<button class="btn gold" id="res-again" style="padding:12px 24px">Play again ▶</button>`}
        <button class="btn" id="res-stats">Your progress</button><button class="btn" id="res-title">Title screen</button></div>`;
    rec.review = rec.review || [];
    conversation($('#rep-convo', body), {
      messages: rec.review,
      context: (q) => contextFor(rec, q),
      starter: { label: 'Review my tournament', question: 'Review my tournament. Give me: 1) what I did well, 2) my two biggest leaks with concrete examples from the hands, 3) three specific things to practice before my live tournament.' },
      onChange: () => update(rec),
    });
    $$('.hist-item', body).forEach((it) => (it.onclick = () => FS.game.reviewHand(hist[+it.dataset.i], () => askAboutHand(hist[+it.dataset.i], rec))));
    const notes = $('#rep-notes', body);
    notes.onchange = () => { rec.notes = notes.value; update(rec); toast('Notes saved'); };
    $('#rep-md', body).onclick = () => exportMarkdown(rec);
    $('#rep-json', body).onclick = () => exportJSON(rec);
    $('#res-stats', body).onclick = () => FS.ui.showScreen('stats');
    $('#res-title', body).onclick = () => FS.ui.showScreen('title');
    const again = $('#res-again', body);
    if (again) again.onclick = () => { const ls = S.lastSetup; FS.game.start({ field: rec.field, speed: ls.speed, difficulty: ls.difficulty }); };
    const back = $('#rep-back', body);
    if (back) back.onclick = () => FS.ui.showScreen('stats');
    const del = $('#rep-del', body);
    if (del) del.onclick = () => { if (confirm('Delete this saved tournament from this device?')) { remove(rec.id); FS.ui.showScreen('stats'); toast('Deleted'); } };
  }

  /** "Saved tournaments" section for the progress screen. */
  function listHTML() {
    const recs = all();
    return `<div class="section panel"><h2>Saved tournaments</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><button class="btn small" id="arc-import">📂 Import (.json)</button><button class="btn small" id="arc-export-all" ${recs.length ? '' : 'disabled'}>💾 Export all</button></div>
      ${recs.length ? recs.map((r) => `<div class="hist-item" data-id="${U.esc(r.id)}"><span>${new Date(r.startedAt || r.savedAt).toLocaleDateString()} · ${r.field}-player · <b>${U.ordinal(r.finish)}</b>${r.prize ? ' · ' + U.fmtMoney(r.prize) : ''}${(r.review || []).length ? ' · 💬' : ''}</span><span class="small-note">Open ▶</span></div>`).join('') : '<p class="muted">Finished tournaments are saved here automatically.</p>'}</div>`;
  }
  function bindList(container, rerender) {
    $$('.hist-item[data-id]', container).forEach((it) => (it.onclick = () => FS.ui.showScreen('results', { id: it.dataset.id, archived: true })));
    const imp = $('#arc-import', container); if (imp) imp.onclick = () => pickImport(rerender);
    const exp = $('#arc-export-all', container); if (exp) exp.onclick = exportAll;
  }

  FS.archive = { load, add, all, get, update, remove, makeRecord, toMarkdown, exportMarkdown, exportJSON, exportAll, importText, pickImport, contextFor, conversation, askAboutHand, renderReport, listHTML, bindList, KEY };
})(typeof window !== 'undefined' ? window : globalThis);
