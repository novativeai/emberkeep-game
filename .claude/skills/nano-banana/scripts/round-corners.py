#!/usr/bin/env python3
"""Apply a rounded-rectangle alpha mask to a PNG (for card-slot art).

  python3 round-corners.py in.png out.png --radius 60
Radius is in the image's own pixels (double the display radius for 2x art).
"""
import argparse

from PIL import Image, ImageDraw


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--radius', type=int, default=60)
    args = ap.parse_args()

    img = Image.open(args.src).convert('RGBA')
    mask = Image.new('L', img.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, img.width - 1, img.height - 1], radius=args.radius, fill=255)
    alpha = img.getchannel('A')
    img.putalpha(Image.composite(alpha, Image.new('L', img.size, 0), mask))
    img.save(args.dst, 'PNG')
    print(f'saved {args.dst}')


if __name__ == '__main__':
    main()
