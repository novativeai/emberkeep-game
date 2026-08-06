#!/usr/bin/env python3
"""Blink and talk banks from grid sheets anchored on a finished rest pose.

  posesheet.py <who> --chart blink|talk [--anchor plate.png] [--stage ...]

One generation per chart. Every cell of a chart is drawn in a single pass, so
the poses within a bank are consistent with each other by construction rather
than by correction — which is the whole reason to use a sheet instead of one
`edit` call per pose.

  blink  3x1, 21:9   open / half / closed        -> a 4-step bank (half replays)
  talk   4x2, 16:9   rest + 8 mouth shapes       -> Laurah's three length-picked
                                                    banks, at her own timings

Cell 1 of every sheet is not a silhouette: it is the finished rest artwork,
stamped by Sprite Studio's own `gridSheet` at the same geometry as the
silhouettes beside it. The model is told to reproduce it and match the rest of
the grid to it. The character-pipeline docs record two earlier blink sheets that
drifted (v1 in style, v2 by ~14% in scale) — neither had an anchor.

Both charts are generated from the SAME anchor plate and both are normalised
back onto that plate's canvas and scale, so a blink and a talk are
interchangeable and `rest.png` serves both.

The talk chart's eight cells are described to match Laurah's own eight unique
mouth poses, so her hand-tuned per-frame timings still mean what they meant:
the banks are re-orderings of those eight, and `reskin.json` holds the order.
"""
import argparse
import json
import os
import shutil
import subprocess

from PIL import Image

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(SCRIPTS))))
NODE = os.path.join(os.path.expanduser('~'), '.nvm/versions/node/v22.22.0/bin')
CELL = 900

# Laurah's eight mouth poses, in the order the grid presents them: the rest pose
# first (it is the anchor and also the closed-mouth shape), then pose_0..pose_6.
TALK_CELLS = [
    ('rest', 'mouth CLOSED, lips together in a gentle closed smile — this is the resting pose'),
    ('pose_0', 'a BROAD OPEN SMILE, lips parted wide across, the upper teeth clearly visible'),
    ('pose_1', 'mouth OPEN in a rounded oval, lips parted, the dark interior visible, teeth barely showing'),
    ('pose_2', 'lips PURSED and pushed forward into a small tight rounded pucker, mouth closed'),
    ('pose_3', 'an OPEN SMILE showing the upper teeth, a little narrower than cell 2'),
    ('pose_4', 'mouth SLIGHTLY OPEN in a small oval, just a hint of the upper teeth'),
    ('pose_5', 'mouth OPEN in a wide flat oval, the upper teeth edge and the dark interior visible'),
    ('pose_6', 'mouth WIDE OPEN in a tall rounded oval, dark interior with the tongue visible'),
]

CHARTS = {
    'blink': {'cols': 3, 'rows': 1, 'ar': 21 / 9},
    'talk': {'cols': 4, 'rows': 2, 'ar': 16 / 9},
}

# Three unique drawings, four steps: the lid passes through half on the way back
# open. Sprite Studio's blink preset cadence.
BLINK_STEPS = ((0, 2600), (1, 45), (2, 70), (1, 55))

ANCHOR_CLAUSE = """

IMPORTANT — CELL 1 IS ALREADY DRAWN. The layout template (Image 2) is not a grid of empty silhouettes: its FIRST cell already contains the finished artwork, and the remaining cells are white silhouettes to be filled. Reproduce cell 1 EXACTLY as it already appears — same drawing, same scale, same position, same colours, same rendering — and treat it as the definitive reference for every other cell. Match cell 1's head size and head position to the pixel. Keep every character fully inside its own cell with clear margin on all sides; nothing may touch or cross a cell edge. She is BARE-HEADED in every cell."""

