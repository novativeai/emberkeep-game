#!/usr/bin/env python3
"""The kid-clarity pass: every player-facing name and line, rewritten for 8–13.
Ids never change. docs/naming.md is the map this script applies. Re-runnable against
the pre-pass data; on already-passed data the code-string substitutions will not
match (they assert), which is the intended guard against applying it twice."""
import json, re, sys
from pathlib import Path

R = Path(__file__).resolve().parents[1]
def load(p): return json.loads((R / p).read_text())
def save(p, d): (R / p).write_text(json.dumps(d, indent=2, ensure_ascii=False) + '\n')

# ---------------------------------------------------------------- chains
TIERS = {
  'sparkweed':   ['Spark Sprout', 'Spark Flower', 'Fire Flower'],
  'strawberry':  ['Berry Sprout', 'Berry Bush', 'Big Berry Bush'],
  'ember_dragon':['Ruby', 'Red Dragon Egg', 'Red Dragon', 'Big Red Dragon'],
  'flame_gem':   ['Gem Chip', 'Fire Gem', 'Sun Gem'],
  'lumber':      ['Logs', 'Planks', 'House', 'Mansion'],
  'bigtree':     ['Old Tree'],
  'firgrain':    ['Tree Seed', 'Small Tree', 'Big Tree'],
  'crystal':     ["Eleanor's Crystal"],
  'coin':        ['Gold Coin', 'Bag of Gold'],
  'emerald':     ['Emerald', 'Green Dragon Egg', 'Green Dragon', 'Big Green Dragon'],
  'frost':       ['Frost Dragon Egg', 'Frost Dragon', 'Big Frost Dragon'],
  'storm':       ['Storm Dragon Egg', 'Storm Dragon', 'Big Storm Dragon'],
  'golden_egg':  ['Golden Egg', 'Golden Elder'],
  'chest':       ['Treasure Chest'],
  'firepine':    ['Fire Pine Sprout', 'Small Fire Pine', 'Fire Pine'],
  'cinder_vein': ['Cracked Rock', 'Glowing Rock', 'Crystal Rock'],
  'dew_basin':   ['Hollow Stone', 'Dew Bowl', 'Dew Fountain'],
  'emberberry':  ['Emberberry', 'Berry Basket', 'Emberberry Jam'],
  'resin':       ['Sap Drop', 'Sap Ball', 'Sap Cookie'],
  'ashmoss':     ['Moss Puff', 'Moss Bunch', 'Moss Pile'],
  'emberbark':   ['Mossy Stump'],
  'stormcap':    ['Storm Mushroom', 'Mushroom Bunch', 'Lightning Mushroom'],
  'nightbloom':  ['Night Bud', 'Night Flower', 'Flower Crown'],
  'quartz':      ['Crystal Chip', 'Crystal', 'Crystal Ball'],
  'moonwater':   ['Dew Drop', 'Dew Bottle', 'Moonwater'],
  'nest':        ['Cold Nest'],
  'glasskiln':   ['Fire Brick', 'Oven Rack', 'Glass Oven'],
  'seaglass':    ['Glass Ball', 'Glass Float', 'Ship in a Bottle'],
  'starbench':   ['Gear', 'Gear Wheel', 'Star Workbench'],
  'orrery':      ['Glass Lens', 'Spyglass', 'Star Machine'],
  'wreckforge':  ['Iron Bar', 'Bellows', 'Shipwreck Forge'],
  'warhelm':     ['Iron Hat', 'Iron Helmet', 'Horned Helmet'],
  'tarkiln':     ['Tar Scoop', 'Tar Bucket', 'Tar Oven'],
  'emberheart':  ['Tar Drop', 'Tar Loaf', 'Ember Heart'],
  'auroraloom':  ['Silver Spool', 'Spinning Wheel', 'Aurora Loom'],
  'auroraweave': ['Light Thread', 'Light Cloth', 'Aurora Cloak'],
  'runestone':   ['Rune Chip', 'Carved Rune', 'Runestone'],
  'emberdram':   ['Fire Juice', 'Juice Jug', 'Juice Barrel'],
  'hearthlamp':  ['Oil Lamp', 'Big Lantern', 'Warm Lamp'],
  'manastone':   ['Magic Pebble', 'Magic Rock', 'Magic Stone Tower'],
  'wayfinder':   ['Magnet Rock', 'Compass Needle', 'Treasure Compass'],
  'ashdrake':    ['Ash Dragon Egg', 'Ash Dragon'],
  'rimewyrm':    ['Ice Dragon Egg', 'Ice Dragon'],
}
CHAIN_NAMES = {
  'sparkweed': 'Spark Flowers', 'strawberry': 'Berry Bushes', 'ember_dragon': 'Red Dragons', 'flame_gem': 'Fire Gems',
  'lumber': 'Wood & Houses', 'bigtree': 'Old Tree', 'firgrain': 'Trees', 'crystal': "Eleanor's Crystal", 'coin': 'Gold',
  'emerald': 'Green Dragons', 'frost': 'Frost Dragons', 'storm': 'Storm Dragons', 'golden_egg': 'Golden Dragon',
  'chest': 'Treasure Chest', 'firepine': 'Fire Pines', 'cinder_vein': 'Crystal Rocks', 'dew_basin': 'Dew Fountain',
  'emberberry': 'Emberberries', 'resin': 'Tree Sap', 'ashmoss': 'Moss', 'emberbark': 'Mossy Stump', 'stormcap': 'Storm Mushrooms',
  'nightbloom': 'Night Flowers', 'quartz': 'Crystals', 'moonwater': 'Moonwater', 'nest': 'Cold Nest',
  'glasskiln': 'Glass Oven', 'seaglass': 'Sea Glass', 'starbench': 'Star Workbench', 'orrery': 'Spyglasses',
  'wreckforge': 'Shipwreck Forge', 'warhelm': 'Iron Helmets', 'tarkiln': 'Tar Oven', 'emberheart': 'Tar & Ember Hearts',
  'auroraloom': 'Aurora Loom', 'auroraweave': 'Light Cloth', 'runestone': 'Runestones', 'emberdram': 'Fire Juice',
  'hearthlamp': 'Lamps', 'manastone': 'Magic Stones', 'wayfinder': 'Compasses', 'ashdrake': 'Ash Dragon', 'rimewyrm': 'Ice Dragon',
}
OLD_TIERS = {}
def do_chains():
  d = load('src/data/chains.json')
  for c in d['chains']:
    names = TIERS[c['id']]
    assert len(names) == len(c['tiers']), c['id']
    for t, n in zip(c['tiers'], names):
      OLD_TIERS[(c['id'], t['tier'])] = t['name']
      t['name'] = n
    if 'name' in c: c['name'] = CHAIN_NAMES[c['id']]
  save('src/data/chains.json', d)
