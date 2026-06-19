import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1.5 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto('http://localhost:8820/tools/worldbuilder/index.html');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => typeof S !== 'undefined' && S.ready, { timeout: 12000 }).catch(() => {});

// 1) toolbar: scrollable middle + pinned right
const tb = await page.evaluate(() => ({
  tbScroll: !!document.getElementById('tbScroll'),
  tbRight: !!document.getElementById('tbRight'),
  exportInRight: !!document.querySelector('#tbRight #exportWorld'),
  scrollOverflow: getComputedStyle(document.getElementById('tbScroll')).overflowX
}));

// 2) resizable sidebar — drag the handle left, width should grow
const beforeW = await page.evaluate(() => getComputedStyle(document.body).gridTemplateColumns.split(' ').pop());
const rb = await page.evaluate(() => { const r = document.getElementById('sideResize').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 200 }; });
await page.mouse.move(rb.x, rb.y); await page.mouse.down(); await page.mouse.move(rb.x - 140, rb.y, { steps: 8 }); await page.mouse.up();
const afterW = await page.evaluate(() => parseInt(document.body.style.getPropertyValue('--side-w')));

// 3) zoom lock — set limits, check export
const zoom = await page.evaluate(() => {
  const setVal = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input')); };
  setVal('zoomMin', 0.5); setVal('zoomMax', 2.0);
  return buildDoc(false).cameraZoom;
});

// 4) 3D crystal — wait for Three, switch to the 3D tab, paint a few, check export
await page.waitForFunction(() => typeof window.THREE !== 'undefined', { timeout: 20000 }).catch(() => {});
const three = await page.evaluate(() => typeof window.THREE !== 'undefined');
await page.evaluate(() => setCategory('3d'));
await page.waitForFunction(() => Object.values(S.assets).some((a) => a.is3d), { timeout: 8000 }).catch(() => {});
const crystal = await page.evaluate(() => {
  S.placements = S.placements.filter((p) => !assetById(p.assetId)?.is3d);
  const c = Object.values(S.assets).find((a) => a.is3d);
  return c ? { name: c.name, model3d: c.model3d, canvasW: c.img.width, selected: S.selectedAssetId === c.id } : null;
});
// paint a small cluster + frame it
await page.evaluate(() => {
  S.placements = []; S.tileW = 240; S.tileH = 120; S.showGrid = true;
  const c = Object.values(S.assets).find((a) => a.is3d); S.selectedAssetId = c.id;
  for (const [cc, rr] of [[0, 0], [1, 0], [0, 1], [1, 1]]) paintAt(cc, rr);
  fitView();
});
await page.waitForTimeout(900); // let it spin a few frames
await page.screenshot({ path: '/tmp/wb-3d.png' });
const exp = await page.evaluate(() => {
  const d = buildDoc(true);
  const a3d = d.assets.find((a) => a.is3d);
  return { asset3d: a3d ? { is3d: a3d.is3d, model3d: a3d.model3d } : null,
    placements3d: d.placements.filter((p) => p.category === '3d').length,
    imageEmbedded: 'emerald-crystal' in (d.images || {}) };
});

console.log('toolbar:', JSON.stringify(tb));
console.log('sidebar resize: before', beforeW, '→ after --side-w', afterW, 'px (grew:', afterW > 312, ')');
console.log('zoom lock export:', JSON.stringify(zoom));
console.log('THREE loaded:', three, '| crystal:', JSON.stringify(crystal && { name: crystal.name, canvasW: crystal.canvasW, selected: crystal.selected, shape: crystal.model3d?.shape }));
console.log('export 3D:', JSON.stringify(exp));
console.log('errors:', errs.filter((e) => !e.includes('favicon') && !e.includes('three')).length, errs.filter((e) => !e.includes('favicon')).slice(0, 4));
await browser.close();
