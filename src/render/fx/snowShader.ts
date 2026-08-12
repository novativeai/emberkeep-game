/**
 * Snowfall — a procedural weather shader.
 *
 * ## Why this is not a particle emitter
 *
 * Filling a 2560×1600 sky with snow that has real depth takes on the order of
 * two thousand flakes. As sprites that is ~2000 transform writes, bounds
 * updates and quad pushes EVERY FRAME — six figures of CPU work per second —
 * and it buys nothing, because every one of those flakes is the same disc
 * following the same law. A shader gets the whole field for the fill cost of a
 * single screen quad and zero CPU per flake. The trade is that flakes cannot
 * collide or settle, which weather in this game never needed.
 *
 * ## The structure: one flake per cell, and never a neighbour lookup
 *
 * Each depth plane is a scrolling grid. A fragment finds its cell, hashes the
 * cell index into a flake, and tests one distance. The usual cost of that
 * approach is a 3×3 neighbourhood search so flakes overlapping a border are not
 * clipped — nine hashes per plane per fragment, which is most of the shader.
 *
 * This one keeps every flake INSIDE its own cell instead, by clamping the
 * centre into a margin the validator proves is wide enough
 * (`radius*stretch + sway < 0.5`). One tap, not nine. The regular spacing that
 * would normally give away is destroyed by two things: a per-ROW horizontal
 * offset (without it the flakes stand in visible columns) and five planes at
 * non-multiple grid densities, which never line up.
 *
 * ## The five things that make it read as falling snow
 *
 * 1. **Parallax by depth, on every axis at once.** Near planes are larger,
 *    faster, softer, and lean further in the wind; far planes are tiny, slow,
 *    crisp and nearly still. Getting one axis right and not the others is what
 *    makes 2-D weather look like a decal on the lens.
 * 2. **Flutter, not fall.** A snowflake is a plate, not a pebble: it slides
 *    sideways as it falls and it FLASHES as it turns edge-on. Both are here —
 *    lateral sway and a brightness pulse — at per-flake phases, so no two
 *    flakes ever agree.
 * 3. **Vertical stretch.** A fast near flake is motion-blurred into a short
 *    streak. Round flakes at speed read as floating dots.
 * 4. **Defocus.** The nearest plane is huge, soft and dim — it is out of focus,
 *    and it is the entire reason the field has depth rather than scale.
 * 5. **The shared wind.** The sideways term integrates the SAME field the fire
 *    and smoke emitters read (fxWind.ts), so a gust that leans a brazier's
 *    smoke leans the snow with it. Independent wind is the tell that the
 *    weather and the world are two different programs.
 *
 * ## Precision
 *
 * The scroll offset grows without bound (t × fall × grid — thousands of cells
 * after a few minutes) and it must NOT be wrapped: wrapping shifts every cell
 * index by one, which swaps every flake for its neighbour in a single frame.
 * So this shader asks for highp and lets the offset run. mediump loses the
 * fractional part within a minute and the snow judders.
 */
import Phaser from 'phaser';

import { MAX_PLANES } from './snowConfig';

export { MAX_PLANES };

export const SNOW_PIPELINE = 'SnowFall';

