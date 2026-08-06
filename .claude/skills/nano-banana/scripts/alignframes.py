#!/usr/bin/env python3
"""Register a set of animation frames onto one reference frame.

  alignframes.py frames/ --ref X-rest.png [--max-shift 48] [--apply]

Why this exists: the grid template holds each cell's framing to well under 1%,
but the cells are still painted independently, so the head lands a few pixels
off between frames. In a still that is invisible; cycled at 45 ms it reads as
jitter, and it is what forces the animations to hard-cut instead of crossfade.

Registering on the whole frame does not work. Plain phase correlation returns
peaks around 0.02 here — the painterly detail differs enough between cells that
the correlation never locks on, and it confidently reports 70-pixel shifts that
are pure noise. Registering on the SILHOUETTE does not work either: the ragged
brushwork at the hem is exactly the part that varies most.

So the alignment signal is chosen from the data. Across a frame set, only one
region is supposed to change — the mouth, or the eyelids. Everything else should
be identical. Take the per-pixel standard deviation across the set, keep the
quiet half as a weight mask, and correlate through that mask: the changing
region is zeroed out in both images and cannot pull the fit.

Shifts are applied on PREMULTIPLIED alpha and at whole pixels — resampling a
painterly plate to chase a fraction of a pixel costs more sharpness than the
fraction is worth.
"""
import argparse
import glob
import os

import numpy as np
from PIL import Image
from scipy.signal import fftconvolve

SKIP_SUFFIXES = ('.json',)


def load(path):
    a = np.asarray(Image.open(path).convert('RGBA')).astype(np.float64)
    return a


def luma(a):
    return (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]) * (a[..., 3] / 255.0)


def canvas(arrays):
    """Frames can differ by a pixel from grid rounding; pad to one size."""
    h = max(a.shape[0] for a in arrays)
    w = max(a.shape[1] for a in arrays)
    out = []
    for a in arrays:
        if a.shape[:2] == (h, w):
            out.append(a)
            continue
        p = np.zeros((h, w, 4), a.dtype)
        p[:a.shape[0], :a.shape[1]] = a
        out.append(p)
    return out


def best_shift(ref, img, weight, max_shift):
    """Whole-pixel (dy, dx) putting img onto ref, searched within max_shift."""
    a = ref * weight
    b = img * weight
    a = a - a[weight > 0].mean() if (weight > 0).any() else a
    b = b - b[weight > 0].mean() if (weight > 0).any() else b
    a *= weight
    b *= weight
    cc = fftconvolve(a, b[::-1, ::-1], mode='same')
    h, w = cc.shape
    cy, cx = h // 2, w // 2
    y0, y1 = max(0, cy - max_shift), min(h, cy + max_shift + 1)
    x0, x1 = max(0, cx - max_shift), min(w, cx + max_shift + 1)
    win = cc[y0:y1, x0:x1]
    py, px = np.unravel_index(np.argmax(win), win.shape)
    peak = win[py, px]
    # Normalised peak height: how far the winner stands above the field. A flat
    # field means the frames carry no usable alignment signal.
    conf = float((peak - win.mean()) / (win.std() + 1e-9))
    return int(y0 + py - cy), int(x0 + px - cx), conf


def shift_rgba(a, dy, dx):
    """Whole-pixel shift on premultiplied alpha, so edges do not fringe."""
    out = np.zeros_like(a)
    al = a[..., 3:4] / 255.0
    pre = np.concatenate([a[..., :3] * al, a[..., 3:4]], axis=2)
    h, w = a.shape[:2]
    sy0, sy1 = max(0, -dy), min(h, h - dy)
    dy0, dy1 = max(0, dy), min(h, h + dy)
    sx0, sx1 = max(0, -dx), min(w, w - dx)
    dx0, dx1 = max(0, dx), min(w, w + dx)
    out[dy0:dy1, dx0:dx1] = pre[sy0:sy1, sx0:sx1]
    al2 = out[..., 3:4] / 255.0
    rgb = np.divide(out[..., :3], al2, out=np.zeros_like(out[..., :3]), where=al2 > 0)
    return np.concatenate([np.clip(rgb, 0, 255), out[..., 3:4]], axis=2)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('frames_dir')
    ap.add_argument('--ref', required=True, help='file name of the reference frame')
    ap.add_argument('--max-shift', type=int, default=48)
    ap.add_argument('--quiet-pct', type=float, default=50.0,
                    help='keep the quietest N%% of in-figure pixels as the mask')
    ap.add_argument('--apply', action='store_true', help='write the aligned frames back')
    args = ap.parse_args()

    files = sorted(f for f in glob.glob(os.path.join(args.frames_dir, '*.png'))
                   if not f.endswith(SKIP_SUFFIXES))
    if args.ref not in [os.path.basename(f) for f in files]:
        raise SystemExit(f'reference {args.ref} is not in {args.frames_dir}')

    arrays = canvas([load(f) for f in files])
    lums = np.stack([luma(a) for a in arrays])
    alphas = np.stack([a[..., 3] for a in arrays])

    # The mask: inside every frame's figure, and among the quietest pixels
    # across the set — i.e. everything the animation is not supposed to move.
    inside = (alphas > 200).all(axis=0)
    sd = lums.std(axis=0)
    if inside.sum() == 0:
        raise SystemExit('frames share no common opaque area')
    cut = np.percentile(sd[inside], args.quiet_pct)
    weight = (inside & (sd <= cut)).astype(np.float64)
    print(f'mask: {int(weight.sum())} px '
          f'({100 * weight.sum() / weight.size:.1f}% of frame), sd cut {cut:.1f}')

    ref_i = [os.path.basename(f) for f in files].index(args.ref)
    ref = lums[ref_i]

    shifts = []
    for i, f in enumerate(files):
        dy, dx, conf = best_shift(ref, lums[i], weight, args.max_shift)
        shifts.append((dy, dx))
        print(f'  {os.path.basename(f):<22} dy={dy:+4d} dx={dx:+4d}  confidence={conf:5.1f}σ')

    span_y = max(s[0] for s in shifts) - min(s[0] for s in shifts)
    span_x = max(s[1] for s in shifts) - min(s[1] for s in shifts)
    print(f'drift before: {span_y} px y, {span_x} px x')

    if not args.apply:
        return

    aligned = [shift_rgba(a, -dy, -dx) for a, (dy, dx) in zip(arrays, shifts)]
    for f, a in zip(files, aligned):
        Image.fromarray(a.astype(np.uint8)).save(f)

    # Re-measure on what was actually written.
    lums2 = np.stack([luma(a) for a in aligned])
    res = [best_shift(lums2[ref_i], lums2[i], weight, args.max_shift)[:2]
           for i in range(len(files))]
    ry = max(s[0] for s in res) - min(s[0] for s in res)
    rx = max(s[1] for s in res) - min(s[1] for s in res)
    print(f'drift after:  {ry} px y, {rx} px x')
    if (ry, rx) != (0, 0):
        raise SystemExit('alignment did not converge to zero drift')


if __name__ == '__main__':
    main()
