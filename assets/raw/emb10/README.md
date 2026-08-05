# EMB-10 drop — source art, and what was done with it

Downloaded from the board (`/api/tasks/t_7878ac88/files/<id>`). This folder is the
UNTOUCHED source; the game reads the trimmed copies in
`assets/sprites/items/chains/`.

## 1. What arrived

Two families, despite both hanging off EMB-10.

**A — Borealis merge chains (complete, T1→T3, already tight)**

| chain | T1 | T2 | T3 | reads as |
|---|---|---|---|---|
| `driftwood` | frozen plank | tied bundle | lit woodpile | fuel, bulk |
| `tarknot` | pitch stone | pressed briquette | molten glowing knot | fuel, concentrated |
| `rimebloom` | frost star on ice | cyan crystal cluster | rime crystal burst | mineral / grit |
| `frostsilk` | spool of thread | skein | loaded spindle | crafted good, not food |

**B — Emberkeep producers (EMB-13 leftovers, transparent padding)**

| file | role |
|---|---|
| `firepine_1/2` | Seedling → Sapling. T3 = shipped `sprites/items/bigtree.webp` |
| `cinder_vein_1/2` | Cracked Stone → Cinder Seam. T3 = shipped `sprites/items/crystal.webp` |
| `dew_basin_1/2/3` | Hollow Stone → Dew Hollow → Dew Basin |
| `nest_1` | the Cold Nest fixture (EMB-19), single tier, never merges |

`merge-items-and-integration.md` is the spec for the **five goods chains**
(emberberry, resin, ashmoss, quartz, moonwater). Those 15 icons are neither in
this drop nor in this repo, so EMB-17 stays blocked on them.

## 2. What shipped from it

- **All 20 icons trimmed to their alpha bbox** and copied to
  `assets/sprites/items/chains/`. Family A was already tight; family B carried up
  to 100 px of padding, which shifts the anchor on the tile and no scale value
  fixes. Re-trim the source and `ITEM_SCALE` has to be redone with it.
- **The four Borealis chains are live** — `chains.json` with `world: "borealis"`,
  registered in `assets.json`, scaled in `ITEM_SCALE`, taught by
  `src/data/tutorial-borealis.json`. `driftwood_3` (the lit pile) and
  `rimebloom_3` are tappable generators; `tarknot` and `frostsilk` are pure
  merge chains.
- **The lair's Dew Basin got its real art.** `item_dew_basin_1` pointed at a
  missing PNG and was being painted at runtime by `TextureFactory.dewBasin`; it
  now loads `dew_basin_3.webp` (the finished basin). The painter stays as the
  load-failure fallback and is counter-scaled so it still lands the right size.

## 3. What was deliberately left alone

- `firepine_1/2`, `cinder_vein_1/2`, `dew_basin_1/2`, `nest_1` are **trimmed and
  parked in `trimmed/`, not registered**. They belong to EMB-13/EMB-17 (the
  producer wiring) and EMB-19 (the Cold Nest), none of which exist here.
  Registering them early would preload textures that draw nothing — exactly what
  the EMB-10 spec warns about — and `assets/` is the publicDir, so a file left in
  `sprites/` ships to every player whether or not the game can load it. When
  those tasks land, move them to `sprites/items/chains/` and register them there.
  (`raw/emb10` is in the `prune-dist-art` SOURCE_ONLY list, so this folder is
  stripped from `dist` at build time.)
- **No feeding beat in the Borealis tutorial.** The larder is a single number
  (`state.berryStock`, `DRAGON_FEED.chain`), so "the north eats warmth, not
  berries" would need a per-dragon food stock — a real change to
  `DragonFeedSystem`, not a tutorial edit. The script states the inverted diet in
  Eleanor's… in the guide's line and teaches the four chains; feeding stays with
  EMB-19/EMB-20.
- **Speaker.** This lineage only has `cindra | laurah` as SpeakerIds, so the
  Borealis script is Laurah's. Selyna and the Golden Elder's speaking parts are
  EMB-24/36/37, in the other copy of the repo.

## 4. Where it runs

Borealis only exists if an editor map named `borealis` does — the teleport
(`WORLD_TELEPORT_BOREALIS`, fired by the Golden Egg burst) is a no-op otherwise,
which is why prod and the e2e are untouched by all of this.
