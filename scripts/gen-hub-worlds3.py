#!/usr/bin/env python3
"""Batch 3 of hub-world candidates — painterly tile surface, not PBR.

Batches 1 and 2 kept rendering the deck as scanned photographic stone with
PBR shading: roughness, micro-pitting, speckle, normal-map grain. That is the
opposite of this game's own law. docs/map-art-style.md, measured off the
shipped backdrop:

    "Deck. Large flat quads with soft rounded bevels and essentially no
     interior texture - no grain, no speckle, no visible brushwork. Seams are
     thin dark grooves with a slightly lighter chamfer on the upper-left lip
     of each stone. The only interior incident is the occasional hairline
     crack drawn as a single dark line."

So batch 3 adds a TILE SURFACE section stating that directly, plus a global
anti-PBR clause. The camera and grid fixes from batch 2 are kept — they worked.

  python3 scripts/gen-hub-worlds3.py [--only key,key] [--prompts-only]
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

THE ONLY REFERENCE IMAGE IS A LAYOUT DIAGRAM — never draw it. It has TWO SEPARATE LAYERS and they are not the same thing:
- Its WHITE region is the whole solid landmass — the rock body, including the cliff and the rim.
- Its BLUE DIAMONDS are only the paved floor laid ON TOP of that rock.
- The WHITE-MINUS-BLUE band, the white that has no blue on it, is BARE ROCK AND GROUND: the rim around the paving and the cliff below it. That band must be visible on every side.
- Its black is everything that is NOT this land.

THE ISLAND IS A SOLID MASS OF ROCK WITH A FLOOR LAID ON IT — NOT A HEAP OF TILES. This is the mistake to avoid above all others: do NOT build the island out of the flagstones themselves, do NOT extrude the paving downward into columns, and do NOT make the cliff face out of stacked tile cubes. The cliff is continuous natural rock in its own courses and strata, quite unlike the flagstones. The paving is a thin floor resting on the top surface only, INSET from the edge, so a band of bare rock, soil and growth always separates the last flagstone from the drop.

Reproduce exactly two pieces of land at those shapes, positions and relative sizes: one big irregular plateau filling most of the frame, and one tiny 2x2 pad off to its right, separated from it. No blue lines, no blue strokes, no outlines, no wireframe, no white fill and no black fill may appear in the finished picture.

RENDER STYLE. Stylised hand-crafted game art: simplified, confident forms carrying rich painted detail, soft rounded bevels, warm handmade craft. NOT photorealistic, NOT a photograph, NOT a physically-based engine render. Equally NOT a flat vector cartoon, NOT hard cel-shading, NOT thick uniform outlines. Think a hand-painted diorama: every surface deliberate and tactile, but the shapes stylised and readable rather than photographed.

NO PBR ANYWHERE. No physically-based material rendering, no scanned or photographic textures, no roughness/normal/specular map detail, no raytraced reflections, no subsurface scattering, no lens effects. All shading is PAINTED — form described by soft value steps and hand-placed highlights, never by simulated microsurface.

THE TILE SURFACE — PAINTERLY TEXTURE, NOT PBR. THIS KEEPS BEING GOT WRONG.
The flagstones DO carry real, visible surface texture — but it is PAINTED texture, described with brushwork, not simulated material:
- Hand-painted stone character on every face: soft mottling in the colour, subtle painted veining, a few worn chips and rounded corners, gentle colour variation from stone to stone so no two are identical. The brush is visible in it.
- What it must NOT be: photographic or scanned stone, PBR roughness / normal / specular micro-detail, procedural noise, uniform gravel speckle, grit, dirt maps or any simulated microsurface. No physically-based shading of the surface.
- The test: it should read as a beautifully hand-painted tabletop miniature — texture built from deliberate brushstrokes and value shifts — never as a photograph of granite.
- Texture lives at the scale of the STONE (broad painted variation across each face), not at pixel scale as fine noise. Keep the deck calm overall.
- Seams between stones are thin dark grooves with a slightly lighter chamfer along the upper-left lip of each stone.

CAMERA — ORTHOGRAPHIC, AND THIS DECIDES THE PAVING. Fixed 2:1 isometric three-quarter view from about 30 degrees above. TRUE ORTHOGRAPHIC PROJECTION: absolutely no vanishing point, no perspective convergence, no camera tilt, and NO HORIZON LINE anywhere. Parallel edges stay parallel across the whole frame. A perspective camera would force the floor stones to draw as receding squares — which is wrong. Under a correct orthographic isometric camera every paving stone is a DIAMOND.

THE PAVING GRID IS THE SINGLE MOST IMPORTANT REQUIREMENT.
Every paving stone is exactly ONE blue diamond from the diagram — one diamond, one stone, in the same place.
- Each stone is a RHOMBUS: four corners pointing up, down, left and right, exactly twice as wide as it is tall, edges about 30 degrees above and below horizontal.
- A SQUARE FLAGSTONE IS WRONG. A grid receding to a vanishing point is wrong. The stones are diamonds of identical size and angle everywhere, near edge and far edge alike.
- Rows dead straight and parallel right across the deck; stones meet edge to edge and corner to corner with a thin even groove.
- NOT ONE stone overlapping, crossing, bending, tapering, rotating or changing size. No brick-offset, cobbled, hexagonal, radial or random paving. A stone at the rim is cleanly cut by it.
- STONE SIZE: the stones are LARGE. Do not subdivide a diamond. The big plateau carries 249 stones in total, at most 18 in a single row. The small pad is exactly 2 by 2, four stones.

THE SHAPE. The plateau is deliberately IRREGULAR — never a square, diamond, circle or regular polygon. Follow the diagram's ragged coastline: a headland at the north-west, a wide bay bitten into the south-west rim, a notched inlet on the east side.

VALUE LAW. The surroundings are the brightest, highest-contrast part of the picture. The plateau sits below them in value and reads as one quiet solid shape. The paved deck stays calm and mid-value — the flattest, quietest area on the canvas.
"""

