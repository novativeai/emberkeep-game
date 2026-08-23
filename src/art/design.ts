import { darken, hexToRgb, lighten, withAlpha } from './colors';

/**
 * The Emberkeep design system — the single source of truth for how every UI
 * surface looks.
 *
 * ## Why this exists
 *
 * The game shipped with two competing looks. The board's `PALETTE` (cream
 * panels, lava rims, gold pin-lines) dressed the Ledger, Cookbook, Store, Bag
 * and HUD; the Ember Emporium left it behind for a lit plum interior sampled
 * off concept art. The Emporium is the one that reads as a premium merge game,
 * and every attempt to express it in the board's cream and lava produced a
 * panel that looked like a recoloured Ledger. So the Emporium's language won,
 * and this module is that language promoted from one screen's private ink to
 * the system every screen is built from.
 *
 * `PALETTE` is NOT deprecated — it is the BOARD's palette and still owns the
 * world: tiles, items, dragons, fog, particles. This module owns the CHROME
 * the player reads through. A board item painted in `INK` would vanish into
 * the isle; a panel painted in `PALETTE` reads as cheap. Keep the line.
 *
 * ## Units — read this before painting
 *
 * Two coordinate spaces are in play and mixing them is the classic bug here:
 *
 * - **Logical units** — what `TextureFactory.paint()` draws in. The canvas is
 *   created at `size * RES`, so 1 logical unit renders as `RES` (2) pixels.
 *   `EDGE`, `RADIUS_TEX` and every primitive in this file are logical.
 * - **Game units** — what scenes, containers and font sizes use. The canvas is
 *   2560x1600 of these. `TYPE`, `SPACE` and `RADIUS` are game units.
 *
 * A game unit is a logical unit x RES. If a stroke looks twice as thick as
 * intended, this is why.
 *
 * ## Reference
 *
 * `assets/raw/ui-kit/generations/kit-v1.png` — the component sheet these
 * values are drawn from, and the thing to check new chrome against.
 */

/* ============================== colour ============================== */

/**
 * Every colour the UI chrome is allowed to use.
 *
 * The model is a lit room: a cool plum hall, gold hardware catching the light,
 * cream plates that carry dark type, and warm ember reserved for the goods and
 * for exactly one call to action per screen. The discipline that keeps it from
 * going copper is that **ember never fills a field** — light the hall cool and
 * the wares warm, or the whole panel turns orange and the plum it is built on
 * disappears.
 */
const INK_BASE = {
  /* -- surface: the plum hall every panel is an interior of -- */
  /** The field itself, its lit top, and the black it sinks to at the edges. */
  field: '#241B23',
  fieldLift: '#3B2B34',
  fieldDeep: '#150F14',
  /** The hall's own light — COOL. Used for the lift on every field. */
  fieldGlow: '#6E5468',
  /** Full-screen dim behind a modal. */
  scrim: '#0B070A',

  /* -- metal: milled gold, four stops from crown to seat -- */
  goldHi: '#F5C88F',
  gold: '#D9A05F',
  goldMid: '#A3693B',
  goldDeep: '#4A2E18',

  /* -- plate: the cream faces that carry dark type -- */
  cream: '#F7DFAF',
  creamWarm: '#EFC98D',
  creamHi: '#FFF3D8',

  /* -- accent: warm light. Goods, and ONE call to action. Never a field. -- */
  ember: '#FF9A3C',
  emberLift: '#FFC178',
  emberDeep: '#8A3D12',

  /* -- semantic: state, not decoration -- */
  /** Earned, affordable, complete. */
  gain: '#9BD06A',
  gainDeep: '#3E5A2B',
  /** Cost, refusal, danger. */
  spend: '#E8503C',
  spendDeep: '#7A2A1E',
  /** Locked / disabled — drained of colour, never a different silhouette. */
  idle: '#8A7E86',
  idleDeep: '#4A424A',

  /* -- type: named by the surface it sits ON, so a wrong pairing is obvious -- */
  /** Dark ink on a cream plate. */
  onPlate: '#3A2416',
  onPlateDim: '#7A5A3C',
  /** Cream on the plum field. */
  onField: '#F6E7C9',
  onFieldDim: '#A99177',
  onFieldGold: '#F5C88F'
} as const;

