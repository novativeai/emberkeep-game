# The Emberkeep map — art-style analysis

Derived from `assets/sprites/background/emberkeep.jpg` (2610×1632). Every number
below was measured off the image using the surface masks in `tools/mapmask/`
(paved deck / rock face / sky), not eyeballed. The geometry of the island border
is a separate document: `tools/mapmask/README.md`.

## One line

A sunset-lit archipelago of floating masonry islands, rendered as **smooth
stylised 3D, not painted brushwork** — soft bevels, zero surface noise, and a
monochromatic ember palette in which every hue on the canvas is a warm red,
orange or magenta.

## Canvas and projection

| | |
|---|---|
| canvas | 2610 × 1632 (16:10), used at `scale: 2` |
| tile diamond | 207 × 120 px (≈0.58 aspect, 30° iso) |
| land coverage | 47.6 % of canvas — sky is the other half |
| deck / rock / sky split | 33.4 % / 11.9 % / 43.9 % |

Fixed isometric ¾ camera, no perspective convergence. The camera is high enough
that decks read as large flat planes and the rock skirt below them is
foreshortened to roughly two-thirds of a tile height.

## The value law — this is what makes it readable

| surface | L\* p10 | **L\* p50** | L\* p90 |
|---|---|---|---|
| paved deck | 33 | **39** | 45 |
| rock face | 24 | **35** | 50 |
| sky / cloud | 36 | **62** | 77 |

The land sits ~23 L\* steps **below** the sky, and the deck lives in a very
narrow 12-step band. So: the islands read as dark, quiet shapes cut against a
bright, busy sky, and the play surface is the calmest area on the canvas. Nothing
on a deck may compete with that — the deck is a stage, not a subject.

## Palette (measured, k-means per material)

**Deck** shadow → lit: `#6B3C3E` `#824E52` `#D3744C`
**Rock skirt** deep → lit block: `#5D3033` `#834744` `#CC724E`
**Underglow** red → orange: `#94432D` `#BA5A36`
**Molten gold**: `#DF852B` `#FCBA1C` `#F6B564`
**Lava**: `#DA472B` `#ED5F38`
**Crystal**: `#BD3830` `#B64C59` `#E4605F`
**Sky** shadow → highlight: `#743E3E` `#BD5A3E` `#BF7C8B` `#EDA294`

Hue mass of everything above 25 % saturation:

| family | share |
|---|---|
| red 340–360° | 49.4 % |
| red-orange 0–20° | 37.0 % |
| orange-gold 20–40° | 7.3 % |
| magenta 300–340° | 6.1 % |
| **green / teal / blue / violet** | **0.0 %** |

There is no cool colour in this image. What reads as "grey-violet stone" on the
gatehouse is desaturated warm red — genuinely low-saturation pixels are 0.50 %
of the island area, and vegetation is 0.001 % of the canvas. Coolness here is
produced by *dropping saturation*, never by shifting hue.

## Three light sources, and only three

1. **Sky key from the upper-left.** Measured on the silhouette rim: NW-facing
   edges are the brightest (V p50 0.59, p90 0.95), NE next (p90 0.91),
   SE the darkest (p90 0.66). Matches the project's standing
   "light from the upper-left" rule for assets.
2. **Molten gold trim on the block lips.** 1.20 % of the canvas. This is *not* a
   rim light along the whole silhouette — it is liquid gold caught on the lower
   lip of individual masonry blocks, brightest where blocks step down, with a
   near-white core at the hottest points.
3. **Internal red underglow.** 1.24 % of the canvas. Every island is lit from
   *inside* along its underside — the rock beneath the deck glows red-orange,
   hottest at the bottom-most lip, fading into the cloud below. This is what
   sells "floating" more than any other single device.

51 % of all emissive pixels inside an island lie within 60 px of its silhouette
edge. **The glow is an edge treatment.** Deck interiors stay dark and matte.
Total emissive budget across all three families: **under 3 % of the canvas.**

## Material language

