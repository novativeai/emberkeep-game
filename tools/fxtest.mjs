import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1320, height: 820 }, deviceScaleFactor: 1.5 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto('http://localhost:8820/tools/fxstudio/index.html');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(900); // sprites load + first frames

const base = await page.evaluate(() => ({
  elements: ELEMENTS.length, presets: FX_PRESETS.length,
  chips: document.querySelectorAll('.fxchip').length, cards: document.querySelectorAll('.ecard').length,
  spritesLoaded: ELEMENTS.filter((e) => IMG[e.key]).length
}));

// APPEAR: select a gem, play appear, capture mid-pop
await page.evaluate(() => selectElement('flame_gem_2'));
await page.evaluate(() => { selectEvent('appear'); restartStage(); });
await page.waitForTimeout(230);
const appearFx = await page.evaluate(() => stage.effects.length);
await page.screenshot({ path: '/tmp/FX-appear.png' });

// MERGE: play merge, wait until the convergence actually fires, then sample
await page.evaluate(() => { selectEvent('merge'); restartStage(); });
await page.waitForFunction(() => typeof stage !== 'undefined' && stage.fxFired, { timeout: 4000 });
await page.waitForTimeout(50);
const mergeState = await page.evaluate(() => ({ effects: stage.effects.length, flash: +stage.flash.toFixed(2), fired: stage.fxFired }));
await page.screenshot({ path: '/tmp/FX-merge.png' });

// toggle an FX + a custom sprite
const interact = await page.evaluate(() => {
  selectEvent('appear');
  const before = S.config['flame_gem_2'].appear.slice();
  toggleFX('magic_swirl'); toggleFX('glow_flash');
  const after = S.config['flame_gem_2'].appear.slice();
  // simulate a custom sprite replace
  const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#ff00aa'; g.fillRect(20, 20, 88, 88);
  S.config['ember_dragon_1'].sprite = c.toDataURL();
  return { before, after };
});

// EXPORT shape
const exp = await page.evaluate(() => {
  const d = buildDoc();
  const el = d.elements.find((e) => e.key === 'flame_gem_2');
  return {
    format: d.format, elements: d.elements.length, presets: d.fxPresets.length,
    hasEvents: !!(d.events.appear && d.events.merge), hasParamSpec: !!d.fxParamSpec,
    presetKeys: d.fxPresets.map((p) => p.key),
    samplePreset: d.fxPresets.find((p) => p.key === 'sparkle_burst'),
    gemAppearFx: el.fx.appear, gemMergeFx: el.fx.merge, gemNext: el.next,
    customSprites: d.elements.filter((e) => e.sprite.custom).map((e) => e.key),
    imagesKeys: Object.keys(d.images)
  };
});

console.log('catalogue:', JSON.stringify(base));
console.log('appear effects spawned:', appearFx, '| merge { effects, flash }:', JSON.stringify(mergeState));
console.log('toggle appear FX', JSON.stringify(interact.before), '→', JSON.stringify(interact.after));
console.log('export:', JSON.stringify({ format: exp.format, elements: exp.elements, presets: exp.presets, hasEvents: exp.hasEvents, hasParamSpec: exp.hasParamSpec }));
console.log('preset keys:', exp.presetKeys.join(','));
console.log('sample preset sparkle_burst:', JSON.stringify(exp.samplePreset));
console.log('flame_gem_2 fx — appear:', JSON.stringify(exp.gemAppearFx), 'merge:', JSON.stringify(exp.gemMergeFx), 'next:', exp.gemNext);
console.log('custom sprites:', JSON.stringify(exp.customSprites), '| images embedded:', JSON.stringify(exp.imagesKeys));
console.log('errors:', errs.filter((e) => !e.includes('favicon')).length, errs.filter((e) => !e.includes('favicon')).slice(0, 4));
await browser.close();
