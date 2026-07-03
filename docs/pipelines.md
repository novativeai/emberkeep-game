# Content pipelines — tools, world authoring, rigs (reference)

Moved out of CLAUDE.md to keep it lean. Read the relevant section BEFORE using the
authoring tools or touching the map/rig pipelines. `docs/ripple-map.md` has the
cross-file invariants these pipelines participate in.

## Character rigging pipeline (tools/rigger)

- `tools/rigger/index.html` — standalone browser app (open the file directly, zero
  deps). Workflow: upload layer PNGs (same-size pieces auto-stack) → align in the
  preview (Move) → parent/child rotation pivots (Anchor, with ▶ wiggle test) →
  in-layer deform pins (Puppet) → Export rig.json.
- Joint/layer names come from the LOCKED lists in that file (`LAYER_PARTS`,
  `ANCHOR_NAMES`, `PIN_NAMES`) — game animation code keys off these names, so extend
  the lists rather than free-typing. `root_ground` pin is required.
- Combined shoulder+arm+hand / hip+leg+foot layers (the red-dragon set ships limbs
  this way) deform via 3-pin chains: `pin_arm_left_01..03` (shoulder→elbow→hand) and
  `pin_leg_left_01..03` (hip→knee→foot), both sides.
- Any joint marker is selectable/draggable in EVERY tool; right-click a marker or
  press Delete (with it selected) to remove it.
- `tools/rigger/animator.html` previews animation presets against a rig (opens via
  the rigger's ▶ Animate button, which hands the current rig over through
  localStorage; also auto-loads `red-dragon/rig/dragon-red.rig.json`). The engine is
  ADAPTIVE: every motion resolves anchor (rotate child subtree) → pin-chain (strip
  wave-deform) → bare-layer (rotate around base) → skip, and a panel shows which
  channel each motion used. Character is iso 3/4 facing LEFT: wings beat in-phase,
  near-side (higher-z) limbs get larger amplitude, forward lean is down-left.
  5 presets: idle, hover, celebrate, roar, stretch. In-game animation mirrors this
  resolution order so rigs with missing joints still animate.
- The export is self-contained: layer transforms + z-order, anchors in
  rig/parent-local/child-local space + `childOriginNorm` (Phaser setOrigin-ready),
  ordered pin chains, root, and embedded images.
- Dragon pieces live in `assets/sprites/characters/dragon/red-dragon/` (each piece
  666×666, content centred — NOT pre-aligned; alignment happens in the rigger). The
  hatchling/whelp manifest entries stay `placeholder` until a rig assembly exists.

## In-game rig runtime (src/render)

- `RigPlayer.ts` consumes a rig.json and builds the character ONCE: outer container
  (scene placement + facing) → inner container (animation root transform) → flat
  z-ordered layer Images whose origin = the resolved pivot. Animating writes only
  `.rotation` on a few sprites + the inner container's `y`/`scale` — GPU-batched,
  zero per-frame allocation.
- Adaptive resolution lives in `rigAnimations.ts` (pure, unit-tested): every part
  resolves anchor → pin-chain → bare-layer → skip — the SAME order as the animator
  tool. Reuse these functions when adding game animations; don't re-derive the order.
- Mirroring for right-facing = `RigPlayer.setFacing('right')` →
  `container.scaleX = -1` (single flip; pivots/rotations flip with it). Source art
  is iso 3/4 facing LEFT.
- Board reuse: `RigPlayer.bake(scene, key)` flattens the rest pose to one texture so
  many pooled generators cost nothing; keep live RigPlayers for featured instances
  only (title screen, hatch close-up).
- Wired live (lazy + fallback) on the TitleScene from
  `sprites/characters/dragon/red-dragon/rig/dragon-red.rig.json`; if absent, the egg
  art remains. Keep the Play button at its position (e2e taps it).

## World building pipeline (tools/worldbuilder)

- `tools/worldbuilder/index.html` — standalone browser app (open directly, zero
  deps). Infinite isometric canvas matching the game projection (TILE_W×TILE_H,
  2:1); pan (drag/space/alt), wheel zoom, Fit, grid toggle.
- Two asset categories switched by sidebar tabs: **tiles** (floor, one per cell,
  anchor default 0.5/0.5) and **decor** (stack many per cell, anchor default
  0.5/0 — top-centred). Paint / Select / Erase tools.
