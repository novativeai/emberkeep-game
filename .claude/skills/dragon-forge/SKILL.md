---
name: dragon-forge
description: Produce a new Emberkeep dragon BREED or SKIN from an existing rig — parts sheet in, rig-ready folder out (young + adult). Use whenever asked for a new dragon, dragon breed, dragon skin, re-skin or colourway ("add a storm dragon", "make a skin for the red dragon", "3 new dragons"), or when a produced breed needs re-slicing, re-registering or checking against the roster. Owns the brief schema, the silhouette/personality/perspective contract, registration onto the shared rig, and the QC gates.
---

# Dragon forge — new breeds and skins

Every shipped dragon (red, emerald, golden, frost, storm, moonwhisker
— and golden's `sprite-sunset` skin) is the SAME rig with different pixels:
identical layer names, z order, `bounds`, anchors and pins. **A new breed is not
a new character, it is a new set of part images that must drop onto an existing
rig without moving anything.** That is why this is cheap, and it is also the
whole constraint.

## Run it

```sh
D=.claude/skills/nano-banana/scripts/dragonbreed.py
python3 $D assets/raw/dragons/<id>/brief.json                  # all four steps, both stages
python3 $D … --only prompt                                     # read the prompt before spending
python3 $D … --only prepare,slice,outline,bake                 # re-cut from the sheet, no API cost
python3 $D … --stage adult --from emerald --job sheet          # source breed / route overrides
python3 .claude/skills/nano-banana/scripts/dragonroster.py     # the acceptance test
```

Steps: **prepare** (rig → one magenta parts sheet, grid, one part per cell,
placement stored as FRACTIONS so slicing survives any output resolution) →
**prompt** (composed from the brief + manifest; the cell→part list goes IN the
prompt) → **generate** (`artgen.py sheet-pro`, Nano Banana Pro 4K — layout
obedience is the whole job) → **slice** (crop each cell back, de-key on the
MEASURED key, drop speckle, register, write the rig-ready folder) → **bake**
(optional; flatten the rest pose into the one texture the board draws).

**`bake` is what a board-visible skin needs.** A merge item is a plain pooled
sprite — `item_ember_dragon_3/4` and `item_emerald_3/4` are baked composites on
disk — so a dragon skin is invisible until its composite exists. Compositing the
rig's own layer offsets reproduces the shipped bakes byte for byte (alpha IoU
1.0000, mean RGB diff 0.00 against red young/adult and emerald young), so this
is the same picture the game already ships, not a lookalike.

Five briefs × 2 stages runs fine as five parallel processes; each takes 2–4 min.

## The brief is the only thing you author

`assets/raw/dragons/<id>/brief.json`:

```json
{
  "id": "storm",
  "name": "Storm Dragon",
  "concept": "one sentence — what this animal IS",
  "silhouette": "what the OUTLINE reads as",
  "personality": "who it is + the specific facial/detail cues that show it",
  "scales": "…", "wings": "…", "head": "…", "limbs": "…",
  "palette": "named hexes",
  "young": "extra note for the hatchling sheet",
  "adult": "extra note for the grown sheet",
  "avoid": "…",
  "skin_of": "red"
}
```

`skin_of` is the switch and it changes prompt, registration and output layout:

| | BREED (no `skin_of`) | SKIN (`skin_of: "red"`) |
|---|---|---|
| outline | reshaped — `silhouette` **required**, script refuses without it | locked edge for edge |
| registration | core + joint estimator | alpha bbox |
| lands in | `<id>-dragon/{sprite,sprite-adult,rig,rig-adult}` | `red-dragon/{sprite,rig}-<id>` + `-adult-` pair |
| part files | renamed to the new breed | base names kept |

## What a shared rig actually pins down

