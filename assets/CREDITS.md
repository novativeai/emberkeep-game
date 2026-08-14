# Asset Credits

Every file that lands in `assets/raw/` gets a line here: source, license, date.

| Asset | Source | License | Date added |
| --- | --- | --- | --- |
| All current sprites/UI/SFX (except below) | Generated at runtime by `src/art/TextureFactory.ts` and `src/audio/AudioManager.ts` (programmatic placeholders in the Emberkeep palette; WebAudio synth SFX) | Project-original, no third-party material | 2026-06-12 |
| `raw/screamingbrain/` — Isometric Overworld Pack (Large), incl. `tile_ash.png` / `tile_ash_alt.png` (used as the unrestored ash ground) | Screaming Brain Studios — https://screamingbrainstudios.itch.io/iso-overworld-pack | CC0 / Public Domain ("free to use however you like in any project, commercial or non-commercial") | 2026-06-12 |
| `sprites/characters/dragon/full-sprite/` — Ember Dragon hero art (`dragon-red-board.png` is the trimmed/resized board derivative, wired as Hatchling + Whelp; animation pieces to follow) | Project hero art, provided by the project owner (AI-generated pipeline) | Project-original | 2026-06-12 |

<!-- Template for incoming packs:
| kenney/ui-pack/*.png | https://kenney.nl/assets/ui-pack | CC0 (no attribution required) | YYYY-MM-DD |
| gameicons/*.svg | https://github.com/game-icons/icons | CC BY 3.0 — attribution line REQUIRED in credits screen | YYYY-MM-DD |
| craftpix/<pack>/* | https://craftpix.net/freebies/ | CraftPix license: commercial OK, NO redistribution — keep out of public repos | YYYY-MM-DD |
-->

- `sprites/ui/chapter2/*`, `sprites/finale/glimpse_*`, `sprites/ui/icon_tasks.png` —
  AI-generated in-house with Google Nano Banana Pro (gemini-3-pro-image) via
  `.claude/skills/nano-banana/`; de-keyed + sized by the same pipeline. SynthID-watermarked.
- `sprites/level1/item_strawberry_{1,2,3}.png` (Emberberry Sprout / Bush / Ripe
  Plant) — AI-generated in-house with Google Nano Banana Pro (gemini-3-pro-image)
  via `.claude/skills/nano-banana/` (magenta de-key → trim → 240×240 compose,
  base anchored for (0.5, 0.88)); replaced the TextureFactory-derived strawberry
  placeholders with lore-fitting glowing emberberry plants. SynthID-watermarked.
  2026-07-10. **SUPERSEDED 2026-08-05** by the sheet below; the files are no
  longer referenced by `assets.json`.
- **Emberberry plant chain** (`sprites/items/chains/emberberry_plant_{1,2,3}.webp`)
  — Sprout, Bush and Ripe Plant, registered as `item_strawberry_{1,2,3}`. One
  3-across sheet, AI-generated in-house via `.claude/skills/nano-banana/`
  (`artgen.py character`) on **ByteDance Seedream 5.0 Pro** on fal.ai, with
  `sprites/items/chains/emberberry_1.webp` attached as the FRUIT reference so the
  plant bears the shipped Emberberry rather than a strawberry, and the earlier
  emberberry sheet as the rendering reference. Prompt:
  `raw/merge-chains/prompts/emberberry_plant.txt`; sheet:
  `raw/merge-chains/emberberry_plant-seedream-pro.png`. The model painted a cast
  shadow despite being told not to; it was flattened back to pure key by a
  border-connected chroma-family fill BEFORE de-keying (the technique in
  docs/merge-chains.md §6.1), then cells were split on column gaps at alpha 140.
  Each tier's `ITEM_SCALE` reproduces the superseded art's on-board size exactly.
  SynthID-watermarked. 2026-08-05.
- **Red Dragon sleeping poses**
  (`sprites/characters/dragon/red-dragon/sleep/red_{whelp,adult}_sleep.webp`) —
  the whelp and the adult curled up asleep, head on crossed forepaws, tail
  wrapped round, wings folded. The rig is a standing puppet and cannot curl, so
  ambient sleep swaps in a painting instead of posing the rig. AI-generated
  in-house via `.claude/skills/nano-banana/` (`artgen.py character`) on
  **ByteDance Seedream 5.0 Pro** on fal.ai at 2048×1152, each one image-to-image
  off **its own** shipped baked sprite (`sprite/red-dragon-baked.webp` and
  `sprite-adult/red-dragon-adult-baked.webp`) as THE SUBJECT — not as a style
  reference — with every trait named in the prompt so the horns, the hex scales,
  the gold spinal ridge, the belly plates and the wing membranes come back
  identical. Prompts: `raw/dragons/sleep/prompts/red_{whelp,adult}_sleep.txt`.
  Both usable on the first pass. Border-connected magenta-family pixels
  flattened before de-keying (docs/merge-chains.md §6.1), then a second pass for
  the ENCLOSED key pockets the flood could not reach — the gap a curled tail
  closes is a real hole in the silhouette. `ITEM_SCALE` reproduces the STANDING
  dragon's on-board footprint, so a nap does not change how much tile the animal
  takes. SynthID-watermarked. 2026-08-06.
- **Borealis fixtures + Wreck Timber ladder**
  (`sprites/items/chains/{wrackline_1,frostfont_1,keel_1,keel_2,keel_3,keel_4}.webp`)
  — The Wrack Line, the Hoarfrost Font, and Broken Strake → Lashed Frame →
  Upturned Hull → Longhall: the six pieces of Selyna's roster that had no art
  and rendered as loader fallbacks. AI-generated in-house via
  `.claude/skills/nano-banana/` (`artgen.py asset`) on **Google Nano Banana 2**
  (gemini-3.1-flash-image) at 1K, one call per item, style-referenced on the
  shipped `driftwood_3` + `rimebloom_3` renders so the north stays one hand.
  Magenta-keyed (`dekey.py --trim`), Lanczos-resized to sibling class sizes.
  Prompts: `raw/merge-chains/prompts/borealis-missing.txt`; raws + de-keyed
  masters: `raw/merge-chains/borealis/`. All six usable on the first pass.
  SynthID-watermarked. 2026-08-08.
- **Fir chain, tiers 1–2** (`sprites/items/chains/firgrain_{1,2}.webp`) — Fir
  Grain → Small Fir Tree, what an Ancient Tree drops as it is worked and what
  that seed grows back into. Tier 3 is the Ancient Tree's own painting
  (`sprites/items/bigtree.webp`), aliased the way `firepine_3` and
  `cinder_vein_3` already are, because tier 3 IS a working tree. One 2-across
  sheet, AI-generated in-house via `.claude/skills/nano-banana/`
  (`artgen.py character`) on **ByteDance Seedream 5.0 Pro** on fal.ai at
  2048×1152, style-referenced on `raw/merge-chains/moonwater-seedream-pro-winner.jpg`
  — RENDERING TECHNIQUE ONLY, colours/subjects/ground diamond explicitly
  forbidden. Prompt: `raw/merge-chains/prompts/firgrain.txt`; sheet:
  `raw/merge-chains/firgrain-seedream-pro.png`. Usable on the first pass. The
  sheet DID carry a darkened cast shadow, so border-connected magenta-family
  pixels (`min(r,b) − g > 20`) were flattened to pure key before de-keying
  (docs/merge-chains.md §6.1), then split down the middle and trimmed with a 6px
  pad. `ITEM_SCALE` puts them on the 66 → 88 → 140-unit growth ladder.
  SynthID-watermarked. 2026-08-06.
- **Stormcap and Nightbloom chains** (`sprites/items/chains/stormcap_{1,2,3}.webp`
  and `nightbloom_{1,2,3}.webp`) — Storm Cap → Cap Cluster → Charged Cap, and
  Night Bud → Night Bloom → Cooling Wreath. The two chains that give Storm and
  Moonwhisker a favourite of their own. One 3-across sheet each, AI-generated
  in-house via `.claude/skills/nano-banana/` (`artgen.py character`) on
  **ByteDance Seedream 5.0 Pro** on fal.ai at 2048×1152, style-referenced on
  `raw/merge-chains/ashmoss-seedream-pro-winner.jpg` — RENDERING TECHNIQUE ONLY
  (its heavy even keyline, its few large flat masses), with its colours, its
  subjects and its ground diamond explicitly forbidden. Prompts:
  `raw/merge-chains/prompts/{stormcap,nightbloom}.txt`; sheets:
  `raw/merge-chains/{stormcap,nightbloom}-seedream-pro.png`. Both came back
  usable on the first pass — no ground shadow to flatten this time. Key measured
  off each sheet (`#FF2DF2` / `#FE2EF4`, never `#FF00FF`) → de-key → split on
  column gaps at alpha 140 → trim with a 6px pad. Keyed WITHOUT the
  border-connected restriction of docs/merge-chains.md §6.1 on purpose: nothing
  in either subject is magenta, and the Cooling Wreath's hole is a real hole
  that has to key through. Each tier's `ITEM_SCALE` puts it on the food ladder
  every sibling chain uses (~66 / 88 / 112 units). SynthID-watermarked.
  2026-08-06.
- **Blink and roar-talk head banks for the three forged breeds** —
  `sprites/characters/dragon/{frost,storm,moonwhisker}-dragon/head-animation{,-adult}/`
  (12 banks, 48 frames: `<prefix>-blink-animation` and
  `<prefix>-roar_talk-animation`, each with `frames.json` + `README.txt`).
  Built by `scripts/make-face-frames.py` and calibrated into `src/data/faces.json`
  by `scripts/calibrate-faces.mjs` at scale 1.0000 / silhouette IoU 100% on all
  twelve. Frame 0 of every bank is the rig's own head layer copied verbatim,
  which is what makes that exact. The three other drawings per bank are single
  image **EDITS** of that head plate (`artgen.py edit`, Google Nano Banana 2 —
  `gemini-3.1-flash-image`), not generations: docs/character-pipeline.md records
  why a generated face frame cannot composite over the face it replaces. Keyed
  on magenta, except Moonwhisker — a violet dragon, so the de-spill would eat
  the animal and it keys green instead, the same call made for Eleanor's and
  Selyna's costumes. Cadences are Sprite Studio's own presets, the ones the
  shipped red-dragon banks already use: `Blink (3-state)` at 2600/45/70/55 ms
  and the roar mouth-flap at 267 ms — four steps from three drawings, the fourth
  file a byte-dup of the second. Reference plates and the raw returns are in
  `raw/dragons/<breed>/faces/<stage>/` (workspace only). SynthID-watermarked.
  2026-08-06.
- **Emporium LANDMARKS** (`sprites/environment/map/decor/{keeper_statue,
  broken_arch,ember_beacon,elder_bones,tethered_isle}.webp`) — The First Keeper,
  The Broken Gate, The Ember Beacon, The Elder's Rest and The Tethered Isle. A
  different class of prop from the eight ornaments beside them: architectural
  scale, each with a silhouette no other board piece owns (standing figure /
  arch / tower / low wide mound / floating mass on chains). AI-generated
  in-house via `.claude/skills/nano-banana/` (`artgen.py character`) on
  **ByteDance Seedream 5.0 Pro** on fal.ai at 2048×1152 — a 3-across sheet, a
  2-across sheet and one single plate, style-referenced on the shipped
  `watch_bell` / `chain_anchor` props flattened onto the key (RENDERING
  TECHNIQUE ONLY; colours and subject forbidden). Prompts and sheets in
  `raw/decor-sets/landmarks/`, reproducible with
  `scripts/gen-reveal-and-decor.py decor|singles` → `cut-reveal-and-decor.py`.
  The Broken Gate needed its own plate: off the 3-across sheet it came back as
  three DISCONNECTED floating pieces — a fine ruin drawing, but four objects to
  the column slicer and not something a player can stand on a tile. Alone, and
  told in so many words that it is one connected object on one shared base, it
  behaved. Keys measured per sheet → de-key → split on column gaps at alpha 140
  → trim with a 6px pad. SynthID-watermarked. 2026-08-06.
- **Dragon REVEAL plates** (`sprites/characters/dragon/reveals/*.webp`, 12 of
  them: `{ember,emerald,golden,frost,storm,moonwhisker}{,_adult}`) — the
  full-body hero art behind the full-screen card a player is shown the first
  time a dragon form is theirs. Same route (`artgen.py character`, Seedream 5.0
  Pro) at 1280×1600 PORTRAIT, each generated with that dragon's OWN shipped art
  as the reference so the animal on the card is the animal on the board:
  whelps sitting up with wings spread doing their best impression of a great
  dragon, adults reared and roaring from slightly below. Golden had no baked
  composite on disk (`item_golden_egg_2` still points at the red bake, because
  it renders as a rig), so its rig layers were flattened once into
  `raw/dragons/reveals/`. Keyed on magenta except **Moonwhisker**, which is
  violet head to tail and keys green — the same call the face banks and the
  human portraits make. Trimmed to a 1400px long side. SynthID-watermarked.
  2026-08-06.
- **Frost & Storm dragon eggs** (`sprites/items/{frost,storm}-egg.webp`) — tier 1
  of the store breeds' own chains (egg → baby → adult) since their promotion
  from Emporium skins. AI-generated in-house via `.claude/skills/nano-banana/`
  (`artgen.py character`) on **ByteDance Seedream 5.0 Pro** on fal.ai, one egg
  per plate, style-referenced on a composite of the four SHIPPED eggs (red,
  green, ashdrake, rimewyrm) so the clutch reads as one family; house blocks
  imported from `scripts/merge_style.py`, keyed magenta, cut to the family's
  1440px canvas. Prompts and raws in `raw/dragons/eggs/`; reproducible with
  `scripts/gen-dragon-eggs.py gen|cut`. SynthID-watermarked. 2026-08-13.
- **Five new Borealis farm chains** (`sprites/items/chains/{runestone,emberdram,
  hearthlamp,manastone,wayfinder}_{1,2,3}.webp`) — Runestone, Emberdram,
  Hearthlamp, Manastone and Wayfinder. Briefed on two measurements at once: over
  the Borealis backdrop, 15 of the north's 20 shipped pieces sat in the same
  saturation/value band as the ice, AND they were all the same KIND of thing (a
  heap of material), so these five are made objects — a carved standing stone, a
  cordial cask, a lamp on a hook post, a mana cairn, a ship's compass — each in a
  hue the north did not own. One 3-across sheet each, AI-generated in-house via
  `.claude/skills/nano-banana/` (`artgen.py character`) on **ByteDance Seedream
  5.0 Pro** on fal.ai at 2048×1152. Style-referenced on a plate composited from
  the game's own `emberberry_3` and `moonwater_3` (`scripts/merge_style.py`,
  `style_ref()`) — RENDERING TECHNIQUE ONLY, colours and subjects forbidden.
  Two needed a second pass, both for reasons worth keeping: **Manastone** first
  came back as ovoids cracking open, which in a game about dragon eggs is a
  collision no silhouette rule covers, and was re-specified as flat sawn discs
  and a cairn; **Emberdram** measured sat 0.54 against the ice band's 0.55 floor
  because its cream cloth and pale cradle diluted the rose, and was re-rolled
  deeper. Keyed on magenta except **Emberdram** and **Wayfinder**, which are
  rose-pink and therefore key green. Prompts, sheets and the colour measurements
  are in `raw/merge-chains/borealis/`; reproducible with
  `scripts/gen-borealis-chains.py gen|cut`. SynthID-watermarked. 2026-08-12.
- **Timber chain tiers 1–2** (`sprites/items/chains/lumber_{1,2}.webp`) — Cut
  Wood and Plank Set, the two new steps below the shipped House. Same route and
  same shadow fix as above, style-referenced on `sprites/items/house.png` (so the
  new pieces read as the House's own material) and `sprites/items/wood.png`.
  Prompt: `raw/merge-chains/prompts/lumber_t1_t2.txt`; sheet:
  `raw/merge-chains/lumber_t1_t2-seedream-pro.png`. SynthID-watermarked.
  2026-08-05.
- `sprites/ui/icon_cookbook.png` (128×128 HUD cookbook icon) — AI-generated
  in-house with Google Nano Banana Pro (gemini-3-pro-image) via
  `.claude/skills/nano-banana/`, style-referenced on `sprites/ui/icon_tasks.png`;
  magenta de-key → trim → 128×128 contain. SynthID-watermarked. 2026-07-10.
- `sprites/ui/icon_bag.png` (replaces the earlier photoreal satchel) and
  `sprites/ui/icon_shop.png` (replaces the runtime-painted `ui_icon_shop`
  placeholder) — both 128×128 HUD icons, AI-generated in-house with **ByteDance
  Seedream 5.0 Pro** on fal.ai (`artgen.py map-seedream`, the `v5/pro/edit`
  route) via `.claude/skills/nano-banana/`, style-referenced on
  `sprites/ui/icon_cookbook.png` flattened onto the key so the three HUD icons
  read as one set. Prompt skeleton is the merge-chain one
  (`raw/merge-chains/borealis/prompts/_style.txt`) narrowed to a single
  front-facing icon; briefs, raw sheets and the repro script live in
  `raw/ui-icons/`. Key measured off each sheet (`#FE21F9`, not `#FF00FF`) →
  de-key → trim → 128×128 contain. 2026-08-05.
- `sprites/items/skins/manor_{mushroom,windmill,treehouse,igloo}.png|.webp`
  (430×450 Manor skins, the Emporium's Manor Skins tab) — AI-generated in-house
  with **ByteDance Seedream 5.0 Pro** on fal.ai (`artgen.py map-seedream`, the
  `v5/pro/edit` route) via `.claude/skills/nano-banana/`, art-directed from
  `sprites/items/manor.png` flattened onto the key (rendering technique and the
  2:1 isometric camera only — the prompt forbids copying its shape). Briefs, raw
  sheets and the repro scripts are in `raw/house-skins/v2/`. Key measured per
  sheet (`#FA2DF8`–`#FE35FD`) → de-key → trim → bottom-aligned contain onto the
  Manor's 430×450 canvas (`raw/house-skins/v2/bake.py`). They REPLACE the first
  skin set (hearthstone / roost / lantern / chapter, kept in
  `raw/house-skins/superseded/`), which was four variations of one red-tiled
  stone box — no card in the shop read as a different building. 2026-08-06.
- `sprites/characters/dragon/frost-dragon/` (8 hatchling parts + 6 adult parts,
  each on the red dragon's own layer canvas, plus the two rig.json files) — the
  first breed produced by `.claude/skills/nano-banana/scripts/dragonbreed.py`:
  the red rig's layers laid out as a parts sheet, repainted as the Borealis
  frost breed on **Google Nano Banana Pro** (`gemini-3-pro-image`, `artgen.py
  sheet-pro`, 4K), then sliced back onto the source canvases and registered to
  the source alpha bboxes. Brief, sheets, prompts, both generations and the
  registration report are in `raw/dragons/frost/`. SynthID-watermarked. Not
  registered in `assets.json` — rig-ready only. 2026-08-06.
- Two more breeds — `sprites/characters/dragon/{storm,moonwhisker}-dragon/`
  — and two skins, `red-dragon/{sprite,sprite-adult,rig,rig-adult}-ashglass/` and
  `emerald-dragon/{…}-porcelain/` (the `sprite-sunset` convention). Same
  `dragonbreed.py` pipeline on **Google Nano Banana Pro** (`sheet-pro`, 4K),
  young + adult each. The breeds run in free-silhouette mode (outline reshaped
  around a locked skeleton, canvases grown with a compensating `pad_rig` edit);
  the skins run locked, surface only. Briefs, sheets, prompts, generations and
  per-part registration reports in `raw/dragons/<id>/`; `raw/dragons/roster-*.png`
  is the assembled + silhouette contact sheet. SynthID-watermarked. Not registered
  in `assets.json` — rig-ready only. 2026-08-06.
- **All produced dragons re-cut 2026-08-06** with the pipeline's `outline` step:
  the dark keyline is now drawn by `dragonbreed.py` off the rig's own anchors —
  everywhere except a disc around each joint (`childLocal` / `parentLocal`), so
  no keyline draws a collar across the assembled animal's neck or a ring at its
  shoulders. `frost` was also regenerated as a true BREED (free silhouette —
  faceted ice horns, angular spine shards, crisp scalloped ice wings); it had
  been generated under the locked contract, which made it a skin wearing a
  breed's folder. `storm`'s hatchling was regenerated with a stage-specific
  personality after the first pass put an adult face (slit pupils, furrowed
  brow, tusks) on a baby body.
- **The two dragon skins are SHIPPED** (Emporium → Dragons tab): baked board
  composites at `red-dragon/sprite{,-adult}-ashglass/*-baked.webp` and
  `emerald-dragon/sprite{,-adult}-porcelain/*-baked.webp` (`dragonbreed.py`'s
  `bake` step — the rig's own layer offsets, byte-identical to how the shipped
  bakes were made), plus their shop key art `sprites/ui/store/card-{ashglass,
  porcelain}.webp` (900×506, rounded corners). The key art is AI-generated
  in-house with **ByteDance Seedream 5.0 Pro** on fal.ai (`artgen.py character`,
  2048×1152) with the assembled skin as the reference so the animal stays on
  model — Ashglass on a caldera lip over molten fissures, Porcelain in a moonlit
  temple courtyard of cobalt vases and gold-veined paving. Prompts at
  `raw/dragons/<id>/card-prompt.txt`. SynthID-watermarked. 2026-08-06.
- Key art for the new BREEDS — `sprites/ui/store/card-{storm,moonwhisker}.webp`
  (900×506, rounded corners; masters at `raw/dragons/<id>/card-raw.jpg`, briefs
  at `card-prompt.txt`). Same treatment as the skin cards: **ByteDance Seedream
  5.0 Pro** on fal.ai (`artgen.py character`, 2048×1152) with each breed's own
  `adult-assembled.png` as the reference so the animal stays on model, and an
  environment written from that breed's personality — Storm braced on a basalt
  spire answering the lightning, Moonwhisker alighting on a moonlit ledge above
  the lantern islands. (A third, `mossback`, was cut on art direction and its
  files deleted: a creature's silhouette must come from its own anatomy, never
  from props stuck on it.) SynthID-watermarked. 2026-08-06.
- `sprites/ui/store/card-frost.webp` (667×940 — the Emporium's SHOWCASE card, so
  portrait where every other card is landscape; master `raw/dragons/frost/
  card-raw.jpg` at 1152×1536). Same route and reference discipline; the brief is
  a coronation rather than a fight — wings open, a banded aurora pouring behind
  them, cracked sea ice below. SynthID-watermarked. 2026-08-06.
- **All five dragon appearances are SHIPPED** (Emporium → Dragons tab). The two
  skins wear their host's own rig, so their bakes drop straight in. The three
  BREEDS do not: `pad_rig` grows a free-silhouette breed's canvas to keep its
  outline off the cut edge, so frost/storm/moonwhisker bake at 1162×1182 /
  907×757 against red's 1054×1074 / 836×704 — dropped in as-is they would render
  ~10% oversized and off centre, because `ITEM_SCALE` and the `anchors.json`
  origin are keyed by CHAIN, not by texture. `scripts/bake-dragon-skin.py` fits
  each one instead: scale the alpha bbox to the host's bbox HEIGHT, centre it on
  the host's bbox centre, on a host-sized canvas. Output at
  `sprites/items/skins/dragons/<breed>_{3,4}.webp`; every skin key also got its
  host tier's anchor, which the two original skins had been missing. 2026-08-06.

- `sprites/background/borealis.webp` (2610×1632 world backdrop — the second
  official map, a night aurora/snow archipelago) — AI-generated in-house with
  ByteDance Seedream 5.0 Pro on fal.ai via `.claude/skills/nano-banana/`
  (`artgen.py map-seedream`), art-directed from `sprites/background/emberkeep.jpg`
  and laid out against the authored tile mask from `tools/mapmask/design.py`.
  Upscaled 4× and de-artifacted with Topaz (`fal-ai/topaz/upscale/image`, CGI
  model, non-generative) via `upscale.py`, then cropped 16:9 → 16:10 on content
  centre and Lanczos-downscaled to the base map's exact 2610×1632. Generations,
  briefs and the 71 MP master are kept in `assets/raw/map-gen/` (workspace-only,
  pruned from `dist`). 2026-08-01.

- `sprites/characters/{eleanor,selyna}/` (laid out like Laurah: `3d/`,
  `<name>_expressions/`, `<name>_visemes/`, `<name>_eyelids/`, and one
  Sprite Studio character-bank sequence per clip) —
  production art for the two human characters: a low-poly turnaround, a waist-up
  dialogue portrait, an eight-cell expression sheet, a nine-shape lip-sync
  talking sheet, a three-state blink (each plus their sliced frames and a
  playable WebP animation) and the separate witch-hat prop, all art-directed
  from the owner-provided
  `concept-art/*.jpg`. AI-generated in-house via `.claude/skills/nano-banana/`
  (`batch-characters.sh`, which holds every prompt): portraits on ByteDance
  Seedream 5.0 Pro on fal.ai, sheets and props on Google Nano Banana 2
  (gemini-3.1-flash-image). Expression and viseme cells are framed by a mask
  template built with Sprite Studio's own `lib/gridSheet.ts`; the nine mouth
  shapes come from its `lib/phonetic.ts` / `lib/gridPrompts.ts` (the Rhubarb
  chart) and the blink states and cadence from its `lib/presets.ts`. The three
  eyelid states are not a sheet — they are single-image **edits** of the
  finished `X-rest` viseme plate (`artgen.py edit`), so a blink frame is the
  same drawing as the pose the talking bank rests on; `crossalign.py` then puts
  every pose set on one canvas and composites the eyelids back through an
  eyes-only ellipse. Keyed on
  **green** rather than the
  usual magenta — both costumes sit too close to magenta for its de-spill.
  SynthID-watermarked. Raw generations, templates and the superseded blink
  sheets in `assets/raw/characters/` (workspace-only); game-ready runtime copies
  at 560 px in `sprites/{eleanor,selyna}/`, baked by
  `scripts/bake-character-runtime.py` and registered in
  `src/render/sequenceCatalog.ts`. Full workflow:
  `docs/character-pipeline.md`. 2026-08-04.

- **Eleanor — 2.5D world standee + animation sheets**
  (`sprites/characters/eleanor/world-standee/`). Two eight-frame sequences for
  the character who stands ON the map: a deliberately near-motionless breathing
  `idle` (loops) and a `cast` one-shot in which she raises her scepter and sends
  an ember bolt off to the LEFT — she works at a distance and never walks to
  what she helps. AI-generated in-house via `.claude/skills/nano-banana/`
  (`artgen.py character`) on **ByteDance Seedream 5.0 Pro** on fal.ai, with
  `eleanor/3d/eleanor-lowpoly-sheet.png` as the character reference, keyed on
  **green** (her wine-plum cloak sits too close to magenta for its de-spill).
  Seedream was chosen by a three-way bake-off against Google Nano Banana 2 at 2K
  and at 4K: it was the only route that drew her FACING LEFT and in a genuine
  elevated isometric 3/4 matching the 2:1 board — both NB2 passes drew her
  front-on at eye level, and NB2-4K bled the spell beam across cell boundaries.
  Frames are sliced from a 4×2 sheet and share one crop box so playback does not
  jump. SynthID-watermarked. PLACEHOLDER for the 3D version; limits and the
  production fix are in that folder's `README.txt`. 2026-08-05.
- **Flame Gem chain** (`sprites/items/chains/flame_gem_{1,2,3}.webp`) — Gem
  Shard, Flame Gem and Radiant Gem, Chapter One's order currency. AI-generated
  in-house via `.claude/skills/nano-banana/` (`artgen.py character`) on
  **ByteDance Seedream 5.0 Pro** on fal.ai; tier 1 was generated standalone and
  tiers 2–3 reference it as a MATERIAL reference so the chain reads as one
  family. Keyed on **green** — the gems are ember-red and gold, and a magenta
  key bleeds into their warm highlights. SynthID-watermarked. 2026-08-05.

## VFX bank (`assets/vfx-bank/`, sources in `assets/raw/vfx-sources/`)

Every source below is **CC0** — commercial use permitted, attribution not
required — and was located through Simon Schreibt's *Textures for VFX* database
(<https://simonschreibt.notion.site/Textures-for-VFX-Database-2c72eccccfa84a0eae927d778ad746cc>).
Licences were read off each source page on 2026-07-27. The bank PNGs are
**derivative works**: recoloured to the Emberkeep `PALETTE` and re-graded by
`scripts/bake-vfx-bank.mjs`; the recipe for each is in `assets/vfx-bank/bank.json`.

| Source (raw) | Origin | License (verified 2026-07-27) | Used for |
| --- | --- | --- | --- |
| `raw/vfx-sources/kenney/*.png` (particle pack — `circle_05`, `star_06`, `star_08`, `flare_01`, `light_02`, `magic_02`, `magic_04`, `muzzle_04`, `scorch_02`, `trace_06`, `twirl_03`, `dirt_02`, `flame_04`) | Kenney Vleugels — <https://kenney.nl/assets/particle-pack> | CC0 (`License.txt` in pack: "Creative Commons Zero, CC0") | `fx_ember`, `fx_spark`, `fx_debris`, `fx_mist`, `fx_flare`, `fx_magic_circle`, `fx_scorch`, `fx_twirl`, `fx_leaf_spark` |
| `raw/vfx-sources/kenney/{whitePuff12,blackSmoke10,flash05,explosion04}.png` | Kenney — <https://kenney.nl/assets/smoke-particles> | CC0 | `fx_fog_puff` |
| `raw/vfx-sources/unity-labs/*.png` (9 flipbook sheets, TGA→PNG) | Unity Labs Paris — <https://blog.unity.com/technology/free-vfx-image-sequences-flipbooks> | CC0 — page states: "Here are some image sequences we want to share with you under CC0 license. Feel free to use them in your projects!" (Houdini-authored) | every `fb_*` flipbook |
| `raw/vfx-sources/sbs-noise/*.png` | Screaming Brain Studios — <https://opengameart.org/content/noise-texture-pack> (768 noise textures) | CC0 (page: "License(s): CC0") | `noise_turbulence`, `noise_vein` |

Purely procedural (no third-party input, painted by the FX Studio generators):
`fx_glow`, `fx_mote`, `fx_shock_ring`, `noise_fbm`.

**Derived data, project-original** (computed from the graded sheets above; no
additional third-party material): `flipbooks/<key>_pack.png` (density/emissive/
erosion/alpha channel packs) and `flipbooks/<key>_mv.png` (dense optical-flow
motion vectors), both from `scripts/bake-vfx-mv.py`, plus `ramps.png` — the
Emberkeep `PALETTE` ramp LUT from `scripts/bake-vfx-ramps.py`. The upstream CC0
licences above carry through to them.

**Not vendored, deliberately:** LeLu's Free Textures Pack
(<https://leluvfx.gumroad.com/l/freeTextures>) is free and CC0-for-use, but its
licence states *"You CANNOT resell and/or redistribute this asset pack"* — so the
pack must not be committed here. It can be downloaded per-developer and imported
through FX Studio → Textures → Library; derived textures baked from it are fine
to ship, the pack itself is not. Same rule as CraftPix in `docs/asset-sourcing.md`.
