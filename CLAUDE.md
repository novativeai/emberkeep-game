# Emberkeep — agent instructions

Phaser 3 + TypeScript (strict) + Vite isometric merge game. Runs the authored
51×24 world (`src/data/map.json`, generated — see "Authored map pipeline"); the
first three Keeper-level zones are content-complete. Everything is production
architecture — nothing is throwaway.

## Commands
- `pnpm dev` — dev server · `pnpm verify` — typecheck → unit → build → e2e (run this before calling anything done)
- `pnpm test` (Vitest, node env, `tests/unit/`) · `pnpm e2e` (Playwright, drives the whole tutorial, shots → `tests/e2e/shots/`)
- e2e serves the PRODUCTION build via `vite preview` — run `pnpm build` first if you only invoke `playwright test` directly.

## Architecture rules (non-negotiable)
- ALL cross-module communication goes through the typed synchronous `EventBus`
  (`src/core/EventBus.ts`; the full event contract lives in `src/core/types.ts`).
  Systems never call each other — they may emit commands (`energy:spend`,
  `economy:add`, `board:consume_items`) that the owning system handles
  synchronously. UI/scenes/audio only emit intents and subscribe.
- All state lives in `GameState`; only systems mutate it (scenes read for rendering).
- Every tunable goes in `src/core/Constants.ts` or `src/data/*.json` — no magic
  numbers in systems/scenes. New chains/orders/tutorial steps are JSON-only edits.
- All gameplay timers read `GameClock.now()` (never `Date.now()`) so
  `window.advanceTime(ms)` stays deterministic.
- Systems must stay Phaser-free (unit tests construct a full `GameContext` in node).
- Everything tweens; nothing teleports. BoardItem sprites and particles are pooled.

## Rendering & resolution
- The canvas renders at 2560×1600 (`RES = 2` in Constants) and FIT-scales down,
  so everything is retina-crisp. ALL coordinates/font sizes are written in that
  hi-res space; TextureFactory paints in logical units ×RES. CSS-space e2e
  coordinates are half the game-space values.
- e2e runs headless Chromium WITH GPU (`--enable-gpu --use-angle=metal` in
  playwright.config) — SwiftShader cannot push 2560×1600 at playable FPS.
- The isle is the authored `map.json`: every `playable` cell wears its
  hand-placed border-grass tile (real art + per-asset `calibration`, y-sorted in
  the floor band); cells absent from `playable` are void (open sky) and that IS
  the silhouette. The grass edges ARE the cliffs — no separate cliff sprites.
- Clouds in the game are ONLY the authored level-blocker cells from the world
  JSON — nothing is invented. `createFogSprite` paints the real `cloud_tile`
  (the same `blockers/cloud/cloud-tile.png` the world builder uses, anchor
  0.5/0.62). Zones 2–4 start fogged and lift on reaching that level
  (`unlock.level`); the tutorial's key-fog lesson clears `level_2_gate` — a
  small cluster of the level-2 clouds nearest the start (so it's a real authored
  blocker, not a pocket on L1). Fog sits at `itemBase + y + 2`. The board spans
  ~5100 in screenY, so the always-on-top bands (`dragged/particles/flash`) live
  at 50000+ — never tie them to a small const.
- Camera frames ONE level at a time (`setupCamera`/`flyToLevel` in BoardScene),
  gliding to the next zone's authored focal cell on level-up (smootherstep +
  mid-dolly — the world-builder's move). The glide is SUPPRESSED while the
  tutorial runs (it stays on the L1 clearing). Drag empty ground to pan, wheel
  to zoom. The UI scene has its own fixed camera, so `gridToPage` (main.ts) and
  every board-anchored UI marker (hand/arrow/tooltip in UIScene) map cells
  through the board camera's `worldView` — keep that conversion when refactoring.
- Screaming Brain (CC0) PNGs use magenta colour-keying with NO alpha channel —
  de-key to RGBA before wiring into assets.json (see assets/raw/screamingbrain).

## Phaser gotchas learned the hard way (do not regress)
- Container hit areas are evaluated against `localPoint + displayOrigin` —
  custom hit rects must be origin-shifted (see `acquireSprite` in BoardScene).
- Keep board hit areas ≤ one iso row tall (32px above tile centre) or front
  items mask the tile behind them from input.
- Pooled BoardItems: never `disableInteractive()` on release (re-acquire won’t
  re-enable it); invisibility already removes them from hit-testing.
- `setAlpha(0)` (like `setVisible(false)`) clears the render flag, so Phaser
  SKIPS the object in hit-tests — taps/drags die. To hide a host while a live
  rig stands in for it, hide the inner art (`BoardItem.setArtVisible(false)`),
  never the container's alpha.
