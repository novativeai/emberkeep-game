/**
 * SHOPCHECK — the four Gold tiers and Unlimited Warmth, photographed (G1–G16).
 *
 *   node tools/checks/shopcheck.mjs [--url http://localhost:5173] [--out testcapture/shop-tiers/after/game]
 *
 * Runs against a `pnpm dev` that is ALREADY up (it never starts one — port 5173
 * is strict). Every browser context is fresh, so the owner's own localStorage is
 * never read or written; each run seeds `tests/e2e/checkpoints/64-free_play.json`
 * into `emberkeep_save` itself.
 *
 * THE FAKE HUB. `/__iaphost.html` does not exist on the dev server: it is served
 * by `context.route` from this file, SAME ORIGIN, and iframes `/`. That makes the
 * game `iapBridge.isEmbedded()` for real, and the host plays the hub's side of the
 * bridge contract to the letter:
 *   - answers `embergames:iap:catalog_request` with the four bridge packs
 *     (`?delay=1` holds the catalog until `__host.sendCatalog()`),
 *   - records `embergames:iap:ready` and RE-SENDS every un-acked result on it,
 *   - posts `embergames:iap:result` (status completed) on `__host.result(id, pack)`,
 *   - records `embergames:iap:ack`.
 *
 * Each state is one PNG plus a line of measured facts on stdout. A state whose
 * checks fail is still photographed (the picture is the evidence); a state that
 * could not be driven at all is reported as NOT PRODUCED with the reason.
 * One browser at a time; it is closed on the way out, whatever happened.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const BASE = opt('url', 'http://localhost:5173').replace(/\/$/, '');
const OUT = path.resolve(ROOT, opt('out', 'testcapture/shop-tiers/after/game'));
const CP = JSON.parse(readFileSync(path.join(ROOT, 'tests/e2e/checkpoints/64-free_play.json'), 'utf8'));
mkdirSync(OUT, { recursive: true });

const DAY = 86_400_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The hub's `bridgeCatalog()` for a game that supports every grant key. */
const PACKS = [
  { id: 'gold_pouch', name: 'Pouch of Gold', blurb: 'A first handful of Gold for the Emporium.', amountEur: 2.5, coins: 250, keys: 0, energy: 0, unlimitedWarmthMs: 0 },
  { id: 'gold_chest', name: 'Chest of Gold', blurb: 'A chest of Gold with a 10% bonus inside.', amountEur: 10, coins: 1100, keys: 0, energy: 0, unlimitedWarmthMs: 0 },
  { id: 'gold_coffer', name: 'Keeper’s Coffer', blurb: 'A Keeper’s store of Gold with a 20% bonus.', amountEur: 25, coins: 3000, keys: 0, energy: 0, unlimitedWarmthMs: 0 },
  { id: 'hearth_hoard', name: 'Hearth Hoard', blurb: 'The biggest Gold pack, plus 5 days of Unlimited Warmth.', amountEur: 100, coins: 13000, keys: 0, energy: 0, unlimitedWarmthMs: 5 * DAY }
];

const HOST = `<!doctype html><html><head><meta charset="utf-8"><title>fake hub</title>
<style>html,body{margin:0;height:100%;background:#111;overflow:hidden}iframe{border:0;width:100vw;height:100vh;display:block}</style>
</head><body><iframe id="game" src="/"></iframe><script>
(() => {
  const PACKS = ${JSON.stringify(PACKS)};
  const q = new URLSearchParams(location.search);
  const h = (window.__host = { log: [], ready: 0, acks: [], requests: [], outstanding: new Map() });
  const frame = () => document.getElementById('game').contentWindow;
  const send = (m) => frame().postMessage(m, location.origin);
  h.sendCatalog = () => send({ type: 'embergames:iap:catalog', packs: PACKS });
  h.result = (purchaseId, packId) => {
    const p = PACKS.find((x) => x.id === packId);
    const m = { type: 'embergames:iap:result', purchaseId, packId, name: p.name, status: 'completed',
      coins: p.coins, keys: p.keys, energy: p.energy, unlimitedWarmthMs: p.unlimitedWarmthMs };
    h.outstanding.set(purchaseId, m);
    send(m);
  };
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== frame()) return;
    const d = e.data;
    if (!d || typeof d.type !== 'string' || !d.type.startsWith('embergames:')) return;
    h.log.push(d.type);
    if (d.type === 'embergames:iap:catalog_request') {
      h.requests.push(d);
      if (q.get('delay') !== '1') h.sendCatalog();
    } else if (d.type === 'embergames:iap:ready') {
      h.ready++;
      for (const m of h.outstanding.values()) send(m);
    } else if (d.type === 'embergames:iap:ack') {
      h.acks.push(d.purchaseId);
      h.outstanding.delete(d.purchaseId);
    }
  });
})();
</script></body></html>`;

