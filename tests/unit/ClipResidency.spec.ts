import { describe, expect, it } from 'vitest';
import { WORLD_ID } from '../../src/core/Constants';
import { boardClipCharacters } from '../../src/core/characterAnims';
import {
  clipBytesFor,
  clipKeysFor,
  isDragonClipCharacter,
  planClipEviction,
  releaseClips,
  savedDragonClips
} from '../../src/core/clipResidency';
import type { SaveDataV1, SavedBoardItem } from '../../src/core/types';

const MB = 1e6;

/** A `TextureBin` over a plain Set — the sliver of Phaser's TextureManager the
 *  eviction rule needs, exactly as `worldArt`'s does. */
const bin = (keys: string[]) => {
  const held = new Set(keys);
  return {
    held,
    exists: (k: string) => held.has(k),
    remove: (k: string) => void held.delete(k)
  };
};

const item = (chain: string, tier: number): SavedBoardItem =>
  ({ id: 1, chain, tier, col: 0, row: 0, kind: 'item' }) as SavedBoardItem;

const save = (over: Partial<SaveDataV1>): SaveDataV1 => ({ items: [], ...over }) as SaveDataV1;

describe('clip cost — the decoded figure, not the file size', () => {
  it('prices a breed by frame geometry', () => {
    // storm_adult: idle 108 + roar 66 + fly 203 frames. It is the DECODED number
    // that decides whether the tab survives, and it is ~100x the file size.
    const bytes = clipBytesFor('storm_adult');
    expect(bytes / MB).toBeGreaterThan(90);
    expect(bytes / MB).toBeLessThan(130);
  });

  it('costs an unknown character nothing rather than throwing', () => {
    expect(clipBytesFor('no_such_dragon')).toBe(0);
    expect(clipKeysFor('no_such_dragon')).toEqual([]);
  });

  it('every shipped breed together is the gigabyte that killed iOS', () => {
    const total = boardClipCharacters().reduce((n, id) => n + clipBytesFor(id), 0);
    expect(total / MB).toBeGreaterThan(1000);
  });
});

describe('eviction — the board keeps what it is showing', () => {
  it('does nothing while under budget', () => {
    expect(
      planClipEviction({
        resident: ['storm_adult'],
        pinned: new Set(),
        lastUsedAt: new Map(),
        budgetBytes: 640 * MB
      })
    ).toEqual([]);
  });

  it('drops the least recently used first', () => {
    const evict = planClipEviction({
      resident: ['storm_adult', 'frost_adult', 'emerald_adult'],
      pinned: new Set(),
      lastUsedAt: new Map([
        ['storm_adult', 300],
        ['frost_adult', 100],
        ['emerald_adult', 200]
      ]),
      budgetBytes: 120 * MB
    });
    expect(evict[0]).toBe('frost_adult');
    expect(evict).not.toContain('storm_adult'); // the newest survives longest
  });

  it('NEVER evicts a breed the board is wearing, even over budget', () => {
    // Evicting a texture out from under a live sprite null-crashes the renderer
    // and takes Phaser's RAF chain with it. Going over budget is the safe answer.
    const pinned = new Set(['storm_adult', 'frost_adult', 'emerald_adult']);
    expect(
      planClipEviction({
        resident: [...pinned],
        pinned,
        lastUsedAt: new Map(),
        budgetBytes: 1 * MB
      })
    ).toEqual([]);
  });

  it('evicts only down to the budget, not everything it could', () => {
    const resident = ['storm_adult', 'frost_adult', 'emerald_adult'];
    const total = resident.reduce((n, id) => n + clipBytesFor(id), 0);
    const evict = planClipEviction({
      resident,
      pinned: new Set(),
      lastUsedAt: new Map([
        ['storm_adult', 3],
        ['frost_adult', 1],
        ['emerald_adult', 2]
      ]),
      // Room for everything but the oldest.
      budgetBytes: total - clipBytesFor('frost_adult')
    });
    expect(evict).toEqual(['frost_adult']);
  });

  it('a released breed gives back every key it owned', () => {
    const keys = clipKeysFor('storm_adult');
    expect(keys.length).toBeGreaterThan(1);
    const b = bin([...keys, 'background_emberkeep']);
    expect(releaseClips(b, 'storm_adult').sort()).toEqual([...keys].sort());
    // Shared art is untouched — this rule owns dragons and nothing else.
    expect(b.held.has('background_emberkeep')).toBe(true);
  });
});

describe('scope — dragons only', () => {
  it('governs board dragons', () => {
    expect(isDragonClipCharacter('storm_adult')).toBe(true);
  });

  it('leaves world art to worldArt.ts', () => {
    // Eleanor's and the cauldron's clips are exchanged at a world's door by
    // `releaseAwayWorldArt`. A byte budget evicting them too would pull a
    // standee's sheets out from under her mid-conversation.
    expect(isDragonClipCharacter('eleanor')).toBe(false);
    expect(isDragonClipCharacter('selyna')).toBe(false);
    expect(isDragonClipCharacter('cauldron')).toBe(false);
  });
});

describe('the boot prefetch — read the save, not the un-hydrated state', () => {
  it('is empty for a fresh start', () => {
    expect(savedDragonClips(null, WORLD_ID)).toEqual([]);
    expect(savedDragonClips(save({}), WORLD_ID)).toEqual([]);
  });

  it('finds the breeds standing on the authored board', () => {
    const ids = savedDragonClips(save({ items: [item('ember_dragon', 3)] }), WORLD_ID);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => isDragonClipCharacter(id))).toBe(true);
  });

  it('reads the board of the world the save RESUMES in, not the authored one', () => {
    // A save that quit in Borealis comes back in Borealis, and it is Borealis's
    // dragons that must arrive before the board does.
    const data = save({
      items: [item('ember_dragon', 3)],
      activeWorld: 'borealis',
      boards: { borealis: { items: [item('frost', 2)] } }
    });
    expect(savedDragonClips(data, WORLD_ID)).toEqual(['frost_baby']);
    // …and the authored board is what a save with no `activeWorld` resumes on.
    expect(savedDragonClips(save({ items: [item('ember_dragon', 3)] }), WORLD_ID)).toEqual([
      'redwhelp'
    ]);
  });

  it('respects a worn Emporium skin — a Frost skin IS that breed on the board', () => {
    expect(savedDragonClips(save({ items: [item('ember_dragon', 3)] }), WORLD_ID)).toEqual([
      'redwhelp'
    ]);
    expect(
      savedDragonClips(
        save({ items: [item('ember_dragon', 3)], dragonSkins: { ember_dragon: 'ashglass' } }),
        WORLD_ID
      )
    ).toEqual(['ashglass_baby']);
  });

  it('never lists the same breed twice', () => {
    const ids = savedDragonClips(
      save({ items: [item('ember_dragon', 3), item('ember_dragon', 3), item('ember_dragon', 3)] }),
      WORLD_ID
    );
    expect(ids.length).toBe(new Set(ids).size);
  });
});
