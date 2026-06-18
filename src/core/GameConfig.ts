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
    // Transparent canvas: the water photo is a CSS background on #game (cheap —
    // composited by the browser, no GPU texture, no per-frame work). The board
    // leaves its backdrop unpainted so the water shows through; the Title paints
    // its own sky. backgroundColor is the fallback if transparency is ignored.
    transparent: true,
    backgroundColor: num(PALETTE.tealDeep),
    banner: false,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    render: {
      // antialias:true forces a MULTISAMPLED render target, which is heavy on
      // weak GPUs and outright fails to allocate on some drivers/spoofed
      // contexts ("Framebuffer status: 0" → blank screen). Off = lighter + more
      // compatible; roundPixels keeps sprites crisp without MSAA.
      antialias: false,
      roundPixels: true,
      // Don't refuse a software/low-power GL context — better a slow board than
      // a blank one on machines without a strong GPU.
      failIfMajorPerformanceCaveat: false,
      powerPreference: 'low-power'
      // (no mipmapFilter → Phaser skips generateMipmap, which was warning on the
      //  non-power-of-two art textures.)
    },
    scene: [BootScene, PreloadScene, TitleScene, BoardScene, UIScene]
  };
}
