#!/usr/bin/env python3
"""New dragon BREEDS and SKINS from an existing rig — parts sheet in, rig-ready
folder out.

  dragonbreed.py <brief.json> [--stage young|adult|both] [--from red]
                 [--only prepare,prompt,generate,slice] [--job sheet-pro]
                 [--work DIR] [--out-root DIR] [--dry-run]

Every shipped breed (red, emerald, golden — and golden's `sprite-sunset` skin)
is the SAME rig with different pixels: identical layer names, identical z order,
identical bounds, identical anchors and pins. That is the whole reason this is
cheap: a new breed is not a new character, it is a new set of part images that
must drop onto an existing rig without moving anything. So the pipeline's one
hard rule is REGISTRATION — every part comes back on its original canvas, at its
original size, in its original place. Nothing else about the rig is touched.

The four steps (`--only` takes any comma-separated subset, in this order):

  prepare   Read the source rig and lay every layer out on ONE key-coloured
            sheet: a cols x rows grid, one part per cell, each part's own canvas
            contain-fit into its cell. The placement is recorded as FRACTIONS of
            the sheet, so slicing is exact whatever size the model returns.
            Writes `<stage>-parts.png` (the model's input), `<stage>-parts.json`
            (the manifest — which part is in which cell) and
            `<stage>-parts-map.png`, a labelled human map that is NEVER sent to
            the model (drawn labels would be repainted into the cells).
  prompt    Compose the stage's prompt from the brief and the manifest. The cell
            list goes IN the prompt, so the model is told which cell holds which
            part rather than having to guess. Written to `<stage>-prompt.txt` so
            it can be read and edited before any money is spent.
  generate  artgen.py <job> with the parts sheet as the reference image.
  slice     Cut each cell back out on its fractional rect (reaching into the
            cell margin in free mode, see BREED vs SKIN), resize onto the
            layer's canvas, de-key on the MEASURED key, drop speckle, and
            register — alpha bbox for a skin, core+joint for a breed. Every part
            is reported with its `fit` (how much of the source it still covers),
            whether its scale hit the clamp, whether it touches its own border,
            and any detached fragments. Those four are the failures; a large dx
            in free mode is not one.
  (then)    Write the rig-ready folder: the parts, plus a rig.json that is the
            source rig with `file` repointed, `character` renamed and `images`
            RE-EMBEDDED. That last one is not optional: RigPlayer.preload loads
            textures from `rig.images[layer.file]`, so a rig.json carrying the
            old breed's base64 renders the old breed no matter what is on disk.

The brief (JSON) is the only thing an author writes:

  {
    "id": "frost",                  // -> frost-dragon/, dragon-frost.rig.json
    "name": "Frost Dragon",
    "concept": "one sentence — what this animal IS",
    "silhouette": "what the OUTLINE reads as",   // required for a breed
    "personality": "who it is, so the art can show it",       // optional
    "scales": "...", "wings": "...", "head": "...", "limbs": "...",
    "palette": "named hexes",
    "young": "extra notes for the hatchling sheet",           // optional
    "adult": "extra notes for the grown sheet",               // optional
    "avoid": "..."                                            // optional
  }

BREED vs SKIN — `skin_of` is the switch, and it changes both the prompt and the
registration:

  BREED (no `skin_of`, `silhouette` required). The outline is MEANT to differ,
  or the breed ships as a recolour. What a shared rig actually pins down is not
  the outline but the JOINTS: a part's pivot is a pixel inside its own canvas
  (`childLocal` on the rig's anchor) and the tail's deform pins are pixels along
  the tail. So horns, crest, frill, back spines, wing trailing edge, claws, tail
  tip and anything growing on top of the body are free; the skull, limb bones,
  wing bones, tail centreline and every cut edge are not. Registration switches
  to a core+joint estimator, because a bbox match would read a new pair of horns
  as "the part moved up" and shove the whole head down.

  SKIN (`skin_of": "red"`). Surface only, outline locked, bbox registration, and
  it lands INSIDE the base breed's folder as `sprite-<id>` / `rig-<id>` — the
  convention golden's `sprite-sunset` already set.

A body plan the rig does not have (a wyvern, a serpent, a four-winged dragon) is
NOT reachable from here. That needs a new rig authored in `tools/rigger`.
"""
import argparse
import base64
import io
import json
import os
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
ARTGEN = os.path.join(HERE, 'artgen.py')
DRAGONS = os.path.join(ROOT, 'assets/sprites/characters/dragon')

# The sheet is authored at 16:9 because every Gemini `sheet*` job is locked to
# it. Cells are sliced on fractions, so the model may return any size.
SHEET = (4096, 2304)
PAD_PCT = 0.07          # margin inside each cell, as a fraction of its short side
KEY = (255, 0, 255)     # magenta — see the de-spill note in dekey.py
# Registration guard rails. A part that comes back more than this far off was
# not "drawn a little differently", it was drawn wrong; correcting it silently
# would hide a bad generation behind a good-looking folder.
SCALE_CLAMP = (0.86, 1.16)
DEADZONE_SCALE = 0.01
# Speckle: a detached blob smaller than this fraction of the part's own body is
# always model noise (on a 666² canvas that is a ~30px fleck) and is deleted
# before registration, because a stray island drags the core centroid with it.
# Anything BIGGER is reported instead of deleted — a storm breed's arcs and a
# moonwhisker's streamers legitimately come off the body.
ISLAND_DROP = 0.005
ISLAND_REPORT = 0.05
# How well the registered part must still cover the source. Below this the
# generation is wrong, not the crop. Calibrated on the storm/mossback/moonwhisker
# run: a skin never dropped under 0.90, while GOOD free-mode parts that genuinely
# reshaped (moonwhisker's streamered wings, mossback's mossed body) sat at
# 0.61-0.64 — so a free floor of 0.70 was pure false alarm. 0.55 fires only when
# a part has actually stopped being the part it replaced.
FIT_FLOOR = {'locked': 0.90, 'free': 0.55}
# Most a part canvas may grow per side in free mode, to catch horns/moss painted
# past the original outline. Bounded because the growth is only free inside the
# cell's own margin — past that the crop would start eating the neighbour.
PAD_MAX = 64

# The keyline. Width/strength in canvas pixels — the young 666 canvas and the
# trimmed adult canvases draw the animal at comparable scale, so one setting
# covers both. JOINT_R is the radius around a socket where NO outline is drawn
# (a keyline there becomes a collar across the finished dragon's neck), and
# JOINT_TRIM is how much alpha is shaved at the socket to take off a keyline the
# model painted anyway — safe because a socket is always covered by the part it
# plugs into.
OUTLINE_RGB = (36, 27, 34)      # PALETTE.night — what the shipped art outlines with
OUTLINE_W = 5.0
OUTLINE_STRENGTH = 0.55
JOINT_R = 78.0
JOINT_FEATHER = 46.0
JOINT_TRIM = 4.0

