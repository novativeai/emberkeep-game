import { BAG_SLOTS } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { CauldronData, CauldronRecipeConfig } from '../core/types';

/**
 * Selyna's Cauldron — brew new pieces out of the Bag.
 *
 * The cauldron trades in the Bag ONLY. It never spawns to a board and never
 * consumes off one: the pot stands in the hatchery hub, but the goods it wants
 * are gathered on every world, and the Bag is the one container that follows
 * the Keeper across all of them. That also keeps this system board-free — no
 * placement rules, no overflow, no world checks.
 *
 * Owns nothing in `GameState`: recipes are data, the Bag belongs to BagSystem.
 * So this system holds to the bus law strictly — it READS `state.bag` to
 * validate, then commands `bag:consume` / `bag:bank` and lets BagSystem do
 * every write. Validation happens up front and in full: `bag:consume` debits
 * whatever is there without complaint, so a half-checked brew would eat
 * ingredients and hand back nothing.
 */
export class CauldronSystem {
  constructor(
    private state: GameState,
    private bus: EventBus,
    private data: CauldronData
  ) {
    bus.on('cauldron:brew', ({ recipeId }) => this.brew(recipeId));
  }

  get recipes(): readonly CauldronRecipeConfig[] {
    return this.data.recipes;
  }

  recipe(id: string): CauldronRecipeConfig | undefined {
    return this.data.recipes.find((r) => r.id === id);
  }

  /** How many of this piece the Bag holds right now. */
  haveOf(chain: string, tier: number): number {
    return this.state.bag.find((s) => s.chain === chain && s.tier === tier)?.count ?? 0;
  }

  /** Every input covered by the Bag? The panel greys the brew button off this. */
  canBrew(recipeId: string): boolean {
    const recipe = this.recipe(recipeId);
    if (!recipe) return false;
    return recipe.inputs.every((i) => this.haveOf(i.chain, i.tier) >= i.count);
  }

  private brew(recipeId: string): void {
    const recipe = this.recipe(recipeId);
    if (!recipe) return;
    if (!this.canBrew(recipeId)) {
      this.bus.emit('cauldron:brew_failed', { recipeId, reason: 'ingredients' });
      return;
    }
    // The output needs a slot only when it starts a NEW stack — same rule as
    // BagSystem.canStore, checked here BEFORE any ingredient is spent. The
    // wrinkle: a brew that empties a stack frees its slot, so the check runs
    // against the bag as it will look AFTER the debit, not as it looks now.
    const { chain, tier, count } = recipe.output;
    if (this.haveOf(chain, tier) === 0) {
      const emptied = recipe.inputs.filter((i) => this.haveOf(i.chain, i.tier) === i.count).length;
      if (this.state.bag.length - emptied >= BAG_SLOTS) {
        this.bus.emit('cauldron:brew_failed', { recipeId, reason: 'bag_full' });
        return;
      }
    }
    for (const input of recipe.inputs) {
      this.bus.emit('bag:consume', { chain: input.chain, tier: input.tier, count: input.count });
    }
    this.bus.emit('bag:bank', { chain, tier, count });
    this.bus.emit('cauldron:brewed', { recipeId, output: { chain, tier, count } });
  }
}
