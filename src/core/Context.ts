import { BoardSystem } from '../systems/BoardSystem';
import { ChestSystem } from '../systems/ChestSystem';
import { DayCycleSystem } from '../systems/DayCycleSystem';
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
import { TaskSystem } from '../systems/TaskSystem';
import { TutorialDirector } from '../systems/TutorialDirector';
import { UnlockSystem } from '../systems/UnlockSystem';
import { WorldTeleportSystem } from '../systems/WorldTeleportSystem';
import { QuestSystem } from '../systems/QuestSystem';
import { DragonFeedSystem } from '../systems/DragonFeedSystem';
import { EventBus } from './EventBus';
import { GameClock } from './GameClock';
import { GameState } from './GameState';
import type {
  AnchorsData,
  AssetsManifest,
  ChainsData,
  DialogueData,
  EmberfontData,
  MapData,
  MilestonesData,
  OrdersData,
  QuestsData,
  TasksData,
  TutorialData,
  WorldTutorials
} from './types';
import anchorsJson from '../data/anchors.json';
import assetsJson from '../data/assets.json';
import chainsJson from '../data/chains.json';
import dialogueJson from '../data/dialogue.json';
import emberfontJson from '../data/emberfont.json';
import mapJson from '../data/map.json';
import milestonesJson from '../data/milestones.json';
import ordersJson from '../data/orders.json';
import questsJson from '../data/quests.json';
import tasksJson from '../data/tasks.json';
import tutorialJson from '../data/tutorial.json';
import tutorialBorealisJson from '../data/tutorial-borealis.json';

export interface GameData {
  chains: ChainsData;
  orders: OrdersData;
  milestones: MilestonesData;
  emberfont: EmberfontData;
  map: MapData;
  tutorial: TutorialData;
  /** The tutorials the OTHER worlds own, keyed by editor-map name (borealis).
   *  The isle's stays `tutorial` above — nothing that reads it has to change. */
  worldTutorials: WorldTutorials;
  assets: AssetsManifest;
  anchors: AnchorsData;
  dialogue: DialogueData;
  tasks: TasksData;
  quests: QuestsData;
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
  tasks: TaskSystem;
  worldTeleport: WorldTeleportSystem;
  quest: QuestSystem;
  feed: DragonFeedSystem;
  day: DayCycleSystem;
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
      worldTutorials: { borealis: tutorialBorealisJson as unknown as TutorialData },
      assets: assetsJson as unknown as AssetsManifest,
      anchors: anchorsJson as unknown as AnchorsData,
      dialogue: dialogueJson as unknown as DialogueData,
      tasks: tasksJson as unknown as TasksData,
      quests: questsJson as unknown as QuestsData,
      ...overrides
    };
    this.state = new GameState(this.data.map);
    const save = new SaveSystem(this.state, this.bus, this.clock, storage);
    this.systems = {
      board: new BoardSystem(this.state, this.bus, this.clock, this.data.chains, this.data.map),
      merge: new MergeSystem(this.state, this.bus, this.clock, this.data.chains),
      energy: new EnergySystem(this.state, this.bus, this.clock),
      generator: new GeneratorSystem(this.state, this.bus, this.clock, this.data.chains),
      jobs: new DragonJobSystem(this.state, this.bus, this.clock, this.data.chains),
      order: new OrderSystem(this.state, this.bus, this.data.orders),
      milestone: new MilestoneSystem(this.state, this.bus, this.data.milestones),
      emberfont: new EmberfontSystem(this.state, this.bus, this.clock, this.data.emberfont),
      duel: new DragonDuelSystem(this.state, this.bus, this.data.chains),
      economy: new EconomySystem(this.state, this.bus, this.data.chains),
      reward: new RewardSystem(this.bus),
      chest: new ChestSystem(this.state, this.bus, this.clock),
      unlock: new UnlockSystem(this.state, this.bus, this.clock, this.data.chains, this.data.map),
      tasks: new TaskSystem(this.state, this.bus, this.data.tasks),
      worldTeleport: new WorldTeleportSystem(this.bus),
      quest: new QuestSystem(
        this.state,
        this.bus,
        this.data.quests,
        this.data.tutorial,
        this.data.worldTutorials
      ),
      feed: new DragonFeedSystem(this.state, this.bus, this.clock, this.data.chains),
      day: new DayCycleSystem(this.bus, this.clock),
      save,
      tutorial: new TutorialDirector(
        this.state,
        this.bus,
        this.clock,
        this.data.tutorial,
        this.data.worldTutorials
      )
    };
    this.bus.on('game:reset_requested', () => this.resetGame());
  }

  /**
   * Restores the GROUND the save's coordinates stand on — the live world's playable
   * cells, its backdrop and its cell lattice. Set by the Map Editor, which owns all
   * three; absent in the node tests and in the shipped game with no editor project,
   * where the authored world is the only world and is already live.
   */
  worldPreparer?: (activeWorld: string) => Promise<void>;

  /**
   * Called once the gameplay scenes are subscribed: load the save or start fresh.
   *
   * The order below is the fix for a whole class of "everything is scrambled when I
   * reopen, and a refresh puts it right" bugs. It used to announce the loaded save
   * immediately and let the Map Editor restore the world afterwards, asynchronously —
   * leaving a window, a second long on a cold load, in which the game was live and
   * autosaving with one world's pieces standing on another world's cells at another
   * world's pitch. A refresh only looked like a cure: it made the window short and
   * gave the offline harvest nothing to bank.
   */
  async beginRun(): Promise<void> {
    if (this.running) return;
    this.running = true;
    // 1 — put the board in place, silently. Both branches go through GameState.reset,
    //     which clears the editor's cell overrides — so both must come BEFORE the
    //     world is restored, or the restore is thrown away the moment it lands.
    const loaded = this.systems.save.hydrateOnly();
    if (!loaded) {
      this.systems.save.suspend(() => this.systems.board.newGame());
      // Only write the fresh game when there was NOTHING stored. If bytes exist that
      // we could not read, saving here would stamp a brand-new game over the player's
      // progress and make a transient read failure permanent — which is exactly how a
      // level-3 game came back as level 1. SaveSystem has set the unreadable copy
      // aside; the first real action will save normally from here.
      if (!this.systems.save.hasRawSave()) this.systems.save.save();
    }
    // 2 — restore the world those coordinates are written in, and WAIT for it. The
    //     save knows which world the player was standing in; only after this do its
    //     cells, its lattice and its backdrop mean anything.
    await this.worldPreparer?.(this.state.activeWorld);
    // 3 — now announce. Every catch-up (offline gifts, regen, the day cycle) runs
    //     against a board that is finally itself.
    if (loaded) this.systems.save.announceLoaded();
    else this.systems.order.announceProgress();
    this.systems.tutorial.begin();
    // Board is live and state is settled (post load/newGame). The Map Editor has
    // already restored the world via `worldPreparer`; this beat remains for everyone
    // else, and is its fallback when no preparer is wired.
    this.bus.emit('game:started', {});
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
