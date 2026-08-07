/**
 * Which eggs wear an aura, in what colour, and at what weight.
 *
 * One preset (`eggAura` in fx-emitters.json) serves every egg; this table is
 * the only thing that differs between them. That is deliberate — five presets
 * for five colours of the same effect would drift apart in five places the
 * first time anyone retuned the smoke.
 *
 * Phaser-free, so the palette ordering and the half-weight contract are things
 * a unit test can hold us to in node.
 */

/** Palette stops the preset's `palette` markers index: rim → mid → core → haze. */
export const AURA_PALETTE_STOPS = 4;

export interface EggAuraSpec {
  /** What this is, for whoever reads the JSON next. */
  label: string;
  /**
   * Colour, dark → bright: `[rim, mid, core, haze]`.
   *
   * The first three are sampled from the egg's OWN art (the mean hue of its
   * brightest saturated tenth — the emissive signature the eye actually reads
   * as "its colour"), not picked by eye, so the aura and the egg can never
   * disagree.
   *
   * `haze` is the SMOKE tint and it is deliberately pale: smoke lit by a
   * coloured glow is light grey carrying a hue, not saturated pigment. The
   * first version tinted the puffs with `mid`, which multiplied the grey smoke
   * ramp down to near-black and rendered nothing at all.
   */
  palette: string[];
  /**
   * 1 = a legendary's full weight. 0.5 = half the density and half the weight,
   * which is what an ordinary chain egg gets.
   */
  weight: number;
}

export interface EggAuraFile {
  version: number;
  /** Preset id in fx-emitters.json that every egg here instantiates. */
  preset: string;
  /** Keyed by `<chain>_<tier>` — the same id the chain tier already carries. */
  eggs: Record<string, EggAuraSpec>;
}

/** The instance shaping a weight buys. */
export interface AuraInstance {
  rate: number;
  alpha: number;
  widthScale: number;
  heightScale: number;
}

/**
 * Weight → instance shaping.
 *
 * `rate` and `alpha` are the literal reading of "half the density and half the
 * weight": half the puffs and particles released, at half the opacity. Size is
 * deliberately NOT halved — a half-size aura reads as a smaller egg rather than
 * a lesser one, so it only tightens (1.00 → 0.81), which is the difference
 * between "a lesser dragon" and "a distant one".
 */
export function auraInstanceFor(weight: number): AuraInstance {
  const w = Math.max(0, Math.min(1, weight));
  return {
    rate: w,
    alpha: w,
    widthScale: 0.62 + 0.38 * w,
    heightScale: 0.62 + 0.38 * w
  };
}

/** The `<chain>_<tier>` key an item snapshot maps to. */
export const auraKey = (chain: string, tier: number): string => `${chain}_${tier}`;

export function validateEggAuraFile(
  doc: EggAuraFile,
  knownPresets: readonly string[],
  knownItemIds: readonly string[]
): string[] {
  const errors: string[] = [];
  if (doc.version !== 1) errors.push(`version must be 1, got ${String(doc.version)}`);
  if (!doc.preset) errors.push('missing preset');
  else if (!knownPresets.includes(doc.preset)) {
    errors.push(`preset "${doc.preset}" is not in fx-emitters.json`);
  }

  const entries = Object.entries(doc.eggs ?? {});
  if (!entries.length) errors.push('no eggs');

  for (const [id, e] of entries) {
    const at = `egg "${id}"`;
    if (!e.label) errors.push(`${at}: missing label`);
    // The key IS a chain tier id. A typo here is silent at runtime — the egg
    // simply never gets an aura — so it has to fail here instead.
    if (!knownItemIds.includes(id)) errors.push(`${at}: no chain tier has this id`);
    if (e.palette?.length !== AURA_PALETTE_STOPS) {
      errors.push(`${at}: palette needs exactly ${AURA_PALETTE_STOPS} stops (rim, mid, core, haze)`);
    }
    for (const hex of e.palette ?? []) {
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) errors.push(`${at}: "${hex}" is not #rrggbb`);
    }
    // Dark → bright. The preset lays the rim on the ground and the core in the
    // air; reversed, the aura reads as a shadow with a bright edge.
    const lum = (hex: string): number => {
      const v = parseInt(hex.slice(1), 16);
      return ((v >> 16) & 255) * 0.299 + ((v >> 8) & 255) * 0.587 + (v & 255) * 0.114;
    };
    if (e.palette?.length === AURA_PALETTE_STOPS) {
      for (let i = 1; i < e.palette.length; i++) {
        if (lum(e.palette[i]) <= lum(e.palette[i - 1])) {
          errors.push(`${at}: palette must run dark → bright (stop ${i} is not brighter than ${i - 1})`);
        }
      }
    }
    if (!(e.weight > 0 && e.weight <= 1)) errors.push(`${at}: weight must be in (0, 1]`);
  }
  return errors;
}
