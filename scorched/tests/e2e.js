// E2E: Scorched in a real browser — menu and demo battle, setup, shop (buy + sell), keyboard aiming and
// firing, drag-to-aim, every weapon and item fired/used through the live game, round results, pause menu,
// and a phone-sized layout. Usage: node scorched/tests/e2e.js [screenshot dir]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const OUT = process.argv[2] || '/tmp';
const fail = (m) => { throw new Error(m); };

async function open(b, viewport) {
  const p = await b.newPage({ viewport });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.stack || e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  return { p, errs };
}
const waitFor = async (p, fn, ms = 30000, arg) => p.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
const humanTurn = (p) => waitFor(p, () => { const g = SE.app.game; return g && g.phase === 'aim' && g.current && !g.current.ai; }, 120000);

(async () => {
  const b = await chromium.launch();
  const { p, errs } = await open(b, { width: 1366, height: 800 });

  // Menu with the CPU demo battle running behind it.
  await p.waitForSelector('#scr-menu.active');
  await waitFor(p, () => SE.app.demo && SE.app.demo.round >= 1);
  if ((await p.$$('#setup-players .prow')).length !== 4) fail('expected 4 default players');
  await p.click('#add-player');
  if ((await p.$$('#setup-players .prow')).length !== 5) fail('add player failed');
  await p.click('#setup-players .prow:last-child .rm');
  // A quick duel: you vs one Moron, 2 rounds, no wind.
  await p.evaluate(() => {
    const rows = document.querySelectorAll('#setup-players .prow');
    for (let i = rows.length - 1; i >= 2; i--) rows[i].querySelector('.rm').click();
  });
  await p.selectOption('#setup-players .prow:nth-child(2) select', 'moron');
  await p.selectOption('#opt-rounds', { label: '3' });
  await p.selectOption('#opt-wind', { label: 'None' });
  await p.selectOption('#opt-startCash', { label: '$25,000' });
  await p.screenshot({ path: path.join(OUT, 'scorched-menu.png') });
  await p.click('#start-game');

  // Shop: buy then sell back, then buy again.
  await p.waitForSelector('#scr-shop.active');
  const cash0 = await p.evaluate(() => SE.app.game.players[0].cash);
  await p.click('.card:nth-child(1) .btn.primary'); // Missile
  const cash1 = await p.evaluate(() => SE.app.game.players[0].cash);
  if (cash0 - cash1 !== 1500) fail('buy did not charge $1,500');
  await p.click('.card:nth-child(1) .btn:not(.primary)');
  if ((await p.evaluate(() => SE.app.game.players[0].cash)) !== cash1 + 750) fail('sell did not refund half');
  await p.click('.card:nth-child(1) .btn.primary');
  await p.click('#shop-tabs .tab[data-tab=item]');
  await p.click('.card:nth-child(2) .btn.primary'); // Shield
  await p.screenshot({ path: path.join(OUT, 'scorched-shop.png') });
  await p.click('#shop-done');
  await waitFor(p, () => SE.app.game.phase === 'aim' || SE.app.game.phase === 'flight');
  if (await p.isHidden('#hud')) fail('HUD should be visible during battle');

  // Keyboard aiming on our turn.
  await humanTurn(p);
  const a0 = await p.evaluate(() => SE.app.game.current.angle);
  await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft');
  const a1 = await p.evaluate(() => SE.app.game.current.angle);
  if (Math.abs(a1 - a0 - 2) > 0.01) fail(`ArrowLeft should add 1° per tap (${a0} -> ${a1})`);
  const pw0 = await p.evaluate(() => SE.app.game.current.power);
  await p.keyboard.press('ArrowUp');
  if ((await p.evaluate(() => SE.app.game.current.power)) !== Math.min(pw0 + 5, 1000)) fail('ArrowUp should add 5 power');
  await p.keyboard.press('Tab');
  if ((await p.evaluate(() => SE.app.game.current.weapon)) !== 'missile') fail('Tab should select the next owned weapon');
  await p.keyboard.press('KeyS');
  if (!(await p.evaluate(() => SE.app.game.current.shield > 0))) fail('S should raise the shield');
  if (!(await p.$eval('#hud-wname', (e) => e.textContent === 'Missile'))) fail('HUD weapon name not updated');

  // Drag on the field to aim: straight up, from the tank.
  const box = await p.$eval('#view', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const tank = await p.evaluate(() => ({ x: SE.app.game.current.x, y: SE.app.game.current.y }));
  const sx = box.w / 1280;
  await p.mouse.move(box.x + tank.x * sx, box.y + (tank.y - 8 - 150) * sx);
  await p.mouse.down(); await p.mouse.up();
  const aim = await p.evaluate(() => ({ a: SE.app.game.current.angle, pw: SE.app.game.current.power }));
  if (Math.abs(aim.a - 90) > 1 || Math.abs(aim.pw - 500) > 15) fail('drag-to-aim gave ' + JSON.stringify(aim));

  // Fire with the keyboard at the CPU using the AI's own solver.
  await p.evaluate(() => { const g = SE.app.game, t = g.current, foe = g.players.find((x) => x !== t); const s = SE.ai.solve(g, t, foe, g.wind, 30); g.setAim(s.angle, s.power); });
  await p.keyboard.press('Space');
  await waitFor(p, () => SE.app.game.phase === 'flight');
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(OUT, 'scorched-flight.png') });

  // Every weapon, fired from our tank through the live game.
  const ids = await p.evaluate(() => SE.weapons.WEAPONS.map((w) => w.id));
  const shots = {};
  for (const id of ids) {
    await waitFor(p, () => { const g = SE.app.game; return (g.phase === 'aim' && !g.current.ai) || g.phase === 'roundOver' || g.phase === 'gameOver' || (g.phase === 'aim' && g.current.ai); }, 120000);
    // Keep both tanks alive and make it our turn, so each weapon gets a clean shot.
    const res = await p.evaluate((id) => {
      const g = SE.app.game;
      if (g.phase !== 'aim') return 'skip';
      const me = g.players[0], foe = g.players[1];
      for (const t of g.players) { t.alive = true; t.ai_ = null; t.shield = 0; }
      me.health = 100; foe.health = 1e6; // the target soaks everything so the round never ends
      g.turnIdx = g.order.indexOf(me);
      me.inv[id] = Math.max(me.inv[id], 1);
      g.selectWeapon(id);
      const w = SE.weapons.get(id);
      const s = SE.ai.solve(g, me, foe, g.wind, w.kind === 'mirv' ? 0 : w.radius);
      g.setAim(s.angle, s.power);
      const before = g.terrain.cells.reduce((n, c) => n + (c ? 1 : 0), 0);
      window.__shot = { id, before, events: {} };
      if (!window.__hooked) { window.__hooked = true; g.on((type) => { if (window.__shot) window.__shot.events[type] = (window.__shot.events[type] || 0) + 1; }); }
      return g.fire() ? 'fired' : 'no-fire';
    }, id);
    if (res !== 'fired') fail(`${id}: ${res}`);
    if (id === 'nuke' || id === 'napalm' || id === 'mirv') {
      await p.waitForTimeout(id === 'mirv' ? 1700 : 1300);
      await p.screenshot({ path: path.join(OUT, `scorched-${id}.png`) });
    }
    await waitFor(p, () => SE.app.game.phase !== 'flight', 60000);
    shots[id] = await p.evaluate(() => {
      const g = SE.app.game, s = window.__shot;
      const after = g.terrain.cells.reduce((n, c) => n + (c ? 1 : 0), 0);
      return { events: s.events, removed: s.before - after };
    });
  }
  const sum = (id, ev) => shots[id].events[ev] || 0;
  if (!(sum('nuke', 'boom') >= 1 && shots.nuke.removed > 3000)) fail('nuke should blow a big crater: ' + JSON.stringify(shots.nuke));
  if (sum('mirv', 'split') !== 1 || sum('mirv', 'boom') < 5) fail('MIRV should split into 5: ' + JSON.stringify(shots.mirv));
  if (sum('funky', 'boom') < 4) fail('funky bomb should scatter bomblets: ' + JSON.stringify(shots.funky));
  if (sum('leapfrog', 'boom') < 2) fail('leapfrog should bounce: ' + JSON.stringify(shots.leapfrog));
  if (!(shots.tonofdirt.removed < -2000)) fail('ton of dirt should add ground: ' + JSON.stringify(shots.tonofdirt));
  if (!(shots.digger.removed > 200)) fail('digger should tunnel: ' + JSON.stringify(shots.digger));
  if (sum('napalm', 'napalm') !== 1) fail('napalm should ignite: ' + JSON.stringify(shots.napalm));
  if (sum('tracer', 'boom') !== 0) fail('tracer must not explode');
  if (sum('sandhog', 'boom') < 1) fail('sandhog heads should explode underground');

  // Battery restores health; parachute saves a falling tank.
  const items = await p.evaluate(() => {
    const g = SE.app.game, me = g.players[0];
    if (g.phase !== 'aim') return 'not aiming';
    g.turnIdx = g.order.indexOf(me); me.health = 50; me.inv.battery = 1;
    const ok = g.useItem('battery');
    return ok && me.health === 65 ? 'ok' : 'battery failed ' + me.health;
  });
  if (items !== 'ok') fail(items);

  // Pause menu.
  await p.keyboard.press('Escape');
  await p.waitForSelector('#scr-pause.active');
  await p.screenshot({ path: path.join(OUT, 'scorched-pause.png') });
  await p.click('#p-resume');
  if (await p.isVisible('#scr-pause')) fail('resume should close the pause menu');

  // Finish the round by destroying the CPU, then check the results screen.
  await p.evaluate(() => { const g = SE.app.game; const foe = g.players[1]; foe.health = 100; g.damage(foe, 999, g.players[0]); g.endTurn(); });
  await p.waitForSelector('#scr-results.active', { timeout: 15000 });
  const resTitle = await p.textContent('#res-title');
  if (!/Round 1/.test(resTitle)) fail('unexpected results title ' + resTitle);
  await p.screenshot({ path: path.join(OUT, 'scorched-results.png') });
  await p.click('#res-foot .btn.primary');
  await p.waitForSelector('#scr-shop.active');
  await p.click('#shop-done');
  await waitFor(p, () => SE.app.game.round === 2);

  if (errs.length) fail('page errors:\n' + errs.join('\n'));
  await p.close();

  // Phone, landscape.
  const m = await open(b, { width: 844, height: 390 });
  await m.p.click('#start-game');
  await m.p.waitForSelector('#scr-shop.active');
  await m.p.screenshot({ path: path.join(OUT, 'scorched-phone-shop.png') });
  await m.p.click('#shop-done');
  await m.p.waitForTimeout(2500);
  await m.p.screenshot({ path: path.join(OUT, 'scorched-phone.png') });
  const overflow = await m.p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) fail('phone layout scrolls horizontally');
  if (m.errs.length) fail('phone page errors:\n' + m.errs.join('\n'));

  await b.close();
  console.log('scorched e2e: OK (' + ids.length + ' weapons fired)');
})().catch((e) => { console.error(e); process.exit(1); });
