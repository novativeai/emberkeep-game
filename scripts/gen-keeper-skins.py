#!/usr/bin/env python3
"""Keeper OUTFIT SKINS — the Emporium card and the board standee, one per look.

    python3 scripts/gen-keeper-skins.py card    # the Emporium showcase art
    python3 scripts/gen-keeper-skins.py sprite  # the in-game standee still
    python3 scripts/gen-keeper-skins.py stage   # -> assets/sprites/<who>/skin-<id>

WHAT A KEEPER SKIN IS

The Emporium already re-skins the Manor and the dragons. This adds the third
wardrobe: the PEOPLE. A keeper skin swaps what Eleanor or Selyna is wearing
where she stands on the board, and nothing else — same anchor, same scale, same
hit box, same lines, same everything the bank bakes.

TWO PIECES OF ART, AND THEY ARE NOT THE SAME PICTURE

  card    a painted showcase portrait, full-bleed on the store card the way the
          dragon cards are — her on a beach, lit, with somewhere behind her.
          Vertical: the shelf's `bleed` cards cover-fit their plate, so a
          portrait crops to its middle and a landscape crops to a letterbox.
  sprite  the BOARD standee: the same drawing the game already renders, wearing
          different clothes. It must land on the SAME pixels — the bank's
          `anchorX/anchorY` are baked feet inside a fixed frame, and every
          number downstream (scale, shadow width, keyline units, the body-box
          hit area) is measured off that frame.

WHICH IS WHY THE SPRITE IS AN EDIT OF FRAME 0, NOT A NEW DRAWING

`sprites/<who>/world-idle.webp` frame 0 IS her rest pose, at the board's own
raised three-quarter perspective. Generating a fresh standee from a description
would come back at its own height, its own camera and its own feet, and every
one of those would have to be re-solved. So frame 0 goes in and the model is
asked to change the CLOTHES: same pose, same camera, same size, same place in
the frame. The card goes in beside it as the wardrobe reference, so the outfit
on the board is the outfit on the card.

ASPECT IS NOT DECORATION HERE. Gemini reframes an image whose ratio it was not
offered, and a reframe moves her feet. Eleanor's frame is 438x584 — exactly 3:4,
so it goes in untouched. Selyna's is 456x543, which is nothing on the list, so
she is padded at the TOP to 456x570 (4:5) and the pad is cropped back off
afterwards: her feet sit on the frame's bottom edge and must not move.
"""

from __future__ import annotations

import argparse
import pathlib
import subprocess
import sys
from collections import deque

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
ARTGEN = ROOT / '.claude/skills/nano-banana/scripts/artgen.py'
RAW = ROOT / 'assets/raw/characters/keeper-skins'

MAGENTA = (255, 0, 255)
BG_TOLERANCE = 150
POCKET_TOLERANCE = 90

#: The store card's own shape. `card_frost` is 667x940 (0.71) and is the one
#: portrait card on the shelf; matching it keeps the section looking like the
#: rest of the Emporium rather than like a new panel.
CARD_SIZE = (900, 1268)

#: THE SHELF CROPS, SO THE ART IS COMPOSED FOR THE CROP.
#:
#: A `bleed` card cover-fits its plate, and the plate is LANDSCAPE — 408x360
#: inside the desktop card, 1020x1020 on a phone. Cover-fitting a 0.71 portrait
#: into 1.13 shows the middle 63% of its height and throws the rest away, so a
#: full-body illustration arrives on the shelf as a picture of a waist: measured
#: on the first pass, both keepers were cropped at the chin.
#:
#: So the shipped card is a HEAD-TO-THIGH crop of the generation, with sky
#: stretched in above her to put her face inside the band the card will keep.
#: The generation itself stays full-body in the workspace — it is the master,
#: and a future card shape can be cut from it differently.
#:
#: Numbers measured off these two plates (both 1792x2400, both framed the same
#: by the same prompt): her crown sits at y~192 and her belt at y~960.
CARD_HEADROOM = 200   # rows of sky stretched in above the crown
CARD_CROP_H = 1960    # crop height, which puts the crown at 20% of the card
CARD_CROP_ASPECT = 0.71

