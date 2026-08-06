#!/usr/bin/env python3
"""
LOSSLESS re-encode of the shipped PNGs to WebP, with the references moved with them.

    python3 scripts/optimize-art.py --dry-run     # what it would do
    python3 scripts/optimize-art.py               # the SHIPPED art (dist), + references
    python3 scripts/optimize-art.py --project     # every tracked PNG under assets/,
                                                  # and the .png master goes away

WHY WEBP AND NOT A SMALLER PNG: these are hand-painted RGBA sprites, and
`cwebp -lossless` gives 30-46% on them where a PNG re-crush gives ~5%. Nothing
here is a quality trade: every output is decoded and compared to its source
pixel for pixel (RGBA, `-exact` so even the colour under fully transparent
pixels survives), and a file whose comparison fails, or whose WebP is not
actually smaller, is left alone.

WHAT IT DOES NOT TOUCH, on purpose:
  · `vfx-bank/**` — those sheets are DATA (channel-packed frames + motion
    vectors read by a shader), not pictures. They stay byte-identical.
  · `disc-atlas.png` — the masters keep a hand-converted lossless .webp sibling
    (58% smaller — the old '~1%' note here was mismeasured); the build ships the
    sibling and the baker regenerates both.
  · `raw/**` — the generation workspace never ships (vite.config.ts).

THE PAIRING RULE THIS RIDES ON: the build already drops a `sprites/**.png` when
a `.webp` sibling exists, so creating the sibling is what takes the PNG out of
the deploy — which means a reference left pointing at the `.png` would fall back
to a painted placeholder. So conversion and reference rewriting happen together,
in one pass, and the script fails if it converts a file whose reference it
cannot find.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
DIST = ROOT / "dist"
DRY = "--dry-run" in sys.argv
PROJECT = "--project" in sys.argv

SKIP = (
    re.compile(r"^vfx-bank/"),          # shader data, not pictures
    re.compile(r"disc-atlas\.png$"),    # its lossless .webp sibling is authored beside it
    re.compile(r"^raw/"),               # generation workspace: never ships, never tracked
)


def shipped_pngs() -> list[str]:
    """The PNGs the deploy carries — `dist` is that list, built by the filter."""
    if not (DIST / "index.html").exists():
        sys.exit("[optimize-art] no dist/ — run `pnpm build` first")
    out = []
    for abs_path in DIST.rglob("*.png"):
        rel = abs_path.relative_to(DIST).as_posix()
        if any(rx.search(rel) for rx in SKIP):
            continue
        if (ASSETS / rel).exists():
            out.append(rel)
    return sorted(out)


def project_pngs() -> list[str]:
    """
    Every PNG the REPOSITORY carries under assets/ — the workspace as well as the
    deploy, because a bake input is a PNG somebody has to clone too.

    Tracked files only: `assets/raw` is 3.9 GB of local generation output that is
    git-ignored and never shipped, and re-encoding someone's masters in place is
    not this script's business.
    """
    listed = subprocess.run(
        ["git", "ls-files", "-z", "assets"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.split("\0")
    out = []
    for tracked in listed:
        if not tracked.endswith(".png"):
            continue
        rel = tracked[len("assets/"):]
        if any(rx.search(rel) for rx in SKIP):
            continue
        if (ASSETS / rel).exists():
            out.append(rel)
    return sorted(out)


def identical(png: Path, webp: Path) -> bool:
    with Image.open(png) as a, Image.open(webp) as b:
        if a.size != b.size:
            return False
        return a.convert("RGBA").tobytes() == b.convert("RGBA").tobytes()


def convert(rel: str) -> tuple[int, int] | None:
    """→ (before, after) when the webp is smaller AND pixel-identical."""
    png = ASSETS / rel
    webp = png.with_suffix(".webp")
    if webp.exists():
        # Already paired. In --project mode the master has served its purpose:
        # the WebP holds the same pixels, so carrying both is carrying the art
        # twice. Verify that claim before acting on it.
        if PROJECT and not DRY and identical(png, webp):
            before = png.stat().st_size
            png.unlink()
            dropped.append(rel)
            return (before, 0)
        return None
    before = png.stat().st_size
    if DRY:
        return (before, before)  # size unknown without encoding; caller reports count only
    subprocess.run(
        ["cwebp", "-quiet", "-lossless", "-exact", "-z", "9", "-m", "6", str(png), "-o", str(webp)],
        check=True,
    )
    after = webp.stat().st_size
    if after >= before or not identical(png, webp):
        webp.unlink(missing_ok=True)
        return None
    if PROJECT:
        png.unlink()  # pixel-identical and smaller: the WebP IS the master now
        dropped.append(rel)
    return (before, after)


converted: list[str] = []
dropped: list[str] = []
saved = 0
total_before = 0
for rel in project_pngs() if PROJECT else shipped_pngs():
    res = convert(rel)
    if not res:
        continue
    before, after = res
    if rel not in dropped or after:
        converted.append(rel)
    total_before += before
    saved += before - after

print(f"[optimize-art] converted {len(converted)} PNG → lossless WebP"
      + (f", dropped {len(dropped)} superseded master(s)" if PROJECT else ""))
print(f"               {total_before / 1048576:.1f} MB → {(total_before - saved) / 1048576:.1f} MB "
      f"({saved / 1048576:.1f} MB saved)")

if DRY or not converted:
    sys.exit(0)

# ── move the references ───────────────────────────────────────────────────────
swap = {rel: rel[:-4] + ".webp" for rel in converted}
unresolved = set(swap)


def rewrite_json(path: Path, walk) -> int:
    doc = json.loads(path.read_text())
    n = walk(doc)
    if n:
        path.write_text(json.dumps(doc, indent=2) + "\n")
    return n


def assets_json(doc) -> int:
    n = 0
    for e in doc["images"]:
        f = e.get("file")
        if f in swap:
            e["file"] = swap[f]
            unresolved.discard(f)
            n += 1
    return n


def faces_json(doc) -> int:
    n = 0
    for face in doc.values():
        base = face["basePath"]
        for st in face.get("sets", {}).values():
            for fr in st.get("frames", []):
                rel = f"{base}/{st['dir']}/{fr['file']}"
                if rel in swap:
                    fr["file"] = Path(fr["file"]).with_suffix(".webp").name
                    unresolved.discard(rel)
                    n += 1
    return n


print(f"               assets.json: {rewrite_json(ROOT / 'src/data/assets.json', assets_json)} refs")
print(f"               faces.json:  {rewrite_json(ROOT / 'src/data/faces.json', faces_json)} refs")

# Numbered frame banks (`${dir}/${i}.<ext>`) are addressed by sequenceCatalog.ts.
# A bank flips to `ext: 'webp'` only when EVERY frame it names converted — a
# half-converted bank would ask for frames that no longer ship.
seq_path = ROOT / "src/render/sequenceCatalog.ts"
seq = seq_path.read_text()
banks = re.findall(r"dir: '([^']+)',\n\s*count: (\d+)", seq)
flipped = 0
for dir_, count in banks:
    frames = [f"{dir_}/{i}.png" for i in range(int(count))]
    if not all(f in swap for f in frames):
        continue
    seq = seq.replace(f"dir: '{dir_}',", f"dir: '{dir_}',\n    ext: 'webp',", 1)
    for f in frames:
        unresolved.discard(f)
    flipped += 1
# `endIdle` stills are plain paths in the same file.
for rel, to in swap.items():
    if f"'{rel}'" in seq:
        seq = seq.replace(f"'{rel}'", f"'{to}'")
        unresolved.discard(rel)
seq_path.write_text(seq)
print(f"               sequenceCatalog.ts: {flipped} bank(s) flipped to webp")

if unresolved:
    # In --project mode most conversions ARE workspace art (bake inputs, masters,
    # generation references) and having no runtime reference is the normal case.
    # In the shipped pass it is a defect: the build drops the .png and nothing
    # would ask for the .webp, so the art would fall back to a placeholder.
    if PROJECT:
        print(f"               {len(unresolved)} workspace file(s) with no runtime reference (expected)")
    else:
        print(f"\n[optimize-art] {len(unresolved)} converted file(s) had NO reference to move —")
        print("               the build will now drop the .png and nothing asks for the .webp:")
        for rel in sorted(unresolved):
            print(f"                 {rel}")
        sys.exit(1)
