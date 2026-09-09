/**
 * Borealis, band by band — the visual half of the fog-march proof.
 *
 *   node testcapture/capture-borealis.mjs [--out testcapture/<lot>] [--headed]
 *
 * WHY THIS EXISTS
 * ---------------
 * `pnpm beat <step>` only reaches beats the tutorial records, and the tutorial
 * never leaves Emberkeep — so the change with the largest surface in patch 0.92
 * (the coast opening SOUTH first, then north band by band) had no picture at
 * all. The numbers were checked against `build-zones`' own report; this is the
 * other half, and it is the half that catches a band which is whole in the data
 * and sits over open water on screen.
 *
 * It boots the last recorded beat, walks the Keeper to Borealis, and shoots the
 * island once per wave, revealing them in the order the player would:
 *
 *   00 arrival          what the Gold Key is bought for
 *   01 borealis_coast   the key's own deck — five machines and the chest
 *   02 borealis_coast_l4 / 03 _l5 / 04 _l6   rank by rank, marching north
 *   05 borealis_keep    Selyna's door
 *
 * IT REVEALS, IT DOES NOT EARN. `region:reveal` lifts a band without paying its
 * gate, so this proves GEOMETRY — where a band lies and what stands on it — and
 * never that the gate is reachable. `pnpm quests` is what proves reachability.
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch, resolveUrl, bootAt } from '../scripts/game-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const OUT = path.resolve(ROOT, flag('out', 'testcapture/merge-0.92'));
const FROM = flag('from', 'free_play');
const WORLD = flag('world', 'borealis');
/** The waves, in the order the player earns them — the march itself. */
const BANDS = ['borealis_coast', 'borealis_coast_l4', 'borealis_coast_l5', 'borealis_coast_l6', 'borealis_keep'];

mkdirSync(OUT, { recursive: true });

const bus = (page, event, payload) =>
  page.evaluate(
    ([e, p]) => window.__emberkeep.game.registry.get('ctx').bus.emit(e, p),
    [event, payload]
  );

/** What the board says is standing there — the caption for each frame. */
const standing = (page) =>
  page.evaluate(() => {
    const s = window.__emberkeep.game.registry.get('ctx').state;
    const byChain = {};
    for (const it of s.items.values()) byChain[it.chain] = (byChain[it.chain] ?? 0) + 1;
    const bands = [...s.regionStatus.entries()]
      .filter(([id]) => id.startsWith(s.worldId))
      .map(([id, st]) => `${id}:${st}`);
    return { world: s.worldId, level: s.level, items: s.items.size, byChain, bands };
  });

