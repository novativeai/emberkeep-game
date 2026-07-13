import Phaser from 'phaser';
import type { GameContext } from '../core/Context';
import { GAME_WIDTH, LIVE_GAME_HEIGHT, num, PALETTE } from '../core/Constants';
import { BeyondDemoPanel } from './BeyondDemoPanel';

const FONT = 'Trebuchet MS, Verdana, sans-serif';

/**
 * Full-screen overlays for the demo's two closing beats:
 *   • 'tutorial' — the original "thank you" card after the scripted tutorial.
 *   • 'chapter' — the Chapter One card at the Keeper-Level-3 finale: stats,
 *     three Chapter-Two teasers (silhouette slots for the art team), and
 *     KEEP PLAYING (the encore sandbox) / Play Again. A chapter ending, not
 *     a demo wall (DEMO-PLAN §THE FINALE).
 */
export class EndScreen extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, variant: 'tutorial' | 'chapter' = 'tutorial') {
    super(scene, 0, 0);

    const cx = GAME_WIDTH / 2;
    const cy = LIVE_GAME_HEIGHT / 2;
    const chapter = variant === 'chapter';
    const panelW = chapter ? 1360 : 1100;
    const panelH = chapter ? 1080 : 680;

    // Dim overlay
    const dim = scene.add
      .rectangle(cx, cy, GAME_WIDTH, LIVE_GAME_HEIGHT, num(PALETTE.night), 0.72)
      .setInteractive();
    this.add(dim);

