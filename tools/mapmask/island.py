#!/usr/bin/env python3
"""Build a map mask from HAND-DRAWN island shapes (world builder 🏝 page).

`design.py` authors islands as lattice rects/bands. This runs from the other
end: you draw the deck outline you want, and the lattice is FITTED into it.
Everything downstream — the rock skirt, the lip, the rounding — is the same
border law `design.py` uses, so a drawn island and an authored one are the same
kind of object.

Three steps per shape:

 1. FIT. The drawn polygon is the DECK — the paved top surface, not the whole
    island. Eroding it by one tile diamond gives every point where a tile fits
    whole; the lattice origin is then grid-searched over its fundamental domain
    (ox in [0,tileW), oy in [0,tileH), lattice points at i+j even) and scored
    lexicographically: most tiles first, then HUG RIGHT — furthest-right tile
    corner, then rightward mass. Right-hugging is not cosmetic: the skirt is
    shallow under a south-east rim (see below), so slack on that side shows as
    a bare strip of rock, while slack on the left is hidden under the curtain.

 2. PRUNE. A drawn coastline throws off 1-2 cell spurs no tile row can use.
    The same iterative sliver prune as `design.py`: drop any cell in a run
    shorter than `minRun`, repeat until stable.

 3. EXTRUDE. `silhouette()` is `design.py`'s border law, parameterised on the
    lattice instead of reading module globals: the deck hangs straight down as
    a two-octave rock curtain — deep under a south-west facing rim, shallower
    but never flat under a south-east one, split by sweeping the deck along its
    own SE tile edge — then lip, organic rim displacement and rounding.

The deck the caller drew and the deck that comes back are NOT identical: the
lattice can only fill the drawn shape with whole tiles, and the prune shaves
slivers. The drawn shape guides; the border law governs. `stats.fill` reports
how much of the drawing the tiles actually claimed.

    python3 tools/mapmask/island.py --stdin < spec.json   # JSON in, JSON out
    python3 tools/mapmask/island.py --spec spec.json -o out/

Spec: {canvas:[w,h], tileW, tileH, minRun, dropSW, dropSE, seed,
       shapes:[{id,label,points:[[x,y],...]}, ...]}
`dropSW`/`dropSE` are multiples of tileH. Points are in canvas pixels.
"""
import argparse
import base64
import json
import math
import os
import sys

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from design import curtain, disk, runs, sweep  # noqa: E402  (border-law primitives)

DEFAULTS = {
    'canvas': [2610, 1632],   # the backdrop size — what the game ships
    'tileW': 138, 'tileH': 80,
    'minRun': 3,
    # x tileH. Raised from 1.35/0.65: at the old depth the rock band read as
    # a lip rather than a cliff, and the models rendered thin floating slabs.
    'dropSW': 2.7, 'dropSE': 1.6,
    'seed': 7,
}
DEPTH_MIN = 0.60          # skirt floor — no stretch of rim comes out flat
GRID_COLOR = (255, 140, 0)  # BGR — blue, as design.py
STROKE = 3
OFFSET_STEPS = 24         # lattice-origin search resolution per axis


