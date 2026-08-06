# Character pipeline — Eleanor and Selyna

Production art for the two human characters: a low-poly turnaround to model
from, a dialogue portrait with a full expression set, a nine-shape lip-sync
talking sheet, a three-state blink, and the hat each of them is deliberately
**not** wearing anywhere else.

Everything here is reproduced by one script. It holds every prompt, so the art
is re-derivable and a prompt fix is a diff rather than a memory:

```sh
.claude/skills/nano-banana/scripts/batch-characters.sh <workdir> [stage] [who]
#   stage  portrait | sheet | expr | talk | blink | composite | align
#          | anim | slice | hat | all
#   who    eleanor | selyna | both                                    (default both)
# e.g.
bash .claude/skills/nano-banana/scripts/batch-characters.sh assets/raw/characters all both
```

Stage order matters: `expr` and `talk` crop their grid source from the finished
portrait; `composite` needs the frames those stages slice; `blink` EDITS the
composited `X-rest` plate, so `talk` and `composite` must precede it; `align`
puts every set on the viseme canvas; `anim` reads the aligned eyelids; and `hat`
generates the hero plate before the turnaround that references it. `all` runs
them in the right order, and `slice`, `composite`, `align` and `anim` each
re-run without paying for a regeneration.

**Re-run `slice` before `composite`, always.** `slice` re-cuts the pose sets from
the de-keyed master, which is the uncomposited art — so it undoes compositing,
and `composite` must follow it. Running `composite` twice without re-slicing is
worse than useless: the second pass fits its ellipse to the first pass's
feathered blob, so the region shrinks every run until it stops covering the
motion. That is why `rebuild_master` writes `<name>-<set>-composited.png`
alongside the master instead of over it — the master stays exactly what `dekey`
produced, and the chain stays idempotent.

## The hat is a separate prop, on purpose

The concept art has both characters in a wide-brimmed witch hat. Baked into the
model sheet, that hat welds itself to the skull mesh and there is no way to take
it off, swap it, knock it askew, or animate it separately.

So the characters are generated **bare-headed** and the hat ships as its own
prop with its own turnaround. The model sheets keep the crown of the head and
the full hairline visible with the hair lying close to the skull on top, so a
hat mesh can be fitted over it without clipping.

That has to be stated as a positive fact about the character — "she is
bare-headed, her hairline is visible" — and repeated. A bare `no hat` next to a
reference image that clearly shows a hat gets the hat drawn anyway.

## Deliverables

Laid out the way Laurah already is
(`assets/sprites/guide-characters/laurah-dragonMaster/`): one folder per
character, one folder per pose set or clip, and every clip is a Sprite Studio
character-bank sequence — numbered PNGs, `frames.json`, `README.txt`.

```
assets/sprites/characters/<name>/
  <name>-portrait.png              waist-up painterly dialogue portrait
  concept-art/                     the owner-provided source art
  3d/                              <name>-lowpoly-sheet.png   turnaround, 2752×1536
                                   <name>-hat-sheet.png       4 hat views, 2752×1536
                                   <name>-hat.png             hero hat plate
  <name>_expressions/              8 poses at 1376×1536 + the 4×2 contact sheet
  <name>_visemes/                  9 mouth poses at 1101×1536 + visemes.json
  <name>_eyelids/                  3 eyelid poses at 1101×1536 + blink.json
  <name>_eyelids_aligned/          the same, composited onto X-rest — what ships
  <name>_expressions_aligned/      expressions on the viseme canvas
  <name>_blink/                    clip: 8 PNGs + frames.json + README.txt + .webp
  <name>_talk_<line-slug>/         clip: PNGs + frames.json + README.txt + .webp
```

Three pose sets and two clips. The pose sets are what a runtime swaps directly;
the clips are the rendered animation, one PNG per step with the real per-frame
timing in `frames.json`. `<name>-portrait.png` is the base plate everything
else was derived from. Only `3d/` is flat grey; everything else carries alpha.

The workspace mirrors it, one folder per character:

```
assets/raw/characters/<name>/
  generations/   raw model output, before de-keying
  sheets/        de-keyed masters, and the composited contact sheets
  templates/     busts, head crops, grid templates, the green reference plate
  prompts/       the generated prompt text for each sheet
  meta/          step lists, viseme table, composite regions, the authored
                 eye ellipse, the align transforms
  superseded/    rejected takes
```

