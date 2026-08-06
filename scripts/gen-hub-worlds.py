#!/usr/bin/env python3
"""Five candidate worlds for the hub island, all rendered by Seedream 5.0 Pro.

Built on the borealis brief's skeleton, which is the one that produced a rich,
deep picture: reference-with-two-jobs, camera, value law, named light sources,
materials, a sky that is half the picture, and — the part every hub attempt so
far has been thin on — a DISTANT WORLD section with explicit counts.

Each world changes four things at once (time of day, sky event, hue family,
floating cue). Change fewer and it reads as a reskin of an existing map.

  python3 scripts/gen-hub-worlds.py [--only key,key] [--prompts-only]

Writes prompts to assets/raw/map-gen/hub/prompts/<key>.txt and renders to
assets/raw/map-gen/hub/worlds/<key>.jpg. Runs all five concurrently.
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

HEAD = """A single finished game-world backdrop illustration: a large irregular floating plateau of paved stone, hanging in {SETTING}.

THE ONLY REFERENCE IMAGE IS A LAYOUT DIAGRAM — never draw it. Its white regions are the exact silhouette of each island, rock skirt included. Its blue diamonds are the exact paving grid on top. Its black is open sky. Reproduce exactly two islands at those shapes, positions and relative sizes: one big irregular plateau filling most of the frame, and one tiny 2x2 pad off to its right with open sky between them. No blue lines, no blue strokes, no outlines, no wireframe, no white fill and no black fill may appear in the finished picture.

RENDER STYLE. Richly detailed painterly stylised 3D render: soft rounded bevels, layered depth, real surface texture in the stone and the foliage, atmospheric perspective in the far distance. NOT a flat vector cartoon, NOT hard cel-shading, NOT thick uniform outlines, NOT a simple mobile-game illustration. Every part of the frame carries detail and depth.

THE SHAPE. The plateau is deliberately IRREGULAR — never a square, diamond, circle or regular polygon. Follow the diagram's ragged coastline: a headland pushing out at the north-west, a wide bay bitten into the south-west rim, a notched inlet on the east side.

CAMERA. Fixed 2:1 isometric three-quarter view, about 30 degrees above the horizon. No perspective convergence, no vanishing point, no tilt.

THE PAVING GRID IS THE SINGLE MOST IMPORTANT REQUIREMENT.
Every paving stone is exactly ONE blue diamond from the diagram — one diamond, one stone, in the same place: the same number of stones across the deck, in the same rows; each stone a 2:1 isometric rhombus exactly twice as wide as it is tall; rows dead straight and parallel right across the deck; stones meeting edge to edge and corner to corner with a thin even groove between them; NOT ONE stone overlapping, crossing, bending, tapering, rotating or changing size; no brick-offset, cobbled, hexagonal, radial, fanned or random paving; a stone meeting the island rim is cleanly cut by it.
STONE SIZE — THE MOST COMMON MISTAKE. The stones are LARGE. Do not subdivide a diamond into smaller stones. The big plateau carries 249 stones in total, at most 18 in a single row. The small pad is exactly 2 by 2, four stones. If more stones fit across the deck than the diagram has diamonds, they are too small and the image is wrong.

VALUE LAW. The sky is the brightest, highest-contrast region of the picture. The islands sit well below it in value and read as quiet solid shapes against it. The deck stays calm and mid-value — it is the flattest, quietest area on the canvas and nothing on it may compete with the rims or the sky.
"""

TAIL = """
THE DISTANT WORLD — THIS IS NOT OPTIONAL AND MUST FILL THE FRAME.
The background is a populated world, not wallpaper. Include ALL of it:
- Roughly fifty smaller floating rock islands behind and around the plateau, in three depth ranks separated by CONTRAST ALONE — never by hazing, lightening, desaturating or shifting hue. Near ones carry the same full detail as the hub; mid ones lose contrast one step; the farthest reduce to a silhouette with one bright rim.
- Each is a miniature of the hub: paved or overgrown cap, stone body, cool shaded faces, {UNDERSIDE} beneath.
- Heavy gold chains strung between the larger background islands with ornate cast clasps where they anchor, and hanging lanterns dangling on chains in open air.
- {DRESSING}
- Layered atmosphere between the ranks so the eye reads real distance across the frame.
Fill the empty air. A thin or bare background is the single worst failure this image can have.

