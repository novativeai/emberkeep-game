#!/usr/bin/env python3
"""THE house style for merge items. Import this; do not retype it.

    from merge_style import HEAD, TAIL_MAGENTA, TAIL_GREEN, style_ref

Every merge-item sheet in the game is drawn with these blocks. They are not a
suggestion and they are not a starting point — each clause in here is a failure
somebody already paid for, and the two times a generation script paraphrased
them instead of importing them, the same failures came straight back:

* Drop `Hand-painted, NOT a photograph …` and you get ray-traced studio product
  renders. It happened to `tarknot` (merge-chains.md §6) and then, after the
  clause was paraphrased away, to `amberfall`.
* Drop `almost complete absence of small internal detail` and a plant comes back
  as forty individual leaves that turn to mush at 66px. `firethorn`.
* Fold the ART-STYLE REFERENCE paragraph and the STYLE block into one paragraph
  and you lose the second one. Seedream weights LABELLED blocks; two labels are
  two instructions, one label is one.

THE LOOK, in one line: a premium merge-game icon — one heavy near-black keyline
around the whole silhouette, a few large colour masses with smooth gradients
inside them, glossy painted highlights, and light coming from INSIDE anything
that holds light. `emberberry_3` (the jam jar) and `moonwater_3` (the moon
bottle) are the reference plates, and `STYLE_PLATE` composites them for Image 1.
"""
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
#: The two shipped pieces that define the look, composited onto the key colour.
#: Built on demand by `style_ref()` so it can never drift from the real art.
STYLE_PLATE = ROOT / 'assets/raw/merge-chains/house-style-ref.png'
STYLE_SOURCES = [
    ROOT / 'assets/sprites/items/chains/emberberry_3.png',
    ROOT / 'assets/sprites/items/chains/moonwater_3.png',
]

HEAD_CORE = (
    'Image 1 is the ART-STYLE REFERENCE: match its RENDERING TECHNIQUE ONLY. Copy its heavy, '
    'even, near-black outline running all the way around every silhouette; its few large flat '
    'colour masses with soft gradients inside them; its almost complete absence of small '
    'internal detail; its glossy painted highlights; its clean, smooth finish with no visible '
    'brushwork and no surface noise; and its premium merge-game icon read. Do NOT copy its '
    'colours, its subjects or its ground diamond.\n\n'
    'STYLE — painterly mobile-game item art, chunky readable shapes, soft gradients, a bold '
    'dark outline around every silhouette, a premium merge-game icon look, smooth and clean '
    'with no visible brushwork and no surface noise. Hand-painted, NOT a photograph, no '
    'ray-traced reflections, no studio product lighting, no 3D render.\n\n'
    'SHADING — build every object from a FEW LARGE shapes, never from many small ones: six or '
    'eight confident masses per object, never forty. Each mass runs as a smooth gradient from a '
    'lit upper-left face into a warmer, deeper shadow at the lower right, with ONE crisp white '
    'specular highlight where the form turns toward the key light and a bright bounce along the '
    'lower shadow edge so the form stays round. Glass, gems, liquid and polished metal are '
    'painted with broad soft highlight bands and a glow coming from INSIDE the object, never '
    'with real refraction or mirror reflections. No fine veins, no per-leaf or per-scale '
    'detail, no speckling, no scattered surface texture.\n\n'
    'CAMERA — isometric three-quarter view from above at roughly 30 degrees, 2:1 isometric '
    'projection, no perspective convergence. Key light from the upper left; the lower-right '
    'faces are the shaded ones.\n\n'
)

#: The clause every LAYOUT ends with. The left cell is the one the cut resamples
#: smallest, so it is the one a thin stem destroys.
_COMPACT_LEFT = (
    'The LEFT object must be a SOLID COMPACT shape — it is drawn at 66 pixels in game, so no '
    'thin stems, no lonely filaments and no scattered pieces.'
)
_ROW = (
    'evenly spaced, each fully inside the frame with a generous empty margin around it. Nothing '
    'touches or overlaps anything else. Nothing is cropped by any edge. '
)

