/**
 * THE GOLDEN ELDER SPEAKS — acceptance proof for her lazily-fetched portrait clips.
 *
 * She is the only speaker whose talking/blinking sheets are NOT in the boot
 * preload (two sheets, ~2.4 MB, and she cannot say a word before the endgame),
 * so every path that opens her mouth has to ask for them itself. When one
 * forgets, nothing breaks loudly: the ring falls back to `portrait_golden_elder`
 * and she reads the line as a photograph — the still bust sits low and small
 * inside the frame (the medallion treatment) instead of rising through it. That
 * is one bug wearing two faces, "her mouth does not open" and "her head sits
 * wrong in the circle", and no assertion in the e2e suite can see either.
 *
 * So it is measured here, on the two things only the atlas path can produce:
 *   - `portrait.frame.name` is off '__BASE' — a spritesheet frame index; the
 *     still bust is a single-frame texture and can only ever be '__BASE'
 *   - `portraitTop.visible` is true — the head copy drawn ABOVE the ring band,
 *     which the medallion treatment explicitly hides
 * plus the frame INDEX moving between two samples, which is the difference
 * between "the clips are mounted" and "her mouth is actually moving".
 *
 * TWO PHASES, because the fix has two halves.
 *   1. PLAIN — the sheets are asked for at all, and she animates.
 *   2. HELD — the same run with her two sheets pinned on the wire until she has
 *      PROVABLY opened her mouth without them. She must then re-seat herself
 *      onto the clips mid-line (CharacterBubble.onSpeakerArtLoaded). Without
 *      that half, phase 2 stays on '__BASE' for the whole line while phase 1
 *      passes — which is exactly the shape of the bug on a slow connection.
 *   The hold is released by THIS SCRIPT rather than after a wall-clock delay,
 *   so the race is reproduced by construction on any machine.
 *
 * THE PATH IT DRIVES is the LATE AWAKENING — the golden order delivered at
 * Keeper Level 3 or above, which cracks the egg outside the finale timeline
 * (UIScene.celebrateOrder → bubble.say('golden_elder', …)). The recorded
 * checkpoint sits at `free_play` with that order long since delivered, so the
 * harness re-emits the bus FACT the OrderSystem emits — `order:completed` with
 * the golden order id — rather than reaching past the subscriber into the beat.
 * Same handler, same guards, same 3.2s delay the player waits through.
 *
 * WHY EVERY TIMEOUT IS ABSURD: headless Chromium has no GPU path for a
 * 2560×1600 canvas on anything but macOS, and under SwiftShader the game steps
 * at one or two frames a second. Phaser clamps a panicking frame's delta, so a
 * scene timer set for 3.2s can take twenty times that in wall clock. Nothing
 * here sleeps for a duration; everything waits for the state it is about to
 * assert on, and the observed frame rate is printed so a timeout reads as
 * "this machine is slow" rather than "she is mute".
 *
 * Boots the recorded checkpoint into the headless browser's own profile, so
 * localStorage — and the owner's save — is never touched.
 *
 * Needs `pnpm dev` running (or BASE=… pointing at a preview).
 *   node tools/checks/elder-voice.mjs [outDir]
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = process.argv[2] || '/tmp';
const BASE = process.env.BASE || 'http://localhost:5173';
const CHECKPOINT = path.join(ROOT, 'tests/e2e/checkpoints/63-free_play.json');

/** Read out of Constants rather than pasted, so renaming the order fails this
 *  harness loudly instead of letting it emit a fact nobody subscribes to. */
const GOLDEN_ORDER = /GOLDEN_ALTAR\s*=\s*\{[\s\S]*?orderId:\s*'([^']+)'/.exec(
  readFileSync(path.join(ROOT, 'src/core/Constants.ts'), 'utf8')
)?.[1];
if (!GOLDEN_ORDER) throw new Error('could not read GOLDEN_ALTAR.orderId out of src/core/Constants.ts');

/** Her line is 3.2s of SCENE time out; see the frame-rate note above. */
const SPEAK_TIMEOUT = 120_000;
const RESEAT_TIMEOUT = 60_000;
const ANIM_TIMEOUT = 30_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

const angle = process.platform === 'darwin' ? 'metal' : 'swiftshader';
const browser = await chromium.launch({ args: ['--enable-gpu', `--use-angle=${angle}`, '--ignore-gpu-blocklist'] });
const errs = [];

const sceneIs = (page, scene) =>
  page.waitForFunction(
    (s) => {
      const r = window.render_game_to_text();
      return (typeof r === 'string' ? JSON.parse(r) : r).scene === s;
    },
    scene,
    { timeout: 60_000 }
  );