N = lambda chain, tier: TIERS[chain][tier - 1]

# ---------------------------------------------------------------- quests
QUESTS = {
  'rekindle_brazier': ('Light the Fire Bowl', {'brazier_merges': 'Merge 10 times', 'brazier_shards': 'Collect 6 Gem Chips', 'brazier_deliver': 'Deliver 6 Gem Chips to Eleanor'}),
  'fill_the_larder': ('Make Emberberry Jam', {'larder_preserve': 'Make 1 Emberberry Jam'}),
  'warm_the_hearth': ('Warm the Fireplace', {'hearth_gems': 'Make 2 Fire Gems', 'hearth_deliver': 'Deliver 2 Fire Gems to Eleanor'}),
  'raise_the_roofs': ('Build Two Houses', {'roofs_houses': 'Build 2 Houses', 'roofs_thatch': 'Make 2 Moss Bunches for the roofs'}),
  'the_long_gallery': ('Light the Hallway', {'gallery_crystals': 'Make 2 Crystals'}),
  'catch_the_moonwater': ('Make Moonwater', {'moonwater_make': 'Make 1 Moonwater', 'moonwater_deliver': 'Deliver 1 Moonwater to Eleanor'}),
  'radiant_centerpiece': ('Make a Sun Gem', {'centerpiece_radiant': 'Make 1 Sun Gem', 'centerpiece_deliver': 'Deliver 1 Sun Gem to Eleanor'}),
  'what_she_keeps': ('A Gift for Eleanor', {'keeps_basket': 'Make 2 Berry Baskets', 'keeps_deliver': 'Deliver 2 Berry Baskets to Eleanor', 'keeps_preserve': 'Give Eleanor 1 Emberberry Jam from your Bag'}),
  'keepers_hoard': ('Fill the Treasure Room', {'hoard_manor': 'Merge 2 Houses into a Mansion', 'hoard_radiant': 'Make 3 Sun Gems', 'hoard_deliver': 'Deliver 3 Sun Gems to Eleanor'}),
  'keepers_tasks': ("The Keeper's Tasks", {}),
  'the_ashdrake_wakes': ('Wake the Ash Dragon', {'ashdrake_hatch': 'Merge 3 Ash Dragon Eggs into the Ash Dragon'}),
  'north_landing': ('Make Camp on the Ice', {'landing_faggot': 'Merge 3 Glass Balls into a Glass Float', 'landing_deliver': 'Deliver 2 Glass Floats to Selyna'}),
  'north_coast': ('Open the Shipwreck Coast', {'coast_open': 'Use 1 Gold Key on the clouds by the coast'}),
  'north_strakes': ('Brew Iron Hats', {'strakes_brew': 'Brew 4 Iron Hats in the Cauldron'}),
  'north_fuel': ('Feed the Northern Dragons', {'fuel_stack': 'Get 3 Tar Drops from the Tar Oven', 'fuel_cakes': 'Make 3 Tar Loaves', 'fuel_deliver': 'Deliver 3 Tar Loaves to Selyna'}),
  'north_threadwork': ('Brew Light Thread', {'thread_brew': 'Brew 4 Light Threads from Spyglasses'}),
  'north_salvage': ('Search the Shipwrecks', {'salvage_frames': 'Make 2 Iron Helmets at the Shipwreck Forge', 'salvage_deliver': 'Deliver 2 Iron Helmets to Selyna'}),
  'north_pitchpot': ('Bricks for a New Oven', {'pitchpot_brew': 'Brew 3 Fire Bricks'}),
  'north_door': ("Open Selyna's Castle", {'door_open': 'Use 2 Gold Keys on the clouds around the castle'}),
  'north_lamplight': ('Lamps for the Long Night', {'lamplight_brew': 'Brew 3 Oil Lamps'}),
  'what_she_will_take': ('A Gift for Selyna', {'take_faggot': 'Make 2 Glass Floats', 'take_deliver': 'Deliver 2 Glass Floats to Selyna', 'take_flowers': 'Give Selyna 3 Glass Lenses from your Bag'}),
  'north_lodestones': ('Make Magnet Rocks', {'lodestones_brew': 'Brew 3 Magnet Rocks'}),
  'north_hulls': ('Make Two Horned Helmets', {'hulls_pair': 'Make 2 Horned Helmets'}),
  'north_skeins': ('Weave Light Cloth', {'skeins_brew': 'Brew 3 Light Cloths'}),
  'north_pitchworks': ('Make an Ember Heart', {'pitchworks_ember': 'Make 1 Ember Heart'}),
  'north_runeshards': ('Make Rune Chips', {'runeshards_brew': 'Brew Rune Chips from an Ember Heart'}),
  'north_longhall': ('Build a Second Forge', {'longhall_hull': 'Merge 3 Iron Helmets into a Horned Helmet', 'longhall_build': 'Build a second Shipwreck Forge from 3 Bellows'}),
  'north_terms': ('Weave the Aurora', {'terms_regard': "Fill 1 of Selyna's hearts", 'terms_bloom': 'Build a Star Machine from 9 Glass Lenses', 'terms_spindle': 'Make 2 Aurora Cloaks', 'terms_deliver': 'Deliver 2 Aurora Cloaks to Selyna'}),
  'the_rimewyrm_wakes': ('Wake the Ice Dragon', {'rimewyrm_hatch': 'Merge 3 Ice Dragon Eggs into the Ice Dragon'}),
  'elder_seeing_stones': ('Make Two Crystals', {'elder_stones': 'Make 2 Crystals'}),
  'elder_green_over_ash': ('Make Two Moss Piles', {'elder_bales': 'Make 2 Moss Piles'}),
  'elder_old_forest': ('Grow Two Big Trees', {'elder_firs': 'Grow 2 Big Trees'}),
  'elder_kindle_brood': ('Raise Two Red Dragons', {'elder_dragons': 'Raise 2 Red Dragons'}),
  'elder_gold_in_hand': ('Fill Two Bags of Gold', {'elder_pouches': 'Make 2 Bags of Gold'}),
  'elder_grow_keeper': ('Reach Level 4', {'elder_level4': 'Reach Keeper Level 4'}),
  'elder_berry_mother': ('Grow Two Big Berry Bushes', {'elder_berries': 'Grow 2 Big Berry Bushes'}),
  'elder_cold_light': ('Fill Three Dew Bottles', {'elder_vials': 'Make 3 Dew Bottles'}),
  'elder_far_sight': ('Make a Crystal Ball', {'elder_ball': 'Make 1 Crystal Ball'}),
  'elder_rise_higher': ('Reach Level 5', {'elder_level5': 'Reach Keeper Level 5'}),
  'elder_two_flames': ('Raise a Big Red Dragon', {'elder_adult': 'Merge 2 Red Dragons into a Big Red Dragon'}),
  'elder_true_keeper': ('A True Keeper', {'elder_level6': 'Reach Keeper Level 6'}),
}
def do_quests():
  d = load('src/data/quests.json')
  for q in d['quests']:
    if q['id'] not in QUESTS:
      assert 'title' not in q, q['id']  # the endless tails borrow the live order's title
      continue
    title, steps = QUESTS[q['id']]
    q['title'] = title
    for s in q['steps']:
      if s['id'] in steps: s['label'] = steps[s['id']]
      else: assert 'label' not in s, (q['id'], s['id'])
  save('src/data/quests.json', d)

