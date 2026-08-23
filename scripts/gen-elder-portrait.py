#!/usr/bin/env python3
"""The Golden Elder's DIALOGUE BUST — the plate her talking head is animated from.

    python3 scripts/gen-elder-portrait.py pad    # cut art -> padded magenta plate
    python3 scripts/gen-elder-portrait.py gen    # outpaint the cropped horns
    python3 scripts/gen-elder-portrait.py cut    # de-key -> transparent bust
    python3 scripts/gen-elder-portrait.py plate  # green plate for anim-generate

WHAT IS BEING REPLACED

Her dialogue bubble mounts `reveal_golden_adult` — the full-body reveal plate,
a whole standing dragon with both wings out, shrunk into a 300px medallion hole.
At that size she is a gold smudge, and she is the only one of the three speakers
who does not move while she talks.

Eleanor and Selyna each get the SPLIT ring treatment: the bust is drawn twice,
a body copy masked behind the ring band and a head copy cropped at the neck
drawn above it, so the head breaks the frame. That treatment needs a BUST, and
it needs the top of the head to be intact — the head copy is the layer that
overlaps the frame, so anything cut flat at the frame edge shows.

WHY THIS IS AN OUTPAINT AND NOT A NEW DRAWING

`assets/sprites/golden-elder/rest.webp` already exists and is good: it is her
face in the merge house style, and it is what `golden_elder_blink` /
`golden_elder_talk` (sequenceCatalog.ts) are composited against. Its only defect
for ring use is the CROP — measured on the alpha, the big ram horn runs off the
top edge (25 opaque px on row 0) and the outer curve runs off the right edge for
189 rows. Redrawing her would throw away a good likeness to fix a margin.

So the source is padded into its own margin and the model is asked to CLOSE the
horn — the `edit` job (Nano Banana 2), which is the route that returns the same
drawing rather than a repaint of the same description. `--ar` matters: the pad
lands on an offered ratio (4:5) so the model has no reason to reframe.

THE KEY IS CUT BY CONNECTIVITY, NOT BY COLOUR

Same lesson as the Emberbark vase: her keyline is near-black and her deepest
neck shadows are close behind it, so a colour key wide enough to take the
background's JPEG ringing also eats the outline. Flooding from the border stops
at the keyline and never reaches an interior dark, because nothing connects one
to the edge.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
from collections import deque

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

ROOT = pathlib.Path(__file__).resolve().parent.parent
ARTGEN = ROOT / '.claude/skills/nano-banana/scripts/artgen.py'
RAW = ROOT / 'assets/raw/characters/golden-elder'
SRC = ROOT / 'assets/sprites/golden-elder/rest.webp'
PADDED = RAW / 'bust-padded.png'
GENERATED = RAW / 'bust-raw.png'
BUST = RAW / 'bust.png'
PLATE = ROOT / 'assets/raw/new-animations/plates/golden_elder-plate.png'
STILL = ROOT / 'assets/sprites/golden-elder/portrait-bust.webp'
#: De-keyed pose cells, held out of the composite folders so `composite --apply`
#: (which rewrites in place) can be re-run without regenerating them.
CELLS = RAW / 'cells'

#: Headroom above the horns, as a fraction of the silhouette's own height —
#: measured off Eleanor's shipped bust frame, which is the look being matched.
HEADROOM = 0.07
#: Side margin beyond the widest point, same units. Small: the ring's circular
#: mask trims the sides anyway, and every pixel of margin is ring window spent
#: on nothing.
SIDE_MARGIN = 0.03
#: The static fallback's height in texture px. The ring draws a bust at ~420
#: game px, and game px are already 2x logical, so this is the display size.
STILL_HEIGHT = 440

MAGENTA = (255, 0, 255)
GREEN = (0, 255, 0)
#: Sum-of-channels distance from the sampled background that still counts as
#: background. Wide enough for the JPEG ringing around a magenta field, far
#: short of the gold's darkest scale.
BG_TOLERANCE = 150
#: The pocket test's tolerance — saturated key colour only. See `plate_alpha`.
POCKET_TOLERANCE = 90

#: The pad, in source pixels. Left is small (her cheek is already inside the
#: frame); top and right are where the horn is cut. The bottom stays FLUSH —
#: a bust is meant to be cut at the chest, and the ring band covers it anyway.
PAD = {'left': 30, 'top': 132, 'right': 90, 'bottom': 0}

#: The two pose sets, and the surgical change asked of each cell. Held apart
#: because `composite.py` finds ONE moving region per set from the variance
#: across it — eyes on a blink set, muzzle on a viseme set — and a mixed folder
#: would fit one ellipse over both and swap half her face.
POSES = {
    'eyes': {
        'eyes-half': 'her upper eyelids are lowered HALFWAY over her eyes, '
                     'mid-blink, so only the bottom half of each iris shows',
        'eyes-closed': 'her eyes are FULLY CLOSED, both eyelids shut in a calm '
                       'relaxed line, no iris and no white showing at all'
    },
    'mouth': {
        'mouth-small': 'her lower jaw is open SLIGHTLY, a narrow dark gap '
                       'between her lips, as if starting to speak',
        'mouth-mid': 'her lower jaw is open MODERATELY, about half way, the '
                     'dark inside of her mouth and the tips of her lower fangs '
                     'visible, as if mid-word',
        'mouth-wide': 'her lower jaw is open WIDE, a big open mouth with the '
                      'dark throat and her fangs clearly visible, as if '
                      'speaking a long open vowel — but still speaking, not '
                      'roaring: the lips do not pull back into a snarl'
    }
}
#: Feather ellipse search window per set, as a fraction of frame height: the
#: eyes sit in the top half, the muzzle straddles the middle. Passed to
#: composite.py's `--top`, which is what stops the eye set fitting its ellipse
#: on the neck scales.
POSE_TOP = {'eyes': 0.55, 'mouth': 0.85}
#: Ellipse padding and feather per set. The eye set needs BOTH loosened: the
#: variance peak on a dragon's eye is a few hundred px, and at the default
#: feather (0.04 of frame width) the solid core came out smaller than the
#: feather itself — so nothing was fully swapped and the closed lid rendered as
#: a ghost over the open one. The muzzle set moves a quarter of the frame and
#: needs no help.
#: How many separate things each set moves — see `swap_region`. Her two eyes
#: are two lobes; her jaw is one.
POSE_LOBES = {'eyes': 2, 'mouth': 1}
#: Ellipse margin around the lobes, and the mask's feather, both as a fraction
#: of frame WIDTH. The eyes need enough to hold a whole socket and brow around
#: each peak; the muzzle needs enough for the jaw to swing down.
POSE_PAD = {'eyes': 0.085, 'mouth': 0.20}
POSE_FEATHER = {'eyes': 0.025, 'mouth': 0.045}
#: Peak-search blur and the radius blanked after each hit, as fractions of the
#: frame's short side. The blur is what makes the search find a region that
#: moved rather than the single loudest pixel of repaint noise; the blank has to
#: exceed one eye so the second lobe cannot land on the first.
PEAK_SIGMA = 0.012
PEAK_BLANK = 0.10

#: Bank frame height in the raw atlas. Chosen against the ring: the bust draws
#: at `portraitView.height` (420) game px, and staging shrinks anything more
#: than 1.25x oversampled, so authoring just above the display size is
#: authoring at the size that ships — no downscale, and no pixels paid for
#: that the screen cannot use.
FRAME_HEIGHT = 440

#: clip -> (fps, pose set, frame order). A CharacterClip has one fps and no
#: per-frame durations, so a HOLD is a repeated frame — and a repeated frame is
#: a repeated TILE in the sheet, which a still-image codec cannot dedupe. That
#: is why `blinking` runs at its own slower rate: the clip is a 2.2-second wait
#: with a three-frame blink on the end, and at 12 fps that wait cost 30 copies
#: of one drawing. At 10 it costs 22, for the same cadence and a lid that still
#: moves in 100 ms. `talking` is a jaw cadence with varied holds so it does not
#: read as a four-frame loop. Both end on a calm frame, so the loop is seamless.
_TALK = [
    'mouth-small', 'mouth-mid', 'mouth-small', 'mouth-wide', 'mouth-mid',
    'mouth-small', 'rest', 'mouth-small', 'mouth-mid', 'mouth-wide',
    'mouth-wide', 'mouth-mid', 'mouth-small', 'mouth-mid', 'mouth-small',
    'rest', 'rest', 'mouth-small', 'mouth-wide', 'mouth-mid', 'mouth-small',
    'mouth-mid', 'mouth-wide', 'mouth-mid', 'mouth-small', 'rest',
    'mouth-small', 'mouth-mid', 'mouth-small', 'mouth-wide', 'mouth-mid',
    'mouth-small', 'rest', 'rest', 'mouth-small', 'mouth-mid', 'mouth-wide',
    'mouth-small', 'rest', 'rest'
]
BANKS = {
    'blinking': (10, 'eyes', ['rest'] * 22 + ['eyes-half', 'eyes-closed', 'eyes-half']),
    'talking': (12, 'mouth', _TALK)
}

POSE_PROMPT = (
    'Edit this exact illustration. Change ONE thing: {change}. '
    'Everything else is untouched — the same dragon, the same head angle, the '
    'same position in the frame, the same size, the same horns, the same '
    'scales, the same gold-and-bronze shading and the same heavy near-black '
    'keyline. Do not re-pose the head, do not move it, do not resize it. '
    'The background stays FLAT PURE MAGENTA #FF00FF, edge to edge, no '
    'gradient, no glow, no shadow, no vignette.'
)

PROMPT = (
    'Extend this exact illustration outward into the empty magenta margin. Do '
    'not redraw, restyle or re-pose the dragon: every pixel of the existing '
    'drawing stays as it is, in the same place, at the same size. '
    'ONLY fill the margin. The large curled ram horn on the right was cut off '
    'by the old frame at the top edge and along the right edge - complete it: '
    'draw the rest of its curl and its tip, following the ribbed banding, the '
    'warm gold-to-bronze shading and the heavy near-black outline already on '
    'the visible part. Complete any crest spine or neck scale that the old '
    'frame clipped the same way. '
    'Everything that is not the dragon stays FLAT PURE MAGENTA #FF00FF, edge '
    'to edge, no gradient, no glow, no shadow, no vignette, no ground plane. '
    'Keep the heavy dark keyline unbroken all the way around the finished '
    'silhouette. The dragon must not move, shrink or grow.'
)


def cmd_pad() -> None:
    """Source art, centred in its own margin, on the key colour."""
    im = Image.open(SRC).convert('RGBA')
    w = im.width + PAD['left'] + PAD['right']
    h = im.height + PAD['top'] + PAD['bottom']
    plate = Image.new('RGB', (w, h), MAGENTA)
    plate.paste(im, (PAD['left'], PAD['top']), im)
    RAW.mkdir(parents=True, exist_ok=True)
    plate.save(PADDED)
    print(f'{PADDED.relative_to(ROOT)}  {w}x{h}  ratio {w / h:.3f} (4:5 = 0.800)')


def cmd_gen() -> None:
    if not PADDED.exists():
        sys.exit('run `pad` first')
    argv = [sys.executable, str(ARTGEN), 'edit', PROMPT, '-o', str(GENERATED),
            '-i', str(PADDED), '--ar', '4:5']
    print('artgen edit ->', GENERATED.relative_to(ROOT))
    r = subprocess.run(argv, cwd=ROOT)
    if r.returncode != 0:
        sys.exit(r.returncode)
    im = Image.open(GENERATED)
    print(f'returned {im.size[0]}x{im.size[1]}')


def plate_alpha(src: pathlib.Path) -> Image.Image:
    """Cut the subject off the key plate by CONNECTIVITY (see module docstring).

    Plus a POCKET pass, which connectivity alone cannot do: her ram horn curls
    into a closed ring, and the background trapped inside that ring touches no
    border, so the flood never reaches it and it shipped as a magenta hole.
    A pocket is cut on COLOUR at a much tighter tolerance than the flood uses —
    saturated magenta and nothing else, so no gold, no orange and none of the
    keyline can fall into it. The wide flood stays responsible for the JPEG
    ringing along the silhouette, where the colour test would be too strict.
    """
    rgb = np.array(Image.open(src).convert('RGB')).astype(np.int16)
    h, w, _ = rgb.shape
    bg = np.median(np.stack([rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1]]), axis=0)
    near = np.abs(rgb - bg).sum(axis=2) <= BG_TOLERANCE
    pocket = np.abs(rgb - bg).sum(axis=2) <= POCKET_TOLERANCE

    out = np.zeros((h, w), dtype=bool)
    q: deque = deque()
    border = [(y, x) for x in range(w) for y in (0, h - 1)]
    border += [(y, x) for y in range(h) for x in (0, w - 1)]
    for y, x in border:
        if near[y, x] and not out[y, x]:
            out[y, x] = True
            q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and near[ny, nx] and not out[ny, nx]:
                out[ny, nx] = True
                q.append((ny, nx))

    cut = out | pocket
    alpha = np.where(cut, 0, 255).astype(np.uint8)
    print(f'  background {tuple(int(v) for v in bg)} -> {out.mean() * 100:.1f}% flooded, '
          f'{(pocket & ~out).mean() * 100:.2f}% pocket')
    return Image.fromarray(np.dstack([rgb.astype(np.uint8), alpha]), 'RGBA')


def cmd_cut() -> None:
    if not GENERATED.exists():
        sys.exit('run `gen` first')
    im = plate_alpha(GENERATED)
    a = np.array(im.getchannel('A'))
    box = Image.fromarray(a).point(lambda p: 255 if p > 8 else 0).getbbox()
    if box is None:
        sys.exit('the returned plate is entirely background')
    im.save(BUST)
    h, w = a.shape
    print(f'{BUST.relative_to(ROOT)}  {w}x{h}')
    print(f'  content box {box}')
    print(f'  margins  top {box[1]}  left {box[0]}  right {w - box[2]}  bottom {h - box[3]}')
    if box[1] < 8:
        print('  WARNING: still touching the top edge — the horn did not close')


def framed() -> Image.Image:
    """The bust cropped to its final RING framing.

    The frame is what the clip inherits and what `portraitView` is tuned
    against, so it is decided once, here: content centred horizontally, a
    headroom margin of `HEADROOM` of the content height above the horns, and
    the chest running off the bottom edge. Everything downstream — the video,
    the atlas, the static fallback — is this crop.
    """
    im = Image.open(BUST).convert('RGBA')
    box = im.getchannel('A').point(lambda p: 255 if p > 8 else 0).getbbox()
    l, t, r, b = box
    pad_top = int((b - t) * HEADROOM)
    # Centre the SILHOUETTE in the frame rather than keeping the plate's own
    # margins: the ring draws the frame centred on its hole, so a bust that is
    # off-centre in its frame is off-centre in the ring.
    half = max((r + l) / 2 - l, r - (r + l) / 2) + int((r - l) * SIDE_MARGIN)
    cx = (r + l) / 2
    crop = (int(cx - half), max(0, t - pad_top), int(cx + half), im.height)
    return im.crop(crop)


def cmd_plate() -> None:
    """The wan generation plate (GREEN) plus the static ring fallback.

    Green, not black: she is gold and orange from crest to chest, with no green
    anywhere, while her keyline and her deepest neck shadows are near-black —
    exactly the animal a black plate would dissolve. `anim-ingest.py` measures
    the border and picks its keyer from it, so the choice needs no flag
    downstream.

    Unlike a board dragon's plate this is NOT padded for action room: a bust
    that grows headroom mid-clip would swim inside the ring, whose framing is a
    fixed `portraitView`. She keeps her frame and moves inside it.

    The same crop also ships as `portrait_golden_elder` — the still the ring
    mounts while her clips are still downloading, and the reason her bubble can
    stop borrowing the full-body reveal plate at all.
    """
    if not BUST.exists():
        sys.exit('run `cut` first')
    im = framed()
    plate = Image.new('RGB', im.size, GREEN)
    plate.paste(im, (0, 0), im)
    PLATE.parent.mkdir(parents=True, exist_ok=True)
    plate.save(PLATE)
    print(f'{PLATE.relative_to(ROOT)}  {im.width}x{im.height}  green')

    still = im.resize((round(im.width * STILL_HEIGHT / im.height), STILL_HEIGHT), Image.LANCZOS)
    STILL.parent.mkdir(parents=True, exist_ok=True)
    still.save(STILL, 'WEBP', quality=92, method=6)
    print(f'{STILL.relative_to(ROOT)}  {still.width}x{still.height}  static ring fallback')


def cmd_poses() -> None:
    """The pose plates her two banks are built from.

    Every pose is an `edit` of the SAME framed bust, so each one comes back as
    her face with one thing moved — and then `composite.py` swaps only the
    feathered ellipse the set actually varies in, which makes every frame
    byte-identical to the rest pose outside the eyes (or outside the muzzle).
    That is the property the whole bank rests on: a talking head assembled from
    independently painted cells shimmers, because the model re-draws the scales
    and the keyline slightly differently every time.
    """
    base = framed()
    CELLS.mkdir(parents=True, exist_ok=True)
    for group, poses in POSES.items():
        for name, instruction in poses.items():
            out = CELLS / f'{group}-{name}.png'
            raw = RAW / f'{group}-{name}-raw.png'
            # The GENERATION is what costs money, so that is what is cached —
            # the de-key is re-run every time. Deleting a cell re-cuts it;
            # deleting its raw plate is what asks the model again.
            if not raw.exists():
                src = RAW / f'{group}-{name}-plate.png'
                plate = Image.new('RGB', base.size, MAGENTA)
                plate.paste(base, (0, 0), base)
                plate.save(src)
                r = subprocess.run(
                    [sys.executable, str(ARTGEN), 'edit', POSE_PROMPT.format(change=instruction),
                     '-o', str(raw), '-i', str(src), '--ar', '4:5'],
                    cwd=ROOT)
                if r.returncode != 0:
                    sys.exit(r.returncode)
            cut = plate_alpha(raw)
            # Back to the base's own pixel grid: the edit route returns its own
            # canvas size, and composite.py works pixel-for-pixel.
            cut.resize(base.size, Image.LANCZOS).save(out)
            print(f'  {out.relative_to(ROOT)}')


def swap_region(base: np.ndarray, cells: list[np.ndarray], group: str) -> dict:
    """The ellipse a pose set moves in, fitted to the LOBES of the difference.

    This is where the route departs from nano-banana's `composite.py`, which it
    otherwise follows exactly. That script localises a single variance peak.
    Localising is right — measured on this set, a bounding box over everything
    that differs by more than 90/255 still spans 92% of the frame width,
    because the `edit` route repaints her horn banding and scale highlights
    along with the eyelid. But ONE peak is not enough: in three-quarter view her
    far eye is a fraction of the area of her near one, so the peak sits on the
    near eye and an ellipse padded around it never reaches the other. Composited
    that way she winks rather than blinks.

    So the peak search runs `lobes` times, blanking a radius around each hit
    before looking for the next, and the ellipse is the box that contains them
    all. Two lobes finds both eyes; one is the muzzle, which moves as a piece.
    """
    diff = np.zeros(base.shape[:2])
    for c in cells:
        diff = np.maximum(diff, np.abs(luma_of(c) - luma_of(base)))
    h, w = diff.shape
    diff[int(h * POSE_TOP[group]):] = 0
    # Smoothed before the search so the peak is a REGION that moved, not the one
    # pixel that moved most — repaint noise is high-frequency, an eyelid is not.
    field = gaussian_filter(diff, sigma=min(h, w) * PEAK_SIGMA)
    pts = []
    for _ in range(POSE_LOBES[group]):
        y, x = np.unravel_index(int(np.argmax(field)), field.shape)
        if field[y, x] <= 0:
            break
        pts.append((x / w, y / h))
        yy, xx = np.mgrid[0:h, 0:w]
        field[((xx - x) ** 2 + (yy - y) ** 2) < (min(h, w) * PEAK_BLANK) ** 2] = 0
    if not pts:
        sys.exit(f'{group}: no pose in this set differs from the rest frame')
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    pad = POSE_PAD[group]
    return {
        'cx': (min(xs) + max(xs)) / 2,
        'cy': (min(ys) + max(ys)) / 2,
        'rx': (max(xs) - min(xs)) / 2 + pad,
        'ry': (max(ys) - min(ys)) / 2 + pad * h / w
    }


def luma_of(a: np.ndarray) -> np.ndarray:
    return (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]) * (a[..., 3] / 255.0)


def feathered_mask(shape: tuple[int, int], region: dict, feather: float) -> np.ndarray:
    """Solid to `rx - feather`, then a smoothstep out to `rx` — the same falloff
    Sprite Studio's `makeMaskCanvas` uses, measured in a space scaled by ry/rx
    so the ease follows the ellipse rather than a circle."""
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w]
    rx, ry = region['rx'] * w, region['ry'] * h
    d = np.sqrt(((xx - region['cx'] * w) / max(rx, 1e-6)) ** 2
                + ((yy - region['cy'] * h) / max(ry, 1e-6)) ** 2)
    inner = max(0.0, 1.0 - feather * w / max(rx, 1e-6))
    t = np.clip((d - inner) / max(1.0 - inner, 1e-6), 0, 1)
    return np.clip(1 - t * t * (3 - 2 * t), 0, 1)


def cmd_composite() -> None:
    """Region-composite each pose set onto the rest pose.

    Kept apart from `poses` so the region can be re-tuned without re-billing a
    generation — the de-keyed cells live in `cells/` and are read, never
    written. Outside the mask every frame ends byte-identical to the rest pose,
    which is the whole point: the cells are independently painted, so her
    scales, her keyline and her horn banding differ by a few levels in each
    one, and a bank assembled from them raw shimmers over her whole face.
    """
    base = np.asarray(framed()).astype(np.float64)
    for group, poses in POSES.items():
        d = RAW / f'poses-{group}'
        d.mkdir(parents=True, exist_ok=True)
        cells = {n: np.asarray(Image.open(CELLS / f'{group}-{n}.png').convert('RGBA')).astype(np.float64)
                 for n in poses}
        region = swap_region(base, list(cells.values()), group)
        mask = feathered_mask(base.shape[:2], region, POSE_FEATHER[group])[..., None]
        print(f'  {group}: cx={region["cx"]:.3f} cy={region["cy"]:.3f} '
              f'rx={region["rx"]:.3f} ry={region["ry"]:.3f} — '
              f'{100 * (mask > 0).mean():.1f}% touched, {100 * (mask >= 1).mean():.1f}% swapped')
        Image.fromarray(base.astype(np.uint8)).save(d / 'rest.png')
        for name, cell in cells.items():
            comp = base * (1 - mask) + cell * mask
            Image.fromarray(comp.astype(np.uint8)).save(d / f'{name}.png')
            outside = mask[..., 0] <= 0
            worst = float(np.abs(comp[outside] - base[outside]).max())
            if worst != 0:
                sys.exit(f'{group}/{name}: the base moved outside the mask by {worst}')
        # A preview of where the swap lands, for eyeballing the fit.
        vis = base.copy()
        vis[..., 0] = np.clip(vis[..., 0] + 180 * mask[..., 0], 0, 255)
        vis[..., 3] = np.maximum(vis[..., 3], 255 * (mask[..., 0] > 0))
        Image.fromarray(vis.astype(np.uint8)).save(RAW / f'region-{group}.png')


def cmd_bake() -> None:
    """The two banks, packed as atlases in the shape apply-anim-align expects.

    A `CharacterClip` carries ONE fps, not a per-frame duration table, so a hold
    is spelled as a repeated frame — which is why `blinking` is mostly its own
    rest pose: the bank is a 2.7-second wait with three lid frames on the end,
    not a lid flapping at 12 Hz.
    """
    from math import ceil
    out_dir = ROOT / 'assets/raw/new-animations/golden_elder_atlasses'
    out_dir.mkdir(parents=True, exist_ok=True)
    animations = {}
    for clip, (fps, group, order) in BANKS.items():
        d = RAW / f'poses-{group}'
        frames = []
        for name in order:
            im = Image.open(d / f'{name}.png').convert('RGBA')
            fw = round(im.width * FRAME_HEIGHT / im.height)
            frames.append(im.resize((fw, FRAME_HEIGHT), Image.LANCZOS))
        fw, fh = frames[0].size
        cols = ceil(len(frames) ** 0.5)
        rows = ceil(len(frames) / cols)
        sheet = Image.new('RGBA', (cols * fw, rows * fh), (0, 0, 0, 0))
        for i, f in enumerate(frames):
            sheet.paste(f, ((i % cols) * fw, (i // cols) * fh))
        sheet.save(out_dir / f'{clip}.webp', 'WEBP', quality=90, method=6)
        animations[clip] = {
            'file': f'{clip}.webp', 'frames': len(frames),
            'frameWidth': fw, 'frameHeight': fh, 'cols': cols, 'rows': rows,
            'sheetWidth': cols * fw, 'sheetHeight': rows * fh,
            'fps': fps, 'loop': True
        }
        kb = (out_dir / f'{clip}.webp').stat().st_size / 1024
        print(f'  {clip}: {len(frames)}f {fw}x{fh} grid {cols}x{rows} '
              f'sheet {cols * fw}x{rows * fh}  {kb:.0f} KB')
    (out_dir / 'atlas.json').write_text(
        json.dumps({'animations': animations}, indent=2) + '\n')
    print(f'{(out_dir / "atlas.json").relative_to(ROOT)}')


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('step', choices=['pad', 'gen', 'cut', 'plate', 'poses', 'composite', 'bake'])
    args = ap.parse_args()
    {'pad': cmd_pad, 'gen': cmd_gen, 'cut': cmd_cut, 'plate': cmd_plate,
     'poses': cmd_poses, 'composite': cmd_composite, 'bake': cmd_bake}[args.step]()


if __name__ == '__main__':
    main()
