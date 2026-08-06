#!/usr/bin/env python3
"""Preview a character-bank sequence: an animated WebP and a contact strip.

  bankpreview.py <bank-dir> [--height 420] [--strip out.png] [--webp out.webp]

Reads the folder's own frames.json, so it plays at the authored per-frame
durations rather than a nominal fps — the holds are most of what a talking
loop reads as. The strip lays every frame out in order for a still comparison,
which is what catches drift that motion hides.
"""
import argparse
import json
import os

from PIL import Image


def load(bank, height):
    meta = json.load(open(os.path.join(bank, 'frames.json'), encoding='utf-8'))
    ims = []
    for f in meta['frames']:
        im = Image.open(os.path.join(bank, f['file'])).convert('RGBA')
        if im.height != height:
            im = im.resize((max(1, round(im.width * height / im.height)), height),
                           Image.LANCZOS)
        ims.append(im)
    return meta, ims


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('bank')
    ap.add_argument('--height', type=int, default=420)
    ap.add_argument('--strip', default=None)
    ap.add_argument('--webp', default=None)
    ap.add_argument('--bg', default='18181c', help='strip backdrop (alpha is kept in the webp)')
    args = ap.parse_args()

    meta, ims = load(args.bank, args.height)
    name = os.path.basename(os.path.normpath(args.bank))
    webp = args.webp or os.path.join(args.bank, f'{name}.webp')
    ims[0].save(webp, save_all=True, append_images=ims[1:], loop=0,
                duration=[f['durationMs'] for f in meta['frames']], lossless=True)
    print(f'  {webp} ({meta["frameCount"]} frames, '
          f'{sum(f["durationMs"] for f in meta["frames"])} ms)')

    if args.strip:
        bg = tuple(int(args.bg[i:i + 2], 16) for i in (0, 2, 4))
        cw = max(i.width for i in ims)
        sheet = Image.new('RGB', (cw * len(ims), args.height), bg)
        for i, im in enumerate(ims):
            sheet.paste(im, (i * cw + (cw - im.width) // 2, 0), im)
        sheet.save(args.strip)
        print(f'  {args.strip} ({sheet.width}x{sheet.height})')


if __name__ == '__main__':
    main()
