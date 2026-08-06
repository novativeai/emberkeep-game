# World characters — Eleanor and Selyna on the map

> **Status: SPEC, NOT BUILT.** Eleanor and Selyna stand *in the world* rather
> than on the merge board, and can be asked to help — starting with shortening a
> countdown. Story canon: [story-bible.md](story-bible.md). Relationship axes and
> the GIVE verb: [quests.md](quests.md). Bubble staging: [conversation-staging.md](conversation-staging.md).

---

## 1. Where they stand, and why it matters

Eleanor **walks Emberkeep with the player.** Nothing bars her from the isle. What
she cannot do is *wake* anything — the Flame answers a Keeper's hands, and the
player is the only living person who has them. She is a real mage standing right
there, able to help with almost everything, and useless at the one thing that
matters.

That is the constraint this feature has to express, and it expresses it far
better standing beside the player than it would at a distance:

> **Eleanor can be asked to help with anything except waking.** Ask her to
> shorten a timer and she will. Tap her onto a Cold Nest, a sleeping dragon, or a
> dead ember and she declines — *"That one's yours."*

The player hits that refusal every session, for weeks, long before chapter 8
explains it. The mechanic teaches the mystery, and it does it through a thing the
player tried to do rather than through a line they were told.

**Selyna, in Borealis, is the same shape.** Her craft preserves rather than
returns, so her help is different, but she cannot wake a dragon either. Nobody
can. That is the whole point of the Keeper.

**Selyna never appears in Emberkeep.** Not in world 1, not after the sisters
reconcile, not as a visitor. She is in the north running her own sanctuary, and
she stays there. Her only presence in Emberkeep is her letters — which is exactly
why they land: a woman you have never seen, writing about you, from somewhere you
cannot go.

## 2. What a world character is

**Not a BoardItem.** The naming law holds: *anything on the merge board is
anonymous and consumable; anything with a name never touches it.* A character
that could be dragged, and bounced, would teach the player she is furniture.

She is **map decor with a tap handler** — rendered by BoardScene at a world
anchor, depth-sorted with the scenery (`itemBase + screenY`), never on a tile,
never in `state.items`, never draggable, never merged, never sold.

Anchors live in a **new `src/data/characters.json`**, not in `map.json` —
`map.json` is hand-tuned and must never be regenerated wholesale, so anything
authored beside it should sit in its own file that a world re-export cannot
clobber.

## 3. Placeholder art, and the road to 3D

Blocking uses the house convention already in the codebase: **placeholder art is
painted at runtime by `TextureFactory`, and real art swaps in via
`assets.json` (`source: "file"`)**. So the blockout is a painted standee — a
silhouette at the right footprint and height, correct anchor, correct depth —
and no pipeline changes when the real art arrives.

For 3D later, the lane already exists: the cel-shaded crystal decor is rendered
offscreen by three.js and composited as a texture. A character mesh follows the
same path, so **nothing in this spec has to change when they become 3D** —
only the texture source does.

## 4. Asking for help

Each character offers actions on a cooldown. Actions are **free** — she is help,
not a shop. Nothing here may be purchasable: chapter gates and character help
stay time-and-care bound, exactly like nests and Trust.

Both actions come from the character's craft, so the fiction and the mechanic
are the same sentence.

**Eleanor — Give Back.** *She cannot create heat. She can return what the isle
already spent.* Tap her, then tap one producer: its current timer completes.
Single target, one burst, long cooldown.

**Selyna — Keep.** *Her craft is preserving.* While she stands somewhere, every
timer within her radius runs at half cost. Area, sustained, no target.

Burst-vs-sustained is the whole difference, and it matches who they are.

**Regard is what improves them** (`quests.md` §1.3, 0–5, raised by chapter quests
and keepsake gifts). Higher Regard shortens Eleanor's cooldown and widens
Selyna's radius. Help gets better because the relationship does — which is the
point of having a relationship axis at all.

**Cooldowns read `GameClock.now()`**, never `Date.now()`, so `advanceTime(ms)`
stays deterministic and the e2e can drive them.

## 5. Architecture

A new `WorldCharacterSystem` owns character state — anchor, cooldowns, whether an
action is armed — in `GameState`, and it **never touches a timer directly.** It
emits the same skip command the Warmth/Gold skip already uses, so
`GeneratorSystem` remains the single owner of generator timers. The character is
a new *reason* to skip, not a second implementation of skipping.

That is the whole reason to route it through the bus: the day someone changes how
skipping works, it changes once.

New events, following the shipped naming:

- `ui:character_tapped { characterId }` — intent
- `ui:character_action_requested { characterId, action, target? }` — intent
- `character:action_used { characterId, action, readyAt }` — fact
- `character:action_failed { reason: 'cooldown' | 'invalid_target' }` — fact,
  because a refusal must never be silent

## 6. What this touches elsewhere

- **Staging.** Eleanor now exists in two places at once: the standee is where she
  *is*, the bubble is how she *speaks*. They are not the same object and must not
  fight — when she has a line, the camera may look at her standee, but the
  portrait still carries the performance.
- **The tutorial** never introduces her standee before the opening's beat 6 — she
  is off-screen until she has asked for something.
- **`docs/ripple-map.md`** should be re-scanned after this lands; it is the
  adjacency reference for exactly this kind of cross-cutting addition.

## 7. Open, and worth deciding before it is built

- **Does Eleanor follow the player, or stand at authored spots?** Following feels
  companionable but risks her wandering through the middle of a merge the player
  is trying to read. Authored spots per region are simpler, keep her clear of the
  board, and let her be *placed* somewhere meaningful (beside the nest she cannot
  warm, beside the altar she cannot light). The second is probably better, and it
  is certainly cheaper.
- **Should she appear in Emberkeep before she has asked for anything?** No — the
  tutorial's opening is her arrival, and a standee visible during beats 1–5 would
  answer "where is she standing" before the scene has established that she is
  here at all.
