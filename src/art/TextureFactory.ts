import Phaser from 'phaser';
import { ITEM_SCALE, PALETTE, RES } from '../core/Constants';
import type { AssetsManifest } from '../core/types';
import { darken, lighten, seededRandom, withAlpha } from './colors';
import {
  chromeClasps,
  chromeEdge,
  chromeField,
  chromePlate,
  EDGE,
  FONT,
  INK,
  RADIUS_TEX,
  roundRectPath,
  withShadow
} from './design';

const P = PALETTE;

/**
 * Tile texture geometry in LOGICAL units (the painter multiplies everything
 * by RES, so the actual texture is w*RES x h*RES for a TILE_W-wide tile).
 */
export const TILE_TEX = { w: 136, h: 76, cx: 68, cy: 38, rx: 64, ry: 32 } as const;
const CLIFF_H = 50;

type Ctx2D = CanvasRenderingContext2D;

/**
 * Color parameters of the themable ui_* chrome textures with their authored
 * defaults. The UI Builder tool lists these; ui-theme.json overrides them and
 * `regenerate()` repaints the texture IN PLACE (same key, same canvas) so
 * every Image already wearing it updates without a respawn.
 */
/**
 * 9-slice corner insets (TEXTURE pixels — the painters draw at logical×RES=2)
 * for the stretchable chrome frames: with these, a frame keeps crisp corners
 * and borders at ANY width×height (the promo-popup case in the UI Builder).
 */
export const UI_NINESLICE: Record<string, { l: number; r: number; t: number; b: number }> = {
  ui_panel: { l: 100, r: 100, t: 90, b: 90 },
  ui_card: { l: 80, r: 80, t: 80, b: 100 },
  ui_pill: { l: 52, r: 52, t: 46, b: 46 },
  ui_slot: { l: 36, r: 36, t: 36, b: 36 },
  ui_btn_play: { l: 56, r: 56, t: 44, b: 64 },
  ui_btn_green: { l: 52, r: 52, t: 40, b: 60 },
  ui_btn_price: { l: 52, r: 52, t: 40, b: 60 },
  ui_btn_free: { l: 52, r: 52, t: 40, b: 60 },
  // No ui_shop_panel entry: the Emporium frame carries a title rule and an
  // inner content box at fixed heights, so stretching its middle smears both.
  // It is authored at its final size and used as a plain image.
  ui_store_panel: { l: 130, r: 130, t: 120, b: 120 },
  ui_quest_panel: { l: 100, r: 100, t: 90, b: 90 },
  ui_shop_card: { l: 90, r: 90, t: 40, b: 40 }
};

export const UI_TEXTURE_PARAMS: Record<string, Record<string, string>> = {
  ui_btn_play: { highlight: lighten(PALETTE.goldAccent, 0.15), base: PALETTE.gold, edge: PALETTE.goldShade },
  ui_btn_green: { highlight: lighten(PALETTE.moss, 0.25), base: PALETTE.moss, edge: darken(PALETTE.mossShade, 0.1) },
  ui_btn_round: { plate: PALETTE.goldShade, face: PALETTE.cream },
  ui_panel: { border: PALETTE.lava, borderShade: PALETTE.lavaShade, fill: PALETTE.cream },
  ui_pill: { fill: PALETTE.plumShade, border: PALETTE.gold },
  ui_slot: { fill: '#EFE0C8', border: '#D9C2A0' },
  // Ember Emporium (shop) chrome — trending merge-shop treatment.
  ui_shop_panel: { rim: PALETTE.lava, rimShade: PALETTE.lavaShade, fill: PALETTE.cream },
  ui_shop_card: { rim: PALETTE.gold, rimShade: PALETTE.goldShade, fill: '#FFFDF6' },
  ui_shop_ribbon: { base: PALETTE.gold, edge: PALETTE.goldShade },
  ui_shop_badge: { base: PALETTE.lava, edge: PALETTE.lavaShade },
};

/**
 * Track A art: every placeholder texture is painted at runtime with Canvas2D
 * in the Emberkeep palette — soft pseudo-3D shading (top-cap highlight, core
 * shadow, contact-friendly base) matching the Fairyland references. Real PNGs
 * later replace any of these by flipping the entry in assets.json; no code
 * changes needed.
 */
export class TextureFactory {
  /** ui-theme.json color overrides for the UI_TEXTURE_PARAMS chrome keys. */
  private uiColors: Record<string, Record<string, string>> = {};
  private forceRepaint = false;

  constructor(private scene: Phaser.Scene) {}

  generateAll(manifest: AssetsManifest): void {
    for (const entry of manifest.images) {
      if (entry.source === 'placeholder') this.generate(entry.key);
    }
  }

  /** Install theme color overrides (call BEFORE generateAll, or regenerate after). */
  setUiColors(colors: Record<string, Record<string, string>>): void {
    this.uiColors = colors;
  }

