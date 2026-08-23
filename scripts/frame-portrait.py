#!/usr/bin/env python3
"""Frame a speaker in the dialogue ring — measured against the ring, not by eye.

    python3 scripts/frame-portrait.py scan
    python3 scripts/frame-portrait.py solve golden_elder
    python3 scripts/frame-portrait.py preview golden_elder:372:-162:0.58 eleanor

WHAT THE THREE NUMBERS ARE. A speaker with `stage: "portrait"` clips is drawn
in the gold ring as TWO synced copies of the same sheet (CharacterBubble):
the whole frame BEHIND the ring band, clipped to the mask circle, and a second
copy cropped at the neck ABOVE it, so only the head ever overlaps the frame.
`character-anims.json`'s `portrait` block aims that: `height` (the frame's
display height, which sets the scale), `dy` (the frame's TOP edge relative to
ring centre) and `headCrop` (the texture row, as a fraction, where the copy
drawn above the band stops).

WHY THIS IS A MEASUREMENT AND NOT A TASTE. The ring is a fixed piece of
geometry — a 300px frame whose window is 200/512 of its canvas and whose outer
edge, where the mask cuts, is 247/512 — so "is the speaker IN the circle" is a
question with a number behind it:

  headWidth   the head's display half-width as a fraction of the MASK radius.
              Above 100% the mask slices the bust flat and the head spills past
              the frame; the shipped humans sit at 88% (Eleanor) and 94%
              (Selyna), which is what "her hair breaks the frame a little"
              measures as.
  coverage    how much of the ring's WINDOW the art actually fills. The moss
              backing shows through wherever it does not: Eleanor 98%,
              Selyna 90%.
  seam        at the crop row the silhouette must be inside the mask circle,
              or the cut is a visible straight edge in mid-air.

`solve` sweeps (height, dy) for the framing that fills the most window while
keeping headWidth under the cap, and reports the seam. The art is read at
frame 0 of the BLINKING sheet — a rest pose, which is what the ring shows most.
"""
import json
import math
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANIMS_PATH = os.path.join(ROOT, 'src/data/character-anims.json')

# CharacterBubble.ts — keep in step with RING_SIZE and the two radii it derives.
RING_SIZE = 300.0
R_HOLE = RING_SIZE * 200 / 512   # the transparent window the bust rises through
R_MASK = RING_SIZE * 247 / 512   # the ring's outer edge, where the body copy is cut
ALPHA_MIN = 24                   # what counts as painted
HEAD_WIDTH_CAP = 0.98            # of R_MASK — above this the mask slices the head
SEAM_MARGIN = 4.0                # display px of silhouette clearance at the crop row


def anims():
    return json.load(open(ANIMS_PATH))['characters']


