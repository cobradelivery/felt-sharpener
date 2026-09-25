// usage: node tools/shot.js <url-or-file> <out.png> [width] [height] [waitMs]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const [, , target, out, w, h, wait] = process.argv;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: +(w || 1280), height: +(h || 800) } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto(/^(https?|file):/.test(target) ? target : 'file://' + require('path').resolve(target));
  await p.waitForTimeout(+(wait || 800));
  await p.screenshot({ path: out, fullPage: process.env.FULL !== '0' });
  console.log(errs.join('\n') || 'no errors');
  await b.close();
})();
