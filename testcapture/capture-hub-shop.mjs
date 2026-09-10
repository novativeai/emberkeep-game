/**
 * THE SITE'S SHOP AND LOOKS, MEASURED — the hub half of the four-tier rework.
 *
 *   QA_EMAIL=… QA_PASSWORD=… node testcapture/capture-hub-shop.mjs \
 *     [--url http://localhost:3000] [--out testcapture/shop-tiers/after/hub] [--only H1,H4]
 *
 * Every row of the spec's hub table (§8, H1–H12) is a screenshot AND a set of
 * measured checks, printed ✓/✗. A picture alone was not enough twice this week:
 * a lazy icon photographed as an empty square, a panel caught mid-fade. So the
 * rules the spec states in words — no price in #looks, the bonus chip clear of
 * the icon, four cards in one row, no horizontal scroll — are asked of the DOM,
 * and the PNG is there to be looked at, not to be believed.
 *
 * H1–H7 need no account. H8–H10 and H12 sign in with QA_EMAIL/QA_PASSWORD (the
 * account is created through the site's own register form if it does not
 * exist). Checkout is ALWAYS stubbed with page.route — no gateway session is
 * ever created by this bench.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = opt('url', 'http://localhost:3000').replace(/\/+$/, '');
const OUT = path.resolve(opt('out', 'testcapture/shop-tiers/after/hub'));
const ONLY = opt('only', '').split(',').filter(Boolean);
const PAGE = '/games/emberkeep';
const { QA_EMAIL, QA_PASSWORD } = process.env;
mkdirSync(OUT, { recursive: true });

const VP = {
  w1440: { w: 1440, h: 900 },
  w1024: { w: 1024, h: 768 },
  w768: { w: 768, h: 1024 },
  w400: { w: 400, h: 860 },
};
const want = (id) => !ONLY.length || ONLY.includes(id);
const results = [];
const check = (label, ok, detail = '') => ({ label, ok: !!ok, detail });
function record(id, name, checks) {
  const pass = checks.every((c) => c.ok);
  results.push({ id, name, pass });
  console.log(`${pass ? '✓' : '✗'} ${id} ${name}`);
  for (const c of checks) console.log(`    ${c.ok ? '✓' : '✗'} ${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE_ERRORS = new Set();
const listen = (page) => {
  page.on('pageerror', (e) => PAGE_ERRORS.add(`pageerror: ${String(e.message).split('\n')[0].slice(0, 220)}`));
  page.on('console', (m) => { if (m.type() === 'error') PAGE_ERRORS.add(`console: ${m.text().split('\n')[0].slice(0, 220)}`); });
};

/* ------------------------------------------------------------------ helpers */

async function openLanding(browser, vp, storageState) {
  const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2, storageState });
  const page = await context.newPage();
  listen(page);
  // Not 'networkidle' — the landing loops a video and never goes idle.
  await page.goto(BASE + PAGE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#shop', { timeout: 90000 });
  await sleep(1500);
  return { context, page };
}

/** Wait until every <img> under `sel` has decoded; return the ones that never did. */
async function imagesReady(page, sel) {
  await page
    .waitForFunction((s) => [...document.querySelectorAll(`${s} img`)].every((i) => i.complete && i.naturalWidth > 0), sel, { timeout: 20000 })
    .catch(() => {});
  return page.$$eval(`${sel} img`, (imgs) => imgs.filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.getAttribute('src')));
}

async function shootSection(page, sel, file) {
  const el = page.locator(sel);
  if ((await el.count()) === 0) return { missing: true, broken: [] };
  await el.scrollIntoViewIfNeeded();
  const broken = await imagesReady(page, sel);
  await sleep(400);
  // The sticky header is re-drawn at the scroll position inside a tall element
  // shot, straight across the section's heading. Hidden for the PHOTO only;
  // H11 measures the real header.
  await el.screenshot({ path: path.join(OUT, file), style: 'header{visibility:hidden!important} nextjs-portal{display:none!important}' });
  return { missing: false, broken };
}

