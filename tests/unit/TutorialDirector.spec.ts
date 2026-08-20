import { describe, expect, it } from 'vitest';
import tutorial from '../../src/data/tutorial.json';
import authoredMap from '../../src/data/map.json';
import { GameContext } from '../../src/core/Context';
import type { MapData, MarkerPoint, TutorialAllow, TutorialStepConfig } from '../../src/core/types';
import { capture, createTestContext, MemoryStorage } from './helpers';

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
    const itemId = ctx.state.itemIdAt(before.from.col, before.from.row)!;
    // Free ground WELL CLEAR of the other two tufts: land it beside them and
    // the magnet completes the merge, which ends the beat instead of re-aiming
    // it — a different (and also correct) outcome, but not the one under test.
    const others = [...ctx.state.items.values()].filter(
      (i) => i.chain === 'ashmoss' && i.id !== ctx.state.itemIdAt(before.from.col, before.from.row)
    );
    const free = (() => {
      for (let col = 0; col < 8; col++) {
        for (let row = 0; row < 8; row++) {
          if (!ctx.state.isTileActive(col, row) || ctx.state.itemIdAt(col, row) !== null) continue;
          // > 3, not > 2: the magnet searches two rings out from the drop and
          // fuses from a cell adjacent to the pair, so three tiles away still
          // merges. Four is the first distance that is genuinely "elsewhere".
          const clear = others.every(
            (o) => Math.max(Math.abs(o.col - col), Math.abs(o.row - row)) > 3
          );
          if (clear) return { col, row };
        }
      }
      throw new Error('the fixture board has no free cell clear of the pair');
    })();
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
    (s): s is TutorialStepConfig & { gate: { type: 'move'; region: string; at?: [number, number] } } =>
      s.gate.type === 'move'
  );

  it('points its hand at the very cell it asks for, inside the region, on free ground', () => {
    const map = authoredMap as unknown as MapData;
    const playable = new Set((map.playable ?? []).map(([c, r]) => `${c},${r}`));
    for (const step of moveSteps) {
      const at = step.gate.at;
      if (!at) continue;
      const key = `${at[0]},${at[1]}`;
      const region = map.regions.find((r) => r.id === step.gate.region)!;
      // In the field it belongs to — the lesson is still "out onto the new land".
      expect(region.tiles.some(([c, r]) => c === at[0] && r === at[1])).toBe(true);
      // Real ground, or the drop it demands cannot happen at all.
      expect(playable.has(key)).toBe(true);
      // Not a cell the region's own contents are dropped onto when it opens:
      // the beat would then ask for a seat the map itself had already taken.
      expect((region.contents ?? []).some((c) => c.at[0] === at[0] && c.at[1] === at[1])).toBe(false);
      // And the same cell the hand flies to. Two numbers that must agree is the
      // whole defect this gate exists to fix, so they are checked, not trusted.
      const hand = step.hand;
      expect(hand && 'to' in hand ? hand.to : undefined).toEqual(at);
    }
  });

  it('is not answered by the rest of the field, and is answered by its own cell', () => {
    const ctx = onAuthoredIsle();
    const idx = stepAt('board_room');
    ctx.state.tutorialIndex = idx;
    const at = (steps[idx]!.gate as { at: [number, number] }).at;
    const stump = ctx.state.addItem({ chain: 'emberbark', tier: 1, col: 7, row: 3, kind: 'item' });
    const from = { col: 7, row: 3 };

    // Same region, wrong tile — and deliberately the tile NEAREST Eleanor, the
    // one a player who misreads "out onto the field" would reach for first.
    const near = { col: 6, row: 2 };
    expect(near).not.toEqual({ col: at[0], row: at[1] });
    ctx.bus.emit('item:moved', { itemId: stump.id, from, to: near });
    expect(ctx.state.tutorialIndex).toBe(idx);

    ctx.bus.emit('item:moved', { itemId: stump.id, from, to: { col: at[0], row: at[1] } });
    expect(ctx.state.tutorialIndex).toBe(idx + 1);
  });

  it('falls back to the field when its cell is under someone else', () => {
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
      to: { col: 6, row: 2 }
    });
    expect(ctx.state.tutorialIndex).toBe(idx + 1);
  });
});
