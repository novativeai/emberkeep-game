# UI Emberkeep Designer Skill

Emberkeep uses a warm, hand-painted mobile game aesthetic — think merge/idle
game UI from studios like Gram Games or Superplay. Cream paper panels, lava
red accents, gold highlights, rounded everything, soft drop shadows, no harsh
edges. Every panel pops in with a Back.easeOut spring.

---

## Palette (`src/core/Constants.ts:7–27`)

```
PRIMARY ACTIONS            BACKGROUND / DEPTH         ACCENT / REWARD
──────────────────         ──────────────────         ───────────────
lava       #E8503C  ←─ danger, close, fire   plum     #4A3845  ←─ dark panel bg
lavaShade  #C73A2E  ←─ pressed state         plumShade #3A2B38  ←─ deep shadow
lavaHighlt #FF8A66  ←─ hover / lit           plumHigh  #6A5468  ←─ border

gold       #F7A437  ←─ XP fill, rewards      moss      #7ECB4F  ←─ confirm / buy
goldShade  #D9821F  ←─ shadow on gold text   mossShade #5FA63D  ←─ pressed green
goldAccent #FFD84D  ←─ sparkle / stripe

teal       #3FA8D9  ←─ info, Pip name tag    TEXT
tealDeep   #2E7FA6  ←─ darker teal           cream     #FFF6E8  ←─ body text / fill
                                              textBrown #B5602F  ←─ label text
BACKGROUND                                   white     #FFFFFF  ←─ button label text
night      #241B22  ←─ dim overlay / deep bg
ash        #8E8A93  ←─ disabled / muted
```

**Derived text colors used inline (not in PALETTE — found in source):**
- Panel warning / subtitle: `#8A6248` (muted brown)
- ShopPanel: `#e8528a` (PINK), `#f5a01e` (ORANGE), `#6cc24a` (GREEN)

---

## Render space

All coordinates and font sizes are written in the **internal 2560×1600 space**.
The canvas FIT-scales down to the window. CSS coordinates = half these values.

```
GAME_WIDTH  = 2560
GAME_HEIGHT = 1600
RES         = 2   (hi-DPI backing scale)
```

---

## Font

One font everywhere: `"Trebuchet MS, Verdana, sans-serif"`

| Use case | Size | Style | Color |
|----------|------|-------|-------|
| Panel title | 52–64px | bold | cream or white |
| Body / dialogue | 36–42px | bold | textBrown |
| Button label | 42–52px | bold | white + 4px shadow rgba(36,27,34,0.5) |
| Sub-label / blurb | 28–34px | normal | #8A6248 |
| HUD numbers | 38–42px | bold | cream |
| HUD micro-label | 20–27px | bold | goldShade or cream |

Text shadows on buttons: `4px offset, rgba(36,27,34,0.5)` (dark night shadow).
Text shadows on price labels: `3px offset, rgba(30,80,10,0.7)` (dark green shadow).

---

## Panel / dialog anatomy

### Standard modal panel

```
Dim overlay: night 0.55 alpha, interactive (tap to close)
Panel:
  Shadow:  night 0.25 alpha, rounded-rect (same size, offset +4px y)
  Fill:    cream (#FFF6E8), rounded-rect
  Stroke:  lava, 8px, rounded-rect
  Radius:  52px
Title lozenge (top edge):
  Fill:    lava, 600×104, radius 52px
  Stroke:  cream, 6px
  Text:    52px bold, cream, shadow 4px night-alpha
Close button (top-right corner):
  Circle:  lava, radius 42–50px
  Stroke:  cream, 6–7px
  Label:   "✕" or "×", 44–52px bold, white
Pop-in:    from scale 0.94, 170ms Back.easeOut
```

### Example: Settings dialog (`UIScene.ts:465–569`)

```
Panel:    900 × 620, radius 52, cream fill, lava 8px stroke
Title:    "Settings" 54px bold textBrown, y = −244
Section:  lava divider rect (760×3, 0.22 alpha)
Buttons:  makeButton() → image + text label + 380×118 hit rect
  Cancel: 'ui_btn_play' scale 0.72, x = −210
  Confirm:'ui_btn_green' scale 0.95, x = +210
```

### Example: Ledger panel (`LedgerPanel.ts`)

```
Background: 'ui_panel' image (pre-baked panel art)
Title lozenge: lava, 600×104 at y=−384, cream stroke 6px
Left column: order title (46px textBrown), blurb (32px #8A6248)
Right column: 'ui_card' image + portrait + 'ui_slot' image + deliver button
Deliver button: 'ui_btn_green' image, 52px bold white label, disabled at 0.55 alpha
```

---

## Button styles

### Round icon button (HUD: gear, ledger, level)

```
Image:  'ui_btn_round' or named variant
Icon:   centered image at scale 0.8–1.5
Hover:  scale tween 1→1.05, 110ms
Down:   setScale(0.96) immediately
```

### Green action button

```
Image:  'ui_btn_green'
Text:   42–52px bold, white, shadow 4px rgba(36,27,34,0.5)
Scale:  0.72–1.0 depending on context
Hit:    300–400px wide × 92–140px tall (explicit setSize)
Disabled: alpha 0.55, disableInteractive()
Hover:  1→1.05 tween, 110ms
```

### Red cancel button

```
Image:  'ui_btn_play' (used as a neutral/cancel/red button)
Text:   42–52px bold, white, shadow
Scale:  0.72–1.0
```

