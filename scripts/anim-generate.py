#!/usr/bin/env python3
"""Generation plates → source videos: the SECOND stage of the video-animation
workflow (fal-ai/wan/v2.7/image-to-video over the queue API).

Every job sends the dragon's green generation plate (scripts/anim-plate.py) as
BOTH `image_url` and `end_image_url` — start and end pinned to the same rest
pose is what makes the clip loop, and the green plate is what lets
scripts/anim-ingest.py key the result back out. Prompts are the authored clip
briefs below; outputs land in assets/raw/new-animations/raw-mp4/ next to the
originals, with a manifest recording every request for reproducibility.

  anim-generate.py --list              show the 13 jobs
  anim-generate.py                     submit + await ALL jobs
  anim-generate.py frost_baby-idle …   just the named job(s)
  anim-generate.py --dry               print payload summaries, no spend

Requires FAL_KEY (env or .env `fal_key=`). Each job is real money — the
default run submits everything in parallel and polls until done.
"""

from __future__ import annotations

import base64
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

QUEUE = 'https://queue.fal.run/fal-ai/wan/v2.7/image-to-video'
PLATES = Path('assets/raw/new-animations/plates')
OUT = Path('assets/raw/new-animations/raw-mp4')
MANIFEST = OUT / 'generation-manifest.json'

try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context(
        cafile='/etc/ssl/cert.pem' if os.path.exists('/etc/ssl/cert.pem') else None)

NEGATIVE = (
    'cropped, cut off, out of frame, wings clipped, camera movement, pan, '
    'zoom, walking, flying away, drifting, changing position, background '
    'change, scene cut, morphing anatomy, extra limbs, extra wings, changing '
    'proportions, text, watermark, blurry, low quality, '
    # The golden elder's first lowflight came back wreathed in purple magic
    # clouds — pretty, and unkeyable: the green keyer can only remove GREEN.
    # Nothing may ever be painted over the plate but the animal itself.
    'smoke, mist, clouds, magic particles, sparkles, glowing dust, aura, '
    'energy effects, fire, embers, motion trails'
)

BABY_FOOTER = (
    'Static locked-off camera, fixed framing, no camera movement. '
    'The background stays still.'
)
ADULT_FOOTER = (
    'The whole dragon stays fully inside the frame, nothing cut off. '
    'Static locked-off camera, no camera movement. The background stays still.'
)
KEEPER_FOOTER = (
    'She is a human woman, not a creature: she stays standing on the same spot '
    'with her feet planted and her weight on both legs. She does not walk, '
    'turn around, step forward or lean out of position. '
    'NOTHING MAY REACH THE EDGE OF THE FRAME. She, her hair, her clothing, her '
    'scepter and every spark or beam of light stay well inside the picture with '
    'clear empty space on all four sides at all times; nothing is cut off by '
    'the top, the sides or the bottom. '
    'Static locked-off camera, no camera movement, no zoom, no pan. The flat '
    'background stays completely empty and untouched — no ground, no shadow, '
    'no scenery, no sky.'
)
PORTRAIT_FOOTER = (
    'This is a close bust portrait: only the head, neck and upper chest are in '
    'shot, and the chest runs off the bottom edge of the frame. The head stays '
    'exactly where it is in the frame at exactly the same size — it must not '
    'drift up, down or sideways, and must never touch or cross the top or side '
    'edges. No shoulders, arms, wings, hands or body appear. '
    'Static locked-off camera, no camera movement, no zoom. The flat background '
    'stays completely empty and untouched.'
)

