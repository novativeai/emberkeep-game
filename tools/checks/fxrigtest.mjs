import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1320, height: 820 }, deviceScaleFactor: 1.5 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto('http://localhost:8820/tools/fxstudio/index.html');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(700);

// load the red-dragon rig into a dragon element (simulates the folder upload)
const rig = await page.evaluate(async () => {
  const res = await fetch('/assets/sprites/characters/dragon/red-dragon/rig/dragon-red.rig.json');
  const doc = await res.json();
  selectElement('ember_dragon_2');
  await new Promise((resolve) => { RIG['ember_dragon_2'] = new RigChar(doc, resolve); });
  refreshPanel(); renderCatalogue();
  const r = RIG['ember_dragon_2'];
  // idle must resolve real channels and change over time
  const f1 = r.idleFrame(0.4), f2 = r.idleFrame(1.6);
  return {
    ready: r.ready, layers: r.layers.length, character: r.character,
    headAnchor: f1.anchorAngle['anchor_head'] !== undefined,
    wingAnchors: f1.anchorAngle['anchor_wing_left'] !== undefined && f1.anchorAngle['anchor_wing_right'] !== undefined,
    tailWave: !!f1.wave['body_tail'],
    animates: Math.abs((f1.anchorAngle['anchor_head'] || 0) - (f2.anchorAngle['anchor_head'] || 0)) > 1e-4,
    rootBobbing: Math.abs(f1.root.dy - f2.root.dy) > 1e-4
  };
});

// APPEAR: dragon pops in + idles + FX + realistic shadow
await page.evaluate(() => { selectEvent('appear'); restartStage(); });
await page.waitForTimeout(750);
await page.screenshot({ path: '/tmp/FX-dragon-appear.png' });
// MERGE: 3 dragons converge (each with its own soft shadow)
await page.evaluate(() => { S.mergeCount = 3; selectEvent('merge'); restartStage(); });
await page.waitForTimeout(260);
await page.screenshot({ path: '/tmp/FX-dragon-merge.png' });

const exp = await page.evaluate(() => {
  const d = buildDoc();
  return { shadow: d.shadow, dragonRig: d.elements.find((e) => e.key === 'ember_dragon_2').rig,
    gemRig: d.elements.find((e) => e.key === 'flame_gem_1').rig };
});

console.log('rig:', JSON.stringify(rig));
console.log('export.shadow:', JSON.stringify({ ...exp.shadow, note: undefined }));
console.log('export dragon.rig:', JSON.stringify(exp.dragonRig), '| gem.rig:', JSON.stringify(exp.gemRig));
console.log('errors:', errs.filter((e) => !e.includes('favicon')).length, errs.filter((e) => !e.includes('favicon')).slice(0, 4));
await browser.close();
