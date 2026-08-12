Selyna — 2.5D world standee (PLACEHOLDER for the 3D version)

She stands ON THE MAP, not on the merge board, and she never walks to what she
helps: she raises a staff and works at a distance. That is what these two
sequences are for. Eleanor's scepter returns spent heat; Selyna's staff keeps —
so her light is cool moonstone white-and-rose where Eleanor's is ember.

  selyna_idle/   8 frames, 345x520, 12 fps, LOOPS
                 A breathing idle, deliberately almost motionless — the cells
                 differ by a few pixels of chest rise, hair drift and hem sway,
                 plus a slow pulse in the staff crystal. If two frames look
                 nearly identical, that is correct.

  selyna_cast/   8 frames, 436x520, 14 fps, ONE SHOT
                 rest -> spark -> lift -> staff raised and blazing -> full
                 starburst -> the bolt leaves the crystal toward the LEFT ->
                 trailing sparks, arm lowering -> back to rest.

The RUNTIME copies are baked, not copied:

  python3 scripts/bake-standee.py selyna --qc

which registers every frame of BOTH banks onto one reference (idle frame 0) by
the bottom band of the silhouette — her feet — and writes
`assets/sprites/selyna/world-{idle,cast}.webp` + `world-standee.{png,json}`.
Re-run it after regenerating anything here. `qc-registration.png` beside this
file is its contact sheet: every frame over the shared foot line and centre
line.

Conventions
- She faces LEFT. The engine mirrors with a single container.scaleX = -1
  (see setFacing / rigAnimations.ts) — never re-author a right-facing set.
- Frames within a sequence share ONE canvas and ONE crop box. Do not trim them
  individually: a tight per-frame box moves with whatever the frame happens to
  contain, so the raised arm and the bolt would drag her body sideways.
- 520 px tall = the 260 logical units the runtime standee expects at RES 2.
- This whole folder (`sprites/characters/selyna`) is the authoring tree and is
  stripped from dist by `pruneDistArt` in vite.config.ts, exactly like the
  portrait and viseme sets beside it. Anything the game LOADS lives under
  `assets/sprites/selyna/`.

How these were made
  Seedream 5.0 Pro (`artgen.py character`), ONE 2048x1152 render per bank laid
  out as a 4x2 grid of 512x576 cells, green-keyed, sliced geometrically. The
  same route as Eleanor's standee, and for the same reason: it is the only one
  that draws her FACING LEFT in a genuine elevated isometric 3/4 matching the
  2:1 board. References were her low-poly turnaround, her shipped merge portrait
  and Eleanor's idle frame 0 (as the style and camera target).

  Everything is reproducible from this repo:
    assets/raw/characters/selyna/prompts/world-standee.txt   the brief
    assets/raw/characters/selyna/world-standee-build.py      prompt -> frames
    assets/raw/characters/selyna/generations/                the raw renders
      standee-idle-v1  (shipped)   standee-cast-v4  (shipped)
      standee-cast-v1/v2/v3        superseded, see below

Keyed on green, not magenta — her whole palette is lavender and rose, which
`dekey.py`'s magenta de-spill desaturates. Two things `dekey.py` could not do,
so `world-standee-build.py` keys these sheets itself:

- UN-PREMULTIPLY. dekey.py keeps the observed colour and only derives alpha from
  it. A white glow at 30% coverage is observed as a green-white, so its de-spill
  crushes the green channel and the blaze frame ships a DARK GREY cloud instead
  of a soft white one. Solving C = aF + (1-a)K properly returns the glow white.
- SHADOW GATE. Some takes draw a ground shadow however often the brief forbids
  it, and a shadow is a *darker key*, not another colour — an absolute threshold
  scores it ~25% opaque and a grey lobe ships under her boots. Gating on
  greenness/brightness (a ratio the key and its own shadow share, and a glow
  does not) removes it without touching the figure's anti-aliased rim.

Also worth knowing: the key is MEASURED per sheet, never assumed. Asked for
#00FF00, Seedream paints a softer studio green — this pair came back near
(10, 209, 68), and solving against pure green leaves the whole background at
alpha 100.

Rejected cast takes, and why (all kept under raw/generations)
  v1  ground shadow in every cell; beats 5 and 6 collapsed into one cell, and
      the blaze swallowed her arm.
  v2  clean beats and no shadow, but the blaze was painted as an atmospheric
      haze, which keys into a ragged grey-green cloud.
  v3  crisp light, but the ground shadows came back and cell 5's starburst was
      clipped by the sheet edge.
  v4  shipped.

Known placeholder limits
- The cells are painted independently, so the raw frames drift: the idle by ~3px
  and the cast by ~19px in x / 13px in y, and the cast bank is drawn ~3.75%
  smaller than the idle bank. `bake-standee.py` measures and removes all of it —
  that is what it is for — but the authored frames in this folder are NOT
  pre-registered. Register through the bake, never by trimming.
- Cell 8 of the cast sheet draws her grip slightly clear of the shaft; at 520px
  it reads as the hand, but a regeneration could fix it.
- Her ear reads faintly pointed in some cells, which the turnaround does not.
