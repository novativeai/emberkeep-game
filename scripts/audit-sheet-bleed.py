#!/usr/bin/env python3
"""Audit every motion-vector flipbook for art that overflows its own cell.

A flipbook cell is a hard boundary: the shader samples ONE cell and clamps to
half a texel inside it. If the bake let a frame's art run across the border, the
neighbouring frame's edge is genuinely part of the sampled region and no runtime
clamp can undo it — the effect renders as two half-images side by side, and it
gets worse the larger you draw it, which is why it can sit unnoticed in a small
one-shot for months.

`fb_flame_small` fails this (92% border alpha, 25 of its 32 cells touching an
edge). `fb_flame` has identical geometry and is clean, which is why the fire
emitter preset uses it.

    python3 scripts/audit-sheet-bleed.py [--threshold 0.15]

Exit code 1 if any sheet bleeds, so it can gate a re-bake.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHEETS = ROOT / "assets/vfx-bank/flipbooks"
META = ROOT / "src/data/vfx-flipbooks.json"


def audit(key: str, m: dict) -> tuple[float, int, int]:
    """Return (worst border alpha as a fraction of the row's peak column,
    cells whose content touches a left/right edge, non-empty cells)."""
    alpha = np.asarray(Image.open(SHEETS / f"{key}_pack.png")).astype(float)[..., 3]
    cw, ch, cols, rows = m["cellW"], m["cellH"], m["cols"], m["rows"]

    worst = 0.0
    for r in range(rows):
        colsum = alpha[r * ch : (r + 1) * ch].sum(0)
        peak = max(1.0, colsum.max())
        for x in range(cw, cols * cw, cw):
            worst = max(worst, colsum[x - 1 : x + 1].mean() / peak)

    touching = 0
    populated = 0
    for r in range(rows):
        for c in range(cols):
            cell = alpha[r * ch : (r + 1) * ch, c * cw : (c + 1) * cw]
            if cell.max() == 0:
                continue
            populated += 1
            profile = cell.sum(0)
            live = np.where(profile > max(30.0, profile.max() * 0.02))[0]
            if len(live) and (live.min() <= 0 or live.max() >= cw - 1):
                touching += 1
    return worst, touching, populated


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--threshold", type=float, default=0.15,
                    help="fraction of the peak column allowed to sit on a cell border")
    args = ap.parse_args()

    meta = json.loads(META.read_text())["sheets"]
    bad: list[str] = []
    print(f"{'sheet':18s} {'grid':>7s} {'cell':>9s} {'border':>8s}  edge-touching cells")
    for key, m in meta.items():
        if not (SHEETS / f"{key}_pack.png").exists():
            print(f"{key:18s}  (not baked)")
            continue
        worst, touching, populated = audit(key, m)
        flag = ""
        if worst > args.threshold:
            bad.append(key)
            flag = "  <-- BLEEDS"
        print(f"{key:18s} {m['cols']}x{m['rows']:<5d} {m['cellW']}x{m['cellH']:<6d} "
              f"{worst * 100:6.1f}%  {touching}/{populated}{flag}")

    if bad:
        print(f"\n{len(bad)} sheet(s) overflow their cells: {', '.join(bad)}")
        print("Re-bake with a wider cell, or do not use them — the runtime cannot fix this.")
        return 1
    print("\nevery sheet stays inside its cells")
    return 0


if __name__ == "__main__":
    sys.exit(main())
