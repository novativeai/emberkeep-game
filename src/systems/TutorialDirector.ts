import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import { mergeHints, planFor, type HintBoard } from '../core/mergeHints';
import { zoneAt } from '../core/world';
import type {
  BoardItemState,
  ChainsData,
  MarkerPoint,
  ResolvedArrow,
  ResolvedHand,
  TileRef,
  TutorialArrowConfig,
  TilePos,
  TutorialAllow,
  TutorialData,
  TutorialEffect,
  TutorialScriptConfig,
  TutorialStepConfig,
  TutorialStepEvent
} from '../core/types';
import {
  MAIN_SCRIPT_ID,
  scriptStatKeys,
  scriptsOf,
  triggerEvents,
  triggerMet,
  type TriggerFacts
} from '../core/tutorialScripts';

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

/* --------------------------------------------------------------------------
 * MARKER POINTS — the two-line pair every pointer in the game reads through.
 *
 * They live beside the director because the director is what decides WHICH
 * piece a beat means, and these decide where that piece IS; splitting the two
 * halves across modules is how the tutorial's hand and the board's own hint
 * ended up with different answers to the same question. They are pure — no
 * Phaser, no scene, no ambient projection — so the code the UI runs every frame
 * is the code the unit tests run in node, and they are WORLD-BLIND on purpose:
 * everything they touch is `state.items`, which is the ACTIVE world's board and
 * nothing else. That is the whole of "every map has this system" — there is no
 * per-world branch to get wrong.
 * ----------------------------------------------------------------------- */

/**
 * The marker end for a cell — tagged with the PIECE standing on it, if any.
 *
 * A pointer aimed at ground and a pointer aimed at a piece look identical when
 * they are placed and behave nothing alike a second later, so the question is
 * asked ONCE, when the marker goes up: whatever is standing here is what this
 * end means from now on. Pieces only — a `decor` fixture cannot be picked up,
 * so pinning to one buys nothing and would make an immovable thing look movable.
 */
export function markerPointAt(state: GameState, col: number, row: number): MarkerPoint {
  const standing = state.itemAt(col, row);
  return standing?.kind === 'item' ? { col, row, item: standing.id } : { col, row };
}

/**
 * Where a marker end is NOW — `null` when it has nothing left to point at.
 *
 * Ground never moves, so a cell answers itself. A piece answers with wherever it
 * is standing this frame, which is what makes a hand follow a dragon across the
 * board instead of hovering over the tile it started on.
 *
 * `null` covers both ways a piece can stop being pointable, and they deserve the
 * same answer: it was consumed (merged, sold, pocketed, eaten), or it is on
 * ANOTHER WORLD'S board — `state.items` is the active world's, so a piece the
 * player left on the isle simply is not in it. A hand pointing at a piece on
 * another isle is worse than no hand, and a hand pointing at the cell a merged
 * piece used to occupy is worse still. Callers hide the marker; nothing throws,
 * because this is read inside a per-frame `guard()` that swallows throws
 * silently and permanently.
 */
export function markerPointCell(state: GameState, point: MarkerPoint): TilePos | null {
  if (point.item === undefined) return { col: point.col, row: point.row };
  const item = state.items.get(point.item);
  return item ? { col: item.col, row: item.row } : null;
}

