#!/usr/bin/env python3
"""Stamp the authored tile lattice onto a generated map, island by island.

Feeding a model the artwork and the mask as two separate references does not
work — it has to infer the correspondence and it gets it wrong. Compositing the
lattice ONTO the artwork removes the inference: the model is shown exactly
which seams to paint and where.

The generated islands never land exactly on the mask, so each island's grid
gets its own uniform scale + translation (uniform, so the 2:1 isometric
proportion survives). FIT below is tuned by eye against the render — run with
--check to get a half-size preview to judge alignment.

  python3 tools/mapmask/overlay_grid.py IN.jpg OUT.png [--check preview.jpg]
"""
import argparse
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import design as D  # noqa: E402

# Per island: (uniform scale, target centre in the generated image's pixels).
# Tuned against assets/raw/map-gen/seedream-v5-pro/01-night-borealis.jpg
# (2912x1456). Re-tune per render — see --check.
FIT = {
    'main': (0.70, (1030, 780)),
    'east': (0.80, (2185, 545)),
    'runepad': (0.72, (1995, 1155)),
}
GRID_BGR = (255, 150, 0)
STROKE = 5


def island_polys():
    """The authored tile diamonds, per island, in mask-canvas pixels."""
    out = {}
    for isl in D.ISLANDS:
        polys, _ = D.place(D.cells_of(isl), isl['center'])
        out[isl['id']] = list(polys.values())
    return out


def fitted(polys, scale, centre):
    allp = np.concatenate(polys)
    lo, hi = allp.min(0), allp.max(0)
    mid = (lo + hi) / 2.0
    return [(p - mid) * scale + np.array(centre, float) for p in polys]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--check')
    args = ap.parse_args()

    img = cv2.imread(args.src)
    if img is None:
        sys.exit(f'cannot read {args.src}')
    canvas = img.copy()
    polys = island_polys()
    for key, (scale, centre) in FIT.items():
        for p in fitted(polys[key], scale, centre):
            cv2.polylines(canvas, [np.round(p).astype(np.int32)], True,
                          GRID_BGR, STROKE, cv2.LINE_AA)
    cv2.imwrite(args.dst, canvas)
    if args.check:
        cv2.imwrite(args.check, cv2.resize(canvas, (img.shape[1] // 2,
                                                    img.shape[0] // 2)),
                    [cv2.IMWRITE_JPEG_QUALITY, 92])
    print(f'{args.dst}  {img.shape[1]}x{img.shape[0]}')


if __name__ == '__main__':
    main()
