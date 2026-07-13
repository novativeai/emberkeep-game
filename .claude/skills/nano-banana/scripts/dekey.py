#!/usr/bin/env python3
"""Chroma-key a solid-background AI render into a transparent-alpha PNG.

  python3 dekey.py raw.png out.png [--key FF00FF] [--trim] [--resize 680x520]
                   [--tol-lo 90] [--tol-hi 190] [--pad 8]

- Soft alpha ramp between --tol-lo and --tol-hi (Euclidean RGB distance to the
  key color), so anti-aliased edges keep a feather instead of a hard cut.
- De-spill: spill = max(0, min(r, b) − g) is subtracted from r and b on
  translucent edge pixels — kills magenta fringing without touching warm golds
  (gold has low blue, so its spill term is ≤ 0).
- --trim crops to the content bounding box (alpha > 8) with --pad pixels.
- --resize WxH contain-fits onto a transparent canvas of exactly WxH.
"""
import argparse
import sys

from PIL import Image


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--key', default='FF00FF')
    ap.add_argument('--tol-lo', type=int, default=90)
    ap.add_argument('--tol-hi', type=int, default=190)
    ap.add_argument('--trim', action='store_true')
    ap.add_argument('--pad', type=int, default=8)
    ap.add_argument('--resize', default=None, help='WxH contain-fit canvas')
    args = ap.parse_args()

    kr, kg, kb = (int(args.key[i:i + 2], 16) for i in (0, 2, 4))
    img = Image.open(args.src).convert('RGBA')
    px = img.load()
    w, h = img.size
    lo, hi = args.tol_lo, args.tol_hi
    span = max(1, hi - lo)

    for y in range(h):
        for x in range(w):
            r, g, b, _a = px[x, y]
            dist = ((r - kr) ** 2 + (g - kg) ** 2 + (b - kb) ** 2) ** 0.5
            if dist <= lo:
                px[x, y] = (0, 0, 0, 0)
            elif dist < hi:
                alpha = int(255 * (dist - lo) / span)
                spill = max(0, min(r, b) - g)
                px[x, y] = (max(0, r - spill), g, max(0, b - spill), alpha)
            else:
                # fully opaque — still strip strong spill on near-key hue
                spill = max(0, min(r, b) - g)
                if spill > 96:  # blatant magenta bleed inside the matte
                    px[x, y] = (max(0, r - spill // 2), g, max(0, b - spill // 2), 255)

    if args.trim:
        alpha = img.getchannel('A')
        bbox = alpha.point(lambda a: 255 if a > 8 else 0).getbbox()
        if bbox:
            pad = args.pad
            bbox = (max(0, bbox[0] - pad), max(0, bbox[1] - pad),
                    min(w, bbox[2] + pad), min(h, bbox[3] + pad))
            img = img.crop(bbox)

    if args.resize:
        tw, th = (int(v) for v in args.resize.lower().split('x'))
        scale = min(tw / img.width, th / img.height)
        fitted = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))),
                            Image.LANCZOS)
        canvas = Image.new('RGBA', (tw, th), (0, 0, 0, 0))
        canvas.paste(fitted, ((tw - fitted.width) // 2, (th - fitted.height) // 2), fitted)
        img = canvas

    img.save(args.dst, 'PNG')
    print(f'saved {args.dst} ({img.width}x{img.height})')


if __name__ == '__main__':
    main()
