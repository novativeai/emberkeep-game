import Phaser from 'phaser';
import { TextureFactory } from '../art/TextureFactory';
import type { GameContext } from '../core/Context';
import { SCENES } from '../core/Constants';

/**
 * Generates every placeholder texture (Track A) straight into the texture
 * manager, then hands over to PreloadScene which loads any real art files
 * declared in assets.json.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENES.boot);
  }

  create(): void {
    const ctx = this.registry.get('ctx') as GameContext;
    const factory = new TextureFactory(this);
    factory.generateAll(ctx.data.assets);
    this.registry.set('textureFactory', factory);
    this.scene.start(SCENES.preload);
  }
}
