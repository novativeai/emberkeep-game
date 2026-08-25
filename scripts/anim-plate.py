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
#: The alternative plate, for animals the green keyer would eat. `anim-ingest`
#: MEASURES the border and picks its keyer, so a black plate needs no flag
#: downstream — it keys by CONNECTIVITY (background = dark AND border-reachable)
#: which is why a black-scaled animal must NOT use it and a green one must.
BLACK = (6, 6, 8)
DRAGONS = 'assets/sprites/characters/dragon'
OUT_DIR = Path('assets/raw/new-animations/plates')

# stage rules: canvas multiplier over the ORIGINAL image, and where the
# content's BOTTOM edge lands as a fraction of canvas height.
STAGE = {
    'baby': {'canvas': 1.5, 'bottom': 0.80},
    'adult': {'canvas': 2.0, 'bottom': 0.88},
    # A KEEPER in a bought look. She is a person, not an animal: nothing
    # unfolds, so the room is not for wings — it is for the CAST. Her scepter
    # gem flares above her head and then throws a bolt of light sideways (see
    # `sprites/<who>/world-cast.webp`, frames 5-7, where the bolt reaches far
    # past her elbow), and the ingest crops to the UNION of every frame with a
    # 4px pad it CLAMPS to the plate. So anything the model draws against the
    # plate edge arrives as a sprite touching its own frame border. Generous
    # margins here are what stop that, and `--report` prints them.
    'keeper': {'canvas': 1.8, 'bottom': 0.90}
}

#: name -> (baked rest pose, stage, plate colour). The plate colour is chosen by
#: MEASURING the animal, never by habit: the emerald is 24% strongly-green
#: pixels and would lose a quarter of itself to a green key, while ashglass is
#: black glass and would dissolve into a black one.
ROSTER = {
    'frost_baby': (f'{DRAGONS}/frost-dragon/sprite/frost-dragon-baked.png', 'baby', GREEN),
    'frost_adult': (f'{DRAGONS}/frost-dragon/sprite-adult/frost-dragon-adult-baked.png', 'adult', GREEN),
    'storm_baby': (f'{DRAGONS}/storm-dragon/sprite/storm-dragon-baked.png', 'baby', GREEN),
    'storm_adult': (f'{DRAGONS}/storm-dragon/sprite-adult/storm-dragon-adult-baked.png', 'adult', GREEN),
    'ember_adult': (f'{DRAGONS}/red-dragon/sprite-adult/red-dragon-adult-baked.png', 'adult', GREEN),
    # The Golden Elder. Its baked composite is produced the dragonbreed way —
    # rig layers composited by z at their own offsets — because golden predates
    # the breeds pipeline and never had one on disk before the clip work.
    'golden_adult': (f'{DRAGONS}/golden-dragon/sprite-adult/golden-dragon-adult-baked.png', 'adult', GREEN),
    # Moonwhisker — the Emporium's emerald-chain skin, last of the store breeds
    # to get clips. Violet/rose animal on the green plate: no key conflict.
    'moonwhisker_baby': (f'{DRAGONS}/moonwhisker-dragon/sprite/moonwhisker-dragon-baked.png', 'baby', GREEN),
    'moonwhisker_adult': (f'{DRAGONS}/moonwhisker-dragon/sprite-adult/moonwhisker-dragon-adult-baked.png', 'adult', GREEN),
    # The legendaries. No rig and no bake behind them — the shipped board art
    # IS the rest pose (it is what the clips replace), so it plates directly.
    # Young only: both chains stop at the animal, so there is no adult stage.
    'ashdrake_young': (f'{DRAGONS}/ashdrake/ashdrake-young.png', 'baby', GREEN),
    'rimewyrm_young': (f'{DRAGONS}/rimewyrm/rimewyrm-young.png', 'baby', GREEN),
    # ---- the last three off the pin rigs (the rig system is being deleted) ----
    # The Green Dragon itself. BLACK plate: 24% of the baby's pixels clear the
    # greenness threshold, so a green plate would key out most of the animal.
    'emerald_baby': (f'{DRAGONS}/emerald-dragon/sprite/emerald-dragon-baked.png', 'baby', BLACK),
    'emerald_adult': (
        f'{DRAGONS}/emerald-dragon/sprite-adult/emerald-dragon-adult-baked.png', 'adult', BLACK),
    # Ashglass — black glass scales over lava. GREEN plate: it has no green at
    # all, and a black plate is the one thing that would dissolve it.
    'ashglass_baby': (f'{DRAGONS}/red-dragon/sprite-ashglass/red-dragon-baked.png', 'baby', GREEN),
    'ashglass_adult': (
        f'{DRAGONS}/red-dragon/sprite-adult-ashglass/red-dragon-adult-baked.png', 'adult', GREEN),
    # Porcelain — white, blue and gold. No green and nothing dark; either plate
    # would work, so it takes the house default.
    'porcelain_baby': (
        f'{DRAGONS}/emerald-dragon/sprite-porcelain/emerald-dragon-baked.png', 'baby', GREEN),
    'porcelain_adult': (
        f'{DRAGONS}/emerald-dragon/sprite-adult-porcelain/emerald-dragon-adult-baked.png',
        'adult', GREEN),
    # ---- KEEPER LOOKS (Emporium `keeper_skin`) ------------------------------
    # Not dragons at all: the two people, wearing something they were bought.
    # The source is the skin's shipped standee still, which is her rest pose on
    # her bank's own frame — so what the clips come back registered to is the
    # same geometry the still already sits on. GREEN both: measured, neither has
    # a single strongly-green pixel, and neither is dark enough for a black
    # plate to be safe (Eleanor is 4.6% near-black in her hair alone).
    'eleanor_beach': ('assets/sprites/eleanor/skin-beach.webp', 'keeper', GREEN),
    'selyna_beach': ('assets/sprites/selyna/skin-beach.webp', 'keeper', GREEN)
}


def make_plate(name: str, src: str, stage: str, bg: tuple) -> dict:
    rules = STAGE[stage]
    im = Image.open(src).convert('RGBA')
    box = im.getchannel('A').point(lambda p: 255 if p > 8 else 0).getbbox()
    if box is None:
        raise SystemExit(f'{name}: baked frame is fully transparent')
    content = im.crop(box)

    cw, ch = int(im.width * rules['canvas']), int(im.height * rules['canvas'])
    plate = Image.new('RGB', (cw, ch), bg)
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
        'plate': 'green' if bg == GREEN else 'black',
        'file': str(out)
    }


def main() -> None:
    only = sys.argv[1] if len(sys.argv) > 1 else None
    if only and only not in ROSTER:
        raise SystemExit(f'unknown plate "{only}" — roster: {", ".join(ROSTER)}')
    reports = []
    for name, (src, stage, bg) in ROSTER.items():
        if only and name != only:
            continue
        reports.append(make_plate(name, src, stage, bg))
    print(json.dumps(reports, indent=2))


if __name__ == '__main__':
    main()
