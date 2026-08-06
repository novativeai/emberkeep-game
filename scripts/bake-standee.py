#!/usr/bin/env python3
"""Bake a world-character STANDEE into drift-free runtime sheets.

  python3 scripts/bake-standee.py eleanor [--body-height 256] [--qc]
  python3 scripts/bake-standee.py --all

Reads the authored PNG sequences

  assets/sprites/characters/<id>/world-standee/<id>_idle/*.png
  assets/sprites/characters/<id>/world-standee/<id>_cast/*.png

and writes the two runtime spritesheets the game loads

  assets/sprites/<id>/world-idle.webp   (+ .png master)
  assets/sprites/<id>/world-cast.webp   (+ .png master)
  assets/sprites/<id>/world-standee.png   idle frame 0 — the still used by the
      World Builder's Characters palette and by the `char_<id>` fallback
  assets/sprites/<id>/world-standee.json  the numbers STANDEE_BANKS needs

WHY THIS EXISTS — the drift
---------------------------
The authored cells are painted independently, so nothing holds the body still
between them: Eleanor's idle translated 14 px left and 7 px up across its eight
frames, which at 12 fps reads as her SLIDING across the tile rather than
breathing on it. The cast bank had the same problem, and the two banks did not
agree with each other either, so the swap from idle to cast jumped.

Trimming each frame to its own alpha box does NOT fix this — it is what causes
it. A tight per-frame box moves with whatever the frame happens to contain, so
the raised arm in cast frame 3 and the ember bolt in frame 5 would drag her body
sideways. There must be ONE box, shared by every frame of both banks, and every
frame must be registered into it.

The registration signal is her FEET, not her bounding box. Feet are the only
part of a standee that is supposed to be nailed down — the chest rises, the hem
sways, an arm goes up, a bolt of fire leaves the crystal, and through all of it
the contact with the ground must not move by a pixel. So each frame is aligned
by the bottom band of its silhouette (the hem + shoes + ground shadow, well
below anything the spell FX ever touches), seeded by that band's centroid and
refined by an integer IoU search. Every frame of BOTH banks is registered
against ONE reference (idle frame 0), which is what makes the banks
interchangeable: `playStandeeCast` swaps the texture mid-stance and her body
does not move.

Shifts are whole pixels — a standee is painterly art and resampling it to chase
a third of a pixel costs more than the third of a pixel is worth.

THE FRAME BOX — tight union plus a thin transparent margin
----------------------------------------------------------
Once every frame is registered, the shared frame box is the tight union of all
of them, grown by OUT_PAD on every side. That box is asymmetric on purpose — the
cast's ember bolt reaches far to her left — so her feet are NOT at its
bottom-centre, and an origin of (0.5, 1) would plant the bolt's empty space on
the tile instead of her shoes. The bake therefore also emits an explicit FEET
anchor as a fraction of the frame, and BoardScene sets the sprite origin from
it. Asymmetric box, exact anchor: the two requirements stop fighting.

The margin exists because a truly tight box means every edge is FLUSH against
some frame's outermost pixel, and the outermost pixel of a spell is the soft
falloff of its glow. Flush, that falloff is sliced off square and reads as the
scepter's light being clipped by an invisible wall. The margin costs a few px of
sheet and nothing else — the anchor, the body box and `scale` are all stored
relative to the box, so padding it moves her on screen by exactly zero.

CUT SOURCE EDGES
----------------
Separately: a source frame can arrive already truncated by its own canvas, and
no box can restore pixels that were never rendered. Eleanor's cast frame 5 is
the case — 123 rows of FULLY opaque ember bolt hard against x=0, chopped when
the bank was generated. `feather_cut_edges` finds those (a long run at high
alpha, which a glow's falloff never is) and ramps them out over FEATHER px, so
the bolt reads as fading into the distance instead of hitting a wall. The BOTTOM
edge is never feathered: it is her ground contact, it defines the anchor, and it
is supposed to touch.

`scale` is derived so her BODY renders at the same on-screen height whatever the
frame box comes out as (`--body-height`, in the 2560x1600 hi-res game space).
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROD = os.path.join(ROOT, 'assets/sprites/characters')
OUT = os.path.join(ROOT, 'assets/sprites')
# The World Builder's Characters palette, for when it runs deployed (no repo).
TOOL_CHARS = os.path.join(ROOT, 'tools/worldbuilder/characters')

BANKS = ('idle', 'cast')

# Alpha at or below this is background. Generous: the de-key leaves a faint
# fringe, and a fringe pixel must not define the frame box.
ALPHA_BG = 12
# Solid enough to be body. Used for the registration mask only.
ALPHA_BODY = 40
# Bottom slice of the silhouette used to register a frame, as a fraction of the
# reference body height. ~14% is hem + shoes + contact shadow and nothing else:
# high enough to carry shape (a flat foot line alone cannot fix dx), low enough
# that no raised arm, sleeve or spell FX ever reaches into it.
BAND_FRAC = 0.14
# The band used for the ANCHOR, as a fraction of body height — much narrower,
# because the two jobs want opposite things. Registration wants shape, so it
# takes the whole hem. The anchor wants the GROUND LINE, and a hem is not it:
# Selyna's robe trails behind her and fills the right of that wide band, which
# dragged her anchor off her boots and onto her cloak. The lowest ~3% is the
# sole actually touching the floor and nothing else.
CONTACT_FRAC = 0.03
# Working canvas margin — how far a frame may be shifted before it clips.
PAD = 160
# Transparent margin kept around the output frame box, so no frame's content is
# ever flush against an edge (see "THE FRAME BOX" above). Costs 2*OUT_PAD px of
# sheet per axis and moves her on screen by nothing.
OUT_PAD = 16
# A source edge counts as CUT — rather than a glow grazing its canvas — when the
# run of alpha along it is this long AND that opaque. A falloff tapers out; a
# truncation does not. Eleanor's cast[5] bolt is 123 px at alpha 255; the next
# worst edge in either bank is 14 px at 134, which is exactly the graze we must
# NOT touch.
CUT_MIN_RUN = 32
CUT_MIN_ALPHA = 200
# How far a detected cut is ramped back to transparent.
FEATHER = 28
# Refinement window (px) around the centroid seed.
REFINE = 12
# Per-bank size sweep. The banks are separate generations, so one can come back
# a few percent smaller than the other — a translation-only fix leaves her
# POPPING between idle and cast even though her feet never move.
SCALE_SWEEP = (0.88, 1.12, 0.0025)
# Default on-screen body height, in hi-res game units (RES 2). 256 keeps the
# shipped standee exactly the size it renders at today.
DEFAULT_BODY_H = 256


def load_bank(char, bank):
    """Frames of one bank, in index order, plus its authored frames.json."""
    d = os.path.join(PROD, char, 'world-standee', f'{char}_{bank}')
    if not os.path.isdir(d):
        return None, None
    meta_path = os.path.join(d, 'frames.json')
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else None
    if meta and meta.get('frames'):
        files = [os.path.join(d, f['file']) for f in sorted(meta['frames'], key=lambda f: f['index'])]
    else:
        files = sorted(p for p in (os.path.join(d, f) for f in os.listdir(d)) if p.endswith('.png'))
    return [np.asarray(Image.open(p).convert('RGBA')) for p in files], meta


def feather_cut_edges(frame, label):
    """Ramp out any edge where this frame was TRUNCATED by its own canvas.

    Returns (frame, notes). Left/right/top only — the bottom edge is her ground
    contact and is meant to touch. Nothing here restores lost pixels; it turns a
    square chop into a taper, which is the difference between a bolt that leaves
    the frame and a bolt that hits a wall.
    """
    a = frame[..., 3]
    h, w = a.shape
    notes = []
    edges = {
        'left': (a[:, 0], lambda n: (slice(None), slice(0, n)), 1),
        'right': (a[:, -1], lambda n: (slice(None), slice(w - n, w)), -1),
        'top': (a[0, :], lambda n: (slice(0, n), slice(None)), 1)
    }
    for name, (strip, region, direction) in edges.items():
        run = int((strip > ALPHA_BG).sum())
        if run < CUT_MIN_RUN or int(strip.max()) < CUT_MIN_ALPHA:
            continue
        n = min(FEATHER, w if name != 'top' else h)
        ramp = np.linspace(0.0, 1.0, n, dtype=np.float64)
        if direction < 0:
            ramp = ramp[::-1]
        sel = region(n)
        block = frame[sel][..., 3].astype(np.float64)
        shaped = ramp[None, :] if name != 'top' else ramp[:, None]
        frame[sel[0], sel[1], 3] = np.clip(block * shaped, 0, 255).astype(np.uint8)
        notes.append(f'{name} cut {run}px -> feathered over {n}px')
    if notes:
        print(f'  ! {label}: ' + '; '.join(notes))
    return frame, notes


def place(frame, canvas_wh):
    """Drop a source frame into the padded working canvas at (PAD, PAD)."""
    cw, ch = canvas_wh
    out = np.zeros((ch, cw, 4), np.uint8)
    h, w = frame.shape[:2]
    out[PAD:PAD + h, PAD:PAD + w] = frame
    return out


def shift(a, dx, dy):
    """Whole-pixel translation on the working canvas (no resampling)."""
    out = np.zeros_like(a)
    h, w = a.shape[:2]
    sy0, sy1 = max(0, -dy), min(h, h - dy)
    sx0, sx1 = max(0, -dx), min(w, w - dx)
    out[sy0 + dy:sy1 + dy, sx0 + dx:sx1 + dx] = a[sy0:sy1, sx0:sx1]
    return out


def bbox(alpha, thr=ALPHA_BG):
    ys, xs = np.nonzero(alpha > thr)
    if not len(ys):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def foot_band(alpha, band_h):
    """Rows [bottom-band_h, bottom) of the body mask, and that slice's centroid.

    The body threshold matters here: a soft contact shadow fades out over ~20 px
    and its outer edge wanders frame to frame, so registering on `> 0` would
    chase the shadow instead of the shoes.
    """
    mask = alpha > ALPHA_BODY
    ys, xs = np.nonzero(mask)
    if not len(ys):
        return None
    bottom = int(ys.max()) + 1
    top = max(0, bottom - band_h)
    sel = ys >= top
    return {'top': top, 'bottom': bottom, 'cx': float(xs[sel].mean()), 'mask': mask}


def register(ref_alpha, alpha, band_h):
    """Integer (dx, dy) putting `alpha`'s feet on `ref_alpha`'s feet.

    Centroid + bottom row give the seed; a small exhaustive IoU search over the
    reference's foot band refines it. A seeded search is well-posed where a
    blind one is not — the silhouette repeats vertically (two legs, a hem) and a
    blind search happily locks onto the wrong stripe.
    """
    r = foot_band(ref_alpha, band_h)
    f = foot_band(alpha, band_h)
    if r is None or f is None:
        return 0, 0, 0.0
    seed = (int(round(r['cx'] - f['cx'])), r['bottom'] - f['bottom'])
    h, w = ref_alpha.shape[:2]
    y0, y1 = max(0, r['top'] - 2), min(h, r['bottom'] + 2)
    ref_band = r['mask'][y0:y1]
    bh = y1 - y0
    cm = f['mask']
    best, best_score = seed, -1.0
    # The search only ever compares the band, so only the band is materialised —
    # scoring a full 700x840 canvas 625 times over would make the scale sweep
    # below unusable.
    for dy in range(seed[1] - REFINE, seed[1] + REFINE + 1):
        a0, a1 = max(0, y0 - dy), min(h, y1 - dy)
        if a1 <= a0:
            continue
        rows = cm[a0:a1]
        for dx in range(seed[0] - REFINE, seed[0] + REFINE + 1):
            cand = np.zeros((bh, w), bool)
            if dx >= 0:
                if dx < w:
                    cand[a0 - y0 + dy:a1 - y0 + dy, dx:] = rows[:, :w - dx]
            elif -dx < w:
                cand[a0 - y0 + dy:a1 - y0 + dy, :w + dx] = rows[:, -dx:]
            union = np.count_nonzero(ref_band | cand)
            score = np.count_nonzero(ref_band & cand) / union if union else 0.0
            if score > best_score:
                best, best_score = (dx, dy), score
    return best[0], best[1], best_score


def resample(a, s):
    """Uniform resize about the canvas origin, on PREMULTIPLIED alpha.

    Straight-alpha resampling pulls the transparent background's black into
    every edge pixel and rims a de-keyed sprite with a dark halo; premultiplying
    first is the only way a 3% correction stays invisible.
    """
    if abs(s - 1.0) < 1e-6:
        return a
    f = a.astype(np.float64)
    al = f[..., 3:4] / 255.0
    pre = np.concatenate([f[..., :3] * al, f[..., 3:4]], axis=2)
    h, w = a.shape[:2]
    img = Image.fromarray(np.clip(pre, 0, 255).astype(np.uint8), 'RGBA')
    img = img.resize((max(1, int(round(w * s))), max(1, int(round(h * s)))), Image.LANCZOS)
    r = np.asarray(img).astype(np.float64)
    al2 = np.maximum(r[..., 3:4] / 255.0, 1e-6)
    out = np.zeros_like(f)
    rh, rw = r.shape[:2]
    ch, cw = min(h, rh), min(w, rw)
    out[:ch, :cw, :3] = np.clip(r[:ch, :cw, :3] / al2[:ch, :cw], 0, 255)
    out[:ch, :cw, 3] = r[:ch, :cw, 3]
    return out.astype(np.uint8)


def fit_scale(ref_alpha, alpha, band_h):
    """The uniform scale that makes this bank the same SIZE as the reference.

    Scored on the columns behind her feet — her back and cloak, the one part of
    the silhouette both banks draw identically. Her front carries the staff, and
    the staff is posed differently in every bank, so scoring the whole outline
    would fit the prop instead of the person.
    """
    r = foot_band(ref_alpha, band_h)
    rbox = bbox(ref_alpha)
    if r is None or rbox is None:
        return 1.0
    win = (slice(rbox[1], rbox[3]), slice(int(round(r['cx'])), rbox[2]))
    ref_body = (ref_alpha > ALPHA_BODY)[win]
    best, best_score = 1.0, -1.0
    lo, hi, step = SCALE_SWEEP
    h, w = alpha.shape[:2]
    for s in np.arange(lo, hi + 1e-9, step):
        src = Image.fromarray(alpha).resize(
            (max(1, int(round(w * s))), max(1, int(round(h * s)))), Image.BILINEAR)
        cand = np.zeros((h, w), np.uint8)
        sa = np.asarray(src)
        cand[:min(h, sa.shape[0]), :min(w, sa.shape[1])] = sa[:h, :w]
        dx, dy, _ = register(ref_alpha, cand, band_h)
        m = shift(cand[..., None], dx, dy)[..., 0] > ALPHA_BODY
        m = m[win]
        union = np.count_nonzero(ref_body | m)
        score = np.count_nonzero(ref_body & m) / union if union else 0.0
        if score > best_score:
            best, best_score = float(s), score
    return round(best, 4)


def encode(strip, path_png, path_webp):
    strip.save(path_png)
    strip.save(path_webp, format='WEBP', quality=92, method=6)
    return os.path.getsize(path_webp)


def bake(char, body_target, qc):
    banks = {}
    for b in BANKS:
        frames, meta = load_bank(char, b)
        if frames is None:
            print(f'  ! {char}: no {b} bank under world-standee/{char}_{b} — skipped')
            return None
        banks[b] = {'frames': frames, 'meta': meta}

    # Repair truncated source edges BEFORE anything measures them, so the union
    # box and the registration both see the tapered bolt, not the chop.
    for b in BANKS:
        banks[b]['frames'] = [
            feather_cut_edges(f.copy(), f'{char} {b}[{i}]')[0]
            for i, f in enumerate(banks[b]['frames'])
        ]

    all_frames = [f for b in BANKS for f in banks[b]['frames']]
    cw = max(f.shape[1] for f in all_frames) + 2 * PAD
    ch = max(f.shape[0] for f in all_frames) + 2 * PAD
    for b in BANKS:
        banks[b]['placed'] = [place(f, (cw, ch)) for f in banks[b]['frames']]

    # The reference every frame of both banks registers against.
    ref = banks['idle']['placed'][0]
    ref_box = bbox(ref[..., 3])
    band_h = max(8, int(round((ref_box[3] - ref_box[1]) * BAND_FRAC)))

    print(f'  reference: idle[0], body {ref_box[2] - ref_box[0]}x{ref_box[3] - ref_box[1]}, foot band {band_h}px')
    for b in BANKS:
        # One size correction for the whole bank (measured on its first frame),
        # then a per-frame translation. Order matters: fitting size per frame
        # would let the hem sway breathe her in and out.
        s = 1.0 if b == 'idle' else fit_scale(ref[..., 3], banks[b]['placed'][0][..., 3], band_h)
        aligned, report = [], []
        for i, p in enumerate(banks[b]['placed']):
            p = resample(p, s)
            dx, dy, score = (0, 0, 1.0) if (b == 'idle' and i == 0) else register(ref[..., 3], p[..., 3], band_h)
            aligned.append(shift(p, dx, dy))
            report.append((i, dx, dy, score))
        banks[b]['aligned'] = aligned
        banks[b]['scale'] = s
        drift = max(abs(dx) + abs(dy) for _, dx, dy, _ in report)
        print(f'  {b}: size x{s}, corrected up to {drift}px  ' +
              ' '.join(f'[{i}:{dx:+d},{dy:+d}]' for i, dx, dy, _ in report))

    # ONE frame box: the tight union of every registered frame, both banks, plus
    # OUT_PAD of transparent margin so no frame's content is flush against an
    # edge. Clamped to the working canvas, which PAD already made far larger.
    boxes = [bbox(f[..., 3]) for b in BANKS for f in banks[b]['aligned']]
    x0 = max(0, min(b[0] for b in boxes) - OUT_PAD)
    y0 = max(0, min(b[1] for b in boxes) - OUT_PAD)
    x1 = min(cw, max(b[2] for b in boxes) + OUT_PAD)
    y1 = min(ch, max(b[3] for b in boxes) + OUT_PAD)
    fw, fh = x1 - x0, y1 - y0

    # Feet anchor + body box, read off the (registered) reference frame. The
    # anchor uses the narrow CONTACT band, not the wide registration band.
    contact_h = max(3, int(round((ref_box[3] - ref_box[1]) * CONTACT_FRAC)))
    feet = foot_band(ref[..., 3], contact_h)
    anchor_x = (feet['cx'] - x0) / fw
    anchor_y = (feet['bottom'] - y0) / fh
    body = (ref_box[0] - x0, ref_box[1] - y0, ref_box[2] - ref_box[0], ref_box[3] - ref_box[1])
    scale = round(body_target / body[3], 4)

    out_dir = os.path.join(OUT, char)
    os.makedirs(out_dir, exist_ok=True)
    written = {}
    for b in BANKS:
        n = len(banks[b]['aligned'])
        strip = Image.new('RGBA', (fw * n, fh), (0, 0, 0, 0))
        for i, f in enumerate(banks[b]['aligned']):
            strip.paste(Image.fromarray(f[y0:y1, x0:x1]), (i * fw, 0))
        kb = encode(strip, os.path.join(out_dir, f'world-{b}.png'), os.path.join(out_dir, f'world-{b}.webp')) // 1024
        written[b] = (n, kb)
        if strip.width > 4096:
            print(f'  ! {char} world-{b} is {strip.width}px wide — over the 4096px old-device ceiling')

    still = Image.fromarray(banks['idle']['aligned'][0][y0:y1, x0:x1])
    encode(still, os.path.join(out_dir, 'world-standee.png'), os.path.join(out_dir, 'world-standee.webp'))

    fps = {b: (banks[b]['meta'] or {}).get('fps', 12 if b == 'idle' else 14) for b in BANKS}
    doc = {
        'character': char, 'frameWidth': fw, 'frameHeight': fh,
        'frameCount': len(banks['idle']['aligned']),
        'anchorX': round(anchor_x, 4), 'anchorY': round(anchor_y, 4),
        'body': {'x': body[0], 'y': body[1], 'width': body[2], 'height': body[3]},
        'scale': scale, 'fps': fps
    }
    json.dump(doc, open(os.path.join(out_dir, 'world-standee.json'), 'w'), indent=2)

    # The DEPLOYED World Builder has no repo and no dev server to read from, so
    # it carries its own copy of the still + the numbers. Refreshed here so the
    # palette can never show a standee the game no longer draws that way.
    os.makedirs(TOOL_CHARS, exist_ok=True)
    still.save(os.path.join(TOOL_CHARS, f'{char}-world-standee.webp'), format='WEBP', quality=92, method=6)
    json.dump(doc, open(os.path.join(TOOL_CHARS, f'{char}-world-standee.json'), 'w'), indent=2)

    if qc:
        qc_strip(char, banks, (x0, y0, x1, y1), feet)

    print(f'  → {char}: frame {fw}x{fh}, anchor ({doc["anchorX"]}, {doc["anchorY"]}), scale {scale}, '
          + ', '.join(f'{b} {n}f {kb}KB' for b, (n, kb) in written.items()))
    print('\n  ' + json.dumps(doc, indent=2).replace('\n', '\n  ') + '\n')
    return doc


def qc_strip(char, banks, box, feet):
    """Contact sheet with the anchor crosshair burnt in — drift is visible as
    her shoes wandering off a line that does not move."""
    x0, y0, x1, y1 = box
    fw, fh = x1 - x0, y1 - y0
    rows = len(BANKS)
    n = max(len(banks[b]['aligned']) for b in BANKS)
    sheet = Image.new('RGBA', (fw * n, fh * rows), (26, 22, 30, 255))
    for r, b in enumerate(BANKS):
        for i, f in enumerate(banks[b]['aligned']):
            sheet.alpha_composite(Image.fromarray(f[y0:y1, x0:x1]), (i * fw, r * fh))
    px = np.asarray(sheet).copy()
    ax, ay = int(round(feet['cx'] - x0)), int(round(feet['bottom'] - y0))
    for r in range(rows):
        for i in range(n):
            ox, oy = i * fw, r * fh
            px[oy:oy + fh, ox + ax] = (255, 64, 64, 255)
            px[oy + ay - 1:oy + ay + 1, ox:ox + fw] = (64, 255, 96, 255)
    # Authoring tree, not the runtime one: `sprites/characters/<id>` is pruned
    # from dist, so a QC sheet can never be shipped by accident.
    path = os.path.join(PROD, char, 'world-standee', 'qc-registration.png')
    Image.fromarray(px).save(path)
    print(f'  qc → {path}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('characters', nargs='*', default=[])
    ap.add_argument('--all', action='store_true', help='every character with a world-standee folder')
    ap.add_argument('--body-height', type=float, default=DEFAULT_BODY_H,
                    help='on-screen body height in hi-res game units (drives `scale`)')
    ap.add_argument('--qc', action='store_true', help='also write world-standee.qc.png')
    args = ap.parse_args()

    ids = args.characters
    if args.all or not ids:
        ids = sorted(c for c in os.listdir(PROD)
                     if os.path.isdir(os.path.join(PROD, c, 'world-standee')))
    if not ids:
        print('No world-standee folders found under assets/sprites/characters/.')
        return 1
    ok = 0
    for c in ids:
        print(f'{c}:')
        if bake(c, args.body_height, args.qc):
            ok += 1
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
