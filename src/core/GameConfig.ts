import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, num, PALETTE } from './Constants';
import { renderScale } from './render-scale';
import { BoardScene } from '../scenes/BoardScene';
import { BootScene } from '../scenes/BootScene';
import { PreloadScene } from '../scenes/PreloadScene';
import { TitleScene } from '../scenes/TitleScene';
import { UIScene } from '../scenes/UIScene';

/**
 * Supersample factor: the coordinate space is fixed at 2560×1600, so to render
 * crisply on high-DPI / large displays we paint that space into a LARGER backing
 * (every camera is zoomed by this factor — see the scenes). Capped at ~4K width so
 * a weak GPU on a big screen stays playable; 1 on standard displays (no change, so
 * the e2e + low-end hardware run exactly as before). In FIT mode the canvas backing
 * equals the config width/height, hence we scale those.
 */
export function createGameConfig(parent: string): Phaser.Types.Core.GameConfig {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  // Backing needed to match the device pixels the FIT canvas spans, in game-units.
  const need = Math.min(
    (window.innerWidth * dpr) / GAME_WIDTH,
    (window.innerHeight * dpr) / GAME_HEIGHT
  );
  // Quantise to 1/8 steps (keeps 2560×1600 × R integral) and clamp to [1, 1.5] →
  // 1440p backing on standard displays, up to ~4K (3840×2400) on retina/4K.
  renderScale.value = Phaser.Math.Clamp(Math.round(need * 8) / 8, 1, 1.5);

  return {
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH * renderScale.value,
    height: GAME_HEIGHT * renderScale.value,
    // Transparent canvas: the authored backdrop is painted in-canvas + as the page
    // background (index.html). backgroundColor is the fallback if transparency is
    // ignored.
    transparent: true,
    backgroundColor: num(PALETTE.tealDeep),
    banner: false,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    render: {
      // antialias = LINEAR texture filtering (smooth when the camera scales sprites
      // — without it, NEAREST makes everything look harsh/low-res). antialiasGL is
      // the heavy MSAA render target that fails to allocate on some drivers ("blank
      // screen"); keep THAT off. So: smooth filtering, no MSAA.
      antialias: true,
      antialiasGL: false,
      roundPixels: true,
      // Don't refuse a software/low-power GL context — better a slow board than
      // a blank one on machines without a strong GPU.
      failIfMajorPerformanceCaveat: false,
      powerPreference: 'low-power'
    },
    scene: [BootScene, PreloadScene, TitleScene, BoardScene, UIScene]
  };
}
