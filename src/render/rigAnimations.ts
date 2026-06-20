import type {
  RigDoc,
  RigPose,
  RigVec,
  ResolvedPart
} from './rigTypes';

/**
 * Pure (Phaser-free) rig animation brain — the SAME adaptive resolution the
 * animator tool uses, so anything authored there plays identically in-game.
 *
 * Every part resolves through: anchor (rotate child subtree) → pin chain
 * (rotate around the chain root) → bare layer (rotate around its base) → skip.
 * The character is iso 3/4 facing LEFT in the source art; mirroring to face
 * right is a single horizontal flip applied by the renderer (scaleX = -1),
 * so the presets here never need to know the facing.
 */

const BASE_ORIGIN: RigVec = { x: 0.5, y: 0.92 };

/** Left↔right counterparts, for mirroring a missing anchor onto its twin. */
const MIRROR: Record<string, string> = {
  foot_left: 'foot_right', foot_right: 'foot_left',
  leg_left: 'leg_right', leg_right: 'leg_left',
  hand_left: 'hand_right', hand_right: 'hand_left',
  arm_left: 'arm_right', arm_right: 'arm_left',
  wing_left: 'wing_right', wing_right: 'wing_left',
  ear_left: 'ear_right', ear_right: 'ear_left',
  horn_left: 'horn_right', horn_right: 'horn_left',
  eye_left: 'eye_right', eye_right: 'eye_left',
  eyelid_left: 'eyelid_right', eyelid_right: 'eyelid_left'
};

/** Character vertical centreline (rig space) — root_ground if set, else bounds. */
export function rigRootPoint(rig: RigDoc): RigVec {
  return rig.root ?? { x: rig.bounds.x + rig.bounds.width / 2, y: rig.bounds.y + rig.bounds.height * 0.84 };
}

/** Parts the presets may drive; the player resolves these once at build time. */
export const ANIM_PARTS = [
  'head', 'jaw', 'tail',
  'wing_left', 'wing_right',
  'hand_left', 'hand_right', 'arm_left', 'arm_right',
  'foot_left', 'foot_right', 'leg_left', 'leg_right',
  'eyelid_left', 'eyelid_right'
] as const;

export function resolvePart(rig: RigDoc, part: string): ResolvedPart {
  const layer = rig.layers.find((l) => l.name === part);
  if (layer) {
    const anchor = rig.anchors.find((a) => a.childLayer === part);
    if (anchor) return { layer: part, via: 'anchor', originNorm: anchor.childOriginNorm, detail: anchor.name };
    const pins = rig.pins.filter((p) => p.layer === part && p.name !== 'root_ground').sort((a, b) => a.order - b.order);
    if (pins.length) return { layer: part, via: 'pin', originNorm: pins[0]!.norm, detail: pins[0]!.name };
    // No own joint — if the mirror limb HAS an anchor, pivot at its mirrored
    // point (a proper hip/shoulder) instead of the crude bottom-centre.
    const twin = MIRROR[part];
    const twinAnchor = twin ? rig.anchors.find((a) => a.childLayer === twin) : undefined;
    if (twinAnchor) {
      const root = rigRootPoint(rig);
      const px = 2 * root.x - twinAnchor.rig.x; // mirror across the centreline
      const py = twinAnchor.rig.y;
      return {
        layer: part, via: 'layer',
        originNorm: { x: (px - layer.x) / layer.width, y: (py - layer.y) / layer.height },
        detail: `mirror of ${twinAnchor.name}`
      };
    }
    return { layer: part, via: 'layer', originNorm: BASE_ORIGIN, detail: `${part} base` };
  }
  // No layer named `part` — maybe it's a pin CHAIN (e.g. 'tail' on body_tail).
  const chain = rig.pins
    .filter((p) => p.chain === part && p.name !== 'root_ground')
    .sort((a, b) => a.order - b.order);
  if (chain.length) {
    const root = chain[0]!;
    return { layer: root.layer, via: 'pin', originNorm: root.norm, detail: `${part} (${chain.length})` };
  }
  return { layer: null, via: 'skip', originNorm: BASE_ORIGIN, detail: '(absent)' };
}

/** Resolve every animatable part once. */
export function resolveRig(rig: RigDoc): Record<string, ResolvedPart> {
  const out: Record<string, ResolvedPart> = {};
  for (const part of ANIM_PARTS) out[part] = resolvePart(rig, part);
  return out;
}