/** In-page helpers, installed into EVERY frame (the game runs top-level or framed). */
function installHelpers() {
  const sc = {
    game: () => window.__emberkeep.game,
    ctx: () => window.__emberkeep.game.registry.get('ctx'),
    ui: () => window.__emberkeep.game.scene.getScenes(true).find((s) => s.hud && s.shop),
    board: () => window.__emberkeep.game.scene.getScenes(true).find((s) => s.itemSprites && typeof s.onItemTapped === 'function'),
    rtt: () => {
      const r = window.render_game_to_text();
      return typeof r === 'string' ? JSON.parse(r) : r;
    },
    texts: (scene) => {
      const out = [];
      const walk = (o) => {
        if (o.type === 'Text' && o.visible !== false) out.push(o);
        (o.list || []).forEach(walk);
      };
      (scene?.children.list || []).forEach(walk);
      return out;
    },
    regen: () => {
      const l = sc.ui()?.hud?.regenLabel;
      return l ? { text: l.text, visible: l.visible } : null;
    },
    /** A shelf, measured: row centres/scale, the air above and below the stack, every string. */
    shelf: () => {
      const shop = sc.ui().shop;
      const rows = shop.shelf.list.filter((o) => o.type === 'Container');
      const SHELF_TOP = -280, SHELF_H = 928, ROW_H = 224;
      const strings = (o) => {
        const out = [];
        const walk = (x) => { if (x.type === 'Text') out.push(x.text); (x.list || []).forEach(walk); };
        walk(o);
        return out;
      };
      const textures = (o) => (o.list || []).filter((x) => x.type === 'Image').map((x) => x.texture.key);
      const loose = shop.shelf.list.filter((o) => o.type === 'Text').map((t) => t.text);
      const open = shop.isOpen === true && shop.visible === true;
      if (rows.length === 0) return { rows: 0, loose, open };
      const s = rows[0].scaleX;
      return {
        rows: rows.length,
        scale: +s.toFixed(3),
        airTop: +((rows[0].y - (ROW_H * s) / 2) - SHELF_TOP).toFixed(1),
        airBottom: +((SHELF_TOP + SHELF_H) - (rows.at(-1).y + (ROW_H * s) / 2)).toFixed(1),
        hot: rows.filter((r) => textures(r).includes('ui_shop_card_hot')).length,
        lines: rows.map(strings),
        loose,
        open
      };
    },
    /** Tap row i's price plate exactly as a pointer would (its bg carries the handler). */
    tapPlate: (i) => {
      const rows = sc.ui().shop.shelf.list.filter((o) => o.type === 'Container');
      const plate = rows[i].list[rows[i].list.length - 1];
      plate.list[0].emit('pointerup');
    },
    /** An ember_dragon t3 on the board — the checkpoint's own one leaves after the
     *  tutorial hands the board back, so the bench brings its own when needed. */
    ensureDragon: () => {
      const ctx = sc.ctx();
      const have = [...ctx.state.items.values()].find((i) => i.kind === 'item' && i.chain === 'ember_dragon' && i.tier === 3);
      if (have) return have;
      const anchor = [...ctx.state.items.values()].find((i) => i.chain === 'lumber' && i.tier === 3) ?? { col: 5, row: 5 };
      const c = ctx.state.freeActiveTilesNear(anchor.col, anchor.row)[0];
      ctx.systems.board.spawn('ember_dragon', 3, c.col, c.row, 'init');
      return [...ctx.state.items.values()].filter((i) => i.chain === 'ember_dragon' && i.tier === 3).sort((a, b) => b.id - a.id)[0];
    },
    removed: [],
    watchRemovals: () => {
      if (sc._watching) return;
      sc._watching = true;
      sc.ctx().bus.on('item:removed', (p) => sc.removed.push(JSON.parse(JSON.stringify(p ?? {}))));
    },
    pressPlay: () => {
      const t = window.__emberkeep.game.scene.getScene('TitleScene');
      const play = t.children.list.find((o) => o.type === 'Container' && o.input && o.width === 232 && o.height === 232);
      if (!play) throw new Error('Play button not found on the Title');
      play.emit('pointerup');
    },
    dialog: () => {
      const d = sc.ui().iapDialog;
      if (!d) return null;
      const texts = [];
      const walk = (x) => {
        if (x.type === 'Text') {
          const b = x.getBounds();
          texts.push({ text: x.text, y: Math.round(x.y), top: Math.round(b.top - d.y), bottom: Math.round(b.bottom - d.y), w: Math.round(b.width) });
        }
        (x.list || []).forEach(walk);
      };
      walk(d);
      return texts;
    }
  };
  window.__sc = sc;
}