The clips are exported at half the authored cell height. At full size the four
came to 254 MB of PNG; the authored plates stay in the pose folders, so nothing
is lost by delivering the sequence at delivery size. Pass `--height` to
`seqexport.py` to override.

## Game-ready runtime copies

`assets/sprites/characters/<name>/` is the production tree — After Effects
sequences and 3D reference. The game loads from `assets/sprites/<name>/`, which
is to it exactly what `assets/sprites/laurah/` is to
`guide-characters/laurah-dragonMaster/`: the same frames at 560 px tall, named
the way `builtinSequenceFiles()` builds paths.

```sh
python3 scripts/bake-character-runtime.py [--height 560]
```

```
assets/sprites/<name>/
  <clip>/0.png, 1.png, …    talk and blink banks, in frames.json order
  rest.png                  the pose BOTH banks end on (X-rest)
  visemes/<id>.png          9 mouth poses      ┐ for a runtime that drives
  eyelids/<state>.png       3 eyelid poses     │ lip-sync itself rather than
  expressions/<name>.png    8 expression poses ┘ playing a pre-rendered bank
  visemes.json              sound groups → files
  catalog.json              frame counts and durations, ready to paste
```

Both characters are registered in `src/render/sequenceCatalog.ts` as built-in
sequences (`eleanor_blink`, `eleanor_talk`, `selyna_blink`, `selyna_talk`), so
they appear in the UI Builder's Animations rail and can be referenced by a saved
component with no upload. The durations there are the clip's own — regenerating
prints fresh arrays into `catalog.json`.

