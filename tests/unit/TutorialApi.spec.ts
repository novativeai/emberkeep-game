import { describe, expect, it } from 'vitest';
import path from 'node:path';
import tutorialJson from '../../src/data/tutorial.json';
import { applyOp, buildContext } from '../../tools/tutorial-api/server';
import type { TutorialData, TutorialStepConfig } from '../../src/core/types';

const shipped = tutorialJson as unknown as TutorialData;
const tap = (id: string): TutorialStepConfig => ({ id, speaker: 'eleanor', text: id, gate: { type: 'tap' } });
const base: TutorialData = { steps: [tap('m1'), tap('m2'), tap('m3')] };

describe('tutorial API ops (pure, validated)', () => {
  it('adds a mid-game script and steps around named neighbours', () => {
    let d = applyOp(base, { op: 'add_script', script: { id: 'tip', trigger: { type: 'level', min: 3 } } });
    expect(d.tutorials?.[0]).toMatchObject({ id: 'tip', trigger: { type: 'level', min: 3 }, steps: [] });
    d = applyOp(d, { op: 'add_step', tutorial: 'tip', step: tap('t2') });
    d = applyOp(d, { op: 'add_step', tutorial: 'tip', step: tap('t1'), before: 't2' });
    d = applyOp(d, { op: 'add_step', tutorial: 'tip', step: tap('t3'), after: 't2' });
    expect(d.tutorials![0]!.steps.map((s) => s.id)).toEqual(['t1', 't2', 't3']);
    d = applyOp(d, { op: 'move_step', tutorial: 'tip', step: 't3', to: 0 });
    expect(d.tutorials![0]!.steps.map((s) => s.id)).toEqual(['t3', 't1', 't2']);
    d = applyOp(d, { op: 'reorder', tutorial: 'tip', order: ['t1', 't2', 't3'] });
    d = applyOp(d, { op: 'update_step', tutorial: 'tip', step: 't2', patch: { text: 'new words', allow: { bag: false } } });
    expect(d.tutorials![0]!.steps[1]).toMatchObject({ text: 'new words', allow: { bag: false } });
    d = applyOp(d, { op: 'update_step', tutorial: 'tip', step: 't2', patch: {}, unset: ['allow'] });
    expect(d.tutorials![0]!.steps[1]!.allow).toBeUndefined();
    d = applyOp(d, { op: 'remove_step', tutorial: 'tip', step: 't1' });
    d = applyOp(d, { op: 'update_script', tutorial: 'tip', patch: { title: 'A tip', allowBase: 'nothing' } });
    expect(d.tutorials![0]).toMatchObject({ title: 'A tip', allowBase: 'nothing' });
    d = applyOp(d, { op: 'remove_script', tutorial: 'tip' });
    expect(d).toEqual(base);
  });

  it('edits the main script in place and keeps the file shape', () => {
    const d = applyOp(base, { op: 'add_step', tutorial: 'main', step: tap('m1b'), after: 'm1' });
    expect(d.steps.map((s) => s.id)).toEqual(['m1', 'm1b', 'm2', 'm3']);
    expect(d.tutorials).toBeUndefined();
  });

  it('refuses what would break the file — and leaves it untouched', () => {
    expect(() => applyOp(base, { op: 'add_step', tutorial: 'main', step: tap('m1') })).toThrow(/duplicate step id/);
    expect(() => applyOp(base, { op: 'remove_script', tutorial: 'main' })).toThrow(/cannot be removed/);
    expect(() => applyOp(base, { op: 'add_script', script: { id: 'x', trigger: { type: 'step_done', tutorial: 'main', step: 'ghost' }, steps: [tap('x1')] } })).toThrow(/no step "ghost"/);
    expect(() => applyOp(base, { op: 'reorder', tutorial: 'main', order: ['m1', 'm2'] })).toThrow(/every step id exactly once/);
    expect(() => applyOp(base, { op: 'update_script', tutorial: 'main', patch: { trigger: { type: 'level', min: 2 } } })).toThrow(/keeps trigger start/);
    expect(() => applyOp(base, { op: 'remove_step', tutorial: 'main', step: 'nope' })).toThrow(/no step "nope"/);
  });

  it('a no-op round trip of the shipped file is byte-stable', () => {
    const d = applyOp(shipped, { op: 'reorder', tutorial: 'main', order: shipped.steps.map((s) => s.id) });
    expect(d).toEqual(shipped);
  });

  it('the context exposes every picker the editor needs, from the real data', () => {
    const ctx = buildContext(path.resolve(__dirname, '../..')) as Record<string, unknown[]>;
    expect(ctx.speakers).toEqual(['eleanor', 'selyna', 'golden_elder']);
    expect(ctx.gateEvents).toContain('item:merged');
    expect(ctx.allowKeys).toContain('codexHold');
    expect(ctx.effectKinds).toEqual(expect.arrayContaining(['spawn', 'grantXp', 'grantKeys']));
    expect(ctx.uiTargets).toContain('codex_card');
    expect((ctx.chains as Array<{ id: string }>).some((c) => c.id === 'ashmoss')).toBe(true);
    expect((ctx.regions as Array<{ id: string }>).some((r) => r.id === 'level_2')).toBe(true);
    expect((ctx.quests as Array<{ id: string }>).some((q) => q.id === 'north_landing')).toBe(true);
  });
});
