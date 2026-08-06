#!/usr/bin/env python3
"""Composite the island silhouette mask and the blue tile grid into one map mask.

Writes tools/mapmask/out/map-mask.png — white island bodies on black, with the
playable tile grid stroked in blue over them.

Usage: python3 tools/mapmask/combine.py
"""
import os

import cv2
import numpy as np

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')


def main():
    mask = cv2.imread(os.path.join(OUT, 'island-mask.png'), 0)
    grid = cv2.imread(os.path.join(OUT, 'grid-trace.png'))
    if mask is None or grid is None:
        raise SystemExit('run trace.py and grid.py first')

    out = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
    ink = grid.max(2) > 0
    out[ink] = grid[ink]
    cv2.imwrite(os.path.join(OUT, 'map-mask.png'), out)
    print('wrote', os.path.join(OUT, 'map-mask.png'))


if __name__ == '__main__':
    main()
