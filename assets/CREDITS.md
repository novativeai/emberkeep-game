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
- `sprites/level1/item_strawberry_1.png` (Emberberry Sprout),
  `sprites/level1/item_strawberry_2.png` (Emberberry Bush),
  `sprites/level1/item_strawberry_3.png` (Ripe Emberberry Plant) —
  AI-generated in-house with Google Nano Banana Pro (gemini-3-pro-image) via
  `.claude/skills/nano-banana/` (magenta de-key → trim → 240×240 compose, base
  anchored for (0.5, 0.88)); replace the previous TextureFactory-derived
  strawberry placeholder art with lore-fitting glowing emberberry plants.
  SynthID-watermarked. 2026-07-10.
- `sprites/ui/icon_cookbook.png` (128×128 HUD cookbook icon) — AI-generated
  in-house with Google Nano Banana Pro (gemini-3-pro-image) via
  `.claude/skills/nano-banana/`, style-referenced on `sprites/ui/icon_tasks.png`;
  magenta de-key → trim → 128×128 contain. SynthID-watermarked. 2026-07-10.
- `sprites/guide-characters/cindra/cindra-bubble-icon.png` (412×412 circular
  character bubble icon, Cindra the flame spirit) — AI-generated in-house with
  Google Nano Banana Pro (gemini-3-pro-image) via `.claude/skills/nano-banana/`,
  format-referenced on
  `sprites/guide-characters/laurah-dragonMaster/guide-character-bubble-icon.png`
  (gold ring + backdrop disc layout); magenta de-key → trim → 412×412 contain.
  SynthID-watermarked. 2026-07-10.
