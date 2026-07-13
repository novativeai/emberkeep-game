/**
 * Pure (Phaser-free) half of the UI theme runtime: the ui-theme.json document
 * types plus sanitize / merge / prune logic. Unit-tested in node; theme.ts
 * (the Phaser registry) builds on top.
 */

export interface UiTextPatch {
  color?: string;
  fontSize?: number;
  fontStyle?: string;
  fontFamily?: string;
  stroke?: string;
  strokeThickness?: number;
}

export interface UiPartPatch {
  dx?: number;
  dy?: number;
  scale?: number;
  alpha?: number;
  visible?: boolean;
  /** '#RRGGBB' tint for images/shapes; null clears an inherited tint. */
  tint?: string | null;
  /** Swap the part's texture (ui_* chrome / icons). Images only. */
  texture?: string;
  /** Play a PNG sequence (built-in Laurah bank or upload) ON this image part —
   *  frames swap in place, contain-fit to the part's own footprint, so e.g. the
   *  bubble portrait becomes the talking animation. null clears it. */
  sequence?: string | null;
  /** Loop the part sequence; default = the sequence's own default. */
  loop?: boolean;
  text?: UiTextPatch;
}

export interface UiElementPatch {
  dx?: number;
  dy?: number;
  scale?: number;
  alpha?: number;
  visible?: boolean;
  depth?: number | null;
  parts?: Record<string, UiPartPatch>;
  /** Component-specific layout knobs (declared via paramsSpec at registration,
   *  e.g. the dialogue bubble's width) — consumed by the component's layout. */
  params?: Record<string, number>;
}

/* --------------------- custom (tool-authored) components --------------------- */

export type CustomLayerKind = 'image' | 'text' | 'rig' | 'anim';

/** One layer of a tool-authored component. `rig` layers are LIVE animated
 *  characters: a body motion preset plus an optional face mode. `anim` layers
 *  are uploaded PNG SEQUENCES (an After-Effects character bank) played back
 *  frame-by-frame with per-frame timing. */
export interface CustomLayer {
  kind: CustomLayerKind;
  name: string;
  x: number;
  y: number;
  scale?: number;
  /** Independent axis scaling (frames stretched on x/y). */
  scaleX?: number;
  scaleY?: number;
  /** Explicit size in game units — with `slice`, renders as a 9-slice frame
   *  (corners stay crisp at ANY w×h: the promo-popup case). */
  w?: number;
  h?: number;
  slice?: boolean;
  alpha?: number;
  angle?: number;
  visible?: boolean;
  /* image */
  texture?: string;
  tint?: string | null;
  /* text */
  text?: string;
  style?: UiTextPatch;
  /* rig (animated character) */
  character?: string;
  /** body motion preset key (idle | hover | celebrate | roar | stretch | walk) */
  body?: string;
  /** face mode: none | blink (ambient) | talk (looping mouth) */
  face?: string;
  facing?: 'left' | 'right';
  /* anim (uploaded PNG sequence) */
  /** Sequence key into doc.sequences. */
  sequence?: string;
  /** Frames per second override; falls back to the sequence's own timing. */
  fps?: number;
  /** Loop the sequence (default true) or hold on the last frame. */
  loop?: boolean;
}

/** An uploaded PNG-sequence animation (e.g. a talking-guide character bank).
 *  Self-contained: every frame is a data URL, so ui-theme.json stays one file.
 *  `durations` (ms per frame, parallel to `frames`) preserves the exact holds
 *  from a Sprite-Studio frames.json; absent ⇒ even `fps` cadence. */
export interface UiSequence {
  frames: string[];
  durations?: number[];
  fps?: number;
  width?: number;
  height?: number;
}

/** A whole component authored in the UI Builder — the game instantiates it
 *  from this JSON at boot (CustomUiManager). */
export interface CustomComponent {
  label: string;
  x: number;
  y: number;
  scale?: number;
  depth?: number;
  visible?: boolean;
  layers: CustomLayer[];
}

/** A texture-key replacement: the game repaints `key`'s canvas with the
 *  uploaded art IN PLACE — same key, same objects, same events — so swaps
 *  (hand cursor, arrow, icons…) can never break interactions. */
