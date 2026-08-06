import type { EventKey, EventMap } from './types';

type Handler<K extends EventKey> = (payload: EventMap[K]) => void;

/**
 * Typed, synchronous event bus. The only allowed channel between modules:
 * scenes/UI/audio emit intents and subscribe to notifications; systems
 * subscribe to intents and emit notifications. Emission is synchronous, so
 * a system may emit a command (e.g. 'energy:spend') and rely on the owning
 * system having processed it once emit() returns.
 */
export class EventBus {
  private handlers = new Map<EventKey, Set<Handler<EventKey>>>();

  on<K extends EventKey>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<EventKey>);
    return () => this.off(event, handler);
  }

  once<K extends EventKey>(event: K, handler: Handler<K>): () => void {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off<K extends EventKey>(event: K, handler: Handler<K>): void {
    this.handlers.get(event)?.delete(handler as Handler<EventKey>);
  }

  /**
   * Every subscriber is called, even if one of them throws.
   *
   * Emission is the ONLY channel between modules, and the handler order is
   * arbitrary — whoever subscribed first. Letting an exception escape meant one
   * broken listener silenced every listener behind it, and unwound the emitter
   * too: a naming panel left over from a previous scene threw on its dead
   * `scene`, so the live panel was never called and the tutorial beat gated on
   * that panel could not be answered at all. A view's fault must not become
   * gameplay's fault.
   *
   * The failure is not swallowed — it goes to the console with its event name —
   * but it stops at the handler that caused it.
   */
  emit<K extends EventKey>(event: K, payload: EventMap[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        (handler as Handler<K>)(payload);
      } catch (err) {
        console.error(`[bus] handler for '${event}' threw`, err);
      }
    }
  }

  removeAll(): void {
    this.handlers.clear();
  }
}
