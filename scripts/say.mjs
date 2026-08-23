#!/usr/bin/env node
/**
 * SAY — put a line in the dialogue ring and look at it.
 *
 *   node scripts/say.mjs <speaker> "<line>" [options]
 *   node scripts/say.mjs speakers                  who can be given a line
 *
 * Options:
 *   --at <step>    the recorded beat to boot into (default: the last one, free_play)
 *   --shot <path>  where the CROP goes (default tests/e2e/checkpoints/_say-<speaker>.png);
 *                  the whole frame is written beside it as <name>-full.png
 *   --hold <ms>    how long the line stays up (default 20000 — long enough to be shot)
 *   --url U        a running game (default: the dev server on 5173) · --headed  watch it
 *
 * WHY IT LOADS THE SHEETS ITSELF. The ring is not one picture: a speaker with
 * `talking` + `blinking` portrait clips staged (character-anims.json) gets the
 * animated bust, and a speaker whose sheets are not resident degrades to the
 * still `portrait_<id>` — the same line, a different face. Only the characters
 * standing in the ACTIVE world are preloaded (PreloadScene), so Selyna, who
 * lives in Borealis, and the Golden Elder, whose two sheets are fetched at the
 * endgame, would both preview as photographs and the preview would be a lie
 * about the shipped look. So this asks the scene's own loader for exactly the
 * clips `clipsFor(speaker)` names, at the frame sizes the file gives, under the
 * `canim_<who>_<clip>` keys the game reads — idempotent by texture residency,
 * so a speaker who is already loaded costs one `exists` per clip.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { bootAt, CHECKPOINT_DIR, defaultCheckpoint, flag, launch, opt, resolveUrl, ROOT, settleBubble, sleep, toPageRect, VIEWPORT, waitForBubble } from './game-harness.mjs';

const args = process.argv.slice(2);
const URL_OPT = opt(args, '--url');
const AT = opt(args, '--at');
const SHOT = opt(args, '--shot');
const HOLD = Number(opt(args, '--hold', '20000'));
const HEADED = flag(args, '--headed');

const rel = (p) => path.relative(ROOT, p);

/** The speaker roster, read from the model rather than restated here. */
const SPEAKERS = (() => {
  const src = readFileSync(path.join(ROOT, 'src/core/gameEvents.ts'), 'utf8');
  const m = src.match(/SPEAKERS:\s*readonly SpeakerId\[\]\s*=\s*\[([^\]]*)\]/);
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : ['eleanor', 'selyna', 'golden_elder'];
})();

/** The clips this speaker's ring may want, from the same file the game reads. */
function clipsFor(speaker) {
  const anims = JSON.parse(readFileSync(path.join(ROOT, 'src/data/character-anims.json'), 'utf8'));
  const clips = anims.characters[speaker]?.clips ?? {};
  return Object.entries(clips).map(([id, c]) => ({
    key: `canim_${speaker}_${id}`,
    id,
    file: c.file,
    frameWidth: c.frameWidth,
    frameHeight: c.frameHeight,
    stage: c.stage ?? null
  }));
}

/**
 * Hand the scene's loader whatever this speaker needs and wait for it. The
 * ring only ever animates from the two PORTRAIT-staged clips, so a board-only
 * clip (her idle, her cast) is left alone — those are tens of megabytes of
 * spritesheet that no preview looks at.
 */
const loadClips = (page, speaker, clips) =>
  page.evaluate(async ([who, wanted]) => {
    const ui = window.__emberkeep.game.scene.getScene('UIScene');
    const already = wanted.filter((c) => ui.textures.exists(c.key)).map((c) => c.key);
    const pending = wanted.filter((c) => !ui.textures.exists(c.key));
    if (pending.length) {
      for (const c of pending) ui.load.spritesheet(c.key, c.file, { frameWidth: c.frameWidth, frameHeight: c.frameHeight });
      await new Promise((done) => {
        const stop = setTimeout(done, 20000); // a sheet that never arrives must not hang the preview
        ui.load.once('complete', () => { clearTimeout(stop); done(); });
        ui.load.start();
      });
    }
    // The bubble asks for a speaker's art once, when the line opens; if one is
    // already up (it is not, here, but this is the contract) tell it the sheets
    // landed so it re-seats rather than staying a photograph.
    ui.bubble?.onSpeakerArtLoaded?.(who);
    return { already, loaded: pending.filter((c) => ui.textures.exists(c.key)).map((c) => c.key), missing: pending.filter((c) => !ui.textures.exists(c.key)).map((c) => c.key) };
  }, [speaker, clips]);

