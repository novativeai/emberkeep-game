---
name: nano-banana
description: Generate game-ready art with Google's Nano Banana Pro (Gemini 3 Pro Image) and convert it to transparent-alpha PNGs sized for Emberkeep. Use whenever asked to generate/create game assets, icons, silhouettes, sprites, or concept art with AI ("nano banana", "generate art", "make an asset"). Handles the API call, magenta de-keying to alpha, trimming, and resizing.
---

# Nano Banana Pro asset generation

## The model (validated July 2026 against the live API)

- **Model id: `gemini-3-pro-image`** (GA; preview alias `gemini-3-pro-image-preview`;
  cheaper drafts: `gemini-3.1-flash-image`, legacy `gemini-2.5-flash-image`).
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

1. `scripts/generate.py` — calls the API, saves the raw image.
2. `scripts/dekey.py` — magenta → alpha with soft edge + de-spill
   (`spill = max(0, min(r,b) − g)` subtracted from r/b, which never touches
   legit warm golds), optional `--trim` to content bbox and `--resize WxH`
   (contain-fit). Output: game-ready PNG.

```sh
python3 .claude/skills/nano-banana/scripts/generate.py \
  --prompt "<prompt>… isolated on a solid pure magenta #FF00FF background" \
  --aspect 4:3 --size 2K --out /tmp/raw.png
python3 .claude/skills/nano-banana/scripts/dekey.py /tmp/raw.png out.png \
  --trim --resize 680x520
```

The key is read from `GOOGLE_KEY` env or the repo `.env` (`google_key=…`).
NEVER echo the key into logs or commit it.

## Prompting rules for EMBERKEEP assets (non-negotiable)

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
  429s — generate.py retries with backoff).

## Sprite-sheet / animation-frame workflow (Sprite Studio pattern)

For frame VARIATIONS of an existing sprite (blink, talk, poses), don't generate
free-hand — use the grid-template method from Sprite Studio
(`~/Documents/Dev/Helper/SmartGrid/sprite-studio`, `lib/gridSheet.ts` +
`lib/gridPrompts.ts`):

1. Build an N×M **white-silhouette mask template** of the sprite with
   `buildGridSheet` (compile the lib with sprite-studio's own tsc and run it in
   headless Chromium — see the batch scripts for a harness example). Flatten it
   onto dark gray so the model can see the white masks.
2. Generate with TWO refs via `generate.py --ref character.png --ref template.png`:
   "Image 1 is the character reference… Image 2 is the layout template: a grid
   of identical white silhouettes marking exact position, scale and framing —
   follow its structure exactly… the ONLY thing that changes from cell to cell
   is <the eyes/the mouth/…>. Keep everything else exactly the same."
   Aspect ratio nearest the sheet (3×1 ≈ 21:9). Magenta key background (the
   studio's violet #B39DDB is too close to cream/white content — don't use it).
3. Slice cells (equal thirds — the template guarantees even framing), de-key
   WITHOUT --trim (frames in a set must stay co-registered on one canvas).
4. For Emberkeep head-frames: assemble in the red-dragon folder format
   (4 frames, middle frame duplicated; frames.json durations blink
   2600/45/70/55 ms, talk 4×267 ms), add the character to
   `scripts/calibrate-faces.mjs` CHARACTERS, run it — it self-verifies
   (IoU ≥94%, drift ≤0.5px) and writes `src/data/faces.json`.

## Quality loop

ALWAYS visually inspect the de-keyed PNG (Read the file) before shipping:
check perspective, edge halos, palette drift, and that nothing was cropped.
Regenerate with a corrected prompt rather than accepting a flawed asset —
each retry costs ~$0.13, a wrong asset costs a re-review.

Where assets go + exact target sizes: `docs/ART-REQUESTS.md`.
