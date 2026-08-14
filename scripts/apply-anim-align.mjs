/**
 * Character-atlas alignment — Align Studio → the game.
 *
 *   node scripts/apply-anim-align.mjs state          → print the tool state doc
 *   node scripts/apply-anim-align.mjs auto [--write] → auto-align (optionally apply)
 *
 * One implementation for the whole route, exactly like apply-characters.mjs:
 *
 *   Sprite Studio /align  →  vite /__animalign/{state,auto,align}  →  here
 *   CLI / an agent        →  same endpoints via curl, or this file directly
 *
 * WHAT IT OWNS. The roster below maps each animated character to its raw atlas
 * workspace (assets/raw/new-animations, dev-served but default-deny in dist)
 * and to the IN-GAME reference its idle must register against: the standee
 * banks' feet-anchored frame for Eleanor/Selyna, the red whelp's rig rest pose
 * for the dragon. `applyAnimAlign` stages the sheets into assets/sprites/anims/
 * (downscaling frame-exactly past the 4096 old-device ceiling) and writes
 * `src/data/character-anims.json`, the file the game bundles.
 *
 * TRANSFORM SPACES. The tool and the analyzer author transforms against the RAW
 * atlas frames. A staged sheet may be smaller (the fly sheet is 5200 px wide),
 * so the written clip carries the STAGED frame size plus `srcFrameWidth/Height`
 * and a rescaled `scale` — `stateDoc` converts back so the tool always edits in
 * raw-frame terms, and the runtime never needs to know staging happened.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PY = process.env.PYTHON ?? 'python3';
const MAX_TEXTURE = 4096; // old-device budget — see CLAUDE.md / memory
// Never ship more texture than ~1.25× what the clip DISPLAYS. The raw
// workspaces keep full-quality masters; staging is where the deploy diet
// happens (a baby roar authored at 400px but drawn at 165 was shipping 2.4×
// the pixels the screen can use).
const MAX_OVERSAMPLE = 1.25;
const RAW_BASE = 'assets/raw/new-animations';
const DATA_FILE = 'src/data/character-anims.json';

/**
 * The alignment roster: which characters have animation atlases, where the raw
 * sheets live, and what in-game rest pose their idle registers against.
 *
 * `modes` picks the auto-align strategy per clip (default 'feet'):
 *   feet   — bottom-centre + content-height match (full-body clips)
 *   center — centre + content-height match (airborne: feet mean nothing)
 *   top    — top-centre + content-width match (bust framings: feet out of shot)
 */
