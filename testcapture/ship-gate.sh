#!/usr/bin/env bash
# THE HARD GATE BEFORE THE HUB PUSH (shop spec §9 step 3).
#
#   bash testcapture/ship-gate.sh [expected-game-sha]
#
# The site may only start selling "5 days of Unlimited Warmth" once the game it
# SERVES can hold it. A hub push that lands before the CI sync would sell time
# to a bundle whose save drops `energy.unlimitedUntil` — the purchase would be
# paid, delivered, and silently erased on the next autosave.
#
# Every check reads what is actually there, never what should be:
#   1. the hub checkout, after pulling origin/main, carries the synced game bundle
#      and that bundle contains BOTH new contract tokens;
#   2. the sync commit names the expected game sha (when given);
#   3. Vercel's production deployment of that exact hub commit is READY.
# Exit 0 = the hub may be pushed. Anything else = stop.
set -uo pipefail
HUB="$(cd "$(dirname "$0")/../../embergames" && pwd)"
EXPECT="${1:-}"
fail() { echo "  ✗ $*"; exit 1; }
ok() { echo "  ✓ $*"; }

# `grep -a`, ALWAYS, on the bundle. On this machine `grep` is ugrep, and a 2 MB
# minified file with a stray non-UTF-8 byte is classed as binary and silently
# never matched without -a — which is how this gate once blocked a correct
# ship by reporting the new game's own strings as missing.
echo "=== 1. bundle du jeu synchronisé dans le hub ==="
git -C "$HUB" pull --rebase --quiet origin main || fail "git pull --rebase a échoué — le hub a des changements locaux en conflit"
BUNDLE=$(ls "$HUB"/public/games/emberkeep/assets/index-*.js 2>/dev/null | head -1)
[ -n "$BUNDLE" ] || fail "aucun index-*.js dans public/games/emberkeep/assets"
ok "bundle: $(basename "$BUNDLE")"
grep -aq "unlimitedUntil" "$BUNDLE" || fail "le bundle NE CONTIENT PAS unlimitedUntil — la synchro du nouveau jeu n'est pas arrivée"
ok "contient unlimitedUntil"
grep -aq "embergames:iap:ready" "$BUNDLE" || fail "le bundle NE CONTIENT PAS embergames:iap:ready"
ok "contient embergames:iap:ready"

echo "=== 2. commit de synchro ==="
SYNC=$(git -C "$HUB" log -1 --format='%h %s' --grep='sync emberkeep build' -- public/games/emberkeep)
[ -n "$SYNC" ] || fail "aucun commit de synchro trouvé"
ok "$SYNC"
if [ -n "$EXPECT" ]; then
  echo "$SYNC" | grep -q "$EXPECT" || fail "la synchro ne nomme pas $EXPECT"
  ok "nomme bien $EXPECT"
fi

echo "=== 3. déploiement Vercel de ce commit ==="
HEAD_SHA=$(git -C "$HUB" rev-parse HEAD)
npx --yes vercel whoami >/dev/null 2>&1 || true   # rafraîchit le jeton qui tourne (mémoire)
TOKEN=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.local/share/com.vercel.cli/auth.json')))['token'])" 2>/dev/null)
[ -n "$TOKEN" ] || fail "jeton Vercel introuvable"
STATE=$(curl -4 -s --max-time 30 -H "Authorization: Bearer $TOKEN" \
  "https://api.vercel.com/v6/deployments?projectId=prj_LpX8Ke7mgNechBvyOzXoHwbFL2Hx&teamId=team_PsMlLCqmuTkiSvbM8yG7S5OU&target=production&limit=10" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
if 'error' in d: print('ERR', d['error'].get('message')); raise SystemExit
sha=sys.argv[1]
hit=[x for x in d.get('deployments',[]) if (x.get('meta',{}).get('githubCommitSha') or '')==sha]
print(hit[0]['state'] if hit else 'ABSENT')
" "$HEAD_SHA")
[ "$STATE" = "READY" ] || fail "production Vercel pour ${HEAD_SHA:0:7} : $STATE"
ok "production READY sur ${HEAD_SHA:0:7}"

echo "=== VERROU OUVERT — le hub peut être poussé ==="