    // Panel shadow + fill + border
    const g = scene.add.graphics();
    g.fillStyle(num(PALETTE.night), 0.22);
    g.fillRoundedRect(cx - panelW / 2 + 4, cy - panelH / 2 + 16, panelW, panelH, 52);
    g.fillStyle(num(PALETTE.cream), 1);
    g.fillRoundedRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH, 52);
    g.lineStyle(8, num(chapter ? PALETTE.gold : PALETTE.lava), 1);
    g.strokeRoundedRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH, 52);
    this.add(g);

    // Title lozenge
    const lo = scene.add.graphics();
    lo.fillStyle(num(chapter ? PALETTE.gold : PALETTE.lava), 1);
    lo.fillRoundedRect(cx - 420, cy - panelH / 2 - 52, 840, 104, 52);
    lo.lineStyle(6, num(PALETTE.cream), 1);
    lo.strokeRoundedRect(cx - 420, cy - panelH / 2 - 52, 840, 104, 52);
    this.add(lo);

    const title = scene.add
      .text(cx, cy - panelH / 2, chapter ? 'CHAPTER ONE COMPLETE' : 'Thank You, Keeper!', {
        fontFamily: FONT,
        fontSize: '52px',
        fontStyle: 'bold',
        color: chapter ? PALETTE.textBrown : PALETTE.white,
        shadow: { offsetX: 4, offsetY: 4, color: 'rgba(36,27,34,0.35)', fill: true }
      })
      .setOrigin(0.5);
    this.add(title);

    if (chapter) {
      this.buildChapterBody(scene, cx, cy, panelW, panelH);
    } else {
      const body = scene.add
        .text(cx, cy - 80, 'You have lit the first flame.\nYour dragons are stirring — Emberkeep awaits.', {
          fontFamily: FONT,
          fontSize: '38px',
          fontStyle: 'bold',
          color: PALETTE.textBrown,
          align: 'center',
          wordWrap: { width: 960 }
        })
        .setOrigin(0.5);
      this.add(body);
    }

    const btnY = cy + panelH / 2 - 130;
    this.addButton(scene, cx - 260, btnY, chapter ? 'Keep Playing' : 'Play Again', 'ui_btn_green', () => {
      if (chapter) this.destroy();
      else this.resetGame(scene);
    });
    this.addButton(scene, cx + 260, btnY, chapter ? 'Play Again' : 'Leave', 'ui_btn_play', () => {
      if (chapter) this.resetGame(scene);
      else this.destroy();
    });

    // Pop-in
    this.setScale(0.94);
    this.setAlpha(0);
    scene.tweens.add({
      targets: this,
      scale: 1,
      alpha: 1,
      duration: 170,
      ease: 'Back.easeOut'
    });
  }

  private buildChapterBody(
    scene: Phaser.Scene,
    cx: number,
    cy: number,
    _panelW: number,
    panelH: number
  ): void {
    const ctx = scene.registry.get('ctx') as GameContext;
    const top = cy - panelH / 2;

    const sub = scene.add
      .text(cx, top + 120, 'Cinder Hollow rekindled', {
        fontFamily: FONT,
        fontSize: '40px',
        fontStyle: 'bold',
        color: PALETTE.goldShade
      })
      .setOrigin(0.5);
    this.add(sub);

    // ---- Chapter stats row ----
    const stats: Array<[string, number]> = [
      ['Dragons hatched', ctx.state.stat('hatches')],
      ['Orders filled', ctx.state.completedOrderIds.length],
      ['Gold earned', ctx.state.stat('goldEarned')]
    ];
    stats.forEach(([label, value], i) => {
      const x = cx + (i - 1) * 380;
      const y = top + 240;
      const disc = scene.add.graphics();
      disc.fillStyle(num(PALETTE.gold), 0.16);
      disc.fillRoundedRect(x - 160, y - 56, 320, 112, 28);
      disc.lineStyle(4, num(PALETTE.gold), 0.6);
      disc.strokeRoundedRect(x - 160, y - 56, 320, 112, 28);
      this.add(disc);
      this.add(
        scene.add
          .text(x, y - 20, `${value}`, { fontFamily: FONT, fontSize: '48px', fontStyle: 'bold', color: PALETTE.textBrown })
          .setOrigin(0.5)
      );
      this.add(
        scene.add
          .text(x, y + 28, label, { fontFamily: FONT, fontSize: '26px', fontStyle: 'bold', color: PALETTE.goldShade })
          .setOrigin(0.5)
      );
    });

    // ---- "In Chapter Two" teasers ----
    this.add(
      scene.add
        .text(cx, top + 380, 'IN CHAPTER TWO…', {
          fontFamily: FONT,
          fontSize: '34px',
          fontStyle: 'bold',
          color: PALETTE.lavaShade
        })
        .setOrigin(0.5)
    );
    const teasers: Array<[string, string]> = [
      ['ui_teaser_terrace', 'The terrace past\nthe southern ash'],
      ['ui_teaser_breed', 'A breed no Keeper\nhas ever hatched'],
      ['ui_teaser_flame', 'What TOOK\nthe Great Flame']
    ];
    teasers.forEach(([texture, label], i) => {
      const x = cx + (i - 1) * 400;
      const y = top + 560;
      // Silhouette slot — dark card carrying the Chapter-Two teaser art.
      const card = scene.add.graphics();
      card.fillStyle(num(PALETTE.plumShade), 0.92);
      card.fillRoundedRect(x - 170, y - 130, 340, 260, 30);
      card.lineStyle(5, num(PALETTE.gold), 0.75);
      card.strokeRoundedRect(x - 170, y - 130, 340, 260, 30);
      this.add(card);
      if (scene.textures.exists(texture)) {
        // Full-bleed: the art ships at 680×520 (2× the slot) with the corner
        // radius pre-baked, so it seats exactly inside the card frame. The
        // caption overlays the art's dark lower region.
        const art = scene.add.image(x, y, texture).setDisplaySize(340, 260);
        this.add(art);
      } else {
        // Art missing (fresh clone without the generated files) — the '?' holds.
        this.add(
          scene.add
            .text(x, y - 46, '?', { fontFamily: FONT, fontSize: '96px', fontStyle: 'bold', color: PALETTE.goldAccent })
            .setOrigin(0.5)
            .setAlpha(0.85)
        );
      }
      this.add(
        scene.add
          .text(x, y + 88, label, {
            fontFamily: FONT,
            fontSize: '26px',
            fontStyle: 'bold',
            color: PALETTE.cream,
            align: 'center',
            lineSpacing: 6
          })
          .setOrigin(0.5)
          .setShadow(0, 3, 'rgba(36,27,34,0.85)', 6)
      );
    });

    // "Beyond the demo" — a one-page roadmap popup (worlds + legends). Falls
    // back to the plain teaser line when the preview art isn't present.
    if (scene.textures.exists('trailer_world_ice') || scene.textures.exists('trailer_legend_frost')) {
      const btn = scene.add.container(cx, top + 764);
      const g = scene.add.graphics();
      g.fillStyle(num(PALETTE.lava), 1);
      g.fillRoundedRect(-330, -44, 660, 88, 44);
      g.lineStyle(5, num(PALETTE.gold), 1);
      g.strokeRoundedRect(-330, -44, 660, 88, 44);
      const label = scene.add
        .text(0, -2, "SEE WHAT'S BEYOND THE DEMO", {
          fontFamily: FONT, fontSize: '32px', fontStyle: 'bold', color: PALETTE.cream
        })
        .setOrigin(0.5)
        .setShadow(0, 3, 'rgba(36,27,34,0.6)', 4);
      btn.add([g, label]);
      btn.setSize(660, 88).setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setScale(1.04));
      btn.on('pointerout', () => btn.setScale(1));
      btn.on('pointerup', () => {
        const panel = new BeyondDemoPanel(scene);
        panel.setDepth(this.depth + 10);
      });
      scene.tweens.add({
        targets: btn, scale: { from: 1, to: 1.03 }, duration: 700,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
      });
      this.add(btn);
    } else {
      this.add(
        scene.add
          .text(cx, top + 760, 'The story pauses here — Chapter Two is coming.', {
            fontFamily: FONT,
            fontSize: '30px',
            fontStyle: 'bold',
            color: PALETTE.textBrown
          })
          .setOrigin(0.5)
      );
    }
  }

  private addButton(
    scene: Phaser.Scene,
    x: number,
    y: number,
    label: string,
    texture: string,
    onTap: () => void
  ): void {
    const img = scene.add.image(x, y, texture).setScale(0.9);
    const text = scene.add
      .text(x, y, label, {
        fontFamily: FONT,
        fontSize: '46px',
        fontStyle: 'bold',
        color: PALETTE.white,
        shadow: { offsetX: 4, offsetY: 4, color: 'rgba(36,27,34,0.5)', fill: true }
      })
      .setOrigin(0.5);
    img.setInteractive({ useHandCursor: true }).on('pointerdown', onTap);
    img.on('pointerover', () => scene.tweens.add({ targets: img, scale: 0.94, duration: 110 }));
    img.on('pointerout', () => scene.tweens.add({ targets: img, scale: 0.9, duration: 110 }));
    this.add(img);
    this.add(text);
  }

  private resetGame(scene: Phaser.Scene): void {
    const ctx = scene.registry.get('ctx') as GameContext;
    ctx.bus.emit('game:reset_requested', {});
  }
}
