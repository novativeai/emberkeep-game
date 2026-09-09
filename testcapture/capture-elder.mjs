/**
 * Does the Golden Elder actually wake? — the finale, watched rather than read.
 *
 *   node testcapture/capture-elder.mjs [--url <prod or preview>] [--out <dir>]
 *
 * The awakening rides the RANK that opens Borealis: StorySystem emits
 * `story:elder_wakes` exactly once when the Keeper's level reaches the north's
 * own `level` (3), latches `ELDER_WOKEN_STAT`, and BoardScene runs the finale —
 * camera to the altar, the egg cracks, she speaks, Eleanor opens the Gate.
 *
 * Four things can each swallow that on their own, and none of them throws:
 *
 *   1. `wakeElderForRank` refuses on `!tutorialDone`
 *   2. …or on either latch already being set (the ceremony "already played")
 *   3. …or on `state.level < borealis.level`
 *   4. the fact fires while nothing is subscribed, and the ceremony is simply
 *      never seen — the latch is set, so it can never fire again either
 *
 * So this reports the GATES first and the picture second: it prints the four
 * inputs before the grant, taps every relevant bus fact as it lands, and only
 * then photographs the altar. A screenshot of an egg tells you she did not
 * appear; it does not tell you which of the four stopped her.
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch, resolveUrl, loadCheckpoint } from '../scripts/game-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const OUT = path.resolve(ROOT, flag('out', 'testcapture/elder'));
const FROM = flag('from', 'free_play');
mkdirSync(OUT, { recursive: true });

const settle = (page, ms = 1500) => page.waitForTimeout(ms);

/** The four gates of `wakeElderForRank`, read straight off the live state. */
const gates = (page) =>
  page.evaluate(() => {
    const ctx = window.__emberkeep.game.registry.get('ctx');
    const s = ctx.state;
    const board = window.__emberkeep.game.scene.getScene('BoardScene');
    return {
      world: s.worldId,
      tutorialDone: s.tutorialDone,
      level: s.level,
      xp: s.xp,
      borealisLevel: s.worlds.get('borealis')?.level ?? null,
      elderWoken: s.stat('story:elder_woken'),
      legacyLatch: s.stat('q:done:keepers_hoard'),
      // What the altar is actually showing right now.
      altarEgg: !!board?.altarEgg,
      altarElder: !!board?.altarElder,
      errors: window.__emberkeep.errors().length
    };
  });

const show = (label, g) => {
  console.log(`\n── ${label}`);
  console.log(`   monde ${g.world} · tutorialDone ${g.tutorialDone} · niveau ${g.level} (${g.xp} XP) · seuil borealis ${g.borealisLevel}`);
  console.log(`   latch story:elder_woken = ${g.elderWoken} · legacy q:done:keepers_hoard = ${g.legacyLatch}`);
  console.log(`   AUTEL : oeuf=${g.altarEgg} ancienne=${g.altarElder} · erreurs runtime ${g.errors}`);
};

/**
 * Boot patiently. `game-harness.bootAt` hard-codes a 30 s scene timeout, which
 * is plenty for `vite preview` on this machine and NOT enough for production:
 * the deployed game pulls ~175 MB of art over the network before TitleScene
 * answers, and the harness reported that as "the board never booted". Same
 * sequence, generous clocks, so the thing under test is the DEPLOYED build and
 * not a local stand-in for it.
 */
const bootAtPatiently = async (page, url, id, budgetMs) => {
  const { blob, saveKey } = loadCheckpoint(id);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: budgetMs });
  await page.evaluate(([k, b]) => { localStorage.clear(); localStorage.setItem(k, b); }, [saveKey, blob]);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: budgetMs });
  const onScene = (name) =>
    page.waitForFunction((s) => {
      if (typeof window.render_game_to_text !== 'function') return false;
      const r = window.render_game_to_text();
      return (typeof r === 'string' ? JSON.parse(r) : r).scene === s;
    }, name, { timeout: budgetMs });
  await onScene('TitleScene');
  await settle(page, 1600);
  await page.mouse.click(640, 670);
  await onScene('BoardScene');
  await settle(page, 1600);
};

const url = await resolveUrl(flag('url'));
const BUDGET = Number(flag('budget', url.startsWith('http://localhost') ? '45000' : '180000'));
const { browser, page } = await launch({ headed: argv.includes('--headed') });
const heard = [];
try {
  console.log(`boot ${FROM} → ${url}`);
  await bootAtPatiently(page, url, FROM, BUDGET);
  await settle(page, 2500);

  // Tap the bus BEFORE anything can fire, and keep the log on the page so a
  // reload would lose it rather than silently keep a stale one.
  await page.evaluate(() => {
    const ctx = window.__emberkeep.game.registry.get('ctx');
    window.__heard = [];
    for (const e of ['keeper:leveled', 'story:elder_wakes', 'story:beats_finished', 'quest:completed', 'world:switched']) {
      ctx.bus.on(e, (p) => window.__heard.push({ e, p: JSON.stringify(p ?? {}).slice(0, 120) }));
    }
  });

  show('AVANT', await gates(page));
  await page.screenshot({ path: path.join(OUT, '0-avant.png') });

  // The lesson is over at `free_play` — the flag lands on its last tap, which
  // the checkpoint is saved just BEFORE. Without it gate 1 refuses silently.
  await page.evaluate(() => {
    window.__emberkeep.game.registry.get('ctx').state.tutorialDone = true;
  });

  // Cross the rank. 220 XP is level 3; grant past it and let the flash finish.
  console.log('\n   … grantXp(400) pour franchir le rang 3');
  await page.evaluate(() => window.__emberkeep.grantXp(400));
  await settle(page, 8000);

  heard.push(...(await page.evaluate(() => window.__heard)));
  show('APRÈS le passage de niveau', await gates(page));
  await page.screenshot({ path: path.join(OUT, '1-apres-levelup.png') });

  console.log('\n── faits entendus sur le bus');
  if (!heard.length) console.log('   (aucun)');
  for (const h of heard) console.log(`   ${h.e}  ${h.p}`);

  // Frame the altar itself, wherever the finale left the camera.
  await page.evaluate(() => window.__emberkeep.centerCell(-2, 2));
  await settle(page, 3000);
  await page.screenshot({ path: path.join(OUT, '2-autel.png') });
  const after = await gates(page);
  show('AUTEL cadré', after);

  const verdict = after.altarElder
    ? '✓ l\'Ancienne d\'Or se tient sur l\'autel'
    : `✗ ELLE N'EST PAS LÀ — oeuf=${after.altarEgg}, latch=${after.elderWoken}, niveau=${after.level}/${after.borealisLevel}`;
  console.log(`\n${verdict}`);
  console.log(`images : ${path.relative(ROOT, OUT)}`);
  if (!after.altarElder) process.exitCode = 1;
} finally {
  await browser.close();
}
