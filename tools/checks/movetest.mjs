import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:8080/tools/worldbuilder/index.html');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => typeof S !== 'undefined' && S.ready, { timeout: 12000 }).catch(() => {});

// create a decor + paint it on a cell
const setup = await page.evaluate(async () => {
  S.placements = []; S.tileW = 240; S.tileH = 120; S.showGrid = true;
  setCategory('decor');
  const c = document.createElement('canvas'); c.width = 120; c.height = 160; const g = c.getContext('2d'); g.fillStyle = '#e040a0'; g.fillRect(0, 0, 120, 160);
  const id = await new Promise((res) => { const img = new Image(); img.onload = () => res(makeAsset(img, 'prop.png', 'decor')); img.src = c.toDataURL(); });
  S.selectedAssetId = id; paintAt(5, 5); fitView(); render();
  const p = S.placements.find((pl) => assetById(pl.assetId).category === 'decor');
  const hr = S.hitRects.find((h) => h.p.id === p.id);
  return { aid: id, pid: p.id, dx0: Math.round(p.dx || 0), dy0: Math.round(p.dy || 0), rect: hr.rect };
});
const box = await page.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.x, y: r.y }; });

// FREE MOVE: grab the decor with the move tool, drag it 120,60 px
await page.evaluate(() => setTool('move'));
const cx = box.x + setup.rect.left + setup.rect.w / 2, cy = box.y + setup.rect.top + setup.rect.h / 2;
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 120, cy + 60, { steps: 8 }); await page.mouse.up();
const moved = await page.evaluate((pid) => { const p = S.placements.find((pl) => pl.id === pid); return { dx: Math.round(p.dx || 0), dy: Math.round(p.dy || 0), exportDx: buildDoc(false).placements.find((x) => x.asset === 'prop')?.dx }; }, setup.pid);

// re-pick the moved element by its NEW (off-grid) screen position — proves rect picking
const repick = await page.evaluate((pid) => {
  const hr = S.hitRects.find((h) => h.p.id === pid); const cx = hr.rect.left + hr.rect.w / 2, cy = hr.rect.top + hr.rect.h / 2;
  return { picked: pickAt(cx, cy, (a) => a && !isFloor(a))?.id === pid };
}, setup.pid);

// DRAG-DROP from sidebar: synthetic drop of the asset at a free point
const drop = await page.evaluate((aid) => {
  const before = S.placements.length;
  const stage = document.getElementById('stage'); const r = stage.getBoundingClientRect();
  const dt = new DataTransfer(); dt.setData('text/plain', String(aid));
  stage.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 360, clientY: r.top + 240 }));
  const added = S.placements.length - before;
  const last = S.placements[S.placements.length - 1];
  return { added, free: !!(last.dx || last.dy) };
}, setup.aid);

console.log('move tool: dx0', setup.dx0, '→ dragged dx/dy', JSON.stringify({ dx: moved.dx, dy: moved.dy }), '(moved:', moved.dx !== 0 || moved.dy !== 0, ')');
console.log('export carries dx:', moved.exportDx);
console.log('re-pick moved element by new screen pos:', repick.picked);
console.log('drag-drop from sidebar: added', drop.added, 'placement, free-positioned:', drop.free);
console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
