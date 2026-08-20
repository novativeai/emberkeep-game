import type { EventBus } from './EventBus';
import type { IapPackInfo } from './types';

/**
 * Host-page bridge for real-money purchases.
 *
 * The game never talks to a payment gateway. When it runs embedded in the
 * EmberGames hub (same-origin iframe), the hub owns the catalog, the checkout
 * and the receipt; this adapter is the game's end of that conversation:
 *
 *   game → hub   catalog_request · checkout(packId) · ack(purchaseId) · abort
 *   hub → game   catalog · checkout_ready(paymentUrl) · checkout_failed · result
 *
 * `beginCheckout` asks the hub to start a payment; the HUB shows it, in a panel
 * over the game, so no window is opened here and no user-gesture activation is
 * needed or can be lost. Standalone builds (dev server, e2e preview) have no
 * parent — the catalog stays empty, `isAvailable()` is false and the Emporium
 * keeps its mock showcase.
 *
 * Grants are applied by IapSystem off the `iap:grant` command; the ack back to
 * the hub is what lets it mark the purchase delivered, so the ack is sent only
 * AFTER the (synchronous) bus emit has landed the grant in GameState.
 */

type CheckoutStatus = 'completed' | 'cancelled' | 'declined' | 'pending';

interface HubMessage {
  type?: string;
  requestId?: string;
  purchaseId?: string;
  packId?: string;
  name?: string;
  status?: CheckoutStatus;
  reason?: string;
  coins?: number;
  keys?: number;
  energy?: number;
  packs?: IapPackInfo[];
}

interface PendingCheckout {
  requestId: string;
  packId: string;
  /** Cleared by `settle`; kept so a late message for an old request is ignored. */
  watch: number | null;
}

export class IapBridge {
  private bus: EventBus | null = null;
  private catalog: IapPackInfo[] = [];
  private pending: PendingCheckout | null = null;
  private seq = 0;

  /** True when the game is an iframe of a same-origin host page. */
  private get embedded(): boolean {
    return typeof window !== 'undefined' && window.parent !== window;
  }

  /** Call once from main.ts. Safe to call in standalone builds (no-op). */
  attach(bus: EventBus): void {
    this.bus = bus;
    if (!this.embedded) return;
    window.addEventListener('message', this.onMessage);
    this.post({ type: 'embergames:iap:catalog_request' });
  }

  isAvailable(): boolean {
    return this.catalog.length > 0;
  }

  /** The coin packs the hub sells (what the Emporium's GOLD shelf shows). */
  coinPacks(): IapPackInfo[] {
    return this.catalog.filter((pack) => pack.coins > 0);
  }

  /**
   * The Warmth packs it sells — the real-money row on the WARMTH shelf, under
   * the authored gold-sink offers.
   *
   * Filtered on what a pack GRANTS, not on what it is called, so a bundle that
   * carries both coins and Warmth appears on both shelves. That is the honest
   * reading of a bundle: a player looking at either shelf should see every way
   * to get the thing that shelf is about.
   */
  warmthPacks(): IapPackInfo[] {
    return this.catalog.filter((pack) => pack.energy > 0);
  }

  pack(packId: string): IapPackInfo | undefined {
    return this.catalog.find((p) => p.id === packId);
  }

  /**
   * Ask the hub to start the secure checkout for a pack.
   *
   * THE GAME NO LONGER OPENS A WINDOW. It used to `window.open` synchronously
   * inside the tap, because a popup needs the tap's transient activation — and
   * that is exactly what made the flow fragile: a blocked popup fell back to
   * navigating the whole page away from the board, and an allowed one put the
   * card form in a window the player then had to go and find.
   *
   * The hub owns the page the player is looking at, so the hub shows the
   * payment over the game (`GamePlayer`), framing the gateway's own page when
   * the gateway permits it and offering a single hand-off tap when it does not.
   * Nothing here needs an activation any more, so nothing here can lose one.
   *
   * Still returns false when unavailable or already busy — the caller uses that
   * to keep its own "opening…" state honest.
   */
  beginCheckout(packId: string): boolean {
    if (!this.bus || !this.embedded || this.pending || !this.pack(packId)) return false;
    const requestId = `ck_${Date.now().toString(36)}_${this.seq++}`;
    this.pending = { requestId, packId, watch: null };
    // `popup: true` tells the hub the caller is NOT asking for a top-level
    // redirect. The field is kept for the older hub builds that still branch on
    // it; a hub with the in-page panel ignores it entirely.
    this.post({ type: 'embergames:iap:checkout', packId, requestId, popup: true });
    this.bus.emit('iap:checkout_opened', { packId });
    return true;
  }

  /* ------------------------------------------------------------------ */

  private onMessage = (event: MessageEvent): void => {
    if (event.origin !== window.location.origin) return;
    const data = event.data as HubMessage | null;
    if (!data || typeof data.type !== 'string' || !this.bus) return;

    switch (data.type) {
      case 'embergames:iap:catalog': {
        this.catalog = Array.isArray(data.packs) ? data.packs : [];
        this.bus.emit('iap:catalog_changed', { packs: this.catalog });
        return;
      }
      case 'embergames:iap:checkout_ready': {
        // Acknowledged only. The hub mounts the payment page over the game
        // itself now; the game has no window to steer.
        return;
      }
      case 'embergames:iap:checkout_failed': {
        const pending = this.pending;
        if (!pending || data.requestId !== pending.requestId) return;
        const packId = pending.packId;
        this.settle();
        // Covers both "the gateway would not start" and "the player pressed
        // Cancel on the hub's panel" — from the game's side they are the same
        // fact: this checkout is over and the Emporium may offer again.
        this.bus.emit('iap:failed', { packId, reason: 'unavailable' });
        return;
      }
      case 'embergames:iap:result': {
        if (this.pending && data.requestId === this.pending.requestId) this.settle();
        if (
          data.status === 'completed' &&
          typeof data.purchaseId === 'string' &&
          typeof data.packId === 'string'
        ) {
          // Synchronous: IapSystem has applied (or absorbed the replay of)
          // the grant by the time emit returns — THEN tell the hub.
          this.bus.emit('iap:grant', {
            purchaseId: data.purchaseId,
            packId: data.packId,
            name: data.name ?? 'Pack',
            coins: data.coins ?? 0,
            keys: data.keys ?? 0,
            energy: data.energy ?? 0
          });
          this.post({ type: 'embergames:iap:ack', purchaseId: data.purchaseId });
        } else if (typeof data.packId === 'string' && data.status !== 'completed') {
          this.bus.emit('iap:failed', {
            packId: data.packId,
            reason: data.status === 'declined' ? 'declined' : data.status === 'pending' ? 'pending' : 'cancelled'
          });
        }
        return;
      }
    }
  };

  /**
   * There is no window to watch any more.
   *
   * This used to poll the popup and treat a closed one as a cancel. With the
   * payment shown IN the page, `popup` is always null — and the old test read
   * "no window" as "window closed", so the watchdog would have aborted every
   * purchase a few seconds in, while the player was still typing their card.
   * Cancellation now comes from the hub, which owns the panel and its Cancel
   * key, and arrives as `checkout_failed`. Deliberately left as a record of
   * why the poll is gone rather than a silent deletion.
   */

  private settle(): void {
    if (this.pending?.watch !== null && this.pending?.watch !== undefined) {
      window.clearInterval(this.pending.watch);
    }
    this.pending = null;
  }

  private post(message: Record<string, unknown>): void {
    window.parent.postMessage(message, window.location.origin);
  }
}

/** The one bridge — main.ts attaches it; ShopPanel/UIScene read it. */
export const iapBridge = new IapBridge();