const FRAG = `
#define SHADER_NAME EMBERKEEP_SNOW

// The scroll offset runs to thousands of cells and must not be wrapped.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 outTexCoord;

uniform float uTime;      // seconds since the effect started
uniform float uAspect;    // band width / height, so cells stay square
uniform float uResY;      // band height in px — the antialias width
uniform float uPlanes;    // active depth planes; the quality tier sets this
uniform float uIntensity;
uniform float uAlpha;
uniform float uSeed;
uniform float uWind;      // integrated shared world wind, band-widths
uniform vec3  uTint;

// x = grid, y = radius, z = fall, w = drift
uniform vec4 uPlaneA[${MAX_PLANES}];
// x = coverage, y = brightness, z = softness, w = sway
uniform vec4 uPlaneB[${MAX_PLANES}];
// x = swayHz, y = tumble, z = stretch, w = windGain
uniform vec4 uPlaneC[${MAX_PLANES}];

/* ------------------------------------------------------------------ hash -- */

/** Transcendental-free hashes. The aurora measured a sin-based hash at 8.9
 *  ms/frame; this shader evaluates three per plane per fragment, so the same
 *  rule applies with more force. */
float hash1(vec2 p) {
  vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, vec3(p3.y, p3.z, p3.x) + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.x, p.y, p.x) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, vec3(p3.y, p3.z, p3.x) + 33.33);
  return -1.0 + 2.0 * fract((vec2(p3.x, p3.x) + vec2(p3.y, p3.z)) * vec2(p3.z, p3.y));
}

/**
 * Sine substitute: a smoothstep-shaped triangle wave, -1..1, period 1.
 *
 * Five ALU against a transcendental, C1 continuous at the turning points, and
 * about 2% off a true sine in the middle of the swing — which on a snowflake
 * wobbling by a few pixels is not a thing any eye resolves. Two of these run
 * per plane per fragment; a real sin there would be ten transcendentals a
 * fragment for no visible gain.
 */
float wave(float x) {
  float f = fract(x);
  float tri = abs(2.0 * f - 1.0);
  return 1.0 - 2.0 * (tri * tri * (3.0 - 2.0 * tri));
}

/* ----------------------------------------------------------------- plane -- */

float plane(vec2 uv, vec4 a, vec4 b, vec4 c, float t, float sd) {
  float grid = a.x, rad = a.y, fall = a.z, drift = a.w;
  float cover = b.x, bright = b.y, soft = b.z, swayAmp = b.w;
  float swayHz = c.x, tumble = c.y, stretch = c.z, windGain = c.w;

  // Cells square in SCREEN space, so flakes are round rather than ovals.
  vec2 q = vec2(uv.x * uAspect, uv.y) * grid;
  // outTexCoord.y is 0 at the TOP of the quad, so the SAMPLE point walks
  // backwards to make the FIELD fall forwards. Getting this sign wrong gives
  // snow that rises, which is oddly hard to notice on a still frame.
  q.y -= t * fall * grid;
  q.x -= (t * drift + uWind * windGain) * grid * uAspect;

  // Warp the lattice vertically by a smooth, low-frequency function of x.
  //
  // A flake is confined to its own cell, so between one row of cells and the
  // next there is a band no flake can reach. Left alone those bands line up
  // across the whole screen and the field reads as horizontal stripes —
  // measured at 0.35 autocorrelation on the cell period before this line, 0.13
  // after it. A per-column HASH would also break them, but it would put a hard
  // vertical seam at every column edge; a smooth warp breaks them with no seam
  // at all, for a few percent of shear on each flake.
  q.y += wave(q.x * 0.17 + sd) * 0.34 + wave(q.x * 0.061 + sd * 1.7) * 0.5;

  // Offset each ROW sideways by a fixed random amount. Skip this and the flakes
  // stand in perfectly straight columns, which is instantly readable as a grid.
  // The jump at a row boundary is invisible for the same reason the single-tap
  // lookup works: no flake ever spans one.
  float row = floor(q.y);
  q.x += hash1(vec2(row, sd)) * 23.0;

  vec2 id = vec2(floor(q.x), row);
  vec2 f = vec2(q.x - id.x, q.y - row);

  // Most cells are empty and leave here, having cost one hash.
  float pick = hash1(id + sd + 7.7);
  if (pick > cover) return 0.0;

  vec2 h = hash2(id + sd);
  // Size spread, so a plane is a population of flakes and not a stamp.
  float r = rad * (0.62 + 0.38 * fract(pick * 13.1));

  // Keep the whole flake, at the far end of its sway, inside its own cell.
  // That is what buys the single-tap lookup (see the header). The two axes get
  // different margins: sideways the flake is only r wide but it swings;
  // vertically it is r*stretch tall and it does not.
  float mx = max(0.0, 0.5 - r - swayAmp);
  float my = max(0.0, 0.5 - r * max(1.0, stretch));
  vec2 ctr = vec2(0.5) + h * vec2(mx, my);
  ctr.x += wave(t * swayHz + h.x * 3.1) * swayAmp;

  // Vertical stretch = the motion blur of a flake actually moving.
  vec2 dv = (f - ctr) * vec2(1.0, 1.0 / max(stretch, 0.05));
  float d = length(dv);

  // One pixel expressed in cell units. WebGL1 does not promise derivatives, so
  // the antialias width is computed rather than sampled with fwidth().
  float aa = grid / max(uResY, 1.0);
  float edge = max(r * soft, aa);
  float alpha = 1.0 - smoothstep(max(r - edge, 0.0), r + aa, d);
  if (alpha <= 0.0) return 0.0;

  // The plate turning edge-on and back. Rate deliberately incommensurate with
  // the sway so a flake never repeats its own little cycle.
  float flash = 1.0 - tumble * (0.5 + 0.5 * wave(t * swayHz * 1.37 + h.y * 2.7));
  return alpha * bright * flash;
}

void main() {
  vec2 uv = outTexCoord;
  float t = uTime;
  float acc = 0.0;

  for (int i = 0; i < ${MAX_PLANES}; i++) {
    if (float(i) >= uPlanes) break;
    acc += plane(uv, uPlaneA[i], uPlaneB[i], uPlaneC[i], t, float(i) * 41.7 + uSeed);
  }

  float a = clamp(acc * uIntensity, 0.0, 1.0) * uAlpha;
  // Premultiplied — Phaser's NORMAL blend is (ONE, ONE_MINUS_SRC_ALPHA).
  // Snow OCCLUDES what is behind it; additive snow would vanish over bright
  // ground and glow over dark, which is exactly backwards.
  gl_FragColor = vec4(uTint * a, a);
}
`;

