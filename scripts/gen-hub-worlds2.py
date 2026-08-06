#!/usr/bin/env python3
"""Batch 2 of hub-world candidates — GROUNDED settings, rendered by Seedream.

Batch 1 (gen-hub-worlds.py) was five variations on a floating sky island. This
batch puts the same plateau inside a real place: an island in the sea, a
clearing ringed by forest, a crater lake, a terraced valley, a mangrove fen.

Two failures from batch 1 are addressed in the shared head:

  1. Seedream drifted to a PERSPECTIVE camera with a horizon line, and once the
     camera has a vanishing point the paving stones necessarily draw as squares
     receding — which is why every batch-1 deck came out square instead of the
     2:1 isometric diamonds the grid specifies. So the camera clause is now
     explicitly orthographic and names the consequence.
  2. It drifted to photoreal. Countered by naming the target as stylised
     hand-crafted game art AND naming the opposite failure (flat cartoon), so
     it has a corridor rather than one wall to run from.

  python3 scripts/gen-hub-worlds2.py [--only key,key] [--prompts-only]
"""
import argparse
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTGEN = os.path.join(ROOT, '.claude/skills/nano-banana/scripts/artgen.py')
MASK = os.path.join(ROOT, 'tools/mapmask/out/hub-map-mask.png')
OUT = os.path.join(ROOT, 'assets/raw/map-gen/hub')

HEAD = """A single finished game-world backdrop illustration: a large irregular plateau of paved stone, {SETTING}.

THE ONLY REFERENCE IMAGE IS A LAYOUT DIAGRAM — never draw it. Its white regions are the exact silhouette of the land, cliff sides included. Its blue diamonds are the exact paving grid on top. Its black is everything that is NOT this land. Reproduce exactly two pieces of land at those shapes, positions and relative sizes: one big irregular plateau filling most of the frame, and one tiny 2x2 pad off to its right, separated from it. No blue lines, no blue strokes, no outlines, no wireframe, no white fill and no black fill may appear in the finished picture.

RENDER STYLE — READ THIS TWICE. Stylised hand-crafted game art: simplified, confident forms carrying rich painted detail, soft rounded bevels, warm handmade craft. It is NOT photorealistic, NOT a photograph, NOT a physically-based engine render, NOT hyperreal. Equally it is NOT a flat vector cartoon, NOT hard cel-shading, NOT thick uniform outlines, NOT a simple mobile-game illustration. The target sits between those two failures: think a high-end painted diorama or a miniature model of a world — every surface detailed and tactile, but the shapes stylised and readable rather than photographed.

CAMERA — ORTHOGRAPHIC, AND THIS DECIDES THE PAVING. Fixed 2:1 isometric three-quarter view from about 30 degrees above. TRUE ORTHOGRAPHIC PROJECTION: absolutely no vanishing point, no perspective convergence, no camera tilt, and NO HORIZON LINE anywhere in the picture. Parallel edges stay parallel across the whole frame and never converge. This matters because a perspective camera forces the floor stones to draw as receding squares — which is wrong. Under a correct orthographic isometric camera every paving stone is a DIAMOND.

THE PAVING GRID IS THE SINGLE MOST IMPORTANT REQUIREMENT.
Every paving stone is exactly ONE blue diamond from the diagram — one diamond, one stone, in the same place.
- Each stone is a RHOMBUS: four corners pointing up, down, left and right, exactly twice as wide as it is tall, its edges running about 30 degrees above and below the horizontal.
- A SQUARE FLAGSTONE IS WRONG. A square rotated to look like a diamond is wrong. A grid receding to a vanishing point is wrong. The stones are diamonds of identical size and angle everywhere on the deck, near edge and far edge alike.
- Rows dead straight and parallel right across the deck, stones meeting edge to edge and corner to corner with a thin even groove between them.
- NOT ONE stone overlapping, crossing, bending, tapering, rotating or changing size. No brick-offset, cobbled, hexagonal, radial, fanned or random paving. A stone meeting the plateau rim is cleanly cut by it.
- STONE SIZE: the stones are LARGE. Do not subdivide a diamond into smaller stones. The big plateau carries 249 stones in total, at most 18 in a single row. The small pad is exactly 2 by 2, four stones.

THE SHAPE. The plateau is deliberately IRREGULAR — never a square, diamond, circle or regular polygon. Follow the diagram's ragged coastline: a headland pushing out at the north-west, a wide bay bitten into the south-west rim, a notched inlet on the east side.

VALUE LAW. The surroundings are the brightest, highest-contrast part of the picture. The plateau sits below them in value and reads as one quiet solid shape. The paved deck stays calm and mid-value — it is the flattest, quietest area on the canvas and nothing on it may compete with the rim or the setting.
"""