const shot = async (page, name, note) => {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  const s = await standing(page).catch(() => null);
  const chains = s ? Object.entries(s.byChain).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}x${n}`).join(' ') : '';
  console.log(`  ${name.padEnd(24)} ${note}`);
  if (s) console.log(`  ${''.padEnd(24)} ${s.world} · niveau ${s.level} · ${s.items} pièces · ${chains}`);
};

/**
 * THE TRAVEL GATES, opened deliberately rather than worked around.
 *
 * `WorldSystem.switchTo` refuses on four counts (unknown / same / tutorial /
 * level), and the first capture attempt hit the tutorial one silently — the
 * shot came back showing Emberkeep with a level-up flash over it, which looks
 * like a rendering bug and is not one. So: satisfy the gates, then LISTEN for
 * the refusal and say which one fired. A capture that quietly photographs the
 * wrong world is worse than no capture.
 */
const travelTo = async (page, to) => {
  await page.evaluate(() => {
    const ctx = window.__emberkeep.game.registry.get('ctx');
    ctx.state.tutorialDone = true; // the lesson is over by `free_play`; the flag lands on its last tap
  });
  const refusal = await page.evaluate(
    ([target]) =>
      new Promise((resolve) => {
        const ctx = window.__emberkeep.game.registry.get('ctx');
        const off = ctx.bus.on('world:switch_failed', ({ to, reason }) => resolve(`${to}: ${reason}`));
        ctx.bus.emit('world:switch', { to: target });
        setTimeout(() => {
          off?.();
          resolve(null);
        }, 800);
      }),
    [to]
  );
  if (refusal) throw new Error(`world:switch refusé — ${refusal}`);
  const now = await page.evaluate(() => window.__emberkeep.game.registry.get('ctx').state.worldId);
  if (now !== to) throw new Error(`world:switch accepté mais le monde est resté ${now}`);
  // THE VEIL, WAITED OUT RATHER THAN GUESSED. Travel covers the screen until
  // the destination's 2610×1632 backdrop has decoded (`TRAVEL_VEIL_TIMEOUT_MS`
  // is 20 s, and a cold fetch uses a real slice of it). A fixed 2.6 s sleep
  // photographed the veil itself — a purple card reading BOREALIS — six times
  // over. Wait for the paint instead: the veil is gone when the backdrop image
  // is on the board.
  await page.waitForFunction(
    () => {
      const ui = window.__emberkeep.game.scene.getScene('UIScene');
      const veil = ui?.travelVeil;
      return !veil || veil.visible === false || veil.alpha === 0;
    },
    { timeout: 25_000 }
  ).catch(() => console.warn('   (le voile n\'a pas signalé sa levée — capture quand même)'));
  await settle(page, 2500);
};

const settle = (page, ms = 1400) => page.waitForTimeout(ms);

const url = await resolveUrl(flag('url'));
const { browser, page } = await launch({ headed: argv.includes('--headed') });
try {
  console.log(`boot ${FROM} → ${url}`);
  await bootAt(page, url, FROM);
  await settle(page, 2000);

  // Rank enough to clear the destination's cloud level. Granted in one go and
  // then LEFT ALONE: each level-up plays a full-screen flash, and a shot taken
  // during one is a white page — the first run of this script produced exactly
  // that. Six seconds is past the last of them.
  await page.evaluate(() => window.__emberkeep.grantXp(400));
  await settle(page, 6000);

  await travelTo(page, WORLD);
  await shot(page, '00-borealis-arrival', 'ce que la Clé d\'or achète');

  for (const [i, id] of BANDS.entries()) {
    await bus(page, 'region:reveal', { regionId: id });
    await settle(page, 1200);
    // AND LOOK AT IT. The board camera frames one level and does not chase a
    // reveal, so the first run of this loop lifted five bands off-screen and
    // photographed the shore five times — six near-identical frames that would
    // have been read as "nothing changed". Centre on the band's own middle
    // cell, which is also the honest framing: it puts the wave where the eye
    // would go if the player had just earned it.
    const mid = await page.evaluate((regionId) => {
      const s = window.__emberkeep.game.registry.get('ctx').state;
      const world = s.worlds.get(s.worldId);
      const tiles = world?.map?.regions?.find((r) => r.id === regionId)?.tiles ?? [];
      if (!tiles.length) return null;
      const cols = tiles.map((t) => t.col ?? t[0]);
      const rows = tiles.map((t) => t.row ?? t[1]);
      return {
        col: Math.round((Math.min(...cols) + Math.max(...cols)) / 2),
        row: Math.round((Math.min(...rows) + Math.max(...rows)) / 2),
        cells: tiles.length
      };
    }, id);
    if (mid) await page.evaluate(([c, r]) => window.__emberkeep.centerCell(c, r), [mid.col, mid.row]);
    // A cloud does not blink out, it DISSOLVES, and the dissolve is white. Shot
    // too early the frame is a white slab where the new rock should be, which
    // reads as a missing backdrop rather than as weather. Wait it out.
    await settle(page, 4200);
    await shot(
      page,
      `${String(i + 1).padStart(2, '0')}-${id}`,
      `vague ${i + 1}/${BANDS.length}${mid ? ` · ${mid.cells} cellules, centrée sur (${mid.col},${mid.row})` : ' · bande introuvable'}`
    );
  }

  const errs = await page.evaluate(() => window.__emberkeep.errors());
  if (errs?.length) {
    console.error(`\n✗ ${errs.length} erreur(s) attrapée(s) pendant la capture :`);
    for (const e of errs.slice(0, 5)) console.error(`   ${e.message ?? e}`);
    process.exitCode = 1;
  } else {
    console.log(`\n✓ ${BANDS.length + 1} images dans ${path.relative(ROOT, OUT)}, aucune erreur runtime`);
  }
} finally {
  await browser.close();
}
