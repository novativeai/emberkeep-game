/**
 * WHERE THE DRAGON CODEX PUTS THINGS — the pure half of the panel.
 *
 * Phaser-free on purpose. A page laid out against round numbers instead of the
 * panel it sits in is a frame poking out of the right edge, a button landing on
 * the row beneath it, and a chip drawn below the panel entirely — which is
 * exactly what the first cut did. Those are arithmetic mistakes, and arithmetic
 * is checkable in node, so the boxes live here and `CodexLayout.spec` asserts
 * every one of them is inside the field.
 *
 * THE FIELD is derived from the art rather than guessed at. `TextureFactory
 * .panel` paints `ui_panel` as PANEL_W×PANEL_H LOGICAL units through a context
 * scaled by RES, so the texture — and the image, drawn at scale 1 — is twice
 * that in game units. Its cream inner is the logical rect below. The panel
 * hangs at y = PANEL_Y in the container, so the field is that rect about the
 * image's centre, shifted down by it.
 */

/** `TextureFactory.panel`: `paint(key, 660, 440, …)`. */
const PANEL_W = 660;
const PANEL_H = 440;
/** `TextureFactory.panel`: `roundRectPath(g, 24, 20, 612, 392, 22)` — the cream
 *  inner, in the same logical units. */
const INNER = { x: 24, y: 20, w: 612, h: 392 };
/** Where DragonCodexPanel hangs the panel image in its own container. */
const PANEL_Y = 16;

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const rect = (x: number, y: number, w: number, h: number): Box => ({
  left: x,
  right: x + w,
  top: y,
  bottom: y + h
});

/** The cream field, in the panel container's coordinates. */
export const FIELD: Box = {
  left: INNER.x * 2 - PANEL_W,
  right: (INNER.x + INNER.w) * 2 - PANEL_W,
  top: INNER.y * 2 - PANEL_H + PANEL_Y,
  bottom: (INNER.y + INNER.h) * 2 - PANEL_H + PANEL_Y
};

/** Where content may start: the title lozenge covers the field's own top, so
 *  every page begins under it. */
export const CONTENT_TOP = -300;

/** The detail page's two columns. The right one holds the portrait, the cycle
 *  chip and the Evolution button — all fixed heights, which is the whole reason
 *  they moved there: the left column's height depends on how long the entry's
 *  prose runs, and anything stacked under it inherited that. */
export const RIGHT_X = 190;
export const RIGHT_W = 400;
export const LEFT_X = -580;
/** Wrap width for the words: stops short of the right column with a gutter. */
export const LEFT_W = RIGHT_X - LEFT_X - 60;

/** Vertical offsets from CONTENT_TOP, so the stack reads as a stack. */
export const PORTRAIT_H = 430;
export const CHIP_DY = 452;
export const CHIP_H = 62;
export const EVOLVE_DY = 590;
export const EVOLVE_H = 88;
/** Evolution page: the reveal card's longest side, and its centre. */
export const REVEAL_FIT = 420;
export const REVEAL_DY = 215;
export const REVEAL_INTO_DY = 485;
export const REVEAL_CONDITION_DY = 550;
export const REVEAL_CYCLES_DY = 610;

/** Every FIXED box the detail page draws — the ones a long entry cannot move. */
export const detailBoxes = (): Record<string, Box> => ({
  portrait: rect(RIGHT_X, CONTENT_TOP, RIGHT_W, PORTRAIT_H),
  chip: rect(RIGHT_X, CONTENT_TOP + CHIP_DY, RIGHT_W, CHIP_H),
  evolution: rect(RIGHT_X, CONTENT_TOP + EVOLVE_DY - EVOLVE_H / 2, RIGHT_W, EVOLVE_H)
});

/** The evolution page's boxes. The three lines are centred, so their width is
 *  bounded by the card rather than by the text — what matters here is that
 *  nothing reaches over the title lozenge or under the bottom border. */
export const evolutionBoxes = (): Record<string, Box> => ({
  reveal: rect(-REVEAL_FIT / 2, CONTENT_TOP + REVEAL_DY - REVEAL_FIT / 2, REVEAL_FIT, REVEAL_FIT),
  into: rect(-REVEAL_FIT / 2, CONTENT_TOP + REVEAL_INTO_DY - 24, REVEAL_FIT, 48),
  condition: rect(-REVEAL_FIT / 2, CONTENT_TOP + REVEAL_CONDITION_DY - 20, REVEAL_FIT, 40),
  cycles: rect(-REVEAL_FIT / 2, CONTENT_TOP + REVEAL_CYCLES_DY - 21, REVEAL_FIT, 42)
});

/** How much vertical room the left column has before it must be scaled down.
 *  The 16 is a breath off the bottom border — a line of text touching it reads
 *  as clipped even when it is not. */
export const leftColumnRoom = (): number => FIELD.bottom - 16 - CONTENT_TOP;

/** Does `box` sit entirely inside `outer`? */
export const inside = (box: Box, outer: Box): boolean =>
  box.left >= outer.left &&
  box.right <= outer.right &&
  box.top >= outer.top &&
  box.bottom <= outer.bottom;