export interface UiReplacement {
  /** Upload name (doc.assets key). */
  src: string;
  /** Optional origin override consumed where the key's anchor matters
   *  (tutorial hand fingertip, arrow tip). */
  anchorX?: number;
  anchorY?: number;
}

export interface UiThemeDoc {
  version: number;
  /** ui_* chrome texture color params, e.g. { ui_pill: { fill: '#3A2B38' } } */
  textures: Record<string, Record<string, string>>;
  elements: Record<string, UiElementPatch>;
  /** Tool-authored components, keyed by id (element id = `custom.<id>`). */
  custom: Record<string, CustomComponent>;
  /** Uploaded art, name -> PNG data URL (self-contained in this one JSON). */
  assets: Record<string, string>;
  /** Uploaded PNG-sequence animations, name -> frames + timing. */
  sequences: Record<string, UiSequence>;
  /** Generated ui_* texture key -> replacement upload. */
  replacements: Record<string, UiReplacement>;
}

const LAYER_KINDS = new Set<string>(['image', 'text', 'rig', 'anim']);

/** Coerce a raw custom-component map into valid shape (bad layers drop). */
export function sanitizeCustom(raw: unknown): Record<string, CustomComponent> {
  const out: Record<string, CustomComponent> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [id, c] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof c !== 'object' || c === null) continue;
    const comp = c as Partial<CustomComponent>;
    if (!Array.isArray(comp.layers)) continue;
    const layers = comp.layers.filter(
      (l): l is CustomLayer =>
        typeof l === 'object' && l !== null &&
        LAYER_KINDS.has((l as CustomLayer).kind) &&
        typeof (l as CustomLayer).name === 'string' &&
        typeof (l as CustomLayer).x === 'number' &&
        typeof (l as CustomLayer).y === 'number'
    );
    out[id] = {
      label: typeof comp.label === 'string' ? comp.label : id,
      x: typeof comp.x === 'number' ? comp.x : 0,
      y: typeof comp.y === 'number' ? comp.y : 0,
      scale: typeof comp.scale === 'number' ? comp.scale : undefined,
      depth: typeof comp.depth === 'number' ? comp.depth : undefined,
      visible: typeof comp.visible === 'boolean' ? comp.visible : undefined,
      layers
    };
  }
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Coerce a raw sequence map into valid shape (bad frames/entries drop). */
export function sanitizeSequences(raw: unknown): Record<string, UiSequence> {
  const out: Record<string, UiSequence> = {};
  if (!isObj(raw)) return out;
  for (const [name, s] of Object.entries(raw)) {
    if (!isObj(s) || !Array.isArray(s.frames)) continue;
    const frames = s.frames.filter((f): f is string => typeof f === 'string' && f.startsWith('data:image/'));
    if (!frames.length) continue;
    const seq: UiSequence = { frames };
    if (Array.isArray(s.durations)) {
      const durations = s.durations.map((d) => (typeof d === 'number' && d > 0 ? d : 0));
      // Only keep durations that line up with the frames (else fall back to fps).
      if (durations.length === frames.length && durations.every((d) => d > 0)) seq.durations = durations;
    }
    if (typeof s.fps === 'number' && s.fps > 0) seq.fps = s.fps;
    if (typeof s.width === 'number' && s.width > 0) seq.width = s.width;
    if (typeof s.height === 'number' && s.height > 0) seq.height = s.height;
    out[name] = seq;
  }
  return out;
}

