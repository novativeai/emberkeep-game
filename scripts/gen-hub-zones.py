#!/usr/bin/env python3
"""Five hub ZONES — the same plateau dressed as a real place in the game's lore.

Every previous batch told the model "no props on the deck, keep it empty and
playable". That kept the board clear and stripped out everything that made it
somewhere. The base map does not work that way; docs/map-art-style.md, measured
off the shipped backdrop:

    "Decor. Faceted crystal clusters, fat gold chains with heavy rounded links,
     circular inlaid rune pads, lava basins with a waterfall spilling off the
     edge. Decor clusters at island EDGES AND CORNERS; the middle of a deck is
     left empty."

That is the rule that gives identity without eating the play surface, and it is
what these five use. Two further tricks keep the board usable: rune discs are
INLAID FLUSH into the paving rather than standing on it, and every raised
structure sits on the rim or straddles the cliff edge.

Lore drawn from the game's own data — the Keeper, Eleanor of the Daughters of the Moon, gold
keys, braziers, hatches, the forge, gold chains between islands.

  python3 scripts/gen-hub-zones.py [--only key,key] [--prompts-only]
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

HEAD = """A single finished game-world backdrop illustration for a fantasy merge game: {TITLE} — a large irregular plateau of paved stone, {SETTING}.

THE ONLY REFERENCE IMAGE IS A LAYOUT DIAGRAM — never draw it. It has TWO SEPARATE LAYERS and they are not the same thing:
- Its WHITE region is the whole solid landmass — the rock body, including the cliff and the rim.
- Its BLUE DIAMONDS are only the paved floor laid ON TOP of that rock.
- The WHITE-MINUS-BLUE band, the white that carries no blue, is BARE ROCK AND GROUND: the rim around the paving and the cliff below it. That band must be visible on every side.
- Its black is everything that is NOT this land.

THE ISLAND IS A SOLID MASS OF ROCK WITH A FLOOR LAID ON IT — NOT A HEAP OF TILES. Do NOT build the island out of the flagstones, do NOT extrude the paving downward into columns, do NOT make the cliff out of stacked tile cubes. The cliff is continuous natural rock in its own strata. The paving is a thin floor on the top surface only, inset from the edge, with a band of bare rock and growth between the last flagstone and the drop.

Reproduce exactly two pieces of land at those shapes, positions and relative sizes: one big irregular plateau filling most of the frame, and one tiny 2x2 pad off to its right. No blue lines, no blue strokes, no outlines, no wireframe, no white fill and no black fill may appear in the finished picture.

RENDER STYLE. Stylised hand-crafted fantasy game art: simplified confident forms carrying rich painted detail, soft rounded bevels, warm handmade craft. NOT photorealistic, NOT a photograph, NOT a physically-based engine render. Equally NOT a flat vector cartoon, NOT hard cel-shading, NOT thick uniform outlines. A hand-painted diorama of a real place.

NO PBR ANYWHERE. No scanned or photographic textures, no roughness/normal/specular micro-detail, no raytraced reflections, no lens effects. All shading is PAINTED — form described by soft value steps and hand-placed highlights.

THE TILE SURFACE — PAINTERLY TEXTURE, NOT PBR. The flagstones DO carry visible surface texture, but it is PAINTED: soft mottling in the colour, subtle painted veining, a few worn chips and rounded corners, gentle variation stone to stone so no two are identical, the brush visible in it. NEVER photographic granite, procedural noise, uniform speckle or grit. Texture at the scale of the STONE, not pixel-scale noise. Seams are thin dark grooves with a slightly lighter chamfer along the upper-left lip of each stone.

CAMERA — ORTHOGRAPHIC, AND THIS DECIDES THE PAVING. Fixed 2:1 isometric three-quarter view from about 30 degrees above. TRUE ORTHOGRAPHIC PROJECTION: no vanishing point, no perspective convergence, no tilt, NO HORIZON LINE. Parallel edges stay parallel across the frame. A perspective camera would force the floor stones to draw as receding squares — wrong. Under a correct orthographic isometric camera every paving stone is a DIAMOND.

