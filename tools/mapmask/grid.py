#!/usr/bin/env python3
"""Trace the playable tile grid over the world backdrop.

Three stages:
  1. A three-class random forest (paved top / rock face / sky) reusing the
     feature stack from trace.py, giving a mask of the walkable surface.
  2. Per island, the isometric lattice is recovered from the painted tile
     seams: a 2-D FFT of the seam-groove energy yields the two dominant
     frequency vectors, refined to sub-pixel and phased off the same complex
     coefficient. Nothing is assumed about tile size or origin.
  3. Every lattice cell whose diamond lands on the paved mask is kept, and its
     edges are stroked in blue.

Outputs into tools/mapmask/out/:
  grid-trace.png    blue tile grid on black  (the deliverable)
  grid-check.jpg    grid over the art, to verify the fit
  grid-floor.png    the paved-surface mask the grid is clipped to

Usage: python3 tools/mapmask/grid.py
"""
import json
import os

import cv2
import numpy as np
from sklearn.ensemble import RandomForestClassifier

from trace import SKY, features, kernel

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.join(ROOT, 'tools', 'mapmask')
OUT = os.path.join(HERE, 'out')

# Hand-labelled sample boxes (x0, y0, x1, y1) in backdrop pixels.
PAVED = [
    (660, 360, 840, 430), (900, 560, 1150, 700), (1000, 750, 1300, 950),
    (1250, 950, 1450, 1120), (1150, 1050, 1350, 1150), (720, 700, 860, 760),
    (500, 200, 620, 280), (950, 170, 1080, 240), (1310, 330, 1440, 400),
    (1700, 330, 1900, 430), (2050, 780, 2250, 900), (2400, 620, 2540, 700),
    (2200, 1250, 2400, 1380), (170, 1090, 380, 1170), (560, 1420, 780, 1520),
    (1950, 1050, 2100, 1150), (1450, 620, 1560, 700), (820, 900, 980, 1000),
    # darker, shadowed paving that the first pass kept losing to "rock face"
    (200, 1100, 330, 1150), (600, 1440, 740, 1500), (1780, 800, 1900, 880),
    (2280, 700, 2420, 780), (2000, 1150, 2140, 1230), (1500, 380, 1600, 440),
    (1250, 420, 1330, 470), (860, 480, 980, 540), (1080, 1180, 1200, 1240),
]
FACE = [
    (390, 430, 440, 540), (860, 1160, 1000, 1250), (1620, 720, 1690, 900),
    (1000, 1270, 1200, 1350), (640, 760, 760, 850), (2450, 700, 2560, 820),
    (1400, 1240, 1600, 1330), (170, 1200, 380, 1290), (560, 1560, 760, 1630),
    (1550, 480, 1650, 620), (1180, 300, 1240, 380), (330, 700, 400, 800),
    (1900, 620, 1990, 720), (2000, 430, 2080, 520), (760, 200, 840, 300),
    (1290, 480, 1380, 560), (2100, 1420, 2260, 1520), (1660, 1050, 1740, 1130),
]

MIN_CELL_COVER = 0.34   # fraction of a diamond that must be paved to keep it
MIN_INSIDE = 0.99       # a tile may not overhang the playable surface
SKIRT_PX = 70          # rock hangs this far below the paving it belongs to
GRID_COLOR = (255, 140, 0)   # BGR — blue
STROKE = 3


def oriented(img):
    """Edge energy split by orientation.

    Paved tops carry the two iso seam directions (~+-30 deg); rock faces carry
    vertical brick joints. Colour alone cannot tell them apart — this can.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    gray = gray - cv2.GaussianBlur(gray, (0, 0), 8.0)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, 3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, 3)
    mag = np.hypot(gx, gy)
    ang = np.mod(np.arctan2(gy, gx), np.pi)
    chans = []
    centres = np.linspace(0, np.pi, 6, endpoint=False)
    for c in centres:
        d = np.abs(np.mod(ang - c + np.pi / 2, np.pi) - np.pi / 2)
        chans.append(cv2.boxFilter(mag * np.maximum(0, 1 - d / (np.pi / 6)),
                                   -1, (45, 45)))
    stack = np.stack(chans, -1)
    total = stack.sum(-1, keepdims=True) + 1e-3
    return np.concatenate([stack, stack / total], -1)


def surface_mask(img):
    """Per-pixel argmax of paved / rock-face / sky."""
    feat = np.concatenate([features(img), oriented(img)], -1)
    rng = np.random.RandomState(0)
    X, y = [], []
    for boxes, label in ((PAVED, 2), (FACE, 1), (SKY, 0)):
        for x0, y0, x1, y1 in boxes:
            patch = feat[y0:y1, x0:x1].reshape(-1, feat.shape[-1])
            idx = rng.choice(len(patch), min(4000, len(patch)), replace=False)
            X.append(patch[idx])
            y.append(np.full(len(idx), label))
    clf = RandomForestClassifier(n_estimators=60, max_depth=16, n_jobs=-1,
                                 random_state=0)
    clf.fit(np.concatenate(X), np.concatenate(y))

    flat = feat.reshape(-1, feat.shape[-1])
    out = np.empty(len(flat), np.uint8)
    for i in range(0, len(flat), 400000):
        out[i:i + 400000] = clf.predict(flat[i:i + 400000])
    return out.reshape(img.shape[:2])


def seam_energy(img):
    """Tile seams are dark grooves; return their strength."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    hp = gray - cv2.GaussianBlur(gray, (0, 0), 6.0)
    return np.clip(-hp, 0, None)


