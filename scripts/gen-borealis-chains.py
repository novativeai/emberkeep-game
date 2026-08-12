#!/usr/bin/env python3
"""The five Borealis farm chains — briefs, generation and cutting.

    python3 scripts/gen-borealis-chains.py gen        # 5 sheets, 3-across each
    python3 scripts/gen-borealis-chains.py cut
    python3 scripts/gen-borealis-chains.py gen --only wayfinder,manastone

WHY THESE FIVE

Composited over the actual Borealis backdrop at their real on-board scale, 15 of
the north's 20 shipped pieces sit at the SAME VALUE AND HUE as the ice they
stand on: bleached driftwood, bleached wreck timber, white rime crystals, a
white ice font, a white ice whelp, all on pale blue-grey snow-capped stone.
Only `tarknot` — black with a hot core — reads at a glance.

But value was only half of it. The other half is that a heap of wood, a heap of
crystals and a heap of salt are all THE SAME KIND OF THING: raw material in a
pile. Nothing in the north had a shape you could name. So these five are not
five more materials — they are five MADE OBJECTS, each with a silhouette a
player can identify from across the board and describe out loud: a runestone, a
bottle, a lantern, a geode, a compass. Colour follows from the object.

The north is the right world for that. Nothing grows here and the sea gives
things back, so the things worth having in the north are the things people
BROUGHT and lost: instruments, glass, iron, carved stone.

ROLES ARE INHERITED, NOT INVENTED. Each of these takes over the exact generator,
cooldown, sell and XP of the plant chain it replaces, so `chains.json` is the
only place the swap is visible and the supply graph is unchanged:

    runestone  <- emberkelp   tappable, feeds the north its `tarknot`
    emberdram  <- firethorn   self-seeding, and the north's SECOND dragon fuel
    hearthlamp <- thawpool    pays Warmth; the only energy source up there
    manastone  <- amberfall   self-seeding, Selyna's material, sells high
    wayfinder  <- brinesalt   self-seeding, Selyna's, and the north's coin
"""
import argparse
import json
import pathlib
import subprocess
import sys
from collections import Counter

import numpy as np
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from merge_style import HEAD, SNOW_WORLD, TAIL_GREEN, TAIL_MAGENTA, dekey, style_ref  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
ARTGEN = ROOT / '.claude/skills/nano-banana/scripts/artgen.py'
WORK = ROOT / 'assets/raw/merge-chains/borealis'
OUT = ROOT / 'assets/sprites/items/chains'
ALPHA_GAP = 140
PAD = 6
#: The ladder every sibling chain sits on (see the stormcap/nightbloom cut).
TARGET = {1: 66, 2: 88, 3: 118}

