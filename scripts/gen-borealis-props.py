#!/usr/bin/env python3
"""Generate the borealis map's version of the first map's prop set.

Every prop is generated twice — Nano Banana 2 (1K) and Seedream 5.0 Lite — so
there are two options per slot to choose from. Each call gets TWO references:

  Image 1  assets/sprites/background/borealis.webp — the world the prop must
           live in. Supplies palette, light direction and finish.
  Image 2  the first map's original prop — supplies silhouette, proportions,
           isometric camera and footprint. Its COLOURS are explicitly rejected.

Output lands in assets/raw/map-gen/props/<model>/<key>.png, de-keyed and
contain-fitted to the original's exact pixel size so a chosen option is a
drop-in swap. Raw generations are kept beside them as <key>-raw.png.

  python3 scripts/gen-borealis-props.py [--only key,key] [--model nb2|seedream]

Nothing here writes into assets/sprites — promoting a chosen option is a
deliberate, separate step.
"""
import argparse
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL = os.path.join(ROOT, '.claude/skills/nano-banana/scripts')
SRC = os.path.join(ROOT, 'assets/sprites/environment/map')
OUT = os.path.join(ROOT, 'assets/raw/map-gen')
WORLD = os.path.join(ROOT, 'assets/sprites/background/borealis.webp')

# The style contract. Everything after [SUBJECT] is identical for every prop so
# the set reads as one family under one light.
STYLE = (
    'Image 1 is the WORLD this prop has to sit in. Match it exactly: deep '
    'glacial blue-grey stone with pale ice-blue lit faces, pale blue-white '
    'moonlit snow, a cool aurora-teal key light from the upper left, cool '
    'shadow faces, and warm lantern gold #F7A437 into #FFD84D as the ONLY warm '
    'colour anywhere in the object. Smooth soft-shaded stylised 3D render with '
    'soft rounded bevels — no brushstrokes, no canvas grain, no ink outlines, '
    'no cel-shading bands.\n'
    'Image 2 is the SHAPE reference from the first map. Rebuild THAT object as '
    'its deep-winter night counterpart: keep its silhouette, its proportions, '
    'its chunky construction, its footprint size and above all its camera — '
    '2:1 isometric three-quarter view, seen from above at about 30 degrees, no '
    'perspective convergence, no tilt. Do NOT copy its colours; the first map '
    'is a warm sunset world and this one is a frozen night world.\n'
    'Snow lies on every upward-facing surface and banks against every raised '
    'lip; icicles hang from the lower edges and eaves. '
    '[SUBJECT]\n'
    'Image 1 is a colour and lighting reference ONLY. Do not borrow its '
    'subject matter: unless Image 2 is itself a ground tile, the result must '
    'NOT be a floating island, a platform, a plinth, a terrain slab, a walled '
    'enclosure or a piece of scenery. Build the single object in Image 2 and '
    'nothing else — at the same modest size it is there.\n'
    'One single object, centred, complete, nothing cropped at any edge, on a '
    'solid flat pure magenta #FF00FF background. No ground shadow, no base '
    'plate, no scenery, no text, no second object. The subject itself must '
    'contain NO magenta, NO pink and NO violet of any kind — those are the key '
    'colour and will be cut out.'
)

