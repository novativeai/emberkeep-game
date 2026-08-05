# Merge items — delivered art + integration rules

Handoff for **EMB-9**. Art is cut, keyed, sized and registered in `assets.json`.
`chains.json` does **not** reference these yet — that is EMB-16.

Full design rationale: `docs/merge-chains.md`. This file is only what you need
to wire them.

---

## 1. What shipped

15 transparent PNGs + `.webp` siblings in `assets/sprites/items/chains/`.
The `.webp` is what `assets.json` points at; the deploy step drops any `.png`
that has a `.webp` sibling (`vite.config.ts` → `prune-dist-art`), so keep both.

| Chain | T1 | T2 | T3 | Recipient |
|---|---|---|---|---|
| `emberberry` | Emberberry | Basket of Emberberries | **Emberberry Preserve** | dragons — fuel, quick |
| `resin` | Resin Bead | Resin Lump | **Hearth Cake** | dragons — fuel, slow |
| `ashmoss` | Moss Tuft | Moss Bundle | **Green Bale** | dragons — cooling |
| `quartz` | Quartz Pebble | Cut Crystal | **Crystal Ball** | ⚔ grit (T1) / Eleanor (T3) |
| `moonwater` | Dew Drop | Dew Vial | **Moonwater** | ⚔ drink (T1) / Eleanor (T3) |

| Asset key | File | px | webp |
|---|---|---|---|
| `item_emberberry_1` | `sprites/items/chains/emberberry_1.webp` | 318×273 | 20 KB |
| `item_emberberry_2` | `sprites/items/chains/emberberry_2.webp` | 505×442 | 57 KB |
| `item_emberberry_3` | `sprites/items/chains/emberberry_3.webp` | 505×585 | 59 KB |
| `item_resin_1` | `sprites/items/chains/resin_1.webp` | 498×574 | 30 KB |
| `item_resin_2` | `sprites/items/chains/resin_2.webp` | 720×762 | 65 KB |
| `item_resin_3` | `sprites/items/chains/resin_3.webp` | 515×452 | 66 KB |
| `item_ashmoss_1` | `sprites/items/chains/ashmoss_1.webp` | 281×192 | 20 KB |
| `item_ashmoss_2` | `sprites/items/chains/ashmoss_2.webp` | 328×277 | 29 KB |
| `item_ashmoss_3` | `sprites/items/chains/ashmoss_3.webp` | 467×407 | 62 KB |
| `item_quartz_1` | `sprites/items/chains/quartz_1.webp` | 333×321 | 17 KB |
| `item_quartz_2` | `sprites/items/chains/quartz_2.webp` | 388×474 | 37 KB |
| `item_quartz_3` | `sprites/items/chains/quartz_3.webp` | 428×543 | 47 KB |
| `item_moonwater_1` | `sprites/items/chains/moonwater_1.webp` | 407×300 | 25 KB |
| `item_moonwater_2` | `sprites/items/chains/moonwater_2.webp` | 245×433 | 23 KB |
| `item_moonwater_3` | `sprites/items/chains/moonwater_3.webp` | 432×571 | 47 KB |

612 KB total. All registered as `source: "file"`, `generator: "item"`.
Nothing loads them yet — 15 preloaded textures currently render nothing.

**Sizing:** art is native size; set on-board scale per tier via `ITEM_SCALE`
(`<chain>_<tier>` key) or the data-driven `tier.artScale`. Nothing is tuned yet.

---

## 2. Integration rules

### 2.1 Rules that already exist and still apply
- **3 adjacent → 1 next tier**, orthogonal flood-fill from the drop tile.
- **5 → 2** (`fiveBonus`).
- **`tier.merge = { group, outputs }`** overrides the rule for that tier's items
  and disables the 5-bonus for them.

### 2.2 New rules to implement
1. **Dragons never merge.** These five chains replace dragons as merge output.
   `hatchAtTier` no longer applies to companion dragons (EMB-17).
2. **Recipient-locked.** A dragon's meal cannot be spent on Eleanor and her
   materials cannot be fed to a dragon. Enforce at the delivery/feed call, not
   in the merge system.
3. **Nothing named touches the board.** Anything on the merge grid is anonymous
   and consumable. A named dragon must not be a `BoardItem`, or players will
   drag it and learn from the bounce that it is furniture.
4. **Feeding accepts every tier** — T1 snack (⅓ meal, 10% Book reveal),
   T2 meal (1 meal, small mood, 25%), T3 feast (1 meal + contentment, 60%).
   Tier 3 is an optimisation, never a gate.
5. **Contested chains — one grammar:** *tier 1 feeds the dragon, tier 3 serves
   the mage.* Applies to `quartz` and `moonwater` only.
6. **Tier 2 is directly collectable.** A producer drop is **tier 2 ~8% of the
   time** (weighted roll on `produces`); chest gifts and Trust-4 foraging can
   also yield tier 2. Each drop is worth 1.16 T1-equivalents.

### 2.3 These chains have no producers yet
All five are **Layer B (goods)**. They are fed by Layer-A producer chains that
do not exist yet — art is EMB-12, wiring is EMB-16. Until then every one of
these items is unreachable in-game. Do not ship them half-wired.

| Goods chain | Fed by | Rate |
|---|---|---|
| `emberberry` | Ripe Plant (`emberberry_plant` T3 — rename of shipped `strawberry`) | 1 / 30 s |
| `resin` | Firepine (`firepine` T3) | 1 / 90 s |
| `ashmoss` | a rekindled terrace, no producer item | 1 / 2 min |
| `quartz` | Cinder Vein (`cinder_vein` T3) + a Trust-2 dragon, 1/day each | 1 / 8 min |
| `moonwater` | Dew Basin (`dew_basin` T3), **night phase only** | 1 / 4 min |

### 2.4 Costs, for tuning
A tier 3 is **9 tier-1** by 3-merges, **8** with the 5-bonus.
Crystal Ball ≈ 55 min of active play; Moonwater ≈ 1 h 50 m. Food is deliberately
abundant (~139 berries/hr against a one-dragon appetite of ~51/hr) — the wall is
knowing *what* to cook, never gathering it.

---

## 3. Naming still open

`quartz` ends in a Crystal Ball and `moonwater` starts as plain dew — decide
whether a chain id names its raw material or its product **before** these ids
reach save data. Renaming after that needs a `SAVE_VERSION` bump.

---

## 4. If this art is ever regenerated

Two traps, both hit during production:

- **Ground shadows.** Prompting for an isometric footprint makes the model paint
  a diamond *in the key colour*. A distance-to-key threshold leaves grey ghosts,
  and raising tolerance eats the red berries. Key on **chroma family**
  (`min(r,b) − g` magenta, `g − max(r,b)` green) and key only blobs **connected
  to the image border**, so reflections inside crystals and glass survive.
  Better: drop the ground plane from the prompt — the engine draws its own.
- **Clear glass over a magenta key absorbs the key.** Moonwater came back pink
  and needed a full-subject de-spill. A green key avoids it, but then nothing in
  the subject may be green.

Source sheets and per-model comparisons: `assets/raw/merge-chains/`
(winners carry a `-winner` suffix — Seedream 5.0 Pro for four chains, resin
split T1–2 Nano Banana 2 / T3 Seedream Pro).
