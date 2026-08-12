/**
 * Rig keyline pipeline — the dark outline the dragons wear, drawn at run time.
 *
 * WHY A SHADER AND NOT BAKED ART. The item art carries its keyline in the PNG
 * (scripts/unify-keyline.py). A rig cannot: it is 6-8 separately posed layers, and
 * ink painted into each layer would draw a line along every internal seam — down
 * the neck, around each wing root — the moment a limb rotated. The line has to
 * come from the COMPOSITED silhouette, which only exists at draw time.
 *
 * WHY PER-LAYER DILATION IS NEVERTHELESS EXACT. Dilation distributes over union:
 *
 *     dilate(A) ∪ dilate(B) = dilate(A ∪ B)
 *
 * so dilating each layer separately and drawing ALL of the ink BEHIND ALL of the
 * art gives precisely the dilated union silhouette. Internal seams are covered by
 * the opaque art on top of them, and no full-screen render target is involved —
 * which is what a `PostFXPipeline` on the container would have cost, per dragon,
 * per frame, at 2560x1600.
 *
 * Each layer's ink is `dilated - own`, i.e. the ring OUTSIDE that layer only. That
 * is what keeps a translucent wing membrane from being darkened by its own ink,
 * and it makes the interior free (see the early-out in the shader).
 *
 * TWO THINGS THAT MAKE IT CHEAP:
 *   · the interior early-outs after ONE texture fetch, so the tap loop is paid
 *     only in the thin band where the ring is actually visible;
 *   · the ink quad is trimmed to the layer's alpha bounds + the radius. The rig
 *     canvases are 666x666 with the art often occupying a third of that, and an
 *     untrimmed quad would run the tap loop over a quarter-million empty texels
 *     per layer, per frame.
 */
import Phaser from 'phaser';
import type { AlphaBounds } from './rigInkGeometry';

export {
  frameBox,
  inkQuad,
  inkRadiusTexels,
  keylineUnits,
  uvFence,
  type AlphaBounds,
  type InkQuad
} from './rigInkGeometry';

export const RIG_INK_PIPELINE = 'RigInk';

const FRAG = `
#define SHADER_NAME EMBERKEEP_RIG_INK

precision mediump float;

uniform sampler2D uMainSampler;
uniform vec2 uUvScale;    // quad uv -> sheet uv (the trim window)
uniform vec2 uUvOffset;
uniform vec2 uUvMin;      // the frame's own cell: sampling may not leave it
uniform vec2 uUvMax;
uniform vec2 uTexel;      // 1 / SHEET size, in texels
uniform float uRadius;    // dilation radius, in source texels
uniform vec3 uInk;
uniform float uAlpha;

varying vec2 outTexCoord;

const float TAU = 6.28318531;
const int RING_TAPS = 12;

float alphaAt(vec2 p) {
  // Outside this frame's cell there is nothing to dilate. The quad deliberately
  // reaches past the frame — that is where the outline goes — so without the fence
  // the taps would wander into whatever pose is packed next door and dilate IT into
  // this frame's outline. (For a standalone texture the fence is the whole image,
  // where it still matters: letting the sampler clamp instead would smear the
  // border texel outward into a streak.)
  if (p.x < uUvMin.x || p.x > uUvMax.x || p.y < uUvMin.y || p.y > uUvMax.y) return 0.0;
  return texture2D(uMainSampler, p).a;
}

void main() {
  vec2 p = outTexCoord * uUvScale + uUvOffset;
  float own = alphaAt(p);

  // The art is drawn ON TOP of this, so ink under the layer is never seen. Paying
  // one fetch to leave the interior is what makes the whole effect affordable:
  // the taps below run only in the ring band and its immediate surround.
  if (own > 0.985) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec2 r = uRadius * uTexel;
  float a = own;
  // Three rings, each offset half a step from the last. The rim alone would fix
  // the outline's SHAPE (its scallop depth is only R*(1-cos(pi/12)) ~= 3% of R),
  // but a rim-only max misses a feature thinner than the radius — a spike tip
  // would punch a notch in the line. The inner rings close that.
  for (int i = 0; i < RING_TAPS; i++) {
    float base = TAU * float(i) / float(RING_TAPS);
    float s = TAU / float(RING_TAPS) / 3.0;
    a = max(a, alphaAt(p + vec2(cos(base), sin(base)) * r));
    a = max(a, alphaAt(p + vec2(cos(base + s), sin(base + s)) * r * 0.66));
    a = max(a, alphaAt(p + vec2(cos(base + s * 2.0), sin(base + s * 2.0)) * r * 0.33));
  }

  float ring = clamp(a - own, 0.0, 1.0) * uAlpha;
  gl_FragColor = vec4(uInk * ring, ring);   // premultiplied
}
`;

