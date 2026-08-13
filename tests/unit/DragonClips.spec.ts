import { describe, expect, it } from 'vitest';
import {
  CHARACTER_ANIMS,
  type CharacterAnimsData,
  dragonClipCharacter,
  validateCharacterAnims
} from '../../src/core/characterAnims';
import { DRAGON_CLIPS } from '../../src/core/Constants';
import {
  breedClipIds,
  breedVramBytes,
  clipLoadTiers,
  clipVramBytes,
  planClipEviction
} from '../../src/core/dragonClips';

const MB = 1024 * 1024;

/** A stand-in roster: one bare breed and two skins claiming the same board key,
 *  which is the shape that makes residency hard and the shape the Emporium has. */
const FIXTURE: CharacterAnimsData = {
  version: 1,
  characters: {
    bare_baby: {
      board: 'ember_dragon:3',
      clips: {
        idle: { file: 'sprites/anims/bare_baby/idle.webp', frames: 100, frameWidth: 200, frameHeight: 200, fps: 24, loop: true, scale: 1, dx: 0, dy: 0 },
        fly: { file: 'sprites/anims/bare_baby/fly.webp', frames: 50, frameWidth: 200, frameHeight: 200, fps: 24, loop: true, scale: 1, dx: 0, dy: 0 },
        roar: { file: 'sprites/anims/bare_baby/roar.webp', frames: 25, frameWidth: 200, frameHeight: 200, fps: 24, loop: false, scale: 1, dx: 0, dy: 0 },
        talking: { file: 'sprites/anims/bare_baby/talking.webp', frames: 400, frameWidth: 200, frameHeight: 200, fps: 24, loop: true, scale: 1, dx: 0, dy: 0, stage: 'portrait' }
      }
    },
    frosty_baby: {
      board: 'ember_dragon:3',
      skin: 'frosty',
      clips: {
        idle: { file: 'sprites/anims/frosty_baby/idle.webp', frames: 10, frameWidth: 200, frameHeight: 200, fps: 24, loop: true, scale: 1, dx: 0, dy: 0 }
      }
    },
    stormy_baby: {
      board: 'ember_dragon:3',
      skin: 'stormy',
      clips: {
        idle: { file: 'sprites/anims/stormy_baby/idle.webp', frames: 10, frameWidth: 200, frameHeight: 200, fps: 24, loop: true, scale: 1, dx: 0, dy: 0 }
      }
    }
  }
};

describe('dragonClipCharacter — skin awareness', () => {
  it('gives the bare breed when no skin is worn', () => {
    expect(dragonClipCharacter('ember_dragon', 3, null, FIXTURE)).toBe('bare_baby');
  });

  it('gives the worn skin its own breed', () => {
    expect(dragonClipCharacter('ember_dragon', 3, 'frosty', FIXTURE)).toBe('frosty_baby');
    expect(dragonClipCharacter('ember_dragon', 3, 'stormy', FIXTURE)).toBe('stormy_baby');
  });

  it('falls back to the bare breed for a skin with no clips of its own', () => {
    // Moonwhisker/Ashglass are art-only cosmetics: buying one must never cost
    // the dragon its animation.
    expect(dragonClipCharacter('ember_dragon', 3, 'moonwhisker', FIXTURE)).toBe('bare_baby');
  });

  it('is null for a chain+tier no breed claims', () => {
    expect(dragonClipCharacter('lumber', 4, null, FIXTURE)).toBeNull();
  });
});

describe('clip accounting', () => {
  it('counts a decoded sheet as frames × w × h × RGBA', () => {
    const clip = FIXTURE.characters.bare_baby.clips.idle;
    expect(clipVramBytes(clip)).toBe(100 * 200 * 200 * 4);
  });

  it('leaves portrait clips out of a breed entirely', () => {
    // They belong to the dialogue bubble in UIScene, which outlives every
    // board; counting them here would invite an eviction that freezes the game.
    expect(breedClipIds('bare_baby', FIXTURE)).toEqual(['idle', 'fly', 'roar']);
    expect(breedVramBytes('bare_baby', undefined, FIXTURE)).toBe(175 * 200 * 200 * 4);
  });
});

