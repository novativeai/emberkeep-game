import { IS_MOBILE } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import {
  clusterOf,
  gatherSeat,
  readyClusters,
  recipeFor,
  verdictOnto,
  type ReadyCluster,
  type RuleBoard
} from '../core/mergeRule';
import chainsJson from '../data/chains.json';
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

/* --------------------------------------------------------------------------
 * MERGE HANDS — the plan a "drag them together" beat actually shows.
 *
 * Every merge beat in the script is authored the same way: `from` is "the third
 * piece of this kind", `to` is "the first", and rank is read off the board's own
 * order (col+row, then col). That was enough while standing BESIDE two alike
 * fused them: whichever two pieces the hand happened to join, the third was
 * never more than a neighbouring cell away. Under the drop rule it is not
 * enough, because the rule has a direction. Dropping the outsider ON a member
 * of the pair merges; dropping a member of the pair ON the outsider merely
 * GATHERS (the target's flood is the lone piece, and one plus one is not
 * three). Rank knows nothing about pairs, so "the first" was as likely to be the
 * lone tuft as a member of the pair — and then the hand demonstrated a drop the
 * board answered with a shuffle, the gate kept waiting for `item:merged`, and
 * nothing on screen said a second gesture was wanted.
 *
 * So a hand whose two ends name the SAME KIND of piece is not resolved by rank
 * at all. It is planned off the board's clusters, through the very predicate
 * MergeSystem will run on the drop (`verdictOnto`), and checked against it
 * before it is shown: the hand never asks for a drop the board would refuse.
 * ----------------------------------------------------------------------- */

/** The `{chain, nth, tier?}` form of a ref — the one that names a PIECE. */
type PieceRef = { chain: string; nth: number; tier?: number };

function isPieceRef(ref: TileRef): ref is PieceRef {
  return typeof ref === 'object' && !Array.isArray(ref) && 'chain' in ref;
}

/** Both ends name one kind of piece: this hand is "drag them together". */
function sameKind(a: TileRef, b: TileRef): boolean {
  return isPieceRef(a) && isPieceRef(b) && a.chain === b.chain && a.tier === b.tier;
}

const stepsApart = (a: TilePos, b: TilePos): number =>
  Math.abs(a.col - b.col) + Math.abs(a.row - b.row);

/** Oldest piece first — the one tie-break the rule itself uses, so the hand
 *  and the scene's lean agree whenever the geometry leaves a choice. */
const byAge = (a: BoardItemState, b: BoardItemState): number => a.id - b.id;

/**
 * The member of a complete cluster the hand should LIFT: one whose removal
 * leaves the rest a single flood, so the player sees a piece carried in from
 * the edge of the group, not the group broken in two and stitched back. The
 * farthest such member from the centre, for the longest and clearest gesture;
 * ties go to the oldest. A cluster of two has exactly one candidate.
 *
 * Any member dropped on the centre fuses — the flood is walked with the lifted
 * piece still counted on its cell — so this is a choice about what the gesture
 * LOOKS like, never about whether it works.
 */
