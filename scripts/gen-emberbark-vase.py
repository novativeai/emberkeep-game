#!/usr/bin/env python3
"""The Ash Moss generator, redrawn as a silver reliquary vase — model shoot.

    python3 scripts/gen-emberbark-vase.py gen     # one plate per model
    python3 scripts/gen-emberbark-vase.py cut     # de-key, trim, size to board
    python3 scripts/gen-emberbark-vase.py gen --only nb-pro

WHAT IS BEING REPLACED

`item_emberbark_1` — the Emberbark Stump, the game's FIRST interaction
(`moss_stump`) and the only farm Ash Moss has. A burned stump wearing a cap of
moss: it reads, but it says the moss is growing BACK on its own, which is the
opposite of the lore.

THE LORE THIS ART HAS TO CARRY

The isle was a vast field of magic grass — where dragons lay down, and what
dragons ate — and it burned. What stands here is the LAST OF IT, and somebody
thought enough of that to put it in silver. So the piece is a reliquary, not a
planter: the vessel is worth more than a vessel needs to be, and the moss inside
it is a survival rather than a crop.

That reframes the tutorial's first line for free — "it will always grow more" is
still true and now costs something to say.

WHY THE MOSS MAY NOT SPILL OVER THE RIM

Two reasons, one aesthetic and one mechanical. A vase that overflows reads as
abundance, and the whole point is that this is what is left. And the silhouette
has to stay a VASE at 200 units — moss breaking the rim turns a hard, readable
metal outline into a fuzzy blob, which is exactly the failure the merge house
style's keyline exists to prevent.

REFERENCES ARE THE SHIPPED ART, NOT A DESCRIPTION

Two images go in: the house-style plate (`merge_style.style_ref`) for the
RENDERING, and the shipped `ashmoss_3` Green Bale for the moss's own colour, so
the tuft the vase drops and the moss in its mouth are the same plant.

SIZE. The stump is 642x542 at ITEM_SCALE 0.32 — about 205 units on its widest
axis. A standing vase is taller than it is wide, so the cut here targets the
same ~205 units on its LONGEST axis and the scale stays 0.32. Its `anchors.json`
value will NOT carry over: 0.66 was eyeballed for a low wide stump whose mass
sits well above its alpha bottom, and a vase's ground contact is its own foot.
Re-derive it by compositing art over shadow, the way that comment says.
"""
import argparse
import pathlib
import subprocess
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
ARTGEN = ROOT / '.claude/skills/nano-banana/scripts/artgen.py'
WORK = ROOT / 'assets/raw/merge-chains/emberbark-vase'
#: The shipped Green Bale — the moss's own colour, so the two never drift apart.
MOSS_REF = ROOT / 'assets/sprites/items/chains/ashmoss_3.webp'
#: On-board units on the longest axis, matched to the stump it replaces.
TARGET_UNITS = 205
ITEM_SCALE = 0.32

sys.path.insert(0, str(ROOT / 'scripts'))
from merge_style import TAIL_MAGENTA, dekey, head, style_ref  # noqa: E402