def coefficient(w, ys, xs, fx, fy):
    ph = np.exp(-2j * np.pi * (fx * xs + fy * ys))
    return np.dot(w, ph)


def refine(w, ys, xs, f, span, steps):
    """Local search for the frequency that maximises |C(f)|."""
    best = (abs(coefficient(w, ys, xs, *f)), f)
    for dx in np.linspace(-span, span, steps):
        for dy in np.linspace(-span, span, steps):
            cand = (f[0] + dx, f[1] + dy)
            m = abs(coefficient(w, ys, xs, *cand))
            if m > best[0]:
                best = (m, cand)
    return best[1]


def frequencies(energy, region):
    """Recover the two seam frequency vectors from the painted tile seams."""
    ys, xs = np.nonzero(region)
    y0, y1 = ys.min(), ys.max() + 1
    x0, x1 = xs.min(), xs.max() + 1
    sub = np.where(region[y0:y1, x0:x1], energy[y0:y1, x0:x1], 0.0)
    sub = sub - sub.mean()
    h, w = sub.shape
    win = np.hanning(h)[:, None] * np.hanning(w)[None, :]
    spec = np.abs(np.fft.fftshift(np.fft.fft2(sub * win)))

    fy = np.fft.fftshift(np.fft.fftfreq(h))
    fx = np.fft.fftshift(np.fft.fftfreq(w))
    FX, FY = np.meshgrid(fx, fy)
    period = 1.0 / np.maximum(np.hypot(FX, FY), 1e-9)
    spec[(period < 90) | (period > 320)] = 0
    spec[FX < 0] = 0                                # keep one half-plane

    peaks = []
    work = spec.copy()
    for _ in range(2):
        idx = np.unravel_index(np.argmax(work), work.shape)
        f = (FX[idx], FY[idx])
        peaks.append(f)
        # suppress this peak and its neighbourhood before hunting the next
        d = np.hypot(FX - f[0], FY - f[1])
        work[d < 0.6 * np.hypot(*f)] = 0

    wgt = energy[ys, xs].astype(np.float64)
    wgt = wgt - wgt.mean()
    out = []
    for f in peaks:
        f = refine(wgt, ys, xs, f, span=1.0 / 700, steps=15)
        out.append(refine(wgt, ys, xs, f, span=1.0 / 4000, steps=15))
    return out


def phase_fit(energy, region, freqs):
    """Lock the shared frequencies onto one island: small drift + phase."""
    ys, xs = np.nonzero(region)
    wgt = energy[ys, xs].astype(np.float64)
    wgt = wgt - wgt.mean()
    out = []
    for f in freqs:
        f = refine(wgt, ys, xs, f, span=1.0 / 2500, steps=13)
        c = coefficient(wgt, ys, xs, *f)
        out.append((f[0], f[1], -np.angle(c) / (2 * np.pi)))
    return out


def cell_polygons(lat, region):
    """Diamonds of every lattice cell that lands on the region, with indices."""
    (ax, ay, aph), (bx, by, bph) = lat
    A = np.array([[ax, ay], [bx, by]])
    det = np.linalg.det(A)
    if abs(det) < 1e-12:
        return []
    inv = np.linalg.inv(A)

    ys, xs = np.nonzero(region)
    pts = np.stack([xs, ys], 1).astype(np.float64)
    u = pts @ np.array([ax, ay]) - aph
    v = pts @ np.array([bx, by]) - bph
    lo = (int(np.floor(u.min())), int(np.floor(v.min())))
    hi = (int(np.ceil(u.max())), int(np.ceil(v.max())))

    polys = {}
    for n in range(lo[0], hi[0] + 1):
        for m in range(lo[1], hi[1] + 1):
            corners = [inv @ np.array([n + aph + du, m + bph + dv])
                       for du, dv in ((0, 0), (1, 0), (1, 1), (0, 1))]
            polys[(n, m)] = np.array(corners)
    return polys


def top_surface(body, skirt=SKIRT_PX):
    """Undo the isometric extrusion: the silhouette is the paving pushed down.

    Intersecting the body with itself shifted up by the skirt height recovers
    the paved deck: untouched along the north/east rim, where the deck edge IS
    the silhouette, and pulled in by the skirt along the south/west rim, where
    the rock below is what we can see.
    """
    up = np.zeros_like(body)
    up[:-skirt] = body[skirt:]
    return cv2.bitwise_and(body, up)


