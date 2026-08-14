#!/usr/bin/env python3
"""The SEVEN old Borealis chains, redrawn in the house style.

    python3 scripts/gen-borealis-legacy.py gen        # 6 sheets
    python3 scripts/gen-borealis-legacy.py cut
    python3 scripts/gen-borealis-legacy.py gen --only keel,tarknot

WHY

`gen-borealis-chains.py` added five made objects to break the north's value
monoculture, and they work — but they were ADDED, not swapped in, so the north
still ships nineteen tiers of art that predate the house style. Measured off the
files, six of the seven old chains sit INSIDE the documented ice band
(saturation 0.30-0.51 AND value 0.54-0.78 — the same band as the ice they stand
on). Only `tarknot` escapes, by being nearly black:

    driftwood_1  sat 0.33  val 0.65      keel_1       sat 0.43  val 0.57
    wrackline_1  sat 0.44  val 0.60      rimebloom_1  sat 0.42  val 0.62
    frostfont_1  sat 0.47  val 0.72      frostsilk_1  sat 0.50  val 0.65
    tarknot_1    sat 0.32  val 0.24  <- the one that already reads

Every one of them is bleached wood, white rime or white ice on pale blue-white
ground. That is what the player actually sees first: the free opening region is
100% old art, so the north's first impression is the roster's worst.

WHAT CHANGES AND WHAT DOES NOT

The OBJECTS do not change. A drift spar is still a drift spar and the Longhall
is still the Longhall — chains.json, the tier names, the generators, the supply
graph and the quest ladder are all untouched. What changes is the palette and
the finish: each chain gets a colour it owns, dark or saturated enough to clear
the band, painted to the same keyline-and-few-large-masses spec as the rest.

    driftwood   warm chestnut + amber resin      (was bleached silver-grey)
    keel        tarred black + deep red ochre    (was bleached wreck timber)
    rimebloom   saturated violet + gold heart    (was white crystal)
    frostsilk   deep cobalt + gold bands         (was white thread)
    wrackline   dark olive wrack + amber floats  (was pale weed)
    frostfont   near-black basalt + gold water   (was a white ice font)
    tarknot     black pitch + hot orange         (kept — restyled, not recoloured)

COLOUR IS ALLOCATED, NOT PICKED. The north now has twelve chains sharing one
board, so each takes a lane nothing else owns: runestone orange, emberdram rose,
hearthlamp gold, manastone turquoise, wayfinder ivory+rose, and from here
driftwood chestnut, keel red-ochre, rimebloom violet, frostsilk cobalt,
wrackline olive, frostfont basalt, tarknot black.

SIZES ARE PRESERVED, SO Constants.ts IS NOT TOUCHED. Every ITEM_SCALE up here
was hand-tuned against a specific pixel size (`keel_3` is the House class, not
another log), so the cut resamples each new cell to the SAME maximum dimension
as the piece it replaces — see TARGET_PX. Change that and every northern
footprint moves at once.
"""
import argparse
import json
import pathlib
import subprocess
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from merge_style import SNOW_WORLD, TAIL_GREEN, TAIL_MAGENTA, dekey, head, style_ref  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
ARTGEN = ROOT / '.claude/skills/nano-banana/scripts/artgen.py'
WORK = ROOT / 'assets/raw/merge-chains/borealis'
OUT = ROOT / 'assets/sprites/items/chains'
COLOUR_CHECK = WORK / 'colour-check.json'
ALPHA_GAP = 140
PAD = 6

#: Maximum dimension in pixels of the art each piece REPLACES. This is the
#: number ITEM_SCALE was tuned against, so it is the one thing the redraw must
#: not move. Measured off the shipped files before the first regeneration.
TARGET_PX = {
    'driftwood_1': 422, 'driftwood_2': 544, 'driftwood_3': 520,
    'keel_1': 448, 'keel_2': 480, 'keel_3': 660, 'keel_4': 720,
    'tarknot_1': 328, 'tarknot_2': 490, 'tarknot_3': 520,
    'frostsilk_1': 408, 'frostsilk_2': 520, 'frostsilk_3': 546,
    'rimebloom_1': 346, 'rimebloom_2': 499, 'rimebloom_3': 548,
    'wrackline_1': 664, 'frostfont_1': 542,
}

