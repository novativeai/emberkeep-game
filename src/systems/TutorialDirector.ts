import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import type {
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
  private readonly scripts: TutorialScriptConfig[];
  /** The mid-game script currently playing (never `main`, which has its own latch). */
  private activeId: string | null = null;

  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
    private data: TutorialData
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
    // The same lesson as the House's skip, aimed at the one wait that is an
    // animal: paying a sleeping dragon awake. No chain — there is only ever one
    // named dragon being asked to cross.
    bus.on('dragon:sleep_skipped', ({ currency }) =>
      this.onGateEvent('dragon:sleep_skipped', undefined, currency)
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
    bus.on('item:spawned', () => this.checkCountGate());
    bus.on('item:removed', () => this.checkCountGate());
    // The board-hygiene lesson: a piece CARRIED into a region. Gated on the
    // drop landing inside the named region's tiles, so a wiggle on the spot
    // cannot satisfy it.
    bus.on('item:moved', ({ itemId, to }) => {
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
      const keys = scriptStatKeys(script.id);
      if (this.state.stat(keys.done) > 0) continue;
      if (!triggerMet(this.scripts, facts, script)) continue;
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
      return;
    }
  }

  /**
   * Re-run the effects of the resumed step that ASK the player something.
   *
   * Most effects are grants — a spawn, some XP, a key — and their results are in
   * the save, which is why `advance()` runs them once and `begin()` does not.
   * Four are not grants. `nameDragon` opens a prompt, `wantGift` stages a want
   * that is deliberately never persisted, `openCodex` opens a panel, and
   * `sleepDragon` opens a sleep window that (like every schedule in
   * DragonLifeSystem) survives nothing; none leaves anything behind for a
   * reload to find. A step gated on answering a prompt — or on turning a page
   * of a book that is not on screen, or on waking a dragon that came back
   * standing — is a dead save, so those four are re-applied on resume.
   *
   * All four are idempotent by construction: `nameDragon` looks for a dragon
   * with no name yet, `wantGift` overwrites the single scripted want,
   * `openCodex` re-opens a panel that is either already open or shut, and
   * `sleepDragon` overwrites the one scripted window.
   */
  private replayPrompts(step: TutorialStepConfig | undefined): void {
    for (const effect of step?.effects ?? []) {
      if (
        !('nameDragon' in effect) &&
        !('wantGift' in effect) &&
        !('openCodex' in effect) &&
        !('sleepDragon' in effect)
      )
        continue;
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
      } else if ('sleepDragon' in effect) {
        this.bus.emit('tutorial:sleep_dragon', effect.sleepDragon);
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
    this.bus.emit('tutorial:step', this.resolveStep(step));
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
