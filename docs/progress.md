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

## 2026-07-09 — Chapter One: the perfect-demo build (DEMO-PLAN implemented)

The full [docs/DEMO-PLAN.md](DEMO-PLAN.md) landed (per [docs/DESIGN-REVIEW.md](DESIGN-REVIEW.md),
respecting MECHANICS.md): the Level-3 cap is now a CHAPTER ENDING, not a demo wall.

- **Retune (the flow fix):** dragon cooldowns 5 min → **25 s** (passive 2 min),
  Warmth regen 3 min → **1 min**, cap 20 → **30** (start 28), crystal 20 → 5 min,
  chest 10 → 5 min (+15 gold), house 10 → 7 min. Warmth-skips now cost **1.5×**
  the gold price (gold is the cheap skip; the session meter never discounts).
  Orders re-curved: O1 = **6 shards + 25 gold** (was 20 + 0 gold); keys removed
  from order payouts AND from the shop (story gates are never sold).
- **The Golden Egg is the MacGuffin:** unsellable/untooltipped (`sellable:false`
  in chains.json, honored by EconomySystem + UIScene), spawns with a gold flood
  + '???', tap-wobbles with escalating flavor lines (dialogue.json), and TREMBLES
  once XP progress passes 80% of Level 2.
- **THE FINALE (keeper:leveled ≥ 3, shared `FINALE` timeline in Constants):**
  the egg cracks (`board:hatch` → gold hatch ceremony → **Golden Whelp**,
  red-dragon bake + gold tint until real art ships) → camera glides to the south
  terrace (`level_5`, which now breathes a faint gold shimmer all game) → the
  ash-fog parts HALFWAY for 2.4 s of warm light → it settles, the camera returns
  → **Cindra speaks for the first time in the demo** ("The Great Flame… was
  TAKEN") → the **CHAPTER ONE COMPLETE card** (stats + three Chapter-Two teaser
  slots + Keep Playing/Play Again). LEVEL_XP re-curved to `[0, 60, 220]` so L3
  lands on Order 3's delivery; the array ends at 3 — the XP bar reads "Chapter
  One complete ✦" at the cap.
- **Two orders visible at once** (LedgerPanel rebuilt as a two-card board driven
  by OrderSystem) + **encore orders**: a `repeatable` pool in orders.json cycles
  forever after the scripted four — the Ledger never dead-ends.
- **Order completion celebrates** at level-up parity: banner + sparks + a
  rotating Cindra QUOTE on the card (her bubble voice stays reserved for the
  finale).
- **Keeper's Tasks** (encore checklist): new Phaser-free `TaskSystem` owns
  lifetime stats in `GameState.stats` (hatches/merges/orders/goldEarned/
  whelpTaps); all five complete → one-time gold+Warmth bundle + Cindra line.
  New ⭐ HUD button + TasksPanel (post-tutorial). The Whelp dances when tapped.
- **Welcome-back moment:** GeneratorSystem banks up to **3 offline passive
  cycles** on load (`state:loaded` finally consumed); UIScene shows "WHILE YOU
  WERE AWAY" (+Warmth, +gifts) after 5+ min absent. Laurah gained two one-shot
  post-tutorial nudges (0 Warmth, board full).
- **The strawberry patch is real:** revealed with the key-gate land
  (tutorial spawn effects), `energyCost: 0` — the designed free 20-second
  producer ("always something to do at zero Warmth"). Fixed a real bug this
  exposed: a pending PASSIVE timer no longer reads as "cooling" on tappable
  generators (it blocked the free harvest behind the skip menu).
- Save v5 → **v6** (`stats` on the save; wipes old saves for the new curve).
  Ripple-map + CLAUDE.md updated (new events: `board:hatch`, `whelp:tapped`,
  `tasks:all_complete`).

`pnpm verify` green: typecheck, **111 unit tests** (incl. new TaskSystem +
multi-order/encore OrderSystem specs), build, full-tutorial e2e THROUGH the
finale (chapter card asserted on screenshot).

**Awaiting art** (stand-ins live): 3 Chapter-Two teaser silhouettes, optional
south-terrace glimpse silhouettes + ⭐ tasks icon.

