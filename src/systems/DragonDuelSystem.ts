import { DUEL } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { ChainsData, DuelDragon, DuelOutcome, DuelThrow } from '../core/types';

/** Chain → loop-art colour (drives `duel_<throw>_<color>` textures). */
const DRAGON_COLORS: Record<string, string> = { ember_dragon: 'red', emerald: 'green' };

/** What each throw defeats, and what defeats it. */
const BEATS: Record<DuelThrow, DuelThrow> = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const LOSES_TO: Record<DuelThrow, DuelThrow> = { rock: 'paper', scissors: 'rock', paper: 'scissors' };

interface RosterEntry {
  chain: string;
  hatchTier: number;
  color: string;
  name: string;
}

/**
 * Dragon Duel — the rock-paper-scissors level-up mode (tunables in DUEL). It
 * unlocks once EVERY dragon is hatched and the Keeper is level ≥ 2 (which lands
 * just after the tutorial, so it never disturbs it). The player picks a dragon,
 * pays `energyCost` for a set of `matchesPerSet` AUTO-battles against a random
 * OTHER owned dragon whose throws are biased weak (`winRate`/`tieRate`); each win
 * adds `winGauge` to that dragon's 0..`gaugeMax` gauge. A dragon's own passive
 * production ("work") drips `workGauge`. Filling the gauge levels the dragon up
 * (+coins, gauge carries the overflow). The UI drives the countdown/reveal and
 * asks this system to resolve each match; all game logic stays here (Phaser-free
 * → node-tested). rollOutcome/throwsFor are `protected` so tests force results.
 */
export class DragonDuelSystem {
  private readonly roster: RosterEntry[];
  private selected: string | null = null;
  private matchesLeft = 0;

  constructor(
    private state: GameState,
    private bus: EventBus,
    chains: ChainsData
  ) {
    this.roster = chains.chains
      .filter((c) => c.hatchAtTier !== undefined)
      .map((c) => {
        const hatchTier = c.hatchAtTier!;
        const tierCfg = c.tiers.find((t) => t.tier === hatchTier);
        return { chain: c.id, hatchTier, color: DRAGON_COLORS[c.id] ?? 'red', name: tierCfg?.name ?? c.name };
      });

    bus.on('duel:choose', ({ chain }) => this.choose(chain));
    bus.on('duel:start', () => this.startSet());
    bus.on('duel:play', ({ move }) => this.play(move));
    bus.on('item:produced', ({ generatorId }) => this.onProduced(generatorId));
    bus.on('item:hatched', () => this.announce());
    bus.on('item:spawned', () => this.announce());
    bus.on('item:merged', () => this.announce());
    bus.on('item:removed', () => this.announce());
    bus.on('keeper:leveled', () => this.announce());
    bus.on('state:loaded', () => this.announce());
    bus.on('energy:changed', () => { if (this.isUnlocked()) this.announce(); });
    bus.on('game:reset', () => {
      this.selected = null;
      this.matchesLeft = 0;
      this.announce();
    });
  }

  private isOwned(entry: RosterEntry): boolean {
    return this.state.countItems(entry.chain, entry.hatchTier) > 0;
  }

  private ownedChains(): string[] {
    return this.roster.filter((d) => this.isOwned(d)).map((d) => d.chain);
  }

  private colorOf(chain: string): string {
    return this.roster.find((d) => d.chain === chain)?.color ?? 'red';
  }

  /** Unlocked once every dragon is hatched AND the Keeper is level ≥ 2. */
  private isUnlocked(): boolean {
    return this.state.level >= 2 && this.roster.length > 0 && this.roster.every((d) => this.isOwned(d));
  }

  private choose(chain: string): void {
    if (!this.isUnlocked()) return;
    if (!this.roster.some((d) => d.chain === chain && this.isOwned(d))) return;
    if (this.matchesLeft > 0) return; // don't swap mid-set
    this.selected = chain;
    this.announce();
  }

