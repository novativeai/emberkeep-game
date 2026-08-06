#!/usr/bin/env python3
"""Bake a dialogue-bubble portrait disc atlas for a guide character.

  python3 scripts/bake-portrait-disc.py eleanor

Produces `assets/sprites/<character>/disc-atlas.png` — ONE spritesheet of bust
cutouts (natural alpha silhouette, no circular clip; CharacterBubble does the
masking) laid out row-major in this fixed order:

    cell 0, 1  : the rest pose, twice (the two "idle" slots the bubble rests on)
    cell 2..   : each talk bank in `banks` order (short, mid, long)
    then       : the blink bank
    then       : the expression stills, in EXPRESSIONS order (may be empty)

PortraitAnimator maps banks onto those offsets, so the order here and the order
in `src/render/sequenceCatalog.ts` must agree. The order is APPEND-ONLY: a new
bank goes on the end, because every offset above it is derived by counting.

Each cell is the frame's top `BOTTOM_KEEP` of height — the bottom sliver is
trimmed at bake time because CharacterBubble positions the bust so that edge
sits on the ring's frame line: most of the character rises in front of the ring,
and nothing renders past the trim.

The characters baked here ship REAL blink art, so no eyelids are synthesised.

Re-run after regenerating a character's banks with Sprite Studio.
"""
import math
import os
import re
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Cell size is a memory decision, not a quality one: the bubble displays the
# bust at ~380px tall, so 360 is already ~1:1.
CELL_W, CELL_H = 270, 360
BOTTOM_KEEP = 0.95
# Every texture stays under 4096px on a side (old-device budget), which caps the
# sheet at 15 x 11 cells = 165 frames.
MAX_SIDE = 4096

# Expression stills, appended after the blink bank in THIS fixed order so the
# runtime can index them by name without a manifest. A character with no
# expression art simply has none of these cells.
EXPRESSIONS = ('angry', 'determined', 'happy', 'laughing',
               'neutral', 'sad', 'surprised', 'worried')


def grid_for(n: int) -> tuple[int, int]:
    """Squarish grid that holds n cells and fits the texture budget."""
    cols = math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    if cols * CELL_W > MAX_SIDE or rows * CELL_H > MAX_SIDE:
        raise SystemExit(f'{n} frames need {cols}x{rows} = '
                         f'{cols * CELL_W}x{rows * CELL_H}px, over the {MAX_SIDE}px budget')
    return cols, rows

# Merge-game art (nano-banana `posesheet.py`): three length-picked talk banks
# and a 3-state blink, all four drawn against the same rest plate. `banks` is
# APPEND-ONLY and must stay in step, name for name and count for count, with
# BANK_KINDS in src/entities/PortraitAnimator.ts and the entries in
# src/render/sequenceCatalog.ts — the atlas carries no manifest, so those counts
# ARE the contract. Neither character ships expression stills; PortraitAnimator
# range-checks the cell before using one, so a missing face degrades to the idle.
CHARACTERS = {
    'eleanor': {
        'dir': 'assets/sprites/eleanor-merge',
        'rest': 'rest.png',
        'banks': (('talk_short', 5), ('talk_mid', 15), ('talk_long', 20), ('blink', 4)),
        'expressions': None
    },
    'selyna': {
        'dir': 'assets/sprites/selyna-merge',
        'rest': 'rest.png',
        'banks': (('talk_short', 5), ('talk_mid', 15), ('talk_long', 20), ('blink', 4)),
        'expressions': None
    }
}


def frame_path(*parts: str) -> str:
    """
    The bank frames are LOSSLESS WebP now (scripts/optimize-art.py): same pixels,
    a third fewer bytes, and the .png master is gone. The bank layout is still
    written here in .png terms because that is how the art is authored and how
    posesheet.py emits it, so resolve to whichever sibling is actually on disk.
    PIL opens either without knowing the difference.
    """
    path = os.path.join(*parts)
    alt = re.sub(r'\.png$', '.webp', path)
    return alt if not os.path.exists(path) and os.path.exists(alt) else path


def bake(name: str) -> None:
    cfg = CHARACTERS[name]
    base = os.path.join(ROOT, cfg['dir'])
    rest = Image.open(frame_path(base, cfg['rest'])).convert('RGBA')
    src_w, src_h = rest.size
    crop_h = round(src_h * BOTTOM_KEEP)

    frames = [rest, rest]
    for folder, count in cfg['banks']:
        for i in range(count):
            frames.append(Image.open(frame_path(base, folder, f'{i}.png')).convert('RGBA'))
    expr_dir = cfg.get('expressions')
    expr_names = []
    if expr_dir:
        for face in EXPRESSIONS:
            path = frame_path(base, expr_dir, f'{face}.png')
            if not os.path.exists(path):
                raise SystemExit(f'{name}: expression art is all-or-nothing, {face}.png is missing')
            frames.append(Image.open(path).convert('RGBA'))
            expr_names.append(face)

    cols, rows = grid_for(len(frames))

    # Contain-fit, bottom-aligned: a frame is never distorted, and the trimmed
    # bottom edge still lands on the cell floor, which is the edge
    # CharacterBubble seats on the ring's frame line.
    scale = min(CELL_W / src_w, CELL_H / crop_h)
    fit_w, fit_h = round(src_w * scale), round(crop_h * scale)
    ox, oy = (CELL_W - fit_w) // 2, CELL_H - fit_h

    atlas = Image.new('RGBA', (cols * CELL_W, rows * CELL_H), (0, 0, 0, 0))
    for i, img in enumerate(frames):
        if img.size != (src_w, src_h):
            raise SystemExit(f'{name}: frame {i} is {img.size}, expected {(src_w, src_h)} — '
                             'every frame must share one canvas or the bust will jitter')
        cell = img.crop((0, 0, src_w, crop_h)).resize((fit_w, fit_h), Image.LANCZOS)
        atlas.paste(cell, ((i % cols) * CELL_W + ox, (i // cols) * CELL_H + oy), cell)

    out = os.path.join(base, 'disc-atlas.png')
    atlas.save(out)
    spans, at = [], 2
    for folder, count in cfg['banks']:
        spans.append(f'{at}..{at + count - 1} {folder}')
        at += count
    if expr_names:
        spans.append(f'{at}.. expressions ({", ".join(expr_names)})')
    print(f'atlas -> {os.path.relpath(out, ROOT)} {atlas.size} | '
          f'{len(frames)} cells @ {CELL_W}x{CELL_H} in {cols}x{rows} '
          f'(0,1 rest · {" · ".join(spans)})')


if __name__ == '__main__':
    for who in (sys.argv[1:] or ['eleanor']):
        if who not in CHARACTERS:
            raise SystemExit(f'unknown character {who!r}; known: {", ".join(CHARACTERS)}')
        bake(who)
