import { describe, expect, it } from 'vitest';
import { DIALOGUE_MAX_CHARS, DRAGON_DIET } from '../../src/core/Constants';
import chainsDoc from '../../src/data/chains.json';
import dialogue from '../../src/data/dialogue.json';
import dragondex from '../../src/data/dragondex.json';
import quests from '../../src/data/quests.json';
import { capture, createTestContext } from './helpers';

interface SpawnReward {
  chain: string;
  tier: number;
  count: number;
}
interface QuestDoc {
  id: string;
  giver?: string;
  rewards?: { spawn?: SpawnReward };
}

/** Every quest that hands the player an egg, grouped by the egg's chain. */
function spawnQuestsByChain(): Map<string, QuestDoc[]> {
  const by = new Map<string, QuestDoc[]>();
  for (const q of (quests as { quests: QuestDoc[] }).quests) {
    const spawn = q.rewards?.spawn;
    if (!spawn) continue;
    const list = by.get(spawn.chain) ?? [];
    list.push(q);
    by.set(spawn.chain, list);
  }
  return by;
}

describe('the quest-egg gift — a reward egg never lands silently', () => {
  it("a quest reward spawn carries cause 'quest' onto the board fact", () => {
    // The whole ceremony (camera glide, flare, the giver's line) keys off this
    // one field: QuestSystem stamps it, BoardSystem must pass it through.
    const ctx = createTestContext();
    const spawned = capture(ctx.bus, 'item:spawned');
    ctx.bus.emit('board:spawn', { chain: 'ashdrake', tier: 1, count: 1, overflow: 'bag', cause: 'quest' });
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({ cause: 'quest', item: { chain: 'ashdrake', tier: 1 } });
  });

  it('every egg-granting chain has a gift line PER GRANT, spoken by the quests’ own giver', () => {
    const gift = (dialogue as { eggGift: Record<string, { speaker: string; lines: string[] }> }).eggGift;
    for (const [chain, givers] of spawnQuestsByChain()) {
      const bank = gift[chain];
      expect(bank, `dialogue.eggGift.${chain}`).toBeDefined();
      // Line n plays when the n-th spawning quest completes — a bank shorter
      // than the grant list would repeat its last line on a fresh grant.
      expect(bank.lines.length, `${chain} gift lines vs granting quests`).toBe(givers.length);
      for (const line of bank.lines) expect(line.length).toBeLessThanOrEqual(DIALOGUE_MAX_CHARS);
      for (const q of givers) {
        expect(q.giver, `${q.id} giver vs eggGift.${chain}.speaker`).toBe(bank.speaker);
      }
    }
  });

  it('every gifted egg leads to a REAL dragon — diet, codex page, and a hatch tier', () => {
    const chains = (chainsDoc as { chains: Array<{ id: string; hatchAtTier?: number; tiers: unknown[] }> }).chains;
    const dex = (dragondex as { dragons: Record<string, unknown> }).dragons;
    for (const [chain] of spawnQuestsByChain()) {
      const config = chains.find((c) => c.id === chain);
      expect(config?.hatchAtTier, `${chain} hatches`).toBeDefined();
      expect(config!.tiers.length, `${chain} has its animal tier`).toBeGreaterThanOrEqual(config!.hatchAtTier!);
      // Feedable (DragonSystem.isBoardDragon reads DRAGON_DIET) …
      expect(DRAGON_DIET[chain], `${chain} in DRAGON_DIET`).toBeDefined();
      // … and the Codex has its page the moment the player names it.
      expect(dex[chain], `${chain} in dragondex.json`).toBeDefined();
    }
  });
});
