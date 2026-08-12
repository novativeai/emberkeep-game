#!/usr/bin/env python3
"""
AUDIT GROUND — is every playable cell of every world standing on painted rock?

    src/data/map.json    (the authored isle)
    src/data/zones.json  (every world's zones)        →  a verdict per world
    assets/sprites/background/<backdrop>.webp

WHY THIS EXISTS
---------------
No world here paints its own floor. Every playable cell is `invisible` and the
BACKDROP's flagstones are what the player sees underfoot. A playable cell is
therefore a CLAIM about the painting — "there is stone here" — and the painting
is the only thing that can check it.

When the claim is false the failure is not cosmetic. The board accepts the drop,
the art shows open sky, and the piece is standing on a cloud. Four such cells
shipped on the isle (EMB-144: a 2×2 block hanging under the southern edge, in
region `level_1`, droppable from the first frame) and nothing in the build had
anything to say about them, because nothing in the build had ever looked at the
art. This is that missing look.

HOW IT DECIDES
--------------
Not with fixed colour thresholds. Emberkeep's ground is plum rock under a pink
sky, Borealis's is blue ice under an aurora, Roothold's is moss on flagstone,
Hatchery's is deck under forest — a number tuned on one is meaningless on the
next, and a number tuned on all four is tuned on nothing.

Instead each world is measured AGAINST ITS OWN GROUND. Nearly every cell of a
world does stand on rock, so the population of cells IS the model of what that
world's rock looks like; a cell that is a wild outlier from its own world's
median is a cell that is not standing on the same stuff as its neighbours. Two
readings per cell, both robust to the outliers they are looking for (median +
MAD, not mean + sigma, or four bad cells would widen the very yardstick used to
catch them):

    LUMA   sky and cloud are brighter than any ground in these paintings.
    R − G  the warm/cool axis. The clearest single signal on Emberkeep: rock
           sits at +60, the pink cloud bank at +85 to +140.

The cell is probed over its OWN tile footprint, taken from the zone that owns
it, so a world the editor cut into slabs of different pitches is read at each
slab's scale rather than the isle's.

WHAT IT FLAGS THAT IS FINE
--------------------------
Light, not material. A flagstone under a brazier or in the shade of an arch is
not the colour of the flagstones around it, and this tool reads colour. Those
cells are listed in ACCEPTED below with what is actually painted there — and a
cell only earns a line in that list after somebody has opened the overlay and
looked at it. `--overlay` exists so that look takes one glance: it draws every
cell back onto the art, offenders in red.

    python3 scripts/audit-ground.py                     # verdict per world
    python3 scripts/audit-ground.py --overlay /tmp      # write the proof images
    python3 scripts/audit-ground.py --world borealis
    python3 scripts/audit-ground.py --strict            # ignore ACCEPTED

Exit code 1 if anything unaccepted is flagged, so this can gate a build.
"""
import argparse
import json
import math
import os
import statistics
import sys

from PIL import Image, ImageDraw, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

#: How far from its own world's median a cell may sit before it is not standing
#: on the same material as everything else. Modified z-score, so 6 means "six
#: robust deviations". Emberkeep's four sky cells scored 8–13; the warm-light
#: false positives above score 7–9, which is why this reports rather than
#: deletes. Nothing legitimate has been seen below 6.
MAX_Z = 6.0

TILE_W = 256
BOARD_ORIGIN_X = 1280
BOARD_ORIGIN_Y = 316

#: The backdrop key in zones.json → the art file, where they differ. `emberkeep`
#: was re-painted as the nb2 alignment pass and assets.json points at the new
#: file; the world record still carries the old name.
ART_FILE = {"emberkeep": "emberkeep-nb2"}

#: Cells whose colour is an outlier because of the LIGHT on them, not because
#: there is nothing there. Each was checked against the overlay before being
#: written here; the note says what is painted on that tile. Anything not on
#: this list is a genuine question. Re-check whenever a backdrop is repainted —
#: `--strict` prints them all again.
#:
#: KEYED BY THE PIXEL, not by (col,row). A cell index is a position in the world's
#: index space, and that space is re-allocated block by block on every export: the
#: 2026-08-12 re-export renumbered roothold's brazier from (30,0) to (34,0) without
#: anything moving on the art. The point on the backdrop is what actually stands
#: still, so the list is matched by proximity to it.
ACCEPT_RADIUS = 60  # backdrop px — under half a tile, so two cells never share a note
ACCEPTED = [
    ("borealis", 1994, 424, "lamplight spill on the ice, in front of the magic door"),
    ("borealis", 2063, 461, "lamplight spill on the ice, left of the door"),
    ("borealis", 2125, 501, "lamplight spill on the ice, right of the door"),
    ("roothold", 829, 621, "the brazier flame stands on this flagstone"),
    ("roothold", 1704, 385, "flagstone in the deep shade under the vine arch"),
]


