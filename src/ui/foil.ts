import Phaser from 'phaser';
import { FOIL, num, PALETTE } from '../core/Constants';

/**
 * The foil plate a LEGENDARY store card is printed on: brushed violet metal, a
 * holographic streak travelling across it, and a gold rim.
 *
 * Painted, not authored. Three small canvas textures cover every card size, so
 * a new legendary costs nothing in the asset budget and the look stays exactly
 * consistent between a 452-wide card and the 687-wide showcase.
 *
 * The sheen is the part worth being careful about. It is a TileSprite pinned to
 * a FIXED rectangle scrolling its own texture — not a streak sprite sliding
 * across a masked card. Phaser resolves geometry masks in world space and drops
 * the transform of a nested container, and a store card sits three containers
 * deep inside a panel that is itself scaled per device; a mask would drift off
 * the card on exactly the devices nobody tests on. A scrolling tile is clipped
 * by its own bounds for free.
 */

const PLATE_KEY = 'ui_foil_plate';
const HOLO_KEY = 'ui_foil_holo';
const SCRIM_KEY = 'ui_foil_scrim';

/** Holo tile edge, in px. Power-of-two: WebGL needs it to repeat. */
const HOLO = 256;

/**
 * How far the plate is inset from the card's edge. The plate is a RECTANGLE
 * inside a rounded card, so the inset has to be at least `r - r/√2` or the
 * plate's corners poke out past the arc. At the card radius of 34 that is 10.
 */
export const PLATE_INSET = 10;

function ensureTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(PLATE_KEY)) {
    // Brushed metal, read top-to-bottom: a dark base, a bright band a third of
    // the way down where the light catches, then back down to the base. Only
    // 8px wide — it is stretched across the card, and nothing in it varies
    // horizontally.
    const tex = scene.textures.createCanvas(PLATE_KEY, 8, 256);
    if (tex) {
      const c = tex.getContext();
      const g = c.createLinearGradient(0, 0, 0, 256);
      // The catch-light sits in the TOP third, where a card's picture is. Below
      // it the metal falls back to the base so the name, the blurb and the price
      // read off dark violet instead of competing with a lit band.
      g.addColorStop(0, FOIL.base);
      g.addColorStop(0.14, FOIL.mid);
      g.addColorStop(0.26, FOIL.high);
      g.addColorStop(0.42, FOIL.mid);
      g.addColorStop(0.72, FOIL.base);
      g.addColorStop(1, FOIL.mid);
      c.fillStyle = g;
      c.fillRect(0, 0, 8, 256);
      tex.refresh();
    }
  }

  if (!scene.textures.exists(HOLO_KEY)) {
    // The travelling sheen. Every value is a function of (x + y) mod 256, which
    // is what makes the tile seamless in BOTH axes — the streak can then be
    // scrolled on one axis and still read as a clean 45° pass. One bright
    // specular core with a violet band on one shoulder and a cyan band on the
    // other: chromatic separation is the whole tell of a foil card.
    const tex = scene.textures.createCanvas(HOLO_KEY, HOLO, HOLO);
    if (tex) {
      const c = tex.getContext();
      const img = c.createImageData(HOLO, HOLO);
      const band = (t: number, centre: number, width: number): number => {
        // Wrapped distance, so a band straddling the seam does not tear.
        let d = Math.abs(t - centre);
        if (d > 0.5) d = 1 - d;
        return Math.exp(-((d / width) ** 2));
      };
      for (let y = 0; y < HOLO; y++) {
        for (let x = 0; x < HOLO; x++) {
          const t = ((x + y) % HOLO) / HOLO;
          const core = band(t, 0.5, 0.028);
          const violet = band(t, 0.5 - 0.055, 0.045);
          const cyan = band(t, 0.5 + 0.055, 0.045);
          const a = Math.min(1, core + 0.55 * violet + 0.55 * cyan);
          const i = (y * HOLO + x) * 4;
          img.data[i] = Math.min(255, 255 * core + 190 * violet + 90 * cyan);
          img.data[i + 1] = Math.min(255, 255 * core + 110 * violet + 220 * cyan);
          img.data[i + 2] = Math.min(255, 255 * core + 255 * violet + 245 * cyan);
          img.data[i + 3] = Math.round(255 * a);
        }
      }
      c.putImageData(img, 0, 0);
      tex.refresh();
    }
  }

  if (!scene.textures.exists(SCRIM_KEY)) {
    // Clear at the top, night at the bottom — what the hero card's name and
    // blurb sit on so they stay readable over whatever the key art is doing.
    const tex = scene.textures.createCanvas(SCRIM_KEY, 8, 256);
    if (tex) {
      const c = tex.getContext();
      const g = c.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, 'rgba(36,27,34,0)');
      g.addColorStop(0.45, 'rgba(36,27,34,0.55)');
      g.addColorStop(1, 'rgba(36,27,34,0.94)');
      c.fillStyle = g;
      c.fillRect(0, 0, 8, 256);
      tex.refresh();
    }
  }
}

