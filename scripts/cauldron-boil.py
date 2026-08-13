#!/usr/bin/env python3
"""The Runevault cauldron's boil loop — plate, generation, and registration.

    python3 scripts/cauldron-boil.py plate      # still art -> green plate
    python3 scripts/cauldron-boil.py gen        # plate -> Wan 2.7 -> raw mp4
    python3 scripts/cauldron-boil.py despill    # green steam -> brew violet
    python3 scripts/cauldron-boil.py register   # atlas frame 0 -> scale/dx/dy

The same three-stage shape as the dragon clips (scripts/anim-plate.py ->
anim-generate.py -> anim-ingest.py on main), specialised to a PROP: the pot
must not move at all — only its brew does — so the plate needs steam headroom
rather than wing room, and registration is a straight alpha-box match of the
atlas's base frame onto the still it replaces (frame 0 IS the still, because
the plate ships as both `image_url` and `end_image_url`, which is also what
closes the loop).

Keying and atlas packing are NOT here: that is anim-ingest.py's job, run
between `gen` and `register` —

    python3 <main>/scripts/anim-ingest.py \
        assets/raw/cauldron-boil/boil-raw.mp4 \
        --dir assets/raw/cauldron-boil/atlas --clip boil \
        --fps 12 --height 560 --trim-loop --skip 1

`register` then reads that atlas and writes the `cauldron.boil` clip into
src/data/character-anims.json with the display transform BoardScene needs.
"""
from __future__ import annotations

import base64
import json
import os
import ssl
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
STILL = ROOT / 'assets/sprites/environment/map/decor/pink_cauldron.webp'
WORK = ROOT / 'assets/raw/cauldron-boil'
PLATE = WORK / 'boil-plate.png'
RAW = WORK / 'boil-raw.mp4'
ATLAS_DIR = WORK / 'atlas'
ANIMS = ROOT / 'src/data/character-anims.json'
SHEET_OUT = ROOT / 'assets/sprites/anims/cauldron'

#: Steam headroom on top, breathing room elsewhere. The pads are recorded in
#: the manifest but registration never needs them — it matches content boxes.
PAD = {'top': 140, 'side': 60, 'bottom': 40}
GREEN = (0, 255, 0)

QUEUE = 'https://queue.fal.run/fal-ai/wan/v2.7/image-to-video'
PROMPT = (
    'The ornate engraved iron cauldron stands perfectly still. Only its contents '
    'move: the glowing violet-pink potion boils — fat round bubbles rise and '
    'burst on the surface, the liquid slowly swirls, its glow pulses gently '
    'brighter and dimmer, and thin wisps of pale violet steam curl up from the '
    'surface and drift away. The pot itself, its lid, its handle, its feet and '
    'its engravings do not move at all. Static locked-off camera, fixed framing, '
    'no camera movement. The background stays still.'
)
NEGATIVE = (
    'cropped, cut off, out of frame, camera movement, pan, zoom, the cauldron '
    'moving, rocking, tipping, walking, drifting, changing position, the lid '
    'opening or closing, background change, scene cut, morphing, extra objects, '
    'text, watermark, blurry, low quality'
)
DURATION = 5

try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context(
        cafile='/etc/ssl/cert.pem' if os.path.exists('/etc/ssl/cert.pem') else None)


def do_plate() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    art = Image.open(STILL).convert('RGBA')
    w = art.width + 2 * PAD['side']
    h = art.height + PAD['top'] + PAD['bottom']
    w += w % 2
    h += h % 2
    plate = Image.new('RGB', (w, h), GREEN)
    plate.paste(art, (PAD['side'], PAD['top']), art)
    plate.save(PLATE)
    print(json.dumps({'plate': str(PLATE), 'size': [w, h], 'pad': PAD}))


def read_key() -> str:
    val = os.environ.get('FAL_KEY', '').strip()
    if val:
        return val
    d = os.getcwd()
    while True:
        p = os.path.join(d, '.env')
        if os.path.exists(p):
            with open(p, encoding='utf-8') as fh:
                for line in fh:
                    if '=' in line and line.split('=', 1)[0].strip().lower() == 'fal_key':
                        return line.split('=', 1)[1].strip().strip('"\'')
        nd = os.path.dirname(d)
        if nd == d:
            raise SystemExit('no FAL_KEY in env or any .env up from cwd')
        d = nd


def api(url: str, key: str, payload: dict | None = None) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={'Authorization': f'Key {key}', 'Content-Type': 'application/json'},
        method='POST' if payload is not None else 'GET')
    with urllib.request.urlopen(req, context=SSL_CTX, timeout=120) as r:
        return json.loads(r.read())


