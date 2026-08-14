#!/usr/bin/env python3
"""Dragon eggs for the store breeds — frost and storm, tier 1 of their chains.

    python3 scripts/gen-dragon-eggs.py gen
    python3 scripts/gen-dragon-eggs.py cut
    python3 scripts/gen-dragon-eggs.py gen --only frost

One egg per plate (not a 3-across sheet — an egg chain has ONE tier-1 shape),
style-referenced on the SHIPPED egg family (red, green, ashdrake, rimewyrm)
so the two new eggs read as siblings of the four already on the board. The
house style blocks come from merge_style; only the LAYOUT block is swapped
for a single-object one.

Output convention matches the family: ~1160x1440 canvas, ITEM_SCALE 0.064,
anchor [0.5, 1.0] — the numbers item_ashdrake_1 already ships with.
"""
import argparse
import pathlib
import subprocess
import sys

from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from merge_style import HEAD, TAIL_MAGENTA, dekey  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
ARTGEN = ROOT / '.claude/skills/nano-banana/scripts/artgen.py'
WORK = ROOT / 'assets/raw/dragons/eggs'
OUT = ROOT / 'assets/sprites/items'
FAMILY = ['red-egg.webp', 'green-egg.webp', 'ashdrake-egg.webp', 'rimewyrm-egg.webp']
TARGET_H = 1440  # the family's canvas height (red-egg is 1162x1437)

#: merge_style's LAYOUT block is 3-across; an egg is one object.
SINGLE_LAYOUT = (
    'LAYOUT — exactly ONE single object, centered, filling about half the frame height, with a '
    'generous empty margin on every side. Nothing is cropped by any edge. A SOLID COMPACT '
    'egg shape standing upright, very slightly narrower at the top.\n\n'
)

EGGS = {
    'frost': (
        'A FROST DRAGON EGG for a cozy fantasy merge game. The egg of an ice dragon: pale '
        'glacier blue-white shell with a soft inner glow of cold cyan light, chunky rounded '
        'crystalline facets across its lower half like grown frost, a delicate branching '
        'frost-fern pattern etched faintly across the upper shell, and a thin rim of icy '
        'crystals around its base where it has frozen to the ground. One crisp white specular '
        'highlight upper-left.\n\n'
        'PALETTE — glacier blue-white #DCEFF7 into pale ice blue #9CCFE6, cold cyan glow '
        '#5FD8E8 from within, deep blue-teal #2E6E86 in the shadow side, near-black outline.'
    ),
    'storm': (
        'A STORM DRAGON EGG for a cozy fantasy merge game. The egg of a storm dragon: deep '
        'slate blue-grey shell like a thundercloud, a single jagged gold lightning-vein '
        'branching down from the crown and glowing from inside, small round gold sparks '
        'caught under the shell surface, and a faint band of paler storm-grey swirling around '
        'its middle like moving cloud. One crisp white specular highlight upper-left.\n\n'
        'PALETTE — deep slate #3A4456 into storm blue-grey #5C6C84, glowing lightning gold '
        '#FFD84D into #F7A437, a whisper of pale cloud #B8C4D4 in the swirl band, near-black '
        'outline.'
    ),
}


def style_plate() -> str:
    """Image 1 — the four shipped eggs flattened onto magenta."""
    from PIL import Image as I
    pieces = [I.open(ROOT / 'assets/sprites/items' / f).convert('RGBA') for f in FAMILY]
    h = 720
    pieces = [p.resize((max(1, round(p.width * h / p.height)), h), I.LANCZOS) for p in pieces]
    pad = 100
    w = sum(p.width for p in pieces) + pad * (len(pieces) + 1)
    plate = I.new('RGB', (w, h + pad * 2), (255, 0, 255))
    x = pad
    for p in pieces:
        plate.paste(p, (x, pad), p)
        x += p.width + pad
    WORK.mkdir(parents=True, exist_ok=True)
    out = WORK / 'egg-family-ref.png'
    plate.save(out)
    return str(out)


def do_gen(only: set) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    ref = style_plate()
    for name, brief in EGGS.items():
        if only and name not in only:
            continue
        prompt = HEAD.replace(
            HEAD.split('LAYOUT — ')[1].split('\n\n')[0] + '\n\n', ''
        )  # drop the 3-across layout block…
        prompt = prompt.replace('CAMERA — ', SINGLE_LAYOUT + 'CAMERA — ')  # …insert the single one
        prompt += brief + TAIL_MAGENTA
        (WORK / f'{name}-egg-prompt.txt').write_text(prompt + '\n')
        out = WORK / f'{name}-egg-raw.jpg'
        print(f'-> {out.relative_to(ROOT)}', flush=True)
        r = subprocess.run(
            ['python3', str(ARTGEN), 'character', prompt, '-i', ref,
             '--size', '1152x1536', '-o', str(out)],
            capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout[-1500:] + r.stderr[-1500:])
            sys.exit(f'{name} failed')


def do_cut(only: set) -> None:
    for name in EGGS:
        if only and name not in only:
            continue
        keyed = dekey(WORK / f'{name}-egg-raw.jpg', WORK / f'{name}-egg-keyed.png')
        bb = keyed.getbbox()
        art = keyed.crop(bb)
        s = TARGET_H / art.height
        art = art.resize((max(1, round(art.width * s)), TARGET_H), Image.LANCZOS)
        art.save(OUT / f'{name}-egg.png')
        art.save(OUT / f'{name}-egg.webp', 'WEBP', quality=94, method=6)
        print(f'  {name}-egg {art.size}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('what', choices=['gen', 'cut'])
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    sel = {s for s in a.only.split(',') if s}
    (do_gen if a.what == 'gen' else do_cut)(sel)
