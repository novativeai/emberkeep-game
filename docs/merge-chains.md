# Merge chains & merge rules — the Emberkeep roster

> **Status: SPEC COMPLETE, NOT WIRED.** Every production, consumption and
> acquisition rule below is specified with numbers. The art is cut, keyed and
> registered in `assets.json`; `chains.json` does **not** reference these chains
> yet, so nothing spawns or merges in the live build. §7 is the file-by-file
> implementation scope.
>
> This is the canonical spec for the new direction (Eleanor & Selyna, Daughters
> of the Moon — dragons are named companions and never merge). Where it
> contradicts [MECHANICS.md](MECHANICS.md) §3, this file wins; MECHANICS still
> describes the shipped Chapter One demo, and live shipped numbers stay in
> [GDD-L1.md](GDD-L1.md).

---

## 1. The merge rules

### 1.1 Carried over from the shipped build
- **3 identical adjacent → 1 next tier**, created at the drop tile. Grouping is
  an orthogonal flood-fill, so only one connected blob merges.
- **5 identical → 2 next tier** (`fiveBonus`). Holding out for the fifth is the
  skill expression.
- **Per-tier override** (`tier.merge = { group, outputs }`) replaces the rule for
  items *of that tier* and disables the 5-bonus for them.

### 1.2 What changes
- **Dragons leave the merge board entirely.** They are named companions with
  personalities and they never merge with each other. `hatchAtTier` and the
  hatch-merge branch no longer apply to them (§4).
- **The board becomes the husbandry layer.** Merging no longer *produces*
  dragons — it produces what dragons and Eleanor consume.
- **The naming law:** *anything on the merge board is anonymous and consumable;
  anything with a name never touches the merge board.* Merge-3 is a fungibility
  engine and named companions are anti-fungible. They must not share a grid, or
  a player will drag a dragon and learn from the bounce that it is furniture.

### 1.3 Two layers, so nothing is unreachable
**Every merge chain is exactly three tiers** — always T1 → T2 → T3, no
one-tier stubs. (The **Nest** and the **Chest** are *fixtures*, not chains: they
never merge, never tier up, and are placed by the map.) Each chain belongs to
exactly one layer:

- **Layer A — Growing chains.** Merge seeds and rubble up into a **permanent
  producer** that sits on the board and drips Layer-B goods. Merging *builds
  the farm*. The tier-3 is the producer.
- **Layer B — Goods chains.** Merge those drops up into consumables, which are
  spent on a recipient and leave the board.

Layer A is built once and kept. Layer B is the loop. A goods chain must never
be its own source — that was the flaw in the first draft of this spec.

**Where Layer A's tier 1 comes from — the bootstrap.** Seeds and rubble are
**authored region contents**, revealed when a region is restored, exactly as
`map.json` already scatters Bushes and the Ancient Tree today. So the full
sequence is:

> restore land → collect seeds → merge into producers → producers drip goods →
> merge goods → spend on a dragon or on Eleanor

Land is the only true source in the game. Nothing else can create matter, which
is why restoration is progression rather than decoration.

### 1.3b Tier 2 is collectable, not only merged
A producer drop is **tier 2 instead of tier 1 about 8% of the time** — the lucky
find. Chest gifts and a Trust-4 dragon's foraging can also yield tier 2
directly. It costs nothing to implement (a weighted roll on `produces`) and it
does three things: it removes the feeling that every single item must be ground
up from scratch, it makes opening a chest genuinely exciting, and it gives the
board an occasional jump-start when a chain has stalled.

Effect on supply: each drop is worth **1.16 tier-1 equivalents**, so real
throughput runs ~16% above the raw drop rate. The tuning targets in §5.2 quote
both.

### 1.4 Feeding accepts every tier
Tier 2 is not dead weight and a half-built stack is never stranded:

| Fed to a dragon | Fills | Mood | Chance to reveal a Book entry |
| --- | --- | --- | --- |
| Tier 1 — a snack | ⅓ meal | — | 10% |
| Tier 2 — a meal | 1 meal | small | 25% |
| Tier 3 — a feast | 1 meal + contentment | large | **60%** |

Tier 3 is therefore an *optimisation*, never a gate. A starving player always
has an out, and cooking properly is rewarded with **discovery** rather than raw
nutrition — which keeps the scarcity in knowledge, not in quantity.

### 1.5 Non-substitutability — and it is absolute
Consumables are **recipient-locked**: a dragon's meal cannot be spent on
Eleanor, and **nothing of hers is ever food**. If every chain terminated in
something generically useful, players would find the single most efficient chain
and run only that. Locking outputs to recipients is what keeps several chains
alive on the board at once.

