/**
 * Motion-vector flipbook pipeline.
 *
 * Plays a channel-packed flipbook sheet with motion-vector frame interpolation
 * — the technique that separates a real-time VFX flipbook from a slideshow.
 * Instead of cross-dissolving frame A into frame B (which ghosts: for a moment
 * you see both), it WARPS A forward along its optical flow and B backward along
 * its, so features travel to where they actually go, and only then blends.
 *
 * Textures (baked by scripts/bake-vfx-mv.py, indexed in bank.mv.json):
 *   unit 0  uMainSampler  pack  R density · G emissive · B erosion order · A coverage
 *   unit 1  uMvSampler    mv    RG forward flow (i -> next) · BA backward (next -> i)
 *                               both stored at cell i, each (px / mvScale) * .5 + .5
 *   unit 2  uRampSampler  ramps palette LUT, 256 wide; u = density, v = uRampV
 *
 * The pack carries NO colour — R is a greyscale mask and colour is looked up in
 * the ramp at draw time, so one smoke sheet serves ash / ember / toxic / arcane
 * from a single uniform instead of four coloured copies on the GPU.
 *
 * This is a SinglePipeline subclass rather than a `GameObjects.Shader` because
 * a Shader Game Object cannot have a blend mode (Phaser hard-codes
 * `blendMode = -1` and makes `setBlendMode` a no-op), and ADD blending is
 * non-negotiable for fire and embers.
 *
 * Flow convention (must match the baker): A(x) = B(x + fwd), so reconstructing
 * B from A samples at (x - fwd). Warping A a fraction t toward B is therefore
 * `uv - t * fwd`, and warping B back toward A is `uv - (1-t) * bwd`.
 */
import Phaser from 'phaser';

export const FLIPBOOK_PIPELINE = 'FlipbookMV';

const FRAG = `
#define SHADER_NAME EMBERKEEP_FLIPBOOK_MV

precision mediump float;

uniform sampler2D uMainSampler;   // packed frames
uniform sampler2D uMvSampler;     // motion vectors
uniform sampler2D uRampSampler;   // palette LUT

uniform vec2  uGrid;      // sheet layout: cols, rows
uniform vec2  uCell;      // cell size in pixels
uniform vec2  uFrames;    // frame index A, frame index B
uniform float uT;         // 0..1 position between A and B
uniform float uMvScale;   // motion vector decode scale, in pixels
uniform float uUseMV;     // 1 = motion vectors, 0 = plain cross-dissolve
uniform float uRampV;     // palette row
uniform vec4  uTint;      // multiplies the ramp colour
uniform float uErode;     // 0 = whole frame, 1 = fully burnt away
uniform float uEmissive;  // extra gain on the hot core
uniform float uAlpha;     // master opacity

varying vec2 outTexCoord;

/** Cell-local uv -> sheet uv, clamped so a warp can never bleed into the
 *  neighbouring cell (the classic flipbook seam artefact). */
vec2 sheetUV(vec2 uv, float frame) {
  // Half a texel, expressed in CELL-LOCAL uv (uCell is the cell size in px).
  // Dividing by the whole sheet here would make the inset ~cols times too
  // small and let a warp sample its neighbour.
  vec2 inset = vec2(0.5) / uCell;
  vec2 local = clamp(uv, inset, vec2(1.0) - inset);
  float col = mod(frame, uGrid.x);
  float row = floor(frame / uGrid.x);
  return (vec2(col, row) + local) / uGrid;
}

void main() {
  vec2 uv = outTexCoord;

  float fA = uFrames.x;
  float fB = uFrames.y;

  // Both flows for this step live in cell A: RG = A->B, BA = B->A.
  vec4 mv = texture2D(uMvSampler, sheetUV(uv, fA));
  vec2 fwd = (mv.rg * 2.0 - 1.0) * uMvScale / uCell;   // pixels -> cell uv
  vec2 bwd = (mv.ba * 2.0 - 1.0) * uMvScale / uCell;

  vec4 a = texture2D(uMainSampler, sheetUV(uv - uT * fwd * uUseMV, fA));
  vec4 b = texture2D(uMainSampler, sheetUV(uv - (1.0 - uT) * bwd * uUseMV, fB));
  vec4 smp = mix(a, b, uT);   // 'packed' is a GLSL ES reserved word

  float density  = smp.r;
  float emissive = smp.g;
  float erosion  = smp.b;
  float alpha    = smp.a;

  // Erosion dissolves by per-pixel ORDER rather than fading uniformly, so the
  // effect burns away instead of just dimming. 0 -> untouched, 1 -> gone.
  alpha *= smoothstep(uErode - 0.10, uErode + 0.10, erosion);

  vec3 col = texture2D(uRampSampler, vec2(clamp(density, 0.0, 1.0), uRampV)).rgb;
  col *= uTint.rgb;
  col += col * emissive * uEmissive;

  float outA = clamp(alpha * uAlpha * uTint.a, 0.0, 1.0);
  gl_FragColor = vec4(col * outA, outA);   // premultiplied
}
`;