const results = [];
function report(name, produced, checks, detail) {
  const failed = Object.entries(checks || {}).filter(([, v]) => v !== true).map(([k]) => k);
  results.push({ name, produced, failed, detail });
  const tag = !produced ? 'NOT PRODUCED' : failed.length ? `CHECKS FAILED: ${failed.join(', ')}` : 'ok';
  console.log(`${name.padEnd(28)} ${tag}${detail ? `  ${JSON.stringify(detail).slice(0, 900)}` : ''}`);
}

/** Drive one state: `fn` returns `{ checks, detail }`; the PNG is taken either way. */
/**
 * THE PHOTO MUST BE OF THE FRAME THE CHECKS READ.
 *
 * The first run photographed old frames: a panel at half alpha, a banner mid-fade,
 * a HUD pill still reading 28/30 while its own text object said 19/33. None of it
 * was the game — it was PowerGovernor. Bus-driven actions are not pointer input, so
 * the board dozes at its lowest fps and the canvas keeps showing whatever it last
 * drew. So before every screenshot: nudge the governor the way a real pointer
 * would, then wait until the loop has actually stepped a few frames.
 */
let CURRENT = null;
async function settle(minMs = 350) {
  if (!CURRENT) return;
  await CURRENT.evaluate(async (wait) => {
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    const loop = window.__emberkeep.game.loop;
    const f0 = loop.frame;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = () =>
        (loop.frame >= f0 + 4 && performance.now() - t0 >= wait) || performance.now() - t0 > 4000
          ? resolve()
          : requestAnimationFrame(tick);
      tick();
    });
  }, minMs).catch(() => {});
}

async function shot(page, name, fn) {
  let out = { checks: {}, detail: undefined };
  try {
    out = (await fn()) ?? out;
  } catch (e) {
    try { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); } catch {}
    report(name, false, {}, { error: String(e?.message ?? e).split('\n')[0].slice(0, 400) });
    return;
  }
  try {
    await settle();
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    report(name, true, out.checks, out.detail);
  } catch (e) {
    report(name, false, {}, { error: `screenshot: ${String(e?.message ?? e).slice(0, 200)}` });
  }
}

const gameFrame = (page, hub) => {
  if (!hub) return page.mainFrame();
  const f = page.frames().find((fr) => fr !== page.mainFrame() && fr.url().startsWith(`${BASE}/`) && !fr.url().includes('__iaphost'));
  if (!f) throw new Error('game iframe not found');
  return f;
};

