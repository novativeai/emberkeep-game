---
name: nano-banana
description: Generate game-ready art for Emberkeep and convert it to transparent-alpha PNGs at the right size. Routes by job — Seedream 5.0 Pro for character art, Nano Banana 2 for maps, character sheets and assets. Use whenever asked to generate/create game assets, icons, silhouettes, sprites, character art, sheets, maps, or concept art with AI ("nano banana", "seedream", "generate art", "make an asset"). Handles the API call, magenta de-keying to alpha, trimming, and resizing.
---

# Emberkeep art generation

## Routing — the job picks the model, never the caller

`scripts/artgen.py` is the only entry point. Each job is pinned to a model and
a size; passing a conflicting `--size`/`--ar` is rejected rather than honoured.

| job | model | size | provider / key |
|---|---|---|---|
| `character` | **Seedream 5.0 Pro** | 2048×1152 (16:9) | fal.ai · `FAL_KEY` |
| `concept` | **Seedream 5.0 Lite** | 1536×1536 | fal.ai · `FAL_KEY` |
| `map` | **Nano Banana 2** `gemini-3.1-flash-image` | **4K** | Gemini · `GOOGLE_KEY` |
| `map-pro` | **Nano Banana Pro** `gemini-3-pro-image` | **4K** | Gemini · `GOOGLE_KEY` |
| `map-seedream` | **Seedream 5.0 Pro** | `auto_2K` — its ceiling, see below | fal.ai · `FAL_KEY` |
| `sheet` | **Nano Banana 2** | 2K, **16:9 locked** | Gemini · `GOOGLE_KEY` |
| `sheet-pro` | **Nano Banana Pro** | 4K, **16:9 locked** | Gemini · `GOOGLE_KEY` |
| `sheet-4k` | **Nano Banana 2** | 4K, **16:9 locked** | Gemini · `GOOGLE_KEY` |
| `asset` | **Nano Banana 2** | **1K** | Gemini · `GOOGLE_KEY` |
| `edit` | **Nano Banana 2** | 2K, `--ar` required | Gemini · `GOOGLE_KEY` |

`edit` returns the SAME drawing with one thing changed. Reach for it instead of
a generation whenever the output has to stay pixel-compatible with the input —
an animation frame that must composite over its own base plate, a variant of an
approved asset. A generation *referencing* the plate still re-paints the subject
and lands at its own proportions; an edit does not. Pad the source to an offered
ratio first and pass that as `--ar`, or the route reframes it.

The three `map*` jobs are the same job on three models — use them to shoot one
brief across all three and pick. Gemini returns 5504×3072 at 4K/16:9; Seedream's
`v5/pro/edit` caps at `auto_2K` (~2584×1616 against a 16:10 reference) and
**ignores an explicit `{width, height}`** rather than erroring, so a size you
pass it silently does nothing. `auto_3K`/`auto_4K` exist only on the `v5/lite`
edit route; pro/edit 422s on them. `auto_*` preserves the references' aspect
ratio, which is how you get 16:10 out of a model with no 16:10 preset — the
Gemini routes cannot, since 16:10 is not an offered ratio there (16:9 is
nearest).

```sh
A=.claude/skills/nano-banana/scripts/artgen.py
python3 $A character "COVER PROMPT" -i sheet.jpg -o art/hero.jpg
python3 $A concept   "environment concept, painterly …" -o art/concept.jpg
python3 $A map    "top-down zone plate, no props …" -o art/zone.png --ar 16:9
python3 $A sheet  "character turnaround sheet, T-pose …" -o art/sheet.png
python3 $A asset  "… on a solid pure magenta #FF00FF background" -o /tmp/raw.png
```

Keys resolve from the environment first, then the nearest `.env` walking up
from cwd (`google_key` / `GOOGLE_KEY` / `GOOGLE_API_KEY` / `GEMINI_KEY`, and
`FAL_KEY` for Seedream). NEVER echo a key into logs or commit it.

Both Seedream routes use the `/edit` endpoint whenever `-i` references are
attached — always pass the canonical sheet so the art stays on-model.
Generation with a reference can take 2–4 minutes; run it in the background.
`--size` is accepted on the Seedream routes only — the Gemini routes are pinned.

## The Gemini call (validated July 2026 against the live API)

- Other model ids if a route ever needs changing: `gemini-3-pro-image` (GA),
  preview alias `gemini-3-pro-image-preview`, legacy `gemini-2.5-flash-image`.
