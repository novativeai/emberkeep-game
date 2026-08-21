/** Shared types: board model, data-file schemas, and the full EventBus contract. */

import type { PersistedPlace } from './mapSpace';

export type { PersistedPlace };

export interface TilePos {
  col: number;
  row: number;
}

export type ItemKind = 'item' | 'decor';

export interface BoardItemState {
  id: number;
  chain: string;
  tier: number;
  col: number;
  row: number;
  kind: ItemKind;
  /** Absolute clock time at which a TAP-harvested generator may produce again. */
  readyAt?: number;
  /** Absolute clock time at which this generator PASSIVELY gifts its next item. */
  passiveAt?: number;
  /** Productions banked toward this generator's `bonus` drop (see
   *  GeneratorConfig.bonus). Counts up and is spent, never reset, so a full
   *  board DEFERS the rare drop instead of losing it. */
  yields?: number;
  /**
   * What THIS generator makes, overriding its tier's `generator.produces`.
   *
   * The House's commission: a finished House is dedicated to one merge piece —
   * chosen by the player from the Bag — and makes that, forever. Per ITEM and
   * not per tier, because the whole point is that two Houses can be dedicated to
   * two different things; a second item generator costs a second House.
   *
   * Write-once. `GeneratorSystem` refuses to change a set commission, so the
   * choice is a commitment rather than a menu, which is what makes the second
   * House worth building.
   */
  produces?: { chain: string; tier: number };
  /**
   * A BOARD dragon's care record — what it has eaten today, and what it thinks
   * of the Keeper.
   *
   * Chapter One has dragons and no Cold Nest, so the only dragons in it stand on
   * the merge board as items. They are still fed, and feeding still earns trust;
   * what they do NOT get is a `Companion` record, because that is the named,
   * un-mergeable thing the nest chapter produces (DragonSystem's naming law).
   * So care lives here, per ITEM — the same shape the House's commission takes,
   * and for the same reason: it is an instance's history, not its tier's.
   *
   * Consumed with the item on a merge, deliberately. Two Red Dragons becoming an
   * Adult is one dragon growing up, not two records to reconcile — and the
   * survivor keeps the higher trust (`MergeSystem` carries it over), so a
   * player is never punished for raising the pair they merged.
   */
  care?: DragonCare;
  /**
   * What the Keeper named this dragon.
   *
   * The naming law says a NAMED thing never touches the merge board, and a
   * companion out of a Cold Nest obeys it exactly. Chapter One's dragons cannot:
   * they are the board, and the first one is the emotional beat the whole
   * opening builds to. So they are named where they stand, and the one thing
   * that would break the law — a named dragon being consumed and forgotten — is
   * answered by carrying the name through the merge instead (`MergeSystem`), so
   * a merge reads as her growing up rather than as her being spent.
   *
   * Absent = never named, and the readout falls back to the tier's own name.
   */
  dragonName?: string;
}

/** Per-board-dragon care. `day`/`trustDay` are `dayIndexAt` stamps, so both
 *  daily allowances reset on the virtual clock like every other timer. */
export interface DragonCare {
  /**
   * CYCLE stamp the meal/green tallies below belong to (`cycleIndexAt`, the
   * 10-minute feed window). The field kept its old name when hunger moved from
   * the 32-minute day onto the cycle: an old save's day stamp simply never
   * matches a cycle index, so its stale tallies reset once on load — exactly
   * what a rollover does anyway.
   */
  day: number;
  /** Servings eaten this cycle, taste-weighted (MEALS_PER_DAY fills the gauge). */
  meals: number;
  /** Cooling servings eaten this cycle (DAILY_GREEN is the cycle's need). */
  green: number;
  /** 0..TRUST_MAX. Earned by feeding, at most once a DAY (`dayIndexAt` — a
   *  relationship is not an appetite), and never decays. */
  trust: number;
  /** Day stamp of the last trust gain — the once-a-day latch. */
  trustDay: number;
  /** Lifetime count of WELL-FED cycles — cycles whose gauge reached full
   *  (MEALS_PER_DAY). The Codex's number, and the evolution condition's coin. */
  wellFedCycles?: number;
  /** Cycle stamp of the last well-fed credit — the once-per-cycle latch. */
  wellFedCycle?: number;
  /** Taste knowledge, discovered by EXPERIMENT (merge-chains §2.1): the Codex
   *  shows his favourite only after a meal he loved, and his dislike only
   *  after he has actually turned his head away. Never told, always learned. */
  favouriteKnown?: boolean;
  dislikeKnown?: boolean;
}

export type RegionStatus = 'active' | 'unlockable' | 'locked';

export type SpawnCause = 'init' | 'merge' | 'generator' | 'unlock' | 'load' | 'quest' | 'store';

export interface ItemSnapshot {
  id: number;
  chain: string;
  tier: number;
  col: number;
  row: number;
  kind: ItemKind;
  ready?: boolean;
}

/* ------------------------------------------------------------------ */
/* Data file schemas (src/data/*.json)                                  */
/* ------------------------------------------------------------------ */

export interface GeneratorConfig {
  /** Spawns this item per cycle (item generators: dragons, the big tree). */
  produces?: { chain: string; tier: number };
  /** A RARE second drop from the same generator: every `every` productions it
   *  also drops this piece. The Ripe Emberberry Plant pays one Emberberry
   *  Sprout per 12 berries, so the patch can be grown into a second patch
   *  without the food itself ever being the gate. */
  bonus?: { every: number; produces: { chain: string; tier: number } };
  /** Grants currency/energy per cycle instead of an item (the house). */
  reward?: { coins?: number; xp?: number; energy?: number };
  cooldownMs: number;
  energyCost: number;
  /** If set, the generator also PASSIVELY gifts one produce every this-many ms
   *  — free, no tap, no energy. The standing advantage of owning a dragon. */
  passiveMs?: number;
  /** Tap-to-harvest? Passive-only generators (house, big tree) set false: they
   *  auto-produce on their passive timer; a tap only offers the energy skip. */
  tappable?: boolean;
  /** Most GOLD the "buy now" skip can cost on THIS generator (the Crystal's
   *  emeralds are dear). Falls back to GENERATOR_SKIP_MAX_ENERGY when unset. */
  skipMaxGold?: number;
}

export interface ChainTierConfig {
  tier: number;
  id: string;
  name: string;
  sell: number;
  /** XP granted when a merge produces this tier. */
  xp: number;
  /** false = the sell path refuses this tier (story items like the Golden Egg). */
  sellable?: boolean;
  generator?: GeneratorConfig;
  /** Per-TIER merge recipe override — takes precedence over the chain-level
   *  `merge` when merging items of THIS tier (e.g. 2 Houses → 1 Manor while
   *  Bushes still merge 3 → 1 House). */
  merge?: ChainMergeOverride;
  /** Display scale for this tier's board art. Consulted AFTER Constants'
   *  ITEM_SCALE (which wins for hand-tuned keys) — this is the data-driven
   *  path the worldbuilder Merge page writes for uploaded art. */
  artScale?: number;
  /**
   * This tier is COMMISSIONED: the player picks what it will make, once, from
   * the pieces in their Bag, and it makes that for the rest of its life
   * (`BoardItemState.produces`).
   *
   * Data-driven rather than a hardcoded `chain === 'lumber'`, so the House is
   * an instance of the rule rather than the rule itself. A commissioned tier
   * still needs a `generator.produces` — that is what it makes UNTIL it is
   * commissioned, so a player who closes the chooser is never left holding an
   * ornament.
   */
  chooseProduce?: boolean;
  /**
   * The highest tier this generator may be COMMISSIONED to make (default 1).
   * The rank of the building is the rank of the work: a House works simple
   * pieces — tier 1 — and a Manor takes tier 2 as well. Enforced in
   * `GeneratorSystem.commission` (reason `tier_too_high`), mirrored by the
   * chooser (ineligible bag slots render locked), and cited by the
   * `house_commission` tutorial beat.
   */
  produceMaxTier?: number;
}

/** Per-chain merge recipe override (e.g. 5 wood → 1 house). */
export interface ChainMergeOverride {
  /** Number consumed to make one next-tier item (default mergeRule.minGroup). */
  group: number;
  /** Next-tier items produced per merge (default 1). */
  outputs: number;
}

export interface ChainConfig {
  id: string;
  name: string;
  /**
   * The world this chain belongs to. Absent = it belongs to whichever world is
   * being played (the shared vocabulary: coin, chest, the dragon chains).
   *
   * This is NOT the same thing as `HIDDEN_CHAINS`, and conflating the two was
   * the trap. A chain can be withheld for two unrelated reasons: it belongs to
   * a later CHAPTER of this world (firepine, nest — `HIDDEN_CHAINS`), or it
   * belongs to a DIFFERENT WORLD entirely (Selyna's frozen roster — this
   * field). The first is a one-line switch a chapter flips; the second must
   * flip itself the moment the player crosses, and must never flip for the
   * world they came from. See `chainHiddenIn`.
   */
  world?: string;
  /** Tier whose creation counts as a hatch (dragon chains). */
  hatchAtTier?: number;
  /** Overrides the global mergeRule for this chain (e.g. lumber: 5 → 1). */
  merge?: ChainMergeOverride;
  /**
   * THE zone's legendary dragon — at most one chain per world may set this.
   *
   * It is the one chain no producer feeds: its eggs arrive only as quest
   * rewards, three of them, and three merge into the dragon. That makes it the
   * only piece in the game whose supply is the QUEST LADDER itself, which is
   * why the audit enforces a directive about how they are spaced
   * (docs/quest-ladder.md §7) rather than merely checking it is reachable.
   */
  legendary?: boolean;
  tiers: ChainTierConfig[];
}

export interface MergeRuleConfig {
  minGroup: number;
  fiveBonus: boolean;
  fiveGroup: number;
  fiveOutputs: number;
}

export interface ChainsData {
  mergeRule: MergeRuleConfig;
  chains: ChainConfig[];
}

export interface OrderRequirement {
  chain: string;
  tier: number;
  count: number;
}

export interface OrderConfig {
  id: string;
  giver: string;
  /**
   * The world this order can be filled in. Absent = the authored world.
   *
   * A Ledger that followed the Keeper north would keep asking for Gem Shards in
   * a place with no dragon to cough one up — the order would sit at 0/8 for
   * ever, and its "encore" would too. An order belongs where its giver stands,
   * for the same reason a chain does (`ChainConfig.world`).
   */
  world?: string;
  title: string;
  blurb: string;
  requires: OrderRequirement[];
  rewards: {
    coins: number;
    keys: number;
    xp?: number;
    spawn?: { chain: string; tier: number; count: number };
    /** Mystery-reward hint shown verbatim on the order card (e.g. "🥚 ???") —
     *  for rewards staged OUTSIDE the board, like the Golden Altar egg. */
    tease?: string;
  };
}

export interface OrdersData {
  orders: OrderConfig[];
  /** Encore templates cycled forever once the scripted orders are done, so the
   *  Ledger never dead-ends. Ids are synthesised as `encore_<n>`. */
  repeatable?: Omit<OrderConfig, 'id'>[];
}