### Addendum — the golden dragon rig landed
The art team's rigged golden dragon
(`assets/sprites/characters/dragon/golden-dragon/rig-adult/golden-dragon.rig.json`,
6 layers, head/arm/wing anchors + full pin chains) is now wired in:
- `DRAGON_RIGS.golden_egg` → the **Golden Whelp wears the LIVE rig** in the
  finale hatch and the encore (idle/hover cycles, dances on tap via
  `celebrateDragon`); the gold-tinted red bake remains only as the
  rig-unavailable fallback. Rig eligibility is now per chain+tier
  (`wearsRigTier`): golden rigs tier 2 despite not being a generator.
- She still NEVER works: drag-to-House excluded for `golden_egg`.
- Default-named exports (`character: 'character'`) are normalised to their
  chain/catalog id at load so texture keys can't collide.
- Added to `characterCatalog` (`dragon-golden`) for the UI-builder rail.
- Scale: whelp-size × `DRAGON_RIG_SCALE.golden_egg = 0.5` (tight-cropped
  pieces vs the red set's padded canvases — tune there).

## 2026-07-10 — AI art pipeline: Nano Banana Pro skill + the remaining assets

- **New skill `.claude/skills/nano-banana/`** (+ `asset-artist` agent): validated
  Google **Nano Banana Pro** (`gemini-3-pro-image`, generateContent, key in
  `.env` — now gitignored) and built the full pipeline: `generate.py` (REST +
  retries + certifi SSL) → `dekey.py` (magenta #FF00FF chroma-key → soft alpha
  + de-spill that never touches warm golds) → `round-corners.py`. Prompting
  rules encode the game's iso 2:1 perspective, LEFT-facing characters, and the
  Emberkeep palette. ~$0.13/image; all outputs SynthID-watermarked.
- **7 assets generated, QC'd and WIRED (all first-take):**
  - Chapter-card teasers (`sprites/ui/chapter2/teaser_{terrace,breed,flame}.png`,
    680×520, corners pre-rounded) — EndScreen now shows real art full-bleed in
    the three Chapter-Two slots ('?' remains the missing-file fallback).
  - Finale glimpse silhouettes (`sprites/finale/glimpse_{shrine,dragon_a,dragon_b}.png`)
    — during the fog half-part, the shrine + two unfamiliar dragons now FADE IN
    under the translucent clouds and sink back with the settling ash
    (BoardScene.runFinale).
  - Keeper's Tasks icon (`sprites/ui/icon_tasks.png`) — replaces the ⭐ emoji
    on the HUD button (emoji stays as fallback).
- assets/CREDITS.md notes the AI provenance. ART-REQUESTS items 1–3 marked
  delivered (team can swap 1:1 with hand art later); open: golden head frames,
  optional baby whelp rig.

## 2026-07-10 — Golden dragon face animation via Sprite Studio + Nano Banana Pro

The golden whelp now BLINKS and ROARS like the red dragon:
- **Sprite Studio as an API**: compiled its real `lib/gridSheet.ts`
  (Dev/Helper/SmartGrid/sprite-studio) and ran `buildGridSheet` headlessly in
  Chromium — a 1×3 white-silhouette mask template of the golden head (512×502
  cells) + a cell-framed base head, exactly the app's grid-sheet workflow.
- **Frames from Nano Banana Pro** (generate.py grew `--ref` reference-image
  support): head reference (Image 1) + mask template (Image 2) → one 3×1 blink
  sheet (open / half / closed) and one 3×1 roar sheet (closed / half / wide),
  Sprite-Studio-style prompt, magenta key. Both first-take.
- **Sequenced the loops myself from the red dragon's format**: sliced cells →
  de-keyed → `golden-dragon-blink-animation/` (open, halfOpen, closed,
  halfOpen2=dup; 2600/45/70/55 ms) + `golden-dragon-roar_talk-animation/`
  (4× 267 ms), matching red's frames.json exactly.
- **Calibrated**: rig name canonicalised to `dragon-golden`
  (BoardScene `DRAGON_RIG_NAMES` + characterCatalog agree), added to
  `scripts/calibrate-faces.mjs` CHARACTERS → faces.json now carries golden:
  blink IoU **97.5%**, talk **97.3%**, 0.00px width drift (self-verified).
  RigPlayer picks the frames up automatically (BlinkScheduler ambient blink;
  hatch/dance roar-flap via playFace).
Remaining art: only the optional baby-whelp rig (ART-REQUESTS §5).

## 2026-07-10 — Lore pivot: the Golden Egg AWAKENS the legendary Golden Elder

The egg no longer hatches a baby — it wakes an ADULT legend (asleep since the
Great Flame was taken). Renames + presentation across the board:
- `golden_egg_2` = **"Golden Elder"** (chains.json); the adult rig is now
  canonically correct — ART-REQUESTS §5 (baby variant) RETIRED, list fully closed.
- Event `whelp:tapped` → **`elder:tapped`**, TaskKind `whelpTaps` →
  `elderTaps`, task = "Commune with the Golden Elder (tap her 10×)"
  (safe within save v6 — never shipped). `GOLDEN_WHELP_TIER` →
  `GOLDEN_ELDER_TIER`; BoardScene `danceWhelp` → `communeWithElder`
  (statelier: bigger gold flare, ✦, rig answers with hover + mouth-flap).
- She still never works — justification flipped from "she's a baby" to
  "a legend does not haul timber".
- **Legendary presence**: `DRAGON_RIG_SCALE.golden_egg` 0.62 → **0.74** — she
  reads clearly larger than the common dragons.
- Dialogue: egg tap lines now foreshadow an ANCIENT awakening ("Something
  ancient stirs within…", "she is almost awake!"); Cindra's finale line
  acknowledges her: "So the Elder wakes for YOU… at dawn, we follow her past
  the southern ash."

## 2026-07-10 — The GOLDEN ALTAR: all golden lore staged at the authored spot

Per the world-builder placement in `golden-egg.json` (decor `golden-egg` at
world cell (-8,-2) — the crystal-ringed scenic ledge NW of the isle), every
egg/Elder event now happens THERE, on non-playable scenery:
- **New `GOLDEN_ALTAR` fixture** (BoardScene): cell (-2,2) in current map
  coords (verified: the export's 45 tiles map 1:1 onto map.json with the +6,+4
  normalization — no map regeneration needed), with the builder's measured
  calibration. It is a SCENE FIXTURE, not a board item — the golden chain no
  longer merges/sells/drags/works by construction.
- **Lifecycle, fully save-derivable** (nothing new persisted): Order 1
  delivered → the egg MATERIALISES on the altar (camera glides west, gold
  flood, '???'); tap→wobble + flavor lines; trembles near L3; at the finale
  the camera returns west and the egg cracks — the **Elder awakens on her
  ledge** (live rig, faces the isle, ambient idle/hover + blink) before the
  south-terrace glimpse; encore taps commune with her there (`elder:tapped`).
- Removed the whole item-based golden path: `board:hatch` event +
  BoardSystem.hatchTransform, order `spawn` reward (→ new `rewards.tease`
  "🥚 ???" hint on the Ledger card), item tap/drag/tint special cases.
  OrderSystem.spec updated; ripple-map updated.
- World builder tool fix (same session): a broken/missing asset image no
  longer deadlocks world loading (the 3D crystal's imageless export froze
  `default-world.json` at 46 assets/0 placements rendered).

## 2026-07-10 — Golden storytelling: every path through the promise now lands

Closed the three seams found auditing the golden-egg narrative:
- **Prophecy finale** (Order 1 skippable via the two-slot Ledger → L3 possible
  with no egg): Cindra's finale line now has a variant that reads as PROPHECY
  ("The old altar stirs — finish my first request, and what sleeps there will
  wake for you") instead of claiming an awakening that never happened — and it
  funnels the player back to the unfilled order.
- **Late awakening**: delivering Order 1 after Level 3 plays arrival AND
  awakening as one held beat at the altar (glide west → egg lands in gold →
  cracks at 2.4s → the Elder rises → home), with Cindra's line landing as she
  rises ("At last — she waited for YOU"). If the delivery itself CROSSES
  Level 3 (keeper:leveled fires mid-deliver), the handler only seats the egg
  and lets the already-running finale own the awakening — no double ceremony,
  no camera fights (guarded by finaleStartedMs vs FINALE.cardAtMs).
- **The missing signpost** (DEMO-PLAN Act IV): Laurah now cries "Look at the
  egg on the old altar, it's TREMBLING!" once, when the egg exists and XP
  crosses the tremble threshold — eyes guided to the altar right before the
  payoff.
- Plus: the arrival banner now carries a dedicated Cindra quote ("A golden
  egg… on the OLD altar. So the stories were true.") instead of a generic
  rotation. New dialogue keys: finaleCindraProphecy, goldenArrival,
  lateAwakening, hints.eggTrembles. Both new paths screenshot-verified.

## 2026-07-10 — The CHAPTER TWO TRAILER: 5 legends, 2 new worlds, in-engine

An in-engine cinematic now plays from the chapter card ("▶ WATCH THE CHAPTER
TWO TRAILER" — replaces the static teaser line; falls back to it when the art
is absent). New `src/ui/ChapterTrailer.ts`: letterboxed slides with crossfades
— cold open ("CHAPTER TWO / The Great Flame was TAKEN") → THE FROZEN REACHES
(Ken Burns drift) → THE CRYSTAL DEPTHS → the LEGEND PARADE (five silhouettes
revealed one by one with gold flares — "FIVE LEGENDS SLEEP. FIVE WORLDS
WAIT.") → end card. Tap advances, ✕ closes, every slide skips cleanly if its
texture is missing.

Assets (all Nano Banana Pro, first-take, `sprites/ui/chapter2/trailer/`):
- **2 world vistas** generated with the live `emberkeep.jpg` background as a
  STYLE REFERENCE image — same painterly floating-isles language, chains +
  golden lanterns, elevated 3/4 iso camera: ice world (frozen waterfalls,
  icicle underbellies, aurora) and crystal world (dark stone isles crowned
  with amethyst/emerald, violet cloud sea).
- **5 legendary silhouettes** (500×520, magenta-keyed): frost (icicle spines),
  crystal (faceted shard horns), storm (legless serpent coil), tide (fin wings
  + angler-lure tail), shadow (hunched vulture, twin whip tails) — all
  left-facing, gold rim, one glowing eye, teaser language consistent with the
  chapter-card breed silhouette.

## 2026-07-10 — Trailer → "BEYOND THE DEMO" one-page roadmap popup

Design revision: the multi-slide cinematic was replaced by a single stylish
popup (`src/ui/BeyondDemoPanel.ts`, chapter-card button now reads "SEE WHAT'S
BEYOND THE DEMO"). One dark gold-framed page, plain factual copy: "5 NEW
WORLDS — the first two" (ice + crystal vistas as rounded, name-plated preview
cards) · "5 LEGENDARY DRAGONS TO AWAKEN" (the five silhouettes in a row) ·
footer "Plus: new merge chains · more orders for the Ledger · the rest of the
Great Flame story". Same 7 generated assets; ChapterTrailer.ts deleted.

## 2026-07-10 — One quest board: Keeper's Tasks merged into Cindra's Ledger

The two quest surfaces (Ledger orders board + a separate ⭐ HUD button opening
the Keeper's Tasks checklist) had no visual or narrative cohesion. Merged into
a single tabbed panel (`src/ui/LedgerPanel.ts`):

- Header is now a two-tab lozenge pair: **Cindra's Orders** (lava, active
  default) and **Keeper's Tasks n/5** (gold, live done-counter). Pages share
  the same `ui_panel` frame; tab switch is a soft cross-fade.
- The Tasks tab only exists post-tutorial — during the tutorial the Orders
  lozenge sits centred, so every scripted beat (ledger open, deliver hand
  target, `getDeliverPos`) is pixel-identical to before.
- `TasksPanel.ts` and the floating ⭐ tasks button are deleted; the HUD's
  single Ledger button is the one entry point (its deliverable dot unchanged).
- Fixed a close→reopen race while here: `open()`/`requestClose()` now kill
  stale panel tweens so a dangling close tween can't hide a reopened panel.
- LedgerPanel refreshes the Tasks page on merge/hatch/order/elder-tap/economy
  events and `tasks:all_complete` (ripple-map updated).

Verified with Playwright screenshots (tutorial header, both tabs) + `pnpm verify`.

## 2026-07-10 — Task-flow audit: every checklist loop verified unblockable

Traced each Keeper's Task to its supply loop in the encore sandbox:
- **Hatch 4** — tutorial banks 2; the ruby loop (dragon → rubies → eggs →
  dragon) is self-sustaining. **Merge 30** — the strawberry generator is free
  (0 Warmth, 20s), so merge fodder never dries up even at zero energy.
- **5 orders / 500 gold** — order slot 1 always holds the oldest uncompleted
  order and the encore pool is endless; the four authored orders pay 450 gold,
  chests/houses/sales cover the rest. The two tasks complete on one horizon.
- **Elder communes** — free, uncapped, fallback-art-safe; the altar is inside
  the pannable camera bounds and both awakening paths (finale + late) reach it.

One seam fixed: the Elder task showed a dead 0/10 bar from the encore's start,
long before she exists. Tasks now support a data-driven lock
(`lockedUntil: { order?, level? }` + `lockedHint` in tasks.json;
`TaskSystem.isLocked`): the Ledger's Tasks tab dims the row and shows
"🔒 She sleeps — fill Cindra's golden order and reach Level 3" until both
gates lift (live, via the panel's existing refresh events). Unit-tested;
locked/unlocked states screenshot-verified.

## 2026-07-10 — Dragon countdown badge · WYSIWYG drops · Emberberry

- **Dragon cooldown countdown**: rig-hosted dragons showed a phantom timer pill
  hidden UNDER the rig (the rig glues at host.depth + 0.5) with no numbers
  (the update loop skipped dragons, so the label never updated). Now: the
  BoardItem suppresses its in-container pill while its art is rig-hidden
  (`artHidden`), and BoardScene floats a scene-level cooldown badge
  (fx_timepill + gold dot + live `24s`/`m:ss` text) above the dragon's head at
  flash depth (`coolBadges`, updated in the 240ms cooling tick; stacks above
  the Zzz pill; sparkle when it clears). Non-rig generators unchanged.
- **WYSIWYG drag-drop**: drops resolved from the RAW POINTER (+24px), while the
  highlight diamond tracked the dragged item — the grab offset could land the
  drop one tile off and bounce an item that visibly hovered a free tile. Drops
  now resolve from the same tracked position as the highlight: the highlighted
  cell IS the drop cell. Free move onto any empty active tile already existed
  in MergeSystem (bounce only for occupied/inactive tiles) and now behaves
  that way in practice. Verified via a staged off-center-grab drag (landed
  exactly on the intended tile) + screenshots.
- **Strawberry → Emberberry**: display names + tutorial/hint copy re-themed to
  Emberkeep's universe (chain id/asset keys unchanged — save-safe). New art
  via Nano Banana Pro replaces the three 240×240 sprites in place.

## 2026-07-10 — Economy pacing ×3, smaller gems, unified rest pill

- **Gem sizes**: Dragon Ruby 0.18 → 0.13, Emerald 0.25 → 0.18 (ITEM_SCALE) —
  merge fodder now reads as gems, not tile-fillers.
- **Production ×3** (chains.json): red/green dragon tap cooldown 25s → 75s and
  passive gift 120s → 360s; Ancient Tree wood 20min → 60min (cooldown+passive).
  GeneratorSystem specs updated to the new intervals (the skip-cost spec pins
  the dragon total at 75_000).
- **Rest pill**: the big cream "💤 Zzz" card is now the SAME fx_timepill visual
  as every countdown (💤 in place of the gold dot + live m:ss), so all three
  dragon badges (cooldown, rest) and generator pills share one language.

## 2026-07-10 — Emberkeep Cookbook (merge-recipe discovery log)

New collection surface: a cookbook button (Nano-Banana-generated leather-book
icon, `ui_icon_cookbook`) sits directly above the quest button; a lava dot +
button pulse mark fresh discoveries (cleared on open). The panel
(`src/ui/CookbookPanel.ts`) reads as an open two-page spread in the standard
cream ui_panel: 12 recipe rows (all mergeable tier pairs from chains.json,
golden lore chain excluded), each `[input chip + ×N badge] ──▶ [result chip]`
with "Input → Result" inscribed under the arrow. Undiscovered recipes render
as darkened "?" chips with a dim arrow — the footer counts
"n / 12 recipes discovered".

Wiring: `GameState.discoveredRecipes` (save-tolerant additive field, keys
`chain:fromTier>resultTier`); MergeSystem records first-time merges and emits
`cookbook:discovered` (ripple-map updated); button hidden during the tutorial
(discoveries still record silently). Unit-tested (first merge writes the page
once; repeats don't re-emit); layouts screenshot-verified.

## 2026-07-10 — Cindra gets real art (flame-spirit bubble icon)

The runtime-painted vector flame on Cindra's order cards is replaced with a
Nano-Banana-generated portrait: a regal little ember spirit (white-gold core,
crimson edges, tiny gold crown, imperious smirk) in the exact 412×412 gold-ring
bubble-icon format as Laurah's — dark plum backdrop disc vs her green.
`portrait_cindra` now loads from
assets/sprites/guide-characters/cindra/cindra-bubble-icon.png (assets.json
source:"file"; the TextureFactory painter remains the graceful fallback).
LedgerPanel sizes the portrait with setDisplaySize(178,178) so file art and
fallback read identically. Laurah's bubble icon untouched; Cindra's finale
bubble lines pick up the new art automatically (same texture key).

## 2026-07-10 — Golden Egg is authored decor (visible from game start)

Fix per playtest: the egg placed in golden-egg.json (decor, world cell -8,-2 →
altar cell -2,2) only APPEARED after delivering Cindra's first order — the
authored isle sat empty on a fresh game. syncGoldenAltar now always shows the
egg (the Elder replaces it post-awakening); clearAltar removed. The Order-1
ceremony plays on the EXISTING egg (glide west + gold flare — "the old altar
answers"), goldenArrival quote reworded to match. Pre-delivery egg keeps its
tap-wobble + escalating flavor lines. Screenshot-verified on a fresh save:
egg standing in the crystal ring from the first tutorial line.

## 2026-07-10 — Tutorial: Emberberry lesson + Cookbook introduction

Two new scripted beats (tutorial.json now 19 steps; every existing step
untouched and re-verified end-to-end):
- **cookbook_intro** (after ruby_merge — the moment the first recipe page is
  written): Laurah points at the Cookbook button (new `ui: "cookbook"` marker
  target + `allow.cookbook`); opening the panel is the gate (new
  `ui:cookbook_opened` bus event). The next step auto-closes the panel after a
  1.2s hold. The button now appears for its introduction, then permanently.
- **emberberry_tap + emberberry_merge** (after key_unlock): the patch spawns
  in the opened land, one free tap-harvest gates step 1; two more sprouts then
  spring up CONNECTED to the harvested one (new `nearTier` filter on scripted
  spawns — anchoring by chain alone picked the patch, fanning the sprouts
  non-adjacent so the taught drag could never merge). bush_merge slimmed to
  bushes-only (spawns/text moved to the new lesson).
- Invariants held: the levelup beat still lands at exactly 60 XP (the
  emberberry merge's +6 XP comes after it); e2e retitled and extended
  (cookbook open, free-harvest energy assertion, sprout blob merge) — full
  suite green.

## 2026-07-10 — Golden-egg tutorial tease, egg aura + float, smaller trees

- **golden_tease** step (between marketplace and free_play, 20 steps total):
  the camera glides west to the altar while Laurah tells the egg's lore ("it
  has slept since the Great Flame was lost"); the egg wobbles awake. Camera
  returns on the next step (teaseReturn pairing in BoardScene's tutorial:step
  handler, same pattern as the emerald_tap glide).
- **Post-tease presence**: from the tease onward (save-derivable via
  tutorialIndex/tutorialDone), the altar egg carries a soft pulsing golden
  aura (additive fx_glow) and floats gently (±7px, 2.3s sine). Cleared when
  the Elder replaces the egg.
- **Tree sizes**: Ancient Tree 0.31 → 0.22 (hit-rect re-derived per the
  ripple-map invariant) and the emberberry plant 1.0 → 0.75.
- e2e extended with the tease beat (glide + shot) — full suite green.

## 2026-07-10 — Reward-radius blocking · tutorial flow fixes · emerald bake

- **Rewards never leave their neighbourhood**: new REWARD_SPAWN_RADIUS (3
  manhattan tiles) caps every reward drop — harvests fail with no_space,
  passives skip their tick, merge 5-bonus extras just don't spawn, and the
  chest pays its GOLD gift instead — rather than teleporting items across the
  map onto far/edge cells that read as floating off-platform. Out-of-zone
  fixtures (the crystal) keep the unbounded search (GeneratorSystem.dropTileFor).
- **cookbook_close step**: the player closes the book themselves (arrow on the
  ✕, new ui:cookbook_closed gate + 'cookbook_close' ui target) — replaces the
  auto-close hold. 21 tutorial steps.
- **buy_energy stuck-step fix**: the free-Ember-Spark one-shot lived in
  sessionStorage, surviving resets — replays had no FREE card and the
  marketplace gate could never pass. Now a save-backed stat (freeSparkUsed,
  recorded by EconomySystem on marketplace:purchased{free}); ShopPanel reads
  the save. e2e now drives the REAL ⚡+ → Emporium → FREE claim path.
- **Marker rule**: gauntlet = action demos (drags) ONLY; arrow = static
  targets; never both (UIScene enforces hand-else-arrow; data cleaned across
  all 21 steps).
- **Sizes**: Ancient Tree 0.22 → 0.17 (hit-rect re-derived), emberberry plant
  0.75 → 0.58, bush 0.8, sprout 0.85.
- **Emerald dragon baked**: composited from its rig layers (1054×1074, same
  format as the red) → item_emerald_3 real art (scale 0.21) — the Cookbook's
  Green Dragon row no longer shows a fallback.
