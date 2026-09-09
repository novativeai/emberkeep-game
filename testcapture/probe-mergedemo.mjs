/**
 * The hub's "Try a merge" demo, PLAYED — not screenshotted and hoped over.
 *
 * The probe reads the pieces' CELLS out of the DOM (their `left`/`top` are the
 * lattice's own percentages, so the inversion is exact), asks the demo's own
 * ported planner — `embergames/src/lib/emberkeep/mergePlan.ts`, compiled — for
 * the next gesture, and performs that gesture with a real pointer. Then it
 * checks the board did what the rule said it would.
 *
 * That is the whole claim under test: the page and the engine agree. A probe
 * that dragged pieces at random could only ever report that something moved.
 *
 *   node testcapture/probe-mergedemo.mjs [url] [--hub <path to embergames>]
 */
import path from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const argv = process.argv.slice(2);
const URL = argv.find((a) => a.startsWith('http')) ?? 'http://localhost:3000/games/emberkeep';
const HUB = argv.includes('--hub')
  ? argv[argv.indexOf('--hub') + 1]
  : path.resolve(process.cwd(), '..', 'embergames');
const OUT = path.resolve('testcapture/demo');
mkdirSync(OUT, { recursive: true });

/**
 * THE PLANNER UNDER TEST IS THE HUB'S OWN, compiled here rather than
 * re-implemented. Anything else would only prove this file agrees with itself.
 * `tsc` is run out of the hub's own node_modules, so the probe needs nothing
 * installed on this side.
 */
const libSrc = path.join(HUB, 'src/lib/emberkeep');
if (!existsSync(path.join(libSrc, 'mergePlan.ts'))) {
  console.error(`introuvable : ${libSrc}/mergePlan.ts — passez --hub <chemin du dépôt embergames>`);
  process.exit(2);
}
const lib = mkdtempSync(path.join(tmpdir(), 'emberkeep-plan-'));
execFileSync(
  'node',
  [
    path.join(HUB, 'node_modules/typescript/bin/tsc'),
    path.join(libSrc, 'mergeRule.ts'),
    path.join(libSrc, 'mergePlan.ts'),
    '--outDir', lib,
    '--module', 'esnext',
    '--target', 'es2022',
    '--moduleResolution', 'bundler',
    '--strict'
  ],
  { stdio: 'inherit' }
);
// The emit keeps the extensionless specifier; node needs the file.
const planPath = path.join(lib, 'mergePlan.js');
writeFileSync(planPath, readFileSync(planPath, 'utf8').replace("from './mergeRule'", "from './mergeRule.js'"));
const { planFor } = await import(pathToFileURL(planPath).href);

/* The demo's lattice, from MergeDemo.tsx. */
const BW = 1108, BH = 636, HEADROOM = 180, TH = BH + HEADROOM;
const HW = 135, HH = HW / 2, OX = BW / 2, OY = 104 + HEADROOM, COLS = 4, ROWS = 4;
const isActive = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;
const cellAt = (x, y) => {
  const u = (x - OX) / HW, v = (y - OY) / HH;
  return { col: Math.round((u + v) / 2), row: Math.round((v - u) / 2) };
};
class Board {
  constructor(items) { this.items = items; }
  itemAt(c, r) { return this.items.find((i) => i.col === c && i.row === r); }
  itemIdAt(c, r) { return this.itemAt(c, r)?.id ?? null; }
  neighbors(c, r) {
    return [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]]
      .map(([col, row]) => ({ col, row })).filter((p) => isActive(p.col, p.row));
  }
  isTileActive(c, r) { return isActive(c, r); }
  isActive(c, r) { return isActive(c, r); }
}
const CHAINS = {
  mergeRule: { minGroup: 3, fiveBonus: true, fiveGroup: 5, fiveOutputs: 2 },
  chains: [
    { id: 'ember_dragon', name: 'Ember Dragon', tiers: [{ tier: 1, name: 'Ruby' }, { tier: 2, name: 'Egg' }, { tier: 3, name: 'Dragon', merge: { group: 2, outputs: 1 } }, { tier: 4, name: 'Big' }] },
    { id: 'lumber', name: 'Timber', tiers: [{ tier: 1, name: 'Wood' }, { tier: 2, name: 'Planks' }, { tier: 3, name: 'House', merge: { group: 2, outputs: 1 } }, { tier: 4, name: 'Manor' }] },
    { id: 'demo', name: 'Demo', tiers: [{ tier: 1, name: 'a' }, { tier: 2, name: 'b' }] }
  ]
};
const VERBS = { '#8fe8a0': 'merge', '#ff9ab0': 'gather', '#ffd27a': 'move', '#8d8189': 'refuse' };

