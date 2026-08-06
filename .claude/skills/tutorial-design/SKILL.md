---
name: tutorial-design
description: Audit and author Emberkeep's tutorial and its just-in-time lessons — concept coverage, dead input, deadlocks, and teach-at-point-of-need ordering. Use before shipping any change to tutorial.json, the allow-list contract, or anything that puts a new interactive object on screen.
---

# Tutorial design — coverage & non-blocking audit

The tutorial is the largest drop-off surface in the game (`docs/research/onboarding.md`).
Two failures matter and nothing else does:

- **A concept the player meets but was never taught.** They meet it as friction.
- **A step the player cannot leave.** They meet it as a bug, and they leave.

You are auditing for those two. You may author beats; you may not invent
mechanics to teach.

## The corpus

| File | Authoritative for |
|---|---|
| `src/data/tutorial.json` | the scripted linear flow — the only thing that gates input |
| `src/data/dialogue.json` → `hints` | the one-shot post-tutorial lessons |
| `docs/tutorial-coverage.md` | **the concept ledger** — every concept, where it first appears, where it is taught |
| `src/core/types.ts` | `TutorialGate` / `TutorialAllow` / `TutorialEffect` — the contract a beat may use |
| `src/systems/TutorialDirector.ts` | which gate events are actually subscribed |
| `src/scenes/BoardScene.ts`, `src/scenes/UIScene.ts` | where `allow.*` is enforced |
| `src/data/chains.json`, `map.json`, `orders.json` | what is on screen, what it costs, what it needs |

## Run the mechanical pass first

```sh
python3 .claude/skills/tutorial-design/scripts/ftuecheck.py
```

It checks what a script can check: gate↔allow consistency, unreachable gates,
unsubscribed gate events, coverage against the ledger, teach-order, bubble
length, and one-verb-per-beat. It exits non-zero on any ERROR. **The judgement
checks below are not in it** — never stop at a clean script run.

## The seven laws

### 1. Every concept is taught where it appears
A concept is *available* the moment its object is on screen and can be touched.
Not when it is useful, not when the designer thinks about it — when it is
**visible and live**. Walk the ledger: for each row, the teach-point must be at
or after first-appearance, and before the first moment the player is expected to
have used it.

The two ways to fail:
- **Untaught** — no beat, no hint. The Ledger sat dimmed on screen for the whole
  tutorial and `free_play` then said "fill my Ledger". That is the archetype.
- **Taught too late** — the concept is referenced by an earlier line. A bubble
  saying "sell a spare piece" before selling was ever demonstrated is a
  forward reference, and forward references read as missing UI.

### 2. Nothing is a dead end
Every object revealed must be **actionable to completion** with what the player
can reach. Specifically: a merge chain revealed with fewer than 3 of a tier and
no producer is dead stock. It is worse than absent — the player tries, fails,
and concludes the game is broken. Either complete the set, give it a producer,
give it a second verb (sell/store), or don't reveal it yet.

### 3. No silent refusal
An input the tutorial disallows must **answer**. A tap that returns without a
sound, a pulse or a nudge is indistinguishable from a broken button. Refused
input re-points at what the step actually wants.

### 4. Gates must be satisfiable, always
For each step, prove the gate can be met from the state the step begins in:
- the object the gate names **exists** (spawned by an earlier effect or on the map),
- the input the gate needs is in that step's own `allow` (see law 5),
- every **cost** is affordable in the worst case — the price of a skip is
  `skipWarmthCost(remaining, total, maxGold)`, not a guess. Quote the arithmetic.
- nothing earlier could have **consumed** the object. Tap-to-store, selling and
  delivery all remove pieces; a scripted piece must be protected or replaceable.

### 5. `allow` is a contract with the gate
The allow-list of a step must contain the verb its own gate requires. The map:

| gate | requires in `allow` |
|---|---|
| `item:merged`, `item:hatched` | `drag` includes that chain |
| `item:harvested`, `chest:open` | `tapGenerators` |
| `generator:skipped` | `tapGenerators` |
| `dragon:working` | `dragonWork` + `drag` includes the dragon chain |
| `region:unlocked` | `fog` |
| `marketplace:purchased` | `marketplace` |
| `ui:cookbook_opened` / `_closed` | `cookbook` |
| `ui:ledger_opened` | `ledger` |
| `order:completed` | `ledger` **and** `deliver` |
| `bag:stored` | `bag` |
| `item:sold` | `sell` |
| `character:action_used` | `character` |

A gate whose verb is not allowed is an unwinnable step. This is the single most
mechanical way to ship a hard lock, and the checker enforces it.

### 6. One verb per beat
A bubble teaches exactly one action. Two imperatives in one bubble means the
player does the first and the second is never learned. Naming a second concept
in passing (what Gold is *for*, that Warmth returns on its own) is fine —
**asking for a second action is not**.

### 7. Effects never break the tune
`grantXp` in the tutorial is load-bearing: `LEVEL_XP = [0, 60, 220]` and the
scripted beats deliver **exactly 60** by the `levelup` step. Any beat that adds
XP before it — an order delivery is 30 — moves Level 2 off its scripted beat and
desynchronises the whole finale. Re-derive the total when inserting anything
that pays XP, and place XP-paying beats after `levelup` unless you retune.

Inserting or removing a step also shifts `tutorialIndex`, which is **persisted**.
Bump `SAVE_VERSION` or mid-tutorial saves resume on the wrong beat.

## Judgement checks the script cannot do

- **Does the line teach the verb, or describe the outcome?** "Merge them" is a
  lesson; "a dragon stirs inside" is flavour. Every gated beat needs both, in
  that order of priority.
- **Is the reward legible?** A beat that pays should show the payment (the gem
  flies to the Ledger, the coin to the gauge). Invisible rewards teach nothing.
- **Would a player who ignores the bubble still succeed?** They should — the
  hand and the highlight carry the lesson for the ~60% who don't read.
- **Voice.** Tutorial bubbles are Eleanor's, and `docs/story-bible.md` §5 governs
  them exactly as it governs the script. She is plain about rules. She never
  says "tap the button to continue".

## Severity

| | |
|---|---|
| **ERROR** | The player can be stuck, or meets a live object with no lesson anywhere. Blocks. |
| **WARN** | Taught, but late, thin, or in the same breath as another verb. |
| **NOTE** | Ledger drift, or a judgement call worth a second opinion. |

## Output

One table, ERRORs first, then the verdict. No rewrites in the table.

```
| Sev | Law | Where | Finding | The player path that breaks |
|-----|-----|-------|---------|------------------------------|
```

`Where` is `file:line` or `step <id>`. Close with **PASS** or **FAIL (n errors)**.
If a check could not run, say so — never report a check as passing because it
was skipped.