#: LAYOUT block per cell count. A sheet is cut on the GAPS between objects
#: (`column_runs`), so the count in the prompt and the count in the cut are the
#: same number — asking for three and getting four silently remaps every tier.
LAYOUTS = {
    1: (
        'LAYOUT — exactly ONE object, alone and centred, fully inside the frame with a generous '
        'empty margin all around it. Nothing is cropped by any edge. There is ONE object only: '
        'no row, no grid, no variants, no smaller copies of it anywhere in the frame.\n\n'
    ),
    2: (
        'LAYOUT — exactly TWO separate objects in one horizontal row, ' + _ROW +
        'The two are DIFFERENT THINGS, not two sizes of one thing — give them DISTINCT '
        'silhouettes so they can never be confused at icon size.\n\n'
    ),
    3: (
        'LAYOUT — exactly THREE separate objects in one horizontal row, ' + _ROW +
        'Left object smallest, middle medium, right largest and most finished — three steps of '
        'the same thing being made. Give the three DISTINCT silhouettes so they can never be '
        'confused at icon size. ' + _COMPACT_LEFT + '\n\n'
    ),
    4: (
        'LAYOUT — exactly FOUR separate objects in one horizontal row, ' + _ROW +
        'Smallest on the left, then each one larger and more finished than the one before it, '
        'largest on the right — four steps of the same thing being built. Give the four DISTINCT '
        'silhouettes so they can never be confused at icon size. ' + _COMPACT_LEFT + '\n\n'
    ),
}


def head(cells: int = 3) -> str:
    """The house style, laid out for a sheet of `cells` objects."""
    return HEAD_CORE + LAYOUTS[cells]


#: The 3-across head, which is what almost every chain sheet is.
HEAD = head(3)

#: Appended when the sheet is keyed on magenta (the default).
TAIL_MAGENTA = (
    '\n\nBACKGROUND — a solid flat pure magenta #FF00FF field, edge to edge, completely even. No '
    'ground plane, no diamond, no pad, no cast shadow, no floor, no vignette, no gradient, no '
    'text, no numbers, no labels, no frames, no UI. Nothing magenta, pink, violet, purple or '
    'lilac anywhere in the objects themselves — that colour is the key and would be cut out.'
)
#: Appended when the subject is itself pink/violet, which a magenta key eats.
TAIL_GREEN = (
    '\n\nBACKGROUND — a solid flat pure green #00FF00 field, edge to edge, completely even. No '
    'ground plane, no diamond, no pad, no cast shadow, no floor, no vignette, no gradient, no '
    'text, no numbers, no labels, no frames, no UI. Nothing green, mint, lime or teal anywhere '
    'in the objects themselves — that colour is the key and would be cut out.'
)

#: Extra block for the frozen world. Readability there is measured, not judged —
#: see tests/unit/BorealisRoster.spec.ts for the band this exists to clear.
SNOW_WORLD = (
    'THIS IS FOR A SNOW WORLD AND IT MUST NOT DISAPPEAR INTO IT. The board these sit on is pale '
    'blue-grey ice and snow-capped stone. Every object must therefore be DARK or SATURATED '
    'enough to read instantly against pale blue-white. No white, no pale grey, no pale blue and '
    'no bleached driftwood tones as the MAIN mass of any object.\n\n'
)


def style_ref(key: str = 'magenta') -> str:
    """Path to Image 1 — the two reference pieces flattened onto the key colour.

    Flattened rather than passed as transparent PNGs: a transparent reference
    arrives over an arbitrary matte and the model reads that matte as part of
    the style (docs/character-pipeline.md learned this the expensive way).
    """
    from PIL import Image

    bg = (255, 0, 255) if key == 'magenta' else (0, 255, 0)
    pieces = [Image.open(p).convert('RGBA') for p in STYLE_SOURCES]
    h = 720
    pieces = [p.resize((max(1, round(p.width * h / p.height)), h), Image.LANCZOS) for p in pieces]
    pad = 120
    w = sum(p.width for p in pieces) + pad * (len(pieces) + 1)
    plate = Image.new('RGB', (w, h + pad * 2), bg)
    x = pad
    for p in pieces:
        plate.paste(p, (x, pad), p)
        x += p.width + pad
    STYLE_PLATE.parent.mkdir(parents=True, exist_ok=True)
    plate.save(STYLE_PLATE)
    return str(STYLE_PLATE)


def measured_key(path: pathlib.Path) -> str:
    """The key colour MEASURED off a return, never assumed.

    A sheet asked for #FF00FF comes back anywhere from #FE17C9 to #FF2BFF, and
    keying on the nominal colour leaves a coloured rim the width of the feather.
    """
    from collections import Counter

    from PIL import Image

    im = Image.open(path).convert('RGB').resize((256, 256))
    r, g, b = Counter(im.getdata()).most_common(1)[0][0]
    return f'{r:02X}{g:02X}{b:02X}'


def dekey(src: pathlib.Path, dst: pathlib.Path):
    """De-key `src` on its own measured key and return the RGBA result."""
    import sys

    from PIL import Image

    tool = ROOT / '.claude/skills/nano-banana/scripts/dekey.py'
    r = subprocess.run(['python3', str(tool), str(src), str(dst), '--key', measured_key(src)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(r.stderr)
    return Image.open(dst).convert('RGBA')
