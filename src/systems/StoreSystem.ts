import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { StoreData, StoreItem, StoreKind } from '../core/types';

/**
 * The cosmetics store — Manor skins and decorations, bought with the Gold the
 * player earns. It owns `state.ownedCosmetics` and `state.manorSkin`; the panel
 * only renders and emits intents.
 *
 * Two rules the whole thing rests on:
 *
 * 1. **Nothing here is progression.** A skin changes what the Manor looks like
 *    and nothing else — same payout, same cooldown — and a decoration never
 *    merges, never produces and never blocks. MECHANICS §7: Gold buys comfort.
 * 2. **Ask the board BEFORE charging.** A decoration needs a tile, and a full
 *    board has none. The purchase is refused rather than refunded, because a
 *    refund the player has to notice is a bug they will report.
 */
export class StoreSystem {
  private byId = new Map<string, { item: StoreItem; kind: StoreKind }>();

  constructor(
    private state: GameState,
    private bus: EventBus,
    data: StoreData
  ) {
    for (const section of data.sections) {
      for (const item of section.items) this.byId.set(item.id, { item, kind: section.kind });
    }
    bus.on('ui:store_buy_requested', ({ itemId }) => this.buy(itemId));
    bus.on('ui:store_equip_requested', ({ itemId }) => this.equip(itemId));
    // The board answers a placement request; only then does the gold move.
    bus.on('board:decor_placed', ({ decor, at }) => this.settleDecor(decor, at !== null));
  }

  owns(itemId: string): boolean {
    return this.state.ownedCosmetics.includes(itemId);
  }

  /** Gold pending on a decor placement the board has not answered yet. */
  private pending: { itemId: string; gold: number } | null = null;

  private buy(itemId: string): void {
    const entry = this.byId.get(itemId);
    if (!entry) return;
    if (this.owns(itemId)) {
      this.bus.emit('store:purchase_failed', { itemId, reason: 'owned' });
      return;
    }
    if (this.state.coins < entry.item.gold) {
      this.bus.emit('store:purchase_failed', { itemId, reason: 'gold' });
      return;
    }
    if (entry.kind === 'decor') {
      // Charge on the board's answer, not before it (rule 2).
      this.pending = { itemId, gold: entry.item.gold };
      this.bus.emit('board:place_decor', { decor: itemId });
      return;
    }
    this.commit(itemId, entry.kind, entry.item.gold);
    // A skin you just bought is a skin you want to see.
    if (entry.kind === 'skin' || entry.kind === 'dragon_skin') this.equip(itemId);
  }

  private settleDecor(decor: string, placed: boolean): void {
    const pending = this.pending;
    this.pending = null;
    if (!pending || pending.itemId !== decor) return;
    if (!placed) {
      this.bus.emit('store:purchase_failed', { itemId: decor, reason: 'no_room' });
      return;
    }
    this.commit(decor, 'decor', pending.gold);
  }

  private commit(itemId: string, kind: StoreKind, gold: number): void {
    this.state.ownedCosmetics.push(itemId);
    this.bus.emit('economy:add', { coins: -gold, reason: `store:${itemId}` });
    this.bus.emit('store:purchased', { itemId, kind, gold });
  }

  /**
   * Wear an owned skin, or pass null to go back to the authored art.
   *
   * Two wardrobes, and the item says which one it belongs to: a Manor skin
   * fills the single `manorSkin` slot, a dragon skin fills the slot for the
   * chain it re-skins. `null` only clears the Manor — a dragon is undressed by
   * equipping a different skin, and there is no "bare" card to tap.
   */
  private equip(itemId: string | null): void {
    if (itemId !== null && !this.owns(itemId)) return;
    const entry = itemId === null ? null : this.byId.get(itemId);
    if (entry?.kind === 'dragon_skin') {
      const dragon = entry.item.dragon;
      if (!dragon || this.state.dragonSkins[dragon] === itemId) return;
      this.state.dragonSkins[dragon] = itemId!;
      this.bus.emit('store:dragon_skin_changed', { dragon, itemId });
      return;
    }
    if (this.state.manorSkin === itemId) return;
    this.state.manorSkin = itemId;
    this.bus.emit('store:skin_changed', { itemId });
  }
}
