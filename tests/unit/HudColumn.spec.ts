import { describe, expect, it } from 'vitest';
import {
  GAME_WIDTH,
  HUD_COLUMN_BASE_Y,
  HUD_COLUMN_DISC,
  HUD_COLUMN_PITCH,
  HUD_COLUMN_SLOTS,
  HUD_COLUMN_X,
  hudColumnY,
  LIVE_GAME_HEIGHT,
  STATUS_READOUT_BOTTOM_Y
} from '../../src/core/Constants';

/**
 * THE BOTTOM-RIGHT COLUMN MUST FIT ITS DOORS.
 *
 * Ledger, Bag, Cookbook, Store, Dragon Codex — five, since the Codex arrived,
 * and the fifth is the one that went wrong: at the old pitch its seat landed
 * inside the status readout hanging under the quest tracker, so a selected
 * dragon printed its name across the Codex plate.
 *
 * The fix was arithmetic (a lower base, a tighter pitch), and arithmetic is
 * exactly what should be checked here rather than on a screenshot. A sixth
 * door, a taller readout, or a row added to the quest cluster all break one of
 * these — in node, before the build.
 */
describe('the HUD column fits between the readout and the canvas edge', () => {
  /** Half the visible plate — what a seat actually occupies either side. */
  const reach = HUD_COLUMN_DISC / 2;

  it('seats every slot it claims to have', () => {
    expect(HUD_COLUMN_SLOTS).toBe(5);
    for (let slot = 0; slot < HUD_COLUMN_SLOTS; slot++) {
      expect(hudColumnY(slot)).toBe(HUD_COLUMN_BASE_Y - slot * HUD_COLUMN_PITCH);
    }
  });

  it('clears the status readout with the TOP seat', () => {
    // The one that failed. The readout appears on selection, so a collision
    // here is intermittent — which is worse than a permanent one, not better.
    const top = hudColumnY(HUD_COLUMN_SLOTS - 1) - reach;
    expect(top).toBeGreaterThan(STATUS_READOUT_BOTTOM_Y);
  });

  it('keeps the BOTTOM seat inside the canvas', () => {
    expect(hudColumnY(0) + reach).toBeLessThan(LIVE_GAME_HEIGHT);
    expect(HUD_COLUMN_X + reach).toBeLessThanOrEqual(GAME_WIDTH);
  });

  it('never lets two plates touch', () => {
    // `ui_btn_round` is painted 68 logical units around a disc of radius 29, so
    // the visible plate is ~174 units at the column's 1.5× scale. A pitch under
    // that is two buttons sharing an edge.
    expect(HUD_COLUMN_PITCH).toBeGreaterThan(HUD_COLUMN_DISC);
  });

  it('would fail if a SIXTH door were added at this pitch', () => {
    // Not a wish — a statement of where the next one has to go. The column is
    // full; a sixth needs its own answer, not another slot.
    const sixth = HUD_COLUMN_BASE_Y - HUD_COLUMN_SLOTS * HUD_COLUMN_PITCH - reach;
    expect(sixth).toBeLessThan(STATUS_READOUT_BOTTOM_Y);
  });
});