/** Everything about the ring that tells the two treatments apart. */
const probe = (page) =>
  page.evaluate(() => {
    const b = window.__emberkeep.game.scene.getScene('UIScene').bubble;
    return {
      open: b.visible,
      speaker: b.artSpeaker,
      atlas: b.atlasSpeaker,
      texture: b.portrait.texture.key,
      frame: String(b.portrait.frame.name),
      topVisible: b.portraitTop.visible,
      y: Math.round(b.portrait.y),
      scaleY: Number(b.portrait.scaleY.toFixed(3))
    };
  });

const show = (at, p) =>
  console.log(
    `      ${at}: open=${p.open} speaker=${p.speaker || '-'} atlas=${p.atlas || '-'} tex=${p.texture} ` +
      `frame=${p.frame} top=${p.topVisible} y=${p.y} scaleY=${p.scaleY}`
  );

/** Poll a page predicate; false rather than a throw on timeout, so a failure
 *  can be screenshotted and the black box dumped instead of dying on a stack. */
async function waitFor(page, fn, timeout, arg) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 200 });
    return true;
  } catch {
    return false;
  }
}

/** Frames per second the game is ACTUALLY getting — the number every timeout
 *  here is sized against, printed so a slow box is legible in the log. */
const fps = (page) =>
  page.evaluate(async () => {
    const g = window.__emberkeep.game;
    const f0 = g.loop.frame;
    await new Promise((r) => setTimeout(r, 1000));
    return g.loop.frame - f0;
  });

/** The game's own black box (src/core/crash.ts). A guarded beat that threw is
 *  recorded there and nowhere the console can be scraped from reliably. */
async function dumpErrors(page, name) {
  const recorded = await page.evaluate(() => window.__emberkeep.errors());
  if (!recorded.length) return;
  console.log(`      ${name}: __emberkeep.errors():`);
  for (const r of recorded) console.log(`        [${r.where} ×${r.count}] ${r.message}`);
}

/** Boot the recorded checkpoint: install its blob before the game reads the
 *  save, then press Play (the instrumentation contract's button position). */
async function boot(page) {
  const cp = JSON.parse(readFileSync(CHECKPOINT, 'utf8'));
  await page.goto(BASE);
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
  await page.evaluate(([k, blob]) => {
    localStorage.clear();
    localStorage.setItem(k, blob);
  }, [cp.saveKey, cp.blob]);
  await page.reload();
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
  await sceneIs(page, 'TitleScene');
  await sleep(1600); // the title's own fade-in
  await page.mouse.click(640, 670);
  await sceneIs(page, 'BoardScene');
  await sleep(2500);
  return cp;
}

/** A tap on the bubble. Held long enough that a 2 fps step cannot miss the
 *  down/up pair between frames. */
const tapBubble = async (page) => {
  await page.mouse.move(750, 725);
  await page.mouse.down();
  await sleep(200);
  await page.mouse.up();
  await sleep(1200);
};

const bubbleOpen = (page) =>
  page.evaluate(() => window.__emberkeep.game.scene.getScene('UIScene').bubble.visible);

/**
 * The checkpoint sits ON the tutorial's last beat, so the script is not DONE —
 * and `celebrateOrder` refuses to celebrate anything while it is running. End
 * it the way a player does (`free_play` gates on a tap), then tap whatever
 * Eleanor says on the handover off the bubble, so the ring is empty before the
 * Elder is asked for it.
 */
async function clearTheStage(page) {
  const done = () => page.evaluate(() => window.__emberkeep.game.registry.get('ctx').state.tutorialDone);
  for (let i = 0; i < 8 && !(await done()); i++) await tapBubble(page);
  for (let i = 0; i < 12 && (await bubbleOpen(page)); i++) await tapBubble(page);
  return { tutorialDone: await done(), quiet: !(await bubbleOpen(page)) };
}

/**
 * Put the Keeper past the LATE path's own gate. Level 3 is that gate: below it
 * the awakening belongs to the finale timeline and this beat does not run at
 * all. `grantXp` is the instrumentation contract's own door.
 */
const reachLevelThree = (page) =>
  page.evaluate(() => {
    const ctx = window.__emberkeep.game.registry.get('ctx');
    if (ctx.state.level < 3) window.__emberkeep.grantXp(260 - ctx.state.xp);
    return { level: ctx.state.level, tutorialDone: ctx.state.tutorialDone };
  });

