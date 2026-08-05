import Phaser from 'phaser';
import { num, PALETTE } from '../core/Constants';

/**
 * The shared PAINTED PANEL skin — the Cookbook's visual language, extracted so the
 * small floating menus on the board (a generator's skip prices, the dragon's action
 * menu) read as the same system as the Cookbook and Ledger instead of as three
 * unrelated widgets.
 *
 * The language, lifted from CookbookPanel: a cream parchment body, a gold border,
 * brown text, gold pills for the actions (its title lozenge is gold-filled with a
 * cream stroke). Nothing here paints art — it is all vector, so it costs no texture
 * memory and scales with the 2560×1600 space.
 *
 * Every menu that floats over the BOARD should use `paintPanelBody` + `panelButton`
 * rather than tinting the old green button art.
 */

export const PANEL_SKIN = {
  font: 'Trebuchet MS, Verdana, sans-serif',
  /** Body: cream parchment, gold border, soft plum drop shadow. */
  body: {
    radius: 28,
    fillAlpha: 0.97,
    borderWidth: 6,
    /** Inner hairline, the Cookbook's seam colour. */
    hairlineAlpha: 0.3,
    shadowDy: 10,
    shadowAlpha: 0.3
  },
  /** The little triangle that points the panel at the piece it belongs to. */
  tail: { w: 40, h: 26 },
  /** Action pills. */
  button: {
    h: 78,
    radius: 24,
    borderWidth: 5,
    fontSize: 30
  },
  title: { fontSize: 30, dy: 16 }
} as const;

export type PanelTone = 'gold' | 'plum';

/**
 * The parchment body, centred on (0,0), `w`×`h`. `tail` draws the pointer on the
 * edge that faces the piece — 'up' when the panel hangs BELOW its item (the usual
 * case on this board, since a menu under the piece never covers it).
 */
export function paintPanelBody(
  scene: Phaser.Scene,
  w: number,
  h: number,
  tail: 'up' | 'none' = 'up'
): Phaser.GameObjects.Graphics {
  const S = PANEL_SKIN.body;
  const g = scene.add.graphics();
  const x = -w / 2;
  const y = -h / 2;

  // Drop shadow first, so the panel lifts off the board art beneath it.
  g.fillStyle(num(PALETTE.plumShade), S.shadowAlpha);
  g.fillRoundedRect(x, y + S.shadowDy, w, h, S.radius);

  // Parchment body + gold border.
  g.fillStyle(num(PALETTE.cream), S.fillAlpha);
  g.fillRoundedRect(x, y, w, h, S.radius);
  g.lineStyle(S.borderWidth, num(PALETTE.gold), 1);
  g.strokeRoundedRect(x, y, w, h, S.radius);
  // Inner hairline — the Cookbook's seam, one step darker than the border.
  g.lineStyle(3, num(PALETTE.goldShade), S.hairlineAlpha);
  g.strokeRoundedRect(x + 9, y + 9, w - 18, h - 18, S.radius - 8);

  if (tail === 'up') {
    // Painted in the same two passes so the tail carries the border too.
    const t = PANEL_SKIN.tail;
    const pts = [
      new Phaser.Geom.Point(-t.w / 2, y + 2),
      new Phaser.Geom.Point(t.w / 2, y + 2),
      new Phaser.Geom.Point(0, y - t.h)
    ];
    g.fillStyle(num(PALETTE.cream), 1);
    g.fillPoints(pts, true);
    g.lineStyle(S.borderWidth, num(PALETTE.gold), 1);
    g.lineBetween(pts[0]!.x, pts[0]!.y, pts[2]!.x, pts[2]!.y);
    g.lineBetween(pts[1]!.x, pts[1]!.y, pts[2]!.x, pts[2]!.y);
    // Re-cover the body edge the tail sits on, so no border line crosses the gap.
    g.fillStyle(num(PALETTE.cream), 1);
    g.fillRect(-t.w / 2 + 4, y - 1, t.w - 8, 6);
  }
  return g;
}