const noHScroll = (page) =>
  page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));

/** Cluster tops within a tolerance into visual rows. */
function rowsOf(items, tol = 10) {
  const sorted = [...items].sort((a, b) => a.top - b.top);
  const rows = [];
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r.top - it.top) <= tol);
    if (row) row.items.push(it);
    else rows.push({ top: it.top, items: [it] });
  }
  return rows.map((r) => r.items.length);
}
const intersects = (a, b) => a && b && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);

const looksInfo = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('#looks');
    if (!root) return null;
    const h2 = root.querySelector('h2');
    const lh = h2 ? parseFloat(getComputedStyle(h2).lineHeight) : 0;
    // THE CARD IS THE FIRST ANCESTOR OF THE PICTURE THAT CARRIES TEXT. The
    // first run took img.closest('figure'), which on these cards is a caption-
    // less wrapper — so Eleanor and Selyna were counted as nameless small cards
    // and a correct layout was reported as broken.
    const seen = new Set();
    const cards = [...root.querySelectorAll('img')].map((img) => {
      let card = img.parentElement;
      while (card && card !== root && !card.innerText.trim()) card = card.parentElement;
      if (!card || card === root || seen.has(card)) return null;
      seen.add(card);
      const r = card.getBoundingClientRect();
      return {
        text: card.innerText.replace(/\s+/g, ' ').slice(0, 70),
        top: Math.round(r.top + window.scrollY),
        w: Math.round(r.width),
        imgW: Math.round(img.getBoundingClientRect().width),
      };
    }).filter(Boolean);
    const text = root.innerText;
    const leak = text.match(/€|\d[\d,]*\s*Gold/);
    return {
      leak: leak ? leak[0] : null,
      h2Lines: h2 && lh ? Math.round(h2.getBoundingClientRect().height / lh) : null,
      keepers: cards.filter((c) => /Eleanor|Selyna/.test(c.text)),
      small: cards.filter((c) => !/Eleanor|Selyna/.test(c.text)),
      cta: !!root.querySelector('a[href*="#play"]'),
    };
  });

const shopInfo = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('#shop');
    if (!root) return null;
    const rect = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const buttons = [...root.querySelectorAll('button')].filter((b) => /€\s?(2\.50|10|25|100)\b|…/.test(b.innerText));
    const cards = buttons.map((b) => {
      const card = b.closest('article, li') || b.parentElement?.parentElement || b;
      const r = card.getBoundingClientRect();
      const chip = [...card.querySelectorAll('*')].find((e) => e.children.length === 0 && /\+\d+%\s*bonus/i.test(e.textContent || ''));
      return {
        label: b.innerText.trim(),
        top: Math.round(r.top + window.scrollY),
        h: Math.round(r.height),
        btnBottom: Math.round(b.getBoundingClientRect().bottom + window.scrollY),
        chip: rect(chip),
        icon: rect(card.querySelector('img')),
        disabled: b.disabled,
      };
    });
    const text = root.innerText;
    const nudge = text.match(/\bbest\b|\bpopular\b/i);
    const white = [...root.querySelectorAll('div')].some((d) => getComputedStyle(d).backgroundColor === 'rgb(255, 255, 255)' && d.getBoundingClientRect().width > 600);
    const note = document.querySelector('#unlimited-warmth');
    return {
      cards,
      nudge: nudge ? nudge[0] : null,
      white,
      note: note ? { h: Math.round(note.getBoundingClientRect().height), clipped: note.scrollHeight > note.clientHeight + 1 } : null,
      rate: /100\s*Gold|per euro|€1\b/i.test(text),
      signin: /sign in/i.test(text),
      error: [...root.querySelectorAll('*')].find((e) => e.children.length === 0 && /unknown pack|could not|try again|failed/i.test(e.textContent || ''))?.textContent?.trim() ?? null,
    };
  });

