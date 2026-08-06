#!/usr/bin/env python3
"""One-shot batch: the five landmark decors and the twelve dragon reveal plates.

Kept as a script rather than run by hand because both sets are re-rollable art
with per-item prompts, and a re-roll six weeks from now should reproduce the
brief exactly, not approximately.

    python3 scripts/gen-reveal-and-decor.py decor
    python3 scripts/gen-reveal-and-decor.py reveal
    python3 scripts/gen-reveal-and-decor.py reveal --only frost,storm

Everything lands in assets/raw/ as the raw return; cutting to alpha is the
caller's next step (cut-reveal-and-decor.py).
"""
import argparse
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ARTGEN = ROOT / '.claude/skills/nano-banana/scripts/artgen.py'
RAW = ROOT / 'assets/raw'

STYLE = (
    'Image 1 is the ART-STYLE REFERENCE: match its RENDERING TECHNIQUE ONLY. Copy its '
    'painterly mobile-game prop finish, its chunky readable shapes, its few large flat colour '
    'masses with soft gradients inside them, its even dark outline around the silhouette, and '
    'its clean smooth surface with no visible brushwork and no noise. Do NOT copy its colours '
    'or its subject.'
)
CAMERA = (
    'CAMERA — isometric three-quarter view from above at roughly 30 degrees, 2:1 isometric '
    'projection, no perspective convergence. Key light from the upper left; the lower-right '
    'faces are the shaded ones.'
)
KEYBG = (
    'BACKGROUND — a solid flat pure magenta #FF00FF field, edge to edge, completely even. No '
    'ground plane, no diamond, no pad, no cast shadow, no floor, no vignette, no gradient, no '
    'text, no numbers, no labels, no frame, no UI. Nothing magenta, pink, violet, purple or '
    'lilac anywhere in the object itself — that colour is the key and would be cut out.'
)

# ---------------------------------------------------------------- the decors --
# Landmarks, not ornaments: each is a BUILT or FOUND thing at architectural
# scale that says something about the isle, and each has a silhouette no other
# prop on the board owns (figure / arch / tower / skull / floating mass).
DECOR_SHEETS = {
    'landmarks_a': {
        'ref': 'sprites/environment/map/decor/watch_bell.webp',
        'items': ['keeper_statue', 'broken_arch', 'ember_beacon'],
        'brief': (
            'Three large LANDMARK monuments for a cosy fantasy merge game set on volcanic '
            'floating islands — the kind of thing a player places to make a plot of land feel '
            'like somewhere, not an ornament for a shelf. Each is architectural scale: a person '
            'would stand knee-high to it.\n\n'
            'LAYOUT — exactly THREE separate objects in one horizontal row, evenly spaced, each '
            'fully inside the frame with a generous empty margin. Nothing touches or overlaps. '
            'Nothing is cropped by any edge. Each object stands on its OWN small stone base, and '
            'the base is the widest part of it, so it reads as planted on the ground.\n\n'
            'LEFT — THE FIRST KEEPER: a weathered carved stone statue of a standing woman in a '
            'long hooded cloak, one hand held out palm-up, and a small dragon whelp carved '
            'curled around her feet looking up at her. Tall and narrow. The stone is worn and '
            'pale grey-brown, mossy in the crevices, with one warm gold-filled crack running '
            'down the cloak.\n\n'
            'MIDDLE — THE BROKEN GATE: an enormous ruined stone archway, the old sanctuary '
            'gate. One pillar whole, the other snapped off halfway, the arch itself broken at '
            'the crown so the two halves reach toward each other and do not meet. Carved dragon '
            'reliefs down the standing pillar, gold filling the fracture lines, a tattered deep '
            'red banner hanging from the whole side.\n\n'
            'RIGHT — THE EMBER BEACON: a tall tapering signal tower of stacked dark stone on a '
            'stepped square plinth, an iron cage brazier at the top holding a bright burning '
            'orange fire, and a short iron ladder up one side. Smoke is NOT drawn. This is how a '
            'keeper called the dragons home.'
        ),
    },
    'landmarks_b': {
        'ref': 'sprites/environment/map/decor/chain_anchor.webp',
        'items': ['elder_bones', 'tethered_isle'],
        'brief': (
            'Two large LANDMARK objects for a cosy fantasy merge game set on volcanic floating '
            'islands — architectural scale, the kind of thing a player places to make a plot of '
            'land feel like somewhere.\n\n'
            'LAYOUT — exactly TWO separate objects in one horizontal row, evenly spaced, each '
            'fully inside the frame with a generous empty margin. Nothing touches or overlaps. '
            'Nothing is cropped by any edge.\n\n'
            'LEFT — THE ELDER\'S REST: the enormous pale bleached skull of a long-dead elder '
            'dragon, half sunk into a mound of dark ash and grey moss, seen in three-quarter '
            'view with the long horned snout toward the viewer. Two great curved horns sweep '
            'back off it. A few tall curved rib bones stand out of the ash behind the skull. '
            'Small green moss and one or two tiny pale flowers have taken hold along the jaw. '
            'Bone is warm ivory, NOT white; nothing about it is grim or gory.\n\n'
            'RIGHT — THE TETHERED ISLE: a small chunk of floating island HOVERING in the air '
            'with clear empty space beneath it — a grassy top with one crooked little tree and a '
            'scatter of stones, a rough rocky underside tapering to a point, and three heavy '
            'iron chains hanging straight down from ring-bolts on that underside to a low stone '
            'mooring block sitting on the ground below. The chains are taut. The island floats '
            'clear of the block with a visible gap of empty background between them.'
        ),
    },
}

