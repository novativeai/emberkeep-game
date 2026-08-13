import {
  chainHiddenIn,
  chestGiftsIn,
  chestWildcardChains,
  LEGENDARY_EGG_COUNT,
  LEGENDARY_EGG_GAP_MAX,
  LEGENDARY_EGG_GAP_MIN,
  legendaryChainIn,
  GOLDEN_ALTAR,
  GOLDEN_CHAIN,
  GOLDEN_ELDER_TIER,
  LEVEL_XP,
  levelForXp,
  WORLD_ID
} from './Constants';
import type {
  ChainConfig,
  ChainsData,
  MapData,
  OrderConfig,
  OrderRequirement,
  OrdersData,
  QuestConfig,
  QuestStepConfig,
  QuestsData,
  TaskConfig,
  TasksData,
  TutorialData,
  TutorialStepConfig
} from './types';
import type { WorldSpec } from './world';

/**
 * OFFLINE PROOF THAT THE LADDER IS PLAYABLE.
 *
 * Every quest asks the player for merge pieces. This module answers, without
 * launching the game, the only question that matters about that ask:
 *
 *   > At the exact point the game asks for it, can the player actually get it,
 *   > and how?
 *
 * It does that in two halves:
 *
 *  1. **The tutorial is simulated, beat by beat.** Effects are applied on the
 *     advance INTO a step (exactly as TutorialDirector does), then the step's
 *     gate is satisfied by the cheapest legal player action — merge, harvest,
 *     sell, pocket, unlock, deliver. Anything the script asks for that the
 *     board cannot supply is a hard finding, and the resulting XP/level/region
 *     state is the true starting world for the quest ladder.
 *
 *  2. **From there every piece is classified** by a fixpoint over the supply
 *     graph: what the map seeds, what a region reveals when its fog lifts, what
 *     the tutorial spawns, what a generator produces forever, what a merge can
 *     make out of those, what the chest recharges, and the two scripted altar
 *     fixtures. Each piece comes out as one of:
 *
 *       • RENEWABLE — a live generator (or a chain of merges over one) feeds it,
 *         so any quantity is only a question of time.
 *       • FINITE(n) — no generator behind it; exactly n can EVER exist, computed
 *         through the real merge arithmetic (per-tier overrides, 5→2 bonus).
 *       • UNREACHABLE — nothing supplies it at this point, with the reason.
 *
 * FINITE is the dangerous class and the reason this file exists: five Cracked
 * Stones look like a chain, but 5 → 2 → (needs 3) means Cinder Vein tier 3 can
 * never be built, so nothing may ever ask for it. Nothing here reads the DOM,
 * Phaser, or a save — it is pure data, so the unit suite runs it on every build.
 */

export type SourceKind =
  | 'start'
  | 'region'
  | 'tutorial'
  | 'generator'
  | 'merge'
  | 'order'
  | 'chest'
  | 'altar';

export interface ItemSource {
  kind: SourceKind;
  /** Human-readable provenance, e.g. `region level_2 (Keeper Level 2)`. */
  detail: string;
  /** Unbounded supply — a generator, or a merge fed by one. */
  renewable: boolean;
  /** How many this source contributes when it is NOT renewable. */
  count?: number;
}

export interface ItemAvailability {
  chain: string;
  tier: number;
  name: string;
  reachable: boolean;
  renewable: boolean;
  /** Upper bound on how many can ever exist. `Infinity` when renewable. */
  maxEver: number;
  sources: ItemSource[];
  /** Why it can never be had, when it cannot. */
  blockedBy?: string;
}

export type AvailabilityMap = Map<string, ItemAvailability>;

export const pieceKey = (chain: string, tier: number): string => `${chain}:${tier}`;

/** The whole world as the audit models it at one point in time. */
export interface WorldModel {
  /** Region ids whose fog is lifted. */
  regions: Set<string>;
  /** Delivered order ids. */
  orders: Set<string>;
  keys: number;
  xp: number;
  level: number;
  /** Pieces on the board right now, `chain:tier` → count. */
  board: Map<string, number>;
  /** Pieces pocketed in the Bag (off-board but still owned). */
  bag: Map<string, number>;
  /** Every piece that has EVER entered the board from a one-off source. */
  supplied: Map<string, number>;
  /** Provenance for those one-off arrivals. */
  origins: Map<string, ItemSource[]>;
}

export interface AuditData {
  /** Which world this audit is FOR. Every verdict below is relative to it: a
   *  chain that belongs to another world is unreachable here by definition, and
   *  the ladder is filtered to the quests tracked here. */
  worldId: string;
  chains: ChainsData;
  map: MapData;
  orders: OrdersData;
  tasks: TasksData;
  tutorial: TutorialData;
  quests: QuestsData;
}

export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  severity: Severity;
  /** Where on the timeline, e.g. `tutorial:gem_harvest` or `quest:hoard_radiant`. */
  at: string;
  message: string;
}

/* ------------------------------------------------------------------ */
/* Chain arithmetic                                                     */
/* ------------------------------------------------------------------ */

const chainById = (chains: ChainsData, id: string): ChainConfig | undefined =>
  chains.chains.find((c) => c.id === id);

const tierConfig = (chains: ChainsData, chain: string, tier: number) =>
  chainById(chains, chain)?.tiers.find((t) => t.tier === tier);

/** The recipe that applies when merging pieces OF `tier` — per-tier override
 *  first, then the chain-level one, then the global rule. Mirrors
 *  MergeSystem.mergeOverrideFor / performMerge exactly. */
export function recipeFor(
  chains: ChainsData,
  chain: string,
  tier: number
): { group: number; outputs: number; fiveBonus: boolean } {
  const config = chainById(chains, chain);
  const override = config?.tiers.find((t) => t.tier === tier)?.merge ?? config?.merge;
  if (override) return { group: override.group, outputs: override.outputs, fiveBonus: false };
  const rule = chains.mergeRule;
  return { group: rule.minGroup, outputs: 1, fiveBonus: rule.fiveBonus };
}

/**
 * The most tier-(n+1) pieces obtainable from `count` tier-n pieces.
 *
 * With the 5-for-2 bonus, spending fives first is optimal (5→2 beats 3→1 plus
 * two idle pieces, and never loses against splitting into threes), so the yield
 * is `2·⌊k/5⌋ + ⌊(k mod 5)/3⌋`. An override disables the bonus, exactly as
 * MergeSystem does, and pays `outputs` per `group` consumed.
 */
export function mergeYield(chains: ChainsData, chain: string, tier: number, count: number): number {
  if (!tierConfig(chains, chain, tier + 1)) return 0; // top of the chain
  const { group, outputs, fiveBonus } = recipeFor(chains, chain, tier);
  const rule = chains.mergeRule;
  if (fiveBonus && group === rule.minGroup) {
    return (
      rule.fiveOutputs * Math.floor(count / rule.fiveGroup) +
      Math.floor((count % rule.fiveGroup) / group)
    );
  }
  return Math.floor(count / group) * outputs;
}

/* ------------------------------------------------------------------ */
/* The supply solver                                                    */
/* ------------------------------------------------------------------ */

/** A region's gate, phrased for a report. */
function regionGate(map: MapData, regionId: string): string {
  const region = map.regions.find((r) => r.id === regionId);
  if (!region?.unlock) return 'open from the start';
  const parts: string[] = [];
  if (region.unlock.keys !== undefined) parts.push(`${region.unlock.keys} Gold Key`);
  if (region.unlock.level !== undefined) parts.push(`Keeper Level ${region.unlock.level}`);
  return parts.join(' + ') || 'open from the start';
}

