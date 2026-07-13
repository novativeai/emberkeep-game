#!/usr/bin/env python3
"""Bake the dialogue-bubble portrait assets for the animated Laurah.

Produces:
  assets/sprites/guide-characters/laurah-dragonMaster/portrait-ring.png
      512x512 procedural gold ring (outer o500, hole o400): painterly gradient
      band, cream inner trim, top specular arc, bronze lower shade, rivets and
      an ember gem at the bottom - matches the game's gold UI trim. Swappable
      in place with AI art later (same path + geometry).
  assets/sprites/laurah/disc-atlas.png
      8x6 spritesheet of 300x400 bust cutouts (natural alpha silhouette, no
      circular clip/backing) baked from the optimized Laurah frames
      (assets/sprites/laurah/): frame 0 = idle_1, 1 = idle_2, 2-6 = talk_short,
      7-21 = talk_mid, 22-41 = talk_long, 42/43 = synthesized idle blink
      (half-closed / closed). Each cell is the frame's top 95%
      height (SRC_H*0.95) — the bottom 5% (tapering overalls edge) is trimmed
      at bake time, since CharacterBubble positions her so that edge sits at
      the ring's frame line: 95% of her rises in front of the ring (popping
      out), nothing renders past the trim. Loaded by PreloadScene as the
      'laurah_disc' spritesheet; sequence timing stays in
      src/render/sequenceCatalog.ts.

Re-run after regenerating the Laurah banks with Sprite Studio (re-ingest the
optimized frames first):  python3 scripts/bake-laurah-portrait.py
"""
from PIL import Image, ImageDraw, ImageFilter
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAURAH = os.path.join(ROOT, 'assets/sprites/laurah')
RING_OUT = os.path.join(ROOT, 'assets/sprites/guide-characters/laurah-dragonMaster/portrait-ring.png')
ATLAS_OUT = os.path.join(LAURAH, 'disc-atlas.png')

# ------------------------------------------------------------------ ring
SS = 4  # supersample for crisp edges
S = 512 * SS
R_OUT = 250 * SS   # outer radius (o500 at 1x)
R_IN = 200 * SS    # hole radius (o400 at 1x)
CX = CY = S // 2

GOLD = (247, 164, 55)        # PALETTE.gold
GOLD_HI = (255, 216, 77)     # PALETTE.goldBright
GOLD_LO = (167, 98, 28)      # bronze shade
CREAM = (255, 246, 232)      # PALETTE.cream
EMBER = (232, 80, 60)        # PALETTE.lava

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

ring = Image.new('RGBA', (S, S), (0, 0, 0, 0))
px = ring.load()
mid_r = (R_OUT + R_IN) / 2
half_band = (R_OUT - R_IN) / 2
for y in range(S):
    for x in range(S):
        dx, dy = x - CX, y - CY
        r = math.hypot(dx, dy)
        if r > R_OUT or r < R_IN:
            continue
        # band profile: 0 at edges -> 1 at band centre (torus curvature)
        prof = 1.0 - abs(r - mid_r) / half_band
        # light from above: angle-driven warm gradient
        ang = math.atan2(dy, dx)                     # -pi..pi, -pi/2 = top
        light = 0.5 + 0.5 * math.cos(ang + math.pi / 2)   # 1 top, 0 bottom
        base = lerp(GOLD_LO, GOLD, 0.35 + 0.65 * light)
        col = lerp(base, GOLD_HI, (prof ** 1.6) * (0.35 + 0.65 * light))
        # darken both rims slightly for a bevel read
        edge = min(1.0, (half_band - abs(r - mid_r)) / (6.0 * SS))
        col = lerp(lerp(GOLD_LO, col, 0.55), col, edge)
        px[x, y] = (col[0], col[1], col[2], 255)

draw = ImageDraw.Draw(ring)
# thin cream trim just inside the hole edge + hairline outside the outer edge
for rr, w, c, a in [
    (R_IN + 5 * SS, 3 * SS, CREAM, 235),
    (R_OUT - 4 * SS, 2 * SS, CREAM, 140),
]:
    draw.ellipse([CX - rr, CY - rr, CX + rr, CY + rr], outline=c + (a,), width=w)

