# The opening — Eleanor's arrival

> **Status: SCRIPT COMPLETE, NOT WIRED.** Final lines, beat intent and staging
> for the scene that replaces `lore_1` / `lore_2` in `src/data/tutorial.json`.
> This is the deliverable for **EMB-25**. Craft basis and sources:
> [research/game-openings.md](research/game-openings.md).

---

## 1. What the scene has to do

Five jobs, and a line that does only one of them is a line to cut.

| Job | Why it is non-negotiable |
| --- | --- |
| Put the player *in* the ruin before anyone frames it | The only uninterpreted impression the game will ever get |
| Establish Eleanor as competent | Her evasion is only interesting if her instruction is trustworthy |
| Open the mystery in the first minute | It is the retention spine, per the genre benchmark |
| Give one clear goal | "No clear goal in the first session" is a named cause of D1 churn |
| Hand over a verb | The scene ends with hands on the board, not with a sentiment |

**The skip test.** Cut the whole scene and the player must still know: the place
is ruined, a woman wants it restored, they are the one who can wake it. All three
are also legible from the art and the first merge. Nothing load-bearing is
carried by text alone.

## 2. The shape

The brief was that Eleanor teleports the Keeper in. The scene is built on
**the teleport missing** (the idea seeded on EMB-25), and that single change
earns four things at once: she is competent but overruled, the player sees the
sanctuary before it is framed, the isle gets agency from minute one, and the
mystery starts before she has withheld anything.

Two movements, split by the player's first action:

```
  [ 1.5 s of silent board — ash, no text ]
        │
  I.  arrival        6 bubbles, tap-gated     ~30 s      she talks, you look
        │
  ──  FIRST MERGE  ──────────────────────────────────────────────────────────
        │
  II. answered       1 bubble                 ~5 s       she reacts, off-balance
```

Six bubbles to first touch is the ceiling, not a target. The reason movement II
exists at all: her one genuinely unguarded moment should land **after** the
player has done something, because that is when it reads as a reaction to *them*
rather than as more script.

## 3. Constraints the script is written to

Verified against the build, not assumed:

- **Bubble capacity** — `TEXT_WIDTH` 940 px, 38 px bold, ~4 lines. Working
  budget **≤180 characters**. Every line below is under it; the longest is 174.
- **One talk bank.** `PortraitAnimator` plays
  `talk_the-ember-never-truly-went-out` for every line regardless of length, then
  rests. Line length is therefore free — no lip-sync constraint.
- **Expressions ARE wired** (EMB-36). All eight faces are baked into the disc
  atlas and `CharacterBubble.setExpression()` holds one. The script is still
  written to read correctly on a single neutral face — the tags in §5 sharpen it,
  they are not load-bearing.
- **The Keeper never speaks.** There is no player voice and no dialogue choice.
  Eleanor must therefore voice the player's questions and be seen to do it.
- **Tap is the only punctuation available**, and beat 4 uses it as punctuation
  deliberately (§5).

## 4. Her voice

Eleanor is a real mage, roughly the player's age, composed and precise — the
portrait is a woman with a crescent-moon earring and a guarded, level look, not
a wise old wizard. She should sound modern and plain. No archaisms.

Two signatures, both cheap and both carrying the authoring rule:

**She corrects herself.** She begins something true, hears herself, and
substitutes something safer. On the page it is an em-dash and a subject change.
This is the entire character in one device, and it is the Merge Mansion trick:
the mystery is manufactured by withholding in dialogue, not by worldbuilding.

**She is oblique about herself and plain about the rules.** Lore lines are
sideways; teaching lines are flat and clear. The player learns the difference by
ear, so when she later evades, they never doubt the instructions. This is the
EMB-25 authoring rule made audible rather than merely obeyed.

What she never does: flatter the player, call them chosen, use a title-drop
("Dragon Master of the ancient flame" is dead), or explain a system in the same
breath as a feeling.

## 5. The script

### Beat 0 — the held silence *(no text)*

Board visible, camera on the ash, **~1.5 s, no bubble.** Then the bubble slides
in. This is the whole of "the player sees the sanctuary before she frames it,"
and it costs one delay on the first `tutorial:step` emit.

---

### Beat 1 — the miss

> **You're not where I meant to put you.**

Six words, alone. Establishes in one line that someone placed the player here,
that it went wrong, and that she is surprised — which means she is normally not.
It starts on the player rather than on the world, and it is a *reaction*, which
implies everything before it without narrating any of it.
*Expression: surprised.*

### Beat 2 — where, and the first wrongness

> **This is Emberkeep. I aimed for the hall — the spell was clean, I've cast it a hundred times. Something set you down here instead.**

Spends the entire proper-noun budget on the one noun that is already on the app
icon. "The spell was clean" is her competence, stated flatly and without
defensiveness. **"Something set you down here instead"** is the first hook: not
that she failed, but that she was *overruled*, by something she does not name
because she cannot.
*Expression: worried.*

### Beat 3 — the ash

> **Watch your step. That grey isn't soil. Fires die slowly, from the edges in — this one went out all at once, everywhere, in a single night.**

The scale of the disaster arrives without the words "Great Flame", and the clue
is **deducible rather than stated**: fires do not do that. The player reaches
"something extinguished it" themselves, which is the only version of that fact
they will remember. Directs the eye at the actual board art.
*Expression: neutral.*

### Beat 4 — the near-slip *(two bubbles, and the tap between them is the point)*

> **You'll want to know what did that. So did I, once. I read every story there is. I crossed half the world for the rest. I was—**

> **…Later. You'll hear it better when you're not standing in it.**

The strongest beat in the scene, and the reason the whole thing works.