function leafOf(board: RuleBoard, cluster: ReadyCluster): BoardItemState {
  const { members, centre } = cluster;
  const inCluster = new Set(members.map((m) => m.id));
  const holdsTogetherWithout = (gone: number): boolean => {
    const seen = new Set<number>([centre.id]);
    const queue: BoardItemState[] = [centre];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const pos of board.neighbors(current.col, current.row)) {
        const nearby = board.itemAt(pos.col, pos.row);
        if (!nearby || !inCluster.has(nearby.id) || nearby.id === gone || seen.has(nearby.id)) continue;
        seen.add(nearby.id);
        queue.push(nearby);
      }
    }
    return seen.size === members.length - 1;
  };
  const leaves = members
    .filter((m) => m.id !== centre.id && holdsTogetherWithout(m.id))
    .sort((a, b) => stepsApart(b, centre) - stepsApart(a, centre) || byAge(a, b));
  // Every finite connected group has a leaf that is not the centre; the
  // fallback is for a board the rule would never hand us, not a real branch.
  return leaves[0] ?? members.find((m) => m.id !== centre.id) ?? centre;
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
   *
   * MERGE HANDS ARE NEVER PINNED — and that is a decision, not an omission. A
   * pin protects the player from a hand that swaps pieces under their finger
   * when the RANKING re-sorts; a merge hand is not a ranking, it is a plan read
   * off the clusters (`aimMergeHand`), and the plan is SUPPOSED to change when
   * the board does. After a gather the piece the hand pointed at has been
   * seated beside its mate and the next gesture is a different one: the lone
   * piece onto the pair. A pinned `from` would go on asking for the piece that
   * just moved — dropped on the outsider, a member of the pair only gathers —
   * which is exactly the wrong-direction drop this planning exists to prevent.
   * What a pin bought is kept another way: every choice the plan makes is
   * deterministic (ties go to the oldest piece), and between two drops the
   * board does not change, so the hand holds still while the player acts.
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
    // The recipes the merge hand plans against — the SAME `ChainsData` the
    // MergeSystem decides with, or the hand could promise a drop the board
    // refuses. Defaults to the shipped file so the composition root needs no
    // change to keep working; `GameContext` should hand it `this.data.chains`
    // so a test that overrides the recipes sees the hand follow them.
    private chains: ChainsData = chainsJson as unknown as ChainsData,
    // Which platform-gated steps play here (see TutorialStepConfig.platform).
    // Defaults to the live device; tests hand in either value explicitly.
    private onMobile: boolean = IS_MOBILE
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
    // The mobile camera lesson: gated on the gesture it teaches — a hold-armed
    // pan that actually travelled (BoardScene announces it once per gesture).
    bus.on('camera:panned', () => this.onGateEvent('camera:panned'));
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
      // THE ID WINS OVER THE INDEX. A beat inserted into the main script (the
      // mobile `camera_hold`) slides every later index back one, and a beat
      // replayed that way RE-FIRES its effects — seventeen of them spawn
      // pieces, so the board would quietly gain a second set. The id says
      // which beat this save was actually ON; the index is only a hint about
      // where to find it. A save written before the id existed has none, and
      // falls through to the index exactly as it always did.
      this.resumeByStepId();
      // A save made on the other platform can rest ON a step this device never
      // plays — advance() lands it on the next step that runs here (and fires
      // that step's effects, which have not run yet).
      if (!this.stepRunsHere(this.currentStep)) {
        this.advance();
        return;
      }
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

  /**
   * Is the board the PLAYER'S — nothing scripted holding it?
   *
   * `tutorialDone` answered that only while `main` was the only script there
   * was. It is true for every mid-game lesson ever authored, so on its own it
   * now says "the main script is over" and nothing more; a lesson gating the
   * board with its own allow-list would read as done. Both halves, then.
   */
  isDone(): boolean {
    return this.state.tutorialDone && !this.activeScript;
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

  /**
   * Put `tutorialIndex` back on the beat the save NAMES, when it names one.
   *
   * Silent in every ordinary case: a save whose id already matches its index
   * (the overwhelming majority) changes nothing, and one whose id is not in
   * this build's script at all — a beat that was renamed or deleted since —
   * keeps the index, which is the best guess left.
   */
  private resumeByStepId(): void {
    const id = this.state.tutorialStepId;
    if (id === null) return;
    if (this.data.steps[this.state.tutorialIndex]?.id === id) return;
    const found = this.data.steps.findIndex((s) => s.id === id);
    if (found >= 0) this.state.tutorialIndex = found;
  }

  /** Does this step play on THIS device? A step authored for the other
   *  platform is passed through silently, keeping the index identical on every
   *  device so a save can cross platforms without desync. */
  private stepRunsHere(step: TutorialStepConfig | undefined): boolean {
    if (!step?.platform) return true;
    return (step.platform === 'mobile') === this.onMobile;
  }

  private advance(): void {
    const script = this.activeScript;
    if (!script) return;
    if (script.id === MAIN_SCRIPT_ID) {
      this.state.tutorialIndex++;
      // Pass through the other platform's steps WITHOUT running their effects
      // — the platform that plays them is the one their grants belong to.
      while (
        this.state.tutorialIndex < this.data.steps.length &&
        !this.stepRunsHere(this.data.steps[this.state.tutorialIndex])
      ) {
        this.state.tutorialIndex++;
      }
      if (this.state.tutorialIndex >= this.data.steps.length) {
        this.state.tutorialDone = true;
        this.emitDone();
        this.evaluateTriggers(); // a lesson waiting on "main done" may start now
        return;
      }
    } else {
      const keys = scriptStatKeys(script.id);
      this.state.addStat(keys.step, 1);
      while (
        this.state.stat(keys.step) < script.steps.length &&
        !this.stepRunsHere(script.steps[this.state.stat(keys.step)])
      ) {
        this.state.addStat(keys.step, 1);
      }
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
    // STAMP THE BEAT'S ID, so the resume has something an edit cannot move.
    // Only the MAIN script: every other one already keys its progress by
    // script id in `stats` and was never index-fragile.
    if (this.activeScript?.id === MAIN_SCRIPT_ID) this.state.tutorialStepId = step.id;
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
   *
   * This is also how a merge beat's SECOND gesture gets pointed at. A gather is
   * announced as an ordinary `item:moved` whose `to` is the seat beside the
   * mate, and the resolve it triggers re-plans the hand off the new clusters
   * (`aimMergeHand`, which pins nothing): the pair now exists, so the hand
   * turns to the lone piece and aims it at the pair.
   */
  private refreshMarkers(): void {
    const step = this.currentStep;
    // MARKERS ARE LIVE WHENEVER A BEAT IS ON SCREEN. This used to bail on
    // `tutorialDone`, which meant "no script is running" back when the main
    // script was the only one; it is TRUE for every mid-game lesson, so the
    // guard silenced exactly the scripts that need re-aiming most — the hand,
    // arrow and highlight froze on whatever `emitStep()` resolved on entry, and
    // an arrow whose piece then merged away was hidden by the UI and never came
    // back, leaving the beat gating with no pointer at all. `currentStep` is the
    // honest test: it is undefined precisely when no script holds the board, and
    // while `main` runs it says exactly what `!tutorialDone` said.
    if (!step) return;
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

  private resolveStep(step: TutorialStepConfig): TutorialStepEvent {
    /**
     * THE HAND IS RESOLVED FIRST, AND THAT ORDER IS THE WHOLE POINT.
     *
     * A merge beat says two things about the same pieces: the DIAMONDS say
     * "these ones", the HAND says "carry that one onto this one". They were
     * chosen by two selectors that never spoke to each other — the highlights
     * by `resolveRefItem`'s screen-depth ranking (with its shadow demotion),
     * the hand by `aimMergeHand`'s planner over `readyClusters`, which is
     * handed EVERY piece of the kind rather than the ranked three. With three
     * pieces on the board the two agree by luck. With a FOURTH — and a chest
     * gift of the same chain is enough — they part by construction, and the
     * beat lights up one set of pieces while the gauntlet lifts a piece
     * carrying no diamond at all. That is the "it shows me one and points at
     * the other" this order fixes.
     *
     * Planning first lets the hand CLAIM its two pieces in `pinned`, which is
     * the mechanism the ranking already respects ("never pin over a piece
     * another rank of the same step already claimed"). The highlights below
     * then resolve those ranks to the very pieces the hand is about, and any
     * remaining rank picks a third distinct piece as it always did.
     */
    let hand: ResolvedHand | null = null;
    if (step.hand) {
      if ('from' in step.hand) {
        // "Drag them together": both ends name one kind of piece, so the pair
        // is PLANNED off the clusters rather than read off the ranking — see
        // `aimMergeHand`. Null means the plan could not be made (too few pieces
        // on the board yet, a chain that cannot merge, or a plan the rule
        // contradicted), and the rank order below answers as it always did.
        const planned = sameKind(step.hand.from, step.hand.to)
          ? this.aimMergeHand(step, step.hand.from as PieceRef)
          : null;
        // The claim. Without it the ranking below is free to hand the same
        // ranks to different pieces.
        if (planned) {
          this.pinRef(step.hand.from, planned.from.id);
          this.pinRef(step.hand.to, planned.to.id);
        }
        const from = planned
          ? { col: planned.from.col, row: planned.from.row, item: planned.from.id }
          : this.resolveTileRef(step.hand.from);
        let to = planned
          ? { col: planned.to.col, row: planned.to.row, item: planned.to.id }
          : this.resolveTileRef(step.hand.to);
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
        if (from && to) hand = { from, to };
      } else {
        hand = step.hand;
      }
    }

    // Highlights stay CELLS: a glow is painted on the ground, and the board
    // repaints it whenever this view is re-emitted (which a move does). Read
    // AFTER the hand, so the ranks it claimed resolve to its own pieces.
    const highlight = (step.highlight ?? [])
      .map((ref) => this.resolveTileRef(ref))
      .filter((p): p is MarkerPoint => p !== null)
      .map((p): TilePos => ({ col: p.col, row: p.row }));

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
   * THE GESTURE THAT FINISHES A MERGE BEAT, read off the board as it stands.
   *
   * Three depths, and the hand shows the one the board is at:
   *
   *   depth 0 — a cluster already holds enough. Lift a LEAF of it and drop it
   *             on the cluster's CENTRE — the same centre `readyClusters` gives
   *             the scene, so the lean and the hand point at one piece.
   *   depth 1 — the largest cluster is one short. Bring the nearest piece
   *             outside it and drop it on the member nearest to it. The drop
   *             fuses: the outsider plus the target's flood reach the recipe.
   *   depth 2 — nothing is within one of the recipe. Take the outlier (the
   *             piece farthest from all the others) to the piece nearest it.
   *             That drop GATHERS — the pair forms — and the next `item:moved`
   *             re-aims this same plan at depth 1, so the second gesture is
   *             pointed at as plainly as the first.
   *
   * (A largest cluster of two or more that is still short by more than one —
   * a recipe of four or more, which nothing shipped has — is gathered onto the
   * way depth 1 is, rather than treated as scattered.)
   *
   * Every answer is CHECKED against what MergeSystem will really do, and the
   * plan moves on to its next candidate when the first one will not do it —
   * `verdictOnto` alone is only half the test for a gather. The system also
   * has to find the piece a SEAT, and a target boxed in on all four sides
   * gives it none: the drop bounces, the board is unchanged, so the identical
   * refused hand is computed again and pointed at again, forever. A hand the
   * player cannot obey is worse than no hand, and one that cannot be obeyed
   * TWICE is a dead beat.
   *
   * Only when no candidate at all is performable does it say so in the console
   * with the step named and yield null, so the caller falls back to rank order
   * and the beat still has a hand.
   *
   * Null without complaint when there is no plan to make: fewer than two
   * pieces on the board (the beat's spawns are still landing — this runs on
   * every `item:spawned`), or a kind that cannot merge at this tier.
   */
  private aimMergeHand(
    step: TutorialStepConfig,
    ref: PieceRef
  ): { from: BoardItemState; to: BoardItemState } | null {
    const pieces = this.piecesOfKind(ref);
    if (pieces.length < 2) return null;
    const recipe = recipeFor(this.chains, ref.chain, pieces[0]!.tier);
    if (!recipe.mergeable) return null;
    const board = this.state;

    /** Will MergeSystem actually perform this drop? A merge needs the verdict
     *  and nothing else; a gather needs the verdict AND a free seat (see the
     *  note above — a seatless gather bounces, and a bounce re-offers itself). */
    const performable = (from: BoardItemState, to: BoardItemState, expect: 'merge' | 'gather'): boolean => {
      const verdict = verdictOnto(board, this.chains, from, to).kind;
      if (verdict === 'merge') return true; // better than asked for, never worse
      if (expect === 'merge' || verdict === 'none') return false;
      return gatherSeat(board, from, to) !== null;
    };

    /** The first pair the rule will perform, walking the candidates in the
     *  order the depth wants them. Null — with the step named — only once every
     *  candidate has been refused, which is a board the hand genuinely cannot
     *  speak about rather than a mistake in one guess. */
    const firstPerformable = (
      froms: readonly BoardItemState[],
      targetsFor: (from: BoardItemState) => BoardItemState[],
      expect: 'merge' | 'gather'
    ): { from: BoardItemState; to: BoardItemState } | null => {
      // THE HAND MUST START ON A PIECE THE PLAYER CAN SEE. Depth grows with
      // col+row, so a piece with the House drawn in front of it is on the board
      // but not findable, and a lesson that points at what it hides teaches
      // nothing. Candidates keep their order within each half, so this only
      // ever chooses between drops the rule already performs — it never makes
      // a refused one legal.
      const clear = froms.filter((f) => !this.shadowed(f));
      const ordered =
        clear.length > 0 && clear.length < froms.length
          ? [...clear, ...froms.filter((f) => this.shadowed(f))]
          : froms;
      for (const from of ordered) {
        const to = targetsFor(from).find((t) => performable(from, t, expect));
        if (to) return { from, to };
      }
      const from = ordered[0];
      const to = from ? targetsFor(from)[0] : undefined;
      const said = from && to ? verdictOnto(board, this.chains, from, to).kind : 'nothing to try';
      console.error(
        `[tutorial] step '${step.id}': no ${expect} of ${ref.chain} the rule will perform ` +
          `(${froms.length} candidate${froms.length === 1 ? '' : 's'}; the first says ${said}); ` +
          `falling back to rank order`
      );
      return null;
    };

    // Depth 0: the board is only waiting for the gesture.
    const ready = readyClusters(board, this.chains, pieces)[0];
    if (ready) {
      const centre = ready.centre;
      const leaf = leafOf(board, ready);
      // The leaf leads — it is the member whose leaving cannot break the group
      // — but every other member is offered behind it, because the drop is
      // symmetric here: any member dropped on the centre finishes the set. That
      // is what lets a leaf standing behind the House hand the gesture on.
      const rest = ready.members.filter((m) => m.id !== centre.id && m.id !== leaf.id);
      return firstPerformable([leaf, ...rest], () => [centre], 'merge');
    }

    // The clusters, largest first; among equals the one holding the oldest
    // piece, so two lone tufts do not trade places as the target between one
    // resolve and the next.
    const claimed = new Set<number>();
    const clusters: BoardItemState[][] = [];
    for (const piece of [...pieces].sort(byAge)) {
      if (claimed.has(piece.id)) continue;
      const cluster = clusterOf(board, piece);
      for (const member of cluster) claimed.add(member.id);
      clusters.push(cluster);
    }
    clusters.sort((a, b) => b.length - a.length || byAge(a[0]!, b[0]!));
    const largest = clusters[0]!;
    const inside = new Set(largest.map((m) => m.id));
    const outside = pieces.filter((p) => !inside.has(p.id));
    if (outside.length === 0) return null; // everything is in one group and it is still short

    const oneShort = largest.length >= recipe.need - 1;
    if (oneShort || largest.length >= 2) {
      // Depth 1 (or a bigger recipe's gather onto the group that has begun).
      // Nearest piece first, nearest member of the group first — and on to the
      // next of each when the rule refuses the pair.
      const toCluster = (p: BoardItemState): number => Math.min(...largest.map((m) => stepsApart(p, m)));
      return firstPerformable(
        [...outside].sort((a, b) => toCluster(a) - toCluster(b) || byAge(a, b)),
        (from) => [...largest].sort((a, b) => stepsApart(a, from) - stepsApart(b, from) || byAge(a, b)),
        oneShort ? 'merge' : 'gather'
      );
    }

    // Depth 2: all of them alone. The outlier travels; the pair forms where
    // the rest already are — unless that one is walled in, in which case the
    // next-nearest piece is just as good a place for the pair to form.
    const spread = (p: BoardItemState): number => pieces.reduce((sum, q) => sum + stepsApart(p, q), 0);
    return firstPerformable(
      [...pieces].sort((a, b) => spread(b) - spread(a) || byAge(a, b)),
      (from) =>
        pieces
          .filter((p) => p.id !== from.id)
          .sort((a, b) => stepsApart(a, from) - stepsApart(b, from) || byAge(a, b)),
      'gather'
    );
  }

  /**
   * The pieces a merge hand's ref can mean: the chain's, at the ref's tier. A
   * ref with NO tier (the ruby and egg beats are written that way) takes the
   * tier with the most pieces on the board — ties to the lowest, which is the
   * one that merges first — because a cluster is one tier by definition and a
   * plan across two tiers is not a plan.
   */
  private piecesOfKind(ref: PieceRef): BoardItemState[] {
    const ofChain = [...this.state.items.values()].filter(
      (i) => i.kind === 'item' && i.chain === ref.chain && (ref.tier === undefined || i.tier === ref.tier)
    );
    if (ref.tier !== undefined || ofChain.length === 0) return ofChain;
    const count = new Map<number, number>();
    for (const piece of ofChain) count.set(piece.tier, (count.get(piece.tier) ?? 0) + 1);
    const tier = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
    return ofChain.filter((i) => i.tier === tier);
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
      // Any piece in front hides it — a House or a dragon more than most.
      if (front && front.id !== item.id) return true;
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
  /**
   * Claim a piece for a `{chain, nth}` ref, under the SAME key
   * `resolveRefItem` builds — so every later reader of this beat resolves that
   * rank to this piece and no other. A cell or `last_hatched` ref names its
   * piece outright and has nothing to claim.
   */
  private pinRef(ref: TileRef, id: number): void {
    if (Array.isArray(ref) || typeof ref === 'string') return;
    this.pinned.set(`${ref.chain}:${ref.tier ?? '*'}:${ref.nth}`, id);
  }

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
