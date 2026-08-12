# The hub world — art direction

The third world. It has to read as somewhere else, not as Emberkeep with the
lava turned off. The first attempt failed exactly there: it inherited the base
map's sunset sky, so it looked like the same world with a grass deck.

## What makes it a different world

A world identity here is four decisions, not one. Change fewer than three and it
reads as a reskin.

| | Emberkeep (map 1) | Borealis (map 2) | **Hub (map 3)** |
|---|---|---|---|
| time of day | sunset | deep night | **high morning** |
| sky event | warm cumulus banks | aurora curtains | **clear high air over a cloud-SEA** |
| hue family | red / orange, 0% cool | indigo / teal / violet | **cyan-green** |
| floating cue | internal red underglow | internal cyan underglow | **bounce light from below** |
| deck material | scorched paving | snow over glacial stone | **limestone under living turf** |

The floating cue is the important one. Both existing worlds light their islands
from *inside* along the underside. This one does not glow — at midday nothing
would. Instead the turquoise cloud-sea below throws a **pale up-light** onto the
undersides and into the roots and lower block courses. Same job, opposite
physics, and it instantly says "daylight" before you read anything else.

## The sky — half the picture, and the thing to get right

Not cumulus towers. The camera is high and the air is thin:

- **Upper two-thirds**: open graded cerulean, deepest at the top, paling toward
  the horizon. Largely empty — this world's sky breathes where the other two
  are crowded.
- **Thin cirrus** streaked high and flat, catching the sun. No lobed
  cauliflower cumulus anywhere above the islands; that shape belongs to map 1.
- **Lower third**: a dense, endless **turquoise cloud-sea** far below the
  islands, lit from above so its tops are bright and its troughs deep. This is
  what the islands float over, and it is the only place with real cloud mass.
- **Sun** high and slightly left, outside the frame, throwing soft shafts down
  through the gaps between islands into the cloud-sea.

## Palette

**Sky** zenith `#1F6E9C` · mid `#5FA8C4` · pale horizon `#BFE0E2` · sun bloom `#F6F0DC`
**Cloud-sea** shadow `#2C6B66` · mid `#4FA79A` · lit `#8FDCC9` · crest `#D6F5EA`
**Limestone** shadow `#6F654E` · mid `#B3A588` · lit `#E0D6BC`
**Turf** deep `#1F3D22` · shadow `#2E5427` · mid `#4F8636` · lit `#86B84F`
**Bounce up-light** `#A8E6D6` — on undersides, roots and the lowest block courses
**Gold trim** `#F7A437` → `#FFD84D` — kept from the other two worlds on purpose;
it is the one thread that says these places belong to the same game.
**Accents**, sparing: `#F2C14E` and `#E8705A` wildflowers only.

Hue mass should land roughly 45% cyan-blue (sky), 30% green (land and cloud-sea
crossover), 20% warm neutral (stone), under 5% saturated warm (gold and
flowers). No red-orange fields, no violet.

## Value law

Unchanged from the other two, because it is what makes a board readable: the
sky is the brightest and highest-contrast region; the islands sit ~20 L\* below
it as quiet solid shapes; the turf deck is the calmest, flattest area on the
canvas. Midday tempts a bright deck — resist it. Turf reads mid-value, and the
whites belong to the cirrus and the cloud-sea crests.

## Landscape

Authored in `tools/mapmask/design.py` as the `hub` layout, and deliberately
**not** a diamond — the first attempt's perfect rhombus was the other half of
why it looked wrong.

- One broad irregular plateau, **249 tiles**, 1932×1080 px of deck.
- Coastline from a wobbled ellipse in screen-lattice space, three harmonics,
  seed 18: a headland at the north-west, a wide bay biting into the
  south-west, a notched inlet on the east rim.
- Slivers are pruned iteratively, so the outline stays ragged while every tile
  row and column is still at least 3 cells long.
- One satellite only: a **2×2 outpost**, four tiles, off the eastern rim with
  open sky between.

Landform character above the deck: the island is a *plateau*, not a mountain.
Flat top, turf over paving, and all the drama in the rock beneath — deep
courses, trailing roots, a ragged underside.

## Depth

Same three-rank rule proven on the other two maps: roughly fifty background
rocks in three tiers separated by **contrast alone**, never by hazing,
lightening or hue-shifting. Each is a miniature of the hub — turf cap,
limestone body, turquoise bounce light underneath. Far ones reduce to a
silhouette plus a bright rim. Dress the field with gold chains and hanging
lanterns, as in both other worlds.

## What it must not be

- Not sunset. No orange sky, no pink cumulus, no ember light. That is map 1.
- Not a perfect diamond or square island.
- Not photoreal. Smooth soft-shaded stylised 3D render, as both other maps.
- Not a mountain, not a forest — a flat plateau with a turf deck.
- No internal glow on the undersides; the up-light comes from the cloud-sea.
