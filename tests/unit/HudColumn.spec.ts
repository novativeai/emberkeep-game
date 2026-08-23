import { describe, expect, it } from 'vitest';
import {
  GAME_WIDTH,
  HUD_COLUMN_BASE_Y,
  HUD_COLUMN_DISC,
  HUD_COLUMN_PITCH,
  HUD_COLUMN_PLATE,
  HUD_COLUMN_SLOTS,
  HUD_COLUMN_X,
  hudColumnY,
  LIVE_GAME_HEIGHT,
  STATUS_LINE_INK,
  STATUS_LINE_Y,
  STATUS_READOUT_BOTTOM_Y,
  STATUS_READOUT_H
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

  it('clears the status readout with the TOP seat, by a margin worth having', () => {
    // The one that failed. The readout appears on selection, so a collision
    // here is intermittent — which is worse than a permanent one, not better.
    //
    // AND IT FAILED AGAIN, GREEN. `toBeGreaterThan` passed on 1.44 units while
    // the caption visibly crossed the Codex plate, because both sides of the
    // comparison were under-declared (the disc modelled 116 units of a 136-unit
    // texture; the readout's height counted the caption's font size instead of
    // its ink). A pass is not a clearance: a margin under one line of the
    // caption's own ink is the arithmetic already drifting, so say so here.
    const top = hudColumnY(HUD_COLUMN_SLOTS - 1) - reach;
    expect(top).toBeGreaterThan(STATUS_READOUT_BOTTOM_Y);
    expect(top - STATUS_READOUT_BOTTOM_Y).toBeGreaterThanOrEqual(12);
  });

  it('measures the button by the texture it paints, not the disc inside it', () => {
    // `ui_btn_round` is painted 68x68 LOGICAL units (TextureFactory paints at
    // x RES) around a disc of radius 29. Phaser lays out and bounds the
    // TEXTURE, so 136 is what a seat occupies; 116 was the hole in the middle
    // of it, and every clearance computed from it was 13.2 units optimistic.
    expect(HUD_COLUMN_DISC).toBeCloseTo(136 * HUD_COLUMN_PLATE, 5);
  });

  it('derives the readout height from the rows it draws', () => {
    // The stale-summary guard. STATUS_READOUT_H was typed by hand and went out
    // of date the moment a row inside StatusPanel moved — which is exactly how
    // the collision above got through. It is derived now; this fails if anyone
    // types a number over it again.
    expect(STATUS_READOUT_H).toBe(STATUS_LINE_Y + STATUS_LINE_INK);
  });

  it('keeps the BOTTOM seat inside the canvas', () => {
    expect(hudColumnY(0) + reach).toBeLessThan(LIVE_GAME_HEIGHT);
    expect(HUD_COLUMN_X + reach).toBeLessThanOrEqual(GAME_WIDTH);
  });

  it('never lets two plates touch', () => {
    // The painted plate is 136 x HUD_COLUMN_PLATE = ~179.5 units across. A
    // pitch under that is two buttons sharing an edge — which is why the pitch
    // had no room to give when the column needed 14 units.
    expect(HUD_COLUMN_PITCH).toBeGreaterThan(HUD_COLUMN_DISC);
  });

  it('would fail if a SIXTH door were added at this pitch', () => {
    // Not a wish — a statement of where the next one has to go. The column is
    // full; a sixth needs its own answer, not another slot.
    const sixth = HUD_COLUMN_BASE_Y - HUD_COLUMN_SLOTS * HUD_COLUMN_PITCH - reach;
    expect(sixth).toBeLessThan(STATUS_READOUT_BOTTOM_Y);
  });
});
