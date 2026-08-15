# Performance audit — browser/mobile readiness

Measured 2026-08-15 against `fd3b038`. Build: `dist` 140.1 MB / 440 files.
This is the audit only; nothing here has been changed yet.

The game is not slow because it is badly written. The rate axis (PowerGovernor)
and the device-tier axis (graphics profiles, backing-resolution governor) are
both well built and better than most Phaser projects ship with. The problems are
concentrated in three places: **how much texture memory is resident**, **what
gates the title screen**, and **a handful of per-frame writes that dirty the
whole display list**.

---

## Measurements

| | today |
|---|---|
| Deploy payload | 140.1 MB, 440 files |
| Dragon/character clip atlases | 55 files, 108.7 MB (78 % of the build) |
| **Decoded RGBA if all clips resident** | **1,659 MB** |
| Decoded for 4 breeds, baby+adult idle only | 342 MB |
| JS bundle | 2.44 MB raw → 646 KB gzip → 517 KB brotli, **one chunk** |
| Bundled JSON parsed at boot | 652 KB (`zones.json` 192 KB alone) |
| **Bytes before the Play button appears** | **~22.2 MB** |
| Bytes after Play, before playable | 0 (dragon clips arrive mid-gameplay) |

Atlas geometry: grid spritesheets, no per-clip JSON, metadata in
`src/data/character-anims.json`. Frame *cells* are small (141×226 … 455×360);
frame *counts* are the cost — idles run 98–194 frames, flys 85–**240**, all at
24 fps. `ashglass_adult/fly` is 10.0 s of animation in one 4096×2655 texture.
Several sheets declare fewer frames than their grid holds; the padding cells
still cost full RGBA.

Oversampling: median **2.17× linear** (≈4.7× pixel waste) on a 390 pt/DPR3
phone. `emerald_baby/idle` stores 270×235 cells that land on ~99 device px.

Reduction headroom, no visible loss at phone sizes:

```
today                          109 MB webp / 1659 MB decoded
half-res                        27 MB      /  415 MB
half-res + frame count ≤48       12 MB      /  197 MB     ← 9× disk, 8× VRAM
```

