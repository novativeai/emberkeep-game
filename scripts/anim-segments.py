#!/usr/bin/env python3
"""Propose flight-phase segments for an ingested fly atlas.

The wan lowflight clips are a full journey — rest → unfold (takeoff) →
steady wingbeats (cruise) → fold (landing) → rest — because the generation
pins both ends to the rest plate. The runtime plays them PHASED
(BoardScene.flySegments): this tool measures where the phases are.

  anim-segments.py <atlas-dir> <clip>

Method: every frame is scored by RMSE against frame 0 (the rest pose) on
downscaled RGBA composites. Takeoff = the climb out of rest similarity;
landing = the fall back into it (scanned from the tail); the cruise LOOP is
the (start, period) inside the cruise plateau whose endpoints match best —
the same frame-similarity search that found the redwhelp's authored loop.
Prints JSON: {takeoff: [0, a], loop: [s, s+p], landing: [b, n]} in the
runtime's half-open convention, plus the scores backing each cut.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def main() -> None:
    atlas_dir, clip = Path(sys.argv[1]), sys.argv[2]
    doc = json.loads((atlas_dir / 'atlas.json').read_text())
    m = doc['animations'][clip]
    sheet = Image.open(atlas_dir / m['file'])
    n, fw, fh, cols = m['frames'], m['frameWidth'], m['frameHeight'], m['cols']

    frames = []
    for i in range(n):
        c, r = i % cols, i // cols
        f = sheet.crop((c * fw, r * fh, (c + 1) * fw, (r + 1) * fh))
        bg = Image.new('RGBA', f.size, (0, 0, 0, 255))
        bg.paste(f, (0, 0), f)
        bg = bg.convert('RGB').resize((160, max(1, int(160 * fh / fw))), Image.BILINEAR)
        frames.append(np.asarray(bg).astype(np.float32))

    rmse = lambda a, b: float(np.sqrt(((a - b) ** 2).mean()))
    d0 = [rmse(frames[i], frames[0]) for i in range(n)]
    plateau = float(np.median(sorted(d0)[int(n * 0.5):]))

    # Rough cruise bounds off rest-similarity, only to seed the cycle search.
    hi = 0.8 * plateau
    rough_lo = next((i for i in range(n) if d0[i] >= hi), n // 4)
    rough_hi = n - 1
    for i in range(n - 1, -1, -1):
        if d0[i] >= hi:
            rough_hi = i + 1
            break

    best = None
    for p in range(8, min(72, rough_hi - rough_lo - 1)):
        scores = [rmse(frames[s], frames[s + p]) for s in range(rough_lo, rough_hi - p, 2)]
        if not scores:
            continue
        s_best = rough_lo + 2 * int(np.argmin(scores))
        if best is None or min(scores) < best[2]:
            best = (s_best, p, min(scores))
    if best is None:
        raise SystemExit('no cruise window found')
    s, p, score = best

    # TAKEOFF is everything before the loop entry (the rest-similarity cut
    # saturates the moment wings move and truncates the ramp). LANDING begins
    # at the LAST frame still in full flight: rest-similarity oscillates with
    # the wingbeat all through the cruise, so the last excursion to plateau
    # level marks the final beat — everything after it is the fold.
    landing_start = max(
        (i for i in range(s + p, n) if d0[i] >= 0.95 * plateau),
        default=rough_hi
    )

    print(json.dumps({
        'clip': clip,
        'frames': n,
        'segments': {'takeoff': [0, s], 'loop': [s, s + p], 'landing': [landing_start, n]},
        'measures': {
            'restPlateauRmse': round(plateau, 1),
            'loopClosureRmse': round(score, 1),
            'loopPeriodFrames': p,
            'landingFrames': n - landing_start
        }
    }, indent=2))


if __name__ == '__main__':
    main()