/* ------------------------------------------------------------------ */
/* Dialogue + Keeper's Tasks data (src/data/dialogue.json, tasks.json)  */
/* ------------------------------------------------------------------ */

/** One chapter's spoken beats — a run of tap-advanced bubbles fired once, when
 *  the chapter's gate is met. Authored in docs/script-chapters.md. */
export interface StoryChapterConfig {
  speaker: SpeakerId;
  lines: string[];
}

/**
 * What one person says about the relationship itself.
 *
 * `hearts` is keyed "1".."5" — the beat played the moment that heart fills, and
 * the only place the gauge is ever explained. It is never shown as a number and
 * never named as a mechanic: Regard is expressed as CONDUCT (docs/quests.md
 * §1.3), so heart 3 is where she stops calling it "the ledger" and starts
 * calling it "ours", not where a tooltip says "Regard 3/5".
 */
export interface RegardDialogue {
  hearts: Record<string, StoryChapterConfig>;
  /** Rotating one-liners when she takes a gift she asked for. */
  giftAccepted: string[];
  /** …and when she is handed something she did not. A refusal is never silent,
   *  and it must never read as a failure — she is declining, not erroring. */
  giftDeclined: string[];
}

export interface DialogueData {
  /** Short Eleanor quotes stamped on the order-complete banner (rotating),
   *  banked BY STORY STAGE — key "1".."6". The same system says different things
   *  as the story moves, which is where weeks of dialogue come from without new
   *  design (docs/script-chapters.md, Part II). StorySystem picks the bank. */
  orderComplete: Record<string, string[]>;
  /** Post-tutorial chapter beats, keyed by chapter number. */
  chapters: Record<string, StoryChapterConfig>;
  /**
   * What is said the FIRST time the Keeper stands in a world, keyed by world id.
   *
   * Deliberately not a chapter. Chapters advance one at a time on gates that
   * read live state, and the crossing is rung 11 of a ladder whose rungs 3–10
   * are gated on systems that do not exist yet (the Cold Nest, Trust, the Dragon
   * Book). Wiring the north to `storyChapter` would either skip eight reveals or
   * stall behind them; an arrival is its own occasion and needs neither.
   */
  arrivals?: Record<string, StoryChapterConfig>;
  /** Golden Egg tap flavor, keyed by XP progress toward the Level-3 finale. */
  goldenEgg: { early: string[]; mid: string[]; near: string[] };
  /**
   * The Golden Elder's first words in the whole game — the finale beat. She is
   * silent until she wakes, which is what makes it land.
   *
   * LINES, not a line. It was typed `string` here while dialogue.json had long
   * since grown to two, and nothing caught the difference because the JSON is
   * cast into these interfaces rather than validated against them — so the
   * declared type was a claim no one was checking. The bubble then called
   * `text.replace` on an array, threw out of a `delayedCall`, and took the RAF
   * chain with it: the chapter's one irreversible beat froze the session.
   *
   * Typed as what it IS, so the compiler holds the call site to `sequence()`
   * (tap-advanced, the rule for every chapter beat) instead of `say()`.
   */
  finaleElder: string[];
  /** Finale variant when the Golden Egg was never earned (Order 1 skipped) —
   *  reads as PROPHECY, pointing the player back to the un-filled promise. */
  finaleElderProphecy: string[];
  /** Eleanor's banner quote the moment the egg materialises on the altar. */
  goldenArrival: string;
  /** Eleanor speaks the North Crossing open, right after the finale hands the
   *  board back — the beat that ends with the portal blooming (`gate:opened`). */
  gateOpens: { speaker: string; lines: string[] };
  /** First-arrival walkthroughs of the two hubs. Each plays once ever
   *  (stats `tour:<world>`); the Roothold one ends by unlocking the shop
   *  button (`shop:unlocked`). */
  tours: {
    roothold: { intro: string[]; house: string; sections: string[]; close: string; outro: string };
    runevault: { intro: string[]; cauldron: string; explain: string; close: string };
  };
  /** The Elder's line when Order 1 completes AFTER Level 3 — the late awakening. */
  lateAwakening: string;
  /** One-shot Eleanor nudges post-tutorial. */
  hints: {
    zeroWarmth: string;
    boardFull: string;
    eggTrembles: string;
    twoDragons: string;
    twoHouses: string;
    /** First time the skip popup is offered post-tutorial: it shows a Gold price
     *  and a Warmth price, and the tutorial only ever demonstrated Warmth. */
    goldSkip: string;
    /** First House the player finishes after the tutorial: what the chooser is
     *  actually asking, and the part that is easy to miss — the choice is
     *  PERMANENT, and a second output means a second House. */
    houseCommission: string;
  };
  /** Eleanor's line when all Keeper's Tasks complete. */
  tasksComplete: string;
  /** The five-hearts banks, keyed by character id (`eleanor`, `selyna`). */
  regard?: Record<string, RegardDialogue>;
}

/* ------------------------------------------------------------------ */
/* World characters (src/data/characters.json)                          */
/* ------------------------------------------------------------------ */

/** What a character can be asked to do. Each comes from her craft, so the
 *  fiction and the mechanic are the same sentence (docs/world-characters.md §4). */
export type CharacterAction = 'give_back';

export interface CharacterConfig {
  id: string;
  speaker: SpeakerId;
  /** Which map she stands on. She exists nowhere else — Selyna is never in
   *  Emberkeep, and that is canon, not staging. */
  world: string;
  /** Authored world cell. NOT a board tile: she is decor, never in `state.items`. */
  anchor: [number, number];
  /** Free nudge off that cell's centre, in WORLD-BUILDER pixels — the same units
   *  and meaning `MapData.mapDecor` dx/dy carry, rebased by TILE_W /
   *  map.tile.width at render. The lattice has no cell for a terrace rim, so the
   *  cell alone could only ever put her on the nearest diamond centre. Absent =
   *  centred. Authored in the World Builder (scripts/apply-characters.mjs). */
  dx?: number;
  dy?: number;
  /** Who this standee IS — wardrobe (standee banks, fallback, scale trim) AND
   *  identity (Regard, dialogue, action cooldown). Absent = the id. This is
   *  what lets Eleanor stand in Roothold too: a second placement entry that is
   *  still, in every social sense, Eleanor. */
  art?: string;
  action: CharacterAction;
  cooldownMs: number;
}

/** A named dragon. NEVER a BoardItem: anything with a name never touches the
 *  merge board (merge-chains.md §1.2). Acquired only from a Cold Nest. */
export interface Companion {
  id: string;
  /** Which dragon art/rig it uses. */
  chain: string;
  name: string;
  trust: number;
  /** Chain it likes best. Hidden until discovered by experiment. */
  favourite: string;
  /** Chain it refuses outright. Also hidden — a diet is a ratio, a favourite AND
   *  a refusal, and the refusal is what makes two dragons different to care for. */
  dislike: string;
  /** Book entries the player has actually revealed. */
  discovered: string[];
  /** Meals eaten so far on `mealDay` (fuel and green only — grit and drink are
   *  their own axes and never stand in for a meal). */
  meals: number;
  mealDay: number;
  /** Green (cooling) taken on `mealDay` — counts as a meal AND as its own axis. */
  green: number;
  /** Day it last dug (Trust 2) and last foraged (Trust 4) — once each per day. */
  dugDay: number;
  foragedDay: number;
  /** Servings banked toward adulthood, weighted by taste: 1 per favourite feed,
   *  ACCEPTED_RATE per accepted one. Adult at ADULT_SERVINGS[its rarity]. */
  growth: number;
  adult: boolean;
  /** Day its last Trust gain landed — Trust rises at most once a day. */
  trustDay: number;
  /** Where it stands in the world — the cell its nest was on. Not a board tile
   *  it occupies; it is scenery with a tap handler, like the world characters. */
  col: number;
  row: number;
}

/** Warming progress on one Cold Nest, keyed by its board cell. */
export interface NestState {
  points: number;
  /** Points banked on `day` — capped so stockpiling cannot compress the wait. */
  pointsToday: number;
  day: number;
}

export interface CharactersData {
  characters: CharacterConfig[];
}

/**
 * A lifetime counter a Keeper's Task can be measured against. Each kind is a
 * `GameState.stats` key TaskSystem owns, so a task never keeps a tally of its
 * own and cannot drift from the thing it claims to measure.
 *
 * `recipes` counts Cookbook pages discovered — first-time merges, which is a
 * number that only ever goes up and that every chain on the board contributes
 * to. It replaced a `hatches` task: dragons are deliberately scarce and dear
 * now, so a checklist row asking for four of them stopped being a chapter's
 * work and became a wall.
 */
export type TaskKind = 'hatches' | 'orders' | 'goldEarned' | 'merges' | 'elderTaps' | 'recipes';

export interface TaskConfig {
  id: string;
  label: string;
  kind: TaskKind;
  target: number;
  /** The task's subject doesn't exist before these gates (presentation only —
   *  progress can't move anyway; e.g. the Elder pre-awakening). */
  lockedUntil?: { order?: string; level?: number };
  /** Shown in place of the progress bar while locked. */
  lockedHint?: string;
}

/**
 * The cosmetics store (`src/data/store.json`) — Manor skins, decorations, and
 * the sections that are announced but not yet buyable.
 *
 * `kind` is what a purchase DOES, and it is the whole contract:
 *   'skin'  — swaps the art of the top-tier Manor. Owned + equipped.
 *   'decor' — places a non-merging prop on the board. Owned; one placement each.
 *   'soon'  — nothing is for sale; the section renders its blurb and a badge.
 * A 'soon' section carries no items ON PURPOSE: a priced card that cannot be
 * bought is worse than an honest empty shelf.
 */
export type StoreKind = 'skin' | 'dragon_skin' | 'decor' | 'soon';

/**
 * How rare a shelf item is meant to feel. It is PRESENTATION ONLY — a legendary
 * costs more and wears a violet foil plate with a travelling sheen, but it buys
 * exactly the same kind of thing an epic buys. Nothing here touches a payout.
 */
export type StoreRarity = 'epic' | 'legendary';