### Plus button (inline, hang off pill)

```
Circle: radius 31, fill #5fb43a, stroke cream 6px
Label:  "+" 52px bold white
Offset: +150px from pill right edge
```

---

## HUD layout (`Hud.ts`)

```
TOP ROW  (y=88, pill anchored center)
  [224, 88]  — Energy pill  + plus button
  [572, 88]  — Coins pill   + plus button
  [920, 88]  — Keys pill    + plus button
  [GAME_WIDTH-112, 104] — Gear button (settings)

BOTTOM-LEFT  (level)
  [112, GAME_HEIGHT-92] — Level disc ('ui_btn_round', scale 0.82)
    Inside: level number 52px bold textBrown, "LVL" 20px goldShade
  XP bar: x=172, y=GAME_HEIGHT-90, 440×36, radius 18
    Fill: gold → goldAccent highlight stripe (left edge)
    Stroke: gold 0.9 alpha

BOTTOM-RIGHT  (ledger)
  [GAME_WIDTH-156, GAME_HEIGHT-168] — Ledger button (scale 1.5)
    Attention dot: lava circle r=18, cream stroke 5px
    Dot pulse: scale 1→1.3, 460ms yoyo, repeat infinite
```

---

## Tooltip style (`Tooltip.ts`)

```
Size: 460 × 236
BG shadow: night 0.2 alpha roundRect, +4px y
BG fill: cream 0.98, gold 6px stroke, radius 32
Pointer nub: cream triangle pointing down (▼ shape, drawn manually)
Name: 36px bold textBrown, centered
Tier dots: 3 circles, radius 14, gold filled / cream empty, goldShade 4px stroke
Sell button: 'ui_btn_green' scale 0.72, text "Sell · 🔥N" 34px bold white
Animation: scale from 0 → 1, 140ms Back.easeOut
```

---

## Shop panel style (`ShopPanel.ts`)

Different sub-palette (candy / pay-reel aesthetic):

```
Card bg:    #e8528a (PINK)
Card shadow: #c63a73 (PINK_DARK)
Card fill:   #fffdf2 (CREAM)
Price button: #6cc24a (GREEN), #4e9a32 (GREEN_DARK)
Quantity ribbon: #f5a01e (ORANGE)
Card size: 380 × 560, radius 36
Gap between cards: 430px
BEST SELLER badge: 12-point gold star, −12° rotation
```

---

## Speech bubble style (`CharacterBubble.ts`)

```
Width: 1200px
Min height: 192px
Padding: 40px
Portrait area: 150px tall (left)
Name badge: roundRect, color per speaker, white border
Text: 38px bold, textBrown, wrap at 940px
Tap chevron: "▼" gold, alpha pulse 1→0.25, 520ms
Pop-in: Back.easeOut 240ms
```

---

## Animation / tween conventions

| Pattern | Duration | Ease |
|---------|----------|------|
| Panel pop-in | 170ms | Back.easeOut |
| Bubble pop-in | 240ms | Back.easeOut |
| Tooltip pop-in | 140ms | Back.easeOut |
| Button hover | 110ms | Linear |
| Button press | immediate setScale | — |
| Attention pulse (repeat) | 460ms yoyo | Sine.easeInOut |
| Arrow bob (repeat) | 430ms yoyo | Sine.easeInOut |
| Hand point pulse (repeat) | 420ms yoyo | Sine.easeInOut |
| Chevron blink (repeat) | 520ms yoyo | Linear |
| Dim overlay fade | 200ms | Linear |

---

## Common Phaser drawing patterns

```typescript
// Rounded panel fill (standard)
g.fillStyle(num(PALETTE.cream), 0.98);
g.fillRoundedRect(-w/2, -h/2, w, h, radius);
g.lineStyle(8, num(PALETTE.lava), 1);
g.strokeRoundedRect(-w/2, -h/2, w, h, radius);

// Night dim overlay (modal backdrop)
g.fillStyle(num(PALETTE.night), 0.55);
g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

// Text with shadow (button label)
scene.add.text(x, y, 'Label', {
  fontFamily: 'Trebuchet MS, Verdana, sans-serif',
  fontSize: '52px', fontStyle: 'bold',
  color: PALETTE.white,
  shadow: { offsetX: 4, offsetY: 4, color: 'rgba(36,27,34,0.5)', fill: true }
});

// Pop-in tween (any new panel/element)
obj.setScale(0);
scene.tweens.add({
  targets: obj, scale: 1,
  duration: 170, ease: 'Back.easeOut'
});
```

---

## Design rules

1. **Everything rounds** — min 32px radius on any panel. Buttons: 42px radius minimum.
2. **Lava for danger / close** — red is always destructive (reset, close, cancel).
3. **Green for confirm / buy** — `ui_btn_green` or moss color for positive actions.
4. **Gold for reward** — XP, keys, best-seller badges, chevrons.
5. **Cream background, dark text** — panels are cream; text is `textBrown` or `white`.
6. **All text is bold** — body text at 36–42px, heavy weight. No thin fonts.
7. **Shadow on every button label** — 4px night-alpha shadow makes white text readable on any bg.
8. **Never teleport UI** — every panel appears via Back.easeOut pop-in, every disappearance fades.
9. **Attention dots pulse** — if something needs attention, add a pulsing lava dot (scale 1→1.3, 460ms).
10. **Portraits anchor left** — speech bubbles, cards: portrait/avatar always on the left edge.
