#!/bin/bash
# Eleanor + Selyna production art — low-poly model sheets, conversation
# portraits, expression / talking / blink sheets, and the hat props they are
# deliberately missing.
#
#   batch-characters.sh <workdir> [stage] [character]
#     stage      portrait | sheet | expr | talk | blink | composite | align
#                | anim | slice | hat | all             (default: all)
#     character  eleanor | selyna | both                (default: both)
#
# Stage order matters: `expr`, `talk` and `blink` all crop their grid source
# from the de-keyed portrait, so `portrait` must have run first; `blink` also
# references the finished X-rest plate, so `talk` and `composite` must have run
# before it; `composite` needs the frames those stages slice; `align` needs the
# composited frames; `anim` reads the aligned eyelids.
# `slice`, `composite` and `anim` each re-run without a regeneration — but
# `slice` overwrites composited frames with the raw cells, so re-run
# `composite` after it.
#
# Both characters are keyed on GREEN, not the project's usual magenta: Eleanor's
# cloak is wine-plum and Selyna's palette is rose pink, and a magenta key eats
# both (dekey.py switches its de-spill term when the key's dominant channel is
# green — see its header).
set -e
cd "$(dirname "$0")/../../../.."   # repo root
WORK="${1:?workdir required}"
STAGE="${2:-all}"
WHO="${3:-both}"
SCRIPTS=".claude/skills/nano-banana/scripts"
A="$SCRIPTS/artgen.py"
KEY="$SCRIPTS/dekey.py"
# gridsheet.mjs drives Playwright and Sprite Studio's tsc — both need Node 22.
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"
SPR="assets/sprites/characters"
mkdir -p "$WORK"

# ---------------------------------------------------------------- style blocks

# The turnaround contract. Views must share one baseline and one scale or the
# sheet is useless as modelling reference.
SHEET_FRAME="orthographic character model sheet for 3D modelling: FOUR full-body views of the same character in a single evenly-spaced row on one flat neutral mid-grey #9A9A9A background — FRONT view, LEFT SIDE profile view, BACK view, and THREE-QUARTER view. All four are the identical character at the identical height and scale, feet on a shared baseline, aligned to faint thin horizontal guide lines at the top of the head, the eyes, the shoulders, the waist, the knees and the floor. Relaxed A-pose: arms held slightly away from the body, palms facing inward, hands empty and open with nothing held, feet shoulder-width apart, head level and facing straight ahead. Flat even neutral studio lighting from the front, no cast shadow, no ground shadow, no scenery, no props, no text, no labels, no colour swatches, no logo, no watermark, nothing cropped at the edges."

LOWPOLY="stylized LOW-POLY 3D game character: simplified faceted planes, chunky readable masses, flat colour blocks meeting at clean hard edges, cloth folds resolved into a few large angular planes instead of fine wrinkles, minimal surface texture, one thin dark contour outline, a silhouette that still reads at 128 pixels tall. Modern stylized low-poly mobile-RPG hero look. NOT photorealistic, no PBR shading, no micro-detail, no fabric weave, no rendered subsurface skin."

PAINTERLY="painterly digital illustration for a visual-novel dialogue portrait, visible expressive brushstrokes, hand-painted rendering with 3-4 clean value steps, warm key light from the upper left and a cool fill from the lower right, edges dissolving into loose brushwork toward the bottom of the frame, subtle canvas grain. NOT photorealistic, not airbrushed-smooth, no plastic sheen, no lens blur, no photographic bokeh."


GREEN="isolated on a solid flat pure green #00FF00 background filling the entire frame behind her, no ground shadow, no reflection, no other elements, no text, no watermark, nothing cropped at the edges."

GREEN_IT="isolated single object, centered, on a solid flat pure green #00FF00 background filling the entire frame, no ground shadow, no other elements, no text, no watermark, nothing cropped at the edges."

# Eight cells, one variable. Written to Sprite Studio's grid-prompt shape
# (lib/gridPrompts.ts): name the role of each reference image, order the cells
# in reading order, then an explicit "everything else identical" clause.
EXPR_GRID="Create ONE 4x2 character expression sheet — four cells across, two rows down, eight cells in total.

You are given two reference images:
- Image 1 is the CHARACTER reference: the exact character to draw. Match her face, hair, colours, costume, art style and lighting exactly.
- Image 2 is the LAYOUT TEMPLATE: a 4x2 grid of identical white silhouettes marking the exact position, scale and framing for every cell. Follow the structure of Image 2 exactly — one character per silhouette, filling it, perfectly aligned to it. Nothing may extend past a cell or be clipped by a cell edge.

