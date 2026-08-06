#!/usr/bin/env python3
"""Split a finished map backdrop into island cut-outs + an environment plate.

The production path chosen after benchmarking four separation methods on
emberkeep and runevault (assets/raw/map-gen/layered/_hires-test*/):

    BiRefNet v2 "General Use (Dynamic)" @2304 -> mask at the NATIVE 2610x1632
    connected components                      -> one layer per island, locally
    alpha transfer onto the master            -> cut-outs keep the ORIGINAL pixels
    Bria Eraser on the dilated mask           -> the environment behind them

Why not the alternatives (all measured, same two images):
  Qwen-Image-Layered  is the only one that yields a semantic stack, but it is
    hard-capped at 800x512 and its layers recomposite at 19-28 dB against the
    source — it repaints rather than mattes. Its one advantage, splitting the
    satellite pad and props off the main island, is recovered here for free:
    those are DISCONNECTED COMPONENTS of the mask, so labelling splits them
    losslessly. What it can still do and this cannot is separate things that
    OVERLAP (a brazier standing on the deck is one blob) — author those instead.
  BiRefNet "Matting"  ghosts hard-edged rock (it is built for hair/fur):
    45% coverage with 12% partial alpha on emberkeep. Never use that variant.
  EVF-SAM (text)      ragged edges and holes: 29% coverage. Not precise enough.

Nothing here upscales, and no generated pixel reaches the output except inside
the plate's erased region — that region is hidden behind the islands in the
master, so it is the one place pixels must be invented.

    python3 scripts/island-extract.py assets/sprites/background/emberkeep.jpg
    python3 scripts/island-extract.py A.webp B.webp --no-plate     # cut-outs only
    python3 scripts/island-extract.py A.jpg --keep 3 --refresh

Costs about $0.04 per backdrop (eraser; BiRefNet bills by compute-second and is
negligible). The mask is CACHED — re-running to retune the local steps is free.
"""
import argparse
import base64
import json
import os
import ssl
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets/raw/map-gen/extract')
BIREFNET = 'https://fal.run/fal-ai/birefnet/v2'
ERASER = 'https://fal.run/fal-ai/bria/eraser'
MIME = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'}
PLATE_LIMIT = 0.60   # erased fraction past which the inpaint goes soft (measured)

try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context(
        cafile='/etc/ssl/cert.pem' if os.path.exists('/etc/ssl/cert.pem') else None)


def read_key(name='fal_key'):
    val = os.environ.get(name.upper(), '').strip()
    if val:
        return val
    d = ROOT
    while True:
        p = os.path.join(d, '.env')
        if os.path.exists(p):
            with open(p, encoding='utf-8') as fh:
                for line in fh:
                    if '=' in line and line.split('=', 1)[0].strip().lower() == name:
                        return line.split('=', 1)[1].strip().strip('"\'')
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    sys.exit(f'no key — set {name.upper()} in the environment or a .env above {ROOT}')


def data_url(path):
    ext = os.path.splitext(path)[1].lower()
    return (f'data:{MIME.get(ext, "image/jpeg")};base64,'
            + base64.b64encode(open(path, 'rb').read()).decode())


def post(url, body, key):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST',
                                 headers={'Authorization': f'Key {key}',
                                          'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=900, context=SSL_CTX) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'{url.rsplit("/", 2)[-2]}: HTTP {e.code} {e.read().decode()[:240]}')


def grab(entry):
    ref = entry['url'] if isinstance(entry, dict) else entry
    if ref.startswith('data:'):
        return base64.b64decode(ref.split(',', 1)[1])
    req = urllib.request.Request(ref, headers={'User-Agent': 'island-extract'})
    with urllib.request.urlopen(req, timeout=900, context=SSL_CTX) as r:
        return r.read()


def birefnet_mask(src, dst, key, refresh):
    """Native-resolution foreground mask. Cached — the API call is the slow part."""
    if os.path.exists(dst) and not refresh:
        return cv2.imread(dst, cv2.IMREAD_GRAYSCALE), True
    resp = post(BIREFNET, {
        'image_url': data_url(src),
        'model': 'General Use (Dynamic)',   # the ONLY model that accepts 2304
        'operating_resolution': '2304x2304',
        'output_mask': True,
        'refine_foreground': True,
        'output_format': 'png',
    }, key)
    with open(dst, 'wb') as fh:
        fh.write(grab(resp['mask_image']))
    return cv2.imread(dst, cv2.IMREAD_GRAYSCALE), False


def refine(mask, lo, hi, tighten):
    """Sharpen BiRefNet's soft band and pull the edge in off the halo.

    The raw mask carries ~2.6% partial-alpha pixels. Left alone that band is
    where the background bleeds into a composite, so it is remapped to a hard
    ramp and the whole matte is eroded a hair — a cut-out that is a pixel tight
    reads clean over any plate, one that is a pixel loose shows a fringe.
    """
    a = mask.astype(np.float32) / 255.0
    a = np.clip((a - lo) / max(hi - lo, 1e-6), 0, 1)
    if tighten > 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * tighten + 1,) * 2)
        a = cv2.erode(a, k)
    return (a * 255).astype(np.uint8)


