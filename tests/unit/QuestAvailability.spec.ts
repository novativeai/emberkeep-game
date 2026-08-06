import { describe, expect, it } from 'vitest';
import {
  auditLadder,
  auditLegendaryArc,
  auditWorlds,
  mergeYield,
  pieceKey,
  reachableRecipeKeys,
  simulateTutorial,
  solveAvailability,
  type AuditData,
  type Finding
} from '../../src/core/availability';
import type { QuestConfig } from '../../src/core/types';
import { chainHiddenIn, HIDDEN_CHAINS, LEVEL_XP, WORLD_ID } from '../../src/core/Constants';
import { ZONES } from '../../src/core/world';
import chains from '../../src/data/chains.json';
import map from '../../src/data/map.json';
import orders from '../../src/data/orders.json';
import quests from '../../src/data/quests.json';
import tasks from '../../src/data/tasks.json';
import tutorial from '../../src/data/tutorial.json';

const data = {
  worldId: WORLD_ID,
  chains,
  map,
  orders,
  tasks,
  tutorial,
  quests
} as unknown as AuditData;

describe('Quest availability (the offline proof — `pnpm quests`)', () => {
  it('every subquest can be satisfied at the exact point it is asked', () => {
    const errors = auditLadder(data).findings.filter((f) => f.severity === 'error');
    expect(
      errors.map((f) => `${f.at} — ${f.message}`),
      'a quest asks for something the player cannot get yet'
    ).toEqual([]);
  });

  it('the scripted tutorial can be played through with the pieces it spawns', () => {
    const { beats } = simulateTutorial(data);
    const broken = beats.flatMap((b) => b.findings.map((f) => `${b.stepId}: ${f.message}`));
    expect(broken).toEqual([]);
  });

  it('the tutorial earns exactly 60 XP, so Level 2 lands ON the `levelup` beat', () => {
    const { beats } = simulateTutorial(data);
    const levelup = beats.find((b) => b.stepId === 'levelup')!;
    expect(levelup.xp).toBe(LEVEL_XP[1]);
    expect(levelup.level).toBe(2);
    expect(beats[levelup.index - 1]!.level).toBe(1); // and not one beat early
  });

  it('leaves the tutorial with every chain the shipped orders need renewable', () => {
    const { world } = simulateTutorial(data);
    const available = solveAvailability(world, data);
    for (const key of ['flame_gem:1', 'flame_gem:2', 'flame_gem:3', 'ember_dragon:1', 'lumber:1']) {
      expect(available.get(key), key).toMatchObject({ reachable: true, renewable: true });
    }
  });

  it('merge arithmetic matches MergeSystem: 5→2 bonus, and per-tier overrides kill it', () => {
    // Global rule: 3 → 1, with 5 → 2. Spending fives first is optimal.
    expect(mergeYield(data.chains, 'flame_gem', 1, 4)).toBe(1);
    expect(mergeYield(data.chains, 'flame_gem', 1, 5)).toBe(2);
    expect(mergeYield(data.chains, 'flame_gem', 1, 9)).toBe(3);
    // House → Manor is an override (2 → 1) and takes no bonus.
    expect(mergeYield(data.chains, 'lumber', 3, 5)).toBe(2);
    // Top of a chain merges into nothing.
    expect(mergeYield(data.chains, 'flame_gem', 3, 99)).toBe(0);
  });

  it('names the finite chains Chapter One can never finish, so nothing may ask for them', () => {
    const { finalAvailability } = auditLadder(data);
    // Cracked Stones: two in `level_2` (one to pocket, one to sell out of the
    // Bag) plus the one `level_5` reveals now that its land opens at the cap —
    // exactly three, which is `minGroup`, so ONE Cinder Seam can be built and
    // never a second. Tier 3 needs three Seams and stays out of reach, so the
    // Cookbook prints 1>2 and must still refuse 2>3.
    expect(finalAvailability.get(pieceKey('cinder_vein', 1))).toMatchObject({
      reachable: true,
      renewable: false,
      maxEver: 3
    });
    expect(finalAvailability.get(pieceKey('cinder_vein', 2))).toMatchObject({
      reachable: true,
      renewable: false,
      maxEver: 1
    });
    expect(finalAvailability.get(pieceKey('cinder_vein', 3))?.reachable).toBe(false);
    // Moonwater is taught exactly as far as the isle can take it: three seeded
    // Dew Drops make the one Vial `moonwater_merge` asks for, and no further.
    expect(finalAvailability.get(pieceKey('moonwater', 2))).toMatchObject({
      reachable: true,
      maxEver: 1
    });
    expect(finalAvailability.get(pieceKey('moonwater', 3))?.reachable).toBe(false);
    // The Basin that would feed a second Vial is husbandry, and husbandry is a
    // later chapter — held in HIDDEN_CHAINS rather than merely out of reach.
    expect(finalAvailability.get(pieceKey('dew_basin', 1))?.blockedBy).toContain('HIDDEN_CHAINS');
    expect(finalAvailability.get(pieceKey('dew_basin', 3))?.reachable).toBe(false);
  });

  it('the recipe book promises only what this chapter can deliver', () => {
    const keys = reachableRecipeKeys(data);
    // Live: the dragon/gem economy, and Moonwater as far as the isle takes it.
    expect(keys.has('ember_dragon:1>2')).toBe(true);
    expect(keys.has('flame_gem:2>3')).toBe(true);
    expect(keys.has('moonwater:1>2')).toBe(true);
    // Live now that `level_5` opens: three stones make the one Cinder Seam.
    expect(keys.has('cinder_vein:1>2')).toBe(true);
    // Dead, and therefore never printed: one Seam cannot make a Vein, and
    // Moonwater's third tier has no source this chapter.
    expect(keys.has('cinder_vein:2>3')).toBe(false);
    expect(keys.has('moonwater:2>3')).toBe(false);
    // A hidden chain contributes nothing at all.
    for (const key of keys) {
      expect(HIDDEN_CHAINS.has(key.split(':')[0]!)).toBe(false);
    }
    // The guarantee the counter depends on: every row the book prints has a
    // reachable output, so `n / N` can always be finished.
    const { finalAvailability } = auditLadder(data);
    for (const key of keys) {
      const [chain, pair] = key.split(':');
      const toTier = Number(pair!.split('>')[1]);
      expect(finalAvailability.get(pieceKey(chain!, toTier))?.reachable).toBe(true);
    }
  });

  it('the Golden Elder is a scripted altar fixture, not something merged into being', () => {
    const { finalAvailability } = auditLadder(data);
    const elder = finalAvailability.get(pieceKey('golden_egg', 2))!;
    expect(elder.reachable).toBe(true);
    expect(elder.renewable).toBe(false);
    expect(elder.sources.map((s) => s.kind)).toEqual(['altar']);
  });

  it('a chain that belongs to another world is unreachable here, and says so', () => {
    const { finalAvailability } = auditLadder(data);
    for (const id of ['driftwood', 'rimebloom', 'tarknot', 'frostsilk']) {
      const entry = finalAvailability.get(pieceKey(id, 1))!;
      expect(entry.reachable, id).toBe(false);
      // The reason is the WORLD, not the chapter — the two are different
      // withholdings and the report must not confuse them.
      expect(entry.blockedBy, id).toContain("belongs to world 'borealis'");
      expect(HIDDEN_CHAINS.has(id), `${id} must not also sit in HIDDEN_CHAINS`).toBe(false);
    }
  });

  it('chainHiddenIn separates "wrong world" from "wrong chapter"', () => {
    const frozen = { id: 'driftwood', world: 'borealis' };
    expect(chainHiddenIn(frozen, 'emberkeep')).toBe(true);
    expect(chainHiddenIn(frozen, 'borealis')).toBe(false); // the north turns itself on
    // A chapter-gated chain is withheld in EVERY world until its chapter lands.
    expect(chainHiddenIn({ id: 'nest' }, 'emberkeep')).toBe(true);
    expect(chainHiddenIn({ id: 'nest' }, 'borealis')).toBe(true);
    // And the ordinary case.
    expect(chainHiddenIn({ id: 'flame_gem' }, 'emberkeep')).toBe(false);
  });

  it('every world this build can run is audited, and none of them errors', () => {
    const worlds = auditWorlds(data, data.map, ZONES.worlds);
    expect(worlds.map((w) => w.worldId)).toContain('borealis');
    for (const world of worlds) {
      const errors = world.audit.findings.filter((f) => f.severity === 'error');
      expect(errors.map((f) => `${world.worldId}: ${f.message}`)).toEqual([]);
    }
  });

  it('a world with no ladder and no seeds is a WARNING, never a silent pass', () => {
    // Roothold is world 3 — painted, addressable, and not yet anybody's game.
    // It is the standing proof that scenery cannot pass this audit by having
    // nothing in it to check.
    const roothold = auditWorlds(data, data.map, ZONES.worlds).find(
      (w) => w.worldId === 'roothold'
    )!;
    const messages = roothold.audit.findings.map((f) => f.message);
    expect(roothold.questCount).toBe(0);
    expect(messages.some((m) => m.includes('no quest'))).toBe(true);
    expect(messages.some((m) => m.includes('nothing arrives on this board'))).toBe(true);
    // Its chains are not world-blocked there — they are simply unseeded, which
    // is the actionable difference.
    const spar = roothold.audit.finalAvailability.get(pieceKey('driftwood', 1))!;
    expect(spar.reachable).toBe(false);
  });

  /**
   * BOREALIS IS SELF-SUFFICIENT. A world's boards do not pool — `state.items`
   * is the board you are standing on — and in the north a merge cannot even
   * cross between its three islands. So every chain its own ladder asks for has
   * to be makeable there, from producers standing on ground that ladder opens.
   */
  it('gives Borealis its own economy: every northern chain renewable in the north', () => {
    const north = auditWorlds(data, data.map, ZONES.worlds).find((w) => w.worldId === 'borealis')!;
    expect(north.questCount).toBeGreaterThan(0);
    expect(north.audit.findings.filter((f) => f.severity === 'error')).toEqual([]);
    for (const chain of ['driftwood', 'rimebloom', 'tarknot', 'frostsilk', 'keel', 'coin']) {
      const top = chains.chains.find((c) => c.id === chain)!.tiers.at(-1)!.tier;
      const piece = north.audit.finalAvailability.get(pieceKey(chain, top))!;
      expect(piece?.renewable, `${chain} T${top} in the north`).toBe(true);
    }
    // And the south is untouched by any of it: the frozen roster stays frozen.
    const south = auditWorlds(data, data.map, ZONES.worlds).find(
      (w) => w.worldId === 'emberkeep'
    )!;
    expect(south.audit.finalAvailability.get(pieceKey('keel', 1))?.reachable).toBe(false);
  });

  /** The north's islands are opened with Gold Keys, and the only source of one
   *  is Selyna's Ledger — so the ladder must bank each key before it spends it. */
  it('never asks for a fog lift the northern ladder has not paid for', () => {
    const north = auditWorlds(data, data.map, ZONES.worlds).find((w) => w.worldId === 'borealis')!;
    const gates = north.audit.steps.filter((s) => s.label.includes('Gold Key'));
    expect(gates.length).toBeGreaterThan(0);
    // Each gate step reports the regions open when it is ASKED; the one after it
    // must have more. That is the audit walking the fog lift, not assuming it.
    for (const gate of gates) {
      const after = north.audit.steps[north.audit.steps.indexOf(gate) + 1];
      expect(after && after.regions.length, gate.stepId).toBeGreaterThan(gate.regions.length);
    }
  });

  it('quests.json only ever references orders, tasks and chains that exist', () => {
    const orderIds = new Set(orders.orders.map((o) => o.id));
    const taskIds = new Set(tasks.tasks.map((t) => t.id));
    for (const quest of quests.quests) {
      if (quest.orderId) expect(orderIds, quest.id).toContain(quest.orderId);
      for (const step of quest.steps) {
        const goal = step.goal as Record<string, string | number>;
        if (goal.kind === 'order') expect(orderIds, step.id).toContain(goal.orderId);
        if (goal.kind === 'task') expect(taskIds, step.id).toContain(goal.taskId);
        if (goal.kind === 'have') {
          const tier = chains.chains
            .find((c) => c.id === goal.chain)
            ?.tiers.find((t) => t.tier === goal.tier);
          expect(tier, `${step.id} → ${goal.chain} T${goal.tier}`).toBeDefined();
        }
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* the legendary egg directive                                          */
/* ------------------------------------------------------------------ */

describe('the legendary egg directive (Constants §LEGENDARY_EGG_COUNT)', () => {
  /** The shipped ladders, with one thing bent, so each rule is shown to BITE.
   *  A directive that only ever passes is decoration. */
  const bent = (worldId: string, edit: (quests: QuestConfig[]) => void): Finding[] => {
    const copy: QuestConfig[] = JSON.parse(JSON.stringify(quests.quests));
    edit(copy);
    return auditLegendaryArc({
      ...data,
      worldId,
      quests: { quests: copy }
    } as unknown as AuditData);
  };
  const eggQuests = (worldId: string, chain: string): QuestConfig[] =>
    (quests.quests as unknown as QuestConfig[]).filter(
      (q) => (q.world ?? WORLD_ID) === worldId && q.rewards?.spawn?.chain === chain
    );

  it('passes on every world this build ships', () => {
    for (const spec of ZONES.worlds) {
      const findings = auditLegendaryArc({ ...data, worldId: spec.id } as unknown as AuditData);
      expect(findings.map((f) => `${spec.id}: ${f.message}`)).toEqual([]);
    }
  });

  it('gives each zone exactly three eggs, one per quest, ending on the hatch', () => {
    for (const [worldId, chain] of [
      [WORLD_ID, 'ashdrake'],
      ['borealis', 'rimewyrm']
    ] as const) {
      const payers = eggQuests(worldId, chain);
      expect(payers.length, `${worldId} egg quests`).toBe(3);
      for (const q of payers) expect(q.rewards?.spawn?.count).toBe(1);

      const ladder = (quests.quests as unknown as QuestConfig[]).filter(
        (q) => (q.world ?? WORLD_ID) === worldId
      );
      const completable = ladder.filter((q) =>
        q.steps.some((s) => s.goal.kind !== 'active_order')
      );
      const at = payers.map((q) => completable.findIndex((c) => c.id === q.id));
      // Spaced by 3–4 quests that pay something else…
      for (let n = 1; n < at.length; n++) {
        const gap = at[n]! - at[n - 1]! - 1;
        expect(gap, `${worldId} gap ${n}`).toBeGreaterThanOrEqual(3);
        expect(gap, `${worldId} gap ${n}`).toBeLessThanOrEqual(4);
      }
      // …the last on the second-to-last quest, and the zone closes on the hatch.
      expect(at.at(-1), `${worldId} last egg`).toBe(completable.length - 2);
      const hatch = completable.at(-1)!;
      expect(
        hatch.steps.some(
          (s) => s.goal.kind === 'have' && s.goal.chain === chain && s.goal.tier === 2
        ),
        `${worldId} ends on the hatch`
      ).toBe(true);
    }
  });

  it('catches two eggs from one quest', () => {
    const found = bent(WORLD_ID, (qs) => {
      const q = qs.find((x) => x.id === 'warm_the_hearth')!;
      q.rewards!.spawn!.count = 2;
    });
    expect(found.some((f) => f.message.includes('one quest, one egg'))).toBe(true);
  });

  it('catches eggs that arrive back to back', () => {
    const found = bent(WORLD_ID, (qs) => {
      // Move the middle egg next to the first.
      qs.find((x) => x.id === 'raise_the_roofs')!.rewards!.spawn = undefined;
      qs.find((x) => x.id === 'radiant_centerpiece')!.rewards = {
        coins: 60,
        spawn: { chain: 'ashdrake', tier: 1, count: 1 }
      };
    });
    expect(found.some((f) => f.message.includes('too crowded'))).toBe(true);
  });

  it('catches a zone that hands over too few eggs to ever merge the dragon', () => {
    const found = bent(WORLD_ID, (qs) => {
      qs.find((x) => x.id === 'the_emerald_brood')!.rewards!.spawn = undefined;
    });
    expect(found.some((f) => f.message.includes('never be assembled'))).toBe(true);
  });

  it('catches a zone that does not close on the hatch', () => {
    const found = bent(WORLD_ID, (qs) => {
      const hatch = qs.find((x) => x.id === 'the_ashdrake_wakes')!;
      hatch.steps = [
        { id: 'ashdrake_hatch', label: 'x', goal: { kind: 'have', chain: 'lumber', tier: 3, count: 1 } }
      ];
    });
    expect(found.some((f) => f.message.includes('does not hatch'))).toBe(true);
  });

  it('catches an egg the endless tail can never pay', () => {
    const found = bent('borealis', (qs) => {
      qs.find((x) => x.id === 'north_ledger')!.rewards = {
        spawn: { chain: 'rimewyrm', tier: 1, count: 1 }
      };
    });
    expect(found.some((f) => f.message.includes('endless tail cannot pay'))).toBe(true);
  });

  /** Rule 2 is the one that keeps the dragon a story object. If any producer,
   *  region seed or chest could make an egg, the arc would be bypassable. */
  it('refuses an egg that any producer could make', () => {
    const seeded = JSON.parse(JSON.stringify(chains));
    seeded.chains.find((c: { id: string }) => c.id === 'bigtree').tiers[0].generator.produces = {
      chain: 'ashdrake',
      tier: 1
    };
    const found = auditLegendaryArc({
      ...data,
      chains: seeded
    } as unknown as AuditData);
    expect(found.some((f) => f.message.includes('not a grind'))).toBe(true);
  });

  it('is silent for a world with no legendary chain authored yet', () => {
    expect(auditLegendaryArc({ ...data, worldId: 'roothold' } as unknown as AuditData)).toEqual([]);
  });
});
