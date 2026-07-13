#!/bin/bash
# Chapter One remaining assets (docs/ART-REQUESTS.md) — generate + de-key.
# Usage: batch-chapter1.sh <workdir> [only-asset-id]
set -e
cd "$(dirname "$0")/../../../.."   # repo root
WORK="${1:?workdir required}"
ONLY="${2:-}"
GEN=".claude/skills/nano-banana/scripts/generate.py"
KEY=".claude/skills/nano-banana/scripts/dekey.py"
mkdir -p "$WORK"

STYLE="painterly mobile-game art, warm cozy premium merge-game style, chunky shapes, soft gradients"
KEYBG="isolated, centered, on a solid flat pure magenta #FF00FF background filling the entire frame behind the subject, no ground shadow, no other elements, nothing cropped at the edges"
SIL="solid near-black silhouette (very dark plum #241B22) with a warm golden #FFD84D rim-light glowing along its upper-left edges only, no interior details visible, mysterious"

gen () { # id prompt aspect size WxH
  local id="$1" prompt="$2" aspect="$3" size="$4" dim="$5"
  if [ -n "$ONLY" ] && [ "$id" != "$ONLY" ]; then return; fi
  echo "=== $id ==="
  python3 "$GEN" --prompt "$prompt" --aspect "$aspect" --size "$size" --out "$WORK/$id-raw.png"
  python3 "$KEY" "$WORK/$id-raw.png" "$WORK/$id.png" --trim --resize "$dim"
}

gen teaser_terrace \
  "A mysterious floating volcanic island terrace shrouded in thick ash-grey fog, seen from a distance. One single shaft of warm golden #FFD84D light breaks through the clouds onto the terrace, hinting at the vague dark outline of an ancient shrine inside the murk. Everything else is deep dark plum #241B22 and #3A2B38 mist. $STYLE, moody teaser illustration, mostly darkness, mystery preserved. $KEYBG" \
  4:3 2K 680x520

gen teaser_breed \
  "The $SIL of an unfamiliar majestic dragon with sweeping curved horns and a tall unusual wing profile unlike any common dragon, sitting upright in profile FACING LEFT. Exactly one small glowing golden eye visible. $STYLE, story teaser card. $KEYBG" \
  4:3 2K 680x520

gen teaser_flame \
  "An abstract ominous scene: a huge shadowy dark claw made of smoke (near-black #241B22 silhouette) closing around a small dying golden-orange flame #F7A437 that still glows bravely at the center. Wisps of dark smoke curl away. $STYLE, dramatic story teaser, abstract, mostly darkness with one warm glow. $KEYBG" \
  4:3 2K 680x520

gen glimpse_shrine \
  "The $SIL of an ancient dormant dragon shrine: a tall stone brazier tower with curved dragon-wing ornaments and an unlit fire bowl on top. Isometric 3/4 view game asset, viewed from above at roughly 30 degrees, 2:1 isometric projection, light from the upper-left. $STYLE. $KEYBG" \
  4:5 2K 380x450

gen glimpse_dragon_a \
  "The $SIL of a slender elegant dragon with a long neck, sitting tall and alert, wings folded, in profile FACING LEFT. Isometric 3/4 view game asset, light from the upper-left. $STYLE. $KEYBG" \
  1:1 1K 240x260

gen glimpse_dragon_b \
  "The $SIL of a stocky powerful dragon with broad shoulders and short thick horns, crouching low as if guarding something, in profile FACING LEFT. Isometric 3/4 view game asset, light from the upper-left. $STYLE. $KEYBG" \
  1:1 1K 240x260

gen icon_tasks \
  "A chunky golden five-pointed star #F7A437 with #FFD84D highlights sitting on top of a small unrolled cream #FFF6E8 parchment checklist scroll with three tick marks, warm brown #B5602F outline, glossy toy-like bevel. Mobile game UI icon, $STYLE, bold and readable at small size, front-facing icon (not isometric). $KEYBG" \
  1:1 1K 200x200

echo "ALL DONE"
