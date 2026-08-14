import { describe, expect, it } from 'vitest';
import type { GameContext } from '../../src/core/Context';
import type { TilePos, TutorialAllow } from '../../src/core/types';
import { capture, createTestContext } from './helpers';

/** The director always resolves a step's `allow` to every key. */
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
  bag: false,
  character: false,
  feed: false,
  commission: false,
  status: false,
  give: false
};

/** Put a live tutorial step on the bus — the fact the generators gate on. */
function tutorialStep(ctx: GameContext, done: boolean): void {
  ctx.bus.emit('tutorial:step', {
    id: done ? 'done' : 'emberberry_merge',
    index: 0,
    total: 1,
    done,
    speaker: 'eleanor',
    text: '',
    gateType: 'tap',
    highlight: [],
    hand: null,
    arrow: null,
    arrowThen: null,
    allow: ALLOW_NOTHING
  });
}

/** Fill every free active tile EXCEPT the ones listed, so a spawn has to find
 *  the pocket we left rather than the whole board. */
function congest(ctx: GameContext, keepFree: TilePos[]): void {
  const free = keepFree.map((p) => `${p.col},${p.row}`);
  for (const cell of ctx.state.freeActiveTilesNear(0, 0)) {
    if (free.includes(`${cell.col},${cell.row}`)) continue;
    ctx.state.addItem({ chain: 'chest', tier: 1, col: cell.col, row: cell.row, kind: 'item' });
  }
}

const cellsOf = (ctx: GameContext, chain: string, tier: number): TilePos[] =>
  [...ctx.state.items.values()]
    .filter((i) => i.chain === chain && i.tier === tier)
    .map((i) => ({ col: i.col, row: i.row }));

/** Are these cells one orthogonally-connected group? That is exactly the test
 *  MergeSystem's flood-fill applies, so it is the only definition that counts. */
function connected(ctx: GameContext, cells: TilePos[]): boolean {
  if (cells.length === 0) return false;
  const key = (p: TilePos): string => `${p.col},${p.row}`;
  const pool = new Set(cells.map(key));
  const seen = new Set([key(cells[0]!)]);
  const queue = [cells[0]!];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nb of ctx.state.neighbors(cur.col, cur.row)) {
      const k = key(nb);
      if (pool.has(k) && !seen.has(k)) {
        seen.add(k);
        queue.push(nb);
      }
    }
  }
  return seen.size === cells.length;
}