**Quartz and moonwater are Eleanor's end to end.** No tier of either feeds a
dragon — not the Crystal Ball, not the Moonwater, and not the raw pebble or the
raw drop. A dragon has no use for them at all.

### 1.6 Why there is no contested resource *(revised)*
An earlier draft made quartz and moonwater **contested**, on the grammar *"tier 1
feeds the dragon, tier 3 serves the mage"* — a pebble was grit, a drop was drink.
That is retired. The rule now is the simpler one: **her chains are hers.**

What it costs, stated honestly:

- The **grit axis is gone.** A dragon's diet is two axes, fuel and green, not
  three. "Dull scales" as a condition goes with it.
- **Dew is no longer a trade.** A thirsty dragon drinking a drop that would have
  become Moonwater was the one place the economy carried guilt. Nothing replaces
  it, so the tension now has to come from the story rather than the ledger.
- **Dragon count now raises Eleanor's supply** rather than cancelling out of it.
  A Trust-2 dragon still digs a Quartz Pebble a day, but it is a **gift** — a
  thing it cannot use and you can — so more dragons mean more crystal balls. The
  §5.2 figure that quartz throughput is identical at one dragon and at three no
  longer holds; recompute before tuning.

What it buys: one rule with no exception. A player never has to learn that a
chain changes owner at tier 3, and the Dragon Book never has to explain that
half a chain is edible.

---

## 2. The roster

### Layer A — the farms you grow (3 tiers each, tier 3 is the producer)
| Chain | T1 → T2 → **T3 producer** | Yields | Rate | Cost |
| --- | --- | --- | --- | --- |
| `emberberry_plant` | Sprout → Bush → **Ripe Plant** | Emberberry | 1 / 30 s | free |
| `firepine` | Seedling → Sapling → **Firepine** | Resin Bead | 1 / 90 s | free |
| `cinder_vein` | Cracked Stone → Cinder Seam → **Cinder Vein** | Quartz Pebble | 1 / 8 min | free |
| `dew_basin` | Hollow Stone → Dew Hollow → **Dew Basin** | Dew Drop | 1 / 4 min, **night only** | free |
| `lumber` | Bush → House → **Manor** | Gold Coin / Pouch | 1 / 210 s | free — shipped |

Every producer is *built*, so a farm is something the player made rather than
something the map handed over. Seeds and rubble arrive as authored region
contents (§1.3).

**Ash Moss has a farm now: the Emberbark Stump** (`emberbark`, SHIPPED) — a
single-tier landmark like the Theme Crystal, tapped for one Moss Tuft on a
2-minute cooldown. It stands on the authored isle from the first frame and the
tutorial opens on it (`moss_stump`: the first tree the fire took, dressing
itself in moss again). This retires the earlier "no farm by design /
restoration IS the moss supply" rule — the rekindled-terrace idea can still
arrive later as a second, passive source without contradicting the stump.

### Layer B — goods you spend
| Chain | T1 | T2 | T3 | Recipient |
| --- | --- | --- | --- | --- |
| `emberberry` | Emberberry | Basket | **Preserve** | dragons — fuel, quick |
| `resin` | Resin Bead | Resin Lump | **Hearth Cake** | dragons — fuel, slow |
| `ashmoss` | Moss Tuft | Moss Bundle | **Green Bale** | dragons — cooling |
| `stormcap` | Storm Cap | Cap Cluster | **Charged Cap** | dragons — fuel, charged |
| `nightbloom` | Night Bud | Night Bloom | **Cooling Wreath** | dragons — cooling |
| `quartz` | Quartz Pebble | Cut Crystal | **Crystal Ball** | Eleanor — **all tiers** |
| `moonwater` | Dew Drop | Dew Vial | **Moonwater** | Eleanor — **all tiers** |

**Stormcap and Nightbloom close the taste gap.** Five feedable breeds were
sharing three usable favourites: `tarknot` is Borealis-only, so an Emberkeep
dragon can never reach it, which left `resin`, `emberberry` and `ashmoss` for
five animals and two pairs of breeds with the same taste. A favourite the player
has to discover is only worth discovering if it tells one dragon from another.
Stormcaps fruit where lightning has struck and are FUEL that crackles;
Nightblooms open after dark and are the roster's second GREEN — and that second
green is what retires the old "nobody may refuse ashmoss" law (§5.0). Both have
no farm yet: they are `HIDDEN_CHAINS` until the nest chapter, exactly like
`resin`.

