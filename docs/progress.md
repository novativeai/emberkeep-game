# Progress log

## 2026-06-13 — Production push, phase 1: narrator + reward loop + map ingest

Toward the production-ready first 3 levels and an addictive first 5 minutes.

- **Laurah, the Dragon Master** is now the guide/narrator. Her provided portrait
  (`assets/sprites/guide-characters/laurah-dragonMaster/…bubble-icon.png`, 412²)
  is wired as a `source:"file"` asset; CharacterBubble gained a `laurah` speaker
  (gold name-tag) and normalises any portrait to a consistent disc size, so the
  real-art icon and the generated discs match. The whole tutorial is rewritten
  in her voice with the Emberkeep lore (Great Flame, sleeping dragons, the
  ember of hope) — same step IDs/gates, so the e2e is untouched. Verified she
  renders with her name tag in the welcome beat.
- **Leveling now PAYS** (fixes audit hole #1). New `keeper:leveled` event
  (EconomySystem fires one per level crossed); `RewardSystem` grants a **full
  Warmth refill + scaling Gold**; UIScene shows a **celebration banner + spark
  burst**, AudioManager plays a rising **level-up arpeggio**. 3 new unit tests
  (RewardSystem.spec) cover the grant, multi-level jumps, and the no-loop guard.
- **Map ingest foundation**: `scripts/ingest-world.mjs` converts the authored
  `assets/map/level-1-3.json` (1102 placements) → `src/data/world-map.json` —
  a normalised 41×20 game map with the **89-cell level-1 clearing**, **285
  level-2 fog cells**, **49 level-3 fog cells** (cells under both clouds gate at
  the lower level), plus per-asset calibration for placing the real tile art.

`pnpm verify` green: typecheck, **39 unit tests**, build, full-tutorial e2e.

**Phase 2 (next, the big lift):** the authored map is far larger than the
current fixed 8×8 frame, so it needs a **camera** (start framed on the level-1
clearing, pan/follow), a **large-board renderer** that lays the 422 real
border-grass tiles by the ingested calibration, and **per-level fog gating**
that clears `level_N` clouds when the Keeper reaches level N. That's a focused
follow-up pass (it rewrites BoardScene's ground/fog build and the tutorial's
cell references), kept separate so the verified core stays green.

## 2026-06-12 (later) — Visual overhaul toward the Fairyland reference

Side-by-side against `asset-reference/fairyland-*.png` drove five changes:

1. **2× render resolution** — canvas now 2560×1600 (`RES` in Constants),
   FIT-scaled; TextureFactory paints logical units ×RES; every UI literal and
   font doubled. e2e CSS coordinates were unaffected (uniform scale), but
   headless SwiftShader couldn't push 4MP — Playwright now launches Chromium
   with the real GPU (`--enable-gpu --use-angle=metal`), e2e went 4.4min → 28s.
2. **Organic isle** — map.json regions no longer cover all 64 tiles; uncovered
   tiles are void sky. Cliffs are edge-detected per tile (with crack/no-crack
   variants) instead of hardcoded to the last row/col.
3. **Fog = cloud blanket** — single-tile cauliflower caps, uniform scale,
   grid-aligned with flips for variety and a rolling breath phased by iso row
   (the old random-scaled balloon clusters were the main "looks bad" culprit).
4. **Decorative world** — bottom cloud sea (two parallax rows), three satellite
   isles built from the same tile/cliff language (one carries a new brazier
   landmark), distant silhouette isles, sun haze, sky twinkles.
5. **Track B begins** — Screaming Brain Studios CC0 Isometric Overworld Pack
   downloaded to `assets/raw/screamingbrain/`; two stone tiles wired as the
   unrestored ash ground via assets.json (first real `source:"file"` assets
   through PreloadScene). Their PNGs are magenta-keyed without alpha — de-keyed
   to RGBA during ingest. Bright moss stays generated (closer to the reference
   than the pack's muted earth tones).

`pnpm verify` green: typecheck, 27 unit tests, build, full-tutorial e2e.

## 2026-06-12 (third pass) — Cloud-field world (feedback round)

User feedback rejected the grey fog, the isle-in-empty-sky framing and the
floating mini-isle "blocks". Rework:

- **Clouds are WHITE now** (near-white tops, cool grey-blue shading) —
  matching the reference; "ash-fog" remains lore, not a literal grey tint.
- **The whole viewport is a cloud blanket**: `buildCloudField()` lays ~300
  cloud caps on the same iso grid across (and beyond) the entire screen —
  the world visibly continues off-camera in every direction, especially
  north. The playable isle is a clearing carved out of the blanket; board
  fog and field share textures and the y-ordered `fogBase + y` depth band,
  so the banks merge seamlessly.
- **Mini-isles replaced by embedded clearings**: full-scale tile patches
  (with edge cliffs) sunk INTO the blanket at field depth — a mossy nest
  clearing, the brazier clearing, a sprout clearing — plus open-sky windows
  with distant-isle silhouettes. No more scaled-down floating cubes.
- DEPTHS.dragged/particles/flash raised above the field band (max ~3100).
- The screen-space "cloud sea" rows, bobbing satellite isles and floating
  rocks were removed (superseded).

`pnpm verify` green again: typecheck, 27 unit, build, e2e 28s.

## 2026-06-12 (fourth pass) — World framing per feedback

- **South front is open**: the `south_rim` locked region was removed from
  map.json entirely — the isle's southern border is the active area's cliff
  edge, fully visible against open sky. No clouds south of the world's
  ragged midline.
- **North continues for real**: a decorative ash-ground plane (Screaming
  Brain stone tiles) extends off-camera beneath the white blanket, so the
  map visibly keeps going past the camera; cloud caps overhang the ground
  edge by one row to hide the seam.
- Removed: the brazier/pillar clearing (and all clearings), and the grey
  contact-shadow oval baked under each cloud puff.
- Sky windows now punch through both clouds AND ground (open sky + distant
  isle silhouettes); two more far isles drift in the southern sky.

`pnpm verify` exit 0: typecheck, 27 unit tests, build, e2e 28s.

## 2026-06-12 (fifth pass) — Northern land + hero dragon art

- **The map now truly continues north**: ash ground tiles render procedurally
  beneath the cloud blanket (peeking through inter-cap gaps), with generous
  cull margins so screen edges can never expose seams. The front cloud row
  carries no ground, so its overhang hides the land's edge. Cloud caps were
  also rebuilt to fit a single tile and share the items' y-ordered depth —
  no more neighbour-tile bleed or clouds covering items in front of them;
  the baked bottom-oval and the translucent far-isle diamonds are gone.
- **First hero art is in**: `assets/sprites/characters/dragon/full-sprite/`
  (project-owner provided). The source PNG was 98.5% transparent padding —
  ingest trims to content (197×253 of 1387²) and emits a 187×240 board
  derivative, wired via assets.json as Ember Hatchling AND Whelp (interim,
  until the separated animation pieces — blink, wing flaps — arrive).
  Anchored feet-down at [0.5, 0.95]; cooldown tint + ready sparkle work on
  the real art unchanged.

`pnpm verify` exit 0: typecheck, 27 unit, build, e2e 27s.

## 2026-06-12 (sixth pass) — Character rigging app

Built `tools/rigger/index.html` (single-file, zero-dependency browser app) to
rig the separated dragon pieces that landed in
`assets/sprites/characters/dragon/red-dragon/` (8 pieces, 666², content
centred per piece — alignment is manual by design):

- Layer upload with auto part-naming from filenames (`leftWing` → `wing_left`,
  `bodyTail` → `body_tail`), same-size pieces auto-stack for alignment.
- Right sidebar = z-order (drag rows to reorder, top = front), visibility,
  per-layer canonical part-name dropdown.
- Move tool: alpha-aware drag alignment in the preview (wheel zoom, alt-pan).
- Anchor tool: select PARENT then CHILD, drag to place the rotation pivot;
  ▶ button wiggle-tests the child subtree around the pivot.
- Puppet tool: in-layer deform pins; chain + order parsed from names
  (`pin_tail_02` → chain "tail", order 2).
- Naming is a LOCKED contract (LAYER_PARTS / ANCHOR_NAMES / PIN_NAMES) so the
  game's animation code can key off exact names; `root_ground` required.
- Export rig.json: layers + z, anchors in rig/parent-local/child-local space
  with Phaser-ready `childOriginNorm`, pin chains, root, embedded PNGs.
  Save/Load project round-trips everything.
- Validated end-to-end with Playwright on the real pieces (export parsed and
  contract-checked; zero console errors).

Hatchling/whelp manifest reverted to placeholder (the assembled full sprite
was replaced by the pieces); the rig assembly will restore + animate it.

## 2026-06-12 (seventh pass) — World builder app + real tile set

Built `tools/worldbuilder/index.html` (single-file, zero-dep): infinite
isometric canvas matching the game projection (TILE_W×TILE_H 2:1, pan + wheel
zoom + Fit + grid), right-sidebar asset library with **tile / decor category
tabs**, Paint/Select/Erase tools, decor stacking (many per cell), and a
**Calibration panel** (offsetX/offsetY/scale/anchorX/anchorY sliders) that
edits the selected asset and live-previews every instance. Defaults: tiles
anchor 0.5/0.5 (centred), decor anchor 0.5/0 (top-centred, per spec). Export
world.json = tile size, bounds, per-asset calibration table, placements
(asset/category/col/row/z), embedded PNGs. Validated end-to-end with
Playwright (paint, stack, calibrate, export — zero console errors).

**Real tile set arrived**: `assets/sprites/environment/map/border-grass/` —
16 Fairyland-style grass-top island blocks with stone cliff sides (4×4 slice,
+ manifest.json + preview.png). Measured:
- Two heights — TALL edge blocks 1-8 (~241×261, deep cliff) and SHORT blocks
  9-16 (~241×187, shallow rim). Grass-top variety: plain / tufts / flowers.
- Grass top is a clean 2:1 iso diamond, ~240 wide × ~122 tall (measured ratio
  1.97). Native tile ≈ 240×120; the game grid is 256×128, so they need
  scale ≈ 1.067 (or set the builder grid to 240×120 to tessellate natively).
- They're TOP-anchored (grass diamond at the canvas top, cliff hanging below);
  the tile-centre registration sits at anchorY ≈ 0.238 (tall) / 0.299 (short)
  — exactly the per-PNG calibration the world builder exists to dial in.

## 2026-06-12 (ninth pass) — Mirroring + optimal in-game rig runtime

- Animator gained a ↔ Face toggle: mirroring is a single horizontal flip
  about the root, so left-facing art ↔ right-facing with no name-swapping or
  angle math. Verified both directions render and keep animating.
- Production runtime: `src/render/rigTypes.ts` + `rigAnimations.ts` (pure,
  Phaser-free, the adaptive anchor→pin→layer→skip resolution + the 5 presets)
  + `RigPlayer.ts` (Phaser). RigPlayer builds the rig once as outer(placement/
  facing)→inner(anim root)→flat z-ordered layer Images with resolved-pivot
  origins; per frame it writes only `.rotation` + container transforms (no
  allocation). `setFacing` mirrors via `scaleX=-1`; `bake()` flattens to one
  texture for cheap board reuse.
- 9 unit tests (RigAnimation.spec) prove the adaptation: anchor/pin/bare/skip
  resolution, iso near-vs-far amplitude, missing-jaw→head-tilt, bounded poses.
- Wired live on the TitleScene (lazy fetch + graceful egg fallback): the
  red dragon idles on the isle in-engine. `pnpm verify` green — 36 tests,
  build, full e2e (Play still transitions, zero console errors).

## 2026-06-12 (eighth pass) — Tile preset + cloud level-blockers

- World builder preset to the real set: grid → 240×120, all 16 border-grass
  blocks auto-load with per-tile measured anchorY.
- Level-blocker cloud: `level-blocker/cloud/cloud-non-cropped.png` (1536×1024,
  ~66% empty) cropped to content → `cloud-cropped.png` (882×599 master) →
  normalised to one tile wide → `cloud-tile.png` (256×174; widest belt 250px
  ≈ 0.98 tile, base anchor 0.5/0.49, presets to 0.5/0.62 to sit high).
- World builder gained a third **Blockers** category. The cloud auto-loads
  there. A toolbar **Level** stepper stamps each placed cloud with a level;
  on-canvas badges are colour-coded per level, and a selected cloud's level
  is editable in the inspector. Export now carries `placements[].level` plus
  a `levels` map (per level: count + the exact cells covered) — the contract
  the game uses to decide which cells unfog when a level unlocks. Validated
  end-to-end with Playwright (place L1/L2 groups, re-tag to L3, export) —
  zero console errors.

## 2026-06-12 — Level 1 “Cinder Hollow” built end-to-end (initial run)

**Shipped:** full Level-1 vertical slice on the production architecture.
Typecheck (TS strict) + 28 unit tests + production build + full-tutorial
Playwright e2e all green in one `pnpm verify` run; 13 milestone screenshots
inspected by eye.

- Core: typed synchronous EventBus, GameState (single source of truth, save
  hydration), virtual GameClock (`advanceTime`-aware timers), Context
  composition root; every tunable in Constants.ts or `src/data/*.json`.
- Systems (all Phaser-free, bus-only): Merge (flood-fill 3-merge, 5-merge→2
  config flag, drop validation), Board, Energy (anchored regen + offline
  catch-up), Generator (cooldowns, adjacency spawn), Order, Economy (coins/
  keys/XP/levels/sell), Unlock (fog regions), Save (versioned localStorage,
  autosave on every mutation), TutorialDirector (12 data-driven steps, tap/
  event/count gates, dynamic `last_hatched` markers, input allow-lists).
- Presentation: Boot/Preload/Title/Board/UI scenes; pooled BoardItems with
  idle bob + cooldown tint + ready sparkle; merge gather/burst, hatch ceremony
  (shake → shell crack flash → spark confetti → pop), harvest hop, fog-lift
  with warm-light flood and ash→moss tile bloom; ember motes; Fairyland-style
  HUD, tooltip with sell, Cindra’s Ledger panel, speech bubble + guiding hand
  + bouncing arrow; reset-confirm dialog.
- Art Track A: ~40 textures painted at runtime by TextureFactory (Canvas2D)
  in the Emberkeep palette with soft pseudo-3D shading; assets.json/anchors.json
  manifest so real PNGs swap in with zero code changes (loader falls back to
  placeholders on error).
- Audio: WebAudio-synth SFX (merge pop, hatch chime, harvest tick, fanfare,
  fog whoosh, denies, clicks) + quiet ambient pad with ember crackles; unlocks
  on first pointer event; pure bus subscriber.
- Instrumentation: `render_game_to_text`, `advanceTime`, `gridToPage`.

**Bugs found & fixed during the verification loop (all via e2e + screenshots):**
1. Phaser container hit areas are tested against `local + displayOrigin` —
   custom rects were offset half a frame; drags grabbed the wrong items.
   Fixed with origin-shifted, footprint-sized rects (≤1 iso row tall so items
   never mask the tile behind them).
2. Pooled sprites came back input-dead (`disableInteractive` on release but
   `setInteractive` only on first construction). Release now keeps the input
   component (invisible objects are skipped by hit tests anyway).
3. Fog puffs were interactive across their whole 190×140 frame and stole
   input from active tiles one row south — replaced with an exact tile-diamond
   polygon hit area.
4. Stacking `scalePulse` on top of `popIn` left revealed items at scale 0.05
   (the longer tween wins the final property write). Spawn pops never stack
   scale tweens now.
5. Energy unit test was flaky against wall-clock drift — frozen with fake
   timers so the virtual clock is the only mover.

**Next up (Level 2 candidates):** see README “What I’d build next” /
final report — isle graph + camera, order queues with timers, dragon homes
(passive generation + collection).

---

## Production push II — narrator, reward juice, world data, XP pacing, live dragon (2026-06-16)

Shipped and verified (`pnpm verify` green: typecheck → 39 unit → build → e2e):

- **Laurah narrator** (earlier this push): all tutorial copy + portrait in her
  voice (`portrait_laurah`, speaker type extended).
- **Level-up reward juice** (earlier): `keeper:leveled` → full Warmth refill +
  scaling Gold + gold banner + rising-arpeggio SFX (`RewardSystem`, audited
  hole #1).
- **Authored world ingested** → `src/data/world-map.json` from
  `assets/map/dragon-land.world-2.json` (513 playable tiles). `scripts/ingest-world.mjs`
  now emits **per-level play zones** (no-cloud = L1: 91 tiles; L2 +285; L3 +101;
  L4 +36) and carries the **camera keyframes** (focal cell + world + zoom for
  L1–L3).
- **XP pacing** retuned to a researched quadratic `LEVEL_XP = [0,25,75,150,260,410,610]`
  (gaps 25/50/75/110/150/200) so the first level-up fires inside the tutorial.
  **Orders now grant XP** (the missing core-loop pacing lever) — Cindra's brazier
  gives +20. Rationale + genre research in `docs/research/xp-pacing.md`.
- **Live rigged dragon on the board**: the hatchling/whelp is now the red rig,
  **mirrored to face RIGHT**, entering mid-**celebration** then alternating
  idle/celebrate (~90% idle) via `BoardScene` (`DRAGON_ANIM` tunables). The rig
  overlays an invisible-but-interactive host (`BoardItem.setArtVisible` — NOT
  `setAlpha(0)`, which clears the render flag and kills hit-testing).

**Still PENDING (the big PHASE 2 integration — needs a focused pass):** wiring
the authored 51-col board + camera fly-on-level-up + per-level fog gating into
live gameplay, and authoring L2/L3 content (orders, chains, goals). The data
foundation (zones + keyframes) is now ready; see the verification note below.

---

## Phase 2 — the full authored map, live (2026-06-16)

The game now runs the authored **51×24 world** (`assets/map/dragon-land.world-2.json`),
not the 8×8 prototype. `pnpm verify` green (typecheck → 39 unit → build → e2e).

- **Map pipeline**: `ingest-world.mjs` → `world-map.json`, then `build-gamemap.mjs`
  → `src/data/map.json` (the engine map). Per-level regions: `level_1` active
  (80 tiles), `level_2/3/4` gated by `unlock.level` and seeded with starter
  merge clusters. The hand-authored tutorial (start clearing + key-gated
  `north_fog` pocket) is re-anchored into the L1 zone by **+1,+4** so it centres
  on the L1 camera focus (4,7).
- **Rendering**: 513 real border-grass tiles placed by per-asset calibration,
  y-sorted; the grass edges are the cliffs (no separate cliff sprites); void =
  open sky. The per-level cloud fog IS the blanket and recedes as zones wake.
  Depth top-band raised to 50000+ (screenY reaches ~5100 on this board).
- **Camera**: frames one level at a time; on `keeper:leveled` it glides
  (smootherstep + mid-dolly) to the next zone's authored focal cell — suppressed
  during the tutorial. Drag-to-pan + wheel-zoom for free navigation.
- **Camera-aware UI**: `gridToPage` and every board-anchored UI marker
  (hand/arrow/tooltip) map cells through the board camera's `worldView`, since
  the UI scene keeps its own fixed camera.
- **Level-gated unlock**: `UnlockSystem` lifts `unlock.level` zones for free on
  `keeper:leveled` (KEY regions still cost a Gold Key — the tutorial lesson).
- **XP**: retuned (`[0,60,140,250,400,590,820]`) so the ~54-XP tutorial ends at
  level 1 and the first level-up lands just after — waking zone 2 and flying the
  camera to reveal it (the first big expansion beat). `docs/research/xp-pacing.md`.
- **Tests**: unit suite injects the 8×8 fixture via `new GameContext(storage,
  { map })`; the e2e drives the whole tutorial on the big board (cells offset
  +1,+4) and asserts the level-up camera fly via `window.__emberkeep.grantXp`.

**Next (not yet built):** richer per-zone content (more orders/chains/goals
beyond the starter seed clusters), and zones 5+ (data + camera keyframes exist
only through L4 / camera L3).

---

## Dragon economy, orders, and art/polish pass (2026-06-16)

`pnpm verify` green (typecheck → 43 unit → build → e2e).

**Dragon advantage — passive generation.** Hatchlings/whelps now also gift an
element for FREE on a timer (`GeneratorConfig.passiveMs`: hatchling 120s, whelp
90s) — no tap, no Warmth. `GeneratorSystem` arms a per-item `passiveAt` and
produces on the `time:advanced` tick (one gift per tick max, retries when the
board's full). The dragon celebrates + sparkles as it gifts (`item:produced` →
`onProduced`, soft `giftChime`). Tested in unit + confirmed live.

**Richer orders.** `orders.json` is now a 5-order queue (gem-heavy = sustainable
via the dragon economy: brazier → hearth → centerpiece → terrace → hoard) with
escalating Gold/XP. `item:produced` feeds order progress.

**Art / cloud / rig fixes:**
- Game clouds are now the REAL authored `cloud_tile` (`blockers/cloud/`), and
  **only** authored-JSON cloud cells are fogged — the invented `north_fog` L1
  pocket is gone. The tutorial's key-fog lesson clears `level_2_gate` (level-2
  clouds nearest the start). `build-gamemap` asserts 0 stray fog.
- The live rig dragon now attaches on EVERY path (incl. `item:spawned`); the
  red animated rig shows on the board and title.
- Title screen: real grass outcrop (`grass_10`) + real clouds + the rig dragon,
  replacing the old `tile_moss`/`fog_puff` placeholders.

**World builder — Merge asset library** (🔮 tab): all 11 merge items pre-labelled
with placeholders, each replaceable by uploading your own PNG; export carries
`mergeAssets[]`. See CLAUDE.md "World building pipeline".
