---
name: tutorial-editor
description: Author and edit Emberkeep's scripted tutorials — the main Chapter One script and the mid-game lessons that start on triggers — beat by beat, through the World Builder's 📜 Tutorial tab or its /__tutorial dev-server API. Use whenever asked to add, move, reword, retarget or delete a tutorial step, create a lesson that fires mid-game ("when the player reaches Borealis, teach…"), change what a beat allows or points at, or inspect what a beat involves. Pairs with `tutorial-design` (the audit) — this skill is the hands, that one is the law.
---

# Tutorial editor — the hands for `src/data/tutorial.json`

One file, one model, three ways in (all equivalent, all validated the same way):

| Way in | Use it when |
|---|---|
| **World Builder → 📜 Tutorial tab** (`tools/worldbuilder/index.html`, served by `pnpm dev` at `/tools/worldbuilder/`) | a human wants to SEE the sequence — every beat as a card with its four facets |
| **`scripts/tut.py`** (this skill) | you are editing on the user's behalf from the shell |
| **`/__tutorial` HTTP API** (`tools/tutorial-api/server.ts`) | anything else that needs to read or write the script |

Every write goes through `validateTutorialData` (`src/core/tutorialScripts.ts`) BEFORE it lands on disk: a trigger that points nowhere, a duplicate id, a malformed gate — refused with the reason, file untouched. The same validator runs in the unit suite against the committed file.

## The model

```
TutorialData
├── steps: TutorialStepConfig[]        ← the MAIN script: id `main`, trigger `start`, allowBase `nothing`
└── tutorials?: TutorialScriptConfig[] ← mid-game scripts
      { id, title?, trigger, allowBase? ('everything' default), steps }
```

A **script** is a sequence of **steps** (beats). The main script plays from the first frame; every other script waits for its **trigger** — AND for the main script to be done (two lessons never hold the board at once; a trigger met while another lesson plays is re-checked the moment it hands back). Progress of mid-game scripts lives in stats (`tut:<id>:step` / `:done` / `:started`), so it is saved, monotonic, needs no SAVE_VERSION, and a reload resumes a lesson on its beat.

**Triggers** (all save-derivable):

| trigger | fires when |
|---|---|
| `{type:'step_done', tutorial, step}` | that step of that script is passed — "step 1 done". `tutorial` may be `main`. |
| `{type:'tutorial_done', tutorial}` | that script finished |
| `{type:'event', event, chain?}` | the bus fact was observed (latched into stats the moment it fires, so it survives reload — observed before main ends still counts) |
| `{type:'quest_done', quest}` | `q:done:<quest>` latch |
| `{type:'level', min}` | Keeper level ≥ min |
| `{type:'world', world}` | the Keeper is standing in that world (checked on `world:ready`) |
| `{type:'stat', key, min}` | any stats counter ≥ min |

`allowBase` is what a step's `allow` merges onto. The main script opens one verb at a time (`nothing`). A mid-game lesson defaults to `everything` — a tip takes nothing away unless its author lists what to hold back. Set `allowBase: 'nothing'` for a real lesson that must own the board.

**A step's four facets** — what the editor shows per card, and what `tut show` prints:

- **Elements** — what it highlights (`highlight`), what the hand carries (`hand.from → to`) or points at (`hand.ui` / `fogRegion`), what the arrow points at (`arrow`, `arrowThen` after a character is armed), what its gate names, what it spawns, who speaks.
- **Actions** — the **gate** (what the player must do: `tap`, `event` + chain/currency, `count`, `move`), then the **effects** fired once on entry (`spawn`, `retier`, `grantKeys`, `grantXp`, `nameDragon`, `wantGift`, `openCodex`, `sleepDragon`).
- **Dialogue** — `speaker` + `text`. Eleanor's voice rules in `docs/story-bible.md` §5; names in `docs/naming.md`.
- **States** — the `allow` contract (chips on/off over the base), panels the beat holds or opens (`codexHold`, `openCodex`), whether it is the last beat (hands the game back).

## Running it

The API lives on the ONE dev server (port 5173 is strict — a second `pnpm dev` fails by design). Check first, start only if nothing is listening, never leave one you did not start:

```sh
lsof -nP -iTCP:5173 -sTCP:LISTEN || (pnpm dev > /dev/null 2>&1 &)
python3 .claude/skills/tutorial-editor/scripts/tut.py ls
```

If the server was already running when `tools/tutorial-api/server.ts` changed, the owner of that server must restart it — the middleware is loaded at boot.

## Recipes

