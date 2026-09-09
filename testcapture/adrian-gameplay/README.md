# adrian-gameplay — les trois correctifs de jeu, en image

    node testcapture/capture-adrian.mjs

Adrian a rapporté six choses. Trois étaient du **site** et ont été photographiées
en ligne (`adrian-fixes/`). Les trois autres étaient du **jeu**, et n'avaient
pour toute preuve que des tests unitaires. Un test dit qu'un nombre a bougé ; il
ne dit pas que le joueur le voit bouger — et deux de ces trois bugs étaient
exactement ça : la règle était juste, l'écran ne la montrait pas.

Ce lot est la moitié manquante. Il boote le dernier beat enregistré
(`free_play`, le plateau rendu au joueur) et joue les trois gestes d'un testeur.

## Ce que chaque image prouve

| image | ce qu'on y lit | ce que ça prouve |
|---|---|---|
| `A0-the-task-asks-for-two` | « Make 2 Fire Gems — 0/2 », aucune gemme posée | le point de départ |
| `A1-one-gem-pocketed` | « Make 2 Fire Gems — **1/2** », besace `flame_gem:2×1`, **plateau vide** | la tâche compte la besace. Avant : 0/2 |
| `A2-both-in-the-satchel` | l'étape passe à « Deliver 2 Fire Gems » | les deux comptent depuis la poche |
| `B0-armed-once` | « Tap who it is for », en main `flame_gem:2` | le don est armé **une** fois |
| `B1-first-given-still-in-hand` | Eleanor remercie, tracker **1/2**, besace `×1`, **en main `flame_gem:2`** | la pièce RESTE en main |
| `B2-second-given-order-done` | besace vide, commande terminée, 383 → 578 or | deux dons, un seul armement, la besace jamais rouverte |
| `C0-ash-eggs` | des Ash Dragon Eggs sur le plateau | la race exacte du rapport |
| `C1-she-hatches` | les œufs fusionnent | une **seconde** dragonne de cendre éclôt |
| `C2-the-game-asks-her-name` | « IT IS AWAKE — Pick a name she will love », **Grey · Wisp · Ashen** | le jeu redemande le nom à chaque éclosion, et les suggestions viennent du pool `ashdrake` (avant : la liste d'ember pour toutes les races) |

## L'ordre compte, et c'est le piège que ce banc évite

`A` pose et empoche **une pièce à la fois** — le geste d'Adrian. Poser les deux
puis les empocher aurait fait LATCHER l'étape avant le premier rangement, et la
capture aurait été identique avec et sans le correctif. C'est le même piège qui
avait rendu ma première version du test unitaire vide de sens.

## Ce que le banc ne prouve pas

Il **joue**, il n'affirme pas. `board:spawn` pose les pièces au lieu de les
faire gagner, et la quête qui précède celle qui nous intéresse est retirée de la
même façon — c'est de la mise en place, dite comme telle. En revanche, rien ici
ne truque une besace, un tracker ou un don : ce sont les gestes sous test et ils
passent par le chemin du joueur (`ui:store_requested`,
`ui:bag_give_requested`, une vraie souris pour la fusion).

Le journal sous chaque image est **mesuré** sur les systèmes vivants, pas décrit :
`en main` lit `BoardScene.pendingGive`, parce que « le don est encore armé » est
tout le correctif B et c'est la seule chose qu'une image fixe ne peut pas montrer
(les destinataires PULSENT, ce qui est un tween, pas un pixel).

## Deux pièges rencontrés, gardés dans le banc

1. **Une bulle de dialogue avale tous les clics.** Tant qu'une réplique est à
   l'écran, UIScene possède le pointeur : le premier passage a perdu ses deux
   derniers chapitres là-dessus, et les images ressemblaient à des correctifs en
   échec alors que rien n'avait été touché. `clearBubbles()` est appelé juste
   avant chaque geste — ce plateau PARLE (les machines finissent, le coffre
   s'ouvre, la Porte d'Ember prend la parole).
2. **Eleanor sort du cadre par le haut.** Ancrée en (8,0) et dessinée 591 px
   au-dessus de sa case, elle est coupée par le bord sur le cadrage au repos :
   le banc l'a lue à `y = -2` et a cliqué dans le ciel. `aimEleanor()` recentre
   et REFUSE un point hors champ — juste avant chaque visée, pas une fois par
   chapitre, parce que la caméra ne reste pas où on la met.