/** True when a level is ever attainable — LEVEL_XP ends at 3, so any region
 *  gated above that cap could never open. Nothing is gated above it any more:
 *  `level_5`'s demo-era `level: 99` came off when the chapter left demo mode. */
export const levelAttainable = (level: number): boolean => level <= LEVEL_XP.length;

/**
 * Classify every piece in the game at one point in the world.
 *
 * Fixpoint, because supply feeds supply: the Ancient Tree makes Bushes, three
 * Bushes make a House, and a House is itself a generator that makes Gold. Each
 * pass propagates renewability and finite counts until nothing changes.
 */
export function solveAvailability(world: WorldModel, data: AuditData): AvailabilityMap {
  const { chains } = data;
  const out: AvailabilityMap = new Map();

  for (const chain of chains.chains) {
    for (const tier of chain.tiers) {
      out.set(pieceKey(chain.id, tier.tier), {
        chain: chain.id,
        tier: tier.tier,
        name: tier.name,
        reachable: false,
        renewable: false,
        maxEver: 0,
        sources: [],
        blockedBy: chainHiddenIn(chain, data.worldId)
          ? chain.world !== undefined && chain.world !== data.worldId
            ? `${chain.id} belongs to world '${chain.world}', not '${data.worldId}'`
            : `${chain.id} is in HIDDEN_CHAINS — a later chapter's chain, it never spawns yet`
          : undefined
      });
    }
  }

  const add = (key: string, count: number, source: ItemSource): void => {
    const entry = out.get(key);
    if (!entry) return;
    const config = chains.chains.find((c) => c.id === entry.chain);
    if (config && chainHiddenIn(config, data.worldId)) return;
    entry.reachable = true;
    entry.blockedBy = undefined;
    if (source.renewable) entry.renewable = true;
    entry.maxEver = source.renewable ? Infinity : entry.maxEver + count;
    if (!entry.sources.some((s) => s.kind === source.kind && s.detail === source.detail)) {
      entry.sources.push(source);
    }
  };

  // ---- one-off arrivals already banked by the timeline (map seed, tutorial
  //      spawns, region reveals, order reward spawns) -----------------------
  for (const [key, count] of world.supplied) {
    for (const source of world.origins.get(key) ?? []) {
      add(key, source.count ?? count, source);
    }
  }

  // ---- the treasure chest: a PERMANENT fixture that readies a fresh gift on a
  //      timer. The table is all-wildcard now (plus Gold), so in practice no
  //      fixed `item` gifts remain to credit — the loop stays for any future
  //      authored gift, and the wildcard is skipped below on purpose.
  if ((world.board.get(pieceKey('chest', 1)) ?? 0) > 0) {
    for (const gift of chestGiftsIn(data.worldId)) {
      // `anyItem` is skipped ON PURPOSE. It rolls one chain out of the whole
      // world roster, so no particular piece is promised by it — crediting every
      // eligible chain here would let a subquest look satisfiable off a drop the
      // player might never see. A wildcard is flavour; the audit only counts
      // sources a player can rely on.
      if (gift.kind !== 'item') continue;
      add(pieceKey(gift.chain, gift.tier), gift.count, {
        kind: 'chest',
        detail: `Treasure Chest gift (${gift.label}, every CHEST_INTERVAL_MS)`,
        renewable: true
      });
    }
  }

  // ---- the Golden Altar: scenery, not a board item. The egg materialises when
  //      Order 1 is delivered and awakens into the Elder when the awakening
  //      QUEST completes (BoardScene.syncGoldenAltar). Nothing merges it into
  //      being. The quest cannot complete without its own order being
  //      delivered, which is the part this model can see, so that delivery is
  //      the audit's proxy for the awakening. -----------------------------
  if (world.orders.has(GOLDEN_ALTAR.orderId)) {
    add(pieceKey(GOLDEN_CHAIN, 1), 1, {
      kind: 'altar',
      detail: `the Golden Altar — appears when '${GOLDEN_ALTAR.orderId}' is delivered`,
      renewable: false,
      count: 1
    });
    const awakenQuest = data.quests.quests.find((q) => q.id === GOLDEN_ALTAR.awakenQuestId);
    if (awakenQuest?.orderId && world.orders.has(awakenQuest.orderId)) {
      add(pieceKey(GOLDEN_CHAIN, GOLDEN_ELDER_TIER), 1, {
        kind: 'altar',
        detail: `the awakening — completing '${GOLDEN_ALTAR.awakenQuestId}'`,
        renewable: false,
        count: 1
      });
    }
  }

  // ---- fixpoint over generators and merges ------------------------------
  const signature = (): string =>
    [...out.values()].map((a) => `${a.maxEver}:${a.renewable}`).join('|');
  for (let pass = 0; pass < 32; pass++) {
    const before = signature();

    for (const chain of chains.chains) {
      for (const tier of chain.tiers) {
        const source = out.get(pieceKey(chain.id, tier.tier))!;

        // A generator is never consumed by producing, so ONE reachable instance
        // is an unbounded supply of its produce — the only question is time.
        const generator = tier.generator;
        if (source.reachable && generator?.produces) {
          add(pieceKey(generator.produces.chain, generator.produces.tier), Infinity, {
            kind: 'generator',
            detail: `${tier.name} produces it every ${Math.round(generator.cooldownMs / 1000)}s`,
            renewable: true
          });
          // The rare SECOND yield is renewable on the same argument — it just
          // takes `every` times as long, and slow is not the same as capped.
          if (generator.bonus) {
            const { every, produces } = generator.bonus;
            add(pieceKey(produces.chain, produces.tier), Infinity, {
              kind: 'generator',
              detail: `${tier.name} also drops it every ${every} yields`,
              renewable: true
            });
          }
        }

        // Merging up.
        const next = chain.tiers.find((t) => t.tier === tier.tier + 1);
        if (!next || !source.reachable) continue;
        const { group, outputs } = recipeFor(chains, chain.id, tier.tier);
        if (source.renewable) {
          add(pieceKey(chain.id, next.tier), Infinity, {
            kind: 'merge',
            detail: `${group} × ${tier.name} → ${outputs} × ${next.name}`,
            renewable: true
          });
        } else {
          const yielded = mergeYield(chains, chain.id, tier.tier, source.maxEver);
          const target = out.get(pieceKey(chain.id, next.tier))!;
          const fromOther = target.sources
            .filter((s) => s.kind !== 'merge')
            .reduce((a, s) => a + (s.count ?? 0), 0);
          if (yielded > 0 && fromOther + yielded > target.maxEver) {
            target.reachable = true;
            target.blockedBy = undefined;
            target.maxEver = fromOther + yielded;
            const detail = `${group} × ${tier.name} → ${outputs} × ${next.name}`;
            const existing = target.sources.find((s) => s.kind === 'merge' && s.detail === detail);
            if (existing) existing.count = yielded;
            else target.sources.push({ kind: 'merge', detail, renewable: false, count: yielded });
          }
        }
      }
    }

    if (before === signature()) break;
  }

  // ---- explain the dead ends -------------------------------------------
  for (const entry of out.values()) {
    if (entry.reachable || entry.blockedBy) continue;
    entry.blockedBy = explainDeadEnd(entry, world, data, out);
  }
  return out;
}

/** Why a piece cannot be had: a locked region that holds it, an unbuildable
 *  predecessor, or nothing in the game supplying it at all. */
