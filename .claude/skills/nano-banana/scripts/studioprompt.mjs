#!/usr/bin/env node
/**
 * Grid-sheet prompts and animation timelines, produced by Sprite Studio's OWN
 * `lib/gridPrompts.ts`, `lib/phonetic.ts` and `lib/presets.ts` rather than
 * retyped here.
 *
 *   studioprompt.mjs --chart mouth --shapes 9 --cols 5 --rows 2 [--key 00FF00] [--res 4K]
 *   studioprompt.mjs --chart blink --cols 3 --rows 1 [--key 00FF00] [--res 4K]
 *   studioprompt.mjs --visemes            # the 9-shape table as JSON
 *   studioprompt.mjs --timeline blink     # the preset's steps as JSON
 *
 * Why go through the app instead of writing the copy: the viseme hints
 * ("upper teeth touching the lower lip"), the blink slot instructions and the
 * blink cadence (2600/45/70/55 ms, which is also what the red dragon's
 * frames.json uses) are the app's definitions. Paraphrasing them lets a sheet
 * drift from what Sprite Studio expects back when it slices and times the
 * result.
 *
 * `--chart blink` is assembled here because `gridPrompts.ts` only ships a mouth
 * builder — but the scaffolding is buildMouthPrompt's, sentence for sentence,
 * and every per-cell line comes from the `blink` preset's own slots.
 *
 * Two substitutions are applied to the app's mouth text, both asserted so an
 * upstream change fails loudly instead of silently shipping the wrong
 * background:
 *   --key  the app keys on violet #B39DDB, too close to cream and white content
 *          (SKILL.md); Emberkeep keys these characters on green.
 *   --res  the app asks for 2K; these grids need 4K for a cell to stand alone.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const STUDIO = path.join(process.env.HOME, 'Documents/Dev/Helper/SmartGrid/sprite-studio');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const work = mkdtempSync(path.join(tmpdir(), 'studioprompt-'));
const MODULES = ['gridPrompts', 'phonetic', 'presets', 'animation'];
execFileSync(path.join(STUDIO, 'node_modules/.bin/tsc'), [
  ...MODULES.map((m) => path.join(STUDIO, `lib/${m}.ts`)),
  '--outDir', work,
  '--target', 'es2020',
  '--module', 'es2020',
  '--moduleResolution', 'bundler',
  '--skipLibCheck',
  '--lib', 'es2020,dom',
], { stdio: 'inherit' });

// tsc emits extensionless relative imports; Node's ESM loader needs the .js.
for (const m of MODULES) {
  const f = path.join(work, `${m}.js`);
  writeFileSync(f, readFileSync(f, 'utf8').replace(/(from '\.\/[\w-]+)'/g, "$1.js'"));
}

const load = (name) => import(pathToFileURL(path.join(work, name)).href);
const { buildMouthPrompt } = await load('gridPrompts.js');
const { VISEMES, tokenize, toTimedSteps } = await load('phonetic.js');
const { PRESETS } = await load('presets.js');
const { totalDuration, withBlendFrames } = await load('animation.js');

const preset = (id) => {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) {
    console.error(`studioprompt: no '${id}' preset in Sprite Studio's PRESETS`);
    process.exit(1);
  }
  return p;
};

if (argv.includes('--visemes')) {
  console.log(JSON.stringify(VISEMES, null, 2));
  process.exit(0);
}

const timeline = flag('timeline', null);
if (timeline) {
  // --blend expands the step list with Sprite Studio's frame-mix in-betweens:
  // one synthetic 50/50 frame at every cut, its screen time stolen evenly from
  // both neighbours so the total duration is unchanged. That is what makes
  // three drawings read as one continuous blink rather than three cuts.
  const blend = argv.includes('--blend');
  let out;
  if (timeline === 'speech') {
    // Text -> visemes -> timings, all from lib/phonetic.ts: the greedy
    // digraph-first tokenizer and its timing model (vowels hold longer than
    // consonants, rests at spaces and punctuation).
    const text = flag('say', null);
    if (!text) {
      console.error('studioprompt: --timeline speech needs --say "the line"');
      process.exit(1);
    }
    const speed = Number(flag('speed', 1));
    const tokens = tokenize(text);
    const timed = toTimedSteps(tokens, speed);
    out = {
      preset: 'speech',
      name: 'Phonetic lip-sync',
      description: `"${text}" at speed ${speed}, tokenized by lib/phonetic.ts`,
      text,
      speed,
      slots: [...new Set(timed.map((s) => s.viseme))].map((id) => ({ id })),
      steps: timed.map((s) => ({ frameId: s.viseme, durationMs: s.durationMs,
                                blendMs: 0, label: s.label })),
    };
    // A spoken line is not a loop, so no in-between across the seam.
    if (blend) out.steps = withBlendFrames(out.steps, false);
  } else {
    const p = preset(timeline);
    // The preset builds its steps from slot-id -> frame-id assignments; feeding
    // it the slot ids themselves yields the cadence keyed by slot.
    const assignments = Object.fromEntries(p.slots.map((s) => [s.id, s.id]));
    out = {
      preset: p.id,
      name: p.name,
      description: p.description,
      slots: p.slots,
      steps: p.build({ frames: [], fps: 24, assignments }),
    };
    if (blend) out.steps = withBlendFrames(out.steps, true);
  }
  out.blended = blend;
  out.totalMs = totalDuration(out.steps);
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

const key = flag('key', null);
const res = flag('res', null);
const cols = Number(flag('cols', 5));
const rows = Number(flag('rows', 2));
const chart = flag('chart', 'mouth');

let prompt;
if (chart === 'mouth') {
  prompt = buildMouthPrompt(Number(flag('shapes', 9)), cols, rows);
  const swap = (label, pattern, replacement) => {
    if (!pattern.test(prompt)) {
      console.error(`studioprompt: could not find the ${label} clause in Sprite Studio's ` +
        'prompt — lib/gridPrompts.ts changed; re-read it before shipping a sheet.');
      process.exit(1);
    }
    prompt = prompt.replace(pattern, replacement);
  };
  if (key) swap('background', /solid uniform light violet \(#B39DDB\)/, `solid uniform pure green (#${key})`);
  if (res) swap('resolution', /\b2K resolution\b/, `${res} resolution`);
} else if (chart === 'blink') {
  const p = preset('blink');
  const cells = cols * rows;
  const extra = cells - p.slots.length;
  const lines = [
    `Create one ${cols}x${rows} character sheet image, ${res || '2K'} resolution.`,
    '',
    'You are given two reference images:',
    '- Image 1 is the character reference: the exact character to draw.',
    `- Image 2 is the layout template: a ${cols}x${rows} grid of identical white silhouettes marking the exact position, scale and framing for every cell. Follow the structure of Image 2 exactly — one character per silhouette, perfectly aligned to it.`,
    '',
    'Draw the character from Image 1 once inside every cell. Every cell must show the identical character — same face, same hairstyle, same colors, same outfit, same art style, same lighting, same head angle, same expression, same mouth — and the ONLY thing that changes from cell to cell is HOW FAR THE EYELIDS ARE LOWERED.',
    '',
    `The ${p.slots.length} eyelid states, in reading order (left to right, top to bottom):`,
    ...p.slots.map((s, i) => `Cell ${i + 1} — "${s.label}": ${s.instruction}`),
    '',
    'The three drawings are crossfaded into a single blink, so they must line up: the eyelid is the only thing that moves between them. Eyebrows, eyelashes, pupils, the direction of the gaze, the shape of the eye sockets and every highlight stay in exactly the same place. In the closed cell the lashes rest on the lower lid and the eye reads as a clean closed line — not a squint, not a wink, and both eyes close by the same amount.',
  ];
  if (extra > 0) {
    lines.push('', `The grid has ${cells} cells but only ${p.slots.length} states are needed: leave the last ${extra} cell${extra === 1 ? '' : 's'} as empty background.`);
  }
  lines.push(
    '',
    'Keep everything else exactly the same across all cells. Do not add text, numbers, labels, borders, shadows or props.',
    `Background: one solid uniform ${key ? `pure green (#${key})` : 'light violet (#B39DDB)'} covering the entire canvas — completely flat, no gradient, no vignette, no texture.`,
  );
  prompt = lines.join('\n');
} else {
  console.error(`studioprompt: unknown --chart '${chart}' (mouth | blink)`);
  process.exit(1);
}

process.stdout.write(prompt);
