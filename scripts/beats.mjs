#!/usr/bin/env node
/**
 * BEATS — checkpoints for every tutorial beat, and a one-blink way back to any of them.
 *
 *   node scripts/beats.mjs record            play the whole script once, FOLLOWING THE
 *                                            LESSON'S OWN POINTERS, and save a checkpoint
 *                                            (the raw save blob + a screenshot) at every beat
 *   node scripts/beats.mjs at <step> [--shot p]   boot straight INTO that beat and screenshot it
 *   node scripts/beats.mjs list              the checkpoints on disk, fresh or stale
 *   node scripts/beats.mjs check             exit 1 if any checkpoint is missing or stale
 *
 * Options:
 *   --url U        a running game (default: the dev server on 5173 if it answers;
 *                  otherwise the script BUILDS if dist is older than src and serves
 *                  dist itself with `vite preview` — no server to start, CI-ready)
 *   --headed       watch the browser (headless by default)
 *   --force        `at`: boot a stale checkpoint anyway
 *   --out dir      default tests/e2e/checkpoints · --from <step>  record: resume from a checkpoint
 *
 * Why this is exact: a loaded save rebases the game clock to its `savedAt`, so a
 * restored checkpoint is the beat frozen at the instant it was recorded — same
 * board, same timers, same Warmth — and the director resumes on that beat.
 *
 * Why it cannot go quietly stale: every checkpoint carries the fingerprint of
 * what a save depends on (scripts/beats-fingerprint.mjs: step list, SAVE_VERSION,
 * chain ids, map, zones). `at`, `bootAtBeat` and tests/unit/Beats.spec.ts refuse
 * a checkpoint whose fingerprint is not the current one, so a change that
 * invalidates the recordings fails `pnpm test` until they are re-recorded.
 *
 * Why the player is generic: it does not know the script. Each beat it reads
 * `__emberkeep.pointers()` — the hand and arrow the player is shown — and does
 * what they say (drag from→to, tap here), re-reading after every action until
 * the beat advances. A beat that shows nothing and gates on a tap gets the
 * bubble tapped. Edit the tutorial in the 📜 tab and this still plays it. The
 * two gates no pointer can express (typing a name, paying a skip) are in PLAYS.
 */
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beatsFingerprint } from './beats-fingerprint.cjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const opt = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const URL_OPT = opt('--url', null);
const OUT = path.resolve(ROOT, opt('--out', 'tests/e2e/checkpoints'));
const SHOT = opt('--shot', null);
const FROM = opt('--from', null);
const HEADED = flag('--headed');
const FORCE = flag('--force');
const cmd = args[0];