export type InkKey = keyof typeof INK_BASE;

/** The authored values — the reset target, never written to. */
export const INK_DEFAULTS: Readonly<Record<InkKey, string>> = INK_BASE;

/**
 * The LIVE tokens. Read `INK.field` everywhere; write only through
 * `setInkOverrides`, which is the UI Builder's single tuning surface.
 *
 * Making the tokens the themable thing (rather than each texture's own
 * rim/fill knobs, as before) is the whole point: a picker per panel is how the
 * chrome drifted apart in the first place. Move `gold` here and every frame,
 * clasp, rim and progress cap in the game moves with it.
 */
export const INK: Record<InkKey, string> = { ...INK_BASE };

/** Apply a token override set (missing keys fall back to the authored value). */
export function setInkOverrides(next: Record<string, string>): void {
  for (const key of Object.keys(INK_DEFAULTS) as InkKey[]) {
    INK[key] = next[key] ?? INK_DEFAULTS[key];
  }
}

/**
 * Every chrome texture the design system paints. Editing a design token
 * repaints all of them together — that is what makes it a system rather than a
 * folder of similar-looking pictures.
 */
export const CHROME_KEYS = [
  'ui_panel',
  'ui_card',
  'ui_pill',
  'ui_slot',
  'ui_btn_round',
  'ui_btn_round_royal',
  'ui_btn_play',
  'ui_btn_green',
  'ui_btn_price',
  'ui_btn_free',
  'ui_store_panel',
  'ui_panel_tall',
  'ui_quest_panel',
  'ui_shop_panel',
  'ui_shop_card',
  'ui_shop_card_hot',
  'ui_shop_price',
  'ui_shop_price_free',
  'ui_shop_tab',
  'ui_shop_tab_on',
  'ui_shop_plaque',
  'ui_shop_wallet',
  'ui_shop_close',
  'ui_shop_ribbon',
  'ui_shop_badge',
  'ui_shop_burst'
] as const;

/** The pseudo-key the UI Builder edits design tokens under. */
export const DESIGN_KEY = 'design';

/**
 * What the UI Builder can tune.
 *
 * There used to be one entry per chrome texture, each with its own
 * rim/fill/border pickers — and that is precisely how the UI drifted into a
 * recoloured board: given a fill picker per panel, every panel got tuned on
 * its own until no two shared a material. There is now exactly ONE entry, the
 * design tokens, and editing it repaints every chrome key at once.
 */
export const UI_TEXTURE_PARAMS: Record<string, Record<string, string>> = {
  [DESIGN_KEY]: { ...INK_DEFAULTS }
};

/* =============================== type =============================== */

/**
 * The two voices, each with a job.
 *
 * `display` (serif) is the storybook: proper nouns, panel titles, a dragon's
 * name. `ui` (sans) is everything the player reads in order to ACT — numbers,
 * buttons, counters, labels. Before this, ten files each declared their own
 * `FONT` const and two of them silently disagreed, so the Bag spoke in serif
 * while the Ledger next to it spoke in sans for no reason anyone chose.
 */
export const FONT = {
  ui: 'Trebuchet MS, Verdana, sans-serif',
  display: 'Georgia, "Times New Roman", serif'
} as const;

/**
 * Type ramp, in GAME units (what `fontSize` takes).
 *
 * Nine steps on a ~1.17 ratio. The sizes are chosen to sit within a few pixels
 * of what the screens already used, so adopting the ramp re-flows nothing —
 * the point is that the NEXT label picks a step instead of inventing a 31px.
 */
export const TYPE = {
  micro: 22,
  tiny: 26,
  label: 30,
  body: 34,
  sub: 40,
  heading: 46,
  title: 54,
  display: 64,
  hero: 76
} as const;

/** Snap an arbitrary size onto the nearest ramp step. */
export function typeStep(size: number): number {
  const steps = Object.values(TYPE);
  return steps.reduce((best, s) => (Math.abs(s - size) < Math.abs(best - size) ? s : best), steps[0]!);
}