# Props that need their own plate. The Broken Gate came back off the 3-across
# sheet as three DISCONNECTED pieces floating apart — a legible ruin drawing,
# but not one prop: the column-gap slicer sees four objects, and a mid-air arch
# fragment with nothing holding it is not something a player can place on a
# tile. Alone, and told in so many words that it is ONE connected object, it
# behaves.
DECOR_SINGLES = {
    'broken_arch': {
        'ref': 'sprites/environment/map/decor/watch_bell.webp',
        'brief': (
            'ONE large LANDMARK monument for a cosy fantasy merge game set on volcanic floating '
            'islands, at architectural scale: THE BROKEN GATE, the ruined stone archway of the '
            'old sanctuary.\n\n'
            'IT IS A SINGLE CONNECTED OBJECT, all of one piece, standing on ONE shared stone '
            'base that runs the full width of it. BOTH pillars stand on that base. The arch '
            'above is broken open at the crown, and each half of it still rests on and is '
            'attached to its own pillar, reaching toward the other and not meeting. NOTHING '
            'floats, nothing is detached, no piece stands on its own, and there are no fallen '
            'fragments lying beside it. If a part is not touching the rest of the monument, do '
            'not draw it.\n\n'
            'The left pillar is whole and full height; the right one is shorter and more worn. '
            'Carved dragon reliefs run down the pillars, warm gold fills every fracture line, '
            'moss grows in the crevices, and a tattered deep red banner hangs from a rail on '
            'the left pillar. Weathered pale grey-brown stone.\n\n'
            'Wider than it is tall. Fully inside the frame with a generous even margin; nothing '
            'is cropped by any edge.'
        ),
    },
}

# --------------------------------------------------------------- the reveals --
REVEAL_SHOT = (
    'FULL-BODY HERO REVEAL PORTRAIT of the dragon in image 1, for the card a player is shown '
    'the first time they earn it. Keep it EXACTLY on model — the same body, the same silhouette, '
    'the same horns, crest, spines and wings, the same scales and the same colours as image 1. '
    'Do not redesign the animal, do not add anything it does not have.\n\n'
    'THE POSE — {pose}\n\n'
    'STYLE — painterly premium mobile-game key art, dramatic and heroic, chunky readable shapes, '
    'soft gradients, rich lighting, smooth and clean with no visible brushwork. Hand-painted, '
    'NOT a photograph. Strong rim light along the back and the top of the wings so the animal '
    'reads instantly against a dark screen, and a warm bounce on the underside. A subtle even '
    'dark outline around the whole silhouette.\n\n'
    'FRAMING — ONE dragon, centred, filling the frame top to bottom with a small even margin. '
    'Nothing crops the head, wings, tail or feet. No other creatures, no characters, no ground, '
    'no scenery, no props, no text, no logo, no letters, no numbers, no UI, no frame, no border, '
    'no watermark.\n\n'
    '{bg}'
)
ADULT_POSE = (
    'reared up and ROARING at full height, seen in three-quarter view from slightly BELOW so it '
    'towers over the viewer, wings thrown wide and high, head back, jaws open mid-roar with the '
    'teeth and the dark inside of the mouth showing, chest out, tail sweeping behind. This is '
    'the animal at its most impressive — it should feel like it just landed in front of you.'
)
YOUNG_POSE = (
    'sitting up on its hind legs at full stretch, seen in three-quarter view from slightly '
    'below, wings spread wide and open, head up and jaws open in a small fierce ROAR — a '
    'hatchling doing its very best impression of a great dragon. Proud, bright-eyed and '
    'delighted with itself, never menacing.'
)
DRAGONS = {
    'ember': ('sprites/characters/dragon/red-dragon/sprite/red-dragon-baked.webp', 'magenta'),
    'ember_adult': ('sprites/characters/dragon/red-dragon/sprite-adult/red-dragon-adult-baked.webp', 'magenta'),
    'emerald': ('sprites/characters/dragon/emerald-dragon/sprite/emerald-dragon-baked.webp', 'magenta'),
    'emerald_adult': ('sprites/characters/dragon/emerald-dragon/sprite-adult/emerald-dragon-adult-baked.webp', 'magenta'),
    # Golden has no baked composite on disk (item_golden_egg_2 still points at
    # the red bake — it renders as a rig, so the item texture is only an
    # anchor). Its rig layers are flattened once into raw/dragons/reveals/.
    'golden': ('raw/dragons/reveals/golden-source.png', 'magenta'),
    'golden_adult': ('raw/dragons/reveals/golden_adult-source.png', 'magenta'),
    'frost': ('raw/dragons/frost/young-assembled.png', 'magenta'),
    'frost_adult': ('raw/dragons/frost/adult-assembled.png', 'magenta'),
    'storm': ('raw/dragons/storm/young-assembled.png', 'magenta'),
    'storm_adult': ('raw/dragons/storm/adult-assembled.png', 'magenta'),
    # Moonwhisker is violet head to tail: magenta de-spill would eat it, so it
    # keys green — the same call the face banks and the human portraits make.
    'moonwhisker': ('raw/dragons/moonwhisker/young-assembled.png', 'green'),
    'moonwhisker_adult': ('raw/dragons/moonwhisker/adult-assembled.png', 'green'),
}
GREEN_BG = KEYBG.replace('magenta #FF00FF', 'green #00FF00').replace(
    'magenta, pink, violet, purple or lilac', 'green, mint, lime or teal')