const ROSTER = {
  eleanor: {
    label: 'Eleanor',
    rawDir: `${RAW_BASE}/eleanor_atlasses`,
    standee: 'eleanor',
    // IN-GAME (board): idle, cast, laugh, happy. DIALOGUE BUBBLE (ring):
    // talking + blinking — they replace her disc-atlas animation outright.
    // `loop:false` marks event REACTIONS — played once, then back to rest.
    clipInfo: {
      idle: { trigger: 'board rest — replaces the bake still + breath' },
      cast: { trigger: 'character:action_used — replaces the bank cast', loop: false },
      happy: { trigger: 'regard:gift_accepted — a gift lands', loop: false },
      laugh: { trigger: 'regard:heart — a whole heart fills', loop: false },
      talking: { stage: 'portrait', trigger: 'bubble ring while her line shows (replaces disc talk)' },
      blinking: { stage: 'portrait', trigger: 'bubble ring at rest (replaces disc rest/blink)', loop: true }
    },
    // Bust-framed ring view (her talking/blinking frames are head+shoulders,
    // not full body): whole frame at `height` display px, crown at ring-centre
    // + dy, head copy (drawn ABOVE the band) cut at the neck-line fraction —
    // measured so the cut sits where her silhouette fits inside the hole.
    // Tuned against live screenshots (tools/checks/anim-bubble.mjs).
    portraitView: { height: 360, dy: -170, headCrop: 0.47 }
  },
  selyna: {
    label: 'Selyna',
    rawDir: `${RAW_BASE}/selyna_atlasses`,
    standee: 'selyna',
    modes: { talking: 'top', blinking: 'top' },
    // IN-GAME (board): idle, cast. DIALOGUE BUBBLE (ring): talking + blinking
    // (bust framings — they replace her disc-atlas animation outright).
    clipInfo: {
      idle: { trigger: 'board rest — replaces the bake still + breath' },
      cast: { trigger: 'character:action_used — replaces the bank cast', loop: false },
      talking: { stage: 'portrait', trigger: 'bubble ring while her line shows (replaces disc talk)' },
      blinking: { stage: 'portrait', trigger: 'bubble ring at rest (replaces disc rest/blink)', loop: true }
    },
    // Bust framing, same treatment as Eleanor's; neck-line at her choker.
    portraitView: { height: 380, dy: -172, headCrop: 0.55 }
  },
  redwhelp: {
    label: 'Ember Dragon (red whelp)',
    rawDir: `${RAW_BASE}/dragon_atlasses`,
    rig: 'sprites/characters/dragon/red-dragon/rig/dragon-red.rig.json',
    // BoardScene.attachDragon: whelp tier — DRAGON_ANIM.whelpScale × DRAGON_RIG_SCALE.ember_dragon
    rigScaleOf: (C) => C.DRAGON_ANIM.whelpScale * C.DRAGON_RIG_SCALE.ember_dragon,
    modes: { fly: 'center' },
    // The chain:tier these clips dress on the board (BoardScene dragon rigs).
    board: 'ember_dragon:3',
    clipInfo: {
      // Video-ingested (scripts/anim-ingest.py off raw-mp4/dragon-idle.mp4):
      // the grounded rest — replaces the rig's idle preset while standing.
      idle: { trigger: 'board rest, grounded — replaces the rig idle preset' },
      fly: {
        trigger: 'flight: takeoff → cruise loop → landing (drag hold loops; release lands)',
        // Authored phases of the 240f sheet: the ramp up, the seamless cruise
        // (frames 61..135 close the cycle at RMSE 21 vs an 86 baseline), and
        // the wing-fold touchdown (192→end per the animation brief).
        segments: { takeoff: [0, 61], loop: [61, 136], landing: [192, 240] }
      },
      // Video-ingested (raw-mp4/dragon-roar.mp4): the hungry bellow on the
      // DRAGON_ROAR_EVERY_MS cadence — replaces the rig roar preset.
      roar: { trigger: 'hungry roar cadence — replaces the rig roar preset', loop: false },
      tosleep: { trigger: 'dragon:mood asleep, once SEATED on a tile → curl into the sleep art; reversed on wake', loop: false }
    }
  },
  redadult: {
    label: 'Adult Red Dragon',
    rawDir: `${RAW_BASE}/redadult_atlasses`,
    rig: 'sprites/characters/dragon/red-dragon/rig-adult/red-dragon.rig.json',
    // BoardScene.attachDragon: tier ≥ 3 → whelpScale × the tier-specific rig scale
    rigScaleOf: (C) => C.DRAGON_ANIM.whelpScale * C.DRAGON_RIG_SCALE['ember_dragon:4'],
    modes: { fly: 'center' },
    board: 'ember_dragon:4',
    // The wan 2.7 generation route end to end (anim-plate → anim-generate →
    // anim-ingest --skip 6): every clip starts AND ends on the baked rest pose.
    clipInfo: {
      idle: { trigger: 'board rest, grounded — replaces the rig idle preset' },
      roar: { trigger: 'every bellow: hungry cadence + ambient idle cadence', loop: false },
      fly: {
        trigger: 'flight: unfold → wingbeat cruise → fold (drag hold loops; release lands)',
        // Measured by scripts/anim-segments.py (segments.json in the raw
        // workspace): 31f wingbeat closing at RMSE 8.6, fold from 214.
        segments: { takeoff: [0, 34], loop: [34, 65], landing: [214, 234] }
      }
    }
  },
  // ---- Emporium dragons: REAL purchasable breeds. Buying one dresses the
  // ember chain in the breed's own clip set (character-anims `skin` key), and
  // the clips ARE the whole animal — no rig. Alignment registers each breed's
  // idle onto ITS OWN rig-file rest pose at the RED's board display scale
  // (same board slot, same footprint).
  // ---- The store breeds are CHAINS now (frost/storm: egg → baby → adult),
  // not Emporium skins of the ember chain. Their boards bind to their own
  // tiers; the rigScaleOf stays the EMBER formula on purpose — the skin bakes
  // these items draw were fitted onto ember's canvases, so ember's display
  // scale IS their display scale, and the alignment must keep matching it.
  frost_baby: {
    label: 'Frost Dragon (baby)',
    rawDir: `${RAW_BASE}/frost_baby_atlasses`,
    rig: 'sprites/characters/dragon/frost-dragon/rig/dragon-frost.rig.json',
    rigScaleOf: (C) => C.DRAGON_ANIM.whelpScale * C.DRAGON_RIG_SCALE.ember_dragon,
    board: 'frost:2',
    clipInfo: {
      idle: { trigger: 'board rest, grounded (also stands in for flight — no baby fly clip)' },
      roar: { trigger: 'every bellow: hungry + ambient cadence + intro', loop: false }
    }
  },
  frost_adult: {
    label: 'Frost Dragon (adult)',
    rawDir: `${RAW_BASE}/frost_adult_atlasses`,
    rig: 'sprites/characters/dragon/frost-dragon/rig-adult/frost-dragon.rig.json',
    rigScaleOf: (C) => C.DRAGON_ANIM.whelpScale * C.DRAGON_RIG_SCALE['ember_dragon:4'],
    modes: { fly: 'center' },
    board: 'frost:3',
    clipInfo: {
      idle: { trigger: 'board rest, grounded' },
      roar: { trigger: 'every bellow: hungry + ambient cadence + intro', loop: false },
      fly: {
        trigger: 'flight: unfold → wingbeat cruise → fold',
        // Measured (segments.json): 21f wingbeat @ RMSE 15.1.
        segments: { takeoff: [0, 84], loop: [84, 105], landing: [213, 234] }
      }
    }
  },
  storm_baby: {
    label: 'Storm Dragon (baby)',
    rawDir: `${RAW_BASE}/storm_baby_atlasses`,
    rig: 'sprites/characters/dragon/storm-dragon/rig/dragon-storm.rig.json',
    rigScaleOf: (C) => C.DRAGON_ANIM.whelpScale * C.DRAGON_RIG_SCALE.ember_dragon,
    board: 'storm:2',
    clipInfo: {
      idle: { trigger: 'board rest, grounded (also stands in for flight — no baby fly clip)' },
      roar: { trigger: 'every bellow: hungry + ambient cadence + intro', loop: false }
    }
  },
  moonwhisker_baby: {
    label: 'Moonwhisker (baby)',
    rawDir: `${RAW_BASE}/moonwhisker_baby_atlasses`,
    rig: 'sprites/characters/dragon/moonwhisker-dragon/rig/dragon-moonwhisker.rig.json',
    // Moonwhisker is the EMERALD chain's Emporium skin (store.json `dragon`),
    // so it aligns at the emerald board scales — not ember's like frost/storm.
    rigScaleOf: (C) => C.DRAGON_ANIM.whelpScale * C.DRAGON_RIG_SCALE.emerald,
    board: 'emerald:3',
    skin: 'moonwhisker',
    clipInfo: {
      idle: { trigger: 'board rest, grounded (also stands in for flight — no baby fly clip)' },
      roar: { trigger: 'every bellow: hungry + ambient cadence + intro', loop: false }
    }
  },
  moonwhisker_adult: {
    label: 'Moonwhisker (adult)',
    rawDir: `${RAW_BASE}/moonwhisker_adult_atlasses`,
    rig: 'sprites/characters/dragon/moonwhisker-dragon/rig-adult/moonwhisker-dragon.rig.json',
    rigScaleOf: (C) => C.DRAGON_ANIM.whelpScale * C.DRAGON_RIG_SCALE['emerald:4'],
    modes: { fly: 'center' },
    board: 'emerald:4',
    skin: 'moonwhisker',
    clipInfo: {
      idle: { trigger: 'board rest, grounded' },
      roar: { trigger: 'every bellow: hungry + ambient cadence + intro', loop: false },
      fly: {
        trigger: 'flight: unfold → wingbeat cruise → fold',
        // Measured (segments.json): 63f wingbeat @ RMSE 17.6, fold from 206.
        segments: { takeoff: [0, 124], loop: [124, 187], landing: [206, 234] }
      }
    }
  },
  golden_adult: {
    label: 'Golden Elder',
    rawDir: `${RAW_BASE}/golden_adult_atlasses`,
    rig: 'sprites/characters/dragon/golden-dragon/rig-adult/golden-dragon.rig.json',
    // The Elder is an ALTAR FIXTURE, not a board item: BoardScene.showAltarElder
    // mounts her rig at GOLDEN_ALTAR.elderScale directly — no whelpScale term,
    // unlike every board dragon above. Aligning to any other scale would land
    // the clips at board size and shrink her the moment a clip played.
    rigScaleOf: (C) => C.GOLDEN_ALTAR.elderScale,
    modes: { fly: 'center' },
    // The chain:tier she occupies in the fiction (the altar egg draws
    // `item_golden_egg_2`); dragonClipCharacter resolves her clips by this key.
    board: 'golden_egg:2',
    // Same wan 2.7 route as redadult: anim-plate → anim-generate →
    // anim-ingest --skip 6, every clip pinned to the baked rest pose at both
    // ends. Her baked composite was itself produced for this work (rig layers
    // composited by z — see anim-plate.py's roster note).
    clipInfo: {
      idle: { trigger: 'altar rest — replaces the rig idle preset' },
      roar: { trigger: 'the awakening bellow + ambient elder cadence', loop: false },
      fly: {
        trigger: 'hover blessing: unfold → wingbeat → fold (altar celebrate roll)',
        // Measured (segments.json): 62f wingbeat @ RMSE 15.6, fold from 193.
        segments: { takeoff: [0, 77], loop: [77, 139], landing: [193, 234] }
      }
    }
  },
  // The two LEGENDARIES. Neither has a rig — they are clip-only from birth, so
  // their idle registers against the static board art the clips replace
  // (`item`, not `rig`). Young only: both chains are two tiers, egg then
  // animal, so there is no adult to animate and no fly clip to phase.
  ashdrake_young: {
    label: 'Ashdrake (young)',
    rawDir: `${RAW_BASE}/ashdrake_young_atlasses`,
    item: 'ashdrake:2',
    board: 'ashdrake:2',
    clipInfo: {
      idle: { trigger: 'board rest, grounded (also stands in for flight — no fly clip)' },
      roar: { trigger: 'every bellow: hungry + ambient cadence + hatch intro', loop: false }
    }
  },
  rimewyrm_young: {
    label: 'Rimewyrm (young)',
    rawDir: `${RAW_BASE}/rimewyrm_young_atlasses`,
    item: 'rimewyrm:2',
    board: 'rimewyrm:2',
    clipInfo: {
      idle: { trigger: 'board rest, grounded (also stands in for flight — no fly clip)' },
      roar: { trigger: 'every bellow: hungry + ambient cadence + hatch intro', loop: false }
    }
  },
  storm_adult: {
    label: 'Storm Dragon (adult)',
    rawDir: `${RAW_BASE}/storm_adult_atlasses`,
    rig: 'sprites/characters/dragon/storm-dragon/rig-adult/storm-dragon.rig.json',
    rigScaleOf: (C) => C.DRAGON_ANIM.whelpScale * C.DRAGON_RIG_SCALE['ember_dragon:4'],
    modes: { fly: 'center' },
    board: 'storm:3',
    clipInfo: {
      idle: { trigger: 'board rest, grounded' },
      roar: { trigger: 'every bellow: hungry + ambient cadence + intro', loop: false },
      fly: {
        trigger: 'flight: unfold → wingbeat cruise → fold',
        // Measured (segments.json): 47f wingbeat @ RMSE 12.1.
        segments: { takeoff: [0, 142], loop: [142, 189], landing: [220, 234] }
      }
    }
  }
};

