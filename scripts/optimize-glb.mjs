/**
 * Decimate Laurah-rigged.glb (~28MB, 707K tris) down to a realtime-friendly
 * ~10K-triangle mesh while preserving the 41-bone skinning rig and animations.
 * Run once: node scripts/optimize-glb.mjs
 */
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, simplify, weld } from '@gltf-transform/functions';
import { statSync } from 'fs';
import { MeshoptSimplifier } from 'meshoptimizer';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT  = resolve(__dirname, '../assets/3d-characters/Laurah-rigged.glb');
const OUTPUT = resolve(__dirname, '../assets/3d-characters/Laurah-game.glb');

console.log('Waiting for MeshoptSimplifier WASM...');
await MeshoptSimplifier.ready;
console.log('WASM ready. Reading GLB...');

const io = new NodeIO();
const document = await io.read(INPUT);

const countTris = () =>
  document.getRoot().listMeshes().reduce((n, m) =>
    n + m.listPrimitives().reduce((p, prim) => {
      const idx = prim.getIndices();
      return p + (idx ? idx.getCount() / 3 : 0);
    }, 0), 0);

console.log(`Before: ${Math.round(countTris()).toLocaleString()} triangles`);

await document.transform(
  weld({ tolerance: 0.0001 }),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.015, error: 0.001 }),
  dedup(),
  prune()
);

console.log(`After:  ${Math.round(countTris()).toLocaleString()} triangles`);

await io.write(OUTPUT, document);

const inMB  = (statSync(INPUT).size  / 1024 / 1024).toFixed(1);
const outMB = (statSync(OUTPUT).size / 1024 / 1024).toFixed(1);
console.log(`Size: ${inMB} MB → ${outMB} MB`);
console.log('Done →', OUTPUT);
