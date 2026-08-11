import Phaser from 'phaser';
import { GAME_WIDTH, IS_LOW_END, IS_MOBILE, LIVE_GAME_HEIGHT, num, PALETTE, POWER } from './Constants';
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
  // Cap the device-pixel-ratio: a 3×-DPR phone otherwise backs the framebuffer at
  // full device pixels (the #1 GPU-memory + fill-rate hog). Weak devices cap at 2,
  // others at 3 — oversampling a 3× panel down to 2×-equivalent is invisible (the
  // fixed 2560 space already downsamples heavily) but reclaims a lot of framebuffer.
  const rawDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const dpr = Math.min(rawDpr, IS_LOW_END ? 2 : 3);
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
  // at 1 (crisp 1440p backing, up to ~4K on retina). Capable mobile floors at 0.75.
  // WEAK devices (IS_LOW_END: cheap Android, iOS, GPU-less/old PC) floor much lower
  // AND never supersample above device pixels (cap 1) — the framebuffer is the #1
  // GPU-memory hog, so tracking (or under-cutting) device pixels is what keeps the
  // tab from the "A problem repeatedly occurred" / blank-screen crash.
  const floor = IS_LOW_END ? 0.34 : IS_MOBILE ? 0.75 : 1;
  const cap = IS_LOW_END ? 1 : 1.5;
  // …and a HARD driver ceiling on top of both. An old GPU's MAX_TEXTURE_SIZE is
  // 4096, and a backing axis past it is silently CLIPPED by the driver: the canvas
  // renders partial or blank while the DOM logo still shows, which reads as "the
  // Play button disappeared". Portrait is the tall axis (LIVE_GAME_HEIGHT up to
  // 2.4×2560 = 6144 game-units; ×0.75 floor = 4608 > 4096 on 20:9 phones), so the
  // floor itself has to yield to it. Quantised DOWN to 1/8 so the backing stays
  // integral; desktop (1600 tall) never reaches it.
  //
  // This is a DIFFERENT protection from IS_LOW_END above, not a replacement: a weak
  // device can sit under 4096 and still run out of VRAM. Both apply, strictest wins.
  const gpuCap = Math.floor((4096 / Math.max(GAME_WIDTH, LIVE_GAME_HEIGHT)) * 8) / 8;
  renderScale.value = Phaser.Math.Clamp(
    Math.round(need * 8) / 8,
    Math.min(floor, gpuCap),
    Math.min(cap, gpuCap)
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
    // Boot WITH a limit so TimeStep binds its limit-aware step: PowerGovernor
    // retunes the cap live (62 active / 30 idle / 15 doze) to spare batteries.
    // 62 (not 60) so a 60 Hz display renders every vsync — see POWER.
    fps: {
      limit: POWER.activeFps
    },
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