### 2.4 Layer C — Selyna's Borealis roster *(art produced, chains authored, gated)*

The north was §8's open decision. It is now specified and drawn. Cold is free in
Borealis and heat is scarce, so the diet balance **inverts**: the fuel axis is
the wall and the green axis is the environment. Ash Moss has no counterpart
here — a dragon in the north cools itself by standing outside.

| Chain | Layer | T1 → T2 → **T3** | Role |
| --- | --- | --- | --- |
| `driftwood` | A | Drift Spar → Bound Faggot → **Drift Stack** | producer → Tar Knot, 1 / 2 min |
| `tarknot` | B | Tar Knot → Pitch Cake → **Black Ember** | dragons — fuel, the scarce axis |
| `rimebloom` | A | Frost Flower → Rime Cluster → **Rime Bloom** | producer → Frost Thread, 1 / 5 min |
| `frostsilk` | B | Frost Thread → Spun Skein → **Light-Fast Spindle** | **Selyna — all tiers** |

Two farms, two goods, closed: it mirrors Emberkeep's `firepine`→`resin` and
`dew_basin`→`moonwater` exactly, which is the point. A player who learned the
south already knows how the north works, and the only thing that changed is
which axis is expensive.

**Why these, and not four more of anything.**

- **Nothing grows in Borealis.** Every stick of wood there arrived on the
  current, so the north's fuel is *imported*, and `driftwood` says so before a
  line of dialogue does. Heat in the north is something the sea gave back —
  which is the same sentence the whole campaign turns on, said quietly by a
  woodpile.
- **`frostsilk` is Selyna's craft, playable.** Eleanor catches light and holds
  it in **glass** — a crystal ball, a flask. Selyna **preserves**, so she spins
  it into **cloth**, and cloth is what keeps a thing warm rather than what gives
  it back. The two sisters' chains are the same magic in two verbs, and the
  silhouettes say it: a sphere on a stand versus a wound spindle.
- **Selyna had no chain at all.** Every other named character has something the
  board makes for them. She was the one recipient the economy could not serve,
  and an antagonist-who-isn't cannot be negotiated with through a system that
  has no way to reach her.
- **`tarknot` is the inverted axis, made concrete.** In the south a dragon's
  fuel is a berry it eats in a minute. In the north it is a lump of pitch you
  built a woodpile to get. Same animal, same appetite, four times the work.

**Silhouette check** (§2.3), now nine tier-3s across both worlds: jar · pressed
brick · tied bale · sphere on a stand · round flask · **stacked woodpile** ·
**glowing black nodule** · **coral bloom** · **upright spindle**. No collisions.

#### 2.4.1b The two monocultures, and the five farms that fix them

**Colour.** Composited over the Borealis backdrop at their real on-board scale,
**15 of the north's 20 shipped pieces sit in the same narrow band as the ice they
stand on** — bleached driftwood, bleached wreck timber, white rime crystals, a
white ice font, a white ice whelp, all on pale blue-grey snow-capped stone. Only
`tarknot` reads at a glance, and it reads because it is much DARKER, not because
it is wood or not wood.

That is measurable, so it is a rule with a number behind it
(`tests/unit/BorealisRoster.spec.ts`):

> **The ice band** is saturation 0.30–0.51 AND value 0.54–0.78. A northern piece
> must escape it — saturated (≥0.55), dark (≤0.52) or bright (≥0.80).

The shipped pale roster was grandfathered by name rather than skipped, so the
list of offenders stayed visible and could not quietly grow. **It has since been
worked off** — `scripts/gen-borealis-legacy.py` redrew all seven old chains, and
the test now measures every northern tier but `rimewyrm`, whose art comes off the
breed pipeline rather than a chain sheet.

The redraw changed no OBJECT — a drift spar is still a drift spar, the Longhall
is still the Longhall, and `chains.json`, the tier names, the generators and the
supply graph are untouched. What it changed was the palette and the finish, and
it did that by **allocating colour rather than picking it**: twelve northern
chains share one board, so each takes a lane nothing else owns.

| lane | chains |
|---|---|
| the five farms | `runestone` orange · `emberdram` rose · `hearthlamp` gold · `manastone` turquoise · `wayfinder` ivory+rose |
| the redraw | `driftwood` chestnut · `keel` red-ochre · `rimebloom` violet · `frostsilk` cobalt · `wrackline` olive · `frostfont` basalt · `tarknot` black |