function explainDeadEnd(
  entry: ItemAvailability,
  world: WorldModel,
  data: AuditData,
  out: AvailabilityMap
): string {
  const holder = data.map.regions.find(
    (r) =>
      !world.regions.has(r.id) &&
      (r.contents ?? []).some((c) => c.chain === entry.chain && c.tier === entry.tier)
  );
  if (holder) {
    const gate = regionGate(data.map, holder.id);
    const impossible =
      holder.unlock?.level !== undefined && !levelAttainable(holder.unlock.level);
    return `only in region '${holder.id}' (${gate})${
      impossible ? ` — unreachable: LEVEL_XP tops out at Level ${LEVEL_XP.length}` : ''
    }`;
  }
  if (entry.tier > 1) {
    const below = out.get(pieceKey(entry.chain, entry.tier - 1));
    if (below && !below.renewable) {
      const { group } = recipeFor(data.chains, entry.chain, entry.tier - 1);
      return below.reachable
        ? `needs ${group} × ${below.name}, and only ${below.maxEver} can ever exist`
        : `its tier ${entry.tier - 1} (${below.name}) is itself unreachable`;
    }
  }
  return 'nothing in the map, the tutorial, a generator, a chest or an order supplies it';
}

/* ------------------------------------------------------------------ */
/* What the recipe book is allowed to promise                           */
/* ------------------------------------------------------------------ */

const recipeCache = new WeakMap<ChainsData, Map<string, Set<string>>>();

/**
 * The recipes THIS chapter can actually discover — every tier pair whose OUTPUT
 * is reachable once the whole ladder has been walked. Keys match the Cookbook's
 * own `chain:from>to`.
 *
 * The Cookbook is a promise with a counter on it, so a row it lists and the
 * chapter cannot supply is a permanent "· · ·" that caps `n / N` below its own
 * total — the defect merge-chains.md §2.4.1 names. HIDDEN_CHAINS answers that
 * for a whole chain. This answers it for the PARTIAL ones, which a chain-level
 * set cannot express:
 *
 *   • a chain on the board as a PROP — two Cracked Stones, one to pocket and
 *     one to sell, never three to merge;
 *   • a chain taught only as far as this chapter can take it — Dew Drops merge
 *     into a Dew Vial, and the Dew Basin that would feed a third one is a later
 *     chapter's farm.
 *
 * Derived, never listed by hand: the roster keeps moving, and a hand-kept list
 * would drift the moment a seed count changes. Memoised per chains document —
 * this is a pure function of the shipped data, not of the save.
 */
/**
 * The Cookbook rows a given availability map can print — one per adjacent tier
 * pair whose OUTPUT is reachable, which is the guarantee that makes `n / N`
 * finishable.
 *
 * Split out from `reachableRecipeKeys` so the ladder walk can ask the same
 * question PARTWAY through, against the world as it stands at one step. The
 * public version answers for the finished game and would recurse if called
 * from inside the audit.
 */
export function recipeKeysFrom(availability: AvailabilityMap, chains: ChainsData): Set<string> {
  const keys = new Set<string>();
  for (const chain of chains.chains) {
    for (const tier of chain.tiers) {
      const next = chain.tiers.find((t) => t.tier === tier.tier + 1);
      if (!next) continue;
      if (availability.get(pieceKey(chain.id, next.tier))?.reachable) {
        keys.add(`${chain.id}:${tier.tier}>${next.tier}`);
      }
    }
  }
  return keys;
}

export function reachableRecipeKeys(data: AuditData): Set<string> {
  // Keyed by world as well as by document: the same chains.json promises a
  // different book in the north, because half its roster does not exist there.
  const perWorld = recipeCache.get(data.chains) ?? new Map<string, Set<string>>();
  const cached = perWorld.get(data.worldId);
  if (cached) return cached;
  const keys = recipeKeysFrom(auditLadder(data).finalAvailability, data.chains);
  perWorld.set(data.worldId, keys);
  recipeCache.set(data.chains, perWorld);
  return keys;
}

/* ------------------------------------------------------------------ */
/* World bookkeeping                                                    */
/* ------------------------------------------------------------------ */

function bump(counter: Map<string, number>, key: string, delta: number): void {
  const next = (counter.get(key) ?? 0) + delta;
  if (next <= 0) counter.delete(key);
  else counter.set(key, next);
}

function supply(
  world: WorldModel,
  data: AuditData,
  chain: string,
  tier: number,
  count: number,
  source: ItemSource
): void {
  // UnlockSystem/BoardSystem skip these at spawn: a later chapter's chain, or
  // one belonging to a different world. Region data may legally name either.
  const config = data.chains.chains.find((c) => c.id === chain);
  if (chainHiddenIn(config ?? { id: chain }, data.worldId)) return;
  const key = pieceKey(chain, tier);
  bump(world.board, key, count);
  bump(world.supplied, key, count);
  const origins = world.origins.get(key) ?? [];
  const existing = origins.find((s) => s.kind === source.kind && s.detail === source.detail);
  if (existing) existing.count = (existing.count ?? 0) + count;
  else origins.push({ ...source, count });
  world.origins.set(key, origins);
}

/** Lift every fog the current level and key purse allow, seeding their contents.
 *  Mirrors UnlockSystem: level regions lift on their own; key regions need the
 *  tap, which the caller signals with `spendKeys`. */
function applyUnlocks(world: WorldModel, data: AuditData, spendKeys: boolean): string[] {
  const opened: string[] = [];
  for (const region of data.map.regions) {
    if (world.regions.has(region.id)) continue;
    const unlock = region.unlock;
    if (!unlock) continue;
    const keyGated = unlock.keys !== undefined;
    if (keyGated) {
      if (!spendKeys || world.keys < unlock.keys!) continue;
      if (unlock.level !== undefined && world.level < unlock.level) continue;
      world.keys -= unlock.keys!;
    } else {
      if (unlock.level === undefined || world.level < unlock.level) continue;
    }
    world.regions.add(region.id);
    opened.push(region.id);
    for (const placement of region.contents ?? []) {
      supply(world, data, placement.chain, placement.tier, 1, {
        kind: 'region',
        detail: `region '${region.id}' reveal (${regionGate(data.map, region.id)})`,
        renewable: false
      });
    }
  }
  return opened;
}

function grantXp(world: WorldModel, xp: number, data: AuditData): void {
  world.xp += xp;
  world.level = levelForXp(world.xp);
  applyUnlocks(world, data, false);
}

/** A brand-new game: the authored starting items on the open regions. */
export function newWorld(data: AuditData): WorldModel {
  const world: WorldModel = {
    regions: new Set(data.map.regions.filter((r) => r.status === 'active').map((r) => r.id)),
    orders: new Set(),
    keys: 0,
    xp: 0,
    level: 1,
    board: new Map(),
    bag: new Map(),
    supplied: new Map(),
    origins: new Map()
  };
  for (const placement of data.map.startingItems) {
    supply(world, data, placement.chain, placement.tier, 1, {
      kind: 'start',
      detail: `map.json startingItems @ ${placement.at.join(',')}`,
      renewable: false
    });
  }
  // Ground that is open from the first frame hands over its contents too. The
  // authored isle has none — its opening board is `startingItems` — but a world
  // of its own is seeded entirely this way (`region:reveal` on first arrival),
  // and counting only `startingItems` there would call a stocked island bare.
  for (const region of data.map.regions) {
    if (!world.regions.has(region.id)) continue;
    for (const placement of region.contents ?? []) {
      supply(world, data, placement.chain, placement.tier, 1, {
        kind: 'start',
        detail: `region '${region.id}' (open on arrival)`,
        renewable: false
      });
    }
  }
  return world;
}

