# Emberkeep — The Dragon Hatchery

A Fairyland-style isometric 2D merge game for the web. High above the clouds,
anchored to floating volcanic isles by chains of ancient gold, sits Emberkeep —
once the greatest dragon sanctuary ever built, now cold and quiet. You are the
new **Keeper**, arriving with a single ember in a lantern. Every tile restored
rekindles the sanctuary.

**This build: Level 1 — “Cinder Hollow”** (one isle, complete play loop, full
production architecture).

## Quickstart

```bash
pnpm install        # npm install works too
pnpm dev            # boots to the title screen → full Level 1 playable
```

| Command | What it does |
| --- | --- |
| `pnpm dev` | Vite dev server |
| `pnpm typecheck` | `tsc --noEmit` (strict, zero `any`) |
| `pnpm test` | Vitest unit tests (merge / energy / orders / save) |
| `pnpm build` | typecheck + production bundle to `dist/` |
| `pnpm e2e` | Playwright drives the ENTIRE tutorial, screenshots to `tests/e2e/shots/` |
| `pnpm verify` | typecheck → unit → build → e2e, in order |
| `pnpm placeholders` | validates the asset manifest (art is runtime-generated) |
| `pnpm probe -- <png>` | prints PNG dimensions/format for incoming art |

## What’s in Level 1

- 8×8 isometric board (2:1 diamonds); centre 5×5 active, the rest under ash-fog
- Three data-driven merge chains (merge-3, and a 5-merge yields two results):
  Sparkweed → Ember Bloom → Flame Lily · Speckled Ember Egg → Ember Hatchling →
  Ember Whelp · Gem Shard → Flame Gem → Radiant Gem
- Hatchlings are **generators**: tap → 1 energy → a Gem Shard hops onto a free
  adjacent tile (10s cooldown, virtual-clock aware)
- Energy 20 max, +1 / 30s, with offline catch-up on load
- **Cindra’s Ledger**: deliver 2 Flame Gems → 50 coins + a Gold Key
- Spend the key on the northern ash-fog: smoke curls away, warm light floods
  in, ash blooms to moss, three eggs and a dormant nest are revealed
- Scripted tutorial directed by Pip (speech bubble, guiding hand, bouncing
  arrow, glowing target tiles, gated input), with Cindra’s cameo at the hatch
- Autosave to localStorage on every mutation; versioned JSON; reset via the
  settings gear
- All SFX are WebAudio-synthesised in code; gentle ambient pad + ember crackle

## Agent instrumentation

The page exposes (see `src/main.ts`):

- `window.render_game_to_text()` → JSON snapshot: scene, 8×8 board matrix
  (chain+tier / fog flags), inventory counts, energy, coins, keys, order
  progress, tutorial step, fps
- `window.advanceTime(ms)` → deterministically advances energy regen and
  generator cooldowns (virtual `GameClock`)
- `window.__emberkeep.gridToPage(col, row)` → page coordinates for input bots

## Swapping in real art (no code changes)

1. Drop PNGs under `assets/raw/<source>/…` (this folder is Vite’s public dir).
2. Add a line to `assets/CREDITS.md` (source, license, date).
3. In `src/data/assets.json`, flip that key’s entry to
   `"source": "file"` and point `"file"` at the relative path, e.g.
   `"raw/ai/item_ember_dragon_2.png"`.
4. If the sprite’s footing differs, adjust its anchor in `src/data/anchors.json`
   (items default to `[0.5, 0.85]` — feet at the tile centre).

PreloadScene loads every `source:"file"` entry; if a file is missing or fails,
the generated placeholder is used automatically — the build never blocks on art.

## TODO — Track B: real asset downloads (human, post-run)

> **Vetted shortlist:** see [docs/asset-sourcing.md](docs/asset-sourcing.md) —
> license-verified packs mapped to our texture keys, with an ingestion order
> (highlights: Cethiel “Gems & Jewels” CC0 for the flame-gem chain, Kenney
> smoke puffs CC0 for the ash-fog, Screaming Brain CC0 isometric tiles in our
> exact 128×64 2:1 geometry, game-icons.net CC-BY for HUD icons).

- Kenney (CC0, no attribution): <https://kenney.nl/assets/ui-pack> ,
  <https://kenney.nl/assets/particle-pack> , <https://kenney.nl/assets/game-icons> ,
  UI audio: <https://kenney.nl/assets/ui-audio> — drop into `assets/raw/kenney/`
- CraftPix free section (CraftPix license: commercial OK, no redistribution):
  <https://craftpix.net/freebies/> — grab Cartoon/Casual GUI + fruit & gem icon
  freebies → `assets/raw/craftpix/` (keep out of public repos)
- game-icons.net SVG icons (CC BY 3.0 — attribution line goes in credits):
  <https://github.com/game-icons/icons> → `assets/raw/gameicons/`
- OpenGameArt CC0 index for gap-filling: <https://opengameart.org/content/cc0-resources>
- Hero art (dragons, eggs, clouds, tiles in the soft glossy style) arrives as
  AI-generated PNG sheets later via the ingest pipeline.

Every file that lands in `assets/raw/` gets a line in `assets/CREDITS.md`
(source, license, date).

## Architecture (the 60-second tour)

```
src/core      EventBus (typed, synchronous), GameState (single source of truth),
              GameClock (virtual time), Constants (every tunable), Context (composition root)
src/systems   Phaser-free logic: Merge, Board, Energy, Generator, Order,
              Economy, Unlock, Save, TutorialDirector — they ONLY talk via the bus
src/scenes    Boot (runtime art) → Preload (real-art files) → Title → Board + UI
src/art       TextureFactory: every placeholder painted with Canvas2D in the palette
src/audio     AudioManager: jsfxr-style WebAudio synthesis, subscribes to the bus
src/data      chains/orders/map/tutorial/assets/anchors — content is JSON-only
```

Rules: systems never call each other (synchronous bus events only); scenes and
audio only emit intents and subscribe; all state mutations go through systems;
all tunables live in `Constants.ts` or `src/data/*.json`; everything tweens —
nothing teleports. See `docs/GDD-L1.md` for the design summary.
