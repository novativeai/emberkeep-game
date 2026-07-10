# Art requests — Chapter One demo (remaining assets)

> **STATUS UPDATE:** items 1–3 are now DELIVERED as AI-generated art (Google
> Nano Banana Pro via `.claude/skills/nano-banana/` — prompts, de-key and
> sizing all reproducible; SynthID-watermarked). They are live in-game at the
> exact spec'd paths/sizes below. Treat them as high-quality stand-ins the art
> team may replace 1:1 (same path, same size) whenever hand-made art is ready.
> Item 4 (golden head frames) is now ALSO delivered — Sprite Studio grid
> template + Nano Banana Pro frames, calibrated at 97.5%/97.3% IoU. Item 5
> was RETIRED by the lore pivot (the egg awakens the adult Golden ELDER).
> Nothing remains open.

> Handoff spec for the art team. Every asset below has a live stand-in, so
> nothing blocks play — these are polish upgrades, listed by impact. All
> coordinates/sizes are in the game's hi-res space (the canvas renders at
> 2560×1600, so 1 game unit = 1 real pixel — deliver at the stated size or 2×
> for headroom). PNG with alpha everywhere. ✅ = already delivered & wired.
>
> **Palette** (Constants.ts is the source of truth):
> gold `#F7A437` · goldShade `#D9821F` · goldAccent `#FFD84D` ·
> lava `#E8503C` · lavaShade `#C73A2E` · plum `#4A3845` · plumShade `#3A2B38` ·
> cream `#FFF6E8` · night `#241B22` · textBrown `#B5602F`

---

## ✅ 0. Golden dragon rig — DELIVERED
`assets/sprites/characters/dragon/golden-dragon/rig-adult/golden-dragon.rig.json`
is live: the Golden Whelp wears it in the finale hatch and the encore.
Two optional follow-ups appear as items 4 and 5 below.

---

## ✅ 1. Chapter-Two teaser silhouettes (3) — DELIVERED (AI-generated)

**Where the player sees them:** the CHAPTER ONE COMPLETE card at the Level-3
finale — the single image most players screenshot/remember. Three dark cards
under "IN CHAPTER TWO…", currently showing a gold "?" placeholder each.

**The three subjects** (mystery must SURVIVE the art — silhouettes, not reveals):
1. `teaser_terrace` — the south terrace: a fogged floating isle with one warm
   light breaking through, maybe a shrine outline in the murk.
2. `teaser_breed` — a dragon shape no player has seen: unfamiliar horns/wing
   profile in silhouette, one glowing eye at most.
3. `teaser_flame` — "what TOOK the Great Flame": the most abstract of the
   three — e.g. a great claw/shadow closing around a dying flame.

**Spec:**
- Canvas: **680×520** (displayed at 340×260 in a rounded-rect slot, 30px
  corner radius — keep key shapes 20px inside the edges).
- The slot background is plumShade `#3A2B38` with a gold border; the art
  should be near-black silhouette (`night #241B22`) with **goldAccent
  `#FFD84D` rim-light** — the card's caption text (cream) sits in the bottom
  ~80px of the slot, so keep that band quiet.
- Destination: `assets/sprites/ui/chapter2/teaser_terrace.png`, `teaser_breed.png`, `teaser_flame.png`.

**Wiring on delivery (dev side):** 3 entries in `assets.json` + swapping the
"?" text for images in `EndScreen.buildChapterBody` — ~15 minutes.

---

## ✅ 2. South-terrace glimpse silhouettes (3) — DELIVERED (AI-generated)

**Where:** during the finale, the camera flies to the south terrace and the
ash-fog parts HALFWAY for 2.4 seconds. Today the player sees warm gold light
flood the clouds; with these, they'd glimpse *shapes* in that light.

