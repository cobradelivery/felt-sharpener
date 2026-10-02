// Renders the launcher icons (a red chip with a gold spade on PS2 blue) to android/res as PNGs.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const RES = path.join(__dirname, '..', 'android', 'res');
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const html = `<!doctype html><html><body style="margin:0;background:transparent"><canvas id=c></canvas>
<script src="file://${path.join(__dirname, '..', 'js/core/util.js')}"></script>
<script src="file://${path.join(__dirname, '..', 'js/game/avatars.js')}"></script>
<script>
function draw(size, mode) { // mode: 'legacy' (round icon w/ background) | 'fg' (adaptive foreground, 108dp canvas)
  const c = document.getElementById('c'); c.width = c.height = size; const x = c.getContext('2d');
  x.clearRect(0, 0, size, size);
  const inner = mode === 'fg' ? size * 0.62 : size;
  const off = (size - inner) / 2;
  if (mode === 'legacy') {
    const g = x.createRadialGradient(size/2, size*0.4, size*0.05, size/2, size/2, size*0.6);
    g.addColorStop(0, '#2a62d8'); g.addColorStop(1, '#0b1a44');
    x.fillStyle = g; x.beginPath(); x.arc(size/2, size/2, size/2, 0, Math.PI*2); x.fill();
  }
  const sub = document.createElement('canvas'); sub.width = sub.height = Math.round(inner);
  FS.avatars.render(FS.avatars.chipMesh('#c02828'), sub.getContext('2d'), sub.width, sub.height, { yaw: 0.35, pitch: 1.05, dist: 4, fov: 4.6, light: [-0.4, 0.8, 0.6] });
  x.drawImage(sub, off, off - inner * 0.02);
  x.font = 'bold ' + Math.round(inner * 0.27) + 'px "Arial Black", sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = inner * 0.035; x.strokeStyle = '#3a1c00'; x.strokeText('♠', size/2, size/2 - inner*0.02);
  const gg = x.createLinearGradient(0, size/2 - inner*0.17, 0, size/2 + inner*0.17);
  gg.addColorStop(0, '#fff6cc'); gg.addColorStop(0.5, '#ffcf3f'); gg.addColorStop(1, '#b86d00');
  x.fillStyle = gg; x.fillText('♠', size/2, size/2 - inner*0.02);
  return c.toDataURL('image/png');
}
</script></body></html>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const tmp = path.join(__dirname, '..', 'android', '.icon.html');
  fs.writeFileSync(tmp, html);
  await p.goto('file://' + tmp);
  for (const [d, k] of Object.entries(DENS)) {
    const dir = path.join(RES, 'mipmap-' + d);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, mode, base] of [['ic_launcher.png', 'legacy', 48], ['ic_launcher_fg.png', 'fg', 108]]) {
      const url = await p.evaluate(([s, m]) => draw(s, m), [Math.round(base * k), mode]);
      fs.writeFileSync(path.join(dir, name), Buffer.from(url.split(',')[1], 'base64'));
    }
  }
  fs.mkdirSync(path.join(RES, 'mipmap-anydpi-v26'), { recursive: true });
  fs.writeFileSync(path.join(RES, 'mipmap-anydpi-v26', 'ic_launcher.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/icon_bg" />\n    <foreground android:drawable="@mipmap/ic_launcher_fg" />\n</adaptive-icon>\n');
  // a preview for README / sanity
  const prev = await p.evaluate(() => draw(512, 'legacy'));
  fs.writeFileSync(path.join(__dirname, '..', 'android', 'icon-preview.png'), Buffer.from(prev.split(',')[1], 'base64'));
  fs.unlinkSync(tmp);
  await b.close();
  console.log('icons written');
})();
