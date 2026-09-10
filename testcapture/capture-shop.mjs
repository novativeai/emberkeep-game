/**
 * THE SHOP, PHOTOGRAPHED — before and after the four-tier catalog.
 *
 *   node testcapture/capture-shop.mjs [--url https://keepofthedragon.com] [--out testcapture/shop-tiers/before]
 *
 * Shoots every landing section a purchase decision passes through, at a desktop
 * and a phone width, so a redesign is judged beside its reference at the same
 * framing. A section id that does not exist yet (the cosmetics showcase, before
 * it ships) is reported and skipped, never faked.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const URL = opt('url', 'https://keepofthedragon.com');
const OUT = path.resolve(opt('out', 'testcapture/shop-tiers/before'));
const SECTIONS = (opt('sections', 'shop,looks,cosmetics,skins')).split(',');
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    // NOT 'networkidle': the landing loops a gameplay video and keeps a
    // connection open, so the network is never idle and the first run of this
    // bench timed out on a page that had long finished rendering. Wait for the
    // document, then for the section that is actually being judged.
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#shop', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    for (const id of SECTIONS) {
      // A LOCATOR, NOT AN ELEMENT HANDLE. <ShopSection/> re-renders once the
      // auth state resolves, which replaces the node: a handle taken before that
      // pointed at a detached element and the shot failed with "not attached to
      // the DOM". A locator re-resolves #id at every action.
      const el = page.locator(`#${id}`);
      if ((await el.count()) === 0) { console.log(`  ${vp.name.padEnd(8)} #${id.padEnd(10)} (absente)`); continue; }
      await el.scrollIntoViewIfNeeded();
      // WAIT FOR THE PIXELS, NOT FOR A CLOCK. The pack icons are lazy
      // next/image elements: the first run of this bench slept 900 ms and
      // photographed three empty white squares on mobile — which looked like a
      // production bug and was not one. Every <img> in the section must be
      // decoded before the shot, and one that never decodes is REPORTED, so a
      // genuinely broken image cannot hide behind a timeout either.
      await page
        .waitForFunction(
          (sel) => [...document.querySelectorAll(`${sel} img`)].every((i) => i.complete && i.naturalWidth > 0),
          `#${id}`,
          { timeout: 15000 }
        )
        .catch(() => {});
      const broken = await page.$$eval(`#${id} img`, (imgs) =>
        imgs.filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.getAttribute('src'))
      );
      if (broken.length) console.log(`  ! ${vp.name} #${id}: ${broken.length} image(s) non décodée(s): ${broken.join(', ')}`);
      await page.waitForTimeout(400);
      const file = path.join(OUT, `${vp.name}-${id}.png`);
      await el.screenshot({ path: file });
      const box = await el.boundingBox();
      console.log(`  ${vp.name.padEnd(8)} #${id.padEnd(10)} ${Math.round(box.width)}x${Math.round(box.height)} → ${path.relative(process.cwd(), file)}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
