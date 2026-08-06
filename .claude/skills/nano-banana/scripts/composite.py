#!/usr/bin/env python3
"""Region compositing — hold one base plate still and swap only what moves.

  composite.py frames/ --base X-rest.png [--feather 0.04] [--pad 1.35] [--apply]

This is Sprite Studio's `lib/mouthComposite.ts` technique, ported to run over
files: keep the Rest shape as a static base and swap ONLY a feathered
elliptical region from each other shape on top of it. Its own header says why —
"removes full-frame shimmer when the source images differ slightly outside the
mouth (hair, shading, AI-generation noise)".

That is exactly the failure here. The cells are painted independently, so the
earring, the brows and the hair edge are re-drawn slightly differently in every
one. It is not a shift — registering the frames finds a zero-pixel offset and a
flat correlation field, because there is no rigid transform to find. Compositing
sidesteps it: outside the ellipse every frame is byte-identical to the base, so
the drift is zero by construction rather than by measurement, and crossfades
become safe.

The ellipse is not hand-placed — it is found from the per-pixel variance across
the set, which peaks on whatever the animation actually moves. See
`find_region` for why the peak has to be localised rather than thresholded.
That finds the mouth on a viseme set and the eyes on a blink set with no
per-character tuning.

The feather matches `makeMaskCanvas`: solid to `rx - feather`, then a
smoothstep ease (1 - t^2*(3-2t)) out to `rx`, measured in a space scaled by
ry/rx so the falloff follows the ellipse.
"""
import argparse
import glob
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.ndimage import gaussian_filter

DEFAULT_FEATHER = 0.04  # fraction of width, same default as mouthComposite.ts


def load(path):
    return np.asarray(Image.open(path).convert('RGBA')).astype(np.float64)


def luma(a):
    return (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]) * (a[..., 3] / 255.0)


def pad_to(arrays):
    h = max(a.shape[0] for a in arrays)
    w = max(a.shape[1] for a in arrays)
    out = []
    for a in arrays:
        if a.shape[:2] == (h, w):
            out.append(a)
        else:
            p = np.zeros((h, w, 4), a.dtype)
            p[:a.shape[0], :a.shape[1]] = a
            out.append(p)
    return out, h, w


def find_region(lums, base_i, h, w, frac, pad, top):
    """Ellipse over the pixels the animation actually moves.

    Two signals were tried and rejected before this one:

    - A percentile of the per-pixel variance. These cells are repainted
      wholesale, so *every* pixel of the figure varies and the 98th percentile
      is scattered over the whole body; the fitted ellipse came out covering
      82% of the frame.
    - The variance PEAK. Better, but on Selyna's blink set the peak landed in
      her redrawn hair, not her eyes — loose hair varies more than an eyelid.

    What works is a targeted contrast: the single frame that differs most from
    the base is the extreme of the motion (closed eyes against open, a wide-open
    mouth against rest), and the absolute difference between just those two
    peaks squarely on the moving part. From that peak, grow the connected
    region above `frac` of it, and keep any other component that also reaches
    0.7 of the peak — that is what picks up the second eye. The ellipse is the
    weighted spread of the union.
    """
    sigma = max(2.0, 0.012 * w)
    diffs = [gaussian_filter(np.abs(l - lums[base_i]), sigma) for l in lums]
    # Ignore the bottom of the frame: bust.py anchors every crop at the top of
    # the head, so eyes and mouth are always high in it, while the ragged
    # painted hem at the bottom differs more than an eyelid does.
    for d in diffs:
        d[int(top * h):] = 0
    contrast = int(np.argmax([d.sum() for d in diffs]))
    dm = diffs[contrast]
    py, px = np.unravel_index(np.argmax(dm), dm.shape)
    peak = dm[py, px]

    lab, n = ndimage.label(dm >= frac * peak)
    if n == 0:
        raise SystemExit('nothing moves between these frames — nothing to composite')
    keep = {lab[py, px]}
    for i in range(1, n + 1):
        if dm[lab == i].max() >= 0.7 * peak:
            keep.add(i)
    sel = np.isin(lab, list(keep))

    ys, xs = np.nonzero(sel)
    wts = dm[ys, xs]
    cy = float(np.average(ys, weights=wts))
    cx = float(np.average(xs, weights=wts))
    ry = float(np.sqrt(np.average((ys - cy) ** 2, weights=wts))) * 2.0 * pad
    rx = float(np.sqrt(np.average((xs - cx) ** 2, weights=wts))) * 2.0 * pad
    return ({'cx': cx / w, 'cy': cy / h, 'rx': max(rx, 8) / w, 'ry': max(ry, 8) / h},
            contrast)


