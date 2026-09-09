# Worlds and zones

How one world became several grids, and several worlds, without the shipped
Chapter One changing by a pixel.

Read this before touching `src/core/world.ts`, `src/data/zones.json`,
`scripts/build-zones.mjs`, `GameState`'s board handling, or anything that adds
ground to a world.

---

## 1. The address model

A position is still a `(col, row)`. That is the single decision everything else
follows from: the tutorial's scripted cells, the quest ladder, `map.json`'s
regions, every save in the wild and every system's arithmetic keep working
because the pair did not change shape.

What changed is what it **indexes**. It used to be a dense rectangle — one
lattice, `0 ≤ col < cols`, one ambient projection. It is now an index into the
world's **cell registry**, and each zone owns a disjoint rectangular *block* of
that index space, with geometry entirely its own: tile size, world-pixel origin,
rotation.

```
emberkeep index space
 col 0 ────────── 12  13  14 ─── 16  17 ─── 19  …
     ┌─────────────┐  ▓   ┌────────┐  ┌────────┐
     │  main       │  ▓   │ zone A │  │ zone B │   ▓ = gutter, no cells
     │  13 × 12    │  ▓   │  2×2   │  │  2×2   │
     │  (dense)    │  ▓   └────────┘  └────────┘
     └─────────────┘
```

The authored isle keeps block `(0,0)` and the projection it always had. That is
pinned by `tests/unit/Zones.spec.ts` as an equality against the old
`iso.project`, not left to inspection — if it ever fails, every save in the wild
points at the wrong pixel.

### Three rules

1. **Projection is per zone.** `worldPointOf(world, col, row)` routes through the
   zone that owns the address. There is no single correct projection for a zoned
   world; `iso.ts`'s module-level one is the thing that stops working.
2. **Projection is unbounded; membership is not.** `worldPointOf` answers for any
   integer pair, including ones no zone owns — the Golden Altar is authored at
   `(-2,2)` exactly because projecting off the grid was always legal. Only
   `hasCell` decides what can be stood on.
3. **Adjacency never crosses open sky** — which is *not* the same rule as
   "adjacency never leaves a zone", and the difference cost the north two thirds
   of its board. A zone is an EDITOR artefact: the map editor cuts one painted
   island into as many little grids as it likes, and Borealis's three islands
   arrive as 38 of them. Trusting zone identity severed 96 of its 141 cells from
   the neighbour they visibly touch. The law a player can see is geometric — you
   may merge with the tile beside you and not with one across the water — so that
   is the one `buildAdjacency` measures, once, at world build: a neighbour is a
   cell sitting where this cell's own ±u / ±v step lands, whichever grid drew it.

   Three guards keep it honest. **Dense zones are exempt by category**, so the
   authored isle's neighbours stay exactly what its map was drawn with — a
   `beyond` slab sits 80 px from an isle cell, a third of the isle's own 242 px
   step, and a purely geometric rule would have grafted it on. Two grids
   whose tile pitches differ by more than 30% are not one island's lattice
   (`ADJACENCY_PITCH_MATCH`) — roothold has exactly one such seam, 96 px against
   145, where bonding would give a cell a "neighbour" two of its own steps away.
   And a link may not span more than 1.6 of the SMALLER zone's steps
   (`ADJACENCY_REACH`) — the probe tolerance is measured against the probing
   zone's own pitch, so a coarse grid can accept a fine grid's cell that the
   fine grid, probing back, correctly rejects, and the symmetry pass would then
   heal a two-way merge across open sky (emberkeep's arm slab and gate outcrop,
   found by the 2026-08-27 measured re-seat, were exactly that).
   `Zones.spec.ts` pins all three, plus "Borealis is still three islands".

`dense: true` marks the zone synthesised from a `MapData`'s own `cols`/`rows`: it
owns every index in its block, art or no art, which is what the authored map has
always meant by "in bounds". Explicit zones own only the cells they list — which
is why you cannot drop a piece into the gap between platforms.

## 2. Where the zones come from

```
assets/map/nionja-worlds.json      the Map Editor export (frozen)
     ├─ scripts/ingest-worlds.mjs  → src/data/worlds.json   REGISTRY (lossless, editor space)
     └─ scripts/build-zones.mjs    → src/data/zones.json    RUNTIME  (game world px)
```

