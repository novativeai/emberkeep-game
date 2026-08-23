#!/usr/bin/env python3
"""The Runevault cauldron, re-shot at the PLAZA'S OWN CAMERA, across every model.

    python3 scripts/gen-cauldron-views.py gen     # one plate per model
    python3 scripts/gen-cauldron-views.py cut     # key + trim each
    python3 scripts/gen-cauldron-views.py compare # composite all onto the plaza

WHY THIS EXISTS — the shipped pot is drawn at the wrong camera and it is a
MEASURED wrongness, not a taste call:

  the rune circle it stands in has a minor:major of 192/298 = 0.64
  the pot's own brew ellipse measures (ellipse_ratio)        = 0.366

A circle lying on the ground photographs as an ellipse whose minor:major is
sin(elevation). So the plaza is shot from ~40 degrees above the horizontal and
the cauldron from ~21 — about half the world's elevation. That is exactly
the "sits too flat" read: the pot looks like a photograph taken standing up,
dropped onto a map drawn from a balcony.

The fix is not "tilt it a bit". The brief pins the number: the OPENING of the
pot must be an ellipse as round as the circle it stands in, which means the
brew reads as a wide dish of light rather than a sliver, the top of the rim is
most of what you see, and the feet splay out below a foreshortened belly.

WHY ALL THE MODELS — perspective obedience is the one axis where these models
differ most, and there is no way to know from the prompt which will hold 0.64.
So every model shoots the same brief and `compare` composites each result onto
the real backdrop at the real on-board scale, with its measured ellipse ratio
printed beside it. The pick is made on the number and the picture together.
"""
import argparse
import json
import pathlib
import subprocess
import sys

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
ARTGEN = ROOT / '.claude/skills/nano-banana/scripts/artgen.py'
WORK = ROOT / 'assets/raw/decor-sets/cauldron'
#: The plaza, kept in the workspace rather than read from asset3d/ — that path
#: only exists on the branch the cauldron work lives on, and this script has to
#: run anywhere the art is being judged.
BACKDROP = WORK / 'runevault-backdrop.webp'
IDENTITY = WORK / 'identity-ref.png'

#: Measured off the backdrop (see the docstring). The plaza's ground plane.
CIRCLE = {'cx': 700, 'cy': 614, 'rx': 298, 'ry': 192}
GROUND_RATIO = CIRCLE['ry'] / CIRCLE['rx']

#: job → (artgen mode, extra args). One entry per MODEL, not per size.
MODELS = {
    'refine-pro': ('character', ['--size', '1536x1536']),
    'refine-nbpro': ('map-pro', ['--ar', '1:1']),
    'seedream-pro': ('character', ['--size', '1536x1536']),
    # map-pro, not sheet-pro: `sheet` modes are built to return a ROW of
    # objects and that framing beat the prompt's "ONE cauldron" every time —
    # the first shot came back as a 5076px strip of pots, which also made its
    # brew measurement meaningless (the bbox spanned all of them).
    'nb-pro': ('map-pro', ['--ar', '1:1']),
    'nb2': ('asset', ['--ar', '1:1']),
    'seedream-lite': ('asset-seedream', []),
}

PROMPT = (
    'Image 1 is the WORLD this prop stands in — a floating stone plaza seen from above. '
    'Match ITS CAMERA EXACTLY and nothing else about it: do not copy its colours, its '
    'architecture or its runes.\n\n'
    'Image 2 is the IDENTITY of the object — the exact cauldron to draw. Keep its design '
    'faithfully: the dark blue-grey iron belly, the ornate bronze-gold scrollwork and crescent '
    'moons embossed across it, the band of carved runes below the rim, the heavy swing handle '
    'arcing over the pot, the four clawed feet, the tilted lid with a crescent-moon finial, and '
    'the glowing magenta-pink brew. Same object, drawn from a different camera.\n\n'
    'THE CAMERA IS THE WHOLE POINT. This is an ISOMETRIC BIRD\'S-EYE view — the camera is high '
    'above the cauldron looking DOWN at it at about 40 degrees, the same way you would look down '
    'at a bowl on a table from standing height. Concretely:\n'
    '- The MOUTH OF THE POT IS A WIDE, ROUND, OPEN ELLIPSE. Its height must be about two thirds '
    'of its width. You are looking down INTO the pot, so the pool of glowing brew is a broad '
    'round dish of light filling most of the opening — NOT a thin sliver seen edge-on.\n'
    '- The top surface of the rim is a generous ring you can see all the way around.\n'
    '- The belly of the pot is FORESHORTENED: much less of the vertical side wall shows than in '
    'a straight-on view, and the widest part of the silhouette is the rim, not the middle.\n'
    '- The four clawed feet splay OUTWARD below the belly and are seen from above, so the ground '
    'they stand on reads as a flat plane under the pot.\n'
    'This is NOT a side view, NOT eye-level, and NOT a low three-quarter view.\n\n'
    'LIGHTING — a warm low sun from the UPPER RIGHT, cool blue-violet twilight ambient filling '
    'the shadows, and the magenta brew casting its own pink glow up onto the inside of the rim '
    'and the underside of the tilted lid.\n\n'
    'STYLE — painterly premium mobile-game prop art, chunky readable shapes, a bold dark outline '
    'around the whole silhouette, few large colour masses with smooth gradients, glossy painted '
    'metal highlights. Hand-painted, NOT a photograph, no ray-traced reflections, no studio '
    'product lighting, no 3D render.\n\n'
    'FRAMING — ONE cauldron, centred, filling most of the frame with an even margin. Nothing '
    'cropped by any edge. No ground plane, no shadow, no scenery, no text, no UI.\n\n'
    'BACKGROUND — a solid flat pure green #00FF00 field, edge to edge, completely even. Nothing '
    'green, mint, lime or teal anywhere in the cauldron itself — that colour is the key and '
    'would be cut out. The brew stays magenta-pink.'
)


