# Content pipelines — tools, world authoring, rigs (reference)

Moved out of CLAUDE.md to keep it lean. Read the relevant section BEFORE using the
authoring tools or touching the map/rig pipelines. `docs/ripple-map.md` has the
cross-file invariants these pipelines participate in.

## Dev server: what is watched, what the build writes

The repo root is not just the game. Beside `src/` sit `assets/raw` (2.2 GB of
generation workspace), `embergames/` (the hub — a Next.js app with its own dev
server and its own `public/games/emberkeep` copy of `dist`), `path-of-embers/`,
`dist/` and `.claude/worktrees/`. Vite's default watch-ignore list is only
`.git`, `node_modules`, `test-results` and the outDir, so everything else used
to be watched recursively through fsevents — and any *second* writer in the tree
(the hub's `next dev`, `pnpm sync:game`, an art-generation run, an agent
worktree) made every write invalidate a module or force a full reload, which
Rolldown then answered by rebundling on every core, indefinitely. That is the
runaway that pinned 16 threads and dirtied gigabytes of disk in half an hour.

Three things now make it structurally impossible, all in `vite.config.ts`:

- **`server.watch.ignored` is an allow-list** (`watchIgnored`): only `src/`,
  `assets/`, `tools/`, `scripts/` and root-level files are watched, minus
  `assets/raw`, `assets/map`, `assets/position-reference`, `__pycache__` and
  `.work`. Anything new at the repo root is ignored until it is named there —
  add a directory only if the running game is built from it. Ignoring a path
  does NOT stop it being served: publicDir files are read per request, so
  `/raw/...` still resolves in dev. It only means no auto-reload, which is why
  the island generator (writes into `assets/raw/map-gen/islands/`) and the
  worldbuilder's uploaded art no longer bounce the page mid-generation.
- **`server.strictPort: true`** — a second `pnpm dev` fails instead of quietly
  taking 5174 with a second recursive watcher over the same multi-GB tree.
- **`watchGuard`** — a circuit breaker on the watcher: any single directory
  firing ≥150 events in 5 s is unwatched (dev keeps working everywhere else);
  ≥400 events across the tree stops the watcher entirely. Both log loudly. If
  you see `[watch-guard]`, find the writer before restarting.

Build side: `build.copyPublicDir` is **off** and `copyRuntimeArt` does the
publicDir copy through a ship/skip filter (source-only dirs, `sprites/*.png`
that have a `.webp` sibling, and everything in `vfx-bank/` outside the runtime
keep-set). It used to copy all 2.8 GB into `dist` and delete 1.3 GB of it again;
now that 1.3 GB is never written. Same `dist` contents as before, half the disk
churn — verify with `find dist -type f | sort` if you change the filter.

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

## New dragon breeds and skins (`dragonbreed.py`)

Every shipped breed — red, emerald, golden, and golden's `sprite-sunset` skin —
is the SAME rig with different pixels: same layer names, same z order, same
`bounds`, same anchors, same pins. So a new breed is not a new character, it is
a new set of part images that must drop onto an existing rig without moving
anything. `.claude/skills/nano-banana/scripts/dragonbreed.py` is that trip:

```sh
D=.claude/skills/nano-banana/scripts/dragonbreed.py
python3 $D assets/raw/dragons/<id>/brief.json            # prepare→prompt→generate→slice
python3 $D … --only prompt      # read/edit the prompt before spending anything
python3 $D … --stage young --from emerald --job sheet    # source breed / route
```

- **prepare** lays every layer of the source rig on one magenta sheet, a
  `cols × rows` grid, one part per cell, each part's OWN canvas contain-fit into
  its cell. Placement is recorded as FRACTIONS of the sheet, so slicing is exact
  whatever resolution the model returns. `<stage>-parts-map.png` is the labelled
  human map — never sent to the model, because drawn labels get repainted into
  the cells.
- **prompt** composes the stage prompt from the brief plus the manifest. The
  cell→part list goes IN the prompt; the model is told what is where instead of
  guessing. Young and adult get different stage clauses, and the anatomy clause
  is fixed: this rig is a LEGGED dragon (head, body+tail, two wings, two arms,
  two legs), never a wyvern or a serpent.
- **generate** is `artgen.py sheet-pro` — Nano Banana Pro at 4K/16:9. Layout
  obedience is the whole job here and Pro is the route that holds a stated
  structure; NB2 drifts toward a house style.
- **slice** cuts each cell on its fractional rect, resizes to the layer's exact
  canvas, de-keys on the sheet's MEASURED key (it came back `#F20DF0`, never
  `#FF00FF`), then registers the new content to the old content's alpha bbox —
  uniform scale + translate, clamped to ±15%, and every correction is printed
  and written to `<stage>-registration.json`. A big correction is a bad
  generation, not a bad crop, so it is reported rather than quietly applied.
- The **rig.json** it writes is the source rig with `file` repointed,
  `character` renamed and **`images` re-embedded**. That last part is not
  optional: `RigPlayer.preload` loads textures from `rig.images[layer.file]`, so
  a rig carrying the old breed's base64 renders the old breed no matter what is
  on disk.
- `<stage>-assembled.png` composites the new parts through the rig's own layer
  offsets — the rest pose as `RigPlayer` would build it. **Check that, not the
  sheet.** A part drawn at the wrong size shows up there as a limb that no
  longer meets the body, and nothing in the sheet would have told you.

### BREED vs SKIN — the `skin_of` switch

The brief's `skin_of` field decides both the prompt and the registration, and
they have to move together.

**A SKIN** (`"skin_of": "red"`) is surface only. The outline is locked edge for
edge, registration stays on the alpha bbox, and the output lands INSIDE the base
breed's folder as `sprite-<id>` / `sprite-adult-<id>` / `rig-<id>` /
`rig-adult-<id>` — the convention golden's `sprite-sunset` already set, keeping
the base part file names and differing only by folder, `character` and pixels.