# ---------------------------------------------------------------- orders
ORDERS = {
  'eleanor_brazier': ('Light the Fire Bowl', 'Bring me 6 Gem Chips, Keeper. The Fire Bowl has been cold for sixty years. Light it, and I will show you my surprise.'),
  'eleanor_hearth': ('Warm the Fireplace', 'Merge 3 Gem Chips to make a Fire Gem. Bring me 2 Fire Gems and the big hall will be warm tonight.'),
  'eleanor_moonwater': ('Make Moonwater', '3 Dew Drops make a Dew Bottle. 3 Dew Bottles make Moonwater. Bring me 1 Moonwater — I need it for my magic.'),
  'eleanor_centerpiece': ('Make a Sun Gem', 'Merge 3 Fire Gems to make a Sun Gem. Bring me 1 Sun Gem. It will light up the whole hall.'),
  'eleanor_keeps': ('A Gift for Eleanor', 'Bring me 2 Berry Baskets. I will save them for winter, when nothing grows.'),
  'eleanor_hoard': ('Fill the Treasure Room', 'One last big order: 3 Sun Gems. That fills my treasure room, and proves Emberkeep is alive again.'),
  'selyna_signal': ('Make Camp on the Ice', 'You came a long way to stand on the ice. Bring me 2 Glass Floats. I will hang them up as lights. Then you may explore the coast.'),
  'selyna_pitch': ('Feed the Northern Dragons', 'My dragons eat Tar Loaves, not berries. Nothing grows up here. Bring me 3 Tar Loaves.'),
  'selyna_frames': ('Search the Shipwrecks', 'Every shipwreck brings iron to the beach. Make 2 Iron Helmets at the forge and bring them to me.'),
  'selyna_buoys': ('A Gift for Selyna', 'Bring me 2 Glass Floats. Carry them up the beach yourself. I want to see how you work.'),
  'selyna_spindle': ('Weave the Aurora', 'Weave 2 Aurora Cloaks and bring them to me. Do that, and I will tell you the secret I have been keeping.'),
}
REPEATABLE = [
  ('More Gem Chips', 'The Fire Bowl is hungry again. Bring me 8 Gem Chips, please.'),
  ('More Fire Gems', 'Bring me 2 Fire Gems for the hallway lamps.'),
  ('More Rubies', 'Bring me 5 Rubies. Your red dragon finds them everywhere.'),
  ('Another Sun Gem', 'One more Sun Gem, please. The Keep can never be too bright.'),
  ('More Glass Balls', 'Bring me 8 Glass Balls from the beach. I need more lights.'),
  ('More Tar Loaves', '2 more Tar Loaves. My dragons are hungry again.'),
  ('More Light Thread', 'Bring me 5 Light Threads. I weave in the evenings.'),
  ('Another Ember Heart', 'One more Ember Heart. Keep it away from the cloth — it is hot!'),
]
def do_orders():
  d = load('src/data/orders.json')
  for o in d['orders']:
    o['title'], o['blurb'] = ORDERS[o['id']]
  assert len(d['repeatable']) == len(REPEATABLE)
  for o, (t, b) in zip(d['repeatable'], REPEATABLE):
    o['title'], o['blurb'] = t, b
  save('src/data/orders.json', d)

# ---------------------------------------------------------------- tasks
TASKS = {'recipes_20': 'Find 20 Cookbook recipes', 'orders_5': "Finish 5 of Eleanor's orders", 'gold_500': 'Earn 500 Gold', 'merges_30': 'Merge 30 times', 'elder_10': 'Tap the Golden Elder 10 times'}
def do_tasks():
  d = load('src/data/tasks.json')
  for t in d['tasks']:
    t['label'] = TASKS[t['id']]
    if 'lockedHint' in t: t['lockedHint'] = "Opens at Keeper Level 3, after Eleanor's first order"
  save('src/data/tasks.json', d)