def fill_holes(binary, max_area):
    """Close pinholes in the matte — but only SMALL ones.

    An unbounded flood-fill is wrong here: this map's islands and the chains
    between them form a ring around the middle of the sky, so filling every
    enclosed region swallows that sky and merges the whole frame into one blob.
    Only holes below `max_area` (speckle, gaps under chain links) get closed;
    real sky stays sky.
    """
    h, w = binary.shape
    flood = binary.copy()
    cv2.floodFill(flood, np.zeros((h + 2, w + 2), np.uint8), (0, 0), 255)
    holes = cv2.bitwise_not(flood)                  # enclosed background, any size
    n, labels, stats, _ = cv2.connectedComponentsWithStats(holes, 8)
    out = binary.copy()
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] <= max_area:
            out[labels == i] = 255
    return out


def label_islands(solid, sever):
    """Label the islands, optionally cutting the chains that bridge them.

    This world's islands are strung together with gold chains, so plain
    connected components returns emberkeep as ONE blob. `--sever R` applies the
    same trick tools/mapmask/trace.py uses on the backdrop: seed markers from a
    heavier opening (which the chains are too thin to survive), then give every
    pixel of the real mask to its nearest marker. The chain itself is split down
    the middle between the two islands it joins, which is what you want — each
    cut-out keeps its own half.
    """
    if sever <= 0:
        return cv2.connectedComponentsWithStats(solid, 8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * sever + 1,) * 2)
    seeds = cv2.morphologyEx(solid, cv2.MORPH_OPEN, k)
    if not seeds.any():
        return cv2.connectedComponentsWithStats(solid, 8)
    # DIST_LABEL_CCOMP labels each zero-component and hands every pixel the id
    # of the nearest one, so this is a Voronoi split over the markers.
    _, near = cv2.distanceTransformWithLabels(cv2.bitwise_not(seeds), cv2.DIST_L2, 5,
                                              labelType=cv2.DIST_LABEL_CCOMP)
    labels = np.where(solid > 0, near, 0).astype(np.int32)
    ids = [i for i in np.unique(labels) if i != 0]
    stats = np.zeros((len(ids) + 1, 5), np.int32)
    out = np.zeros_like(labels)
    for new, old in enumerate(ids, 1):
        m = labels == old
        out[m] = new
        ys, xs = np.nonzero(m)
        stats[new] = [xs.min(), ys.min(), xs.max() - xs.min() + 1,
                      ys.max() - ys.min() + 1, int(m.sum())]
    return len(ids) + 1, out, stats, None


