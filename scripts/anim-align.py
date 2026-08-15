#!/usr/bin/env python3
"""Character-atlas alignment: the pixel-level half of the Align Studio pipeline.

Two subcommands, both driven by scripts/apply-anim-align.mjs (which the
/__animalign dev endpoints and the CLI share):

  auto   spec-JSON on stdin -> alignment-JSON on stdout.
         Registers each animation atlas onto the character's IN-GAME rest pose:
         the idle clip is aligned against the reference silhouette (standee
         frame 0 or the composed rig rest pose), every other clip is aligned
         against the idle. All transforms are in the game convention:
         scale = game px per atlas px, dx/dy move the frame's bottom-centre off
         the character's anchor, in hi-res game pixels.

  stage  <src-sheet> <dst-sheet> <frameW> <frameH> <cols> <frames> <maxdim>
         Copies a sheet into the runtime assets, downscaling FRAME-EXACTLY when
         the source exceeds the old-device texture ceiling (4096): each frame is
         resized to integer dimensions and repacked, so Phaser's fixed-size
         spritesheet cutter never drifts. Prints the staged metadata as JSON.

Alignment strategies (per clip, chosen by the spec):
  feet    match content bottom-centre, scale by content height (default —
          right for full-body clips that share the idle's framing)
  center  match content centre, scale by content height (airborne clips like
          the whelp's fly loop, where feet mean nothing)
  top     match content top-centre, scale by content width (bust-framed clips
          like Selyna's talking/blinking, where the feet are out of frame)
"""

from __future__ import annotations

import base64
import io
import json
import math
import re
import sys
from pathlib import Path

from PIL import Image

ALPHA_THRESHOLD = 8


def fail(msg: str) -> None:
    print(json.dumps({'ok': False, 'error': msg}))
    sys.exit(1)


def frame_image(sheet: Image.Image, meta: dict, index: int) -> Image.Image:
    fw, fh = meta['frameWidth'], meta['frameHeight']
    cols = meta['cols']
    col, row = index % cols, index // cols
    return sheet.crop((col * fw, row * fh, (col + 1) * fw, (row + 1) * fh))


def content_box(img: Image.Image) -> tuple[int, int, int, int] | None:
    """Alpha bounding box (l, t, r, b) of the visible pixels."""
    alpha = img.convert('RGBA').getchannel('A')
    return alpha.point(lambda p: 255 if p > ALPHA_THRESHOLD else 0).getbbox()


def sprite_reference_box(root: Path, ref: dict) -> dict:
    """Rest-pose content box of a standee, in game px relative to her FEET anchor.

    The standee sheet's frame 0 is the bake's resting still; the bank's
    anchorX/anchorY give her feet inside the frame and `scale` is the effective
    on-board scale (bank scale x trim).
    """
    sheet = Image.open(root / 'assets' / ref['image'])
    fw, fh = ref['frameWidth'], ref['frameHeight']
    frame = sheet.crop((0, 0, fw, fh))
    box = content_box(frame)
    if box is None:
        fail(f"reference {ref['image']} frame 0 is fully transparent")
    ax, ay = ref['anchorX'] * fw, ref['anchorY'] * fh
    s = ref['scale']
    return {
        'left': (box[0] - ax) * s,
        'top': (box[1] - ay) * s,
        'right': (box[2] - ax) * s,
        'bottom': (box[3] - ay) * s,
    }


def item_reference_box(root: Path, ref: dict) -> dict:
    """Rest-pose content box of a RIG-LESS breed, in game px relative to the
    clip overlay's anchor.

    Some breeds are clip-only from birth — the legendaries have no rig, only the
    static board art the clips replace. That art IS the rest pose, so it is the
    reference: its alpha box, measured off its own board anchor and scaled by
    ITEM_SCALE. The overlay hangs `groundLift` above the item art's anchor
    (BoardScene.syncDragon), so the box shifts by that to land in overlay space.
    """
    img = Image.open(root / 'assets' / ref['image'])
    box = content_box(img)
    if box is None:
        fail(f"reference {ref['image']} is fully transparent")
    ax, ay = ref['anchorX'] * img.width, ref['anchorY'] * img.height
    s = ref['scale']
    lift = ref.get('groundLift', 0)
    return {
        'left': (box[0] - ax) * s,
        'top': (box[1] - ay) * s + lift,
        'right': (box[2] - ax) * s,
        'bottom': (box[3] - ay) * s + lift,
    }


