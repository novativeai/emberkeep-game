#!/usr/bin/env python3
"""Bring separately-generated pose sets onto ONE canvas, so frames interchange.

  crossalign.py <character> [--ref visemes] [--sets eyelids,expressions]
                [--refine 24] [--out-suffix _aligned] [--check diff.png]

Each pose set (visemes, eyelids, expressions) was generated from its own bust
crop through its own grid template, so each landed on a different canvas at a
different scale — 1835x3072 vs 1101x1536 vs 1376x1536 for Eleanor. Frames
inside a set are co-registered; frames ACROSS sets are not, which is why a
blink bank cannot rest on the talk bank's `X-rest` pose without the head
jumping size and position.

The transform between two sets is not searched for, it is DERIVED. Every set
traces back to the same portrait through two exactly-known steps:

  1. bust.py cropped an axis-aligned rectangle out of the portrait. The crops
     are byte-identical sub-images, so `locate_crop` finds each rectangle's
     origin exactly (it matches one row, then asserts the whole crop).
  2. buildGridSheet (gridSheet.ts) stamped that crop into every cell,
     contain-fit with PAD_PCT = 0.08 of the cell's LONG side as margin on all
     four sides. So in a cell of any size the content box is a fixed fraction:
     0.08 of the height vertically (height is the long side for a bust), and
     0.08 / cell_aspect horizontally.

Composing the two gives cell -> portrait for each set, and therefore
set -> set. `--refine` then does a small local search around that seed, because
the model redraws the head a few pixels off the template; a seeded search is
well-posed where a blind one is not (a blind scale sweep parks the template in
the transparent background, where the local variance is ~0 and the correlation
score is meaningless).

x and y get their own scale. The sheets are rendered at the route's 16:9, not
at the template's aspect, so a cell comes back stretched by up to ~1%; the
model followed the stretched template, so the correction is anisotropic too.
"""
import argparse
import glob
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import composite  # noqa: E402  — make_mask/over, the within-set compositor

# gridSheet.ts: the margin per side, as a fraction of the cell's LONG side. This
# must match the pad the template was actually built with, or the derived
# cell->portrait transform is wrong by exactly that difference. gridSheet.ts's
# own default moved 0.08 -> 0.16 (tight masks made the generated cells overlap
# and the sheet unsliceable), so a set built before that change and a set built
# after it carry different pads — hence a per-set map rather than one constant.
DEFAULT_PAD_PCT = 0.08
SET_PAD_PCT = {}

# Grid template actually sent to the model, per set + its column count. When the
# file is present the mask box is MEASURED from it instead of derived, which is
# the only thing that survives a template letterboxed to the route's ratio.
SET_GRID = {
    'visemes': ('talk-grid.png', 5),
    'eyelids': ('blink-grid.png', 3),
    'expressions': ('expressions-grid.png', 4),
}


def measured_box(path, cols):
    """Mask box in the template's FIRST cell, as fractions of that cell."""
    g = np.asarray(Image.open(path).convert('RGBA'))
    h, w = g.shape[:2]
    cw = w // cols
    cell = g[:, :cw]
    # The mask is white-on-key; take anything bright and opaque.
    lit = (cell[..., 3] > 16) & (cell[..., :3].min(axis=-1) > 200)
    ys, xs = np.nonzero(lit)
    if xs.size == 0:
        return None
    return (xs.min() / cw, ys.min() / h, (xs.max() + 1) / cw, (ys.max() + 1) / h)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))))

# set name -> (bust crop used as the template source, pose folder)
SETS = {
    'visemes': 'talk-head',
    'eyelids': 'blink-head',
    'expressions': 'bust',
}


def rgba(path):
    return np.asarray(Image.open(path).convert('RGBA')).astype(np.float64)


def luma(a):
    return (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]) * (a[..., 3] / 255.0)