/**
 * The type colour a given background can actually carry.
 *
 * Buttons and chips in this system are drawn in whatever token the caller
 * hands them, and the label colour has to follow — a cream label on a gold
 * face is weak, a dark label on a plum face is invisible. Deciding it from the
 * face's luminance means a caller can swap a tone without also remembering to
 * swap the ink, which is exactly the pairing that keeps going wrong by hand.
 */
export function inkOn(background: string): string {
  const [r, g, b] = hexToRgb(background);
  // Rec. 601 luma — close enough for a two-way choice, and cheap.
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255 > 0.55 ? INK.onPlate : INK.onField;
}

/* ============================== metrics ============================== */

/** Spacing scale in GAME units — component layout, gaps, padding. */
export const SPACE = {
  xs: 8,
  sm: 16,
  md: 24,
  lg: 36,
  xl: 56,
  xxl: 84
} as const;

/** Corner radii in GAME units (component-drawn Graphics). */
export const RADIUS = {
  sm: 16,
  md: 28,
  lg: 44,
  xl: 60,
  /**
   * Capsule, for the CANVAS painters only.
   *
   * `roundRectPath` clamps to `min(r, w/2, h/2)`, so an absurd radius is safe
   * there. **Phaser's `Graphics.fillRoundedRect` does NOT clamp** — handed 999
   * on an 84-tall rect it throws stray geometry clear across the screen (the
   * Codex shipped a session with orange lines over the whole canvas for
   * exactly this). In a Graphics call, write `h / 2` instead.
   */
  pill: 999
} as const;

/** Corner radii in LOGICAL units (painters). Half of RADIUS, by definition. */
export const RADIUS_TEX = {
  sm: 8,
  md: 14,
  lg: 22,
  xl: 30
} as const;

/**
 * Edge weights in LOGICAL units. `chromeEdge` spends the weight across three
 * strokes, so these read heavier than a plain `lineWidth` of the same value.
 */
export const EDGE = {
  hair: 2,
  thin: 3.5,
  base: 4.5,
  bold: 6,
  heavy: 8
} as const;

/**
 * Scrim alphas for the dim behind a modal. `panel` is the standard; `focus` is
 * the heavier dim used when one element must be isolated (the Bag's chooser
 * dims its siblings so the popover reads as the only live thing).
 */
export const SCRIM = { panel: 0.55, focus: 0.32 } as const;

/* ============================= primitives ============================= */

type Ctx2D = CanvasRenderingContext2D;

/** Rounded-rect path. Every primitive below builds on this one. */
export function roundRectPath(g: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/**
 * Milled gold edge — the signature of the whole system.
 *
 * THREE concentric strokes, not one gradient stroke: a dark seat the metal sits
 * in, a crown lit from above, and a dark inner lip where it meets the face. A
 * single stroke of gold gradient reads as a coloured outline at every size; the
 * three-stroke build reads as cast metal, which is the entire difference
 * between this and the chrome it replaced.
 *
 * `bright` (0..1) lifts the crown for a hot/featured frame.
 */
export function chromeEdge(
  g: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  weight: number = EDGE.bold,
  bright = 0
): void {
  roundRectPath(g, x, y, w, h, r);
  g.lineWidth = weight;
  g.strokeStyle = INK.goldDeep;
  g.stroke();

  roundRectPath(g, x, y, w, h, r);
  g.lineWidth = Math.max(1, weight - 2.4);
  const crown = g.createLinearGradient(0, y, 0, y + h);
  crown.addColorStop(0, lighten(INK.goldHi, bright));
  crown.addColorStop(0.3, lighten(INK.gold, bright * 0.6));
  crown.addColorStop(0.68, INK.goldMid);
  crown.addColorStop(1, lighten(INK.gold, bright * 0.4));
  g.strokeStyle = crown;
  g.stroke();

  roundRectPath(g, x + weight / 2, y + weight / 2, w - weight, h - weight, Math.max(0, r - weight / 2));
  g.lineWidth = 1.6;
  g.strokeStyle = 'rgba(16,10,14,0.7)';
  g.stroke();
}

/**
 * Corner clasps — thicker runs of the edge that follow the corner radius and
 * die away along both sides, so they read as hardware bolted onto the frame
 * rather than as a decorative line. Every framed surface in the system wears
 * them; it is what makes two unrelated panels look like the same product.
 */
export function chromeClasps(
  g: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  run: number,
  weight: number
): void {
  const corners: Array<[number, number, number, number]> = [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1]
  ];
  g.lineCap = 'round';
  for (const [cx, cy, sx, sy] of corners) {
    g.beginPath();
    g.moveTo(cx + sx * (r + run), cy);
    g.lineTo(cx + sx * r, cy);
    g.quadraticCurveTo(cx, cy, cx, cy + sy * r);
    g.lineTo(cx, cy + sy * (r + run));
    g.lineWidth = weight;
    g.strokeStyle = INK.goldDeep;
    g.stroke();
    g.lineWidth = Math.max(1, weight - 2.2);
    const clasp = g.createLinearGradient(cx, cy, cx + sx * r, cy + sy * r);
    clasp.addColorStop(0, INK.goldHi);
    clasp.addColorStop(1, INK.goldMid);
    g.strokeStyle = clasp;
    g.stroke();
  }
  g.lineCap = 'butt';
}

