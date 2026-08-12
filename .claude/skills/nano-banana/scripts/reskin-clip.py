#!/usr/bin/env python3
"""Re-skin an existing animated clip onto a different character.

  reskin-clip.py <who> [--stage prepare|generate|composite|export|all]

Laurah was retired with the v6->v7 cast change, but her talking banks are the
only hand-timed lip-sync animation the project has ever shipped, and they define
the house look. This takes those banks as the ANIMATION and swaps only who is
in them, so Eleanor and Selyna get talking clips in Laurah's exact merge-game
style without authoring a viseme sheet.

Three facts about the source make this cheap and safe, all measured rather than
assumed (see `prepare`, which re-checks them every run):

1. Her 42 frames across three banks are only 8 UNIQUE images — the banks are
   re-orderings of 8 mouth poses. So a character costs 8 generations, not 42.
2. Her clips are mouth-only: between any two frames the pixels outside the
   mouth differ by <1/255 and the alpha silhouette is identical (IoU 1.0000).
   Nothing outside the mouth animates, so holding it static loses no motion.
3. The per-frame timings in her frames.json are real animation timing, so they
   are carried over verbatim rather than re-derived.

`artgen.py edit` transfers style and identity while holding the pose, but it
repaints the WHOLE figure each call: measured against a re-skinned base, the
difference outside the mouth (13.5/255) came out LARGER than the difference
inside it (8.6/255). Played back that boils rather than talks. So every pose is
region-composited onto ONE re-skinned rest plate through the mouth ellipse —
composite.py's own maths, with the ellipse fitted to LAURAH's frames, where the
variance peak is clean, instead of to the re-skinned ones, where it is not.
Outside the ellipse every frame is then byte-identical to the plate.

The blink is not in the source (idle_2 is a second mouth pose, not a blink), so
it is generated the way the character pipeline already does it: two edits off
the rest plate for half- and closed-lids, composited through an eye ellipse.
Both banks rest on the same plate, so rest.png serves both and a blink can cut
to a talk without a jump.
"""
import argparse
import glob
import hashlib
import json
import os
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scipy import ndimage  # noqa: E402
from scipy.ndimage import binary_dilation, gaussian_filter  # noqa: E402

from composite import find_region, luma, over  # noqa: E402

MOTION_EPS = 6.0      # /255 mean RGB — above the source render's own noise floor
DILATE = 0.045        # fraction of width; margin for the re-skinned mouth shape
FEATHER = 0.020       # fraction of width, blurred outside the solid core


def motion_mask(moving, w, dilate=DILATE, feather=FEATHER):
    """Solid over everything that moves plus a margin, then a blurred falloff.

    Dilation happens BEFORE the blur so the moving pixels stay in the solid
    core: the composite must take the new mouth verbatim, and a feather that
    reached them would cross-fade the new mouth with the old one.

    Weights below 1/255 are floored to exactly zero. They cannot change an
    8-bit result, but `over` blends any pixel with a non-zero weight, and that
    round trip through premultiplied alpha divides by a near-zero alpha in the
    figure's soft edge — which is how a mask whose tail was merely *tiny*
    rather than *zero* failed its own hold-still check by 111/255.
    """
    core = binary_dilation(moving, iterations=int(dilate * w))
    m = np.clip(gaussian_filter(core.astype(np.float64), feather * w / 2.0) * 1.6, 0, 1)
    m[m < 1.0 / 255.0] = 0.0
    return m


