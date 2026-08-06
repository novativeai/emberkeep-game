#!/usr/bin/env python3
"""Trace the floating-island silhouettes out of the world backdrop.

Rock and sunset cloud overlap far too much in colour for a plain threshold, so
this trains a small random forest on hand-labelled rock/sky patches using
colour + multi-scale texture features, turns the probability map into a clean
island mask, and walks the contour as one smooth continuous stroke per island.

The rough floor polygons in floors.json are used only to decide which blobs are
the playable islands — the outline itself comes entirely from the image.

Outputs into tools/mapmask/out/:
  island-trace.png     white line drawing on black  (the deliverable)
  island-mask.png      filled silhouette mask
  island-check.jpg     trace laid over the art, to verify the fit

Usage: python3 tools/mapmask/trace.py
"""
import json
import os

import cv2
import numpy as np
from scipy import ndimage
from sklearn.ensemble import RandomForestClassifier

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.join(ROOT, 'tools', 'mapmask')
OUT = os.path.join(HERE, 'out')

# Hand-labelled sample boxes (x0, y0, x1, y1) in backdrop pixels.
ROCK = [
    (700, 300, 850, 400), (900, 600, 1100, 750), (1250, 900, 1450, 1100),
    (850, 1150, 1000, 1250), (1600, 700, 1660, 900), (380, 420, 430, 520),
    (1350, 300, 1450, 400), (1750, 350, 1900, 450), (2050, 750, 2250, 900),
    (2200, 1250, 2400, 1400), (150, 1080, 400, 1180), (550, 1400, 800, 1550),
    (1000, 1250, 1150, 1330), (2400, 600, 2550, 700), (500, 200, 620, 280),
    (1150, 1150, 1300, 1250), (1950, 1050, 2100, 1150), (620, 950, 700, 1050),
    # molten features and the waterfall are island surface, not sky
    (2040, 580, 2130, 650), (2130, 700, 2180, 800), (2150, 1300, 2250, 1380),
    (1030, 75, 1090, 120), (1290, 1255, 1360, 1300), (1660, 1050, 1710, 1110),
]
SKY = [
    (60, 150, 300, 350), (1400, 80, 1650, 200), (2250, 150, 2450, 300),
    (100, 700, 250, 850), (600, 1050, 800, 1200), (1300, 1350, 1550, 1550),
    (250, 1450, 400, 1600), (2150, 60, 2350, 180), (1200, 250, 1300, 330),
    (900, 1400, 1100, 1550), (1450, 1150, 1600, 1300), (0, 950, 90, 1100),
    (1700, 1150, 1800, 1250), (2450, 900, 2560, 1000), (350, 850, 480, 950),
    (760, 60, 900, 130), (1120, 520, 1200, 600), (1900, 1250, 2000, 1350),
]

PROB_BLUR = 3.0         # smooth the probability field before thresholding
MIN_AREA = 40000        # drop specks and distant background props
MAX_HOLE = 90000        # bigger enclosed gaps are sky seen through a gap
CHAIN_CUT = 41          # opening that drops the hanging chains (they are thinner)
SPLIT_CUT = 101         # larger opening, used only to seed one marker per island
SMOOTH_PX = 5.0         # contour smoothing radius, in pixels of arc length
STROKE = 4              # line width of the trace


def kernel(k):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))


