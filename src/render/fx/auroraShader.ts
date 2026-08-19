/**
 * Aurora borealis — a procedural sky shader for the Borealis world.
 *
 * Nothing about an aurora suits the tools the rest of this FX layer uses. It is
 * not a sprite: it is hundreds of metres of luminous gas, semi-transparent, with
 * no edges and no repeat. A flipbook of it would loop visibly within seconds and
 * cost megabytes; particles have no coherent structure at that scale. It is a
 * field, so it is computed as one.
 *
 * ## The four things that make it read as an aurora
 *
 * 1. **RAYS.** Aurorae are electrons spiralling down magnetic field lines, so
 *    the emission is organised into near-vertical striations. The shader gets
 *    them by sampling noise at a HIGH horizontal frequency and a very LOW
 *    vertical one — features stretch along y and break up along x. Without this
 *    you have coloured fog.
 *
 * 2. **A sharp bottom edge and a soft top.** Emission stops abruptly where the
 *    electrons finally lose their energy (~100 km) and trails away upward as the
 *    air thins. `envelope()` is deliberately asymmetric; a symmetric blob is the
 *    single clearest tell of a fake aurora.
 *
 * 3. **Colour by altitude WITHIN the curtain, not by screen height.** Oxygen
 *    green (557.7 nm) dominates the body, ionised nitrogen puts a violet fringe
 *    UNDER it, and high oxygen red (630 nm) fades off the top. Indexing the ramp
 *    by the curtain's own local height means a folded curtain carries its violet
 *    fringe around the fold with it — which is exactly what real ones do, and
 *    what a screen-space gradient can never fake.
 *
 * 4. **Layered timescales.** A slow fold, a faster ray shimmer, and a surge of
 *    brightness travelling ALONG the curtain. Rates are incommensurate for the
 *    same reason the fire's flicker octaves are (see fxSignals.ts): so the sky
 *    never visibly repeats.
 *
 * ## Two rendering details that decide whether it looks "smooth"
 *
 * - **`highp`.** Large, slow gradients at mediump quantise into visible steps as
 *   they move. This shader will not look right at mediump and asks for highp.
 * - **Dither.** Even at highp the FRAMEBUFFER is 8-bit, and a smooth dark
 *   gradient across 1280 px crosses colour steps slowly enough to show banding
 *   as hard contour lines. A sub-LSB noise dither before output turns those
 *   contours back into a gradient. It is the difference between "smooth colors"
 *   and "nearly smooth colors", and it costs one hash.
 */
import Phaser from 'phaser';

import { RAMP_STOPS } from './auroraConfig';

export { RAMP_STOPS };

export const AURORA_PIPELINE = 'AuroraSky';