/** Where the light falls on a field. `warm` is for GOODS only — see `INK`. */
export interface Lift {
  x: number;
  y: number;
  radius: number;
  strength?: number;
  warm?: boolean;
}

/**
 * The plum interior every framed surface is filled with: a vertical ramp from
 * lit top to sunken bottom, an optional pool of light where the lamp falls, and
 * a corner vignette so the surface sinks into black at its edges.
 */
export function chromeField(
  g: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  lift: Lift | null = null
): void {
  roundRectPath(g, x, y, w, h, r);
  const base = g.createLinearGradient(0, y, 0, y + h);
  base.addColorStop(0, INK.fieldLift);
  base.addColorStop(0.28, INK.field);
  base.addColorStop(1, INK.fieldDeep);
  g.fillStyle = base;
  g.fill();

  if (lift) {
    g.save();
    roundRectPath(g, x, y, w, h, r);
    g.clip();
    const pool = g.createRadialGradient(lift.x, lift.y, 2, lift.x, lift.y, lift.radius);
    const tint = lift.warm ? INK.emberLift : INK.fieldGlow;
    const s = lift.strength ?? 0.5;
    pool.addColorStop(0, withAlpha(tint, s));
    pool.addColorStop(0.55, withAlpha(tint, s * 0.32));
    pool.addColorStop(1, withAlpha(tint, 0));
    g.fillStyle = pool;
    g.fillRect(x, y, w, h);
    g.restore();
  }

  g.save();
  roundRectPath(g, x, y, w, h, r);
  g.clip();
  const vig = g.createRadialGradient(
    x + w / 2,
    y + h / 2,
    Math.min(w, h) * 0.2,
    x + w / 2,
    y + h / 2,
    Math.max(w, h) * 0.68
  );
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.62)');
  g.fillStyle = vig;
  g.fillRect(x, y, w, h);
  g.restore();
}

/** Tone of a cream plate — what the surface is SAYING, not how it is drawn. */
export type PlateTone = 'cream' | 'gain' | 'spend' | 'ember' | 'idle';

const PLATE_TONES: Record<PlateTone, { hi: string; lo: string; ink: string }> = {
  cream: { hi: INK.creamHi, lo: INK.creamWarm, ink: INK.onPlate },
  gain: { hi: lighten(INK.gain, 0.3), lo: darken(INK.gain, 0.18), ink: '#1F2E12' },
  spend: { hi: lighten(INK.spend, 0.28), lo: darken(INK.spend, 0.2), ink: '#3A0F08' },
  ember: { hi: INK.emberLift, lo: darken(INK.ember, 0.18), ink: '#3A1A05' },
  idle: { hi: lighten(INK.idle, 0.2), lo: darken(INK.idle, 0.22), ink: '#2A252A' }
};

/** The dark ink a given plate tone expects its label to be drawn in. */
export function plateInk(tone: PlateTone = 'cream'): string {
  return PLATE_TONES[tone].ink;
}

/**
 * A raised plate — the button/price/name surface that carries dark type.
 *
 * Built the way the reference sheet builds it: milled gold rim, a dark keyline
 * just inside it, then the face. The keyline is doing real work — without it
 * the cream bleeds into the gold and both go flat, which is why a plain
 * "gold stroke around a cream fill" never looked right.
 */