/**
 * Pull a `export const NAME … = { … };` object literal out of Constants.ts and
 * evaluate it. Same approach the build already trusts for ANIMATED_SPEAKERS and
 * SHIPPED (vite.config.ts) — the literals are generated data, not code, and a
 * moved/renamed constant fails loudly here instead of mis-aligning silently.
 */
function readConstLiteral(src, name) {
  const at = src.indexOf(`export const ${name}`);
  if (at < 0) throw new Error(`could not find ${name} in src/core/Constants.ts — did it move?`);
  const open = src.indexOf('{', at);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error(`unbalanced braces reading ${name}`);
  const literal = src
    .slice(open, end + 1)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  return new Function(`return (${literal});`)();
}

function readConstants(root) {
  const src = readFileSync(path.resolve(root, 'src/core/Constants.ts'), 'utf8');
  return {
    STANDEE_BANKS: readConstLiteral(src, 'STANDEE_BANKS'),
    STANDEE_SCALE_TRIM: readConstLiteral(src, 'STANDEE_SCALE_TRIM'),
    DRAGON_ANIM: readConstLiteral(src, 'DRAGON_ANIM'),
    DRAGON_RIG_SCALE: readConstLiteral(src, 'DRAGON_RIG_SCALE'),
    ITEM_SCALE: readConstLiteral(src, 'ITEM_SCALE'), // rig-less breeds register against their item art
    GOLDEN_ALTAR: readConstLiteral(src, 'GOLDEN_ALTAR') // the Elder's altar display scale
  };
}