export interface StoreItem {
  id: string;
  name: string;
  blurb: string;
  /** Texture key from assets.json — the card art AND, for a Manor skin, the art
   *  the Manor swaps to. A `dragon_skin` card art is its own key-art
   *  illustration; the board art it swaps to is `skin_<id>_<tier>`. */
  art: string;
  gold: number;
  /** `dragon_skin` only: the merge chain this skin re-dresses ('ember_dragon',
   *  'emerald'). It is the wardrobe slot — one worn skin per dragon. */
  dragon?: string;
  /** A CHAIN-GRANT card (frost/storm): buying it spawns a clutch of three
   *  tier-1 eggs of this chain — the breed is its own merge line, not a skin.
   *  Mutually exclusive with `dragon`. */
  chain?: string;
  /** Absent = the plain cream card the Manor skins and decorations use. */
  rarity?: StoreRarity;
  /** The one showcase card in a section: full grid height, art full-bleed, and
   *  it always sorts first. At most one per section — the panel takes the first
   *  it finds and treats the rest as ordinary cards. */
  hero?: boolean;
  /**
   * The world this thing is MADE in — and therefore the only one it is sold in.
   * Absent would mean "sold on every shelf"; the shipped catalogue names a world
   * on EVERY card, and a unit test holds it that way, because a card that
   * quietly followed the Keeper everywhere is what this exists to remove.
   *
   * Half the catalogue is northern: ice cut in Borealis, rune stone under snow,
   * a dragon nested on the floes. Set this and the card is on the shelf only
   * while the Keeper stands in that world; everywhere else it wears a padlock
   * reading "Only in Borealis". Deliberately the CURRENT world rather than
   * "that world's door has opened" — travelling has to change what the stall
   * carries, or four hubs sell one identical catalogue and being somewhere
   * means nothing. A real gate, not a label: StoreSystem refuses the purchase
   * too, so it can never depend on the panel having drawn the card right.
   */
  world?: string;
}

export interface StoreSection {
  id: string;
  title: string;
  blurb: string;
  kind: StoreKind;
  items: StoreItem[];
}

export interface StoreData {
  sections: StoreSection[];
}

export interface TasksData {
  tasks: TaskConfig[];
  reward: { coins: number; energy: number };
}

/* ------------------------------------------------------------------ */
/* The Cauldron (src/data/cauldron.json)                                */
/* ------------------------------------------------------------------ */

/** One brew: consume `inputs` out of the Bag, bank `output` into it. The
 *  cauldron trades in the Bag ONLY — it never touches a board, which is what
 *  lets it live in the Runevault hub and still spend goods gathered anywhere. */
export interface CauldronRecipeConfig {
  id: string;
  output: { chain: string; tier: number; count: number };
  inputs: Array<{ chain: string; tier: number; count: number }>;
  /** Selyna's grimoire line — italic flavor under the recipe name. */
  flavor: string;
  /** What the output is FOR — the panel's answer to "why brew this". */
  use: string;
  /**
   * The quest whose completion writes this page into the grimoire. Absent =
   * known from the first visit (the ledger opens with four such). Availability
   * is the `q:done:<quest>` latch — save-derivable, like everything the altar
   * and tracker read — and a unit test proves every quest that DEMANDS a brew
   * sits strictly after the quest that unlocks its recipe, so the ladder can
   * never ask for a formula Selyna has not taught.
   */
  unlock?: { quest: string };
}

export interface CauldronData {
  recipes: CauldronRecipeConfig[];
}

/* ------------------------------------------------------------------ */
/* The quest ladder (src/data/quests.json)                              */
/* ------------------------------------------------------------------ */

/**
 * What finishes a subquest. Every kind reads state that ALREADY exists — no
 * goal keeps its own counter, so a goal can't drift from the thing it claims to
 * measure (the same law StorySystem's chapter gates follow).
 *
 *   'have'         — this many of a chain+tier standing on the board RIGHT NOW.
 *                    Non-monotonic (delivering consumes them), so QuestSystem
 *                    latches it the first time it is seen met.
 *   'order'        — a specific Ledger order delivered.
 *   'active_order' — whatever order the Ledger is currently showing. The endless
 *                    tail: it never completes, because the encore never runs out.
 *   'stat'         — a lifetime counter TaskSystem already keeps.
 *   'task'         — mirrors one Keeper's Task by id. Label, target, lock and
 *                    progress all come from tasks.json, so the checklist has
 *                    exactly ONE definition and the HUD cannot disagree with the
 *                    Ledger's Tasks tab.
 *   'level'        — Keeper level.
 *   'region'       — a region's fog is lifted.
 *   'recipe'       — a Cookbook page discovered (chain:from>to).
 *   'world'        — the player has STOOD in that world. The journey goal: it is
 *                    what a crossing completes, and (being latched on arrival)
 *                    it stays true after they come home. A world may only ever
 *                    be opened by a quest step, never by a merge — see the
 *                    `teleport` placeholder in worlds.json for the trap.
 *   'gift'         — this many of a piece GIVEN to a person (tap her, then tap
 *                    the piece). The relationship subquest: the thing she needs,
 *                    handed over rather than delivered to a Ledger. Consumed on
 *                    the way, so the availability audit counts it as a need.
 *   'regard'       — that person's hearts. The only goal that reads a
 *                    relationship, and the one that lets a quest be gated on
 *                    one (`lockedUntil.regard` gates a STEP; this finishes one).
 */
export type QuestGoal =
  | { kind: 'have'; chain: string; tier: number; count: number }
  | { kind: 'order'; orderId: string }
  | { kind: 'active_order' }
  | { kind: 'stat'; stat: TaskKind; count: number }
  | { kind: 'task'; taskId: string }
  | { kind: 'level'; level: number }
  | { kind: 'region'; regionId: string }
  | { kind: 'recipe'; chain: string; fromTier: number; toTier: number }
  /**
   * Brewed at Selyna's Cauldron, `count` times (`cauldron.json` recipe ids).
   *
   * A LIFETIME counter (`brew:<recipeId>` in `stats`), like `gift` and unlike
   * `have`: brewing is a thing that happened, so spending the output cannot
   * un-do the step and it never needs latching. The cauldron trades Bag→Bag,
   * so this goal is world-agnostic by construction — but the audit still
   * charges the step its recipe's inputs, in the world that asks.
   */
  | { kind: 'brew'; recipeId: string; count: number }
  | { kind: 'world'; worldId: string }
  | { kind: 'gift'; characterId: string; chain: string; tier: number; count: number }
  | { kind: 'regard'; characterId: string; hearts: number };

export interface QuestStepConfig {
  id: string;
  /** HUD label. Omitted for `task` goals — tasks.json owns their wording. */
  label?: string;
  goal: QuestGoal;
  /**
   * Merge pieces this step needs that its goal does NOT already name — the
   * dragons behind a `hatches` stat, the Elder behind `elderTaps`. The
   * availability audit (src/core/availability.ts) reads goal-implied needs AND
   * these; anything a step consumes must be listed in one or the other or the
   * audit is checking a lie.
   */
  needs?: OrderRequirement[];
  /**
   * Same shape as TaskConfig — a step whose subject doesn't exist yet is not
   * shown as an active subquest until its gate opens.
   *
   * `regard` is the relationship gate: she will not ask for this until she
   * thinks enough of you. It reads hearts, never points, so authored data says
   * the thing the player can see on screen.
   */
  lockedUntil?: {
    order?: string;
    level?: number;
    regard?: { characterId: string; hearts: number };
  };
  lockedHint?: string;
}

export interface QuestConfig {
  id: string;
  /** Story chapter this quest belongs to (docs/quest-ladder.md). */
  chapter: number;
  /**
   * Which world this quest is tracked in. Absent = the authored world
   * (`WORLD_ID`). The HUD shows one quest at a time and a `have` goal reads the
   * board you are STANDING on, so a quest asking for Emberkeep goods would read
   * `0 / 6` from the north — the ladder is filtered by world for that reason,
   * not merely for tidiness. A quest with `world` set is invisible until the
   * player is there.
   */
  world?: string;
  giver: SpeakerId;
  /**
   * The whole QUEST is dormant until another quest's done-latch flips
   * (`q:done:<id>` in stats). Distinct from a step's `lockedUntil`: a locked
   * step still belongs to a live quest, whereas a locked quest is not tracked,
   * not latched and not announced — its giver does not exist yet as far as the
   * HUD is concerned. This is what keeps the Golden Elder's ladder from
   * pre-completing during Eleanor's: steps latch wherever they are met, so
   * without the gate his "hold two Gold Pouches" would silently latch weeks
   * before he wakes.
   */
  lockedUntil?: { quest?: string };
  /** HUD title. Omitted only by the endless tail, which borrows the live
   *  order's title. */
  title?: string;
  /** The Ledger order this quest is the story of, when it has one. */
  orderId?: string;
  steps: QuestStepConfig[];
  /**
   * Paid ONCE, when the quest's last step lands. Distinct from the order
   * reward on `orderId`: that is what the Ledger pays for goods delivered, this
   * is what the STORY pays for the quest being done — and only a quest reward
   * may carry a legendary egg, because only the ladder's shape can guarantee
   * three of them arrive spaced out and finish the zone.
   *
   * `spawn` banks its overflow in the Bag, so a full board can never eat one.
   */
  rewards?: {
    coins?: number;
    keys?: number;
    xp?: number;
    spawn?: { chain: string; tier: number; count: number };
  };
  /**
   * Regard points paid to `giver` when this quest completes. Absent =
   * `REGARD_QUEST_POINTS`, which is what paces the gauge to fill across the
   * whole campaign; an explicit `0` says "this one is not about her" (the
   * endless Ledger tail, a Keeper's-Tasks checklist).
   */
  regard?: number;
  /**
   * Design intent the offline audit checks (`pnpm quests`). `levelAtEnd` is the
   * Keeper level this quest's last step is supposed to leave the player on — the
   * Chapter One finale is choreographed off Level 3, so which quest lands it is
   * a story fact, not an accident of tuning. The audit models the FLOOR (scripted
   * XP only, no free-play merges), so a shortfall is reported with the gap
   * rather than treated as broken.
   */
  expects?: { levelAtEnd?: number };
}

export interface QuestsData {
  quests: QuestConfig[];
}

/** One pooled stack in the Bag. Identical chain+tier pieces share a slot. */
export interface BagStack {
  chain: string;
  tier: number;
  count: number;
}

export interface MapItemPlacement {
  chain: string;
  tier: number;
  at: [number, number];
}

export interface MapDecorPlacement {
  decor: string;
  at: [number, number];
}

/**
 * Static authored scenery from the world builder's `decor` category (huts,
 * crystals, landmarks). Painted like tiles — part of the MAP, not save state —
 * so a re-imported world refreshes the scene for everyone. `name` is the slug;
 * the texture loads as `decor_<name>`.
 */
export interface MapDecorRender {
  name: string;
  col: number;
  row: number;
  z?: number;
  /** Free-move offset in world px from the cell centre (world-builder Move tool). */
  dx?: number;
  dy?: number;
}

/** Procedural animated 3D decor (world-builder 🧊 tab — the emerald crystal). */
export interface MapDecor3dRender extends MapDecorRender {
  model3d?: {
    shape: string; color: string; material: string; outline: string;
    spinDegPerSec: number; camera: string; steps: number;
  } | null;
}

export interface MapRegionConfig {
  id: string;
  status: RegionStatus;
  /** Tile list as [col, row] pairs. */
  tiles: [number, number][];
  /** A region lifts on spending `keys` Gold Keys OR on reaching Keeper `level`. */
  unlock?: { keys?: number; level?: number };
  /**
   * Wear a cloud while locked? Default true — fog is how the board says "there
   * is ground here, come and take it".
   *
   * False for ground the player cannot reach in this chapter AT ALL. A cloud is
   * a promise the player can act on; one that cannot lift for the entire shipped
   * game is not a tease but a lie, and it hides painted scenery behind a
   * permanent grey lid. The cells stay real, addressable and saveable — they are
   * simply not advertised yet, and the flag flips when the chapter that opens
   * them ships.
   */
  fog?: boolean;
  contents?: MapItemPlacement[];
  decor?: MapDecorPlacement[];
}

