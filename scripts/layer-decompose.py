#!/usr/bin/env python3
"""Decompose a backdrop into RGBA layers with Qwen-Image-Layered (fal.ai).

An EVALUATION script, not a pipeline step. The question it answers: can a
finished map backdrop be split back into editable layers — sky, distant world,
island body, deck, decor — well enough to be worth building into the art
workflow (re-lighting a zone, swapping a sky, lifting decor to sprites,
regenerating one island without touching the rest)?

  fal-ai/qwen-image-layered — $0.05/image, `num_layers` is a request parameter,
  and the model itself runs at 640 or 1024 px, so the layers come back far
  smaller than our 2610x1632 masters. That resolution ceiling is the whole
  question for production use; everything else is quality of the split.

  python3 scripts/layer-decompose.py [--only name,name] [--layers 6]

Writes assets/raw/map-gen/layered/<name>/layer-N.png + meta.json, and a
flattened contact sheet per image for eyeballing.
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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets/raw/map-gen/layered')
URL = 'https://fal.run/fal-ai/qwen-image-layered'
MIME = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'}

# The five shipped/prepared backdrops, all 2610x1632 except the emberkeep master.
SUBJECTS = {
    'emberkeep': ('assets/sprites/background/emberkeep.jpg',
                  'An isometric fantasy game map: floating stone islands with paved '
                  'diamond tile decks, crystals, gold chains and huts, over a sunset sky.'),
    'borealis': ('assets/sprites/background/borealis.webp',
                 'An isometric fantasy game map: snow-covered floating islands with paved '
                 'diamond tile decks, under a night sky with aurora borealis.'),
    'hatchery': ('assets/sprites/background/hatchery.webp',
                 'An isometric fantasy game zone: a paved stone plateau with dragon egg '
                 'nests and timber structures, in a sunlit forest clearing.'),
    'roothold': ('assets/sprites/background/roothold.webp',
                 'An isometric fantasy game zone: a paved stone plateau with a wooden '
                 'archive tower, inside the hollow trunk of a colossal tree.'),
    'runevault': ('assets/sprites/background/runevault.webp',
                  'An isometric fantasy game zone: a pale paved plateau with obelisks and '
                  'a glowing astral rune, on a mirror-still salt flat at twilight.'),
}

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


KEY = read_key()


def fetch(url, timeout=1800):
    req = urllib.request.Request(url, headers={'User-Agent': 'layer-decompose'})
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as r:
        return r.read()


def run(name, layers, tag=None):
    src, caption = SUBJECTS[name]
    path = os.path.join(ROOT, src)
    ext = os.path.splitext(path)[1].lower()
    body = {
        'image_url': (f'data:{MIME.get(ext, "image/jpeg")};base64,'
                      + base64.b64encode(open(path, 'rb').read()).decode()),
        'num_layers': layers,
        'prompt': caption,
        'output_format': 'png',
        'acceleration': 'regular',
        'enable_safety_checker': False,
        'seed': 7,
    }
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method='POST',
                                 headers={'Authorization': f'Key {KEY}',
                                          'Content-Type': 'application/json'})
    slug = tag or name
    try:
        with urllib.request.urlopen(req, timeout=1800, context=SSL_CTX) as r:
            resp = json.load(r)
    except urllib.error.HTTPError as e:
        return slug, f'HTTP {e.code}: {e.read().decode()[:300]}'
    except Exception as e:                                   # noqa: BLE001
        return slug, f'{type(e).__name__}: {e}'

    dst = os.path.join(OUT, slug)
    os.makedirs(dst, exist_ok=True)
    saved = []
    for i, img in enumerate(resp.get('images') or []):
        ref = img['url'] if isinstance(img, dict) else img
        data = (base64.b64decode(ref.split(',', 1)[1]) if ref.startswith('data:') else fetch(ref))
        f = os.path.join(dst, f'layer-{i}.png')
        with open(f, 'wb') as fh:
            fh.write(data)
        saved.append({'file': os.path.relpath(f, ROOT), 'bytes': len(data),
                      'width': img.get('width') if isinstance(img, dict) else None,
                      'height': img.get('height') if isinstance(img, dict) else None})
    with open(os.path.join(dst, 'meta.json'), 'w') as fh:
        json.dump({'source': src, 'numLayers': layers, 'caption': caption,
                   'timings': resp.get('timings'), 'seed': resp.get('seed'),
                   'layers': saved}, fh, indent=2)
    return slug, f'{len(saved)} layers -> {os.path.relpath(dst, ROOT)}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--layers', type=int, default=6)
    ap.add_argument('--sweep', default='', help='name:n,n — extra layer counts for one subject')
    args = ap.parse_args()
    names = [n.strip() for n in args.only.split(',') if n.strip()] or list(SUBJECTS)

    jobs = [(n, args.layers, None) for n in names]
    if args.sweep:
        who, counts = args.sweep.split(':')
        jobs += [(who, int(c), f'{who}-L{c}') for c in counts.split(',')]

    os.makedirs(OUT, exist_ok=True)
    with ThreadPoolExecutor(max_workers=len(jobs)) as ex:
        for slug, line in ex.map(lambda j: run(*j), jobs):
            print(f'{slug:16s} {line}')


if __name__ == '__main__':
    main()
