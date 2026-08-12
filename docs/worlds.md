# The editor's worlds — nb2, roothold, borealis

> **The engine's side of this now lives in [`worlds-and-zones.md`](worlds-and-zones.md).**
> Read that one for how a world is addressed and drawn. This page is only about
> the *authoring* side: what the Map Editor project actually contains.

Measured from `asset3d/editor-map.json` (the authored project, loaded from disk in
dev). The runtime copy of the same design is `assets/map/nionja-worlds.json`, which
the editor's **Apply** writes and the pipeline turns into `src/data/zones.json`.

## What exists

| world | id | grids | drawn cells | direct allocations | assets |
|---|---|---|---|---|---|
| **nb2-4k-aligned** (primary) | `m1785757781924` | 31 | 79 | 4 | 1 — `eleanor.glb` |
| **borealis** | `m1785757796496` | 38 | 138 | 4 | 0 |
| **roothold** | `m1785787517285` | 21 | 144 | 5 | 0 |

## The per-grid cell loss is HISTORY — do not design around it

This file used to carry a loss table: a grid hand-drawn at its own pitch was folded
through the game's ONE lattice, several drawn cells collapsed onto the same game
cell, and every one but the last was silently unusable — barely half of roothold's
and borealis' cells survived.

That is over. A world is now a registry of independently placed **zones**, each
owning its tile size, origin and rotation, so a drawn cell is a real cell. The
editor no longer re-points a global lattice, and nothing folds.

`scripts/audit-grids.mjs` still measures the old fold. Keep it for reading historical
exports; a fresh Apply has nothing for it to find.