SURROUND = """
THE SURROUNDING WORLD — THIS IS NOT OPTIONAL AND MUST FILL THE FRAME.
The setting is a real, populated place, not a backdrop. A thin or empty surround is the single worst failure this image can have. Include all of it:
{SURROUND}
- Depth in three ranks separated by CONTRAST alone — near elements at full contrast, mid one step down, far reduced to shape and rim light. Never by hazing, lightening, desaturating or hue-shifting.
- Layered atmosphere between the ranks so the eye reads real distance.

NOT THIS. No characters, creatures, people, boats with crews, text, labels, UI, watermark or logo. No buildings or props on the paved deck itself — the deck stays empty and playable. Nothing overhangs the deck edge. No drawn grid lines on the ground — the floor pattern is carved stone seams only. No horizon line, no perspective convergence, no photorealism, no flat cartoon shading, no empty surround.
"""

WORLDS = {
    'seaisle': {
        'setting': 'rising as an island from the middle of a bright shallow sea',
        'body': """THE SETTING. The plateau is an island. Its cliff sides drop straight into clear turquoise water that shallows to pale jade over sandbanks around it and deepens to rich teal further out (#8FE3D6 shallows, #2E9E9A mid, #16505E deep). White surf breaks in soft rings against the rock, foam curling and dissipating; wet dark stone at the waterline, a pale tide-mark band above it.

LIGHT. High bright daylight from the upper left, sun outside the frame. The water throws dancing caustic reflections up onto the lower cliff faces (#BFF3E6). Cool bounce below, warm sun above.

THE DECK. Sun-bleached limestone flagstones (shadow #7A705A, mid #C0B294, lit #EFE4CA) with salt-tough grass and low sea-thrift in the grooves (#5C8A4E, #86B84F), thinning to bare stone at the rim. Dry, bright, calm.

THE RIM AND CLIFF. Weathered pale rock in chunky rounded courses stepping down to the water, barnacled and dark at the waterline, tufted with hardy grass at the top edge.""",
        'surround': """- Open sea filling the whole frame around the island, its surface worked with stylised wave detail — not a flat colour.
- A scatter of roughly twenty smaller rock islets and sea stacks around it, some with a grass cap, some bare, ringed by their own surf.
- Pale sandbanks and reefs showing through the shallow water as bright jade shapes.
- Seabirds wheeling in small flocks, and a few thin white wave-lines far out.""",
    },
    'deepwood': {
        'setting': 'sitting in a wide clearing in the middle of an ancient forest',
        'body': """THE SETTING. The plateau is a raised stone platform in a forest clearing, ringed on every side by enormous ancient trees whose canopy closes overhead at the frame edges. Deep moss and fern carpet the forest floor below the plateau's low cliff. Mist pools between the trunks. Shafts of green-gold light slant down through gaps in the canopy onto the deck.

LIGHT. Filtered forest daylight — cool green shade (#2C4A33) with warm gold shafts (#E8D9A0) cutting through it. The deck is the brightest thing in the frame because the clearing is where the light gets in.

THE DECK. Old grey flagstones (shadow #4A4A42, mid #8C8A7C, lit #C8C5B2), damp and lichen-patched, with moss creeping in from every groove (#2F5A34, #5A8F45) and heaviest at the shaded rim.

THE RIM AND CLIFF. A low mossy stone escarpment, two or three courses, thick with fern and root, dropping to the forest floor.""",
        'surround': """- Enormous ancient trees ringing the clearing on all sides, their trunks massive and their canopy closing over the top corners of the frame — the plateau sits in a green room.
- Dense undergrowth, ferns, fallen mossy logs and roots across the forest floor around the base.
- Layers of mist pooling between the trunks, deepest in the far distance so the forest recedes into soft green.
- Volumetric light shafts stabbing down through the canopy gaps, catching drifting pollen and insects.
- Hanging vines and a few glowing forest mushrooms at the base of the far trees.""",
    },
    'calderalake': {
        'setting': 'standing on an island in the middle of a volcanic crater lake',
        'body': """THE SETTING. The plateau rises from a still, milky turquoise crater lake (#5FC9C4 lit, #2A7E86 mid, #14424E deep), ringed far off by dark ash-grey caldera walls. Thin ribbons of white steam drift up off the water where hot vents rise. The lake surface is glassy and mirror-still, holding soft inverted reflections.

LIGHT. Overcast bright, diffuse and even, with one cool break of pale sky lighting the water from above. Almost no hard shadow — everything modelled by soft form shading.

THE DECK. Dark basalt flagstones (shadow #23262B, mid #4A4F57, lit #7C838C) shot through with pale mineral veining, dry and matte, with sparse yellow-green sulphur lichen in the grooves (#9CA84B).

THE RIM AND CLIFF. Columnar black basalt, blocky and vertical, pale mineral crust staining the waterline where the hot lake meets the rock.""",
        'surround': """- The still turquoise crater lake filling the frame around the island, mirror-smooth with soft reflections.
- Dark ash-grey caldera walls ringing the far distance, layered and streaked, reduced to flat shapes by distance.
- Ribbons and columns of white steam rising off vents across the water, some near and dense, some far and faint.
- A scatter of smaller black basalt stacks and half-submerged rocks around the island.
- Pale mineral crusting rings on the water surface around each vent.""",
    },
    'paddyvale': {
        'setting': 'set among flooded terraced paddies in a misty green valley',
        'body': """THE SETTING. The plateau stands amid descending terraces of flooded paddy fields, each a mirror of water held by a low earth bank, stepping away in broad curves. Beyond them the valley climbs into soft green hills lost in morning mist.

LIGHT. Soft early-morning light, sun low and outside the frame to the left, the whole valley under a gentle warm haze. The flooded terraces catch and throw back the pale sky (#DCE7DC), turning the ground into a field of soft mirrors.

THE DECK. Warm grey-brown flagstones (shadow #5B5348, mid #97897A, lit #D2C5B0), worn smooth, with fine bright rice-green grass in the grooves (#7FA83F, #A8C862).

THE RIM AND CLIFF. A stacked dry-stone retaining wall, mossy at the base where it meets the water of the highest terrace.""",
        'surround': """- Broad flooded paddy terraces stepping away in every direction, each a still mirror edged by a low green bank — this is the dominant texture of the frame.
- Reflections of the pale sky and the plateau held in the water.
- Soft green hills climbing behind, receding into morning mist in three clear depth ranks.
- Bunds and narrow footpaths threading between the terraces, a few small water channels catching the light.
- Drifting low mist ribbons lying in the folds of the valley.""",
    },
    'mangrovefen': {
        'setting': 'raised out of a still mangrove wetland at blue-hour dusk',
        'body': """THE SETTING. The plateau sits in black glassy wetland water, out of which rise dense tangles of mangrove root and low twisted trees. The water is dead still and holds perfect dark reflections. It is the blue hour: the light has gone but the sky still glows.

LIGHT. Deep blue-hour ambience (#2B3E63 upper, #4E6E96 lower) with a last band of pale warm gold low on one side (#D7A968). Hundreds of FIREFLIES drift through the whole frame, warm gold points (#FFD98A), densest among the mangrove roots and doubled in the water's reflection. They are this world's signature.

THE DECK. Cool grey flagstones (shadow #2E3440, mid #565F6E, lit #8C95A4), damp, with dark moss in the grooves and a faint sheen picking up the sky.

THE RIM AND CLIFF. Old stone blocks furred with dark moss and hung with mangrove roots reaching down into the water, pale water-line staining at the base.""",
        'surround': """- Dense mangrove thickets ringing the plateau, their arching stilt roots tangled above the water and doubled in reflection.
- Dead-still black water filling the frame, holding sharp inverted reflections of trees, sky and fireflies.
- Hundreds of fireflies at every depth, near ones large and soft, far ones fine points.
- Low mist lying flat on the water surface in the middle distance.
- Silhouetted dead trees and low twisted branches receding into the blue dusk in three depth ranks.""",
    },
}


