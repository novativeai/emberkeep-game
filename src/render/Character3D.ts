import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const CANVAS_W = 256;
const CANVAS_H = 512;

/**
 * Orthographic half-height in world units. Controls how much of the character
 * fits in the frame (2 * ORTHO_H is the visible height).
 * Tune this if Laurah is too big or too small.
 */
const ORTHO_H = 1.1; // → 2.2m visible; character is ~1.8m after scaling

// Idle alternation timing (ms)
const IDLE_MIN_MS = 6000;
const IDLE_MAX_MS = 8000;

/**
 * GLB clip order (NlaTrack.00x — confirmed by user):
 *   0 = NlaTrack     = foldArms (idle variant)
 *   1 = NlaTrack.001 = idle
 *   2 = NlaTrack.002 = run
 *   3 = NlaTrack.003 = walk
 */
const CLIP = { foldArms: 0, idle: 1, run: 2, walk: 3 } as const;

/**
 * Offscreen Three.js renderer for Laurah. BoardScene owns one instance (created
 * lazily in initLaurah so it never runs in the Node unit-test environment).
 *
 * Camera: orthographic, matching the board's isometric parallel projection.
 *   Positioned NE+above of character (same angle as Crystal3D).
 *   Elevation ≈ 26.5° (matches game TILE_H/TILE_W = 128/256 = 0.5).
 *
 * Lighting: sunset from NW — warm DirectionalLight key, dusk HemisphereLight,
 * orange rim from below-back.
 *
 * Idle alternation: idle ↔ foldArms every 6–8s with 0.5s crossfade.
 * Movement: play('walk'|'run') with 0.3s crossfade; play('idle') resumes alternation.
 */
export class Character3D {
  readonly canvas: HTMLCanvasElement;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;

  private mixer: THREE.AnimationMixer | null = null;
  private clips: THREE.AnimationClip[] = [];
  private currentAction: THREE.AnimationAction | null = null;

  private idleMode = false;
  private idleTimer = 0;
  private idleFlipMs = IDLE_MIN_MS;
  private idleVariant = 0; // 0 = idle, 1 = foldArms

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width  = CANVAS_W;
    this.canvas.height = CANVAS_H;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true
    });
    this.renderer.setSize(CANVAS_W, CANVAS_H, false);
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();

    // Orthographic camera — matches board's parallel (iso) projection.
    // Aspect = 256/512 = 0.5 (portrait canvas).
    const aspect = CANVAS_W / CANVAS_H;
    this.camera = new THREE.OrthographicCamera(
      -ORTHO_H * aspect, // left
       ORTHO_H * aspect, // right
       ORTHO_H,          // top
      -ORTHO_H,          // bottom
      -100,
       100
    );
    // NE + above: mirrors Crystal3D's position (4.4, 6.2, 7) scaled for Laurah's height.
    // Gives elevation ≈ 26.5° — exact isometric angle (arctan(TILE_H/TILE_W) = arctan(0.5)).
    // lookAt waist level so the character is framed head-to-toe.
    this.camera.position.set(4, 5, 7);
    this.camera.lookAt(0, 0.9, 0);

    this.setupLighting();
    this.loadCharacter();
  }

  private setupLighting(): void {
    // Key: warm sun from NW at sunset
    const sun = new THREE.DirectionalLight(0xffb060, 2.2);
    sun.position.set(-3, 2, -3);
    this.scene.add(sun);

    // Fill: dusk sky (purple-blue) + warm ground bounce
    const hemi = new THREE.HemisphereLight(0x8060c0, 0x402010, 0.6);
    this.scene.add(hemi);

    // Rim: orange-red back-light from SE-low (opposite of key)
    const rim = new THREE.DirectionalLight(0xff6020, 0.8);
    rim.position.set(1, -0.5, 2);
    this.scene.add(rim);
  }

  private loadCharacter(): void {
    const base     = (import.meta.env?.BASE_URL ?? './').replace(/\/?$/, '/');
    const primary  = `${base}3d-characters/Laurah-game.glb`;
    const fallback = `${base}3d-characters/Laurah-rigged.glb`;

    const loader = new GLTFLoader();

    const tryLoad = (url: string, isFallback: boolean): void => {
      loader.load(
        url,
        (gltf) => {
          const model = gltf.scene;
          const box   = new THREE.Box3().setFromObject(model);
          const size  = box.getSize(new THREE.Vector3());

          // Place feet at Y = 0; center horizontally
          model.position.set(-box.getCenter(new THREE.Vector3()).x, -box.min.y, -box.getCenter(new THREE.Vector3()).z);

          // Scale to a consistent height so the ortho frustum frames her correctly
          if (size.y > 0) model.scale.setScalar(1.8 / size.y);

          // Face toward camera (camera is at +X,+Y,+Z; front toward that direction).
          // 210° gives iso-forward facing: character looks toward the viewer's left
          // while still showing their front face to the NE camera.
          model.rotation.y = THREE.MathUtils.degToRad(210);

          this.scene.add(model);

          this.mixer = new THREE.AnimationMixer(model);
          this.clips = gltf.animations;

          if (this.clips.length === 0) console.warn('[Character3D] No animations found in', url);

          this.play('idle');
        },
        undefined,
        (err) => {
          if (!isFallback) {
            console.warn('[Character3D] Laurah-game.glb not found — trying fallback');
            tryLoad(fallback, true);
          } else {
            console.error('[Character3D] Failed to load Laurah:', err);
          }
        }
      );
    };

    tryLoad(primary, false);
  }

  /** Cross-fade to a clip by index (dur in seconds). */
  private crossFadeTo(clipIdx: number, dur: number): void {
    if (!this.mixer || clipIdx >= this.clips.length) return;
    const clip = this.clips[clipIdx];
    if (!clip) return;
    const next = this.mixer.clipAction(clip);
    if (next === this.currentAction) return;
    next.reset().play();
    if (this.currentAction) next.crossFadeFrom(this.currentAction, dur, true);
    this.currentAction = next;
  }

  /** Play a named animation with 0.3s crossfade. */
  play(name: 'idle' | 'walk' | 'run'): void {
    this.idleMode = name === 'idle';
    if (this.idleMode) {
      this.idleTimer   = 0;
      this.idleVariant = 0;
      this.idleFlipMs  = IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
    }
    this.crossFadeTo(CLIP[name], 0.3);
  }

  /** Advance the mixer and render one frame into the canvas. */
  render(dtMs: number): void {
    if (this.mixer) {
      this.mixer.update(dtMs / 1000);

      // Idle alternation: idle ↔ foldArms every 6–8 s
      if (this.idleMode && this.clips.length > CLIP.foldArms) {
        this.idleTimer += dtMs;
        if (this.idleTimer >= this.idleFlipMs) {
          this.idleTimer   = 0;
          this.idleFlipMs  = IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
          this.idleVariant = 1 - this.idleVariant;
          this.crossFadeTo(this.idleVariant === 0 ? CLIP.idle : CLIP.foldArms, 0.5);
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m: THREE.Material) => m.dispose());
      }
    });
    this.renderer.dispose();
  }
}
