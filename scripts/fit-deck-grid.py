#!/usr/bin/env python3
"""
FIT DECK GRID — recover the playable lattice of a backdrop from the backdrop.

    assets/sprites/background/<name>.webp
         │
         └─ scripts/fit-deck-grid.py → assets/map/<name>-deck.json
                                          │
                                          └─ scripts/build-zones.mjs → zones.json

WHY THIS EXISTS
---------------
Emberkeep, Borealis and Roothold got their cells from the map editor, whose
export (`assets/map/nionja-worlds.json`) carries a grid per island. Runevault has
no editor grid — only the painting. Hand-typing 223 cells against a render is
both miserable and unverifiable, and would have to be redone the moment the art
is regenerated at a different size.

So the paving is MEASURED instead. The deck in these backdrops is a regular
isometric lattice of flagstones, which is a periodic signal, and a periodic
signal tells you its own period:

  1. BASIS — autocorrelate the high-pass image over a clean patch of deck. The
     two strongest short peaks either side of the vertical are the tile steps
     `u` and `v`. Nothing is assumed about the iso angle; the art is asked.
  2. PHASE — the Fourier coefficient at each lattice frequency, over that same
     patch. Its argument is where the flagstone centres sit, to sub-pixel.
  3. EXTENT — probe nine points inside each candidate diamond. Deck stone is
     pale and never green-dominant; forest canopy, moss and the rock skirt all
     are. Then flood-fill on the FOUR-neighbourhood the game itself merges
     across, so each painted island comes out as its own component and a stray
     bright leaf cannot bridge two of them.

The output is checkable by eye, which is the point of `--overlay`: it draws the
fitted diamonds back onto the art, and a bad fit is obvious in one glance rather
than as a subtly wrong board weeks later.

    python3 scripts/fit-deck-grid.py runevault --overlay /tmp/runevault-fit.png
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Deck stone against forest: pale enough, and never green-dominant. Both sides
# of the pair matter — the shaded south-west corner of Runevault's deck sits at
# luminance ~80, and the sunlit canopy above it is brighter than that but wildly
# green, so neither test alone separates them.
#
# "Green-dominant" is G − R, NOT G − (R+B)/2. The second reads gold as green:
# the gold rune inlay at #F7A437 scores +13 there and would be thrown away
# along with the leaves, punching a hole in the deck at exactly the spot the
# art makes its centrepiece. Foliage has G above R at every exposure, from
# sunlit canopy to deep shade; warm stone and gold never do.
MIN_LUMA = 72
MAX_GREEN = 4
#: Minimum high-pass energy over the cell's own box — how SHARP it is.
#:
#: Colour alone cannot separate deck from the sunlit haze between the trees:
#: that background is bright and warm, so it passes both tests above and the
#: fit spills off the north-east rim into open air. But it is also rendered out
#: of focus, and the deck is not — every flagstone is ringed by a crisp groove.
#: Measured on Runevault: true deck cells run 22–55, the bokeh canopy 5–17.
#: Both 18 and 20 give the identical answer (238 deck + 8 outpost), and the
#: plateau is what makes the number a measurement rather than a knob.
MIN_SHARPNESS = 18
#: Smallest island worth shipping. Below this it is a boulder in the art, not
#: ground — and a one-cell island is a merge board no piece can ever leave.
MIN_ISLAND = 4


def load(name):
    path = os.path.join(ROOT, "assets/sprites/background", f"{name}.webp")
    if not os.path.exists(path):
        sys.exit(f"no backdrop at {path}")
    return Image.open(path).convert("RGB")


def basis(gray, patch):
    """The two tile steps, from the autocorrelation of a clean patch of deck."""
    y0, y1, x0, x1 = patch
    hp = np.asarray(gray, np.float32) - np.asarray(
        gray.filter(ImageFilter.GaussianBlur(9)), np.float32
    )
    win = hp[y0:y1, x0:x1].copy()
    win -= win.mean()
    win *= np.hanning(win.shape[0])[:, None] * np.hanning(win.shape[1])[None, :]
    ac = np.fft.fftshift(np.fft.irfft2(np.abs(np.fft.rfft2(win)) ** 2), axes=0)
    cy = ac.shape[0] // 2
    peaks = []
    for dy in range(-140, 141):
        for dx in range(0, 281):
            if dx * dx + dy * dy < 35**2:
                continue
            peaks.append((float(ac[cy + dy, dx]), dy, dx))
    peaks.sort(reverse=True)
    # The two steps of an iso lattice are mirror images across the horizontal.
    # Take the best peak above the axis and the best below, so a strong (u+v)
    # harmonic — which is horizontal, and often the third-strongest peak — can
    # never be mistaken for one of the steps.
    up = next(p for p in peaks if p[1] < -5)
    down = next(p for p in peaks if p[1] > 5)
    # Returned in the engine's own convention (`denseZoneOf`): +u is one column
    # south-east, +v one row south-west, both pointing DOWN the screen. The
    # autocorrelation is sign-blind — a lattice looks the same from either end —
    # so the pair is oriented here rather than left as whichever half the peak
    # search happened to land on.
    return (
        np.array([float(down[2]), float(down[1])]),
        np.array([-float(up[2]), -float(up[1])]),
    )


def phase(gray, u, v, patch):
    """World px of one flagstone centre, from the lattice's own Fourier phase."""
    y0, y1, x0, x1 = patch
    hp = np.asarray(gray, np.float32) - np.asarray(
        gray.filter(ImageFilter.GaussianBlur(9)), np.float32
    )
    inv = np.linalg.inv(np.column_stack([u, v]))
    ys, xs = np.mgrid[y0:y1, x0:x1]
    ij = inv @ np.stack([xs.ravel().astype(np.float32), ys.ravel().astype(np.float32)])
    w = hp[y0:y1, x0:x1].ravel()
    # hp peaks INSIDE a flagstone and troughs in the groove, so the argument of
    # the fundamental lands on a centre rather than an edge.
    fi = -np.angle(np.sum(w * np.exp(-2j * np.pi * ij[0]))) / (2 * np.pi)
    fj = -np.angle(np.sum(w * np.exp(-2j * np.pi * ij[1]))) / (2 * np.pi)
    return fi * u + fj * v


