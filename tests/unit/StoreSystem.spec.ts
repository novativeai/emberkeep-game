import { describe, expect, it } from 'vitest';
import { RARITY } from '../../src/core/Constants';
import assetsDoc from '../../src/data/assets.json';
import storeDoc from '../../src/data/store.json';
import type { StoreData } from '../../src/core/types';
import { capture, createTestContext } from './helpers';

const SKIN = 'manor_mushroom'; // 250 gold
const DECOR = 'ash_urn'; // 120 gold

/** Give the player enough Gold to shop with. */
function fund(ctx: ReturnType<typeof createTestContext>, coins: number): void {
  ctx.bus.emit('economy:add', { coins, reason: 'test' });
}

describe('StoreSystem (cosmetics, bought with earned Gold)', () => {
  it('buying a skin spends the gold, records it and wears it immediately', () => {
    const ctx = createTestContext();
    fund(ctx, 1000);
    const bought = capture(ctx.bus, 'store:purchased');
    const worn = capture(ctx.bus, 'store:skin_changed');

    ctx.bus.emit('ui:store_buy_requested', { itemId: SKIN });

    expect(ctx.state.ownedCosmetics).toContain(SKIN);
    expect(ctx.state.coins).toBe(1000 - 250);
    expect(bought.at(-1)).toMatchObject({ itemId: SKIN, kind: 'skin', gold: 250 });
    // A skin you just paid for is a skin you want to see on the board.
    expect(worn.at(-1)).toEqual({ itemId: SKIN });
    expect(ctx.state.manorSkin).toBe(SKIN);
  });

  it('refuses when the gold is short, and takes nothing', () => {
    const ctx = createTestContext();
    fund(ctx, 100);
    const failed = capture(ctx.bus, 'store:purchase_failed');

    ctx.bus.emit('ui:store_buy_requested', { itemId: SKIN });

    expect(failed.at(-1)).toMatchObject({ itemId: SKIN, reason: 'gold' });
    expect(ctx.state.ownedCosmetics).toEqual([]);
    expect(ctx.state.coins).toBe(100);
  });

  it('refuses a second purchase of something already owned', () => {
    const ctx = createTestContext();
    fund(ctx, 1000);
    ctx.bus.emit('ui:store_buy_requested', { itemId: SKIN });
    const spent = ctx.state.coins;
    const failed = capture(ctx.bus, 'store:purchase_failed');

    ctx.bus.emit('ui:store_buy_requested', { itemId: SKIN });

    expect(failed.at(-1)).toMatchObject({ itemId: SKIN, reason: 'owned' });
    expect(ctx.state.coins).toBe(spent); // charged exactly once
    expect(ctx.state.ownedCosmetics.filter((i) => i === SKIN)).toHaveLength(1);
  });

  it('buying a decoration places it on the board as non-merging decor', () => {
    const ctx = createTestContext();
    fund(ctx, 1000);

    ctx.bus.emit('ui:store_buy_requested', { itemId: DECOR });

    const placed = [...ctx.state.items.values()].filter((i) => i.kind === 'decor');
    expect(placed).toHaveLength(1);
    expect(placed[0]!.chain).toBe(DECOR);
    expect(ctx.state.coins).toBe(1000 - 120);
    expect(ctx.state.ownedCosmetics).toContain(DECOR);
  });

  it('charges nothing when the board has no room for the decoration', () => {
    const ctx = createTestContext();
    fund(ctx, 1000);
    // Fill every active tile, so there is nowhere for a prop to stand.
    for (let row = 0; row < ctx.data.map.rows; row++) {
      for (let col = 0; col < ctx.data.map.cols; col++) {
        if (!ctx.state.isTileActive(col, row)) continue;
        if (ctx.state.itemIdAt(col, row) !== null) continue;
        ctx.state.addItem({ chain: 'flame_gem', tier: 1, col, row, kind: 'item' });
      }
    }
    const failed = capture(ctx.bus, 'store:purchase_failed');

    ctx.bus.emit('ui:store_buy_requested', { itemId: DECOR });

    // A refund the player has to notice is a bug they will report — so the
    // board is asked FIRST and the gold never moves.
    expect(failed.at(-1)).toMatchObject({ itemId: DECOR, reason: 'no_room' });
    expect(ctx.state.coins).toBe(1000);
    expect(ctx.state.ownedCosmetics).toEqual([]);
  });

  it('equipping is limited to skins the player owns, and null bares the Manor', () => {
    const ctx = createTestContext();
    fund(ctx, 1000);

    ctx.bus.emit('ui:store_equip_requested', { itemId: 'manor_treehouse' });
    expect(ctx.state.manorSkin).toBeNull(); // not owned — ignored

    ctx.bus.emit('ui:store_buy_requested', { itemId: 'manor_treehouse' });
    expect(ctx.state.manorSkin).toBe('manor_treehouse');

    ctx.bus.emit('ui:store_equip_requested', { itemId: null });
    expect(ctx.state.manorSkin).toBeNull();
  });

  it('a dragon skin fills its own dragon slot, not the Manor slot', () => {
    const ctx = createTestContext();
    fund(ctx, 2000);
    const worn = capture(ctx.bus, 'store:dragon_skin_changed');

    ctx.bus.emit('ui:store_buy_requested', { itemId: 'ashglass' });

    expect(ctx.state.dragonSkins).toEqual({ ember_dragon: 'ashglass' });
    expect(ctx.state.manorSkin).toBeNull(); // the Manor is untouched
    expect(worn.at(-1)).toEqual({ dragon: 'ember_dragon', itemId: 'ashglass' });
  });

  it('a chain-grant card hands over a clutch, and fills no wardrobe slot', () => {
    const ctx = createTestContext();
    fund(ctx, 2000);
    const worn = capture(ctx.bus, 'store:dragon_skin_changed');

    // `storm` is sold in Emberkeep, which is where a fresh context stands.
    ctx.bus.emit('ui:store_buy_requested', { itemId: 'storm' });

    // THREE tier-1 eggs — one 3-merge from the animal. Fewer would be a
    // purchase the player has to top up before it becomes anything.
    const clutch = [...ctx.state.items.values()].filter((i) => i.chain === 'storm');
    expect(clutch).toHaveLength(3);
    expect(clutch.every((i) => i.tier === 1)).toBe(true);
    expect(ctx.state.coins).toBe(2000 - 1600);
    expect(ctx.state.ownedCosmetics).toContain('storm');
    // A breed is not a costume: nothing is worn, so nothing may claim a slot —
    // a grant that also equipped would re-dress the red dragon it is not.
    expect(ctx.state.dragonSkins).toEqual({});
    expect(worn).toEqual([]);
  });

  it('a chain grant is refused outside the world that sells it', () => {
    const ctx = createTestContext();
    fund(ctx, 4000);
    const failed = capture(ctx.bus, 'store:purchase_failed');

    // `frost` is Borealis stock, and the Keeper is standing in Emberkeep.
    ctx.bus.emit('ui:store_buy_requested', { itemId: 'frost' });

    expect(failed.at(-1)).toMatchObject({ itemId: 'frost', reason: 'locked' });
    expect(ctx.state.coins).toBe(4000); // the gate is checked before the till
    expect([...ctx.state.items.values()].filter((i) => i.chain === 'frost')).toEqual([]);
  });

  it('each dragon has its own slot — two skins are worn at once', () => {
    const ctx = createTestContext();
    fund(ctx, 2000);

    ctx.bus.emit('ui:store_buy_requested', { itemId: 'ashglass' });
    ctx.bus.emit('ui:store_buy_requested', { itemId: 'porcelain' });

    // Wearing one dragon's skin says nothing about the other's: they are
    // different animals, so the wardrobe is keyed by chain, not a single slot.
    expect(ctx.state.dragonSkins).toEqual({
      ember_dragon: 'ashglass',
      emerald: 'porcelain'
    });
  });

  it('survives a save round-trip: what you own and what you wear both persist', () => {
    const ctx = createTestContext();
    fund(ctx, 2000); // a Manor skin, a decoration and a 900g dragon skin
    ctx.bus.emit('ui:store_buy_requested', { itemId: SKIN });
    ctx.bus.emit('ui:store_buy_requested', { itemId: DECOR });

    ctx.bus.emit('ui:store_buy_requested', { itemId: 'ashglass' });

    const save = ctx.state.toSave(0, 99);
    const fresh = createTestContext();
    fresh.state.hydrate(save);

    expect(fresh.state.ownedCosmetics).toEqual([SKIN, DECOR, 'ashglass']);
    expect(fresh.state.manorSkin).toBe(SKIN);
    expect(fresh.state.dragonSkins).toEqual({ ember_dragon: 'ashglass' });
  });
});

