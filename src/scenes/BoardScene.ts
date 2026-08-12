import Phaser from 'phaser';
import type { GameContext } from '../core/Context';
import {
  ANIMATED_TILE_NAMES,
  ATMOSPHERE,
  CAULDRON_DECOR,
  CHEST_INTERVAL_MS,
  COLLECTIBLE_REWARD,
  DECOR_SCALE,
  DEPTHS,
  DRAG,
  DRAGON_ANIM,
  DRAGON_RIG_SCALE,
  EMBER_MOTES,
  FINALE,
  GATE_FX_HEIGHT,
  ROOTHOLD_HOUSE,
  FINALE_ENDS_MS,
  FINALE_REGION,
  GAME_WIDTH,
  GOLDEN_ALTAR,
  GOLDEN_CHAIN,
  GOLDEN_ELDER_TIER,
  GOLDEN_TINT,
  GOLDEN_TREMBLE_PROGRESS,
  IS_IOS,
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
  DRAGON_ROAR_MS,
  DRAGON_SLEEP_SCALE,
  DRAGON_WAKE_MS,
  DRAGON_WANDER_ARC,
  DRAGON_WANDER_FLIGHT_MS,
  PRODUCE_BADGE_LIFT,
  PRODUCE_BADGE_R,
  REVEAL_HOLD_BACK_MAX_MS,
  SLEEP_BREATH,
  STANDEE_SHADOW_DX,
  STANDEE_SHADOW_DY,
  STANDEE_SHADOW_SQUASH,
  STANDEE_SHADOW_WIDTH,
  TAP_MAX_DISTANCE_PX,
  TAP_MAX_MS,
  TILE_H,
  TILE_W,
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
  originFor
} from '../core/characterAnims';
import { gridToWorld, worldToGrid } from '../core/iso';
import { ensureTextures } from '../core/lazyTextures';
import { releaseAwayWorldArt, worldArtKeys } from '../core/worldArt';
import { artScaleAt, setActiveWorld } from '../core/world';
import { POWER_STATE_EVENT, PowerGovernor, PowerState } from '../core/PowerGovernor';
import { cappedTier } from '../core/graphics';
import { GRAPHICS_EVENT, graphics } from '../core/graphicsState';
import { renderScale } from '../core/render-scale';
import type { BoardItemState, GeneratorConfig, ItemSnapshot, TilePos, TutorialAllow } from '../core/types';
import facesJson from '../data/faces.json';
import { BoardItem } from '../entities/BoardItem';
import { PortalFX } from '../entities/PortalFX';
import { Crystal3D } from '../render/Crystal3D';
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
  player: RigPlayer;
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
}

/** Where the camera sits to frame a given Keeper level (world centre + zoom). */
interface CameraFrame {
  x: number;
  y: number;
  zoom: number;
}