The split mirrors `ingest-world` / `build-gamemap`: ingest imports without
judgement, build projects into the engine's space and makes the decisions. Run
`node scripts/build-zones.mjs` after touching either.

Three things `build-zones` decides, all of them load-bearing:

**The editor→backdrop transform.** The editor lays grids out in its own pixel
space, not the backdrop's. It also records, per cell, the `gameCell` it believes
that cell maps to — a lossy *address* (41% of cells collapse; see
`tests/unit/Worlds.spec.ts`) but an excellent *measurement*. Fitting one uniform
scale + offset against all 357 recovers the transform, and it reproduces the
editor's own answer for 346/357 cells to under half a cell. The number is derived
by the script, not pasted into it.

**Which cells are already ours.** The editor's `nb2` world is a re-grid of the
*same island* `map.json` covers, cut into 30 small grids. Adopting it wholesale
would throw away the authored 46-tile isle the tutorial, the quest ladder and
every save are written against. So the isle stays exactly as authored — it is
simply the zone named `main` now — and only the 36 editor cells that land **off**
it become new zones. Two lattices over one slab is how a save loses its board.

**When the new ground opens.** The editor's unlock levels are 2 and 3, which
Chapter One actually reaches — tiles would pop mid-campaign. Emberkeep's new
zones are rebased above the Chapter One cap (`LEVEL_XP` ends at 3), and their
regions carry `fog: false`: a cloud is a promise the player can act on, and one
that cannot lift for the entire shipped game is not a tease but a lid over
painted scenery.

`zones.json` stamps `baseSignature` — the `mapSignature` of the `map.json` its
absolute world-pixel origins were measured against. `buildWorlds` refuses to
graft the zones onto a lattice that does not match, falling back to the plain
single-zone world. That is what lets the 8×8 unit fixture construct a
`GameContext` without knowing zones exist, and what stops a re-exported
`map.json` with a stale `zones.json` from putting every new zone a few hundred
pixels off its island.

## 3. Worlds

| id | level | zones | cells | backdrop | role |
|---|---|---|---|---|---|
| `emberkeep` | 1 | 1 dense + 17 | 42 authored + 37 | `emberkeep` (nb2 render) | sanctuary |
| `roothold` | 1 | 21 | 144 | `roothold` | **hub** — Eleanor's home |
| `borealis` | 3 | 29 | 142 | `borealis` | sanctuary |
| `runevault` | 3 | 33 | 187 | `runevault` | **hub** — Selyna's home |

They come in pairs: a **sanctuary**, where you do things, and its **hub**, where
you change something about yourself — buy, decorate, read, talk. Each pair is
joined by a portal each way (below).

The three worlds that are not Emberkeep carry their whole `MapData`, generated
(all cells `invisible`, because the backdrop already paints the slabs — no new
tile art needed) and placed with the same backdrop calibration Emberkeep uses.

**Runevault replaced Hatchery on 2026-08-12, and its ground is drawn, not
measured.** Hatchery was the one world with no grid in the editor's export —
only a painting — so `scripts/fit-deck-grid.py` recovered its flagstone lattice
from the backdrop itself (autocorrelation for the tile steps, the Fourier phase
for where the stones sit, a stone-vs-forest probe and a flood fill for the
extent). The editor has since replaced that map with `runevault` and drawn 33
grids on it by hand, so this hub comes back down the ordinary editor path and
the deck fitter is idle — still the right tool the next time a backdrop arrives
without a grid:

```
python3 scripts/fit-deck-grid.py <name> --overlay /tmp/fit.png
```

Only **4** of Runevault's 187 drawn cells are marked playable in the editor, so
that is all the ground it has. Mark the rest in the Edit tab and re-run
`pnpm worlds:export`.

**Per-world boards.** `GameState` keeps `{ items, grid, nests }` per world; the
board you leave keeps standing, timers and all, so travel is a change of view and
never a reload. Currency, XP, the tutorial, the bag, companions and region status
belong to the Keeper, not to a place, and follow them across.

**The save.** The default world's board stays at the top level of the save,
exactly where it has always been — a save written before travel loads with
nothing to migrate. Other worlds go in `boards`, and only if the player has put
something on them. `activeWorld` records where they stood. No `SAVE_VERSION` bump
was needed, and none should be for this.

