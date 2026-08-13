#!/usr/bin/env python3
"""Bake → generation plate: the FIRST stage of the video-animation workflow.

Takes a dragon's baked rest-pose PNG (transparent background) and produces the
image the video model animates from (and back to — it ships as BOTH
`image_url` and `end_image_url`, which is what closes the loop):

  1. PAD for animation room. The bakes are cropped tight — the frost adult's
     wingtips touch the canvas edge — and a video model given no room clips
     wings or drifts the body to make room. ADULTS get a canvas 2x the
     original image (wings deploy, the low-flight hovers clear of the ground);
     BABIES get 1.5x (breathing, a cute rear-up roar — big, but nothing
     leaves the neighbourhood).
  2. Content sits bottom-centre — headroom is where the action goes (wings
     up, body elevating), with a small floor margin left for the tail.
  3. GREEN PLATE (pure #00FF00) behind it, so the generated video keys back
     out through scripts/anim-ingest.py's green keyer exactly like the
     original dragon clips did.

  anim-plate.py            all five roster plates (frost/storm baby+adult,
                           ember adult) into assets/raw/new-animations/plates/
  anim-plate.py <name>     just one (roster key, e.g. storm_adult)

Prints a JSON report per plate: canvas, content box, where the feet line sits.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

GREEN = (0, 255, 0)
DRAGONS = 'assets/sprites/characters/dragon'
OUT_DIR = Path('assets/raw/new-animations/plates')

# stage rules: canvas multiplier over the ORIGINAL image, and where the
# content's BOTTOM edge lands as a fraction of canvas height.
STAGE = {
    'baby': {'canvas': 1.5, 'bottom': 0.80},
    'adult': {'canvas': 2.0, 'bottom': 0.88}
}

ROSTER = {
    'frost_baby': (f'{DRAGONS}/frost-dragon/sprite/frost-dragon-baked.png', 'baby'),
    'frost_adult': (f'{DRAGONS}/frost-dragon/sprite-adult/frost-dragon-adult-baked.png', 'adult'),
    'storm_baby': (f'{DRAGONS}/storm-dragon/sprite/storm-dragon-baked.png', 'baby'),
    'storm_adult': (f'{DRAGONS}/storm-dragon/sprite-adult/storm-dragon-adult-baked.png', 'adult'),
    'ember_adult': (f'{DRAGONS}/red-dragon/sprite-adult/red-dragon-adult-baked.png', 'adult'),
    # The Golden Elder. Its baked composite is produced the dragonbreed way —
    # rig layers composited by z at their own offsets — because golden predates
    # the breeds pipeline and never had one on disk before the clip work.
    'golden_adult': (f'{DRAGONS}/golden-dragon/sprite-adult/golden-dragon-adult-baked.png', 'adult')
}


def make_plate(name: str, src: str, stage: str) -> dict:
    rules = STAGE[stage]
    im = Image.open(src).convert('RGBA')
    box = im.getchannel('A').point(lambda p: 255 if p > 8 else 0).getbbox()
    if box is None:
        raise SystemExit(f'{name}: baked frame is fully transparent')
    content = im.crop(box)

    cw, ch = int(im.width * rules['canvas']), int(im.height * rules['canvas'])
    plate = Image.new('RGB', (cw, ch), GREEN)
    x = (cw - content.width) // 2
    y = int(ch * rules['bottom']) - content.height
    plate.paste(content, (x, y), content)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f'{name}-plate.png'
    plate.save(out, 'PNG', optimize=True)
    return {
        'name': name,
        'stage': stage,
        'source': src,
        'canvas': [cw, ch],
        'content': [content.width, content.height],
        'contentBox': [x, y, x + content.width, y + content.height],
        'file': str(out)
    }


def main() -> None:
    only = sys.argv[1] if len(sys.argv) > 1 else None
    if only and only not in ROSTER:
        raise SystemExit(f'unknown plate "{only}" — roster: {", ".join(ROSTER)}')
    reports = []
    for name, (src, stage) in ROSTER.items():
        if only and name != only:
            continue
        reports.append(make_plate(name, src, stage))
    print(json.dumps(reports, indent=2))


if __name__ == '__main__':
    main()