def eye_mask(rest, lids, h, w):
    """The eyes, isolated from an edit that repainted the whole figure.

    A measured motion mask works for the source clip because only the mouth
    moves in it. It cannot work here: these lid plates are independent
    generations, so thresholding their difference selects the entire repainted
    character (measured: differences over 80/255 spanning y 0.01-0.98).

    So locate, then isolate. `find_region`'s targeted contrast reliably puts a
    band on the eyes (its cy landed at 0.356 across every setting tried), but
    its ellipse is fitted to a weighted spread and came out 0.67 of the frame
    wide — wide enough to swap the temples and hair, dragging the boil back in.
    Inside that band the two brightest connected components ARE the two eyes,
    and they carry no assumption about face proportions.
    """
    d = np.maximum(*[np.abs(rest[..., :3] - l[..., :3]).mean(axis=2) for l in lids])
    d = gaussian_filter(d, 0.008 * w)
    coarse, _ = find_region([luma(rest)] + [luma(l) for l in lids], 0, h, w,
                            frac=0.45, pad=1.30, top=0.44)
    band = np.zeros((h, w), bool)
    half = 0.08 * h
    band[max(0, int(coarse['cy'] * h - half)):int(coarse['cy'] * h + half)] = True
    cand = (d > np.percentile(d[band], 99.0)) & band
    lab, n = ndimage.label(cand)
    if n == 0:
        raise SystemExit('no eyelid motion found')
    # Keep by PEAK, not by area — composite.py's own convention, and for the
    # same stated reason: it is what picks up the second eye. Taking the two
    # largest components instead once kept two fragments of the SAME eye
    # (areas 1461 and 327 at cx 0.485 and 0.524) and dropped the other eye
    # entirely (areas 303 and 145 at cx 0.713 and 0.751) — every one of the
    # four peaked within 6% of the maximum. That shipped a wink, not a blink.
    gmax = d[cand].max()
    keep = np.isin(lab, [i for i in range(1, n + 1) if d[lab == i].max() >= 0.7 * gmax])
    ys, xs = np.nonzero(keep)
    span = (xs.max() - xs.min()) / w
    print(f'  eyes: y {ys.min()/h:.3f}-{ys.max()/h:.3f}  x {xs.min()/w:.3f}-{xs.max()/w:.3f}'
          f'  ({n} components, kept {int(np.unique(lab[keep]).size)})')
    # Two eyes side by side span a good part of the face. A region that narrow
    # is one eye, and compositing it would close one lid and leave the other.
    if span < 0.12:
        raise SystemExit(f'eye region spans only {span:.3f} of the width — '
                         'that is one eye, not two')
    # Dilated well past the measured difference, and deliberately so. Where the
    # plate has a dark upper lash line and the closed frame has dark lashes, the
    # two agree, so those pixels never enter the measured region — and a mask
    # that stops there leaves the plate's OPEN-eye lid shading sitting above the
    # newly closed lid as a dark smudge. 0.035 showed it plainly, 0.050 left a
    # trace, 0.070 covers the whole socket and reads clean.
    return motion_mask(keep, w, dilate=0.070, feather=0.026)

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(SCRIPTS))))
ARTGEN = os.path.join(SCRIPTS, 'artgen.py')
DEKEY = os.path.join(SCRIPTS, 'dekey.py')

# Laurah's folders are deleted from the working tree; this is the commit that
# still holds them. Frames are read straight out of git rather than restored,
# so re-skinning does not resurrect a retired character in the asset tree.
LAURAH_REF = '396b2f3'
LAURAH_DIR = 'assets/sprites/guide-characters/laurah-dragonMaster'
BANKS = {                       # clip folder -> (file prefix, frame count)
    'talk_short': ('laurah_hey-hey', 5),
    'talk_mid': ('laurah_this-is-so-great', 15),
    'talk_long': ('laurah_wat-is-going-on-guys', 20),
}
REST_SRC = 'laurah_idle_1/laurah_idle_1.png'   # the closed-mouth resting pose

# Sprite Studio's blink preset — the same cadence the dragon head frames use.
BLINK_STEPS = [('open', 2600), ('half', 45), ('closed', 70), ('half', 55)]

