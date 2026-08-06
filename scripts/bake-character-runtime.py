#!/usr/bin/env python3
"""Bake the game-ready runtime copies of Eleanor and Selyna.

The production art under `assets/sprites/characters/<name>/` is authored at
1101x1536 to 1835x3072 per frame — right for After Effects and for modelling
reference, far too heavy to load in the game. This writes the same frames scaled
to a runtime height and named the way the loader expects.

Produces, per character:

  assets/sprites/<name>/<clip>/0.png, 1.png, …   talk + blink banks, one file
      per animation step, in `frames.json` order. `builtinSequenceFiles()` in
      src/render/sequenceCatalog.ts builds exactly these paths.
  assets/sprites/<name>/rest.png                 the resting pose every bank
      ends on (X-rest for talk, eyes open for blink) — the catalog's `endIdle`.
  assets/sprites/<name>/visemes/<id>.png         9 mouth poses
  (a blink is a frame sequence like any other bank, not a pose set)
  assets/sprites/<name>/expressions/<name>.png   8 expression poses
      The pose sets are for a runtime that drives lip-sync itself from
      `visemes.json`, rather than playing a pre-rendered bank.
  assets/sprites/<name>/catalog.json             frame counts and the per-frame
      durations, ready to paste into BUILTIN_SEQUENCES.

Height is 560 px so every character's portrait swaps in at the same scale.

  python3 scripts/bake-character-runtime.py [--height 560]
"""
import argparse
import glob
import json
import os
import shutil

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROD = os.path.join(ROOT, 'assets/sprites/characters')
OUT = os.path.join(ROOT, 'assets/sprites')
CHARACTERS = ('eleanor', 'selyna')


def scaled(path: str, height: int) -> Image.Image:
    im = Image.open(path).convert('RGBA')
    if im.height == height:
        return im
    return im.resize((max(1, round(im.width * height / im.height)), height), Image.LANCZOS)


def bake_bank(src_dir: str, dst_dir: str, height: int) -> dict:
    """One clip: frames.json order -> 0.png, 1.png, … at runtime size."""
    meta = json.load(open(os.path.join(src_dir, 'frames.json'), encoding='utf-8'))
    if os.path.isdir(dst_dir):
        shutil.rmtree(dst_dir)
    os.makedirs(dst_dir)
    for i, f in enumerate(meta['frames']):
        scaled(os.path.join(src_dir, f['file']), height).save(os.path.join(dst_dir, f'{i}.png'))
    return {'count': meta['frameCount'],
            'durations': [f['durationMs'] for f in meta['frames']]}


def bake_poses(src_dir: str, dst_dir: str, height: int, strip: str) -> list:
    """A pose set, dropping the `<name>_` prefix — the folder already says it."""
    if os.path.isdir(dst_dir):
        shutil.rmtree(dst_dir)
    os.makedirs(dst_dir)
    names = []
    for p in sorted(glob.glob(os.path.join(src_dir, '*.png'))):
        base = os.path.basename(p)
        if base.startswith(strip):
            base = base[len(strip):]
        elif '-sheet' in base:
            continue  # the contact sheet is a production artefact
        scaled(p, height).save(os.path.join(dst_dir, base))
        names.append(base)
    return names


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--height', type=int, default=560, help='runtime bust height')
    # A style variant of the same two characters lives in its own production
    # tree and bakes to its own runtime folder, so the shipped art is never
    # overwritten by one — see .claude/skills/nano-banana/scripts/reskin-clip.py.
    ap.add_argument('--prod', default=PROD, help='production tree to bake from')
    ap.add_argument('--out', default=OUT, help='runtime tree to bake into')
    ap.add_argument('--suffix', default='', help='appended to each runtime folder name')
    ap.add_argument('--characters', default=','.join(CHARACTERS),
                    help='comma-separated subset to bake')
    args = ap.parse_args()

    for who in [c.strip() for c in args.characters.split(',') if c.strip()]:
        prod = os.path.join(ROOT, args.prod, who)
        dst = os.path.join(ROOT, args.out, who + args.suffix)
        os.makedirs(dst, exist_ok=True)
        catalog = {'character': who, 'height': args.height, 'banks': {}}

        clips = sorted(d for d in os.listdir(prod)
                       if os.path.isfile(os.path.join(prod, d, 'frames.json')))
        for clip in clips:
            key = clip[len(who) + 1:]          # eleanor_talk_foo -> talk_foo
            info = bake_bank(os.path.join(prod, clip), os.path.join(dst, key), args.height)
            catalog['banks'][key] = info
            print(f'  {who}/{key}: {info["count"]} frames, {sum(info["durations"])} ms')

        # Pose sets. A blink is NOT one of these — it is a plain frame sequence
        # baked above like any other bank, so there is no eyelid pose set to keep
        # interchangeable with anything. A set with no source folder is simply
        # absent rather than baked empty.
        for folder in ('visemes', 'expressions'):
            src = os.path.join(prod, f'{who}_{folder}_aligned')
            if not os.path.isdir(src):
                src = os.path.join(prod, f'{who}_{folder}')
            if not os.path.isdir(src):
                continue
            names = bake_poses(src, os.path.join(dst, folder), args.height, f'{who}_')
            print(f'  {who}/{folder}: {len(names)} poses from {os.path.basename(src)}')

        # The pose every bank rests on — talk banks would otherwise end mid-word.
        # The sequence catalogue makes the same guarantee with `endIdle`.
        #
        # It is the X-rest VISEME plate: the drawing the talk bank was actually
        # painted from, so a line of dialogue settles onto its own rest pose
        # exactly. It used to be taken from the blink bank's first frame, which
        # was equivalent only while the blink was an edit of that same plate. A
        # blink generated as its own sequence is a different painting at its own
        # framing, and resting on it pops the head at the end of every line.
        #
        # A tree with no viseme set (one whose banks were re-skinned from an
        # existing clip rather than built from a viseme sheet) names the same
        # drawing `<who>-rest.png` at its root. It is still the plate every bank
        # was composited onto, so the guarantee is unchanged.
        rest_src = os.path.join(prod, f'{who}_visemes', f'{who}_X-rest.png')
        if not os.path.exists(rest_src):
            rest_src = os.path.join(prod, f'{who}-rest.png')
        scaled(rest_src, args.height).save(os.path.join(dst, 'rest.png'))
        visemes = os.path.join(prod, f'{who}_visemes', 'visemes.json')
        if os.path.exists(visemes):
            shutil.copyfile(visemes, os.path.join(dst, 'visemes.json'))
        json.dump(catalog, open(os.path.join(dst, 'catalog.json'), 'w'), indent=2)

        total = sum(os.path.getsize(os.path.join(r, f))
                    for r, _, fs in os.walk(dst) for f in fs) / 1048576
        print(f'  {who}: {total:.0f} MB runtime\n')


if __name__ == '__main__':
    main()