/** Per-object values read off `gameObject.pipelineData`. */
export interface FlipbookPipelineData {
  grid: [number, number];
  cell: [number, number];
  frames: [number, number];
  t: number;
  mvScale: number;
  useMV: number;
  rampV: number;
  tint: [number, number, number, number];
  erode: number;
  emissive: number;
  alpha: number;
  mvTexture: string;
  rampTexture: string;
}

export class FlipbookPipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
  constructor(game: Phaser.Game) {
    super({ game, fragShader: FRAG } as Phaser.Types.Renderer.WebGL.WebGLPipelineConfig);
  }

  onBind(gameObject?: Phaser.GameObjects.GameObject): void {
    super.onBind(gameObject as Phaser.GameObjects.GameObject);
    const d = (gameObject as { pipelineData?: FlipbookPipelineData } | undefined)?.pipelineData;
    if (!d || !d.grid) return;

    // Every flipbook carries different per-object uniforms, so a batch must not
    // span two of them. Very few are ever on screen, so flushing is free.
    this.flush();

    this.set2f('uGrid', d.grid[0], d.grid[1]);
    this.set2f('uCell', d.cell[0], d.cell[1]);
    this.set2f('uFrames', d.frames[0], d.frames[1]);
    this.set1f('uT', d.t);
    this.set1f('uMvScale', d.mvScale);
    this.set1f('uUseMV', d.useMV);
    this.set1f('uRampV', d.rampV);
    this.set4f('uTint', d.tint[0], d.tint[1], d.tint[2], d.tint[3]);
    this.set1f('uErode', d.erode);
    this.set1f('uEmissive', d.emissive);
    this.set1f('uAlpha', d.alpha);

    // uMainSampler stays on unit 0 (the Image's own texture). Bind the two
    // companions alongside it.
    const textures = this.game.textures;
    const mv = textures.getFrame(d.mvTexture)?.source?.glTexture;
    const ramp = textures.getFrame(d.rampTexture)?.source?.glTexture;
    if (mv) { this.bindTexture(mv, 1); this.set1i('uMvSampler', 1); }
    if (ramp) { this.bindTexture(ramp, 2); this.set1i('uRampSampler', 2); }
    // bindTexture leaves TEXTURE1/2 active; hand unit 0 back so the batch's own
    // texture binding (and everything downstream) lands where it expects to.
    this.gl.activeTexture(this.gl.TEXTURE0);
  }
}

/** Register the pipeline once per game. Safe to call repeatedly. */
export function ensureFlipbookPipeline(game: Phaser.Game): boolean {
  const renderer = game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  if (!renderer || !renderer.pipelines) return false; // canvas fallback
  if (renderer.pipelines.has(FLIPBOOK_PIPELINE)) return true;
  renderer.pipelines.add(FLIPBOOK_PIPELINE, new FlipbookPipeline(game));
  return true;
}