/* --------------------------------------------------------------- the account */

async function signIn(page) {
  if (!QA_EMAIL || !QA_PASSWORD) throw new Error('QA_EMAIL / QA_PASSWORD not set');
  await page.getByRole('button', { name: /login|register|sign in/i }).first().click();
  await page.waitForSelector('[role="dialog"][aria-modal="true"]:not([data-nextjs-dialog])', { timeout: 15000 });
  await page.fill('[role="dialog"][aria-modal="true"]:not([data-nextjs-dialog]) input[type="email"]', QA_EMAIL);
  await page.fill('[role="dialog"][aria-modal="true"]:not([data-nextjs-dialog]) input[type="password"]', QA_PASSWORD);
  await page.locator('[role="dialog"][aria-modal="true"]:not([data-nextjs-dialog]) button[type="submit"]').click();
  const outcome = await Promise.race([
    page.waitForSelector('[role="dialog"][aria-modal="true"]:not([data-nextjs-dialog])', { state: 'detached', timeout: 20000 }).then(() => 'in'),
    page.waitForSelector('[role="dialog"][aria-modal="true"]:not([data-nextjs-dialog]) >> text=/Wrong email or password/i', { timeout: 20000 }).then(() => 'unknown'),
  ]).catch(() => 'timeout');
  if (outcome === 'unknown') {
    // First run: the account does not exist yet — make it through the site's own form.
    await page.getByRole('button', { name: /create an account/i }).click();
    await page.fill('[role="dialog"][aria-modal="true"]:not([data-nextjs-dialog]) input[type="email"]', QA_EMAIL);
    await page.fill('[role="dialog"][aria-modal="true"]:not([data-nextjs-dialog]) input[type="password"]', QA_PASSWORD);
    await page.locator('[role="dialog"][aria-modal="true"]:not([data-nextjs-dialog]) button[type="submit"]').click();
    try {
      await page.waitForSelector('[role="dialog"][aria-modal="true"]:not([data-nextjs-dialog])', { state: 'detached', timeout: 30000 });
    } catch (e) {
      await page.screenshot({ path: path.join(OUT, 'H8-register-stuck.png') });
      const said = await page.locator('[role="dialog"][aria-modal="true"]:not([data-nextjs-dialog])').innerText().catch(() => '');
      throw new Error(`register did not close: ${said.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
  } else if (outcome !== 'in') {
    throw new Error(`sign-in did not complete (${outcome})`);
  }
  await sleep(2500);
}

/* ------------------------------------------------------------------ the run */

const browser = await chromium.launch();
try {
  // H1 — #looks at 1440 and 1024
  if (want('H1')) {
    for (const key of ['w1440', 'w1024']) {
      const { context, page } = await openLanding(browser, VP[key]);
      const shot = await shootSection(page, '#looks', `H1-looks-${VP[key].w}.png`);
      const info = await looksInfo(page);
      const hs = await noHScroll(page);
      record(`H1@${VP[key].w}`, '#looks, grand écran', [
        check('section #looks présente', !shot.missing),
        check('images décodées', shot.broken.length === 0, shot.broken.join(', ')),
        check('aucun prix ni montant de Gold dans #looks', info && !info.leak, info?.leak ?? ''),
        check('H2 sur 2 lignes max', info && info.h2Lines !== null && info.h2Lines <= 2, `${info?.h2Lines} ligne(s)`),
        check('deux cartes Eleanor/Selyna', info && info.keepers.length === 2, `${info?.keepers.length}`),
        check('4 petites cartes', info && info.small.length === 4, `${info?.small.length}`),
        check('lien ▶ vers #play', info?.cta),
        check('pas de défilement horizontal', hs.sw <= hs.iw, `${hs.sw} / ${hs.iw}`),
      ]);
      await context.close();
    }
  }

  // H2 / H3 — #looks at 768 and 400
  for (const [id, key] of [['H2', 'w768'], ['H3', 'w400']]) {
    if (!want(id)) continue;
    const { context, page } = await openLanding(browser, VP[key]);
    const shot = await shootSection(page, '#looks', `${id}-looks-${VP[key].w}.png`);
    const info = await looksInfo(page);
    const hs = await noHScroll(page);
    const keeperRows = info ? rowsOf(info.keepers) : [];
    const smallRows = info ? rowsOf(info.small) : [];
    const checks = [
      check('section #looks présente', !shot.missing),
      check('images décodées', shot.broken.length === 0, shot.broken.join(', ')),
      check('aucun prix ni montant de Gold', info && !info.leak, info?.leak ?? ''),
      check('pas de défilement horizontal', hs.sw <= hs.iw, `${hs.sw} / ${hs.iw}`),
    ];
    if (id === 'H2') {
      checks.push(check('Keepers côte à côte (2 par rangée)', keeperRows.join() === '2', keeperRows.join('+')));
      checks.push(check('petites cartes 4 par rangée', smallRows.join() === '4', smallRows.join('+')));
    } else {
      const kw = Math.min(...info.keepers.map((c) => c.imgW));
      const sw = Math.max(...info.small.map((c) => c.imgW));
      checks.push(check('Keepers 1 par rangée', keeperRows.every((n) => n === 1), keeperRows.join('+')));
      checks.push(check('image Keeper ≥ 1,5× une petite carte', kw >= 1.5 * sw, `${kw}px vs ${sw}px`));
      checks.push(check('petites cartes en 2×2', smallRows.join() === '2,2', smallRows.join('+')));
    }
    record(id, `#looks à ${VP[key].w}px`, checks);
    await context.close();
  }

  // H4 — #shop signed out at 1440 and 1024
  if (want('H4')) {
    for (const key of ['w1440', 'w1024']) {
      const { context, page } = await openLanding(browser, VP[key]);
      const shot = await shootSection(page, '#shop', `H4-shop-${VP[key].w}.png`);
      const info = await shopInfo(page);
      const hs = await noHScroll(page);
      const rows = info ? rowsOf(info.cards) : [];
      const hs2 = info ? info.cards.map((c) => c.h) : [];
      const btn = info ? info.cards.map((c) => c.btnBottom) : [];
      const overlap = info ? info.cards.filter((c) => intersects(c.chip, c.icon)).map((c) => c.label) : [];
      record(`H4@${VP[key].w}`, '#shop déconnecté', [
        check('section #shop présente', !shot.missing),
        check('images décodées', shot.broken.length === 0, shot.broken.join(', ')),
        check('4 cartes €2.50 / €10 / €25 / €100', info && info.cards.map((c) => c.label).join(' ').match(/2\.50/) && info.cards.length === 4, info?.cards.map((c) => c.label).join(' | ')),
        check('4 cartes sur une rangée', rows.join() === '4', rows.join('+')),
        check('pastille bonus hors de l’icône', overlap.length === 0, overlap.join(', ')),
        check('écart de hauteur des cartes < 120px', hs2.length && Math.max(...hs2) - Math.min(...hs2) < 120, hs2.join('/')),
        check('boutons alignés (±4px)', btn.length && Math.max(...btn) - Math.min(...btn) <= 4, btn.join('/')),
        check('aucun « best » / « popular »', info && !info.nudge, info?.nudge ?? ''),
        check('note #unlimited-warmth entière', info?.note && !info.note.clipped && info.note.h > 0),
        check('note de taux présente', info?.rate),
        check('note de connexion présente', info?.signin),
        check('pas de grande carte blanche', info && !info.white),
        check('pas de défilement horizontal', hs.sw <= hs.iw, `${hs.sw} / ${hs.iw}`),
      ]);
      await context.close();
    }
  }

  // H5 / H6 — #shop at 768 and 400
  for (const [id, key, expected] of [['H5', 'w768', '2,2'], ['H6', 'w400', '1,1,1,1']]) {
    if (!want(id)) continue;
    const { context, page } = await openLanding(browser, VP[key]);
    const shot = await shootSection(page, '#shop', `${id}-shop-${VP[key].w}.png`);
    const info = await shopInfo(page);
    const hs = await noHScroll(page);
    const rows = info ? rowsOf(info.cards) : [];
    record(id, `#shop à ${VP[key].w}px`, [
      check('images décodées', shot.broken.length === 0, shot.broken.join(', ')),
      check(`disposition ${expected.replace(/,/g, '+')}`, rows.join() === expected, rows.join('+')),
      check('note #unlimited-warmth entière', info?.note && !info.note.clipped),
      check('pas de défilement horizontal', hs.sw <= hs.iw, `${hs.sw} / ${hs.iw}`),
    ]);
    await context.close();
  }

  // H7 — signed out, Buy opens the sign-in panel
  if (want('H7')) {
    const { context, page } = await openLanding(browser, VP.w1440);
    const buy = page.locator('#shop button').filter({ hasText: /€\s?2\.50/ }).first();
    await buy.scrollIntoViewIfNeeded();
    await buy.click();
    const open = await page.waitForSelector('[role="dialog"][aria-modal="true"]:not([data-nextjs-dialog])', { timeout: 10000 }).then(() => true).catch(() => false);
    await page.screenshot({ path: path.join(OUT, 'H7-buy-signed-out.png') });
    record('H7', 'Acheter déconnecté → panneau de connexion', [check('AuthModal ouvert', open)]);
    await context.close();
  }

  // H8–H10, H12 — signed in
  const signedIds = ['H8', 'H9', 'H10', 'H11', 'H12'].filter(want);
  if (signedIds.some((id) => id !== 'H11')) {
    const { context, page } = await openLanding(browser, VP.w1440);
    await signIn(page);
    const state = await context.storageState({ indexedDB: true });
    await context.close();

    if (want('H8')) {
      const { context: c, page: p } = await openLanding(browser, VP.w1440, state);
      await p.route('**/api/iap/checkout', async (route) => {
        await sleep(10000);
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Unknown pack' }) });
      });
      const buy = p.locator('#shop button').filter({ hasText: /€\s?2\.50/ }).first();
      await buy.scrollIntoViewIfNeeded();
      await buy.click();
      await sleep(900);
      const info = await shopInfo(p);
      await p.locator('#shop').screenshot({ path: path.join(OUT, 'H8-checkout-busy.png') });
      record('H8', 'Paiement en cours (réponse retardée 10 s)', [
        check('bouton cliqué affiche …', info?.cards.some((x) => x.label.includes('…')), info?.cards.map((x) => x.label).join(' | ')),
        check('tous les boutons désactivés', info?.cards.every((x) => x.disabled)),
      ]);
      await c.close();
    }

    if (want('H9')) {
      const { context: c, page: p } = await openLanding(browser, VP.w1440, state);
      await p.route('**/api/iap/checkout', (route) =>
        route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Unknown pack' }) })
      );
      const buy = p.locator('#shop button').filter({ hasText: /€\s?10\b/ }).first();
      await buy.scrollIntoViewIfNeeded();
      await buy.click();
      await sleep(2000);
      const info = await shopInfo(p);
      await p.locator('#shop').screenshot({ path: path.join(OUT, 'H9-checkout-error.png') });
      record('H9', 'Erreur de paiement (400 Unknown pack)', [
        check('message d’erreur affiché', !!info?.error, info?.error ?? ''),
        check('boutons de nouveau actifs', info?.cards.every((x) => !x.disabled)),
      ]);
      await c.close();
    }

    if (want('H10')) {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, storageState: state });
      const p = await c.newPage();
      listen(p);
      await p.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await sleep(5000);
      const text = await p.evaluate(() => document.body.innerText);
      await p.screenshot({ path: path.join(OUT, 'H10-account.png'), fullPage: true });
      record('H10', '/account connecté', [
        check('statistique « Gold »', /\bGold\b/.test(text)),
        check('statistique « Warmth »', /\bWarmth\b/.test(text)),
        check('plus de « Coins » / « Energy »', !/\bCoins\b|\bEnergy\b/.test(text)),
      ]);
      await c.close();
    }

    if (want('H12')) {
      const cpDir = path.resolve('tests/e2e/checkpoints');
      const cpFile = readdirSync(cpDir).find((f) => /free_play\.json$/.test(f));
      const cp = JSON.parse(readFileSync(path.join(cpDir, cpFile), 'utf8'));
      const blob = JSON.parse(cp.blob);
      blob.energy = { ...(blob.energy || {}), unlimitedUntil: Date.now() + 3 * 24 * 3600 * 1000 };
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, storageState: state });
      await c.addInitScript(([k, b]) => { try { window.localStorage.setItem(k, b); } catch {} }, [cp.saveKey, JSON.stringify(blob)]);
      const p = await c.newPage();
      listen(p);
      await p.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await sleep(5000);
      let message = null;
      p.once('dialog', async (d) => { message = d.message(); await d.dismiss(); });
      const reset = p.getByRole('button', { name: /reset/i }).first();
      const found = (await reset.count()) > 0;
      if (found) { await reset.scrollIntoViewIfNeeded(); await reset.click(); await sleep(1500); }
      await p.screenshot({ path: path.join(OUT, 'H12-account-reset.png') });
      record('H12', 'Reset du compte avec Warmth illimitée en cours', [
        check('bouton Reset trouvé', found),
        check('confirmation mentionne Unlimited Warmth', message && /Unlimited Warmth/i.test(message), message ?? '(aucun dialogue)'),
      ]);
      await c.close();
    }
  }

  // H11 — anchors land below the 64px sticky header
  if (want('H11')) {
    const { context, page } = await openLanding(browser, VP.w1440);
    const land = async (clickLocator, targetSel) => {
      await clickLocator.scrollIntoViewIfNeeded();
      await clickLocator.click();
      await sleep(1500);
      return page.evaluate((s) => {
        const t = document.querySelector(s);
        const h = t?.querySelector('h2, h3') || t;
        return h ? Math.round(h.getBoundingClientRect().top) : null;
      }, targetSel);
    };
    const looksTop = await land(page.locator('footer a').filter({ hasText: /^Looks$/ }).first(), '#looks');
    const shopTop = await land(page.locator('footer a').filter({ hasText: /Ember Shop/ }).first(), '#shop');
    const howTop = await land(page.locator('#shop a').filter({ hasText: /How it works/i }).first(), '#unlimited-warmth');
    await page.screenshot({ path: path.join(OUT, 'H11-anchor-how-it-works.png') });
    record('H11', 'Ancres sous l’en-tête collant (64px)', [
      check('Footer « Looks » → titre sous l’en-tête', looksTop !== null && looksTop >= 64, `${looksTop}px`),
      check('Footer « Ember Shop » → titre sous l’en-tête', shopTop !== null && shopTop >= 64, `${shopTop}px`),
      check('« How it works » → note sous l’en-tête', howTop !== null && howTop >= 64, `${howTop}px`),
    ]);
    await context.close();
  }
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} vérifications passées${failed.length ? ` — échecs: ${failed.map((f) => f.id).join(', ')}` : ''}`);
  console.log(`→ ${path.relative(process.cwd(), OUT)}`);
  console.log(PAGE_ERRORS.size ? `\n${PAGE_ERRORS.size} erreur(s) de page:\n  ${[...PAGE_ERRORS].join('\n  ')}` : '\naucune erreur de page');
}