export function chromePlate(
  g: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  opts: { tone?: PlateTone; weight?: number; glow?: boolean } = {}
): void {
  const tone = PLATE_TONES[opts.tone ?? 'cream'];
  const weight = opts.weight ?? EDGE.bold;

  if (opts.glow) chromeGlow(g, x, y, w, h, INK.ember, 0.55);

  chromeEdge(g, x, y, w, h, r, weight, opts.glow ? 0.35 : 0.12);

  const inset = weight * 0.9;
  roundRectPath(g, x + inset, y + inset, w - inset * 2, h - inset * 2, Math.max(0, r - inset));
  g.lineWidth = 2.2;
  g.strokeStyle = withAlpha(INK.fieldDeep, 0.85);
  g.stroke();

  const fi = inset + 1.6;
  roundRectPath(g, x + fi, y + fi, w - fi * 2, h - fi * 2, Math.max(0, r - fi));
  const face = g.createLinearGradient(0, y, 0, y + h);
  face.addColorStop(0, tone.hi);
  face.addColorStop(0.42, lighten(tone.hi, 0.06));
  face.addColorStop(1, tone.lo);
  g.fillStyle = face;
  g.fill();

  // Specular along the top third — the plate is lit from above like everything
  // else in the hall, and without it a big face reads as flat paper.
  g.save();
  roundRectPath(g, x + fi, y + fi, w - fi * 2, h - fi * 2, Math.max(0, r - fi));
  g.clip();
  const spec = g.createLinearGradient(0, y + fi, 0, y + h * 0.45);
  spec.addColorStop(0, 'rgba(255,255,255,0.42)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = spec;
  g.fillRect(x, y, w, h * 0.5);
  g.restore();
}

/**
 * Outer bloom around a rect. ALWAYS centred on the rect, never on its contents:
 * a radial seeded off-centre is still above zero where the texture ends, and
 * shows up as a rectangular halo with visibly straight edges.
 */
export function chromeGlow(
  g: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  strength = 0.4
): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const radius = Math.hypot(w, h) * 0.62;
  const bloom = g.createRadialGradient(cx, cy, Math.min(w, h) * 0.3, cx, cy, radius);
  bloom.addColorStop(0, withAlpha(color, strength));
  bloom.addColorStop(0.55, withAlpha(color, strength * 0.34));
  bloom.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = bloom;
  g.fillRect(x - w, y - h, w * 3, h * 3);
}

/**
 * A recessed trough — slots, progress tracks, anything the eye should read as
 * cut INTO the panel rather than sitting on it. The inverted light (dark at the
 * top, lifting toward the bottom) is what sells the depth.
 */
export function chromeInset(g: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  roundRectPath(g, x, y, w, h, r);
  const fill = g.createLinearGradient(0, y, 0, y + h);
  fill.addColorStop(0, INK.fieldDeep);
  fill.addColorStop(0.65, darken(INK.field, 0.15));
  fill.addColorStop(1, INK.field);
  g.fillStyle = fill;
  g.fill();

  g.save();
  roundRectPath(g, x, y, w, h, r);
  g.clip();
  const shade = g.createLinearGradient(0, y, 0, y + h * 0.5);
  shade.addColorStop(0, 'rgba(0,0,0,0.55)');
  shade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = shade;
  g.fillRect(x, y, w, h);
  g.restore();

  roundRectPath(g, x, y, w, h, r);
  g.lineWidth = 2.4;
  g.strokeStyle = withAlpha(INK.goldDeep, 0.9);
  g.stroke();
}

/** Drop shadow helper — set, draw, clear. Panels float; nothing sits flat. */
export function withShadow(g: Ctx2D, blur: number, offsetY: number, draw: () => void, alpha = 0.55): void {
  g.shadowColor = `rgba(11,7,10,${alpha})`;
  g.shadowBlur = blur;
  g.shadowOffsetY = offsetY;
  draw();
  g.shadowColor = 'transparent';
  g.shadowBlur = 0;
  g.shadowOffsetY = 0;
}
