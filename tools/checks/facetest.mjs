/**
 * Visual proof for the head-animation integration: spawns a live rigged Red
 * Dragon on the board, zooms the camera onto it, then screenshots the SAME
 * paused pose wearing base / blink-closed / talk-half / talk-wide faces.
 * Any scale or position drift between the shots would be a regression.
 *
 * Needs the production preview running (same as e2e):
 *   pnpm build && pnpm exec vite preview   # port 4173
 * Run: node tools/checks/facetest.mjs [outDir]
 */
import { chromium } from '@playwright/test';

const OUT = process.argv[2] ?? '/tmp';
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

await page.goto('http://localhost:4173/');
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.waitForTimeout(400);
await page.evaluate(() => window.__emberkeep.game.scene.getScene('TitleScene').scene.start('BoardScene'));
await page.waitForTimeout(1500);

// Spawn a Red Dragon (tier 3 = rig-wearing generator) through the bus — the
// same path any real spawn takes — then wait for the lazy rig fetch + attach.
await page.evaluate(() => {
  const ctx = window.__emberkeep.game.registry.get('ctx');
  ctx.bus.emit('board:spawn', { chain: 'ember_dragon', tier: 3, count: 1 });
});
await page.waitForFunction(() => {
  const sc = window.__emberkeep.game.scene.getScene('BoardScene');
  return sc.liveDragons && sc.liveDragons.size > 0;
}, undefined, { timeout: 15000 });
await page.waitForTimeout(600); // face textures load in the same queue; settle

const state = await page.evaluate(() => {
  const sc = window.__emberkeep.game.scene.getScene('BoardScene');
  const ld = [...sc.liveDragons.values()][0];
  const hasFace = !!ld.player.face;
  const sets = hasFace ? Object.keys(ld.player.face.doc.sets) : [];
  // Neutral, frozen pose: stop the preset, zero the head rotation.
  ld.player.play('');
  const { col, row } = ld.host;
  const cam = sc.cameras.main;
  cam.setZoom(cam.zoom * 3);
  window.__emberkeep.centerCell(col, row);
  return { hasFace, sets, col, row };
});
if (!state.hasFace) {
  console.error('FAIL: no face attached to the live dragon', errs);
  process.exit(1);
}
await page.waitForTimeout(300);

const rect = await page.evaluate(({ col, row }) => {
  const p = window.__emberkeep.gridToPage(col, row);
  return { x: Math.max(0, p.x - 190), y: Math.max(0, p.y - 330), width: 380, height: 400 };
}, state);

// Freeze the scene so the paused pose is identical across all four shots.
await page.evaluate(() => window.__emberkeep.game.scene.pause('BoardScene'));

const WEAR = [
  ['face-base', null],
  ['face-blink-closed', { setKey: 'blink', frameIndex: 2 }],
  ['face-talk-half', { setKey: 'talk', frameIndex: 1 }],
  ['face-talk-wide', { setKey: 'talk', frameIndex: 2 }]
];
for (const [name, sel] of WEAR) {
  await page.evaluate((s) => {
    const sc = window.__emberkeep.game.scene.getScene('BoardScene');
    const ld = [...sc.liveDragons.values()][0];
    ld.player.applyFace(s);
  }, sel);
  await page.waitForTimeout(120); // one render tick while paused (render continues)
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: rect });
  console.log(`shot ${OUT}/${name}.png`);
}

console.log('face sets attached:', state.sets.join(', '));
if (errs.length) console.log('console errors:', errs);
await browser.close();
process.exit(errs.length ? 1 : 0);