async function newContext(browser, profile) {
  const context = await browser.newContext(profile);
  await context.addInitScript(installHelpers);
  await context.route((url) => url.pathname === '/__iaphost.html', (r) => r.fulfill({ contentType: 'text/html', body: HOST }));
  await context.route((url) => url.pathname === '/__blank.html', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>blank</title>' }));
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  return { context, page };
}

/** Seed the free_play checkpoint (same origin, before the game reads it). */
async function seed(page) {
  await page.goto(`${BASE}/__blank.html`);
  await page.evaluate(([k, b]) => { localStorage.clear(); localStorage.setItem(k, b); }, [CP.saveKey, CP.blob]);
}

/** Load the page, wait for the Title, press Play, wait for the board and the UI. */
async function boot(page, { hub = false, query = '' } = {}) {
  await page.goto(hub ? `${BASE}/__iaphost.html${query}` : `${BASE}/`);
  let g;
  const t0 = Date.now();
  while (!g) {
    try { g = gameFrame(page, hub); } catch { if (Date.now() - t0 > 20000) throw new Error('no game frame'); await sleep(200); }
  }
  await g.waitForFunction(() => typeof window.render_game_to_text === 'function' && window.__sc && window.__sc.rtt().scene === 'TitleScene', null, { timeout: 90000 });
  await sleep(1400);
  await g.evaluate(() => window.__sc.pressPlay());
  await g.waitForFunction(() => window.__sc.rtt().scene === 'BoardScene' && !!window.__sc.ui(), null, { timeout: 120000 });
  await g.evaluate(() => window.__sc.watchRemovals());
  await sleep(2500);
  CURRENT = g;
  return g;
}

/** The checkpoint sits on `free_play` (a tap gate): answer it, so checkout is open. */
async function finishTutorial(g) {
  await g.evaluate(() => {
    const r = window.__sc.rtt();
    if (!r.tutorial.done) window.__sc.ctx().bus.emit('tutorial:advance_requested', { stepId: r.tutorial.step });
  });
  await sleep(900);
  return g.evaluate(() => window.__sc.rtt().tutorial);
}

const openShop = (g, currency) =>
  g.evaluate((c) => {
    const shop = window.__sc.ui().shop;
    if (shop.isOpen) shop.showCurrency(c);
    else window.__sc.ctx().bus.emit('ui:shop_requested', { currency: c });
  }, currency).then(() => sleep(600));
const closeShop = (g) => g.evaluate(() => window.__sc.ui().shop.requestClose('system')).then(() => sleep(400));

/**
 * WAIT OUT THE STORY BEFORE OPENING A PANEL TO PHOTOGRAPH.
 *
 * A story line or the finale clears the stage, and clearing the stage closes
 * the Emporium on purpose (UIScene.runFinaleUi: `shop.requestClose('system')`).
 * The first run opened the WARMTH shelf into exactly that moment: the shelf
 * measured fine and the photo showed the board under Eleanor's line. Tap the
 * ring the way a player does until nothing owns the stage.
 */
async function clearStage(page, g, maxMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const st = await g
      .evaluate(() => {
        const ui = window.__sc.ui();
        return { bubble: !!ui?.bubble?.visible, finale: !!ui?.finaleActive && !ui?.finaleReleased };
      })
      .catch(() => ({ bubble: false, finale: false }));
    if (!st.bubble && !st.finale) return true;
    if (st.bubble) await page.mouse.click(750, 725);
    await sleep(500);
  }
  return false;
}