/** Per-object values read off `gameObject.pipelineData`. */
export interface RigInkPipelineData {
  uvScale: [number, number];
  uvOffset: [number, number];
  /** The frame cell sampling is fenced to — `uvFence(box)`. */
  uvMin: [number, number];
  uvMax: [number, number];
  texel: [number, number];
  radius: number;
  ink: [number, number, number];
  alpha: number;
}

export class RigInkPipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
  constructor(game: Phaser.Game) {
    super({ game, fragShader: FRAG } as Phaser.Types.Renderer.WebGL.WebGLPipelineConfig);
  }

  onBind(gameObject?: Phaser.GameObjects.GameObject): void {
    super.onBind(gameObject as Phaser.GameObjects.GameObject);
    const d = (gameObject as { pipelineData?: RigInkPipelineData } | undefined)?.pipelineData;
    if (!d || !d.texel) return;

    // Every layer has its own trim window and texture size, so a batch must not
    // span two of them. A rig is a handful of quads, so flushing is free.
    this.flush();
    this.set2f('uUvScale', d.uvScale[0], d.uvScale[1]);
    this.set2f('uUvOffset', d.uvOffset[0], d.uvOffset[1]);
    this.set2f('uUvMin', d.uvMin[0], d.uvMin[1]);
    this.set2f('uUvMax', d.uvMax[0], d.uvMax[1]);
    this.set2f('uTexel', d.texel[0], d.texel[1]);
    this.set1f('uRadius', d.radius);
    this.set3f('uInk', d.ink[0], d.ink[1], d.ink[2]);
    this.set1f('uAlpha', d.alpha);
  }
}

/** Register the pipeline once per game. Safe to call repeatedly. */
export function ensureRigInkPipeline(game: Phaser.Game): boolean {
  const renderer = game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  if (!renderer || !renderer.pipelines) return false; // canvas fallback — no outline
  if (renderer.pipelines.has(RIG_INK_PIPELINE)) return true;
  renderer.pipelines.add(RIG_INK_PIPELINE, new RigInkPipeline(game));
  return true;
}

const boundsCache = new Map<string, AlphaBounds | null>();

/**
 * The alpha bounding box of a texture, in texels — what the ink quad is trimmed
 * to. Read once per texture and cached for the life of the page: every dragon of
 * a breed shares these textures, so the cost is paid once no matter how many
 * hatch.
 *
 * Scanned at a stride and then padded back out by it. A rig layer is ~443k pixels
 * and an exact scan of eight of them is tens of milliseconds of main thread at
 * load; the box only decides how big a quad is, so being a pixel or two loose
 * costs nothing and being fast matters.
 */
export function alphaBoundsOf(
  scene: Phaser.Scene,
  key: string,
  stride = 2,
  threshold = 8
): AlphaBounds | null {
  const cached = boundsCache.get(key);
  if (cached !== undefined) return cached;

  const result = readAlphaBounds(scene, key, stride, threshold);
  boundsCache.set(key, result);
  return result;
}

function readAlphaBounds(
  scene: Phaser.Scene,
  key: string,
  stride: number,
  threshold: number
): AlphaBounds | null {
  if (!scene.textures.exists(key)) return null;
  const source = scene.textures.get(key).getSourceImage();
  const texWidth = (source as { width?: number }).width ?? 0;
  const texHeight = (source as { height?: number }).height ?? 0;
  if (!texWidth || !texHeight) return null;

  const canvas = Phaser.Display.Canvas.CanvasPool.create2D(null, texWidth, texHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    Phaser.Display.Canvas.CanvasPool.remove(canvas);
    return null;
  }
  let data: Uint8ClampedArray;
  try {
    ctx.drawImage(source as CanvasImageSource, 0, 0);
    data = ctx.getImageData(0, 0, texWidth, texHeight).data;
  } catch {
    Phaser.Display.Canvas.CanvasPool.remove(canvas); // tainted canvas — skip the outline
    return null;
  }
  Phaser.Display.Canvas.CanvasPool.remove(canvas);

  let minX = texWidth;
  let minY = texHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < texHeight; y += stride) {
    const row = y * texWidth;
    for (let x = 0; x < texWidth; x += stride) {
      if (data[(row + x) * 4 + 3]! <= threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null; // fully transparent layer

  minX = Math.max(0, minX - stride);
  minY = Math.max(0, minY - stride);
  maxX = Math.min(texWidth - 1, maxX + stride);
  maxY = Math.min(texHeight - 1, maxY + stride);
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    texWidth,
    texHeight
  };
}