Not the outline — the **joints**. A part's pivot is a pixel inside its own canvas
(`anchors[].childLocal`, and `childOriginNorm` is that point over the texture
size, which is what Phaser's `setOrigin` gets); the tail's deform pins are pixels
along the tail. So:

- **free**: horns, crest, frill, ears, back and tail spines, wing trailing edge
  and scalloping, claw shape, tail tip, and any fur/moss/feathering on top.
- **locked**: skull, neck, limb bones, wing bones, tail centreline, and every cut
  edge (neck stump, shoulder end of an arm or wing, hip end of a leg).

A body plan the rig does not have — wyvern, serpent, four wings — is **not
reachable here**. That needs a new rig authored in `tools/rigger`.

## Non-negotiables, each learned by breaking it

1. **Never ask for an outline around a part.** "A subtle dark outline around each
   part" makes the model outline every cell like a standalone icon, and the
   head's outline then draws a black seam across the assembled dragon's neck.
   The `EDGES` block forbids outlines *and* forbids closing off cut edges.
2. **Re-embed `images` in the rig.json.** `RigPlayer.preload` loads textures from
   `rig.images[layer.file]`, so a rig carrying the old breed's base64 renders the
   old breed however good the PNGs on disk are. `slice` does this; don't
   hand-edit a rig without it.
3. **Grow the canvas for a free silhouette.** Part canvases are trimmed to their
   art (every shipped adult part has zero alpha on its border), so added horns or
   moss get sheared into a straight cut. The paint isn't lost — it is in the
   cell's margin. `slice` crops wider onto a grown canvas and `pad_rig` moves
   `childLocal`, `childOriginNorm`, `parentLocal` and every pin to match, with
   `layer.x -= pad` so `anchors[].rig` / `pins[].rig` come out unchanged. That
   invariance is the proof the edit is a no-op.
4. **Personality goes in the face and the details, never the pose.** The pose is
   fixed by the sheet. Eye and brow shape, set of the mouth, how the crest/ears
   sit, wear and scars — name the cues explicitly in the brief.
5. **Perspective is always sent.** Same three-quarter view, same foreshortening,
   same tilt, same upper-left light. A part drawn from its own camera cannot be
   assembled with the others.
6. **Key is measured, never assumed.** Returned magenta lands anywhere from
   `#F109F2` to `#F646F6`.
7. **A creature is not a pile of props.** The silhouette must come from the
   ANIMAL — horns, crest, frill, fins, spines, jaw, claws, tail. Never from
   foreign objects stuck onto it. The dropped `mossback` breed was a dragon
   under mushrooms, lichen shelves, moss clumps and boulders: at board size it
   read as a texture heap rather than a character, the outline turned to mush,
   and no amount of palette work saved it. If a breed's identity needs an object
   glued to its back, the identity is wrong.
8. **A hatchling is never menacing.** Adult menace cues — slit pupils, heavy
   furrowed brow, creases, jutting jaw, bared tusks, scars — put an old face on
   a baby body and the result is unpleasant rather than characterful. Give the
   stages their own text: `personality_young` / `personality_adult` beat
   `personality`, and the young STAGE block bans those cues outright. A hothead
   hatchling sulks with big round eyes; a hothead adult bares its fangs.
9. **A breed generated in locked mode is a skin in a breed's folder.** `frost`
   shipped that way at first — its own folder, but red's exact outline. If it is
   meant to be a breed it needs `silhouette` and free mode; the roster's
   silhouette row is where you catch it.

## The outline is drawn by the pipeline, not by the model

`--only outline` (run after `slice`, before `bake`) draws the dark keyline that
makes the art read at board size, and it obeys one rule: **outline everywhere
except at the joints** — the base of the neck, the shoulders, the wing roots.
A keyline drawn all the way around each part becomes a collar across the
finished animal's neck and a ring at every shoulder, because a rig is assembled
from parts that overlap.

The rig says where those places are, so nothing is guessed: each anchor carries
`childLocal` (the socket in the CHILD's own canvas — neck stump, shoulder, hip)
and `parentLocal` (the same point on the body). Inside a disc around each, the
keyline fades out and the part's alpha is trimmed a few pixels to remove any rim
the model painted there — safe, because a socket is always covered by the part
it plugs into. Everywhere else the rim is darkened toward `PALETTE.night` with a
soft falloff, which is the look the shipped art already has.

Tunables at the top of the script: `OUTLINE_W`, `OUTLINE_STRENGTH`, `JOINT_R`,
`JOINT_FEATHER`, `JOINT_TRIM`. **Not idempotent** — it darkens what it is given,
so always run `slice,outline,bake` together and never `outline` twice.

## QC — in this order

1. **`<stage>-assembled.png`** (written by `slice`): the parts composited through
   the rig's own layer offsets. **Judge this, never the sheet.** A part at the
   wrong size shows up here as a limb that no longer meets the body.
2. **The slice report.** Flags only what is actually wrong: `fit` below the floor
   (0.90 locked / 0.55 free), a **CLAMPED** scale (the model drew that part the
   wrong size), a part **clipped** by its own border, or a messy cell of
   islands. A large `dx` in free mode is the estimator correcting for a new
   crest — not a fault. Full numbers in `<stage>-registration.json`.
3. **`dragonroster.py`** → `assets/raw/dragons/roster-{young,adult}.png`. Read
   the silhouette row: a skin must be indistinguishable from its base, a breed
   must be nameable on its own. Two breeds with one outline are two recolours.

## Where it stops

Rig-ready plus an optional bake, on purpose: nothing is registered in
`assets.json` or `chains.json`, and no blink/talk head banks are produced
(`docs/character-pipeline.md` covers those). Wiring a breed into the game is a
separate job — see `docs/ripple-map.md` first.

**Shipping a dragon appearance in the Emporium** (all five on the shelf were
done this way):

1. `bake` both stages.
2. `python3 scripts/bake-dragon-skin.py <id> <chain>` — REQUIRED for a BREED,
   skippable for a locked-mode skin. A skin wearing its host's rig already
   matches to the pixel; a free-silhouette breed does not, because `pad_rig`
   grew its canvas. `ITEM_SCALE` and the `anchors.json` origin are keyed by
   CHAIN, not by texture, so a breed dropped in raw renders oversized and off
   centre. The script refits it onto the host's canvas — bbox height matched,
   bbox centre aligned.
3. Register `skin_<id>_<tier>` in `assets.json`, and give each one the SAME
   `anchors.json` entry as the `item_<chain>_<tier>` it replaces. Missing that
   entry is silent: the texture falls back to the global default origin and the
   dragon sits a few units off where it used to.
4. Add the item to the `dragons` section of `store.json` with
   `"dragon": "<chain>"` and a `"rarity"`. `"hero": true` claims the section's
   full-height showcase card — at most one, and the unit test holds it to being
   the dearest thing on the shelf.
5. Card art is a separate key-art illustration (`artgen.py character` with the
   assembled dragon as reference), never the sprite: 900×506 landscape for an
   ordinary card, 667×940 PORTRAIT with rounded corners for the hero.

The rest is already generic: `BoardScene.textureFor` swaps a tier only when
`skin_<id>_<tier>` exists, `state.dragonSkins` is keyed by chain so each dragon
has its own wardrobe slot, and rarity is presentation only (`RARITY` / `FOIL` in
Constants, painted by `src/ui/foil.ts`).

Deeper notes: `docs/pipelines.md` → "New dragon breeds and skins". Worked
examples: the six briefs in `assets/raw/dragons/*/brief.json`.