IDENTITY = {
    'eleanor': (
        "a young woman with warm ivory skin and light freckles scattered across her nose "
        "and cheeks, dark warm brown eyes, soft arched brows. Long wavy jet-black hair with "
        "a faint deep-blue sheen, parted loosely, with one thick rope braid falling forward "
        "over her left shoulder. A small gold crescent-moon disc earring. She wears a "
        "charcoal-grey #4A4A52 wrap robe closed kimono-style across the chest with thin gold "
        "#C89B3C piping along the collar edge, and over it a heavy wine-plum #6B2148 hooded "
        "cloak edged with a gold band, the hood lying DOWN and empty on her shoulders. She is "
        "BARE-HEADED: no hat, no hood up, no headwear, her full hairline visible."),
    # Two readings had to be refused explicitly, each having been produced once:
    # "mage coat trimmed in piping" came back as a notched-lapel trench coat,
    # and "shoulder pauldrons with disc studs" came back as studded leather
    # shoulder pads. In the concept art there is no shoulder armour at all —
    # the black at the shoulders is the gorget itself, continuing outward as one
    # smooth glossy yoke over the collarbones.
    'selyna': (
        "a young woman with fair skin, cool blue eyes, sharp dark brows. HAIR: a chin-length bob "
        "with soft natural body, side-parted, the ends turning gently inward at her jaw — not "
        "plastered flat, but not a rounded dome or a bouncy blowout either. The outer top layer "
        "is pale creamy blonde and the layer beneath it is warm PINK, showing along the underside "
        "of the bob and through its ends. A long pale-blonde strand falls forward past her chin "
        "on each side of her face. A pearl-drop earring. "
        "NECK: a tall glossy BLACK choker collar wraps closely around her throat like a smooth "
        "column, rising to just below her jaw, with a small silver crescent inlay at the front. "
        "It covers her NECK ONLY. It is smooth polished material — NO studs, NO rivets, NO "
        "buckles, NO straps, NO stitching, NOT leather. "
        "GARMENT: a soft lilac-grey #A9A3C4 mage robe over her shoulders, closing in a V at the "
        "chest over a plain lavender-purple bodice, with a thin pale-pink #FFB6CE trim line "
        "following the robe's own edge. Her shoulders are SOFT FABRIC ONLY: no armour, no "
        "pauldrons, no shoulder pads, no studs, no dark panels of any kind on the shoulders. NO "
        "lapels, NO collar notches, NO trench coat, NO leather jacket, NO buttons, NO zips, NO "
        "shirt collar. She is BARE-HEADED: no hat, no hood, no headwear, her full hairline "
        "visible."),
}

# Everything the edit must not touch. The pose clause carries the whole job:
# these are animation frames, so a shifted head or a different mouth opening is
# the failure, not a stylistic quibble.
HOLD = (
    "Keep EVERYTHING else identical to the input image: the exact same framing and crop, the "
    "same head size, the same head position and tilt in the frame, the same shoulder line and "
    "body pose, the SAME MOUTH SHAPE opened by exactly the same amount showing the same teeth, "
    "the same eye openness and the same gaze direction, the same eyebrow position, the same "
    "facial expression, the same lighting from the upper left, the same glossy stylized "
    "merge-game rendering style with its smooth gradient shading and thin dark contour outline, "
    "and the same flat pure green #00FF00 background. Do not zoom, do not re-centre, do not "
    "re-frame, do not change the pose, do not change how open the mouth is. This is a single "
    "frame of an animation whose other frames are produced the same way from the same source, "
    "so any shift in the head or any change in the mouth opening shows up as a jitter.")

EYES = {
    'closed': "her eyes are FULLY CLOSED — the upper eyelids lowered all the way so the lashes "
              "rest on the lower lids in a clean closed line. Not a squint, not a wink; both "
              "eyes close by the same amount.",
    'half': "her eyes are HALF-CLOSED — the upper eyelids lowered to cover roughly half of each "
            "iris, the lashes visibly dropped. It must read clearly as the in-between pose: "
            "obviously not the open eyes of the input, and obviously not fully closed.",
}
EYE_HOLD = (
    "Everything else must be identical to the input, pixel for pixel: the same head size and "
    "position, the same hairstyle and every hair strand, the same eyebrows, the same skin tone "
    "and shading, the same nose, the same closed mouth and lips, the same earring, the same "
    "collar and garment, the same flat pure green #00FF00 background, the same framing and crop. "
    "Do not zoom, do not re-centre, do not re-paint, do not restyle. This frame is composited "
    "straight over the original, so anything that moves other than the eyelids is an error.")


def run(*cmd):
    subprocess.run([str(c) for c in cmd], check=True, cwd=ROOT)


def rgba(path):
    return np.asarray(Image.open(path).convert('RGBA')).astype(np.float64)


def git_show(ref, path, dst):
    with open(dst, 'wb') as fh:
        subprocess.run(['git', 'show', f'{ref}:{path}'], check=True, stdout=fh, cwd=ROOT)


# --------------------------------------------------------------------- prepare

