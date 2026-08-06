#!/usr/bin/env python3
"""Fit a dragon BREED's baked art onto a host chain's canvas, as a wearable skin.

    python3 scripts/bake-dragon-skin.py frost ember_dragon
    python3 scripts/bake-dragon-skin.py moonwhisker emerald --dry-run

A dragon skin is a straight texture swap: BoardScene renders `skin_<id>_<tier>`
in place of `item_<chain>_<tier>` and changes nothing else — same chain, same
tier, same generator, same payout. That only looks right if the swapped texture
puts the animal at the SAME on-board size and on the SAME spot of the canvas,
because the two things that size and place it — `ITEM_SCALE[chain_tier]` and the
`anchors.json` origin — are keyed by the chain, not by the texture.

Skins made by `dragonbreed.py` in locked mode (ashglass, porcelain) inherit
their host's rig and so already match to the pixel. A free-silhouette BREED does
not: `pad_rig` grows its canvases to keep the model's own outline off the cut
edge, so frost/storm/moonwhisker bake at 1162x1182 / 907x757 against red's
1054x1074 / 836x704. Dropped in as-is, a worn breed would render ~10% off size
and off centre.

So this fits rather than resizes: scale the breed's ALPHA BBOX to the host's
bbox HEIGHT (height is what the eye reads as "how big is this dragon"), then
centre that bbox on the host's bbox centre, on a host-sized canvas. Nothing else
is touched — no recolour, no re-crop, no trim.

Tiers 3 and 4 are the whelp and the adult; those are the only dragon tiers with
rig art to wear.
"""
import argparse
import json
import pathlib
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SPRITES = ROOT / 'assets/sprites/characters/dragon'
OUT_DIR = ROOT / 'assets/sprites/items/skins/dragons'

# chain -> the folder its authored board art is baked from.
HOSTS = {'ember_dragon': 'red-dragon', 'emerald': 'emerald-dragon', 'golden_egg': 'golden-dragon'}
# tier -> (sub-folder, baked-file suffix) inside a breed/host folder.
TIERS = {3: ('sprite', '-baked.webp'), 4: ('sprite-adult', '-adult-baked.webp')}


def baked(folder: pathlib.Path, tier: int) -> pathlib.Path:
    sub, suffix = TIERS[tier]
    stem = folder.name.replace('-dragon', '')
    hits = sorted((folder / sub).glob(f'*{suffix}'))
    if not hits:
        sys.exit(f'no {suffix} in {folder / sub}')
    if len(hits) > 1:
        sys.exit(f'ambiguous bake in {folder / sub}: {[h.name for h in hits]} ({stem})')
    return hits[0]


def fit(skin_png: pathlib.Path, host_png: pathlib.Path) -> Image.Image:
    skin = Image.open(skin_png).convert('RGBA')
    host = Image.open(host_png).convert('RGBA')
    sb, hb = skin.getbbox(), host.getbbox()
    if sb is None or hb is None:
        sys.exit(f'empty art: {skin_png.name} / {host_png.name}')

    content = skin.crop(sb)
    scale = (hb[3] - hb[1]) / (sb[3] - sb[1])
    # A breed can be genuinely WIDER than its host (moonwhisker's tail and
    # whiskers): matched on height it can still run off the side of the host's
    # canvas. Give back just enough scale to keep it inside with a 2px margin —
    # capping the width is a fraction of a percent, clipping a wingtip is not.
    margin = 2
    scale = min(scale, (host.width - 2 * margin) / content.width,
                (host.height - 2 * margin) / content.height)
    w = max(1, round(content.width * scale))
    h = max(1, round(content.height * scale))
    content = content.resize((w, h), Image.LANCZOS)

    out = Image.new('RGBA', host.size, (0, 0, 0, 0))
    cx, cy = (hb[0] + hb[2]) / 2, (hb[1] + hb[3]) / 2
    x = min(max(margin, round(cx - w / 2)), host.width - margin - w)
    y = min(max(margin, round(cy - h / 2)), host.height - margin - h)
    out.alpha_composite(content, (x, y))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('breed', help='breed id — the folder is <breed>-dragon')
    ap.add_argument('chain', choices=sorted(HOSTS), help='merge chain the skin dresses')
    ap.add_argument('--tiers', default='3,4')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    breed_dir = SPRITES / f'{args.breed}-dragon'
    host_dir = SPRITES / HOSTS[args.chain]
    if not breed_dir.is_dir():
        sys.exit(f'no such breed: {breed_dir}')
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    report = []
    for tier in (int(t) for t in args.tiers.split(',')):
        art = fit(baked(breed_dir, tier), baked(host_dir, tier))
        dest = OUT_DIR / f'{args.breed}_{tier}.webp'
        if not args.dry_run:
            art.save(dest, 'WEBP', quality=94, method=6, lossless=False)
        report.append({'tier': tier, 'key': f'skin_{args.breed}_{tier}',
                       'file': str(dest.relative_to(ROOT / 'assets')),
                       'size': list(art.size), 'bbox': list(art.getbbox() or [])})
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
