import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { saveAsset3dFile } from './asset3dFs';

/**
 * Turns an imported editor file (PNG image, or OBJ/FBX/GLB 3D model) into a Phaser
 * texture the board can place. PNG loads straight as a bitmap. 3D models are
 * parsed with three.js keeping their REAL materials/colours; a model that carries
 * an animation clip becomes a LIVE preview (colour + animation, see model3d.ts),
 * a static one is rendered ONCE to a baked snapshot. Returns the texture key.
 */

let uid = 0;
/**
 * The Phaser texture key for an imported file — derived from the FILENAME, never
 * from a counter.
 *
 * `uid` restarted at 0 on every page load, so the first import of a new session
 * claimed `editorAsset_png_0` — a key an EARLIER session had already handed to
 * another map. Phaser texture keys are global, so the two maps then shared one
 * image: importing a new map made roothold show the NEW map's backdrop, and after a
 * reload `restoreMaps` (which skips a key that already exists) gave whichever loaded
 * first to both, so the same picture appeared twice in the pager. It survived a
 * cookie wipe because the collision was baked into asset3d/editor-map.json.
 *
 * Same file → same key, deliberately: re-importing replaces its own texture instead
 * of leaking a second copy of a 4K backdrop into GPU memory.
 */
const nextKey = (kind: string, fileName?: string): string => {
  const slug = (fileName ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug ? `editorAsset_${kind}_${slug}` : `editorAsset_${kind}_x${uid++}`;
};

type ModelExt = 'obj' | 'fbx' | 'glb';

/** Parse an OBJ/FBX/GLB into a three.js object + its animation clips (if any),
 *  keeping the file's own materials. */
function parseModel(data: string | ArrayBuffer, ext: ModelExt): Promise<{ object: THREE.Object3D; animations: THREE.AnimationClip[] }> {
  if (ext === 'obj') {
    return Promise.resolve({ object: new OBJLoader().parse(data as string), animations: [] });
  }
  if (ext === 'fbx') {
    const object = new FBXLoader().parse(data as ArrayBuffer, '') as unknown as THREE.Object3D & { animations?: THREE.AnimationClip[] };
    return Promise.resolve({ object, animations: object.animations ?? [] });
  }
  // glb (binary) / gltf (json) — GLTF carries materials, textures AND animations.
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      data,
      '',
      (gltf) => resolve({ object: gltf.scene, animations: gltf.animations ?? [] }),
      (err) => reject(err instanceof Error ? err : new Error('Could not parse the 3D file'))
    );
  });
}

/** OBJ/FBX/GLB → a placeable texture. Animated models render live (colour +
 *  animation); static ones bake once. Returns the key + a still snapshot. */
async function importModel(
  scene: Phaser.Scene,
  data: string | ArrayBuffer,
  ext: ModelExt,
  key: string
): Promise<BakeResult> {
  const { object, animations } = await parseModel(data, ext);
  // Bake ONE static (posed) frame — never a live render loop. A persistent 2nd/3rd
  // WebGL context running each frame in-game was exhausting the GPU (the "Graphics
  // ran out of memory" reload-crash on refresh). The transient renderer inside
  // bakeModel is created + disposed immediately, so it adds no lasting GPU load.
  return bakeModel(scene, object, key, animations);
}

/** Hard cap on any imported texture's longest side. A huge PNG map (say
 *  6000×4000) would blow a phone/weak-GPU's texture budget and crash the tab, so
 *  we downscale into a canvas before it ever reaches WebGL. */
const MAX_DIM = 1024;

export interface ImportedAsset {
  textureKey: string;
  kind: 'png' | 'obj' | 'fbx' | 'glb';
  /** Clean display name derived from the file (no extension). */
  name: string;
  /** Original filename incl. extension (e.g. "home.png") — the manifest key. */
  fileName: string;
  /** Filename in the repo's `asset3d/` folder for a 2D image saved there. */
  file2d?: string;
  /** (Optimized) texture size (px) — the board's auto-fit reads this. */
  w: number;
  h: number;
  /** PNG snapshot of the optimized texture, for persisting map layers. */
  dataUrl: string;
  /** For 3D: the raw model file (base64) + its ext, so the ANIMATED model can be
   *  recreated after a reload (a static dataUrl snapshot alone can't animate).
   *  `modelSrc` is only kept when the on-disk `asset3d/` store is unavailable —
   *  otherwise the file lives on disk and `file3d` (its filename) points to it. */
  modelSrc?: string;
  modelExt?: string;
  /** Filename in the repo's `asset3d/` folder (dev store), if it was saved there. */
  file3d?: string;
  /** Baked-animation info: frames in the spritesheet (>1 = animated) + play rate. */
  frameCount?: number;
  frameRate?: number;
}

