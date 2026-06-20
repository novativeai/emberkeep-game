import Phaser from 'phaser';
import { PALETTE, RES } from '../core/Constants';
import type { AssetsManifest } from '../core/types';
import { darken, lighten, seededRandom, withAlpha } from './colors';

const P = PALETTE;

/**
 * Tile texture geometry in LOGICAL units (the painter multiplies everything
 * by RES, so the actual texture is w*RES x h*RES for a TILE_W-wide tile).
 */
export const TILE_TEX = { w: 136, h: 76, cx: 68, cy: 38, rx: 64, ry: 32 } as const;
const CLIFF_H = 50;

type Ctx2D = CanvasRenderingContext2D;

/**
 * Track A art: every placeholder texture is painted at runtime with Canvas2D
 * in the Emberkeep palette — soft pseudo-3D shading (top-cap highlight, core
 * shadow, contact-friendly base) matching the Fairyland references. Real PNGs
 * later replace any of these by flipping the entry in assets.json; no code
 * changes needed.
 */
export class TextureFactory {
  constructor(private scene: Phaser.Scene) {}

  generateAll(manifest: AssetsManifest): void {
    for (const entry of manifest.images) {
      if (entry.source === 'placeholder') this.generate(entry.key);
    }
  }

  /** Also used as the fallback when a real-art file fails to load. */
  generate(key: string): void {
    switch (key) {
      case 'tile_ash': return this.tile(key, lighten(P.ash, 0.06), P.ashShade, 'ash', 11);
      case 'tile_ash_alt': return this.tile(key, P.ash, darken(P.ashShade, 0.04), 'ash', 23);
      case 'tile_moss': return this.tile(key, P.moss, P.mossShade, 'moss', 37);
      case 'tile_moss_alt': return this.tile(key, darken(P.moss, 0.05), darken(P.mossShade, 0.05), 'moss', 51);
      case 'cliff_sw': return this.cliff(key, 'sw', true);
      case 'cliff_se': return this.cliff(key, 'se', true);
      case 'cliff_sw_b': return this.cliff(key, 'sw', false);
      case 'cliff_se_b': return this.cliff(key, 'se', false);
      case 'cliff_corner_s': return this.cliff(key, 's', true);
      case 'cliff_corner_e': return this.cliff(key, 'e', false);
      case 'cliff_corner_w': return this.cliff(key, 'w', false);
      case 'cliff_rock': return this.cliffRock(key);
      case 'fog_puff_1': return this.fogPuff(key, 5);
      case 'fog_puff_2': return this.fogPuff(key, 91);
      case 'decor_brazier': return this.brazier(key);
      case 'decor_far_isle': return this.farIsle(key);
      case 'item_sparkweed_1': return this.sparkweed1(key);
      case 'item_sparkweed_2': return this.sparkweed2(key);
      case 'item_sparkweed_3': return this.sparkweed3(key);
      case 'item_ember_dragon_1': return this.egg(key);
      case 'item_golden_egg_1': return this.egg(key);
      case 'item_ember_dragon_2': return this.dragon(key, false);
      case 'item_ember_dragon_3': return this.dragon(key, true);
      case 'item_flame_gem_1': return this.gemShard(key);
      case 'item_flame_gem_2': return this.flameGem(key, false);
      case 'item_flame_gem_3': return this.flameGem(key, true);
      case 'decor_nest': return this.nest(key);
      case 'fx_ember': return this.ember(key);
      case 'fx_spark': return this.spark(key);
      case 'fx_glow': return this.glow(key);
      case 'fx_shell': return this.shell(key);
      case 'ui_hand': return this.hand(key);
      case 'ui_arrow': return this.arrow(key);
      case 'portrait_pip': return this.portraitPip(key);
      case 'portrait_cindra': return this.portraitCindra(key);
      case 'ui_tile_highlight': return this.tileHighlight(key);
      case 'ui_btn_play': return this.button(key, 264, 96, lighten(P.goldAccent, 0.15), P.gold, P.goldShade);
      case 'ui_btn_green': return this.button(key, 210, 76, lighten(P.moss, 0.25), P.moss, darken(P.mossShade, 0.1));
      case 'ui_btn_round': return this.roundButton(key);
      case 'ui_panel': return this.panel(key);
      case 'ui_card': return this.card(key);
      case 'ui_pill': return this.pill(key);
      case 'ui_slot': return this.slot(key);
      case 'ui_icon_bolt': return this.iconBolt(key);
      case 'ui_icon_coin': return this.iconCoin(key);
      case 'ui_icon_key': return this.iconKey(key);
      case 'ui_icon_gear': return this.iconGear(key);
      case 'ui_icon_scroll': return this.iconScroll(key);
      default:
        // Unknown key: paint a loud magenta square so it is impossible to miss.
        // eslint-disable-next-line no-console
        console.warn(`[TextureFactory] no generator for key: ${key}`);
        return this.paint(key, 64, 64, (g) => {
          g.fillStyle = '#FF00FF';
          g.fillRect(0, 0, 64, 64);
        });
    }
  }

  /* ------------------------------------------------------------------ */

  private paint(key: string, w: number, h: number, draw: (g: Ctx2D) => void): void {
    if (this.scene.textures.exists(key)) return;
    // Paint in logical units, render at RES x for crisp hi-dpi output.
    const tex = this.scene.textures.createCanvas(key, w * RES, h * RES);
    if (!tex) return;
    const g = tex.getContext();
    g.save();
    g.scale(RES, RES);
    draw(g);
    g.restore();
    tex.refresh();
  }

  private diamondPath(g: Ctx2D, cx: number, cy: number, rx: number, ry: number): void {
    g.beginPath();
    g.moveTo(cx, cy - ry);
    g.lineTo(cx + rx, cy);
    g.lineTo(cx, cy + ry);
    g.lineTo(cx - rx, cy);
    g.closePath();
  }

  private contactShadow(g: Ctx2D, x: number, y: number, rx: number, ry: number, alpha = 0.24): void {
    const grad = g.createRadialGradient(x, y, 1, x, y, rx);
    grad.addColorStop(0, withAlpha(P.night, alpha));
    grad.addColorStop(1, withAlpha(P.night, 0));
    g.save();
    g.translate(x, y);
    g.scale(1, ry / rx);
    g.translate(-x, -y);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, rx, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  private teardrop(g: Ctx2D, x: number, y: number, len: number, width: number, angle: number): void {
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(-width, -len * 0.45, 0, -len);
    g.quadraticCurveTo(width, -len * 0.45, 0, 0);
    g.closePath();
    g.restore();
  }

  private star4(g: Ctx2D, x: number, y: number, r: number, color: string, alpha = 1): void {
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x, y - r);
    g.quadraticCurveTo(x + r * 0.16, y - r * 0.16, x + r, y);
    g.quadraticCurveTo(x + r * 0.16, y + r * 0.16, x, y + r);
    g.quadraticCurveTo(x - r * 0.16, y + r * 0.16, x - r, y);
    g.quadraticCurveTo(x - r * 0.16, y - r * 0.16, x, y - r);
    g.fill();
    g.restore();
  }