Two of those are worth the note. **Driftwood is waterlogged, not sun-dried** —
the sea really does bleach wood silver, which is precisely why the old art
vanished, so this wood is what the sea soaked rather than what the sun cured.
And **`keel` is painted**: tarred black with a red-ochre strake, because worked
ship timber having been worked by somebody is the one thing that separates it
from `driftwood`, which is the same material nobody touched.

Sizes did not move. Every northern `ITEM_SCALE` is hand-tuned against a specific
pixel size (`keel_3` is the House class, not another log), so the cut resamples
each new cell to the SAME maximum dimension as the piece it replaces —
`TARGET_PX` in that script. Constants.ts was not touched.

**Shape.** Colour was only half of it. A heap of wood, a heap of crystals and a
heap of salt are all THE SAME KIND OF THING: raw material in a pile. Nothing in
the north had a shape a player could name. The first draft of these five kept
that habit — kelp, a berry bush, a pool, a resin cascade, a salt column — five
more materials in five more piles.

So the five are **made objects** instead, each with a silhouette you can identify
from across the board and say out loud. The north is the right world for it:
nothing grows here and the sea gives things back, so the things worth having are
the things people BROUGHT and lost — instruments, glass, iron, carved stone.

| Chain | Colour it brings | T1 → T2 → **T3 generator** | Produces | For |
| --- | --- | --- | --- | --- |
| `runestone` | rust orange, hot gold carvings | Rune Shard → Carved Stone → **Runestone** | `tarknot_1` / 150 s | dragons — the north's pitch supply |
| `emberdram` | deep rose in glass | Dram Vial → Cordial Flask → **Cordial Cask** | itself / 180 s | dragons — the north's second FUEL |
| `hearthlamp` | warm brass and gold light | Oil Lamp → Storm Lantern → **Hearthlamp** | **Warmth** / 7 min | the Keeper |
| `manastone` | turquoise / light green | Mana Pebble → Mana Nodule → **Manastone Cairn** | itself / 5 min | **Selyna** |
| `wayfinder` | ivory rim, rose dial, gold | Lodestone → Boxed Needle → **The Wayfinder** | `coin_1` / 4 min | **Selyna** + the north's gold |

**Roles are inherited, not invented.** Each takes over the exact generator,
cooldown, sell and XP of the plant chain it replaced, so `chains.json` is the
only place the swap is visible and the supply graph is unchanged.

**Why each earns its place, not just its hue.**

- **`runestone` is heat that predates the ice.** Before the freeze, people here
  cut heat-runes into stone to keep a fire alive through the dark half of the
  year. The stones still work, and a lit one warms the ground under it until the
  buried tar runs — which is why a carved stone is what feeds the north its
  `tarknot`.
- **`emberdram` is the south, bottled.** Firefruit cordial brought north in
  glass: it keeps forever, it is the one warm thing to drink up here, and a
  dragon will take it. It is the north's second dragon fuel — which matters,
  because the inverted diet axis had exactly one source and a dragon that
  refused `tarknot` was stranded. That is asserted, not remembered.
- **`hearthlamp` is warmth off the wrecks.** In a world with no sun for half the
  year a lamp is not decoration, and this is still the only generator in the
  game that pays **Warmth** rather than an item.
- **`manastone` is Selyna's, and it is her verb.** Eleanor catches light and
  holds it in glass; Selyna reads what the ice KEPT. The ice caught raw magic
  the way it caught everything else and pressed it into the stone.
- **`wayfinder` is the north's money because of what it does.** It does not
  point north — it points at whatever the ice is still holding, which in a world
  built on salvage is worth more than coin. So the instrument is what mints
  `coin` up there, instead of a boat.

**Silhouette check** (§2.3), the five new tier-3s: **upright rounded-top slab ·
round belly in a cradle · hook post with a hanging lamp · tapering stack of flat
plates · thick ring on a block.** No collisions with the eleven already standing
— and `manastone` was re-drawn once because its first pass read as an ovoid
cracking open, which in a game about dragon eggs is a collision that matters
more than any silhouette rule.

**Their seeds are PLACED** (build-zones `BOREALIS_PLAN`), and the five are off
`HIDDEN_CHAINS`. The three self-reseeding farms stand READY-BUILT — the
Runestone and Cordial Cask on the coast's generator rim, Selyna's Cairn in the
keep — because a seeded t3 that streams its own tier-1 strands no Cookbook row.
The two that never reseed (`hearthlamp`, `wayfinder`) arrive in the keep as
parts, 3 × t1 + 2 × t2 each: exactly one build, both rows discovered on the way
(the dew_basin precedent). The keep's loose rimebloom/driftwood stock came off
to make room — both renewable from the Font and Wrack Line standing beside
them.