/** A bottom-up darkening gradient, for text laid over full-bleed art. */
export function addScrim(
  scene: Phaser.Scene,
  width: number,
  height: number,
  y: number
): Phaser.GameObjects.Image {
  ensureTextures(scene);
  return scene.add.image(0, y, SCRIM_KEY).setOrigin(0.5, 0).setDisplaySize(width, height);
}

/**
 * Paint the foil plate for a card of `width` x `height` (centred on 0,0) and
 * return the pieces in draw order, plus the sheen so the caller can run it.
 *
 * The rim is returned separately because it belongs ON TOP of whatever the card
 * puts on the plate — art, scrim, text — and only the caller knows that order.
 */
export function makeFoilPlate(
  scene: Phaser.Scene,
  width: number,
  height: number,
  radius: number,
  rimColor: string = FOIL.edge
): {
  under: Phaser.GameObjects.GameObject[];
  sheen: Phaser.GameObjects.TileSprite;
  rim: Phaser.GameObjects.Graphics;
} {
  ensureTextures(scene);
  const inner = { w: width - PLATE_INSET * 2, h: height - PLATE_INSET * 2 };

  const g = scene.add.graphics();
  g.fillStyle(num(PALETTE.night), 1);
  g.fillRoundedRect(-width / 2, -height / 2 + 8, width, height, radius);
  g.fillStyle(num(FOIL.base), 1);
  g.fillRoundedRect(-width / 2, -height / 2, width, height, radius);

  const plate = scene.add.image(0, 0, PLATE_KEY).setDisplaySize(inner.w, inner.h);

  const sheen = scene.add
    .tileSprite(0, 0, inner.w, inner.h, HOLO_KEY)
    .setTileScale(FOIL.tileScale)
    .setAlpha(FOIL.sheenAlpha)
    .setBlendMode(Phaser.BlendModes.ADD);

  const rim = scene.add.graphics();
  rim.lineStyle(FOIL.rimWidth, num(rimColor), 1);
  rim.strokeRoundedRect(-width / 2, -height / 2, width, height, radius);

  return { under: [g, plate], sheen, rim };
}

/**
 * Run the sheen across a plate, for ever, with a beat between passes.
 *
 * One period of the holo tile is exactly `HOLO` texture units, so scrolling by
 * that much is exactly one pass — no matter the card size or the tile scale.
 * The returned tween is the caller's to stop: a tween left running on a hidden
 * panel is a wake source the battery governor cannot see.
 */
export function runSheen(
  scene: Phaser.Scene,
  sheen: Phaser.GameObjects.TileSprite,
  delay = 0
): Phaser.Tweens.Tween {
  return scene.tweens.add({
    targets: sheen,
    tilePositionX: { from: 0, to: -HOLO },
    duration: FOIL.sweepMs,
    ease: 'Sine.easeInOut',
    repeat: -1,
    repeatDelay: FOIL.sweepGapMs,
    delay
  });
}