def accepted_note(world_id, x, y):
    for wid, ax, ay, note in ACCEPTED:
        if wid == world_id and math.hypot(x - ax, y - ay) <= ACCEPT_RADIUS:
            return note
    return None


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


def backdrop_path(name):
    for ext in ("webp", "jpg", "png"):
        p = os.path.join(ROOT, "assets/sprites/background", f"{ART_FILE.get(name, name)}.{ext}")
        if os.path.exists(p):
            return p
    return None


def rotate(p, c, deg):
    """Mirrors world.ts `rotate` — a zone's turn is applied about its pivot."""
    if not deg:
        return p
    r = math.radians(deg)
    co, si = math.cos(r), math.sin(r)
    dx, dy = p[0] - c[0], p[1] - c[1]
    return (c[0] + dx * co - dy * si, c[1] + dx * si + dy * co)


class Placement:
    """World px ↔ backdrop px, and the authored lattice in backdrop px.

    build-zones copies the authored map's own background placement onto every
    world it writes, so one transform serves all of them — the property that
    lets the hand-drawn isle and a measured deck share one coordinate system.
    """

    def __init__(self, authored, size):
        tile = authored.get("tile") or {}
        ratio = TILE_W / tile.get("width", TILE_W)
        half_w = TILE_W / 2
        half_h = (TILE_W * (tile.get("height", TILE_W / 2) / tile.get("width", TILE_W))) / 2
        bg = authored["backgrounds"][0]
        cal = authored["backgroundCalibration"][bg["name"]]
        w, h = size
        self.ox = (
            BOARD_ORIGIN_X
            + bg["col"] * half_w
            - bg["row"] * half_w
            + (cal.get("offsetX", 0) + bg.get("dx", 0)) * ratio
        )
        self.oy = (
            BOARD_ORIGIN_Y
            + (bg["col"] + bg["row"]) * half_h
            + (cal.get("offsetY", 0) + bg.get("dy", 0)) * ratio
        )
        self.unit = cal.get("scale", 1) * ratio
        self.w, self.h = w, h
        self.au = (half_w / self.unit, half_h / self.unit)
        self.a0 = (
            (BOARD_ORIGIN_X - self.ox) / self.unit + w / 2,
            (BOARD_ORIGIN_Y - self.oy) / self.unit + h / 2,
        )

    def of_world(self, x, y):
        return ((x - self.ox) / self.unit + self.w / 2, (y - self.oy) / self.unit + self.h / 2)

    def of_authored_cell(self, col, row):
        return (
            self.a0[0] + (col - row) * self.au[0],
            self.a0[1] + (col + row) * self.au[1],
        )


def cells_of(world, authored, place):
    """(col, row, backdrop x, y, half width, half height, zone name) for every playable cell.

    A world's zones answer for their own cells at their own pitch. Emberkeep also
    inherits the authored isle, whose cells belong to no zone — they are the
    dense 13×12 lattice the game has always projected with the ambient iso.
    """
    out, seen = [], set()
    for z in world.get("zones", []):
        ox, oy = z["origin"]
        u, v, pivot, rot = z["u"], z["v"], z["pivot"], z.get("rotation", 0)
        hw = abs(u[0] - v[0]) / 2 / place.unit
        hh = abs(u[1] + v[1]) / 2 / place.unit
        for i, j in z["cells"]:
            p = rotate((ox + i * u[0] + j * v[0], oy + i * u[1] + j * v[1]), pivot, rot)
            col, row = z["block"][0] + i, z["block"][1] + j
            seen.add((col, row))
            out.append((col, row, *place.of_world(*p), hw, hh, z["name"]))
    if world.get("extendsAuthoredMap"):
        for col, row in authored["playable"]:
            if (col, row) in seen:
                continue
            x, y = place.of_authored_cell(col, row)
            out.append((col, row, x, y, place.au[0], place.au[1], "the authored isle"))
    return out


