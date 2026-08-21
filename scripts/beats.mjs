#!/usr/bin/env node
/**
 * BEATS — checkpoints for every tutorial beat, and a one-blink way back to any of them.
 *
 *   node scripts/beats.mjs record            play the whole script once, FOLLOWING THE
 *                                            LESSON'S OWN POINTERS, and save a checkpoint
 *                                            (the raw save blob + a screenshot) at every beat
 *   node scripts/beats.mjs at <step> [--shot p]   boot straight INTO that beat and screenshot it
 *   node scripts/beats.mjs list              the checkpoints on disk
 *
 * Options: --url http://localhost:5173 (the dev server; `vite preview` works too),
 *          --out tests/e2e/checkpoints, --from <step> (record: resume from a checkpoint).
 *
 * Why this is exact: a loaded save rebases the game clock to its `savedAt`, so a
 * restored checkpoint is the beat frozen at the instant it was recorded — same
 * board, same timers, same Warmth — and the director resumes on that beat.
 *
 * Why the player is generic: it does not know the script. Each beat it reads
 * `__emberkeep.pointers()` — the hand and arrow the player is shown — and does
 * what they say (drag from→to, tap here), re-reading after every action until
 * the beat advances. A beat that shows nothing and gates on a tap gets the
 * bubble tapped. Edit the tutorial in the 📜 tab and this still plays it.
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const URL = opt('--url', 'http://localhost:5173');
const OUT = path.resolve(ROOT, opt('--out', 'tests/e2e/checkpoints'));
const SHOT = opt('--shot', null);
const FROM = opt('--from', null);
const cmd = args[0];

const tutorial = JSON.parse(readFileSync(path.join(ROOT, 'src/data/tutorial.json'), 'utf8'));
const STEPS = tutorial.steps.map((s) => s.id);
const file = (id) => path.join(OUT, `${String(STEPS.indexOf(id)).padStart(2, '0')}-${id}.json`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (page) => page.evaluate(() => { const r = window.render_game_to_text(); return typeof r === 'string' ? JSON.parse(r) : r; });
const stepOf = async (page) => (await text(page)).tutorial.step;
const VIEWPORT = { width: 1280, height: 800 };

async function launch() {
  const browser = await chromium.launch({ args: ['--use-angle=metal'] });
  const page = await browser.newPage({ viewport: VIEWPORT });
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  return { browser, page };
}

async function bootFresh(page) {
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
  await page.waitForFunction(() => { const r = window.render_game_to_text(); return (typeof r === 'string' ? JSON.parse(r) : r).scene === 'TitleScene'; }, null, { timeout: 30000 });
  await sleep(1400);
  await page.mouse.click(640, 670); // Play — the instrumentation contract keeps it here
  await waitBoard(page);
}

async function waitBoard(page) {
  await page.waitForFunction(() => { const r = window.render_game_to_text(); return (typeof r === 'string' ? JSON.parse(r) : r).scene === 'BoardScene'; }, null, { timeout: 30000 });
  await sleep(1200);
}

/** Boot INTO a checkpoint: install its blob before the game reads the save, then Play. */
async function bootAt(page, id) {
  const p = file(id);
  if (!existsSync(p)) throw new Error(`no checkpoint for "${id}" — run \`node scripts/beats.mjs record\` first (have: ${list().join(', ') || 'none'})`);
  const { blob, saveKey } = JSON.parse(readFileSync(p, 'utf8'));
  await page.goto(URL);
  await page.evaluate(([k, b]) => { localStorage.clear(); localStorage.setItem(k, b); }, [saveKey, blob]);
  await page.reload();
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
  await page.waitForFunction(() => { const r = window.render_game_to_text(); return (typeof r === 'string' ? JSON.parse(r) : r).scene === 'TitleScene'; }, null, { timeout: 30000 });
  await sleep(1400);
  await page.mouse.click(640, 670);
  await waitBoard(page);
  const live = await stepOf(page);
  if (live !== id) throw new Error(`checkpoint "${id}" booted on "${live}"`);
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

/** One action toward the current beat, chosen from what the player is shown. Returns what it did. */
async function act(page, step) {
  const gate = step.gate;
  const ptr = await page.evaluate(() => window.__emberkeep.pointers());
  // The beats that ask something the pointers cannot show.
  if (gate.type === 'event' && gate.event === 'dragon:named') {
    // The naming panel is the one control with no pointer: fill it the way a
    // player does (the field, then the confirm plate) so it closes itself.
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
  }
  if (ptr.hand && 'from' in ptr.hand && ptr.hand.from && ptr.hand.to) { await dragTo(page, ptr.hand.from, ptr.hand.to); return 'drag'; }
  if (ptr.hand && 'at' in ptr.hand) { await tapAt(page, ptr.hand.at); return 'hand-tap'; }
  if (ptr.arrow) {
    await tapAt(page, ptr.arrow);
    // A generator's tap opens its skip offer; the scripted skip pays Warmth.
    if (gate.type === 'event' && gate.event === 'generator:skipped') {
      await sleep(300);
      const key = await page.evaluate((c) => window.__emberkeep.skipKeyToPage(c), gate.currency ?? 'warmth');
      if (key) { await tapAt(page, key); return 'skip'; }
    }
    return 'arrow-tap';
  }
  if (gate.type === 'tap') { await tapBubble(page); return 'bubble'; }
  return null;
}

async function playBeat(page, step, next) {
  const tried = [];
  for (let i = 0; i < 14; i++) {
    if (!next) return tried; // the last beat: nothing to advance to
    if ((await stepOf(page)) === next) return tried;
    const did = await act(page, step);
    tried.push(did);
    if (!did) { await sleep(600); continue; }
    // Give tweens and the director a moment, then look again.
    await sleep(gate_is_slow(step) ? 900 : 250);
  }
  if (next && (await waitStep(page, next, 6000))) return tried;
  throw new Error(`stuck on "${step.id}" (gate ${JSON.stringify(step.gate)}); tried ${JSON.stringify(tried)}`);
}
const gate_is_slow = (s) => ['item:hatched', 'ui:codex_dragon_opened', 'ui:codex_evolution_opened', 'marketplace:purchased', 'region:unlocked', 'chest:open'].includes(s.gate.event);

/* ------------------------------------------------------------------ commands */
function list() {
  if (!existsSync(OUT)) return [];
  return readdirSync(OUT).filter((f) => f.endsWith('.json')).sort().map((f) => f.replace(/^\d+-/, '').replace(/\.json$/, ''));
}

async function record() {
  mkdirSync(OUT, { recursive: true });
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
      const shot = file(step.id).replace(/\.json$/, '.png');
      await page.screenshot({ path: shot });
      writeFileSync(file(step.id), JSON.stringify({ step: step.id, index: i, recordedAt: new Date().toISOString(), saveKey, blob }) + '\n');
      const tried = await playBeat(page, step, next);
      console.log(`${String(i).padStart(2)} ${step.id.padEnd(20)} ✓  ${tried.join(' ') || '—'}`);
    }
    console.log(`\n${tutorial.steps.length} checkpoints in ${path.relative(ROOT, OUT)}/`);
  } catch (e) {
    const p = path.join(OUT, `_failed-${Date.now()}.png`);
    await page.screenshot({ path: p }).catch(() => {});
    console.error(`\n✗ ${e.message}\n  screenshot: ${path.relative(ROOT, p)}`);
    process.exitCode = 1;
  } finally { await browser.close(); }
}

async function at(id) {
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
  } finally { await browser.close(); }
}

if (cmd === 'record') await record();
else if (cmd === 'at' && args[1]) await at(args[1]);
else if (cmd === 'list') console.log(list().join('\n') || '(none — run record)');
else { console.log('usage: beats.mjs record | at <step> [--shot path] | list   [--url U] [--out dir] [--from step]'); process.exit(2); }
