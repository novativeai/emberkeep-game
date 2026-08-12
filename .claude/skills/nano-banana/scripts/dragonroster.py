#!/usr/bin/env python3
"""Every dragon rig on disk as ONE contact sheet: assembled colour over pure
silhouette. The acceptance test for a new breed.

  dragonroster.py [--stage young|adult|both] [--out DIR] [--cell 300]

Each rig is composited through its OWN layer offsets — the rest pose, exactly as
RigPlayer builds it — and repeated underneath as a solid fill.

Read the SILHOUETTE row, not the colour row. At board size, filled solid:

  - a SKIN must be indistinguishable from the breed it re-skins (its outline is
    supposed to be locked);
  - a BREED must be nameable on its own. Two breeds with the same outline are
    two recolours, however different their palettes look in the top row.

Discovery is by convention, so a new breed or skin needs no edit here:
`<breed>-dragon/rig` and `rig-adult` are the breed, `rig-<skin>` /
`rig-adult-<skin>` are its skins, and the parts come from the matching `sprite*`
folder. Breeds are listed before skins so the eye compares like with like.
"""
import argparse
import os
import re
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import dragonbreed as D  # noqa: E402

PLATE = (58, 43, 56, 255)
PAPER = (255, 246, 232, 255)
INK = (24, 20, 26, 255)


def discover(stage):
    """(label, breed_dir, rig_dir, sprite_dir) for every rig of this stage."""
    want_adult = stage == 'adult'
    found = []
    for folder in sorted(os.listdir(D.DRAGONS)):
        base = os.path.join(D.DRAGONS, folder)
        if not folder.endswith('-dragon') or not os.path.isdir(base):
            continue
        breed = folder[: -len('-dragon')]
        for rig_dir in sorted(os.listdir(base)):
            m = re.fullmatch(r'rig(-adult)?(?:-(.+))?', rig_dir)
            if not m or not os.path.isdir(os.path.join(base, rig_dir)):
                continue
            is_adult, skin = bool(m.group(1)), m.group(2)
            if is_adult != want_adult:
                continue
            sprite_dir = ('sprite' + ('-adult' if is_adult else '')
                          + (f'-{skin}' if skin else ''))
            if not os.path.isdir(os.path.join(base, sprite_dir)):
                continue
            if not any(f.endswith('.rig.json')
                       for f in os.listdir(os.path.join(base, rig_dir))):
                continue
            found.append((f'{breed}+{skin}' if skin else breed, base, rig_dir, sprite_dir))
    return sorted(found, key=lambda e: ('+' in e[0], e[0]))


def assembled(base, rig_dir, sprite_dir):
    d = os.path.join(base, rig_dir)
    rig = D.load_rig(os.path.join(d, sorted(f for f in os.listdir(d)
                                            if f.endswith('.rig.json'))[0]))
    sd = os.path.join(base, sprite_dir)
    b = rig['bounds']
    canvas = Image.new('RGBA', (b['width'], b['height']), (0, 0, 0, 0))
    for layer in sorted(rig['layers'], key=lambda l: l['z']):
        canvas.alpha_composite(D.layer_image(rig, layer, sd),
                               (layer['x'] - b['x'], layer['y'] - b['y']))
    return canvas


def sheet(entries, cell, path):
    out = Image.new('RGBA', (cell * len(entries), cell * 2), PLATE)
    for i, (label, base, rig_dir, sprite_dir) in enumerate(entries):
        img = assembled(base, rig_dir, sprite_dir)
        s = min(cell / img.width, cell / img.height) * 0.95
        fit = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))),
                         Image.LANCZOS)
        ox, oy = (cell - fit.width) // 2, (cell - fit.height) // 2
        out.alpha_composite(fit, (i * cell + ox, oy))
        blk = Image.new('RGBA', fit.size, INK)
        blk.putalpha(fit.getchannel('A').point(lambda v: 255 if v > 60 else 0))
        pane = Image.new('RGBA', (cell, cell), PAPER)
        pane.alpha_composite(blk, (ox, oy))
        out.alpha_composite(pane, (i * cell, cell))
        D.label(out, label, (i * cell + 8, 6))
        D.label(out, label, (i * cell + 8, cell + 6), colour=INK)
    out.convert('RGB').save(path)
    print(f'{os.path.relpath(path, D.ROOT)}  —  {len(entries)} rigs, '
          f'{out.size[0]}x{out.size[1]}')


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--stage', default='both', choices=['young', 'adult', 'both'])
    ap.add_argument('--out', default=os.path.join(D.ROOT, 'assets/raw/dragons'))
    ap.add_argument('--cell', type=int, default=300)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for stage in (['young', 'adult'] if args.stage == 'both' else [args.stage]):
        entries = discover(stage)
        if not entries:
            print(f'no {stage} rigs found')
            continue
        sheet(entries, args.cell, os.path.join(args.out, f'roster-{stage}.png'))


if __name__ == '__main__':
    main()
