#!/bin/bash
# Emberkeep COSMETICS EMPORIUM — UI concept generation.
#
#   shop-concept.sh <workdir> [stage]
#     stage   inventory | bakeoff | prompts | keeperskins | screens | all
#             (default: all)
#
# `inventory` rebuilds the reference contact sheet from the game's own art —
# the shop sells skins OF those assets, so the model has to be looking at them
# or it invents a different game. `bakeoff` shoots the SAME brief at three
# models to pick one for UI work. `screens` builds the remaining category tabs
# on the winner; `prompts` writes those same prompts and generates nothing.
#
# Concept only — nothing here is wired into the game.
set -e
cd "$(dirname "$0")/../../../.."   # repo root
WORK="${1:?workdir required}"
STAGE="${2:-all}"
SCRIPTS=".claude/skills/nano-banana/scripts"
A="$SCRIPTS/artgen.py"
mkdir -p "$WORK/generations" "$WORK/prompts"

REF="$WORK/asset-inventory.png"

# ------------------------------------------------------------------ style
# Constants.ts is the source of truth for these hexes.
PALETTE="Palette, used strictly: gold #F7A437, goldShade #D9821F, goldAccent #FFD84D, lava #E8503C, lavaShade #C73A2E, plum #4A3845, plumShade #3A2B38, cream #FFF6E8, night #241B22, textBrown #B5602F."

STYLE="Painterly mobile-game UI in the style of a premium merge/city builder (Merge Dragons, Royal Match, EverMerge): warm and cosy, chunky readable shapes, soft gradients, a subtle dark outline on every panel, gold filigree trim, gently beveled rounded rectangles, soft inner glow behind valuable items. Rendered, not flat — but clean and legible, NOT noisy. No photorealism, no lens flare, no chromatic aberration, no drop-shadow spam."

# The reference is the whole point: the shop sells skins of these exact assets.
REFCLAUSE="Image 1 is a labelled contact sheet of the ACTUAL art from this game — the two houses, the hub decor props, the three dragon breeds (red, emerald, golden, plus an existing golden 'sunset' recolour), and the two keeper characters Eleanor (dark hair, plum cloak) and Selyna (pale pink hair, lilac and rose robe). Every cosmetic shown in the shop must be a recognisable RE-SKIN of one of those exact assets — the same silhouette, the same proportions, the same painting style and the same isometric 3/4 angle for the props, only re-coloured and re-themed. Do not invent new creatures, new buildings or new characters."

# Exactly three tabs, in this order — the shop sells skins for the dragons, for
# the two keepers, and for the space they live in. Nothing else.
CHROME="Full-screen shop overlay sitting over a dimmed, blurred game board. Top bar: the shop title 'EMPORIUM' in a gold-trimmed banner, a Gold counter with a gold coin icon and a Warmth counter with a flame icon on the right, a round close X button in the top-right corner. Directly under the top bar, a row of exactly THREE category tabs. Their left-to-right order is fixed and must not be rearranged: DRAGONS is the LEFTMOST tab, KEEPERS is the MIDDLE tab, DECORS is the RIGHTMOST tab. Reading them left to right gives DRAGONS, then KEEPERS, then DECORS. The active one is lifted and lit in gold, the other two recessed in plumShade. There are no other tabs. Every card is a rounded rectangle in plumShade #3A2B38 with a gold border, the cosmetic art large and centred inside it, the cosmetic name in cream underneath, across the top-left corner a small diagonal ribbon carrying ONE word and one word only — COMMON, RARE, EPIC or LEGENDARY — and at the bottom a small rounded tag showing a gold coin and a number. The words 'price', 'pill', 'tag', 'card', 'ribbon' and 'rarity' are descriptions of the furniture, never labels: they must not appear anywhere on the screen, and no rarity word is ever printed twice on the same card. No quotation marks around any name. Crisp readable English UI text, correctly spelled, no lorem ipsum, no gibberish, no watermark."

brief () { # tab-name, hero-line, body-line, composition-line
  cat <<EOF
Design one polished mobile-game COSMETICS SHOP screen for a cosy isometric dragon-keeper merge game called Emberkeep. Landscape orientation, designed for a tablet.

$REFCLAUSE

$CHROME

The active tab is '$1'. $2

$3

$STYLE

$PALETTE

Composition: $4 Leave the layout breathing — this is a shop a player browses, not a dense inventory screen. Nothing crops awkwardly at the edges.
EOF
}

GRID6="The featured banner sits across the upper third and the six-card grid in two rows of three below it."

# ------------------------------------------------------------------- stages
inventory () {
  echo "=== reference contact sheet ==="
  python3 "$SCRIPTS/shop-inventory.py" "$REF"
}