/** Which of the ring's three treatments this speaker actually got. */
const ringTreatment = (page, speaker) =>
  page.evaluate((who) => {
    const ui = window.__emberkeep.game.scene.getScene('UIScene');
    const bubble = ui?.bubble;
    const has = (k) => ui.textures.exists(k);
    return {
      atlas: bubble?.atlasSpeaker === who,
      talking: has(`canim_${who}_talking`),
      blinking: has(`canim_${who}_blinking`),
      still: has(`portrait_${who}`),
      visible: !!bubble?.visible,
      name: bubble?.nameTag?.text ?? null,
      line: bubble?.rawLine ?? bubble?.label?.text ?? null
    };
  }, speaker);

/** The bubble's own rectangle in page pixels, padded and clamped to the frame. */
async function bubbleClip(page) {
  const box = await page.evaluate(() => {
    const b = window.__emberkeep.game.scene.getScene('UIScene')?.bubble;
    if (!b) return null;
    const r = b.getBounds();
    const pad = 90; // game-space; the ring's bust overhangs the plate, and the chevron sits under it
    return { x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
  });
  if (!box || !(box.width > 0)) return null;
  const r = await toPageRect(page, box);
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  return {
    x,
    y,
    width: Math.min(VIEWPORT.width - x, Math.ceil(r.width)),
    height: Math.min(VIEWPORT.height - y, Math.ceil(r.height))
  };
}

async function say(speaker, line) {
  const step = AT ?? defaultCheckpoint();
  const url = await resolveUrl(URL_OPT);
  const crop = path.resolve(SHOT ?? path.join(CHECKPOINT_DIR, `_say-${speaker}.png`));
  const full = crop.replace(/\.png$/, '-full.png');
  const clips = clipsFor(speaker).filter((c) => c.stage === 'portrait');
  const { browser, page, errors } = await launch({ headed: HEADED });
  try {
    const t0 = Date.now();
    const landed = await bootAt(page, url, step);
    if (landed !== step) console.warn(`! asked for "${step}", the game resumed on "${landed}"`);

    await waitForBubble(page);

    const art = clips.length
      ? await loadClips(page, speaker, clips)
      : { already: [], loaded: [], missing: [], none: true };

    const spoke = await page.evaluate(
      ([who, text, hold]) => {
        const bubble = window.__emberkeep.game.scene.getScene('UIScene')?.bubble;
        if (!bubble?.say) return false;
        bubble.say(who, text, hold);
        return true;
      },
      [speaker, line, HOLD]
    );
    if (!spoke) throw new Error('UIScene has no bubble to speak with — did the board scene finish booting?');

    await settleBubble(page);
    const ring = await ringTreatment(page, speaker);
    await page.screenshot({ path: full });
    const clipRect = await bubbleClip(page);
    if (clipRect) await page.screenshot({ path: crop, clip: clipRect });

    const treatment = ring.atlas ? 'animated bust (talking + blinking clips)' : ring.still ? 'still portrait — the clips are not resident' : 'no face — neither clips nor a still portrait are registered';
    console.log(`\n${speaker}: "${line}"`);
    console.log(`  boot   ${landed}  ·  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`  clips  ${art.none ? 'none staged for the ring' : `${art.loaded.length} loaded, ${art.already.length} already resident${art.missing.length ? `, MISSING ${art.missing.join(', ')}` : ''}`}`);
    console.log(`  ring   ${treatment}`);
    console.log(`  shown  ${ring.visible ? `${ring.name ?? '?'} — "${ring.line ?? ''}"` : 'the bubble is NOT visible'}`);
    if (errors.length) {
      console.log('  errors');
      for (const e of errors) console.log(`    ${e}`);
    }
    console.log(`  shot   ${rel(crop)}${clipRect ? '' : '  (crop failed — bubble had no bounds)'}\n         ${rel(full)}\n`);
    if (!ring.visible) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

const [speaker, line] = args;
if (speaker === 'speakers') console.log(SPEAKERS.join('\n'));
else if (!speaker || line === undefined) {
  console.log('usage: say.mjs <speaker> "<line>" [--at step] [--shot path] [--hold ms] [--url U] [--headed]');
  console.log(`       speakers: ${SPEAKERS.join(', ')}`);
  process.exit(2);
} else if (!SPEAKERS.includes(speaker)) {
  console.error(`"${speaker}" is nobody — speakers are: ${SPEAKERS.join(', ')}`);
  process.exit(1);
} else {
  await say(speaker, line);
}