- The Calibration panel edits the SELECTED asset's offsetX/offsetY/scale/anchor and
  live-previews every instance — this is how you find the exact per-PNG nudge. The
  export's `assets[].calibration` is that table; drop offsetX/offsetY into placement
  and `anchor` into anchors.json.
- Export world.json: tile size, bounds, per-asset calibration, all placements
  (asset/category/col/row/z), embedded PNGs. Save/Load project round-trips everything.
- Presets for the real tile set: grid defaults to 240×120 (the border-grass
  grass-diamond footprint) and the 16 `border-grass/` blocks auto-load on open
  (⤓ Starter assets re-loads them) with per-tile measured anchorY (~0.24 tall edge
  blocks 1-8, ~0.30-0.35 short blocks 9-16). At the game's 256-wide grid these tiles
  need scale ≈ 1.067.
- **Blockers** (☁ tab): the normalised 1-tile cloud
  (`level-blocker/cloud/cloud-tile.png`, 256×174, anchor 0.5/0.62) auto-loads there.
  Every placed cloud is stamped with the toolbar's **Level** number (color-coded
  badge per level); a selected cloud's level is editable in the inspector. Export
  adds `placements[].level` and a `levels` map ({ L: { count, cells:[{col,row}] } })
  — exactly which cells unfog per level. Cloud master crop is `cloud-cropped.png`
  (882×599).
- **Camera keyframes per level** (🎥 panel): frame the view, Set a keyframe per
  level. Stored as focal WORLD point + zoom (window-size independent); export adds
  `cameraKeyframes[] = { level, focus:{col,row}, world:{x,y}, zoom }`. Go / ▶ Preview
  tour glide with the same smootherstep + mid-dolly the game plays on level unlock.
  Keyframes persist in the auto-save and draw as on-canvas reticles.
- **Merge asset library** (🔮 Merge tab): the catalogue of every game element
  (`MERGE_SLOTS`: the 9 chain tiers + nest + brazier), each pre-labelled with a
  generated placeholder. NOT painted on the map — ⤒ Replace swaps any slot for your
  own PNG, ↺ reverts. Custom art persists in the auto-save and exports as
  `mergeAssets[] = { key, label, chain, tier, custom, file, image }` (image embedded
  only for replaced slots).

## Authored map pipeline (world-builder export → live game)

- `scripts/ingest-world.mjs <export.json>` → `src/data/world-map.json`: a clean,
  normalised intermediate (min cell → 0,0) with `playable`, per-level `playZones`
  (no-cloud = L1; a cloud tagged level N gates zone N), `fogRegions`, per-cell
  `tilesByCell` + `calibration`, and normalised `cameraKeyframes`.
- `scripts/build-gamemap.mjs` → `src/data/map.json`: the map the ENGINE runs. Adds
  per-level regions (`level_1` active; `level_2..4` `unlock.level`, each seeded with
  a starter merge cluster near its focal cell), re-anchors the hand-authored
  tutorial start items into the L1 zone by **+1,+4** (centring on the L1 camera
  focus 4,7), and carves `level_2_gate` — the dozen level-2 clouds nearest the
  start — as the tutorial's key-unlock lesson (`unlock {keys, level:2}`), holding
  its 3 eggs + nest. EVERY fogged cell is therefore an authored cloud; the script
  asserts this.
- `MapData` carries `tile/playable/tilesByCell/calibration/cameraKeyframes`.
  `unlock` is `{ keys? | level? }`: KEY regions lift on tapping with a Gold Key,
  LEVEL regions lift free in `UnlockSystem` on `keeper:leveled`.
- Clouds in the game are ONLY these authored level-blocker cells — nothing is
  invented. `createFogSprite` paints the real `cloud_tile` (anchor 0.5/0.62). The
  isle silhouette = the `playable` set; the border-grass edges ARE the cliffs.
- XP pacing rationale: `docs/research/xp-pacing.md`.

## Art sourcing

- Screaming Brain (CC0) PNGs use magenta colour-keying with NO alpha channel —
  de-key to RGBA before wiring into assets.json (see `assets/raw/screamingbrain`).
- Every file added under `assets/raw/` gets a line in `assets/CREDITS.md`.
