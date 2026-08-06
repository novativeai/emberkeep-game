#!/usr/bin/env python3
"""Contact sheet of every asset the cosmetics shop sells a skin OF.

  shop-inventory.py out.png

The shop concept is re-skins, not new content, so the model has to be looking
at the actual game art or it designs a different game. This lays the real files
out in labelled groups — buildings, hub decor, the three dragon breeds, the two
keepers — on the game's own plumShade/night background so the palette is in frame too.

The golden dragon is the one subject with no baked composite: it ships as rig
parts. `compose_golden` lays the big pieces out by hand, which is enough to read
its colour and shape as a reference (the rig itself is what the game animates).
`sprite-sunset` is included deliberately — it is an existing recolour of the
golden dragon, i.e. the game already has a skin precedent to design against.
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))))
D = os.path.join(ROOT, 'assets/sprites')
CELL = (360, 360)
NIGHT, PLUMSHADE, GOLDACCENT, CREAM = (36, 27, 34), (58, 43, 56), (255, 216, 77), (255, 246, 232)


def load(rel, box=CELL):
    im = Image.open(os.path.join(D, rel)).convert('RGBA')
    im.thumbnail(box, Image.LANCZOS)
    return im


def compose_golden(folder, box=CELL):
    parts = [('bodyTail', (120, 150)), ('leftWing', (10, 60)), ('rightWing', (250, 60)),
             ('head', (150, 40)), ('leftHand', (110, 300)), ('rightHand', (300, 300))]
    canvas = Image.new('RGBA', (560, 560), (0, 0, 0, 0))
    for name, pos in parts:
        p = os.path.join(D, f'characters/dragon/golden-dragon/{folder}/golden-dragon-{name}.png')
        if os.path.exists(p):
            layer = Image.open(p).convert('RGBA')
            layer.thumbnail((330, 330), Image.LANCZOS)
            canvas.alpha_composite(layer, pos)
    canvas.thumbnail(box, Image.LANCZOS)
    return canvas


def font(size):
    for f in ('/System/Library/Fonts/Supplemental/Trebuchet MS Bold.ttf',
              '/System/Library/Fonts/Supplemental/Arial Bold.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else 'asset-inventory.png'
    rows = [
        ('BUILDINGS  ·  what a "house skin" replaces', [
            ('Cottage (house.png)', load('items/house.png')),
            ('Manor (manor.png)', load('items/manor.png')),
        ]),
        ('HUB DECOR  ·  what a "decor pack" adds', [
            ('Big tree', load('items/bigtree.png')),
            ('Crystal', load('items/crystal.png')),
            ('Rose', load('environment/map/decor/rose_2.png')),
            ('Plant', load('environment/map/decor/plant_1.png')),
            ('Flower', load('environment/map/decor/flower_1.png')),
        ]),
        ('DRAGONS  ·  three breeds, each needs its own skin line', [
            ('Red (adult)', load('characters/dragon/red-dragon/sprite-adult/red-dragon-adult-baked.png')),
            ('Emerald (adult)', load('characters/dragon/emerald-dragon/sprite-adult/emerald-dragon-adult-baked.png')),
            ('Golden (parts)', compose_golden('sprite-adult')),
            ('Golden SUNSET — an existing recolour skin', compose_golden('sprite-sunset')),
        ]),
        ('CHARACTERS  ·  Eleanor and Selyna', [
            ('Eleanor', load('characters/eleanor/eleanor-portrait.png')),
            ('Selyna', load('characters/selyna/selyna-portrait.png')),
        ]),
    ]

    pad, hdr, lbl = 24, 46, 26
    w = pad + max(len(r[1]) for r in rows) * (CELL[0] + pad)
    h = pad + sum(hdr + CELL[1] + lbl + pad for _ in rows)
    sheet = Image.new('RGB', (w, h), NIGHT)
    d = ImageDraw.Draw(sheet)
    fh, fl = font(30), font(21)

    y = pad
    for title, cells in rows:
        d.text((pad, y + 6), title, fill=GOLDACCENT, font=fh)
        y += hdr
        x = pad
        for label, im in cells:
            d.rectangle([x, y, x + CELL[0], y + CELL[1]], fill=PLUMSHADE)
            sheet.paste(im, (x + (CELL[0] - im.width) // 2, y + (CELL[1] - im.height) // 2), im)
            d.text((x + 6, y + CELL[1] + 4), label, fill=CREAM, font=fl)
            x += CELL[0] + pad
        y += CELL[1] + lbl + pad

    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    sheet.save(out)
    print(f'  {out} ({sheet.width}x{sheet.height})')


if __name__ == '__main__':
    main()
