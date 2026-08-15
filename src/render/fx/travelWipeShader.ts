/**
 * Travel wipe — the screen burns away into isometric diamonds when the Keeper
 * crosses between worlds, and reassembles on the far side.
 *
 * ## The technique, and where it comes from
 *
 * This is the classic CUTOFF WIPE (the Pokémon battle-transition pattern): a
 * fullscreen fragment shader computes a per-pixel ignition value, compares it
 * against one animated `uProgress` uniform, and that comparison IS the whole
 * animation. One quad, one tweened uniform, no textures to fetch, nothing
 * resident outside the journey — the lightest transition a WebGL game can run,
 * and the only kind that stays crisp at every aspect ratio (an authored wipe
 * texture would blur or letterbox on a portrait phone; this field is computed
 * in live-space units and cannot).
 *
 * The field itself is the diamond-grid sweep (DDRKirby's shader-transition
 * write-up) bent to Emberkeep: the screen tiles with 2:1 diamonds — the
 * board's own tile shape — on TWO interleaved lattices. Each pixel belongs to
 * the nearer lattice's diamond, and diamonds inscribed at Manhattan radius 0.5
 * on both lattices tile the plane exactly, so grown diamonds seat edge-to-edge
 * the way board tiles do instead of leaving star-shaped gaps. Diamonds ignite
 * in radial order from the screen centre (the travel prompt the player just
 * tapped lives there) with a per-cell hash jitter so the front feels like fire
 * catching, not a machined iris.
 *
 * Three details make it read as EMBER rather than geometry:
 * - The growth front wears a heat rim — goldAccent at the very edge cooling
 *   through lava — with a per-diamond flicker, and a faint warm spill lands
 *   ADDITIVELY on the world still visible just outside the front.
 * - The rim cools to nothing as the cover completes (`heat`), so the held
 *   curtain is a still night with a soft vignette, never a glowing grid.
 * - `uInvert` flips the ignition ORDER for the reveal: driven back 1→0 the
 *   curtain opens at the centre first — the player arrives looking at the new
 *   world's heart, not its corners. Both phases agree at progress 1, so the
 *   flip during the covered hold cannot pop a single pixel.
 */
import Phaser from 'phaser';

import { hexToInt } from './fxSignals';

export const TRAVEL_WIPE_PIPELINE = 'TravelWipe';