SURROUND = """
THE SURROUNDING WORLD — NOT OPTIONAL, AND IT MUST FILL THE FRAME.
A thin or empty surround is the single worst failure this image can have.
{SURROUND}
- Depth in three ranks separated by CONTRAST alone — near at full contrast, mid one step down, far reduced to shape and rim light. Never by hazing, lightening, desaturating or hue-shifting.
- Layered atmosphere between the ranks so the eye reads real distance.

NOT THIS. No characters, creatures, people, text, labels, UI, watermark or logo. No buildings or props on the paved deck — the deck stays empty and playable. Nothing overhangs the deck edge. No drawn grid lines on the ground. No horizon line, no perspective convergence, no photorealism, no PBR materials, no flat cartoon shading, no empty surround.
"""

WORLDS = {
    'duneheart': {
        'setting': 'half-buried in an ocean of golden desert dunes',
        'body': """THE SETTING. The plateau rises out of deep wind-sculpted sand. Dunes bank against its western cliff and spill in a smooth tongue over part of the deck itself; sand streams off the eastern rim in a fine airborne veil, caught by the wind. Wind ripples comb the dune faces in long parallel curves.

LIGHT. High hard desert sun from the upper left, outside frame. Warm sunlit sand (#E8C88A lit, #C89C57 mid) against surprisingly cool violet-blue shadow (#6E6A93) — that warm/cool split is the whole palette. Heat shimmer only in the far distance.

THE DECK. Pale sun-bleached sandstone flagstones (shadow #8A7A5E, mid #C9B58E, lit #EFE0BE), painted with soft hand-painted mottling, with drifted sand collected in the grooves and a soft dune tongue across one corner. Sparse dry tussock grass (#A89A5C) in a few seams.

THE RIM AND CLIFF. Wind-carved sandstone in soft horizontal strata, undercut and smoothed by the wind, half-drowned in sand at the base.""",
        'surround': """- An ocean of dunes filling the whole frame, combed with long parallel wind ripples, in big simple painted forms rather than photographic sand.
- A scatter of wind-carved rock outcrops and half-buried stone stumps receding into the distance.
- Streaming veils of airborne sand blowing off every crest, catching the light.
- Long soft dune shadows raking across the frame.""",
    },
    'stonecircle': {
        'setting': 'set on a windswept highland moor under low grey weather',
        'body': """THE SETTING. The plateau sits on an open upland moor, heather and rough grass running away in every direction under a low ceiling of grey cloud. A ring of ancient standing stones rises from the moor around it — not on the deck, but out on the heath nearby. Wind bends everything one way.

LIGHT. Overcast and diffuse, no hard shadows, but a single shaft of pale sun breaks through the cloud far off and lights one patch of moor bright green-gold (#D7CE8E) — the only bright note in a muted frame.

THE DECK. Cool grey flagstones (shadow #4A4E52, mid #7E8388, lit #B0B5B8), damp and matte, painted flat, with dark moss and short wiry grass in the grooves (#3E5138, #6B7A45).

THE RIM AND CLIFF. A low weathered stone escarpment, lichen-blotched in simple painted patches, heather crowding its base.""",
        'surround': """- Open rolling moor filling the frame — heather in muted purple-brown (#6E5A63) and tawny grass (#9A8B5E), painted in broad soft masses.
- A ring of tall ancient standing stones out on the heath, leaning, lichen-patched, receding in scale.
- A low ceiling of grey cloud with one bright break and a visible shaft of light on the distant ground.
- Wind visible in everything: grass combed flat, a few bent thorn trees, streaming cloud.
- Far hills reduced to flat blue-grey shapes.""",
    },
    'cavernlake': {
        'setting': 'standing on an island in a vast underground cavern lake',
        'body': """THE SETTING. The plateau is an island in still black water inside an enormous cave. Colossal stalactites hang from a ceiling lost in dark, and stone columns rise out of the lake. The ceiling is spangled with thousands of tiny blue-green GLOWWORM lights, doubled perfectly in the mirror-still water — this world's signature.

LIGHT. No sun. Cold blue-green bioluminescence from above (#5FE0C8) and a faint warm amber glow from cracks deep in the rock (#E0A055). Everything is modelled in low key; the deck is the brightest thing because it catches the glowworm light.

THE DECK. Dark slate flagstones (shadow #1E2530, mid #3E4A57, lit #6E7C8B), painted with soft hand-painted mottling, matte, catching a cool rim of glowworm light along each bevel, with pale luminous lichen (#8FE6C8) picked out in a few grooves.

THE RIM AND CLIFF. Wet dark stone in blocky courses, a pale mineral waterline, flowstone drapes running down into the lake.""",
        'surround': """- The cavern itself filling every part of the frame: colossal stalactites above, stone columns and flowstone rising from the water, a far wall lost in dark.
- Thousands of glowworm points across the whole ceiling, dense near and fine far, all doubled in the water.
- Dead-still black water holding sharp inverted reflections of columns and lights.
- Rafts of pale mineral crust and a few half-drowned boulders around the island.
- Three depth ranks receding into the dark by contrast alone.""",
    },
    'bamboogrove': {
        'setting': 'enclosed by a tall misty bamboo grove',
        'body': """THE SETTING. The plateau sits in a clearing inside a dense bamboo forest. Thousands of tall pale-jade culms rise vertically all around it, disappearing up out of frame, their leaves a soft canopy overhead. Low mist lies between the stems. Fallen bamboo leaves drift across the deck.

LIGHT. Soft filtered green daylight, cool and even, with a few pale gold shafts slipping between the culms. The mist takes the light and glows softly.

THE DECK. Warm grey flagstones (shadow #55584E, mid #8E907F, lit #C2C3AE), painted with soft hand-painted mottling, matte, with fine moss in the grooves (#4E7440) and a scatter of fallen jade-yellow bamboo leaves (#B9C46A) gathered at the rim.

THE RIM AND CLIFF. A low mossy dry-stone edge, three or four courses, ferns and young bamboo shoots crowding its base.""",
        'surround': """- Dense vertical bamboo filling the entire frame around the clearing, culms in pale jade to deep green (#7FA05A, #3E5F3A), receding rank behind rank.
- The strong vertical rhythm of the stems as the dominant graphic texture — painted, not photographic.
- Low mist banks lying between the culms, thickest in the far distance so the grove fades to soft green.
- Pale gold light shafts slipping through the stems, catching drifting leaves and pollen.
- Ferns and undergrowth around the plateau's base.""",
    },
    'saltmirror': {
        'setting': 'standing alone on an endless white salt flat under a huge sky',
        'body': """THE SETTING. The plateau stands on a vast, dead-flat salt pan covered by a millimetre of still water, which turns the whole ground into a perfect mirror to the edge of the frame. Dry patches show the salt's hexagonal crust polygons. The plateau and everything else is doubled exactly in the reflection.

LIGHT. Enormous soft daylight from a huge pale sky. Cool white salt (#EAF0F2 lit, #C2CDD4 shadow) with a faint warm horizon glow reflected in the water film (#E8D9C0). Almost shadowless, luminous, dreamlike.

THE DECK. Pale bone-white flagstones (shadow #9AA0A2, mid #C9CFCF, lit #F0F3F2), painted with soft hand-painted mottling, with a fine crust of white salt gathered in the grooves and a few small dry salt polygons near the rim.

THE RIM AND CLIFF. Pale stone in simple courses, its lower blocks crusted white with salt, standing in the mirror film and doubled beneath.""",
        'surround': """- The mirror salt flat running to the frame edge in every direction, holding a perfect inverted reflection of sky, plateau and pad.
- Hexagonal salt-crust polygons patterning the drier areas in pale painted lines.
- A huge open sky filling the upper frame — soft graded pale blue with high thin cloud, all of it doubled in the ground.
- A few distant salt ridges and lone rock stumps reduced to flat shapes on the horizon line of the reflection.
- Faint wind ripples disturbing the mirror in a couple of places.""",
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