/** Per-asset placement calibration measured in the world builder. */
export interface TileCalibration {
  offsetX: number;
  offsetY: number;
  scale: number;
  anchor: { x: number; y: number };
}

/** Where the camera frames each Keeper level (focal cell on the grid). */
export interface CameraKeyframe {
  level: number;
  focus?: { col: number; row: number };
  world?: { x: number; y: number };
  zoom?: number;
}

export interface MapData {
  cols: number;
  rows: number;
  regions: MapRegionConfig[];
  startingItems: MapItemPlacement[];
  /** Featured decor placed on the active board at new-game (e.g. the L1 dragon). */
  startingDecor?: MapDecorPlacement[];
  /** Authored tile footprint (world-builder units). `skew`/`angle` describe the
   *  full parametric projection the world was drawn at; `iso.projectionOf`
   *  reads width/height/skew, and map space depends on all three, so they are
   *  declared here rather than left as undeclared extras on the JSON. */
  tile?: { width: number; height: number; skew?: number | null; angle?: number };
  /** All playable cells as [col, row] (for void/cliff silhouette detection). */
  playable?: [number, number][];
  /** Which tile-art variant sits on each playable cell, keyed "col,row". */
  tilesByCell?: Record<string, string>;
  /** Placement calibration keyed by bare tile-art name. */
  calibration?: Record<string, TileCalibration>;
  /** Static authored scenery (world-builder `decor`), painted like tiles. */
  mapDecor?: MapDecorRender[];
  /** Placement calibration for map decor, keyed by decor slug. */
  decorCalibration?: Record<string, TileCalibration>;
  /** Playable cells with NO tile art — the background/void shows through, keyed "col,row" elsewhere as [col,row]. */
  invisible?: [number, number][];
  /** A layer painted BELOW the floor (world-builder Background), + its calibration. */
  backgrounds?: MapDecorRender[];
  backgroundCalibration?: Record<string, TileCalibration>;
  /** The background's cell extent — the camera frontier (pan/zoom can't go past it). */
  backgroundBounds?: { minCol: number; maxCol: number; minRow: number; maxRow: number } | null;
  /** Procedural Three.js decor (the emerald crystal) + its calibration. */
  decor3d?: MapDecor3dRender[];
  decor3dCalibration?: Record<string, TileCalibration>;
  /** In-game wheel-zoom clamp authored in the world builder. */
  cameraZoom?: { min: number; max: number };
  /** Per-level camera framing. */
  cameraKeyframes?: CameraKeyframe[];
}

export type TutorialGate =
  | { type: 'tap' }
  | { type: 'event'; event: 'item:merged' | 'item:hatched' | 'item:harvested' | 'item:sold' | 'order:completed' | 'region:unlocked' | 'ui:ledger_opened' | 'ui:cookbook_opened' | 'ui:cookbook_closed' | 'ui:codex_closed' | 'ui:codex_dragon_opened' | 'ui:codex_evolution_opened' | 'chest:open' | 'dragon:working' | 'dragon:fed' | 'dragon:named' | 'regard:gift_accepted' | 'ui:character_tapped' | 'bag:give_armed' | 'generator:produce_set' | 'marketplace:purchased' | 'generator:skipped' | 'bag:stored' | 'character:action_used'; chain?: string; currency?: 'gold' | 'warmth' }
  | { type: 'count'; chain: string; tier: number; count: number }
  /**
   * A piece of `chain` CARRIED into `region` — the board-hygiene lesson. The
   * gate is the drop landing inside the named region's tiles, so a wiggle on
   * the spot cannot satisfy it. Requires `allow.drag` to include the chain.
   *
   * `at` narrows it to ONE CELL — the cell the beat's hand already points at.
   * Without it the lesson said "out there" and accepted any tile of a field, so
   * the gesture the player was shown and the gesture the game asked for were
   * two different gestures. With it they are one, and a drop anywhere else
   * simply leaves the hand pointing (the piece stays draggable, so there is
   * nothing to be stuck in). A cell somebody else is standing on cannot be
   * asked for, and the director falls back to the field (or to any drop, when
   * no field is named) rather than to a dead beat.
   *
   * `region` is optional once `at` is given: the lesson's seat is on one of
   * the small islands, and those belong to NO region — they are open ground
   * from the first frame, with no authored cloud over them. A gate names at
   * least one of the two.
   */
  | { type: 'move'; chain: string; region?: string; at?: [number, number] };

export interface TutorialAllow {
  /** Chain ids the player may drag ('*' = all). */
  drag?: string[];
  tapGenerators?: boolean;
  ledger?: boolean;
  deliver?: boolean;
  fog?: boolean;
  sell?: boolean;
  /** Allow tapping a dragon to open the Work/Harvest job menu during tutorial. */
  dragonWork?: boolean;
  /** Allow tapping the energy ⚡ shop button during tutorial. */
  marketplace?: boolean;
  /** Allow tapping the Emberkeep Cookbook button during tutorial. */
  cookbook?: boolean;
  /**
   * The Codex lesson is mid-walk: the book is HELD open.
   *
   * Its beats are gated on turning pages, and Phaser delivers a pointerup to
   * every interactive object under it — so the tap that answers Eleanor also
   * lands on the panel's scrim, and without this the book shuts under the step
   * waiting on it. While set, the scrim ignores taps and both exits leave the
   * page, so the beat has exactly one thing to do. The beat that teaches
   * CLOSING the book deliberately omits it.
   */
  codexHold?: boolean;
  /** Allow tap-to-pocket (BagSystem). Off by default mid-tutorial: pocketing a
   *  scripted piece would strand the step that wants it merged. */
  bag?: boolean;
  /** Allow tapping a world character (Eleanor) to ask for her help. */
  character?: boolean;
  /** Allow the bag chooser's GIVE button. Drawn either way — a refused action
   *  answers with a nudge, never with silence (tutorial-design law 3). */
  give?: boolean;
  /** Show the status readout under the quest tracker. Latched once set — see
   *  UIScene. It debuts on the beat that teaches Eleanor's hearts. */
  status?: boolean;
  /** Allow dragging a good onto a dragon to feed it. Off by default mid-tutorial
   *  for the same reason `bag` is: a scripted piece eaten by a dragon strands the
   *  step that wanted it merged. */
  feed?: boolean;
  /** Allow the House's commission chooser to open. Off for the whole tutorial
   *  except the one beat that teaches it — an unheralded modal landing on
   *  `house_skip` would bury the lesson under it. */
  commission?: boolean;
}

/**
 * A tile reference in tutorial data: a literal [col,row], the dynamic
 * `last_hatched` marker, or a `{ chain, nth }` token that resolves at runtime to
 * the nth board item of that chain. Tokens keep tutorial hints glued to the
 * ACTUAL item placement, so they stay correct for any imported map.
 */
export type TileRef = [number, number] | 'last_hatched' | { chain: string; nth: number; tier?: number };

/**
 * A UI landmark the tutorial's hand or arrow can point at.
 *
 * One list, named once: it is read by the hand config, the arrow config and
 * both of their resolved forms, and four copies of the same union is how a
 * target lands in the data with nowhere in `UIScene.uiTarget` to answer it.
 * The three `codex_*` entries walk the Codex lesson in order — the dragon's
 * card on the roster, the EVOLUTION button on its page, then the ✕.
 */
export type TutorialUiTarget =
  | 'ledger'
  | 'deliver'
  | 'marketplace'
  | 'cookbook'
  | 'cookbook_close'
  | 'codex_card'
  | 'codex_evolution'
  | 'codex_close'
  | 'bag'
  | 'bag_give'
  | 'status'
  | 'commission';

export type TutorialHandConfig =
  | { from: TileRef; to: TileRef }
  | { ui: TutorialUiTarget }
  | { fogRegion: string };

export type TutorialArrowConfig =
  | { tile: TileRef }
  | { ui: TutorialUiTarget }
  | { fogRegion: string }
  /** A world character by id. NEVER point at one with a literal `tile` — where
   *  she stands is authored in the World Builder (`characters.json` anchor +
   *  dx/dy), so a hardcoded cell goes stale the moment she is moved and the
   *  arrow ends up over empty ground. This resolves against her LIVE standee. */
  | { character: string };

/**
 * Scripted side-effects a tutorial step runs the moment it becomes active —
 * the spec's "reward" beats: spawn the dragon eggs after the plant merge, ripen
 * the bush after the hatch, hand over the key before the fog lesson.
 */
export type TutorialEffect =
  | { spawn: { chain: string; tier: number; count: number; nearChain?: string; nearTier?: number; at?: [number, number] } }
  | { retier: { chain: string; fromTier: number; toTier: number } }
  | { grantKeys: number }
  | { grantXp: number }
  | { advanceClock: number }
  | { setEnergy: number }
  | { move: { chain: string; tier: number; to: [number, number] } }
  | { setTimer: { chain: string; tier: number; remainingMs: number } }
  /**
   * Open the Dragon Codex on the first named dragon — the lesson that shows the
   * book writing itself. `reveal: 'favourite'` opens on the roster and arms the
   * cinematic fade-in of the favourite-meal row (just discovered by the feed the
   * previous beat scripted) for the page the player then opens.
   *
   * `page` is what a RESUME needs: every beat of the lesson carries this effect
   * with the page its bubble is standing on, so a save reloaded mid-book comes
   * back to the same spread instead of to a gate on a panel that is not there.
   * The effect is idempotent — an already-open Codex ignores it.
   */
  | { openCodex: { reveal?: 'favourite'; page?: 'roster' | 'detail' | 'evolution' } }
  /** Open the naming prompt on the first board dragon of this chain+tier. The
   *  panel is not dismissible, so this is only ever authored on a step whose
   *  gate is the naming itself. */
  | { nameDragon: { chain: string; tier: number } }
  /**
   * Make a character want a piece for the duration of one lesson.
   *
   * Regard normally answers only to the quest ladder — a gift is accepted when,
   * and only when, a live `gift` subquest names that exact piece. The tutorial
   * runs before the Ledger is even open, so the give-gesture had nothing to be
   * taught with; this is the scripted equivalent of that subquest, and it is
   * consumed the moment the gift lands.
   */
  | {
      wantGift: {
        characterId: string;
        chain: string;
        tier: number;
        count: number;
        /** Regard paid for THIS gift, overriding `REGARD_GIFT_POINTS`. A scripted
         *  gift is usually a keepsake rather than one of twelve deliveries, and a
         *  lesson about the hearts has to actually light one. */
        points?: number;
      };
    };

