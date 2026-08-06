#!/usr/bin/env python3
"""Emberkeep art generation router — the job picks the model, not the caller.

  artgen.py character "PROMPT" -o out.jpg [-i sheet.jpg ...] [--size 2048x1152]
  artgen.py concept   "PROMPT" -o out.jpg [-i ref ...] [--size 1536x1536]
  artgen.py map       "PROMPT" -o out.png [--ar 16:9] [-i ref ...]
  artgen.py map-pro   "PROMPT" -o out.png [--ar 16:9] [-i ref ...]
  artgen.py map-seedream "PROMPT" -o out.jpg [-i ref ...] [--size auto_2K]
  artgen.py sheet     "PROMPT" -o out.png [-i ref ...]
  artgen.py asset     "PROMPT" -o out.png [--ar 1:1] [-i ref ...]

  job        model                              size        provider
  character  Seedream 5.0 Pro                   2048x1152   fal.ai   FAL_KEY
  concept    Seedream 5.0 Lite                  1536x1536   fal.ai   FAL_KEY
  map        Nano Banana 2 (gemini-3.1-flash)   4K          Gemini   GOOGLE_KEY
  map-pro    Nano Banana Pro (gemini-3-pro)     4K          Gemini   GOOGLE_KEY
  map-seedream  Seedream 5.0 Pro                auto_2K     fal.ai   FAL_KEY
  map-seedream-4k  Seedream 5.0 Lite            auto_4K     fal.ai   FAL_KEY
  sheet      Nano Banana 2                      2K, 16:9    Gemini   GOOGLE_KEY
  sheet-pro  Nano Banana Pro (gemini-3-pro)     4K, 16:9    Gemini   GOOGLE_KEY
  asset      Nano Banana 2                      1K          Gemini   GOOGLE_KEY
  asset-seedream  Seedream 5.0 Lite             2048x2048   fal.ai   FAL_KEY

Keys come from the environment first, then the nearest `.env` walking up from
cwd. Gemini accepts google_key / GOOGLE_KEY / GOOGLE_API_KEY / GEMINI_KEY;
Seedream needs FAL_KEY. Keys are never printed.

Nano Banana 2 returns JPEG; if --out ends in .png the bytes are re-encoded so
the de-key chain gets the container it expects. The JPEG ringing around a
magenta key is still there, so keep key edges generous in the prompt.
"""
import argparse
import base64
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

NB2 = 'gemini-3.1-flash-image'
NB_PRO = 'gemini-3-pro-image'
GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
SEEDREAM_URL = 'https://fal.run/bytedance/seedream/{tier}/{endpoint}'

# The routing table. Changing a job's model is a one-line edit here.
JOBS = {
    'character': {'provider': 'seedream', 'tier': 'v5/pro', 'size': '2048x1152'},
    'concept': {'provider': 'seedream', 'tier': 'v5/lite', 'size': '1536x1536'},
    'map': {'provider': 'gemini', 'model': NB2, 'size': '4K', 'ar': '16:9'},
    'map-pro': {'provider': 'gemini', 'model': NB_PRO, 'size': '4K', 'ar': '16:9'},
    'map-seedream': {'provider': 'seedream', 'tier': 'v5/pro', 'size': 'auto_2K'},
    'map-seedream-4k': {'provider': 'seedream', 'tier': 'v5/lite', 'size': 'auto_4K'},
    'sheet': {'provider': 'gemini', 'model': NB2, 'size': '2K', 'ar': '16:9',
              'lock_ar': True},
    # Same job at 4K (5504x3072). Worth it when the sheet is a GRID and each
    # cell has to survive being sliced out and used on its own — a 4x2 grid at
    # 2K leaves 688x768 per cell, which is under a dialogue portrait's size.
    'sheet-4k': {'provider': 'gemini', 'model': NB2, 'size': '4K', 'ar': '16:9',
                 'lock_ar': True},
    # Same job at 21:9 — the ratio a SHORT grid actually wants. A 3x1 of a
    # taller-than-wide subject lands near 21:9, and forcing it into 16:9 makes
    # each cell too narrow to hold the subject AND a margin: the mask ends up
    # filling its cell, the model paints past it, and neighbouring cells run
    # into each other (that is exactly how the v2 blink sheet became
    # unsliceable). Letterboxing the template to 16:9 instead is worse — it
    # renders fine but silently breaks every transform derived from the
    # template's geometry, crossalign.py included.
    'sheet-wide': {'provider': 'gemini', 'model': NB2, 'size': '4K', 'ar': '21:9',
                   'lock_ar': True},
    # Same job on Nano Banana PRO. Reach for it when the sheet's LAYOUT is the
    # product — a parts sheet where every cell must come back holding the same
    # part at the same size (dragonbreed.py), not a free-hand set of poses. The
    # shop bake-off found Pro the one route that reliably obeys a stated
    # structure; NB2 drifts toward a house style of its own.
    'sheet-pro': {'provider': 'gemini', 'model': NB_PRO, 'size': '4K', 'ar': '16:9',
                  'lock_ar': True},
    'asset': {'provider': 'gemini', 'model': NB2, 'size': '1K', 'ar': '1:1'},
    # Local EDIT of a single plate: one reference in, the same drawing back with
    # one thing changed. Use it instead of a fresh generation whenever the
    # output has to stay pixel-compatible with the input — an animation frame
    # that must composite over its own base plate, a variant of an approved
    # asset. A generation, even one referencing the plate, re-paints the subject
    # and lands at its own proportions; an edit does not. `--ar` matters here:
    # pad the source to an offered ratio first, or the model reframes it.
    'edit': {'provider': 'gemini', 'model': NB2, 'size': '2K', 'ar': '1:1'},
    # Seedream's LITE edit route floors at ~3.7 MP total pixels, so an "icon
    # sized" request is impossible — 2048x2048 is the smallest square it takes.
    # De-key and downsize afterwards; the extra resolution is free quality.
    'asset-seedream': {'provider': 'seedream', 'tier': 'v5/lite', 'size': '2048x2048'},
}

