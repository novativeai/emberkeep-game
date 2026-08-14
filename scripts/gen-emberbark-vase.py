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
#: Sum-of-channels distance from the sampled background that still counts as
#: background. The maroon field sits at ~94 and the vase's keyline at ~12, so
#: there is a wide gap to sit in.
BG_TOLERANCE = 45
ITEM_SCALE = 0.32

sys.path.insert(0, str(ROOT / 'scripts'))
from merge_style import TAIL_MAGENTA, head, style_ref  # noqa: E402

#: The one thing only Seedream got on the first shoot, so it is now stated as a
#: measurable fact rather than left to the house CAMERA block. The board is a 2:1
#: isometric projection (TILE_W 256 / TILE_H 128), so a circle lying flat on it
#: photographs as an ellipse HALF as tall as it is wide. The mouth of the vase is
#: such a circle, and the moss filling it is the disc that proves it — which is
#: why `mouth_ratio()` below measures the moss and not the metal.
CAMERA = (
    'CAMERA — THIS IS THE MOST IMPORTANT INSTRUCTION. Isometric three-quarter view from ABOVE, '
    'looking DOWN onto the vase at roughly 30 degrees, in a 2:1 isometric projection. You are '
    'looking down INTO THE MOUTH of the vase and you can see the whole moss surface inside it as '
    'a full oval disc, not as a thin sliver at the top edge. The circular rim of the mouth '
    'therefore draws as a WIDE OPEN ELLIPSE exactly HALF as tall as it is wide, and the circular '
    'foot draws as the same shape. The top surface of the moss is a broad oval facing up toward '
    'the viewer.\n\n'
    'DO NOT draw this straight on from the side, at eye level, or as a flat front elevation. A '
    'side view where the mouth is a narrow slot or a straight line across the top is WRONG. Tilt '
    'the whole object forward so its top is presented to the camera.\n\n'
)
#: The other correction: Seedream's first pass was a photograph of a real urn.
NOT_REAL = (
    'THIS IS A HAND-PAINTED GAME ICON, NOT A PHOTOGRAPH OF A REAL URN. Build the entire vase from '
    'SIX OR EIGHT LARGE SIMPLE MASSES with smooth gradients inside them — never from hundreds of '
    'small ones. NO photographic metal, no micro-scratches, no hammer stipple, no speckle, no '
    'grain, no surface noise, no engraved hairlines, no fine filigree, no mirror reflections, no '
    'ray-tracing, no studio product lighting, no 3D render.\n\n'
    'LIGHT IT LIKE A MERGE-GAME ICON — a warm key light from the upper left giving one broad '
    'glossy highlight band down the lit side and ONE crisp white specular on the shoulder; a '
    'BRIGHT COOL RIM LIGHT running down the whole opposite edge, separating the silhouette from '
    'the background in a single clean stroke; and a warm bounce along the lower edge so the form '
    'stays round. Deep, simple shadow on the shaded side. A heavy even near-black outline all the '
    'way around the silhouette. Glossy, clean and smooth, with no visible brushwork.\n\n'
)

BRIEF = (
    CAMERA + NOT_REAL +
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
    'THE SILVER — old silver, not chrome and not white. Warm pale grey metal painted as a few '
    'broad flat masses, with deep near-black tarnish pooled as SIMPLE SHAPES in the hollows of '
    'the repoussé and bright polished light riding along the raised edges. The contrast between '
    'dark hollow and bright ridge is what makes the dragon readable at icon size, so keep it '
    'strong and keep it simple.\n\n'
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


def plate_alpha(src: pathlib.Path) -> Image.Image:
    """Cut the subject off a plate whose background is NOT the key colour.

    Seedream ignores the magenta BACKGROUND block on this prompt and returns a
    dark maroon field instead. `merge_style.dekey` measures the most common
    colour and keys THAT — which here is the maroon, and the maroon is close
    enough in value to the vase's own near-black keyline that keying it ate the
    outline and left the silhouette dissolving into the board.

    So the cut is by CONNECTIVITY, not by colour alone: flood from the border
    over pixels near the sampled background, and stop at the keyline. Interior
    darks — tarnish in the repoussé, the shadow inside the mouth — are never
    reached, because nothing connects them to the edge.
    """
    import numpy as np
    from collections import deque

    rgb = np.array(Image.open(src).convert('RGB')).astype(np.int16)
    h, w, _ = rgb.shape
    # The background colour, taken from the four corners rather than assumed.
    bg = np.median(np.stack([rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1]]), axis=0)
    near = (np.abs(rgb - bg).sum(axis=2) <= BG_TOLERANCE)

    out = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near[y, x] and not out[y, x]:
                out[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near[y, x] and not out[y, x]:
                out[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and near[ny, nx] and not out[ny, nx]:
                out[ny, nx] = True
                q.append((ny, nx))

    alpha = np.where(out, 0, 255).astype(np.uint8)
    im = Image.fromarray(np.dstack([rgb.astype(np.uint8), alpha]), 'RGBA')
    # One-pixel feather so the hard flood edge does not alias on the board.
    from PIL import ImageFilter
    a = Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(0.6))
    im.putalpha(a)
    return im


def mouth_ratio(im: Image.Image) -> float:
    """How foreshortened the mouth is, measured off the MOSS disc filling it.

    A circle lying flat on a 2:1 isometric board draws as an ellipse whose minor
    axis is HALF its major — so 0.50 is the target and a number near 0.2 means
    the model drew a side elevation. Measured by SECOND MOMENTS rather than a
    bounding box: for a filled ellipse the covariance eigenvalue ratio is
    exactly (minor/major)^2 whatever the rotation, and it survives the rim
    clipping the far edge of the disc.
    """
    import numpy as np

    a = np.array(im)
    rgb, alpha = a[..., :3].astype(float), a[..., 3]
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    # The moss is the only thing in the frame with a green cast, and the silver
    # is neutral-to-warm, so `g` standing well clear of `b` isolates it. Do NOT
    # also require g > r: this moss is YELLOW-green, r and g run neck and neck,
    # and that clause returned an empty mask on a perfectly good plate.
    moss = (alpha > 128) & (g > b + 30) & (g > 70)
    ys, xs = np.nonzero(moss)
    if len(xs) < 200:
        return float('nan')
    cov = np.cov(np.stack([xs, ys]).astype(float))
    ev = np.linalg.eigvalsh(cov)
    return float(np.sqrt(max(ev[0], 0.0) / ev[1]))


def do_cut(only: set) -> None:
    px = round(TARGET_UNITS / ITEM_SCALE)
    for name in MODELS:
        if only and name not in only:
            continue
        src = WORK / f'{name}.png'
        if not src.exists():
            print(f'  - {name}: no plate')
            continue
        im = plate_alpha(src)
        im.save(WORK / f'{name}-keyed.png')
        bb = im.getbbox()
        im = im.crop(bb)
        s = px / max(im.size)
        im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
        im.save(WORK / f'{name}-cut.png')
        ratio = mouth_ratio(im)
        flag = '' if ratio >= 0.38 else '   <-- FLAT: drawn from the side'
        print(f'  {name:<14s} {str(im.size):<12s} mouth {ratio:.2f} (2:1 iso wants 0.50){flag}')
    print('\npick one, then copy it to assets/sprites/items/emberbark.png + .webp')
    print('and RE-DERIVE its anchors.json value — 0.66 was eyeballed for a low wide stump.')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('what', choices=['gen', 'cut'])
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    sel = {s for s in a.only.split(',') if s}
    (do_gen if a.what == 'gen' else do_cut)(sel)
