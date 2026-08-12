#!/usr/bin/env python3
"""Crop a transparent full-figure portrait down to a head-and-shoulders bust.

  bust.py portrait.png bust.png [--aspect 0.868] [--iters 6]

The aspect is not cosmetic. gridSheet.ts pads a cell by 8% per side around the
source's tight alpha bbox, so for a portrait source (h > w) a cell comes out at

    cell_ar = 0.84 * (w / h) + 0.16

and an N x M sheet is then (N * cell_w) / (M * cell_h). To land a 4x2 sheet on
16:9 — the only ratio the Gemini sheet route offers near it — the bust's own
content aspect has to be 0.868. Feed the template to the model at a different
ratio than it will render at and the cells stretch, which is exactly how the
first pass ended up clipping shoulders.

The band is solved by fixed-point iteration: the width of the figure inside the
band sets the band's height, which changes the width, and so on. Two or three
rounds is enough; six is free.
"""
import argparse

from PIL import Image


def alpha_bbox(img: Image.Image, thresh: int = 16):
    a = img.getchannel('A').point(lambda v: 255 if v > thresh else 0)
    box = a.getbbox()
    if not box:
        raise SystemExit('the source has no visible pixels')
    return box


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--aspect', type=float, default=0.868,
                    help='target width/height of the cropped content')
    ap.add_argument('--iters', type=int, default=6)
    ap.add_argument('--measure', type=float, default=None, metavar='FRAC',
                    help='take the crop width from the top FRAC of the figure '
                         '(the head) instead of solving for it — use for tall '
                         'narrow head crops, where the iteration would keep '
                         'reaching further down the widening body')
    args = ap.parse_args()

    img = Image.open(args.src).convert('RGBA')
    x0, y0, x1, y1 = alpha_bbox(img)
    full_h = y1 - y0

    if args.measure is not None:
        # Width comes from the head band alone; everything outside that column
        # is cropped away, so the result's own bbox is the crop and the aspect
        # is exact even though the shoulders below are wider.
        band = img.crop((x0, y0, x1, y0 + max(1, round(full_h * args.measure))))
        bx = alpha_bbox(band)
        left, right = x0 + bx[0], x0 + bx[2]
        height = round((right - left) / args.aspect)
    else:
        # Seed with a band a bit taller than a head so the first width
        # measurement already includes the shoulders rather than just the skull.
        height = int(full_h * 0.42)
        left, right = x0, x1
        for _ in range(args.iters):
            height = max(1, min(height, full_h))
            band = img.crop((x0, y0, x1, y0 + height))
            bx = alpha_bbox(band)
            left, right = x0 + bx[0], x0 + bx[2]
            height = round((right - left) / args.aspect)

    height = max(1, min(height, full_h))
    band = img.crop((left, y0, right, y0 + height))
    bx = alpha_bbox(band)
    crop = (left + bx[0], y0 + bx[1], left + bx[2], y0 + bx[3])
    out = img.crop(crop)
    out.save(args.dst)
    print(f'saved {args.dst} ({out.width}x{out.height}) '
          f'| content ar {out.width / out.height:.3f} (target {args.aspect}) '
          f'| kept top {100 * out.height / full_h:.0f}% of the figure')


if __name__ == '__main__':
    main()
