#!/usr/bin/env python3
"""
Shrink the built `dist/` to what the runtime can actually put on screen.

`assets/` is the art WORKSPACE and its masters must stay at full resolution —
they are the source for re-exports, rig bakes and any future higher-DPI target.
`dist/` is a filtered COPY (vite.config.ts `copyRuntimeArt`), so it is the right
and only place to cut. This script never touches `assets/`.

## The rule

Cap a texture at **2× the largest size it can occupy on the 2560×1600 canvas**.
Two, not one: the spare stop is headroom for the board camera's zoom and for any
placement that scales a piece up.

## What may NOT be resized

`ITEM_SCALE`, `DECOR_SCALE` and chains' `artScale` are RATIOS applied to a
source's natural pixel size, so resizing such a file resizes the piece in the
game. Shrinking the 1160px Ashdrake egg to 148px turned it into a 9px speck on
the board — the same class of bug as resizing a backdrop without recalibrating
map.json. `scale_bound_files()` reads `assets.json` and Constants to find them;
they are re-encoded but never resized.

## Where the waste was, measured

  head-animation frames  14.7 MB  857-1056px art for a head that renders ~140px
                                  (the rig's head layer is 666 of 1054 bounds
                                  units, and a board dragon is 221px wide)
  dragon rig .json       14.2 MB  eight base64 PNGs embedded per rig
  disc atlases            3.8 MB  1890px sheets for ~200px discs

Rigs are re-encoded PNG→WebP inside the data URL. `RigPlayer.loadTextures`
hands those straight to `scene.load.image`, which accepts any data URL the
browser can decode, so the format is free to change.

    python3 scripts/shrink-dist.py [--check] [--budget MB]

`--check` reports without writing. Over budget exits non-zero, so a regression
fails the build instead of quietly shipping 79 MB.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import re
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("shrink-dist: Pillow is required (pip3 install pillow)")

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

# Method 4 rather than 6: ~4x faster for ~1% more bytes, and this runs on every
# build. Quality 92 for a resize (the pixels are new anyway); 88 for art we can
# only re-encode, where the loss is generational.
QUALITY = 92
METHOD = 4
REQUANT_QUALITY = 88
REQUANT_MIN_KB = 60
# Below this saving, a rewrite is not worth a generation of loss.
MIN_GAIN = 0.08

# Max width in canvas px per art class, = 2x the largest on-screen size.
#   head-frames  a board dragon is 221px wide and its head layer is 666/1054 of
#                that (~140px); adults fit inside 340 with room to spare.
#   golden-elder the finale, framed large on her ledge - a bigger cap.
#   disc-atlas   a merge disc is ~200px on a 3x4 sheet.
#   reveals / background  full-screen art. Never resized.
GROUP_CAPS: dict[str, "int | None"] = {
    "head-frames": 340,
    "golden-elder": 560,
    "characters-other": 560,
    "disc-atlas": 1200,
    "reveals": None,
    "background": None,
    "environment": None,
    "ui": None,
    "items": None,
    "other": None,
}


def group_of(rel: str) -> str:
    if "/head-animation/" in rel:
        return "head-frames"
    if "/golden-elder/" in rel:
        return "golden-elder"
    if "/reveals/" in rel:
        return "reveals"
    if "/background/" in rel:
        return "background"
    if "disc-atlas" in rel:
        return "disc-atlas"
    if rel.startswith("sprites/items/"):
        return "items"
    if "/environment/" in rel:
        return "environment"
    if rel.startswith("sprites/ui/"):
        return "ui"
    if "/characters/" in rel:
        return "characters-other"
    return "other"


def scale_bound_files() -> set:
    """Art whose on-screen size is derived from its own pixel dimensions."""
    bound = set()
    consts = (ROOT / "src/core/Constants.ts").read_text()
    scale_keys = set()
    for name in ("ITEM_SCALE", "DECOR_SCALE"):
        block = re.search(name + r"[^=]*=\s*\{(.*?)\n\};", consts, re.S)
        if block:
            for m in re.finditer(r"['\"]?([A-Za-z0-9_]+)['\"]?\s*:\s*[0-9.]+", block.group(1)):
                scale_keys.add(m.group(1).strip("'\""))
    images = json.loads((ROOT / "src/data/assets.json").read_text())["images"]
    for entry in images:
        key = entry.get("key", "")
        path = entry.get("file")
        if not path:
            continue
        stem = key.split("_", 1)[1] if "_" in key else key
        if key.startswith(("item_", "decor_")) or stem in scale_keys:
            bound.add(path)
    return bound


def _process(job):
    """(before, after, resized, requantised) for one file."""
    rel, cap, check = job
    path = DIST / rel
    size = path.stat().st_size
    try:
        with Image.open(path) as im:
            im.load()
            w, h = im.size
            if cap and w > cap:
                out = im.convert("RGBA").resize((cap, max(1, round(h * cap / w))), Image.LANCZOS)
                quality, resized, requant = QUALITY, 1, 0
            elif size / 1024 >= REQUANT_MIN_KB:
                out, quality, resized, requant = im.convert("RGBA"), REQUANT_QUALITY, 0, 1
            else:
                return size, size, 0, 0
            buf = io.BytesIO()
            out.save(buf, "WEBP", quality=quality, method=METHOD)
            data = buf.getvalue()
    except Exception:
        return size, size, 0, 0
    if len(data) >= size * (1 - MIN_GAIN):
        return size, size, 0, 0
    if not check:
        path.write_bytes(data)
    return size, len(data), resized, requant


def shrink_images(check):
    bound = scale_bound_files()
    jobs = []
    for path in sorted(DIST.rglob("*")):
        if path.suffix.lower() not in (".webp", ".png", ".jpg", ".jpeg"):
            continue
        rel = path.relative_to(DIST).as_posix()
        cap = None if rel in bound else GROUP_CAPS.get(group_of(rel))
        jobs.append((rel, cap, check))
    before = after = resized = requant = 0
    with ProcessPoolExecutor() as pool:
        for b, a, rz, rq in pool.map(_process, jobs, chunksize=4):
            before += b
            after += a
            resized += rz
            requant += rq
    return before, after, resized, requant


def shrink_rigs(check):
    """Re-encode each rig's embedded base64 PNG layers as WebP."""
    before = after = touched = 0
    for path in sorted(DIST.rglob("*.rig.json")):
        size = path.stat().st_size
        before += size
        doc = json.loads(path.read_text())
        images = doc.get("images")
        if not isinstance(images, dict):
            after += size
            continue
        changed = False
        for name, uri in list(images.items()):
            if not isinstance(uri, str) or not uri.startswith("data:image/png;base64,"):
                continue
            raw = base64.b64decode(uri.split(",", 1)[1])
            with Image.open(io.BytesIO(raw)) as im:
                im.load()
                buf = io.BytesIO()
                im.convert("RGBA").save(buf, "WEBP", quality=QUALITY, method=METHOD)
            if buf.tell() >= len(raw):
                continue
            images[name] = "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()
            changed = True
        if not changed:
            after += size
            continue
        blob = json.dumps(doc, separators=(",", ":")).encode()
        if not check:
            path.write_bytes(blob)
        after += len(blob)
        touched += 1
    return before, after, touched


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="report without writing")
    ap.add_argument("--budget", type=float, default=50.0, help="fail over this many MB")
    args = ap.parse_args()

    if not DIST.exists():
        sys.exit("shrink-dist: no dist/ - run `pnpm build` first")

    total_before = sum(p.stat().st_size for p in DIST.rglob("*") if p.is_file())
    ib, ia, resized, requant = shrink_images(args.check)
    rb, ra, rigs = shrink_rigs(args.check)
    mb = lambda n: n / 1e6

    print("[shrink-dist] textures %6.1f -> %6.1f MB  (%d resized, %d re-encoded)"
          % (mb(ib), mb(ia), resized, requant))
    print("[shrink-dist] rigs     %6.1f -> %6.1f MB  (%d PNG->WebP)" % (mb(rb), mb(ra), rigs))
    total_after = total_before - (ib - ia) - (rb - ra)
    print("[shrink-dist] dist     %6.1f -> %6.1f MB%s"
          % (mb(total_before), mb(total_after), "  (dry run)" if args.check else ""))

    if mb(total_after) > args.budget:
        print("[shrink-dist] FAIL: over the %.0f MB budget" % args.budget, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
