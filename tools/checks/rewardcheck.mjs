import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.waitForTimeout(500);
await page.evaluate(() => window.__emberkeep.game.scene.getScene('TitleScene').scene.start('BoardScene'));
await page.waitForTimeout(1500);
const cell = await page.evaluate(() => {
  const ctx = window.__emberkeep.game.registry.get('ctx');
  if (ctx.state.items.size === 0) { ctx.systems.board.newGame(); ctx.systems.tutorial.begin(); ctx.systems.order.announceProgress(); }
  const c = ctx.state.freeActiveTilesNear(4, 7)[0];
  ctx.systems.board.spawn('ember_dragon', 3, c.col, c.row, 'init'); // a whelp generator
  const iso = (col, row) => ({ x: 2560 / 2 + (col - row) * 256 / 2, y: 316 + (col + row) * 128 / 2 });
  const w = iso(c.col, c.row);
  const cam = window.__emberkeep.game.scene.getScene('BoardScene').cameras.main;
  cam.setZoom(2.0); cam.centerOn(w.x, w.y - 120);
  return c;
});
await page.waitForTimeout(2600); // rig loads + a time:advanced tick arms the passive timer
const passive = await page.evaluate(() => {
  const sc = window.__emberkeep.game.scene.getScene('BoardScene');
  return { timers: sc.rewardTimers.size };
});
await page.screenshot({ path: '/tmp/REWARD-passive.png' }); // passive (free-gift) countdown
// now harvest it → 10s recharge cooldown
await page.evaluate(() => {
  const ctx = window.__emberkeep.game.registry.get('ctx');
  const d = [...ctx.state.items.values()].find((i) => i.chain === 'ember_dragon' && i.readyAt !== undefined);
  if (d) ctx.bus.emit('item:tapped', { itemId: d.id });
});
await page.waitForTimeout(900);
const cooling = await page.evaluate(() => {
  const ctx = window.__emberkeep.game.registry.get('ctx');
  const d = [...ctx.state.items.values()].find((i) => i.chain === 'ember_dragon' && i.readyAt !== undefined);
  return { coolingMs: d ? d.readyAt - ctx.clock.now() : null };
});
await page.screenshot({ path: '/tmp/REWARD-cooldown.png' }); // recharge countdown
console.log('timers:', passive.timers, '| post-harvest cooldown ms:', cooling.coolingMs);
console.log('errors:', errs.filter((e) => !e.includes('favicon')).length, errs.filter((e) => !e.includes('favicon')).slice(0, 3));
await browser.close();