/** A panel title, in the Cookbook's brown on parchment. */
export function panelTitle(scene: Phaser.Scene, y: number, text: string): Phaser.GameObjects.Text {
  return scene.add
    .text(0, y, text, {
      fontFamily: PANEL_SKIN.font,
      fontSize: `${PANEL_SKIN.title.fontSize}px`,
      fontStyle: 'bold',
      color: PALETTE.textBrown
    })
    .setOrigin(0.5);
}

export interface PanelButtonCfg {
  x: number;
  y: number;
  w: number;
  label: string;
  /** gold = the primary action; plum = the quieter one. */
  tone?: PanelTone;
  /** Optional icon texture drawn left of the label (already-loaded key). */
  iconKey?: string;
  iconScale?: number;
  onTap: () => void;
}

/**
 * An action pill in the panel's language.
 *
 * The hit area lives on the CONTAINER — `setSize()` + `setInteractive()` — which is
 * the pattern that works in this project (CookbookPanel's close button does exactly
 * this). An interactive CHILD inside a container that is itself inside another
 * container does not reliably receive the pointer here, and that is what made every
 * "buy with Warmth / Gold" button dead to the touch.
 */
export function panelButton(scene: Phaser.Scene, cfg: PanelButtonCfg): Phaser.GameObjects.Container {
  const B = PANEL_SKIN.button;
  const tone: PanelTone = cfg.tone ?? 'gold';
  const c = scene.add.container(cfg.x, cfg.y);

  const g = scene.add.graphics();
  const paint = (hover: boolean): void => {
    g.clear();
    const fill = tone === 'gold' ? PALETTE.gold : PALETTE.plumShade;
    const stroke = tone === 'gold' ? PALETTE.cream : PALETTE.gold;
    g.fillStyle(num(hover && tone === 'gold' ? PALETTE.goldAccent : fill), 1);
    g.fillRoundedRect(-cfg.w / 2, -B.h / 2, cfg.w, B.h, B.radius);
    g.lineStyle(B.borderWidth, num(stroke), tone === 'gold' ? 0.95 : 0.8);
    g.strokeRoundedRect(-cfg.w / 2, -B.h / 2, cfg.w, B.h, B.radius);
  };
  paint(false);

  const hasIcon = !!cfg.iconKey && scene.textures.exists(cfg.iconKey);
  const iconW = hasIcon ? 46 : 0;
  const label = scene.add
    .text(iconW / 2, -2, cfg.label, {
      fontFamily: PANEL_SKIN.font,
      fontSize: `${B.fontSize}px`,
      fontStyle: 'bold',
      color: tone === 'gold' ? PALETTE.textBrown : PALETTE.cream,
      align: 'center'
    })
    .setOrigin(0.5);
  c.add(g);
  if (hasIcon) {
    c.add(
      scene.add
        .image(-label.width / 2 - 6, 0, cfg.iconKey!)
        .setScale(cfg.iconScale ?? 0.1)
        .setOrigin(0.5)
    );
  }
  c.add(label);

  c.setSize(cfg.w, B.h);
  c.setInteractive({ useHandCursor: true });
  // Hover REPAINTS, it never moves the pill: lifting the container would carry its
  // hit area out from under the cursor, fire pointerout, drop it back, and oscillate.
  c.on('pointerover', () => paint(true));
  c.on('pointerout', () => paint(false));
  c.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
    ev.stopPropagation();
    cfg.onTap();
  });
  // The caller often has to re-write the label live (a skip price drains with the
  // timer), so hand it back through the data manager rather than by index.
  c.setData('label', label);
  return c;
}

/** Width a pill needs for `label` at the skin's font size (plus padding). */
export function panelButtonWidth(scene: Phaser.Scene, label: string, hasIcon = false): number {
  const probe = scene.add
    .text(0, 0, label, { fontFamily: PANEL_SKIN.font, fontSize: `${PANEL_SKIN.button.fontSize}px`, fontStyle: 'bold' })
    .setVisible(false);
  const w = probe.width;
  probe.destroy();
  return Math.max(220, Math.ceil(w + 64 + (hasIcon ? 52 : 0)));
}
