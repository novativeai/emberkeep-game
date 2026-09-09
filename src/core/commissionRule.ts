import { DRAGON_DIET, WORLD_ID } from './Constants';
import type { ChainsData } from './types';

/**
 * MAY THIS BUILDING BE COMMISSIONED TO MAKE THIS PIECE — the one predicate,
 * shaped like `mergeRule`: GeneratorSystem's refusal (the belt) and the
 * chooser's locked slots (the brace) both call it, so the panel can never
 * offer what the system would refuse.
 *
 * Three rules beyond "it is in the Bag" (owner's law, 2026-08-28):
 *
 *  · RANK — a House takes tier-1 commissions, a Mansion tiers 1–2
 *    (`produceMaxTier`). Unchanged, just moved here with its siblings.
 *
 *  · NO DRAGONS — a House pouring Dragon Eggs is a dragon farm, and one
 *    pouring the gems that merge INTO eggs is the same farm one step shorter.
 *    So no tier of any BREED chain (`DRAGON_DIET` names them) may be
 *    commissioned, and neither may the altar's lore chain.
 *
 *  · HOME GOODS ONLY — a chain with a home world may only be commissioned
 *    where it is home: an Emberkeep House cannot pour Borealis seaglass, and
 *    a House carried north cannot pour southern moss. A chain with no `world`
 *    in chains.json is the authored isle's (`WORLD_ID`), the same default
 *    `chainHiddenIn` reads. Gold is currency, not a regional good — the coin
 *    chain passes everywhere, which also keeps every House's DEFAULT output
 *    choosable.
 */
export type CommissionVerdict = 'ok' | 'tier_too_high' | 'dragon' | 'foreign_world';

export function commissionVerdict(
  chains: ChainsData,
  worldId: string,
  generator: { chain: string; tier: number },
  offered: { chain: string; tier: number }
): CommissionVerdict {
  const genTier = chains.chains
    .find((c) => c.id === generator.chain)
    ?.tiers.find((t) => t.tier === generator.tier);
  if (offered.tier > (genTier?.produceMaxTier ?? 1)) return 'tier_too_high';
  if (offered.chain === 'coin') return 'ok';
  if (DRAGON_DIET[offered.chain] || offered.chain === 'golden_egg') return 'dragon';
  const home = chains.chains.find((c) => c.id === offered.chain)?.world ?? WORLD_ID;
  if (home !== worldId) return 'foreign_world';
  return 'ok';
}