STAGES = {
    # stage: (rig dir, sprite dir, grid cols x rows, rig `character` suffix)
    'young': {'rig_dir': 'rig', 'sprite_dir': 'sprite', 'grid': (4, 2), 'suffix': ''},
    'adult': {'rig_dir': 'rig-adult', 'sprite_dir': 'sprite-adult', 'grid': (3, 2),
              'suffix': '-adult'},
}

# Read once, by z: the order the rig draws them in, so cell 1 is the backmost
# part. Deterministic, and it means the sheet reads back-to-front like the rig.
PART_ENGLISH = {
    'body_tail': 'the BODY with the tail',
    'head': 'the HEAD',
    'wing_left': 'the LEFT WING',
    'wing_right': 'the RIGHT WING',
    'hand_left': 'the LEFT ARM and hand',
    'hand_right': 'the RIGHT ARM and hand',
    'foot_left': 'the LEFT LEG and foot',
    'foot_right': 'the RIGHT LEG and foot',
}

STAGE_ANATOMY = {
    'young': (
        'STAGE — every cell already holds a HATCHLING: oversized head, huge eyes, '
        'short stubby limbs, soft rounded forms, small wings. Keep that stage '
        'exactly. Do not age the animal up, do not lengthen the muzzle or the '
        'limbs, do not slim the body.\n'
        '  THIS IS A BABY, and it must never be made threatening. No narrowed or '
        'slitted eyes, no heavy furrowed brow, no creases or wrinkles, no jutting '
        'jaw, no bared tusks or fangs, no scars, no snarl. A hatchling with a '
        'temper shows it the way a small child does — a pout or a scowl over BIG '
        'ROUND eyes, puffed cheeks, ears and crest up. Cute first, fierce second. '
        'An adult face on a baby body is the single worst thing you can return.'),
    'adult': (
        'STAGE — every cell already holds a GROWN dragon: longer muzzle, heavier '
        'brow and horns, thicker limbs, broad wings, harder edges. Keep that '
        'stage exactly. Do not turn it back into a baby, do not shrink the head '
        'or round off the forms.'),
}

STYLE_BLOCK = (
    'STYLE — painterly mobile-game creature art, chunky readable shapes, soft '
    'gradients, a premium merge-game look, smooth and clean with no visible '
    'brushwork and no surface noise. Hand-painted, NOT a photograph — no '
    'photographic scale texture, no ray-traced reflections, no studio product '
    'lighting. Light from the upper left on every part, exactly as the sheet is '
    'already lit.')

PERSPECTIVE_BLOCK = (
    'PERSPECTIVE — every part is drawn from EXACTLY the angle it already has in '
    'the sheet: the same three-quarter view, the same foreshortening, the same '
    'tilt, the head still turned the same way. Do not rotate a part, do not turn '
    'the head toward the viewer, do not flatten anything into a flat side view, '
    'do not re-light it from another direction. These parts are assembled into '
    'one animal, so a part drawn from its own camera is unusable.')

# What a shared rig actually pins down. The pivot a part rotates around is a
# PIXEL inside its canvas (`childLocal` on the rig's anchor), and the tail's
# deform pins are pixels along the tail — so the skeleton's position inside the
# canvas is load-bearing and the outline is not. That is the whole licence a new
# breed gets, and the whole limit.
SILHOUETTE_FREE = (
    'SILHOUETTE — this breed has to be nameable from its outline alone, and must '
    'not be mistakable for the breed in the sheet. {want}\n'
    '  You MAY reshape the FREE edges to get there: the horns, the crest, frill '
    'and ears, the spines and ridges running along the back and tail, the '
    'trailing edge and scalloping of the wing membranes, the shape of the claws, '
    'the tip of the tail, and any fur, moss, feathering or growth sitting on top '
    'of the body.\n'
    '  You MUST NOT move the skeleton under it: the skull, the neck, the upper '
    'and lower limb bones, the wing arm bones and the tail centreline all keep '
    'exactly the position, length, thickness and angle they have in the sheet.\n'
    '  The CUT EDGE where a part was separated — the neck stump on the head, the '
    'shoulder end of an arm or wing, the hip end of a leg — does not move by a '
    'single pixel. That edge is the joint the animation rotates around.\n'
    '  Everything you add grows OUTWARD from the shape that is already there. It '
    'never displaces it, and it never leaves the cell.')
SILHOUETTE_LOCKED = (
    'SILHOUETTE — this is a SKIN, not a new animal: the outline does not change '
    'at all. Every part keeps its exact silhouette, edge for edge — same horns, '
    'same crest, same wing shape, same claws, same tail. Only the surface '
    'changes. Laid over the original, each part must cover it exactly.')

PERSONALITY_BLOCK = (
    'PERSONALITY — {who}\n'
    '  This has to be READABLE in the art, not just implied. It shows in the '
    'shape of the eye and the brow, the set of the mouth, how the crest, ears '
    'and spines sit, and in the wear, marks and small details on the body. It '
    'must NOT be expressed through the pose: the pose is fixed by the sheet and '
    'every part stays exactly as posed.')

# The lesson from the frost breed's first pass: asked for "a subtle dark outline
# around each part", the model outlines every cell as if it were a standalone
# icon — and the head's outline then draws a black seam straight across the neck
# of the ASSEMBLED dragon, where the head is supposed to sit over the body.
EDGES_BLOCK = (
    'EDGES — these parts are assembled into one animal afterwards and they '
    'OVERLAP each other. Keep exactly the edge treatment the sheet already has: '
    'do NOT add a dark outline, stroke, keyline or rim around a part, and do NOT '
    'close off the cut edge where a part was separated — the neck stump on the '
    'head, the shoulder end of an arm or a wing, the hip end of a leg. Those cut '
    'edges stay soft and open exactly as in the sheet. An outline drawn there '
    'becomes a black seam across the finished dragon.')

BG_BLOCK = (
    'BACKGROUND — the flat pure magenta #FF00FF field is kept exactly as it is, '
    'edge to edge, completely even, between and around every part. No cell '
    'borders, no boxes, no grid lines, no labels, no text, no numbers, no '
    'shadows, no ground, no glow spilling onto the magenta. Nothing magenta, '
    'pink, violet or purple anywhere in the dragon itself — that colour is the '
    'key and would be cut out of the artwork.')


# --------------------------------------------------------------------------- #
# helpers