# One brief, three models. 16:9 is the nearest offered ratio to the game's own
# 16:10; Seedream's auto_2K instead follows the reference's aspect, which is the
# reason it is in the test at all.
bakeoff () {
  echo "=== model bake-off — DRAGONS tab ==="
  dragons_brief > "$WORK/prompts/dragons.txt"
  python3 "$A" map-pro      "$(cat "$WORK/prompts/dragons.txt")" --ar 16:9 -i "$REF" \
    -o "$WORK/generations/bakeoff-nanobanana-pro.png"
  python3 "$A" map          "$(cat "$WORK/prompts/dragons.txt")" --ar 16:9 -i "$REF" \
    -o "$WORK/generations/bakeoff-nanobanana-2.png"
  python3 "$A" map-seedream "$(cat "$WORK/prompts/dragons.txt")"          -i "$REF" \
    -o "$WORK/generations/bakeoff-seedream-pro.png"
}

# Write every prompt without spending anything. Separated out because a run can
# die between two generations (the Gemini account ran dry mid-`screens` once),
# and a prompt that only exists inside the call that failed is a prompt lost.
prompts () {
  echo "=== prompts ==="
  screens ''
}

dragons_brief () {
  brief "DRAGONS" \
    "The featured banner shows one hero dragon skin: the red adult dragon re-skinned as a frost dragon — the identical dragon pose and silhouette from Image 1, re-coloured in pale ice blue and white with frosted wing membranes — presented large on the left of the banner with its skin name 'FROSTSCALE' and a price beside it." \
    "The grid below the featured banner holds six cosmetic cards: each card previews ONE dragon re-skin, drawn as that exact breed from Image 1 in a new colourway: an obsidian-black red dragon with lava-orange seams, an ivory-and-gold emerald dragon, a verdigris copper golden dragon, a rose-quartz pink red dragon, a storm-grey emerald dragon with lightning-blue wings, and a jade-green golden dragon. Two cards show an 'OWNED' state with a dimmed price tag and a gold check, one card shows 'EQUIPPED' with a gold glow." \
    "$GRID6"
}

# KEEPERS is deliberately NOT a six-card grid. There are exactly two keepers and
# one skin each, so the screen is a two-up showcase — the skins are the most
# expensive art in the shop and the layout should say so.
keepers_brief () {
  # This screen gets the finished skin portraits as references, so it composes
  # the approved art instead of re-inventing the outfits.
  local REFCLAUSE="Image 1 is a labelled contact sheet of the ACTUAL art from this game. Image 2 is the FINISHED Eleanor skin portrait and Image 3 is the FINISHED Selyna skin portrait. Place those two paintings into the shop panels as they are — same brushwork, same painterly rendering, same lighting, same waist-up crop. Do NOT redraw them, do NOT flatten them into a vector or cartoon style, do NOT change them to full-body figures. Hold these exactly: Eleanor has BLACK hair with a long braid over her left shoulder, fair warm skin and a crescent-moon earring; Selyna has PLATINUM-BLONDE hair with PINK tips in a chin-length bob, worn UNCOVERED with no hood over it, and fair pale skin. Neither woman's hair colour, skin tone or face may change. This game has exactly two keepers and no other character appears anywhere on the screen."
  brief "KEEPERS" \
    "This tab has exactly TWO items, one per keeper, shown as two large tall showcase panels side by side filling the panel — no six-card grid, no featured banner above them." \
    "LEFT PANEL — the Eleanor portrait from Image 2, crimson and antique-gold ceremonial robes, shown large. Her title sits beneath the portrait on a gold-trimmed nameplate on two lines: 'ELEANOR' large in gold, then 'The Emberwarden of the Last Hearth' smaller in cream italics. A 'LEGENDARY' rarity ribbon crosses the top-left corner and a gold-coin price tag sits at the bottom.
RIGHT PANEL — the Selyna portrait from Image 3, moonlit silver and deep-indigo robes with the star-flecked veil, shown large. Her nameplate reads 'SELYNA' large in gold, then 'The Moonweaver of the Silver Tide' smaller in cream italics. A 'LEGENDARY' rarity ribbon crosses the top-left corner; her panel is the equipped one, edged in a soft gold glow with an 'EQUIPPED' tag instead of a price." \
    "two tall showcase panels side by side, each filling half the width and the full height under the tabs, portraits large enough to see the fabric detail."
}

decors_brief () {
  brief "DECORS" \
    "The featured banner shows one hero decor bundle: the 'WINTERHEARTH' pack — the cottage from Image 1 rebuilt at the identical silhouette and isometric angle with snow on the roof tiles, icicles at the eaves and warm gold light in the windows, shown beside a matching frost-touched tree and a frozen crystal — presented large on the left of the banner. On the right of the banner, ONLY the pack name 'WINTERHEARTH PACK', one single price and one single gold button reading 'BUY BUNDLE' — no other numbers, buttons or labels anywhere in the banner." \
    "The grid below the featured banner holds exactly SIX cosmetic cards — count them: six, no more and no fewer — MIXING buildings and decorative props, since this tab sells everything the player uses to dress the space: a mushroom-cap cottage with a spotted red roof, a crystal cottage with faceted amethyst walls, a thatched golden-harvest manor, a golden autumn big tree, an ember-glass version of the crystal outcrop with glowing lava seams, and a cherry-blossom potted plant. Every one is drawn as the matching asset from Image 1 at the same isometric 3/4 angle and the same proportions, only re-themed. Two cards show an 'OWNED' state with a dimmed price tag and a gold check, one card shows 'EQUIPPED' with a gold glow." \
    "$GRID6"
}

