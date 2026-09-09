import { describe, expect, it } from 'vitest';
import { ENERGY_REGEN_MS, ENERGY_START, SAVE_KEY } from '../../src/core/Constants';
import { capture, createTestContext, drag, MemoryStorage } from './helpers';

describe('SaveSystem', () => {
  it('moves a piece standing inside re-locked fog to open ground or the satchel', () => {
    // The re-cut case: a re-exported map renames a band, so a cell the save's
    // player had opened now belongs to a region this save never unlocked. The
    // piece must not stand there working under the clouds.
    const storage = new MemoryStorage();
    const ctx1 = createTestContext(storage);
    ctx1.beginRun();
    // Force a piece onto fogged ground the way a stale save would put it there.
    const item = ctx1.state.addItem({ chain: 'sparkweed', tier: 1, col: 0, row: 0, kind: 'item' });
    expect(ctx1.state.regionStatus.get('north_fog')).toBe('unlockable');
    ctx1.systems.save.save();

    const ctx2 = createTestContext(storage);
    expect(ctx2.systems.save.load()).toBe(true);
    const back = ctx2.state.items.get(item.id);
    if (back) {
      // Re-seated: wherever it stands now must be OPEN ground.
      const region = ctx2.state.regionIdAt(back.col, back.row);
      expect(!region || ctx2.state.regionStatus.get(region) === 'active').toBe(true);
    } else {
      // Or honestly banked — never silently dropped.
      expect(ctx2.state.bag.some((s) => s.chain === 'sparkweed')).toBe(true);
    }
  });

  it('round-trips full mid-game state through storage', () => {
    const storage = new MemoryStorage();
    const ctx1 = createTestContext(storage);
    ctx1.beginRun(); // fresh board from map.json

    // Play a little: merge the tutorial weeds, spend some energy.
    drag(ctx1, [3, 4], [1, 3]); // ON the fixture's pair — the drop is the merge
    ctx1.bus.emit('energy:spend', { amount: 4, reason: 'test' });
    ctx1.bus.emit('economy:add', { coins: 7, reason: 'test' });
    ctx1.state.tutorialIndex = 3;
    ctx1.systems.save.save();

    const ctx2 = createTestContext(storage);
    const loadedEvents = capture(ctx2.bus, 'state:loaded');
    expect(ctx2.systems.save.load()).toBe(true);

    expect(loadedEvents).toHaveLength(1);
    expect(ctx2.state.items.size).toBe(ctx1.state.items.size);
    expect(ctx2.state.itemAt(1, 3)?.chain).toBe('sparkweed');
    expect(ctx2.state.itemAt(1, 3)?.tier).toBe(2);
    expect(ctx2.state.coins).toBe(7);
    expect(ctx2.state.xp).toBe(ctx1.state.xp);
    expect(ctx2.state.tutorialIndex).toBe(3);
    expect(ctx2.state.regionStatus.get('north_fog')).toBe('unlockable');
    expect(ctx2.state.nextItemId).toBe(ctx1.state.nextItemId);
  });

  /**
   * TIME AWAY IS NOT TIME PLAYED.
   *
   * This test used to assert the opposite — three intervals away bought three
   * energy — and it is inverted on purpose rather than deleted, because it is
   * the one place the rule can be stated: the isle does not run for a player
   * who is not there. `load` rebases the clock onto the save's own timestamp,
   * so the gap is zero for EVERY consumer at once (energy here, the passive
   * harvest in GeneratorSystem, the welcome-back card in UIScene) without any
   * of them being touched.
   *
   * The advance is deliberately huge: any amount of absence must credit the
   * same nothing, or the rule is a tuning value pretending to be a rule.
   */
  it('credits nothing for time spent away — a reload resumes at the instant it was saved', () => {
    const storage = new MemoryStorage();
    const ctx1 = createTestContext(storage);
    ctx1.beginRun();
    ctx1.bus.emit('energy:spend', { amount: 5, reason: 'test' });
    ctx1.systems.save.save();
    // Read from the FILE, not from ctx1's clock: the wall moves between the
    // write and this line, and the instant that matters is the one on disk —
    // it is the only one `load` can see.
    const savedAt = (JSON.parse(storage.getItem(SAVE_KEY)!) as { savedAt: number }).savedAt;

    const ctx2 = createTestContext(storage);
    ctx2.clock.advance(ENERGY_REGEN_MS * 3 + 500); // three intervals of absence…
    const loadedEvents = capture(ctx2.bus, 'state:loaded');
    ctx2.systems.save.load();

    expect(loadedEvents[0]?.offlineMs).toBe(0);
    expect(loadedEvents[0]?.energyRecovered).toBe(0);
    expect(ctx2.state.energyCurrent).toBe(ENERGY_START - 5); // …bought nothing
    // The clock did not merely decline to pay: it READS the saved instant and
    // carries on from there, so every cooldown hydrated from that save is
    // exactly as overdue as it was when the player left. The only distance
    // between the two readings is this test's own runtime — never the three
    // intervals of absence, which is the whole point.
    expect(ctx2.clock.now()).toBeGreaterThanOrEqual(savedAt);
    expect(ctx2.clock.now()).toBeLessThan(savedAt + ENERGY_REGEN_MS);
  });

  it('autosaves on mutations (merge updates storage without an explicit save)', () => {
    const storage = new MemoryStorage();
    const ctx = createTestContext(storage);
    ctx.beginRun();
    const before = storage.getItem(SAVE_KEY);

    drag(ctx, [3, 4], [1, 3]); // ON the pair

    const after = storage.getItem(SAVE_KEY);
    expect(after).not.toBeNull();
    expect(after).not.toEqual(before);
    const parsed = JSON.parse(after!) as { items: { chain: string; tier: number }[] };
    expect(parsed.items.some((i) => i.chain === 'sparkweed' && i.tier === 2)).toBe(true);
  });

  /**
   * The board a player comes back to must be the board they left.
   *
   * Autosave is event-driven, so anything that mutates state without a listed
   * event is state that survives only until the tab closes. These are the three
   * that had no cover at all: a generator's yield (and with it the timer that
   * decides whether the offline catch-up owes anything), a dragon's name, and a
   * House's commission — the last two given once and never offered again.
   */
  describe('autosaves everything that changes the board', () => {
    const saved = (storage: MemoryStorage) =>
      JSON.parse(storage.getItem(SAVE_KEY)!) as {
        items: Array<{ chain: string; tier: number; dragonName?: string; passiveAt?: number; produces?: { chain: string } }>;
      };

    it('persists a passive yield and the timer it just reset', () => {
      const storage = new MemoryStorage();
      const ctx = createTestContext(storage);
      // No beginRun: a live tutorial step deliberately holds passive producers
      // (GeneratorSystem.tickPassive), and this is about what happens after it.
      const free = ctx.state.freeActiveTilesNear(2, 2)[0]!;
      const tree = ctx.state.addItem({ chain: 'bigtree', tier: 1, col: free.col, row: free.row, kind: 'item' });

      ctx.bus.emit('time:advanced', { ms: 0 }); // arms passiveAt
      ctx.clock.advance(5 * 60_000 + 1_000); // one full cycle of the Ancient Tree
      ctx.bus.emit('time:advanced', { ms: 1_000 });

      const after = saved(storage);
      expect(after.items.some((i) => i.chain === 'lumber')).toBe(true);
      // The reset timer went out with it — a stale one is what made the offline
      // catch-up pay again for gifts already collected.
      expect(after.items.find((i) => i.chain === 'bigtree')?.passiveAt).toBe(
        ctx.state.items.get(tree.id)?.passiveAt
      );
    });

    it('persists a dragon her name', () => {
      const storage = new MemoryStorage();
      const ctx = createTestContext(storage);
      ctx.beginRun();
      const free = ctx.state.freeActiveTilesNear(2, 2)[0]!;
      const dragon = ctx.state.addItem({
        chain: 'ember_dragon', tier: 3, col: free.col, row: free.row, kind: 'item'
      });

      ctx.bus.emit('ui:dragon_named', { itemId: dragon.id, name: 'Cinder' });

      expect(saved(storage).items.some((i) => i.dragonName === 'Cinder')).toBe(true);
    });

    it("persists a House's commission", () => {
      const storage = new MemoryStorage();
      const ctx = createTestContext(storage);
      ctx.beginRun();
      const free = ctx.state.freeActiveTilesNear(2, 2)[0]!;
      const house = ctx.state.addItem({ chain: 'lumber', tier: 3, col: free.col, row: free.row, kind: 'item' });
      ctx.bus.emit('bag:bank', { chain: 'quartz', tier: 1, count: 1 });

      ctx.bus.emit('ui:produce_choice_requested', { itemId: house.id, chain: 'quartz', tier: 1 });

      expect(saved(storage).items.find((i) => i.chain === 'lumber')?.produces?.chain).toBe('quartz');
    });
  });

  it('discards saves with a mismatched version', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 999, items: [] }));
    const ctx = createTestContext(storage);
    expect(ctx.systems.save.hasSave()).toBe(false);
    expect(ctx.systems.save.load()).toBe(false);
  });

  it('discards corrupt saves', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, '{not json');
    const ctx = createTestContext(storage);
    expect(ctx.systems.save.load()).toBe(false);
  });

  it('reset clears the save and rewinds state', () => {
    const storage = new MemoryStorage();
    const ctx = createTestContext(storage);
    ctx.beginRun();
    ctx.bus.emit('economy:add', { coins: 99, reason: 'test' });
    const resets = capture(ctx.bus, 'game:reset');

    ctx.bus.emit('game:reset_requested', {});

    expect(resets).toHaveLength(1);
    expect(storage.getItem(SAVE_KEY)).toBeNull();
    expect(ctx.state.coins).toBe(0);
    expect(ctx.state.items.size).toBe(0);
    expect(ctx.running).toBe(false);
  });
});