describe('clipLoadTiers', () => {
  it('fetches the idle and the fly up front, and the mood clips later', () => {
    const t = clipLoadTiers('bare_baby', {}, FIXTURE);
    expect(t.eager).toEqual(['idle', 'fly']);
    expect(t.deferred).toEqual(['roar']);
  });

  it('on a weak device fetches the idle alone — flight falls back to the rig', () => {
    const t = clipLoadTiers('bare_baby', { lean: true }, FIXTURE);
    expect(t.eager).toEqual(['idle']);
    expect(t.deferred).toEqual(['fly', 'roar']);
  });

  it('never defers the idle, which is the floor every other clip degrades onto', () => {
    for (const lean of [false, true]) {
      for (const id of Object.keys(CHARACTER_ANIMS.characters)) {
        if (!CHARACTER_ANIMS.characters[id].board) continue;
        const t = clipLoadTiers(id, { lean });
        if (breedClipIds(id).includes('idle')) expect(t.eager).toContain('idle');
        expect(t.deferred).not.toContain('idle');
      }
    }
  });
});

describe('planClipEviction', () => {
  const data = FIXTURE;
  const ref = (breed: string, clip: string) => ({ breed, clip });
  const ids = (plan: { drop: { breed: string; clip: string }[] }) => plan.drop.map((r) => `${r.breed}/${r.clip}`);
  const ALL_BARE = [ref('bare_baby', 'idle'), ref('bare_baby', 'fly'), ref('bare_baby', 'roar')];

  it('drops nothing while everything fits', () => {
    const plan = planClipEviction({ live: [], resident: [ref('frosty_baby', 'idle')], budgetBytes: 100 * MB, data });
    expect(plan.drop).toEqual([]);
    expect(plan.overBudget).toBe(false);
  });

  it('drops least-recently-needed first, and stops as soon as it fits', () => {
    const plan = planClipEviction({
      live: [],
      resident: [ref('frosty_baby', 'idle'), ref('stormy_baby', 'idle'), ...ALL_BARE],
      budgetBytes: breedVramBytes('bare_baby', undefined, data),
      data
    });
    expect(ids(plan)).toEqual(['frosty_baby/idle', 'stormy_baby/idle']);
    expect(plan.overBudget).toBe(false);
  });

  it('keeps every sheet of a breed a live dragon is wearing before touching it', () => {
    const plan = planClipEviction({
      live: ['bare_baby'],
      resident: [...ALL_BARE, ref('frosty_baby', 'idle')],
      budgetBytes: breedVramBytes('bare_baby', undefined, data),
      data
    });
    expect(ids(plan)).toEqual(['frosty_baby/idle']);
  });

  it('gives back the MOOD sheets of a live breed before it overspends', () => {
    // The rank that pays for the finale: the roar draws for a second and a
    // half, a minute apart, only while hungry — handing it back between beats
    // is invisible, and the refetch comes off the HTTP cache.
    const eager = breedVramBytes('bare_baby', clipLoadTiers('bare_baby', {}, data).eager, data);
    const plan = planClipEviction({ live: ['bare_baby'], resident: ALL_BARE, budgetBytes: eager, data });
    expect(ids(plan)).toEqual(['bare_baby/roar']);
    expect(plan.overBudget).toBe(false);
  });

  it('never drops the sheet an overlay is drawing', () => {
    const plan = planClipEviction({
      live: ['bare_baby'],
      playing: [ref('bare_baby', 'roar')],
      resident: ALL_BARE,
      budgetBytes: 1,
      data
    });
    expect(ids(plan)).toEqual([]);
    expect(plan.overBudget).toBe(true);
  });

  it('never drops what it is making room FOR', () => {
    const plan = planClipEviction({
      live: [],
      resident: [ref('frosty_baby', 'idle'), ref('bare_baby', 'idle')],
      incoming: [ref('bare_baby', 'idle')],
      budgetBytes: 1,
      data
    });
    expect(ids(plan)).toEqual(['frosty_baby/idle']);
  });

  it('counts only the eager wave of an arriving breed', () => {
    const eager = clipLoadTiers('bare_baby', {}, data).eager;
    const plan = planClipEviction({
      live: [],
      resident: [],
      incoming: eager.map((c) => ref('bare_baby', c)),
      budgetBytes: 1000 * MB,
      data
    });
    expect(plan.keptBytes).toBe(breedVramBytes('bare_baby', eager, data));
    expect(plan.keptBytes).toBeLessThan(breedVramBytes('bare_baby', undefined, data)); // the roar is unpaid
  });

  it('reports an overspend rather than unmaking a live animal', () => {
    const plan = planClipEviction({
      live: ['bare_baby'],
      resident: [ref('bare_baby', 'idle')],
      budgetBytes: 1,
      data
    });
    expect(plan.drop).toEqual([]);
    expect(plan.overBudget).toBe(true);
  });
});

