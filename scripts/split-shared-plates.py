#!/usr/bin/env python3
"""Give a board plate its own file when the one it shares is now lazy.

`item_storm_2` and `skin_storm_3` are ONE .webp read at two different scales,
so `downscale-items.py` refuses to resize it — one resize cannot serve both.
That refusal is right, and it left the four biggest plates on the board at full
size for the sake of skins that no longer even load at boot.

So: split. The `item_` key gets its own copy, cut to the size it can actually
occupy, and the original stays exactly as it is for the skin that still reads
it — full resolution, loaded only when somebody wears it.

ONLY where it is a WIN. Duplicating a file that two BOOT keys read costs more
than it saves (two plates resident instead of one), so the rule is exact: split
only a file whose sole non-lazy tenant is the sizeable key. Today that is four
files; every other shared plate is left alone and says why.

    python3 split-shared-plates.py [--apply]
"""
import json
import os
import re
import sys

from PIL import Image

ROOT = "/home/kioto/projetN/daroland/emberkeep-game"
HEADROOM = 2.25
APPLY = "--apply" in sys.argv
ASSETS = f"{ROOT}/src/data/assets.json"
DOWNSCALE = f"{ROOT}/src/data/art-downscale.json"


def lazy(key):
    """Mirror of core/lazyTextures.isLazyScreenArt."""
    return key.startswith(("trailer_", "ui_teaser_", "reveal_", "skin_", "card_")) or key == "ui_levelup_emblem"


src = open(f"{ROOT}/src/core/Constants.ts").read()
block = re.search(r"export const ITEM_SCALE[^{]*\{(.*?)\n\};", src, re.S).group(1)
scales = {
    k: float(v)
    for k, v in re.findall(r"^\s*'?([A-Za-z0-9_]+)'?\s*:\s*([0-9.]+)\s*,", block, re.M)
}

assets = json.load(open(ASSETS))
by_file = {}
for e in assets["images"]:
    if e.get("source") == "file" and e.get("file"):
        by_file.setdefault(e["file"], []).append(e["key"])

plan = []
for rel, keys in by_file.items():
    if len(keys) < 2:
        continue
    live = [k for k in keys if not lazy(k)]
    if len(live) != 1:
        continue
    key = live[0]
    name = key if key.startswith("sleep_") else key[len("item_"):] if key.startswith("item_") else None
    if name is None or name not in scales:
        continue
    path = os.path.join(ROOT, "assets", rel.lstrip("/"))
    if not os.path.exists(path):
        continue
    with Image.open(path) as im:
        w, h = im.size
    target = w * scales[name] * HEADROOM
    if target >= w - 1:
        continue
    new_w = max(1, round(target))
    new_h = max(1, round(h * new_w / w))
    stem, ext = os.path.splitext(rel)
    plan.append((key, rel, f"{stem}--{key}{ext}", path, (w, h), (new_w, new_h)))

before = sum(r[4][0] * r[4][1] * 4 for r in plan)
after = sum(r[5][0] * r[5][1] * 4 for r in plan)
print(f"plates to split : {len(plan)}")
print(f"boot GPU memory : {before/1e6:.1f} MB -> {after/1e6:.1f} MB  (saves {(before-after)/1e6:.1f} MB)")
for key, rel, new_rel, _p, old, new in plan:
    print(f"    {key:22s} {str(old):>12} -> {str(new):>11}   {new_rel}")

if not APPLY:
    print("\n(report only — pass --apply to write)")
    sys.exit(0)

text = open(ASSETS).read()
factors = json.load(open(DOWNSCALE))
for key, rel, new_rel, path, (w, h), (nw, nh) in plan:
    with Image.open(path) as im:
        im.convert("RGBA").resize((nw, nh), Image.LANCZOS).save(
            os.path.join(ROOT, "assets", new_rel.lstrip("/")), "WEBP", quality=92, method=4
        )
    # Repoint THIS key only — a targeted edit, so the hand-authored file keeps
    # its shape instead of being reflowed by a whole-document rewrite.
    pattern = r'("key":\s*"%s",\s*"source":\s*"file",\s*"file":\s*)"%s"' % (re.escape(key), re.escape(rel))
    text, n = re.subn(pattern, lambda m: m.group(1) + '"%s"' % new_rel, text, count=1)
    if n != 1:
        sys.exit(f"split: could not repoint {key} (matched {n})")
    factors["factors"][key] = round(nw / w, 6)

open(ASSETS, "w").write(text)
factors["factors"] = dict(sorted(factors["factors"].items()))
open(DOWNSCALE, "w").write(json.dumps(factors, indent=2) + "\n")
print(f"\nrepointed {len(plan)} keys in assets.json; art-downscale.json now has {len(factors['factors'])} plates")
