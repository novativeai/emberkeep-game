#!/usr/bin/env python3
"""Hub zones, batch 2 — lore places on the same plateau. CORRECTED TEMPLATE.

Carries over what worked in batch 1 (gen-hub-zones.py): the two-layer mask
reading, the rock-body-not-tile-raft clause, the orthographic camera clause that
fixes square flagstones, and the DECOR LAW from docs/map-art-style.md — props at
edges and corners, rune work inlaid FLUSH, middle of the deck left open.

TWO FIXES, both from observed failures. Any future batch must keep them.

1. PALETTE AND VALUE LAW. Batch 1's skydock came back cartoony: a bright
   saturated sea painted as a near-flat colour field, candy shapes, a striped
   awning. The cause is large uniform high-chroma areas — they read as vector
   art no matter how good the render clause is. Hence the muted-base /
   chroma-as-accent / no-flat-fields rules.

2. DECOR ORDER. Adding fix 1 pushed DECOR LAW down an 8.6k-char prompt, and the
   two zones with the richest environment text (chainworks, ashfall) spent their
   attention there and came back as bare slabs — deleted. The zone's DECOR is
   its whole identity, so it now sits HIGH, immediately after the layout, before
   any style or camera instruction, and is framed as a mandatory checklist.
   DO NOT move it back down, and do not let the surround text outgrow it.

  python3 scripts/gen-hub-zones2.py [--only key,key] [--prompts-only]
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

# 1 — what it is, and the mask's two layers.
LAYOUT = """A single finished game-world backdrop illustration for a fantasy merge game: {TITLE} — a large irregular plateau of paved stone, {SETTING}.

THE ONLY REFERENCE IMAGE IS A LAYOUT DIAGRAM — never draw it. It has TWO SEPARATE LAYERS and they are not the same thing:
- Its WHITE region is the whole solid landmass — the rock body, including the cliff and the rim.
- Its BLUE DIAMONDS are only the paved floor laid ON TOP of that rock.
- The WHITE-MINUS-BLUE band, the white that carries no blue, is BARE ROCK AND GROUND: the rim around the paving and the cliff below it. That band must be visible on every side.
- Its black is everything that is NOT this land.

THE ISLAND IS A SOLID MASS OF ROCK WITH A FLOOR LAID ON IT — NOT A HEAP OF TILES. Do NOT build the island out of the flagstones, do NOT extrude the paving downward into columns, do NOT make the cliff out of stacked tile cubes. The cliff is continuous natural rock in its own strata. The paving is a thin floor on the top surface only, inset from the edge, with a band of bare rock and growth between the last flagstone and the drop.