/** '#rrggbb' -> 0..1 triple for the shader uniforms. */
export const wipeRgb = (hex: string): [number, number, number] => {
  const v = hexToInt(hex);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

const FRAG = `
#define SHADER_NAME EMBERKEEP_TRAVEL_WIPE

precision mediump float;

varying vec2 outTexCoord;

uniform float uProgress; // 0 = clear -> 1 = fully covered
uniform float uInvert;   // 0: ignite from centre (cover) · 1: from edges (reveal opens at centre)
uniform float uTime;     // seconds; only the rim flicker reads it
uniform float uAspect;   // live width / height
uniform float uCellW;    // diamond width, in units of screen height
uniform float uGrow;     // fraction of the timeline one diamond takes to grow
uniform float uJitter;   // per-diamond ignition jitter, fraction of the timeline
uniform float uEdge;     // ember rim thickness, in cell units
uniform float uAlpha;    // master fade (the failsafe path drives it)
uniform vec3  uNight;    // curtain body
uniform vec3  uDeep;     // curtain body at the vignette's heart
uniform vec3  uLava;     // rim, cooled
uniform vec3  uAccent;   // rim, at the burning edge

/** The aurora's multiply-and-fract hash — pure ALU, no transcendentals. */
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, vec3(p3.y, p3.z, p3.x) + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // Height-unit space: y spans [0,1], x spans [0,aspect] — the diamonds stay
  // 2:1 in PIXELS on every device, like the board's own tiles.
  vec2 p = vec2(outTexCoord.x * uAspect, outTexCoord.y);
  vec2 c = vec2(uAspect * 0.5, 0.5);

  // Two interleaved diamond lattices; each pixel takes the nearer one.
  vec2 g = vec2(p.x / uCellW, p.y / (uCellW * 0.5));
  vec2 iA = floor(g);
  vec2 fA = fract(g) - 0.5;
  float mA = abs(fA.x) + abs(fA.y);
  vec2 iB = floor(g + 0.5);
  vec2 fB = fract(g + 0.5) - 0.5;
  float mB = abs(fB.x) + abs(fB.y);
  float useB = step(mB, mA);
  float m = mix(mA, mB, useB);       // 0 at this diamond's centre, 0.5 at its rim
  vec2 gc = mix(iA + 0.5, iB, useB); // this diamond's centre, in lattice units
  // Seed offset so the two lattices never share a jitter value.
  vec2 id = gc + useB * vec2(37.0, 91.0);

  // Ignition order: radial from the screen centre, jittered per diamond.
  // Normalised so the LAST diamond finishes growing exactly at progress 1.
  vec2 cellP = gc * vec2(uCellW, uCellW * 0.5);
  float d = distance(cellP, c) / length(c);
  d = mix(d, 1.0 - d, uInvert);
  float t0 = (d + hash(id) * uJitter) / (1.0 + uJitter) * (1.0 - uGrow);
  // 0.53, not 0.5: a whisker of overshoot seals the lattice seams at full
  // cover — at exactly 0.5 every seam pixel would hold at half alpha.
  float reach = clamp((uProgress - t0) / uGrow, 0.0, 1.0) * 0.53;
  // Nothing shows before a diamond's own ignition — without this gate the
  // anti-aliased edge would print a dot at every cell centre at progress 0.
  float lit = smoothstep(0.0, 0.015, reach);

  float front = reach - m; // <0 outside the burn, >0 inside
  float covered = smoothstep(-0.012, 0.012, front) * lit;

  // Heat lives only while THIS diamond is still growing. A grown diamond's
  // seam pixels keep a small positive front forever, so gating the rim on the
  // front alone leaves the whole cover burning as a grid (measured - the first
  // cut did exactly that); gating on the cell's own completion confines the
  // ember to the travelling edge, with still night behind it.
  float done = smoothstep(0.75, 1.0, reach / 0.53);
  float heat = smoothstep(0.98, 0.86, uProgress) * (1.0 - done);
  float rt = clamp(front / uEdge, 0.0, 1.0); // 0 at the rim -> 1 interior
  float flick = 0.82 + 0.28 * sin(uTime * 9.0 + hash(id) * 41.0);
  vec3 ember = mix(uAccent, uLava, smoothstep(0.0, 0.65, rt)) * flick;
  vec3 body = mix(uDeep, uNight, smoothstep(0.1, 0.85, distance(p, c) / length(c)));
  vec3 inside = mix(ember, body, max(smoothstep(0.35, 1.0, rt), 1.0 - heat));

  // Warm spill just outside the front: alpha-free, so it lands additively on
  // the world that is still showing through.
  float halo = smoothstep(-uEdge * 0.9, 0.0, front) * (1.0 - covered) * heat * lit;

  vec3 rgb = inside * covered + uAccent * flick * halo * 0.4;
  // Premultiplied, like every custom pipeline here.
  gl_FragColor = vec4(rgb, covered) * uAlpha;
}
`;

/** Per-object uniforms, read off `gameObject.pipelineData` every bind — the
 *  veil tweens `progress` (and `time`) and the shader follows. */
export interface TravelWipePipelineData {
  progress: number;
  invert: number;
  time: number;
  aspect: number;
  cellW: number;
  grow: number;
  jitter: number;
  edge: number;
  alpha: number;
  night: [number, number, number];
  deep: [number, number, number];
  lava: [number, number, number];
  accent: [number, number, number];
}

export class TravelWipePipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
  constructor(game: Phaser.Game) {
    super({ game, fragShader: FRAG } as Phaser.Types.Renderer.WebGL.WebGLPipelineConfig);
  }

  onBind(gameObject?: Phaser.GameObjects.GameObject): void {
    super.onBind(gameObject as Phaser.GameObjects.GameObject);
    const d = (gameObject as { pipelineData?: TravelWipePipelineData } | undefined)?.pipelineData;
    if (!d) return;

    // Per-object uniforms, so a batch must not span two wipes. There is never
    // more than one on screen, so flushing costs nothing.
    this.flush();

    this.set1f('uProgress', d.progress);
    this.set1f('uInvert', d.invert);
    this.set1f('uTime', d.time);
    this.set1f('uAspect', d.aspect);
    this.set1f('uCellW', d.cellW);
    this.set1f('uGrow', d.grow);
    this.set1f('uJitter', d.jitter);
    this.set1f('uEdge', d.edge);
    this.set1f('uAlpha', d.alpha);
    this.set3f('uNight', d.night[0], d.night[1], d.night[2]);
    this.set3f('uDeep', d.deep[0], d.deep[1], d.deep[2]);
    this.set3f('uLava', d.lava[0], d.lava[1], d.lava[2]);
    this.set3f('uAccent', d.accent[0], d.accent[1], d.accent[2]);
  }
}

/** Register once per game. Safe to call repeatedly. False on Canvas — the
 *  veil falls back to its plain alpha fade there. */
export function ensureTravelWipePipeline(game: Phaser.Game): boolean {
  const renderer = game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  if (!renderer || !renderer.pipelines) return false;
  if (renderer.pipelines.has(TRAVEL_WIPE_PIPELINE)) return true;
  renderer.pipelines.add(TRAVEL_WIPE_PIPELINE, new TravelWipePipeline(game));
  return true;
}
