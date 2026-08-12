import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('http://localhost:8820/tools/worldbuilder/index.html');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(3000);
await page.evaluate(async () => {
  S.placements = [];               // clear, so only the test water + the grid show
  S.tileW = 240; S.tileH = 120;    // the authoring grid
  S.showGrid = true;
  setCategory('background');
  const img = new Image();
  await new Promise((res) => { img.onload = res; img.onerror = res; img.src = '/assets/sprites/bg-tile/water-tile.webp'; });
  const id = makeAsset(img, 'water-tile.png', 'background');
  S.assets[id].anchorY = 0.25;     // sit the diamond top on the cell for the comparison
  S.selectedAssetId = id;
  for (const [c, r] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [-1, -1]]) paintAt(c, r);
  fitView();
});
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/water-fit.png' });
console.log('errors:', errs.filter((e) => !e.includes('favicon')).length);
await browser.close();
