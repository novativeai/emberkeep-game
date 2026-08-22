# Naming — the kid-clarity law (players 8–13)

> **Status: APPLIED** (branch Aina). This is the authoritative old → new map for
> every player-facing name. **Ids never change** — saves, `q:done:` latches,
> `lockedUntil`, chest tables and portals all key on ids; only display strings
> moved. The pass is reproducible: every string lives in one script
> (`scripts/kidpass.py`), and `pnpm test` holds the data to it.

The test for every name and every line: **a 10-year-old reads it once and
knows what the thing is, what to do, and what just happened.**

## 1. The laws

1. **Merge-game family names.** The tiers of a chain share a word so a kid sees
   what merges into what: *Moss Puff → Moss Bunch → Moss Pile*, *Logs →
   Planks → House → Mansion*. Size words are the merge language: Small / Big.
   The top tier may become a treat (*Emberberry → Berry Basket → Emberberry
   Jam*, *Sap Drop → Sap Ball → Sap Cookie*).
2. **A quest title is a verb and a thing you can see.** "Light the Fire Bowl",
   "Make a Sun Gem", "Open Selyna's Castle".
3. **A task row is one action: verb + number + item.** "Make 2 Fire Gems." The
   button says DELIVER, so order rows say *Deliver … to Eleanor*; a Bag gift
   says *Give … from your Bag*.