const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const EXPECT_PRICES = ['€2.50', '€10', '€25', '€100'];
const shelfChecks = (s) => ({
  fourRows: s.rows === 4,
  equalAir: Math.abs((s.airTop ?? 0) - (s.airBottom ?? 999)) <= 2,
  prices: EXPECT_PRICES.every((p, i) => (s.lines?.[i] ?? []).includes(p)),
  bonuses: ['+10% BONUS', '+20% BONUS', '+30% BONUS'].every((b, i) => (s.lines?.[i + 1] ?? []).includes(b)),
  hoardThirdLine: (s.lines?.[3] ?? []).includes('⚡ +5 days of Unlimited Warmth'),
  noHotCard: s.hot === 0,
  panelOpen: s.open === true
});

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-gpu', `--use-angle=${process.platform === 'darwin' ? 'metal' : 'swiftshader'}`, '--ignore-gpu-blocklist']
});
try {
  /* ------------------------------------------------ standalone (DEV), desktop */
  {
    const { context, page } = await newContext(browser, DESKTOP);
    try {
      await seed(page);
      const g = await boot(page);
      const tut = await finishTutorial(g);
      await shot(page, 'G01-gold-shelf-desktop', async () => {
        await openShop(g, 'coins');
        const s = await g.evaluate(() => window.__sc.shelf());
        return { checks: { tutorialDone: tut.done === true, ...shelfChecks(s) }, detail: s };
      });
      await shot(page, 'G03-warmth-shelf', async () => {
        await g.evaluate(() => window.__sc.ctx().bus.emit('energy:set', { value: 12, reason: 'shopcheck' }));
        await openShop(g, 'energy');
        const s = await g.evaluate(() => window.__sc.shelf());
        return { checks: { threeRows: s.rows === 3, panelOpen: s.open === true }, detail: s };
      });
      await shot(page, 'G03-full-bar-refused', async () => {
        const before = await g.evaluate(() => {
          window.__sc.ctx().bus.emit('energy:refill', { reason: 'shopcheck' });
          const st = window.__sc.ctx().state;
          return { coins: st.coins, energy: st.energyCurrent, max: st.energyMax };
        });
        await g.evaluate(() => window.__sc.tapPlate(0));
        await sleep(150);
        const after = await g.evaluate(() => {
          const st = window.__sc.ctx().state;
          return { coins: st.coins, energy: st.energyCurrent, open: window.__sc.ui().shop.isOpen };
        });
        return {
          checks: { atMax: before.energy === before.max, coinsUnchanged: after.coins === before.coins, stillOpen: after.open },
          detail: { before, after }
        };
      });
    } catch (e) {
      report('standalone-desktop', false, {}, { error: String(e?.message ?? e).slice(0, 300) });
    } finally {
      await context.close();
    }
  }

  /* ------------------------------------------------ standalone (DEV), mobile */
  {
    const { context, page } = await newContext(browser, MOBILE);
    try {
      await seed(page);
      const g = await boot(page);
      await finishTutorial(g);
      await shot(page, 'G02-gold-shelf-mobile', async () => {
        await openShop(g, 'coins');
        const s = await g.evaluate(() => window.__sc.shelf());
        return { checks: shelfChecks(s), detail: s };
      });
    } catch (e) {
      report('standalone-mobile', false, {}, { error: String(e?.message ?? e).slice(0, 300) });
    } finally {
      await context.close();
    }
  }

  /* ------------------------------------------------ fake hub, desktop */
  {
    const { context, page } = await newContext(browser, DESKTOP);
    const host = (fn, ...a) => page.evaluate(fn, ...a);
    try {
      await seed(page);
      let g = await boot(page, { hub: true, query: '?delay=1' });
      await finishTutorial(g);

      await shot(page, 'G04-loading-packs', async () => {
        await openShop(g, 'coins');
        const s = await g.evaluate(() => window.__sc.shelf());
        const req = await host(() => window.__host.requests[0] ?? null);
        return {
          checks: {
            loading: (s.loose ?? []).includes('Loading packs…'),
            grantsHandshake: JSON.stringify(req?.grants) === JSON.stringify(['coins', 'keys', 'energy', 'unlimitedWarmthMs'])
          },
          detail: { shelf: s, request: req }
        };
      });
      await shot(page, 'G04-catalog-arrived', async () => {
        await host(() => window.__host.sendCatalog());
        await sleep(600);
        const s = await g.evaluate(() => window.__sc.shelf());
        return { checks: shelfChecks(s), detail: s };
      });
      await closeShop(g);

      const confirmChecks = (d) => ({
        open: Array.isArray(d),
        cardTall: true,
        goldLine: !!d?.some((t) => t.text === '◎ +13,000 Gold'),
        warmthLine: !!d?.some((t) => /^⚡ (\+)?5 days/.test(t.text)),
        disclosure4: !!d?.some((t) => t.text.split('\n').length === 4),
        price: !!d?.some((t) => t.text === '€100'),
        buy: !!d?.some((t) => t.text === 'Buy €100')
      });
      await shot(page, 'G05-confirm-hoard-desktop', async () => {
        await g.evaluate(() => window.__sc.ctx().bus.emit('ui:iap_buy_requested', { packId: 'hearth_hoard' }));
        await sleep(500);
        const d = await g.evaluate(() => window.__sc.dialog());
        return { checks: confirmChecks(d), detail: d };
      });
      await g.evaluate(() => window.__sc.ui().closeIapDialog());

      await shot(page, 'G06-purchase-banner', async () => {
        const ready = await host(() => window.__host.ready);
        await host(() => window.__host.result('p_hoard_1', 'hearth_hoard'));
        await sleep(700);
        const facts = await g.evaluate(() => {
          const ui = window.__sc.ui();
          const banner = ui.children.list.find((o) => o.type === 'Container' && (o.list || []).some((t) => t.text === 'PURCHASE COMPLETE!'));
          const sub = banner?.list?.[2];
          const quote = banner?.list?.find((t, i) => i > 2 && t.type === 'Text');
          const r = window.__sc.rtt();
          return {
            subWidth: sub ? Math.round(sub.displayWidth) : null,
            sub: sub?.text,
            quote: quote?.text,
            unlimited: r.unlimitedWarmth,
            energyKeys: Object.keys(r.energy),
            pill: `${r.energy.current}/${r.energy.max}`,
            regen: window.__sc.regen()
          };
        });
        const acks = await host(() => window.__host.acks);
        return {
          checks: {
            readyHandshake: ready > 0,
            acked: acks.includes('p_hoard_1'),
            subFits: facts.subWidth !== null && facts.subWidth <= 700,
            quote: /Unlimited Warmth until \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec), \d{2}:\d{2}\.$/.test(facts.quote ?? ''),
            active: facts.unlimited?.active === true,
            energyShape: JSON.stringify(facts.energyKeys) === JSON.stringify(['current', 'max']),
            label: facts.regen?.text === '∞ Unlimited · 5d 0h'
          },
          detail: facts
        };
      });
      await sleep(2600); // banner away

      await shot(page, 'G07-warmth-shelf-active', async () => {
        await g.evaluate(() => window.__sc.ctx().bus.emit('energy:set', { value: 10, reason: 'shopcheck' }));
        await clearStage(page, g);
        await openShop(g, 'energy');
        const s = await g.evaluate(() => window.__sc.shelf());
        return { checks: { goldPrices: (s.lines ?? []).every((l) => l.some((x) => /^\d+$/.test(x))) }, detail: s };
      });
      await shot(page, 'G07-warmth-bought-active', async () => {
        const before = await g.evaluate(() => ({ coins: window.__sc.ctx().state.coins, energy: window.__sc.ctx().state.energyCurrent }));
        await g.evaluate(() => window.__sc.tapPlate(0));
        await sleep(500);
        const after = await g.evaluate(() => ({ coins: window.__sc.ctx().state.coins, energy: window.__sc.ctx().state.energyCurrent }));
        return { checks: { tookGold: after.coins < before.coins, addedWarmth: after.energy > before.energy }, detail: { before, after } };
      });
      await closeShop(g);

      await shot(page, 'G08-free-harvest', async () => {
        const facts = await g.evaluate(async () => {
          const ctx = window.__sc.ctx();
          const board = window.__sc.board();
          const dragon = window.__sc.ensureDragon();
          await new Promise((r) => setTimeout(r, 900)); // a spawned dragon gets its sprite
          dragon.readyAt = ctx.clock.now();
          ctx.bus.emit('energy:set', { value: 0, reason: 'shopcheck' });
          let harvested = 0, failed = null;
          const off1 = ctx.bus.on('item:harvested', () => harvested++);
          const off2 = ctx.bus.on('item:harvest_failed', ({ reason }) => (failed = reason));
          board.cameras.main.centerOn(board.itemSprites.get(dragon.id).x, board.itemSprites.get(dragon.id).y);
          board.onItemTapped(board.itemSprites.get(dragon.id));
          await new Promise((r) => setTimeout(r, 300));
          off1?.(); off2?.();
          return { harvested, failed, energy: ctx.state.energyCurrent, pin: !!board.skipButton, dragonRemovals: window.__sc.removed };
        });
        return { checks: { harvested: facts.harvested === 1, energyStill0: facts.energy === 0, noPin: facts.pin === false }, detail: facts };
      });

      // G9: the skip pins while active.
      const pin = async (name, setup, expect) =>
        shot(page, name, async () => {
          const facts = await g.evaluate(async ([s]) => {
            const ctx = window.__sc.ctx();
            const board = window.__sc.board();
            board.hideSkipButton();
            // eslint-disable-next-line no-new-func
            const item = await new Function('ctx', 'board', `return (async () => { ${s} })()`)(ctx, board);
            await new Promise((r) => setTimeout(r, 900)); // a spawned piece gets its sprite
            const sprite = board.itemSprites.get(item.id);
            if (!sprite) throw new Error(`no sprite for ${item.chain} ${item.tier}`);
            board.cameras.main.centerOn(sprite.x, sprite.y - 150);
            board.onItemTapped(sprite);
            await new Promise((r) => setTimeout(r, 400));
            return { warmth: board.skipWarmthLabel?.text ?? null, gold: board.skipGoldLabel?.text ?? null, chain: item.chain, tier: item.tier };
          }, [setup]);
          return { checks: expect(facts), detail: facts };
        });
      await pin(
        'G09-pin-dragon-free',
        `const d = window.__sc.ensureDragon();
         d.readyAt = ctx.clock.now() + 60000; ctx.bus.emit('energy:refill', { reason: 'shopcheck' }); return d;`,
        (f) => ({ free: f.warmth === '⚡ Free', goldRow: f.gold !== null })
      );
      await pin(
        'G09-pin-house-coin',
        `const h = [...ctx.state.items.values()].find((i) => i.chain === 'lumber' && i.tier === 3 && (!i.produces || i.produces.chain === 'coin'));
         if (!h) throw new Error('no coin House on the board');
         h.passiveAt = ctx.clock.now() + 200000; return h;`,
        (f) => ({ charged: /^⚡ \d+$/.test(f.warmth ?? ''), oneRow: f.gold === null })
      );
      await pin(
        'G09-pin-house-commissioned',
        `const home = [...ctx.state.items.values()].find((i) => i.chain === 'lumber' && i.tier === 3);
         const c = ctx.state.freeActiveTilesNear(home.col, home.row)[0];
         ctx.systems.board.spawn('lumber', 3, c.col, c.row, 'init');
         const h = [...ctx.state.items.values()].filter((i) => i.chain === 'lumber' && i.tier === 3).sort((a, b) => b.id - a.id)[0];
         h.produces = { chain: 'quartz', tier: 1 }; h.passiveAt = ctx.clock.now() + 200000; return h;`,
        (f) => ({ charged: /^⚡ \d+$/.test(f.warmth ?? ''), goldRow: f.gold !== null })
      );
      await pin(
        'G09-pin-big-tree',
        `const home = [...ctx.state.items.values()].find((i) => i.chain === 'lumber' && i.tier === 3);
         const c = ctx.state.freeActiveTilesNear(home.col, home.row)[0];
         ctx.systems.board.spawn('firgrain', 3, c.col, c.row, 'init');
         const t = [...ctx.state.items.values()].filter((i) => i.chain === 'firgrain' && i.tier === 3).sort((a, b) => b.id - a.id)[0];
         t.passiveAt = ctx.clock.now() + 200000; return t;`,
        (f) => ({ charged: /^⚡ \d+$/.test(f.warmth ?? '') })
      );
      await shot(page, 'G09-house-skip-short', async () => {
        const facts = await g.evaluate(async () => {
          const ctx = window.__sc.ctx();
          const board = window.__sc.board();
          board.hideSkipButton();
          const h = [...ctx.state.items.values()].find((i) => i.chain === 'lumber' && i.tier === 3 && (!i.produces || i.produces.chain === 'coin'));
          h.passiveAt = ctx.clock.now() + 200000;
          ctx.bus.emit('energy:set', { value: 0, reason: 'shopcheck' });
          const sprite = board.itemSprites.get(h.id);
          board.cameras.main.centerOn(sprite.x, sprite.y - 150);
          ctx.bus.emit('generator:skip', { itemId: h.id, currency: 'warmth' });
          await new Promise((r) => setTimeout(r, 250));
          return { floats: window.__sc.texts(board).map((t) => t.text).filter((t) => /Warmth/.test(t)) };
        });
        return { checks: { refusal: facts.floats.includes('Still costs Warmth ⚡ — top up with ⚡+') }, detail: facts };
      });
      await sleep(1200);

      await shot(page, 'G16-recipe-help-free', async () => {
        await g.evaluate(() => window.__sc.ctx().bus.emit('ui:recipe_help', { chain: 'flame_gem', tier: 2, count: 1 }));
        await sleep(600);
        const lines = await g.evaluate(() => window.__sc.texts(window.__sc.ui()).map((t) => t.text).filter((t) => /⚡/.test(t)));
        return { checks: { free: lines.some((t) => t.includes('Free ⚡')) }, detail: lines };
      });
      await g.evaluate(() => { const p = window.__sc.ui().recipeHelp; (p.requestClose ?? p.close)?.call(p); });
      await sleep(400);

      await shot(page, 'G10-confirm-hoard-active', async () => {
        await g.evaluate(() => window.__sc.ctx().bus.emit('ui:iap_buy_requested', { packId: 'hearth_hoard' }));
        await sleep(500);
        const d = await g.evaluate(() => window.__sc.dialog());
        return {
          checks: { nowUntil: !!d?.some((t) => /^⚡ \+5 days · now until \d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2}$/.test(t.text)) },
          detail: d
        };
      });
      await g.evaluate(() => window.__sc.ui().closeIapDialog());

      await shot(page, 'G11-reload-still-active', async () => {
        g = await boot(page, { hub: true });
        const facts = await g.evaluate(() => ({ regen: window.__sc.regen(), unlimited: window.__sc.rtt().unlimitedWarmth }));
        return { checks: { label: /^∞ Unlimited · /.test(facts.regen?.text ?? ''), active: facts.unlimited.active === true }, detail: facts };
      });

      await shot(page, 'G12-expired', async () => {
        await g.evaluate(() => window.advanceTime(432_000_000));
        await sleep(1300);
        const facts = await g.evaluate(() => ({
          regen: window.__sc.regen(),
          unlimited: window.__sc.rtt().unlimitedWarmth,
          toast: window.__sc.texts(window.__sc.ui()).some((t) => t.text === 'Unlimited Warmth has ended.')
        }));
        return {
          checks: { inactive: facts.unlimited.active === false, labelBack: !/^∞/.test(facts.regen?.text ?? ''), toast: facts.toast },
          detail: facts
        };
      });

      await shot(page, 'G13-expired-blob', async () => {
        await page.goto(`${BASE}/__blank.html`); // pagehide flushes the live save first
        await page.evaluate((k) => {
          const b = JSON.parse(localStorage.getItem(k));
          b.energy.unlimitedUntil = Date.now() - 1;
          localStorage.setItem(k, JSON.stringify(b));
        }, CP.saveKey);
        g = await boot(page, { hub: true });
        const facts = await g.evaluate(() => ({ regen: window.__sc.regen(), unlimited: window.__sc.rtt().unlimitedWarmth }));
        return { checks: { noInfinity: !/^∞/.test(facts.regen?.text ?? ''), inactive: facts.unlimited.active === false }, detail: facts };
      });

      // G14 + G15: a benefit running, New Game, a purchase landing at the Title.
      await host(() => window.__host.result('p_hoard_2', 'hearth_hoard'));
      await sleep(3000);
      await shot(page, 'G14-title-grant-held', async () => {
        await g.evaluate(() => window.__sc.ctx().bus.emit('game:reset_requested', {}));
        await g.waitForFunction(() => window.__sc.rtt().scene === 'TitleScene', null, { timeout: 30000 });
        await sleep(600);
        await host(() => window.__host.result('p_pouch_g14', 'gold_pouch'));
        await sleep(800);
        const facts = await g.evaluate(() => {
          const st = window.__sc.ctx().state;
          return { coins: st.coins, latch: st.stat('iap:p_pouch_g14'), until: st.energyUnlimitedUntil, wall: window.__sc.ctx().clock.wallNow() };
        });
        const acks = await host(() => window.__host.acks);
        return {
          checks: { notApplied: facts.latch === 0, notAcked: !acks.includes('p_pouch_g14'), benefitKept: facts.until > facts.wall },
          detail: { ...facts, acks }
        };
      });
      await shot(page, 'G14-after-play-delivered-once', async () => {
        const readyBefore = await host(() => window.__host.ready);
        await sleep(1400);
        await g.evaluate(() => window.__sc.pressPlay());
        await g.waitForFunction(() => window.__sc.rtt().scene === 'BoardScene' && !!window.__sc.ui(), null, { timeout: 120000 });
        await sleep(1500);
        const facts = await g.evaluate(() => ({ latch: window.__sc.ctx().state.stat('iap:p_pouch_g14'), coins: window.__sc.ctx().state.coins }));
        const h = await host(() => ({ ready: window.__host.ready, acks: window.__host.acks }));
        return {
          checks: {
            readyAgain: h.ready > readyBefore,
            appliedOnce: facts.latch === 1,
            ackedOnce: h.acks.filter((a) => a === 'p_pouch_g14').length === 1
          },
          detail: { ...facts, ...h }
        };
      });
      await shot(page, 'G15-new-game-keeps-benefit', async () => {
        await sleep(2200);
        const facts = await g.evaluate(() => ({ items: window.__sc.ctx().state.items.size, regen: window.__sc.regen(), unlimited: window.__sc.rtt().unlimitedWarmth }));
        return { checks: { startingPieces: facts.items > 0, label: /^∞ Unlimited · /.test(facts.regen?.text ?? ''), active: facts.unlimited.active === true }, detail: facts };
      });
    } catch (e) {
      report('hub-desktop', false, {}, { error: String(e?.message ?? e).slice(0, 300) });
    } finally {
      await context.close();
    }
  }

  /* ------------------------------------------------ fake hub, mobile */
  {
    const { context, page } = await newContext(browser, MOBILE);
    try {
      await seed(page);
      const g = await boot(page, { hub: true });
      await finishTutorial(g);
      await shot(page, 'G05-confirm-hoard-mobile', async () => {
        await g.evaluate(() => window.__sc.ctx().bus.emit('ui:iap_buy_requested', { packId: 'hearth_hoard' }));
        await sleep(500);
        const d = await g.evaluate(() => window.__sc.dialog());
        return {
          checks: {
            open: Array.isArray(d),
            disclosure4: !!d?.some((t) => t.text.split('\n').length === 4),
            buy: !!d?.some((t) => t.text === 'Buy €100')
          },
          detail: d
        };
      });
    } catch (e) {
      report('hub-mobile', false, {}, { error: String(e?.message ?? e).slice(0, 300) });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const notProduced = results.filter((r) => !r.produced);
const failing = results.filter((r) => r.produced && r.failed.length);
console.log(`\n${results.length} states · ${results.length - notProduced.length} photographed · ${failing.length} with failed checks · PNGs in ${path.relative(ROOT, OUT)}/`);
process.exitCode = notProduced.length || failing.length ? 1 : 0;