**Subjects:** a dormant shrine (centrepiece) + up to two unfamiliar dragon
silhouettes flanking it. On screen ~2 seconds at ~35% fog opacity — these are
mood shapes, zero detail needed, and they must NOT clearly depict what the
Chapter-Two breed looks like (echo teaser 2's silhouette language).

**Spec:**
- Iso ¾ perspective matching the board (2:1 diamond ground plane, light from
  upper-left). Facing LEFT like all character art.
- Shrine: ~**380×450**; dragons: ~**240×260** each.
- Solid dark silhouette (plumShade→night gradient is fine) with a soft warm
  edge glow baked in OR left to us (we already composite an additive
  goldAccent glow behind them — flat silhouettes are fine).
- Destination: `assets/sprites/finale/glimpse_shrine.png`,
  `glimpse_dragon_a.png`, `glimpse_dragon_b.png`.

**Wiring on delivery:** small addition to `BoardScene.runFinale` — place the
sprites at the `level_5` region centroid under the dipped fog, fade them with
the glimpse timeline. ~30 minutes.

---

## ✅ 3. Keeper's Tasks button icon — DELIVERED (AI-generated)

**Where:** the round HUD button above the Ledger scroll (bottom-right),
currently a ⭐ emoji rendered as text — the only non-art icon in the HUD.

**Spec:**
- ~**200×200**, transparent PNG, reads at ~100×100 on the gold `ui_btn_round`
  disc (cream face, gold rim — same button the gear and scroll sit on).
- Motif suggestion: a gold star over a small checklist/scroll, or a wax-sealed
  task list — match the chunky, warm, outlined style of the existing scroll
  and key icons. Colors: gold/goldShade body, cream highlights, textBrown
  outline.
- Destination: `assets/sprites/ui/icon_tasks.png`.

**Wiring on delivery:** one `assets.json` entry + replacing the emoji Text in
`UIScene.buildTasksButton` with the image. ~10 minutes.

---

## ✅ 4. Golden dragon blink/talk head frames — DELIVERED (Sprite Studio + AI)

**Where:** the Golden Whelp currently animates body-only; the red dragon also
blinks and mouth-flaps via pre-rendered head frames. Same treatment for gold
would complete her.

**Spec (must match the red dragon's format exactly):**
- Two sets of PNGs derived from the RIGGED head layer
  (`golden-dragon-head.png`, 292×286) — same content scale, same orientation
  (facing LEFT), alpha-tight:
  - `blink/`: `[open, halfOpen, closed, halfOpen2]` (open ≈ the rig's base
    head; halfOpen2 may duplicate halfOpen).
  - `talk/`: `[closed, half, wide, half2]` (the roar/mouth-flap cycle).
- Each folder includes a `frames.json` with per-frame `durationMs` (copy the
  red dragon's as a template:
  `assets/sprites/characters/dragon/red-dragon/head-animation/`).
- Destination: `assets/sprites/characters/dragon/golden-dragon/head-animation/<set>/`.

**Wiring on delivery:** add golden to the `CHARACTERS` table in
`scripts/calibrate-faces.mjs` and re-run it (it self-verifies alignment), then
`node tools/facetest.mjs` for the visual regression. ~30 minutes.

---

## ❌ 5. RETIRED — baby whelp variant (lore pivot)

Lore decision (2026-07-10): the Golden Egg does not hatch a baby — it
**awakens the legendary GOLDEN ELDER**, an adult dragon asleep since the Great
Flame was taken. The delivered adult rig is therefore canonically correct and
no baby variant is needed. (She still never works — a legend does not haul
timber.) This item is closed.

---

## Format checklist (applies to everything)
- PNG with real alpha (no magenta keying needed for new art).
- Character-adjacent art faces **LEFT** (the game mirrors right-facing with a
  single flip).
- New files under `assets/raw/` need a `assets/CREDITS.md` line; these
  specs all target `assets/sprites/…` (original art, no credit line needed).
- Ping dev after dropping files — each item lists its exact wiring step, and
  everything degrades gracefully until then (missing art keeps the stand-in).