TALK_PROMPT = """Create ONE {cols}x{rows} character mouth-pose sheet — {cols} cells across, {rows} rows down, {n} cells in total.

You are given two reference images:
- Image 1 is the CHARACTER reference: the exact character to draw.
- Image 2 is the LAYOUT TEMPLATE: a {cols}x{rows} grid marking the exact position, scale and framing for every cell. Follow its structure exactly — one character per cell, aligned to it.

Draw the identical character in every cell. Every cell shows the same face, the same hairstyle, the same hair colours, the same eyes open the same amount, the same gaze, the same eyebrows, the same head size, the same head angle, the same shoulders, the same clothing and the same lighting. The ONLY thing that changes from cell to cell is THE SHAPE OF THE MOUTH.

The {n} mouth shapes, in reading order (left to right, top row first):
{cells}

These cells are played back as a talking animation, so they must line up: nothing but the mouth may move between them. Do not change the expression of the eyes, do not tilt the head, do not re-frame. Do not add text, numbers, labels, borders, shadows or props.
Background: one solid uniform pure green (#00FF00) covering the entire canvas — completely flat, no gradient, no vignette, no texture."""

README = """{who}_{seq} — After Effects PNG sequence (character-bank sequence)
Generated by posesheet.py from a {cols}x{rows} Sprite Studio grid sheet

Character   : {who}
Sequence    : {seq}
Files       : {n} PNGs — one per animation frame, {w}x{h} px, straight alpha
Frame rate  : {fps} fps (untimed steps); exact per-frame timing in frames.json

Every pose in this bank came from ONE generation, so the drawings are consistent
with each other by construction. Cells were sliced in equal parts, de-keyed
without trimming, left-edge aligned to the first cell, and normalised back onto
the rest plate's canvas and scale so this bank and the character's other banks
are interchangeable.

Import into After Effects:
1. File > Import > File…
2. Select {who}_{seq}_00000.png and enable "PNG Sequence".
3. Interpret Footage > Main… — alpha: Straight (Unmatted).
4. Time-remap using the durations in frames.json for exact holds.
"""


def run(*cmd, **kw):
    env = dict(os.environ, PATH=NODE + os.pathsep + os.environ['PATH'])
    subprocess.run([str(c) for c in cmd], check=True, cwd=ROOT, env=env, **kw)


def content_bbox(path, min_px=8):
    """Bounding box of the real figure, ignoring edge noise.

    `Image.getbbox()` counts a single non-zero alpha pixel, and de-keying a JPEG
    leaves a sliver of half-opaque ringing along the cell boundary — enough to
    report a box spanning the full cell height when the head plainly does not.
    Requiring a row or column to hold at least `min_px` solid pixels throws the
    sliver away without touching the figure.
    """
    import numpy as np
    a = np.asarray(Image.open(path).convert('RGBA'))[..., 3] > 128
    rows = np.nonzero(a.sum(axis=1) >= min_px)[0]
    cols = np.nonzero(a.sum(axis=0) >= min_px)[0]
    if not len(rows) or not len(cols):
        raise SystemExit(f'{path}: no content')
    return int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1


def work_dir(who, chart):
    return os.path.join(ROOT, 'assets/raw/characters', who, 'reskin', f'{chart}sheet')


def default_anchor(tree, who):
    return os.path.join(ROOT, tree, who, f'{who}_blink', f'{who}_blink_00000.png')


def build(who, chart, anchor, work):
    """Grid template: Sprite Studio's mask sheet with cell 1 swapped for the real
    artwork, padded to the nearest offered aspect ratio so the route does not
    rescale the cells."""
    spec = CHARTS[chart]
    plate = os.path.join(work, 'anchor.png')
    shutil.copyfile(anchor, plate)
    gs = os.path.join(SCRIPTS, 'gridsheet.mjs')
    args = ['--cols', spec['cols'], '--rows', spec['rows'], '--cell', CELL, '--mode']
    run('node', gs, plate, os.path.join(work, 'grid-mask.png'), *args, 'mask', '--bg', '00FF00')
    run('node', gs, plate, os.path.join(work, 'grid-char.png'), *args, 'character', '--bg', '00FF00')

    mask = Image.open(os.path.join(work, 'grid-mask.png')).convert('RGB')
    char = Image.open(os.path.join(work, 'grid-char.png')).convert('RGB')
    cw, ch = mask.width // spec['cols'], mask.height // spec['rows']
    tpl = mask.copy()
    tpl.paste(char.crop((0, 0, cw, ch)), (0, 0))

    # Pad on whichever axis is short of the target ratio; the other stays 0.
    tw, th = tpl.width, tpl.height
    if tw / th < spec['ar']:
        tw = round(th * spec['ar'])
    else:
        th = round(tw / spec['ar'])
    px, py = (tw - tpl.width) // 2, (th - tpl.height) // 2
    out = Image.new('RGB', (tw, th), (0, 255, 0))
    out.paste(tpl, (px, py))
    out.save(os.path.join(work, 'template.png'))
    json.dump({'cols': spec['cols'], 'rows': spec['rows'],
               'template': [tw, th], 'pad': [px, py]},
              open(os.path.join(work, 'geom.json'), 'w'), indent=2)
    print(f'  template {out.size} ar {tw/th:.4f}, pad ({px},{py}), cell {cw}x{ch}')


