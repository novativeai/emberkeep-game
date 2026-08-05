# Board ↔ code sync (emberkeep-board.vercel.app)

Généré le 2026-08-04 depuis `/api/project` (rev 182). Objectif : **éviter les
doublons** et préparer la fusion avec l'autre lignée du projet.

> Le board suit DEUX bases de code. Ce dépôt (`novativeai/emberkeep-game`,
> branche `nionja`) est la lignée **Laurah / duel / éditeur / quêtes**. Les
> tâches EMB-11/12/24/25/29/31/32/33/35/36/37/38 décrivent une lignée
> **Eleanor / bag / story** qui n'existe **ni ici, ni sur aucune des 3 branches
> du remote** (`main` du 27/07, `nionja`, `3D-merge`). Ne pas les
> réimplémenter ici : elles arriveront par la fusion.

## 1. Tâches `onja` — état réel du code

| Tâche | Board | Code ici | Action |
|---|---|---|---|
| EMB-1 Multiple grid | done | ✅ éditeur : grilles nommées (perspective/taille/matrice), plusieurs par carte | rien |
| EMB-3 Zone 1/Hub/Zone 2 integration | done | ✅ zones polygonales dessinées à la main (onglet Carte) + `WorldTeleportSystem` (roothold, borealis) | rien |
| EMB-4 Dragon feeding | done | ✅ `DragonFeedSystem` + `tests/unit/DragonFeedSystem.spec.ts` | rien |
| EMB-8 Quest display | done | ✅ `QuestSystem` + `QuestPanel` + `quests.json` (principale or / secondaire platine, étapes du tuto en sous-quêtes) | rien |
| EMB-6 3D characters integration | review | ✅ **de fait** : `asset3d/eleanor.glb` + `joggin.glb`, `eleanor` placée dans `asset3d/editor-map.json`, rendu par `Crystal3D` (three.js offscreen) via `decor3d.model3d`. Aucun câblage `src/` n'est nécessaire — ça passe par le JSON monde | vérif visuelle → cocher |
| EMB-21 Four-phase day clock | review | ✅ **fait** : `src/core/dayCycle.ts`, `DayCycleSystem`, `DAY_PHASES` + `DAY_CYCLE.phaseMs = 480 000`, feed gaté par phase (`DRAGON_FEED_PHASE`), `dew_basin` générateur `phases:["night"]` | `pnpm verify` → cocher |
| EMB-17 Wire merge chains | ready | ⚠️ **commencé** : `dew_basin` est dans `chains.json`. Manquent les 5 chaînes de biens (emberberry, resin, ashmoss, quartz, moonwater) + firepine/cinder_vein. L'art d'EMB-10 est dans l'autre lignée → tournera en placeholder ici | à finir |
| EMB-18 Named companions | active | ❌ pas commencé — `ember_dragon` est toujours une chaîne de merge (`hatchAtTier: 3`, T1 « Dragon Ruby » → T4 générateur) | à faire |
| EMB-19 Cold Nest | backlog | ❌ aucun `cold_nest` | à faire |
| EMB-20 Trust 0-5 | backlog | ❌ rien | à faire |
| EMB-22 Preference discovery | backlog | ❌ **mais la graine existe** : `DRAGON_FEED_PHASE` est une préférence *codée en dur et publique*. EMB-22 = la rendre cachée + découvrable par essai | à faire |
| EMB-23 Hub integration | active | ⚠️ partiel — l'éditeur place et persiste déjà le décor (fixe/modifiable, rotation, flip) et le multi-monde existe (`WORLD_TELEPORTS`). Manque : le hub comme monde à part + la devanture de boutique | à finir |
| EMB-30 Bag vs bubbles | ready | 📝 décision, voir §3 | ta décision |
| EMB-33 Quest ladder / EMB-32 / EMB-38 | done/ready | ❌ autre lignée (`storyChapter`, bag GIVE, `characters.json`) | après fusion |

## 2. Ce qui va casser à la fusion

Les systèmes ajoutés ici sont des **fichiers neufs** (`QuestSystem`, `TaskSystem`,
`MilestoneSystem`, `EmberfontSystem`, `DragonDuelSystem`, `DragonFeedSystem`,
`DayCycleSystem`, `WorldTeleportSystem`, `src/editor/`) : ils fusionnent sans
conflit. Les vrais points de collision sont les cinq fichiers partagés :

1. **`SAVE_VERSION`** — les deux lignées l'incrémentent en parallèle (ici et 9 là-bas).
   Décider d'un seul schéma AVANT de merger, sinon une sauvegarde valide se fait jeter.
