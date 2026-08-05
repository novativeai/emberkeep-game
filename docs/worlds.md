# The worlds — nb2, roothold, borealis

Everything here is measured from `asset3d/editor-map.json` (the authored project,
loaded from disk in dev) and `scripts/audit-grids.mjs`. Re-run the audit after any
editor session: `node scripts/audit-grids.mjs`.

## What exists

| world | id | grids | drawn cells | direct allocations | assets |
|---|---|---|---|---|---|
| **nb2-4k-aligned** (primary) | `m1785757781924` | 31 | 79 | 4 | 1 — `eleanor.glb` |
| **borealis** | `m1785757796496` | 38 | 138 | 4 | 0 |
| **roothold** | `m1785787517285` | 21 | 144 | 5 | 0 |

All three are 1024×640 PNG backdrops. `baseHidden: true` — the authored default map
is hidden, nb2 is the primary world (`primaryWorldId`). `zones` is empty on all three
(the hand-drawn polygons exist in the editor but nothing is authored yet).

A fourth world, **hatchery** (`m1785787615305`, "Level 5"), appears in the EXPORT
(`asset3d/emberkeep-map.json`) with zero grids, zero allocations, zero assets. It is
an empty shell — no map image in `editor-map.json`, nothing to enter.

## Are they linked?

Three different questions hide behind that one, and the answers differ.

**By code — yes, one-way, and only from nb2.** `WORLD_TELEPORTS` (Constants.ts):

```
nb2 --(tutorial finished)------> roothold      WORLD_TELEPORT
nb2 --(Golden Egg bursts)------> borealis      WORLD_TELEPORT_BOREALIS
roothold / borealis --(return)-> nb2           world:return
```

There is **no** roothold ↔ borealis link. Neither can reach the other; you always
come home through nb2 first.

**By state — no, not any more.** Each world owns its board in `GameState`: its own
items, its own occupancy, its own id counter, saved under its own key. Nothing on one
board can be read or moved from another. Its playable cells are per-world too —
`applyBaseToGame` wipes every tile override on each switch and lays down only the live
world's allocations.

**By coordinates — yes, and this is the one that bites.** The game runs ONE isometric
lattice, 256 × 147.50 px, derived once from the authored `src/data/map.json`. Every
world's hand-drawn grid is projected through it. 68 board cells are claimed by more
than one map: the three worlds are drawn on top of each other in the same coordinate
space. That no longer leaks state — but it is why the same `(col,row)` means a
different place depending on where you are standing.

## The lattice per world

A drawn grid is lossless only if its cell pitch IS the pitch of the lattice its world
runs on. Two drawn cells that fall on one game cell collapse: the second is silently
unreachable — it looks allocated in the editor and can never hold a piece.

The primary world was drawn at the game's own pitch, the two sub-worlds at roughly
two-thirds of it. Under ONE shared lattice, half of each sub-world was dead:

| world | median drawn cell | lattice it runs on | usable | lost |
|---|---|---|---|---|
| nb2 | 252 × 146 | **authored** 256 × 147.50 | 78 / 79 | **1 (1%)** — a rotated grid |
| borealis | 172 × 92 | **its own** 172 × 92.39 | 140 / 140 | **0** (was 9, before the phase fit) |
| roothold | 167 × 97 | **its own** 167 × 96.65 | 144 / 144 | **0** |

Before the per-world lattice: borealis kept 68 of 140 (51% lost) and roothold 68 of
144 (53% lost) — 143 cells recovered by the change. roothold's long terrace
(`Grille 13`, 11×2) held 16 of its 22 cells; `Grille 12` held 6 of 18. Both are whole
now.

The rule (`mapEditor`): the primary world keeps the authored lattice — it must, and
not for a cell count: `map.json`'s regions, the tutorial's spawn cells and the
camera's focal cells are all expressed in it, so re-pitching it would move the
authored game out from under them. Its grids were drawn at that pitch anyway (78 of
its 79 cells survive it).
`switchToWorld` adopts the target world's own lattice via `latticeFor`;
`returnToPrimary` hands the authored one back. `BoardScene.onReturnWorld` restores it
too, because both are plain `world:return` subscribers and neither is promised to run
first.

What still costs cells, and why it cannot be fixed by a pitch:

- **Rotation.** borealis `Grille 16` (1°) and `Grille 17` (358°) — the lattice has no
  rotation, so a rotated grid can never align cell-for-cell. `latticeFor` also
  REFUSES a world whose grids are all rotated or ortho, leaving it on the authored
  lattice — a world it cannot represent is better left alone than half-fitted. nb2
  `Grille 1`, at 2°, is the one lost cell left in the whole project.
- **Phase.** FITTED, since 2026-08-05. The origin used to be copied from the busiest
  grid: that grid was pixel-exact and every other one drifted away from it — up to
  70px, most of a cell, in a world drawn freehand at slightly varying pitches. Drift
  is not cosmetic: two drawn cells that round to the same game cell means one of them
  can never hold a piece, and the drawn grid visibly stops lining up with the pieces
  standing on it. `latticeFor` now shifts the origin by the mean residual until it
  settles (a few passes), which took borealis from 131/140 cells and 38px of average
  drift to **140/140 and 19px**, left roothold lossless at 11px, and leaves a world
  drawn on ONE grid pixel-exact — its residuals are zero, so the fit does nothing.

Two things deliberately do NOT move with the lattice: the backdrop's world rect and
the camera frontier (`BoardScene.backgroundWorldRect`, measured once and cached under
the authored lattice). The grids' coordinates are absolute — they were traced over
that art — so the art has to stay put while only the cell lattice moves.

Re-run `node scripts/audit-grids.mjs` after any editor session: it replicates both
projections and reports what each world actually gets, plus what the other lattice
would have given, so the rule can be checked rather than trusted.

## Reading the editor file yourself

```
asset3d/editor-map.json
├─ maps[]            one entry per world: id, name, w/h, dataUrl (the backdrop PNG)
├─ grids{mapId:[]}   hand-drawn grids: tileW/tileH (pitch), cols/rows, ox/oy (cell 0,0
│                    centre in world px), rot, alloc{"i,j": unlockLevel}
├─ allocations{}     cells allocated straight in GAME (col,row) space: {"6,2": 1}
├─ assets{mapId:[]}  placed decor/3D; `onGrid` pins one to a grid cell
├─ zones{}           hand-drawn polygons (empty today)
└─ baseHidden        the authored default map is hidden (nb2 is primary)
```

`unlockLevel`: `0` = blocked, `N` = playable once the Keeper reaches level N.