const browser = await chromium.launch({ args: ['--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForLoadState('load', { timeout: 120_000 }).catch(() => {});

const demo = page.locator('div:has(> div > p:text-is("Try a merge"))').first();
const boardEl = demo.locator('div[style*="container-type"], div[style*="containerType"]').first();
// PATIENTLY, and in this order. The board deals AFTER hydration (randomising
// during render would make the server and the client disagree), so on a cold
// production page the card is re-rendered under the probe's feet — scrolling
// first threw "element is not attached to the DOM" every time. Wait for the
// pieces to exist, then scroll.
await boardEl.waitFor({ timeout: 60_000 });
await boardEl.locator('button[aria-label]').first().waitFor({ timeout: 60_000 });
await page.waitForTimeout(600);
await demo.scrollIntoViewIfNeeded();
const pieces = () => boardEl.locator('button[aria-label]');
const label = () => demo.locator('p[aria-live="polite"]').innerText();
const reticle = () => boardEl.locator('svg:not(.demo-hint-cell) path[stroke]').first().getAttribute('stroke').catch(() => null);

/** The board as the rule sees it, read off the page. Ids follow DOM order,
 *  which is the order the component keeps its items in — the same order the
 *  component's own planner sees, so a plan computed here names the same piece. */
const readBoard = async () =>
  (await pieces().all()).reduce(async (acc, el, i) => {
    const list = await acc;
    const [left, top, name] = await Promise.all([
      el.evaluate((n) => n.style.left), el.evaluate((n) => n.style.top), el.getAttribute('aria-label')
    ]);
    const cell = cellAt((parseFloat(left) / 100) * BW, (parseFloat(top) / 100) * TH);
    list.push({ id: i + 1, chain: 'demo', tier: 1, ...cell, kind: 'item', dom: i, name });
    return list;
  }, Promise.resolve([]));

const centreOf = async (i) => {
  const b = await pieces().nth(i).boundingBox();
  return b ? { x: b.x + b.width / 2, y: b.y + b.height * 0.85 } : null;
};
/** The tile point of a CELL, in page px — where the hand would put a piece. */
const pointOfCell = async (cell) => {
  const box = await boardEl.boundingBox();
  return {
    x: box.x + ((OX + (cell.col - cell.row) * HW) / BW) * box.width,
    y: box.y + ((OY + (cell.col + cell.row) * HH) / TH) * box.height
  };
};

const report = [];
let ok = true;
// HOW MANY ROUNDS THE LADDER HOLDS, asked of the page rather than hard-coded:
// the ladder is authored in the component and has changed length once already
// (the egg→dragon opener came out), and a bench that assumes five would have
// reported a missing manche as a failure.
const TOTAL = Number((await demo.locator('div.mt-3\\.5 p').last().innerText()).match(/of (\d+)/)?.[1] ?? 5);
console.log(`échelle : ${TOTAL} manche(s)\n`);
for (let round = 1; round <= TOTAL; round++) {
  await page.waitForTimeout(1000);
  if ((await pieces().count()) !== 3) { report.push(`manche ${round}: pas 3 pièces — arrêt`); ok = false; break; }
  const opening = await label();
  const handUp = await boardEl.locator('.demo-hand').count();
  const leaning = await boardEl.locator('.demo-lean-hint').count();
  report.push(`manche ${round}: « ${opening} »  ·  gantelet ${handUp ? 'levé' : 'ABSENT'} · ${leaning} élément(s) en tension`);

  let merged = false;
  for (let g = 1; g <= 3 && !merged; g++) {
    const items = await readBoard();
    const plan = planFor(items, new Board(items), CHAINS);
    if (!plan) { report.push('   aucun plan — arrêt'); ok = false; break; }
    const step = plan.steps[0];
    const mover = items.find((i) => i.id === step.itemId);
    const from = await centreOf(mover.dom);
    const to = await pointOfCell(step.to);
    report.push(`   plan (${plan.steps.length} temps) → pièce #${mover.id}(${mover.col},${mover.row}) sur (${step.to.col},${step.to.row})${step.completes ? ' [COMPLÈTE]' : ' [rassemble]'}`);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let s = 1; s <= 12; s++) {
      await page.mouse.move(from.x + ((to.x - from.x) * s) / 12, from.y + ((to.y - from.y) * s) / 12);
      await page.waitForTimeout(16);
    }
    const verb = VERBS[await reticle()] ?? '(pas de réticule)';
    await page.mouse.up();
    if (step.completes) {
      // Catch the beat itself: the gold flash and the sparks are the whole
      // payoff, and a zero-sized flash box paints nothing while still being
      // "present" in the DOM. Measure it.
      await page.waitForTimeout(240);
      const fx = await boardEl.locator('.demo-flash').first().boundingBox().catch(() => null);
      const sparks = await boardEl.locator('.demo-spark').count();
      report.push(`      éclat ${fx ? `${Math.round(fx.width)}x${Math.round(fx.height)} px` : 'ABSENT'} · ${sparks} étincelles`);
      if (!fx || fx.width < 8) ok = false;
    }
    await page.waitForTimeout(1300);
    const left = await pieces().count();
    const want = step.completes ? 'merge' : 'gather|move';
    const agrees = step.completes ? verb === 'merge' : verb === 'gather' || verb === 'move';
    if (!agrees) ok = false;
    report.push(`      réticule « ${verb} » (attendu ${want}) ${agrees ? '✓' : '✗ LE CADRE ET LE PLAN NE SONT PAS D’ACCORD'} · ${left} pièce(s) restantes`);
    if (left === 0) merged = true;
  }
  await page.waitForTimeout(700);
  const out = await boardEl.locator('.demo-pop').count();
  report.push(`   ${merged ? '✓ fusionné' : '✗ PAS de fusion'} · sortie affichée : ${out ? 'oui' : 'non'} · « ${await label()} »`);
  if (!merged) { ok = false; break; }
  await page.screenshot({ path: path.join(OUT, `round-${round}.png`), clip: await boardEl.boundingBox() });
  await page.waitForTimeout(2800);
}

console.log(report.join('\n'));
console.log('\n' + (await demo.locator('div.mt-3\\.5 p').last().innerText().catch(() => '')));
/**
 * SITE ERRORS ARE NOT DEMO ERRORS, and conflating them cost a pass. The hub
 * throws a minified React #418 (a hydration text mismatch) on EVERY page,
 * including `/`, which holds no demo at all — so it cannot be this component's
 * and failing the bench on it would mean the bench goes red for ever, or gets
 * ignored. It is reported, loudly, under its own heading; only an error the
 * demo could plausibly own turns the verdict.
 */
const SITEWIDE = /Minified React error #418|Hydration failed/;
const mine = errors.filter((e) => !SITEWIDE.test(e));
const theirs = errors.filter((e) => SITEWIDE.test(e));
if (theirs.length) {
  console.warn(`\n⚠ ${theirs.length} erreur(s) de PAGE, pas de la démo (présentes aussi sur la page d'accueil) :`);
  for (const e of theirs.slice(0, 3)) console.warn('   ' + e);
}
if (mine.length) {
  console.error(`\n✗ ${mine.length} erreur(s) console imputables à la démo :`);
  for (const e of mine.slice(0, 6)) console.error('   ' + e);
  ok = false;
}
console.log(ok ? '\n✓ le plateau et la règle sont d’accord partout' : '\n✗ désaccord — voir ci-dessus');
process.exitCode = ok ? 0 : 1;
await browser.close();
