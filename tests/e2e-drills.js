// E2E: Math Drills — a 10-question session of every drill type (mixing right and wrong answers), keyboard
// controls, the timer, the lesson link, stats persisting across reload onto Your Progress, the Android back
// button, plus desktop and landscape-phone screenshots. Usage: node tests/e2e-drills.js [screenshot dir]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const OUT = process.argv[2] || '/tmp';
const TYPES = ['potodds', 'outs', 'callfold', 'betsize', 'equity'];
const fail = (m) => { throw new Error(m); };
/** Screenshot after the screen / feedback animations settle. */
async function shot(p, opts) { await p.waitForTimeout(700); await p.screenshot(opts); }

async function open(ctx) {
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.stack || e.message));
  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  return { p, errs };
}
async function toDrills(p) {
  await p.click('#press-start');
  await p.click('.menu-item[data-id=drills]');
  await p.waitForSelector('#scr-drills.active .drill-setup');
}
async function pick(p, key, v) { await p.click(`.opt-choices[data-key=${key}] .opt[data-v="${v}"]`); }
/** Answer the current question right or wrong by clicking. */
async function answer(p, right) {
  const a = await p.evaluate((right) => {
    const q = FS.drills.session.q;
    if (q.kind === 'callfold') return right ? q.answer : (q.answer === 'call' ? 'fold' : 'call');
    const i = q.options.findIndex((o) => o.correct);
    return String(right ? i : (i + 1) % q.options.length);
  }, right);
  await p.click(`.drill-opt[data-a="${a}"]`);
  await p.waitForSelector('.drill-fb');
  const txt = await p.textContent('.drill-fb .g');
  if (right !== /Correct/.test(txt)) fail('feedback mismatch: ' + txt);
}
async function nextQ(p) { await p.click('#drill-next'); }

