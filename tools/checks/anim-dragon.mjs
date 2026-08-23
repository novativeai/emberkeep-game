/* One-shot check (docs in tools/README.md): shake the dragon clip state
 * machine on a LIVE played save against `pnpm dev` — nap seat/wake recovery,
 * and the flight-over-sleeper race that used to freeze the dragon for a whole
 * nap. localStorage is backed up and restored, so the tester's save survives.
 * Usage:
 *   OUT_DIR=/tmp node tools/checks/anim-dragon.mjs
 */
import { chromium } from '@playwright/test';

const OUT = process.env.OUT_DIR ?? 'test-results';
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));

await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render_game_to_text === 'function', null, { timeout: 60_000 });
const backup = await page.evaluate(() => JSON.stringify(localStorage));

const finish = async (code) => {
  await page.evaluate((snap) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(JSON.parse(snap))) localStorage.setItem(k, v);
  }, backup);
  await browser.close();
  process.exit(code);
};

try {
  // Reach BoardScene (a played save skips the title into the board via Play).
  for (let i = 0; i < 40; i++) {
    const s = await page.evaluate(() => window.render_game_to_text().scene);
    if (s === 'BoardScene') break;
    if (s === 'TitleScene' && i > 4) await page.mouse.click(640, 670);
    await page.waitForTimeout(400);
  }

  const dump = () =>
    page.evaluate(() => {
      const board = window.__emberkeep.game.scene.keys.BoardScene;
      const ld = [...board.liveDragons.values()][0];
      if (!ld) return null;
      const o = ld.clipOverlay;
      return {
        mood: ld.mood,
        sleepState: ld.sleepState,
        flightPhase: ld.flightPhase,
        busy: ld.busy,
        overlay: o
          ? { visible: o.visible, tex: o.texture.key, anim: o.anims?.currentAnim?.key ?? null,
              playing: !!o.anims?.isPlaying, sx: +o.scaleX.toFixed(3), sy: +o.scaleY.toFixed(3) }
          : null,
        rigVisible: ld.player.container.visible
      };
    });

  const until = async (label, pred, ms = 15_000) => {
    const t0 = Date.now();
    for (;;) {
      const d = await dump();
      if (d && pred(d)) { console.log(`${label}: PASS`, JSON.stringify(d)); return d; }
      if (Date.now() - t0 > ms) { console.log(`${label}: FAIL`, JSON.stringify(d)); throw new Error(label); }
      await page.waitForTimeout(250);
    }
  };

  // Rigs attach asynchronously after the board builds — wait for one; if the
  // save is parked on another world, come home first (the whelp lives there).
  let d0 = null;
  for (let i = 0; i < 50 && !d0; i++) {
    d0 = await dump();
    if (!d0 && i === 20) {
      const w = await page.evaluate(() => window.__emberkeep.worlds().active);
      if (w !== 'emberkeep') {
        console.log(`no dragon on "${w}" — switching home`);
        await page.evaluate(() => window.__emberkeep.switchWorld('emberkeep'));
        await page.waitForTimeout(2500);
      }
    }
    if (!d0) await page.waitForTimeout(400);
  }
  if (!d0) { console.log('NO DRAGON on this save — nothing to shake'); await finish(0); }
  console.log('start:', JSON.stringify(d0));

  // 1. March the clock in 30s hops until a nap/night flips the mood asleep,
  //    then assert the seat: frozen LAST tosleep frame, not the rig.
  for (let i = 0; i < 24; i++) {
    const d = await dump();
    if (d.mood === 'asleep') break;
    await page.evaluate(() => window.advanceTime(30_000));
    await page.waitForTimeout(600); // ≥1 life tick
  }
  await until('seated on frozen tosleep frame', (d) =>
    d.mood === 'asleep' && d.sleepState === 'seated' &&
    d.overlay?.visible === true && d.overlay.tex === 'canim_redwhelp_tosleep' &&
    d.overlay.playing === false && d.rigVisible === false);
  await page.screenshot({ path: `${OUT}/dragon-seated.png` });

  // 2. THE OLD WEDGE, injected directly: a flight ordered over the sleeper.
  //    dragonHover must reset the seat, and once the flight visual ends the
  //    watchdog must RE-SEAT — this exact sequence used to freeze forever.
  await page.evaluate(() => {
    const board = window.__emberkeep.game.scene.keys.BoardScene;
    const ld = [...board.liveDragons.values()][0];
    board.dragonHover(ld, 900);
  });
  await until('flight takes the overlay, seat reset', (d) => d.sleepState !== 'seated' || d.flightPhase !== null, 3_000);
  await until('watchdog re-seats the sleeper', (d) =>
    d.sleepState === 'seated' && d.overlay?.tex === 'canim_redwhelp_tosleep' && d.overlay.playing === false, 20_000);

  // 3. Wake: march past the nap/night and assert the atlas idle comes back
  //    (the recovery that used to strand the rig permanently).
  for (let i = 0; i < 24; i++) {
    const d = await dump();
    if (d.mood !== 'asleep') break;
    await page.evaluate(() => window.advanceTime(60_000));
    await page.waitForTimeout(600);
  }
  await until('awake on the atlas idle loop', (d) =>
    d.mood !== 'asleep' && d.sleepState === 'none' &&
    d.overlay?.visible === true && d.overlay.tex === 'canim_redwhelp_idle' && d.overlay.playing === true, 20_000);
  await page.screenshot({ path: `${OUT}/dragon-idle-restored.png` });

  console.log('ALL CHECKS PASSED');
  await finish(0);
} catch (e) {
  console.log('CHECK FAILED:', String(e));
  await page.screenshot({ path: `${OUT}/dragon-fail.png` }).catch(() => {});
  await finish(1);
}