def locate_crop(portrait, crop):
    """Exact origin of `crop` inside `portrait` — they are the same pixels."""
    h, w = crop.shape[:2]
    row = crop[h // 2]
    for y in range(portrait.shape[0] - h + 1):
        for x in range(portrait.shape[1] - w + 1):
            if np.array_equal(portrait[y + h // 2, x:x + w], row):
                if np.array_equal(portrait[y:y + h, x:x + w], crop):
                    return x, y
    raise SystemExit('crop is not a sub-image of the portrait — was it resized?')


class Placement:
    """Where a generated cell's content sits, in portrait coordinates."""

    def __init__(self, cell_w, cell_h, crop_x, crop_y, crop_w, crop_h, pad=DEFAULT_PAD_PCT,
                 box=None):
        if box is not None:
            # MEASURED from the grid template that was actually sent to the
            # model: (x0, y0, x1, y1) as fractions of a cell. Always prefer this
            # — the derivation below assumes the template is exactly gridSheet's
            # output, which stops being true the moment anything letterboxes it
            # to reach the route's aspect ratio (and a wrong transform smears the
            # swapped region across the face rather than failing loudly).
            self.x0, self.y0, self.x1, self.y1 = (
                box[0] * cell_w, box[1] * cell_h, box[2] * cell_w, box[3] * cell_h)
        else:
            # Cell aspect the template was built at: contain-fit + equal margins
            # means cw/ch = (1-2p)*(w/h) + 2p for a taller-than-wide source.
            cell_ar = (1 - 2 * pad) * (crop_w / crop_h) + 2 * pad
            mx, my = pad / cell_ar, pad
            self.x0, self.x1 = mx * cell_w, (1 - mx) * cell_w
            self.y0, self.y1 = my * cell_h, (1 - my) * cell_h
        self.cx, self.cy = crop_x, crop_y
        self.sx = crop_w / (self.x1 - self.x0)   # portrait px per cell px
        self.sy = crop_h / (self.y1 - self.y0)

    def to_portrait(self, x, y):
        return self.cx + (x - self.x0) * self.sx, self.cy + (y - self.y0) * self.sy

    def from_portrait(self, px, py):
        return self.x0 + (px - self.cx) / self.sx, self.y0 + (py - self.cy) / self.sy


def transform(src: Placement, ref: Placement):
    """(sx, sy, dx, dy) mapping SRC cell px -> REF cell px."""
    ax, ay = ref.from_portrait(*src.to_portrait(0, 0))
    bx, by = ref.from_portrait(*src.to_portrait(1000, 1000))
    sx, sy = (bx - ax) / 1000, (by - ay) / 1000
    return sx, sy, ax, ay


def warp(img, t, out_w, out_h):
    """Resample SRC into the REF canvas under (sx, sy, dx, dy)."""
    sx, sy, dx, dy = t
    w, h = max(1, round(img.shape[1] * sx)), max(1, round(img.shape[0] * sy))
    scaled = Image.fromarray(img.astype(np.uint8)).resize((w, h), Image.LANCZOS)
    out = Image.new('RGBA', (out_w, out_h), (0, 0, 0, 0))
    out.paste(scaled, (int(round(dx)), int(round(dy))))
    return np.asarray(out).astype(np.float64)


def ellipse_mask(shape, region, grow=1.0):
    """Boolean mask of a composite.py region record (normalised), optionally grown."""
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = region['cx'] * w, region['cy'] * h
    rx, ry = region['rx'] * w * grow, region['ry'] * h * grow
    return ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1.0


def head_patch(ref_img, mouth, band=(0.04, 0.46), wfrac=0.78):
    """A template cut from the reference's head — the only part that must match.

    Below the jaw the two sheets are honestly different paintings (the model
    re-invented the robe and the hands in each generation), so scoring the whole
    silhouette measures that disagreement instead of the alignment. The mouth is
    zeroed out for the same reason: it is what the viseme set changes.
    """
    a = ref_img
    ys, xs = np.nonzero(a[..., 3] > 16)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    bw, bh = x1 - x0, y1 - y0
    px0, px1 = int(x0 + bw * (1 - wfrac) / 2), int(x1 - bw * (1 - wfrac) / 2)
    py0, py1 = int(y0 + bh * band[0]), int(y0 + bh * band[1])
    patch = luma(a)[py0:py1, px0:px1].copy()
    m = mouth[py0:py1, px0:px1]
    patch[m] = patch[~m].mean() if (~m).any() else 0.0
    return patch, (px0, py0)


def locate(field, patch, expect, span):
    """Best position of `patch` in `field`, searched only near `expect`.

    Bounding the search is the point. A free argmax over an NCC map drifts into
    the transparent background, where the window variance is ~0 and the ratio
    blows up to a meaningless maximum — the classic failure of un-masked NCC on
    art with big empty margins.
    """
    from scipy.signal import fftconvolve
    p0 = patch - patch.mean()
    ones = np.ones_like(patch)
    n = patch.size
    num = fftconvolve(field, p0[::-1, ::-1], 'valid')
    a2 = fftconvolve(field * field, ones[::-1, ::-1], 'valid')
    a1 = fftconvolve(field, ones[::-1, ::-1], 'valid')
    var = a2 - a1 * a1 / n
    floor = 0.02 * (p0 * p0).sum()
    s = num / (np.sqrt(np.maximum(var, floor)) * np.sqrt((p0 * p0).sum()))
    ex, ey = expect
    y0, y1 = max(0, ey - span), min(s.shape[0], ey + span + 1)
    x0, x1 = max(0, ex - span), min(s.shape[1], ex + span + 1)
    win = s[y0:y1, x0:x1]
    i = np.unravel_index(np.argmax(win), win.shape)
    return float(win[i]), x0 + i[1], y0 + i[0]


def refine(ref_img, src_img, t, mouth, span, scale_span=0.22, steps=45, work_h=600):
    """Search around the derived seed: a scale sweep x bounded translation.

    The seed assumes the model filled the template silhouette. It usually does —
    but a sheet that references a finished plate follows THAT plate's head
    proportions instead, and can land 20% off. So the sweep is wide; what keeps
    it well-posed is that the translation stays bounded to a window around the
    seed, which is what stops the match from wandering into the empty margin.
    """
    h, w = ref_img.shape[:2]
    patch, (ex, ey) = head_patch(ref_img, mouth)
    k = work_h / h
    pw, ph = max(8, round(patch.shape[1] * k)), max(8, round(patch.shape[0] * k))
    P = np.asarray(Image.fromarray(patch).resize((pw, ph), Image.BILINEAR))
    best = None
    for ds in np.linspace(-scale_span, scale_span, steps):
        c = (t[0] * (1 + ds), t[1] * (1 + ds), t[2], t[3])
        field = luma(warp(src_img, c, w, h))
        F = np.asarray(Image.fromarray(field).resize(
            (max(1, round(w * k)), work_h), Image.BILINEAR))
        sc, x, y = locate(F, P, (round(ex * k), round(ey * k)), max(2, round(span * k)))
        if best is None or sc > best[0]:
            # the patch wants to move (x - ex*k) in the field; shifting the SRC
            # by the negative of that brings it under the reference.
            best = (sc, (c[0], c[1], c[2] - (x / k - ex), c[3] - (y / k - ey)))
    return best


def map_region(region, src_shape, t, ref_shape):
    """A normalised region, carried into REF space.

    `space: "ref"` means it was measured on the reference plate already and
    passes through — which is how the eye ellipse is authored, so that
    regenerating the source sheet at a different framing cannot invalidate it.
    """
    if region.get('space') == 'ref':
        return {k: region[k] for k in ('cx', 'cy', 'rx', 'ry')}
    sh, sw = src_shape
    rh, rw = ref_shape
    sx, sy, dx, dy = t
    return {'cx': (region['cx'] * sw * sx + dx) / rw,
            'cy': (region['cy'] * sh * sy + dy) / rh,
            'rx': region['rx'] * sw * sx / rw,
            'ry': region['ry'] * sh * sy / rh}


def tone_match(src, base, mask, ring=(1.0, 1.7)):
    """Match SRC's levels to BASE in the ring just outside the swapped ellipse.

    The two sheets were lit by two independent generations, so the same cheek is
    a few levels darker in one than the other. Without this the feather blends a
    correct shape across a visible step in value; with it the ellipse carries
    only the shape change it is there for.
    """
    band = mask['outer'] & ~mask['inner'] & (src[..., 3] > 200) & (base[..., 3] > 200)
    if band.sum() < 500:
        return src
    out = src.copy()
    for c in range(3):
        s, b = src[..., c][band], base[..., c][band]
        ss = s.std()
        gain = (b.std() / ss) if ss > 1e-3 else 1.0
        gain = float(np.clip(gain, 0.8, 1.25))
        out[..., c] = np.clip((src[..., c] - s.mean()) * gain + b.mean(), 0, 255)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('character')
    ap.add_argument('--ref', default='visemes')
    ap.add_argument('--sets', default='eyelids,expressions')
    ap.add_argument('--refine', type=int, default=24, help='+/- px local search (0 = off)')
    ap.add_argument('--seed', choices=('derived', 'identity'), default='derived',
                    help='"identity" when the set was produced by EDITING the reference '
                         'plate rather than generated through its own grid template — '
                         'there is no bust crop to derive a placement from, and the two '
                         'are already on the same canvas')
    ap.add_argument('--suffix', default='_aligned')
    ap.add_argument('--transforms-out', default=None)
    ap.add_argument('--fuse', default='eyelids',
                    help='comma-separated sets to region-composite onto the reference '
                         'base plate (so they differ from it ONLY inside their own '
                         'moving region); "" to just align')
    ap.add_argument('--fuse-region', default='eye-region.json',
                    help='meta/ file holding the ellipse to swap. NOT blink-region.json: '
                         'composite.py sizes that one to 2-sigma of the whole moving '
                         'field, which on these sets reaches the mouth — fusing through '
                         'it would carry the eyelid sheet\'s mouth over the visemes.')
    ap.add_argument('--tone-match', action='store_true',
                    help='level-match the source to the base in the ring around the '
                         'ellipse. Only for a source generated independently of the '
                         'reference; once the sheet references the reference plate the '
                         'levels already agree and this only introduces a step.')
    ap.add_argument('--fuse-base', default=None,
                    help='write this fused state as the reference plate VERBATIM '
                         '(e.g. "open"), so a bank resting on rest.png is a no-op')
    args = ap.parse_args()

    who = args.character
    prod = os.path.join(ROOT, 'assets/sprites/characters', who)
    raw = os.path.join(ROOT, 'assets/raw/characters', who)
    portrait = np.asarray(Image.open(os.path.join(prod, f'{who}-portrait.png')).convert('RGBA'))

    def placement(setname):
        crop = np.asarray(Image.open(
            os.path.join(raw, 'templates', f'{SETS[setname]}.png')).convert('RGBA'))
        cx, cy = locate_crop(portrait, crop)
        sample = sorted(glob.glob(os.path.join(prod, f'{who}_{setname}', f'{who}_*.png')))[0]
        im = Image.open(sample)
        box = None
        grid = SET_GRID.get(setname)
        if grid and os.path.exists(os.path.join(raw, 'templates', grid[0])):
            box = measured_box(os.path.join(raw, 'templates', grid[0]), grid[1])
        return Placement(im.width, im.height, cx, cy, crop.shape[1], crop.shape[0],
                         SET_PAD_PCT.get(setname, DEFAULT_PAD_PCT), box), im.size

    ref_p, (rw, rh) = placement(args.ref)
    ref_base = rgba(os.path.join(prod, f'{who}_{args.ref}', f'{who}_X-rest.png'))

    # The reference's own moving part is excluded from every measurement — it is
    # supposed to differ between a viseme plate and an eyelid plate.
    mouth = ellipse_mask((rh, rw), json.load(
        open(os.path.join(raw, 'meta', 'talk-region.json'))), 1.25)
    patch, (ex, ey) = head_patch(ref_base, mouth)

    def face_err(t):
        """Mean |difference| over the head band alone, at the given transform."""
        f = luma(warp(probe, t, rw, rh))[ey:ey + patch.shape[0], ex:ex + patch.shape[1]]
        keep = (patch > 4) & (f > 4)
        return float(np.abs(patch[keep] - f[keep]).mean()) if keep.sum() > 500 else 1e9

    out = {}
    for setname in args.sets.split(','):
        if args.seed == 'identity':
            t = (1.0, 1.0, 0.0, 0.0)
        else:
            t = transform(placement(setname)[0], ref_p)
        files = sorted(glob.glob(os.path.join(prod, f'{who}_{setname}', f'{who}_*.png')))
        probe = rgba(files[0])
        seed_err = face_err(t)
        if args.refine:
            _, c = refine(ref_base, probe, t, mouth, args.refine)          # coarse
            _, c = refine(ref_base, probe, c, mouth, 40, 0.02, 21, 900)    # fine
            # NCC picks the peak; face_err is what we actually care about, and on
            # an already-aligned set (an edited plate) the peak can sit a pixel
            # off it. Keep the seed unless the search genuinely beat it.
            t = c if face_err(c) < seed_err else t
        err = face_err(t)
        print(f'{who} {setname:12s} -> {args.ref}: scale {t[0]:.4f},{t[1]:.4f} '
              f'offset {t[2]:+.1f},{t[3]:+.1f} | face residual {seed_err:.1f} -> {err:.1f}')

        dst = os.path.join(prod, f'{who}_{setname}{args.suffix}')
        os.makedirs(dst, exist_ok=True)
        rec = {'scale': [t[0], t[1]], 'offset': [t[2], t[3]],
               'canvas': [rw, rh], 'face_residual': err, 'frames': len(files),
               'fused': False}

        fuse = setname in [s for s in args.fuse.split(',') if s]
        if fuse:
            src_shape = Image.open(files[0]).size[::-1]
            spec = json.load(open(os.path.join(raw, 'meta', args.fuse_region)))
            region = map_region(spec, src_shape, t, (rh, rw))
            # make_mask measures the feather in x-units, so on a wide flat
            # ellipse a width-relative feather collapses vertically (rx 226 px
            # vs ry 74 px turns a 27 px band into 9 px) and the swap reads as a
            # rectangle. Scale it to rx instead, which keeps the softness even
            # on both axes.
            feather = spec.get('feather_rel', 0.30) * region['rx']
            mask = composite.make_mask(rh, rw, region, feather)
            rings = {'inner': ellipse_mask((rh, rw), region, 1.0),
                     'outer': ellipse_mask((rh, rw), region, 1.7)}
            rec.update(fused=True, region=region, feather=feather)

        for f in files:
            state = os.path.splitext(os.path.basename(f))[0][len(who) + 1:]
            if fuse and state == args.fuse_base:
                Image.fromarray(ref_base.astype(np.uint8)).save(
                    os.path.join(dst, os.path.basename(f)))
                continue
            w_img = warp(rgba(f), t, rw, rh)
            if fuse:
                if args.tone_match:
                    w_img = tone_match(w_img, ref_base, rings)
                w_img = composite.over(ref_base, w_img, mask)
                outside = mask <= 0
                delta = np.abs(w_img - ref_base)[outside].max()
                assert delta == 0, f'{f}: {delta} difference outside the swapped region'
            Image.fromarray(w_img.astype(np.uint8)).save(
                os.path.join(dst, os.path.basename(f)))
        if fuse:
            print(f'  fused onto {args.ref}/{who}_X-rest.png — 0 difference outside '
                  f'the eye ellipse on all {len(files)} plates')
        out[setname] = rec

    if args.transforms_out:
        json.dump({'character': who, 'ref': args.ref, 'sets': out},
                  open(args.transforms_out, 'w'), indent=2)


if __name__ == '__main__':
    main()
