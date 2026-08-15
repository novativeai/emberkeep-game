#!/usr/bin/env python3
"""Shrink board plates to 2.25x the size they can actually occupy.

WHY THIS IS SAFE TO DO TO THE WORKSPACE ART

`ITEM_SCALE` is a ratio on a plate's NATURAL pixel width, so the only coherent
place to resize is the source every environment reads: a dist-only resize would
render production at a different size from dev. The authored ratios are left
untouched and still describe the intent they were tuned with; a GENERATED
compensation table (`src/data/art-downscale.json`) carries the factor, exactly
the way `faces.json` carries calibration. Rendered size is therefore unchanged
to within a rounding error, and every per-line comment in ITEM_SCALE stays true.

WHAT IT REFUSES TO TOUCH

  * files more than one key points at — `item_storm_2` and `skin_storm_3` are
    the same .webp read at two different scales, and one resize cannot serve
    both
  * keys with no ITEM_SCALE entry — their on-screen size is not knowable here
  * anything already at or under the cap

Headroom is 2.25x, not 2x: the board camera tops out at zoom 1.4 and a retina
desktop backs at 1.5, so 2.1 is the worst honest case and 2.25 clears it.

Every file it writes is tracked by git — `git checkout -- assets/sprites` is
the undo.

    python3 downscale-items.py [--apply]     (default: report only)
"""
import json
import os
import re
import sys

from PIL import Image

ROOT = "/home/kioto/projetN/daroland/emberkeep-game"
HEADROOM = 2.25
OUT = f"{ROOT}/src/data/art-downscale.json"
APPLY = "--apply" in sys.argv

src = open(f"{ROOT}/src/core/Constants.ts").read()
block = re.search(r"export const ITEM_SCALE[^{]*\{(.*?)\n\};", src, re.S).group(1)
scales = {
    k: float(v)
    for k, v in re.findall(r"^\s*'?([A-Za-z0-9_]+)'?\s*:\s*([0-9.]+)\s*,", block, re.M)
}

assets = json.load(open(f"{ROOT}/src/data/assets.json"))
by_file = {}
for e in assets["images"]:
    if e.get("source") != "file" or not e.get("file"):
        continue
    by_file.setdefault(e["file"], []).append(e["key"])

prev = json.load(open(OUT))["factors"] if os.path.exists(OUT) else {}

plan, skipped_shared, skipped_noscale = [], [], []
for e in assets["images"]:
    key = e.get("key", "")
    if not key.startswith(("item_", "sleep_")) or e.get("source") != "file" or not e.get("file"):
        continue
    rel = e["file"]
    if len(by_file[rel]) > 1:
        skipped_shared.append((key, sorted(by_file[rel])))
        continue
    # ITEM_SCALE keys a board piece by `<chain>_<tier>` but a curled sleep
    # painting by its FULL texture key (`sleep_ember_dragon_3: 0.134`) — the
    # painting is its own pose at its own resolution and could never inherit
    # the standing piece's ratio. Ask by the right name for each.
    name = key if key.startswith("sleep_") else key[len("item_"):]
    if name not in scales:
        skipped_noscale.append(key)
        continue
    path = os.path.join(ROOT, "assets", rel.lstrip("/"))
    if not os.path.exists(path):
        continue
    with Image.open(path) as im:
        w, h = im.size
    # Already shrunk on an earlier run: the authored scale still refers to the
    # ORIGINAL width, so measure against that and this stays idempotent.
    original_w = w / prev.get(key, 1.0)
    on_screen = original_w * scales[name]
    target = on_screen * HEADROOM
    if target >= w - 1:
        continue
    new_w = max(1, round(target))
    new_h = max(1, round(h * new_w / w))
    plan.append((key, rel, path, (w, h), (new_w, new_h), original_w))

plan.sort(key=lambda r: -(r[3][0] * r[3][1] - r[4][0] * r[4][1]))
before = sum(r[3][0] * r[3][1] * 4 for r in plan)
after = sum(r[4][0] * r[4][1] * 4 for r in plan)
print(f"plates to shrink   : {len(plan)}")
print(f"GPU memory         : {before/1e6:.1f} MB -> {after/1e6:.1f} MB  (saves {(before-after)/1e6:.1f} MB)")
print(f"skipped, file shared by several keys : {len(skipped_shared)}")
for key, keys in skipped_shared[:10]:
    print(f"    {key:28s} shares its file with {', '.join(k for k in keys if k != key)}")
print(f"skipped, no ITEM_SCALE entry         : {len(skipped_noscale)}  {skipped_noscale}")

if not APPLY:
    print("\n(report only — pass --apply to write)")
    sys.exit(0)

factors = dict(prev)
for key, rel, path, (w, h), (nw, nh), original_w in plan:
    for candidate in (path, os.path.splitext(path)[0] + ".png"):
        if not os.path.exists(candidate):
            continue
        with Image.open(candidate) as im:
            im = im.convert("RGBA")
            out = im.resize((nw, nh), Image.LANCZOS)
        if candidate.endswith(".webp"):
            out.save(candidate, "WEBP", quality=92, method=4)
        else:
            out.save(candidate, "PNG", optimize=True)
    factors[key] = round(nw / original_w, 6)

doc = {
    "format": "emberkeep-art-downscale",
    "generatedBy": "scripts/downscale-items.py",
    "note": (
        "GENERATED. Plates stored at %gx their on-screen size; the factor is "
        "new width / the width ITEM_SCALE was authored against. Multiply the "
        "authored scale by 1/factor at load. Never hand-edit." % HEADROOM
    ),
    "factors": dict(sorted(factors.items())),
}
open(OUT, "w").write(json.dumps(doc, indent=2) + "\n")
print(f"\nwrote {OUT}  ({len(factors)} plates)")
