import { describe, expect, it } from 'vitest';
import {
  CONTENT_TOP,
  detailBoxes,
  evolutionBoxes,
  FIELD,
  inside,
  LEFT_W,
  LEFT_X,
  leftColumnRoom,
  RIGHT_X
} from '../../src/ui/codexLayout';

/**
 * The Dragon Codex's pages must stay inside the panel they are drawn on.
 *
 * This is not a style preference — the first cut put the portrait's frame at
 * x 150…670 against a field that ends at 612, stacked the Evolution button at a
 * fixed y under a column whose height depends on how long the breed's prose
 * runs, and drew the cycle chip below the panel entirely. All three are
 * arithmetic, and arithmetic belongs in node rather than in a screenshot.
 */
describe('the Dragon Codex lays out inside its panel', () => {
  it('derives the field from the painted panel, not from round numbers', () => {
    // TextureFactory.panel: 660×440 logical at RES, cream inner (24,20,612,392),
    // hung at y = 16. Written out so a repaint that moves the art fails HERE.
    expect(FIELD).toEqual({ left: -612, right: 612, top: -384, bottom: 400 });
  });

  it('starts its content below the title lozenge', () => {
    // The lozenge is drawn at -436…-332 and overlaps the field's own top.
    expect(CONTENT_TOP).toBeGreaterThan(-332);
    expect(CONTENT_TOP).toBeGreaterThanOrEqual(FIELD.top);
  });

  it('keeps every fixed box of the detail page inside the field', () => {
    for (const [name, box] of Object.entries(detailBoxes())) {
      expect(inside(box, FIELD), `${name} ${JSON.stringify(box)}`).toBe(true);
    }
  });

  it('never lets the detail page overlap its own two columns', () => {
    // The words wrap to LEFT_W from LEFT_X; the portrait column starts at
    // RIGHT_X. A wrap width that reaches into it is text under a picture.
    expect(LEFT_X + LEFT_W).toBeLessThan(RIGHT_X);
  });

  it('stacks the right column without the boxes touching', () => {
    const { portrait, chip, evolution } = detailBoxes();
    expect(chip.top).toBeGreaterThan(portrait.bottom);
    expect(evolution.top).toBeGreaterThan(chip.bottom);
  });

  it('leaves the left column real room, and a bottom breath', () => {
    expect(leftColumnRoom()).toBeGreaterThan(600); // enough for the longest entry
    expect(CONTENT_TOP + leftColumnRoom()).toBeLessThan(FIELD.bottom);
  });

  it('keeps the evolution page inside the field too', () => {
    for (const [name, box] of Object.entries(evolutionBoxes())) {
      expect(inside(box, FIELD), `${name} ${JSON.stringify(box)}`).toBe(true);
    }
  });

  it('stacks the evolution page in reading order', () => {
    const { reveal, into, condition, cycles } = evolutionBoxes();
    expect(into.top).toBeGreaterThanOrEqual(reveal.bottom);
    expect(condition.top).toBeGreaterThanOrEqual(into.bottom);
    expect(cycles.top).toBeGreaterThanOrEqual(condition.bottom);
  });
});
