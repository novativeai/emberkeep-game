# Fusion `nionja` → `main` — brief pour l'agent qui la fera

**À lire en entier avant la première commande.** Ce document est le contrat de la
fusion : il dit dans quel sens fusionner, ce que chaque conflit doit devenir, et ce
qui doit rester vrai après. Mesuré le 2026-08-05 sur `nionja@3b1110f` et
`origin/main@3a34c63`.

---

## 1. La forme réelle du problème

Ce n'est **pas** une fusion symétrique. Les deux branches divergent depuis
`866ca43` (2026-07-13) :

| | apporte | fichiers |
|---|---|---|
| **nionja** | tout le Chapitre Un : mondes, éditeur de carte, quêtes, cycle du jour, dragons, sauvegarde par monde, art | **192 fichiers, +26 587 / −805** |
| **origin/main** | 3 commits : plafond canvas 4096px, **PowerGovernor**, page *Merge design* du worldbuilder | 14 fichiers, +1 319 / −173 |

**Six fichiers seulement sont touchés des deux côtés**, et la fusion à sec
(`git merge-tree`) donne **4 fichiers en conflit, 9 hunks au total** — tous
mécaniques. `Constants.ts` et `types.ts` se fusionnent seuls.

> Autrement dit : `main` n'a pas « beaucoup de fonctionnalités que nionja n'a pas ».
> Il en a **trois**, bien identifiées. Tout le reste de la valeur est déjà dans
> nionja. Le risque n'est pas de perdre `main` — c'est de casser nionja en
> l'intégrant.

## 2. Le sens de la fusion

```bash
git checkout nionja
git merge origin/main        # ← résoudre ICI, une seule fois
pnpm verify                  # ← doit être vert AVANT de toucher à main
git checkout main
git merge nionja             # ← fast-forward, aucun conflit
```

Résoudre sur `nionja` et pas sur `main`, pour une raison : **c'est là que vivent les
201 tests unitaires et l'e2e qui traverse tout le tutoriel.** Une résolution faite sur
`main` ne serait vérifiée par rien.

Ne pas rebaser. 40 commits de nionja replayés sur main, c'est 40 occasions de
résoudre le même conflit de travers.

## 3. Les 9 conflits, et ce qu'ils doivent devenir

La règle générale, valable pour **8 des 9** : les deux côtés sont **complémentaires,
pas concurrents**. Ne jamais choisir un côté — écrire les deux.

### `src/main.ts` — 1 conflit
Deux imports voisins. Garder les deux lignes (`MapEditor` **et** `PowerGovernor`).

### `src/core/GameConfig.ts` — 2 conflits
nionja plafonne la résolution pour le **palier appareil faible** (crash mémoire GPU) ;
main plafonne le backing canvas à **4096 px** (plafond GPU des vieux appareils).
Deux protections différentes contre le même crash → **appliquer les deux, la plus
stricte gagne**. Ne pas remplacer l'une par l'autre : un appareil faible peut être
sous 4096 px et quand même manquer de VRAM.

### `src/scenes/BoardScene.ts` — 5 conflits (1 import + 4 identiques)
Les 4 vrais conflits sont tous dans les **émetteurs d'ambiance** (`buildAtmosphere`),
et disent exactement la même chose des deux côtés :

- nionja les entoure de `if (!IS_LOW_END) { … }` — un appareil faible ne les crée pas.
- main les pousse dans `this.ambientEmitters.push(…)` — le PowerGovernor peut les
  mettre en pause.

**Résolution : les deux.** Pousser dans `ambientEmitters` **à l'intérieur** du garde
`IS_LOW_END`. « Ne pas créer sur appareil faible » et « pouvoir mettre en pause quand
c'est créé » ne s'excluent pas — ce sont les deux moitiés de la même politique.

Le 5ᵉ est l'import : garder `goldenPromise`, `PRIMARY_WORLD`, `lazyTextures`,
`worldChains`, `editorStore` **et** `PowerGovernor`.

### `vite.config.ts` — 1 conflit
nionja ajoute la lecture de `EMBERKEEP_DIST` (voies de vérification parallèles) ;
main ajoute les endpoints de la page *Merge design*. Purement additifs → **les deux**.