Draw the character from Image 1 once inside every cell. Every cell shows the identical character at the identical size, head position, head angle, shoulder position and lighting, and the ONLY thing that changes from cell to cell is the FACIAL EXPRESSION.

The eight expressions, in reading order (left to right, top row first):
Cell 1 — NEUTRAL: calm, mouth closed, eyes level, relaxed brows.
Cell 2 — HAPPY: a warm closed-lip smile, eyes softened and slightly narrowed.
Cell 3 — LAUGHING: broad open smile showing teeth, eyes crinkled shut with delight, head unchanged.
Cell 4 — SURPRISED: eyes wide, brows high, mouth open in a small round O.
Cell 5 — WORRIED: brows drawn together and tilted up at the inner ends, mouth tight, gaze lowered.
Cell 6 — SAD: eyes downcast and glossy, mouth turned down at the corners, brows tilted up.
Cell 7 — DETERMINED: sharp focused eyes, chin very slightly down, mouth set in a firm line.
Cell 8 — ANGRY: brows hard down and drawn in, eyes narrowed, jaw set, mouth a hard flat line.

Keep everything else exactly the same across all eight cells. Do not add text, numbers, labels, cell borders, panel frames, drop shadows or props."

# ------------------------------------------------------------------ characters

ELEANOR_ID="a young woman with warm ivory skin and light freckles scattered across her nose and cheeks, dark warm brown eyes, soft arched brows and a gentle knowing half-smile. Long wavy jet-black hair with a faint deep-blue sheen, parted loosely, with one thick rope braid falling forward over her left shoulder down past her waist. A small gold crescent-moon disc earring."

ELEANOR_FIT="Costume: a floor-length charcoal-grey #4A4A52 wrap robe closed kimono-style across the chest with thin gold #C89B3C piping along the collar edge; a wide tan-and-gold belt at the waist with an engraved gold swirl-and-crescent buckle and a coral-red #D9524A sash tail hanging from it; over everything a heavy wine-plum #6B2148 hooded cloak lined in black, edged all round with a gold band, with wide draping sleeves, the hood lying DOWN and empty on her shoulders, the hem pooling on the floor behind her. Flat black shoes. Motif system: crescent moons and small gold discs, repeated on the belt buckle, the earring and the cloak trim. Single emissive accent: warm gold #F0C25A."

SELYNA_ID="a young woman with fair skin, bright cyan-blue eyes, sharp dark brows and a confident half-smirk. A chin-length blonde bob, side-parted, with a rose-pink #FF9DB4 under-layer and pink-tipped ends, one long pale strand framing the right side of her face. A pearl-drop earring."

SELYNA_FIT="Costume: a layered lilac-grey #A9A3C4 mage coat trimmed in pale pink #FFB6CE piping; a glossy black high-collar gorget at the throat with a small crescent inlay; a wide black leather waist-belt with a large round pearl-white disc buckle and a hanging black plate below it; a pale-lavender surcoat panel down the front ending in a pink chevron hem; huge draped sleeves lined in pink with black cuffs; a long lilac cape lined in black, pooling on the floor behind her. Black pointed heeled boots. Motif system: pearl orbs and crescents, repeated on the belt, the collar and the sleeve clasps. Single emissive accent: soft pearl-pink #FFC9DC glow."

ELEANOR_HAT="an oversized soft witch hat: a very wide floppy circular brim that dips low on one side, a tall pointed crown that bends and flops over at the tip, made of deep plum-black #2E1B2C felt with a faint wine sheen, black underside to the brim, a chain of small gold #E4B84E moon-phase discs — crescent through full — strung around the base of the crown and along the front edge of the brim."

SELYNA_HAT="an oversized soft witch hat: a very wide flat circular brim with a crisp edge, a tall pointed crown that bends and flops over at the tip, made of lilac-grey #A9A3C4 felt with a rose-pink #FFB6CE inner lining just visible under the crown, a matte black underside to the brim, and a band of small pearl-white spheres strung in a row around the base of the crown."