def sample(im, cx, cy, hw, hh):
    """Mean luma and warm/cool over the middle of the cell's own footprint."""
    x0, x1 = max(0, int(cx - hw * 0.5)), min(im.size[0], int(cx + hw * 0.5))
    y0, y1 = max(0, int(cy - hh * 0.5)), min(im.size[1], int(cy + hh * 0.5))
    if x1 <= x0 or y1 <= y0:
        return None  # off the canvas entirely — no art to stand on at all
    r, g, b = ImageStat.Stat(im.crop((x0, y0, x1, y1))).mean[:3]
    return ((r + g + b) / 3, r - g)


def zscores(values):
    med = statistics.median(values)
    mad = statistics.median([abs(v - med) for v in values]) or 1e-6
    return med, [(v - med) / (1.4826 * mad) for v in values]


def audit(world, authored, overlay_dir, strict):
    path = backdrop_path(world["backdrop"])
    if not path:
        print(f"{world['id']:<10} no backdrop art — skipped")
        return 0
    im = Image.open(path).convert("RGB")
    place = Placement(authored, im.size)
    cells = cells_of(world, authored, place)

    read_ = [sample(im, c[2], c[3], c[4], c[5]) for c in cells]
    offscreen = [c for c, s in zip(cells, read_) if s is None]
    on = [(c, s) for c, s in zip(cells, read_) if s is not None]
    _, zl = zscores([s[0] for _, s in on])
    _, zd = zscores([s[1] for _, s in on])

    flagged = []
    for (c, s), a, b in zip(on, zl, zd):
        # One-sided on luma (only BRIGHTER than its world is suspect — sky and
        # cloud are the bright thing), two-sided on warm/cool.
        if a > MAX_Z or abs(b) > MAX_Z:
            why = []
            if a > MAX_Z:
                why.append(f"{a:.0f}× brighter than this world's ground")
            if abs(b) > MAX_Z:
                why.append(f"{b:+.0f}× off its warm/cool")
            flagged.append((c, ", ".join(why)))
    for c in offscreen:
        flagged.append((c, "outside the backdrop entirely"))

    # A cell already looked at and explained is not news. It is still printed —
    # silence about a known oddity is how the note rots away from the art.
    known, unknown = [], []
    for c, why in flagged:
        note = None if strict else accepted_note(world["id"], c[2], c[3])
        (known if note else unknown).append((c, why, note))

    verdict = "all on painted rock" if not unknown else "to look at"
    print(f"{world['id']:<10} {len(cells):>4} cells   {len(unknown):>3} {verdict}")
    for (col, row, *_rest, zone), why, note in unknown:
        print(f"             ({col},{row}) on {zone}: {why}")
    for (col, row, *_rest, _zone), _why, note in known:
        print(f"             ({col},{row}) accepted — {note}")
    flagged = unknown

    if overlay_dir:
        proof = im.copy()
        dr = ImageDraw.Draw(proof, "RGBA")
        offenders = {(c[0], c[1]) for c, _ in flagged}
        for col, row, x, y, hw, hh, _ in cells:
            colour = (255, 40, 40) if (col, row) in offenders else (0, 255, 90)
            dr.polygon(
                [(x, y - hh), (x + hw, y), (x, y + hh), (x - hw, y)],
                outline=colour + (255,),
                fill=colour + (40,),
                width=5,
            )
        out = os.path.join(overlay_dir, f"ground-{world['id']}.png")
        proof.save(out)
        print(f"             overlay → {out}")
    return len(flagged)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--overlay", help="directory to write one proof image per world")
    ap.add_argument("--world", help="audit only this world")
    ap.add_argument("--strict", action="store_true", help="report the ACCEPTED cells too")
    args = ap.parse_args()

    authored = read("src/data/map.json")
    zones = read("src/data/zones.json")
    total = 0
    for world in zones["worlds"]:
        if args.world and world["id"] != args.world:
            continue
        total += audit(world, authored, args.overlay, args.strict)

    if total:
        print(f"\n{total} cell(s) do not look like the ground around them — check the overlay.")
        return 1
    print("\nEvery playable cell of every world is standing on painted rock.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