SHEETS = {
    # ----------------------------------------------------- warm chestnut --
    # The sea does bleach wood silver. That is exactly the problem, so this
    # driftwood is wood the sea soaked rather than wood the sun dried.
    'driftwood': {
        'key': 'magenta',
        'cells': [('driftwood', 1), ('driftwood', 2), ('driftwood', 3)],
        'brief': (
            'Three tiers of a DRIFTWOOD chain. Whole trees come north on the current from forests '
            'nobody up here has ever seen, and arrive salt-soaked and heavy. This is the only '
            'firewood in the north.\n\n'
            'THE WOOD IS WARM CHESTNUT BROWN, NOT SILVER-GREY. It is waterlogged, not sun-'
            'bleached: rich dark wet timber, deepest in the grain, with old amber resin still '
            'bleeding out of the splits and catching the light. No driftwood grey, no bone white, '
            'no silvered weathered wood anywhere.\n\n'
            'LEFT — Drift Spar: ONE short thick chunk of sea-worn timber, blunt rounded ends, '
            'rich chestnut brown, one warm amber bead of resin glowing in a split down its side. '
            'Fat and compact, one solid blob.\n\n'
            'MIDDLE — Bound Faggot: a fat bundle of five or six of those spars stood together and '
            'lashed twice around with dark tarred rope, the cut ends facing the viewer, amber '
            'resin glinting in two of them.\n\n'
            'RIGHT — Drift Stack: a low broad woodpile — split logs stacked cut-face-out in a '
            'neat block, capped by two heavy crossed timbers, an axe head buried in the top log. '
            'Warm amber light glows from the gaps deep inside the stack. The silhouette must read '
            'as a LOW BROAD BLOCK WITH A CROSSED CAP.\n\n'
            'PALETTE — rich chestnut #6B3A1E into deep walnut #331A0C in the grain and shadow, '
            'warm ochre #C0803C on the lit upper faces, amber resin #FFB01E into #FFE08A at its '
            'brightest, near-black tarred rope #241A12, near-black outline. No grey, no silver, '
            'no white, no pale blue and no snow on them.'
        ),
    },
    # ------------------------------------------------ tar black + ochre --
    # Worked ship timber, so it is PAINTED — that is what separates it from
    # driftwood, which is the same material untouched by anybody.
    'keel': {
        'key': 'magenta',
        'cells': [('keel', 1), ('keel', 2), ('keel', 3), ('keel', 4)],
        'brief': (
            'Four tiers of a WRECK TIMBER chain — salvaged ship planking, built back up into a '
            'hall. These are not raw logs: every piece was worked by somebody, tarred black '
            'against the sea and painted with a band of deep red ochre along the strake, and the '
            'paint and the tar are what you recognise it by from across the board.\n\n'
            'LEFT — Broken Strake: ONE short thick ship plank, tarred near-black, with a broad '
            'band of deep red-ochre paint running along it and two domed brass nail heads. Blunt '
            'and solid, no splinters and no thin ends.\n\n'
            'SECOND — Lashed Frame: three of those planks lashed with dark rope into a small '
            'sturdy A-frame rib, red ochre on each, brass nails catching the light.\n\n'
            'THIRD — Upturned Hull: a boat hull turned upside down and made into a shelter — '
            'tarred black planks with red-ochre strakes curving over, a low dark doorway cut into '
            'the side with warm gold lamplight coming out of it, set on a footing of dark '
            'stones.\n\n'
            'RIGHT — Longhall: a long low hall built of the same tarred and red-ochre ship '
            'timber, a steep shingled roof, a carved dragon-head prow rising at each gable end, '
            'two small windows glowing warm gold, standing on a low footing of dark stone. The '
            'silhouette must read as a LONG LOW PEAKED ROOF WITH A CARVED PROW AT EACH END.\n\n'
            'PALETTE — near-black tarred timber #1E1712 into #3E3026 on the lit faces, deep red '
            'ochre #B33A22 into #6E1C0E in shadow, warm brass #E8A33C, gold window light #FFD84D '
            'into #FFF6D8, dark stone #2A2A30, near-black outline. No bleached grey planking, no '
            'white, no pale blue, and NO SNOW ON THE ROOFS.'
        ),
    },
    # ----------------------------------------------------------- violet --
    # Frost flowers really are white. A white flower on white ice is the single
    # worst readability case on the board, so this one is magic first, ice second.
    'rimebloom': {
        'key': 'green',
        'cells': [('rimebloom', 1), ('rimebloom', 2), ('rimebloom', 3)],
        'brief': (
            'Three tiers of a RIME BLOOM chain. Where the old magic pooled and then froze, the '
            'ice flowered — and it kept the colour of what it froze around. These are ice, but '
            'they are DEEP SATURATED VIOLET ice lit from inside, never white and never clear.\n\n'
            'THICK BLUNT PETALS, NOT SPIKES. Build each bloom from a FEW broad rounded petals '
            'like thick carved glass, not from many needles — there are already faceted crystals '
            'in this world and these must not be more of them.\n\n'
            'LEFT — Frost Flower: ONE compact closed bud, a tight rosette of thick blunt violet '
            'ice petals wrapped over each other, a small warm gold light burning deep in the '
            'middle of it. Round and solid.\n\n'
            'MIDDLE — Rime Cluster: three of those buds on one short near-black stem, the middle '
            'one just opening to show a gold heart, violet light spilling onto the two beside '
            'it.\n\n'
            'RIGHT — Rime Bloom: one big fully open flower — six broad blunt petals of deep '
            'violet ice, thick as carved glass, radiating out around a SMALL hot gold core no '
            'wider than a fifth of the flower, growing from a squat base of near-black stone. '
            'The silhouette must read as a WIDE OPEN SIX-PETAL STAR ON A LOW BASE.\n\n'
            'THE OPEN FLOWER IS THE DARKEST AND MOST SATURATED OF THE THREE, NOT THE PALEST. Its '
            'petals are deep ink-violet all the way to their edges, deepening to near-black '
            'indigo at the base of every petal, with the pale lit turn confined to one narrow '
            'band along the top edge of each. It must not open up into pale lavender, and its '
            'gold core must stay a small hot point — a candle inside the flower, never a sun '
            'filling half of it.\n\n'
            'PALETTE — saturated violet #6B33C4 into deep indigo #2A1258 in the petal cores, '
            'bright orchid #A87BE8 on the lit faces only, glowing gold heart #FFD84D into #FFF6D8 '
            'at the hottest, near-black stone #22202A, near-black outline. No white, no clear '
            'ice, no pale blue, no lavender as the main mass of anything, no snow.'
        ),
    },
    # ----------------------------------------------------------- cobalt --
    'frostsilk': {
        'key': 'magenta',
        'cells': [('frostsilk', 1), ('frostsilk', 2), ('frostsilk', 3)],
        'brief': (
            'Three tiers of a FROSTSILK chain. Frostsilk takes dye the way nothing else up here '
            'does, and it holds it — a bolt of it is still as deep as the day it was dyed a '
            'century ago, which is exactly why the mage wants it. It is dyed DEEP COBALT BLUE, '
            'rich and dark like lapis or ink, never pale and never icy.\n\n'
            'SILK IS PAINTED AS BROAD GLOSSY MASSES: a few big smooth bands of deep blue with one '
            'crisp narrow sheen running along the turn of each wind. No individual threads, no '
            'fuzz, no hairs, no fine strands.\n\n'
            'LEFT — Frost Thread: ONE fat round ball of deep cobalt silk wound tight, one short '
            'loose end tucked under itself, a single bright sheen band across the top. Compact '
            'and solid, no trailing thread.\n\n'
            'MIDDLE — Spun Skein: a thick twisted hank of the same cobalt silk, folded over and '
            'bound at both ends with warm gold cord, glossy sheen along the twist.\n\n'
            'RIGHT — Light-Fast Spindle: a heavy near-black timber spool wound fat and full with '
            'deep cobalt silk, warm gold bands capping it above and below, one broad glossy sheen '
            'across the wound belly, standing upright on a squat dark base. The silhouette must '
            'read as a FAT WOUND SPOOL ON A BASE.\n\n'
            'PALETTE — deep cobalt #2B3FBF into sapphire-navy #141C5E in the shadows, bright '
            'azure #5C7CFF on the one sheen band only, warm gold #E8A33C cord and caps, near-'
            'black timber #241A14, near-black outline. No white, no ice-blue, no pale blue as the '
            'main mass of anything, no silver, no snow.'
        ),
    },
    # ---------------------------------- olive wrack + near-black basalt --
    # Two single-tier generators, so one 2-across sheet. They are DIFFERENT
    # objects, which the 2-cell LAYOUT block says outright.
    'singles': {
        'key': 'magenta',
        'cells': [('wrackline', 1), ('frostfont', 1)],
        'brief': (
            'TWO different objects from a frozen northern shore. They are not two tiers of one '
            'thing — they are two separate landmarks, drawn on one sheet so they share their '
            'light.\n\n'
            'LEFT — The Wrack Line: a long low heap of storm-cast seaweed along the tide line. '
            'Thick dark olive-brown kelp straps and fronds piled low and wide in a few big glossy '
            'masses, fat amber-gold air bladders showing through them, two dark wet stones and '
            'one loop of tarred rope caught in the heap. Wet and glossy, low and broad and solid, '
            'never a scatter of loose pieces. The silhouette must read as a LOW WIDE MOUND.\n\n'
            'RIGHT — Hoarfrost Font: a squat carved basin on a thick round plinth, cut from '
            'near-black basalt, a band of deep-carved knotwork running around the outside of the '
            'bowl. The bowl is brimming with still meltwater that GLOWS WARM GOLD from inside and '
            'lights the carved stone around the rim, with one thin runnel spilling over the lip '
            'and down the plinth. The silhouette must read as a WIDE SHALLOW BOWL ON A THICK '
            'COLUMN.\n\n'
            'PALETTE — the wrack is dark olive-brown #4A4A1E into near-black #1E200E in its '
            'depths with warm ochre #A88A2E on the lit fronds and amber bladders #FFB01E; the '
            'font is near-black basalt #1C1E24 into #3A3E48 on the lit faces with gold water '
            '#FFD84D into #FFF6D8 at its brightest; near-black outline on both. No white, no pale '
            'grey stone, no pale blue, no clear ice and no snow on either of them.'
        ),
    },
    # ------------------------------------------------ black + hot orange --
    # The one piece that already read. Restyled to the house spec, NOT recoloured.
    'tarknot': {
        'key': 'magenta',
        'cells': [('tarknot', 1), ('tarknot', 2), ('tarknot', 3)],
        'brief': (
            'Three tiers of a PITCH chain. Buried tar, dug out of the thawed ground and burned. '
            'KEEP IT BLACK AND ORANGE — this chain already reads correctly against the ice and '
            'the colours are not what is being changed; what is being changed is the finish, '
            'which must now match the reference exactly: a heavy keyline, a few large glossy '
            'masses, and the heat coming from INSIDE the pitch rather than from any surface '
            'reflection.\n\n'
            'LEFT — Tar Knot: ONE glossy rounded lump of black pitch, knotted and bulbous like a '
            'bead of hardened resin, with a single hot orange crack running across it and light '
            'coming up out of the crack. Compact and solid.\n\n'
            'MIDDLE — Pitch Cake: a thick round pressed cake of the same black pitch, strapped '
            'around its middle with a dark iron band, a web of hot orange cracks glowing through '
            'its face from within.\n\n'
            'RIGHT — Black Ember: a big faceted lump of black pitch burning from the inside, wide '
            'orange-to-white-hot fissures splitting its surface, sitting in a shallow black iron '
            'dish, with two or three embers lifting off the top. The silhouette must read as a '
            'BIG ROUNDED LUMP IN A SHALLOW DISH.\n\n'
            'PALETTE — near-black pitch #14100E into #322620 where the light catches its gloss, '
            'hot orange #FF7A1E into gold #FFD84D and white-hot #FFF6D8 deep in the fissures, '
            'black iron #1A1A1E, near-black outline. No grey, no white, no pale blue, no snow.'
        ),
    },
}


