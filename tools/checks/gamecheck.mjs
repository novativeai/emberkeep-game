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
await page.waitForTimeout(1800);
// confirm the new grass texture is actually loaded + used
const info = await page.evaluate(() => {
  const sc = window.__emberkeep.game.scene.getScene('BoardScene');
  const tm = sc.textures;
  const g1 = tm.exists('grass_1') ? tm.get('grass_1').getSourceImage() : null;
  return {
    grass1: g1 ? `${g1.width}x${g1.height}` : 'missing',
    waterLoaded: tm.exists('bg_water'),
    grass16Exists: tm.exists('grass_16'),
    tiles: sc.tiles?.size ?? 0
  };
});
await page.screenshot({ path: '/tmp/GAME-newgrass-clearing.png' });
// zoom out to see the whole isle silhouette in new grass
await page.evaluate(() => {
  const sc = window.__emberkeep.game.scene.getScene('BoardScene');
  const cam = sc.cameras.main;
  cam.setZoom(0.34);
  cam.centerOn(2560 / 2 + 1200, 1500);
});
await page.waitForTimeout(700);
await page.screenshot({ path: '/tmp/GAME-newgrass-isle.png' });
console.log('grass_1 texture:', info.grass1, '| bg_water loaded:', info.waterLoaded, '| grass_16 exists:', info.grass16Exists, '| ground tiles:', info.tiles);
console.log('errors:', errs.filter((e) => !e.includes('favicon')).length, errs.filter((e) => !e.includes('favicon')).slice(0, 3));
await browser.close();
