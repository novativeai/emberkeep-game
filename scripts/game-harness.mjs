/**
 * GAME HARNESS — the boot that `pnpm event` and `pnpm say` share.
 *
 * Everything here is the half of scripts/beats.mjs that is not about the
 * tutorial: find a running game, open one browser, install a recorded
 * checkpoint's save so the game boots INTO that moment, and read it back as
 * text. `beats.mjs` keeps its own copy because it also RECORDS (it may build
 * and serve a dist of its own); these tools only ever inspect, so they refuse
 * to build — a re-encode of the whole art set is not something a preview may
 * decide to spend.
 *
 * The checkpoints are beats.mjs's: same directory, same fingerprint stamp. A
 * stale one is a WARNING here rather than a refusal, because a preview of a
 * line of dialogue does not care that the tutorial gained a step — it only
 * needs a plausible game to stand in.
 */
import { chromium } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beatsFingerprint } from './beats-fingerprint.cjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CHECKPOINT_DIR = path.join(ROOT, 'tests/e2e/checkpoints');
export const VIEWPORT = { width: 1280, height: 800 };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pull a `--flag` out of argv in place. */
export const flag = (args, name) => {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};

/** Pull a `--name value` pair out of argv in place. */
export const opt = (args, name, def = null) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};

/* ------------------------------------------------------------------ server */

const answers = (url) => fetch(url, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);

/**
 * The game to drive: an explicit `--url`, else the dev server on 5173.
 *
 * There is deliberately no fallback that builds and serves a dist — one dev
 * server is the house rule, and these tools are read-only visitors to it.
 */
export async function resolveUrl(explicit) {
  if (explicit) {
    if (!(await answers(explicit))) throw new Error(`nothing answers at ${explicit}`);
    return explicit;
  }
  if (await answers('http://localhost:5173')) return 'http://localhost:5173';
  throw new Error('no game to drive: start the dev server (`pnpm dev`, port 5173) or pass --url');
}

/* -------------------------------------------------------------- checkpoints */

/** Every recorded beat, in script order, each with whether it is still current. */
export function checkpoints() {
  if (!existsSync(CHECKPOINT_DIR)) return [];
  const fingerprint = beatsFingerprint();
  return readdirSync(CHECKPOINT_DIR)
    .filter((f) => /^\d+-.*\.json$/.test(f))
    .sort()
    .map((f) => {
      const cp = JSON.parse(readFileSync(path.join(CHECKPOINT_DIR, f), 'utf8'));
      return { id: cp.step, index: cp.index, file: path.join(CHECKPOINT_DIR, f), fresh: cp.fingerprint === fingerprint };
    });
}

/** The checkpoint to boot from when the caller named none — the end of the script. */
export function defaultCheckpoint() {
  const all = checkpoints();
  if (!all.length) throw new Error(`no checkpoints in ${path.relative(ROOT, CHECKPOINT_DIR)} — run \`pnpm beats:record\``);
  return all[all.length - 1].id;
}

export function loadCheckpoint(id) {
  const hit = checkpoints().find((c) => c.id === id);
  if (!hit) {
    throw new Error(`no checkpoint "${id}" — have: ${checkpoints().map((c) => c.id).join(', ') || 'none'}`);
  }
  const cp = JSON.parse(readFileSync(hit.file, 'utf8'));
  if (!hit.fresh) {
    console.warn(`! checkpoint "${id}" is stale (recorded before the current tutorial/save fingerprint) — booting it anyway`);
  }
  return cp;
}

/* ------------------------------------------------------------------ browser */

/**
 * One browser, GPU on — SwiftShader cannot push 2560×1600, and the caller is
 * responsible for closing it (every command here does so in a `finally`).
 */