# key -> (original file, target WxH, subject line)
PROPS = {
    'house_a': ('decor/hut_houses_transparent_001.png', '361x380',
                'A cosy fantasy cottage: steep snow-laden roof, dark timber '
                'framing, pale glacial stone walls, a stout stone chimney, and '
                'warm golden lamplight glowing out of its small arched windows.'),
    'house_b': ('flower-tiles/hut-houses- transparent_002.webp', '373x391',
                'A smaller round-doored cottage with a steep deeply snow-covered '
                'roof, a tall stone chimney, and warm golden light in its windows.'),
    'bridge': ('flower-tiles/architectures-to-delete-bg_002.webp', '583x447',
               'An arched stone footbridge, snow lying along its deck and '
               'parapets, icicles beneath the arch, a small gold lantern on each '
               'corner post.'),
    'crystal': ('decor/themcristall.webp', '803x902',
                'A rocky outcrop crowned with a cluster of faceted pale-cyan ice '
                'crystals with softly glowing cores, snow packed over the rock '
                'and frost creeping up the base.'),
    'fir': ('flower-tiles/sapin.webp', '449x753',
            'A conifer fir tree buried under heavy snow, dark blue-green needles '
            'showing beneath the white, snow mounded around its trunk.'),
    'tree_big': ('flower-tiles/tree-4.webp', '622x823',
                 'A round-canopied broadleaf tree in deep winter: bare dark '
                 'branches rimed with frost, thick snow piled along every bough, '
                 'a snow drift around its exposed roots.'),
    'sprout': ('flower-tiles/tree-1.png', '223x271',
               'A small sapling pushing up through a mound of snow, a few frosted '
               'leaves catching the light.'),
    'plant': ('decor/plant_1.png', '179x252',
              'A frost-glazed stone pot holding a small hardy sprig with frosted '
              'leaves, snow heaped on the pot rim.'),
    'flower': ('decor/flower_1.png', '361x367',
               'A cluster of ice-flowers: white crystalline petals with softly '
               'glowing pale-cyan centres, snow at the base.'),
    'ground_tile': ('flower-tiles/Tiles-out_016.webp', '442x443',
                    'A single isometric ground tile cube: a flat top plane of '
                    'packed snow over courses of pale glacial stone blocks on its '
                    'two visible side faces, icicles along the lower lip.'),
    'water_tile': ('flower-tiles/water-tile.png', '240x240',
                   'A single isometric cube of frozen ice: translucent pale cyan, '
                   'a cracked frozen surface on its flat top plane, deeper teal '
                   'inside the block.'),
    'well': ('flower-tiles/hole.webp', '647x885',
             'A stone well with a snow-covered wooden roof, frost on the timbers, '
             'icicles hanging from the roof edge, and a faint cyan glow rising '
             'from the frozen water inside.'),
}

# Merge items are NOT ground props: they are hero objects on the board, each
# with its own established framing (gems face-on, eggs upright, the log at an
# angle). So this style block preserves the reference's own presentation
# instead of forcing the isometric ground camera the prop set uses.
ITEM_STYLE = (
    'Image 1 is the WORLD this item belongs to. Match it exactly: deep glacial '
    'blue-grey stone with pale ice-blue lit faces, pale blue-white moonlit '
    'snow, a cool aurora-teal key light from the upper left, cool shadow '
    'faces, aurora green and teal for anything that glows, and warm lantern '
    'gold #F7A437 into #FFD84D as the only warm colour. Smooth soft-shaded '
    'stylised 3D render with soft rounded bevels and a rich glossy finish — no '
    'brushstrokes, no canvas grain, no ink outlines.\n'
    'Image 2 is the ITEM to rebuild. Keep its silhouette, its proportions, its '
    'framing and its exact viewing angle — do not re-pose it, do not rotate '
    'it, do not change how much of the frame it fills. Rebuild that same '
    'object as its deep-winter night counterpart. Do NOT copy its colours: the '
    'first map is a warm sunset world, this one is frozen and lit by an '
    'aurora.\n'
    '[SUBJECT]\n'
    'This is a single merge-game item icon: one object, centred, complete, '
    'nothing cropped, on a solid flat pure magenta #FF00FF background. It is '
    'NOT a floating island, a platform, a plinth, a terrain tile or a scene — '
    'no ground, no base plate, no scenery, no shadow cast on anything, no '
    'text, no second object. The object itself must contain NO magenta, NO '
    'pink and NO violet of any kind — that is the key colour and will be cut.'
)