/** Free active tiles — the merge board's real working room at this point. */
export function activeTileCount(world: WorldModel, data: AuditData): number {
  return data.map.regions
    .filter((r) => world.regions.has(r.id))
    .reduce((n, r) => n + r.tiles.length, 0);
}

export function occupiedTileCount(world: WorldModel): number {
  return [...world.board.values()].reduce((a, b) => a + b, 0);
}

/* ------------------------------------------------------------------ */
/* The tutorial simulator                                              */
/* ------------------------------------------------------------------ */

export interface TutorialBeat {
  index: number;
  stepId: string;
  /** What the modelled player had to do to satisfy the gate. */
  actions: string[];
  xp: number;
  level: number;
  findings: Finding[];
}

/** Merge one group of `chain` at the lowest tier that has enough pieces. */
function tryMerge(
  world: WorldModel,
  data: AuditData,
  chain: string
): { from: number; to: number; xp: number } | null {
  const config = chainById(data.chains, chain);
  if (!config) return null;
  for (const tier of [...config.tiers].sort((a, b) => a.tier - b.tier)) {
    const next = config.tiers.find((t) => t.tier === tier.tier + 1);
    if (!next) continue;
    const { group, outputs } = recipeFor(data.chains, chain, tier.tier);
    const key = pieceKey(chain, tier.tier);
    if ((world.board.get(key) ?? 0) < group) continue;
    bump(world.board, key, -group);
    bump(world.board, pieceKey(chain, next.tier), outputs);
    bump(world.supplied, pieceKey(chain, next.tier), outputs);
    const xp = next.xp * outputs;
    grantXp(world, xp, data);
    return { from: tier.tier, to: next.tier, xp };
  }
  return null;
}

/** The first board generator whose produce is `chain`. */
function generatorProducing(
  world: WorldModel,
  data: AuditData,
  chain: string
): { name: string; chain: string; tier: number } | null {
  for (const config of data.chains.chains) {
    for (const tier of config.tiers) {
      if (tier.generator?.produces?.chain !== chain) continue;
      if ((world.board.get(pieceKey(config.id, tier.tier)) ?? 0) <= 0) continue;
      return { name: tier.name, chain: tier.generator.produces.chain, tier: tier.generator.produces.tier };
    }
  }
  return null;
}

function deliverableOrder(world: WorldModel, data: AuditData): OrderConfig | null {
  for (const order of data.orders.orders) {
    if (world.orders.has(order.id)) continue;
    const ok = order.requires.every((r) => (world.board.get(pieceKey(r.chain, r.tier)) ?? 0) >= r.count);
    return ok ? order : null; // only the FIRST outstanding order is on the Ledger's nose
  }
  return null;
}

/**
 * Walk the whole scripted tutorial, applying effects and satisfying gates with
 * the cheapest legal action, and report every point where the script asks for
 * something the board cannot supply.
 */
export function simulateTutorial(data: AuditData): { world: WorldModel; beats: TutorialBeat[] } {
  const world = newWorld(data);
  const beats: TutorialBeat[] = [];

  data.tutorial.steps.forEach((step, index) => {
    const actions: string[] = [];
    const findings: Finding[] = [];
    const at = `tutorial:${step.id}`;

    // TutorialDirector.begin() emits step 0 WITHOUT running applyEffects — only
    // an advance INTO a step fires them. A step-0 effect would silently never
    // run, so the audit refuses to model one.
    if (index === 0 && (step.effects?.length ?? 0) > 0) {
      findings.push({
        severity: 'error',
        at,
        message:
          'the FIRST tutorial step carries effects, but TutorialDirector.begin() never applies them — they would silently never run'
      });
    } else {
      applyTutorialEffects(world, data, step, actions);
    }

    satisfyGate(world, data, step, actions, findings, at);
    beats.push({ index, stepId: step.id, actions, xp: world.xp, level: world.level, findings });
  });

  return { world, beats };
}

function applyTutorialEffects(
  world: WorldModel,
  data: AuditData,
  step: TutorialStepConfig,
  actions: string[]
): void {
  for (const effect of step.effects ?? []) {
    if ('spawn' in effect) {
      supply(world, data, effect.spawn.chain, effect.spawn.tier, effect.spawn.count, {
        kind: 'tutorial',
        detail: `tutorial step '${step.id}' spawn`,
        renewable: false
      });
      actions.push(`spawn ${effect.spawn.count} × ${effect.spawn.chain} T${effect.spawn.tier}`);
    } else if ('retier' in effect) {
      const { chain, fromTier, toTier } = effect.retier;
      bump(world.board, pieceKey(chain, fromTier), -1);
      supply(world, data, chain, toTier, 1, {
        kind: 'tutorial',
        detail: `tutorial step '${step.id}' retier`,
        renewable: false
      });
      actions.push(`retier ${chain} T${fromTier} → T${toTier}`);
    } else if ('grantKeys' in effect) {
      world.keys += effect.grantKeys;
      actions.push(`+${effect.grantKeys} Gold Key`);
    } else if ('grantXp' in effect) {
      grantXp(world, effect.grantXp, data);
      actions.push(`+${effect.grantXp} XP`);
    }
    // advanceClock / setEnergy / move / setTimer change no supply.
  }
}

