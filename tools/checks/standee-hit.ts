/**
 * STANDEE HIT vs THE BOARD — the geometry proof behind BoardScene's standee
 * hit-area rule. No browser, no Playwright: it recomputes offline exactly what
 * the scene computes, and samples the standee's own texture alpha.
 *
 *   pnpm exec tsx tools/checks/standee-hit.ts
 *
 * A world standee is ~2 tiles tall, so her BODY box hangs over the cells drawn
 * BEHIND her. Those cells sort at a LOWER depth, so Phaser's `topOnly` cuts the
 * hit list down to the standee and a piece standing there answers neither tap
 * nor drag. This measures, per affected cell:
 *
 *   VISIBLE   — the share of the piece's footprint the standee does NOT paint
 *               over: what the player can actually see of it.
 *   OLD RULE  — whole-body rect + `Rectangle.Contains`: a visible pixel is
 *               tappable only if it falls OUTSIDE the rect.
 *   NEW RULE  — same rect, but the callback also demands the standee's own
 *               opaque pixels, so every visible pixel is tappable.
 *
 * Fails when a cell has a visible piece that the rule under test swallows
 * whole — and reports the OLD rule's failures alongside, which is the defect
 * this check exists for.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DRAGON_OUTLINE, STANDEE_BANKS, STANDEE_SCALE_TRIM, TILE_W } from '../../src/core/Constants';
import type { MapData } from '../../src/core/types';
import { artScaleAt, buildWorlds, worldPointOf } from '../../src/core/world';
import { keylineUnits } from '../../src/render/rigInkGeometry';
import charactersJson from '../../src/data/characters.json';
import mapJson from '../../src/data/map.json';

/** A piece's drawn footprint in CONTAINER-LOCAL px, from BoardItem's own art
 *  box (`setSize(152,152)`, displayOrigin 76,76; art rect 4,16,144,88) — so the
 *  art reaches 60 above its cell point and 28 below. Multiplied by the zone's
 *  `artScale`, which is what actually sizes a piece in a hand-drawn world. */
const PIECE = { left: -72, right: 72, top: -60, bottom: 28 };

/** Samples per axis over that footprint. */
const N = 32;

interface CharCfg {
  id: string;
  art?: string;
  world: string;
  anchor: [number, number];
  dx?: number;
  dy?: number;
}

interface Mask {
  w: number;
  h: number;
  a: Uint8Array;
}

/** Frame 0 of a bank sheet as an alpha mask — python/PIL decodes the webp. */
function alphaMask(art: string, frameWidth: number, frameHeight: number): Mask {
  const out = join(tmpdir(), `standee-${art}.alpha`);
  execFileSync('python3', [
    '-c',
    `from PIL import Image
im = Image.open('assets/sprites/${art}/world-idle.webp').convert('RGBA')
open(${JSON.stringify(out)}, 'wb').write(im.crop((0, 0, ${frameWidth}, ${frameHeight})).split()[3].tobytes())`
  ]);
  return { w: frameWidth, h: frameHeight, a: new Uint8Array(readFileSync(out)) };
}

const opaque = (m: Mask, x: number, y: number): boolean => {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= m.w || py >= m.h) return false;
  return m.a[py * m.w + px] > 0;
};

/** BoardScene's `standeeOpaqueAt`: her painted pixels, plus the keyline ring the
 *  ink twin draws past them — which is her DRAWN silhouette and nothing more. */
const paints = (m: Mask, x: number, y: number, ring: number): boolean => {
  if (opaque(m, x, y)) return true;
  if (ring <= 0) return false;
  return (
    opaque(m, x + ring, y) ||
    opaque(m, x - ring, y) ||
    opaque(m, x, y + ring) ||
    opaque(m, x, y - ring) ||
    opaque(m, x + ring, y + ring) ||
    opaque(m, x - ring, y - ring) ||
    opaque(m, x + ring, y - ring) ||
    opaque(m, x - ring, y + ring)
  );
};

const worlds = buildWorlds(mapJson as unknown as MapData);
let failNew = 0;
let failOld = 0;