def islands(rgb, hp, base, u, v, reach):
    """Every painted island, as lists of lattice cells, largest first."""
    h, w = rgb.shape[:2]
    offs = [(0.0, 0.0)] + [
        (a * 0.55, b * 0.55) for a in (-0.5, 0, 0.5) for b in (-0.5, 0, 0.5) if (a, b) != (0, 0)
    ]
    # The cell's own box, for the sharpness read: |u.x| across and |u.y| down
    # covers one flagstone and the grooves that ring it.
    bx, by = int(abs(u[0])), int(abs(u[1]))

    def stone(i, j):
        lums, greens = [], []
        for da, db in offs:
            p = base + (i + da) * u + (j + db) * v
            x, y = int(round(p[0])), int(round(p[1]))
            if not (0 <= x < w and 0 <= y < h):
                return False
            px = rgb[y, x]
            lums.append(px.mean())
            greens.append(px[1] - px[0])
        if float(np.median(lums)) <= MIN_LUMA or float(np.median(greens)) >= MAX_GREEN:
            return False
        c = base + i * u + j * v
        x0, x1 = max(0, int(c[0]) - bx), min(w, int(c[0]) + bx)
        y0, y1 = max(0, int(c[1]) - by), min(h, int(c[1]) + by)
        return float(hp[y0:y1, x0:x1].std()) > MIN_SHARPNESS

    cand = {(i, j) for j in range(-reach, reach) for i in range(-reach, reach) if stone(i, j)}
    out, seen = [], set()
    for start in sorted(cand):
        if start in seen:
            continue
        comp, stack = [], [start]
        seen.add(start)
        while stack:
            i, j = stack.pop()
            comp.append((i, j))
            for n in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
                if n in cand and n not in seen:
                    seen.add(n)
                    stack.append(n)
        out.append(sorted(comp))
    out.sort(key=len, reverse=True)
    return [c for c in out if len(c) >= MIN_ISLAND]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name", help="backdrop name, e.g. runevault")
    ap.add_argument(
        "--patch",
        default="520,1000,380,1420",
        help="y0,y1,x0,x1 of a clean patch of deck — no buildings, no rune inlay",
    )
    ap.add_argument("--reach", type=int, default=40, help="cells searched either side of the origin")
    ap.add_argument("--overlay", help="write the fitted diamonds over the art here, to check by eye")
    args = ap.parse_args()

    src = load(args.name)
    patch = tuple(int(n) for n in args.patch.split(","))
    gray = src.convert("L")
    u, v = basis(gray, patch)
    base = phase(gray, u, v, patch)
    hp = np.asarray(gray, np.float32) - np.asarray(
        gray.filter(ImageFilter.GaussianBlur(9)), np.float32
    )
    comps = islands(np.asarray(src, np.float32), hp, base, u, v, args.reach)

    doc = {
        "format": "emberkeep-deck",
        "version": 1,
        "generatedBy": "scripts/fit-deck-grid.py",
        "backdrop": args.name,
        "art": [src.width, src.height],
        # Backdrop px throughout, exactly like PORTALS in build-zones.mjs: the
        # numbers stay checkable against the image they were read off.
        "origin": [round(float(base[0]), 2), round(float(base[1]), 2)],
        "u": [round(float(u[0]), 2), round(float(u[1]), 2)],
        "v": [round(float(v[0]), 2), round(float(v[1]), 2)],
        "islands": [{"cells": [[i, j] for i, j in c]} for c in comps],
    }
    out = os.path.join(ROOT, "assets/map", f"{args.name}-deck.json")
    with open(out, "w") as fh:
        json.dump(doc, fh, indent=1)
        fh.write("\n")

    print(f"{args.name}: tile {abs(u[0] - v[0]):.0f}x{abs(u[1] + v[1]):.0f} backdrop px, "
          f"u=({u[0]:.0f},{u[1]:.0f}) v=({v[0]:.0f},{v[1]:.0f})")
    print(f"  islands {[len(c) for c in comps]} = {sum(len(c) for c in comps)} cells → {out}")

    if args.overlay:
        im = src.copy()
        d = ImageDraw.Draw(im)
        for n, comp in enumerate(comps):
            col = [(60, 255, 120), (255, 210, 60), (120, 180, 255), (255, 120, 240)][n % 4]
            for i, j in comp:
                d.polygon(
                    [tuple(base + (i + a) * u + (j + b) * v)
                     for a, b in ((-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5))],
                    outline=col,
                )
        im.save(args.overlay)
        print(f"  overlay → {args.overlay}")


if __name__ == "__main__":
    main()
