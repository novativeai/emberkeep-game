import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import { PRIMARY_WORLD, type GameState } from '../core/GameState';
import type {
  ResolvedArrow,
  ResolvedHand,
  TileRef,
  TilePos,
  TutorialAllow,
  TutorialData,
  TutorialStepConfig,
  TutorialStepEvent,
  WorldTutorials
} from '../core/types';

const ALLOW_NOTHING: Required<TutorialAllow> = {
  drag: [],
  tapGenerators: false,
  ledger: false,
  deliver: false,
  fog: false,
  sell: false,
  dragonWork: false,
  marketplace: false,
  cookbook: false
};

const ALLOW_EVERYTHING: Required<TutorialAllow> = {
  drag: ['*'],
  tapGenerators: true,
  ledger: true,
  deliver: true,
  fog: true,
  sell: true,
  dragonWork: true,
  marketplace: true,
  cookbook: true
};

/**
 * Drives the scripted Level-1 tutorial from data (tutorial.json). Each step
 * gates on a tap, a bus event, or a board count; the emitted
 * 'tutorial:step' payload carries everything the scenes need (bubble text,
 * speaker, highlights, hand/arrow targets and the input allow-list), so the
 * UI only ever subscribes.
 *
 * A WORLD can own a script of its own (`worldScripts`, borealis' arrival lesson).
 * The director follows the player: it runs the live world's script against that
 * world's saved progress, and a world with no script leaves it silent. Boards are
 * per-world, so a count gate asked in borealis counts borealis' pieces — the
 * lesson can only be answered where it was set.
 */
