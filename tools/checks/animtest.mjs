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

const result = await page.evaluate(() => {
  S.placements = []; S.tileW = 240; S.tileH = 120; S.showGrid = true;
  setCategory('decor');
  const c = document.createElement('canvas'); c.width = 180; c.height = 340;
  const g = c.getContext('2d');
  g.fillStyle = '#7a4a2a'; g.fillRect(78, 170, 28, 170);
  g.fillStyle = '#3a9a3a'; g.beginPath(); g.arc(92, 120, 84, 0, 7); g.fill();
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const id = makeAsset(img, 'tree.png', 'decor', { anchorX: 0.5, anchorY: 0.95 });
      S.selectedAssetId = id;
      for (const [cc, rr] of [[0, 0], [1, 0], [0, 1], [2, 0], [1, 1], [2, 1]]) paintAt(cc, rr);
      const a = S.assets[id];

      // Replay the EXPORTED model game-side and compare to what drawElement renders.
      // base = the un-animated rect; predict from model; max abs error must be ~0.
      const fidelity = () => {
        const m = buildDoc(true).assets.find((x) => x.name === 'tree').animation.model;
        let maxErr = 0;
        for (const [col, row] of [[0, 0], [2, 1], [3, 2], [5, 4]]) {
          a.anim.type = 'none'; const base = drawElement(a, col, row);
          a.anim.type = m.transform === 'scaleY' ? 'puppet' : 'floating';
          for (let i = 0; i < 50; i++) {
            ANIM.t = i * 0.0617;
            const r = drawElement(a, col, row);
            const phase = ANIM.t * 2 * Math.PI * m.frequencyHz + col * m.phasePerCol + row * m.phasePerRow;
            const wave = Math.sin(phase);
            let predTop, predH;
            if (m.transform === 'scaleY') { predH = base.h * (1 + m.amount * wave); predTop = (base.top + base.h) - predH; }
            else { predH = base.h; predTop = base.top - m.amount * base.h * wave; }
            maxErr = Math.max(maxErr, Math.abs(r.h - predH), Math.abs(r.top - predTop));
          }
        }
        return maxErr;
      };

      a.anim.type = 'puppet'; a.anim.amplitude = 80; a.anim.speed = 30;
      const puppetModel = buildDoc(true).assets.find((x) => x.name === 'tree').animation.model;
      const puppetErr = fidelity();
      a.anim.type = 'floating'; a.anim.amplitude = 60; a.anim.speed = 70;
      const floatModel = buildDoc(true).assets.find((x) => x.name === 'tree').animation.model;
      const floatErr = fidelity();

      // re-import path: loadWorldDoc feeds animation → makeAsset; must restore controls
      a.anim.type = 'puppet'; a.anim.amplitude = 80; a.anim.speed = 30;
      const exp = buildDoc(true).assets.find((x) => x.name === 'tree').animation;
      const rid = makeAsset(a.img, 'reimport.png', 'decor', { anim: exp });
      const roundtrip = S.assets[rid].anim;

      res({ puppetModel, floatModel, puppetErr, floatErr, exportShape: exp, roundtrip });
    };
    img.src = c.toDataURL();
  });
});
console.log('puppet model:', JSON.stringify(result.puppetModel));
console.log('floating model:', JSON.stringify(result.floatModel));
console.log('game-side replay max error — puppet:', result.puppetErr.toExponential(2), 'px | floating:', result.floatErr.toExponential(2), 'px (≈0 = exact)');
console.log('re-import restores controls:', JSON.stringify(result.roundtrip));
console.log('errors:', errs.filter((e) => !e.includes('favicon')).length, errs.filter((e) => !e.includes('favicon')).slice(0, 3));
await browser.close();
