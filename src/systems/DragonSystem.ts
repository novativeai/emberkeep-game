import {
  ACCEPTED_RATE,
  ADULT_SERVINGS,
  BOOK_REVEAL_CHANCE,
  cycleIndexAt,
  DAILY_GREEN,
  dayIndexAt,
  DRAGON_DIET,
  DRAGON_RARITY,
  LUCKY_TIER2_CHANCE,
  MEAL_VALUE,
  MEALS_PER_DAY,
  NEST_POINTS_PER_DAY,
  NEST_POINTS_REQUIRED,
  TRUST_DIGS,
  TRUST_FORAGES,
  TRUST_MAX,
  WELL_FED_EVOLUTION
} from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import type { BoardItemState, ChainsData, Companion, DragonCare } from '../core/types';

/** Goods a dragon will eat. Recipient locking (merge-chains §1.5) is ABSOLUTE:
 *  a dragon's meal cannot be spent on Eleanor, and NOTHING of hers is ever food.
 *  Quartz and moonwater are her chains end to end — no tier of either feeds a
 *  dragon, not even the raw pebble. */
const FUEL = ['emberberry', 'resin', 'emberheart', 'stormcap', 'emberdram', 'cinder_vein'];
const GREEN = ['ashmoss', 'nightbloom'];
// Recipient-locked to a named character, and therefore never dragon food.
// Eleanor catches light and holds it in GLASS; Selyna reads what the ice kept,
// so hers are the things that remember: spun light, raw mana and the needle
// that points at what is still down there.
const MAGE_ONLY = ['quartz', 'moonwater', 'auroraweave', 'manastone', 'wayfinder'];

/**
 * Chains a dragon standing in `world` can ever be handed. A Borealis chain is
 * vocabulary an Emberkeep dragon never meets, which is why `emberheart` can be a
 * refusal here but could never be anyone's favourite.
 *
 * The WORLD axis only — deliberately not `chainHiddenIn`, which also folds in
 * `HIDDEN_CHAINS`. That set withholds the husbandry roster from the CHAPTER,
 * and the chapter it is waiting on is the one that opens the Cold Nest: by the
 * time anything is being fed, it has lifted. Judging a diet through it would
 * declare every breed starving in the only chapter where nobody eats.
 */
const reachableIn = (chains: ChainsData, worldId: string): Set<string> =>
  new Set(
    chains.chains
      .filter((c) => c.world === undefined || c.world === worldId)
      .map((c) => c.id)
  );

/**
 * Could a dragon with this taste survive in this world?
 *
 * The law that replaced "never refuse the green" (Constants → DRAGON_DIET). A
 * dragon burns and it has to cool, so it needs BOTH axes; a refusal that takes
 * away its last fuel or its last green is a permanent bad condition nothing in
 * the game can fix. With one cooling chain that made every green refusal
 * illegal. With two it is simply arithmetic, which is the point of adding the
 * second — and it is checked rather than remembered.
 */
export function dietIsSurvivable(
  diet: { favourite: string; refuses: string },
  chains: ChainsData,
  worldId: string
): boolean {
  const reach = reachableIn(chains, worldId);
  const left = (axis: string[]): number =>
    axis.filter((chain) => reach.has(chain) && chain !== diet.refuses).length;
  return left(FUEL) > 0 && left(GREEN) > 0;
}

export const isMageMaterial = (chain: string): boolean => MAGE_ONLY.includes(chain);

export const isDragonFood = (chain: string, _tier: number): boolean =>
  FUEL.includes(chain) || GREEN.includes(chain);

/** Which axis of a dragon's day a good satisfies. Two axes: it burns, and it
 *  has to cool. A furnace that never cools cooks itself. */
export type DietAxis = 'fuel' | 'green' | null;
export const axisOf = (chain: string, _tier: number): DietAxis => {
  if (FUEL.includes(chain)) return 'fuel';
  if (GREEN.includes(chain)) return 'green';
  return null;
};

/** How a given dragon feels about a given chain. Three boxes, nothing else:
 *  its one favourite, its one refusal, and everything else it will eat. */
