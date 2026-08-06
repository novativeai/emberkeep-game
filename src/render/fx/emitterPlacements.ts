/**
 * Where the emitters actually stand in the world.
 *
 * `src/data/emitters.json` is authored by the World Builder's 🔥 FX tab and
 * bundled by the game. It holds PLACEMENTS only — which preset, on which cell,
 * shaped how. The presets themselves live in `fx-emitters.json`; keeping the
 * two apart is what lets one brazier become a low wide cook-fire without
 * forking the preset roster.
 *
 * Cells are GAME cells (ingest-normalised, the same frame `characters.json`
 * uses), and `dx`/`dy` are the free nudge off the cell centre in BUILDER
 * pixels — identical units and meaning to map decor and world characters, so
 * the game rebases them by `TILE_W / map.tile.width` and a placement holds its
 * spot whatever tile size the world was authored at.
 */
import type { RigInstance } from './EmitterFX';

export interface EmitterPlacement extends Partial<RigInstance> {
  /** Stable id, so the builder can round-trip a selection. */
  id: string;
  /** Preset key in fx-emitters.json. */
  preset: string;
  /** WORLD_ID this belongs to; the engine is single-world and draws only its own. */
  world: string;
  /** Game cell [col, row]. */
  anchor: [number, number];
  /** Free nudge off the cell centre, in builder px. */
  dx?: number;
  dy?: number;
  /** Uniform size on top of `widthScale`/`heightScale`. */
  scale?: number;
  /** Master opacity. */
  alpha?: number;
  /** Ramp override — recolours every layer of the stack. */
  ramp?: string | null;
  /** Per-instance flicker seed. Two neighbours MUST differ or they pulse as one. */
  seed?: number;
  /** Author's note; ignored by the game, shown in the builder. */
  label?: string;
}

export interface EmitterPlacementFile {
  version: number;
  emitters: EmitterPlacement[];
}

export const EMPTY_PLACEMENTS: EmitterPlacementFile = { version: 1, emitters: [] };

/**
 * Structural check with real messages — run by the unit test, by the builder
 * before it applies, and by the dev endpoint before it writes. A placement file
 * that fails here would render nothing and leave the author guessing.
 */
export function validatePlacementFile(doc: EmitterPlacementFile, knownPresets: readonly string[]): string[] {
  const errors: string[] = [];
  if (doc.version !== 1) errors.push(`version must be 1, got ${String(doc.version)}`);
  if (!Array.isArray(doc.emitters)) {
    errors.push('emitters must be an array');
    return errors;
  }

  const ids = new Set<string>();
  const cells = new Map<string, string[]>();
  for (const e of doc.emitters) {
    const at = `emitter "${e.id}"`;
    if (!e.id) errors.push('an emitter has no id');
    if (ids.has(e.id)) errors.push(`${at}: duplicate id`);
    ids.add(e.id);
    if (!knownPresets.includes(e.preset)) errors.push(`${at}: unknown preset "${e.preset}"`);
    if (!e.world) errors.push(`${at}: missing world`);
    if (!Array.isArray(e.anchor) || e.anchor.length !== 2 || !e.anchor.every((n) => Number.isFinite(n))) {
      errors.push(`${at}: anchor must be [col, row]`);
    }
    for (const key of ['scale', 'widthScale', 'heightScale', 'rate'] as const) {
      const v = e[key];
      if (v !== undefined && !(v > 0)) errors.push(`${at}: ${key} must be > 0`);
    }
    if (e.alpha !== undefined && (e.alpha < 0 || e.alpha > 1)) errors.push(`${at}: alpha must be 0..1`);

    if (Array.isArray(e.anchor)) {
      const key = `${e.world}:${e.anchor[0]},${e.anchor[1]}`;
      cells.set(key, [...(cells.get(key) ?? []), e.id]);
    }
  }

  // Two emitters of the SAME preset stacked on one cell is almost always a
  // double-drop, and it reads as one emitter at double brightness rather than
  // as anything intentional. Different presets on one cell is the campfire
  // pattern and is fine.
  for (const [cell, members] of cells) {
    if (members.length < 2) continue;
    const byPreset = new Map<string, number>();
    for (const id of members) {
      const preset = doc.emitters.find((e) => e.id === id)?.preset ?? '';
      byPreset.set(preset, (byPreset.get(preset) ?? 0) + 1);
    }
    for (const [preset, n] of byPreset) {
      if (n > 1) errors.push(`cell ${cell}: ${n}× preset "${preset}" stacked (${members.join(', ')})`);
    }
  }
  return errors;
}

/** Fill in every optional field, so callers never branch on `undefined`. */
export function resolvePlacement(e: EmitterPlacement): Required<Omit<EmitterPlacement, 'label'>> & { label: string } {
  return {
    id: e.id,
    preset: e.preset,
    world: e.world,
    anchor: e.anchor,
    dx: e.dx ?? 0,
    dy: e.dy ?? 0,
    scale: e.scale ?? 1,
    alpha: e.alpha ?? 1,
    ramp: e.ramp ?? null,
    // Derived from the id rather than random, so a reload reproduces the exact
    // same flicker — a placement that looks different every launch is not a
    // placement, it is a slot machine.
    seed: e.seed ?? seedFromId(e.id),
    widthScale: e.widthScale ?? 1,
    heightScale: e.heightScale ?? 1,
    tiltDeg: e.tiltDeg ?? 0,
    flipX: e.flipX ?? false,
    groundRotDeg: e.groundRotDeg ?? 0,
    rate: e.rate ?? 1,
    windInfluence: e.windInfluence ?? null,
    label: e.label ?? ''
  };
}

/** Stable 31-bit seed from a placement id. */
export function seedFromId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return (h >>> 1) % 1_000_000;
}