# Deliberate and repeated: the model will re-add a hat from the reference art
# unless bare-headedness is stated as a positive fact about the character.
ELEANOR_BARE="IMPORTANT — she is BARE-HEADED in every view: no hat, no witch hat, no hood pulled up, no headband, no circlet, no headwear of any kind. The whole crown of her head and her full hairline are visible, and her hair lies close to the skull on top so a hat prop can be fitted over it later. The cloak hood stays down on her shoulders."
SELYNA_BARE="IMPORTANT — she is BARE-HEADED in every view: no hat, no witch hat, no hood, no headband, no circlet, no headwear of any kind. The whole crown of her head and her full hairline are visible, and the bob lies close to the skull on top so a hat prop can be fitted over it later."

# ----------------------------------------------------------------------- stages

want () { [ "$WHO" = "both" ] || [ "$WHO" = "$1" ]; }
run  () { [ "$STAGE" = "all" ] || [ "$STAGE" = "$1" ]; }

# Conversation portrait — Seedream 5.0 Pro off the concept art, green-keyed.
# auto_2K follows the 3:4 reference, which is the framing a portrait wants.
portrait () { # name identity fit bare
  echo "=== $1 · conversation portrait ==="
  python3 "$A" character \
    "$PAINTERLY Waist-up three-quarter dialogue portrait of $2 Her body is angled slightly to the LEFT with her head turned toward the viewer, one hand raised near her chest in a relaxed speaking gesture. $3 $4 Detailed, expressive, readable at small size on a dialogue box. $GREEN" \
    -i "$SPR/$1/concept-art/$1-concept-art.jpg" --size auto_2K \
    -o "$WORK/$1/generations/portrait.jpg"
  python3 "$KEY" "$WORK/$1/generations/portrait.jpg" "$SPR/$1/$1-portrait.png" \
    --key 00FF00 --trim --pad 4
}

# Low-poly turnaround — Nano Banana 2, grey plate, no key (a modelling sheet is
# read on grey; trimming it would destroy the shared baseline).
modelsheet () { # name identity fit bare
  echo "=== $1 · low-poly model sheet ==="
  python3 "$A" sheet \
    "$SHEET_FRAME $LOWPOLY The character is $2 $3 $4" \
    -i "$SPR/$1/concept-art/$1-concept-art.jpg" \
    -o "$SPR/$1/3d/$1-lowpoly-sheet.png"
}

# Expression sheet — the Sprite Studio grid-template workflow.
#
# Free-hand "draw five portraits in a row" is what clipped the first pass: the
# model chose its own framing per cell and the shoulders ran off the edges. So
# the framing is not left to the model. The finished portrait is cropped to a
# bust at the one content aspect that makes a 4x2 grid come out 16:9 (bust.py
# derives it), Sprite Studio's own buildGridSheet stamps that bust into eight
# identical white silhouettes, and the model is handed that template as the
# layout it must fill. 4K, so each of the eight cells is 1376x1536 on its own.
expressions () { # name bare
  echo "=== $1 · expression sheet ==="
  python3 "$SCRIPTS/bust.py" "$SPR/$1/$1-portrait.png" "$WORK/$1/templates/bust.png"
  # The template is flattened onto the SAME green the output is keyed on. On a
  # contrasting backdrop the model reads the template's background as part of
  # the layout and paints it into the cells, which then survives de-keying as an
  # opaque panel behind every head. Matching the two removes the ambiguity.
  node "$SCRIPTS/gridsheet.mjs" "$WORK/$1/templates/bust.png" "$WORK/$1/templates/expressions-grid.png" \
    --cols 4 --rows 2 --cell 900 --mode mask --bg 00FF00
  python3 "$A" sheet-4k \
    "$EXPR_GRID $2 $PAINTERLY Background: one solid flat pure green #00FF00 covering the entire canvas behind her in every cell — completely flat, no gradient, no vignette, no texture, no ground shadow." \
    -i "$WORK/$1/generations/portrait.jpg" -i "$WORK/$1/templates/expressions-grid.png" \
    -o "$WORK/$1/generations/expressions.png"
  # No --trim: the eight cells must stay co-registered on one canvas.
  python3 "$KEY" "$WORK/$1/generations/expressions.png" "$WORK/$1/sheets/$1-expressions.png" \
    --key 00FF00
  slice_expressions "$1"
}

