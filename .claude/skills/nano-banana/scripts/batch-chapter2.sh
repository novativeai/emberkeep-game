#!/bin/bash
# Chapter Two trailer assets: 2 world vistas (STYLE-REFERENCED against the live
# emberkeep background for the same painterly floating-isles look + elevated
# 3/4 isometric camera) and 5 legendary dragon silhouettes.
# Usage: batch-chapter2.sh <workdir> [only-asset-id]
set -e
cd "$(dirname "$0")/../../../.."   # repo root
WORK="${1:?workdir required}"
ONLY="${2:-}"
GEN=".claude/skills/nano-banana/scripts/generate.py"
KEY=".claude/skills/nano-banana/scripts/dekey.py"
mkdir -p "$WORK"

# Downscaled style reference (full 5220px would bloat every request).
REF="$WORK/style-ref.jpg"
[ -f "$REF" ] || python3 -c "
from PIL import Image
img = Image.open('assets/sprites/background/emberkeep.jpg')
img.thumbnail((1536, 1536), Image.LANCZOS)
img.save('$REF', quality=88)
print('style ref', img.size)"

WORLD_STYLE="Image 1 is the ART-STYLE REFERENCE: match its exact painterly mobile-game rendering, its soft cloud sea, its floating-island composition with chunky rock cliffs and hanging chains, its elevated 3/4 isometric camera angle looking down at roughly 30 degrees, and its overall lighting language — but paint a COMPLETELY NEW scene with a NEW color mood. Do not copy any island layout from Image 1."
KEYBG="isolated, centered, on a solid flat pure magenta #FF00FF background filling the entire frame behind the subject, no ground shadow, no other elements, nothing cropped at the edges"
SIL="solid near-black silhouette (very dark plum #241B22) with a warm golden #FFD84D rim-light glowing along its upper-left edges only, at most ONE small glowing golden eye, no other interior details, mysterious story-teaser"

world () { # id prompt
  local id="$1" prompt="$2"
  if [ -n "$ONLY" ] && [ "$id" != "$ONLY" ]; then return; fi
  echo "=== $id ==="
  python3 "$GEN" --ref "$REF" --aspect 16:9 --size 2K --out "$WORK/$id.png" --prompt "$WORLD_STYLE $prompt Full-bleed scenic vista, no characters, no text, no UI, no watermark."
}

legend () { # id shape
  local id="$1" shape="$2"
  if [ -n "$ONLY" ] && [ "$id" != "$ONLY" ]; then return; fi
  echo "=== $id ==="
  python3 "$GEN" --aspect 1:1 --size 1K --out "$WORK/$id-raw.png" --prompt "The $SIL of $shape, full body in profile FACING LEFT, painterly mobile-game art. $KEYBG"
  python3 "$KEY" "$WORK/$id-raw.png" "$WORK/$id.png" --trim --resize 500x520
}

world world_ice \
  "The scene: the FROZEN REACHES — a majestic archipelago of ICE floating islands above a sea of pale clouds at dusk. Glacial blue-white isles with snow-covered plateaus, frozen waterfalls hanging off the cliff edges as solid ice, giant icicles underneath each island, aurora ribbons faintly in the sky, a few warm golden lanterns glowing on chains between the isles as the only warm accents. Palette: icy blues #7FB8D9, white-cyan highlights, deep teal shadows, sparse warm gold #F7A437 accents."

world world_crystal \
  "The scene: the CRYSTAL DEPTHS — a breathtaking archipelago of CRYSTAL floating islands above a sea of violet-tinted clouds. Isles made of dark stone crowned with enormous glowing amethyst and emerald crystal formations, crystal shards jutting from cliff faces, faceted gem surfaces catching light, soft magical glow rising from crystal clusters, golden chains and a lantern or two as warm accents. Palette: amethyst purples #8E5FBF, emerald greens #2AD673, deep plum shadows #3A2B38, sparse warm gold #F7A437 accents."

legend legend_frost   "an immense frost dragon with jagged icicle spines along its back and vast angular blade-like wings, sitting tall and regal"
legend legend_crystal "a mighty dragon whose horns, shoulders and tail are massive faceted crystal shards, standing guard with folded wings"
legend legend_storm   "a slender serpentine dragon with no legs, coiling through the air in an S-curve, long flowing whiskers and a finned tail"
legend legend_tide    "a broad sea dragon with large fin-shaped wings, webbed spines, and a long curled tail ending in an angler-fish lure"
legend legend_shadow  "a hunched, vulture-like dragon with tattered ragged wings, a long neck bent low, and twin whip tails"

echo "ALL DONE"
