/**
 * Face-frame calibration — head-animation PNG sets → src/data/faces.json.
 *
 * The blink / roar-talk sets are the SAME head drawing as the rig's `head`
 * layer, but exported at a different crop + resolution (blink 423×521, talk
 * 857×1079 vs the 666×666 rig piece). Swapping them onto the head layer
 * seamlessly needs, per set:
 *   - textureScale : display scale so the content matches the rig piece 1:1
 *   - originX/Y    : normalized origin so the anchor_head pivot lands on the
 *                    SAME content point (head keeps rotating around its neck)
 *
 * Method: decode the rig's EMBEDDED head PNG (ground truth) + each set's
 * reference frame (mouth-closed / eyes-open — silhouette matches the base),
 * take alpha bounding boxes, derive scale from bbox width, then refine the
 * translation by matching the alpha centroid of the TOP band of the content
 * (horn region — unaffected by eye/mouth variants).
 *
 * Run after adding/regenerating head-animation sets:
 *   node scripts/calibrate-faces.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRAGON_DIR = 'assets/sprites/characters/dragon/red-dragon';
const EMERALD_DIR = 'assets/sprites/characters/dragon/emerald-dragon';
const OUT = path.join(ROOT, 'src/data/faces.json');

/** Face sets per character. `files` is the PLAYBACK order; durations come from
 *  the set's frames.json (same index order). `ref` = frame whose silhouette
 *  matches the rig head (eyes open / mouth closed). */
const CHARACTERS = {
  'dragon-red': {
    rig: `${DRAGON_DIR}/rig/dragon-red.rig.json`,
    layer: 'head',
    fsDir: `${DRAGON_DIR}/head-animation`, // where the PNGs live on disk
    // Served URL prefix — assets/ is the Vite public dir root (same convention
    // as BoardScene's DRAGON_RIGS paths), so it is NOT part of the URL.
    basePath: `${DRAGON_DIR.replace(/^assets\//, '')}/head-animation`,
    sets: {
      blink: {
        dir: 'red-dragon-blink-animation',
        files: [
          'red-dragon-eyes-open.png',
          'red-dragon-eyes-halfOpen.png',
          'red-dragon-eyes-closed.png',
          'red-dragon-eyes-halfOpen2.png'
        ],
        ref: 0
      },
      talk: {
        dir: 'red-dragon-roar_talk-animation',
        files: [
          'red-dragon-roar_talk_00000.png',
          'red-dragon-roar_talk_00001.png',
          'red-dragon-roar_talk_00002.png',
          'red-dragon-roar_talk_00003.png'
        ],
        ref: 0
      }
    }
  },
  'dragon-red-adult': {
    rig: `${DRAGON_DIR}/rig-adult/red-dragon.rig.json`,
    layer: 'head',
    fsDir: `${DRAGON_DIR}/head-animation-adult`,
    basePath: `${DRAGON_DIR.replace(/^assets\//, '')}/head-animation-adult`,
    sets: {
      blink: {
        dir: 'red-dragon-adult-blink-animation',
        files: [
          'red-dragon-adult-eyes-open.png',
          'red-dragon-adult-eyes-halfOpen.png',
          'red-dragon-adult-eyes-closed.png',
          'red-dragon-adult-eyes-halfOpen2.png'
        ],
        ref: 0
      },
      talk: {
        dir: 'red-dragon-adult-roar_talk-animation',
        files: [
          'red-dragon-adult-roar_talk_00000.png',
          'red-dragon-adult-roar_talk_00001.png',
          'red-dragon-adult-roar_talk_00002.png',
          'red-dragon-adult-roar_talk_00003.png'
        ],
        ref: 0
      }
    }
  },
  'dragon-emerald': {
    rig: `${EMERALD_DIR}/rig/dragon-emerald.rig.json`,
    layer: 'head',
    fsDir: `${EMERALD_DIR}/head-animation`,
    basePath: `${EMERALD_DIR.replace(/^assets\//, '')}/head-animation`,
    sets: {
      blink: {
        dir: 'emerald-dragon-blink-animation',
        files: [
          'emerald-dragon-eyes-open.png',
          'emerald-dragon-eyes-halfOpen.png',
          'emerald-dragon-eyes-closed.png',
          'emerald-dragon-eyes-halfOpen2.png'
        ],
        ref: 0
      },
      talk: {
        dir: 'emerald-dragon-roar_talk-animation',
        files: [
          'emerald-dragon-roar_talk_00000.png',
          'emerald-dragon-roar_talk_00001.png',
          'emerald-dragon-roar_talk_00002.png',
          'emerald-dragon-roar_talk_00003.png'
        ],
        ref: 0
      }
    }
  },
  'dragon-emerald-adult': {
    rig: `${EMERALD_DIR}/rig-adult/emerald-dragon.rig.json`,
    layer: 'head',
    fsDir: `${EMERALD_DIR}/head-animation-adult`,
    basePath: `${EMERALD_DIR.replace(/^assets\//, '')}/head-animation-adult`,
    sets: {
      blink: {
        dir: 'emerald-dragon-adult-blink-animation',
        files: [
          'emerald-dragon-adult-eyes-open.png',
          'emerald-dragon-adult-eyes-halfOpen.png',
          'emerald-dragon-adult-eyes-closed.png',
          'emerald-dragon-adult-eyes-halfOpen2.png'
        ],
        ref: 0
      },
      talk: {
        dir: 'emerald-dragon-adult-roar_talk-animation',
        files: [
          'emerald-dragon-adult-roar_talk_00000.png',
          'emerald-dragon-adult-roar_talk_00001.png',
          'emerald-dragon-adult-roar_talk_00002.png',
          'emerald-dragon-adult-roar_talk_00003.png'
        ],
        ref: 0
      }
    }
  },
  'dragon-golden': {
    rig: 'assets/sprites/characters/dragon/golden-dragon/rig-adult/golden-dragon.rig.json',
    layer: 'head',
    fsDir: 'assets/sprites/characters/dragon/golden-dragon/head-animation',
    basePath: 'sprites/characters/dragon/golden-dragon/head-animation',
    sets: {
      blink: {
        dir: 'golden-dragon-blink-animation',
        files: [
          'golden-dragon-eyes-open.png',
          'golden-dragon-eyes-halfOpen.png',
          'golden-dragon-eyes-closed.png',
          'golden-dragon-eyes-halfOpen2.png'
        ],
        ref: 0
      },
      talk: {
        dir: 'golden-dragon-roar_talk-animation',
        files: [
          'golden-dragon-roar_talk_00000.png',
          'golden-dragon-roar_talk_00001.png',
          'golden-dragon-roar_talk_00002.png',
          'golden-dragon-roar_talk_00003.png'
        ],
        ref: 0
      }
    }
  }
};

