#!/usr/bin/env python3
"""Cut the landmark decor sheets and the dragon reveal plates to alpha.

    python3 scripts/cut-reveal-and-decor.py decor
    python3 scripts/cut-reveal-and-decor.py reveal

Decor comes off multi-object sheets and is split on column gaps, the same way
every merge-chain sheet is. Reveals are one dragon per plate, so they only need
keying and trimming.

The key is MEASURED off each return, never assumed: a plate asked for #FF00FF
comes back at #FF2DF2 and friends, and keying on the nominal colour leaves a rim
the size of the feather.
"""
import argparse
import pathlib
import subprocess
import sys
from collections import Counter

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEKEY = ROOT / '.claude/skills/nano-banana/scripts/dekey.py'
RAW = ROOT / 'assets/raw'
ALPHA_GAP = 140
PAD = 6

#: Longest side each landmark is resampled to. They are BIG props — the shipped
#: ornament set lands its plinth at ~250 units (just under one tile) and reads
#: as tabletop scale; a monument has to clear the dragon standing next to it,
#: so these are authored ~2-3x that and scaled down on the board by DECOR_SCALE.
DECOR_LONG_SIDE = 900
#: The reveal plate's on-screen height is set by the overlay, so the texture
#: only has to be big enough for the tallest it is ever drawn (~1180 units) with
#: a little headroom, and small enough to stay inside the old-device budget.
REVEAL_LONG_SIDE = 1400

SHEETS = {
    'landmarks_a': ['keeper_statue', 'PLACEHOLDER', 'ember_beacon'],
    'landmarks_b': ['elder_bones', 'tethered_isle'],
}
SINGLES = ['broken_arch']
REVEALS = ['ember', 'ember_adult', 'emerald', 'emerald_adult', 'golden', 'golden_adult',
           'frost', 'frost_adult', 'storm', 'storm_adult', 'moonwhisker', 'moonwhisker_adult']


def measured_key(path: pathlib.Path) -> str:
    im = Image.open(path).convert('RGB').resize((256, 256))
    r, g, b = Counter(im.getdata()).most_common(1)[0][0]
    return f'{r:02X}{g:02X}{b:02X}'


def dekey(src: pathlib.Path, dst: pathlib.Path) -> Image.Image:
    r = subprocess.run(['python3', str(DEKEY), str(src), str(dst), '--key', measured_key(src)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(r.stderr)
    return Image.open(dst).convert('RGBA')


def column_runs(im: Image.Image) -> list:
    solid = (np.array(im)[..., 3].max(axis=0) >= ALPHA_GAP)
    runs, start = [], None
    for x, on in enumerate(solid):
        if on and start is None:
            start = x
        elif not on and start is not None:
            runs.append((start, x))
            start = None
    if start is not None:
        runs.append((start, len(solid)))
    return [r for r in runs if r[1] - r[0] > 40]


def trim(cell: Image.Image, long_side: int) -> Image.Image:
    bb = cell.getbbox()
    cell = cell.crop((max(0, bb[0] - PAD), max(0, bb[1] - PAD),
                      min(cell.width, bb[2] + PAD), min(cell.height, bb[3] + PAD)))
    s = long_side / max(cell.size)
    if s < 1:
        cell = cell.resize((max(1, round(cell.width * s)), max(1, round(cell.height * s))),
                           Image.LANCZOS)
    return cell


def do_decor() -> None:
    work = RAW / 'decor-sets' / 'landmarks'
    out = ROOT / 'assets/sprites/environment/map/decor'
    for sheet, names in SHEETS.items():
        keyed = dekey(work / f'{sheet}-seedream-pro.jpg', work / f'{sheet}-keyed.png')
        runs = column_runs(keyed)
        wanted = [n for n in names if n != 'PLACEHOLDER']
        if len(runs) != len(names):
            print(f'  ! {sheet}: {len(runs)} objects for {len(names)} slots — '
                  f'taking the widest {len(names)}')
            runs = sorted(sorted(runs, key=lambda r: r[1] - r[0])[-len(names):])
        for name, (x0, x1) in zip(names, runs):
            if name == 'PLACEHOLDER':
                continue
            art = trim(keyed.crop((x0, 0, x1, keyed.height)), DECOR_LONG_SIDE)
            art.save(out / f'{name}.webp', 'WEBP', quality=94, method=6)
            art.save(work / f'{name}.png')
            print(f'  {name:<16s} {art.size}')
        assert all(n in names for n in wanted)
    for name in SINGLES:
        keyed = dekey(work / f'{name}-seedream-pro.jpg', work / f'{name}-keyed.png')
        art = trim(keyed, DECOR_LONG_SIDE)
        art.save(out / f'{name}.webp', 'WEBP', quality=94, method=6)
        art.save(work / f'{name}.png')
        print(f'  {name:<16s} {art.size}')


def do_reveal() -> None:
    work = RAW / 'dragons' / 'reveals'
    out = ROOT / 'assets/sprites/characters/dragon/reveals'
    out.mkdir(parents=True, exist_ok=True)
    for name in REVEALS:
        keyed = dekey(work / f'{name}-raw.jpg', work / f'{name}-keyed.png')
        art = trim(keyed, REVEAL_LONG_SIDE)
        art.save(out / f'{name}.webp', 'WEBP', quality=92, method=6)
        cover = (np.array(art)[..., 3] > 16).mean()
        print(f'  reveal_{name:<20s} {str(art.size):<12s} alpha {cover:.3f}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('what', choices=['decor', 'reveal', 'all'])
    a = ap.parse_args()
    if a.what in ('decor', 'all'):
        do_decor()
    if a.what in ('reveal', 'all'):
        do_reveal()