**A BREED** (no `skin_of`; `silhouette` then required, and the script refuses the
brief without it) is allowed to change its outline, because otherwise it ships as
a recolour — the same failure the first house-skin set had. What a shared rig
actually pins down is NOT the outline:

- a part's pivot is a pixel inside its own canvas (`childLocal` on the rig's
  anchor for that layer, which `childOriginNorm` turns into a Phaser origin);
- the tail's deform pins are pixels along the tail.

So the skeleton's position inside the canvas is load-bearing and the outer edge
is not. The prompt hands over exactly that licence: **free** — horns, crest,
frill, ears, back and tail spines, wing trailing edge and scalloping, claw shape,
tail tip, and any fur/moss/feathering sitting on top; **locked** — skull, neck,
limb bones, wing bones, tail centreline, and every cut edge (neck stump, shoulder
end of an arm or wing, hip end of a leg), which is the joint itself.

A body plan the rig does not have — a wyvern, a serpent, four wings — is NOT
reachable this way. That needs a new rig authored in `tools/rigger`.

**Registration has to change with it.** A bbox match reads a new pair of horns as
"the part moved up" and shoves the whole head down. Free mode instead:

1. takes scale from the ratio of ERODED areas (`_core`, a `MinFilter` that
   deletes horns, spines, whiskers and membrane scallops but keeps the skull and
   the limb bones), and
2. takes translation from an IoU search over a window centred on that part's own
   `childLocal` — landing the SOCKET, and letting the far end of the part be a
   different shape.