const FRAG = `
#define SHADER_NAME EMBERKEEP_AURORA

// Large slow gradients quantise visibly at mediump — this one needs the range.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 outTexCoord;

uniform float uTime;        // seconds since the effect started
uniform float uAspect;      // width / height of the band, keeps rays vertical

uniform vec3  uRamp[${RAMP_STOPS}];  // curtain colour, bottom -> top
uniform float uIntensity;   // master gain
uniform float uOctaves;     // fbm detail; the quality tier turns this down
uniform float uDither;      // sub-LSB noise, in 1/255 units

// Per-layer: x = seed, y = ray frequency, z = fold amplitude, w = brightness
uniform vec4  uLayerA[3];
// Per-layer: x = base height, y = thickness, z = drift speed, w = shimmer speed
uniform vec4  uLayerB[3];

uniform float uSurgeSpeed;  // brightness travelling along the curtain
uniform float uSurgeWidth;
uniform float uSurgeGain;
uniform float uFadeBottom;  // where the whole band dissolves into the sky
uniform float uAlpha;

/* ----------------------------------------------------------------- noise -- */

/**
 * Hash with NO transcendentals.
 *
 * The textbook fract(sin(p) * 43758.5) hash costs a sin per component, and
 * this shader evaluates the hash four times per noise sample, several noise
 * samples per octave, several octaves per curtain, three curtains per fragment
 * — which measured out at 8.9 ms/frame, most of it in sin. This is the
 * standard multiply-and-fract hash: pure ALU, same quality here, and it took
 * the whole effect under a millisecond.
 */
vec2 hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.x, p.y, p.x) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, vec3(p3.y, p3.z, p3.x) + 33.33);
  return -1.0 + 2.0 * fract((vec2(p3.x, p3.x) + vec2(p3.y, p3.z)) * vec2(p3.z, p3.y));
}

/** Gradient noise with QUINTIC interpolation — C2 continuous.
 *  Cubic smoothstep (C1) leaves a discontinuous second derivative, which on a
 *  slow-moving gradient this large shows up as faint moving creases. */
float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(dot(hash2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
                 dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
             mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
                 dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
}

const mat2 ROT = mat2(0.80, 0.60, -0.60, 0.80);

/**
 * Two octaves, fixed. The curtain's FOLD and the domain WARP are both
 * large-scale shapes — extra octaves there buy detail no one can see on a
 * feature that spans the whole sky, and they were a third of the shader's cost.
 * Only the rays get the full octave count.
 */
float fbmLow(vec2 p) {
  float a = gnoise(p);
  float b = gnoise(ROT * p * 2.02);
  return (a * 0.5 + b * 0.25) / 0.75;
}

/** Rotating each octave stops the lattice from lining up into visible grid
 *  structure — the classic fbm axis artefact. */
float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for (int i = 0; i < 5; i++) {
    if (float(i) >= uOctaves) break;
    sum += amp * gnoise(p);
    norm += amp;
    p = ROT * p * 2.02;
    amp *= 0.5;
  }
  return sum / max(norm, 0.0001);
}

/* --------------------------------------------------------------- curtain -- */

/** Sharp lower border, long soft trail upward. The asymmetry IS the aurora. */
float envelope(float h) {
  float bottom = smoothstep(0.0, 0.05, h);
  float top = 1.0 - smoothstep(0.18, 1.0, h);
  return bottom * top * top;
}

/** Colour by altitude inside the curtain: violet fringe under, oxygen green
 *  through the body, red-violet fading off the top. */
vec3 rampAt(float h) {
  float x = clamp(h, 0.0, 1.0) * float(${RAMP_STOPS} - 1);
  float i = floor(x);
  float f = x - i;
  // Smoothstep between stops so the ramp has no derivative kink at a stop —
  // a linear ramp shows a visible crease where two stops meet.
  f = f * f * (3.0 - 2.0 * f);
  vec3 c = uRamp[0];
  for (int k = 0; k < ${RAMP_STOPS} - 1; k++) {
    if (float(k) == i) c = mix(uRamp[k], uRamp[k + 1], f);
  }
  return c;
}

/** One curtain. Returns premultiplied colour. */
vec3 curtain(vec2 uv, vec4 a, vec4 b, float t) {
  float seed = a.x;
  float rayFreq = a.y;
  float foldAmp = a.z;
  float bright = a.w;
  float baseY = b.x;
  float thick = b.y;
  float drift = b.z;
  float shimmer = b.w;

  float x = uv.x * uAspect;

  // The curtain's lower edge folds slowly. Sampled almost purely in x, so the
  // whole sheet moves as one ribbon rather than boiling.
  float fold = fbmLow(vec2(x * 0.55 + seed, t * 0.035 + seed));
  float edge = baseY + fold * foldAmp;

  // Local height inside this curtain, 0 at its lower border.
  float h = (uv.y - edge) / max(thick, 0.001);
  if (h < -0.2 || h > 1.4) return vec3(0.0);

  // RAYS: high frequency across x, nearly none along y. The tiny y term keeps
  // them from being perfectly straight bars, which reads as a barcode.
  float warp = fbmLow(vec2(x * 0.8 + t * drift * 0.4 + seed * 2.0, t * 0.02));
  float rays = fbm(vec2(x * rayFreq + warp * 1.6 + t * drift,
                        uv.y * 0.35 + t * shimmer + seed * 3.0));
  rays = 0.5 + 0.5 * rays;
  // Sharpening turns soft noise into distinct shafts of light.
  rays = pow(clamp(rays, 0.0, 1.0), 2.2);

  float d = envelope(h) * rays * bright;
  if (d <= 0.0) return vec3(0.0);
  return rampAt(h) * d;
}

void main() {
  vec2 uv = outTexCoord;
  // y up: 0 at the bottom of the band (nearest the horizon), 1 at the top.
  vec2 p = vec2(uv.x, 1.0 - uv.y);
  float t = uTime;

  vec3 col = vec3(0.0);
  col += curtain(p, uLayerA[0], uLayerB[0], t);
  col += curtain(p, uLayerA[1], uLayerB[1], t);
  col += curtain(p, uLayerA[2], uLayerB[2], t);

  // A brightening that travels ALONG the sky rather than pulsing the whole
  // field — real displays surge from one side.
  float sx = fract(t * uSurgeSpeed);
  float d = abs(p.x - sx);
  d = min(d, 1.0 - d); // wrap, so the surge never restarts with a visible jump
  col *= 1.0 + uSurgeGain * exp(-(d * d) / max(uSurgeWidth * uSurgeWidth, 1e-5));

  col *= uIntensity * uAlpha;

  // The framebuffer is 8-bit: without this, a gradient this smooth and this
  // large lands as hard contour bands. Sub-LSB noise turns them back into a
  // gradient. Animated with time so it never reads as fixed grain.
  //
  // IT MUST BE ADDED BEFORE THE FADE, and this is not a stylistic ordering.
  // The noise is symmetric about zero, but the max(col, 0.0) below is not: it
  // clips the negative half and leaves a POSITIVE mean everywhere the aurora
  // itself is black. Added after the fade, that bias survived the fade — so the
  // band lifted the whole night sky by a fraction of a level, uniformly, all
  // the way to its bottom edge and not one pixel further. Half the sky slightly
  // brighter than the other half, divided by a dead-straight horizontal line
  // across the screen: the "bar in the middle of the sky" this fixes.
  //
  // Under the fade, the noise is part of the signal and dies with it.
  vec3 dp = fract(vec3(gl_FragCoord.xy + fract(t) * 91.7, gl_FragCoord.x) * 0.1031);
  dp += dot(dp, vec3(dp.y, dp.z, dp.x) + 33.33);
  float dith = fract((dp.x + dp.y) * dp.z);
  col += (dith - 0.5) * (uDither / 255.0);

  // Dissolve into the sky at the bottom of the band, so the effect has no edge.
  col *= smoothstep(0.0, uFadeBottom, p.y);

  col = max(col, vec3(0.0));
  // Additive: the aurora only ever ADDS light to the night sky. Alpha carries
  // luminance so the layer also composites sanely over a transparent target.
  float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

/** Per-object uniforms, read off `gameObject.pipelineData`. */
export interface AuroraPipelineData {
  time: number;
  aspect: number;
  ramp: number[]; // RAMP_STOPS * 3, linear 0..1
  intensity: number;
  octaves: number;
  dither: number;
  layerA: number[]; // 3 * vec4
  layerB: number[]; // 3 * vec4
  surgeSpeed: number;
  surgeWidth: number;
  surgeGain: number;
  fadeBottom: number;
  alpha: number;
}

export class AuroraPipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
  constructor(game: Phaser.Game) {
    super({ game, fragShader: FRAG } as Phaser.Types.Renderer.WebGL.WebGLPipelineConfig);
  }

  onBind(gameObject?: Phaser.GameObjects.GameObject): void {
    super.onBind(gameObject as Phaser.GameObjects.GameObject);
    const d = (gameObject as { pipelineData?: AuroraPipelineData } | undefined)?.pipelineData;
    if (!d || !d.ramp) return;

    // Per-object uniforms, so a batch must not span two auroras. There is never
    // more than one on screen, so flushing costs nothing.
    this.flush();

    this.set1f('uTime', d.time);
    this.set1f('uAspect', d.aspect);
    this.set1f('uIntensity', d.intensity);
    this.set1f('uOctaves', d.octaves);
    this.set1f('uDither', d.dither);
    this.set1f('uSurgeSpeed', d.surgeSpeed);
    this.set1f('uSurgeWidth', d.surgeWidth);
    this.set1f('uSurgeGain', d.surgeGain);
    this.set1f('uFadeBottom', d.fadeBottom);
    this.set1f('uAlpha', d.alpha);
    this.set3fv('uRamp', d.ramp);
    this.set4fv('uLayerA', d.layerA);
    this.set4fv('uLayerB', d.layerB);
  }
}

/** Register once per game. Safe to call repeatedly. */
export function ensureAuroraPipeline(game: Phaser.Game): boolean {
  const renderer = game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  if (!renderer || !renderer.pipelines) return false; // canvas fallback
  if (renderer.pipelines.has(AURORA_PIPELINE)) return true;
  renderer.pipelines.add(AURORA_PIPELINE, new AuroraPipeline(game));
  return true;
}