def do_gen(only: set) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / 'prompts').mkdir(exist_ok=True)
    for name, spec in SHEETS.items():
        if only and name not in only:
            continue
        tail = TAIL_GREEN if spec['key'] == 'green' else TAIL_MAGENTA
        prompt = head(len(spec['cells'])) + SNOW_WORLD + spec['brief'] + tail
        (WORK / 'prompts' / f'{name}-redraw.txt').write_text(prompt + '\n')
        out = WORK / f'{name}-redraw.jpg'
        print(f'-> {out.relative_to(ROOT)}  ({len(spec["cells"])} cells)', flush=True)
        r = subprocess.run(
            ['python3', str(ARTGEN), 'character', prompt, '-i', style_ref(spec['key']),
             '-o', str(out)],
            capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout[-2000:] + r.stderr[-2000:])
            sys.exit(f'{name} failed')


def column_runs(im: Image.Image) -> list:
    """Split a sheet on the gaps between objects (see gen-borealis-chains.py)."""
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
    meta = json.loads(COLOUR_CHECK.read_text()) if COLOUR_CHECK.exists() else {}
    for name, spec in SHEETS.items():
        if only and name not in only:
            continue
        src = WORK / f'{name}-redraw.jpg'
        keyed = dekey(src, WORK / f'{name}-redraw-keyed.png')
        runs = column_runs(keyed)
        want = len(spec['cells'])
        if len(runs) != want:
            print(f'  ! {name}: {len(runs)} objects for {want} cells, taking the widest {want}')
            runs = sorted(sorted(runs, key=lambda r: r[1] - r[0])[-want:])
        for (chain, tier), (x0, x1) in zip(spec['cells'], runs):
            cell = keyed.crop((x0, 0, x1, keyed.height))
            bb = cell.getbbox()
            cell = cell.crop((max(0, bb[0] - PAD), max(0, bb[1] - PAD),
                              min(cell.width, bb[2] + PAD), min(cell.height, bb[3] + PAD)))
            stem = f'{chain}_{tier}'
            # Resample to the footprint ITEM_SCALE was tuned against, not to a
            # ladder — these scales are hand-set per piece and per size class.
            s = TARGET_PX[stem] / max(cell.size)
            cell = cell.resize((max(1, round(cell.width * s)), max(1, round(cell.height * s))),
                               Image.LANCZOS)
            cell.save(OUT / f'{stem}.png')
            cell.save(OUT / f'{stem}.webp', 'WEBP', quality=94, method=6)
            sat, val = mean_hsv(cell)
            meta[stem] = [round(sat, 4), round(val, 4)]
            flag = '' if (sat >= 0.55 or val <= 0.52 or val >= 0.80) else '   <-- IN THE ICE BAND'
            print(f'  {stem:<16s} {str(cell.size):<12s} sat {sat:.2f} val {val:.2f}{flag}')
    COLOUR_CHECK.write_text(json.dumps(meta, indent=1, sort_keys=True) + '\n')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('what', choices=['gen', 'cut'])
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    sel = {s for s in a.only.split(',') if s}
    (do_gen if a.what == 'gen' else do_cut)(sel)