def do_gen() -> None:
    key = read_key()
    uri = 'data:image/png;base64,' + base64.b64encode(PLATE.read_bytes()).decode()
    payload = {
        'prompt': PROMPT,
        'duration': DURATION,
        'image_url': uri,          # start == end == the rest plate ...
        'end_image_url': uri,      # ... which is what makes it loop
        'resolution': '720p',
        'negative_prompt': NEGATIVE,
        'enable_safety_checker': False,
        'enable_prompt_expansion': True
    }
    sub = api(QUEUE, key, payload)
    print(f'submitted {sub.get("request_id")}', flush=True)
    (WORK / 'generation-manifest.json').write_text(json.dumps(
        {'request_id': sub.get('request_id'), 'prompt': PROMPT,
         'negative_prompt': NEGATIVE, 'duration': DURATION,
         'resolution': '720p', 'plate': str(PLATE), 'pad': PAD}, indent=2) + '\n')
    t0 = time.time()
    while time.time() - t0 < 40 * 60:
        time.sleep(8)
        st = api(sub['status_url'], key)
        s = st.get('status')
        if s == 'COMPLETED':
            res = api(sub['response_url'], key)
            url = (res.get('video') or {}).get('url')
            if not url:
                raise SystemExit(f'completed but no video url: {json.dumps(res)[:400]}')
            with urllib.request.urlopen(url, context=SSL_CTX, timeout=300) as r:
                RAW.write_bytes(r.read())
            print(f'DONE -> {RAW} ({RAW.stat().st_size // 1024} KB)')
            return
        if s not in ('IN_QUEUE', 'IN_PROGRESS'):
            raise SystemExit(f'unexpected status {json.dumps(st)[:400]}')
    raise SystemExit('timed out')


def do_despill() -> None:
    """Green steam -> brew violet, in the atlas, deterministically.

    The one failure this workflow has that the dragon clips never met: steam is
    TRANSLUCENT new content, so the model paints it over the green plate and it
    picks the plate's colour up — the keyer then keeps it (it is well inside
    the subject gate) and the boil exhales green. Regenerating does not fix a
    physics problem, so the fix is a remap: pixels that are decidedly green
    (`g - max(r,b)` past a threshold — the pot's olive patina has r~g and never
    trips it) are pulled to a violet of the same luminance, blended by how
    green they were.
    """
    p = ATLAS_DIR / 'boil.webp'
    a = np.array(Image.open(p).convert('RGBA')).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    s = g - np.maximum(r, b)
    w = np.clip((s - 8) / 50, 0, 1)
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    a[..., 0] = r * (1 - w) + luma * 1.02 * w
    a[..., 1] = g * (1 - w) + luma * 0.52 * w
    a[..., 2] = b * (1 - w) + luma * 1.18 * w
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(
        p, 'WEBP', quality=84, method=6, alpha_quality=90)
    print(json.dumps({'despilled_px': int((w > 0.05).sum())}))


def content_box(a: np.ndarray, thr: int = 60) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(a[..., 3] > thr)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def do_register() -> None:
    """Atlas frame 0 == the still (same plate, start pinned), so the display
    transform is a straight content-box match — no landmarks, no guessing."""
    atlas = json.loads((ATLAS_DIR / 'atlas.json').read_text())
    clip = atlas['animations']['boil']
    sheet = Image.open(ATLAS_DIR / clip['file']).convert('RGBA')
    fw, fh = clip['frameWidth'], clip['frameHeight']
    f0 = np.array(sheet.crop((0, 0, fw, fh)))
    still = np.array(Image.open(STILL).convert('RGBA'))

    sl, st_, sr, sb = content_box(still)
    fl, ft, fr, fb = content_box(f0)
    # game px per atlas px: the still's content width over the frame's
    scale = (sr - sl) / (fr - fl)
    drift = abs((sb - st_) / (fb - ft) - scale) / scale
    if drift > 0.02:
        raise SystemExit(f'frame-0 aspect drifted {drift:.1%} from the still — '
                         'wan re-framed the pot; re-generate rather than shipping a lean')

    # Where the frame's content-box top-left lands on the still, in still px.
    dx = sl - fl * scale
    dy = st_ - ft * scale

    SHEET_OUT.mkdir(parents=True, exist_ok=True)
    src = ATLAS_DIR / clip['file']
    dst = SHEET_OUT / 'boil.webp'
    dst.write_bytes(src.read_bytes())

    doc = json.loads(ANIMS.read_text())
    doc.setdefault('characters', {}).setdefault('cauldron', {'clips': {}})['clips']['boil'] = {
        'file': 'sprites/anims/cauldron/boil.webp',
        'frames': clip['frames'],
        'frameWidth': fw,
        'frameHeight': fh,
        'fps': clip.get('fps', 12),
        'loop': True,
        # DECOR REGISTRATION, not the character bottom-centre convention:
        # scale is STILL px per atlas px, dx/dy put the frame's top-left in the
        # still's pixel space. BoardScene turns these into origin/displaySize
        # so the animated sprite occupies exactly the rectangle the still did.
        'scale': round(scale, 5),
        'dx': round(dx, 2),
        'dy': round(dy, 2),
        'srcFrameWidth': fw,
        'srcFrameHeight': fh,
        'stage': 'decor'
    }
    ANIMS.write_text(json.dumps(doc, indent=1) + '\n')
    print(json.dumps({'scale': round(scale, 5), 'dx': round(dx, 2), 'dy': round(dy, 2),
                      'frames': clip['frames'], 'sheet': str(dst),
                      'seam': atlas['animations']['boil'].get('seam')}))


if __name__ == '__main__':
    {'plate': do_plate, 'gen': do_gen, 'despill': do_despill,
     'register': do_register}[sys.argv[1]]()
