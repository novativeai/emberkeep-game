import { describe, expect, it } from 'vitest';
import tutorial from '../../src/data/tutorial.json';
import authoredMap from '../../src/data/map.json';
import { GameContext } from '../../src/core/Context';
import { EventBus } from '../../src/core/EventBus';
import { GameClock } from '../../src/core/GameClock';
import { GameState } from '../../src/core/GameState';
import { verdictOnto } from '../../src/core/mergeRule';
import { buildWorlds, zoneAt } from '../../src/core/world';
import { TutorialDirector } from '../../src/systems/TutorialDirector';
import chainsJson from '../../src/data/chains.json';
import map8x8 from '../fixtures/map-8x8.json';
import type { ChainsData, MapData, MarkerPoint, TutorialAllow, TutorialStepConfig, TutorialData } from '../../src/core/types';
import { capture, createTestContext, drag, MemoryStorage } from './helpers';

/** The tutorial's own beats name cells of the AUTHORED isle, so a beat that is
 *  about a particular tile has to be driven against that map, not the 8x8. */
const onAuthoredIsle = (): GameContext =>
  new GameContext(new MemoryStorage(), { map: authoredMap as unknown as MapData });

const steps = tutorial.steps as unknown as TutorialStepConfig[];

/**
 * The verb each event gate needs in its OWN step's allow-list. A gate whose
 * verb is not allowed is an unwinnable step — the player is asked for an action
 * the tutorial is simultaneously refusing, with no way out but a reinstall.
 * (tutorial-design law 5; the skill's ftuecheck.py checks the same table, this
 * keeps it in CI.)
 */
const GATE_REQUIRES: Record<string, Array<keyof TutorialAllow>> = {
  'item:merged': ['drag'],
  'item:hatched': ['drag'],
  'item:harvested': ['tapGenerators'],
  'chest:open': ['tapGenerators'],
  'generator:skipped': ['tapGenerators'],
  'dragon:working': ['dragonWork', 'drag'],
  'region:unlocked': ['fog'],
  'marketplace:purchased': ['marketplace'],
  'ui:cookbook_opened': ['cookbook'],
  'ui:cookbook_closed': ['cookbook'],
  'ui:ledger_opened': ['ledger'],
  'order:completed': ['ledger', 'deliver'],
  'bag:stored': ['bag'],
  // Selling lives in the Bag, so a sale needs the satchel open AND the verb on.
  'item:sold': ['bag', 'sell'],
  'character:action_used': ['character'],
  // A beat waiting for the next page of the Codex needs the book HELD open:
  // Phaser delivers the bubble's tap to the panel's scrim too, so an unheld
  // book shuts under the very step that is waiting on it.
  'ui:codex_dragon_opened': ['codexHold'],
  'ui:codex_evolution_opened': ['codexHold']
};

const stepAt = (id: string): number => steps.findIndex((s) => s.id === id);

