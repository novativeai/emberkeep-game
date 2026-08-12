Eleanor — 2.5D world standee (PLACEHOLDER for the 3D version)

She stands ON THE MAP, not on the merge board, and she never walks to what she
helps: she raises a scepter and works at a distance. That is what these two
sequences are for.

  eleanor_idle/   8 frames, 307x520, 12 fps, LOOPS
                  A breathing idle, deliberately almost motionless — the cells
                  differ by a few pixels of chest rise, braid drift and hem
                  sway, plus a slow pulse in the scepter crystal. If two frames
                  look nearly identical, that is correct.

  eleanor_cast/   8 frames, 381x520, 14 fps, ONE SHOT
                  rest -> spark -> raise -> full blaze -> the ember bolt leaves
                  the crystal toward the LEFT -> trailing sparks -> back to rest.

  eleanor-standee.webp   idle frame 0 — the AUTHORING master.

THESE FRAMES ARE THE SOURCE, NOT THE RUNTIME ART. They are raw generations and
they DRIFT — see below. Never copy one straight into `sprites/eleanor/`.

  python3 scripts/bake-standee.py eleanor --qc

is what produces the runtime art: it registers every frame of both banks onto
one reference by her FEET, corrects the size difference between the banks, and
bakes them into ONE padding-free frame box with an explicit feet anchor. It
writes `sprites/eleanor/world-idle.webp`, `world-cast.webp`, `world-standee.webp`
(the still `char_eleanor` points at), `world-standee.json`, the World Builder's
palette copy, and — with --qc — `qc-registration.png` beside this file, a contact
sheet with the anchor crosshair burnt in so drift is visible at a glance. Paste
the numbers it prints into STANDEE_BANKS in src/core/Constants.ts.

This whole folder (`sprites/characters/eleanor`) is stripped from dist by
`pruneDistArt` in vite.config.ts — it is the authoring/AE export tree, exactly
like the portrait and viseme sets beside it. Anything the game must LOAD has to
live under `sprites/eleanor/`.

Conventions
- She faces LEFT. The engine mirrors with a single container.scaleX = -1
  (see setFacing / rigAnimations.ts) — never re-author a right-facing set.
- Frames within a sequence share one canvas, but they are NOT co-registered —
  the bake is what registers them. Do not trim them individually either; a tight
  per-frame box moves with whatever the frame contains (a raised arm, a bolt of
  fire) and would drag her body sideways.
- The runtime sprite's origin is her FEET, from the bake's anchor — not (0.5, 1).
  The baked frame box is asymmetric because the cast's ember bolt reaches far to
  her left, so its bottom-centre is empty air.
- 520 px tall here bakes down to a 256-unit body at RES 2 (`--body-height`).

How these were made
  Seedream 5.0 Pro (`artgen.py character`), green-keyed, against
  eleanor/3d/eleanor-lowpoly-sheet.png as the character reference; one 2048x1152
  render per bank, laid out 4 cols x 2 rows of 512x576 cells.
  Seedream won a three-way bake-off against Nano Banana 2 at 2K and at 4K: it
  was the only route that drew her FACING LEFT and in a genuine elevated
  isometric 3/4 matching the 2:1 board. Both NB2 passes drew her front-on at eye
  level, and NB2-4K let the spell beam bleed across cell boundaries.

Known placeholder limits
- Independently painted cells drift — measured at 14 px horizontally and 7 px
  vertically across the idle, and the cast came back 6% smaller than the idle.
  The bake corrects both, so this is now a handled defect rather than a live one;
  a REGENERATION should still prefer holding one base plate and swapping only the
  changed region (scripts/composite.py, the technique in the nano-banana skill),
  because a registration can only fix rigid drift, not a redrawn earring.
- The cast sheet's frame-5 blaze still carries a little green from the key.