- Endpoint (classic shape, confirmed working):
  `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`
  with header `x-goog-api-key: <key>`.
- Request body:

```json
{
  "contents": [{"parts": [{"text": "<prompt>"}]}],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"],
    "imageConfig": {"aspectRatio": "4:3", "imageSize": "2K"}
  }
}
```

- Aspect ratios: `1:1 3:2 2:3 3:4 4:3 4:5 5:4 9:16 16:9 21:9`.
  Sizes: `512px | 1K | 2K | 4K` (uppercase K). ~$0.13/image, 2–10 s.
- The image comes back base64 in `candidates[0].content.parts[].inlineData`
  (usually **JPEG — there is NO alpha channel**). SynthID watermark is embedded
  (invisible). Up to 14 reference images can be passed as additional
  `inlineData` parts for style/character consistency.

## Transparency pipeline (the key trick)

The API cannot output alpha. So: **prompt for a solid pure magenta `#FF00FF`
background** (the project's existing de-key convention), then chroma-key it:

1. `scripts/artgen.py asset` — calls the API, saves the raw image. Nano Banana 2
   returns JPEG; a `.png` output path is re-encoded so the rest of the chain
   gets the container it expects (the JPEG ringing around the key is still
   there, so keep key edges generous in the prompt).
2. `scripts/dekey.py` — magenta → alpha with soft edge + de-spill
   (`spill = max(0, min(r,b) − g)` subtracted from r/b, which never touches
   legit warm golds), optional `--trim` to content bbox and `--resize WxH`
   (contain-fit). Output: game-ready PNG.

```sh
python3 .claude/skills/nano-banana/scripts/artgen.py asset \
  "<prompt>… isolated on a solid pure magenta #FF00FF background" \
  --ar 4:3 -o /tmp/raw.png
python3 .claude/skills/nano-banana/scripts/dekey.py /tmp/raw.png out.png \
  --trim --resize 680x520
```

The key is read from `GOOGLE_KEY` env or the repo `.env` (`google_key=…`).
NEVER echo the key into logs or commit it.

## Prompting rules for EMBERKEEP assets (non-negotiable)

These win for anything we ship. `prompt-kit.md` holds a borrowed Hades II
character-craft sheet prompt and a Seedream cover prompt — different style,
kept only for reference.

- **Isometric perspective**: the game is 2:1 isometric. On-board objects must
  say: "isometric 3/4 view game asset, viewed from above at roughly 30 degrees,
  2:1 isometric projection, light source from the upper-left".
- **Characters face LEFT** (the engine mirrors for right-facing).
- **Palette** (name the hexes in the prompt): lava #E8503C · gold #F7A437 ·
  goldAccent #FFD84D · plum #4A3845 · plumShade #3A2B38 · cream #FFF6E8 ·
  night #241B22. Style: "painterly mobile-game art, warm, cozy, chunky shapes,
  soft gradients, subtle dark outline — in the style of premium merge games".
- **For keying**: "isolated single object, centered, on a solid flat pure
  magenta #FF00FF background, no shadow on the ground, no other elements,
  nothing crops off the edges". Never ask for magenta/pink/purple IN the
  subject — it would be keyed out.
- **Silhouettes**: "solid near-black silhouette (#241B22) with warm golden
  rim-light on the upper-left edge" — keep interior detail OFF.
- One subject per generation. Batch = one call per asset (sequential; respect
  429s — the Gemini routes retry with backoff).

## Sprite-sheet / animation-frame workflow (Sprite Studio pattern)

For frame VARIATIONS of an existing sprite (blink, talk, poses), don't generate
free-hand — use the grid-template method from Sprite Studio
(`~/Documents/Dev/Helper/SmartGrid/sprite-studio`, `lib/gridSheet.ts` +
`lib/gridPrompts.ts`):

1. Build an N×M **white-silhouette mask template** of the sprite with
   `buildGridSheet`. `scripts/gridsheet.mjs` is the harness — it compiles the
   lib with sprite-studio's own tsc and runs it in headless Chromium:
   `gridsheet.mjs src.png out.png --cols 4 --rows 2 --cell 900 --bg 00FF00`.
   **Flatten it onto the same colour the output will be keyed on**, not a
   contrasting one: on a contrasting backdrop the model reads the template
   background as part of the layout and paints it into the cells, where it
   survives de-keying as an opaque panel. The source must be a transparent PNG;
   `scripts/bust.py` crops a portrait to a bust at a chosen content aspect —
   pick it so the finished grid matches the aspect the route renders at
   (`cell_ar = 0.84·(w/h) + 0.16`; the derivation is in
   `docs/character-pipeline.md`), or the cells stretch and content clips.
1b. For a LIP-SYNC or BLINK sheet, don't write the cell copy —
   `scripts/studioprompt.mjs` runs sprite-studio's own definitions:
   `--chart mouth` calls `buildMouthPrompt` (`lib/gridPrompts.ts` +
   `lib/phonetic.ts`, the 9-shape Rhubarb chart); `--chart blink` fills
   buildMouthPrompt's scaffolding from the `blink` preset's own slots
   (`lib/presets.ts`, open/half/closed). `--key`/`--res` swap the app's
   violet/2K defaults and ASSERT the clause was found, so an upstream change
   fails loudly. `--visemes` and `--timeline blink` dump the shape table and
   the preset's cadence (2600/45/70/55 ms — the same numbers as the red
   dragon's frames.json) as JSON for a runtime manifest.
2. Generate with TWO refs via `artgen.py sheet "…" -i character.png -i template.png`:
   "Image 1 is the character reference… Image 2 is the layout template: a grid
   of identical white silhouettes marking exact position, scale and framing —
   follow its structure exactly… the ONLY thing that changes from cell to cell
   is <the eyes/the mouth/…>. Keep everything else exactly the same."
   Aspect ratio nearest the sheet (3×1 ≈ 21:9). Magenta key background (the
   studio's violet #B39DDB is too close to cream/white content — don't use it).
3. Slice cells (equal thirds — the template guarantees even framing), de-key
   WITHOUT --trim (frames in a set must stay co-registered on one canvas).
2b. **For a set that must composite over an EXISTING plate, don't build a sheet
   at all — `artgen.py edit` that plate, once per state.** A sheet is right when
   the whole set is new. It is wrong when the frames have to drop onto art that
   already shipped: even given the finished plate as its reference, the model
   re-paints the subject (different lash pattern, different hair over the brow)
   and lands at its own proportions, and no rigid transform puts the two
   paintings on top of each other. Pad the plate to the nearest offered ratio,
   ask for one change, list everything that must not move, then undo the pad.
   `crossalign.py --seed identity` finishes the registration (it comes back
   within a pixel) and composites the changed region.
3b. **Composite, or the set will drift.** Independently painted cells redraw the
   earring, brows and hair edge slightly differently, which jitters on playback
   and ghosts on a crossfade — and it is NOT a shift, so registering the frames
   cannot fix it (`alignframes.py` will show you the zero-offset, no-peak
   result). Use `scripts/composite.py`: Sprite Studio's `mouthComposite`
   technique, holding one base plate and swapping only a feathered ellipse
   found from the base-vs-most-different-frame contrast. Outside the ellipse
   every frame then matches the base byte for byte, which the script asserts.
   Then drop stray islands: the model leaves painted patches floating in the
   background, and one straddling a cell boundary survives slicing. Label the
   FULL-SIZE alpha above the feather (>64) and keep only components ≥2% of the
   largest, dilating the kept mask ~8 px to take the feather back. Do not label
   a downscaled mask — bilinear smears the figure's painterly edge across the
   gap and welds the patch on. Write the cleaned cells back to the master too.
4. For Emberkeep head-frames: assemble in the red-dragon folder format
   (4 frames, middle frame duplicated; frames.json durations blink
   2600/45/70/55 ms, talk 4×267 ms), add the character to
   `scripts/calibrate-faces.mjs` CHARACTERS, run it — it self-verifies
   (IoU ≥94%, drift ≤0.5px) and writes `src/data/faces.json`.

## New dragon breeds / skins — use the `dragon-forge` skill

Don't hand-roll one. `.claude/skills/dragon-forge/` owns the whole trip (its
scripts live here: `scripts/dragonbreed.py` + `scripts/dragonroster.py`): source
rig → parts sheet → composed per-stage prompt → `sheet-pro` generation → cells
sliced back onto each layer's exact canvas and registered → a rig-ready folder
whose rig.json has `images` **re-embedded**. Read that SKILL.md before touching
any of it; the non-negotiables there were each learned by breaking them.

## Quality loop

ALWAYS visually inspect the de-keyed PNG (Read the file) before shipping:
check perspective, edge halos, palette drift, and that nothing was cropped.
Regenerate with a corrected prompt rather than accepting a flawed asset —
each retry costs ~$0.13, a wrong asset costs a re-review.

Where assets go + exact target sizes: `docs/ART-REQUESTS.md`.
