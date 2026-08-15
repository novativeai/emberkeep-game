import Phaser from 'phaser';
import { FONT, INK, TYPE } from '../art/design';
import { LIVE_GAME_HEIGHT, LIVE_GAME_WIDTH, num, REVEAL } from '../core/Constants';
import type { GameContext } from '../core/Context';
import type { EventBus } from '../core/EventBus';
import { ensureTextures as ensureFileTextures } from '../core/lazyTextures';

/**
 * The full-screen card a player is shown the first time a dragon form is theirs.
 *
 * It is a CARD, not a scene: it lives inside UIScene at the top of its depth
 * stack, so the board keeps rendering underneath and gets dimmed rather than
 * replaced. That is the whole feeling — the isle is still there, you just can't
 * look at anything else for a moment.
 *
 * Fired by `dragon:revealed` (RevealSystem owns the once-per-save latch), and it
 * only ever draws. Anything it knows about timing lives in `REVEAL`.
 *
 * Two things it deliberately does NOT do:
 *   - block the tutorial. A card thrown over a scripted beat eats the tap that
 *     beat is waiting for, so while the tutorial is running the reveal is
 *     QUEUED and played the moment the game is handed over.
 *   - hold the frame open. It lets go by itself after `holdMs`; the tap is a
 *     skip, not a dismiss the player has to find.
 */

const RAY_KEY = 'fx_reveal_rays';
const GLOW_KEY = 'fx_reveal_glow';
/** Above every panel and dialog UIScene owns. */
export const DEPTH_REVEAL = 400;

function ensureTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(GLOW_KEY)) {
    // A soft radial bloom the animal stands in front of. Painted small and
    // stretched — it is pure falloff, so the low source resolution never shows.
    const tex = scene.textures.createCanvas(GLOW_KEY, 256, 256);
    if (tex) {
      const c = tex.getContext();
      const g = c.createRadialGradient(128, 128, 0, 128, 128, 128);
      g.addColorStop(0, 'rgba(255,236,190,0.95)');
      g.addColorStop(0.35, 'rgba(255,168,72,0.42)');
      g.addColorStop(0.72, 'rgba(232,80,60,0.14)');
      g.addColorStop(1, 'rgba(232,80,60,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 256, 256);
      tex.refresh();
    }
  }
  if (!scene.textures.exists(RAY_KEY)) {
    // A godray disc: wedges that fade out toward the rim, drawn once and spun
    // slowly behind the plate. Spinning a texture costs one matrix; emitting
    // rays as particles would cost hundreds of quads for the same look.
    const S = 512;
    const tex = scene.textures.createCanvas(RAY_KEY, S, S);
    if (tex) {
      const c = tex.getContext();
      const rays = 18;
      c.translate(S / 2, S / 2);
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2;
        const half = (Math.PI / rays) * (i % 2 === 0 ? 0.5 : 0.26);
        const g = c.createRadialGradient(0, 0, S * 0.06, 0, 0, S * 0.5);
        g.addColorStop(0, 'rgba(255,232,180,0.55)');
        g.addColorStop(0.55, 'rgba(255,190,110,0.2)');
        g.addColorStop(1, 'rgba(255,170,90,0)');
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(0, 0);
        c.arc(0, 0, S * 0.5, a - half, a + half);
        c.closePath();
        c.fill();
      }
      tex.refresh();
    }
  }
}

export interface RevealCard {
  chain: string;
  tier: number;
  art: string;
  name: string;
  epithet: string;
}

export class DragonReveal {
  private layer: Phaser.GameObjects.Container | null = null;
  private timers: Phaser.Time.TimerEvent[] = [];
  private tweens: Phaser.Tweens.Tween[] = [];
  /** ms the open card has been up — the tap-to-skip gate reads it. */
  private elapsed = 0;

  constructor(
    private scene: Phaser.Scene,
    private bus: EventBus,
    private ctx: GameContext
  ) {
    ensureTextures(scene);
  }

  get isOpen(): boolean {
    return this.layer !== null;
  }

