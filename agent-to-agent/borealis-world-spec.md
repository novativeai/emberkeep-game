# Borealis — world 2

**From:** story / quests / mechanics-coherence QC
**For:** aina (art)
**Status: BUILT, except the art.** Everything below that is mechanism, data,
seeding, gating, orders, quests and the audit is implemented and proven —
`pnpm typecheck && pnpm test && pnpm build && pnpm quests --all` are green and
the north reports every chain RENEWABLE with no blocking finding.

**What is left is §5: six pieces of art.** Until they exist the new items render
as `TextureFactory` placeholders (palette stand-ins, not magenta — the keys start
`item_`), so the world is fully playable now and the art swaps in via
`assets.json` + `anchors.json` with no other change.

Two things changed from the request below, both after doing the arithmetic:

- **The region gates are Gold Keys, not levels.** `borealis_keep` costs 1,
  `borealis_coast` costs 2, and the only source of a key in the north is
  Selyna's Ledger. Extending `LEVEL_XP` past 3 would have cost the XP bar its
  "Chapter One complete" reading for the sake of a gate.
- **`borealis_l1` was NOT widened.** It stays 9 cells and the ladder is written
  against that: one landmark plus four spars leaves four free, the first Bound
  Faggot is one drag away, and "there is no room here" is precisely what sends
  the player to the Ledger for the first key.

And one thing the request did not know about, which was the real blocker:
**merges could not cross the editor's grid cuts.** Borealis is painted as three
islands and the editor delivered it as 38 grids; 96 of its 141 cells were
severed from the neighbour they visibly touch. `world.ts` now measures adjacency
from world pixels for non-dense zones. See docs/worlds-and-zones.md §1 rule 3.

---

## 0. Where Borealis actually stands

`zones.json` gives it 141 cells across 38 zones and 3 regions. The backdrop, the
aurora shader, Selyna's standee and portrait, and **all four of its merge chains
with their art** are done and registered.

What is missing is the thing that makes a board a board:

```
borealis · 0 startingItems, 0 region contents across 3 regions
        → every chain UNREACHABLE: "nothing in the map … supplies it"
```

It is scenery. Nothing arrives on it, so nothing can be merged, so no quest can
ask for anything. The four authored chains are **not** blocked any more — they
carry `world: "borealis"` and turn themselves on when the player crosses — they
are simply unseeded.

### What already exists (do not re-make)

