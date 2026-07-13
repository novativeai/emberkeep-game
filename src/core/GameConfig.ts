import Phaser from 'phaser';
import { GAME_WIDTH, IS_IOS, IS_MOBILE, LIVE_GAME_HEIGHT, num, PALETTE } from './Constants';
import { renderScale } from './render-scale';
import { BoardScene } from '../scenes/BoardScene';
import { BootScene } from '../scenes/BootScene';
import { PreloadScene } from '../scenes/PreloadScene';
import { TitleScene } from '../scenes/TitleScene';
import { UiEditorScene } from '../scenes/UiEditorScene';
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
  // On mobile the game is PORTRAIT: width = the phone's SHORT side, height = long,
  // regardless of how the device is currently held.
  const dispW = IS_MOBILE ? Math.min(window.innerWidth, window.innerHeight) : window.innerWidth;
  const dispH = IS_MOBILE ? Math.max(window.innerWidth, window.innerHeight) : window.innerHeight;
  // Backing needed to match the device pixels the FIT canvas spans, in game-units.
  const need = Math.min(
    (dispW * dpr) / GAME_WIDTH,
    (dispH * dpr) / LIVE_GAME_HEIGHT
  );
  // Quantise to 1/8 steps (keeps 2560×1600 × R integral) and clamp. Desktop floors
  // at 1 (crisp 1440p backing, up to ~4K on retina). The portrait mobile canvas is
  // ~2× taller, so a lower floor keeps the backing off a phone GPU's limit
  // (~14M px at floor 1) while staying device-crisp. iOS's renderer-process memory
  // budget is far tighter than Android's, so it floors lower still — at floor 0.75
  // a hi-DPI iPhone SUPERSAMPLES well past its own screen (need≈0.46), needlessly
  // inflating GPU memory into the WebKit crash zone; 0.5 tracks device pixels.
  const floor = IS_IOS ? 0.5 : IS_MOBILE ? 0.75 : 1;
  // GPU ceiling: old-device MAX_TEXTURE_SIZE is 4096 — a backing axis past it
  // gets silently clipped by the driver (the canvas renders partial/blank while
  // the DOM logo still shows, so the title's Play button "disappears"). The
  // portrait backing is the tall axis (LIVE_GAME_HEIGHT up to 2.4×2560 = 6144
  // game-units; ×0.75 floor = 4608 > 4096 on 20:9 phones). Quantised DOWN to
  // 1/8 so the backing stays integral; desktop (1600-tall) is untouched.
  const gpuCap = Math.floor(((4096 / Math.max(GAME_WIDTH, LIVE_GAME_HEIGHT)) * 8)) / 8;
  renderScale.value = Phaser.Math.Clamp(
    Math.round(need * 8) / 8,
    Math.min(floor, gpuCap),
    Math.min(1.5, gpuCap)
  );

  return {
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH * renderScale.value,
    height: LIVE_GAME_HEIGHT * renderScale.value,
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
    scene: [BootScene, PreloadScene, TitleScene, BoardScene, UIScene, UiEditorScene]
  };
}