# ---------------------------------------------------------------- tutorial
TUTORIAL = {
  'arrival_miss': "Oh! You landed in the wrong spot.",
  'arrival_place': "Welcome to Emberkeep. I tried to bring you to the big hall, but my spell dropped you here instead.",
  'arrival_ash': "Careful where you step. That grey stuff is ash. Long ago, a huge fire went out here all at once.",
  'arrival_slip': "What put the fire out? I have wondered for years. I read every book about it. I was—",
  'arrival_hold': "…Never mind. I will tell you that story later.",
  'arrival_why': "Here is why I called YOU: when you landed, the ash under your hands got warm. That has not happened in sixty years.",
  'arrival_ask': "So I need your help. Let's bring Emberkeep back to life: the warmth, the plants, and the dragons sleeping under the ash. You can do it, Keeper.",
  'moss_stump': "See that old burnt stump? Moss is growing on it. Tap the stump to pick a Moss Puff. It will always grow more.",
  'ash_green': "Look, the ash turns green where you touched it! Now you have 3 Moss Puffs. Drag them together to MERGE them.",
  'arrival_answered': "You did it! Merging 3 of the same thing makes 1 better thing. That is how everything works here.",
  'cookbook_intro': "Your first recipe! Every merge you discover is written in your Cookbook. Tap the book to see it.",
  'cookbook_close': "There is your Moss Bunch page. Tap the ✕ to close the book. Now let's hatch a dragon!",
  'ruby_merge': "Three red Rubies! Drag them together to make a Red Dragon Egg.",
  'dragon_hatch': "A Red Dragon Egg! Two more appeared. Drag all three eggs together to hatch your dragon!",
  'name_intro': "Look at her! She is your very first dragon. Let's give her a name.",
  'name_choose': "Type a name for your Red Dragon and tap OK. She will keep it forever.",
  'name_said': "{dragon}. I love it. It has been sixty years since anyone named a dragon here.",
  'moss_feed': "{dragon} is hungry! Red dragons love moss. Your Moss Bunch grew into a Moss Pile. Drag it onto {dragon} to feed her.",
  'crystal_tap': "See my purple Crystal? It makes Crystal Chips. Tap the Crystal to take one. Two more already fell off.",
  'quartz_merge': "Drag the three Crystal Chips together to make a Crystal. Dragons don't eat crystals. These are for me.",
  'quartz_ball': "Two more Crystals appeared. Merge all three into a Crystal Ball. I use Crystal Balls for my magic.",
  'ball_pocket': "Let's put the Crystal Ball away. Tap it, and it goes into your Bag. That keeps the board clear.",
  'ball_give': "Now open your Bag and tap the Crystal Ball. You can Drop it, Sell it, or Give it. Tap GIVE.",
  'eleanor_gift': "Now tap me to give me the Crystal Ball.",
  'eleanor_hearts': "Thank you! See the hearts under your quest list? Those are MY hearts. They fill up when you help me.",
  'chest': "A Treasure Chest! Tap it to open it and get your prize.",
  'levelup': "You reached Level 2! New land opened up to the west. Tap to take a look!",
  'key_unlock': "Your dragon found a Gold Key! See the cloudy land? Tap the clouds to clear them away.",
  'board_room': "One more trick: the Mossy Stump can work anywhere. Drag it to the glowing spot on the far island. It will grow moss there too.",
  'emberberry_tap': "A Berry Bush grew in the new land! Tap it to pick an Emberberry. Picking berries is FREE — it never costs Warmth.",
  'emberberry_merge': "Two more berries! Merge the three Emberberries into a Berry Basket. The bush grows new berries forever.",
  'wood_merge': "Look, Logs! Drag the three piles of Logs together to make Planks.",
  'plank_merge': "Two more Planks appeared. Merge all three Planks to build a House. A House makes Gold Coins while you play!",
  'tree_grain': "Three Tree Seeds came out with the wood. They are right next to your House.",
  'grain_merge': "Drag the three Tree Seeds together to grow a Small Tree.",
  'fir_grow': "Two more Small Trees grew! Merge all three to get a Big Tree. Big Trees drop Logs for you.",
  'pocket_it': "That Cracked Rock has nothing to merge with right now. Tap it to put it in your Bag.",
  'sell_it': "Now open your Bag and tap the rock. Tap SELL to turn it into Gold. Gold buys Warmth and speeds things up.",
  'isle_materials': "See those Dew Drops? They make Moonwater, which I need for my magic. A Dew Fountain in the south makes more.",
  'moonwater_merge': "Drag the three Dew Drops together to make a Dew Bottle. Three Dew Bottles make Moonwater.",
  'dragon_work': "Dragons can make your House work faster! Drag {dragon} and drop her on the House. One dragon = 2× speed. Two = 4×!",
  'dragon_rest': "Working makes dragons tired. After 3 minutes {dragon} flies home to rest. Then she is ready to work again.",
  'resin_find': "While she rests, look at the Big Tree. Sticky Sap Drops are on its trunk. Three of them!",
  'resin_merge': "Drag the three Sap Drops together to make a Sap Ball.",
  'hearth_cake': "Two more Sap Balls! Merge all three to make a Sap Cookie. Dragons LOVE Sap Cookies.",
  'feed_dragon': "Sap Cookies are {dragon}'s favourite food. Drag the Sap Cookie onto her.",
  'codex_meal': "The Dragon Codex noticed! Every dragon you name gets a page in it. Tap {dragon}'s card to open her page.",
  'codex_taste': "See FAVOURITE MEAL? It shows what she loves to eat. Now tap EVOLUTION.",
  'codex_evolution': "That dark shape is what {dragon} will grow into! It stays hidden until she is big.",
  'codex_cycles': "See the counter under her? Fill her food bar all the way, and you earn one point. Points never go away.",
  'codex_reward': "Get 6 points and she grows into a Big Red Dragon! Then you see her in full colour.",
  'codex_shut': "That is the Dragon Codex. It is yours whenever you need it. Tap ✕ to close it.",
  'cake_loved': "Look how happy she is! A favourite food fills her up twice as fast as other food.",
  'dragon_status': "Under your quest list is {dragon}'s card. Her hearts show how much she trusts you. Tap her card to read it. Tap mine to see my hearts.",
  'resin_pocket': "One Sap Drop rolled away. Tap it to put it in your Bag.",
  'house_commission': "Tap your House, then pick what it should make. Pick the Gold Coin — your House will make coins forever!",
  'house_skip': "The House needs time to make things. Tap the House, then spend Warmth ⚡ to skip the wait.",
  'eleanor_helps': "I can help too! Tap me, then tap the House. I will make it finish faster.",
  'buy_energy': "Out of Warmth? It comes back slowly by itself. Your first Ember Spark is FREE. Tap the ⚡ + button to get it.",
  'gem_harvest': "{dragon} makes Gem Chips! Tap her to take one. Tapping a dragon costs 1 Warmth.",
  'ledger_open': "You have enough Gem Chips! Tap the Orders button to open my order list. I have been waiting for those.",
  'ledger_deliver': "My first order: Light the Fire Bowl. Tap DELIVER to give me the Gem Chips. You get Gold, and a surprise!",
  'golden_tease': "Here is my surprise. Look west: a GOLDEN EGG sleeps on the old altar. It moved when you arrived! I will tell you its story soon.",
  'free_play': "Emberkeep is yours now, Keeper! Finish my orders and reach Level 3. Then the Golden Egg will be ready to wake.",
}
def do_tutorial():
  d = load('src/data/tutorial.json')
  seen = set()
  for s in d['steps']:
    s['text'] = TUTORIAL[s['id']]; seen.add(s['id'])
  assert seen == set(TUTORIAL), set(TUTORIAL) ^ seen
  save('src/data/tutorial.json', d)

