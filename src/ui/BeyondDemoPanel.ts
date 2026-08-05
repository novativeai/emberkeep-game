import Phaser from 'phaser';
import { GAME_WIDTH, LIVE_GAME_HEIGHT, num, PALETTE, WORLD_TELEPORTS } from '../core/Constants';
import { editorStore } from '../editor/editorStore';

const FONT = 'Trebuchet MS, Verdana, sans-serif';
const PANEL_W = 2240;
const PANEL_H = 1400;

/**
 * "Beyond the demo" — a single-page roadmap popup on the chapter card: the
 * first two of the five new worlds (ice + crystal vistas) and the five
 * legendary dragons, with plain what's-coming copy. Tap outside or ✕ closes.
 * Every visual degrades cleanly if its texture is missing (fresh clones).
 */
export class BeyondDemoPanel extends Phaser.GameObjects.Container {
  /** Stable lookup name — the e2e waits for THIS to appear rather than sleeping
   *  through the finale (class names are minified in the production build, so a
   *  constructor-name probe would not survive it). Part of the instrumentation
   *  contract; keep it when refactoring. */
  static readonly NAME = 'beyond-demo-panel';

  constructor(scene: Phaser.Scene) {
    super(scene, GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2);
    this.setName(BeyondDemoPanel.NAME);

    const dim = scene.add
      .rectangle(0, 0, GAME_WIDTH, LIVE_GAME_HEIGHT, 0x06050a, 0.82)
      .setInteractive();
    dim.on('pointerup', () => this.close());
    this.add(dim);

    // Dark plum board — the vistas and gold-rimmed silhouettes pop on it.
    const panel = scene.add.graphics();
    panel.fillStyle(num(PALETTE.night), 0.4);
    panel.fillRoundedRect(-PANEL_W / 2 + 6, -PANEL_H / 2 + 18, PANEL_W, PANEL_H, 48);
    panel.fillStyle(num(PALETTE.plumShade), 1);
    panel.fillRoundedRect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, 48);
    panel.lineStyle(7, num(PALETTE.gold), 1);
    panel.strokeRoundedRect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, 48);
    // Block taps on the board from falling through to the dim's close.
    panel.setInteractive(
      new Phaser.Geom.Rectangle(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H),
      Phaser.Geom.Rectangle.Contains
    );
    this.add(panel);

    const top = -PANEL_H / 2;

    // Header.
    this.add(
      scene.add
        .text(0, top + 84, 'BEYOND THE DEMO', {
          fontFamily: FONT, fontSize: '64px', fontStyle: 'bold', color: PALETTE.goldAccent
        })
        .setOrigin(0.5)
        .setShadow(0, 4, 'rgba(0,0,0,0.6)', 8)
    );
    this.add(
      scene.add
        .text(0, top + 150, "What's planned for the full game", {
          fontFamily: FONT, fontSize: '32px', fontStyle: 'bold', color: PALETTE.cream
        })
        .setOrigin(0.5)
        .setAlpha(0.85)
    );

    // ---- Section: 5 new worlds (the first two, previewed). ----
    this.add(
      scene.add
        .text(0, top + 232, '5 NEW WORLDS  —  the first two:', {
          fontFamily: FONT, fontSize: '34px', fontStyle: 'bold', color: PALETTE.gold
        })
        .setOrigin(0.5)
    );
    // Each card enters an actual editor world when one exists (roothold / borealis) —
    // "je dois pouvoir switcher dans le monde quand je clique". The card is a real
    // portal only if its target map is present.
    // The target is matched to the art the card SHOWS, not to the order of the
    // WORLD_TELEPORTS array: borealis IS the aurora/ice world and roothold is the
    // crystal-lit root lair. Indexing the array positionally sent the ICE card to
    // roothold and hid borealis behind CRYSTAL — the player tapped ice and landed
    // in the lava lair.
    const worldByName = (name: string): string | undefined =>
      WORLD_TELEPORTS.find((w) => w.toWorld === name)?.toWorld;
    this.worldCard(scene, -545, top + 490, 'trailer_world_ice', 'ICE WORLD', 'The Frozen Reaches', worldByName('borealis'));
    this.worldCard(scene, 545, top + 490, 'trailer_world_crystal', 'CRYSTAL WORLD', 'The Crystal Depths', worldByName('roothold'));

    // ---- Section: 5 legendary dragons. ----
    this.add(
      scene.add
        .text(0, top + 812, '5 LEGENDARY DRAGONS TO AWAKEN', {
          fontFamily: FONT, fontSize: '34px', fontStyle: 'bold', color: PALETTE.gold
        })
        .setOrigin(0.5)
    );
    const legends = [
      'trailer_legend_frost',
      'trailer_legend_crystal',
      'trailer_legend_storm',
      'trailer_legend_tide',
      'trailer_legend_shadow'
    ].filter((k) => scene.textures.exists(k));
    const spread = 400;
    const x0 = (-spread * (legends.length - 1)) / 2;
    legends.forEach((key, i) => {
      const img = scene.add.image(x0 + i * spread, top + 1010, key).setScale(0.6);
      this.add(img);
    });
    if (legends.length === 0) {
      this.add(
        scene.add
          .text(0, top + 1010, 'One awakened. Four still sleep.', {
            fontFamily: FONT, fontSize: '30px', fontStyle: 'bold', color: PALETTE.cream
          })
          .setOrigin(0.5)
      );
    }

    // ---- Footer: the rest of the roadmap, stated plainly. ----
    this.add(
      scene.add
        .text(0, top + 1210, 'Plus: new merge chains  ·  more orders for the Ledger  ·  the rest of the Great Flame story', {
          fontFamily: FONT, fontSize: '30px', fontStyle: 'bold', color: PALETTE.cream, align: 'center',
          wordWrap: { width: PANEL_W - 240 }
        })
        .setOrigin(0.5)
        .setAlpha(0.9)
    );

    // Close button.
    const close = scene.add.container(PANEL_W / 2 - 28, top + 28);
    const closeBg = scene.add.circle(0, 0, 44, num(PALETTE.lava)).setStrokeStyle(6, num(PALETTE.cream));
    const closeX = scene.add
      .text(0, -2, '✕', { fontFamily: FONT, fontSize: '44px', fontStyle: 'bold', color: PALETTE.cream })
      .setOrigin(0.5);
    close.add([closeBg, closeX]);
    close.setSize(100, 100).setInteractive({ useHandCursor: true });
    close.on('pointerup', () => this.close());
    this.add(close);

    scene.add.existing(this);
    this.setAlpha(0).setScale(0.94);
    scene.tweens.add({ targets: this, alpha: 1, scale: 1, duration: 220, ease: 'Back.easeOut' });
  }

  /** A framed, rounded world preview with its name plate. Skipped (placeholder
   *  plate only) when the vista texture is missing. */
  private worldCard(
    scene: Phaser.Scene,
    x: number,
    y: number,
    key: string,
    title: string,
    subtitle: string,
    worldName?: string
  ): void {
    const W = 1010;
    const H = 430;
    // A real portal when its target editor world exists — tap to travel there.
    const portal = !!worldName && !!editorStore.mapByName(worldName);
    const frame = scene.add.graphics();
    frame.fillStyle(num(PALETTE.night), 1);
    frame.fillRoundedRect(x - W / 2, y - H / 2, W, H, 28);
    frame.lineStyle(5, num(PALETTE.gold), 0.9);
    frame.strokeRoundedRect(x - W / 2, y - H / 2, W, H, 28);
    this.add(frame);
    if (portal) {
      // A generous, centred hit rect over the card; a tap enters the world + closes.
      frame.setInteractive(new Phaser.Geom.Rectangle(x - W / 2, y - H / 2, W, H), Phaser.Geom.Rectangle.Contains);
      frame.on('pointerover', () => this.scene.game.canvas && (this.scene.game.canvas.style.cursor = 'pointer'));
      frame.on('pointerout', () => this.scene.game.canvas && (this.scene.game.canvas.style.cursor = 'default'));
      frame.on('pointerup', () => {
        scene.events.emit('beyond:pick_world', worldName); // UIScene → world:switch
        this.close();
      });
    }

    if (scene.textures.exists(key)) {
      const img = scene.add.image(this.x + x, this.y + y, key);
      const cover = Math.max(W / img.width, H / img.height);
      img.setScale(cover);
      // Geometry mask needs WORLD coordinates — the panel is centred and static.
      const maskShape = scene.make.graphics({});
      maskShape.fillStyle(0xffffff);
      maskShape.fillRoundedRect(this.x + x - W / 2, this.y + y - H / 2, W, H, 28);
      img.setMask(maskShape.createGeometryMask());
      img.setPosition(0, 0); // container-local after the mask capture
      img.x = x;
      img.y = y;
      this.add(img);
    }

    // Name plate along the card's bottom edge.
    const plate = scene.add.graphics();
    plate.fillStyle(num(PALETTE.night), 0.82);
    plate.fillRoundedRect(x - W / 2 + 14, y + H / 2 - 96, W - 28, 82, 20);
    this.add(plate);
    this.add(
      scene.add
        .text(x, y + H / 2 - 72, title, {
          fontFamily: FONT, fontSize: '30px', fontStyle: 'bold', color: PALETTE.goldAccent
        })
        .setOrigin(0.5)
    );
    this.add(
      scene.add
        .text(x, y + H / 2 - 36, subtitle, {
          fontFamily: FONT, fontSize: '26px', fontStyle: 'bold', color: PALETTE.cream
        })
        .setOrigin(0.5)
        .setAlpha(0.85)
    );
    // "▶ ENTER" pill (top-right) marks a card you can actually travel into.
    if (portal) {
      const bx = x + W / 2 - 96;
      const by = y - H / 2 + 40;
      const pill = scene.add.graphics();
      pill.fillStyle(num(PALETTE.goldShade), 0.95);
      pill.fillRoundedRect(bx - 78, by - 26, 156, 52, 26);
      this.add(pill);
      this.add(
        scene.add
          .text(bx, by, '▶ ENTER', { fontFamily: FONT, fontSize: '26px', fontStyle: 'bold', color: PALETTE.cream })
          .setOrigin(0.5)
      );
    }
  }

  private close(): void {
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scale: 0.95,
      duration: 160,
      ease: 'Sine.easeIn',
      onComplete: () => this.destroy()
    });
  }
}