export type Taste = 'favourite' | 'accepted' | 'refused';
export const tasteOf = (c: { favourite: string; dislike: string }, chain: string): Taste =>
  chain === c.dislike ? 'refused' : chain === c.favourite ? 'favourite' : 'accepted';

/** What one serving of `chain` is worth to this dragon — the multiplier on BOTH
 *  the hunger gauge and growth. A refusal is worth nothing because it is never
 *  eaten (feed() returns before this). */
export const tasteRate = (taste: Taste): number =>
  taste === 'favourite' ? 1 : taste === 'accepted' ? ACCEPTED_RATE : 0;

/** Servings this breed needs to become an adult, at its favourite's rate. */
export const adultServingsFor = (chain: string): number =>
  ADULT_SERVINGS[DRAGON_RARITY[chain] ?? 'lesser'];

const cellKey = (col: number, row: number): string => `${col},${row}`;

/**
 * Dragons as **named companions**, and the Cold Nest that produces them.
 *
 * The naming law (merge-chains §1.2): anything on the merge board is anonymous
 * and consumable; anything with a name never touches it. A companion lives in
 * `state.companions`, never in `state.items`, so it cannot be dragged, merged or
 * sold — a dragon that bounced off a merge would teach the player it is
 * furniture.
 *
 * A dragon is **coaxed**, never merged, bought or dropped: nine goods into a
 * cold nest, at most three points a day, so the floor is three in-game days
 * across several sessions. No currency shortens it. That is what makes the first
 * dragon a real goal rather than a step.
 *
 * Trust and Growth are deliberately two axes off the same act. Trust is the
 * relationship — at most +1 a day, +1 more for a known favourite, and it never
 * decays. Growth is care over time — a day where it ate every meal is a well-fed
 * day, and five of those make it an adult.
 */
