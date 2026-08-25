import Phaser from 'phaser';
import type { GameContext } from '../core/Context';
import {
  ANIMATED_TILE_NAMES,
  ATMOSPHERE,
  CAULDRON_DECOR,
  CHEST_INTERVAL_MS,
  DECOR_SCALE,
  DEPTHS,
  DRAG,
  DRAGON_ANIM,
  DRAGON_CLIPS,
  DRAGON_NAP_LENGTH_MS,
  GATE_FLIGHT,
  decorClipCharacter,
  MERGE_HINT,
  MERGE_READY,
  DRAGON_RIG_SCALE,
  CRYSTAL_3D,
  EMBER_MOTES,
  FINALE,
  GATE_FX_HEIGHT,
  ROOTHOLD_HOUSE,
  FINALE_ENDS_MS,
  GATE_LESSON_STAT,
  FINALE_REGION,
  LIVE_GAME_WIDTH,
  GOLDEN_ALTAR,
  GOLDEN_CHAIN,
  GOLDEN_ELDER_TIER,
  GOLDEN_TINT,
  GOLDEN_TREMBLE_PROGRESS,
  ITEM_SCALE,
  LEVEL_XP,
  LIVE_GAME_HEIGHT,
  num,
  PALETTE,
  POWER,
  SCENES,
  skipEnergyCost,
  skipWarmthCost,
  STANDEE_BANKS,
  STANDEE_BREATH,
  STANDEE_CLIP_BLINK,
  STANDEE_SCALE_TRIM,
  DRAGON_OUTLINE,
  DRAGON_ROAR_EVERY_MS,
  DRAGON_REST_MS,
  DRAGON_ROAR_MS,
  DRAGON_SLEEP_SCALE,
  DRAGON_WAKE_MS,
  DRAGON_WANDER_ARC,
  DRAGON_WANDER_FLIGHT_MS,
  PRODUCE_BADGE_LIFT,
  PRODUCE_BADGE_R,
  SLEEP_BREATH,
  STANDEE_SHADOW_DX,
  STANDEE_SHADOW_DY,
  STANDEE_SHADOW_SQUASH,
  SKIP_KEYS,
  STANDEE_SHADOW_WIDTH,
  TAP_MAX_DISTANCE_PX,
  TAP_MAX_MS,
  TILE_H,
  TILE_W,
  TUTORIAL_FOLLOW_INSET,
  TUTORIAL_FOLLOW_MS,
  TIMINGS,
  WORLD_ID
} from '../core/Constants';
import { FONT as FONT_FAMILIES } from '../art/design';
import {
  type CharacterClip,
  clipFor,
  clipKey,
  clipsFor,
  clipTextureRect,
  dragonClipCharacter,
  originFor,
  sleepFrameFor
} from '../core/characterAnims';
import { type ClipRef, clipLoadTiers, planClipEviction } from '../core/dragonClips';
import { type HintBoard, type MergeStep, nextMergePlan } from '../core/mergeHints';
import { gatherSeat, matches, readyClusters, type ReadyCluster, verdictOnto } from '../core/mergeRule';
import { LoadQueue } from '../core/LoadQueue';
import { ensureTextures } from '../core/lazyTextures';
import { plateScale } from '../core/artScale';
// The ONE thing the running game asks the editor: does it currently own the
// pointer (see `wireCameraNav`). Deliberately nothing else — the board's map
// data comes from the generated `zones.json`, never from the live store. Safe to
// pull into the main bundle: `editorStore` imports only `./lattice`, has no
// constructor and does no work at module load.
import { editorStore } from '../editor/editorStore';
import { gridToWorld } from '../core/iso';
import { guard, recordError } from '../core/crash';
import { releaseAwayWorldArt, worldArtKeys } from '../core/worldArt';
import { artScaleAt, groundCellAtWorldPoint, nearestPlayableCell, setActiveWorld, worldPointOf, zoneAt } from '../core/world';
import { POWER_STATE_EVENT, PowerGovernor, PowerState } from '../core/PowerGovernor';
import { cappedTier } from '../core/graphics';
import { GRAPHICS_EVENT, graphics, liveCrystalAvailable } from '../core/graphicsState';
import { CRYSTAL_SPIN, CRYSTAL_SPIN_KEY } from '../core/crystalSpin';
import { renderScale } from '../core/render-scale';
import type {
  BoardItemState,
  GeneratorConfig,
  ItemSnapshot,
  ResolvedArrow,
  ResolvedHand,
  TilePos,
  TutorialAllow,
  TutorialStepEvent
} from '../core/types';
import facesJson from '../data/faces.json';
import { BoardItem } from '../entities/BoardItem';
import { PortalFX } from '../entities/PortalFX';
import type { Crystal3D } from '../render/Crystal3D';
import type { FacesData } from '../render/faceAnimations';
import { FlipbookFX, RAMP_TEXTURE } from '../render/FlipbookFX';
import { EMITTER_PRESETS } from '../render/fx/emitterAssets';
import { resolvePlacement } from '../render/fx/emitterPlacements';
import { FxDirector } from '../render/fx/FxDirector';
import type { FxEmitterRig } from '../render/fx/EmitterFX';
import { auraInstanceFor, auraKey, type EggAuraFile } from '../render/fx/eggAura';
import eggAuraJson from '../data/egg-aura.json';
import { AuroraFX, type AuroraPresetFile } from '../render/fx/AuroraFX';
import { SnowFX, type SnowPresetFile } from '../render/fx/SnowFX';
import type { WeatherFile } from '../render/fx/weatherConfig';
import auroraJson from '../data/aurora.json';
import snowJson from '../data/snow.json';
import weatherJson from '../data/weather.json';
import emittersJson from '../data/emitters.json';
import { BEATS, sheetOf, type BeatKey } from '../render/vfxBank';
import { RigPlayer } from '../render/RigPlayer';
import { keylineUnits } from '../render/rigInkGeometry';
import { attachSpriteInk, hideSpriteInk, syncSpriteInk } from '../render/SpriteInk';
import type { RigDoc } from '../render/rigTypes';
import { hopTo, hoverBob, popIn, scalePulse } from '../ui/tweens';
import { isDragonFood } from '../systems/DragonSystem';

/** A featured live-rigged dragon overlaying its (invisible) interactive host. */
interface LiveDragon {
  /**
   * The rig puppet — NULL for a clip-complete breed, which is the whole point
   * of the Emporium roster: a bought Frost dragon that animated on the red
   * dragon's rig was a red dragon wearing frost paint. A breed whose clip set
   * carries the animal builds no rig at all.
   */
  player: RigPlayer | null;
  /** 1 = the source art's own leftward facing, −1 = mirrored. Held HERE rather
   *  than read off the rig container, which a clip-only breed does not have. */
  facing: 1 | -1;
  host: BoardItem;
  shadow: Phaser.GameObjects.Image; // ground shadow scaled to the rig
  mode: 'hover' | 'idle';
  remainMs: number; // countdown until the next mode roll
  busy: boolean; // flying out to work a plant — pause idle rolls + further taps
  /** Calm ADULT cadence: rare, unhurried low-flights and long idles. */
  calm: boolean;
  /** Ambient mood (DragonLifeSystem owns it; this is the last one rendered).
   *  While `asleep` the rig is hidden and the curled sleep art stands in, so
   *  the idle/hover roll is suspended — a sleeping dragon must not fidget. */
  mood: 'awake' | 'hungry' | 'asleep';
  /** Clock ms until the next hungry roar; only counts down while `hungry`. */
  roarInMs: number;
  /** The floating 💤, while it sleeps — a container so `syncDragon` can carry
   *  it with the host (a sleeping dragon can still be dragged) while the drift
   *  tween animates the text INSIDE it, in host-local space. */
  zzz?: Phaser.GameObjects.Container;
  /** The Align-Studio clip sprite (fly loop / tosleep transition) standing in
   *  for the rig while it plays — created lazily, carried by `syncDragon`. */
  clipOverlay?: Phaser.GameObjects.Sprite;
  /** Where the fly clip is in its arc — null when grounded (rig showing). */
  flightPhase: 'takeoff' | 'loop' | 'landing' | null;
  /** Whether the curled sleep art is on the tile. Sleep is DEFERRED while the
   *  dragon is airborne — falling asleep mid-flight is how it once slept in
   *  the air (and how a cleared transition once left it fully invisible). */
  sleepState: 'none' | 'transition' | 'seated';
  /** Whether the HOST is currently wearing the curled sleep painting.
   *
   *  Deliberately separate from `sleepState`, which is about the ANIMATION and
   *  gets cleared out from under the art: `dragonHover` resets it to 'none' on
   *  any flight ordered over a sleeper, so the later wake read "nothing to
   *  undo" and left the host in curled clothes — a dragon standing up on screen
   *  whose hit target was still a 160-unit ball. What is DRAWN needs its own
   *  record, and this is it. */
  wearingSleepArt: boolean;
  /** True from the moment a sleep starts unfolding until the wake clip has
   *  finished. A dragon is not a working generator during it — the tap that
   *  woke it is the whole gesture, and harvesting through the uncurl would
   *  pay out over an animal still visibly getting up. */
  waking: boolean;
}

/** Where the camera sits to frame a given Keeper level (world centre + zoom). */
interface CameraFrame {
  x: number;
  y: number;
  zoom: number;
}

/** Zero velocity AND acceleration at both ends — no perceptible start/stop. */
const smootherstep = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** The crystal's SHARED art key — the live 3D gem takes it over so every consumer
 *  gets the emerald without knowing it exists — and the private key its painted
 *  fallback is parked under while it does (see `restoreCrystalArt`). */
const CRYSTAL_KEY = 'item_crystal_1';
const CRYSTAL_PNG = 'item_crystal_1__painted';

/** RIGS ARE OFF ON THIS BRANCH — every dragon is sequence (clip) animated
 *  from src/data/character-anims.json, which covers the complete roster:
 *  red 3/4, bare emerald 3/4, golden, ashdrake, rimewyrm, the frost and storm
 *  breeds, and every Emporium skin (moonwhisker/porcelain on emerald,
 *  ashglass on red). The table stays as the OFF SWITCH the rig plumbing keys
 *  on: empty means no rig ever fetches, builds, or wins a race against the
 *  clips. Re-enabling a breed's puppet is one entry here, not a revert. */
const DRAGON_RIGS: Record<string, string> = {};

/** The DRAGON_RIGS key an item resolves to: its tier-specific rig if one is
 *  declared, else the chain's default rig. */
const rigKeyFor = (chain: string, tier: number): string =>
  DRAGON_RIGS[`${chain}:${tier}`] !== undefined ? `${chain}:${tier}` : chain;

/** ADULT dragons animate as calm elders (see DRAGON_ANIM.adult*): the Red
 *  Adult and the Golden Elder — whelps keep the lively cadence. Keyed by rig
 *  CHARACTER, so a breed lands here when it is rigged rather than when it is
 *  finally given a chain — an adult that reads as a whelp is the kind of thing
 *  nobody notices until the animal is already on the board. */
const CALM_DRAGONS = new Set([
  'dragon-red-adult',
  'dragon-emerald-adult',
  'dragon-golden',
  'dragon-frost-adult',
  'dragon-storm-adult',
  'dragon-moonwhisker-adult'
]);
/** Canonical character id for a rig exported with the tool's default name —
 *  MUST match characterCatalog ids and the faces.json keys (calibrate-faces). */
const DRAGON_RIG_NAMES: Record<string, string> = {
  golden_egg: 'dragon-golden'
};

/** Pre-rendered face frame sets (blink / roar-talk) per rig character —
 *  calibration generated by scripts/calibrate-faces.mjs. Characters without an
 *  entry keep the puppet-only face (adaptive fallbacks in rigAnimations). */
const FACES = facesJson as FacesData;
const faceTextureKey =
  (character: string) =>
  (setKey: string, frameIndex: number): string =>
    `face:${character}:${setKey}:${frameIndex}`;

const FONT = FONT_FAMILIES.ui;

/** The baked BODY box of a standee — never its frame, which also holds the
 *  scepter blaze and the ember bolt. */
interface HitBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A world character's tap area, in TEXTURE space so `setScale` cannot shift it.
 *
 * `whole` widens it from her lower body to all of her, so that her HEAD answers
 * a tap whenever a tap on her means something. It is only half the shape: the
 * rect is a coarse bound and `standeeOpaqueAt` decides inside it, which is what
 * stops a two-tile-tall box from swallowing the cells drawn behind her.
 */
function characterHitRect(b: HitBox, whole: boolean): Phaser.Geom.Rectangle {
  return whole
    ? new Phaser.Geom.Rectangle(b.x, b.y, b.width, b.height)
    : new Phaser.Geom.Rectangle(b.x + b.width * 0.1, b.y + b.height * 0.55, b.width * 0.8, b.height * 0.45);
}

/** A sprite's authored resting scale. World standees render well under 1, so
 *  every pulse/tween must be relative to this rather than to a literal 1. */
const baseScaleOf = (sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image): number =>
  (sprite.getData('baseScale') as number | undefined) ?? 1;

const NO_ALLOW: Required<TutorialAllow> = {
  drag: [],
  codexHold: false,
  feed: false,
  commission: false,
  status: false,
  give: false,
  tapGenerators: false,
  ledger: false,
  deliver: false,
  fog: false,
  sell: false,
  dragonWork: false,
  marketplace: false,
  cookbook: false,
  bag: false,
  character: false
};

/**
 * What letting go RIGHT NOW would do — the four looks of the drag reticle.
 * `move` is a drop onto free ground and nothing else. `merge` and `gather` are
 * `verdictOnto`'s own words. `refuse` is every drop MergeSystem answers with
 * `item:move_bounced`: an occupied cell that is not a merge question (a
 * stranger, or a chain at the top of its ladder), and a match with nowhere to
 * seat the gathered piece. It exists because `move` used to cover those too,
 * and a gold frame over a tile the piece cannot land on is the picture telling
 * the player something the rule will not honour.
 */
type DropVerb = 'move' | 'merge' | 'gather' | 'refuse';

/** One thing the board is pointing at: a piece, the cell it strains toward, and
 *  whether it does so at the hint's louder volume. See `syncReadyLeans`. */
interface LeanAsk {
  id: number;
  to: TilePos;
  boosted: boolean;
}

/**
 * Where a carried piece is over, resolved ONCE for both the reticle and the
 * drop. `cell` is the address the drop will name; `target` is the matching
 * piece standing there (by cell or by its art — see `resolveDrop`), or null
 * when the cell is free or holds something else.
 */
interface DropHover {
  cell: TilePos;
  target: BoardItemState | null;
}

/**
 * Presentation of the isle: ground diamonds + cliff skirts, ash-fog over
 * locked regions, pooled BoardItems, drag/tap input (gated by the tutorial),
 * and every piece of merge/hatch/harvest/unlock juice. All game decisions
 * happen in systems — this scene only emits intents and reacts to events.
 */
export class BoardScene extends Phaser.Scene {
  private ctx!: GameContext;
  private itemSprites = new Map<number, BoardItem>();
  /** Reported once per run — see `reseatFixtures`. */
  private fixtureDrifted = false;
  private pool: BoardItem[] = [];
  private tiles = new Map<string, Phaser.GameObjects.Image>();
  private fog = new Map<string, Phaser.GameObjects.Image>();
  /** Floating "skip cooldown" button + the generator it belongs to. */
  private skipButton?: Phaser.GameObjects.Container;
  private skipGoldLabel?: Phaser.GameObjects.Text;
  private skipWarmthLabel?: Phaser.GameObjects.Text;
  private skipForId = 0;
  private skipMaxGold?: number; // per-generator gold cap for the live skip price
  /** Dragon job menu (Work / Harvest) + the dragon it belongs to. */
  /** Countdown pill floating above a rig-hosted dragon: the BoardItem's own
   *  pill renders UNDER the rig (glued at host.depth + 0.5), so the timer
   *  lives in a scene-level badge instead. Keyed by dragon itemId. */
  private coolBadges = new Map<number, Phaser.GameObjects.Container>();
  /** Camera pose to return to after the tutorial's golden-egg tease. */
  private teaseReturn: { x: number; y: number; zoom: number } | null = null;
  /** The altar egg's post-tease golden aura (paired with its float tween). */
  private eggAura?: Phaser.GameObjects.Image;
  /** Styled "Zzz" fatigue badge (Container) over a resting dragon. */
  private restBadges = new Map<number, Phaser.GameObjects.Container>();
  /** A commissioned House wears what it makes. Without it a locked choice is
   *  invisible — two Houses look identical and the player has no way to tell
   *  which one is the Gem Shard press. Keyed by item id. */
  private produceBadges = new Map<number, Phaser.GameObjects.Container>();
  /** One floating key badge per key-locked region, so it reads as "needs a key". */
  private keyBadges = new Map<string, Phaser.GameObjects.Image>();
  /** Badges waiting for their reveal cinematic, played one at a time. */
  private keyRevealQueue: Phaser.GameObjects.Image[] = [];
  private keyRevealPlaying = false;
  private highlights: Phaser.GameObjects.Image[] = [];
  private allow: Required<TutorialAllow> = { ...NO_ALLOW };
  private tutorialDone = false;
  /** World-character standees, by character id. Not BoardItems — never pooled,
   *  never in `state.items`. */
  private characterSprites = new Map<string, Phaser.GameObjects.Sprite>();
  /** Standees mid one-shot reaction (cast/happy/laugh). */
  private standeeReacting = new Set<string>();
  /** Her five hearts, floating over her. On the PERSON, never in a menu: the
   *  relationship belongs to her, and a gauge tucked behind a panel button is a
   *  gauge nobody watches move. Keyed by character id. */
  /** Standees currently breathing, with the phase that keeps them out of step.
   *  A sprite joins only once its landing settle is done (both write scaleY). */
  private breathing: { sprite: Phaser.GameObjects.Sprite; phase: number }[] = [];
  /** The armed recipient waiting for a board target, if any. Eleanor's help, a
   *  Cold Nest offering and feeding a dragon are one gesture — tap the
   *  recipient, then tap the thing — so they share one slot and can never both
   *  claim the same tap. */
  private armed: { kind: 'character' | 'nest' | 'companion'; id: string; col?: number; row?: number } | null = null;
  private armedTween: Phaser.Tweens.Tween | null = null;
  /** Who the status readout is pointed at. Separate from `armed` on purpose —
   *  see `selectSubject`. A dragon's id is its board item id as a string. */
  private selected: { kind: 'character' | 'dragon'; id: string } | null = null;
  /**
   * A piece taken out of the satchel and held out, waiting for a recipient.
   *
   * The bag's GIVE verb arms this and closes itself; the next tap on a person or
   * a dragon delivers it. Held on the SCENE rather than in GameState because it
   * is a gesture in progress, not a fact about the world — a reload mid-gesture
   * should find the piece still in the bag, which it does.
   */
  private pendingGive: { chain: string; tier: number } | null = null;
  /** When the give was armed — the arming click's own POINTER_UP must not cancel it. */
  private giveArmedAtMs = 0;
  /**
   * Did anything on the board claim the tap in progress?
   *
   * Set by the handlers Phaser itself dispatches to, which is the only
   * trustworthy answer to "was this tap on something" — see the pointer-up
   * handler in `wireCameraNav` for what went wrong when this was a hit test.
   */
  private tapClaimed = false;
  /** The breathing tweens on every valid recipient while a give is armed. */
  private giveTweens: Phaser.Tweens.Tween[] = [];
  /** Companion standees, by companion id. Named dragons are never BoardItems. */
  private companionSprites = new Map<string, Phaser.GameObjects.Image>();
  private tutorialStepId = ''; // current tutorial step id (drives in-board hints)
  /** The live step, kept whole so the pointer can be re-followed mid-step — a
   *  beat that hands its arrow on (`arrowThen`) moves the target without ever
   *  emitting a new step. */
  private tutorialStep: TutorialStepEvent | null = null;
  private dragFrom: TilePos | null = null;
  /** Live drag: the lifted sprite eases toward this pointer-tracked target. */
  private dragSprite: BoardItem | null = null;
  private dragTarget = { x: 0, y: 0 };
  /** The reticle currently on screen — always one of `dragCells`. Everything
   *  that shows or hides "the" reticle goes through this handle, so the verb
   *  swap in `updateDrag` is the only place that knows there are three. */
  private dragCell!: Phaser.GameObjects.Graphics;
  /** One reticle per drop verb, painted once in `buildDragCell`. Three graphics
   *  and a visibility swap, rather than a redraw on every verb change: a drag
   *  crosses a dozen cells a second, and a Graphics redraw is a command-buffer
   *  rebuild each time, for something that only ever has three looks. */
  private dragCells!: Record<DropVerb, Phaser.GameObjects.Graphics>;
  /**
   * THE LEAN's bookkeeping (see `syncReadyLeans`). `leans` is keyed by item id
   * and holds the tween on that piece's `leanX`/`leanY` — or, once the cluster
   * stops being ready, the short tween easing it back to its seat (`returning`),
   * kept in the map so the next sync cannot lay a fresh lean over a return that
   * is still writing the same two properties.
   *
   * `aim` IS THE WHOLE FRESHNESS TEST. A lean's direction is computed ONCE, in
   * `startLean`, from where the piece stands and where it is being sent, and
   * the tween then repeats for ever — so a sync that decides "already up" from
   * the ids alone can never re-aim it. That is not hypothetical: a tutorial
   * hand re-resolves its target every time the board moves, and the idle hint
   * re-plans on every spawn; both keep the same piece and change only the
   * DESTINATION, and the piece went on straining at ground the target had left
   * while the hand pointed somewhere else. So the entry records the origin
   * cell, the destination cell and the volume it was drawn at, and a standing
   * lean counts as fresh only when all three still match the ask.
   */
  private leans = new Map<
    number,
    { sprite: BoardItem; tween: Phaser.Tweens.Tween; returning: boolean; aim: string }
  >();

  /** The governor has dozed the scene: the lean is ambience, and stops with the
   *  rest of it. The clusters are re-read, and re-lean, on the first wake. */
  private leanDozing = false;

  /**
   * Items mid-crossing (`flyThroughGate`). The lean's stillness gate asks
   * `tweens.isTweening(sprite)`, and a gate flight is driven from a proxy
   * object whose `onUpdate` writes the sprite — invisible to that question. The
   * piece's STATE cell also stays put until the crossing commits, so without
   * this both the flyer and the partner it left behind go on leaning: one in
   * mid-air, the other at a cell with nothing in it.
   */
  private crossing = new Set<number>();
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private shells!: Phaser.GameObjects.Particles.ParticleEmitter;
  private offBus: (() => void)[] = [];
  private regenAccum = 0;
  private coolAccum = 0;
  /** The ember-dragon rig, loaded once and reused for every hatchling/whelp. */
  private dragonRigs = new Map<string, RigDoc>();
  private liveDragons = new Map<number, LiveDragon>();
  /** Dragon item ids currently flying a cosmetic worker flourish. */
  private busyDragons = new Set<number>();
  /** Per-level camera framing + the active level-up glide. */
  private levelFrames = new Map<number, CameraFrame>();
  private flyTween?: Phaser.Tweens.Tween;
  private panFrom: { px: number; py: number; sx: number; sy: number } | null = null;
  /** Live Three.js emerald crystal driving the `item_crystal_1` texture (the
   *  Theme-Crystal generator's look) + any authored 3D-decor placement. */
  private crystal3d?: Crystal3D;
  private crystalTex?: Phaser.Textures.CanvasTexture;
  /** Authored 3D-decor sprites wearing the crystal texture. Held so a LATE live
   *  gem (the import is dynamic now) can re-point them off the destroyed frame. */
  private crystalDecor: Phaser.GameObjects.Image[] = [];
  /** Battery governor (registry; set in main.ts — absent in bare-scene tests). */
  private power?: PowerGovernor;
  private crystalLastRender = 0;
  /** The always-on ambience gated off in doze: 2 updrafts + the firefly swarm. */
  private ambientEmitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private twinkleTimer?: Phaser.Time.TimerEvent;
  /** Ember-fly ambience: the emit zone tracks the camera's worldView. */
  private fireflyZone?: Phaser.Geom.Rectangle;
  /** Authored world FX emitters (src/data/emitters.json) + their orchestrator. */
  private fx?: FxDirector;
  /** Per-item ambient auras (eggs), keyed by item id. Same lifecycle as the
   *  dragon rigs: attached on acquire, followed every frame, torn down wherever
   *  `removeDragonRig` is. */
  private itemAuras = new Map<number, { rig: FxEmitterRig; host: BoardItem }>();
  private aurora?: AuroraFX;
  private snow?: SnowFX;
  /** Golden Egg ambient tremble (starts near the Level-3 threshold). */
  private goldenTremble?: Phaser.Tweens.Tween;
  /** The Golden Altar (scenic non-playable ledge, west of the isle) — the
   *  egg/Elder LORE FIXTURE. Never a board item: no merge, sell, drag, work. */
  private altarEgg?: Phaser.GameObjects.Image;
  /** Soft radial ground shadow under the Golden Egg (parity with board items). */
  private altarEggShadow?: Phaser.GameObjects.Image;
  private altarElder?: RigPlayer;
  /** The Elder as her own Align-Studio clips rather than a rig — the best she
   *  gets, and what `showAltarElder` upgrades to the moment her sheets land. */
  private altarElderClip?: Phaser.GameObjects.Sprite;
  /** Where her fly clip is in its arc, so a low pass over the altar folds its
   *  wings through the touchdown instead of cutting to a standing frame. */
  private altarElderPhase: 'ground' | 'takeoff' | 'loop' | 'landing' = 'ground';
  private altarElderShadow?: Phaser.GameObjects.Image;
  private altarElderFallback?: Phaser.GameObjects.Image;
  private altarZone?: Phaser.GameObjects.Zone;
  /** The doors out of this world, each with its lit FX — see `buildPortals`. */
  private portalDoors = new Map<string, { fx: PortalFX; zone: Phaser.GameObjects.Zone; to: string }>();
  /** World-position anchors the hub tours point at (the Emporium house, the
   *  cauldron) — registered by whichever builder places the landmark. */
  private tourTargets = new Map<string, { x: number; y: number }>();
  private tourArrow?: Phaser.GameObjects.Image;
  private altarElderRoll = { mode: 'idle' as 'idle' | 'hover', remainMs: 0 };
  /** The Level-3 finale runs exactly once per session. */
  private finaleRan = false;
  private finaleStartedMs = 0;
  /** Lowest zoom the wheel/flights allow — raised so the camera can never show
   *  past the authored background image (the world border). */
  private minZoom = 0.2;

  constructor() {
    super(SCENES.board);
  }

  create(): void {
    // ANNOUNCING THE BOARD IS NOT OPTIONAL.
    //
    // `world:ready` is what lowers the travelling veil, and the veil's scrim is
    // interactive on purpose — so a build that throws on its way to the last
    // line does not leave a half-drawn board, it leaves a curtain the player
    // cannot dismiss, with no menu and no way back. Every other failure in this
    // scene still leaves a game; this one ends the session.
    //
    // So the announcement is owed whatever happens. `buildBoard` is the whole
    // of what create() used to be; nothing about the build changed.
    //
    // AND THE ERROR STOPS HERE. It used to be re-thrown after the emit, to keep
    // its stack out of a swallowing rescue — which defeated the rescue and the
    // watchdog with it. Phaser calls create() from SceneManager.bootScene,
    // inside the game step, inside the requestAnimationFrame callback; that
    // callback schedules the NEXT frame after it returns, so a throw passing
    // through it ends the RAF chain for good. Nothing runs again: not the
    // veil's fade, not the twenty-second dead man's switch, not a tap. The
    // player gets the exact freeze the emit above exists to prevent — a board
    // that failed to build reached them as a locked session.
    //
    // `console.error` prints the stack anyway, so the rethrow bought nothing.
    // The error is also parked on the instrumentation object: a freeze is
    // reported from a screenshot, and "what does window.__emberkeep.lastError
    // say" beats asking someone to reproduce it with the console open.
    try {
      this.buildBoard();
    } catch (err) {
      console.error('[board] create() failed to finish — handing the board back anyway', err);
      recordError('board.create', err);
      this.ctx?.bus.emit('world:ready', { world: this.ctx.state.worldId });
    }
  }

  private buildBoard(): void {
    this.ctx = this.registry.get('ctx') as GameContext;
    // Point the ambient `gridToWorld`/`worldToGrid` at the world being shown, so
    // every call site below projects through the ZONE that owns each address.
    // GameState already does this on construction and on each switch; the scene
    // re-asserts it because the scene is what draws the result.
    setActiveWorld(this.ctx.state.world);
    this.itemSprites.clear();
    this.itemAuras.clear();
    this.pool = [];
    this.tiles.clear();
    this.fog.clear();
    this.keyBadges.clear();
    this.skipButton = undefined; // a fresh scene; old container died with the last
    this.skipForId = 0;
    this.restBadges.clear();
    this.produceBadges.clear();
    this.breathing = []; // last run's standees died with it — never carry the refs
    // Same reason, and it matters the moment TWO worlds have standees: travel
    // rebuilds the scene, so without this the map keeps the departed world's
    // character pointing at a destroyed sprite — and `characterMarkerPoint` /
    // `playStandeeCast` would answer for someone who is not on this map.
    this.characterSprites.clear();
    this.standeeReacting.clear();
    this.highlights = [];
    this.pendingGive = null;
    this.giveTweens = [];
    this.allow = { ...NO_ALLOW };
    this.tutorialDone = this.ctx.state.tutorialDone;
    this.liveDragons.clear();
    this.busyDragons.clear();
    // The lean's tweens died with the last run's TweenManager; the bookkeeping
    // must go with them or the diff would believe last world's clusters are
    // still leaning and never start this world's.
    this.leans.clear();
    this.leanDozing = false;
    this.crossing.clear();
    // A restart reuses this scene INSTANCE (Title → Play after game:reset): the
    // last run's display objects are destroyed but these fields still point at
    // them. Stale refs block recreation — the Golden Egg vanished (its aura,
    // positioned from altarPoint, still appeared), altar taps died, and the
    // finale one-shot could never play again.
    this.altarEgg = undefined;
    this.altarEggShadow = undefined;
    this.eggAura = undefined;
    this.altarElder = undefined;
    this.altarElderClip = undefined;
    this.altarElderPhase = 'ground';
    this.altarElderShadow = undefined;
    this.altarElderFallback = undefined;
    this.altarElderRoll = { mode: 'idle', remainMs: 0 };
    this.altarZone = undefined;
    // Travel restarts this scene, so last world's doors died with it — never
    // carry the refs, or the new board would hold rectangles leading out of a
    // world the player has already left.
    this.portalDoors = new Map();
    this.tourTargets = new Map();
    this.tourArrow = undefined;
    this.goldenTremble = undefined;
    this.teaseReturn = null;
    this.finaleRan = false;
    this.finaleStartedMs = 0;
    this.power = this.registry.get('power') as PowerGovernor | undefined;
    void this.loadDragonRigs(); // lazy + fault-tolerant; ready well before the hatch

    this.ensureShadowTexture(); // soft radial shadow used by every object
    this.ensureCrystal3D(); // live 3D emerald → item_crystal_1 (before items build)
    this.buildSky();
    this.buildBackground(); // authored backdrop, below the floor (shows through invisible tiles)
    this.buildGround();
    this.buildMapDecor();
    this.buildMapDecor3d(); // authored Three.js 3D-decor placements
    this.buildWorldCharacters(); // Eleanor & co, standing in the world
    this.buildWorldEmitters(); // authored fire / smoke, burning in the world
    this.buildWeather(); // this world's sky and its weather (data-driven)
    this.buildCompanions(); // named dragons, from any loaded save
    this.ctx.bus.on('companion:named', () => this.buildCompanions());
    this.ctx.bus.on('companion:grew', () => this.rebuildCompanions());
    // She answered — raise the scepter. The system has already done the work;
    // this is the only place the player SEES her do it.
    this.ctx.bus.on('character:action_used', ({ characterId }) => this.playStandeeCast(characterId));
    // The Align-Studio reaction clips (character-anims.json) — each event has
    // exactly ONE animation answering it: a landed gift, a filled heart.
    // (Talking/blinking are the dialogue BUBBLE's, never the board's.)
    this.ctx.bus.on('regard:gift_accepted', ({ characterId }) => this.playStandeeReaction(characterId, 'happy'));
    this.ctx.bus.on('regard:heart', ({ characterId }) => this.playStandeeReaction(characterId, 'laugh'));
    this.buildFog();
    this.buildSouthPromise();
    this.buildKeyBadges();
    this.buildPortals(); // the doors out — after buildFog, so a cloud covers one
    this.spawnExistingItems(); // before the camera frames — travel arrives on a populated board
    this.syncReadyLeans(); // a board that arrives with a complete cluster leans from the first frame
    this.syncGoldenAltar();
    this.buildEmitters();
    this.buildDragCell();
    this.wireInput();
    this.subscribe();
    this.setupCamera();
    this.buildAtmosphere(); // after setupCamera — layers place off the live worldView

    this.cameras.main.fadeIn(320, 36, 27, 34);
    // ONLY if it is not already up. World travel restarts THIS scene, and
    // `launch` on a running scene shuts it down and boots it again — so an
    // unconditional call tore UIScene down on every journey. That wiped its
    // clock (every pending delayed beat died with it, including the arrival
    // dialogue the destination world plays) and destroyed the travelling
    // curtain, whose whole job is to be the one thing on screen that spans the
    // switch. UIScene must OUTLIVE the board it is drawn over.
    if (!this.scene.isActive(SCENES.ui)) this.scene.launch(SCENES.ui);

    // Doze = a still painting: ambient emitters stop (live particles fade out
    // over their own lifespans) and the sky-twinkle allocator pauses. Any
    // input or gameplay beat flips the governor back and everything resumes.
    this.game.events.on(POWER_STATE_EVENT, this.onPowerState, this);
    this.onPowerState((this.power?.state ?? 'active') as PowerState);
    // A quality change rebuilds the board: weather, the crystal and the ambient
    // emitter counts are all decided in create(), and applying half of them
    // live would leave the scene in a state no profile describes.
    this.game.events.on(GRAPHICS_EVENT, this.onGraphicsChanged, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(POWER_STATE_EVENT, this.onPowerState, this);
      this.game.events.off(GRAPHICS_EVENT, this.onGraphicsChanged, this);
      // The loader is reset with the scene and takes every pending COMPLETE
      // with it, but THIS QUEUE IS A FIELD and Phaser reuses the instance — so
      // without this it would wait forever on a completion that died here, and
      // the next world's art would queue behind it and never load.
      this.loads.reset();
      this.ambientEmitters = [];
      this.twinkleTimer = undefined;
      this.offBus.forEach((off) => off());
      this.offBus = [];
      for (const ld of this.liveDragons.values()) {
        ld.clipOverlay?.destroy();
        ld.player?.destroy();
      }
      this.liveDragons.clear();
      // Sheets that were still in the air when the board went away never became
      // textures, but the bookkeeping still says they were asked for — and
      // "asked for" is what stops `fetchClips` asking again. Both maps outlive
      // the scene (the texture manager is the GAME's), so the honest state is
      // whatever actually made it into the manager.
      for (const [id, ref] of [...this.residentClips]) {
        if (this.textures.exists(clipKey(ref.breed, ref.clip))) continue;
        this.residentClips.delete(id);
        this.dragonClipsAsked.delete(id);
      }
      this.altarElder?.destroy();
      this.altarElder = undefined;
      this.altarElderClip?.destroy();
      this.altarElderClip = undefined;
      // NOT disposed: the gem is shared across scenes (`sharedCrystal3D`) and
      // its canvas is registered in the GAME's texture manager, so both survive
      // this teardown intact. Tearing them down here is what used to leave the
      // shared key pointing at a dead canvas — and then build a replacement
      // context on the way back in.
      this.crystal3d = undefined;
      this.crystalTex = undefined;
      for (const id of [...this.itemAuras.keys()]) this.detachItemAura(id);
      this.fx?.destroy();
      this.fx = undefined;
      this.aurora?.destroy();
      this.aurora = undefined;
      this.snow?.destroy();
      this.snow = undefined;
      this.snowFlakes?.destroy();
      this.snowFlakes = undefined;
    });

    // The board this world needs is now built and holding its own textures, so
    // nothing still points at the worlds we are not on: give their video memory
    // back. Done here rather than on the travel event so it self-corrects from
    // any route — travel, a scene restart, or Title → Play after a reset.
    releaseAwayWorldArt(
      {
        exists: (key) => this.textures.exists(key),
        remove: (key) => void this.textures.remove(key),
        inUse: (key) => this.textureInUse(key)
      },
      this.ctx
    );
    // Travel is finished the moment the new board exists; the veil comes down.
    this.ctx.bus.emit('world:ready', { world: this.ctx.state.worldId });
  }

  /** chains.json per-tier `artScale` — the worldbuilder Merge page's
   *  data-driven sizing for uploaded art (Constants' ITEM_SCALE wins). */
  private tierArtScale(chain: string, tier: number): number | undefined {
    return this.ctx.data.chains.chains
      .find((c) => c.id === chain)
      ?.tiers.find((t) => t.tier === tier)?.artScale;
  }

  /** Ambient emission interval after the graphics profile — a lower `ambient`
   *  means a longer gap between motes. Ambient life is the cheapest thing to
   *  thin out: nothing in the game reads it. */
  private ambientGap(ms: number): number {
    return Math.round(ms / Math.max(0.05, graphics.profile.ambient));
  }

  private onGraphicsChanged(): void {
    this.scene.restart();
  }

  private onPowerState(state: PowerState): void {
    const doze = state === 'doze';
    // The merge-ready lean is ambience too: it eases home on doze (an empty
    // ready-set routes every member through the graceful stop) and the same
    // sync re-reads the clusters on wake. Gated on the edge so the initial
    // active call in create() does not run a sync the build already did.
    if (doze !== this.leanDozing) {
      this.leanDozing = doze;
      this.syncReadyLeans();
    }
    for (const emitter of this.ambientEmitters) emitter.emitting = !doze;
    if (this.twinkleTimer) this.twinkleTimer.paused = doze;
    this.hubGlow?.setVisible(!doze);
    this.hubSign?.setVisible(!doze);
    // The FX director takes the state itself: it caps quality in two steps
    // (active → high, idle → medium, doze → off) rather than the single on/off
    // the older ambient emitters have.
    const ceiling = graphics.profile.fxCeiling;
    this.fx?.setPowerState(state);
    this.fx?.setTierCeiling(ceiling);
    // The sky FREEZES on doze (a still aurora is just a painting) but the snow
    // FADES OUT — flakes stopped in mid-air read as a broken game. Each effect
    // owns that difference; this only hands the state over — then the graphics
    // profile caps whatever it asked for.
    this.aurora?.setPowerState(state);
    if (this.aurora) this.aurora.setTier(cappedTier(this.aurora.currentTier, ceiling));
    this.snow?.setPowerState(state);
    if (this.snow) this.snow.setTier(cappedTier(this.snow.currentTier, ceiling));
    // Flakes stop being emitted on doze but the ones in the air finish falling —
    // a sky that empties is gentler than one that blinks out.
    if (this.snowFlakes) this.snowFlakes.emitting = !doze;
  }

  /**
   * This world's sky and weather, from `src/data/weather.json`.
   *
   * Both effects are single full-screen shader quads at `scrollFactor 0`, so
   * they cost nothing to place and nothing to keep in step with the camera.
   * A world with no entry builds neither and pays nothing — which is every
   * world but Borealis today.
   */
  private buildWeather(): void {
    const spec = (weatherJson as WeatherFile).worlds?.[this.ctx.state.worldId];
    if (!spec) return;
    // FLAKES FIRST, and outside the profile gate on purpose — see below. The
    // shader is the atmosphere; these are the weather you can actually see.
    if (spec.snow) this.buildSnowFlakes();
    // The shader passes are the first thing a weak device gives up: two
    // full-screen passes buy atmosphere, not playability.
    if (!graphics.profile.weather) return;
    const now = (): number => this.ctx.clock.now();
    const state = (this.power?.state ?? 'active') as PowerState;

    const aurora = spec.aurora ? (auroraJson as unknown as AuroraPresetFile).presets[spec.aurora] : undefined;
    if (aurora) {
      this.aurora = new AuroraFX(this, aurora, {
        now,
        width: LIVE_GAME_WIDTH,
        height: LIVE_GAME_HEIGHT * (spec.auroraBand ?? 0.5),
        depth: DEPTHS.skyFx
      });
      this.aurora.setPowerState(state);
    }

    const snow = spec.snow ? (snowJson as unknown as SnowPresetFile).presets[spec.snow] : undefined;
    if (snow) {
      this.snow = new SnowFX(this, snow, {
        now,
        width: LIVE_GAME_WIDTH,
        height: LIVE_GAME_HEIGHT,
        depth: DEPTHS.weather
      });
      this.snow.setPowerState(state);
    }
  }

  /**
   * REAL FLAKES — because the shader is allowed to not be there.
   *
   * The drifting snow is a full-screen shader quad, and it can silently fail to
   * exist in two ways: the `low` graphics profile turns weather off outright,
   * and `ensureSnowPipeline` returns false whenever the pipeline will not
   * register (an old driver, a lost context). Both paths left Borealis with a
   * clear sky and no fallback — which is the "sometimes there is no snow" of it.
   * The world is CALLED Borealis; its weather is not decoration it can lose.
   *
   * Particles need no pipeline and no shader, so this layer always exists where
   * the world declares snow. It is also the thing that was missing visually:
   * the shader draws a fine drift, and a fine drift reads as film grain. These
   * are flakes — few, large enough to see, and falling on a slant.
   *
   * `scrollFactor 0`, like the shader: weather is not in the world, so it must
   * not slide when the board pans.
   */
  private buildSnowFlakes(): void {
    const density = graphics.profile.ambient; // 1 / 0.6 / 0.25 by tier
    if (density <= 0) return;
    this.snowFlakes = this.add
      .particles(0, -60, 'fx_glow', {
        x: { min: -80, max: LIVE_GAME_WIDTH + 80 },
        // Slow, and spread over a wide band of speeds: flakes at one speed read
        // as a moving texture rather than as falling snow.
        speedY: { min: 55, max: 150 },
        speedX: { min: -34, max: 12 }, // the same slant the shader's wind takes
        lifespan: { min: 9000, max: 15000 },
        scale: { min: 0.03, max: 0.085 },
        alpha: { min: 0.35, max: 0.8 },
        rotate: { min: 0, max: 360 },
        frequency: Math.round(150 / density),
        tint: 0xecf6ff,
        blendMode: Phaser.BlendModes.NORMAL
      })
      .setDepth(DEPTHS.weather + 1)
      .setScrollFactor(0);
    // Start mid-storm rather than with an empty sky that fills over 15 seconds.
    this.snowFlakes.fastForward(9000, 16);
  }

  /** Borealis's flakes. Held apart from `snow` (the shader) because they
   *  survive the shader being unavailable — which is the whole point of them. */
  private snowFlakes?: Phaser.GameObjects.Particles.ParticleEmitter;

  /**
   * Place the authored world emitters (src/data/emitters.json, written by the
   * World Builder's 🔥 FX tab).
   *
   * Depth comes from where the emitter is DRAWN, not from its cell — the same
   * rule world characters follow, and for the same reason: a free nudge can
   * carry it a whole tile out, and sorting it by a cell it no longer stands on
   * is how a brazier ends up burning through the rock in front of it.
   */
  private buildWorldEmitters(): void {
    // The director is built UNCONDITIONALLY: egg auras are rigs too, and this
    // used to return early when emitters.json was empty — which it is on a
    // fresh checkout — leaving every egg without an aura for no stated reason.
    this.fx = new FxDirector(this, EMITTER_PRESETS, { now: () => this.ctx.clock.now() });
    const placements = (emittersJson as { emitters?: unknown }).emitters;
    if (!Array.isArray(placements) || !placements.length) {
      this.fx.setPowerState((this.power?.state ?? 'active') as PowerState);
      return;
    }
    const ratio = TILE_W / (this.ctx.state.map.tile?.width ?? TILE_W);
    for (const raw of placements) {
      const e = resolvePlacement(raw as Parameters<typeof resolvePlacement>[0]);
      if (e.world !== this.ctx.state.worldId) continue; // authored for another world
      const cell = gridToWorld(e.anchor[0], e.anchor[1]);
      const x = cell.x + e.dx * ratio;
      const y = cell.y + e.dy * ratio;
      this.fx.spawn(e.preset, x, y, {
        depth: DEPTHS.itemBase + y,
        scale: e.scale,
        alpha: e.alpha,
        seed: e.seed,
        ramp: e.ramp ?? undefined,
        widthScale: e.widthScale,
        heightScale: e.heightScale,
        tiltDeg: e.tiltDeg,
        flipX: e.flipX,
        groundRotDeg: e.groundRotDeg,
        rate: e.rate,
        windInfluence: e.windInfluence
      });
    }
    this.fx.setPowerState((this.power?.state ?? 'active') as PowerState);
  }

  /**
   * NOTHING THROWS THROUGH THE GAME LOOP — see `src/core/crash.ts`.
   *
   * Phaser schedules the next frame after this returns, so one bad frame here
   * does not break one feature: it ends the RAF chain and freezes the session,
   * safety nets included. A frame that fails is skipped and recorded instead;
   * the game keeps running, degraded and diagnosable.
   */
  override update(time: number, delta: number): void {
    guard('board.update', () => this.stepBoard(time, delta), undefined);
    // ITS OWN GUARDED STEP, and not the last line of `stepBoard`.
    //
    // `guard` catches and records rather than letting a throw end Phaser's RAF
    // chain — which is right — but it also means everything AFTER the throw in
    // that callback stops running, every frame, in silence. The hint tick sat
    // at the bottom of a two-hundred-line step behind bobs, breathing, the
    // crystal readback and every cooldown pill: any one of them failing took
    // the hint with it and nothing on screen said so. A subsystem that has to
    // keep working when the rest degrades gets its own guard.
    guard('board.hint', () => this.tickMergeHint(delta), undefined);
  }

  private stepBoard(time: number, delta: number): void {
    for (const sprite of this.itemSprites.values()) sprite.applyBob(time);
    // Standee breath. Absolute-time driven, so the power governor's dropped
    // frames slow it down without ever desyncing it.
    for (const b of this.breathing) {
      if (!b.sprite.active) continue;
      const t = (time / STANDEE_BREATH.periodMs) * Math.PI * 2 + b.phase;
      b.sprite.scaleY = b.sprite.scaleX * (1 + STANDEE_BREATH.amount * Math.sin(t));
      syncSpriteInk(b.sprite); // the breath is a per-frame scale — the line rides it
    }
    // Ember-flies live wherever the player is looking — track the view.
    if (this.fireflyZone) {
      const v = this.cameras.main.worldView;
      this.fireflyZone.setTo(v.x, v.y, v.width, v.height);
    }
    if (this.crystal3d && this.crystalTex) {
      // The spin is decorative and the render+readback+re-upload is the single
      // most expensive idle cost — run it on the governor's cadence (paused in
      // doze). Rotation derives from absolute time, so skipped frames never
      // desync the motion.
      const interval = this.power?.crystalIntervalMs() ?? POWER.crystalMs.active;
      if (time - this.crystalLastRender >= interval) {
        this.crystalLastRender = time;
        this.crystal3d.update(time); // spin + render the live emerald
        this.crystalTex.refresh(); // re-upload to the GPU for this frame
      }
    }
    // One pass for every authored emitter: cull, rank by distance from the view
    // centre, allocate quality, sample the wind field per position.
    this.syncItemAuras();
    this.fx?.update();
    // Both are cheap no-ops when this world has no weather. The aurora usually
    // returns after comparing two numbers (it re-renders 20×/s, not 60); the
    // snow writes four uniforms and does no per-flake work at all.
    //
    // Re-fit FIRST: weather is pinned to the screen, and `setScrollFactor(0)`
    // only pins it against panning — a zoomed camera shrinks it into a box in
    // the middle (see cameraFit.ts). Both guard on the zoom, so the frames that
    // did not move the camera — nearly all of them — do nothing here.
    this.aurora?.fitToCamera(this.cameras.main);
    this.snow?.fitToCamera(this.cameras.main);
    this.aurora?.update();
    this.snow?.update();
    this.updateDrag(delta);
    this.updateLiveDragons(delta);
    if (this.altarElder || this.altarElderClip) {
      this.altarElder?.update(delta); // the clip sprite animates itself
      this.altarElderRoll.remainMs -= delta;
      if (this.altarElderRoll.remainMs <= 0) {
        // The Elder is a calm ADULT: rare, unhurried low-flights between long idles.
        if (this.altarElderRoll.mode === 'idle' && Math.random() < DRAGON_ANIM.adultCelebrateChance) {
          this.altarElderRoll = { mode: 'hover', remainMs: DRAGON_ANIM.adultCelebrateMs };
          this.altarElder?.play('hover');
          this.playElder('hover');
        } else {
          this.altarElderRoll = { mode: 'idle', remainMs: this.idleSpanMs(true) };
          this.altarElder?.play('idle');
          this.playElder('idle');
        }
      }
    }

    this.coolAccum += delta;
    if (this.coolAccum >= 240) {
      this.coolAccum = 0;
      // The lean's healer (see syncReadyLeans): starts are gated on a sprite
      // standing still, and this is where the gate is re-asked once landings,
      // pop-ins and the tutorial hand have moved on. A no-change pass is a key
      // diff over a handful of clusters — cheap enough for 4 Hz.
      //
      // FIRST in the tick, deliberately. Everything below it is bookkeeping for
      // badges and pills, and this whole step runs inside one `guard`: a throw
      // in any of it stops the rest of the callback every frame, in silence
      // (the same trap that once ate the hint — see the note above `stepBoard`).
      // The lean is the board's only explanation of the merge rule, so it does
      // not queue behind a cooldown label.
      this.syncReadyLeans();
      this.syncProduceBadges();
      for (const [id, badge] of this.restBadges) {
        const sp = this.itemSprites.get(id);
        const rest = this.ctx.systems.jobs.restRemaining(id);
        if (!sp || rest <= 0) {
          badge.destroy();
          this.restBadges.delete(id);
          continue;
        }
        const s = Math.ceil(rest / 1000);
        badge.setPosition(sp.x, sp.y - 160);
        (badge.getData('label') as Phaser.GameObjects.Text).setText(
          `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
        );
      }
      for (const [id, badge] of this.coolBadges) {
        if (!this.itemSprites.has(id)) {
          badge.destroy();
          this.coolBadges.delete(id);
        }
      }
      this.reseatFixtures();
      for (const sprite of this.itemSprites.values()) {
        if (!sprite.isGenerator) continue;
        const item = this.ctx.state.items.get(sprite.itemId);
        if (!item) continue;
        const timer = sprite.chain === 'chest' ? this.chestTimer(item) : this.genTimer(item);
        if (this.liveDragons.has(sprite.itemId)) {
          // Rig-hosted dragon: its in-container pill would hide behind the rig —
          // the countdown floats above its head instead.
          this.updateDragonCoolBadge(sprite, timer);
          continue;
        }
        sprite.setCooling(timer !== null);
        if (timer) {
          sprite.setCooldownRemaining(timer.remaining);
          if (this.skipForId === sprite.itemId) this.updateSkipCost(timer.remaining, timer.total);
        } else if (this.skipForId === sprite.itemId) {
          this.hideSkipButton(); // became ready
        }
      }
    }


    this.regenAccum += delta;
    if (this.regenAccum >= 500) {
      // Pass the REAL elapsed ms (not 0): regen/passive read the clock, but the
      // dragon-job speed-up advances House timers by this delta per worker.
      const elapsed = Math.round(this.regenAccum);
      this.regenAccum = 0;
      this.ctx.bus.emit('time:advanced', { ms: elapsed });
    }
  }

  /* --------------------------- the idle hand ----------------------------- */

  /** Untouched time on this board, in ms — reset by anything the player does. */
  private hintIdleMs = 0;
  /** The step currently on screen, so it is offered once and taken back once. */
  /**
   * WHERE THE PLAYER IS WORKING — the cell they last put a piece on.
   *
   * The planner's single most valuable input, and the whole of its `near`
   * weight. A merge game is played in a neighbourhood: you drop something, look
   * at what is around it, drop another. A hand that answers from that
   * neighbourhood looks like it is watching you. A hand that answers from the
   * far corner of the isle is what "il n'est pas logique" actually describes —
   * the offer was legal and cheap and had nothing to do with what you were
   * doing. Set on every landed move, cleared on a world switch (a cell index
   * means nothing once the lattice under it changes).
   */
  private playerFocus: TilePos | null = null;
  /**
   * HOW MANY MORE OF EACH PIECE THE LIVE LEDGER STILL WANTS, by `chain:tier`.
   *
   * Rebuilt from `order:progress`, which carries `have[]` and `need[]` against
   * the order's own `requires[]` — so the two are zipped by index and the
   * shortfall is what is left. The scene CACHES rather than asks: OrderSystem
   * owns this and systems are never called across, so the fact arrives on the
   * bus and is remembered here.
   */
  private orderWants = new Map<string, number>();
  /** Per-order shortfalls, so one order completing cannot leave its rows in the
   *  flattened total above. */
  private orderShortfalls = new Map<string, Array<{ key: string; short: number }>>();
  /**
   * HOW MANY TIMES A SET WAS OFFERED AND LEFT ALONE, by `MergeHint.key`.
   *
   * Enough merit to hand the turn to something else once the player has said no
   * a few times, never a ban — the planner saturates it, so an ignored merge
   * sinks but is never buried. Counted here because the scene is what knows a
   * hand went up and came down without being followed.
   */
  private hintDeclines = new Map<string, number>();
  /** The key of the set currently being offered, for the decline count. */
  private hintKey: string | null = null;
  private hintShown: MergeStep | null = null;
  /** The last step the hand ASKED for, kept past the take-back.
   *
   *  The hand is withdrawn the instant the player picks anything up, so by the
   *  time the move lands there is nothing left on screen to compare it against.
   *  This is what remembers the question long enough to recognise the answer. */
  private hintAsked: MergeStep | null = null;
  /**
   * THE PLAYER IS FOLLOWING THE HAND — show the next drag at once.
   *
   * Set when a move lands exactly where the hand asked for it. A plan is two or
   * three drags, and making someone wait ten seconds between them turns help
   * into a stutter: they have proved they are cooperating, so the board keeps
   * up rather than making them idle their way back to the next instruction.
   */
  private hintFollowUp = false;
  /**
   * Time on the clock since the STANDING hint last spoke — the heartbeat.
   *
   * Separate from `hintIdleMs` on purpose: that one measures how long the board
   * has gone untouched and stops the moment a hand goes up, and conflating the
   * two would have the first offer and the re-offer racing the same counter.
   * Reset by anything that raises, re-aims or withdraws the hand.
   */
  private hintPulseMs = 0;

  /**
   * The board, as the planner sees it. `GameState` for occupancy and ground,
   * `world.ts` for the two facts that actually decide a merge — who is next to
   * whom, and which zone owns the cell.
   */
  private hintBoard(): HintBoard {
    const state = this.ctx.state;
    return {
      isActive: (col, row) => state.isTileActive(col, row),
      itemIdAt: (col, row) => state.itemIdAt(col, row),
      neighbors: (col, row) => state.neighbors(col, row),
      zoneOf: (col, row) => zoneAt(state.world, col, row)?.id,
      // REAL distance, in world units. The planner ranks candidate gathers by
      // how far the player has to swipe, and now that a gather may cross from
      // one slab to another, `|Δcol|` is a number about nothing: index blocks
      // sit side by side with gutters, so two cells five columns apart can be
      // on different islands. `worldPointOf` projects PER ZONE, which is the
      // only projection that means anything here.
      distance: (a, b) => {
        const pa = worldPointOf(state.world, a.col, a.row);
        const pb = worldPointOf(state.world, b.col, b.row);
        return (pa.x - pb.x) ** 2 + (pa.y - pb.y) ** 2;
      },
      // THE FOUR SIGNALS THAT MAKE THE PLANNER SEE THE PLAYER, not just the
      // board. Each is OPTIONAL on `HintBoard` and each degrades to silence, so
      // the unit fixtures keep scoring on drags and haul alone; what they buy
      // here is the difference between a legal offer and a sensible one.
      ...(this.playerFocus ? { focus: this.playerFocus } : {}),
      // ON SCREEN — the camera only, and deliberately so. Only the FIRST offer
      // moves the view; every re-aim and every heartbeat after it speaks from
      // wherever the player chose to stand, so an offer whose pieces are off
      // screen is a hand pointing at the edge of the world. Generous by a tile
      // in each direction: a piece whose art overlaps the rim is still a piece
      // the player can see and reach.
      inView: (col, row) => {
        const v = this.cameras.main.worldView;
        const p = worldPointOf(state.world, col, row);
        const pad = TILE_W;
        return (
          p.x >= v.x - pad &&
          p.x <= v.right + pad &&
          p.y >= v.y - pad &&
          p.y <= v.bottom + pad
        );
      },
      wants: (chain, tier) => this.orderWants.get(`${chain}:${tier}`) ?? 0,
      declines: (key) => this.hintDeclines.get(key) ?? 0
    };
  }

  /**
   * Re-read what the Ledger is still short of, from a progress fact.
   *
   * `order:progress` fires once per ACTIVE order on every board change, so the
   * cheapest correct thing is to rebuild that order's contribution each time
   * and keep the rest. Keyed per order so a completed one stops counting the
   * moment its own progress event says it is done.
   */
  private noteOrderWants(orderId: string, have: number[], need: number[]): void {
    const order = this.ctx.data.orders.orders.find((o) => o.id === orderId);
    if (!order) return;
    this.orderShortfalls.set(
      orderId,
      order.requires.map((req, i) => ({
        key: `${req.chain}:${req.tier}`,
        short: Math.max(0, (need[i] ?? req.count) - (have[i] ?? 0))
      }))
    );
    // Flatten every live order into one lookup. Small maps, rebuilt rarely —
    // clearer than trying to patch a total in place and get the arithmetic
    // right when an order completes.
    this.orderWants.clear();
    for (const rows of this.orderShortfalls.values()) {
      for (const { key, short } of rows) {
        if (short > 0) this.orderWants.set(key, (this.orderWants.get(key) ?? 0) + short);
      }
    }
  }

  /**
   * Offer a merge when the board has gone quiet.
   *
   * The RULE — which merge, and the drags that make it — is `nextMergePlan`,
   * pure and unit-tested. This is only the clock around it, and it is
   * deliberately made of the two things a distracted player actually does:
   * nothing at all, or something. Any drag resets the wait and takes the hand
   * back, because a player with a piece in their hand does not need to be told
   * about another.
   *
   * ONE STEP AT A TIME, re-planned from the live board rather than remembered.
   * The plan is a pure function of what is standing where, so recomputing it
   * after every move is both cheaper than tracking one and self-correcting: a
   * producer dropping a piece mid-plan, or the player gathering somewhere else
   * entirely, simply changes the answer instead of stranding a stale script.
   *
   * Silent for the whole tutorial. The tutorial has its own hand and its own
   * script, and a second hand pointing somewhere else during a scripted beat
   * is worse than no help at all — UIScene enforces that too, so neither side
   * can hand the player two gestures at once.
   */
  private tickMergeHint(delta: number): void {
    // A LESSON, not a FLAG. The gate used to be `tutorialDone`, which reads as
    // "has the player ever finished the walkthrough" — and the answer is no for
    // anyone who left the isle early (the ruby teleport drops you in Roothold
    // mid-tutorial), so the hint was switched off for the whole rest of that
    // save, in every world. What the gate actually wants to know is whether a
    // beat is on screen competing with it, and a beat can only be on screen in
    // the world the walkthrough is authored for.
    const lessonRunning = !this.tutorialDone && this.ctx.state.worldId === WORLD_ID;
    // A drag that ended without its pointerup — a crossing mid-drag, a pointer
    // lost off the canvas — used to hold this closed for the session. If the
    // sprite it names is gone, the drag is over whatever the field says.
    if (this.dragSprite && !this.itemSprites.has(this.dragSprite.itemId)) this.dragSprite = null;
    if (lessonRunning || this.dragSprite) {
      this.hintIdleMs = 0;
      this.takeBackHint();
      return;
    }
    // A HAND THAT IS UP IS NOT A QUESTION THAT HAS BEEN ANSWERED. This used to
    // be a bare `return`, and that one line is most of "the hint does not
    // really work": the offer was computed once and then frozen for ever, so a
    // player who ignored it got a single stale answer, and an offer UIScene
    // REFUSED (a lesson owned the hand) left the board believing a hand was up
    // for the rest of the session. The heartbeat costs nothing and repairs both
    // — every `repulseMs` the plan is worked out again from the live board and
    // said again, whether or not the answer moved.
    if (this.hintShown) {
      this.hintPulseMs += delta;
      if (this.hintPulseMs < MERGE_HINT.repulseMs) return;
      // A HAND THAT HAS STOOD A FULL HEARTBEAT UNANSWERED IS A DECLINE, and
      // this is the only place that can honestly say so. Not `takeBackHint` —
      // that fires when the player merges, moves, or picks anything up, which
      // is the opposite of ignoring it. Here, thirty seconds have passed with
      // the hand out and the board untouched. The planner saturates the count,
      // so this sinks a stubbornly-ignored set rather than banning it.
      if (this.hintKey) {
        this.hintDeclines.set(this.hintKey, (this.hintDeclines.get(this.hintKey) ?? 0) + 1);
      }
      this.refreshHint(true);
      return;
    }
    this.hintIdleMs += delta;
    const wait = this.hintFollowUp ? MERGE_HINT.followUpMs : MERGE_HINT.idleMs;
    if (this.hintIdleMs < wait) return;

    const plan = nextMergePlan(this.ctx.state.items.values(), this.ctx.data.chains, this.hintBoard());
    const step = plan?.steps[0];
    const from = step ? this.ctx.state.items.get(step.itemId) : undefined;
    if (!step || !from) {
      this.hintFollowUp = false;
      return;
    }
    this.showHintStep(step, from, true, plan?.key ?? null);
  }

  /**
   * RAISE THE HAND at a step — the one place the offer is actually made.
   *
   * Shared by the first offer, the re-aim when the board moves under a standing
   * hint, and the heartbeat, because all three have to do exactly the same five
   * things and a fourth copy of them is how the three drifted apart.
   *
   * It RETRACTS before it offers, and that is not cosmetic. UIScene's hand is a
   * self-restarting tween chain (`placeHand`'s `run()` re-enters itself for
   * ever); pointing it somewhere new over a live one lays a SECOND chain on the
   * same sprite and the two fight over its alpha and angle for the rest of the
   * session. The retraction makes UIScene run `clearMarkers`, which kills the
   * chain first — and it costs nothing when the hint does not own the hand,
   * because the null branch there returns early unless `hintHand` is set, so a
   * tutorial beat or a carry lesson holding the hand is never disturbed by it.
   *
   * `aim` MOVES THE CAMERA, and only the first offer asks for it.
   *
   * The camera goes where the pointer goes — the law every other pointer in
   * this scene follows — but that law is about ARRIVING somewhere, and the
   * heartbeat is not an arrival. A player who has been shown a merge, left it,
   * and panned somewhere else has said where they want to be looking; gliding
   * them back every thirty seconds is the board arguing with the finger, and a
   * pulse that lands mid-pan puts a camera tween in a fight with a live drag.
   * `bringIntoView` being a no-op for a piece already in frame does not save
   * it: the case that matters is exactly the one where the piece is NOT in
   * frame, because the player put it there.
   *
   * So: aim once, when the hand first goes up, and let every re-aim and every
   * pulse after that speak from wherever the player is standing. This is also
   * what `refreshHint` did before the three paths were merged — the yank was
   * never a decision, it was a consequence of sharing the code.
   */
  private showHintStep(
    step: MergeStep,
    from: BoardItemState,
    aim = false,
    key: string | null = null
  ): void {
    // Remembered so the heartbeat can tell "the same set, still ignored" from
    // "a different set" — the decline count is per set, never per chain.
    this.hintKey = key;
    this.ctx.bus.emit('hint:merge', null);
    this.hintShown = step;
    this.hintAsked = step;
    this.hintPulseMs = 0;
    // The piece STRAINS toward where it is being asked to go (`syncReadyLeans`
    // reads `hintShown`). It used to HOP — straight up, 18 px, one piece — and
    // that was the whole vocabulary before the lean existed: it says "this one"
    // and nothing about WHERE, which is the half that matters. Asked here so
    // the answer is on screen with the hand rather than up to a tick later.
    this.syncReadyLeans();
    // Through the WORLD's projection, never the ambient `gridToWorld`: a zoned
    // world places its cells per zone, so the authored lattice would aim the
    // camera at open sky anywhere but the opening isle.
    if (aim) this.bringIntoView(worldPointOf(this.ctx.state.world, from.col, from.row));
    this.markHintTarget(step);
    this.ctx.bus.emit('hint:merge', {
      from: { col: from.col, row: from.row },
      to: { col: step.to.col, row: step.to.row }
    });
  }

  /**
   * A pulse on the ground the hand is pointing at.
   *
   * Under drop-onto-only the plan's FINAL step always lands ON a piece — the
   * drop is the verb — and it is the gathers on the way there that may aim at
   * bare stone (and even those usually name a piece now, with MergeSystem
   * choosing the seat beside it). A hand travelling to bare stone says
   * "somewhere over there" where one landing on a piece says "onto THAT"; the
   * marker is what makes the bare-stone case "here" — and it is drawn only for
   * an empty target, because a diamond under the piece you are being told to
   * drop onto is noise.
   */
  private markHintTarget(step: MergeStep): void {
    this.clearHintTarget();
    if (this.ctx.state.itemIdAt(step.to.col, step.to.row) !== null) return;
    const { x, y } = gridToWorld(step.to.col, step.to.row);
    this.hintTarget = this.add
      .image(x, y, 'ui_tile_highlight')
      .setDepth(DEPTHS.tileHighlight)
      .setAlpha(0.35);
    this.tweens.add({
      targets: this.hintTarget,
      alpha: 0.85,
      scaleX: 1.06,
      scaleY: 1.06,
      duration: 620,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
  }

  private clearHintTarget(): void {
    if (!this.hintTarget) return;
    this.tweens.killTweensOf(this.hintTarget);
    this.hintTarget.destroy();
    this.hintTarget = undefined;
  }

  private hintTarget?: Phaser.GameObjects.Image;

  /**
   * Did the player just do what the hand asked?
   *
   * Called on every landed move. Answering yes is what makes the next step come
   * straight back — and answering NO matters just as much: a player who gathers
   * somewhere else of their own accord has stopped following the plan, and the
   * hand goes back to waiting its full ten seconds rather than chasing them.
   */
  private notePlayerMove(itemId: number, to: TilePos): void {
    // Where they are working, for the planner's `near` weight. Set on the LANDED
    // cell rather than on pick-up: the question the hint answers is "what next",
    // and next happens where the piece came to rest.
    this.playerFocus = { col: to.col, row: to.row };
    const asked = this.hintAsked;
    this.hintAsked = null;
    // "Where it landed" is no longer always "where the hand pointed": a gather
    // step drops the piece ON a matching piece, and MergeSystem then SEATS it
    // on a free cell beside the target of its own choosing — `item:moved`
    // reports the seat. An exact comparison read every obeyed gather as the
    // player wandering off, and the follow-up clock fell back to the full ten
    // seconds mid-plan. So a landing on the asked cell OR any of its in-zone
    // neighbours (the ring a seat is chosen from) counts as the asked move.
    const obeyed =
      !!asked &&
      asked.itemId === itemId &&
      ((asked.to.col === to.col && asked.to.row === to.row) ||
        this.ctx.state
          .neighbors(asked.to.col, asked.to.row)
          .some((p) => p.col === to.col && p.row === to.row));
    this.hintFollowUp = obeyed;
    this.hintIdleMs = 0;
  }

  /**
   * THE HINT FOLLOWS THE PIECE — the same law the tutorial's pointer lives by.
   *
   * `hint:merge` carries CELLS, and they were resolved once when the hand went
   * up. Move the piece it is pointing at and the hand went on pointing at bare
   * ground; the plan behind it might not even be legal any more. The tutorial
   * got this fixed (`tutorial:markers` re-aims on every board change) but the
   * HINT did not — and the hint is what speaks in every world once the lesson
   * is over, which is why it read as "the smart pointer works on the isle and
   * not in Roothold". It was never about the world. It was about which of the
   * two systems happened to be talking.
   *
   * So: re-plan on any board change while a hand is up, and re-aim if the
   * answer moved. Silent when the plan is unchanged — an identical re-emit
   * would restart the hand's travel tween every time anything on the board
   * twitched.
   *
   * `pulse` is the one caller that wants the opposite. The heartbeat re-plays
   * the beat even when the answer came back identical, because a hint that has
   * stood unacted for half a minute has to look like living help rather than an
   * icon someone left on: the hop under the piece, the pulse on the ground and
   * the hand's own gesture all start again from the top. Everything else about
   * the two paths is the same, which is why they are one function.
   */
  private refreshHint(pulse = false): void {
    if (!this.hintShown) return;
    const plan = nextMergePlan(this.ctx.state.items.values(), this.ctx.data.chains, this.hintBoard());
    const step = plan?.steps[0];
    const from = step ? this.ctx.state.items.get(step.itemId) : undefined;
    if (!step || !from) {
      // Nothing left to suggest (the player just merged it, or the board moved
      // out from under the plan). Take the hand back rather than leave it
      // pointing at a fusion that can no longer happen.
      this.takeBackHint();
      this.hintIdleMs = 0;
      return;
    }
    const same =
      step.itemId === this.hintShown.itemId &&
      step.to.col === this.hintShown.to.col &&
      step.to.row === this.hintShown.to.row;
    if (same && !pulse) return;
    this.showHintStep(step, from, false, plan?.key ?? null);
  }


  /**
   * "CARRY HIM TO THE ARCH" — the one gesture world travel is taught with.
   *
   * A dragon crosses by being PICKED UP and dropped on the gate; nothing on
   * screen says so, and the arch reads as scenery until something connects the
   * two. So the moment Eleanor's Emporium visit ends — the first quiet beat
   * after arriving in Roothold — the hand draws the move once.
   *
   * Latched in `stats` like the tours themselves, so it is taught once ever and
   * survives a reload, and taken back the moment a dragon actually crosses:
   * a lesson that stays up after it has been learnt is nagging.
   */
  private offerGateLesson(): void {
    if (this.ctx.state.stat(GATE_LESSON_STAT) > 0) return;
    const world = this.ctx.state.world;
    const door = world.portals[0];
    if (!door) return;
    // The nearest dragon to the arch: on a board with several, the one already
    // closest is the one the gesture is cheapest to try with.
    //
    // In WORLD PIXELS, from the door's own centre. It used to resolve the door
    // to a cell and compare `|Δcol|` — two mistakes at once: a gateway painted
    // off the playable ground resolves through the unbounded lattice to an
    // address that means nothing here, and cell indices are not a distance
    // across a world whose zones sit in separate blocks. Both are avoided by
    // measuring the thing the player is actually looking at.
    const doorX = door.x + door.width / 2;
    const doorY = door.y + door.height / 2;
    let best: BoardItem | undefined;
    let bestD = Infinity;
    for (const s of this.itemSprites.values()) {
      if (!this.wearsRigTier(s.chain, s.tier)) continue;
      const d = (s.x - doorX) ** 2 + (s.y - doorY) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (!best) return;
    this.gateLessonUp = true;
    // The lesson's own camera. This is the pointer that most needs it: the arch
    // is painted at the edge of the ground, so the dragon and the door it has to
    // reach are rarely both in a frame the player is already looking at — and a
    // lesson you cannot see is the one case where the hand teaches nothing.
    this.bringIntoView(worldPointOf(this.ctx.state.world, best.col, best.row));
    // The hand needs a CELL to point at, and the arch is painted off the ground,
    // so it points at the ground cell nearest the arch rather than at whatever
    // the unbounded lattice makes of a portal's centre.
    const gate = nearestPlayableCell(world, doorX, doorY);
    if (!gate) return;
    this.ctx.bus.emit('hint:carry', {
      from: { col: best.col, row: best.row },
      to: { col: gate.col, row: gate.row }
    });
  }

  /** The lesson is over when the move has been made — not when the player
   *  touches something else. */
  private clearGateLesson(learnt: boolean): void {
    if (!this.gateLessonUp) return;
    this.gateLessonUp = false;
    if (learnt) this.ctx.state.addStat(GATE_LESSON_STAT, 1);
    this.ctx.bus.emit('hint:carry', null);
  }

  private gateLessonUp = false;

  /** Take the hand back — after a merge, on a drag, or when the board goes. */
  private takeBackHint(): void {
    this.clearHintTarget();
    // Whatever comes next starts its own heartbeat: a half-spent pulse carried
    // across a withdrawal would have the next offer re-pose itself seconds
    // after it went up.
    this.hintPulseMs = 0;
    if (!this.hintShown) return;
    this.hintShown = null;
    this.hintKey = null;
    this.ctx.bus.emit('hint:merge', null);
  }

  /* ------------------------- live rigged dragons ------------------------- */

  /** True if this chain+tier is a dragon BOARD ITEM that comes alive as an
   *  animated animal. RIGS ARE OFF on this branch — every breed is sequence
   *  (clip) animated, so the question is answered from the CLIP CATALOG, not
   *  from texture residency: a registered breed is live-in-waiting even while
   *  its sheets are still on the wire (attachDragon fetches, and the arrival
   *  re-dress mounts anything standing). The Golden Elder is not a board
   *  item — she lives on the Golden Altar fixture (see syncGoldenAltar). */
  private wearsRigTier(chain: string, tier: number): boolean {
    if (this.clipCharacterFor(chain, tier) === null) return false;
    return this.generatorConfigFor(chain, tier) !== undefined;
  }

  /** Fetch + load every dragon rig once. The JSON FETCHES run in parallel
   *  (they're the slow network part; sequential fetches made cold loads wear
   *  the baked fallback for many seconds) — but the LOADER phases run strictly
   *  one rig at a time: five overlapping `load.start()` + once-COMPLETE pairs
   *  on the one shared LoaderPlugin can wedge its queue permanently (measured:
   *  26 files pending, none in flight, forever — and every later world travel
   *  hangs behind the dead loader). Any failure leaves that dragon as the
   *  pooled placeholder sprite (graceful: the board still works). */
  private async loadDragonRigs(): Promise<void> {
    const base = (import.meta.env.BASE_URL ?? './').replace(/\/?$/, '/');
    const docs = await Promise.all(
      Object.entries(DRAGON_RIGS).map(async ([rigKey, url]): Promise<[string, RigDoc] | null> => {
        if (this.dragonRigs.has(rigKey)) return null;
        try {
          const res = await fetch(base + url);
          if (!res.ok) return null;
          return [rigKey, (await res.json()) as RigDoc];
        } catch {
          return null;
        }
      })
    );
    for (const entry of docs) {
      if (!entry || !this.scene.isActive()) continue;
      await this.loadDragonRig(base, entry[0], entry[1]);
    }
  }

  private async loadDragonRig(base: string, rigKey: string, rig: RigDoc): Promise<void> {
    if (this.dragonRigs.has(rigKey)) return;
    try {
      if (rig.format !== 'emberkeep-rig' || !rig.images || !this.scene.isActive()) return;
      // A rig exported with the tool's default name would collide with any
      // other default-named rig on the shared texture keys — give it its
      // canonical id (the golden-dragon export ships as 'character'), which
      // also keys its FACES entry (faces.json) and catalog id.
      if (!rig.character || rig.character === 'character') {
        rig.character = DRAGON_RIG_NAMES[rigKey] ?? rigKey;
      }
      // Through the queue: RigPlayer runs its own add/once/start, so it needs
      // the loader to ITSELF or its promise resolves on somebody else's
      // COMPLETE and the rig mounts on textures that have not arrived.
      await this.loads.runExclusive(() =>
        RigPlayer.loadTextures(this, rig, (layer) => `rig:${rig.character}:${layer}`)
      );
      if (!this.scene.isActive()) return;
      // Face frame sets are optional per character; a failed frame simply
      // leaves that set unworn (attachFace validates per-set).
      const face = FACES[rig.character];
      if (face) {
        try {
          await this.loads.runExclusive(() =>
            RigPlayer.loadFaceTextures(this, face, faceTextureKey(rig.character), base)
          );
        } catch {
          /* face art optional */
        }
        if (!this.scene.isActive()) return;
      }
      this.dragonRigs.set(rigKey, rig);
      if (rigKey === GOLDEN_CHAIN) this.syncGoldenAltar(); // fallback art → live rig
      // Re-skin any dragons resolving to THIS rig that spawned before it loaded.
      for (const sprite of this.itemSprites.values()) {
        if (
          rigKeyFor(sprite.chain, sprite.tier) === rigKey &&
          this.wearsRigTier(sprite.chain, sprite.tier) &&
          !this.liveDragons.has(sprite.itemId)
        ) {
          this.attachDragon(sprite, false);
        }
      }
    } catch {
      /* no rig available — pooled sprite stays */
    }
  }

  /** Mirror the source art (faces LEFT) to face RIGHT and mount it over `host`,
   *  which goes invisible but stays interactive/draggable. CLIP-COMPLETE breeds
   *  mount overlay-only (no RigPlayer); the others need their rig loaded —
   *  returns false if it isn't ready yet (caller falls back to the sprite). */
  private attachDragon(host: BoardItem, intro: boolean): boolean {
    const clipOnly = this.clipComplete(host.chain, host.tier);
    const rig = this.dragonRigs.get(rigKeyFor(host.chain, host.tier));
    if (!clipOnly && !rig) {
      // Not mountable YET — with rigs off that means the breed's sheets are
      // still on the wire. Ask for them BEFORE bailing: this call is the
      // bootstrap (`dressBreedClips` mounts everything standing when they
      // land), and without it a registered breed with no rig would never
      // fetch and never come alive.
      this.ensureDragonClips(host.chain, host.tier);
      return false;
    }
    // Tear down FIRST, then fetch: `removeDragonRig` reconciles residency, and
    // a fetch queued before it would be offered to that eviction as sheets
    // nothing is wearing yet — dropped and immediately re-fetched.
    this.removeDragonRig(host.itemId);
    // A dragon of this breed is about to be on screen: this is the moment its
    // clip sheets are worth their video memory, and the first moment they are.
    this.ensureDragonClips(host.chain, host.tier);
    const scale =
      (host.tier >= 3 ? DRAGON_ANIM.whelpScale : DRAGON_ANIM.hatchlingScale) *
      (DRAGON_RIG_SCALE[`${host.chain}:${host.tier}`] ?? DRAGON_RIG_SCALE[host.chain] ?? 1);
    // A clip breed has no rig character to look the cadence up by, so the tier
    // decides: the adults are the calm ones — and the Golden Elder, who is an
    // elder at tier 2 (CALM_DRAGONS carried her rig name for the same reason,
    // and that lookup is gone with the rigs).
    const calm = clipOnly
      ? host.tier >= 4 || host.chain === GOLDEN_CHAIN
      : CALM_DRAGONS.has(rig!.character);
    let player: RigPlayer | null = null;
    if (!clipOnly) {
      player = new RigPlayer(this, rig!, (layer) => `rig:${rig!.character}:${layer}`, {
        scale,
        speed: calm ? DRAGON_ANIM.adultSpeed : DRAGON_ANIM.whelpSpeed
      });
      const face = FACES[rig!.character];
      if (face) player.attachFace(this, face, faceTextureKey(rig!.character));
      player.setFacing('left'); // rig's original (un-mirrored) orientation
      if (!intro) player.play('idle');
    }
    host.setArtVisible(false); // host is now just the invisible hit-target + bob anchor
    // Ground shadow proportional to the rig (666px pieces × scale).
    const shadow = this.addGroundShadow(host.x, host.y, 666 * scale, host.depth - 0.5);
    const ld: LiveDragon = {
      player,
      facing: 1,
      host,
      shadow,
      mode: intro ? 'hover' : 'idle',
      remainMs: intro ? DRAGON_ANIM.introCelebrateMs : this.idleSpanMs(calm),
      busy: false,
      calm,
      mood: 'awake',
      roarInMs: DRAGON_ROAR_EVERY_MS,
      flightPhase: null,
      sleepState: 'none',
      wearingSleepArt: false,
      waking: false
    };
    this.liveDragons.set(host.itemId, ld);
    this.syncDragon(ld);
    // The atlas idle (video-ingested) is the definitive rest from the first
    // frame — never a stint of rig idle before the first ambient roll swaps.
    if (!intro) this.dragonIdle(ld);
    if (intro) {
      // The newborn roars its arrival: the ingested roar clip when pushed
      // (same bellow as the hungry cadence), the rig hover + ~2.1s of mouth
      // flap without it. Whichever plays is what fades in.
      let target: Phaser.GameObjects.Sprite | Phaser.GameObjects.Container | null;
      if (this.playRoarClip(ld) && ld.clipOverlay) {
        target = ld.clipOverlay;
      } else if (player) {
        player.play('hover');
        player.playFace(2);
        ld.mode = 'hover';
        ld.remainMs = DRAGON_ANIM.introCelebrateMs;
        target = player.container;
      } else {
        // Clip-only, and its roar sheet has not landed yet (it is a mood clip,
        // fetched on the beat): arrive at rest rather than not at all.
        this.dragonIdle(ld);
        target = ld.clipOverlay ?? null;
      }
      target?.setAlpha(0);
      if (target) {
        this.tweens.add({
          targets: target,
          alpha: 1,
          duration: DRAGON_ANIM.fadeInMs,
          ease: 'Sine.easeOut'
        });
      }
    }
    return true;
  }

  private idleSpanMs(calm = false): number {
    if (calm) {
      return (
        DRAGON_ANIM.adultIdleMinMs +
        Math.random() * (DRAGON_ANIM.adultIdleMaxMs - DRAGON_ANIM.adultIdleMinMs)
      );
    }
    return DRAGON_ANIM.idleMinMs + Math.random() * (DRAGON_ANIM.idleMaxMs - DRAGON_ANIM.idleMinMs);
  }

  /** Keep the rig glued to its (possibly bobbing/dragged) host + advance anim. */
  private syncDragon(ld: LiveDragon): void {
    // The host's ready-lean rides along: the lean offsets the host's ART, and a
    // rig host's art is hidden — without carrying leanX/leanY here a pair of
    // hatchlings one drop from a whelp would lean invisibly. Body, clip AND
    // shadow: a rig host hides its own soft shadow, so `ld.shadow` is the only
    // one this animal casts, and leaving it on the seat is the one piece type
    // that would visibly come unstuck from its own dark patch.
    ld.player?.container.setPosition(ld.host.x + ld.host.leanX, ld.host.y + ld.host.leanY - DRAGON_ANIM.groundLift);
    ld.player?.container.setDepth(ld.host.depth + 0.5);
    // Visibility, not just position: the rig's shadow is the ONLY one a dragon
    // shows (the host's own pair is hidden the moment the rig stands in for its
    // art), so it is the one that has to answer `setOverGround`'s question. It
    // is written every frame because the position beside it already is, and
    // because the host is the single owner of the answer — a second copy of
    // "is it over ground" kept here is a second thing to get wrong.
    ld.shadow
      .setVisible(ld.host.onGround)
      .setPosition(ld.host.x + ld.host.leanX, ld.host.y + ld.host.leanY)
      .setDepth(ld.host.depth - 0.5);
    ld.zzz?.setPosition(ld.host.x, ld.host.y).setDepth(ld.host.depth + 4);
    if (ld.clipOverlay?.visible) {
      // The Align-Studio clip rides the host at the rig's own anchor and depth,
      // mirroring with the ANIMAL's facing (source art faces left; dx mirrors
      // too, so the registration lands where a flipped rig's would). Read off
      // `ld.facing` rather than the rig container, which a clip-only breed
      // does not have.
      const clip = ld.clipOverlay.getData('clip') as CharacterClip | undefined;
      const flip = ld.facing < 0;
      ld.clipOverlay
        .setPosition(ld.host.x + ld.host.leanX, ld.host.y + ld.host.leanY - DRAGON_ANIM.groundLift)
        .setDepth(ld.host.depth + 0.5)
        .setFlipX(flip);
      if (clip) {
        const origin = originFor(clip, flip);
        ld.clipOverlay.setOrigin(origin.x, origin.y).setScale(clip.scale);
        if (ld.sleepState === 'seated') {
          // The frozen tosleep frame breathes exactly as the sleep painting
          // did (BoardItem.applyBob): ribcage rises, body widens a little
          // less, phase hashed off the item id so neighbours never inhale
          // together. Bottom-anchored origin keeps the belly planted.
          const phase = ((((ld.host.itemId * 2654435761) >>> 0) % 1000) / 1000) * Math.PI * 2;
          const k = Math.sin((this.time.now / SLEEP_BREATH.periodMs) * Math.PI * 2 + phase);
          ld.clipOverlay.setScale(
            clip.scale * (1 - SLEEP_BREATH.amount * 0.45 * k),
            clip.scale * (1 + SLEEP_BREATH.amount * k)
          );
        }
      }
      // Last, so the keyline picks up every transform written above — including the
      // sleeper's breathing scale, which changes every frame.
      syncSpriteInk(ld.clipOverlay);
    } else if (ld.clipOverlay) {
      hideSpriteInk(ld.clipOverlay);
    }
  }

  private updateLiveDragons(delta: number): void {
    for (const ld of this.liveDragons.values()) {
      this.syncDragon(ld);
      ld.player?.update(delta);
      if (ld.busy || ld.host.getData('dragged')) continue; // flying/working/held: hold its animation
      // A sleeping dragon does not fidget: the rig is hidden behind the curled
      // sleep art, so rolling idle/hover under it would animate nothing and
      // wake it the instant the mood lifted mid-burst.
      if (ld.mood === 'asleep') {
        // Self-heal: a grounded sleeper must always END UP seated. Any race
        // that knocked the seat over (a flight ordered over the sleeper, a
        // transition whose completion got wiped) would otherwise freeze an
        // awake-LOOKING dragon for the whole nap or night — this loop is the
        // only thing still running for it, so this is where it re-seats.
        // "Airborne" must mean VISIBLY flying — a stale flightPhase whose
        // animation already ended is a wedge, not a flight.
        const airborne = ld.flightPhase !== null && ld.clipOverlay?.anims.isPlaying === true;
        if (ld.sleepState === 'none' && !airborne) this.seatDragonSleep(ld);
        continue;
      }
      // Hungry: a roar every DRAGON_ROAR_EVERY_MS, and nothing else changes.
      // It is a mood, not a state machine — the dragon carries on producing,
      // working and idling exactly as it always did.
      if (ld.mood === 'hungry') {
        ld.roarInMs -= delta;
        if (ld.roarInMs <= 0) {
          ld.roarInMs = DRAGON_ROAR_EVERY_MS;
          this.roarOnce(ld);
          continue;
        }
      }
      ld.remainMs -= delta;
      if (ld.remainMs > 0) continue;
      // Roll the next segment: mostly idle (~90% of the time), the rest a burst.
      // Calm ADULTS hover far more rarely and hold their idles much longer.
      const chance = ld.calm ? DRAGON_ANIM.adultCelebrateChance : DRAGON_ANIM.celebrateChance;
      if (ld.mode === 'idle' && Math.random() < chance) {
        ld.mode = 'hover';
        ld.remainMs = ld.calm ? DRAGON_ANIM.adultCelebrateMs : DRAGON_ANIM.celebrateMs;
        this.dragonHover(ld);
      } else {
        ld.mode = 'idle';
        ld.remainMs = this.idleSpanMs(ld.calm);
        this.dragonLand(ld); // fold the wings before standing — never a hard cut
      }
    }
  }

  /* ------------------------- egg auras ------------------------------- */

  /**
   * Give an egg its aura: heavy low surface smoke and a colour pool in the
   * sleeping dragon's own hue (`src/data/egg-aura.json`).
   *
   * One preset serves every egg; the instance palette supplies the colour and
   * the instance `weight` supplies the density — a legendary gets the full
   * effect, an ordinary chain egg gets half. An item that is not in the table
   * (which is almost all of them) costs one Map lookup and nothing else.
   */
  private attachItemAura(host: BoardItem): void {
    if (!this.fx || host.kind !== 'item' || this.itemAuras.has(host.itemId)) return;
    const doc = eggAuraJson as unknown as EggAuraFile;
    const spec = doc.eggs[auraKey(host.chain, host.tier)];
    if (!spec) return;
    const inst = auraInstanceFor(spec.weight);
    const rig = this.fx.spawn(doc.preset, host.x, host.y, {
      depth: host.depth,
      palette: spec.palette,
      // Per-item seed: two Red Eggs side by side must not pulse in unison, and
      // this is the only thing standing between them and that.
      seed: host.itemId * 7919,
      alpha: inst.alpha,
      rate: inst.rate,
      widthScale: inst.widthScale,
      heightScale: inst.heightScale
    });
    if (rig) this.itemAuras.set(host.itemId, { rig, host });
  }

  private detachItemAura(itemId: number): void {
    const aura = this.itemAuras.get(itemId);
    if (!aura) return;
    this.fx?.remove(aura.rig);
    this.itemAuras.delete(itemId);
  }

  /**
   * Follow the host, exactly as `syncDragon` does — an egg slides on a merge,
   * a drag and a spawn tween, and an aura that sat at the spawn point would
   * strand a puddle of smoke on an empty tile.
   */
  private syncItemAuras(): void {
    for (const [id, aura] of this.itemAuras) {
      const host = aura.host;
      if (!host.active) {
        this.detachItemAura(id);
        continue;
      }
      aura.rig.setPosition(host.x, host.y);
      // A LIFTED egg has no ground to pool smoke on. Hiding the rig while it is
      // in the player's hand is not a detail: at drag depth the ground pool
      // would float over the whole board.
      const lifted = this.dragSprite === host;
      aura.rig.setMasterAlpha(lifted ? 0 : 1).setDepth(host.depth);
    }
  }

  private removeDragonRig(itemId: number): void {
    const ld = this.liveDragons.get(itemId);
    if (!ld) return;
    ld.zzz?.destroy();
    ld.clipOverlay?.destroy();
    ld.player?.destroy();
    ld.shadow.destroy();
    this.liveDragons.delete(itemId);
    // The last whelp merged into an adult is the commonest way a breed becomes
    // worn by nobody, and 106 MB of sheets it left behind is the commonest way
    // a long session ends up over its budget.
    this.reconcileDragonClips();
  }

  /* ------------------------- ambient life ---------------------------- */

  /** Play the video-ingested roar clip on the overlay — the definitive bellow
   *  wherever a dragon roars (hungry cadence AND the newborn intro): one-shot,
   *  the idle roll held to the clip's real length, then back through
   *  dragonIdle. False when this breed has no pushed roar. */
  private playRoarClip(ld: LiveDragon): boolean {
    const roar = this.dragonClip(ld, 'roar');
    if (!roar) return false;
    const overlay = this.dressOverlay(ld, roar);
    ld.flightPhase = null;
    ld.sleepState = 'none'; // a bellowing dragon is not curled on a tile
    overlay.off(Phaser.Animations.Events.ANIMATION_COMPLETE);
    overlay.setVisible(true);
    ld.player?.container.setVisible(false);
    overlay.play(roar.key);
    ld.mode = 'idle';
    ld.remainMs = (roar.clip.frames / roar.clip.fps) * 1000;
    overlay.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (this.liveDragons.get(ld.host.itemId) === ld && ld.mood !== 'asleep') {
        this.dragonIdle(ld);
      }
    });
    return true;
  }

  /** One hungry roar. The ingested roar clip when pushed; without it the rig
   *  rears back with the wide-mouth face, exactly as before. Purely a mood —
   *  nothing in the economy hears it. */
  private roarOnce(ld: LiveDragon): void {
    if (!this.playRoarClip(ld) && ld.player) {
      // Clearing the overlay is only safe when there is a rig BEHIND it to take
      // the tile. On a clip-only breed whose roar sheet has not landed yet it
      // would leave nothing on screen at all, so that one keeps its idle and
      // bellows silently — the sparks and the "Hungry!" still say so.
      this.clearDragonOverlay(ld); // the bellow is the rig's — never under a fly loop
      ld.player.container.setVisible(true);
      ld.player.play('roar');
      ld.player.playFace(2); // wide mouth for the length of the bellow
      ld.mode = 'idle';
      ld.remainMs = DRAGON_ROAR_MS;
      this.time.delayedCall(DRAGON_ROAR_MS, () => {
        if (this.liveDragons.get(ld.host.itemId) === ld && ld.mood !== 'asleep') {
          this.dragonIdle(ld);
        }
      });
    }
    this.sparks.explode(5, ld.host.x, ld.host.y - 90);
    this.floatText(ld.host.x, ld.host.y - 170, 'Hungry!', PALETTE.lavaHighlight);
  }

  /**
   * The mood changed. Sleep is the only one that swaps what is DRAWN: the rig is
   * a standing puppet and cannot curl up, so the curled sleeping painting stands
   * in for it and the rig hides behind it.
   *
   * A breed with no sleep art simply dims and shows the 💤 — the behaviour is
   * the same for every dragon, only the red one has its portrait for it.
   */
  /**
   * The Align-Studio clip dressing this dragon (character-anims.json `board`
   * key, e.g. 'ember_dragon:3' → redwhelp), with its Phaser anim registered.
   * Null when this breed/tier has no pushed clips or the sheet is not resident.
   */
  private dragonClip(ld: LiveDragon, clipId: string): { clip: CharacterClip; key: string } | null {
    const id = this.clipCharacterFor(ld.host.chain, ld.host.tier);
    if (!id) return null;
    const clip = clipFor(id, clipId);
    const key = clipKey(id, clipId);
    if (!clip || !this.textures.exists(key)) return null;
    this.touchClip(id, clipId); // most-recently-needed, for the LRU
    this.ensureAnimForLiveTexture(key, key, () => ({
      key,
      frames: this.anims.generateFrameNumbers(key, { start: 0, end: clip.frames - 1 }),
      frameRate: clip.fps,
      repeat: clip.loop ? -1 : 0
    }));
    return { clip, key };
  }

  /**
   * Fetch a breed's EAGER clips the first time one of its dragons stands on the
   * board — never at boot, and never the whole wardrobe.
   *
   * These are the heaviest textures the game has, and it is frame COUNT that
   * does it: the red whelp's `fly` is 184 frames of 292×244, uploaded as one
   * sheet worth 50 MB of video memory, and its full wardrobe is 106 MB. Six
   * breeds of that resident at once is 608 MB. So a breed arrives in two waves
   * (`clipLoadTiers`): the idle it rests on and the fly the next grab needs
   * come now, the mood clips come with the mood — see `ensureMoodClip`.
   *
   * Nothing waits on the result: `dragonClip` returns null while a sheet is
   * missing and the dragon animates with its rig, which is how it moved before
   * these clips existed. They take over on the frame they arrive.
   */
  private ensureDragonClips(chain: string, tier: number): void {
    const id = this.clipCharacterFor(chain, tier);
    if (!id) return;
    this.fetchClips(id, clipLoadTiers(id, { lean: DRAGON_CLIPS.lean }).eager);
  }

  /**
   * Fetch a mood clip the moment its beat is decided — the hungry roar, the
   * curl into sleep. They are left out of the eager wave (`clipLoadTiers`)
   * because they are 27-36 MB on the adults and draw for a second and a half,
   * a minute apart, only while the mood holds. Every one of them announces
   * itself well before it is drawn, so fetching here costs nothing visible and
   * a session that never starved a dragon never pays for the bellow at all.
   */
  private ensureMoodClip(ld: LiveDragon, clipId: string): void {
    const id = this.clipCharacterFor(ld.host.chain, ld.host.tier);
    if (id) this.fetchClips(id, [clipId]);
  }

  /** Queue a breed's named sheets, making room for them first. */
  private fetchClips(id: string, clipIds: readonly string[]): void {
    const wanted = clipIds.filter((c) => clipFor(id, c) !== null && !this.dragonClipsAsked.has(`${id}/${c}`));
    if (!wanted.length) return;
    for (const c of wanted) this.dragonClipsAsked.add(`${id}/${c}`);
    // MAKE ROOM BEFORE ASKING, never after: a sheet costs its video memory from
    // the moment it uploads, so an eviction that runs once the newcomer has
    // landed has already been paid for by the peak it was meant to avoid.
    this.reconcileDragonClips(wanted.map((clip) => ({ breed: id, clip })));
    this.loads.run(
      () => {
        for (const clipId of wanted) {
          const clip = clipFor(id, clipId)!;
          if (this.textures.exists(clipKey(id, clipId))) continue;
          this.load.spritesheet(clipKey(id, clipId), clip.file, {
            frameWidth: clip.frameWidth,
            frameHeight: clip.frameHeight
          });
          this.residentClips.set(`${id}/${clipId}`, { breed: id, clip: clipId });
        }
      },
      () => this.dressBreedClips(id)
    );
  }

  /**
   * Hand every live dragon of a breed to its freshly-arrived clip set.
   *
   * Only dragons that are doing NOTHING are touched — one mid-flight, mid-nap,
   * mid-celebration or in the player's hand is in the middle of something the
   * rig is perfectly able to finish, and cutting it to an idle to gain a nicer
   * idle is a worse trade than waiting for the beat to end.
   */
  private dressBreedClips(id: string): void {
    for (const ld of this.liveDragons.values()) {
      if (this.clipCharacterFor(ld.host.chain, ld.host.tier) !== id) continue;
      if (ld.busy || ld.mood === 'asleep' || ld.mode === 'hover') continue;
      if (ld.flightPhase !== null || ld.host.getData('dragged')) continue;
      this.dragonIdle(ld);
    }
    // …and MOUNT anything of this breed still standing as a static sprite.
    // With rigs off there is no puppet to hold the animal while its sheets
    // are on the wire: it spawns still, `attachDragon` bails (after asking
    // for exactly this fetch), and THIS is the arrival that makes it live.
    for (const sprite of this.itemSprites.values()) {
      if (this.clipCharacterFor(sprite.chain, sprite.tier) !== id) continue;
      if (!this.wearsRigTier(sprite.chain, sprite.tier)) continue;
      if (this.liveDragons.has(sprite.itemId) || sprite.getData('dragged')) continue;
      this.attachDragon(sprite, false);
    }
  }

  /** `breed/clip` sheets already asked for, so each fetch runs once. */
  private dragonClipsAsked = new Set<string>();

  /** Resident sheets in LEAST-recently-needed order — a Map iterates in
   *  insertion order, and `touchClip` re-inserts, so this IS the LRU queue. */
  private residentClips = new Map<string, ClipRef>();

  /**
   * THE ONE DOOR onto this scene's loader (src/core/LoadQueue.ts).
   *
   * Four unrelated things fetch art here — the world's backdrop at a portal, a
   * breed's clip sheets, the Elder's, and the dragon rigs — on four unrelated
   * schedules: a portal tap, a merge, a dragon getting hungry, a scene boot.
   * They share ONE LoaderPlugin, on which `start()` is a silent no-op while a
   * run is in flight and COMPLETE is broadcast to every listener at once, so
   * overlapping them hands each caller the other's callback. That is how travel
   * came to hang under the veil: `fetchWorldArt` was told its files were
   * resident by somebody else's run, or never told at all.
   */
  private loads = new LoadQueue({
    isReady: () => this.load.isReady(),
    once: (event, fn) => void this.load.once(event, fn),
    start: () => this.load.start()
  });

  /**
   * The clip character dressing this board dragon, respecting the worn
   * Emporium skin: a purchased Frost or Storm IS that breed on the board, and
   * that is also what bounds the memory — one wardrobe is askable, not the
   * whole catalogue.
   */
  private clipCharacterFor(chain: string, tier: number): string | null {
    return dragonClipCharacter(chain, tier, this.ctx.state.dragonSkins[chain] ?? null);
  }

  /**
   * True when this breed+skin's clip set carries the WHOLE animal, so no rig is
   * built for it at all.
   *
   * The idle is the floor — everything else degrades onto it — and the sheet
   * must actually be RESIDENT, not merely staged: a breed mounted clip-only on
   * a sheet that failed to load is an invisible dragon, where the rig path is
   * merely a plainer one. This is also what makes a bought Frost dragon a
   * Frost dragon rather than the red rig wearing frost paint.
   */
  private clipComplete(chain: string, tier: number): boolean {
    const id = this.clipCharacterFor(chain, tier);
    if (!id || clipFor(id, 'idle') === null) return false;
    return this.textures.exists(clipKey(id, 'idle'));
  }

  /** Face the animal left/right. The overlay follows `ld.facing` through
   *  syncDragon/dressOverlay; the rig container follows too when the breed
   *  still has one. */
  private setDragonFacing(ld: LiveDragon, dir: 'left' | 'right'): void {
    ld.facing = dir === 'left' ? 1 : -1;
    ld.player?.setFacing(dir);
  }

  /** Keyline weight for a clip-only animal, from its idle clip's displayed size
   *  through the same formula the rigs use — the line must not change weight
   *  between a rigged breed and a clip-only one standing side by side. */
  private clipOutlineUnits(ld: LiveDragon): number {
    const idle = this.dragonClip(ld, 'idle');
    const size = idle
      ? Math.max(idle.clip.frameWidth, idle.clip.frameHeight) * idle.clip.scale
      : 666 * DRAGON_ANIM.whelpScale;
    return keylineUnits(size, DRAGON_OUTLINE);
  }

  /** Mark a sheet most-recently-needed so the LRU takes the coldest first. */
  private touchClip(breed: string, clip: string): void {
    const id = `${breed}/${clip}`;
    const ref = this.residentClips.get(id);
    if (!ref) return;
    this.residentClips.delete(id);
    this.residentClips.set(id, ref);
  }

  /**
   * Hand back the dragon sheets this board is no longer made of.
   *
   * The counterpart of `releaseAwayWorldArt`, and deliberately the same shape:
   * ONE policy (`planClipEviction`) decides both what may stay and what goes,
   * so the two can never drift into a leak. Called whenever the answer might
   * have changed — a fetch, a merge, a skin swap, a rebuilt board — rather
   * than on one event, so it self-corrects whatever route got us here.
   *
   * What is never offered: a sheet an overlay is drawing (evicting under a
   * live sprite null-crashes the renderer and hangs the game — the travel
   * freeze all over again), and the eager sheets of a breed still on the board.
   */
  private reconcileDragonClips(incoming: ClipRef[] = []): void {
    const live = new Set<string>();
    const playing: ClipRef[] = [];
    for (const ld of this.liveDragons.values()) {
      const breed = this.clipCharacterFor(ld.host.chain, ld.host.tier);
      if (!breed) continue;
      live.add(breed);
      const key = ld.clipOverlay?.visible ? ld.clipOverlay.anims.currentAnim?.key : undefined;
      // Anim keys are the clip keys (`canim_<breed>_<clip>`), segment keys
      // suffix them — either way the sheet behind it is load-bearing.
      for (const clip of Object.keys(clipsFor(breed))) {
        if (key?.startsWith(clipKey(breed, clip))) playing.push({ breed, clip });
      }
    }
    const plan = planClipEviction({
      live,
      playing,
      resident: [...this.residentClips.values()],
      incoming,
      lean: DRAGON_CLIPS.lean,
      budgetBytes: (DRAGON_CLIPS.lean ? DRAGON_CLIPS.leanBudgetMb : DRAGON_CLIPS.budgetMb) * 1024 * 1024
    });
    for (const ref of plan.drop) {
      const key = clipKey(ref.breed, ref.clip);
      // Same last word as the world-art eviction: the plan reasons about which
      // breed is LIVE, but an ink twin or an overlay that has moved on can
      // still be holding the sheet, and pulling it out ends the RAF chain.
      if (this.textures.exists(key) && this.textureInUse(key)) continue;
      // The Phaser animation goes with its frames: left behind it would point
      // at a texture that no longer exists, and the next `play` of it would
      // draw nothing at all rather than fall back to the rig.
      if (this.anims.exists(key)) this.anims.remove(key);
      if (this.textures.exists(key)) this.textures.remove(key);
      this.residentClips.delete(`${ref.breed}/${ref.clip}`);
      this.dragonClipsAsked.delete(`${ref.breed}/${ref.clip}`);
    }
  }

  /**
   * Is any live Game Object still drawing this texture — in ANY running scene?
   *
   * The last word before an eviction. `worldArtKeys` says which world owns a
   * texture, which is a rule about DATA; this asks the only authority on who is
   * actually using it. They disagree whenever something outside the board holds
   * world art: UIScene never restarts, an overlay can outlive the beat that
   * raised it, and a tween can be mid-flight over a sprite nothing else
   * remembers. Removing a texture under any of them nulls the renderer's frame
   * and ends the RAF chain — a frozen session, not a missing picture.
   *
   * Walks containers too: a board item is a Container whose art is a child, so
   * a top-level scan would see none of it.
   */
  private textureInUse(key: string): boolean {
    const uses = (list: Phaser.GameObjects.GameObject[]): boolean => {
      for (const obj of list) {
        if ((obj as { texture?: { key?: string } }).texture?.key === key) return true;
        const inner = (obj as { list?: Phaser.GameObjects.GameObject[] }).list;
        if (Array.isArray(inner) && uses(inner)) return true;
      }
      return false;
    };
    for (const scene of this.scene.manager.getScenes(true)) {
      if (uses(scene.children.list)) return true;
    }
    return false;
  }

  /**
   * Register a spritesheet animation AGAINST THE TEXTURE THAT IS LIVE NOW,
   * rebuilding it if the one on file was built from a texture since destroyed.
   *
   * `this.anims` is GAME-scoped: an animation outlives the scene that made it,
   * and — the part that bites — it outlives the TEXTURE it was made from. Travel
   * destroys textures (`releaseAwayWorldArt` hands back the departed world's
   * art), and coming back re-creates them under the same keys as brand new
   * Texture objects. So `anims.exists(key)` is the wrong idempotence test: it is
   * true, and the animation it is true about still holds frames pointing into
   * the destroyed texture. Playing that takes the scene down inside `create()`,
   * and the travel veil never lifts — the game sits on the loading screen.
   *
   * That is the freeze. Every world-art animation has to go through here: a
   * character's clips, her cast bank, a decor clip, and — ours, which main does
   * not have — the flight SEGMENTS and the Elder's own clips, which are cut from
   * the same evicted sheets.
   */
  private ensureAnimForLiveTexture(
    animKey: string,
    textureKey: string,
    config: () => Phaser.Types.Animations.Animation
  ): void {
    const existing = this.anims.get(animKey);
    if (existing) {
      const first = existing.frames[0];
      // Same Texture OBJECT, not the same key — the key is exactly what stayed
      // the same across the eviction. `textureKey` is passed separately because
      // a segment animation is keyed off its clip's sheet, not off its own name.
      if (first && first.frame.texture === this.textures.get(textureKey)) return;
      this.anims.remove(animKey);
    }
    this.anims.create(config());
  }

  /** The overlay sprite that stands in for the rig while a clip plays. */
  private dragonOverlay(ld: LiveDragon, key: string): Phaser.GameObjects.Sprite {
    if (!ld.clipOverlay) {
      ld.clipOverlay = this.add.sprite(ld.host.x, ld.host.y - DRAGON_ANIM.groundLift, key).setVisible(false);
      // A clip HIDES the rig, and with it the rig's keyline, so the stand-in has to
      // carry its own — at the rig's exact width, since the handover happens
      // mid-animation and a line that changed weight across it would read as a
      // flinch. See src/render/SpriteInk.ts.
      attachSpriteInk(this, ld.clipOverlay, { units: ld.player?.outlineUnits ?? this.clipOutlineUnits(ld) });
    }
    return ld.clipOverlay;
  }

  /**
   * Bind a clip to the overlay and dress it NOW — origin, scale, flip,
   * position, depth. `syncDragon` re-applies all of this every frame, but a
   * clip SWITCH must never wait for it: mood events land in the
   * `time:advanced` tail of update(), AFTER updateLiveDragons already ran, so
   * the new texture would render once wearing the previous clip's transform —
   * a tosleep frame at the fly clip's scale is a giant dragon flashing for
   * one frame. A freshly created overlay (scale 1, centre origin) has the
   * same window.
   */
  private dressOverlay(ld: LiveDragon, c: { clip: CharacterClip; key: string }): Phaser.GameObjects.Sprite {
    const overlay = this.dragonOverlay(ld, c.key);
    overlay.setData('clip', c.clip);
    // One overlay serves every clip, so a rate set for a gesture (the quick
    // wings-open of a pick-up) would otherwise still be on the sprite when the
    // idle, the roar or the curl-up plays next. Cleared HERE because this is
    // the one door every clip goes through; the phases that want a rate set it
    // again immediately after.
    overlay.anims.timeScale = 1;
    const flip = ld.facing < 0;
    const origin = originFor(c.clip, flip);
    overlay
      .setPosition(ld.host.x, ld.host.y - DRAGON_ANIM.groundLift)
      .setDepth(ld.host.depth + 0.5)
      .setFlipX(flip)
      .setOrigin(origin.x, origin.y)
      .setScale(c.clip.scale);
    // The overlay IS the visible pose now, so it is also the clickable one:
    // taps must land on the curl/wingspan the player SEES, not on the hidden
    // art's silhouette underneath.
    ld.host.setPoseProxy(overlay);
    return overlay;
  }

  private clearDragonOverlay(ld: LiveDragon): void {
    ld.flightPhase = null;
    if (!ld.clipOverlay) return;
    ld.clipOverlay.off(Phaser.Animations.Events.ANIMATION_COMPLETE);
    ld.clipOverlay.stop();
    ld.clipOverlay.setVisible(false);
    ld.host.refreshHitArea(); // hidden proxy → the input rect goes back to the art's
  }

  /** Segment anim key for a phased clip (takeoff / loop / landing). */
  private segKey(base: string, seg: string): string {
    return `${base}_${seg}`;
  }

  /** Register the fly clip's phase anims (idempotent); null without segments. */
  private flySegments(ld: LiveDragon): { clip: CharacterClip; key: string } | null {
    const f = this.dragonClip(ld, 'fly');
    if (!f?.clip.segments) return null;
    for (const [seg, [start, end]] of Object.entries(f.clip.segments)) {
      const key = this.segKey(f.key, seg);
      // Cut from the CLIP's sheet, so that is the texture its liveness is
      // judged against — not its own name, which no texture is filed under.
      this.ensureAnimForLiveTexture(key, f.key, () => ({
        key,
        frames: this.anims.generateFrameNumbers(f.key, { start, end: end - 1 }),
        frameRate: f.clip.fps,
        repeat: seg === 'loop' ? -1 : 0
      }));
    }
    return f;
  }

  /** ms a segment takes at the clip's own frame rate. */
  private segMs(clip: CharacterClip, seg: string): number {
    const range = clip.segments?.[seg];
    return range ? ((range[1] - range[0]) / clip.fps) * 1000 : 0;
  }

  /**
   * AIRBORNE. The Align-Studio fly clip is the definitive flight when this
   * breed has it pushed: takeoff ramps once, then the seamless cruise loop —
   * the rig steps aside (hidden, so one dragon never wears two animations).
   *
   * `durationMs` (a tweened journey leg) also schedules the LANDING so it
   * begins `landingLeadMs` BEFORE touchdown and folds its wings on the tile —
   * never a landing played in the air, never a touchdown still mid-cruise. A
   * leg too short for the full ramp skips the takeoff and cruises at once.
   * No duration = hold the loop until `dragonLand` (drag release, burst end).
   */
  private dragonHover(ld: LiveDragon, durationMs?: number, onAirborne?: () => void): void {
    // A dragon taking wing is by definition not curled on a tile. A flight
    // ordered over a sleeper (work drop, wander race) used to strand
    // `sleepState` at seated/transition, and every later seatDragonSleep
    // no-opped on the stale guard — the frozen-dragon bug.
    //
    // Clearing that state is only half of it: the curled PAINTING is still on
    // the host, and dropping the flag is what once hid it from the wake path
    // that would have taken it off. Undress here too, so the animal that takes
    // wing is wearing what it will land in.
    ld.sleepState = 'none';
    this.restoreStandingArt(ld);
    // ASK FOR THE WINGS. On a handset the eager wave is the idle alone, so the
    // fly sheet is not resident the first time an animal takes off — and with
    // the rigs off there is no puppet to cover for it, only the glide the
    // fallback below falls back to. This is the same on-demand fetch the roar
    // and the sleep curl use: the first flight glides, every one after it has
    // wings, and a session whose dragons never fly never pays for them at all.
    this.ensureMoodClip(ld, 'fly');
    const f = this.flySegments(ld);
    if (!f) {
      // No phased clip: the whole-loop overlay, else the rig's hover preset
      // (clearing any idle overlay a partial push may have left standing in).
      const whole = this.dragonClip(ld, 'fly');
      if (!whole) {
        if (ld.player) {
          this.clearDragonOverlay(ld);
          ld.player.container.setVisible(true);
          ld.player.play('hover');
        } else {
          // A CLIP-ONLY breed with no fly sheet at all (the Emporium babies)
          // keeps its idle look for the glide — the journey tween carries the
          // motion, and an animal that slides is better than one that vanishes.
          this.dragonIdle(ld);
        }
        onAirborne?.(); // no wings to unfold — the journey may start at once
        return;
      }
      const overlay = this.dressOverlay(ld, whole);
      overlay.off(Phaser.Animations.Events.ANIMATION_COMPLETE);
      overlay.setVisible(true);
      overlay.play(whole.key, true);
      ld.player?.container.setVisible(false);
      onAirborne?.(); // an unphased loop is airborne from its first frame
      return;
    }
    const overlay = this.dressOverlay(ld, f);
    overlay.off(Phaser.Animations.Events.ANIMATION_COMPLETE);
    overlay.setVisible(true);
    ld.player?.container.setVisible(false);
    const airborne = ld.flightPhase === 'takeoff' || ld.flightPhase === 'loop';
    if (!airborne) {
      // Measured against the SCREEN length of the ramp, not the authored one:
      // the takeoff is played at `takeoffRate`, so a leg that could not fit the
      // 2.5 s cinematic ramp can still fit the 1.4 s one and gets its wings-open
      // instead of cutting straight to the cruise.
      const takeoffMs = this.segMs(f.clip, 'takeoff') / DRAGON_ANIM.takeoffRate;
      const rampFits = durationMs === undefined || durationMs > takeoffMs + DRAGON_ANIM.landingLeadMs;
      if (rampFits) {
        ld.flightPhase = 'takeoff';
        overlay.anims.timeScale = DRAGON_ANIM.takeoffRate;
        overlay.play(this.segKey(f.key, 'takeoff'));
        overlay.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
          if (ld.flightPhase !== 'takeoff') return;
          ld.flightPhase = 'loop';
          // The CRUISE is authored at the rate it should beat at — only the
          // ramp into it is hurried, so the flight settles the moment it is
          // airborne rather than staying fast for as long as it is held.
          overlay.anims.timeScale = 1;
          overlay.play(this.segKey(f.key, 'loop'));
          // The wings are up and cycling — NOW the journey may start. A caller
          // that translated the sprite immediately instead skated it across the
          // board through its own unfold, which is what made a work trip read
          // as too fast to follow.
          onAirborne?.();
        });
      } else {
        ld.flightPhase = 'loop';
        overlay.play(this.segKey(f.key, 'loop'));
        onAirborne?.();
      }
    } else {
      onAirborne?.(); // already on the wing (the return leg) — carry straight on
    }
    if (durationMs !== undefined) {
      const lead = Math.min(DRAGON_ANIM.landingLeadMs, durationMs * 0.6);
      this.time.delayedCall(Math.max(0, durationMs - lead), () => {
        if (this.liveDragons.get(ld.host.itemId) === ld) this.dragonLand(ld);
      });
    }
  }

  /**
   * Touch down: the landing phase (wing fold, authored frames 192→end) plays
   * once and hands back to the rig's idle — or straight to the curled sleep
   * seat when the mood went `asleep` mid-air (sleep is deferred to HERE).
   */
  private dragonLand(ld: LiveDragon): void {
    const f = ld.clipOverlay?.visible ? this.flySegments(ld) : null;
    if (!f || ld.flightPhase === null || ld.flightPhase === 'landing') {
      if (ld.flightPhase !== 'landing') this.dragonIdle(ld);
      return;
    }
    const overlay = this.dragonOverlay(ld, f.key);
    ld.flightPhase = 'landing';
    overlay.off(Phaser.Animations.Events.ANIMATION_COMPLETE);
    overlay.anims.timeScale = DRAGON_ANIM.landingRate;
    overlay.play(this.segKey(f.key, 'landing'));
    overlay.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (this.liveDragons.get(ld.host.itemId) === ld) this.dragonIdle(ld);
    });
  }

  /** GROUNDED: if the mood is asleep, the deferred sleep finally seats (this
   *  is the one door). Otherwise the video-ingested idle clip is the
   *  definitive rest when pushed — the rig stays hidden behind it; without it
   *  the overlay steps aside and the rig's idle preset returns. */
  private dragonIdle(ld: LiveDragon): void {
    ld.flightPhase = null;
    if (ld.mood === 'asleep') {
      if (ld.sleepState === 'none') this.seatDragonSleep(ld);
      return;
    }
    // Awake and grounded: any leftover seat bookkeeping is stale by
    // definition (it would otherwise pin the breath scale to this clip and
    // no-op the NEXT night's seatDragonSleep).
    ld.sleepState = 'none';
    const idle = this.dragonClip(ld, 'idle');
    if (idle) {
      const overlay = this.dressOverlay(ld, idle);
      overlay.off(Phaser.Animations.Events.ANIMATION_COMPLETE);
      overlay.setVisible(true);
      ld.player?.container.setVisible(false);
      // An idle roll landing on idle again must not restart the breath cycle.
      if (overlay.anims.currentAnim?.key !== idle.key || !overlay.anims.isPlaying) {
        overlay.play(idle.key);
        this.armIdleRoar(ld, overlay, idle.key);
      }
      return;
    }
    this.clearDragonOverlay(ld);
    if (!ld.player) return; // clip-only breeds always have an idle sheet
    ld.player.container.setVisible(true);
    ld.player.play('idle');
  }

  /**
   * Ambient bellow cadence: after every 3–5 full idle loops (rolled fresh
   * each time the idle starts) the roar clip plays once — no sparks, no
   * "Hungry!", just the animal clearing its throat — and its completion
   * returns through dragonIdle, which re-arms with a new roll. Counted off
   * ANIMATION_REPEAT so only WATCHED stillness accrues: flights, sleeps and
   * bursts reset the count by restarting the idle.
   */
  private armIdleRoar(ld: LiveDragon, overlay: Phaser.GameObjects.Sprite, idleKey: string): void {
    let loops = Phaser.Math.Between(DRAGON_ANIM.idleRoarMinLoops, DRAGON_ANIM.idleRoarMaxLoops);
    // Three to five idle loops of warning — ~24-40 s — is the most notice any
    // deferred sheet gets, and it is plenty. Without this the ambient bellow
    // would be the one beat that arrives before its frames do.
    this.ensureMoodClip(ld, 'roar');
    overlay.off(Phaser.Animations.Events.ANIMATION_REPEAT);
    overlay.on(Phaser.Animations.Events.ANIMATION_REPEAT, (anim: Phaser.Animations.Animation) => {
      if (anim.key !== idleKey || this.liveDragons.get(ld.host.itemId) !== ld) return;
      if (ld.busy || ld.mood === 'asleep' || ld.flightPhase !== null || ld.host.getData('dragged')) return;
      if (--loops > 0) return;
      overlay.off(Phaser.Animations.Events.ANIMATION_REPEAT);
      this.playRoarClip(ld);
    });
  }

  /**
   * The TOSLEEP transition (one-shot; reversed to wake — the clip is authored
   * idle→sleep). The rig and the host art both step aside for its 2 s; `done`
   * seats whatever the destination state shows.
   */
  private playDragonTransition(
    ld: LiveDragon,
    t: { clip: CharacterClip; key: string },
    reverse: boolean,
    done: () => void
  ): void {
    const overlay = this.dressOverlay(ld, t);
    overlay.off(Phaser.Animations.Events.ANIMATION_COMPLETE);
    overlay.stop();
    overlay.setVisible(true);
    ld.player?.container.setVisible(false);
    ld.host.setArtVisible(false);
    overlay.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      overlay.setVisible(false);
      done();
    });
    if (reverse) overlay.playReverse(t.key);
    else overlay.play(t.key);
  }

  /**
   * Curl up ON THE TILE: the TOSLEEP transition (when pushed) then the sleep
   * painting + breath + 💤. Only ever called with the dragon grounded —
   * applyDragonMood defers to dragonIdle while it flies. Idempotent via
   * `sleepState`, so a landing chain cannot double-seat.
   */
  private seatDragonSleep(ld: LiveDragon): void {
    if (ld.sleepState !== 'none') return;
    const seatSleep = (): void => {
      ld.sleepState = 'seated';
      const sleepKey = `sleep_${ld.host.chain}_${ld.host.tier}`;
      if (!this.textures.exists(sleepKey)) {
        // No curled painting for this breed: the FULLY-BLINKED idle frame is
        // the sleep pose — eyes closed is what separates "asleep" from
        // "stuck". Calibrated per breed (sleep-frames.json); syncDragon's
        // seated branch breathes the frozen frame exactly as it breathes the
        // red whelp's tosleep freeze. Only a breed with no calibrated frame
        // falls back to the old dimmed animated idle — eyes open, so the dim
        // does the talking.
        if (ld.player) {
          ld.player.container.setVisible(true).setAlpha(0.65);
          return;
        }
        const idle = this.dragonClip(ld, 'idle');
        if (!idle) return;
        const id = this.clipCharacterFor(ld.host.chain, ld.host.tier);
        const closed = id ? sleepFrameFor(id) : null;
        const overlay = this.dressOverlay(ld, idle);
        overlay.off(Phaser.Animations.Events.ANIMATION_COMPLETE);
        if (closed !== null) {
          overlay.stop();
          overlay.setFrame(closed);
          overlay.setVisible(true).setAlpha(1);
        } else {
          overlay.setVisible(true).setAlpha(0.65);
          if (overlay.anims.currentAnim?.key !== idle.key || !overlay.anims.isPlaying) overlay.play(idle.key);
        }
        return;
      }
      // The rig steps aside and the painting takes the tile — but the rig's
      // GROUND SHADOW stays exactly where it was. The curled art's anchor is
      // its own alpha-bbox floor line (anchors.json), so its belly lands on
      // the tile origin, which is the same line `syncDragon` puts that shadow
      // on: the dragon lies down ON its shadow rather than hovering over a
      // second one the item would otherwise light beneath itself.
      ld.player?.container.setVisible(false);
      ld.host.setArtTexture(sleepKey, this.ctx.data.anchors);
      ld.host.setArtScale(plateScale(sleepKey, ITEM_SCALE[sleepKey] ?? DRAGON_SLEEP_SCALE));
      ld.wearingSleepArt = true;
      ld.host.setArtVisible(true);
      ld.host.setGroundShadowVisible(false);
      // A still frame reads as a dead sprite, so the painting BREATHES.
      // Phase is hashed off the item id — two dragons asleep side by side
      // must not inhale together. The groundLift drop seats the belly on the
      // exact floor line the rig's feet stood on — the line its kept shadow
      // was tuned to — instead of the container origin 20px above it.
      ld.host.setSleepBreath(
        true,
        (((ld.host.itemId * 2654435761) >>> 0) % 1000 / 1000) * Math.PI * 2,
        -DRAGON_ANIM.groundLift
      );
    };
    // The Align-Studio TOSLEEP transition is the definitive way down when
    // pushed: the whelp curls up over ~2 s and then SLEEPS ON THE CLIP'S OWN
    // LAST FRAME — the transition ends exactly where the sleep pose begins,
    // so freezing that frame is seamless where the old swap to the
    // separately-authored painting popped. Without the clip, the painting
    // lands at once, exactly as before.
    const t = this.dragonClip(ld, 'tosleep');
    if (t) {
      ld.sleepState = 'transition';
      ld.flightPhase = null;
      this.playDragonTransition(ld, t, false, () => {
        const overlay = this.dressOverlay(ld, t);
        overlay.setFrame(t.clip.frames - 1);
        overlay.setVisible(true);
        ld.sleepState = 'seated'; // syncDragon breathes the frozen frame
      });
    } else {
      this.clearDragonOverlay(ld); // a lingering fly overlay must not cover the painting
      seatSleep();
    }
    // A dragon sleeping off a SHIFT already wears the rest badge, and that
    // badge is a 💤 with the countdown on it. A second 💤 beside it reads as
    // a bug rather than as emphasis.
    const resting = this.ctx.systems.jobs.restRemaining(ld.host.itemId) > 0;
    ld.zzz?.destroy();
    ld.zzz = undefined;
    if (!resting) {
      const puff = this.add.text(0, -150, '💤', { fontSize: '46px' }).setOrigin(0.5);
      ld.zzz = this.add
        .container(ld.host.x, ld.host.y, [puff])
        .setDepth(DEPTHS.itemBase + ld.host.y + 4);
      // The drift tweens the TEXT inside the container, so the container is
      // free to follow the host — a dragged sleeper takes its 💤 along.
      this.tweens.add({
        targets: puff,
        y: -210,
        alpha: { from: 0.9, to: 0.15 },
        duration: 3400,
        repeat: -1,
        ease: 'Sine.easeOut'
      });
    }
  }

  /**
   * Put the STANDING art back on the host, whatever route the sleep ended by.
   *
   * The host is invisible while a rig or clip stands in for it, so this is not
   * about what the player sees — it is about what they can HIT. The clickable
   * rect is cut from the art's bounds and the pixel test reads the art's own
   * alpha, so a host left in its curled painting is a dragon that is standing
   * on screen and answers taps only over a ball a fraction of its size. It also
   * matters to the pool: a released item still wearing `sleep_*` would come
   * back as some other tile's sleeping dragon.
   *
   * Idempotent, and keyed on `wearingSleepArt` rather than on any animation
   * state, so every path out of a sleep — the tap, the timer, a flight ordered
   * over the sleeper — can call it without knowing what the others did.
   */
  private restoreStandingArt(ld: LiveDragon): void {
    if (!ld.wearingSleepArt) return;
    ld.wearingSleepArt = false;
    ld.host.setSleepBreath(false);
    const item = this.ctx.state.items.get(ld.host.itemId);
    // Through `textureFor`, not a hand-built `item_<chain>_<tier>`: a dragon
    // wearing a bought skin used to wake up in the base breed's clothes and
    // stay that way until something else re-skinned the board.
    const standKey = item
      ? this.textureFor(this.ctx.state.snapshot(item, this.ctx.clock.now()))
      : `item_${ld.host.chain}_${ld.host.tier}`;
    if (this.textures.exists(standKey)) {
      ld.host.setArtTexture(standKey, this.ctx.data.anchors);
      ld.host.setArtScale(
        plateScale(
          standKey,
          // Same precedence as the acquire path — per-tier, then chain, then 1.
          // Dropping the chain-level fallback here would wake a breed whose
          // scale is declared only for the chain at full authoring size.
          ITEM_SCALE[`${ld.host.chain}_${ld.host.tier}`] ?? ITEM_SCALE[ld.host.chain] ?? 1
        )
      );
    }
    ld.host.setArtVisible(false);
  }

  private applyDragonMood(itemId: number, mood: 'awake' | 'hungry' | 'asleep'): void {
    const ld = this.liveDragons.get(itemId);
    if (!ld) return;
    const was = ld.mood;
    ld.mood = mood;
    if (mood === 'hungry') ld.roarInMs = 0; // say so at once, then on the cadence
    if (was === mood) return;
    // The mood is the cue to go and get the sheet it will be drawn with. Both
    // of these announce themselves before anything is rendered — a roar waits
    // out `roarInMs`, a sleep plays a transition — so the fetch has time, and
    // a session that never made a dragon hungry never pays for the bellow.
    if (mood === 'hungry') this.ensureMoodClip(ld, 'roar');
    if (mood === 'asleep') this.ensureMoodClip(ld, 'tosleep');

    if (mood === 'asleep') {
      // AIRBORNE dragons do not fall asleep in the air. The mood is recorded
      // (idle rolls already stop on it) but the curl-up waits for the flight
      // to touch down — dragonIdle() is the one door onto the tile, and it
      // seats the deferred sleep the moment the dragon is actually standing.
      const airborne = ld.busy || ld.flightPhase !== null;
      if (!airborne) this.seatDragonSleep(ld);
      return;
    }

    // Waking up. Only a sleep that actually SEATED has anything to undo — a
    // deferred sleep (mood flipped back mid-flight) changed nothing on screen,
    // and a hungry↔awake change never touches what is drawn.
    if (was !== 'asleep') return;
    ld.zzz?.destroy();
    ld.zzz = undefined;
    const seated = ld.sleepState === 'seated';
    const midTransition = ld.sleepState === 'transition';
    ld.sleepState = 'none';
    if (!seated && !midTransition) {
      // Never seated, SO FAR AS THE ANIMATION KNOWS — which is not the same as
      // "nothing to undo". `dragonHover` clears sleepState on any flight
      // ordered over a sleeper and leaves the curled painting on the host, and
      // this early return used to walk straight past it: the rig stood up, the
      // hit target stayed a 160-unit ball, and the dragon was awake and
      // untappable until something else happened to re-dress it. The art has
      // its own record now, and it is the one asked here.
      this.restoreStandingArt(ld);
      return;
    }
    // It is not a working generator until it is back on its feet — the tap
    // that woke it does not also harvest, and neither does one thrown at the
    // uncurl (see onItemTapped).
    ld.waking = true;
    this.clearDragonOverlay(ld); // a mood flip mid-transition never strands the clip
    // A clip-only breed with no curled painting slept as its own dimmed idle;
    // waking has to give that alpha back, or it stays a ghost for the rest of
    // the session. Harmless on every other path — the overlay is opaque there.
    ld.clipOverlay?.setAlpha(1);
    this.restoreStandingArt(ld);
    ld.shadow.setVisible(true);
    // The TOSLEEP clip played in REVERSE is the definitive wake when pushed —
    // the whelp uncurls, then the rig stands. Without it, the rig returns at
    // once and stretches, exactly as before.
    const t = seated ? this.dragonClip(ld, 'tosleep') : null;
    if (t) {
      ld.mode = 'idle';
      ld.remainMs = DRAGON_WAKE_MS;
      this.playDragonTransition(ld, t, true, () => {
        ld.player?.container.setAlpha(1);
        this.dragonIdle(ld); // the atlas idle when pushed, the rig otherwise
        ld.waking = false;
      });
      return;
    }
    if (ld.player) {
      ld.player.container.setVisible(true).setAlpha(1);
      ld.player.play('stretch');
    } else {
      // No rig to stand up: a clip-only breed wakes straight into its idle,
      // which is the pose the reversed tosleep would have handed it anyway.
      this.dragonIdle(ld);
    }
    ld.mode = 'idle';
    ld.remainMs = DRAGON_WAKE_MS;
    // No wake CLIP to end on, so the stretch's own span is the wake.
    this.time.delayedCall(DRAGON_WAKE_MS, () => {
      if (this.liveDragons.get(ld.host.itemId) === ld) ld.waking = false;
    });
  }

  /**
   * A dragon walked itself to another tile — fly it there.
   *
   * The move already happened in state (DragonLifeSystem owns that); this is
   * only the journey. It arcs, because nothing on this board teleports, and the
   * host is marked `busy` for the duration so the idle roll cannot fight the
   * tween for the same properties.
   */
  private flyWander(itemId: number, to: TilePos): void {
    const sprite = this.itemSprites.get(itemId);
    if (!sprite) return;
    sprite.col = to.col;
    sprite.row = to.row;
    const dest = gridToWorld(to.col, to.row);
    const ld = this.liveDragons.get(itemId);
    if (ld) {
      ld.busy = true;
      this.setDragonFacing(ld, dest.x <= sprite.x ? 'left' : 'right');
      this.dragonHover(ld, DRAGON_WANDER_FLIGHT_MS);
    }
    // Two tweens rather than a curve: x eases the whole way while y hops up and
    // back down, which reads as a glide with a lift in the middle of it. Depth
    // follows the flight off this full-length tween (itemBase + y every frame),
    // so the flier sorts with the scenery it passes instead of over it.
    this.tweens.add({
      targets: sprite,
      x: dest.x,
      duration: DRAGON_WANDER_FLIGHT_MS,
      ease: 'Sine.easeInOut',
      onUpdate: () => sprite.settleDepth()
    });
    this.tweens.add({
      targets: sprite,
      y: dest.y - DRAGON_WANDER_ARC,
      duration: DRAGON_WANDER_FLIGHT_MS / 2,
      ease: 'Sine.easeOut',
      yoyo: false,
      onComplete: () => {
        this.tweens.add({
          targets: sprite,
          y: dest.y,
          duration: DRAGON_WANDER_FLIGHT_MS / 2,
          ease: 'Sine.easeIn',
          onComplete: () => {
            sprite.settleDepth();
            if (!ld) return;
            ld.busy = false;
            ld.mode = 'idle';
            ld.remainMs = this.idleSpanMs(ld.calm);
            this.dragonLand(ld); // no-op if the led landing is already folding
          }
        });
      }
    });
  }

  /* ------------------------------ camera ------------------------------ */

  /**
   * The board is far larger than the screen, so the camera frames one Keeper
   * level at a time. On reaching a new level it glides — the world-builder's
   * extra-smooth smootherstep + gentle mid-dolly — to that zone's authored
   * focal point, the same move previewed in the camera-keyframe tool.
   */
  private setupCamera(): void {
    const map = this.ctx.state.map;
    const focusByLevel = new Map<number, { col: number; row: number }>();
    for (const kf of map.cameraKeyframes ?? []) {
      if (kf.focus) focusByLevel.set(kf.level, kf.focus);
    }
    // Tiles that belong to each level's view. The key-gated tutorial gate sits
    // right at the start clearing, so it frames with L1 (not its level-2 tag).
    const tilesByLevel = new Map<number, [number, number][]>();
    for (const region of map.regions) {
      const lvl = region.id === 'level_1' ? 1 : region.unlock?.keys ? 1 : region.unlock?.level ?? 1;
      const list = tilesByLevel.get(lvl) ?? [];
      list.push(...region.tiles);
      tilesByLevel.set(lvl, list);
    }
    for (const [lvl, tiles] of tilesByLevel) {
      this.levelFrames.set(lvl, this.computeFrame(tiles, focusByLevel.get(lvl)));
    }

    const cam = this.cameras.main;
    // Camera frontier — the authored BACKGROUND IMAGE is the world's border: the
    // camera roams ONLY inside it (pan + zoom), so no void is ever visible. Bound
    // to the image's exact world rect, and raise the minimum zoom to the image-fit
    // so the viewport can never grow past it (zoom-out stops at the full image).
    const bgRect = this.backgroundWorldRect();
    const zoomCfg = this.ctx.state.map.cameraZoom ?? { min: 0.2, max: 1.4 };
    if (bgRect) {
      cam.setBounds(bgRect.x, bgRect.y, bgRect.w, bgRect.h);
      const fitZoom = Math.max(LIVE_GAME_WIDTH / bgRect.w, LIVE_GAME_HEIGHT / bgRect.h);
      this.minZoom = Math.max(zoomCfg.min, fitZoom);
    } else {
      // Fallback (no backdrop): hold to the playable extent, the old behaviour.
      this.minZoom = zoomCfg.min;
      const cells = map.playable ?? [];
      if (cells.length) {
        let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
        for (const [c, r] of cells) { minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r); }
        const pts = [[minC, minR], [maxC, minR], [minC, maxR], [maxC, maxR]].map(([c, r]) => gridToWorld(c, r));
        const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
        const x0 = Math.min(...xs) - TILE_W, y0 = Math.min(...ys) - TILE_H * 2;
        cam.setBounds(x0, y0, Math.max(...xs) - Math.min(...xs) + TILE_W * 2, Math.max(...ys) - Math.min(...ys) + TILE_H * 3);
      }
    }
    const frame = this.openingFrame();
    // World framing stays logical (R cancels in world space); only the actual zoom
    // is ×renderScale so the same view renders into the larger hi-DPI backing.
    cam.setZoom(Math.max(frame.zoom, this.minZoom) * renderScale.value);
    cam.centerOn(frame.x, frame.y);

    this.offBus.push(
      // Every level-up is now an ordinary glide to the new zone. Level 3 used to
      // hijack this into the finale; the awakening is a QUEST beat now, below.
      this.ctx.bus.on('keeper:leveled', ({ level }) => {
        this.flyToLevel(level);
        // A rank can be what opens a world — the door to it wakes with it.
        this.syncPortalFx(true);
      }),
      this.ctx.bus.on('tour:point', ({ target }) => this.onTourPoint(target)),
      // Eleanor's Emporium visit ends → the gate lesson begins. Hung off the
      // tour rather than off arrival so the two never share the screen: she is
      // mid-sentence about her shelves for the whole of it.
      this.ctx.bus.on('tour:completed', ({ id }) => {
        if (id === 'roothold') this.offerGateLesson();
      }),
      // Learnt. The stat is written HERE and only here, so a lesson the player
      // ignored is still waiting next session, and one they followed is done.
      this.ctx.bus.on('dragon:crossed', () => this.clearGateLesson(true)),
      this.ctx.bus.on('tour:unpoint', () => this.clearTourArrow()),
      this.ctx.bus.on('quest:completed', ({ questId }) => {
        if (questId === GOLDEN_ALTAR.awakenQuestId) this.beat('trigger', () => this.runFinale());
      })
    );
  }

  /* ------------------------- the Level-3 finale ------------------------- */

  /**
   * ONE BEAT OF THE FINALE, FENCED.
   *
   * Every beat of the awakening is a `delayedCall`, a tween callback or an
   * input handler, and Phaser runs all three INSIDE the frame step but OUTSIDE
   * `update` — so the single `guard` on `stepBoard` never covered any of them.
   * That is the difference between the ceremony failing and the SESSION
   * failing: the next frame is requested only after the step returns
   * (`core/crash.ts`), so a throw here does not lose the Elder, it stops the
   * game dead with the board still on screen, and only a reload brings it back.
   *
   * The chapter's one irreversible story beat is the last place in the game
   * that should be able to do that. Each step now carries on degraded instead —
   * a missing flourish beats a locked save — and the failure is named in
   * `window.__emberkeep.errors()` rather than being a freeze with no message.
   */
  private beat(where: string, fn: () => void): void {
    guard(`board.finale.${where}`, fn, undefined);
  }

  /**
   * The grand surprise, made real: the camera glides west to the Golden Altar,
   * the Golden Egg cracks, the Elder awakens, and the camera comes home.
   * UIScene runs her first line on the same FINALE timeline, so the two scenes
   * stay in step.
   *
   * The demo's teaser tail — a fly to the south terrace and Chapter-Two
   * silhouettes fading in under half-parted clouds — is gone. The finale ends on
   * the Elder and gives the board straight back.
   */
  private runFinale(): void {
    if (this.finaleRan) return;
    this.finaleRan = true;
    this.finaleStartedMs = this.time.now;
    this.stopGoldenTremble();

    // 1 — the camera glides WEST to the Golden Altar, where the whole golden
    // lore lives (authored spot, golden-egg.json)…
    this.time.delayedCall(FINALE.hatchAtMs, () =>
      this.beat('glide', () => {
        if (!this.altarEgg) return;
        const p = this.altarPoint();
        this.glideToWorld(p.x, p.y + 60, 1150);
      })
    );
    // …and the Golden Egg cracks: the legendary Elder AWAKENS on her ledge.
    // ONLY if Eleanor's golden order was delivered — the egg is authored decor
    // now, so its mere existence no longer implies the promise was earned; the
    // prophecy finale variant leaves her sleeping (deliver later → the late
    // awakening plays instead).
    this.time.delayedCall(FINALE.awakenAtMs, () =>
      this.beat('awaken', () => {
        if (this.ctx.state.completedOrderIds.includes(GOLDEN_ALTAR.orderId)) {
          this.awakenAltarElder();
        } else if (this.altarEgg) {
          // Prophecy variant: she stirs but does NOT wake — the un-filled order
          // stays the hook.
          const p = this.altarPoint();
          this.wobbleGoldenEgg();
          this.glowFlash(p.x, p.y + 40, PALETTE.goldAccent, 0.7, 1.4);
        }
      })
    );

    // 3 — home again: the board is handed straight back to the player. Fenced
    // like the rest, and the reason it matters most here: this is the beat that
    // gives the player their camera back, so losing it strands them at the
    // altar for the rest of the session.
    this.time.delayedCall(FINALE.returnAtMs, () =>
      this.beat('return', () => {
        const frame = this.frameForLevel(this.ctx.state.level);
        this.glideToWorld(frame.x, frame.y, 1400);
      })
    );
  }

  /** Ambient anticipation: the altar egg trembles once the Keeper is close
   *  to Level 3 (XP progress ≥ threshold) — "look at the egg!". */
  private updateGoldenTremble(): void {
    const egg = this.altarEgg;
    const [gained, span] = this.ctx.state.levelProgress;
    const near =
      egg !== undefined &&
      this.ctx.state.level === 2 &&
      gained / span >= GOLDEN_TREMBLE_PROGRESS;
    if (near && !this.goldenTremble && egg) {
      this.goldenTremble = this.tweens.add({
        targets: egg,
        angle: { from: -2.4, to: 2.4 },
        duration: 90,
        yoyo: true,
        repeat: -1,
        repeatDelay: 1400,
        ease: 'Sine.easeInOut'
      });
    } else if (!near) {
      this.stopGoldenTremble();
    }
  }

  private stopGoldenTremble(): void {
    if (!this.goldenTremble) return;
    const target = this.goldenTremble.targets?.[0] as Phaser.GameObjects.Image | undefined;
    this.goldenTremble.stop();
    this.goldenTremble = undefined;
    target?.setAngle(0);
  }

  /* --------------------------- the Golden Altar --------------------------- */

  /** World point + art scale of the altar (authored decor placement from
   *  golden-egg.json — cell, calibration and ratio math mirror buildMapDecor). */
  private altarPoint(): { x: number; y: number; scale: number } {
    const ratio = TILE_W / (this.ctx.state.map.tile?.width ?? TILE_W);
    const cal = GOLDEN_ALTAR.calibration;
    const w = gridToWorld(GOLDEN_ALTAR.cell.col, GOLDEN_ALTAR.cell.row);
    return { x: w.x + cal.offsetX * ratio, y: w.y + cal.offsetY * ratio, scale: cal.scale * ratio };
  }

  /** Derive the altar's state from save-derivable facts (nothing extra is
   *  persisted): the Golden Egg is AUTHORED DECOR (golden-egg.json) — it sits
   *  on the old altar from the very start; once Eleanor's first order is
   *  delivered AND Level 3 is reached, the awakened Elder stands there
   *  instead. Idempotent — safe on load, resync and rig-arrival. */
  /** Has the awakening quest been completed? QuestSystem latches it into
   *  `stats` as `q:done:<questId>`, so this is save-derivable and survives a
   *  reload — which is what the altar needs, since she must still be standing
   *  there next session. */
  private goldenQuestDone(): boolean {
    return this.ctx.state.stat(`q:done:${GOLDEN_ALTAR.awakenQuestId}`) > 0;
  }

  private syncGoldenAltar(): void {
    // Emberkeep's own story fixture, standing at an Emberkeep cell. Its address
    // is off-grid on purpose, so on another world it would be drawn by that
    // world's fallback lattice — an Emberkeep altar floating over the aurora.
    if (this.ctx.state.worldId !== WORLD_ID) return;
    const delivered = this.ctx.state.completedOrderIds.includes(GOLDEN_ALTAR.orderId);
    const awake = delivered && this.goldenQuestDone();
    if (awake) this.showAltarElder();
    else {
      this.showAltarEgg(false);
      if (this.goldenTeaseSeen()) this.startEggAura();
    }
  }

  /** True once the tutorial's golden-egg tease has played (save-derivable:
   *  the tutorial index moved past the tease step, or the tutorial is done). */
  private goldenTeaseSeen(): boolean {
    if (this.ctx.state.tutorialDone) return true;
    const idx = this.ctx.data.tutorial.steps.findIndex((s) => s.id === 'golden_tease');
    return idx >= 0 && this.ctx.state.tutorialIndex > idx;
  }

  /** Post-tease presence: a soft pulsing golden aura behind the egg + a gentle
   *  float — "something in there is awake". Idempotent; cleared with the egg. */
  private startEggAura(): void {
    const egg = this.altarEgg;
    if (!egg || this.eggAura) return;
    const p = this.altarPoint();
    const cy = p.y + (1451 * p.scale) / 2; // egg art is 1176×1451, anchored top
    this.eggAura = this.add
      .image(p.x, cy, 'fx_glow')
      .setTint(num(PALETTE.goldAccent))
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTHS.itemBase + p.y - 0.5)
      // Follows the egg's own +20%: `fx_glow` is a fixed 512px texture, so a
      // halo left at 0.5 reads 17% tighter around the bigger egg — a ring that
      // hugs it instead of a light it is sitting in.
      .setScale(0.6)
      .setAlpha(0.18);
    this.tweens.add({
      targets: this.eggAura,
      alpha: 0.34,
      scale: 0.744,
      duration: 1700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
    this.tweens.add({
      targets: egg,
      y: p.y - 7,
      duration: 2300,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
  }

  /** Ensure the authored Golden Egg decor stands on the altar. With `ceremony`
   *  (Order 1 just delivered) the camera glides west and the egg FLARES — the
   *  old altar answering the rekindled brazier. */
  private showAltarEgg(ceremony: boolean): void {
    if (!this.altarEgg && !this.altarElder && !this.altarElderClip && !this.altarElderFallback) {
      const p0 = this.altarPoint();
      const cal = GOLDEN_ALTAR.calibration;
      // Through `plateScale`, like every other draw of a board plate: this
      // scale is CALIBRATED against the art as it was drawn, and the plate is
      // stored smaller than that. Without it the altar egg shrank by the
      // downscale factor — the one draw in this file that reads a plate at a
      // hand-tuned scale instead of ITEM_SCALE, and so the one the compensation
      // was missing.
      this.altarEgg = this.add
        .image(p0.x, p0.y, `item_${GOLDEN_CHAIN}_1`)
        .setOrigin(cal.anchor.x, cal.anchor.y)
        .setScale(plateScale(`item_${GOLDEN_CHAIN}_1`, p0.scale))
        .setDepth(DEPTHS.itemBase + p0.y);
      // Soft radial ground shadow at the egg's base — the egg is anchored at its
      // TOP (cal.anchor.y ≈ 0), so its foot sits one display-height below p0.y.
      const eggBottom = p0.y + this.altarEgg.displayHeight * (1 - cal.anchor.y);
      this.altarEggShadow = this.addGroundShadow(
        p0.x,
        eggBottom,
        this.altarEgg.displayWidth * 0.6,
        DEPTHS.itemBase + p0.y - 0.5
      );
      this.ensureAltarZone();
    }
    if (!ceremony || !this.altarEgg) return;
    const p = this.altarPoint();
    const home = { x: this.cameras.main.midPoint.x, y: this.cameras.main.midPoint.y };
    // The glide and the beat that waits on it are ONE number apart — the flare
    // fires 250ms after the camera settles, and it must stay 250 after it.
    this.glideToWorld(p.x, p.y + 60, 1150);
    this.time.delayedCall(1400, () =>
      this.beat('ceremony.flare', () => {
        this.glowFlash(p.x, p.y + 40, PALETTE.goldAccent, 0.85, 1.6);
        this.sparks.explode(22, p.x, p.y + 40);
        this.floatText(p.x, p.y - 40, '???', PALETTE.goldAccent);
      })
    );
    this.time.delayedCall(3000, () =>
      this.beat('ceremony.return', () => this.glideToWorld(home.x, home.y, 1150))
    );
  }

  /** The Elder stands on the altar — live rig when available, gold-tinted
   *  stand-in otherwise (upgraded automatically when the rig arrives). */
  private showAltarElder(): void {
    if (this.altarElderClip) return; // her own clips are the best she gets
    const p = this.altarPoint();
    const eggBottom = p.y + 1451 * p.scale; // egg art is 1176×1451, anchored top
    this.altarEgg?.destroy();
    this.altarEgg = undefined;
    this.altarEggShadow?.destroy();
    this.altarEggShadow = undefined;
    this.eggAura?.destroy();
    this.eggAura = undefined;
    this.stopGoldenTremble();
    // HER SHEETS ARE FETCHED HERE AND NOWHERE ELSE. She costs 74 MB of video
    // memory and appears once, at the very end of the chapter — on a board
    // that may never reach it. `fetchElderClips` calls back into this method
    // when they land, so a rig standing in for the seconds between is upgraded
    // rather than kept.
    this.fetchElderClips();
    const idle = this.elderClip('idle');
    if (idle) {
      this.altarElder?.destroy();
      this.altarElder = undefined;
      this.altarElderFallback?.destroy();
      this.altarElderFallback = undefined;
      const sprite = this.add
        .sprite(p.x, eggBottom - DRAGON_ANIM.groundLift, idle.key)
        .setDepth(DEPTHS.itemBase + p.y + 1);
      // Aligned in character-anims against HER altar scale (GOLDEN_ALTAR
      // .elderScale, not the board formula), so clip.scale lands her exactly
      // where the rig stood — the upgrade must not move her.
      attachSpriteInk(this, sprite, {
        units: keylineUnits(Math.max(idle.clip.frameWidth, idle.clip.frameHeight) * idle.clip.scale, DRAGON_OUTLINE)
      });
      this.altarElderClip = sprite;
      this.playElder('idle');
      if (!this.altarElderRoll.remainMs) this.altarElderRoll = { mode: 'idle', remainMs: this.idleSpanMs(true) };
      this.ensureElderShadow(p.x, eggBottom, DEPTHS.itemBase + p.y);
      this.ensureAltarZone();
      return;
    }
    if (this.altarElder) return; // rig already standing — wait for the clips
    const rig = this.dragonRigs.get(GOLDEN_CHAIN);
    if (rig) {
      this.altarElderFallback?.destroy();
      this.altarElderFallback = undefined;
      const player = new RigPlayer(this, rig, (layer) => `rig:${rig.character}:${layer}`, {
        scale: GOLDEN_ALTAR.elderScale,
        speed: DRAGON_ANIM.adultSpeed // the Elder breathes slowly — a calm adult
      });
      const face = FACES[rig.character];
      if (face) player.attachFace(this, face, faceTextureKey(rig.character));
      player.setFacing('right').play('idle'); // she watches over the isle, to the east
      player.container.setPosition(p.x, eggBottom - DRAGON_ANIM.groundLift);
      player.container.setDepth(DEPTHS.itemBase + p.y + 1);
      this.altarElder = player;
      this.altarElderRoll = { mode: 'idle', remainMs: this.idleSpanMs(true) };
    } else if (!this.altarElderFallback) {
      /**
       * A PLACEHOLDER, and deliberately an invisible one.
       *
       * The Elder's rig loads asynchronously, so for the few seconds before it
       * arrives this stood in for her — wearing `item_golden_egg_2`, which
       * assets.json maps to `red-dragon-baked.webp`. That is another creature
       * entirely: the chapter's one irreversible story beat opened with a RED
       * dragon on the golden altar, which then turned gold when the real rig
       * landed. Better to show nothing for those seconds than the wrong dragon.
       *
       * The object itself stays, because three other places read it — the
       * commune tap, its bob, and `showAltarEgg`'s "is anyone already here?"
       * guard — and they are all still right about her being here. Only the
       * painting is withheld. (The tap target is `ensureAltarZone`, its own
       * object, so hiding this costs no interaction.)
       *
       * The data gap behind it stands: `item_golden_egg_2` points at the red
       * dragon, and this build ships no full-body Golden Elder art to point it
       * at — only her bust (`sprites/golden-elder/rest.webp`) and her rig.
       */
      this.altarElderFallback = this.add
        .image(p.x, eggBottom, `item_${GOLDEN_CHAIN}_${GOLDEN_ELDER_TIER}`)
        .setOrigin(0.5, 0.88)
        // A no-op today (this plate shares its file with two other keys, so the
        // downscale skips it) and correct the day it stops sharing.
        .setScale(plateScale(`item_${GOLDEN_CHAIN}_${GOLDEN_ELDER_TIER}`, 0.21))
        .setTint(GOLDEN_TINT)
        .setVisible(false)
        .setDepth(DEPTHS.itemBase + p.y + 1);
    }
    this.ensureElderShadow(p.x, eggBottom, DEPTHS.itemBase + p.y);
    this.ensureAltarZone();
  }

  /** One shadow under the Elder, however many times she is (re)mounted — the
   *  rig→clip upgrade runs this method twice and a second copy would darken
   *  the flagstones under her for the rest of the session. */
  private ensureElderShadow(x: number, y: number, depth: number): void {
    if (this.altarElderShadow) return;
    this.altarElderShadow = this.addGroundShadow(x, y, 170, depth);
  }

  /**
   * Fetch the Elder's clip sheets, once, and re-mount her when they land.
   *
   * She is the only clip character the board reaches that is NOT a board
   * dragon — she stands on the altar fixture — so `ensureDragonClips` never
   * hears about her and this is her one door. Same two-wave rule as every
   * breed: the idle she rests on and the fly for her low passes now, the roar
   * with the beat that needs it (her awakening).
   */
  private fetchElderClips(): void {
    const art = dragonClipCharacter(GOLDEN_CHAIN, GOLDEN_ELDER_TIER, null);
    if (!art) return;
    const before = this.dragonClipsAsked.size;
    this.fetchClips(art, clipLoadTiers(art, { lean: DRAGON_CLIPS.lean }).eager);
    if (this.dragonClipsAsked.size === before) return; // nothing new was asked for
    // Behind the fetch above rather than beside it: an empty batch completes at
    // once, so this always runs after her sheets have had their turn.
    this.loads.run(
      () => {},
      () => {
        // Fenced: this fires from the LOADER, later than the ceremony and with
        // nobody left to catch it — the upgrade from rig to clips is exactly
        // the kind of late beat whose failure used to freeze a board the player
        // had already been handed back.
        if (this.scene.isActive()) this.beat('clips', () => this.showAltarElder());
      }
    );
  }

  /**
   * The Elder's clip set (`golden_egg:2` → golden_adult) with the named clip's
   * Phaser anim — and, for a phased clip, its segment anims — registered. Null
   * when the clips are not pushed or the sheet is not resident, which is what
   * sends `showAltarElder` down the rig path.
   */
  private elderClip(clipId: string): { clip: CharacterClip; key: string } | null {
    const art = dragonClipCharacter(GOLDEN_CHAIN, GOLDEN_ELDER_TIER, null);
    if (!art) return null;
    const clip = clipFor(art, clipId);
    const key = clipKey(art, clipId);
    if (!clip || !this.textures.exists(key)) return null;
    this.touchClip(art, clipId);
    this.ensureAnimForLiveTexture(key, key, () => ({
      key,
      frames: this.anims.generateFrameNumbers(key, { start: 0, end: clip.frames - 1 }),
      frameRate: clip.fps,
      repeat: clip.loop ? -1 : 0
    }));
    for (const [seg, range] of Object.entries(clip.segments ?? {})) {
      const sk = this.segKey(key, seg);
      this.ensureAnimForLiveTexture(sk, key, () => ({
        key: sk,
        frames: this.anims.generateFrameNumbers(key, { start: range[0], end: range[1] - 1 }),
        frameRate: clip.fps,
        repeat: seg === 'loop' ? -1 : 0
      }));
    }
    return { clip, key };
  }

  /** Bind a clip to the Elder's sprite and dress it NOW — the same discipline
   *  as `dressOverlay`: a clip switch never renders one frame wearing the
   *  previous clip's transform. She faces right, watching over the isle. */
  private dressElder(sprite: Phaser.GameObjects.Sprite, c: { clip: CharacterClip; key: string }): void {
    const origin = originFor(c.clip, true);
    sprite.setData('clip', c.clip).setFlipX(true).setOrigin(origin.x, origin.y).setScale(c.clip.scale);
  }

  /**
   * Drive the Elder's clips — her whole vocabulary at the altar. `idle` folds
   * an airborne Elder through her landing segment first (never a touchdown mid
   * cruise); `hover` ramps takeoff → cruise loop; `announce` is the awakening,
   * the roar once with jaws wide, then straight into the hover the finale's
   * roll keeps her in.
   */
  private playElder(action: 'idle' | 'hover' | 'announce'): void {
    const sprite = this.altarElderClip;
    if (!sprite) return;
    sprite.off(Phaser.Animations.Events.ANIMATION_COMPLETE);
    const fly = this.elderClip('fly');
    if (action === 'announce') {
      const roar = this.elderClip('roar');
      if (roar) {
        this.altarElderPhase = 'ground';
        this.dressElder(sprite, roar);
        sprite.play(roar.key);
        sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.playElder('hover'));
        return;
      }
      action = 'hover';
    }
    if (action === 'hover') {
      if (this.altarElderPhase === 'takeoff' || this.altarElderPhase === 'loop') return;
      if (fly?.clip.segments) {
        this.altarElderPhase = 'takeoff';
        this.dressElder(sprite, fly);
        sprite.play(this.segKey(fly.key, 'takeoff'));
        sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
          if (this.altarElderPhase !== 'takeoff') return;
          this.altarElderPhase = 'loop';
          sprite.play(this.segKey(fly.key, 'loop'));
        });
        return;
      }
      action = 'idle'; // no phased fly pushed: the idle IS the celebrate
    }
    if (fly?.clip.segments && (this.altarElderPhase === 'takeoff' || this.altarElderPhase === 'loop')) {
      this.altarElderPhase = 'landing';
      this.dressElder(sprite, fly);
      sprite.play(this.segKey(fly.key, 'landing'));
      sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        if (this.altarElderPhase === 'landing') this.playElder('idle');
      });
      return;
    }
    this.altarElderPhase = 'ground';
    const idle = this.elderClip('idle');
    if (idle) {
      this.dressElder(sprite, idle);
      sprite.play(idle.key, true);
    }
  }

  /** The finale's awakening beat AT the altar: the egg shakes, cracks in a
   *  flood of gold, and the legendary Elder rises where it stood. */
  private awakenAltarElder(): void {
    const egg = this.altarEgg;
    if (!egg) return;
    const p = this.altarPoint();
    this.stopGoldenTremble();
    this.tweens.add({
      targets: egg,
      x: egg.x + 3,
      angle: 5,
      // The half-swing and the divisor are ONE number — 150 IS 2 x 75. At the
      // old 60 the wobble ran at 8.3 Hz, which reads as a buzz rather than as
      // something struggling to get out. Move one and you must move the other.
      duration: 75,
      yoyo: true,
      repeat: Math.floor(TIMINGS.hatchShake / 150),
      ease: 'Sine.easeInOut',
      // TWO fences, not one: the flourish and the animal fail independently.
      // A burst that throws must still leave the Elder standing, and an Elder
      // who cannot be mounted must still let the egg visibly crack — the egg is
      // destroyed either way, so a single fence around both could leave the
      // altar empty.
      onComplete: () => {
        this.beat('burst', () => {
          this.glowFlash(p.x, p.y + 40, PALETTE.goldAccent, 1, 2.6);
          this.playBeatFX('elder', p.x, p.y + 40); // the Elder rises out of gold
          this.shells.explode(12, p.x, p.y + 40);
          this.sparks.explode(40, p.x, p.y + 44);
          this.burst.explode(20, p.x, p.y + 48);
        });
        this.beat('elder', () => {
          this.showAltarElder();
          if (this.altarElder || this.altarElderClip) {
            this.altarElder?.play('hover');
            this.altarElder?.playFace(2); // the Elder announces herself — a ROAR
            this.playElder('announce'); // …and the clip Elder actually bellows it
            this.altarElderRoll = { mode: 'hover', remainMs: DRAGON_ANIM.introCelebrateMs };
          }
        });
      }
    });
  }

  /** Order 1 delivered AFTER the finale: the arrival and the awakening play
   *  as one held sequence at the altar — glide west, the egg lands in gold,
   *  cracks, the Elder rises, then home. */
  private lateGoldenAwakening(): void {
    const p = this.altarPoint();
    const home = { x: this.cameras.main.midPoint.x, y: this.cameras.main.midPoint.y };
    this.showAltarEgg(false); // no competing camera script — this one drives
    // The glide and the beat that waits on it are ONE number apart — the flare
    // fires 250ms after the camera settles, and it must stay 250 after it.
    this.glideToWorld(p.x, p.y + 60, 1150);
    this.time.delayedCall(1400, () =>
      this.beat('late.flare', () => {
        this.glowFlash(p.x, p.y + 40, PALETTE.goldAccent, 0.85, 1.6);
        this.sparks.explode(22, p.x, p.y + 40);
        this.floatText(p.x, p.y - 40, '???', PALETTE.goldAccent);
      })
    );
    this.time.delayedCall(2400, () => this.beat('late.awaken', () => this.awakenAltarElder()));
    this.time.delayedCall(6000, () =>
      this.beat('late.return', () => this.glideToWorld(home.x, home.y, 1150))
    );
  }

  /** One tap zone covers the altar for both states (egg wobble / commune). */
  private ensureAltarZone(): void {
    if (this.altarZone) return;
    const p = this.altarPoint();
    this.altarZone = this.add
      .zone(p.x, p.y + 90, 200, 240)
      .setInteractive({ useHandCursor: true });
    this.altarZone.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!this.isTap(pointer)) return;
      // An input handler runs inside the step too, so a tap on the altar could
      // end the session as surely as the ceremony could.
      this.beat('altar.tap', () => {
        if (this.altarElder || this.altarElderClip || this.altarElderFallback) {
          this.communeWithElder();
        } else if (this.altarEgg) this.wobbleGoldenEgg();
      });
    });
  }

  /** World centre + zoom that frames `tiles` around the focal cell. */
  private computeFrame(
    tiles: [number, number][],
    focus?: { col: number; row: number }
  ): CameraFrame {
    const center = focus
      ? gridToWorld(focus.col, focus.row)
      : (() => {
          let sx = 0, sy = 0;
          for (const [c, r] of tiles) {
            const w = gridToWorld(c, r);
            sx += w.x;
            sy += w.y;
          }
          return { x: sx / Math.max(1, tiles.length), y: sy / Math.max(1, tiles.length) };
        })();
    // Use a high percentile of the spread, not the max, so a couple of stray
    // authored cells can't blow the frame out to show the whole board.
    const dxs: number[] = [];
    const dys: number[] = [];
    for (const [c, r] of tiles) {
      const w = gridToWorld(c, r);
      dxs.push(Math.abs(w.x - center.x));
      dys.push(Math.abs(w.y - center.y));
    }
    dxs.sort((a, b) => a - b);
    dys.sort((a, b) => a - b);
    // CLOSER framing: the board sat too far back. Frame the DENSE CORE around the
    // focal cell (lower percentile = ignore the sparse outer cells) and pull in,
    // so the start cluster fills the view. The focal cell stays centred; pan/
    // wheel still reach the rest of the zone.
    const pct = (arr: number[]): number => arr[Math.floor(0.7 * (arr.length - 1))] ?? 0;
    const halfW = Math.max(TILE_W, pct(dxs) + TILE_W / 2);
    const halfH = Math.max(TILE_H, pct(dys) + TILE_H);
    const pad = 110;
    // The ceiling was 2.0 and the dense-core frame kept hitting it, so earlier
    // multiplier tweaks did nothing. Lower ceiling = a real zoom-out: the start
    // area fills the view comfortably without being right on top of it.
    const zoom = Phaser.Math.Clamp(
      Math.min((LIVE_GAME_WIDTH / 2 - pad) / halfW, (LIVE_GAME_HEIGHT / 2 - pad) / halfH) * 1.15,
      0.45,
      1.05
    );
    return { x: center.x, y: center.y, zoom };
  }

  /**
   * The view the board opens on.
   *
   * Framing by Keeper LEVEL is an EMBERKEEP idea: its regions gate on level and
   * its map ships authored `cameraKeyframes` naming a focal cell per level. A
   * world that gates on KEYS has no such ladder — every Borealis region buckets
   * to level 1, so the level frame spanned all three isles and the Keeper
   * arrived looking at locked ice with their own nine feet of shingle off the
   * side of the screen, and Selyna eight pixels past the right edge.
   *
   * So: authored keyframes win, and everywhere else the board opens on THE
   * GROUND YOU CAN STAND ON — the active regions, plus whoever lives here, so
   * the person who speaks the arrival lines is in the frame she speaks them in.
   */
  private openingFrame(): CameraFrame {
    const map = this.ctx.state.map;
    if (map.cameraKeyframes?.length) return this.frameForLevel(this.ctx.state.level);
    const tiles: [number, number][] = [];
    for (const region of map.regions) {
      if (this.ctx.state.regionStatus.get(region.id) !== 'active') continue;
      tiles.push(...region.tiles);
    }
    for (const cfg of this.ctx.systems.characters.charactersIn(this.ctx.state.worldId)) {
      tiles.push([cfg.anchor[0], cfg.anchor[1]]);
    }
    return tiles.length ? this.computeFrame(tiles) : this.frameForLevel(this.ctx.state.level);
  }

  private frameForLevel(level: number): CameraFrame {
    for (let l = level; l >= 1; l--) {
      const f = this.levelFrames.get(l);
      if (f) return f;
    }
    return this.levelFrames.get(1) ?? { x: LIVE_GAME_WIDTH / 2, y: LIVE_GAME_HEIGHT / 2, zoom: 0.5 };
  }

  private flyToLevel(level: number): void {
    // Never yank the camera away mid-onboarding — the tutorial's scripted taps
    // all live in the L1 zone. Zones still unlock; the view just stays put.
    if (!this.tutorialDone) return;
    // The LAST level opens the land the Golden Altar stands beside, so its glide
    // reads as the game presenting the egg — a promise it cannot keep while the
    // awakening quest is unfinished, and the player is left staring at an egg
    // that does nothing. The land still opens; the camera stays where they are
    // working, and the altar gets its move when the quest actually wakes her.
    if (level >= LEVEL_XP.length && !this.goldenQuestDone()) return;
    const target = this.frameForLevel(level);
    // actual (×renderScale) zoom space — cam.zoom below is already scaled.
    const targetZoom = Math.max(target.zoom, this.minZoom) * renderScale.value; // stay inside the image
    const cam = this.cameras.main;
    const from = { x: cam.midPoint.x, y: cam.midPoint.y, zoom: cam.zoom };
    this.flyTween?.stop();
    const proxy = { t: 0 };
    this.flyTween = this.tweens.add({
      targets: proxy,
      t: 1,
      duration: 1500,
      ease: 'Linear',
      onUpdate: () => {
        const s = smootherstep(proxy.t);
        const x = Phaser.Math.Linear(from.x, target.x, s);
        const y = Phaser.Math.Linear(from.y, target.y, s);
        // Gentle mid-flight dolly-out for a premium, cinematic glide — but never
        // below the image-fit zoom, or the dip would flash the void.
        const z = Phaser.Math.Linear(from.zoom, targetZoom, s) * (1 - 0.08 * Math.sin(Math.PI * proxy.t));
        cam.setZoom(Math.max(z, this.minZoom * renderScale.value));
        cam.centerOn(x, y);
      }
    });
  }

  /* ----------------------------- build ------------------------------ */

  private buildSky(): void {
    // The board paints NO backdrop: the canvas is transparent (GameConfig) and
    // the water photo is a CSS background on #game (index.html). The isle floats
    // over it — cheaper than a full-viewport GPU texture and rock-solid.

    // Warm sun haze, upper-left.
    this.add
      .image(LIVE_GAME_WIDTH * 0.3, 130, 'fx_glow')
      .setScale(7, 4.4)
      .setTint(num(PALETTE.goldAccent))
      .setAlpha(0.16)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScrollFactor(0)
      .setDepth(DEPTHS.sky + 1);

    // Occasional twinkles in the sky.
    this.twinkleTimer = this.time.addEvent({
      delay: 1700,
      loop: true,
      callback: () => {
        const star = this.add
          .image(
            Phaser.Math.Between(80, LIVE_GAME_WIDTH - 80),
            Phaser.Math.Between(60, LIVE_GAME_HEIGHT * 0.45),
            'fx_spark'
          )
          .setScale(0.1)
          .setAlpha(0)
          .setScrollFactor(0)
          .setDepth(DEPTHS.sky + 4);
        this.tweens.add({
          targets: star,
          alpha: 0.85,
          scale: Phaser.Math.FloatBetween(0.5, 1),
          angle: 45,
          duration: 420,
          yoyo: true,
          ease: 'Sine.easeInOut',
          onComplete: () => star.destroy()
        });
      }
    });
  }

  /** The art key + placement for a playable cell, from the authored world. */
  private tileArtKey(col: number, row: number): string {
    const name = this.ctx.state.map.tilesByCell?.[`${col},${row}`];
    if (!name) return 'tile_moss';
    // Authored flower tiles ship as `tile_<artName>`; legacy border-grass-N
    // falls back to grass_N, then to plain moss.
    if (this.textures.exists(`tile_${name}`)) return `tile_${name}`;
    const n = Number(name.split('-').pop());
    return Number.isFinite(n) ? `grass_${n}` : 'tile_moss';
  }

  /**
   * The authored isle: every playable cell wears its hand-placed border-grass
   * tile (real art + per-asset calibration), y-sorted so the 3D grass edges
   * overlap correctly. Cells absent from `playable` are void — open sky — which
   * IS the isle silhouette. Fogged zones still get their grass here; it simply
   * sits hidden under the cloud until the zone wakes.
   */
  private buildGround(): void {
    const map = this.ctx.state.map;
    const ratio = TILE_W / (map.tile?.width ?? TILE_W); // authored 240 → game 256
    const invisible = new Set((map.invisible ?? []).map(([c, r]) => `${c},${r}`));
    for (const [col, row] of map.playable ?? []) {
      if (invisible.has(`${col},${row}`)) continue; // playable cell, no art — background shows through
      const { x, y } = gridToWorld(col, row);
      const artName = map.tilesByCell?.[`${col},${row}`];
      const cal = (artName && map.calibration?.[artName]) || {
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        anchor: { x: 0.5, y: 0.26 }
      };
      // Zones do not share a tile size, so ground art is scaled to the tile of
      // the zone it stands on. The authored isle's zone reports 1, which is why
      // every tile on it lands at exactly the scale it always did.
      const zoneScale = artScaleAt(this.ctx.state.world, col, row);
      const tileY = y + cal.offsetY * ratio * zoneScale;
      const tile = this.add
        .image(x + cal.offsetX * ratio * zoneScale, tileY, this.tileArtKey(col, row))
        .setOrigin(cal.anchor.x, cal.anchor.y)
        .setScale(cal.scale * ratio * zoneScale)
        // y-sorted within the floor band, always below items (itemBase=100).
        .setDepth(DEPTHS.tiles + y * 0.001);
      this.tiles.set(`${col},${row}`, tile);
      // Trees authored as floor tiles spring-bounce like decor (15% faster).
      if (artName && ANIMATED_TILE_NAMES.includes(artName)) {
        this.settleSprite(tile, ((col + row) % 8) * 35);
      }
    }
  }

  /**
   * Authored backdrop (`map.backgrounds`, the world-builder's `background` tab):
   * a painted scene that sits BELOW the floor so invisible tiles reveal it. Laid
   * EXACTLY per the world JSON — cell + free-move dx/dy + calibration scale/anchor
   * (only the grid-unit ratio is applied, as for all decor) — and scrolls with the
   * camera as part of the world. Skipped cleanly if the art isn't present.
   */
  /** The authored backdrop images, kept so the Map Editor can hide them while it
   *  previews another map's art (see `applyWorldBackdrop`). */
  private bgImages: Phaser.GameObjects.Image[] = [];
  private worldBackdrop?: Phaser.GameObjects.Image;

  private buildBackground(): void {
    const map = this.ctx.state.map;
    if (!map.backgrounds?.length) return;
    const ratio = TILE_W / (map.tile?.width ?? TILE_W);
    for (const b of map.backgrounds) {
      const key = `background_${b.name}`;
      if (!this.textures.exists(key)) continue;
      const { x, y } = gridToWorld(b.col, b.row);
      const cal = map.backgroundCalibration?.[b.name] ?? {
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        anchor: { x: 0.5, y: 0.5 }
      };
      this.bgImages.push(
        this.add
          .image(x + (cal.offsetX + (b.dx ?? 0)) * ratio, y + (cal.offsetY + (b.dy ?? 0)) * ratio, key)
          .setOrigin(cal.anchor?.x ?? 0.5, cal.anchor?.y ?? 0.5)
          .setScale((cal.scale ?? 1) * ratio)
          .setDepth(DEPTHS.tiles - 1) // below the floor tiles, above the sky FX
      );
    }
  }

  /**
   * World-space rect of the FIRST authored backdrop image — placed exactly as
   * buildBackground draws it (cell + free-move + calibration) — or null if there's
   * no background art. The camera frontier is held to this so the image is the
   * world's border and nothing beyond it is ever shown.
   */
  private backgroundWorldRect(): { x: number; y: number; w: number; h: number } | null {
    const map = this.ctx.state.map;
    const b = map.backgrounds?.[0];
    if (!b) return null;
    const key = `background_${b.name}`;
    if (!this.textures.exists(key)) return null;
    const src = this.textures.get(key).getSourceImage() as HTMLImageElement;
    const ratio = TILE_W / (map.tile?.width ?? TILE_W);
    const cal = map.backgroundCalibration?.[b.name] ?? {
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      anchor: { x: 0.5, y: 0.5 }
    };
    const { x, y } = gridToWorld(b.col, b.row);
    const cx = x + (cal.offsetX + (b.dx ?? 0)) * ratio;
    const cy = y + (cal.offsetY + (b.dy ?? 0)) * ratio;
    const scale = (cal.scale ?? 1) * ratio;
    const w = src.width * scale;
    const h = src.height * scale;
    return { x: cx - w * (cal.anchor?.x ?? 0.5), y: cy - h * (cal.anchor?.y ?? 0.5), w, h };
  }

  /**
   * EDITOR PREVIEW ONLY — show `textureKey` where the authored backdrop sits, or
   * restore the authored one with null.
   *
   * The Map Editor pages through several maps, and each one's grids were drawn on
   * THAT map's art; previewing them over the running world's backdrop is what makes
   * a grid look like it has slipped. This paints the paged map onto the same world
   * rect the authored image occupies, so editor-space coordinates and what you see
   * agree again.
   *
   * It changes nothing the game reads: no state, no cells, no projection — the
   * board is not rebuilt, and closing the editor puts the authored art back.
   */
  applyWorldBackdrop(textureKey: string | null): void {
    // THE FIELD OUTLIVES THE OBJECT. Nothing here destroys the backdrop, but the
    // scene's display list is torn down and rebuilt around it — a world switch,
    // a restart — and this reference is not cleared with it. Phaser drops
    // `scene` on destroy, so that is the cheapest true test for a corpse;
    // calling `setTexture` on one reads `this.scene.sys` and throws, which is
    // precisely what the editor's backdrop preview was doing on every open.
    if (this.worldBackdrop && !this.worldBackdrop.scene) this.worldBackdrop = undefined;
    if (!textureKey || !this.textures.exists(textureKey)) {
      this.worldBackdrop?.setVisible(false);
      for (const img of this.bgImages) img.setVisible(true);
      return;
    }
    const cb = this.cameras.main.getBounds();
    const rect = this.backgroundWorldRect() ?? { x: cb.x, y: cb.y, w: cb.width, h: cb.height };
    const src = this.textures.get(textureKey).getSourceImage() as HTMLImageElement;
    const cover = Math.max(rect.w / Math.max(1, src.width), rect.h / Math.max(1, src.height));
    if (!this.worldBackdrop) this.worldBackdrop = this.add.image(0, 0, textureKey).setDepth(DEPTHS.tiles - 1);
    this.worldBackdrop
      .setTexture(textureKey)
      .setOrigin(0.5)
      .setPosition(rect.x + rect.w / 2, rect.y + rect.h / 2)
      .setDisplaySize(src.width * cover, src.height * cover)
      .setVisible(true);
    for (const img of this.bgImages) img.setVisible(false);
  }

  /**
   * Static authored scenery (world-builder `decor` placements): huts, crystals,
   * landmarks. Painted like tiles — part of the MAP, not save state — so a
   * re-imported world refreshes the scene for everyone. Each uses its per-asset
   * calibration (offset/scale/anchor) and y-sorts in the item band so closer
   * scenery occludes farther; a piece on a fogged cell hides under the cloud
   * until that zone wakes (fog sits at +2 above this band).
   */
  private buildMapDecor(): void {
    const map = this.ctx.state.map;
    if (!map.mapDecor?.length) return;
    const ratio = TILE_W / (map.tile?.width ?? TILE_W);
    map.mapDecor.forEach((d, i) => {
      const key = `decor_${d.name}`;
      if (!this.textures.exists(key)) return; // art not extracted yet — skip cleanly
      const { x, y } = gridToWorld(d.col, d.row);
      const cal = map.decorCalibration?.[d.name] ?? {
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        anchor: { x: 0.5, y: 0 }
      };
      const baseY = y + (cal.offsetY + (d.dy ?? 0)) * ratio; // + free-move offset (Move tool)
      const dispScale = cal.scale * ratio * (DECOR_SCALE[d.name] ?? 1);
      const sprite = this.add
        .sprite(x + (cal.offsetX + (d.dx ?? 0)) * ratio, baseY, key)
        .setOrigin(cal.anchor.x, cal.anchor.y)
        .setScale(dispScale)
        .setDepth(DEPTHS.itemBase + y);
      this.playDecorClip(sprite, d.name, cal, dispScale);
      // Ground shadow under the PROP, not under its cell.
      //
      // A prop is drawn at the cell PLUS its calibration offset PLUS the Move
      // tool's free nudge — `at` in build-zones' DECOR is a point on the
      // backdrop, and the cell is only the index that point happens to fall in.
      // Shadowing the cell meant the darkness sat wherever the tile was while
      // the object stood somewhere else: harmless for the authored isle, whose
      // decor is nudged by a few px, and a full tile off for Runevault's
      // cauldron, placed freely in the editor at dx 407. The anchor IS the
      // ground contact by the calibration's own definition, so the sprite's
      // position is the right place to put it. Depth still keys off the CELL:
      // the shadow must sort with the tile it belongs to, not with its own y.
      this.addGroundShadow(sprite.x, sprite.y, sprite.displayWidth, DEPTHS.itemBase + y - 1);
      // Slow spring-bounce (not a smooth float): lazy spring, staggered, calm.
      this.settleSprite(sprite, (i % 8) * 35); // one-time landing settle
      // The one piece of scenery that IS a screen: Selyna's pot opens the brew
      // panel. Same shape as a world character — map decor with a tap handler.
      if (d.name === CAULDRON_DECOR) {
        // The Runevault tour points here ("The cauldron, on the rune — tap it").
        this.tourTargets.set('runevault_cauldron', { x: sprite.x, y: baseY - sprite.displayHeight * 0.55 });
        // A pot that brews LOOKS like it brews, wherever a world seats one: a
        // breathing glow at the mouth and a few slow motes rising off the brew.
        // Ambient-gated like the snow — the low tier keeps the still pot — and
        // never tracked by hand: this scene restarts on travel, so the world
        // that owns the cauldron owns its steam.
        if (graphics.profile.ambient > 0) {
          const mouthY = baseY + sprite.displayHeight * 0.18;
          const glow = this.add
            .image(sprite.x, mouthY, 'fx_glow')
            .setBlendMode(Phaser.BlendModes.ADD)
            .setTint(0xff9ee0)
            .setAlpha(0.28)
            .setScale((sprite.displayWidth * 0.5) / 512)
            .setDepth(DEPTHS.itemBase + y + 1);
          this.tweens.add({
            targets: glow,
            alpha: { from: 0.18, to: 0.4 },
            scale: glow.scale * 1.18,
            duration: 1600,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
          });
          this.add
            .particles(sprite.x, mouthY, 'fx_glow', {
              x: { min: -sprite.displayWidth * 0.16, max: sprite.displayWidth * 0.16 },
              speedY: { min: -34, max: -14 },
              speedX: { min: -6, max: 6 },
              lifespan: { min: 1800, max: 3200 },
              scale: { start: 0.05, end: 0.012 },
              alpha: { start: 0.5, end: 0 },
              frequency: Math.round(420 / graphics.profile.ambient),
              tint: [0xffb3ec, 0xd48bff, 0xff8fd2],
              blendMode: Phaser.BlendModes.ADD
            })
            .setDepth(DEPTHS.itemBase + y + 2);
        }
        sprite.setInteractive({ useHandCursor: true });
        sprite.on(
          'pointerup',
          (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
            ev.stopPropagation();
            this.tapClaimed = true; // the pot is something; not empty ground
            this.ctx.bus.emit('ui:cauldron_tapped', {});
          }
        );
      }
    });
  }

  /**
   * A decor piece's staged loop — the cauldron's boil. The still texture is the
   * clip's own base frame (the plate ships as both start and end image), so the
   * swap is invisible: the animated sprite occupies exactly the rectangle the
   * still did, and the still remains the fallback whenever the sheet is not
   * resident (same degrade rule as the dragon clips — the art moved before the
   * clips existed, so a missing sheet costs motion, never the pot).
   *
   * Registration is the 'decor' stage convention (characterAnims.ts): clip
   * scale is STILL px per atlas px, dx/dy the frame's top-left in still px.
   * The anchor must land on the same world point either way, so the origin is
   * the anchor's still-px position mapped into the frame.
   */
  private playDecorClip(
    sprite: Phaser.GameObjects.Sprite,
    name: string,
    cal: { anchor: { x: number; y: number } },
    dispScale: number
  ): void {
    // The clips are filed under a CHARACTER id, not the decor's art name.
    const art = decorClipCharacter(name);
    const clip = clipFor(art, 'boil');
    const key = clipKey(art, 'boil');
    if (!clip || !this.textures.exists(key)) return;
    const still = this.textures.get(`decor_${name}`).getSourceImage() as HTMLImageElement;
    // Same rule as the character clips: the cauldron's sheet is evicted when you
    // leave Runevault and re-created when you come back.
    this.ensureAnimForLiveTexture(key, key, () => ({
      key,
      frames: this.anims.generateFrameNumbers(key, { start: 0, end: clip.frames - 1 }),
      frameRate: clip.fps,
      repeat: -1
    }));
    sprite.setTexture(key, 0);
    sprite.setScale(dispScale * clip.scale);
    sprite.setOrigin(
      (cal.anchor.x * still.width - clip.dx) / clip.scale / clip.frameWidth,
      (cal.anchor.y * still.height - clip.dy) / clip.scale / clip.frameHeight
    );
    sprite.play(key);
  }

  /**
   * The people standing IN the world — not on the merge board. Map decor with a
   * tap handler: never in `state.items`, never draggable, never merged. Only the
   * characters authored for THIS world appear, which is how "Selyna is never in
   * Emberkeep" stays true rather than being remembered.
   */
  private buildWorldCharacters(): void {
    for (const cfg of this.ctx.systems.characters.charactersIn(this.ctx.state.worldId)) {
      const art = cfg.art ?? cfg.id;
      const bank = STANDEE_BANKS[art];
      // Prefer the animated banks; fall back to the static `char_<art>` texture,
      // then skip entirely. Art missing must degrade, never block. `art` (not
      // id) keys the wardrobe, so Eleanor-at-home wears Eleanor.
      const animated = bank !== undefined && this.textures.exists(bank.keys.idle);
      // …and a bought LOOK (Emporium `keeper_skin`) overrides the texture — but
      // only the texture. Everything geometric still comes off her bank: the
      // skin still is painted on the bank's own frame, at the bank's feet, so
      // her anchor, her scale, her shadow, her keyline and her hit box are the
      // ones already solved for her. A skin that brought its own geometry would
      // have to re-solve all five.
      const dressed = this.keeperSkinTexture(art);
      const key = dressed ?? (animated ? bank!.keys.idle : `char_${art}`);
      if (!dressed && !animated && !this.textures.exists(key)) continue;
      const [col, row] = cfg.anchor;
      const cell = gridToWorld(col, row);
      // Her authored nudge off the cell centre. Builder pixels, rebased onto the
      // game's grid exactly as map decor's dx/dy is — so the offset holds its
      // position whatever tile width the world was authored at.
      const ratio = TILE_W / (this.ctx.state.map.tile?.width ?? TILE_W);
      const x = cell.x + (cfg.dx ?? 0) * ratio;
      const y = cell.y + (cfg.dy ?? 0) * ratio;
      // Depth from where she is DRAWN, not from her cell: a free offset can carry
      // her a whole tile out, and sorting her against scenery by a point she is
      // no longer standing on is how a standee ends up behind the rock in front
      // of her.
      const sprite = this.add.sprite(x, y, key).setDepth(DEPTHS.itemBase + y);
      // Baked size × the authored trim. Everything downstream (shadow, marker,
      // pulses, breath) reads this one number or the live sprite scale.
      const standeeScale = bank ? bank.scale * (STANDEE_SCALE_TRIM[art] ?? 1) : 1;
      if (bank) {
        // Her FEET are the origin, not the frame's bottom-centre. The baked
        // frame box is the tight union of both banks and the cast's ember bolt
        // reaches far to her left, so bottom-centre is empty air over the wrong
        // cell (scripts/bake-standee.py bakes the anchor alongside the sheets).
        sprite.setOrigin(bank.anchorX, bank.anchorY);
        // She is a person standing next to whelp dragons — the authoring frame
        // reads as a giant on the board, so bring her to roughly their size.
        sprite.setScale(standeeScale);
      } else {
        sprite.setOrigin(0.5, 1);
      }
      if (animated && !dressed) {
        // Register the one-shot cast whether or not an atlas idle takes over —
        // the scepter answer still plays off the bank.
        this.ensureStandeeAnims(art, bank!);
      }
      // An Align-Studio atlas idle (character-anims.json) supersedes the bake's
      // still + breath: it IS an authored idle loop, registered onto the same
      // feet anchor by the pushed transform. Without one, she rests on the
      // bank's frame 0 and her standing life stays the breath in `update`.
      // A DRESSED keeper is a still and nothing else. Her clip set and her bank
      // are drawn in her robes, so playing either would undress her for the
      // length of the animation — which is why the skin gets the breath below
      // and no clip at all until the skinned banks are authored.
      const clipIdle = !dressed && this.applyStandeeRest(art, sprite);
      if (!clipIdle && animated && !dressed) sprite.setFrame(0);
      // Arm/disarm pulses read this instead of assuming 1.
      sprite.setData('baseScale', sprite.scale);
      // Her keyline. Width comes from the BANK's geometry, not the clip's, because
      // her clips are authored at different scales (idle 0.5671, cast 0.61371) and
      // deriving it per clip would change the weight of her outline the moment she
      // raised her scepter. Frames re-dress themselves; see SpriteInk.
      const inkUnits = keylineUnits(
        bank
          ? Math.max(bank.frameWidth, bank.frameHeight) * standeeScale
          : Math.max(sprite.displayWidth, sprite.displayHeight),
        DRAGON_OUTLINE
      );
      attachSpriteInk(this, sprite, { units: inkUnits });
      syncSpriteInk(sprite);
      // The ink twin is drawn BEHIND her and reaches PAST her frame, so what the
      // player SEES of her is her art plus this line. The hit test below has to
      // use that same edge, or a tap on her own outline would fall through her.
      sprite.setData('inkUnits', inkUnits);
      // The ground shadow that plants her: sized to her BODY, never the frame
      // (the frame also spans the cast's ember bolt, which would throw a shadow
      // for a spell she is not casting). Just under her, so the breath lifts off
      // it. Not tied to the sprite — it does not breathe with her.
      this.addGroundShadow(
        x,
        y,
        (bank ? bank.body.width * standeeScale : sprite.displayWidth) * STANDEE_SHADOW_WIDTH,
        DEPTHS.itemBase + y - 1,
        STANDEE_SHADOW_SQUASH,
        STANDEE_SHADOW_DX,
        STANDEE_SHADOW_DY
      );
      // Her hit area is her SILHOUETTE: a rect bound, and her own painted
      // pixels inside it. A standee is ~2 tiles tall, so any box around her
      // reaches over the cells behind her and would swallow taps and drags meant
      // for the board — the same trap the fog puffs have (they get a tile
      // diamond, not their puffy frame). The bound is measured off the baked
      // BODY box, never the frame: the frame also contains the scepter blaze and
      // the ember bolt, and neither is her. Texture space (so `setScale` does not
      // shift it), and origin does not either.
      const b = bank?.body ?? { x: 0, y: 0, width: sprite.width, height: sprite.height };
      // With an atlas idle under her, texture space changed: carry the bank's
      // BODY box through game space into the clip's frame so the hit area still
      // covers her lower body and nothing else.
      const box = this.standeeBodyBox(art, clipIdle, b);
      sprite.setData('bodyBox', box);
      // Rect AND pixels, the same pair board items are hit-tested by: the rect
      // is swapped in place by `reshapeStandees`, the callback outlives every
      // swap. Failing on her transparent pixels is what keeps the pointer list
      // empty over the board she is standing in front of — Phaser's `topOnly`
      // would otherwise hand her every pointer inside the box, and a piece
      // behind her sorts BELOW her, so it would answer neither tap nor drag.
      sprite.setInteractive({
        hitArea: characterHitRect(box, this.standeeWhole()),
        hitAreaCallback: (
          area: Phaser.Geom.Rectangle,
          hx: number,
          hy: number,
          obj: Phaser.GameObjects.Sprite
        ): boolean =>
          Phaser.Geom.Rectangle.Contains(area, hx, hy) &&
          this.standeeOpaqueAt(obj, hx, hy, this.standeeHitRing(obj))
      });
      this.input.setDraggable(sprite, false);
      // Identity is the WARDROBE key: Eleanor-at-home is Eleanor — one Regard
      // gauge, one dialogue bank, one action cooldown, wherever she stands.
      sprite.on('pointerup', () => this.onCharacterTapped(art, sprite));
      this.characterSprites.set(art, sprite);
      this.settleSprite(sprite, 120);
      // The atlas idle already breathes — a squash on top would double it.
      if (!clipIdle) this.startBreathing(art, sprite);
      // …and it blinks: rare full-segment blink one-shots over the idle loop.
      if (clipIdle && clipFor(art, 'blinking')?.stage !== 'portrait' && clipFor(art, 'blinking')) {
        this.scheduleStandeeBlink(art, sprite);
      }
    }
  }

  /**
   * Where a tutorial marker should sit to point at a world character: the world
   * point at the TOP-CENTRE of her BODY box on the live standee.
   *
   * Read off the sprite, never off `characters.json`, and never off a cell
   * authored in `tutorial.json`. Her cell, her dx/dy nudge and the bake's
   * feet-anchor all move independently (the World Builder writes the first two),
   * and a standee is ~2 tiles tall — so her tile centre is at her ankles and a
   * remembered cell is wrong the moment she is moved. Her BODY box, not her
   * frame: the frame also holds the scepter blaze and the ember bolt, and
   * neither is her.
   */
  characterMarkerPoint(characterId: string): { x: number; y: number; bottom: number } | null {
    const sprite = this.characterSprites.get(characterId);
    if (!sprite) return null;
    // The LIVE body box: buildWorldCharacters computes it for whichever texture
    // she is actually wearing (bank frame or Align-Studio atlas frame), so the
    // marker maths below hold in either texture space.
    const body = sprite.getData('bodyBox') as { x: number; y: number; width: number; height: number } | undefined;
    if (!body) {
      return { x: sprite.x, y: sprite.getTopCenter().y, bottom: sprite.getBottomCenter().y };
    }
    // Texture space → world. Her origin is her feet (bake anchor), so offset
    // from it and ride the LIVE scale — the breath, the arm pulse and the
    // cooldown nudge all write it, and the marker should follow what is drawn.
    const originY = sprite.originY * sprite.height;
    return {
      x: sprite.x + (body.x + body.width / 2 - sprite.originX * sprite.width) * sprite.scaleX,
      y: sprite.y + (body.y - originY) * sprite.scaleY,
      // Her feet. The marker layer needs her HEIGHT, not just a point: she is
      // ~2 tiles tall, so an arrow that has to sit below its target belongs
      // under her shoes, not across her chest.
      bottom: sprite.y + (body.y + body.height - originY) * sprite.scaleY
    };
  }

  /**
   * Put a breath under the standee: a slow vertical squash about her origin —
   * which the bake puts at her FEET — so her height moves and her shoes do not.
   * Written in `update` off absolute time rather than tweened, because a scale
   * tween here would fight the arm pulse and the cooldown nudge for the same
   * property (the longer one wins the write). Deriving scaleY from the LIVE
   * scaleX instead means the breath rides on top of those, whatever they do.
   */
  private startBreathing(characterId: string, sprite: Phaser.GameObjects.Sprite): void {
    // Deterministic per-id phase, not random: two standees in one frame must not
    // inhale together, but the same standee must breathe the same on every run.
    let hash = 0;
    for (let i = 0; i < characterId.length; i++) hash = (hash * 31 + characterId.charCodeAt(i)) | 0;
    const phase = ((Math.abs(hash) % 1000) / 1000) * STANDEE_BREATH.phaseSpread;
    this.time.delayedCall(STANDEE_BREATH.startDelayMs, () => {
      if (sprite.active) this.breathing.push({ sprite, phase });
    });
  }

  private standeeAnimKey(characterId: string, bank: 'idle' | 'cast'): string {
    return `standee_${characterId}_${bank}`;
  }

  /**
   * Register (idempotently) a BOARD-stage Align-Studio clip's Phaser animation
   * and hand back its data — null when the clip does not exist, is portrait
   * framing (the bubble's, never the board's), or its sheet is not resident.
   */
  private ensureClipAnim(art: string, clipId: string): CharacterClip | null {
    const clip = clipFor(art, clipId);
    const key = clipKey(art, clipId);
    if (!clip || clip.stage === 'portrait' || !this.textures.exists(key)) return null;
    // Rebuilt if the sheet was evicted and re-fetched — character clips are
    // world art, so travel destroys and re-creates them under the same key.
    this.ensureAnimForLiveTexture(key, key, () => ({
      key,
      frames: this.anims.generateFrameNumbers(key, { start: 0, end: clip.frames - 1 }),
      frameRate: clip.fps,
      repeat: clip.loop ? -1 : 0
    }));
    return clip;
  }

  /** Seat a clip's pushed registration under the sprite: texture, feet-anchored
   *  origin, game-px scale — the exact transform the Align Studio authored. */
  private seatStandeeClip(sprite: Phaser.GameObjects.Sprite, art: string, clipId: string, clip: CharacterClip): void {
    const origin = originFor(clip);
    sprite.setTexture(clipKey(art, clipId), 0);
    sprite.setOrigin(origin.x, origin.y);
    sprite.setScale(clip.scale);
    sprite.setData('baseScale', clip.scale);
  }

  /**
   * Put the character's RESTING look under her: the Align-Studio idle loop.
   * Returns false when she has no atlas idle, leaving the caller the bank's
   * frame-0 still.
   */
  /**
   * The hit box to file on a standee, in whatever texture space she is standing
   * in.
   *
   * A standee is ~2 tiles tall, so the bound has to be her BODY and never her
   * frame — the frame also holds the scepter blaze and the cast's ember bolt,
   * and neither is her. The bank bakes that body box in BANK frame pixels,
   * which is the right answer for the bank still and for a worn look (both are
   * painted on the bank's own frame) and the wrong one under an atlas idle,
   * whose sheet is a different size at a different scale. Hence the carry
   * through game space into the clip's own texture space.
   */
  private standeeBodyBox(art: string, onClipIdle: boolean, body: HitBox): HitBox {
    const bank = STANDEE_BANKS[art];
    const clip = onClipIdle ? clipFor(art, 'idle') : null;
    if (!clip || !bank) return body;
    const scale = bank.scale * (STANDEE_SCALE_TRIM[art] ?? 1);
    return clipTextureRect(clip, {
      x: (body.x - bank.anchorX * bank.frameWidth) * scale,
      y: (body.y - bank.anchorY * bank.frameHeight) * scale,
      width: body.width * scale,
      height: body.height * scale
    });
  }

  private applyStandeeRest(art: string, sprite: Phaser.GameObjects.Sprite): boolean {
    const clip = this.ensureClipAnim(art, 'idle');
    if (!clip) return false;
    this.seatStandeeClip(sprite, art, 'idle', clip);
    sprite.play(clipKey(art, 'idle'));
    return true;
  }

  /** The bank's frame-0 still with bank geometry — the pre-atlas resting look. */
  private restoreBankStill(art: string, sprite: Phaser.GameObjects.Sprite): void {
    const bank = STANDEE_BANKS[art];
    if (!bank || !this.textures.exists(bank.keys.idle)) return;
    const standeeScale = bank.scale * (STANDEE_SCALE_TRIM[art] ?? 1);
    sprite.setOrigin(bank.anchorX, bank.anchorY);
    sprite.setScale(standeeScale);
    sprite.setData('baseScale', standeeScale);
    sprite.setTexture(bank.keys.idle, 0);
  }

  /**
   * The board texture of the LOOK a keeper is wearing, or null for her authored
   * self.
   *
   * `skin_<itemId>` is the wardrobe's own naming, shared with the Manor and the
   * dragons: `card_<id>` is what the shelf shows, `skin_<id>` is what the board
   * wears. Using it means this art inherits both halves of the skin contract
   * for free — held off the boot preload by `isLazyScreenArt`, and pulled back
   * into it by key when a save is actually wearing it.
   *
   * Null when the texture has not landed yet, so a slow connection shows her
   * authored self rather than nothing — the degrade rule the rest of the art
   * follows.
   */
  private keeperSkinTexture(art: string): string | null {
    const worn = this.ctx.state.keeperSkins[art];
    if (!worn) return null;
    const key = `skin_${worn}`;
    return this.textures.exists(key) ? key : null;
  }

  /**
   * Re-dress a keeper where she stands, when a look is bought or swapped.
   *
   * Her plate is LAZY, exactly like the Manor's and the dragons' (`skin_` is
   * held off the boot preload), and `keeperSkinTexture` answers null while it
   * is missing — which is the right fallback everywhere else and precisely the
   * wrong thing here, because the player has just put the look ON. So fetch
   * first and dress after, the same order `reskinChain` uses.
   */
  private applyKeeperSkin(keeper: string): void {
    const worn = this.ctx.state.keeperSkins[keeper];
    const key = worn ? `skin_${worn}` : null;
    if (key && !this.textures.exists(key)) {
      ensureTextures(this, this.ctx, [key], () => this.dressKeeper(keeper));
      return;
    }
    this.dressKeeper(keeper);
  }

  /**
   * Put whichever look she is wearing under her, and the life that goes with it.
   *
   * The two sides are interchangeable by construction — a skin still is painted
   * on the bank's own frame — so this is a texture plus the geometry that
   * belongs to whichever side she lands on: her CLIP idle carries its own scale
   * and origin (`seatStandeeClip`), the skin carries the bank's. The breath is
   * the other half: her clip idle already breathes, and a squash on top of it
   * would double, so it is added when she dresses and dropped when she strips.
   */
  private dressKeeper(keeper: string): void {
    const sprite = this.characterSprites.get(keeper);
    if (!sprite?.active) return; // the fetch is async — she may have left
    const dressed = this.keeperSkinTexture(keeper);
    const bank = STANDEE_BANKS[keeper];
    this.standeeReacting.delete(keeper);
    sprite.off(Phaser.Animations.Events.ANIMATION_COMPLETE);
    sprite.stop();
    this.breathing = this.breathing.filter((b) => b.sprite !== sprite);
    if (dressed) {
      const standeeScale = bank ? bank.scale * (STANDEE_SCALE_TRIM[keeper] ?? 1) : 1;
      sprite.setTexture(dressed);
      if (bank) sprite.setOrigin(bank.anchorX, bank.anchorY);
      sprite.setScale(standeeScale);
      sprite.setData('baseScale', standeeScale);
      // Back into the BANK's texture space: with a clip under her the hit area
      // had been carried into the clip's, and a worn look is not that space.
      if (bank) sprite.setData('bodyBox', this.standeeBodyBox(keeper, false, bank.body));
      this.startBreathing(keeper, sprite);
    } else {
      const onClipIdle = this.applyStandeeRest(keeper, sprite);
      if (!onClipIdle) {
        this.restoreBankStill(keeper, sprite);
        this.startBreathing(keeper, sprite);
      }
      if (bank) sprite.setData('bodyBox', this.standeeBodyBox(keeper, onClipIdle, bank.body));
    }
    syncSpriteInk(sprite);
    this.reshapeStandees();
  }

  /**
   * Play a ONE-SHOT reaction clip (cast / happy / laugh / a blink segment) and
   * settle back onto the rest look. The latest reaction wins — a second event
   * mid-flight replaces the first rather than queueing a stale emotion.
   */
  private playStandeeReaction(art: string, clipId: string): void {
    // Her reaction clips are painted in her robes. While she is wearing a
    // bought look, a cast or a laugh would swap her back into them for the
    // length of the clip and then swap her out again — so a dressed keeper
    // simply does not react. The skins ship as stills on purpose; the animated
    // banks for them are their own piece of work.
    if (this.keeperSkinTexture(art)) return;
    const sprite = this.characterSprites.get(art);
    if (!sprite?.active) return;
    const clip = this.ensureClipAnim(art, clipId);
    if (!clip) return;
    sprite.off(Phaser.Animations.Events.ANIMATION_COMPLETE);
    this.standeeReacting.add(art);
    this.seatStandeeClip(sprite, art, clipId, clip);
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.standeeReacting.delete(art);
      if (!sprite.active) return;
      sprite.stop();
      if (!this.applyStandeeRest(art, sprite)) this.restoreBankStill(art, sprite);
    });
    sprite.play(clipKey(art, clipId));
  }

  /**
   * The atlas idle blinks on its own cadence: the BLINKING clip is a full idle
   * segment (~3 s) with the blink inside it, played as a rare one-shot so rest
   * never reads as a metronome. Scene-clock timer — cosmetic, not gameplay.
   */
  private scheduleStandeeBlink(art: string, sprite: Phaser.GameObjects.Sprite): void {
    const delay = STANDEE_CLIP_BLINK.minMs + Math.random() * (STANDEE_CLIP_BLINK.maxMs - STANDEE_CLIP_BLINK.minMs);
    this.time.delayedCall(delay, () => {
      if (!sprite.active) return;
      if (!this.standeeReacting.has(art)) this.playStandeeReaction(art, 'blinking');
      this.scheduleStandeeBlink(art, sprite);
    });
  }

  /**
   * Register the one-shot CAST. The idle bank is deliberately not registered:
   * standing still is the breath (`update`), and playing a frame loop underneath
   * it made her fidget. Idempotent — the scene instance is reused across restarts
   * and Phaser keeps anims on the global manager.
   */
  private ensureStandeeAnims(characterId: string, bank: (typeof STANDEE_BANKS)[string]): void {
    const key = this.standeeAnimKey(characterId, 'cast');
    const texture = bank.keys.cast;
    if (!this.textures.exists(texture)) return;
    // Her cast BANK is world art as much as her clips are, so it is evicted and
    // re-fetched by travel too — the animation must follow the live sheet.
    this.ensureAnimForLiveTexture(key, texture, () => ({
      key,
      frames: this.anims.generateFrameNumbers(texture, { start: 0, end: bank.frameCount - 1 }),
      frameRate: bank.fps.cast,
      repeat: 0
    }));
  }

  /**
   * She was asked for something and answered — play the scepter cast once, then
   * settle back onto her resting still. She never crosses the board to help: the
   * whole point of the cast bank is that the magic travels and she does not.
   *
   * The cast swaps her texture to its own sheet, so handing back means putting
   * the IDLE texture's frame 0 under her again — not replaying an idle loop.
   */
  private playStandeeCast(characterId: string): void {
    if (this.keeperSkinTexture(characterId)) return; // dressed: see playStandeeReaction
    // The Align-Studio CAST is the definitive answer to `character:action_used`
    // when pushed — the bank one-shot never doubles under it (one event, one
    // animation). The bank path below survives as the no-atlas fallback.
    if (this.characterSprites.get(characterId)?.active && this.ensureClipAnim(characterId, 'cast')) {
      this.playStandeeReaction(characterId, 'cast');
      return;
    }
    const sprite = this.characterSprites.get(characterId);
    const bank = STANDEE_BANKS[characterId];
    if (!sprite || !bank) return;
    // Re-registered rather than merely LOOKED UP. `anims.exists` answers true
    // for an animation whose frames point into a texture travel has since
    // destroyed, and playing that one takes the scene down — the whole reason
    // `ensureAnimForLiveTexture` exists. Asking for it is what makes it live.
    this.ensureStandeeAnims(characterId, bank);
    if (!this.anims.exists(this.standeeAnimKey(characterId, 'cast'))) return;
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (!sprite.active) return;
      sprite.stop();
      // Rest is the Align-Studio idle loop when pushed; the bake's still if not.
      if (this.applyStandeeRest(characterId, sprite)) return;
      if (this.textures.exists(bank.keys.idle)) sprite.setTexture(bank.keys.idle, 0);
    });
    // The cast sheet shares the BANK's frame box, so restore the bank geometry
    // for the one-shot — the resting look may be the atlas idle, whose frame,
    // origin and scale are its own.
    const standeeScale = bank.scale * (STANDEE_SCALE_TRIM[characterId] ?? 1);
    sprite.setOrigin(bank.anchorX, bank.anchorY);
    sprite.setScale(standeeScale);
    sprite.setData('baseScale', standeeScale);
    sprite.play(this.standeeAnimKey(characterId, 'cast'));
  }

  /**
   * Tap her to ARM her help, tap her again to put it away. While armed, the next
   * tap on a board piece is the target. Two taps, no menu — the same shape as
   * every other board interaction.
   */
  private onCharacterTapped(characterId: string, sprite: Phaser.GameObjects.Image): void {
    this.tapClaimed = true; // she is something; this tap was not on empty ground
    // A held piece claims this tap. Checked BEFORE the tutorial's character gate:
    // the player already committed to the gesture in the satchel, so refusing it
    // here with a nudge would be refusing the thing we just told them to do.
    if (this.pendingGive) {
      this.deliverGiveTo({ kind: 'character', id: characterId });
      return;
    }
    // She stands on the map from the first frame, so she is tappable before her
    // lesson exists — until `eleanor_helps` arms her, the tap points back at
    // whatever the current step wants (law 3: never refuse in silence).
    if (!this.tutorialDone && !this.allow.character) {
      this.ctx.bus.emit('tutorial:nudge', {});
      return;
    }
    this.ctx.bus.emit('ui:character_tapped', { characterId });
    if (this.armed?.kind === 'character' && this.armed.id === characterId) {
      this.disarmCharacter();
      // Tapping her a second time puts BOTH away — the favour she was holding
      // and the readout she was showing. One gesture, one visible result.
      this.clearSubject();
      return;
    }
    // Looking at her is enough to read her: the status line follows the tap even
    // when she is on cooldown and the ARM below refuses, because "how does she
    // feel about me" is never the thing being refused.
    this.selectSubject('character', characterId);
    if (!this.ctx.systems.characters.isReady(characterId)) {
      // Not an error the player caused — just a nudge, and the system says why.
      scalePulse(this, sprite, 1.06, 110);
      this.ctx.bus.emit('character:action_failed', { characterId, reason: 'cooldown' });
      return;
    }
    this.armed = { kind: 'character', id: characterId };
    this.ctx.bus.emit('ui:character_armed', { characterId, armed: true });
    sprite.setTint(0xffd84d);
    this.armedTween?.remove();
    // Relative to her OWN scale — a standee is rendered well under 1 and a
    // literal `from: 1` would snap her to full authoring size for the pulse.
    const base = baseScaleOf(sprite);
    this.armedTween = this.tweens.add({
      targets: sprite,
      scale: { from: base, to: base * 1.06 },
      duration: 520,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
  }

  private disarmCharacter(): void {
    const a = this.armed;
    const sprite = a
      ? a.kind === 'companion'
        ? this.companionSprites.get(a.id)
        : this.characterSprites.get(a.id)
      : undefined;
    this.armedTween?.remove();
    this.armedTween = null;
    if (sprite) {
      sprite.clearTint();
      sprite.setScale(baseScaleOf(sprite));
    }
    // Say so, so a two-part tutorial step can put its first arrow back: the
    // player who armed her and changed their mind is back at "tap her".
    if (a?.kind === 'character') {
      this.ctx.bus.emit('ui:character_armed', { characterId: a.id, armed: false });
    }
    this.armed = null;
  }

  /**
   * Point the status readout at somebody, and remember who so the same tap can
   * put them away again.
   *
   * Selection is deliberately NOT the same thing as arming: an armed character
   * is holding a favour ready, which a second tap cancels, while a selection is
   * only where the player is looking. Keeping them apart is what lets a dragon —
   * which is never armed — be selected at all.
   */
  private selectSubject(kind: 'character' | 'dragon', id: string, toggle = true): void {
    if (toggle && this.selected?.kind === kind && this.selected.id === id) {
      this.clearSubject();
      return;
    }
    if (this.selected?.kind === kind && this.selected.id === id) return;
    this.selected = { kind, id };
    this.ctx.bus.emit('ui:subject_selected', { kind, id });
  }

  private clearSubject(): void {
    if (!this.selected) return;
    this.selected = null;
    this.ctx.bus.emit('ui:subject_cleared', {});
  }

  // ------------------------------------------------------- giving from the bag

  /** Hold a pocketed piece out and wait for the player to say who it is for. */
  private armGive(chain: string, tier: number): void {
    this.pendingGive = { chain, tier };
    // The click that pressed GIVE in the bag is still in flight: BoardScene's
    // own POINTER_UP fires for it too, sees "no board object claimed this" and
    // would cancel the give in the same breath it was armed — after which the
    // tap on Eleanor fell through to arming her CAST instead of handing over.
    // Stamp the arm time; the cancel path ignores that first, same-gesture up.
    this.giveArmedAtMs = this.time.now;
    const cam = this.cameras.main;
    this.floatText(cam.midPoint.x, cam.midPoint.y - 260, 'Tap who it is for', PALETTE.goldAccent);
    this.pulseGiveTargets(true);
  }

  private cancelGive(): void {
    if (!this.pendingGive) return;
    this.pendingGive = null;
    this.pulseGiveTargets(false);
    // Say it. The piece goes back to the satchel either way, but a held thing
    // that leaves the hand with no word for it reads as the game ignoring taps.
    const cam = this.cameras.main;
    this.floatText(cam.midPoint.x, cam.midPoint.y - 260, 'Back in your Bag', PALETTE.cream);
    this.ctx.bus.emit('bag:give_cancelled', {});
  }

  /**
   * Breathe every valid recipient while a piece is held out.
   *
   * A two-part gesture with no visible held state is the classic way to lose a
   * player between the two halves — the float text says what to do once, and
   * this says WHERE for as long as it is true. Everyone who can be handed
   * something pulses; nothing else on the board does.
   */
  /**
   * Is a standee something the player may TAP right now? Then her whole body
   * listens. When a tap on her means something (her action, a give, every
   * post-tutorial moment) the bubble's arrow points at her head, and a head
   * that does not answer reads as a broken button. The body box already
   * excludes the scepter blaze and the bolt, so "whole" is still her and
   * nothing else — and `standeeOpaqueAt` keeps it to the pixels she paints, so
   * widening the bound never costs the board a cell.
   */
  private standeeWhole(): boolean {
    return this.tutorialDone || this.allow.character;
  }

  /**
   * Does a hit-area point land on a standee's OWN painted pixels?
   *
   * The rule board items already live under (`BoardItem.hitsOpaqueArt`, and the
   * art-bounds law): a sprite owns the pixels it draws and not one more. It is
   * what makes a whole-body bound safe. A standee is ~2 tiles tall and her body
   * box hangs over the cells drawn BEHIND her; those sort at a LOWER depth, so
   * `topOnly` cuts the hit list down to her alone and the piece standing there
   * answers neither tap nor drag — `processDragDownEvent` never even sees it.
   * Measured in Roothold, where she stands one cell in front of (85,0): the
   * whole-body box claims 100% of that piece's footprint (the lower-body box
   * claimed 44%). Yielding her transparent pixels hands the board back every
   * part of a piece the player can actually SEE, in both directions — she still
   * answers a tap on her head, because her head is opaque.
   *
   * Hit-area points arrive in the LIVE frame's texture space (Phaser adds
   * `displayOrigin` and has already undone scale), which is the same space the
   * bodyBox rect is measured in — so the alpha lookup needs no conversion.
   */
  private standeeOpaqueAt(
    sprite: Phaser.GameObjects.Sprite,
    hx: number,
    hy: number,
    ring: number
  ): boolean {
    const key = sprite.texture.key;
    // No pixels to ask (a texture evicted by travel mid-pointer): behave like
    // the plain rect rather than going deaf.
    if (!this.textures.exists(key)) return true;
    const frame = sprite.frame.name;
    const sample = (x: number, y: number): boolean => {
      // Source art faces LEFT; a mirrored standee reads the mirrored column.
      const px = sprite.flipX ? sprite.width - x : x;
      const a = this.textures.getPixelAlpha(Math.floor(px), Math.floor(y), key, frame);
      return a !== null && a > 0;
    };
    if (sample(hx, hy)) return true;
    if (ring <= 0) return false;
    return (
      sample(hx + ring, hy) ||
      sample(hx - ring, hy) ||
      sample(hx, hy + ring) ||
      sample(hx, hy - ring) ||
      sample(hx + ring, hy + ring) ||
      sample(hx - ring, hy - ring) ||
      sample(hx + ring, hy - ring) ||
      sample(hx - ring, hy + ring)
    );
  }

  /**
   * How far past her painted pixels a pointer still counts as her — her
   * KEYLINE, in texture px.
   *
   * Not forgiveness: the ink twin is part of what is drawn, so this is still
   * "her silhouette" and nothing more. That distinction is worth the ceremony,
   * because generosity here is expensive in a way it is not for a board item.
   * A piece standing behind her shows as a fringe a few pixels wide past her
   * outline, and that fringe is the whole of what the player has to aim at.
   * Measured in Roothold on the piece at (85,0): her art alone covers 82% of
   * it, her keyline takes that to 93% — and a board-item-sized ring
   * (HIT_FORGIVENESS_PX, ~40 texture px once converted onto her) would take it
   * to 99%, handing back almost exactly the sliver being aimed at. Forgiveness
   * is for thin, holey pieces; a standee is the largest silhouette on the board
   * and needs none.
   *
   * Divided by the LIVE scale: the units are on-board (the line does not change
   * weight between clips), and hit-area points arrive in texture space.
   */
  private standeeHitRing(sprite: Phaser.GameObjects.Sprite): number {
    const units = (sprite.getData('inkUnits') as number | undefined) ?? 0;
    const scale = Math.abs(sprite.scaleX);
    return units > 0 && scale > 0 ? units / scale : 0;
  }

  private reshapeStandees(): void {
    const whole = this.standeeWhole() || this.giveTweens.length > 0;
    for (const sprite of this.characterSprites.values()) {
      const box = sprite.getData('bodyBox') as HitBox | undefined;
      const area = sprite.input?.hitArea as Phaser.Geom.Rectangle | undefined;
      if (!box || !area) continue;
      const r = characterHitRect(box, whole);
      area.setTo(r.x, r.y, r.width, r.height);
    }
  }

  private pulseGiveTargets(on: boolean): void {
    for (const tween of this.giveTweens) tween.remove();
    this.giveTweens = [];
    const targets: Phaser.GameObjects.GameObject[] = [];
    for (const sprite of this.characterSprites.values()) targets.push(sprite);
    for (const [id, sprite] of this.itemSprites) {
      const item = this.ctx.state.items.get(id);
      if (item && this.ctx.systems.dragons.isBoardDragon(item)) targets.push(sprite);
    }
    // While a piece is held out, a standee's hit area becomes her WHOLE body.
    //
    // It is normally her lower body only, so her two-tile-tall frame cannot
    // swallow taps meant for the cells behind her. But a held piece has no
    // board interaction left to protect — every tap is aimed at a recipient —
    // and the narrow rect made tapping her head miss, fall through to empty
    // ground, and CANCEL the give. That is the "had to try twice" on the
    // Crystal Ball: the tutorial arrow points at her top-centre, which was
    // exactly the part of her that was not listening.
    //
    // The rect is mutated IN PLACE. `setInteractive` cannot do this: Phaser's
    // `InputPlugin.enable` only calls `setHitArea` when the object has no
    // `input` yet, so handing an already-interactive sprite a new shape is
    // silently ignored and the old area stays live.
    for (const sprite of this.characterSprites.values()) {
      const box = sprite.getData('bodyBox') as HitBox | undefined;
      const area = sprite.input?.hitArea as Phaser.Geom.Rectangle | undefined;
      if (!box || !area) continue;
      const r = characterHitRect(box, on || this.standeeWhole());
      area.setTo(r.x, r.y, r.width, r.height);
    }
    for (const target of targets) {
      const obj = target as Phaser.GameObjects.Sprite;
      if (!on) {
        obj.setScale(baseScaleOf(obj));
        continue;
      }
      // Relative to each one's OWN scale — a standee renders well under 1 and a
      // literal `from: 1` would snap it to full authoring size for the pulse.
      const base = baseScaleOf(obj);
      this.giveTweens.push(
        this.tweens.add({
          targets: obj,
          scale: { from: base, to: base * 1.07 },
          duration: 560,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        })
      );
    }
  }

  /**
   * Deliver the held piece to whoever was tapped.
   *
   * The same check-the-record-moved contract every other handing-over in this
   * game holds: ask through the bus, read the recipient's own counter, and take
   * the piece out of the bag ONLY if it actually moved. A refusal leaves the
   * piece pocketed and the gesture armed, so the player can simply tap somebody
   * else rather than starting again from the satchel.
   */
  private deliverGiveTo(target: { kind: 'character'; id: string } | { kind: 'dragon'; id: number }): void {
    const held = this.pendingGive;
    if (!held) return;
    const { chain, tier } = held;

    let taken = false;
    if (target.kind === 'character') {
      const before = this.ctx.systems.regard.given(target.id, chain, tier);
      this.ctx.bus.emit('ui:gift_requested', { characterId: target.id, chain, tier });
      taken = this.ctx.systems.regard.given(target.id, chain, tier) > before;
      if (taken) this.selectSubject('character', target.id, false);
    } else if (this.ctx.systems.dragonLife.sleepKindOf(target.id)) {
      // Asleep: it will not eat from the satchel either. `taken` stays false,
      // so the refusal below hands the piece back to the bag — the same
      // "offered and declined" shape the drag path gives it.
      const sprite = this.itemSprites.get(target.id);
      if (sprite) this.floatText(sprite.x, sprite.y - 190, 'Fast asleep…', PALETTE.cream);
    } else {
      const before = this.ctx.systems.dragons.careOf(target.id).meals;
      this.ctx.bus.emit('ui:feed_dragon_requested', { itemId: target.id, chain, tier });
      taken = this.ctx.systems.dragons.careOf(target.id).meals > before;
      if (taken) this.selectSubject('dragon', String(target.id), false);
    }

    if (!taken) return; // the refusal already spoke for itself (UIScene)
    this.ctx.bus.emit('bag:consume', { chain, tier, count: 1 });
    this.pendingGive = null;
    this.pulseGiveTargets(false);
    this.ctx.bus.emit('bag:give_cancelled', {});
  }

  /** Hand one good to a nest or a dragon. Returns whether it was taken — a
   *  refusal must leave the piece on the board, not eat it silently. */
  private offerFood(
    a: { kind: 'character' | 'nest' | 'companion'; id: string; col?: number; row?: number },
    chain: string,
    tier: number
  ): boolean {
    if (!isDragonFood(chain, tier)) {
      this.ctx.bus.emit(
        a.kind === 'nest'
          ? 'nest:offer_refused'
          : 'character:action_failed',
        a.kind === 'nest'
          ? { col: a.col ?? 0, row: a.row ?? 0, reason: 'not_food' }
          : { characterId: a.id, reason: 'invalid_target' }
      );
      return false;
    }
    if (a.kind === 'nest') {
      const before = this.ctx.systems.dragons.nestAt(a.col ?? 0, a.row ?? 0).points;
      this.ctx.bus.emit('ui:nest_offer_requested', { col: a.col ?? 0, row: a.row ?? 0, chain, tier });
      // The daily cap refuses without taking anything — the piece stays.
      return this.ctx.systems.dragons.nestAt(a.col ?? 0, a.row ?? 0).points > before;
    }
    this.ctx.bus.emit('ui:feed_companion_requested', { companionId: a.id, chain, tier });
    return true;
  }

  /**
   * Hand one piece to a person. Returns whether she took it.
   *
   * Asked and answered through the bus like everything else — the scene never
   * calls into RegardSystem to CHANGE anything, it emits the intent and then
   * reads the lifetime counter to see whether it moved. A decline leaves the
   * piece exactly where it was and says so in her own voice (UIScene).
   */
  private offerGift(characterId: string, chain: string, tier: number): boolean {
    const regard = this.ctx.systems.regard;
    if (!regard.wants(characterId, chain, tier)) return false;
    const before = regard.given(characterId, chain, tier);
    this.ctx.bus.emit('ui:gift_requested', { characterId, chain, tier });
    return regard.given(characterId, chain, tier) > before;
  }

  private onNestTapped(itemId: number, col: number, row: number): void {
    if (this.armed?.kind === 'nest' && this.armed.id === String(itemId)) {
      this.disarmCharacter();
      return;
    }
    const n = this.ctx.systems.dragons.nestAt(col, row);
    this.armed = { kind: 'nest', id: String(itemId), col, row };
    this.ctx.bus.emit('nest:warmed', { col, row, points: n.points, required: n.required });
  }

  /** Named dragons standing where their nest gave them up. Scenery with a tap
   *  handler — never pooled, never in `state.items`, never draggable. */
  private buildCompanions(): void {
    // A companion's `col`/`row` is the cell its nest stood on — an address in
    // the world it was hatched in, which today is always Emberkeep. Drawing it
    // on another world would put it at that world's cell of the same number,
    // which is somewhere else entirely.
    if (this.ctx.state.worldId !== WORLD_ID) return;
    for (const c of this.ctx.systems.dragons.companions) {
      if (this.companionSprites.has(c.id)) continue;
      const key = `item_${c.chain}_${c.adult ? 4 : 3}`;
      if (!this.textures.exists(key)) continue;
      const { x, y } = gridToWorld(c.col, c.row);
      const sprite = this.add.image(x, y, key).setOrigin(0.5, 0.85).setDepth(DEPTHS.itemBase + y);
      const hw = sprite.width;
      const hh = sprite.height;
      // Same trap as the world characters: a tall sprite anchored to one cell
      // overhangs the cells behind it, so the hit area is its lower body only.
      sprite.setInteractive(
        new Phaser.Geom.Rectangle(hw * 0.22, hh * 0.5, hw * 0.56, hh * 0.5),
        Phaser.Geom.Rectangle.Contains
      );
      this.input.setDraggable(sprite, false);
      sprite.on('pointerup', () => this.onCompanionTapped(c.id, sprite));
      this.companionSprites.set(c.id, sprite);
      this.settleSprite(sprite, 90);
    }
  }

  /** An adult uses different art, so its standee is rebuilt rather than tinted. */
  private rebuildCompanions(): void {
    for (const s of this.companionSprites.values()) s.destroy();
    this.companionSprites.clear();
    this.buildCompanions();
  }

  private onCompanionTapped(companionId: string, sprite: Phaser.GameObjects.Image): void {
    if (this.armed?.kind === 'companion' && this.armed.id === companionId) {
      this.disarmCharacter();
      return;
    }
    // Trust 2 digs, Trust 4 forages — both fire on the greeting, once a day.
    this.ctx.systems.dragons.tap(companionId);
    this.armed = { kind: 'companion', id: companionId };
    sprite.setTint(0xffd84d);
    this.armedTween?.remove();
    this.armedTween = this.tweens.add({
      targets: sprite, scale: { from: 1, to: 1.06 }, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    });
  }

  /**
   * Build the live Three.js emerald crystal ONCE and graft it over the
   * `item_crystal_1` texture, so the Theme-Crystal generator (and every authored
   * 3D-decor placement) shows the spinning cel-shaded gem instead of the flat
   * PNG — same key, so the generator's anchor/scale/gameplay are untouched. The
   * spec comes from the world's `decor3d` (the world-builder's `model3d`), or a
   * default emerald. WebGL-less contexts keep the PNG (the try/catch falls back).
   */
  /**
   * Keep the PAINTED crystal reachable, always.
   *
   * The live gem takes over the shared `item_crystal_1` key on purpose — that is
   * what gives every consumer (the Theme-Crystal generator, authored 3D decor) the
   * 3D emerald without knowing it exists. But it used to take the key by DESTROYING
   * the preloaded PNG, and the key is then only as alive as that WebGL canvas: a
   * run that skips the gem (iOS, a lower quality tier) found no crystal art at all,
   * and a scene torn down and rebuilt left the key pointing at a canvas whose
   * context had been disposed — the crystal that "sometimes" goes black or freezes.
   *
   * So the PNG is stashed once under its own key and put back whenever the shared
   * one is not a live canvas. Idempotent: safe to call on create and on shutdown.
   */
  private restoreCrystalArt(): void {
    const cur = this.textures.exists(CRYSTAL_KEY) ? this.textures.get(CRYSTAL_KEY) : undefined;
    const isCanvas = cur?.source[0]?.isCanvas === true;
    if (cur && !isCanvas) {
      // The shared key still holds the painted art — stash it once and leave it.
      if (!this.textures.exists(CRYSTAL_PNG)) {
        this.textures.addImage(CRYSTAL_PNG, cur.getSourceImage() as HTMLImageElement);
      }
      return;
    }
    if (!this.textures.exists(CRYSTAL_PNG)) return; // never had a PNG (unknown key) — nothing to restore
    this.textures.remove(CRYSTAL_KEY);
    this.textures.addImage(CRYSTAL_KEY, this.textures.get(CRYSTAL_PNG).getSourceImage() as HTMLImageElement);
  }

  private ensureCrystal3D(): void {
    // Whatever the last run left behind, start from real art.
    this.restoreCrystalArt();
    // The painted grotto is the crystal (see CRYSTAL_3D).
    if (!CRYSTAL_3D) return;
    // `high` only, and never on a touch device — see `liveCrystalAvailable`.
    // Everywhere else the baked spin sheet plays the same 90° loop for the price
    // of a texture, with no second WebGL context and no per-frame readback (see
    // `spinsBakedCrystal`).
    if (!liveCrystalAvailable()) return;
    const map = this.ctx.state.map;
    const spec = map.decor3d?.find((d) => d.model3d)?.model3d ?? undefined;
    // DYNAMIC, and this is the only import of three.js in the codebase: at 72 KB
    // brotli it was riding the one boot-blocking bundle onto every device,
    // including every iOS, phone and non-`high` machine guaranteed never to
    // execute a line of it. Now the tier that renders the gem downloads the
    // renderer, and the tiers that play the sheet download the sheet — one gem
    // each, never both.
    void import('../render/Crystal3D')
      .then(({ sharedCrystal3D }) => {
        // The board may have been left (travel, a quality change) while this was
        // in flight; installing a texture into a dead scene would throw.
        if (!this.scene.isActive()) return;
        // ONE renderer per page (`sharedCrystal3D`), not one per scene. The
        // texture manager is the GAME's, not the scene's, so both the gem and the
        // key it wears simply outlive every rebuild.
        const crystal = sharedCrystal3D(spec ?? {});
        this.textures.remove(CRYSTAL_KEY); // the painted art is safe under CRYSTAL_PNG
        this.crystalTex = this.textures.addCanvas(CRYSTAL_KEY, crystal.canvas) ?? undefined;
        if (!this.crystalTex) return;
        this.crystal3d = crystal;
        // The import means items and decor can now be BUILT before the gem
        // arrives, and the swap above destroyed the texture they were holding a
        // frame of — which ends the RAF chain, not just the picture. Re-point
        // them at the new one; same key, so the anchor still resolves.
        for (const sprite of this.itemSprites.values()) {
          if (sprite.chain === 'crystal' && sprite.kind !== 'decor') {
            sprite.setArtTexture(CRYSTAL_KEY, this.ctx.data.anchors);
          }
        }
        for (const decor of this.crystalDecor) decor.setTexture(CRYSTAL_KEY);
      })
      .catch((err) => {
        console.warn('[Crystal3D] unavailable — keeping the 2D crystal art.', err);
      });
  }

  /**
   * True when this piece is the emerald AND it should play the BAKED spin rather
   * than wear the live three.js gem.
   *
   * The texture check is not belt-and-braces: the sheet is only FETCHED where the
   * live gem is declined, so on a machine that has the real thing it is
   * legitimately absent. `crystal3d` being unset is no longer proof on its own —
   * the renderer arrives asynchronously now — which is exactly why the sheet's
   * presence is the term that decides.
   */
  private spinsBakedCrystal(snap: ItemSnapshot): boolean {
    return (
      snap.chain === 'crystal' &&
      snap.kind !== 'decor' &&
      !this.crystal3d &&
      this.textures.exists(CRYSTAL_SPIN_KEY)
    );
  }

  /**
   * Authored Three.js 3D-decor (`map.decor3d`, the world-builder's `3d` tab):
   * static scenery that wears the SAME live crystal texture as the generator.
   * Mirrors buildMapDecor — per-asset calibration + free-move dx/dy, y-sorted in
   * the item band, with a ground shadow. Skipped if the live texture never came
   * up (WebGL-less); the gem only shows where the world placed it.
   */
  private buildMapDecor3d(): void {
    this.crystalDecor = [];
    const map = this.ctx.state.map;
    // Render wherever the crystal texture exists — the live 3D gem when present,
    // else the static PNG fallback (iOS / WebGL-less), so decor never silently drops.
    if (!map.decor3d?.length || !this.textures.exists(CRYSTAL_KEY)) return;
    // The crystal GENERATOR already stands on the authored 3D-crystal spot (see
    // build-gamemap), so skip the scenery copy there — exactly ONE crystal renders.
    const genCells = new Set(
      (map.startingItems ?? [])
        .filter((i) => i.chain === 'crystal')
        .map((i) => `${i.at[0]},${i.at[1]}`)
    );
    const ratio = TILE_W / (map.tile?.width ?? TILE_W);
    map.decor3d.forEach((d, i) => {
      if (genCells.has(`${d.col},${d.row}`)) return; // generator covers this placement
      const { x, y } = gridToWorld(d.col, d.row);
      const cal = map.decor3dCalibration?.[d.name] ?? {
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        anchor: { x: 0.5, y: 0.72 }
      };
      const baseY = y + (cal.offsetY + (d.dy ?? 0)) * ratio;
      const sprite = this.add
        .image(x + (cal.offsetX + (d.dx ?? 0)) * ratio, baseY, CRYSTAL_KEY)
        .setOrigin(cal.anchor?.x ?? 0.5, cal.anchor?.y ?? 0.72)
        .setScale((cal.scale ?? 1) * ratio)
        .setDepth(DEPTHS.itemBase + y);
      this.crystalDecor.push(sprite);
      // Under the gem, not under its cell — same rule as `buildMapDecor` above.
      // The authored emerald carries dx -64 / dy -28, so its shadow used to sit
      // a third of a tile down-right of the crystal casting it.
      this.addGroundShadow(sprite.x, sprite.y, sprite.displayWidth, DEPTHS.itemBase + y - 1);
      this.settleSprite(sprite, (i % 8) * 35); // one-time landing settle
    });
  }

  private buildFog(): void {
    for (const region of this.ctx.state.map.regions) {
      if (this.ctx.state.regionStatus.get(region.id) === 'active') continue;
      // `fog: false` = ground this chapter cannot reach; it keeps its painted
      // scenery rather than a cloud that would never lift (see MapRegionConfig).
      if (region.fog === false) continue;
      for (const [col, row] of region.tiles) {
        this.createFogSprite(region.id, col, row);
      }
    }
  }

  /**
   * The far promise (DEMO-PLAN §Act I): a faint golden shimmer breathing over
   * the south terrace's ash-clouds all game long — the visible, unreachable
   * place the Level-3 finale finally glimpses into. Pure ambience.
   */
  private buildSouthPromise(): void {
    const region = this.ctx.state.map.regions.find((r) => r.id === FINALE_REGION);
    if (!region || region.tiles.length === 0) return;
    const c = this.regionCentroid(region.tiles.map(([col, row]) => ({ col, row })));
    const glow = this.add
      .image(c.x, c.y - 30, 'fx_glow')
      .setTint(num(PALETTE.goldAccent))
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTHS.itemBase + c.y + 2400) // above the region's cloud band
      .setScale(2.6)
      .setAlpha(0.07);
    this.tweens.add({
      targets: glow,
      alpha: 0.16,
      scale: 3.1,
      duration: 2600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
  }

  /**
   * Float a Bronze Key over each key-locked region so the player reads "spend a
   * key here". Sits above the cloud band at the region centroid; lifts away when
   * the region unlocks (see onRegionUnlocked).
   */
  private buildKeyBadges(): void {
    for (const region of this.ctx.state.map.regions) {
      if (this.ctx.state.regionStatus.get(region.id) === 'active') continue;
      if (!region.unlock?.keys) continue;
      const { x, y } = this.regionCentroid(region.tiles.map(([col, row]) => ({ col, row })));
      const badge = this.add
        .image(x, y - 64, 'icon_key_bronze')
        .setScale(1.2)
        .setDepth(DEPTHS.itemBase + y + 1000) // above this region's cloud band
        .setAlpha(0)
        .setVisible(false); // earned into view — see syncKeyBadges
      // The badge SPENDS the key, exactly as tapping the cloud under it does.
      // It used to be decoration: the one thing on screen shaped like "press me
      // to open this" did nothing at all, so the gate stayed shut, the key
      // stayed in the wallet, and the badge came back on every load — which
      // reads as the game refusing a key it had already taken.
      badge.setInteractive({ useHandCursor: true });
      badge.on(
        'pointerup',
        (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
          ev.stopPropagation();
          this.tapClaimed = true;
          this.ctx.bus.emit('fog:tapped', { regionId: region.id });
        }
      );
      hoverBob(this, badge, 10, 520);
      this.keyBadges.set(region.id, badge);
    }
    this.syncKeyBadges(false);
  }

  /**
   * A key badge is a PROMISE the player can keep, so it appears over a region
   * only while the Keeper actually HOLDS the keys it costs — never on arrival.
   * Borealis opens with two key-locked isles, and floating both keys from the
   * first frame told the player the gates were already theirs; now the coast's
   * badge appears when Selyna's first order pays its key, and the keep's when
   * the second key is banked. Spending keys re-hides what is no longer covered.
   *
   * `cinematic` earns the appearance a beat: the camera glides to the gate,
   * leans in, the key pops in gold, and the camera comes home (queued, so two
   * keys arriving together reveal one after the other). Quiet mode is for
   * loads, world arrivals and tutorial steps — states, not moments.
   */
  private syncKeyBadges(cinematic: boolean): void {
    for (const [regionId, badge] of this.keyBadges) {
      const region = this.ctx.state.map.regions.find((r) => r.id === regionId);
      const cost = region?.unlock?.keys ?? 1;
      // During the tutorial only the key_unlock lesson may show a key at all.
      const gate = this.tutorialDone || this.tutorialStepId === 'key_unlock';
      // …and the gate must still BE a gate. Keys are Keeper-wide — they follow
      // the player across worlds — so a key earned for Borealis's fog used to
      // re-light the badge over an Emberkeep gate that had already been paid
      // for and had no cloud left on it. A badge is a lock, not a wallet.
      const locked = !!region && this.ctx.state.regionStatus.get(regionId) !== 'active';
      const show = gate && locked && this.ctx.state.keys >= cost;
      if (show === (badge.getData('shown') === true)) continue;
      badge.setData('shown', show);
      if (!show) {
        badge.setVisible(false).setAlpha(0);
      } else if (cinematic) {
        this.keyRevealQueue.push(badge);
        if (!this.keyRevealPlaying) this.playNextKeyReveal();
      } else {
        badge.setVisible(true).setAlpha(1);
      }
    }
  }

  /** One queued key-reveal cinematic: glide + lean in, pop the key, come home. */
  private playNextKeyReveal(): void {
    const badge = this.keyRevealQueue.shift();
    if (!badge) {
      this.keyRevealPlaying = false;
      return;
    }
    this.keyRevealPlaying = true;
    const cam = this.cameras.main;
    const home = { x: cam.midPoint.x, y: cam.midPoint.y, zoom: cam.zoom };
    // Glide, zoom and the beat that waits on them are ONE move: all three
    // carry the same length, and the delay clears it by 20ms.
    this.glideToWorld(badge.x, badge.y + 60, 1050);
    cam.zoomTo(home.zoom * 1.16, 1050, 'Sine.easeInOut');
    this.time.delayedCall(1070, () => {
      badge.setVisible(true).setAlpha(0).setScale(0.25);
      this.glowFlash(badge.x, badge.y, PALETTE.goldAccent, 0.65, 1.5);
      this.sparks.explode(12, badge.x, badge.y);
      this.tweens.add({
        targets: badge,
        alpha: 1,
        scale: 1.2,
        duration: 460,
        ease: 'Back.easeOut'
      });
      this.time.delayedCall(1000, () => {
        cam.zoomTo(home.zoom, 900, 'Sine.easeInOut');
        this.glideToWorld(home.x, home.y, 900);
        this.time.delayedCall(930, () => this.playNextKeyReveal());
      });
    });
  }

  /**
   * The doors out of this world — one invisible rectangle per authored portal,
   * over the gateway the backdrop already paints (`world.ts` PortalRuntime).
   *
   * A `Zone`, not a transparent rectangle: `setAlpha(0)` clears the render flag
   * and Phaser then skips the object in hit-testing entirely, so the obvious
   * "invisible" spelling is the one that silently does nothing. A Zone never
   * renders BY CONSTRUCTION and stays fully interactive.
   *
   * Deliberately the LOWEST interactive band on the board (`DEPTHS.tiles`, under
   * every item, badge, standee and cloud). A door is scenery: it must never win
   * a tap that landed on something the player can actually pick up, and the
   * gateways are painted off the playable ground anyway. Fog draws over it for
   * the same reason it draws over ground — you cannot walk through a door behind
   * a cloud.
   */
  private buildPortals(): void {
    for (const p of this.ctx.state.world.portals) {
      const zone = this.add
        .zone(p.x + p.width / 2, p.y + p.height / 2, p.width, p.height)
        .setDepth(DEPTHS.tiles + 1)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        if (!this.isTap(pointer)) return;
        // An INTENT chain, never the switch itself: the tap asks for the
        // travel prompt, the prompt's Cross emits `world:switch`, and
        // WorldSystem still owns whether the journey is allowed — a door that
        // bypassed it could carry the player out of the tutorial mid-step.
        const world = this.ctx.state.worlds.get(p.to);
        const display = world ? world.name.charAt(0).toUpperCase() + world.name.slice(1) : p.to;
        this.ctx.bus.emit('ui:travel_requested', { to: p.to, label: p.label, world: display });
      });
      // EVERY door wears a PortalFX, coloured by its DESTINATION (PORTAL_TINTS)
      // — the player learns the routes by colour before they learn them by name.
      const cx = p.x + p.width / 2;
      const cy = p.y + p.height / 2;
      const fx = new PortalFX(this, cx, cy, GATE_FX_HEIGHT, p.to);
      fx.setDepth(DEPTHS.itemBase + cy);
      this.portalDoors.set(p.id, { fx, zone, to: p.to });
    }
    // Doors already earned stand lit from the first frame (all three story
    // gates are save-derivable), including the ceremony door on a reload.
    this.syncPortalFx(false);
    this.refreshPortals();
    this.offBus.push(
      // The North Crossing's opening IS a ceremony: the finale ends, Eleanor
      // speaks it open, and `gate:opened` lights it — never the latch alone.
      this.ctx.bus.on('gate:opened', () => this.ignitePortal('emberkeep_altar_gate')),
      // The Ember Gate (→ Roothold) opens on Order 1; the Rune Way
      // (→ Hatchery) on the third Selyna quest. Both are plain availability
      // flips, so one sync serves them — and any future gate — unchanged.
      this.ctx.bus.on('order:completed', () => this.syncPortalFx(true)),
      this.ctx.bus.on('quest:completed', () => this.syncPortalFx(true))
    );
    this.buildHubLandmarks();
  }

  /**
   * The painted landmarks a hub is FOR, given hands: in Roothold, the house is
   * the Emporium's storefront — tapping it opens the shop, exactly as the tour
   * teaches. A zone over the painting, like a portal, but in the ITEM band:
   * a storefront is a thing, not ground.
   */
  private buildHubLandmarks(): void {
    if (this.ctx.state.worldId !== 'roothold') return;
    const r = ROOTHOLD_HOUSE;
    const openShop = (pointer: Phaser.Input.Pointer): void => {
      if (!this.isTap(pointer)) return;
      this.tapClaimed = true;
      this.ctx.bus.emit('ui:emporium_requested', {});
    };
    const zone = this.add
      .zone(r.x + r.width / 2, r.y + r.height / 2, r.width, r.height)
      .setDepth(DEPTHS.itemBase + r.y + r.height)
      .setInteractive({ useHandCursor: true });
    zone.on('pointerup', openShop);
    // The tour's arrow lands over the roofline.
    this.tourTargets.set('roothold_house', { x: r.x + r.width / 2, y: r.y + 40 });

    /*
     * THE ONE BUILDING YOU CAN WALK INTO — and it had nothing to say so.
     *
     * The Emporium is PAINTED INTO THE BACKDROP: there is no sprite here, only
     * a tap zone over a picture, so it reads as one more roof in a hillside of
     * roofs. An outline is the honest answer and it is an ART job (cut the
     * storefront out of `roothold.webp`, register it as decor, re-export the
     * world) — SpriteInk needs a sprite to hang its ink twin on.
     *
     * A LIGHT does not. One ADD-blended `fx_glow` behind the roofline says "a
     * lamp is lit in there" rather than drawing a border around a painting, and
     * it costs one draw call and one tween: no particles, no pipeline, no new
     * asset (`fx_glow` is painted at runtime and is resident everywhere).
     * The slow breath is what the eye catches — a still glow is just paint.
     *
     * At 0.1 -> 0.26 it was invisible, and it was always going to be: the
     * backdrop it sits on is a WARM painting lit by its own braziers, so a
     * faint gold ADD on top of it is gold on gold. The breath is the readable
     * part, so the band is wide (0.22 -> 0.58) rather than merely brighter.
     */
    this.hubGlow = this.add
      .image(r.x + r.width / 2, r.y + r.height * 0.55, 'fx_glow')
      .setTint(num(PALETTE.goldAccent))
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTHS.itemBase + r.y + r.height - 1) // under the tap zone, over the paint
      .setDisplaySize(r.width * 1.35, r.height * 1.15)
      .setAlpha(0.22);
    this.tweens.add({
      targets: this.hubGlow,
      alpha: 0.58,
      displayWidth: r.width * 1.52,
      displayHeight: r.height * 1.3,
      duration: 2200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    /*
     * AND A SIGN — because a light is atmosphere, and only a sign is
     * information.
     *
     * The glow can say "something is lit in there". It cannot say "this one is
     * the shop, and you may walk into it", which is the single fact the player
     * needs in a hub whose every roof was painted by the same hand at the same
     * hour. So the storefront gets what a real market street gives it: a
     * hanging sign over the door, carrying the Emporium's own glyph — the same
     * `ui_icon_shop` the HUD's shop button wears, so the board and the chrome
     * agree about what that picture means — on a spike aimed at the roofline.
     *
     * It bobs, and it is tappable in its own right. A still marker at the top
     * of a painting becomes part of the painting within about four seconds,
     * which is the exact failure being fixed.
     */
    const sign = this.add
      .container(r.x + r.width / 2, r.y - 52)
      .setDepth(DEPTHS.itemBase + r.y + r.height + 1);
    const plate = this.add.graphics();
    plate.fillStyle(num(PALETTE.night), 0.82);
    plate.fillCircle(0, 0, 64);
    plate.fillStyle(num(PALETTE.gold), 1);
    plate.fillTriangle(-20, 54, 20, 54, 0, 96); // the spike, pointing at the door
    plate.lineStyle(8, num(PALETTE.gold), 1);
    plate.strokeCircle(0, 0, 64);
    const icon = this.add.image(0, 0, 'ui_icon_shop');
    icon.setScale(84 / Math.max(icon.width, icon.height));
    sign.add([plate, icon]);
    sign.setSize(150, 150).setInteractive({ useHandCursor: true });
    sign.on('pointerup', openShop);
    this.tweens.add({
      targets: sign,
      y: sign.y - 24,
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
    this.hubSign = sign;
  }

  /** The lit-shop glow over Roothold's Emporium — hidden while the device dozes,
   *  because a pulse nobody is watching is a pulse nobody should be paying for. */
  private hubGlow?: Phaser.GameObjects.Image;
  /** Its hanging sign. Dozes with it: the marker's whole value is the motion,
   *  and a frozen marker is worth less than none. */
  private hubSign?: Phaser.GameObjects.Container;

  /** The hub tours' bouncing pointer over a board landmark. */
  /**
   * THE CAMERA FOLLOWS THE POINTER — wherever the tutorial points, the player
   * can see.
   *
   * The board camera frames one level and is otherwise held still during the
   * tutorial, which was fine while every scripted target sat in the opening
   * frame. It stopped being fine as the script grew: a step could point at a
   * cell the camera had never included, and the lesson became "find the arrow".
   * Three beats had already been patched one at a time (the crystal, the fog
   * gate, the golden tease) — this is the rule those three were special cases
   * of, so a new step needs no camera code at all.
   *
   * WHAT IT WILL NOT DO is move for the sake of moving. A pointer already
   * comfortably in frame is left alone: nudging the world on every step reads
   * as drift, and the inset keeps a target from being technically visible while
   * it hugs an edge under the HUD.
   */
  private followTutorialPointer(step: TutorialStepEvent): void {
    if (step.done) return; // the hand-over step: the board is the player's again
    const hand = step.hand;
    if (hand && 'from' in hand) {
      // A CARRY HAS TWO ENDS, and the player has to see both. Following the
      // piece alone was right while every drop landed a tile or two away; the
      // board-hygiene beat now carries the stump to another island, and a
      // camera parked on the piece left the destination off the edge of the
      // frame — the player dragged toward a place they could not see, and the
      // hand flew out of view on every loop. Framing the pair shows the whole
      // gesture; `bringPairIntoView` still moves nothing when both ends are
      // already comfortably in frame.
      const from = worldPointOf(this.ctx.state.world, hand.from.col, hand.from.row);
      const to = worldPointOf(this.ctx.state.world, hand.to.col, hand.to.row);
      this.bringPairIntoView(from, to);
      return;
    }
    const at = this.pointerWorldPoint(hand ?? step.arrow);
    if (at) this.bringIntoView(at);
  }

  /**
   * Both ends of a carry, comfortably in frame — centred on their midpoint
   * when either one is not.
   *
   * The midpoint, not the destination: a player's finger has to START on the
   * piece, so a camera that jumps to the drop leaves them hunting for what to
   * pick up. Every shipped carry spans far less than the frame at any zoom
   * this board reaches (the longest, 447 world px, against a comfortable inner
   * box of 1219 at the tightest zoom), so the midpoint always shows both; a
   * future carry longer than the frame would need a zoom, not a pan.
   */
  private bringPairIntoView(a: { x: number; y: number }, b: { x: number; y: number }): void {
    const view = this.cameras.main.worldView;
    const insetX = view.width * TUTORIAL_FOLLOW_INSET;
    const insetY = view.height * TUTORIAL_FOLLOW_INSET;
    const comfortable = (p: { x: number; y: number }): boolean =>
      p.x >= view.x + insetX && p.x <= view.right - insetX && p.y >= view.y + insetY && p.y <= view.bottom - insetY;
    if (comfortable(a) && comfortable(b)) return;
    this.glideToWorld((a.x + b.x) / 2, (a.y + b.y) / 2, TUTORIAL_FOLLOW_MS);
  }

  /**
   * Put a world point somewhere the player can comfortably see it.
   *
   * EVERY pointer, not just the tutorial's. The camera-follow shipped tied to
   * scripted steps, so the moment the script handed over — and in every world
   * that has no script at all — a hand could point at a cell the camera had
   * never included, and the help became "find the hint". A pointer the player
   * cannot see is not help, whichever system raised it.
   *
   * Only when it is NOT already comfortably in frame: a camera that re-centres
   * on something already on screen reads as drift, and it would fight a player
   * who has just panned somewhere deliberately.
   */
  private bringIntoView(at: { x: number; y: number }): void {
    const view = this.cameras.main.worldView;
    const insetX = view.width * TUTORIAL_FOLLOW_INSET;
    const insetY = view.height * TUTORIAL_FOLLOW_INSET;
    const comfortable =
      at.x >= view.x + insetX &&
      at.x <= view.right - insetX &&
      at.y >= view.y + insetY &&
      at.y <= view.bottom - insetY;
    if (comfortable) return;
    this.glideToWorld(at.x, at.y, TUTORIAL_FOLLOW_MS);
  }

  /**
   * Where a pointer target stands in the WORLD, or null when it stands nowhere
   * the camera can go.
   *
   * `ui` is on the HUD, which travels with the viewport — there is nothing to
   * pan toward. `fogRegion` is a whole strip rather than a point and has its
   * own framing (`panToRegion`), which runs beside this. A gauntlet hand is
   * followed to the piece it wants MOVED, not to the destination: that is where
   * the player's finger has to start.
   */
  private pointerWorldPoint(
    target: ResolvedArrow | ResolvedHand | null
  ): { x: number; y: number } | null {
    if (!target) return null;
    if ('from' in target) return worldPointOf(this.ctx.state.world, target.from.col, target.from.row);
    if ('tile' in target) return worldPointOf(this.ctx.state.world, target.tile.col, target.tile.row);
    if ('character' in target) return this.characterAimWorldPoint(target.character);
    return null;
  }

  private onTourPoint(target: string): void {
    this.clearTourArrow();
    const at = this.tourTargets.get(target);
    if (!at) return;
    // THE CAMERA GOES WHERE THE POINTER GOES. This was the one pointer path in
    // the scene that did not ask — the tutorial's does (`followTutorialPointer`),
    // the idle merge hint does, the carry lesson does. The hub tours are
    // deliberately not TutorialDirector beats, so they were simply never brought
    // under the rule, and the Emporium tour ended up aiming at a storefront that
    // was off the top of the frame on arrival. `bringIntoView` no-ops when the
    // target is already comfortably inside, so a tour that needs no glide gets none.
    this.bringIntoView(at);
    const arrow = this.add.image(at.x, at.y - 60, 'ui_arrow').setScale(0.5).setDepth(DEPTHS.dragged + 10);
    this.tweens.add({
      targets: arrow,
      y: at.y - 20,
      duration: 420,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
    this.tourArrow = arrow;
  }

  private clearTourArrow(): void {
    if (!this.tourArrow) return;
    this.tweens.killTweensOf(this.tourArrow);
    this.tourArrow.destroy();
    this.tourArrow = undefined;
  }

  /**
   * Light every door whose destination is now available. `bloom` animates a
   * fresh opening (ignition flash + shockwave); build time passes false so an
   * already-earned door simply stands lit. The North Crossing is excluded from
   * LIVE syncs — its quest latch flips mid-finale, and lighting it there would
   * scoop Eleanor's ceremony; `gate:opened` ignites it instead.
   */
  private syncPortalFx(bloom: boolean): void {
    const open = new Set(this.ctx.systems.worlds.available().map((w) => w.id));
    for (const [id, door] of this.portalDoors) {
      if (door.fx.isLive || !open.has(door.to)) continue;
      if (bloom && id === 'emberkeep_altar_gate') continue;
      if (bloom) {
        door.fx.bloom();
        // The gate's REVEAL carries a passenger: once the ignition has played
        // out, the named hatchling flies through and stays through. Hooked to
        // the bloom transition, so it happens exactly once per save — a reload
        // finds the door standing open (standIdle) and him already over there.
        this.time.delayedCall(GATE_FLIGHT.startDelayMs, () => this.playGateFlight(door));
      } else {
        door.fx.standIdle();
      }
      this.widenDoor(door);
    }
    this.refreshPortals();
  }

  /**
   * The hatchling's first crossing, with the WAKING as its opening beat.
   *
   * A sleeping dragon flown at a portal is a curled painting on a bezier — the
   * rig is hidden behind the sleep art and none of the flight clips are
   * mounted, so it arrives at the door still asleep and reads as stuck to it.
   * The sleep therefore ends FIRST: `keepAwake` covers the whole crossing, the
   * uncurl plays on the ordinary mood path, and only once it is on its feet
   * does the flight begin.
   */
  private playGateFlight(door: { fx: PortalFX; zone: Phaser.GameObjects.Zone; to: string }): void {
    const named = this.ctx.systems.dragons.firstNamed();
    if (!named) return;
    const asleep = this.ctx.systems.dragonLife.sleepKindOf(named.itemId) !== null;
    this.ctx.systems.dragonLife.keepAwake(named.itemId, GATE_FLIGHT.keepAwakeMs);
    if (asleep) {
      this.time.delayedCall(GATE_FLIGHT.wakeLeadMs, () => this.flyThroughGate(door, named.itemId));
      return;
    }
    this.flyThroughGate(door, named.itemId);
  }

  /**
   * Into the light, and THROUGH.
   *
   * He lifts off, arcs into the door as it takes him, and fades into the
   * glare — and that is where it ends. `dragon:cross_gate` moves the piece onto
   * the far world's board (WorldSystem owns the landing cell), so following him
   * through actually finds him waiting there. A flourish that flew back out
   * would be prettier by one beat and a lie by the whole point.
   */
  /**
   * The door under a drop point — but only one the player has actually earned.
   *
   * A portal rectangle exists from the first frame whether or not its
   * destination is open, and an unlit arch that swallowed a dragon would send
   * it somewhere the Keeper cannot follow. `available()` is the same set
   * `syncPortalFx` lights the doors from, so what accepts a dragon is exactly
   * what is glowing on screen.
   */
  private openDoorUnder(
    pointer: Phaser.Input.Pointer,
    dragged?: BoardItem
  ): { fx: PortalFX; zone: Phaser.GameObjects.Zone; to: string } | null {
    const open = new Set(this.ctx.systems.worlds.available().map((w) => w.id));
    // The POINTER is not where the player thinks they dropped: a piece is
    // carried by wherever it was grabbed, so a dragon laid squarely on the arch
    // can have the finger a tile below and to the left of it. The same trap the
    // drop-cell resolution warns about, and matching the pointer alone is why a
    // dragon dragged onto a door simply settled back on the board while a tap
    // on the same arch carried the Keeper through without it. So the ART's
    // bounds count too — what the player aimed is what the player sees.
    const art = dragged?.artHitRect();
    const box =
      art && dragged
        ? new Phaser.Geom.Rectangle(
            dragged.x + art.x - dragged.displayOriginX,
            dragged.y + art.y - dragged.displayOriginY,
            art.width,
            art.height
          )
        : null;
    for (const door of this.portalDoors.values()) {
      if (!open.has(door.to)) continue;
      const rect = door.zone.getBounds();
      if (rect.contains(pointer.worldX, pointer.worldY)) return door;
      if (box && Phaser.Geom.Intersects.RectangleToRectangle(rect, box)) return door;
    }
    return null;
  }

  private flyThroughGate(
    door: { fx: PortalFX; zone: Phaser.GameObjects.Zone; to: string },
    itemId: number
  ): void {
    const sprite = this.itemSprites.get(itemId);
    if (!sprite?.active) return;
    // Out of the lean's hands for the whole arc — see `crossing`.
    this.crossing.add(itemId);
    this.syncReadyLeans();
    const ld = this.liveDragons.get(itemId);
    const target = { x: door.zone.x, y: door.zone.y - 30 };
    if (ld) {
      ld.busy = true;
      this.setDragonFacing(ld, target.x <= sprite.x ? 'left' : 'right');
    }
    const journey = (): void => {
      // Arc control point well above the straight line — a flight, not a slide.
      const peak = { x: (sprite.x + target.x) / 2, y: Math.min(sprite.y, target.y) - 260 };
      const curve = new Phaser.Curves.QuadraticBezier(
        new Phaser.Math.Vector2(sprite.x, sprite.y),
        new Phaser.Math.Vector2(peak.x, peak.y),
        new Phaser.Math.Vector2(target.x, target.y)
      );
      const path = { t: 0 };
      this.tweens.add({
        targets: path,
        t: 1,
        duration: GATE_FLIGHT.flyMs,
        ease: 'Sine.easeInOut',
        onUpdate: () => {
          const at = curve.getPoint(path.t);
          sprite.x = at.x;
          sprite.y = at.y;
          sprite.settleDepth();
        },
        onComplete: () => {
          this.glowFlash(target.x, target.y, PALETTE.goldAccent, 0.8, 1.6);
          this.sparks.explode(18, target.x, target.y);
          this.tweens.add({
            targets: sprite,
            alpha: 0,
            scale: sprite.scale * 0.7,
            duration: GATE_FLIGHT.fadeMs,
            ease: 'Sine.easeIn',
            onComplete: () => {
              // The piece leaves this board here, not before: the state move is
              // what makes the crossing real, and doing it early would blink
              // the animal out from under its own flight.
              this.removeDragonRig(itemId);
              this.detachItemAura(itemId);
              this.itemSprites.delete(itemId);
              sprite.release();
              // The arc is over and the piece is gone from this board; the veto
              // it held goes with it, or the set grows by one every crossing.
              this.crossing.delete(itemId);
              this.ctx.bus.emit('dragon:cross_gate', { itemId, to: door.to });
            }
          });
        }
      });
    };
    if (ld) this.dragonHover(ld, undefined, journey);
    else journey();
  }

  private ignitePortal(id: string): void {
    const door = this.portalDoors.get(id);
    if (!door || door.fx.isLive) return;
    door.fx.bloom();
    this.widenDoor(door);
    this.refreshPortals();
  }

  /** Once lit, the whole FX is the door: the hit zone grows to cover the
   *  effect's own bounds (sized to Eleanor) — and only ever GROWS. A door whose
   *  authored rect is already wider than the glow (the Rune Circle) keeps it:
   *  shrinking to the FX would strand the painted stone outside its own tap. */
  private widenDoor(door: { fx: PortalFX; zone: Phaser.GameObjects.Zone }): void {
    const { width, height } = door.fx.hitSize();
    const w = Math.max(width, door.zone.width);
    const h = Math.max(height, door.zone.height);
    door.zone.setSize(w, h);
    const hit = door.zone.input?.hitArea as Phaser.Geom.Rectangle | undefined;
    if (hit) hit.setSize(w, h);
  }

  /**
   * A door the Keeper cannot walk through yet simply is not there.
   *
   * Enabled only when the destination is available AND the FX is lit — an
   * unlit door taking taps would be dead input on an invisible object, and a
   * lit door that refused would be worse. `syncPortalFx` keeps the two in
   * step, re-asked whenever availability can have changed.
   */
  private refreshPortals(): void {
    const open = new Set(this.ctx.systems.worlds.available().map((w) => w.id));
    for (const door of this.portalDoors.values()) {
      if (door.zone.input) door.zone.input.enabled = open.has(door.to) && door.fx.isLive;
    }
  }

  private createFogSprite(regionId: string, col: number, row: number): void {
    const { x, y } = gridToWorld(col, row);
    // The real authored level-blocker cloud (the same tile the world builder
    // paints), placed uniformly on the grid so neighbours overlap into one
    // seamless blanket. Anchor 0.5/0.62 puffs it up over the tile.
    const zoneScale = artScaleAt(this.ctx.state.world, col, row);
    const puff = this.add
      .image(x, y, 'cloud_tile')
      .setOrigin(0.5, 0.62)
      .setScale(zoneScale)
      .setDepth(DEPTHS.itemBase + y + 2)
      .setAlpha(0.995);
    puff.setData('regionId', regionId);
    // Hit area = just this tile's diamond, not the whole puffy frame —
    // otherwise the smoke drapes over (and steals input from) the active
    // tiles one row south. Hit-area coords are frame-local, so they stay the
    // game tile's — `setScale(zoneScale)` above already shrinks both the cloud
    // and its diamond to whatever tile the owning zone uses, and the authored
    // isle's zone reports 1, leaving this exactly the area it has always been.
    const ox = puff.displayOriginX;
    const oy = puff.displayOriginY;
    const diamond = new Phaser.Geom.Polygon([
      new Phaser.Geom.Point(ox, oy - TILE_H / 2),
      new Phaser.Geom.Point(ox + TILE_W / 2, oy),
      new Phaser.Geom.Point(ox, oy + TILE_H / 2),
      new Phaser.Geom.Point(ox - TILE_W / 2, oy)
    ]);
    puff.setInteractive({
      hitArea: diamond,
      hitAreaCallback: Phaser.Geom.Polygon.Contains,
      useHandCursor: true
    });
    puff.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!this.isTap(pointer)) return;
      this.onFogTapped(regionId, col, row);
    });
    // Slow rolling breath across the bank, phased by iso row.
    this.tweens.add({
      targets: puff,
      alpha: 0.9,
      scaleX: 1.02,
      scaleY: 1.035,
      duration: TIMINGS.fogPulsePeriodMs / 2,
      delay: ((col + row) % 6) * 230,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
    this.fog.set(`${col},${row}`, puff);
  }

  private buildEmitters(): void {
    this.burst = this.add
      .particles(0, 0, 'fx_ember', {
        speed: { min: 140, max: 420 },
        angle: { min: 0, max: 360 },
        gravityY: 460,
        lifespan: { min: 380, max: 680 },
        scale: { start: 0.95, end: 0 },
        alpha: { start: 1, end: 0 },
        blendMode: Phaser.BlendModes.ADD,
        emitting: false
      })
      .setDepth(DEPTHS.particles);
    this.sparks = this.add
      .particles(0, 0, 'fx_spark', {
        speed: { min: 220, max: 560 },
        angle: { min: 0, max: 360 },
        gravityY: 640,
        rotate: { min: 0, max: 360 },
        lifespan: { min: 500, max: 820 },
        scale: { start: 0.85, end: 0.1 },
        alpha: { start: 1, end: 0 },
        emitting: false
      })
      .setDepth(DEPTHS.particles);
    this.shells = this.add
      .particles(0, 0, 'fx_shell', {
        speed: { min: 180, max: 400 },
        angle: { min: 200, max: 340 },
        gravityY: 860,
        rotate: { min: 0, max: 360 },
        lifespan: { min: 550, max: 850 },
        scale: { start: 0.95, end: 0.45 },
        alpha: { start: 1, end: 0.2 },
        emitting: false
      })
      .setDepth(DEPTHS.particles);

    // Ambient ember motes rising off the lava seams — spanning the WHOLE
    // authored world (screenY reaches ~5100), not just the start terrace, so
    // every zone the camera frames has updrafts.
    const world = this.cameras.main.getBounds();
    this.ambientEmitters.push(
      this.add
        .particles(0, 0, 'fx_ember', {
          x: { min: world.x + 80, max: world.right - 80 },
          y: { min: 1240, max: Math.max(1520, world.bottom - 400) },
          speedY: { min: EMBER_MOTES.maxSpeedY, max: EMBER_MOTES.minSpeedY },
          speedX: { min: -EMBER_MOTES.driftX, max: EMBER_MOTES.driftX },
          lifespan: EMBER_MOTES.lifespanMs,
          scale: { start: EMBER_MOTES.minScale, end: 0 },
          alpha: { start: EMBER_MOTES.alpha * 0.8, end: 0 },
          frequency: this.ambientGap(420),
          blendMode: Phaser.BlendModes.ADD
        })
        .setDepth(DEPTHS.cliffs + 1)
    );
    this.ambientEmitters.push(
      this.add
        .particles(0, 0, 'fx_ember', {
          x: { min: world.x + 60, max: world.right - 60 },
          y: { min: 1400, max: Math.max(1580, world.bottom - 300) },
          speedY: { min: -64, max: -36 },
          speedX: { min: -20, max: 20 },
          lifespan: EMBER_MOTES.lifespanMs,
          scale: { start: EMBER_MOTES.maxScale, end: 0 },
          alpha: { start: EMBER_MOTES.alpha * 0.55, end: 0 },
          frequency: this.ambientGap(900),
          blendMode: Phaser.BlendModes.ADD
        })
        .setDepth(DEPTHS.particles)
    );
  }

  /* --------------------------- world atmosphere --------------------------- */

  /**
   * The layered "isle is alive" ambience (ATMOSPHERE in Constants), near → far:
   * ember-flies twinkling around the player's view and high mist sliding
   * across the floating platforms. Everything lives in WORLD space (the board
   * camera zooms, so screen-space layers would swim); the near layer tracks
   * `worldView` each frame instead.
   */
  private buildAtmosphere(): void {
    const A = ATMOSPHERE;
    const cam = this.cameras.main;

    // --- near: ember-flies. The emit zone is re-centred on worldView in
    // update(), so the flies always live where the player is looking.
    this.fireflyZone = new Phaser.Geom.Rectangle(cam.worldView.x, cam.worldView.y, cam.worldView.width, cam.worldView.height);
    this.ambientEmitters.push(
      this.add
        .particles(0, 0, 'fx_ember', {
          emitZone: { type: 'random', source: this.fireflyZone, quantity: 1 },
          lifespan: A.fireflies.lifespanMs,
          speed: { min: A.fireflies.speedMin, max: A.fireflies.speedMax },
          angle: { min: 0, max: 360 },
          scale: { min: A.fireflies.scaleMin, max: A.fireflies.scaleMax },
          // Sine bell over the life: 0 → peak → 0 — a slow twinkle, never a pop.
          alpha: { onUpdate: (_p, _k, t) => Math.sin(Math.PI * t) * A.fireflies.alphaPeak },
          tint: A.fireflies.tint,
          frequency: this.ambientGap(A.fireflies.frequency),
          blendMode: Phaser.BlendModes.ADD
        })
        .setDepth(DEPTHS.particles)
    );

    // --- mid-far: low clouds drifting beneath the platforms (altitude!).
    const world = cam.getBounds();
    if (this.textures.exists('cloud_tile')) {
      const wispCount = Math.max(1, Math.round(A.wisps.count * graphics.profile.ambient));
      for (let i = 0; i < wispCount; i++) {
        const t = i / Math.max(1, wispCount - 1);
        const y = Phaser.Math.Linear(world.y + world.height * 0.3, world.bottom - 300, t);
        const wisp = this.add
          .image(0, y, 'cloud_tile')
          .setScale(Phaser.Math.FloatBetween(A.wisps.scale[0], A.wisps.scale[1]))
          .setAlpha(Phaser.Math.FloatBetween(A.wisps.alpha[0], A.wisps.alpha[1]))
          .setTint(A.wisps.tint)
          .setDepth(A.wisps.depth); // high mist between the camera and the isles
        const cross = Phaser.Math.Between(A.wisps.crossMs[0], A.wisps.crossMs[1]);
        const fromX = world.x - 600;
        const toX = world.right + 600;
        wisp.x = Phaser.Math.Linear(fromX, toX, Math.random()); // start mid-journey
        this.tweens.add({
          targets: wisp,
          x: toX,
          duration: ((toX - wisp.x) / (toX - fromX)) * cross,
          onComplete: () => {
            wisp.x = fromX;
            this.tweens.add({ targets: wisp, x: toX, duration: cross, repeat: -1, onRepeat: () => (wisp.x = fromX) });
          }
        });
        this.tweens.add({
          targets: wisp,
          y: y + A.wisps.bobPx,
          duration: Phaser.Math.Between(9000, 14000),
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        });
      }
    }
  }

  /**
   * The reticle that marks the cell a dragged item is hovering over.
   *
   * Four corner brackets on the tile diamond over a breath of fill — the frame
   * an action game puts round a target, rather than the filled slab this used to
   * be (see `DRAG.cellHighlight*` for why). Drawn once at the authored tile's
   * size and re-scaled per zone by `updateDrag`, so it costs nothing per frame.
   *
   * THREE of them now, one per drop verb (`DRAG.mergeColor`/`gatherColor`):
   * painted once each, and `updateDrag` swaps which is visible. The swap is the
   * whole cost of the reticle knowing the verb — no per-frame redraw, and the
   * frame keeps its geometry so only the COLOUR says what changed.
   */
  private buildDragCell(): void {
    const paint = (color: number, fillAlpha: number): Phaser.GameObjects.Graphics => {
      const g = this.add.graphics().setDepth(DEPTHS.tileHighlight).setVisible(false);
      // The diamond's vertices, clockwise from the top.
      const v = [
        { x: 0, y: -TILE_H / 2 },
        { x: TILE_W / 2, y: 0 },
        { x: 0, y: TILE_H / 2 },
        { x: -TILE_W / 2, y: 0 }
      ];
      g.fillStyle(color, fillAlpha);
      g.fillPoints(v.map((p) => new Phaser.Geom.Point(p.x, p.y)), true);
      // Each corner is TWO arms: one reaching along the edge to the previous
      // vertex, one to the next. Drawn as separate strokes rather than one path so
      // the round join sits at the vertex and the arms end square.
      g.lineStyle(DRAG.cellBracketWidth, color, DRAG.cellHighlightAlpha);
      const t = DRAG.cellBracketSpan;
      for (let i = 0; i < v.length; i++) {
        const c = v[i]!;
        for (const n of [v[(i + 1) % v.length]!, v[(i + 3) % v.length]!]) {
          g.beginPath();
          g.moveTo(c.x, c.y);
          g.lineTo(c.x + (n.x - c.x) * t, c.y + (n.y - c.y) * t);
          g.strokePath();
        }
      }
      return g;
    };
    this.dragCells = {
      move: paint(DRAG.cellHighlightColor, DRAG.cellFillAlpha),
      merge: paint(DRAG.mergeColor, DRAG.verbFillAlpha),
      gather: paint(DRAG.gatherColor, DRAG.verbFillAlpha),
      refuse: paint(DRAG.refuseColor, DRAG.cellFillAlpha)
    };
    this.dragCell = this.dragCells.move;
  }

  /** Show the reticle that says `verb`, retiring whichever was up. Every other
   *  reader keeps talking to `this.dragCell`, so the swap is invisible to them. */
  private setDragVerb(verb: DropVerb): void {
    const next = this.dragCells[verb];
    if (next === this.dragCell) return;
    this.dragCell.setVisible(false);
    this.dragCell = next;
  }

  /* ----------------------------- input ------------------------------ */

  private isTap(pointer: Phaser.Input.Pointer): boolean {
    return (
      pointer.getDistance() <= TAP_MAX_DISTANCE_PX + 2 && pointer.getDuration() <= TAP_MAX_MS
    );
  }

  private wireInput(): void {
    this.input.dragDistanceThreshold = TAP_MAX_DISTANCE_PX;
    this.wireCameraNav();

    this.input.on(
      Phaser.Input.Events.DRAG_START,
      (_pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
        if (!(obj instanceof BoardItem)) return;
        this.dragFrom = { col: obj.col, row: obj.row };
        // A picked-up piece stops leaning THIS frame: the lift is about to tween
        // the same art the lean offsets, and a lean carried into the player's
        // hand reads as the piece pulling sideways against the finger.
        this.stopLean(obj.itemId, true);
        obj.setData('dragged', true);
        obj.liftForDrag();
        // The sprite EASES toward this target in update() (Fairyland-style
        // weighted follow); seed it at the current pos so it doesn't jump.
        this.dragSprite = obj;
        this.dragTarget.x = obj.x;
        this.dragTarget.y = obj.y;
        // Through the live resolver rather than a bare setVisible(true): the
        // reticle must come up already knowing its cell AND its verb — shown
        // blind it spends a frame at the last drag's cell in the last drag's
        // colour.
        this.updateDrag(0);
      }
    );
    this.input.on(
      Phaser.Input.Events.DRAG,
      (
        _pointer: Phaser.Input.Pointer,
        obj: Phaser.GameObjects.GameObject,
        dragX: number,
        dragY: number
      ) => {
        if (!(obj instanceof BoardItem)) return;
        this.dragTarget.x = dragX;
        this.dragTarget.y = dragY - 24;
      }
    );
    this.input.on(
      Phaser.Input.Events.DRAG_END,
      (pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
        if (!(obj instanceof BoardItem)) return;
        // THE GESTURE IS OVER — put the drag furniture away BEFORE asking
        // whether there is a drop to resolve.
        //
        // These two lines used to sit behind `!this.dragFrom`, so any path that
        // cleared the origin mid-gesture left them undone: `dragSprite` stayed
        // armed, and `update()` re-showed the highlight diamond every frame at
        // the last cell it saw. The result was a warm 0xffd27a diamond parked
        // under the piece for the rest of the session — read on the board as a
        // second shadow beneath every dragon, because a dragon is the piece
        // most often dragged (to a House, through a gate) and the paths that
        // handle those are exactly the ones that clear `dragFrom` early.
        //
        // Nothing below needs the furniture, and there is no drop for which
        // leaving it up is correct — so it is unconditional, not another
        // branch to keep in step.
        this.dragSprite = null;
        this.dragCell.setVisible(false);
        if (!this.dragFrom) return;
        // WYSIWYG: drop into the cell the reticle showed (the dragged item's
        // tracked position), NOT the raw pointer — the two differ by the
        // grab offset, so pointer-based drops could land one tile off and
        // bounce home even though the item hovered a free tile. `resolveDrop`
        // is the SAME resolver the reticle reads every frame — feet cell first,
        // then a MATCHING piece's art under the carry point — so a drop the
        // frame just painted as a merge cannot quietly resolve to the free
        // cell behind the tall piece it was painted on.
        // Open sky resolves to null, and a piece let go over the clouds goes
        // home: naming its OWN cell makes the dispatch below a same-tile drop,
        // which MergeSystem already answers with `item:move_bounced`. The
        // feed / hire / gate branches under this are unaffected — they match on
        // the dropped ART's bounds as well as on a cell, so a dragon released
        // on a House's roof is still a hire even when its feet are over air.
        const to = this.resolveDrop(obj)?.cell ?? this.dragFrom;

        // Food dragged onto a DRAGON → feed it. The mirror of the gesture just
        // below (a dragon dragged onto a House), so the board has one verb for
        // "put this on that" rather than two that look alike and behave apart.
        // Checked FIRST: a Moss Tuft is not a dragon, so the two branches can
        // never both match, and reading the food case first keeps the dragon
        // case's `wearsRigTier` guard about the thing being DRAGGED.
        if (
          isDragonFood(obj.chain, obj.tier) &&
          (this.tutorialDone || this.allow.feed) &&
          this.tryFeedDrop(obj, to, pointer)
        ) {
          this.dragFrom = null;
          this.time.delayedCall(60, () => obj.setData('dragged', false));
          return;
        }

        // Dragon dragged onto a passive generator (House) → start working directly.
        // wearsRigTier — an actual DRAGON tier (base/adult generator tiers of the
        // ember/emerald chains), never the chain's merge pieces: a Ruby or Egg
        // shares the dragon's chain but can't be hired.
        // No restRemaining clause here: a shift-rester must be CAUGHT by this
        // block, not fall past it — falling through to `drag:dropped` would
        // let the drop MOVE the sleeper (the cell behind a tall House is often
        // free). The sleep check inside cancels her home instead.
        if (this.wearsRigTier(obj.chain, obj.tier) && (this.tutorialDone || this.allow.dragonWork)) {
          // Match by CELL, or by the drop point landing anywhere on the
          // generator's ART: the House is ~2.5 iso rows tall, so dropping onto
          // its visible body resolves to the cell BEHIND its tile and a
          // cell-only match silently bounced the dragon home.
          const tgt = [...this.itemSprites.values()].find((s) => {
            if (s.itemId === obj.itemId) return false;
            const cfg = this.generatorConfigFor(s.chain, s.tier);
            if (!cfg || cfg.tappable !== false || DRAGON_RIGS[s.chain]) return false;
            if (s.col === to.col && s.row === to.row) return true;
            return s.getBounds().contains(pointer.worldX, pointer.worldY);
          });
          if (tgt) {
            const home = gridToWorld(this.dragFrom.col, this.dragFrom.row);
            this.dragFrom = null;
            this.time.delayedCall(60, () => obj.setData('dragged', false));
            // This path RETURNS before `drag:dropped`, so nothing else will ever
            // undo liftForDrag(): without this the dragon keeps the drag scale
            // and its lifted drag-shadow forever after the work trip — it reads
            // as a dragon floating over a shadow that isn't its own.
            obj.settleFromDrag();
            // A SLEEPER cannot be put to work: the drop cancels outright — the
            // curled painting glides back to its own tile (the move_bounced
            // tween, minus the system round-trip) and says why. Falling through
            // to `drag:dropped` instead could MOVE her (the cell behind a tall
            // House is often free), and a dragon that wakes up somewhere else
            // because you tried to employ her reads as a glitch, not a refusal.
            // Rest is checked on its own (a HUNGRY rester's mood reads 'hungry',
            // not 'asleep') so a worn-out dragon can never be re-hired either.
            const resting = this.ctx.systems.jobs.restRemaining(obj.itemId) > 0;
            if (resting || this.ctx.systems.dragonLife.moodOf(obj.itemId) === 'asleep') {
              this.floatText(tgt.x, tgt.y - 190, resting ? 'Resting…' : 'Fast asleep…', PALETTE.cream);
              this.tweens.add({
                targets: obj,
                x: home.x,
                y: home.y,
                duration: TIMINGS.dragReturn,
                ease: 'Back.easeOut',
                onComplete: () => obj.settleDepth()
              });
              return;
            }
            this.startDragonWork(obj, home, tgt); // work the EXACT house it was dropped on
            return;
          }
        }

        // Dragon dragged onto an OPEN DOOR → it goes through, and stays through.
        //
        // The crossing itself has existed since the gate flight: `flyThroughGate`
        // arcs it into the light and `dragon:cross_gate` seats it on the far
        // board. What was missing was any way for the PLAYER to ask for one — it
        // fired once, on the door's own ignition, and a dragon that had gone
        // ahead could never be called back. So the far side read as a cage.
        //
        // Same "put this on that" verb as feeding and hiring, so it needs no
        // teaching, and the same art-bounds match: the door is a rectangle over
        // a painted archway, and asking the player to hit its cell would be
        // asking them to aim at something they cannot see.
        if (this.wearsRigTier(obj.chain, obj.tier) && this.tutorialDone) {
          const door = this.openDoorUnder(pointer, obj);
          if (door) {
            const home = gridToWorld(this.dragFrom.col, this.dragFrom.row);
            this.dragFrom = null;
            this.time.delayedCall(60, () => obj.setData('dragged', false));
            obj.settleFromDrag();
            // A sleeper is not sent on a journey — the same refusal the House
            // gives, for the same reason: the drop must not quietly MOVE her to
            // whatever cell is behind the arch.
            const resting = this.ctx.systems.jobs.restRemaining(obj.itemId) > 0;
            if (resting || this.ctx.systems.dragonLife.moodOf(obj.itemId) === 'asleep') {
              this.floatText(
                obj.x,
                obj.y - 190,
                resting ? 'Resting…' : 'Fast asleep…',
                PALETTE.cream
              );
              this.tweens.add({
                targets: obj,
                x: home.x,
                y: home.y,
                duration: TIMINGS.dragReturn,
                ease: 'Back.easeOut',
                onComplete: () => obj.settleDepth()
              });
              return;
            }
            this.flyThroughGate(door, obj.itemId);
            return;
          }
        }

        this.ctx.bus.emit('drag:dropped', {
          itemId: obj.itemId,
          from: this.dragFrom,
          to
        });
        this.dragFrom = null;
        this.time.delayedCall(60, () => obj.setData('dragged', false));
      }
    );

    /**
     * A HELD DRAGON FLIES: the wings open on the pick-up, the cruise loop runs
     * for as long as it is held, the wing-fold plays it down onto the tile.
     *
     * Registered HERE, after the two handlers above, and that ordering is the
     * whole reason this block is at the end of `wireInput` rather than in the
     * camera wiring where the merge first put it. Both directions depend on it:
     * a drop that starts a WORK flight has already set `busy` by the time this
     * runs, so the dragon keeps its own outbound arc instead of being landed
     * into it; and `item:moved` has already been emitted, which is what lets
     * the settle read "this dragon is in the air" and glide it home.
     *
     * A sleeping dragon is dragged as its curled painting — no flight — and
     * `dragonLand` is called unconditionally on release rather than only when a
     * phase is running, because a breed with no pushed fly clip flew on the
     * rig's hover preset and had nothing to bring it back to rest.
     */
    this.input.on(
      Phaser.Input.Events.DRAG_START,
      (_pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
        if (!(obj instanceof BoardItem)) return;
        const ld = this.liveDragons.get(obj.itemId);
        if (ld && !ld.busy && ld.mood !== 'asleep') this.dragonHover(ld);
      }
    );
    this.input.on(
      Phaser.Input.Events.DRAG_END,
      (_pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
        if (!(obj instanceof BoardItem)) return;
        const ld = this.liveDragons.get(obj.itemId);
        if (ld && !ld.busy && ld.mood !== 'asleep') this.dragonLand(ld);
      }
    );
  }

  /**
   * Put a released piece back on its cell — and a released DRAGON down.
   *
   * An inanimate piece snaps home with the overshoot that sells its weight. An
   * animal that is still beating its wings must not: it would arrive before the
   * fold had started and finish the animation standing on the tile, which reads
   * as flapping AFTER landing rather than landing. So a dragon in the air
   * glides instead — over `dropGlideMs`, on a Sine ease, no overshoot, because
   * a bounce at the end of a descent is a stumble.
   *
   * The two motions are timed against each other, not merely both slowed: the
   * fold (~1.3 s at `landingRate`) starts on the release and the glide (~0.85 s)
   * ends inside it, so the wings are still closing as the feet touch down.
   */
  private settleAfterDrag(sprite: BoardItem, x: number, y: number): void {
    const airborne = this.liveDragons.get(sprite.itemId)?.flightPhase != null;
    this.tweens.add({
      targets: sprite,
      x,
      y,
      duration: airborne ? DRAGON_ANIM.dropGlideMs : TIMINGS.dragReturn,
      ease: airborne ? 'Sine.easeInOut' : 'Back.easeOut',
      onComplete: () => sprite.settleDepth()
    });
    sprite.settleFromDrag();
  }

  /**
   * A good was dropped somewhere — is a dragon standing there, and did it eat?
   *
   * Returns true only when the piece was actually EATEN, because that is what
   * tells DRAG_END to stop: a refusal has to fall through to the ordinary drop
   * so the piece settles on the board instead of vanishing. Same
   * check-the-record-moved contract as a gift and a nest offering — the board
   * consumes nothing it was not given credit for.
   */
  private tryFeedDrop(obj: BoardItem, to: TilePos, pointer: Phaser.Input.Pointer): boolean {
    const dragons = this.ctx.systems.dragons;
    // Cell match OR the drop landing anywhere on the dragon's art: a rig-hosted
    // dragon is drawn well outside its own tile, and a cell-only test made the
    // player aim at its feet.
    const target = [...this.itemSprites.values()].find((s) => {
      if (s.itemId === obj.itemId) return false;
      const state = this.ctx.state.items.get(s.itemId);
      if (!state || !dragons.isBoardDragon(state)) return false;
      if (s.col === to.col && s.row === to.row) return true;
      return s.getBounds().contains(pointer.worldX, pointer.worldY);
    });
    if (!target) return false;

    // ASLEEP: it will not eat, and the meal must not be left on its tile
    // either — the piece goes home exactly where it was picked up. Returning
    // TRUE claims the drop: falling through to the ordinary drop would drop
    // the food on the board (or merge it) as if the gesture had been a move,
    // when what the player did was offer a meal and get refused.
    if (this.ctx.systems.dragonLife.sleepKindOf(target.itemId)) {
      const from = this.dragFrom ? gridToWorld(this.dragFrom.col, this.dragFrom.row) : null;
      obj.settleFromDrag();
      if (from) {
        this.tweens.add({
          targets: obj,
          x: from.x,
          y: from.y,
          duration: TIMINGS.dragReturn,
          ease: 'Back.easeOut',
          onComplete: () => obj.settleDepth()
        });
      }
      this.floatText(target.x, target.y - 190, 'Fast asleep…', PALETTE.cream);
      return true;
    }

    const before = dragons.careOf(target.itemId).meals;
    this.ctx.bus.emit('ui:feed_dragon_requested', {
      itemId: target.itemId,
      chain: obj.chain,
      tier: obj.tier
    });
    if (dragons.careOf(target.itemId).meals <= before) {
      // It turned its head away. Bounce the piece home and say so where the
      // player is looking, rather than in a corner of the HUD.
      obj.settleFromDrag();
      this.floatText(target.x, target.y - 190, 'No thanks!', PALETTE.cream);
      return false;
    }
    obj.settleFromDrag();
    this.ctx.bus.emit('board:consume_items', { itemIds: [obj.itemId], reason: 'delivered' });
    // Feeding is the one moment the player is unambiguously looking at ONE
    // dragon, so it also selects it — the readout they are about to watch move
    // is already showing the animal they just fed. Never a toggle here: a second
    // helping must not put the readout away mid-meal.
    this.selectSubject('dragon', String(target.itemId), false);
    return true;
  }

  /** It ate: a warm pulse and a little burst over the dragon's head. */
  /**
   * She ate. A FAVOURITE is a different event from a meal, and has to look like
   * one: every breed has exactly one, it is the only food that moves trust two
   * hearts in a day instead of one, and a player who is not told that in the
   * moment has no way to learn it. So the favourite gets the flare, the longer
   * celebration and her name said out loud; anything else gets the quiet chirp.
   */
  private feedFlourish(target: BoardItem, favourite = false): void {
    this.glowFlash(
      target.x,
      target.y - 60,
      favourite ? PALETTE.lava : PALETTE.goldAccent,
      favourite ? 0.85 : 0.55,
      favourite ? 1.6 : 1.15
    );
    this.sparks.explode(favourite ? 26 : 12, target.x, target.y - 80);
    if (favourite) {
      this.burst.explode(14, target.x, target.y - 70);
      this.playBeatFX('favourite', target.x, target.y);
      const name = this.ctx.systems.dragons.nameOf(target.itemId);
      this.floatText(target.x, target.y - 210, name ? `${name} adores it!` : 'Adores it!', PALETTE.goldAccent);
    }
    // Same beat as waking a rested dragon: hand the idle roll a hover span and
    // let it come back to idle on its own, rather than pinning an animation the
    // state machine will fight over.
    const ld = this.liveDragons.get(target.itemId);
    if (ld?.mood === 'asleep') {
      this.stirSleeper(ld); // fed in her sleep — the painting answers, not the rig
    } else if (ld && !ld.busy) {
      this.dragonHover(ld);
      ld.player?.playFace(1); // a chirp for the meal
      ld.mode = 'hover';
      const span = ld.calm ? DRAGON_ANIM.adultCelebrateMs : DRAGON_ANIM.celebrateMs;
      ld.remainMs = favourite ? span * 2 : span;
    }
  }

  /**
   * Exponential-smoothing follow + target-cell highlight for the live drag.
   *
   * THE DIAMOND MAY NEVER PROMISE GROUND THAT ISN'T THERE. It used to be placed
   * at `gridToWorld(worldToGrid(point))` — the ambient projection, which is
   * deliberately unbounded — so dragging out over the clouds drew a perfectly
   * crisp slot in the open sky, and the piece then flew home from a tile the
   * game had just offered. On the zones adopted from the map editor it was
   * wrong a second way: those islands carry their own tile size, and a diamond
   * cut to the authored isle's pitch never matched the slabs underneath it.
   *
   * So the target is resolved through the world (which prefers a zone with real
   * ground), drawn at that zone's own scale, and hidden outright when the cell
   * is not somewhere a piece can actually stand — fogged ground included, since
   * a cloud is not a slot either. Nothing offered, nothing taken away: the drop
   * itself still resolves the same address, so what you see is where it lands.
   */
  private updateDrag(delta: number): void {
    const s = this.dragSprite;
    if (!s) return;
    const k = 1 - Math.exp(-delta / DRAG.followTau);
    s.x += (this.dragTarget.x - s.x) * k;
    s.y += (this.dragTarget.y - s.y) * k;
    const hover = this.resolveDrop(s);
    const cell = hover?.cell ?? null;
    // The piece's OWN shadows answer to the same question as the diamond: over
    // open sky there is no floor to darken, so it carries none (BoardItem
    // `setOverGround`). One test, one answer, three things obeying it.
    const live = cell !== null && this.ctx.state.isTileActive(cell.col, cell.row);
    s.setOverGround(live);
    if (!cell || !live) {
      this.dragCell.setVisible(false);
      return;
    }
    // THE RETICLE KNOWS THE VERB. With the magnet gone, the one question
    // mid-drag is "am I over a matching piece, and is its cluster enough?" —
    // and the frame answers it with the SAME calls MergeSystem will make on the
    // drop, `verdictOnto` and `gatherSeat`, so it can promise neither a fusion
    // nor a landing the system would refuse.
    //
    // `gatherSeat` is in here for the same reason it is in the tutorial's hand:
    // the verdict alone says a gather is a merge question, not that the board
    // has room to answer it. A match walled in on all four sides bounces, and a
    // pink frame over it would be an invitation to a gesture that does nothing.
    let verb: DropVerb = 'move';
    const held = this.ctx.state.items.get(s.itemId);
    if (held) {
      const target = hover?.target;
      if (target) {
        const verdict = verdictOnto(this.ctx.state, this.ctx.data.chains, held, target);
        verb =
          verdict.kind === 'merge'
            ? 'merge'
            : verdict.kind === 'gather' && gatherSeat(this.ctx.state, held, target)
              ? 'gather'
              : 'refuse';
      } else {
        // No match under the piece: the cell is either free (a plain move) or
        // held by something this piece cannot stack on.
        const standing = this.ctx.state.itemAt(cell.col, cell.row);
        if (standing && standing.id !== held.id) verb = 'refuse';
      }
    }
    this.setDragVerb(verb);
    const { x, y } = worldPointOf(this.ctx.state.world, cell.col, cell.row);
    this.dragCell
      .setPosition(x, y)
      .setScale(artScaleAt(this.ctx.state.world, cell.col, cell.row))
      .setVisible(true);
  }

  /**
   * The address under the dragged item — the ONE resolver the highlight and the
   * drop both read, so the diamond cannot show one cell and the drop take another.
   *
   * The downward bias moves the sample from where the art is CARRIED to where it
   * would STAND, so a piece lands on the cell its feet are over rather than the
   * one its middle happens to cross. It used to be a flat 24 px, which is a
   * quiet assumption that every piece is the same height — and the roster is
   * not. A Dew Drop renders 48 px tall against a median of 85, so 24 px was
   * half its body: the sample fell clear of the art and resolved the cell BELOW
   * the one under the player's finger. Dropping a Dew Drop on a Dew Drop
   * therefore missed, over and over, while the same gesture worked everywhere
   * else — which is exactly the "it will not merge" it was reported as.
   *
   * Read off the piece instead, so the bias means the same THING at every size
   * and no future art can inherit the bug by being short.
   *
   * The DRAGGED sprite is a parameter, not `this.dragSprite`: DRAG_END puts the
   * drag furniture away (dragSprite included) before it resolves the drop, and
   * reading the field here quietly swapped the height-scaled bias for the flat
   * cap on the one call that decides where the piece lands — the reticle and
   * the drop could disagree by a cell for exactly the short pieces the bias
   * exists for.
   */
  private dragSamplePoint(dragged: BoardItem): { x: number; y: number } {
    const height = dragged.artHitRect().height;
    const bias =
      height > 0 ? Math.min(DRAG.dropBiasMaxPx, height * DRAG.dropBiasOfHeight) : DRAG.dropBiasMaxPx;
    return { x: this.dragTarget.x, y: this.dragTarget.y + bias };
  }

  private dropCellUnderDrag(dragged: BoardItem): TilePos | null {
    const feet = this.dragSamplePoint(dragged);
    // `groundCellAtWorldPoint`, NOT `cellAtWorldPoint`: the latter falls back to
    // the authored Emberkeep lattice when no zone owns the point, and in every
    // other world that fallback lands on an index a real zone owns. A drag out
    // over the Borealis sky was therefore told it was standing on an island
    // 2700px away — which is what kept the piece's shadow lit over open cloud.
    // Null is the honest answer for open sky, and both callers below take it.
    return groundCellAtWorldPoint(this.ctx.state.world, feet.x, feet.y);
  }

  /**
   * Where the carried piece is over — the ONE answer the reticle and the drop
   * both read, so whatever cell the reticle frames is the cell the drop names.
   *
   * Under drop-onto-only, "dropping on" a piece has to mean ON THE PIECE THE
   * PLAYER SEES, and the feet-cell alone does not: a House is ~2.5 iso rows
   * tall and an adult dragon taller, so a piece laid squarely on their picture
   * resolves to the free cell BEHIND them and the drop that read as "onto"
   * became a plain move. The feed/hire/door branches learnt this one by one
   * (each matches by cell OR art bounds); this is the same leniency for the
   * merge target itself.
   *
   * MATCHING pieces only, deliberately. A stranger's art must not pull the drop
   * onto its cell — feeding, hiring and the gate keep their own pre-emption,
   * and a plain drop on a stranger still resolves to the ground cell and
   * bounces. Ties between overlapping matches go to the topmost by depth,
   * which is the sprite the player actually sees (the same law the tap path
   * follows). Opaque pixels only (`hitsOpaqueArt`), so a tall frame's empty
   * corner never claims a drop that was aimed at the ground beside it.
   */
  private resolveDrop(dragged: BoardItem): DropHover | null {
    const state = this.ctx.state;
    const held = state.items.get(dragged.itemId);
    const cell = this.dropCellUnderDrag(dragged);
    if (cell && held) {
      const standing = state.itemAt(cell.col, cell.row);
      if (standing && standing.id !== held.id && matches(held, standing)) {
        return { cell, target: standing };
      }
    }
    if (held) {
      const feet = this.dragSamplePoint(dragged);
      let best: { sprite: BoardItem; state: BoardItemState } | null = null;
      for (const s of this.itemSprites.values()) {
        if (!s.active || s.itemId === dragged.itemId) continue;
        if (best && s.depth <= best.sprite.depth) continue;
        const other = state.items.get(s.itemId);
        if (!other || !matches(held, other)) continue;
        if (!this.artContainsWorldPoint(s, feet.x, feet.y)) continue;
        best = { sprite: s, state: other };
      }
      if (best) {
        return { cell: { col: best.state.col, row: best.state.row }, target: best.state };
      }
    }
    return cell ? { cell, target: null } : null;
  }

  /** Does (wx,wy) land on this sprite's OPAQUE art? World point → hit-area
   *  space by the same transform the input plugin uses (BoardItems have no
   *  parent container and never rotate, so the inverse is two divides), then
   *  the rect + per-pixel pair every tap already answers to. */
  private artContainsWorldPoint(s: BoardItem, wx: number, wy: number): boolean {
    if (s.scaleX === 0 || s.scaleY === 0) return false;
    const hx = (wx - s.x) / s.scaleX + s.displayOriginX;
    const hy = (wy - s.y) / s.scaleY + s.displayOriginY;
    return Phaser.Geom.Rectangle.Contains(s.artHitRect(), hx, hy) && s.hitsOpaqueArt(hx, hy);
  }

  /* ---------------------- the lean (MERGE_READY) --------------------- */

  /**
   * THE LEAN — a complete cluster showing it wants finishing (`MERGE_READY`).
   *
   * The old board fused three-in-a-row by itself; this one waits for the drop,
   * and the lean is how it says so: every member but the centre eases toward
   * the centre and back. The clusters come from `readyClusters` — the same rule
   * module MergeSystem decides with — so a leaning cluster is EXACTLY one that
   * a single drop onto its centre would fuse, never a suggestion the system
   * would refuse.
   *
   * ONE CLUSTER AT A TIME, IN TURN. Three Eggs and three Gems both complete is
   * two things the board wants to say, and saying them at once is saying
   * neither: the eye reads a board that shivers rather than a group that
   * belongs together. So the ready clusters take turns — centre-id order, one
   * pulse each, `MERGE_READY.periodMs` apart — and while it is the Eggs' turn
   * the Gems stand perfectly still. With one cluster on the board this is
   * indistinguishable from a steady pulse, which is what it should be.
   *
   * Called on every board change (moved/spawned/removed/merged, a load, wake
   * from doze), on the 240 ms housekeeping tick, and when the turn passes. The
   * tick is not a luxury: a merge's output sprite is acquired a beat AFTER
   * `item:merged`, a landing piece is still mid-glide when `item:moved` fires,
   * and the tutorial hand starts and stops without a board event — all three
   * heal here, because starting a lean is gated on the sprite standing still
   * and the gate is re-asked four times a second.
   *
   * The lean runs during the tutorial too (the board teaching is wanted from
   * the first pair on screen) — except on the piece the tutorial hand is
   * animating from, which already bounces under UIScene's hand.
   */
  private syncReadyLeans(): void {
    // A pooled sprite reused under a stale entry: the tween died with
    // `release()`, so only the bookkeeping is left to drop.
    for (const [id, entry] of this.leans) {
      if (this.itemSprites.get(id) !== entry.sprite || !entry.sprite.active) this.leans.delete(id);
    }
    // A standing lean on a piece the tutorial hand has since taken eases home;
    // it does not stand the rest of its cluster down.
    for (const [id, entry] of [...this.leans]) {
      if (!entry.returning && this.leanExcluded(entry.sprite)) this.stopLean(id, false);
    }
    // In doze the board is a still painting — the lean stops with the rest of
    // the ambience, and an empty ready-set is what routes every standing lean
    // through the ease-home below. Unless a HAND is up: doze arrives at 45 s of
    // stillness and the hint's first offer at 10 s, so the board would go quiet
    // underneath its own standing invitation while the hand went on bouncing.
    // The lean is ambience right up until it is the thing being said.
    const clusters = this.leanDozing && !this.hintShown
      ? []
      : readyClusters(this.ctx.state, this.ctx.data.chains, this.ctx.state.items.values())
          // A cluster with a member in the player's hand, in mid-crossing or
          // asleep is not a cluster to point at: the board's state still lists
          // it, but what is on screen is one piece somewhere else and the rest
          // leaning at where it used to be. Vetoed WHOLE — half a gesture aimed
          // at a piece that is not there is worse than none.
          .filter((c) => !c.members.some((m) => this.leanVetoed(m.id)))
          // Oldest first, and it KEEPS the floor: see below.
          .sort((a, b) => a.centre.id - b.centre.id);
    // DURING THE TUTORIAL THE BEAT DECIDES, and when the beat is about nothing
    // on the board NOTHING leans — see `tutorialFocus`.
    // Same gate as the idle hint's `lessonRunning`, and for the same reason: a
    // player who left the isle mid-tutorial (the ruby teleport) still has
    // `tutorialDone` false for the rest of the save, and the lean must behave
    // like a free board's everywhere the walkthrough is not on screen.
    const teaching =
      !this.tutorialDone && this.ctx.state.worldId === WORLD_ID && !!this.tutorialStep;
    // Outside it, a HAND that is up gets the floor for the same reason: the
    // board must not strain at one cluster while the pointer names another.
    const active = teaching
      ? this.tutorialFocus(clusters)
      : (clusters.find((c) => this.hintTouches(c)) ?? clusters[0] ?? null);
    // THE ASKED MOVE. Whatever the game is currently asking the player to carry
    // — the tutorial beat's own hand, or the idle hint's first step — strains
    // toward the cell it is being sent to. It is the same gesture as a
    // cluster's lean and it is deliberately not a different one: one board, one
    // way of saying "there".
    const asked = this.askedMove();
    // The asked piece leans toward ITS destination, not toward the centre, so
    // it is taken out of the cluster's set and given its own ask. (Usually the
    // two agree — a finished cluster's hint drops a leaf on the centre — but
    // when the plan's first step is a gather onto free ground they do not, and
    // the piece must point where it is actually going.)
    // The asked piece leans toward ITS destination, not toward the centre, so it
    // is taken out of the cluster's set and given an ask of its own. (Usually
    // the two agree — a finished cluster's hint drops a leaf on the centre —
    // but when the plan's first step is a gather onto free ground they do not,
    // and the piece must point where it is actually going.)
    const leaders = active
      ? active.members.filter((m) => m.id !== active.centre.id && m.id !== asked?.id)
      : [];
    // TWO ASKS, NOT ONE SET. They are separate sentences: "carry this one
    // there" and "these are pulling together". Each starts as a unit — a
    // cluster's members must be in phase with each other or three pieces read
    // as three fidgets — but neither waits on the other. Joined, one asleep or
    // half-landed piece on either side silenced the whole board.
    const centre = active ? { col: active.centre.col, row: active.centre.row } : null;
    const boostedCluster = this.hintTouches(active) || (teaching && !!active);
    const groups: LeanAsk[][] = [];
    if (asked) groups.push([{ id: asked.id, to: asked.to, boosted: true }]);
    if (centre && leaders.length > 0) {
      groups.push(leaders.map((m) => ({ id: m.id, to: centre, boosted: boostedCluster })));
    }

    const wanted = new Set(groups.flat().map((a) => a.id));
    // Everyone else eases home. Gently — a cluster snapping upright the moment
    // a neighbour moves reads as a glitch, not as the board standing down.
    for (const id of [...this.leans.keys()]) if (!wanted.has(id)) this.stopLean(id, false);

    for (const group of groups) {
      // Already up, pointing where the ask points, at the volume it asks for.
      if (group.every((a) => this.leanFresh(a))) continue;
      // ALL OR NONE, within the group. Starting members one at a time as each
      // happened to come to rest is what left a row with one end straining and
      // the other sitting there; the 240 ms heal asks again until every member
      // can go together.
      if (!group.every((a) => this.leanReady(a.id))) continue;
      for (const a of group) this.stopLean(a.id, true);
      for (const a of group) this.startLean(a.id, a.to, a.boosted);
    }
  }

  /** The identity of a lean as DRAWN: where the piece stood, where it was sent,
   *  and how loudly. Everything `startLean` reads to compute the vector, and so
   *  exactly what has to match for a standing lean to still be the right one. */
  private leanAimOf(col: number, row: number, ask: LeanAsk): string {
    return `${col},${row}>${ask.to.col},${ask.to.row}@${ask.boosted ? 1 : 0}`;
  }

  /** Is this ask already on screen, correctly? A lean easing home is never
   *  fresh — it is on its way to zero, and an ask that still wants it needs it
   *  drawn again rather than left to finish dying. */
  private leanFresh(ask: LeanAsk): boolean {
    const entry = this.leans.get(ask.id);
    const sprite = this.itemSprites.get(ask.id);
    if (!entry || !sprite || entry.returning) return false;
    return entry.aim === this.leanAimOf(sprite.col, sprite.row, ask);
  }

  /**
   * THE MOVE THE GAME IS CURRENTLY ASKING FOR, as a piece and a destination
   * cell — the tutorial beat's hand while a lesson is on screen, otherwise the
   * idle hint's first step. Null when nothing is being asked, or when the ask
   * is not a board drag at all (a UI target, a fog region, a tap beat with only
   * an arrow).
   *
   * This is what replaced the hop. A piece the player is being told to carry
   * leans toward where it is going, exactly like a cluster member leans toward
   * its centre, so the board has ONE way of pointing and the first lesson —
   * where no cluster is complete yet and nothing used to lean at all — gets the
   * same magnet as everything after it.
   */
  private askedMove(): { id: number; to: TilePos } | null {
    const step = this.tutorialDone ? null : this.tutorialStep;
    const hand = step?.hand;
    if (hand && 'from' in hand) {
      // `itemIdAt` answers null for an empty cell; a hand may name one (the
      // move beats point at ground), and there is nothing to lean there.
      const id = hand.from.item ?? this.ctx.state.itemIdAt(hand.from.col, hand.from.row) ?? undefined;
      if (id !== undefined && this.itemSprites.has(id)) {
        return { id, to: { col: hand.to.col, row: hand.to.row } };
      }
      return null;
    }
    const hint = this.hintShown;
    if (hint && this.itemSprites.has(hint.itemId)) {
      return { id: hint.itemId, to: { col: hint.to.col, row: hint.to.row } };
    }
    return null;
  }

  /** Does the standing hint name a piece of this cluster — the one it asks the
   *  player to carry, or the one it asks them to drop it on? That cluster is
   *  what the hand is about, so it is what leans, and it leans louder. */
  private hintTouches(cluster: ReadyCluster | null): boolean {
    const step = this.hintShown;
    if (!step || !cluster) return false;
    const target = this.ctx.state.itemAt(step.to.col, step.to.row);
    return cluster.members.some((m) => m.id === step.itemId || m.id === target?.id);
  }

  /**
   * Can this member begin a lean this frame? Its sprite has to be on the board,
   * not excluded, and standing still.
   *
   * Its OWN lean does not count as motion: the lean tween targets the container
   * (it writes `leanX`/`leanY`), so `isTweening` is true for every leaning
   * piece, and a gate that took that at face value could never restart a set
   * once any part of it was up.
   */
  private leanReady(id: number): boolean {
    const sprite = this.itemSprites.get(id);
    if (!sprite || !sprite.active || sprite.itemId !== id) return false;
    if (this.leanExcluded(sprite)) return false;
    if (this.leans.has(id)) return true;
    // Anything else mid-flight finishes first — the landing glide, the hint's
    // hop, a pop-in and a wander on the container; the drop settle and the
    // landing squash on the art (`artSettling`), which the container's own
    // question cannot see. The lean writes to both.
    return !this.tweens.isTweening(sprite) && !sprite.artSettling();
  }

  /**
   * THE TUTORIAL OWNS THE ORDER while it is running.
   *
   * "Oldest cluster keeps the floor" is the right tie-break on a free board and
   * exactly the wrong one during a lesson, because the lesson's own data makes
   * the oldest cluster the LAST thing it will teach. `level_2` opens on the
   * levelup beat and lays down three Dew Drops already touching; `level_2_gate`
   * opens one beat later with three Cut Wood, also already touching. The Drops
   * have the lower ids, so from that moment they held the lean for eleven
   * beats — through the wood, the planks, the fir grain, the cracked stone —
   * while the pieces the tutorial was actually asking for sat there dead. Their
   * own beat is `moonwater_merge`, near the very end.
   *
   * So the cluster standing on the step's own highlight — or holding a piece
   * its hand names — takes the floor, whatever its age. And when the step names
   * nothing on the board, NOTHING leans: the caller does not fall back to age,
   * because a board pointing somewhere the beat is not about is the board
   * arguing with the thing it is teaching.
   */
  private tutorialFocus(clusters: readonly ReadyCluster[]): ReadyCluster | null {
    const step = this.tutorialStep;
    if (!step) return null;
    const cells = new Set(step.highlight.map((p) => `${p.col},${p.row}`));
    const named = new Set<number>();
    const hand = step.hand;
    if (hand && 'from' in hand) {
      if (hand.from.item !== undefined) named.add(hand.from.item);
      if (hand.to.item !== undefined) named.add(hand.to.item);
    }
    if (cells.size === 0 && named.size === 0) return null;
    return (
      clusters.find((c) =>
        c.members.some((m) => named.has(m.id) || cells.has(`${m.col},${m.row}`))
      ) ?? null
    );
  }

  /** Pieces whose whole CLUSTER stands down: the board says they are side by
   *  side, the screen says otherwise. */
  private leanVetoed(itemId: number): boolean {
    if (this.dragSprite?.itemId === itemId || this.crossing.has(itemId)) return true;
    const sprite = this.itemSprites.get(itemId);
    return !!sprite && (sprite.asleep || !!sprite.getData('dragged'));
  }

  /** Pieces the lean must keep its hands off. Only what `leanVetoed` names:
   *  the tutorial hand's own piece used to be barred here — because the board
   *  answered it with a vertical hop that the lean would have fought — and it
   *  is now the FIRST thing that leans (see `askedMove`). */
  private leanExcluded(sprite: BoardItem): boolean {
    return this.leanVetoed(sprite.itemId);
  }

  /** Begin one member's lean. The caller has already asked `leanReady` of the
   *  whole set — this one just draws it. */
  private startLean(itemId: number, target: TilePos, boosted = false): void {
    const sprite = this.itemSprites.get(itemId);
    if (!sprite || !sprite.active || sprite.itemId !== itemId) return;
    const world = this.ctx.state.world;
    const from = worldPointOf(world, sprite.col, sprite.row);
    const to = worldPointOf(world, target.col, target.row);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return;
    // A share of the gap, capped (see MERGE_READY): far enough to read as a
    // pull from across the board, never far enough to leave the cell. The
    // hint's pair of numbers is the same statement at a higher volume.
    const reach = boosted
      ? Math.min(MERGE_READY.hintAmplitudePx, dist * MERGE_READY.hintFraction)
      : Math.min(MERGE_READY.amplitudePx, dist * MERGE_READY.fraction);
    // The art stretches along the pull as well as sliding down it, and the
    // stretch is derived from how far through this reach the offset currently
    // stands — so the piece has to be told what full reach is for it.
    sprite.leanReach = reach;
    // The ART leans (BoardItem.leanX/leanY), never the container: the container
    // belongs to the drag return, the landing glide and `reseatFixtures`, and the
    // tween dying with `release()` is what keeps the pool law — an acquired
    // slot can never inherit a lean.
    const tween = this.tweens.add({
      targets: sprite,
      leanX: (dx / dist) * reach,
      leanY: (dy / dist) * reach,
      // No delay and no per-piece offset: everything the board is pointing at
      // strains TOGETHER, because a group moving as one thing is the whole
      // message. They are started in the same pass (see ALL OR NONE) so they
      // stay in phase for as long as the ask stands.
      duration: MERGE_READY.leanMs,
      yoyo: true,
      repeat: -1,
      repeatDelay: boosted
        ? MERGE_READY.hintRestMs
        : Math.max(0, MERGE_READY.periodMs - MERGE_READY.leanMs * 2),
      ease: 'Sine.easeInOut'
    });
    this.leans.set(itemId, {
      sprite,
      tween,
      returning: false,
      aim: this.leanAimOf(sprite.col, sprite.row, { id: itemId, to: target, boosted })
    });
  }

  /**
   * Stop a member's lean. `immediate` snaps the art back onto its seat this
   * frame — for a pick-up (the lift is about to own the art) and a removal (the
   * sprite is about to fly a gather or fade out). Anything gentler eases home
   * over one lean-beat, because a whole cluster snapping upright the moment a
   * neighbour moves reads as a glitch, not as the board standing down.
   */
  private stopLean(id: number, immediate: boolean): void {
    const entry = this.leans.get(id);
    if (!entry) return;
    if (entry.returning && !immediate) return; // already on its way home
    entry.tween.stop();
    const { sprite } = entry;
    const holds = sprite.active && sprite.itemId === id;
    if (immediate || !holds || (sprite.leanX === 0 && sprite.leanY === 0)) {
      this.leans.delete(id);
      if (holds) sprite.clearLean();
      return;
    }
    const back = this.tweens.add({
      targets: sprite,
      leanX: 0,
      leanY: 0,
      duration: MERGE_READY.leanMs,
      ease: 'Sine.easeOut',
      onComplete: () => {
        // Only clear OUR entry: a fresh lean may have replaced this one by the
        // time a killed return's onComplete never fires (release kills tweens,
        // and the prune in syncReadyLeans sweeps that case).
        if (this.leans.get(id)?.tween === back) this.leans.delete(id);
      }
    });
    this.leans.set(id, { sprite, tween: back, returning: true, aim: entry.aim });
  }

  /** Every lean down at once — a full visual resync is about to rebuild the
   *  sprites under them, so there is nothing to ease back gracefully TO. */
  private stopAllLeans(): void {
    for (const id of [...this.leans.keys()]) this.stopLean(id, true);
    // A rebuild kills the flights too, and a crossing id left standing would
    // veto a cluster on a board that no longer has that piece in the air.
    this.crossing.clear();
  }

  /**
   * Drag empty ground to pan the big board; wheel to zoom. A pointer that lands
   * on an item or fog is left to the drag/tap handlers, so navigation never
   * fights gameplay.
   */
  private wireCameraNav(): void {
    const cam = this.cameras.main;
    this.input.mouse?.disableContextMenu(); // so RIGHT-drag can pan (esp. in the editor) without the menu popping
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      /**
       * THE MAP EDITOR OWNS THE LEFT BUTTON.
       *
       * The editor's grids and zones are Graphics, which are not interactive, so
       * the `onObject` guard below cannot see them and every left-drag meant to
       * move a grid ALSO started a camera pan. The two then ran on the same
       * pointer: the grid moved by the drag delta while the board scrolled by the
       * same delta underneath it, so the grid was placed somewhere other than
       * where it was dropped — and `BoardEditor.worldOf`, a pointer→world affine
       * sampled while the camera was still, went stale the moment it moved, after
       * which clicks no longer selected the thing under them.
       *
       * MIDDLE and RIGHT still pan, so a zoomed-in board stays navigable while
       * editing (`BoardEditor.onDown` bails on any button but 0, so they never
       * edit). The wheel below is deliberately unguarded — zooming the map in the
       * editor is wanted.
       *
       * This guard existed, was verified, and was lost in the `caced8f` lineage
       * merge along with the `editorStore` import it reads. If BoardScene ever
       * stops importing `editorStore` again, this is what goes with it.
       */
      if (editorStore.open && pointer.button === 0) return;
      const hits = this.input.hitTestPointer(pointer);
      // Dismiss the skip button / dragon menu on any tap not on the popup itself.
      if (this.skipButton && !hits.some((o) => o === this.skipButton || o.parentContainer === this.skipButton)) {
        this.hideSkipButton();
      }
      const onObject = hits.some(
        (o) => o instanceof BoardItem || o.getData?.('regionId') !== undefined
      );
      // A new tap: nothing has claimed it yet. Whoever Phaser dispatches to
      // (see `tapClaimed`) will.
      this.tapClaimed = false;
      if (onObject) return;
      // A tap that lands on UI must never start a pan: UI lives in UIScene and
      // is invisible to this scene's hit test, so it has to be asked separately.
      // If the popup it opens swallows the pointer-up, the camera would
      // otherwise stay glued to the mouse.
      const ui = this.scene.get(SCENES.ui);
      if (ui?.input?.hitTestPointer(pointer).length) return;
      this.flyTween?.stop();
      this.panFrom = { px: pointer.x, py: pointer.y, sx: cam.scrollX, sy: cam.scrollY };
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (!this.panFrom) return;
      // Belt & braces for the same lock-up: if the button is no longer held
      // (the matching pointer-up was consumed elsewhere), the pan is over.
      if (!pointer.isDown) {
        this.panFrom = null;
        return;
      }
      cam.scrollX = this.panFrom.sx - (pointer.x - this.panFrom.px) / cam.zoom;
      cam.scrollY = this.panFrom.sy - (pointer.y - this.panFrom.py) / cam.zoom;
    });
    const endPan = (): void => {
      this.panFrom = null;
    };
    /**
     * A held-out piece, released over nothing: put it away.
     *
     * Decided on the pointer-UP and from what Phaser actually dispatched, never
     * from a hit test this handler runs itself. Re-running `hitTestPointer`
     * inside the scene's own pointer-down handler is NOT reliable — measured, it
     * came back empty for Eleanor while Phaser's own list for that very frame
     * held her, and the same call one instruction later found her again. The
     * give lesson died on it: the pointer-down read "empty ground", put the
     * Crystal Ball away, and the pointer-up that followed armed her help instead
     * of handing her anything. Tapping her did nothing, over and over.
     *
     * Object handlers run BEFORE this (processUpEvents dispatches to game
     * objects, then emits the scene event), so a claim is always in by now.
     */
    this.input.on(Phaser.Input.Events.POINTER_UP, () => {
      // Never on the same gesture that ARMED it (see armGive) — only a later,
      // separate tap on empty ground reads as "changed my mind".
      if (this.pendingGive && !this.tapClaimed && this.time.now - this.giveArmedAtMs > 400) {
        this.cancelGive();
      }
      this.tapClaimed = false;
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, endPan);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, endPan);
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
        this.flyTween?.stop();
        const z = this.ctx.state.map.cameraZoom ?? { min: 0.2, max: 1.4 }; // world-builder zoom lock
        // minZoom is raised to the background-image fit so you can't zoom out past it;
        // ×renderScale converts the logical bounds into the actual (scaled) zoom space.
        const r = renderScale.value;
        cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy < 0 ? 1.1 : 1 / 1.1), this.minZoom * r, z.max * r));
      }
    );
  }

  private canDrag(sprite: BoardItem): boolean {
    if (sprite.kind !== 'item') return false;
    // Map fixtures (the Theme Crystal on its ledge) never lift. MergeSystem
    // bounces them too, but refusing the drag here is what keeps the gesture
    // honest: a landmark that follows the finger and then snaps back reads as a
    // glitch, where one that simply does not move reads as scenery.
    if (this.ctx.state.isFixture(sprite)) return false;
    if (this.tutorialDone) return true;
    return this.allow.drag.includes('*') || this.allow.drag.includes(sprite.chain);
  }

  /** Test hook (window.__emberkeep.itemToPage): world-space centre of the ART
   *  of the item on (col,row). Hit zones follow the art, not the tile — art can
   *  sit off the tile point (the wood log's opaque pixels miss the tile centre
   *  entirely), so pointer-driven tests must aim where a player would. */
  /**
   * A map fixture stands where the map put it — checked, not assumed.
   *
   * The state can no longer move one: `GameState.moveItem` refuses, every
   * caller refuses before it, and hydration re-seats anything a stale save
   * carries. What none of that covers is the SPRITE drifting off a cell its
   * item never left — a tween interrupted, a pooled sprite reused, a drag that
   * lifted before a guard was live. Those all end the same way for the player:
   * the Crystal is somewhere it was never put, and only a reload fixes it.
   *
   * So the invariant is made continuously true instead of trusted. Runs on the
   * existing 240 ms housekeeping tick — one map lookup and two comparisons for
   * the single fixture this build ships — and says so the first time it has to
   * correct anything, because a silent self-heal hides the cause forever.
   */
  private reseatFixtures(): void {
    for (const sprite of this.itemSprites.values()) {
      if (!this.ctx.state.isFixture(sprite)) continue;
      const item = this.ctx.state.items.get(sprite.itemId);
      if (!item) continue;
      const home = gridToWorld(item.col, item.row);
      if (Math.abs(sprite.x - home.x) < 1 && Math.abs(sprite.y - home.y) < 1) continue;
      if (!this.fixtureDrifted) {
        this.fixtureDrifted = true;
        console.warn(
          `[fixture] ${sprite.chain} drifted from its cell (${item.col},${item.row}): ` +
            `sprite was at ${Math.round(sprite.x)},${Math.round(sprite.y)}, ` +
            `expected ${Math.round(home.x)},${Math.round(home.y)} — re-seated.`
        );
      }
      this.tweens.killTweensOf(sprite);
      sprite.setPosition(home.x, home.y);
      sprite.setDepth(DEPTHS.itemBase + home.y);
    }
  }

  itemArtWorldPoint(col: number, row: number): { x: number; y: number } | null {
    for (const s of this.itemSprites.values()) {
      if (!s.active || s.col !== col || s.row !== row) continue;
      const p = s.opaqueArtHitPoint();
      return { x: s.x + p.x - s.displayOriginX, y: s.y + p.y - s.displayOriginY };
    }
    return null;
  }

  /**
   * The world point a pointer test should aim at to hit a world character: the
   * centre of the hit rect built in `buildWorldCharacters`, which is her lower
   * body in TEXTURE space. Derived from the live sprite, so it follows both her
   * authored dx/dy and her scale — aiming at her cell has not been the same
   * thing since she gained a free offset. `null` if she is not on this map.
   */
  characterAimWorldPoint(characterId: string): { x: number; y: number } | null {
    const sprite = this.characterSprites.get(characterId);
    if (!sprite?.active) return null;
    const hit = sprite.input?.hitArea as Phaser.Geom.Rectangle | undefined;
    if (!hit) return { x: sprite.x, y: sprite.y };
    // Texture space -> world: the hit rect and displayOrigin are both unscaled
    // texture units, so the offset from the origin is what scales.
    return {
      x: sprite.x + (hit.centerX - sprite.displayOriginX) * sprite.scaleX,
      y: sprite.y + (hit.centerY - sprite.displayOriginY) * sprite.scaleY
    };
  }

  private refreshDraggable(sprite: BoardItem): void {
    if (sprite.kind !== 'item') return;
    this.input.setDraggable(sprite, this.canDrag(sprite));
  }

  private refreshAllDraggable(): void {
    for (const sprite of this.itemSprites.values()) this.refreshDraggable(sprite);
  }

  /* ------------------------- sprite lifecycle ----------------------- */

  private textureFor(snap: ItemSnapshot): string {
    if (snap.kind === 'decor') return `decor_${snap.chain}`;
    // The baked spin sheet is its OWN texture, not a re-dress of item_crystal_1:
    // it is trimmed and half-scale, so it carries a different origin and scale
    // (setSpin applies them) and must never be seated with the still's numbers.
    if (this.spinsBakedCrystal(snap)) return CRYSTAL_SPIN_KEY;
    // A bought Manor skin replaces the top-tier Timber art and nothing else —
    // same chain, same tier, same generator, same payout. Every skin ships on
    // the Manor's own 430x450 canvas so ITEM_SCALE.lumber_4 applies unchanged.
    const skin = this.ctx.state.manorSkin;
    if (skin && snap.chain === 'lumber' && snap.tier === 4) {
      const key = `skin_${skin}`;
      if (this.textures.exists(key)) return key;
    }
    // A dragon skin is the same trade on the dragon chains: same chain, same
    // tier, same generator, same payout — different pixels. Which tiers can be
    // re-skinned is decided by which `skin_<id>_<tier>` textures exist, so a
    // skin that only covers the whelp needs no code change here.
    const dragonSkin = this.ctx.state.dragonSkins[snap.chain];
    if (dragonSkin) {
      const key = `skin_${dragonSkin}_${snap.tier}`;
      if (this.textures.exists(key)) return key;
    }
    return `item_${snap.chain}_${snap.tier}`;
  }

  /** Re-texture every Manor on the board when the worn skin changes. */
  private applyManorSkin(): void {
    this.reskinChain('lumber', (item) => item.tier === 4);
  }

  /** Re-texture every dragon of one chain when its worn skin changes. Every
   *  tier is offered to `textureFor`, which swaps only the ones that have skin
   *  art — a whelp-only skin leaves the adult alone by itself. */
  private applyDragonSkin(dragon: string): void {
    this.reskinChain(dragon, () => true);
    // A skin swap changes which BREED every dragon of this chain is, so the
    // one just taken off is now worn by nobody and its sheets are the coldest
    // thing on the board — and the new one's have to be fetched. Both sides of
    // that are one reconcile.
    for (const ld of this.liveDragons.values()) {
      if (ld.host.chain !== dragon) continue;
      this.ensureDragonClips(ld.host.chain, ld.host.tier);
      this.dragonIdle(ld); // wear the new breed's rest at once, not on the next roll
    }
    this.reconcileDragonClips();
  }

  private reskinChain(chain: string, wants: (item: BoardItemState) => boolean): void {
    const targets = [...this.itemSprites].filter(([id]) => {
      const item = this.ctx.state.items.get(id);
      return !!item && item.chain === chain && wants(item);
    });
    const paint = (): void => {
      for (const [id, sprite] of targets) {
        const item = this.ctx.state.items.get(id);
        if (!item) continue;
        sprite.setArtTexture(
          this.textureFor(this.ctx.state.snapshot(item, this.ctx.clock.now())),
          this.ctx.data.anchors
        );
      }
    };
    // Skin plates are LAZY (`isLazyScreenArt` — fourteen of them were 37 MB of
    // GPU memory for the at-most-two a save wears). `textureFor` answers with
    // the BASE art when a plate is missing, which is the right fallback and
    // exactly the wrong thing to paint here: the player just put the skin on.
    // So fetch first and paint after. The keys are built rather than asked for,
    // because asking `textureFor` would get the fallback back.
    const skin = chain === 'lumber' ? this.ctx.state.manorSkin : this.ctx.state.dragonSkins[chain];
    if (!skin) {
      paint(); // taking one OFF: the base art is already resident
      return;
    }
    const wanted = new Set<string>();
    for (const [id] of targets) {
      const item = this.ctx.state.items.get(id);
      if (!item) continue;
      const key = chain === 'lumber' ? `skin_${skin}` : `skin_${skin}_${item.tier}`;
      if (!this.textures.exists(key)) wanted.add(key);
    }
    if (wanted.size === 0) {
      paint();
      return;
    }
    // Anything with no plate of its own is simply not queued (`ensureTextures`
    // skips unknown keys), so a whelp-only skin still leaves the adult alone.
    ensureTextures(this, this.ctx, [...wanted], paint);
  }

  private generatorConfigFor(chain: string, tier: number): GeneratorConfig | undefined {
    return this.ctx.data.chains.chains
      .find((c) => c.id === chain)
      ?.tiers.find((t) => t.tier === tier)?.generator;
  }

  /** The live wait a generator is in — tap-cooldown or passive timer — for the
   *  countdown badge and the skip button. Null when it's ready/producing.
   *  A pending PASSIVE wait only reads as "cooling" on passive-ONLY generators
   *  (house, tree): a tappable one (the strawberry patch) must stay harvestable
   *  while its free background gift cooks, or the cozy floor tap would open
   *  the skip menu instead of harvesting. */
  private genTimer(item: BoardItemState): { remaining: number; total: number } | null {
    const cfg = this.generatorConfigFor(item.chain, item.tier);
    if (!cfg) return null;
    const now = this.ctx.clock.now();
    if (item.readyAt !== undefined && now < item.readyAt) {
      return { remaining: item.readyAt - now, total: cfg.cooldownMs };
    }
    if (
      cfg.tappable === false &&
      cfg.passiveMs &&
      item.passiveAt !== undefined &&
      now < item.passiveAt
    ) {
      return { remaining: item.passiveAt - now, total: cfg.passiveMs };
    }
    return null;
  }

  /** The chest's gift cooldown — null when a gift is ready (readyAt unset = a
   *  freshly placed chest is ready at once). Drives the same pill/ready UI. */
  private chestTimer(item: BoardItemState): { remaining: number; total: number } | null {
    if (item.readyAt === undefined) return null;
    const remaining = item.readyAt - this.ctx.clock.now();
    return remaining > 0 ? { remaining, total: CHEST_INTERVAL_MS } : null;
  }

  /** Build the soft radial-gradient shadow texture once (a dark core fading to
   *  transparent → reads as a blurred, realistic ground shadow when squashed). */
  private ensureShadowTexture(): void {
    if (!this.textures.exists('fx_shadow')) {
      const S = 128;
      const tex = this.textures.createCanvas('fx_shadow', S, S);
      if (tex) {
        const ctx = tex.getContext();
        const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
        g.addColorStop(0, 'rgba(16,10,15,0.55)');
        g.addColorStop(0.5, 'rgba(16,10,15,0.3)');
        g.addColorStop(1, 'rgba(16,10,15,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, S, S);
        tex.refresh();
      }
    }
    // Warm plum pill behind the generator countdown (Emberkeep palette).
    if (!this.textures.exists('fx_timepill')) {
      const W = 168;
      const H = 60;
      const R = 30;
      const tex = this.textures.createCanvas('fx_timepill', W, H);
      if (tex) {
        const ctx = tex.getContext();
        const rr = (x: number, y: number, w: number, h: number, r: number): void => {
          ctx.beginPath();
          ctx.moveTo(x + r, y);
          ctx.arcTo(x + w, y, x + w, y + h, r);
          ctx.arcTo(x + w, y + h, x, y + h, r);
          ctx.arcTo(x, y + h, x, y, r);
          ctx.arcTo(x, y, x + w, y, r);
          ctx.closePath();
        };
        ctx.fillStyle = '#3A2B38'; // plumShade rim
        rr(0, 0, W, H, R);
        ctx.fill();
        ctx.strokeStyle = '#D9821F'; // goldShade border accent
        ctx.lineWidth = 3;
        rr(2, 2, W - 4, H - 4, R - 2);
        ctx.stroke();
        const g = ctx.createLinearGradient(0, 4, 0, H - 4);
        g.addColorStop(0, '#6A5468'); // plumHighlight
        g.addColorStop(1, '#4A3845'); // plum
        ctx.fillStyle = g;
        rr(5, 4, W - 10, H - 8, R - 4);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.08)'; // subtle top gloss
        rr(12, 8, W - 24, H * 0.4, R * 0.6);
        ctx.fill();
        tex.refresh();
      }
    }
  }

  /** A soft ground shadow whose size tracks the art's width (decor, trees,
   *  dragon). Squashed into an ellipse; sits on the cell ground so a bouncing
   *  sprite lifts off it.
   *
   *  `squash` (height as a fraction of the final width), `dx` (a horizontal
   *  nudge in fractions of that width) and `dy` (a vertical one in fractions of
   *  the resulting HEIGHT) exist for the standees: a person's contact patch
   *  spreads sideways under her feet without getting deeper, her weight is not
   *  over the point she is anchored on, and her anchor is her soles rather than
   *  the middle of the patch. Everything else takes the defaults. */
  private addGroundShadow(
    x: number,
    y: number,
    displayWidth: number,
    depth: number,
    squash = 0.42,
    dx = 0,
    dy = 0
  ): Phaser.GameObjects.Image {
    const w = Math.max(70, displayWidth * 0.95);
    const h = w * squash;
    return this.add
      .image(x + w * dx, y + h * dy, 'fx_shadow')
      .setDisplaySize(w, h)
      .setDepth(depth);
  }

  /** One-time landing settle for scenery (world-builder decor + animated tree
   *  tiles): a quick squash that springs back, so a piece reads as PLACED on the
   *  ground instead of endlessly floating. `delay` staggers neighbours. */
  private settleSprite(target: Phaser.GameObjects.Image, delay: number): void {
    const sx = target.scaleX;
    const sy = target.scaleY;
    target.setScale(sx * 1.08, sy * 0.84);
    this.tweens.add({
      targets: target,
      scaleX: sx,
      scaleY: sy,
      duration: 280,
      delay,
      ease: 'Back.easeOut'
    });
  }

  private acquireSprite(snap: ItemSnapshot, pop: boolean): BoardItem {
    // Sprites are often created a beat AFTER the state event that announced
    // them (hatch ceremony, merge pop-in run on delayed calls) — and scripted
    // tutorial moves land synchronously inside those emits. Bind the sprite to
    // the item's LIVE state cell: a sprite born on a stale snapshot cell
    // desyncs every future drag validation (the item bounces forever) and
    // leaves its real tile invisibly occupied.
    const live = this.ctx.state.items.get(snap.id);
    if (live && (live.col !== snap.col || live.row !== snap.row)) {
      snap = { ...snap, col: live.col, row: live.row };
    }
    let sprite = this.pool.find((s) => !s.active);
    if (!sprite) {
      sprite = new BoardItem(this);
      this.pool.push(sprite);
      // The clickable zone is the ART's border, not the tile: the rect wraps the
      // sprite's display bounds (swapped in per-acquire below) and transparent
      // pixels yield (hitsOpaqueArt), so the pointer always lands on the item the
      // player actually sees — depth order routes overlaps to the visual front.
      // Container hit areas are tested against local point + displayOrigin
      // (76,76 here from setSize(152,152)); artHitRect bakes that offset in.
      sprite.setInteractive({
        hitArea: new Phaser.Geom.Rectangle(4, 16, 144, 88),
        hitAreaCallback: (
          area: Phaser.Geom.Rectangle,
          x: number,
          y: number,
          obj: BoardItem
        ): boolean => Phaser.Geom.Rectangle.Contains(area, x, y) && obj.hitsOpaqueArt(x, y),
        useHandCursor: true
      });
      sprite.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        if (sprite!.getData('dragged')) return;
        // A short tap STORES a plain merge piece; a HOLD (past the tap window,
        // without moving) opens the sell tooltip instead. Sell used to live on
        // the tap, so it needed a new home when the bag took that gesture — and
        // a hold is the standard merge-game idiom for "tell me about this".
        if (
          pointer.getDistance() <= TAP_MAX_DISTANCE_PX + 2 &&
          pointer.getDuration() > TAP_MAX_MS &&
          this.isStorable(sprite!.itemId)
        ) {
          this.ctx.bus.emit('item:tapped', { itemId: sprite!.itemId });
          return;
        }
        if (!this.isTap(pointer)) {
          // The pointer moved but nothing dragged — this piece isn't draggable
          // yet. A swipe that does nothing reads as a broken board, so answer it.
          if (!this.tutorialDone && !this.canDrag(sprite!)) {
            this.ctx.bus.emit('tutorial:nudge', {});
          }
          return;
        }
        this.onItemTapped(sprite!);
      });
    }
    const textureKey = this.textureFor(snap);
    const artScale =
      snap.kind === 'decor'
        ? (DECOR_SCALE[snap.chain] ?? 1)
        : // `plateScale` gives back a resized plate's authored size: the ratio
          // below is against the art as DRAWN, and 98 board plates are stored
          // smaller than that. Keyed on the texture actually chosen, so a skin
          // is corrected by its own factor and not the base plate's.
          plateScale(
            textureKey,
            ITEM_SCALE[`${snap.chain}_${snap.tier}`] ??
              ITEM_SCALE[snap.chain] ??
              this.tierArtScale(snap.chain, snap.tier) ??
              1
          );
    sprite.acquire(snap, this.ctx.data.anchors, textureKey, artScale);
    // The emerald turns wherever the LIVE gem is not. On a phone and on the
    // `low` profile `ensureCrystal3D` declines the second WebGL context, and the
    // baked sheet plays the same 90° loop at the same cadence instead — the gem
    // the player sees is the gem everyone else sees, minus a WebGL context and
    // its 33 ms readback. The sheet brings its own origin and scale (setSpin),
    // which is why it overrides the `artScale` computed just above.
    sprite.setSpin(this.spinsBakedCrystal(snap) ? CRYSTAL_SPIN : null);
    // Phaser 3.90: calling setInteractive() on an already-interactive object
    // silently returns without updating hitArea. Mutate sprite.input.hitArea
    // directly instead. This also handles pool-reuse resets.
    sprite.input!.hitArea = sprite.artHitRect();
    // Decor is inert scenery: with art-bounds hit zones its (often huge, opaque)
    // sprite would eclipse playable items behind it — pointer input passes
    // through entirely. Re-enabled per-acquire since the pool recycles sprites.
    sprite.input!.enabled = snap.kind !== 'decor';
    // Passive-only generators (house, big tree) have no readyAt, so the snapshot
    // doesn't flag them — recognise them by their chain config for the timer UI.
    // The chest is a recurring gift box: borrow the same cooldown/ready UI.
    if (
      snap.chain === 'chest' ||
      (snap.kind === 'item' && this.generatorConfigFor(snap.chain, snap.tier))
    ) {
      sprite.isGenerator = true;
    }
    this.itemSprites.set(snap.id, sprite);
    this.attachItemAura(sprite);
    this.refreshDraggable(sprite);
    // Every object gets the "placed on the ground" settle. With an entrance pop
    // the squash plays once the container has finished growing; without one
    // (initial board load) it plays immediately so starting items — e.g. the
    // default wood — plant onto the ground instead of appearing to float.
    const settleId = snap.id;
    if (pop) {
      popIn(this, sprite, { duration: TIMINGS.spawnPop });
      this.time.delayedCall(TIMINGS.spawnPop, () => {
        if (sprite.active && sprite.itemId === settleId) sprite.landSquash();
      });
    } else {
      sprite.landSquash();
    }
    return sprite;
  }

  /**
   * Can this piece go in the bag? Only PLAIN merge pieces: anything with a
   * generator (dragons, plants, houses, the crystal) keeps its own tap
   * behaviour, coins still bank, the chest still opens, and story items
   * (`sellable: false` — the Golden Egg and the Elder) are never pocketable.
   */
  private isStorable(itemId: number): boolean {
    const item = this.ctx.state.items.get(itemId);
    if (!item || item.kind !== 'item') return false;
    // A Coin has its own tap (it banks into the purse), handled before this.
    if (item.chain === 'coin') return false;
    if (item.chain === 'chest') return false;
    if (this.generatorConfigFor(item.chain, item.tier)) return false;
    const tier = this.ctx.data.chains.chains
      .find((c) => c.id === item.chain)
      ?.tiers.find((t) => t.tier === item.tier);
    if (tier?.sellable === false) return false;
    // Mid-tutorial the board is a script; pocketing a scripted piece would
    // strand the step that wants it merged. `allow.bag` opens it for the one
    // beat that teaches the satchel, on a piece nothing else needs.
    return this.tutorialDone || this.allow.bag;
  }

  private onItemTapped(sprite: BoardItem): void {
    this.tapClaimed = true; // a piece is something; this tap was not empty ground
    const item = this.ctx.state.items.get(sprite.itemId);
    if (!item) return;
    // A held piece claims this tap too, when what was tapped can eat. Before the
    // generator/bag gates, for the same reason it precedes the character gate.
    if (this.pendingGive && this.ctx.systems.dragons.isBoardDragon(item)) {
      this.deliverGiveTo({ kind: 'dragon', id: item.id });
      return;
    }
    // An armed character claims this tap: she is being asked to help with THIS
    // piece. WorldCharacterSystem decides whether she can, and says so either
    // way — a refusal is never silent.
    if (this.armed) {
      const a = this.armed;
      this.disarmCharacter();
      if (a.kind === 'character') {
        // GIVE outranks ASK. If she is standing there waiting for exactly this
        // piece, handing it over is what the gesture means — a player holding
        // the thing she asked for and being told a timer got shorter would read
        // as a bug, however useful the favour was. Same check-the-counter-moved
        // contract as feeding a nest: the board only consumes what she took.
        if (this.offerGift(a.id, item.chain, item.tier)) {
          this.ctx.bus.emit('board:consume_items', { itemIds: [item.id], reason: 'delivered' });
          return;
        }
        this.ctx.bus.emit('ui:character_action_requested', { characterId: a.id, target: item.id });
      } else {
        // A nest and a dragon both eat: the tapped piece IS the meal, and it
        // leaves the board only once the recipient has accepted it.
        const accepted = this.offerFood(a, item.chain, item.tier);
        if (accepted) {
          this.ctx.bus.emit('board:consume_items', { itemIds: [item.id], reason: 'sold' });
        }
      }
      return;
    }
    // A Cold Nest: tap it to arm an offering, tap again to put it away.
    if (item.chain === 'nest') {
      this.onNestTapped(item.id, item.col, item.row);
      return;
    }
    // A Gold Coin (or a Pouch): tap banks it into the purse — the HUD number and
    // the satchel's purse tile are the same money, so there is nothing to store
    // and no second balance to reconcile. Always bankable, even mid-tutorial:
    // pocketing money never interferes with a scripted step.
    if (item.chain === 'coin') {
      this.sparks.explode(8, sprite.x, sprite.y - 40);
      this.ctx.bus.emit('ui:store_requested', { itemId: item.id });
      return;
    }
    // A treasure chest: a standing gift box (never disappears). Tap it READY to
    // claim a random gift; tap it mid-cooldown and it just nudges — the countdown
    // pill already shows the wait. The reveal animation rides chest:claimed.
    if (item.chain === 'chest') {
      const now = this.ctx.clock.now();
      if (item.readyAt !== undefined && now < item.readyAt) {
        scalePulse(this, sprite, 1.06, 110); // gift not ready yet — a small nudge
        return;
      }
      this.ctx.bus.emit('chest:open', { itemId: item.id });
      return;
    }
    // A plain merge piece: TAP STORES IT. Drag still merges; this is the second
    // verb on the same object, and it is free and instantly reversible so a
    // mis-tap costs the player nothing (BagSystem).
    if (this.isStorable(item.id)) {
      this.ctx.bus.emit('ui:store_requested', { itemId: item.id });
      return;
    }
    const cfg = this.generatorConfigFor(item.chain, item.tier);
    const isGenerator = cfg !== undefined;
    // A refused tap must still answer — a dead button is indistinguishable from
    // a broken one (tutorial-design law 3).
    if (isGenerator && !this.tutorialDone && !this.allow.tapGenerators) {
      this.ctx.bus.emit('tutorial:nudge', {});
      return;
    }
    // Pocketing is the ONLY tap verb a plain piece has now that selling lives in
    // the Bag, so `allow.bag` is what decides whether this tap can do anything.
    if (!isGenerator && !this.tutorialDone && !this.allow.bag) {
      this.ctx.bus.emit('tutorial:nudge', {});
      return;
    }
    // A DRAGON is a tap generator like any other: tapping while it cools falls
    // through to the SAME two skip buttons (Gold / Warmth) every generator
    // offers, and a ready tap harvests. The old bespoke Job menu (Work ⛏️ /
    // Harvest ✋) duplicated verbs that already exist — work is the drag onto a
    // House the tutorial teaches, harvest is the tap itself — at the price of a
    // second UI language for one item kind. Only the status readout stays.
    // `DRAGON_RIGS[item.chain]` used to answer "is this a dragon"; the table is
    // EMPTY now that every breed is clip-animated, so that test went silently
    // false and a tapped dragon stopped showing its status readout. The clip
    // catalog is the register of breeds — the same source `wearsRigTier` reads.
    if (this.clipCharacterFor(item.chain, item.tier) && isGenerator && (this.tutorialDone || this.allow.dragonWork)) {
      this.selectSubject('dragon', String(item.id), false);
    }
    // A SLEEPING dragon is not a button. The tap wakes it — and only wakes it:
    // it does not also harvest, because the wake is the whole gesture and its
    // animation has to finish before the animal is a working generator again.
    //
    // Every sleep is now the nap, and the nap is the player's to interrupt. The
    // shift-rest used to refuse this tap ("that sleep was bought with the
    // work") — it no longer puts the dragon down at all, so there is nothing
    // here to refuse; a tired dragon takes the tap like any other awake one and
    // is simply not hireable until its fatigue runs out.
    if (this.ctx.systems.dragons.isBoardDragon(item)) {
      if (this.ctx.systems.dragonLife.sleepKindOf(item.id) === 'nap') {
        this.wakeDragonByTap(sprite, item.id);
        return;
      }
      // Awake, but still folding out of a sleep: the wake clip owns these
      // frames, and harvesting through it would pay out over a dragon that is
      // visibly still getting up.
      if (this.liveDragons.get(item.id)?.waking) {
        scalePulse(this, sprite, 1.04, 120);
        return;
      }
    }
    // An undecided House asks what it should make — and keeps asking, because a
    // player who dismissed the chooser must have a way back to it. Once
    // committed this stops firing and the tap falls through to the skip offer,
    // so a decided House behaves exactly as a House always has.
    //
    // Gated for the whole tutorial EXCEPT the beat that teaches it: the script
    // raises a House of its own several beats earlier, and a modal panel opening
    // unheralded on top of `plank_merge` would fight it for the same tap. On
    // `house_commission` the gate opens and this is the lesson.
    if (
      (this.tutorialDone || this.allow.commission) &&
      this.ctx.systems.generator.awaitingChoice(item)
    ) {
      this.ctx.bus.emit('ui:commission_requested', { itemId: item.id });
      return;
    }
    // Tapping a COOLING/WAITING generator offers the skip buttons (cost scales
    // with the time left); a ready tap-generator harvests as usual.
    const timer = isGenerator ? this.genTimer(item) : null;
    if (timer) {
      this.showSkipButton(sprite, timer.remaining, timer.total, cfg?.skipMaxGold);
      return;
    }
    // Passive-only generators (house, big tree) never tap-harvest — they pay out
    // on their own timer; a ready tap does nothing.
    if (cfg?.tappable === false) return;
    // Harvest IMMEDIATELY (reliable — never coupled to an animation finishing),
    // then, for a plant, a nearby dragon flies over as a cosmetic "worker"
    // flourish. The harvest already happened, so a dropped frame can't stall it.
    this.ctx.bus.emit('item:tapped', { itemId: sprite.itemId });
    if (isGenerator && !DRAGON_RIGS[item.chain]) this.sendDragonFlourish(sprite);
  }

  /** Altar egg tap: a wobble + a flavor line that escalates with XP progress
   *  toward the Level-3 finale ("It's warm…" → "she is almost awake!"). */
  private wobbleGoldenEgg(): void {
    const egg = this.altarEgg;
    if (!egg) return;
    this.tweens.add({
      targets: egg,
      angle: { from: -5, to: 5 },
      duration: 70,
      yoyo: true,
      repeat: 4,
      ease: 'Sine.easeInOut',
      onComplete: () => egg.setAngle(0)
    });
    const lines = this.ctx.data.dialogue.goldenEgg;
    const [gained, span] = this.ctx.state.levelProgress;
    const progress = this.ctx.state.level >= 2 ? gained / span : 0;
    const bank = progress >= GOLDEN_TREMBLE_PROGRESS ? lines.near : progress >= 0.45 ? lines.mid : lines.early;
    const line = bank[Math.floor(Math.random() * bank.length)] ?? bank[0]!;
    this.floatText(egg.x, egg.y - 30, line, PALETTE.goldAccent);
    this.sparks.explode(4, egg.x, egg.y + 40);
  }

  /** Communing with the Golden Elder at her altar — a flare of gold and an
   *  answering rumble (the live rig plays its celebrate + mouth-flap). */
  private communeWithElder(): void {
    const p = this.altarPoint();
    this.sparks.explode(14, p.x, p.y + 20);
    this.glowFlash(p.x, p.y + 30, PALETTE.goldAccent, 0.55, 1.3);
    this.floatText(p.x, p.y - 40, '✦', PALETTE.goldAccent);
    if (this.altarElder || this.altarElderClip) {
      this.altarElder?.play('hover');
      this.altarElder?.playFace(1);
      this.playElder('hover'); // she answers with a low pass over the altar
      this.altarElderRoll = { mode: 'hover', remainMs: DRAGON_ANIM.adultCelebrateMs };
    } else if (this.altarElderFallback) {
      const f = this.altarElderFallback;
      const y0 = f.y;
      this.tweens.add({ targets: f, y: y0 - 30, duration: 170, yoyo: true, ease: 'Sine.easeOut', onComplete: () => f.setY(y0) });
    }
    this.ctx.bus.emit('elder:tapped', { itemId: 0 }); // Keeper's Tasks counts communes
  }

  /** Cosmetic only: the nearest idle dragon swoops to a just-harvested plant,
   *  breathes a few sparks, and flies home. Drives the dragon's BOARD ITEM so it
   *  works with or without a live rig (the rig is glued to the host). No game
   *  state depends on this completing. */
  private sendDragonFlourish(plant: BoardItem): void {
    const dragon = [...this.itemSprites.values()]
      .filter(
        (s) =>
          DRAGON_RIGS[s.chain] !== undefined && // any rigged dragon, not just the red
          s.isGenerator &&
          s.itemId !== plant.itemId &&
          !this.busyDragons.has(s.itemId) &&
          // A sleeper sleeps through it. The flourish is pure theatre AFTER the
          // harvest has already paid out, so skipping it costs nothing — while a
          // curled painting snapping upright to fly a lap would cost the nap all
          // its credibility.
          this.ctx.systems.dragonLife.moodOf(s.itemId) !== 'asleep'
      )
      .sort(
        (a, b) =>
          Phaser.Math.Distance.Between(a.x, a.y, plant.x, plant.y) -
          Phaser.Math.Distance.Between(b.x, b.y, plant.x, plant.y)
      )[0];
    if (!dragon) return;

    this.busyDragons.add(dragon.itemId);
    const ld = this.liveDragons.get(dragon.itemId); // rig overlay, if attached
    const home = { x: dragon.x, y: dragon.y };
    const landX = plant.x + 70; // land to the plant's right so the un-mirrored rig still faces it (left)
    if (ld) {
      ld.busy = true;
      this.setDragonFacing(ld, landX <= plant.x ? 'right' : 'left');
    }
    const land = (): void => {
      this.glowFlash(plant.x, plant.y - 36, PALETTE.goldAccent, 0.6, 1.2);
      this.sparks.explode(14, plant.x, plant.y - 34);
    };
    const done = (): void => {
      this.busyDragons.delete(dragon.itemId);
      dragon.settleDepth();
      if (ld) {
        ld.busy = false;
        this.dragonLand(ld); // no-op if the led landing is already folding
        ld.mode = 'idle';
        ld.remainMs = this.idleSpanMs(ld.calm);
      }
    };
    // Depth FOLLOWS the flight (itemBase + y each frame) rather than jumping to
    // the always-on-top band: a dragon crossing the isle should slide behind
    // taller scenery like everything else does, not float over the whole board.
    //
    // The lap waits for the WINGS: no duration on the outbound hover (they must
    // NOT fold at the plant), takeoff plays IN PLACE, and the sprite only
    // travels once the cruise loop is running — translating it the instant the
    // flight was ordered skated the dragon across the board through its own
    // unfold. The ONE landing is the return leg's.
    const journey = (): void => {
      this.tweens.add({
        targets: dragon,
        x: landX,
        y: plant.y,
        duration: DRAGON_ANIM.flyToMs,
        ease: 'Sine.easeInOut',
        onUpdate: () => dragon.settleDepth(),
        onComplete: () => {
          land();
          this.tweens.add({
            targets: dragon,
            x: home.x,
            y: home.y,
            delay: DRAGON_ANIM.workMs,
            duration: DRAGON_ANIM.flyBackMs,
            ease: 'Sine.easeInOut',
            onStart: () => {
              const l = this.liveDragons.get(dragon.itemId);
              if (l) this.dragonHover(l, DRAGON_ANIM.flyBackMs); // the return leg's own arc
            },
            onUpdate: () => dragon.settleDepth(),
            onComplete: done
          });
        }
      });
    };
    if (ld) this.dragonHover(ld, undefined, journey);
    else journey();
  }

  /** Two floating skip buttons under a waiting generator: GOLD (real coin art)
   *  and the cheaper WARMTH (⚡). Hovering a button shows WHICH currency it
   *  spends. Both prices are dynamic and refresh live. */
  private showSkipButton(
    sprite: BoardItem,
    remaining: number,
    total: number,
    maxGold?: number
  ): void {
    this.hideSkipButton();
    this.ctx.bus.emit('ui:skip_offered', { itemId: sprite.itemId });
    this.skipMaxGold = maxGold; // per-generator gold cap (Crystal emeralds are dear)

    /*
     * THE OFFER IS A PIN, NOT A PAIR OF KEYS ON THE FLOOR.
     *
     * They used to sit side by side BELOW the piece — 184 units wide, over the
     * tile in front of it, which is the tile the player is usually trying to
     * see (and, on a crowded board, over the next piece down). Two wide keys
     * under an object also read as part of the ground rather than as an answer
     * to the tap that just happened.
     *
     * So it takes the shape the Roothold storefront already taught: a rounded
     * plate on a spike, hanging just ABOVE the thing it belongs to, with the
     * verbs stacked in a tight column inside it. A column, because two stacked
     * keys are half the width of two side by side — the pin covers the roof it
     * points at and nothing else — and because a thumb picks one of two rows
     * far more reliably than one of two columns.
     */
    const KEY_W = 206;
    const KEY_H = 70;
    const ROW_GAP = 10;
    const PAD_X = 22;
    const PAD_Y = 18;
    const bodyW = KEY_W + PAD_X * 2;
    const bodyH = KEY_H * 2 + ROW_GAP + PAD_Y * 2;
    const SPIKE = 30;
    // Seated so the spike's tip lands just over the art's crown: `sprite.y` is
    // the tile origin and the piece stands on it, so the pin hangs off the top
    // of the ART rather than a fixed offset that would sink into a tall House.
    const lift = Math.max(150, sprite.artHitRect().height * 0.62);
    const btn = this.add
      .container(sprite.x, sprite.y - lift - bodyH / 2)
      .setDepth(DEPTHS.dragged - 1);

    const plate = this.add.graphics();
    // A CREAM plate, not the night one.
    //
    // Night was borrowed from the Roothold sign, and a sign is a thing you
    // read from across a hillside: dark and lit. This is a thing you read from
    // ten centimetres away with two green keys on it, and against dark plum the
    // keys were the only light in the object — the plate read as a hole the
    // buttons floated in. Cream puts the light in the plate and lets the keys be
    // the coloured thing on it, which is the same order every other panel in
    // the game uses.
    plate.fillStyle(num(PALETTE.goldShade), 1); // seat, one step down
    plate.fillRoundedRect(-bodyW / 2, -bodyH / 2 + 6, bodyW, bodyH, 30);
    plate.fillStyle(num(PALETTE.cream), 1);
    plate.fillRoundedRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH, 30);
    // The spike is drawn BEFORE the rim and inside the same path family, so the
    // gold reads as one moulding around plate and point rather than a badge
    // with a triangle stuck under it.
    plate.fillStyle(num(PALETTE.cream), 1);
    plate.fillTriangle(-22, bodyH / 2 - 2, 22, bodyH / 2 - 2, 0, bodyH / 2 + SPIKE);
    plate.lineStyle(6, num(PALETTE.gold), 1);
    plate.strokeRoundedRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH, 30);
    btn.add(plate);

    // Caption shown on hover, telling the player which payment a row uses. It
    // sits ABOVE the pin — inside it there is no room, and below it is the
    // spike and the piece.
    const caption = this.add
      .text(0, -bodyH / 2 - 34, '', {
        fontFamily: FONT,
        fontSize: '28px',
        fontStyle: 'bold',
        color: '#fff6e0',
        stroke: '#241b22',
        strokeThickness: 5,
        backgroundColor: 'rgba(28,20,26,0.82)',
        padding: { x: 12, y: 5 }
      })
      .setOrigin(0.5)
      .setVisible(false);

    const rowY = (i: number): number => -bodyH / 2 + PAD_Y + KEY_H / 2 + i * (KEY_H + ROW_GAP);
    const make = (
      row: number,
      currency: 'gold' | 'warmth',
      method: string,
      text: string
    ): Phaser.GameObjects.Text => {
      const dy = rowY(row);
      // BOTH keys are the green plate. They are one offer in two currencies —
      // pay the timer with gold, or pay it with warmth — so ranking one above
      // the other with a different plate said something untrue about them. The
      // difference the player needs is the icon and the number, not the colour.
      const bg = this.add
        .image(0, dy, 'ui_btn_green')
        .setDisplaySize(KEY_W, KEY_H);
      const label = this.add
        .text(0, dy - 2, text, {
          fontFamily: 'Segoe UI, sans-serif',
          fontSize: `${SKIP_KEYS.fontPx}px`,
          fontStyle: 'bold',
          color: '#fff6e0',
          stroke: '#1f3a14',
          strokeThickness: 5
        })
        .setOrigin(0.5);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => caption.setText(method).setVisible(true));
      bg.on('pointerout', () => caption.setVisible(false));
      bg.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        this.ctx.bus.emit('generator:skip', { itemId: sprite.itemId, currency });
        this.hideSkipButton();
      });
      btn.add([bg, label]);
      return label;
    };
    // The gold row wears the REAL coin art (the 🪙 emoji read as a generic
    // token); the label carries only the price and sits right of the icon.
    this.skipGoldLabel = make(0, 'gold', 'Skip with Gold', `${skipEnergyCost(remaining, total, maxGold)}`);
    this.skipGoldLabel.setX(SKIP_KEYS.labelDx);
    btn.add(
      this.add
        .image(SKIP_KEYS.coinDx, rowY(0) - 2, 'item_coin_1')
        .setScale(plateScale('item_coin_1', 0.086))
    );
    this.skipWarmthLabel = make(1, 'warmth', 'Skip with Warmth', `⚡ ${skipWarmthCost(remaining, total, maxGold)}`);
    btn.add(caption); // on top of the keys
    // Tutorial: bounce an arrow over the WARMTH (⚡) row so the player learns to
    // pay the House's timer with energy (and watches their Warmth drop). It
    // points at the row from the LEFT now that the keys are stacked — an arrow
    // above the second row would sit on the first one.
    if (this.tutorialStepId === 'house_skip') {
      const hint = this.add
        .image(-bodyW / 2 - 46, rowY(1), 'ui_arrow')
        .setScale(0.16)
        .setAngle(-90);
      btn.add(hint);
      this.tweens.add({
        targets: hint,
        x: -bodyW / 2 - 30,
        duration: 420,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    }
    // A pin ARRIVES: it pops from the spike's tip, which is the point it is
    // about, rather than fading in over the roof.
    btn.setScale(0.7).setAlpha(0);
    this.tweens.add({ targets: btn, scale: 1, alpha: 1, duration: 170, ease: 'Back.easeOut' });
    // AND BRING IT INTO VIEW. A tap near the edge of the frame raises a pin
    // that hangs ABOVE the piece — which is exactly the direction the screen
    // runs out. The same rule every other pointer in this scene follows: what
    // the game asks the player to look at, the camera shows them. Aimed at the
    // pin's own top edge, not the piece, because the pin is the new thing.
    this.bringIntoView({ x: btn.x, y: btn.y - bodyH / 2 });
    this.skipButton = btn;
    this.skipForId = sprite.itemId;
  }

  /**
   * WHY IS THERE NO HAND? — the whole gate, in one object.
   *
   * Three separate things can hold the merge hint shut (a lesson on screen, a
   * drag in progress, the idle clock) and a fourth can refuse it after the fact
   * (UIScene's hand owner), and NONE of them look different from "there is
   * simply nothing worth suggesting". That is why this bug survived two
   * confident fixes: every wrong theory and the truth produce the same empty
   * screen. So the gate reports itself, and the next question is answered by
   * reading rather than guessing:
   *
   *     window.__emberkeep.hint()
   *
   * `plan` is the honest one — if it is null the board genuinely has no legal
   * gather to suggest, and no amount of fixing the plumbing will draw a hand.
   *
   * The cadence half is reported too, because "it came up once and then just
   * sat there" and "it never came up" look identical from a screenshot and are
   * opposite bugs. `showing` says a hand is out; `pulseMs`/`nextPulseMs` say
   * how far through the heartbeat it is, so a hint that has genuinely stopped
   * breathing is visible as a `pulseMs` that does not climb.
   */
  hintDiagnostics(): {
    world: string;
    tutorialDone: boolean;
    lessonRunning: boolean;
    dragging: boolean;
    idleMs: number;
    waitMs: number;
    followUp: boolean;
    showing: boolean;
    pulseMs: number;
    nextPulseMs: number;
    plan: { chain: string; tier: number; moves: number; travel: number } | null;
    items: number;
  } {
    const lessonRunning = !this.tutorialDone && this.ctx.state.worldId === WORLD_ID;
    const plan = nextMergePlan(this.ctx.state.items.values(), this.ctx.data.chains, this.hintBoard());
    return {
      world: this.ctx.state.worldId,
      tutorialDone: this.tutorialDone,
      lessonRunning,
      dragging: !!this.dragSprite,
      idleMs: Math.round(this.hintIdleMs),
      waitMs: this.hintFollowUp ? MERGE_HINT.followUpMs : MERGE_HINT.idleMs,
      followUp: this.hintFollowUp,
      showing: !!this.hintShown,
      pulseMs: Math.round(this.hintPulseMs),
      // Counts down only while a hand is actually out — with none up there is
      // no heartbeat to be part-way through, and reporting `repulseMs` there
      // would read as one that is about to fire.
      nextPulseMs: this.hintShown ? Math.max(0, Math.round(MERGE_HINT.repulseMs - this.hintPulseMs)) : 0,
      // `travel` is the planner's own ranking unit (squared world units here),
      // not pixels — it is what separates two plans that cost the same drags.
      plan: plan
        ? { chain: plan.chain, tier: plan.tier, moves: plan.steps.length, travel: Math.round(plan.travel) }
        : null,
      items: this.ctx.state.items.size
    };
  }

  /**
   * The world point of one of the popup's keys — the instrumentation contract's
   * answer to a pin whose offset is no longer a constant (see main.ts). Null
   * whenever no offer is up.
   */
  skipKeyWorldPoint(currency: 'gold' | 'warmth'): { x: number; y: number } | null {
    const label = currency === 'gold' ? this.skipGoldLabel : this.skipWarmthLabel;
    if (!this.skipButton || !label) return null;
    // The label rides the row; its x is nudged for the coin, so the ROW's
    // centre is the honest target and that is the container's own x.
    return { x: this.skipButton.x, y: this.skipButton.y + label.y };
  }

  /** Keep both skip prices in step as the timer drains. */
  private updateSkipCost(remaining: number, total: number): void {
    this.skipGoldLabel?.setText(`${skipEnergyCost(remaining, total, this.skipMaxGold)}`);
    this.skipWarmthLabel?.setText(`⚡ ${skipWarmthCost(remaining, total, this.skipMaxGold)}`);
  }

  private hideSkipButton(): void {
    // Announced only when one was actually up. This is called defensively from
    // half a dozen places (a tap elsewhere, the timer running out, a new pin
    // replacing this one), and a `dismissed` for a pin that never existed would
    // hand the tutorial's arrow back on beats that never took it away.
    const had = this.skipForId;
    this.skipButton?.destroy();
    this.skipButton = undefined;
    this.skipGoldLabel = undefined;
    this.skipWarmthLabel = undefined;
    this.skipForId = 0;
    if (had) this.ctx.bus.emit('ui:skip_dismissed', { itemId: had });
  }

  /** Send a dragon to WORK a House: it flies over and stands by it, speeding its
   *  timer until it tires. Works `targetHouse` when given (the tile it was dropped
   *  on), else the NEAREST passive production building. */
  private startDragonWork(
    sprite: BoardItem,
    home?: { x: number; y: number },
    targetHouse?: BoardItem
  ): void {
    if (this.ctx.systems.jobs.restRemaining(sprite.itemId) > 0) {
      this.floatText(sprite.x, sprite.y - 150, 'Resting…', PALETTE.cream);
      return;
    }
    // The dropped-on building, else the NEAREST passive production building
    // (House, Ancient Tree — never a dragon or the tap-only Crystal).
    const house =
      targetHouse ??
      [...this.itemSprites.values()]
        .filter((s) => {
          const cfg = this.generatorConfigFor(s.chain, s.tier);
          return cfg?.tappable === false && !DRAGON_RIGS[s.chain] && s.itemId !== sprite.itemId;
        })
        .sort(
          (a, b) =>
            Phaser.Math.Distance.Between(a.x, a.y, sprite.x, sprite.y) -
            Phaser.Math.Distance.Between(b.x, b.y, sprite.x, sprite.y)
        )[0];
    if (!house) {
      this.floatText(sprite.x, sprite.y - 150, 'Nothing to do here yet', PALETTE.cream);
      return;
    }
    this.busyDragons.add(sprite.itemId);
    const homePos = home ?? { x: sprite.x, y: sprite.y };
    const ld = this.liveDragons.get(sprite.itemId);
    const landX = house.x + 70; // land beside the building so the un-mirrored rig faces it
    if (ld) {
      ld.busy = true;
      this.setDragonFacing(ld, 'left');
    }
    // Same beat as the harvest flourish: fly over, breathe a brief burst of
    // work-magic onto the building, and come STRAIGHT home. The job itself
    // (DragonJobSystem's speed-up + fatigue cycle) runs on its own clock and
    // never depended on the dragon standing there. Depth follows the flight
    // (see sendDragonFlourish) — never the always-on-top band.
    //
    // The errand waits for the WINGS: takeoff plays in place, the sprite only
    // travels once the cruise loop is running, it stays ON THE WING over the
    // House while the work-magic lands, and it folds exactly once — at home.
    const journey = (): void => {
      this.tweens.add({
        targets: sprite,
        x: landX,
        y: house.y + 24,
        duration: DRAGON_ANIM.flyToMs,
        ease: 'Sine.easeInOut',
        onUpdate: () => sprite.settleDepth(),
        onComplete: () => {
          this.glowFlash(house.x, house.y - 36, PALETTE.goldAccent, 0.6, 1.2);
          this.sparks.explode(14, house.x, house.y - 34);
          this.tweens.add({
            targets: sprite,
            x: homePos.x,
            y: homePos.y,
            delay: DRAGON_ANIM.workMs,
            duration: DRAGON_ANIM.flyBackMs,
            ease: 'Sine.easeInOut',
            onStart: () => {
              if (ld) this.dragonHover(ld, DRAGON_ANIM.flyBackMs); // the return leg's own arc
            },
            onUpdate: () => sprite.settleDepth(),
            onComplete: () => {
              sprite.settleDepth();
              this.busyDragons.delete(sprite.itemId);
              if (ld) {
                ld.busy = false;
                this.dragonLand(ld); // no-op if the led landing is already folding
                ld.mode = 'idle';
                ld.remainMs = this.idleSpanMs(ld.calm);
              }
            }
          });
        }
      });
    };
    if (ld) this.dragonHover(ld, undefined, journey);
    else journey();
    this.ctx.bus.emit('dragon:work', { dragonId: sprite.itemId, houseId: house.itemId });
  }

  /** Create/update/remove the floating cooldown pill over a rig-hosted dragon.
   *  Same visual language as the BoardItem pill (fx_timepill + gold dot +
   *  mm:ss), at flash depth so the rig can never cover it. */
  private updateDragonCoolBadge(
    sprite: BoardItem,
    timer: { remaining: number; total: number } | null
  ): void {
    // Keep the host's cooling state coherent (it drives the muted tint and the
    // ready-star on the sleep painting) — but its countdown pill stays OFF on
    // this path always: the floating badge below owns the countdown, and once
    // the sleep art stands in, `artHidden` alone would let a cooling flip
    // re-show the host pill with a label nothing here ever fills.
    sprite.setCooling(timer !== null);
    sprite.hideCountdownPill();
    const existing = this.coolBadges.get(sprite.itemId);
    if (!timer) {
      if (existing) {
        existing.destroy();
        this.coolBadges.delete(sprite.itemId);
        // Ready again — the sparkle the tinted ready-star would have given.
        this.sparks.explode(6, sprite.x, sprite.y - 110);
      }
      if (this.skipForId === sprite.itemId) this.hideSkipButton();
      return;
    }
    let badge = existing;
    if (!badge) {
      badge = this.add.container(sprite.x, sprite.y).setDepth(DEPTHS.badge);
      const pill = this.add.image(0, 0, 'fx_timepill');
      const icon = this.add
        .circle(0, 0, 18, num(PALETTE.gold))
        .setStrokeStyle(4, num(PALETTE.plumShade));
      const label = this.add
        .text(18, 0, '', {
          fontFamily: FONT,
          fontSize: '34px',
          fontStyle: 'bold',
          color: PALETTE.cream,
          stroke: PALETTE.night,
          strokeThickness: 4
        })
        .setOrigin(0.5);
      badge.add([pill, icon, label]);
      badge.setData('pill', pill);
      badge.setData('icon', icon);
      badge.setData('label', label);
      badge.setScale(0);
      this.tweens.add({ targets: badge, scale: 1, duration: 170, ease: 'Back.easeOut' });
      this.coolBadges.set(sprite.itemId, badge);
    }
    const label = badge.getData('label') as Phaser.GameObjects.Text;
    const secs = Math.max(0, Math.ceil(timer.remaining / 1000));
    label.setText(
      secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
    );
    const pillW = Math.max(120, label.width + 96);
    (badge.getData('pill') as Phaser.GameObjects.Image).setDisplaySize(pillW, 56);
    (badge.getData('icon') as Phaser.GameObjects.Arc).setX(-pillW / 2 + 30);
    label.setX(18);
    if (this.skipForId === sprite.itemId) this.updateSkipCost(timer.remaining, timer.total);
    // Above the dragon's head; stacked higher when the Zzz rest pill is up.
    badge.setPosition(sprite.x, sprite.y - (this.restBadges.has(sprite.itemId) ? 320 : 226));
  }

  /** "💤 m:ss" fatigue pill floating above a resting dragon — the SAME
   *  fx_timepill visual the cooldown countdowns use, with the sleep emoji in
   *  place of the gold dot. */
  private showRestBadge(dragonId: number): void {
    // Nothing to count down to: with DRAGON_REST_MS at 0 the dragon flies home
    // ready, and a pill that appeared for one housekeeping tick and vanished
    // would read as a flicker, not as information.
    if (DRAGON_REST_MS <= 0) return;
    this.restBadges.get(dragonId)?.destroy();
    const sprite = this.itemSprites.get(dragonId);
    if (!sprite) return;

    const badge = this.add.container(sprite.x, sprite.y - 160).setDepth(DEPTHS.badge);
    const pill = this.add.image(0, 0, 'fx_timepill');
    const zzz = this.add.text(0, -2, '💤', { fontSize: '32px' }).setOrigin(0.5);
    const rest = this.ctx.systems.jobs.restRemaining(dragonId);
    const s0 = Math.ceil(rest / 1000);
    const countdown = this.add
      .text(18, 0, `${Math.floor(s0 / 60)}:${String(s0 % 60).padStart(2, '0')}`, {
        fontFamily: FONT,
        fontSize: '34px',
        fontStyle: 'bold',
        color: PALETTE.cream,
        stroke: PALETTE.night,
        strokeThickness: 4
      })
      .setOrigin(0.5);
    const pillW = Math.max(140, countdown.width + 110);
    pill.setDisplaySize(pillW, 56);
    zzz.setX(-pillW / 2 + 34);
    badge.add([pill, zzz, countdown]);
    badge.setData('label', countdown);

    badge.setScale(0);
    this.tweens.add({ targets: badge, scale: 1, duration: 170, ease: 'Back.easeOut' });

    this.restBadges.set(dragonId, badge);
  }

  /**
   * Keep a "makes this" badge over every commissioned generator.
   *
   * Reconciled wholesale off state on the shared 240ms tick rather than hooked
   * onto spawn/merge/remove/travel one event at a time. There are at most a
   * handful of Houses, and the pooled BoardItem lifecycle means a per-event
   * badge outlives its sprite the moment a piece is released back to the pool —
   * which is exactly the class of bug the pool's own rules warn about.
   */
  private syncProduceBadges(): void {
    for (const [id, badge] of this.produceBadges) {
      const item = this.ctx.state.items.get(id);
      const sprite = this.itemSprites.get(id);
      if (!item?.produces || !sprite) {
        badge.destroy();
        this.produceBadges.delete(id);
        continue;
      }
      badge.setPosition(sprite.x, sprite.y - PRODUCE_BADGE_LIFT);
      badge.setDepth(DEPTHS.itemBase + sprite.y + 3);
    }
    for (const item of this.ctx.state.items.values()) {
      if (!item.produces || this.produceBadges.has(item.id)) continue;
      const sprite = this.itemSprites.get(item.id);
      if (!sprite) continue;
      const key = `item_${item.produces.chain}_${item.produces.tier}`;
      if (!this.textures.exists(key)) continue;

      const badge = this.add
        .container(sprite.x, sprite.y - PRODUCE_BADGE_LIFT)
        .setDepth(DEPTHS.itemBase + sprite.y + 3);
      const disc = this.add.graphics();
      disc.fillStyle(num(PALETTE.plumShade), 0.92);
      disc.fillCircle(0, 0, PRODUCE_BADGE_R);
      disc.lineStyle(5, num(PALETTE.goldAccent), 1);
      disc.strokeCircle(0, 0, PRODUCE_BADGE_R);
      const icon = this.add.image(0, 0, key);
      icon.setScale((PRODUCE_BADGE_R * 1.5) / Math.max(icon.width, icon.height));
      badge.add([disc, icon]);
      badge.setScale(0);
      this.tweens.add({ targets: badge, scale: 1, duration: 190, ease: 'Back.easeOut' });
      this.produceBadges.set(item.id, badge);
    }
  }

  /** The fatigue lifted — pop the badge, sparkle, and a "Refreshed!" cue so the
   *  player SEES the dragon become available again. */
  /**
   * The player shook it awake.
   *
   * `keepAwake` is what actually ends the sleep: both the nap and the night are
   * derived windows, so clearing a flag would let the very next tick put the
   * animal straight back down. The mood flip that follows drives the uncurl
   * through the ordinary `dragon:mood` path — this never animates anything
   * itself, so there is one wake in the codebase and not two.
   */
  private wakeDragonByTap(sprite: BoardItem, itemId: number): void {
    this.ctx.systems.dragonLife.keepAwake(itemId, DRAGON_NAP_LENGTH_MS);
    scalePulse(this, sprite, 1.06, 130);
    this.sparks.explode(6, sprite.x, sprite.y - 40);
  }

  private wakeDragon(dragonId: number): void {
    this.restBadges.get(dragonId)?.destroy();
    this.restBadges.delete(dragonId);
    const sprite = this.itemSprites.get(dragonId);
    if (!sprite) return;
    this.sparks.explode(14, sprite.x, sprite.y - 60);
    this.glowFlash(sprite.x, sprite.y - 50, PALETTE.goldAccent, 0.5, 1.0);
    this.floatText(sprite.x, sprite.y - 150, 'Refreshed!', PALETTE.goldAccent);
    const ld = this.liveDragons.get(dragonId);
    if (ld) {
      this.dragonHover(ld);
      ld.player?.playFace(1); // a refreshed chirp
      ld.mode = 'hover';
      ld.remainMs = ld.calm ? DRAGON_ANIM.adultCelebrateMs : DRAGON_ANIM.celebrateMs;
    }
  }

  private onFogTapped(regionId: string, col: number, row: number): void {
    const status = this.ctx.state.regionStatus.get(regionId);
    const { x, y } = gridToWorld(col, row);
    if (status !== 'unlockable') {
      this.floatText(x, y - 120, 'Still sleeping…', PALETTE.cream);
      const puff = this.fog.get(`${col},${row}`);
      if (puff) scalePulse(this, puff, 1.07, 120);
      return;
    }
    if (!this.tutorialDone && !this.allow.fog) return;
    this.ctx.bus.emit('fog:tapped', { regionId });
  }

  /* --------------------------- reactions ---------------------------- */

  /**
   * Pull in the art the world we are about to show needs and is not holding.
   *
   * Neither the other worlds' backdrops nor the standee banks of characters who
   * live on them are in the boot preload — a 2610×1632 backdrop costs its GPU
   * memory from the moment it is uploaded, drawn or not, and most sessions never
   * leave Emberkeep. So they are fetched at the door instead, and `create()`
   * runs only once they are resident: rebuilding onto a missing backdrop would
   * paint the isle over open sky.
   */
  private fetchWorldArt(onReady: () => void): void {
    const wanted = worldArtKeys(this.ctx, this.ctx.state.worldId);
    // Everything assets.json can resolve — the backdrop AND the map's decor
    // (standee sheets have no assets entry; ensureTextures skips them and the
    // spritesheet queue below carries them instead).
    const fetchable = wanted.filter((k) => !k.startsWith('rig:'));
    // ONE batch through the one door, backdrop and sheets together — and the
    // residency checks live INSIDE it, because the queue may hold this back
    // behind a run in flight and what was missing then may be resident now.
    //
    // This used to be two paths, and the split was the bug: a world whose
    // sheets were all resident took an `ensureTextures` shortcut that could
    // fire `onReady` synchronously — restarting the scene on top of whatever
    // else was mid-flight — while a world that needed sheets hung its callback
    // on a run some other caller could finish first. `onReady` restarts the
    // board, so being wrong about when the art is ready is a rebuilt board over
    // open sky, or a veil that never lifts.
    this.loads.run(
      () => {
        for (const cfg of this.ctx.systems.characters.charactersIn(this.ctx.state.worldId)) {
          // The wardrobe key (`art ?? id`) names both the bank and its files —
          // Eleanor-at-home fetches Eleanor's own sheets.
          const art = cfg.art ?? cfg.id;
          // Her Align-Studio atlas clips travel with her banks — same door,
          // same run, and worldArtKeys lists them for the matching eviction.
          for (const [clipId, clip] of Object.entries(clipsFor(art))) {
            if (this.textures.exists(clipKey(art, clipId))) continue;
            this.load.spritesheet(clipKey(art, clipId), clip.file, {
              frameWidth: clip.frameWidth,
              frameHeight: clip.frameHeight
            });
          }
          const bank = STANDEE_BANKS[art];
          if (!bank) continue;
          for (const [name, key] of Object.entries(bank.keys)) {
            if (this.textures.exists(key)) continue;
            this.load.spritesheet(key, `sprites/${art}/world-${name}.webp`, {
              frameWidth: bank.frameWidth,
              frameHeight: bank.frameHeight
            });
          }
        }
        for (const key of fetchable) {
          const entry = this.ctx.data.assets.images.find((e) => e.key === key);
          if (this.textures.exists(key) || entry?.source !== 'file' || !entry.file) continue;
          this.load.image(key, entry.file);
        }
      },
      onReady
    );
  }

  private subscribe(): void {
    const bus = this.ctx.bus;
    this.offBus.push(
      // A different world is a different backdrop, different zones, different
      // board — every single thing `create()` builds. Rebuilding the scene is
      // both the cheapest way to get there and the only one that cannot leave a
      // stale sprite behind, and the shutdown handler already tears down rigs,
      // emitters and the 3D crystal properly because `game:reset` needed that.
      // The backdrop is fetched first: the new world's art is deliberately not
      // in the boot preload, and rebuilding onto a missing texture would paint
      // the isle over open sky.
      bus.on('world:switched', () => {
        // Retract every pointer FIRST. This scene restarts on a world change and
        // forgets what it had offered; UIScene, which actually draws the hand,
        // does NOT — so an un-retracted hint survived the journey and went on
        // pointing at cells belonging to a board that is no longer on screen.
        this.takeBackHint();
        // A cell index only means something beside the lattice that owns it, so
        // the focus from the isle would name a cell on the new world's grid
        // that the player has never touched — and the `near` weight would then
        // pull every offer toward a random corner. Declines go too: they are
        // keyed per set, and the sets are a different board's.
        this.playerFocus = null;
        this.hintDeclines.clear();
        this.ctx.bus.emit('hint:carry', null);
        // And the new world starts its idle clock from zero. Arriving somewhere
        // is the one moment a player is reading the board rather than stuck on
        // it, so a suggestion waiting on the doormat is noise — and it would be
        // the first thing seen after a crossing.
        this.hintIdleMs = 0;
        // The plan the player was mid-way through belongs to the world they
        // just left. Forgetting it is what stops the follow-up clock — 420ms,
        // not ten seconds — from firing a hint at someone who has only just
        // arrived somewhere new.
        this.hintAsked = null;
        this.hintFollowUp = false;
        this.fetchWorldArt(() => this.scene.restart());
      }),
      bus.on('store:skin_changed', () => this.applyManorSkin()),
      bus.on('store:dragon_skin_changed', ({ dragon }) => this.applyDragonSkin(dragon)),
      bus.on('store:keeper_skin_changed', ({ keeper }) => this.applyKeeperSkin(keeper)),
      bus.on('item:spawned', ({ item }) => {
        const sprite = this.acquireSprite(item, false);
        // Any dragon generator (ember or emerald) wears its live rig.
        if (this.wearsRigTier(item.chain, item.tier)) this.attachDragon(sprite, false);
      }),
      bus.on('economy:changed', () => this.updateGoldenTremble()),
      // A key arriving (or being spent) moves which gates the player can pay —
      // post-tutorial that reveal is a story beat and earns the cinematic.
      bus.on('economy:changed', () => this.syncKeyBadges(this.tutorialDone)),
      // The Golden Egg materialises ON THE ALTAR when Eleanor's first order
      // completes — camera glide + gold flood (DEMO-PLAN §Act II, staged at
      // the authored lore spot). Two special timings:
      //  · delivery CROSSES Level 3 (keeper:leveled fired first, the finale is
      //    live) → just create the egg; the running finale awakens it.
      //  · delivery AFTER Level 3 → the LATE AWAKENING: arrival and awakening
      //    in one held beat, so the promise never dead-ends as an inert egg.
      bus.on('order:completed', ({ orderId }) => {
        if (orderId !== GOLDEN_ALTAR.orderId) return;
        const finaleLive =
          this.finaleRan && this.time.now - this.finaleStartedMs < FINALE_ENDS_MS;
        if (finaleLive) this.showAltarEgg(false);
        else if (this.goldenQuestDone()) this.lateGoldenAwakening();
        else this.showAltarEgg(true);
      }),
      // Spawns, removals and merges all change what the best plan IS — a hand
      // left pointing through them is the same stale-pointer bug in a different
      // costume. `refreshHint` is a no-op when no hand is up. The ready-lean
      // rides the same events for the same reason: what leans is a fact about
      // the board, and every one of these changes the fact.
      bus.on('item:spawned', () => {
        this.refreshHint();
        this.syncReadyLeans();
      }),
      bus.on('item:removed', () => this.refreshHint()),
      bus.on('item:moved', ({ itemId, to }) => {
        // A landed move is the answer to the hand's question: if it is the move
        // that was asked for, the next step of the plan comes straight back.
        this.notePlayerMove(itemId, to);
        // …and if it was any OTHER move, the hand re-aims at where the plan
        // lives now instead of pointing at the cell the piece has left.
        this.refreshHint();
        const sprite = this.itemSprites.get(itemId);
        if (sprite) {
          sprite.col = to.col;
          sprite.row = to.row;
          const { x, y } = gridToWorld(to.col, to.row);
          this.settleAfterDrag(sprite, x, y);
        }
        // AFTER the settle is scheduled: broken clusters ease home right away,
        // while a cluster this landing completes waits out the glide (the start
        // gate sees the tween) and leans from the housekeeping tick.
        this.syncReadyLeans();
      }),
      bus.on('order:progress', ({ orderId, have, need }) =>
        this.noteOrderWants(orderId, have, need)
      ),
      bus.on('item:move_bounced', ({ itemId, at }) => {
        const sprite = this.itemSprites.get(itemId);
        if (!sprite) return;
        const { x, y } = gridToWorld(at.col, at.row);
        this.settleAfterDrag(sprite, x, y);
      }),
      bus.on('item:merged', (payload) => {
        // A merge is the answer to the hint, whether or not it was the one
        // offered — the player is playing, so the clock starts over and the
        // next offer waits out `restMs` rather than arriving on their heels.
        this.takeBackHint();
        this.hintAsked = null;
        this.hintFollowUp = false; // the plan is finished, not in progress
        this.hintIdleMs = MERGE_HINT.idleMs - MERGE_HINT.restMs;
        this.onMerged(payload);
        // The consumed cluster stops existing and the output may complete a NEW
        // one — its sprite pops in on a delayed call, so the start waits for
        // the housekeeping tick; the stops take effect here and now.
        this.syncReadyLeans();
      }),
      bus.on('item:hatched', ({ item }) => this.hatchSequence(item)),
      bus.on('item:harvested', ({ generatorId, output }) => this.onHarvested(generatorId, output)),
      bus.on('item:produced', ({ generatorId, output }) => this.onProduced(generatorId, output)),
      bus.on('generator:reward', ({ generatorId, coins, xp, energy }) =>
        this.onGeneratorReward(generatorId, coins, xp, energy)
      ),
      bus.on('chest:claimed', ({ chestId, label, coins }) => this.onChestClaimed(chestId, label, coins)),
      // ---- ambient life: the dragons living on the isle by themselves ----
      bus.on('dragon:mood', ({ itemId, mood }) => this.applyDragonMood(itemId, mood)),
      bus.on('dragon:wandered', ({ itemId, to }) => this.flyWander(itemId, to)),
      bus.on('dragon:rest', ({ dragonId }) => this.showRestBadge(dragonId)), // already home — the work trip is a brief flourish
      bus.on('dragon:rested', ({ dragonId }) => this.wakeDragon(dragonId)),
      // THE PRODUCER'S BUBBLE, when the purse is empty.
      //
      // The skip pin is the one gold spend that happens on the BOARD rather
      // than on a shelf, and it was the deadest of the dead ends: the pin just
      // sat there and the piece flashed red. It gets the same shortfall notice
      // the Store and the Emporium raise — but this scene does not draw it.
      // UIScene owns every modal in the game (and the tutorial gate that says
      // whether this one is allowed at all), so the board's part is to say what
      // was refused and what it cost, in the piece's own name.
      bus.on('generator:skip_refused', ({ chain, tier, currency, cost }) => {
        if (currency !== 'gold') return; // a Warmth shortfall is not a Gold one
        const name =
          this.ctx.data.chains.chains
            .find((c) => c.id === chain)
            ?.tiers.find((t) => t.tier === tier)?.name ?? chain;
        // No article of our own: `chains.json` writes tier names as they are
        // meant to be read, and several already carry one ("The Starwright's
        // Bench"), so prefixing produced "skipping the The Starwright's Bench".
        bus.emit('ui:topup_requested', { label: `skipping ${name}`, price: cost, source: 'skip' });
      }),
      bus.on('item:harvest_failed', ({ generatorId, reason }) => {
        const sprite = this.itemSprites.get(generatorId);
        // A sleeping dragon is not REFUSING — it is asleep. The red denial
        // flash reads as "you did something wrong"; a drifting 💤 reads as
        // "come back later", which is the whole of what happened.
        if (reason === 'asleep') {
          if (sprite) this.floatText(sprite.x, sprite.y - 150, '💤', PALETTE.cream);
          return;
        }
        if (sprite) sprite.flashDenied();
        if (reason === 'no_space' && sprite) {
          this.floatText(sprite.x, sprite.y - 140, 'No room!', PALETTE.cream);
        }
      }),
      bus.on('bag:give_armed', ({ chain, tier }) => this.armGive(chain, tier)),
      // The reaction rides the FACT, not the gesture: dragged in or handed over
      // from the satchel, a meal looks the same and only DragonSystem knows
      // whether it was the one food this breed loves.
      bus.on('dragon:fed', ({ itemId, favourite }) => {
        const sprite = this.itemSprites.get(itemId);
        if (sprite) this.feedFlourish(sprite, favourite);
      }),
      bus.on('item:removed', ({ itemId }) => {
        // A selected dragon that just merged, sold or was eaten by a quest has
        // nothing left to read — the readout must not outlive its subject.
        if (this.selected?.kind === 'dragon' && this.selected.id === String(itemId)) {
          this.clearSubject();
        }
        const sprite = this.itemSprites.get(itemId);
        if (!sprite) return;
        this.removeDragonRig(itemId);
        this.detachItemAura(itemId);
        this.itemSprites.delete(itemId);
        // A leaning piece about to fade must not fade mid-lean and hand the
        // pool a tilted slot — and its cluster-mates stand down with it.
        this.stopLean(itemId, true);
        this.tweens.add({
          targets: sprite,
          alpha: 0,
          scale: 0.6,
          duration: 150,
          ease: 'Sine.easeIn',
          onComplete: () => sprite.release()
        });
        this.syncReadyLeans();
      }),
      bus.on('item:sold', ({ coins }) => {
        // Drift a "+N" toward the coin pill.
        this.floatText(320, 240, `+${coins}`, PALETTE.goldAccent, true);
      }),
      bus.on('region:unlocked', (payload) =>
        this.onRegionUnlocked(payload.tiles, payload.revealed, payload.regionId)
      ),
      bus.on('region:unlock_failed', ({ regionId, reason }) => {
        if (reason !== 'keys') return;
        const region = this.ctx.state.map.regions.find((r) => r.id === regionId);
        if (!region) return;
        const centroid = this.regionCentroid(region.tiles.map(([c, r]) => ({ col: c, row: r })));
        this.floatText(centroid.x, centroid.y - 100, 'Needs a Gold Key', PALETTE.goldAccent);
      }),
      // THE SAME BEAT, RE-AIMED. The diamonds under the pieces a step names have
      // to move with them: a marker left on the tile a piece was dragged off is
      // pointing at bare ground, which is worse than pointing at nothing. Only
      // the highlights — the hand and the arrow are UIScene's. The HAND is
      // still remembered here, because the ready-lean keeps off the piece the
      // hand animates from and a re-aim moves which piece that is.
      bus.on('tutorial:markers', ({ highlight, hand }) => {
        if (this.tutorialDone) return;
        this.setHighlights(highlight);
        if (this.tutorialStep) {
          this.tutorialStep.highlight = highlight;
          this.tutorialStep.hand = hand;
        }
      }),
      bus.on('tutorial:step', (step) => {
        this.allow = step.allow;
        this.tutorialDone = step.done;
        this.tutorialStepId = step.id;
        this.refreshAllDraggable();
        this.reshapeStandees();
        // Travel is barred for the whole tutorial, so the doors come alive on
        // the step that ends it — not on a later reload. Order 1 was delivered
        // MID-tutorial, so the Ember Gate blooms right here, as the game hands
        // over: the first thing free play shows is a new door.
        this.syncPortalFx(true);
        this.setHighlights(step.highlight);
        // Key badges: earned into view (held keys ≥ region cost) — quiet here,
        // because the tutorial's own script stages the key_unlock beat.
        this.syncKeyBadges(false);
        this.tutorialStep = step;
        // The closer camera can leave a fog-gate lesson off-screen — glide to it.
        const fog =
          (step.arrow && 'fogRegion' in step.arrow && step.arrow.fogRegion) ||
          (step.hand && 'fogRegion' in step.hand && step.hand.fogRegion);
        if (fog) this.panToRegion(fog);
        // The golden tease: glide west to the sleeping egg while Eleanor speaks;
        // it stirs (wobble + aura wakes) — the camera returns on the next step.
        if (step.id === 'golden_tease') {
          const cam = this.cameras.main;
          this.teaseReturn = { x: cam.midPoint.x, y: cam.midPoint.y, zoom: cam.zoom };
          const p = this.altarPoint();
          // Pull the camera fully OUT to the backdrop-fit zoom (minZoom): the altar
          // hugs the world's west edge, so any tighter zoom lets the bounds clamp
          // leave the egg off-frame on some viewports (players saw only the aura's
          // glow bleed in — or nothing). At minZoom the WHOLE backdrop — and thus the
          // altar — is guaranteed in frame, with no black void on any aspect.
          this.tweens.add({
            targets: cam,
            zoom: this.minZoom * renderScale.value,
            duration: 1100,
            ease: 'Sine.easeInOut'
          });
          this.glideToWorld(p.x, p.y + 60, 1100);
          this.time.delayedCall(1300, () => {
            this.wobbleGoldenEgg();
            this.startEggAura();
          });
        } else if (this.teaseReturn) {
          const home = this.teaseReturn;
          this.teaseReturn = null;
          this.tweens.add({
            targets: this.cameras.main,
            zoom: home.zoom,
            duration: 1000,
            ease: 'Sine.easeInOut'
          });
          this.glideToWorld(home.x, home.y, 1000);
        }
        // LAST, and only when nothing above already owns the camera: the tease
        // pulls the zoom out to the altar and the fog gate frames a whole strip
        // — both would be fought by a pan to the same step's arrow.
        else if (!fog) this.followTutorialPointer(step);
      }),
      // The pointer can move WITHIN a step: a beat that says "tap her, then tap
      // the House" hands its arrow on when she is armed, with no new step to
      // ride. Follow that too, or the second half of the lesson is the half
      // played off-screen.
      bus.on('ui:character_armed', ({ armed }) => {
        const step = this.tutorialStep;
        if (!step || step.done || !step.arrowThen) return;
        this.followTutorialPointer({ ...step, hand: null, arrow: armed ? step.arrowThen : step.arrow });
      }),
      bus.on('state:loaded', () => this.fullResync())
    );
  }

  private onMerged(payload: {
    chain: string;
    resultTier: number;
    at: TilePos;
    consumedIds: number[];
    outputs: ItemSnapshot[];
  }): void {
    const chainConfig = this.ctx.data.chains.chains.find((c) => c.id === payload.chain);
    const isHatch = chainConfig?.hatchAtTier === payload.resultTier;
    const drop = gridToWorld(payload.at.col, payload.at.row);

    for (const id of payload.consumedIds) {
      const sprite = this.itemSprites.get(id);
      if (!sprite) continue;
      this.removeDragonRig(id); // hatchlings merging into a whelp
      this.detachItemAura(id);
      this.itemSprites.delete(id);
      // The gather flight owns the sprite now — a lean still tweening the art
      // underneath it would carry into the pool (release only kills tweens, it
      // cannot un-write an offset the pool's next tenant resets anyway; this
      // keeps the flight itself clean).
      this.stopLean(id, true);
      this.tweens.add({
        targets: sprite,
        x: drop.x,
        y: drop.y,
        scale: 0.55,
        alpha: 0.5,
        duration: TIMINGS.mergeGather,
        ease: 'Sine.easeIn',
        onComplete: () => sprite.release()
      });
    }

    this.time.delayedCall(TIMINGS.mergeGather, () => {
      this.burst.explode(16, drop.x, drop.y - 36);
      this.glowFlash(drop.x, drop.y - 28, PALETTE.goldAccent, 0.55, 1.1);
      if (isHatch) return; // item:hatched runs the special ceremony
      this.playBeatFX('merge', drop.x, drop.y);  // ash puff under the pop-in
      payload.outputs.forEach((output, i) => {
        this.time.delayedCall(60 + i * 90, () => {
          // popIn's Back.easeOut overshoot IS the pop — never stack a second
          // scale tween on a spawning sprite, the longer one wins the final write.
          const isDragon = this.wearsRigTier(output.chain, output.tier);
          const sprite = this.acquireSprite(output, !isDragon);
          // A merged-up dragon (e.g. the Whelp) also wears the live rig and
          // celebrates its arrival; pop the sprite if the rig isn't ready.
          if (isDragon && !this.attachDragon(sprite, true)) {
            popIn(this, sprite, { duration: TIMINGS.spawnPop });
          }
          // A House is finished — ask what it should make. After the pop, so the
          // player watches the thing they built arrive before the panel covers
          // it; the merge is the reason the question is being asked.
          const built = this.ctx.state.items.get(output.id);
          if (
            (this.tutorialDone || this.allow.commission) &&
            built &&
            this.ctx.systems.generator.awaitingChoice(built)
          ) {
            this.time.delayedCall(TIMINGS.spawnPop + 260, () => {
              // Re-check on arrival: the House may have been merged onward into
              // a Manor during the delay, and a chooser for a piece that no
              // longer exists would commission nothing.
              const still = this.ctx.state.items.get(output.id);
              if (still && this.ctx.systems.generator.awaitingChoice(still)) {
                this.ctx.bus.emit('ui:commission_requested', { itemId: output.id });
              }
            });
          }
        });
      });
    });
  }

  /**
   * Shell-crack flash, spark confetti, then the hatchling pops in — AT ONCE.
   *
   * This used to be held behind the reveal card. The reasoning was that the
   * card goes up in the same `item:hatched` emit (RevealSystem is subscribed
   * first), so an unheld ceremony means the player finds her already standing
   * there when the card lifts — the card announcing something that happened
   * behind its own scrim.
   *
   * It cost more than it bought. The card holds itself for 3.4 seconds, and for
   * every one of them the tile the eggs just fused on sat EMPTY; only then did
   * the shell start to shake. The one thing a merge game owes a player is that
   * what they made appears where they made it, immediately — and "immediately"
   * is not a beat that survives being scheduled behind an unrelated animation.
   * So the shell breaks and she is there, and the card is what it always was:
   * her name, said over an isle that already has her on it.
   */
  private hatchSequence(snap: ItemSnapshot): void {
    // The tutorial can MOVE the hatchling in state synchronously inside the
    // 'item:hatched' emit (the chest step slides the green dragon aside) —
    // before this ceremony has created a sprite. Re-read the live cell so the
    // whole ceremony (and the sprite acquireSprite binds below) happens where
    // the item actually is.
    const live = this.ctx.state.items.get(snap.id);
    if (live) snap = { ...snap, col: live.col, row: live.row };
    const { x, y } = gridToWorld(snap.col, snap.row);
    // The shaking pre-hatch shape is the EGG the merge consumed: same chain,
    // one tier down (works for every hatching chain — ember, emerald, ...).
    const eggKey = `item_${snap.chain}_${snap.tier - 1}`;
    const [ax, ay] = this.ctx.data.anchors.byKey[eggKey] ?? this.ctx.data.anchors.default;
    const ghost = this.add
      .image(x, y, eggKey)
      .setOrigin(ax, ay)
      .setScale(
        plateScale(eggKey, ITEM_SCALE[`${snap.chain}_${snap.tier - 1}`] ?? ITEM_SCALE[snap.chain] ?? 1)
      )
      .setDepth(DEPTHS.itemBase + y);
    this.tweens.add({
      targets: ghost,
      x: x + 3,
      angle: 4,
      // The half-swing and the divisor are ONE number — 150 IS 2 x 75. At the
      // old 60 the wobble ran at 8.3 Hz, which reads as a buzz rather than as
      // something struggling to get out. Move one and you must move the other.
      duration: 75,
      yoyo: true,
      repeat: Math.floor(TIMINGS.hatchShake / 150),
      ease: 'Sine.easeInOut'
    });
    this.time.delayedCall(TIMINGS.hatchShake, () => {      ghost.destroy();
      this.glowFlash(x, y - 52, PALETTE.white, 0.95, 1.7);
      this.playBeatFX('hatch', x, y);          // fireburst over the shell debris
      this.shells.explode(7, x, y - 52);
      this.sparks.explode(24, x, y - 48);
      this.burst.explode(12, x, y - 44);
      const sprite = this.acquireSprite(snap, false);      // A live rigged dragon bursts in facing LEFT (un-mirrored), mid-celebration; the host
      // sprite becomes its invisible interactive anchor. Falls back to the
      // pooled sprite pop-in if the rig hasn't loaded.
      if (this.attachDragon(sprite, true)) return;
      sprite.setScale(0.05);
      sprite.setAlpha(0);
      this.tweens.add({
        targets: sprite,
        scale: 1,
        alpha: 1,
        duration: TIMINGS.hatchPop,
        ease: 'Back.easeOut',
        onComplete: () => scalePulse(this, sprite, 1.12, 150)
      });
    });
  }

  private onHarvested(generatorId: number, output: ItemSnapshot): void {
    const generator = this.itemSprites.get(generatorId);
    if (generator) {
      scalePulse(this, generator, 1.15, 130);
      this.burst.explode(5, generator.x, generator.y - 60);
      generator.setCooling(true);
    }
    const sprite = this.acquireSprite(output, false);
    const target = gridToWorld(output.col, output.row);
    if (generator) sprite.setPosition(generator.x, generator.y - 28);
    hopTo(this, sprite, target.x, target.y, {
      height: 76,
      duration: TIMINGS.harvestHop,
      onComplete: () => sprite.settleDepth()
    });
  }

  /** A dragon's PASSIVE gift: it celebrates, sparkles, and hops out an item —
   *  no cooldown tint (that's the tap path), this is free standing income. */
  private onProduced(generatorId: number, output: ItemSnapshot): void {
    const generator = this.itemSprites.get(generatorId);
    if (generator) {
      scalePulse(this, generator, 1.12, 160);
      this.sparks.explode(8, generator.x, generator.y - 52);
      this.glowFlash(generator.x, generator.y - 44, PALETTE.goldAccent, 0.4, 0.85);
      this.celebrateDragon(generatorId); // the rig cheers as it gifts
    }
    const sprite = this.acquireSprite(output, false);
    const target = gridToWorld(output.col, output.row);
    if (generator) sprite.setPosition(generator.x, generator.y - 28);
    hopTo(this, sprite, target.x, target.y, {
      height: 76,
      duration: TIMINGS.harvestHop,
      onComplete: () => sprite.settleDepth()
    });
  }

  /** The house paid out — pop it and float the coins/xp/energy it gave. */
  private onGeneratorReward(generatorId: number, coins: number, xp: number, energy: number): void {
    const gen = this.itemSprites.get(generatorId);
    if (!gen) return;
    scalePulse(this, gen, 1.12, 180);
    this.sparks.explode(12, gen.x, gen.y - 52);
    this.glowFlash(gen.x, gen.y - 44, PALETTE.goldAccent, 0.45, 0.95);
    const parts: string[] = [];
    if (coins) parts.push(`+${coins}`);
    if (xp) parts.push(`+${xp} XP`);
    if (energy) parts.push(`+${energy}⚡`);
    if (parts.length) {
      this.floatText(gen.x, gen.y - 150, parts.join('  '), PALETTE.goldAccent, coins > 0);
    }
  }

  /** The standing chest paid out a gift — a treasure-reveal beat: pop open, a
   *  sparkle ring + glow, the gift label floats up, and a little hop so it MOVES
   *  rather than vanishing. The 10-minute recharge tint/countdown then rides the
   *  update loop (readyAt is already set). Deferred a frame so it never allocates
   *  GameObjects mid bus-emit (which can collide with a coincident level-up). */
  private onChestClaimed(chestId: number, label: string, coins = false): void {
    this.time.delayedCall(0, () => {
      const chest = this.itemSprites.get(chestId);
      if (!chest || !chest.active) return;
      scalePulse(this, chest, 1.28, 240);
      this.playBeatFX('chest', chest.x, chest.y);   // gold dust off the lid
      this.burst.explode(12, chest.x, chest.y - 52);
      this.sparks.explode(18, chest.x, chest.y - 52);
      this.glowFlash(chest.x, chest.y - 46, PALETTE.goldAccent, 0.6, 1.15);
      this.floatText(chest.x, chest.y - 150, label, PALETTE.goldAccent, coins);
      const y0 = chest.y; // a little hop in place: it moves, it does not disappear
      this.tweens.add({ targets: chest, y: y0 - 30, duration: 150, yoyo: true, ease: 'Sine.easeOut' });
    });
  }

  /** Nudge a live rigged dragon into one celebration cycle (e.g. on a gift). */
  /**
   * A sleeping dragon still gifts — and the gift has to look like it came from
   * an animal rather than out of the air.
   *
   * While she sleeps the RIG IS HIDDEN: the curled painting stands in for it
   * (applyDragonMood), so the celebrate animation was playing into an invisible
   * puppet and the shard simply appeared beside a motionless dragon. Worse, it
   * left `mode`/`remainMs` claiming 'hover' while she was asleep, a state waking
   * up then had to unpick.
   *
   * So the sleeper reacts on the thing that is actually on screen: she rocks
   * once and her 💤 puffs. She is NOT woken — DragonLifeSystem owns the mood,
   * and giving something in your sleep is not a reason to get up.
   */
  private stirSleeper(ld: LiveDragon): void {
    this.tweens.add({
      targets: ld.host,
      angle: { from: 0, to: -3.5 },
      duration: 200,
      yoyo: true,
      ease: 'Sine.easeInOut'
    });
    if (ld.zzz) {
      this.tweens.add({
        targets: ld.zzz,
        scale: { from: 1, to: 1.5 },
        duration: 230,
        yoyo: true,
        ease: 'Sine.easeOut'
      });
    }
  }

  private celebrateDragon(itemId: number): void {
    const ld = this.liveDragons.get(itemId);
    if (!ld) return;
    if (ld.mood === 'asleep') {
      this.stirSleeper(ld);
      return;
    }
    ld.mode = 'hover';
    ld.remainMs = ld.calm ? DRAGON_ANIM.adultCelebrateMs : DRAGON_ANIM.celebrateMs;
    this.dragonHover(ld);
    ld.player?.playFace(1); // one happy mouth-flap as the gift pops out
  }

  private onRegionUnlocked(tiles: TilePos[], revealed: ItemSnapshot[], regionId?: string): void {
    const sorted = [...tiles].sort((a, b) => a.col + a.row - (b.col + b.row));
    const centroid = this.regionCentroid(sorted);

    // Lift the key badge away with the fog (the lock is spent).
    const badge = regionId ? this.keyBadges.get(regionId) : undefined;
    if (badge) {
      this.keyBadges.delete(regionId!);
      this.tweens.killTweensOf(badge);
      this.tweens.add({
        targets: badge,
        y: badge.y - 90,
        alpha: 0,
        scale: badge.scale * 1.3,
        duration: TIMINGS.fogLift,
        ease: 'Sine.easeIn',
        onComplete: () => badge.destroy()
      });
    }

    // Diagonal sweep, but cap the total spread so a huge zone (hundreds of
    // tiles) still clears in a snappy couple of seconds rather than minutes.
    const maxSpread = 2200;
    const perTile = Math.min(TIMINGS.fogStaggerPerTile, maxSpread / Math.max(1, sorted.length - 1));
    sorted.forEach((tilePos, i) => {
      const key = `${tilePos.col},${tilePos.row}`;
      const delay = i * perTile;
      // Smoke curls up and fades.
      const puff = this.fog.get(key);
      if (puff) {
        this.fog.delete(key);
        this.tweens.killTweensOf(puff);
        puff.disableInteractive();
        this.tweens.add({
          targets: puff,
          y: puff.y - 104,
          alpha: 0,
          scale: puff.scale * 1.24,
          duration: TIMINGS.fogLift,
          delay,
          ease: 'Sine.easeIn',
          onComplete: () => puff.destroy()
        });
      }
      // The grass tile is already there beneath the cloud — brighten it as the
      // warmth floods back in.
      const base = this.tiles.get(key);
      if (base) {
        base.setTint(0xffffff);
        this.tweens.addCounter({
          from: 60,
          to: 100,
          duration: TIMINGS.tileBloom,
          delay: 250 + delay,
          ease: 'Sine.easeInOut',
          onUpdate: (tw) => {
            const v = Math.round((tw.getValue() ?? 100) * 2.55);
            base.setTint(Phaser.Display.Color.GetColor(v, v, v));
          },
          onComplete: () => base.clearTint()
        });
      }
    });

    // Warm light floods in.
    const glow = this.add
      .image(centroid.x, centroid.y - 24, 'fx_glow')
      .setTint(num(PALETTE.goldAccent))
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTHS.flash)
      .setScale(0.3)
      .setAlpha(0);
    this.tweens.add({
      targets: glow,
      scale: 4.6,
      alpha: 0.68,
      duration: TIMINGS.warmFlash * 0.45,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: glow,
          alpha: 0,
          scale: 5.4,
          duration: TIMINGS.warmFlash * 0.55,
          ease: 'Sine.easeIn',
          onComplete: () => glow.destroy()
        });
      }
    });
    this.time.delayedCall(350, () => {
      for (let i = 0; i < Math.min(sorted.length, 6); i++) {
        const t = sorted[Math.floor((i * sorted.length) / 6)]!;
        const { x, y } = gridToWorld(t.col, t.row);
        this.burst.explode(6, x, y - 8);
      }
    });

    // Revealed eggs + nest pop in once the light has bloomed.
    revealed.forEach((snap, i) => {
      this.time.delayedCall(520 + i * 150, () => {
        this.acquireSprite(snap, true);
        const { x, y } = gridToWorld(snap.col, snap.row);
        this.sparks.explode(6, x, y - 48);
      });
    });
  }

  private setHighlights(tiles: TilePos[]): void {
    for (const highlight of this.highlights) highlight.destroy();
    this.highlights = [];
    for (const tilePos of tiles) {
      const { x, y } = gridToWorld(tilePos.col, tilePos.row);
      const img = this.add
        .image(x, y, 'ui_tile_highlight')
        .setDepth(DEPTHS.tileHighlight)
        .setAlpha(0.5);
      this.tweens.add({
        targets: img,
        alpha: 1,
        scaleX: 1.05,
        scaleY: 1.05,
        duration: 540,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
      this.highlights.push(img);
    }
  }

  /**
   * Draw every piece the board already holds.
   *
   * `item:spawned` covers everything that arrives while this scene is up, which
   * is every case on the authored isle — the board is empty when the scene
   * starts and fills under it. World travel breaks that assumption: GameState
   * swaps to the destination's board (and `region:reveal` seeds it) BEFORE this
   * scene restarts, so a scene that only ever listens for spawns comes up over a
   * populated board and draws none of it. The Keeper landed in Borealis holding
   * five pieces that existed in state and nowhere on screen — and every piece
   * left behind in Emberkeep was invisible on the way home too.
   *
   * Idempotent, so it is safe next to the live spawn path.
   */
  private spawnExistingItems(): void {
    const now = this.ctx.clock.now();
    for (const item of this.ctx.state.items.values()) {
      if (this.itemSprites.has(item.id)) continue;
      const snap = this.ctx.state.snapshot(item, now);
      const sprite = this.acquireSprite(snap, false);
      // Restore the live rig for dragons already on the board (resting, not
      // celebrating — they didn't just hatch).
      if (this.wearsRigTier(snap.chain, snap.tier)) this.attachDragon(sprite, false);
    }
  }

  /** Rebuild everything visual from current state (after a save load). */
  private fullResync(): void {
    // Before the sprites go: a release only kills the lean's tween, and the
    // diff bookkeeping would otherwise still claim the pre-load clusters lean.
    this.stopAllLeans();
    for (const ld of this.liveDragons.values()) {
      ld.clipOverlay?.destroy();
      ld.player?.destroy();
    }
    this.liveDragons.clear();
    for (const id of [...this.itemAuras.keys()]) this.detachItemAura(id);
    for (const sprite of this.itemSprites.values()) sprite.release();
    this.itemSprites.clear();
    for (const tile of this.tiles.values()) tile.clearTint();
    // Remove fog over regions that are now active.
    for (const [key, puff] of [...this.fog]) {
      const [col, row] = key.split(',').map(Number) as [number, number];
      if (this.ctx.state.regionStatusAt(col, row) === 'active') {
        this.tweens.killTweensOf(puff);
        puff.destroy();
        this.fog.delete(key);
      }
    }
    this.spawnExistingItems();
    this.syncReadyLeans(); // the loaded board's complete clusters lean like any other's
    // Re-frame the camera on the loaded Keeper level (no glide).
    const frame = this.frameForLevel(this.ctx.state.level);
    this.cameras.main.setZoom(Math.max(frame.zoom, this.minZoom) * renderScale.value);
    this.cameras.main.centerOn(frame.x, frame.y);
    this.tutorialDone = this.ctx.state.tutorialDone;
    this.reshapeStandees();
    this.syncKeyBadges(false); // a load restores a STATE — no cinematic replay
    // The doors, for the same reason the badges are here: `buildPortals` runs
    // in create(), which is BEFORE UIScene calls beginRun, so every story gate
    // was asked "are you open?" against a state with no orders and no quest
    // latches in it — and all of them answered no. The North Crossing then
    // stayed dark on every reload until a round trip through another world
    // restarted the scene. A load restores a STATE, so no bloom.
    this.syncPortalFx(false);
    this.syncGoldenAltar();
  }

  /* ----------------------------- helpers ---------------------------- */

  /**
   * Smooth tween to any world position (keeps current zoom).
   *
   * ONE EASING CURVE, NOT TWO. The tween ran `Sine.easeInOut` and then
   * `onUpdate` put `smootherstep` on top of its output — two S-curves composed,
   * which does not make a move gentler, it makes it PEAKIER: measured, the
   * midpoint velocity was 2.95 against a single curve's 1.57, so every camera
   * move crawled at both ends and whipped through the middle. That compression
   * is most of why the glides read as hurried whatever their duration said.
   *
   * The tween is linear now and `smootherstep` is the only curve. It is the
   * better of the two for a camera: zero velocity AND zero acceleration at both
   * ends, so the move has no visible start or stop.
   */
  private glideToWorld(worldX: number, worldY: number, duration = 900): void {
    const cam = this.cameras.main;
    const from = { x: cam.midPoint.x, y: cam.midPoint.y };
    this.flyTween?.stop();
    const proxy = { t: 0 };
    this.flyTween = this.tweens.add({
      targets: proxy,
      t: 1,
      duration,
      ease: 'Linear',
      onUpdate: () => {
        const s = smootherstep(proxy.t);
        cam.centerOn(Phaser.Math.Linear(from.x, worldX, s), Phaser.Math.Linear(from.y, worldY, s));
      }
    });
  }

  /** Glide the camera to centre a region (e.g. the key-fog gate the tutorial
   *  points at), keeping the current zoom. */
  private panToRegion(regionId: string): void {
    const region = this.ctx.state.map.regions.find((r) => r.id === regionId);
    if (!region || region.tiles.length === 0) return;
    const c = this.regionCentroid(region.tiles.map(([col, row]) => ({ col, row })));
    this.flyTween?.stop();
    this.cameras.main.centerOn(c.x, c.y); // reliable jump to the gate
  }

  private regionCentroid(tiles: TilePos[]): { x: number; y: number } {
    let sx = 0;
    let sy = 0;
    for (const tilePos of tiles) {
      const { x, y } = gridToWorld(tilePos.col, tilePos.row);
      sx += x;
      sy += y;
    }
    return { x: sx / Math.max(1, tiles.length), y: sy / Math.max(1, tiles.length) };
  }

  /**
   * Play a bank flipbook for a named beat at a world point.
   *
   * Purely additive garnish on top of the particle bursts that were always
   * there — if the bank was not deployed, or the governor has dozed the scene,
   * this is a no-op and the beat looks exactly as it did before.
   *
   * Sits on DEPTHS.particles (with the bursts) rather than DEPTHS.flash, so the
   * white glow still reads as the brightest thing in the frame.
   */
  private playBeatFX(beat: BeatKey, x: number, y: number): FlipbookFX | undefined {
    if (this.power?.state === 'doze') return undefined;
    const spec = BEATS[beat];
    const sheet = sheetOf(spec.sheet);
    if (!sheet || !this.textures.exists(`${sheet.key}_pack`) || !this.textures.exists(RAMP_TEXTURE)) {
      return undefined; // bank not deployed — the particle beat carries it alone
    }
    const fx = new FlipbookFX(this, sheet, x, y + spec.dy, () => this.ctx.clock.now(), spec.opts);
    // Width drives the size; height follows the cell aspect so a tall flame
    // sheet is never squashed into a square.
    fx.setDisplaySize(spec.size, (spec.size * sheet.cellH) / sheet.cellW);
    fx.setDepth(DEPTHS.particles);
    this.add.existing(fx);
    return fx;
  }

  private glowFlash(x: number, y: number, colorHex: string, peak: number, scale: number): void {
    const glow = this.add
      .image(x, y, 'fx_glow')
      .setTint(num(colorHex))
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTHS.flash)
      .setScale(scale * 0.4)
      .setAlpha(0);
    this.tweens.add({
      targets: glow,
      alpha: peak,
      scale,
      duration: 120,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: glow,
          alpha: 0,
          scale: scale * 1.25,
          duration: 320,
          ease: 'Sine.easeIn',
          onComplete: () => glow.destroy()
        });
      }
    });
  }

  /**
   * A reward label that floats up and fades. `withCoin` puts the REAL coin art
   * beside the number: the 🪙 emoji this used to print renders as whatever
   * glyph the device happens to ship — silver on some platforms, flat on others
   * — and never matched the coin the game actually pays out.
   */
  private floatText(
    x: number,
    y: number,
    message: string,
    color: string,
    withCoin = false
  ): void {
    const group = this.add.container(x, y).setDepth(DEPTHS.flash);
    const label = this.add
      .text(0, 0, message, { fontFamily: FONT, fontSize: '40px', fontStyle: 'bold', color })
      .setOrigin(0.5)
      .setStroke(PALETTE.night, 8);
    group.add(label);
    if (withCoin) {
      const coin = this.add.image(0, 0, 'ui_icon_coin');
      coin.setScale(46 / Math.max(coin.width, coin.height));
      const gap = 12;
      const total = coin.displayWidth + gap + label.width;
      coin.setX(-total / 2 + coin.displayWidth / 2);
      label.setX(total / 2 - label.width / 2);
      group.add(coin);
    }
    this.tweens.add({
      targets: group,
      y: y - 88,
      alpha: 0,
      duration: 1000,
      ease: 'Sine.easeOut',
      onComplete: () => group.destroy()
    });
  }

}
