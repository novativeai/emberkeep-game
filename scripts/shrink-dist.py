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

## RESIZING IS OPT-IN, AND NOTHING IS OPTED IN

The runtime almost never asks "how big should this be?" — it asks "how big IS
this?" and multiplies. Three separate mechanisms do it:

  * `ITEM_SCALE` / `DECOR_SCALE` / chains' `artScale` are RATIOS on a source's
    natural pixel size. Shrinking the 1160px Ashdrake egg to 148px turned it
    into a 9px speck on the board.
  * `src/data/faces.json` carries a per-SET `textureScale` (0.938 for a blink
    bank, 0.471 for a roar bank) measured against that bank's own pixel size, so
    a swapped head frame lands on the rig's neck. Forcing both banks to 340px
    wide left every dragon's head shrinking the moment it blinked or roared.
  * Sprite sheets are sliced with a FIXED cell (`disc-atlas.webp` at 270x360,
    the standee banks at `STANDEE_BANKS.frameWidth`). Resize the sheet and the
    grid stops landing on the art — Eleanor's dialogue bubble showed a lattice
    of frame fragments instead of a portrait.

Those are three different bindings, in three different files, and there is no
property of a path that predicts which one applies. So the policy is inverted:
**this script re-encodes, and does not resize.** `GROUP_CAPS` is kept as the
mechanism, with every entry `None`; adding a cap means first proving nothing
downstream reads that file's dimensions, and `scale_bound_files()` is the
belt-and-braces check for the ITEM_SCALE/DECOR_SCALE family.

Re-encoding alone is safe by construction: same pixels, fewer bytes.

## Where the savings are, measured

  dragon rig .json       14.2 MB  eight base64 PNGs embedded per rig
  everything else                 lossy re-encode of art over 60 KB

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
import os
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("shrink-dist: Pillow is required (pip3 install pillow)")

ROOT = Path(__file__).resolve().parent.parent
# Lane-isolated: must land on the SAME dist that vite built (see verify-lane.mjs).
DIST = ROOT / os.environ.get("EMBERKEEP_DIST", "dist")

# Method 4 rather than 6: ~4x faster for ~1% more bytes, and this runs on every
# build. Quality 92 for a resize (the pixels are new anyway); 88 for art we can
# only re-encode, where the loss is generational.
QUALITY = 92
METHOD = 4
REQUANT_QUALITY = 88
# Only files at least this big were re-encoded, and at 60 KB that skipped most of
# the art the player waits on: most of the item / skin / reveal / card / terrain
# textures are UNDER 60 KB, and together those small files are most of the boot.
# There is nothing special about a small file that makes its bytes cheaper, so
# the floor is now low enough to catch them. It is not zero: under a few KB the
# WebP container overhead means there is nothing to win and MIN_GAIN would
# reject it anyway, so the work would be pure build time. (From main, 60d4ce8.)
REQUANT_MIN_KB = 6
# Below this saving, a rewrite is not worth a generation of loss.
MIN_GAIN = 0.08

# Max width in canvas px per art class. EVERY ENTRY IS None ON PURPOSE — see the
# module docstring. A cap here is a promise that nothing downstream measures the
# file, and the three classes that used to carry one all broke that promise:
#
#   head-frames  340   heads shrank on blink/roar (faces.json textureScale)
#   disc-atlas   1200  the dialogue bubble showed a grid (fixed 270x360 cells)
#   golden-elder 560   same head-frame binding, via calibrate-faces.mjs
#   characters   560   swept in rig and standee art with no way to tell which
#
# Restore a cap only with the consumer in front of you.
GROUP_CAPS: dict[str, "int | None"] = {
    "head-frames": None,
    "golden-elder": None,
    "characters-other": None,
    "disc-atlas": None,
    "reveals": None,
    "background": None,
    "environment": None,
    "ui": None,
    "items": None,
    "other": None,
}


def group_of(rel: str) -> str:
    if "/head-animation" in rel:  # …and head-animation-adult, which the / missed
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