/**
 * Who can speak in the dialogue bubble. `eleanor` is the guide AND the quest
 * giver — she teaches, she keeps the Ledger, and she is the only voice for most
 * of the game. `golden_elder` is deliberately SILENT until she wakes, so her
 * first line is an event; `selyna` arrives with the Borealis sanctuary.
 * Only `eleanor` ships an animated disc atlas today (see PortraitAnimator);
 * anyone else falls back to their static `portrait_<id>` texture.
 */
export type SpeakerId = 'eleanor' | 'selyna' | 'golden_elder';

/**
 * Where the arrow goes ONCE THE CHARACTER IS ARMED, for a beat whose lesson is
 * two-handed ("tap me, then tap the House").
 *
 * Without it the arrow sits on her for the whole step: the player taps her,
 * nothing about the pointer changes, and the only new signal is a tile
 * highlight they have no reason to connect to the gesture they just made. The
 * hand must follow the lesson — she is done, the House is next.
 */
export type TutorialArrowThenConfig = TutorialArrowConfig;

export interface TutorialStepConfig {
  id: string;
  speaker: SpeakerId;
  text: string;
  gate: TutorialGate;
  highlight?: TileRef[];
  hand?: TutorialHandConfig;
  arrow?: TutorialArrowConfig;
  /** Where the arrow moves once the step's character is ARMED (see
   *  TutorialArrowThenConfig). Only meaningful beside `arrow: { character }`. */
  arrowThen?: TutorialArrowThenConfig;
  allow?: TutorialAllow;
  /** Side-effects fired once, when this step becomes the active step. */
  effects?: TutorialEffect[];
}

export interface TutorialData {
  steps: TutorialStepConfig[];
}

/**
 * A baked spin sheet — `src/data/crystal-spin.json`, GENERATED by
 * `scripts/bake-crystal.mjs` + `scripts/pack-crystal.py`. Never hand-edit it.
 *
 * The sheet is played where the LIVE three.js gem is declined (every touch
 * device, and the `low` profile). It carries its own `anchor` and `itemScale`
 * because the packer trims the source canvas symmetrically and may rescale it —
 * the `anchors.json` entry and `ITEM_SCALE` that fit the untrimmed 803x902
 * texture would seat it wrong, so the numbers that describe the pixels ship WITH
 * the pixels.
 */
export interface SpinSheet {
  frameWidth: number;
  frameHeight: number;
  frames: number;
  columns: number;
  rows: number;
  /** One full loop. The gem is 4-fold symmetric about Y, so this is 90° of spin. */
  periodMs: number;
  anchor: [number, number];
  itemScale: number;
  sourceSize: [number, number];
}

export interface AssetEntry {
  key: string;
  /** 'placeholder' = generated at runtime; 'file' = load from assets/ (public dir). */
  source: 'placeholder' | 'file';
  /** Path relative to assets/ when source === 'file', e.g. 'raw/ai/egg.png'. */
  file?: string;
  generator: string;
}

export interface AssetsManifest {
  images: AssetEntry[];
}

export interface AnchorsData {
  default: [number, number];
  byKey: Record<string, [number, number]>;
}

/* ------------------------------------------------------------------ */
/* The Dragon Codex (src/data/dragondex.json)                           */
/* ------------------------------------------------------------------ */

/** One breed's Codex entry — the lore card behind its face. */
export interface DragondexEntry {
  /** Breed display title (the named dragon's own name headlines the card). */
  title: string;
  /** Kept SHORT by design — one or two sentences; the card is a keepsake,
   *  not a wiki. */
  story: string;
  personality: string;
  ability: string;
  /** The Evolution page. `reveal` is the ADULT's reveal-art texture key,
   *  shown as a silhouette until the condition is met; `wellFedCycles`
   *  mirrors WELL_FED_EVOLUTION (the data states the words, Constants the
   *  number the systems enforce — a mismatch is caught by the unit test). */
  evolution?: {
    wellFedCycles: number;
    into: string;
    reveal: string;
    condition: string;
  };
}

export interface DragondexData {
  dragons: Record<string, DragondexEntry>;
}

/* ------------------------------------------------------------------ */
/* Save schema                                                          */
/* ------------------------------------------------------------------ */

/** A board item as PERSISTED: its grid cell, plus where that cell sits on the
 *  world's art. See `src/core/mapSpace.ts` — the grid cell is what the game
 *  runs on, the place is what survives the world being re-gridded into zones. */
export interface SavedBoardItem extends BoardItemState {
  place?: PersistedPlace;
}

/**
 * One world's board as persisted. The default world's is stored at the TOP
 * LEVEL of the save (where it has always been, so a save written before travel
 * existed loads with nothing to migrate); every other world's goes in `boards`.
 */
export interface SavedWorldBoard {
  /** `mapSignature` for THAT world's grid. */
  mapSignature?: string;
  items: SavedBoardItem[];
  nests?: Record<string, NestState>;
  nestPlaces?: Record<string, PersistedPlace>;
}

export interface SaveDataV1 {
  version: number;
  savedAt: number;
  items: SavedBoardItem[];
  nextItemId: number;
  /** Which world this save belongs to. Absent on saves written before worlds
   *  were named; assumed to be the build's own `WORLD_ID`. */
  world?: string;
  /** Where the player currently stands. Absent = the authored world, which is
   *  where every save written before world travel resumes. */
  activeWorld?: string;
  /** Boards for worlds OTHER than the authored one, keyed by world id. Only
   *  worlds the player has actually put something on appear here. */
  boards?: Record<string, SavedWorldBoard>;
  /** Fingerprint of the grid this save's `(col,row)` were written against
   *  (`mapSignature`). When it no longer matches the map being loaded, the grid
   *  moved under the save and positions are recovered from `place` instead. */
  mapSignature?: string;
  /** Map-space positions for the Cold Nests, keyed by the same "col,row" as
   *  `nests`, so a nest relocates with its cell rather than being orphaned. */
  nestPlaces?: Record<string, PersistedPlace>;
  regions: Record<string, RegionStatus>;
  energy: { current: number; lastRegenAt: number };
  coins: number;
  keys: number;
  xp: number;
  orderProgress: { completedIds: string[] };
  tutorial: { index: number; done: boolean };
  /** Lifetime counters (Keeper's Tasks + chapter-card stats) and one-shot
   *  flags (`finaleSeen`, `tasksClaimed`) — all numeric for easy versioning. */
  stats: Record<string, number>;
  /** First-time merge discoveries for the Emberkeep Cookbook — keys like
   *  `"ember_dragon:1>2"`. Optional: older saves default to []. */
  discoveredRecipes?: string[];
  /** Stored Bag stacks. Optional: older saves default to []. */
  bag?: BagStack[];
  /** How far the campaign has come, 1..12. Optional: older saves default to 1. */
  storyChapter?: number;
  /** Per-character action cooldowns, `characterId -> readyAt` (GameClock ms). */
  characterCooldowns?: Record<string, number>;
  /** Named dragons. Optional: older saves default to []. */
  companions?: Companion[];
  /** Cold Nest warming progress, keyed "col,row". */
  nests?: Record<string, NestState>;
  /** Store item ids the player has bought. Optional: older saves default to []. */
  ownedCosmetics?: string[];
  /** The equipped Manor skin id, or null for the authored Manor. */
  manorSkin?: string | null;
  /** Equipped DRAGON skins, keyed by the chain each one re-skins
   *  (`{ ember_dragon: 'ashglass' }`). Keyed rather than a single slot because
   *  the breeds are different animals — wearing Ashglass on the ember dragon
   *  says nothing about what the emerald dragon is wearing. */
  dragonSkins?: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* Real-money packs (IAP)                                               */
/* ------------------------------------------------------------------ */

/**
 * A real-money pack offered by the EmberGames hub. The catalog arrives over
 * the host-page bridge (`iapBridge`) — the game never hard-codes prices, so
 * the hub's `IAP_PACKS` stays the single source of truth for what money buys.
 */
export interface IapPackInfo {
  id: string;
  name: string;
  blurb: string;
  /** Price in EUR (display only — the hub's gateway does the charging). */
  amountEur: number;
  coins: number;
  keys: number;
  energy: number;
}

/**
 * One authored SHOWCASE coin pack (`src/data/coin-packs.json`).
 *
 * The showcase is what a build with no gateway shows where the hub's real
 * catalog would be — the Emporium's GOLD shelf falls back to it. It is
 * deliberately id-LESS: an offer's `packId` is what routes a tap to the real
 * checkout, so a showcase row must have no way of growing one.
 */
export interface CoinPackShowcase {
  name: string;
  coins: number;
  /** Price in EUR. A NUMBER, formatted at the one place that prints it — the
   *  hub's own packs arrive as `amountEur` too, so both sources print alike. */
  amountEur: number;
  /** The authored "MOST POPULAR" row. Presentation only. */
  best?: boolean;
}

export interface CoinPacksData {
  showcase: CoinPackShowcase[];
}

/**
 * A coin pack as a SHELF sees it, whichever source it came from
 * (`src/core/coinPacks.ts` resolves the two into this one shape).
 */
export interface CoinOffer {
  name: string;
  coins: number;
  /** Formatted for print ("€9.99") — EUR on both sources. */
  price: string;
  /** Set ONLY on a REAL hub pack. Its PRESENCE is the routing rule: with it a
   *  tap emits `ui:iap_buy_requested`; without it this row came from the
   *  authored showcase and a tap can only take the mock-grant path. */
  packId?: string;
  best?: boolean;
}

/**
 * Which refused purchase raised the shortfall notice.
 *
 * Named surfaces rather than a free string, so adding one is a deliberate edit
 * — `TOP_UP.offer` decides whether that surface actually offers the notice, and
 * a surface it has never heard of cannot quietly start showing a paywall.
 *
 *   store   the Keeper's Store — a skin/decor/dragon refused for want of Gold.
 *   warmth  the Emporium's own WARMTH shelf, refused the same way. This one is
 *           already INSIDE the coin shop's panel, so its way out is a TAB
 *           switch rather than a second copy of the Emporium.
 *   skip    the offer pinned over a working producer (the House's bubble) —
 *           the board surface the owner named, and the only one of the three
 *           that is not a panel.
 */
export type TopUpSource = 'store' | 'warmth' | 'skip';

/* ------------------------------------------------------------------ */
/* EventBus contract                                                    */
/* ------------------------------------------------------------------ */

export interface EventMap {
  /* -- input intents (scenes/UI emit, systems handle) -- */
  'drag:dropped': { itemId: number; from: TilePos; to: TilePos };
  'item:tapped': { itemId: number };
  /** Intent: stash the tapped board piece in the Bag (BagSystem handles it). */
  'ui:store_requested': { itemId: number };
  /** The commission chooser opened/closed — the tutorial's `house_commission`
   *  beat reads it, and the HUD dims behind it. */
  'ui:commission_toggled': { open: boolean };
  /** Intent: DROP one of this stack back out onto the board. */
  /** `count` is how many the player asked for in one go (the Bag's stepper).
   *  Optional and defaulting to 1, so every older caller still means "one". A
   *  retrieval takes as many as the board has room for and stops — a partial
   *  answer is the honest one when the isle fills up mid-request. */
  'ui:bag_retrieve_requested': { chain: string; tier: number; count?: number };