  /**
   * Plays WHERE IT HAPPENS, including mid-tutorial.
   *
   * It used to be held back until the tutorial handed the game over, so the
   * chapter's one dragon reveal — the whelp coming out of three Dragon Rubies —
   * fired minutes later, over the Golden Altar, attached to nothing the player
   * had just done. A card that celebrates a moment has to arrive during it.
   *
   * Safe to interrupt a script with: it is modal for its own three seconds,
   * skippable on a tap, and closes itself. BoardScene holds the hatchling back
   * while it is up (`ui:reveal_toggled`), so the card is the introduction and
   * the board is where she lands afterwards.
   */
  play(card: RevealCard): void {
    if (this.layer) this.close(true);
    // The plate is fetched HERE, not at boot. The sixteen reveal plates are
    // 72.6 MB decoded between them and exactly one is ever shown per hatch, so
    // preloading the set cost iOS its renderer process for art it would never
    // draw. `ensureTextures` calls back synchronously when the plate is already
    // resident, so a warm card still opens on the same frame as before.
    if (!this.scene.textures.exists(card.art)) {
      ensureFileTextures(this.scene, this.ctx, [card.art], () => {
        // Only if nothing else opened in the meantime — a hatch during a hatch
        // would otherwise reopen the first card over the second.
        if (!this.layer && this.scene.textures.exists(card.art)) this.play(card);
      });
      return;
    }

    this.elapsed = 0;
    const cx = LIVE_GAME_WIDTH / 2;
    const cy = LIVE_GAME_HEIGHT * REVEAL.plateCentreFrac;
    const layer = this.scene.add.container(0, 0).setDepth(DEPTH_REVEAL);
    this.layer = layer;

    // 1. The board goes dim, not away.
    const scrim = this.scene.add
      .rectangle(0, 0, LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT, num(INK.scrim), 1)
      .setOrigin(0)
      .setAlpha(0)
      .setInteractive();
    scrim.on('pointerup', () => this.skip());
    layer.add(scrim);
    this.tween({ targets: scrim, alpha: REVEAL.scrimAlpha, duration: REVEAL.scrimMs });

    // 3a. Size the animal FIRST — everything behind it is measured off it.
    //
    // Fit on BOTH axes, not just height. On mobile the viewport is portrait and
    // up to 2.4x as tall as it is wide, so a height-only fit sends a
    // wings-spread adult straight off both sides of the screen.
    const plate = this.scene.add.image(cx, cy, card.art).setAlpha(0);
    const target = Math.min(
      (LIVE_GAME_HEIGHT * REVEAL.plateHeightFrac) / plate.height,
      (LIVE_GAME_WIDTH * REVEAL.plateWidthFrac) / plate.width
    );
    const shown = plate.height * target;

    // 2. Rays and bloom, behind everything, sized off the ANIMAL rather than
    // the viewport, so the burst frames it the same way on every aspect.
    const rays = this.scene.add
      .image(cx, cy, RAY_KEY)
      .setAlpha(0)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(shown * 2.05, shown * 2.05);
    const glow = this.scene.add
      .image(cx, cy, GLOW_KEY)
      .setAlpha(0)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(shown * 1.6, shown * 1.6);
    layer.add([rays, glow]);
    this.tween({ targets: rays, alpha: REVEAL.rayAlpha, duration: 520, delay: 120 });
    this.tween({ targets: glow, alpha: 0.85, duration: 420, delay: 60 });
    this.tween({
      targets: rays, angle: 360, duration: (360 / REVEAL.raySpin) * 1000,
      repeat: -1, ease: 'Linear'
    });

    // 3b. The animal, flying up into place with one overshoot.
    plate.setScale(target * REVEAL.plateFromScale);
    plate.y = cy + REVEAL.plateFromY;
    layer.add(plate);
    this.tween({
      targets: plate, alpha: 1, y: cy, scale: target,
      duration: REVEAL.plateInMs, ease: 'Back.easeOut', delay: 120
    });

    // 4. The hit: a white flash, a shove of sparks, and the camera kicks.
    this.after(REVEAL.roarAtMs, () => {
      const flash = this.scene.add
        .rectangle(0, 0, LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT, 0xffffff, 0.55)
        .setOrigin(0)
        .setBlendMode(Phaser.BlendModes.ADD);
      layer.add(flash);
      this.tween({
        targets: flash, alpha: 0, duration: 420, ease: 'Quad.easeOut',
        onComplete: () => flash.destroy()
      });
      const sparks = this.scene.add
        .particles(cx, cy, 'fx_spark', {
          speed: { min: 380, max: 1150 }, angle: { min: 0, max: 360 },
          lifespan: { min: 620, max: 1250 }, scale: { start: 1.25, end: 0 },
          alpha: { start: 1, end: 0 }, quantity: 0, emitting: false,
          blendMode: Phaser.BlendModes.ADD
        })
        .setDepth(-1);
      layer.add(sparks);
      sparks.explode(64);
      // A slow updraft of embers keeps the card alive while it holds.
      const embers = this.scene.add.particles(cx, LIVE_GAME_HEIGHT + 40, 'fx_spark', {
        x: { min: -LIVE_GAME_WIDTH * 0.34, max: LIVE_GAME_WIDTH * 0.34 },
        speedY: { min: -260, max: -90 }, speedX: { min: -40, max: 40 },
        lifespan: { min: 1600, max: 2800 }, scale: { start: 0.5, end: 0 },
        alpha: { start: 0.85, end: 0 }, frequency: 70, blendMode: Phaser.BlendModes.ADD
      });
      layer.add(embers);
      this.scene.cameras.main.shake(260, 0.006);
    });

    // 5. The name, rising once the animal has landed on it.
    this.after(REVEAL.nameAtMs, () => {
      // The TRUE bottom of the art, not a fraction of it: these plates are
      // trimmed to their content, so the bottom edge IS the animal's feet and
      // the kicker line has to clear them or it reads as printed on the toes.
      const plateBottom = cy + plate.displayHeight / 2;
      const nameBox = this.scene.add.container(cx, plateBottom + 132).setAlpha(0);
      const kicker = this.scene.add
        .text(0, -52, 'A NEW DRAGON', {
          fontFamily: FONT.ui, fontSize: `${TYPE.label}px`, fontStyle: 'bold',
          color: INK.onFieldGold
        })
        .setLetterSpacing(8)
        .setOrigin(0.5);
      const name = this.scene.add
        .text(0, 0, card.name, {
          fontFamily: FONT.ui, fontSize: `${TYPE.display}px`, fontStyle: 'bold',
          color: INK.onField
        })
        .setOrigin(0.5)
        .setShadow(0, 5, 'rgba(36,27,34,0.8)', 10);
      const epithet = this.scene.add
        .text(0, 62, card.epithet, {
          fontFamily: FONT.ui, fontSize: `${TYPE.body}px`, fontStyle: 'italic',
          color: INK.onFieldDim, align: 'center', wordWrap: { width: 1500 }
        })
        .setOrigin(0.5, 0)
        .setShadow(0, 3, 'rgba(36,27,34,0.8)', 6);
      // A rule that draws itself out from the middle, under the kicker.
      const rule = this.scene.add.rectangle(0, -26, 4, 3, num(INK.gold), 0.9);
      nameBox.add([kicker, rule, name, epithet]);
      layer.add(nameBox);
      this.tween({
        targets: nameBox, alpha: 1, y: plateBottom + 92,
        duration: REVEAL.nameRiseMs, ease: 'Back.easeOut'
      });
      this.tween({ targets: rule, width: 420, duration: 520, ease: 'Quint.easeOut', delay: 80 });
    });

    // 6. It breathes while it holds, then lets go on its own.
    this.after(REVEAL.plateInMs + 140, () => {
      this.tween({
        targets: plate, scale: target * (1 + REVEAL.breathScale),
        duration: REVEAL.breathMs, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
      });
    });
    this.after(REVEAL.nameAtMs + REVEAL.nameRiseMs + REVEAL.holdMs, () => this.close(false));

    this.bus.emit('ui:reveal_toggled', { open: true });
  }