def sheet_frame(entry, clip='blinking', index=0):
    c = entry['clips'][clip]
    sh = Image.open(os.path.join(ROOT, 'assets', c['file'])).convert('RGBA')
    fw, fh = c['frameWidth'], c['frameHeight']
    cols = max(1, sh.width // fw)
    cx, cy = index % cols, index // cols
    return sh.crop((cx * fw, cy * fh, cx * fw + fw, cy * fh + fh)), fw, fh


def halfwidths(frame):
    """max |x - centre| of painted pixels, per texture row."""
    a = frame.getchannel('A')
    px = a.load()
    w, h = a.size
    mid = (w - 1) / 2.0
    out = []
    for y in range(h):
        lo = hi = None
        for x in range(w):
            if px[x, y] >= ALPHA_MIN:
                if lo is None:
                    lo = x
                hi = x
        out.append(0.0 if lo is None else max(abs(lo - mid), abs(hi - mid)))
    return out


def coverage(frame, s, dy, step=2.0):
    """fraction of the ring WINDOW that the art paints."""
    a = frame.getchannel('A')
    px = a.load()
    w, h = a.size
    mid = (w - 1) / 2.0
    inside = hit = 0
    y = -R_HOLE
    while y <= R_HOLE:
        x = -R_HOLE
        while x <= R_HOLE:
            if x * x + y * y <= R_HOLE * R_HOLE:
                inside += 1
                tx, ty = mid + x / s, (y - dy) / s
                if 0 <= tx < w and 0 <= ty < h and px[int(tx), int(ty)] >= ALPHA_MIN:
                    hit += 1
            x += step
        y += step
    return hit / max(1, inside)


def seam_clearance(hw, s, dy, crop_row):
    """display px between the silhouette and the mask circle at the crop row.
    Negative means the cut lands outside the frame — a visible straight edge."""
    yr = dy + s * crop_row
    if abs(yr) >= R_MASK:
        return -999.0
    return math.sqrt(R_MASK * R_MASK - yr * yr) - s * hw[crop_row]


def report(name, entry, height, dy, crop):
    frame, fw, fh = sheet_frame(entry)
    hw = halfwidths(frame)
    s = height / fh
    crop_row = int(round(crop * fh))
    head = max(hw[: crop_row + 1]) if crop_row else 0.0
    rows = [y for y, v in enumerate(hw) if v > 0]
    crown = rows[0] if rows else 0
    return {
        'name': name, 'height': height, 'dy': dy, 'headCrop': crop,
        'scale': s, 'headWidth': s * head / R_MASK, 'coverage': coverage(frame, s, dy),
        'seam': seam_clearance(hw, s, dy, min(crop_row, fh - 1)),
        'crownRingY': dy + s * crown, 'frame': (fw, fh),
    }


def line(r):
    return (f"{r['name']:14s} height={r['height']:4.0f} dy={r['dy']:5.0f} headCrop={r['headCrop']:.2f}"
            f"  headWidth={r['headWidth'] * 100:5.1f}%  window={r['coverage'] * 100:5.1f}%"
            f"  seam={r['seam']:+6.1f}px  crown={r['crownRingY']:+6.1f}")


def cmd_scan(names):
    A = anims()
    who = names or [k for k, v in A.items() if v.get('portrait')]
    print(f"ring: window R={R_HOLE:.1f}  mask R={R_MASK:.1f}\n")
    for n in who:
        v = A[n].get('portrait')
        if not v:
            print(f'{n}: no portrait view')
            continue
        print(line(report(n, A[n], v['height'], v['dy'], v['headCrop'])))


def cmd_solve(name):
    A = anims()
    entry = A[name]
    v = entry.get('portrait') or {'headCrop': 0.5}
    crop = v['headCrop']
    frame, fw, fh = sheet_frame(entry)
    hw = halfwidths(frame)
    crop_row = int(round(crop * fh))
    head = max(hw[: crop_row + 1])
    best = []
    for height in range(int(fh * 0.6), int(fh * 1.2), 4):
        s = height / fh
        if s * head / R_MASK > HEAD_WIDTH_CAP:
            continue
        for dy in range(-int(fh * 0.55), -int(fh * 0.25), 2):
            if seam_clearance(hw, s, dy, min(crop_row, fh - 1)) < SEAM_MARGIN:
                continue
            best.append((coverage(frame, s, dy), height, dy))
    best.sort(reverse=True)
    if not best:
        print(f'{name}: nothing satisfies headWidth <= {HEAD_WIDTH_CAP:.0%} with an invisible seam')
        return
    print(f"ring: window R={R_HOLE:.1f}  mask R={R_MASK:.1f}   head halfwidth {head:.0f}px of a {fw}x{fh} frame\n")
    for cov, height, dy in best[:8]:
        print(line(report(name, entry, height, dy, crop)))
    _, height, dy = best[0]
    print(f'\n  "portrait": {{ "height": {height}, "dy": {dy}, "headCrop": {crop} }}')


def compose(name, height, dy, crop, index=0, bg=(150, 120, 110), ss=3):
    """The scene's own compositor, offline: moss backing, body copy under the
    mask, the ring art, then the head copy over everything."""
    A = anims()
    art, fw, fh = sheet_frame(A[name], index=index)
    s = height / fh
    W = H = int(RING_SIZE * 1.8) * ss
    cx = cy = W // 2
    canvas = Image.new('RGBA', (W, H), bg + (255,))
    d = ImageDraw.Draw(canvas)
    d.ellipse([cx - (R_HOLE + 6) * ss, cy - (R_HOLE + 6) * ss,
               cx + (R_HOLE + 6) * ss, cy + (R_HOLE + 6) * ss], fill=(0x3E, 0x74, 0x5B, 255))
    d.ellipse([cx + 2 * ss - (R_HOLE - 10) * ss, cy - 10 * ss - (R_HOLE - 10) * ss,
               cx + 2 * ss + (R_HOLE - 10) * ss, cy - 10 * ss + (R_HOLE - 10) * ss], fill=(0x54, 0x92, 0x70, 255))
    dw, dh = int(round(fw * s * ss)), int(round(fh * s * ss))
    scaled = art.resize((dw, dh), Image.LANCZOS)
    x0, y0 = cx - dw // 2, cy + int(round(dy * ss))
    body = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    body.alpha_composite(scaled, (x0, y0))
    mask = Image.new('L', (W, H), 0)
    ImageDraw.Draw(mask).ellipse([cx - R_MASK * ss, cy - R_MASK * ss, cx + R_MASK * ss, cy + R_MASK * ss], fill=255)
    canvas.alpha_composite(Image.composite(body, Image.new('RGBA', (W, H), (0, 0, 0, 0)), mask))
    ring = Image.open(os.path.join(ROOT, 'assets/sprites/ui/portrait-ring.webp')).convert('RGBA')
    rs = int(RING_SIZE * ss)
    canvas.alpha_composite(ring.resize((rs, rs), Image.LANCZOS), (cx - rs // 2, cy - rs // 2))
    canvas.alpha_composite(scaled.crop((0, 0, dw, int(round(crop * fh * s * ss)))), (x0, y0))
    return canvas.convert('RGB').resize((W // ss, H // ss), Image.LANCZOS)


def cmd_preview(specs, out):
    A = anims()
    tiles = []
    for spec in specs:
        parts = spec.split(':')
        name = parts[0]
        v = A[name].get('portrait') or {}
        height = float(parts[1]) if len(parts) > 1 else v['height']
        dy = float(parts[2]) if len(parts) > 2 else v['dy']
        crop = float(parts[3]) if len(parts) > 3 else v['headCrop']
        tiles.append((compose(name, height, dy, crop), f'{name} {height:.0f}/{dy:.0f}/{crop}'))
    tw, th = tiles[0][0].size
    c = Image.new('RGB', (len(tiles) * (tw + 16) + 16, th + 36), (18, 18, 24))
    d = ImageDraw.Draw(c)
    x = 16
    for im, t in tiles:
        c.paste(im, (x, 28))
        d.text((x + 4, 10), t, fill=(255, 215, 120))
        x += tw + 16
    c.save(out)
    print(out)


if __name__ == '__main__':
    argv = sys.argv[1:]
    cmd = argv[0] if argv else 'scan'
    if cmd == 'scan':
        cmd_scan(argv[1:])
    elif cmd == 'solve':
        cmd_solve(argv[1])
    elif cmd == 'preview':
        out = os.environ.get('PREVIEW_OUT', os.path.join(ROOT, 'ring-preview.png'))
        cmd_preview(argv[1:], out)
    else:
        print(__doc__)
        sys.exit(2)