  /** Begin a set: pay energy, arm `matchesPerSet` matches. */
  private startSet(): void {
    if (!this.isUnlocked() || this.matchesLeft > 0) return;
    if (!this.selected || !this.roster.some((d) => d.chain === this.selected && this.isOwned(d))) {
      this.bus.emit('duel:start_failed', { reason: 'no_dragon' });
      return;
    }
    // energyCurrent is a lower bound (regen only adds), so ≥ cost ⇒ the spend
    // below is guaranteed to succeed — no start-without-paying race.
    if (this.state.energyCurrent < DUEL.energyCost) {
      this.bus.emit('duel:start_failed', { reason: 'energy' });
      return;
    }
    this.bus.emit('energy:spend', { amount: DUEL.energyCost, reason: 'duel' });
    this.matchesLeft = DUEL.matchesPerSet;
    this.bus.emit('duel:set_started', { chain: this.selected, matches: this.matchesLeft });
    this.announce();
  }

  /** Resolve ONE match: the player threw `chosenThrow`; the (weak) opponent's
   *  throw is derived so the weighted outcome holds while the player's pick is
   *  honoured on screen. */
  private play(chosenThrow: DuelThrow): void {
    if (this.matchesLeft <= 0 || !this.selected) return;
    const chain = this.selected;
    const oppChain = this.pickOpponent(chain);
    if (!oppChain) return; // unreachable while unlocked (≥2 dragons), guard anyway

    const outcome = this.rollOutcome();
    const playerThrow = chosenThrow;
    const oppThrow: DuelThrow =
      outcome === 'win' ? BEATS[chosenThrow] : outcome === 'tie' ? chosenThrow : LOSES_TO[chosenThrow];

    const rec = this.state.ensureDragon(chain);
    let leveledUp = false;
    if (outcome === 'win') {
      rec.gauge += DUEL.winGauge;
      leveledUp = this.settleLevelUps(rec);
    }
    this.matchesLeft -= 1;

    this.bus.emit('duel:match', {
      chain,
      oppChain,
      color: this.colorOf(chain),
      oppColor: this.colorOf(oppChain),
      playerThrow,
      oppThrow,
      outcome,
      gauge: rec.gauge,
      gaugeMax: DUEL.gaugeMax,
      level: rec.level,
      leveledUp,
      matchesLeft: this.matchesLeft
    });
    this.announce();
  }

  /** A dragon's passive production is its "work" — drip the gauge. */
  private onProduced(generatorId: number): void {
    const item = this.state.items.get(generatorId);
    if (!item) return;
    const entry = this.roster.find((d) => d.chain === item.chain && d.hatchTier === item.tier);
    if (!entry) return;
    const rec = this.state.ensureDragon(entry.chain);
    rec.gauge += DUEL.workGauge;
    this.settleLevelUps(rec);
    this.announce();
  }

  /** Carry a full gauge into levels, paying the level-up reward each time. */
  private settleLevelUps(rec: { level: number; gauge: number }): boolean {
    let leveled = false;
    while (rec.gauge >= DUEL.gaugeMax) {
      rec.gauge -= DUEL.gaugeMax;
      rec.level += 1;
      leveled = true;
      const coins = DUEL.levelReward.coinsBase + rec.level * DUEL.levelReward.coinsPerLevel;
      this.bus.emit('economy:add', { coins, reason: 'duel_levelup' });
    }
    return leveled;
  }

  /** A random OTHER owned dragon (the opponent). */
  private pickOpponent(chain: string): string | null {
    const others = this.ownedChains().filter((c) => c !== chain);
    if (others.length === 0) return null;
    return others[Math.floor(Math.random() * others.length)]!;
  }

  /** Weighted match outcome — opponent is deliberately weak. */
  protected rollOutcome(): DuelOutcome {
    const r = Math.random();
    if (r < DUEL.winRate) return 'win';
    if (r < DUEL.winRate + DUEL.tieRate) return 'tie';
    return 'lose';
  }

  /** Broadcast the roster + set state to the duel UI. */
  announce(): void {
    const roster: DuelDragon[] = this.roster.map((d) => {
      const stat = this.state.dragonStat(d.chain);
      return { chain: d.chain, color: d.color, name: d.name, owned: this.isOwned(d), level: stat.level, gauge: stat.gauge };
    });
    this.bus.emit('duel:changed', {
      unlocked: this.isUnlocked(),
      roster,
      selected: this.selected,
      matchesLeft: this.matchesLeft,
      canAfford: this.state.energyCurrent >= DUEL.energyCost,
      energyCost: DUEL.energyCost,
      gaugeMax: DUEL.gaugeMax
    });
  }
}
