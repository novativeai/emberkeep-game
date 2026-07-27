#!/usr/bin/env node
/**
 * Headless test of the worldbuilder Merge page:
 *   1. serve the repo (python3 -m http.server 8820 is expected to be running,
 *      or pass a base URL as argv[2])
 *   2. open the 🔮 tab, assert the chains render (combos + generator badges)
 *   3. create a new chain + a tier-2 combo + a generator via the modal
 *   4. export the merge doc from the page and validate it with the REAL
 *      apply logic (scripts/apply-merge.mjs, dry-run)
 * Run: node tools/mergetest.mjs   (starts its own static server on :8823)
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { applyMergeDoc } from '../scripts/apply-merge.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.js': 'text/javascript' };
const server = http
  .createServer((req, res) => {
    try {
      const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      const body = readFileSync(file);
      res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  })
  .listen(8823);

const fail = (msg) => {
  console.error(`✘ ${msg}`);
  process.exitCode = 1;
};
const ok = (msg) => console.log(`✔ ${msg}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', (e) => fail(`page error: ${e}`));
await page.goto('http://localhost:8823/tools/worldbuilder/index.html');
await page.waitForTimeout(1200);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(1500);

// 1. Open the merge page
await page.click('#tabMerge');
await page.waitForTimeout(400);
const chainCount = await page.locator('.mpChain').count();
chainCount >= 11 ? ok(`merge page renders ${chainCount} chains`) : fail(`only ${chainCount} chains rendered`);
const houseGen = await page.locator('.mpEl:has(.nm:text-is("House")) .gen').count();
houseGen === 1 ? ok('House shows its generator badge') : fail('House generator badge missing');
const arrows = await page.locator('.mpArrow').count();
arrows > 8 ? ok(`${arrows} combo arrows shown`) : fail(`only ${arrows} combo arrows`);

// 2. New chain via the prompt-driven flow
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? (d.message().includes('display name') ? 'Moonberry' : 'moonberry') : undefined));
await page.click('#mpNewChain');
await page.waitForTimeout(300);
await page.fill('#mmName', 'Moonberry Seed');
await page.fill('#mmSell', '2');
await page.fill('#mmXp', '0');
await page.click('#mmSave');
await page.waitForTimeout(300);

// 3. Add the tier-2 combo, as a generator producing sparkweed T1
await page.click('.mpChain:has(.id:text-is("moonberry")) .mpAddTier');
await page.waitForTimeout(300);
await page.fill('#mmName', 'Moonberry Bush');
await page.fill('#mmSell', '6');
await page.fill('#mmXp', '9');
await page.check('#mmGen');
await page.selectOption('#mmProduces', 'sparkweed:1');
await page.fill('#mmCooldown', '90');
await page.fill('#mmEnergy', '1');
await page.click('#mmSave');
await page.waitForTimeout(300);

const moonberryEls = await page.locator('.mpChain:has(.id:text-is("moonberry")) .mpEl').count();
moonberryEls === 2 ? ok('new chain shows 2 elements') : fail(`moonberry has ${moonberryEls} elements`);
const moonGen = await page.locator('.mpChain:has(.id:text-is("moonberry")) .gen').count();
moonGen === 1 ? ok('new generator badge visible') : fail('new generator badge missing');

// 4. Export from the page and validate with the real apply logic
const doc = await page.evaluate(() => buildMergeExport());
try {
  const summary = applyMergeDoc(doc, root, { dryRun: true });
  ok(`export validates (dry-run): ${summary.chains} chains / ${summary.tiers} tiers`);
  const moon = doc.chains.find((c) => c.id === 'moonberry');
  moon?.tiers[1]?.generator?.produces?.chain === 'sparkweed'
    ? ok('generator output persisted in the export')
    : fail('generator output missing from export');
} catch (e) {
  fail(`export failed validation: ${e.message}`);
}

// 5. Session round-trip (reload keeps the design)
await page.reload();
await page.waitForTimeout(1500);
await page.click('#tabMerge');
await page.waitForTimeout(400);
const persisted = await page.locator('.mpChain:has(.id:text-is("moonberry"))').count();
persisted === 1 ? ok('design survives a reload (auto-save)') : fail('design lost on reload');

await browser.close();
server.close();
console.log(process.exitCode ? 'FAILED' : 'ALL GREEN');