/* Base64 ⇆ ArrayBuffer for persisting model source files in localStorage. */
function abToBase64(buf: ArrayBuffer): string {
  let bin = '';
  const bytes = new Uint8Array(buf);
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}
function base64ToAb(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Re-create a 3D model's texture (live-animated, or static if it has no clips)
 *  under `key` from its persisted base64 source — so an applied model survives a
 *  reload AND keeps animating. */
export async function recreateModel(scene: Phaser.Scene, modelSrc: string, modelExt: string, key: string): Promise<BakeResult> {
  return buildModelFrom(scene, base64ToAb(modelSrc), modelExt, key);
}

/** Same, but pulling the model file off the dev `asset3d/` store (by URL). */
export async function recreateModelFromUrl(scene: Phaser.Scene, url: string, modelExt: string, key: string): Promise<BakeResult> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`asset3d fetch failed (${res.status})`);
  return buildModelFrom(scene, await res.arrayBuffer(), modelExt, key);
}

function buildModelFrom(scene: Phaser.Scene, buf: ArrayBuffer, modelExt: string, key: string): Promise<BakeResult> {
  const asText = modelExt === 'obj' || modelExt === 'gltf';
  const data: string | ArrayBuffer = asText ? new TextDecoder().decode(buf) : buf;
  const pExt: ModelExt = modelExt === 'gltf' ? 'glb' : (modelExt as ModelExt);
  return importModel(scene, data, pExt, key);
}

const baseName = (file: File): string => file.name.replace(/\.[^.]+$/, '');

export async function importAsset(scene: Phaser.Scene, file: File): Promise<ImportedAsset> {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const name = baseName(file);
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp') {
    // Save the ORIGINAL image into asset3d/ too, so a teammate `git pull` gets the
    // real file (the texture itself uses the downscaled canvas + dataUrl).
    const savedUrl = await saveAsset3dFile(file.name, abToBase64(await file.arrayBuffer()));
    const t = await loadImageTexture(scene, file, nextKey('png', file.name));
    return { textureKey: t.key, kind: 'png', name, fileName: file.name, w: t.w, h: t.h, dataUrl: t.dataUrl, file2d: savedUrl ? file.name : undefined };
  }
  if (ext === 'obj' || ext === 'fbx' || ext === 'glb' || ext === 'gltf') {
    const buf = await file.arrayBuffer();
    const b64 = abToBase64(buf);
    // Write the model into the repo's asset3d/ folder (dev store). If that's not
    // available, fall back to keeping the source in localStorage.
    const savedUrl = await saveAsset3dFile(file.name, b64);
    const asText = ext === 'obj' || ext === 'gltf';
    const data: string | ArrayBuffer = asText ? new TextDecoder().decode(buf) : buf;
    const pExt: ModelExt = ext === 'gltf' ? 'glb' : ext;
    const kind = (ext === 'gltf' ? 'glb' : ext) as ImportedAsset['kind'];
    const t = await importModel(scene, data, pExt, nextKey(pExt, file.name));
    return {
      textureKey: t.key,
      kind,
      name,
      fileName: file.name,
      w: 512,
      h: 512,
      dataUrl: t.dataUrl,
      modelExt: ext,
      file3d: savedUrl ? file.name : undefined,
      modelSrc: savedUrl ? undefined : b64, // heavy base64 only when there's no disk store
      frameCount: t.frameCount,
      frameRate: t.frameRate
    };
  }
  throw new Error(`Unsupported asset format: .${ext} (use PNG, OBJ, FBX or GLB)`);
}

/** Re-create a Phaser texture from a persisted data-URL (restoring saved maps). */
/** `src` is a data-URL or an ordinary URL (`/asset3d/<file>`) — an `<img>` takes
 *  either, which is what lets a placement whose base64 was dropped come back
 *  from the file on disk. A failed load resolves as 1×1 rather than throwing;
 *  callers that care check the size. */
export function restoreTexture(scene: Phaser.Scene, key: string, dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (scene.textures.exists(key)) scene.textures.remove(key);
      scene.textures.addImage(key, img);
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => resolve({ w: 1, h: 1 });
    img.src = dataUrl;
  });
}

/** PNG/JPG/WEBP → downscaled canvas → Phaser texture. Returns key, size, dataUrl. */
function loadImageTexture(
  scene: Phaser.Scene,
  file: File,
  key: string
): Promise<{ key: string; w: number; h: number; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || 256;
      let h = img.naturalHeight || 256;
      const max = Math.max(w, h);
      if (max > MAX_DIM) {
        const s = MAX_DIM / max;
        w = Math.round(w * s);
        h = Math.round(h * s);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h); // draw at the capped size
      if (scene.textures.exists(key)) scene.textures.remove(key);
      scene.textures.addCanvas(key, canvas);
      URL.revokeObjectURL(url);
      resolve({ key, w, h, dataUrl: canvas.toDataURL('image/png') });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode the image file'));
    };
    img.src = url;
  });
}

/** The result of baking a model to a Phaser texture: a still `dataUrl` snapshot plus,
 *  for an ANIMATED model, how many frames the spritesheet holds and at what rate to
 *  play them (frameCount 1 / frameRate 0 = a plain static image). */
export interface BakeResult {
  key: string;
  dataUrl: string;
  frameCount: number;
  frameRate: number;
}

