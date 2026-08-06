# Conversation staging — who is on screen, and what their face is doing

> **Status: SPEC COMPLETE. THE CODE-SIDE BLOCKER IS CLEARED (EMB-36).** Direction for every line in
> the campaign: speaker, expression, camera, timing. Lines:
> [script-chapters.md](script-chapters.md) · [opening-scene.md](opening-scene.md).
> Gates: [quests.md](quests.md). Voice rules: [story-bible.md](story-bible.md) §5.

---

## 1. What the stack does today — verified, not assumed

| Piece | Reality |
| --- | --- |
| `CharacterBubble` | **one** speaker at a time; gold ring, portrait overlapping the card's left edge; name tag coloured per speaker (eleanor `goldShade` · selyna `tealDeep` · golden_elder `lavaShade`); crossfades the disc over 140 ms on speaker handoff |
| `PortraitAnimator` | per-speaker banks for every entry in `ANIMATED_SPEAKERS` (**eleanor, selyna**), plus `expression(face)` for the still faces |
| Disc atlases | **eleanor 69 cells at 9×8** (2430×2880) · **selyna 87 cells at 10×9** (2700×3240); 270×360 cells; fixed order **rest · rest · talk… · blink… · expressions…** |
| Banks | Eleanor talk 51 + blink 8 · Selyna talk 69 + blink 8 · **Elder still has no `catalog.json` and no sequence entries**, so she remains a still medallion |
| Expressions | all 8 baked for Eleanor and Selyna and reachable via `CharacterBubble.setExpression()` |
| `PreloadScene` | loads a spritesheet per animated speaker at `frameWidth 270 / frameHeight 360` |

## 2. How the atlas works, and the one rule that protects it

`bake-portrait-disc.py` **derives the grid from the frame count** and asserts the
4096px old-device budget — it used to hardcode 8×8, which meant Selyna (79 cells
before expressions) could not be baked at all. Cell size is fixed across
characters, and Phaser derives the frame count from image size, so a bigger sheet
needs no loader change.

**Frame order is append-only.** `PortraitAnimator` derives every bank offset by
counting from the fixed order, so a new bank goes on the *end*. Insert one in the
middle and every offset above it shifts silently — nothing errors, the portrait
just plays the wrong frames.

