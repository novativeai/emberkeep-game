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

## Head-animation face frames (blink / roar-talk)

- Pre-rendered head frame sets live in
  `assets/sprites/characters/dragon/<char>/head-animation/<set>/` — PNGs + a
  `frames.json` (per-frame durationMs, from the Sprite Studio export). Current
  sets for red-dragon: **blink** `[open, halfOpen, closed, halfOpen2]` (open ≈
  the rig's base head and is never worn; halfOpen2 is a byte-dup of halfOpen)
  and **talk** `[closed, half, wide, half]` (the roar/mouth-flap cycle).
- `scripts/calibrate-faces.mjs` → `src/data/faces.json` (GENERATED — never
  hand-edit). It aligns each set onto the rig's `head` layer by alpha-bbox +
  top-band (horn) centroid, emitting per-set `textureScale`/`originX/Y` so a
  worn frame has the EXACT content scale of the original head and the anchor
  pivot stays on the same content point. The script self-verifies: content
  width drift must be ≤0.5px and silhouette IoU ≥94%, else it throws. Re-run it
  whenever a set is re-exported, a new set/character is added (edit its
  `CHARACTERS` table), or the rig's head layer/anchor changes.
- Runtime: `src/render/faceAnimations.ts` (pure, unit-tested) picks the frame;
  `RigPlayer.attachFace()/playFace()` wear it. Selection precedence:
  scripted talk override → `pose.mouth` (jaw() records it; roar/stretch) →
  `pose.eyelid` (scheduled blink) → base texture. Rigs WITHOUT face sets
  (emerald) keep the old fallbacks untouched.
- Blink cadence is NOT a fixed period. `BlinkScheduler` (also in
  faceAnimations.ts) is a randomized, stateful clock: it fires a blink at a
  fresh random gap in a realistic range every time (`BLINK_GAP_CALM` 2.8–6.5s
  idle, `BLINK_GAP_EXCITED` 1.4–3.0s while celebrating/hovering), with a ~14%
  chance of a quick double-blink. RigPlayer owns ONE per rig (per-instance rng),
  so a crowd of dragons never blinks in unison, and injects its output into
  `pose.eyelid` — which BOTH the eyelid-layer path and the face-frame path read.
  It's suppressed while the mouth is open (no blinking mid-roar) and reset flat
  in `bake()`. Because it runs off the frame delta (not GameClock) it's purely
  cosmetic and doesn't touch `advanceTime` determinism.
- BoardScene wires beats: hatch intro roars (`playFace(2)`), passive-gift
  celebrate and rest-wake chirp (`playFace(1)`).
- Visual regression harness: `node tools/facetest.mjs [outDir]` (needs
  `pnpm build && pnpm exec vite preview`) — spawns a live dragon, freezes one
  pose and screenshots base/blink/talk faces; the head must not move or resize.

## UI Builder (tools/uibuilder) — live UI theming

- `tools/uibuilder/index.html` — satellite app for the game's UI: move elements,
  restyle text (font/size/color/stroke), tint/swap textures per layer, and
  recolor the generated ui_* chrome (buttons, pills, panels, cards, slots).
  Layout: center = THE RUNNING GAME embedded in an iframe with `?uiedit=1`
  (pixel-perfect by construction — it is not a mockup); left rail = elements
  tree, chrome/icon thumbnails (rendered live from the game's texture manager),
  Emberkeep palette, font presets; right floating panel = transform, layers
  (named parts), per-part text/image properties, chrome color styler.
- Data flow: the tool talks to the game over a `{__uib:true}` postMessage
  bridge (`src/ui/uiEdit.ts`, active only with `?uiedit=1`): live patches apply
  instantly through `uiRegistry` (`src/ui/theme.ts` + Phaser-free
  `themeCore.ts`). **Save** POSTs the pruned doc to the Vite dev endpoint
  `/__uibuilder/theme` (vite.config.ts), which writes
  `src/data/ui-theme.json` — GENERATED, never hand-edit. The game BUNDLES that
  file and applies it at element registration, so saved themes appear in dev,
  preview and production builds alike. Empty doc ⇒ pixel-identical authored UI.
- `?uiedit=1` boots `UiEditorScene` INSTEAD of the game — a document window in
  the Photoshop sense. BoardScene never starts, `ctx.beginRun()` is never
  called: no save load, no tutorial, no systems activity, no clock consumers.
  The scene merely CONSTRUCTS the UI components (inert — nothing emits) so they
  register for staging. Selecting a component shows it ALONE on the blank
  game-sized canvas; hidden components get sample content. Placement is
  WYSIWYG for tool-authored components: they sit at their authored x/y —
  exactly where they appear in-game — and dragging the component body (or
  arrow-nudging with no layer selected) edits that document position. Built-ins
  stage display-centered (their in-game spot is code-authored); their dx/dy
  offsets live in the Transform fields. The only motion on the
  canvas is component-owned art (rig layers previewing their body/face motion).
  The tool's "Game preview" button swaps the frame to a SEPARATE, fresh boot of
  the real game (with the saved theme) — editor and game never share a runtime.
- DRAG-DROP from the rail: any rail thumbnail (characters, uploads, sequences,
  chrome frames, icons) is draggable onto the canvas OR onto a LAYER ROW in the
  right panel (`layer:drop` — precise replace). A `#dropCatcher` overlay covers
  the iframe during a drag, converts the screen point to game coords (frameWrap
  transform, ×2 for RES) and posts `canvas:drop`. Routing in uiEdit.ts:
  · BUILT-IN element staged → the drop replaces the LAYER under the pointer
    (else the selected layer) and the stage NEVER switches: sequences attach as
    a `sequence` PART PATCH (animated by PartAnimator, contain-fit to the
    part's footprint — the bubble portrait becomes the talking Laurah);
    textures/uploads swap the part texture. Characters get a status note.
  · custom component staged → drop ON a layer replaces it keeping the slot AND
    on-screen footprint (explicit w/h carries over; otherwise the new art is
    contain-fit to the old display size); empty space ADDS at the drop point.
  · nothing staged → a component is auto-created at the drop point.
- LAYERS PANEL: rows are drop targets; custom rows DRAG-REORDER (the array is
  the z hierarchy — customUi.syncZOrder re-stacks the container, incl. async
  rig loads). Delete/Backspace removes the selected custom layer; on built-in
  parts it HIDES them (code-authored — the row's ✕/👁 toggles, Reset element
  restores). Animated parts show a gold ▶; the part editor's "Animate" select
  attaches/clears a sequence per image part.
- On the stage you edit LAYERS: click to select one (gold outline), drag it,
  arrow keys nudge (Shift ×10), Esc steps out. Drags have CENTRING SNAP
  (SNAP_RANGE in uiEdit.ts): the dragged bounds centre pulls onto the canvas
  centre lines — and, for custom layers, the component's own axes — showing a
  pink guide while locked; Alt bypasses. Nudges never snap. Components with self-owned
  layout declare `selfLaidOutParts` + a `relayout` hook so the registry never
  fights them — the layout consumes `partOffsetOf()` itself (see
  CharacterBubble). Numeric layout knobs (`paramsSpec`, e.g. bubble width/text
  width/min height) appear in the tool's Component section.
- The preview has a toggleable alignment GRID (checkbox + 32–256 spacing,
  drawn in game units with gold centre lines).
- SCALABLE FRAMES: image layers take explicit `w`/`h` (or per-axis
  `scaleX`/`scaleY`); chrome frames render as 9-SLICE (`UI_NINESLICE` corner
  insets in TextureFactory) so corners/borders stay crisp at any size — drag
  the gold corner handles on the stage to resize. "+ Frame/Image" adds a
  900×700 sliced ui_panel by default (the promo-popup case).
- PRELOADED (built-in) ANIMATIONS: `src/render/sequenceCatalog.ts` ships Laurah's
  talk banks (short/mid/long) — always in the Animations rail (★), no upload
  needed, drag-drop ready. They are FILE-backed (optimized frames under
  `assets/sprites/laurah/`, downscaled from the 1.4MB/frame AE source), so an
  `anim` layer referencing one costs NOTHING in the saved theme (frames aren't
  inlined). Each bank ENDS on one of the two idle poses (the last frame is an
  idle image, held); `loop:false` by default ⇒ talk plays once then rests on the
  idle. PreloadScene loads ALL built-ins in the editor (rail) but only the banks
  a saved component references in the game. `customUi.resolveSequence()` maps a
  sequence name → frame keys+timing from either `doc.sequences` (upload) or the
  catalog, and lazy-loads built-in frames on a cache miss.
- ANIMATION UPLOADS: "⬆ Folder" (Animations rail) ingests a PNG-SEQUENCE
  character bank — pick the folder of frames + its `frames.json`. The tool reads
  the JSON for frame order and exact per-frame `durationMs` (falls back to
  filename sort + 12fps), then posts `sequence:add`; the sequence lands in
  ui-theme.json's `sequences` (self-contained data-URL frames + timing). A
  1-frame folder with no JSON is treated as a plain static upload instead.
  Double-click a sequence to drop an `anim` LAYER onto the selected custom
  component — it plays LIVE on the canvas (CustomUiManager advances frames on the
  scene clock honouring each frame's hold; `fps`/`loop`/`w`/`h` are per-layer
  knobs). PreloadScene loads every sequence frame as its own texture
  (`sequenceFrameKey`) so exported animations play in dev, preview and prod.
  NOTE: full-res frames as data URLs are heavy — a 20-frame bank is tens of MB
  in ui-theme.json.
- UPLOADS & REPLACEMENT: "⬆ PNG" stores art as a data URL in ui-theme.json's
  `assets` (fully self-contained). Use it as any image layer's texture, or open
  a frame/icon's panel → "Replace with upload" to RE-SKIN a generated texture
  (hand cursor, arrow, icons, buttons…): the game repaints the SAME canvas
  texture in place (contain-fit) at boot (`applyUiReplacements`, PreloadScene)
  and live in the editor — same key, same objects, so in-game events can never
  break. `ui_hand`/`ui_arrow` replacements carry an anchor override (fingertip /
  tip) consumed by UIScene.
- Chrome recolors repaint the SAME canvas texture in place
  (`TextureFactory.regenerate` + `UI_TEXTURE_PARAMS`), so every Image wearing
  the key updates live — board and UI alike. The Ember Emporium's chrome
  (`ui_shop_panel/card/ribbon/badge/burst`, `ui_btn_price/free`) is painted the
  same way and equally themable.
- Registered elements: `hud.energy/gold/keys/regen/gear/ledger/level`,
  `dialogue.bubble/tooltip`, `panel.shop/ledger` — components register in their
  constructors (`uiRegistry.register`) with named parts; self-positioned
  elements (tooltip) consume `uiRegistry.offsetOf()` in their own layout.
- **Composer — NEW components**: "＋ New" creates a component authored entirely
  in the tool and stored in ui-theme.json's `custom` section; the game's
  `CustomUiManager` (src/ui/customUi.ts) instantiates it at boot in EVERY build,
  so the exported JSON is the runtime format itself. Layers: `image` (any
  texture/chrome, tintable), `text` (content + full style), and `rig` — a LIVE
  animated character from `src/render/characterCatalog.ts` with a BODY motion
  (idle, hover/low-flight, celebrate, roar, stretch, walk — the shared
  rigAnimations presets) and a FACE mode (none / blink = ambient scheduler /
  talk = perpetual mouth loop), plus facing + scale. Characters rail:
  double-click drops one into the selected component. Layer list supports
  reorder/delete; drags write the AUTHORED x/y (custom components have no
  patch/base split — the doc is the single source of truth).
- Embedding gotcha (fixed in uiEdit): same-origin iframes leak the parent
  page's mousedowns to window-level listeners — the bridge only accepts pointer
  events whose target is the game canvas (`isCanvasEvent`).
- Regression harness: `node tools/uibtest.mjs` (needs `pnpm dev`) — drives the
  tool UI end-to-end: connect → move/restyle/recolor → save → assert the JSON
  written → reload → assert persistence.

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
  (asset/category/col/row/z). LEAN by default — the `images` map keeps its keys
  but holds nulls (~tens of KB instead of ~30 MB), so ingest/LLM consumers can
  digest it whole. Tick **embed art** next to Export to inline base64 PNGs (only
  needed when handing NEW art to `scripts/extract-tiles.mjs`/`extract-decor.mjs`).
  Save/Load project (.worldproject.json) always embeds everything and remains the
  edit round-trip format.
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