CHAINS = {
    # ------------------------------------------------------------- orange --
    # Takes emberkelp's role: the north's pitch supply.
    'runestone': {
        'key': 'magenta',
        'brief': (
            'Three tiers of a RUNESTONE chain. Before the ice, the people here cut heat-runes '
            'into stone to keep a fire alive through the dark half of the year. The stones still '
            'work. A lit one warms the ground under it until the buried tar runs.\n\n'
            'THE STONE ITSELF IS ORANGE. This is warm rust-and-ochre sandstone, not grey granite '
            '— the whole object reads ORANGE from across the board, and the carvings glow a '
            'hotter orange-gold on top of that. No grey stone, no blue-grey, no slate.\n\n'
            'LEFT — Rune Shard: ONE thick chunky wedge of warm rust-orange stone, broken and '
            'faceted, with a single deep-carved rune cut into its face glowing hot gold from '
            'within the groove. Compact and solid, one clear blob.\n\n'
            'MIDDLE — Carved Stone: a rounded boulder of the same rust-orange stone, banded '
            'around its middle with a dark iron strap, three carved runes glowing hot gold down '
            'its face, a soft orange light spilling from the carvings onto the stone around '
            'them.\n\n'
            'RIGHT — Runestone: a TALL UPRIGHT STANDING STONE with a rounded top, like a viking '
            'memorial stele, cut from the same warm rust-orange stone, its whole front face '
            'covered in deep-carved runes and a carved coiling serpent border, every groove '
            'glowing hot gold, planted in a low ring of dark stones. A few embers drift up from '
            'the top. The silhouette must read as a TALL ROUNDED-TOP SLAB standing upright.\n\n'
            'PALETTE — warm rust-orange stone #C4551E into deep burnt sienna #7A2E10 in the '
            'shadows and warm ochre #E8903C on the lit upper faces, glowing rune gold #FFB01E '
            'into #FFE08A at the hottest, black iron #1A1A1E, near-black outline. No grey, no '
            'white, no pale blue, no snow on them — they are too hot for it.'
        ),
    },
    # --------------------------------------------------------- rose-pink --
    # Takes firethorn's role, INCLUDING being the north's second dragon fuel.
    'emberdram': {
        'key': 'green',
        'brief': (
            'Three tiers of an EMBERDRAM chain. Emberdram is southern firefruit cordial, bottled '
            'and brought north. It keeps forever, it is the one warm thing to drink up here, and '
            'a dragon will take it. This is a DRINK — appetising and precious, never sinister '
            'and never a chemistry set.\n\n'
            'MATCH THE REFERENCE BOTTLES EXACTLY: thick hand-painted glass with a bold near-black '
            'outline, broad soft highlight bands down the left of the belly, one crisp white '
            'specular, and the liquid GLOWING from inside so the glass is brightest where the '
            'drink is deepest. Chunky rounded bottles with fat bellies and short necks.\n\n'
            'LEFT — Dram Vial: ONE small round-bellied glass vial with a short neck and a chunky '
            'cork stopper, filled with glowing rose-pink cordial. Small, fat and solid.\n\n'
            'MIDDLE — Cordial Flask: a larger round bottle of the same cordial, deeper rose, a '
            'chunky cork in the neck, a warm gold collar ring under the cork and a small cream '
            'paper tag hanging from it on a cord.\n\n'
            'RIGHT — Cordial Cask: a big round glass carboy FILLED TO THE VERY TOP with glowing '
            'rose cordial, so the whole belly is deep saturated colour with no empty glass above '
            'the liquid, sitting in a low cradle of near-black timber, a warm brass tap at the '
            'front near the bottom, and a SMALL round of cream cloth tied over its neck with '
            'cord — the cloth is a little cap, not a big shade. The silhouette must read as a '
            'BIG ROUND BELLY SITTING IN A CRADLE.\n\n'
            'PALETTE — deep saturated rose cordial #E23A6E into rich raspberry #A01046 in the '
            'depths and hot blush #FF8FB0 where the light comes through — RICH and saturated '
            'everywhere, never washed out or pastel. Warm honey-gold brass #E8A33C, a small '
            'cream cloth #FFF3E2, near-black timber #241610, near-black outline. No white, no '
            'pale blue, no snow.'
        ),
    },
    # ------------------------------------------------------- warm gold --
    # Takes thawpool's role: the only Warmth generator in the north.
    'hearthlamp': {
        'key': 'magenta',
        'brief': (
            'Three tiers of a HEARTHLAMP chain. Whale-oil lamps off the wrecks, still burning. '
            'In a world with no sun for half the year, a lamp is not decoration, it is warmth.\n\n'
            'LEFT — Oil Lamp: ONE small round brass oil lamp, a fat rounded body with a short '
            'spout at the front and a small warm flame standing on the wick. Compact and solid.\n\n'
            'MIDDLE — Storm Lantern: a chunky brass lantern with a rounded glass belly full of '
            'warm gold light, a domed cap with a vent on top, a thick carrying loop, and three '
            'heavy brass ribs caging the glass.\n\n'
            'RIGHT — Hearthlamp: a big lantern of the same kind hanging by its loop from the '
            'curve of a heavy black iron post, the post standing on a thick round dark stone '
            'base. The glass belly is full of gold light and throws a warm pool of light onto '
            'the base. The silhouette must read as a HOOK — a tall post curving over, with a '
            'rounded lamp hanging from the end of it.\n\n'
            'PALETTE — warm brass #E8A33C into deep bronze #8A5418, gold lamplight #FFD84D into '
            'white-hot #FFF6D8 at the flame, black iron #16161A, dark stone #2A2A30, near-black '
            'outline. No white, no pale blue, no snow — the lamp has melted it off.'
        ),
    },
    # ------------------------------------------------ turquoise / light green --
    # Takes amberfall's role: Selyna's high-value material.
    'manastone': {
        'key': 'magenta',
        'brief': (
            'Three tiers of a MANASTONE chain. The ice caught raw magic the way it caught '
            'everything else, and pressed it into the stone. Selyna works with it.\n\n'
            'NOT SPIKY AND NEVER EGG-SHAPED. There are already faceted ice crystals in this '
            'world, and this is a game about DRAGON EGGS — so nothing here may be an upright '
            'ovoid, nothing may be cracking open like a shell, and nothing may look like it is '
            'about to hatch. These are cut and polished MINERAL, wider than they are tall, sawn '
            'flat where a person worked them.\n\n'
            'LEFT — Mana Pebble: ONE flat rounded disc of near-black stone, like a skipping '
            'stone lying face-up, with a single wide vein of glowing light-green turquoise '
            'running across its top face. Clearly FLAT and WIDE, not a ball and not an egg.\n\n'
            'MIDDLE — Mana Nodule: a chunky dark stone sawn straight across the top, the flat '
            'cut face revealing a thick band of glowing turquoise-green mineral running through '
            'it like a seam in a slice of rock. A low, wide, blocky wedge.\n\n'
            'RIGHT — Manastone Cairn: a STACK of five or six of those flat dark stone discs '
            'piled one on another, largest at the bottom and smallest on top, leaning very '
            'slightly, like a waymarker cairn. Brilliant light-green turquoise mineral glows out '
            'of the gaps between every disc, throwing light onto the stone above and below. The '
            'silhouette must read as a TAPERING STACK OF FLAT PLATES — never a rounded egg and '
            'never a solid slab.\n\n'
            'PALETTE — near-black stone #1C2024 into #3A424A on the lit faces, glowing turquoise '
            '#2FE0C0 into light green #9CFFC8 at the brightest core, near-black outline. No '
            'white, no pale blue, no snow, no faceted crystal spikes.'
        ),
    },
    # ------------------------------------------------------ ivory + rose --
    # Takes brinesalt's role: Selyna's, and the north's coin.
    'wayfinder': {
        'key': 'green',
        'brief': (
            'Three tiers of a WAYFINDER chain. A wayfinder does not point north. It points at '
            'whatever the ice is still holding — which is why, in a world built on salvage, it '
            'is worth more than money.\n\n'
            'LEFT — Lodestone: ONE small smooth rounded pebble of near-black magnetite with a '
            'soft rose glow inside it and a single small iron needle stuck across its face. '
            'Compact and solid.\n\n'
            'MIDDLE — Boxed Needle: a small round case of warm ivory-cream bone with a chunky '
            'brass hinge, its lid open, showing a deep rose-pink dial inside and a slim gold '
            'needle resting across it.\n\n'
            'RIGHT — The Wayfinder: a big ship\'s compass. A THICK RING of warm ivory-white bone '
            'banded with brass forms the outer bezel, and inside it a deep rose-pink dial face '
            'with cream cardinal points and a gold needle glowing faintly. The whole instrument '
            'is seated in a squat block of dark brown timber. The silhouette must read as a '
            'THICK RING SITTING ON A BLOCK.\n\n'
            'PALETTE — warm ivory-cream bezel #F3E3C6 (warm, never blue-white), warm brass '
            '#E8A33C into #8A5418, deep rose dial #D4436E into #8E1F44 in its shadow with a soft '
            'rose glow, gold needle #FFD84D, dark brown timber #3A2418, near-black outline. The '
            'ROSE DIAL is the biggest colour mass — the ivory is a rim, not the object.'
        ),
    },
}