**A free silhouette needs a bigger canvas, and the rig has to be told.** Part
canvases are trimmed to the art that was on them — every shipped adult part has
zero alpha on its border — so a breed that grows horns, moss or wing streamers
paints them past the canvas and the crop shears them into a straight edge (it
showed up as a rectangular notch on the storm adult's chest). The paint is not
lost: it is sitting in the cell's own margin. So `prepare` records, per part, how
far the crop may reach without hitting the neighbour (`pad`, capped at
`PAD_MAX`), `slice` crops that wider rect onto a canvas grown by the same amount,
and `pad_rig` moves every number that was measured in that canvas —
`anchors[].childLocal` and its `childOriginNorm` (which is what Phaser's
`setOrigin` gets), `parentLocal` on the parent side, and each `pins[].local` /
`.norm`. Layer `x` moves by `-pad` and each local point by `+pad`, so
`anchors[].rig` and `pins[].rig` come out unchanged — that invariance is the
proof the edit is a no-op for everything except the recovered pixels. `bounds` is
recomputed as the union of the layer rects (which is what it already was on every
shipped rig). Skip it and the head rotates around a point inside its own jaw.

`dragonroster.py` renders every dragon rig on disk as one contact sheet —
assembled colour on top, pure black silhouette underneath. The silhouette row is
the acceptance test for a new breed: filled solid at board size, can you still
name them apart? Skins must be indistinguishable from their base there; breeds
must not be.

`personality` is its own block, and it is deliberately constrained to the eye and
brow, the set of the mouth, how the crest/ears/spines sit, and the wear on the
body — never the pose, which the sheet fixes. `PERSPECTIVE` is always sent: same
three-quarter view, same foreshortening, same tilt, same light. A part drawn from
its own camera cannot be assembled with the others.

**The keyline is drawn by the pipeline** (`--only outline`, after `slice`),
following one rule: outline everywhere EXCEPT at the joints. Each anchor's
`childLocal` (the socket in the child's canvas) and `parentLocal` (the same point
on the body) mark discs where the keyline fades out and a few pixels of alpha are
trimmed, so the model's own painted rim cannot draw a collar across the assembled
dragon's neck or a ring at each shoulder. Everywhere else the rim darkens toward
`PALETTE.night`. Not idempotent — run `slice,outline,bake` together.

Two rules learned the expensive way, both now baked into the prompt template:

1. **Never ask for an outline around a part.** Asked for "a subtle dark outline
   around each part", the model outlines every cell as a standalone icon, and
   the head's outline then draws a black seam straight across the assembled
   dragon's neck. The `EDGES` block forbids outlines and specifically forbids
   closing off cut edges (neck stump, shoulder end of an arm, hip end of a leg).
2. **A skin is the same call with a thinner brief.** Leave the anatomy fields
   out and change only `scales`/`palette`; the contract does the rest.

The pipeline stops at rig-ready plus an optional `bake` step: nothing is
registered in `assets.json`/`chains.json`, and no blink/talk head banks are
produced. `bake` flattens the rest pose into the single texture the board draws
(a merge item is a pooled sprite, so `item_ember_dragon_3/4` and
`item_emerald_3/4` are composites on disk) — it reproduces the shipped bakes byte
for byte, which is what makes a dragon skin visible on the board at all.

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
- **Making a bank for a new dragon**: `python3 scripts/make-face-frames.py <breed>
  <young|adult>` (or `--all`), then re-run `calibrate-faces.mjs`. Three things
  in it are load-bearing:
  - **Frame 0 is the rig's own head layer, copied verbatim.** Calibration
    derives the set's `textureScale`/`originX/Y` from frame 0 and then proves
    them against that same head, so with frame 0 BEING the head the proof is
    exact by construction — scale 1.0000, IoU 100%. It is also true to the
    animation: the blink's `open` and the roar's `closed` ARE the resting face.
  - **The other drawings are EDITS (`artgen.py edit`), never generations**, run
    on the head plate flattened onto its key. This is the same call the human
    blink frames make and for the same reason (see character-pipeline.md): a
    generation re-paints the subject and lands at its own proportions, so the
    frame will not composite over the face it replaces. Key per breed —
    magenta, except a violet dragon like Moonwhisker, which keys green.
  - **The talk bank gets a taller canvas** (`JAW_ROOM`, +45% of head height
    under the chin). A set carries its own scale/origin, so this is free, and
    without it a jaw swinging open is clipped by the head layer's own bounds.
    It is why the shipped red banks are 423×521 and 857×1079.
  Each returned frame is registered back by content-width scale + top-band
  (horn) centroid — the same maths calibration uses, immune to the eye and jaw
  changes that are the point of the frame. The script FAILS on >2% skull-width
  drift rather than shipping it: that is the model having re-framed, and the
  fix is `--redo` on that state, not a tolerance bump.
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
- Visual regression harness: `node tools/checks/facetest.mjs [outDir]` (needs
  `pnpm build && pnpm exec vite preview`) — spawns a live dragon, freezes one
  pose and screenshots base/blink/talk faces; the head must not move or resize.

## The dragon reveal card

- `scripts/gen-reveal-and-decor.py` (briefs + generation) →
  `scripts/cut-reveal-and-decor.py` (key → trim → webp). Both sets of art are
  re-rollable from those two commands; nothing about either was done by hand.
- Three parts, deliberately in three places: **RevealSystem** decides that a
  form is being seen for the first time and latches it in `stats`
  (`reveal:<chain>:<tier>`) — "once" is a fact about the SAVE, not the screen,
  so it survives a reload and a second dragon of the same breed. **UIScene**
  draws the card off the `dragon:revealed` fact. **AudioManager** roars off the
  same fact. None of the three knows about the others, and a headless run sees
  the fact and no card.
- `DRAGON_REVEAL` (Constants) is keyed by `<chain>:<tier>`, so a breed is ready
  the moment it is given a chain and needs no code to switch on. `golden_egg` is
  deliberately ABSENT: the Elder's awakening is the chapter's one irreversible
  story beat, already choreographed off `FINALE` in both scenes, and a card in
  front of it is exactly the teaser glimpse the finale exists to refuse. Her
  plates are drawn and registered and used by nothing.
- **The card never fights the tutorial.** A full-screen overlay thrown over a
  scripted beat eats the tap that beat is waiting for, so while the tutorial is
  running the reveal is QUEUED and plays on handover. UIScene seats the latch
  from `state.tutorialDone` at create, so a save resumed past the tutorial does
  not queue its first reveal for a handover that already happened.
- The plate is fitted on BOTH axes (`plateHeightFrac` AND `plateWidthFrac`).
  Mobile is portrait and up to 2.4× as tall as it is wide, so a height-only fit
  sends a wings-spread adult straight off both sides.
- The ROAR is synthesised like every other effect (`AudioManager.dragonRoar`):
  two detuned saws swept down through a filter that opens and shuts, the same
  pitch again through a soft clipper for the throat rasp, filtered breath over
  the top, and a slow tremolo for ragged lungs. That is the licence answer as
  well as the house style — nothing downloaded, so no attribution to carry and
  nothing to prune from `dist`, and no 200 KB file to wait on before the card
  can open.

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
  the key updates live — board and UI alike.
- **The Ember Emporium is the exception, deliberately.** Its chrome
  (`ui_shop_panel/card/card_hot/hero/price/tab/tab_on/plaque/wallet/close/ribbon/
  badge/burst`) is NOT in `UI_TEXTURE_PARAMS` and carries no themable rim/fill
  params. Those painters draw from `SHOP_INK` — values sampled off
  `assets/raw/shop-concept/generations/bakeoff-seedream-pro.png` — because the
  shop's whole design is that it LEAVES the board's cream-and-lava palette: a
  lit plum hall at night, milled gold frames, goods in pools of warm light, one
  cream plate per price. Exposing palette knobs on it is how it drifted back
  into looking like a recoloured Ledger the first time. Re-skin it by editing
  `SHOP_INK` and the painters, not through the UI Builder.
- **The Keeper's Store cards paint themselves** (`src/ui/StorePanel.ts` +
  `src/ui/foil.ts`) — no art file is involved in a card's plate, ribbon or
  sheen, so a new rarity or a new legendary costs nothing in the asset budget.
  `RARITY` decides the ribbon and whether the card is foiled; `FOIL` is the
  violet metal, the gold rim and the sweep timing. A `"hero": true` item takes
  the shelf's left half at full grid height with its key art bled to the edges,
  and the other cards fall into the two columns beside it.
  The sheen is a **TileSprite scrolling its own texture inside a fixed
  rectangle** — never a streak sprite sliding across a masked card. Phaser
  resolves geometry masks in world space and drops the transform of a nested
  container; a store card is three containers deep inside a panel that is itself
  scaled per device, so a mask drifts off the card on exactly the devices nobody
  tests on. The holo tile is a function of `(x + y) mod 256`, which is what makes
  it seamless in both axes, and one scroll of 256 texture units is exactly one
  pass at any card size. Sheen tweens are stopped on close and on rebuild: a
  tween left running on a hidden panel is a wake source `PowerGovernor` cannot
  see.
- Registered elements: `hud.energy/gold/keys/regen/gear/ledger/level/store/quests`,
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
- Regression harness: `node tools/checks/uibtest.mjs` (needs `pnpm dev`) — drives the
  tool UI end-to-end: connect → move/restyle/recolor → save → assert the JSON
  written → reload → assert persistence.

## World building pipeline (tools/worldbuilder)

- `tools/worldbuilder/index.html` — standalone browser app (open directly, zero
  deps). Infinite isometric canvas matching the game projection (TILE_W×TILE_H,
  2:1); pan (drag/space/alt), wheel zoom, Fit, grid toggle.
