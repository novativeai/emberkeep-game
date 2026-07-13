import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { TaskConfig, TasksData } from '../core/types';

/**
 * Keeper's Tasks — the chapter checklist that carries the encore sandbox
 * (DEMO-PLAN §Act V). Owns the lifetime stat counters in `GameState.stats`
 * (hatches, merges, orders, goldEarned, elderTaps) and, once EVERY task hits
 * its target, pays the one-time reward bundle and fires `tasks:all_complete`
 * (persisted via `stats.tasksClaimed`). Phaser-free — runs in the node tests.
 */
export class TaskSystem {
  constructor(
    private state: GameState,
    private bus: EventBus,
    private data: TasksData
  ) {
    bus.on('item:hatched', () => this.bump('hatches', 1));
    bus.on('item:merged', () => this.bump('merges', 1));
    bus.on('order:completed', () => this.bump('orders', 1));
    bus.on('economy:add', ({ coins }) => {
      if ((coins ?? 0) > 0) this.bump('goldEarned', coins!);
    });
    bus.on('item:sold', ({ coins }) => this.bump('goldEarned', coins));
    bus.on('elder:tapped', () => this.bump('elderTaps', 1));
  }

  /** Progress toward one task, clamped to its target. */
  progressFor(task: TaskConfig): number {
    return Math.min(this.state.stat(task.kind), task.target);
  }

  /** A locked task's subject doesn't exist in the world yet (e.g. the Elder
   *  before her awakening) — the panel shows its hint instead of a dead bar. */
  isLocked(task: TaskConfig): boolean {
    const gate = task.lockedUntil;
    if (!gate) return false;
    if (gate.order && !this.state.completedOrderIds.includes(gate.order)) return true;
    if (gate.level && this.state.level < gate.level) return true;
    return false;
  }

  get tasks(): TaskConfig[] {
    return this.data.tasks;
  }

  get allComplete(): boolean {
    return this.data.tasks.every((t) => this.progressFor(t) >= t.target);
  }

  private bump(kind: string, amount: number): void {
    this.state.addStat(kind, amount);
    this.maybeClaim();
  }

  private maybeClaim(): void {
    if (this.state.stat('tasksClaimed') > 0 || !this.allComplete) return;
    this.state.addStat('tasksClaimed', 1);
    const { coins, energy } = this.data.reward;
    if (coins) this.bus.emit('economy:add', { coins, reason: 'tasks:complete' });
    if (energy) this.bus.emit('energy:add', { amount: energy, reason: 'tasks:complete' });
    this.bus.emit('tasks:all_complete', {});
  }
}
