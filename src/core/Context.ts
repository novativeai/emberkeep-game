import { BagSystem } from '../systems/BagSystem';
import { StoreSystem } from '../systems/StoreSystem';
import { BoardSystem } from '../systems/BoardSystem';
import { CauldronSystem } from '../systems/CauldronSystem';
import { ChestSystem } from '../systems/ChestSystem';
import { DragonJobSystem } from '../systems/DragonJobSystem';
import { DragonLifeSystem } from '../systems/DragonLifeSystem';
import { DragonSystem } from '../systems/DragonSystem';
import { EconomySystem } from '../systems/EconomySystem';
import { EnergySystem } from '../systems/EnergySystem';
import { GeneratorSystem } from '../systems/GeneratorSystem';
import { IapSystem } from '../systems/IapSystem';
import { MergeSystem } from '../systems/MergeSystem';
import { OrderSystem } from '../systems/OrderSystem';
import { QuestSystem } from '../systems/QuestSystem';
import { RegardSystem } from '../systems/RegardSystem';
import { RevealSystem } from '../systems/RevealSystem';
import { RewardSystem } from '../systems/RewardSystem';
import { SaveSystem, type StorageLike } from '../systems/SaveSystem';
import { StorySystem } from '../systems/StorySystem';
import { WorldCharacterSystem } from '../systems/WorldCharacterSystem';
import { WorldSystem } from '../systems/WorldSystem';
import { TaskSystem } from '../systems/TaskSystem';
import { TutorialDirector } from '../systems/TutorialDirector';
import { UnlockSystem } from '../systems/UnlockSystem';
import { EventBus } from './EventBus';
import { GameClock } from './GameClock';
import { GameState } from './GameState';
import type {
  AnchorsData,
  AssetsManifest,
  CauldronData,
  ChainsData,
  CharactersData,
  DialogueData,
  DragondexData,
  MapData,
  OrdersData,
  QuestsData,
  StoreData,
  TasksData,
  TutorialData
} from './types';
import anchorsJson from '../data/anchors.json';
import assetsJson from '../data/assets.json';
import cauldronJson from '../data/cauldron.json';
import chainsJson from '../data/chains.json';
import charactersJson from '../data/characters.json';
import dialogueJson from '../data/dialogue.json';
import dragondexJson from '../data/dragondex.json';
import mapJson from '../data/map.json';
import ordersJson from '../data/orders.json';
import questsJson from '../data/quests.json';
import storeJson from '../data/store.json';
import tasksJson from '../data/tasks.json';
import tutorialJson from '../data/tutorial.json';

export interface GameData {
  cauldron: CauldronData;
  chains: ChainsData;
  orders: OrdersData;
  map: MapData;
  tutorial: TutorialData;
  assets: AssetsManifest;
  anchors: AnchorsData;
  dialogue: DialogueData;
  tasks: TasksData;
  characters: CharactersData;
  store: StoreData;
  quests: QuestsData;
  dragondex: DragondexData;
}