/** The board art a rig-less breed's clips must register against: the item
 *  texture's file + its board anchor, resolved exactly as BoardScene resolves
 *  them (assets.json for the file, anchors.json for the origin, ITEM_SCALE for
 *  the size — `chain_tier` first, then the bare chain, as acquireSprite does). */
function itemReference(root, entry, C) {
  const [chain, tier] = entry.item.split(':');
  const key = `item_${chain}_${tier}`;
  const assets = JSON.parse(readFileSync(path.resolve(root, 'src/data/assets.json'), 'utf8'));
  const image = assets.images.find((img) => img.key === key)?.file;
  if (!image) throw new Error(`no assets.json image for "${key}" — the item art must ship before its clips`);
  const anchors = JSON.parse(readFileSync(path.resolve(root, 'src/data/anchors.json'), 'utf8'));
  const [anchorX, anchorY] = anchors.byKey[key] ?? anchors.default;
  const scale = C.ITEM_SCALE[`${chain}_${tier}`] ?? C.ITEM_SCALE[chain] ?? 1;
  return {
    kind: 'item',
    image,
    anchorX,
    anchorY,
    scale,
    // The clip overlay hangs at `host.y - groundLift` while the item art hangs
    // at `host.y` (BoardScene.syncDragon vs BoardItem), so the reference box —
    // measured off the art — carries that offset to land in the overlay's own
    // space. Miss it and every rig-less breed sits 20px off the tile.
    groundLift: C.DRAGON_ANIM.groundLift
  };
}