- 🧩 **Worlds & grids** is the page that mirrors the engine's `world → zone →
  tile` model (`docs/worlds-and-zones.md`). A project holds SEVERAL WORLDS, each
  a set of independently placed GRIDS. See "Multi-world authoring" below.
- Two asset categories switched by sidebar tabs: **tiles** (floor, one per cell,
  anchor default 0.5/0.5) and **decor** (stack many per cell, anchor default
  0.5/0 — top-centred). Paint / Select / Erase tools.
- 🧝 **Characters** is a catalogue tab, not an upload palette: the roster is
  Eleanor and Selyna, drawn with the game's own baked standee at the game's
  scale and feet anchor. Drag one onto the map — ONE per character — and she
  lands exactly where you let go: her `characters.json` position is a cell PLUS
  a free `dx`/`dy` in builder pixels, like decor, so she can stand on a terrace
  rim the lattice has no cell for instead of snapping to the nearest diamond
  centre. ✥ **Move** drags her freely; painting her card onto a cell re-centres
  her on it and clears the offset. The game rebases dx/dy by
  `TILE_W / map.tile.width` and takes her DRAWN y for depth, so a big offset
  still sorts correctly against scenery. The tab opens showing each of them
  where the running game currently stands her, offset included. See "Authored
  map pipeline" below for the two ways it reaches the game, and
  `scripts/bake-standee.py` for the art.
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
- **Merge design page** (🔮 Merge tab) — a full-page editor over the canvas that
  edits the REAL merge config (chains.json-shaped doc; bundled snapshot for
  offline use). Every chain renders as a combo strip — `group× input → outputs×
  output` per adjacent tier pair (group/outputs resolve tier.merge → chain.merge
  → mergeRule, same as MergeSystem) — with each element's current in-game art
  (thumbnails load from `assets/` when the tool is served from the repo; uploads
  and placeholders otherwise). Actions: **⤒ Art** uploads element art; **✎ Edit**
  opens the element editor (name/sell/xp/artScale/sellable, per-tier combo
  override, and the full generator config — produces chain+tier, cooldown,
  energy, passive, tappable — any element can be a generator, like the House);
  **＋ Add combo** appends the next tier (creating the input→output pair);
  **＋ New chain** starts a fresh chain at tier 1. Ship it with:
  - **⤒ Apply to game** → POST `/__worldbuilder/merge` on the vite dev server
    (`pnpm dev`): validates, then writes `src/data/chains.json`, decodes
    uploaded art into `assets/sprites/items/wb/`, and upserts
    `assets.json`/`anchors.json` (shared logic: `scripts/apply-merge.mjs`).
  - **⬇ Export merge.json** → `node scripts/ingest-merge.mjs <file>` does the
    same offline (`--dry-run` to validate only).
  Per-tier `artScale` is the data-driven sizing for uploaded art — the engine
  consults it after Constants' hand-tuned `ITEM_SCALE`
  (`BoardScene.tierArtScale`). The world export embeds the merge doc under
  `merge` (art only with **embed art**); `.worldproject.json` and the session
  auto-save round-trip it whole. Headless test: `node tools/checks/mergetest.mjs`.
- **Island generator** (🏝 Island tab) — a full-page editor that turns a drawn
  outline into a finished island backdrop. Upload a reference PNG to trace over
  (opacity slider), then draw with **Freehand** or **Polygon**; each closed ring
  is one island, so a satellite pad is just a second shape (give it `run` 2 in
  the shape list, or the 3-cell minimum rejects it). **What you draw is the
  DECK** — the paved top surface, not the whole island; the rock is added under
  it. ⚙ **Build island** POSTs to `/__worldbuilder/island` on the dev server,
  which runs `tools/mapmask/island.py`: the tile lattice is fitted inside each
  shape (most tiles first, then hugging the RIGHT rim, because the skirt is
  shallow on that side and slack there shows as bare rock), runs shorter than
  `min run` are shaved, and the rock curtain is hung straight down by the same
  border law `design.py` uses. The mask comes back as the blue-on-white diagram
  drawn over the canvas, with per-island tiles / longest row / how much of the
  drawing the whole tiles claimed / rim margins. ✨ **Generate** then renders it
  with Seedream 5.0 Pro (`artgen.py map-seedream`) into
  `assets/raw/map-gen/islands/`, optionally feeding the reference as a second
  style reference. The prompt box is prefilled from the proven map template —
  two-layer mask reading, decor law, palette/value law, orthographic camera —
  with **this island's real stone counts** substituted in; edit it and ↻ Reset
  restores the template. Any edit to shapes or lattice clears the preview and
  disables Generate, so a render always matches the mask on screen. Both steps
  need `pnpm dev` (that is where FAL_KEY and the python toolchain are); the
  session auto-save keeps the shapes and settings but not the images.

## Tutorial editor (📜 tab → src/data/tutorial.json)

The World Builder's 📜 Tutorial tab is the visual editor for the scripted
tutorials; the `tutorial-editor` skill (`.claude/skills/tutorial-editor/`) is
the same editor from the shell. Both go through ONE door, the dev server's
`/__tutorial` API (`tools/tutorial-api/server.ts`, mounted in `vite.config.ts`):

| route | does |
|---|---|
| `GET /__tutorial` | every script, main first — `{ scripts }` |
| `GET /__tutorial/context` | picker data: chains + tiers, speakers, regions, quests, ui targets, gate events, allow keys, effect kinds, item art |
| `PUT /__tutorial` | replace the file from `{ scripts }` |
| `POST /__tutorial/op` | one atomic edit (`add_step`, `update_step`, `move_step`, `reorder`, `add_script`, …) |
| `POST /__tutorial/validate` | shape check + `ftuecheck.py` |

The MODEL (`src/core/tutorialScripts.ts`): the file's `steps` are the main
script — `id: main`, trigger `start`, allowBase `nothing` — and `tutorials[]`
are mid-game scripts, each `{ id, title?, trigger, allowBase?, steps }`.
Triggers are all save-derivable (`step_done`, `tutorial_done`, `event`,
`quest_done`, `level`, `world`, `stat`); a mid-game script also waits for the
main one to finish, and only one script holds the board at a time. The
director keeps mid-game progress in stats (`tut:<id>:step|done|started`), so
it survives reload without a SAVE_VERSION bump; the main script keeps its
persisted `tutorialIndex` exactly as before.

Every write is validated BEFORE it lands (`validateTutorialData`: ids, trigger
references, gate shapes) and the unit suite holds the committed file to the
same rule. The per-beat laws (gate↔allow, bubble length, one verb) run over
every script's beats in `ftuecheck.py`; the XP tune and the `levelup` beat
remain the main script's alone.

Each card on the tab shows a beat's four facets — **Elements** (highlights,
hand, arrow, spawns, speaker), **Actions** (the gate as a sentence, then the
on-entry effects), **Dialogue**, **States** (the allow contract over its base,
held/opened panels, hand-back on the last beat). Editing is structured for the
common shapes (speaker, gate, allow, drag list) and raw JSON for the rest;
Save PUTs the file, Validate runs the audit. Inserting or reordering MAIN beats
still shifts every persisted `tutorialIndex` — bump `SAVE_VERSION`.

## Event Creator (⚡ tab → src/data/events.json)

The structured event system — every authored "when the player…, then…" moment
as an input → output block. `docs/event-creator.md` is the law (vocabularies,
lifecycle, nesting, what the validator refuses); the `event-creator` skill
(`.claude/skills/event-creator/`, `scripts/evt.py`) is the shell; the World
Builder's ⚡ Events tab is the visual editor. All three go through the dev
server's `/__events` API (`tools/events-api/server.ts`, mounted in
`vite.config.ts`): `GET /` (the tree), `GET /context` (pickers: bus facts +
payload keys, the property catalogue, speakers, panels, commands, chains,
quests, characters, regions, worlds, tutorial scripts), `PUT /`, `POST /op`
(`add_event | update_event | remove_event | move_event | reorder`), `POST
/validate`. Every write runs `validateEventsData` (`src/core/gameEvents.ts`)
first; the unit suite holds the committed file to the same rule.

At runtime `EventSystem` (`src/systems/EventSystem.ts`) is a scheduler of
intents: it subscribes to the facts the events name, reads properties through
`PropertyFacts`, and emits the owning systems' commands (`economy:add`,
`regard:add`, `board:spawn`, `event:say`, `event:prompt`, `ui:panel_open_requested`,
`tutorial:start_requested`, …). Its only state is `evt:<id>:*` and `flag:*` in
`stats`. UIScene plays `event:say` through the bubble and `event:prompt`
through `ChoicePrompt` (`src/ui/ChoicePrompt.ts`), both queued behind a running
tutorial script. `__emberkeep.fireEvent(id)` / `__emberkeep.events()` and
`render_game_to_text().events` are the dev bridge.

## Multi-world authoring (🧩 Worlds & grids → src/data/zones.json)

The builder is the authoring surface for everything `src/core/world.ts` can
express. Read `docs/worlds-and-zones.md` first — the model, not just the UI.

**The model, as the tool holds it.** `S.worlds` is the project; `S.assets` stays
ONE shared library, because art is not the property of a place. `S.placements`,
`S.tileW`, `S.cam` and friends are ACCESSORS onto the active world and its active
grid, so every existing call site became world/zone-aware without changing shape
— the same trick `GameState` uses. Every placement carries a `zone`; a project
saved before zones existed migrates to a single grid named `main` and reopens
pixel-identical.

**Per grid:** name, tile w×h (∠ angle), skew, rotation, world-pixel origin, and
the Keeper level its ground opens at. Rotation turns about the grid's own (0,0),
and the exporter pins the game-side `pivot` to that same point, so a grid turned
17° here is turned 17° there.

**Per world:** id, display name (shown on the travel veil), the Keeper level it
opens at, and its backdrop.

**Which grid is which.** The FIRST grid of a world is its REFERENCE: its tile
becomes `map.tile`, every other grid's `artScale` is measured against it, and its
cells are normalised through `gameOrigin` exactly as `scripts/ingest-world.mjs`
does — so its addresses are `map.json`'s, and the emitter and character exports
keep naming the cells they always did.

**Editing.** Paint lands on the ACTIVE grid only (gold outline on the canvas, and
"one tile per cell" is per grid since two grids share cell numbers freely).
Select / Erase / Move reach any grid, and a piece dragged with Move snaps on its
OWN grid. `Tab` cycles grids, `N` adds one, `Z` toggles the outlines.

**Export.** ⤒ Apply grids POSTs to `/__worldbuilder/zones`, which validates and
writes `src/data/zones.json`: unique ids, non-overlapping index blocks, cells
inside their matrix, an invertible basis. `?dryRun=1` validates without writing
(what `tools/checks/wbzonestest.mjs` uses). ⬇ Export writes the same file to
disk; ↺ Reload brings worlds the project does not have back OUT of the game, so
imported grids (Borealis, Roothold) can be edited here.

**Index blocks.** The reference grid holds block (0,0) with the map's extent;
every other grid is packed to its right with a one-cell gutter, deterministically,
so the addresses a save holds stay put across exports. The gutter must stay ≥1 —
it is what makes a ±1 step off a grid's edge land in a hole rather than on a
neighbouring slab (world.ts rule 3). `zoneLayout()` is the SINGLE definition of
this layout and is shared by the zones, emitter and character exports; splitting
it would anchor a brazier to a cell no grid owns.

**What still ships the old way.** `Export world.json` is unchanged in shape — it
carries the REFERENCE grid's placements, so `scripts/ingest-world.mjs` and
`map.json` are untouched by any of this. The full multi-world project rides
alongside it under `doc.project`, so a `.worldproject.json` round-trips whole.

Regression: `node tools/checks/wbzonestest.mjs` (needs `pnpm dev`).

## Authored map pipeline (world-builder export → live game)

- `scripts/ingest-world.mjs <export.json>` → `src/data/world-map.json`: a clean,
  normalised intermediate (min cell → 0,0 — over the WORLD's placements only;
  characters are passengers and never define the extent, or one dragged NW of
  the grid becomes the origin and shifts every other cell with her. The
  builder's `gameOrigin()` makes the same exclusion and the two must agree)
  with `playable`, per-level `playZones`
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
- **Where the named cast stand** is authored in the same tool, on the 🧝
  **Characters** tab, and lands in `src/data/characters.json` — not `map.json`
  (which is hand-tuned and never fully regenerated). Two routes, one
  implementation (`scripts/apply-characters.mjs`):
  - ⤒ **Apply to game** → `POST /__worldbuilder/characters` on the vite dev
    server. Instant; reload the game and she has moved.
  - ⬇ **Export world.json** → `ingest-world.mjs` (carries `characters` through,
    normalised) → `node scripts/apply-characters.mjs`.
  Only her POSITION moves — `anchor` (cell) and `dx`/`dy` (free nudge, builder
  pixels, omitted when centred). `action` / `cooldownMs` / `world` are design
  data and a placement tool must never be able to retune a cooldown from a drag.
  The palette shows the game's OWN baked standee at the game's scale and feet
  anchor, wherever you drop it — what you see placed is what gets drawn.

## World-character standees (scripts/bake-standee.py)

Eleanor and Selyna stand ON the map with two 8-frame banks: `idle` (loops) and
`cast` (one shot, on `character:action_used`). The authored cells are painted
independently, so the raw art **drifts** — Eleanor's idle slid 14 px left and
7 px up across its eight frames, which reads as her skating across the tile, and
the cast bank came back 6% smaller than the idle so the swap popped.

`python3 scripts/bake-standee.py <id> [--qc]` fixes both, and its header is the
full argument. In short:

- Registration is on her **FEET** — the bottom ~14% of the silhouette, below
  anything the spell FX ever reaches — not on the frame's alpha box. A per-frame
  alpha box moves with whatever the frame contains, so a raised arm or an ember
  bolt would drag her body sideways; feet are the one thing that must not move.
- Every frame of BOTH banks registers against ONE reference (idle frame 0), which
  is what makes the banks interchangeable mid-stance. Each bank also gets one
  uniform size correction, measured on the columns behind her feet (her back and
  cloak — the part both banks draw identically; her front carries the staff and
  the staff is posed differently per bank).
- The output frame box is the union of all 16 registered frames plus `OUT_PAD` of
  transparent margin, so **no frame's content is ever flush against an edge** — a
  truly tight box slices the soft falloff of the scepter glow square and it reads
  as clipped. Padding moves her on screen by ZERO (anchor and `body` are stored
  relative to the box; `scale` comes from body height), so re-bake freely. That
  box is asymmetric (the bolt reaches far left), so the bake also emits a **feet
  anchor**, and BoardScene sets the sprite origin from it instead of (0.5, 1).
- A source frame can arrive already TRUNCATED by its own canvas, which no box can
  undo — Eleanor's `cast[5]` had 123 rows of fully opaque ember bolt against x=0.
  `feather_cut_edges` detects that (a long, high-alpha run, which a glow's falloff
  never is) and ramps it out, so the bolt fades instead of hitting a wall. Never
  the bottom edge: that is her ground contact and is meant to touch. Re-generate
  the bank if you want the bolt's real tail back — the pixels do not exist.
- Writes `assets/sprites/<id>/world-{idle,cast}.{webp,png}`, `world-standee.png`
  (the still, also `char_<id>`'s art and the World Builder palette card),
  `world-standee.json`, a copy under `tools/worldbuilder/characters/` for the
  DEPLOYED builder, and with `--qc` a contact sheet with the anchor crosshair
  burnt in at `assets/sprites/characters/<id>/world-standee/qc-registration.png`.
- Paste the printed JSON block into `STANDEE_BANKS` (`src/core/Constants.ts`) —
  frame size, anchor, body box and `scale` all come from the bake.

## Island extraction (scripts/island-extract.py) — backdrop → cut-outs + plate

Splits a finished map backdrop into per-island RGBA cut-outs plus the
environment behind them, all at the master's native 2610×1632.

```
python3 scripts/island-extract.py assets/sprites/background/emberkeep.jpg --sever 25
python3 scripts/island-extract.py a.webp b.webp --no-plate      # cut-outs only, no API spend
```

Four separation methods were benchmarked on emberkeep + runevault
(`assets/raw/map-gen/layered/_hires-test*/`). The winner, and what the script does:

1. **BiRefNet v2 `General Use (Dynamic)` @2304** → a foreground mask at the
   native resolution. That model string matters twice: `2304x2304` is rejected
   for every other model, and the `Matting` variant ghosts hard-edged rock
   (built for hair/fur — 45 % coverage, 12 % partial alpha). The mask is
   **cached**, so retuning the local steps costs nothing.
2. **Local labelling** → one layer per island. `--sever R` seeds markers from a
   heavier opening and gives every pixel to its nearest marker (the same trick
   `tools/mapmask/trace.py` uses), which is required here because the gold
   chains bridge every island into one blob. Hole-filling is bounded by
   `--max-hole`: an unbounded fill swallows the sky enclosed by the island ring.
3. **Alpha transfer** → the cut-outs carry the ORIGINAL master pixels. Verified
   pixel-exact: 0 channel difference across 2.65 M opaque px.
4. **Bria Eraser** on the dilated union → the plate. Skipped with `--no-plate`.

`manifest.json` records each part's `offset`/`size` on the full canvas, so the
pieces composite straight back or drop into the 🏝 island generator as elements.

Two limits worth knowing. BiRefNet detects *salient foreground*, not "islands" —
it works on these maps because the islands are the subject, and it will need
supervision on a zone whose environment competes. And the plate goes soft when
the foreground dominates: runevault erases 51 % and inpaints seamlessly,
emberkeep erases 71 % and returns low-frequency mush in the middle, so the
script warns past `PLATE_LIMIT` (60 %) — treat that output as a base to paint
over, not a finished sky.

Rejected: Qwen-Image-Layered (the only semantic *stack*, but hard-capped at
800×512 and recompositing at 19–28 dB — it repaints rather than mattes) and
EVF-SAM (ragged edges, holes, 29 % coverage). Qwen's one real edge is splitting
things that OVERLAP, e.g. a brazier standing on a deck; disconnected islands are
recovered locally for free. Cost is ≈$0.04/backdrop, all of it the eraser.

## Mask Studio (tools/maskstudio) — hand-drawn masks + perspective tile grids

`tools/maskstudio/index.html` — standalone browser app (open the file directly or
`http://localhost:5173/tools/maskstudio/index.html`, zero build). The hand
counterpart to `tools/mapmask/`: where those scripts *derive* a silhouette and a
lattice from the backdrop, this one lets you author both by eye over any image.