export interface GameSystems {
  board: BoardSystem;
  cauldron: CauldronSystem;
  merge: MergeSystem;
  energy: EnergySystem;
  generator: GeneratorSystem;
  jobs: DragonJobSystem;
  order: OrderSystem;
  economy: EconomySystem;
  iap: IapSystem;
  reward: RewardSystem;
  reveal: RevealSystem;
  chest: ChestSystem;
  unlock: UnlockSystem;
  tasks: TaskSystem;
  quests: QuestSystem;
  regard: RegardSystem;
  bag: BagSystem;
  store: StoreSystem;
  story: StorySystem;
  characters: WorldCharacterSystem;
  worlds: WorldSystem;
  dragons: DragonSystem;
  dragonLife: DragonLifeSystem;
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
      cauldron: cauldronJson as unknown as CauldronData,
      chains: chainsJson as unknown as ChainsData,
      orders: ordersJson as unknown as OrdersData,
      map: mapJson as unknown as MapData,
      tutorial: tutorialJson as unknown as TutorialData,
      assets: assetsJson as unknown as AssetsManifest,
      anchors: anchorsJson as unknown as AnchorsData,
      dialogue: dialogueJson as unknown as DialogueData,
      characters: charactersJson as unknown as CharactersData,
      tasks: tasksJson as unknown as TasksData,
      store: storeJson as unknown as StoreData,
      quests: questsJson as unknown as QuestsData,
      dragondex: dragondexJson as unknown as DragondexData,
      ...overrides
    };
    this.state = new GameState(this.data.map);
    const save = new SaveSystem(this.state, this.bus, this.clock, storage);
    // The quest ladder READS these two (their getters only, never a command into
    // them), so the encore queue and the Keeper's Tasks each keep exactly one
    // definition. They are hoisted out of the literal for that reason alone.
    const order = new OrderSystem(this.state, this.bus, this.data.orders);
    const tasks = new TaskSystem(this.state, this.bus, this.data.tasks);
    // Hoisted for the same reason: RegardSystem READS the ladder (which gift a
    // person is currently asking for is a quest step, never a second want-list),
    // so the ladder has to exist before it. The dependency runs one way only —
    // QuestSystem reads Regard's points straight off `state.stats` — and that is
    // what keeps the pair acyclic.
    const quests = new QuestSystem(
      this.state,
      this.bus,
      this.data.quests,
      this.data.chains,
      order,
      tasks
    );
    // Hoisted so DragonLifeSystem can READ them. Ambient life decides what a
    // dragon is doing by asking the systems that already know — its care record
    // (DragonSystem) and whether it is out working (DragonJobSystem) — rather
    // than keeping a second hunger clock of its own.
    const jobs = new DragonJobSystem(this.state, this.bus, this.clock, this.data.chains);
    const dragons = new DragonSystem(this.state, this.bus, this.clock, this.data.chains);
    this.systems = {
      board: new BoardSystem(this.state, this.bus, this.clock, this.data.chains),
      cauldron: new CauldronSystem(this.state, this.bus, this.data.cauldron),
      merge: new MergeSystem(this.state, this.bus, this.clock, this.data.chains),
      energy: new EnergySystem(this.state, this.bus, this.clock),
      generator: new GeneratorSystem(this.state, this.bus, this.clock, this.data.chains),
      jobs,
      order,
      economy: new EconomySystem(this.state, this.bus, this.data.chains),
      iap: new IapSystem(this.state, this.bus),
      reward: new RewardSystem(this.bus),
      reveal: new RevealSystem(this.state, this.bus),
      chest: new ChestSystem(this.state, this.bus, this.clock, this.data.chains),
      unlock: new UnlockSystem(this.state, this.bus, this.clock, this.data.chains),
      tasks,
      quests,
      regard: new RegardSystem(this.state, this.bus, this.data.characters, quests),
      bag: new BagSystem(this.state, this.bus),
      store: new StoreSystem(this.state, this.bus, this.data.store),
      story: new StorySystem(this.state, this.bus, this.data.dialogue),
      characters: new WorldCharacterSystem(
        this.state,
        this.bus,
        this.clock,
        this.data.characters,
        this.data.chains
      ),
      dragons,
      dragonLife: new DragonLifeSystem(this.state, this.bus, this.clock, dragons, jobs),
      worlds: new WorldSystem(this.state, this.bus),
      save,
      tutorial: new TutorialDirector(this.state, this.bus, this.clock, this.data.tutorial)
    };
    this.bus.on('game:reset_requested', () => this.resetGame());

    /**
     * WHERE THE KEEPER WAS STANDING — answered here, before a single scene runs.
     *
     * The save has always carried `activeWorld`, and `hydrate` has always
     * restored it. The trouble was WHEN: the boot order is PreloadScene →
     * BoardScene → UIScene, and it is UIScene that calls `beginRun`. So the
     * board was fully BUILT for the authored world — its ground, its backdrop,
     * its fog, its portals — and only then did the save quietly move the state
     * to Borealis. Nothing rebuilds a scene for a switch that never went
     * through WorldSystem, so the player came home to Emberkeep's board with
     * Borealis's name on the state: the wrong doors, fog over ground they had
     * already bought, and only a round trip through another world (which DOES
     * go through WorldSystem, and restarts the scene) put it right.
     *
     * `peek` is the same version-checked read `load` uses, so a save this build
     * would discard restores nothing, and a fresh `newGame` resets the active
     * world anyway. This costs one JSON parse at boot and makes every scene
     * downstream — the backdrop PreloadScene fetches included — build the world
     * the player actually left.
     */
    const wasOn = save.peek()?.activeWorld;
    if (wasOn) this.state.switchWorld(wasOn);
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
