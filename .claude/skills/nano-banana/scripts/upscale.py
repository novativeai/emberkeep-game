#!/usr/bin/env python3
"""Upscale + de-artifact an image through Topaz on fal.ai.

  upscale.py IN.jpg -o OUT.png [--model CGI] [--factor 4]
             [--fix-compression 0.6] [--denoise 0.3] [--sharpen 0.2]

Why Topaz and not the alternatives (checked August 2026):

  fal-ai/topaz/upscale/image  is the only upscaler on fal that exposes real
    restoration controls — `fix_compression` (JPEG ringing/blocking),
    `denoise` and `sharpen` — rather than just resampling. It also ships a
    CGI model variant trained on rendered/synthetic imagery, which is what
    our map art is (docs/map-art-style.md: "closer to a stylised 3D render
    than hand-painted 2D").
  fal-ai/seedvr/upscale/image (SeedVR2) is excellent on generated *video* and
    takes only image_url + factor — no artifact controls.
  clarity / SUPIR / Redefine / Wonder are GENERATIVE upscalers. They invent
    detail, which on this art would redraw the tile lattice we spent so long
    getting regular. Avoid them for anything with authored geometry.

So: keep the model non-generative. `Redefine` and `Wonder 3` are exposed by the
same endpoint and WILL hallucinate — they are deliberately not the default.

Non-generative models: Standard V2 | CGI | High Fidelity V2 | Low Resolution V2
                      | Recovery V2 | Standard MAX | Text Refine
"""
import argparse
import base64
import json
import os
import ssl
import sys
import urllib.error
import urllib.request

URL = 'https://fal.run/fal-ai/topaz/upscale/image'
MIME = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.webp': 'image/webp'}
GENERATIVE = {'Redefine', 'Wonder', 'Wonder 3'}

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
    d = os.getcwd()
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
    sys.exit(f'no key — set {name.upper()} in the environment or a .env above {os.getcwd()}')


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('src')
    ap.add_argument('-o', '--out', required=True)
    ap.add_argument('--model', default='CGI')
    ap.add_argument('--factor', type=float, default=4)
    ap.add_argument('--fix-compression', type=float, default=0.6)
    ap.add_argument('--denoise', type=float, default=0.3)
    ap.add_argument('--sharpen', type=float, default=0.2)
    ap.add_argument('--allow-generative', action='store_true')
    args = ap.parse_args()

    if args.model in GENERATIVE and not args.allow_generative:
        sys.exit(f'{args.model} is generative and will invent detail — it can '
                 f'redraw authored geometry. Pass --allow-generative to insist.')

    ext = os.path.splitext(args.src)[1].lower()
    raw = base64.b64encode(open(args.src, 'rb').read()).decode()
    body = {
        'image_url': f'data:{MIME.get(ext, "image/jpeg")};base64,{raw}',
        'model': args.model,
        'upscale_factor': args.factor,
        'output_format': 'png' if args.out.lower().endswith('.png') else 'jpeg',
        'fix_compression': args.fix_compression,
        'denoise': args.denoise,
        'sharpen': args.sharpen,
        'face_enhancement': False,     # no faces here; it only adds risk
        'subject_detection': 'All',
    }
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method='POST',
                                 headers={'Authorization': f'Key {read_key()}',
                                          'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=1800, context=SSL_CTX) as r:
            resp = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f'fal error {e.code}: {e.read().decode()[:600]}')

    img = resp.get('image') or (resp.get('images') or [None])[0]
    if not img:
        sys.exit('no image in response: ' + json.dumps(resp)[:400])
    ref = img['url'] if isinstance(img, dict) else img
    if ref.startswith('data:'):
        out = base64.b64decode(ref.split(',', 1)[1])
    else:
        with urllib.request.urlopen(urllib.request.Request(
                ref, headers={'User-Agent': 'upscale'}), timeout=1800,
                context=SSL_CTX) as r:
            out = r.read()
    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or '.', exist_ok=True)
    with open(args.out, 'wb') as fh:
        fh.write(out)
    print(f'saved {args.out} ({len(out)} bytes) | topaz {args.model} x{args.factor} '
          f'| fix_compression {args.fix_compression} denoise {args.denoise} '
          f'sharpen {args.sharpen}')


if __name__ == '__main__':
    main()
