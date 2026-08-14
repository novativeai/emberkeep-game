#!/usr/bin/env python3
"""The Dragon Codex menu icon — the ember dragon's own head, not a chibi.

    python3 scripts/gen-codex-icon.py gen     # one plate per model
    python3 scripts/gen-codex-icon.py cut     # de-key, trim, square to 512

WHAT WAS WRONG

`ui_icon_dragondex` shipped as a stock cute-dragon sticker: a round lump head,
huge glossy anime eyes with star catchlights, a little smile, stubby cream
horns. Nothing in the game looks like that. The button it sits on opens the book
of THIS game's dragons, and the animal on the cover was not one of them.

THE REFERENCE IS THE SHIPPED RIG, NOT A DESCRIPTION

`REF` is the ember dragon's actual adult head layer — the same file the rig
draws on the board. It is passed as the image reference and composited onto the
key colour by `plate()`, so the icon is answerable to the art rather than to a
paragraph about the art. Describe the head in the prompt as well: the reference
carries the LOOK, the words carry what a 125-pixel icon needs that a rig layer
does not (the crop, the fill, the rim).

WHY THE ADULT AND NOT THE WHELP

The whelp head is genuinely round-and-big-eyed — it is a baby, correctly drawn —
so referencing it would land back where this started. The adult is the one with
the heavy curling gold ram horns, and horns are what survives being shrunk to
125 pixels on a round button. It also says the right thing: the codex is the
record of what your dragons become.
"""
import argparse
import pathlib
import subprocess
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
ARTGEN = ROOT / '.claude/skills/nano-banana/scripts/artgen.py'
WORK = ROOT / 'assets/raw/ui/codex-icon'
OUT = ROOT / 'assets/sprites/ui/icon_dragondex'
#: The shipped adult ember head — the rig layer itself.
REF = ROOT / 'assets/sprites/characters/dragon/red-dragon/sprite-adult/red-dragon-head.webp'
#: What every other menu icon on that column is.
SIZE = 512

sys.path.insert(0, str(ROOT / 'scripts'))
from merge_style import dekey  # noqa: E402

PROMPT = (
    'Image 1 is THE SUBJECT AND THE STYLE: this exact dragon, redrawn as a game UI menu icon. '
    'Keep the animal it is — the crimson-red pebbled scale hide with darker plated scales over '
    'the skull, the heavy curling RAM HORNS in warm gold that sweep back and curl down beside '
    'the jaw, the smaller gold spikes along the cheek and brow, the cream-gold jaw and throat '
    'plates, and the amber-gold eye with a dark slit pupil under a strong heavy brow.\n\n'
    'THIS IS AN ADULT ANIMAL AND IT MUST NOT BE CUTE. A long strong muzzle, a heavy brow ridge, '
    'a level and watchful expression. NOT a chibi, NOT a baby, NOT a sticker or a mascot: no '
    'oversized eyes, no star or sparkle catchlights, no round lump head, no smile, no tiny '
    'stubby horns, no big soft cheeks.\n\n'
    'CROP — the HEAD and the top of the neck only, in three-quarter view turned to the LEFT and '
    'tilted very slightly down, the way the reference is turned. The head fills most of the '
    'frame with a small even margin all around it; the horns must stay fully inside the frame '
    'and must not touch or cross any edge. No body, no wings, no hands, no book, no frame, no '
    'badge, no ring, no banner.\n\n'
    'STYLE — painterly mobile-game UI icon: a few large confident colour masses with smooth '
    'gradients inside them, glossy painted highlights, one crisp specular on the brow and one '
    'along the top of each horn, a soft warm bounce light along the lower shadow edge, and a '
    'clean dark rim reading all the way around the silhouette so it stays legible shrunk onto a '
    'round button. Hand-painted, NOT a photograph, no ray-traced reflections, no 3D render, no '
    'line-art, no cel shading, no flat vector. Key light from the upper left.\n\n'
    'BACKGROUND — a solid flat pure magenta #FF00FF field, edge to edge, completely even. No '
    'ground, no pad, no cast shadow, no vignette, no gradient, no glow, no text, no numbers, no '
    'labels, no frames, no UI. Nothing magenta, pink, violet or purple anywhere on the dragon '
    'itself — that colour is the key and would be cut out of it.'
)

#: One plate per model. Head-and-horns at icon scale is a shape problem, and
#: which model holds a reference subject while re-cropping it is not something
#: worth guessing at — see the cauldron shoot in gen-cauldron-views.py.
MODELS = {
    'nb2': ('asset', ['--ar', '1:1']),
    'nb-pro': ('map-pro', ['--ar', '1:1']),
    'seedream-pro': ('character', ['--size', '1536x1536']),
}


def plate() -> str:
    """The reference head flattened onto the key colour.

    Flattened rather than passed as a transparent PNG: a transparent reference
    arrives over an arbitrary matte and the model reads that matte as part of
    the style (docs/character-pipeline.md learned this the expensive way).
    """
    head = Image.open(REF).convert('RGBA')
    s = 1024 / max(head.size)
    head = head.resize((round(head.width * s), round(head.height * s)), Image.LANCZOS)
    pad = 96
    out = Image.new('RGB', (head.width + pad * 2, head.height + pad * 2), (255, 0, 255))
    out.paste(head, (pad, pad), head)
    WORK.mkdir(parents=True, exist_ok=True)
    p = WORK / 'reference-plate.png'
    out.save(p)
    return str(p)


def do_gen(only: set) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / 'prompt.txt').write_text(PROMPT + '\n')
    ref = plate()
    for name, (mode, extra) in MODELS.items():
        if only and name not in only:
            continue
        out = WORK / f'{name}.png'
        print(f'-> {out.relative_to(ROOT)}  ({mode})', flush=True)
        r = subprocess.run(
            ['python3', str(ARTGEN), mode, PROMPT, '-i', ref, '-o', str(out), *extra],
            capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout[-1500:] + r.stderr[-1500:])
            print(f'   ! {name} failed, continuing')


def square(im: Image.Image, size: int = SIZE) -> Image.Image:
    """Trim to the art, fit it inside a square canvas with an even margin.

    The other icons on that column all read as one object centred in its own
    box, so the icon owns its padding rather than inheriting whatever margin the
    model happened to leave.
    """
    bb = im.getbbox()
    im = im.crop(bb)
    inner = round(size * 0.94)
    s = inner / max(im.size)
    im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(im, ((size - im.width) // 2, (size - im.height) // 2), im)
    return out


def do_cut(only: set) -> None:
    for name in MODELS:
        if only and name not in only:
            continue
        src = WORK / f'{name}.png'
        if not src.exists():
            print(f'  - {name}: no plate')
            continue
        icon = square(dekey(src, WORK / f'{name}-keyed.png'))
        icon.save(WORK / f'{name}-icon.png')
        print(f'  {name:<14s} -> {(WORK / f"{name}-icon.png").relative_to(ROOT)}')
    print(f'\npick one, then: cp <name>-icon.png {OUT}.png  (and write the .webp)')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('what', choices=['gen', 'cut'])
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    sel = {s for s in a.only.split(',') if s}
    (do_gen if a.what == 'gen' else do_cut)(sel)