2. **`tutorial.json`** — ici 21 étapes voix Laurah, transformées en sous-quêtes ;
   là-bas 7 beats d'arrivée voix Eleanor (EMB-25). Réécriture totale des deux côtés.
   Leur version gagne (EMB-12/25 sont livrées) ; garder notre enveloppe QuestPanel.
3. **`chains.json`** — ici `flame_gem`/`emerald`/`dew_basin` + le duel ; là-bas les
   9 chaînes d'EMB-17. `flame_gem` est explicitement remplacé par EMB-17, et
   `orders.json` est réécrit avec.
4. **Le casting** — 72 Mo d'art Laurah/Cindra supprimés là-bas, encore présents ici
   (`assets/sprites/laurah/`, `guide-characters/`). 21 fichiers citent `Laurah`, 29 `Cindra`.
5. **`Constants.ts` / `types.ts` / `Context.ts` / `GameState.ts`** — les deux côtés
   ajoutent des champs, des events et du câblage. Conflits par blocs, pas par fichier :
   à résoudre à la main, en gardant les deux moitiés.

## 3. EMB-30 — recommandation (la décision reste au chef de projet)

`docs/MECHANICS.md` §4.4 spécifie les **bulles** ; l'autre lignée a livré le **sac**
(EMB-29). Aujourd'hui, dans ce dépôt, **ni l'un ni l'autre n'existe** : une récolte
sans case libre échoue avec « Pas de place », un cadeau passif réessaie 8 s plus tard,
le coffre paie en Or à la place.

**Recommandation : le sac comme valve manuelle, les bulles réservées au débordement
en l'absence du joueur** (la 3ᵉ option de la tâche), pour trois raisons :

- Elles ne répondent pas à la même question. Le sac répond à « je veux ranger » —
  geste volontaire, visible, réversible. La bulle répond à « la prod a tourné pendant
  ma nuit » — le joueur n'était pas là pour ranger, et refuser l'item punit une absence.
  C'est exactement la ligne « l'absence ne doit jamais punir » d'EMB-20.
- Un seul modèle mental tient si la règle est lisible en une phrase : *ce que tu ranges
  va dans le sac, ce que le monde produit sans toi t'attend en bulle.* Deux systèmes
  ne se marchent dessus que si les deux sont déclenchés par la même cause.
- Coût : les bulles n'ont besoin d'aucun nouveau stockage — une bulle est un item
  hors-grille avec sa position d'origine, et le sac fournit déjà la couche « item qui
  n'est pas sur le plateau ».

Si tu veux plus simple : **sac seul**, et §4.4 est rayé du design. C'est défendable, mais
il faut alors accepter qu'une production hors-ligne soit perdue ou convertie en Or.

## 4. Découpage des onglets (zones de fichiers disjointes)

| Onglet | Lane | Fichiers | Ne touche pas |
|---|---|---|---|
| A | EMB-21 + EMB-17 (jour + chaînes) | `dayCycle.ts`, `DayCycleSystem`, `GeneratorSystem`, `chains.json`, `orders.json`, `assets.json`, `TextureFactory` | `MergeSystem`, `GameState` |
| B | EMB-18 → 19 → 20 → 22 (dragons) | `MergeSystem`, `GameState`, `SaveSystem`, systèmes neufs `TrustSystem`/`NestSystem`/`PreferenceSystem` + tests | `chains.json`, `GeneratorSystem` |
| C | EMB-23 (hub) + docs | `src/editor/`, `WorldTeleportSystem`, `map.json`, `docs/` | tout `src/systems/` sauf le sien |

Règles communes : **un seul onglet incrémente `SAVE_VERSION`** (B), un seul lance
`pnpm verify` à la fois (port 5173 + cache Playwright partagés), et les hunks de
`Constants.ts` / `types.ts` / `Context.ts` s'ajoutent **en fin de bloc**, jamais par
réécriture du fichier entier.

## 5. Passe de cohérence — 2026-08-04 19:40 (EMB-21 vient d'atterrir)

`dayCycle.ts` (math pure) + `DayCycleSystem` (annonce) + `DAY_CYCLE` dans Constants
+ `day:phase` dans types + câblage `Context.systems.day` + `applySkyGrade` dans
BoardScene + gate `phases` dans GeneratorSystem et DragonFeedSystem : **cohérent**.
`pnpm typecheck` vert, **157 tests unitaires verts**. Restent le build et l'e2e,
à faire par l'onglet qui détient le créneau `pnpm verify`.

Trois points relevés pendant la vérification :