/**
 * The Emporium's shelves are authored JSON, and the two things that can go
 * wrong there are silent: a card that points at a texture nobody registered
 * renders as an empty rectangle, and a dragon skin whose board art is missing
 * charges the player and then changes nothing on the board.
 */
describe("the Keeper's Store shelves (src/data/store.json)", () => {
  const store = storeDoc as StoreData;
  const keys = new Set(assetsDoc.images.map((image) => image.key));
  const dragons = store.sections.find((section) => section.id === 'dragons')!;

  it('every priced card points at art that is actually registered', () => {
    for (const section of store.sections) {
      for (const item of section.items) expect(keys, `${item.id} card art`).toContain(item.art);
    }
  });

  it('every dragon card is a wardrobe skin or a chain grant, with art to back it', () => {
    expect(dragons.items.length).toBeGreaterThan(0);
    for (const item of dragons.items) {
      // A CHAIN-GRANT card (frost/storm): the breed is its own merge line, so
      // the purchase must have board art for every tier the clutch can reach.
      if (item.chain) {
        expect(item.dragon, `${item.id} is both grant and skin`).toBeUndefined();
        const tiers = [1, 2, 3].filter((tier) => keys.has(`item_${item.chain}_${tier}`));
        expect(tiers, `${item.id} grants a chain with missing art`).toEqual([1, 2, 3]);
        continue;
      }
      expect(item.dragon, `${item.id} has no chain`).toBeTruthy();
      // Tiers 3 and 4 are the whelp and the adult — the only dragon tiers with
      // rig art to wear. A skin covering neither would be an empty purchase.
      const worn = [3, 4].filter((tier) => keys.has(`skin_${item.id}_${tier}`));
      expect(worn, `${item.id} re-skins nothing`).toEqual([3, 4]);
    }
  });

  it('rarity is priced consistently and only one card claims the showcase', () => {
    const heroes = dragons.items.filter((item) => item.hero);
    expect(heroes).toHaveLength(1);
    // The showcase card is the shelf's most expensive — a hero anyone can
    // afford before the cards beside it is not a showcase.
    const dearest = Math.max(...dragons.items.map((item) => item.gold));
    expect(heroes[0]!.gold).toBe(dearest);

    for (const item of dragons.items) expect(RARITY[item.rarity!]).toBeDefined();
    const gold = (rarity: string): number[] =>
      dragons.items.filter((item) => item.rarity === rarity).map((item) => item.gold);
    expect(Math.min(...gold('legendary'))).toBeGreaterThan(Math.max(...gold('epic')));
  });
});