Reproduce exactly two pieces of land at those shapes, positions and relative sizes: one big irregular plateau filling most of the frame, and one tiny 2x2 pad off to its right. No blue lines, no blue strokes, no outlines, no wireframe, no white fill and no black fill may appear in the finished picture.
"""

# 2 — the zone's identity. STAYS HIGH. An undressed deck is a failed image.
DECOR_LAW = """
DECOR — THE MOST IMPORTANT CONTENT REQUIREMENT. READ THIS BEFORE ANYTHING ELSE.
This is a specific inhabited PLACE, not an empty platform. AN UNDRESSED DECK IS A FAILED IMAGE. Every item in the list below must actually appear in the picture — treat it as a checklist and account for each one. At the same time the board must stay playable, so placement is strict:
- ALL structures and props sit at the EDGES AND CORNERS of the deck, or straddle the rim, or hang off the cliff. THE MIDDLE OF THE DECK STAYS OPEN — a broad clear area of plain paving in the centre with nothing standing on it.
- Anything in the open floor area is INLAID FLUSH into the paving, level with the stones, never standing proud of them: circular rune discs, inlaid metal channels, a mosaic ring, carved glyph lines. These read as pattern in the floor, not as objects.
- A carved border course runs around the whole deck edge, one stone deep, marking the paved area off from the bare rock rim.
THE CHECKLIST FOR THIS ZONE:
{DECOR}
- Warm gold metal (#F7A437 into #FFD84D) is the signature material of this world's craft: fittings, chain links, lantern frames, inlay, door furniture. Use it as the one warm accent and keep it sparing.
- Heavy gold chains with big rounded links run from the plateau out to the small pad and off into the distance, with ornate cast clasps where they anchor.
"""

# 3 — how it is painted.
CRAFT = """
RENDER STYLE. Stylised hand-crafted fantasy game art: simplified confident forms carrying rich painted detail, soft rounded bevels, warm handmade craft. NOT photorealistic, NOT a photograph, NOT a physically-based engine render. Equally NOT a flat vector cartoon, NOT hard cel-shading, NOT thick uniform outlines. A hand-painted diorama of a real place.

PALETTE AND VALUE LAW — THIS IS WHAT KEEPS IT OUT OF CARTOON TERRITORY.
- NO LARGE FLAT AREAS OF UNIFORM SATURATED COLOUR anywhere in the picture. Every big region — sky, water, ground, rock face, foliage mass — must carry continuous painted variation across it: value gradients, broken colour, warm and cool drifting through it, edges softening and hardening. A big even patch of one bright hue is the single strongest cartoon tell and is forbidden.
- The base palette is MUTED and slightly earthy — greys, ochres, muted blues and greens, colours mixed rather than pure. High chroma is reserved for SMALL accents only: flame, glowing inlay, a lantern, a single lit break in the cloud. Never a candy, toy or neon palette.
- Value does the work. Read the picture in greyscale and it must still be legible: a clear dark, mid and light structure. Do not let everything sit at the same bright middle value.
- Props are BUILT OBJECTS with weight, joinery, wear and sag — not simplified mascot-like shapes with clean bright colours.

NO PBR ANYWHERE. No scanned or photographic textures, no roughness/normal/specular micro-detail, no raytraced reflections, no lens effects. All shading is PAINTED — form described by soft value steps and hand-placed highlights.

THE TILE SURFACE — PAINTERLY TEXTURE, NOT PBR. The flagstones DO carry visible surface texture, but it is PAINTED: soft mottling in the colour, subtle painted veining, a few worn chips and rounded corners, gentle variation stone to stone so no two are identical, the brush visible in it. NEVER photographic granite, procedural noise, uniform speckle or grit. Texture at the scale of the STONE, not pixel-scale noise. Seams are thin dark grooves with a slightly lighter chamfer along the upper-left lip of each stone.
"""

# 4 — camera and lattice.
CAMERA = """
CAMERA — ORTHOGRAPHIC, AND THIS DECIDES THE PAVING. Fixed 2:1 isometric three-quarter view from about 30 degrees above. TRUE ORTHOGRAPHIC PROJECTION: no vanishing point, no perspective convergence, no tilt, NO HORIZON LINE. Parallel edges stay parallel across the frame. A perspective camera would force the floor stones to draw as receding squares — wrong. Under a correct orthographic isometric camera every paving stone is a DIAMOND.

THE PAVING GRID. Every paving stone is exactly ONE blue diamond from the diagram — one diamond, one stone, in the same place. Each stone is a RHOMBUS, four corners pointing up/down/left/right, twice as wide as tall, edges about 30 degrees off horizontal. A SQUARE FLAGSTONE IS WRONG. Rows dead straight and parallel across the whole deck; stones meet edge to edge with a thin even groove; not one stone overlapping, bending, rotating or changing size; no brick-offset, cobbled, hexagonal or random paving. The stones are LARGE: the plateau carries 249 in total, at most 18 in a row. The pad is exactly 2 by 2, four stones.

THE SHAPE. Deliberately IRREGULAR — never a square, diamond, circle or regular polygon. Follow the diagram's ragged coastline: a headland at the north-west, a wide bay bitten into the south-west rim, a notched inlet on the east.
"""

# 5 — the world around it. Kept deliberately shorter than the decor checklist.
SURROUND = """
THE SURROUNDING WORLD — NOT OPTIONAL, AND IT MUST FILL THE FRAME.
A thin or empty surround is a serious failure, but it never comes at the cost of the decor checklist above — the zone's own props and structures come first.
{SURROUND}
- Depth in three ranks separated by CONTRAST alone — near at full contrast, mid a step down, far reduced to shape and rim light. Never by hazing or desaturating.

NOT THIS. No characters, creatures or people anywhere. No text, labels, UI, watermark or logo. No bare undressed deck. Nothing standing in the middle of the deck. Nothing overhangs a deck edge into the air unsupported. No drawn grid lines. No horizon line, no perspective convergence, no photorealism, no PBR, no flat cartoon shading, no flat saturated colour fields, no empty surround.
"""

ZONES = {
    'lanternfall': {
        'title': 'THE LANTERN SHRINE',
        'setting': 'above flooded stone terraces in cold dawn mist',
        'body': """THE SETTING. The plateau rises out of a vast staircase of flooded terraces — broad shallow pools stepping down and away, each held by a low mossy stone wall, each holding a still sheet of water. Cold white mist lies in the hollows and thins as it climbs. It is the first light of morning, barely up.

LIGHT. Very soft and cool, everything low-contrast except the shrine itself: dozens of small warm lanterns are the only real light source, their glow pooling on the wet stone and doubling in the water below. Pale gold breaks along one edge of the sky.

THE DECK. Damp blue-grey flagstones (shadow #3E4750, mid #6E7A82, lit #9EAAB0) dark with wet, painted mottling, a thin sheet of standing water in places holding soft reflections.""",
        'decor': """- THE SIGNATURE: a small open SHRINE PAVILION straddling the southern rim — four carved stone posts, a curved tiled roof, gold finial, and inside it a stone basin of clear water with a single steady flame burning above the surface. Rope-hung lanterns crowd its eaves.
- Inlaid flush in the paving: a circular offering rune of concentric rings with a lotus-petal glyph band, its channels gold-filled and holding a shallow film of water so it mirrors the lantern light.
- Around the rim: rows of stone lantern posts of different heights, prayer chains of small gold bells strung between them, low mossy retaining walls, a bronze gong on a timber frame at one corner.
- A worn stone stair descending through the rim into the first terrace pool, its lowest treads submerged.""",
        'surround': """- Terrace after flooded terrace filling the whole lower frame, stepping away in shallow curved shelves, each a still mirror broken by grass tufts and low walls.
- Drifts of cold mist lying in the lower terraces and streaming between them, thinning upward.
- More lantern posts scattered far out along the terrace walls, their reflections making a chain of small lights into the distance.
- Dark pines and a bent stone bridge on the mid slopes, far ridges as flat cool shapes under a pale dawn band.""",
    },
    'frostwatch': {
        'title': 'THE FROSTWATCH',
        'setting': 'on a rock island in a broken glacier under a winter night sky',
        'body': """THE SETTING. The plateau is bare dark rock standing out of a shattered glacier — a field of tilted ice slabs, deep crevasses and pressure ridges running away in every direction. Wind has scoured snow into long combed drifts against the cliff.

LIGHT. Night, but not black: the ice itself is luminous, glowing cold blue-green from within the crevasses and up onto the underside of the cliff. Above, a faint auroral drift and hard stars. The beacon fire on the rim is the one warm thing in the whole frame.

THE DECK. Dark basalt flagstones (shadow #1C222B, mid #3A4450, lit #626F7C) with painted mottling, packed snow filling the grooves and drifted along the windward edges.""",
        'decor': """- THE SIGNATURE: a stout stone WATCHTOWER on the north-west headland — a tapering drum of dark masonry, gold-banded, with an open crown holding a BEACON FIRE burning bright orange, its light raking across the near ice. An ironbound gold-fitted door at its foot. The fire belongs on top of the tower, not on the deck.
- Inlaid flush in the paving: a circular ward rune of concentric rings and angular glyphs, its gold channels warm against the cold stone, the snow melted clear in a ring around it.
- Around the rim: a low windbreak wall of stacked stone, iron braziers hooded against the weather, a rack of long signal horns, coiled rope and ice tools, frost-furred gold chains running out over the glacier.
- A stair cut down through the rim onto the ice, its treads snow-filled, marked by two gold-capped posts.""",
        'surround': """- The broken glacier filling the frame — tilted slabs, seracs and pressure ridges in painted planes of blue-white, cool grey and deep teal.
- Crevasses glowing from within, cold light rising out of them and lighting the ice edges above.
- Long combed snow drifts and wind-scour patterns leading the eye outward.
- Distant black nunatak peaks as flat dark shapes, a quiet auroral wash and dense stars above.""",
    },
    'roothold': {
        'title': 'THE ROOTHOLD ARCHIVE',
        'setting': 'inside the hollow trunk of a colossal ancient tree',
        'body': """THE SETTING. The plateau sits on the floor of an enormous hollow tree. Walls of ribbed bark and living wood curve up and out of frame on every side; vast roots as thick as towers arch overhead and plunge into the ground around the island. Far above, a ragged opening lets one shaft of daylight down.

LIGHT. Green-gold gloom. A single broad shaft of daylight falls from the opening onto part of the deck and blows out to warm cream where it lands; everything outside it drops away into deep umber and moss shadow. Small lantern glows and a faint blue-green fungal light fill the dark.

THE DECK. Honey-brown flagstones (shadow #3A2C1E, mid #7A5F3E, lit #B99464) veined with fine root threads growing through the grooves, painted mottling, moss at the shaded edges.""",
        'decor': """- THE SIGNATURE: the ARCHIVE built into the eastern rim — tiers of carved wooden shelves and pigeonholes set straight into the trunk wall, crammed with scroll cases and bound volumes, reached by a leaning ladder on a gold rail, with a heavy reading lectern of carved wood and gold beside it and a small ironbound door under the lowest tier.
- Inlaid flush in the paving: a circular knowledge rune of concentric rings and a script band, its channels gold-filled, with thin inlaid gold lines branching out of it across the floor like root traces.
- Around the rim: stacked map chests and scroll baskets, a stone bowl of blue-green glowing fungus, hanging lanterns on gold chain from the roots above, carved wooden posts wound with ivy.
- A rootbridge of one flattened root arching off the north-west headland into the dark.""",
        'surround': """- The trunk's inner wall filling the entire frame edge — deep vertical bark ribs, knots, burls and old scars, curving away above.
- Colossal roots arching over and around the island, some sheathed in moss, one carrying a plank walkway with a rope rail.
- The single daylight shaft falling from the ragged opening far above, dust motes turning in it.
- Clusters of pale glowing fungus and hanging vines on the walls, thickening in the dark corners.""",
    },
}


