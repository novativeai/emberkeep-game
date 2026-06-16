# Emberkeep — GDD summary, Level 1 “Cinder Hollow”

## World & tone
Floating volcanic isles above the clouds; the Great Flame went out generations
ago and the sanctuary sleeps under ash. The player is the silent **Keeper**;
**Pip** (flightless messenger dragon, self-deprecating, enthusiastic) runs the
tutorial; **Cindra** (elder fire-sprite, grandmotherly, bossy) gives orders.
Warm, hopeful, a little mischievous. The emotional engine is **hatching** —
every egg is a small promise. Warmth is the visual reward: ash greys bloom into
reds/golds/moss as the player progresses.

## Palette (Constants.ts is the source of truth)
Lava `#E8503C/#C73A2E/#FF8A66` · Gold `#F7A437/#D9821F/#FFD84D` · Plum stone
`#4A3845/#3A2B38/#6A5468` · Teal sky `#3FA8D9/#2E7FA6` · Ash `#8E8A93/#6E6A75`
· Moss `#7ECB4F/#5FA63D` · Cream UI `#FFF6E8` + brown text `#B5602F`.

## Board
8×8 logical grid, 2:1 isometric diamonds (tile 128×64, fixed framing, no
camera). Regions (map.json): `start` 5×5 active centre · `north_fog` (row 0 +
col 0, 15 tiles) unlockable for 1 Gold Key, hides 3 eggs + nest decor ·
`south_rim` (24 tiles) locked in L1. Ash-fog smoke puffs cover non-active tiles.

## Chains (chains.json — content is data-only)
| Chain | T1 | T2 | T3 |
| --- | --- | --- | --- |
| sparkweed | Spark Weed | Ember Bloom | Flame Lily |
| ember_dragon | Speckled Ember Egg | **Ember Hatchling** (generator) | **Ember Whelp** (generator) |
| flame_gem | Gem Shard | Flame Gem | Radiant Gem |

Merge rule: 3 adjacent (orthogonal flood-fill on drop) → 1 next-tier at the
drop tile; ≥5 → consume 5, yield 2 (config flag `fiveBonus`). XP per merge from
the produced tier. Egg→Hatchling merges are **hatches** (shell-crack flash,
spark confetti, Cindra’s proud line).

## Generators & energy
Tap a ready hatchling/whelp: costs 1 energy, spits a Gem Shard onto a free
adjacent tile, 10s cooldown (virtual-clock aware → `advanceTime` testable).
Energy: max 20, +1/30s, anchored regen (no banking at full), offline catch-up
computed on load.

## Order & unlock loop
Cindra’s Ledger: “Rekindle the Brazier” — deliver 2 Flame Gems → +50 coins +
1 Gold Key → tap the northern fog → smoke curls up and fades, warm light
floods, tiles bloom ash→moss, 3 eggs + dormant nest revealed → free play.

## Tutorial (tutorial.json, 12 steps, input gated per step)
welcome → merge 3 Spark Weeds → “the ground remembers warmth!” → merge 3 eggs
→ HATCH (Cindra cameo) → tap hatchling to harvest → forge two Flame Gems →
open the Ledger → deliver → receive key (Cindra) → tap fog → free play.
Steps carry bubble text/speaker, highlight tiles, hand & arrow targets
(`last_hatched` dynamic marker supported) and an input allow-list.

## Session profile
5–10 minutes: ~6 merges + 1 harvest to finish the tutorial, then free play
(north eggs → second hatchling → whelp chase, selling, energy management).

## Out of scope for L1
Multiple isles, camera pan/zoom, shop/gems currency, login, localization,
pinch zoom (pointer taps/drags work for touch).