def generate(who, chart, work):
    spec = CHARTS[chart]
    prompt_path = os.path.join(work, 'prompt.txt')
    if chart == 'blink':
        with open(prompt_path, 'w') as fh:
            subprocess.run(['node', os.path.join(SCRIPTS, 'studioprompt.mjs'),
                            '--chart', 'blink', '--shapes', '3', '--cols', '3', '--rows', '1',
                            '--key', '00FF00', '--res', '4K'], check=True, stdout=fh, cwd=ROOT,
                           env=dict(os.environ, PATH=NODE + os.pathsep + os.environ['PATH']))
            fh.write(ANCHOR_CLAUSE)
    else:
        cells = '\n'.join(f'Cell {i+1} — {desc}.' for i, (_, desc) in enumerate(TALK_CELLS))
        open(prompt_path, 'w').write(
            TALK_PROMPT.format(cols=spec['cols'], rows=spec['rows'],
                               n=len(TALK_CELLS), cells=cells) + ANCHOR_CLAUSE)
    job = 'sheet-wide' if chart == 'blink' else 'sheet-4k'
    run('python3', os.path.join(SCRIPTS, 'artgen.py'), job, open(prompt_path).read(),
        '-i', os.path.join(work, 'anchor.png'), '-i', os.path.join(work, 'template.png'),
        '-o', os.path.join(work, 'raw-sheet.png'))


def slice_cells(who, chart, work):
    """Slice, de-key, and normalise every cell onto the anchor plate's canvas.

    Each cell is scaled so its figure matches the anchor's width and placed so
    its bounding box starts where the anchor's does. That one operation fixes
    three drifts that were all measured, not assumed:

    - The model starts the drawing at a different x in each cell (22px and 41px
      on the first blink sheet), which reads as the head sliding sideways.
    - It draws a different SIZE per grid ROW. On Selyna's 4x2 talk sheet the top
      row came out 463x673 and the bottom row 431x626 — 7% smaller — so simply
      aligning left edges would have popped the head halfway through the bank.
    - Each sheet picks its own scale within the cell (the first blink sheet drew
      ~47% larger than the silhouette it was given), so two charts generated
      from the same anchor would otherwise disagree with each other.

    Normalising per cell rather than per sheet is safe here because the mouth
    and the eyelids do not move the figure's bounding box: within a row the
    measured boxes agree to ~3px across all eight mouth shapes. Scale comes from
    the bbox WIDTH and placement from its LEFT and TOP — the bust runs off the
    bottom of the cell, so the bottom bound is clipped and carries nothing.
    """
    geom = json.load(open(os.path.join(work, 'geom.json')))
    cols, rows = geom['cols'], geom['rows']
    sheet = Image.open(os.path.join(work, 'raw-sheet.png')).convert('RGB')
    # Resize to the template's exact dimensions BEFORE removing the pad. The
    # route does not return the ratio it was asked for (21:9 came back 2.357
    # against a 2.334 template), so a pad taken as a fraction of the returned
    # image lands in the wrong place and shaves the figure.
    sheet = sheet.resize(tuple(geom['template']), Image.LANCZOS)
    px, py = geom['pad']
    sheet = sheet.crop((px, py, sheet.width - px, sheet.height - py))
    cw, ch = sheet.width // cols, sheet.height // rows

    keyed = []
    for i in range(cols * rows):
        c, r = i % cols, i // cols
        raw = os.path.join(work, f'cell-{i}.png')
        sheet.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)).save(raw)
        out = os.path.join(work, f'cell-{i}-keyed.png')
        # No --trim: the cells must stay on one canvas.
        run('python3', os.path.join(SCRIPTS, 'dekey.py'), raw, out, '--key', '00FF00')
        keyed.append(out)

    boxes = [content_bbox(p) for p in keyed]
    anchor_path = os.path.join(work, 'anchor.png')
    anchor = Image.open(anchor_path).convert('RGBA')
    ab = content_bbox(anchor_path)
    aw = ab[2] - ab[0]

    final = []
    for i, p in enumerate(keyed):
        b = boxes[i]
        scale = aw / (b[2] - b[0])
        im = Image.open(p).convert('RGBA')
        big = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))),
                        Image.LANCZOS)
        canvas = Image.new('RGBA', anchor.size, (0, 0, 0, 0))
        canvas.paste(big, (round(ab[0] - b[0] * scale), round(ab[1] - b[1] * scale)))
        dst = os.path.join(work, f'final-{i}.png')
        canvas.save(dst)
        final.append(dst)
        print(f'  cell {i}: bbox {b} -> scale {scale:.4f}, placed at anchor bbox')
    return final