#: Who wears what. `frame` is the standee bank's frame size (Constants
#: STANDEE_BANKS) — the canvas the sprite must come back on, to the pixel.
#: `pad_top` lifts a frame onto an offered aspect ratio and is cropped off
#: again; `ar` is what that padded frame IS.
KEEPERS = {
    'eleanor': {
        'label': 'Eleanor',
        'frame': (438, 584),
        'pad_top': 0,
        'ar': '3:4',
        'world': 'emberkeep',
        # Every trait the outfit may not touch, named rather than left to the
        # model to infer from a small reference.
        'traits': (
            'a young woman with warm light-tan skin, dark brown almond eyes, '
            'and long jet-black hair worn in one thick braid over her left '
            'shoulder with a small gold hoop earring'
        ),
        'staff': (
            'her wooden staff topped with a round gold ring holding a glowing '
            'red ember stone'
        ),
        'outfit': (
            'a summer beach outfit: a deep-red and cream sarong wrap skirt tied '
            'at the hip over a simple cream halter top, a woven gold-corded belt '
            'at the waist echoing her old sash, bare shoulders, a light gauzy '
            'open beach shawl in the same deep red as her old hooded coat '
            'drifting off one arm, small shell-and-gold anklets, and bare feet'
        ),
        'scene': (
            'standing on warm pale sand at the edge of a turquoise sea, low '
            'golden late-afternoon sun behind her, soft surf and a few dark '
            'volcanic rocks in the distance'
        )
    },
    'selyna': {
        'label': 'Selyna',
        'frame': (456, 543),
        'pad_top': 27,
        'ar': '4:5',
        'world': 'borealis',
        'traits': (
            'a young woman with fair porcelain skin, pale blue eyes, and a '
            'chin-length platinum-blonde bob whose under-layer is soft pink, '
            'with a pearl drop earring'
        ),
        'staff': (
            'her slender white staff topped with a pale pink crystal in a white '
            'crescent setting'
        ),
        'outfit': (
            'a summer beach outfit: a lilac and soft-pink pareo wrap skirt over '
            'a lavender bandeau top, a thin silver chain belt with a small '
            'crescent-moon charm, bare shoulders, a sheer pale-pink beach cover '
            'floating from her elbows in place of her old long coat, a shell '
            'choker where her collar used to sit, and bare feet'
        ),
        'scene': (
            'standing on cool pale sand on a northern shore at dusk, a calm '
            'violet sea behind her, faint aurora light low in the sky, pale '
            'driftwood and smooth stones nearby'
        )
    }
}

#: The one house rule both prompts carry: an outfit swap is not a redesign.
IDENTITY = (
    'Keep the SAME PERSON exactly: same face, same facial features, same eye '
    'colour, same skin tone, same hairstyle and hair colour, same age, same '
    'body proportions. Only her CLOTHES change. Do not restyle her face, do '
    'not change her hair, do not make her older or younger, do not slim or '
    'enlarge her.'
)

CARD_PROMPT = (
    'A painted fantasy game store-card illustration, vertical portrait '
    'composition, of {label} — {traits} — in a SUMMER BEACH OUTFIT. '
    'She wears {outfit}. She still carries {staff}. '
    'She is {scene}. '
    'Full-body or three-quarter-length, she fills the frame and is the clear '
    'subject, warm cinematic rim light, rich painterly rendering with clean '
    'shapes and a soft glow — the polished mobile-game card-art look of the '
    'reference cards. Relaxed, happy, on holiday. '
    + IDENTITY +
    ' The first reference image is how she looks in the game; the second is her '
    'face close up. No text, no logos, no borders, no frame, no UI.'
)

SPRITE_PROMPT = (
    'This image is a game character standing on a flat magenta background. '
    'Repaint it with ONE change: she is wearing a SUMMER BEACH OUTFIT instead '
    'of her robes. She wears {outfit}. She still holds {staff} in the same '
    'hand, gripped at the same point, at the same angle across her body. '
    + IDENTITY +
    ' THE FRAMING IS FIXED. Return the SAME picture at the SAME framing: the '
    'same standing pose, the same arm and hand positions, the same head angle '
    'and gaze, the same height and the same width on the canvas. In the image '
    'you return, the top of her head must sit {head_pct} of the way down from '
    'the top edge and the soles of her feet must sit {feet_pct} of the way '
    'down, exactly as they do now. Do not zoom in, do not zoom out, do not '
    'crop, do not re-centre her, do not enlarge her, do not shrink her.'
    ' THE CAMERA IS FIXED AND IT IS NOT AT EYE LEVEL. It is an isometric game '
    'board camera placed ABOVE her and looking DOWN at roughly thirty degrees, '
    'which is why her shoulders and the top of her head read large, her feet '
    'read small and foreshortened, and she is seen from slightly above and to '
    'one side. Keep that exact downward three-quarter view. Do NOT redraw her '
    'as a straight-on eye-level portrait or pin-up.'
    ' Same crisp cel-shaded painting style, same clean dark outline, same soft '
    'shading, same flat lighting as the image given.'
    ' THE BACKGROUND IS NOT A SCENE. Every pixel that is not the character '
    'stays FLAT PURE MAGENTA #FF00FF, edge to edge. No beach, no sand, no sea, '
    'no sky, no horizon, no ground, no shadow, no gradient, no glow, no haze, '
    'no scenery of any kind. She is cut out on a solid magenta field.'
)