| Chain | T1 → T2 → T3 | Producer | Rate |
| --- | --- | --- | --- |
| `driftwood` | Drift Spar → Bound Faggot → **Drift Stack** | T3 → `tarknot` T1 | 120 s |
| `rimebloom` | Frost Flower → Rime Cluster → **Rime Bloom** | T3 → `frostsilk` T1 | 300 s |
| `tarknot` | Tar Knot → Pitch Cake → **Black Ember** | — (dragon fuel) | |
| `frostsilk` | Frost Thread → Spun Skein → **Light-Fast Spindle** | — (Selyna's good) | |

Two farms, two goods, closed — mirroring Emberkeep's `firepine`→`resin` and
`dew_basin`→`moonwater` (merge-chains.md §2.4). That structure is right and this
spec does not touch it.

### The gap, stated exactly

`driftwood` and `rimebloom` are **Layer A** — you merge seeds up into a producer.
Nothing in Borealis produces those seeds. Emberkeep solves this with the
**Ancient Tree** (`bigtree_1`, a one-tier fixture dripping `lumber_1` every
300 s) and the **Theme Crystal**. Borealis has no equivalent, so its farms cannot
be bootstrapped at all, let alone rebuilt after a player sells one.

And there is **no gold at all** in the north: no `coin` producer, so no idle
income, no timer skips, no Emporium, no store.

---

## 1. Two landmark fixtures

One-tier fixtures, like `bigtree` and `crystal` — they never merge, never tier,
and are placed by the map. Add to `chains.json`, both with `"world": "borealis"`.

### 1.1 `wrackline` — The Wrack Line

The tide-line where the current lays down what the south lost. It is the north's
Ancient Tree, and it says the world's premise before a line of dialogue does:
**nothing grows in Borealis — every stick of wood there arrived on the current.**
Heat in the north is something the sea gave back, which is the sentence the whole
campaign turns on.

```jsonc
{
  "id": "wrackline",
  "name": "The Wrack Line",
  "world": "borealis",
  "tiers": [
    {
      "tier": 1,
      "id": "wrackline_1",
      "name": "The Wrack Line",
      "sell": 0,
      "xp": 0,
      "sellable": false,
      "generator": {
        "produces": { "chain": "driftwood", "tier": 1 },
        "bonus": { "every": 3, "produces": { "chain": "keel", "tier": 1 } },
        "cooldownMs": 300000,
        "energyCost": 0,
        "passiveMs": 300000,
        "tappable": false
      }
    }
  ]
}
```

**The `bonus` is doing real work.** It bootstraps *two* chains from one fixture
— mostly firewood, occasionally something that used to be a boat — so the north
needs one landmark where it would otherwise need two, and the rare drop reads as
the sea giving something back rather than as a drip rate. Same field the Ripe
Emberberry Plant already uses.

### 1.2 `frostfont` — Hoarfrost Font

A frozen spring, and the only thing in Borealis that *makes* rather than
receives. Feeds the Rime Bloom farm.

```jsonc
{
  "id": "frostfont",
  "name": "Hoarfrost Font",
  "world": "borealis",
  "tiers": [
    {
      "tier": 1,
      "id": "frostfont_1",
      "name": "Hoarfrost Font",
      "sell": 0,
      "xp": 0,
      "sellable": false,
      "generator": {
        "produces": { "chain": "rimebloom", "tier": 1 },
        "cooldownMs": 300000,
        "energyCost": 0,
        "passiveMs": 300000,
        "tappable": false
      }
    }
  ]
}
```

**Rate check.** 9 tier-1 builds one tier-3 producer (3→1 twice, or the 5→2 bonus
route — both land on 9). At 300 s that is ~45 minutes per farm, which is exactly
what the Ancient Tree costs for a House in the south. A player who learned
Emberkeep already knows the pace.

The `bonus` at `every: 3` pays a Broken Strake every 15 minutes. With the 6
seeded in §3 that puts the first **Upturned Hull** — the moment gold starts
flowing in the north — about 45 minutes after arrival, in step with the two
farms. `every: 6` was the first draft and made it a 90-minute wait with no
income at all in the meantime; the north is meant to be harsher than the south,
not idle.

---

## 2. One new merge chain — `keel`, the north's gold loop

Borealis has no `coin` source. Emberkeep's is the timber ladder
(`lumber` → House → Manor). The north needs its own, and it must not reuse
`driftwood`: that chain is already the fuel farm, and one chain feeding both the
furnace and the housing would collapse two decisions into one.

**Fiction:** the north's dwellings *are* the wrecks. You do not build a house in
Borealis; you turn over what the sea returned and live under it. Four tiers,
mirroring `lumber` beat for beat — including the 2→1 override at tier 3 — so the
loop is learned, not re-taught.

```jsonc
{
  "id": "keel",
  "name": "Wreck Timber",
  "world": "borealis",
  "tiers": [
    { "tier": 1, "id": "keel_1", "name": "Broken Strake", "sell": 1, "xp": 0 },
    { "tier": 2, "id": "keel_2", "name": "Lashed Frame", "sell": 3, "xp": 4 },
    {
      "tier": 3,
      "id": "keel_3",
      "name": "Upturned Hull",
      "sell": 0,
      "xp": 0,
      "merge": { "group": 2, "outputs": 1 },
      "generator": {
        "produces": { "chain": "coin", "tier": 1 },
        "cooldownMs": 210000,
        "energyCost": 0,
        "passiveMs": 210000,
        "tappable": false
      }
    },
    {
      "tier": 4,
      "id": "keel_4",
      "name": "Longhall",
      "sell": 0,
      "xp": 20,
      "generator": {
        "produces": { "chain": "coin", "tier": 2 },
        "cooldownMs": 210000,
        "energyCost": 0,
        "passiveMs": 210000,
        "tappable": false
      }
    }
  ]
}
```

`coin` carries no `world`, so it is shared vocabulary and needs no change.

---

## 3. Seeding the board

Region contents in `zones.json` → `worlds[borealis].map.regions`. Currently all
three regions are empty.

| Region | Tiles | Seed |
| --- | --- | --- |
| `borealis_l1` (active on arrival) | 9 | **The Wrack Line** ×1 · Drift Spar ×3 |
| `borealis_l2` | 103 | **Hoarfrost Font** ×1 · Frost Flower ×3 · Broken Strake ×6 · Treasure Chest ×1 |
| `borealis_l3` | 29 | Drift Spar ×3 · Frost Flower ×3 |

> ⚠️ **`borealis_l1` has only 9 cells.** A landmark plus three seeds leaves five
> tiles to merge on, and a merge needs three adjacent. That is playable but
> genuinely tight, and a passive producer with nowhere to drop defers its gift.
> Either widen the arrival region to ~14 cells in the map editor, or accept that
> the first quest step must be "clear room" — flag which, because the quest
> ladder is written against the answer.

---

## 4. Four things that break the moment the player crosses

These are integration, not art. Each is small; each is a real defect today.

### 4.1 Region gates are already satisfied
`borealis_l2` gates on Keeper Level 2 and `borealis_l3` on Level 3. A player
arriving in the north is **already Level 3** (that is the Chapter One finale), so
all 141 cells unfog in the same frame and the world is spent on arrival.

Re-gate them. Recommended: extend `LEVEL_XP` past 3 and gate `l2`→4, `l3`→5.
That is a deliberate change — the array ends at 3 today precisely so the XP bar
can read *"Chapter One complete"* rather than fill toward nothing — so it needs a
decision, not a patch. The alternative is key-gating them off Selyna's quests,
which keeps `LEVEL_XP` intact and matches "keys gate story, never power".

### 4.2 `CHEST_GIFTS` is world-blind
It is a single global list paying `emerald` and `ember_dragon` tier 1 — Emberkeep
chains. Neither carries a `world`, so `chainHiddenIn` does **not** stop them:
a chest opened in Borealis would happily drop Dragon Rubies and Emeralds onto the
northern board — pieces with no producer there, no recipient, and no order that
wants them. Dead weight on a 9-tile arrival region, and a silent contradiction of
"each world has its own roster".

Needs a per-world gift table before any chest is seeded in the north. Suggested
Borealis table: 15 Gold · 3 × Drift Spar · 3 × Frost Flower.

### 4.3 Orders have no world
`OrderConfig` carries `giver` but not `world`, so **Eleanor's Ledger follows the
player north** and the endless encore keeps asking for Gem Shards that cannot be
made there. Add `world?: string` to `OrderConfig`, filter `OrderSystem` by
`state.worldId`, and give Selyna her own list. Her ch-12 ask is authored:
**Light-Fast Spindles**, the way Eleanor's Ledger asks for Crystal Balls.

Until she has orders, `keep_the_ledger` (the endless tail) must not be tracked in
Borealis — `QuestConfig.world` already handles that, but her replacement tail
needs to exist or the north's HUD goes blank once her scripted quests are done.

### 4.4 Silhouette discipline is per world, not global
merge-chains.md §2.3 forbids two similar tier-3 silhouettes **on one board**.
Emberkeep's House/Manor and Borealis's Upturned Hull/Longhall never share a
board, so they may both be buildings. The rule to check against is the nine
shapes *within* the world being drawn.

---

## 5. Art needed — 6 pieces

Same pipeline and sizing as the existing chain icons
(`sprites/items/chains/<id>.webp`), registered in `assets.json` + `anchors.json`,
with an `ITEM_SCALE` entry tiered **66 / 88 / 112 units** on the alpha bbox's
longest side — the convention every shipped chain already follows.

| Key | What it is | Silhouette must not collide with |
| --- | --- | --- |
| `decor_wrackline` / `item_wrackline_1` | A tide-line of tangled spars, rope and kelp lying along the shore — **low and horizontal**, wider than a tile. Salt-bleached greys and rope-brown against the blue-white north. | the stacked woodpile (`driftwood_3`) — that one is a tidy vertical pile; this is a sprawl. |
| `item_frostfont_1` | A cracked stone basin with a frozen spring welling over its lip in blue-white ice — **upright, narrow, tapering**. The only warm-lit thing in the north's palette by contrast. | the round flask, the sphere on a stand. |
| `item_keel_1` | **Broken Strake** — a single curved hull plank, splintered at one end, sea-worn. |  |
| `item_keel_2` | **Lashed Frame** — three or four strakes lashed with frostsilk cord into a rib. | `driftwood_2` "Bound Faggot" is a *bundle of sticks*; this is a **curved skeletal rib**. Keep the curve obvious. |
| `item_keel_3` | **Upturned Hull** — a boat turned over as a shelter, a door cut in the side, smoke from a vent. **Long, low, curved.** |  |
| `item_keel_4` | **Longhall** — several hulls joined end to end into a hall, lit windows, a roofline. Reads clearly larger than the Hull. |  |

Palette: the Borealis backdrop is blue-white with aurora greens. Everything here
is **driftwood grey, rope brown, wet black pitch** — the imported warmth — except
the Font, which is the world's own ice.

---

## 6. Acceptance

```
pnpm quests --all
```

must show, for `borealis`:

- no `nothing arrives on this board` warning;
- `driftwood`, `rimebloom`, `keel`, `tarknot`, `frostsilk`, `coin` all
  **RENEWABLE** (the two landmarks make the farms renewable; the farms make the
  goods renewable; `keel_3` makes gold renewable);
- and once quests exist, no `no quest is tracked in this world`.

`pnpm typecheck && pnpm test && pnpm build` green. The audit runs in the unit
suite, so a seeding mistake fails the build rather than being found in play.

---

## 7. What I am NOT asking for, and why

- **No dragon chain.** Dragons in the north are Selyna's, and a dragon is coaxed
  from a Cold Nest, never merged (merge-chains.md §4). Chapter 12 is caring for
  hers, not hatching your own.
- **No green/cooling chain.** Decided already: Ash Moss has no northern
  counterpart — a dragon in the north cools itself by standing outside. `tarknot`
  being the *only* axis is the inversion the world exists to express.
- **No new tutorial.** The north is entered by a taught player. But the inverted
  diet is a new rule on screen, so it needs a teach-point in Selyna's first quest
  or the tutorial-coverage law is broken (docs/tutorial-coverage.md).
- **Do not wire `worlds.json` → `teleport`.** It is a map-editor placeholder:
  `trigger: "hatch", chain: "flame_gem"` can never fire (`flame_gem` has no
  `hatchAtTier`), and if it did it would drop the player in Borealis during
  Chapter One — rung 11 of the reveal ladder, spoiling chapters 9–12. A world is
  opened by a quest step (`{ "kind": "world", "worldId": "borealis" }`), which
  exists and is unused.
