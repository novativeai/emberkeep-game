/**
 * The spatial half of the orchestration: who gets to be expensive this frame.
 *
 * Phaser-free on purpose. The policy — cull, rank, allocate, cap — is the part
 * most likely to be wrong in a way no screenshot reveals (a rig quietly stuck
 * at `low` in the middle of the screen looks fine until you compare it to the
 * one beside it), so it lives where a unit test can pin it down.
 */
import { TIER_ORDER, type FxTier } from './emitterTypes';

export interface ViewRect {
  x: number;
  y: number;
  right: number;
  bottom: number;
}

export interface BudgetTarget {
  x: number;
  y: number;
  /** Furthest reach of the stack, in world px. */
  radius: number;
}

export interface BudgetOptions {
  /** How many targets may run the full stack. */
  highSlots: number;
  /** …and how many the middle tier, after the high slots are taken. */
  mediumSlots: number;
  /** Extra px around the view before a target is culled — generous, so a smoke
   *  column is already running by the time its source scrolls in. */
  cullPadPx: number;
  /** Hard ceiling from the power governor. `off` stops everything. */
  ceiling: FxTier;
}

/** Circle/rect overlap. Allocation-free; runs once per rig per frame. */
export function circleTouchesRect(x: number, y: number, r: number, rect: ViewRect): boolean {
  const nx = x < rect.x ? rect.x : x > rect.right ? rect.right : x;
  const ny = y < rect.y ? rect.y : y > rect.bottom ? rect.bottom : y;
  const dx = x - nx;
  const dy = y - ny;
  return dx * dx + dy * dy <= r * r;
}

export const capTier = (want: FxTier, ceiling: FxTier): FxTier =>
  TIER_ORDER.indexOf(want) <= TIER_ORDER.indexOf(ceiling) ? want : ceiling;

/**
 * Resolve a tier for every target, returned in the SAME order as the input.
 *
 * Ranking is by distance from the view centre, not by spawn order or by
 * distance from the camera's anchor: what the player is looking at is what
 * deserves the budget, and on a board camera that glides between zones those
 * are not the same thing.
 */
export function assignTiers(targets: readonly BudgetTarget[], view: ViewRect, opts: BudgetOptions): FxTier[] {
  const out: FxTier[] = new Array<FxTier>(targets.length).fill('off');
  if (opts.ceiling === 'off') return out;

  const cx = (view.x + view.right) / 2;
  const cy = (view.y + view.bottom) / 2;

  const visible: Array<{ i: number; d2: number }> = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (!circleTouchesRect(t.x, t.y, t.radius + opts.cullPadPx, view)) continue;
    const dx = t.x - cx;
    const dy = t.y - cy;
    visible.push({ i, d2: dx * dx + dy * dy });
  }
  // Tie-break on index so the assignment is stable frame to frame; without it
  // two equidistant rigs can swap tiers every frame and visibly pop.
  visible.sort((a, b) => a.d2 - b.d2 || a.i - b.i);

  for (let rank = 0; rank < visible.length; rank++) {
    const want: FxTier =
      rank < opts.highSlots ? 'high' : rank < opts.highSlots + opts.mediumSlots ? 'medium' : 'low';
    out[visible[rank].i] = capTier(want, opts.ceiling);
  }
  return out;
}