def brew_mask(im: Image.Image) -> np.ndarray:
    """The glowing liquid, by colour — the one part of the pot that IS a disc."""
    a = np.array(im.convert('RGBA'))
    r, g, b, al = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int), a[..., 3]
    return (al > 128) & (r > 110) & (b > 90) & (r - g > 45) & (b - g > 25)


def ellipse_ratio(im: Image.Image) -> float:
    """Minor:major of the BREW — a direct read of the camera's elevation.

    A circle lying flat photographs as an ellipse whose minor:major is
    sin(elevation), and the liquid is the only horizontal disc on the object,
    so this IS the perspective check — get it to match the ground's 0.64 and
    the pot is standing in the same world as the plaza.

    Measured by SECOND MOMENTS, not by the bounding box. The tilted lid
    overlaps the far rim on most of these candidates, which clips the top of
    the blob: a bbox then under-reports the height and the pot scores flatter
    than it is. The covariance of the filled region degrades gracefully under
    that kind of partial occlusion — for a filled ellipse the eigenvalue ratio
    is exactly (minor/major)^2, whatever the rotation.
    """
    m = brew_mask(im)
    if m.sum() < 200:
        return float('nan')
    ys, xs = np.nonzero(m)
    cov = np.cov(np.stack([xs, ys]).astype(float))
    ev = np.linalg.eigvalsh(cov)  # ascending
    if ev[1] <= 0:
        return float('nan')
    return float(np.sqrt(max(ev[0], 0.0) / ev[1]))


#: The refine pass. Only ONE model held the plaza's camera from a text brief
#: (seedream-lite, 0.63 against the ground's 0.64) — but it is the LITE model,
#: so it holds the geometry and loses some of the ornament. Handing its result
#: back to the Pro model as a POSE reference separates the two problems: the
#: camera is no longer something the prompt has to win, it is something the
#: reference already shows, and the Pro model spends its whole budget on finish.
REFINE_PROMPT = (
    'Image 1 is the CAMERA AND POSE to reproduce EXACTLY: the same high isometric '
    'bird\'s-eye view looking down into the pot, the same wide round opening, the same '
    'foreshortened belly, the same tilt and the same placement of the lid. Copy that geometry '
    'precisely — most importantly, THE POOL OF LIQUID MUST STAY A WIDE ROUND ELLIPSE whose '
    'height is about two thirds of its width, exactly as in Image 1. Do not flatten it, do not '
    'raise the camera, do not turn the pot.\n\n'
    'Image 2 is the ART QUALITY AND ORNAMENT to match: its crisp bronze-gold scrollwork, its '
    'carved crescent moons, its rune band, its bold dark outline and its clean painted metal. '
    'Redraw Image 1\'s exact pose at THAT level of finish and detail.\n\n'
    'So: Image 1\'s camera and shape, Image 2\'s craftsmanship. One ornate iron witch\'s '
    'cauldron with a heavy swing handle, four clawed feet, a tilted lid with a crescent-moon '
    'finial, and a glowing magenta-pink brew.\n\n'
    'LIGHTING — warm low sun from the UPPER RIGHT, cool blue-violet twilight ambient in the '
    'shadows, the brew casting pink light up onto the rim and the underside of the lid.\n\n'
    'STYLE — painterly premium mobile-game prop art, chunky readable shapes, bold dark outline, '
    'few large colour masses with smooth gradients, glossy painted metal. Hand-painted, NOT a '
    'photograph, no ray-traced reflections, no studio product lighting, no 3D render.\n\n'
    'FRAMING — ONE cauldron, centred, filling most of the frame, nothing cropped. No ground, no '
    'shadow, no scenery, no text.\n\n'
    'BACKGROUND — a solid flat pure green #00FF00 field, edge to edge, completely even. Nothing '
    'green, mint, lime or teal in the cauldron itself. The brew stays magenta-pink.'
)