# ---------------------------------------------------------------- dialogue
E, S, G = 'eleanor', 'selyna', 'golden_elder'
q = lambda t, who='Eleanor': f'“{t}” — {who}'
DIALOGUE = {
  'orderComplete': {
    '1': [q('Done already? Great job! Rest a bit — the next order will be here soon.'), q('It is getting warmer here. You did that.'), q('That is today\'s work done. Thank you, Keeper.'), q('Wonderful! Do that again tomorrow and Emberkeep will be back in no time.')],
    '2': [q('Something on the hill just woke up a little. It felt what you did.'), q('Another order done! The island is counting, even if you are not.'), q('You are really good at this. Keep going!')],
    '3': [q('Thank you. I mean it.'), q('Take the Gold and buy something fun. That is an order!'), q('Things are going faster than I ever dreamed.')],
    '4': [q('Done! And you are still here. I notice that every time.'), q('The next order is ready when you are.'), q('You are better at this than I ever was. Truly.')],
    '5': [q('The Golden Elder watches you work, you know. She does not watch me.'), q('You keep helping, every single day. Thank you.'), q('Thank you, Keeper. I am so glad you came.')],
    '6': [q('My sister will say we are doing this the slow way. She says that about everything.'), q('It is cold up north. Her magic holds things; mine gives them back. I am learning, and I like it.')],
  },
  'goldenEgg': {
    'early': ["It's warm…", "Something very old is inside…", "It hums an old, old song."],
    'mid': ["It's getting warmer!", "Was that… a heartbeat?", "It remembers the Great Flame…"],
    'near': ["It's shaking!", "The gold glows bright — she is almost awake!"],
  },
  'finaleElder': [
    "…Keeper. I slept for a very long time, and YOU woke me. So hear the truth: the Great Flame did not die. It was TAKEN. Someone carried it NORTH.",
    "A woman lives on the ice up north. She kept a light burning while the rest of us slept. She will not be happy to see you. Go anyway.",
  ],
  'finaleElderProphecy': [
    "…Keeper. I am waking up, but I cannot rise yet. The altar is still cold, and Eleanor's first order is not done.",
    "Finish it, and I will tell you a secret: the Great Flame did not die. It was TAKEN.",
  ],
  'goldenArrival': q("The old altar is answering you, Keeper! So the stories about that egg were true."),
  'gateOpens': {'speaker': E, 'lines': [
    "Do you feel that? Next to her altar, a door opened in the air. She woke up, and the way north opened with her.",
    "It leads to the ice. My sister lives there. Her name is Selyna. She is sharper than me, and she has been alone a very long time.",
    "Tap the door whenever you are ready, Keeper. I will keep Emberkeep warm while you are gone.",
  ]},
  'tours': {
    'roothold': {
      'intro': ["This is Roothold — my home! The fire never reached this roof.", "I ran my shop up here alone for sixty years. From today, it is open for you."],
      'house': "That house is my shop, the Emporium. Tap it.",
      'sections': ["Mansion looks. Dress up your Mansion any way you like.", "Decorations. Small things that make the island feel like yours.", "Dragon looks. New colours for your dragons. They love to show off!"],
      'close': "That is the whole shop. Tap the ✕ to close it.",
      'outro': "The shop button is now at the bottom right, wherever you are. My shelves are always open, Keeper.",
    },
    'runevault': {
      'intro': ["This is the Runevault. Every dragon in the north hatched inside that circle.", "I will show you one thing today."],
      'cauldron': "See the Cauldron on the rune? Tap it.",
      'explain': "The Cauldron uses things from your Bag. Put the right things in, and it makes something new. Each recipe tells you what it needs.",
      'close': "Tap the ✕ to close it. That is all for today.",
    },
  },
  'lateAwakening': "…At last. I waited for YOU, Keeper. The Golden Elder rises, just like the stories said.",
  'eggGift': {
    'ashdrake': {'speaker': E, 'lines': [
      "An Ash Dragon Egg, for you, Keeper! Keep it safe. You need 3 eggs to hatch an Ash Dragon.",
      "Another Ash Dragon Egg! Put it next to the first one. One more to go.",
      "The last Ash Dragon Egg! Drag all three together to hatch the Ash Dragon.",
    ]},
    'rimewyrm': {'speaker': S, 'lines': [
      "An Ice Dragon Egg, from deep under the ice. It waited down there for ages. You need 3 eggs to hatch it.",
      "A second Ice Dragon Egg. Keep them close together. One more.",
      "The last Ice Dragon Egg. Merge all three, and meet the Ice Dragon. Gently, Keeper.",
    ]},
  },
  'hints': {
    'zeroWarmth': "Out of Warmth? Wait a little — it comes back by itself. Picking berries never costs Warmth!",
    'boardFull': "The board is full! Sell a spare piece from your Bag, or deliver an order to make room.",
    'eggTrembles': "Keeper, look at the egg on the old altar! It is SHAKING!",
    'twoDragons': "TWO Red Dragons! Drag them together to make a Big Red Dragon!",
    'twoHouses': "Two Houses! Drag them together to build a Mansion. A Mansion makes even more Gold.",
    'goldSkip': "Tired of waiting? You can skip with Gold or with Warmth. The longer you wait, the cheaper it gets.",
    'houseCommission': "Tap a House and pick ONE thing from your Bag. The House will make that thing forever. Want a second thing? Build a second House.",
    'glassKiln': "That is the Glass Oven. It makes Glass Balls. Every 12th time, it also drops a Fire Brick. Keep them! 9 Fire Bricks build a second oven.",
    'starBench': "That is the Star Workbench. It makes Glass Lenses. 3 Lenses make a Spyglass. 9 make a Star Machine — I will ask you for one.",
    'wreckForge': "That is the Shipwreck Forge. It makes Iron Hats from old ship iron. Iron is the best thing to find up here.",
    'tarKiln': "That is the Tar Oven. It digs up Tar Drops. My dragons eat tar, not berries — you will use this one a lot.",
    'auroraLoom': "That is the Aurora Loom. It catches the northern lights and makes Light Thread. It is slow, so start it and let it work.",
  },
  'tasksComplete': q("Every task is done! Emberkeep has not been this warm in ages. You earned a rest, Keeper."),
  'elder': {
    'greeting': [
      "You stayed. Good. I slept for a very long time, and I know who is worth waking up for.",
      "Eleanor has her orders. I have something older: the Keeper's Tasks. From today, my tasks sit next to hers.",
      "Look at your quest list, top right. Tap the small arrow next to it to switch between her quests and mine. Let's begin.",
    ],
    'quests': {
      'elder_seeing_stones': {'start': "First, eyes. Make me 2 Crystals. I slept so long — I want to SEE the island again.", 'done': "Clear and sharp. The island looks smaller than I remember, and better cared for."},
      'elder_green_over_ash': {'start': "The fire took the green first. Make 2 Moss Piles, Keeper. Show me the ground is alive.", 'done': "Green over ash. The oldest kind of magic there is."},
      'elder_old_forest': {'start': "Before the castle, before the Flame, there were the trees. Grow 2 Big Trees, and the wind will sing again.", 'done': "They creak just like the old ones did. I stopped to listen."},
      'elder_kindle_brood': {'start': "One dragon is a survivor. TWO are a family. Raise a second Red Dragon.", 'done': "Two fires in the sky at once. I had forgotten how that sounds."},
      'elder_gold_in_hand': {'start': "Gold is patience you can hold. Do not spend it all — keep 2 Bags of Gold.", 'done': "You can hold Gold without spending it. That is rarer than any dragon."},
      'elder_grow_keeper': {'start': "Enough small jobs. Grow, Keeper. Reach Level 4, and the land past the old fence will open.", 'done': "Level 4! The ground felt it. More of the island is yours now."},
      'elder_berry_mother': {'start': "The berry bushes fed the castle through the last winter. Grow 2 Big Berry Bushes.", 'done': "Sweet things are supplies too, Keeper. The castle knew that."},
      'elder_cold_light': {'start': "Eleanor makes Moonwater. I ask for the step before: 3 Dew Bottles, cold and clear.", 'done': "Cold and clear. She will make wonders with these."},
      'elder_far_sight': {'start': "Now, far sight. Make 1 Crystal Ball, Keeper. I want to look NORTH, where the Flame was taken.", 'done': "…Ice. A beach. A woman who does not sleep. The north keeps what we lost."},
      'elder_rise_higher': {'start': "Higher, Keeper. Reach Level 5. The last fenced land waits for it, and so do I.", 'done': "Level 5, and the whole island is yours. Nearly there now."},
      'elder_two_flames': {'start': "Merge your 2 Red Dragons into a Big Red Dragon. Emberkeep needs a big dragon to watch over it.", 'done': "A Big Red Dragon! Emberkeep will not go dark again."},
      'elder_true_keeper': {'start': "One thing is left, and I cannot give it to you. Reach Level 6. Become a TRUE Keeper.", 'done': "It is done."},
    },
    'allDone': "It is done. A true Keeper stands on Emberkeep, and I saw it with my own eyes. Whatever the north asks of you now, you are ready.",
  },
  'regard': {
    'eleanor': {
      'giftAccepted': ["Oh, for me? Thank you! I will put it where I can see it.", "Thank you. I am keeping this one!", "You did not have to. I wrote it down in my book, so I will never forget.", "Oh! Thank you. That was very kind."],
      'giftDeclined': ["That is kind, but I do not need it right now. Check my quest list — it says what I need.", "Keep that one. I have nowhere to put it.", "No thank you. You will need it more than I do."],
      'hearts': {
        '1': {'speaker': E, 'lines': ["Wait a moment. You have already stayed longer than most people do here.", "The last three visitors saw the ash and went home the next morning. You stayed. That means a lot to me."]},
        '2': {'speaker': E, 'lines': ["I have kept the order book since I was eleven years old. There was nobody else to do it.", "So when I hand you an order, I am handing you the most important thing I have."]},
        '3': {'speaker': E, 'lines': ["This morning I said 'our order book' by mistake. Then I thought about it.", "It was MY book for thirty years. Now it is OURS. I like that much better."]},
        '4': {'speaker': E, 'lines': ["I want to tell you something true.", "I was not just keeping this place warm. I was keeping it READY. For someone. I did not know who.", "Now I know. It was you. That is all. Let's get back to work before I cry."]},
        '5': {'speaker': E, 'lines': ["There you are. I know all your dragons' names now. I did not mean to learn them, but I did.", "Something is coming from the north. Whatever it is, you will not face it alone. Not while I am here.", "That is all. Go on. The order book will wait."]},
      },
    },
    'selyna': {
      'giftAccepted': ["…Fine. I will take it. Don't make a fuss.", "Useful. That is the nicest word I have, so don't expect another.", "You bring what I ask for, and nothing else. I like that.", "Put it down. …Thank you. There, I said it."],
      'giftDeclined': ["I did not ask for that. I ask for exactly what I need, and nothing more.", "No. Take it back before the cold gets into it.", "That is a gift, and I do not know what to do with gifts. Bring me what is on the list."],
      'hearts': {
        '1': {'speaker': S, 'lines': ["You came back. Most people don't. The crossing scares them off.", "I am not saying I like you. I am saying I noticed. There is a difference."]},
        '2': {'speaker': S, 'lines': ["You can walk the beach without me watching you now. I have other things to watch.", "The dragons decided about you first, by the way. They usually do. I trust them more than I trust myself."]},
        '3': {'speaker': S, 'lines': ["My sister sends you with good rope and careful instructions. She never once writes to ask how I am.", "I am not asking you to pick a side. I am just telling you how it is."]},
        '4': {'speaker': S, 'lines': ["You are being careful with me.", "Nobody is careful with me unless someone told them to be. So either she told you, or you worked it out yourself."]},
        '5': {'speaker': S, 'lines': ["Sit down. I will say this once.", "I spent my whole life guarding something nobody came for. Then you came. That changes everything, and I want you to know I noticed.", "…Right. That is enough of that. The dragons need feeding."]},
      },
    },
  },
  'chapters': {'2': {'speaker': E, 'lines': [
    "That is the first thing anyone has given back to this place in sixty years. I am trying not to cry. It is not working.",
    "You should know what my magic does. I can catch a thing, hold it, and give it back. That is all.",
    "The moon does the same trick every night. It borrows light from the sun and gives it back, softer. That is a kind of magic too.",
    "So when I ask you for Moonwater, remember: I never make anything new. I only give back what someone else lit first.",
  ]}},
  'arrivals': {'borealis': {'speaker': S, 'lines': [
    "So you are the one she found.",
    "Don't come closer yet. The ice between us is thin, and I have not decided about you.",
    "You want to know what I am guarding. Don't ask me yet.",
    "This little beach is all you get for now, Keeper. Only what the sea washes up.",
    "Nothing grows here. Everything up here was made, or saved from a shipwreck.",
    "That Glass Oven behind you still works. Make 2 Glass Floats and bring them to me. Then you can explore the coast.",
  ]}},
}
def do_dialogue():
  d = load('src/data/dialogue.json')
  assert set(d) == set(DIALOGUE), set(d) ^ set(DIALOGUE)
  def same_shape(a, b, path):
    if isinstance(a, dict):
      assert isinstance(b, dict) and set(a) == set(b), (path, set(a) ^ set(b) if isinstance(b, dict) else type(b))
      for k in a: same_shape(a[k], b[k], path + '.' + k)
    elif isinstance(a, list):
      assert isinstance(b, list), path
      if a and not isinstance(a[0], str): assert len(a) == len(b), path
      for x, y in zip(a, b): same_shape(x, y, path + '[]')
    else:
      assert type(a) == type(b), path
  same_shape(d, DIALOGUE, 'dialogue')
  save('src/data/dialogue.json', DIALOGUE)

