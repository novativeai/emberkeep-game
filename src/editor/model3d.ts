import Phaser from 'phaser';
import * as THREE from 'three';

/**
 * A live-rendered 3D model preview for the Map Editor. Each preview keeps its own
 * three.js scene + camera + AnimationMixer and paints every frame into a canvas
 * Phaser uses as a texture — so an imported GLB/FBX shows its REAL colours AND
 * plays its animation. All previews share ONE WebGLRenderer.
 *
 * BoardEditor ticks the registry while the editor is open; when it closes the
 * models simply stop being ticked (the texture freezes on its last frame), which
 * is exactly what an applied 3D asset shows in the game — a colour-correct, posed
 * still, with no live second render loop running during play.
 */

let shared: THREE.WebGLRenderer | null = null;
function sharedRenderer(): THREE.WebGLRenderer {
  if (!shared) {
    shared = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    shared.setPixelRatio(1);
  }
  return shared;
}

export interface Model3DHandle {
  key: string;
  update(dtMs: number): void;
  dispose(): void;
  /** data-URL of the current frame (for persistence + DOM preview). */
  snapshot(): string;
}

const registry = new Map<string, Model3DHandle>();

/** Advance + re-render every live model (called each frame from BoardScene.update).
 *  MUST NEVER throw into the game loop — a model whose render fails is dropped
 *  (frozen on its last frame) instead of killing the frame (and thus dragging). */
export function tickModels3D(dtMs: number): void {
  for (const [key, h] of registry) {
    try {
      h.update(dtMs);
    } catch (e) {
      console.warn('[model3d] update failed — freezing this model', key, e);
      registry.delete(key); // stop ticking the broken one; its texture stays as-is
    }
  }
}

/** Tear down one model (on asset delete) and free its texture. */
export function disposeModel3D(key: string): void {
  const h = registry.get(key);
  if (h) {
    h.dispose();
    registry.delete(key);
  }
}

/**
 * Build a live preview that PRESERVES the model's own materials/colours and plays
 * its first animation clip (if any). Registered globally so BoardEditor ticks it.
 */
export function createLiveModel3D(
  scene: Phaser.Scene,
  object: THREE.Object3D,
  animations: THREE.AnimationClip[],
  key: string,
  size = 512
): Model3DHandle {
  // Fallback matte ONLY for meshes with truly no material — never overwrite the
  // model's real materials (that was the "no colour" bug).
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const has = mesh.material && (Array.isArray(mesh.material) ? mesh.material.length : true);
      if (!has) mesh.material = new THREE.MeshStandardMaterial({ color: 0xb8b2c0, roughness: 0.7, metalness: 0.1 });
    }
  });

  const three = new THREE.Scene();
  three.add(object);
  three.add(new THREE.AmbientLight(0xffffff, 1.0));
  const k1 = new THREE.DirectionalLight(0xffffff, 1.2);
  k1.position.set(3, 5, 4);
  three.add(k1);
  const k2 = new THREE.DirectionalLight(0xffe6c0, 0.5);
  k2.position.set(-4, 2, -3);
  three.add(k2);

  // Frame: centre on origin, pull the camera to fit the bounding sphere.
  const box = new THREE.Box3().setFromObject(object);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  object.position.sub(sphere.center);
  const r = Math.max(sphere.radius, 0.001);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, r * 100);
  const dist = (r / Math.sin((camera.fov * Math.PI) / 180 / 2)) * 1.2;
  camera.position.set(dist * 0.55, dist * 0.6, dist * 0.9);
  camera.lookAt(0, 0, 0);

  const mixer = animations.length ? new THREE.AnimationMixer(object) : null;
  if (mixer && animations[0]) mixer.clipAction(animations[0]).play();

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx2d = canvas.getContext('2d')!;
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.addCanvas(key, canvas)!;

  const renderer = sharedRenderer();
  const draw = (): void => {
    renderer.setSize(size, size, false);
    renderer.render(three, camera);
    ctx2d.clearRect(0, 0, size, size);
    ctx2d.drawImage(renderer.domElement, 0, 0);
    tex.refresh();
  };
  draw(); // initial frame so the texture is never blank

  const handle: Model3DHandle = {
    key,
    update(dtMs: number) {
      if (!mixer) return; // static model — one bake is enough
      mixer.update(dtMs / 1000);
      draw();
    },
    snapshot: () => canvas.toDataURL('image/png'),
    dispose() {
      three.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose?.();
          const mat = m.material;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else (mat as THREE.Material | undefined)?.dispose?.();
        }
      });
      if (scene.textures.exists(key)) scene.textures.remove(key);
    }
  };
  registry.set(key, handle);
  return handle;
}
