import Phaser from 'phaser';
import { TIMINGS } from '../core/Constants';

/** Shared tween vocabulary — nothing in Emberkeep teleports. */

export function popIn(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.AlphaSingle,
  options: { delay?: number; scale?: number; duration?: number } = {}
): Phaser.Tweens.Tween {
  const finalScale = options.scale ?? 1;
  target.setScale(0.05);
  target.setAlpha(0);
  return scene.tweens.add({
    targets: target,
    scale: finalScale,
    alpha: 1,
    delay: options.delay ?? 0,
    duration: options.duration ?? TIMINGS.spawnPop,
    ease: 'Back.easeOut'
  });
}

export function scalePulse(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Components.Transform,
  amount = 1.18,
  duration = 140
): Phaser.Tweens.Tween {
  const base = target.scale;
  return scene.tweens.add({
    targets: target,
    scale: base * amount,
    duration,
    yoyo: true,
    ease: 'Sine.easeOut'
  });
}

/** Parabolic hop from the current position to (x,y) — used by harvest spawns. */
export function hopTo(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Components.Transform,
  x: number,
  y: number,
  options: { height?: number; duration?: number; onComplete?: () => void } = {}
): void {
  const fromX = target.x;
  const fromY = target.y;
  const height = options.height ?? 34;
  const proxy = { t: 0 };
  scene.tweens.add({
    targets: proxy,
    t: 1,
    duration: options.duration ?? TIMINGS.harvestHop,
    ease: 'Sine.easeInOut',
    onUpdate: () => {
      const t = proxy.t;
      target.setPosition(
        fromX + (x - fromX) * t,
        fromY + (y - fromY) * t - Math.sin(t * Math.PI) * height
      );
    },
    onComplete: options.onComplete
  });
}

/** Gentle infinite hover used by tutorial arrows / hands. */
export function hoverBob(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Components.Transform,
  distance = 9,
  duration = 460
): Phaser.Tweens.Tween {
  return scene.tweens.add({
    targets: target,
    y: target.y + distance,
    duration,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut'
  });
}

export function fadeInOut(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Components.AlphaSingle,
  peak: number,
  inMs: number,
  holdMs: number,
  outMs: number,
  onDone?: () => void
): void {
  scene.tweens.add({
    targets: target,
    alpha: peak,
    duration: inMs,
    ease: 'Sine.easeOut',
    onComplete: () => {
      scene.tweens.add({
        targets: target,
        alpha: 0,
        delay: holdMs,
        duration: outMs,
        ease: 'Sine.easeIn',
        onComplete: onDone
      });
    }
  });
}