**Travel.** `WorldSystem` owns the rules: never mid-tutorial (every scripted step
names a cell on the isle, so a step on another world could never complete), never
above the Keeper's rank, and arriving settles the level-gated regions you have
already earned — written straight to `regionStatus` rather than replayed through
`keeper:leveled`, which also drives the finale.

`world:switch` → `world:switched` → BoardScene fetches the destination's art →
`world:ready`. The board restarts itself between the last two.

### No world may cost another anything

`src/core/worldArt.ts` holds **one list** of what belongs to a single world — its
backdrop and its characters' standee banks — and that list is used in both
directions: fetched on arrival, released on departure. One list, both ways, so
the two cannot drift into a leak. Anything shared (tiles, items, UI, VFX,
portraits) is absent from it by construction and is never touched.

- **Loading.** `releaseAwayWorldArt` runs at the end of *every* BoardScene build,
  not on the travel event, so it self-corrects whatever route got there — travel,
  a scene restart, or Title → Play after a reset. On a session that never leaves
  home it frees nothing, which is pinned by a test because that is the path every
  session takes.
- **The exemption.** The authored world's art is never evicted. It is in the boot
  preload — the baseline every session already pays — and dropping it would only
  buy a re-fetch on the commonest journey there is, coming home. The rule being
  enforced is *visiting a world never leaves the others worse off than before*,
  not *the game holds nothing*. Standing on Borealis you hold two backdrops;
  home again you hold one, exactly as before travel existed.
- **The veil.** Fetching a 0.5–1.4 MB backdrop is seconds on a real connection
  (measured: 7.7 s at 900 kbps), and without feedback the player taps a door and
  the game does nothing. `UIScene` shows a scrim, the destination's name and
  three pulsing embers from `world:switched` to `world:ready`. It lives in UIScene
  because the board is exactly what is being torn down — a veil parented to it
  would be destroyed at the moment it is needed. Three dots rather than a
  progress bar: the loader reports bytes, not the scene rebuild that follows, so
  a bar would fill and then sit at 100% while the board was still being built.

### Portals — the doors out

A portal is an **invisible axis-aligned rectangle in world pixels with a
destination world**. Tapping inside it emits `world:switch`; everything else is
the travel path above.

Invisible is the design, not an omission: every backdrop already **paints** its
gateway — Emberkeep's lit stone arch on the north-east isle, Borealis's glowing
keep door, Roothold's vined archway onto the rope bridge — so the rectangle is
only the hit area over art that is already there. A second marker drawn on top
would be the game failing to trust its own painting.

A rectangle in world px rather than a set of cells, because a gateway is
**scenery** and scenery does not stand on the lattice: Emberkeep's arch is off
every playable cell, hanging over the isle's rim. Cells could also not describe
a door as tall as the art.

| world | door | colour | leads to | opens |
|---|---|---|---|---|
| `emberkeep` | The Ember Gate | forest green | `roothold` | Order 1 delivered |
| `emberkeep` | The North Crossing (by the Golden Altar) | ice blue | `borealis` | the Elder wakes |
| `roothold` | The Vine Arch | flame red/pink | `emberkeep` | always |
| `borealis` | The Ash Road (by the landing shore) | flame red/pink | `emberkeep` | always |
| `borealis` | The Rune Way (the circular inlay, mainland top) | ice blue | `runevault` | 3 Selyna quests |
| `runevault` | The Rune Circle | ice blue | `borealis` | always |