4. **No word a 10-year-old stumbles on.** Gone: brazier, larder, hearth, hoard,
   orrery, lodestone, billet, spile, dram, cordial, nodule, cairn, wrack, helm,
   kiln, bolt, preserve, radiant, satchel, ledger (in speech — the panel's own
   tab says *Eleanor's Orders*, so she says "my orders").
5. **Dialogue is 90% what to do, 10% story.** One idea per bubble, ≤ 2
   sentences, no metaphors, no irony. Eleanor stays warm and a little shy; the
   Golden Elder keeps her capitals in short sentences; Selyna stays blunt.
   The UI words in a line are the words on screen: Bag, Cookbook, Dragon
   Codex, Orders, Cauldron, Emporium, Warmth ⚡, Gold, Gold Key, Level.
6. **Proper nouns that stay:** Emberkeep · Borealis · Roothold · Runevault ·
   Eleanor · Selyna · the Golden Elder · the Great Flame · Keeper ·
   Moonwater · Emberberry · Aurora.

## 2. Items — every chain, both worlds

| chain id | world | old tiers | new tiers |
| --- | --- | --- | --- |
| `sparkweed` | emberkeep | Spark Weed → Ember Bloom → Flame Lily | **Spark Sprout → Spark Flower → Fire Flower** |
| `strawberry` | emberkeep | Emberberry Sprout → Emberberry Bush → Ripe Emberberry Plant | **Berry Sprout → Berry Bush → Big Berry Bush** |
| `ember_dragon` | emberkeep | Dragon Ruby → Red Egg → Red Dragon → Adult Red Dragon | **Ruby → Red Dragon Egg → Red Dragon → Big Red Dragon** |
| `flame_gem` | emberkeep | Gem Shard → Flame Gem → Radiant Gem | **Gem Chip → Fire Gem → Sun Gem** |
| `lumber` | emberkeep | Cut Wood → Plank Set → House → Manor | **Logs → Planks → House → Mansion** |
| `bigtree` | emberkeep | Ancient Tree | **Old Tree** |
| `firgrain` | emberkeep | Fir Grain → Small Fir Tree → Fir Tree | **Tree Seed → Small Tree → Big Tree** |
| `crystal` | emberkeep | Theme Crystal | **Eleanor's Crystal** |
| `coin` | emberkeep | Gold Coin → Gold Pouch | **Gold Coin → Bag of Gold** |
| `emerald` | emberkeep | Emerald → Green Egg → Green Dragon → Adult Emerald Dragon | **Emerald → Green Dragon Egg → Green Dragon → Big Green Dragon** |
| `frost` | borealis | Frost Egg → Frost Dragon → Adult Frost Dragon | **Frost Dragon Egg → Frost Dragon → Big Frost Dragon** |
| `storm` | emberkeep | Storm Egg → Storm Dragon → Adult Storm Dragon | **Storm Dragon Egg → Storm Dragon → Big Storm Dragon** |
| `golden_egg` | emberkeep | Golden Egg → Golden Elder | **Golden Egg → Golden Elder** |
| `chest` | emberkeep | Treasure Chest | **Treasure Chest** |
| `firepine` | emberkeep | Firepine Seedling → Firepine Sapling → Firepine | **Fire Pine Sprout → Small Fire Pine → Fire Pine** |
| `cinder_vein` | emberkeep | Cracked Stone → Cinder Seam → Cinder Vein | **Cracked Rock → Glowing Rock → Crystal Rock** |
| `dew_basin` | emberkeep | Hollow Stone → Dew Hollow → Dew Basin | **Hollow Stone → Dew Bowl → Dew Fountain** |
| `emberberry` | emberkeep | Emberberry → Emberberry Basket → Emberberry Preserve | **Emberberry → Berry Basket → Emberberry Jam** |
| `resin` | emberkeep | Resin Bead → Resin Lump → Hearth Cake | **Sap Drop → Sap Ball → Sap Cookie** |
| `ashmoss` | emberkeep | Moss Tuft → Moss Bundle → Green Bale | **Moss Puff → Moss Bunch → Moss Pile** |
| `emberbark` | emberkeep | Emberbark Stump | **Mossy Stump** |
| `stormcap` | emberkeep | Storm Cap → Cap Cluster → Charged Cap | **Storm Mushroom → Mushroom Bunch → Lightning Mushroom** |
| `nightbloom` | emberkeep | Night Bud → Night Bloom → Cooling Wreath | **Night Bud → Night Flower → Flower Crown** |
| `quartz` | emberkeep | Quartz Pebble → Cut Crystal → Crystal Ball | **Crystal Chip → Crystal → Crystal Ball** |
| `moonwater` | emberkeep | Dew Drop → Dew Vial → Moonwater | **Dew Drop → Dew Bottle → Moonwater** |
| `nest` | emberkeep | Cold Nest | **Cold Nest** |
| `glasskiln` | borealis | Fire Brick → Kiln Grate → The Glass Kiln | **Fire Brick → Oven Rack → Glass Oven** |
| `seaglass` | borealis | Glass Float → Glass Buoy → The Bottled Ship | **Glass Ball → Glass Float → Ship in a Bottle** |
| `starbench` | borealis | Brass Cog → Gear Ring → The Starwright's Bench | **Gear → Gear Wheel → Star Workbench** |
| `orrery` | borealis | Ground Lens → Spyglass → The Orrery | **Glass Lens → Spyglass → Star Machine** |
| `wreckforge` | borealis | Iron Billet → Forge Bellows → The Wreck Forge | **Iron Bar → Bellows → Shipwreck Forge** |
| `warhelm` | borealis | Iron Cap → Banded Helm → The Horned Helm | **Iron Hat → Iron Helmet → Horned Helmet** |
| `tarkiln` | borealis | Tar Spile → Tar Bucket → The Tar Kiln | **Tar Scoop → Tar Bucket → Tar Oven** |
| `emberheart` | borealis | Pitch Bead → Pitch Loaf → The Ember Heart | **Tar Drop → Tar Loaf → Ember Heart** |
| `auroraloom` | borealis | Silver Spindle → Loom Comb → The Aurora Loom | **Silver Spool → Spinning Wheel → Aurora Loom** |
| `auroraweave` | borealis | Light Thread → Woven Bolt → The Aurora Cloak | **Light Thread → Light Cloth → Aurora Cloak** |
| `runestone` | borealis | Rune Shard → Carved Stone → Runestone | **Rune Chip → Carved Rune → Runestone** |
| `emberdram` | borealis | Dram Vial → Cordial Flask → Cordial Cask | **Fire Juice → Juice Jug → Juice Barrel** |
| `hearthlamp` | borealis | Oil Lamp → Storm Lantern → Hearthlamp | **Oil Lamp → Big Lantern → Warm Lamp** |
| `manastone` | borealis | Mana Pebble → Mana Nodule → Manastone Cairn | **Magic Pebble → Magic Rock → Magic Stone Tower** |
| `wayfinder` | borealis | Lodestone → Boxed Needle → The Wayfinder | **Magnet Rock → Compass Needle → Treasure Compass** |
| `ashdrake` | emberkeep | Ashdrake Egg → Ashdrake | **Ash Dragon Egg → Ash Dragon** |
| `rimewyrm` | borealis | Rimewyrm Egg → Rimewyrm | **Ice Dragon Egg → Ice Dragon** |

## 3. Quests

| id | old title | new title | task rows |
| --- | --- | --- | --- |
| `rekindle_brazier` | Light the Brazier | **Light the Fire Bowl** | Merge 10 times · Collect 6 Gem Chips · Deliver 6 Gem Chips to Eleanor |
| `fill_the_larder` | Fill the Larder | **Make Emberberry Jam** | Make 1 Emberberry Jam |
| `warm_the_hearth` | Warm the Long Hearth | **Warm the Fireplace** | Make 2 Fire Gems · Deliver 2 Fire Gems to Eleanor |
| `raise_the_roofs` | Raise the Roofs | **Build Two Houses** | Build 2 Houses · Make 2 Moss Bunches for the roofs |
| `the_long_gallery` | Light the Long Gallery | **Light the Hallway** | Make 2 Crystals |
| `catch_the_moonwater` | Catch the Moonwater | **Make Moonwater** | Make 1 Moonwater · Deliver 1 Moonwater to Eleanor |
| `radiant_centerpiece` | Craft the Radiant Centerpiece | **Make a Sun Gem** | Make 1 Sun Gem · Deliver 1 Sun Gem to Eleanor |
| `what_she_keeps` | What She Keeps | **A Gift for Eleanor** | Make 2 Berry Baskets · Deliver 2 Berry Baskets to Eleanor · Give Eleanor 1 Emberberry Jam from your Bag |
| `keepers_hoard` | Fill the Keeper's Hoard | **Fill the Treasure Room** | Merge 2 Houses into a Mansion · Make 3 Sun Gems · Deliver 3 Sun Gems to Eleanor |
| `keepers_tasks` | The Keeper's Tasks | **The Keeper's Tasks** |  |
| `the_ashdrake_wakes` | Wake the Ashdrake | **Wake the Ash Dragon** | Merge 3 Ash Dragon Eggs into the Ash Dragon |
| `north_landing` | Make Camp on the Ice | **Make Camp on the Ice** | Merge 3 Glass Balls into a Glass Float · Deliver 2 Glass Floats to Selyna |
| `north_coast` | Open the Wrack Coast | **Open the Shipwreck Coast** | Use 1 Gold Key on the clouds by the coast |
| `north_strakes` | Caps from Glass | **Brew Iron Hats** | Brew 4 Iron Hats in the Cauldron |
| `north_fuel` | Feed the Northern Dragons | **Feed the Northern Dragons** | Get 3 Tar Drops from the Tar Oven · Make 3 Tar Loaves · Deliver 3 Tar Loaves to Selyna |
| `north_threadwork` | Thread from the Frost | **Brew Light Thread** | Brew 4 Light Threads from Spyglasses |
| `north_salvage` | Salvage the Wrecks | **Search the Shipwrecks** | Make 2 Iron Helmets at the Shipwreck Forge · Deliver 2 Iron Helmets to Selyna |
| `north_pitchpot` | Bricks for a Second Kiln | **Bricks for a New Oven** | Brew 3 Fire Bricks |
| `north_door` | Open Selyna's Keep | **Open Selyna's Castle** | Use 2 Gold Keys on the clouds around the castle |
| `north_lamplight` | Light for the Long Dark | **Lamps for the Long Night** | Brew 3 Oil Lamps |
| `what_she_will_take` | What She Will Take | **A Gift for Selyna** | Make 2 Glass Floats · Deliver 2 Glass Floats to Selyna · Give Selyna 3 Glass Lenses from your Bag |
| `north_lodestones` | Something That Points | **Make Magnet Rocks** | Brew 3 Magnet Rocks |
| `north_hulls` | Forge Two Helms | **Make Two Horned Helmets** | Make 2 Horned Helmets |
| `north_skeins` | Spin It Fine | **Weave Light Cloth** | Brew 3 Light Cloths |
| `north_pitchworks` | Stock the Pitchworks | **Make an Ember Heart** | Make 1 Ember Heart |
| `north_runeshards` | Split the Nodule | **Make Rune Chips** | Brew Rune Chips from an Ember Heart |
| `north_longhall` | Raise a Second Forge | **Build a Second Forge** | Merge 3 Iron Helmets into a Horned Helmet · Build a second Shipwreck Forge from 3 Bellows |
| `north_terms` | Weave the Aurora | **Weave the Aurora** | Fill 1 of Selyna's hearts · Build a Star Machine from 9 Glass Lenses · Make 2 Aurora Cloaks · Deliver 2 Aurora Cloaks to Selyna |
| `the_rimewyrm_wakes` | Wake the Rimewyrm | **Wake the Ice Dragon** | Merge 3 Ice Dragon Eggs into the Ice Dragon |
| `elder_seeing_stones` | The Seeing Stones | **Make Two Crystals** | Make 2 Crystals |
| `elder_green_over_ash` | Green Over the Ash | **Make Two Moss Piles** | Make 2 Moss Piles |
| `elder_old_forest` | The Old Forest | **Grow Two Big Trees** | Grow 2 Big Trees |
| `elder_kindle_brood` | Kindle the Brood | **Raise Two Red Dragons** | Raise 2 Red Dragons |
| `elder_gold_in_hand` | Gold in Hand | **Fill Two Bags of Gold** | Make 2 Bags of Gold |
| `elder_grow_keeper` | Grow, Keeper | **Reach Level 4** | Reach Keeper Level 4 |
| `elder_berry_mother` | The Berry Mothers | **Grow Two Big Berry Bushes** | Grow 2 Big Berry Bushes |
| `elder_cold_light` | The Cold Light | **Fill Three Dew Bottles** | Make 3 Dew Bottles |
| `elder_far_sight` | The Far-Sight | **Make a Crystal Ball** | Make 1 Crystal Ball |
| `elder_rise_higher` | Rise Higher Still | **Reach Level 5** | Reach Keeper Level 5 |
| `elder_two_flames` | Two Flames, One Crown | **Raise a Big Red Dragon** | Merge 2 Red Dragons into a Big Red Dragon |
| `elder_true_keeper` | A True Keeper | **A True Keeper** | Reach Keeper Level 6 |

## 4. Orders (titles match their quest — same-name law)

| id | old | new |
| --- | --- | --- |
| `eleanor_brazier` | Light the Brazier | **Light the Fire Bowl** |
| `eleanor_hearth` | Warm the Long Hearth | **Warm the Fireplace** |
| `eleanor_moonwater` | Catch the Moonwater | **Make Moonwater** |
| `eleanor_centerpiece` | Craft the Radiant Centerpiece | **Make a Sun Gem** |
| `eleanor_keeps` | What She Keeps | **A Gift for Eleanor** |
| `eleanor_hoard` | Fill the Keeper's Hoard | **Fill the Treasure Room** |
| `selyna_signal` | Set Two Marks | **Make Camp on the Ice** |
| `selyna_pitch` | Feed the Northern Dragons | **Feed the Northern Dragons** |
| `selyna_frames` | Salvage the Wrecks | **Search the Shipwrecks** |
| `selyna_buoys` | What She Will Take | **A Gift for Selyna** |
| `selyna_spindle` | Weave the Aurora | **Weave the Aurora** |

Repeatable orders: More Gem Chips · More Fire Gems · More Rubies · Another Sun
Gem · More Glass Balls · More Tar Loaves · More Light Thread · Another Ember Heart.

## 5. Everything else that moved

- **tutorial.json** — all 64 beats rewritten (one verb each; `ftuecheck.py`
  clean). **dialogue.json** — every bank rewritten, same shape.
- **dragondex.json** — titles (Ash Dragon, Ice Dragon, Big … for adults),
  stories, personalities, abilities, evolution text.
- **cauldron.json** — every recipe's flavor/use. **store.json** — sections
  (Mansion Looks · Decorations · Dragon Looks), item names and blurbs.
- **tasks.json** — labels. **Constants.ts** — `DRAGON_REVEAL` names/epithets,
  chest gift labels. Code strings in LedgerPanel, CommissionPanel, NamePanel,
  ShopPanel (Warmth Pack), StatusPanel, CookbookPanel, BoardScene/UIScene
  float texts. World Builder's bundled `DEFAULT_CHAINS` snapshot.

## 6. When you add something new

Name it here first, in this grammar; then it is a JSON edit. A new chain gets a
family word and a size word; a new quest gets a verb; a new line gets one idea.
