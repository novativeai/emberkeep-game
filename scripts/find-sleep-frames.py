#!/usr/bin/env python3
"""Regenerate the eye filmstrips behind src/data/sleep-frames.json.

sleep-frames.json holds, per clip character, the FULLY-BLINKED (eyes-closed)
frame of its idle sheet — the pose a seated sleep freezes on when the breed has
no tosleep clip and no sleep painting (BoardScene.seatDragonSleep).

The pick is visual, not automatic: sway/flutter defeats every diff heuristic we
tried (open-eyed poses far from the mean out-score real blinks), while a human
or agent reading a labeled filmstrip of the eye region gets it right at a
glance. So this script only PRESENTS: for every board clip character it renders
a grid of the eye crop across the idle cycle (every 2nd frame, frame numbers
overlaid). Read the strips, find the closed run, write its middle frame into
sleep-frames.json.

EYES maps each character to its eye position in frame coordinates. It only goes
stale when a breed's framing changes — re-locate against frame 0 if a strip
comes out cropping the wrong spot.

Usage: python3 scripts/find-sleep-frames.py [outdir]   (default ./sleep-frame-strips)
"""
import json
import os
import sys

from PIL import Image, ImageDraw

EYES = {
    'ashdrake_young': (115, 105),
    'ashglass_adult': (105, 75),
    'ashglass_baby': (91, 89),
    'emerald_adult': (115, 62),
    'emerald_baby': (65, 95),
    'frost_adult': (160, 107),
    'frost_baby': (95, 135),
    'golden_adult': (112, 72),
    'moonwhisker_adult': (100, 75),
    'moonwhisker_baby': (95, 140),
    'porcelain_adult': (140, 60),
    'porcelain_baby': (95, 150),
    'redadult': (181, 117),
    'redwhelp': (119, 55),
    'rimewyrm_young': (95, 115),
    'storm_adult': (143, 106),
    'storm_baby': (85, 105),
}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'sleep-frame-strips')
os.makedirs(OUT, exist_ok=True)

chars = json.load(open(os.path.join(ROOT, 'src/data/character-anims.json')))['characters']
for cid, c in sorted(chars.items()):
    if not c.get('board') or 'idle' not in c.get('clips', {}):
        continue
    if cid not in EYES:
        print(f'{cid}: no eye position — add it to EYES and re-run')
        continue
    idle = c['clips']['idle']
    sheet = Image.open(os.path.join(ROOT, 'assets', idle['file'])).convert('RGBA')
    fw, fh, n = idle['frameWidth'], idle['frameHeight'], idle['frames']
    sheet_cols = sheet.width // fw
    ex, ey = EYES[cid]
    S = 40
    x0, y0 = max(0, ex - S), max(0, ey - S)
    x1, y1 = min(fw, ex + S), min(fh, ey + S)
    tw, th = (x1 - x0) * 2, (y1 - y0) * 2
    idxs = list(range(0, n, 2))
    cols = 12
    rows = (len(idxs) + cols - 1) // cols
    grid = Image.new('RGBA', (cols * (tw + 4), rows * (th + 16)), (18, 18, 26, 255))
    draw = ImageDraw.Draw(grid)
    for k, i in enumerate(idxs):
        sx, sy = (i % sheet_cols) * fw, (i // sheet_cols) * fh
        crop = sheet.crop((sx + x0, sy + y0, sx + x1, sy + y1)).resize((tw, th), Image.NEAREST)
        gx, gy = (k % cols) * (tw + 4), (k // cols) * (th + 16)
        grid.paste(crop, (gx, gy + 14), crop)
        draw.text((gx + 2, gy + 1), str(i), fill=(160, 255, 160, 255))
    grid.save(os.path.join(OUT, f'{cid}.png'))
    print(f'{cid}: {len(idxs)} frames -> {cid}.png')
print(f'strips in {OUT}')
