/**
 * End-to-end proof for the UI Builder satellite tool: drives the ACTUAL tool
 * page (which embeds the ACTUAL game in ?uiedit=1), edits an element and a
 * chrome texture, saves, and verifies src/data/ui-theme.json was written and
 * survives a full reload — i.e. "changes in the UI app appear in the game".
 *
 * Needs the dev server:  pnpm dev   (port 5173)
 * Run: node tools/checks/uibtest.mjs [outDir]
 */
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const OUT = process.argv[2] ?? '/tmp';
const TOOL = 'http://localhost:5173/tools/uibuilder/index.html';

const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1760, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => errs.push('tool pageerror: ' + e.message));

await page.goto(TOOL);
// The tool auto-connects; wait for the live handshake.
await page.waitForFunction(() => document.querySelector('#statusText')?.textContent?.includes('stage'), undefined, { timeout: 30000 });
await page.waitForTimeout(1200); // let the board settle behind the HUD
await page.screenshot({ path: `${OUT}/uib-1-connected.png` });

// Select the Warmth gauge from the element list.
await page.click('.el-item:has-text("Warmth gauge")');
await page.waitForSelector('#p_dx');
await page.screenshot({ path: `${OUT}/uib-2-selected.png` });

// Move it: dy +160 (clearly visible), via the properties panel.
await page.fill('#p_dy', '160');
await page.dispatchEvent('#p_dy', 'input');
await page.waitForTimeout(300);

// Style its value text gold via the layers panel.
await page.click('.lay:has-text("value")');
await page.waitForSelector('#t_color');
await page.$eval('#t_color', (el) => { el.value = '#FFD84D'; el.dispatchEvent(new Event('input')); });
await page.waitForTimeout(200);

// Restyle the shared pill chrome: teal border.
await page.click('.thumb:has-text("pill")');
await page.waitForSelector('.chromeC');
await page.$eval('.chromeC[data-param="border"]', (el) => { el.value = '#3FA8D9'; el.dispatchEvent(new Event('input')); });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/uib-3-edited.png` });

// Save → dev endpoint writes src/data/ui-theme.json.
await page.click('#btnSave');
await page.waitForFunction(() => document.querySelector('#statusText')?.textContent?.includes('saved'), undefined, { timeout: 8000 });

const written = JSON.parse(readFileSync(new URL('../src/data/ui-theme.json', import.meta.url), 'utf8'));
const checks = {
  savedDy: written.elements?.['hud.energy']?.dy === 160,
  savedTextColor: written.elements?.['hud.energy']?.parts?.value?.text?.color?.toLowerCase() === '#ffd84d',
  savedPillBorder: written.textures?.ui_pill?.border?.toLowerCase() === '#3fa8d9'
};

// PERSISTENCE: hard-reload the tool (fresh game boot reads the saved file);
// the offset must come back from ui-theme.json, not from live memory.
await page.reload();
await page.waitForFunction(() => document.querySelector('#statusText')?.textContent?.includes('stage'), undefined, { timeout: 30000 });
await page.waitForTimeout(1200);
await page.click('.el-item:has-text("Warmth gauge")');
await page.waitForSelector('#p_dy');
const persistedDy = await page.inputValue('#p_dy');
checks.persistedAfterReload = persistedDy === '160';
await page.screenshot({ path: `${OUT}/uib-4-reloaded.png` });

console.log(JSON.stringify({ ...checks, writtenTheme: written, errors: errs }, null, 2));
await browser.close();
const ok = Object.values(checks).every(Boolean) && errs.length === 0;
process.exit(ok ? 0 : 1);