1. **Test corrigé (il échouait).** `tests/unit/DayCycle.spec.ts` — le helper
   `goToPhase` n'avançait que *dans* la phase (`msUntilPhase` vaut 0 quand on y est
   déjà), donc la suite démarrait à un décalage dicté par l'heure réelle. Toute
   assertion sur le temps RESTANT passait ou échouait selon la minute où on la
   lançait. Le helper aligne maintenant sur le **début** de la phase (un cycle
   complet quand on y est déjà). Fichier de la lane A, correction chirurgicale.

2. **`day:phase` n'émet qu'UN événement par saut, pas un par phase traversée.**
   Le code de `DayCycleSystem.catchUp()` annonce la phase d'arrivée ; le test
   `'a jump that skips phases lands on the phase it ends in'` l'assert. C'est le
   bon comportement — mais le commentaire d'en-tête du système affirme l'inverse
   (« one event per phase even when a single jump skips several »). À corriger,
   car il induit en erreur. **Conséquence directe pour la lane B** : les plafonds
   « par jour de jeu » (EMB-19 : 3 points/jour ; EMB-20 : +1/jour) doivent dériver
   le numéro du jour de l'horloge — `Math.floor(GameClock.now() / DAY_CYCLE_MS)` —
   et **jamais** compter les événements `day:phase`, sinon un `advanceTime` long
   ou un retour hors-ligne saute des jours entiers.

3. **Le Dew Basin livré est une maquette, pas la chaîne spécifiée.** Il est
   correct pour EMB-21 (générateur `phases:["night"]`, cooldown 4 min ✔), mais
   `chains.json` le déclare avec **un seul palier** produisant `strawberry` T1.
   La spec d'EMB-13/17 (`merge-items-and-integration.md`) veut une chaîne
   producteur à 3 paliers — Hollow Stone → Dew Hollow → **Dew Basin** — dont le T3
   produit `moonwater` T1, 1 toutes les 4 min, la nuit. **EMB-17 doit faire
   monter l'existant en gamme, pas créer une seconde chaîne `dew_basin`.**

4. **`DRAGON_FEED_PHASE` contredit EMB-22.** La table est aujourd'hui une
   préférence *codée en dur et publique* (l'Émeraude ne mange qu'au crépuscule).
   EMB-22 exige que les goûts soient **cachés et découverts par essai**. Les deux
   ne peuvent pas coexister telles quelles : garder la table comme **vérité**
   côté données, et faire porter à EMB-22 la couche « connu / pas encore essayé »
   par-dessus — le refus reste une découverte, jamais une info affichée d'avance.

## 6. La grille de roothold — diagnostic chiffré (2026-08-05)

> **Résolu.** La lattice par monde est branchée (mapEditor.switchToWorld /
> returnToPrimary) maintenant que chaque monde possède son plateau. roothold : 0 %
> de perte, borealis : 5 % (ses deux grilles tournées). Chiffres et règle à jour
> dans `docs/worlds.md` ; `node scripts/audit-grids.mjs` les recalcule.

Trois enquêtes indépendantes, chacune passée à trois vérificateurs adverses,
convergent sur les mêmes nombres. Mesurés sur les vraies données
(`asset3d/editor-map.json`, carte `m1785787517285`) :

- **Deux réseaux incompatibles.** Le réseau du JEU est fixé une seule fois
  (`BoardScene.ts:251` → `iso.ts:16-18`) depuis la carte AUTORISÉE : cellule
  **256 × 147,5 px**. Les 21 grilles dessinées à la main dans roothold font
  **171,6 × 98,2 px** en moyenne. Même angle iso (0,17 % d'écart), mais **×1,51
  d'échelle** → **2,24 cellules dessinées par cellule de jeu**. Aucun décalage ne
  peut les aligner.
- **141 cellules dessinées s'écrasent sur 67 cellules de jeu** — 74 (52 %) ne
  peuvent jamais recevoir de pièce, et une cellule de jeu en reçoit jusqu'à 4.
  En sens inverse, 81 des 144 cellules dessinées (56 %) sont mortes.
- Un drop atterrit où l'on visait dans **62 cas sur 141** ; 73 sautent sur une
  AUTRE cellule dessinée (médiane 97 px, max 177 px), 6 hors de toute grille.
- **Le snap n'est appliqué que sur 2 chemins** (`item:moved` 3091,
  `item:move_bounced` 3105). Tous les autres — spawn, `fullResync` au reload,
  sortie de merge, éclosion, sauts de récolte — passent par
  `BoardItem.placeAt → gridToWorld` (`BoardItem.ts:141`), qui ignore les grilles
  dessinées. **C'est ça, « ça se répète toujours »** : on glisse, ça a l'air bon,
  on recharge, tout retombe sur le réseau brut.

