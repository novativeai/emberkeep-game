# Fusion `origin/main` → `nionja` — ce qui a été fait

> Ce document remplace le brief du 2026-08-05. **Ce brief est périmé** : il était
> mesuré contre `origin/main@3a34c63`, quand main n'apportait que trois choses
> (plafond canvas 4096px, PowerGovernor, page *Merge design*) et que nionja portait
> tout le Chapitre Un. Depuis, main a absorbé `c2c6b48
> feat(chapter-one→production)` puis onze autres commits : mondes & zones, élevage
> des dragons, échelle de quêtes, nouveau casting, portails, achats réels, paliers
> graphiques, dist 252 → 30 Mo. **C'est main qui est le surensemble aujourd'hui**,
> et le sens de la fusion s'est inversé.

Fusion faite le 2026-08-11, `nionja@6c85f32` ← `origin/main@e8ff54a`
(base commune `866ca43`, 2026-07-13 — 22 commits contre 14, 67 fichiers `src/`
divergents, +13 572 lignes).

## La règle appliquée

> **Tout vient de main. Seuls l'éditeur et son outillage restent de nionja.**

`git merge -X theirs` ne suffit pas : il n'arbitre que les hunks *en conflit*, donc
les ajouts non conflictuels des deux côtés se télescopent (`DAY_PHASES` déclaré
deux fois, un `GameState` hybride — 303 erreurs de typage). La résolution est donc
`git checkout MERGE_HEAD -- .` : **la version de main pour tout fichier que main
possède**, les fichiers exclusifs à nionja restant intacts.

### Gardé de nionja

| | |
|---|---|
| `src/editor/**` | l'éditeur de carte (7 fichiers, 5 272 lignes) + `lattice.ts` (voir plus bas) |
| `scripts/audit-grids.mjs` | audit des grilles (historique — voir `docs/worlds.md`) |
| `scripts/verify-lane.mjs` + `verify:lane` | isolation des lanes quand plusieurs agents partagent ce checkout |
| plugins Vite `asset3dStore` / `editorMapStore` | le magasin disque de l'éditeur (`/__asset3d/*`, `/__editor/map`) |
| `asset3d/**` | le projet éditeur (cartes, modèles 3D, `editor-map.json`) |

### Supprimé (l'ancien système merge de nionja)

`DayCycleSystem`, `DragonDuelSystem`, `DragonFeedSystem`, `EmberfontSystem`,
`MilestoneSystem`, `WorldTeleportSystem`, `dayCycle.ts`, `worldChains.ts`,
`goldenPromise.ts`, `saveAudit.ts`, `Snowfall.ts`, `QuestPanel`, `StokeMeter`,
`MilestoneGift`, `DuelPanel`, `DuelButton`, `DragonGauges`, `BeyondDemoPanel`,
`panelSkin`, `emberfont.json`, `milestones.json`, `tutorial-borealis.json` et leurs
10 specs. Main couvre chacun de ces besoins autrement (`DragonLifeSystem`,
`RegardSystem`, `BagSystem`, `StorySystem`, `WorldSystem`, portails, `snow.json`…).

## Ce qui a changé POUR l'éditeur

L'éditeur pilotait le jeu par huit crochets que main a supprimés : des surcharges de
tuiles sur `GameState`, une charge utile de décor sur `BoardScene`, et **une lattice
globale** qu'il re-pointait par monde. Le moteur ne marche plus comme ça : un monde
est un registre de **zones** posées indépendamment (`src/core/world.ts`, construit
depuis `src/data/zones.json`), chacune avec sa taille de tuile, son origine et sa
rotation — c'est-à-dire le modèle de grille de cet éditeur, adopté par le moteur.

Réintroduire les huit crochets aurait recréé l'hybride. À la place :

```
« Appliquer » → assets/map/nionja-worlds.json  (l'export de l'éditeur, format inchangé)
              → scripts/ingest-worlds.mjs      → src/data/worlds.json
              → scripts/build-zones.mjs        → src/data/zones.json
              → Vite recharge le jeu sur les nouvelles zones
```

Le serveur de dev exécute les vrais scripts (`POST /__editor/worlds`, voir
`vite.config.ts`). **Aucune formule de géométrie n'est dupliquée dans le navigateur** :
`build-zones.mjs` reste seul propriétaire de la transformation éditeur→art.

Trois adaptations mineures ont suffi côté code :

- `src/editor/lattice.ts` — `Lattice`/`projectIn`/`unprojectIn` vivaient dans
  `core/iso.ts` du temps de la lattice globale ; cette math appartient à l'outil qui
  dessine des grilles, elle est donc devenue locale à l'éditeur.
- `teleport` lu depuis `src/data/worlds.json` (l'ancien `WORLD_TELEPORT` de
  `Constants` n'existe plus — main a des portails).
- une clé de bus, `editor:open`, et un bouton **Map Editor** dans le panneau Réglages.

## Gain mesuré

La lattice unique écrasait plusieurs cellules dessinées sur la même case : à peine la
moitié des cellules de roothold et de borealis survivaient. Les zones suppriment ce
repliement — **une cellule dessinée est une cellule réelle**.

## Assets

Les 15 assets « medium » étaient déjà câblés dans main. Sur les 19 « critiques », 11
l'étaient ; les 8 autres ont été rattachés aux équivalents de main plutôt que
redéclarés — et la plupart pointent déjà sur les fichiers d'origine :

| demandé | clé dans main | fichier |
|---|---|---|
| house | `decor_hut_houses_transparent_001` | `hut_houses_transparent_001.webp` |
| manor | `skin_manor_{igloo,mushroom,treehouse,windmill}` | 4 habillages |
| wood | `item_lumber_1..3`, `item_driftwood_1..3` | chaînes bois |
| stone | `item_quartz_1..3` | chaîne quartz |
| red-egg | `item_ember_dragon_2` | `red-egg.webp` |
| black-egg | `item_ashdrake_1`, `item_rimewyrm_1` | œufs de Borealis |
| key-icon | `ui_icon_key`, `icon_key_bronze` | `key-icon.webp` |
| coin_pouch | `item_coin_2` | `coin_pouch.webp` |
