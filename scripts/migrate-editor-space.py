#!/usr/bin/env python3
"""One-time migration of the editor project into the recalibrated world space.

    python3 scripts/migrate-editor-space.py <recal.json> [asset3d/editor-map.json]

WHY THIS EXISTS (2026-08-27). The authored isle's calibration in map.json was
measured long before the nb2-4k-aligned painting: its painted flagstones run
~249.5 world px per tile where the lattice insisted on 256, an error of up to
15 px that accumulates toward the isle's south rim — the drop reticle sat
visibly astride two painted tiles wherever no hand-drawn grid covered the
cell. The fix rescales the backdrop placement (tile 420x242 -> 409.23x243.96,
dx/dy re-solved) so the lattice lands ON the stones.

That changes where the painting renders, and every coordinate in the editor
project was authored in the OLD placement's world pixels — grids, placed
assets, drawn zones. Left alone they would all sit ~2.6% off the repainted
world, in the editor and in the game alike. This applies the same similarity
the painting underwent:

    p' = artOrigin_new + (p - artOrigin_old) * k

with k = unit_new/unit_old, to every world-pixel field, and scales every
world-pixel LENGTH (grid tile, asset scale) by k. Cell indices, allocations
and unlock levels are addresses, not pixels — untouched.

The parameters come from a recal.json written by the calibration fit, so this
script cannot drift from the map.json change it accompanies. Idempotence: the
project carries `spaceMigration` after a run and a second run with the same
tag refuses, because applying k twice would be exactly the corruption this
prevents.

After it: re-export (scripts/export-editor-worlds.mjs), rebuild
(scripts/build-zones.mjs + scripts/ingest-worlds.mjs), and RELOAD any open
editor tab before pressing Apply — an un-reloaded tab still holds old-space
coordinates and its Apply would write them back wholesale.
"""
import json
import sys

recal_path = sys.argv[1] if len(sys.argv) > 1 else None
proj_path = sys.argv[2] if len(sys.argv) > 2 else 'asset3d/editor-map.json'
if not recal_path:
    sys.exit('usage: migrate-editor-space.py <recal.json> [project.json]')

R = json.load(open(recal_path))
k = R['k']
ox0, oy0, ox1, oy1 = R['artOx0'], R['artOy0'], R['artOx1'], R['artOy1']
TAG = f'recal-{R["W1"]:.2f}x{R["H1"]:.2f}'


def T(x, y):
    return (ox1 + (x - ox0) * k, oy1 + (y - oy0) * k)


# Fresh read at the last moment — the live editor rewrites this file.
p = json.load(open(proj_path))
if p.get('spaceMigration') == TAG:
    sys.exit(f'already migrated ({TAG}) — refusing to apply k twice')

ng = na = nz = 0
for mid, grids in (p.get('grids') or {}).items():
    for g in grids:
        g['ox'], g['oy'] = T(g['ox'], g['oy'])
        g['tileW'] *= k
        g['tileH'] *= k
        ng += 1
for mid, assets in (p.get('assets') or {}).items():
    for a in assets:
        if 'wx' in a and 'wy' in a:
            a['wx'], a['wy'] = T(a['wx'], a['wy'])
        if isinstance(a.get('scale'), (int, float)):
            a['scale'] *= k
        na += 1
for mid, zones in (p.get('zones') or {}).items():
    for z in zones:
        for pt in z.get('points') or []:
            pt['x'], pt['y'] = T(pt['x'], pt['y'])
        nz += 1
p['spaceMigration'] = TAG

with open(proj_path, 'w') as f:
    json.dump(p, f)
print(f'migrated {ng} grids, {na} assets, {nz} zones by k={k:.5f} ({TAG})')
