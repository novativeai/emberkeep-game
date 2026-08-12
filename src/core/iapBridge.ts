import { IAP } from './Constants';
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
 * `beginCheckout` MUST be called inside a user-gesture handler: it opens the
 * secure checkout window synchronously (an async open would be popup-blocked)
 * and only then asks the hub for the payment URL to steer it to. Standalone
 * builds (dev server, e2e preview) have no parent — the catalog stays empty,
 * `isAvailable()` is false and the Emporium keeps its mock showcase.
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
  popup: Window | null;
  watch: number | null;
  /** Wall-clock deadline once the popup closed with no verdict yet. */
  graceUntil: number | null;
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

  pack(packId: string): IapPackInfo | undefined {
    return this.catalog.find((p) => p.id === packId);
  }

  /**
   * Open the secure checkout for a pack. Must run inside a user-gesture
   * handler (the Buy tap). Returns false when unavailable or already busy.
   */
  beginCheckout(packId: string): boolean {
    if (!this.bus || !this.embedded || this.pending || !this.pack(packId)) return false;
    const requestId = `ck_${Date.now().toString(36)}_${this.seq++}`;
    // Synchronous open, while the tap's transient activation is still live.
    const popup = window.open(
      '',
      'emberkeep_checkout',
      `popup=yes,width=${IAP.popupWidth},height=${IAP.popupHeight}`
    );
    if (popup) {
      popup.document.write(
        '<title>Secure checkout</title>' +
          '<body style="margin:0;display:grid;place-items:center;height:100vh;' +
          'background:#241B22;color:#FFF6E8;font:600 16px system-ui">' +
          'Opening secure checkout…</body>'
      );
    }
    this.pending = { requestId, packId, popup, watch: null, graceUntil: null };
    // Popup blocked → the hub falls back to navigating the top page (the game
    // flushes its save on pagehide, the hub delivers on return).
    this.post({ type: 'embergames:iap:checkout', packId, requestId, popup: popup !== null });
    this.startWatch();
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
        const pending = this.pending;
        const url = (data as { paymentUrl?: string }).paymentUrl;
        if (pending && data.requestId === pending.requestId && url && pending.popup) {
          pending.popup.location.href = url;
        }
        return;
      }
      case 'embergames:iap:checkout_failed': {
        const pending = this.pending;
        if (!pending || data.requestId !== pending.requestId) return;
        const packId = pending.packId;
        this.settle();
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

  /** Watch the checkout window; a closed window with no verdict is a cancel
   *  after a grace period (the webhook can land moments after the close). */
  private startWatch(): void {
    if (!this.pending) return;
    const pending = this.pending;
    pending.watch = window.setInterval(() => {
      if (this.pending !== pending) return;
      const closed = pending.popup === null || pending.popup.closed;
      if (!closed) return;
      if (pending.graceUntil === null) {
        pending.graceUntil = Date.now() + IAP.popupGraceMs;
        return;
      }
      if (Date.now() < pending.graceUntil) return;
      const packId = pending.packId;
      this.post({ type: 'embergames:iap:abort', requestId: pending.requestId });
      this.settle();
      this.bus?.emit('iap:failed', { packId, reason: 'cancelled' });
    }, IAP.popupWatchMs);
  }

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
