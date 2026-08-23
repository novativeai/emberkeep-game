#!/usr/bin/env python3
"""Swap the north's materials yard for the five farms. Run ONCE, kept as record.

    python3 scripts/migrate-borealis-farms.py

WHAT IT DOES

Deletes the seven chains that predated the farm structure and replaces them with
ten — five FIXTURE chains (part -> assembly -> machine) and five PRODUCT chains
(small -> bigger -> icon). Art comes from `gen-borealis-farms.py`; this script
moves the DATA, and it moves all of it in one pass so the supply graph is never
left half-rewired.

THE ROLE MAP is what keeps orders, quests, the cauldron and the dragon diet
working: each dead chain hands its exact job to a live one, tier for tier.

    driftwood  -> seaglass      the cheap early product
    tarknot    -> emberheart    the north's dragon fuel
    keel       -> warhelm       the salvage product (tier 4 had no successor)
    frostsilk  -> auroraweave   Selyna's material, recipient-locked
    rimebloom  -> orrery        the second product line
    wrackline  -> glasskiln     a fixture, so t1 becomes the MACHINE at t3
    frostfont  -> starbench     likewise

Two things do not map and are handled by name below: `keel` tier 4 (the
Longhall, which nothing replaces) and the four cauldron recipes whose ids named
the object rather than the step.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
D = ROOT / 'src/data'

#: dead chain -> live chain, tier for tier.
MAP = {
    'driftwood': 'seaglass',
    'tarknot': 'emberheart',
    'keel': 'warhelm',
    'frostsilk': 'auroraweave',
    'rimebloom': 'orrery',
    'wrackline': 'glasskiln',
    'frostfont': 'starbench',
}
DEAD = set(MAP)
#: A fixture's single authored tier was its MACHINE, which is now tier 3.
FIXTURE_T1_BECOMES_T3 = {'wrackline', 'frostfont'}

TIERS = {
    # ---------------------------------------------------------- fixtures --
    'glasskiln': ('Glass Kiln', [
        ('Fire Brick', 2, 0), ('Kiln Grate', 6, 7), ('The Glass Kiln', 0, 18)]),
    'starbench': ('Starwright\'s Bench', [
        ('Brass Cog', 2, 0), ('Gear Ring', 6, 7), ("The Starwright's Bench", 0, 18)]),
    'wreckforge': ('Wreck Forge', [
        ('Iron Billet', 2, 0), ('Forge Bellows', 6, 7), ('The Wreck Forge', 0, 18)]),
    'tarkiln': ('Tar Kiln', [
        ('Tar Spile', 2, 0), ('Tar Bucket', 6, 7), ('The Tar Kiln', 0, 18)]),
    'auroraloom': ('Aurora Loom', [
        ('Silver Spindle', 2, 0), ('Loom Comb', 6, 7), ('The Aurora Loom', 0, 18)]),
    # ---------------------------------------------------------- products --
    'seaglass': ('Sea Glass', [
        ('Glass Float', 1, 0), ('Glass Buoy', 4, 6), ('The Bottled Ship', 14, 16)]),
    'orrery': ('Orrery', [
        ('Ground Lens', 2, 0), ('Spyglass', 6, 8), ('The Orrery', 18, 18)]),
    'warhelm': ('War Helm', [
        ('Iron Cap', 2, 0), ('Banded Helm', 6, 6), ('The Horned Helm', 18, 18)]),
    'emberheart': ('Ember Heart', [
        ('Pitch Bead', 2, 0), ('Pitch Loaf', 7, 9), ('The Ember Heart', 20, 20)]),
    'auroraweave': ('Aurora Weave', [
        ('Light Thread', 2, 0), ('Woven Bolt', 8, 10), ('The Aurora Cloak', 24, 22)]),
}

#: fixture -> (what its machine produces, cooldown ms). Every one of them also
#: drops its OWN t1 every twelfth production — that is the farm structure's
#: whole point, and it is the only way the north grows a second generator.
FIXTURES = {
    'glasskiln': ('seaglass', 150000),
    'starbench': ('orrery', 240000),
    'wreckforge': ('warhelm', 180000),
    'tarkiln': ('emberheart', 150000),
    'auroraloom': ('auroraweave', 300000),
}
BONUS_EVERY = 12

#: The compass wave was already fixture-shaped — a two-tier ladder under a
#: generator — but three of its five produced THEMSELVES and one produced coin,
#: so they had no product ladder to feed. Each is pointed at one of the new
#: product chains it has a reason to make, and each gets the every-12 drop.
#: `hearthlamp` is the documented exception: it pays Warmth, not an item, and it
#: is the north's only energy source, so it keeps its reward and gains only the
#: self-seed.
COMPASS = {
    'runestone': 'emberheart',   # heat-runes melt the buried tar
    'emberdram': 'seaglass',     # the cask trade is a glass trade
    'manastone': 'orrery',       # the instrument runs on raw mana
}
#: `wayfinder` is NOT here on purpose. `reward` short-circuits `produces` in
#: GeneratorSystem, so a machine either makes an item or pays a currency — and
#: the Wayfinder is the north's only coin pump, exactly as `hearthlamp` is its
#: only energy pump. Both keep paying and take only the self-seed half.


def load(name):
    return json.loads((D / f'{name}.json').read_text())


def save(name, doc):
    (D / f'{name}.json').write_text(json.dumps(doc, indent=2, ensure_ascii=False) + '\n')


def build_chain(cid):
    name, rows = TIERS[cid]
    tiers = []
    for i, (tname, sell, xp) in enumerate(rows, start=1):
        t = {'tier': i, 'id': f'{cid}_{i}', 'name': tname, 'sell': sell, 'xp': xp}
        if i == 3 and cid in FIXTURES:
            produces, cd = FIXTURES[cid]
            t['generator'] = {
                'produces': {'chain': produces, 'tier': 1},
                'cooldownMs': cd,
                'energyCost': 1,
                'passiveMs': cd,
                'tappable': True,
                'bonus': {'every': BONUS_EVERY, 'produces': {'chain': cid, 'tier': 1}},
            }
        tiers.append(t)
    return {'id': cid, 'name': name, 'world': 'borealis', 'tiers': tiers}


def remap_node(node):
    """Rewrite one {chain, tier} reference in place. Returns True if it changed."""
    c = node.get('chain')
    if c not in DEAD:
        return False
    if c in FIXTURE_T1_BECOMES_T3 and node.get('tier') == 1:
        node['tier'] = 3
    node['chain'] = MAP[c]
    return True


def walk(o, fn):
    if isinstance(o, dict):
        fn(o)
        for v in o.values():
            walk(v, fn)
    elif isinstance(o, list):
        for v in o:
            walk(v, fn)


# --------------------------------------------------------------- chains --
chains = load('chains')
kept = [c for c in chains['chains'] if c['id'] not in DEAD]
at = next(i for i, c in enumerate(kept) if c.get('world') == 'borealis')
# Fixture then its product, so the file reads the way the farm works.
order = ['glasskiln', 'seaglass', 'starbench', 'orrery', 'wreckforge', 'warhelm',
         'tarkiln', 'emberheart', 'auroraloom', 'auroraweave']
insert = next(i for i, c in enumerate(kept) if c['id'] == 'runestone')
kept[insert:insert] = [build_chain(c) for c in order]
chains['chains'] = kept

for c in chains['chains']:
    for t in c['tiers']:
        g = t.get('generator')
        if not g:
            continue
        if c['id'] in COMPASS and t['tier'] == 3:
            g['produces'] = {'chain': COMPASS[c['id']], 'tier': 1}
        if c['id'] in COMPASS or c['id'] == 'hearthlamp':
            if t['tier'] == 3:
                g['bonus'] = {'every': BONUS_EVERY,
                              'produces': {'chain': c['id'], 'tier': 1}}
        walk(g, remap_node)
save('chains', chains)
print(f'chains.json: {len(DEAD)} removed, {len(order)} added, compass wave rewired')

# ----------------------------------------------- quests: the two specials --
# Run BEFORE the generic remap, or `keel` tier 4 becomes a `warhelm` tier 4
# that does not exist and the ladder proof fails on an unreachable goal.
quests = load('quests')
byid = {q['id']: q for q in quests['quests']}

# `keel` ran to four tiers and nothing replaces the Longhall, so the step that
# asked for one now asks for a SECOND FORGE — which is the farm structure's own
# loop, and the best place in the game to teach it.
lh = byid['north_longhall']
lh['title'] = 'Raise a Second Forge'
lh['steps'][1]['goal'] = {'kind': 'have', 'chain': 'wreckforge', 'tier': 3, 'count': 1}

# north_fuel asked for a Drift Stack — the wood generator — to open a fuel
# quest. Under the map that becomes a Bottled Ship, which has nothing to do with
# feeding a dragon, so the step asks for the fuel itself instead.
byid['north_fuel']['steps'][0]['goal'] = {
    'kind': 'have', 'chain': 'emberheart', 'tier': 1, 'count': 3}

for qid, title in (('north_hulls', 'Forge Two Helms'),
                   ('north_terms', 'Weave the Aurora')):
    byid[qid]['title'] = title
save('quests', quests)
print('quests.json: Longhall -> second forge, fuel step re-aimed, 3 titles')

# ------------------------------------------------- orders / quests / etc --
for name in ('orders', 'quests', 'cauldron', 'tasks', 'store'):
    p = D / f'{name}.json'
    if not p.exists():
        continue
    doc = load(name)
    hits = [0]

    def fn(node, hits=hits):
        if remap_node(node):
            hits[0] += 1

    walk(doc, fn)
    if hits[0]:
        save(name, doc)
    print(f'{name}.json: {hits[0]} chain references remapped')

# ----------------------------------------------------------------- text --
# Every line that named a dead object. Selyna's voice does not change: dry,
# clipped, and never charmed by the errand she is handing you.
ORDER_TEXT = {
    'selyna_signal': (
        'Set Two Marks',
        'You came a long way to stand on nine feet of ice. Bring me two of the netted floats '
        'and I will hang them where the light carries — then the coast is yours to walk. The '
        'door comes later, if I like what you do with it.'),
    'selyna_pitch': (
        'Feed the Northern Dragons',
        'Mine eat pitch, not berries. Nothing grows here, so the fire has to be dug up before '
        'it can be fed — three loaves of it. That is the whole north in one errand.'),
    'selyna_frames': (
        'Salvage the Wrecks',
        'Two banded helms. Every wreck brings iron ashore, and iron is the one thing the ice '
        'does not eat. Bring them up before the tide has another think.'),
    'selyna_spindle': (
        'Weave the Aurora',
        'Two cloaks, woven tight. My sister catches light and keeps it in glass; I catch it on '
        'a warp and it keeps something warm. Bring me these and I will tell you what I have '
        'been keeping.'),
}
#: repeatables have no ids — matched on the chain they now ask for.
REPEATABLE_TEXT = {
    'seaglass': ('More Glass Floats', 'Eight floats off the tide line. The marks do not hang '
                                      'themselves.'),
    'auroraweave': ('More Light Threads', 'Five threads. I weave in the evenings. It is not a '
                                          'hobby.'),
}
#: keyed by (chain, tier) because `emberheart` fills two repeatable rows.
REPEATABLE_BY_TIER = {
    ('emberheart', 2): ('More Pitch Loaves',
                        'Two more loaves. They have been out in it all night and they are not '
                        'sentimental about who feeds them.'),
    ('emberheart', 3): ('Another Ember Heart',
                        'One ember heart. Keep it away from the weave, and away from me.'),
}

orders = load('orders')
for o in orders['orders']:
    if o.get('id') in ORDER_TEXT:
        o['title'], o['blurb'] = ORDER_TEXT[o['id']]
for o in orders['repeatable']:
    req = (o.get('requires') or [{}])[0]
    hit = REPEATABLE_BY_TIER.get((req.get('chain'), req.get('tier'))) \
        or REPEATABLE_TEXT.get(req.get('chain'))
    if hit:
        o['title'], o['blurb'] = hit
save('orders', orders)
print('orders.json: 4 orders and 4 repeatables re-voiced')

CAULDRON_TEXT = {
    'broken_strake': ('iron_cap',
                      'Two glass floats, cracked back down and the metal off their nets drawn '
                      'out of the melt.',
                      'The wrecks give up iron far too slowly to arm anyone.'),
    'frost_thread': ('light_thread',
                     'A ground lens held against the lights until the colour comes off it in '
                     'a strand.',
                     'Thread without waiting on a whole Orrery to be built.'),
    'pitch_cake': ('pitch_loaf',
                   'Two beads of pitch and two floats of glass: the glass is what makes it '
                   'burn slow.',
                   "The north's fuel. Dragons eat it; hulls are sealed with it."),
    'spun_skein': ('woven_bolt',
                   'Two threads and a lens to hold them apart while they set.',
                   'Three make an Aurora Cloak — what Selyna\'s last order asks for.'),
    'oil_lamp': (None,
                 'Pitch for the burning, spirit for the light, and a wick of anything to hand.',
                 'Three make a Storm Lantern. Only a handful were ever left on the ice.'),
    'lodestone': (None,
                  'Two mana pebbles quarrelling over one iron cap, until one of them wins and '
                  'points.',
                  'The road to a Wayfinder, which pays in helms forever.'),
    'rune_shard': (None,
                   'An Ember Heart burns hot enough to split a nodule clean, and clean is the '
                   'whole art.',
                   'Three shards begin a second Runestone — and a Runestone makes fuel '
                   'forever.'),
    'rimewyrm_egg': (None,
                     'Wind the bolt, sink it in moonwater, and let the frost do the '
                     'remembering.',
                     'Legendary. Three Rimewyrm Eggs wake the Rimewyrm.'),
}

cauldron = load('cauldron')
renames = {}
for r in cauldron['recipes']:
    hit = CAULDRON_TEXT.get(r['id'])
    if not hit:
        continue
    new_id, flavor, use = hit
    if new_id:
        renames[r['id']] = new_id
        r['id'] = new_id
    r['flavor'], r['use'] = flavor, use
save('cauldron', cauldron)

quests = load('quests')


def rename_recipe(node):
    if node.get('recipeId') in renames:
        node['recipeId'] = renames[node['recipeId']]


walk(quests, rename_recipe)
save('quests', quests)
print(f'cauldron.json: {len(renames)} recipes renamed, 8 re-voiced; quests follow')

# --------------------------------------------------------------- zones --
# zones.json is GENERATED, but its Borealis seeds come from build-zones.mjs's
# BOREALIS_PLAN, which is edited by hand alongside this script. Remap the
# generated file too so a run without a regenerate is still coherent.
zones = json.loads((D / 'zones.json').read_text())
hits = [0]


def zfn(node, hits=hits):
    if remap_node(node):
        hits[0] += 1


walk(zones, zfn)
(D / 'zones.json').write_text(json.dumps(zones, indent=2, ensure_ascii=False) + '\n')
print(f'zones.json: {hits[0]} seed references remapped')

# --------------------------------------------------------------- assets --
assets = load('assets')
images = [i for i in assets['images']
          if not re.match(r'^item_(' + '|'.join(DEAD) + r')_\d+$', i.get('key', ''))]
anchor = next(i for i, im in enumerate(images) if im.get('key') == 'item_runestone_1')
for cid in order:
    for t in (1, 2, 3):
        images.insert(anchor, {
            'key': f'item_{cid}_{t}',
            'source': 'file',
            'file': f'sprites/items/chains/{cid}_{t}.webp',
        })
        anchor += 1
assets['images'] = images
save('assets', assets)
print(f'assets.json: {len(order) * 3} keys registered')