# ---------------------------------------------------------------- cauldron
CAULDRON = {
  'hearth_cake': ("Selyna's everyday recipe: berries baked with a Fire Gem until they stick together.", "A full meal for any dragon. Eleanor loves one too."),
  'iron_cap': ("Melt a Glass Float, and the iron from its net comes out.", "Iron Hats are hard to find. This makes them faster."),
  'light_thread': ("Break a Spyglass into lenses, hold them up to the northern lights, and a strand of colour comes off.", "Makes Light Thread without building a whole Star Machine."),
  'pitch_loaf': ("Two Tar Drops and two Glass Balls. The glass makes it burn slowly.", "Dragon food in the north. Dragons eat it, and it seals boats too."),
  'oil_lamp': ("Tar to burn, Fire Juice for the light, and a wick.", "3 Oil Lamps make a Big Lantern. Only a few were ever left on the ice."),
  'lodestone': ("Two Magic Pebbles fight over one Iron Hat until one wins and points north.", "The first step to a Treasure Compass, which makes Gold forever."),
  'woven_bolt': ("Two Light Threads and a Spyglass to hold them apart while they set.", "3 Light Cloths make an Aurora Cloak. Selyna's last order needs those."),
  'rune_shard': ("An Ember Heart burns hot enough to split a Magic Rock into clean pieces.", "3 Rune Chips start a new Runestone. A Runestone makes Tar Drops forever."),
  'fire_brick': ("Clay needs a fire under it and an iron ring to hold its shape.", "9 Fire Bricks build a second Glass Oven."),
  'tar_spile': ("A glass tube and an iron tip. That is all a Tar Scoop is.", "9 Tar Scoops build a second Tar Oven."),
  'iron_billet': ("Three Iron Hats melted down, with a little tar to keep the fire honest.", "9 Iron Bars build a second Shipwreck Forge."),
  'brass_cog': ("Iron Hats melted and poured into a tiny gear shape.", "9 Gears build a second Star Workbench."),
  'silver_spindle': ("Iron pulled out as thin as thread, with a ring made from two lenses.", "9 Silver Spools build a second Aurora Loom."),
  'treasure_chest': ("Build a box from Logs and seal it with a warm gem. The island fills it on its own.", "Opens into Gold, Rubies, or a rare find."),
  'red_egg': ("Two Rubies remember being one heart. The jam is for the first thing it asks for.", "3 Red Dragon Eggs make a Red Dragon."),
  'green_egg': ("Moonwater poured over sweet jam until something green grows a shell.", "3 Green Dragon Eggs make a Green Dragon."),
  'ashdrake_egg': ("Ash wants tar, tar wants fire, and a Sun Gem is the only fire slow enough.", "Legendary! 3 Ash Dragon Eggs hatch the Ash Dragon."),
  'rimewyrm_egg': ("Roll up the cloth, sink it in Moonwater, and let the frost do the rest.", "Legendary! 3 Ice Dragon Eggs hatch the Ice Dragon."),
  'golden_egg': ("Fire that lasts, frost that lasts, and enough moonlight to make them agree.", "Mythic! The rarest egg the Cauldron knows."),
}
def do_cauldron():
  d = load('src/data/cauldron.json')
  for r in d['recipes']: r['flavor'], r['use'] = CAULDRON[r['id']]
  save('src/data/cauldron.json', d)