- **Geometry lives in source-image pixels**, so the export is a 1:1 render and
  the viewport is only ever a view transform (wheel zooms at the cursor,
  space/right-drag pans, `F` fits). With no image you get a blank canvas at a
  size you pick.
- **Pen** drops mask points one click at a time; the first point (or `Enter`)
  closes the ring. **Edit** drags points, inserts one by clicking a segment and
  removes one with Alt-click, or drags the whole shape. Shapes stack in order,
  each `add` (white) or `sub` (black), so holes are just a subtract on top;
  `smooth` runs a spline through the points instead of straight edges.
- **Grids** are projective quads: drag the four corner squares and the lattice
  follows, because a homography maps the unit square onto them and still sends
  grid lines to straight segments. Corner-dragging is the truth, so the
  scale/rotate/perspective sliders are *relative* nudges that spring back to
  centre. `Isometric` snaps the quad to the 2:1 diamond this project's boards use.
- **Tiles**: in Grid mode a click toggles a tile and click-hold paints a run —
  the stroke is interpolated between pointer events so a fast drag never skips a
  cell — Alt-drag erases. Cell hit-testing inverts the homography, so it stays
  exact under perspective. Multiple grids coexist; clicking inside an unselected
  one selects it.
- **Export** is the mask at source resolution: white inside, black outside,
  `Invert` flipping the two, with the grids drawn over it in blue (lattice +
  filled active tiles, or active tiles only). `Export tiles .json` writes the
  quads and active cell coordinates instead, and `Save .json` stores the whole
  project — the source image rides along as its own bytes, so it reopens whole.