**Deck.** Large flat quads with soft rounded bevels and essentially no interior
texture — no grain, no speckle, no visible brushwork. Seams are thin dark
grooves with a slightly lighter chamfer on the upper-left lip of each stone. The
only interior incident is the occasional hairline crack drawn as a single dark
line. Tiles are irregular in size and do not align to the play grid one-to-one.

**Skirt.** Two to three courses of chunky rounded cuboid blocks, staggered like
masonry rather than forming a straight wall, stepping inward as they descend.
Each block gets a flat top plane, a lit face and a dark face. Below the last
course the rock dissolves into red underglow and haze.

**Structures.** Gatehouse-scale architecture is built from the same rounded
chunky blocks at a larger size, in noticeably desaturated stone so it separates
from the ground, ornamented with cast-gold plaques, studs and scrollwork inset
into the masonry. Interiors glow warm red-orange.

**Decor.** Faceted crystal clusters (flat planes, dark thin outline, hot core),
fat gold chains with heavy rounded links and a strong contact shadow, circular
inlaid rune pads, lava basins with a waterfall spilling off the edge. Decor
clusters at island *edges and corners*; the middle of a deck is left empty.

## The sky is not a backdrop — it is half the picture

44 % of the canvas, and the **highest-contrast region on it**: sky value runs
p05 0.40 → p95 0.99, a spread of **0.59**, against 0.27 for the land. The
brightest 1 % of the sky hits pure white. Medians per row are flat (0.79 → 0.74
top to bottom), which hides all of this — the range is what matters.

Five cloud value layers, and their share of the sky:

| | | |
|---|---|---|
| `#753E3E` | 16.8 % | deep plum shadow, the undersides |
| `#BF583A` | 13.4 % | ember-lit cloud — sits under the islands |
| `#B27286` | 20.0 % | dusty mauve mid-shadow |
| `#D88B8F` | 30.2 % | salmon mid — the dominant tone |
| `#F6AF96` | 19.5 % | cream-peach highlight, up to pure white |

Form language: big soft cumulus with rounded cauliflower lobes and no hard edges
anywhere. Detail energy climbs monotonically with scale — 0.038 at σ8 px, 0.065
at σ20, 0.094 at σ45, 0.116 at σ90, 0.131 at σ180. So the clouds are built
almost entirely at large scale, airbrushed soft at small scale. Do not add fine
cloud detail; it will read as noise.

**Islands light the cloud beneath them.** Cloud directly under an island is
darker *and* more saturated than open sky — V 0.64 vs 0.80, saturation 0.47 vs
0.39. The red underglow spills into the cloud below as a warm contact-shadow
pocket. This is the second thing selling "floating", and it is easy to miss.

Clouds also **occlude** distant islands — small rocks are half-buried in cloud
banks, which is how the field gets its depth without any hue shift.

## The distant island field

There are **53 background rock bodies** larger than 400 px besides the four
playable islands — 3.9 % of the canvas. They fall into three clean tiers, and
the tiers are separated by *contrast alone*:

| tier | count | value spread | note |
|---|---|---|---|
| large > 8k px | 6 | **0.28** | same contrast as the playable islands — same plane, not distant |
| mid 2–8k px | 9 | **0.12** | one step back |
| small 0.4–2k px | 38 | **0.09** | the far scatter |

Playable islands measure 0.27 for comparison. Median value (0.53 vs 0.51) and
saturation (0.40 vs 0.41) are *identical* across near and far. Distance is
rendered by **compressing contrast only** — never by lightening, desaturating,
hazing or blue-shifting.

Every one of them is a miniature of the main islands, and keeps the full recipe:
chunky block body, mauve top plane, cool shaded faces, and a hot gold-to-red
glow on the underside — on the smallest ones compressed into a single bright
glowing slot, like a vent. At the far end they reduce to a dark silhouette plus
one glow dot.

The field is dressed, not scattered randomly: gold chains run between the larger
background islands with ornate cast clasps where they anchor, hanging lanterns
with soft glowing bulbs dangle on chains in open sky, and crystal spires and
olive succulents sit on the mid-tier tops. The background is a populated world,
not wallpaper.

