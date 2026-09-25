// Measures actual audio output levels in headless Chromium: music, SFX and voices must be audible
// and must not clip. usage: node tests/audio-check.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await p.click('#press-start');
  const measure = (label, fn, ms) => p.evaluate(async ([label, fnSrc, ms]) => {
    const a = FS.audio.tap();
    const buf = new Float32Array(a.fftSize);
    // eslint-disable-next-line no-new-func
    new Function(fnSrc)();
    let peak = 0, sumSq = 0, n = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      a.getFloatTimeDomainData(buf);
      for (const v of buf) { peak = Math.max(peak, Math.abs(v)); sumSq += v * v; n++; }
      await new Promise((r) => setTimeout(r, 20));
    }
    return { label, peak: +peak.toFixed(3), rms: +Math.sqrt(sumSq / n).toFixed(4) };
  }, [label, fn, ms]);
  const results = [];
  results.push(await measure('music', '', 4000));
  await p.evaluate(() => FS.audio.stopMusic());
  await p.waitForTimeout(1500);
  results.push(await measure('deal', 'FS.audio.sfx.deal()', 400));
  results.push(await measure('chips', 'FS.audio.sfx.chip(6)', 500));
  results.push(await measure('shuffle', 'FS.audio.sfx.shuffle()', 1200));
  results.push(await measure('check', 'FS.audio.sfx.check()', 400));
  results.push(await measure('potWin', 'FS.audio.sfx.potWin()', 900));
  results.push(await measure('grumble', "FS.audio.vox.say('grumble', {pitch: 100, timbre: 'm'})", 1200));
  results.push(await measure('cheer', "FS.audio.vox.say('cheer', {pitch: 220, timbre: 'f'})", 1000));
  results.push(await measure('laugh', "FS.audio.vox.say('laugh', {pitch: 130, timbre: 'm'})", 1000));
  results.push(await measure('crowd', "FS.audio.vox.crowd('ooh')", 1200));
  results.push(await measure('fanfare', 'FS.audio.sfx.fanfare()', 1200));
  console.table(results);
  await b.close();
  const bad = results.filter((r) => r.peak < 0.01 || r.peak > 0.99);
  if (errs.length || bad.length) { console.error('FAIL', errs, bad); process.exit(1); }
  console.log('AUDIO OK');
})();
