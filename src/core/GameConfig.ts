import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, num, PALETTE } from './Constants';
import { BoardScene } from '../scenes/BoardScene';
import { BootScene } from '../scenes/BootScene';
import { PreloadScene } from '../scenes/PreloadScene';
import { TitleScene } from '../scenes/TitleScene';
import { UIScene } from '../scenes/UIScene';

export function createGameConfig(parent: string): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: num(PALETTE.tealDeep),
    banner: false,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    render: {
      antialias: true,
      roundPixels: false
    },
    scene: [BootScene, PreloadScene, TitleScene, BoardScene, UIScene]
  };
}