THE PAVING GRID. Every paving stone is exactly ONE blue diamond from the diagram — one diamond, one stone, in the same place. Each stone is a RHOMBUS, four corners pointing up/down/left/right, twice as wide as tall, edges about 30 degrees off horizontal. A SQUARE FLAGSTONE IS WRONG. Rows dead straight and parallel across the whole deck; stones meet edge to edge with a thin even groove; not one stone overlapping, bending, rotating or changing size; no brick-offset, cobbled, hexagonal or random paving. The stones are LARGE: the plateau carries 249 in total, at most 18 in a row. The pad is exactly 2 by 2, four stones.

THE SHAPE. Deliberately IRREGULAR — never a square, diamond, circle or regular polygon. Follow the diagram's ragged coastline: a headland at the north-west, a wide bay bitten into the south-west rim, a notched inlet on the east.

DECOR LAW — THIS IS WHAT MAKES IT A PLACE AND NOT A SLAB.
The zone must be unmistakably inhabited and built, but the board must stay playable. So:
- ALL structures and props sit at the EDGES AND CORNERS of the deck, or straddle the rim, or hang off the cliff. THE MIDDLE OF THE DECK STAYS OPEN — a broad clear area of plain paving in the centre with nothing standing on it.
- Anything in the open floor area is INLAID FLUSH into the paving, level with the stones, never standing proud of them: circular rune discs, inlaid metal channels, a mosaic ring, carved glyph lines. These read as pattern in the floor, not as objects.
- A carved border course runs around the whole deck edge, one stone deep, marking the paved area off from the bare rock rim.
{DECOR}
- Warm gold metal (#F7A437 into #FFD84D) is the signature material of this world's craft: fittings, chain links, lantern frames, inlay, door furniture. Use it as the one warm accent and keep it sparing.
- Heavy gold chains with big rounded links run from the plateau out to the small pad and off into the distance, with ornate cast clasps where they anchor.
"""

SURROUND = """
THE SURROUNDING WORLD — NOT OPTIONAL, AND IT MUST FILL THE FRAME.
A thin or empty surround is the worst failure this image can have.
{SURROUND}
- Depth in three ranks separated by CONTRAST alone — near at full contrast, mid a step down, far reduced to shape and rim light. Never by hazing or desaturating.

NOT THIS. No characters, creatures or people anywhere. No text, labels, UI, watermark or logo. Nothing standing in the middle of the deck. Nothing overhangs a deck edge into the air unsupported. No drawn grid lines. No horizon line, no perspective convergence, no photorealism, no PBR, no flat cartoon shading, no empty surround.
"""

ZONES = {
    'hatchery': {
        'title': 'THE DRAGON HATCHERY',
        'setting': 'in a sunlit clearing ringed by ancient forest',
        'body': """THE SETTING. Enormous old trees ring the clearing on every side, their canopy closing over the top corners of the frame. Deep moss, fern and root carpet the forest floor below the plateau's low mossy escarpment. Warm gold light shafts slant down through gaps in the canopy.

LIGHT. Filtered forest daylight — cool green shade with warm gold shafts. The clearing is where the light gets in, so the deck is the brightest thing in frame. Braziers add a small warm pool of light at the rim.

THE DECK. Old grey-gold flagstones (shadow #4A4A42, mid #8C8A7C, lit #C8C5B2), damp and lichen-patched, moss creeping in from the grooves at the shaded rim.""",
        'decor': """- THE SIGNATURE: a large circular HATCHING RUNE inlaid flush into the paving, set off-centre toward one end of the deck — concentric carved rings with glyphs between them, the channels filled with warm gold metal that catches the light. It is part of the floor; nothing stands on it.
- Around the rim: low curved stone NESTS lined with straw and moss, a couple holding a single large scaled dragon egg; carved dragon-head posts at two corners.
- A weathered stone GATEWAY ARCH straddling the rim at the north-west headland, its keystone carved with a dragon sigil, gold-fitted, standing open to the forest beyond.
- Two tall iron BRAZIERS on the rim burning with a small warm flame, gold-banded.
- A short flight of worn steps cut down through the rim into the ferns.""",
        'surround': """- Ancient trees ringing the clearing on all sides, trunks massive, canopy closing over the frame's top corners — the plateau sits in a green room.
- Dense fern and undergrowth, fallen mossy logs and roots around the base.
- Volumetric light shafts through the canopy, catching drifting pollen.
- Layers of mist between the far trunks so the forest recedes into soft green.
- A few hanging lanterns on chains between the nearer trees.""",
    },
    'gatekeep': {
        'title': "THE KEEPER'S GATE",
        'setting': 'on a windswept highland moor under low grey weather',
        'body': """THE SETTING. Open upland moor of heather and rough grass runs away in every direction under a low ceiling of cloud. Ancient standing stones rise from the heath around the plateau. Wind bends everything one way.

LIGHT. Overcast and diffuse with no hard shadows, but one shaft of pale sun breaks through far off and lights a patch of moor bright green-gold — the only bright note. The gate's lanterns are the warm counterpoint.

THE DECK. Cool grey flagstones (shadow #4A4E52, mid #7E8388, lit #B0B5B8), damp and matte with soft painted mottling, dark moss and wiry grass in the grooves.""",
        'decor': """- THE SIGNATURE: a massive stone GATEHOUSE ARCH straddling the eastern rim, two heavy piers and a carved lintel, its ironbound double DOORS standing half open onto the moor. A huge ornate GOLD KEYHOLE plate is set into the door — the Keeper's lock. Gold-banded hinges and studs.
- Inlaid flush in the paving before the gate: a circular threshold rune of concentric rings and glyphs, gold-filled, and a straight inlaid gold channel running from it to the gate like a processional line.
- Along the rim: low crenellated parapet walls in the same stone, a pair of gold-topped boundary posts, and two hanging lanterns on iron brackets flanking the arch.
- A stone stair descending through the rim to the heath, its treads worn hollow.""",
        'surround': """- Open rolling moor filling the frame — muted purple-brown heather and tawny grass in broad painted masses.
- A ring of tall leaning standing stones out on the heath, lichen-patched, receding in scale.
- Low grey cloud ceiling with one bright break and a visible shaft of light on distant ground.
- Wind in everything: grass combed flat, bent thorn trees, streaming cloud.
- Far hills reduced to flat blue-grey shapes.""",
    },
    'runevault': {
        'title': 'THE RUNE OBSERVATORY',
        'setting': 'alone on a mirror-still salt flat beneath a vast twilight sky',
        'body': """THE SETTING. The plateau stands on a dead-flat salt pan under a film of still water that mirrors everything to the frame edge. It is late twilight: the sky has gone deep blue but still glows along one edge.

LIGHT. Deep blue-hour ambience with a last band of pale gold low on one side. The zone's own glyph-light is the main source — cool gold-green light rising out of the inlaid runes themselves, doubled in the mirror below.

THE DECK. Pale bone-white flagstones (shadow #9AA0A2, mid #C9CFCF, lit #F0F3F2) with soft painted mottling and a fine crust of salt in the grooves.""",
        'decor': """- THE SIGNATURE: a great ASTRAL RUNE inlaid flush into the paving — three concentric rings of carved glyphs filling much of one half of the deck, the channels inlaid with gold that glows faintly from within. Completely level with the floor; the centre of the deck stays walkable and open.
- At three corners: tall carved OBELISKS of dark stone, gold-capped, leaning slightly, each with a glyph band around its base.
- On the rim: a low ring of small standing markers, and an ornate gold ORRERY frame — rings within rings — mounted on a stone plinth at the eastern corner.
- Gold chains swagged between the obelisks, hung with small lanterns.""",
        'surround': """- The mirror salt flat running to the frame edge, holding a perfect inverted reflection of plateau, obelisks, chains and sky.
- Hexagonal salt-crust polygons patterning the drier areas in pale painted lines.
- A vast twilight sky filling the upper frame, deep blue with one warm band low down, all doubled in the ground.
- Distant salt ridges and lone rock stumps as flat shapes far off.
- Faint wind ripples disturbing the mirror in a couple of places.""",
    },
    'emberforge': {
        'title': 'THE EMBER FORGE',
        'setting': 'on an island in a vast underground cavern lake',
        'body': """THE SETTING. The plateau is an island in still black water inside an enormous cave. Colossal stalactites hang from a ceiling lost in dark, stone columns rise out of the lake, and the ceiling is spangled with tiny blue-green glowworm lights doubled in the water.

LIGHT. No sun. Cold blue-green bioluminescence from above, and a strong warm ORANGE-GOLD glow from the forge fire at the deck's edge — the warm/cold clash is this zone's whole look. Firelight flickers across the near paving and the cliff.

THE DECK. Dark slate flagstones (shadow #1E2530, mid #3E4A57, lit #6E7C8B) with painted mottling, catching cool rim light along each bevel and warm firelight near the forge.""",
        'decor': """- THE SIGNATURE: a stone FORGE built into the north-west rim — a domed hearth of blackened brick with a heavy gold-banded chimney hood, its mouth full of live coals throwing orange light, an anvil on a block beside it.
- Inlaid flush in the paving: a circular ember rune of concentric rings, its channels filled with molten-looking gold that glows warm, and thin inlaid gold veins running from it toward the forge like heat cracks.
- Around the rim: racks of tongs and hammers, a quench trough of dark water, stacked ingots, and two braziers on gold-banded stands.
- A gold-fitted stone DOORWAY set into a rock outcrop at the eastern corner, its ironbound door ajar with warm light spilling out.""",
        'surround': """- The cavern filling every part of the frame: colossal stalactites above, stone columns and flowstone rising from the water, far wall lost in dark.
- Thousands of glowworm points across the ceiling, dense near and fine far, all doubled in the water.
- Dead-still black water holding sharp inverted reflections of columns, lights and the forge glow.
- Half-drowned boulders and pale mineral crust around the island.
- Three depth ranks receding into the dark by contrast alone.""",
    },
    'skydock': {
        'title': 'THE CARAVAN LANDING',
        'setting': 'as an island rising from a bright shallow sea',
        'body': """THE SETTING. The plateau is an island. Its cliff drops into clear turquoise water that shallows to pale jade over sandbanks and deepens to teal further out. White surf breaks in soft rings against the rock.

LIGHT. High bright daylight from the upper left. The water throws dancing caustic reflections up onto the lower cliff. Clean, warm, busy — a working place in good weather.

THE DECK. Sun-bleached limestone flagstones (shadow #7A705A, mid #C0B294, lit #EFE4CA) with painted mottling and salt-tough grass in the grooves near the rim.""",
        'decor': """- THE SIGNATURE: a timber DOCK and mooring platform built out over the southern rim on stone corbels, with tall carved mooring posts, coiled rope, and heavy gold-clasped chains running from the posts out to the small pad and away into the sky.
- Inlaid flush in the paving: a large circular compass-rose rune of concentric rings and glyph bands, gold-filled, set off-centre near the dock — the landing mark.
- Along the rim: stacked crates and banded barrels, a striped awning on carved posts at one corner, a weighing scale on a stone plinth, hanging lanterns on iron hooks.
- A stone ARCHWAY with gold-fitted open doors at the western headland, and a broad flight of steps descending through the rim toward the water.""",
        'surround': """- Open sea filling the frame around the island, its surface worked with stylised painted wave detail — never a flat colour.
- Twenty or so smaller rock islets and sea stacks around it, some grass-capped, ringed by their own surf.
- Pale sandbanks and reefs showing through the shallow water as bright jade shapes.
- Seabirds wheeling in small flocks, thin white wave-lines far out.
- A couple of distant chained rock islands with their own small structures, receding by contrast.""",
    },
}


def build(key):
    z = ZONES[key]
    return (HEAD.replace('{TITLE}', z['title']).replace('{SETTING}', z['setting'])
                .replace('{DECOR}', z['decor']) + '\n' + z['body'] + '\n'
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