def verify_dimensions():
    """Every shipped image must be the size its workspace master is.

    The re-encode path cannot change dimensions, so this only ever fires on a
    resize — which is the exact failure that put shrinking heads and a lattice
    of portrait fragments into production. It costs about a second and it fails
    the build, which is the only place a silent visual regression gets caught:
    no test renders a dragon's blink or Eleanor's bubble.
    """
    mismatches = []
    for shipped in sorted(DIST.rglob("*")):
        if shipped.suffix.lower() not in (".webp", ".png", ".jpg", ".jpeg"):
            continue
        rel = shipped.relative_to(DIST)
        master = ROOT / "assets" / rel
        if not master.exists():
            # `optimize:art` re-encodes a .png master to .webp; the pair moves
            # together, so fall back to the sibling before giving up.
            for alt in (master.with_suffix(".png"), master.with_suffix(".webp")):
                if alt.exists():
                    master = alt
                    break
        if not master.exists():
            continue  # generated in the build, no master to compare against
        try:
            with Image.open(master) as a, Image.open(shipped) as b:
                if a.size != b.size:
                    mismatches.append((rel.as_posix(), a.size, b.size))
        except Exception:
            continue
    return mismatches


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="report without writing")
    # 50 → 56 MB when the Align-Studio character clips arrived: fourteen frame
    # sheets (Eleanor, Selyna, the red whelp) are ~13 MB of source art and land
    # around 7 MB shipped. The ceiling is a REGRESSION guard, not a target — it
    # is raised deliberately, with the reason written down, or not at all.
    # 108 (2026-08-14, the legendaries): ashdrake + rimewyrm young idle+roar —
    # young-ONLY breeds, so ~5.3 MB each (no adult set, no fly clip), measured
    # 95.2 → 105.8. 108 keeps the customary ~2 MB of slack. This completes the
    # clip roster for every breed that exists in chains.json; the next raise
    # should come with legendary ADULT tiers or a new breed, nothing else.
    #
    # 110 (2026-08-15, this branch): the number above is main's, measured on
    # main's dist. Ours is 107.7 — the same clip roster plus what only this
    # branch ships: Runevault's boiling cauldron (3.1 MB of atlas, the first
    # animated map decor) and the redrawn Emberbark vase. 108 left 0.3 MB of
    # slack, which is not slack, it is the next asset failing the build for
    # nobody's benefit. 110 restores the customary ~2 MB. Same rule as every
    # line above it: raised deliberately, with the measurement written down.
    #
    # 142 (2026-08-16, production): rigs are OFF and every breed is sequence
    # animated, so the six clip sets main produced after the fork join the
    # deploy — bare emerald 3/4 (12.3 MB: with no rig left to puppet it, the
    # clips ARE the green dragon), ashglass 3/4 (13.3 MB) and porcelain 3/4
    # (17.1 MB), the last two Emporium skins that used to animate as the wrong
    # breed. Measured 139.6; 142 keeps the customary ~2 MB. The rig table
    # emptying returns only ~0.5 MB (the catalog's three rig jsons stay — the
    # UI Builder's loadCharacterRig can still ask for them at runtime).
    #
    # 70 (2026-08-16, production): LOWERED, not raised — the one deliberate
    # quality trade in this ledger. Every board clip sheet is capped at a
    # uniform 0.30 atlas-px-per-game-px density (scripts/cap-clip-density.py:
    # ~3.3x upscale at draw, a step softer than the fly clips' authored 0.33),
    # taking the sheets 103 -> 35 MB staged. Chosen over frame-thinning by the
    # user with the softness shown and accepted; the revert is one re-run of
    # the cap script at a higher density off the git masters, not a redesign.
    # Measured 67.0; 70 keeps the customary slack.
    ap.add_argument("--budget", type=float, default=70.0, help="fail over this many MB")
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

    status = 0
    if mb(total_after) > args.budget:
        print("[shrink-dist] FAIL: over the %.0f MB budget" % args.budget, file=sys.stderr)
        status = 1

    if not args.check:
        bad = verify_dimensions()
        print("[shrink-dist] dimensions match the workspace masters"
              if not bad else "[shrink-dist] FAIL: %d shipped images were resized" % len(bad))
        for rel, want, got in bad[:10]:
            print("  %s  %s -> %s" % (rel, want, got), file=sys.stderr)
        if bad:
            status = 1
    return status


if __name__ == "__main__":
    raise SystemExit(main())
