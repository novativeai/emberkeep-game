import { GOLDEN_ALTAR } from './Constants';
import type { GameState } from './GameState';

/**
 * The Golden Elder's awakening — one question, one answer.
 *
 * It used to be asked in three places with two different formulas, and they
 * disagreed exactly where it mattered. On a CUSTOM world (the authored map deleted)
 * Cindra's golden order needs a crystal→emerald→flame_gem chain that does not exist
 * there, so it can never be delivered: the finale woke her through the `baseHidden`
 * clause, the travel preview agreed — and the altar, which asked only about the
 * order, decided on every reload that she had never woken and grew the egg back on
 * her empty ledge. Two of her, or none.
 *
 * So the awakening is now RECORDED (`stats.goldenAwakened`, written by TaskSystem
 * off `golden:awakened`) instead of re-derived. A moment that happened is a fact,
 * not a formula to re-run against a world that may have changed under it.
 */
export const GOLDEN_AWAKENED_STAT = 'goldenAwakened';

/**
 * Has the promise Cindra's golden order stands for been kept? Delivering her order
 * is the authored answer; in a custom world, where that order is unreachable, the
 * finale itself (Level 3) IS the promise.
 *
 * `baseHidden` comes from the editor (the authored map was deleted) — passed in, so
 * this stays in `core` and the systems can read it too.
 */
export function goldenPromiseKept(state: GameState, baseHidden: boolean): boolean {
  return (
    state.completedOrderIds.includes(GOLDEN_ALTAR.orderId) ||
    (baseHidden && state.level >= 3)
  );
}

/**
 * Has she ALREADY risen? The recorded fact first; the derived formula second, so a
 * save written before the fact existed still reads correctly (an authored game that
 * delivered the order and reached Level 3 has unquestionably seen her wake).
 */
export function goldenAwakened(state: GameState, baseHidden: boolean): boolean {
  if (state.stat(GOLDEN_AWAKENED_STAT) > 0) return true;
  return goldenPromiseKept(state, baseHidden) && state.level >= 3;
}