# ---------------------------------------------------------------- dragondex
DEX = {
  'ember_dragon': ('Red Dragon', "She hatched from a Ruby that the ash kept warm for sixty years. She is the first fire to come back to Emberkeep.", "Full of energy and always curious. She loves to explore every corner of the island.", "She can fly higher than any other young dragon, and wraps her tail around herself to stay warm at night.", 'Big Red Dragon'),
  'emerald': ('Green Dragon', "She hatched from an Emerald that the deep roots kept warm. The Red Dragon is the island's fire; she is its garden.", "Gentle and calm. She looks after things: a wilting plant, a cold nest, a tired Keeper.", "Her breath makes plants grow faster. Berries ripen early when she is near.", 'Big Green Dragon'),
  'frost': ('Frost Dragon', "She was born in winter, from an egg that never melted. Even in warm Emberkeep she carries a little snow with her.", "Calm and careful. She watches for a long time before she moves, and her landings never make a sound.", "She breathes a cool frost that calms anything that gets too hot, without putting the fire out.", 'Big Frost Dragon'),
  'storm': ('Storm Dragon', "He cracked his shell inside a thundercloud and rode the storm down to the island. The weather follows him like a puppy.", "Restless and crackly. He naps in high places, wakes with the wind, and loves a chase.", "His wings charge the air. He can call a small, polite thunder that rattles the windows and makes him very proud.", 'Big Storm Dragon'),
  'moonwhisker': ('Moonwhisker', "Nobody saw her arrive. One night the moon came up, and she was just there.", "Secretive and moon-led. She keeps her own hours and appears exactly where she wants to be.", "Her whiskers can read moonlight. In the dark she sees the island as clearly as at noon, and finds lost things.", 'Big Moonwhisker'),
  'ashdrake': ('Ash Dragon', "The old nests never got cold. Three eggs stayed warm under the ash for a hundred years, until a Keeper found them.", "Patient and watchful, like glowing embers. She remembers every hand that fed her.", "She breathes a slow, warm glow that brings cold things back to life. Cracked Rocks are her favourite snack.", None),
  'rimewyrm': ('Ice Dragon', "He waited deep under the ice of Borealis for a very long time. Three eggs, found one by one, finally met their Keeper.", "Quiet and slow to decide. He moves like a glacier: slowly, then all at once.", "He breathes a frosty mist that freezes a moment in place. Frost that keeps things safe, not frost that hurts.", None),
}
def do_dex():
  d = load('src/data/dragondex.json')
  for k, v in d['dragons'].items():
    t, story, pers, abil, into = DEX[k]
    v['title'], v['story'], v['personality'], v['ability'] = t, story, pers, abil
    if 'evolution' in v:
      v['evolution']['into'] = into
      v['evolution']['condition'] = f"Fully fed for {v['evolution']['wellFedCycles']} days"
  save('src/data/dragondex.json', d)