- Never run two scale tweens on the same spawning sprite (`popIn` + pulse):
  the longer tween owns the final property write.
- Fog puffs get a tile-diamond polygon hit area, not their full puffy frame.

## Art & audio
- Placeholders are painted at runtime: `src/art/TextureFactory.ts` (Canvas2D,
  Emberkeep palette from Constants). Real art swaps in via `src/data/assets.json`
  (`source:"file"` + path under `assets/`, Vite public dir) + `anchors.json`;
  loader errors fall back to placeholders. Update `assets/CREDITS.md` for every
  file added under `assets/raw/`.
- SFX are WebAudio-synthesised in `AudioManager` (bus subscriber only; context
  unlocks on first pointerdown from `main.ts`).

## Character rigging pipeline
- `tools/rigger/index.html` — standalone browser app (open the file directly,
  zero deps). Workflow: upload layer PNGs (same-size pieces auto-stack) →
  align in the preview (Move) → parent/child rotation pivots (Anchor, with
  ▶ wiggle test) → in-layer deform pins (Puppet) → Export rig.json.
- Joint/layer names come from the LOCKED lists in that file (LAYER_PARTS,
  ANCHOR_NAMES, PIN_NAMES) — game animation code keys off these names, so
  extend the lists rather than free-typing. `root_ground` pin is required.
- Combined shoulder+arm+hand / hip+leg+foot layers (the red-dragon set ships
  limbs this way) deform via 3-pin chains: `pin_arm_left_01..03` (shoulder→
  elbow→hand) and `pin_leg_left_01..03` (hip→knee→foot), both sides.
- Any joint marker is selectable/draggable in EVERY tool; right-click a
  marker or press Delete (with it selected) to remove it.
- `tools/rigger/animator.html` previews animation presets against a rig
  (opens via the rigger's ▶ Animate button, which hands the current rig over
  through localStorage; also auto-loads `red-dragon/rig/dragon-red.rig.json`).
  The engine is ADAPTIVE: every motion resolves through anchor (rotate child
  subtree) → pin-chain (strip wave-deform) → bare-layer (rotate around base)
  → skip, and a panel shows which channel each motion used. Character is iso
  3/4 facing LEFT: wings beat in-phase, near-side (higher-z) limbs get larger
  amplitude, forward lean is down-left. 5 presets: idle, hover, celebrate,
  roar, stretch. When animating in-game, mirror this resolution order so rigs
  with missing joints still animate.
- The export is self-contained: layer transforms + z-order, anchors in
  rig/parent-local/child-local space + `childOriginNorm` (Phaser setOrigin-
  ready), ordered pin chains, root, and embedded images.
- Dragon pieces live in `assets/sprites/characters/dragon/red-dragon/`
  (each piece 666x666, content centred — NOT pre-aligned; alignment happens
  in the rigger). The hatchling/whelp manifest entries stay `placeholder`
  until a rig assembly exists.

## World building pipeline
- `tools/worldbuilder/index.html` — standalone browser app (open directly,
  zero deps). Infinite isometric canvas matching the game projection
  (TILE_W×TILE_H, 2:1); pan (drag/space/alt), wheel zoom, Fit, grid toggle.
- Two asset categories switched by sidebar tabs: **tiles** (floor, one per
  cell, anchor default 0.5/0.5) and **decor** (stack many per cell, anchor
  default 0.5/0 — top-centred). Paint / Select / Erase tools.
- The Calibration panel edits the SELECTED asset's offsetX/offsetY/scale/
  anchor and live-previews every instance — this is how you find the exact
  per-PNG nudge. The export's `assets[].calibration` is that table; drop
  offsetX/offsetY into placement and `anchor` into anchors.json.
- Export world.json: tile size, bounds, per-asset calibration, all
  placements (asset/category/col/row/z), embedded PNGs. Save/Load project
  round-trips everything.
- Presets for the real tile set: grid defaults to 240×120 (the border-grass
  grass-diamond footprint) and the 16 `border-grass/` blocks auto-load on
  open (⤓ Starter assets re-loads them) with per-tile measured anchorY
  (~0.24 tall edge blocks 1-8, ~0.30-0.35 short blocks 9-16). At the game's
  256-wide grid these tiles need scale ≈ 1.067.
- Third category **Blockers** (☁ tab): the normalised 1-tile cloud
  (`level-blocker/cloud/cloud-tile.png`, 256×174, anchor 0.5/0.62) auto-loads
  there. Every placed cloud is stamped with the toolbar's **Level** number
  (color-coded badge per level); a selected cloud's level is editable in the
  inspector. Export adds `placements[].level` and a `levels` map
  ({ L: { count, cells:[{col,row}] } }) — i.e. exactly which cells unfog when
  each level unlocks. Cloud master crop is `cloud-cropped.png` (882×599).
