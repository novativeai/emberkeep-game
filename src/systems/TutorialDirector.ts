import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import type {
  BoardItemState,
  ResolvedArrow,
  ResolvedHand,
  TileRef,
  TutorialArrowConfig,
  TilePos,
  TutorialAllow,
  TutorialData,
  TutorialEffect,
  TutorialStepConfig,
  TutorialStepEvent
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
  cookbook: false,
  codexHold: false,
  bag: false,
  character: false,
  feed: false,
  commission: false,
  status: false,
  give: false
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
  cookbook: true,
  // Nothing HOLDS the book once the script is done — the player opens and shuts
  // it as they like, which is the whole point of handing the game over.
  codexHold: false,
  bag: true,
  character: true,
  feed: true,
  commission: true,
  status: true,
  give: true
};

/** Everything about a step that the POINTER depends on, as one comparable
 *  string — so "did the answer change?" is one cheap test rather than a
 *  hand-written deep compare that grows a hole every time a marker gains a
 *  field. */
function markerKey(view: TutorialStepEvent): string {
  return JSON.stringify([view.highlight, view.hand, view.arrow]);
}

/**
 * Drives the scripted Level-1 tutorial from data (tutorial.json). Each step
 * gates on a tap, a bus event, or a board count; the emitted
 * 'tutorial:step' payload carries everything the scenes need (bubble text,
 * speaker, highlights, hand/arrow targets and the input allow-list), so the
 * UI only ever subscribes.
 */