/**
 * Drives the scripted tutorials from data (tutorial.json). Each step gates on
 * a tap, a bus event, or a board count; the emitted 'tutorial:step' payload
 * carries everything the scenes need (bubble text, speaker, highlights,
 * hand/arrow targets and the input allow-list), so the UI only ever subscribes.
 *
 * TWO KINDS OF SCRIPT, ONE ENGINE. The main Chapter One script runs first and
 * keeps its persisted `tutorialIndex`/`tutorialDone`. Every other script
 * (`tutorials` in the file — see tutorialScripts.ts) waits for its TRIGGER
 * once the main script is done, then plays through the same gate machinery;
 * its progress lives in stats (`tut:<id>:step`, `:done`, `:started`), which
 * are saved, monotonic and need no SAVE_VERSION — a reload resumes a mid-game
 * lesson on the beat it left, exactly as the main script always has. One
 * script holds the board at a time; a trigger met while another plays is
 * re-checked the moment that one hands back.
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
  /** The beat the pins belong to (`<script>:<index>`) — the pins are per
   *  BEAT, not per session, and a mid-game script's beats are not counted by
   *  `tutorialIndex`. */
  private pinnedFor = '';
  /** The last markers put on screen, so a re-resolve that changes nothing does
   *  not restart the hand's animation for no reason. */
  private lastMarkers = '';
  private readonly scripts: TutorialScriptConfig[];
  /** The mid-game script currently playing (never `main`, which has its own latch). */
  private activeId: string | null = null;

  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
    private data: TutorialData,
    /** The merge rules — a merge beat's hand is PLANNED against them, not guessed. */
    private chains: ChainsData | null = null
  ) {
    this.scripts = scriptsOf(data);
    // An `event` trigger is an OBSERVATION: the fact is latched into stats the
    // moment it fires so a reload still knows it happened, then evaluated like
    // every other trigger. Subscribed per distinct event named by any script.
    for (const event of triggerEvents(this.scripts)) {
      bus.on(event as 'item:merged', (payload: unknown) => {
        const chain = (payload as { chain?: string } | undefined)?.chain;
        for (const script of this.scripts) {
          const t = script.trigger;
          if (t.type !== 'event' || t.event !== event) continue;
          if (t.chain && t.chain !== chain) continue;
          const key = scriptStatKeys(script.id).trigger;
          if (this.state.stat(key) === 0) this.state.addStat(key, 1);
        }
        this.evaluateTriggers();
      });
    }
    // Facts the state-read triggers depend on change on these.
    bus.on('quest:completed', () => this.evaluateTriggers());
    bus.on('keeper:leveled', () => this.evaluateTriggers());
    bus.on('world:ready', () => this.evaluateTriggers());
    // An authored event asking for a lesson by id (docs/event-creator.md). It
    // starts only when a trigger-met script would: main done, nothing playing.
    bus.on('tutorial:start_requested', ({ tutorial }) => this.startScript(tutorial));
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
      const gate = step.gate as { region?: string; at?: [number, number] };
      if (gate.region) {
        const region = this.state.map.regions.find((r) => r.id === gate.region);
        if (!region?.tiles.some(([c, r]) => c === to.col && r === to.row)) return;
      }
      if (!this.landedWhereAsked(gate.at, to)) return;
      this.advance();
    });
    bus.on('tutorial:advance_requested', ({ stepId }) => {
      const step = this.currentStep;
      if (step && step.id === stepId && step.gate.type === 'tap') {
        this.advance();
      }
    });
  }

  /**
   * Did the drop land on the cell the beat POINTED at?
   *
   * True when the beat named no cell — the gate is then the whole region, as it
   * always was. True as well when the named cell is OCCUPIED: a beat whose one
   * answer is under someone else's feet is a dead save, and during this lesson
   * only the lesson's own chain may be dragged, so the player would have no way
   * to clear it. Falling back to the field — or, with no field named, to any
   * drop at all — is the honest failure: the lesson still happens, just without
   * its exact seat.
   */
  private landedWhereAsked(at: [number, number] | undefined, to: TilePos): boolean {
    if (!at) return true;
    const [col, row] = at;
    if (to.col === col && to.row === row) return true;
    return this.state.itemAt(col, row) !== undefined;
  }

  get currentStep(): TutorialStepConfig | undefined {
    if (!this.state.tutorialDone) return this.data.steps[this.state.tutorialIndex];
    const script = this.activeScript;
    if (!script) return undefined;
    return script.steps[this.activeIndex(script)];
  }

  /** The script holding the board right now — `main`, a mid-game lesson's id, or null. */
  get activeScriptId(): string | null {
    return this.activeScript?.id ?? null;
  }

  /** The script whose step is on screen: main while it runs, else the active mid-game one. */
  private get activeScript(): TutorialScriptConfig | undefined {
    if (!this.state.tutorialDone) return this.scripts[0];
    return this.activeId ? this.scripts.find((s) => s.id === this.activeId) : undefined;
  }

  private activeIndex(script: TutorialScriptConfig): number {
    return script.id === MAIN_SCRIPT_ID ? this.state.tutorialIndex : this.state.stat(scriptStatKeys(script.id).step);
  }

  private get facts(): TriggerFacts {
    return {
      stat: (k) => this.state.stat(k),
      level: this.state.level,
      worldId: this.state.worldId,
      mainDone: this.state.tutorialDone,
      mainIndex: this.state.tutorialIndex
    };
  }

  /** Emit the current step (fresh game or resume after load). */
  begin(): void {
    if (!this.state.tutorialDone) {
      this.emitStep();
      this.replayPrompts(this.currentStep);
      this.checkCountGate();
      return;
    }
    // A mid-game lesson left mid-way resumes on its beat; otherwise the board
    // is the player's and any trigger that is already met starts its script.
    const resumed = this.scripts.find((s) => {
      if (s.id === MAIN_SCRIPT_ID || s.steps.length === 0) return false;
      const keys = scriptStatKeys(s.id);
      return this.state.stat(keys.started) > 0 && this.state.stat(keys.done) === 0;
    });
    if (resumed) {
      this.activeId = resumed.id;
      this.emitStep();
      this.replayPrompts(this.currentStep);
      this.checkCountGate();
      return;
    }
    this.emitDone();
    this.evaluateTriggers();
  }

  /**
   * Start the first mid-game script whose trigger is met — if nothing is on
   * the board already. Called on every fact that could have changed an answer
   * and whenever a script hands back.
   */
  private evaluateTriggers(): void {
    if (this.activeScript) return;
    const facts = this.facts;
    for (const script of this.scripts) {
      if (script.id === MAIN_SCRIPT_ID || script.steps.length === 0) continue; // an empty script is still being written
      if (this.state.stat(scriptStatKeys(script.id).done) > 0) continue;
      if (!triggerMet(this.scripts, facts, script)) continue;
      this.start(script);
      return;
    }
  }

  /** Start a mid-game script BY ID, as an event asks — its own trigger is not
   *  consulted, but everything else that would stop it still does. */
  private startScript(id: string): void {
    if (this.activeScript || !this.facts.mainDone) return;
    const script = this.scripts.find((s) => s.id === id && s.id !== MAIN_SCRIPT_ID);
    if (!script || script.steps.length === 0 || this.state.stat(scriptStatKeys(script.id).done) > 0) return;
    this.start(script);
  }

  private start(script: TutorialScriptConfig): void {
    const keys = scriptStatKeys(script.id);
    this.activeId = script.id;
    // The first step's effects fire once, on the start — the same
    // once-on-entry rule `advance` keeps for every later step.
    if (this.state.stat(keys.started) === 0) {
      this.state.addStat(keys.started, 1);
      this.applyEffects(script.steps[0]);
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
    for (let guard = 0; guard < (this.activeScript?.steps.length ?? 0); guard++) {
      const step = this.currentStep;
      if (!step || step.gate.type !== 'count') return;
      const { chain, tier, count } = step.gate;
      if (this.state.countItems(chain, tier) < count) return;
      this.advance();
    }
  }

  private advance(): void {
    const script = this.activeScript;
    if (!script) return;
    if (script.id === MAIN_SCRIPT_ID) {
      this.state.tutorialIndex++;
      if (this.state.tutorialIndex >= this.data.steps.length) {
        this.state.tutorialDone = true;
        this.emitDone();
        this.evaluateTriggers(); // a lesson waiting on "main done" may start now
        return;
      }
    } else {
      const keys = scriptStatKeys(script.id);
      this.state.addStat(keys.step, 1);
      if (this.state.stat(keys.step) >= script.steps.length) {
        this.state.addStat(keys.done, 1);
        this.activeId = null;
        this.emitDone();
        this.evaluateTriggers(); // the next met trigger takes the board
        return;
      }
    }
    // Effects fire on the advance INTO a step (once), never on resume — their
    // results live in saved state, so emitStep() on reload must not re-run them.
    this.applyEffects(this.currentStep);
    this.emitStep();
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
    const script = this.activeScript;
    const beat = script ? `${script.id}:${this.activeIndex(script)}` : '';
    if (this.pinnedFor !== beat) {
      this.pinned.clear();
      this.pinnedFor = beat;
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
      tutorial: MAIN_SCRIPT_ID,
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

  /** The first drag of a real merge plan for the hand's own piece, or null. */
  private plannedMergeLeg(step: TutorialStepConfig, from: MarkerPoint): ResolvedHand | null {
    if (!this.chains || from.item === undefined) return null;
    const gate = step.gate;
    if (gate.type !== 'event' || gate.event !== 'item:merged') return null;
    const piece = this.state.items.get(from.item);
    if (!piece || (gate.chain && piece.chain !== gate.chain)) return null;
    const state = this.state;
    const board: HintBoard = {
      isActive: (c, r) => state.isTileActive(c, r),
      itemIdAt: (c, r) => state.itemIdAt(c, r),
      neighbors: (c, r) => state.neighbors(c, r),
      zoneOf: (c, r) => zoneAt(state.world, c, r)?.id
    };
    const items = [...state.items.values()];
    const hint = mergeHints(items, this.chains, board).find((h) => h.chain === piece.chain && h.tier === piece.tier);
    if (!hint) return null;
    const plan = planFor(hint, items, board);
    const leg = plan?.steps[0];
    const mover = leg ? state.items.get(leg.itemId) : undefined;
    if (!leg || !mover) return null;
    const target = state.itemIdAt(leg.to.col, leg.to.row);
    return {
      from: { col: mover.col, row: mover.row, item: mover.id },
      to: target && target !== mover.id ? { col: leg.to.col, row: leg.to.row, item: target } : { col: leg.to.col, row: leg.to.row }
    };
  }

  private resolveStep(step: TutorialStepConfig): TutorialStepEvent {
    // Highlights stay CELLS: a glow is painted on the ground, and the board
    // repaints it whenever this view is re-emitted (which a move does).
    const highlight = (step.highlight ?? [])
      .map((ref) => this.resolveTileRef(ref))
      .filter((p): p is MarkerPoint => p !== null)
      .map((p): TilePos => ({ col: p.col, row: p.row }));

    let hand: ResolvedHand | null = null;
    if (step.hand) {
      if ('from' in step.hand) {
        const from = this.resolveTileRef(step.hand.from);
        let to = this.resolveTileRef(step.hand.to);
        // A DRAG HAS TWO ENDS AND THEY CANNOT BE THE SAME PIECE.
        //
        // Both ends follow their piece, which is what makes "drag that tuft
        // onto this one" survive either of them being moved. But the player is
        // free to answer the beat halfway — to drop `from` on the very cell the
        // beat was pointing at — and from that moment a `to` that re-resolved
        // by position would name the piece already in the player's hand, and
        // the gesture would collapse to a hand waving at itself. So a `to`
        // that lands on the carried piece falls back to the GROUND it names:
        // "put it here" still reads, and the destination stops moving with the
        // thing being moved.
        if (from?.item !== undefined && to?.item === from.item) {
          to = { col: to.col, row: to.row };
        }
        // A MERGE BEAT'S HAND IS A PLAN, NOT A PAIR. The refs name ranks —
        // "the third tree onto the first" — and on a board where those two are
        // not orthogonal neighbours of the third, that exact drop BOUNCES
        // (MergeSystem floods the connected group; a diagonal is not in it).
        // The planner already solves this for the idle hint: every leg but the
        // last lands on free ground, and the last lands on a piece it can fuse
        // with. Use its first leg whenever the beat is a merge of the pieces
        // the hand names; fall back to the refs when there is nothing to plan.
        const planned = from && to ? this.plannedMergeLeg(step, from) : null;
        if (planned) hand = planned;
        else if (from && to) hand = { from, to };
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

    const script = this.activeScript ?? this.scripts[0]!;
    return {
      id: step.id,
      tutorial: script.id,
      index: this.activeIndex(script),
      total: script.steps.length,
      done: false,
      speaker: step.speaker,
      text: step.text,
      gateType: step.gate.type,
      highlight,
      hand,
      arrow,
      arrowThen,
      // The main script opens one verb at a time; a mid-game lesson takes
      // nothing away unless its author lists what to hold back (allowBase).
      allow: { ...(script.allowBase === 'everything' ? ALLOW_EVERYTHING : ALLOW_NOTHING), ...(step.allow ?? {}) }
    };
  }

  /**
   * A ref as a MARKER END: the cell it names, plus the piece standing there.
   *
   * The `item` id is the half that survives a drag — see `MarkerPoint`. The cell
   * is still filled in for every reader that only wants a place (the board aims
   * its camera once, when the beat opens), and it is the WHOLE answer for a ref
   * that names ground: an authored cell nobody is standing on stays exactly the
   * frozen tile it was authored as, because that is what it means.
   */
  /** Is there an item on a cell drawn directly IN FRONT of this one? Depth
   *  grows with col+row, so the three cells ahead are (+1,0), (0,+1), (+1,+1). */
  private shadowed(item: BoardItemState): boolean {
    for (const [dc, dr] of [[1, 0], [0, 1], [1, 1]] as const) {
      const front = this.state.itemAt(item.col + dc, item.row + dr);
      if (front && front.id !== item.id && front.kind === 'item') return true;
    }
    return false;
  }

  private resolveTileRef(ref: TileRef): MarkerPoint | null {
    const item = this.resolveRefItem(ref);
    if (item) return { col: item.col, row: item.row, item: item.id };
    if (Array.isArray(ref)) return { col: ref[0], row: ref[1] };
    if (ref === 'last_hatched' && this.lastHatched) return { ...this.lastHatched };
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
    let chosen = pick && taken.has(pick.id) ? (ranked.find((i) => !taken.has(i.id)) ?? pick) : pick;
    // POINT AT A PIECE THE PLAYER CAN SEE. Ranks run back to front, so the
    // first rank is the piece most likely to stand BEHIND something tall — a
    // Cracked Rock with the House drawn over it is a pointer at the House.
    // The director cannot see art, but it can see the board: a piece with
    // another item on a cell directly in front of it is shadowed, and when an
    // unshadowed rank exists it is the better answer to "that one".
    if (chosen && this.shadowed(chosen)) {
      const free = ranked.filter((i) => !taken.has(i.id));
      // An unshadowed rank first; failing that the FRONT-most, which nothing
      // on the board can stand in front of.
      chosen = free.find((i) => !this.shadowed(i)) ?? free[free.length - 1] ?? chosen;
    }
    if (chosen) this.pinned.set(key, chosen.id);
    return chosen;
  }
}