## FX Studio (tools/fxstudio) — merge FX + VFX textures

- `tools/fxstudio/index.html` — standalone browser app (open the file directly,
  zero build). Authors the spawn (`appear`) and `merge` FX for every merge
  element, previews both live, and exports one self-describing `merge-fx.json`.
  One data-driven engine (`FX_PRESETS` + `EVENTS`) powers the preview AND the
  export, so what you see is what ships.
- **Textures** (🧪 toolbar button) — the authoring half of
  [`vfx-textures.md`](./vfx-textures.md), in four tabs:
  - *Library* — import pack PNGs, set a flipbook layout (`cols×rows@fps`),
    export any texture as PNG. First run bakes six starter textures.
  - *Generate* — 11 generators (glow, spark, star, ring, fBm, marble, smoke,
    flame, lightning, streak, **and `source`: an imported texture**) feeding a
    non-destructive technique chain that is the Krita workflow from the guide —
    multibrush symmetry, polar conversion, wrap-around seamless,
    duplicate+gaussian glow, morphological dissolve, levels — then a colour ramp.
  - *Preset* — bind a texture to an FX preset (also reachable from the ⚙ on any
    preset chip), pick blend / tint / flipbook mode.
  - *Sources* — the vetted free packs and generators, licence-badged.
- Pipeline is **mask first, colour last**: `generator → scalar field → technique
  chain → ramp → RGBA`. That is why one generator serves fire, magic and ice.