def extract(src, key, args):
    name = os.path.splitext(os.path.basename(src))[0]
    dst = os.path.join(OUT, name)
    os.makedirs(dst, exist_ok=True)
    img = cv2.imread(os.path.join(ROOT, src) if not os.path.isabs(src) else src,
                     cv2.IMREAD_COLOR)
    if img is None:
        return name, 'cannot read the image'
    h, w = img.shape[:2]

    raw, cached = birefnet_mask(src, os.path.join(dst, 'mask.png'), key, args.refresh)
    if raw is None:
        return name, 'no mask'
    if raw.shape[:2] != (h, w):                      # belt and braces; it matches in practice
        raw = cv2.resize(raw, (w, h), interpolation=cv2.INTER_LANCZOS4)
    alpha = refine(raw, args.lo, args.hi, args.tighten)

    solid = fill_holes((alpha > 127).astype(np.uint8) * 255, args.max_hole)
    n, labels, stats, _ = label_islands(solid, args.sever)
    parts = [(i, stats[i, cv2.CC_STAT_AREA]) for i in range(1, n)
             if stats[i, cv2.CC_STAT_AREA] >= args.min_area]
    parts.sort(key=lambda p: -p[1])
    if args.keep:
        parts = parts[:args.keep]
    if not parts:
        return name, f'nothing above --min-area {args.min_area}'

    manifest = {'source': src, 'canvas': [w, h], 'cached_mask': cached,
                'params': {'lo': args.lo, 'hi': args.hi, 'tighten': args.tighten,
                           'minArea': args.min_area, 'sever': args.sever,
                           'maxHole': args.max_hole,
                           'eraseDilate': args.erase_dilate},
                'parts': []}
    union = np.zeros((h, w), np.uint8)
    for rank, (idx, area) in enumerate(parts, 1):
        m = (labels == idx).astype(np.uint8) * 255
        union = np.maximum(union, m)
        a = cv2.bitwise_and(alpha, m)                # keep the soft edge, this component only
        ys, xs = np.nonzero(a)
        pad = 2
        x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + 1 + pad)
        y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + 1 + pad)
        rgba = np.dstack([img[y0:y1, x0:x1], a[y0:y1, x0:x1]])
        f = os.path.join(dst, f'island-{rank}.png')
        cv2.imwrite(f, rgba)
        # offset is where the trimmed sprite goes back on the full canvas
        manifest['parts'].append({'file': os.path.relpath(f, ROOT), 'rank': rank,
                                  'area': int(area), 'offset': [int(x0), int(y0)],
                                  'size': [int(x1 - x0), int(y1 - y0)]})

    note = ''
    if not args.no_plate:
        # The eraser needs room to blend: feed it a GENEROUSLY dilated union or
        # thin structures (chains, lantern posts) survive at the frame edge.
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * args.erase_dilate + 1,) * 2)
        emask = os.path.join(dst, 'erase-mask.png')
        erase = cv2.dilate(union, k)
        cv2.imwrite(emask, erase)
        hole = (erase > 127).mean()
        if hole > PLATE_LIMIT:
            # Measured: runevault erases 51% and the plate is seamless; emberkeep
            # erases 71% and the middle comes back as low-frequency mush. Past
            # roughly two thirds there is not enough surrounding context left to
            # reconstruct from, whatever the inpainter.
            note = (f'  ! plate erases {hole * 100:.0f}% of the frame — expect a soft, '
                    f'low-detail fill in the middle; treat it as a base to paint over')
        resp = post(ERASER, {'image_url': data_url(src), 'mask_url': data_url(emask),
                             'mask_type': 'manual'}, key)
        with open(os.path.join(dst, 'plate.png'), 'wb') as fh:
            fh.write(grab(resp['image']))
        manifest['plate'] = os.path.relpath(os.path.join(dst, 'plate.png'), ROOT)

    with open(os.path.join(dst, 'manifest.json'), 'w') as fh:
        json.dump(manifest, fh, indent=2)
    cov = (alpha > 8).mean() * 100
    return name, (f'{len(parts)} part(s), {cov:.1f}% coverage'
                  + (', plate' if not args.no_plate else '')
                  + (' [mask cached]' if cached else '') + f' -> {os.path.relpath(dst, ROOT)}' + note)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('images', nargs='+')
    ap.add_argument('--keep', type=int, default=0, help='keep only the N largest parts')
    ap.add_argument('--min-area', type=int, default=4000, help='drop specks below this many px')
    ap.add_argument('--max-hole', type=int, default=20000,
                    help='close enclosed gaps up to this many px; bigger ones stay sky')
    ap.add_argument('--sever', type=int, default=0,
                    help='cut links thinner than ~2N px so chained islands split (try 25)')
    ap.add_argument('--lo', type=float, default=0.35, help='alpha ramp start')
    ap.add_argument('--hi', type=float, default=0.65, help='alpha ramp end')
    ap.add_argument('--tighten', type=int, default=1, help='erode the matte N px to kill the halo')
    ap.add_argument('--erase-dilate', type=int, default=15, help='grow the plate mask N px')
    ap.add_argument('--no-plate', action='store_true', help='skip the eraser call (saves ~$0.04)')
    ap.add_argument('--refresh', action='store_true', help='re-fetch the mask instead of caching')
    args = ap.parse_args()

    key = read_key()
    os.makedirs(OUT, exist_ok=True)
    with ThreadPoolExecutor(max_workers=min(4, len(args.images))) as ex:
        for name, line in ex.map(lambda s: extract(s, key, args), args.images):
            print(f'{name:14s} {line}')


if __name__ == '__main__':
    main()