Three parallel clauses build a rhythm — *I read, I crossed, I was* — so the
fourth breaking is **audible**. The player taps expecting the end of a sentence
and receives a subject change instead: the interaction itself performs the
swallow. That is native to this medium and free.

*I was—* is two words that reframe everything. She is not a scholar of the
disaster; she was **present** for it, and she is not going to say so. It is
never confirmed here and should not be for a long time.

Note "So did I, **once**" — she has stopped wanting to know. Whether that is
because she found out or because she gave up is the question the arc answers.

And the second bubble is a kindness that is also an evasion, readable as either
until much later. Do not soften it further; do not add a third bubble.
*Expressions: determined, then sad.*

### Beat 5 — why you

> **And why you: when you landed, the ash under your hands went warm. It hasn't done that for anyone in sixty years. I watched it happen and I still don't believe it.**

Answers the one question the scene is willing to answer, and answers it with a
**physical fact the player caused** rather than with destiny. No chosen-one
flattery: nobody says *chosen*, they say *the ash went warm*. "Sixty years" is
concrete and costs four syllables. And "I still don't believe it" is the first
crack — she is not surprised that it happened, she is surprised that it worked,
which is a different thing and the player has no way to hear it yet.
*Expression: neutral — this is a rules line, so it is delivered plainly.*

### Beat 6 — the ask, and the name

> **So I'll ask instead of explaining. Bring this place back — the warmth, the green, and whatever's still asleep beneath the ash. I can't wake any of it. You can, Keeper.**

The goal, stated once, in plain language: restore the sanctuary. "The warmth, the
green" is the only promise of the cozy game the player actually downloaded, and
it is doing that job alone — the art carries the rest.

"So I'll ask instead of explaining" has her **name her own evasion**, which is
what keeps it charming rather than irritating. "Whatever's still asleep" is the
dragons, unnamed. **"I can't wake any of it"** is the flat admission the whole
campaign hangs on, delivered as if it were a scheduling detail — and the scene's
final word christens the player. That is the last thing they read before their
hands move.
*Expression: determined.*

---

### Beat 7 — answered *(after the first successful merge)*

> **…It answered you. Sixty years I've stood outside this place, and it answers you in the first minute. …Good. Again.**

The first merge is rewarded with **character** rather than confetti, which is
rare in this genre and is what makes the tutor feel present. She is genuinely
off-balance, and then covers it — the abrupt *"…Good. Again."* is the Hecate
register: strict on the surface, warm underneath, teaching through the action
you just took.

It also silently repeats the thesis for anyone who skipped movement I: the isle
responds to *you* and to nobody else.
*Expression: surprised.*

## 6. Drop-in steps

Replaces `lore_1` and `lore_2` at the head of `src/data/tutorial.json`. Schema
matches the existing tap-gated steps exactly; no new gate, effect or allow types.

```jsonc
{ "id": "arrival_miss",  "speaker": "eleanor", "gate": { "type": "tap" }, "allow": {},
  "text": "You're not where I meant to put you." },

{ "id": "arrival_place", "speaker": "eleanor", "gate": { "type": "tap" }, "allow": {},
  "text": "This is Emberkeep. I aimed for the hall — the spell was clean, I've cast it a hundred times. Something set you down here instead." },

{ "id": "arrival_ash",   "speaker": "eleanor", "gate": { "type": "tap" }, "allow": {},
  "text": "Watch your step. That grey isn't soil. Fires die slowly, from the edges in — this one went out all at once, everywhere, in a single night." },

{ "id": "arrival_slip",  "speaker": "eleanor", "gate": { "type": "tap" }, "allow": {},
  "text": "You'll want to know what did that. So did I, once. I read every story there is. I crossed half the world for the rest. I was—" },

{ "id": "arrival_hold",  "speaker": "eleanor", "gate": { "type": "tap" }, "allow": {},
  "text": "…Later. You'll hear it better when you're not standing in it." },

{ "id": "arrival_why",   "speaker": "eleanor", "gate": { "type": "tap" }, "allow": {},
  "text": "And why you: when you landed, the ash under your hands went warm. It hasn't done that for anyone in sixty years. I watched it happen and I still don't believe it." },

{ "id": "arrival_ask",   "speaker": "eleanor", "gate": { "type": "tap" }, "allow": {},
  "text": "So I'll ask instead of explaining. Bring this place back — the warmth, the green, and whatever's still asleep beneath the ash. I can't wake any of it. You can, Keeper." }
```

`arrival_answered` is beat 7 and belongs **after** the first merge step, not
here. Because the merge roster is mid-migration ([merge-chains.md](merge-chains.md)
§7, EMB-17), beat 6 deliberately ends on a chain-agnostic verb — *"start with
your hands"* is implied, never a named item — so this script drops in whether the
first merge is still `ember_dragon` or has become an `emberberry_plant` seed.

Two engine notes for whoever wires it:
- **Beat 0** is a ~1.5 s delay before the first `tutorial:step` emit. It is the
  cheapest line in the scene and the one most likely to get dropped by accident.
- `pnpm e2e` drives the full tutorial and will need its step count updated — the
  opening goes from 2 steps to 7.

## 7. One thing found while writing

`tutorial.json` still refers to Eleanor **in the third person in her own
dialogue**, left over from the Cindra→Eleanor cast merge:

- `golden_tease` — *"…Eleanor guards its story."*
- `free_play` — *"Fill Eleanor's Ledger — she guards something golden…"*

Both are spoken by Eleanor. They read as a different character being quoted, and
they are the last two lines of the tutorial. Not fixed here — it is outside this
scene — but they should not ship.
</content>
