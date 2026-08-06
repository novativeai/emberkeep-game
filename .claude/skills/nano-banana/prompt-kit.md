# Borrowed prompt kit — Hades II character craft & Seedream covers

Kept for reference, not because Emberkeep uses this style. Lifted verbatim from
`~/Documents/Dev/Unity/Workflow/projects/champions-opera/STYLE-GUIDE.md` §3 and
§5, where they were built against `Workflow/References/hades-ii/` (71 tagged
records, art direction Jen Zee). Emberkeep's own prompting rules — isometric,
left-facing, magenta key, the lava/gold/plum palette — are in `SKILL.md` and
still win for anything we actually ship.

Style *language* is fair game; the reference library itself is internal and
never ships.

## Character art — the Hades II sheet prompt

Runs on the `sheet` job (Nano Banana 2, 2K, 16:9 — the aspect this prompt was
written for).

> character turnaround sheet, T-pose, front view / side view / back view,
> full body, consistent proportions, flat light grey background, neutral
> even lighting — [design spec: race/class, chunky 4.5-head proportions,
> motif system, asymmetry element, emissive accent, opera element] — ink
> outlines with painterly cel shading, 2-3 value steps, hand-painted
> texture inside flats, mobile-game readability, strong silhouette

The `[design spec]` slot is the whole trick. It is filled from five craft rules,
and a design that skips any of them comes back generic:

1. **Ink outlines + painterly cel shading** — 2–3 value steps, sharp
   terminator, painterly texture inside the flats. No PBR anywhere.
2. **Silhouette first** — identifiable under 150 px tall. Minions ~4–5 heads
   with oversized weapons and hands; leads ~5–6 heads, still exaggerated.
3. **One systemized motif per character** — crescents, laurels, masks, chains —
   repeated on 3+ costume points (headpiece, weapon, belt/hem).
4. **Identity asymmetry** — one side carries something unique: armoured arm vs
   bare rune arm, half-mask, single pauldron.
5. **A single emissive accent** in a saturated signature colour, the
   character's "stage light", used sparingly — eyes, weapon edge, sigil.

Hands stay **empty** on the sheet: held props are generated separately so the
rig gets clean swappable sockets.

## Cover art — the Seedream prompt

Runs on the `character` job (Seedream 5.0 Pro). Always attach the canon sheet
with `-i` so the cover stays on-model; iterate at 1536², finalize at 2048².

> painterly digital illustration, visible expressive brushstrokes, edges
> dissolving into brushwork away from the focal point, subtle canvas grain,
> NOT photorealistic, not airbrushed-smooth, no plastic sheen — [cinematic
> shot description: extreme/low angle, foreground occlusion, diagonal
> eye-path, motivated single light] — [abstract meaningful setting tailored
> to the character] — single saturated emissive focal in [signature color],
> value-grouped background 2-3 steps below the figure, atmospheric haze

Two directives that carry it:

- **Painterly, never AI-slick.** The anti-slick clause is not decoration —
  outputs that read AI-ish get rejected even when they are on-model.
- **Composition is cinematic, and the setting means something.** Never a
  centred figure on a generic backdrop. Write the shot like a storyboard note:
  pick an angle, an occluding foreground element, an eye-path, one motivated
  light. The setting should say something about the character while staying
  abstract — fragments, symbols, scale contrast, weather, not a diorama.

A worked example of the `[...]` slots, from that project's accepted cover:

> low reverent audience-POV from a darkened orchestra pit, steep up-angle at
> the stage; concentric golden voice-arcs shattering iron siege-chains above
> her, chain fragments and gold sparks mid-air; silhouetted audience heads as
> foreground occlusion; single high-left spotlight; crimson and charcoal
> amphitheatre dissolving into haze

## Two more from the same kit

**Zone floor plate** — `map` job (NB2, 4K). Small tileable textures do not hold
up at gameplay camera distance; generate the whole zone floor as one plate.

> orthographic top-down ground plane for a stylized mobile battle arena,
> floor only, absolutely no props, no objects, no characters, no UI —
> [layout drawn to the exact gameplay grid] — hand-painted painterly
> brushwork, lighting and soft ambient occlusion painted into the albedo,
> no photo detail, value hierarchy: playable space lightest and desaturated,
> border darkest and most saturated, subtle painted cool shadows from
> off-screen architecture — palette: [anchors]

**Prop concept** — `asset` job (NB2, 1K), clean enough to feed 3D conversion.

> isolated game prop concept, single object, 3/4 view, flat grey background —
> [prop spec + motif] — chunky simplified planes, ink outline, painterly cel
> shading, hand-painted albedo look, readable silhouette