/** Zero velocity AND acceleration at both ends — no perceptible start/stop. */
const smootherstep = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Chains whose dragon tiers wear a live rig, and where to fetch each rig.
 *  ember/emerald rig their GENERATOR tiers; golden_egg rigs the Whelp (tier 2,
 *  NOT a generator — she's a baby). See wearsRigTier. */
/** Keys are a CHAIN (that chain's default rig) or `chain:tier` (a tier-specific
 *  override — e.g. the Adult Red Dragon at ember_dragon tier 4). */
const DRAGON_RIGS: Record<string, string> = {
  ember_dragon: 'sprites/characters/dragon/red-dragon/rig/dragon-red.rig.json',
  'ember_dragon:4': 'sprites/characters/dragon/red-dragon/rig-adult/red-dragon.rig.json',
  emerald: 'sprites/characters/dragon/emerald-dragon/rig/dragon-emerald.rig.json',
  'emerald:4': 'sprites/characters/dragon/emerald-dragon/rig-adult/emerald-dragon.rig.json',
  golden_egg: 'sprites/characters/dragon/golden-dragon/rig-adult/golden-dragon.rig.json'
};

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
 * `whole` widens it from her lower body to all of her — used only while a give
 * is armed, when there is no board tap left to protect and a miss would cancel
 * the gesture instead of landing it.
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
 * Presentation of the isle: ground diamonds + cliff skirts, ash-fog over
 * locked regions, pooled BoardItems, drag/tap input (gated by the tutorial),
 * and every piece of merge/hatch/harvest/unlock juice. All game decisions
 * happen in systems — this scene only emits intents and reacts to events.
 */
export class BoardScene extends Phaser.Scene {
  private ctx!: GameContext;
  private itemSprites = new Map<number, BoardItem>();
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
  private dragFrom: TilePos | null = null;
  /** Live drag: the lifted sprite eases toward this pointer-tracked target. */
  private dragSprite: BoardItem | null = null;
  private dragTarget = { x: 0, y: 0 };
  private dragCell!: Phaser.GameObjects.Graphics;
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
    // A restart reuses this scene INSTANCE (Title → Play after game:reset): the
    // last run's display objects are destroyed but these fields still point at
    // them. Stale refs block recreation — the Golden Egg vanished (its aura,
    // positioned from altarPoint, still appeared), altar taps died, and the
    // finale one-shot could never play again.
    this.altarEgg = undefined;
    this.altarEggShadow = undefined;
    this.eggAura = undefined;
    this.altarElder = undefined;
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
      this.ambientEmitters = [];
      this.twinkleTimer = undefined;
      this.offBus.forEach((off) => off());
      this.offBus = [];
      for (const ld of this.liveDragons.values()) {
        ld.clipOverlay?.destroy();
        ld.player.destroy();
      }
      this.liveDragons.clear();
      this.altarElder?.destroy();
      this.altarElder = undefined;
      this.crystal3d?.dispose();
      this.crystal3d = undefined;
      this.crystalTex = undefined;
      for (const id of [...this.itemAuras.keys()]) this.detachItemAura(id);
      this.fx?.destroy();
      this.fx = undefined;
      this.aurora?.destroy();
      this.aurora = undefined;
      this.snow?.destroy();
      this.snow = undefined;
    });

    // The board this world needs is now built and holding its own textures, so
    // nothing still points at the worlds we are not on: give their video memory
    // back. Done here rather than on the travel event so it self-corrects from
    // any route — travel, a scene restart, or Title → Play after a reset.
    releaseAwayWorldArt(this.textures, this.ctx);
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
    for (const emitter of this.ambientEmitters) emitter.emitting = !doze;
    if (this.twinkleTimer) this.twinkleTimer.paused = doze;
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
    // Weather is the first thing a weak device gives up: two full-screen shader
    // passes buy atmosphere, not playability.
    if (!graphics.profile.weather) return;
    const spec = (weatherJson as WeatherFile).worlds?.[this.ctx.state.worldId];
    if (!spec) return;
    const now = (): number => this.ctx.clock.now();
    const state = (this.power?.state ?? 'active') as PowerState;

    const aurora = spec.aurora ? (auroraJson as unknown as AuroraPresetFile).presets[spec.aurora] : undefined;
    if (aurora) {
      this.aurora = new AuroraFX(this, aurora, {
        now,
        width: GAME_WIDTH,
        height: LIVE_GAME_HEIGHT * (spec.auroraBand ?? 0.5),
        depth: DEPTHS.skyFx
      });
      this.aurora.setPowerState(state);
    }

    const snow = spec.snow ? (snowJson as unknown as SnowPresetFile).presets[spec.snow] : undefined;
    if (snow) {
      this.snow = new SnowFX(this, snow, {
        now,
        width: GAME_WIDTH,
        height: LIVE_GAME_HEIGHT,
        depth: DEPTHS.weather
      });
      this.snow.setPowerState(state);
    }
  }

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

  override update(time: number, delta: number): void {
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
    this.aurora?.update();
    this.snow?.update();
    this.updateDrag(delta);
    this.updateLiveDragons(delta);
    if (this.altarElder) {
      this.altarElder.update(delta);
      this.altarElderRoll.remainMs -= delta;
      if (this.altarElderRoll.remainMs <= 0) {
        // The Elder is a calm ADULT: rare, unhurried low-flights between long idles.
        if (this.altarElderRoll.mode === 'idle' && Math.random() < DRAGON_ANIM.adultCelebrateChance) {
          this.altarElderRoll = { mode: 'hover', remainMs: DRAGON_ANIM.adultCelebrateMs };
          this.altarElder.play('hover');
        } else {
          this.altarElderRoll = { mode: 'idle', remainMs: this.idleSpanMs(true) };
          this.altarElder.play('idle');
        }
      }
    }

    this.coolAccum += delta;
    if (this.coolAccum >= 240) {
      this.coolAccum = 0;
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

  /* ------------------------- live rigged dragons ------------------------- */

  /** True if this chain+tier is a dragon BOARD ITEM that wears a live rig
   *  (the ember/emerald generator tiers). The Golden Elder is not a board
   *  item — she lives on the Golden Altar fixture (see syncGoldenAltar). */
  private wearsRigTier(chain: string, tier: number): boolean {
    if (DRAGON_RIGS[rigKeyFor(chain, tier)] === undefined) return false;
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
      await RigPlayer.loadTextures(this, rig, (layer) => `rig:${rig.character}:${layer}`);
      if (!this.scene.isActive()) return;
      // Face frame sets are optional per character; a failed frame simply
      // leaves that set unworn (attachFace validates per-set).
      const face = FACES[rig.character];
      if (face) {
        try {
          await RigPlayer.loadFaceTextures(this, face, faceTextureKey(rig.character), base);
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
   *  which goes invisible but stays interactive/draggable. Returns false if the
   *  rig isn't ready yet (caller falls back to the sprite). */
  private attachDragon(host: BoardItem, intro: boolean): boolean {
    const rig = this.dragonRigs.get(rigKeyFor(host.chain, host.tier));
    if (!rig) return false;
    this.removeDragonRig(host.itemId);
    const scale =
      (host.tier >= 3 ? DRAGON_ANIM.whelpScale : DRAGON_ANIM.hatchlingScale) *
      (DRAGON_RIG_SCALE[`${host.chain}:${host.tier}`] ?? DRAGON_RIG_SCALE[host.chain] ?? 1);
    const calm = CALM_DRAGONS.has(rig.character);
    const player = new RigPlayer(this, rig, (layer) => `rig:${rig.character}:${layer}`, {
      scale,
      speed: calm ? DRAGON_ANIM.adultSpeed : DRAGON_ANIM.whelpSpeed
    });
    const face = FACES[rig.character];
    if (face) player.attachFace(this, face, faceTextureKey(rig.character));
    player.setFacing('left'); // rig's original (un-mirrored) orientation
    if (!intro) player.play('idle');
    host.setArtVisible(false); // host is now just the invisible hit-target + bob anchor
    // Ground shadow proportional to the rig (666px pieces × scale).
    const shadow = this.addGroundShadow(host.x, host.y, 666 * scale, host.depth - 0.5);
    const ld: LiveDragon = {
      player,
      host,
      shadow,
      mode: intro ? 'hover' : 'idle',
      remainMs: intro ? DRAGON_ANIM.introCelebrateMs : this.idleSpanMs(calm),
      busy: false,
      calm,
      mood: 'awake',
      roarInMs: DRAGON_ROAR_EVERY_MS,
      flightPhase: null,
      sleepState: 'none'
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
      let target: Phaser.GameObjects.Sprite | Phaser.GameObjects.Container;
      if (this.playRoarClip(ld) && ld.clipOverlay) {
        target = ld.clipOverlay;
      } else {
        player.play('hover');
        player.playFace(2);
        ld.mode = 'hover';
        ld.remainMs = DRAGON_ANIM.introCelebrateMs;
        target = player.container;
      }
      target.setAlpha(0);
      this.tweens.add({
        targets: target,
        alpha: 1,
        duration: DRAGON_ANIM.fadeInMs,
        ease: 'Sine.easeOut'
      });
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
    ld.player.container.setPosition(ld.host.x, ld.host.y - DRAGON_ANIM.groundLift);
    ld.player.container.setDepth(ld.host.depth + 0.5);
    ld.shadow.setPosition(ld.host.x, ld.host.y).setDepth(ld.host.depth - 0.5);
    ld.zzz?.setPosition(ld.host.x, ld.host.y).setDepth(ld.host.depth + 4);
    if (ld.clipOverlay?.visible) {
      // The Align-Studio clip rides the host at the rig's own anchor and depth,
      // mirroring with the rig's facing (source art faces left; dx mirrors too,
      // so the registration lands where the flipped rig's would).
      const clip = ld.clipOverlay.getData('clip') as CharacterClip | undefined;
      const flip = ld.player.container.scaleX < 0;
      ld.clipOverlay
        .setPosition(ld.host.x, ld.host.y - DRAGON_ANIM.groundLift)
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
      ld.player.update(delta);
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
    ld.player.destroy();
    ld.shadow.destroy();
    this.liveDragons.delete(itemId);
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
    ld.player.container.setVisible(false);
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
    if (!this.playRoarClip(ld)) {
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
    const id = dragonClipCharacter(ld.host.chain, ld.host.tier);
    if (!id) return null;
    const clip = clipFor(id, clipId);
    const key = clipKey(id, clipId);
    if (!clip || !this.textures.exists(key)) return null;
    if (!this.anims.exists(key)) {
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(key, { start: 0, end: clip.frames - 1 }),
        frameRate: clip.fps,
        repeat: clip.loop ? -1 : 0
      });
    }
    return { clip, key };
  }

  /** The overlay sprite that stands in for the rig while a clip plays. */
  private dragonOverlay(ld: LiveDragon, key: string): Phaser.GameObjects.Sprite {
    if (!ld.clipOverlay) {
      ld.clipOverlay = this.add.sprite(ld.host.x, ld.host.y - DRAGON_ANIM.groundLift, key).setVisible(false);
      // A clip HIDES the rig, and with it the rig's keyline, so the stand-in has to
      // carry its own — at the rig's exact width, since the handover happens
      // mid-animation and a line that changed weight across it would read as a
      // flinch. See src/render/SpriteInk.ts.
      attachSpriteInk(this, ld.clipOverlay, { units: ld.player.outlineUnits });
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
    const flip = ld.player.container.scaleX < 0;
    const origin = originFor(c.clip, flip);
    overlay
      .setPosition(ld.host.x, ld.host.y - DRAGON_ANIM.groundLift)
      .setDepth(ld.host.depth + 0.5)
      .setFlipX(flip)
      .setOrigin(origin.x, origin.y)
      .setScale(c.clip.scale);
    return overlay;
  }

  private clearDragonOverlay(ld: LiveDragon): void {
    ld.flightPhase = null;
    if (!ld.clipOverlay) return;
    ld.clipOverlay.off(Phaser.Animations.Events.ANIMATION_COMPLETE);
    ld.clipOverlay.stop();
    ld.clipOverlay.setVisible(false);
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
      if (this.anims.exists(key)) continue;
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(f.key, { start, end: end - 1 }),
        frameRate: f.clip.fps,
        repeat: seg === 'loop' ? -1 : 0
      });
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
  private dragonHover(ld: LiveDragon, durationMs?: number): void {
    // A dragon taking wing is by definition not curled on a tile. A flight
    // ordered over a sleeper (work drop, wander race) used to strand
    // `sleepState` at seated/transition, and every later seatDragonSleep
    // no-opped on the stale guard — the frozen-dragon bug.
    ld.sleepState = 'none';
    const f = this.flySegments(ld);
    if (!f) {
      // No phased clip: the whole-loop overlay, else the rig's hover preset
      // (clearing any idle overlay a partial push may have left standing in).
      const whole = this.dragonClip(ld, 'fly');
      if (!whole) {
        this.clearDragonOverlay(ld);
        ld.player.container.setVisible(true);
        ld.player.play('hover');
        return;
      }
      const overlay = this.dressOverlay(ld, whole);
      overlay.off(Phaser.Animations.Events.ANIMATION_COMPLETE);
      overlay.setVisible(true);
      overlay.play(whole.key, true);
      ld.player.container.setVisible(false);
      return;
    }
    const overlay = this.dressOverlay(ld, f);
    overlay.off(Phaser.Animations.Events.ANIMATION_COMPLETE);
    overlay.setVisible(true);
    ld.player.container.setVisible(false);
    const airborne = ld.flightPhase === 'takeoff' || ld.flightPhase === 'loop';
    if (!airborne) {
      const rampFits = durationMs === undefined || durationMs > this.segMs(f.clip, 'takeoff') + DRAGON_ANIM.landingLeadMs;
      if (rampFits) {
        ld.flightPhase = 'takeoff';
        overlay.play(this.segKey(f.key, 'takeoff'));
        overlay.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
          if (ld.flightPhase !== 'takeoff') return;
          ld.flightPhase = 'loop';
          overlay.play(this.segKey(f.key, 'loop'));
        });
      } else {
        ld.flightPhase = 'loop';
        overlay.play(this.segKey(f.key, 'loop'));
      }
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
      ld.player.container.setVisible(false);
      // An idle roll landing on idle again must not restart the breath cycle.
      if (overlay.anims.currentAnim?.key !== idle.key || !overlay.anims.isPlaying) {
        overlay.play(idle.key);
        this.armIdleRoar(ld, overlay, idle.key);
      }
      return;
    }
    this.clearDragonOverlay(ld);
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
    ld.player.container.setVisible(false);
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
        ld.player.container.setVisible(true).setAlpha(0.65);
        return;
      }
      // The rig steps aside and the painting takes the tile — but the rig's
      // GROUND SHADOW stays exactly where it was. The curled art's anchor is
      // its own alpha-bbox floor line (anchors.json), so its belly lands on
      // the tile origin, which is the same line `syncDragon` puts that shadow
      // on: the dragon lies down ON its shadow rather than hovering over a
      // second one the item would otherwise light beneath itself.
      ld.player.container.setVisible(false);
      ld.host.setArtTexture(sleepKey, this.ctx.data.anchors);
      ld.host.setArtScale(ITEM_SCALE[sleepKey] ?? DRAGON_SLEEP_SCALE);
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

  private applyDragonMood(itemId: number, mood: 'awake' | 'hungry' | 'asleep'): void {
    const ld = this.liveDragons.get(itemId);
    if (!ld) return;
    const was = ld.mood;
    ld.mood = mood;
    if (mood === 'hungry') ld.roarInMs = 0; // say so at once, then on the cadence
    if (was === mood) return;

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
    if (!seated && !midTransition) return; // never seated — it is still flying or standing
    this.clearDragonOverlay(ld); // a mood flip mid-transition never strands the clip
    ld.host.setSleepBreath(false);
    // Restore the STANDING art under the rig. The host is invisible while the
    // rig stands in, but a pooled item that is released still carrying the
    // curled texture would come back as a sleeping dragon in another tile's
    // clothes (the pool's own rule: acquire must fully reset).
    const standKey = `item_${ld.host.chain}_${ld.host.tier}`;
    if (this.textures.exists(standKey)) {
      ld.host.setArtTexture(standKey, this.ctx.data.anchors);
      ld.host.setArtScale(ITEM_SCALE[`${ld.host.chain}_${ld.host.tier}`] ?? 1);
    }
    ld.host.setArtVisible(false);
    ld.shadow.setVisible(true);
    // The TOSLEEP clip played in REVERSE is the definitive wake when pushed —
    // the whelp uncurls, then the rig stands. Without it, the rig returns at
    // once and stretches, exactly as before.
    const t = seated ? this.dragonClip(ld, 'tosleep') : null;
    if (t) {
      ld.mode = 'idle';
      ld.remainMs = DRAGON_WAKE_MS;
      this.playDragonTransition(ld, t, true, () => {
        ld.player.container.setAlpha(1);
        this.dragonIdle(ld); // the atlas idle when pushed, the rig otherwise
      });
      return;
    }
    ld.player.container.setVisible(true).setAlpha(1);
    ld.player.play('stretch');
    ld.mode = 'idle';
    ld.remainMs = DRAGON_WAKE_MS;
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
      ld.player.setFacing(dest.x <= sprite.x ? 'left' : 'right');
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
      const fitZoom = Math.max(GAME_WIDTH / bgRect.w, LIVE_GAME_HEIGHT / bgRect.h);
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
      this.ctx.bus.on('tour:unpoint', () => this.clearTourArrow()),
      this.ctx.bus.on('quest:completed', ({ questId }) => {
        if (questId === GOLDEN_ALTAR.awakenQuestId) this.runFinale();
      })
    );
  }

  /* ------------------------- the Level-3 finale ------------------------- */

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
    this.time.delayedCall(FINALE.hatchAtMs, () => {
      if (!this.altarEgg) return;
      const p = this.altarPoint();
      this.glideToWorld(p.x, p.y + 60, 900);
    });
    // …and the Golden Egg cracks: the legendary Elder AWAKENS on her ledge.
    // ONLY if Eleanor's golden order was delivered — the egg is authored decor
    // now, so its mere existence no longer implies the promise was earned; the
    // prophecy finale variant leaves her sleeping (deliver later → the late
    // awakening plays instead).
    this.time.delayedCall(FINALE.awakenAtMs, () => {
      if (this.ctx.state.completedOrderIds.includes(GOLDEN_ALTAR.orderId)) {
        this.awakenAltarElder();
      } else if (this.altarEgg) {
        // Prophecy variant: she stirs but does NOT wake — the un-filled order
        // stays the hook.
        const p = this.altarPoint();
        this.wobbleGoldenEgg();
        this.glowFlash(p.x, p.y + 40, PALETTE.goldAccent, 0.7, 1.4);
      }
    });

    // 3 — home again: the board is handed straight back to the player.
    this.time.delayedCall(FINALE.returnAtMs, () => {
      const frame = this.frameForLevel(this.ctx.state.level);
      this.glideToWorld(frame.x, frame.y, 1100);
    });
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
      .setScale(0.5)
      .setAlpha(0.18);
    this.tweens.add({
      targets: this.eggAura,
      alpha: 0.34,
      scale: 0.62,
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
    if (!this.altarEgg && !this.altarElder && !this.altarElderFallback) {
      const p0 = this.altarPoint();
      const cal = GOLDEN_ALTAR.calibration;
      this.altarEgg = this.add
        .image(p0.x, p0.y, `item_${GOLDEN_CHAIN}_1`)
        .setOrigin(cal.anchor.x, cal.anchor.y)
        .setScale(p0.scale)
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
    this.glideToWorld(p.x, p.y + 60, 900);
    this.time.delayedCall(1000, () => {
      this.glowFlash(p.x, p.y + 40, PALETTE.goldAccent, 0.85, 1.6);
      this.sparks.explode(22, p.x, p.y + 40);
      this.floatText(p.x, p.y - 40, '???', PALETTE.goldAccent);
    });
    this.time.delayedCall(2600, () => this.glideToWorld(home.x, home.y, 900));
  }

  /** The Elder stands on the altar — live rig when available, gold-tinted
   *  stand-in otherwise (upgraded automatically when the rig arrives). */
  private showAltarElder(): void {
    if (this.altarElder) return;
    const p = this.altarPoint();
    const eggBottom = p.y + 1451 * p.scale; // egg art is 1176×1451, anchored top
    this.altarEgg?.destroy();
    this.altarEgg = undefined;
    this.altarEggShadow?.destroy();
    this.altarEggShadow = undefined;
    this.eggAura?.destroy();
    this.eggAura = undefined;
    this.stopGoldenTremble();
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
      this.altarElderFallback = this.add
        .image(p.x, eggBottom, `item_${GOLDEN_CHAIN}_${GOLDEN_ELDER_TIER}`)
        .setOrigin(0.5, 0.88)
        .setScale(0.21)
        .setTint(GOLDEN_TINT)
        .setDepth(DEPTHS.itemBase + p.y + 1);
    }
    this.addGroundShadow(p.x, eggBottom, 170, DEPTHS.itemBase + p.y);
    this.ensureAltarZone();
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
      duration: 60,
      yoyo: true,
      repeat: Math.floor(TIMINGS.hatchShake / 120),
      ease: 'Sine.easeInOut',
      onComplete: () => {
        this.glowFlash(p.x, p.y + 40, PALETTE.goldAccent, 1, 2.6);
        this.playBeatFX('elder', p.x, p.y + 40);   // the Elder rises out of gold
        this.shells.explode(12, p.x, p.y + 40);
        this.sparks.explode(40, p.x, p.y + 44);
        this.burst.explode(20, p.x, p.y + 48);
        this.showAltarElder();
        if (this.altarElder) {
          this.altarElder.play('hover');
          this.altarElder.playFace(2); // the Elder announces herself — a ROAR
          this.altarElderRoll = { mode: 'hover', remainMs: DRAGON_ANIM.introCelebrateMs };
        }
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
    this.glideToWorld(p.x, p.y + 60, 900);
    this.time.delayedCall(1000, () => {
      this.glowFlash(p.x, p.y + 40, PALETTE.goldAccent, 0.85, 1.6);
      this.sparks.explode(22, p.x, p.y + 40);
      this.floatText(p.x, p.y - 40, '???', PALETTE.goldAccent);
    });
    this.time.delayedCall(2400, () => this.awakenAltarElder());
    this.time.delayedCall(5600, () => this.glideToWorld(home.x, home.y, 900));
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
      if (this.altarElder || this.altarElderFallback) this.communeWithElder();
      else if (this.altarEgg) this.wobbleGoldenEgg();
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
      Math.min((GAME_WIDTH / 2 - pad) / halfW, (LIVE_GAME_HEIGHT / 2 - pad) / halfH) * 1.15,
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
    return this.levelFrames.get(1) ?? { x: GAME_WIDTH / 2, y: LIVE_GAME_HEIGHT / 2, zoom: 0.5 };
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
      .image(GAME_WIDTH * 0.3, 130, 'fx_glow')
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
            Phaser.Math.Between(80, GAME_WIDTH - 80),
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
      this.add
        .image(x + (cal.offsetX + (b.dx ?? 0)) * ratio, y + (cal.offsetY + (b.dy ?? 0)) * ratio, key)
        .setOrigin(cal.anchor?.x ?? 0.5, cal.anchor?.y ?? 0.5)
        .setScale((cal.scale ?? 1) * ratio)
        .setDepth(DEPTHS.tiles - 1); // below the floor tiles, above the sky FX
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
      const sprite = this.add
        .image(x + (cal.offsetX + (d.dx ?? 0)) * ratio, baseY, key)
        .setOrigin(cal.anchor.x, cal.anchor.y)
        .setScale(cal.scale * ratio * (DECOR_SCALE[d.name] ?? 1))
        .setDepth(DEPTHS.itemBase + y);
      // Ground shadow sized to the art, on the cell so the spring lifts off it.
      this.addGroundShadow(x, y, sprite.displayWidth, DEPTHS.itemBase + y - 1);
      // Slow spring-bounce (not a smooth float): lazy spring, staggered, calm.
      this.settleSprite(sprite, (i % 8) * 35); // one-time landing settle
      // The one piece of scenery that IS a screen: Selyna's pot opens the brew
      // panel. Same shape as a world character — map decor with a tap handler.
      if (d.name === CAULDRON_DECOR) {
        // The Hatchery tour points here ("The cauldron, on the rune — tap it").
        this.tourTargets.set('hatchery_cauldron', { x: sprite.x, y: baseY - sprite.displayHeight * 0.55 });
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
      const key = animated ? bank!.keys.idle : `char_${art}`;
      if (!animated && !this.textures.exists(key)) continue;
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
      if (animated) {
        // Register the one-shot cast whether or not an atlas idle takes over —
        // the scepter answer still plays off the bank.
        this.ensureStandeeAnims(art, bank!);
      }
      // An Align-Studio atlas idle (character-anims.json) supersedes the bake's
      // still + breath: it IS an authored idle loop, registered onto the same
      // feet anchor by the pushed transform. Without one, she rests on the
      // bank's frame 0 and her standing life stays the breath in `update`.
      const clipIdle = this.applyStandeeRest(art, sprite);
      if (!clipIdle && animated) sprite.setFrame(0);
      // Arm/disarm pulses read this instead of assuming 1.
      sprite.setData('baseScale', sprite.scale);
      // Her keyline. Width comes from the BANK's geometry, not the clip's, because
      // her clips are authored at different scales (idle 0.5671, cast 0.61371) and
      // deriving it per clip would change the weight of her outline the moment she
      // raised her scepter. Frames re-dress themselves; see SpriteInk.
      attachSpriteInk(this, sprite, {
        units: keylineUnits(
          bank
            ? Math.max(bank.frameWidth, bank.frameHeight) * standeeScale
            : Math.max(sprite.displayWidth, sprite.displayHeight),
          DRAGON_OUTLINE
        )
      });
      syncSpriteInk(sprite);
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
      // Her hit area is her LOWER BODY, never her full frame. A standee is ~2
      // tiles tall, so its bounding box reaches over the cells behind her and
      // would swallow taps and drags meant for the board — the same trap the fog
      // puffs have (they get a tile diamond, not their puffy frame). Measured
      // off the baked BODY box, never the frame: the frame also contains the
      // scepter blaze and the ember bolt, and neither is her. Texture space (so
      // `setScale` does not shift it), and origin does not either.
      const b = bank?.body ?? { x: 0, y: 0, width: sprite.width, height: sprite.height };
      // With an atlas idle under her, texture space changed: carry the bank's
      // BODY box through game space into the clip's frame so the hit area still
      // covers her lower body and nothing else.
      const idleClip = clipIdle ? clipFor(art, 'idle') : null;
      const box =
        idleClip && bank
          ? clipTextureRect(idleClip, {
              x: (b.x - bank.anchorX * bank.frameWidth) * standeeScale,
              y: (b.y - bank.anchorY * bank.frameHeight) * standeeScale,
              width: b.width * standeeScale,
              height: b.height * standeeScale
            })
          : b;
      sprite.setData('bodyBox', box);
      sprite.setInteractive(characterHitRect(box, false), Phaser.Geom.Rectangle.Contains);
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
    if (!this.anims.exists(key)) {
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(key, { start: 0, end: clip.frames - 1 }),
        frameRate: clip.fps,
        repeat: clip.loop ? -1 : 0
      });
    }
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
   * Play a ONE-SHOT reaction clip (cast / happy / laugh / a blink segment) and
   * settle back onto the rest look. The latest reaction wins — a second event
   * mid-flight replaces the first rather than queueing a stale emotion.
   */
  private playStandeeReaction(art: string, clipId: string): void {
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
    if (this.anims.exists(key)) return;
    const texture = bank.keys.cast;
    if (!this.textures.exists(texture)) return;
    this.anims.create({
      key,
      frames: this.anims.generateFrameNumbers(texture, { start: 0, end: bank.frameCount - 1 }),
      frameRate: bank.fps.cast,
      repeat: 0
    });
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
    // The Align-Studio CAST is the definitive answer to `character:action_used`
    // when pushed — the bank one-shot never doubles under it (one event, one
    // animation). The bank path below survives as the no-atlas fallback.
    if (this.characterSprites.get(characterId)?.active && this.ensureClipAnim(characterId, 'cast')) {
      this.playStandeeReaction(characterId, 'cast');
      return;
    }
    const sprite = this.characterSprites.get(characterId);
    const bank = STANDEE_BANKS[characterId];
    if (!sprite || !bank || !this.anims.exists(this.standeeAnimKey(characterId, 'cast'))) return;
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
    this.floatText(cam.midPoint.x, cam.midPoint.y - 260, 'Back in the satchel', PALETTE.cream);
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
      const r = characterHitRect(box, on);
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
  private ensureCrystal3D(): void {
    // A live three.js render every few frames for one board item. The painted
    // fallback texture is already there, so skipping this costs a highlight.
    if (!graphics.profile.crystal3d) return;
    // iOS Safari's renderer process crashes ("A problem repeatedly occurred") under
    // the memory of a SECOND live WebGL context plus its per-frame GPU→CPU readback
    // (drawImage of a WebGL canvas). Skip it there — the static `item_crystal_1` PNG
    // (loaded in preload) stays as the crystal texture, so the gem still renders 2D.
    if (IS_IOS) return;
    const map = this.ctx.state.map;
    const spec = map.decor3d?.find((d) => d.model3d)?.model3d ?? undefined;
    try {
      const crystal = new Crystal3D(spec ?? {});
      if (this.textures.exists('item_crystal_1')) this.textures.remove('item_crystal_1');
      this.crystalTex = this.textures.addCanvas('item_crystal_1', crystal.canvas) ?? undefined;
      if (!this.crystalTex) {
        crystal.dispose();
        return;
      }
      this.crystal3d = crystal;
    } catch (err) {
      console.warn('[Crystal3D] WebGL unavailable — keeping the 2D crystal art.', err);
    }
  }

  /**
   * Authored Three.js 3D-decor (`map.decor3d`, the world-builder's `3d` tab):
   * static scenery that wears the SAME live crystal texture as the generator.
   * Mirrors buildMapDecor — per-asset calibration + free-move dx/dy, y-sorted in
   * the item band, with a ground shadow. Skipped if the live texture never came
   * up (WebGL-less); the gem only shows where the world placed it.
   */
  private buildMapDecor3d(): void {
    const map = this.ctx.state.map;
    // Render wherever the crystal texture exists — the live 3D gem when present,
    // else the static PNG fallback (iOS / WebGL-less), so decor never silently drops.
    if (!map.decor3d?.length || !this.textures.exists('item_crystal_1')) return;
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
        .image(x + (cal.offsetX + (d.dx ?? 0)) * ratio, baseY, 'item_crystal_1')
        .setOrigin(cal.anchor?.x ?? 0.5, cal.anchor?.y ?? 0.72)
        .setScale((cal.scale ?? 1) * ratio)
        .setDepth(DEPTHS.itemBase + y);
      this.addGroundShadow(x, y, sprite.displayWidth, DEPTHS.itemBase + y - 1);
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
      const cost =
        this.ctx.state.map.regions.find((r) => r.id === regionId)?.unlock?.keys ?? 1;
      // During the tutorial only the key_unlock lesson may show a key at all.
      const gate = this.tutorialDone || this.tutorialStepId === 'key_unlock';
      const show = gate && this.ctx.state.keys >= cost;
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
    this.glideToWorld(badge.x, badge.y + 60, 850);
    cam.zoomTo(home.zoom * 1.16, 850, 'Sine.easeInOut');
    this.time.delayedCall(870, () => {
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
        cam.zoomTo(home.zoom, 700, 'Sine.easeInOut');
        this.glideToWorld(home.x, home.y, 700);
        this.time.delayedCall(730, () => this.playNextKeyReveal());
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
    const zone = this.add
      .zone(r.x + r.width / 2, r.y + r.height / 2, r.width, r.height)
      .setDepth(DEPTHS.itemBase + r.y + r.height)
      .setInteractive({ useHandCursor: true });
    zone.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!this.isTap(pointer)) return;
      this.tapClaimed = true;
      this.ctx.bus.emit('ui:emporium_requested', {});
    });
    // The tour's arrow lands over the roofline.
    this.tourTargets.set('roothold_house', { x: r.x + r.width / 2, y: r.y + 40 });
  }

  /** The hub tours' bouncing pointer over a board landmark. */
  private onTourPoint(target: string): void {
    this.clearTourArrow();
    const at = this.tourTargets.get(target);
    if (!at) return;
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
      if (bloom) door.fx.bloom();
      else door.fx.standIdle();
      this.widenDoor(door);
    }
    this.refreshPortals();
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

  /** The iso-diamond that lights up the cell a dragged item is hovering over. */
  private buildDragCell(): void {
    const g = this.add.graphics().setDepth(DEPTHS.tileHighlight).setVisible(false);
    g.fillStyle(DRAG.cellHighlightColor, DRAG.cellHighlightAlpha);
    g.lineStyle(3, DRAG.cellHighlightColor, Math.min(1, DRAG.cellHighlightAlpha + 0.3));
    const pts = [0, -TILE_H / 2, TILE_W / 2, 0, 0, TILE_H / 2, -TILE_W / 2, 0];
    g.fillPoints(this.diamond(pts), true);
    g.strokePoints(this.diamond(pts), true);
    this.dragCell = g;
  }

  private diamond(flat: number[]): Phaser.Geom.Point[] {
    const pts: Phaser.Geom.Point[] = [];
    for (let i = 0; i < flat.length; i += 2) pts.push(new Phaser.Geom.Point(flat[i], flat[i + 1]));
    return pts;
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
        obj.setData('dragged', true);
        obj.liftForDrag();
        // The sprite EASES toward this target in update() (Fairyland-style
        // weighted follow); seed it at the current pos so it doesn't jump.
        this.dragSprite = obj;
        this.dragTarget.x = obj.x;
        this.dragTarget.y = obj.y;
        this.dragCell.setVisible(true);
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
        if (!(obj instanceof BoardItem) || !this.dragFrom) return;
        this.dragSprite = null;
        this.dragCell.setVisible(false);
        // WYSIWYG: drop into the cell the highlight diamond showed (the dragged
        // item's tracked position), NOT the raw pointer — the two differ by the
        // grab offset, so pointer-based drops could land one tile off and
        // bounce home even though the item hovered a free tile.
        const to = worldToGrid(this.dragTarget.x, this.dragTarget.y + 24);

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
        if (
          this.wearsRigTier(obj.chain, obj.tier) &&
          (this.tutorialDone || this.allow.dragonWork) &&
          !this.ctx.systems.jobs.restRemaining(obj.itemId)
        ) {
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
            this.startDragonWork(obj, home, tgt); // work the EXACT house it was dropped on
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
      this.floatText(target.x, target.y - 190, 'It turns its head away', PALETTE.cream);
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
      ld.player.playFace(1); // a chirp for the meal
      ld.mode = 'hover';
      const span = ld.calm ? DRAGON_ANIM.adultCelebrateMs : DRAGON_ANIM.celebrateMs;
      ld.remainMs = favourite ? span * 2 : span;
    }
  }

  /** Exponential-smoothing follow + target-cell highlight for the live drag. */
  private updateDrag(delta: number): void {
    const s = this.dragSprite;
    if (!s) return;
    const k = 1 - Math.exp(-delta / DRAG.followTau);
    s.x += (this.dragTarget.x - s.x) * k;
    s.y += (this.dragTarget.y - s.y) * k;
    const cell = worldToGrid(this.dragTarget.x, this.dragTarget.y + 24);
    const { x, y } = gridToWorld(cell.col, cell.row);
    this.dragCell.setPosition(x, y);
  }

  /**
   * Drag empty ground to pan the big board; wheel to zoom. A pointer that lands
   * on an item or fog is left to the drag/tap handlers, so navigation never
   * fights gameplay.
   */
  private wireCameraNav(): void {
    const cam = this.cameras.main;
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
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
    // A HELD dragon flies: takeoff into the cruise loop on pick-up, the
    // wing-fold landing on release. Registered AFTER the main DRAG_END handler
    // so a drop that starts a work flight (busy) keeps its own arc instead of
    // landing into it. A sleeping dragon is dragged as its curled painting —
    // no flight. Runs on the same events, so no new input concepts.
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
        if (ld && !ld.busy && ld.flightPhase !== null) this.dragonLand(ld);
      }
    );
    this.input.on(Phaser.Input.Events.POINTER_UP, () => {
      if (this.pendingGive && !this.tapClaimed) this.cancelGive();
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
    if (this.tutorialDone) return true;
    return this.allow.drag.includes('*') || this.allow.drag.includes(sprite.chain);
  }

  /** Test hook (window.__emberkeep.itemToPage): world-space centre of the ART
   *  of the item on (col,row). Hit zones follow the art, not the tile — art can
   *  sit off the tile point (the wood log's opaque pixels miss the tile centre
   *  entirely), so pointer-driven tests must aim where a player would. */
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
  }

  private reskinChain(chain: string, wants: (item: BoardItemState) => boolean): void {
    for (const [id, sprite] of this.itemSprites) {
      const item = this.ctx.state.items.get(id);
      if (!item || item.chain !== chain || !wants(item)) continue;
      sprite.setArtTexture(
        this.textureFor(this.ctx.state.snapshot(item, this.ctx.clock.now())),
        this.ctx.data.anchors
      );
    }
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
    const artScale =
      snap.kind === 'decor'
        ? (DECOR_SCALE[snap.chain] ?? 1)
        : (ITEM_SCALE[`${snap.chain}_${snap.tier}`] ??
          ITEM_SCALE[snap.chain] ??
          this.tierArtScale(snap.chain, snap.tier) ??
          1);
    sprite.acquire(snap, this.ctx.data.anchors, this.textureFor(snap), artScale);
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
    if (COLLECTIBLE_REWARD[`${item.chain}_${item.tier}`] ?? COLLECTIBLE_REWARD[item.chain]) return false;
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
    // Collectible (a Gold coin): tap banks it — +Gold, a coin flies to the gauge
    // (UIScene), and the board coin is consumed.
    const collect = COLLECTIBLE_REWARD[`${item.chain}_${item.tier}`] ?? COLLECTIBLE_REWARD[item.chain];
    if (collect) {
      // Always collectable (even mid-tutorial) — banking a coin never interferes.
      this.ctx.bus.emit('economy:add', { coins: collect.coins, reason: 'collect' });
      // The Pouch bursts into THREE coins riding to the gauge (one gauge pulse
      // per arrival); a single coin sends one.
      const flight = item.chain === 'coin' && item.tier === 2 ? 3 : 1;
      this.ctx.bus.emit('gold:collected', { at: { col: item.col, row: item.row }, coins: flight });
      this.sparks.explode(8, sprite.x, sprite.y - 40);
      this.ctx.bus.emit('board:consume_items', { itemIds: [item.id], reason: 'sold' });
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
    if (DRAGON_RIGS[item.chain] && isGenerator && (this.tutorialDone || this.allow.dragonWork)) {
      this.selectSubject('dragon', String(item.id), false);
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
    if (this.altarElder) {
      this.altarElder.play('hover');
      this.altarElder.playFace(1);
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
      ld.player.setFacing(landX <= plant.x ? 'right' : 'left');
      this.dragonHover(ld, DRAGON_ANIM.flyToMs);
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
    const btn = this.add.container(sprite.x, sprite.y + 100).setDepth(DEPTHS.dragged - 1);
    // Caption shown on hover, telling the player which payment a button uses.
    const caption = this.add
      .text(0, -58, '', {
        fontFamily: FONT,
        fontSize: '28px',
        fontStyle: 'bold',
        color: '#fff6e0',
        stroke: '#241b22',
        strokeThickness: 5,
        backgroundColor: 'rgba(28,20,26,0.78)',
        padding: { x: 12, y: 5 }
      })
      .setOrigin(0.5)
      .setVisible(false);
    const make = (
      dx: number,
      tint: number,
      currency: 'gold' | 'warmth',
      method: string,
      text: string
    ): Phaser.GameObjects.Text => {
      const bg = this.add.image(dx, 0, 'ui_btn_green').setScale(0.46, 0.52).setTint(tint);
      const label = this.add
        .text(dx, -2, text, {
          fontFamily: 'Segoe UI, sans-serif',
          fontSize: '30px',
          fontStyle: 'bold',
          color: '#fff6e0',
          stroke: '#1f3a14',
          strokeThickness: 5
        })
        .setOrigin(0.5);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => caption.setText(method).setX(dx).setVisible(true));
      bg.on('pointerout', () => caption.setVisible(false));
      bg.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        this.ctx.bus.emit('generator:skip', { itemId: sprite.itemId, currency });
        this.hideSkipButton();
      });
      btn.add([bg, label]);
      return label;
    };
    // The gold button wears the REAL coin art (the 🪙 emoji read as a generic
    // token); the label carries only the price and sits right of the icon.
    this.skipGoldLabel = make(-150, 0xffffff, 'gold', 'Skip with Gold', `${skipEnergyCost(remaining, total, maxGold)}`);
    this.skipGoldLabel.setX(-150 + 22);
    btn.add(this.add.image(-150 - 34, -2, 'item_coin_1').setScale(0.1));
    this.skipWarmthLabel = make(150, 0xa9d6ff, 'warmth', 'Skip with Warmth', `⚡ ${skipWarmthCost(remaining, total, maxGold)}`);
    btn.add(caption); // on top of the buttons
    // Tutorial: bounce an arrow over the WARMTH (⚡) skip so the player learns to
    // pay the House's timer with energy (and watches their Warmth drop).
    if (this.tutorialStepId === 'house_skip') {
      // Small bounce hint over the ⚡ skip. Scaled to a ~74px height off the real
      // arrow art (222×400) — the down-pointing tip reads clearly at this size.
      const hint = this.add.image(150, -52, 'ui_arrow').setScale(0.185);
      btn.add(hint);
      this.tweens.add({
        targets: hint,
        y: -38,
        duration: 420,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    }
    this.skipButton = btn;
    this.skipForId = sprite.itemId;
  }

  /** Keep both skip prices in step as the timer drains. */
  private updateSkipCost(remaining: number, total: number): void {
    this.skipGoldLabel?.setText(`${skipEnergyCost(remaining, total, this.skipMaxGold)}`);
    this.skipWarmthLabel?.setText(`⚡ ${skipWarmthCost(remaining, total, this.skipMaxGold)}`);
  }

  private hideSkipButton(): void {
    this.skipButton?.destroy();
    this.skipButton = undefined;
    this.skipGoldLabel = undefined;
    this.skipWarmthLabel = undefined;
    this.skipForId = 0;
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
      this.floatText(sprite.x, sprite.y - 150, 'Nothing to work yet', PALETTE.cream);
      return;
    }
    this.busyDragons.add(sprite.itemId);
    const homePos = home ?? { x: sprite.x, y: sprite.y };
    const ld = this.liveDragons.get(sprite.itemId);
    const landX = house.x + 70; // land beside the building so the un-mirrored rig faces it
    if (ld) {
      ld.busy = true;
      ld.player.setFacing('left');
      this.dragonHover(ld, DRAGON_ANIM.flyToMs);
    }
    // Same beat as the harvest flourish: fly over, breathe a brief burst of
    // work-magic onto the building, and come STRAIGHT home. The job itself
    // (DragonJobSystem's speed-up + fatigue cycle) runs on its own clock and
    // never depended on the dragon standing there. Depth follows the flight
    // (see sendDragonFlourish) — never the always-on-top band.
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
      badge = this.add.container(sprite.x, sprite.y).setDepth(DEPTHS.flash);
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
    this.restBadges.get(dragonId)?.destroy();
    const sprite = this.itemSprites.get(dragonId);
    if (!sprite) return;

    const badge = this.add.container(sprite.x, sprite.y - 160).setDepth(DEPTHS.flash);
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
      ld.player.playFace(1); // a refreshed chirp
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
    // Spritesheets carry frame dimensions, so they cannot go through
    // `ensureTextures` (which only knows about plain images) — queue them here
    // and let that call start the single loader run for both.
    let queued = 0;
    for (const cfg of this.ctx.systems.characters.charactersIn(this.ctx.state.worldId)) {
      // The wardrobe key (`art ?? id`) names both the bank and its files —
      // Eleanor-at-home fetches Eleanor's own sheets.
      const art = cfg.art ?? cfg.id;
      // Her Align-Studio atlas clips travel with her banks — same door, same
      // loader run, and worldArtKeys lists them for the matching eviction.
      for (const [clipId, clip] of Object.entries(clipsFor(art))) {
        if (this.textures.exists(clipKey(art, clipId))) continue;
        this.load.spritesheet(clipKey(art, clipId), clip.file, {
          frameWidth: clip.frameWidth,
          frameHeight: clip.frameHeight
        });
        queued++;
      }
      const bank = STANDEE_BANKS[art];
      if (!bank) continue;
      for (const [name, key] of Object.entries(bank.keys)) {
        if (this.textures.exists(key)) continue;
        this.load.spritesheet(key, `sprites/${art}/world-${name}.webp`, {
          frameWidth: bank.frameWidth,
          frameHeight: bank.frameHeight
        });
        queued++;
      }
    }
    if (queued === 0) {
      // Nothing but (possibly) the backdrop: `ensureTextures` handles both the
      // already-resident case and the fetch, and calls back either way.
      ensureTextures(this, this.ctx, fetchable, onReady);
      return;
    }
    // Sheets are already queued, so the callback has to hang off THIS loader run
    // — handing the backdrop to `ensureTextures` would let it fire `onReady`
    // synchronously when the backdrop happens to be resident, restarting the
    // scene while the sheets were still in flight.
    for (const key of fetchable) {
      const entry = this.ctx.data.assets.images.find((e) => e.key === key);
      if (this.textures.exists(key) || entry?.source !== 'file' || !entry.file) continue;
      this.load.image(key, entry.file);
    }
    this.load.once(Phaser.Loader.Events.COMPLETE, onReady);
    this.load.start();
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
      bus.on('world:switched', () => this.fetchWorldArt(() => this.scene.restart())),
      bus.on('store:skin_changed', () => this.applyManorSkin()),
      bus.on('store:dragon_skin_changed', ({ dragon }) => this.applyDragonSkin(dragon)),
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
      bus.on('item:moved', ({ itemId, to }) => {
        const sprite = this.itemSprites.get(itemId);
        if (!sprite) return;
        sprite.col = to.col;
        sprite.row = to.row;
        const { x, y } = gridToWorld(to.col, to.row);
        this.tweens.add({
          targets: sprite,
          x,
          y,
          duration: TIMINGS.dragReturn,
          ease: 'Back.easeOut',
          onComplete: () => sprite.settleDepth()
        });
        sprite.settleFromDrag();
      }),
      bus.on('item:move_bounced', ({ itemId, at }) => {
        const sprite = this.itemSprites.get(itemId);
        if (!sprite) return;
        const { x, y } = gridToWorld(at.col, at.row);
        this.tweens.add({
          targets: sprite,
          x,
          y,
          duration: TIMINGS.dragReturn,
          ease: 'Back.easeOut',
          onComplete: () => sprite.settleDepth()
        });
        sprite.settleFromDrag();
      }),
      bus.on('item:merged', (payload) => this.onMerged(payload)),
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
      bus.on('item:harvest_failed', ({ generatorId, reason }) => {
        const sprite = this.itemSprites.get(generatorId);
        if (sprite) sprite.flashDenied();
        if (reason === 'no_space' && sprite) {
          this.floatText(sprite.x, sprite.y - 140, 'No room!', PALETTE.cream);
        }
      }),
      bus.on('bag:give_armed', ({ chain, tier }) => this.armGive(chain, tier)),
      bus.on('ui:reveal_toggled', ({ open }) => this.onRevealToggled(open)),
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
        this.tweens.add({
          targets: sprite,
          alpha: 0,
          scale: 0.6,
          duration: 150,
          ease: 'Sine.easeIn',
          onComplete: () => sprite.release()
        });
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
      bus.on('tutorial:step', (step) => {
        this.allow = step.allow;
        this.tutorialDone = step.done;
        this.tutorialStepId = step.id;
        this.refreshAllDraggable();
        // Travel is barred for the whole tutorial, so the doors come alive on
        // the step that ends it — not on a later reload. Order 1 was delivered
        // MID-tutorial, so the Ember Gate blooms right here, as the game hands
        // over: the first thing free play shows is a new door.
        this.syncPortalFx(true);
        this.setHighlights(step.highlight);
        // Key badges: earned into view (held keys ≥ region cost) — quiet here,
        // because the tutorial's own script stages the key_unlock beat.
        this.syncKeyBadges(false);
        // Glide the camera to show the crystal when the player must tap it.
        if (step.id === 'crystal_tap') {
          const crystal = [...this.ctx.state.items.values()].find((i) => i.chain === 'crystal');
          if (crystal) {
            const w = gridToWorld(crystal.col, crystal.row);
            this.glideToWorld(w.x, w.y, 900);
          }
        }
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

  /** Shell-crack flash, spark confetti, then the hatchling pops in. */
  /**
   * The whelp waits behind her own introduction.
   *
   * The reveal card goes up in the same `item:hatched` emit that runs this
   * ceremony (RevealSystem is subscribed first), so without holding the hatch
   * the player would find her already standing on the board when the card
   * closes — the card would be announcing something they had watched happen
   * behind a scrim. Held here, the order reads the way it should: three eggs
   * fuse, the isle stops to name what came out, and THEN she is standing there.
   */
  private heldHatches: ItemSnapshot[] = [];

  private onRevealToggled(open: boolean): void {
    this.revealOpen = open;
    if (open) return;
    const held = this.heldHatches;
    this.heldHatches = [];
    for (const snap of held) this.hatchSequence(snap);
  }

  private revealOpen = false;

  private hatchSequence(snap: ItemSnapshot): void {
    if (this.revealOpen) {
      this.heldHatches.push(snap);
      // Never lost to a card that fails to close: the ceremony runs anyway once
      // the longest a card can hold has passed.
      this.time.delayedCall(REVEAL_HOLD_BACK_MAX_MS, () => {
        if (this.heldHatches.includes(snap)) this.onRevealToggled(false);
      });
      return;
    }
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
      .setScale(ITEM_SCALE[`${snap.chain}_${snap.tier - 1}`] ?? ITEM_SCALE[snap.chain] ?? 1)
      .setDepth(DEPTHS.itemBase + y);
    this.tweens.add({
      targets: ghost,
      x: x + 3,
      angle: 4,
      duration: 60,
      yoyo: true,
      repeat: Math.floor(TIMINGS.hatchShake / 120),
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
    ld.player.playFace(1); // one happy mouth-flap as the gift pops out
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
    for (const ld of this.liveDragons.values()) {
      ld.clipOverlay?.destroy();
      ld.player.destroy();
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
    // Re-frame the camera on the loaded Keeper level (no glide).
    const frame = this.frameForLevel(this.ctx.state.level);
    this.cameras.main.setZoom(Math.max(frame.zoom, this.minZoom) * renderScale.value);
    this.cameras.main.centerOn(frame.x, frame.y);
    this.tutorialDone = this.ctx.state.tutorialDone;
    this.syncKeyBadges(false); // a load restores a STATE — no cinematic replay
    this.syncGoldenAltar();
  }

  /* ----------------------------- helpers ---------------------------- */

  /** Smooth tween to any world position (keeps current zoom). */
  private glideToWorld(worldX: number, worldY: number, duration = 900): void {
    const cam = this.cameras.main;
    const from = { x: cam.midPoint.x, y: cam.midPoint.y };
    this.flyTween?.stop();
    const proxy = { t: 0 };
    this.flyTween = this.tweens.add({
      targets: proxy,
      t: 1,
      duration,
      ease: 'Sine.easeInOut',
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