- A preset with `texture` set draws textured quads; with none it falls back to
  its vector `shape`, so the default look is unchanged until you bind one.
  Sheets with `frames > 1` play as flipbooks (`life` / `loop` / `random`).
- **Generated textures persist as their recipe**, not as base64 — a library
  costs a few KB of localStorage and is re-baked at boot. Only imported PNGs
  store bytes. `source`-generator textures rebake in dependency order.
- Export is `merge-fx.json` v2: adds `textures` (metadata + recipe) and
  `textureImages` (data URLs) next to the existing elements/presets/events.
  Nothing in the game consumes it yet — it is an authoring artefact.
- Regression harnesses (need a static server on 8820 from the repo root, e.g.
  `python3 -m http.server 8820`): `node tools/checks/fxtest.mjs` (elements, events,
  export), `node tools/checks/fxrigtest.mjs` (rigged-character preview),
  `node tools/checks/fxtextest.mjs` (texture layer — generators, techniques, flipbooks,
  persistence, export). They assert against page globals (`ELEMENTS`,
  `FX_PRESETS`, `S`, `stage`, `TEX`, `buildDoc`, …) — keep those stable.

## Motion-vector flipbooks (the VFX bank's real-time layer)

The bank's flipbooks ship with the two companions a real-time VFX pipeline
expects, so playback is interpolated rather than a slideshow.

- `python3 scripts/bake-vfx-mv.py [--only KEY] [--report] [--self-test]` writes,
  per sheet in `assets/vfx-bank/bank.json`:
  - `<key>_pack.png` — **R** density · **G** emissive · **B** erosion order ·
    **A** coverage. Carries NO colour.
  - `<key>_mv.png` — **RG** forward flow (frame i → next), **BA** backward flow
    (next → i), each `(px / mvScale) * 0.5 + 0.5`. Both live at cell i, so one
    fetch drives both warps.
  - Layout + `mvScale` land in `assets/vfx-bank/bank.mv.json`.
