# Emberkeep — The Perfect Demo Plan ("Chapter One: Cinder Hollow")

> Companion to [DESIGN-REVIEW.md](DESIGN-REVIEW.md). Constraint accepted:
> **the demo still ends at Keeper Level 3.** This plan redesigns everything
> *inside* that cap so the demo plays as a complete, delightful chapter —
> and the cap itself becomes the cliffhanger, not the wall.
>
> Design goal in one sentence: **the player should finish wanting the next
> chapter, not wondering if there was one.**

---

## 1. The demo's job (what "perfect" means here)

A demo is not a small game; it is a **promise, kept once**. Emberkeep's own
pillar — *every egg is a promise* (MECHANICS §0) — is the demo's structure:

1. **Make a promise early** — plant a visible, mysterious payoff object in
   the first 10 minutes (the Golden Egg) and a visible, unreachable place
   (the shrouded south terrace).
2. **Keep the player busy and warm** — no wait longer than the fun it buys;
   something is always ready, ripening, or one merge away.
3. **Pay the promise at the peak** — the Level-3 moment is the biggest beat
   in the demo (hatch + glimpse + first Cindra line), *then* the chapter card.
4. **Leave one thread pulled** — end mid-mystery, with the next chapter named.

Target shape: **~25 minutes to the finale in one sitting**, or 2–3 cozy
sessions (the come-back hooks in §6 make both paths feel right). Every beat
below is achievable with the existing architecture — scope tags:
**[data]** JSON/Constants edit · **[reuse]** existing system/FX re-pointed ·
**[small]** new code ≤ a day · **[med]** new code, a few days.

---

## 2. The emotional arc (five acts inside the cap)

```
 excitement
     ▲                                        ★ FINALE (L3)
     │                       hatch #3      golden hatch
     │      hatch #1,#2    terrace bloom   fog-glimpse
     │     ▲    ▲            ▲              Cindra speaks
     │    ╱ ╲  ╱ ╲   O1 ✓   ╱ ╲    O2 ✓  O3 ✓ ╱ chapter card
     │   ╱   ╲╱   ╲  ▲     ╱   ╲    ▲    ▲   ╱   + encore
     │  ╱          ╲╱ ╲   ╱     ╲  ╱ ╲  ╱ ╲ ╱
     └─┬────────────┬──────┬──────────┬─────┬──────────▶ time
       ACT I        ACT II ACT III    ACT IV  ACT V
       tutorial     first  building   the     encore
       (~7 min)     order  the hoard  ascent  sandbox
                    (~5)   (~6)       (~7)    (open)
```

Rule enforced throughout: **a peak at least every 3 minutes** (a hatch, an
order, an unlock, a chest, a bloom). The audit found the current build has a
50-minute trough right after Act I; this plan's Acts II–IV replace it.

---

## 3. Beat-by-beat

### ACT I — The Tutorial (0–7 min) · keep as-is, two touches

The existing 16-step tutorial is the demo's strongest asset. Keep it. Add:

- **T1. Plant the far promise. [data + reuse]** During the `levelup` camera
  moment, let the fly-over *linger one beat* on the south terrace (`level_5`
  region, repurposed — see Act IV): fog with a faint golden pulse under it
  (the existing `readyPulse` tween on a fog sprite). Laurah: *"…and past the
  ash? Even Cindra won't say."* Ten seconds of flight cost, a whole demo of
  curiosity bought.
- **T2. Fix the tease line. [data]** `free_play` currently promises "a grand
  surprise at Keeper Level 3." Keep it — this plan makes it true — but
  sharpen it to point at the object: *"Cindra's watching that Golden Egg,
  you know. Reach Keeper Level 3 and you'll see why."*

### ACT II — The First Order (7–12 min) · "Rekindle the Brazier"

- **Order 1 [data]:** deliver **6× Gem Shard (t1)** → 25 gold, 30 XP, and the
  **Golden Egg spawns with ceremony** (glowFlash + floatText "???"). With the
  retuned timers (§5) the green dragon yields ~3 shards/min → **~3 minutes of
  active tap-merge-deliver**, not 50 minutes of waiting.