def make_mask(h, w, m, feather):
    """Port of makeMaskCanvas: smoothstep falloff across the feather band."""
    cx, cy = m['cx'] * w, m['cy'] * h
    rx, ry = max(2.0, m['rx'] * w), max(2.0, m['ry'] * h)
    fpx = max(0.5, feather * w)
    inner = max(0.0, rx - fpx)
    yy, xx = np.mgrid[0:h, 0:w]
    # distance in the space where the ellipse is a circle of radius rx
    r = np.sqrt((xx - cx) ** 2 + ((yy - cy) * (rx / ry)) ** 2)
    t = np.clip((r - inner) / max(1e-6, rx - inner), 0.0, 1.0)
    a = 1.0 - t * t * (3.0 - 2.0 * t)
    return np.where(r <= inner, 1.0, np.where(r >= rx, 0.0, a))


def over(base, shape, mask):
    """base, with shape's pixels blended in through the mask (premultiplied).

    Untouched pixels are copied from the base verbatim rather than run through
    the premultiply/unpremultiply round trip. Algebraically the round trip is
    the identity, but on a feathered edge it divides by a near-zero alpha and
    the uint8 rounding blows up — the first run of this failed its own
    outside-the-mask check by 95/255, entirely in the figure's soft edges.
    """
    m = mask[..., None]
    ba, sa = base[..., 3:4] / 255.0, shape[..., 3:4] / 255.0
    bp = np.concatenate([base[..., :3] * ba, base[..., 3:4]], axis=2)
    sp = np.concatenate([shape[..., :3] * sa, shape[..., 3:4]], axis=2)
    out = bp * (1 - m) + sp * m
    oa = out[..., 3:4] / 255.0
    rgb = np.divide(out[..., :3], oa, out=np.zeros_like(out[..., :3]), where=oa > 0)
    blended = np.concatenate([np.clip(rgb, 0, 255), out[..., 3:4]], axis=2)
    return np.where(m > 0, blended, base)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('frames_dir')
    ap.add_argument('--base', required=True, help='file name of the static base frame')
    ap.add_argument('--feather', type=float, default=DEFAULT_FEATHER)
    ap.add_argument('--frac', type=float, default=0.45,
                    help='keep variance at least this fraction of the peak')
    ap.add_argument('--pad', type=float, default=1.30, help='ellipse padding factor')
    ap.add_argument('--top', type=float, default=0.50,
                    help='search the variance peak only in the top N of the frame')
    ap.add_argument('--overlay', default=None, help='write a mask-placement preview here')
    ap.add_argument('--region-out', default=None,
                    help='where to write region.json (default: beside the frames)')
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(args.frames_dir, '*.png')))
    names = [os.path.basename(f) for f in files]
    if args.base not in names:
        raise SystemExit(f'base {args.base} is not in {args.frames_dir}')

    arrays, h, w = pad_to([load(f) for f in files])
    lums = np.stack([luma(a) for a in arrays])
    base_i = names.index(args.base)
    region, contrast = find_region(lums, base_i, h, w, args.frac, args.pad, args.top)
    print(f'contrast frame: {names[contrast]}')
    print(f'region: cx={region["cx"]:.3f} cy={region["cy"]:.3f} '
          f'rx={region["rx"]:.3f} ry={region["ry"]:.3f} (feather {args.feather})')

    mask = make_mask(h, w, region, args.feather)
    base = arrays[base_i]
    print(f'mask covers {100 * (mask > 0).sum() / mask.size:.1f}% of the frame, '
          f'{100 * (mask >= 1).sum() / mask.size:.1f}% fully swapped')

    if args.overlay:
        # Draw the ellipse over the base so its placement can be eyeballed.
        vis = base.copy()
        vis[..., 0] = np.clip(vis[..., 0] + 180 * mask, 0, 255)
        vis[..., 3] = np.maximum(vis[..., 3], 255 * (mask > 0))
        Image.fromarray(vis.astype(np.uint8)).save(args.overlay)
        print(f'overlay -> {args.overlay}')

    if not args.apply:
        return

    outside = mask <= 0
    for f, name, a in zip(files, names, arrays):
        comp = base.copy() if name == args.base else over(base, a, mask)
        Image.fromarray(comp.astype(np.uint8)).save(f)

    # Prove it: outside the mask every frame must now be identical to the base.
    written = [load(f) for f in files]
    worst = max(float(np.abs(x[outside] - base[outside]).max()) for x in written)
    print(f'max difference outside the mask: {worst:.0f}/255 across {len(files)} frames')
    if worst != 0:
        raise SystemExit('compositing did not hold the base fixed')
    out_json = args.region_out or os.path.join(args.frames_dir, 'region.json')
    os.makedirs(os.path.dirname(os.path.abspath(out_json)) or '.', exist_ok=True)
    json.dump({'base': args.base, 'feather': args.feather, **region},
              open(out_json, 'w'), indent=2)


if __name__ == '__main__':
    main()