⚠️ **Piège** : le plugin `pruneDistArt` de nionja lit `EMBERKEEP_DIST`. Si la
résolution reprend la version de main, la voie parallèle purge le mauvais `dist/`.
Vérifier après coup que `pruneDistArt` honore toujours la variable.

## 4. Ce qui doit rester vrai après la fusion

Ce sont des corrections récentes, coûteuses à retrouver, et qu'une résolution
distraite défait sans bruit. **Les relire dans le résultat fusionné, pas seulement
dans le diff.**

1. **`Context.beginRun` est `async` et attend `ctx.worldPreparer`.**
   L'ordre est : plateau en place → monde restauré (cases + lattice) → `state:loaded`.
   Si quelqu'un « simplifie » en le rendant synchrone, la fenêtre où le jeu tourne et
   sauvegarde avec les pièces d'un monde sur le sol d'un autre revient.
2. **`item:produced` est dans `SaveSystem.SAVE_ON`.** Sans lui les cadeaux passifs
   n'existent qu'en mémoire ; fermer l'onglet les perd. Test de garde :
   `tests/unit/SaveCoordinates.spec.ts`.
3. **`board:reconcile` fait deux passes, dans cet ordre** : conversion de lattice
   exacte, *puis seulement* la réparation « case libre la plus proche », réservée à
   `worldAuthorsItsCells`. Inverser l'ordre transforme un changement d'unité
   résoluble en tas informe ; enlever le garde fait dériver le Cristal.
4. **Un seul prédicat pour l'éveil de la Dragonne d'or** (`src/core/goldenPromise.ts`),
   utilisé par les 3 sites. C'est la duplication de cette règle qui faisait repousser
   l'œuf sur l'autel à chaque rechargement.
5. **Les lois d'architecture de `CLAUDE.md`** : tout passe par l'`EventBus`, seuls les
   systèmes mutent `GameState`, les systèmes restent sans Phaser. Le PowerGovernor
   arrive de main avec son propre événement (`POWER_STATE_EVENT`) — le laisser tel
   quel, ne pas le convertir, mais ne pas non plus lui laisser toucher l'état.
6. **`SAVE_VERSION` reste à 8.** Le champ `worlds[].lattice` est additif et optionnel.
   Le monter ferait refuser les sauvegardes actuelles par les anciens builds
   (`peek` accepte `version <= SAVE_VERSION`).

## 5. Vérification — non négociable

```bash
pnpm verify        # typecheck → 201 tests unitaires → build → e2e complet
```

L'e2e traverse tout le tutoriel jusqu'à la fin du Chapitre Un **et compare le plateau
avant/après un rechargement** — c'est lui qui a attrapé les cadeaux passifs perdus.
S'il échoue sur le panneau « Beyond the demo » (ligne ~511), regarder la charge de la
machine avant le code : ce beat dépend du framerate et la boîte doit être calme
(`uptime`, load < 3).

Ensuite, dans le navigateur, une fois :

```js
window.__emberkeep.audit()
```

Il doit rapporter **aucun problème**, et la Dragonne d'or présente dans **exactement
un** monde.

Enfin, à l'œil, dans cet ordre — ce sont les quatre choses que la fusion peut casser
sans qu'aucun test ne le voie :

1. Le tutoriel jusqu'au bout, puis téléportation vers *The Lair* : la dragonne au
   centre, les baies à côté d'elle, la caméra qui arrive sur elle.
2. Retour sur l'île : le Cristal vert **à sa place**, l'autel **vide**.
3. Fermer l'onglet, rouvrir : rien n'a bougé, rien ne manque.
4. Sur un appareil faible : pas de crash mémoire GPU au chargement.

## 6. Ce qu'il ne faut pas faire

- **Ne pas rebaser**, ne pas écraser (`--ours` / `--theirs` en masse). Les 9 conflits
  se lisent en dix minutes ; un `-X ours` en perd trois silencieusement.
- **Ne pas « nettoyer » en fusionnant.** Toute reformulation qui n'est pas exigée par
  un conflit rend la revue impossible. Deux commits séparés si besoin.
- **Ne pas régénérer** `src/data/map.json`, `src/data/faces.json`,
  `src/data/ui-theme.json` : ce sont des fichiers GÉNÉRÉS, et les régénérer pendant
  une fusion mélange deux problèmes. Voir `docs/pipelines.md`.