for (const cfg of (charactersJson as unknown as { characters: CharCfg[] }).characters) {
  const art = cfg.art ?? cfg.id;
  const bank = STANDEE_BANKS[art];
  const world = worlds.get(cfg.world);
  if (!bank || !world) continue;

  const scale = bank.scale * (STANDEE_SCALE_TRIM[art] ?? 1);
  const ratio = TILE_W / (world.map.tile?.width ?? TILE_W);
  const cell = worldPointOf(world, cfg.anchor[0], cfg.anchor[1]);
  const feetX = cell.x + (cfg.dx ?? 0) * ratio;
  const feetY = cell.y + (cfg.dy ?? 0) * ratio; // her depth is where she is DRAWN
  // World px of texture (0,0): her origin is her FEET (the bake anchor).
  const sx = feetX - bank.anchorX * bank.frameWidth * scale;
  const sy = feetY - bank.anchorY * bank.frameHeight * scale;
  const b = bank.body;
  const box = { x: sx + b.x * scale, y: sy + b.y * scale, w: b.width * scale, h: b.height * scale };
  const mask = alphaMask(art, bank.frameWidth, bank.frameHeight);
  // The scene's ring: her keyline, in on-board units, expressed in texture px.
  const ring =
    keylineUnits(Math.max(bank.frameWidth, bank.frameHeight) * scale, DRAGON_OUTLINE) / scale;
  const inBox = (x: number, y: number): boolean =>
    x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;

  console.log(
    `\n${cfg.id} (${art}) in ${cfg.world} — feet y ${feetY.toFixed(0)}, ` +
      `body x[${box.x.toFixed(0)},${(box.x + box.w).toFixed(0)}] y[${box.y.toFixed(0)},${(box.y + box.h).toFixed(0)}], ` +
      `keyline ring ${ring.toFixed(1)} texture px (${(ring * scale).toFixed(1)} world px)`
  );

  // She must still answer where the bubble's arrow points: the top-centre of
  // her body box is the marker point `characterMarkerPoint` hands the tutorial.
  let head: number | null = null;
  for (let d = 0; d < box.h * 0.5 && head === null; d += 1) {
    if (paints(mask, (box.x + box.w / 2 - sx) / scale, (box.y + d - sy) / scale, ring)) head = d;
  }
  console.log(
    head === null
      ? '  !! her head does not answer — the whole-body rect would be a dead button'
      : `  head answers ${head.toFixed(0)}px below the top of her body box`
  );
  if (head === null) failNew++;

  for (const k of world.playable) {
    const [col, row] = k.split(',').map(Number);
    const p = worldPointOf(world, col, row);
    if (p.y >= feetY) continue; // drawn in FRONT of her — depth already wins
    const a = artScaleAt(world, col, row);
    const r = {
      x0: p.x + PIECE.left * a,
      x1: p.x + PIECE.right * a,
      y0: p.y + PIECE.top * a,
      y1: p.y + PIECE.bottom * a
    };
    if (r.x1 < box.x || r.x0 > box.x + box.w || r.y1 < box.y || r.y0 > box.y + box.h) continue;

    let claimed = 0; // inside the whole-body rect
    let visible = 0; // she does not paint it
    let oldTappable = 0; // visible AND outside the rect
    let newTappable = 0; // visible (the alpha callback yields every one)
    const total = N * N;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x = r.x0 + ((i + 0.5) / N) * (r.x1 - r.x0);
        const y = r.y0 + ((j + 0.5) / N) * (r.y1 - r.y0);
        const boxed = inBox(x, y);
        const painted = boxed && paints(mask, (x - sx) / scale, (y - sy) / scale, ring);
        if (boxed) claimed++;
        if (painted) continue;
        visible++;
        newTappable++;
        if (!boxed) oldTappable++;
      }
    }
    if (!claimed) continue;
    const pct = (n: number): string => `${((100 * n) / total).toFixed(0).padStart(3)}%`;
    const verdict = visible > 0 && oldTappable === 0 ? '  <-- SWALLOWED by the old rule' : '';
    console.log(
      `  cell (${col},${row}) @ y ${p.y.toFixed(0)}: rect claims ${pct(claimed)}, ` +
        `visible ${pct(visible)}, tappable old ${pct(oldTappable)} / new ${pct(newTappable)}${verdict}`
    );
    if (visible > 0 && oldTappable === 0) failOld++;
    if (visible > 0 && newTappable === 0) failNew++;
  }
}

console.log(`\nold rule: ${failOld} cell(s) with a visible piece and nowhere to tap it.`);
console.log(`new rule: ${failNew} cell(s) with a visible piece and nowhere to tap it.`);
process.exit(failNew === 0 ? 0 : 1);
