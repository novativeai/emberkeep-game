---
name: ui-spacing-check
description: STRICT spacing audit for Emberkeep UI — run it for ANY UI work, before calling it done. Panels, popups, HUD, the speech bubble, store shelves, codex pages, buttons, cards, tab rows, chrome, a CX table edit, a new screen, a moved or resized element, mobile layout, margins or padding of any kind. The law is symmetric air (space top = space bottom, space left = space right) at BOTH levels — the sheet in the screen and the content in the sheet — and the check is MEASURED with a live probe, never eyeballed from a screenshot.
---

# UI spacing check — symmetric air, measured

The owner's standing law, stated more than once: **space top = space bottom,
space left = space right — for the interface in the screen AND for the content
inside it.** Every UI change ends with this audit. A change that ships with a
squeezed bottom edge (EVOLUTION 40 units off the frame while the title floats
in 120) is the exact defect this skill exists to catch.

## The two levels

1. **The sheet in the screen.** A panel/popup centres in its available region
   with equal air above and below, equal air left and right. On a phone the
   available region is NOT the screen: the speech card owns the bottom
   `MOBILE_DIALOGUE_BAND` (Constants.ts), and height-fitted sheets size with
   `panelFitScale` and centre at `panelSafeCenterY()`. Air below is measured to
   the band's top, not the screen floor.
2. **The content in the sheet.** The FIRST element's gap to the frame's inner
   top face equals the LAST element's gap to the inner bottom face; left/right
   padding matches likewise. Rows inside (cards on a shelf, plates in a column)
   keep consistent gaps of their own.

Tolerance: the two gaps of a pair must agree within **15% of the larger, or
40 game units, whichever is larger**. Outside that, it is a defect, not taste.

## Measure — never eyeball

Screenshots are for the eye at the END. The check itself is `getBounds()` in
2560-space, from a live probe, because frame art carries transparent margins
and painted insets a screenshot ruler cannot see.

- **Anchor on the LIVE frame image, never on assumed panel units.** Panel-space
  constants lie in ways that reconcile only after an hour of algebra (texture
  @2x vs logical size, container vs child scale). The frame image's
  `getBounds()` is game-space truth; turn it into inner faces with the ART's
  inset fractions. `ui_panel_tall` (2360×4080 sheet, inner map x −1136..1136,
  y −2008..1992): inset fractions top 32/4080, bottom 48/4080, sides 44/2360.
- **Elements measure by their painted box, not their text glyphs.** A plaque's
  visible border is what the owner compares: reconstruct it from the authored
  paint (e.g. `bannerH` centred on the title's centre) when `getBounds()` of a
  Graphics is unreliable.

### Probe recipe (proven on the Codex EVOLUTION defect)

Boot the exact beat with a checkpoint (never a full playthrough), on the
device preset under test, and evaluate:

```js
// inside page.evaluate, with the panel open
const ui = window.__emberkeep.game.scene.getScene('UIScene');
const p = ui.codex;                          // or ui.store, ui.ledger, ...
const f = p.list.find((o) => o.texture?.key === 'ui_panel_tall').getBounds();
const innerTop    = f.top    + f.height * (32 / 4080);
const innerBottom = f.bottom - f.height * (48 / 4080);
const s = f.height / 4080;                   // game units per sheet unit
const plaqueTop = p.title.getBounds().centerY - (208 / 2) * s; // visible box
const last = p.evolutionBtn.getBounds();     // bottommost element, painted box
({ gapTop: Math.round(plaqueTop - innerTop),
   gapBottom: Math.round(innerBottom - last.bottom) })
```

Compare the pair against the tolerance. Do the same for left/right when the
change touched horizontal layout, and for the sheet-in-screen level: `f.top`
above vs `(LIVE height − MOBILE_DIALOGUE_BAND) − f.bottom` below (read the
live height from a floor-anchored element, e.g. the HUD, not
`game.scale.gameSize` — that is the backing size, not the live space).

## Verification screenshots — exact device formats

A claimed device format is checked by the PNG's real pixel size
(`sips -g pixelWidth -g pixelHeight shot.png`), not by intent:

| Preset | viewport (CSS) | DPR | PNG must be |
|---|---|---|---|
| iPhone 11 Pro | 375×812 | 3 | **1125×2436** |
| iPhone 13 Pro | 390×844 | 3 | 1170×2532 |
| Desktop e2e | 1280×800 | 1 | 1280×800 |

Playwright: `newPage({ viewport: {width: 375, height: 812}, hasTouch: true,
isMobile: true, deviceScaleFactor: 3 })`. After the shot, run `sips` and state
the measured size next to the claimed format. Crop the top edge and the bottom
edge of the sheet side by side when showing the result — the pair is what the
owner reads.

## Scope of "UI work" (when this skill runs)

Any change to: `src/ui/*` (panels, HUD, prompts, trackers, shelves), the
speech bubble (`CharacterBubble.ts`), UIScene layout, a `CX` table, spacing or
scale constants (`Constants.ts` UI section — `panelFitScale`, `TAP_SCALE`,
`UI_SCALE`, `MOBILE_DIALOGUE_BAND`, marker sizes), `ui-theme.json`, anchors of
UI art, or anything that adds/moves/resizes an on-screen element. Creating a
new screen runs it twice: desktop and mobile.

## Report shape

For each audited pair: `top X / bottom Y (Δ Z, tol T) — PASS|FAIL`, measured
in game units, with the beat and device preset named. FAIL blocks "done":
fix, re-probe, then screenshot.