function satisfyGate(
  world: WorldModel,
  data: AuditData,
  step: TutorialStepConfig,
  actions: string[],
  findings: Finding[],
  at: string
): void {
  const gate = step.gate;
  if (gate.type === 'tap') return;

  if (gate.type === 'count') {
    const held = world.board.get(pieceKey(gate.chain, gate.tier)) ?? 0;
    if (held < gate.count) {
      findings.push({
        severity: 'error',
        at,
        message: `count gate wants ${gate.count} × ${gate.chain} T${gate.tier}, board holds ${held} — the tutorial deadlocks here`
      });
    }
    return;
  }

  switch (gate.event) {
    case 'item:merged': {
      const merged = gate.chain ? tryMerge(world, data, gate.chain) : null;
      if (!merged) {
        findings.push({
          severity: 'error',
          at,
          message: `gate wants a '${gate.chain}' merge, but no tier of it has a full group on the board`
        });
      } else {
        actions.push(`merge ${gate.chain} T${merged.from} → T${merged.to} (+${merged.xp} XP)`);
      }
      break;
    }
    case 'item:hatched': {
      const config = gate.chain ? chainById(data.chains, gate.chain) : undefined;
      const hatchTier = config?.hatchAtTier;
      if (!config || hatchTier === undefined) {
        findings.push({ severity: 'error', at, message: `gate wants a hatch of '${gate.chain}', which has no hatchAtTier` });
        break;
      }
      const before = world.board.get(pieceKey(config.id, hatchTier)) ?? 0;
      let guard = 0;
      while ((world.board.get(pieceKey(config.id, hatchTier)) ?? 0) <= before && guard++ < 8) {
        const merged = tryMerge(world, data, config.id);
        if (!merged) break;
        actions.push(`merge ${config.id} T${merged.from} → T${merged.to} (+${merged.xp} XP)`);
      }
      if ((world.board.get(pieceKey(config.id, hatchTier)) ?? 0) <= before) {
        findings.push({
          severity: 'error',
          at,
          message: `gate wants a '${config.id}' hatch (tier ${hatchTier}) but the board cannot merge up to it`
        });
      }
      break;
    }
    case 'item:harvested': {
      const generator = gate.chain ? generatorProducing(world, data, gate.chain) : null;
      if (!generator) {
        findings.push({
          severity: 'error',
          at,
          message: `gate wants a '${gate.chain}' harvest, but no generator producing it stands on the board`
        });
      } else {
        supply(world, data, generator.chain, generator.tier, 1, {
          kind: 'generator',
          detail: `${generator.name} (tapped during the tutorial)`,
          renewable: true
        });
        actions.push(`harvest ${generator.name} → ${generator.chain} T${generator.tier}`);
      }
      break;
    }
    case 'bag:stored': {
      const key = [...world.board.keys()].find((k) => k.startsWith(`${gate.chain}:`));
      if (!key) {
        findings.push({
          severity: 'error',
          at,
          message: `gate wants a '${gate.chain}' pocketed, but none is on the board`
        });
      } else {
        bump(world.board, key, -1);
        bump(world.bag, key, 1);
        actions.push(`pocket ${key}`);
      }
      break;
    }
    case 'item:sold': {
      // Selling happens in the BAG and nowhere else, so the only thing a player
      // can sell at this point is something an earlier beat had them pocket.
      const sellable = [...world.bag.entries()].find(([key, count]) => {
        if (count <= 0) return false;
        const [chain, tier] = key.split(':');
        const config = tierConfig(data.chains, chain!, Number(tier));
        return !!config && config.sellable !== false && config.sell > 0;
      });
      if (!sellable) {
        findings.push({
          severity: 'error',
          at,
          message:
            'gate wants a sale, but the Bag holds nothing sellable — selling is a Bag verb, so a beat before this one has to pocket something'
        });
      } else {
        bump(world.bag, sellable[0], -1);
        actions.push(`sell ${sellable[0]} (from the Bag)`);
      }
      break;
    }
    case 'region:unlocked': {
      const opened = applyUnlocks(world, data, true);
      if (opened.length === 0) {
        findings.push({
          severity: 'error',
          at,
          message: `gate wants a fog lift, but no region is unlockable (keys: ${world.keys}, level: ${world.level})`
        });
      } else {
        actions.push(`unlock ${opened.join(', ')}`);
      }
      break;
    }
    case 'order:completed': {
      const order = deliverableOrder(world, data);
      if (!order) {
        const next = data.orders.orders.find((o) => !world.orders.has(o.id));
        const shortfall = (next?.requires ?? [])
          .map((r) => `${world.board.get(pieceKey(r.chain, r.tier)) ?? 0}/${r.count} × ${r.chain} T${r.tier}`)
          .join(', ');
        findings.push({
          severity: 'error',
          at,
          message: `gate wants an order delivered, but '${next?.id ?? '—'}' is short: ${shortfall}`
        });
      } else {
        for (const r of order.requires) bump(world.board, pieceKey(r.chain, r.tier), -r.count);
        world.orders.add(order.id);
        grantXp(world, order.rewards.xp ?? 0, data);
        if (order.rewards.keys) world.keys += order.rewards.keys;
        if (order.rewards.spawn) {
          supply(world, data, order.rewards.spawn.chain, order.rewards.spawn.tier, order.rewards.spawn.count, {
            kind: 'order',
            detail: `reward of order '${order.id}'`,
            renewable: false
          });
        }
        actions.push(`deliver '${order.id}' (+${order.rewards.xp ?? 0} XP)`);
      }
      break;
    }
    default:
      // chest:open, dragon:working, generator:skipped, marketplace:purchased,
      // character:action_used, ui:* — no supply moves (a chest gift is random,
      // so the model conservatively banks nothing).
      break;
  }
}

/* ------------------------------------------------------------------ */
/* The quest ladder audit                                               */
/* ------------------------------------------------------------------ */

/**
 * The merge pieces a step consumes: whatever its goal names, plus whatever the
 * author declared on top. QuestSystem calls this too, so the runtime and the
 * audit can never disagree about what a step actually asks for.
 */
export function questStepNeeds(
  step: QuestStepConfig,
  scripted: readonly OrderConfig[],
  encore: readonly Omit<OrderConfig, 'id'>[],
  tasks: readonly TaskConfig[]
): OrderRequirement[] {
  const goal = step.goal;
  const own: OrderRequirement[] = [];
  switch (goal.kind) {
    case 'have':
      own.push({ chain: goal.chain, tier: goal.tier, count: goal.count });
      break;
    case 'order': {
      const order = scripted.find((o) => o.id === goal.orderId);
      if (order) own.push(...order.requires);
      break;
    }
    case 'active_order':
      own.push(...encore.flatMap((o) => o.requires));
      break;
    case 'task': {
      const task = tasks.find((t) => t.id === goal.taskId);
      if (task?.kind === 'orders') own.push(...encore.flatMap((o) => o.requires));
      break;
    }
    case 'gift':
      // A gift is CONSUMED. It leaves the board the way a delivery does, so a
      // relationship subquest asking for a piece nothing supplies is exactly the
      // defect this audit exists to catch — and the one most likely to be
      // authored, since a keepsake reads like flavour rather than like a cost.
      own.push({ chain: goal.chain, tier: goal.tier, count: goal.count });
      break;
    default:
      break;
  }
  return [...own, ...(step.needs ?? [])];
}

export interface StepAudit {
  questId: string;
  questTitle: string;
  stepId: string;
  label: string;
  /** Every piece the step needs, with its verdict at THIS point on the ladder. */
  needs: Array<{
    requirement: OrderRequirement;
    availability: ItemAvailability;
    verdict: 'renewable' | 'finite-ok' | 'finite-short' | 'unreachable';
  }>;
  findings: Finding[];
  level: number;
  regions: string[];
}

export interface LadderAudit {
  beats: TutorialBeat[];
  steps: StepAudit[];
  findings: Finding[];
  /** Every piece in the game, classified at the END of the ladder. */
  finalAvailability: AvailabilityMap;
}

/** The world the scripted tutorial is written for. Every other world is entered
 *  by a player who has already been taught. */
export const TUTORIAL_WORLD = WORLD_ID;

/** The quests tracked in the world under audit. A quest with no `world` belongs
 *  to the authored one — the same default `QuestSystem` applies at runtime. */
export function questsIn(data: AuditData): QuestConfig[] {
  return data.quests.quests.filter((q) => (q.world ?? TUTORIAL_WORLD) === data.worldId);
}

/**
 * THE LEGENDARY EGG DIRECTIVE, checked (see `Constants.LEGENDARY_EGG_COUNT`).
 *
 * A zone gives up exactly one legendary dragon and the ladder is the only thing
 * that can hand it over, so the ladder's SHAPE is the mechanic — which means it
 * has to be verified like one. Everything here is a hard error rather than a
 * warning: a mis-spaced arc is not a tuning opinion, it is a zone where the
 * dragon either arrives all at once or cannot be assembled at all.
 *
 * A world with no legendary chain is silent. That is not a loophole — rule 1
 * says at most one, never at least one — and it is how roothold stays quiet
 * until somebody authors its ladder.
 */