/**
 * The HUD paints every gauge from `economy:changed`. A fresh game gets one from
 * `BoardSystem.newGame`; a LOAD used to get none at all, so the pills kept the
 * zeros they were constructed with while the state under them held the player's
 * real gold, keys and XP — it read as a wiped save.
 */
describe('loading a save announces the wallet', () => {
  it('emits economy:changed with the loaded coins, keys and xp', () => {
    const storage = new MemoryStorage();
    const first = createTestContext(storage);
    first.systems.board.newGame();
    first.bus.emit('economy:add', { coins: 340, xp: 12, reason: 'test' });
    first.state.keys = 2;
    first.systems.save.save();

    const reloaded = createTestContext(storage);
    const seen = capture(reloaded.bus, 'economy:changed');
    reloaded.beginRun();

    expect(seen.at(-1)).toMatchObject({ coins: 340, keys: 2, xp: 12 });
  });
});

/**
 * THE BOOT-ORDER CONTRACT.
 *
 * `PreloadScene` decides which `skin_` plates and which clip sheets to FETCH by
 * reading the worn wardrobe slots off the state. But `hydrate` runs inside
 * `beginRun`, and `beginRun` is called by UIScene — two scenes after the
 * preload. So anything the preload needs has to be on the state the moment the
 * context exists, not merely by the time the board is playable.
 */
