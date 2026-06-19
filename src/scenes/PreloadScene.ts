import Phaser from 'phaser';
import type { TextureFactory } from '../art/TextureFactory';
import type { GameContext } from '../core/Context';
import { GAME_HEIGHT, GAME_WIDTH, num, PALETTE, SCENES } from '../core/Constants';
import { renderScale } from '../core/render-scale';

/**
 * Loads real-art files for any assets.json entry flipped to source:"file"
 * (from assets/, the Vite public dir). A failed file falls back to its
 * generated placeholder so the build never blocks on art.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super(SCENES.preload);
  }

  preload(): void {
    this.cameras.main.setOrigin(0).setZoom(renderScale.value); // hi-DPI backing for the loading bar
    const ctx = this.registry.get('ctx') as GameContext;
    const factory = this.registry.get('textureFactory') as TextureFactory;

    const fileEntries = ctx.data.assets.images.filter((e) => e.source === 'file' && e.file);
    if (fileEntries.length > 0) {
      const barBg = this.add
        .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 360, 18, num(PALETTE.plumShade), 0.9)
        .setStrokeStyle(2, num(PALETTE.gold));
      const bar = this.add.rectangle(
        GAME_WIDTH / 2 - 176,
        GAME_HEIGHT / 2,
        4,
        10,
        num(PALETTE.gold)
      );
      bar.setOrigin(0, 0.5);
      this.load.on('progress', (value: number) => bar.setSize(4 + 348 * value, 10));
      this.load.on('complete', () => {
        barBg.destroy();
        bar.destroy();
      });
      this.load.on('loaderror', (file: Phaser.Loader.File) => {
        factory.generate(file.key);
      });
      for (const entry of fileEntries) {
        this.load.image(entry.key, entry.file as string);
      }
    }
  }

  create(): void {
    this.scene.start(SCENES.title);
  }
}