/**
 * Half the catalogue is LOCAL goods: ice cut in Borealis, rune stone under
 * snow, a dragon nested on the floes. The stall carries them only where they
 * are made — everywhere else the card is padlocked and says where to find it —
 * and the gate is enforced in the SYSTEM, not only on the card.
 */
describe('goods that are only sold in the world that makes them', () => {
  const NORTHERN = 'manor_igloo'; // 750 gold, world: borealis
  const STORE = storeDoc as StoreData;

  it('refuses the purchase and takes nothing while the Keeper is elsewhere', () => {
    const ctx = createTestContext();
    fund(ctx, 2000);
    const failed = capture(ctx.bus, 'store:purchase_failed');

    ctx.bus.emit('ui:store_buy_requested', { itemId: NORTHERN });

    expect(failed.at(-1)).toMatchObject({ itemId: NORTHERN, reason: 'locked' });
    expect(ctx.state.ownedCosmetics).not.toContain(NORTHERN);
    expect(ctx.state.coins).toBe(2000);
  });

  it('sells it once the Keeper is standing in Borealis', () => {
    const ctx = createTestContext();
    fund(ctx, 2000);
    ctx.state.switchWorld('borealis');
    const before = ctx.state.coins;

    ctx.bus.emit('ui:store_buy_requested', { itemId: NORTHERN });

    expect(ctx.state.ownedCosmetics).toContain(NORTHERN);
    expect(ctx.state.coins).toBe(before - 750);
  });

  it('padlocks EMBERKEEP goods once the Keeper is in Borealis — both ways', () => {
    const ctx = createTestContext();
    fund(ctx, 2000);
    ctx.state.switchWorld('borealis');
    const failed = capture(ctx.bus, 'store:purchase_failed');

    ctx.bus.emit('ui:store_buy_requested', { itemId: 'manor_mushroom' }); // world: emberkeep

    expect(failed.at(-1)).toMatchObject({ itemId: 'manor_mushroom', reason: 'locked' });
    expect(ctx.state.ownedCosmetics).not.toContain('manor_mushroom');
  });

  it('every card names the world it is sold in', () => {
    // Untagged would mean "sold on every shelf", and a card that quietly
    // followed the Keeper everywhere is exactly what this feature removes.
    for (const section of STORE.sections) {
      for (const item of section.items) {
        expect(item.world, `${item.id} names no world`).toBeTruthy();
      }
    }
  });

  it('only tags worlds this build actually has', () => {
    const ctx = createTestContext();
    const tagged = STORE.sections.flatMap((s) => s.items).filter((i) => i.world);
    expect(tagged.length).toBeGreaterThan(0);
    for (const item of tagged) {
      expect(ctx.state.worlds.has(item.world!), `${item.id} → ${item.world}`).toBe(true);
    }
  });
});
