import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import assetsJson from '../../src/data/assets.json';
import chainsJson from '../../src/data/chains.json';
import borealisJson from '../../src/data/tutorial-borealis.json';
import { isWorldItemArt, worldItemKeys } from '../../src/core/worldChains';
import { ITEM_SCALE } from '../../src/core/Constants';
import { latticeFor, type GridDef } from '../../src/editor/editorStore';
import { PRIMARY_WORLD } from '../../src/core/GameState';
import type { AssetsManifest, ChainsData, TutorialData } from '../../src/core/types';
import { capture, createTestContext } from './helpers';

const chains = chainsJson as unknown as ChainsData;
const assets = assetsJson as unknown as AssetsManifest;
const script = borealisJson as unknown as TutorialData;

const BOREALIS_CHAINS = ['driftwood', 'tarknot', 'rimebloom', 'frostsilk'];

/** Pixel size of a WebP, straight from the RIFF header (all of ours are VP8X — they
 *  carry alpha). No image dependency for one number. */
function webpSize(path: string): { w: number; h: number } {
  const b = readFileSync(path);
  if (b.toString('ascii', 12, 16) !== 'VP8X') throw new Error(`${path}: unexpected WebP container`);
  return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
}

/** The lattice borealis actually runs on, read from the real editor project (the
 *  same call `mapEditor.switchToWorld` makes). Null when the project is absent. */
function borealisLattice(): { halfW: number; halfH: number } | null {
  const path = 'asset3d/editor-map.json';
  if (!existsSync(path)) return null;
  const project = JSON.parse(readFileSync(path, 'utf8')) as {
    maps?: { id: string; name: string }[];
    grids?: Record<string, GridDef[]>;
  };
  const map = project.maps?.find((m) => m.name === 'borealis');
  return map ? latticeFor(project.grids?.[map.id] ?? []) : null;
}

/** Arrive in a world the way the game does: the switch is announced on the bus, and
 *  BoardScene — which does not exist in node — is the one that swaps the live board
 *  after every system has heard it. */
function enterWorld(ctx: ReturnType<typeof createTestContext>, worldId: string): void {
  ctx.bus.emit('world:switched', { toWorld: worldId });
  ctx.state.setActiveWorld(worldId);
}

/** Answer a tap-gated step. */
function tapThrough(ctx: ReturnType<typeof createTestContext>, stepId: string): void {
  ctx.bus.emit('tutorial:advance_requested', { stepId });
}

describe('Borealis chains', () => {
  it('declares four cold chains that belong to the borealis world', () => {
    for (const id of BOREALIS_CHAINS) {
      const chain = chains.chains.find((c) => c.id === id);
      expect(chain, id).toBeDefined();
      expect(chain!.world).toBe('borealis');
      expect(chain!.tiers.map((t) => t.tier)).toEqual([1, 2, 3]);
    }
  });

  it('gives every tier art that is registered AND actually on disk', () => {
    const byKey = new Map(assets.images.map((e) => [e.key, e] as const));
    for (const id of BOREALIS_CHAINS) {
      for (const tier of [1, 2, 3]) {
        const entry = byKey.get(`item_${id}_${tier}`);
        expect(entry, `item_${id}_${tier}`).toBeDefined();
        expect(entry!.source).toBe('file');
        // The manifest is only a promise; a missing file falls back to magenta at
        // runtime and nobody notices until they stand in the world.
        expect(existsSync(resolve(__dirname, '../../assets', entry!.file!)), entry!.file).toBe(true);
      }
    }
  });

  it('sizes that art for BOREALIS ground, not the isle it was tuned on', () => {
    // The bug this pins: ITEM_SCALE was worked out against the isle's 256 × 147.5px
    // tile, but borealis runs on the lattice its grids were drawn with (172 × 92.4),
    // so every piece stood ~1.5× too large — taller than the diamond it sat on.
    // BOREALIS_ART is the correction; the guard is that no piece overflows its cell.
    const lattice = borealisLattice();
    if (!lattice) return; // the editor project is not part of a clean checkout
    const tileW = lattice.halfW * 2;
    const tileH = lattice.halfH * 2;
    for (const id of BOREALIS_CHAINS) {
      for (const tier of [1, 2, 3]) {
        const px = webpSize(resolve(__dirname, `../../assets/sprites/items/chains/${id}_${tier}.webp`));
        const scale = ITEM_SCALE[`${id}_${tier}`];
        expect(scale, `${id}_${tier} has no scale — it would draw at native size`).toBeGreaterThan(0);
        expect(px.w * scale, `${id}_${tier} is wider than a borealis tile`).toBeLessThan(tileW);
        // A generator may stand taller than its cell (it is a fixture, not a piece);
        // nothing may be twice the tile, which is what "sized for the isle" looked like.
        expect(px.h * scale, `${id}_${tier} is more than a tile tall`).toBeLessThan(tileH * 1.5);
      }
    }
  });

  it('keeps that art off the boot preload and hands it to the world instead', () => {
    const keys = worldItemKeys('borealis');
    expect(keys).toHaveLength(12);
    for (const key of keys) expect(isWorldItemArt(key), key).toBe(true);
    // The isle's own icons stay resident — this must not become "lazy everything".
    expect(isWorldItemArt('item_ember_dragon_1')).toBe(false);
    expect(worldItemKeys(PRIMARY_WORLD)).toHaveLength(0);
  });

  it('spawns, merges and produces only from what the script actually teaches', () => {
    // Every chain the script spawns or gates on exists, so no beat can be unreachable.
    const referenced = new Set<string>();
    for (const step of script.steps) {
      if (step.gate.type === 'count') referenced.add(step.gate.chain);
      if (step.gate.type === 'event' && step.gate.chain) referenced.add(step.gate.chain);
      for (const effect of step.effects ?? []) {
        if ('spawn' in effect) referenced.add(effect.spawn.chain);
        if ('setTimer' in effect) referenced.add(effect.setTimer.chain);
      }
    }
    for (const id of referenced) {
      expect(chains.chains.some((c) => c.id === id), id).toBe(true);
    }
    // The two beats that ask for a TAP need a generator to tap.
    const producers = chains.chains
      .filter((c) => c.world === 'borealis' && c.tiers.some((t) => t.generator))
      .map((c) => c.id);
    expect(producers.sort()).toEqual(['driftwood', 'rimebloom']);
  });
});