  /** A tap after the roar has landed cuts to the exit. Before it, the tap is
   *  ignored: skipping the beat you came for is never what was meant. */
  private skip(): void {
    if (!this.layer || this.elapsed < REVEAL.skipAfterMs) return;
    this.close(false);
  }

  private after(ms: number, fn: () => void): void {
    this.timers.push(this.scene.time.delayedCall(ms, fn));
  }

  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig | object): void {
    this.tweens.push(this.scene.tweens.add(config as Phaser.Types.Tweens.TweenBuilderConfig));
  }

  /** Tear down. `immediate` skips the fade (a second reveal landed on top). */
  private close(immediate: boolean): void {
    const layer = this.layer;
    if (!layer) return;
    this.layer = null;
    for (const t of this.timers) t.remove();
    this.timers = [];
    const done = (): void => {
      for (const t of this.tweens) t.stop();
      this.tweens = [];
      layer.destroy(true);
    };
    this.bus.emit('ui:reveal_toggled', { open: false });
    if (immediate) {
      done();
      return;
    }
    this.scene.tweens.add({
      targets: layer, alpha: 0, duration: REVEAL.outMs, ease: 'Sine.easeIn', onComplete: done
    });
  }

  /** UIScene drives this from its own update, so `skip` can respect the roar. */
  tick(delta: number): void {
    if (this.layer) this.elapsed += delta;
  }

  destroy(): void {
    this.close(true);
  }
}
