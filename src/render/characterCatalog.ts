import Phaser from 'phaser';
import facesJson from '../data/faces.json';
import type { FacesData } from './faceAnimations';
import { PRESETS } from './rigAnimations';
import { RigPlayer } from './RigPlayer';
import type { RigDoc } from './rigTypes';

/**
 * Catalog of live-riggable characters for UI use (the UI Builder's composer
 * places these into custom components with a body-motion + face selection).
 * Keyed by the rig's own `character` id. BoardScene keeps its chain-keyed
 * DRAGON_RIGS map for gameplay; this catalog is the character-centric view.
 */
export const CHARACTER_RIGS: Record<string, { url: string; label: string; thumbTexture: string }> = {
  'dragon-red': {
    url: 'sprites/characters/dragon/red-dragon/rig/dragon-red.rig.json',
    label: 'Red Dragon',
    thumbTexture: 'item_ember_dragon_3'
  },
  'dragon-emerald': {
    url: 'sprites/characters/dragon/emerald-dragon/rig/dragon-emerald.rig.json',
    label: 'Emerald Dragon',
    thumbTexture: 'item_emerald_3'
  },
  'dragon-golden': {
    url: 'sprites/characters/dragon/golden-dragon/rig-adult/golden-dragon.rig.json',
    label: 'Golden Dragon',
    thumbTexture: 'item_golden_egg_2'
  }
};

export const CHARACTER_FACES = facesJson as FacesData;

export const faceTextureKeyFor =
  (character: string) =>
  (setKey: string, frameIndex: number): string =>
    `face:${character}:${setKey}:${frameIndex}`;

/** Body motion presets straight from the shared animation brain. */
export function bodyMotions(): Array<{ key: string; name: string }> {
  return PRESETS.map((p) => ({ key: p.key, name: p.name }));
}

/** Face modes a character supports (blink = ambient scheduler, talk = loop). */
export function faceMotions(character: string): string[] {
  const sets = CHARACTER_FACES[character]?.sets ?? {};
  const out = ['none'];
  if (sets['blink']) out.push('blink');
  if (sets['talk']) out.push('talk');
  return out;
}

const cacheKey = 'characterRigCache';

/**
 * Fetch + texture-load a character rig once per game (cached in the registry).
 * Face frame textures load alongside so attachFace() is ready. Returns null on
 * any failure — callers degrade gracefully (the layer just stays empty).
 */
export async function loadCharacterRig(scene: Phaser.Scene, characterId: string): Promise<RigDoc | null> {
  const entry = CHARACTER_RIGS[characterId];
  if (!entry) return null;
  let cache = scene.registry.get(cacheKey) as Map<string, RigDoc | null> | undefined;
  if (!cache) {
    cache = new Map();
    scene.registry.set(cacheKey, cache);
  }
  if (cache.has(characterId)) return cache.get(characterId) ?? null;
  try {
    const base = (import.meta.env.BASE_URL ?? './').replace(/\/?$/, '/');
    const res = await fetch(base + entry.url);
    if (!res.ok) throw new Error(`rig fetch ${res.status}`);
    const rig = (await res.json()) as RigDoc;
    if (rig.format !== 'emberkeep-rig' || !rig.images || !scene.scene.isActive()) throw new Error('bad rig');
    // Normalise a default-named export ('character') to its catalog id so
    // texture keys never collide between two default-named rigs.
    if (!rig.character || rig.character === 'character') rig.character = characterId;
    await RigPlayer.loadTextures(scene, rig, (layer) => `rig:${rig.character}:${layer}`);
    const face = CHARACTER_FACES[rig.character];
    if (face) {
      try {
        await RigPlayer.loadFaceTextures(scene, face, faceTextureKeyFor(rig.character), base);
      } catch {
        /* face art optional */
      }
    }
    cache.set(characterId, rig);
    return rig;
  } catch {
    cache.set(characterId, null);
    return null;
  }
}