export async function launch({ headed = false } = {}) {
  const angle = process.platform === 'darwin' ? 'metal' : 'swiftshader';
  const browser = await chromium.launch({ headless: !headed, args: ['--enable-gpu', `--use-angle=${angle}`, '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  return { browser, page, errors };
}

export const renderText = (page) =>
  page.evaluate(() => {
    const r = window.render_game_to_text();
    return typeof r === 'string' ? JSON.parse(r) : r;
  });

const onScene = (page, scene) =>
  page.waitForFunction((s) => {
    const r = window.render_game_to_text();
    return (typeof r === 'string' ? JSON.parse(r) : r).scene === s;
  }, scene, { timeout: 30000 });

async function pressPlay(page) {
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
  await onScene(page, 'TitleScene');
  await sleep(1400); // the title's own fade-in; Play answers at this point per the instrumentation contract
  await page.mouse.click(640, 670);
  await onScene(page, 'BoardScene');
  await sleep(1200);
}

/**
 * Boot INTO a recorded beat: install its save blob before the game reads one,
 * then press Play. Returns the beat the game actually landed on, which the
 * caller may compare with what it asked for — a mismatch is worth saying, but
 * it is not fatal to a preview.
 */
export async function bootAt(page, url, id) {
  const { blob, saveKey } = loadCheckpoint(id);
  await page.goto(url);
  await page.evaluate(([k, b]) => { localStorage.clear(); localStorage.setItem(k, b); }, [saveKey, blob]);
  await page.reload();
  await pressPlay(page);
  await sleep(600); // the beat's own spawns and the camera glide
  return (await renderText(page)).tutorial.step;
}

/**
 * Wait until UIScene actually holds a bubble.
 *
 * `bootAt` sleeps a fixed 600ms after Play, which is enough for a beat's own
 * spawns on a warm machine and is NOT a guarantee that UIScene has finished
 * `create()` — under load the scene can still be booting, and a caller that
 * reaches for `scene.bubble` right then gets `undefined` and reports it as
 * "the board never booted". Ask for the object itself instead of guessing a
 * delay.
 */
export async function waitForBubble(page, maxMs = 20000) {
  try {
    await page.waitForFunction(
      () => !!window.__emberkeep?.game?.scene?.getScene('UIScene')?.bubble,
      null,
      { timeout: maxMs }
    );
    return true;
  } catch {
    return false;
  }
}

/** Game-space (2560×1600) → CSS page pixels, the conversion `uiToPage` uses. */
export const toPageRect = (page, rect) =>
  page.evaluate((r) => {
    const game = window.__emberkeep.game;
    const box = game.canvas.getBoundingClientRect();
    const sx = box.width / game.scale.width;
    const sy = box.height / game.scale.height;
    return { x: box.left + r.x * sx, y: box.top + r.y * sy, width: r.width * sx, height: r.height * sy };
  }, rect);

/**
 * Get the ring's whole line on screen before a screenshot.
 *
 * The bubble types character by character off `scene.time`, so a shot taken a
 * fixed moment after a line opens catches "Th" and calls it dialogue — and in
 * a headless window, where the loop runs well under 60fps, the reveal of one
 * sentence outlasts any patience worth spending on a preview. So do what a
 * player does with a line they have already read: TAP IT WHOLE. `completeLine`
 * is the bubble's own snap, the one its tap handler calls, and `typeCursor`
 * reaching the end of `fullLine` is its own test for "finished". If those
 * internals are ever renamed this degrades to waiting for the label to stop
 * growing, which is slower but never wrong.
 */
export async function settleBubble(page, maxMs = 6000) {
  const read = () =>
    page
      .evaluate(() => {
        const b = window.__emberkeep.game.scene.getScene('UIScene')?.bubble;
        if (!b) return null;
        return { cursor: b.typeCursor ?? null, full: b.fullLine?.length ?? null, shown: b.label?.text?.length ?? 0, snappable: typeof b.completeLine === 'function', alpha: b.alpha, scale: b.scaleX };
      })
      .catch(() => null);
  // The plate slides and fades in on its own tween, which under a headless
  // loop is slow enough to photograph half-arrived: the line is only ready
  // when the words are all there AND the bubble has finished landing.
  const arrived = (b) => b.alpha >= 0.99 && b.scale >= 0.99;
  const done = (b) => b && b.full !== null && b.cursor !== null && b.full > 0 && b.cursor >= b.full && arrived(b);

  let b = await read();
  if (!b) return false;
  if (done(b)) return true;
  if (b.snappable) {
    await page.evaluate(() => window.__emberkeep.game.scene.getScene('UIScene').bubble.completeLine());
    await sleep(150);
    b = await read();
    if (done(b)) return true;
  }
  let last = -1;
  let still = 0;
  for (let i = 0; i < Math.ceil(maxMs / 200); i++) {
    await sleep(200);
    b = await read();
    if (!b) return false;
    if (done(b)) return true;
    still = b.shown > 0 && b.shown === last ? still + 1 : 0;
    if (still >= 3) return true;
    last = b.shown;
  }
  return false;
}
