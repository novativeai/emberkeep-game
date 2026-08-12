#!/usr/bin/env python3
"""Render the playable-floor border trace over the world backdrop.

Reads tools/mapmask/floors.json (hand-traced polygons in backdrop pixel space)
and writes three views into tools/mapmask/out/:
  border-overlay.png  border drawn on the art (for checking the trace)
  border-only.png     the line drawing alone on black (the mask outline)
  border-fill.png     filled silhouette (the actual floor mask)

Usage: python3 tools/mapmask/render.py
"""
import json
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.join(ROOT, 'tools', 'mapmask')
OUT = os.path.join(HERE, 'out')

LINE = (0, 168, 255)
LINE_GLOW = (120, 220, 255)
FILL = (0, 168, 255, 70)


def load():
    with open(os.path.join(HERE, 'floors.json')) as fh:
        return json.load(fh)


def main():
    os.makedirs(OUT, exist_ok=True)
    spec = load()
    art = Image.open(os.path.join(ROOT, spec['source'])).convert('RGB')
    w, h = art.size

    font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 30)

    # --- filled mask -------------------------------------------------------
    mask = Image.new('L', (w, h), 0)
    md = ImageDraw.Draw(mask)
    for isle in spec['islands']:
        md.polygon([tuple(p) for p in isle['outline']], fill=255)
    mask.save(os.path.join(OUT, 'border-fill.png'))

    # --- line drawing ------------------------------------------------------
    lines = Image.new('RGB', (w, h), (0, 0, 0))
    ld = ImageDraw.Draw(lines)
    for isle in spec['islands']:
        pts = [tuple(p) for p in isle['outline']]
        ld.line(pts + [pts[0]], fill=(255, 255, 255), width=5, joint='curve')
    lines.save(os.path.join(OUT, 'border-only.png'))

    # --- overlay on art ----------------------------------------------------
    over = art.copy().convert('RGBA')
    tint = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    td = ImageDraw.Draw(tint)
    for isle in spec['islands']:
        pts = [tuple(p) for p in isle['outline']]
        td.polygon(pts, fill=FILL)
    over = Image.alpha_composite(over, tint)
    od = ImageDraw.Draw(over)
    for isle in spec['islands']:
        pts = [tuple(p) for p in isle['outline']]
        od.line(pts + [pts[0]], fill=(255, 255, 255, 90), width=9, joint='curve')
        od.line(pts + [pts[0]], fill=LINE + (255,), width=5, joint='curve')
        for p in pts:
            od.ellipse([p[0] - 6, p[1] - 6, p[0] + 6, p[1] + 6],
                       fill=(255, 255, 255, 235))
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        od.text((cx, cy), isle['id'], fill=(255, 255, 255, 255), font=font,
                anchor='mm', stroke_width=4, stroke_fill=(0, 0, 0, 255))
    over.convert('RGB').save(os.path.join(OUT, 'border-overlay.png'))

    print('wrote', OUT)


if __name__ == '__main__':
    main()
