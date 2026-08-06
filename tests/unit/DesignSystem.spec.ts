import { describe, expect, it } from 'vitest';
import { CHROME_KEYS } from '../../src/art/design';
import assetsDoc from '../../src/data/assets.json';

/**
 * `src/art/design.ts` dresses the Ember Emporium only — the rest of the UI
 * wears the board's `PALETTE` chrome painted by TextureFactory. What survives
 * from the wider design-system pass is this one guard, because the bug it
 * catches is invisible until someone opens the screen.
 */
describe('Emporium chrome (src/art/design.ts)', () => {
  /**
   * A chrome key can be painted by TextureFactory's switch and drawn by a panel
   * and STILL never exist, because nothing generates a key that assets.json
   * does not list. Phaser then swaps in its green missing-texture box, which on
   * a dark panel reads as "the art is still being made" rather than as a bug —
   * the Emporium shipped a session with its plaque, tabs, wallet chips and
   * price plates silently absent for exactly that reason.
   */
  it('every chrome key is registered in assets.json', () => {
    const registered = new Set((assetsDoc.images as Array<{ key: string }>).map((e) => e.key));
    const unregistered = CHROME_KEYS.filter((k) => !registered.has(k));
    expect(unregistered, "a key nothing generates renders as Phaser's missing texture").toEqual([]);
  });
});