def keep_covered(polys, floor, face, body, min_cover):
    """Seed on confidently paved cells, then flood the rest of the deck.

    Decor and shadow hide the paving under a lot of tiles — the gatehouse, the
    lava basins, the crystal terrace — so paved evidence alone leaves holes and
    eats the eastern rim. Any cell that sits wholly on the deck and is not
    mostly rock face is eligible; the flood spreads through those from the
    confident seeds, which stops at cliffs instead of at shadows.
    """
    h, w = floor.shape
    cover = {}
    eligible = set()
    for key, poly in polys.items():
        p = np.round(poly).astype(np.int32)
        x0, y0 = p.min(0)
        x1, y1 = p.max(0)
        if x1 < 0 or y1 < 0 or x0 >= w or y0 >= h:
            continue
        cx0, cy0 = max(x0, 0), max(y0, 0)
        cx1, cy1 = min(x1 + 1, w), min(y1 + 1, h)
        if cx1 <= cx0 or cy1 <= cy0:
            continue
        stamp = np.zeros((cy1 - cy0, cx1 - cx0), np.uint8)
        cv2.fillConvexPoly(stamp, p - [cx0, cy0], 1)
        full = cv2.contourArea(p.astype(np.float32))
        if full <= 0:
            continue
        # a tile that hangs off the island silhouette is not a tile
        held = float((stamp & (body[cy0:cy1, cx0:cx1] > 0)).sum())
        if held / full < MIN_INSIDE:
            continue
        rock = float((stamp & (face[cy0:cy1, cx0:cx1] > 0)).sum()) / full
        if rock > 0.5:
            continue
        eligible.add(key)
        hit = float((stamp & (floor[cy0:cy1, cx0:cx1] > 0)).sum())
        cover[key] = hit / full

    live = {k for k, c in cover.items() if c >= min_cover}
    stack = list(live)
    while stack:
        n, m = stack.pop()
        for dn, dm in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            k = (n + dn, m + dm)
            if k in eligible and k not in live:
                live.add(k)
                stack.append(k)
    return [np.round(polys[k]).astype(np.int32) for k in sorted(live)]


def main():
    os.makedirs(OUT, exist_ok=True)
    img = cv2.imread(os.path.join(ROOT, 'assets/sprites/background/emberkeep.jpg'))
    h, w = img.shape[:2]

    cache = os.path.join(OUT, '.surface.npy')
    if os.path.exists(cache) and not os.environ.get('MAPMASK_RETRAIN'):
        cls = np.load(cache)
    else:
        cls = surface_mask(img)
        np.save(cache, cls)

    floor = (cls == 2).astype(np.uint8) * 255
    floor = cv2.morphologyEx(floor, cv2.MORPH_OPEN, kernel(15))
    floor = cv2.morphologyEx(floor, cv2.MORPH_CLOSE, kernel(25))
    face = (cls == 1).astype(np.uint8) * 255
    face = cv2.morphologyEx(face, cv2.MORPH_OPEN, kernel(21))
    # the grid only belongs on the playable islands we traced
    islands = cv2.imread(os.path.join(OUT, 'island-mask.png'), 0)
    floor = cv2.bitwise_and(floor, islands)
    cv2.imwrite(os.path.join(OUT, 'grid-floor.png'), floor)

    energy = seam_energy(img)
    n, lbl, stats, _ = cv2.connectedComponentsWithStats((islands > 0).astype(np.uint8), 8)

    regions = {}
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < 40000:
            continue
        r = (lbl == i) & (floor > 0)
        if r.sum() >= 6000:
            regions[i] = r
    if not regions:
        raise SystemExit('no paved region found')

    # One projection paints the whole scene, so solve the lattice once on the
    # island with the most paved surface, then re-phase it per island.
    anchor = max(regions, key=lambda i: regions[i].sum())
    freqs = frequencies(energy, regions[anchor])
    print(f'  lattice from island {anchor}: seam spacing '
          + ' / '.join(f'{1 / np.hypot(*f):.1f}' for f in freqs) + ' px')

    grid = np.zeros((h, w, 3), np.uint8)
    check = img.copy()
    total = 0
    for i, region in regions.items():
        lat = phase_fit(energy, region, freqs)
        own = (region * 255).astype(np.uint8)
        deck = top_surface((lbl == i).astype(np.uint8) * 255)
        cells = keep_covered(cell_polygons(lat, region), own, face, deck,
                             MIN_CELL_COVER)
        total += len(cells)
        print(f'  island {i}: {len(cells)} cells from {int(region.sum())} paved px')
        for p in cells:
            cv2.polylines(grid, [p], True, GRID_COLOR, STROKE, cv2.LINE_AA)
            cv2.polylines(check, [p], True, GRID_COLOR, 2, cv2.LINE_AA)

    cv2.imwrite(os.path.join(OUT, 'grid-trace.png'), grid)
    cv2.imwrite(os.path.join(OUT, 'grid-check.jpg'), check,
                [cv2.IMWRITE_JPEG_QUALITY, 88])
    print(f'{total} tiles -> {OUT}')


if __name__ == '__main__':
    main()
