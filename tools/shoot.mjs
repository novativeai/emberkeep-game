/**
 * Throwaway capture helper — reliable page.screenshot() on the preview build
 * (the MCP screenshot tool can't settle on the animated canvas).
 *   node tools/shoot.mjs <scenario> <outPath>
 * scenarios: bubble | dragon
 */
import { chromium } from '@playwright/test';

const [, , scenario, out, sy, dy, head] = process.argv;
const URL = 'http://localhost:4173/';
const POSE = { sy: +sy || 1.007, dy: dy !== undefined ? +dy : -1.4, head: head !== undefined ? +head : 2.2 };

const browser = await chromium.launch({
  args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await page.goto(URL);
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.evaluate(() => {
  localStorage.clear();
  window.__emberkeep.game.scene.getScene('TitleScene').scene.start('BoardScene');
});
await page.waitForTimeout(700);

if (scenario === 'dragon') {
  await page.evaluate(() => {
    const ctx = window.__emberkeep.game.registry.get('ctx');
    const cell = ctx.state.freeActiveTilesNear(4, 7)[0];
    ctx.systems.board.spawn('ember_dragon', 3, cell.col, cell.row, 'init'); // whelp = bigger
    const iso = (c, r) => ({ x: 2560 / 2 + (c - r) * 256 / 2, y: 316 + (c + r) * 128 / 2 });
    const w = iso(cell.col, cell.row);
    const cam = window.__emberkeep.game.scene.getScene('BoardScene').cameras.main;
    cam.setZoom(2.6);
    cam.centerOn(w.x, w.y - 90);
  });
  // wait for the rig to load, then freeze at the idle breathing PEAK
  await page.waitForTimeout(2500);
  await page.evaluate((pose) => {
    const scene = window.__emberkeep.game.scene.getScene('BoardScene');
    const ld = [...scene.liveDragons.values()][0];
    if (ld) {
      scene.scene.pause('BoardScene');
      ld.player.applyPose({
        root: { dy: pose.dy, rotDeg: 0, sx: 1, sy: pose.sy },
        partDeg: { head: pose.head, tail: 5.8, wing_left: 2.3, wing_right: -2.3 },
        eyelid: 1
      });
    }
  }, POSE);
  await page.waitForTimeout(200);
}

await page.screenshot({ path: out });
await browser.close();
console.log('shot →', out);