async function runPhase(name, { hold }) {
  console.log(`\n· ${name}`);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errs.push(`${name}: pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errs.push(`${name}: ${m.text()}`);
  });

  // HER SHEETS, PINNED ON THE WIRE. Only hers — everything else loads at full
  // speed, so what is reproduced is a slow fetch, not a slow game. Released by
  // hand once she has opened her mouth without them.
  let release = () => {};
  if (hold) {
    const held = new Promise((r) => {
      release = r;
    });
    await page.route('**/anims/golden_elder/*', async (route) => {
      await held;
      await route.continue();
    });
  }

  const cp = await boot(page);
  const stage = await clearTheStage(page);
  const state = await reachLevelThree(page);
  check(
    `${name}: tutorial over, ring empty, Keeper at Level 3+`,
    stage.tutorialDone && stage.quiet && state.level >= 3,
    `done ${stage.tutorialDone} quiet ${stage.quiet} level ${state.level}`
  );
  console.log(`      the game is stepping at ~${await fps(page)} fps`);

  await page.evaluate((id) => {
    const ctx = window.__emberkeep.game.registry.get('ctx');
    ctx.bus.emit('order:completed', { orderId: id, rewards: { coins: 0, keys: 0 } });
  }, GOLDEN_ORDER);

  const spoke = await waitFor(
    page,
    () => {
      const b = window.__emberkeep.game.scene.getScene('UIScene').bubble;
      return b.visible && b.artSpeaker === 'golden_elder';
    },
    SPEAK_TIMEOUT
  );
  check(`${name}: the ring is hers — she opens her mouth at all`, spoke);
  if (!spoke) {
    await page.screenshot({ path: path.join(OUT, `elder-voice-${name}-silent.png`) });
    await dumpErrors(page, name);
    release();
    await page.close();
    return cp;
  }

  // The first instant of her line — the moment that used to be the whole bug.
  const opening = await probe(page);
  show('opens', opening);
  await page.screenshot({ path: path.join(OUT, `elder-voice-${name}-opens.png`) });
  if (hold) {
    check(
      `${name}: her line OPENS on the still bust (the fallback did its job)`,
      opening.frame === '__BASE' && opening.atlas === '',
      `frame ${opening.frame} on ${opening.texture}`
    );
    release(); // …and now the sheets land, mid-sentence
    const reseated = await waitFor(
      page,
      () => {
        const b = window.__emberkeep.game.scene.getScene('UIScene').bubble;
        return b.visible && b.atlasSpeaker === 'golden_elder';
      },
      RESEAT_TIMEOUT
    );
    check(`${name}: she RE-SEATS onto the clips mid-line`, reseated);
  }

  const seated = await probe(page);
  check(`${name}: the bubble is still hers`, seated.open && seated.speaker === 'golden_elder', `speaker ${seated.speaker || '-'} open ${seated.open}`);
  check(`${name}: frame !== '__BASE'`, seated.frame !== '__BASE', `frame ${seated.frame} on ${seated.texture}`);
  check(`${name}: portraitTop.visible === true`, seated.topVisible === true);

  // Mounted is not moving: wait for the clip's own tick to step the frame on.
  const moved = await waitFor(
    page,
    (was) => String(window.__emberkeep.game.scene.getScene('UIScene').bubble.portrait.frame.name) !== was,
    ANIM_TIMEOUT,
    seated.frame
  );
  const after = await probe(page);
  show('after', after);
  await page.screenshot({ path: path.join(OUT, `elder-voice-${name}.png`) });
  check(`${name}: the frame ADVANCES (she is animating, not frozen)`, moved, `${seated.frame} → ${after.frame}`);

  await dumpErrors(page, name);
  await page.close();
  return cp;
}

// `check` only RECORDS a failure, but the Playwright calls under it throw on
// timeout — a missing checkpoint or a stalled dev server takes the run out
// through here. One browser at a time is a rule about the machine, so the close
// cannot sit on the happy path: a leaked Chromium blocks the next run.
let cp;
try {
  cp = await runPhase('plain', { hold: false });
  await runPhase('held', { hold: true });
} finally {
  await browser.close();
}

console.log(`\ncheckpoint: ${path.basename(CHECKPOINT)} (${cp.step}, recorded ${cp.recordedAt})`);
console.log(`golden order: ${GOLDEN_ORDER} · shots in ${OUT}`);
console.log(`page errors: ${errs.length}`, errs.slice(0, 4));
if (fails.length) {
  console.log(`\nFAILED: ${fails.join(' · ')}`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