  /** Resolved color param for a themable chrome texture. */
  private uiColor(key: string, param: string): string {
    return this.uiColors[key]?.[param] ?? UI_TEXTURE_PARAMS[key]?.[param] ?? '#FF00FF';
  }

  /** Repaint an existing canvas texture in place with the CURRENT ui colors —
   *  the key and canvas survive, so every Image wearing it updates live. */
  regenerate(key: string): void {
    this.forceRepaint = true;
    try {
      this.generate(key);
    } finally {
      this.forceRepaint = false;
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
      case 'item_flame_gem_1': return this.gemShard(key);
      case 'item_flame_gem_2': return this.flameGem(key, false);
      case 'item_flame_gem_3': return this.flameGem(key, true);
      case 'decor_nest': return this.nest(key);
      case 'char_eleanor': return this.characterStandee(key, P.plum, P.plumHighlight);
      case 'char_selyna': return this.characterStandee(key, P.tealDeep, P.teal);
      case 'fx_ember': return this.ember(key);
      case 'fx_spark': return this.spark(key);
      case 'fx_confetti': return this.confetti(key);
      case 'fx_glow': return this.glow(key);
      case 'fx_shell': return this.shell(key);
      case 'portrait_pip': return this.portraitPip(key);
      case 'portrait_eleanor': return this.portraitEleanor(key);
      case 'ui_tile_highlight': return this.tileHighlight(key);
      case 'ui_btn_play':
        return this.button(key, 264, 96, this.uiColor(key, 'highlight'), this.uiColor(key, 'base'), this.uiColor(key, 'edge'));
      case 'ui_btn_green':
        return this.button(key, 210, 76, this.uiColor(key, 'highlight'), this.uiColor(key, 'base'), this.uiColor(key, 'edge'));
      case 'ui_btn_round': return this.roundButton(key);
      case 'ui_panel': return this.panel(key);
      case 'ui_card': return this.card(key);
      case 'ui_pill': return this.pill(key);
      case 'ui_heart': return this.heart(key, true);
      case 'ui_heart_empty': return this.heart(key, false);
      case 'ui_slot': return this.slot(key);
      case 'ui_store_panel': return this.storePanel(key);
      case 'ui_quest_panel': return this.questPanel(key);
      case 'ui_shop_panel': return this.shopPanel(key);
      case 'ui_shop_card': return this.shopCard(key, false);
      case 'ui_shop_card_hot': return this.shopCard(key, true);
      case 'ui_shop_price': return this.shopPricePill(key);
      case 'ui_shop_tab': return this.shopTab(key, false);
      case 'ui_shop_tab_on': return this.shopTab(key, true);
      case 'ui_shop_plaque': return this.shopPlaque(key);
      case 'ui_shop_wallet': return this.shopWallet(key);
      case 'ui_shop_close': return this.shopClose(key);
      case 'ui_shop_ribbon': return this.shopRibbon(key);
      case 'ui_shop_badge': return this.shopBadge(key);
      case 'ui_shop_burst': return this.shopBurst(key);
      // The Store's own two buttons — nothing else wears them, so they follow
      // the shop material rather than the board's moss.
      case 'ui_btn_price': return this.shopButton(key, false);
      case 'ui_btn_free': return this.shopButton(key, true);
      case 'ui_icon_bolt': return this.iconBolt(key);
      case 'ui_icon_key': return this.iconKey(key);
      case 'ui_icon_gear': return this.iconGear(key);
      case 'ui_icon_scroll': return this.iconScroll(key);
      case 'ui_icon_shop': return this.iconShop(key);
      default:
        // File-backed art with no bespoke generator (house, chest, coins, map
        // tiles…) still lands here when its PNG fails to load. Those get a
        // palette-friendly stand-in so a flaky load never shows the magenta
        // debug square in-game; magenta stays for genuinely unknown keys.
        if (key.startsWith('tile_')) {
          return this.tile(key, P.moss, P.mossShade, 'moss', this.seedFrom(key));
        }
        if (key.startsWith('item_') || key.startsWith('decor_')) {
          return this.genericItem(key);
        }
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

  /** Deterministic seed from a texture key, for seeded placeholder detail. */
  private seedFrom(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffff;
    return h || 1;
  }

  /**
   * Stand-in for any file-based merge item / decor whose PNG failed to load:
   * a plum parcel with a gold ribbon and a "?" tag. BoardScene multiplies file
   * art by ITEM_SCALE (tuned to the real PNG's pixel size — e.g. 0.064 for the
   * huge red-egg source), so the canvas is counter-sized to still read roughly
   * one tile on the board after that scale is applied.
   */
  private genericItem(key: string): void {
    const artScale = key.startsWith('item_') ? (ITEM_SCALE[key.slice(5)] ?? 1) : 1;
    const size = Math.round(96 / Math.min(1, Math.max(0.125, artScale)));
    const u = size / 96; // design space stays 96×96
    this.paint(key, size, size, (g) => {
      g.scale(u, u);
      this.contactShadow(g, 48, 84, 24, 8);
      // Parcel body.
      const grad = g.createLinearGradient(0, 30, 0, 82);
      grad.addColorStop(0, P.plumHighlight);
      grad.addColorStop(0.55, P.plum);
      grad.addColorStop(1, darken(P.plumShade, 0.1));
      g.fillStyle = grad;
      this.roundRectPath(g, 22, 32, 52, 50, 10);
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = withAlpha(darken(P.plumShade, 0.35), 0.9);
      g.stroke();
      // Gold ribbon.
      g.fillStyle = P.gold;
      g.fillRect(44, 32, 8, 50);
      g.fillRect(22, 53, 52, 8);
      g.fillStyle = withAlpha(P.goldAccent, 0.9);
      g.fillRect(44, 32, 3, 50);
      // Top gloss.
      g.fillStyle = 'rgba(255,255,255,0.14)';
      this.roundRectPath(g, 26, 36, 44, 12, 6);
      g.fill();
      // "?" tag so it clearly reads as art-to-come.
      g.font = `bold 26px ${FONT.ui}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 4;
      g.strokeStyle = withAlpha(darken(P.plumShade, 0.4), 0.9);
      g.strokeText('?', 48, 58);
      g.fillStyle = P.cream;
      g.fillText('?', 48, 58);
    });
  }

  private paint(key: string, w: number, h: number, draw: (g: Ctx2D) => void): void {
    if (this.scene.textures.exists(key)) {
      if (!this.forceRepaint) return;
      // Live re-theme: clear and redraw the SAME canvas texture in place.
      const tex = this.scene.textures.get(key);
      if (!(tex instanceof Phaser.Textures.CanvasTexture)) return;
      const g = tex.getContext();
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, tex.width, tex.height);
      g.scale(RES, RES);
      draw(g);
      g.restore();
      tex.refresh();
      return;
    }
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

  /**
   * BLOCKOUT standee for a world character — a cloaked silhouette at the right
   * footprint and height so placement, scale and depth can be judged before any
   * real art exists. House rule: placeholder art is painted at runtime and real
   * art swaps in via assets.json (`source: "file"`), so nothing downstream
   * changes when the 3D version lands (docs/world-characters.md §3).
   */
  private characterStandee(key: string, body: string, trim: string): void {
    const w = 150;
    const h = 260;
    this.paint(key, w, h, (g) => {
      const cx = w / 2;
      const footY = h - 12;
      // Ground contact ellipse — sells that she stands ON the isometric floor.
      g.fillStyle = 'rgba(36,27,34,0.28)';
      g.beginPath();
      g.ellipse(cx, footY, 46, 16, 0, 0, Math.PI * 2);
      g.fill();
      // Cloak: a tapering column, wide at the hem.
      g.fillStyle = body;
      g.beginPath();
      g.moveTo(cx - 26, 92);
      g.lineTo(cx + 26, 92);
      g.lineTo(cx + 52, footY - 4);
      g.lineTo(cx - 52, footY - 4);
      g.closePath();
      g.fill();
      // Upper-left rim light, matching the board's light direction.
      g.strokeStyle = trim;
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(cx - 26, 92);
      g.lineTo(cx - 52, footY - 4);
      g.stroke();
      // Hood + head.
      g.fillStyle = body;
      g.beginPath();
      g.ellipse(cx, 78, 34, 40, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = trim;
      g.beginPath();
      g.ellipse(cx, 74, 20, 24, 0, 0, Math.PI * 2);
      g.fill();
      // Crescent — the Daughters' mark, and the one thing that reads at board zoom.
      g.fillStyle = P.goldAccent;
      g.beginPath();
      g.arc(cx, 150, 17, -0.4, Math.PI + 0.4);
      g.arc(cx + 5, 150, 15, Math.PI + 0.4, -0.4, true);
      g.fill();
    });
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

  /** Delegates to the design system's path so there is one rounded rect. */
  private roundRectPath(g: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
    roundRectPath(g, x, y, w, h, r);
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

  /** A white paper slip — emitters tint it per burst, and the slight
   *  parallelogram keeps a spinning piece reading as paper, not a square. */
  private confetti(key: string): void {
    this.paint(key, 20, 14, (g) => {
      g.fillStyle = '#FFFFFF';
      g.beginPath();
      g.moveTo(2, 0);
      g.lineTo(20, 2);
      g.lineTo(18, 14);
      g.lineTo(0, 12);
      g.closePath();
      g.fill();
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

  private portraitEleanor(key: string): void {
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
    const plate = this.uiColor(key, 'plate');
    const faceCol = this.uiColor(key, 'face');
    this.paint(key, 68, 68, (g) => {
      g.beginPath();
      g.arc(34, 38, 29, 0, Math.PI * 2);
      g.fillStyle = plate;
      g.fill();
      g.lineWidth = 2.6;
      g.strokeStyle = withAlpha(darken(plate, 0.35), 0.95);
      g.stroke();
      g.beginPath();
      g.arc(34, 32, 29, 0, Math.PI * 2);
      const face = g.createLinearGradient(0, 3, 0, 61);
      face.addColorStop(0, lighten(faceCol, 0.3));
      face.addColorStop(1, darken(faceCol, 0.12));
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
    const borderC = this.uiColor(key, 'border');
    const borderShade = this.uiColor(key, 'borderShade');
    const fillC = this.uiColor(key, 'fill');
    this.paint(key, 660, 440, (g) => {
      // Soft drop shadow.
      g.shadowColor = 'rgba(36,27,34,0.45)';
      g.shadowBlur = 22;
      g.shadowOffsetY = 10;
      this.roundRectPath(g, 14, 10, 632, 412, 30);
      const border = g.createLinearGradient(0, 10, 0, 422);
      border.addColorStop(0, borderC);
      border.addColorStop(1, borderShade);
      g.fillStyle = border;
      g.fill();
      g.shadowColor = 'transparent';
      g.shadowBlur = 0;
      g.shadowOffsetY = 0;
      g.lineWidth = 3;
      g.strokeStyle = withAlpha(darken(borderShade, 0.3), 0.9);
      g.stroke();
      // Cream inner.
      this.roundRectPath(g, 24, 20, 612, 392, 22);
      const inner = g.createLinearGradient(0, 20, 0, 412);
      inner.addColorStop(0, lighten(fillC, 0.35));
      inner.addColorStop(0.12, fillC);
      inner.addColorStop(1, darken(fillC, 0.07));
      g.fillStyle = inner;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = withAlpha(P.goldShade, 0.5);
      g.stroke();
    });
  }

  /**
   * An order card inside the quest window. Sits ON the frame, so it is a shade
   * lighter than the field behind it and wears a lighter edge than the frame —
   * the hierarchy has to survive being seen two at a time.
   */
  private card(key: string): void {
    this.paint(key, 320, 350, (g) => {
      chromeField(g, 6, 6, 308, 338, RADIUS_TEX.md, { x: 160, y: 40, radius: 260, strength: 0.26 });
      chromeEdge(g, 6, 6, 308, 338, RADIUS_TEX.md, EDGE.thin);
      chromeClasps(g, 6, 6, 308, 338, RADIUS_TEX.md, 11, 4.5);
    });
  }

  private pill(key: string): void {
    const fillC = this.uiColor(key, 'fill');
    const borderC = this.uiColor(key, 'border');
    this.paint(key, 176, 52, (g) => {
      this.roundRectPath(g, 2, 2, 172, 48, 24);
      g.fillStyle = withAlpha(fillC, 0.88);
      g.fill();
      g.lineWidth = 2.4;
      g.strokeStyle = withAlpha(borderC, 0.95);
      g.stroke();
      this.roundRectPath(g, 8, 5, 160, 18, 12);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fill();
    });
  }

  /**
   * A Regard heart — lit or spent.
   *
   * Painted in the board's own lava, not in a generic red: this is Emberkeep's
   * relationship gauge and it should read as an ember someone is keeping alight.
   * The empty state is the SAME silhouette hollowed out rather than a different
   * shape, so five of them in a row read as one gauge at a glance instead of as
   * two kinds of icon.
   */
  private heart(key: string, lit: boolean): void {
    const S = 64;
    this.paint(key, S, S, (g) => {
      const path = (inset: number): void => {
        const w = S - inset * 2;
        const h = S - inset * 2;
        const x = inset;
        const y = inset;
        const top = y + h * 0.3;
        g.beginPath();
        g.moveTo(x + w / 2, y + h * 0.97);
        g.bezierCurveTo(x - w * 0.12, y + h * 0.55, x + w * 0.07, y - h * 0.06, x + w / 2, top);
        g.bezierCurveTo(x + w * 0.93, y - h * 0.06, x + w * 1.12, y + h * 0.55, x + w / 2, y + h * 0.97);
        g.closePath();
      };

      // A dark seat under both states, so a spent heart still has weight and the
      // row keeps its rhythm when the gauge is nearly empty.
      path(5);
      g.fillStyle = withAlpha(P.night, lit ? 0.35 : 0.28);
      g.fill();

      if (lit) {
        path(6);
        const grad = g.createLinearGradient(0, 8, 0, S - 6);
        grad.addColorStop(0, P.lavaHighlight);
        grad.addColorStop(0.55, P.lava);
        grad.addColorStop(1, P.lavaShade);
        g.fillStyle = grad;
        g.fill();
        // The catchlight every other lit thing on this board carries.
        g.beginPath();
        g.ellipse(S * 0.35, S * 0.36, S * 0.1, S * 0.07, -0.5, 0, Math.PI * 2);
        g.fillStyle = withAlpha(P.cream, 0.55);
        g.fill();
      } else {
        path(6);
        g.fillStyle = withAlpha(P.plumShade, 0.5);
        g.fill();
      }

      path(6);
      g.lineWidth = 3.2;
      g.strokeStyle = withAlpha(lit ? P.goldAccent : P.plumHighlight, lit ? 0.95 : 0.8);
      g.stroke();
    });
  }

  private slot(key: string): void {
    const fillC = this.uiColor(key, 'fill');
    const borderC = this.uiColor(key, 'border');
    this.paint(key, 72, 72, (g) => {
      this.roundRectPath(g, 3, 3, 66, 66, 15);
      const fill = g.createLinearGradient(0, 3, 0, 69);
      fill.addColorStop(0, darken(fillC, 0.08));
      fill.addColorStop(0.25, fillC);
      fill.addColorStop(1, lighten(fillC, 0.1));
      g.fillStyle = fill;
      g.fill();
      g.lineWidth = 2.5;
      g.strokeStyle = borderC;
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

  /* ------------------------- Ember Emporium ------------------------- */

  /**
   * A Store button — a milled gold rim, a dark keyline, a lit cream face.
   * `glow` adds the ember bloom that marks a screen's one featured action.
   */
  private shopButton(key: string, glow: boolean): void {
    this.paint(key, 230, 66, (g) => {
      const inset = glow ? 9 : 4;
      chromePlate(g, inset, inset, 230 - inset * 2, 66 - inset * 2, (66 - inset * 2) / 2, {
        weight: EDGE.bold,
        glow
      });
    });
  }

  /**
   * The Keeper's Store frame — the big showcase board the cosmetics sit on.
   *
   * Wears the Emporium's material (`design.ts`), not the board's cream-and-lava:
   * these two are the game's two shops and a player crosses between them, so a
   * different frame on each reads as two different products.
   */
  private storePanel(key: string): void {
    this.paint(key, 1060, 660, (g) => {
      withShadow(g, 30, 14, () => {
        this.roundRectPath(g, 22, 16, 1016, 620, 42);
        g.fillStyle = INK.fieldDeep;
        g.fill();
      });
      chromeField(g, 22, 16, 1016, 620, 42, { x: 530, y: 70, radius: 620, strength: 0.32 });
      chromeEdge(g, 22, 16, 1016, 620, 42, EDGE.bold);
      chromeClasps(g, 22, 16, 1016, 620, 42, 18, 6.5);
    });
  }

  /**
   * The quest window's frame — the Ledger, opened from the quest button.
   *
   * Its own key rather than `ui_panel`: the Cookbook shares that texture and is
   * still a cream page, so re-pointing the shared key would have dragged the
   * book along with the quests.
   */
  private questPanel(key: string): void {
    this.paint(key, 660, 440, (g) => {
      withShadow(g, 30, 14, () => {
        this.roundRectPath(g, 14, 10, 632, 412, RADIUS_TEX.xl);
        g.fillStyle = INK.fieldDeep;
        g.fill();
      });
      chromeField(g, 14, 10, 632, 412, RADIUS_TEX.xl, { x: 330, y: 50, radius: 420, strength: 0.3 });
      chromeEdge(g, 14, 10, 632, 412, RADIUS_TEX.xl, EDGE.bold);
      chromeClasps(g, 14, 10, 632, 412, RADIUS_TEX.xl, 16, 6);
    });
  }

  /* --------------------------- Ember Emporium --------------------------- */
  /*
   * The Emporium is the one surface in the game that does NOT wear the board's
   * cream-and-lava chrome. It is a lit shop interior seen at night, drawn from
   * the Seedream concept at
   * `assets/raw/shop-concept/generations/bakeoff-seedream-pro.png`: a deep plum
   * field, milled gold edges with corner clasps, and cream price plates. Forcing
   * it into the shared PALETTE is exactly what made the old one read as a
   * recoloured Ledger, so `SHOP_INK` is sampled from that reference instead.
   */

  /**
   * The Emporium frame. Holds the whole shop: a title bar across the top (rule
   * beneath it), then the tabbed content box the tabs bite into.
   */
  private shopPanel(key: string): void {
    this.paint(key, 1180, 720, (g) => {
      g.shadowColor = 'rgba(0,0,0,0.6)';
      g.shadowBlur = 38;
      g.shadowOffsetY = 16;
      this.roundRectPath(g, 12, 10, 1156, 700, 30);
      g.fillStyle = INK.fieldDeep;
      g.fill();
      g.shadowColor = 'transparent';
      g.shadowBlur = 0;
      g.shadowOffsetY = 0;

      chromeField(g, 12, 10, 1156, 700, 30, { x: 590, y: 60, radius: 660, strength: 0.3 });
      chromeEdge(g, 12, 10, 1156, 700, 30, 5);
      chromeClasps(g, 12, 10, 1156, 700, 30, 16, 6);

      // Rule under the title bar: a hairline that catches light at the middle
      // and fades to nothing at both ends, so it never reads as a hard divider.
      const rule = g.createLinearGradient(60, 0, 1120, 0);
      rule.addColorStop(0, withAlpha(INK.gold, 0));
      rule.addColorStop(0.5, withAlpha(INK.goldHi, 0.75));
      rule.addColorStop(1, withAlpha(INK.gold, 0));
      g.fillStyle = rule;
      g.fillRect(60, 122, 1060, 2);
      g.fillStyle = withAlpha('#000000', 0.5);
      g.fillRect(60, 124, 1060, 2);

      // Content box — the tabs bite into its top edge and the goods live inside.
      chromeField(g, 34, 220, 1112, 464, 22, { x: 590, y: 244, radius: 560, strength: 0.16 });
      chromeEdge(g, 34, 220, 1112, 464, 22, 4);
      chromeClasps(g, 34, 220, 1112, 464, 22, 14, 5);
    });
  }

  /**
   * One product ROW.
   *
   * This used to be a tall showcase card, which is the wrong furniture for a
   * currency shelf: three of them left the panel mostly empty, and the only
   * places left to hang a tag were the corners — where the ribbon and the
   * value chip both ended up riding ON the frame. A row has a middle, so every
   * label sits in flow and nothing can collide with an edge.
   *
   * `hot` is the featured variant: the reference lights its chosen plate from
   * inside and brightens the metal rather than adding furniture, so the two
   * share every measurement.
   */
  private shopCard(key: string, hot: boolean): void {
    this.paint(key, 880, 112, (g) => {
      if (hot) {
        // Amber bloom bleeding out past the metal — drawn first so the edge
        // lands on top of it and the glow reads as light escaping the frame.
        // CENTRED on the plate, not on the goods: an off-centre bloom is still
        // above zero where the texture ends and shows as a rectangular halo.
        const bloom = g.createRadialGradient(440, 56, 40, 440, 56, 452);
        bloom.addColorStop(0, withAlpha(INK.ember, 0.3));
        bloom.addColorStop(0.55, withAlpha(INK.ember, 0.1));
        bloom.addColorStop(1, withAlpha(INK.ember, 0));
        g.fillStyle = bloom;
        g.fillRect(0, 0, 880, 112);
      }
      chromeField(g, 8, 6, 864, 100, 20, {
        x: 150,
        y: 56,
        radius: hot ? 260 : 210,
        strength: hot ? 0.42 : 0.22,
        warm: hot // only the featured row is lit by its own goods
      });
      chromeEdge(g, 8, 6, 864, 100, 20, 4.5, hot ? 0.32 : 0);
      chromeClasps(g, 8, 6, 864, 100, 20, 13, hot ? 6 : 5);

      // Stage shadow under the goods, so the product sits ON the row.
      const seat = g.createRadialGradient(150, 88, 4, 150, 88, 96);
      seat.addColorStop(0, 'rgba(0,0,0,0.4)');
      seat.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = seat;
      g.beginPath();
      g.ellipse(150, 88, 96, 12, 0, 0, Math.PI * 2);
      g.fill();
    });
  }

  /** Cream price plate — the one bright element on the whole panel, which is
   *  why the reference puts the number the player is deciding on inside it. */
  private shopPricePill(key: string): void {
    this.paint(key, 210, 56, (g) => {
      g.shadowColor = 'rgba(0,0,0,0.5)';
      g.shadowBlur = 10;
      g.shadowOffsetY = 4;
      this.roundRectPath(g, 6, 5, 198, 44, 22);
      const face = g.createLinearGradient(0, 5, 0, 49);
      face.addColorStop(0, '#FFF6DC');
      face.addColorStop(0.5, INK.cream);
      face.addColorStop(1, INK.creamWarm);
      g.fillStyle = face;
      g.fill();
      g.shadowColor = 'transparent';
      g.shadowBlur = 0;
      g.shadowOffsetY = 0;
      g.lineWidth = 3;
      g.strokeStyle = INK.goldMid;
      g.stroke();
      g.lineWidth = 1.4;
      g.strokeStyle = withAlpha('#FFFFFF', 0.75);
      this.roundRectPath(g, 9, 8, 192, 38, 19);
      g.stroke();
    });
  }

  /** A shelf tab. The active one is lighter, brighter-edged and open along the
   *  bottom so it merges into the content box it belongs to. */
  private shopTab(key: string, active: boolean): void {
    // The bottom 14 units are the LIP: fill with no edge, so the tab can be
    // seated over the content box's top border and erase it where it sits.
    // That overlap is the whole trick — without it the active tab floats above
    // the shelf instead of belonging to it.
    const H = 74;
    const LIP = 14;
    // An INACTIVE tab stops short of the lip and is closed all the way round, so
    // it tucks behind the shelf. Only the active one runs long and open-bottomed.
    const foot = active ? H : H - LIP;
    this.paint(key, 300, H, (g) => {
      const path = (): void => {
        g.beginPath();
        g.moveTo(6, foot);
        g.lineTo(6, 24);
        g.quadraticCurveTo(6, 6, 28, 6);
        g.lineTo(272, 6);
        g.quadraticCurveTo(294, 6, 294, 24);
        g.lineTo(294, foot);
        g.closePath();
      };
      path();
      const fill = g.createLinearGradient(0, 6, 0, foot);
      // The ACTIVE tab's lip has to land on the same value the shelf's lit top
      // edge is painted at, or the overlap shows as a darker block hanging below
      // the gold line — the exact seam the lip exists to hide.
      fill.addColorStop(0, active ? lighten(INK.fieldLift, 0.22) : INK.field);
      fill.addColorStop(1, active ? lighten(INK.fieldLift, 0.05) : INK.fieldDeep);
      g.fillStyle = fill;
      g.fill();
      g.save();
      if (active) {
        // Clip the stroke off the lip so the active tab has no bottom edge to
        // separate it from the shelf it is seated on.
        g.beginPath();
        g.rect(0, 0, 300, H - LIP);
        g.clip();
      }
      path();
      g.lineWidth = active ? 4.5 : 3;
      g.strokeStyle = INK.goldDeep;
      g.stroke();
      path();
      g.lineWidth = active ? 2.6 : 1.5;
      const crown = g.createLinearGradient(0, 6, 0, foot);
      crown.addColorStop(0, active ? INK.goldHi : withAlpha(INK.goldMid, 0.8));
      crown.addColorStop(1, active ? INK.gold : withAlpha(INK.goldMid, 0.35));
      g.strokeStyle = crown;
      g.stroke();
      g.restore();
    });
  }

  /** The EMPORIUM name plate: a gold frame with flared ends over a cream face,
   *  the one piece of signage in the shop. */
  private shopPlaque(key: string): void {
    this.paint(key, 340, 82, (g) => {
      // Flared gold surround.
      g.beginPath();
      g.moveTo(4, 20);
      g.lineTo(26, 8);
      g.lineTo(314, 8);
      g.lineTo(336, 20);
      g.lineTo(336, 62);
      g.lineTo(314, 74);
      g.lineTo(26, 74);
      g.lineTo(4, 62);
      g.closePath();
      const frame = g.createLinearGradient(0, 8, 0, 74);
      frame.addColorStop(0, INK.goldHi);
      frame.addColorStop(0.45, INK.gold);
      frame.addColorStop(1, INK.goldMid);
      g.fillStyle = frame;
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = INK.goldDeep;
      g.stroke();
      // Cream face inset.
      this.roundRectPath(g, 26, 18, 288, 46, 6);
      const face = g.createLinearGradient(0, 18, 0, 64);
      face.addColorStop(0, '#FFF3D6');
      face.addColorStop(0.5, INK.cream);
      face.addColorStop(1, '#EFC98D');
      g.fillStyle = face;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = withAlpha(INK.goldDeep, 0.75);
      g.stroke();
    });
  }

  /** Wallet chip in the title bar — a dark lozenge with a gold rim, one per
   *  currency the shop can take. */
  private shopWallet(key: string): void {
    this.paint(key, 180, 52, (g) => {
      this.roundRectPath(g, 4, 4, 172, 44, 22);
      const fill = g.createLinearGradient(0, 4, 0, 48);
      fill.addColorStop(0, INK.fieldLift);
      fill.addColorStop(1, INK.fieldDeep);
      g.fillStyle = fill;
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = INK.goldDeep;
      g.stroke();
      g.lineWidth = 1.6;
      g.strokeStyle = withAlpha(INK.gold, 0.9);
      this.roundRectPath(g, 5.5, 5.5, 169, 41, 20.5);
      g.stroke();
    });
  }

  /** Round gold close ring. */
  private shopClose(key: string): void {
    this.paint(key, 68, 68, (g) => {
      g.beginPath();
      g.arc(34, 34, 27, 0, Math.PI * 2);
      const fill = g.createLinearGradient(0, 7, 0, 61);
      fill.addColorStop(0, INK.fieldLift);
      fill.addColorStop(1, INK.fieldDeep);
      g.fillStyle = fill;
      g.fill();
      g.lineWidth = 6;
      g.strokeStyle = INK.goldDeep;
      g.stroke();
      g.lineWidth = 3.4;
      const ring = g.createLinearGradient(0, 7, 0, 61);
      ring.addColorStop(0, INK.goldHi);
      ring.addColorStop(1, INK.goldMid);
      g.strokeStyle = ring;
      g.stroke();
    });
  }

  /** Rarity/offer ribbon — a small parchment banner pinned to a card's top-left
   *  corner, with a folded tail, exactly as the reference hangs them. */
  private shopRibbon(key: string): void {
    this.paint(key, 118, 42, (g) => {
      g.save();
      g.translate(3, 9);
      g.rotate(-0.11);
      g.shadowColor = 'rgba(0,0,0,0.45)';
      g.shadowBlur = 7;
      g.shadowOffsetY = 3;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(104, 0);
      g.lineTo(97, 12);
      g.lineTo(108, 24);
      g.lineTo(0, 24);
      g.closePath();
      const face = g.createLinearGradient(0, 0, 0, 30);
      face.addColorStop(0, '#FBEEC8');
      face.addColorStop(1, '#DDBE8C');
      g.fillStyle = face;
      g.fill();
      g.shadowColor = 'transparent';
      g.shadowBlur = 0;
      g.shadowOffsetY = 0;
      g.lineWidth = 1.6;
      g.strokeStyle = withAlpha('#8A6A45', 0.7);
      g.stroke();
      g.restore();
    });
  }

  /** Kept for the UI Builder's element list — the shop no longer hangs a sash
   *  badge, but the key must still resolve to a texture. */
  private shopBadge(key: string): void {
    this.paint(key, 150, 40, (g) => {
      this.roundRectPath(g, 3, 3, 144, 34, 17);
      const grad = g.createLinearGradient(0, 3, 0, 37);
      grad.addColorStop(0, INK.fieldLift);
      grad.addColorStop(1, INK.fieldDeep);
      g.fillStyle = grad;
      g.fill();
      g.lineWidth = 2.4;
      g.strokeStyle = INK.goldMid;
      g.stroke();
    });
  }

  /** Warm pool laid under a product. The old sunburst's spinning rays were the
   *  loudest thing on the panel; the reference lights its goods with a soft
   *  glow and nothing else. */
  private shopBurst(key: string): void {
    this.paint(key, 190, 190, (g) => {
      const glow = g.createRadialGradient(95, 95, 3, 95, 95, 92);
      glow.addColorStop(0, withAlpha(INK.emberLift, 0.55));
      glow.addColorStop(0.4, withAlpha(INK.ember, 0.24));
      glow.addColorStop(1, withAlpha(INK.ember, 0));
      g.fillStyle = glow;
      g.fillRect(0, 0, 190, 190);
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

  /** Ember Emporium: a market stall — striped canopy with a scalloped hem over a
   *  cream counter, one gold coin on it. Reads as "shop" at the column's plate
   *  size while staying in the lava/cream/gold language of the rest of the HUD. */
  private iconShop(key: string): void {
    this.paint(key, 44, 44, (g) => {
      // Canopy outline, reused twice: once as a clip for the stripes, once to stroke.
      const canopy = (): void => {
        const hemY = 20;
        const left = 4;
        const right = 40;
        const bumps = 5;
        const step = (right - left) / bumps;
        g.beginPath();
        g.moveTo(8, 8);
        g.lineTo(36, 8);
        g.lineTo(right, hemY);
        for (let i = 0; i < bumps; i++) {
          const sx = right - i * step;
          g.quadraticCurveTo(sx - step / 2, hemY + 4.4, sx - step, hemY);
        }
        g.closePath();
      };

      // Counter first — the canopy paints over its top edge and reads as depth.
      this.roundRectPath(g, 9, 21, 26, 16, 3);
      const body = g.createLinearGradient(0, 21, 0, 37);
      body.addColorStop(0, lighten(P.cream, 0.28));
      body.addColorStop(1, darken(P.cream, 0.12));
      g.fillStyle = body;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = P.textBrown;
      g.stroke();

      // Striped canopy.
      g.save();
      canopy();
      g.clip();
      g.fillStyle = lighten(P.cream, 0.22);
      g.fillRect(0, 4, 44, 24);
      g.fillStyle = P.lava;
      for (let i = 0; i < 4; i++) g.fillRect(4.4 + i * 9.4, 4, 4.7, 24);
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.fillRect(0, 4, 44, 5.5);
      g.restore();
      canopy();
      g.lineWidth = 2;
      g.strokeStyle = darken(P.lavaShade, 0.25);
      g.stroke();

      // Gold coin on the counter — the universal "you can buy here" mark.
      g.beginPath();
      g.arc(22, 29.5, 5, 0, Math.PI * 2);
      const coin = g.createLinearGradient(0, 24.5, 0, 34.5);
      coin.addColorStop(0, P.goldAccent);
      coin.addColorStop(1, P.goldShade);
      g.fillStyle = coin;
      g.fill();
      g.lineWidth = 1.6;
      g.strokeStyle = darken(P.goldShade, 0.3);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.beginPath();
      g.arc(20.2, 27.7, 1.4, 0, Math.PI * 2);
      g.fill();
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