  private roundRectPath(g: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /* ----------------------------- ground ----------------------------- */

  private tile(key: string, base: string, shade: string, kind: 'ash' | 'moss', seed: number): void {
    const { w, h, cx, cy, rx, ry } = TILE_TEX;
    this.paint(key, w, h, (g) => {
      const rand = seededRandom(seed);
      // Top face fill: lit from the top.
      const fill = g.createLinearGradient(0, cy - ry, 0, cy + ry);
      fill.addColorStop(0, lighten(base, 0.16));
      fill.addColorStop(0.55, base);
      fill.addColorStop(1, darken(base, 0.05));
      this.diamondPath(g, cx, cy, rx, ry);
      g.fillStyle = fill;
      g.fill();

      // Inner gloss cap (soft, rounded feel like the reference tiles).
      const gloss = g.createLinearGradient(0, cy - ry, 0, cy + ry * 0.35);
      gloss.addColorStop(0, 'rgba(255,255,255,0.30)');
      gloss.addColorStop(1, 'rgba(255,255,255,0)');
      this.diamondPath(g, cx, cy - 2, rx * 0.86, ry * 0.86);
      g.fillStyle = gloss;
      g.fill();

      // Flecks: warm gold motes on moss, dark grit on ash.
      for (let i = 0; i < 7; i++) {
        const fx = cx + (rand() - 0.5) * rx * 1.3;
        const fy = cy + (rand() - 0.5) * ry * 1.3;
        if (Math.abs(fx - cx) / rx + Math.abs(fy - cy) / ry > 0.82) continue;
        g.globalAlpha = 0.22 + rand() * 0.22;
        g.fillStyle = kind === 'moss' ? (rand() > 0.5 ? P.goldAccent : lighten(base, 0.3)) : darken(shade, 0.15);
        g.beginPath();
        g.arc(fx, fy, 1 + rand() * 1.6, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      }

      // Bevels: lit NW/NE edges, gently shaded SW/SE edges.
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.strokeStyle = withAlpha(lighten(base, 0.42), 0.9);
      g.beginPath();
      g.moveTo(cx - rx + 2, cy);
      g.lineTo(cx, cy - ry + 1);
      g.lineTo(cx + rx - 2, cy);
      g.stroke();
      g.strokeStyle = withAlpha(darken(shade, 0.18), 0.6);
      g.beginPath();
      g.moveTo(cx - rx + 2, cy);
      g.lineTo(cx, cy + ry - 1);
      g.lineTo(cx + rx - 2, cy);
      g.stroke();

      // Soft rim.
      g.lineWidth = 1.1;
      g.strokeStyle = withAlpha(darken(shade, 0.3), 0.5);
      this.diamondPath(g, cx, cy, rx, ry);
      g.stroke();
    });
  }

  private cliffFace(
    g: Ctx2D,
    from: [number, number],
    to: [number, number],
    crack: boolean
  ): void {
    // Tile edge extruded downward with one soft rounded scallop, like the
    // reference isles' smooth under-cliffs.
    const drop = CLIFF_H;
    const midX = (from[0] + to[0]) / 2;
    const midY = (from[1] + to[1]) / 2 + drop;
    g.beginPath();
    g.moveTo(from[0], from[1]);
    g.lineTo(to[0], to[1]);
    g.lineTo(to[0], to[1] + drop);
    g.quadraticCurveTo(midX, midY + 18, from[0], from[1] + drop);
    g.closePath();

    const grad = g.createLinearGradient(0, Math.min(from[1], to[1]), 0, midY + 18);
    grad.addColorStop(0, lighten(P.plumHighlight, 0.14));
    grad.addColorStop(0.3, P.plumHighlight);
    grad.addColorStop(0.65, P.plum);
    grad.addColorStop(1, darken(P.plumShade, 0.18));
    g.fillStyle = grad;
    g.fill();
    g.lineWidth = 1.3;
    g.strokeStyle = withAlpha(darken(P.plumShade, 0.35), 0.7);
    g.stroke();

    // Warm lip where the turf overhangs the rock.
    g.lineWidth = 4;
    g.lineCap = 'round';
    g.strokeStyle = withAlpha(lighten(P.plumHighlight, 0.3), 0.85);
    g.beginPath();
    g.moveTo(from[0], from[1] + 2);
    g.lineTo(to[0], to[1] + 2);
    g.stroke();

    // Soft vertical sheen.
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.beginPath();
    g.ellipse(midX - (to[0] - from[0]) * 0.18, midY - drop * 0.55, 16, 22, 0.2, 0, Math.PI * 2);
    g.fill();

    if (crack) {
      g.lineWidth = 1.8;
      g.lineCap = 'round';
      g.strokeStyle = withAlpha(P.lava, 0.45);
      g.beginPath();
      g.moveTo(midX - 8, midY - 20);
      g.lineTo(midX - 2, midY - 11);
      g.lineTo(midX - 10, midY - 3);
      g.stroke();
      g.fillStyle = withAlpha(P.goldAccent, 0.5);
      g.beginPath();
      g.arc(midX - 2, midY - 11, 1.3, 0, Math.PI * 2);
      g.fill();
    }
  }

  private cliff(key: string, dir: 'sw' | 'se' | 's' | 'e' | 'w', crack: boolean): void {
    const { w, cx, cy, rx, ry } = TILE_TEX;
    const h = cy + ry + CLIFF_H + 26;
    const S: [number, number] = [cx, cy + ry];
    const E: [number, number] = [cx + rx, cy];
    const W: [number, number] = [cx - rx, cy];
    this.paint(key, w, h, (g) => {
      if (dir === 'se' || dir === 's' || dir === 'e') this.cliffFace(g, S, E, crack);
      if (dir === 'sw' || dir === 's' || dir === 'w') this.cliffFace(g, W, S, dir === 's' ? false : crack);
      if (dir === 'e') this.cliffFace(g, E, [cx + rx, cy + 1], false);
      if (dir === 'w') this.cliffFace(g, [cx - rx, cy + 1], W, false);
    });
  }

  private cliffRock(key: string): void {
    this.paint(key, 72, 64, (g) => {
      const grad = g.createLinearGradient(0, 6, 0, 58);
      grad.addColorStop(0, P.plumHighlight);
      grad.addColorStop(0.5, P.plum);
      grad.addColorStop(1, darken(P.plumShade, 0.3));
      g.beginPath();
      g.moveTo(36, 5);
      g.lineTo(62, 22);
      g.lineTo(56, 50);
      g.lineTo(30, 58);
      g.lineTo(10, 40);
      g.lineTo(14, 16);
      g.closePath();
      g.fillStyle = grad;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = withAlpha(darken(P.plumShade, 0.4), 0.9);
      g.stroke();
      g.strokeStyle = withAlpha(P.lava, 0.6);
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(28, 24);
      g.lineTo(36, 32);
      g.lineTo(30, 42);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.beginPath();
      g.ellipse(30, 14, 12, 5, -0.4, 0, Math.PI * 2);
      g.fill();
    });
  }

  /**
   * One tile-cap of the cloud blanket. The whole cluster fits INSIDE one iso
   * tile footprint (lateral reach ±62 of the 64px logical half-tile) so caps
   * never bleed onto neighbouring tiles; banks read seamless purely through
   * grid adjacency. Pure cauliflower — no baked shadows or base ovals.
   * Footprint centre at (100, 96); anchor (0.5, 0.64).
   */
  private fogPuff(key: string, seed: number): void {
    const w = 200;
    const h = 150;
    this.paint(key, w, h, (g) => {
      const rand = seededRandom(seed);
      const cx = 100;
      const baseY = 96;
      // Cauliflower dome: fixed arrangement + tiny seeded jitter, drawn
      // back-to-front. [dx, dy, r]
      const dome: [number, number, number][] = [
        [0, -28, 22],
        [-21, -18, 19],
        [21, -18, 19],
        [-40, -2, 18],
        [40, -2, 18],
        [-18, 4, 22],
        [18, 4, 22],
        [0, -4, 26]
      ];
      const jitter = (): number => (rand() - 0.5) * 4;
      const puffs = dome.map(([dx, dy, r]) => [cx + dx + jitter(), baseY + dy + jitter() * 0.6, r + jitter() * 0.4] as const);
      // Reference-white clouds: near-white tops, soft cool grey-blue shading.
      const bright = '#FFFFFF';
      const mid = '#F0F1F6';
      const edge = '#D9DCE8';
      for (const [px, py, pr] of [...puffs].sort((a, b) => a[1] - b[1])) {
        const grad = g.createRadialGradient(px - pr * 0.3, py - pr * 0.5, pr * 0.12, px, py, pr);
        grad.addColorStop(0, bright);
        grad.addColorStop(0.58, mid);
        grad.addColorStop(1, edge);
        g.fillStyle = grad;
        g.beginPath();
        g.arc(px, py, pr, 0, Math.PI * 2);
        g.fill();
        // Crisp top catchlight per puff.
        g.fillStyle = 'rgba(255,255,255,0.55)';
        g.beginPath();
        g.ellipse(px - pr * 0.22, py - pr * 0.5, pr * 0.5, pr * 0.26, -0.35, 0, Math.PI * 2);
        g.fill();
      }
    });
  }

  /** Landmark for the decorative zone: a plum-stone tower with a lit gold brazier. */
  private brazier(key: string): void {
    this.paint(key, 150, 190, (g) => {
      const cx = 75;
      this.contactShadow(g, cx, 176, 44, 13);
      // Stone base: three stacked rounded slabs.
      const slabs: [number, number, number][] = [
        [148, 46, 26],
        [120, 96, 24],
        [96, 136, 22]
      ];
      for (const [y, halfW, sh] of slabs) {
        const grad = g.createLinearGradient(0, y, 0, y + sh + 14);
        grad.addColorStop(0, P.plumHighlight);
        grad.addColorStop(0.5, P.plum);
        grad.addColorStop(1, darken(P.plumShade, 0.15));
        g.fillStyle = grad;
        this.roundRectPath(g, cx - halfW, y, halfW * 2, sh + 14, 11);
        g.fill();
        g.lineWidth = 1.6;
        g.strokeStyle = withAlpha(darken(P.plumShade, 0.35), 0.8);
        g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.10)';
        this.roundRectPath(g, cx - halfW + 5, y + 3, halfW * 2 - 10, 8, 5);
        g.fill();
      }
      // Gold bowl.
      const bowl = g.createLinearGradient(0, 72, 0, 102);
      bowl.addColorStop(0, P.goldAccent);
      bowl.addColorStop(0.55, P.gold);
      bowl.addColorStop(1, P.goldShade);
      g.fillStyle = bowl;
      g.beginPath();
      g.moveTo(cx - 36, 76);
      g.quadraticCurveTo(cx, 108, cx + 36, 76);
      g.quadraticCurveTo(cx, 92, cx - 36, 76);
      g.closePath();
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = withAlpha(darken(P.goldShade, 0.3), 0.9);
      g.stroke();
      g.beginPath();
      g.ellipse(cx, 76, 36, 9, 0, 0, Math.PI * 2);
      g.fillStyle = P.goldShade;
      g.fill();
      // Flame + glow.
      const halo = g.createRadialGradient(cx, 56, 4, cx, 56, 48);
      halo.addColorStop(0, withAlpha(P.goldAccent, 0.5));
      halo.addColorStop(1, withAlpha(P.goldAccent, 0));
      g.fillStyle = halo;
      g.fillRect(cx - 48, 8, 96, 96);
      for (const [color, len, wid] of [
        [P.lavaShade, 38, 17],
        [P.lava, 30, 13],
        [P.gold, 21, 9],
        [P.goldAccent, 12, 5]
      ] as const) {
        g.fillStyle = color;
        this.teardrop(g, cx, 74, len, wid, 0);
        g.fill();
      }
      this.star4(g, cx + 26, 36, 5, '#FFFFFF', 0.9);
    });
  }

  /** Tiny desaturated isle silhouette for deep-background parallax. */
  private farIsle(key: string): void {
    this.paint(key, 180, 110, (g) => {
      const grad = g.createLinearGradient(0, 20, 0, 100);
      grad.addColorStop(0, withAlpha(lighten(P.tealDeep, 0.18), 0.9));
      grad.addColorStop(0.45, withAlpha(P.tealDeep, 0.9));
      grad.addColorStop(1, withAlpha(darken(P.tealDeep, 0.25), 0.85));
      g.fillStyle = grad;
      // Diamond top + tapered skirt in one silhouette.
      g.beginPath();
      g.moveTo(90, 14);
      g.lineTo(168, 46);
      g.lineTo(150, 64);
      g.quadraticCurveTo(120, 96, 90, 100);
      g.quadraticCurveTo(50, 92, 26, 62);
      g.lineTo(12, 46);
      g.closePath();
      g.fill();
      // Dim mossy cap.
      g.fillStyle = withAlpha(lighten(P.tealDeep, 0.3), 0.85);
      g.beginPath();
      g.moveTo(90, 14);
      g.lineTo(168, 46);
      g.lineTo(90, 78);
      g.lineTo(12, 46);
      g.closePath();
      g.fill();
    });
  }

  /* ----------------------------- items ------------------------------ */

  private sparkweedBlade(
    g: Ctx2D,
    baseX: number,
    baseY: number,
    tipX: number,
    tipY: number,
    width: number
  ): void {
    const bend = (tipX - baseX) * 0.35;
    g.beginPath();
    g.moveTo(baseX - width / 2, baseY);
    g.quadraticCurveTo(baseX - width / 2 + bend, (baseY + tipY) / 2, tipX, tipY);
    g.quadraticCurveTo(baseX + width / 2 + bend, (baseY + tipY) / 2, baseX + width / 2, baseY);
    g.closePath();
    const grad = g.createLinearGradient(0, baseY, 0, tipY);
    grad.addColorStop(0, P.mossShade);
    grad.addColorStop(0.6, P.moss);
    grad.addColorStop(1, P.gold);
    g.fillStyle = grad;
    g.fill();
    // Glowing ember tip.
    g.fillStyle = withAlpha(P.goldAccent, 0.95);
    g.beginPath();
    g.arc(tipX, tipY, 2.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.arc(tipX - 0.7, tipY - 0.7, 0.9, 0, Math.PI * 2);
    g.fill();
  }

  private sparkweed1(key: string): void {
    this.paint(key, 96, 96, (g) => {
      this.contactShadow(g, 48, 83, 24, 8);
      this.sparkweedBlade(g, 48, 84, 28, 52, 9);
      this.sparkweedBlade(g, 48, 84, 68, 50, 9);
      this.sparkweedBlade(g, 46, 84, 40, 42, 10);
      this.sparkweedBlade(g, 50, 84, 58, 44, 9);
      this.sparkweedBlade(g, 48, 84, 48, 38, 11);
    });
  }

  private sparkweed2(key: string): void {
    this.paint(key, 96, 96, (g) => {
      this.contactShadow(g, 48, 83, 26, 8.5);
      this.sparkweedBlade(g, 44, 84, 24, 54, 10);
      this.sparkweedBlade(g, 52, 84, 72, 52, 10);
      this.sparkweedBlade(g, 46, 84, 36, 46, 10);
      this.sparkweedBlade(g, 50, 84, 62, 46, 10);
      // Halo + bud.
      const halo = g.createRadialGradient(48, 52, 2, 48, 52, 26);
      halo.addColorStop(0, withAlpha(P.goldAccent, 0.28));
      halo.addColorStop(1, withAlpha(P.goldAccent, 0));
      g.fillStyle = halo;
      g.fillRect(14, 18, 68, 68);
      const bud = g.createRadialGradient(43, 46, 2, 48, 54, 19);
      bud.addColorStop(0, P.lavaHighlight);
      bud.addColorStop(0.55, P.lava);
      bud.addColorStop(1, P.lavaShade);
      g.fillStyle = bud;
      g.beginPath();
      g.ellipse(48, 54, 12, 16, 0, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 1.6;
      g.strokeStyle = withAlpha(darken(P.lavaShade, 0.25), 0.8);
      g.stroke();
      // Bud gloss + gold rim.
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.beginPath();
      g.ellipse(44, 47, 4, 6, -0.35, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = withAlpha(P.goldAccent, 0.85);
      g.lineWidth = 2.2;
      g.beginPath();
      g.ellipse(48, 54, 12, 16, 0, -2.2, -0.7);
      g.stroke();
      // Calyx leaves hugging the bud.
      g.fillStyle = P.mossShade;
      this.teardrop(g, 40, 68, 14, 4.5, 0.5);
      g.fill();
      this.teardrop(g, 56, 68, 14, 4.5, -0.5);
      g.fill();
    });
  }

  private sparkweed3(key: string): void {
    this.paint(key, 96, 96, (g) => {
      this.contactShadow(g, 48, 83, 27, 9);
      // Stem + leaves.
      g.lineWidth = 4.5;
      g.lineCap = 'round';
      g.strokeStyle = P.mossShade;
      g.beginPath();
      g.moveTo(48, 84);
      g.quadraticCurveTo(45, 64, 48, 46);
      g.stroke();
      g.fillStyle = P.moss;
      this.teardrop(g, 46, 72, 17, 5.5, 1.05);
      g.fill();
      this.teardrop(g, 49, 64, 17, 5.5, -1.05);
      g.fill();
      // Halo.
      const halo = g.createRadialGradient(48, 40, 3, 48, 40, 30);
      halo.addColorStop(0, withAlpha(P.goldAccent, 0.32));
      halo.addColorStop(1, withAlpha(P.goldAccent, 0));
      g.fillStyle = halo;
      g.fillRect(12, 6, 72, 70);
      // Six flame petals.
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        g.save();
        g.translate(48, 40);
        g.rotate(angle);
        const grad = g.createLinearGradient(0, 0, 0, -22);
        grad.addColorStop(0, P.lavaShade);
        grad.addColorStop(0.55, P.lava);
        grad.addColorStop(1, P.goldAccent);
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(0, -3);
        g.quadraticCurveTo(-7.5, -12, 0, -23);
        g.quadraticCurveTo(7.5, -12, 0, -3);
        g.closePath();
        g.fill();
        g.restore();
      }
      // Center disc.
      const core = g.createRadialGradient(46, 38, 1, 48, 40, 9);
      core.addColorStop(0, P.goldAccent);
      core.addColorStop(0.7, P.gold);
      core.addColorStop(1, P.goldShade);
      g.fillStyle = core;
      g.beginPath();
      g.arc(48, 40, 8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.beginPath();
      g.arc(45.5, 37.5, 2, 0, Math.PI * 2);
      g.fill();
      this.star4(g, 64, 26, 5, '#FFFFFF', 0.9);
    });
  }

  private egg(key: string): void {
    this.paint(key, 96, 96, (g) => {
      this.contactShadow(g, 48, 84, 24, 8);
      g.save();
      g.translate(48, 58);
      g.rotate(-0.07);
      // Shell.
      const shell = g.createRadialGradient(-8, -14, 4, 0, 2, 30);
      shell.addColorStop(0, P.lavaHighlight);
      shell.addColorStop(0.55, P.lava);
      shell.addColorStop(1, darken(P.lavaShade, 0.12));
      g.fillStyle = shell;
      g.beginPath();
      g.ellipse(0, 0, 19.5, 26, 0, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 1.6;
      g.strokeStyle = withAlpha(darken(P.lavaShade, 0.3), 0.75);
      g.stroke();
      // Gold speckles, clipped to the shell.
      g.save();
      g.beginPath();
      g.ellipse(0, 0, 19.5, 26, 0, 0, Math.PI * 2);
      g.clip();
      const rand = seededRandom(77);
      for (let i = 0; i < 12; i++) {
        const sx = (rand() - 0.5) * 34;
        const sy = (rand() - 0.5) * 46;
        g.globalAlpha = 0.65 + rand() * 0.35;
        g.fillStyle = rand() > 0.4 ? P.goldAccent : P.gold;
        g.beginPath();
        g.ellipse(sx, sy, 1.4 + rand() * 1.8, 1 + rand() * 1.4, rand() * 3, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      // Reflected warm light along the bottom edge.
      g.strokeStyle = withAlpha(P.lavaHighlight, 0.5);
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(0, 0, 16.5, 23, 0, Math.PI * 0.25, Math.PI * 0.75);
      g.stroke();
      g.restore();
      // Gloss.
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.beginPath();
      g.ellipse(-7.5, -12, 6, 9.5, -0.4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.beginPath();
      g.arc(-2, -20, 1.7, 0, Math.PI * 2);
      g.fill();
      g.restore();
    });
  }

  /** The chibi star of the show: hatchling (small, sitting) or whelp (taller, crest). */
  private dragon(key: string, whelp: boolean): void {
    this.paint(key, 96, 96, (g) => {
      const cx = 48;
      const baseY = 84;
      const s = whelp ? 1.16 : 1;
      const bodyY = whelp ? 62 : 66;
      const headY = whelp ? 32 : 40;
      const headR = (whelp ? 18.5 : 17.5) * s;
      this.contactShadow(g, cx, baseY, whelp ? 28 : 25, 8.5);

      const bodyGrad = (x: number, y: number, r: number): CanvasGradient => {
        const grad = g.createRadialGradient(x - r * 0.42, y - r * 0.5, r * 0.15, x, y, r * 1.12);
        grad.addColorStop(0, P.lavaHighlight);
        grad.addColorStop(0.55, P.lava);
        grad.addColorStop(1, darken(P.lavaShade, 0.08));
        return grad;
      };
      const outline = withAlpha(darken(P.lavaShade, 0.32), 0.8);

      // Tail curl (behind body).
      g.lineWidth = 7 * s;
      g.lineCap = 'round';
      g.strokeStyle = P.lavaShade;
      g.beginPath();
      g.moveTo(cx + 12 * s, bodyY + 8);
      g.quadraticCurveTo(cx + 30 * s, bodyY + 12, cx + 28 * s, bodyY - 4);
      g.stroke();
      g.fillStyle = P.gold;
      this.teardrop(g, cx + 28 * s, bodyY - 4, 11 * s, 4.5 * s, 0.5);
      g.fill();

      // Wings (behind body): rounded gold triangles.
      for (const side of [-1, 1]) {
        g.save();
        g.translate(cx + side * 16 * s, bodyY - 6);
        g.rotate(side * (whelp ? 0.85 : 0.55));
        const wing = g.createLinearGradient(0, -16 * s, 0, 4);
        wing.addColorStop(0, P.goldAccent);
        wing.addColorStop(0.6, P.gold);
        wing.addColorStop(1, P.goldShade);
        g.fillStyle = wing;
        g.beginPath();
        g.moveTo(0, 2);
        g.quadraticCurveTo(side * 16 * s, -10 * s, side * 6 * s, -(whelp ? 22 : 16) * s);
        g.quadraticCurveTo(side * 2, -8 * s, 0, 2);
        g.closePath();
        g.fill();
        g.lineWidth = 1.4;
        g.strokeStyle = withAlpha(P.goldShade, 0.9);
        g.stroke();
        g.restore();
      }

      // Body.
      g.fillStyle = bodyGrad(cx, bodyY, 17 * s);
      g.beginPath();
      g.ellipse(cx, bodyY, 17 * s, (whelp ? 16.5 : 14) * s, 0, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 1.6;
      g.strokeStyle = outline;
      g.stroke();

      // Feet stubs.
      for (const side of [-1, 1]) {
        g.fillStyle = P.lavaShade;
        g.beginPath();
        g.ellipse(cx + side * 9 * s, baseY - 3, 5.5 * s, 4 * s, 0, 0, Math.PI * 2);
        g.fill();
      }

      // Belly.
      const belly = g.createLinearGradient(0, bodyY - 8, 0, baseY);
      belly.addColorStop(0, P.cream);
      belly.addColorStop(1, darken(P.cream, 0.14));
      g.fillStyle = belly;
      g.beginPath();
      g.ellipse(cx, bodyY + 4, 10 * s, (whelp ? 11 : 9) * s, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = withAlpha(darken(P.cream, 0.35), 0.6);
      g.lineWidth = 1.2;
      for (const dy of [1, 5]) {
        g.beginPath();
        g.moveTo(cx - 6 * s, bodyY + 4 + dy);
        g.quadraticCurveTo(cx, bodyY + 6.5 + dy, cx + 6 * s, bodyY + 4 + dy);
        g.stroke();
      }

      // Head.
      g.fillStyle = bodyGrad(cx, headY, headR);
      g.beginPath();
      g.arc(cx, headY, headR, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 1.6;
      g.strokeStyle = outline;
      g.stroke();

      // Horns.
      for (const side of [-1, 1]) {
        const hx = cx + side * 7.5 * s;
        const hy = headY - headR + 2;
        const horn = g.createLinearGradient(hx, hy - 10, hx, hy);
        horn.addColorStop(0, P.goldAccent);
        horn.addColorStop(1, P.goldShade);
        g.fillStyle = horn;
        g.beginPath();
        g.moveTo(hx - 3.4 * s, hy + 1);
        g.quadraticCurveTo(hx + side * 1.5, hy - 10 * s, hx + side * 4.5 * s, hy - 8 * s);
        g.quadraticCurveTo(hx + side * 3 * s, hy - 2, hx + 3.4 * s, hy + 1.5);
        g.closePath();
        g.fill();
      }

      // Whelp crest: little flame plume between the horns.
      if (whelp) {
        const flame = g.createLinearGradient(cx, headY - headR - 14, cx, headY - headR + 2);
        flame.addColorStop(0, P.goldAccent);
        flame.addColorStop(1, P.lava);
        g.fillStyle = flame;
        this.teardrop(g, cx, headY - headR + 3, 15, 5.5, 0.12);
        g.fill();
      }

      // Head gloss.
      g.fillStyle = 'rgba(255,255,255,0.32)';
      g.beginPath();
      g.ellipse(cx - 7 * s, headY - 8 * s, 7 * s, 4.6 * s, -0.35, 0, Math.PI * 2);
      g.fill();

      // Eyes: big, glossy, amber.
      const eyeR = (whelp ? 4.6 : 5.2) * s;
      for (const side of [-1, 1]) {
        const ex = cx + side * 6.6 * s;
        const ey = headY - 1;
        g.fillStyle = '#FFFFFF';
        g.beginPath();
        g.ellipse(ex, ey, eyeR, eyeR * 1.3, 0, 0, Math.PI * 2);
        g.fill();
        g.lineWidth = 1;
        g.strokeStyle = withAlpha(P.lavaShade, 0.4);
        g.stroke();
        const iris = g.createRadialGradient(ex, ey + 1, 0.5, ex, ey + 1, eyeR * 0.78);
        iris.addColorStop(0, P.goldAccent);
        iris.addColorStop(1, P.goldShade);
        g.fillStyle = iris;
        g.beginPath();
        g.arc(ex, ey + 1, eyeR * 0.74, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = P.night;
        g.beginPath();
        g.arc(ex, ey + 1.4, eyeR * 0.4, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#FFFFFF';
        g.beginPath();
        g.arc(ex - eyeR * 0.28, ey - eyeR * 0.18, eyeR * 0.24, 0, Math.PI * 2);
        g.fill();
      }

      // Muzzle, nostrils, smile, fang.
      g.fillStyle = lighten(P.lava, 0.22);
      g.beginPath();
      g.ellipse(cx, headY + 7.5 * s, 6.8 * s, 4.6 * s, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = withAlpha(darken(P.lavaShade, 0.3), 0.9);
      for (const side of [-1, 1]) {
        g.beginPath();
        g.arc(cx + side * 2.4 * s, headY + 6 * s, 0.9, 0, Math.PI * 2);
        g.fill();
      }
      g.lineWidth = 1.6;
      g.lineCap = 'round';
      g.strokeStyle = withAlpha(darken(P.lavaShade, 0.35), 0.95);
      g.beginPath();
      g.arc(cx, headY + 7 * s, 4.6 * s, Math.PI * 0.2, Math.PI * 0.8);
      g.stroke();
      if (whelp) {
        g.fillStyle = '#FFFFFF';
        g.beginPath();
        g.moveTo(cx + 3.4 * s, headY + 10.4 * s);
        g.lineTo(cx + 5 * s, headY + 10.2 * s);
        g.lineTo(cx + 4.2 * s, headY + 12.6 * s);
        g.closePath();
        g.fill();
      }

      // Blush.
      g.fillStyle = withAlpha(P.lavaHighlight, 0.6);
      for (const side of [-1, 1]) {
        g.beginPath();
        g.ellipse(cx + side * 11.5 * s, headY + 5 * s, 3 * s, 2 * s, 0, 0, Math.PI * 2);
        g.fill();
      }
    });
  }

  private gemShard(key: string): void {
    this.paint(key, 96, 96, (g) => {
      this.contactShadow(g, 48, 83, 19, 7);
      const glow = g.createRadialGradient(48, 60, 2, 48, 60, 24);
      glow.addColorStop(0, withAlpha(P.gold, 0.25));
      glow.addColorStop(1, withAlpha(P.gold, 0));
      g.fillStyle = glow;
      g.fillRect(20, 32, 56, 56);
      const top: [number, number] = [48, 36];
      const right: [number, number] = [59, 58];
      const bottom: [number, number] = [48, 82];
      const left: [number, number] = [37, 58];
      // Left bright facet.
      g.beginPath();
      g.moveTo(...top);
      g.lineTo(...left);
      g.lineTo(...bottom);
      g.lineTo(48, 58);
      g.closePath();
      const lf = g.createLinearGradient(34, 36, 48, 82);
      lf.addColorStop(0, P.lavaHighlight);
      lf.addColorStop(1, P.lava);
      g.fillStyle = lf;
      g.fill();
      // Right dark facet.
      g.beginPath();
      g.moveTo(...top);
      g.lineTo(...right);
      g.lineTo(...bottom);
      g.lineTo(48, 58);
      g.closePath();
      const rf = g.createLinearGradient(48, 36, 62, 82);
      rf.addColorStop(0, P.lava);
      rf.addColorStop(1, darken(P.lavaShade, 0.15));
      g.fillStyle = rf;
      g.fill();
      // Ridge + rim.
      g.lineWidth = 1.4;
      g.strokeStyle = withAlpha('#FFFFFF', 0.55);
      g.beginPath();
      g.moveTo(...top);
      g.lineTo(48, 58);
      g.lineTo(...bottom);
      g.stroke();
      g.strokeStyle = withAlpha(darken(P.lavaShade, 0.3), 0.85);
      g.beginPath();
      g.moveTo(...top);
      g.lineTo(...right);
      g.lineTo(...bottom);
      g.lineTo(...left);
      g.closePath();
      g.stroke();
      // Glints.
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.beginPath();
      g.ellipse(44, 46, 2.2, 4.5, 0.5, 0, Math.PI * 2);
      g.fill();
      this.star4(g, 56, 42, 4.5, '#FFFFFF', 0.95);
    });
  }

  private flameGem(key: string, radiant: boolean): void {
    this.paint(key, 96, 96, (g) => {
      const cx = 48;
      const cy = radiant ? 52 : 56;
      const r = radiant ? 21 : 16.5;
      this.contactShadow(g, 48, 83, radiant ? 24 : 20, 7.5);
      if (radiant) {
        const halo = g.createRadialGradient(cx, cy, 4, cx, cy, 34);
        halo.addColorStop(0, withAlpha(P.goldAccent, 0.4));
        halo.addColorStop(1, withAlpha(P.goldAccent, 0));
        g.fillStyle = halo;
        g.fillRect(cx - 36, cy - 36, 72, 72);
      }
      // Crown: flat-top hexagon.
      const hex: [number, number][] = [];
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i / 6) * Math.PI * 2;
        hex.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.92]);
      }
      // Pavilion below.
      g.beginPath();
      g.moveTo(hex[2]![0], hex[2]![1]);
      g.lineTo(cx, cy + r * 1.55);
      g.lineTo(hex[1]![0], hex[1]![1]);
      g.closePath();
      const pav = g.createLinearGradient(0, cy, 0, cy + r * 1.6);
      pav.addColorStop(0, P.gold);
      pav.addColorStop(1, darken(P.goldShade, 0.2));
      g.fillStyle = pav;
      g.fill();
      g.lineWidth = 1.2;
      g.strokeStyle = withAlpha(darken(P.goldShade, 0.3), 0.9);
      g.stroke();
      // Crown facets.
      g.beginPath();
      g.moveTo(hex[0]![0], hex[0]![1]);
      for (let i = 1; i < 6; i++) g.lineTo(hex[i]![0], hex[i]![1]);
      g.closePath();
      const crown = g.createLinearGradient(0, cy - r, 0, cy + r);
      crown.addColorStop(0, P.goldAccent);
      crown.addColorStop(0.6, P.gold);
      crown.addColorStop(1, P.goldShade);
      g.fillStyle = crown;
      g.fill();
      g.stroke();
      // Table: inner hexagon with a warm core (radiant gets a lava heart).
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i / 6) * Math.PI * 2;
        const px = cx + Math.cos(a) * r * 0.55;
        const py = cy + Math.sin(a) * r * 0.5;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      const table = g.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, r * 0.6);
      if (radiant) {
        table.addColorStop(0, P.lavaHighlight);
        table.addColorStop(0.6, P.lava);
        table.addColorStop(1, P.gold);
      } else {
        table.addColorStop(0, lighten(P.goldAccent, 0.4));
        table.addColorStop(1, P.gold);
      }
      g.fillStyle = table;
      g.fill();
      g.strokeStyle = withAlpha('#FFFFFF', 0.5);
      g.stroke();
      // Facet seams.
      g.strokeStyle = withAlpha('#FFFFFF', 0.35);
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i / 6) * Math.PI * 2;
        g.moveTo(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.5);
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.92);
      }
      g.stroke();
      // Gloss + sparkles.
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.beginPath();
      g.ellipse(cx - r * 0.4, cy - r * 0.45, r * 0.42, r * 0.2, -0.5, 0, Math.PI * 2);
      g.fill();
      this.star4(g, cx + r * 0.7, cy - r * 0.8, radiant ? 6.5 : 5, '#FFFFFF', 0.95);
      if (radiant) {
        this.star4(g, cx - r * 0.95, cy + r * 0.3, 4.5, '#FFFFFF', 0.85);
        const rand = seededRandom(13);
        for (let i = 0; i < 5; i++) {
          const a = rand() * Math.PI * 2;
          const d = r * 1.45 + rand() * 6;
          g.fillStyle = withAlpha(P.goldAccent, 0.8);
          g.beginPath();
          g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, 1.6, 0, Math.PI * 2);
          g.fill();
        }
      }
    });
  }

  private nest(key: string): void {
    this.paint(key, 110, 88, (g) => {
      const cx = 55;
      const cy = 56;
      this.contactShadow(g, cx, 76, 36, 10);
      // Hollow.
      g.fillStyle = darken(P.plumShade, 0.3);
      g.beginPath();
      g.ellipse(cx, cy - 6, 26, 12, 0, 0, Math.PI * 2);
      g.fill();
      // Woven twigs: seeded arcs around the ring.
      const rand = seededRandom(29);
      const tones = [
        P.textBrown,
        darken(P.textBrown, 0.25),
        lighten(P.textBrown, 0.18),
        P.plumShade,
        P.goldShade
      ];
      g.lineCap = 'round';
      for (let i = 0; i < 26; i++) {
        const a0 = rand() * Math.PI * 2;
        const sweep = 0.5 + rand() * 0.9;
        const rxTwig = 30 + rand() * 9;
        const ryTwig = 13 + rand() * 5;
        g.lineWidth = 3.5 + rand() * 3;
        g.strokeStyle = tones[Math.floor(rand() * tones.length)]!;
        g.globalAlpha = 0.85;
        g.beginPath();
        g.ellipse(cx, cy, rxTwig, ryTwig, rand() * 0.3 - 0.15, a0, a0 + sweep);
        g.stroke();
      }
      g.globalAlpha = 1;
      // Top rim catchlight.
      g.lineWidth = 3;
      g.strokeStyle = withAlpha(lighten(P.textBrown, 0.35), 0.9);
      g.beginPath();
      g.ellipse(cx, cy - 4, 32, 13, 0, Math.PI * 1.05, Math.PI * 1.95);
      g.stroke();
      // Stray golden straws.
      g.lineWidth = 1.4;
      g.strokeStyle = withAlpha(P.goldAccent, 0.8);
      g.beginPath();
      g.moveTo(cx - 30, cy + 8);
      g.lineTo(cx - 42, cy + 16);
      g.moveTo(cx + 28, cy + 10);
      g.lineTo(cx + 40, cy + 15);
      g.stroke();
    });
  }

  /* ------------------------------ fx -------------------------------- */

  private ember(key: string): void {
    this.paint(key, 18, 18, (g) => {
      const grad = g.createRadialGradient(9, 9, 0.5, 9, 9, 9);
      grad.addColorStop(0, '#FFFFFF');
      grad.addColorStop(0.25, P.goldAccent);
      grad.addColorStop(0.6, P.lava);
      grad.addColorStop(1, withAlpha(P.lava, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, 18, 18);
    });
  }

  private spark(key: string): void {
    this.paint(key, 22, 22, (g) => {
      this.star4(g, 11, 11, 10, P.goldAccent, 1);
      this.star4(g, 11, 11, 5, '#FFFFFF', 0.95);
    });
  }

  private glow(key: string): void {
    this.paint(key, 256, 256, (g) => {
      const grad = g.createRadialGradient(128, 128, 6, 128, 128, 128);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      grad.addColorStop(0.7, 'rgba(255,255,255,0.18)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
    });
  }

  private shell(key: string): void {
    this.paint(key, 30, 30, (g) => {
      g.beginPath();
      g.moveTo(4, 20);
      g.quadraticCurveTo(8, 4, 24, 7);
      g.lineTo(20, 14);
      g.lineTo(15, 12);
      g.lineTo(13, 19);
      g.closePath();
      const grad = g.createLinearGradient(0, 4, 0, 22);
      grad.addColorStop(0, P.lavaHighlight);
      grad.addColorStop(1, P.lavaShade);
      g.fillStyle = grad;
      g.fill();
      g.lineWidth = 1.4;
      g.strokeStyle = withAlpha(P.cream, 0.85);
      g.stroke();
      g.fillStyle = P.goldAccent;
      g.beginPath();
      g.arc(11, 12, 1.4, 0, Math.PI * 2);
      g.fill();
    });
  }

  /* --------------------------- characters --------------------------- */

  private portraitBase(g: Ctx2D, draw: (g: Ctx2D) => void): void {
    // Gold ring.
    const ring = g.createLinearGradient(0, 2, 0, 94);
    ring.addColorStop(0, P.goldAccent);
    ring.addColorStop(0.5, P.gold);
    ring.addColorStop(1, P.goldShade);
    g.fillStyle = ring;
    g.beginPath();
    g.arc(48, 48, 46, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = withAlpha(darken(P.goldShade, 0.3), 0.9);
    g.stroke();
    g.strokeStyle = withAlpha(P.cream, 0.9);
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(48, 48, 40.5, 0, Math.PI * 2);
    g.stroke();
    // Inner disc, clipped.
    g.save();
    g.beginPath();
    g.arc(48, 48, 38.5, 0, Math.PI * 2);
    g.clip();
    draw(g);
    // Soft top light.
    const light = g.createRadialGradient(34, 28, 4, 48, 48, 46);
    light.addColorStop(0, 'rgba(255,255,255,0.28)');
    light.addColorStop(0.4, 'rgba(255,255,255,0.06)');
    light.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = light;
    g.fillRect(0, 0, 96, 96);
    g.restore();
  }

  private portraitPip(key: string): void {
    this.paint(key, 96, 96, (g) => {
      this.portraitBase(g, (gg) => {
        const bg = gg.createLinearGradient(0, 10, 0, 86);
        bg.addColorStop(0, P.teal);
        bg.addColorStop(1, P.tealDeep);
        gg.fillStyle = bg;
        gg.fillRect(0, 0, 96, 96);
        // Pip: teal dragon head, three-quarter silhouette with life.
        const head = gg.createRadialGradient(40, 42, 4, 48, 50, 26);
        head.addColorStop(0, lighten(P.tealDeep, 0.25));
        head.addColorStop(1, darken(P.tealDeep, 0.25));
        gg.fillStyle = head;
        gg.beginPath();
        gg.arc(46, 50, 20, 0, Math.PI * 2);
        gg.fill();
        // Snout.
        gg.beginPath();
        gg.ellipse(63, 56, 11, 8, 0.1, 0, Math.PI * 2);
        gg.fill();
        // Horns.
        gg.fillStyle = P.cream;
        this.teardrop(gg, 38, 32, 13, 4, -0.5);
        gg.fill();
        this.teardrop(gg, 48, 30, 11, 3.5, -0.15);
        gg.fill();
        // Wing nub.
        gg.fillStyle = darken(P.tealDeep, 0.35);
        this.teardrop(gg, 30, 62, 16, 6, 2.4);
        gg.fill();
        // Eye + smile + nostril.
        gg.fillStyle = '#FFFFFF';
        gg.beginPath();
        gg.ellipse(52, 46, 5, 6.4, 0, 0, Math.PI * 2);
        gg.fill();
        gg.fillStyle = P.night;
        gg.beginPath();
        gg.arc(53, 47, 2.6, 0, Math.PI * 2);
        gg.fill();
        gg.fillStyle = '#FFFFFF';
        gg.beginPath();
        gg.arc(52, 45.5, 1, 0, Math.PI * 2);
        gg.fill();
        gg.lineWidth = 1.8;
        gg.lineCap = 'round';
        gg.strokeStyle = darken(P.tealDeep, 0.4);
        gg.beginPath();
        gg.arc(60, 59, 5.5, Math.PI * 0.15, Math.PI * 0.75);
        gg.stroke();
        gg.fillStyle = darken(P.tealDeep, 0.4);
        gg.beginPath();
        gg.arc(66, 53, 1.1, 0, Math.PI * 2);
        gg.fill();
        // Cheek.
        gg.fillStyle = withAlpha(P.lavaHighlight, 0.5);
        gg.beginPath();
        gg.ellipse(44, 58, 3.4, 2.2, 0, 0, Math.PI * 2);
        gg.fill();
      });
    });
  }

  private portraitCindra(key: string): void {
    this.paint(key, 96, 96, (g) => {
      this.portraitBase(g, (gg) => {
        const bg = gg.createRadialGradient(48, 52, 6, 48, 48, 44);
        bg.addColorStop(0, P.plumHighlight);
        bg.addColorStop(1, P.plumShade);
        gg.fillStyle = bg;
        gg.fillRect(0, 0, 96, 96);
        // Swirl of sparks around the flame.
        gg.lineWidth = 2;
        gg.strokeStyle = withAlpha(P.goldAccent, 0.55);
        gg.beginPath();
        gg.arc(48, 52, 24, Math.PI * 0.7, Math.PI * 1.6);
        gg.stroke();
        gg.beginPath();
        gg.arc(48, 52, 28, Math.PI * 1.9, Math.PI * 2.5);
        gg.stroke();
        // Nested flame body (grandmotherly: tall, composed).
        const flames: [string, number, number][] = [
          [P.lavaShade, 27, 13],
          [P.lava, 22, 10.5],
          [P.gold, 16, 7.5],
          [P.goldAccent, 10, 4.6]
        ];
        for (const [color, len, wid] of flames) {
          gg.fillStyle = color;
          gg.beginPath();
          gg.moveTo(48, 66);
          gg.quadraticCurveTo(48 - wid * 2, 66 - len * 0.8, 48 - wid * 0.4, 66 - len * 1.6);
          gg.quadraticCurveTo(48 + wid * 0.9, 66 - len * 1.9, 48 + wid * 0.5, 66 - len * 2.25);
          gg.quadraticCurveTo(48 + wid * 1.6, 66 - len * 1.2, 48 + wid * 2, 66 - len * 0.6);
          gg.quadraticCurveTo(48 + wid, 66, 48, 66);
          gg.closePath();
          gg.fill();
        }
        // Two wise ember eyes inside the flame.
        gg.fillStyle = P.night;
        gg.beginPath();
        gg.ellipse(44.5, 44, 1.6, 2.4, 0, 0, Math.PI * 2);
        gg.ellipse(52.5, 44, 1.6, 2.4, 0, 0, Math.PI * 2);
        gg.fill();
        gg.fillStyle = '#FFFFFF';
        gg.beginPath();
        gg.arc(44, 43, 0.7, 0, Math.PI * 2);
        gg.arc(52, 43, 0.7, 0, Math.PI * 2);
        gg.fill();
        // Floating sparks.
        for (const [sx, sy, sr] of [[26, 36, 1.8], [70, 40, 1.5], [64, 26, 1.2]] as const) {
          gg.fillStyle = withAlpha(P.goldAccent, 0.9);
          gg.beginPath();
          gg.arc(sx, sy, sr, 0, Math.PI * 2);
          gg.fill();
        }
      });
    });
  }

  /* ------------------------------ ui -------------------------------- */

  private hand(key: string): void {
    this.paint(key, 68, 78, (g) => {
      g.lineJoin = 'round';
      const base = P.cream;
      const shadeC = darken(P.cream, 0.18);
      // Pointing glove: index finger up-left, curled fist, gold cuff.
      g.beginPath();
      g.moveTo(24, 8); // fingertip
      g.quadraticCurveTo(31, 4, 33, 12);
      g.lineTo(36, 34); // finger inner edge down to palm
      g.quadraticCurveTo(52, 30, 56, 42);
      g.quadraticCurveTo(60, 56, 48, 64);
      g.quadraticCurveTo(34, 70, 24, 62);
      g.quadraticCurveTo(14, 54, 18, 42);
      g.quadraticCurveTo(20, 36, 18, 30)
      g.lineTo(16, 14);
      g.quadraticCurveTo(17, 6, 24, 8);
      g.closePath();
      const grad = g.createLinearGradient(10, 6, 56, 70);
      grad.addColorStop(0, '#FFFFFF');
      grad.addColorStop(0.55, base);
      grad.addColorStop(1, shadeC);
      g.fillStyle = grad;
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = P.textBrown;
      g.stroke();
      // Knuckle creases.
      g.lineWidth = 1.6;
      g.strokeStyle = withAlpha(P.textBrown, 0.45);
      g.beginPath();
      g.moveTo(36, 40);
      g.quadraticCurveTo(42, 44, 40, 50);
      g.moveTo(44, 38);
      g.quadraticCurveTo(50, 44, 47, 52);
      g.stroke();
      // Cuff.
      this.roundRectPath(g, 26, 60, 28, 13, 6);
      const cuff = g.createLinearGradient(0, 60, 0, 73);
      cuff.addColorStop(0, P.goldAccent);
      cuff.addColorStop(1, P.goldShade);
      g.fillStyle = cuff;
      g.fill();
      g.lineWidth = 2.4;
      g.strokeStyle = P.textBrown;
      g.stroke();
    });
  }

  private arrow(key: string): void {
    this.paint(key, 60, 66, (g) => {
      g.lineJoin = 'round';
      // Down-pointing chevron with a pseudo-3D base strip.
      const draw = (inset: number): void => {
        g.beginPath();
        g.moveTo(8 + inset, 10 + inset * 0.4);
        g.lineTo(30, 30 - inset * 0.2);
        g.lineTo(52 - inset, 10 + inset * 0.4);
        g.lineTo(52 - inset, 28 - inset * 0.2);
        g.lineTo(30, 52 - inset);
        g.lineTo(8 + inset, 28 - inset * 0.2);
        g.closePath();
      };
      g.save();
      g.translate(0, 4);
      draw(0);
      g.fillStyle = darken(P.goldShade, 0.18);
      g.fill();
      g.restore();
      draw(0);
      const grad = g.createLinearGradient(0, 8, 0, 52);
      grad.addColorStop(0, P.goldAccent);
      grad.addColorStop(0.6, P.gold);
      grad.addColorStop(1, P.goldShade);
      g.fillStyle = grad;
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = P.textBrown;
      g.stroke();
      // Glint.
      g.lineWidth = 2.4;
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.beginPath();
      g.moveTo(14, 15);
      g.lineTo(27, 27);
      g.stroke();
    });
  }

  private tileHighlight(key: string): void {
    const { w, h, cx, cy, rx, ry } = TILE_TEX;
    this.paint(key, w, h, (g) => {
      g.shadowColor = P.goldAccent;
      g.shadowBlur = 10;
      this.diamondPath(g, cx, cy, rx - 5, ry - 3);
      g.fillStyle = withAlpha(P.goldAccent, 0.16);
      g.fill();
      g.lineWidth = 4;
      g.lineJoin = 'round';
      g.strokeStyle = withAlpha(P.goldAccent, 0.95);
      g.stroke();
      g.shadowBlur = 0;
      g.lineWidth = 1.8;
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      this.diamondPath(g, cx, cy, rx - 10, ry - 6);
      g.stroke();
    });
  }

  private button(key: string, w: number, h: number, hi: string, base: string, strip: string): void {
    this.paint(key, w, h, (g) => {
      const r = Math.min(24, h * 0.3);
      // Pseudo-3D: darker full plate first, lighter face on top.
      this.roundRectPath(g, 2, 6, w - 4, h - 8, r);
      g.fillStyle = strip;
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = withAlpha(darken(strip, 0.35), 0.95);
      g.stroke();
      this.roundRectPath(g, 2, 2, w - 4, h - 16, r);
      const face = g.createLinearGradient(0, 2, 0, h - 14);
      face.addColorStop(0, hi);
      face.addColorStop(1, base);
      g.fillStyle = face;
      g.fill();
      g.stroke();
      // Gloss band.
      this.roundRectPath(g, 8, 6, w - 16, (h - 16) * 0.42, r * 0.8);
      g.fillStyle = 'rgba(255,255,255,0.30)';
      g.fill();
    });
  }

  private roundButton(key: string): void {
    this.paint(key, 68, 68, (g) => {
      g.beginPath();
      g.arc(34, 38, 29, 0, Math.PI * 2);
      g.fillStyle = P.goldShade;
      g.fill();
      g.lineWidth = 2.6;
      g.strokeStyle = withAlpha(darken(P.goldShade, 0.35), 0.95);
      g.stroke();
      g.beginPath();
      g.arc(34, 32, 29, 0, Math.PI * 2);
      const face = g.createLinearGradient(0, 3, 0, 61);
      face.addColorStop(0, lighten(P.cream, 0.3));
      face.addColorStop(1, darken(P.cream, 0.12));
      g.fillStyle = face;
      g.fill();
      g.stroke();
      g.beginPath();
      g.ellipse(34, 20, 18, 8, 0, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fill();
    });
  }

  private panel(key: string): void {
    this.paint(key, 660, 440, (g) => {
      // Soft drop shadow.
      g.shadowColor = 'rgba(36,27,34,0.45)';
      g.shadowBlur = 22;
      g.shadowOffsetY = 10;
      this.roundRectPath(g, 14, 10, 632, 412, 30);
      const border = g.createLinearGradient(0, 10, 0, 422);
      border.addColorStop(0, P.lava);
      border.addColorStop(1, P.lavaShade);
      g.fillStyle = border;
      g.fill();
      g.shadowColor = 'transparent';
      g.shadowBlur = 0;
      g.shadowOffsetY = 0;
      g.lineWidth = 3;
      g.strokeStyle = withAlpha(darken(P.lavaShade, 0.3), 0.9);
      g.stroke();
      // Cream inner.
      this.roundRectPath(g, 24, 20, 612, 392, 22);
      const inner = g.createLinearGradient(0, 20, 0, 412);
      inner.addColorStop(0, lighten(P.cream, 0.35));
      inner.addColorStop(0.12, P.cream);
      inner.addColorStop(1, darken(P.cream, 0.07));
      g.fillStyle = inner;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = withAlpha(P.goldShade, 0.5);
      g.stroke();
    });
  }

  private card(key: string): void {
    this.paint(key, 320, 350, (g) => {
      this.roundRectPath(g, 4, 4, 312, 342, 18);
      g.fillStyle = '#FFFDF6';
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = '#E8B98F';
      g.stroke();
      // Stitched corners.
      g.lineWidth = 2;
      g.strokeStyle = withAlpha(P.goldShade, 0.8);
      g.setLineDash([6, 5]);
      this.roundRectPath(g, 12, 12, 296, 326, 13);
      g.stroke();
      g.setLineDash([]);
      // Bottom inner shade.
      const shade = g.createLinearGradient(0, 290, 0, 346);
      shade.addColorStop(0, 'rgba(181,96,47,0)');
      shade.addColorStop(1, 'rgba(181,96,47,0.10)');
      g.fillStyle = shade;
      this.roundRectPath(g, 4, 250, 312, 96, 18);
      g.fill();
    });
  }

  private pill(key: string): void {
    this.paint(key, 176, 52, (g) => {
      this.roundRectPath(g, 2, 2, 172, 48, 24);
      g.fillStyle = 'rgba(58,43,56,0.88)';
      g.fill();
      g.lineWidth = 2.4;
      g.strokeStyle = withAlpha(P.gold, 0.95);
      g.stroke();
      this.roundRectPath(g, 8, 5, 160, 18, 12);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fill();
    });
  }

  private slot(key: string): void {
    this.paint(key, 72, 72, (g) => {
      this.roundRectPath(g, 3, 3, 66, 66, 15);
      const fill = g.createLinearGradient(0, 3, 0, 69);
      fill.addColorStop(0, darken('#EFE0C8', 0.08));
      fill.addColorStop(0.25, '#EFE0C8');
      fill.addColorStop(1, lighten('#EFE0C8', 0.1));
      g.fillStyle = fill;
      g.fill();
      g.lineWidth = 2.5;
      g.strokeStyle = '#D9C2A0';
      g.stroke();
      // Inner top shadow for the inset look.
      const inset = g.createLinearGradient(0, 4, 0, 22);
      inset.addColorStop(0, 'rgba(36,27,34,0.16)');
      inset.addColorStop(1, 'rgba(36,27,34,0)');
      g.fillStyle = inset;
      this.roundRectPath(g, 5, 5, 62, 20, 12);
      g.fill();
    });
  }

  /* ----------------------------- icons ------------------------------ */

  private iconBolt(key: string): void {
    this.paint(key, 44, 44, (g) => {
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(26, 3);
      g.lineTo(10, 25);
      g.lineTo(19, 26);
      g.lineTo(15, 41);
      g.lineTo(33, 18);
      g.lineTo(23, 17);
      g.closePath();
      const grad = g.createLinearGradient(0, 3, 0, 41);
      grad.addColorStop(0, P.goldAccent);
      grad.addColorStop(1, P.gold);
      g.fillStyle = grad;
      g.fill();
      g.lineWidth = 2.5;
      g.strokeStyle = P.goldShade;
      g.stroke();
      g.lineWidth = 1.6;
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.beginPath();
      g.moveTo(23, 8);
      g.lineTo(15, 20);
      g.stroke();
    });
  }

  private iconCoin(key: string): void {
    this.paint(key, 44, 44, (g) => {
      const grad = g.createRadialGradient(17, 15, 2, 22, 22, 19);
      grad.addColorStop(0, P.goldAccent);
      grad.addColorStop(0.65, P.gold);
      grad.addColorStop(1, P.goldShade);
      g.beginPath();
      g.arc(22, 22, 18, 0, Math.PI * 2);
      g.fillStyle = grad;
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = P.goldShade;
      g.stroke();
      g.lineWidth = 1.6;
      g.strokeStyle = withAlpha(lighten(P.goldAccent, 0.4), 0.9);
      g.beginPath();
      g.arc(22, 22, 13, 0, Math.PI * 2);
      g.stroke();
      // Ember mark.
      g.fillStyle = P.lava;
      this.teardrop(g, 22, 29, 14, 5.5, 0);
      g.fill();
      g.fillStyle = P.goldAccent;
      this.teardrop(g, 22, 28, 8, 3.2, 0);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.beginPath();
      g.ellipse(15, 13, 4, 2.2, -0.6, 0, Math.PI * 2);
      g.fill();
    });
  }

  private iconKey(key: string): void {
    this.paint(key, 44, 44, (g) => {
      g.save();
      g.translate(22, 22);
      g.rotate(-0.62);
      const grad = g.createLinearGradient(0, -10, 0, 10);
      grad.addColorStop(0, P.goldAccent);
      grad.addColorStop(1, P.goldShade);
      // Bow.
      g.lineWidth = 5.5;
      g.strokeStyle = grad;
      g.beginPath();
      g.arc(-10, 0, 6.5, 0, Math.PI * 2);
      g.stroke();
      // Shaft + teeth.
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-3, 0);
      g.lineTo(17, 0);
      g.stroke();
      g.lineWidth = 4.5;
      g.beginPath();
      g.moveTo(12, 0);
      g.lineTo(12, 7);
      g.moveTo(17, 0);
      g.lineTo(17, 9);
      g.stroke();
      // Outline pass.
      g.lineWidth = 1.4;
      g.strokeStyle = withAlpha(darken(P.goldShade, 0.3), 0.9);
      g.beginPath();
      g.arc(-10, 0, 9.4, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      this.star4(g, 33, 12, 3.5, '#FFFFFF', 0.9);
    });
  }

  private iconGear(key: string): void {
    this.paint(key, 44, 44, (g) => {
      g.save();
      g.translate(22, 22);
      const grad = g.createLinearGradient(0, -18, 0, 18);
      grad.addColorStop(0, P.plumHighlight);
      grad.addColorStop(1, P.plumShade);
      g.fillStyle = grad;
      for (let i = 0; i < 8; i++) {
        g.save();
        g.rotate((i / 8) * Math.PI * 2);
        this.roundRectPath(g, -3.6, -18, 7.2, 9, 2.5);
        g.fill();
        g.restore();
      }
      g.beginPath();
      g.arc(0, 0, 12.5, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = darken(P.plumShade, 0.3);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, 5.2, 0, Math.PI * 2);
      g.fillStyle = P.cream;
      g.fill();
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.beginPath();
      g.ellipse(-4, -7, 6, 3, -0.6, 0, Math.PI * 2);
      g.fill();
      g.restore();
    });
  }

  private iconScroll(key: string): void {
    this.paint(key, 44, 44, (g) => {
      // Parchment body.
      this.roundRectPath(g, 9, 9, 26, 26, 4);
      const grad = g.createLinearGradient(0, 9, 0, 35);
      grad.addColorStop(0, lighten(P.cream, 0.3));
      grad.addColorStop(1, darken(P.cream, 0.1));
      g.fillStyle = grad;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = P.textBrown;
      g.stroke();
      // Rods.
      for (const y of [7, 35]) {
        this.roundRectPath(g, 5, y - 3.2, 34, 6.4, 3.2);
        const rod = g.createLinearGradient(0, y - 3, 0, y + 3);
        rod.addColorStop(0, P.goldAccent);
        rod.addColorStop(1, P.goldShade);
        g.fillStyle = rod;
        g.fill();
        g.lineWidth = 1.6;
        g.strokeStyle = withAlpha(darken(P.goldShade, 0.3), 0.9);
        g.stroke();
      }
      // Script lines + wax seal.
      g.lineWidth = 2;
      g.lineCap = 'round';
      g.strokeStyle = withAlpha(P.textBrown, 0.55);
      for (const y of [16, 21, 26]) {
        g.beginPath();
        g.moveTo(14, y);
        g.lineTo(y === 26 ? 24 : 30, y);
        g.stroke();
      }
      g.fillStyle = P.lava;
      g.beginPath();
      g.arc(29, 29, 3.6, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.beginPath();
      g.arc(28, 28, 1.2, 0, Math.PI * 2);
      g.fill();
    });
  }
}