describe('scripted spawns land where the lesson can use them', () => {
  it('grows the blob from a pocket that FITS, not from the nearest free tile', () => {
    const ctx = createTestContext();
    // The shape that broke the tutorial: the anchor's only free neighbour is a
    // lone pocket wedged between occupied tiles, while a pocket that can hold
    // the whole blob sits further out. Growing from the nearest free tile
    // yielded ONE cell and scattered the rest across the isle — three berries
    // on three separated tiles, no two of them adjacent.
    const anchor = { col: 1, row: 1 };
    const lonePocket = { col: 2, row: 1 }; // touches the anchor, but nothing else
    const roomy = [
      { col: 4, row: 4 },
      { col: 5, row: 4 },
      { col: 4, row: 5 }
    ];
    congest(ctx, [anchor, lonePocket, ...roomy]);
    ctx.state.addItem({ chain: 'emberberry', tier: 1, ...anchor, kind: 'item' });

    ctx.bus.emit('board:spawn', {
      chain: 'emberberry',
      tier: 1,
      count: 2,
      nearChain: 'emberberry',
      nearTier: 1
    });

    const berries = cellsOf(ctx, 'emberberry', 1);
    expect(berries).toHaveLength(3); // the anchor plus the two that spawned
    // No pocket touching the anchor can hold the pair, so the group cannot be
    // fully connected here — but the two that spawned MUST still land together,
    // which leaves the lesson one drag from done instead of three loose pieces.
    const spawned = berries.filter((p) => !(p.col === anchor.col && p.row === anchor.row));
    expect(spawned).toHaveLength(2);
    expect(connected(ctx, spawned)).toBe(true);
  });

  it('lands the blob ADJACENT to the piece the player already has', () => {
    const ctx = createTestContext();
    const anchor = { col: 2, row: 2 };
    congest(ctx, [
      anchor,
      { col: 3, row: 2 }, // the pocket that TOUCHES her berry
      { col: 4, row: 2 },
      { col: 5, row: 5 }, // an equally roomy pocket that does not
      { col: 5, row: 4 }
    ]);
    ctx.state.addItem({ chain: 'emberberry', tier: 1, ...anchor, kind: 'item' });

    ctx.bus.emit('board:spawn', {
      chain: 'emberberry',
      tier: 1,
      count: 2,
      nearChain: 'emberberry',
      nearTier: 1
    });

    // Two pockets could hold the pair; only one of them touches the anchor, and
    // the far one would strand the berry the player is looking at.
    expect(connected(ctx, cellsOf(ctx, 'emberberry', 1))).toBe(true);
  });

  it('still places every piece when NO pocket can hold them — never silently drops', () => {
    const ctx = createTestContext();
    // Three free tiles, all isolated from each other. No connected blob exists,
    // so the pieces scatter — but a scripted spawn losing items is a gate that
    // can never be met, so all three must still land.
    congest(ctx, [
      { col: 1, row: 1 },
      { col: 3, row: 3 },
      { col: 5, row: 5 }
    ]);

    ctx.bus.emit('board:spawn', { chain: 'quartz', tier: 1, count: 3 });

    expect(cellsOf(ctx, 'quartz', 1)).toHaveLength(3);
  });
});

describe('generators stay quiet until the tutorial hands over', () => {
  it('does not volunteer a passive yield mid-script', () => {
    const ctx = createTestContext();
    tutorialStep(ctx, false);
    // The Ancient Tree: a passive producer nobody has been taught about yet.
    ctx.state.addItem({ chain: 'bigtree', tier: 1, col: 2, row: 2, kind: 'item' });
    const produced = capture(ctx.bus, 'item:produced');

    ctx.bus.emit('time:advanced', { ms: 0 }); // would arm it
    ctx.clock.advance(20 * 60 * 1000); // four passive cycles
    ctx.bus.emit('time:advanced', { ms: 20 * 60 * 1000 });

    expect(produced).toHaveLength(0);
  });

  it('DOES pay a timer the script itself staged', () => {
    const ctx = createTestContext();
    tutorialStep(ctx, false);
    ctx.state.addItem({ chain: 'bigtree', tier: 1, col: 2, row: 2, kind: 'item' });
    const produced = capture(ctx.bus, 'item:produced');

    // `setTimer` is how a beat stages its own generator (house_skip does this).
    // An explicit passiveAt must still fire, or the beat promises a payout that
    // never arrives.
    ctx.bus.emit('generator:set_timer', { chain: 'bigtree', tier: 1, remainingMs: 1000 });
    ctx.clock.advance(2000);
    ctx.bus.emit('time:advanced', { ms: 2000 });

    expect(produced).toHaveLength(1);
  });

  it('arms fresh at handover — no pile of overdue gifts waiting', () => {
    const ctx = createTestContext();
    tutorialStep(ctx, false);
    ctx.state.addItem({ chain: 'bigtree', tier: 1, col: 2, row: 2, kind: 'item' });
    const produced = capture(ctx.bus, 'item:produced');

    ctx.clock.advance(60 * 60 * 1000); // an hour of tutorial
    ctx.bus.emit('time:advanced', { ms: 60 * 60 * 1000 });
    expect(produced).toHaveLength(0);

    tutorialStep(ctx, true);
    ctx.bus.emit('time:advanced', { ms: 0 }); // arms it NOW, does not back-pay
    expect(produced).toHaveLength(0);

    ctx.clock.advance(5 * 60 * 1000 + 1000);
    ctx.bus.emit('time:advanced', { ms: 5 * 60 * 1000 });
    expect(produced).toHaveLength(1);
  });
});
