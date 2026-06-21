import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const CANVAS_W = 256;
const CANVAS_H = 512;

// Camera: portrait canvas (0.5 aspect), SE direction at iso ~26.5°
const CAM_DIST      = 4;
const CAM_ELEVATION = THREE.MathUtils.degToRad(26.5);
const CAM_AZIMUTH   = THREE.MathUtils.degToRad(135); // SE
const CAM_LOOK_Y    = 0.85; // waist height

// Idle alternation timing (ms)
const IDLE_MIN_MS = 6000;
const IDLE_MAX_MS = 8000;

// Clip indices from the GLB export order (NlaTrack.00x naming)
const CLIP = { idle: 0, foldArms: 1, run: 2, walk: 3 } as const;

/**
 * Offscreen Three.js renderer for Laurah. BoardScene owns one instance (created
 * lazily in initLaurah so it never runs in the Node unit-test environment).
 * Renders to a 256×512 HTMLCanvasElement
 * with alpha; BoardScene copies the pixels into a Phaser CanvasTexture each frame.
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
  private camera: THREE.PerspectiveCamera;

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

    const hFov = CANVAS_W / CANVAS_H;
    this.camera = new THREE.PerspectiveCamera(28, hFov, 0.1, 200);
    const hDist = CAM_DIST * Math.cos(CAM_ELEVATION);
    this.camera.position.set(
      Math.sin(CAM_AZIMUTH) * hDist,
      CAM_DIST * Math.sin(CAM_ELEVATION) + CAM_LOOK_Y,
      Math.cos(CAM_AZIMUTH) * hDist
    );
    this.camera.lookAt(0, CAM_LOOK_Y, 0);

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

          // Center feet on origin
          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          model.position.set(-center.x, -box.min.y, -center.z);

          // Face the SE camera (rotate 180° so front faces viewer)
          model.rotation.y = Math.PI;

          this.scene.add(model);

          this.mixer = new THREE.AnimationMixer(model);
          this.clips = gltf.animations;

          if (this.clips.length === 0) {
            console.warn('[Character3D] No animations found in', url);
          }

          // Scale to a sensible height (~1.8 Three.js units expected)
          const targetH = 1.8;
          if (size.y > 0) model.scale.setScalar(targetH / size.y);

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

