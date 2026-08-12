#!/usr/bin/env python3
"""Build a dragon's blink and roar-talk head banks from its rig's own head layer.

    python3 scripts/make-face-frames.py frost young
    python3 scripts/make-face-frames.py --all
    python3 scripts/make-face-frames.py storm adult --only talk --redo

Two banks per rig, in the shape `calibrate-faces.mjs` and `faceAnimations.ts`
already expect:

  blink      [open, halfOpen, closed, halfOpen2]   2600 / 45 / 70 / 55 ms
  roar_talk  [closed, half, wide, half]            267 ms each

Four steps from three drawings in each bank — `half` is played once on the way
down and once on the way back up, and the fourth file is a byte-dup of the
second, exactly as the shipped red-dragon banks are built.

FRAME 0 IS THE RIG'S OWN HEAD, COPIED VERBATIM. That is not a shortcut, it is
the thing that makes the bank safe: `calibrate-faces` derives each set's
`textureScale`/`originX/Y` from frame 0 and then PROVES the mapping against the
rig head (content-width drift ≤0.5px, silhouette IoU ≥94%). With frame 0 being
that head, the proof is exact by construction — scale 1.0000, IoU 100% — and
every other frame inherits the same framing. It is also true to the animation:
the blink's `open` and the roar's `closed` ARE the resting face.

The other three drawings come from `artgen.py edit`, one call per state, run on
the head plate itself. This is the one place in the pipeline where generating is
the wrong tool, and docs/character-pipeline.md records both failed attempts: a
generation referencing the plate re-paints the subject and lands at its own
proportions, so the frames will not composite over the face they replace. An
edit returns the same drawing with one thing changed.

Each returned frame is then registered onto the base canvas with the SAME maths
`calibrate-faces` uses — content-width scale, translated by the top-band (horn)
centroid, which is immune to the eye and jaw changes that are the whole point of
the frame. The residual is printed; anything over a pixel means look at it.
"""
import argparse
import json
import pathlib
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
DRAGONS = ROOT / 'assets/sprites/characters/dragon'
ARTGEN = ROOT / '.claude/skills/nano-banana/scripts/artgen.py'
DEKEY = ROOT / '.claude/skills/nano-banana/scripts/dekey.py'
WORK = ROOT / 'assets/raw/dragons'

A_THRESH = 16
#: Side of the square reference handed to the edit route. The route reframes
#: anything it is not given at a ratio it can return, so the plate is squared
#: and sent at --ar 1:1 rather than at its native size.
REF_PX = 1024
#: Empty margin around the head in the reference, as a fraction of REF_PX. A
#: roar drops the jaw BELOW the resting silhouette; with the head bled to the
#: edge the model has nowhere to put it and shrinks the whole face instead.
REF_MARGIN = 0.14
#: Extra canvas under the chin for the talk bank, as a fraction of the head's
#: content height. A set carries its own textureScale/origin, so a taller
#: canvas costs nothing — and without it a jaw swinging open is clipped by the
#: head layer's own bounds. (The shipped red banks are 423x521 and 857x1079
#: for exactly this reason.)
JAW_ROOM = 0.45

# Per-breed key colour. Magenta is the house key, but it cannot be used on a
# violet dragon — the de-spill would eat the animal. Same call the human
# character pipeline made for Eleanor and Selyna's costumes.
BREEDS = {
    'frost': {'key': 'FF00FF', 'kind': 'magenta'},
    'storm': {'key': 'FF00FF', 'kind': 'magenta'},
    'moonwhisker': {'key': '00FF00', 'kind': 'green'},
}

STAGES = {
    'young': {'rig': 'rig/dragon-{b}.rig.json', 'dir': 'head-animation', 'prefix': '{b}-dragon',
              'character': 'dragon-{b}'},
    'adult': {'rig': 'rig-adult/{b}-dragon.rig.json', 'dir': 'head-animation-adult',
              'prefix': '{b}-dragon-adult', 'character': 'dragon-{b}-adult'},
}

KEEP = ('Change NOTHING else whatsoever. It must be the SAME DRAWING: the same head at the '
        'same size in the same place in the frame, the same outline, the same horns, crest, '
        'spines, ears and whiskers in the same positions, the same scales, the same colours, '
        'the same shading and the same light direction. Do not redraw, restyle, re-light, '
        'recolour, rotate, move, zoom or re-centre the head. Do not add or remove anything. '
        'Leave the flat {kind} background exactly as it is, edge to edge.')