# The two keeper skins as standalone portraits, on the route that made the
# originals (Seedream 5.0 Pro — `character`, the repo's portrait job). Separate
# from `screens` on purpose: the skin art and the shop chrome want different
# models, and a portrait is worth having even when the screen cannot be built.
keeperskins () {
  echo "=== keeper skin portraits ==="
  local SKIN="Painterly digital illustration for a visual-novel dialogue portrait, waist-up, three-quarter view, visible expressive brushstrokes, hand-painted rendering with 3-4 clean value steps, warm key light from the upper left and a cool fill from the lower right, edges dissolving into loose brushwork toward the bottom of the frame. She is BARE-HEADED — no hat, no hood, no headwear over the hair. Isolated on a solid flat pure green #00FF00 background filling the entire frame behind her, no ground shadow, no text, no watermark, nothing cropped at the edges."

  python3 "$A" character \
    "Image 1 is the character. Redraw this exact woman — the same face, the same features, the same dark hair, the same warm skin tone, the same age, the same calm half-smile, the same painting style — in a NEW premium outfit, as a legendary cosmetic skin.

The outfit: deep crimson and antique-gold ceremonial robes of a keeper of the flame. A high embroidered collar lit from within like a banked ember, gold filigree scrollwork running down the front panels, a long fur-trimmed mantle falling from one shoulder, a wide worked-leather belt with a gold flame clasp, and a thin forged-gold circlet resting on her brow. Rich fabric with real weight — folds, embroidery, metal filigree — and a soft warm rim light picking her silhouette out of the dark. She should read as regal and ceremonial, not armoured.

$SKIN" \
    --size auto_2K -i "assets/sprites/characters/eleanor/eleanor-portrait.png" \
    -o "$WORK/generations/skin-eleanor-emberwarden.png"

  python3 "$A" character \
    "Image 1 is the character. Redraw this exact woman — the same face, the same features, the same pale blonde-and-rose hair, the same fair skin, the same age, the same expression, the same painting style — in a NEW premium outfit, as a legendary cosmetic skin.

The outfit: moonlit silver and deep-indigo robes of a tide-reading seer. A translucent star-flecked veil drifting from her shoulders, crescent-moon clasps at each shoulder, pale ice-blue trim and silver thread constellations stitched across the bodice, a sash of deep indigo silk, and fine silver chainwork at the wrists. Rich flowing fabric with real weight, a cool moonlit rim light along her silhouette and a faint pearlescent sheen on the veil. She should read as ethereal and ceremonial, not armoured.

$SKIN" \
    --size auto_2K -i "assets/sprites/characters/selyna/selyna-portrait.png" \
    -o "$WORK/generations/skin-selyna-moonweaver.png"

  for f in skin-eleanor-emberwarden skin-selyna-moonweaver; do
    python3 "$SCRIPTS/dekey.py" "$WORK/generations/$f.png" "$WORK/generations/$f-alpha.png" --key 00FF00 --trim
  done
}

# All three tabs, on whichever model won the bake-off. An empty job writes the
# prompts and generates nothing.
screens () { # job
  local job="${1-map-pro}"
  [ -n "$job" ] && echo "=== category screens on $job ===" || true
  # `cmd && a || b` would report the prompt-only branch on a FAILED generation
  # too — a 429 printed "wrote …" and the run looked fine. Branch explicitly so
  # a failure stays a failure and `set -e` stops the run.
  gen () { # prompt-file, out, extra refs…
    local p="$1" out="$2"; shift 2
    if [ -z "$job" ]; then echo "  wrote $p"; return 0; fi
    local refs=(-i "$REF"); for r in "$@"; do refs+=(-i "$r"); done
    python3 "$A" "$job" "$(cat "$p")" --ar 16:9 "${refs[@]}" -o "$out"
  }

  local want=("${@:2}"); [ ${#want[@]} -eq 0 ] && want=(dragons keepers decors)
  for tab in "${want[@]}"; do
    "${tab}_brief" > "$WORK/prompts/$tab.txt"
    if [ "$tab" = keepers ]; then
      gen "$WORK/prompts/$tab.txt" "$WORK/generations/screen-$tab.png" \
        "$WORK/generations/skin-eleanor-emberwarden-alpha.png" \
        "$WORK/generations/skin-selyna-moonweaver-alpha.png"
    else
      gen "$WORK/prompts/$tab.txt" "$WORK/generations/screen-$tab.png"
    fi
  done
}

run () { [ "$STAGE" = "all" ] || [ "$STAGE" = "$1" ]; }
run inventory && inventory
run bakeoff   && bakeoff
run prompts   && prompts
run keeperskins && keeperskins
run screens   && screens "${3:-map-pro}" "${@:4}"
echo "done — $STAGE"
