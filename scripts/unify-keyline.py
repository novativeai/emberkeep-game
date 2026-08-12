#!/usr/bin/env python3
"""
Unify the dark keyline around merge-item art — ADDING only what each piece lacks.

    python3 scripts/unify-keyline.py --list                  # measure everything, change nothing
    python3 scripts/unify-keyline.py --dry-run KEY [KEY...]  # what it would add
    python3 scripts/unify-keyline.py --sheet out.png KEY...  # before/after contact sheet
    python3 scripts/unify-keyline.py --apply KEY [KEY...]    # rewrite the art in place

WHAT "UNIFIED" MEANS HERE, AND WHY IT IS NOT A PIXEL COUNT

The board's art arrives at wildly different resolutions — a 190px moss clump and a
1440px egg both end up ~90 units wide on screen, because ITEM_SCALE divides the
difference. So a keyline authored as "6 source pixels" is four times heavier on the
moss than on the egg. The only thickness the player can actually see is the one
measured AFTER ITEM_SCALE, in the hi-res game space the canvas renders at (RES 2,
2560x1600). Every number in this script is therefore quoted in those ON-BOARD UNITS,
and converted to source pixels per file at the last moment:

    target_px = target_units / item_scale

THE TARGET CURVE. Calibrated on `emberberry_1`, the piece whose native keyline is
the art direction: 9.6 source px on a 318px silhouette at ITEM_SCALE 0.21, i.e.
2.0 on-board units at an on-board size of 67 units. A bigger piece gets a heavier
line, but sub-linearly — a linear rule would hang a 10-unit black band off the
Manor, four times what the good big art (keel_4, 347 units, 2.0 units of line)
actually carries:

    target_units(size) = REF_UNITS * (size / REF_SIZE) ** EXPONENT

EXPONENT 0 would be a constant line at every size (very nearly what the shipped good
art measures, because most of it lands in a narrow 60-160 unit band and keel_4 carries
only ~2 units at 347); 1 would be a constant PERCENTAGE. 0.25 was chosen on review as
the setting that grows the line on the landmarks while staying close to the weight the
existing good art already has: over the real 43 -> 338 unit range it moves from 1.80 to
3.02 units. Pass --exponent to retune; every number below follows from it.

THE ADDITION IS RELATIVE TO WHAT IS ALREADY THERE, PER BOUNDARY POINT. A piece
whose keyline is already right gets nothing; one with a line on three sides and
none on the fourth gets the ring only where it is missing. The native thickness is
read as a distance field (`native_map`) rather than an average, so the added ring
tapers smoothly into the existing ink instead of stepping.

INK COLOUR. The ring is painted in the piece's OWN ink, not in black: the shipped
keylines are tinted (emberberry 24,18,18 / nightbloom 48,10,40 / resin 55,32,6).
Where a native keyline exists its median colour is reused exactly; where there is
none the edge paint is dropped to keyline luminance, so an icy piece gets a cold
line and a fiery one a warm line.

GEOMETRY. The ring is grown OUTWARD and the canvas padded symmetrically to hold it,
so no painted detail is ever eaten and the fractional anchors in anchors.json still
land on the same content. The silhouette grows by twice the added width, which at
these widths is 1-3% of the piece — under the noise floor of the on-board sizes
tuned in Constants.ts, so ITEM_SCALE is deliberately left alone.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent

# --- the target curve -------------------------------------------------------
REF_SIZE = 66.8   # emberberry_1: 318px silhouette * ITEM_SCALE 0.21
REF_UNITS = 2.0   # ...carrying a 9.6px native keyline
EXPONENT = 0.25

# Below this luminance contrast between the silhouette edge and the paint behind
# it, a piece has no keyline to extend and the ring is built from scratch.
MIN_CONTRAST = 0.14
# Keyline luminance to drop the edge paint to when deriving ink for a piece that
# has none. The shipped keylines sit at V 0.09-0.22; 0.13 is their middle.
INK_V = 0.11
# Two different decisions, so two ceilings.
#
# MARCH_V bounds what may be CREDITED as an existing line. Without an absolute
# ceiling, merely-darker-than-the-body shading counts: the House's shadowed roof
# edges scored a 2.9-unit keyline it visibly does not have. 0.30 is set just above
# the darkest real lines in the shipped art (keel_4 and resin sit at 0.27-0.29) so
# those are still credited rather than double-outlined.
MARCH_V = 0.30
# INK_MAX_V bounds what may be REUSED as a colour, and is strict where MARCH_V is
# generous: over-crediting only means adding less, but painting a ring in a pale
# "ink" is a visible defect — keel_1's violet shadow at 0.29 drew a ring that read
# as a coloured bloom around a pale blue plank. Above this, ink is derived instead.
INK_MAX_V = 0.22
# Pull every ink a little toward its own grey. A fully saturated dark tint reads as
# a glow rather than a line; the reference ink (25,19,19) is nearly neutral.
INK_DESAT = 0.25

ALPHA_T = 0.5     # every piece here has a hard silhouette with a 1-3px AA fringe

# How much of an enclosed gap the ring must leave open (see gap_cap): at least
# GAP_MIN_CORE pixels, and at least GAP_KEEP of the gap's own radius.
GAP_MIN_CORE = 1.25
GAP_KEEP = 0.25


# --- the asset registry -----------------------------------------------------
def constants_dict(name: str) -> dict[str, float]:
    src = (ROOT / 'src/core/Constants.ts').read_text()
    body = src.split(f'export const {name}: Record<string, number> = {{')[1].split('\n};')[0]
    return {m.group(1): float(m.group(2))
            for m in re.finditer(r'^\s*([a-z_0-9]+):\s*([0-9.]+)', body, re.M)}


# Art the runtime scales outside assets.json/ITEM_SCALE. `icon_key_bronze` is
# placed at setScale(1.2) in BoardScene; the three loose files are legacy item
# paintings nothing references any more, quoted at the ~90-unit size their
# siblings render at so the line matches if they are ever wired back up.
EXTRA_SCALES = {
    'sprites/items/key-icon.webp': ('key_icon', 1.2),
    'sprites/items/stone.webp': ('stone', 0.216),
    'sprites/items/wood.webp': ('wood', 0.33),
    'sprites/items/black-egg.webp': ('black_egg', 0.064),
}


# When one file serves several on-board sizes the largest use wins by default,
# which is wrong where the largest use is not the one the player actually sees.
# `red-dragon-baked.webp` is both `decor_dragon` (0.42 -> 334 units) and
# `item_ember_dragon_3` (0.21 -> 167), and NO decor dragon is placed in any map —
# so tuning for the decor would have put a 1.50-unit line on the whelp the player
# looks at all game, and made it disagree with the emerald whelp beside it, whose
# file has no decor sibling and so tunes at 167 on its own.
TUNE_FOR = {
    'sprites/characters/dragon/red-dragon/sprite/red-dragon-baked.webp': 'ember_dragon_3'
}


def registry() -> dict[str, dict]:
    """key -> {path, scale, shared}. A file reused at several scales (bigtree is a
    Fir Tree, a Firepine and a landmark) is outlined ONCE, for its largest use
    unless TUNE_FOR names the use to follow instead."""
    item, decor = constants_dict('ITEM_SCALE'), constants_dict('DECOR_SCALE')
    assets = json.loads((ROOT / 'src/data/assets.json').read_text())
    by_file: dict[str, list[tuple[str, float]]] = {}
    for im in assets['images']:
        f = im.get('file') or ''
        k = im['key']
        # Keyed on what the piece IS, not on where its art sits. Filtering by
        # `sprites/items` missed the Dragon Ruby (sprites/merge/), the curled
        # sleep paintings and the baked dragon sheets a companion is drawn from
        # (both sprites/characters/) — all of them board pieces with an
        # ITEM_SCALE, all of them wanting the same keyline as their neighbours.
        if not f or '/skins/' in f:
            continue
        if k.startswith('item_'):
            rest = k[5:]
            sc = item.get(rest) or item.get(rest.rsplit('_', 1)[0])
        elif k.startswith('sleep_'):
            rest, sc = k, item.get(k)   # ITEM_SCALE keys these by their full name
        elif k.startswith('decor_'):
            rest, sc = k[6:], decor.get(k[6:])
        else:
            continue
        if sc:
            by_file.setdefault(f, []).append((rest, sc))
    for f, (k, sc) in EXTRA_SCALES.items():
        by_file.setdefault(f, []).append((k, sc))

    out: dict[str, dict] = {}
    for f, uses in by_file.items():
        uses.sort(key=lambda u: -u[1])
        want = TUNE_FOR.get(f)
        if want:
            uses.sort(key=lambda u: (u[0] != want, -u[1]))
        primary, scale = uses[0]
        entry = {'path': ROOT / 'assets' / f, 'file': f, 'scale': scale,
                 'primary': primary, 'shared': [u[0] for u in uses[1:]]}
        for k, _ in uses:
            out[k] = entry          # every alias resolves to the same one job
    return out


# --- measurement ------------------------------------------------------------
def load(path: Path):
    a = np.array(Image.open(path).convert('RGBA'))
    al = a[..., 3].astype(np.float32) / 255.0
    v = a[..., :3].astype(np.float32).max(axis=2) / 255.0
    solid = al > ALPHA_T
    return a, al, v, solid


def edge_profile(v, solid, d_in, bbmax):
    """Mean luminance per one-pixel ring inward from the silhouette edge."""
    prof = []
    for k in range(1, 64):
        band = solid & (d_in >= k) & (d_in < k + 1)
        if int(band.sum()) < 24:
            break
        prof.append(float(v[band].mean()))
    return np.array(prof)


def ink_threshold(prof, bbmax):
    """(threshold, contrast). The luminance below which a pixel counts as keyline
    ink, taken as the half-rise of the piece's own inward profile — absolute
    thresholds mistake a dark-bodied piece for one giant outline and a pale piece
    with a mid-tone line for one with none."""
    if len(prof) < 4:
        return 0.0, 0.0
    v_edge = float(prof[:2].min())
    hi = min(len(prof), max(6, int(round(0.10 * bbmax))))
    win = prof[2:hi]
    if len(win) == 0:
        return 0.0, 0.0
    contrast = float(np.percentile(win, 85)) - v_edge
    if contrast < MIN_CONTRAST:
        return 0.0, contrast
    return min(v_edge + 0.55 * contrast, 0.55), contrast


def native_by_normal(v, solid, d_in, bnd, thr, cap):
    """Local keyline thickness at every boundary pixel, by marching INWARD along the
    silhouette normal and counting how far the ink runs before the paint starts.

    Measuring instead as "distance to the nearest non-ink pixel" reads any dark
    interior as keyline — the coin pouch's shadowed folds scored a 35px line it
    plainly does not have. A keyline is specifically ink you cross on the way IN,
    so that is what gets walked. The march also stops where it leaves the
    silhouette, so a thin dark twig reads as fully inked rather than infinitely so.
    """
    if thr <= 0 or not bnd.any():
        return np.zeros(solid.shape, np.float32)
    # Inward normals from the distance transform's gradient (d_in rises inward).
    gy, gx = np.gradient(ndimage.gaussian_filter(d_in.astype(np.float32), 1.5))
    n = np.hypot(gx, gy)
    with np.errstate(invalid='ignore', divide='ignore'):
        gx, gy = np.where(n > 1e-6, gx / n, 0.0), np.where(n > 1e-6, gy / n, 0.0)

    ys, xs = np.nonzero(bnd)
    ny, nx = gy[ys, xs], gx[ys, xs]
    steps = int(np.ceil(cap * 2)) + 1                 # half-pixel steps
    depth = np.full(ys.shape, cap, np.float32)
    done = np.zeros(ys.shape, bool)
    for i in range(steps):
        t = 0.5 + 0.5 * i
        cy, cx = ys + ny * t, xs + nx * t
        vs = ndimage.map_coordinates(v, [cy, cx], order=1, mode='nearest')
        ss = ndimage.map_coordinates(solid.astype(np.float32), [cy, cx],
                                     order=1, mode='constant') > 0.5
        stop = ~done & ((vs >= thr) | ~ss)
        depth[stop] = t
        done |= stop
        if done.all():
            break
    out = np.zeros(solid.shape, np.float32)
    out[ys, xs] = np.minimum(depth, cap)
    return out


def measure(path: Path, scale: float) -> dict:
    a, al, v, solid = load(path)
    ys, xs = np.nonzero(solid)
    bb = (int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1))
    bbmax = max(bb)
    d_in = ndimage.distance_transform_edt(solid)
    prof = edge_profile(v, solid, d_in, bbmax)
    thr, contrast = ink_threshold(prof, bbmax)
    ink = solid & (v < thr) if thr > 0 else np.zeros(solid.shape, bool)

    size = bbmax * scale
    target_u = REF_UNITS * (size / REF_SIZE) ** EXPONENT
    target_px = target_u / scale

    bnd = solid & (d_in < 1.5)
    # Cap the march at 1.75x the target: past that a "keyline" is a dark passage of
    # the painting, and either way there is nothing left to add.
    native_map = native_by_normal(v, solid, d_in, bnd, min(thr, MARCH_V),
                                  cap=target_px * 1.75)
    native_avg = float(native_map[bnd].mean()) if bnd.any() else 0.0
    return dict(a=a, al=al, v=v, solid=solid, d_in=d_in, ink=ink, bnd=bnd,
                native_map=native_map, bb=bb, bbmax=bbmax, size=size,
                native_avg=native_avg, native_u=native_avg * scale,
                target_u=target_u, target_px=target_px, contrast=contrast, thr=thr)


# --- the ring ---------------------------------------------------------------
def ink_colour(m) -> np.ndarray:
    """The ink for the added ring: the piece's OWN keyline colour where it has one
    worth extending, otherwise its edge paint dropped to keyline luminance.

    Two rules keep this honest. The existing line is sampled only where the normal
    march actually found a line (>= 2px) — sampling every pixel under the ink
    THRESHOLD instead gave the coin a (111,34,1) mid-orange "keyline" from its own
    shaded rim. And the piece's own ink WINS when it is genuinely dark, because
    matching it is what makes the join between old line and new ring invisible; the
    derived ink is the fallback for a piece with no line, or one whose line is too
    pale to be read as one.
    """
    a, d_in, bnd, native, v = m['a'], m['d_in'], m['bnd'], m['native_map'], m['v']
    rgb = a[..., :3]

    def settle(col: np.ndarray) -> np.ndarray:
        grey = float(col.mean())
        return np.clip(col * (1.0 - INK_DESAT) + grey * INK_DESAT, 0, 255)

    edge = rgb[bnd].astype(np.float32)
    base = np.median(edge, axis=0) if len(edge) else np.array([30.0, 24.0, 24.0])
    peak = max(float(base.max()), 1.0)
    derived = settle(base * min(INK_V * 255.0 / peak, 0.85))   # only ever darkens

    support = bnd & (native >= 2.0)
    if int(support.sum()) >= 64:
        # Only pixels that are actually UNDER the ink threshold count. Taking the
        # median of the whole band instead let the paint beside the line vote, and
        # a 35th percentile biases to the line's core rather than its shoulder.
        walked = (ndimage.binary_dilation(support, iterations=3) & m['solid']
                  & (v < min(m['thr'], INK_MAX_V)) & (d_in >= 1) & (d_in < 3.5))
        if int(walked.sum()) >= 64:
            own = np.percentile(rgb[walked], 35, axis=0).astype(np.float32)
            if float(own.max()) <= INK_MAX_V * 255.0:
                return settle(own)
    return derived


def gap_cap(solid_p, d_out, add_max: float):
    """Per-gap ceiling on the ring width, so growing the line OUTWARD cannot weld the
    art's negative space shut.

    An outward ring of width `w` closes any gap narrower than 2w, and on filigree art
    that is destruction, not styling: the Rimebloom snowflake lost all 77 of its
    internal fenestrations and the Wrackline tangle went from 19 holes to 2. So each
    enclosed gap is measured (its widest radius R) and the ring inside it is capped to
    leave a core open — the hole tightens, which is what an inked line does to it,
    instead of disappearing. The outer background is uncapped; a concave bay that
    pinches off there is a bay an illustrator would have inked across anyway.
    """
    bg = ~solid_p
    lbl, n = ndimage.label(bg)
    if n == 0:
        return np.full(d_out.shape, add_max, np.float32)
    outer = set(np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]])).tolist())
    radius = ndimage.maximum(d_out, lbl, index=np.arange(1, n + 1))
    caps = np.full(n + 1, add_max, np.float32)
    for i in range(1, n + 1):
        if i in outer:
            continue
        R = float(radius[i - 1])
        caps[i] = max(0.0, min(add_max, R - max(GAP_MIN_CORE, GAP_KEEP * R)))
    return caps[lbl]


def build(m, target_px: float, feather: float = 1.0):
    """Return (rgba, pad, add_stats) — the original composited over a ring whose
    width at every boundary point is `target_px` minus the native line there."""
    solid, bnd, native_map = m['solid'], m['bnd'], m['native_map']

    # Smooth the native reading along the contour before subtracting it, or
    # per-pixel noise in the ink mask becomes a wobbly ring. Normalised
    # convolution keeps the average honest across the masked-out interior.
    sigma = max(3.0, target_px)
    w = bnd.astype(np.float32)
    num = ndimage.gaussian_filter(native_map.astype(np.float32) * w, sigma)
    den = ndimage.gaussian_filter(w, sigma)
    native_s = np.where(den > 1e-6, num / np.maximum(den, 1e-6), 0.0)
    add_bnd = np.clip(target_px - native_s, 0.0, target_px) * bnd
    if not bnd.any():
        return None
    add_max = float(add_bnd[bnd].max())
    add_mean = float(add_bnd[bnd].mean())
    if add_max < 0.35:                                # already there
        return None

    pad = int(np.ceil(add_max + feather)) + 2
    P = ((pad, pad), (pad, pad))
    a = np.pad(m['a'], P + ((0, 0),))
    solid_p = np.pad(solid, P)
    add_p = np.pad(add_bnd, P)
    bnd_p = np.pad(bnd, P)

    # Every pixel outside the silhouette inherits the added width, and the ink,
    # of the boundary point nearest to it.
    d_out, idx = ndimage.distance_transform_edt(~bnd_p, return_indices=True)
    add_at = add_p[idx[0], idx[1]]
    ring_a = np.clip(np.minimum(add_at, gap_cap(solid_p, d_out, add_max))
                     - d_out + feather, 0.0, 1.0)
    ring_a[solid_p] = 0.0

    ink = ink_colour(m)
    src_a = a[..., 3].astype(np.float32) / 255.0
    src_rgb = a[..., :3].astype(np.float32)
    out_a = src_a + ring_a * (1.0 - src_a)
    num_rgb = src_rgb * src_a[..., None] + ink[None, None, :] * (ring_a * (1.0 - src_a))[..., None]
    out_rgb = np.where(out_a[..., None] > 1e-6, num_rgb / np.maximum(out_a[..., None], 1e-6), src_rgb)

    rgba = np.dstack([np.clip(out_rgb, 0, 255), np.clip(out_a * 255.0, 0, 255)]).astype(np.uint8)
    hb, ha = enclosed_gaps(solid_p), enclosed_gaps(rgba[..., 3] > 127)
    return rgba, pad, dict(add_max=add_max, add_mean=add_mean, holes=(hb, ha),
                           grow=float(np.count_nonzero(rgba[..., 3] > 127)) / max(1, int(solid_p.sum())),
                           ink=tuple(int(c) for c in ink))


def enclosed_gaps(solid, min_area: int = 6) -> int:
    """Count holes fully enclosed by the silhouette — the negative space a ring can
    destroy. Reported per piece so gap damage can never pass review unnoticed."""
    lbl, n = ndimage.label(~solid)
    if n == 0:
        return 0
    outer = set(np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]])).tolist())
    areas = ndimage.sum(np.ones_like(lbl), lbl, index=np.arange(1, n + 1))
    return sum(1 for i in range(1, n + 1) if i not in outer and areas[i - 1] >= min_area)


# --- output -----------------------------------------------------------------
def write(path: Path, rgba: np.ndarray) -> None:
    """Write the art back, keeping the .png master and its .webp sibling in step —
    the build drops a .png that has a .webp sibling, so they must move together."""
    im = Image.fromarray(rgba, 'RGBA')
    png = path.with_suffix('.png')
    if path.suffix == '.webp' and png.exists():
        im.save(png)
        src = png
    elif path.suffix == '.png':
        im.save(png)
        src = png
    else:
        src = Path(tempfile.mkdtemp()) / 'src.png'
        im.save(src)
    if path.suffix == '.webp':
        subprocess.run(['cwebp', '-quiet', '-lossless', '-exact', '-m', '6',
                        str(src), '-o', str(path)], check=True)
        back = np.array(Image.open(path).convert('RGBA'))
        if not np.array_equal(back, rgba):
            raise SystemExit(f'webp round-trip mismatch for {path}')


def downscale(im: Image.Image, f: float) -> Image.Image:
    """Resize RGBA by resampling PREMULTIPLIED colour. Resampling straight alpha lets
    the lanczos kernel ring across the hard ink/highlight step a new keyline creates,
    which shows up in the preview as a bright halo the art does not have — the
    artefact is in the thumbnail, never in the pixels being shipped."""
    size = (max(1, int(round(im.width * f))), max(1, int(round(im.height * f))))
    a = np.array(im).astype(np.float32) / 255.0
    pm = np.dstack([a[..., :3] * a[..., 3:4], a[..., 3:4]])
    r = np.array(Image.fromarray((pm * 255).astype(np.uint8), 'RGBA')
                 .resize(size, Image.LANCZOS)).astype(np.float32) / 255.0
    al = np.clip(r[..., 3:4], 0.0, 1.0)
    rgb = np.where(al > 1e-4, np.clip(r[..., :3], 0.0, 1.0) / np.maximum(al, 1e-4), 0.0)
    return Image.fromarray((np.dstack([np.clip(rgb, 0, 1), al]) * 255).astype(np.uint8), 'RGBA')


def sheet(jobs, out: Path, cell: int = 240) -> None:
    """Before/after pairs. BOTH panes of a row share one scale factor — sizing each
    to fill the cell would shrink the (larger) 'after' just enough to cancel out the
    growth being reviewed."""
    from PIL import ImageDraw
    pad, label = 8, 22
    rows = len(jobs)
    W, H = cell * 2 + pad * 3, rows * (cell + pad + label) + pad
    sh = Image.new('RGBA', (W, H), (34, 30, 38, 255))
    dr = ImageDraw.Draw(sh)
    for i, (key, before, after, note) in enumerate(jobs):
        y = pad + i * (cell + pad + label)
        f = min(cell / max(after.width, before.width), cell / max(after.height, before.height), 1.0)
        for j, im in enumerate((before, after)):
            r = downscale(im, f)
            x = pad + j * (cell + pad)
            sh.alpha_composite(r, (x + (cell - r.width) // 2, y + (cell - r.height) // 2))
        dr.text((pad + 2, y + cell + 4), f'{key}   before | after   {note}',
                fill=(232, 226, 214, 255))
    sh.convert('RGB').save(out)


def board_sheet(jobs, out: Path, ppu: float = 2.6, width: int = 1500) -> None:
    """Every piece at its TRUE relative on-board size, before above after. This is the
    view that actually judges the rule: a line that is right in isolation can still be
    wrong once a 43-unit grain and a 350-unit manor sit at their real sizes together."""
    from PIL import ImageDraw
    pad = 14
    lanes: list[list[tuple]] = [[]]
    x = pad
    for key, before, after, note, size, bbmax in jobs:
        f = (size * ppu) / bbmax
        b, a = downscale(before, f), downscale(after, f)
        w = max(b.width, a.width)
        if x + w + pad > width and lanes[-1]:
            lanes.append([])
            x = pad
        lanes[-1].append((key, b, a, w))
        x += w + pad
    lane_h = [max(max(b.height, a.height) for _, b, a, _ in ln) for ln in lanes]
    H = pad + sum(h * 2 + pad * 2 + 20 for h in lane_h)
    sh = Image.new('RGBA', (width, H), (34, 30, 38, 255))
    dr = ImageDraw.Draw(sh)
    y = pad
    for ln, h in zip(lanes, lane_h):
        x = pad
        for key, b, a, w in ln:
            sh.alpha_composite(b, (x + (w - b.width) // 2, y + (h - b.height)))
            sh.alpha_composite(a, (x + (w - a.width) // 2, y + h + pad + (h - a.height)))
            dr.text((x, y + h * 2 + pad + 4), key[:16], fill=(190, 184, 176, 255))
            x += w + pad
        dr.text((2, y + h - 8), 'before', fill=(120, 116, 112, 255))
        dr.text((2, y + h * 2 + pad - 8), 'after', fill=(120, 116, 112, 255))
        y += h * 2 + pad * 2 + 20
    sh.convert('RGB').save(out)


def main() -> int:
    global EXPONENT, REF_UNITS
    ap = argparse.ArgumentParser()
    ap.add_argument('keys', nargs='*')
    ap.add_argument('--list', action='store_true', help='measure every registered piece')
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--sheet', type=Path, help='before/after pairs, one row per piece')
    ap.add_argument('--board-sheet', type=Path, help='all pieces at true relative on-board size')
    ap.add_argument('--exponent', type=float, default=EXPONENT)
    ap.add_argument('--ref-units', type=float, default=REF_UNITS)
    args = ap.parse_args()
    EXPONENT, REF_UNITS = args.exponent, args.ref_units

    reg = registry()
    keys = args.keys or sorted(reg)
    if args.list:
        keys = sorted(reg)

    seen: set[str] = set()
    print(f'{"key":18s} {"onboard":>7s} {"native":>13s} {"target":>13s} {"add":>13s}  ink')
    jobs = []
    for key in keys:
        if key not in reg:
            print(f'  ?? unknown key {key}', file=sys.stderr)
            continue
        e = reg[key]
        if e['file'] in seen:
            continue
        seen.add(e['file'])
        m = measure(e['path'], e['scale'])
        sc = e['scale']
        built = build(m, m['target_px'])
        add_px = built[2]['add_mean'] if built else 0.0
        ink = built[2]['ink'] if built else '-'
        topo = ''
        if built:
            hb, ha = built[2]['holes']
            topo = f'  gaps {hb}->{ha}  area x{built[2]["grow"]:.2f}'
            if hb and ha < hb:
                topo += f'  << LOST {hb - ha}'
        print(f'{key:18s} {m["size"]:7.1f} '
              f'{m["native_avg"]:6.2f}px/{m["native_u"]:4.2f}u '
              f'{m["target_px"]:6.2f}px/{m["target_u"]:4.2f}u '
              f'{add_px:6.2f}px/{add_px * sc:4.2f}u  {str(ink):16s}{topo}'
              + (f'   [{e["primary"]}; also {", ".join(e["shared"])}]'
                 if e['shared'] else ''))
        if args.list or built is None:
            continue
        rgba = built[0]
        if args.sheet or args.board_sheet:
            note = f'+{add_px:.1f}px -> {m["target_u"]:.2f}u'
            jobs.append((key, Image.open(e['path']).convert('RGBA'),
                         Image.fromarray(rgba, 'RGBA'), note, m['size'], m['bbmax']))
        if args.apply:
            write(e['path'], rgba)

    if args.sheet and jobs:
        sheet([j[:4] for j in jobs], args.sheet)
        print(f'\nsheet -> {args.sheet}')
    if args.board_sheet and jobs:
        board_sheet(jobs, args.board_sheet)
        print(f'board sheet -> {args.board_sheet}')
    if args.apply:
        print('\nApplied. Run `pnpm audit:art` and re-check anchors on anything '
              'whose silhouette grew noticeably.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
