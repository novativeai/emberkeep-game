import { DRAGON_REVEAL } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';

/** The save latch for a form the player has already been shown. */
export const revealKey = (chain: string, tier: number): string => `reveal:${chain}:${tier}`;

/**
 * Decides when a dragon form is being seen for the FIRST time, and says so.
 *
 * It exists as a system rather than living in the scene that draws the card for
 * one reason: "first time" is a fact about the save, not about the screen. The
 * latch is a `stats` counter, so it survives a reload, a re-hatch and a second
 * dragon of the same breed — and a player who closes the app mid-celebration
 * does not get the same reveal again on the way back in.
 *
 * It emits `dragon:revealed` and nothing else. UIScene draws the card and
 * AudioManager roars off the same fact; neither knows about the other, and a
 * headless run (unit tests, `render_game_to_text`) sees the fact and no card.
 */
export class RevealSystem {
  constructor(
    private state: GameState,
    private bus: EventBus
  ) {
    // A whelp arrives by hatching, an adult by merging. Both are "this form is
    // now yours", which is the only thing worth a full-screen interruption —
    // note neither a load nor a bag withdrawal fires one, on purpose.
    bus.on('item:hatched', ({ item }) => this.consider(item.chain, item.tier));
    bus.on('item:merged', ({ chain, resultTier }) => this.consider(chain, resultTier));
  }

  /** Has this form already had its moment? */
  seen(chain: string, tier: number): boolean {
    return this.state.stat(revealKey(chain, tier)) > 0;
  }

  private consider(chain: string, tier: number): void {
    const card = DRAGON_REVEAL[`${chain}:${tier}`];
    if (!card || this.seen(chain, tier)) return;
    this.state.addStat(revealKey(chain, tier), 1);
    this.bus.emit('dragon:revealed', { chain, tier, ...card });
  }
}
