# Recherche — ressenti du déplacement d'objets (style Fairyland: Merge & Magic)

## 1. Référence analysée
- Page cible : `https://gamedistribution.com/games/fairyland-merge-and-magic/`.
  La page est un wrapper canvas (contenu HTML vide), donc l'analyse repose sur
  les descriptions de gameplay (G5 / CrazyGames / GamePix / Google Play) et sur
  la grammaire commune du genre merge-3 isométrique (Merge Dragons, Merge Magic,
  Fairyland) dont Fairyland est un clone direct.
- Verdict commun : on **glisse** (drag) un objet sur un autre identique pour
  fusionner. Le ressenti du drag est ce qui rend ces jeux « juteux ».

## 2. Anatomie du drag dans Fairyland / Merge Dragons
Quand on saisit un objet (ex. un œuf) et qu'on le déplace, il se passe 5 choses :

1. **Pick-up (lift)** : l'objet *grossit* légèrement (~+12 %), se *soulève*
   au-dessus du doigt (offset vertical) pour ne pas être caché, et une **ombre
   portée** apparaît au sol sous lui. Petit « pop » d'échelle.
2. **Suivi amorti (le point clé)** : l'objet ne colle PAS rigidement au curseur.
   Il **suit avec une légère inertie** — il « traîne » derrière le doigt puis le
   rattrape (lissage exponentiel). C'est ce léger retard pondéré qui donne la
   sensation flottante/vivante caractéristique. Un suivi 1:1 instantané paraît
   raide et mécanique.
3. **Cible au sol** : la **cellule de grille survolée** s'illumine (diamant iso)
   pour montrer où l'objet va atterrir. L'ombre reste au sol, sous l'objet.
4. **Drop (settle)** : au relâcher, l'objet **se cale au centre de la cellule**
   avec un petit dépassement élastique (overshoot/bounce), l'ombre se résorbe,
   l'échelle revient à 1.
5. **Retour (bounce-back)** : si le drop est invalide, l'objet **rebondit** vers
   sa case d'origine (même easing élastique).

## 3. État actuel du code (ce qui cloche)
- [`BoardScene.wireInput`](../../src/scenes/BoardScene.ts) — l'événement `DRAG`
  fait `obj.setPosition(dragX, dragY - 24)` : **suivi rigide 1:1 instantané**.
  → c'est la cause principale du ressenti « robotique ». (points 2 manquant)
- [`BoardItem.liftForDrag`](../../src/entities/BoardItem.ts) — soulève un peu
  (scale 1.12, sprite Y -12) mais **pas d'ombre portée** (point 1 incomplet).
- Pas de **surbrillance de la cellule cible** pendant le drag (point 3 manquant).
- `item:moved` se cale en `Sine.easeOut` 120 ms (pas de petit rebond),
  `item:move_bounced` utilise déjà `Back.easeOut` (point 4/5 partiels).

## 4. Décisions d'implémentation (logique, avant code)
Contraintes du projet (CLAUDE.md) : tout passe par l'EventBus, aucun magic
number (→ `Constants.ts`), rien ne se téléporte, sprites poolés, systèmes sans
Phaser. Le drag est purement *présentation* (scène/entité), donc :

- **Suivi amorti** : la scène mémorise `dragTarget {x,y}` (mis à jour par `DRAG`)
  et, dans `update(time, delta)`, fait avancer le conteneur vers la cible par
  **lissage exponentiel indépendant du framerate** :
  `k = 1 - exp(-delta / tau)` puis `pos += (target - pos) * k`.
  `tau ≈ 70 ms` → suit vite mais avec une traîne perceptible. Le drop utilise
  `pointer.worldX/Y` (pas la position visuelle lissée) donc la cellule cible
  reste exacte → **les tests e2e ne cassent pas**.
- **Ombre portée** : ellipse poolée dans le conteneur `BoardItem`, sous le
  sprite, visible seulement pendant le drag (lift→show, settle→fade).
- **Surbrillance cellule cible** : un diamant iso unique dans `BoardScene`, posé
  au centre de la cellule sous le curseur pendant le drag, masqué sinon.
- **Settle élastique** : `item:moved` passe en `Back.easeOut` (léger overshoot),
  cohérent avec le bounce-back déjà en `Back.easeOut`.
- Tous les réglages (tau, lift scale/offset, taille/alpha d'ombre, durées) →
  `Constants.ts` (`DRAG`).

## 5. Résultat attendu
L'œuf (et tout objet) se soulève avec une ombre, suit le doigt avec une légère
inertie flottante, montre sa case d'atterrissage, puis se cale avec un petit
rebond — le ressenti de Fairyland / Merge Dragons.

## Sources
- [G5 — Fairyland](https://www.g5.com/games/fairyland)
- [CrazyGames — Fairyland Merge & Magic](https://www.crazygames.com/game/fairyland-merge-and-magic)
- [Google Play — Fairyland: Merge & Magic](https://play.google.com/store/apps/details?id=com.cleverapps.fairy)
- [GamePix — Fairyland Merge & Magic](https://www.gamepix.com/play/fairyland-merge-and-magic)