describe('per-world tutorial', () => {
  it('begins the borealis script on arrival and leaves the isle behind', () => {
    const ctx = createTestContext();
    ctx.beginRun();
    const steps = capture(ctx.bus, 'tutorial:step');

    enterWorld(ctx, 'borealis');

    // The isle's tutorial stands down (unchanged behaviour) …
    expect(ctx.state.tutorialDone).toBe(true);
    // … and borealis picks up its OWN script from the top.
    expect(steps.at(-1)!.id).toBe('borealis_arrival');
    expect(steps.at(-1)!.total).toBe(script.steps.length);
    expect(ctx.systems.tutorial.isDone()).toBe(false);
  });

  it('advances borealis progress without touching the isle, and survives a reload', () => {
    const storage = new (class {
      private v = new Map<string, string>();
      getItem = (k: string): string | null => this.v.get(k) ?? null;
      setItem = (k: string, v: string): void => void this.v.set(k, v);
      removeItem = (k: string): void => void this.v.delete(k);
    })();
    const ctx = createTestContext(storage);
    ctx.beginRun();
    enterWorld(ctx, 'borealis');
    tapThrough(ctx, 'borealis_arrival');

    expect(ctx.state.tutorialIndexFor('borealis')).toBe(1);
    expect(ctx.systems.tutorial.currentStep!.id).toBe('borealis_driftwood');
    ctx.systems.save.save();

    // A fresh session reading the same bytes resumes borealis where it stopped —
    // the SCRIPT too, not just the number. Reopening on the isle's finished script
    // would leave the north permanently untaught.
    const next = createTestContext(storage);
    const resumed = capture(next.bus, 'tutorial:step');
    next.beginRun();
    expect(next.state.tutorialIndexFor('borealis')).toBe(1);
    expect(next.state.tutorialDoneFor('borealis')).toBe(false);
    expect(next.state.activeWorld).toBe('borealis');
    expect(next.systems.tutorial.currentStep!.id).toBe('borealis_driftwood');
    expect(resumed.at(-1)!.id).toBe('borealis_driftwood');
    // …and the isle's own tutorial is still recorded as stood down.
    expect(next.state.tutorialDone).toBe(true);
    // The checklist resumes with it, rather than listing the isle's finished steps.
    const subs = capture(next.bus, 'quest:changed');
    next.systems.quest.announce();
    expect(subs.at(-1)!.quests.filter((q) => q.kind === 'sub').every((q) => q.id.startsWith('borealis_'))).toBe(true);
  });

  it('never lets the north’s lesson fire the lair teleport', () => {
    const ctx = createTestContext();
    const teleports = capture(ctx.bus, 'world:teleport');
    ctx.bus.emit('tutorial:done', { world: 'borealis' });
    expect(teleports).toHaveLength(0);
    // The isle's completion still does.
    ctx.bus.emit('tutorial:done', { world: PRIMARY_WORLD });
    expect(teleports).toHaveLength(1);
  });

  it('shows the live world’s checklist in the quest panel', () => {
    const ctx = createTestContext();
    ctx.beginRun();
    const quests = capture(ctx.bus, 'quest:changed');

    enterWorld(ctx, 'borealis');
    const north = quests.at(-1)!.quests.filter((q) => q.kind === 'sub').map((q) => q.id);
    expect(north.every((id) => id.startsWith('borealis_'))).toBe(true);
    expect(north.length).toBeGreaterThan(0);

    ctx.bus.emit('world:return', {});
    ctx.state.setActiveWorld(PRIMARY_WORLD);
    const home = quests.at(-1)!.quests.filter((q) => q.kind === 'sub').map((q) => q.id);
    expect(home.some((id) => id.startsWith('borealis_'))).toBe(false);
  });
});