#### 2.4.2 What the north got when it was actually built

Two farms and two goods is a closed loop but not an economy: nothing produced
the farms' seeds, and there was no Gold in the north at all. Three chains close
it, all `world: "borealis"`.

| Chain | Tiers | Role |
| --- | --- | --- |
| `wrackline` | 1 (fixture) | The north's Ancient Tree — passive 300 s `driftwood_1`, **plus a `bonus` of one `keel_1` every third haul** |
| `frostfont` | 1 (fixture) | Passive 300 s `rimebloom_1` — the only thing in Borealis that *makes* rather than receives |
| `keel` | 4 | Broken Strake → Lashed Frame → **Upturned Hull** (2→1, generates `coin_1`) → **Longhall** (`coin_2`) |

**The Wrack Line is the world's premise stated by a woodpile.** Nothing grows in
Borealis; every stick of wood arrived on the current. One landmark bootstraps two
chains — mostly firewood, occasionally something that used to be a boat — so the
rare drop reads as the sea giving something back rather than as a drip rate.

**`keel` deliberately does not reuse `driftwood`.** That chain is already the fuel
farm, and one chain feeding both the furnace and the housing collapses two
decisions into one. It mirrors `lumber` beat for beat, tier-3 override included,
so the gold loop is learned rather than re-taught: you do not *build* a house in
the north, you turn over what the sea returned and live under it.

**Silhouette check is per BOARD, not global** (§2.3). Emberkeep's House/Manor and
Borealis's Upturned Hull/Longhall never share a board, so both may be buildings;
what must not collide is the nine shapes standing in the same world. Within
Borealis: tidy vertical woodpile · glowing black nodule · coral bloom · upright
spindle · low horizontal tide-line sprawl · narrow tapering ice basin · curved
splintered plank · curved skeletal rib · long low upturned boat · lit hall.

#### 2.4.1 When they appear — and why they cannot appear sooner

Rung **11** of the reveal ladder (story-bible §6): *Borealis opens*. Concretely:

| Beat | What arrives |
| --- | --- |
| Ch 11, first Borealis region restored | authored `driftwood` and `rimebloom` seeds, per §1.3's bootstrap |
| First Drift Stack built | `tarknot` exists — the north's dragons can be fed |
| First Rime Bloom built | `frostsilk` exists |
| Ch 12, Selyna's terms | she asks for **Light-Fast Spindles**, the way Eleanor's Ledger asks for Crystal Balls |

They are in `chains.json` with their rates, and every icon is cut and registered
— and all four now carry **`"world": "borealis"`**, so nothing spawns them in
Emberkeep, no region here can scatter them, and the Cookbook does not list them.
That is deliberate and it is the tutorial-coverage law: a revealed object the
player cannot reach is a defect, and four unreachable chains in the recipe book
is exactly the bug the Cracked Stone already caused once.

**They used to sit in `HIDDEN_CHAINS`, and that was the wrong tool.** That set
means "a later CHAPTER of this world"; these are "a different WORLD". The
distinction is not pedantry — a line in `HIDDEN_CHAINS` would have to be deleted
by hand at exactly the moment the player crosses, and would leak the whole
frozen roster into Chapter One if anyone forgot to put it back. `world` needs no
second edit: `chainHiddenIn(chain, worldId)` turns the north on by itself on
arrival, and off again on the way home. See docs/quest-ladder.md §5.

### 2.1 Why these
A dragon is **a furnace with a heartbeat** — it doesn't hunt, it burns. So it
eats no meat, and its diet has three axes:

| Axis | Chains | Grounding | Reads on the dragon as |
| --- | --- | --- | --- |
| **Fuel** | emberberry, resin, tarknot | sugar and pitch burn hot — these are calories | listless, cold, won't fly |
| **Green** | ashmoss | a furnace that never cools cooks itself | panting, restless, seeks shade |

A dragon's diet is **a ratio, a favourite and a refusal** — never a single liked
item. That is what makes two dragons different to *care for*, and it is what the
Dragon Book fills in, one trial at a time.

Eleanor's craft rests on one sentence — **the moon doesn't burn, it gives back
light it was given** — so she can only **catch** (moonwater), **hold** (the
vessel) and **return** what already existed. Her chains are her verbs.

### 2.2 Cut during design
- **Silver Mirror** — not intuitive as a merge item, and a mirror plus a glass
  vessel read as the same silhouette at icon size.