  /* -- the House's commission (GeneratorSystem owns what a generator makes) -- */
  /**
   * Intent: dedicate this commissioned generator to one piece from the Bag.
   *
   * Refused, never silently ignored, when the generator is already committed,
   * when its tier is not commissionable, or when the Bag does not hold the
   * piece — only what the player actually has can be commissioned, which is why
   * the chooser shows the Bag rather than the whole roster.
   */
  /**
   * Intent: open the commission chooser for this generator.
   *
   * The board decides WHEN to ask (a House was just finished; an undecided one
   * was tapped) and the UI owns the panel, so the two never reach into each
   * other — the same split every other panel in the game already keeps.
   */
  'ui:commission_requested': { itemId: number };
  'ui:produce_choice_requested': { itemId: number; chain: string; tier: number };
  /** Fact: this generator is now dedicated. Fired once per generator, ever. */
  'generator:produce_set': { itemId: number; chain: string; tier: number };
  'generator:produce_refused': {
    itemId: number;
    reason: 'already_set' | 'not_commissionable' | 'not_in_bag' | 'tier_too_high';
  };
  /** Intent: SELL one of this stack for coins. Selling lives in the Bag and
   *  nowhere else — a piece on the board can be dragged, merged or pocketed,
   *  never sold, so the board keeps exactly one destructive verb and the player
   *  has to have chosen to put something aside before they can lose it.
   *  EconomySystem owns it (it owns coins) and commands `bag:consume`. */
  /** `count` as above: sell this many at once rather than one tap per piece. */
  'ui:bag_sell_requested': { chain: string; tier: number; count?: number };
  /** Command: take `count` of this stack out of the Bag. BagSystem owns the bag,
   *  exactly as BoardSystem owns the grid behind `board:consume_items`. */
  'bag:consume': { chain: string; tier: number; count: number };
  /** COMMAND — put pieces straight into the Bag without them ever standing on
   *  the board. The overflow path for a reward that had nowhere to land. */
  'bag:bank': { chain: string; tier: number; count: number };
  /** Intent: open/close the Bag panel. */
  'ui:bag_toggled': Record<string, never>;
  /** `gift` is a FREE skip paid by a character action, not by the player.
   *  GeneratorSystem stays the only thing that touches a timer. */
  'generator:skip': { itemId: number; currency: 'gold' | 'warmth' | 'gift' };
  /* -- dragon jobs -- */
  'dragon:work': { dragonId: number; houseId: number };
  'dragon:working': { dragonId: number; houseId: number };
  'dragon:rest': { dragonId: number };
  'dragon:rested': { dragonId: number };
  'ui:ledger_toggled': { open: boolean };
  /** The Keeper's Store opened/closed. */
  'ui:store_toggled': { open: boolean };
  /** The Ember Emporium opened/closed, and on which shelf. The shortfall
   *  notice's "return ticket" rides the CLOSE: the player who was sent here
   *  from another panel is put back where they were when they leave. */
  /** `cause` is who closed it: the player (the ✕) or the game itself (the
   *  finale clearing the stage). The shortfall notice's return ticket only
   *  answers to `'player'` — a system close must not put the Keeper's Store
   *  back on screen over a story beat. Absent on the `open: true` side. */
  'ui:shop_toggled': { open: boolean; currency: 'energy' | 'coins'; cause?: 'player' | 'system' };
  /** The Emberkeep Cookbook panel opened/closed (tutorial gates + analytics). */
  'ui:cookbook_opened': { discovered: number };
  'ui:cookbook_closed': { discovered: number };
  /** Intent: the cauldron decor in the Runevault hub was tapped. */
  'ui:cauldron_tapped': Record<string, never>;
  /** The Cauldron panel opened/closed. */
  'ui:cauldron_toggled': { open: boolean };
  /** Command: brew this recipe. CauldronSystem validates the Bag and owns the
   *  outcome — the panel only asks. */
  'cauldron:brew': { recipeId: string };
  /** Fact: inputs left the Bag, the output was banked into it. */
  'cauldron:brewed': { recipeId: string; output: { chain: string; tier: number; count: number } };
  /** Fact: the brew was refused, and why — never silently. */
  'cauldron:brew_failed': { recipeId: string; reason: 'ingredients' | 'bag_full' | 'locked' };
  'ui:deliver_requested': { orderId: string };
  'ui:gift_deliver_requested': { characterId: string; chain: string; tier: number };
  /** A gauge "+" button opened the currency shop for that currency. */
  'ui:shop_requested': { currency: 'energy' | 'coins' };
  /** Intent: a real-money pack's price plate was tapped in the Emporium.
   *  UIScene gates it (post-tutorial only) and opens the confirm dialog. */
  'ui:iap_buy_requested': { packId: string };
  /**
   * Intent: a purchase was just refused for want of GOLD, and the surface that
   * refused would like the shortfall notice raised over itself.
   *
   * The refusing surface knows WHAT was refused and WHAT it costs; it does not
   * decide whether the offer is allowed. UIScene owns that gate — strictly
   * post-tutorial, and the surface must be one `TOP_UP.offer` names — and it
   * owns the notice, wherever the refusal came from. A board surface therefore
   * emits this rather than drawing anything: BoardScene has no business
   * painting a modal, and UIScene has no business knowing about a skip pin.
   *
   * `price` is the FULL price, not the shortfall: the wallet moves while the
   * notice is up (a grant can land behind it), so the notice subtracts live
   * state itself and its headline stays true afterwards.
   */
  'ui:topup_requested': { label: string; price: number; source: TopUpSource };
  /**
   * Fact: the shortfall notice opened/closed.
   *
   * The panel underneath suspends its SCROLL while it is up. This is not
   * politeness: the scrolling panels read drag off `scene.input`'s own
   * POINTER_DOWN/MOVE/UP, which fire for every pointer in the scene no matter
   * which object captured them — so without this, a thumb sliding on the notice
   * scrolls the shelf the player is trying to keep their place in. Only
   * StorePanel listens (it is the one scrolling panel a refusal can be raised
   * over); Cookbook and Cauldron sell nothing and cannot raise this.
   */
  'ui:topup_toggled': { open: boolean };
  /** Intent: buy a store cosmetic. StoreSystem validates gold and ownership. */
  'ui:store_buy_requested': { itemId: string };
  /** Intent: wear an owned Manor skin, or null to go back to the authored one. */
  'ui:store_equip_requested': { itemId: string | null };
  /** Fact: a cosmetic was bought (gold already spent). */
  'store:purchased': { itemId: string; kind: StoreKind; gold: number };
  /** Fact: the purchase was refused — the panel shakes the price. */
  'store:purchase_failed': { itemId: string; reason: 'gold' | 'owned' | 'no_room' | 'locked' };
  /** Fact: the Manor now wears this skin (null = the authored art). BoardScene
   *  re-textures every lumber_4 on the board. */
  'store:skin_changed': { itemId: string | null };
  /** Fact: this DRAGON now wears this skin (null = its authored art).
   *  BoardScene re-textures every item of that chain whose tier has skin art. */
  'store:dragon_skin_changed': { dragon: string; itemId: string | null };
  /** Settings toggled the background music on/off (AudioManager applies it). */
  'audio:set_music_muted': { muted: boolean };
  'fog:tapped': { regionId: string };
  'tutorial:advance_requested': { stepId: string };
  'game:reset_requested': Record<string, never>;
  /** Settings asks for the Map Editor (`src/editor/`), the tool that authors the
   *  zone registry the engine runs. An intent, like every other UI→system message —
   *  the editor subscribes, nothing calls into it. */
  'editor:open': Record<string, never>;
  'time:advanced': { ms: number };

  /* -- cross-system commands (systems handle, synchronously) -- */
  'energy:spend': { amount: number; reason: string };
  'energy:add': { amount: number; reason: string };
  'energy:set': { value: number; reason: string };
  'economy:add': { coins?: number; keys?: number; xp?: number; reason: string };
  'economy:spend_keys': { keys: number; reason: string };
  /** Command: a hub-confirmed real-money purchase arrived over the bridge.
   *  IapSystem applies it EXACTLY ONCE (`stats['iap:<purchaseId>']` is the
   *  latch), granting via `economy:add` / `energy:add`, then announces
   *  `iap:completed`. Replayed deliveries are silently absorbed. */
  'iap:grant': { purchaseId: string; packId: string; name: string; coins: number; keys: number; energy: number };
  'board:consume_items': { itemIds: number[]; reason: string };
  /** Scripted spawn of `count` items, into free tiles near an item of `nearChain`. */
  /**
   * `overflow` decides what happens to the pieces there was no room for.
   * Default (absent) is the shipped behaviour: they are simply not spawned,
   * which is correct for a renewable drop — the generator will pay again.
   * `'bag'` banks the remainder instead, and is REQUIRED for anything finite:
   * a legendary egg exists exactly three times in a zone, so a full board must
   * never be able to destroy one.
   */
  'board:spawn': { chain: string; tier: number; count: number; nearChain?: string; nearTier?: number; at?: [number, number]; overflow?: 'bag'; cause?: SpawnCause };
  /** Transform one on-board item of `chain`+`fromTier` into `toTier` in place. */
  'board:retier': { chain: string; fromTier: number; toTier: number };
  /** Relocate one on-board item of `chain`+`tier` to a cell (tutorial staging). */
  'board:move': { chain: string; tier: number; to: [number, number] };
  /** Place a bought decoration on the board. Decor never merges and never
   *  occupies a tile the player needs for a merge — BoardSystem picks the
   *  FURTHEST free active tile from the busy middle for exactly that reason. */
  'board:place_decor': { decor: string };
  /** Fact: there was nowhere to put it. The store refunds nothing because it
   *  never charged — StoreSystem asks the board first. */
  'board:decor_placed': { decor: string; at: TilePos | null };
  /** Force a generator's tap-cooldown to `remainingMs` left (tutorial staging). */
  'generator:set_timer': { chain: string; tier: number; remainingMs: number };

  /** A treasure chest was tapped — ChestSystem grants a random reward + removes it. */
  'chest:open': { itemId: number };
  /** `coins` lets the scene put the real coin art beside a Gold gift's label. */
  'chest:claimed': { chestId: number; label: string; coins: boolean };