function referenceOf(root, id, entry, C) {
  if (entry.item) return itemReference(root, entry, C);
  if (entry.standee) {
    const bank = C.STANDEE_BANKS[entry.standee];
    if (!bank) throw new Error(`no STANDEE_BANKS entry for "${entry.standee}"`);
    const scale = bank.scale * (C.STANDEE_SCALE_TRIM[entry.standee] ?? 1);
    return {
      kind: 'sprite',
      image: `sprites/${entry.standee}/world-idle.webp`,
      frameWidth: bank.frameWidth,
      frameHeight: bank.frameHeight,
      anchorX: bank.anchorX,
      anchorY: bank.anchorY,
      scale,
      // the tool draws the frame at this size, feet on the anchor
      displayWidth: bank.frameWidth * scale,
      displayHeight: bank.frameHeight * scale,
      origin: [bank.anchorX, bank.anchorY]
    };
  }
  return { kind: 'rig', url: entry.rig, boardScale: entry.rigScaleOf(C) };
}

function readAtlas(root, entry) {
  const file = path.resolve(root, entry.rawDir, 'atlas.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function readRuntimeDoc(root) {
  const file = path.resolve(root, DATA_FILE);
  if (!existsSync(file)) return { version: 1, characters: {} };
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * The tool/state document: every roster character's atlas metadata + in-game
 * reference, plus the current alignment converted back into RAW-frame terms.
 */
export function stateDoc(root) {
  const C = readConstants(root);
  const runtime = readRuntimeDoc(root);
  const characters = {};
  const alignment = { version: 1, characters: {} };
  for (const [id, entry] of Object.entries(ROSTER)) {
    const atlas = readAtlas(root, entry);
    if (!atlas) continue;
    characters[id] = {
      label: entry.label ?? id,
      atlasBase: `${entry.rawDir.replace(/^assets\//, '')}/`,
      atlas,
      // Per-clip game wiring (stage + trigger) so the tool is character-aware:
      // it can say WHAT each clip is for, not just show frames.
      clipInfo: entry.clipInfo ?? {},
      reference: referenceOf(root, id, entry, C)
    };
    const staged = runtime.characters?.[id];
    if (!staged) continue;
    const anims = {};
    for (const [clipId, clip] of Object.entries(staged.clips ?? {})) {
      const raw = atlas.animations[clipId];
      if (!raw) continue;
      // staged scale is game px per STAGED px; the tool edits raw frames
      anims[clipId] = {
        scale: clip.scale * (clip.frameWidth / (clip.srcFrameWidth ?? clip.frameWidth)),
        dx: clip.dx,
        dy: clip.dy
      };
    }
    if (Object.keys(anims).length) {
      alignment.characters[id] = { atlas: `sprites/anims/${id}`, anims };
    }
  }
  return { ok: true, characters, alignment };
}

/**
 * Run the analyzer (scripts/anim-align.py auto) over the roster.
 * @param {string} root
 * @param {{scope?: 'all'|'char'|'anim', character?: string, anim?: string}} opts
 */
export function autoAlign(root, opts = {}) {
  const C = readConstants(root);
  const spec = { root, characters: {} };
  if (opts.character) spec.character = opts.character;
  if (opts.anim) spec.anim = opts.anim;
  for (const [id, entry] of Object.entries(ROSTER)) {
    const atlas = readAtlas(root, entry);
    if (!atlas) continue;
    spec.characters[id] = {
      atlasDir: entry.rawDir,
      animations: atlas.animations,
      modes: entry.modes ?? {},
      runtimeAtlas: `sprites/anims/${id}`,
      reference: referenceOf(root, id, entry, C)
    };
  }
  const r = spawnSync(PY, [path.resolve(root, 'scripts/anim-align.py'), 'auto'], {
    input: JSON.stringify(spec),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  if (r.status !== 0 || !r.stdout.trim()) {
    throw new Error((r.stderr || r.stdout || `anim-align.py exited ${r.status}`).trim().split('\n').pop());
  }
  const out = JSON.parse(r.stdout);
  if (!out.ok) throw new Error(out.error ?? 'analyzer refused');
  return out;
}

/**
 * VIDEO INGEST — the front of the pipeline: mp4 → keyed frames → packed WebP
 * atlas in the character's raw workspace (scripts/anim-ingest.py implements
 * the ATLAS_TUTO.md keying: border-measured plate detection, connectivity
 * black key with the dual-axis pocket kill, colour bleed, union crop, packed
 * to fit the 4096 ceiling). With `write: true` the freshly ingested character
 * is auto-aligned and applied in the same call — video to in-game, one step.
 *
 * @param {string} root
 * @param {{character: string, clip: string, video: string, fps?: number,
 *          height?: number, loop?: boolean, write?: boolean}} opts
 */
export function ingestClip(root, opts) {
  const entry = ROSTER[opts.character];
  if (!entry) throw new Error(`unknown character "${opts.character}" — the roster lives in scripts/apply-anim-align.mjs`);
  if (!opts.clip || !/^[a-z][a-z0-9_]*$/.test(opts.clip)) throw new Error(`bad clip id "${opts.clip}"`);
  const video = path.isAbsolute(opts.video) ? opts.video : path.resolve(root, opts.video);
  if (!existsSync(video)) throw new Error(`no such video: ${opts.video}`);
  const argv = [
    path.resolve(root, 'scripts/anim-ingest.py'),
    video,
    '--dir', path.resolve(root, entry.rawDir),
    '--clip', opts.clip,
    '--maxdim', String(MAX_TEXTURE)
  ];
  if (opts.fps) argv.push('--fps', String(opts.fps));
  if (opts.height) argv.push('--height', String(opts.height));
  if (opts.loop === false) argv.push('--no-loop');
  if (opts.trimLoop) argv.push('--trim-loop');
  if (opts.skip) argv.push('--skip', String(opts.skip));
  if (entry.label) argv.push('--character', entry.label);
  const r = spawnSync(PY, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout.trim()) {
    throw new Error((r.stderr || r.stdout || `anim-ingest.py exited ${r.status}`).trim().split('\n').pop());
  }
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  if (!out.ok) throw new Error(out.error ?? 'ingest refused');
  if (opts.write) {
    // Re-align the WHOLE character, not just this clip: every non-idle clip
    // registers against the idle, so a re-ingested idle moves its siblings.
    const aligned = autoAlign(root, { character: opts.character });
    out.summary = applyAnimAlign(aligned.alignment, root);
    out.alignment = aligned.alignment.characters[opts.character];
  }
  return out;
}

function validateAlignDoc(doc) {
  if (doc?.version !== 1) throw new Error('version must be 1');
  if (typeof doc.characters !== 'object' || doc.characters === null) throw new Error('no characters object');
  for (const [id, c] of Object.entries(doc.characters)) {
    if (!ROSTER[id]) throw new Error(`unknown character "${id}" — the roster lives in scripts/apply-anim-align.mjs`);
    if (typeof c.anims !== 'object' || c.anims === null || !Object.keys(c.anims).length) {
      throw new Error(`${id}: no anims`);
    }
    for (const [aid, t] of Object.entries(c.anims)) {
      for (const k of ['scale', 'dx', 'dy']) {
        if (!Number.isFinite(t?.[k])) throw new Error(`${id}/${aid}: ${k} must be a finite number`);
      }
      if (t.scale <= 0) throw new Error(`${id}/${aid}: scale must be > 0`);
    }
  }
}

/**
 * PUSH TO GAME. Takes the tool's alignment doc (raw-frame terms), stages every
 * referenced sheet into assets/sprites/anims/<char>/ (downscaled frame-exactly
 * if over the 4096 texture ceiling) and writes src/data/character-anims.json
 * with runtime-ready clips. Characters absent from the doc are left untouched.
 *
 * @param {{version: 1, characters: Record<string, {anims: Record<string, {scale:number,dx:number,dy:number}>}>}} doc
 * @param {string} root repo root
 */
export function applyAnimAlign(doc, root) {
  validateAlignDoc(doc);
  const runtime = readRuntimeDoc(root);
  const summary = [];
  for (const [id, c] of Object.entries(doc.characters)) {
    const entry = ROSTER[id];
    const atlas = readAtlas(root, entry);
    if (!atlas) throw new Error(`${id}: raw atlas not found at ${entry.rawDir}`);
    const clips = {};
    for (const [aid, t] of Object.entries(c.anims)) {
      const meta = atlas.animations[aid];
      if (!meta) throw new Error(`${id}/${aid}: not in ${entry.rawDir}/atlas.json`);
      const dstRel = `sprites/anims/${id}/${meta.file}`;
      // A PHASED clip ships only the frames its segments actually play — the
      // cruise footage between the loop and the fold is dead sheet area (64%
      // of a wan lowflight). Kept ranges are merged spans; the written
      // segments are remapped onto the compacted frame order.
      const info0 = entry.clipInfo?.[aid] ?? {};
      let keepSpec = '';
      let remapped = info0.segments;
      if (info0.segments) {
        const spans = Object.values(info0.segments)
          .map(([a, b]) => [a, b])
          .sort((a, b) => a[0] - b[0]);
        const merged = [];
        for (const [a, b] of spans) {
          const last = merged[merged.length - 1];
          if (last && a <= last[1]) last[1] = Math.max(last[1], b);
          else merged.push([a, b]);
        }
        const offsetOf = (frame) => {
          let off = 0;
          for (const [a, b] of merged) {
            if (frame < b) return off + (frame - a);
            off += b - a;
          }
          throw new Error(`${id}/${aid}: segment frame ${frame} outside kept ranges`);
        };
        remapped = Object.fromEntries(
          Object.entries(info0.segments).map(([seg, [a, b]]) => [seg, [offsetOf(a), offsetOf(a) + (b - a)]])
        );
        keepSpec = merged.map(([a, b]) => `${a}-${b}`).join(',');
      }
      // Oversample cap: the DISPLAYED scale is the board transform — except
      // portrait-stage clips, whose ring framing (`portraitView.height` over
      // the frame height) can draw larger than their board registration says.
      const ringScale = info0.stage === 'portrait' && entry.portraitView
        ? entry.portraitView.height / meta.frameHeight
        : 0;
      const dispScale = Math.max(t.scale, ringScale);
      const shrink = dispScale * MAX_OVERSAMPLE < 1 ? dispScale * MAX_OVERSAMPLE : 1;
      const r = spawnSync(
        PY,
        [
          path.resolve(root, 'scripts/anim-align.py'),
          'stage',
          path.resolve(root, entry.rawDir, meta.file),
          path.resolve(root, 'assets', dstRel),
          String(meta.frameWidth),
          String(meta.frameHeight),
          String(meta.cols),
          String(meta.frames),
          String(MAX_TEXTURE),
          keepSpec,
          shrink < 1 ? shrink.toFixed(5) : ''
        ],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
      );
      if (r.status !== 0 || !r.stdout.trim()) {
        throw new Error(
          `${id}/${aid}: stage failed — ` +
            (r.stderr || r.stdout || `exited ${r.status}`).trim().split('\n').pop()
        );
      }
      const staged = JSON.parse(r.stdout);
      if (!staged.ok) throw new Error(`${id}/${aid}: ${staged.error}`);
      const info = info0;
      clips[aid] = {
        file: dstRel,
        frames: staged.frames ?? meta.frames,
        frameWidth: staged.frameWidth,
        frameHeight: staged.frameHeight,
        fps: meta.fps,
        // The EVENT semantics win over the atlas flag: a reaction clip (cast,
        // laugh, tosleep…) is one-shot in the game whatever the sheet loops.
        loop: info.loop ?? !!meta.loop,
        ...(info.stage ? { stage: info.stage } : {}),
        ...(remapped ? { segments: remapped } : {}),
        // the transform was authored against RAW frames; a downscale shrinks
        // the texture, so the runtime scale grows by the same factor
        scale: t.scale * (meta.frameWidth / staged.frameWidth),
        dx: t.dx,
        dy: t.dy,
        srcFrameWidth: meta.frameWidth,
        srcFrameHeight: meta.frameHeight
      };
      summary.push(`${id}/${aid}${staged.resized ? ' (downscaled to fit 4096)' : ''}`);
    }
    // Merge at CLIP level: a partial push (one clip re-aligned over the API)
    // must never silently drop the character's other staged clips.
    runtime.characters[id] = {
      clips: { ...(runtime.characters[id]?.clips ?? {}), ...clips },
      ...(entry.board ? { board: entry.board } : {}),
      ...(entry.skin ? { skin: entry.skin } : {}),
      ...(entry.portraitView ? { portrait: entry.portraitView } : {})
    };
  }
  writeFileSync(path.resolve(root, DATA_FILE), JSON.stringify(runtime, null, 2) + '\n');
  return `staged ${summary.length} clip(s): ${summary.join(', ')} → ${DATA_FILE}`;
}

/* ── CLI ── */
const selfPath = fileURLToPath(import.meta.url);
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === selfPath;
if (invokedDirectly) {
  const root = path.resolve(path.dirname(selfPath), '..');
  const cmd = process.argv[2] ?? 'state';
  if (cmd === 'state') {
    console.log(JSON.stringify(stateDoc(root), null, 2));
  } else if (cmd === 'auto') {
    const out = autoAlign(root, {});
    if (process.argv.includes('--write')) {
      console.log(applyAnimAlign(out.alignment, root));
    }
    console.log(JSON.stringify(out, null, 2));
  } else if (cmd === 'ingest') {
    const [character, clip, video] = process.argv.slice(3);
    const flag = (name) => {
      const at = process.argv.indexOf(name);
      return at > 0 ? process.argv[at + 1] : undefined;
    };
    const out = ingestClip(root, {
      character,
      clip,
      video,
      fps: flag('--fps') ? Number(flag('--fps')) : undefined,
      height: flag('--height') ? Number(flag('--height')) : undefined,
      loop: process.argv.includes('--no-loop') ? false : undefined,
      trimLoop: process.argv.includes('--trim-loop'),
      write: process.argv.includes('--write')
    });
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.error(
      'usage: node scripts/apply-anim-align.mjs state|auto [--write]\n' +
        '       node scripts/apply-anim-align.mjs ingest <character> <clip> <video.mp4> [--fps N] [--height N] [--no-loop] [--trim-loop] [--write]'
    );
    process.exit(1);
  }
}