STATES = {
    'blink': [
        ('halfOpen',
         'Lower the eyelids to HALF-MAST: the upper lid comes down over the top half of each '
         'eye so the pupil is half hidden and the eye reads as a lazy, drowsy slit. The lid '
         'keeps the scale texture and colour of the brow it comes from. The eye is still '
         'clearly open — this is the middle of a blink, not a squint and not a scowl. The brow '
         'does not furrow and the expression does not change.'),
        ('closed',
         'CLOSE the eyes completely: each eye becomes a single smooth curved lid, closed and '
         'relaxed, with a fine darker crease along the seam where the lids meet. No pupil, no '
         'iris and no white showing at all. The closed lid keeps the scale texture and colour '
         'of the surrounding face. It is a calm blink — the brow does not furrow and the '
         'expression does not change.'),
    ],
    'talk': [
        ('half',
         'Open the mouth PART WAY, as if speaking: drop the lower jaw a little so a dark gap '
         'opens between the jaws and the front row of small pointed teeth shows along both '
         'lips. The tongue and the back of the throat are NOT visible. The eyes are unchanged '
         'and stay wide open. Everything above the muzzle is untouched.'),
        ('wide',
         'Open the mouth WIDE in a roar: swing the LOWER JAW ONLY downward and back, fully '
         'open, showing both rows of pointed teeth, the fangs, the tongue and the dark inside '
         'of the mouth. ONLY the lower jaw moves — it is hinged at the back of the mouth and '
         'swings down from there. The skull, the brow, the horns, the crest, the spines, the '
         'upper muzzle and the eyes do not move by a single pixel, and the eyes stay wide '
         'open. Do NOT zoom in, do NOT enlarge the head, do NOT re-centre it and do NOT add a '
         'neck, throat, shoulders or body — the head stays exactly the size it is now and '
         'exactly where it is in the frame, with all the same empty background around it.'),
    ],
}

BANKS = {
    # (dir suffix, file namer, frame durations, fps) — the Sprite Studio preset
    # cadences the shipped red-dragon banks already use.
    'blink': {
        'dir': '{prefix}-blink-animation',
        'files': ['{prefix}-eyes-open.png', '{prefix}-eyes-halfOpen.png',
                  '{prefix}-eyes-closed.png', '{prefix}-eyes-halfOpen2.png'],
        'durations': [2600, 45, 70, 55],
        'fps': 7,
        # frame index -> which drawing fills it. None = the base head.
        'source': [None, 'halfOpen', 'closed', 'halfOpen'],
        'preset': 'Blink (3-state)',
    },
    'talk': {
        'dir': '{prefix}-roar_talk-animation',
        'files': ['{prefix}-roar_talk_0000%d.png' % i for i in range(4)],
        'durations': [267, 267, 267, 267],
        'fps': 18,
        'source': [None, 'half', 'wide', 'half'],
        'preset': 'Roar / talk (mouth flap)',
    },
}


# ----------------------------------------------------------------- geometry --
def alpha_bbox(im: Image.Image) -> tuple[int, int, int, int]:
    a = np.array(im)[..., 3] > A_THRESH
    ys, xs = np.where(a)
    if not len(xs):
        sys.exit('empty alpha')
    return int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)


def top_band_centroid(im: Image.Image, box, frac: float = 0.3) -> tuple[float, float]:
    """Alpha centroid over the top of the bbox — the horn/crest region, which is
    the one part of the head an eye or jaw frame never touches."""
    x, y, w, h = box
    a = np.array(im)[..., 3].astype(np.float64)
    band = a[y:y + max(1, round(h * frac)), x:x + w]
    band = np.where(band > A_THRESH, band, 0.0)
    total = band.sum()
    yy, xx = np.mgrid[0:band.shape[0], 0:band.shape[1]]
    return x + (band * xx).sum() / total, y + (band * yy).sum() / total