describe('the shipped roster fits its ceiling', () => {
  const boardBreeds = Object.entries(CHARACTER_ANIMS.characters)
    .filter(([, c]) => c.board)
    .map(([id]) => id);

  it('has board breeds to speak of', () => {
    expect(boardBreeds.length).toBeGreaterThan(0);
  });

  it('keeps every WORN wardrobe under the budget', () => {
    // The guarantee that makes six breeds affordable: a Keeper wears one skin
    // per chain, so the askable set is a wardrobe and not the catalogue. Every
    // (skin × the chain+tiers it dresses) combination must fit — if a new breed
    // ever breaks this, the budget is wrong or the art is too heavy, and this
    // fails in node instead of on the player's device.
    const keys = new Set(boardBreeds.map((id) => CHARACTER_ANIMS.characters[id].board!));
    const skins = new Set<string | null>([null]);
    for (const id of boardBreeds) {
      const s = CHARACTER_ANIMS.characters[id].skin;
      if (s) skins.add(s);
    }
    for (const skin of skins) {
      let worn = 0;
      for (const key of keys) {
        const [chain, tier] = key.split(':');
        const id = dragonClipCharacter(chain, Number(tier), skin);
        if (id) worn += breedVramBytes(id, clipLoadTiers(id).eager);
      }
      expect(worn / MB, `worn wardrobe for skin ${skin ?? '(bare)'}`).toBeLessThanOrEqual(DRAGON_CLIPS.budgetMb);
    }
  });

  it('brings the worst board there is back under the ceiling', () => {
    // The finale: a whelp, a red adult and the Golden Elder all standing, all
    // three having been hungry and having slept, so every sheet any of them
    // owns is resident. That is 310 MB of wardrobe against a 224 MB ceiling —
    // the case the mood-sheet rank exists for. Nothing here is evictable as a
    // whole breed (all three are worn), so if this passes it is because the
    // roars went back.
    const worn = ['redwhelp', 'redadult', 'golden_adult'];
    const resident = worn.flatMap((breed) => breedClipIds(breed).map((clip) => ({ breed, clip })));
    const plan = planClipEviction({
      live: worn,
      resident,
      budgetBytes: DRAGON_CLIPS.budgetMb * MB
    });
    expect(plan.overBudget).toBe(false);
    // …and what it gave back is only mood clips: no idle, no fly.
    expect(plan.drop.map((r) => r.clip).sort()).not.toContain('idle');
    expect(plan.drop.map((r) => r.clip)).not.toContain('fly');
  });

  it('validates structurally — the check its own doc promises', () => {
    expect(validateCharacterAnims(CHARACTER_ANIMS)).toEqual([]);
  });
});
