/** The rig.json contract emitted by tools/rigger (format 'emberkeep-rig'). */

export interface RigVec {
  x: number;
  y: number;
}

export interface RigLayer {
  name: string;
  file: string;
  z: number;
  x: number;
  y: number;
  width: number;
  height: number;
  visible?: boolean;
}

export interface RigAnchor {
  name: string;
  parentLayer: string;
  childLayer: string;
  rig: RigVec;
  childOriginNorm: RigVec; // Phaser setOrigin-ready pivot inside the child art
}

export interface RigPin {
  name: string;
  layer: string;
  chain: string | null;
  order: number;
  rig: RigVec;
  norm: RigVec;
}

export interface RigDoc {
  format: 'emberkeep-rig';
  version: number;
  character: string;
  bounds: { x: number; y: number; width: number; height: number };
  root: RigVec | null;
  layers: RigLayer[];
  anchors: RigAnchor[];
  pins: RigPin[];
  images?: Record<string, string>; // file -> data URL
}

export type Facing = 'left' | 'right';

/** How a named part is animated, after resolving against the rig. */
export type ChannelVia = 'anchor' | 'pin' | 'layer' | 'skip';

export interface ResolvedPart {
  /** The layer this part drives (if any). */
  layer: string | null;
  via: ChannelVia;
  /** Origin (0..1) the layer sprite rotates around, in the layer's own art. */
  originNorm: RigVec;
  detail: string;
}

/** A pose = whole-rig transform + per-part rotation (degrees). */
export interface RigPose {
  root: { dx: number; dy: number; rotDeg: number; sx: number; sy: number };
  /** partName -> rotation degrees (only parts the preset touched). */
  partDeg: Record<string, number>;
  /** eyelid squash 0..1 (1 = open) when blink is active and eyelids exist. */
  eyelid?: number;
  /** mouth openness 0..1, recorded by the jaw() helper — consumed by rigs with
   *  face frame sets (faceAnimations); rigs with a jaw layer ignore it. */
  mouth?: number;
}