def measured_key(path: pathlib.Path) -> str:
    im = Image.open(path).convert('RGB').resize((256, 256))
    r, g, b = Counter(im.getdata()).most_common(1)[0][0]
    return f'{r:02X}{g:02X}{b:02X}'


def do_gen(only: set) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / 'prompts').mkdir(exist_ok=True)
    for name, spec in CHAINS.items():
        if only and name not in only:
            continue
        tail = TAIL_GREEN if spec['key'] == 'green' else TAIL_MAGENTA
        prompt = HEAD + SNOW_WORLD + spec['brief'] + tail
        (WORK / 'prompts' / f'{name}.txt').write_text(prompt + '\n')
        out = WORK / f'{name}-seedream-pro.jpg'
        print(f'-> {out.relative_to(ROOT)}', flush=True)
        r = subprocess.run(
            ['python3', str(ARTGEN), 'character', prompt, '-i', style_ref(spec['key']),
             '-o', str(out)],
            capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout[-2000:] + r.stderr[-2000:])
            sys.exit(f'{name} failed')


def column_runs(im: Image.Image) -> list:
    """Split a 3-across sheet on the gaps between objects.

    The threshold is HIGH on purpose: a prop's soft outer glow keys to a low
    alpha that bridges the gap to its neighbour, and the sheet then reads as one
    cluster instead of three cells.
    """
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


