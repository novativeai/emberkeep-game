#!/usr/bin/env python3
"""Video → keyed frames → packed WebP atlas: the ingest stage of the animation
pipeline (upstream of scripts/anim-align.py, which registers the result onto
the in-game rest pose).

    anim-ingest.py <video.mp4> --dir <atlas-dir> --clip <name>
                   [--fps 24] [--height 360] [--maxdim 4096]
                   [--loop | --no-loop] [--character Name]

Implements the technique documented in assets/raw/new-animations/raw-mp4/
ATLAS_TUTO.md — read that first; the WHY of every step lives there. In short:

  1. ffmpeg decimates to --fps with a full RGB decode (no chroma subsampling
     into the keyer), PNG as the lossless intermediate.
  2. The keyer is chosen by MEASURING the border: a green plate keys on
     greenness (G − max(R,B)); a black plate keys on CONNECTIVITY — background
     is dark AND reachable from the frame border, so enclosed dark art (pupils,
     nostrils, scale outlines) is protected by construction, not by threshold.
     Enclosed dark pockets that really are background (a wing closing against
     the back) are killed on two independent axes at once: large AND
     colour-neutral — either alone is fragile, together the margins are wide.
  3. Colour is bled outward under the transparent pixels before any resize, so
     LANCZOS never pulls plate colour into the silhouette edge.
  4. Union bounding box across ALL frames (a per-frame crop would jitter),
     4px pad, scaled to --height but never past what a --maxdim sheet can hold
     (near-square grid) — so a fresh ingest ships verbatim, no re-encode at
     the staging step.
  5. One lossy encode: WebP quality=84, method=6, alpha_quality=90.
  6. The clip is MERGED into <dir>/atlas.json (sibling clips untouched).

Prints a JSON report: chosen key, thresholds, killed pockets, loop-seam RMSE
(first vs last frame — is this clip honestly loopable?), packed geometry.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ALPHA_THRESHOLD = 8


def fail(msg: str) -> None:
    print(json.dumps({'ok': False, 'error': msg}))
    sys.exit(1)


def extract_frames(video: Path, fps: int, out_dir: Path) -> list[Path]:
    """Decimate (never retime) to `fps`, full RGB decode, lossless PNGs."""
    r = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', str(video), '-vf', f'fps={fps}',
         '-pix_fmt', 'rgb24', '-start_number', '0', str(out_dir / 'f_%05d.png')],
        capture_output=True, text=True
    )
    if r.returncode != 0:
        fail(f'ffmpeg failed: {r.stderr.strip().splitlines()[-1] if r.stderr else r.returncode}')
    frames = sorted(out_dir.glob('f_*.png'))
    if not frames:
        fail('ffmpeg produced no frames')
    return frames


def _border(px: np.ndarray) -> np.ndarray:
    return np.concatenate([px[0], px[-1], px[:, 0], px[:, -1]])


def _bleed(rgb: np.ndarray, keep: np.ndarray) -> np.ndarray:
    """Replace background RGB with the nearest kept pixel's colour, so a
    downscale averages subject-with-subject at the silhouette edge."""
    _, idx = ndimage.distance_transform_edt(~keep, return_indices=True)
    return rgb[idx[0], idx[1]]


def _feather(mask: np.ndarray) -> np.ndarray:
    """Sub-pixel edge without the halo of a wide blur."""
    a = mask.astype(np.float32)
    a = ndimage.gaussian_filter(a, 0.8)
    return np.clip((a - 0.25) / 0.5, 0, 1)


def key_black(f: np.ndarray, thr: int) -> tuple[np.ndarray, dict]:
    """Connectivity key for a black plate (ATLAS_TUTO §3). Background = dark
    AND border-connected; enclosed dark pockets die only if large AND neutral."""
    l = f.max(-1)
    dark = l < thr

    seed = np.zeros_like(dark)
    seed[0, :] = dark[0, :]
    seed[-1, :] = dark[-1, :]
    seed[:, 0] = dark[:, 0]
    seed[:, -1] = dark[:, -1]
    bg = ndimage.binary_propagation(seed, mask=dark)

    # Enclosed background (the wing-pocket problem): large AND colour-neutral.
    # A pupil is small AND warm — it would have to fail both axes to be at risk.
    enclosed = dark & ~bg
    killed = 0
    lab, n = ndimage.label(enclosed)
    if n:
        areas = ndimage.sum(enclosed, lab, range(1, n + 1))
        mean_r = ndimage.mean(f[..., 0], lab, range(1, n + 1))
        kill = [i + 1 for i in range(n) if areas[i] > 600 and mean_r[i] < 12]
        if kill:
            bg = bg | np.isin(lab, kill)
            killed = len(kill)

    keep = ~bg
    alpha = _feather(keep)
    rgb = _bleed(f, alpha > 0.01)
    return np.dstack([rgb, (alpha * 255).astype(np.uint8)]), {'pockets_killed': killed}


def key_green(f: np.ndarray) -> tuple[np.ndarray, dict]:
    """Greenness key for a green plate (ATLAS_TUTO §2.2), with the structural
    cleanups: relative blob floor + dilation gate around the main subject."""
    g = f[..., 1].astype(np.int16) - np.maximum(f[..., 0], f[..., 2]).astype(np.int16)
    bg_level = float(np.median(_border(g)))
    # linear ramp from clearly-subject down to the plate's own greenness
    hi, lo = bg_level * 0.75, bg_level * 0.25
    a = np.clip((hi - g) / max(hi - lo, 1), 0, 1)
    a[a > 0.92] = 1.0
    a[a < 0.08] = 0.0

    # Isolated speck / edge-band cleanup: the subject is one large component;
    # the floor is RELATIVE to it (an absolute floor once missed a 1178px band).
    # A component TOUCHING the frame border is plate noise by construction —
    # the generation plates pad the subject well clear of every edge — unless
    # it is the largest component (art that genuinely reaches the edge must
    # never be culled by its own safety net).
    opaque = a > 0.3
    lab, n = ndimage.label(opaque)
    dropped = 0
    if n:
        areas = ndimage.sum(opaque, lab, range(1, n + 1))
        border_ids = set(np.unique(np.concatenate(
            [lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
        biggest = int(np.argmax(areas)) + 1
        thr = max(500, 0.05 * areas.max())
        keep_ids = [i + 1 for i in range(n)
                    if areas[i] >= thr and (i + 1 == biggest or i + 1 not in border_ids)]
        dropped = n - len(keep_ids)
        main = np.isin(lab, keep_ids)
        gate = ndimage.binary_dilation(main, iterations=6)
        a = np.where(gate, a, 0)

    alpha = np.clip(a * 255, 0, 255).astype(np.uint8)
    rgb = _bleed(f, alpha > 2)
    return np.dstack([rgb, alpha]), {'blobs_dropped': dropped}


def detect_plate(f: np.ndarray) -> tuple[str, int]:
    """Measure the border (ATLAS_TUTO: never assume the plate). Returns the
    keyer name and, for black, a threshold derived from the border's actual
    level — low enough that dark art touching the silhouette stays sealed."""
    border = _border(f)
    greenness = float(np.median(border[:, 1].astype(np.int16) - np.maximum(border[:, 0], border[:, 2]).astype(np.int16)))
    if greenness > 40:
        return 'green', 0
    luma = border.max(-1)
    thr = int(np.clip(np.percentile(luma, 99.9) + 15, 20, 40))
    return 'black', thr


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('video', type=Path)
    ap.add_argument('--dir', dest='atlas_dir', type=Path, required=True)
    ap.add_argument('--clip', required=True)
    ap.add_argument('--fps', type=int, default=24)
    ap.add_argument('--height', type=int, default=360)
    ap.add_argument('--maxdim', type=int, default=4096)
    ap.add_argument('--loop', dest='loop', action='store_true', default=True)
    ap.add_argument('--no-loop', dest='loop', action='store_false')
    ap.add_argument('--trim-loop', action='store_true',
                    help='cut the clip at the frame (searched over the back third) '
                         'that best matches frame 0 — a cleaner close AND a smaller sheet')
    ap.add_argument('--skip', type=int, default=0,
                    help='drop the first N extracted frames (wan puts plate '
                         'compression noise on frame 0)')
    ap.add_argument('--character', default=None)
    args = ap.parse_args()

    if not args.video.exists():
        fail(f'no such video: {args.video}')
    args.atlas_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as td:
        paths = extract_frames(args.video, args.fps, Path(td))
        if args.skip:
            if args.skip >= len(paths):
                fail(f'--skip {args.skip} would drop every frame')
            paths = paths[args.skip:]
        first = np.asarray(Image.open(paths[0]).convert('RGB'))
        keyer, thr = detect_plate(first)

        keyed: list[np.ndarray] = []
        stats: dict = {}
        for p in paths:
            f = np.asarray(Image.open(p).convert('RGB'))
            rgba, s = (key_black(f, thr) if keyer == 'black' else key_green(f))
            for k, v in s.items():
                stats[k] = stats.get(k, 0) + v
            keyed.append(rgba)

    # Loop trim: the authored tail often drifts past the moment the motion
    # returns to the start. Cutting at the best match to frame 0 (searched over
    # the back third, on downscaled copies) closes the loop cleaner than the
    # full length does — and every dropped frame is sheet area saved.
    trimmed_at = None
    if args.trim_loop and len(keyed) > 12:
        def small(f: np.ndarray) -> np.ndarray:
            im = Image.fromarray(f).resize((160, max(1, int(160 * f.shape[0] / f.shape[1]))), Image.BILINEAR)
            return np.asarray(im).astype(np.float32)
        ref = small(keyed[0])
        lo = (len(keyed) * 2) // 3
        dists = [float(np.sqrt(((small(keyed[i]) - ref) ** 2).mean())) for i in range(lo, len(keyed))]
        cut = lo + int(np.argmin(dists))
        if cut < len(keyed) - 1:
            trimmed_at = cut
            keyed = keyed[:cut + 1]

    # Union bbox across ALL frames — a per-frame crop would jitter the sprite.
    l = t = 10 ** 9
    r = b = -1
    for f in keyed:
        ys, xs = np.where(f[..., 3] > ALPHA_THRESHOLD)
        if not len(ys):
            continue
        l, t = min(l, int(xs.min())), min(t, int(ys.min()))
        r, b = max(r, int(xs.max()) + 1), max(b, int(ys.max()) + 1)
    if r <= l:
        fail('keyed frames are fully transparent — wrong plate assumption?')
    h, w = keyed[0].shape[:2]
    pad = 4
    l, t = max(0, l - pad), max(0, t - pad)
    r, b = min(w, r + pad), min(h, b + pad)
    cw, ch = r - l, b - t

    # Near-square grid; scale to --height but never past a --maxdim sheet, so
    # a fresh ingest ships VERBATIM (the stage step re-encodes only legacy
    # oversized sheets).
    n = len(keyed)
    cols = math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    scale = min(args.height / ch, (args.maxdim // cols) / cw, (args.maxdim // rows) / ch, 1.0)
    fw, fh = max(1, int(cw * scale)), max(1, int(ch * scale))

    sheet = Image.new('RGBA', (fw * cols, fh * rows), (0, 0, 0, 0))
    for i, f in enumerate(keyed):
        frame = Image.fromarray(f[t:b, l:r])
        if (fw, fh) != (cw, ch):
            frame = frame.resize((fw, fh), Image.LANCZOS)
        sheet.paste(frame, ((i % cols) * fw, (i // cols) * fh))

    out_file = args.atlas_dir / f'{args.clip}.webp'
    sheet.save(out_file, 'WEBP', quality=84, method=6, alpha_quality=90)

    # Honest loopability: RMSE of first-vs-last keyed frame against the mean
    # inter-frame motion — a seam well above the motion floor will pop.
    a0 = keyed[0][t:b, l:r, :3].astype(np.float32)
    a1 = keyed[-1][t:b, l:r, :3].astype(np.float32)
    seam = float(np.sqrt(((a0 - a1) ** 2).mean()))

    atlas_file = args.atlas_dir / 'atlas.json'
    doc = json.loads(atlas_file.read_text()) if atlas_file.exists() else {'animations': {}}
    if args.character:
        doc.setdefault('character', args.character)
    doc.setdefault('animations', {})[args.clip] = {
        'file': out_file.name,
        'frames': n,
        'frameWidth': fw,
        'frameHeight': fh,
        'cols': cols,
        'rows': rows,
        'sheetWidth': sheet.width,
        'sheetHeight': sheet.height,
        'fps': args.fps,
        'loop': args.loop
    }
    atlas_file.write_text(json.dumps(doc, indent=2) + '\n')

    print(json.dumps({
        'ok': True,
        'clip': args.clip,
        'keyer': keyer,
        **({'threshold': thr} if keyer == 'black' else {}),
        **stats,
        'frames': n,
        'frameWidth': fw,
        'frameHeight': fh,
        'grid': f'{cols}x{rows}',
        **({'trimmedAt': trimmed_at} if trimmed_at is not None else {}),
        'sheet': f'{sheet.width}x{sheet.height}',
        'bytes': out_file.stat().st_size,
        'loopSeamRmse': round(seam, 2),
        'file': str(out_file)
    }))


if __name__ == '__main__':
    main()
