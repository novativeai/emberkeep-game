# XP & level pacing — research and the Emberkeep curve

> Goal: the Keeper-level cap per level should never feel *too low* (level-ups
> spam by, progress feels weightless) or *too high* (a grind wall, the player
> stalls and churns). This note records the genre research and the curve we
> shipped, tied to Emberkeep's **actual** XP earn-rates so the numbers are not
> guesses.

## What the casual / merge / idle genre actually does

Surveying the dominant progression designs (Merge Dragons!, Travel Town, Gram
Games' Merge family, and the broader F2P casual-progression literature):

1. **Time-to-first-reward is sacred.** The single strongest first-session
   retention lever is how fast the player gets their *first* level-up. Best
   practice is to make it fire **inside the tutorial**, as a taught beat —
   ideally on or right after the first "wow" moment (here: the egg hatch).
   A first level that takes more than ~2 minutes of play measurably bleeds D1.

2. **Curves are super-linear but smooth — quadratic is the genre default.**
   The cost to reach level *n* grows roughly with *n²* (equivalently: the
   *gap* between consecutive levels grows ~linearly). This is the sweet spot
   between:
   - *flat / linear* (gaps constant) → late levels feel weightless, no sense
     of escalating mastery;
   - *geometric / exponential* (each gap ×1.5–2) → an early **wall**; the jump
     from "every 2 min" to "every 20 min" arrives far too soon and reads as a
     paywall nudge.
   A quadratic keeps every *early* level-up close together while still making
   later levels meaningfully longer.

3. **No gap should more than roughly double the previous gap** in the early
   game. Doubling is the threshold where players consciously notice "this is
   taking longer" and start looking for the IAP shortcut. Keep early ratios
   under ~1.6×.

4. **Leveling must be fed by the core loop, not a side stat.** If the spine of
   the session is "fulfill the order," then *completing an order must grant
   XP*. Otherwise the player's main activity and their progress bar are
   decoupled and neither feels satisfying.

5. **Level-ups should pay** (we already do this: full Warmth refill + Gold via
   `RewardSystem`) so the cap doubles as the rescue from the energy wall.

## Emberkeep's actual XP earn-rates (from `chains.json` + orders)

Merge XP (output tier xp × outputs; a 3-merge = ×1, a 5-merge = ×2):

| Merge | XP |
|---|---|
| Sparkweed → Ember Bloom (T2) | 6 |
| Ember Bloom → Flame Lily (T3) | 14 |
| Egg → Ember Hatchling (T2, **hatch**) | 12 |
| Hatchling → Ember Whelp (T3) | 26 |
| Gem Shard → Flame Gem (T2) | 8 |
| Flame Gem → Radiant Gem (T3) | 18 |

The scripted tutorial merges alone (weeds 6 + eggs 12 + gems 8) yield **~26 XP**
before any free play. Orders previously granted **0 XP** — the gap fixed below.

## The shipped curve

```
LEVEL_XP = [0, 60, 140, 250, 400, 590, 820]   // cumulative XP to reach L1..L7
gaps:          60   80  110  150  190  230
```

Why these numbers — and why the first level-up lands just *after* the tutorial:

- The full scripted tutorial earns **~54 XP** (weeds 6 + hatch 12 + two gem
  forges 16 + the brazier order 20). **L1 → L2 = 60** sits a beat above that, so
  the Keeper finishes onboarding at level 1 and crosses into level 2 on the
  *next* couple of merges in free play.
- That first level-up is also when the **first new zone (level 2) wakes and the
  camera flies out to reveal it** — a cinematic expansion. Tying the first
  level-up to that reveal makes it the payoff moment of the opening, far
  stronger than a quiet in-tutorial ding (and it keeps the tutorial's camera
  locked on the starting clearing, never yanking away mid-lesson).
- Still **fast** — level 2 lands within the first few minutes — honoring the
  time-to-first-reward principle, just paid out as "tutorial complete → expand
  the world" rather than "+1 mid-sentence."
- **Gaps 60 → 80 → 110 → 150 → 190 → 230** grow by a near-constant +20–40
  (second differences ≈ constant): a smooth quadratic, early ratios ≤1.4, no
  wall (principles 2 & 3). Covers L1–L7; the authored world gates zones through
  L4, so there is comfortable headroom.

## Orders now grant XP (the missing lever — principle 4)

`orders.json` rewards gain an `xp` field, paid through `economy:add` on
delivery. Cindra's first order (Rekindle the Brazier) grants **+20 XP** — about
one early level — so completing it *feels* like real progress and ties the
order spine directly to the level bar. New orders should budget XP at roughly
**0.5–1×** the gap of the level the player is expected to be on when they
complete it.

## Tuning rule of thumb for new content

When adding a level/zone, sanity-check: *"playing this zone's intended loop for
~2–4 minutes should earn one level."* Estimate XP/minute from the zone's merges
+ orders and compare against the relevant `LEVEL_XP` gap. If a gap needs >~5
minutes of the *intended* loop, it's too high; if <~1 minute, too low.