- **The Golden Egg is the demo's MacGuffin. [data + small]** Make it
  **unsellable and unmergeable** (it's a *promise*, not 200 gold) — tapping it
  wobbles it and floats flavor text that changes as levels rise:
  L2 *"It's warm…"* → near-L3 *"It's trembling!"*. One switch on
  `COLLECTIBLE`/sell handling + a tap line table. This single object converts
  the level cap into anticipation.
- **First order celebration [reuse]:** banner + spark burst + coin-fly (parity
  with level-up — the FX all exist, they're just not wired to
  `order:completed`).

### ACT III — Building the Hoard (12–18 min) · the sandbox opens up

The player now knows the loop; give them *choices* instead of a queue:

- **Two orders visible. [small]** O2 "The Hearth" (3× Flame Gem t2 → 75 gold,
  35 XP) and O3 "The Radiant Centerpiece" (1× Radiant Gem t3 → 110 gold,
  50 XP) both on the Ledger. The player decides: deliver gems now, or hold
  and push up the chain — the genre's core skill expression, currently absent.
- **The strawberry patch. [data — content exists, unplaced]** Put 3 Sprouts
  in the `level_2_gate` plot (behind the tutorial's key-unlock, so it reads
  as *found treasure*). Ripe Plant = a **free, 20-second producer** — the
  designed "always something to do at zero Warmth" floor, and it makes the
  key-unlock plot feel rewarding instead of empty.
- **Second dragon goal. [data]** Crystal cooldown 20 min → **5 min**, chest
  10 min → **5 min** (emerald gift weight up). A second Green Dragon (9
  emeralds) becomes a reachable ~5-minute side-quest that doubles shard
  income — the demo's one strategic investment decision.
- **Chest as rhythm. [data]** Every 5 minutes something free arrives; the
  attention-dot already exists. Peaks-every-3-minutes insurance.

### ACT IV — The Ascent (18–25 min) · engineered crescendo

- **Retune `LEVEL_XP[2]` so Level 3 lands ON Order 3's completion. [data]**
  The scripted XP ledger:

  | Beat | XP | Running total |
  | --- | --- | --- |
  | Tutorial (2 hatches + scripted) | 60 | 60 → **L2** |
  | Order 1 (6 shards) | 30 | 90 |
  | Merges toward O2 (3× t2 @ 8) | 24 | 114 |
  | Order 2 | 35 | 149 |
  | Second dragon hatch (optional) | ~24 | ~173 |
  | Merges toward O3 (t2s + 1× t3 @ 8/18) | ~34 | ~207 |
  | **Order 3 delivered** | **50** | **~257 → L3 ★** |

  Set `LEVEL_XP[2] = 220` (currently 140). Tolerance: ±30 XP of side
  activity still lands the level-up within seconds of the O3 fanfare — and
  because orders pay XP in big chunks, the finale almost always triggers on
  a *delivery*, the right beat. (Keep levels 4+ out of the array or leave
  them ungated — the cap stays.)
- **Rising signposting. [data]** Near-threshold, Laurah gets one nudge:
  *"The egg — look at the egg!"* The Golden Egg's wobble amplitude scales
  with XP progress toward L3 (one tween parameter).

### ★ THE FINALE — Keeper Level 3 (~25 min) · the grand surprise, made real

A scripted ~40-second sequence (**[med]** — one choreographed UIScene/BoardScene
sequence; every individual effect already exists):

1. **The level-up fires** — but instead of the standard banner, the screen
   holds… the Golden Egg cracks. **Golden hatch ceremony** (existing shell
   FX, gold-tinted): a **Golden Whelp** — a breed the player has never seen.
2. **It runs to the south terrace edge** and cries at the fog. The camera
   follows (the zone-fly already built — the game's best moment, reused).
3. **The fog parts *halfway*** (fog-lift stagger, stopped at 50%): a 2-second
   glimpse — warm light, silhouettes of a shrine and two unfamiliar dragon
   shapes (static silhouette sprites, cheap) — then the ash settles back.
4. **Cindra speaks. For the first time in the entire demo.** (Her bubble
   support is fully built and has never fired — the demo *saves a character*
   for this beat.) *"So it chose you. Keeper… the Great Flame didn't die.
   It was **taken**. Rest now. We dig at dawn."*
5. Ember-burst + fanfare → **Chapter card**, not an end screen:
   **"CHAPTER ONE COMPLETE — Cinder Hollow rekindled"** with:
   - three stat lines (dragons hatched · orders filled · warmth restored),
   - **"In Chapter Two:"** three silhouette cards — *the Tideglass terrace ·
     a new breed · Cindra's secret*,
   - buttons: **Keep Playing** (→ Act V) · Play Again · a wishlist/follow CTA.

Why this works: it pays every pillar at once — hatching (the emotional
engine), warmth-as-reward (the glimpse), the withheld character, and the
deflected mystery MECHANICS §13 prescribes ("*why* the Flame really died")
— and it makes the level cap *canon*: the chapter ends because the story
pauses, not because the content ran out.

### ACT V — The Encore (open-ended) · for players who stay

"Keep Playing" returns to the board with the Golden Whelp following the
player's taps (cosmetic companion — it never works, it's a baby):

- **Order 4 becomes "Cindra's Hoard — an encore request"** [data] plus a
  small **repeatable order template** (N× gems, scaling N — [small]) so the
  Ledger never dead-ends.
- **Keeper's Tasks** [small]: a 5-item chapter checklist replacing daily
  quests (a demo shouldn't ask for a calendar — it should ask for one more
  session): *hatch 4 dragons · complete 5 orders · fill the board's moss ·
  earn 500 gold · make the Whelp dance (tap it 10×)*. Finishing all five:
  a golden chest rain + one last Cindra line. Lives as the second tab of
  Cindra's Ledger (one quest board, not two menus); the tab appears when the
  tutorial ends.
- The chapter card can be re-viewed from the HUD (the promise stays visible).

---

## 4. The "looking forward" system (threads pulled, by act)

| Thread | Planted | Paid in demo? | Paid in full game |
| --- | --- | --- | --- |
| Golden Egg ("it's warm…") | Act II | ★ Finale hatch | Golden breed chain |
| South terrace golden pulse | Act I fly-over | Half-glimpse only | Chapter 2 region |
| Cindra never speaks | whole demo | ★ One line at finale | Story spine |
| "The Flame was **taken**" | ★ Finale | No — the cliffhanger | Campaign mystery |
| Silhouette cards (breed/terrace) | Chapter card | No | Content roadmap |
| Golden Whelp (baby, can't work yet) | Act V | Companion only | Grows into a worker |

Principle: **pay 3 of 6 threads inside the demo** so the player trusts that
promises get kept — that trust is what converts the unpaid three into desire
instead of frustration.

---

## 5. Demo tuning table (delta from DESIGN-REVIEW §4)

| Knob | Ship value for demo | Why |
| --- | --- | --- |
| Dragon cooldown / passive | 25 s / 120 s | Act II must be active play |
| ENERGY_REGEN_MS / MAX | 60 s / 30 | session gate, not a wall |
| Crystal / Chest interval | 300 s / 300 s | dragon #2 + rhythm beats |
| Order 1 | 6× t1, +25 gold | 3-minute first win |
| `LEVEL_XP[2]` | **220** | finale lands on Order 3 |
| Golden Egg | unsellable, tap-flavor | the MacGuffin |
| Orders visible | 2 | choice = sandbox feel |
| Chest gold | +15 | matches sink scale |
| Warmth-skip price | ≥1.5× gold | don't burn the session meter |

Verification notes: all timer beats stay deterministic under
`window.advanceTime`; the e2e must extend past `free_play` to cover O1→O3 →
finale trigger (assert `EndScreen`/chapter-card AFTER `order:completed` ×3).
`tutorial.json` steps `dragon_rest` (185 000 ms) and `house_skip` (600 000 ms)
still work unchanged. Bump `SAVE_VERSION` for Keeper's-Tasks state.

---

## 6. Two valid session shapes (both must feel complete)

- **One sitting (~25 min):** the arc above, uninterrupted. All waits ≤ the
  time it takes to do something else fun (merge, rearrange, chest, tasks).
- **2–3 cozy sessions:** natural stop points after O1 and O2 (each ends on a
  celebration — "putting it down feels complete", MECHANICS §8.2). Requires
  the **welcome-back card** (DESIGN-REVIEW P1-3: consume the already-emitted
  `offlineMs`, bank 3 passive cycles) so session 2 opens on a small harvest
  + the Golden Egg tap-line — re-anchoring the promise in 5 seconds.

## 7. What this plan deliberately does NOT do

- **No daily quests / login streaks** — wrong tool for a demo; the Keeper's
  Tasks checklist and the cliffhanger do the retention work.
- **No new art-heavy content** — the Golden Whelp can be a gold-tinted
  existing rig; terrace silhouettes are static sprites; everything else is
  re-choreographed existing FX.
- **No economy depth** (gold sinks, key ladders, shop rework) beyond the
  DESIGN-REVIEW P0 hygiene — a 25-minute demo can't showcase them; ship them
  with Chapter 2. (Do still remove **keys from the shop** — first-impression
  players notice pay-for-progression instantly.)
- **No touching the tutorial's structure** — it's the best thing in the build.

## 8. Build order (maps to DESIGN-REVIEW waves)

1. **Retune** [data, hours]: §5 table — the demo becomes *playable* end-to-end.
2. **Threads** [data+small, ~1 day]: Golden Egg MacGuffin behavior, strawberry
   patch placement, 2-visible orders, order celebration wiring, T1/T2 lines.
3. **Finale** [med, 2–3 days]: the 5-step L3 sequence + chapter card (replaces
   `EndScreen('level3')`), fog half-glimpse, Cindra's line.
4. **Encore** [small, ~1 day]: repeatable order template, Keeper's Tasks,
   Whelp companion, welcome-back card.
5. **Verify** : `pnpm verify` + extend e2e through the finale; then a real
   10-person playtest measuring §9.

## 9. Success metrics for the demo

| Metric | Target |
| --- | --- |
| Median time to finale | 22–30 min |
| Players reaching finale | ≥ 70% of tutorial-completers |
| Longest no-input gap (post-tutorial) | < 45 s |
| Players clicking "Keep Playing" after chapter card | ≥ 40% |
| Players who can name what Chapter 2 promises (playtest question) | ≥ 8/10 |

The last one is the real test of "looking forward": if playtesters can't say
*"the fog terrace / the new dragons / what took the Flame"* unprompted, the
threads need to be louder.
