/* One-shot check (docs in tools/README.md): drive a FRESH run to the tutorial's
 * first Eleanor bubble against a live `pnpm dev`, screenshot the bubble's ring
 * (the Align-Studio talking/blinking split treatment) and report the standee's
 * live texture/animation. Usage:
 *   OUT_DIR=/tmp node tools/checks/anim-bubble.mjs
 */
import { chromium } from '@playwright/test';

const OUT = process.env.OUT_DIR ?? 'test-results';
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));

const sceneIs = async (name, timeout = 30_000) => {
  const t0 = Date.now();
  for (;;) {
    const s = await page.evaluate(() => window.render_game_to_text().scene);
    if (s === name) return;
    if (Date.now() - t0 > timeout) throw new Error(`scene stuck on ${s}, wanted ${name}`);
    await page.waitForTimeout(300);
  }
};

await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render_game_to_text === 'function', null, { timeout: 60_000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render_game_to_text === 'function', null, { timeout: 60_000 });
await sceneIs('TitleScene');
await page.waitForTimeout(1400);
await page.mouse.click(640, 670); // Play
await sceneIs('BoardScene');
await page.waitForTimeout(3500); // arrival beat 1 bubble + talking hold

const info = await page.evaluate(() => {
  const board = window.__emberkeep.game.scene.keys.BoardScene;
  const spr = board?.characterSprites?.get?.('eleanor');
  return {
    step: window.render_game_to_text().tutorial.step,
    standee: spr ? { tex: spr.texture.key, anim: spr.anims?.currentAnim?.key ?? null, playing: !!spr.anims?.isPlaying } : null
  };
});
console.log('INFO:', JSON.stringify(info));
await page.screenshot({ path: `${OUT}/board-full.png` });
await page.screenshot({ path: `${OUT}/bubble.png`, clip: { x: 60, y: 480, width: 980, height: 320 } });
await page.waitForTimeout(3000); // past the talk hold → blinking rest loop
await page.screenshot({ path: `${OUT}/bubble-rest.png`, clip: { x: 60, y: 480, width: 980, height: 320 } });
await browser.close();
console.log('DONE');