def art(who: str) -> dict:
    return KEEPERS[who]


def framing(who: str) -> dict:
    """Where she sits in her own frame, as percentages, MEASURED off the shipped
    sheet rather than described.

    The first pass asked for "the same framing" in words and got a keeper who
    had shrunk to 84% and lifted 84px off the floor. A model cannot check a
    claim like "the same", but it can check "the feet are 97% of the way down",
    so the constraint is handed over as a number it can aim at."""
    cfg = art(who)
    w, h = cfg['frame']
    total = h + cfg['pad_top']
    a = np.array(idle_frame(who).getchannel('A')) > 8
    ys, _ = np.nonzero(a)
    return {
        'head_pct': f'{round((ys.min() + cfg["pad_top"]) / total * 100)}%',
        'feet_pct': f'{round((ys.max() + cfg["pad_top"]) / total * 100)}%'
    }


def idle_frame(who: str) -> Image.Image:
    """Frame 0 of her world-idle bank — her rest pose, on the board's camera."""
    w, h = art(who)['frame']
    sheet = Image.open(ROOT / f'assets/sprites/{who}/world-idle.webp').convert('RGBA')
    return sheet.crop((0, 0, w, h))


def plate_alpha(src: pathlib.Path) -> Image.Image:
    """Cut the subject off the key plate by CONNECTIVITY, plus a POCKET pass.

    Same cutter as the Golden Elder's bust, and needed for the same reason
    twice over here: the gold ring on Eleanor's staff encloses background, and
    so does the gap between a raised arm, the staff shaft and her body. Neither
    touches the border, so a flood alone leaves magenta holes inside her.
    """
    rgb = np.array(Image.open(src).convert('RGB')).astype(np.int16)
    h, w, _ = rgb.shape
    bg = np.median(np.stack([rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1]]), axis=0)
    near = np.abs(rgb - bg).sum(axis=2) <= BG_TOLERANCE
    pocket = np.abs(rgb - bg).sum(axis=2) <= POCKET_TOLERANCE

    out = np.zeros((h, w), dtype=bool)
    q: deque = deque()
    border = [(y, x) for x in range(w) for y in (0, h - 1)]
    border += [(y, x) for y in range(h) for x in (0, w - 1)]
    for y, x in border:
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

    cut = out | pocket
    alpha = np.where(cut, 0, 255).astype(np.uint8)
    print(f'    background {tuple(int(v) for v in bg)} -> {out.mean() * 100:.1f}% flooded, '
          f'{(pocket & ~out).mean() * 100:.2f}% pocket')
    return Image.fromarray(np.dstack([rgb.astype(np.uint8), alpha]), 'RGBA')


def run_artgen(prompt: str, out: pathlib.Path, refs: list[pathlib.Path], ar: str) -> None:
    argv = [sys.executable, str(ARTGEN), 'edit', prompt, '-o', str(out), '--ar', ar]
    for r in refs:
        argv += ['-i', str(r)]
    if subprocess.run(argv, cwd=ROOT).returncode != 0:
        sys.exit(f'artgen refused for {out.name}')


def cmd_card() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    for who, cfg in KEEPERS.items():
        out = RAW / f'{who}-beach-card-raw.png'
        if out.exists():
            print(f'  {out.relative_to(ROOT)} exists — skipping')
            continue
        ref_pose = RAW / f'{who}-idle0.png'
        idle_frame(who).convert('RGB').save(ref_pose)  # opaque, for reading only
        run_artgen(
            CARD_PROMPT.format(**cfg),
            out,
            [ref_pose, ROOT / f'assets/sprites/{who}-merge/rest.webp'],
            '3:4'
        )
        print(f'  {out.relative_to(ROOT)}  {Image.open(out).size}')