export function auditLegendaryArc(data: AuditData): Finding[] {
  const findings: Finding[] = [];
  const at = `world:${data.worldId}`;
  const legendary = legendaryChainIn(data.chains.chains, data.worldId);
  const marked = data.chains.chains.filter((c) => c.legendary && !chainHiddenIn(c, data.worldId));
  if (marked.length > 1) {
    findings.push({
      severity: 'error',
      at,
      message: `${marked.length} chains are marked legendary here (${marked.map((c) => c.id).join(', ')}) — a zone gives up exactly one dragon`
    });
  }
  if (!legendary) return findings;

  // Rule 2 — nothing but a quest may make an egg.
  //
  // Checked STRUCTURALLY, over every table that can put a piece on a board,
  // rather than by asking the solver whether one turns up. A producer that
  // happens to sit behind a fog the audit never lifts would be invisible to the
  // solver and perfectly real in play, and this is the rule that keeps the
  // dragon a story object — it has to hold whether or not the run reaches it.
  const wild: string[] = [];
  const isEgg = (p?: { chain: string; tier: number }): boolean =>
    p?.chain === legendary.id && p.tier === 1;
  for (const chain of data.chains.chains) {
    for (const tier of chain.tiers) {
      if (isEgg(tier.generator?.produces) || isEgg(tier.generator?.bonus?.produces)) {
        wild.push(`${chain.id} T${tier.tier} generates it`);
      }
    }
  }
  for (const placement of data.map.startingItems) {
    if (isEgg(placement)) wild.push('map startingItems');
  }
  for (const region of data.map.regions) {
    for (const placement of region.contents ?? []) {
      if (isEgg(placement)) wild.push(`region '${region.id}' seeds it`);
    }
  }
  for (const gift of chestGiftsIn(data.worldId)) {
    if (gift.kind === 'item' && isEgg(gift)) wild.push('a chest pays it');
    // …and the wildcard is checked as a ROSTER, not as a written line: it names
    // no chain, so the only way it could pay an egg is by the eligibility filter
    // letting a legendary through. Assert that here rather than trusting the
    // filter, because this is the rule the Directive exists to protect.
    if (gift.kind === 'anyItem') {
      const rolls = chestWildcardChains(data.chains.chains, data.worldId);
      if (rolls.some((c) => c.id === legendary.id)) wild.push("a chest's wildcard can roll it");
    }
  }
  for (const order of [...data.orders.orders, ...(data.orders.repeatable ?? [])]) {
    if (isEgg(order.rewards.spawn)) wild.push(`order '${order.title}' pays it`);
  }
  // The tutorial's effects are a loose shape; it may not mention the chain AT ALL.
  if (JSON.stringify(data.tutorial).includes(`"${legendary.id}"`)) {
    wild.push('the tutorial references it');
  }
  if (wild.length) {
    findings.push({
      severity: 'error',
      at,
      message: `${legendary.name} eggs are supplied by something other than a quest reward (${wild.join('; ')}) — the dragon is a story object, not a grind`
    });
  }

  // Rules 3–5 — how many, how spaced, and where the arc ends.
  //
  // Measured over the ARC-GIVER's own ladder, not the whole world's: a world
  // can host a second quest-giver whose track runs past the finale (the woken
  // Golden Elder's twelve), and rule 5's "the zone ends on the hatch" is about
  // the ladder that TELLS the dragon's story — appending another giver's
  // post-game track must not read as the arc trailing off. One giver per arc is
  // asserted first, because eggs split across two tracks would let the spacing
  // rules pass on each half while the player experiences the interleaving.
  const worldLadder = questsIn(data);
  const paysEgg = (q: QuestConfig): number =>
    q.rewards?.spawn?.chain === legendary.id ? q.rewards.spawn.count : 0;
  const eggGivers = [...new Set(worldLadder.filter((q) => paysEgg(q) > 0).map((q) => q.giver))];
  if (eggGivers.length > 1) {
    findings.push({
      severity: 'error',
      at,
      message: `${legendary.name} eggs are paid by ${eggGivers.length} different givers (${eggGivers.join(', ')}) — one ladder tells a dragon's story`
    });
    return findings;
  }
  const ladder = eggGivers.length ? worldLadder.filter((q) => q.giver === eggGivers[0]) : worldLadder;
  const completable = ladder.filter((q) => q.steps.some((step) => step.goal.kind !== 'active_order'));
  const eggAt = completable
    .map((q, i) => ({ q, i, n: paysEgg(q) }))
    .filter((e) => e.n > 0);
  const total = eggAt.reduce((a, e) => a + e.n, 0);

  const tailPays = ladder.filter((q) => !completable.includes(q) && paysEgg(q) > 0);
  for (const q of tailPays) {
    findings.push({
      severity: 'error',
      at: `quest:${q.id}`,
      message: `the endless tail cannot pay a legendary egg — it never completes, so the reward never lands`
    });
  }
  for (const e of eggAt) {
    if (e.n > 1) {
      findings.push({
        severity: 'error',
        at: `quest:${e.q.id}`,
        message: `pays ${e.n} ${legendary.name} eggs at once — one quest, one egg, or the arc collapses into a single beat`
      });
    }
  }
  if (total !== LEGENDARY_EGG_COUNT) {
    findings.push({
      severity: 'error',
      at,
      message: `the ladder pays ${total} ${legendary.name} egg(s); ${LEGENDARY_EGG_COUNT} are needed to merge the dragon, so it can ${total < LEGENDARY_EGG_COUNT ? 'never be assembled' : 'be assembled with pieces to spare'}`
    });
    return findings;
  }

  const need = 1 + (LEGENDARY_EGG_COUNT - 1) * (LEGENDARY_EGG_GAP_MIN + 1) + 1;
  if (completable.length < need) {
    findings.push({
      severity: 'error',
      at,
      message: `${completable.length} completable quests cannot hold a legendary arc — it needs ${need} (${LEGENDARY_EGG_COUNT} eggs spaced ${LEGENDARY_EGG_GAP_MIN}+ apart, plus the hatch)`
    });
    return findings;
  }

  for (let n = 1; n < eggAt.length; n++) {
    const gap = eggAt[n]!.i - eggAt[n - 1]!.i - 1;
    if (gap < LEGENDARY_EGG_GAP_MIN || gap > LEGENDARY_EGG_GAP_MAX) {
      findings.push({
        severity: 'error',
        at: `quest:${eggAt[n]!.q.id}`,
        message: `${gap} quest(s) between this egg and the last — the directive is ${LEGENDARY_EGG_GAP_MIN}–${LEGENDARY_EGG_GAP_MAX}, so the arc is ${gap < LEGENDARY_EGG_GAP_MIN ? 'too crowded to feel like one' : 'stretched until the player forgets there is one'}`
      });
    }
  }

  // Rule 5 — the last egg is the second-to-last quest, and the last quest is
  // the hatch. The zone ends on the dragon waking, which is the whole point of
  // paying its eggs out over the zone rather than handing over a dragon.
  const last = eggAt[eggAt.length - 1]!;
  const hatch = completable[completable.length - 1];
  if (last.i !== completable.length - 2) {
    findings.push({
      severity: 'error',
      at: `quest:${last.q.id}`,
      message: `the last egg lands ${completable.length - 1 - last.i} quest(s) from the end — it belongs on the second-to-last, so the zone can close on the hatch`
    });
  }
  const hatches =
    hatch?.steps.some(
      (step) => step.goal.kind === 'have' && step.goal.chain === legendary.id && step.goal.tier === 2
    ) ?? false;
  if (!hatches) {
    findings.push({
      severity: 'error',
      at: hatch ? `quest:${hatch.id}` : at,
      message: `the zone's last quest does not hatch the ${legendary.name} — the three eggs would be paid out and never asked for`
    });
  }
  return findings;
}

/** The Ledger as it reads in one world — scripted list and encore pool both.
 *  Mirrors `OrderSystem.here`, for the same default reason as `questsIn`. */
export function ordersIn(orders: OrdersData, worldId: string): OrdersData {
  const here = (o: { world?: string }): boolean => (o.world ?? TUTORIAL_WORLD) === worldId;
  return {
    orders: orders.orders.filter(here),
    repeatable: (orders.repeatable ?? []).filter(here)
  };
}

/**
 * The `MapData` for one world in `zones.json`.
 *
 * A world that `extendsAuthoredMap` is the build's own isle plus whatever the
 * editor added, so its regions are the union. Any other world stands alone: its
 * regions, its playable cells, and — the number that matters for a world about
 * to ship — its own `startingItems`, which is `[]` until someone seeds it.
 */