def load_rig(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def is_free(brief):
    """A BREED reshapes its outline (free), a SKIN does not (locked). `skin_of`
    is the switch: it names the breed being re-skinned, and its presence means
    'surface only'. It also picks the output convention — a breed gets its own
    `<id>-dragon/` folder, a skin lands inside the base breed's folder as
    `sprite-<id>` / `rig-<id>`, the way golden's `sprite-sunset` already does."""
    return not brief.get('skin_of')


def find_rig(breed, stage):
    d = os.path.join(DRAGONS, f'{breed}-dragon', STAGES[stage]['rig_dir'])
    hits = sorted(f for f in os.listdir(d) if f.endswith('.rig.json'))
    if not hits:
        sys.exit(f'no .rig.json in {d}')
    return os.path.join(d, hits[0])


def layer_image(rig, layer, sprite_dir):
    """The part's pixels. Disk first (that is what an author edits), then the
    rig's own embedded data URI (what the runtime actually draws)."""
    on_disk = os.path.join(sprite_dir, layer['file'])
    if os.path.exists(on_disk):
        return Image.open(on_disk).convert('RGBA')
    uri = (rig.get('images') or {}).get(layer['file'])
    if not uri:
        sys.exit(f'no pixels for layer {layer["name"]} ({layer["file"]})')
    return Image.open(io.BytesIO(base64.b64decode(uri.split(',', 1)[1]))).convert('RGBA')


def alpha_bbox(img, thr=8):
    bb = img.getchannel('A').point(lambda a: 255 if a > thr else 0).getbbox()
    return bb


def measure_key(img):
    """The generated sheet's ACTUAL background colour. Both routes drift off
    #FF00FF (Seedream by a lot, JPEG ringing by a little) and de-keying against
    the nominal colour leaves a coloured halo on every edge."""
    w, h = img.size
    pts = [(4, 4), (w - 5, 4), (4, h - 5), (w - 5, h - 5), (w // 2, 4), (4, h // 2)]
    px = np.array([img.convert('RGB').getpixel(p) for p in pts], dtype=float)
    return tuple(np.median(px, axis=0))


def dekey(img, key, lo=90.0, hi=190.0):
    """dekey.py's maths, vectorised (a cell is ~2 MP and the pure-python loop
    would take minutes per part): soft alpha ramp on distance to the key, plus
    the magenta de-spill `max(0, min(r,b) - g)` that never touches warm golds."""
    a = np.array(img.convert('RGBA'), dtype=np.float32)
    rgb, kr = a[..., :3], np.array(key, dtype=np.float32)
    dist = np.sqrt(((rgb - kr) ** 2).sum(-1))
    alpha = np.clip((dist - lo) / max(1.0, hi - lo), 0.0, 1.0) * 255.0
    spill = np.maximum(0.0, np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1])
    edge = (dist < hi) | (spill > 96)
    cut = np.where(dist < hi, spill, spill * 0.5)[..., None] * np.array([1.0, 0.0, 1.0])
    rgb = np.where(edge[..., None], np.clip(rgb - cut, 0, 255), rgb)
    return Image.fromarray(np.dstack([rgb, alpha]).astype(np.uint8), 'RGBA')


def _core(img, erode=9, canvas=None):
    """The part's MASS, with its thin appendages taken off. A MinFilter erodes
    the alpha by (erode-1)/2 px, which deletes horns, spines, whiskers and
    membrane scallops while leaving the skull, the limb bones and the body — so
    a breed that grows a crest still measures the same core as the one it came
    from.

    `canvas` pastes the result at (0,0) of a canvas-sized frame. Rescaling a
    part changes its pixel dimensions, and two masks can only be compared in
    ONE frame — the same frame the final `alpha_composite` offset is in."""
    a = img.getchannel('A').point(lambda v: 255 if v > 8 else 0)
    a = a.filter(ImageFilter.MinFilter(erode))
    if canvas and a.size != tuple(canvas):
        frame = Image.new('L', tuple(canvas), 0)
        frame.paste(a.crop((0, 0, min(a.width, canvas[0]), min(a.height, canvas[1]))), (0, 0))
        a = frame
    return np.array(a) > 127


def _shift_iou(a, b, dx, dy):
    """IoU of two bool masks with b shifted by (dx, dy). Sliced, not rolled —
    an adult part is trimmed to its content, so a roll would wrap the limb
    around the canvas and score it against itself."""
    h, w = a.shape
    ax0, ax1 = max(0, dx), min(w, w + dx)
    bx0, bx1 = max(0, -dx), min(w, w - dx)
    ay0, ay1 = max(0, dy), min(h, h + dy)
    by0, by1 = max(0, -dy), min(h, h - dy)
    if ax1 <= ax0 or ay1 <= ay0:
        return 0.0
    av, bv = a[ay0:ay1, ax0:ax1], b[by0:by1, bx0:bx1]
    inter = np.logical_and(av, bv).sum()
    union = a.sum() + b.sum() - inter
    return float(inter) / float(union) if union else 0.0


def drop_islands(img):
    """Delete speckle left floating in the cell, and report the rest.

    Observed on the storm hatchling: a stray spark painted a few hundred pixels
    off the leg. Left in, it is a floating artefact on the board AND it drags
    the core centroid, so registration then shifts the whole limb to chase it.
    Deleting is only safe for specks — detached art is real on some breeds — so
    anything above ISLAND_DROP is left alone and named in the report."""
    a = np.array(img.getchannel('A'))
    lab, n = ndimage.label(a > 40)
    if n <= 1:
        return img, []
    areas = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    biggest = areas.max()
    keep = np.ones(n + 1, dtype=bool)
    dropped, noted = 0, []
    for i, area in enumerate(areas, start=1):
        frac = area / biggest
        if frac >= 1.0:
            continue
        if frac < ISLAND_DROP:
            keep[i] = False
            dropped += 1
        elif frac < ISLAND_REPORT:
            noted.append(round(float(frac), 3))
    if dropped:
        out = np.array(img)
        out[..., 3] = np.where(keep[lab], out[..., 3], 0)
        img = Image.fromarray(out, 'RGBA')
    return img, {'dropped': dropped, 'detached': noted} if (dropped or noted) else []


def fit_score(placed, src, free):
    """How much of the source the registered part still covers. This is the
    number worth flagging on — a big dx in FREE mode is normal (the estimator
    is correcting for a new crest), a low overlap never is."""
    a = _core(src, canvas=src.size) if free else np.array(src.getchannel('A')) > 8
    b = _core(placed, canvas=src.size) if free else np.array(placed.getchannel('A')) > 8
    if a.shape != b.shape or not a.any():
        return 0.0
    return round(_shift_iou(a, b, 0, 0), 3)


def register(new, src, canvas, joint=None, free=False):
    """Put the repainted part back where the old one stood.

    LOCKED silhouette (a skin): the outline is supposed to be identical, so the
    alpha bbox is the tightest signal there is — match its size and centre.

    FREE silhouette (a new breed): the outline is *meant* to change, and the
    bbox is then actively wrong — grow the horns and the bbox top rises, so
    matching centres shoves the whole head down. Instead:
      1. scale from the ratio of ERODED areas (`_core`), which appendages barely
         touch;
      2. translate by maximising IoU on a window centred on the part's own
         JOINT — `childLocal` from the rig's anchor for this layer, i.e. the
         pixel the animation rotates the part around. Landing the socket is what
         rigging needs; the far end of the part is free to be a different shape.
    """
    sb, nb = alpha_bbox(src), alpha_bbox(new)
    if not nb or not sb:
        return new, {'skipped': 'empty alpha'}

    if not free:
        raw = float(np.mean([(sb[2] - sb[0]) / max(1, nb[2] - nb[0]),
                             (sb[3] - sb[1]) / max(1, nb[3] - nb[1])]))
    else:
        cs, cn = _core(src).sum(), _core(new).sum()
        raw = float(np.sqrt(cs / cn)) if cn else 1.0
    scale = float(np.clip(raw, *SCALE_CLAMP))

    scaled = new
    if abs(scale - 1.0) > DEADZONE_SCALE:
        scaled = new.resize((max(1, round(new.width * scale)),
                             max(1, round(new.height * scale))), Image.LANCZOS)

    if not free:
        nb2 = alpha_bbox(scaled) or nb
        dx = (sb[0] + sb[2]) / 2 - (nb2[0] + nb2[2]) / 2
        dy = (sb[1] + sb[3]) / 2 - (nb2[1] + nb2[3]) / 2
    else:
        # Both masks in the CANVAS frame, the new one pasted at (0,0) — the same
        # frame the final composite offset is expressed in.
        sm, nm = _core(src, canvas=canvas), _core(scaled, canvas=canvas)
        if not sm.any() or not nm.any():
            return new, {'skipped': 'core erosion emptied a mask'}
        sy, sx = np.nonzero(sm)
        ny, nx = np.nonzero(nm)
        dx, dy = float(sx.mean() - nx.mean()), float(sy.mean() - ny.mean())
        if joint:
            r = max(60, int(0.28 * max(canvas)))
            y0, y1 = max(0, joint[1] - r), min(sm.shape[0], joint[1] + r)
            x0, x1 = max(0, joint[0] - r), min(sm.shape[1], joint[0] + r)
            win = np.zeros_like(sm)
            win[y0:y1, x0:x1] = True
            sw_ = np.logical_and(sm, win)
            if sw_.any():
                best = (-1.0, int(round(dx)), int(round(dy)))
                for step, span in ((4, 32), (1, 6)):
                    bx, by = best[1], best[2]
                    for tx in range(bx - span, bx + span + 1, step):
                        for ty in range(by - span, by + span + 1, step):
                            s = _shift_iou(sw_, nm, tx, ty)
                            if s > best[0]:
                                best = (s, tx, ty)
                dx, dy = float(best[1]), float(best[2])

    out = Image.new('RGBA', canvas, (0, 0, 0, 0))
    out.alpha_composite(scaled, (int(round(dx)), int(round(dy))))
    return out, {'scale': round(raw, 4), 'applied_scale': round(scale, 4),
                 'dx': round(dx, 1), 'dy': round(dy, 1),
                 'mode': 'free' if free else 'locked',
                 'clamped': abs(raw - scale) > 1e-6}


def label(img, text, box, colour=(255, 255, 255, 255)):
    """A readable label without depending on a font file: render at whatever
    size the default font is, then upscale it."""
    try:
        font = ImageFont.load_default(size=48)
        d = ImageDraw.Draw(img)
        d.text((box[0], box[1]), text, font=font, fill=colour)
        return
    except TypeError:
        pass  # Pillow < 10.1 — no sized default font
    strip = Image.new('RGBA', (260, 16), (0, 0, 0, 0))
    ImageDraw.Draw(strip).text((2, 2), text, fill=colour)
    strip = strip.resize((strip.width * 3, strip.height * 3), Image.NEAREST)
    img.alpha_composite(strip, (int(box[0]), int(box[1])))


# --------------------------------------------------------------------------- #
# stages

def prepare(breed, stage, work):
    rig_path = find_rig(breed, stage)
    rig = load_rig(rig_path)
    sprite_dir = os.path.join(DRAGONS, f'{breed}-dragon', STAGES[stage]['sprite_dir'])
    layers = sorted(rig['layers'], key=lambda l: l['z'])
    cols, rows = STAGES[stage]['grid']
    if len(layers) > cols * rows:
        sys.exit(f'{len(layers)} layers do not fit a {cols}x{rows} grid')

    sheet = Image.new('RGBA', SHEET, KEY + (255,))
    mapped = sheet.copy()
    cw, ch = SHEET[0] / cols, SHEET[1] / rows
    pad = PAD_PCT * min(cw, ch)
    cells = []

    for i, layer in enumerate(layers):
        art = layer_image(rig, layer, sprite_dir)
        col, row = i % cols, i // cols
        inner = (cw - 2 * pad, ch - 2 * pad)
        s = min(inner[0] / art.width, inner[1] / art.height)
        w, h = max(1, round(art.width * s)), max(1, round(art.height * s))
        x = round(col * cw + (cw - w) / 2)
        y = round(row * ch + (ch - h) / 2)
        fitted = art.resize((w, h), Image.LANCZOS)
        sheet.alpha_composite(fitted, (x, y))
        mapped.alpha_composite(fitted, (x, y))
        d = ImageDraw.Draw(mapped)
        d.rectangle([col * cw + 2, row * ch + 2, (col + 1) * cw - 2, (row + 1) * ch - 2],
                    outline=(36, 27, 34, 255), width=4)
        label(mapped, f'{i + 1}. {layer["name"]}  z{layer["z"]}  {layer["file"]}',
              (col * cw + 16, row * ch + 12))
        # The JOINT this part rotates around, in its own canvas: the rig's anchor
        # for which this layer is the CHILD. That is the one pixel registration
        # must land, and the only reason a free silhouette is safe at all.
        anchor = next((a for a in rig.get('anchors', [])
                       if a.get('childLayer') == layer['name']), None)
        joint = ([round(anchor['childLocal']['x']), round(anchor['childLocal']['y'])]
                 if anchor else None)
        # How much the canvas could GROW and still be cut from this cell. A part
        # canvas is trimmed to the art that was on it (the adult parts have zero
        # alpha on their border), so a breed that grows horns or moss paints them
        # past the canvas and the crop shears them into a straight edge. The
        # paint is not lost — it is sitting in the cell's own margin — so record
        # how far the crop may reach, and `slice` recovers it onto a bigger
        # canvas with a compensating rig edit. Free mode only; a skin's outline
        # is locked, so it has nothing to recover.
        # NB: not `pad` — that name is the CELL margin this loop reads every
        # iteration, and shadowing it made each part lay out bigger than the last.
        grow = min(PAD_MAX, int(min((cw - w) / 2, (ch - h) / 2) / max(s, 1e-6)))
        cells.append({
            'index': i, 'name': layer['name'], 'file': layer['file'], 'z': layer['z'],
            'canvas': [art.width, art.height], 'pad': max(0, grow),
            'src_bbox': alpha_bbox(art), 'joint': joint,
            # fractions of the sheet — the model returns its own resolution
            'frac': [x / SHEET[0], y / SHEET[1], w / SHEET[0], h / SHEET[1]],
        })

    # Geometry invariant: two parts with the same canvas MUST land at the same
    # placed size, and no placed rect may leave its cell. A one-line variable
    # shadowing bug (the per-cell `grow` overwriting the cell margin) silently
    # grew each part in the row — 881px to 1016px across eight cells — and the
    # sheet still looked plausible. Cheap assert, caught instantly next time.
    by_canvas = {}
    for c, layer in zip(cells, layers):
        by_canvas.setdefault(tuple(c['canvas']), set()).add(tuple(c['frac'][2:]))
        col, row = c['index'] % cols, c['index'] // cols
        fx, fy, fw, fh = c['frac']
        assert fx * SHEET[0] >= col * cw - 1 and (fx + fw) * SHEET[0] <= (col + 1) * cw + 1, \
            f'{layer["name"]}: placed rect leaves its cell'
    for canvas_size, placed in by_canvas.items():
        assert len(placed) == 1, \
            f'canvas {canvas_size} laid out at {len(placed)} different sizes: {placed}'

    os.makedirs(work, exist_ok=True)
    sheet_path = os.path.join(work, f'{stage}-parts.png')
    sheet.convert('RGB').save(sheet_path)
    mapped.convert('RGB').save(os.path.join(work, f'{stage}-parts-map.png'))
    manifest = {'source_breed': breed, 'stage': stage, 'rig': os.path.relpath(rig_path, ROOT),
                'sprite_dir': os.path.relpath(sprite_dir, ROOT), 'grid': [cols, rows],
                'sheet': list(SHEET), 'cells': cells}
    with open(os.path.join(work, f'{stage}-parts.json'), 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, indent=2)
    print(f'[prepare] {stage}: {len(cells)} parts on a {cols}x{rows} sheet -> {sheet_path}')
    return manifest


def compose_prompt(brief, manifest, work):
    stage = manifest['stage']
    cols, rows = manifest['grid']
    cell_lines = '\n'.join(
        f'  cell {c["index"] + 1} ({"top" if c["index"] // cols == 0 else "bottom"} row, '
        f'column {c["index"] % cols + 1}) — {PART_ENGLISH.get(c["name"], c["name"])}'
        for c in manifest['cells'])
    extra = brief.get(stage, '')
    # `personality_young` / `personality_adult` beat `personality`: a hothead
    # adult bares its fangs, a hothead hatchling sulks, and one line of text
    # cannot be both.
    persona = brief.get(f'personality_{stage}') or brief.get('personality')
    free = is_free(brief)
    kind = 'SKIN of the dragon in the sheet' if not free else 'different dragon breed'
    parts = [
        f'Image 1 is a PARTS SHEET for a rigged 2D game dragon: a {cols} x {rows} grid of '
        f'cells on one flat magenta field, holding {len(manifest["cells"])} separated body '
        f'parts, one per cell. It is not a picture of a dragon — it is the animal taken '
        f'apart, and every piece has to keep its own cell.',
        '',
        f'Repaint this exact sheet as a {kind}: {brief["name"]} — {brief["concept"]}',
        '',
        'THE CELLS, left to right, top to bottom:',
        cell_lines,
        '',
        'THE CONTRACT — this is the whole job, and it outranks everything below:',
        f'  - Return the SAME sheet: {cols} columns x {rows} rows, the same part in the same '
        'cell, in the same order.',
        ('  - Every part keeps its position inside its cell, its size, its pose and its '
         'orientation. Its skeleton — skull, neck, limb bones, wing bones, tail centreline — '
         'stays exactly where it is; only the free edges named under SILHOUETTE may change.'
         if free else
         '  - Every part keeps its position inside its cell, its size, its pose, its '
         'orientation and its outline. Laid over the original, each part must cover it — '
         'same silhouette, same edges, same angle.'),
        '  - Paint ONLY the separated part in each cell. Never assemble the dragon, never '
        'draw a whole dragon anywhere, never add a part, never leave a cell empty, never '
        'swap two cells.',
        '  - Nothing grows outside its own cell and nothing touches a neighbouring part.',
        '',
        'WHAT CHANGES:',
        f'  - Scales and skin: {brief["scales"]}' if brief.get('scales') else None,
        f'  - Wings: {brief["wings"]}' if brief.get('wings') else None,
        f'  - Head, horns and eye: {brief["head"]}' if brief.get('head') else None,
        f'  - Limbs, claws and tail: {brief["limbs"]}' if brief.get('limbs') else None,
        f'  - {extra}' if extra else None,
        '',
        (SILHOUETTE_FREE.format(want=brief['silhouette']) if free else SILHOUETTE_LOCKED),
        '',
        (PERSONALITY_BLOCK.format(who=persona) if persona else None),
        '' if persona else None,
        'WHAT NEVER CHANGES — the anatomy this rig is built on. This is a LEGGED dragon: '
        'one head, one body with a tail, two wings, two ARMS ending in hands, and two LEGS '
        'ending in clawed feet. Every one of those parts exists in the new breed, in its own '
        'cell, with the same joint at the same place. Never a wyvern, never a serpent, never '
        'a legless or two-limbed form, never an extra limb.',
        STAGE_ANATOMY[stage],
        '',
        PERSPECTIVE_BLOCK,
        '',
        f'PALETTE — {brief["palette"]}',
        (f'AVOID — {brief["avoid"]}' if brief.get('avoid') else None),
        '',
        STYLE_BLOCK,
        '',
        EDGES_BLOCK,
        '',
        BG_BLOCK,
    ]
    # Blank strings are deliberate paragraph breaks; only the conditional
    # blocks drop out (they are None when the brief leaves them out).
    text = '\n'.join(p for p in parts if p is not None)
    path = os.path.join(work, f'{stage}-prompt.txt')
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(text + '\n')
    print(f'[prompt]  {stage}: {len(text)} chars -> {path}')
    return text


def generate(stage, work, job, dry):
    sheet = os.path.join(work, f'{stage}-parts.png')
    prompt = open(os.path.join(work, f'{stage}-prompt.txt'), encoding='utf-8').read()
    out = os.path.join(work, f'{stage}-generated.png')
    cmd = [sys.executable, ARTGEN, job, prompt, '-i', sheet, '-o', out]
    if dry:
        print(f'[generate] DRY RUN — would call artgen {job} with {sheet}')
        return out
    print(f'[generate] {stage}: artgen {job} …')
    subprocess.run(cmd, check=True, cwd=ROOT)
    return out


def out_dirs(brief, manifest):
    """Where this brief's output lives — a BREED gets its own folder, a SKIN
    lands inside the breed it re-skins (golden's `sprite-sunset` convention)."""
    stage, slug, src_breed = manifest['stage'], brief['id'], manifest['source_breed']
    st = STAGES[stage]
    if is_free(brief):
        breed_dir = os.path.join(DRAGONS, f'{slug}-dragon')
        return {
            'breed_dir': breed_dir,
            'sprite': os.path.join(breed_dir, st['sprite_dir']),
            'rig': os.path.join(breed_dir, st['rig_dir']),
            'character': f'dragon-{slug}{st["suffix"]}',
            'rig_name': (f'dragon-{slug}.rig.json' if stage == 'young'
                         else f'{slug}-dragon.rig.json'),
            'baked': f'{slug}-dragon{"-adult" if stage == "adult" else ""}-baked',
        }
    breed_dir = os.path.join(DRAGONS, f'{src_breed}-dragon')
    return {
        'breed_dir': breed_dir,
        'sprite': os.path.join(breed_dir, f'{st["sprite_dir"]}-{slug}'),
        'rig': os.path.join(breed_dir, f'{st["rig_dir"]}-{slug}'),
        'character': f'dragon-{src_breed}-{slug}{st["suffix"]}',
        'rig_name': (f'dragon-{src_breed}-{slug}.rig.json' if stage == 'young'
                     else f'{src_breed}-dragon-{slug}.rig.json'),
        # A skin keeps the base part names, so it keeps the base baked name too.
        'baked': f'{src_breed}-dragon{"-adult" if stage == "adult" else ""}-baked',
    }


def outline(brief, manifest, out_root):
    """Draw the dark keyline around every part — EXCEPT at its joints.

    An outline is what makes the painterly art read at board size, but a rig is
    assembled from overlapping parts, so a keyline drawn all the way around each
    one puts a dark seam across the finished animal wherever two parts meet: a
    collar at the base of the neck, a ring at each shoulder, a bar where the
    wing plugs into the back.

    The rig already knows where those places are and we do not have to guess:
    every anchor stores `childLocal` — the socket pixel in the CHILD's own canvas
    (the neck stump on the head, the shoulder on an arm or wing, the hip on a
    leg) — and `parentLocal`, the same point on the body it plugs into. So:

      - inside a disc around each of those points the outline fades out, and the
        part's alpha is trimmed a few pixels to take off any keyline the model
        painted there;
      - everywhere else the rim is darkened toward the outline colour with a
        soft falloff, which is the look the shipped art already has.

    Width and strength are in canvas pixels and the two stages are drawn at
    comparable scale, so one setting covers both. NOT idempotent — it darkens
    what it is given, so re-run it from a fresh `slice`, never on its own output.
    """
    d = out_dirs(brief, manifest)
    rig_path = os.path.join(d['rig'], d['rig_name'])
    if not os.path.exists(rig_path):
        sys.exit(f'nothing to outline — run slice first ({rig_path} missing)')
    rig = load_rig(rig_path)
    ink = np.array(OUTLINE_RGB, dtype=np.float32)

    # Every joint that lands on this layer, from both sides of every anchor.
    joints = {l['name']: [] for l in rig['layers']}
    for a in rig.get('anchors', []):
        if a.get('childLayer') in joints and a.get('childLocal'):
            joints[a['childLayer']].append((a['childLocal']['x'], a['childLocal']['y']))
        if a.get('parentLayer') in joints and a.get('parentLocal'):
            joints[a['parentLayer']].append((a['parentLocal']['x'], a['parentLocal']['y']))

    images, report = {}, []
    for layer in rig['layers']:
        img = layer_image(rig, layer, d['sprite'])
        arr = np.array(img, dtype=np.float32)
        alpha = arr[..., 3]
        solid = alpha > 128
        if not solid.any():
            continue

        # How far inside the part's own silhouette each pixel is.
        depth = ndimage.distance_transform_edt(solid)
        # How far it is from the nearest joint on this part.
        jmask = np.ones_like(solid)
        for jx, jy in joints[layer['name']]:
            if 0 <= jy < jmask.shape[0] and 0 <= jx < jmask.shape[1]:
                jmask[int(jy), int(jx)] = 0
        jdist = (ndimage.distance_transform_edt(jmask) if (jmask == 0).any()
                 else np.full(solid.shape, np.inf))

        # 0 at the joint, 1 once clear of it — the outline's licence to exist.
        free = np.clip((jdist - JOINT_R) / max(1.0, JOINT_FEATHER), 0.0, 1.0)

        # Trim the painted keyline off the socket itself, feathered so the cut
        # never shows as a hard step.
        trim = np.clip((depth - JOINT_TRIM) / max(1.0, JOINT_TRIM), 0.0, 1.0)
        alpha = np.where(free < 1.0, alpha * (trim + (1.0 - trim) * free), alpha)

        # The keyline: strongest at the rim, gone by OUTLINE_W px inside.
        edge = np.clip(1.0 - (depth - 1.0) / OUTLINE_W, 0.0, 1.0) ** 1.3
        strength = (edge * OUTLINE_STRENGTH * free)[..., None]
        arr[..., :3] = arr[..., :3] * (1.0 - strength) + ink * strength
        arr[..., 3] = alpha
        out = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')
        out.save(os.path.join(d['sprite'], layer['file']), 'PNG')

        buf = io.BytesIO()
        out.save(buf, 'PNG')
        images[layer['file']] = ('data:image/png;base64,'
                                 + base64.b64encode(buf.getvalue()).decode())
        report.append(f'{layer["name"]}({len(joints[layer["name"]])}j)')

    rig['images'] = images
    with open(rig_path, 'w', encoding='utf-8') as fh:
        json.dump(rig, fh, indent=2)
    print(f'[outline] {manifest["stage"]}: keyline {OUTLINE_W}px, joints spared '
          f'r={JOINT_R} — {" ".join(report)}')


def bake(brief, manifest, out_root):
    """Flatten the rest pose into the ONE texture the board draws.

    `RigPlayer.bake()` does this at runtime for featured instances, but a merge
    item is a plain pooled sprite: `item_ember_dragon_3/4` and `item_emerald_3/4`
    are baked composites on disk. So a dragon skin is invisible on the board
    until its composite exists. Compositing the rig's own layer offsets
    reproduces the shipped bakes byte for byte (alpha IoU 1.0000, mean RGB diff
    0.00 against red young/adult and emerald young) — this is the same picture,
    not a lookalike."""
    d = out_dirs(brief, manifest)
    rig_path = os.path.join(d['rig'], d['rig_name'])
    if not os.path.exists(rig_path):
        sys.exit(f'nothing to bake — run slice first ({rig_path} missing)')
    rig = load_rig(rig_path)
    parts = {l['name']: layer_image(rig, l, d['sprite']) for l in rig['layers']}
    b = rig['bounds']
    canvas = Image.new('RGBA', (b['width'], b['height']), (0, 0, 0, 0))
    for layer in sorted(rig['layers'], key=lambda l: l['z']):
        canvas.alpha_composite(parts[layer['name']], (layer['x'] - b['x'], layer['y'] - b['y']))
    png = os.path.join(d['sprite'], f'{d["baked"]}.png')
    canvas.save(png, 'PNG')
    canvas.save(os.path.join(d['sprite'], f'{d["baked"]}.webp'), 'WEBP', quality=92, method=6)
    print(f'[bake]    {manifest["stage"]}: {canvas.width}x{canvas.height} -> '
          f'{os.path.relpath(png, ROOT)}')


def slice_sheet(brief, manifest, work, out_root):
    stage = manifest['stage']
    gen_path = os.path.join(work, f'{stage}-generated.png')
    gen = Image.open(gen_path).convert('RGBA')
    key = measure_key(gen)
    slug, src_breed = brief['id'], manifest['source_breed']
    free = is_free(brief)
    st = STAGES[stage]
    d = out_dirs(brief, manifest)
    breed_dir, sprite_out, rig_out = d['breed_dir'], d['sprite'], d['rig']
    character, rig_name = d['character'], d['rig_name']
    os.makedirs(sprite_out, exist_ok=True)
    os.makedirs(rig_out, exist_ok=True)

    src_rig = load_rig(os.path.join(ROOT, manifest['rig']))
    src_sprite_dir = os.path.join(ROOT, manifest['sprite_dir'])
    rig = json.loads(json.dumps(src_rig))
    rig['character'] = character
    images, report, parts = {}, [], {}
    by_name = {c['name']: c for c in manifest['cells']}
    src_by_name = {l['name']: l for l in src_rig['layers']}

    pads = {}
    for layer in rig['layers']:
        cell = by_name[layer['name']]
        fx, fy, fw, fh = cell['frac']
        # Free mode reaches PAST the placed rect into the cell's margin, to pick
        # up whatever was painted outside the original outline; the canvas grows
        # to match and pad_rig moves the rig's own numbers with it.
        pad = cell.get('pad', 0) if free else 0
        pads[layer['name']] = pad
        cw0, ch0 = cell['canvas']
        s = (fw * gen.width) / cw0                      # sheet px per canvas px
        box = (round((fx * gen.width) - pad * s), round((fy * gen.height) - pad * s),
               round(((fx + fw) * gen.width) + pad * s),
               round(((fy + fh) * gen.height) + pad * s))
        canvas = (cw0 + 2 * pad, ch0 + 2 * pad)
        cut = dekey(gen.crop(box).resize(canvas, Image.LANCZOS), key)
        cut, islands = drop_islands(cut)
        src_art = layer_image(src_rig, src_by_name[layer['name']], src_sprite_dir)
        if pad:
            framed = Image.new('RGBA', canvas, (0, 0, 0, 0))
            framed.alpha_composite(src_art, (pad, pad))
            src_art = framed
        joint = cell.get('joint')
        placed, info = register(cut, src_art, canvas,
                                [joint[0] + pad, joint[1] + pad] if joint else None, free)

        new_file = cell['file'] if not free else cell['file'].replace(
            f'{src_breed}-dragon-', f'{slug}-dragon-')
        if free and new_file == cell['file']:
            new_file = f'{slug}-dragon-{cell["file"]}'
        placed.save(os.path.join(sprite_out, new_file), 'PNG')
        layer['file'] = new_file
        parts[layer['name']] = placed
        buf = io.BytesIO()
        placed.save(buf, 'PNG')
        images[new_file] = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()
        # Two checks that only exist because the first run needed them done by
        # hand: how much of the source the part still covers, and whether it is
        # running off its own canvas (a clipped part reads as a straight cut
        # across the finished dragon, and means `pad` did not reach far enough).
        edge = np.array(placed.getchannel('A')) > 40
        info.update({
            'part': layer['name'], 'file': new_file, 'pad': pad,
            'fit': fit_score(placed, src_art, free),
            'border_px': int(np.concatenate([edge[0, :], edge[-1, :],
                                             edge[:, 0], edge[:, -1]]).sum()),
            'islands': islands or None,
        })
        report.append(info)

    if any(pads.values()):
        pad_rig(rig, pads)
    # RigPlayer.preload reads rig.images[layer.file] — a rig carrying the old
    # breed's base64 draws the old breed however good the PNGs on disk are.
    rig['images'] = images
    with open(os.path.join(rig_out, rig_name), 'w', encoding='utf-8') as fh:
        json.dump(rig, fh, indent=2)

    assemble(rig, parts, os.path.join(work, f'{stage}-assembled.png'))
    with open(os.path.join(work, f'{stage}-registration.json'), 'w', encoding='utf-8') as fh:
        json.dump({'key': [round(v) for v in key], 'parts': report}, fh, indent=2)
    print(f'[slice]   {stage}: key #{"".join(f"{round(v):02X}" for v in key)} -> {sprite_out}')
    floor = FIT_FLOOR['free' if free else 'locked']
    for r in report:
        # Flag on what is actually wrong. A big dx in free mode is the estimator
        # doing its job around a new crest; a low fit, a clamped scale or a part
        # touching its own border are the three things that are never fine.
        why = []
        if r.get('fit', 1) < floor:
            why.append(f'fit {r.get("fit")}<{floor}')
        if r.get('clamped'):
            why.append(f'scale {r.get("scale")} CLAMPED')
        if r.get('border_px', 0) > 8:
            why.append(f'clipped {r["border_px"]}px')
        isl = r.get('islands') or {}
        # Dropping a speck or two is routine; flag only a messy cell or a real
        # chunk left floating. Storm's detached arcs are art, not an error.
        if isl.get('dropped', 0) > 3 or any(f >= 0.02 for f in isl.get('detached', [])):
            why.append(f'islands {isl}')
        print(f'           {r["part"]:<12} fit {r.get("fit")}  scale {r.get("scale")}  '
              f'dx {r.get("dx")}  dy {r.get("dy")}'
              + (f'   <-- {"; ".join(why)}' if why else ''))
    return breed_dir


def pad_rig(rig, pads):
    """Grow each layer's canvas by `pads[name]` on every side, and move every
    number that was measured in that canvas so the result renders identically.

    A canvas is not just a picture size — the rig stores, in that same space,
    the pivot a part rotates around (`anchors[].childLocal`, plus
    `childOriginNorm` which is that point over the texture size and is what
    Phaser's setOrigin gets), where the child attaches on the PARENT
    (`parentLocal`), and every deform pin along the tail (`pins[].local` /
    `.norm`). Shift the art by +pad and leave those behind and the head starts
    rotating around a point inside its own jaw.

    `layer.x` moves by -pad, each local point by +pad, so rig-space coordinates
    (`anchors[].rig`, `pins[].rig`) come out unchanged — which is the proof this
    is a no-op for everything except the extra pixels now inside the frame.
    """
    size = {}
    for layer in rig['layers']:
        p = pads.get(layer['name'], 0)
        if p:
            layer['x'] -= p
            layer['y'] -= p
            layer['width'] += 2 * p
            layer['height'] += 2 * p
        size[layer['name']] = (layer['width'], layer['height'])

    for a in rig.get('anchors', []):
        pc = pads.get(a.get('childLayer'), 0)
        if pc and a.get('childLocal'):
            a['childLocal']['x'] += pc
            a['childLocal']['y'] += pc
            if a.get('childOriginNorm'):
                w, h = size[a['childLayer']]
                a['childOriginNorm']['x'] = round(a['childLocal']['x'] / w, 4)
                a['childOriginNorm']['y'] = round(a['childLocal']['y'] / h, 4)
        pp = pads.get(a.get('parentLayer'), 0)
        if pp and a.get('parentLocal'):
            a['parentLocal']['x'] += pp
            a['parentLocal']['y'] += pp

    for pin in rig.get('pins', []):
        p = pads.get(pin.get('layer'), 0)
        if p and pin.get('local'):
            pin['local']['x'] += p
            pin['local']['y'] += p
            if pin.get('norm'):
                w, h = size[pin['layer']]
                pin['norm']['x'] = round(pin['local']['x'] / w, 4)
                pin['norm']['y'] = round(pin['local']['y'] / h, 4)

    # `bounds` is the union of the layer rects (verified against every shipped
    # rig), and every layer grew symmetrically, so the centre does not move.
    xs0 = min(l['x'] for l in rig['layers'])
    ys0 = min(l['y'] for l in rig['layers'])
    xs1 = max(l['x'] + l['width'] for l in rig['layers'])
    ys1 = max(l['y'] + l['height'] for l in rig['layers'])
    rig['bounds'] = {'x': xs0, 'y': ys0, 'width': xs1 - xs0, 'height': ys1 - ys0}


def assemble(rig, parts, out_path):
    """Composite the new parts through the RIG's own layer offsets — the rest
    pose, exactly as RigPlayer would build it. This is the check that matters:
    a part that came back the wrong size or off-centre shows up here as a limb
    that no longer meets the body, which no amount of looking at the sheet
    would have told you."""
    b = rig['bounds']
    canvas = Image.new('RGBA', (b['width'], b['height']), (0, 0, 0, 0))
    for layer in sorted(rig['layers'], key=lambda l: l['z']):
        art = parts[layer['name']]
        canvas.alpha_composite(art, (layer['x'] - b['x'], layer['y'] - b['y']))
    plate = Image.new('RGBA', canvas.size, (58, 43, 56, 255))
    plate.alpha_composite(canvas)
    plate.convert('RGB').save(out_path)


def write_readme(brief, breed_dir, stages, source):
    slug = brief['id']
    skin = not is_free(brief)
    lines = [
        f'{brief["name"]} — rig-ready parts ({", ".join(stages)})',
        '',
        (f'A SKIN of the {source} dragon: it lives in this breed\'s folder as '
         f'sprite-{slug}/ and rig-{slug}/ (plus the -adult pair), keeps the base part\n'
         'file names, and differs only by folder, `character` and pixels — the same '
         'shape golden\'s sprite-sunset already has.' if skin else
         f'A new BREED off the {source} rig.'),
        '',
        f'Generated by .claude/skills/nano-banana/scripts/dragonbreed.py from the',
        f'{source}-dragon rig. Every part is on its SOURCE canvas at its source size and',
        'position, so these drop onto that rig unchanged: same layer names, same z order,',
        'same bounds, same anchors, same pins.',
        '',
        'Each rig.json here is the source rig with `file` repointed, `character` renamed',
        'and `images` re-embedded from these PNGs — RigPlayer.preload loads textures from',
        '`rig.images[layer.file]`, so the JSON is what actually renders, not the folder.',
        '',
        'NOT DONE HERE (deliberately — this pipeline stops at rig-ready):',
        '  - nothing is registered in src/data/assets.json or chains.json',
        '  - no baked board composite (scripts/bake-dragon.mjs is hard-wired to red)',
        '  - no head-animation blink/talk banks (see docs/character-pipeline.md)',
        '',
        'To eyeball or adjust: open tools/rigger/index.html and load the rig.json.',
    ]
    # A skin shares the base breed's folder, so it must not claim its README.
    name = 'README.txt' if not skin else f'README-{slug}.txt'
    with open(os.path.join(breed_dir, name), 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines) + '\n')


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('brief')
    ap.add_argument('--from', dest='source', default='red', help='source breed (default red)')
    ap.add_argument('--stage', default='both', choices=['young', 'adult', 'both'])
    ap.add_argument('--only', default=None,
                    help='steps: prepare,prompt,generate,slice,outline,bake')
    ap.add_argument('--job', default='sheet-pro', help='artgen job (default sheet-pro)')
    ap.add_argument('--work', default=None, help='workspace (default assets/raw/dragons/<id>)')
    ap.add_argument('--out-root', default=DRAGONS)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    with open(args.brief, encoding='utf-8') as fh:
        brief = json.load(fh)
    for req in ('id', 'name', 'concept', 'palette'):
        if not brief.get(req):
            sys.exit(f'brief is missing "{req}"')
    # A breed MUST say what its outline is, or it comes back as a recolour of
    # the source — the exact failure the shop's first house-skin set had.
    if is_free(brief) and not brief.get('silhouette'):
        sys.exit('brief is a BREED (no "skin_of") so it must declare "silhouette" — '
                 'what its outline reads as. Add "skin_of": "<breed>" for a skin.')
    source = brief.get('skin_of') or args.source
    work = args.work or os.path.join(ROOT, 'assets/raw/dragons', brief['id'])
    os.makedirs(work, exist_ok=True)
    if os.path.abspath(args.brief) != os.path.abspath(os.path.join(work, 'brief.json')):
        shutil.copyfile(args.brief, os.path.join(work, 'brief.json'))
    stages = ['young', 'adult'] if args.stage == 'both' else [args.stage]
    ALL = ['prepare', 'prompt', 'generate', 'slice', 'outline', 'bake']
    steps = [x.strip() for x in args.only.split(',')] if args.only else ALL
    bad = [x for x in steps if x not in ALL]
    if bad:
        sys.exit(f'unknown step(s) {bad}; pick from {ALL}')

    breed_dir = None
    for stage in stages:
        mpath = os.path.join(work, f'{stage}-parts.json')
        manifest = None
        if 'prepare' in steps:
            manifest = prepare(source, stage, work)
        elif os.path.exists(mpath):
            manifest = load_rig(mpath)
        if 'prompt' in steps:
            compose_prompt(brief, manifest, work)
        if 'generate' in steps:
            generate(stage, work, args.job, args.dry_run)
        if 'slice' in steps and not args.dry_run:
            breed_dir = slice_sheet(brief, manifest, work, args.out_root)
        if 'outline' in steps and not args.dry_run:
            outline(brief, manifest, args.out_root)
        if 'bake' in steps and not args.dry_run:
            bake(brief, manifest, args.out_root)
    if breed_dir:
        write_readme(brief, breed_dir, stages, source)
        print(f'[done]    rig-ready: {os.path.relpath(breed_dir, ROOT)}')


if __name__ == '__main__':
    main()