export interface PresetContext {
  /** near-side (higher-z) parts read larger in the 3/4 iso view. */
  nearAmp(part: string, amp: number): number;
  /** whether a layer/anchor for this part exists at all. */
  has(part: string): boolean;
}

export function makePresetContext(rig: RigDoc): PresetContext {
  const zmax = Math.max(...rig.layers.map((l) => l.z), 1);
  const zOf = (part: string): number => rig.layers.find((l) => l.name === part)?.z ?? zmax * 0.5;
  const present = new Set<string>();
  for (const part of ANIM_PARTS) if (resolvePart(rig, part).via !== 'skip') present.add(part);
  return {
    nearAmp: (part, amp) => amp * (0.78 + 0.22 * (zOf(part) / zmax)),
    has: (part) => present.has(part)
  };
}

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export type PresetFn = (t: number, K: PresetContext) => RigPose;
export interface PresetDef {
  key: string;
  emoji: string;
  name: string;
  desc: string;
  fn: PresetFn;
}

function emptyPose(): RigPose {
  return { root: { dx: 0, dy: 0, rotDeg: 0, sx: 1, sy: 1 }, partDeg: {} };
}
/** jaw if present, else tilt the head back (adaptive fallback). */
function jaw(pose: RigPose, K: PresetContext, deg: number): void {
  if (K.has('jaw')) pose.partDeg['jaw'] = (pose.partDeg['jaw'] ?? 0) + deg;
  else pose.partDeg['head'] = (pose.partDeg['head'] ?? 0) - deg * 0.35;
}