describe('the worn wardrobes are readable BEFORE the run begins', () => {
  /** A save written by a player who had bought and equipped all three. */
  function dressedSave(): MemoryStorage {
    const storage = new MemoryStorage();
    const ctx = createTestContext(storage);
    ctx.beginRun();
    ctx.state.manorSkin = 'ivy';
    ctx.state.dragonSkins = { ember_dragon: 'ashglass' };
    ctx.state.keeperSkins = { eleanor: 'eleanor_beach' };
    ctx.systems.save.save();
    return storage;
  }

  it('a fresh context already knows what the save was wearing', () => {
    const booted = createTestContext(dressedSave());
    // NOT beginRun() — this is the state PreloadScene sees. It used to see
    // three empty maps, so it fetched none of the art and the board came up
    // with the Manor and the dragons on their authored plates and a dressed
    // keeper playing her BASE clip set — frames painted in her robes.
    expect(booted.state.keeperSkins).toEqual({ eleanor: 'eleanor_beach' });
    expect(booted.state.dragonSkins).toEqual({ ember_dragon: 'ashglass' });
    expect(booted.state.manorSkin).toBe('ivy');
  });

  it('and still knows once the run has actually begun', () => {
    const booted = createTestContext(dressedSave());
    booted.beginRun();
    // hydrate overwrites the seed with the values it was read from, so the two
    // can never drift — this is the assertion that says so.
    expect(booted.state.keeperSkins).toEqual({ eleanor: 'eleanor_beach' });
    expect(booted.state.dragonSkins).toEqual({ ember_dragon: 'ashglass' });
    expect(booted.state.manorSkin).toBe('ivy');
  });

  it('an empty storage seeds nothing — a fresh game is undressed', () => {
    const fresh = createTestContext(new MemoryStorage());
    expect(fresh.state.keeperSkins).toEqual({});
    expect(fresh.state.dragonSkins).toEqual({});
    expect(fresh.state.manorSkin).toBeNull();
  });
});