- **Obsidian → Glass Vessel** — its tier-3 bottle collided with Moonwater's.
- **Charcoal → Ink → Copied Page** — made Eleanor a historian, and turned story
  discovery into a purchasable resource. Discovery is what care and story *pay
  out*, never what merging buys.
- **Wax → Candle → Night Lamp** — mundane, and beneath a mage whose light is
  borrowed and silver.

### 2.3 Silhouette discipline
Every tier 3 has a distinct silhouette so a full board reads at a glance:
**jar · pressed brick · tied bale · sphere on a stand · round flask · capped
stalk · ring.** Two similar silhouettes on one board is a bug. The two newest
were chosen for the shapes nothing else owned: a MUSHROOM, the one growth form
missing from the food roster, and a RING — the Cooling Wreath is the only item
on the board with a hole through the middle.

---

## 3. The clock

Routines and time-of-day preferences need a clock, but not a simulated calendar.
**Four coarse phases, 8 minutes each — a full day is 32 minutes real time.**

`morning · day · dusk · night`

That is enough for "she'll only take it at dusk", it is visible in the sky art
each world already ships, a player sees all four phases in one sitting, and it
costs a fraction of a real day-cycle system. All of it reads `GameClock.now()`
so `advanceTime(ms)` stays deterministic.

---

## 4. Getting a dragon — the Cold Nest

Dragons are not merged, not bought and not dropped. **A dragon is coaxed.**

1. Each region hides one authored **Nest**, revealed when the region is restored.
2. The nest holds an egg that will not hatch on its own. It is *cold*.
3. The nest shows a **Warming Ledger**: **9 goods total**, any dragon-facing
   goods, at any tier (tier 3 counts as 3, tier 2 as 2, tier 1 as 1).
4. **At most 3 points per day.** Stockpiling cannot compress it: the minimum is
   **3 in-game days ≈ 96 minutes of play**, spread across sessions.
5. On the final delivery: the hatch ceremony fires, and you are **prompted to
   name it immediately**.

This makes the first dragon a genuine multi-session goal, gives the whole merge
economy a purpose from the first minute, cannot be rushed with currency, and
reuses systems that already exist (order-style requirements + `GameClock`).
Trust starts at 0 — naming is the beginning of the relationship, not its reward.

### 4.1 Trust — where care pays back
Trust runs **0–5**. It is earned by feeding (max +1/day), by feeding a *known
favourite* (+1 bonus), and by being present at the dragon's preferred phase.
**Trust never decays** — absence never punishes, presence always rewards.

| Trust | What changes |
| --- | --- |
| 1 | It stops backing away. Takes food from the ground while you stand there. |
| 2 | **Digs 1 Quartz Pebble per day** when tapped — a gift for Eleanor, not food it wants. |
| 3 | Takes food **from your hand**. Approaches you unprompted. |
| 4 | **Forages**: drops 1 item of its favourite chain per day — tier 1, or tier 2 on a lucky day (§1.3b). |
| 5 | Follows you between zones. |

Proximity is expressed as *conduct*, never as a bar. The player never reads a
number; they notice she came over.

---

## 5. The numbers

### 5.0 Taste, the hunger gauge, and growing up — SHIPPED

Every dragon sorts the food roster into exactly three boxes, fixed at birth by
its BREED and hidden until the player experiments:

| Box | Size | Hunger gauge | Growth |
| --- | --- | --- | --- |
| **Favourite** | 1 chain | full rate | 1 serving |
| **Accepted** | everything else edible | `ACCEPTED_RATE` (25%) | 0.25 serving |
| **Refused** | 1 chain | nothing — it turns its head, nothing is consumed | nothing |

**Growth counts servings, not calories.** Tier sizes the daily gauge
(`MEAL_VALUE`) and nothing else, so a stack of Hearth Cakes feeds a dragon well
today and does not shortcut raising one. Showing up is the currency.

| Rarity | Breeds | Favourite servings | …or accepted |
| --- | --- | --- | --- |
| **Lesser** | `ember_dragon`, `emerald` | **15** | 60 |
| **Legendary** | `frost`, `storm`, `moonwhisker` | **25** | 100 |

Per-breed taste (`DRAGON_DIET` in Constants.ts):

| Breed | Favourite | Refuses |
| --- | --- | --- |
| `ember_dragon` | resin | tarknot |
| `emerald` | emberberry | tarknot |
| `frost` | ashmoss | resin |
| `storm` | **stormcap** | emberberry |
| `moonwhisker` | **nightbloom** | tarknot |

Five breeds, five different favourites — see §2's note on why the two newest
chains exist.