`scripts/shrink-dist.py` deliberately never resizes (three runtime mechanisms
read a texture's natural pixel size), and its own comment block already names
the right lever: *"idle-clip fps decimation — idles are by far the largest
sheets."*

---

## Findings, ranked

### 1. Dragon clip textures are never evicted, and there is no cap
`BoardScene.clipsFetched` (`BoardScene.ts:323`) is a `Set` that only ever grows —
never cleared on `SHUTDOWN` (`:501`), on `scene.restart()`, on merge-up, on sell,
or on world travel. `worldArtKeys()` (`worldArt.ts:22-53`) excludes dragon clips
by construction, and its comment at `:32` — *"they ride the boot preload"* — has
been false since `687be7b`.

`687be7b` ("the dragon clip sheets stop costing a gigabyte at boot") moved *when*
the memory is paid, not *whether* it is ever handed back. Its own commit body
measured 1553 MB → 526 MB at boot. A long session that merges through
frost → storm → emerald → moonwhisker walks straight back toward the original
figure, one breed at a time, at 40–130 MB per breed. This is what kills the tab
on iOS.

### 2. The boot prefetch added by that same fix is a permanent no-op
`PreloadScene.ts:184` reads `ctx.state.items`, but `ctx.beginRun()` — the only
thing that populates it — runs at `UIScene.ts:417`, two scenes later. The set is
empty on every boot, new game or returning save. **Every** breed is therefore
fetched mid-gameplay by `ensureDragonClips`, during the board-restore pass, with
the game already running: a 3–5 MB fetch plus a 40–130 MB GPU upload as a frame
stall the player sees.

### 3. 19.4 MB gates a title screen that needs none of it
`TitleScene` loads zero assets and draws one `Graphics` circle. It is started
from `PreloadScene.create()` (`:244`), which Phaser will not call until the whole
19.4 MB loader queue drains. The title art is two DOM `<img>`s already present in
`index.html:87-88` — and those two fetches *compete* with the Phaser queue for
connections, so on a slow phone the title art itself arrives late.

### 4. Crystal3D runs a second WebGL context on the low-end Android band
`Crystal3D` (`src/render/Crystal3D.ts:57`) creates a second `WebGLRenderer` with
`antialias: true` **and** `preserveDrawingBuffer: true` — the two most expensive
flags available — at 803×902, then does a GPU→CPU readback (`drawImage` of a
WebGL canvas) plus a full CPU→GPU re-upload (`crystalTex.refresh()`) every 33 ms.
That is **~87 MB/s of bus traffic for one decorative board item.**

It is correctly excluded on iOS (`BoardScene.ts:3315`) and on the `low` profile
(`graphics.ts:100`). The gap is that `detectTier` (`graphics.ts:126`) only
returns `low` at ≤2 GB RAM or ≤2 cores; the entire `IS_LOW_END` population
(≤4 GB, ≤4 cores) resolves to `balanced`, which has `crystal3d: true` and
`activeFps: 62`. **Cheap Android gets the full second context at 60 Hz.**

### 5. Unconditional per-frame `setDepth` re-sorts the whole display list
Phaser 3.90's `Depth.js:56` calls `queueDepthSort()` on every depth write with no
equality guard, and `DisplayList.depthSort()` then `StableSort`s the entire
BoardScene child list — one image per playable cell (42 on `map.json`, up to 254
on the largest zone) plus fog, shadows, decor, badges and item containers.

Four sites write depth every frame on objects that have not moved:
- `BoardScene.ts:984-993` — three writes per live dragon (shadow, zzz, clipOverlay)
- `BoardScene.ts:1123` — one per egg aura
- `EmitterFX.ts:234-241` — that single aura write fans out to every layer object
  and up to 42 puff slots

Net: **one live dragon or one egg on the board re-sorts the whole scene every
frame, forever.** A value guard on each site fixes it.

### 6. Infinite tweens, none paused by the power governor
34 `repeat: -1` sites. The worst is `createFogSprite` (`BoardScene.ts:3963`):
one 3-property yoyo tween **per fogged tile** — 26 on `map.json`, more in bigger
worlds — permanently running, never culled. Plus ambient wisps, the golden egg
idle stack, the golden tremble (a 90 ms tween re-firing every 1.4 s forever), and
a 💤 tween per sleeping dragon.

`Hud.ts:159` is the only site in the codebase that pauses an invisible infinite
tween, and its comment states the rule exactly: *"an invisible infinite tween
still ticks every frame (battery)."* `foil.ts:171` repeats it. Nothing in
BoardScene follows it, and nothing anywhere subscribes a tween pause to
`POWER_STATE_EVENT`.

### 7. Egg auras install ~42 scene UPDATE listeners each
`fx-emitters.json` `eggAura` declares `smokeSkirt` pool 16 + `surfaceSmoke` pool
26 = 42 puff slots, and **every `FlipbookFX` registers its own scene UPDATE
listener** (`FlipbookFX.ts:125`). Three eggs on the board ≈ **126 extra per-frame
listeners**, plus 6 from `fire` and 22 from the two `smokeEmbers` placements.
Slots are correctly pooled rather than destroyed, but a paused slot's listener
still fires; the `step()` early-out is the only thing saving it.

### 8. three.js is statically bundled for devices that never run it
`grep -rn "import(" src/` returns **zero results** — there is not one dynamic
import in the codebase. `Crystal3D.ts:1` does `import * as THREE from 'three'`,
reached statically from `main.ts`. iOS and every `low`-tier device download and
parse ~600 KB of three.js they are guaranteed never to execute. The runtime
branch points (`BoardScene.ts:3313`, `:3318`) already exist.

`vite.config.ts:1226-1232` has no `rollupOptions` and no `manualChunks`, so
everything is one 2.44 MB chunk. `Phaser.AUTO` also forces both the WebGL *and*
Canvas renderers into the bundle.

### 9. No cache headers on 108.7 MB of immutable content
`vercel.json` has four keys and none is `headers`. No `_headers`, no middleware.
The dragon atlases sit at stable, unfingerprinted paths under `dist/sprites/` —
perfectly cacheable content with no cache policy, falling through to Vercel's
static default. No service worker, no `<link rel=preload/prefetch/modulepreload>`
anywhere, no `fetchpriority` on the two title images.

### 10. `syncSpriteInk` per standee and per live dragon, every frame
`SpriteInk.ts:132` builds a dress key with `.toFixed(2)` — a string allocation
per object per frame even when nothing changed. Driven for standees by an **0.8 %**
scale wobble (`STANDEE_BREATH.amount = 0.008`, `Constants.ts:895`) at
`BoardScene.ts:666`, and per dragon at `:1015`. `syncDragon` is called *before*
the busy/asleep guards (`:1023-1028`), so even a sleeping, off-screen or
mid-animation dragon pays the full transform + ink cost. `updateLiveDragons` has
no camera-view test and no power-state test.

### 11. `FxDirector.update` allocates ~5 objects per rig per frame
Despite the comment *"Scratch, reused every frame so the update loop allocates
nothing"* (`FxDirector.ts:60`): `rig.position` (`EmitterFX.ts:280`) returns a new
`{x,y}` and is called twice, the `targets.push({...})` literal is new, and
`sampleWind` (`fxWind.ts:93`) returns a fresh 4-field object. `assignTiers`
(`fxBudget.ts:57-81`) additionally allocates two arrays plus one object per
visible rig and runs a comparator **sort** every frame.

### 12. `setText` on a 240 ms tick with no dirty check
The tick is 240 ms; the displayed resolution is 1 s — so **~3 of every 4 writes
are redundant**, and each re-rasterises and re-uploads a canvas texture.
Sites: `BoardScene.ts:728` (every rest badge), `:5408` (floating dragon
countdown, plus a `label.width` metrics recompute), `:5252-5255` (two per tick
while a skip button is open), `BoardItem.ts:527` (every cooling generator),
`Hud.ts:430` (2 Hz regen label).

### 13. `applyBob` sweeps the whole item list every frame to do nothing
`BoardScene.ts:659` iterates `itemSprites` and calls `applyBob`, which
`BoardItem.ts:414` documents as a no-op for ordinary items — *"Kept as a no-op so
the per-frame caller… stay intact."* Full Map iteration plus a megamorphic call
per item per frame.

### 14. The 2.1 MB MP3 fires on the Play tap
`AudioManager.loadMusic` (`:81`) is triggered by `unlock()` on the first
`pointerdown` anywhere (`main.ts:93`). On a cold load that is the Play tap — so a
2.1 MB fetch plus a full-track `decodeAudioData` lands in parallel with
`BoardScene.create()`, the board build, `beginRun()`, and the first
`ensureDragonClips` burst. The worst possible instant. (All SFX are WebAudio-
synthesised with zero asset files — that part is exemplary.)

### 15. Ambient emitters simulate world-wide, not view-wide
`BoardScene.ts:4014-4020` sets emit zones spanning the whole world rect. With
`EMBER_MOTES.lifespanMs = 9000` that is ~21 particles from one emitter and ~10
from another, most off-screen at any zoom, plus ~21 fireflies each running a
per-particle `Math.sin` closure every frame (`:4069`) in `ADD` blend. The power
governor only turns these off at **doze** (`:554-556`) — at `idle` they run full
rate.

### 16. `pnpm audit:art` has been dead
`scripts/audit-art.mjs:46` reads `src/render/characterCatalog.ts`; that file is
now `src/render/sequenceCatalog.ts`, so the script throws before auditing
anything. The guard against shipping unreferenced art has not run in a while —
consistent with `dist/raw/screamingbrain/*.png` and a 32 KB `CREDITS.md` shipping.
One-line fix.

### 17. The 1.7 s twinkle timer allocates in doze
`BoardScene.ts:2359` — `delay: 1700, loop: true`, and each fire creates an Image
plus a tween and destroys them. Not gated by the power governor.

### 18. Smaller notes
- `transparent: true` (`GameConfig.ts:76`) — a non-opaque WebGL context disables
  some compositor fast paths on mobile.
- `base: './'` in `vite.config.ts:1198` but absolute `/sprites/...` in
  `index.html:87-88` — works only at domain root.
- `shrink-dist.py` rewrites `.png` files with WebP bytes and keeps the `.png`
  extension (`fb_dustburst_mv.png`: 295,698 → 80,740 B). It works by browser
  sniffing, but it is fragile.
- 652 KB of JSON is bundled into the JS chunk and parsed at boot.
- `pointermove` is a governor wake source (`PowerGovernor.ts:38`), so any stray
  touch-drag resets a full 10 s active hold.

### Corrections to earlier assumptions
- The build gate is **not** failing. `--budget` defaults to **143.0**
  (`shrink-dist.py:319`); `shrink-dist.py` exits 0 at 140.1 MB. The 108 figure
  appears only in a stale comment above it.
- There is **no rig/skeletal system** any more — `RigPlayer.ts`,
  `rigAnimations.ts` and `faceAnimations.ts` were deleted in `fd3b038`. Dragons
  are spritesheet clips only. `CLAUDE.md`'s "Phaser gotchas" section still
  describes the rig pipeline and needs updating.

---

## Fix order

Grouped by payoff per unit of risk. Board: EMB-187 … EMB-191.

**Tier 1 — memory and boot, the ship-blockers**

1. ✅ **Done (EMB-187).** Evict dragon clips: LRU + byte budget keyed off device
   tier (`src/core/clipResidency.ts`, `clipBudgetMb` on the graphics profiles),
   swept on load complete and debounced on `item:removed`. Never evicts a breed
   the board is wearing. `clipsFetched`/`clipLastUsed` cleared on `SHUTDOWN`.
2. ✅ **Done (EMB-187).** The boot prefetch now reads the save directly
   (`savedDragonClips(save.peek(), WORLD_ID)`), for the world the save resumes
   in — instead of an `ctx.state.items` that is always empty at that point.
3. ✅ **Done (EMB-187).** `TitleScene` launches immediately; the board art
   downloads behind it and Play waits on `BOARD_ART_READY` under the fade.
4. **EMB-188 (destructive, not started).** Re-encode the clip atlases: cap
   idle/fly frame counts and halve cell dimensions for a mobile variant. Needs
   an `lod` field in `character-anims.json` — no such concept exists today.
   9× disk, 8× VRAM.

**Tier 2 — frame time (EMB-189)**

5. Value-guard the four unconditional `setDepth` sites (finding 5). Cheapest
   real win in the codebase.
6. Widen the `low` tier, or move `crystal3d` off `balanced` (finding 4).
7. Pause infinite tweens on `POWER_STATE_EVENT` and on visibility; cull the fog
   pulse to on-screen tiles (finding 6).
8. Guard `syncDragon`/`syncSpriteInk` behind a dirty check and a camera-view
   test; move it after the busy/asleep guards (finding 10).
9. Dirty-check every timer `setText` (finding 12).
10. Drop the no-op `applyBob` sweep (finding 13).

**Tier 3 — delivery (EMB-190)**

11. `Cache-Control: immutable` on `/sprites/*`, `/vfx-bank/*`,
    `/background-music/*` in `vercel.json` (finding 9).
12. Dynamic-import three.js behind the existing runtime branch; add
    `manualChunks` to split vendor from game code (finding 8).
13. Defer the music fetch past `BoardScene.create()` (finding 14).
14. Fix `audit-art.mjs`'s path and re-run it (finding 16).

**Tier 4 — cleanup (EMB-191)**

15. Findings 7, 11, 15, 17, 18.

---

## The asset waves

`src/core/assetWaves.ts`. The loader used to be one list, gated behind Play. It
is now three waves, derived from the map, the save and the tutorial script — not
hand-listed, so a re-exported world or a re-authored tutorial moves the boundary
automatically.

| wave | what | when |
|---|---|---|
| **boot** | terrain, live backdrop, UI chrome, `fx_`, and item art for chains the opening can reach | gates Play |
| **play** | everything else with a texture | streams behind the running board, 6 files per 220 ms |
| **ondemand** | `trailer_`, `ui_teaser_`, `ui_levelup_emblem` | `ensureTextures`, when the screen opens |

The boot set is small because a merge game's need curve is: `map.json`
`startingItems` is a **single** `crystal:1`, and 112 of the 116 item textures
cannot be on the board when it opens. Boot item art is the union of the saved
board's chains, the map's seed, and — only while the tutorial is still running —
the 14 of 43 chains its 65 steps name.

```
boot images   14.19 MB  →   3.38 MB   (73 files)
play images        —        10.81 MB  (115 files, streamed)
```

Plus spritesheets: Eleanor's `idle` boots, her `talking`/`blinking`/`cast`/
`laugh`/`happy` stream (they degrade to the static `char_<id>` until they land).

Two properties make the small gate safe. Nothing in the `play` wave is
load-bearing — absent art falls back to its generated placeholder and is
re-dressed on arrival — and the wave is **batched**, because the cost is the
texture *upload*, not the download; six at a time spreads those over the board's
first seconds instead of landing 190 in one hitch.

`waveFor` defaults unknown keys to `play`, never `ondemand`: a new art category
should degrade to "streams late", not to "silently missing". Only
`isLazyScreenArt` promotes to `ondemand`, because that class carries an
obligation — a matching `ensureTextures` call — that cannot be inferred.

## What Tier 1 changed

`docs/PERF-AUDIT.md` is the audit; this is the delta, so the numbers above stay
readable as the BEFORE picture.

- **Bytes before the Play button appears: ~22.2 MB → the JS bundle alone.** The
  board art still downloads, but behind the title rather than in front of it.
- **Dragon clips now have a ceiling.** Before, a session's resident clip total
  only ever went up; it is now bounded by `clipBudgetMb` (640/320/160 by tier)
  with the breeds on screen exempt.
- **The saved board's breeds arrive before the board does**, instead of as a
  40–130 MB upload during the restore pass.

Unchanged: `dist` is still 135.5 MB and a single breed still costs 40–130 MB
decoded. That is EMB-188's job, and it is where the remaining 8× lives.

## Why item art is not resized

`item_*` is 7.09 MB and would be **0.47 MB stored at drawn size** — 112 of the
116 textures are drawn at under half their stored width, and `ITEM_SCALE`
`ember_dragon_2: 0.064` on a 1236×1511 source is a ~15× linear oversample. It is
the biggest single win left in the build, and it is **not** safe to take blind.

`shrink-dist.py` already refuses to resize because three runtime mechanisms read
a texture's natural size. Item art has a fourth, worse one: roughly fifteen draw
sites scale item textures with a **hand-tuned literal** rather than through
`ITEM_SCALE` — `LedgerPanel.ts:318` `.setScale(0.72)`, `BoardScene.ts:5328`
`.setScale(0.1)`, `UIScene.ts:878`, `DragonCodexPanel`, `BagPanel`,
`CommissionPanel`, `QuestTracker`. A build-time resize with an exact
compensation factor fixes every `ITEM_SCALE` path and silently breaks all of
those, across 119 items, in ways only a person looking at the screen can catch.

The fix is to make render size independent of texture size (`setDisplaySize`, or
the `lod` field EMB-188 needs anyway) *before* resizing anything. Until then the
dimension-safe lever is re-encoding, which is what the `REQUANT_MIN_KB` 60 → 6
change takes: 100 of the 169 early-wave textures were under the old floor and
were never touched at all.