## Layout grammar

- Islands are cross / plus / L shaped clusters of tiles, never rectangles. The
  large one is a fat cross; satellites are 2–6 tile pads.
- Islands are separated by clean sky gaps and linked by hanging gold chains that
  never carry a walkable surface.
- The field is layered in four ranks: one dominant landmass, three or four
  playable satellites, ~6 large and ~9 mid background islands on the next planes
  back, then ~38 small rocks scattered in the far sky.
- Composition is centre-weighted with the main island's mass filling roughly the
  middle 60 % of the frame, and the frame edges cropping satellite islands so the
  world reads as continuing past the canvas.

## What this style is NOT

- Not painterly. No visible brushstrokes, no canvas grain, no impasto. Smooth,
  soft-shaded, closer to a stylised 3D render than to hand-painted 2D.
- Not colourful. Any green, blue or violet at real saturation breaks it.
- No cast shadows on the deck surface, and no ambient-occlusion darkening in the
  deck interior — the shading lives on the bevels and the skirt.
- No props, characters or UI on the play surface.
- No fog, bloom haze or vignette over the islands themselves.

## The drifting atmosphere layer

The backdrop is baked, so live clouds can only sit **between the camera and the
isles** — overhead haze, not clouds behind the islands. That is already what the
code does.

### What exists today

`AMBIENCE.wisps` in `src/core/Constants.ts`, driven from `BoardScene`:

| | |
|---|---|
| count | 3 |
| texture | `cloud_tile` — **256 × 174 px** |
| scale | 3.4 – 4.6 → ~870–1180 px on a 2560-wide canvas |
| alpha | 0.045 – 0.075 |
| tint | `0xfff2e2` sunset-warmed white |
| blend | **NORMAL** (not ADD) |
| crossing | 260 000 – 420 000 ms, plus a 40 px sine bob over 9–14 s |
| depth | 48800 — the always-on-top band, above everything |

The mechanism is sound. The gap is the texture: it reuses the fog-blocker puff,
a 256 px sprite blown up 4.6×, so the "high quality atmospheric" part is the
part that does not exist yet.

### Texture spec

- **Author on transparent, alpha-shaped — not on black.** The ADD/black-border
  rule in `docs/vfx-textures.md` applies to `fx_*` emitters. These wisps are
  NORMAL-blended with a tint, so RGB must stay near-white (the tint does the
  colouring) and the density must live in the alpha channel.
- **2048 × 1024**, well under the 4096 px ceiling. Then re-tune
  `wisps.scale` to ~`[0.9, 1.3]` to keep the current on-screen size — leaving it
  at 3.4–4.6 would produce a 9 000 px sprite for no benefit.
- **Alpha must reach 0 on all four borders.** The sprite teleports from one side
  to the other rather than wrapping, so it needs no seamless tiling, but any
  hard edge becomes a visible rectangle sliding across the board. Multiply the
  alpha by an edge falloff over the outer ~15 %.
- **Large-scale form only.** The backdrop's cloud detail energy climbs
  monotonically to σ180 px; fine structure reads as noise and, at alpha 0.05,
  as dirt on the lens. Two or three big lobes per sprite, nothing more.
- **Low alpha is the whole point.** Peak alpha in the texture should land
  around 0.6–0.8 so the runtime 0.045–0.075 multiplier leaves a haze, not a
  cloud. If a wisp is legible as a distinct object, it is wrong.

### Parallax

Three ranks rather than one flat set, with the speed and opacity ladder taken
from the backdrop's own depth tiers (contrast 0.28 / 0.12 / 0.09):

| rank | scale | alpha | crossing | count |
|---|---|---|---|---|
| near haze | 1.2 – 1.5 | 0.06 – 0.09 | 180–240 s | 2 |
| mid | 0.9 – 1.2 | 0.04 – 0.06 | 300–380 s | 3 |
| far veil | 0.6 – 0.8 | 0.025 – 0.04 | 500–650 s | 2 |

Drift is left-to-right only, matching the light coming from the upper left. Keep
the sine bob — it is what stops the motion reading as a texture scroll.