- `python3 scripts/bake-vfx-ramps.py` writes `ramps.png` (8 palette rows × 256)
  + `ramps.json`. Colour is looked up from density at DRAW time, so one smoke
  sheet serves ash / ember / toxic / arcane from a uniform instead of four
  coloured copies.
- Flow solver is pyramidal Horn-Schunck. Two traps, both guarded by
  `--self-test` (it recovers known translations and refuses to bake on failure):
  1. `alpha` is scale-sensitive — it competes with `Ix²+Iy²`, which is ~1e-2 on
     0..1 imagery. Use ~0.3, **not** the ~6 you would use on 0..255 data; the
     larger value drives the flow to zero.
  2. The pyramid must pre-warp A **toward** B (negative flow) before solving the
     residual. Warping by `+u` pushes away and the error compounds ~2× per level.
- **Frames are decimated on purpose.** With motion vectors, a quarter of the
  frames reconstructs better than half of them without — that is where the VRAM
  saving comes from, not from shrinking cells. Per-sheet limits live in
  `TUNING`; fast-flickering fire needs more frames than coherent smoke
  (`fb_flame_small` at 16 frames measured 2.3× better than cross-dissolve, at 32
  frames **4.3×** for the same bytes).
- Runtime: `src/render/flipbookShader.ts` (a `SinglePipeline` subclass — a
  `GameObjects.Shader` **cannot have a blend mode**, and ADD is mandatory for
  fire) + `src/render/FlipbookFX.ts` (the Game Object) +
  `src/render/flipbookTiming.ts` (pure frame maths, unit-tested in node).
  Playback is elapsed-time driven off an injected `now()` — wire it to
  GameClock — so the power governor can drop to 15fps without slowing effects.
- Proof/regression: `pnpm dev`, then `node tools/checks/fbtest.mjs [outDir]` renders
  every sheet twice at the same instant (cross-dissolve vs motion vectors),
  asserts they differ on-GPU, sweeps a loop for black frames, and checks runtime
  recolour. `tools/fbtest/index.html` is the page.

### Where they play in the game

`src/render/vfxBank.ts` is the whole placement layer — `SHIPPED` is the VRAM
budget, `BEATS` is the map from game moment to sheet/size/colour. BoardScene
calls one helper, `playBeatFX(beat, x, y)`:

| beat | sheet | ramp | size | fires from |
| --- | --- | --- | --- | --- |
| `hatch` | `fb_fireburst` | ember | 340 | egg-crack in `hatchSequence` |
| `elder` | `fb_fireburst` | gold | 520 | `awakenAltarElder` (the finale) |
| `merge` | `fb_dustburst` | smoke | 190 | `onMerged`, non-hatch merges only |
| `chest` | `fb_dustburst` | gold | 230 | `onChestClaimed` |

Rules that keep this safe to extend:
- **Additive, never a replacement.** Each call sits next to the existing
  `burst`/`sparks`/`shells` explode + `glowFlash`, matched to the same anchor
  point. Delete the bank and every beat still plays as it always did.
- **Degrades to nothing.** `playBeatFX` returns early if the textures are absent
  (the bank is pruned from `dist` except the shipped files) or if the power
  governor has dozed the scene.
- **`DEPTHS.particles`, not `DEPTHS.flash`** — the white glow must stay the
  brightest thing in the frame.
- Only two sheets ship (~6.8MB VRAM). All nine would be ~19.8MB, which the
  old-device budget will not wear. Widening `SHIPPED` automatically widens what
  `pruneDistArt` keeps — it parses that same array.
- Intensity is tuned against the **dark board**, not the fog: these are ADD
  blended, so anything over the near-white cloud tiles saturates. `merge` fires
  on every single merge and is deliberately the faintest of the set.
- Regression: `pnpm dev`, then `node tools/checks/vfxbeats.mjs [outDir]` fires each beat
  in the real game and asserts pipeline, blend mode, depth, ramp, self-destroy
  and doze-suppression. It detects the effect by **pipeline name**, not
  `constructor.name` — the production bundle mangles class and private-method
  names, so a name-based check silently passes as "not found".
- `packed` is a **reserved word in GLSL ES** — do not name a variable that.
- NOTE: `vite.config.ts` prunes `vfx-bank` wholesale from `dist`. Narrow that
  entry before shipping any bank texture, `_pack`/`_mv`/`ramps.png` included, or
  the deploy will 404 them.

## VFX bank (assets/vfx-bank) — 25 game-ready textures

- `node scripts/bake-vfx-bank.mjs --contact` bakes the whole bank from
  `assets/vfx-bank/bank.json`; `node tools/checks/vfxbanktest.mjs` verifies it (no
  server needed for either — the baker serves the repo itself).
- The baker drives the REAL FX Studio engine headless, so bank and tool can
  never drift. Edit the manifest and re-bake; never hand-edit a baked PNG.
- Sources are CC0 packs staged in `assets/raw/vfx-sources/` (Kenney, Unity Labs
  Paris, Screaming Brain) — see `assets/CREDITS.md`. Both that directory and
  `vfx-bank` are pruned from `dist` by `pruneDistArt` in `vite.config.ts`;
  **narrow that entry when bank textures get wired into `assets.json`.**
- Constraints the bank enforces (ADD-safe black borders, native flipbook cell
  aspect, per-pixel-only sheet grading): `docs/vfx-textures.md` §4b.

## Art sourcing

- Screaming Brain (CC0) PNGs use magenta colour-keying with NO alpha channel —
  de-key to RGBA before wiring into assets.json (see `assets/raw/screamingbrain`).
- Every file added under `assets/raw/` gets a line in `assets/CREDITS.md`.
- VFX/particle textures have their own rules (ADD-blend authoring, the 4096px
  ceiling, flipbooks vs the power governor) — see
  [`vfx-textures.md`](./vfx-textures.md).
