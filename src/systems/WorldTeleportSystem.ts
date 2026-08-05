import { WORLD_TELEPORTS, type WorldTeleportConfig } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import { PRIMARY_WORLD } from '../core/GameState';

/**
 * Fires each world-teleport ONCE, when its trigger (see `WORLD_TELEPORTS` in
 * Constants) first happens, then emits `world:teleport` so BoardScene runs the
 * teleport cinematic and the game switches worlds. One config per world:
 *   - roothold — `trigger:'tutorial_done'` (the whole tutorial checklist is finished).
 *   - borealis — `trigger:'golden_awaken'` (the Golden Egg bursts in the finale).
 * Also supports `'hatch'` (the dragon is invoked) and `'merge'` (a chain/tier
 * assembled). Phaser-free — owns only the per-config once-guard, so it runs in the
 * node tests. (Session-scoped: guards are not persisted, so a reload can re-arm.)
 */
export class WorldTeleportSystem {
  private fired = new Set<string>(); // toWorld ids already teleported this session

  constructor(private bus: EventBus) {
    for (const cfg of WORLD_TELEPORTS) {
      if (cfg.enabled) this.arm(cfg);
    }
  }

  private arm(cfg: WorldTeleportConfig): void {
    if (cfg.trigger === 'tutorial_done') {
      // No board position in the event — BoardScene locates the dragon itself and
      // only falls back to `at`, so a placeholder cell is fine here.
      // The ISLE's tutorial is the trigger: a sub-world that teaches its own arrival
      // lesson (borealis) also finishes a script, and that must not read as "the
      // Keeper is ready to leave home".
      this.bus.on('tutorial:done', ({ world }) => {
        if (world && world !== PRIMARY_WORLD) return;
        this.fire(cfg, { col: 0, row: 0 });
      });
    } else if (cfg.trigger === 'golden_awaken') {
      this.bus.on('golden:awakened', () => this.fire(cfg, { col: 0, row: 0 }));
    } else if (cfg.trigger === 'hatch') {
      this.bus.on('item:hatched', ({ item }) => {
        if (item.chain !== cfg.dragonChain) return;
        this.fire(cfg, { col: item.col, row: item.row });
      });
    } else {
      this.bus.on('item:merged', ({ chain, resultTier, at }) => {
        if (chain !== cfg.triggerChain || resultTier !== cfg.triggerTier) return;
        this.fire(cfg, at);
      });
    }
  }

  private fire(cfg: WorldTeleportConfig, at: { col: number; row: number }): void {
    if (this.fired.has(cfg.toWorld)) return;
    this.fired.add(cfg.toWorld);
    this.bus.emit('world:teleport', {
      toWorld: cfg.toWorld,
      dragonChain: cfg.dragonChain,
      at
    });
  }
}
