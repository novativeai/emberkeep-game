/**
 * VFX beat capture + regression.
 *
 * Fires each wired beat in the REAL game and proves the flipbook is on screen —
 * not just that the code path ran. Needs `pnpm dev` (the production bundle
 * mangles the private method these checks call; the shipped-texture check works
 * against either server).
 *
 *   node tools/checks/vfxbeats.mjs [outDir]
 *   VFX_URL=http://localhost:4173/ node tools/checks/vfxbeats.mjs   # built app
 */
import { chromium } from '@playwright/test';

const OUT = process.argv[2] || '/tmp';
// Behavioural checks run against the DEV server: the production bundle mangles
// private method and class names, so `playBeatFX` and `constructor.name` vanish.
// Detection below keys off the pipeline NAME (a runtime string constant), which
// survives minification either way. Point at 4173 to smoke-test the built app.
const URL = process.env.VFX_URL || 'http://localhost:5173/';

const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

const fails = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

await page.goto(URL);
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
// `render_game_to_text` exists from module eval, LONG before PreloadScene has
// finished. Starting BoardScene here races the loader and every texture check
// below reports a false negative — wait for the title to be up first.
await page.waitForFunction(
  () => window.__emberkeep.game.scene.getScene('TitleScene')?.scene.isActive(),
  { timeout: 30000 }
);
await page.evaluate(() => {
  localStorage.clear();
  window.__emberkeep.game.scene.getScene('TitleScene').scene.start('BoardScene');
});
await page.waitForFunction(
  () => window.__emberkeep.game.scene.getScene('BoardScene')?.scene.isActive(),
  { timeout: 30000 }
);
await page.waitForTimeout(1200);
await page.mouse.click(640, 400).catch(() => {});
await page.waitForTimeout(400);

// --- the bank must actually have loaded on the production build -------------
const loaded = await page.evaluate(() => {
  const g = window.__emberkeep.game;
  const want = ['fb_fireburst_pack', 'fb_fireburst_mv', 'fb_dustburst_pack', 'fb_dustburst_mv', 'vfx_ramps'];
  return {
    present: want.filter((k) => g.textures.exists(k)),
    missing: want.filter((k) => !g.textures.exists(k)),
    pipeline: g.renderer.pipelines?.has('FlipbookMV') ?? false
  };
});
console.log('bank textures:', loaded.present.length, '/ 5');
check('all shipped bank textures load', loaded.missing.length === 0, loaded.missing.join(','));

// --- fire each beat and count live FlipbookFX ------------------------------
// Fire at the board camera's centre so the capture is guaranteed on-screen —
// the board camera frames one zone of a 51x24 world, and a world-space guess
// lands outside the viewport more often than not.
const beats = ['hatch', 'elder', 'merge', 'chest'].map((k) => [
  k,
  `const c = board.cameras.main.midPoint; board.playBeatFX('${k}', c.x, c.y);`
]);

for (const [name, body] of beats) {
  const res = await page.evaluate(async ({ body, name }) => {
    const g = window.__emberkeep.game;
    const board = g.scene.getScene('BoardScene');
    // eslint-disable-next-line no-new-func
    const fx = new Function('board', `${body}; return board.playBeatFX ? true : false;`)(board);
    void fx;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const live = board.children.list.filter((c) => c.pipeline?.name === 'FlipbookMV');
    const one = live[live.length - 1];
    return {
      name,
      spawned: live.length > 0,
      pipeline: one?.pipeline?.name ?? one?.defaultPipeline?.name ?? null,
      blend: one?.blendMode,
      depth: one?.depth,
      size: one ? [Math.round(one.displayWidth), Math.round(one.displayHeight)] : null,
      pos: one ? [Math.round(one.x), Math.round(one.y)] : null,
      data: one ? { rampV: one.pipelineData.rampV, useMV: one.pipelineData.useMV, mvScale: one.pipelineData.mvScale } : null
    };
  }, { body, name });

  check(`${name}: flipbook spawned`, res.spawned, JSON.stringify(res.size));
  check(`${name}: uses the MV pipeline`, res.pipeline === 'FlipbookMV', String(res.pipeline));
  check(`${name}: ADD blend`, res.blend === 1, String(res.blend));
  check(`${name}: motion vectors on`, res.data?.useMV === 1);
  console.log(`        pos ${JSON.stringify(res.pos)} size ${JSON.stringify(res.size)} depth ${res.depth} rampV ${res.data?.rampV}`);

  await page.waitForTimeout(120);
  await page.screenshot({ path: `${OUT}/BEAT-${name}.png` });
  // let the one-shot finish and self-destroy before the next beat
  await page.waitForTimeout(1200);
}

// --- one-shots must clean themselves up ------------------------------------
const leftover = await page.evaluate(() => {
  const board = window.__emberkeep.game.scene.getScene('BoardScene');
  return board.children.list.filter((c) => c.pipeline?.name === 'FlipbookMV').length;
});
check('one-shots self-destroy (no leaked GameObjects)', leftover === 0, `${leftover} left`);

// --- dozing must suppress the effect ---------------------------------------
const dozed = await page.evaluate(async () => {
  const g = window.__emberkeep.game;
  const board = g.scene.getScene('BoardScene');
  const prev = board.power?.state;
  if (board.power) board.power.state = 'doze';
  board.playBeatFX('hatch', 1280, 900);
  await new Promise((r) => requestAnimationFrame(r));
  const n = board.children.list.filter((c) => c.pipeline?.name === 'FlipbookMV').length;
  if (board.power) board.power.state = prev;
  return n;
});
check('doze suppresses the flipbook', dozed === 0, `${dozed} spawned while dozing`);

const real = errs.filter((e) => !e.includes('favicon'));
check('no console errors', real.length === 0, real.slice(0, 3).join(' | '));

await browser.close();
console.log(`\nscreenshots -> ${OUT}/BEAT-*.png`);
console.log(fails.length ? `${fails.length} FAILED: ${fails.join(', ')}` : 'all beat checks passed');
process.exit(fails.length ? 1 : 0);
