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
await page.evaluate(() => {
  const ctx = window.__emberkeep.game.registry.get('ctx');
  if (ctx.state.items.size === 0) { ctx.systems.board.newGame(); ctx.systems.tutorial.begin(); ctx.systems.order.announceProgress(); }
});
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/BLUR-idle.png' });        // expect: sharp (velocity ~0 → passthrough)
const blurState = await page.evaluate(() => {
  const sc = window.__emberkeep.game.scene.getScene('BoardScene');
  const mb = sc.motionBlur;
  const cls = sc.cameras.main.postPipelines?.length ?? 0;
  return { attached: !!mb, idleVx: mb ? +mb.vx.toFixed(5) : null, idleVy: mb ? +mb.vy.toFixed(5) : null, pipelineCount: cls };
});
await page.evaluate(() => {
  const sc = window.__emberkeep.game.scene.getScene('BoardScene');
  sc.tutorialDone = true; // the camera fly is suppressed during the tutorial
  window.__emberkeep.game.registry.get('ctx').state.tutorialDone = true;
});
await page.evaluate(() => window.__emberkeep.grantXp(60));     // level-up → camera flies to zone 2
await page.waitForTimeout(700);                                // ~peak velocity (smootherstep, 1500ms fly)
await page.screenshot({ path: '/tmp/BLUR-flying.png' });       // expect: directional smear
const mid = await page.evaluate(() => {
  const mb = window.__emberkeep.game.scene.getScene('BoardScene').motionBlur;
  return mb ? { vx: +mb.vx.toFixed(5), vy: +mb.vy.toFixed(5) } : null;
});
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/BLUR-settled.png' });      // expect: sharp again
console.log('blur:', JSON.stringify(blurState), '| mid-fly velocity:', JSON.stringify(mid));
console.log('console errors (non-favicon):', errs.filter((e) => !e.includes('favicon')).length, errs.filter((e) => !e.includes('favicon')).slice(0, 4));
await browser.close();