NOT THIS. No characters, creatures, props, buildings, text, labels, UI, watermark or logo on the deck or anywhere. No cast shadows on the deck surface. Nothing overhangs a deck edge. No drawn grid lines on the ground — the floor pattern is carved stone seams only. No flat cartoon shading, no empty background.
"""

WORLDS = {
    'skysea': {
        'setting': 'the clear high air of a bright morning above an endless turquoise sea of cloud',
        'body': """THE SKY — half the picture, and mostly OPEN AIR. The upper two thirds is graded cerulean, deepest at the top, paling toward the horizon: #1F6E9C into #5FA8C4 into pale aqua #BFE0E2, streaked with high thin cirrus catching the sun (#F6F0DC). No lobed cumulus above the islands. The lower third is a dense endless SEA OF CLOUD far below, turquoise and lit from above — crests #D6F5EA, tops #8FDCC9, mid #4FA79A, troughs #2C6B66 — stretching to the horizon like an ocean. The sun sits high and slightly left, outside the frame, throwing soft shafts down between the islands into the cloud-sea.

HOW THE ISLANDS FLOAT. Nothing glows; it is broad daylight. The bright cloud-sea below throws a soft PALE TURQUOISE UP-LIGHT (#A8E6D6) onto every underside, into the hanging roots and the lowest stone courses. Cool light from below, warm sun from above.

THE DECK. Weathered pale limestone flagstones (shadow #6F654E, mid #B3A588, lit #E0D6BC) overgrown with living turf — full springy grass across the middle, thinning to bare stone at the rim, tufts in every groove, a green fringe overhanging the top edge. Turf #1F3D22 / #2E5427 / #4F8636 / #86B84F. A few tiny wildflowers, used sparingly.

THE ROCK BENEATH. Chunky rounded limestone blocks in staggered courses stepping inward as they descend, roots and vines spilling over the upper courses, the lowest blocks catching the turquoise up-light. Ragged underside, never a flat cut.""",
        'underside': 'a pale turquoise up-light',
        'dressing': 'Shafts of sunlight cutting down through the gaps between islands into the cloud-sea, and slow flocks of distant birds.',
    },
    'thundervault': {
        'setting': 'the bruised air of a late-afternoon storm, between towering thunderheads',
        'body': """THE SKY — half the picture and violent. Enormous slate-blue thunderheads tower on both sides and behind the plateau, their tops lit warm bronze where the last sun catches them (#C9A26B), their bellies deep blue-grey (#2B3648) shading to near-black. Grey rain curtains sweep in veils across the middle distance. A silent fork of lightning inside a far cloud lights it from within, cold white-violet (#CBD4FF), and a second, dimmer one further back. Between the clouds a single narrow break of clean rain-washed sky, pale steel (#8FA9BE).

HOW THE ISLANDS FLOAT. No internal glow. Waterfalls — this is what sells the height: rainwater sheets off the plateau's rim in three or four places and falls away into the dark as it atomises into mist. Wet stone catches a cold specular sheen from the sky.

THE DECK. Rain-slick dark granite flagstones (shadow #2E3238, mid #55606A, lit #8C99A3) with a hard wet sheen and shallow puddles held in the grooves, mirroring the bright break in the sky. Deep emerald moss (#1C3B26 / #2F6438 / #4E8F4B) creeps over the stones, heaviest at the sheltered centre. Grass bent flat by the wind along the exposed rim.

THE ROCK BENEATH. Dark wet basalt in blocky courses, streaming with runoff, trailing soaked roots. Mist boils where the waterfalls disintegrate.""",
        'underside': 'a cold wet sheen and a thread of falling water',
        'dressing': 'Rain veils drifting between the depth ranks, mist plumes where waterfalls break up, and one far island catching the lightning flash brightly against the dark.',
    },
    'bloomfall': {
        'setting': 'the soft periwinkle light of a spring afternoon, in a slow blizzard of drifting blossom',
        'body': """THE SKY — half the picture, high and gentle. A broad periwinkle gradient (#6C7FC0 at the top into #A9BDE4 into pale #DCE6F7 at the horizon), brushed with soft flat cloud banks tinted the faintest blush (#EBD9E4). Warm afternoon sun low-left, outside the frame, rimming everything it touches in pale gold. The whole frame is crossed by drifting BLOSSOM PETALS — thousands of them, white through blush pink (#F6E3EA, #E9B8C9), large and softly blurred near the camera, fine specks in the far distance. That petal-fall is this world's signature and must be unmistakable.

HOW THE ISLANDS FLOAT. No glow — daylight. The undersides pick up a warm sand-coloured bounce (#E4CBA8) from the sunlit haze below, and petals swirl in the updraught beneath every island.

THE DECK. Pale warm sandstone flagstones (shadow #7A6A57, mid #BCA88C, lit #EBDCC4) with low clover and fine spring grass between them (#3C6B39 / #6FA24F / #9CC96B), drifts of fallen petals gathered in the grooves and banked against the rim.

THE ROCK BENEATH. Warm sandstone in rounded courses, hung with flowering creepers whose blossoms are the source of the petal-fall, roots trailing into the air.""",
        'underside': 'a warm sand-coloured bounce light and a swirl of petals',
        'dressing': 'Enormous flowering blossom trees crowning the larger background islands, shedding the petal-fall that crosses the whole frame; petals thickest near camera, finest far away.',
    },
    'sunkensky': {
        'setting': 'the luminous green depths of a drowned sky, far beneath a distant surface',
        'body': """THE SKY — half the picture, and it reads as WATER. Deep jade-green above shading down into near-black teal below (#0B2A2C at the bottom into #16544F into #2E8F7E into a bright #7FD9BD near the top). Far, far above, a rippling luminous surface — the boundary of this drowned sky — through which enormous god-shafts of pale green light stab down past the islands, moving and volumetric. Drifting through everything, thousands of slow BIOLUMINESCENT MOTES, pale mint and gold, brightest in the shafts. No conventional clouds anywhere.

HOW THE ISLANDS FLOAT. The shafts from above light the deck; the depths below are dark. Undersides fall away into deep shadow with only a faint jade rim, and long kelp-like vines and ribbons trail downward from every island, drifting slowly.

THE DECK. Dark wet slate flagstones (shadow #17262B, mid #3B5158, lit #6E858C) glazed with a thin sheen, veined with pale luminous lichen (#9FE0C4) that glows faintly in the grooves. Soft pale-mint weed clings in the sheltered hollows.

THE ROCK BENEATH. Dark waterworn stone, encrusted with pale coral-like growth and hung with long drifting kelp ribbons that fade into the dark below.""",
        'underside': 'a faint jade rim and long trailing kelp',
        'dressing': 'Volumetric light shafts crossing the whole frame at a slant, dense drifting motes at every depth, and the farthest islands visible only as dark shapes inside the green haze.',
    },
    'goldleaf': {
        'setting': 'the crisp cold light of an autumn morning under a clean steel-blue sky',
        'body': """THE SKY — half the picture, cold and clear. A hard clean gradient from deep steel blue at the top (#27567F) through #6E9EC2 to a pale silver horizon (#CFE0EA). Thin high cirrus, and low banks of cold white mist pooled far below between the islands, catching the low sun. The sun is low and to the left, outside the frame, raking everything with a crisp warm light that makes the autumn colour blaze against the cold sky — this complementary clash of warm foliage and cool sky is the whole point of this world.

HOW THE ISLANDS FLOAT. No glow. The cold mist below throws a faint silver-blue bounce onto the undersides, while the low sun rims every upper edge in warm gold. Leaves fall from the background islands and drift across the frame.

THE DECK. Grey-gold flagstones (shadow #5C5648, mid #9A9077, lit #D6CBAE) with drifts of fallen leaves gathered in the grooves and banked against the rim — amber, rust and ochre (#C87A32, #9E4B25, #E0A44C). Frost-crisped grass, gone tawny (#8A7A45 / #B79A55), clings between the stones.

THE ROCK BENEATH. Grey granite in heavy courses, hung with bare russet creepers and dry roots, the lowest blocks cold and blue in shadow.""",
        'underside': 'a faint silver-blue bounce from the mist',
        'dressing': 'Great autumn trees in full amber and rust crowning the larger background islands, loose leaves drifting across the frame, and cold mist banks half-burying the lowest rocks.',
    },
}


def build(key):
    w = WORLDS[key]
    return (HEAD.replace('{SETTING}', w['setting']) + '\n' + w['body'] + '\n'
            + TAIL.replace('{UNDERSIDE}', w['underside'])
                  .replace('{DRESSING}', w['dressing']))


def render(key, prompt):
    dst = os.path.join(OUT, 'worlds', f'{key}.jpg')
    r = subprocess.run([sys.executable, ARTGEN, 'map-seedream', prompt,
                        '-i', MASK, '-o', dst], capture_output=True, text=True)
    return key, (r.stdout or r.stderr).strip().splitlines()[-1] if (r.stdout or r.stderr) else 'no output'


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
        p = build(k)
        prompts[k] = p
        with open(os.path.join(OUT, 'prompts', f'{k}.txt'), 'w') as fh:
            fh.write(p)
        print(f'{k:12s} prompt {len(p)} chars')
    if args.prompts_only:
        return
    with ThreadPoolExecutor(max_workers=len(keys)) as ex:
        for key, line in ex.map(lambda k: render(k, prompts[k]), keys):
            print(f'{key:12s} {line}')


if __name__ == '__main__':
    main()
