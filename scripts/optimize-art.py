#!/usr/bin/env python3
"""
LOSSLESS re-encode of the shipped PNGs to WebP, with the references moved with them.

    python3 scripts/optimize-art.py --dry-run     # what it would do
    python3 scripts/optimize-art.py               # convert + rewrite references

WHY WEBP AND NOT A SMALLER PNG: these are hand-painted RGBA sprites, and
`cwebp -lossless` gives 30-46% on them where a PNG re-crush gives ~5%. Nothing
here is a quality trade: every output is decoded and compared to its source
pixel for pixel (RGBA, `-exact` so even the colour under fully transparent
pixels survives), and a file whose comparison fails, or whose WebP is not
actually smaller, is left alone.

WHAT IT DOES NOT TOUCH, on purpose:
  · `vfx-bank/**` — those sheets are DATA (channel-packed frames + motion
    vectors read by a shader), not pictures. They stay byte-identical.
  · `disc-atlas.png` — measured at ~1% for a 4.5 MB file; the churn is not worth it.
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

# Only files that actually ship are worth converting, and `dist` is the list of
# those — built by the filter in vite.config.ts. Run `pnpm build` first.
if not (DIST / "index.html").exists():
    sys.exit("[optimize-art] no dist/ — run `pnpm build` first")

SKIP = (
    re.compile(r"^vfx-bank/"),          # shader data, not pictures
    re.compile(r"disc-atlas\.png$"),    # ~1% for 4.5 MB
    re.compile(r"^raw/"),               # never ships
)


def shipped_pngs() -> list[str]:
    out = []
    for abs_path in DIST.rglob("*.png"):
        rel = abs_path.relative_to(DIST).as_posix()
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
        return None  # already paired — the build is already shipping the webp
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
    return (before, after)


converted: list[str] = []
saved = 0
total_before = 0
for rel in shipped_pngs():
    res = convert(rel)
    if not res:
        continue
    before, after = res
    converted.append(rel)
    total_before += before
    saved += before - after

print(f"[optimize-art] converted {len(converted)} PNG → lossless WebP")
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
    print(f"\n[optimize-art] {len(unresolved)} converted file(s) had NO reference to move —")
    print("               the build will now drop the .png and nothing asks for the .webp:")
    for rel in sorted(unresolved):
        print(f"                 {rel}")
    sys.exit(1)