def rig_reference_box(root: Path, ref: dict) -> dict:
    """Rest-pose content box of a rig, in game px relative to its root point.

    Rest pose = the layers as authored (RigPlayer applies no pose until a preset
    runs), so compositing every layer's alpha at its authored placement IS the
    rest silhouette.
    """
    doc = json.loads((root / 'assets' / ref['url']).read_text())
    bounds = doc.get('bounds') or {}
    left = top = 1e9
    right = bottom = -1e9
    for layer in doc.get('layers', []):
        if layer.get('visible') is False:
            continue
        data_url = (doc.get('images') or {}).get(layer.get('file', ''), '')
        comma = data_url.find(',')
        if comma < 0:
            continue
        img = Image.open(io.BytesIO(base64.b64decode(data_url[comma + 1:])))
        box = content_box(img)
        if box is None:
            continue
        sx = layer.get('width', img.width) / img.width
        sy = layer.get('height', img.height) / img.height
        left = min(left, layer['x'] + box[0] * sx)
        top = min(top, layer['y'] + box[1] * sy)
        right = max(right, layer['x'] + box[2] * sx)
        bottom = max(bottom, layer['y'] + box[3] * sy)
    if right <= left:
        fail(f"rig {ref['url']} has no visible pixels")
    rt = doc.get('root')
    if not rt:
        rt = {
            'x': bounds.get('x', left) + bounds.get('width', right - left) / 2,
            'y': bounds.get('y', top) + bounds.get('height', bottom - top) * 0.84,
        }
    s = ref['boardScale']
    return {
        'left': (left - rt['x']) * s,
        'top': (top - rt['y']) * s,
        'right': (right - rt['x']) * s,
        'bottom': (bottom - rt['y']) * s,
    }


def box_reference(root: Path, ref: dict) -> dict:
    """A reference the caller already solved: a literal game-px box.

    Used by PORTRAIT-ONLY characters, whose clips are never placed on the board
    at all — `CharacterBubble` seats them from `portraitView` and ignores the
    transform. apply-anim-align.mjs computes the box from that same view, so
    there is nothing here to measure off an image.
    """
    return {k: float(ref[k]) for k in ('left', 'top', 'right', 'bottom')}


def align_clip(meta: dict, box: tuple, target: dict, mode: str) -> dict:
    """Solve {scale, dx, dy} so the probe frame's content lands on `target`
    (a game-px box relative to the anchor)."""
    l, t, r, b = box
    cw, ch = r - l, b - t
    tw, th = target['right'] - target['left'], target['bottom'] - target['top']
    if mode == 'top':
        scale = tw / cw
    else:
        scale = th / ch
    fw, fh = meta['frameWidth'], meta['frameHeight']
    # world position of a texture point p: anchor + d + (p - bottomcentre_ref)*scale
    #   x: dx + (px - fw/2) * scale       y: dy + (py - fh) * scale
    cx, bottom_y, top_y = (l + r) / 2, b, t
    tcx = (target['left'] + target['right']) / 2
    dx = tcx - (cx - fw / 2) * scale
    if mode == 'center':
        cy = (t + b) / 2
        tcy = (target['top'] + target['bottom']) / 2
        dy = tcy - (cy - fh) * scale
    elif mode == 'top':
        dy = target['top'] - (top_y - fh) * scale
    else:
        dy = target['bottom'] - (bottom_y - fh) * scale
    return {'scale': round(scale, 5), 'dx': round(dx, 2), 'dy': round(dy, 2)}


#: What a character's idle registers against — one entry per reference `kind`
#: apply-anim-align.mjs's referenceOf can emit. A missing kind raises here
#: rather than silently aligning against the wrong thing.
REFERENCE_BOX = {
    'sprite': sprite_reference_box,
    'rig': rig_reference_box,
    'item': item_reference_box,
    'box': box_reference,
}