/** Per-object uniforms, read off `gameObject.pipelineData`. */
export interface SnowPipelineData {
  time: number;
  aspect: number;
  resY: number;
  planes: number;
  intensity: number;
  alpha: number;
  seed: number;
  wind: number;
  tint: number[]; // vec3, 0..1
  planeA: number[]; // MAX_PLANES * vec4
  planeB: number[];
  planeC: number[];
}

export class SnowPipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
  constructor(game: Phaser.Game) {
    super({ game, fragShader: FRAG } as Phaser.Types.Renderer.WebGL.WebGLPipelineConfig);
  }

  onBind(gameObject?: Phaser.GameObjects.GameObject): void {
    super.onBind(gameObject as Phaser.GameObjects.GameObject);
    const d = (gameObject as { pipelineData?: SnowPipelineData } | undefined)?.pipelineData;
    if (!d || !d.planeA) return;

    // Per-object uniforms, so a batch must not span two snowfields. There is
    // at most one weather layer on screen, so the flush costs nothing.
    this.flush();

    this.set1f('uTime', d.time);
    this.set1f('uAspect', d.aspect);
    this.set1f('uResY', d.resY);
    this.set1f('uPlanes', d.planes);
    this.set1f('uIntensity', d.intensity);
    this.set1f('uAlpha', d.alpha);
    this.set1f('uSeed', d.seed);
    this.set1f('uWind', d.wind);
    this.set3f('uTint', d.tint[0], d.tint[1], d.tint[2]);
    this.set4fv('uPlaneA', d.planeA);
    this.set4fv('uPlaneB', d.planeB);
    this.set4fv('uPlaneC', d.planeC);
  }
}

/** Register once per game. Safe to call repeatedly. */
export function ensureSnowPipeline(game: Phaser.Game): boolean {
  const renderer = game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  if (!renderer || !renderer.pipelines) return false; // canvas fallback
  if (renderer.pipelines.has(SNOW_PIPELINE)) return true;
  renderer.pipelines.add(SNOW_PIPELINE, new SnowPipeline(game));
  return true;
}
