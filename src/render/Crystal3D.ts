import * as THREE from 'three';

/**
 * The procedural 3D-decor spec the world-builder exports on a `3d` asset
 * (`mode3d` in world.json → carried through to map.json's `decor3d`).
 */
export interface Model3DSpec {
  shape?: string;
  color?: string;
  material?: string;
  outline?: string;
  spinDegPerSec?: number;
  camera?: string;
  steps?: number;
}

const DEFAULT_SPEC: Required<Pick<Model3DSpec, 'color' | 'outline' | 'spinDegPerSec' | 'steps'>> = {
  color: '#2ad673',
  outline: '#07331b',
  spinDegPerSec: 50,
  steps: 4
};

/**
 * A live, cell-shaded emerald crystal rendered with Three.js to an offscreen
 * canvas — a faithful port of the world-builder's 3D-decor preview
 * (`tools/worldbuilder/index.html`, `buildCrystalScene`), driven by the same
 * `model3d` spec the world JSON carries. The game uses the 2D bridge canvas as a
 * Phaser texture source: tick `update(ms)` each frame, then `refresh()` the
 * Phaser CanvasTexture wrapping `canvas`.
 *
 * Construction throws if WebGL is unavailable — callers fall back to 2D art.
 */
export class Crystal3D {
  /** 2D bridge canvas — hand this to `textures.addCanvas(...)`. */
  readonly canvas: HTMLCanvasElement;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly group: THREE.Group;
  private readonly ctx2d: CanvasRenderingContext2D;
  private readonly spinRadPerMs: number;

  // Default to the crystal PNG's dimensions (803×902) so the live texture is a
  // drop-in for `item_crystal_1` — the existing anchor/scale calibration carries
  // over unchanged; only the camera framing (`f`) is tuned to fill like the art.
  constructor(spec: Model3DSpec = {}, width = 803, height = 902) {
    const color = spec.color ?? DEFAULT_SPEC.color;
    const outlineColor = spec.outline ?? DEFAULT_SPEC.outline;
    const steps = Math.max(2, spec.steps ?? DEFAULT_SPEC.steps);
    const spinDeg = spec.spinDegPerSec ?? DEFAULT_SPEC.spinDegPerSec;
    this.spinRadPerMs = (spinDeg * Math.PI / 180) / 1000;

    // WebGL renderer → its own offscreen canvas (kept readable so we can blit it
    // into the 2D bridge every frame).
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);

    this.scene = new THREE.Scene();

    // toon ramp — a few hard cell-shading bands (dark→light across `steps`).
    const band = new Uint8Array(steps);
    for (let i = 0; i < steps; i++) band[i] = Math.round(45 + (210 * i) / (steps - 1));
    const ramp = new THREE.DataTexture(band, steps, 1, THREE.RedFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
    ramp.needsUpdate = true;

    // faceted gem — a stretched octahedron reads as a crystal.
    const geo = new THREE.OctahedronGeometry(1, 0);
    geo.scale(0.66, 1.2, 0.66);
    const gem = new THREE.Mesh(
      geo,
      new THREE.MeshToonMaterial({ color: new THREE.Color(color), gradientMap: ramp })
    );
    // classic cel outline = an inverted back-face hull in the outline colour.
    const outline = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(outlineColor), side: THREE.BackSide })
    );
    outline.scale.multiplyScalar(1.07);
    this.group = new THREE.Group();
    this.group.add(outline);
    this.group.add(gem);
    this.scene.add(this.group);

    // key + cool rim, low ambient so the toon bands read.
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2.5, 4, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9bffd2, 1.0);
    rim.position.set(-3, 1.6, -2.6);
    this.scene.add(rim);
    this.scene.add(new THREE.AmbientLight(0x2c4d3d, 1.5));

    // orthographic camera at the grid's iso tilt (top-down, ~2:1). The frustum is
    // aspect-corrected so the gem never distorts; `f` frames it to ~the PNG crop.
    const aspect = width / height;
    const f = 1.3;
    this.camera = new THREE.OrthographicCamera(-f * aspect, f * aspect, f, -f, 0.1, 100);
    this.camera.position.set(0, 2.5, 3.2);
    this.camera.lookAt(0, 0, 0);

    // 2D bridge canvas — the Phaser texture source.
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.renderer.domElement.width;
    this.canvas.height = this.renderer.domElement.height;
    const ctx2d = this.canvas.getContext('2d');
    if (!ctx2d) throw new Error('Crystal3D: 2D canvas context unavailable');
    this.ctx2d = ctx2d;

    this.update(0); // paint an initial frame so the texture is never blank
  }

  /** Spin to `timeMs`, render, and blit the WebGL frame into the 2D bridge. */
  update(timeMs: number): void {
    this.group.rotation.y = timeMs * this.spinRadPerMs;
    this.renderer.render(this.scene, this.camera);
    this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx2d.drawImage(this.renderer.domElement, 0, 0);
  }

  /**
   * Give the GL context back, not just three's own objects.
   *
   * `WebGLRenderer.dispose()` frees three's buffers and programs and leaves the
   * CONTEXT alive until the canvas is collected — and a browser hard-caps how
   * many a page may hold (~16 in Chrome), silently killing the OLDEST when a
   * new one is asked for. That is what made the gem "come back broken" on every
   * change: each scene rebuild (a quality change, travel, a Vite hot update)
   * built another renderer, and once past the cap the browser took a live
   * context away — sometimes Phaser's own. `forceContextLoss` is the only call
   * that releases it deterministically.
   */
  dispose(): void {
    this.renderer.forceContextLoss();
    this.renderer.dispose();
  }
}

/** The one live gem this page may hold — see `sharedCrystal3D`. */
let shared: { crystal: Crystal3D; key: string } | undefined;

/**
 * The Theme Crystal's renderer, created ONCE per page and reused.
 *
 * A second WebGL context beside Phaser's is the most expensive object in the
 * game, and BoardScene is rebuilt often — travel, a graphics-quality change,
 * and every hot update while the game is being worked on. Building one per
 * scene meant the count only ever went up. It is a decoration: one is plenty,
 * and it outlives the scene that first asked for it.
 *
 * Keyed by the spec so a world authoring a different gem still gets its own.
 */
export function sharedCrystal3D(spec: Model3DSpec): Crystal3D {
  const key = JSON.stringify(spec);
  if (shared?.key === key) return shared.crystal;
  shared?.crystal.dispose();
  shared = { crystal: new Crystal3D(spec), key };
  return shared.crystal;
}
