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

  emit<K extends EventKey>(event: K, payload: EventMap[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      (handler as Handler<K>)(payload);
    }
  }

  removeAll(): void {
    this.handlers.clear();
  }
}