def features(bgr):
    """Colour in three spaces + texture energy at three scales."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    f = [bgr[..., 2].astype(np.float32), bgr[..., 1].astype(np.float32),
         bgr[..., 0].astype(np.float32),
         hsv[..., 0], hsv[..., 1], hsv[..., 2],
         lab[..., 0], lab[..., 1], lab[..., 2]]
    for s in (2.0, 6.0, 16.0):
        det = np.abs(gray - cv2.GaussianBlur(gray, (0, 0), s))
        f.append(cv2.boxFilter(det, -1, (25, 25)))
        f.append(cv2.boxFilter(det, -1, (81, 81)))
    mean = cv2.boxFilter(gray, -1, (61, 61))
    sq = cv2.boxFilter(gray * gray, -1, (61, 61))
    f.append(mean)
    f.append(np.sqrt(np.maximum(sq - mean * mean, 0)))
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, 3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, 3)
    f.append(cv2.boxFilter(np.hypot(gx, gy), -1, (41, 41)))
    return np.stack(f, -1)


def rock_probability(img):
    feat = features(img)
    rng = np.random.RandomState(0)
    X, y = [], []
    for boxes, label in ((ROCK, 1), (SKY, 0)):
        for x0, y0, x1, y1 in boxes:
            patch = feat[y0:y1, x0:x1].reshape(-1, feat.shape[-1])
            idx = rng.choice(len(patch), min(4000, len(patch)), replace=False)
            X.append(patch[idx])
            y.append(np.full(len(idx), label))
    clf = RandomForestClassifier(n_estimators=60, max_depth=14, n_jobs=-1,
                                 random_state=0)
    clf.fit(np.concatenate(X), np.concatenate(y))

    flat = feat.reshape(-1, feat.shape[-1])
    prob = np.empty(len(flat), np.float32)
    for i in range(0, len(flat), 400000):
        prob[i:i + 400000] = clf.predict_proba(flat[i:i + 400000])[:, 1]
    return prob.reshape(img.shape[:2])


def clean(mask, poly):
    """Drop the chains, split touching islands, keep only the seeded ones."""
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel(15))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel(11))

    # The hanging chains are painted in island colours and link neighbouring
    # islands. They are thin, so a small opening drops them while rounding the
    # silhouette by only CHAIN_CUT/2 px.
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel(CHAIN_CUT))

    # Islands that touch (the gate slab meets the plain across a rock neck) are
    # split by seeding one marker per island from a much heavier opening, then
    # handing every pixel to its nearest marker. The silhouette itself is never
    # eroded by this — only cut.
    seeds = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel(SPLIT_CUT))
    ns, seed_lbl, seed_stats, _ = cv2.connectedComponentsWithStats(
        (seeds > 0).astype(np.uint8), 8)
    seed_lbl = np.where(
        np.isin(seed_lbl, [i for i in range(1, ns)
                           if seed_stats[i, cv2.CC_STAT_AREA] >= MIN_AREA]),
        seed_lbl, 0)
    if seed_lbl.max() > 0:
        _, idx = ndimage.distance_transform_edt(seed_lbl == 0, return_indices=True)
        nearest = seed_lbl[tuple(idx)]
        owner = np.where(mask > 0, nearest, 0)
        borders = np.zeros_like(mask)
        for shift in ((1, 0), (0, 1)):
            a = owner
            b = np.roll(owner, shift, (0, 1))
            borders |= ((a != b) & (a > 0) & (b > 0)).astype(np.uint8) * 255
        mask = mask & ~cv2.dilate(borders, kernel(5))

    # fill enclosed holes, but only small ones — a big enclosed region is sky
    inv = cv2.bitwise_not(mask)
    n, lbl, stats, _ = cv2.connectedComponentsWithStats(inv, 4)
    border = set(lbl[0, :]) | set(lbl[-1, :]) | set(lbl[:, 0]) | set(lbl[:, -1])
    for i in range(1, n):
        if i not in border and stats[i, cv2.CC_STAT_AREA] <= MAX_HOLE:
            mask[lbl == i] = 255

    n, lbl, stats, _ = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), 8)
    keep = np.zeros_like(mask)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < MIN_AREA:
            continue
        if not np.any(poly[lbl == i]):
            continue
        keep[lbl == i] = 255
    return keep


def smooth_contour(pts, sigma_px):
    """Circular Gaussian smoothing along the contour's arc length."""
    p = pts.astype(np.float64)
    n = len(p)
    if n < 8:
        return p
    step = np.linalg.norm(np.diff(np.vstack([p, p[:1]]), axis=0), axis=1).mean()
    sigma = max(1.0, sigma_px / max(step, 1e-6))
    rad = int(np.ceil(sigma * 3))
    g = np.exp(-0.5 * (np.arange(-rad, rad + 1) / sigma) ** 2)
    g /= g.sum()
    pad = np.vstack([p[-rad:], p, p[:rad]])
    out = np.empty_like(p)
    for c in (0, 1):
        out[:, c] = np.convolve(pad[:, c], g, mode='valid')
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(HERE, 'floors.json')) as fh:
        spec = json.load(fh)

    img = cv2.imread(os.path.join(ROOT, spec['source']))
    h, w = img.shape[:2]

    poly = np.zeros((h, w), np.uint8)
    for isle in spec['islands']:
        cv2.fillPoly(poly, [np.array(isle['outline'], np.int32)], 1)

    cache = os.path.join(OUT, '.rock-prob.npy')
    if os.path.exists(cache) and not os.environ.get('MAPMASK_RETRAIN'):
        prob = np.load(cache)
    else:
        prob = rock_probability(img)
        np.save(cache, prob)
    prob = cv2.GaussianBlur(prob, (0, 0), PROB_BLUR)
    mask = clean((prob > 0.5).astype(np.uint8) * 255, poly)
    cv2.imwrite(os.path.join(OUT, 'island-mask.png'), mask)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    curves = [smooth_contour(c[:, 0, :], SMOOTH_PX) for c in contours
              if cv2.contourArea(c) >= MIN_AREA]

    line = np.zeros((h, w, 3), np.uint8)
    check = img.copy()
    for cur in curves:
        pts = np.round(cur).astype(np.int32).reshape(-1, 1, 2)
        cv2.polylines(line, [pts], True, (255, 255, 255), STROKE, cv2.LINE_AA)
        cv2.polylines(check, [pts], True, (0, 255, 255), 3, cv2.LINE_AA)
    cv2.imwrite(os.path.join(OUT, 'island-trace.png'), line)
    cv2.imwrite(os.path.join(OUT, 'island-check.jpg'), check,
                [cv2.IMWRITE_JPEG_QUALITY, 85])
    print(f'{len(curves)} island outlines -> {OUT}')


if __name__ == '__main__':
    main()