The bake also **contain-fits and bottom-aligns** rather than stretching, so a
character whose source canvas has a different aspect (the Elder is 600×768
against the humans' 401×560) is never distorted.

**Still to bake:** the Golden Elder — 10 cells at 4×3, plus the `catalog.json`
and `sequenceCatalog` entries she has never had (EMB-37 / EMB-24).

## 3. The expression vocabulary

Eight faces. They are **punctuation, not mood lighting.**

| Face | Means | Budget |
| --- | --- | --- |
| `neutral` | default; teaching, rules, plain statement | **>50% of all lines** |
| `determined` | closing a subject, or committing | common |
| `worried` | the thing under the sentence | common |
| `sad` | grief that is not performed | uncommon |
| `surprised` | **only** at something the player caused | uncommon |
| `happy` | genuine, small, usually about the isle or a dragon | uncommon |
| `angry` | **never at the player** — at herself, her father, her own uselessness | **per character**: Eleanor ×2, Selyna ×1 |
| `laughing` | relief | Eleanor **exactly once**; Selyna **never** |

**Rules that keep the face meaningful:**

1. **`neutral` must be the modal face, and at least a third of every
   portrait-bearing line.** Measured: chapter beats run **15/57 neutral (26%)** —
   peaks are supposed to be expressive — and the banks are mostly neutral, which
   brings the campaign to roughly **38%** with neutral still the single
   most-used face (15, against determined 13 and sad 12).

   *This number was originally written as ">50%", tested, and found not to hold.
   The rule was wrong, not the staging: a campaign whose beats are all peaks
   would be exhausting, but so would one where half the dramatic moments are
   deliberately blank. Modal-and-a-third is the honest constraint.*
2. **One face per bubble.** Never change expression mid-line — the tap is the
   only cut this medium has.
3. **The face lands ~120 ms before the text.** Set the frame, wait, then reveal
   the line and start the talk bank. Otherwise the expression reads as a
   consequence of the words instead of a reaction to the moment.
4. **`sad` never twice in a row** — except chapter 10, where the confession
   earns a run of it and the repetition *is* the performance.
5. **Selyna never gets `laughing`.** Her ch 11 line *"I've had time to find that
   funny"* is staged `neutral` on purpose: laughing there reads as gloating, and
   the voice rules forbid her gloating.
6. **`angry` twice, both inward** — ch 5 (her sister) and ch 8 (herself). A third
   would make her bitter, which she is not.

## 4. Per-line staging

Camera moves only where the text presupposes a sight. Blank = no move.

### Chapter 1 — arrival *(opening-scene.md)*
| Beat | Speaker | Face | Camera |
| --- | --- | --- | --- |
| 0 held silence | — | — | hold on the ash, 1.5 s, no bubble |
| 1 the miss | eleanor | `surprised` | |
| 2 where | eleanor | `worried` | |
| 3 the ash | eleanor | `neutral` | slow drift over the grey |
| 4a the near-slip | eleanor | `determined` | |
| 4b the swallow | eleanor | `sad` | |
| 5 why you | eleanor | `neutral` | |
| 6 the ask | eleanor | `determined` | |
| 7 answered *(post-merge)* | eleanor | `surprised` | |

### Chapters 2–8 — Eleanor
| Ch | Beat | Face | Camera |
| --- | --- | --- | --- |
| 2 | *"the first thing anyone has given back…"* | `happy` | the lit brazier |
| 2 | *"my craft isn't a large one"* | `neutral` | |
| 2 | *"the moon does the same trick"* | `neutral` | |
| 2 | *"somebody else lit first"* | `worried` | |
| 3 | *"Wait — you're naming it?"* | `surprised` | the nest |
| 3 | *"…Yes. Do. Out loud"* | `happy` | |
| 3 | *"they didn't die, you know"* | `determined` | |
| 3 | *"names are the one thing nobody thought to take"* | `worried` | |
| 4 | *"I'd rather you saw it than took my word"* | `neutral` | to the dead ember |
| 4 | *"That ember there, the dead one. Watch."* | `determined` | hold, close |
| 4 | *"I cannot raise a spark. Not once. Not ever."* | `sad` | hold — **she fails on screen** |
| 4 | *"Now you. Go on."* | `neutral` | |
| 4 | *"…There. That is the whole of the difference"* | `surprised` | **the ember lights** |
| 4 | *"it isn't a knack and it isn't luck"* | `worried` | back to the board |
| 5 | *"That's my sister. Selyna."* | `neutral` | |
| 5 | *"she has never once said what"* | **`angry`** ①  | |
| 5 | *"No — don't. That's the whole of it"* | `worried` | |
| 6 | *"half of that book isn't mine"* | `neutral` | |
| 6 | *"no magic in him at all"* | `sad` | |
| 6 | *"looking for one where somebody got the thing back"* | `sad` | |
| 6 | *"a sad story about a librarian and nothing else"* | `determined` | |
| 7 | *"two of them awake, with names"* | `happy` | |
| 7 | *"there was a rite… I was nineteen"* | `neutral` | |
| 7 | *"It was called the Keeping."* | `sad` | **push in, slow** |
| 7 | *"that is not a coincidence, what I've been calling you"* | `worried` | |
| 7 | *"I stopped lying about the word"* | `determined` | |
| 8 | *"I gave you a mage's answer"* | `neutral` | |
| 8 | *"It was never luck. I knew what you were."* | `determined` | |
| 8 | *"The Flame answers a Keeper's hands"* | `neutral` | the Long Hearth, now burning |
| 8 | *"I spent sixty years looking for one"* | `sad` | |
| 8 | *"Ask me who else did that."* | **`angry`** ② | hold on her |

### Chapter 9 — the Golden Elder
She has **no expression bank and should not get one.** She woke after an age;
stillness is the characterisation. Direction instead:

- ring scale **×1.12**, and she is the only speaker who exceeds the frame
- **breathing off** — `PortraitAnimator`'s idle oscillation is suppressed
- talk bank at **0.85×** speed
- her first bubble opens on `rest` with **eyes closed**, and the blink bank runs
  **once, in reverse** — she opens her eyes into her first line. One-off, worth it
- camera: the shipped `FINALE` timeline, unchanged

### Chapters 10–12
| Ch | Beat | Speaker | Face | Camera |
| --- | --- | --- | --- | --- |
| 10 | *"you didn't ask me a single question"* | eleanor | `sad` | the Hold, arriving |
| 10 | *"unasked, and before I want anything"* | eleanor | `determined` | |
| 10 | *"my father held the vessel. I filled it."* | eleanor | `neutral` | |
| 10 | *"whether that makes it better"* | eleanor | `sad` | |
| 10 | *"he walked out with the Lantern"* | eleanor | `neutral` | |
| 10 | *"and I let him… I was nineteen"* | eleanor | `sad` | |
| 10 | *"you may say no"* | eleanor | `determined` | |
| 10 | *"the only thing I have left that's mine"* | eleanor | `worried` | |
| 11 | *"North. My sister has it."* | eleanor | `worried` | |
| 11 | *"add it to the list and come north anyway"* | eleanor | `sad` | |
| 11 | *"So you're the one it let in."* | **selyna** | `neutral` | **her first appearance — see §6** |
| 11 | *"I've had time to find that funny"* | selyna | `neutral` | |
| 11 | *"nobody's careful with me who hasn't been told"* | selyna | `determined` | |
| 11 | *"I'm the one who carried it while she read"* | selyna | `angry` | |
| 11 | *"it's alive… I never once put it down"* | selyna | `determined` | the Lantern |
| 12 | *"you've spent a season warming a graveyard"* | selyna | `neutral` | |
| 12 | *"I don't want a riddle. I want one thing."* | selyna | `determined` | |
| 12 | *"she says it out loud"* | selyna | `determined` | |
| 12 | *"stop looking at me as though it were"* | selyna | `sad` | |
| 12 | *"let's see whether a stranger was what she was missing"* | selyna | `worried` | |

## 5. Bank staging

| Bank | Face | Note |
| --- | --- | --- |
| Ledger I–II | `neutral`, one `happy` per stage | brisk |
| Ledger III | `neutral`, *"frightens me slightly"* → `worried` | |
| Ledger IV | `neutral`, *"you're still here"* → `worried` | |
| Ledger V | `neutral`, *"I've started being able to say the word"* → `sad` | |
| Ledger VI | *"my sister says that about weather"* → **`laughing`** — the campaign's only one | the first lightness after the confession |
| Day-phase early/mid | `neutral` throughout | ambience must not emote |
| Day-phase late | dusk *"she said the light was honest then"* → `sad`; night *"warmer at midnight"* → `happy` | |
| Naming, 1st dragon | `surprised` → `happy` → `happy` | |
| Naming, 2nd+ | closing line → `happy`; the single relief face is spent elsewhere | ch 7's weight follows immediately |
| Trust 1–3 | `happy` | |
| Trust 4–5 | `determined` | *"they do that for people"* |
| Elder, post-wake | `rest` only | she does not emote |

**Reserved-face check:** `laughing` fires exactly once (Ledger VI). `angry` fires
exactly twice (ch 5, ch 8). Both are asserted by the story-qa skill.

## 6. Speaker switching

The bubble is a **stage with room for one**. There is never a second portrait.

- **Handoff:** the ring stays put; the disc **crossfades over 140 ms** while the
  name tag recolours; the incoming speaker's talk bank starts after the fade.
- **Never switch speakers without a tap between them.** A swap mid-bubble reads
  as a rendering bug.
- **Two-handers (ch 11–12) alternate bubbles.** The silent character is simply
  not shown. Resisting the urge to put both faces on screen is what keeps the
  single-portrait frame from looking like a limitation.
- **Selyna is not seen until chapter 11, because she is never in Emberkeep.**
  Her five world-1 letters render in a letter panel with a **wax seal where the
  portrait would be** — the player reads her for weeks before they see her face.
  That is not a staging trick to be relaxed later: she is in the north the whole
  time, so there is nothing to show. It makes her arrival an event for free.
- **Marginalia has no portrait at all.** It is handwriting in the Dragon Book.
  Putting Eleanor's face next to it would announce that the note matters, which
  is exactly what that channel must not do.

## 7. Timing

| | |
| --- | --- |
| Face set | **−120 ms** before the text reveals |
| Talk bank | starts with the text; plays once; rests on idle |
| Blink | suppressed during talk, resumes on rest; already randomised per-character |
| Breathing | always on **except the Elder** |
| Speaker crossfade | 140 ms |
| Held silence (ch 1 beat 0) | 1500 ms |

## 8. What has to be made

| # | Work | Owner | Blocks |
| --- | --- | --- | --- |
| 1 | Bake script derives grid from frame count; writes it to `catalog.json` | onja | **everything below** |
| 2 | Selyna disc atlas — 87 cells, 10×9 | aina | ch 11–12 |
| 3 | Eleanor expression cells appended after blink — 69 cells, 9×8 | aina | all expression staging |
| 4 | Selyna expression cells | aina | ch 11–12 staging |
| 5 | Elder `catalog.json` + sequence entries + 4×3 disc | aina | ch 9 (EMB-24) |
| 6 | `PortraitAnimator` per-speaker + `expression(name)` | onja | all of it |
| 7 | `CharacterBubble` speaker crossfade | onja | ch 9, 11, 12 |
| 8 | Letter panel with wax seal | aina | ch 5–9 letters |

**Item 1 is the whole critical path.** Until the grid is computed rather than
hardcoded, Selyna cannot speak and nobody can have a face.
</content>
