#!/usr/bin/env python3
"""Render a Sprite Studio step list into a playable animation.

  renderanim.py steps.json frames/ out.webp --manifest visemes.json [--height 768]

`steps.json` comes from `studioprompt.mjs --timeline … --blend`; the manifest is
whichever id -> file map the frame set already ships (`talk/visemes.json` or
`blink/blink.json`).

Two things the step list needs honoured:

- `durationMs` is per step, not a frame rate. A blink is 2.6 s open and 45 ms
  half — sampling that at a fixed fps would either bloat the file or lose the
  fast part. Animated WebP stores a duration per frame, so it is written
  straight through.
- A step with `blendWith` is Sprite Studio's frame-mix in-between: a synthetic
  50/50 mix of the two drawings, which is what makes three blink drawings read
  as continuous motion rather than three cuts.

Output keeps alpha, so it composites over a dialogue box as-is.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile

from PIL import Image

# WebP stores frame durations in ms; anything under this is dropped by most
# players, and a 0 ms frame is undefined.
MIN_FRAME_MS = 10


def load_manifest(path: str) -> dict:
    data = json.load(open(path, encoding='utf-8'))
    if 'visemes' in data:
        return {v['id']: v['file'] for v in data['visemes']}
    if 'steps' in data:
        return {s['frameId']: s['file'] for s in data['steps'] if 'file' in s}
    raise SystemExit(f'{path}: no `visemes` or `steps` with files to map from')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('steps')
    ap.add_argument('frames_dir')
    ap.add_argument('out')
    ap.add_argument('--manifest', required=True)
    ap.add_argument('--height', type=int, default=768)
    ap.add_argument('--loop', type=int, default=0, help='0 = forever')
    # Lossy WebP keeps the alpha channel and is ~10x smaller: a 69-frame
    # painterly portrait sequence is 20 MB lossless and under 2 MB at q80, with
    # no visible difference on this kind of brushwork.
    ap.add_argument('--lossless', action='store_true')
    ap.add_argument('--quality', type=int, default=80)
    args = ap.parse_args()

    steps = json.load(open(args.steps, encoding='utf-8'))
    files = load_manifest(args.manifest)

    # Slicing an N-cell grid at exact fractions leaves cells differing by a
    # pixel (1835 vs 1834). Every frame goes onto one canvas of the largest
    # size, anchored top-left — the same corner the cells were cut from, so the
    # registration the grid template bought is preserved.
    loaded: dict[str, Image.Image] = {}
    for fid in {s['frameId'] for s in steps['steps']} | {
            s['blendWith'] for s in steps['steps'] if s.get('blendWith')}:
        name = files.get(fid)
        if not name:
            raise SystemExit(f'step references frame {fid!r}, which the manifest does not map')
        loaded[fid] = Image.open(os.path.join(args.frames_dir, name)).convert('RGBA')

    cw = max(i.width for i in loaded.values())
    chh = max(i.height for i in loaded.values())
    scale = args.height / chh if args.height else 1.0
    out_size = (max(1, round(cw * scale)), max(1, round(chh * scale)))

    cache: dict[str, Image.Image] = {}
    for fid, img in loaded.items():
        canvas = Image.new('RGBA', (cw, chh), (0, 0, 0, 0))
        canvas.paste(img, (0, 0))
        cache[fid] = canvas.resize(out_size, Image.LANCZOS) if scale != 1.0 else canvas

    def frame(fid: str) -> Image.Image:
        return cache[fid]

    rendered, durations = [], []
    for s in steps['steps']:
        img = frame(s['frameId'])
        if s.get('blendWith'):
            img = Image.blend(frame(s['blendWith']), img, 0.5)
        rendered.append(img)
        durations.append(max(MIN_FRAME_MS, int(round(s['durationMs']))))

    if not rendered:
        raise SystemExit('the step list is empty')

    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or '.', exist_ok=True)
    encode(rendered, durations, args)

    blends = sum(1 for s in steps['steps'] if s.get('blendWith'))
    print(f'saved {args.out} ({rendered[0].width}x{rendered[0].height}, '
          f'{len(rendered)} frames, {blends} blended, {sum(durations)} ms, '
          f'{os.path.getsize(args.out) / 1024:.0f} KB)')
    verify(args.out, durations)


def encode(rendered, durations, args) -> None:
    """Write the animation with libwebp's img2webp.

    NOT Pillow: its WebP writer ignores a per-frame `duration` list and stamps
    one value on every frame, which silently flattens a 2.6 s hold plus a 45 ms
    blink into eight equal ticks. img2webp takes `-d <ms>` per input file, which
    is the whole point of these step lists.
    """
    if not shutil.which('img2webp'):
        raise SystemExit('img2webp not found — install libwebp (brew install webp). '
                         'Pillow cannot write per-frame durations, so there is no fallback '
                         'that would preserve the timing.')
    with tempfile.TemporaryDirectory() as tmp:
        cmd = ['img2webp', '-loop', str(args.loop),
               '-lossless' if args.lossless else '-lossy',
               '-q', str(args.quality), '-m', '4']
        for i, (img, ms) in enumerate(zip(rendered, durations)):
            p = os.path.join(tmp, f'f{i:05d}.png')
            img.save(p)
            cmd += ['-d', str(ms), p]
        cmd += ['-o', args.out]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)


def verify(path: str, durations: list[int]) -> None:
    """Read the timing back off the encoded file — the bug this guards against
    produced a playable animation with the wrong cadence, which is invisible
    unless you look."""
    out = subprocess.run(['webpmux', '-info', path], check=True,
                         capture_output=True, text=True).stdout
    # `No.: width height alpha x_offset y_offset duration dispose blend …`
    got = []
    for line in out.splitlines():
        cols = line.split()
        if len(cols) >= 8 and re.fullmatch(r'\d+:', cols[0]):
            got.append(int(cols[6]))
    if not got:
        raise SystemExit(f'could not read frame timing back from {path}; webpmux said:\n{out}')
    if got != durations:
        raise SystemExit(f'timing did not survive encoding: wrote {durations}, file has {got}')
    print(f'  timing verified: {len(got)} frames, {sum(got)} ms')


if __name__ == '__main__':
    main()