export class TutorialDirector {
  private lastHatched: TilePos | null = null;
  /**
   * WHICH PIECE a `{chain, nth}` ref means, decided ONCE per step.
   *
   * The ref names a rank — "the third Ash Moss" — and rank is read off the
   * board's own order, which is positional. So the moment the player drags one
   * of them the ranking re-sorts under the pointer: "the third" becomes a
   * different tuft, and a hand that was following a piece jumps to another one.
   *
   * Resolving the rank to an ITEM ID the first time the step asks, and then
   * following that id, is what makes the pointer track the piece the player is
   * actually moving. Cleared whenever the step changes, and re-resolved if the
   * piece it named is gone (merged into the next tier, eaten, sold).
   */
  private pinned = new Map<string, number>();
  /** The step the pins belong to — the pins are per BEAT, not per session. */
  private pinnedFor = -1;
  /** The last markers put on screen, so a re-resolve that changes nothing does
   *  not restart the hand's animation for no reason. */
  private lastMarkers = '';

  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
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
    bus.on('bag:stored', ({ chain }) => this.onGateEvent('bag:stored', chain));
    bus.on('item:sold', () => this.onGateEvent('item:sold'));
    bus.on('character:action_used', ({ characterId }) =>
      this.onGateEvent('character:action_used', characterId)
    );
    bus.on('chest:open', () => this.onGateEvent('chest:open'));
    bus.on('dragon:working', () => this.onGateEvent('dragon:working'));
    // The feeding lesson gates on the CHAIN eaten, so "give it the Hearth Cake"
    // cannot be satisfied by handing it a Moss Tuft that happened to be nearby.
    bus.on('dragon:fed', ({ chain }) => this.onGateEvent('dragon:fed', chain));
    bus.on('dragon:named', ({ chain }) => this.onGateEvent('dragon:named', chain));
    // GIVE is two beats, so it has two gates. The first is choosing it in the
    // satchel — the piece is held out but not yet handed to anybody...
    bus.on('bag:give_armed', ({ chain }) => this.onGateEvent('bag:give_armed', chain));
    // ...and the second is the delivery, gated on the CHAIN she accepted, so
    // "hand her the Crystal Ball" cannot be met with something else she wants.
    bus.on('regard:gift_accepted', ({ chain }) => this.onGateEvent('regard:gift_accepted', chain));
    // Tapping a character is the whole verb for reading her — the beat that
    // teaches the status readout gates on it.
    bus.on('ui:character_tapped', ({ characterId }) =>
      this.onGateEvent('ui:character_tapped', characterId)
    );
    // The House's commission: the gate is the choice being MADE, not the panel
    // being opened — a player who opens the chooser and closes it again has not
    // learned the lesson, and the House is still undecided.
    bus.on('generator:produce_set', ({ chain }) => this.onGateEvent('generator:produce_set', chain));
    bus.on('generator:skipped', ({ chain, currency }) =>
      this.onGateEvent('generator:skipped', chain, currency)
    );
    bus.on('marketplace:purchased', () => this.onGateEvent('marketplace:purchased'));
    bus.on('order:completed', () => this.onGateEvent('order:completed'));
    bus.on('region:unlocked', () => this.onGateEvent('region:unlocked'));
    bus.on('ui:ledger_toggled', ({ open }) => {
      if (open) this.onGateEvent('ui:ledger_opened');
    });
    bus.on('ui:cookbook_opened', () => this.onGateEvent('ui:cookbook_opened'));
    bus.on('ui:cookbook_closed', () => this.onGateEvent('ui:cookbook_closed'));
    bus.on('ui:codex_toggled', ({ open }) => {
      if (!open) this.onGateEvent('ui:codex_closed');
    });
    // The Codex lesson is a walk through the book, so its gates are the PAGES:
    // the roster card opened, then Evolution. Closing it is the last beat and
    // has its own event above.
    bus.on('ui:codex_page', ({ page }) => {
      if (page === 'detail') this.onGateEvent('ui:codex_dragon_opened');
      if (page === 'evolution') this.onGateEvent('ui:codex_evolution_opened');
    });
    bus.on('item:spawned', () => {
      this.checkCountGate();
      this.refreshMarkers();
    });
    bus.on('item:removed', () => {
      this.checkCountGate();
      this.refreshMarkers();
    });
    // THE POINTER FOLLOWS THE PIECE. Every board change that can move what a
    // beat is pointing at re-aims it; `refreshMarkers` is silent when the
    // answer has not changed, so this costs nothing on an unrelated move.
    bus.on('item:move_bounced', () => this.refreshMarkers());
    // The board-hygiene lesson: a piece CARRIED into a region. Gated on the
    // drop landing inside the named region's tiles, so a wiggle on the spot
    // cannot satisfy it.
    bus.on('item:moved', ({ itemId, to }) => {
      this.refreshMarkers(); // the piece moved — so does whatever pointed at it
      const step = this.currentStep;
      if (!step || step.gate.type !== 'move') return;
      if (this.state.items.get(itemId)?.chain !== step.gate.chain) return;
      const region = this.state.map.regions.find((r) => r.id === (step.gate as { region: string }).region);
      if (!region?.tiles.some(([c, r]) => c === to.col && r === to.row)) return;
      this.advance();
    });
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
    this.replayPrompts(this.currentStep);
    this.checkCountGate();
  }

  /**
   * Re-run the effects of the resumed step that ASK the player something.
   *
   * Most effects are grants — a spawn, some XP, a key — and their results are in
   * the save, which is why `advance()` runs them once and `begin()` does not.
   * Three are not grants. `nameDragon` opens a prompt, `wantGift` stages a want
   * that is deliberately never persisted, and `openCodex` opens a panel; none
   * leaves anything behind for a reload to find. A step gated on answering a
   * prompt — or on turning a page of a book that is not on screen — is a dead
   * save, so those three are re-applied on resume.
   *
   * All three are idempotent by construction: `nameDragon` looks for a dragon
   * with no name yet, `wantGift` overwrites the single scripted want, and
   * `openCodex` re-opens a panel that is either already open or shut.
   */
  private replayPrompts(step: TutorialStepConfig | undefined): void {
    for (const effect of step?.effects ?? []) {
      if (!('nameDragon' in effect) && !('wantGift' in effect) && !('openCodex' in effect)) continue;
      try {
        this.applyEffect(effect);
      } catch (err) {
        console.error(`[tutorial] prompt replay failed on step '${step?.id}'`, effect, err);
      }
    }
  }

  isDone(): boolean {
    return this.state.tutorialDone;
  }

  private onGateEvent(event: string, chain?: string, currency?: string): void {
    const step = this.currentStep;
    if (!step || step.gate.type !== 'event') return;
    if (step.gate.event !== event) return;
    if (step.gate.chain && step.gate.chain !== chain) return;
    if (step.gate.currency && step.gate.currency !== currency) return;
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

  /**
   * Run a step's scripted reward beats via bus commands (spawn / ripen / key / xp).
   *
   * Each effect is ISOLATED. The bus is synchronous and does not catch, so a
   * throwing subscriber used to unwind all the way out of `advance()` — which
   * had already incremented `tutorialIndex` but had not yet emitted the new
   * step. The result was the worst possible failure: the director silently on
   * step N+1, the bubble still showing step N, and every further tap sending a
   * stepId that no longer matched. A hard lock with nothing on screen to say so.
   *
   * An effect that fails now costs its own reward and nothing else, and says so
   * in the console. The step still emits, so the player is never stranded by a
   * view that threw.
   */
  private applyEffects(step: TutorialStepConfig | undefined): void {
    for (const effect of step?.effects ?? []) {
      try {
        this.applyEffect(effect);
      } catch (err) {
        console.error(`[tutorial] effect failed on step '${step?.id}'`, effect, err);
      }
    }
  }

  private applyEffect(effect: TutorialEffect): void {
    {
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
      } else if ('wantGift' in effect) {
        this.bus.emit('tutorial:want_gift', effect.wantGift);
      } else if ('openCodex' in effect) {
        // The book opens ITSELF for the lesson — UIScene owns the panel and
        // plays the favourite-meal reveal the previous beat's feed earned.
        this.bus.emit('ui:codex_open_requested', effect.openCodex);
      } else if ('nameDragon' in effect) {
        const { chain, tier } = effect.nameDragon;
        const dragon = [...this.state.items.values()].find(
          (i) => i.kind === 'item' && i.chain === chain && i.tier === tier && !i.dragonName
        );
        // No silent refusal: this step's gate IS the answer to the prompt, so a
        // beat that asks nobody is a stuck save, and it must say so.
        if (dragon) this.bus.emit('ui:name_dragon_requested', { itemId: dragon.id });
        else console.error(`[tutorial] nameDragon found no unnamed ${chain} at tier ${tier}`);
      }
    }
  }

  private emitStep(): void {
    const step = this.currentStep;
    if (!step) return;
    // A new beat: the pins belong to the beat that made them.
    if (this.pinnedFor !== this.state.tutorialIndex) {
      this.pinned.clear();
      this.pinnedFor = this.state.tutorialIndex;
    }
    const view = this.resolveStep(step);
    this.lastMarkers = markerKey(view);
    this.bus.emit('tutorial:step', view);
  }

  /**
   * RE-AIM THE POINTER AT THE LIVE BOARD.
   *
   * The step is a one-shot — its text, its speaker and its permissions are
   * settled the moment it opens — but where it POINTS is not: a player who
   * picks up one of the three tufts they were asked to merge has changed the
   * answer to "where is the move", and a hand still hovering over the tile they
   * emptied is telling them to do something that no longer exists.
   *
   * So the markers get their own event. Nothing else about the beat is
   * re-emitted — re-emitting `tutorial:step` would restart the bubble, re-run
   * the codex hold and replay the opening — and it only fires when the answer
   * has actually CHANGED, so a move somewhere else on the board does not
   * restart the hand's animation for nothing.
   */
  private refreshMarkers(): void {
    const step = this.currentStep;
    if (!step || this.state.tutorialDone) return;
    const view = this.resolveStep(step);
    const key = markerKey(view);
    if (key === this.lastMarkers) return;
    this.lastMarkers = key;
    this.bus.emit('tutorial:markers', {
      highlight: view.highlight,
      hand: view.hand,
      arrow: view.arrow
    });
  }

  private emitDone(): void {
    const payload: TutorialStepEvent = {
      id: 'done',
      index: this.data.steps.length,
      total: this.data.steps.length,
      done: true,
      speaker: 'eleanor',
      text: '',
      gateType: 'tap',
      highlight: [],
      hand: null,
      arrow: null,
      arrowThen: null,
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

    const resolveArrow = (ref: TutorialArrowConfig | undefined): ResolvedArrow | null => {
      if (!ref) return null;
      if ('tile' in ref) {
        const tile = this.resolveTileRef(ref.tile);
        return tile ? { tile } : null;
      }
      return ref;
    };
    const arrow = resolveArrow(step.arrow);
    // Resolved WITH the step, not when the character is armed: the tile it
    // names is the one the beat set up (the House it just slowed down), and by
    // the time she is armed the board may hold a second one.
    const arrowThen = resolveArrow(step.arrowThen);

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
      arrowThen,
      allow: { ...ALLOW_NOTHING, ...(step.allow ?? {}) }
    };
  }

  private resolveTileRef(ref: TileRef): TilePos | null {
    const item = this.resolveRefItem(ref);
    if (item) return { col: item.col, row: item.row };
    if (Array.isArray(ref)) return { col: ref[0], row: ref[1] };
    if (ref === 'last_hatched' && this.lastHatched) return this.lastHatched;
    return null;
  }

  /**
   * The LIVE PIECE a ref names, or null for a ref that names ground.
   *
   * Everything the tutorial points at that can move resolves through here, and
   * it answers with the item itself rather than a copy of where the item was
   * standing — which is the whole difference between a pointer that follows the
   * piece and one that keeps pointing at the tile the piece has left.
   */
  private resolveRefItem(ref: TileRef): BoardItemState | null {
    if (Array.isArray(ref)) {
      // An authored cell can still be pointing AT something: a beat that names
      // the tile a piece was seeded on means that piece, and the player is free
      // to pick it up before doing what they were asked.
      const standing = this.state.itemAt(ref[0], ref[1]);
      return standing?.kind === 'item' ? standing : null;
    }
    if (ref === 'last_hatched') {
      if (this.lastHatched) {
        const standing = this.state.itemAt(this.lastHatched.col, this.lastHatched.row);
        if (standing?.kind === 'item') return standing;
      }
      // Resume fallback: point at any generator on the board.
      for (const item of this.state.items.values()) {
        if (item.kind === 'item' && item.readyAt !== undefined) return item;
      }
      return null;
    }
    // `{ chain, nth }`: the nth board item of that chain, optionally of one
    // tier. PINNED on first resolve — see `pinned`.
    const key = `${ref.chain}:${ref.tier ?? '*'}:${ref.nth}`;
    const pinnedId = this.pinned.get(key);
    if (pinnedId !== undefined) {
      const held = this.state.items.get(pinnedId);
      if (held && held.kind === 'item') return held;
      this.pinned.delete(key); // it merged, was eaten, or was sold — re-rank
    }
    const ranked = [...this.state.items.values()]
      .filter(
        (i) =>
          i.kind === 'item' &&
          i.chain === ref.chain &&
          (ref.tier === undefined || i.tier === ref.tier)
      )
      .sort((a, b) => a.col + a.row - (b.col + b.row) || a.col - b.col);
    // Never pin over a piece another rank of the same step already claimed:
    // "from the third to the first" must be two pieces, not one twice.
    const taken = new Set(this.pinned.values());
    const pick = ranked[ref.nth] ?? ranked[ranked.length - 1] ?? null;
    const chosen = pick && taken.has(pick.id) ? (ranked.find((i) => !taken.has(i.id)) ?? pick) : pick;
    if (chosen) this.pinned.set(key, chosen.id);
    return chosen;
  }
}
