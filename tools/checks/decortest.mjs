import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto('http://localhost:8820/tools/worldbuilder/index.html');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(2500);

const result = await page.evaluate(async () => {
  S.placements = []; S.tileW = 240; S.tileH = 120; S.showGrid = true;
  const mk = (color, name, category) => new Promise((res) => {
    const c = document.createElement('canvas'); c.width = 240; c.height = 240;
    const g = c.getContext('2d');
    if (category === 'tile') { g.fillStyle = color; g.beginPath(); g.moveTo(120, 60); g.lineTo(240, 120); g.lineTo(120, 180); g.lineTo(0, 120); g.closePath(); g.fill(); }
    else { g.fillStyle = color; g.beginPath(); g.arc(120, 90, 50, 0, Math.PI * 2); g.fill(); }
    const img = new Image();
    img.onload = () => res(makeAsset(img, name, category));
    img.src = c.toDataURL();
  });
  const tileId = await mk('#3a7a2a', 'test-tile.png', 'tile');
  const decorId = await mk('#e0402a', 'test-decor.png', 'decor');

  // paint a tile at (0,0), then a decor on the SAME cell
  S.selectedAssetId = tileId; paintAt(0, 0);
  const afterTile = S.placements.filter((p) => p.col === 0 && p.row === 0).map((p) => assetById(p.assetId).category);
  S.selectedAssetId = decorId; paintAt(0, 0);
  const afterDecor = S.placements.filter((p) => p.col === 0 && p.row === 0).map((p) => assetById(p.assetId).category);

  // and the reverse: tile painted onto a cell that already has decor
  S.selectedAssetId = decorId; paintAt(1, 0);
  S.selectedAssetId = tileId; paintAt(1, 0);
  const reverse = S.placements.filter((p) => p.col === 1 && p.row === 0).map((p) => assetById(p.assetId).category);

  fitView();
  return { afterTile, afterDecor, reverse };
});
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/decortest.png' });
console.log('cell(0,0) after painting tile:', JSON.stringify(result.afterTile));
console.log('cell(0,0) after then painting decor:', JSON.stringify(result.afterDecor));
console.log('cell(1,0) decor-first then tile:', JSON.stringify(result.reverse));
console.log('errors:', errs.filter((e) => !e.includes('favicon')).length);
await browser.close();