def mean_hsv(im: Image.Image) -> tuple:
    """Mean saturation/value of the opaque pixels — what the ice-band test reads."""
    a = np.array(im)
    m = a[..., 3] > 128
    if not m.any():
        return (0.0, 0.0)
    rgb = a[..., :3][m].astype(np.float32) / 255.0
    hi, lo = rgb.max(axis=1), rgb.min(axis=1)
    sat = np.where(hi > 0, (hi - lo) / np.maximum(hi, 1e-6), 0.0)
    return (float(sat.mean()), float(hi.mean()))


def do_cut(only: set) -> None:
    meta_path = WORK / 'colour-check.json'
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    for name, spec in CHAINS.items():
        if only and name not in only:
            continue
        src = WORK / f'{name}-seedream-pro.jpg'
        keyed = dekey(src, WORK / f'{name}-keyed.png')
        runs = column_runs(keyed)
        if len(runs) != 3:
            print(f'  ! {name}: {len(runs)} objects, taking the widest 3')
            runs = sorted(sorted(runs, key=lambda r: r[1] - r[0])[-3:])
        for tier, (x0, x1) in zip((1, 2, 3), runs):
            cell = keyed.crop((x0, 0, x1, keyed.height))
            bb = cell.getbbox()
            cell = cell.crop((max(0, bb[0] - PAD), max(0, bb[1] - PAD),
                              min(cell.width, bb[2] + PAD), min(cell.height, bb[3] + PAD)))
            s = TARGET[tier] / max(cell.size) * 6  # authored 6x the on-board size
            cell = cell.resize((max(1, round(cell.width * s)), max(1, round(cell.height * s))),
                               Image.LANCZOS)
            stem = f'{name}_{tier}'
            cell.save(OUT / f'{stem}.png')
            cell.save(OUT / f'{stem}.webp', 'WEBP', quality=94, method=6)
            sat, val = mean_hsv(cell)
            meta[stem] = [round(sat, 4), round(val, 4)]
            flag = '' if (sat >= 0.55 or val <= 0.52 or val >= 0.80) else '   <-- IN THE ICE BAND'
            print(f'  {stem:<16s} {str(cell.size):<12s} sat {sat:.2f} val {val:.2f}{flag}')
    meta_path.write_text(json.dumps(meta, indent=1, sort_keys=True) + '\n')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('what', choices=['gen', 'cut'])
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    sel = {s for s in a.only.split(',') if s}
    (do_gen if a.what == 'gen' else do_cut)(sel)