```sh
TUT=".claude/skills/tutorial-editor/scripts/tut.py"
$TUT ls                                        # every script and its trigger
$TUT show main                                 # every beat, four facets each
$TUT show main moss_stump                      # one beat
$TUT context gateEvents                        # what an event gate may listen for
$TUT context allowKeys                         # the allow contract's keys

# reword a beat
$TUT edit main moss_stump --set 'text="See that charred stump? Tap it."'

# open a verb on a beat / hold the Codex / retarget the arrow
$TUT edit main codex_meal --set 'allow={"codexHold":true}' --set 'arrow={"ui":"codex_card"}'

# insert a beat after another (ids are GLOBALLY unique across scripts)
$TUT add main --after ash_green --step '{"id":"ash_tip","speaker":"eleanor","text":"Three tufts make a bundle.","gate":{"type":"tap"}}'

# a mid-game lesson: plays when the player first stands in Borealis, keeps the game open
$TUT add-script north_hello --title "The north" --trigger '{"type":"world","world":"borealis"}'
$TUT add north_hello --step '{"id":"north_hello_1","speaker":"selyna","text":"Cold, is it not? The floes are mine.","gate":{"type":"tap"}}'

# a lesson that waits for a beat of another script ("step 1 done")
$TUT add-script after_moss --trigger '{"type":"step_done","tutorial":"main","step":"ash_green"}'

# move / reorder / delete
$TUT mv main ash_tip --to 9
$TUT reorder north_hello north_hello_1 north_hello_2
$TUT rm main ash_tip
$TUT rm-script after_moss

$TUT validate                                  # shape + tutorial-design's ftuecheck.py
```

Raw HTTP, when not using the CLI: `GET /__tutorial` → `{scripts}`; `GET /__tutorial/context`; `PUT /__tutorial` ← `{scripts}`; `POST /__tutorial/op` ← one of `add_script | remove_script | update_script | add_step | update_step | remove_step | move_step | reorder` (shapes in `tools/tutorial-api/server.ts` `EditOp`); `POST /__tutorial/validate`.

## The laws you are editing under (non-negotiable)

1. **Run the audit after every change**: `tut validate` (or `python3 .claude/skills/tutorial-design/scripts/ftuecheck.py`), then `pnpm test`. The `tutorial-design` skill holds the seven laws; the two that bite most when editing:
   - **gate ↔ allow**: a step's own `allow` must contain the verb its gate needs (`item:merged` → `drag` includes the chain; `item:harvested` → `tapGenerators`; `ui:codex_*` → `codexHold`; …). ftuecheck enforces the table.
   - **XP tune**: the main script pays EXACTLY 60 XP by `levelup` (`LEVEL_XP`). Any beat that adds XP before it moves Level 2 off its scripted beat.
2. **Inserting, removing or reordering MAIN beats shifts every persisted `tutorialIndex`** → bump `SAVE_VERSION` in `src/core/Constants.ts` with a ledger line, or mid-tutorial saves resume on the wrong beat. Mid-game scripts do NOT need this (their progress is keyed by script id in stats).
3. **Step ids are globally unique** across all scripts — UIScene/BoardScene key special choreography on ids (`crystal_tap`, `golden_tease`, `house_skip`, `key_unlock`, `levelup`, `gate_wake`…). Renaming one of those is a code change, not a data edit.
4. **`docs/tutorial-coverage.md` is the concept ledger** — a concept put on screen by a new beat needs its row; ftuecheck parses the table and fails the audit on a teach-point that is not a step id or hint key.
5. **`tests/e2e/level1.spec.ts` drives the main script beat by beat** — a new or removed main beat usually needs its `waitStep` sequence updated.
6. Effects fire ONCE on entry into a beat, never on resume; prompts (`nameDragon`, `wantGift`, `openCodex`, `sleepDragon`) are replayed on resume. Do not rely on an effect re-running.
7. A mid-game script with **no beats never plays** (the director skips it) — the editor warns; finish it or delete it.

## Files

- `src/data/tutorial.json` — the data (JSON-only edits; never hand-hack indices)
- `src/core/tutorialScripts.ts` — `scriptsOf` / `dataOf` / `triggerMet` / `validateTutorialData`
- `src/systems/TutorialDirector.ts` — runs scripts; mid-game progress in stats
- `tools/tutorial-api/server.ts` — the API (pure `applyOp` + middleware), mounted in `vite.config.ts`
- `tools/worldbuilder/index.html` — the 📜 Tutorial tab (`TUT` module at the end of the main script)
- `tests/unit/TutorialScripts.spec.ts`, `TutorialApi.spec.ts`, `TutorialDirector.spec.ts`
