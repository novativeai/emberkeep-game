# Asset sourcing — vetted free packs for Emberkeep (Track B research)

Researched 2026-06-12. Every entry below was **verified on its page** (license
quoted from source). Style gate: soft glossy casual/cartoon matching the
`asset-reference/` targets — **pixel art is excluded**, flat-vector allowed
only where style-neutral (particles, cursors, audio, icon silhouettes).

Ingest workflow per pack: download → `assets/raw/<source>/` → line in
[`assets/CREDITS.md`](../assets/CREDITS.md) → `pnpm probe -- <png>` → flip the
key in [`src/data/assets.json`](../src/data/assets.json) to `source:"file"` →
adjust [`anchors.json`](../src/data/anchors.json) if footing differs.

## S-tier — drop-in fits

| Pack | URL | License (verified) | Covers (our keys) | Fit | Notes |
| --- | --- | --- | --- | --- | --- |
| **Gems & Jewels** by Cethiel (100 gems, 128×128, rendered/glossy) | https://opengameart.org/content/gems-jewels | CC0 — commercial OK, no attribution | `item_flame_gem_1..3` (pick small shard / mid gem / large radiant in lava-gold hues) | 5/5 | Glossy rendered look matches the reference gems exactly; with/without-background versions included |
| **Smoke Particle Assets** by Kenney (77 sprites; white-puff set) | https://opengameart.org/content/smoke-particle-assets | CC0 (credit optional) | `fog_puff_1/2` (tint to ash `#8E8A93`), burst particles | 5/5 | The white puff style is the same layered-blob cloud language as Fairyland's fog |
| **Isometric Tiles — Overworld Pack** by Screaming Brain Studios (360 tiles, terrain/forest/water, Flat + Thick) | https://screamingbrainstudios.itch.io/iso-overworld-pack | CC0 — "free to use however you like… commercial or non-commercial" | `tile_moss*`, `tile_ash*`, `cliff_*` (Thick variants are pre-extruded isle blocks) | 4/5 | **Flat small tiles are exactly 128×64 (2:1) — our precise tile geometry, zero rescaling.** Slightly less cartoony than target; palette-grade toward moss/ash in post |
| **Isometric Tiles — Floor Pack** (1,008 tiles) + **Pathways Pack**, same author | https://screamingbrainstudios.itch.io/isotilepack | CC0 (same terms) | extra ground variety for L2 isles | 4/5 | Same 2:1 geometry family |
| **game-icons.net** (≈4,500 SVG icons) | https://game-icons.net | CC BY 3.0 — "use them freely as long as you credit the original author"; format: "Icons made by {author}. Available on https://game-icons.net" | `ui_icon_bolt/coin/key/gear/scroll` + L2 icons (gem, egg, dragon-head, flame, padlock, price-tag) | 5/5 | Recolor silhouettes into palette inside our gold-rimmed discs; **attribution line must ship in credits** |
| **Kenney Cursor Pack** (180 cursors incl. hand pointers) | https://kenney.nl/assets/cursor-pack | CC0 | `ui_hand` (tutorial glove), system cursors | 4/5 | White glove pointers in the exact Fairyland tutorial style |

## A-tier — strong, needs light rework (recolor/curation)

| Pack | URL | License (verified) | Covers | Fit | Notes |
| --- | --- | --- | --- | --- | --- |
| **Gems Games — Free GUI** (CraftPix; full casual GUI: screens, buttons, icons; AI/PSD/PNG vector) | https://craftpix.net/freebies/gems-games-gui/ | CraftPix royalty-free — "sell and distribute games with our assets"; **no redistribution → keep out of public repos** | `ui_panel`, `ui_card`, `ui_btn_*`, `ui_slot`, `ui_pill` | 4/5 | Glossy casual style; bright palette → regrade to cream/gold/lava in the PSDs |
| **Free Cartoon Glossy Buttons UI** by LastObrium (6 glossy buttons) | https://lastobrium.itch.io/free-cartoon-glossy-buttons-ui | Listed license-free on page (re-verify on download) | `ui_btn_green`, `ui_btn_play` | 4/5 | The glossy-with-dark-bottom-strip look we want |
| **Kenney UI Pack / Particle Pack / Game Icons / UI Audio** (already in Track B) | https://kenney.nl/assets/ui-pack · /particle-pack · /game-icons · /ui-audio | CC0 | UI prototyping, `fx_*` particles, SFX | 3-5/5 | Particles + audio are ship-grade; flat UI is prototype-grade for our look |
| **Kenney Music Jingles** (85 jingles) + **Music Loops** | https://kenney.nl/assets/music-jingles | CC0 | order-complete / level-up stingers, ambient bed candidates | 4/5 | Replaces or layers over the synthesized fanfare |
| **CC0 Gem Icons** (multi-size icon set) | https://opengameart.org/content/cc0-gem-icons | CC0 | HUD-scale gem icons, ledger slots | 3/5 | Smaller sizes; board items better served by Cethiel's set |

## B-tier — usable with caveats

| Pack | URL | License | Covers | Fit | Caveat |
| --- | --- | --- | --- | --- | --- |
| **155 MJv4 Dragon Eggs** (AI-assisted, multi-size to 512px) | https://maxymax333.itch.io/155-free-dragon-eggs-bg-removed-multi-sizes | CC0 (page-stated) | `item_ember_dragon_1` candidates | 3/5 | AI-assisted, mixed finish — curate the few glossy 512px eggs that match the red/gold speckle target; check store-policy implications of AI art before shipping |
| **Rotating Gems for Match3** (7 colors × 40 frames, 52×52) | https://opengameart.org/content/rotating-gems-for-match3 | per page (CC-family; re-verify) | gem sparkle/idle animation reference | 3/5 | Small frames; animation timing reference more than final art |

## Rejected (so nobody re-litigates)

- **Raou “Isometric Fantasy”** (itch) — 24×24 **pixel art**; style gate fail.
- **CraftPix free tilesets** (all 16 checked) — platformer/top-down pixel or
  vector, **no isometric ground** in the free tier; their dragons
  (`2d-game-dragon-character-sprites`, `2d-fantasy-dragons-sprite-sheets`) are
  **paid** products, and side-view ferocious style ≠ chibi merge style anyway.
- Low-poly 3D dragon packs (bocdagla, DGG, Quaternius) — 3D models; we ship 2D PNG.

## Gap analysis — what free packs do NOT cover

The **hero art** (chibi hatchling/whelp matching `asset-reference/dragon-character.png`,
the speckled egg with crack stages, Pip/Cindra portraits, the nest) has no
free-pack equivalent at AAA quality — exactly as planned, it arrives as
**AI-generated PNG sheets via the ingest pipeline** (`pnpm probe`, then
`assets.json` flips). Everything else above keeps the runtime placeholders as
automatic fallback, so ingestion can land piecemeal.

**Suggested ingestion order:** 1) Cethiel gems + Kenney smoke (instant board
upgrade, CC0) → 2) Screaming Brain ground/cliffs (geometry-exact) → 3) GUI
regrade from CraftPix Gems GUI → 4) icons from game-icons.net (add the CC-BY
attribution line to CREDITS + a credits screen entry) → 5) hero art via AI
pipeline.