CLIPS = {
    'baby': {
        'idle': {
            'duration': 7,
            'prompt': (
                'the dragon is in a idle loop state, breathing loop, blink fast '
                'once, tails subtly continuously moves right and left slowly, '
                'wings follows in/out breathing loop motion, idle motion never '
                f'stop. {BABY_FOOTER}'
            )
        },
        'roar': {
            'duration': 3,
            'prompt': (
                'the dragon roar in a cute way, with natural secondary body '
                f'motion. {BABY_FOOTER}'
            )
        }
    },
    'adult': {
        'idle': {
            'duration': 5,
            'prompt': (
                'The dragon stands still, breathing slowly. Its chest expands '
                'and contracts. It blinks twice. The head drifts slightly and '
                f'the tail sways. The wings stay folded. {ADULT_FOOTER}'
            )
        },
        'roar': {
            'duration': 3,
            'prompt': (
                'The dragon rears back, then thrusts its head forward and roars '
                'with jaws wide open, wings flaring half-open. The head lowers '
                'and the wings fold back as it settles. Its feet stay planted. '
                f'{ADULT_FOOTER}'
            )
        },
        'lowflight': {
            'duration': 10,
            'prompt': (
                'The dragon hovers, wings beating steadily. The body stays '
                'fixed in one position, not rising, sinking or drifting. The '
                'legs hang below, the tail trails, the head moves slightly. '
                'The whole dragon stays fully inside the frame, wingtips never '
                'crossing the edge. No smoke, no clouds, no sparkles, no magic '
                'effects — the plain flat background stays completely empty '
                'and untouched. Static locked-off camera, no camera movement. '
                'The background stays still.'
            )
        }
    },
    # ---- KEEPER LOOKS (the board standee of a bought outfit) -----------------
    # The two clips a world character actually plays, and no more: her idle is
    # what she does all day, her cast is the answer to `character:action_used`.
    # Both are described against the SHIPPED banks rather than invented — the
    # cast in particular is not a generic spell: her scepter gem flares and
    # throws a bolt of light sideways past her elbow
    # (`sprites/<who>/world-cast.webp`, frames 5-7), and it ends back on the
    # rest pose so the one-shot can settle into the idle without a jump.
    'keeper': {
        'idle': {
            'duration': 5,
            'prompt': (
                'The woman stands at rest, breathing slowly and evenly. Her '
                'chest and shoulders rise and fall a little, her head drifts a '
                'few degrees and settles, she blinks twice, and her loose hair '
                'and light clothing sway very gently as if in a soft breeze. '
                'She holds her scepter upright in the same hand, steady, its tip '
                'resting on the ground. The motion is small and calm and never '
                f'stops. {KEEPER_FOOTER}'
            )
        },
        'cast': {
            'duration': 4,
            # v2 of this prompt. v1 asked for "a bolt of light shooting out
            # sideways" — the authored bank's ember bolt — and wan took it to
            # the wall: measured at 12fps, 23 of Eleanor's 45 frames and 20 of
            # Selyna's had the beam crossing the plate's LEFT edge, through
            # ~250px of margin. A beam that exits the canvas ships as a beam
            # ending in a straight cut mid-air. So the bolt became a BURST:
            # everything the spell does now happens within a forearm of the
            # gem, and the word "beam" appears only as a prohibition.
            'prompt': (
                'The woman casts a spell with her scepter. She lifts it a '
                'little and steadies it in front of her; the gem at its head '
                'glows, then bursts into a COMPACT star-shaped flash of warm '
                'magical light with a few small sparks that arc outward no '
                'farther than a hand-width from the gem before winking out. '
                'The whole effect is a small tight burst centred on the gem — '
                'NO long beam, NO ray, NO bolt flying away, nothing streaking '
                'across the picture. She lowers the scepter and settles back '
                'to exactly the calm standing rest pose she began in, so the '
                'first and last frames match. Her feet never leave the ground '
                f'and her body stays in the same spot. {KEEPER_FOOTER}'
            )
        }
    },
    # ---- DIALOGUE BUST (the ring, not the board) -----------------------------
    # A different problem from every stage above: the subject is a head and a
    # neck at conversational distance, and the frame it is animated in IS the
    # frame the ring mounts. Nothing may grow into headroom, because there is no
    # headroom to grow into — `portraitView` fixes the framing and a bust that
    # rises mid-clip swims inside the ring window.
    #
    # Two clips, matching what CharacterBubble asks every animated speaker for:
    # `blinking` is the rest loop it settles into, `talking` is what plays while
    # a line is on screen. A dragon muzzle has no visemes to read, so talking is
    # a JAW CYCLE — the same reasoning sequenceCatalog.ts records for her old
    # four-pose bank, now carried by real footage instead of three composites.
    'portrait': {
        'blinking': {
            'duration': 4,
            'prompt': (
                'The dragon is at rest, listening. She breathes slowly and '
                'evenly, her neck and chest rising and falling a little. Her '
                'head drifts a few degrees and settles. She blinks twice, '
                'unhurried. Her mouth stays CLOSED the whole time — no teeth, '
                'no jaw movement. Calm and ancient, not aggressive. '
                f'{PORTRAIT_FOOTER}'
            )
        },
        'talking': {
            'duration': 3,
            'prompt': (
                'The dragon is speaking. Her lower jaw opens and closes in a '
                'steady, continuous rhythm as she talks — small, then wide, '
                'then small again, over and over, never stopping and never '
                'holding still. Her head tilts and nods slightly with the '
                'words and she blinks once. Calm and ancient, addressing '
                'someone in front of her; she is talking, not roaring, so the '
                'jaw never gapes fully open and the lips never pull back into '
                f'a snarl. {PORTRAIT_FOOTER}'
            )
        }
    }
}