- **Ne pas toucher à `asset3d/editor-map.json`** : c'est le projet éditeur, et c'est
  lui qui donne un sens à toutes les coordonnées sauvegardées.

## 7. L'ÉDITEUR DE CARTE N'EST PAS LIVRÉ — et il ne se supprime pas non plus

**Instruction du propriétaire du projet : l'éditeur de carte lui appartient. Personne
d'autre ne doit pouvoir l'ouvrir.** Aucune fusion ne doit l'exposer davantage, et
aucune ne doit le retirer.

Il faut tenir les deux, parce que « l'éditeur » désigne aujourd'hui deux choses très
différentes et qu'en confondre une avec l'autre casse le jeu :

| | quoi | destin |
|---|---|---|
| **L'OUTIL** | le bouton *Editor* du panneau Réglages ([UIScene.ts:1521](../src/scenes/UIScene.ts#L1521)), l'événement `editor:open`, le chrome DOM (`EditorDom`, `BoardEditor`), le dessin de grilles/zones, l'import/export de projet, l'écriture disque | **privé — jamais accessible au joueur** |
| **LA DONNÉE ET SA RESTAURATION** | `asset3d/editor-map.json`, `MapEditor.onGameStarted` / `switchToWorld` / `applyBaseToGame`, `ctx.worldPreparer` | **doit être livré — c'est le monde lui-même** |

### Pourquoi la seconde ligne n'est pas négociable

Depuis la correction du démarrage, **`MapEditor` est le `worldPreparer` de
`Context.beginRun`** : c'est lui qui installe les cases jouables, le fond et surtout
la **lattice** — l'unité dans laquelle chaque `(col,row)` sauvegardé est écrit.
Supprimer la classe, ou couper son enregistrement, ne « retire pas un outil de dev » :
ça laisse le jeu lire toutes les coordonnées du joueur dans la mauvaise unité. Le
repaire s'ouvre sur du vide, les pièces atterrissent n'importe où, la sauvegarde se
réécrit fausse.

**Donc : on ferme la porte, on ne démolit pas le bâtiment.**

### Ce qu'il faut faire

L'état actuel est un trou : le bouton *Editor* est dans le panneau Réglages, visible
par tout le monde, **sans aucun garde**. La fusion doit le refermer.

1. Mettre le bouton derrière un garde explicite — au choix, du plus simple au plus
   sûr : `import.meta.env.DEV`, un paramètre d'URL secret, ou une constante de build.
   Le garde doit porter sur **la création du bouton**, pas sur son `visible` : un
   bouton invisible reste cliquable et découvrable.
2. Laisser `new MapEditor(game, ctx)` dans [main.ts](../src/main.ts) **inconditionnel**,
   et `ctx.worldPreparer` toujours branché. C'est le point ci-dessus.
3. Idéalement, ne pas embarquer le chrome DOM dans le bundle joueur (import dynamique
   côté `open()`), pour que le poids et le code de l'outil ne partent pas non plus.
   Optionnel : la porte fermée suffit à respecter l'instruction.
4. Ne toucher à `asset3d/editor-map.json` sous aucun prétexte — voir §6.

### Vérification

Après la fusion, sur un build de production (`pnpm build && pnpm preview`) : ouvrir
Réglages. **Aucun bouton *Editor*.** Puis vérifier que le jeu fonctionne quand même
de bout en bout — tutoriel, téléportation vers *The Lair*, retour, rechargement. Si
le repaire est vide ou les pièces dispersées, c'est que le point 2 a été violé.

## 8. Hygiène, avant de commencer

26 captures d'écran d'une voie de vérification (`tests/e2e/shots-sv/`) ont été
committées par accident — `.gitignore` couvrait `dist-*/` et `test-results-*/` mais
pas les captures. La ligne est ajoutée ; les fichiers déjà suivis se retirent à la
main :

```bash
git rm -r --cached tests/e2e/shots-sv
```

À faire **avant** la fusion, pour qu'ils n'apparaissent pas dans son diff.

---

**Lectures obligatoires avant de résoudre** : `CLAUDE.md` (lois d'architecture),
`docs/ripple-map.md` (qui écoute quoi — requis avant tout changement transverse),
`docs/worlds.md` (les trois mondes, la lattice et ses trois pièges).
