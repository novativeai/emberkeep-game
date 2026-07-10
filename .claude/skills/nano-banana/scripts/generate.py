#!/usr/bin/env python3
"""Generate an image with Google's Nano Banana Pro (Gemini 3 Pro Image).

Usage:
  python3 generate.py --prompt "..." --out raw.png [--aspect 4:3] [--size 2K]
                      [--model gemini-3-pro-image] [--env-file .env]

The API key is read from $GOOGLE_KEY, else `google_key=`/`GOOGLE_KEY=` in the
env file (default: ./.env). The key is never printed.
Returns exit 0 and prints the saved path + mime on success.
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

ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'

# macOS pythons often ship without system CA certs wired up — prefer certifi.
try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:  # fall back to the default chain
    SSL_CTX = ssl.create_default_context()


def read_key(env_file: str) -> str:
    key = os.environ.get('GOOGLE_KEY', '').strip()
    if key:
        return key
    try:
        with open(env_file, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line.lower().startswith(('google_key=', 'google_api_key=')):
                    return line.split('=', 1)[1].strip().strip('"\'')
    except OSError:
        pass
    sys.exit('No API key: set GOOGLE_KEY or put google_key=... in ' + env_file)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--prompt', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--aspect', default='1:1',
                    choices=['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'])
    ap.add_argument('--size', default='2K', choices=['512px', '1K', '2K', '4K'])
    ap.add_argument('--model', default='gemini-3-pro-image')
    ap.add_argument('--env-file', default='.env')
    ap.add_argument('--retries', type=int, default=4)
    ap.add_argument('--ref', action='append', default=[],
                    help='reference image path(s), attached IN ORDER before the '
                         'prompt (Image 1, Image 2, … — up to 14)')
    args = ap.parse_args()

    key = read_key(args.env_file)
    parts = []
    for ref in args.ref:
        mime = 'image/png' if ref.lower().endswith('.png') else 'image/jpeg'
        with open(ref, 'rb') as f:
            parts.append({'inlineData': {'mimeType': mime, 'data': base64.b64encode(f.read()).decode()}})
    parts.append({'text': args.prompt})
    body = json.dumps({
        'contents': [{'parts': parts}],
        'generationConfig': {
            'responseModalities': ['TEXT', 'IMAGE'],
            'imageConfig': {'aspectRatio': args.aspect, 'imageSize': args.size},
        },
    }).encode()

    last_err = 'unknown'
    for attempt in range(args.retries):
        req = urllib.request.Request(
            ENDPOINT.format(model=args.model), data=body, method='POST',
            headers={'Content-Type': 'application/json', 'x-goog-api-key': key})
        try:
            with urllib.request.urlopen(req, timeout=180, context=SSL_CTX) as res:
                data = json.load(res)
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', 'replace')[:300]
            last_err = f'HTTP {e.code}: {detail}'
            if e.code in (429, 500, 502, 503) and attempt < args.retries - 1:
                wait = 8 * (attempt + 1)
                print(f'retryable {e.code}, waiting {wait}s…', file=sys.stderr)
                time.sleep(wait)
                continue
            sys.exit(last_err)
        except urllib.error.URLError as e:
            last_err = f'network: {e.reason}'
            time.sleep(5)
            continue

        parts = (data.get('candidates') or [{}])[0].get('content', {}).get('parts', [])
        for part in parts:
            inline = part.get('inlineData')
            if inline and inline.get('data'):
                raw = base64.b64decode(inline['data'])
                with open(args.out, 'wb') as f:
                    f.write(raw)
                print(f'saved {args.out} ({inline.get("mimeType", "?")}, {len(raw)} bytes)')
                return
        # No image part (safety refusal or text-only answer) — surface the text.
        texts = ' '.join(p.get('text', '') for p in parts)[:300]
        last_err = 'no image in response: ' + (texts or json.dumps(data)[:200])
        if attempt < args.retries - 1:
            time.sleep(4)
    sys.exit(last_err)


if __name__ == '__main__':
    main()