export class DragonSystem {
  /**
   * Is this board dragon asleep? Wired to `DragonLifeSystem` in Context (it is
   * built after this one, and derives sleep partly FROM this one's care record,
   * so the reference can only go this way). Defaults to "never" so a fixture
   * that builds this system alone feeds exactly as it always did.
   */
  asleep: (itemId: number) => boolean = () => false;

  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
    private chains: ChainsData
  ) {
    bus.on('ui:nest_offer_requested', ({ col, row, chain, tier }) =>
      this.offerToNest(col, row, chain, tier)
    );
    bus.on('ui:companion_named', ({ companionId, name }) => this.name(companionId, name));
    bus.on('ui:feed_companion_requested', ({ companionId, chain, tier }) =>
      this.feed(companionId, chain, tier)
    );
    bus.on('ui:feed_dragon_requested', ({ itemId, chain, tier }) =>
      this.feedBoardDragon(itemId, chain, tier)
    );
    bus.on('ui:dragon_named', ({ itemId, name }) => this.nameBoardDragon(itemId, name));
  }

  get companions(): Companion[] {
    return this.state.companions;
  }

  find(companionId: string): Companion | undefined {
    return this.state.companions.find((c) => c.id === companionId);
  }

  /** Warming progress on a nest, for the UI's Warming Ledger. */
  nestAt(col: number, row: number): { points: number; required: number; todayLeft: number } {
    const day = dayIndexAt(this.clock.now());
    const n = this.state.nests[cellKey(col, row)];
    const today = n && n.day === day ? n.pointsToday : 0;
    return {
      points: n?.points ?? 0,
      required: NEST_POINTS_REQUIRED,
      todayLeft: Math.max(0, NEST_POINTS_PER_DAY - today)
    };
  }

  private offerToNest(col: number, row: number, chain: string, tier: number): void {
    if (!isDragonFood(chain, tier)) {
      this.bus.emit('nest:offer_refused', { col, row, reason: 'not_food' });
      return;
    }
    const key = cellKey(col, row);
    const day = dayIndexAt(this.clock.now());
    const nest = (this.state.nests[key] ??= { points: 0, pointsToday: 0, day });
    if (nest.day !== day) {
      nest.day = day;
      nest.pointsToday = 0;
    }
    if (nest.pointsToday >= NEST_POINTS_PER_DAY) {
      this.bus.emit('nest:offer_refused', { col, row, reason: 'daily_cap' });
      return;
    }
    // Tier N is worth N points, but never more than the day has left — a Hearth
    // Cake on the third day is generous, not a way to skip two days.
    const room = NEST_POINTS_PER_DAY - nest.pointsToday;
    const gain = Math.min(tier, room, NEST_POINTS_REQUIRED - nest.points);
    nest.points += gain;
    nest.pointsToday += gain;
    this.bus.emit('nest:warmed', {
      col,
      row,
      points: nest.points,
      required: NEST_POINTS_REQUIRED
    });
    if (nest.points >= NEST_POINTS_REQUIRED) this.hatch(col, row);
  }

  private hatch(col: number, row: number): void {
    const key = cellKey(col, row);
    delete this.state.nests[key];
    // The nest is spent — one per region, and it goes when it gives.
    const item = this.state.itemAt(col, row);
    if (item?.chain === 'nest') this.bus.emit('board:consume_items', { itemIds: [item.id], reason: 'sold' });

    const chain = this.state.companions.length % 2 === 0 ? 'ember_dragon' : 'emerald';
    const companion: Companion = {
      id: `dragon_${this.state.nextCompanionId++}`,
      chain,
      name: '',
      trust: 0,
      // Taste is a property of the BREED, fixed at birth and HIDDEN — the Dragon
      // Book fills in by experiment, never by being told (merge-chains §2.1).
      // Two breeds eat differently, which is what makes the Book worth filling.
      favourite: DRAGON_DIET[chain]?.favourite ?? 'emberberry',
      dislike: DRAGON_DIET[chain]?.refuses ?? 'emberheart',
      discovered: [],
      meals: 0,
      mealDay: -1,
      green: 0,
      dugDay: -1,
      foragedDay: -1,
      growth: 0,
      adult: false,
      trustDay: -1,
      col,
      row
    };
    this.state.companions.push(companion);
    // Trust starts at 0: naming is the beginning of the relationship, not its
    // reward (merge-chains §4).
    this.bus.emit('nest:hatched', { companionId: companion.id, chain, col, row });
  }

  private name(companionId: string, name: string): void {
    const c = this.find(companionId);
    const clean = name.trim().slice(0, 16);
    if (!c || !clean) return;
    c.name = clean;
    this.bus.emit('companion:named', { companionId, name: clean });
  }

  private feed(companionId: string, chain: string, tier: number): void {
    const c = this.find(companionId);
    if (!c || !isDragonFood(chain, tier)) return;
    // A refusal is absolute: it turns its head away and nothing is consumed.
    if (chain === c.dislike) {
      this.bus.emit('companion:refused', { companionId, chain });
      return;
    }
    const day = dayIndexAt(this.clock.now());
    this.rollDay(c, day);
    const taste = tasteOf(c, chain);
    const rate = tasteRate(taste);
    const axis = axisOf(chain, tier);
    if (axis === 'green') c.green++;
    // Taste scales the hunger gauge: a favourite fills it at full rate, anything
    // merely accepted at ACCEPTED_RATE. Tier still sizes the serving.
    c.meals += (MEAL_VALUE[tier] ?? 0) * rate;
    const favourite = taste === 'favourite';
    this.bus.emit('companion:fed', { companionId, chain, tier, favourite });

    // Trust: at most one gain a day, plus one more for a known favourite.
    if (c.trustDay !== day && c.trust < TRUST_MAX) {
      c.trustDay = day;
      c.trust = Math.min(TRUST_MAX, c.trust + (favourite ? 2 : 1));
      this.bus.emit('companion:trust_changed', { companionId, trust: c.trust });
    }

    // Growth: SERVINGS, weighted by taste and capped by nothing but patience.
    // One favourite feed is a whole serving; an accepted one is ACCEPTED_RATE of
    // it, so a dragon raised on food it merely tolerates takes four times as
    // long. Tier does not enter — see ADULT_SERVINGS.
    if (!c.adult) {
      c.growth += rate;
      if (c.growth >= adultServingsFor(c.chain)) {
        c.adult = true;
        this.bus.emit('companion:grew', { companionId });
      }
    }

    // Discovery is what cooking properly pays out — knowledge, not nutrition.
    const entry = `${chain}:${tier}`;
    if (!c.discovered.includes(entry) && this.roll(BOOK_REVEAL_CHANCE[tier] ?? 0)) {
      c.discovered.push(entry);
      this.bus.emit('companion:discovered', { companionId, entry });
    }
  }

  /** Reset the day's intake the first time we touch a companion on a new day. */
  private rollDay(c: Companion, day: number): void {
    if (c.mealDay === day) return;
    c.mealDay = day;
    c.meals = 0;
    c.green = 0;
  }

  /**
   * What the day still owes this dragon, and what is visibly wrong with it.
   * The condition is the teaching surface: a player who has never read a word of
   * the diet rules learns them from a dragon that is dull, listless or panting.
   */
  needs(companionId: string): {
    meals: number;
    green: number;
    condition: ('listless' | 'panting')[];
  } {
    const c = this.find(companionId);
    if (!c) return { meals: 0, green: 0, condition: [] };
    const day = dayIndexAt(this.clock.now());
    const fresh = c.mealDay !== day;
    const meals = fresh ? 0 : c.meals;
    const green = fresh ? 0 : c.green;
    const condition: ('listless' | 'panting')[] = [];
    if (meals < MEALS_PER_DAY) condition.push('listless'); // cold, won't fly
    if (green < DAILY_GREEN) condition.push('panting'); // a furnace that never cools
    return {
      meals: Math.max(0, MEALS_PER_DAY - meals),
      green: Math.max(0, DAILY_GREEN - green),
      condition
    };
  }

  /**
   * Tapping a trusted dragon. Trust 2 digs its own grit — exactly the one pebble
   * a day it eats, which is why more dragons never starve Eleanor and never
   * enrich her (merge-chains §1.6). Trust 4 also fetches you a favourite.
   * Both are once a day, and both are gifts rather than systems.
   */
  tap(companionId: string): void {
    const c = this.find(companionId);
    if (!c) return;
    const day = dayIndexAt(this.clock.now());
    // It digs up a Quartz Pebble — a thing it cannot use and you can. A gift,
    // not a meal: the dragon has no interest in Eleanor's chains, it just knows
    // you keep taking them away.
    if (c.trust >= TRUST_DIGS && c.dugDay !== day) {
      c.dugDay = day;
      this.give(c, 'quartz', 1, 'dug');
    }
    if (c.trust >= TRUST_FORAGES && c.foragedDay !== day) {
      c.foragedDay = day;
      const tier = this.roll(LUCKY_TIER2_CHANCE) ? 2 : 1;
      this.give(c, c.favourite, tier, 'foraged');
    }
  }

  private give(c: Companion, chain: string, tier: number, kind: 'dug' | 'foraged'): void {
    this.bus.emit('board:spawn', { chain, tier, count: 1 });
    this.bus.emit('companion:gave', { companionId: c.id, chain, tier, kind });
  }

  /** Deterministic in tests: `state.rollOverride` pins the roll when set. */
  private roll(chance: number): boolean {
    const forced = this.state.rollOverride;
    return (forced ?? Math.random()) < chance;
  }

  /** Every chain a dragon will eat — used by the feed UI and the nest panel. */
  edibleChains(): string[] {
    return this.chains.chains.map((c) => c.id).filter((id) => isDragonFood(id, 1));
  }

  // ------------------------------------------------------- dragons on the BOARD

  /**
   * Is this board item a dragon somebody could feed?
   *
   * A breed with a taste, at a tier that is actually a dragon: `hatchAtTier` and
   * up. The chain's lower tiers (a Ruby, an Egg) share its id but are not an
   * animal, and a player who could feed an egg would reasonably expect it to
   * hatch sooner for it.
   */
  isBoardDragon(item: BoardItemState): boolean {
    if (item.kind !== 'item' || !DRAGON_DIET[item.chain]) return false;
    const hatchAt = this.chains.chains.find((c) => c.id === item.chain)?.hatchAtTier;
    return hatchAt !== undefined && item.tier >= hatchAt;
  }

  /**
   * Name a dragon that stands on the board. Once, and only a real dragon.
   *
   * Write-once like the House's commission, and for a warmer version of the
   * same reason: a name the player can edit is a label, and the beat this is
   * built for only lands if the choice is a choice.
   */
  private nameBoardDragon(itemId: number, name: string): void {
    const item = this.state.items.get(itemId);
    if (!item || !this.isBoardDragon(item) || item.dragonName) return;
    const clean = name.trim().slice(0, 16);
    if (!clean) return;
    item.dragonName = clean;
    this.bus.emit('dragon:named', { itemId, name: clean, chain: item.chain });
  }

  /** What this board dragon is called, if anything. */
  nameOf(itemId: number): string | undefined {
    return this.state.items.get(itemId)?.dragonName;
  }

  /** The first named dragon on the board — what a dialogue token resolves to
   *  when a line says "{dragon}" without naming which one. Chapter One has
   *  exactly one named dragon, so this is unambiguous where it is used. */
  firstNamed(): { itemId: number; name: string } | undefined {
    for (const item of this.state.items.values()) {
      if (item.dragonName) return { itemId: item.id, name: item.dragonName };
    }
    return undefined;
  }

  /** This dragon's care record, rolled over to the current CYCLE (`care.day`
   *  holds the cycle stamp — see DragonCare). Read-only: it returns a fresh
   *  record for an item that has never been fed rather than writing one, so
   *  merely LOOKING at a dragon never dirties the save. The rollover is what
   *  "after a cycle the hunger comes back to 0" IS — no reset job, the stale
   *  stamp simply stops matching. */
  careOf(itemId: number): DragonCare {
    const item = this.state.items.get(itemId);
    const care = item?.care;
    const cycle = cycleIndexAt(this.clock.now());
    if (!care) return { day: cycle, meals: 0, green: 0, trust: 0, trustDay: -1 };
    if (care.day === cycle) return care;
    return { ...care, day: cycle, meals: 0, green: 0 };
  }

  /** Lifetime count of this dragon's WELL-FED cycles — the Codex's number.
   *  Searches every materialised board: the Codex is readable from the hubs,
   *  where the dragon's own board is not the one underfoot. */
  wellFedCyclesOf(itemId: number): number {
    return this.findAnywhere(itemId)?.care?.wellFedCycles ?? 0;
  }

  /**
   * What the player KNOWS about this dragon's tastes — the Codex's two rows.
   * The chains come from the breed's diet; the `known` flags come from the
   * care record, written the first time each taste was actually experienced.
   */
  tasteKnowledge(itemId: number): {
    favourite: { chain: string; known: boolean };
    dislike: { chain: string; known: boolean };
  } {
    const item = this.findAnywhere(itemId);
    const diet = (item && DRAGON_DIET[item.chain]) ?? { favourite: '', refuses: '' };
    return {
      favourite: { chain: diet.favourite, known: !!item?.care?.favouriteKnown },
      dislike: { chain: diet.refuses, known: !!item?.care?.dislikeKnown }
    };
  }

  /** Every NAMED dragon across all materialised boards, home world first — the
   *  Codex roster. Chapter One holds exactly one, but the shape is a list. */
  namedDragons(): Array<{ itemId: number; name: string; chain: string; tier: number }> {
    const found: Array<{ itemId: number; name: string; chain: string; tier: number }> = [];
    for (const worldId of this.state.worlds.keys()) {
      for (const item of this.state.itemsIn(worldId)?.values() ?? []) {
        if (item.dragonName) {
          found.push({ itemId: item.id, name: item.dragonName, chain: item.chain, tier: item.tier });
        }
      }
    }
    return found;
  }

  private findAnywhere(itemId: number): BoardItemState | undefined {
    for (const worldId of this.state.worlds.keys()) {
      const item = this.state.itemsIn(worldId)?.get(itemId);
      if (item) return item;
    }
    return undefined;
  }

  /** What today still owes this board dragon — the numbers the status readout
   *  draws. Same two axes as a companion's: it burns, and it has to cool. */
  boardNeeds(itemId: number): {
    meals: number;
    green: number;
    trust: number;
    condition: ('listless' | 'panting')[];
  } {
    const care = this.careOf(itemId);
    const condition: ('listless' | 'panting')[] = [];
    if (care.meals < MEALS_PER_DAY) condition.push('listless');
    if (care.green < DAILY_GREEN) condition.push('panting');
    return {
      meals: Math.max(0, MEALS_PER_DAY - care.meals),
      green: Math.max(0, DAILY_GREEN - care.green),
      trust: care.trust,
      condition
    };
  }

  /**
   * Feed the dragon standing on the board.
   *
   * The same model as a companion's meal — taste scales the serving, trust rises
   * at most once a day and never decays — minus GROWTH, which is deliberate: a
   * board dragon grows by MERGING, and a second ladder to tier 4 would make one
   * of the two a lie. What feeding buys here is trust and a dragon that is not
   * listless, which is exactly what the status readout shows.
   *
   * Nothing is consumed on a refusal: `feed` returns false and the board leaves
   * the piece where the player dropped it.
   */
  private feedBoardDragon(itemId: number, chain: string, tier: number): void {
    const item = this.state.items.get(itemId);
    if (!item || !this.isBoardDragon(item)) return;
    // ASLEEP: a curled animal does not eat, from any direction. The board's own
    // gestures already say so where the player made them (the drag home, the
    // give handed back), but the rule lives here so a panel that learns to feed
    // tomorrow cannot feed a sleeper by forgetting to ask.
    if (this.asleep(itemId)) {
      this.bus.emit('dragon:refused', { itemId, chain, reason: 'asleep' });
      return;
    }
    if (!isDragonFood(chain, tier)) {
      this.bus.emit('dragon:refused', { itemId, chain, reason: 'not_food' });
      return;
    }
    const diet = DRAGON_DIET[item.chain]!;
    if (chain === diet.refuses) {
      // The head turns away — and the Codex learns from it. The refusal is
      // still absolute (nothing consumed), but "he will not eat that" is now
      // a thing the player KNOWS, so the book writes it down.
      if (!item.care?.dislikeKnown) {
        item.care = { ...this.careOf(itemId), dislikeKnown: true };
      }
      this.bus.emit('dragon:refused', { itemId, chain, reason: 'dislike' });
      return;
    }

    // Roll the cycle over on the item itself — `careOf` only reports the
    // rollover, it never writes, so this is the one place a new cycle is
    // committed.
    const care = { ...this.careOf(itemId) };
    const taste = tasteOf({ favourite: diet.favourite, dislike: diet.refuses }, chain);
    const rate = tasteRate(taste);
    if (axisOf(chain, tier) === 'green') care.green++;
    care.meals += (MEAL_VALUE[tier] ?? 0) * rate;
    // A meal he LOVED tells the player what his favourite is — the Codex's
    // taste rows fill in by experiment, never by being told.
    if (taste === 'favourite') care.favouriteKnown = true;

    // A FULL gauge inside one cycle is a WELL-FED cycle, credited once — the
    // Codex's lifetime count, and what the evolution condition is priced in.
    // Latched on the cycle stamp, so topping the gauge up twice in one window
    // cannot double-credit, and the credit lands the moment the bar fills
    // rather than at some rollover bookkeeping later.
    let wellFed = false;
    const cycle = cycleIndexAt(this.clock.now());
    if (care.meals >= MEALS_PER_DAY && care.wellFedCycle !== cycle) {
      care.wellFedCycle = cycle;
      care.wellFedCycles = (care.wellFedCycles ?? 0) + 1;
      wellFed = true;
    }

    const day = dayIndexAt(this.clock.now());
    let trustMoved = false;
    if (care.trustDay !== day && care.trust < TRUST_MAX) {
      care.trustDay = day;
      care.trust = Math.min(TRUST_MAX, care.trust + (taste === 'favourite' ? 2 : 1));
      trustMoved = true;
    }
    item.care = care;

    this.bus.emit('dragon:fed', {
      itemId,
      chain,
      tier,
      favourite: taste === 'favourite',
      meals: care.meals,
      needs: MEALS_PER_DAY
    });
    if (wellFed) {
      this.bus.emit('dragon:well_fed', {
        itemId,
        chain: item.chain,
        cycles: care.wellFedCycles ?? 0,
        needed: WELL_FED_EVOLUTION[item.chain] ?? 0
      });
    }
    if (trustMoved) this.bus.emit('dragon:trust_changed', { itemId, trust: care.trust });
  }
}