# A clean 4x2 geometric split. The template is what makes that safe — every cell
# was authored at the same framing, so a frame swap in a dialogue box does not
# move the head.
slice_expressions () { # name
  python3 - "$WORK/$1/sheets/$1-expressions.png" "$SPR/$1/${1}_expressions" "$1" <<'PY'
import os, shutil, sys
from PIL import Image
src, out, who = sys.argv[1], sys.argv[2], sys.argv[3]
COLS, ROWS = 4, 2
names = ['neutral', 'happy', 'laughing', 'surprised',
         'worried', 'sad', 'determined', 'angry']
os.makedirs(out, exist_ok=True)
img = Image.open(src).convert('RGBA')
w, h = img.size
cw, ch = w / COLS, h / ROWS
for i, n in enumerate(names):
    c, r = i % COLS, i // COLS
    cell = img.crop((round(c * cw), round(r * ch),
                     round((c + 1) * cw), round((r + 1) * ch)))
    dst = os.path.join(out, f'{who}_{n}.png')
    cell.save(dst)
    print(f'  {dst} ({cell.width}x{cell.height})')
# The contact sheet ships with its frames; every other set has one too.
shutil.copyfile(src, os.path.join(out, f'{who}-expressions-sheet.png'))
PY
}

# Talking sheet — the 9-shape Rhubarb viseme chart, same grid-template method.
#
# The crop is a HEAD, not the bust the expression sheet uses: a mouth shape has
# to survive being read at a glance, and the repo's existing lip-sync (the
# dragon head frames, faceAnimations.ts) swaps a head-region texture over a
# body, so head framing is also what the runtime pattern expects.
#
# 5x2 = 10 cells for 9 shapes; Sprite Studio's prompt handles the spare, and the
# slicer drops it. Cell aspect 0.711 -> head content aspect 0.656.
talk () { # name
  echo "=== $1 · talking sheet ==="
  python3 "$SCRIPTS/bust.py" "$SPR/$1/$1-portrait.png" "$WORK/$1/templates/talk-head.png" \
    --aspect 0.656 --measure 0.30
  node "$SCRIPTS/gridsheet.mjs" "$WORK/$1/templates/talk-head.png" "$WORK/$1/templates/talk-grid.png" \
    --cols 5 --rows 2 --cell 900 --mode mask --bg 00FF00
  # The cell copy is Sprite Studio's own, not a paraphrase — see studioprompt.mjs.
  node "$SCRIPTS/studioprompt.mjs" --chart mouth --shapes 9 --cols 5 --rows 2 --key 00FF00 --res 4K \
    > "$WORK/$1/prompts/talk.txt"
  python3 "$A" sheet-4k \
    "$(cat "$WORK/$1/prompts/talk.txt")

Additional constraints for this character: $PAINTERLY She is BARE-HEADED in every cell — no hat, no hood, no headwear. Her eyes stay open and her expression stays neutral in all cells; only the mouth changes." \
    -i "$WORK/$1/generations/portrait.jpg" -i "$WORK/$1/templates/talk-grid.png" \
    -o "$WORK/$1/generations/talk.png"
  python3 "$KEY" "$WORK/$1/generations/talk.png" "$WORK/$1/sheets/$1-talk.png" \
    --key 00FF00
  slice_talk "$1"
}

# 5x2 split, first nine cells named by viseme id, tenth discarded. The manifest
# is emitted from Sprite Studio's VISEMES table so the sound groups a runtime
# maps against cannot drift from the chart the frames were drawn to.
slice_talk () { # name
  node "$SCRIPTS/studioprompt.mjs" --visemes > "$WORK/$1/meta/viseme-table.json"
  python3 - "$WORK/$1/sheets/$1-talk.png" "$SPR/$1/${1}_visemes" \
           "$WORK/$1/meta/viseme-table.json" "$1" <<'PY'
import json, os, re, sys
from PIL import Image
src, out, table, who = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
COLS, ROWS = 5, 2
visemes = json.load(open(table))
os.makedirs(out, exist_ok=True)
img = Image.open(src).convert('RGBA')
w, h = img.size
cw, ch = w / COLS, h / ROWS
manifest = []
for i, v in enumerate(visemes):
    c, r = i % COLS, i // COLS
    slug = re.sub(r'[^a-z0-9]+', '-', v['label'].lower()).strip('-')
    name = f"{who}_{v['id']}-{slug}.png"
    cell = img.crop((round(c * cw), round(r * ch),
                     round((c + 1) * cw), round((r + 1) * ch)))
    cell.save(os.path.join(out, name))
    manifest.append({'id': v['id'], 'label': v['label'], 'sounds': v['sounds'],
                     'file': name})
    print(f"  {os.path.join(out, name)} ({cell.width}x{cell.height})")
json.dump({'grid': [COLS, ROWS], 'cell': [round(cw), round(ch)],
           'source': os.path.basename(src), 'visemes': manifest},
          open(os.path.join(out, 'visemes.json'), 'w'), indent=2)
print(f"  {os.path.join(out, 'visemes.json')} ({len(manifest)} shapes)")

# The grid has one more cell than there are shapes. The prompt asks for it to be
# left empty and it usually is, but a stray painted patch turns up often enough
# to be worth clearing — no frame slices from it, yet it ships on the master.
spare = COLS * ROWS - len(visemes)
if spare > 0:
    blank = Image.new('RGBA', (int(cw) + 2, int(ch) + 2), (0, 0, 0, 0))
    for i in range(len(visemes), COLS * ROWS):
        c, r = i % COLS, i // COLS
        img.paste(blank, (round(c * cw), round(r * ch)))
    img.save(src)
    print(f'  cleared {spare} spare cell(s) on {os.path.basename(src)}')
PY
}