# rivets: small bright studs around the band centre (skip the gem's spot)
N_RIVETS = 10
for i in range(N_RIVETS):
    a = -math.pi / 2 + i * (2 * math.pi / N_RIVETS)
    if abs(a - math.pi / 2) < 0.45:  # leave room for the ember gem (bottom)
        continue
    rx, ry = CX + mid_r * math.cos(a), CY + mid_r * math.sin(a)
    rad = 7 * SS
    light = 0.5 + 0.5 * math.cos(a + math.pi / 2)
    body = lerp(GOLD_LO, GOLD_HI, 0.25 + 0.6 * light)
    draw.ellipse([rx - rad, ry - rad, rx + rad, ry + rad], fill=body + (255,))
    draw.ellipse([rx - rad, ry - rad, rx + rad, ry + rad],
                 outline=lerp(GOLD_LO, (90, 50, 12), 0.5) + (200,), width=2 * SS)
    hr = rad * 0.45
    draw.ellipse([rx - hr - rad * 0.2, ry - hr - rad * 0.35, rx + hr - rad * 0.2, ry + hr - rad * 0.35],
                 fill=CREAM + (220,))

# specular arc along the upper band
spec = Image.new('RGBA', (S, S), (0, 0, 0, 0))
sd = ImageDraw.Draw(spec)
sd.arc([CX - mid_r, CY - mid_r, CX + mid_r, CY + mid_r],
       start=200, end=280, fill=(255, 255, 255, 165), width=int(half_band * 0.62))
spec = spec.filter(ImageFilter.GaussianBlur(9 * SS))
ring = Image.alpha_composite(ring, spec)