def register(edit: Image.Image, base: Image.Image, canvas: tuple[int, int]) -> tuple:
    """Put `edit` onto `canvas` at `base`'s content scale and position.

    The same mapping calibrate-faces computes, applied here instead of recorded:
    width-matched scale, translated so the horn centroids coincide. `base` is
    the head already placed on the target canvas, so both live in one frame.
    """
    b_box, e_box = alpha_bbox(base), alpha_bbox(edit)
    scale = b_box[2] / e_box[2]
    b_top, e_top = top_band_centroid(base, b_box), top_band_centroid(edit, e_box)
    # out(x,y) samples edit at e_top + (p - b_top)/scale
    inv = 1.0 / scale
    coeffs = (inv, 0.0, e_top[0] - b_top[0] * inv,
              0.0, inv, e_top[1] - b_top[1] * inv)
    out = edit.transform(canvas, Image.AFFINE, coeffs, resample=Image.BICUBIC)
    o_box = alpha_bbox(out)
    # Width is the honest drift signal: a blink and a roar both leave the skull
    # exactly as wide as it was, so anything here is the model having re-framed.
    # Height is NOT drift — a dropped jaw is supposed to grow the box downward.
    return out, scale, o_box[2] - b_box[2], (o_box[1] + o_box[3]) - (b_box[1] + b_box[3])


# -------------------------------------------------------------------- steps --
def head_of(rig_path: pathlib.Path) -> Image.Image:
    import base64
    import io
    rig = json.loads(rig_path.read_text())
    layer = next((l for l in rig['layers'] if l['name'] == 'head'), None)
    if not layer:
        sys.exit(f'{rig_path}: no head layer')
    uri = (rig.get('images') or {}).get(layer['file'])
    if not uri:
        sys.exit(f'{rig_path}: rig embeds no image for {layer["file"]}')
    im = Image.open(io.BytesIO(base64.b64decode(uri.split(',', 1)[1]))).convert('RGBA')
    if im.size != (layer['width'], layer['height']):
        sys.exit(f'{rig_path}: embedded head is {im.size}, rig says {layer["width"]}x{layer["height"]}')
    return im