MIME = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.webp': 'image/webp'}
GOOGLE_NAMES = ('google_key', 'google_api_key', 'gemini_key')

# macOS pythons often ship without system CA certs wired up — prefer certifi.
try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context(
        cafile='/etc/ssl/cert.pem' if os.path.exists('/etc/ssl/cert.pem') else None)


def read_key(names, env_file=None):
    """Environment first, then the nearest .env walking up from cwd."""
    for n in names:
        val = os.environ.get(n.upper(), '').strip()
        if val:
            return val
    candidates = []
    if env_file:
        candidates.append(os.path.abspath(env_file))
    d = os.getcwd()
    while True:
        candidates.append(os.path.join(d, '.env'))
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    for path in candidates:
        if not os.path.exists(path):
            continue
        with open(path, encoding='utf-8') as fh:
            for line in fh:
                line = line.strip()
                if line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                if k.strip().lower() in names:
                    return v.strip().strip('"\'')
    sys.exit(f'no key found — set {names[0].upper()} in the environment or in '
             f'a .env at or above {os.getcwd()}')


def data_uri(path):
    ext = os.path.splitext(path)[1].lower()
    raw = base64.b64encode(open(path, 'rb').read()).decode()
    return f'data:{MIME.get(ext, "image/jpeg")};base64,{raw}'


def post(url, body, headers, timeout):
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 method='POST', headers=headers)
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as res:
        return json.load(res)


def write(path, raw, mime=''):
    """Write bytes, re-encoding when the container does not match the suffix."""
    os.makedirs(os.path.dirname(os.path.abspath(path)) or '.', exist_ok=True)
    want = MIME.get(os.path.splitext(path)[1].lower())
    if want and mime and want != mime:
        try:
            import io

            from PIL import Image
            Image.open(io.BytesIO(raw)).save(path)
            return os.path.getsize(path)
        except ImportError:
            print(f'warning: got {mime}, wanted {want}; Pillow missing, '
                  f'writing raw bytes', file=sys.stderr)
    with open(path, 'wb') as fh:
        fh.write(raw)
    return len(raw)


def run_gemini(spec, args):
    """Nano Banana 2 via generateContent — returns PNG, retries on throttle."""
    key = read_key(GOOGLE_NAMES, args.env_file)
    parts = []
    for ref in args.image:
        ext = os.path.splitext(ref)[1].lower()
        parts.append({'inlineData': {'mimeType': MIME.get(ext, 'image/jpeg'),
                                     'data': base64.b64encode(open(ref, 'rb').read()).decode()}})
    parts.append({'text': args.prompt})
    body = {
        'contents': [{'parts': parts}],
        'generationConfig': {
            'responseModalities': ['TEXT', 'IMAGE'],
            'imageConfig': {'aspectRatio': args.ar or spec['ar'],
                            'imageSize': spec['size']},
        },
    }
    url = GEMINI_URL.format(model=spec['model'])
    headers = {'Content-Type': 'application/json', 'x-goog-api-key': key}

    last = 'unknown'
    for attempt in range(args.retries):
        try:
            data = post(url, body, headers, 300)
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', 'replace')[:300]
            last = f'HTTP {e.code}: {detail}'
            if e.code in (429, 500, 502, 503) and attempt < args.retries - 1:
                wait = 8 * (attempt + 1)
                print(f'retryable {e.code}, waiting {wait}s…', file=sys.stderr)
                time.sleep(wait)
                continue
            sys.exit(last)
        except urllib.error.URLError as e:
            last = f'network: {e.reason}'
            time.sleep(5)
            continue

        out = (data.get('candidates') or [{}])[0].get('content', {}).get('parts', [])
        for part in out:
            inline = part.get('inlineData')
            if inline and inline.get('data'):
                raw = base64.b64decode(inline['data'])
                mime = inline.get('mimeType', '')
                size = write(args.out, raw, mime)
                return (f'{spec["model"]} | {spec["size"]} | '
                        f'{args.ar or spec["ar"]} | from {mime or "?"}'), size
        # No image part: a safety refusal or a text-only answer. Surface it.
        texts = ' '.join(p.get('text', '') for p in out)[:300]
        last = 'no image in response: ' + (texts or json.dumps(data)[:200])
        if attempt < args.retries - 1:
            time.sleep(4)
    sys.exit(last)