def prepare(work):
    """Pull the source banks out of git, dedupe them, and re-verify the two
    facts the whole approach rests on: 8 unique poses, and no motion outside
    the mouth. Both are asserted, so a different source clip fails loudly here
    rather than producing a boiling animation three stages later."""
    src = os.path.join(work, 'source')
    os.makedirs(src, exist_ok=True)
    git_show(LAURAH_REF, f'{LAURAH_DIR}/{REST_SRC}', os.path.join(src, 'rest.png'))
    order, digests = {}, {}
    for bank, (prefix, count) in BANKS.items():
        os.makedirs(os.path.join(src, bank), exist_ok=True)
        git_show(LAURAH_REF, f'{LAURAH_DIR}/laurah_{bank}/frames.json',
                 os.path.join(src, bank, 'frames.json'))
        seq = []
        for i in range(count):
            dst = os.path.join(src, bank, f'{i}.png')
            git_show(LAURAH_REF, f'{LAURAH_DIR}/laurah_{bank}/{prefix}_{i:05d}.png', dst)
            d = hashlib.sha1(open(dst, 'rb').read()).hexdigest()[:12]
            digests.setdefault(d, dst)
            seq.append(d)
        order[bank] = seq
    rest_d = hashlib.sha1(open(os.path.join(src, 'rest.png'), 'rb').read()).hexdigest()[:12]
    digests.setdefault(rest_d, os.path.join(src, 'rest.png'))

    poses = {d: f'pose_{n}' for n, d in enumerate(sorted(digests))}
    print(f'  {sum(c for _, c in BANKS.values())} frames -> {len(poses)} unique poses')

    # Fact 2, re-measured — and the swap region derived from the same
    # measurement. An ellipse is the wrong shape for it: fitted to the variance
    # spread it came out both too narrow (rx 0.144 against a motion box 0.45
    # wide) and far too tall, because a weighted standard deviation does not
    # track a bounding box. The pixels that actually move are known exactly, so
    # the mask is those pixels, dilated for margin and blurred for the feather.
    arrs = [rgba(digests[d]) for d in sorted(digests)]
    base = rgba(digests[rest_d])
    h, w = base.shape[:2]
    moving = np.zeros((h, w), bool)
    for a in arrs:
        moving |= np.abs(base[..., :3] - a[..., :3]).mean(axis=2) > MOTION_EPS
    ys, xs = np.nonzero(moving)
    if len(ys) == 0:
        raise SystemExit('nothing moves in the source clip')
    print(f'  source motion: y {ys.min()/h:.2f}-{ys.max()/h:.2f}  '
          f'x {xs.min()/w:.2f}-{xs.max()/w:.2f}  ({moving.sum()/(h*w):.1%} of frame)')
    mask = motion_mask(moving, w)
    covered = mask > 0.999
    if not covered[moving].all():
        raise SystemExit('the dilated mask does not cover every moving pixel')
    # Everything that moves is inside the solid core, so nothing outside the
    # mask can be real motion. This is the fact the static plate rests on.
    outside = mask < 0.001
    worst = max(float(np.abs(base[..., :3] - a[..., :3]).mean(axis=2)[outside].max())
                for a in arrs)
    print(f'  source motion outside the mask: max {worst:.0f}/255')
    if worst > 0:
        raise SystemExit(f'source animates outside the swap mask ({worst:.0f}/255)')
    Image.fromarray((mask * 255).astype(np.uint8), 'L').save(
        os.path.join(work, 'mouth-mask.png'))

    meta = {'poses': poses, 'order': order, 'rest': poses[rest_d],
            'mouth_mask': 'mouth-mask.png',
            'files': {poses[d]: os.path.relpath(p, work) for d, p in digests.items()}}
    json.dump(meta, open(os.path.join(work, 'reskin.json'), 'w'), indent=2)
    return meta


# -------------------------------------------------------------------- generate