# Blink — Sprite Studio's 3-state preset (open / half / closed).
#
# EDITED from the X-rest viseme plate, one call per state, NOT generated as a
# sheet. A blink frame has to composite straight over the plate the talk bank
# rests on, and a generation cannot do that: even given the finished plate as
# its reference, the model re-paints the character and lands at its own
# proportions — the v1 sheet followed the grid template and drifted in style,
# the v2 sheet followed the plate's style and drifted ~14% in scale, and neither
# leaves a rigid transform that puts the two paintings on top of each other.
# `artgen.py edit` returns the SAME drawing with one thing changed, so the
# frames arrive already registered and only the eyelids differ. (Both superseded
# sheets are kept under superseded/ with the prompts that made them.)
#
# The plate is padded to 3:4 before the call — the nearest offered ratio to its
# native 0.717 — because the route reframes anything it is not given at a ratio
# it can return.
blink () { # name
  echo "=== $1 · blink frames (edit) ==="
  local pad="$WORK/$1/templates/face-3x4.png"
  python3 - "$SPR/$1/${1}_visemes/${1}_X-rest.png" "$pad" <<'PY'
import sys
from PIL import Image
art = Image.open(sys.argv[1]).convert('RGBA')
w = round(art.height * 3 / 4)
flat = Image.new('RGB', (w, art.height), (0, 255, 0))
flat.paste(art, ((w - art.width) // 2, 0), art)
flat.save(sys.argv[2])
print(f'  {sys.argv[2]} ({flat.size[0]}x{flat.size[1]}, pad {(w - art.width) // 2}px per side)')
PY
  local HOLD="Everything else must be identical to the input, pixel for pixel: the same head size, the same head position and angle in the frame, the same hairstyle and every individual hair strand including the ones falling across the brow and the temple, the same eyebrows in the same place at the same weight, the same eyeliner and lash styling, the same skin tone, shading and freckles, the same nose, the same closed mouth and lips, the same earring, the same collar and garment, the same flat pure green #00FF00 background, the same framing and the same crop. Do not zoom, do not re-centre, do not re-paint, do not restyle, do not change the lighting or the colours. This is a single animation frame that will be composited straight over the original image, so anything that moves other than the eyelids shows up as an error."
  python3 "$A" edit \
    "Return this exact image with ONE change: her eyes are FULLY CLOSED — the upper eyelids lowered all the way so the lashes rest on the lower lids in a clean closed line. Not a squint, not a wink; both eyes close by the same amount.

$HOLD" --ar 3:4 -i "$pad" -o "$WORK/$1/generations/eyelid-closed.png"
  python3 "$A" edit \
    "Return this exact image with ONE change: her eyes are HALF-CLOSED — the upper eyelids lowered to cover roughly half of each iris, the lashes visibly dropped. It must read clearly as the in-between pose: obviously not the open eyes of the input, and obviously not fully closed. Both eyes lower by the same amount.

$HOLD" --ar 3:4 -i "$pad" -o "$WORK/$1/generations/eyelid-half.png"
  unpad_eyelids "$1"
}

# Back onto the reference canvas: undo the 3:4 pad, de-key, and copy X-rest in
# as the open state. The route does not return the ratio exactly (3:4 came back
# as 1792x2400, 0.4% wide), so this resizes to the padded canvas rather than
# assuming; `align` refines what is left.
unpad_eyelids () { # name
  local out="$SPR/$1/${1}_eyelids"
  mkdir -p "$out"
  for state in half closed; do
    python3 - "$WORK/$1/generations/eyelid-$state.png" \
             "$SPR/$1/${1}_visemes/${1}_X-rest.png" "$WORK/$1/generations/unpad-$state.png" <<'PY'
import sys
from PIL import Image
edit = Image.open(sys.argv[1]).convert('RGB')
ref = Image.open(sys.argv[2])
w = round(ref.height * 3 / 4)
pad = (w - ref.width) // 2
out = edit.resize((w, ref.height), Image.LANCZOS).crop((pad, 0, pad + ref.width, ref.height))
out.save(sys.argv[3])
PY
    python3 "$KEY" "$WORK/$1/generations/unpad-$state.png" "$out/${1}_$state.png" --key 00FF00
  done
  cp "$SPR/$1/${1}_visemes/${1}_X-rest.png" "$out/${1}_open.png"
  node "$SCRIPTS/studioprompt.mjs" --timeline blink > "$WORK/$1/meta/blink-timeline.json"
  python3 - "$WORK/$1/meta/blink-timeline.json" "$out" "$1" <<'PY'
import json, os, sys
from PIL import Image
tl = json.load(open(sys.argv[1])); out, who = sys.argv[2], sys.argv[3]
# seqexport/renderanim resolve a step to a file through `steps[].file`.
for s in tl['steps']:
    s['file'] = f'{who}_{s["frameId"]}.png'
probe = Image.open(os.path.join(out, f'{who}_open.png'))
tl['cell'] = list(probe.size)
tl['source'] = 'edit of {}_X-rest.png'.format(who)
json.dump(tl, open(os.path.join(out, 'blink.json'), 'w'), indent=2)
total = sum(s['durationMs'] for s in tl['steps'])
print(f"  {os.path.join(out, 'blink.json')} ({len(tl['steps'])} steps, {total} ms cycle)")
PY
}

# Hold the base plate still and swap only the feature that moves.
#
# Sprite Studio's mouthComposite technique (see composite.py). Without it the
# frames drift: the cells are painted independently, so the earring, the brows
# and the hair edge are redrawn slightly differently in every one, and a
# crossfade double-exposes them. It is NOT a shift — registering the frames
# finds a zero-pixel offset, because there is no rigid transform to find.
#
# After this, every frame is byte-identical to its base outside the ellipse, so
# the drift is zero by construction and crossfades are safe.
composite () { # name
  echo "=== $1 · region compositing ==="
  local vi="$SPR/$1/${1}_visemes" m="$WORK/$1/meta"
  # Only the visemes are composited here. The eyelid set is no longer a sliced
  # sheet whose cells drift against each other — it is edited from X-rest, so
  # `align` composites it against that plate directly, through the authored
  # eyes-only ellipse in meta/eye-region.json rather than a variance-fitted one.
  python3 "$SCRIPTS/composite.py" "$vi" --base "${1}_X-rest.png" \
    --frac 0.62 --pad 0.90 --apply --region-out "$m/talk-region.json"
  rebuild_master "$vi" "$WORK/$1/sheets/$1-talk.png" \
    "$WORK/$1/sheets/$1-talk-composited.png" 5 2 \
    "${1}_A-closed.png,${1}_B-teeth.png,${1}_C-open-mid.png,${1}_D-wide-open.png,${1}_E-rounded.png,${1}_F-puckered-o-w.png,${1}_G-lip-bite.png,${1}_H-tongue.png,${1}_X-rest.png"
}

# A contact sheet of the composited frames, written ALONGSIDE the de-keyed
# master rather than over it. Overwriting the master made the pipeline
# non-idempotent: `slice` would then re-cut already-composited cells, and a
# second `composite` pass would fit its ellipse to the previous pass's feathered
# blob — a smaller region every run, eventually eroding the very motion it is
# meant to preserve. The master stays exactly what `dekey` produced.
rebuild_master () { # framesdir master out cols rows csv
  python3 - "$1" "$2" "$3" "$4" "$5" "$6" <<'PY'
import sys
from PIL import Image
frames_dir, master, out, cols, rows, csv = sys.argv[1:7]
cols, rows = int(cols), int(rows)
names = csv.split(',')
img = Image.open(master).convert('RGBA')
w, h = img.size
cw, ch = w / cols, h / rows
for i, n in enumerate(names):
    cell = Image.open(f'{frames_dir}/{n}').convert('RGBA')
    img.paste(cell, (round((i % cols) * cw), round((i // cols) * ch)))
img.save(out)
print(f'  wrote {out.split("/")[-1]} from {len(names)} composited frames')
PY
}

# The spoken line becomes the clip folder's name, the way Laurah's clips are
# named after what she says (laurah_talk_short/laurah_hey-hey_00000.png).
slugify () { python3 -c "import re,sys; print(re.sub(r'[^a-z0-9]+','-',sys.argv[1].lower()).strip('-'))" "$1"; }

# The deliverable animations, in the shape the rest of the repo already uses:
# a Sprite Studio character-bank sequence per clip — numbered PNGs, frames.json
# and the After Effects README — plus a playable WebP preview beside it.
#
# Crossfaded, via Sprite Studio's `withBlendFrames`: one synthetic 50/50
# in-between at every cut, its screen time stolen evenly from both neighbours so
# the total timing is unchanged.
#
# This only works because `composite` ran first. On the raw cells a 50/50 mix
# double-exposed the earring, the brows and the hair edge, and the animations
# had to hard-cut. Composited, every frame is identical to its base outside the
# swapped ellipse, so a mix can only blend the part that is meant to move.
# Every pose set onto ONE canvas. Each was generated from its own bust crop
# through its own grid template, so each landed at its own scale and offset —
# and a bank that rests on another set's plate jumps. crossalign.py derives the
# transform (it does not search for it) and then rebuilds the eyelid plates as
# the X-rest plate with only an eyes-and-brows ellipse swapped, so a blink and a
# talk differ nowhere except where they must.
align () { # name
  echo "=== $1 · align pose sets ==="
  # Eyelids came from an EDIT of X-rest, so they are already on its canvas —
  # identity seed, small refine, then the eye ellipse is composited so the set
  # is byte-identical to X-rest everywhere else and `open` IS X-rest.
  python3 "$SCRIPTS/crossalign.py" "$1" --seed identity --refine 30 --sets eyelids \
    --fuse eyelids --fuse-base open --transforms-out "$WORK/$1/meta/align-eyelids.json"
  cp "$SPR/$1/${1}_eyelids/blink.json" "$SPR/$1/${1}_eyelids_aligned/blink.json"
  # Expressions are still a generated grid sheet with its own bust crop, so the
  # placement is derived. They are aligned, not fused: an expression changes the
  # whole face, so there is no region to hold still.
  python3 "$SCRIPTS/crossalign.py" "$1" --refine 250 --sets expressions --fuse "" \
    --transforms-out "$WORK/$1/meta/align-expressions.json"
}

anim () { # name line
  echo "=== $1 · animations ==="
  # The blink plays off the ALIGNED eyelids — same canvas as the visemes, so
  # `rest.png` serves both banks.
  local ey="$SPR/$1/${1}_eyelids_aligned" vi="$SPR/$1/${1}_visemes" m="$WORK/$1/meta"
  local slug; slug=$(slugify "$2")
  local blinkdir="$SPR/$1/${1}_blink" talkdir="$SPR/$1/${1}_talk_$slug"

  node "$SCRIPTS/studioprompt.mjs" --timeline blink --blend > "$m/blink.steps.json"
  node "$SCRIPTS/studioprompt.mjs" --timeline speech --say "$2" --speed 1 --blend \
    > "$m/speech.steps.json"

  # seqexport clears its output folder, so it runs before the preview lands there.
  python3 "$SCRIPTS/seqexport.py" "$m/blink.steps.json" "$ey" "$blinkdir" \
    --manifest "$ey/blink.json" --character "$1" --sequence blink --fps 7
  python3 "$SCRIPTS/seqexport.py" "$m/speech.steps.json" "$vi" "$talkdir" \
    --manifest "$vi/visemes.json" --character "$1" --sequence "$slug" --fps 12

  python3 "$SCRIPTS/renderanim.py" "$m/blink.steps.json" "$ey" \
    "$blinkdir/${1}_blink.webp" --manifest "$ey/blink.json" --height 768
  python3 "$SCRIPTS/renderanim.py" "$m/speech.steps.json" "$vi" \
    "$talkdir/${1}_speech.webp" --manifest "$vi/visemes.json" --height 768 --loop 0
}

# The hat, twice: a hero plate to composite with and a turnaround to model from.
#
# Hero FIRST, and the turnaround references the hero rather than the concept
# art. Handed the concept art, the model drags the character's robe and hair in
# with the hat — earlier passes came back with a smeared robe under the row and
# a wig hanging inside every brim. The hero plate carries the same design with
# nothing else in the frame, so there is nothing left to bleed.
hat () { # name hatdesc
  echo "=== $1 · hat hero prop ==="
  python3 "$A" asset \
    "A single game prop, three-quarter view from slightly above with the brim reading clearly as an ellipse: $2 $LOWPOLY Light source from the upper-left. No head, no face, no hair, no character, no mannequin. $GREEN_IT" \
    --ar 1:1 -o "$WORK/$1/generations/hat.png"
  python3 "$KEY" "$WORK/$1/generations/hat.png" "$SPR/$1/3d/$1-hat.png" \
    --key 00FF00 --trim --pad 6
  # Flatten onto the sheet's own grey so the reference cannot tint the plate.
  python3 - "$SPR/$1/3d/$1-hat.png" "$WORK/$1/templates/hat-ref.png" <<'PY'
import sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
art = Image.open(src).convert('RGBA')
flat = Image.new('RGB', art.size, (154, 154, 154))
flat.paste(art, (0, 0), art)
flat.save(dst)
PY

  echo "=== $1 · hat prop sheet ==="
  python3 "$A" sheet \
    "orthographic PROP model sheet for 3D modelling: EXACTLY FOUR views of the SAME single hat shown in the reference image, in one evenly-spaced horizontal row across the vertical middle of the frame on a flat neutral mid-grey #9A9A9A background — FRONT, LEFT SIDE profile, BACK, and THREE-QUARTER from slightly above. Exactly four hats in the whole image, all at the identical scale on one shared baseline. The prop is $2 $LOWPOLY The hat is EMPTY and unworn: no head, no face, no hair, no wig, no character, no mannequin and no stand — under the brim there is only the hat's own dark inner lining. Flat even neutral lighting. The background is ONE completely uniform flat grey: no gradient, no vignette, no ground plane, no cast shadow, no drop shadow, no blurred smudge, no soft dark blob anywhere in the frame, and NO faint ghosted or duplicate hats — the space above and below the row is empty flat grey. No text, no captions, no view labels, no titles, no numbers, no arrows, no logo, no watermark, nothing cropped at the edges." \
    -i "$WORK/$1/templates/hat-ref.png" \
    -o "$SPR/$1/3d/$1-hat-sheet.png"
}

for who in eleanor selyna; do
  want "$who" || continue
  mkdir -p "$SPR/$who"/{3d,concept-art} \
    "$WORK/$who"/{generations,templates,prompts,sheets,meta}
done

if run portrait; then
  want eleanor && portrait eleanor "$ELEANOR_ID" "$ELEANOR_FIT" "$ELEANOR_BARE"
  want selyna  && portrait selyna  "$SELYNA_ID"  "$SELYNA_FIT"  "$SELYNA_BARE"
fi
if run sheet; then
  want eleanor && modelsheet eleanor "$ELEANOR_ID" "$ELEANOR_FIT" "$ELEANOR_BARE"
  want selyna  && modelsheet selyna  "$SELYNA_ID"  "$SELYNA_FIT"  "$SELYNA_BARE"
fi
if run expr; then
  want eleanor && expressions eleanor "$ELEANOR_BARE"
  want selyna  && expressions selyna  "$SELYNA_BARE"
fi
if run talk; then
  want eleanor && talk eleanor
  want selyna  && talk selyna
fi
if run blink; then
  want eleanor && blink eleanor
  want selyna  && blink selyna
fi
if run composite; then
  want eleanor && composite eleanor
  want selyna  && composite selyna
fi
if run align; then
  want eleanor && align eleanor
  want selyna  && align selyna
fi
if run anim; then
  want eleanor && anim eleanor "The ember never truly went out."
  want selyna  && anim selyna  "Then let us wake it, and see what answers."
fi
if [ "$STAGE" = "slice" ]; then   # re-slice without paying for a regeneration
  for who in eleanor selyna; do
    want "$who" || continue
    slice_expressions "$who"
    [ -f "$WORK/$who/sheets/$who-talk.png" ] && slice_talk "$who"
    # the blink set is edited from X-rest, not sliced from a sheet — rebuild it with the `blink` stage
  done
fi
if run hat; then
  want eleanor && hat eleanor "$ELEANOR_HAT"
  want selyna  && hat selyna  "$SELYNA_HAT"
fi

echo "done — $STAGE / $WHO"