  /* -- state-change notifications (systems emit; UI + audio subscribe) -- */
  /** Fact: the hub sent (or updated) the real-money pack catalog. An empty
   *  list means purchases are unavailable (standalone build, no hub parent). */
  'iap:catalog_changed': { packs: IapPackInfo[] };
  /** Fact: the secure checkout window was opened for this pack. */
  'iap:checkout_opened': { packId: string };
  /** Fact: the purchase was applied — UIScene throws the confetti, the
   *  AudioManager plays the purchase fanfare. Amounts are what was granted. */
  'iap:completed': { purchaseId: string; packId: string; name: string; coins: number; keys: number; energy: number };
  /** Fact: the checkout ended without a delivery, and why. `pending` means the
   *  gateway hasn't confirmed yet — the hub delivers it on a later visit. */
  'iap:failed': { packId: string; reason: 'cancelled' | 'declined' | 'pending' | 'unavailable' };
  /** The idle hand: a merge worth pointing at, or null to take the hand back.
   *  BoardScene decides WHICH (src/core/mergeHints.ts) and WHEN; UIScene owns
   *  the hand and refuses while the tutorial is still using it. */
  'hint:merge': { from: TilePos; to: TilePos } | null;
  /**
   * CARRY THIS THERE — the same hand, a different lesson.
   *
   * Its own event rather than a second caller of `hint:merge`, because the two
   * are taken back on different facts: a merge hint dies when the merge is made
   * or the player picks anything up, a carry lesson stands until the thing has
   * actually been carried. Sharing the event would mean sharing the take-back,
   * and the first drag of an unrelated piece would erase the lesson.
   */
  'hint:carry': { from: TilePos; to: TilePos } | null;
  'item:spawned': { item: ItemSnapshot; cause: SpawnCause };
  'item:moved': { itemId: number; from: TilePos; to: TilePos };
  'item:move_bounced': { itemId: number; at: TilePos };
  'item:merged': {
    chain: string;
    fromTier: number;
    resultTier: number;
    at: TilePos;
    consumedIds: number[];
    consumedAt: TilePos[];
    outputs: ItemSnapshot[];
    xp: number;
  };
  'item:hatched': { item: ItemSnapshot };
  /** Fact: this dragon FORM is the player's for the first time (RevealSystem
   *  latches it in `stats`, so it fires exactly once per save). UIScene plays
   *  the full-screen card and AudioManager roars; neither knows the other. */
  'dragon:revealed': { chain: string; tier: number; art: string; name: string; epithet: string };
  /** The reveal card is up (or has let go). Same shape as the other panel
   *  toggles, so anything that has to hold still while a card is open can. */
  'ui:reveal_toggled': { open: boolean };
  /** A merge recipe was performed for the FIRST time — the Emberkeep Cookbook
   *  writes a new page (MergeSystem emits once per chain:fromTier>resultTier). */
  'cookbook:discovered': { chain: string; fromTier: number; resultTier: number };
  'item:harvested': { generatorId: number; output: ItemSnapshot };
  /** `energy` is short of WARMTH and `gold` short of GOLD — they were one
   *  reason until the Gold-priced skip arrived, which meant a Gold shortfall
   *  shook the Warmth gauge (Hud) while the notice said "not enough gold". */
  'item:harvest_failed': {
    generatorId: number;
    reason: 'cooldown' | 'energy' | 'gold' | 'no_space' | 'asleep';
  };
  /** A generator passively gifted an item (no tap, no energy). */
  'item:produced': { generatorId: number; output: ItemSnapshot };
  /** A reward generator (the house) paid out currency/energy on its timer. */
  'generator:reward': { generatorId: number; coins: number; xp: number; energy: number };
  /** A generator's wait was paid off (the skip button) — currency tells which. */
  'generator:skipped': { itemId: number; chain: string; currency: 'gold' | 'warmth' | 'gift' };
  /**
   * Fact: the skip was refused because the wallet was short, with the price it
   * was refused AT.
   *
   * GeneratorSystem is the only thing that knows a skip's true cost (it falls
   * as the timer drains, and a per-generator cap can raise it), so the price in
   * a "you are N short" line has to come from here rather than be re-derived by
   * whatever draws it. Separate from `item:harvest_failed`, which stays the
   * FEEL of a refusal (the deny sound, the red flash) and carries no price.
   */
  'generator:skip_refused': {
    itemId: number;
    chain: string;
    tier: number;
    currency: 'gold' | 'warmth';
    cost: number;
  };
  /** A Gold coin was tapped to bank it — UI flies coin(s) to the Gold gauge,
   *  one gauge pulse per arrival (the Pouch sends 3; default 1). */
  /** A piece went into the Bag — UIScene flies it to the satchel and pulses it. */
  'bag:stored': { chain: string; tier: number; at: TilePos };
  /** Nothing was stored. `full` = no free slot; `no_room` = nowhere to put it back. */
  /** `wrong_world` carries the chain's home world id so the toast can name
   *  the door the piece is waiting behind. */
  'bag:store_failed': { reason: 'full' | 'no_room' | 'wrong_world'; world?: string };
  /** A piece came back out of the Bag onto `at`. */
  'bag:retrieved': { chain: string; tier: number; at: TilePos };
  /** The Bag's contents changed — the panel and the HUD badge re-read it. */
  'bag:changed': { used: number; capacity: number };

  /* -- world characters (WorldCharacterSystem owns cooldowns) -- */
  /** The player tapped a character standing on the map. */
  /* -- dragons as named companions (DragonSystem) -- */
  /** Intent: give one good to a Cold Nest. Tier N is worth N points. */
  'ui:nest_offer_requested': { col: number; row: number; chain: string; tier: number };
  'nest:warmed': { col: number; row: number; points: number; required: number };
  /** The nest refused: it has had its 3 points today, or the good is not food. */
  'nest:offer_refused': { col: number; row: number; reason: 'daily_cap' | 'not_food' };
  /** It hatched. The naming prompt opens on this, before anything else. */
  'nest:hatched': { companionId: string; chain: string; col: number; row: number };
  'ui:companion_named': { companionId: string; name: string };
  'companion:named': { companionId: string; name: string };
  /** Intent: feed a companion one good from the board or the bag. */
  'ui:feed_companion_requested': { companionId: string; chain: string; tier: number };
  'companion:fed': { companionId: string; chain: string; tier: number; favourite: boolean };
  /** It turned its head away — the chain is its refusal. Nothing was consumed. */
  'companion:refused': { companionId: string; chain: string };
  /** Trust 2: it dug up its own grit. Trust 4: it fetched you a favourite. */
  'companion:gave': { companionId: string; chain: string; tier: number; kind: 'dug' | 'foraged' };
  'companion:trust_changed': { companionId: string; trust: number };

  /* -- ambient life (DragonLifeSystem owns the mood; the board does the flying) -- */
  /**
   * A board dragon's mood changed. Fired on CHANGE only, never per tick.
   *
   * `asleep` is the day clock's night phase, `hungry` is its own care record
   * saying it has not eaten today. Purely presentational downstream: nothing in
   * the economy reads this, so a scene that ignored it would lose the character
   * and keep the game.
   */
  'dragon:mood': { itemId: number; mood: 'awake' | 'hungry' | 'asleep'; from: string };
  /** Fact: a dragon walked itself to another tile. The MOVE has already been
   *  applied to state — the scene's job is to make it look like a flight rather
   *  than a teleport (nothing on this board teleports). */
  'dragon:wandered': { itemId: number; from: TilePos; to: TilePos };
  /** It grew up — five well-fed days, no merging involved. */
  'companion:grew': { companionId: string };
  /** A Dragon Book entry revealed itself. */
  'companion:discovered': { companionId: string; entry: string };

  /* -- Board dragons: fed where they stand (BoardItemState.care) -- */
  /**
   * Intent: feed one good to the dragon standing on the board as `itemId`.
   *
   * The gesture is the piece DRAGGED onto the dragon, mirroring the dragon
   * dragged onto a House — the board's two "put this on that" verbs are the
   * same verb. Same contract as a nest offering and a gift: the board consumes
   * the piece only once the care record has actually moved.
   */
  'ui:feed_dragon_requested': { itemId: number; chain: string; tier: number };
  /** It ate. `meals`/`needs` are today's gauge, so a listener never recomputes. */
  'dragon:fed': {
    itemId: number;
    chain: string;
    tier: number;
    favourite: boolean;
    meals: number;
    needs: number;
  };
  /** It turned its head away — the chain is this breed's refusal, or it is not
   *  food at all. Nothing was consumed. */
  'dragon:refused': { itemId: number; chain: string; reason: 'dislike' | 'not_food' };
  /** Trust moved (at most once a day, +1, or +2 for a known favourite). */
  'dragon:trust_changed': { itemId: number; trust: number };
  /** The gauge filled inside one feed cycle — a WELL-FED cycle, credited once.
   *  `cycles` is the lifetime count the Codex shows, `needed` the evolution
   *  condition's bar, so a listener never has to look either up. */
  'dragon:well_fed': { itemId: number; chain: string; cycles: number; needed: number };
  /** Fact: the Codex turned to a page. The tutorial's codex lesson walks the
   *  player roster → dragon → evolution, so the PAGE is what its gates read;
   *  `open`/`closed` alone cannot tell those three beats apart. */
  'ui:codex_page': { page: 'roster' | 'detail' | 'evolution' };
  /** The Dragon Codex opened/closed. */
  'ui:codex_toggled': { open: boolean };
  /** Intent: open the Codex on the first named dragon's detail page — for a
   *  scripted reveal. UIScene owns the panel and answers. */
  'ui:codex_open_requested': { reveal?: 'favourite'; page?: 'roster' | 'detail' | 'evolution' };
  /** Intent: open the naming prompt for the dragon standing on the board as
   *  `itemId`. The tutorial's `nameDragon` effect is the only caller today. */
  'ui:name_dragon_requested': { itemId: number };
  /** The player chose. Emitted by the panel; DragonSystem writes the name. */
  'ui:dragon_named': { itemId: number; name: string };
  /** She has a name now. The one fact every readout and every line reads. */
  'dragon:named': { itemId: number; name: string; chain: string };

  /**
   * The Keeper is looking at somebody — a world character or a board dragon.
   * The status readout under the quest tracker follows this and nothing else,
   * so "who am I looking at" has exactly one answer on screen at a time.
   * `id` is a character id, or a board item id rendered as a string.
   */
  'ui:subject_selected': { kind: 'character' | 'dragon'; id: string };
  /** Nobody is selected any more (the armed character was put away, the dragon
   *  was merged or sold). The readout fades out. */
  'ui:subject_cleared': Record<string, never>;

  'ui:character_tapped': { characterId: string };
  /**
   * FACT: she is now holding a favour, waiting to be pointed at something (or
   * has just put it away). Distinct from `ui:character_tapped`, which also
   * fires for a tap she refuses on cooldown and for the tap that disarms her.
   *
   * The tutorial's second arrow rides this: `arrowThen` names the board target
   * a two-part step wants tapped AFTER her, and until this existed there was
   * nothing to tell the marker when the first half was done.
   */
  'ui:character_armed': { characterId: string; armed: boolean };
  /** Intent: use an armed action, optionally on a board target. */
  'ui:character_action_requested': { characterId: string; target?: number };