export const PRESETS: PresetDef[] = [
  {
    key: 'idle', emoji: '🌿', name: 'Idle', desc: 'breathing, head sway, tail drift, blink',
    fn: (t) => {
      const p = emptyPose();
      p.root.sy = 1 + 0.004 * Math.sin(t * TAU * 0.5);
      p.root.dy = -0.7 * Math.sin(t * TAU * 0.5);
      p.partDeg['head'] = 0.7 * Math.sin(t * TAU * 0.33);
      p.wave = { tail: { amp: 9 + 3 * Math.sin(t), phase: Math.sin(t * TAU * 0.4) * 1.4 } };
      p.partDeg['wing_left'] = 2.4 * Math.sin(t * TAU * 0.5 + 0.3);
      p.partDeg['wing_right'] = -2.4 * Math.sin(t * TAU * 0.5 + 0.3); // mirror of L
      const phase = (t % 3.1) / 3.1;
      p.eyelid = phase > 0.94 ? clamp(1 - (1 - Math.abs((phase - 0.97) / 0.03)), 0.08, 1) : 1;
      return p;
    }
  },
  {
    key: 'hover', emoji: '🪽', name: 'Low flight (hover)', desc: 'lift + in-phase wing-beat + trailing tail',
    fn: (t, K) => {
      const p = emptyPose();
      const beat = t * TAU * 2.1;
      p.root.dy = -16 - 12 * Math.sin(beat);
      p.root.sx = 1 + 0.01 * Math.sin(beat);
      // Wings: Celebration-style flared-open beat (spread + pulsing, not a big
      // sweep that tucks them down), synced to the lift; both in-phase.
      const flap = Math.sin(beat);
      p.partDeg['wing_left'] = K.nearAmp('wing_left', 28) + 14 * flap;
      p.partDeg['wing_right'] = -(K.nearAmp('wing_right', 28) + 14 * flap); // mirror of L
      p.wave = { tail: { amp: 16, phase: beat * 0.5 } };
      p.partDeg['foot_left'] = 10 * Math.sin(beat) - 6;
      p.partDeg['foot_right'] = 10 * Math.sin(beat) - 6;
      p.partDeg['head'] = -3 + 2 * Math.sin(beat);
      return p;
    }
  },
  {
    key: 'celebrate', emoji: '🎉', name: 'Celebration', desc: 'hops, arm pumps, wing flare, tail wag',
    fn: (t, K) => {
      const p = emptyPose();
      const hopF = 1.7;
      const hop = Math.abs(Math.sin(t * Math.PI * hopF));
      p.root.dy = -8 * hop;
      p.root.sy = 1 + 0.012 * hop;
      p.root.sx = 1 - 0.007 * hop;
      const pump = Math.sin(t * Math.PI * hopF * 2);
      p.partDeg['hand_left'] = -38 - 18 * pump;
      p.partDeg['hand_right'] = -38 - 18 * pump;
      p.partDeg['wing_left'] = K.nearAmp('wing_left', 28) + 6 * pump;
      p.partDeg['wing_right'] = -(K.nearAmp('wing_right', 28) + 6 * pump); // mirror of L
      p.wave = { tail: { amp: 14, phase: t * TAU * 3 } };
      p.partDeg['head'] = 1.5 * Math.sin(t * Math.PI * hopF) - 1;
      const phase = (t % 1.4) / 1.4;
      p.eyelid = phase > 0.92 ? clamp(Math.abs((phase - 0.96) / 0.04), 0.1, 1) : 1;
      return p;
    }
  },
  {
    key: 'roar', emoji: '🔥', name: 'Roar / power-up', desc: 'rear back, head up, wings spread',
    fn: (t, K) => {
      const p = emptyPose();
      const k = clamp((t % 2.6) / 2.6, 0, 1);
      const rear = k < 0.35 ? k / 0.35 : 1;
      const tremble = k > 0.4 ? 0.6 * Math.sin(t * TAU * 9) * (1 - (k - 0.4) / 0.6) : 0;
      p.root.rotDeg = -6 * rear;
      p.root.dy = -8 * rear;
      p.root.sx = 1 + 0.04 * rear;
      p.root.sy = 1 + 0.05 * rear;
      p.partDeg['head'] = -16 * rear + tremble;
      jaw(p, K, 18 * rear);
      p.partDeg['wing_left'] = K.nearAmp('wing_left', 46) * rear;
      p.partDeg['wing_right'] = -K.nearAmp('wing_right', 46) * rear; // mirror of L
      p.partDeg['hand_left'] = -26 * rear + tremble;
      p.partDeg['hand_right'] = -26 * rear + tremble;
      p.wave = { tail: { amp: 8 * rear, phase: Math.PI } };
      return p;
    }
  },
  {
    key: 'stretch', emoji: '🥱', name: 'Wake / stretch', desc: 'rise from squash, yawn, one-wing stretch',
    fn: (t, K) => {
      const p = emptyPose();
      const k = clamp((t % 3.4) / 3.4, 0, 1);
      const rise = k < 0.5 ? Math.sin(k * Math.PI) : Math.sin(0.5 * Math.PI) * (1 - (k - 0.5));
      p.root.sy = 0.9 + 0.14 * rise;
      p.root.sx = 1.06 - 0.06 * rise;
      p.root.dy = 6 - 14 * rise;
      const yawn = Math.sin(clamp((k - 0.2) / 0.5, 0, 1) * Math.PI);
      p.partDeg['head'] = -10 * yawn + 4;
      jaw(p, K, 22 * yawn);
      p.partDeg['wing_left'] = K.nearAmp('wing_left', 40) * rise;
      p.partDeg['wing_right'] = -K.nearAmp('wing_right', 10) * rise; // mirror of L
      p.wave = { tail: { amp: 12 * rise, phase: k * TAU } };
      p.partDeg['hand_left'] = -14 * rise;
      return p;
    }
  },
  {
    key: 'walk', emoji: '🚶', name: 'Walk', desc: 'realistic 4-limb walk cycle (diagonal gait)',
    fn: (t) => {
      const p = emptyPose();
      const step = t * TAU * 1.5; // ~1.5 strides/sec
      const legAmp = 24, armAmp = 13;
      // Diagonal gait: back-left leg + front-right arm in phase; the other
      // diagonal is half a cycle out of phase.
      p.partDeg['foot_left'] = legAmp * Math.sin(step);
      p.partDeg['hand_right'] = armAmp * Math.sin(step);
      p.partDeg['foot_right'] = legAmp * Math.sin(step + Math.PI);
      p.partDeg['hand_left'] = armAmp * Math.sin(step + Math.PI);
      // Body: two vertical bobs per stride + a small side lean once per stride.
      p.root.dy = -5 * Math.abs(Math.sin(step)) - 2;
      p.root.rotDeg = 1.7 * Math.sin(step);
      p.partDeg['head'] = 3 * Math.sin(step + 0.4);
      p.wave = { tail: { amp: 11, phase: step + Math.PI } };
      p.partDeg['wing_left'] = 5;
      p.partDeg['wing_right'] = -5;
      return p;
    }
  }
];

export const PRESET_BY_KEY: Record<string, PresetDef> = Object.fromEntries(PRESETS.map((p) => [p.key, p]));
