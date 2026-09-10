/**
 * THE EMPORIUM, PHOTOGRAPHED — the in-game half of the shop change.
 *
 *   node testcapture/capture-emporium.mjs [--out testcapture/shop-tiers/before] [--from free_play]
 *
 * Boots the last recorded beat on the running dev server and opens, through the
 * same bus intents the HUD buttons emit, every in-game surface the four-tier
 * catalog and the 5-day unlimited Warmth touch: the GOLD tab (coin packs), the
 * WARMTH tab (refills), and the cosmetics store (Keeper Looks live there).
 *
 * Standalone, the GOLD tab shows the SHOWCASE (src/data/coin-packs.json); inside
 * the hub it shows the hub's real packs over the postMessage bridge. This bench
 * sees the standalone one — say so beside any shot of it.
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { launch, resolveUrl, bootAt, sleep, settleBubble } from '../scripts/game-harness.mjs';

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const OUT = path.resolve(opt('out', 'testcapture/shop-tiers/before'));
const FROM = opt('from', 'free_play');
mkdirSync(OUT, { recursive: true });

const bus = (page, event, payload) =>
  page.evaluate(([e, p]) => window.__emberkeep.game.registry.get('ctx').bus.emit(e, p), [event, payload]);

/** A dialogue card owns the pointer and the screen — clear it before every shot. */
async function clearBubbles(page, tries = 14) {
  for (let i = 0; i < tries; i++) {
    const up = await page.evaluate(() => !!window.__emberkeep.game.scene.getScene('UIScene')?.bubble?.visible);
    if (!up) return;
    await settleBubble(page);
    await page.mouse.click(750, 725);
    await sleep(420);
  }
}

const shot = async (page, name, note) => {
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const energy = await page.evaluate(() => {
    const s = window.__emberkeep.game.registry.get('ctx').state;
    return `${s.energyCurrent}/${s.energyMax} Warmth · ${s.coins} or`;
  }).catch(() => '');
  console.log(`  ${name.padEnd(28)} ${note} (${energy})`);
};

const url = await resolveUrl(null);
const { browser, page } = await launch({});
try {
  await bootAt(page, url, FROM);
  await sleep(1500);
  await clearBubbles(page);

  // WAIT FOR THE PANEL'S STATE, NOT FOR A CLOCK. Two shots of the first pass lied:
  // asking for the WARMTH tab while GOLD was open photographed a bare board, and the
  // store opened while the Emporium was still fading out, so "Mansion Looks" came
  // back as a double exposure of two panels. Every step now waits for the panel to
  // SAY it is open on the right tab and fully faded in — or fully gone.
  const ui = (fn, arg) => page.evaluate(fn, arg);
  const waitShop = (currency) => page.waitForFunction((c) => {
    const s = window.__emberkeep.game.scene.getScene('UIScene').shop;
    return s.isOpen && s.currency === c && s.visible && s.alpha >= 0.99;
  }, currency, { timeout: 8000 });
  const waitShopGone = () => page.waitForFunction(() => {
    const s = window.__emberkeep.game.scene.getScene('UIScene').shop;
    return !s.isOpen && (!s.visible || s.alpha <= 0.01);
  }, null, { timeout: 8000 });
  const closeShop = async () => {
    await ui(() => window.__emberkeep.game.scene.getScene('UIScene').shop.requestClose('system'));
    await waitShopGone();
  };

  await bus(page, 'ui:shop_requested', { currency: 'coins' });
  await waitShop('coins');
  await shot(page, 'game-emporium-gold', 'onglet GOLD — vitrine autonome (coin-packs.json)');

  await closeShop();
  await clearBubbles(page);
  await bus(page, 'ui:shop_requested', { currency: 'energy' });
  await waitShop('energy');
  await shot(page, 'game-emporium-warmth', 'onglet WARMTH — recharges en or');

  await closeShop();
  await clearBubbles(page);
  await bus(page, 'ui:emporium_requested', {});
  await page.waitForFunction(() => {
    const st = window.__emberkeep.game.scene.getScene('UIScene').store;
    return st.visible && st.alpha >= 0.99;
  }, null, { timeout: 8000 });
  const sections = await ui(() =>
    window.__emberkeep.game.scene.getScene('UIScene').store.sections.map((sec, i) => ({ i, id: sec.id, title: sec.title }))
  );
  for (const sec of sections) {
    if (!['skins', 'dragons', 'keepers'].includes(sec.id)) continue;
    await ui((i) => window.__emberkeep.game.scene.getScene('UIScene').store.showSection(i), sec.i);
    await shot(page, `game-store-${sec.id}`, `boutique — « ${sec.title} »`);
  }

  const errs = await page.evaluate(() => window.__emberkeep.errors());
  console.log(errs.length ? `  ! ${errs.length} erreur(s) page` : '  ✓ aucune erreur page');
} finally {
  await browser.close();
}