def do_refine(only: set) -> None:
    """Re-shoot the winning CAMERA at higher fidelity, pose-referenced."""
    pose = WORK / 'seedream-lite.png'
    if not pose.exists():
        sys.exit('no seedream-lite.png — run gen + cut first')
    for name, mode in (('refine-pro', 'character'), ('refine-nbpro', 'map-pro')):
        if only and name not in only:
            continue
        out = WORK / f'{name}-raw.png'
        extra = ['--size', '1536x1536'] if mode == 'character' else ['--ar', '1:1']
        print(f'-> {name} ({mode})', flush=True)
        r = subprocess.run(
            ['python3', str(ARTGEN), mode, REFINE_PROMPT,
             '-i', str(pose), '-i', str(IDENTITY), '-o', str(out), *extra],
            capture_output=True, text=True)
        if r.returncode != 0:
            print(f'   ! {name} failed:', (r.stdout + r.stderr)[-400:])


def do_gen(only: set) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    if not IDENTITY.exists():
        sys.exit(f'missing identity reference: {IDENTITY} (flatten the shipped pot onto green)')
    for name, (mode, extra) in MODELS.items():
        if only and name not in only:
            continue
        out = WORK / f'{name}-raw.png'
        print(f'-> {name} ({mode})', flush=True)
        r = subprocess.run(
            ['python3', str(ARTGEN), mode, PROMPT,
             '-i', str(BACKDROP), '-i', str(IDENTITY), '-o', str(out), *extra],
            capture_output=True, text=True)
        if r.returncode != 0:
            print(f'   ! {name} failed:', (r.stdout + r.stderr)[-400:])


def do_cut(only: set) -> None:
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    from merge_style import dekey
    report = {}
    for name in MODELS:
        if only and name not in only:
            continue
        src = WORK / f'{name}-raw.png'
        if not src.exists():
            continue
        art = dekey(src, WORK / f'{name}-keyed.png')
        bb = art.getbbox()
        art = art.crop(bb)
        art.save(WORK / f'{name}.png')
        ratio = ellipse_ratio(art)
        report[name] = {'size': art.size, 'brewRatio': round(ratio, 3)}
        flag = 'OK' if abs(ratio - GROUND_RATIO) < 0.12 else 'OFF'
        print(f'  {name:<16s} {str(art.size):<12s} brew {ratio:.2f} '
              f'(ground {GROUND_RATIO:.2f})  {flag}')
    (WORK / 'views.json').write_text(json.dumps(report, indent=1) + '\n')


def do_compare(_only: set) -> None:
    """Every candidate on the real plaza, at the real on-board size."""
    bg = Image.open(BACKDROP).convert('RGB')
    cands = [n for n in MODELS if (WORK / f'{n}.png').exists()]
    if not cands:
        sys.exit('nothing cut yet — run `cut` first')
    # The pot should read as a monument on the circle: ~70% of its width.
    target_w = round(CIRCLE['rx'] * 2 * 0.70)
    tiles = []
    for name in ['SHIPPED', *cands]:
        src = (ROOT / 'assets/sprites/environment/map/decor/pink_cauldron.webp'
               if name == 'SHIPPED' else WORK / f'{name}.png')
        if not src.exists():
            continue
        art = Image.open(src).convert('RGBA')
        s = target_w / art.width
        art = art.resize((target_w, max(1, round(art.height * s))), Image.LANCZOS)
        tile = bg.crop((CIRCLE['cx'] - 520, CIRCLE['cy'] - 470,
                        CIRCLE['cx'] + 520, CIRCLE['cy'] + 330)).copy()
        # Anchor 0.845 of the art height on the circle centre — the decor
        # calibration's own ground-contact convention.
        px = 520 - art.width // 2
        py = 470 - round(art.height * 0.845)
        tile.paste(art, (px, py), art)
        tiles.append((name, tile))
    w = sum(t.width for _, t in tiles)
    sheet = Image.new('RGB', (w, tiles[0][1].height), (20, 20, 30))
    x = 0
    for _, t in tiles:
        sheet.paste(t, (x, 0))
        x += t.width
    out = WORK / 'compare.png'
    sheet.save(out)
    print('order:', ' | '.join(n for n, _ in tiles))
    print(f'{out.relative_to(ROOT)}  {sheet.size}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('what', choices=['gen', 'refine', 'cut', 'compare'])
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    sel = {s for s in a.only.split(',') if s}
    {'gen': do_gen, 'refine': do_refine, 'cut': do_cut,
     'compare': do_compare}[a.what](sel)