export class TutorialDirector {
  private lastHatched: TilePos | null = null;
  /** Which script is live. Follows the board, not the save. */
  private world = PRIMARY_WORLD;

  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
    private data: TutorialData,
    private worldScripts: WorldTutorials = {}
  ) {
    bus.on('item:hatched', ({ item }) => {
      this.lastHatched = { col: item.col, row: item.row };
      this.onGateEvent('item:hatched', item.chain);
    });
    bus.on('item:merged', ({ chain }) => {
      this.onGateEvent('item:merged', chain);
      this.checkCountGate();
    });
    bus.on('item:harvested', ({ output }) => this.onGateEvent('item:harvested', output.chain));
    bus.on('chest:open', () => this.onGateEvent('chest:open'));
    bus.on('dragon:working', () => this.onGateEvent('dragon:working'));
    bus.on('marketplace:purchased', () => this.onGateEvent('marketplace:purchased'));
    bus.on('order:completed', () => this.onGateEvent('order:completed'));
    bus.on('region:unlocked', () => this.onGateEvent('region:unlocked'));
    bus.on('ui:ledger_toggled', ({ open }) => {
      if (open) this.onGateEvent('ui:ledger_opened');
    });
    bus.on('ui:cookbook_opened', () => this.onGateEvent('ui:cookbook_opened'));
    bus.on('ui:cookbook_closed', () => this.onGateEvent('ui:cookbook_closed'));
    bus.on('item:spawned', () => this.checkCountGate());
    bus.on('item:removed', () => this.checkCountGate());
    bus.on('tutorial:advance_requested', ({ stepId }) => {
      const step = this.currentStep;
      if (step && step.id === stepId && step.gate.type === 'tap') {
        this.advance();
      }
    });
    // A REAL world switch happened (the dev's Level-3 world exists) → the isle's
    // tutorial stands down: mark it done so the remaining steps don't run for now.
    // They stay authored in tutorial.json — just not executed. Never fires in
    // e2e/prod (no world to switch to → no world:switched), so the full tutorial
    // still plays there. If the world we land in owns a script (borealis), that
    // script then begins in its place — the player is taught the world they are in.
    bus.on('world:switched', ({ toWorld }) => {
      const standingDown = !this.state.tutorialDone;
      this.state.tutorialDone = true;
      // enterWorld emits whatever the world we land in has to say — its own first
      // step, or the "done" allow-everything payload for a world that teaches
      // nothing. Only a switch that changes nothing (same world twice) needs the
      // stand-down emitted here.
      if (this.world === toWorld && standingDown) this.emitDone();
      this.enterWorld(toWorld);
    });
    // Back to the isle: its script is long done, so this only restores the "done"
    // allow-list the board expects (and never re-opens a finished lesson).
    bus.on('world:return', () => this.enterWorld(PRIMARY_WORLD));
    // A save carries the world you were standing in. Follow it BEFORE Context calls
    // begin(), or a session closed halfway through borealis' lesson reopens on the
    // isle's finished script and the north is never taught again.
    bus.on('state:loaded', () => {
      this.world = this.state.activeWorld;
      this.lastHatched = null;
    });
  }

  /** The script a world owns, if any (the isle's is `data`; borealis' comes from
   *  `worldScripts`). Undefined = that world teaches nothing. */
  private scriptFor(worldId: string): TutorialData | undefined {
    return worldId === PRIMARY_WORLD ? this.data : this.worldScripts[worldId];
  }

  /** The live world's script, or an empty one so every gate below is a no-op in a
   *  world with nothing to teach. */
  private get script(): TutorialData {
    return this.scriptFor(this.world) ?? { steps: [] };
  }

  private get index(): number {
    return this.state.tutorialIndexFor(this.world);
  }

  private get done(): boolean {
    // A world with no script has nothing left to teach, ever.
    return !this.scriptFor(this.world) || this.state.tutorialDoneFor(this.world);
  }

  /**
   * Follow the player into a world and pick that world's lesson back up.
   *
   * Systems hear `world:switched` before BoardScene does, so the live BOARD is still
   * the previous world's for the length of this call. A world's opening beat must
   * therefore not resolve tile refs or gate on a count — borealis' is a bare line,
   * and the first beat that touches the board comes after the player taps it.
   */
  private enterWorld(worldId: string): void {
    if (this.world === worldId) return;
    this.world = worldId;
    this.lastHatched = null; // a tile ref from the world you left points at nothing here
    this.begin();
  }

  get currentStep(): TutorialStepConfig | undefined {
    if (this.done) return undefined;
    return this.script.steps[this.index];
  }

  /** Emit the current step (fresh game, resume after load, or arrival in a world
   *  that owns a script of its own). */
  begin(): void {
    if (this.done) {
      this.emitDone();
      return;
    }
    this.emitStep();
    this.checkCountGate();
  }

  isDone(): boolean {
    return this.done;
  }

  private onGateEvent(event: string, chain?: string): void {
    const step = this.currentStep;
    if (!step || step.gate.type !== 'event') return;
    if (step.gate.event !== event) return;
    if (step.gate.chain && step.gate.chain !== chain) return;
    this.advance();
  }

  private checkCountGate(): void {
    // Loop: consecutive count gates could already be satisfied.
    for (let guard = 0; guard < this.script.steps.length; guard++) {
      const step = this.currentStep;
      if (!step || step.gate.type !== 'count') return;
      const { chain, tier, count } = step.gate;
      if (this.state.countItems(chain, tier) < count) return;
      this.advance();
    }
  }

  private advance(): void {
    if (this.done) return;
    const next = this.index + 1;
    const finished = next >= this.script.steps.length;
    this.state.setTutorialProgress(this.world, next, finished);
    if (finished) {
      this.emitDone();
      // Completion moment ONLY (begin()/resume never fires this). The world it
      // finished in rides along: the isle's completion drives the lair teleport,
      // and a sub-world's must not be mistaken for it.
      this.bus.emit('tutorial:done', { world: this.world });
    } else {
      // Effects fire on the advance INTO a step (once), never on resume — their
      // results live in saved state, so emitStep() on reload must not re-run them.
      this.applyEffects(this.currentStep);
      this.emitStep();
    }
  }

  /** Run a step's scripted reward beats via bus commands (spawn / ripen / key / xp). */
  private applyEffects(step: TutorialStepConfig | undefined): void {
    for (const effect of step?.effects ?? []) {
      if ('spawn' in effect) {
        this.bus.emit('board:spawn', effect.spawn);
      } else if ('retier' in effect) {
        this.bus.emit('board:retier', effect.retier);
      } else if ('grantKeys' in effect) {
        this.bus.emit('economy:add', { keys: effect.grantKeys, reason: 'tutorial' });
      } else if ('grantXp' in effect) {
        this.bus.emit('economy:add', { xp: effect.grantXp, reason: 'tutorial' });
      } else if ('advanceClock' in effect) {
        this.clock.advance(effect.advanceClock);
        this.bus.emit('time:advanced', { ms: effect.advanceClock });
      } else if ('setEnergy' in effect) {
        this.bus.emit('energy:set', { value: effect.setEnergy, reason: 'tutorial' });
      } else if ('move' in effect) {
        this.bus.emit('board:move', effect.move);
      } else if ('setTimer' in effect) {
        this.bus.emit('generator:set_timer', effect.setTimer);
      }
    }
  }

  private emitStep(): void {
    const step = this.currentStep;
    if (!step) return;
    this.bus.emit('tutorial:step', this.resolveStep(step));
  }

  private emitDone(): void {
    // A world with no script of its own still reports the ISLE's count: this payload
    // is the "tutorial over" signal the HUD reads, and 0/0 would read as a checklist
    // that never existed rather than one that is finished.
    const total = this.script.steps.length || this.data.steps.length;
    const payload: TutorialStepEvent = {
      id: 'done',
      index: total,
      total,
      done: true,
      speaker: 'laurah',
      text: '',
      gateType: 'tap',
      highlight: [],
      hand: null,
      arrow: null,
      allow: { ...ALLOW_EVERYTHING }
    };
    this.bus.emit('tutorial:step', payload);
  }

  private resolveStep(step: TutorialStepConfig): TutorialStepEvent {
    const highlight = (step.highlight ?? [])
      .map((ref) => this.resolveTileRef(ref))
      .filter((p): p is TilePos => p !== null);

    let hand: ResolvedHand | null = null;
    if (step.hand) {
      if ('from' in step.hand) {
        const from = this.resolveTileRef(step.hand.from);
        const to = this.resolveTileRef(step.hand.to);
        if (from && to) hand = { from, to };
      } else {
        hand = step.hand;
      }
    }

    let arrow: ResolvedArrow | null = null;
    if (step.arrow) {
      if ('tile' in step.arrow) {
        const tile = this.resolveTileRef(step.arrow.tile);
        if (tile) arrow = { tile };
      } else {
        arrow = step.arrow;
      }
    }

    return {
      id: step.id,
      index: this.index,
      total: this.script.steps.length,
      done: false,
      speaker: step.speaker,
      text: step.text,
      gateType: step.gate.type,
      highlight,
      hand,
      arrow,
      allow: { ...ALLOW_NOTHING, ...(step.allow ?? {}) }
    };
  }

  private resolveTileRef(ref: TileRef): TilePos | null {
    if (Array.isArray(ref)) return { col: ref[0], row: ref[1] };
    if (ref === 'last_hatched') {
      if (this.lastHatched) return this.lastHatched;
      // Resume fallback: point at any generator on the board.
      for (const item of this.state.items.values()) {
        if (item.kind === 'item' && item.readyAt !== undefined) {
          return { col: item.col, row: item.row };
        }
      }
      return null;
    }
    // `{ chain, nth }`: the nth board item of that chain (optionally filtered to a
    // specific tier), in a stable order, so hints track wherever items actually land.
    const cells = [...this.state.items.values()]
      .filter(
        (i) =>
          i.kind === 'item' &&
          i.chain === ref.chain &&
          (ref.tier === undefined || i.tier === ref.tier)
      )
      .sort((a, b) => a.col + a.row - (b.col + b.row) || a.col - b.col)
      .map((i) => ({ col: i.col, row: i.row }));
    return cells[ref.nth] ?? cells[cells.length - 1] ?? null;
  }
}
