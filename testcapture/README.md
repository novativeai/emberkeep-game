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