def cmd_auto() -> None:
    spec = json.load(sys.stdin)
    root = Path(spec['root'])
    only_char = spec.get('character')
    only_anim = spec.get('anim')
    out: dict = {'version': 1, 'characters': {}}
    report: dict = {}
    for char_id, char in spec['characters'].items():
        if only_char and char_id != only_char:
            continue
        ref = char['reference']
        target = REFERENCE_BOX[ref['kind']](root, ref)
        atlas_dir = root / char['atlasDir']
        anims = char['animations']
        modes = char.get('modes', {})
        crep: dict = {}

        idle_meta = anims.get('idle') or anims.get(char.get('idleClip', 'idle'))
        idle_id = 'idle' if 'idle' in anims else char.get('idleClip')
        transforms: dict = {}

        # 1. the idle registers against the in-game rest pose
        idle_box = None
        if idle_meta is not None:
            sheet = Image.open(atlas_dir / idle_meta['file'])
            idle_box = content_box(frame_image(sheet, idle_meta, 0))
            if idle_box is None:
                fail(f'{char_id}/{idle_id}: probe frame is transparent')
            transforms[idle_id] = align_clip(idle_meta, idle_box, target, modes.get(idle_id, 'feet'))
            crep[idle_id] = (
                f'content {idle_box[2]-idle_box[0]}x{idle_box[3]-idle_box[1]} -> ref '
                f'{round(target["right"]-target["left"])}x{round(target["bottom"]-target["top"])} game px'
            )

        # 2. every other clip registers against the ALIGNED idle's content
        if idle_meta is not None and idle_box is not None:
            it = transforms[idle_id]
            fw, fh = idle_meta['frameWidth'], idle_meta['frameHeight']
            idle_world = {
                'left': it['dx'] + (idle_box[0] - fw / 2) * it['scale'],
                'right': it['dx'] + (idle_box[2] - fw / 2) * it['scale'],
                'top': it['dy'] + (idle_box[1] - fh) * it['scale'],
                'bottom': it['dy'] + (idle_box[3] - fh) * it['scale'],
            }
        else:
            idle_world = target
        for anim_id, meta in anims.items():
            if anim_id == idle_id:
                continue
            if only_anim and anim_id != only_anim:
                continue
            sheet = Image.open(atlas_dir / meta['file'])
            probe = meta.get('probeFrame', 0)
            box = content_box(frame_image(sheet, meta, probe))
            if box is None:
                fail(f'{char_id}/{anim_id}: probe frame {probe} is transparent')
            mode = modes.get(anim_id, 'feet')
            transforms[anim_id] = align_clip(meta, box, idle_world, mode)
            crep[anim_id] = f'{mode}-aligned to idle, content {box[2]-box[0]}x{box[3]-box[1]}'

        if only_anim:
            transforms = {k: v for k, v in transforms.items() if k == only_anim}
        out['characters'][char_id] = {'atlas': char.get('runtimeAtlas', f'sprites/anims/{char_id}'), 'anims': transforms}
        report[char_id] = crep
    print(json.dumps({'ok': True, 'alignment': out, 'report': report}))


def cmd_stage(argv: list[str]) -> None:
    src, dst = Path(argv[0]), Path(argv[1])
    fw, fh, cols, frames, maxdim = (int(v) for v in argv[2:7])
    # Optional 8th arg: "a-b,c-d" half-open frame ranges — stage ONLY these
    # (a phased clip's runtime never draws the frames between its segments,
    # so shipping them is pure dead weight). The kept frames repack into
    # their own near-square grid.
    keep: list[int] | None = None
    if len(argv) > 7 and argv[7]:
        keep = []
        for span in argv[7].split(','):
            a, b = (int(v) for v in span.split('-'))
            keep.extend(range(a, b))
    # Optional 9th arg: OVERSAMPLE CAP shrink factor (≤ 1) — the caller knows
    # the clip's displayed size and refuses to ship texture past ~1.25× it.
    shrink = float(argv[8]) if len(argv) > 8 and argv[8] else 1.0
    sheet = Image.open(src).convert('RGBA')
    if keep is None and shrink >= 1.0 and sheet.width <= maxdim and sheet.height <= maxdim:
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(src.read_bytes())
        print(json.dumps({'ok': True, 'frames': frames, 'frameWidth': fw, 'frameHeight': fh,
                          'sheetWidth': sheet.width, 'sheetHeight': sheet.height, 'resized': False}))
        return
    # Repack (subset and/or downscaled) frame-exactly: integer frame dims, so
    # the runtime cutter and the sheet can never disagree by rounding.
    idx = keep if keep is not None else list(range(frames))
    n = len(idx)
    ncols = math.ceil(math.sqrt(n))
    nrows = math.ceil(n / ncols)
    f = min(maxdim / (fw * ncols), maxdim / (fh * nrows), shrink, 1.0)
    nfw, nfh = max(1, int(fw * f)), max(1, int(fh * f))
    out = Image.new('RGBA', (nfw * ncols, nfh * nrows), (0, 0, 0, 0))
    for j, i in enumerate(idx):
        col, row = i % cols, i // cols
        frame = sheet.crop((col * fw, row * fh, (col + 1) * fw, (row + 1) * fh))
        if (nfw, nfh) != (fw, fh):
            frame = frame.resize((nfw, nfh), Image.LANCZOS)
        out.paste(frame, ((j % ncols) * nfw, (j // ncols) * nfh))
    dst.parent.mkdir(parents=True, exist_ok=True)
    out.save(dst, 'WEBP', quality=90, method=6)
    print(json.dumps({'ok': True, 'frames': n, 'frameWidth': nfw, 'frameHeight': nfh,
                      'sheetWidth': out.width, 'sheetHeight': out.height,
                      'resized': f < 1.0, 'compacted': keep is not None}))


def main() -> None:
    if len(sys.argv) < 2:
        fail('usage: anim-align.py auto|stage …')
    if sys.argv[1] == 'auto':
        cmd_auto()
    elif sys.argv[1] == 'stage':
        if len(sys.argv) < 9:
            fail('usage: anim-align.py stage <src> <dst> <frameW> <frameH> <cols> <frames> <maxdim>')
        cmd_stage(sys.argv[2:])
    else:
        fail(f'unknown subcommand {sys.argv[1]}')


if __name__ == '__main__':
    main()