  /* -- Regard: the five hearts (RegardSystem owns the points) -- */
  /**
   * Intent: hand this piece to a person. The board consumes it only if she
   * takes it, so a declined gift costs the player nothing (the same contract
   * feeding a nest or a dragon already holds).
   */
  /** A tutorial beat stages a gift: for now, she wants this piece. Cleared as
   *  soon as it is handed over (see the `wantGift` effect). */
  'tutorial:want_gift': {
    characterId: string;
    chain: string;
    tier: number;
    count: number;
    points?: number;
  };
  /**
   * The bag's THIRD verb. Chosen from the slot chooser beside Drop and Sell.
   *
   * Giving is a two-part act — pick the thing, then pick who it is for — so this
   * only ARMS it: the panel closes and the next tap on a person or a dragon is
   * the delivery. That split is the whole reason it lives in the bag rather than
   * on the board: a piece you are holding is a piece you have already decided to
   * do something deliberate with.
   */
  'ui:bag_give_requested': { chain: string; tier: number };
  /** A give is armed and waiting for a recipient. The board listens. */
  'bag:give_armed': { chain: string; tier: number };
  /** Nothing is waiting any more — delivered, refused off, or tapped away. */
  'bag:give_cancelled': Record<string, never>;
  'ui:gift_requested': { characterId: string; chain: string; tier: number };
  'order:give': { characterId: string; chain: string; tier: number };
  /** She took it — a live `gift` subquest wanted exactly this. */
  'regard:gift_accepted': { characterId: string; chain: string; tier: number; points: number };
  /** She did not: nothing on her list asks for it, or her hearts are already
   *  full. Nothing was consumed either way. */
  'regard:gift_declined': {
    characterId: string;
    chain: string;
    tier: number;
    reason: 'not_wanted' | 'complete';
  };
  /** The gauge moved. `hearts` is the derived readout the UI draws. */
  'regard:changed': {
    characterId: string;
    points: number;
    hearts: number;
    reason: 'quest' | 'gift' | 'load';
  };
  /** A WHOLE heart filled — the milestone the dialogue bank speaks to. Fired
   *  once per heart, never on load (the points are persisted; the beat is not
   *  replayed the way a chapter's never is). */
  'regard:heart': { characterId: string; hearts: number };
  'character:action_used': { characterId: string; action: CharacterAction; readyAt: number };
  /** A refusal is never silent. `not_mine` is the story one: she cannot wake. */
  'character:action_failed': {
    characterId: string;
    reason: 'cooldown' | 'invalid_target' | 'not_mine';
  };

  /* -- story (StorySystem owns the chapter pointer) -- */
  /** The campaign moved on. Fired once per chapter, never on load. UIScene
   *  answers it by playing that chapter's beats through the dialogue bubble. */
  'story:chapter': { chapter: number };
  /** First time the Keeper has ever stood in this world — play its arrival
   *  beats. Fires once ever; the latch lives in `stats`, so a reload is silent. */
  'story:arrival': { worldId: string };
  /** The player tapped through the last beat of a chapter's run. */
  'story:beats_finished': { chapter: number };
  'item:removed': { itemId: number; at: TilePos; reason: 'sold' | 'delivered' };
  /** Fact: a piece was sold out of the Bag. No `itemId` — by the time anything
   *  is sellable it has left the board, so there is no board item to name. */
  'item:sold': { chain: string; tier: number; coins: number };
  'energy:changed': { current: number; max: number };
  'economy:changed': { coins: number; keys: number; xp: number; level: number };
  'keeper:leveled': { level: number; from: number };
  'energy:refill': { reason: string };
  'order:progress': { orderId: string; have: number[]; need: number[]; deliverable: boolean };

  /* -- the quest ladder (QuestSystem owns the pointer) -- */
  /** A subquest was satisfied. Fired ONCE per step, never on load. */
  'quest:step_completed': { questId: string; stepId: string };
  /** Every step of a quest is done — the main line strikes through and the next
   *  quest takes the HUD. */
  'quest:completed': { questId: string };
  /** The tracked quest changed (advance, or a load landing mid-ladder). */
  'quest:advanced': { questId: string; giver: SpeakerId; index: number; total: number };
  'order:completed': { orderId: string; rewards: { coins: number; keys: number; xp?: number } };
  'order:all_done': Record<string, never>;
  /**
   * COMMAND — put a region's authored contents on the board, no gate consulted.
   *
   * The one caller is a first arrival in a world. A world that is not the
   * authored one never runs `newGame`, so its opening board would otherwise be
   * whatever the fog happened to lift: bare ground, no producer, and no way to
   * ever make one, because a merge cannot cross to the island that has one.
   * Routed through the bus rather than called, because UnlockSystem owns
   * placing a region's contents and there must not be a second implementation
   * of it (the same reason a character's help emits the skip command).
   */
  'region:reveal': { regionId: string };
  'region:unlocked': { regionId: string; tiles: TilePos[]; revealed: ItemSnapshot[] };
  'region:unlock_failed': { regionId: string; reason: 'keys' | 'not_unlockable' | 'level' };
  'marketplace:purchased': { energy: number; free: boolean };
  /** The awakened Golden Elder was tapped (communing) — Keeper's Tasks counts it. */
  'elder:tapped': { itemId: number };
  /** Every Keeper's Task reached its target (fired once; reward already paid). */
  'tasks:all_complete': Record<string, never>;
  'tutorial:step': TutorialStepEvent;
  /**
   * THE SAME BEAT, RE-AIMED. Only the markers — where the hand, the arrow and
   * the highlights should be NOW that the board has changed under them.
   *
   * Its own event rather than a re-emitted step on purpose: the beat's text,
   * speaker and permissions are settled when it opens, and re-emitting the step
   * to move a pointer would restart the bubble and replay every staging effect
   * hanging off it. Emitted only when the answer has actually changed.
   */
  'tutorial:markers': {
    highlight: TilePos[];
    hand: ResolvedHand | null;
    arrow: ResolvedArrow | null;
  };
  /** The player touched something this step disallows. Never refuse in silence
   *  (tutorial-design law 3) — the UI re-pulses the hand/arrow at what the step
   *  actually wants, so a dead tap reads as guidance, not a broken button. */
  'tutorial:nudge': Record<string, never>;
  /** The skip popup opened — it offers BOTH a Gold and a Warmth price. Drives
   *  the one-shot `goldSkip` lesson (the tutorial only demonstrates Warmth). */
  'ui:skip_offered': { itemId: number };
  /**
   * The skip popup came down — paid, dismissed, or replaced by another one.
   *
   * The pair exists because the pin TAKES OVER the pointer while it is up: the
   * `house_skip` beat stands an arrow on the House so the player knows what to
   * tap, and the pin then draws its own arrow on the ⚡ row. Two arrows, one of
   * them pointing at a thing already done. So the tutorial's tile arrow stands
   * down on `offered` and comes back on `dismissed` — which is only correct if
   * the pin says when it leaves as reliably as it says when it arrives.
   */
  'ui:skip_dismissed': { itemId: number };
  'state:saved': { at: number };
  'state:loaded': { offlineMs: number; energyRecovered: number };
  'game:reset': Record<string, never>;

  /* -- world travel (WorldSystem owns the switch; see src/core/world.ts) -- */
  /** Intent/command: show a different world. Refused mid-tutorial and below the
   *  destination's Keeper level; the board it leaves keeps standing. */
  /**
   * Command: carry this board dragon THROUGH a gate — it leaves this world's
   * board and stands on the destination's. Not a travel: the Keeper stays put.
   * WorldSystem owns the landing cell and answers with `dragon:crossed`.
   */
  'dragon:cross_gate': { itemId: number; to: string };
  /** Fact: it went through, and this is where it came out. */
  'dragon:crossed': { itemId: number; from: string; to: string; at: TilePos };
  'world:switch': { to: string };
  /** Fact: the active world changed. BoardScene rebuilds on this — which means
   *  fetching art over the network, so this is where the travel veil goes UP. */
  'world:switched': { from: string; to: string };
  /** Fact: the new world's board is built and on screen. The veil comes down
   *  here, not on `world:switched` — between the two there is a texture fetch,
   *  and that gap is the entire reason a loading state exists. */
  'world:ready': { world: string };
  'world:switch_failed': { to: string; reason: 'unknown' | 'level' | 'tutorial' | 'same' | 'story' };
  /** Intent: a portal was tapped — UIScene answers with the travel prompt.
   *  `label` is the door's authored name, `world` the destination's display name. */
  'ui:travel_requested': { to: string; label: string; world: string };
  /** Fact: the Ember Gate ceremony finished (Eleanor's lines after the finale).
   *  BoardScene blooms the portal FX and re-enables its door on this. */
  'gate:opened': Record<string, never>;
  /** Intent: open the Emporium — the Roothold house is its physical storefront. */
  'ui:emporium_requested': Record<string, never>;
  /** Tour pointer over a BOARD landmark. BoardScene resolves the target's own
   *  world position (only it knows them) and bounces an arrow there. */
  'tour:point': { target: 'roothold_house' | 'runevault_cauldron' };
  'tour:unpoint': Record<string, never>;
  /** Fact: a world tour finished and its latch is set — a save point. */
  'tour:completed': { id: string };
}

/**
 * WHERE A MARKER AIMS — a cell, plus the identity of the PIECE it is aimed at
 * when it is aimed at a piece rather than at bare ground.
 *
 * A cell is a place; a piece is a thing, and a thing can be picked up. Resolving
 * a marker to a cell alone is what pinned the tutorial's hand to the tile a
 * dragon happened to be standing on when the beat opened: drag the dragon and
 * the hand stayed behind, still pointing at ground, telling the player to do
 * something to a piece that is not there any more.
 *
 * So the cell is kept — it is what every reader that only needs a PLACE still
 * reads (the board's camera-follow aims once, when the beat opens) — and `item`
 * rides beside it as the identity that survives a drag. Whoever draws the marker
 * re-reads that piece's cell every frame, exactly as `character` is re-read, so
 * the pointer follows the piece instead of the tile.
 *
 * Absent `item` = this end names GROUND (an empty gather cell, a fog gate, an
 * authored tile nobody is standing on) and the cell is the whole answer.
 *
 * `item` is a board-item id, and board items are per WORLD: an id that no longer
 * resolves means the piece is gone OR is standing on another isle, and both
 * answers are the same one — there is nothing here to point at.
 */
export interface MarkerPoint extends TilePos {
  item?: number;
}

export type ResolvedHand =
  | { from: MarkerPoint; to: MarkerPoint }
  | { ui: TutorialUiTarget }
  | { fogRegion: string };

export type ResolvedArrow =
  | { tile: MarkerPoint }
  | { ui: TutorialUiTarget }
  | { fogRegion: string }
  /** Stays an id through the payload, exactly like `ui`: the UI re-reads her
   *  position every frame, so she can move (World Builder, or a future walk)
   *  without the arrow being re-resolved. */
  | { character: string };

export interface TutorialStepEvent {
  id: string;
  index: number;
  total: number;
  done: boolean;
  speaker: SpeakerId;
  text: string;
  gateType: TutorialGate['type'];
  highlight: TilePos[];
  hand: ResolvedHand | null;
  arrow: ResolvedArrow | null;
  /** Where the arrow moves once this step's character is armed — null when the
   *  beat does not hand the pointer on (see TutorialArrowThenConfig). */
  arrowThen: ResolvedArrow | null;
  allow: Required<TutorialAllow>;
}

export type EventKey = keyof EventMap;
