#!/usr/bin/env python3
"""
THE QA ACCOUNT, DELETED — so a screenshot run never leaves a real user behind.

    python3 testcapture/qa-account.py delete <email> [<email> ...]

The hub benches (capture-hub-shop.mjs H8–H12) sign in with a throwaway account on
@example.com, created through the site's own register form. This removes it
afterwards through Identity Toolkit's admin `accounts:batchDelete`, authorised by
the hub's service account.

SECRETS NEVER LEAVE THIS PROCESS. The service account is read from the hub's
.env.local (FIREBASE_SERVICE_ACCOUNT_BASE64) and nothing of it is printed. The
private key is written to a 0600 temp file only long enough for openssl to sign
one JWT, then removed — Python's stdlib has no RS256, and reaching Google from
node on this machine fails on IPv6 (memory: openssl + urllib is the way).
"""
import base64, json, os, subprocess, sys, tempfile, time, urllib.request, urllib.parse
from pathlib import Path

HUB = Path(os.environ.get('EMBERGAMES_ROOT', Path(__file__).resolve().parents[2] / 'embergames'))


def env_value(name: str) -> str:
    # .env.local first (a developer override), then .env — the hub keeps the
    # service account in .env, and a lookup that stopped at .env.local reported
    # it missing and deleted nothing.
    for fname in ('.env.local', '.env'):
        path = HUB / fname
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            if line.startswith(f'{name}='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    raise SystemExit(f'{name} missing from {HUB}/.env.local and {HUB}/.env')


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def access_token(sa: dict) -> str:
    now = int(time.time())
    header = b64url(json.dumps({'alg': 'RS256', 'typ': 'JWT'}).encode())
    claims = b64url(json.dumps({
        'iss': sa['client_email'],
        'scope': 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform',
        'aud': sa['token_uri'],
        'iat': now,
        'exp': now + 600,
    }).encode())
    signing_input = f'{header}.{claims}'.encode()
    fd, key_path = tempfile.mkstemp(suffix='.pem')
    try:
        os.chmod(key_path, 0o600)
        with os.fdopen(fd, 'w') as fh:
            fh.write(sa['private_key'])
        sig = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', key_path],
                             input=signing_input, capture_output=True, check=True).stdout
    finally:
        os.remove(key_path)
    jwt = f'{header}.{claims}.{b64url(sig)}'
    body = urllib.parse.urlencode({'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion': jwt}).encode()
    with urllib.request.urlopen(urllib.request.Request(sa['token_uri'], data=body), timeout=30) as res:
        return json.load(res)['access_token']


def call(url: str, token: str, payload: dict) -> dict:
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.load(res)


def main() -> None:
    if len(sys.argv) >= 3 and sys.argv[1] == 'sweep':
        prefix = sys.argv[2]
        if not prefix.startswith('keeper.qa.'):
            raise SystemExit('refusing: sweep only takes a keeper.qa.* prefix')
        sa = json.loads(base64.b64decode(env_value('FIREBASE_SERVICE_ACCOUNT_BASE64')))
        token = access_token(sa)
        base = f"https://identitytoolkit.googleapis.com/v1/projects/{sa['project_id']}"
        ids, emails_found, page = [], [], None
        while True:
            q = {'maxResults': 1000, **({'nextPageToken': page} if page else {})}
            req = urllib.request.Request(f"{base}/accounts:batchGet?{urllib.parse.urlencode(q)}",
                                         headers={'Authorization': f'Bearer {token}'})
            with urllib.request.urlopen(req, timeout=30) as res:
                data = json.load(res)
            for u in data.get('users', []):
                e = (u.get('email') or '').lower()
                if e.startswith(prefix) and e.endswith('@example.com'):
                    ids.append(u['localId']); emails_found.append(e)
            page = data.get('nextPageToken')
            if not page:
                break
        if not ids:
            print(f'  aucun compte {prefix}*@example.com'); return
        res = call(f'{base}/accounts:batchDelete', token, {'localIds': ids, 'force': True})
        print(f"  supprimé(s): {len(ids) - len(res.get('errors', []))}/{len(ids)} ({', '.join(emails_found)})")
        return
    if len(sys.argv) < 3 or sys.argv[1] != 'delete':
        raise SystemExit(__doc__)
    emails = sys.argv[2:]
    if not all(e.lower().endswith('@example.com') for e in emails):
        raise SystemExit('refusing: this tool only deletes @example.com QA accounts')
    sa = json.loads(base64.b64decode(env_value('FIREBASE_SERVICE_ACCOUNT_BASE64')))
    project = sa['project_id']
    token = access_token(sa)
    base = f'https://identitytoolkit.googleapis.com/v1/projects/{project}'
    found = call(f'{base}/accounts:lookup', token, {'email': emails}).get('users', [])
    ids = [u['localId'] for u in found]
    if not ids:
        print(f'  aucun compte trouvé pour {", ".join(emails)}')
        return
    res = call(f'{base}/accounts:batchDelete', token, {'localIds': ids, 'force': True})
    errors = res.get('errors', [])
    print(f'  supprimé(s): {len(ids) - len(errors)}/{len(ids)} ({", ".join(u.get("email", "?") for u in found)})')
    for err in errors:
        print(f'  ! {err}')


if __name__ == '__main__':
    main()