/* ------------------------- minimal PNG decoder ------------------------- */
/** 8-bit RGBA / RGB, non-interlaced (what our pipeline emits). Returns rgba. */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2) || interlace !== 0) {
    throw new Error(`unsupported PNG (bitDepth ${bitDepth}, colorType ${colorType}, interlace ${interlace})`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = Buffer.alloc(width * height * 4, 255);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.from(line);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      switch (filter) {
        case 1: cur[x] = (cur[x] + a) & 0xff; break;
        case 2: cur[x] = (cur[x] + b) & 0xff; break;
        case 3: cur[x] = (cur[x] + ((a + b) >> 1)) & 0xff; break;
        case 4: cur[x] = (cur[x] + paeth(a, b, c)) & 0xff; break;
      }
    }
    for (let px = 0; px < width; px++) {
      const s = px * channels, d = (y * width + px) * 4;
      rgba[d] = cur[s];
      rgba[d + 1] = cur[s + 1];
      rgba[d + 2] = cur[s + 2];
      if (channels === 4) rgba[d + 3] = cur[s + 3];
    }
    prev = cur;
  }
  return { width, height, rgba };
}

const A_THRESH = 16;

function alphaBBox({ width, height, rgba }) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > A_THRESH) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('empty alpha');
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Alpha centroid restricted to the top `frac` of a bbox (the horn region —
 *  stable across eye/mouth variants). */
function topBandCentroid(img, bbox, frac = 0.3) {
  const { width, rgba } = img;
  const yEnd = bbox.y + Math.round(bbox.h * frac);
  let sx = 0, sy = 0, n = 0;
  for (let y = bbox.y; y < yEnd; y++) {
    for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
      const a = rgba[(y * width + x) * 4 + 3];
      if (a > A_THRESH) { sx += x * a; sy += y * a; n += a; }
    }
  }
  return { x: sx / n, y: sy / n };
}

/** PROOF pass — re-project the variant's alpha mask through the computed
 *  mapping and measure how exactly it lands on the base head:
 *  IoU of the silhouettes + how far the scaled content box drifts (px).
 *  Guarantees the worn frame has the SAME content scale as the original head. */