### Le correctif naïf est DANGEREUX — un vérificateur l'a tué

Démonter l'export `gridToWorld` pour tout faire passer par le résolveur ferait
passer ~25 appels non audités : `buildGround` (1197, appelé inconditionnellement),
`buildBackground` (1297), le décor (1321), le cadrage caméra (1004/1008/1019 —
dont dépend `window.__emberkeep.centerCell` et donc **chaque clic e2e**), l'autel
d'or (800, délibérément hors grille). Ça traînerait l'île autorisée et la caméra
sur des cellules dessinées à la main.

Et **`pnpm verify` ne peut rien garantir ici** : `/__editor/map` n'existe que dans
`configureServer` (`vite.config.ts`), donc sous `vite preview` — ce que Playwright
sert — la route n'existe pas, `baseHidden` reste faux et `liveCustomGrids()`
abandonne (`BoardScene.ts:1706`). **Tout le chemin custom-grid est mort en e2e.**
Seul un test unitaire node sur les vraies données peut le garder.

### L'ordre à respecter

0. **`activeWorldId` n'est pas persisté** (`editorStore.ts:432-434`) et
   `primaryMapId` retombe sur la première carte non-base = **nb2**. Au reload, le
   jeu revient donc dans nb2 pendant que la sauvegarde tient des objets aux
   cellules de roothold. À corriger AVANT tout travail sur les réseaux — sinon le
   correctif ci-dessous colle les objets de roothold sur les grilles de nb2 : le
   plateau a l'air juste et se trouve dans le mauvais monde.
1. Résolveur injecté dans `BoardItem.placeAt`, appliqué **uniquement** aux
   positions d'OBJETS (+ 3376, 3396, `fullResync`, `UIScene:1159`) — jamais au
   sol, au fond, au décor, à la caméra, ni à `worldToGrid` dont dépendent tous les
   drops, surbrillances et hit-tests (1811, 1875, 1899-1901).
2. Supprimer l'écrasement à la source : contraindre les grilles dessinées au
   réseau du jeu à la création (`editorStore.finishGridDraw` / `gridFromBox`,
   `tileW = TILE_W`, `tileH = 2·projHalfH()`), ou rendre `setProjection`
   par-monde (`iso.ts:21-30` fixe aujourd'hui `halfW = TILE_W/2`).
3. Garde-fou : `applyBaseToGame` (`mapEditor.ts:217-227`) doit signaler les
   collisions au lieu d'en perdre 52 % en silence.

Bug annexe repéré : `BoardScene.ts:1908` utilise `TILE_H/2` (64) au lieu de
`projHalfH()` (73,75) pour le losange de surbrillance de repli.

### Projection par-monde : implémentée, mesurée, RETIRÉE (2026-08-05)

Le correctif a été écrit et mesuré : chaque monde adoptait le pas de ses propres
grilles (`setLattice` dans `core/iso.ts`, `latticeFor` dans `editorStore`, appelé
par `mapEditor.switchToWorld`). Résultats réels : **roothold 53 % → 0 % de perte**,
**borealis 50 % → 5 %**, nb2 inchangé.

**Il a été retiré.** Le jeu n'a qu'**UN** magasin d'objets (`GameState.items`) et
**UNE** projection globale. Changer le réseau en entrant dans un monde ne déplace
donc pas « ce monde » : ça déplace **tous les objets du jeu**, nb2 compris. C'est
l'inverse exact de la règle « une carte ne doit pas affecter les autres ».

Les primitives restent (`setLattice`/`getLattice`/`latticeFor`, testées par
`tests/unit/Lattice.spec.ts`) — c'est le **branchement** qui est retiré.

### La vraie fondation, à faire AVANT d'y revenir

1. **L'appartenance des objets à un monde n'est pas persistée.** `itemWorld` est un
   champ de `BoardScene` (`private itemWorld = new Map<number, string>()`), vidé à
   chaque `create()`. Au rechargement, **plus aucun objet n'appartient à un monde** :
   le dragon d'or de borealis réapparaît dans nb2, le dragon rouge s'affiche partout,
   et les sous-mondes se contaminent. C'est la cause première de « chaque carte
   affecte les autres », bien avant l'histoire de réseau.
2. **`activeWorldId` n'est pas persisté non plus** (`editorStore.ts:432`), donc un
   rechargement revient au monde primaire pendant que la sauvegarde tient des objets
   d'un sous-monde.
3. Ces deux champs doivent vivre dans `GameState` et dans la sauvegarde. **Ensuite**
   seulement, le réseau par-monde devient sûr — et il peut même devenir un réseau
   par-monde *avec ses propres objets*, ce qui est la vraie isolation.
