import type { EventBus } from '../core/EventBus';
import { gridToWorld } from '../core/iso';

/** Walk speed in game-space pixels per ms (~150 px/s). */
const LAURAH_WALK_SPEED = 0.15;
/** Run speed in game-space pixels per ms (~350 px/s). */
const LAURAH_RUN_SPEED = 0.35;
/** Snap-to-target radius in game-space px. */
const ARRIVAL_DIST = 3;
/** Manhattan distance threshold above which Laurah runs instead of walks. */
const RUN_DIST_THRESHOLD = 3;

export type LaurahState = 'idle' | 'walking' | 'running';

/**
 * Moves Laurah (the player MC) across the board in response to tile taps.
 * Drives smooth world-space lerp each frame and routes walk/run/idle to
 * Character3D's animation mixer.
 *
 * Subscribes to: 'laurah:move_to'
 * Emits:         'laurah:arrived'
 */
export class LaurahSystem {
  /** Current logical grid cell (snaps on arrival). */
  col: number;
  row: number;

  /** Smoothly lerped world-space position (use for sprite placement). */
  worldX: number;
  worldY: number;

  state: LaurahState = 'idle';

  private targetCol: number;
  private targetRow: number;
  private targetWorldX: number;
  private targetWorldY: number;
  private speed = LAURAH_WALK_SPEED;
  private unsub: (() => void)[] = [];

  constructor(
    private bus: EventBus,
    startCol = 4,
    startRow = 7
  ) {
    this.col = startCol;
    this.row = startRow;
    this.targetCol = startCol;
    this.targetRow = startRow;

    const start = gridToWorld(startCol, startRow);
    this.worldX = start.x;
    this.worldY = start.y;
    this.targetWorldX = start.x;
    this.targetWorldY = start.y;

    this.unsub.push(
      this.bus.on('laurah:move_to', ({ col, row }) => {
        if (col === this.targetCol && row === this.targetRow) return;

        this.targetCol = col;
        this.targetRow = row;
        const target = gridToWorld(col, row);
        this.targetWorldX = target.x;
        this.targetWorldY = target.y;

        const manhattanDist = Math.abs(col - this.col) + Math.abs(row - this.row);
        this.state = manhattanDist >= RUN_DIST_THRESHOLD ? 'running' : 'walking';
        this.speed  = this.state === 'running' ? LAURAH_RUN_SPEED : LAURAH_WALK_SPEED;
      })
    );
  }

  update(dtMs: number): void {
    if (this.state === 'idle') return;

    const dx = this.targetWorldX - this.worldX;
    const dy = this.targetWorldY - this.worldY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= ARRIVAL_DIST) {
      this.worldX = this.targetWorldX;
      this.worldY = this.targetWorldY;
      this.col = this.targetCol;
      this.row = this.targetRow;
      this.state = 'idle';
      this.bus.emit('laurah:arrived', { col: this.col, row: this.row });
      return;
    }

    const step = Math.min(this.speed * dtMs, dist);
    this.worldX += (dx / dist) * step;
    this.worldY += (dy / dist) * step;
  }

  dispose(): void {
    this.unsub.forEach((fn) => fn());
    this.unsub = [];
  }
}