function verifyMapping(base, baseBox, baseTop, ref, refBox, refTop, scale, label) {
  // Content box match (scale exactness): scaled ref bbox vs base bbox, px.
  const wDrift = refBox.w * scale - baseBox.w;
  const hDrift = refBox.h * scale - baseBox.h;
  // Silhouette IoU sampled on the base grid.
  let inter = 0, union = 0;
  for (let y = baseBox.y; y < baseBox.y + baseBox.h; y++) {
    for (let x = baseBox.x; x < baseBox.x + baseBox.w; x++) {
      const b = base.rgba[(y * base.width + x) * 4 + 3] > A_THRESH;
      const rx = Math.round(refTop.x + (x - baseTop.x) / scale);
      const ry = Math.round(refTop.y + (y - baseTop.y) / scale);
      const inRef = rx >= 0 && ry >= 0 && rx < ref.width && ry < ref.height;
      const r = inRef && ref.rgba[(ry * ref.width + rx) * 4 + 3] > A_THRESH;
      if (b && r) inter++;
      if (b || r) union++;
    }
  }
  const iou = inter / union;
  console.log(
    `  ✓ ${label}: content-scale drift ${wDrift.toFixed(2)}px × ${hDrift.toFixed(2)}px, silhouette IoU ${(iou * 100).toFixed(1)}%`
  );
  if (Math.abs(wDrift) > 0.51) throw new Error(`${label}: content width drift ${wDrift.toFixed(2)}px — scale is NOT exact`);
  if (iou < 0.94) throw new Error(`${label}: silhouette IoU ${(iou * 100).toFixed(1)}% < 94% — alignment off`);
}

/* ------------------------------- main ---------------------------------- */
const out = {};
for (const [character, spec] of Object.entries(CHARACTERS)) {
  const rig = JSON.parse(readFileSync(path.join(ROOT, spec.rig), 'utf8'));
  const layer = rig.layers.find((l) => l.name === spec.layer);
  if (!layer) throw new Error(`${character}: rig has no layer '${spec.layer}'`);
  const anchor = rig.anchors.find((a) => a.childLayer === spec.layer);
  if (!anchor) throw new Error(`${character}: layer '${spec.layer}' has no anchor`);
  const dataUri = rig.images?.[layer.file];
  if (!dataUri) throw new Error(`${character}: rig embeds no image for ${layer.file}`);
  const base = decodePng(Buffer.from(dataUri.split(',')[1], 'base64'));
  if (base.width !== layer.width || base.height !== layer.height) {
    throw new Error(`${character}: embedded ${layer.file} is ${base.width}×${base.height}, rig says ${layer.width}×${layer.height}`);
  }
  const baseBox = alphaBBox(base);
  const baseTop = topBandCentroid(base, baseBox);
  // The anchor pivot, as a point INSIDE the head content (content-relative).
  const pivotPx = { x: anchor.childOriginNorm.x * base.width, y: anchor.childOriginNorm.y * base.height };

  const sets = {};
  for (const [setName, setSpec] of Object.entries(spec.sets)) {
    const dir = path.join(ROOT, spec.fsDir, setSpec.dir);
    const framesMeta = JSON.parse(readFileSync(path.join(dir, 'frames.json'), 'utf8'));
    if (framesMeta.frameCount !== setSpec.files.length) {
      throw new Error(`${character}/${setName}: frames.json says ${framesMeta.frameCount} frames, config lists ${setSpec.files.length}`);
    }
    const ref = decodePng(readFileSync(path.join(dir, setSpec.files[setSpec.ref])));
    const refBox = alphaBBox(ref);
    // Scale: content width must match (mouth/eye variants never widen the ref frame).
    const scale = baseBox.w / refBox.w;
    const hRatio = (baseBox.h / refBox.h) / scale;
    if (Math.abs(1 - hRatio) > 0.02) {
      console.warn(`  ⚠ ${character}/${setName}: bbox aspect drift ${((hRatio - 1) * 100).toFixed(1)}% (w-scale kept)`);
    }
    // Translation: match top-band (horn) centroids, immune to jaw/eye changes.
    const refTop = topBandCentroid(ref, refBox);
    // basePx → refPx mapping: refPx = refTop + (basePx - baseTop) / scale
    const pivotRef = {
      x: refTop.x + (pivotPx.x - baseTop.x) / scale,
      y: refTop.y + (pivotPx.y - baseTop.y) / scale
    };
    sets[setName] = {
      dir: setSpec.dir,
      textureScale: +scale.toFixed(5),
      originX: +(pivotRef.x / ref.width).toFixed(5),
      originY: +(pivotRef.y / ref.height).toFixed(5),
      frames: setSpec.files.map((file, i) => ({
        file,
        durationMs: framesMeta.frames[i].durationMs
      }))
    };
    console.log(
      `${character}/${setName}: ${ref.width}×${ref.height} scale ${scale.toFixed(4)} ` +
      `origin (${sets[setName].originX}, ${sets[setName].originY}) ` +
      `[base bbox ${baseBox.w}×${baseBox.h}, ref bbox ${refBox.w}×${refBox.h}]`
    );
    verifyMapping(base, baseBox, baseTop, ref, refBox, refTop, scale, `${character}/${setName}`);
  }
  out[character] = { layer: spec.layer, basePath: spec.basePath, sets };
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`→ wrote ${path.relative(ROOT, OUT)}`);
