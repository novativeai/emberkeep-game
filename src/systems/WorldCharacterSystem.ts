import { CHARACTER_COOLDOWN_MIN_MS } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import type { ChainsData, CharacterConfig, CharactersData } from '../core/types';

/**
 * Eleanor and Selyna standing IN the world — not on the merge board.
 *
 * They are map decor with a tap handler: never in `state.items`, never
 * draggable, never merged, never sold. The naming law holds — anything on the
 * merge board is anonymous and consumable, and anything with a name never
 * touches it (docs/merge-chains.md §1.2).
 *
 * This system owns anchors and cooldowns and **never touches a timer directly.**
 * `give_back` emits the same `generator:skip` command the Warmth/Gold skip
 * already uses, with the `gift` currency, so GeneratorSystem stays the single
 * owner of generator timers. A character is a new *reason* to skip, not a second
 * implementation of skipping.
 *
 * The refusal matters as much as the help. Eleanor can shorten a timer, and she
 * cannot **wake** anything — the Flame answers a Keeper's hands and hers are not
 * a Keeper's. Ask her to and she declines with `not_mine`, every session, for
 * weeks before chapter 8 explains why (docs/world-characters.md §1).
 */
export class WorldCharacterSystem {
  private readonly byId = new Map<string, CharacterConfig>();

  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
    data: CharactersData,
    private chains: ChainsData
  ) {
    for (const c of data.characters) this.byId.set(c.id, c);
    bus.on('ui:character_action_requested', ({ characterId, target }) =>
      this.useAction(characterId, target)
    );
  }

  /** Everyone standing on a given map. Selyna is never in Emberkeep, so this is
   *  how that stays true rather than being remembered. */
  charactersIn(world: string): CharacterConfig[] {
    return [...this.byId.values()].filter((c) => c.world === world);
  }

  get(characterId: string): CharacterConfig | undefined {
    return this.byId.get(characterId);
  }

  /**
   * MAY THIS VOICE BE HEARD HERE? — asked of the SPEAKER, not the character.
   *
   * A bubble names a speaker (`eleanor`), while the map holds bodies
   * (`eleanor`, `eleanor_home`), so the question is whether ANY body wearing
   * that voice stands in this world. Eleanor is welcome in Emberkeep and in
   * Roothold, where she keeps a second post; Selyna only in Borealis.
   *
   * A voice NO body claims is welcome everywhere, and that is the deliberate
   * half. The Golden Elder speaks from her altar and is not in the roster at
   * all; the fallback is what stops a rule about roaming characters from
   * silencing the one voice the chapter ends on.
   *
   * Only a beat that could fire ANYWHERE needs to ask — a chapter turning, a
   * heart earned. Arrival beats already choose their speaker by world.
   */
  speakerBelongs(speaker: string, world: string): boolean {
    let claimed = false;
    for (const c of this.byId.values()) {
      if (c.speaker !== speaker) continue;
      claimed = true;
      if (c.world === world) return true;
    }
    return !claimed;
  }

  /** Clock time when this character's action is usable again (0 = now). */
  readyAt(characterId: string): number {
    return this.state.characterCooldowns[characterId] ?? 0;
  }

  isReady(characterId: string): boolean {
    return this.clock.now() >= this.readyAt(characterId);
  }

  /**
   * A target is valid only if it is a generator with a timer actually running.
   * A ready generator does not need her, and a plain merge piece has no timer to
   * give back — both are `invalid_target`, and both say so.
   */
  private canGiveBack(itemId: number): boolean {
    const item = this.state.items.get(itemId);
    if (!item || item.kind !== 'item') return false;
    const tier = this.chains.chains
      .find((c) => c.id === item.chain)
      ?.tiers.find((t) => t.tier === item.tier);
    if (!tier?.generator) return false;
    const now = this.clock.now();
    const waitingTap = item.readyAt !== undefined && item.readyAt > now;
    const waitingPassive = item.passiveAt !== undefined && item.passiveAt > now;
    return waitingTap || waitingPassive;
  }

  private useAction(characterId: string, target?: number): void {
    const cfg = this.byId.get(characterId);
    if (!cfg) return;
    if (!this.isReady(characterId)) {
      this.bus.emit('character:action_failed', { characterId, reason: 'cooldown' });
      return;
    }
    if (target === undefined || !this.canGiveBack(target)) {
      this.bus.emit('character:action_failed', { characterId, reason: 'invalid_target' });
      return;
    }

    // The timer is GeneratorSystem's; she only asks.
    this.bus.emit('generator:skip', { itemId: target, currency: 'gift' });

    const cooldown = Math.max(CHARACTER_COOLDOWN_MIN_MS, cfg.cooldownMs);
    const readyAt = this.clock.now() + cooldown;
    this.state.characterCooldowns[characterId] = readyAt;
    this.bus.emit('character:action_used', { characterId, action: cfg.action, readyAt });
  }
}
