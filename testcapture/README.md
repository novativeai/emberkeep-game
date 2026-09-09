# testcapture — le banc de vérification visuelle

Tout contrôle visuel se fait ICI, jamais dans le dépôt au hasard. Une capture
qu'on ne peut pas comparer à une autre ne prouve rien : le but du dossier est
qu'une vérification ait toujours un avant et un après au même cadrage.

## Comment on capture

    pnpm beat <step> --shot testcapture/<lot>/<nom>.png

`beats.mjs at` boote DANS un beat enregistré du tutoriel (~13 s, sans fenêtre)
et photographie l'écran à 2560×1600 — la résolution du jeu, donc les mesures
en pixels sont directement celles de `Constants.ts`. Il REFUSE un checkpoint
périmé : c'est voulu, une capture prise sur une vieille sauvegarde montre des
pièces aux mauvaises places. Si ça refuse, `pnpm beats:record`, jamais `--force`.

    node scripts/say.mjs <...>        une réplique et sa bulle, recadrée
    node scripts/events.mjs run <id>  déclenche un événement puis photographie

## Les dossiers

| dossier | ce qu'il tient |
|---|---|
| `ref/` | les références : l'état AVANT un changement. On y copie avant de toucher au code. |
| `merge-<version>/` | la preuve d'une fusion ou d'un lot livré. |
| `beats/` | captures ponctuelles d'un beat pendant une enquête. |
| `adrian-gameplay/` | les trois correctifs de jeu du rapport d'Adrian, joués et photographiés (`capture-adrian.mjs`). |

## `capture-adrian.mjs` — les correctifs de JEU, joués

    node testcapture/capture-adrian.mjs [--out testcapture/<lot>] [--headed]

`pnpm beat` ne va que là où le tutoriel a enregistré un beat, et les trois bugs
de jeu rapportés par Adrian vivent APRÈS. Ce banc part du dernier beat
(`free_play`) et joue les trois gestes : empocher une pièce et regarder la tâche
la compter, armer un don UNE fois et le donner deux, faire éclore une seconde
dragonne et voir le jeu redemander son nom.

Sous chaque image il imprime l'état MESURÉ sur les systèmes vivants — besace,
tracker, plateau, et `BoardScene.pendingGive`, parce que « le don est encore en
main » est le correctif entier et qu'aucune image fixe ne peut le montrer.
Détails et pièges : `adrian-gameplay/README.md`.

## `probe-mergedemo.mjs` — la démo du hub, JOUÉE contre notre règle

    node testcapture/probe-mergedemo.mjs [url] [--hub ../embergames]

Le « Try a merge » de la page d'accueil prétend être NOTRE plateau. Ce banc le
vérifie au lieu de le croire : il compile le module que la page embarque
(`embergames/src/lib/emberkeep/mergePlan.ts` — notre `mergeHints`, porté), lit
les CELLULES des pièces dans le DOM, lui demande le prochain geste, puis le
joue avec une vraie souris.

Il imprime, pour chaque temps, ce que le plan promettait et ce que le RÉTICULE
affichait au moment du lâcher :

    plan (2 temps) → pièce #1(0,2) sur (1,1) [rassemble]
       réticule « move » (attendu gather|move) ✓ · 3 pièce(s) restantes
    plan (1 temps) → pièce #2(2,1) sur (1,1) [COMPLÈTE]
       éclat 44x44 px · 16 étincelles
       réticule « merge » (attendu merge) ✓ · 0 pièce(s) restantes

C'est la seule chose qui compte : le cadre et la règle répondent à la même
question, et une divergence sort en `✗` avec les deux réponses. L'éclat est
mesuré parce qu'un éclat de 0×0 px est présent dans le DOM et invisible à
l'écran — c'est exactement le défaut que ce banc a trouvé.

Il lui faut un serveur sur `localhost:3000` (`pnpm dev` dans `embergames`) ou
une URL de production en argument.

## La règle

Une capture seule n'est pas une preuve — elle en devient une à côté de sa
référence, au même beat et au même cadrage. Quand le résultat tient en un
nombre (une taille, une marge, un compte de cellules), le nombre passe avant
l'image : `pnpm audit:ground`, `node scripts/beats.mjs check`, `pnpm test`.

Les `.png` ne sont pas suivis par git (voir `.gitignore`) — ce sont des
artefacts de travail, parfois plusieurs Mo pièce.

## Ce que le banc ne sait PAS faire (2026-08-28)

`capture-borealis.mjs` révèle les bandes et se recentre dessus, mais la caméra
du plateau **cadre un niveau** et n'obéit pas toujours à `centerCell` : sur
Borealis les cinq vagues sont photographiées depuis le rivage, la nouvelle
roche entrant par le bord. Les images prouvent donc que le monde se peint, que
les pièces tiennent sur leurs pierres et qu'aucune erreur runtime ne tombe —
pas le contenu exact de chaque vague.

Ce contenu-là est prouvé par les nombres que le script imprime à côté de chaque
image (les pièces par chaîne, le centre et le compte de la bande). Pour la
vague de la Clé d'or :

    01-borealis_coast   15 cellules, centrée sur (14,2)
    +starbench +wreckforge +tarkiln +emberdram +chest

C'est la mesure qui porte la preuve ici, l'image qui l'accompagne. Quand
quelqu'un débridera la caméra, l'inverse deviendra vrai.