(async () => {
  const b = await chromium.launch();
  // ---------------- desktop ----------------
  const ctx = await b.newContext({ viewport: { width: 1366, height: 800 } });
  let { p, errs } = await open(ctx);
  await p.evaluate(() => { localStorage.clear(); });
  await p.reload();
  await p.evaluate(() => { FS.store.get().seenIntro = true; FS.store.save(true); });
  await toDrills(p);
  await shot(p, { path: path.join(OUT, 'drills-01-setup-desktop.png') });
  const expected = {};
  for (const t of TYPES) {
    await pick(p, 'type', t); await pick(p, 'length', 10); await pick(p, 'timer', 0);
    await p.click('#drill-go');
    let right = 0;
    for (let i = 0; i < 10; i++) {
      await p.waitForSelector('.drill-card');
      const qt = await p.evaluate(() => FS.drills.session.q.type);
      if (qt !== t) fail(`asked ${qt} in a ${t} session`);
      const ok = i % 3 !== 2; // 7 right, 3 wrong
      if (i === 0) await shot(p, { path: path.join(OUT, `drills-q-${t}-desktop.png`) });
      await answer(p, ok);
      if (ok) right++;
      if (i === 2) await shot(p, { path: path.join(OUT, `drills-fb-${t}-desktop.png`) });
      await nextQ(p);
    }
    await p.waitForSelector('.drill-summary');
    const sum = await p.textContent('.drill-summary');
    if (!sum.includes(`${right}/10`) || !sum.includes('70%')) fail('summary wrong for ' + t + ': ' + sum.slice(0, 200));
    if (t === 'equity') await shot(p, { path: path.join(OUT, 'drills-summary-desktop.png') });
    expected[t] = { attempts: 10, correct: right };
    await p.click('#drill-change');
    await p.waitForSelector('.drill-setup');
  }
  // keyboard: 1-4 / C F / Enter, mixed endless, then Finish
  await pick(p, 'type', 'mixed'); await pick(p, 'length', 0);
  await p.click('#drill-go');
  for (let i = 0; i < 6; i++) {
    await p.waitForSelector('.drill-card');
    const kind = await p.evaluate(() => FS.drills.session.q.kind);
    await p.keyboard.press(kind === 'callfold' ? 'c' : '1');
    await p.waitForSelector('.drill-fb');
    await p.keyboard.press(i % 2 ? 'Enter' : ' ');
  }
  const n = await p.evaluate(() => FS.drills.session.n);
  if (n !== 6) fail('keyboard answers not counted: ' + n);
  // lesson link from feedback, then Back returns to the same session
  await p.waitForSelector('.drill-card');
  await p.keyboard.press(await p.evaluate(() => (FS.drills.session.q.kind === 'callfold' ? 'f' : '2')));
  await p.click('.drill-fb [data-learn]');
  await p.waitForSelector('#scr-learn.active');
  if (!/Pot odds/.test(await p.textContent('.learn-nav button.sel'))) fail('lesson 5 not selected');
  await p.click('#scr-learn .btn.back');
  await p.waitForSelector('#scr-drills.active .drill-fb');
  if ((await p.evaluate(() => FS.drills.session.n)) !== 7) fail('session not resumed after lesson');
  await p.click('#drill-end');
  await p.waitForSelector('.drill-summary');
  // timer: a timeout counts as wrong
  await p.click('#drill-change');
  await pick(p, 'timer', 1); await pick(p, 'length', 10); await pick(p, 'type', 'betsize');
  await p.click('#drill-go');
  await p.waitForSelector('#drill-timebar');
  await p.waitForTimeout(6000);
  const w = await p.evaluate(() => parseFloat(document.querySelector('#drill-timebar').style.width));
  if (!(w > 40 && w < 70)) fail('timer bar not counting down: ' + w);
  await shot(p, { path: path.join(OUT, 'drills-timer-desktop.png') });
  await p.waitForSelector('.drill-fb', { timeout: 15000 });
  if (!/Time/.test(await p.textContent('.drill-fb .g'))) fail('timeout feedback missing');
  // Android back from the drills screen -> title
  if ((await p.evaluate(() => FS.native.back())) !== 'handled' || (await p.evaluate(() => FS.ui.current)) !== 'title') fail('back did not return to title');
  await p.waitForTimeout(400);
  // persistence across reload
  await p.reload();
  const st = await p.evaluate(() => FS.store.get().drills);
  for (const t of TYPES) {
    const s = st[t];
    if (!s || s.attempts < expected[t].attempts || s.correct < expected[t].correct || s.last.length > 20 || s.timeMs <= 0) fail('stats not persisted for ' + t + ': ' + JSON.stringify(s));
  }
  if (st.betsize.attempts < 11) fail('timed-out answer not recorded');
  if (st.sessions < 6) fail('sessions not counted: ' + st.sessions);
  await p.evaluate(() => FS.ui.showScreen('stats'));
  await p.waitForSelector('.drill-stats');
  const statsTxt = await p.textContent('.drill-stats');
  for (const l of ['Pot odds', 'Count the outs', 'Call or fold', 'Bet-size shortcuts', 'Estimate equity']) if (!statsTxt.includes(l)) fail('stats missing ' + l);
  for (const t of TYPES) { const pc = Math.round(st[t].correct / st[t].attempts * 100) + '%'; if (!statsTxt.includes(pc)) fail('accuracy ' + pc + ' for ' + t + ' not shown on progress screen'); }
  await p.evaluate(() => document.querySelector('.drill-stats').scrollIntoView());
  await shot(p, { path: path.join(OUT, 'drills-stats-desktop.png') });
  if (errs.length) fail(errs.join('\n'));
  await ctx.close();

  // ---------------- landscape phone (touch) ----------------
  const pctx = await b.newContext({ viewport: { width: 915, height: 411 }, isMobile: true, hasTouch: true });
  ({ p, errs } = await open(pctx));
  await p.evaluate(() => { localStorage.clear(); });
  await p.reload();
  await p.evaluate(() => { FS.store.get().seenIntro = true; FS.store.save(true); });
  await p.tap('#press-start');
  await shot(p, { path: path.join(OUT, 'drills-phone-menu.png') });
  await p.tap('.menu-item[data-id=drills]');
  await p.waitForSelector('.drill-setup');
  await shot(p, { path: path.join(OUT, 'drills-phone-setup.png') });
  const clipped = async (label) => {
    const bad = await p.evaluate(() => {
      const vw = window.innerWidth;
      const out = [];
      document.querySelectorAll('#scr-drills .btn, #scr-drills .opt, #scr-drills .card').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width && (r.left < -1 || r.right > vw + 1)) out.push(el.className + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
        if (el.matches('.drill-opt, #drill-next, #drill-go, .opt') && r.height < 40) out.push('small tap target ' + el.className + ' h=' + r.height);
      });
      if (document.documentElement.scrollWidth > vw + 1) out.push('horizontal scroll');
      return out;
    });
    if (bad.length) fail(label + ': ' + bad.join('; '));
  };
  await clipped('setup');
  for (const t of TYPES) {
    await p.tap(`.opt-choices[data-key=type] .opt[data-v="${t}"]`);
    await p.tap('#drill-go');
    await p.waitForSelector('.drill-card');
    await clipped(t + ' question');
    // question + answers must be visible without scrolling
    const fits = await p.evaluate(() => { const r = document.querySelector('.drill-answers').getBoundingClientRect(); return r.bottom <= window.innerHeight; });
    if (!fits) fail(t + ': answers below the fold on a phone');
    await shot(p, { path: path.join(OUT, `drills-phone-q-${t}.png`) });
    const a = await p.evaluate(() => { const q = FS.drills.session.q; return q.kind === 'callfold' ? q.answer : String((q.options.findIndex((o) => o.correct) + 1) % q.options.length); });
    await p.tap(`.drill-opt[data-a="${a}"]`);
    await p.waitForSelector('.drill-fb');
    await p.waitForTimeout(1000);
    await clipped(t + ' feedback');
    await shot(p, { path: path.join(OUT, `drills-phone-fb-${t}.png`) });
    await p.tap('#drill-end');
    await p.waitForSelector('.drill-summary');
    if (t === 'equity') { await clipped('summary'); await shot(p, { path: path.join(OUT, 'drills-phone-summary.png') }); }
    await p.tap('#drill-change');
    await p.waitForSelector('.drill-setup');
  }
  await p.evaluate(() => FS.ui.showScreen('stats'));
  await p.evaluate(() => document.querySelector('.drill-stats').scrollIntoView());
  await shot(p, { path: path.join(OUT, 'drills-phone-stats.png') });
  if (errs.length) fail(errs.join('\n'));
  await b.close();
  console.log('DRILLS E2E OK (5 drill types × 10 questions, keyboard, timer, lesson link, persistence, phone layout)');
})().catch((e) => { console.error(e); process.exit(1); });