def write_bank(out_dir, who, seq, frame_paths, durations, fps, cols, rows):
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
        fps=fps, cols=cols, rows=rows))
    print(f'  {out_dir}: {len(frames)} frames, {sum(durations)} ms')


def install(who, chart, tree, work, final):
    dst = os.path.join(ROOT, tree, who)
    os.makedirs(dst, exist_ok=True)
    if chart == 'blink':
        write_bank(os.path.join(dst, f'{who}_blink'), who, 'blink',
                   [final[i] for i, _ in BLINK_STEPS],
                   [ms for _, ms in BLINK_STEPS], 7, 3, 1)
        # The rest plate every bank settles on, at the banks' own framing.
        shutil.copyfile(final[0], os.path.join(dst, f'{who}-rest.png'))
        return
    # talk: rebuild Laurah's three banks from her own frame order and timings.
    meta = json.load(open(os.path.join(ROOT, 'assets/raw/characters', who,
                                       'reskin', 'reskin.json')))
    cell_of = {name: i for i, (name, _) in enumerate(TALK_CELLS)}
    cell_of[meta['rest']] = 0                     # 'rest' entry is the rest pose
    for bank, seq in meta['order'].items():
        src_meta = json.load(open(os.path.join(ROOT, 'assets/raw/characters', who,
                                               'reskin', 'source', bank, 'frames.json')))
        paths = [final[cell_of[meta['poses'][d]]] for d in seq]
        write_bank(os.path.join(dst, f'{who}_{bank}'), who, src_meta['sequence'], paths,
                   [f['durationMs'] for f in src_meta['frames']], src_meta['fps'], 4, 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('who')
    ap.add_argument('--chart', required=True, choices=sorted(CHARTS))
    ap.add_argument('--anchor', default=None, help='rest plate; defaults to the blink bank frame 0')
    ap.add_argument('--tree', default='assets/sprites/characters-merge')
    ap.add_argument('--stage', default='all',
                    choices=('build', 'generate', 'split', 'all'))
    args = ap.parse_args()

    work = work_dir(args.who, args.chart)
    os.makedirs(work, exist_ok=True)
    anchor = os.path.join(ROOT, args.anchor) if args.anchor else default_anchor(args.tree, args.who)

    if args.stage in ('build', 'all'):
        print(f'=== {args.who} · {args.chart} · build ===')
        build(args.who, args.chart, anchor, work)
    if args.stage in ('generate', 'all'):
        print(f'=== {args.who} · {args.chart} · generate ===')
        generate(args.who, args.chart, work)
    if args.stage in ('split', 'all'):
        print(f'=== {args.who} · {args.chart} · split ===')
        final = slice_cells(args.who, args.chart, work)
        install(args.who, args.chart, args.tree, work, final)


if __name__ == '__main__':
    main()