describe('the tutorial script (no unwinnable step)', () => {
  it('allows the verb every event gate demands', () => {
    const broken: string[] = [];
    for (const step of steps) {
      if (step.gate.type !== 'event') continue;
      const allow = (step.allow ?? {}) as TutorialAllow;
      for (const need of GATE_REQUIRES[step.gate.event] ?? []) {
        if (need === 'drag') {
          const wanted = step.gate.chain;
          const got = allow.drag ?? [];
          if (!got.length) broken.push(`${step.id}: gate needs drag, allow.drag is empty`);
          else if (wanted && !got.includes('*') && !got.includes(wanted)) {
            broken.push(`${step.id}: gate wants '${wanted}' but allow.drag is [${got}]`);
          }
        } else if (!allow[need]) {
          broken.push(`${step.id}: gate '${step.gate.event}' needs allow.${need}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('teaches every concept the ledger claims, in the order it claims', () => {
    // The satchel and selling must be taught only once the pieces they use are
    // revealed AND nothing scripted still needs them — pocketing one of the three
    // Bushes before `bush_merge` would strand that gate forever.
    expect(stepAt('pocket_it')).toBeGreaterThan(stepAt('bush_merge'));
    expect(stepAt('sell_it')).toBeGreaterThan(stepAt('pocket_it'));
    // The Ledger arc needs a shard source, so it follows the Green Dragon.
    expect(stepAt('gem_harvest')).toBeGreaterThan(stepAt('green_dragon_hatch'));
    expect(stepAt('ledger_open')).toBeGreaterThan(stepAt('gem_harvest'));
    expect(stepAt('ledger_deliver')).toBeGreaterThan(stepAt('ledger_open'));
    // Her tease pays off the order she was just delivered.
    expect(stepAt('golden_tease')).toBeGreaterThan(stepAt('ledger_deliver'));
  });

  it('pays no order XP before the scripted level-up beat', () => {
    // LEVEL_XP[1] is 60 and the scripted merges deliver exactly that by
    // `levelup`. An order delivered earlier (+30) fires Level 2 off its beat.
    const deliver = stepAt('ledger_deliver');
    expect(deliver).toBeGreaterThan(stepAt('levelup'));
  });

  it('keeps every bubble inside the 180-character budget', () => {
    const over = steps.filter((s) => s.text.length > 180).map((s) => `${s.id} (${s.text.length})`);
    expect(over).toEqual([]);
  });

  /**
   * A TWO-PART STEP HAS TO HAVE BOTH PARTS.
   *
   * `arrowThen` is the marker for the second half of "tap me, then tap the
   * House": it is placed when the character is armed and the first arrow comes
   * back if she is put away again. Both halves are therefore load-bearing — a
   * step that names the second without the first has nothing to point at until
   * the player guesses the gesture, which is the failure this pins.
   *
   * `allow.character` too: the second half cannot be reached without arming
   * her, and a step that forbids the tap that arms her is unwinnable.
   */
  it('gives every arrowThen step its first arrow and the tap that arms her', () => {
    const twoPart = steps.filter((s) => s.arrowThen);
    expect(twoPart.map((s) => s.id)).toContain('eleanor_helps');
    for (const step of twoPart) {
      expect(step.arrow, `${step.id} has arrowThen but no arrow`).toBeDefined();
      expect(step.allow?.character, `${step.id} cannot arm her`).toBe(true);
    }
  });
});

describe('TutorialDirector (the new gates advance)', () => {
  it('advances a bag:stored gate only for the chain it names', () => {
    const ctx = createTestContext();
    const index = stepAt('pocket_it');
    ctx.state.tutorialIndex = index;

    ctx.bus.emit('bag:stored', { chain: 'lumber', tier: 1, at: { col: 0, row: 0 } });
    expect(ctx.state.tutorialIndex).toBe(index); // wrong chain — still waiting

    ctx.bus.emit('bag:stored', { chain: 'cinder_vein', tier: 1, at: { col: 0, row: 0 } });
    expect(ctx.state.tutorialIndex).toBe(index + 1);
  });

  it('advances the sell gate on item:sold', () => {
    const ctx = createTestContext();
    const index = stepAt('sell_it');
    ctx.state.tutorialIndex = index;

    ctx.bus.emit('item:sold', { chain: 'cinder_vein', tier: 1, coins: 3 });
    expect(ctx.state.tutorialIndex).toBe(index + 1);
  });

  it("advances Eleanor's beat when her help is actually used", () => {
    const ctx = createTestContext();
    const index = stepAt('eleanor_helps');
    ctx.state.tutorialIndex = index;

    ctx.bus.emit('character:action_used', {
      characterId: 'eleanor',
      action: 'give_back',
      readyAt: 1
    });
    expect(ctx.state.tutorialIndex).toBe(index + 1);
  });

  it('emits an allow-list carrying the new verbs', () => {
    const ctx = createTestContext();
    const emitted = capture(ctx.bus, 'tutorial:step');
    ctx.state.tutorialIndex = stepAt('pocket_it');
    ctx.systems.tutorial.begin();

    const step = emitted.at(-1)!;
    expect(step.id).toBe('pocket_it');
    expect(step.allow.bag).toBe(true);
    expect(step.allow.character).toBe(false);
    expect(step.allow.sell).toBe(false); // one verb per beat
  });
});

/**
 * The Codex lesson is a WALK through the book — roster card, the taste row,
 * Evolution, then the ✕ — and every beat of it is gated on a page turning.
 * Three things have to hold or the player is locked inside a panel: the pages
 * advance the script, the book is held open until the beat that teaches
 * closing, and a reload knows which spread its bubble is talking about.
 */
describe('the Codex lesson walks the book', () => {
  const LESSON = ['codex_meal', 'codex_taste', 'codex_evolution', 'codex_cycles', 'codex_reward', 'codex_shut'];

  it('turns page by page, and only on the page each beat is waiting for', () => {
    const ctx = createTestContext();
    ctx.state.tutorialIndex = stepAt('codex_meal');

    // The book opens on the roster: that is the page the beat STARTS on, so it
    // must not also be the page that ends it.
    ctx.bus.emit('ui:codex_page', { page: 'roster' });
    expect(ctx.state.tutorialIndex).toBe(stepAt('codex_meal'));

    ctx.bus.emit('ui:codex_page', { page: 'detail' });
    expect(ctx.state.tutorialIndex).toBe(stepAt('codex_taste'));
    // Reading the page is not opening Evolution.
    ctx.bus.emit('ui:codex_page', { page: 'detail' });
    expect(ctx.state.tutorialIndex).toBe(stepAt('codex_taste'));

    ctx.bus.emit('ui:codex_page', { page: 'evolution' });
    expect(ctx.state.tutorialIndex).toBe(stepAt('codex_evolution'));

    // Three tap-gated bubbles: what the shadow is, how cycles bank, the payoff.
    for (const id of ['codex_evolution', 'codex_cycles', 'codex_reward']) {
      ctx.bus.emit('tutorial:advance_requested', { stepId: id });
    }
    expect(ctx.state.tutorialIndex).toBe(stepAt('codex_shut'));

    ctx.bus.emit('ui:codex_toggled', { open: false });
    expect(ctx.state.tutorialIndex).toBe(stepAt('codex_shut') + 1);
  });

  it('holds the book open for every beat but the one that closes it', () => {
    for (const id of LESSON) {
      const step = steps[stepAt(id)]!;
      const held = (step.allow ?? {}).codexHold === true;
      // `codex_shut` teaches the ✕ — holding it there would be a beat asking
      // for an action the panel is simultaneously refusing (law 3).
      expect(held, `${id} hold`).toBe(id !== 'codex_shut');
    }
  });

  it('names the page each beat stands on, so a reload comes back to it', () => {
    // `openCodex` is replayed on resume (it opens a panel and leaves nothing in
    // the save). Each beat's page must be the one BEFORE its own gate, or the
    // replay would satisfy the step it just restored.
    const pageOf = (id: string): string | undefined => {
      const effects = (steps[stepAt(id)]!.effects ?? []) as Array<{ openCodex?: { page?: string } }>;
      return effects.find((e) => e.openCodex)?.openCodex?.page;
    };
    expect(pageOf('codex_meal')).toBe('roster');
    expect(pageOf('codex_taste')).toBe('detail');
    for (const id of ['codex_evolution', 'codex_cycles', 'codex_reward', 'codex_shut']) {
      expect(pageOf(id), `${id} page`).toBe('evolution');
    }
  });

  it('re-opens the book on resume — a gate on a panel that is not there is a dead save', () => {
    const ctx = createTestContext();
    const asked = capture(ctx.bus, 'ui:codex_open_requested');
    ctx.state.tutorialIndex = stepAt('codex_cycles');
    ctx.systems.tutorial.begin();
    expect(asked).toEqual([{ page: 'evolution' }]);
  });
});

/**
 * THE POINTER FOLLOWS THE PIECE.
 *
 * A beat that says "merge those three" points at pieces the player is free to
 * pick up, and the hand used to be aimed at CELLS resolved once when the beat
 * opened. Move one of the tufts and the hand went on hovering over the tile it
 * had left — an instruction that is not merely stale but WRONG, since the thing
 * it names is no longer there.
 *
 * Two properties, and they are different: the pointer must re-aim when the
 * board changes, and it must re-aim at the SAME PIECE. The refs name a rank
 * ("the third Ash Moss") and rank is read positionally, so without pinning a
 * drag re-sorts the set and the hand jumps to a different tuft — which looks
 * like following, and is not.
 */
describe('the tutorial pointer tracks live pieces', () => {
  /** The first beat whose hand names two pieces: "three tufts make a bundle". */
  const MERGE_BEAT = 'ash_green';

  /** The beat's own spawn effect belongs to the step before it, so the fixture
   *  seeds the three tufts the way that step would have. */
  const openMergeBeat = (): ReturnType<typeof createTestContext> => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'ashmoss', tier: 1, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'ashmoss', tier: 1, col: 2, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'ashmoss', tier: 1, col: 5, row: 4, kind: 'item' });
    ctx.state.tutorialIndex = stepAt(MERGE_BEAT);
    ctx.systems.tutorial.begin();
    return ctx;
  };

  /** Re-open the beat with a listener attached, so the emitted view is visible. */
  const handOf = (
    ctx: ReturnType<typeof createTestContext>
  ): { from: MarkerPoint; to: MarkerPoint } => {
    const seen = capture(ctx.bus, 'tutorial:step');
    ctx.systems.tutorial.begin();
    return seen.at(-1)!.hand as { from: MarkerPoint; to: MarkerPoint };
  };

  it('names a hand made of two different pieces', () => {
    const ctx = openMergeBeat();
    const hand = handOf(ctx);
    expect(hand).toBeTruthy();
    expect(hand.from).not.toEqual(hand.to);
  });

  it('re-aims when the piece it points at is dragged away', () => {
    const ctx = openMergeBeat();
    const before = handOf(ctx);

    const moved = capture(ctx.bus, 'tutorial:markers');
    // Pick up the piece the hand is asking for and put it somewhere else.
    // Anywhere free that does not TOUCH the pair: a drop on free ground is
    // only ever a move now (the magnet is gone), but landing adjacent would
    // complete the cluster and turn the hand into the finish-it gesture — a
    // different (and also correct) answer, not the one under test.
    const itemId = ctx.state.itemIdAt(before.from.col, before.from.row)!;
    const free = { col: 5, row: 5 };
    ctx.bus.emit('drag:dropped', { itemId, from: before.from, to: free });

    // The hand followed the piece rather than staying on the tile it left.
    const after = moved.at(-1)?.hand as { from: MarkerPoint; to: MarkerPoint } | undefined;
    expect(after, 'the pointer was never re-aimed').toBeTruthy();
    // `toMatchObject`, not `toEqual`: the end also carries the id of the piece
    // it is following now (see MarkerPoint), and that id is the point.
    expect(after!.from).toMatchObject(free);
    expect(after!.from.item).toBe(itemId);
  });

  it('says nothing when a move changes no answer', () => {
    const ctx = openMergeBeat();
    const seen = capture(ctx.bus, 'tutorial:markers');
    // A move on a piece no marker names must not restart the hand's animation.
    const other = [...ctx.state.items.values()].find(
      (i) => i.kind === 'item' && i.chain !== 'ashmoss'
    );
    if (other) {
      const free = (() => {
        for (let col = 7; col >= 0; col--) {
          for (let row = 7; row >= 0; row--) {
            if (ctx.state.isTileActive(col, row) && ctx.state.itemIdAt(col, row) === null) {
              return { col, row };
            }
          }
        }
        return null;
      })();
      if (free) {
        ctx.bus.emit('drag:dropped', {
          itemId: other.id,
          from: { col: other.col, row: other.row },
          to: free
        });
      }
    }
    expect(seen.length).toBe(0);
  });
});

/**
 * THE HAND DEMONSTRATES A DROP THE BOARD WILL HONOUR.
 *
 * A merge beat's refs name ranks, and rank knows nothing about clusters — so
 * "the first Ash Moss" could be the LONE tuft, and under the drop rule the
 * direction matters: the outsider dropped ON the pair merges, a member of the
 * pair dropped on the outsider only gathers. A hand resolved by rank could
 * demonstrate the second gesture, the gate would sit waiting for `item:merged`,
 * and nothing on screen would say a further drop was wanted.
 *
 * So a hand whose two ends name the same kind of piece is planned off the
 * clusters and checked against `verdictOnto` — the very predicate MergeSystem
 * runs on the drop. These tests hold the plan to that promise at each depth:
 * one drop from done, two drops from done, and already complete.
 */
describe('the merge hand is planned off the clusters', () => {
  const openWith = (spots: Array<[number, number]>): GameContext => {
    const ctx = createTestContext();
    for (const [col, row] of spots) {
      ctx.state.addItem({ chain: 'ashmoss', tier: 1, col, row, kind: 'item' });
    }
    ctx.state.tutorialIndex = stepAt('ash_green');
    return ctx;
  };

  type DragHand = { from: MarkerPoint; to: MarkerPoint };
  const handOf = (ctx: GameContext): DragHand => {
    const seen = capture(ctx.bus, 'tutorial:step');
    ctx.systems.tutorial.begin();
    return seen.at(-1)!.hand as DragHand;
  };
  /** What the board would DO with the drop the hand is demonstrating. */
  const verdict = (ctx: GameContext, hand: DragHand): string =>
    verdictOnto(
      ctx.state,
      ctx.data.chains,
      ctx.state.items.get(hand.from.item!)!,
      ctx.state.items.get(hand.to.item!)!
    ).kind;

  it('aims the lone piece AT the pair, and the rule calls that drop a merge', () => {
    const ctx = openWith([[1, 1], [2, 1], [5, 4]]);
    const hand = handOf(ctx);

    // The outsider is what travels; either member of the pair is the target.
    expect(hand.from.item).toBe(ctx.state.itemAt(5, 4)!.id);
    expect([ctx.state.itemAt(1, 1)!.id, ctx.state.itemAt(2, 1)!.id]).toContain(hand.to.item);
    expect(verdict(ctx, hand)).toBe('merge');
  });

  it('shows the gather first when all three stand apart, then the merge once the pair exists', () => {
    const ctx = openWith([[1, 1], [3, 3], [5, 4]]);
    const first = handOf(ctx);

    // Nothing touches anything: the demonstrated drop can only PREPARE the
    // merge. The target is a piece, not ground, and the rule calls it a gather.
    expect(first.to.item).toBeDefined();
    expect(verdict(ctx, first)).toBe('gather');

    // Answer the hand through the REAL system: the piece is seated beside its
    // mate, announced as an ordinary item:moved, and the beat does not end.
    const merges = capture(ctx.bus, 'item:merged');
    const markers = capture(ctx.bus, 'tutorial:markers');
    drag(ctx, [first.from.col, first.from.row], [first.to.col, first.to.row]);
    expect(merges).toHaveLength(0);
    expect(ctx.state.tutorialIndex).toBe(stepAt('ash_green'));

    // The plan changed with the board: the hand turned to the piece still
    // alone and now demonstrates the drop that fuses.
    const second = markers.at(-1)?.hand as DragHand | undefined;
    expect(second, 'the hand was never re-aimed after the gather').toBeTruthy();
    expect(second!.from.item).toBe(ctx.state.itemAt(5, 4)!.id);
    expect(verdict(ctx, second!)).toBe('merge');
  });

  it('never points at a piece the board would refuse to seat beside — a walled-in target is skipped', () => {
    // (3,3) is the nearest tuft to (1,1), and it is boxed in on all four sides.
    // `verdictOnto` still calls a drop onto it a gather; MergeSystem then finds
    // no seat and BOUNCES — and because a bounce leaves the board untouched,
    // the same refused hand would be planned again on the next resolve, and
    // again, with the beat unfinishable. The hand has to try the next target.
    const ctx = openWith([[1, 1], [3, 3], [5, 5]]);
    for (const [col, row] of [[2, 3], [4, 3], [3, 2], [3, 4]] as const) {
      ctx.state.addItem({ chain: 'flame_gem', tier: 1, col, row, kind: 'item' });
    }
    const hand = handOf(ctx);
    expect(hand.to.item).not.toBe(ctx.state.itemAt(3, 3)!.id);

    // And the demonstrated drop really is one the player can perform.
    const bounces = capture(ctx.bus, 'item:move_bounced');
    const moves = capture(ctx.bus, 'item:moved');
    drag(ctx, [hand.from.col, hand.from.row], [hand.to.col, hand.to.row]);
    expect(bounces).toHaveLength(0);
    expect(moves).toHaveLength(1);
  });

  it('aims a LEAF of a complete row at its centre, where the lean already points', () => {
    const ctx = openWith([[1, 1], [2, 1], [3, 1]]);
    const hand = handOf(ctx);

    // The centre is the best-connected member (readyClusters' own answer), so
    // the hand and the scene's lean name one piece. What travels is an END —
    // lifting the middle would show the group broken in two and stitched back.
    expect(hand.to.item).toBe(ctx.state.itemAt(2, 1)!.id);
    expect([ctx.state.itemAt(1, 1)!.id, ctx.state.itemAt(3, 1)!.id]).toContain(hand.from.item);
    expect(verdict(ctx, hand)).toBe('merge');
  });
});

/**
 * THE SHOWN GESTURE AND THE ASKED GESTURE ARE ONE GESTURE.
 *
 * The board-hygiene beat animates a hand from the Emberbark Stump to a cell
 * beside Eleanor and then accepted a drop anywhere on the new field — so the
 * player could be shown "just out here, beside me" and answer it from the far
 * corner of the slab. `gate.at` closes that, and these two halves are what keep
 * it closed: the data half (the cell is real, free and the one the hand points
 * at) and the behaviour half (the field alone no longer answers).
 */
describe('a move beat that names its cell', () => {
  const moveSteps = steps.filter(
    (s): s is TutorialStepConfig & { gate: { type: 'move'; region?: string; at?: [number, number] } } =>
      s.gate.type === 'move'
  );

  it('points its hand at the very cell it asks for, on real open ground', () => {
    const map = authoredMap as unknown as MapData;
    // The WORLD's playable set, not map.json's: the seat is on one of the small
    // islands, which live in zones.json and never in the authored list. Asking
    // the authored list would call every island "not ground".
    const world = buildWorlds(map).get('emberkeep')!;
    for (const step of moveSteps) {
      const at = step.gate.at;
      if (!at) continue;
      const key = `${at[0]},${at[1]}`;
      // Real ground, or the drop it demands cannot happen at all.
      expect(world.playable.has(key)).toBe(true);
      const owner = map.regions.find((r) => r.tiles.some(([c, r2]) => c === at[0] && r2 === at[1]));
      if (step.gate.region) {
        // A gate that names a field asks for a cell IN that field.
        expect(owner?.id).toBe(step.gate.region);
      }
      // Not a cell a region's own contents drop onto when it opens: the beat
      // would then ask for a seat the map itself had already taken.
      expect((owner?.contents ?? []).some((c) => c.at[0] === at[0] && c.at[1] === at[1])).toBe(false);
      // Not a cell anything is seeded on at the start, either.
      expect((map.startingItems ?? []).some((p) => p.at[0] === at[0] && p.at[1] === at[1])).toBe(false);
      // And the same cell the hand flies to. Two numbers that must agree is the
      // whole defect this gate exists to fix, so they are checked, not trusted.
      const hand = step.hand;
      expect(hand && 'to' in hand ? hand.to : undefined).toEqual(at);
    }
  });

  it('sends the stump to the lava-well isle — the ZONE, not merely the address', () => {
    // A zone's (col,row) block is assigned by build-zones in id order, so
    // allocating cells to an older, still-empty grid renumbers every zone after
    // it. The address [29,0] would then still be playable — on a different
    // island. The zone id is the thing that does not move, so it is what the
    // lesson's seat is pinned to: g1785784158634 is the 2x1 ledge at the LEFT
    // of the lava well, east of the Ember Gate (Grille 21 in the editor) — the
    // owner placed the stump there by hand and asked for exactly that spot.
    const world = buildWorlds(authoredMap as unknown as MapData).get('emberkeep')!;
    const at = (steps[stepAt('board_room')]!.gate as { at: [number, number] }).at;
    expect(zoneAt(world, at[0], at[1])?.id).toBe('g1785784158634');
  });

  it('is not answered by the next tile over, and is answered by its own cell', () => {
    const ctx = onAuthoredIsle();
    const idx = stepAt('board_room');
    ctx.state.tutorialIndex = idx;
    const at = (steps[idx]!.gate as { at: [number, number] }).at;
    const stump = ctx.state.addItem({ chain: 'emberbark', tier: 1, col: 7, row: 3, kind: 'item' });
    const from = { col: 7, row: 3 };

    // The same island, one tile over: close, and not the lesson.
    const near = { col: at[0] + 1, row: at[1] };
    ctx.bus.emit('item:moved', { itemId: stump.id, from, to: near });
    expect(ctx.state.tutorialIndex).toBe(idx);

    ctx.bus.emit('item:moved', { itemId: stump.id, from, to: { col: at[0], row: at[1] } });
    // node is a "desktop" — the mobile-only camera_hold beat right after
    // board_room is passed through, landing on emberberry_tap.
    expect(steps[ctx.state.tutorialIndex]!.id).toBe('emberberry_tap');
  });

  it('accepts the drop anyway when its cell is under someone else', () => {
    // A beat whose one answer is occupied is a dead save — and during this
    // lesson only the stump may be dragged, so the player could not clear it.
    const ctx = onAuthoredIsle();
    const idx = stepAt('board_room');
    ctx.state.tutorialIndex = idx;
    const at = (steps[idx]!.gate as { at: [number, number] }).at;
    ctx.state.addItem({ chain: 'lumber', tier: 1, col: at[0], row: at[1], kind: 'item' });
    const stump = ctx.state.addItem({ chain: 'emberbark', tier: 1, col: 7, row: 3, kind: 'item' });

    ctx.bus.emit('item:moved', {
      itemId: stump.id,
      from: { col: 7, row: 3 },
      to: { col: at[0] + 1, row: at[1] }
    });
    expect(steps[ctx.state.tutorialIndex]!.id).toBe('emberberry_tap');
  });
});

describe('platform-gated steps (camera_hold is mobile-only)', () => {
  const tiny = {
    steps: [
      { id: 'a', speaker: 'eleanor', text: '', gate: { type: 'tap' } },
      { id: 'b', speaker: 'eleanor', text: '', gate: { type: 'event', event: 'camera:panned' }, platform: 'mobile' },
      { id: 'c', speaker: 'eleanor', text: '', gate: { type: 'tap' } }
    ]
  } as unknown as TutorialData;

  const rig = (onMobile: boolean, index = 0) => {
    const state = new GameState(map8x8 as unknown as MapData);
    state.tutorialIndex = index;
    const bus = new EventBus();
    const director = new TutorialDirector(state, bus, new GameClock(), tiny, chainsJson as unknown as ChainsData, onMobile);
    director.begin();
    return { state, bus, director };
  };

  it('the shipped script carries it, right after board_room', () => {
    const step = steps[stepAt('board_room') + 1]!;
    expect(step.id).toBe('camera_hold');
    expect(step.platform).toBe('mobile');
    expect(step.gate).toEqual({ type: 'event', event: 'camera:panned' });
  });

  it('desktop passes straight through it, without running it', () => {
    const { state, bus } = rig(false);
    bus.emit('tutorial:advance_requested', { stepId: 'a' });
    expect(state.tutorialIndex).toBe(2); // a → c, b never emitted
  });

  it('mobile plays it, and the pan gesture is its gate', () => {
    const { state, bus } = rig(true);
    bus.emit('tutorial:advance_requested', { stepId: 'a' });
    expect(state.tutorialIndex).toBe(1);
    bus.emit('camera:panned', {});
    expect(state.tutorialIndex).toBe(2);
  });

  it('a save resting on the other platform\'s step resumes past it', () => {
    // Saved on the phone mid-lesson, opened on a desktop: begin() advances.
    const { state } = rig(false, 1);
    expect(state.tutorialIndex).toBe(2);
  });

  it('skipping the LAST step still finishes the script', () => {
    const tail = {
      steps: [
        { id: 'a', speaker: 'eleanor', text: '', gate: { type: 'tap' } },
        { id: 'b', speaker: 'eleanor', text: '', gate: { type: 'event', event: 'camera:panned' }, platform: 'mobile' }
      ]
    } as unknown as TutorialData;
    const state = new GameState(map8x8 as unknown as MapData);
    const bus = new EventBus();
    new TutorialDirector(state, bus, new GameClock(), tail, chainsJson as unknown as ChainsData, false).begin();
    bus.emit('tutorial:advance_requested', { stepId: 'a' });
    expect(state.tutorialDone).toBe(true);
  });
});