def build(key):
    z = ZONES[key]
    return (LAYOUT.replace('{TITLE}', z['title']).replace('{SETTING}', z['setting'])
            + DECOR_LAW.replace('{DECOR}', z['decor'])
            + '\n' + z['body'] + '\n'
            + CRAFT + CAMERA
            + SURROUND.replace('{SURROUND}', z['surround']))


def render(key, prompt):
    dst = os.path.join(OUT, 'zones', f'{key}.jpg')
    r = subprocess.run([sys.executable, ARTGEN, 'map-seedream', prompt,
                        '-i', MASK, '-o', dst], capture_output=True, text=True)
    out = (r.stdout or r.stderr).strip().splitlines()
    return key, out[-1] if out else 'no output'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--prompts-only', action='store_true')
    args = ap.parse_args()
    keys = [k.strip() for k in args.only.split(',') if k.strip()] or list(ZONES)

    os.makedirs(os.path.join(OUT, 'prompts'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'zones'), exist_ok=True)
    prompts = {}
    for k in keys:
        prompts[k] = build(k)
        with open(os.path.join(OUT, 'prompts', f'zone-{k}.txt'), 'w') as fh:
            fh.write(prompts[k])
        print(f'{k:12s} prompt {len(prompts[k])} chars')
    if args.prompts_only:
        return
    with ThreadPoolExecutor(max_workers=len(keys)) as ex:
        for key, line in ex.map(lambda k: render(k, prompts[k]), keys):
            print(f'{key:12s} {line}')


if __name__ == '__main__':
    main()
