import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type {
  ResolvedArrow,
  ResolvedHand,
  TileRef,
  TilePos,
  TutorialAllow,
  TutorialData,
  TutorialStepConfig,
  TutorialStepEvent
} from '../core/types';

const ALLOW_NOTHING: Required<TutorialAllow> = {
  drag: [],
  tapGenerators: false,
  ledger: false,
  deliver: false,
  fog: false,
  sell: false
};

const ALLOW_EVERYTHING: Required<TutorialAllow> = {
  drag: ['*'],
  tapGenerators: true,
  ledger: true,
  deliver: true,
  fog: true,
  sell: true
};

/**
 * Drives the scripted Level-1 tutorial from data (tutorial.json). Each step
 * gates on a tap, a bus event, or a board count; the emitted
 * 'tutorial:step' payload carries everything the scenes need (bubble text,
 * speaker, highlights, hand/arrow targets and the input allow-list), so the
 * UI only ever subscribes.
 */
export class TutorialDirector {
  private lastHatched: TilePos | null = null;

  constructor(
    private state: GameState,
    private bus: EventBus,
    private data: TutorialData
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
    bus.on('order:completed', () => this.onGateEvent('order:completed'));
    bus.on('region:unlocked', () => this.onGateEvent('region:unlocked'));
    bus.on('ui:ledger_toggled', ({ open }) => {
      if (open) this.onGateEvent('ui:ledger_opened');
    });
    bus.on('item:spawned', () => this.checkCountGate());
    bus.on('item:removed', () => this.checkCountGate());
    bus.on('tutorial:advance_requested', ({ stepId }) => {
      const step = this.currentStep;
      if (step && step.id === stepId && step.gate.type === 'tap') {
        this.advance();
      }
    });
  }

  get currentStep(): TutorialStepConfig | undefined {
    if (this.state.tutorialDone) return undefined;
    return this.data.steps[this.state.tutorialIndex];
  }

  /** Emit the current step (fresh game or resume after load). */
  begin(): void {
    if (this.state.tutorialDone) {
      this.emitDone();
      return;
    }
    this.emitStep();
    this.checkCountGate();
  }

  isDone(): boolean {
    return this.state.tutorialDone;
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
    for (let guard = 0; guard < this.data.steps.length; guard++) {
      const step = this.currentStep;
      if (!step || step.gate.type !== 'count') return;
      const { chain, tier, count } = step.gate;
      if (this.state.countItems(chain, tier) < count) return;
      this.advance();
    }
  }

  private advance(): void {
    if (this.state.tutorialDone) return;
    this.state.tutorialIndex++;
    if (this.state.tutorialIndex >= this.data.steps.length) {
      this.state.tutorialDone = true;
      this.emitDone();
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
      }
    }
  }

  private emitStep(): void {
    const step = this.currentStep;
    if (!step) return;
    this.bus.emit('tutorial:step', this.resolveStep(step));
  }

  private emitDone(): void {
    const payload: TutorialStepEvent = {
      id: 'done',
      index: this.data.steps.length,
      total: this.data.steps.length,
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
      index: this.state.tutorialIndex,
      total: this.data.steps.length,
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
    // `{ chain, nth }`: the nth board item of that chain, in a stable order, so
    // hints track wherever the map placed the starting cluster.
    const cells = [...this.state.items.values()]
      .filter((i) => i.kind === 'item' && i.chain === ref.chain)
      .sort((a, b) => a.col + a.row - (b.col + b.row) || a.col - b.col)
      .map((i) => ({ col: i.col, row: i.row }));
    return cells[ref.nth] ?? cells[cells.length - 1] ?? null;
  }
}
