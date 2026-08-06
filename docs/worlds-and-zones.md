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

   Two guards keep it honest. **Dense zones are exempt by category**, so the
   authored isle's neighbours stay exactly what its map was drawn with — a
   `beyond` slab sits 80 px from an isle cell, a third of the isle's own 242 px
   step, and a purely geometric rule would have grafted it on. And two grids
   whose tile pitches differ by more than 30% are not one island's lattice
   (`ADJACENCY_PITCH_MATCH`) — roothold has exactly one such seam, 96 px against
   145, where bonding would give a cell a "neighbour" two of its own steps away.
   `Zones.spec.ts` pins both, plus "Borealis is still three islands".

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

| id | level | zones | cells | backdrop |
|---|---|---|---|---|
| `emberkeep` | 1 | 1 dense + 17 | 46 authored + 36 | `emberkeep` (nb2 render) |
| `borealis` | 3 | 38 | 141 | `borealis` |
| `roothold` | 4 | 19 | 141 | `roothold` |

Borealis and Roothold are worlds of their own: their whole `MapData` is generated
(all cells `invisible`, because the backdrop already paints the slabs — no new
tile art needed), placed with the same backdrop calibration Emberkeep uses.

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

**There is no player-facing door yet, on purpose.** The shipped Chapter One ends
on the Elder and hands the board straight back (CLAUDE.md); adding a travel
affordance to that ending is a design decision, not an engine one. The machinery
is complete and reachable from `window.__emberkeep.worlds()` /
`switchWorld(id)`, which go through `WorldSystem` and are refused by the same
rules any in-game door would be.

## 4. Authoring them

`tools/worldbuilder` 🧩 **Worlds & grids** is the authoring surface, and it
covers the model above with nothing left to hand-edited JSON: worlds (id, name,
level, backdrop) and grids (name, tile, skew, rotation, world-px origin, unlock
level, cells). ⤒ Apply grids writes `src/data/zones.json` through
`/__worldbuilder/zones`, which validates it the way this file describes; ↺ Reload
pulls worlds back out so imported grids can be edited. Full workflow in
`docs/pipelines.md` § Multi-world authoring; regression in
`tools/checks/wbzonestest.mjs`.

The builder and `scripts/build-zones.mjs` are the two producers of this file —
one authored, one imported — and they agree by construction: both lay index
blocks out reference-grid-first with a one-cell gutter, and both measure the
reference grid through `gameOrigin`.

## 5. TOUCH X → CHECK Y

- **Re-export `map.json`** → re-run `scripts/build-zones.mjs`, or the
  `baseSignature` guard silently drops every extra zone.
- **Add a world** → `WORLDS` in `build-zones.mjs`, a `background_<id>` entry in
  `assets.json`, and check `PreloadScene`'s backdrop trim still skips it at boot.
- **Add ground to Emberkeep** → check the region's `unlock.level` against
  `LEVEL_XP.length`, and `Zones.spec.ts`'s "cannot open during Chapter One".
- **Change `neighborsOf` / `hasCell`** → `MergeSystem`, `BoardSystem` drops and
  the re-grid ring search all read them; `Zones.spec.ts` pins the isle's answers
  against the pre-zone ones.
- **Anything world-scoped in a scene** → read `state.map` / `state.worldId`, never
  `data.map` / `WORLD_ID`. `WORLD_ID` now means only "the build's authored world"
  — correct for the Golden Altar and companions, wrong for everything else.