class Lattice:
    """Tile metrics plus every constant design.py derives from them."""

    def __init__(self, tile_w, tile_h, drop_sw, drop_se):
        self.w, self.h = float(tile_w), float(tile_h)
        self.inboard = (-2 * int(tile_w), 2 * int(tile_h))
        self.drop_sw = round(drop_sw * tile_h)
        self.drop_se = round(drop_se * tile_h)
        self.lip = max(1, round(0.10 * tile_h))
        self.noise_amp = max(1, round(0.17 * tile_h))
        self.noise_sigma = max(1, round(0.30 * tile_h))
        # Rounding is what sands the rock-course detail back off. Measured
        # against real island silhouettes (see depth_profile), the old
        # 0.33/0.15 closing pair removed most of the mid-scale energy the
        # skirt is supposed to carry, so both are pulled in.
        self.close_r = max(1, round(0.20 * tile_h))
        self.open_r = max(1, round(0.08 * tile_h))
        self.lobe_sigma = 1.5 * tile_w
        self.chunk_sigma = 0.50 * tile_w
        self.chip_sigma = 0.12 * tile_w
        self.terrace = max(2.0, 0.34 * tile_h)   # median rock-course thickness, px

    def kernel(self):
        """A tile diamond as a structuring element, centred on its middle."""
        hw, hh = int(self.w // 2), int(self.h // 2)
        k = np.zeros((2 * hh + 1, 2 * hw + 1), np.uint8)
        cv2.fillConvexPoly(k, np.array([[hw, 0], [2 * hw, hh],
                                        [hw, 2 * hh], [0, hh]], np.int32), 1)
        return k

    def poly(self, cx, cy):
        return np.array([[cx, cy - self.h / 2], [cx + self.w / 2, cy],
                         [cx, cy + self.h / 2], [cx - self.w / 2, cy]])


def depth_profile(rng, width, peak, lat):
    """Per-column skirt depth — a TERRACED rock face, not a rolling wave.

    Measured against the matted silhouettes of real islands (the shipped
    emberkeep backdrop and the rendered zones, `assets/raw/map-gen/extract/`),
    two things separated authored masks from real rock:

    1. SPECTRUM. Real skirts carry noticeably more energy at rock-course scale.
       Sampling the bottom profile's roughness at 0.004/0.008/0.016/0.032/0.064
       of island width, real islands ran 0.010/0.015/0.022/0.032/0.046 (of
       island height) against 0.010/0.015/0.020/0.028/0.041 for the old
       two-octave field — a 15-30% deficit concentrated in the MIDDLE of the
       band. Hence a third octave and a mix weighted off the broad lobes.

    2. SHAPE. Plotted side by side, a real profile is a STAIRCASE — flat
       terraces broken by abrupt near-vertical risers, the courses of rock you
       can count on the cliff face — while a Gaussian field is a smooth
       continuous undulation with no flat stretch anywhere. Quantising the
       field to `lat.terrace` reproduces that: the plateaus fall out of the
       quantiser and the risers land where the underlying field crosses a
       level, so their spacing stays irregular. A 1px blur takes the aliasing
       off the riser without rounding it back into a curve.
    """
    def octave(sigma):
        n = gaussian_filter(rng.standard_normal(width).astype(np.float32), sigma)
        return (n - n.min()) / (np.ptp(n) + 1e-6)
    n = (0.50 * octave(lat.lobe_sigma)
         + 0.35 * octave(lat.chunk_sigma)
         + 0.15 * octave(lat.chip_sigma))
    n = (n - n.min()) / (np.ptp(n) + 1e-6)
    depth = peak * (DEPTH_MIN + (1 - DEPTH_MIN) * n)
    stepped = np.round(depth / lat.terrace) * lat.terrace
    return gaussian_filter(stepped.astype(np.float32), 1.0)


def rim_noise(rng, shape, sigma, amp):
    """The organic rim displacement field.

    design.py smooths white noise at full resolution; at 4 MP that one call is
    two thirds of the build. Since sigma is ~24 px there is nothing in the field
    finer than the quarter-scale grid anyway, so it is generated small and
    resampled up — same field, a fifteenth of the cost.
    """
    h, w = shape
    q = 4
    small = gaussian_filter(
        rng.standard_normal((max(2, h // q), max(2, w // q))).astype(np.float32),
        max(0.8, sigma / q))
    field = cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)
    return field * (amp / (field.std() + 1e-6))


def terrace_bottom(body, deck, rng, lat):
    """Cut the finished underside into rock COURSES — flat runs, sharp risers.

    Quantising the depth field before `curtain` does not survive: the closing
    that rounds the silhouette (a disk the size of a rock course) sands every
    riser back into a curve, which is why the old masks read as one soft blob
    hanging under the deck. So the staircase is imposed last, on the bottom
    boundary itself.

    Per column, the lowest body pixel is snapped to a multiple of
    `lat.terrace`. Where the underside is slowly varying that yields a long
    flat run; where it falls away steeply the levels come thick and fast and
    you get a tight flight of steps — the same distribution real cliffs show,
    without anyone choosing where a step goes. A little correlated jitter keeps
    the runs from reading as dead-flat CAD lines, and nothing is ever cut above
    the deck, so the playable surface is untouched.
    """
    h, w = body.shape
    cols = np.nonzero(body.any(0))[0]
    if not len(cols):
        return body
    # Strata of UNEVEN thickness. A uniform ladder gives every riser the same
    # height, which reads as machined steps; measured on real islands the
    # risers run from 0.04 to 0.24 of island height, so the courses are drawn
    # from 0.6-1.9 terraces and the ladder is walked cumulatively.
    levels, y = [], 0.0
    while y < h + lat.terrace:
        levels.append(y)
        y += lat.terrace * rng.uniform(0.6, 1.9)
    levels = np.array(levels)
    # A little correlated jitter so a run is not a dead-flat CAD line.
    jitter = gaussian_filter(rng.standard_normal(w).astype(np.float32), 2.0)
    jitter *= (0.16 * lat.terrace) / (jitter.std() + 1e-6)
    bots = np.full(w, -1, np.int32)
    floors = np.zeros(w, np.int32)
    for x in cols:
        ys = np.nonzero(body[:, x])[0]
        if not len(ys):
            continue
        bots[x] = ys[-1]
        ds = np.nonzero(deck[:, x])[0]
        floors[x] = (ds[-1] + lat.lip) if len(ds) else ys[0]  # never cut into the deck

    snapped = bots.astype(np.float32).copy()
    live = bots >= 0
    idx = np.abs(levels[None, :] - (bots[live] + jitter[live])[:, None]).argmin(1)
    snapped[live] = levels[idx]
    # Clamp to the deck floor BEFORE smoothing — clamping afterwards puts a
    # one-column spike back into an otherwise clean run.
    snapped[live] = np.maximum(snapped[live], floors[live])
    # Snapping column by column lets a single column flip to a neighbouring
    # course, which shows up as a 1px spike no cliff has. A median filter one
    # eighth of a tile wide is enough to enforce a minimum run on every course
    # while leaving genuine risers — which are many columns wide — untouched.
    run = int(max(3, lat.w * 0.12)) | 1
    smoothed = snapped.copy()
    if live.sum() > run:
        pad = run // 2
        seq = np.pad(snapped[live], pad, mode='edge')
        smoothed[live] = np.median(np.lib.stride_tricks.sliding_window_view(seq, run), axis=1)

    out = body.copy()
    for x in cols:
        if bots[x] < 0:
            continue
        bot = int(bots[x])
        stepped = int(min(h - 1, smoothed[x]))
        if stepped > bot:
            out[bot:stepped + 1, x] = 255
        elif stepped < bot:
            out[stepped + 1:bot + 1, x] = 0
    return out


def silhouette(deck, rng, lat):
    """design.py's border law: deck, extruded by the skirt, rounded, roughened."""
    core = cv2.dilate(deck, disk(lat.lip))              # containment guarantee
    inboard = np.maximum(deck, sweep(deck, lat.inboard))  # everything down-left of the SW rim
    w = deck.shape[1]
    body = np.maximum(
        cv2.bitwise_and(curtain(deck, depth_profile(rng, w, lat.drop_sw, lat)), inboard),
        curtain(deck, depth_profile(rng, w, lat.drop_se, lat)))
    body = cv2.dilate(np.maximum(body, deck), disk(lat.lip))

    inv = cv2.bitwise_not(body)
    sdf = (cv2.distanceTransform(inv, cv2.DIST_L2, 5)
           - cv2.distanceTransform(body, cv2.DIST_L2, 5))
    field = rim_noise(rng, body.shape, lat.noise_sigma, lat.noise_amp)
    body = ((sdf < field).astype(np.uint8) * 255)
    body = np.maximum(body, core)

    body = cv2.morphologyEx(body, cv2.MORPH_CLOSE, disk(lat.close_r))
    body = cv2.morphologyEx(body, cv2.MORPH_OPEN, disk(lat.open_r))
    body = np.maximum(body, core)
    holes = np.zeros((body.shape[0] + 2, body.shape[1] + 2), np.uint8)
    flood = body.copy()
    cv2.floodFill(flood, holes, (0, 0), 255)
    body = np.maximum(body, cv2.bitwise_not(flood))
    return terrace_bottom(body, deck, rng, lat)


def fit_lattice(want, lat):
    """Best lattice origin for a drawn deck: most tiles, then hugging right.

    `want` is the drawn polygon rasterised. Eroding it by the tile diamond
    yields exactly the points where a whole tile fits, so scoring an origin is
    a lookup rather than a rasterisation.
    """
    inner = cv2.erode(want, lat.kernel())
    h, w = want.shape
    hx, hy = lat.w / 2.0, lat.h / 2.0
    # Lattice points are (ox + i*hx, oy + j*hy) with i+j even — the iso checker.
    ii = np.arange(-1, int(w / hx) + 2)
    jj = np.arange(-1, int(h / hy) + 2)
    I, J = np.meshgrid(ii, jj, indexing='ij')
    keep = (I + J) % 2 == 0
    I, J = I[keep], J[keep]

    best = None
    for oxi in range(OFFSET_STEPS):
        ox = oxi * lat.w / OFFSET_STEPS
        for oyi in range(OFFSET_STEPS):
            oy = oyi * lat.h / OFFSET_STEPS
            cx = ox + I * hx
            cy = oy + J * hy
            xi, yi = np.round(cx).astype(int), np.round(cy).astype(int)
            ok = (xi >= 0) & (xi < w) & (yi >= 0) & (yi < h)
            if not ok.any():
                continue
            hit = ok.copy()
            hit[ok] = inner[yi[ok], xi[ok]] > 0
            n = int(hit.sum())
            if n == 0:
                continue
            # lexicographic: count, then right-hug (furthest corner, then mass)
            score = (n, float(cx[hit].max() + hx), float(cx[hit].sum()))
            if best is None or score > best[0]:
                # (n, m) lattice indices back out of (i, j): i = n-m, j = n+m
                cells = {((int(a) + int(b)) // 2, (int(b) - int(a)) // 2)
                         for a, b in zip(I[hit], J[hit])}
                best = (score, (ox, oy), cells)
    if best is None:
        return (0.0, 0.0), set()
    return best[1], best[2]


def prune(cells, min_run):
    """Drop every cell sitting in a lattice run shorter than min_run."""
    cells = set(cells)
    while cells:
        drop = set()
        for axis in (0, 1):
            lines = {}
            for n, m in cells:
                key, val = (n, m) if axis == 0 else (m, n)
                lines.setdefault(key, []).append(val)
            for key, vals in lines.items():
                vals = sorted(vals)
                run = [vals[0]]
                for a, b in zip(vals, vals[1:]):
                    if b == a + 1:
                        run.append(b)
                    else:
                        if len(run) < min_run:
                            drop |= {(key, v) if axis == 0 else (v, key) for v in run}
                        run = [b]
                if len(run) < min_run:
                    drop |= {(key, v) if axis == 0 else (v, key) for v in run}
        if not drop:
            break
        cells -= drop
    return cells


def margins(body, deck):
    """Median rim margins: sideways left/right, then the drop below each half."""
    left, right = [], []
    for y in range(body.shape[0]):
        d = np.nonzero(deck[y])[0]
        b = np.nonzero(body[y])[0]
        if len(d) and len(b):
            left.append(d[0] - b[0])
            right.append(b[-1] - d[-1])
    cols = np.nonzero(deck.any(0))[0]
    mid = (cols[0] + cols[-1]) / 2 if len(cols) else 0
    drop = {'l': [], 'r': []}
    for x in cols:
        d = np.nonzero(deck[:, x])[0]
        b = np.nonzero(body[:, x])[0]
        if len(d) and len(b):
            drop['l' if x < mid else 'r'].append(b[-1] - d[-1])
    med = lambda v: int(np.median(v)) if len(v) else 0
    return med(left), med(right), med(drop['l']), med(drop['r'])


def png_b64(img):
    ok, buf = cv2.imencode('.png', img)
    if not ok:
        raise RuntimeError('PNG encode failed')
    return 'data:image/png;base64,' + base64.b64encode(buf.tobytes()).decode()


def build(spec):
    """Drawn shapes -> mask / grid / combined + per-island stats."""
    p = {**DEFAULTS, **{k: v for k, v in spec.items() if v is not None}}
    w, h = int(p['canvas'][0]), int(p['canvas'][1])
    lat = Lattice(p['tileW'], p['tileH'], p['dropSW'], p['dropSE'])
    min_run = max(1, int(p['minRun']))
    rng = np.random.default_rng(int(p['seed']))

    mask = np.zeros((h, w), np.uint8)
    grid = np.zeros((h, w, 3), np.uint8)
    decks = np.zeros((h, w), np.uint8)
    bodies, out_islands, warnings = {}, [], []

    shapes = [s for s in spec.get('shapes', []) if len(s.get('points', [])) >= 3]
    if not shapes:
        raise ValueError('draw at least one shape (3+ points)')

    for idx, shape in enumerate(shapes):
        sid = shape.get('id') or f'island{idx + 1}'
        pts = np.array(shape['points'], np.float64)
        want = np.zeros((h, w), np.uint8)
        cv2.fillPoly(want, [np.round(pts).astype(np.int32)], 255)
        drawn_px = int((want > 0).sum())
        if drawn_px == 0:
            warnings.append(f'{sid}: the drawn shape is empty')
            continue

        (ox, oy), cells = fit_lattice(want, lat)
        run_floor = min(min_run, shape.get('minRun', min_run))
        cells = prune(cells, run_floor)
        if not cells:
            warnings.append(
                f'{sid}: no {run_floor}-cell run fits — draw it bigger, '
                f'shrink the tile, or lower the minimum run')
            continue

        deck = np.zeros((h, w), np.uint8)
        polys = []
        for n, m in cells:
            cx = ox + (n - m) * lat.w / 2.0
            cy = oy + (n + m) * lat.h / 2.0
            poly = lat.poly(cx, cy)
            polys.append(poly)
            cv2.fillConvexPoly(deck, np.round(poly).astype(np.int32), 255)
        body = silhouette(deck, rng, lat)
        bodies[sid] = body

        mask = np.maximum(mask, body)
        decks = np.maximum(decks, deck)
        for poly in polys:
            cv2.polylines(grid, [np.round(poly).astype(np.int32)], True,
                          GRID_COLOR, STROKE, cv2.LINE_AA)

        ml, mr, dl, dr = margins(body, deck)
        rows, cols = runs(cells, 1), runs(cells, 0)
        ys, xs = np.nonzero(body)
        out_islands.append({
            'id': sid,
            'label': shape.get('label', ''),
            'tiles': len(cells),
            'longestRow': max(rows) if rows else 0,
            'longestCol': max(cols) if cols else 0,
            'rows': len({n + m for n, m in cells}),
            # how much of the drawing the whole tiles actually claimed
            'fill': round(float((deck > 0).sum()) / drawn_px, 3),
            'origin': [round(ox, 2), round(oy, 2)],
            'bbox': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
            'margins': {'left': ml, 'right': mr, 'dropLeft': dl, 'dropRight': dr},
            'cells': sorted(cells),
        })

    if not out_islands:
        raise ValueError('; '.join(warnings) or 'nothing fitted')

    ids = list(bodies)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            if np.any(cv2.bitwise_and(bodies[a], bodies[b])):
                warnings.append(f'{a} and {b} overlap — the models will read them as one island')
            else:
                far = cv2.distanceTransform(cv2.bitwise_not(bodies[a]), cv2.DIST_L2, 5)
                gap = int(far[bodies[b] > 0].min())
                if gap < 40:
                    warnings.append(f'{a}/{b} sit only {gap}px apart — leave open sky between them')

    combined = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
    lit = grid.any(-1) > 0
    combined[lit] = grid[lit]
    return {
        'combined': combined, 'mask': mask, 'grid': grid, 'deck': decks,
        'islands': out_islands, 'warnings': warnings,
        'lattice': {'tileW': lat.w, 'tileH': lat.h,
                    'dropSW': lat.drop_sw, 'dropSE': lat.drop_se, 'lip': lat.lip},
        'canvas': [w, h],
        'totalTiles': sum(i['tiles'] for i in out_islands),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--spec')
    ap.add_argument('--stdin', action='store_true')
    ap.add_argument('-o', '--out', help='directory for island-*.png (CLI mode)')
    args = ap.parse_args()

    if args.stdin:
        spec = json.load(sys.stdin)
    elif args.spec:
        with open(args.spec) as fh:
            spec = json.load(fh)
    else:
        ap.error('need --stdin or --spec')

    try:
        res = build(spec)
    except Exception as e:                                  # noqa: BLE001
        if args.stdin:
            json.dump({'ok': False, 'error': str(e)}, sys.stdout)
            return
        raise

    if args.stdin:
        json.dump({
            'ok': True,
            'combined': png_b64(res['combined']),
            'mask': png_b64(res['mask']),
            'grid': png_b64(res['grid']),
            'deck': png_b64(res['deck']),
            'islands': res['islands'], 'warnings': res['warnings'],
            'lattice': res['lattice'], 'canvas': res['canvas'],
            'totalTiles': res['totalTiles'],
        }, sys.stdout)
        return

    out = args.out or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
    os.makedirs(out, exist_ok=True)
    cv2.imwrite(os.path.join(out, 'island-mask.png'), res['mask'])
    cv2.imwrite(os.path.join(out, 'island-grid.png'), res['grid'])
    cv2.imwrite(os.path.join(out, 'island-map-mask.png'), res['combined'])
    with open(os.path.join(out, 'island-layout.json'), 'w') as fh:
        json.dump({'imageSize': res['canvas'], 'lattice': res['lattice'],
                   'islands': res['islands']}, fh, indent=2)
    for i in res['islands']:
        m = i['margins']
        print(f"  {i['id']:10s} {i['tiles']:3d} tiles  longest row {i['longestRow']:2d}  "
              f"fill {i['fill']:.0%}  side L{m['left']:3d} R{m['right']:3d}  "
              f"drop L{m['dropLeft']:3d} R{m['dropRight']:3d}")
    for warn in res['warnings']:
        print(f'  ! {warn}')
    print(f"{res['totalTiles']} tiles, {len(res['islands'])} islands -> {out}/island-map-mask.png")


if __name__ == '__main__':
    main()