const tutorial = JSON.parse(readFileSync(path.join(ROOT, 'src/data/tutorial.json'), 'utf8'));
const STEPS = tutorial.steps.map((s) => s.id);
const FINGERPRINT = beatsFingerprint();
const file = (id) => path.join(OUT, `${String(STEPS.indexOf(id)).padStart(2, '0')}-${id}.json`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (page) => page.evaluate(() => { const r = window.render_game_to_text(); return typeof r === 'string' ? JSON.parse(r) : r; });
const stepOf = async (page) => (await text(page)).tutorial.step;
const VIEWPORT = { width: 1280, height: 800 };

/* ------------------------------------------------------------------ server */
const PORT = Number(process.env.EMBERKEEP_BEATS_PORT ?? 4180);
let URL = URL_OPT;
let server = null;

const answers = (url) => fetch(url, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
const portFree = (port) => new Promise((res) => { const s = net.createServer(); s.once('error', () => res(false)); s.listen(port, () => s.close(() => res(true))); });
const newest = (dir) => {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
};

/** Resolve the game URL: an explicit --url, a dev server that answers, else our own preview of a fresh dist. */
async function ensureServer() {
  if (URL) { if (!(await answers(URL))) throw new Error(`nothing answers at ${URL}`); return; }
  if (await answers('http://localhost:5173')) { URL = 'http://localhost:5173'; return; }
  const dist = path.join(ROOT, 'dist/index.html');
  const stale = !existsSync(dist) || newest(path.join(ROOT, 'src')) > statSync(dist).mtimeMs;
  if (stale) {
    console.log('· no server running and dist is stale — building (once)');
    const b = spawnSync('pnpm', ['build'], { cwd: ROOT, stdio: 'inherit' });
    if (b.status !== 0) throw new Error('build failed');
  }
  if (!(await portFree(PORT))) {
    URL = `http://localhost:${PORT}`;
    if (await answers(URL)) { console.log(`· reusing the preview on ${URL}`); return; }
    throw new Error(`port ${PORT} is taken by something that is not the game (set EMBERKEEP_BEATS_PORT)`);
  }
  server = spawn('pnpm', ['exec', 'vite', 'preview', '--strictPort', '--port', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  URL = `http://localhost:${PORT}`;
  const t0 = Date.now();
  while (!(await answers(URL))) {
    if (server.exitCode !== null) throw new Error('vite preview exited');
    if (Date.now() - t0 > 30000) throw new Error('vite preview did not come up');
    await sleep(200);
  }
  console.log(`· serving dist on ${URL}`);
}
const stopServer = () => { if (server) { server.kill(); server = null; } };
process.on('SIGINT', () => { stopServer(); process.exit(130); });

/* ------------------------------------------------------------------ browser */
async function launch() {
  const angle = process.platform === 'darwin' ? 'metal' : 'swiftshader';
  const browser = await chromium.launch({ headless: !HEADED, args: ['--enable-gpu', `--use-angle=${angle}`, '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: VIEWPORT });
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  return { browser, page };
}

const onScene = (page, scene) => page.waitForFunction((s) => { const r = window.render_game_to_text(); return (typeof r === 'string' ? JSON.parse(r) : r).scene === s; }, scene, { timeout: 30000 });

async function pressPlay(page) {
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
  await onScene(page, 'TitleScene');
  await sleep(1400); // the title's own fade-in; Play answers at this point per the instrumentation contract
  await page.mouse.click(640, 670);
  await onScene(page, 'BoardScene');
  await sleep(1200);
}

async function bootFresh(page) {
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await pressPlay(page);
}

function loadCheckpoint(id) {
  const p = file(id);
  if (!existsSync(p)) throw new Error(`no checkpoint for "${id}" — run \`pnpm beats:record\` (have: ${list().map((c) => c.id).join(', ') || 'none'})`);
  const cp = JSON.parse(readFileSync(p, 'utf8'));
  if (cp.fingerprint !== FINGERPRINT && !FORCE) {
    throw new Error(`checkpoint "${id}" is STALE (recorded for ${cp.fingerprint ?? 'unstamped'}, game is ${FINGERPRINT}): the tutorial steps, SAVE_VERSION, chain ids, map or zones changed since. Run \`pnpm beats:record\` (or --force to boot it anyway).`);
  }
  return cp;
}

/** Boot INTO a checkpoint: install its blob before the game reads the save, then Play. */
async function bootAt(page, id) {
  const { blob, saveKey } = loadCheckpoint(id);
  await page.goto(URL);
  await page.evaluate(([k, b]) => { localStorage.clear(); localStorage.setItem(k, b); }, [saveKey, blob]);
  await page.reload();
  await pressPlay(page);
  if (!(await waitStep(page, id, 10000))) throw new Error(`checkpoint "${id}" booted on "${await stepOf(page)}"`);
}

async function waitStep(page, id, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if ((await stepOf(page)) === id) return true;
    await sleep(100);
  }
  return false;
}

/* ------------------------------------------------------------------ player */
const tapAt = async (page, p) => { await page.mouse.move(p.x, p.y); await page.mouse.down(); await sleep(60); await page.mouse.up(); await sleep(350); };
const dragTo = async (page, a, b) => {
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await sleep(80);
  const steps = 12;
  for (let i = 1; i <= steps; i++) { await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps); await sleep(16); }
  await sleep(80); await page.mouse.up(); await sleep(450);
};
const tapBubble = (page) => tapAt(page, { x: 750, y: 725 });

/**
 * Gates the pointers cannot express, keyed by gate event. Each returns what it
 * did, or null to fall through to the pointers. Add one here only when a new
 * beat asks for an input no hand or arrow can show.
 */
const PLAYS = {
  // The naming panel: fill the field and confirm, the way a player does, so it closes itself.
  'dragon:named': async (page) => {
    const done = await page.evaluate(() => {
      const ui = window.__emberkeep.game.scene.getScene('UIScene');
      const panel = ui.naming;
      if (!panel?.isOpen) return false;
      if (panel.nameInput) panel.nameInput.value = 'Cinder';
      panel.chosen = 'Cinder';
      panel.confirm();
      return true;
    });
    if (!done) await sleep(400);
    return done ? 'named' : 'waiting-panel';
  },
  // The skip offer opens on the generator's tap (the arrow); paying it is a second tap on the key.
  'generator:skipped': async (page, step, ptr) => {
    if (!ptr.arrow) return null;
    await tapAt(page, ptr.arrow);
    await sleep(300);
    const key = await page.evaluate((c) => window.__emberkeep.skipKeyToPage(c), step.gate.currency ?? 'warmth');
    if (key) { await tapAt(page, key); return 'skip'; }
    return 'arrow-tap';
  }
};

/** One action toward the current beat, chosen from what the player is shown. Returns what it did. */
async function act(page, step) {
  const gate = step.gate;
  const ptr = await page.evaluate(() => window.__emberkeep.pointers());
  const special = gate.type === 'event' ? PLAYS[gate.event] : null;
  if (special) { const did = await special(page, step, ptr); if (did) return did; }
  if (ptr.hand && 'from' in ptr.hand && ptr.hand.from && ptr.hand.to) { await dragTo(page, ptr.hand.from, ptr.hand.to); return 'drag'; }
  if (ptr.hand && 'at' in ptr.hand) { await tapAt(page, ptr.hand.at); return 'hand-tap'; }
  if (ptr.arrow) { await tapAt(page, ptr.arrow); return 'arrow-tap'; }
  if (gate.type === 'tap') { await tapBubble(page); return 'bubble'; }
  return null;
}

const SLOW_GATES = new Set(['item:hatched', 'ui:codex_dragon_opened', 'ui:codex_evolution_opened', 'marketplace:purchased', 'region:unlocked', 'chest:open']);

async function playBeat(page, step, next) {
  const tried = [];
  for (let i = 0; i < 14; i++) {
    if (!next) return tried; // the last beat: nothing to advance to
    if ((await stepOf(page)) === next) return tried;
    const did = await act(page, step);
    tried.push(did);
    if (!did) { await sleep(600); continue; }
    await sleep(SLOW_GATES.has(step.gate.event) ? 900 : 250); // tweens and the director, then look again
  }
  if (next && (await waitStep(page, next, 6000))) return tried;
  throw new Error(`stuck on "${step.id}" (gate ${JSON.stringify(step.gate)}); tried ${JSON.stringify(tried)}`);
}

/* ------------------------------------------------------------------ commands */
function list() {
  if (!existsSync(OUT)) return [];
  return readdirSync(OUT).filter((f) => /^\d+-.*\.json$/.test(f)).sort().map((f) => {
    const cp = JSON.parse(readFileSync(path.join(OUT, f), 'utf8'));
    return { id: cp.step, fresh: cp.fingerprint === FINGERPRINT, recordedAt: cp.recordedAt };
  });
}

function saveCheckpoint(step, i, blob, saveKey) {
  writeFileSync(file(step.id), JSON.stringify({ step: step.id, index: i, fingerprint: FINGERPRINT, recordedAt: new Date().toISOString(), saveKey, blob }) + '\n');
}

async function record() {
  mkdirSync(OUT, { recursive: true });
  await ensureServer();
  const { browser, page } = await launch();
  try {
    let startIdx = 0;
    if (FROM) { await bootAt(page, FROM); startIdx = STEPS.indexOf(FROM); }
    else await bootFresh(page);
    for (let i = startIdx; i < tutorial.steps.length; i++) {
      const step = tutorial.steps[i];
      const next = STEPS[i + 1] ?? null;
      if (!(await waitStep(page, step.id))) throw new Error(`expected beat "${step.id}", game is on "${await stepOf(page)}"`);
      await sleep(500); // let the beat's spawns land and the camera settle
      const blob = await page.evaluate(() => window.__emberkeep.snapshot());
      const saveKey = await page.evaluate(() => window.__emberkeep.saveKey);
      await page.screenshot({ path: file(step.id).replace(/\.json$/, '.png') });
      saveCheckpoint(step, i, blob, saveKey);
      let tried;
      try {
        tried = await playBeat(page, step, next);
      } catch (first) {
        // A tween caught mid-flight, a pointer read a frame early: boot the beat
        // clean from the checkpoint just written and play it once more. A beat
        // that fails twice from a clean boot is a real bug, and that is reported.
        await page.screenshot({ path: path.join(OUT, `_retry-${step.id}.png`) }).catch(() => {});
        await bootAt(page, step.id);
        tried = ['↻', ...(await playBeat(page, step, next))];
        console.log(`   (${step.id}: first attempt stalled — ${first.message.split(';')[0]} — clean retry passed)`);
      }
      console.log(`${String(i).padStart(2)} ${step.id.padEnd(20)} ✓  ${tried.join(' ') || '—'}`);
    }
    console.log(`\n${tutorial.steps.length} checkpoints in ${path.relative(ROOT, OUT)}/ · fingerprint ${FINGERPRINT}`);
  } catch (e) {
    const p = path.join(OUT, `_failed-${Date.now()}.png`);
    await page.screenshot({ path: p }).catch(() => {});
    console.error(`\n✗ ${e.message}\n  screenshot: ${path.relative(ROOT, p)}`);
    process.exitCode = 1;
  } finally { await browser.close(); stopServer(); }
}

async function at(id) {
  loadCheckpoint(id); // fail on a missing/stale checkpoint before any browser or server spins up
  await ensureServer();
  const { browser, page } = await launch();
  try {
    const t0 = Date.now();
    await bootAt(page, id);
    await sleep(700);
    const shot = SHOT ? path.resolve(SHOT) : path.join(OUT, `_at-${id}.png`);
    await page.screenshot({ path: shot });
    const t = await text(page);
    console.log(`${id} in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${path.relative(ROOT, shot)}`);
    console.log(`   level ${t.level} · ⚡ ${t.energy.current}/${t.energy.max} · gold ${t.coins} · step ${t.tutorial.index + 1}/${t.tutorial.total}`);
  } finally { await browser.close(); stopServer(); }
}

function check() {
  const have = new Map(list().map((c) => [c.id, c]));
  const missing = STEPS.filter((id) => !have.has(id));
  const stale = STEPS.filter((id) => have.get(id) && !have.get(id).fresh);
  const orphans = [...have.keys()].filter((id) => !STEPS.includes(id));
  for (const id of STEPS) console.log(`${have.has(id) ? (have.get(id).fresh ? '✓' : '✗ stale  ') : '✗ missing'} ${id}`);
  for (const id of orphans) console.log(`· orphan  ${id} (no longer a step)`);
  const bad = missing.length + stale.length;
  console.log(bad ? `\n${bad} checkpoint(s) need \`pnpm beats:record\` · game fingerprint ${FINGERPRINT}` : `\nall ${STEPS.length} checkpoints fresh · ${FINGERPRINT}`);
  if (bad) process.exitCode = 1;
}

if (cmd === 'record') await record();
else if (cmd === 'at' && args[1]) await at(args[1]);
else if (cmd === 'list') { const l = list(); console.log(l.map((c) => `${c.fresh ? '✓' : '✗ stale'} ${c.id}`).join('\n') || '(none — run record)'); }
else if (cmd === 'check') check();
else { console.log('usage: beats.mjs record | at <step> [--shot path] | list | check   [--url U] [--headed] [--force] [--out dir] [--from step]'); process.exit(2); }