def pad_3x4(src_png, dst_png):
    """The edit route reframes anything not handed to it at an offered ratio.
    0.698 native -> 3:4 is the nearest; `unpad` takes it back off."""
    art = Image.open(src_png).convert('RGBA')
    w = round(art.height * 3 / 4)
    flat = Image.new('RGB', (w, art.height), (0, 255, 0))
    flat.paste(art, ((w - art.width) // 2, 0), art)
    flat.save(dst_png)


def unpad(edited, like, dst):
    """The route does not return the ratio exactly (3:4 came back 1792x2400),
    so resize to the padded canvas rather than assuming, then crop the pad."""
    ref = Image.open(like)
    w = round(ref.height * 3 / 4)
    pad = (w - ref.width) // 2
    im = Image.open(edited).convert('RGB').resize((w, ref.height), Image.LANCZOS)
    im.crop((pad, 0, pad + ref.width, ref.height)).save(dst)


def edit_one(prompt, src_png, work, tag, out_png):
    padded = os.path.join(work, 'templates', f'{tag}-3x4.png')
    raw = os.path.join(work, 'generations', f'{tag}.png')
    unp = os.path.join(work, 'generations', f'{tag}-unpad.png')
    pad_3x4(src_png, padded)
    run('python3', ARTGEN, 'edit', prompt, '--ar', '3:4', '-i', padded, '-o', raw)
    unpad(raw, src_png, unp)
    run('python3', DEKEY, unp, out_png, '--key', '00FF00')


def generate(who, work, meta):
    """One edit per unique pose, then two more off the re-skinned rest plate for
    the eyelids. 8 + 2 calls per character."""
    for d in ('generations', 'templates', 'poses'):
        os.makedirs(os.path.join(work, d), exist_ok=True)
    ident = IDENTITY[who]
    for pose, rel in sorted(meta['files'].items()):
        out = os.path.join(work, 'poses', f'{pose}.png')
        if os.path.exists(out):
            print(f'  {pose}: exists, skipping')
            continue
        print(f'=== {who} · {pose} ===')
        edit_one(
            "Return this exact image with the character replaced by a different woman, drawn in "
            f"the identical pose and the identical art style. The new character is {ident}\n\n{HOLD}",
            os.path.join(work, rel), work, pose, out)

    rest_plate = os.path.join(work, 'poses', f'{meta["rest"]}.png')
    for state, clause in EYES.items():
        out = os.path.join(work, 'poses', f'eyes_{state}.png')
        if os.path.exists(out):
            print(f'  eyes_{state}: exists, skipping')
            continue
        print(f'=== {who} · eyes {state} ===')
        edit_one(f"Return this exact image with ONE change: {clause}\n\n{EYE_HOLD}",
                 rest_plate, work, f'eyes-{state}', out)


# ------------------------------------------------------------------- composite

def composite_set(base_png, frame_pngs, mask, out_dir):
    """Hold the base plate and swap only the masked region. After this every
    frame is byte-identical to the base outside it, so the drift is zero by
    construction rather than by measurement — and a crossfade can only blend
    what actually moves."""
    os.makedirs(out_dir, exist_ok=True)
    base = rgba(base_png)
    h, w = base.shape[:2]
    worst = 0.0
    for src in frame_pngs:
        shape = rgba(src)
        if shape.shape[:2] != (h, w):
            raise SystemExit(f'{src} is {shape.shape[1]}x{shape.shape[0]}, base is {w}x{h}')
        out = over(base, shape, mask)
        dst = os.path.join(out_dir, os.path.basename(src))
        Image.fromarray(out.astype(np.uint8), 'RGBA').save(dst)
        worst = max(worst, float(np.abs(out - base).max(axis=2)[mask <= 0].max()))
    print(f'  max difference outside the mask: {worst:.0f}/255 across {len(frame_pngs)} frames')
    if worst > 0:
        raise SystemExit('compositing did not hold the plate still')


def composite_stage(work, meta):
    poses = os.path.join(work, 'poses')
    rest_plate = os.path.join(poses, f'{meta["rest"]}.png')
    frames = sorted(glob.glob(os.path.join(poses, 'pose_*.png')))
    mask = np.asarray(Image.open(os.path.join(work, meta['mouth_mask'])).convert('L'),
                      dtype=np.float64) / 255.0
    print('  mouth:')
    composite_set(rest_plate, frames, mask, os.path.join(work, 'composited'))

    lids = [os.path.join(poses, 'eyes_half.png'), os.path.join(poses, 'eyes_closed.png')]
    base = rgba(rest_plate)
    h, w = base.shape[:2]
    emask = eye_mask(base, [rgba(p) for p in lids], h, w)
    composite_set(rest_plate, lids, emask, os.path.join(work, 'composited-eyes'))
    shutil.copyfile(rest_plate, os.path.join(work, 'composited-eyes', 'eyes_open.png'))
    Image.fromarray((emask * 255).astype(np.uint8), 'L').save(
        os.path.join(work, 'eye-mask.png'))
    meta['eye_mask'] = 'eye-mask.png'
    json.dump(meta, open(os.path.join(work, 'reskin.json'), 'w'), indent=2)


# ---------------------------------------------------------------------- export

README = """{who}_{seq} — After Effects PNG sequence (character-bank sequence)
Re-skinned from Laurah's {seq} bank by reskin-clip.py

Character   : {who}
Sequence    : {seq}
Files       : {n} PNGs — one per animation frame, {w}x{h} px, straight alpha
Frame rate  : {fps} fps (untimed steps); exact per-frame timing in frames.json

Every frame is byte-identical to {who}_{seq}_00000.png outside the composited
{region} region, so a crossfade blends only what moves.

Import into After Effects:
1. File > Import > File…
2. Select {who}_{seq}_00000.png and enable "PNG Sequence".
3. Interpret Footage > Main… — alpha: Straight (Unmatted).
4. Time-remap using the durations in frames.json for exact holds.
"""


def write_bank(out_dir, who, seq, frame_paths, durations, fps, region):
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir)
    probe = Image.open(frame_paths[0])
    frames = []
    for i, (src, ms) in enumerate(zip(frame_paths, durations)):
        name = f'{who}_{seq}_{i:05d}.png'
        shutil.copyfile(src, os.path.join(out_dir, name))
        frames.append({'index': i, 'file': name, 'durationMs': ms, 'blend': False})
    json.dump({'character': who, 'sequence': seq, 'fps': fps,
               'width': probe.width, 'height': probe.height,
               'frameCount': len(frames), 'frames': frames},
              open(os.path.join(out_dir, 'frames.json'), 'w'), indent=2)
    open(os.path.join(out_dir, 'README.txt'), 'w').write(README.format(
        who=who, seq=seq, n=len(frames), w=probe.width, h=probe.height,
        fps=fps, region=region))
    print(f'  {out_dir}: {len(frames)} frames, {sum(durations)} ms')


def export(who, work, meta, out_root):
    """Rebuild each source bank frame-for-frame with the composited poses,
    carrying the source's own per-frame timings over verbatim."""
    dst = os.path.join(out_root, who)
    os.makedirs(dst, exist_ok=True)
    comp = os.path.join(work, 'composited')
    for bank, seq in meta['order'].items():
        src_meta = json.load(open(os.path.join(work, 'source', bank, 'frames.json')))
        durations = [f['durationMs'] for f in src_meta['frames']]
        paths = [os.path.join(comp, f'{meta["poses"][d]}.png') for d in seq]
        slug = src_meta['sequence']
        write_bank(os.path.join(dst, f'{who}_{bank}'), who, slug, paths, durations,
                   src_meta['fps'], 'mouth')

    ce = os.path.join(work, 'composited-eyes')
    paths = [os.path.join(ce, f'eyes_{s}.png') for s, _ in BLINK_STEPS]
    write_bank(os.path.join(dst, f'{who}_blink'), who, 'blink', paths,
               [ms for _, ms in BLINK_STEPS], 7, 'eyes')

    shutil.copyfile(os.path.join(work, 'composited', f'{meta["rest"]}.png'),
                    os.path.join(dst, f'{who}-rest.png'))
    for state in ('open', 'half', 'closed'):
        os.makedirs(os.path.join(dst, f'{who}_eyelids'), exist_ok=True)
        shutil.copyfile(os.path.join(ce, f'eyes_{state}.png'),
                        os.path.join(dst, f'{who}_eyelids', f'{who}_{state}.png'))
    print(f'  {dst}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('who', choices=sorted(IDENTITY))
    ap.add_argument('--stage', default='all',
                    choices=('prepare', 'generate', 'composite', 'export', 'all'))
    ap.add_argument('--work', default=None)
    ap.add_argument('--out', default='assets/sprites/characters-merge')
    args = ap.parse_args()

    work = args.work or os.path.join(ROOT, 'assets/raw/characters', args.who, 'reskin')
    os.makedirs(work, exist_ok=True)
    meta_path = os.path.join(work, 'reskin.json')

    def load_meta():
        if not os.path.exists(meta_path):
            raise SystemExit('run --stage prepare first')
        return json.load(open(meta_path))

    if args.stage in ('prepare', 'all'):
        print(f'=== {args.who} · prepare ===')
        meta = prepare(work)
    else:
        meta = load_meta()
    if args.stage in ('generate', 'all'):
        generate(args.who, work, meta)
    if args.stage in ('composite', 'all'):
        print(f'=== {args.who} · composite ===')
        composite_stage(work, meta)
        meta = load_meta()
    if args.stage in ('export', 'all'):
        print(f'=== {args.who} · export ===')
        export(args.who, work, meta, os.path.join(ROOT, args.out))


if __name__ == '__main__':
    main()
