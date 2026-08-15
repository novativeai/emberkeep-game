# VFX textures — technique, sources, and how they land in Emberkeep

Companion to [`asset-sourcing.md`](./asset-sourcing.md) (which covers board/UI/
character art). This one covers the **effects** layer: particles, glows,
flipbooks, decals.

Distilled 2026-07-27 from LeLu's *"VFX Texture Creation: The ULTIMATE guide"*
(28 min, Sep 2025 — https://www.youtube.com/watch?v=dMthnzpR-eU) plus the two
databases it points at. Licenses marked **[verified]** were read off the source
page; **[db-tagged]** means the tag came from Simon Schreibt's database and has
NOT been re-verified — confirm before shipping.

> **This is wired up.** Everything below — the generators, the Krita technique
> chain, the flipbook support and the source list — is implemented in **FX Studio**
> (`tools/fxstudio/index.html`, 🧪 **Textures**). Open the file directly and bake,
> import, or process a texture, then bind it to an FX preset. Pipeline details
> in [`pipelines.md`](./pipelines.md#fx-studio-toolsfxstudio--merge-fx--vfx-textures).
>
> The baked bank lives in `assets/vfx-bank/`. Its flipbooks carry **motion
> vectors and channel-packed data** — see §6.

---

## 1. The governing idea

> Textures are the identity of an effect. Hades, League of Legends and Final
> Fantasy are recognisable by their texture language alone, and a single
> texture swap can completely change the read of an effect.

And its corollary, which LeLu takes from Simon Schreibt's GDC talk
*"How (not) to create Textures for VFX"* (https://gdc2022.simonschreibt.de):

> **Do not author the common textures.** Fire, explosions, lightning, smoke —
> these exist for free in high quality. Spend authoring time only on the
> textures that are specific to your game, and buy back the rest.

For Emberkeep that line falls in an obvious place: generic embers/sparks/smoke
are **sourced**; the lava-seam glow, the Emberberry sparkle and the golden-hatch
finale burst are **authored**, because they carry the game's identity.

Texture taxonomy used throughout: **simple shapes · noise · decals · animated
(flipbooks) · procedural oddities.**

---

## 2. Krita — the one tool to actually learn

Free, and LeLu's pick if you only learn one. He uses ~5 brushes and a handful of
filters. The whole technique set, condensed:

**Brushes** (`Shift`+drag = size, `F5` = brush properties)
| Brush | Use |
| --- | --- |
| Default round | Blocking simple shapes |
| Pressure round | Hand-painted strokes (tablet) |
| Airbrush | Soft mass — the workhorse for most textures |
| **Blending brush** | Smear/drag pixels. `F5` → density ≈ 60%. This is how you get waves, wind, motion and smoke wisps |
| **Scatter brush** | `F5` → swap in any texture, drop spacing → spray N copies in one stroke |

**Shape tricks**
- Curve tool + symmetry → a heart in 3 clicks.
- Line tool + horizontal symmetry + fill tool → a star in 4 clicks.
- **Wrap-around mode** → see the tile repeat live and hand-fix the seams. This
  is the seamless-texture workflow; no plugin needed.
- Drag guides from the rulers until they snap to image centre, then place
  circles off that centre for registration on radial work.
- **Multibrush** — mirrors every stroke across N axes (set the amount, e.g. 8)
  plus a snowflake mode. Magic circles / mandalas / runes in seconds. This is
  the single highest-leverage tool in the program for VFX.

**Filters**
- **Gaussian blur on a duplicated layer = glow.** Stack more duplicates for
  more intensity. (`Ctrl+E` merges layers down.)
- **G'MIC-Qt** (`Start G'MIC-Qt`): *Deformation* → shatter/break look;
  *Continuous rust* → spiral; *Sphere* → spherise a gradient (pair with the
  blend brush in wrap-around); **Morphological** with transparency enabled →
  dissolve. He uses morphological specifically for **lava and fire edges**.

---

## 3. The rest of the stack, tiered by whether it's worth it for us

| Tool | Cost | Verdict for Emberkeep |
| --- | --- | --- |
| **Krita** | free | **Yes — primary.** Everything in §2. |
| **Effect Texture Maker** (mebiusbox) https://mebiusbox.github.io/contents/EffectTextureMaker/ | free, browser | **Yes — first stop.** LeLu's favourite generator, and it's a fit: presets for spark / sun / perlin / lightning / electric / flower / fire, sliders for intensity·strength·power, polar conversion, tiling toggle, normal-map out, and **still or animated export**. License [db-tagged CC0], unverified on the page — confirm in-app. |
| **Materialize** (free) | free | **No.** Generates height/normal/AO. Phaser has no lighting model here. |
| **Pixel Composer** | ~$10 | **Maybe.** Node-based sprite/texture generator — shapes, blends, particles, dissolve, noise distortion, and keyframable animation on any property, exportable as sheets. Genuinely useful if we want authored flipbooks without hand-animating. Not a game engine; don't push 3D through it. |
| **OpenToonz** | free | **Maybe, later.** Hand-painted animated effects, Japanese keyframe workflow. The right tool if we ever want a hand-drawn hatch burst. |
| **Blender** | free | **Sparingly.** Fine for 3D; LeLu explicitly *discourages* baking sim flipbooks — slow, crash-prone, no realtime preview. We already run three.js for the crystal decor. |
| **EmberGen** | $$$ + strong GPU | **No.** Realtime volumetric fire/smoke. His words: overkill unless you're pro VFX/film or volumetric-heavy. |
| **Engine-native noise bake** | free | **N/A as described** (Unreal material graph → render target → PNG; Godot `NoiseTexture` + bake script) — but see §5: `TextureFactory` already *is* our procedural bake step. |
| **Photoshop** | sub | Optional. Two tricks worth stealing regardless of tool: **stroke-with-gradient** (his vanishing lightning bolt), and **invert → Channels → ctrl-click Red = contrast-based selection** → isolates a photographed texture onto its own layer. That second one is the decal/damage/splatter workflow. |
| **SQLPY channel packer** https://sqlpy.itch.io/online-texture-channel-packer | free, browser | Only if we start packing masks into RGBA channels. |

---

## 4. Sources — curated from the 263-entry database

Full DB: https://simonschreibt.notion.site/Textures-for-VFX-Database-2c72eccccfa84a0eae927d778ad746cc
(263 rows: 128 tutorials, 43 texture packs, 31 generators, 27 brush packs,
20 forum threads, 14 footage sources, 6 talks, 5 VDB.)

Filtered to what a 2D Phaser merge game can actually eat:

### Drop-in, free
| Pack | URL | License |
| --- | --- | --- |
| **LeLu's Free Textures Pack 1** | https://leluvfx.gumroad.com/l/freeTextures | **[verified]** $0.00, and in the video: *"you don't even have to credit me."* |
| **Luos Free Noise Textures V1** — 68 textures (6 merged, 22 noise gradients, 28 normal maps) | https://luos.gumroad.com/l/FreeNoise | **[verified]** *"You are allowed to use these files in any project, commercial or not"* — thank-you note in credits appreciated |
| **Luos Free Noise Textures V2** — hand-drawn noise | https://luos.gumroad.com/l/bouSt | **[verified]** free |
| **Unity free VFX image sequences / flipbooks** — fire, explosion, smoke (Houdini-authored by Unity Labs Paris) | https://blog.unity.com/technology/free-vfx-image-sequences-flipbooks | **[verified]** CC0 — *"image sequences we want to share with you under CC0 license. Feel free to use them in your projects!"* · direct zips under `unity3d.com/files/labs/downloads/vfx/` |
| **Kenney Smoke Particles** | https://www.kenney.nl/assets/smoke-particles | CC0 — already vetted in `asset-sourcing.md` |
| **Unity Particle Pack** | https://assetstore.unity.com/packages/essentials/tutorial-projects/unity-particle-pack-127325 | **[db-tagged]** free · Simon handpick |
| **1MAFX fire + noise textures** | https://1mafx.gumroad.com/ | **[db-tagged]** free |
| **Nieuwe/Niels De Witte noise** (ray, blink, aura) | http://nielsdewitte.be/index.php?page=Pages/VFExtra.php | **[db-tagged]** free |
| **Tiling Painterly Textures Vol. 2** — stylized brush/stroke tiles | https://jakebenbow.gumroad.com/l/JB_TilingPainterlyTextures_Vol2 | **[db-tagged]** free/CC0 |
| **Flame Trail Textures** | https://drive.google.com/drive/folders/1XSwdY_yMx2Jcz6CEElLPPCmo0baP-AIV | **[db-tagged]** free |

### Generators (browser, no install)
- **Effect Texture Maker** — see §3. The one to start with.
- **Fateloom VFX texture generator** — https://vfxtexturegenerator.fateloom.io/ (cloud/noise) **[db-tagged free]**
- **Noise Generator (Bubblebird)** — https://noisegen.bubblebirdstudio.com/ — marble noise + turbulence
- **Texture Generator Online / Normal Map Online** (cpetry) — http://cpetry.github.io/TextureGenerator-Online/ · http://cpetry.github.io/NormalMap-Online/ **[db-tagged free]**
- **Flame Painter Online** — https://www.escapemotions.com/experiments/flame/ **[db-tagged free]**
- **PixaFlux** — node-based image/texture composer **[db-tagged free]**
- **Material Maker** — https://rodzilla.itch.io/ — open-source Substance-Designer-alike **[db-tagged free]**

### Photo/footage for photobashing decals (CC0 tier)
Pexels · Unsplash · Pixabay · PublicDomainPictures · CC Search · ActionVFX free
collection · FootageCrate (5/day). Use with the Photoshop red-channel isolation
trick from §3.

### Krita-specific
**GDQuest free brushes for game artists** — https://github.com/GDQuest/krita-free-brushes

---

## 4b. The bank — `assets/vfx-bank/`

The sourcing rule above, executed. **25 game-ready textures** (16 stills, 9
flipbooks, 7.8MB) built from CC0 packs found through the database, graded into
the `PALETTE`, one entry per real VFX moment in the game.

```
assets/raw/vfx-sources/     CC0 pack art the bank is baked FROM (never loaded at runtime)
assets/vfx-bank/bank.json         the manifest — role, source, recipe per asset
assets/vfx-bank/bank.index.json   what was baked, from what, under which licence
assets/vfx-bank/particles/        fx_*  stills
assets/vfx-bank/flipbooks/        fb_*  sheets
assets/vfx-bank/noise/            noise_* tiling fields
assets/vfx-bank/contact-sheet.png QC sheet, rendered on black
```

| | keys |
| --- | --- |
| **Core particles** | `fx_ember` `fx_spark` `fx_glow` `fx_mote` `fx_debris` |
| **Atmosphere** | `fx_mist` `fx_fog_puff` |
| **Beats** | `fx_flare` `fx_shock_ring` `fx_magic_circle` `fx_scorch` `fx_twirl` `fx_leaf_spark` |
| **Flipbooks** | `fb_smoke_wispy` `fb_smoke_puff` `fb_flame_small` `fb_flame` `fb_fireburst` `fb_dustburst` `fb_fireball` `fb_cloud` `fb_wisp` |
| **Noise** | `noise_turbulence` `noise_vein` `noise_fbm` |

**Re-bake:** `node scripts/bake-vfx-bank.mjs --contact`
**Verify:** `node tools/checks/vfxbanktest.mjs`

The baker drives the real FX Studio engine in headless Chromium, so the bank and
the authoring tool cannot drift. Edit `bank.json` and re-bake; never hand-edit a
baked PNG.

### Rules the bank encodes (learned the hard way here)

- **ADD textures must be black at the border.** Under `BlendModes.ADD` the RGB is
  added regardless of alpha, so one lit edge pixel draws a glowing rectangle
  around the particle. The `edgeFade` technique forces it, and
  `tools/checks/vfxbanktest.mjs` fails the build if any additive still violates it —
  it caught `fx_shock_ring` and `fx_twirl` after they passed visual review.
- **Flipbook cells are not always square.** Unity's 16×4 and 20×4 sheets carry
  tall cells (64×128, 51×128); forcing square cells squashes every flame. The
  baker defaults to the source's native cell size.
- **Sheets get a per-pixel grade only.** Blur/dissolve/symmetry read neighbouring
  pixels and would smear frame N into frame N+1, so `bakeSheet` runs mask →
  levels → ramp and nothing spatial.
- **`fb_flame_small` frames touch their left/right cell edges** (inherited from
  Unity's own authoring — the source sheet does too). Sample it with a
  half-texel inset or adjacent frames will bleed.
- **Author the mask, colour last.** Every recipe is `generator → mask →
  techniques → ramp`, which is why one source serves fire, magic and ice.
- **`assets/` is the publicDir AND the art workspace** — `raw/vfx-sources` and
  `vfx-bank` are in the `pruneDistArt` SOURCE_ONLY list in `vite.config.ts` so
  they never ship. **Narrow that entry when bank textures get wired into
  `assets.json`, or they will be stripped from the deploy.**

### Not vendored, deliberately

**LeLu's Free Textures Pack** is $0 and CC0-*for-use*, but its licence reads
*"You CANNOT resell and/or redistribute this asset pack"* — so it must not be
committed here (same rule as CraftPix in `asset-sourcing.md`). It also sits
behind a Gumroad checkout that needs an email address. Download it per-developer,
then **FX Studio → 🧪 Textures → Library → Import PNG(s)** and bake against it
with the `source` generator; derived textures are fine to ship, the pack is not.

## 5. What this means for Emberkeep specifically

**Current state — this is the gap.** Of 148 entries in
[`assets.json`](../src/data/assets.json), 106 are real art and 42 are still
runtime-painted placeholders. Four of those placeholders are the *entire* VFX
vocabulary of the game:

| Key | What it actually is today | Drives |
| --- | --- | --- |
| `fx_ember` | 18×18 px radial gradient (white → gold → lava → clear) | merge bursts, ambient lava-seam motes, ember-flies |
| `fx_spark` | 22×22 px 4-point star, two passes | merge sparks, UI celebration bursts |
| `fx_glow` | 256×256 px white radial falloff | every soft glow in the game |
| `fx_shell` | painted shell fragment | hatch debris |

`assets.json` already reserves the swap path for all four
(`file: "raw/ai/fx_*.png"`, `source: "placeholder"`), so upgrading is a
**file drop + one-word flip per key**, with the painted version staying as
automatic fallback. Same ingest workflow as `asset-sourcing.md`:
download → `assets/raw/<source>/` → line in
[`assets/CREDITS.md`](../assets/CREDITS.md) → `pnpm probe -- <png>` →
flip `source` to `"file"`.

**Constraints that shape what we can source or author:**

- **Additive blending.** `fx_ember` and the ambient emitters run
  `Phaser.BlendModes.ADD`. Author/source on **black**, never on white, and
  avoid premultiplied edges — a grey halo becomes a visible box under ADD.
  `fx_shell` and `fx_spark` are alpha-over and want honest alpha instead.
- **Resolution headroom is enormous.** The canvas is 2560×1600 (`RES = 2`) and
  our largest particle texture is 22 px. A sourced 128 px ember is a step change
  in quality at negligible cost — the current textures are the bottleneck, not
  the emitters.
- **Ceiling: 4096 px per texture** (old-device GPU budget — see
  `docs/pipelines.md`). An 8×8 flipbook of 128 px frames is 1024², comfortable.
- **Flipbooks are available but unused.** Phaser particle emitters accept
  frame arrays / `anim` off a spritesheet, and `PreloadScene` already loads one
  (`laurah_disc`). This is the biggest *qualitative* upgrade on the table:
  animated smoke/fire beats a scaled radial gradient by a wide margin.
- **Power governor.** Frame throttling drops to 30/15 fps, so any flipbook must
  advance on elapsed time, not on frame count, or it'll slow down with the
  governor.
- **`TextureFactory` is our procedural bake step.** The video's "bake noise from
  the engine's material graph" advice maps onto it directly — it already paints
  at `×RES` on demand. Procedural stays the right answer for anything that must
  recolour with the palette; files win for anything with real detail.

**Recommended order of attack**
1. `fx_ember` and `fx_spark` — highest frequency on screen, smallest textures,
   fully covered by free sources. Effect Texture Maker or LeLu's pack.
2. `fx_glow` — one soft radial; trivial, but 256 px flat white is doing a lot of
   work it isn't good at.
3. Smoke/fire **flipbooks** for the hatch and finale beats (Unity's free
   sequences) — new capability, not just a swap.
4. Authored-in-Krita identity pieces: the lava-seam glow and the golden-hatch
   burst, using multibrush + morphological-dissolve from §2.


---

## 6. Motion vectors, channel packing, runtime colour

Everything above gets a flipbook onto the screen. This section is what makes it
read as real-time VFX rather than a slideshow — and it is the part that was
missing when this bank was first called "AAA".

### The problem

A flipbook played below its authored frame rate cross-dissolves between frames,
so for a moment you see **both** — a double exposure. It is the single most
recognisable tell of a cheap effect.

### The fix: warp, then blend

`scripts/bake-vfx-mv.py` computes dense optical flow between consecutive frames
and bakes it alongside the art. At draw time the shader warps frame A *forward*
along its flow and frame B *backward* along its, so features travel to where
they actually go, and only then blends. Both flows are stored so neither side
ghosts:

| file | R | G | B | A |
| --- | --- | --- | --- | --- |
| `<key>_pack.png` | density | emissive | erosion order | coverage |
| `<key>_mv.png` | forward.x | forward.y | backward.x | backward.y |

The pack carries **no colour**. `ramps.png` (8 palette rows × 256) is looked up
by density at draw time, so one smoke sheet plays as ash, ember, moss or arcane
from a single uniform — the flexibility that baking the palette into pixels
otherwise costs.

The **erosion** channel is a per-pixel dissolve *order*, so a one-shot burns
away organically instead of fading uniformly.

### Measured, not asserted

Each sheet is scored against the frames decimation threw away —
MV-interpolated vs the cross-dissolve everyone gets for free:

| sheet | frames | grid | mvScale | vs cross-dissolve |
| --- | --- | --- | --- | --- |
| `fb_cloud` | 64 → 16 | 4×4 @ 128×128 | 2.6px | **1.5×** |
| `fb_dustburst` | 25 → 12 | 4×3 @ 192×192 | 10.5px | **3.09×** |
| `fb_fireball` | 64 → 16 | 4×4 @ 128×128 | 7.4px | **1.14×** |
| `fb_fireburst` | 25 → 12 | 4×3 @ 192×192 | 5.4px | **2.23×** |
| `fb_flame` | 64 → 32 | 8×4 @ 64×128 | 3.5px | **3.1×** |
| `fb_flame_small` | 64 → 32 | 8×4 @ 64×128 | 13.9px | **4.33×** |
| `fb_smoke_puff` | 64 → 16 | 4×4 @ 128×128 | 5.1px | **1.18×** |
| `fb_smoke_wispy` | 64 → 16 | 4×4 @ 128×128 | 6.2px | **1.17×** |
| `fb_wisp` | 80 → 20 | 5×4 @ 51×128 | 4.5px | **1.45×** |

Re-run with `python3 scripts/bake-vfx-mv.py --report`.

### Why the frame counts drop

With motion vectors, a quarter of the frames reconstructs better than half of
them without. That is the VRAM saving — **29.0MB → 19.8MB (−32%)** across the
bank, with better motion than the originals had.

It is not uniform: coherent transport (smoke, cloud) decimates 4× happily, while
fast-flickering fire does not. `fb_flame_small` at 16 frames scored 2.3×; at 32
frames it scores **4.3×** for the same bytes, because at 16 the kept frames are
genuinely different flames and no flow field can reconcile them. Per-sheet
limits live in `TUNING` in the baker.

### Two traps that silently produce garbage

Both are guarded by `--self-test`, which recovers known translations and refuses
to bake if it cannot:

1. **`alpha` is scale-sensitive.** It competes with `Ix²+Iy²`, which is ~1e-2 on
   0..1 imagery. Use ~0.3 — the ~6 you would use on 0..255 data drives the flow
   to zero, and you get a motion-vector texture that is uniformly 0.5.
2. **The pyramid must pre-warp toward the target.** Solving the residual after
   warping by `+u` pushes away from B and compounds ~2× per level; the symptom is
   flow magnitudes 8× too large on a 4-level pyramid.

### Runtime

`src/render/FlipbookFX.ts` — a Phaser Image drawn through a `SinglePipeline`
subclass. Note it is *not* a `GameObjects.Shader`: that cannot have a blend mode
(Phaser hard-codes `blendMode = -1`), and ADD is mandatory for fire.

Playback is elapsed-time driven off an injected `now()` (wire it to GameClock),
so the power governor can drop to 15fps without slowing effects down, and
`advanceTime` stays deterministic. Frame maths lives in `flipbookTiming.ts`,
Phaser-free and unit-tested.

Proof: `pnpm dev`, then `node tools/checks/fbtest.mjs` renders every sheet twice at the
same instant, with and without motion vectors.

---

## 7. Continuous emitters — `src/render/fx/`

§6 gets one sheet on screen correctly. This section is about effects that never
end: a fire that burns for the whole session, a smoke column that has to keep
being interesting while the player ignores it. Two presets ship, in
`src/data/fx-emitters.json`, and they are designed to compose — put both on one
anchor and you have a campfire.

Tune them live in **`tools/fxlab/index.html`** (needs `pnpm dev`); a save there
POSTs to `/__fxlab/presets` and writes the real `src/data/fx-emitters.json`, so
the tool and the game cannot drift. `node tools/checks/fxlabtest.mjs` is the
headless regression.

### An emitter is a stack, not a sprite

Five layer kinds, composited back-to-front by `z`, each doing a job no other
kind can do:

| kind | job |
| --- | --- |
| `decal` | static ground contact (scorch). Blend `normal` — it has to DARKEN, and ADD cannot |
| `glow` | flicker-driven light pool, squashed onto the iso ground plane |
| `sheet` | a looping motion-vector flipbook — the effect's identity |
| `particles` | discrete matter: licks, embers, sparks |
| `puffs` | pooled flipbook instances on a release timer — volumetric smoke |

`puffs` exists because **a particle has no internal motion**. Scaling a smoke
sprite up gives you a growing sprite; a flipbook puff churns while it grows,
and that is the whole difference between smoke and a balloon.

### The five things that make it read as fire

1. **Aperiodic flicker, not a sine.** `fxSignals.flicker()` sums value-noise
   octaves at 11.7 / 4.3 / 1.13 Hz — no small-integer ratio between any pair, so
   the composite has no period a player can learn. Measured: peak
   autocorrelation at any lag ≥150ms is **0.75**, and 0.61 at the fast octave's
   own period. A sum of sines would eventually realign; value noise does not.
2. **One field, sampled at offsets.** All three flame bodies read the SAME
   flicker at different phases. Identical phase is a doubled sprite; independent
   randomness is three unrelated flames. Correlated-but-different is one fire.
3. **The ground light lags by 60ms.** `glow` samples at `now - lagMs`, so the
   light peaks *after* the flame does and reads as cast by it.
4. **Three sheets, one texture.** `bodyOuter`/`bodyInner`/`bodyCore` are the
   same flipbook at three sizes, rates (26/31/37 fps) and phases — parallax and
   internal depth for zero extra VRAM. `validatePresetFile` rejects two sheet
   layers that share a phase *and* an fps, because that is a rendering mistake
   rather than a layer.
5. **Rooted, so lean is rotation.** Sheet layers anchor at their base
   (`anchor: "base"`), so `breathe` grows the flame upward and `leanDeg` bends
   it into the wind instead of sliding it sideways.

Embers and sparks are the same art with opposite physics: an ember is buoyant
(`accelerationY` positive — decelerating rise, it hangs), a spark is dense
(`gravityY` 520 — it arcs back down), and both **cool** over their life through
a monotonically darkening `color` ramp. That is enforced by a unit test.

### 2.5-D specifics

- Ground-plane layers are squashed to the iso tile ratio (`squash` ≈ 0.4–0.46;
  TILE_H/TILE_W = 0.5). A light pool that looks round is wrong.
- Emission footprints are ellipses with `spread.y ≈ spread.x / 2`, sampled
  uniformly **by area** (`sqrt` on the radius) — a naive polar sampler knots
  every emission at the centre.
- `fxWind` flattens its vertical component by the same ratio: world-horizontal
  wind foreshortens on this camera, and skipping that is what makes bolted-on
  2-D FX look bolted on.
- World emitters take `depth = DEPTHS.itemBase + screenY`, so terrain in front
  still occludes them. The always-on-top particle band is for gameplay beats,
  not for scenery that lives somewhere.

### Orchestration — `FxDirector`

Rigs do not choose their own quality; twelve braziers each "reasonably" running
a full stack is twelve times the cost, and the eleven off-screen ones pay it for
nothing. Once per frame the director culls (padded camera view), ranks the
survivors by distance from the view centre, hands the nearest `highSlots` the
full stack and the next `mediumSlots` a reduced one, then caps everything by the
power governor: **active → high, idle → medium, doze → off**.

Tiers **drop layers**; they do not dim them. A fire missing its core still looks
like fire; a fire with every layer at half opacity looks like a bug. The policy
is Phaser-free in `fxBudget.ts` and unit-tested, including that equidistant rigs
get a stable assignment (otherwise two neighbours swap tiers every frame and pop).

Wind is sampled **per rig position**, not once per scene. A gust that reaches
every emitter on the same frame is a global animation and reads as one; the
field decorrelates over `cellPx` (measured 108× more variation across the map
than between neighbours), so gusts sweep.

### `fb_flame_small` is broken — use `fb_flame`

`fb_flame_small` was baked with its art overflowing its own cell borders: **92%
border alpha, 25 of its 32 cells touching an edge**. A flipbook cell is a hard
boundary — the shader clamps half a texel inside it — so content that genuinely
belongs to the neighbour cannot be clamped away, and the sheet renders as two
half-flames side by side. It gets worse the larger you draw it, which is how it
survived unnoticed in small one-shots.

`fb_flame` has identical geometry (8×4 @ 64×128) and is clean, so the fire
preset uses it. Every other sheet in the bank is clean too:

    python3 scripts/audit-sheet-bleed.py     # exit 1 if any sheet bleeds

Run it after any re-bake.

### Placing them — the World Builder's 🔥 FX tab

Emitters are placed in `tools/worldbuilder` and land in
**`src/data/emitters.json`**, which the game bundles and `BoardScene` reads.
Presets say what a fire *is*; placements say where it stands and how *this* one
is shaped — which is what stops the preset roster growing a variant every time
a spot needs to look slightly different.

Drag a card onto a cell and it starts burning immediately, because the tab
renders the **game's own `FxEmitterRig`** on a transparent Phaser canvas locked
over the map — the same flicker field, the same shader, the same art, imported
from `/src`. Nothing in the builder re-implements an effect; a second
implementation is a second thing to drift.

Per-instance shaping (`RigInstance` in `EmitterFX.ts`, all live, no rebuild):

| control | what it does |
| --- | --- |
| `scale` | overall size of the stack |
| `widthScale` | **base emitter width** — how wide it sits on its cell |
| `heightScale` | how tall the flame or plume stands |
| `tiltDeg` | standing lean about the base; wind pushes further from there |
| `groundRotDeg` | rotates the ground-plane layers, so a scorch aligns to a wall |
| `flipX` | mirrors the stack — the cheapest way to stop neighbours reading as copies |
| `rate` | particle emission density |
| `alpha`, `ramp` | master opacity, and a recolour of every layer |
| `windInfluence` | overrides the preset's wind sensitivity for this one |
| `seed` | flicker seed — **two emitters sharing one pulse in unison** |

Three coordinate facts keep the preview honest, and getting any of them wrong
turns it from a preview into decoration:

1. Sizes are authored in GAME px (`TILE_W` 256) but the builder's tile is
   `S.tileW`, so every rig is scaled by `S.tileW / 256` — the same rebasing the
   game applies to `dx`/`dy`.
2. The overlay is a device-pixel buffer over a CSS-pixel map canvas, so screen
   coordinates are multiplied by `devicePixelRatio` going in.
3. Wind is sampled at the emitter's WORLD point, not its screen point, so the
   field decorrelates across the map exactly as it will in game.

**ADD on a transparent canvas is a trap.** Phaser's ADD is `blendFunc(ONE, ONE)`,
which sums the *alpha* channel too. Over the game's opaque canvas that is
invisible; over the builder's transparent overlay the canvas alpha is what the
browser composites with, so three overlapping flame quads drive it to 1 across
their whole bounding box and the map shows a washed rectangle. The overlay
redefines ADD as `blendFuncSeparate(ONE, ONE, ONE, ONE_MINUS_SRC_ALPHA)` —
colour still additive, alpha now saturating coverage. Overlay only; the game
keeps Phaser's own ADD.

Emitters are deliberately absent from `world.json`: they are not world art, they
ship through `/__worldbuilder/emitters`, and letting ingest see placements with
no image would break the extract scripts. They are excluded from `gameOrigin()`
for the same reason characters are — a brazier dragged north-west of everything
must not renumber the map.

Regression: `node tools/checks/wbfxtest.mjs` (needs `pnpm dev`) — it checks the
rig lands on the cell centre to the pixel, follows pan and zoom, that every
inspector control reaches the live effect, and that Apply emits GAME cells.

### Shipping

`fb_flame` and `fb_smoke_wispy` are in `SHIPPED` (`vfxBank.ts`), taking the
bank's runtime cost to ~10.8 MB of texture memory. The dist prune reads that
list directly, so it follows automatically.

Bank particle stills load under `fxb_*` keys, never `fx_*`: the bank's manifest
says its stills "replace" the game's `fx_ember`/`fx_spark`/`fx_glow`, and taking
that at face value here would restyle every merge burst in the game as a side
effect of placing a brazier. Whether to make that swap is a separate decision.

---

## 8. The aurora — the Borealis world's sky

Everything above puts *sprites* on screen. The aurora is the one effect in the
game that is none: it is hundreds of kilometres of luminous gas, semi-transparent,
with no edge and no repeat. A flipbook of it would loop visibly inside a few
seconds and cost megabytes; particles have no coherent structure at that scale.
It is a field, so it is computed as one — `src/render/fx/auroraShader.ts`.

Tune it in **`tools/auroralab/index.html`** (needs `pnpm dev`); saving POSTs to
`/__auroralab/presets` and writes the real `src/data/aurora.json`. Three presets
ship: `borealis` (the world sky), `calm` (a single quiet band) and `storm` (an
active display).

### The four things that make it read as an aurora

1. **Rays.** Electrons spiral down magnetic field lines, so emission is
   organised into near-vertical striations. The shader samples noise at a HIGH
   horizontal frequency and a very LOW vertical one, so features stretch along y
   and break up along x. Without this you have coloured fog. The headless check
   measures it: local roughness across x must exceed roughness along y
   (currently 1.16 vs 0.83).
2. **A sharp lower border and a soft top.** Emission stops abruptly where the
   electrons run out of energy and trails away upward as the air thins.
   `envelope()` is deliberately asymmetric — a symmetric blob is the clearest
   tell of a fake aurora.
3. **Colour by altitude WITHIN the curtain, not by screen height.** Ionised
   nitrogen puts a violet fringe *under* the band, oxygen green (557.7 nm)
   dominates the body, high oxygen red fades off the top. Indexing the ramp by
   the curtain's own local height means a fold carries its violet fringe around
   with it — which a screen-space gradient can never fake.
4. **Layered timescales.** A slow fold, a faster ray shimmer, and a surge of
   brightness travelling *along* the curtain. Incommensurate, for the same
   reason the fire's flicker octaves are (§7), so the sky never visibly repeats.

### Two details that decide whether it looks smooth

- **`highp`.** Large slow gradients quantise visibly at mediump, and the steps
  crawl as the field moves. The shader asks for high precision and falls back
  only if the device has none.
- **Dither.** The framebuffer is 8-bit, and a gradient this smooth across this
  many pixels crosses colour steps slowly enough to show hard contour lines. A
  sub-LSB noise dither before output turns them back into a gradient. It must be
  **at least 2/255** — below ±1 LSB it only breaks a band part of the time and
  the contours come back. A unit test enforces that, and the headless check
  measures the mean identical-value run down the gradient (3.3 px; systematic
  banding would push it into the tens).

### Performance — the part that actually mattered

The naive version runs the shader over every pixel of the band every frame: 2.0M
fragments on the game's canvas, each doing several multi-octave fBm calls. That
is a frame-rate problem on any phone. Four things fixed it, in order of payoff:

| lever | why it is free | gain |
| --- | --- | --- |
| **No transcendentals in the hash** | the textbook `fract(sin(p)*43758.5)` hash costs a `sin` per component, and the shader evaluates it hundreds of times per fragment | 8.9 → 5.6 ms |
| **Render at 1/3 resolution, blit up** | the aurora has no high-frequency detail anywhere, and the bilinear upscale actively *helps* by smoothing 8-bit steps | ~9× fewer fragments |
| **Re-render 20×/s, not 60** | it is the slowest-moving thing on screen; the BLIT still happens every frame, so the composite never stutters | 3× fewer passes |
| **2 octaves for the fold and warp** | both are whole-sky shapes; extra octaves buy detail nobody can see | ~⅓ of the remaining shader |

Measured by `node tools/checks/auroratest.mjs`, which reports a **relative**
number on purpose — absolute frame times are meaningless across machines, and
that harness's own empty 2560×1600 canvas costs ~29 ms/frame. The yardstick is a
**plain additive quad of the same size**: the irreducible cost of covering that
area with any additive layer at all.

    plain additive quad, same area  : 3.26 ms   (irreducible fill)
    aurora · high                   : 5.82 ms   = 1.79× the quad
    aurora · low                    : 4.37 ms   = 1.34× the quad
    aurora · doze (frozen)          : 3.59 ms   = 1.10× the quad
    shader pass alone               : high 2.23 ms · low 0.78 ms

So most of what the aurora costs is fill rate that no implementation could
avoid, and the shader on top is a fraction of it. `costEstimate()` in
`auroraConfig.ts` is the same budget as a pure function, unit-tested: the high
tier is under 5% of the naive cost, the low tier under 1%.

The governor closes it out. `doze` stops re-rendering entirely and the last
frame stays on screen — a still aurora in a still painting costs nothing beyond
the blit.

### Where it is mounted

**Shipped, over the Borealis world.** `BoardScene.buildWeather()` builds it from
`src/data/weather.json`; see §10.

`depth` was the only thing to get right, and the obvious answer was wrong: the
authored backdrop is drawn at `DEPTHS.tiles - 1` and covers everything the
camera can reach, so an aurora below it would never be seen. It goes at
`DEPTHS.skyFx` (9.5) — just above the painting, just below the floor, so the
isles and everything standing on them still draw over it. It sets
`scrollFactor 0` itself, because a sky must not slide when the board camera pans.

---

## 9. The snowfall — weather as a shader, not a particle system

`src/render/fx/snowShader.ts` · `SnowFX.ts` · `snowConfig.ts` · `src/data/snow.json`
· lab at `tools/snowlab/index.html` · checks in `tools/checks/snowtest.mjs` and
`tests/unit/Snow.spec.ts`.

### Why it is not an emitter

Filling a 2560×1600 sky with snow that has real depth takes ~2,200 flakes. As
sprites that is 2,200 transform writes, bounds updates and quad pushes **every
frame** — 130,000 a second — and it buys nothing, because every one of those
flakes is the same disc obeying the same law. The shader gets the entire field
for the fill cost of one screen quad and **zero CPU per flake**. The trade is
that flakes cannot collide or settle, which weather in this game never needed.

This is the opposite call from §7's emitters, and deliberately so: a brazier's
fire is a few dozen particles with individual histories at one authored place,
and particles are right for that. Weather is a field.

### One flake per cell, and never a neighbour lookup

Each depth plane is a scrolling grid: a fragment finds its cell, hashes the cell
index into a flake, and tests one distance. The usual price of that approach is a
**3×3 neighbourhood search** so flakes straddling a border are not clipped — nine
hashes per plane per fragment, which is most of the shader's cost.

This one keeps every flake *inside* its own cell instead, by clamping the centre
into a margin `validateSnowFile` proves is wide enough
(`radius*stretch + sway < 0.5`). **One tap, not nine.**

That buys speed and owes randomness, and two things pay the debt. Both were
measured, not assumed — `snowtest.mjs` autocorrelates the brightness profile of a
**single plane in isolation** (over the composite, five grids at unrelated
densities average each other out and the test would pass on an obviously latticed
field), skipping the short lags where any field of blobs correlates with itself:

- **A per-row sideways offset.** Without it flakes stand in straight columns. The
  jump at a row boundary is invisible for the same reason the single tap works:
  no flake ever spans one.
- **A smooth vertical warp of the lattice, `wave(x*0.17) + wave(x*0.061)`.**
  Between one row of cells and the next is a band no flake can reach; left alone
  those bands line up across the whole screen and the field reads as horizontal
  stripes. Measured at **0.35 autocorrelation on the exact cell period before
  this line, 0.15 at an unrelated lag after it**. A per-column *hash* would also
  break them — and would put a hard vertical seam at every column edge. A smooth
  warp breaks them with no seam, for a few percent of shear per flake.

### The five things that make it read as falling snow

1. **Parallax on every axis at once.** Near planes are larger, faster, softer,
   more elongated and blown harder; far planes are tiny, slow, crisp and nearly
   still. A unit test enforces all six gradings across every preset, because
   getting one axis right and not the others is exactly what makes 2-D weather
   look like a decal on the lens.
2. **Flutter, not fall.** A snowflake is a plate, not a pebble: it slides
   sideways as it falls and it *flashes* as it turns edge-on. Both are here, at
   per-flake phases, so no two flakes agree — and at rates deliberately
   incommensurate with each other, so no flake repeats its own little cycle.
3. **Vertical stretch.** A fast near flake is motion-blurred into a short streak.
   Round flakes at speed read as floating dots.
4. **Defocus.** The nearest plane is ~55 px across, soft and dim. It is out of
   focus, and it is the reason the field has depth rather than just scale.
5. **The shared wind.** The sideways term integrates the **same field** the fire
   and smoke emitters read (`fxWind.ts`), so the gust that leans a brazier's
   smoke leans the snow with it. `SnowFX` integrates it into a *displacement* —
   passing the instantaneous wind would make every gust a position jump.

### Two traps

- **`outTexCoord.y` is 0 at the TOP.** The sample point has to walk backwards to
  make the field fall forwards. Get the sign wrong and the snow rises, which is
  oddly hard to spot on a still frame — the check cross-correlates two frames and
  asserts the shift is downward and about the right size.
- **The scroll offset must not be wrapped.** It runs to thousands of cells, and
  wrapping shifts every cell index by one, swapping every flake for its
  neighbour in a single frame. So the shader asks for `highp` and lets it run;
  mediump loses the fractional part within a minute and the snow judders.

### Performance

Snow gets **neither** of the aurora's two cheats: a 2 px flake at 1/3 resolution
is a smudge, and falling snow re-rendered at 20 Hz strobes. So the honest
position is that the fill is one screen quad every frame — irreducible for
anything covering the screen — and the only lever is how many planes each
fragment walks. The tier pulls exactly that, dropping **whole planes**, because
three crisp depths look like snow and five faint ones look like dust.

Measured by `node tools/checks/snowtest.mjs` against a plain alpha quad of the
same area, medians of three interleaved rounds (a single pass per configuration
is not a measurement — the first run reported the snow as *cheaper* than the
quad it contains):

    plain alpha quad, full screen        : 6.36 ms   (irreducible fill)
    snow · high (5 planes, 2,265 flakes) : 10.62 ms  = 1.67× the quad
    snow · low  (3 planes)               : 7.01 ms   = 1.10× the quad

`costEstimate()` in `snowConfig.ts` is the same budget as a pure function. It
also reports `spriteUpdatesAvoided` — 136,000 a second at the shipped preset,
which is the entire case for the technique in one number.

`doze` **fades the field out** rather than freezing it. This is the one place the
snow and the aurora disagree on purpose: a still aurora is a painting, but snow
stopped in mid-air reads as a broken game.

### Where it is mounted

**Shipped, over the Borealis world**, at `DEPTHS.weather` (20000): clear of
`fogBase + screenY` so flakes pass between the player and the isles, and under
the always-on-top bands so a flake never falls in front of the piece in the
player's hand. See §10.

For flakes passing on **both** sides of a dragon, mount two instances at two
depths with `planeRange: [0, 2]` and `[2, 5]`. They share one plane budget — the
slice is taken *after* the tier cap, never before, so two instances never cost
more than one. A unit test pins that.

---

## 10. Which world gets which sky — `src/data/weather.json`

Placement is data, so giving a world weather is a JSON edit and nothing else:

```json
{ "version": 1, "worlds": {
    "borealis": { "snow": "snowfall" } } }
```

`BoardScene.buildWeather()` reads it during `create()`, keyed on
`ctx.state.worldId`. A world with no entry builds no weather objects and pays
nothing — which is every world but Borealis today. Omitting a key omits the
effect: **Borealis ships snow only.** The aurora was mounted there and then
taken back out — it competed with the snow for the same sky and read as two
effects stacked rather than as weather. Everything in §8 still stands; the
preset, the shader and `tools/auroralab` are intact and one JSON key remounts it.

Both effects are single full-screen shader quads at `scrollFactor 0`, so placing
them costs nothing and keeping them with the camera costs nothing. `scrollFactor
0` is not the whole story, though: it stops the quad SLIDING when the board pans
but not SCALING, because Phaser still applies the camera's zoom about the
viewport centre. A band sized to the canvas therefore shrank out of the corners
as soon as the player zoomed out. `SnowFX.coverCamera()` re-fits the quad to
`viewport / zoom` each time the zoom moves, and deliberately leaves `aspect` and
`resY` alone so a flake keeps its on-screen size — zooming out reveals more
snow, not smaller snow.

`onPowerState` hands the governor's state to both, and **they disagree on
purpose**: the aurora freezes on its last frame, the snow fades out. A still
aurora is a painting; snow stopped in mid-air is a broken game.

### Battery — what each governor state actually costs

Measured in the real game, in Borealis, by forcing each power state and counting
what the effects did (`board steps` is BoardScene.update calls, i.e. the render
step rate the governor is holding):

| state | fps limit | aurora re-renders | snow |
| --- | --- | --- | --- |
| active | 62 | ~17/s (asks 20) | drawn |
| idle | 30 | ~11/s (asks 15) | drawn |
| **doze** | 15 | **0/s — the shader pass stops dead** | **not drawn at all** |
| wake | 62 | back to ~17/s | back, alpha 1 |

At doze the snow fades to alpha 0 and goes `setVisible(false)`, so Phaser skips
it entirely — zero fragments. The aurora keeps its last frame on screen (that is
what "freeze" means) so it still costs ONE cached blit at 15 Hz, and nothing else.
Neither effect has a timer, a tween or an emitter: they are stepped only from
`BoardScene.update()` and can never hold the governor awake.

**`high` and `medium` deliberately share a render-target resolution.** They are
the only two tiers the governor moves between at runtime, and changing `scale`
resizes the aurora's target — a ~0.9 MB GPU texture destroyed and rebuilt.
`pointermove` is a wake source, so a drifting cursor would reallocate it every
few seconds, forever. Sharing the scale makes that transition allocate nothing;
the saving comes from the re-render rate and octave count instead. Pinned by a
unit test.

The two **labs** throttle themselves: 60 fps while you are working, 10 fps after
20 s untouched, straight back on any input (Phaser already sleeps the loop when
the tab is hidden — this covers visible-but-unattended). The headless harnesses
call `window.__keepAwake()` to opt out, because they never move a mouse.

One consequence worth knowing: the labs now boot with an fps limit, so Phaser
skips render on some rAF ticks, and a WebGL drawing buffer with no draw since the
last composite **reads back black**. Both harnesses therefore snapshot inside
Phaser's `postrender` rather than after N rAFs. Sampling on rAF reported an empty
sky over a perfectly good one.

### Reading the cost numbers

The ratio-to-a-plain-quad figures above and in §8/§9 only mean anything while the
harness is genuinely GPU-bound. Both checks now refuse to assert when they are
not — if every configuration pins at the vsync ceiling, or the baseline quad
comes out under 2 ms (dividing by it turns noise into a 5× swing), the cost
checks report `skip` with a reason instead of passing or failing on nonsense.
Before that guard this harness printed *negative* shader costs.

`tests/unit/Weather.spec.ts` cross-checks the preset names against `aurora.json`
and `snow.json`. That test exists because the failure mode is silent: the lookup
is by name, at runtime, in a world the e2e tutorial never visits, and a miss is a
no-op — so without it a rename takes a world's sky away and nobody notices.

---

## 11. Egg auras — a per-ITEM emitter

`src/data/egg-aura.json` · `src/render/fx/eggAura.ts` · the `eggAura` preset in
`fx-emitters.json` · `tests/unit/EggAura.spec.ts`.

Heavy, low-lying surface fog pooled around a dragon egg, lit in that dragon's own
colour. §7's emitters are placed at a world CELL; this one is attached to an
ITEM, so it follows the piece through merges, drags and spawn tweens on exactly
the dragon-rig lifecycle (`attachItemAura` / `syncItemAuras` / `detachItemAura`,
next to `syncDragon` in BoardScene, torn down at every site `removeDragonRig` is).

### One preset, every dragon

Five colours of one effect would be five presets drifting apart in five places
the first time anyone retuned the smoke. Instead a layer declares
`palette: "rim" | "mid" | "core" | "haze" | "ramp"` and takes its colour from the
INSTANCE, and `egg-aura.json` supplies it per egg. A layer with no `palette`
keeps its authored tint, so every existing preset is untouched.

Each palette's first three stops are **sampled from that egg's own art** — the
mean hue of its brightest saturated tenth, which is the emissive signature the
eye reads as "its colour" — so the aura and the egg can never disagree. The
validator enforces dark → bright ordering.

### Weight: what "half" means

`weight: 1` for a legendary (the `legendary` flag on the chain — Ashdrake,
Rimewyrm), `0.5` for an ordinary chain egg. `auraInstanceFor()` maps that to
`rate` and `alpha` — half the puffs and particles released, at half the opacity.
Size deliberately does NOT halve (1.00 → 0.81): a half-size aura reads as a
smaller egg rather than a lesser one.

Two engine gaps had to close for that to be true:

- **`rate` now scales puff release, not just particle frequency.** This effect is
  smoke-led, so the puff layer IS the density — a half-rate instance that only
  thinned the particles looked identical to the full one.
- **Puffs gained `squash` and are seeded on the iso ground ELLIPSE.** Surface
  smoke rendered upright reads as a column no matter how little it rises, and a
  wide low pool seeded on a line crowds its own centre.

The Golden Egg is deliberately absent: it is `altarEgg`, not a board item, with
its own tease/finale choreography and its own aura. Adding it is one entry.

### Two things that made it render nothing, then render wrong

Both were found by looking at the frame, not the config — the layers reported
themselves alive and correctly sized the whole time.

1. **Saturated tint × the grey `smoke` ramp ≈ black.** Tinting the puffs with
   `mid` multiplied the ramp down until nothing was visible. Hence the fourth
   palette stop, `haze`: smoke lit by a coloured glow is pale grey carrying a
   hue, not saturated pigment.
2. **`normal` blend painted a dark stain on the rock** — the opposite of an
   aura. The fog is lit from within, so it ADDS light. Additive plus the pale
   `haze` tint is what turns it from a smudge into a glow.

---

## 12. Graphics quality — low-tier support without touching the top

`src/core/graphics.ts` (Phaser-free model) · `graphicsState.ts` (live holder) ·
`tests/unit/Graphics.spec.ts` · the setting lives in the gear → Settings dialog.

### The contract

**`high` reproduces the engine exactly as it was.** Every number in that profile
is the value the code already used on a capable device — `dprCap 3`,
`backingCeiling 1.5`, `activeFps 62`, all effects on. A unit test pins each one
against its original source (`POWER.activeFps` and GameConfig's own caps), and a
second test proves every lever is monotonic, so a lower tier can never ask for
more work than a higher one. Low-tier support is added strictly BELOW the
existing behaviour; nothing here can cost a strong device anything.

### Why the device tier needed more than `IS_LOW_END`

`IS_LOW_END` existed but only ever tuned the canvas backing. Nothing else scaled
with the device: a four-year-old phone ran the same particle counts, the same
two full-screen weather shaders and the same live three.js crystal as a desktop.
The backing is the biggest single lever, and it is also the one the player can
least afford to lose — it costs sharpness everywhere. **Cut effects first,
resolution last.**

| lever | high | balanced | low | live? |
| --- | --- | --- | --- | --- |
| `dprCap` / `backingCeiling` | 3 / 1.5 | 2 / 1.0 | 1.5 / 0.6 | boot only |
| `fxCeiling` (emitters, aurora, snow) | high | medium | low | yes |
| `weather` (sky + snowfall) | on | on | **off** | rebuild |
| `crystal3d` (offscreen three.js) | on | on | **off** | rebuild |
| `ambient` (mote emission) | 1 | 0.6 | 0.25 | rebuild |
| `activeFps` | 62 | 62 | **30** | yes |

`fxCeiling` composes with the power governor rather than replacing it: the
effective tier is the LOWER of the two, so a Low device never runs high-tier
emitters even while the player is active (`FxDirector.setTierCeiling`,
`cappedTier`). `low` under-cuts device pixels deliberately — at
`backingCeiling 0.6` the profile ceiling wins over the device floor, which is
the whole point on hardware that cannot hold the framebuffer.

### Auto, and why an unknown device gets High

`detectTier` has two bands below high: ≤2 GB or ≤2 cores is hardware that cannot
hold the framebuffer at all, so it goes straight to Low; the existing
`IS_LOW_END` population goes to **Balanced, not Low** — they already ran the
game, and dropping them two tiers would be a downgrade of a working experience
rather than a rescue. An unrecognised device resolves to **High**: it is far
likelier to be current than a decade old, and guessing low would quietly degrade
it with no signal to the player.

The button shows what Auto picked (`Graphics: Auto (High)`) so the resolution is
never invisible.

### Applying a change

Anything create-time — weather, the crystal, ambient counts — is applied by
restarting the board rather than half-updating it, because a scene with the new
fps but the old emitter counts is in a state no profile describes. The canvas
backing is fixed when Phaser boots, so changing a tier that moves `dprCap` or
`backingCeiling` adds "Reload the page to resize the canvas" under the button;
`graphics.set()` returns whether that is the case rather than making the caller
work it out.

The choice is stored under its own localStorage key, **not in the save** —
resetting Cinder Hollow must not throw the player back to a quality their device
cannot run.