def reference(base: Image.Image, key: str, dest: pathlib.Path) -> None:
    """The head, contain-fit into a square and flattened onto pure key.

    Flattened rather than handed over with alpha on purpose: given a plate whose
    painterly edge fades out, the model reproduces the fade as an opaque backdrop
    that then survives de-keying. Off a hard key edge it does not.
    """
    inner = round(REF_PX * (1 - 2 * REF_MARGIN))
    s = min(inner / base.width, inner / base.height)
    art = base.resize((max(1, round(base.width * s)), max(1, round(base.height * s))), Image.LANCZOS)
    canvas = Image.new('RGBA', (REF_PX, REF_PX), tuple(int(key[i:i + 2], 16) for i in (0, 2, 4)) + (255,))
    canvas.alpha_composite(art, ((REF_PX - art.width) // 2, (REF_PX - art.height) // 2))
    canvas.convert('RGB').save(dest)


def measured_key(path: pathlib.Path) -> str:
    """The key as it came BACK, never as it was sent — a returned plate keys at
    its own magenta (#FF2DF2 and friends), and #FF00FF leaves a rim."""
    from collections import Counter
    im = Image.open(path).convert('RGB').resize((256, 256))
    r, g, b = Counter(im.getdata()).most_common(1)[0][0]
    return f'{r:02X}{g:02X}{b:02X}'


def run(cmd: list) -> None:
    proc = subprocess.run([str(c) for c in cmd], capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f'{cmd[1]} failed:\n{proc.stdout}\n{proc.stderr}')


def build(breed: str, stage: str, only: set, redo: bool) -> None:
    cfg, st = BREEDS[breed], STAGES[stage]
    prefix = st['prefix'].format(b=breed)
    rig_path = DRAGONS / f'{breed}-dragon' / st['rig'].format(b=breed)
    base = head_of(rig_path)
    work = WORK / breed / 'faces' / stage
    work.mkdir(parents=True, exist_ok=True)

    ref = work / 'reference.png'
    reference(base, cfg['key'], ref)
    print(f'== {breed} {stage}: head {base.size}, key #{cfg["key"]} -> {ref.relative_to(ROOT)}')

    drawings: dict[str, Image.Image] = {}
    for bank in ('blink', 'talk'):
        if bank not in only:
            continue
        for name, brief in STATES[bank]:
            if name in drawings:
                continue
            raw = work / f'{name}-raw.png'
            cut = work / f'{name}.png'
            if redo or not cut.exists():
                prompt = (f'{brief}\n\n{KEEP.format(kind=cfg["kind"])}')
                run(['python3', ARTGEN, 'edit', prompt, '-i', ref, '-o', raw, '--ar', '1:1'])
                run(['python3', DEKEY, raw, cut, '--key', measured_key(raw)])
            drawings[name] = Image.open(cut).convert('RGBA')

    for bank in ('blink', 'talk'):
        if bank not in only:
            continue
        spec = BANKS[bank]
        out_dir = DRAGONS / f'{breed}-dragon' / st['dir'] / spec['dir'].format(prefix=prefix)
        out_dir.mkdir(parents=True, exist_ok=True)
        names = [f.format(prefix=prefix) for f in spec['files']]

        # A set gets its own canvas — calibrate-faces stores textureScale/origin
        # PER SET, which is why the shipped red banks are 423×521 and 857×1079.
        # The talk bank is given room under the chin so a jaw that swings open
        # is not clipped by the head layer's own bounds; frame 0 still holds
        # exactly the rig head, which is what the calibration is proved against.
        room = round(alpha_bbox(base)[3] * JAW_ROOM) if bank == 'talk' else 0
        canvas = (base.width, base.height + room)
        plate = Image.new('RGBA', canvas)
        plate.alpha_composite(base, (0, 0))

        written: dict[str, str] = {}
        for i, src in enumerate(spec['source']):
            dest = out_dir / names[i]
            if src is None:
                plate.save(dest)  # frame 0 IS the rig head — the calibration's anchor
                print(f'   {names[i]:<44s} base head on {canvas[0]}x{canvas[1]}')
            elif src in written:
                shutil.copyfile(out_dir / written[src], dest)  # byte-dup, like red's halfOpen2
                print(f'   {names[i]:<44s} = {written[src]}')
            else:
                frame, scale, dw, drop = register(drawings[src], plate, canvas)
                width_pct = abs(dw) / alpha_bbox(plate)[2] * 100
                print(f'   {names[i]:<44s} scale {scale:.4f} width {dw:+d}px '
                      f'({width_pct:.1f}%) chin {drop:+d}px')
                if width_pct > 2.0:
                    sys.exit(
                        f'\n{breed} {stage} {bank}/{src}: the skull came back {width_pct:.1f}% '
                        f'wider/narrower than the head it replaces.\nThat is the model having '
                        f're-framed rather than edited — re-roll this state with --redo.\n'
                        f'Look at {(work / f"{src}-raw.png").relative_to(ROOT)} first: a zoomed '
                        f'head or an added neck is the usual cause.')
                frame.save(dest)
                written[src] = names[i]

        (out_dir / 'frames.json').write_text(json.dumps({
            'fps': spec['fps'], 'blendFrames': False,
            'width': canvas[0], 'height': canvas[1], 'frameCount': len(names),
            'frames': [{'index': i, 'file': names[i], 'durationMs': spec['durations'][i],
                        'blend': False} for i in range(len(names))]
        }, indent=2) + '\n')
        (out_dir / 'README.txt').write_text(
            f'{prefix} — {spec["preset"]}\nGenerated by scripts/make-face-frames.py\n\n'
            f'Frame 0 is the rig\'s own head layer, copied verbatim: calibrate-faces.mjs\n'
            f'derives this set\'s scale and origin from it and proves them against that\n'
            f'same head, so the mapping is exact by construction.\n\n'
            f'The other drawings are single-image EDITS of that head (artgen.py edit,\n'
            f'Nano Banana 2), de-keyed off #{cfg["key"]} and registered back onto the head\'s\n'
            f'canvas by content-width scale + top-band (horn) centroid — the same maths\n'
            f'calibrate-faces uses, which is immune to the eye and jaw changes themselves.\n'
            f'The last frame is a byte-dup of the second: the half state plays once on the\n'
            f'way down and once on the way back up.\n\n'
            f'Exact per-frame timing is in frames.json. Sources and the reference plate\n'
            f'are in assets/raw/dragons/{breed}/faces/{stage}/ (workspace only).\n')
        print(f'   -> {out_dir.relative_to(ROOT)}')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('breed', nargs='?', choices=sorted(BREEDS))
    ap.add_argument('stage', nargs='?', choices=sorted(STAGES))
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--only', default='blink,talk')
    ap.add_argument('--redo', action='store_true', help='re-generate even if a drawing is cached')
    args = ap.parse_args()
    only = set(args.only.split(','))

    jobs = ([(b, s) for b in sorted(BREEDS) for s in ('young', 'adult')] if args.all
            else [(args.breed, args.stage)])
    if not args.all and (not args.breed or not args.stage):
        ap.error('give a breed and a stage, or --all')
    for breed, stage in jobs:
        build(breed, stage, only, args.redo)


if __name__ == '__main__':
    main()