**Every door wears a `PortalFX` coloured by its DESTINATION** (Constants
`PORTAL_TINTS`: flame home, green to Roothold, ice north) — the exception to
"trust the painting", because an opening door is news. The tap area is the FX's
own bounds; a tap asks `ui:travel_requested` → the TravelPrompt's Cross emits
`world:switch`. WorldSystem's story gates (`storyOpen`) decide WHEN each opens —
all three keys are save-derivable stats — and `Zones.spec.ts` pins the exact
six routes, the round trips, and each gate. The North Crossing is
ceremony-lit (`gate:opened`, Eleanor's lines after the finale); the hubs run
first-arrival tours (UIScene `tours`: Roothold's Emporium walkthrough unlocks
the shop button, Runevault's cauldron lesson). The editor's `teleport` record
stays registry data only.

Authored in the World Builder (⭘ Portal, `P`) or in `PORTALS` in
`scripts/build-zones.mjs`, where they are written in **backdrop pixels** — read
straight off the 2610×1632 art — and converted by the same `artToWorld` every
zone origin goes through. Both producers refuse a door that leads nowhere or to
a world this build cannot run, as does the `/__worldbuilder/zones` validator;
`build-zones.mjs` additionally refuses to write a world with no door at all.

## 4. Authoring them

`tools/worldbuilder` 🧩 **Worlds & grids** is the authoring surface, and it
covers the model above with nothing left to hand-edited JSON: worlds (id, name,
level, backdrop), grids (name, tile, skew, rotation, world-px origin, unlock
level, cells) and doors (⭘ Portal / `P` — drag one out, drag inside it to move,
its corner to resize, `Delete` to remove; destination and exact rect on the 🧩
page). ⤒ Apply grids writes `src/data/zones.json` through
`/__worldbuilder/zones`, which validates it the way this file describes; ↺ Reload
pulls worlds back out so imported grids can be edited. Full workflow in
`docs/pipelines.md` § Multi-world authoring; regression in
`tools/checks/wbzonestest.mjs`.

The builder and `scripts/build-zones.mjs` are the two producers of this file —
one authored, one imported — and they agree by construction: both lay index
blocks out reference-grid-first with a one-cell gutter, and both measure the
reference grid through `gameOrigin`.

### Two scales, two owners

A zone's `artScale` sizes what is PART OF THE GROUND — floor tiles, fog caps,
the drag reticle — per zone, so the drawn floor meets the painting under it
exactly (`artScaleAt`). Board pieces do not use it: a piece is a thing the
player carries, and one that visibly changed size crossing a zone seam
mid-drag would read as a glitch. Pieces take `WorldRuntime.itemScale` instead —
ONE number per world, the playable-cell-weighted median of the zones'
`artScale`, derived in `buildWorld` so a re-export moves it automatically
(Emberkeep 1 by construction; Borealis 0.69, Roothold 0.67, Runevault 0.66,
pinned in `tests/unit/WorldItemScale.spec.ts`). BoardItem folds it into every
art scale, shadow width and shadow seat; BoardScene folds it into the dragon
rig scale, the clip overlays and the hatch flourish; the worldbuilder's 🪞 Seat
page draws and drags with the same number. Generator UI (ready star, timer
pill, badges) deliberately stays unscaled — legibility over perspective.

## 5. TOUCH X → CHECK Y

- **Re-export `map.json`** → re-run `scripts/build-zones.mjs`, or the
  `baseSignature` guard silently drops every extra zone.
- **Change anything in the map editor** (a grid, a playable mark, a placed prop,
  a whole map) → `pnpm worlds:export`. It reads the editor's own project from
  `asset3d/editor-map.json` and runs export → ingest → build-zones, so nothing
  waits on somebody having the editor open to press Apply. Then
  `pnpm audit:ground`: a cell drawn over the sky is ground a piece falls into.
- **Regenerate a backdrop** → if a world's ground was MEASURED from it, re-run
  `scripts/fit-deck-grid.py <name> --overlay …`, then `build-zones.mjs`. A
  backdrop at a different size or crop moves every cell.
- **Add a world** → `WORLDS` in `build-zones.mjs`, a `background_<id>` entry in
  `assets.json`, and check `PreloadScene`'s backdrop trim still skips it at boot.
  It also needs a **door out** and a door **in** from somewhere already
  reachable, or it is a room with no handles — `build-zones.mjs` refuses the
  first and `Zones.spec.ts`'s reachability walk catches the second.
- **Move a backdrop's gateway art** → re-measure that world's rect in `PORTALS`
  (`build-zones.mjs`), in backdrop px. `Zones.spec.ts` only catches a door that
  drifts more than 1.5 tiles from any ground.
- **Add ground to Emberkeep** → check the region's `unlock.level` against
  `LEVEL_XP.length`, and `Zones.spec.ts`'s "cannot open during Chapter One".
- **Change `neighborsOf` / `hasCell`** → `MergeSystem`, `BoardSystem` drops and
  the re-grid ring search all read them; `Zones.spec.ts` pins the isle's answers
  against the pre-zone ones.
- **Anything world-scoped in a scene** → read `state.map` / `state.worldId`, never
  `data.map` / `WORLD_ID`. `WORLD_ID` now means only "the build's authored world"
  — correct for the Golden Altar and companions, wrong for everything else.
