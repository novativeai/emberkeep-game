#!/usr/bin/env python3
"""Cap every BOARD clip sheet at a uniform on-screen density.

`scale` in character-anims.json is GAME px per ATLAS px, so 1/scale is the
sheet's pixel density against the 2560-space. The fly clips already draw at
2-3x upscale (density 0.33-0.5) and set the look the game has shipped with all
along; this pass normalises every board sheet DOWN to that same density
(TARGET_DENSITY atlas px per game px), so no sheet spends bytes on pixels
sharper than the sharpest thing beside it. Sheets at or below the target are
left byte-identical. Non-board stages (portraits, decor) are never touched.

Per sheet: each frame cell is resized premultiplied (no dark halos at the
alpha edge) into an EXACT new grid — same columns, same frame count — and the
record is updated by the staged-downscale convention the Align pipeline
already uses: frameWidth/frameHeight shrink, scale grows by the same factor,
dx/dy (game px) and every frame index (segments, sleep-frames) are untouched.

Usage: python3 scripts/cap-clip-density.py [density]   (default 0.5)
Idempotent: a re-run at the same density is a no-op.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANIMS = os.path.join(ROOT, 'src/data/character-anims.json')
SLEEP_TOOL = os.path.join(ROOT, 'scripts/find-sleep-frames.py')
TARGET_DENSITY = float(sys.argv[1]) if len(sys.argv) > 1 else 0.5


def resize_premultiplied(frame: Image.Image, w: int, h: int) -> Image.Image:
    a = np.asarray(frame, dtype=np.float32)
    alpha = a[..., 3:4] / 255.0
    a[..., :3] *= alpha  # premultiply so transparent RGB cannot bleed in
    pm = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA').resize((w, h), Image.LANCZOS)
    b = np.asarray(pm, dtype=np.float32)
    out_alpha = b[..., 3:4] / 255.0
    with np.errstate(divide='ignore', invalid='ignore'):
        b[..., :3] = np.where(out_alpha > 0, b[..., :3] / np.maximum(out_alpha, 1e-6), 0)
    return Image.fromarray(np.clip(b, 0, 255).astype(np.uint8), 'RGBA')


def main() -> None:
    doc = json.load(open(ANIMS))
    eyes_factor: dict[str, float] = {}
    before = after = 0
    for cid, c in sorted(doc['characters'].items()):
        for clip_id, cl in sorted(c.get('clips', {}).items()):
            if cl.get('stage') not in (None, 'board'):
                continue
            f = min(1.0, TARGET_DENSITY * cl['scale'])
            if f > 0.995:
                continue
            path = os.path.join(ROOT, 'assets', cl['file'])
            fw, fh, n = cl['frameWidth'], cl['frameHeight'], cl['frames']
            nfw = max(1, round(fw * f))
            factor = nfw / fw
            nfh = max(1, round(fh * factor))
            sheet = Image.open(path).convert('RGBA')
            cols = sheet.width // fw
            rows = (n + cols - 1) // cols
            out = Image.new('RGBA', (cols * nfw, rows * nfh), (0, 0, 0, 0))
            for i in range(n):
                sx, sy = (i % cols) * fw, (i // cols) * fh
                cell = sheet.crop((sx, sy, sx + fw, sy + fh))
                out.paste(resize_premultiplied(cell, nfw, nfh), ((i % cols) * nfw, (i // cols) * nfh))
            b0 = os.path.getsize(path)
            out.save(path, 'WEBP', quality=92, method=4)
            b1 = os.path.getsize(path)
            before += b0
            after += b1
            cl['frameWidth'] = nfw
            cl['frameHeight'] = nfh
            cl['scale'] = cl['scale'] * fw / nfw
            if clip_id == 'idle':
                eyes_factor[cid] = factor
            print(f'{cid}/{clip_id}: x{factor:.3f}  {b0/1e6:.1f} -> {b1/1e6:.1f} MB  (scale {cl["scale"]:.4f})')
    json.dump(doc, open(ANIMS, 'w'), indent=2, ensure_ascii=False)
    open(ANIMS, 'a').write('\n')
    # Keep the sleep-frame locator tool aimed at the eyes it calibrated.
    if eyes_factor and os.path.exists(SLEEP_TOOL):
        src = open(SLEEP_TOOL).read()
        import re
        def fix(m):
            cid = m.group(1)
            if cid not in eyes_factor:
                return m.group(0)
            k = eyes_factor[cid]
            return f"'{cid}': ({round(int(m.group(2)) * k)}, {round(int(m.group(3)) * k)}),"
        src = re.sub(r"'(\w+)': \((\d+), (\d+)\),", fix, src)
        open(SLEEP_TOOL, 'w').write(src)
    print(f'\nTOTAL board sheets touched: {before/1e6:.1f} -> {after/1e6:.1f} MB')


if __name__ == '__main__':
    main()