Both banks rest on the same `rest.png`, and it is baked from the blink bank's
first frame rather than from the `X-rest` plate. The two are the same drawing,
but a bank frame has been resampled twice (authored plate → the production
sequence's delivery size → runtime) and a plate resampled once lands a value or
two off — enough to tick every edge pixel at the moment the character is
supposed to go still.

Not wired: the animated dialogue bubble. `CharacterBubble` reads a `laurah_disc`
atlas baked by `scripts/bake-laurah-portrait.py`, and `speaker` is typed
`'cindra' | 'laurah'` in `src/core/types.ts`. Pointing it at Eleanor or Selyna
means widening that union and baking a matching disc atlas — a feature change,
not an art one.

None of this is registered in `src/data/assets.json` — the board does not load
character art; the sequences load by URL through the catalogue instead.

## Routing

| Deliverable | Job | Model | Why |
|---|---|---|---|
| portrait | `character` `--size auto_2K` | Seedream 5.0 Pro | Painterly rendering. `auto_*` on the edit route follows the reference's 3:4, which is the framing a portrait wants; an explicit `{width,height}` is silently ignored there. |
| model sheet, hat sheet | `sheet` | Nano Banana 2, 2K 16:9 | Multi-view layout consistency. |
| expression sheet, talking sheet | `sheet-4k` | Nano Banana 2, 4K 16:9 | 5504×3072 leaves each of the eight cells at 1376×1536 — a usable dialogue portrait on its own. At 2K a cell is 688×768, which is not. |
| hat hero | `asset` | Nano Banana 2, 1K 1:1 | One isolated object. |

## Keyed on green, not magenta

The repo convention is a magenta `#FF00FF` key. Not here: Eleanor's cloak is
wine-plum and Selyna's whole palette is rose pink, and `dekey.py`'s magenta
de-spill (`min(r,b) − g`) desaturates both. `dekey.py --key 00FF00` switches the
de-spill term to `g − max(r,b)`, which neither costume triggers. Nothing in
either design is green.

## The expression sheet is built from a mask template

The first attempt asked for "five head-and-shoulders portraits in a row" and got
five different framings with the shoulders clipped by the cell edges. Framing is
not left to the model any more — it comes from Sprite Studio's own grid-sheet
builder (`~/Documents/Dev/Helper/SmartGrid/sprite-studio`, `lib/gridSheet.ts`):

1. **`bust.py`** crops the finished portrait to a head-and-shoulders bust at a
   content aspect of **0.868**. Not a taste call — `gridSheet` pads a cell by 8%
   per side around the source's tight alpha bbox, so for a portrait source

   ```
   cell_ar = 0.84 * (w / h) + 0.16
   ```

   and a 4×2 sheet is `2 * cell_ar`. Solving `2 * cell_ar = 16/9` gives
   `w/h = 0.868`, and the template comes out at exactly 16:9 — the ratio the
   Gemini sheet route will render at. Hand the model a template at a different
   ratio and the cells stretch, which is how the first pass clipped shoulders.

2. **`gridsheet.mjs`** compiles `lib/gridSheet.ts` with Sprite Studio's own tsc
   and runs `buildGridSheet` in headless Chromium — it is canvas code, so it is
   run rather than ported, and a port would drift from the app the artist uses.
   Output: a 4×2 grid of identical white silhouettes, 3200×1800.

   ```sh
   node .claude/skills/nano-banana/scripts/gridsheet.mjs bust.png template.png \
     --cols 4 --rows 2 --cell 900 --mode mask --bg 00FF00
   ```

3. **Two references**: the portrait (Image 1, the character) and the template
   (Image 2, the layout), with the Sprite Studio prompt shape — name the role of
   each image, list the cells in reading order, then "keep everything else
   exactly the same".

4. De-key **without `--trim`**, then split 4×2 geometrically. The template is
   what makes a geometric split safe: every cell was authored at the same
   framing, so swapping frames in a dialogue box does not move the head.

**Flatten the template onto the same green the output is keyed on.** On a
contrasting backdrop the model reads the template's background as part of the
layout and paints it into the cells, where it survives de-keying as an opaque
panel behind every head. That is exactly what happened on the dark-grey pass.

## The talking sheet

Same grid-template method, different chart and a different crop.

**The shapes are Sprite Studio's, not mine.** `studioprompt.mjs` compiles
`lib/gridPrompts.ts` + `lib/phonetic.ts` with Sprite Studio's own tsc and calls
`buildMouthPrompt(9, 5, 2)` in Node, so the nine cells are described in exactly
the wording the app hands an artist — the industry-standard Rhubarb chart, from
`A` "lips pressed together" through `X` "neutral idle mouth between words".
Retyping that copy here would let the sheet drift from what Sprite Studio
expects back when it slices the result.

Two substitutions are applied to the app's text, and **both are asserted** — if
`gridPrompts.ts` changes upstream, the script exits rather than silently
shipping the wrong background:

- key colour: the app keys on violet `#B39DDB`, too close to cream and white
  content; these characters key on green.
- resolution: the app asks for 2K; a 5×2 grid needs 4K.

**The crop is a head, not the bust.** A mouth shape has to read at a glance, and
the repo's existing lip-sync — the dragon head frames in `faceAnimations.ts` —
swaps a head-region texture over a body, so head framing is what the runtime
pattern expects too. `bust.py --measure 0.30` takes the crop width from the top
30% of the figure (the head) and derives the height from the target aspect; the
default fixed-point iteration is wrong here, because for a tall narrow target it
keeps reaching further down into the widening body and never settles.

5×2 = 10 cells for 9 shapes. Cell aspect `(16/9)/(5/2) = 0.711`, so the head
content aspect is `(0.711 − 0.16)/0.84 = 0.656`. The slicer names the first nine
cells by viseme id, discards the tenth, and **blanks it on the master** — the
prompt asks for it to be left empty and it usually is, but a stray painted patch
turns up often enough to be worth clearing.

`talk/visemes.json` is emitted from Sprite Studio's `VISEMES` table, so the sound
groups a runtime maps against (`P · B · M` → `A-closed.png`) cannot drift from
the chart the frames were drawn to.

Raw, these frames drifted 12 px in x and 15 px in y (Eleanor). The `composite`
stage takes that to zero — see "Zero drift, by construction".

## The blink frames — edited, not generated

Sprite Studio's `Blink (3-state)` preset supplies the cadence: **open 2600 /
half 45 / closed 70 / half 55 ms** — four steps from three drawings, `half`
played once on the way down and once on the way back up — which is exactly what
the red dragon's `frames.json` already uses. `blink.json` is emitted from it
with the frame ids resolved to file names.

The three drawings come from `artgen.py edit`, one call per state, run **on the
`X-rest` viseme plate itself**. `open` is that plate, unmodified.

This is the one place in the pipeline where a generation is the wrong tool. A
blink frame has to composite straight over the plate the talk bank rests on, and
a generated sheet cannot do that — two attempts are kept under `superseded/`:

| attempt | reference | result |
|---|---|---|
| v1 | de-keyed portrait + grid template | followed the template, so it registered to ~2 px — but it is a *different painting*: different eyeliner weight, different lash pattern, and the hair lock over the brow falls somewhere else. Swapping a region shows the seam. |
| v2 | the finished `X-rest` plate + grid template | matched the painting, and then followed *its* head proportions instead of the template's — 14% off in scale, and not a rigid offset either, so no transform puts the two faces on top of each other. |

An edit returns the same drawing with one thing changed, so the frames arrive
already registered: the measured transform back onto the plate is scale 1.000
and an offset of 0–1 px. Overlay the result on the source and the whole image
cancels to flat grey except the eyes.

The plate is padded to **3:4** before the call — the nearest offered ratio to
its native 0.717. The route reframes anything it is not given at a ratio it can
return, and `--ar 3:4` came back as 1792×2400 (0.4% wide), which `unpad_eyelids`
resizes out rather than assuming.

Registration is then finished by `align` — see "One canvas" below.

### Stray patches, and why they need code rather than a re-roll

The model kept leaving painted patches floating in the background between
figures, and one that straddles a cell boundary survives slicing. Two things
were needed:

- **Reference the de-keyed portrait re-flattened onto pure green**, not
  Seedream's raw plate. The raw plate's painterly edges fade out into the green;
  the model reproduces that fade as an opaque white or teal backdrop behind the
  figure, which then survives de-keying. After de-keying, the reference is
  either character or exactly `#00FF00`, and the halos stopped.
- **Drop islands at full resolution.** Label the alpha above the feather
  (`>64`), keep components ≥2% of the largest, dilate the kept mask ~8 px to take
  the feather back. Labelling a downscaled mask does *not* work — bilinear smears
  the figure's painterly edge across the gap and welds the patch onto the figure
  as one component, which is why the first attempt reported dropping dozens of
  specks while the actual patch sailed through.

The cleaned cells are written back to the master. A patch left only on the
master is still a patch that shipped — and it will not show up if you check the
frames over black, because a dark residue on black looks like transparency.
Composite over magenta, or look at the alpha channel.

## The animations

`anim` turns the frame sets into playable files. Both step lists come from
Sprite Studio: the blink from its `blink` preset, the spoken line from its
phonetic engine — `tokenize()` (greedy digraph-first) then `toTimedSteps()`,
whose timing model holds vowels 160 ms, consonants 90 ms and rests 140 ms.

```sh
studioprompt.mjs --timeline blink                      # preset cadence
studioprompt.mjs --timeline speech --say "…" --speed 1 # text -> visemes -> timings
renderanim.py steps.json frames/ out.webp --manifest visemes.json
```

Each clip ships twice: as a Sprite Studio character-bank sequence
(`seqexport.py` — numbered PNGs, `frames.json`, `README.txt`, the same shape as
Laurah's clips) and as a playable WebP beside it. One PNG per *step*, not per
pose: a 2.6 s hold is one file, and a crossfade in-between is its own file with
`"blend": true`.

Frames are crossfaded with Sprite Studio's `withBlendFrames` — one synthetic
50/50 in-between at every cut, its screen time stolen evenly from both
neighbours so the total timing is unchanged. That is only safe because
compositing runs first; see below.

Two things this got wrong before it got them right:

**Pillow cannot write per-frame WebP durations.** It accepts a `duration` list
and silently stamps one value on every frame, which flattened a 2.6 s hold plus
a 45 ms blink into eight equal 28 ms ticks — a perfectly playable animation with
completely wrong timing, invisible unless you inspect the file. `renderanim.py`
encodes with libwebp's `img2webp` (`-d <ms>` per input), then reads the timing
back with `webpmux -info` and fails if it does not match what was asked for.

**Lossy WebP, not lossless.** Lossless is ~10× larger (a 69-frame portrait
sequence is 20 MB) with no visible difference on this brushwork. Alpha survives
either way.

## Zero drift, by construction

The cells are painted independently, so the earring, the brows and the hair edge
come out slightly different in every one. Cycled at 45 ms that reads as jitter,
and a 50/50 crossfade double-exposes it into obvious ghosting.

**It is not a shift.** Registering the frames against each other returns a
zero-pixel offset and a correlation field with no peak — there is no rigid
transform to find, because the difference is re-drawing, not displacement.
`alignframes.py` implements that registration and reports it honestly; it is
kept because measuring "no shift" is the thing that rules out the easy fix.

The fix is Sprite Studio's own `lib/mouthComposite.ts` technique, ported to run
over files as `composite.py`: hold one plate still and swap only a feathered
elliptical region from each other frame. Its header says exactly why — it
"removes full-frame shimmer when the source images differ slightly outside the
mouth (hair, shading, AI-generation noise)".

The ellipse is found from the data, and the signal took three attempts:

1. A percentile of per-pixel variance. These cells are repainted wholesale, so
   every pixel of the figure varies; the fitted ellipse covered 82% of the frame.
2. The variance *peak*. On Selyna's blink set that landed in her redrawn hair —
   loose hair varies more than an eyelid does.
3. **A targeted contrast**, which works: the frame that differs most from the
   base is the extreme of the motion (`closed` against `open`, `D-wide-open`
   against `X-rest`), and the difference between just those two peaks squarely
   on the moving part. Grow the connected region above 62% of that peak, keep
   any other component reaching 70% of it — that is what picks up the second
   eye — and fit the ellipse to the union.

Padding is `0.90` on the talk. The blink no longer runs through `composite.py`
at all — its frames are edits of `X-rest`, so `align` composites them against
that plate through the authored ellipse described below.

Results, measured on what shipped:

- Outside the ellipse every frame is **byte-identical** to its base —
  `max difference 0/255`, asserted on every run by `composite.py` for the
  visemes and by `crossalign.py` for the eyelids.
- Alpha bbox drift is **0 px** in x, y, width and height for all four sets.
- The animation files shrank about 5× (Eleanor's speech 1.5 MB → 259 KB) purely
  because inter-frame deltas collapsed to the ellipse. That is independent
  confirmation, not a separate optimisation.

One subtlety worth keeping: `over()` copies untouched pixels from the base
verbatim rather than round-tripping them through premultiply/unpremultiply.
Algebraically that round trip is the identity, but on a feathered edge it
divides by a near-zero alpha and uint8 rounding blows up — the first run failed
its own outside-the-mask check by 95/255, entirely in the figure's soft edges.

## One canvas (`align` / `crossalign.py`)

Each pose set was generated from its own bust crop through its own grid
template, so each landed on its own canvas — eyelids 1835×3072, visemes
1101×1536, expressions 1376×1536. Cross-set, the head sits at a different scale
and position, which is what made a bank resting on another set's plate jump.

The set-to-set transform is **derived, not searched**. Both steps back to the
portrait are exactly known:

1. `bust.py` cropped an axis-aligned rectangle. The crops are byte-identical
   sub-images, so `locate_crop` finds each origin exactly — Eleanor's blink and
   talk crops both start at (433, 4), her expression crop at (244, 4).
2. `buildGridSheet` stamped that crop into every cell contain-fit, with
   `PAD_PCT = 0.08` of the cell's long side as margin on all four sides. So the
   content box is a fixed fraction of any cell: 0.08 of the height, and
   `0.08 / cell_aspect` of the width.

Composing the two gives cell → cell directly. A bounded local search then
absorbs the few pixels the model drew off-template, scored on a head-band patch
with the mouth masked out — below the jaw the sheets are honestly different
paintings, so scoring the whole silhouette measures that disagreement instead of
the alignment. x and y get their own scale: the sheets render at the route's
16:9, not the template's aspect, so a cell comes back stretched by up to ~1%.

Two things about the search are load-bearing:

- **The translation stays bounded to a window around the seed.** A free argmax
  over an NCC map drifts into the transparent margin, where the window variance
  is ~0 and the ratio blows up to a meaningless maximum. Three earlier attempts
  all collapsed to the smallest scale in the sweep for exactly this reason.
- **The seed wins ties.** NCC picks its peak; `face_err` is what we care about,
  and on an already-aligned set the peak can sit a pixel off it.

The eyelid set is then *fused*: rebuilt as the `X-rest` plate with only an
eyes-and-brows ellipse swapped in, so it differs from the plate nowhere else.
That ellipse is authored, in `meta/eye-region.json`, and held in the **reference
plate's** coordinates so that regenerating the source at a different framing
cannot invalidate it. It is not `blink-region.json`: `composite.py` sizes that
one to 2σ of the whole moving field, which on this set reaches the mouth — a
fuse through it carries the eyelid sheet's mouth over the visemes.

The feather is scaled to `rx`, not to the canvas width. `make_mask` measures the
feather in x-units, so on a wide flat ellipse (rx 226 px against ry 74 px) a
width-relative feather collapses to a 9 px vertical band and the swap reads as a
rectangle.

Expressions are aligned but not fused — an expression changes the whole face, so
there is no region to hold still.

## What the model keeps getting wrong

Three failures recurred often enough to be worth designing around, not
re-rolling:

- **The reference bleeds.** Handed the full-figure concept art, the hat
  turnaround came back with the character's robe smeared under the row and a wig
  hanging inside every brim. Fixed structurally: generate the hero hat plate
  first — same design, nothing else in frame — and reference *that*. Nothing
  left to bleed.
- **Invented shadows and ghosts.** Soft dark blobs and faint duplicate props
  appear on grey plates unless the empty area is described as something rather
  than merely forbidden: "the space above and below the row is empty flat grey",
  plus explicit "no ghosted or duplicate" wording.
- **Occasional opaque backdrops.** A cell sometimes gets an opaque band where
  the painterly brushwork faded out. It is a dice roll — check the de-keyed
  sheet, and if a take has one, re-roll that plate. Both current sheets are
  clean.

Always Read the de-keyed PNG before shipping. A retry costs ~$0.13; a bad asset
costs a re-review.

## Re-skinning an existing clip (the merge-style variant)

`.claude/skills/nano-banana/scripts/reskin-clip.py <who>` produces a SECOND set
of talking and blinking banks for the same two characters, in Laurah's glossy
merge-game look rather than the painterly one above. It does not generate an
animation — it takes Laurah's retired banks as the animation and swaps only who
is in them.

```sh
python3 .claude/skills/nano-banana/scripts/reskin-clip.py eleanor   # 10 calls
python3 scripts/bake-character-runtime.py --prod assets/sprites/characters-merge \
        --out assets/sprites --suffix=-merge
```

Output tree is `assets/sprites/characters-merge/<who>/`, runtime is
`assets/sprites/<who>-merge/`. Nothing overwrites the painterly art; the two
looks coexist and the runtime loader picks a folder.

Three measured facts make it work, and `prepare` re-asserts all three every run
so a different source clip fails loudly instead of quietly boiling:

- Laurah's 40 frames across three banks are only **8 unique images** — the banks
  are re-orderings of 8 mouth poses. A character costs 8 generations, not 40.
- Her clips are **mouth-only**: between any two frames, pixels outside the mouth
  differ by 0/255 and the alpha silhouette is identical (IoU 1.0000). Holding a
  static plate therefore drops no motion. This is asserted, not assumed.
- Her `frames.json` timings are real hand-tuned animation timing, so they are
  carried over verbatim rather than re-derived.

### Banks come from grid sheets, not from per-pose edits

`posesheet.py <who> --chart blink|talk` generates a whole bank in ONE call, off a
grid template whose FIRST cell is the finished rest artwork rather than a
silhouette:

```sh
A=assets/raw/characters/selyna/reskin/poses/pose_7-v6.png
python3 .claude/skills/nano-banana/scripts/posesheet.py selyna --chart blink --anchor $A
python3 .claude/skills/nano-banana/scripts/posesheet.py selyna --chart talk  --anchor $A
```

  blink  3x1, padded to 21:9   open / half / closed   -> 4 steps, half replays
  talk   4x2, padded to 16:9   rest + 8 mouth shapes  -> talk_short / _mid / _long

Two calls per character, and every pose in a bank is drawn in the same pass, so
the drawings agree with each other by construction. The `edit`-per-pose route
that preceded this could not: it repaints the whole figure each call, and
measured against a re-skinned base the difference OUTSIDE the mouth (13.5/255)
came out LARGER than the difference inside it (8.6/255). That needed region
compositing to hide; a sheet does not.

The talk chart's eight cells are described to match Laurah's own eight unique
mouth poses, so her hand-tuned timings still mean what they meant and the three
length-picked banks survive as re-orderings of those eight.

**The anchor cell is what makes a sheet work here.** The docs above record two
blink sheets that were abandoned — v1 drifted in style, v2 drifted ~14% in
scale — and neither had one. Given a cell it must simply reproduce, the model
matches the rest of the grid to it.

### Normalise every cell; the sheet will not hold still on its own

`slice_cells` scales each cell so its figure matches the anchor's width and
places it where the anchor's bounding box starts. Three separate drifts, all
measured:

- The drawing starts at a different x in each cell — 22px and 41px on the first
  blink sheet, while the drawing's own width moved 0.4%. A pure slide, and on
  playback it reads as the head drifting sideways.
- The model draws a different SIZE PER GRID ROW. Selyna's 4x2 talk sheet came
  back 463x673 in the top row and 431x626 in the bottom — 7% smaller — so
  aligning left edges alone would have popped the head halfway through the bank.
- Each sheet picks its own scale inside the cell (the first blink sheet drew
  ~47% larger than its silhouette), so two charts off one anchor still disagree.

Normalising per cell is safe because neither the mouth nor the eyelids move the
figure's bounding box: within a row the eight mouth shapes agree to ~3px. Scale
comes from bbox WIDTH, placement from LEFT and TOP — the bust runs off the
bottom of every cell, so the bottom bound is clipped and carries nothing.

Two traps worth keeping:

- Resize the returned sheet to the template's exact dimensions BEFORE removing
  the pad. The route does not return the ratio it was asked for (21:9 came back
  2.357 against a 2.334 template), so a pad taken as a fraction of the returned
  image shaves the figure.
- Measure the bbox with a minimum-pixels-per-row rule, not `Image.getbbox()`.
  De-keying a JPEG leaves a sliver of half-opaque ringing on the cell boundary,
  enough to report a box spanning the full cell height when the head plainly
  does not.

### The edit route transfers style, but repaints everything

`artgen.py edit` holds the pose and swaps identity and style beautifully — one
call per pose, Laurah's frame in, Eleanor's frame out at the same framing. What
it does not do is hold the rest of the figure still. Measured against a
re-skinned base plate, the difference OUTSIDE the mouth (13.5/255) came out
LARGER than the difference inside it (8.6/255): hair, braid and cloak are
re-painted every call. Played back that boils rather than talks.

So every pose is region-composited onto ONE re-skinned rest plate, and the
script asserts 0/255 outside the mask before it will export. Same guarantee as
`composite` above, reached the same way.

### Two regions, two different ways of finding them

The mouth region is **measured**: the source clip's own moving pixels, dilated
0.045w for margin and blurred for the feather. Exact, and it needs no fitting.
An ellipse was tried first and is the wrong shape for it — fitted to the
variance spread it came out 0.144 half-width against a motion box 0.45 wide, and
simultaneously far too tall, because a weighted standard deviation does not
track a bounding box.

The eye region cannot be measured the same way, because the lid plates are
independent generations: thresholding their difference selects the whole
repainted character (differences over 80/255 spanning y 0.01–0.98). So it is
**located, then isolated** — `find_region`'s targeted contrast reliably puts a
band on the eyes, and inside that band the two largest connected components are
the two eyes. Its own ellipse is not used: fitted, it came out 0.67 of the frame
wide, wide enough to swap the temples and drag the boil back in.

### Floor the feather, or the hold-still check fails

Mask weights below 1/255 are floored to exactly zero. They cannot change an
8-bit result, but `over` blends any pixel whose weight is non-zero, and that
round trip through premultiplied alpha divides by a near-zero alpha in the
figure's soft edge. A mask whose tail was merely tiny rather than zero failed
its own outside-the-mask check by 111/255 — the same failure `composite.py`'s
header records at 95/255, arrived at from the other direction.

### What it does not produce

No visemes, no expression sheet, no portrait, no 3D. The re-skin gives banks and
an eyelid set only. A merge-style character that has to drive its own lip-sync
from arbitrary text still needs the viseme sheet from the main pipeline above —
this covers pre-rendered clips, which is what the dialogue system plays today.
