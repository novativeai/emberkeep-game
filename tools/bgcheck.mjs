import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto('http://localhost:8820/tools/worldbuilder/index.html');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(3000);

// open Background tab: it must be EMPTY (no preloaded grass), and the bundled-tiles button must be gone.
const state = await page.evaluate(() => {
  setCategory('background');
  return {
    preloadedBg: Object.values(S.assets).filter((a) => a.category === 'background').length,
    bundledButton: !!document.getElementById('bgStarterTiles'),
    uploadVisible: getComputedStyle(document.getElementById('uploadRow')).display !== 'none'
  };
});

// user uploads a custom tile (a magenta grid-diamond) → becomes a background asset
await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#7a3cf0';
  g.beginPath(); g.moveTo(128, 0); g.lineTo(256, 64); g.lineTo(128, 128); g.lineTo(0, 64); g.closePath(); g.fill();
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => { const id = makeAsset(img, 'my-bg-tile.png', 'background'); S.selectedAssetId = id; renderAssets(); res(); };
    img.src = c.toDataURL();
  });
});
await page.evaluate(() => document.getElementById('fillBackground').click());
const after = await page.evaluate(() => ({
  bg: S.placements.filter((pl) => { const a = S.assets[pl.assetId]; return a && a.category === 'background'; }).length,
  exportBg: buildDoc(false).placements.filter((x) => x.category === 'background').length
}));
console.log('on open →', JSON.stringify(state), '| after custom upload + fill →', JSON.stringify(after));
console.log('errors:', errs.filter((e) => !e.includes('favicon')).length, errs.filter((e) => !e.includes('favicon')).slice(0, 3));
await browser.close();