BRIEF = (
    'A SILVER RELIQUARY VASE holding the last of the magic grass.\n\n'
    'THE STORY THE OBJECT TELLS — this isle was once a vast field of magic grass, where the '
    'dragons lay down to rest and what the dragons ate, and it burned. This vase holds what '
    'survived. It is a reliquary, not a planter: the vessel is far finer than a pot needs to be, '
    'because of what is in it.\n\n'
    'THE VESSEL — one tall STANDING vase, clearly upright and taller than it is wide, in warm '
    'antique silver. A wide flaring mouth, a full rounded shoulder, a narrow waist and a heavy '
    'stepped foot it plants firmly on the ground. Its whole body is worked in deep REPOUSSÉ — '
    'hammered from behind so the ornament stands PROUD of the surface in high relief: a long '
    'dragon coiling once around the belly of the vase, its head raised at the shoulder and its '
    'tail curling down toward the foot, with scalloped scales, a raised wing edge, and a band of '
    'embossed knotwork running around the rim and around the foot. The relief is BOLD AND '
    'CHUNKY — a few large raised forms that read as a dragon at a glance, never fine engraving '
    'or filigree or scratched line-work.\n\n'
    'THE SILVER — old silver, not chrome and not white. Warm pale grey metal with deep near-black '
    'tarnish pooling in every recess of the repoussé, and bright polished highlights riding along '
    'the raised edges — the contrast between tarnished hollows and polished ridges is what makes '
    'the dragon readable. Broad soft highlight bands, one crisp white specular on the shoulder, '
    'and a warm bounce along the lower edge. Painted metal, never a mirror and never a '
    'ray-traced reflection.\n\n'
    'THE MOSS — Image 2 is the moss REFERENCE: match its colour and its soft clumped texture '
    'exactly, the same yellow-green magic moss with its deeper green shadows and its few bright '
    'dew beads. It sits INSIDE the mouth of the vase as one rounded cushion, filling the opening '
    'and rising just a little above the rim like a loaf.\n\n'
    'THE MOSS MUST NOT SPILL. Nothing hangs over the lip, nothing trails down the outside, '
    'nothing drapes across the dragon, and no moss touches the vase anywhere below the rim. The '
    'silhouette of the vessel stays a clean unbroken VASE from rim to foot. No vines, no '
    'tendrils, no runners, no loose tufts beside it, no scattered leaves.\n\n'
    'A faint warm ember-gold glow comes from deep inside the moss where it meets the silver, as '
    'though the last of the magic is still alight in it — a soft inner light only, no flames, no '
    'sparks, no particles, no smoke.\n\n'
    'The vase stands ALONE. No ground, no pedestal, no base plate, no grass around its foot, no '
    'other objects.'
)

#: The job picks the model, and which model draws convincing repoussé at icon
#: scale is not something to guess at — shoot them all and look.
MODELS = {
    'seedream-pro': ('character', ['--size', '1152x2048']),
    'nb-pro': ('map-pro', ['--ar', '9:16']),
    'nb2': ('asset', ['--ar', '9:16']),
    'seedream-lite': ('asset-seedream', []),
}


def do_gen(only: set) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    prompt = head(1) + BRIEF + TAIL_MAGENTA
    (WORK / 'prompt.txt').write_text(prompt + '\n')
    refs = ['-i', style_ref('magenta'), '-i', str(MOSS_REF)]
    for name, (mode, extra) in MODELS.items():
        if only and name not in only:
            continue
        out = WORK / f'{name}.png'
        print(f'-> {out.relative_to(ROOT)}  ({mode})', flush=True)
        r = subprocess.run(
            ['python3', str(ARTGEN), mode, prompt, *refs, '-o', str(out), *extra],
            capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout[-1200:] + r.stderr[-1200:])
            print(f'   ! {name} failed, continuing')


def do_cut(only: set) -> None:
    px = round(TARGET_UNITS / ITEM_SCALE)
    for name in MODELS:
        if only and name not in only:
            continue
        src = WORK / f'{name}.png'
        if not src.exists():
            print(f'  - {name}: no plate')
            continue
        im = dekey(src, WORK / f'{name}-keyed.png')
        bb = im.getbbox()
        im = im.crop(bb)
        s = px / max(im.size)
        im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
        im.save(WORK / f'{name}-cut.png')
        print(f'  {name:<14s} {im.size}  ({TARGET_UNITS} units at ITEM_SCALE {ITEM_SCALE})')
    print('\npick one, then copy it to assets/sprites/items/emberbark.png + .webp')
    print('and RE-DERIVE its anchors.json value — 0.66 was eyeballed for a low wide stump.')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('what', choices=['gen', 'cut'])
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    sel = {s for s in a.only.split(',') if s}
    (do_gen if a.what == 'gen' else do_cut)(sel)