export function mapForWorld(spec: WorldSpec, authored: MapData): MapData {
  if (spec.extendsAuthoredMap) {
    const extra = (spec.map.regions ?? []).filter(
      (r) => !authored.regions.some((a) => a.id === r.id)
    );
    return { ...authored, regions: [...authored.regions, ...extra] };
  }
  return {
    cols: spec.map.cols,
    rows: spec.map.rows,
    regions: spec.map.regions ?? [],
    startingItems: spec.map.startingItems ?? [],
    playable: spec.map.playable
  };
}

export interface WorldLadderAudit {
  worldId: string;
  name: string;
  /** Zone count and playable cells — how big a board it actually is. */
  cells: number;
  audit: LadderAudit;
  /** Quests tracked in this world. Zero is a finding, not a fact. */
  questCount: number;
}

/**
 * Audit EVERY world this build can run, each as its own supply graph.
 *
 * The worlds do not pool: `state.items` is the board you are standing on, so a
 * Gem Shard in Emberkeep is not a Gem Shard in the north. A world therefore has
 * to be self-sufficient in everything its own quests ask for, and this is what
 * proves it — including the flat case of a world nothing has seeded yet, whose
 * every chain comes back UNREACHABLE with "nothing supplies it".
 */
export function auditWorlds(
  base: Omit<AuditData, 'worldId' | 'map'>,
  authored: MapData,
  specs: readonly WorldSpec[]
): WorldLadderAudit[] {
  return specs.map((spec) => {
    const data: AuditData = {
      ...base,
      worldId: spec.id,
      map: mapForWorld(spec, authored)
    };
    return {
      worldId: spec.id,
      name: spec.name,
      cells: spec.zones.reduce((n, z) => n + z.cells.length, 0) || (spec.map.playable?.length ?? 0),
      audit: auditLadder(data),
      questCount: questsIn(data).length
    };
  });
}

/** Whoever keeps the Ledger in the world under audit — mirrors QuestSystem's
 *  `giverName`, so the report reads the way the HUD row will. */
function ledgerKeeper(data: AuditData): string {
  const giver = (data.orders.repeatable ?? [])[0]?.giver ?? data.orders.orders[0]?.giver;
  return giver ? giver.charAt(0).toUpperCase() + giver.slice(1) : 'the Ledger';
}

function questTitle(quest: QuestConfig, data: AuditData): string {
  if (quest.title) return quest.title;
  const first = data.orders.orders[0];
  return `The Ledger (encore) — e.g. ${first?.title ?? 'orders'}`;
}

/** The step's report line. Mirrors QuestSystem's own label resolution: authored
 *  label, else the Keeper's Task it mirrors, else a description of the goal. */
function stepLabel(step: QuestStepConfig, data: AuditData): string {
  if (step.label) return step.label;
  const goal = step.goal;
  switch (goal.kind) {
    case 'task':
      return data.tasks.tasks.find((t) => t.id === goal.taskId)?.label ?? goal.taskId;
    case 'order':
      return data.orders.orders.find((o) => o.id === goal.orderId)?.title ?? goal.orderId;
    case 'active_order':
      return `whatever ${ledgerKeeper(data)}'s Ledger is currently asking for`;
    case 'have':
      return `hold ${goal.count} × ${goal.chain} T${goal.tier}`;
    case 'stat':
      return `${goal.stat} ×${goal.count}`;
    case 'level':
      return `reach Keeper Level ${goal.level}`;
    case 'region':
      return `clear the ash over '${goal.regionId}'`;
    case 'recipe':
      return `discover ${goal.chain} T${goal.fromTier}→T${goal.toTier}`;
    case 'world':
      return `make the crossing to ${goal.worldId}`;
    case 'gift':
      return `give ${goal.characterId} ${goal.count} × ${goal.chain} T${goal.tier}`;
    case 'regard':
      return `reach ${goal.hearts} heart(s) with ${goal.characterId}`;
  }
}

/**
 * Walk the tutorial, then the quest ladder, and prove at every step that
 * everything it asks for can be got at that exact point.
 *
 * The ladder advances the world as it goes: an `order` step marks that order
 * delivered and pays its XP (which can lift a level-gated region), so a later
 * step is judged against the world its predecessors actually leave behind.
 */
