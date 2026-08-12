#!/usr/bin/env python3
"""
Bake the VFX palette ramp LUT.

    python3 scripts/bake-vfx-ramps.py

The channel-packed sheets carry NO colour — R is density, a greyscale mask. The
shader colourises by looking density up in this LUT, so one smoke sheet serves
ash, ember, toxic and arcane by changing a single uniform, instead of shipping
four coloured copies. This is what buys back the flexibility that baking the
palette into the pixels costs.

Output: assets/vfx-bank/ramps.png (256 x N, one ramp per row) + ramps.json.
Row r is sampled at v = (r + 0.5) / N.

Stops are Emberkeep's PALETTE (src/core/Constants.ts) — keep them in sync.
"""
import json, os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANK = os.path.join(ROOT, 'assets/vfx-bank')

# name -> stops, dark end first. Position 0 must be black: these are read with
# ADD blending, where black is "nothing", not "a dark colour".
RAMPS = {
    'ember':  ['#000000', '#5A1206', '#C73A2E', '#E8503C', '#F7A437', '#FFD84D', '#FFF6E8'],
    'lava':   ['#000000', '#3A0A04', '#C73A2E', '#E8503C', '#FF8A66', '#FFD84D'],
    'gold':   ['#000000', '#4A3010', '#D9821F', '#F7A437', '#FFD84D', '#FFF6E8'],
    'ash':    ['#000000', '#3A2B38', '#6E6A75', '#8E8A93', '#C8C4CC', '#FFF6E8'],
    'smoke':  ['#000000', '#241B22', '#4A3845', '#6A5468', '#A79CA5', '#FFF6E8'],
    'moss':   ['#000000', '#12300A', '#5FA63D', '#7ECB4F', '#B6E88A', '#FFF6E8'],
    'teal':   ['#000000', '#0C2A3A', '#2E7FA6', '#3FA8D9', '#9BE3FF', '#FFF6E8'],
    'plum':   ['#000000', '#241B22', '#4A3845', '#6A5468', '#B07CF0', '#E3C6FF'],
}


def hex_rgb(h):
    n = int(h[1:], 16)
    return np.array([(n >> 16) & 255, (n >> 8) & 255, n & 255], np.float32)


def ramp_row(stops, width=256):
    cols = np.stack([hex_rgb(s) for s in stops])
    t = np.linspace(0, len(stops) - 1, width)
    i = np.clip(t.astype(int), 0, len(stops) - 2)
    f = (t - i)[:, None]
    return cols[i] * (1 - f) + cols[i + 1] * f


def main():
    names = list(RAMPS)
    lut = np.zeros((len(names), 256, 4), np.float32)
    for r, name in enumerate(names):
        lut[r, :, :3] = ramp_row(RAMPS[name])
        lut[r, :, 3] = 255.0
    path = os.path.join(BANK, 'ramps.png')
    Image.fromarray(np.clip(lut + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(path, optimize=True)

    meta = {'format': 'emberkeep-vfx-ramps', 'version': 1,
            'file': 'ramps.png', 'width': 256, 'height': len(names),
            'note': 'Row r is sampled at v = (r + 0.5) / height. Look up the packed sheet\'s '
                    'R (density) as u. Position 0 is black so the ramp is safe under ADD blending.',
            'rows': {name: {'index': i, 'v': round((i + 0.5) / len(names), 5), 'stops': RAMPS[name]}
                     for i, name in enumerate(names)}}
    json.dump(meta, open(os.path.join(BANK, 'ramps.json'), 'w'), indent=2)
    print(f'wrote {path} — {len(names)} ramps x 256 ({os.path.getsize(path)} bytes)')
    for name in names:
        print(f'  {meta["rows"][name]["index"]}  {name:7} v={meta["rows"][name]["v"]}')


if __name__ == '__main__':
    main()