# ---------------------------------------------------------------- store
STORE_SECTIONS = {
  'skins': ('Mansion Looks', 'Give your Mansion a brand new look. It still makes the same Gold.'),
  'decor': ('Decorations', 'Placed on a free tile when you buy it. Just for fun — nothing merges with it. The big ones at the end can be seen from across the island.'),
  'dragons': ('Dragon Looks', 'You cannot buy a dragon — but your own dragons can wear a new look. Same eggs, same food, same friends.'),
}
STORE_ITEMS = {
  'manor_mushroom': ('Mushroom Cottage', 'Grown, not built. The big cap keeps the ash off like a roof keeps off rain.'),
  'manor_windmill': ('Old Windmill', 'It ground flour before the fire. The sails still turn in the wind.'),
  'manor_treehouse': ('Great Tree House', 'One tree survived the fire. Someone built a house in it.'),
  'manor_igloo': ('Igloo', 'Cut from Borealis ice and carried south. It still has not melted.'),
  'ash_urn': ('Ash Pot', 'The island turned to ash. Keeping a little of it helps us remember.'),
  'watch_bell': ('Watch Bell', 'Keepers rang this bell to call the dragons home.'),
  'rekindled_step': ('Mossy Step', 'Moss growing through a cracked step, with gold in the crack.'),
  'chain_anchor': ('Chain Anchor', 'One hook, one chain, one island held up. There are thousands of them.'),
  'ice_lantern': ('Ice Lantern', 'A flame kept inside ice. Someone up north knows how to do this.'),
  'frozen_spill': ('Frozen Waterfall', 'A waterfall that froze in the middle of falling.'),
  'rune_pad': ('Rune Stone', 'Glowing lines under the snow. Nobody lit them, but they still glow.'),
  'drift_cairn': ('Stone Pile', 'Stones, a green glass ball and a ribbon of light. A way of saying hello.'),
  'keeper_statue': ('The First Keeper', 'A statue of the very first Keeper. The little dragon at her feet is a mystery.'),
  'broken_arch': ('The Broken Gate', 'Everyone who ever came home walked through this gate. It has been open since the fire.'),
  'ember_beacon': ('The Ember Beacon', 'Lit every evening for four hundred years. Nobody remembers what answered it.'),
  'elder_bones': ("The Elder's Rest", 'A very old dragon fell asleep here long ago. The moss covered her gently.'),
  'tethered_isle': ('The Tied Island', 'A little island the Keepers caught with chains before it floated away. One tree came with it.'),
  'frost': ('Frost', 'From the ice of Borealis, with the northern lights shining through its wings.'),
  'storm': ('Storm', 'It does not hide from thunder. It flies up and roars back.'),
  'moonwhisker': ('Moonwhisker', 'Ribbons and starlight, and far too shy to land near you.'),
  'ashglass': ('Ashglass', 'It spent a night in the volcano. Its scales turned to black glass, and the fire never went out.'),
  'porcelain': ('Porcelain', 'Shiny like a painted vase, with gold where it once cracked.'),
}
def do_store():
  d = load('src/data/store.json')
  for sec in d['sections']:
    sec['title'], sec['blurb'] = STORE_SECTIONS[sec['id']]
    for it in sec['items']: it['name'], it['blurb'] = STORE_ITEMS[it['id']]
  save('src/data/store.json', d)

# ---------------------------------------------------------------- code strings
REVEAL = {
  'ember_dragon:3': ('Red Dragon', 'the first fire to come back to Emberkeep'),
  'ember_dragon:4': ('Big Red Dragon', 'all grown up, and very loud about it'),
  'emerald:3': ('Green Dragon', 'hatched green, which the old books say is lucky'),
  'emerald:4': ('Big Green Dragon', 'the moss and the ash both listen to her now'),
  'ashdrake:2': ('Ash Dragon', 'what the fire keeps when everything else has burned'),
  'rimewyrm:2': ('Ice Dragon', 'the cold came back curious, and glad to be held'),
  'golden_egg:2': ('Golden Elder', 'older than the island, and awake because you asked'),
  'frost:2': ('Frost Dragon', 'hatched out of a snowstorm, and in no hurry to warm up'),
  'frost:3': ('Big Frost Dragon', 'all grown up; the air around her stays cool'),
  'storm:2': ('Storm Dragon', 'the quiet one, and the sky has not stopped watching'),
  'storm:3': ('Big Storm Dragon', 'all grown up, and the weather asks HER first'),
}
def sub_file(path, pairs):
  p = R / path; s = p.read_text(); before = s
  for old, new in pairs:
    assert old in s, (path, old)
    s = s.replace(old, new)
  if s != before: p.write_text(s)
def do_code():
  p = R / 'src/core/Constants.ts'; s = p.read_text()
  block = re.search(r"export const DRAGON_REVEAL[\s\S]*?\n\};", s).group(0)
  nb = block
  for key, (name, ep) in REVEAL.items():
    m = re.search(r"'%s':\s*\{\s*art:\s*'[^']+',\s*name:\s*'[^']+',\s*epithet:\s*'[^']+'" % re.escape(key), nb)
    assert m, key
    seg = m.group(0)
    seg2 = re.sub(r"name:\s*'[^']+'", f"name: '{name}'", seg)
    seg2 = re.sub(r"epithet:\s*'[^']+'", f"epithet: '{ep}'", seg2)
    nb = nb.replace(seg, seg2)
  s = s.replace(block, nb); p.write_text(s)
  sub_file('src/ui/LedgerPanel.ts', [("'The brazier roars again!\\nEleanor will have new work for you soon.'", "'The Fire Bowl is burning again!\\nEleanor will have a new order for you soon.'")])
  sub_file('src/ui/NamePanel.ts', [("'Say it out loud. Names don’t take unless something hears them.'", "'Pick a name she will love. She will keep it forever.'")])
  sub_file('src/ui/ShopPanel.ts', [("name: 'Hearth Bundle'", "name: 'Warmth Pack'")])
  sub_file('src/ui/StatusPanel.ts', [("' · hungry, and wants greens'", "' · hungry, wants moss'")])
  sub_file('src/ui/CookbookPanel.ts', [("'Every merge you discover is inscribed here'", "'Every merge you discover is written here'")])
  for f in ['src/scenes/BoardScene.ts', 'src/scenes/UIScene.ts']:
    s = (R / f).read_text()
    s = s.replace("'Back in the satchel'", "'Back in your Bag'").replace("'It turns its head away'", "'No thanks!'").replace("'Nothing to work yet'", "'Nothing to do here yet'")
    (R / f).write_text(s)

if __name__ == '__main__':
  do_chains(); do_quests(); do_orders(); do_tasks(); do_tutorial(); do_dialogue(); do_cauldron(); do_dex(); do_store(); do_code()
  json.dump({f'{c}:{t}': v for (c, t), v in OLD_TIERS.items()}, open('/tmp/old_tiers.json', 'w'), indent=1)
  print('applied')
