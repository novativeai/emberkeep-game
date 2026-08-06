import { chromium } from '@playwright/test';
const SCALE = +process.argv[2] || 0.854;
const ANCHOR = +process.argv[3] || 0.34;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:8820/tools/worldbuilder/index.html');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(3000);
await page.evaluate(async ([scale, anchor]) => {
  S.placements = []; S.tileW = 240; S.tileH = 120; S.showGrid = true;
  setCategory('tile');
  const load = async (file) => {
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.onerror = r; img.src = '/assets/sprites/environment/map/grass-tiles/' + file; });
    return makeAsset(img, file, 'tile', { anchorX: 0.5, anchorY: anchor, scale });
  };
  // a few different tiles so we can see them tile together
  const ids = [];
  for (const f of ['Tiles-out_001.png', 'Tiles-out_002.png', 'Tiles-out_003.png', 'Tiles-out_004.png']) ids.push(await load(f));
  let k = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { S.selectedAssetId = ids[k++ % ids.length]; paintAt(c, r); }
  fitView();
}, [SCALE, ANCHOR]);
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/tilecal.png' });
console.log('scale', SCALE, 'anchorY', ANCHOR);
await browser.close();