**Three laws when adding a breed**, all three now enforced by unit test rather
than remembered:

1. **A favourite must be reachable in the world that breed lives in**, or its
   adult silently costs 4× the authored price. This is the WORLD axis only:
   `HIDDEN_CHAINS` withholds the husbandry roster from the CHAPTER, and the
   chapter it waits on is the one that opens the nest — by the time anything is
   being fed, it has lifted.
2. **No two breeds share a favourite.** A taste that does not tell one dragon
   from another is not worth discovering.
3. **A refusal must leave a fuel AND a green.** This replaces "a refusal is
   always a FUEL", which was true only while `ashmoss` was the sole cooling
   chain — refusing it then meant a dragon that could never stop panting, a bad
   condition with no cure. With `nightbloom` on the roster the constraint is
   arithmetic instead of a ban: `dietIsSurvivable` (DragonSystem) checks it.

### 5.1 Demand, per dragon per day (32 min)
| Need | Amount |
| --- | --- |
| Meals | **3** (snack ⅓ · meal 1 · feast 1) |
| Green | **1**, or it overheats |

Eleanor asks for **1 Crystal Ball or 1 Moonwater per order**, roughly one order
every two sessions.

### 5.2 Supply vs demand — the check that matters
Costs: a tier 3 is **9 tier-1** by 3-merges, or **8** using the 5-bonus. Rates
below are quoted **raw / effective**, where effective folds in the 8% tier-2 drop
(§1.3b, ×1.16).

**Food is deliberately abundant.** One Ripe Plant yields 120 / **139**
Emberberries per hour against a one-dragon appetite of ~51/hour. Food must never
be the wall — the wall is knowing *what* to cook.

**Quartz, one active hour** — nothing eats it, so supply IS Eleanor's income:
- Cinder Vein 7.5 + one trusted dragon's daily gift 1.9 = 9.4 / **10.9**
- All of it reaches her → a Crystal Ball every **~48 min**

**Quartz with three dragons:** 13.1 / **15.2**, all of it hers → a Crystal Ball
every **~35 min**. Dragon count now *raises* her throughput instead of
cancelling out — the revised §1.6 says so plainly. **Retune before shipping:**
if crystal balls should stay land-gated rather than dragon-gated, the dig has to
become rarer than daily, or stop being quartz.

**Dew, one active hour:** the basin runs only at night — 1 per 4 min across an
8-min phase in a 32-min day = 2 drops/day = 3.75 / **4.35** per hour. Moonwater
(8 drops) therefore costs about **1 h 50 m of play**. Nothing competes for it
now, so that cost is purely the basin's rate.

Sanity note: these were computed, not estimated. An earlier draft of this file
quoted the dew basin at 1 per 2 min and called it 3.75/hour — that rate is
actually 7.5/hour and made Moonwater a one-hour item. The basin is 1 per 4 min.

---

## 6. Art — produced and registered

Source sheets (3-across, one per chain) are in
[`assets/raw/merge-chains/`](../assets/raw/merge-chains/), shot across Nano
Banana 2, Seedream 5.0 Pro and Seedream 5.0 Lite; winners carry a `-winner`
suffix. **Picks:** Seedream 5.0 Pro for emberberry, ashmoss, quartz and
moonwater; resin split — tiers 1–2 Nano Banana 2, tier 3 Seedream 5.0 Pro.

Cut assets live at `assets/sprites/items/chains/<chain>_<tier>.png` (workspace)
and `.webp` (what `assets.json` references — the deploy step drops any `.png`
with a `.webp` sibling, see `vite.config.ts`). Registered as
`item_<chain>_<tier>`, `source: "file"`, 15 entries.

**Layer C (§2.4) is drawn.** Four 3-across sheets on Seedream 5.0 Pro, sources
in [`assets/raw/merge-chains/borealis/`](../assets/raw/merge-chains/borealis/)
with the exact prompts beside them. Two needed a second pass and the reasons are
worth keeping: `tarknot` came back photoreal (glossy studio product lighting) and
was fixed by naming the failure — *hand-painted, NOT a photograph, no ray-traced
reflections*; `frostsilk`'s tier 1 was a loose filament of thread, invisible at
the 66-unit size a tier 1 renders at, and was re-specified as a wound **bobbin**
so it has mass. **A tier 1 must be a solid compact shape** — that is a rule for
every future chain, not a note about this one.

