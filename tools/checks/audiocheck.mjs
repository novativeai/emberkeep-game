/**
 * Verify no recurring noise source plays in the background. Spies on
 * AudioContext.createBufferSource (the only way white noise is generated here)
 * and counts calls over an idle window. The removed ember-crackle fired one
 * every 2.8–8s; with it gone the idle count must be 0.
 *   node tools/checks/audiocheck.mjs
 */
import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--enable-gpu', '--use-angle=metal',
    // headless throttles background timers (the crackle's setTimeout) — disable so the probe is representative
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'
  ]
});
const page = await browser.newPage();
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.evaluate(() => {
  window.__bufCount = 0;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  const origBuf = Ctor.prototype.createBufferSource;
  Ctor.prototype.createBufferSource = function (...a) { window.__bufCount++; return origBuf.apply(this, a); };
  const origOsc = Ctor.prototype.createOscillator;
  Ctor.prototype.createOscillator = function (...a) { window.__ctx = this; return origOsc.apply(this, a); };
});
await page.mouse.click(640, 400); // user gesture → AudioManager.unlock() → startAmbient()
await page.evaluate(() => window.__emberkeep.game.scene.getScene('TitleScene').scene.start('BoardScene'));
await page.waitForTimeout(300);
const state = await page.evaluate(async () => {
  if (!window.__ctx) return 'no-context';
  try { await window.__ctx.resume(); } catch (e) {}
  window.__bufCount = 0; // count only from the running window onward
  return window.__ctx.state;
});
console.log('audio context state:', state);
await page.waitForTimeout(8000); // pure idle — no merges/hatches/fog, so no event SFX
const count = await page.evaluate(() => window.__bufCount);
console.log(`noise BufferSource nodes during 8s idle: ${count}  ${count === 0 ? '✓ no background white-noise' : '✗ still generating noise'}`);
await browser.close();
process.exit(count === 0 ? 0 : 1);
