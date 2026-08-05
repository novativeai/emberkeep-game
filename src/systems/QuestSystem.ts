import { PRIMARY_WORLD, type GameState } from '../core/GameState';
import type { EventBus } from '../core/EventBus';
import type { QuestDef, QuestState, QuestsData, TutorialData, WorldTutorials } from '../core/types';

/**
 * The game's OBJECTIVE tracker, broadcast to the HUD quest panel via `quest:changed`:
 *   - the MAIN quest from quests.json ("Teleport into the Lair") — done once a real
 *     `world:switched` has happened this session;
 *   - the tutorial steps as SUB-quests (one per action step carrying a `task` title),
 *     each done once the director has advanced past it.
 * The sub-quests are the LIVE world's lesson: stand in borealis and the checklist is
 * borealis' own, ticked from that world's progress, because a checklist you cannot
 * act on from where you are standing is just noise.
 * Phaser-free — completion is DERIVED from state (no extra save fields). It
 * re-announces on every event that can change either, so the panel stays live.
 */
export class QuestSystem {
  private teleported = false;
  private world = PRIMARY_WORLD;

  constructor(
    private state: GameState,
    private bus: EventBus,
    private data: QuestsData,
    private tutorial: TutorialData,
    private worldTutorials: WorldTutorials = {}
  ) {
    bus.on('world:switched', ({ toWorld }) => {
      this.teleported = true;
      this.world = toWorld;
      this.announce();
    });
    bus.on('world:return', () => {
      this.world = PRIMARY_WORLD;
      this.announce();
    });
    bus.on('quest:complete', ({ id }) => {
      if (id === 'teleport_lair') this.teleported = true;
      this.announce();
    });
    bus.on('tutorial:step', () => this.announce()); // a sub-quest just ticked
    bus.on('tutorial:done', () => this.announce());
    bus.on('dragon:fed', () => this.announce());
    bus.on('keeper:leveled', () => this.announce());
    // A save remembers the world you were standing in, so the checklist has to come
    // back with it — otherwise a session resumed in the north lists the isle's steps.
    bus.on('state:loaded', () => {
      this.world = this.state.activeWorld;
      this.announce();
    });
    bus.on('game:started', () => this.announce());
  }

  private isDone(q: QuestDef): boolean {
    // The teleport fires AT tutorial completion (WORLD_TELEPORT trigger='tutorial_done'),
    // so `tutorialDone` — which persists in the save — keeps this ticked across reloads,
    // even though the live `world:switched` flag resets each session.
    if (q.id === 'teleport_lair') return this.teleported || this.state.tutorialDone;
    if (q.id === 'feed_red_dragon') return this.state.dragonStat('ember_dragon').level >= (this.data.feedTargetLevel ?? 2);
    return false;
  }

  /** The live world's ACTION steps (those given a `task` title) — its checklist. */
  private subsFor(worldId: string): { id: string; title: string; index: number }[] {
    const script = worldId === PRIMARY_WORLD ? this.tutorial : this.worldTutorials[worldId];
    return (script?.steps ?? [])
      .map((s, index) => ({ id: s.id, title: s.task ?? '', index }))
      .filter((s) => s.title !== '');
  }

  /** Broadcast the current quest list + done flags to the HUD: MAIN quests first,
   *  then the tutorial-step sub-quests (ticked from the director's progress). */
  announce(): void {
    const mains: QuestState[] = this.data.quests.map((q) => ({ ...q, done: this.isDone(q) }));
    const worldDone = this.state.tutorialDoneFor(this.world);
    const worldIndex = this.state.tutorialIndexFor(this.world);
    const subs: QuestState[] = this.subsFor(this.world).map((s) => ({
      id: s.id,
      kind: 'sub',
      title: s.title,
      done: worldDone || worldIndex > s.index
    }));
    this.bus.emit('quest:changed', { quests: [...mains, ...subs] });
  }
}
