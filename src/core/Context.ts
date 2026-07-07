import { BoardSystem } from '../systems/BoardSystem';
import { ChestSystem } from '../systems/ChestSystem';
import { DragonDuelSystem } from '../systems/DragonDuelSystem';
import { DragonJobSystem } from '../systems/DragonJobSystem';
import { EconomySystem } from '../systems/EconomySystem';
import { EmberfontSystem } from '../systems/EmberfontSystem';
import { EnergySystem } from '../systems/EnergySystem';
import { GeneratorSystem } from '../systems/GeneratorSystem';
import { MergeSystem } from '../systems/MergeSystem';
import { MilestoneSystem } from '../systems/MilestoneSystem';
import { OrderSystem } from '../systems/OrderSystem';
import { RewardSystem } from '../systems/RewardSystem';
import { SaveSystem, type StorageLike } from '../systems/SaveSystem';
import { TutorialDirector } from '../systems/TutorialDirector';
import { UnlockSystem } from '../systems/UnlockSystem';
import { EventBus } from './EventBus';
import { GameClock } from './GameClock';
import { GameState } from './GameState';
import type {
  AnchorsData,
  AssetsManifest,
  ChainsData,
  EmberfontData,
  MapData,
  MilestonesData,
  OrdersData,
  TutorialData
} from './types';
import anchorsJson from '../data/anchors.json';
import assetsJson from '../data/assets.json';
import chainsJson from '../data/chains.json';
import emberfontJson from '../data/emberfont.json';
import mapJson from '../data/map.json';
import milestonesJson from '../data/milestones.json';
import ordersJson from '../data/orders.json';
import tutorialJson from '../data/tutorial.json';

export interface GameData {
  chains: ChainsData;
  orders: OrdersData;
  milestones: MilestonesData;
  emberfont: EmberfontData;
  map: MapData;
  tutorial: TutorialData;
  assets: AssetsManifest;
  anchors: AnchorsData;
}

export interface GameSystems {
  board: BoardSystem;
  merge: MergeSystem;
  energy: EnergySystem;
  generator: GeneratorSystem;
  jobs: DragonJobSystem;
  order: OrderSystem;
  milestone: MilestoneSystem;
  emberfont: EmberfontSystem;
  duel: DragonDuelSystem;
  economy: EconomySystem;
  reward: RewardSystem;
  chest: ChestSystem;
  unlock: UnlockSystem;
  save: SaveSystem;
  tutorial: TutorialDirector;
}

/**
 * Composition root. Everything the game needs hangs off this context:
 * the bus, the virtual clock, the single GameState and the systems.
 * Scenes fetch it from the Phaser registry under 'ctx'.
 */
export class GameContext {
  readonly bus = new EventBus();
  readonly clock = new GameClock();
  readonly data: GameData;
  readonly state: GameState;
  readonly systems: GameSystems;
  running = false;

  constructor(storage: StorageLike, overrides?: Partial<GameData>) {
    this.data = {
      chains: chainsJson as unknown as ChainsData,
      orders: ordersJson as unknown as OrdersData,
      milestones: milestonesJson as unknown as MilestonesData,
      emberfont: emberfontJson as unknown as EmberfontData,
      map: mapJson as unknown as MapData,
      tutorial: tutorialJson as unknown as TutorialData,
      assets: assetsJson as unknown as AssetsManifest,
      anchors: anchorsJson as unknown as AnchorsData,
      ...overrides
    };
    this.state = new GameState(this.data.map);
    const save = new SaveSystem(this.state, this.bus, this.clock, storage);
    this.systems = {
      board: new BoardSystem(this.state, this.bus, this.clock, this.data.chains, this.data.map),
      merge: new MergeSystem(this.state, this.bus, this.clock, this.data.chains),
      energy: new EnergySystem(this.state, this.bus, this.clock),
      generator: new GeneratorSystem(this.state, this.bus, this.clock, this.data.chains),
      jobs: new DragonJobSystem(this.state, this.bus, this.clock),
      order: new OrderSystem(this.state, this.bus, this.data.orders),
      milestone: new MilestoneSystem(this.state, this.bus, this.data.milestones),
      emberfont: new EmberfontSystem(this.state, this.bus, this.clock, this.data.emberfont),
      duel: new DragonDuelSystem(this.state, this.bus, this.data.chains),
      economy: new EconomySystem(this.state, this.bus, this.data.chains),
      reward: new RewardSystem(this.bus),
      chest: new ChestSystem(this.state, this.bus, this.clock),
      unlock: new UnlockSystem(this.state, this.bus, this.clock, this.data.chains, this.data.map),
      save,
      tutorial: new TutorialDirector(this.state, this.bus, this.clock, this.data.tutorial)
    };
    this.bus.on('game:reset_requested', () => this.resetGame());
  }

  /** Called once the gameplay scenes are subscribed: load the save or start fresh. */
  beginRun(): void {
    if (this.running) return;
    this.running = true;
    const loaded = this.systems.save.load();
    if (!loaded) {
      this.systems.save.suspend(() => this.systems.board.newGame());
      this.systems.save.save();
      this.systems.order.announceProgress();
    }
    this.systems.tutorial.begin();
  }

  hasSave(): boolean {
    return this.systems.save.hasSave();
  }

  private resetGame(): void {
    this.systems.save.clear();
    this.state.reset(this.clock.now());
    this.running = false;
    this.bus.emit('game:reset', {});
  }
}