# ember gem at the bottom centre: teardrop-ish flame stone in a gold seat
gem = Image.new('RGBA', (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(gem)
gx, gy = CX, CY + mid_r
seat = 26 * SS
gd.ellipse([gx - seat, gy - seat, gx + seat, gy + seat], fill=lerp(GOLD, GOLD_LO, 0.25) + (255,))
gd.ellipse([gx - seat, gy - seat, gx + seat, gy + seat], outline=GOLD_LO + (255,), width=3 * SS)
gr = 17 * SS
gd.ellipse([gx - gr, gy - gr, gx + gr, gy + gr], fill=EMBER + (255,))
gd.ellipse([gx - gr, gy - gr, gx + gr, gy + gr], outline=(140, 30, 25, 255), width=2 * SS)
gd.ellipse([gx - gr * 0.55, gy - gr * 0.75, gx + gr * 0.15, gy - gr * 0.05], fill=(255, 200, 120, 235))
ring = Image.alpha_composite(ring, gem)

# mask everything back to the annulus (spec blur bleeds), then downsample
mask = Image.new('L', (S, S), 0)
md = ImageDraw.Draw(mask)
md.ellipse([CX - R_OUT, CY - R_OUT, CX + R_OUT, CY + R_OUT], fill=255)
md.ellipse([CX - R_IN, CY - R_IN, CX + R_IN, CY + R_IN], fill=0)
# gem seat pokes slightly past the band - add it back to the mask
md.ellipse([gx - seat, gy - seat, gx + seat, gy + seat], fill=255)
ring.putalpha(mask)
ring = ring.resize((512, 512), Image.LANCZOS)
os.makedirs(os.path.dirname(RING_OUT), exist_ok=True)
ring.save(RING_OUT)
print('ring  ->', os.path.relpath(RING_OUT, ROOT), ring.size)

# ------------------------------------------------------------------ discs
# Full bust cutout (already alpha-isolated by Sprite Studio — no circular clip,
# no backing disc). Only the bottom 5% of the 398x560 canvas (the tapering
# edge of her overalls) is trimmed off: that sliver is the part meant to sit
# UNDER the gold ring in-game (CharacterBubble positions her so 95% of this
# crop rises IN FRONT of the frame, popping out; the ring's own band covers
# whatever would have been below the trim).
SRC_W, SRC_H = 398, 560
BOTTOM_KEEP = 0.95
CROP_H = round(SRC_H * BOTTOM_KEEP)
# Matches the ~380px display height (see CharacterBubble) at near-1:1, keeping
# decoded atlas memory close to the old 256x256 sheet's ~12.6MB (old-device
# budget — see docs memory old-device-asset-budget) rather than doubling it.
CELL_W, CELL_H = 300, 400  # matches the 398x532 crop aspect closely
BANKS = [
    ('idle', ['idle_1.png', 'idle_2.png']),
    ('talk_short', [f'talk_short/{i}.png' for i in range(5)]),
    ('talk_mid', [f'talk_mid/{i}.png' for i in range(15)]),
    ('talk_long', [f'talk_long/{i}.png' for i in range(20)]),
]
files = [f for _, fs in BANKS for f in fs]

# ---- synthesized BLINK frames (42 = half-closed, 43 = closed) -------------
# No bank ships closed-eye art, so each eye gets a painted LID: a feathered
# ellipse of smooth skin (sampled from the clean cheek below the eye, with a
# soft top-light gradient) sweeping down over the eye, finished with a
# downward-bowed lash line. lid_frac 0.55 leaves the lower iris/lash sliver
# visible (half blink); 1.0 covers the whole eye (closed).
EYES = [(145, 172, 228, 236), (250, 178, 322, 240)]  # x0,y0,x1,y1 per eye (src px)

def blink_variant(src_img, lid_frac):
    import numpy as np
    arr = np.array(src_img.convert('RGBA')).astype(float)
    out = arr.copy()
    for (x0, y0, x1, y1) in EYES:
        w, h = x1 - x0, y1 - y0
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        # lid skin tone: median of the clean cheek band just below the eye
        cheek = arr[y1 + 6:y1 + 14, x0 + 6:x1 - 6, :3]
        base = np.median(cheek.reshape(-1, 3), axis=0)
        yy, xx = np.mgrid[y0:y1, x0:x1]
        # eye ellipse (slightly inset so the feather lands on socket skin)
        ex = (xx - cx) / (w * 0.52)
        ey = (yy - cy) / (h * 0.56)
        inside = ex * ex + ey * ey <= 1.0
        # lid coverage: from the ellipse top down to lid_frac of its height,
        # with a gentle downward bow (deeper at the centre, like a real lid)
        bow = 0.12 * (1.0 - np.clip(np.abs(ex), 0, 1) ** 2)
        lid_edge = (yy - y0) / h <= (lid_frac + bow) if lid_frac < 1.0 else np.ones_like(inside)
        lid = inside & lid_edge
        # feathered alpha at the ellipse rim so the lid melts into the socket
        rim = np.clip((1.0 - (ex * ex + ey * ey)) * 6.0, 0, 1)
        a = np.where(lid, rim, 0.0)
        # top-light gradient down the lid
        grad = 1.05 - 0.16 * np.clip((yy - y0) / h, 0, 1)
        col = np.clip(base[None, None, :] * grad[..., None], 0, 255)
        region = out[y0:y1, x0:x1, :3]
        out[y0:y1, x0:x1, :3] = region * (1 - a[..., None]) + col * a[..., None]
        out[y0:y1, x0:x1, 3] = np.maximum(out[y0:y1, x0:x1, 3], (a > 0.4) * 255)
    img = Image.fromarray(out.astype(np.uint8))
    # lash line: a downward arc at each lid's closing edge
    d = ImageDraw.Draw(img)
    for (x0, y0, x1, y1) in EYES:
        h = y1 - y0
        ly = y0 + h * (min(lid_frac, 1.0) * 0.82)
        sag = h * 0.22
        d.arc([x0 + 3, ly - sag, x1 - 3, ly + sag], start=15, end=165,
              fill=(74, 38, 36, 255), width=4)
    return img

idle_src = Image.open(os.path.join(LAURAH, 'idle_1.png')).convert('RGBA')
BLINKS = [blink_variant(idle_src, 0.55), blink_variant(idle_src, 1.0)]

COLS, ROWS = 8, 6  # 42 bank frames + 2 blink frames, row-major
total = len(files) + len(BLINKS)
assert total <= COLS * ROWS, f'{COLS}x{ROWS} grid too small for {total} frames'
atlas = Image.new('RGBA', (COLS * CELL_W, ROWS * CELL_H), (0, 0, 0, 0))
def paste_cell(img, i):
    crop = img.crop((0, 0, SRC_W, CROP_H)).resize((CELL_W, CELL_H), Image.LANCZOS)
    atlas.paste(crop, ((i % COLS) * CELL_W, (i // COLS) * CELL_H), crop)
for i, f in enumerate(files):
    paste_cell(Image.open(os.path.join(LAURAH, f)).convert('RGBA'), i)
for j, img in enumerate(BLINKS):
    paste_cell(img, len(files) + j)
atlas.save(ATLAS_OUT)
print('atlas ->', os.path.relpath(ATLAS_OUT, ROOT), atlas.size,
      f'{total} frames @ {CELL_W}x{CELL_H} (42=blink-half, 43=blink-closed)')
