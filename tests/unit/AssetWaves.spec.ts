import { describe, expect, it } from 'vitest';
import { bootChains, itemChainOf, splitWaves, tutorialChains, waveFor } from '../../src/core/assetWaves';
import { WORLD_ID } from '../../src/core/Constants';
import assetsJson from '../../src/data/assets.json';
import mapJson from '../../src/data/map.json';
import tutorialJson from '../../src/data/tutorial.json';
import type { AssetsManifest, MapData, SaveDataV1, TutorialData } from '../../src/core/types';

const map = mapJson as unknown as MapData;
const tutorial = tutorialJson as unknown as TutorialData;
const assets = assetsJson as unknown as AssetsManifest;

const chains = (save: SaveDataV1 | null = null): Set<string> =>
  bootChains(save, map, tutorial, WORLD_ID);

const ctx = (save: SaveDataV1 | null = null) => ({
  placed: new Set(['tile_ash', 'background_emberkeep', 'decor_crystal']),
  bootChains: chains(save)
});

describe('item keys — the chain is what is left after the tier', () => {
  it('splits the tier off the END, not the first underscore', () => {
    // ember_dragon / cinder_vein contain underscores; splitting on the first one
    // would classify every multi-word chain under a chain that does not exist.
    expect(itemChainOf('item_ember_dragon_3')).toBe('ember_dragon');
    expect(itemChainOf('item_cinder_vein_2')).toBe('cinder_vein');
    expect(itemChainOf('item_crystal_1')).toBe('crystal');
  });

  it('has no opinion on a key with no tier', () => {
    expect(itemChainOf('item_crystal')).toBeNull();
    expect(itemChainOf('ui_hand')).toBeNull();
  });
});

describe('the boot chain set', () => {
  it('always includes what a fresh save is seeded with', () => {
    // map.json startingItems is a single crystal:1 — the whole of a new board.
    for (const p of map.startingItems) expect(chains().has(p.chain)).toBe(true);
  });

  it('includes the tutorial script while the tutorial is still running', () => {
    const scripted = tutorialChains(tutorial);
    expect(scripted.size).toBeGreaterThan(5);
    for (const c of scripted) expect(chains().has(c)).toBe(true);
  });

  it('drops the tutorial script once it is done — that player has no script ahead', () => {
    const done = { items: [], tutorial: { index: 99, done: true } } as unknown as SaveDataV1;
    const after = chains(done);
    expect(after.size).toBeLessThan(chains().size);
    // …but the seed is still there, because a board always has one.
    for (const p of map.startingItems) expect(after.has(p.chain)).toBe(true);
  });

  it('includes whatever is standing on the SAVED board', () => {
    const save = {
      items: [{ id: 1, chain: 'quartz', tier: 2, col: 0, row: 0, kind: 'item' }],
      tutorial: { index: 99, done: true }
    } as unknown as SaveDataV1;
    expect(chains(save).has('quartz')).toBe(true);
  });

  it('reads the board of the world the save RESUMES in', () => {
    const save = {
      items: [{ id: 1, chain: 'quartz', tier: 2, col: 0, row: 0, kind: 'item' }],
      activeWorld: 'borealis',
      boards: { borealis: { items: [{ id: 2, chain: 'frost', tier: 2, col: 0, row: 0, kind: 'item' }] } },
      tutorial: { index: 99, done: true }
    } as unknown as SaveDataV1;
    expect(chains(save).has('frost')).toBe(true);
    expect(chains(save).has('quartz')).toBe(false);
  });
});

describe('the wave split', () => {
  it('gates the board on terrain and chrome', () => {
    expect(waveFor('tile_ash', ctx())).toBe('boot');
    expect(waveFor('background_emberkeep', ctx())).toBe('boot');
    expect(waveFor('ui_hand', ctx())).toBe('boot');
    expect(waveFor('grass_1', ctx())).toBe('boot');
    expect(waveFor('fx_spark', ctx())).toBe('boot');
  });

  it('streams the art of a chain the opening cannot reach', () => {
    // `frost` is a Borealis breed — not seeded, not in the tutorial script.
    expect(chains().has('frost')).toBe(false);
    expect(waveFor('item_frost_2', ctx())).toBe('play');
  });

  it('boots the art of a chain the opening DOES reach', () => {
    expect(waveFor('item_crystal_1', ctx())).toBe('boot');
  });

  it('keeps the existing lazy-screen contract intact', () => {
    // These carry an obligation (a matching ensureTextures call), so only
    // isLazyScreenArt may promote to ondemand.
    expect(waveFor('trailer_world_ice', ctx())).toBe('ondemand');
    expect(waveFor('ui_teaser_north', ctx())).toBe('ondemand');
    expect(waveFor('ui_levelup_emblem', ctx())).toBe('ondemand');
  });

  it('streams an unplaced tile rather than booting it', () => {
    expect(waveFor('tile_moss', ctx())).toBe('play');
  });

  it('defaults an unknown category to play, never to ondemand', () => {
    // An asset nobody classified must still download — just not in front of the
    // Play button. Defaulting to ondemand would make it silently missing.
    expect(waveFor('brandnew_thing', ctx())).toBe('play');
  });
});

describe('the real manifest', () => {
  const files = assets.images.filter((e) => e.source === 'file' && e.file);
  const waves = splitWaves(files, ctx());

  it('classifies every file-backed entry exactly once', () => {
    expect(waves.boot.length + waves.play.length + waves.ondemand.length).toBe(files.length);
  });

  it('keeps the boot gate a minority of the manifest', () => {
    // The whole point: the board opens on a fraction of the art. If a future
    // change pushes most of it back into boot, this is the guard that says so.
    expect(waves.boot.length).toBeLessThan(files.length / 2);
    expect(waves.play.length).toBeGreaterThan(50);
  });

  it('never boots a reveal card or a codex card — those follow a hatch', () => {
    for (const e of waves.boot) {
      expect(e.key.startsWith('reveal_')).toBe(false);
      expect(e.key.startsWith('card_')).toBe(false);
    }
  });
});
