#!/usr/bin/env python3
"""The north's FIVE FARMS — ten chains, thirty pieces, on the farm structure.

    python3 scripts/gen-borealis-farms.py gen      # 10 sheets, 3-across each
    python3 scripts/gen-borealis-farms.py cut
    python3 scripts/gen-borealis-farms.py gen --only glasskiln,seaglass

THE STRUCTURE (six pieces per farm, and every farm has all six)

    FIXTURE chain   part  ->  assembly  ->  THE MACHINE      (t3 is the generator)
    PRODUCT chain   small ->  bigger    ->  THE ICON         (what it makes)

The machine produces `product` t1 on its cooldown, and every TWELFTH production
also drops `fixture` t1 — so a working farm slowly pays out the parts for a
SECOND farm, and three of those parts merge to the assembly, three assemblies
merge to a whole new machine. That is the only way the north grows a new
generator, and it is why the fixture ladder is two tiers and not one.

WHY THESE FIVE, AND WHAT THEY REPLACE

The north's old roster was a materials yard: drift spars, wreck timber, a wrack
heap, a tar knot, a thread, a rime flower, an ice font. Redrawing them did not
help, because the problem was never the paint — a heap of wood and a heap of
weed are THE SAME KIND OF THING, and nothing there had a shape a player could
name from across the board. All seven are deleted, the boat-and-timber family
first: nothing in this game should ask a player to tell a Broken Strake from a
Lashed Frame from a Drift Spar.

These five are crafts instead, and every tier-3 is a single object you can name
out loud: a ship in a bottle, an orrery, a horned helm, a burning ember heart, a
woven cloak of aurora. Each machine is likewise one silhouette — a beehive kiln,
a brass bench, a hooded forge, a domed tar kiln, an upright loom.

COLOUR IS ALLOCATED, NOT PICKED, because fifteen northern chains now share one
board. The five farms of the compass wave hold orange, rose, gold, turquoise and
ivory-rose; these five take the five lanes left that clear the ice band:

    glasskiln  / seaglass      deep bottle green + terracotta
    starbench  / orrery        brass + midnight blue
    wreckforge / warhelm       crimson + black iron
    tarkiln    / emberheart    black + hot orange
    auroraloom / auroraweave   violet + silver

ROLES ARE INHERITED. `emberheart` takes `tarknot`'s job as the north's dragon
fuel and `auroraweave` takes `frostsilk`'s as Selyna's material, so the diet
graph and the recipient locks are unchanged in shape — only the objects moved.
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
WORK = ROOT / 'assets/raw/merge-chains/borealis-farms'
OUT = ROOT / 'assets/sprites/items/chains'
COLOUR_CHECK = ROOT / 'assets/raw/merge-chains/borealis/colour-check.json'
ALPHA_GAP = 140
PAD = 6

#: On-board units per tier. A PRODUCT is an item in your hand and sits on the
#: ladder every other chain uses; a FIXTURE ends in a landmark you build a farm
#: around, so its top tier is deliberately much bigger than an item ever is.
TARGET_PRODUCT = {1: 66, 2: 88, 3: 118}
TARGET_FIXTURE = {1: 66, 2: 92, 3: 170}
#: Authored at 6x the on-board size, so ITEM_SCALE is 1/6 for every piece here.
OVERSAMPLE = 6

FIXTURE, PRODUCT = 'fixture', 'product'

CHAINS = {
    # ================================================ deep bottle green ==
    # The one craft the north can actually do: sand, fire and wreck-glass.
    'glasskiln': {
        'kind': FIXTURE,
        'key': 'magenta',
        'brief': (
            'Three steps of building a GLASS KILN. The north has sand, driftwood and a hundred '
            'years of broken bottles off the wrecks, and that is all glass has ever needed.\n\n'
            'LEFT — Fire Brick: ONE thick chunky firebrick of warm terracotta clay, its edges '
            'scorched near-black, one face still glowing hot orange from within the scorch. A '
            'solid rectangular block, nothing thin.\n\n'
            'MIDDLE — Kiln Grate: a heavy arched black iron grate standing on two of those '
            'bricks, bright orange coals glowing through the bars, one iron rod resting across '
            'the top.\n\n'
            'RIGHT — The Glass Kiln: a squat BEEHIVE KILN — a fat domed oven of terracotta brick '
            'banded with black iron hoops, a low arched mouth at the front blazing hot orange, a '
            'short chimney at the top, and one long iron blowpipe leaning against it with a '
            'glowing green blob of molten glass on its end. The silhouette must read as a FAT '
            'DOME WITH A GLOWING ARCHED MOUTH.\n\n'
            'PALETTE — warm terracotta brick #B0562C into deep scorched umber #4A1E10, black iron '
            '#16161A, kiln fire hot orange #FF7A1E into gold #FFD84D and white-hot #FFF6D8 in the '
            'mouth, one accent of deep bottle green #1F6B3A on the molten glass, near-black '
            'outline. No grey, no white, no pale blue, no snow — the kiln has melted it off.'
        ),
    },
    'seaglass': {
        'kind': PRODUCT,
        'key': 'magenta',
        'brief': (
            'Three tiers of a SEA GLASS chain — what the kiln makes, ending in the thing every '
            'sailor in the north wants. This is DEEP BOTTLE GREEN glass, dark and rich and '
            'saturated like a wine bottle held up to a lamp, never pale, never mint, never icy '
            'and never clear.\n\n'
            'PAINT THE GLASS THE WAY THE REFERENCE BOTTLES ARE PAINTED: thick hand-painted glass '
            'with a bold near-black outline, broad soft highlight bands, one crisp white '
            'specular, and light GLOWING from inside the glass rather than reflecting off it.\n\n'
            'LEFT — Glass Float: ONE round ball of deep bottle-green glass in a loose cradle of '
            'dark tarred net, a warm glow deep inside it. Fat, round and solid.\n\n'
            'MIDDLE — Glass Buoy: a bigger green glass sphere fully wrapped in dark rope netting '
            'with a heavy brass ring and hook at the top, glowing from within.\n\n'
            'RIGHT — The Bottled Ship: a fat green glass bottle LYING ON ITS SIDE in a low cradle '
            'of near-black timber, a chunky cork in its neck, and inside the bottle a tiny '
            'perfect ship in warm cream and gold under a full sail, lit as though the bottle held '
            'its own small daylight. The silhouette must read as a BOTTLE LYING DOWN ON A CRADLE, '
            'clearly horizontal, wider than it is tall.\n\n'
            'PALETTE — deep bottle green #1F6B3A into near-black forest #0C2A16 in the depths, '
            'bright emerald #45C46A where the light comes through, warm cream sail #FFF3E2 and '
            'gold #E8A33C on the little ship, brass #E8A33C, near-black timber and netting '
            '#241A12, near-black outline. No white, no pale blue, no mint, no snow.'
        ),
    },
    # ================================================ brass + midnight ==
    # Selyna's other trade: the ice kept the instruments, so the north reads
    # the sky better than anywhere warm ever did.
    'starbench': {
        'kind': FIXTURE,
        'key': 'magenta',
        'brief': (
            'Three steps of building a STARWRIGHT\'S BENCH — the workbench where the salvaged '
            'brass instruments of drowned ships are taken apart and made into new ones.\n\n'
            'LEFT — Brass Cog: ONE thick chunky brass gear wheel with big blunt teeth, lying flat '
            'and tilted toward the viewer, warm and polished with a deep bronze shadow. Solid and '
            'compact, no thin spokes.\n\n'
            'MIDDLE — Gear Ring: three of those brass cogs meshed together inside a heavy brass '
            'ring, mounted on a small block of near-black timber, one blue gem set in the ring.\n\n'
            'RIGHT — The Starwright\'s Bench: a sturdy near-black timber workbench, and standing '
            'up from its top on a short spindle a BIG UPRIGHT BRASS GEAR WHEEL, toothed all the '
            'way round and turned edge-on to the viewer like a mill wheel, with a crank handle on '
            'its hub. A brass vice grips the near corner of the bench and two brass tools and a '
            'small blue lamp lie on the top. The silhouette must read as A BENCH WITH ONE BIG '
            'UPRIGHT TOOTHED WHEEL STANDING ON IT.\n\n'
            'NO RINGS AND NO GLOBE. There must be no armillary, no crossed hoops, no orbit rings '
            'and no sphere anywhere on this bench — another piece in this game already owns that '
            'shape, and these two must never be mistaken for each other at icon size. The wheel '
            'is a FLAT TOOTHED DISC seen edge-on, not a ring around anything.\n\n'
            'PALETTE — warm polished brass #E8A33C into deep bronze #7A4A12 in the shadows and '
            'pale gold #FFE0A0 on the lit turns, midnight blue #1B2A6B into near-black navy '
            '#0A1030, one bright star-white #FFF6D8 glint inside the globe, near-black timber '
            '#241A14, near-black outline. No grey, no white, no pale blue, no snow.'
        ),
    },
    'orrery': {
        'kind': PRODUCT,
        'key': 'magenta',
        'brief': (
            'Three tiers of an ORRERY chain — brass optics and clockwork, ending in the '
            'instrument the whole north navigates by. Everything here is WARM POLISHED BRASS '
            'against DEEP MIDNIGHT BLUE, and it must read gold-on-navy from across the board.\n\n'
            'LEFT — Ground Lens: ONE thick round lens of dark blue glass in a chunky brass rim, '
            'lying tilted toward the viewer, a crisp white glint across it. Fat, round and '
            'solid.\n\n'
            'MIDDLE — Spyglass: a short chunky brass telescope of three fat draw tubes, capped in '
            'dark blue leather with brass studs, lying at an angle.\n\n'
            'RIGHT — The Orrery: a heavy brass instrument — a fat glowing midnight-blue globe '
            'held at the centre of TWO BROAD BRASS RINGS crossing around it, with three small '
            'gold planets on brass arms, standing on a squat round base of near-black stone. Warm '
            'light comes out of the globe onto the brass. The silhouette must read as A GLOWING '
            'BALL INSIDE CROSSED RINGS ON A ROUND BASE.\n\n'
            'PALETTE — warm polished brass #E8A33C into deep bronze #7A4A12, pale gold #FFE0A0 on '
            'the lit edges, deep midnight blue #1B2A6B into near-black navy #0A1030 in the glass '
            'and the globe, one white-gold #FFF6D8 core light, near-black stone #22202A, '
            'near-black outline. No grey, no white, no pale blue, no silver, no snow.'
        ),
    },
    # ================================================ crimson + iron ==
    'wreckforge': {
        'kind': FIXTURE,
        'key': 'magenta',
        'brief': (
            'Three steps of building a WRECK FORGE. Every wreck brings iron ashore — nails, '
            'chain, anchor stock — and the north melts it back down and makes it into armour.\n\n'
            'LEFT — Iron Billet: ONE short fat bar of dark iron, blunt at both ends, heated to a '
            'glowing crimson-orange down its middle. A solid chunky block, nothing thin.\n\n'
            'MIDDLE — Forge Bellows: a fat leather bellows with a dark iron nozzle and heavy '
            'brass tacks along its rim, deep oxblood-red leather, standing on a small dark '
            'block.\n\n'
            'RIGHT — The Wreck Forge: a squat stone forge with a heavy black HOOD and short '
            'chimney above it, the coal bed underneath blazing crimson and orange, a black anvil '
            'standing beside it with a hammer resting on top, and the bellows lashed to its '
            'flank. The silhouette must read as A HOODED CHIMNEY OVER A GLOWING BED, WITH AN '
            'ANVIL BESIDE IT.\n\n'
            'PALETTE — near-black iron #16161A into #38383E on the lit faces, deep crimson coal '
            '#C41E28 into hot orange #FF7A1E and white-hot #FFF6D8 at the core, oxblood leather '
            '#7A1E1E, warm brass #E8A33C tacks, dark stone #2A2A30, near-black outline. No grey '
            'stone as the main mass, no white, no pale blue, no snow.'
        ),
    },
    'warhelm': {
        'kind': PRODUCT,
        'key': 'magenta',
        'brief': (
            'Three tiers of a WAR HELM chain — what the forge makes. This is dark iron with DEEP '
            'CRIMSON as its colour, and it must read as armour at a glance, never as scrap.\n\n'
            'LEFT — Iron Cap: ONE small round iron skullcap, a simple domed helmet with a broad '
            'crimson band riveted around its rim and two brass rivets. Round, fat and solid.\n\n'
            'MIDDLE — Banded Helm: a heavier helmet with a black iron nose-guard down the front, '
            'brass banding over the crown, deep crimson padding showing at the neck.\n\n'
            'RIGHT — The Horned Helm: a big dark iron war helm with a fierce nose-and-brow guard, '
            'heavy brass banding, a deep crimson horsehair crest running over the crown, and TWO '
            'BROAD CURVING HORNS in warm bone sweeping out and up from the sides. It sits on a '
            'squat block of near-black timber. The silhouette must read as A HELMET WITH TWO BIG '
            'CURVED HORNS.\n\n'
            'PALETTE — near-black iron #16161A into steel #4A4A54 on the lit crown, deep crimson '
            '#C41E28 into oxblood #6E0E14 in the shadows for the crest and padding, warm brass '
            '#E8A33C banding, warm bone horns #E8D2A0 (warm, never blue-white), near-black '
            'timber #241A14, near-black outline. No pale grey steel as the main mass, no white, '
            'no pale blue, no snow.'
        ),
    },
    # ================================================ black + orange ==
    # The north's dragon fuel. Inherits `tarknot`'s job exactly.
    'tarkiln': {
        'kind': FIXTURE,
        'key': 'magenta',
        'brief': (
            'Three steps of building a TAR KILN. Under the permafrost there is buried pitch, and '
            'a kiln cooks it out of the ground — the only thing in the north that burns hot '
            'enough for a dragon.\n\n'
            'LEFT — Tar Spile: ONE short fat copper tap-spout, warm and polished, with a thick '
            'black bead of pitch hanging from its lip and catching a hot orange light. Compact '
            'and solid.\n\n'
            'MIDDLE — Tar Bucket: a squat black iron bucket with a heavy handle, brimming with '
            'glossy black pitch, one copper spile hooked over its rim, hot orange light glinting '
            'off the surface of the tar.\n\n'
            'RIGHT — The Tar Kiln: a low DOMED EARTHEN KILN of dark packed clay banded with black '
            'iron, a copper tap at the front running a thick black ribbon of pitch into a squat '
            'iron pot, hot orange fire glowing out of a vent slot in the dome and up its short '
            'chimney. The silhouette must read as A LOW DOME WITH A TAP AND A POT AT ITS '
            'FOOT.\n\n'
            'PALETTE — near-black clay #1E1712 into #3E3026 on the lit dome, glossy black pitch '
            '#0E0C0A with a hard specular, warm copper #C4702A into #7A3A12, hot orange fire '
            '#FF7A1E into #FFD84D and #FFF6D8 at the vent, black iron #16161A, near-black '
            'outline. No grey, no white, no pale blue, no snow.'
        ),
    },
    'emberheart': {
        'kind': PRODUCT,
        'key': 'magenta',
        'brief': (
            'Three tiers of an EMBER HEART chain — rendered pitch, and what a dragon in the north '
            'is actually fed. KEEP IT BLACK AND HOT ORANGE: glossy near-black pitch with the heat '
            'coming from INSIDE it, never from a surface reflection.\n\n'
            'LEFT — Pitch Bead: ONE glossy near-black droplet of hardened pitch, fat and rounded '
            'like a bead of amber, with a single hot orange crack running across it and light '
            'coming up out of the crack. Compact and solid.\n\n'
            'MIDDLE — Pitch Loaf: a thick black brick of pressed pitch wrapped in dark waxed '
            'cloth with a warm gold wax seal stamped on the front, a web of hot orange cracks '
            'glowing through the exposed end.\n\n'
            'RIGHT — The Ember Heart: a big rounded lump of near-black pitch CRACKED OPEN like a '
            'geode, its whole interior a blazing orange-to-white-hot core throwing light out of '
            'the split onto everything around it, cradled in a squat black iron ring on three '
            'short legs, with two or three embers lifting off the top. The silhouette must read '
            'as A SPLIT ROUND STONE IN AN IRON CRADLE.\n\n'
            'PALETTE — near-black pitch #14100E into #322620 where the gloss catches, hot orange '
            '#FF7A1E into gold #FFD84D and white-hot #FFF6D8 deep in the core, warm gold wax seal '
            '#E8A33C, black iron #1A1A1E, near-black outline. No grey, no white, no pale blue, '
            'no snow.'
        ),
    },
    # ================================================ violet + silver ==
    # Selyna's material. Inherits `frostsilk`'s recipient lock exactly.
    'auroraloom': {
        'kind': FIXTURE,
        'key': 'green',
        'brief': (
            'Three steps of building an AURORA LOOM. The lights come down low over the north, and '
            'someone worked out how to catch them on a warp and weave them into cloth.\n\n'
            'LEFT — Silver Spindle: ONE short fat spindle of dark silver, wound thick with '
            'glowing violet thread, a small round whorl weight at its base. Fat and compact, no '
            'loose trailing thread.\n\n'
            'MIDDLE — Loom Comb: a heavy dark silver weaving comb with thick blunt teeth, a band '
            'of glowing violet light caught between the teeth, standing on a small dark block.\n\n'
            'RIGHT — The Aurora Loom: a tall UPRIGHT WARP-WEIGHTED LOOM of near-black timber with '
            'dark silver fittings, a broad sheet of glowing violet aurora light hanging down it '
            'in place of a warp, round stone weights swinging along the bottom edge, and a '
            'finished band of violet cloth rolled at the top. The silhouette must read as AN '
            'UPRIGHT RECTANGULAR FRAME WITH A SHEET OF LIGHT HANGING IN IT.\n\n'
            'PALETTE — near-black timber #1A1720 into #3A3448 on the lit faces, dark silver '
            '#6E7488 into #2A2E3A in shadow, glowing violet #7A3AD6 into deep indigo #2A1258 at '
            'the edges and bright orchid #B98BF0 at the brightest, near-black outline. No white, '
            'no pale blue, no pale grey, no snow — and nothing green, mint or teal anywhere.'
        ),
    },
    'auroraweave': {
        'kind': PRODUCT,
        'key': 'green',
        'brief': (
            'Three tiers of an AURORA WEAVE chain — cloth woven out of the northern lights, and '
            'the mage\'s material. It is DEEP SATURATED VIOLET, lit from within, with dark silver '
            'fittings; never pale, never lavender, never white.\n\n'
            'CLOTH IS PAINTED AS A FEW BIG GLOSSY MASSES with one crisp sheen along the turn of '
            'each fold. No individual threads, no fuzz, no fine strands, no lace.\n\n'
            'LEFT — Light Thread: ONE fat round ball of glowing violet thread wound tight, one '
            'short end tucked under itself, a single bright sheen across the top. Compact and '
            'solid, no trailing thread.\n\n'
            'MIDDLE — Woven Bolt: a thick short bolt of folded violet cloth bound at both ends '
            'with dark silver cord, the light running along the folds.\n\n'
            'RIGHT — The Aurora Cloak: a heavy hooded cloak of deep violet aurora cloth, folded '
            'and hung over a squat near-black stand so the HOOD stands up at the top and the '
            'cloth falls in a few broad glowing folds below it, fastened at the throat by a big '
            'round dark silver clasp with a violet stone in it. The silhouette must read as A '
            'STANDING HOOD OVER A FALL OF CLOTH.\n\n'
            'PALETTE — deep violet #7A3AD6 into near-black indigo #2A1258 in the fold shadows, '
            'bright orchid #B98BF0 on the lit turns only, dark silver #6E7488 clasp and cord, '
            'near-black stand #1A1720, near-black outline. No white, no pale blue, no lavender as '
            'the main mass, no snow — and nothing green, mint or teal anywhere.'
        ),
    },
}


def do_gen(only: set) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / 'prompts').mkdir(exist_ok=True)
    for name, spec in CHAINS.items():
        if only and name not in only:
            continue
        tail = TAIL_GREEN if spec['key'] == 'green' else TAIL_MAGENTA
        prompt = head(3) + SNOW_WORLD + spec['brief'] + tail
        (WORK / 'prompts' / f'{name}.txt').write_text(prompt + '\n')
        out = WORK / f'{name}.jpg'
        print(f'-> {out.relative_to(ROOT)}  ({spec["kind"]})', flush=True)
        r = subprocess.run(
            ['python3', str(ARTGEN), 'character', prompt, '-i', style_ref(spec['key']),
             '-o', str(out)],
            capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout[-1500:] + r.stderr[-1500:])
            print(f'   ! {name} failed, continuing')


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
    meta = json.loads(COLOUR_CHECK.read_text()) if COLOUR_CHECK.exists() else {}
    for name, spec in CHAINS.items():
        if only and name not in only:
            continue
        src = WORK / f'{name}.jpg'
        if not src.exists():
            print(f'  - {name}: no sheet')
            continue
        keyed = dekey(src, WORK / f'{name}-keyed.png')
        runs = column_runs(keyed)
        if len(runs) != 3:
            print(f'  ! {name}: {len(runs)} objects, taking the widest 3')
            runs = sorted(sorted(runs, key=lambda r: r[1] - r[0])[-3:])
        ladder = TARGET_FIXTURE if spec['kind'] == FIXTURE else TARGET_PRODUCT
        for tier, (x0, x1) in zip((1, 2, 3), runs):
            cell = keyed.crop((x0, 0, x1, keyed.height))
            bb = cell.getbbox()
            cell = cell.crop((max(0, bb[0] - PAD), max(0, bb[1] - PAD),
                              min(cell.width, bb[2] + PAD), min(cell.height, bb[3] + PAD)))
            s = ladder[tier] / max(cell.size) * OVERSAMPLE
            cell = cell.resize((max(1, round(cell.width * s)), max(1, round(cell.height * s))),
                               Image.LANCZOS)
            stem = f'{name}_{tier}'
            cell.save(OUT / f'{stem}.png')
            cell.save(OUT / f'{stem}.webp', 'WEBP', quality=94, method=6)
            sat, val = mean_hsv(cell)
            meta[stem] = [round(sat, 4), round(val, 4)]
            flag = '' if (sat >= 0.55 or val <= 0.52 or val >= 0.80) else '   <-- IN THE ICE BAND'
            print(f'  {stem:<18s} {str(cell.size):<12s} sat {sat:.2f} val {val:.2f}{flag}')
    COLOUR_CHECK.write_text(json.dumps(meta, indent=1, sort_keys=True) + '\n')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('what', choices=['gen', 'cut'])
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    sel = {s for s in a.only.split(',') if s}
    (do_gen if a.what == 'gen' else do_cut)(sel)