export function auditLadder(input: AuditData): LadderAudit {
  // The Ledger is per world (`OrderConfig.world`), and scoping it HERE rather
  // than at the call site is what stops an audit built by hand from judging
  // Emberkeep's endless tail against Selyna's encores — which reports four
  // northern goods unreachable in the south: true, and completely beside the
  // point.
  const data: AuditData = { ...input, orders: ordersIn(input.orders, input.worldId) };
  // Only the world the tutorial is written for runs it. Every other world is
  // entered by an already-taught player, so its start state is its own map's
  // seed and nothing more — which is exactly the thing worth checking about a
  // new world: does anything at all arrive on that board?
  const teaches = data.worldId === TUTORIAL_WORLD;
  const { world, beats } = teaches
    ? simulateTutorial(data)
    : { world: newWorld(data), beats: [] as TutorialBeat[] };
  const findings: Finding[] = beats.flatMap((b) => b.findings);
  const steps: StepAudit[] = [];

  findings.push(...auditLegendaryArc(data));

  // A world with no ladder passes every check by having nothing to check — the
  // silent pass this whole file exists to refuse. Say so out loud instead.
  const ladder = questsIn(data);
  if (ladder.length === 0) {
    findings.push({
      severity: 'warning',
      at: `world:${data.worldId}`,
      message: `no quest in quests.json is tracked in '${data.worldId}' — arriving there would leave the HUD blank`
    });
  }

  // And a world nothing seeds is a board the player cannot play. This is the
  // check a world about to ship should be run against FIRST: an isle with tiles
  // but no startingItems and no region contents is scenery, not a merge board.
  if (!teaches) {
    const seeds =
      data.map.startingItems.length +
      data.map.regions.reduce((n, r) => n + (r.contents?.length ?? 0), 0);
    if (seeds === 0) {
      findings.push({
        severity: 'warning',
        at: `world:${data.worldId}`,
        message:
          `nothing arrives on this board: 0 startingItems and 0 region contents across ` +
          `${data.map.regions.length} region(s). Every chain is UNREACHABLE here until something seeds one`
      });
    }
  }

  // The tutorial's XP ledger is load-bearing: LEVEL_XP is tuned so the scripted
  // 60 XP lands Level 2 exactly on the `levelup` beat.
  const levelupBeat = beats.find((b) => b.stepId === 'levelup');
  if (levelupBeat && levelupBeat.level < 2) {
    findings.push({
      severity: 'error',
      at: 'tutorial:levelup',
      message: `the levelup beat fires at Level ${levelupBeat.level} with ${levelupBeat.xp} XP — LEVEL_XP[1] is ${LEVEL_XP[1]}, so the scripted level-up does not land on its own beat`
    });
  }

  for (const quest of questsIn(data)) {
    for (const step of quest.steps) {
      const at = `quest:${step.id}`;
      const stepFindings: Finding[] = [];
      const availability = solveAvailability(world, data);
      const needs = questStepNeeds(
        step,
        data.orders.orders,
        data.orders.repeatable ?? [],
        data.tasks.tasks
      );

      const rows: StepAudit['needs'] = [];
      for (const requirement of needs) {
        const entry =
          availability.get(pieceKey(requirement.chain, requirement.tier)) ??
          ({
            chain: requirement.chain,
            tier: requirement.tier,
            name: `${requirement.chain} T${requirement.tier}`,
            reachable: false,
            renewable: false,
            maxEver: 0,
            sources: [],
            blockedBy: 'no such chain/tier in chains.json'
          } satisfies ItemAvailability);

        let verdict: StepAudit['needs'][number]['verdict'];
        if (!entry.reachable) {
          verdict = 'unreachable';
          stepFindings.push({
            severity: 'error',
            at,
            message: `needs ${requirement.count} × ${entry.name} (${requirement.chain} T${requirement.tier}) — UNREACHABLE: ${entry.blockedBy}`
          });
        } else if (entry.renewable) {
          verdict = 'renewable';
        } else if (entry.maxEver >= requirement.count) {
          verdict = 'finite-ok';
          // A one-off SCENIC fixture (the Golden Egg, the Elder) is finite on
          // purpose and cannot be spent — it is not the finite-supply hazard.
          const fixture =
            entry.sources.every((s) => s.kind === 'altar') ||
            tierConfig(data.chains, entry.chain, entry.tier)?.sellable === false;
          stepFindings.push({
            severity: fixture ? 'info' : 'warning',
            at,
            message: fixture
              ? `needs ${requirement.count} × ${entry.name} — a one-off fixture (${entry.sources.map((s) => s.detail).join('; ')}); it cannot be sold or delivered away`
              : `needs ${requirement.count} × ${entry.name}, and only ${entry.maxEver} can EVER exist — no generator backs it, so a sold or delivered piece is gone for good`
          });
        } else {
          verdict = 'finite-short';
          stepFindings.push({
            severity: 'error',
            at,
            message: `needs ${requirement.count} × ${entry.name}, but at most ${entry.maxEver} can ever exist (${entry.sources.map((s) => s.detail).join('; ') || 'no source'})`
          });
        }
        rows.push({ requirement, availability: entry, verdict });
      }

      // A COUNTER task is not an item ask, so nothing above checks it — and a
      // target that quietly stopped being attainable is exactly how "Hatch 4
      // dragons" survived the decision to make dragons scarce. Only `recipes`
      // has a hard ceiling the data can state; the rest are unbounded by
      // construction (gold, merges and orders all come from renewable loops).
      const mirrored = step.goal;
      if (mirrored.kind === 'task') {
        const task = data.tasks.tasks.find((t) => t.id === mirrored.taskId);
        if (!task) {
          stepFindings.push({
            severity: 'error',
            at,
            message: `no task '${mirrored.taskId}' in tasks.json — the step mirrors nothing`
          });
        } else if (task.kind === 'recipes') {
          const printable = recipeKeysFrom(availability, data.chains).size;
          if (task.target > printable) {
            stepFindings.push({
              severity: 'error',
              at,
              message: `'${task.label}' wants ${task.target} recipes, but only ${printable} Cookbook rows are reachable when it is asked`
            });
          }
        }
      }

      // Board room: a step that wants N pieces held AT ONCE needs N tiles for
      // them, on top of the fixtures (generators, the chest, the Manor) that
      // can never be cleared away to make space.
      const simultaneous = needs.reduce((a, r) => a + r.count, 0);
      const tiles = activeTileCount(world, data);
      const free = tiles - occupiedTileCount(world);
      if (simultaneous > tiles) {
        stepFindings.push({
          severity: 'error',
          at,
          message: `wants ${simultaneous} pieces held at once, but only ${tiles} tiles are active — it cannot physically be assembled`
        });
      } else if (simultaneous > free) {
        stepFindings.push({
          severity: 'warning',
          at,
          message: `wants ${simultaneous} pieces held at once with ${free} tiles free — the player must sell or pocket to make room`
        });
      }

      steps.push({
        questId: quest.id,
        questTitle: questTitle(quest, data),
        stepId: step.id,
        label: stepLabel(step, data),
        needs: rows,
        findings: stepFindings,
        level: world.level,
        regions: [...world.regions]
      });
      findings.push(...stepFindings);

      // Advance the world past this step.
      if (step.goal.kind === 'order') {
        const orderId = step.goal.orderId;
        const order = data.orders.orders.find((o) => o.id === orderId);
        if (order && !world.orders.has(order.id)) {
          world.orders.add(order.id);
          grantXp(world, order.rewards.xp ?? 0, data);
          // Keys are the north's only gate currency, so a ladder that banked XP
          // and dropped keys would report every fogged island as unreachable and
          // every chain behind it with it.
          world.keys += order.rewards.keys ?? 0;
          if (order.rewards.spawn) {
            supply(world, data, order.rewards.spawn.chain, order.rewards.spawn.tier, order.rewards.spawn.count, {
              kind: 'order',
              detail: `reward of order '${order.id}'`,
              renewable: false
            });
          }
        }
      }
      if (step.goal.kind === 'level') grantXp(world, Math.max(0, (LEVEL_XP[step.goal.level - 1] ?? 0) - world.xp), data);
      // A `region` step IS the fog lift. Walking past it without opening the
      // ground would leave every later step judged against the island the
      // player landed on, which in the north is nine tiles and one producer.
      const goal = step.goal;
      if (goal.kind === 'region' && !world.regions.has(goal.regionId)) {
        const region = data.map.regions.find((r) => r.id === goal.regionId);
        if (!region) {
          findings.push({
            severity: 'error',
            at,
            message: `no region '${goal.regionId}' in this world — the step can never complete`
          });
        } else if (!applyUnlocks(world, data, true).includes(region.id)) {
          const want = region.unlock?.keys;
          findings.push({
            severity: 'error',
            at,
            message:
              want === undefined
                ? `region '${region.id}' has no unlock, so nothing the player can do lifts it`
                : `region '${region.id}' costs ${want} Gold Key(s) and the ladder has banked ${world.keys} by here — the step cannot be completed when it is asked`
          });
        }
      }
    }

    // The quest's own reward lands the moment its last step does. A legendary
    // egg has NO other source in the game — no generator, no region, no chest —
    // so if this were not modelled the dragon would read UNREACHABLE and the
    // arc check below would have nothing to check.
    if (quest.rewards) {
      grantXp(world, quest.rewards.xp ?? 0, data);
      world.keys += quest.rewards.keys ?? 0;
      const spawn = quest.rewards.spawn;
      if (spawn) {
        supply(world, data, spawn.chain, spawn.tier, spawn.count, {
          kind: 'order',
          detail: `reward of quest '${quest.id}'`,
          renewable: false
        });
      }
    }

    // Design intent: which quest is supposed to leave the player on which level.
    // The model banks only SCRIPTED xp (tutorial grants, order rewards and the
    // merges the tutorial forces), so it is the floor a player who merges
    // nothing optional would hit — the gap is the free-play merging the beat
    // silently depends on, which is exactly the number worth stating out loud.
    const wanted = quest.expects?.levelAtEnd;
    if (wanted !== undefined && world.level < wanted) {
      const needed = LEVEL_XP[wanted - 1] ?? 0;
      findings.push({
        severity: 'warning',
        at: `quest:${quest.id}`,
        message:
          `'${questTitle(quest, data)}' is authored to end on Keeper Level ${wanted}, but the scripted floor is ` +
          `Level ${world.level} at ${world.xp} XP — the beat depends on ${needed - world.xp} XP of free-play merging ` +
          `landing before the last delivery`
      });
    }
  }

  // The ladder's tail sits at the encore, which needs Level 3 to have happened
  // (the finale) for the Elder to exist at all.
  const finalAvailability = solveAvailability(world, data);
  return { beats, steps, findings, finalAvailability };
}