The power governor drops the loop to 15 fps when idle. Tween translation is
time-based, and at a 300 s crossing the per-frame delta is under 1 px even at
15 fps, so the drift degrades cleanly. No wake sources: never drive this from a
timer that keeps the loop hot.

### Generating one

```sh
A=.claude/skills/nano-banana/scripts/artgen.py
python3 $A asset \
  "a single soft atmospheric cloud bank, two or three big rounded cauliflower
   lobes, extremely soft airbrushed edges dissolving to nothing, no hard edge
   anywhere, no fine detail, no wisps or tendrils, warm cream and pale peach
   #FFF2E2 to #F6AF96 with dusty mauve #B27286 in the shadowed undersides,
   lit from the upper left, isolated on a solid pure magenta #FF00FF background,
   nothing touching the edges of the frame, no landscape, no islands, no rocks,
   no sky behind it" \
  --ar 2:1 -o /tmp/wisp-raw.png
python3 .claude/skills/nano-banana/scripts/dekey.py /tmp/wisp-raw.png \
  assets/sprites/environment/atmosphere/wisp-1.png --tol-lo 40 --tol-hi 210
```

Widen the de-key ramp (`--tol-lo 40 --tol-hi 210`) well past the default: a
cloud edge *should* feather over a long distance, and the default 90/190 window
cuts it into a hard-edged blob. Do not pass `--trim` — the transparent margin is
the edge falloff.

Then, before shipping: check the alpha reaches 0 at the borders, flatten the
sprite over the real backdrop at 0.06 alpha, and confirm it reads as air rather
than as an object.

## Generation prompt

For the `map` job (Nano Banana 2, 4K — see `.claude/skills/nano-banana/SKILL.md`):

```sh
python3 .claude/skills/nano-banana/scripts/artgen.py map \
  "fixed isometric three-quarter view of floating masonry islands above a sunset
   cloud sea, 30 degree 2:1 isometric projection, no perspective convergence —
   [LAYOUT: island shapes and their tile counts] — each island is a flat paved
   deck of large smooth stone tiles with soft rounded bevels, thin dark seams and
   no surface texture, sitting on two or three staggered courses of chunky
   rounded masonry blocks that step inward as they descend; molten gold trim
   catches the lower lip of individual blocks; the rock underside glows red-orange
   from within, hottest at the bottom lip, fading into haze; gold chains hang
   between islands and carry no walkable surface — key light from the upper left,
   monochromatic ember palette of warm reds oranges and magentas with absolutely
   no green blue or violet, deck #824E52 rock #5D3033 gold #FCBA1C lava #ED5F38
   sky #EDA294 — the land reads dark against the sky, deck interiors dark quiet
   and empty, all glow concentrated at island edges —
   BACKGROUND: a deep sunset cloud sea of big soft airbrushed cumulus with
   rounded cauliflower lobes and no hard edges, five value layers from deep plum
   shadow #753E3E through dusty mauve #B27286 and salmon #D88B8F to cream-peach
   highlights reaching pure white, the brightest values on the canvas; the cloud
   directly beneath each island is darker and more saturated where the red
   underglow spills into it; dozens of smaller floating rock islands recede into
   the distance at three depth tiers, each a miniature of the main islands with a
   hot gold glowing vent on its underside, the farthest reduced to a silhouette
   and a glow dot, some half-buried in cloud banks; gold chains and hanging
   lanterns dress the background — distance rendered by REDUCING CONTRAST only,
   never by lightening desaturating hazing or blue-shifting, and no fine cloud
   detail — smooth stylised 3D game render look, soft shading, NOT painterly,
   no visible brushstrokes, no props characters or UI on the decks, no cast
   shadows on the deck surface" \
  --ar 16:10 -o assets/sprites/background/<name>.png
```

Fill `[LAYOUT]` from the actual board — the island silhouettes must be generated
to the tile plan, not invented, or the grid will not land on them. Extract the
plan with `tools/mapmask/grid.py` from any candidate render to check the fit.