/**
 * A parsed model → framed, lit offscreen render → Phaser texture. A STATIC model bakes
 * ONE frame (a plain image). An ANIMATED model (GLB/FBX with a clip) bakes N evenly-
 * sampled frames of its FIRST clip into a GRID spritesheet, played in-game as a Phaser
 * `Sprite` animation — so the decor MOVES without ever running a persistent live WebGL
 * context (which exhausted the GPU). The renderer is transient either way: it renders
 * N times then disposes, so there is NO lasting GPU load. Keeps the model's own
 * materials; only un-materialed meshes get a matte.
 */
function bakeModel(
  scene: Phaser.Scene,
  object: THREE.Object3D,
  key: string,
  animations?: THREE.AnimationClip[]
): BakeResult {
  const clip = animations && animations.length > 0 ? animations[0]! : null;
  // Animated bakes render at a leaner 256px/frame so a whole clip's sheet stays inside
  // a weak GPU's texture budget; a static bake keeps the crisp 512.
  const SIZE = clip ? 256 : 512;
  const duration = clip ? Math.max(0.1, clip.duration) : 0;
  // ~12fps, clamped so a long clip doesn't balloon the sheet and a short one still reads.
  const N = clip ? Math.max(4, Math.min(24, Math.round(duration * 12))) : 1;
  const cols = Math.ceil(Math.sqrt(N)); // GRID layout (never a 12k-wide strip that fails to upload)
  const rows = Math.ceil(N / cols);

  // Give un-materialed / dark meshes a readable matte so the snapshot isn't black.
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const hasMat = mesh.material && (Array.isArray(mesh.material) ? mesh.material.length : true);
      if (!hasMat) {
        mesh.material = new THREE.MeshStandardMaterial({ color: 0xb8b2c0, roughness: 0.7, metalness: 0.1 });
      }
    }
  });

  const three = new THREE.Scene();
  three.add(object);
  three.add(new THREE.AmbientLight(0xffffff, 0.9));
  const key1 = new THREE.DirectionalLight(0xffffff, 1.1);
  key1.position.set(3, 5, 4);
  three.add(key1);
  const key2 = new THREE.DirectionalLight(0xffe6c0, 0.5);
  key2.position.set(-4, 2, -3);
  three.add(key2);

  const mixer = clip ? new THREE.AnimationMixer(object) : null;
  if (mixer && clip) mixer.clipAction(clip).play();
  // Pose at a natural mid-clip frame BEFORE framing (frame 0 is often a flat T-pose), so
  // both the static snapshot and the camera fit read as "alive".
  if (mixer) mixer.setTime(duration * 0.5);

  // Frame the model (AFTER posing so the bounds fit the pose): centre on origin, pull the
  // camera to fit its bounding sphere. Framed ONCE and reused for every animation frame.
  const box = new THREE.Box3().setFromObject(object);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const center = sphere.center.clone();
  object.position.sub(center);
  const r = Math.max(sphere.radius, 0.001);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, r * 100);
  const dist = (r / Math.sin((camera.fov * Math.PI) / 180 / 2)) * 1.15;
  camera.position.set(dist * 0.6, dist * 0.7, dist * 0.9);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(SIZE, SIZE);

  const canvas = document.createElement('canvas');
  canvas.width = cols * SIZE;
  canvas.height = rows * SIZE;
  const cctx = canvas.getContext('2d')!;

  for (let f = 0; f < N; f++) {
    if (mixer) {
      // Sample [0, duration) evenly so frame N-1 → frame 0 is one clean loop step. The
      // model was re-centred by `center` above; keep it centred as the pose changes.
      mixer.setTime((f / N) * duration);
      const b = new THREE.Box3().setFromObject(object);
      object.position.sub(b.getBoundingSphere(new THREE.Sphere()).center);
    }
    renderer.render(three, camera);
    cctx.drawImage(renderer.domElement, (f % cols) * SIZE, Math.floor(f / cols) * SIZE);
  }

  renderer.dispose();
  three.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry?.dispose?.();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    }
  });

  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.addCanvas(key, canvas);
  // Slice the grid into numbered frames (0..N-1) so `generateFrameNumbers` can build the
  // decor's play loop. `addSpriteSheet`'s TS type rejects a canvas source, so we add the
  // frames by hand — the same thing it does internally.
  if (clip && tex) {
    for (let f = 0; f < N; f++) {
      tex.add(f, 0, (f % cols) * SIZE, Math.floor(f / cols) * SIZE, SIZE, SIZE);
    }
  }
  // The still snapshot (persistence / static fallback) is always frame 0, SIZE×SIZE.
  const still = document.createElement('canvas');
  still.width = SIZE;
  still.height = SIZE;
  still.getContext('2d')!.drawImage(canvas, 0, 0, SIZE, SIZE, 0, 0, SIZE, SIZE);
  return { key, dataUrl: still.toDataURL('image/png'), frameCount: N, frameRate: clip ? N / duration : 0 };
}