def flatten(src: pathlib.Path, dest: pathlib.Path, key: tuple) -> None:
    """A reference with a hard key edge, never one whose art fades out — a
    faded edge comes back as an opaque backdrop that survives de-keying."""
    from PIL import Image
    im = Image.open(src).convert('RGBA')
    out = Image.new('RGBA', im.size, key + (255,))
    out.alpha_composite(im)
    out.convert('RGB').save(dest, quality=95)


def gen(job: str, prompt: str, ref: pathlib.Path, out: pathlib.Path, size: str | None) -> None:
    cmd = ['python3', str(ARTGEN), job, prompt, '-i', str(ref), '-o', str(out)]
    if size:
        cmd += ['--size', size]
    print(f'-> {out.relative_to(ROOT)}', flush=True)
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(r.stdout.strip() or r.stderr.strip(), flush=True)
    if r.returncode != 0:
        sys.exit(r.returncode)


def do_decor(only: set) -> None:
    work = RAW / 'decor-sets' / 'landmarks'
    work.mkdir(parents=True, exist_ok=True)
    for name, spec in DECOR_SHEETS.items():
        if only and name not in only:
            continue
        ref = work / f'{name}-ref.jpg'
        flatten(ROOT / 'assets' / spec['ref'], ref, (255, 0, 255))
        prompt = f'{STYLE}\n\n{spec["brief"]}\n\n{CAMERA}\n\n{KEYBG}'
        (work / f'{name}-prompt.txt').write_text(prompt + '\n')
        gen('character', prompt, ref, work / f'{name}-seedream-pro.jpg', None)


def do_singles(only: set) -> None:
    work = RAW / 'decor-sets' / 'landmarks'
    work.mkdir(parents=True, exist_ok=True)
    for name, spec in DECOR_SINGLES.items():
        if only and name not in only:
            continue
        ref = work / f'{name}-ref.jpg'
        flatten(ROOT / 'assets' / spec['ref'], ref, (255, 0, 255))
        prompt = f'{STYLE}\n\n{spec["brief"]}\n\n{CAMERA}\n\n{KEYBG}'
        (work / f'{name}-prompt.txt').write_text(prompt + '\n')
        gen('character', prompt, ref, work / f'{name}-seedream-pro.jpg', None)


def do_reveal(only: set) -> None:
    work = RAW / 'dragons' / 'reveals'
    work.mkdir(parents=True, exist_ok=True)
    for name, (art, keykind) in DRAGONS.items():
        if only and name.split('_')[0] not in only and name not in only:
            continue
        src = (ROOT / 'assets' / art).resolve()
        if not src.exists():
            sys.exit(f'missing reference art: {src}')
        key = (0, 255, 0) if keykind == 'green' else (255, 0, 255)
        ref = work / f'{name}-ref.jpg'
        flatten(src, ref, key)
        pose = ADULT_POSE if name.endswith('_adult') else YOUNG_POSE
        prompt = REVEAL_SHOT.format(pose=pose, bg=GREEN_BG if keykind == 'green' else KEYBG)
        (work / f'{name}-prompt.txt').write_text(prompt + '\n')
        gen('character', prompt, ref, work / f'{name}-raw.jpg', '1280x1600')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('what', choices=['decor', 'singles', 'reveal', 'all'])
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    only = {s for s in a.only.split(',') if s}
    if a.what in ('decor', 'all'):
        do_decor(only)
    if a.what in ('singles', 'all'):
        do_singles(only)
    if a.what in ('reveal', 'all'):
        do_reveal(only)