def cmd_sprite() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    for who, cfg in KEEPERS.items():
        out = RAW / f'{who}-beach-sprite-raw.png'
        if out.exists():
            print(f'  {out.relative_to(ROOT)} exists — skipping')
            continue
        w, h = cfg['frame']
        pad = cfg['pad_top']
        # Her frame on the key colour, lifted onto an offered aspect ratio by
        # padding the TOP. Never the bottom: her feet are on the bottom edge and
        # they are the anchor everything downstream is measured from.
        plate = Image.new('RGB', (w, h + pad), MAGENTA)
        frame = idle_frame(who)
        plate.paste(frame, (0, pad), frame)
        src = RAW / f'{who}-beach-sprite-plate.png'
        plate.save(src)
        # ONE reference, and it is her own frame. Passing the card beside it
        # was tried and is what broke the first pass: the card is a finished
        # illustration with a horizon in it, and the model followed the card —
        # both keepers came back as straight-on eye-level pin-ups standing in
        # painted surf, at their own size, with the board's downward camera
        # gone. The outfit travels between the two pieces through the WORDS,
        # which both prompts share, not through a second image.
        run_artgen(SPRITE_PROMPT.format(**cfg, **framing(who)), out, [src], cfg['ar'])
        print(f'  {out.relative_to(ROOT)}  {Image.open(out).size}')


def shelf_crop(im: Image.Image) -> Image.Image:
    """Full-body generation -> the head-to-thigh portrait the shelf keeps.

    The stretch is the top forty rows of sky pulled down over the added
    headroom. It is seamless because there is nothing up there but a gradient —
    every plate's sky band is flat sea-and-light — and it is cheaper and truer
    than asking the model for the same picture again with more air in it.
    """
    w, h = im.size
    sky = im.crop((0, 0, w, 40)).resize((w, CARD_HEADROOM), Image.BILINEAR)
    tall = Image.new('RGB', (w, h + CARD_HEADROOM))
    tall.paste(sky, (0, 0))
    tall.paste(im, (0, CARD_HEADROOM))
    cw = round(CARD_CROP_H * CARD_CROP_ASPECT)
    x0 = (w - cw) // 2
    return tall.crop((x0, 0, x0 + cw, CARD_CROP_H)).resize(CARD_SIZE, Image.LANCZOS)


def cmd_stage() -> None:
    """De-key, restore the exact frame geometry, and report what moved."""
    for who, cfg in KEEPERS.items():
        raw = RAW / f'{who}-beach-sprite-raw.png'
        if not raw.exists():
            sys.exit('run `sprite` first')
        w, h = cfg['frame']
        pad = cfg['pad_top']
        print(f'  {who}:')
        cut = plate_alpha(raw)
        # Back onto the bank's own canvas: the model returns its own resolution,
        # so scale to the PADDED frame and then take the pad off the top. What
        # comes out is the same pixel grid the shipped sheet uses.
        cut = cut.resize((w, h + pad), Image.LANCZOS).crop((0, pad, w, h + pad))
        dst = ROOT / f'assets/sprites/{who}/skin-beach.webp'
        cut.save(dst, 'WEBP', quality=94, method=6)

        # The whole contract in one line: did her feet stay put? The bank's
        # anchor is a fraction of the frame, so a standee that came back an inch
        # taller would stand an inch into the ground.
        before = np.array(idle_frame(who).getchannel('A')) > 8
        after = np.array(cut.getchannel('A')) > 8
        for name, m in (('was', before), ('now', after)):
            ys, xs = np.nonzero(m)
            print(f'    {name}: bbox x[{xs.min()},{xs.max()}] y[{ys.min()},{ys.max()}] '
                  f'height {ys.max() - ys.min()}')
        print(f'    -> {dst.relative_to(ROOT)}  {cut.size}')

        card = shelf_crop(Image.open(RAW / f'{who}-beach-card-raw.png').convert('RGB'))
        cdst = ROOT / f'assets/sprites/ui/store/card-{who}-beach.webp'
        card.save(cdst, 'WEBP', quality=90, method=6)
        print(f'    -> {cdst.relative_to(ROOT)}  {card.size}')


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('step', choices=['card', 'sprite', 'stage'])
    args = ap.parse_args()
    {'card': cmd_card, 'sprite': cmd_sprite, 'stage': cmd_stage}[args.step]()


if __name__ == '__main__':
    main()