# key -> (original file, target WxH, subject line)
ITEMS = {
    'strawberry_1': ('assets/sprites/level1/item_strawberry_1.png', '240x240',
                     'A tiny frostberry sprout: two small frosted leaves on a '
                     'pale stem, carrying two glowing pale-cyan berries.'),
    'strawberry_2': ('assets/sprites/level1/item_strawberry_2.png', '240x240',
                     'A low snow-dusted berry bush studded with glowing '
                     'ice-blue berries.'),
    'strawberry_3': ('assets/sprites/level1/item_strawberry_3.png', '240x240',
                     'A full snow-laden berry bush heavy with glowing '
                     'pale-cyan frostberries.'),
    'ember_dragon_1': ('assets/sprites/merge/rubis-transparent_001.webp', '474x382',
                       'A large faceted gemstone cut exactly like the '
                       'reference, but of glacial ice: pale cyan and teal, '
                       'sharp flat facets, a bright aurora glow in its core '
                       'and a white specular flash on one upper facet.'),
    'ember_dragon_2': ('assets/sprites/items/red-egg.webp', '1162x1437',
                       'A frost dragon egg standing upright: pale blue-grey '
                       'scales rimed with frost, glowing aurora-cyan light '
                       'running through the cracks between the scales.'),
    'flame_gem_1': ('assets/sprites/items/diamond.webp', '518x387',
                    'A brilliant-cut gem of clear ice, pale blue-white with '
                    'aurora-teal refractions in its facets and a hard white '
                    'sparkle at one corner.'),
    'lumber_1': ('assets/sprites/items/wood.png', '273x240',
                 'A cut log lying on its side, its bark rimed with frost, a '
                 'cap of snow along its upper length and pale ice glazing the '
                 'circular cut face with its growth rings.'),
    'lumber_2': ('assets/sprites/items/house.png', '361x380',
                 'A cosy cottage with a steep snow-laden roof, dark timber '
                 'framing, pale glacial stone walls and warm golden lamplight '
                 'in its arched windows; icicles along the eaves.'),
    'lumber_3': ('assets/sprites/items/manor.png', '430x450',
                 'A larger two-storey manor under deep snow: steep snow-heavy '
                 'roofs, timber framing, pale glacial stone, warm golden light '
                 'in every window, icicles along the eaves.'),
    'bigtree_1': ('assets/sprites/items/bigtree.webp', '622x823',
                  'A round-canopied tree in deep winter: thick snow piled over '
                  'the whole canopy, dark frosted branches beneath, a snow '
                  'drift around its roots.'),
    'crystal_1': ('assets/sprites/items/crystal.webp', '803x902',
                  'A rocky outcrop crowned with a cluster of faceted pale-cyan '
                  'ice crystals with glowing cores, snow packed over the rock.'),
    'coin_1': ('assets/sprites/items/coin.png', '432x357',
               'A thick gold coin seen at a slight angle, its raised rim and '
               'face stamp catching a cool blue rim light, a delicate rime of '
               'frost creeping around its edge. The gold stays gold.'),
    'coin_2': ('assets/sprites/items/coin_pouch.png', '460x540',
               'A drawstring pouch spilling gold coins from its mouth, the '
               'leather frost-dusted and stiff with cold, the gold still warm '
               'against the blue light.'),
    'emerald_1': ('assets/sprites/items/emerald.webp', '467x392',
                  'A large faceted gemstone cut exactly like the reference, in '
                  'aurora green: flat sharp facets, a luminous green-teal '
                  'core, a white specular flash on one upper facet.'),
    'emerald_2': ('assets/sprites/items/green-egg.webp', '1147x1438',
                  'An upright dragon egg of aurora-green crystal, frost across '
                  'its shell and glowing green-teal veins running through it.'),
    'golden_egg_1': ('assets/sprites/items/golden-egg.webp', '1176x1451',
                     'An ornate upright golden egg, its filigree and inset '
                     'gems intact, glazed with frost and rimmed by cool blue '
                     'light; the gold itself stays warm gold.'),
    'chest_1': ('assets/sprites/items/chest.webp', '537x511',
                'A treasure chest with a domed lid: frost-silvered timber, '
                'gold banding and lockplate still warm gold, snow settled on '
                'the lid and icicles hanging from its lower edge.'),
}

# name -> (table, style, output subdirectory)
SETS = {'props': (PROPS, STYLE, 'props'), 'items': (ITEMS, ITEM_STYLE, 'items')}

MODELS = {'nb2': 'asset', 'seedream': 'asset-seedream'}


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print('  ! ' + (r.stderr or r.stdout).strip()[:300], file=sys.stderr)
        return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--set', default='props', choices=list(SETS))
    ap.add_argument('--only', default='')
    ap.add_argument('--model', default='', choices=['', *MODELS])
    args = ap.parse_args()
    table, style, subdir = SETS[args.set]
    keys = [k.strip() for k in args.only.split(',') if k.strip()] or list(table)
    models = [args.model] if args.model else list(MODELS)

    for model in models:
        job = MODELS[model]
        d = os.path.join(OUT, subdir, model)
        os.makedirs(d, exist_ok=True)
        for key in keys:
            rel, size, subject = table[key]
            # prop paths are relative to the map decor dir; item paths are
            # already repo-relative, since they live all over sprites/
            ref = rel if rel.startswith('assets/') else os.path.join(SRC, rel)
            ref = os.path.join(ROOT, ref) if not os.path.isabs(ref) else ref
            raw = os.path.join(d, f'{key}-raw.png')
            fin = os.path.join(d, f'{key}.png')
            print(f'[{model}] {key} -> {size}')
            if not run([sys.executable, os.path.join(SKILL, 'artgen.py'), job,
                        style.replace('[SUBJECT]', subject),
                        '-i', WORLD, '-i', ref, '-o', raw]):
                continue
            run([sys.executable, os.path.join(SKILL, 'dekey.py'), raw, fin,
                 '--trim', '--resize', size])
    print('done ->', OUT)


if __name__ == '__main__':
    main()