- **Camera keyframes per level** (🎥 panel): frame the view, Set a keyframe per
  level. Stored as focal WORLD point + zoom (window-size independent); export
  adds `cameraKeyframes[] = { level, focus:{col,row}, world:{x,y}, zoom }` so the
  game frames the focal cell on level-up. Go / ▶ Preview tour glide with an
  extra-smooth smootherstep + gentle mid-dolly — the same move the game plays on
  a level unlock. Keyframes persist in the auto-save and draw as on-canvas
  reticles.
- **Merge asset library** (🔮 Merge tab): the catalogue of every game element
  (`MERGE_SLOTS`: the 9 chain tiers + nest + brazier), each pre-labelled with a
  generated placeholder. It is NOT painted on the map — click ⤒ Replace (or the
  art) to swap any slot for your own PNG, ↺ to revert. Custom art persists in the
  auto-save and exports as `mergeAssets[] = { key, label, chain, tier, custom,
  file, image }` (image embedded only for replaced slots).

## Authored map pipeline (world-builder export → live game)
- `scripts/ingest-world.mjs <export.json>` → `src/data/world-map.json`: a clean,
  normalised intermediate (min cell → 0,0) with `playable`, per-level `playZones`
  (no-cloud = L1; a cloud tagged level N gates zone N), `fogRegions`, per-cell
  `tilesByCell` + `calibration`, and normalised `cameraKeyframes`.
- `scripts/build-gamemap.mjs` → `src/data/map.json`: the map the ENGINE runs.
  Adds per-level regions (`level_1` active; `level_2..4` `unlock.level`, each
  seeded with a starter merge cluster near its focal cell), re-anchors the
  hand-authored tutorial start items into the L1 zone by **+1,+4** (centring on
  the L1 camera focus 4,7), and carves `level_2_gate` — the dozen level-2 clouds
  nearest the start — as the tutorial's key-unlock lesson (`unlock {keys, level:2}`),
  holding its 3 eggs + nest. EVERY fogged cell is therefore an authored cloud;
  the script asserts this. Regenerate BOTH scripts after re-exporting the world.
- `MapData` now also carries `tile/playable/tilesByCell/calibration/cameraKeyframes`.
  `unlock` is `{ keys? | level? }`: KEY regions lift on tapping with a Gold Key
  (the tutorial lesson), LEVEL regions lift free in `UnlockSystem` on
  `keeper:leveled`. Unit tests inject the 8×8 fixture (`tests/fixtures/map-8x8.json`)
  via `new GameContext(storage, { map })` so systems stay decoupled from level design.
- XP (`LEVEL_XP`) is tuned so the whole tutorial (~54 XP) ends at level 1; the
  first level-up lands just after, waking zone 2 + flying the camera there (the
  first big reveal). See `docs/research/xp-pacing.md`. `window.__emberkeep.grantXp(n)`
  is a test hook to drive a level-up (and its fly) deterministically.

## In-game rig runtime (the optimal implementation)
- `src/render/RigPlayer.ts` consumes a rig.json and builds the character ONCE:
  outer container (scene placement + facing) → inner container (animation
  root transform) → flat z-ordered layer Images whose origin = the resolved
  pivot. Animating writes only `.rotation` on a few sprites + the inner
  container's `y`/`scale` — GPU-batched, zero per-frame allocation.
- Adaptive resolution lives in `src/render/rigAnimations.ts` (pure, unit-
  tested): every part resolves anchor → pin-chain → bare-layer → skip, the
  SAME order the animator tool uses, so missing joints still animate. Reuse
  these functions when adding game animations; don't re-derive the order.
- Mirroring for right-facing = `RigPlayer.setFacing('right')` →
  `container.scaleX = -1` (single flip; pivots/rotations flip with it). The
  source art is iso 3/4 facing LEFT.
- Board reuse: `RigPlayer.bake(scene, key)` flattens the rest pose to one
  texture so many pooled generators cost nothing at runtime; keep live
  RigPlayers for featured instances only (title screen, hatch close-up).
- Wired live (lazy + fallback) on the TitleScene from
  `sprites/characters/dragon/red-dragon/rig/dragon-red.rig.json`; if absent,
  the egg art remains. Keep the Play button at its position (e2e taps it).

## Instrumentation contract (Playwright depends on it)
`window.render_game_to_text()`, `window.advanceTime(ms)`,
`window.__emberkeep.gridToPage(col,row)` — keep these stable when refactoring
`src/main.ts`.
