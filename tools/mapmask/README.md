# Map mask — island silhouette + playable tile grid

Derives two layers from `assets/sprites/background/emberkeep.jpg` (2610×1632):
the island bodies and the isometric tile grid that sits on their decks.

```
python3 tools/mapmask/trace.py     # island-mask.png, island-trace.png, island-check.jpg
python3 tools/mapmask/grid.py      # grid-trace.png, grid-floor.png, grid-check.jpg
python3 tools/mapmask/combine.py   # map-mask.png
```

`MAPMASK_RETRAIN=1` forces the classifiers to refit; otherwise both scripts reuse
the cached probability maps in `out/` and finish in about a second.
`floors.json` is only a seed — it tells `trace.py` which blobs are the playable
islands. Every traced line comes from the image.

## The lattice

Recovered from the painted tile seams by FFT, not assumed:

| quantity | value |
|---|---|
| seam spacing (perpendicular, both families) | 105.8 / 103.8 px |
| tile diamond | **207 × 120 px** |
| aspect | 0.58 (≈ 30° iso) |

At the backdrop's `scale: 2` that is 414 × 240 game units, against the
420 × 242 recorded in `src/data/map.json` — the height matches, the width is
1.5 % narrower than the authored value.

## The border law

The silhouette is the deck **extruded straight down** by the rock skirt. So the
gap between the tile grid and the island edge is not uniform: it is smallest on
the north rim, where the deck edge *is* the silhouette, and largest on the south
rim, where you are looking at the rock hanging below. Measured on the main
landmass, perpendicular to each edge:

| edge faces | gap | in tile-heights |
|---|---|---|
| NE | 80 px | 0.67 |
| NW | 100 px | 0.83 |
| SW | 126 px | 1.05 |
| SE | 140 px | 1.17 |

Median skirt depth measured vertically is **76 px** (p85 = 131, up to 250 px
under the deepest cliffs); the north overhang is **0 px**.

To reproduce the border from a tile set, without any image: take the union of
the tile diamonds, then union it with the same shape translated down by the
skirt depth, and round the result. That single operation generates the whole
silhouette — thin lip along the top-left and top-right rims, thick rock along
the bottom-left and bottom-right.

The inverse is what `grid.py` uses to bound the grid: `deck = body ∩ (body
shifted up by SKIRT_PX)`. It leaves the north and east rims untouched so tiles
reach the true deck edge there, and pulls in along the south and west rims so no
tile is laid over rock.

Left/right margins are close to symmetric on this backdrop (main landmass:
left p50 130 px, right p50 101 px) because the skirt is drawn on both the SW and
SE faces. The right margin cannot be driven much below one skirt depth wherever
the island edge faces south-east — doing so would hang tiles over the cliff.

## Authoring a new mask (`design.py`)

`trace.py`/`grid.py` read the backdrop. `design.py` runs the other way — tiles
are authored in lattice space and the island bodies fall out of the border law
above:

```
python3 tools/mapmask/design.py   # design-mask.png, design-grid.png,
                                  # design-map-mask.png, design-layout.json
```

Islands are declared as `rects` (n0, n1, m0, m1) and diagonal `band`s
(|n − m| ≤ k), never as cell lists, so the 3-cell minimum on every row and
column is structural rather than checked after the fact — and it is still
re-verified per cell before a line is drawn.

The skirt hangs straight down — rock does — but it hangs *deep* under a
south-west facing rim and *shallower* under a south-east one, so the left side
gains its room as bottom relief while the right side stays hugged. Telling the
two rims apart is the one trick worth remembering: sweeping the deck along its
own SE tile edge `(−tileW, +tileH)` leaves that edge on the same line, so the
swept region covers everything down-left of the SW rim and stops dead at the
SE rim. Intersect the deep curtain with it and the split falls out for free.

Neither curtain hangs to a constant depth. Both are cut by a two-octave profile
along x — broad lobes about 1.5 tiles wide plus a chunkier ripple — floored at
`DEPTH_MIN` so no stretch of rim is ever left flat. That floor matters: the
south-east drop is small by design, and without it the right rim reads as a
clean geometric cut rather than rock.

Measured on the landmass: **95 px of drop under the left rim against 39 under
the right** (median 76, reaching 250 under the deepest lobe), with the sideways
margins small on both (65 / 37).

The lattice here is finer than the backdrop's — 138 × 80 against 207 × 120,
same 1.725 aspect — which is what makes the map bigger: 238 playable tiles
against the 76 traced off the art, in the same frame. Every skirt, lip, noise
and rounding constant is derived from `TILE_H`, so re-scaling the lattice
re-scales the whole look with it.

Sizing is bounded by the canvas, not by taste: with the landmass enlarged there
is room for one small pad beside it and the east ribbon, so the traced
backdrop's four bodies become three.

## Drawing a mask instead of authoring it (`island.py`)

`design.py` declares islands as lattice rects and bands. `island.py` runs from
the other end — you hand it the deck OUTLINE you want and the lattice is fitted
into it. It is what the world builder's 🏝 Island page calls (see
`docs/pipelines.md`), and it works standalone:

```
python3 tools/mapmask/island.py --spec shapes.json -o out/   # island-map-mask.png
python3 tools/mapmask/island.py --stdin < shapes.json        # JSON in, JSON out
```

```json
{ "canvas": [2610, 1632], "tileW": 138, "tileH": 80, "minRun": 3,
  "dropSW": 1.35, "dropSE": 0.65, "seed": 7,
  "shapes": [{ "id": "hub", "points": [[x, y], …], "minRun": 2 }] }
```

The polygon is the DECK, not the silhouette — the skirt is added below it, so
what you draw is what the tiles get laid on. Three steps:

1. **Fit.** Eroding the drawn shape by one tile diamond gives every point where
   a whole tile fits, so scoring a lattice origin is a lookup rather than a
   rasterisation. The origin is grid-searched over its fundamental domain and
   scored lexicographically: **most tiles first, then hug right**. That second
   term is not cosmetic — `dropSE` is small by design, so slack on the
   south-east side shows as a bare strip of rock, while slack on the left
   disappears under the curtain.
2. **Prune.** A drawn coastline throws off 1–2 cell spurs; the same iterative
   sliver shave as `design.py` drops any cell in a run shorter than `minRun`
   (per shape, so a 2×2 satellite pad just sets its own).
3. **Extrude.** `design.py`'s border law, parameterised on the lattice instead
   of reading module globals.

`stats.fill` reports how much of the drawing the whole tiles actually claimed —
the drawn shape guides, the border law governs, and the two are never identical.
The one deliberate divergence from `design.py` is the rim-noise field, generated
at quarter scale and resampled up: nothing in it is finer than that grid anyway
and it was two thirds of the build time.

## Pipeline notes

- `trace.py` — random forest on colour (BGR/HSV/Lab) plus multi-scale texture,
  trained on the hand-labelled boxes at the top of the file. Chains are dropped
  by a 41 px opening (they are thinner than that, so the silhouette only rounds
  by 20 px); touching islands are split by seeding markers from a heavier
  opening and giving every pixel to its nearest marker.
- `grid.py` — adds edge-orientation channels, which is what separates a deck
  from the cliff under it (decks carry the two iso seam directions, faces carry
  vertical brick joints). Cells are seeded where paving is confident, then
  flood-filled across the deck; the flood stops at cells that are majority rock
  face, which is what keeps it off the cliffs while still crossing shadow, lava
  and decor.