# plate name → stage. Ember is ADULT ONLY — the baby (redwhelp) is already
# fully mounted from the original hand-made clips.
PLATE_STAGES = {
    'frost_baby': 'baby',
    'frost_adult': 'adult',
    'storm_baby': 'baby',
    'storm_adult': 'adult',
    'ember_adult': 'adult',
    'golden_adult': 'adult',  # the Golden Elder — same three adult clips
    'moonwhisker_baby': 'baby',
    'moonwhisker_adult': 'adult',
    # The legendaries — young only (neither chain has an adult tier), so two
    # clips each: the grounded idle and the bellow.
    'ashdrake_young': 'baby',
    'rimewyrm_young': 'baby',
    # The last three off the pin rigs. The Green Dragon has no clip set at all
    # (only its moonwhisker skin did), and the two Emporium skins were never
    # animated — so the rig was the ONLY thing keeping them moving, and it
    # cannot be deleted until these exist.
    'emerald_baby': 'baby',
    'emerald_adult': 'adult',
    'ashglass_baby': 'baby',
    'ashglass_adult': 'adult',
    'porcelain_baby': 'baby',
    'porcelain_adult': 'adult',
    # The Golden Elder AGAIN, but as a talking head rather than an animal: her
    # `golden_adult` plate above is the altar fixture, this one is the dialogue
    # bust (scripts/gen-elder-portrait.py). Same dragon, different stage, and
    # the two never share a clip — hence a plate of its own.
    'golden_elder': 'portrait',
    # The keeper looks. Two clips each, and only two: a bought outfit answers
    # the same two events the authored standee does.
    'eleanor_beach': 'keeper',
    'selyna_beach': 'keeper'
}


def jobs() -> list[dict]:
    out = []
    for plate, stage in PLATE_STAGES.items():
        for clip, spec in CLIPS[stage].items():
            out.append({
                'id': f'{plate}-{clip}',
                'plate': plate,
                'clip': clip,
                'duration': spec['duration'],
                'prompt': spec['prompt']
            })
    return out


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
        method='POST' if payload is not None else 'GET'
    )
    try:
        with urllib.request.urlopen(req, context=SSL_CTX, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors='replace')[:600]
        raise SystemExit(f'HTTP {e.code} on {url.split("?")[0]}: {body}') from e


def data_uri(path: Path) -> str:
    return 'data:image/png;base64,' + base64.b64encode(path.read_bytes()).decode()


def main() -> None:
    argv = [a for a in sys.argv[1:]]
    dry = '--dry' in argv
    show = '--list' in argv
    names = [a for a in argv if not a.startswith('--')]
    todo = [j for j in jobs() if not names or j['id'] in names]
    unknown = set(names) - {j['id'] for j in todo}
    if unknown:
        raise SystemExit(f'unknown job(s): {", ".join(sorted(unknown))}')
    if show:
        for j in jobs():
            print(f"{j['id']:24s} {j['duration']}s")
        return

    if dry:
        for j in todo:
            print(f"{j['id']}: {j['duration']}s  prompt[{len(j['prompt'])}ch]  plate={PLATES / (j['plate'] + '-plate.png')}")
        return

    key = read_key()
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {'jobs': {}}

    # SUBMIT everything up front — the queue runs them server-side in parallel.
    pending: dict[str, dict] = {}
    for j in todo:
        plate = PLATES / f"{j['plate']}-plate.png"
        if not plate.exists():
            raise SystemExit(f'{j["id"]}: missing plate {plate} — run scripts/anim-plate.py first')
        uri = data_uri(plate)
        payload = {
            'prompt': j['prompt'],
            'duration': j['duration'],
            'image_url': uri,
            'end_image_url': uri,
            'resolution': '720p',
            'negative_prompt': NEGATIVE,
            'enable_safety_checker': False,
            'enable_prompt_expansion': True
        }
        sub = api(QUEUE, key, payload)
        pending[j['id']] = {'job': j, 'status_url': sub['status_url'], 'response_url': sub['response_url']}
        manifest['jobs'][j['id']] = {
            'request_id': sub.get('request_id'),
            'duration': j['duration'],
            'prompt': j['prompt'],
            'negative_prompt': NEGATIVE,
            'resolution': '720p',
            'plate': str(plate)
        }
        print(f"submitted {j['id']} ({j['duration']}s) → {sub.get('request_id')}")
    MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n')

    # POLL until every job lands (or fails loudly).
    t0 = time.time()
    while pending and time.time() - t0 < 45 * 60:
        time.sleep(6)
        for jid in list(pending):
            p = pending[jid]
            st = api(p['status_url'], key)
            s = st.get('status')
            if s == 'COMPLETED':
                res = api(p['response_url'], key)
                url = (res.get('video') or {}).get('url')
                if not url:
                    raise SystemExit(f'{jid}: completed but no video url: {json.dumps(res)[:400]}')
                dst = OUT / f'{jid}.mp4'
                with urllib.request.urlopen(url, context=SSL_CTX, timeout=300) as r:
                    dst.write_bytes(r.read())
                manifest['jobs'][jid]['file'] = str(dst)
                manifest['jobs'][jid]['bytes'] = dst.stat().st_size
                MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n')
                print(f'DONE {jid} → {dst} ({dst.stat().st_size // 1024} KB)')
                del pending[jid]
            elif s not in ('IN_QUEUE', 'IN_PROGRESS'):
                raise SystemExit(f'{jid}: unexpected status {json.dumps(st)[:400]}')
    if pending:
        raise SystemExit(f'timed out waiting on: {", ".join(pending)}')
    print('ALL JOBS COMPLETE')


if __name__ == '__main__':
    main()