def run_seedream(spec, args):
    """Seedream via fal.ai — /edit when references are attached."""
    key = read_key(('fal_key',), args.env_file)
    # image_size is either explicit WxH or one of fal's presets.
    #
    # Seedream 5.0 PRO is hard-capped at 1024x1024..2048x2048 TOTAL PIXELS
    # (~4.2 MP) on both its text-to-image and edit routes. It does not error on
    # a bigger request — it silently clamps, so asking pro/edit for 4096x2560
    # returns ~2900x1450. 4K is only reachable on the v5/LITE edit route, whose
    # range is 2560x1440..4096x4096 and which alone accepts auto_3K/auto_4K.
    # That is what `map-seedream-4k` is for: Lite re-rendering Pro's artwork.
    # auto_* preserves the references' aspect ratio, which is how a 16:10
    # backdrop survives a model with no 16:10 preset.
    size = args.size or spec['size']
    if 'x' in size.lower():
        w, h = (int(v) for v in size.lower().split('x'))
        body = {'prompt': args.prompt, 'image_size': {'width': w, 'height': h}}
        label_size = f'{w}x{h}'
    else:
        body = {'prompt': args.prompt, 'image_size': size}
        label_size = size
    url = SEEDREAM_URL.format(
        tier=spec['tier'],
        endpoint='edit' if args.image else 'text-to-image')
    if args.image:
        body['image_urls'] = [data_uri(p) for p in args.image]
    try:
        resp = post(url, body, {'Authorization': f'Key {key}',
                                'Content-Type': 'application/json'}, 900)
    except urllib.error.HTTPError as e:
        sys.exit(f'fal error {e.code}: {e.read().decode()[:600]}')

    images = resp.get('images') or ([resp['image']] if 'image' in resp else [])
    if not images:
        sys.exit('no image in response: ' + json.dumps(resp)[:500])
    ref = images[0]['url'] if isinstance(images[0], dict) else images[0]
    if ref.startswith('data:'):
        raw = base64.b64decode(ref.split(',', 1)[1])
    else:
        req = urllib.request.Request(ref, headers={'User-Agent': 'artgen'})
        with urllib.request.urlopen(req, timeout=600, context=SSL_CTX) as r:
            raw = r.read()
    nbytes = write(args.out, raw, 'image/jpeg')
    return f'seedream-5.0-{spec["tier"].split("/")[1]} | {label_size}', nbytes


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('job', choices=sorted(JOBS))
    ap.add_argument('prompt')
    ap.add_argument('-o', '--out', required=True)
    ap.add_argument('-i', '--image', action='append', default=[],
                    help='reference image, repeatable (attached before the prompt)')
    ap.add_argument('--ar', default=None, help='aspect ratio (Gemini jobs)')
    ap.add_argument('--size', default=None, help='WxH (character job only)')
    ap.add_argument('--env-file', default=None)
    ap.add_argument('--retries', type=int, default=4)
    args = ap.parse_args()

    spec = JOBS[args.job]
    if spec.get('lock_ar') and args.ar and args.ar != spec['ar']:
        sys.exit(f'{args.job} is locked to {spec["ar"]}')
    if args.size and spec['provider'] != 'seedream':
        sys.exit('--size is fixed by the job for Gemini routes; use --ar')

    runner = run_seedream if spec['provider'] == 'seedream' else run_gemini
    label, size = runner(spec, args)
    print(f'saved {args.out} ({size} bytes) | {args.job} -> {label} '
          f'| refs: {len(args.image)}')


if __name__ == '__main__':
    main()