The key colour is **measured off each sheet, never assumed**: Seedream returns
"pure magenta" as anything from `#FE17C9` to `#FF2BFF`, and de-keying against
`#FF00FF` leaves a coloured halo on every edge. Cells are split on **column
gaps** at a HIGH alpha threshold (~140), because a prop's soft outer glow keys
to a low alpha that bridges the gap to its neighbour and the sheet then reads as
a single cluster.

**Still to draw** — now that every Layer-A chain is a full 3 tiers:
`firepine` ×3, `cinder_vein` ×3, `dew_basin` ×3, plus the Nest fixture.
`emberberry_plant` is covered by the shipped strawberry art, and the shipped
`crystal` / `bigtree` art can serve as the tier-3 of `cinder_vein` / `firepine`
(§7), so the real gap is **6 new tier-1/tier-2 icons + the Nest**.

### 6.1 Keying notes for regeneration
- Prompts asking for an **isometric ground footprint** get a diamond painted *in
  the key colour*. A distance-to-key threshold leaves grey ghosts, and raising
  tolerance eats red berries (similar distance from magenta). Key on **chroma
  family** (`min(r,b) − g` for magenta, `g − max(r,b)` for green) and key only
  blobs **connected to the image border**, so reflections trapped inside
  crystals and glass survive.
- **Clear glass over a magenta key absorbs the key** — Moonwater came back pink
  and needed a full-subject de-spill. A green key (`00FF00`) avoids it, but then
  nothing in the subject may be green.
- **Drop the ground footprint from production prompts.** The engine draws its own
  shadow; the painted one is only useful for judging perspective.

---

## 7. Migration — what actually moves

The first draft of this spec dropped 10 of 11 shipped chains. That was wrong:
most of them are re-roleable, and several are exactly the producer pattern this
design needs. Corrected scope:

| Shipped chain | Fate |
| --- | --- |
| `strawberry` | **Rename → `emberberry_plant`.** Keeps its self-seeding tier-3 generator verbatim — it is already Layer A. |
| `crystal` | **Re-role → `cinder_vein` tier 3.** Already a generator with `skipMaxGold`; gains a T1/T2 below it. |
| `bigtree` | **Re-role → `firepine` tier 3.** Already a passive generator; gains a T1/T2 below it. |
| `lumber`, `coin` | **Keep unchanged.** Gold funds the hub shop and decor. |
| `chest` | **Keep.** Retarget `CHEST_GIFTS` at the new tier-1 goods. |
| `golden_egg` | **Keep** — the Golden Elder is the bridge into the new fiction. |
| `sparkweed` | **Keep hidden** — the unit tests' generic merge chain. |
| `ember_dragon`, `emerald` | **Tiers 1–2 retired from merging** (ruby, egg). Tiers 3–4 become companion entities acquired via the Cold Nest. Art and rigs are unaffected. |
| `flame_gem` | **Replaced.** Its order-goods role passes to `quartz` and `moonwater`. |

Files that must move with it:
- `orders.json` — all 4 orders + 4 repeatables require `flame_gem` (×7). Rewritten as Eleanor's.
- `tutorial.json` — built on hatching `ember_dragon` (×24) and `emerald` (×22), plus `strawberry` (×12), `lumber` (×13), `chest` (×4). A new opening is authored anyway: Eleanor's arrival replaces Laurah wholesale.
- `map.json` — `startingItems` (crystal), region contents (`bigtree`, `emerald`, `lumber` ×3); add Nest, Dew Basin and Cinder Vein placements per region.
- `Constants.ts` — `CHEST_GIFTS`, `COLLECTIBLE_REWARD`, `ITEM_SCALE`, `HIDDEN_CHAINS`, the finale block; add the day-cycle constants.
- `SAVE_VERSION` → **7**, or old saves resurrect retired chains.
- Run [ripple-map.md](ripple-map.md) before starting — it is the adjacency
  reference for exactly this kind of change.

---

## 8. Open decisions

- **Chain ids.** `quartz` ends in a Crystal Ball and `moonwater` begins as plain
  dew — decide whether a chain is named for its raw material or its product
  before ids reach save data.
- **Does Chapter One survive as a prologue?** The Golden Elder finale is a clean
  bridge into Eleanor's arrival, but the brief says Eleanor teleports you in at
  the *start*. Either is workable; the choice decides whether §7 is a migration
  or a second campaign.
- ~~**Selyna's Borealis chains.**~~ **Resolved — see §2.4.** Four chains
  (`driftwood`, `tarknot`, `rimebloom`, `frostsilk`), art produced and
  registered, authored in `chains.json`, scoped by `world: "borealis"` so they
  exist only in the north. `pnpm quests --all` audits that world as its own
  supply graph.