/** Accept any JSON shape and coerce it into a valid theme doc (bad fields drop). */
export function sanitizeThemeDoc(raw: unknown): UiThemeDoc {
  const doc: UiThemeDoc = { version: 1, textures: {}, elements: {}, custom: {}, assets: {}, sequences: {}, replacements: {} };
  if (!isObj(raw)) return doc;
  doc.custom = sanitizeCustom(raw.custom);
  doc.sequences = sanitizeSequences(raw.sequences);
  if (isObj(raw.assets)) {
    for (const [name, uri] of Object.entries(raw.assets)) {
      if (typeof uri === 'string' && uri.startsWith('data:image/')) doc.assets[name] = uri;
    }
  }
  if (isObj(raw.replacements)) {
    for (const [key, rep] of Object.entries(raw.replacements)) {
      if (isObj(rep) && typeof rep.src === 'string') {
        doc.replacements[key] = {
          src: rep.src,
          anchorX: typeof rep.anchorX === 'number' ? rep.anchorX : undefined,
          anchorY: typeof rep.anchorY === 'number' ? rep.anchorY : undefined
        };
      }
    }
  }
  if (isObj(raw.textures)) {
    for (const [key, params] of Object.entries(raw.textures)) {
      if (!isObj(params)) continue;
      const clean: Record<string, string> = {};
      for (const [p, v] of Object.entries(params)) {
        if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) clean[p] = v;
      }
      if (Object.keys(clean).length) doc.textures[key] = clean;
    }
  }
  if (isObj(raw.elements)) {
    for (const [id, patch] of Object.entries(raw.elements)) {
      if (isObj(patch)) doc.elements[id] = patch as UiElementPatch;
    }
  }
  return doc;
}

/** Deep-merge an incoming patch into an element's stored patch. */
export function mergeElementPatch(cur: UiElementPatch | undefined, add: UiElementPatch): UiElementPatch {
  const out: UiElementPatch = { ...(cur ?? {}) };
  for (const k of ['dx', 'dy', 'scale', 'alpha', 'visible', 'depth'] as const) {
    if (add[k] !== undefined) (out as Record<string, unknown>)[k] = add[k];
  }
  if (add.params) out.params = { ...(out.params ?? {}), ...add.params };
  if (add.parts) {
    out.parts = { ...(out.parts ?? {}) };
    for (const [name, p] of Object.entries(add.parts)) {
      const curPart = out.parts[name] ?? {};
      const merged: UiPartPatch = { ...curPart, ...p };
      if (p.text) merged.text = { ...(curPart.text ?? {}), ...p.text };
      out.parts[name] = merged;
    }
  }
  return out;
}

/** Drop values that equal the defaults so the saved JSON stays lean. */
export function prunePatch(p: UiElementPatch): UiElementPatch | null {
  const out: UiElementPatch = {};
  if (p.dx) out.dx = p.dx;
  if (p.dy) out.dy = p.dy;
  if (p.scale !== undefined && p.scale !== 1) out.scale = p.scale;
  if (p.alpha !== undefined && p.alpha !== 1) out.alpha = p.alpha;
  if (p.visible !== undefined) out.visible = p.visible;
  if (p.depth !== undefined && p.depth !== null) out.depth = p.depth;
  if (p.params && Object.keys(p.params).length) out.params = p.params;
  if (p.parts) {
    const parts: Record<string, UiPartPatch> = {};
    for (const [name, part] of Object.entries(p.parts)) {
      const pp: UiPartPatch = {};
      if (part.dx) pp.dx = part.dx;
      if (part.dy) pp.dy = part.dy;
      if (part.scale !== undefined && part.scale !== 1) pp.scale = part.scale;
      if (part.alpha !== undefined && part.alpha !== 1) pp.alpha = part.alpha;
      if (part.visible !== undefined) pp.visible = part.visible;
      if (part.tint !== undefined && part.tint !== null) pp.tint = part.tint;
      if (part.texture) pp.texture = part.texture;
      if (part.sequence) {
        pp.sequence = part.sequence;
        if (part.loop !== undefined) pp.loop = part.loop;
      }
      if (part.text && Object.keys(part.text).length) pp.text = part.text;
      if (Object.keys(pp).length) parts[name] = pp;
    }
    if (Object.keys(parts).length) out.parts = parts;
  }
  return Object.keys(out).length ? out : null;
}

export const hexToNum = (hex: string): number => parseInt(hex.slice(1), 16);

/** Texture key one frame of a PNG sequence is stored under (uploaded or
 *  built-in). Kept here (Phaser-free) so the sequence catalog can reference it. */
export const sequenceFrameKey = (name: string, i: number): string => `seq_${name}_${i}`;