def build(key):
    w = WORLDS[key]
    return (HEAD.replace('{SETTING}', w['setting']) + '\n' + w['body'] + '\n'
            + SURROUND.replace('{SURROUND}', w['surround']))


def render(key, prompt):
    dst = os.path.join(OUT, 'worlds', f'{key}.jpg')
    r = subprocess.run([sys.executable, ARTGEN, 'map-seedream', prompt,
                        '-i', MASK, '-o', dst], capture_output=True, text=True)
    out = (r.stdout or r.stderr).strip().splitlines()
    return key, out[-1] if out else 'no output'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--prompts-only', action='store_true')
    args = ap.parse_args()
    keys = [k.strip() for k in args.only.split(',') if k.strip()] or list(WORLDS)

    os.makedirs(os.path.join(OUT, 'prompts'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'worlds'), exist_ok=True)
    prompts = {}
    for k in keys:
        prompts[k] = build(k)
        with open(os.path.join(OUT, 'prompts', f'{k}.txt'), 'w') as fh:
            fh.write(prompts[k])
        print(f'{k:14s} prompt {len(prompts[k])} chars')
    if args.prompts_only:
        return
    with ThreadPoolExecutor(max_workers=len(keys)) as ex:
        for key, line in ex.map(lambda k: render(k, prompts[k]), keys):
            print(f'{key:14s} {line}')


if __name__ == '__main__':
    main()
