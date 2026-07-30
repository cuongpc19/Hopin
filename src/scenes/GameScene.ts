import Phaser from "phaser";
import { COLORS, TEXT_LIGHT, shade } from "../game/palette";
import {
  makeLevel,
  HARD_ROCK,
  isObstacle,
  isBigObstacle,
  obstacleKind,
  softHp,
  isRemovable,
  type Chest,
  type Level,
  type TrackKind,
} from "../game/level";
import { Audio } from "../game/audio";
import {
  awardClovers,
  isEventUnlocked,
  isEventComplete,
  cloversForWin,
  rewardLabel,
  CLOVER_ICON,
  EVENT_NAME,
  EVENT_UNLOCK_LEVEL,
  type EventReward,
} from "../game/cloverEvent";

// Logical design resolution (portrait phone). Width is fixed; height flexes to
// the device's real aspect ratio so the game fills the screen top-to-bottom
// instead of showing letterbox bars. Clamped to a sane portrait range so a
// landscape/desktop window still renders as a phone-shaped board (with side bars).
export const GAME_W = 480;
const _aspect =
  typeof window !== "undefined" && window.innerWidth > 0
    ? window.innerHeight / window.innerWidth
    : 854 / 480;
export const GAME_H = Math.round(GAME_W * Math.min(Math.max(_aspect, 1.6), 2.3));

// A node on the "Line" (the track around the grid).
interface TrackNode {
  x: number;
  y: number;
}

// Precomputed board dimensions (depend only on the grid size).
interface BoardMetrics {
  frameW: number;
  frameH: number;
  ringW: number;
  ringH: number;
}

interface ChestView {
  chest: Chest; // chest.count = seats still shown (decremented when a critter boards)
  container: Phaser.GameObjects.Container;
  countText: Phaser.GameObjects.Text;
  carImg: Phaser.GameObjects.Image; // the pre-coloured car sprite (rotated to follow the road)
  inFlight: number; // critters dispatched to this car but not yet aboard (gates over-collecting)
  left?: boolean; // car has driven off (guard against double-finish)
  waiting?: boolean; // parked at route's end, waiting for its last runners → they rush in
  group?: ChestView[]; // linked car group (2=twin, 3=triple, …): always launches / drives / parks / leaves together, in this order. Undefined = solo.
  launchAt?: number; // don't spawn onto the track before this time (lets the launch hop play)
  armAt?: number; // auto-relaunch telegraph started at (this.time.now); car bobs to signal it's about to hop out
  armTweens?: Phaser.Tweens.Tween[]; // the telegraph bob/pulse tweens (stopped on launch/disarm)
  armFx?: Phaser.GameObjects.GameObject[]; // extra telegraph objects (up-arrow, ring) destroyed on disarm
  qMark?: Phaser.GameObjects.Text; // the "?" cover of a BURIED car (destroyed on reveal)
  traySlot?: number; // TRAY mode: the bay this car is RESERVED in while it darts out to collect (returns here; freed only when it leaves empty)
}

// A chest currently travelling on the Line.
interface ActiveChest {
  view: ChestView;
  pos: number; // fractional index along the track ring
  lastNode: number;
  steps: number; // nodes entered since it started this trip
  lastShot: number; // timestamp (ms) of the last shot
  heading?: number; // smoothed travel angle (rad) — lerped so corners look fluid
  approaching?: boolean; // fresh from the queue: drive faster until the first pickup
  parkPending?: boolean; // route finished; holding still until its runners board, then park
  finishing?: boolean; // route finished but still driving a bit while last runners board
  entering?: boolean; // gliding from its bay/lineup onto the track entrance (don't drive yet)
}

// A collected critter running (with shuffling legs) to board its car.
interface Runner {
  node: Phaser.GameObjects.Container; // the critter tile, now running
  body: Phaser.GameObjects.Image; // the critter body sprite (bobbed independently of legs)
  car: ChestView; // the car it is boarding (view persists across park/relaunch)
  spd: number;
  legL: Phaser.GameObjects.Graphics;
  legR: Phaser.GameObjects.Graphics;
  phase: number;
  lastSwing?: number; // sign of the last leg swing (for footfall dust)
  tx: number; // last known car position (car keeps moving / may leave)
  ty: number;
  nice?: boolean; // rare "Nice!" slime: fills a car's last seat, grows bigger, pops a banner
}

const SLOT_COUNT = 5;
const SLOT_SIZE = 54; // waiting bay size (bumped up so the parked car sits comfortably)
// Fixed car size — the SAME on every level (independent of the grid's cell size,
// which changes with the level's rows/cols). ~30% bigger than the old sizing.
const CAR_SIZE = 55;
const TRACK_STEP = 16; // px between adjacent track nodes (uniform spacing)
const MAX_ON_TRACK = 5; // hard cap on cars travelling the ray at the same time
// AUTO-DRIVE (user 2026-07-24): cars self-manage so the player taps far less.
//  1) a car that finishes its lap KEEPS circling while it can still collect more of
//     its colour; it only retires to a waiting bay once nothing is left to grab.
//  2) a parked car auto-hops back onto the ray when there's collectable work for its
//     colour and no other car of that colour is already handling it (track cap still 5).
// Set to false to ROLL BACK to the old "park at end of every lap, tap to relaunch".
// DISABLED 2026-07-25 (user): auto-drive made the win-rate landscape binary/untunable and
// broke level-difficulty design — reverted to manual. Flip back to true to re-enable
// (all the auto-drive code below stays behind this flag). See [[auto-drive-mechanic]].
const AUTO_CIRCLE = false;
// TRAY BATCH mode (user 2026-07-26): the redesign of TRAY levels. Instead of each bay car
// auto-firing the instant its colour is reachable, staged cars sit STILL in the bays; the
// player presses a GO button to launch the WHOLE batch (every bay car) at once. The batch
// circles the ray as ONE squad — it keeps looping as long as ANY member can still collect
// (so one car peeling an outer ring surfaces a teammate's colour → the batch chains). When
// no member can collect anymore (fixed point), emptied cars leave and still-blocked cars
// return to their reserved bays for the next batch. Bays are LOCKED while a batch runs.
// This is MORE deterministic than the old auto-fire tray → an accurate win-rate gauge.
// Set false to roll back to the old auto-fire tray (autoRelaunchBays handles that path).
const TRAY_BATCH = true;
// TRAY_BATCH: how long the whole batch must go with ZERO collection (no member firing)
// before it's judged "done" and all still-blocked cars park back to their bays together.
// Long enough to bridge a productive car's travel gap between slime clusters (so it doesn't
// end mid-run), short enough that the end-of-batch idle circling stays brief.
const BATCH_END_GRACE = 1600;
// A parked car that becomes free to hop back onto the ray first BOBS in place for
// this long (a visible "get ready, I'm about to jump out" tell) before it launches,
// so the auto-relaunch never surprises the player. Set small to make it snappier.
const AUTO_RELAUNCH_TELEGRAPH_MS = 520;
const SPEED = 15.6; // track nodes per second (car travel speed — slam: reverted to pre-bump slower speed, user 2026-07-28)
const MIN_GAP = 5; // min spacing between cars, in nodes (bigger cars need more room)
const TWIN_SPAWN_GAP = 5; // nodes between a twin pair on the ray (snug but the rope still shows)
const TWIN_INTRO_LEVEL = 8; // the ONE level that introduces twin cars (skip if you're past it)
const BELT_SPEED = 6; // Line belt cleats: nodes per second
const SHOT_COOLDOWN = 10; // ms between pickups — slam: near frame-rate cap (~1 slime/frame @60fps)
// Critter "run to the car" animation: sets off, accelerates to catch the moving
// car. RUN_MAX must comfortably exceed car speed (SPEED * TRACK_STEP px/s).
const RUN_START = 320;   // snappier: critters set off faster (user 2026-07-29 — quicker "see + grab")
const RUN_ACCEL = 1100;
const RUN_MAX = 950;
// Direction the car sprite art faces, in radians (0 = right/East). Tune if the
// car points the wrong way as it drives: right=0, up=-PI/2, left=PI, down=PI/2.
const CAR_ART_FACING = Math.PI / 2; // car art faces UP (face at top); +90° so the face leads travel

// Buried "?" car cover: a SOLID light-blue silhouette (setTintFill) that HIDES the real
// colour entirely — every buried car looks the same until it's revealed (user 2026-07-25:
// "cho k nhìn thấy màu gì luôn, default xanh nhạt cho tất cả").
const BURIED_TINT = 0xa9d0f0;
// Skin for permanent hard-rock walls. Mechanic is unchanged — the wall is still an
// unbreakable, sight-blocking HARD_ROCK; this only picks its texture. The smooth tan
// "rock-soft" reads cleaner than the grey rock against the grey slime field.
//   "rock-soft" (tan, smooth) · "rock-hard" (grey) · "rock-soft-cracked" (grey, cracked)
const WALL_TEXTURE = "rock-hard";

// Draw-order layers: background < road < grid tiles < twin-rope < cars < runners.
const DEPTH_BG = -100;
const DEPTH_ROAD = -50;
// Board tiles sit at the default depth 0. The twin rope must sit ABOVE them (so it
// shows when it stretches across the grid) but BELOW the cars' seat numbers (so it
// never covers them). Cars in turn stay below the runners (5) so a slime still hops
// visibly ON TOP of the car as it boards.
const DEPTH_CAR = 2; // every car container (lineup); track cars raise to DEPTH_RUNNER+5
// twin/group rope: ABOVE the cars so it's visible even between ADJACENT cars in the
// lineup (where a below-car rope hid behind them). It anchors on each car's facing EDGE
// and runs STRAIGHT through the gap, so it stays clear of the centred seat numbers.
const DEPTH_TWINLINK = 11;
const DEPTH_RUNNER = 5;

// Boosters unlock one-by-one as the player climbs. The first time you reach a
// booster's unlock level you're GIFTED one free (with a tutorial). After that,
// buy more with gold at `cost`. Before its unlock level, the button is disabled.
interface BoosterDef {
  key: string; // inventory / save key
  img: string; // texture key
  label: string; // button label (English)
  cost: number; // gold to buy another once you own none
  unlock: number; // level it first appears at
  title: string; // tutorial title
  desc: string; // tutorial body (English)
}
const BOOSTERS: BoosterDef[] = [
  {
    key: "add", img: "booster-add", label: "Add", cost: 300, unlock: 6,
    title: "New Booster: Add!",
    desc: "Adds an extra waiting bay, so one more car can park at a time.",
  },
  {
    key: "hand", img: "booster-hand", label: "Grab", cost: 500, unlock: 11,
    title: "New Booster: Grab!",
    desc: "Instantly send out ANY car from the queue — skip the front-only rule.",
  },
  {
    key: "refresh", img: "booster-refresh", label: "Shuffle", cost: 600, unlock: 16,
    title: "New Booster: Shuffle!",
    desc: "Re-rolls the colors of the queued cars, bringing up a color you need.",
  },
  {
    key: "magnet", img: "booster-magnet", label: "Magnet", cost: 600, unlock: 21,
    title: "New Booster: Magnet!",
    desc: "Tap a slime and a VIP car reels in the whole connected cluster of that color.",
  },
];
const FREE_GIFT = 3; // free copies granted the first time you reach a booster's unlock level

// Textures for obstacle tiles + special cars; placeholder-drawn until real PNGs exist.
const OBSTACLE_ART_KEYS = ["rock-hard", "rock-soft", "rock-soft-cracked", "wood", "car-hammer", "car-wood"];

export class GameScene extends Phaser.Scene {
  private level!: Level;
  private levelNum = 1;
  private cell = 0;
  // The cell size a STANDARD 25×25 board would get in this layout. On big "picture"
  // boards this.cell shrinks to fit, but runners (critters sprinting to the car) are
  // scaled to stdCell so they stay the SAME size as on a 25×25 level.
  private stdCell = 0;
  private chestSize = 48;
  private gridX = 0; // top-left of the grid area
  private gridY = 0;

  // keys[r*cols+c] = the key display object, or null once collected
  private keys: (Phaser.GameObjects.Container | null)[] = [];
  private keysRemaining = 0;
  // Cells whose slime is still a hidden "?" (real colour unknown to the player, in
  // level.hidden). Untargetable until a 4-neighbour opens, then revealed.
  private hiddenSet = new Set<number>();

  private track: TrackNode[] = [];
  private startIndex = 0;

  private active: ActiveChest[] = [];
  private pending: ChestView[] = []; // chests waiting to enter the Line
  // zone 3: one vertical queue per column; only the front (top) chest is clickable
  private invColumns: ChestView[][] = [];
  private invTop = 0;
  private invStartX = 0;
  private invGapX = 30;
  private invGapY = 16;
  private invVisRows = 2; // inventory rows shown before the mask clips (flexes to fit ≤40%)
  private invPeek = 0; // px of the next (partly-hidden) row the mask reveals
  private invMask?: Phaser.Display.Masks.GeometryMask;
  private invMaskG?: Phaser.GameObjects.Graphics;
  private invMaskBottom = 0; // y below which a queue car is clipped/hidden by the inventory viewport
  private slots: (ChestView | null)[] = [];
  // TRAY mode (level.tray): one-way bays — clicking a queue car stages it into the next
  // empty bay (never straight to the ray), and bay cars AUTO-launch when their colour is
  // reachable (no manual relaunch / juggle). Set per level in create().
  private trayMode = false;
  // SLAM (lock) mode (level.slam): built ON TOP of the tray bay system. Bays AUTO-FILL from
  // the queue; the player TAPS a bay car to send it onto the ray, which LOCKS (reserves) its
  // bay (traySlot) — the car keeps its progress and returns to that bay if it can't fill, or
  // frees the bay when it fills and leaves. Multiple cars run at once. No auto-launch, no GO
  // batch. Lose = deadlock (no bay car can collect + no fresh car can enter).
  private slamMode = false;
  // Playtest telemetry (slam): record the player's launch decisions + bay pressure + result so real
  // play can be compared to the model / difficulty tools. Dumped as [HOPLOG] JSON to the console and
  // accumulated in localStorage("hopin_playlog"). In the browser console: hopLog() to dump, hopLogClear().
  private playLog: { ev: string; [k: string]: unknown }[] = [];
  private playStart = 0;
  private peakUsed = 0;
  // TRAY_BATCH: a batch (the whole set of bay cars) is currently out circling the ray.
  // While true the bays are locked (no staging) and the GO button is disabled; flips back
  // to false once every batch car has left the ray (leaving or returning to its bay).
  private batchRunning = false;
  private goBtn?: Phaser.GameObjects.Container; // the "GO" button that launches the batch
  private goBtnBg?: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
  private goBtnEnabled = false; // cached enabled state so we only restyle on change
  private batchLastProgress = 0; // this.time.now of the last collection by any batch car (stale-timer)
  private audioCtx?: AudioContext; // lazily created for synthesized SFX (pop)
  private slotXs: number[] = [];
  private slotY = 0;
  private slotCount = SLOT_COUNT; // grows when the "Add" booster is used
  private slotTiles: Phaser.GameObjects.Image[] = []; // the bay sprites (re-laid on Add)
  private slotLocks: Phaser.GameObjects.Image[] = []; // SLAM: dimmed "reserved car" shown on a bay whose car is out
  private slotWarnActive = false; // waiting bays all full → flashing a warning
  private slotWarnG: Phaser.GameObjects.GameObject[] = []; // the pulsing warning rings
  private handMode = false; // "Hand" booster armed: next tap picks a queued car
  private handMarks: Phaser.GameObjects.GameObject[] = []; // rings recommending back-row cars
  private magnetMode = false; // "Magnet" booster armed: next tap picks a slime colour
  private boosterCounts: Record<string, number> = {}; // owned count per booster key
  private boostBar?: Phaser.GameObjects.Container; // holds the booster buttons (rebuilt on change)
  private boostBarTop = 0; // y where the booster row is laid out
  private boostBarH = 0;
  private beltMarks?: Phaser.GameObjects.Graphics;
  private beltOffset = 0;
  private beltThickness = 0;
  private beltLeft = 0;
  private beltRight = 0;
  private beltTop = 0;
  private beltBottom = 0;
  private roadRadius = 0; // corner radius of the rounded road (track follows it)
  private trackKind: TrackKind = "square"; // road shape for the current level

  private runners: Runner[] = []; // critters running to board a car

  // Level-1 tutorial: step 1 = tap a queued car; step 2 = tap the car that parked.
  private tutStep = 0;
  private tutObjs: Phaser.GameObjects.GameObject[] = [];
  private tutPaused = false; // a tutorial is up → freeze the game until the player acts
  private tutHand?: Phaser.GameObjects.Text; // the bobbing 👆 (re-animated on a mis-tap)
  private tutHandY = 0; // the hand's resting Y (bob baseline)
  // STEP GUIDE (user 2026-07-30): optional setting (default OFF, localStorage "hopin_guide").
  // When ON, the game points at the recommended next move — tap this bay car / launch this queue
  // car — recomputed after every action until the level is won. Uses the greedy solver priority.
  private guideMode = false;
  private guideHand?: Phaser.GameObjects.Text;
  private guideRing?: Phaser.GameObjects.Arc;
  private guideKey = ""; // identity of the current suggestion (avoid re-tweening every frame)
  private guideAt = 0;   // last recompute time (throttle)
  private tutBooster?: { list: BoosterDef[]; idx: number; key: string }; // active booster tutorial

  private signalCount?: Phaser.GameObjects.Text; // "N/5" on the start-signal's green light
  private signalPost?: Phaser.GameObjects.Container; // the whole start-signal (bounced when full)
  private carGroups: ChestView[][] = []; // linked car groups (2=twin, 3=triple, …)
  private twinLinkG?: Phaser.GameObjects.Graphics; // the holding-hands link, redrawn each frame

  private won = false;
  private lost = false; // waiting queue overflowed → game over
  // Lucky Clover: true once the player has lost/replayed the CURRENT level attempt,
  // so a later win counts as 1 rock (not a clean 2-rock First-Try win). Reset only
  // on a fresh entry from the map (create), NOT on the in-place Replay.
  private failedThisAttempt = false;

  private gold = 0; // player's currency (persists across levels + reloads)
  private goldText?: Phaser.GameObjects.Text;

  private startAt?: number; // level chosen on the picker (via scene.start("game", {level}))
  private missingSlime = new Set<number>(); // color ids whose slime-*.png is absent → drawn procedurally
  private missingArt = new Set<string>(); // obstacle / special-car texture keys with no PNG → placeholder

  constructor() {
    super("game");
  }

  // Level to boot into, passed from the level-select screen.
  init(data: { level?: number }) {
    this.startAt = data?.level;
  }

  // An "open" track (line / U / arch) is traversed once and the car parks at the
  // end; a loop (square / rect) is circled. Both non-looping shapes share logic.
  private get openTrack() {
    return this.trackKind === "line" || this.trackKind === "u" || this.trackKind === "arch";
  }

  preload() {
    this.load.image("background", "art/background.png");
    this.load.image("road-straight", "art/road-straight.png");
    this.load.image("road-corner", "art/road-corner.png");
    this.load.image("slot", "art/ocho.png"); // grass-framed dirt parking bay (waiting slot)
    this.load.image("start-signal", "art/start-signal.png"); // start marker at the car spawn
    this.load.image("victory", "art/victory.png"); // win-screen hero art
    this.load.image("out-of-space", "art/outofspace.png"); // queue-full (lose) hero art
    this.load.image("car-vip", "art/car-vip.png"); // golden/purple VIP car for the Magnet booster
    for (const b of ["add", "hand", "refresh", "magnet"]) {
      this.load.image(`booster-${b}`, `art/booster-${b}.png`);
    }
    // Obstacle tiles + the special cars. Any of these with no PNG yet falls back to
    // a procedurally-drawn placeholder (detected in create(), see makePlaceholderTexture),
    // so obstacle levels are fully playable before the real art is dropped in.
    for (const k of OBSTACLE_ART_KEYS) this.load.image(k, `art/${k}.png`);
    // A colour whose slime-*.png doesn't exist yet (e.g. the expanded palette 11-18)
    // is drawn procedurally in create() so its tiles still render.
    this.load.on("loaderror", (file: Phaser.Loader.File) => {
      if (file.key.startsWith("slime-")) this.missingSlime.add(parseInt(file.key.slice(6), 10));
      else this.missingArt.add(file.key);
    });
    for (let i = 0; i < COLORS.length; i++) {
      this.load.image(`slime-${i}`, `art/slime-${i}.png`);
      this.load.image(`car-${i}`, `art/car-${i}.png`); // one pre-coloured car per color id
    }
  }

  create() {
    // The canvas is DPR times bigger than the world; zoom the camera back so
    // code keeps working in 480x854 units while rendering at full resolution.
    const dpr = this.scale.gameSize.width / GAME_W;
    this.cameras.main.setZoom(dpr);
    this.cameras.main.centerOn(GAME_W / 2, GAME_H / 2);
    this.cameras.main.setBackgroundColor(0xbfe3a0);
    this.gold = this.loadGold();
    // One-time wallet reset: everyone starts from a clean 0 (wipes leftover dev/test
    // gold once). After this, wins accumulate normally and the balance persists.
    try {
      if (localStorage.getItem("pf_gold_reset") !== "1") {
        this.gold = 0;
        this.saveGold();
        localStorage.setItem("pf_gold_reset", "1");
      }
    } catch {
      /* storage unavailable — just run with the in-memory balance */
    }
    this.boosterCounts = this.loadBoosterCounts();
    // Draw a placeholder slime for any colour that has no slime art yet (palette 11-18).
    for (const i of this.missingSlime) this.makeSlimeTexture(i);
    // FACELESS board tiles (user 2026-07-26): the PNG slimes have a baked-in face that
    // makes the "picture" noisy. Board cells now render as flat bevelled colour tiles
    // (no face) → clean mosaic; faces stay only on the cars/chests in the tray.
    for (let i = 0; i < COLORS.length; i++) this.makeTileTexture(`tile-${i}`, COLORS[i]);
    this.makeTileTexture("tile-hidden", 0xeef3f8); // white blank for the "?" cover
    // Placeholder art for obstacle / special-car textures. NOTE: Vite's dev server
    // returns 200 (index.html) for a missing PNG, so `loaderror` is unreliable —
    // instead detect a missing/broken texture directly and draw a placeholder.
    for (const k of OBSTACLE_ART_KEYS) {
      const tex = this.textures.get(k);
      const src =
        tex && tex.key !== "__MISSING"
          ? (tex.getSourceImage() as HTMLImageElement | HTMLCanvasElement | null)
          : null;
      const valid = !!src && src.width > 4 && src.height > 4;
      if (!valid) {
        this.missingArt.add(k);
        this.makePlaceholderTexture(k);
      }
    }
    // Auto-trim each car sprite's transparent padding → consistent on-screen size
    // regardless of how the art is exported (and rotation stays centred).
    for (let i = 0; i < COLORS.length; i++) this.trimTexture(`car-${i}`);
    this.trimTexture("car-vip");
    this.trimTexture("car-hammer");
    this.trimTexture("car-wood");
    this.trimTexture("start-signal");
    // Keep the audio context unlocked (SFX only — no background music) in case the
    // game was opened directly without a prior gesture.
    Audio.unlock();
    this.input.on("pointerdown", () => Audio.unlock());

    // Level to start: picker choice > ?level=N (dev) > level 1.
    const q = parseInt(new URLSearchParams(location.search).get("level") ?? "", 10);
    const fromUrl = Number.isFinite(q) && q > 0 ? q : undefined;
    this.failedThisAttempt = false; // fresh entry from the map → a clean First-Try win is possible
    this.startLevel(this.startAt ?? fromUrl ?? 1);
  }

  private startLevel(levelNum: number) {
    this.levelNum = levelNum;
    this.playLog = []; this.playStart = (typeof performance !== "undefined" ? performance.now() : 0); this.peakUsed = 0;
    try { this.guideMode = localStorage.getItem("hopin_guide") === "1"; } catch { this.guideMode = false; }
    this.guideKey = ""; this.guideHand = undefined; this.guideRing = undefined;
    if (typeof window !== "undefined") { (window as any).hopLog = () => console.log(localStorage.getItem("hopin_playlog") || "[]"); (window as any).hopLogClear = () => localStorage.removeItem("hopin_playlog"); }
    // "start" streams AFTER makeLevel below (needs this.level); see the postLog("start") call there.
    this.children.removeAll();
    this.tweens.killAll();
    this.active = [];
    this.pending = [];
    this.invColumns = [];
    if (this.invMaskG) {
      this.invMaskG.destroy();
      this.invMaskG = undefined;
      this.invMask = undefined;
    }
    this.slotCount = SLOT_COUNT;
    this.slots = new Array(this.slotCount).fill(null);
    this.slotTiles = [];
    this.slotLocks = []; // children.removeAll() already destroyed old lock icons
    this.slotWarnActive = false; // children.removeAll() already destroyed old rings
    this.slotWarnG = [];
    this.handMode = false;
    this.handMarks = [];
    this.magnetMode = false;
    this.keys = [];
    this.track = [];
    this.runners = [];
    this.won = false;
    this.lost = false;
    this.tutObjs = [];
    this.tutStep = 0;
    this.tutPaused = false;
    this.tutHand = undefined;
    this.tutBooster = undefined;
    this.carGroups = [];

    this.buildBackground();
    // Twin "hands" link. Sits ABOVE the board tiles (so it stays visible when it
    // stretches across the grid — top edge, or twins in different queue rows) but
    // BELOW the cars (DEPTH_CAR) so it never covers a car's seat number. At the old
    // depth of -1 it hid behind the board; at DEPTH_RUNNER+4 it covered the numbers.
    this.twinLinkG = this.add.graphics().setDepth(DEPTH_TWINLINK);

    this.level = makeLevel(levelNum);
    this.slamMode = this.level.slam === true; // lock mode (tap bay cars; slot locks while out)
    this.trayMode = this.level.tray === true || this.slamMode; // slam reuses the tray bay system
    this.postLog({ ev: "start", cars: this.level.chests.length, twins: new Set(this.level.chests.filter((c) => c.pairId != null).map((c) => c.pairId)).size, buried: this.level.chests.filter((c) => (c as unknown as { buried?: boolean }).buried).length });
    // SLAM: ALWAYS 5 waiting slots (the "Add" booster grows it to 6). No per-level bays.
    // Win when all REMOVABLE cells are gone (slimes + wood + soft rock). Hard rocks
    // stay forever and are not counted. A 2-layer cell counts TWICE (top + hidden bottom).
    this.keysRemaining =
      this.level.board.filter((v) => isRemovable(v)).length +
      (this.level.layer2 ? this.level.layer2.filter((v) => v >= 0).length : 0);
    // "?" slimes start hidden (scene restart safe — rebuilt from the level data).
    this.hiddenSet.clear();
    if (this.level.hidden) this.level.hidden.forEach((v, i) => { if (v >= 0) this.hiddenSet.add(i); });

    // Top HUD (like the real Pixel Flow): settings (left) · level pill (center) ·
    // gold (right).
    this.buildTopBar(levelNum);

    // Queue lines per level ("3 line / 5 line", user 2026-07-25): fewer columns =
    // fewer front cars to pick from = harder. Designed levels set `lanes`; default 4.
    const perRow = Phaser.Math.Clamp(this.level.lanes ?? 4, 2, 6);
    const chest = CAR_SIZE;

    const hudH = 58; // top HUD strip
    const gTop = 10; // gap below the HUD
    const gBoard = 20; // breathing room between the board and the waiting slots (small → board grows)
    const gSlots = 18;
    const gInv = 10; // small gap — the freed space goes into the row-3 peek, not empty air
    const boostH = 78;
    const margin = 6;

    // Bottom cluster (waiting slots → inventory → boosters) is capped at 40% of the
    // screen height — the board (zone 1) takes everything else. If the cap is tight,
    // the inventory shows fewer rows rather than shrinking the cars.
    const rowStep = chest + this.invGapY;
    // Reveal most of the next row (was 0.45) so row 3 is clearly visible, not a sliver.
    const peek = Math.round(chest * 0.8);
    this.invPeek = peek; // mask uses the same value so the clip matches the reserved space
    const regionH = (rows: number) => (rows - 1) * rowStep + chest + peek + 8;
    const bottomFixed = SLOT_SIZE + gSlots + gInv + boostH;
    const bottomMax = Math.round(GAME_H * 0.4);
    // GROW the inventory to fill the 40% budget (up to 3 rows) so the bottom cluster
    // sits near 40% and the board lands around the real game's ~53% — instead of the
    // board ballooning and leaving an empty gap.
    let visRows = 1;
    while (visRows < 3 && bottomFixed + regionH(visRows + 1) <= bottomMax) visRows++;
    let invH = regionH(visRows);
    if (bottomFixed + invH > bottomMax) invH = Math.max(chest + peek + 8, bottomMax - bottomFixed);
    const bottomH = bottomFixed + invH; // ≤ 40% of GAME_H

    // Board absorbs ALL the remaining height between the HUD and the bottom cluster
    // (no artificial cap) so the ring road grows as large as the screen allows and the
    // slimes scale up with it. The square is still bounded to GAME_W in computeMetrics.
    const topFixed = hudH + gTop + gBoard;
    let boardBudget = GAME_H - topFixed - bottomH - 2 * margin;
    boardBudget = Math.round(Math.max(boardBudget, 220));
    const m = this.computeMetrics(boardBudget);

    // Board sits just under the HUD; the bottom cluster is ALWAYS pinned to the screen
    // bottom (controls within thumb reach). Any slack falls between board and cluster.
    const boardTop = hudH + gTop;
    this.buildBoard(boardTop, m); // zone 1

    let by = GAME_H - margin - bottomH;
    this.buildSlots(by); // zone 2 (waiting slots)
    by += SLOT_SIZE + gSlots;

    this.buildInventory(by, perRow, visRows); // zone 3
    by += invH + gInv;

    this.buildBoosters(by, boostH); // zone 4

    // Gift + tutorialise any booster whose unlock level this level reaches.
    this.checkBoosterUnlocks(levelNum);

    if (levelNum === 1) this.startTutorial(); // gentle intro guidance
    else if (this.maybeShowHardRockIntro()) { /* first hard-rock level → explain the rock */ }
    else this.maybeShowTwinIntro(); // first level with a twin pair → explain twin cars
  }

  // ---- Hard-rock intro (first level that has hard rock) ---------------
  // Fires once, on the first hard-rock level the player reaches (L23 by design, but any
  // rock level if they jumped ahead). Deduped by a localStorage flag, like the twin intro.
  private maybeShowHardRockIntro(): boolean {
    const hasRock = this.level.board.some((v) => isObstacle(v) && obstacleKind(v) === "hard");
    if (!hasRock) return false;
    let shown = false;
    try { shown = localStorage.getItem("pf_rock_intro") === "1"; } catch { /* storage unavailable */ }
    if (shown) return false;
    try { localStorage.setItem("pf_rock_intro", "1"); } catch { /* storage unavailable */ }
    this.showHardRockIntroModal();
    return true;
  }

  private showHardRockIntroModal() {
    this.tutPaused = true; // freeze behind the modal
    const D = 400;
    const pw = 330;
    const ph = 300;
    const x0 = GAME_W / 2 - pw / 2;
    const y0 = GAME_H / 2 - ph / 2;
    const dim = this.add
      .rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.6)
      .setDepth(D)
      .setInteractive();
    const panel = this.add.graphics().setDepth(D + 1);
    panel.fillStyle(0xf7edd0, 1);
    panel.fillRoundedRect(x0, y0, pw, ph, 20);
    panel.lineStyle(4, 0x8a5a12, 1);
    panel.strokeRoundedRect(x0, y0, pw, ph, 20);
    const icon = this.add
      .text(GAME_W / 2, y0 + 60, "🪨", { fontSize: "40px" })
      .setOrigin(0.5)
      .setDepth(D + 2);
    const title = this.add
      .text(GAME_W / 2, y0 + 116, "Đá Cứng!", {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "22px", color: "#6a4a12",
      })
      .setOrigin(0.5)
      .setDepth(D + 2);
    const desc = this.add
      .text(GAME_W / 2, y0 + 176, "Đá cứng không phá được. Xe không gắp được slime nếu có đá cứng chắn đường — hãy chừa lối đi vòng qua nó nhé!", {
        fontFamily: "Arial, sans-serif", fontSize: "14px", color: "#6a4a12", align: "center",
        wordWrap: { width: pw - 44 },
      })
      .setOrigin(0.5)
      .setDepth(D + 2);
    const ok = this.add
      .text(GAME_W / 2, y0 + ph - 34, "ĐÃ HIỂU!", {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "16px", color: "#ffffff",
        backgroundColor: "#3a8a3a", padding: { x: 26, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(D + 2)
      .setInteractive({ useHandCursor: true });
    const kill = () => {
      [dim, panel, icon, title, desc, ok].forEach((o) => o.destroy());
      this.tutPaused = false;
    };
    ok.on("pointerdown", kill);
    dim.on("pointerdown", kill);
  }

  // ---- Level-1 tutorial ----------------------------------------------
  // Step 1: a bouncing hand points at the first queued car — "tap to send it".
  // Step 2: once a car has driven a lap and parked in a waiting bay, the hand
  // points there — "tap the parked car to send it out again". Ends on that tap.
  private startTutorial() {
    this.tutStep = 1;
    const front = this.invColumns.find((col) => col.length > 0)?.[0];
    if (!front) return;
    this.showTutHint(front.container.x, front.container.y, "Tap the car to\nsend it out!", this.chestSize * 0.95);
  }

  // ---- Twin-car intro (only on its designated level) -----------------
  private maybeShowTwinIntro() {
    // Only introduce twin cars AT their intro level — never on later twin levels you
    // reached by skipping ahead (e.g. testing straight to 11/12, already past level 8).
    // Exception: L200 opens the kid pack (jumped to directly), so it re-offers the
    // intro for a child who never played L8 — the pf_twin_intro flag still dedupes.
    if (this.levelNum !== TWIN_INTRO_LEVEL && this.levelNum !== 200) return;
    if (this.carGroups.length === 0) return;
    let shown = false;
    try {
      shown = localStorage.getItem("pf_twin_intro") === "1";
    } catch {
      /* storage unavailable */
    }
    if (shown) return;
    try {
      localStorage.setItem("pf_twin_intro", "1");
    } catch {
      /* storage unavailable */
    }
    this.showTwinIntroModal();
  }

  private showTwinIntroModal() {
    this.tutPaused = true; // freeze behind the modal
    const D = 400;
    const pw = 330;
    const ph = 296;
    const x0 = GAME_W / 2 - pw / 2;
    const y0 = GAME_H / 2 - ph / 2;
    const dim = this.add
      .rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.6)
      .setDepth(D)
      .setInteractive();
    const panel = this.add.graphics().setDepth(D + 1);
    panel.fillStyle(0xf7edd0, 1);
    panel.fillRoundedRect(x0, y0, pw, ph, 20);
    panel.lineStyle(4, 0x8a5a12, 1);
    panel.strokeRoundedRect(x0, y0, pw, ph, 20);
    const icon = this.add
      .text(GAME_W / 2, y0 + 62, "🚗🤝🚙", { fontSize: "38px" })
      .setOrigin(0.5)
      .setDepth(D + 2);
    const title = this.add
      .text(GAME_W / 2, y0 + 118, "Twin Cars!", {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "22px", color: "#6a4a12",
      })
      .setOrigin(0.5)
      .setDepth(D + 2);
    const desc = this.add
      .text(GAME_W / 2, y0 + 172, "These two are best buddies — they set off, park, and leave TOGETHER, always side by side. Tap one and BOTH roll out!", {
        fontFamily: "Arial, sans-serif", fontSize: "14px", color: "#6a4a12", align: "center",
        wordWrap: { width: pw - 44 },
      })
      .setOrigin(0.5)
      .setDepth(D + 2);
    const ok = this.add
      .text(GAME_W / 2, y0 + ph - 34, "GOT IT!", {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "16px", color: "#ffffff",
        backgroundColor: "#3a8a3a", padding: { x: 26, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(D + 2)
      .setInteractive({ useHandCursor: true });
    const kill = () => {
      [dim, panel, icon, title, desc, ok].forEach((o) => o.destroy());
      this.tutPaused = false;
      this.spotlightTwinPair(); // then guide the player to launch them
    };
    ok.on("pointerdown", kill);
    dim.on("pointerdown", kill);
  }

  // After the intro modal, spotlight the linked group in the lineup so the player
  // sends them out — the game stays frozen until they do (handled in launchFromInventory).
  private spotlightTwinPair() {
    const group = this.carGroups[0];
    if (!group) return;
    const pos = group.map((m) => this.findInInventory(m));
    if (pos.some((p) => !p || p.r !== 0)) return; // only guide when the whole group is at the front
    const xs = group.map((m) => m.container.x);
    const ys = group.map((m) => m.container.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const radius = (Math.max(...xs) - Math.min(...xs)) / 2 + this.chestSize * 0.78;
    this.tutStep = 8; // group-launch step
    this.showTutHint(cx, cy, "Tap to send the\nlinked cars out together!", radius);
  }

  // Spotlight a spot on screen: freeze the game, dim everything AROUND a clear
  // circular "hole" (so only the target stays lit & tappable), and bob a hand +
  // label over it. The game resumes when clearTutHint() runs (the player acted).
  private showTutHint(x: number, y: number, msg: string, radius = 40, labelAbove = true) {
    this.clearTutHint();
    this.tutPaused = true;
    const D = 250;
    // Four dark "mat" rectangles frame the clear spotlight box — leaving the target
    // uncovered so its own tap still works, while every click outside is swallowed.
    const r = radius;
    const bx = Phaser.Math.Clamp(x - r, 0, GAME_W);
    const byT = Phaser.Math.Clamp(y - r, 0, GAME_H);
    const bw = Math.min(x + r, GAME_W) - bx;
    const bh = Math.min(y + r, GAME_H) - byT;
    const mat = (mx: number, my: number, mw: number, mh: number) =>
      this.add
        .rectangle(mx, my, mw, mh, 0x000000, 0.62)
        .setOrigin(0, 0)
        .setDepth(D)
        .setInteractive(); // swallow taps outside the spotlight
    const mats = [
      mat(0, 0, GAME_W, byT), // above
      mat(0, byT + bh, GAME_W, GAME_H - (byT + bh)), // below
      mat(0, byT, bx, bh), // left
      mat(bx + bw, byT, GAME_W - (bx + bw), bh), // right
    ];
    // tapping the dark area nudges the hand so the player looks at the target
    for (const m of mats) m.on("pointerdown", () => this.nudgeTutHand());

    const ring = this.add.circle(x, y, r - 6).setStrokeStyle(4, 0xffe14a, 1).setDepth(D + 2);
    const hand = this.add
      .text(x + 20, y + 18, "👆", { fontSize: "36px" })
      .setOrigin(0.5)
      .setDepth(D + 3);
    const ly = labelAbove ? y - (r + 24) : y + (r + 24);
    const label = this.add
      .text(x, ly, msg, {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "15px",
        color: "#ffffff",
        backgroundColor: "#e23b3b",
        padding: { x: 12, y: 6 },
        align: "center",
      })
      .setOrigin(0.5)
      .setDepth(D + 3);
    this.tweens.add({ targets: ring, scale: 1.25, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 });
    this.tutHand = hand;
    this.tutHandY = hand.y;
    this.tweens.add({
      targets: hand,
      y: hand.y + 12,
      duration: 560,
      yoyo: true,
      repeat: -1,
      ease: "Sine.inOut",
    });
    this.tutObjs = [...mats, ring, hand, label];
  }

  // A quick pop of the guiding hand when the player taps the dimmed area by mistake.
  private nudgeTutHand() {
    if (!this.tutHand) return;
    this.tweens.killTweensOf(this.tutHand);
    this.tweens.add({
      targets: this.tutHand,
      scale: { from: 1.5, to: 1 },
      duration: 260,
      ease: "Back.out",
      onComplete: () => {
        if (!this.tutHand) return;
        this.tweens.add({
          targets: this.tutHand,
          y: this.tutHandY + 12,
          duration: 560,
          yoyo: true,
          repeat: -1,
          ease: "Sine.inOut",
        });
      },
    });
  }

  private clearTutHint() {
    for (const o of this.tutObjs) {
      this.tweens.killTweensOf(o);
      o.destroy();
    }
    this.tutObjs = [];
    this.tutHand = undefined;
    this.tutPaused = false; // unfreeze — the guided action is done
  }

  // Board size depends on the grid AND the height left over for it (passed in),
  // so the layout can flex the board to fill the screen.
  private computeMetrics(boardBudget: number): BoardMetrics {
    const frameW = GAME_W - 24;
    // Ring levels (square/rect) use a SQUARE frame so a square board (25×25) fills
    // it evenly instead of leaving big side/top gaps. Any leftover vertical budget
    // becomes slack between the board and the bottom cluster. Line/arch keep the
    // full vertical budget. this.cell is (re)computed in buildBoard per track.
    const isRing = (this.level.track ?? "square") !== "line" && this.level.track !== "u" && this.level.track !== "arch";
    // Ring (square) frame may grow toward the full screen width so the square road
    // can hug the left/right edges, still bounded by the vertical budget.
    const frameH = isRing ? Math.min(boardBudget, GAME_W) : boardBudget;
    this.chestSize = CAR_SIZE; // fixed — consistent car size on every level
    return { frameW, frameH, ringW: frameW, ringH: frameH };
  }

  // Full-screen forest-floor background image (bottom layer). Play scene keeps the
  // LIGHT forest art (Home uses the dark premium one).
  private buildBackground() {
    this.add
      .image(GAME_W / 2, GAME_H / 2, "background")
      .setDisplaySize(GAME_W, GAME_H)
      .setDepth(DEPTH_BG);
  }

  // ---- Zone 1: board, Line track, keys -------------------------------

  private buildBoard(topY: number, m: BoardMetrics) {
    const { cols, rows, board } = this.level;
    const cx = GAME_W / 2;
    const cy = topY + m.frameH / 2;
    this.stdCell = 0; // recomputed per track below (fallback = actual cell)

    const pad = 16; // outer margin from the frame edge to the road-centre box
    const gap = 4; // grass gap between a road and the grid (small → board fills more)
    const roadW = Math.round(CAR_SIZE * 0.8); // slimmer road so the board is bigger
    this.beltMarks = undefined;
    this.trackKind = this.level.track ?? "square";
    const kind = this.trackKind;

    // Fit a square cell to an interior box; slimes auto-shrink for big grids
    // (10×10 default → ~large; 20×20, 40×40 → 2×/4× smaller). Small floor so a
    // dense grid still renders.
    const fitCell = (aw: number, ah: number) =>
      Math.max(6, Math.min(Math.floor(aw / cols), Math.floor(ah / rows)));

    let gridW = 0;
    let gridH = 0;

    if (kind === "line") {
      // Single bottom road, full width; grid sits HIGH above it (long visible run
      // so lots of slimes are seen sprinting down to the cars at once).
      const lineY = cy + m.frameH / 2 - pad - roadW / 2;
      this.beltLeft = 0;
      this.beltRight = GAME_W;
      this.beltTop = lineY;
      this.beltBottom = lineY;
      this.roadRadius = 0;
      this.buildRoadLine(roadW, lineY, this.beltLeft, this.beltRight);
      const gridTop = cy - m.frameH / 2 + 6;
      const minRunGap = 44; // min clearance grid→road
      const bandH = lineY - roadW / 2 - minRunGap - gridTop;
      this.cell = fitCell(GAME_W - 28, bandH);
      gridW = cols * this.cell;
      gridH = rows * this.cell;
      this.gridX = cx - gridW / 2;
      // Sit the grid a bit down from the top (not jammed under the label) while
      // still leaving a clear run gap down to the road.
      this.gridY = gridTop + Math.max(0, bandH - gridH) * 0.5;
    } else if (kind === "square" || kind === "rect") {
      // Largest CENTRED SQUARE loop that fits, hugging the screen edges (tiny margin
      // so the road spans nearly the full width → biggest enclosed area).
      const edge = 4;
      const side = Math.min(GAME_W - roadW - 2 * edge, m.frameH - roadW - 2 * edge);
      this.beltLeft = cx - side / 2;
      this.beltRight = cx + side / 2;
      this.beltTop = cy - side / 2;
      this.beltBottom = cy + side / 2;
      this.roadRadius = Math.round(roadW * 1.1);
      // Cell size normally targets the STANDARD 25×25 board so every level renders
      // slimes at the SAME size (a smaller board just occupies less of the ring). But
      // a board BIGGER than 25 (e.g. detailed "picture" levels) would overflow the
      // road at that fixed size, so we shrink the cell to fit those — boards ≤25 are
      // unchanged, only larger boards render smaller-to-fit.
      const STD = Math.max(25, cols, rows);
      const cb = Math.round(this.roadRadius * 0.1);
      const availW = this.beltRight - this.beltLeft - roadW - 2 * gap - cb;
      const availH = this.beltBottom - this.beltTop - roadW - 2 * gap - cb;
      this.cell = Math.max(6, Math.floor(Math.min(availW, availH) / STD));
      // fill bump so the slimes fill more of the enlarged interior, capped by the road
      // boundary (cb removed) so tiles never actually reach the road.
      const capCell = Math.floor((this.beltRight - this.beltLeft - roadW - 2 * gap) / STD);
      this.cell = Math.min(Math.round(this.cell * 1.15), capCell);
      // Same computation pinned to STD=25 → the cell a 25×25 board would use here.
      // (Identical to this.cell whenever cols,rows ≤ 25; larger on picture levels.)
      const cell25 = Math.max(6, Math.floor(Math.min(availW, availH) / 25));
      const cap25 = Math.floor((this.beltRight - this.beltLeft - roadW - 2 * gap) / 25);
      this.stdCell = Math.min(Math.round(cell25 * 1.15), cap25);
      gridW = cols * this.cell;
      gridH = rows * this.cell;
      this.gridX = cx - gridW / 2;
      this.gridY = cy - gridH / 2;
      this.buildRoadLoop(roadW);
    } else {
      // Three-sided arch: "arch" = ⊓ (open BOTTOM), "u" = ∪ (open TOP). Two straight
      // legs + a rounded bar across the closed side; the grid fills the interior and
      // is peeled from the left, the bar, and the right.
      const openBottom = kind === "arch";
      const padX = 16; // near the outer edge on the two legs, small visible margin
      const r = Math.round(roadW * 0.9); // corner radius of the two bends
      this.beltLeft = cx - m.frameW / 2 + padX;
      this.beltRight = cx + m.frameW / 2 - padX;
      this.beltTop = cy - m.frameH / 2 + pad;
      this.beltBottom = cy + m.frameH / 2 - pad;
      this.roadRadius = r;
      // Grid spans the leg gap horizontally; vertically it clears the rounded bar
      // corners (offset r) and runs toward the open side.
      const availW = this.beltRight - this.beltLeft - roadW - 2 * gap;
      const availH = this.beltBottom - this.beltTop - roadW / 2 - gap - r - 4;
      this.cell = fitCell(availW, availH);
      gridW = cols * this.cell;
      gridH = rows * this.cell;
      this.gridX = cx - gridW / 2;
      if (openBottom) {
        this.gridY = this.beltTop + roadW / 2 + gap + r; // just below the top bar + corners
        this.buildRoadArch(roadW, this.beltLeft, this.beltRight, this.beltTop, this.beltBottom, r);
      } else {
        this.gridY = this.beltBottom - roadW / 2 - gap - r - gridH; // just above the bottom bar
        this.buildRoadU(roadW, this.beltLeft, this.beltRight, this.beltTop, this.beltBottom, r);
      }
    }

    // Tracks without the 25-baseline (line/u/arch) fit the cell directly → no separate
    // standard size, so runners just use the actual cell.
    if (!this.stdCell) this.stdCell = this.cell;

    // Sand mat re-enabled (user 2026-07-25): grass-green hid the green/teal slimes;
    // warm sand makes every palette colour pop (same call as the reference game).
    this.buildGroundMat(cols, rows, roadW);

    const keySize = this.cell;
    // Index-addressed (not push) so a 2×2 BIG obstacle can claim its 4 cells.
    this.keys = new Array(rows * cols).fill(null);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (this.keys[idx]) continue; // already claimed by a big obstacle to the up-left
        const id = board[idx];
        if (id < 0) continue;
        const { x, y } = this.cellCenter(r, c);
        if (isBigObstacle(id) && r + 1 < rows && c + 1 < cols) {
          // 2×2: the same code fills all four cells (for line-of-sight + matching);
          // one big sprite centred on the block; every cell points at the same object.
          const cells = [idx, idx + 1, idx + cols, idx + cols + 1];
          for (const ci of cells) board[ci] = id;
          const cxp = this.gridX + (c + 1) * this.cell; // centre between the two columns
          const cyp = this.gridY + (r + 1) * this.cell; // centre between the two rows
          const obj = this.makeObstacle(id, cxp, cyp, this.cell * 2, cells);
          for (const ci of cells) this.keys[ci] = obj;
        } else if (isObstacle(id)) {
          this.keys[idx] = this.makeObstacle(id, x, y, keySize, [idx]);
        } else if (this.hiddenSet.has(idx)) {
          // hidden "?" slime — value-greyscale of the real colour (A+E), revealed on neighbour clear
          this.keys[idx] = this.makeHiddenKey(x, y, keySize, this.level.board[idx], idx);
        } else {
          this.keys[idx] = this.makeKey(id, x, y, keySize);
          // 2-layer slime: mark it with a small corner fold so the player sees it hides
          // a second colour underneath (revealed when the top is collected).
          if (this.level.layer2 && this.level.layer2[idx] >= 0) this.markTwoLayer(this.keys[idx]!, keySize);
        }
      }
    }

    this.buildTrack();
    this.buildStartSignal();
  }

  // A "signal" at the car spawn point so it's clear where cars enter the track:
  // a pulsing ring on the tarmac + the little go-signal, whose green light shows how
  // many cars are on the ray ("N/5"). Kept clear of the top/left edges so the number
  // stays readable even when the start sits in a corner.
  private buildStartSignal() {
    this.signalCount = undefined;
    this.signalPost = undefined;
    const N = this.track.length;
    if (N < 2) return;
    const s = this.track[this.startIndex];

    // pulsing ring on the road where cars actually appear (under the cars)
    const ring = this.add
      .circle(s.x, s.y, 16, 0x37e06a, 0) // no fill — ring only
      .setStrokeStyle(4, 0x37e06a, 0.95)
      .setDepth(DEPTH_ROAD + 1);
    this.tweens.add({ targets: ring, scale: 1.7, alpha: 0, duration: 1100, repeat: -1, ease: "Quad.out" });

    // the start-signal art (centred on its anchor so it doesn't shoot far up/off-screen)
    const tex = this.textures.get("start-signal");
    const sign =
      tex && tex.has("trim") ? this.add.image(0, 0, "start-signal", "trim") : this.add.image(0, 0, "start-signal");
    const H = 58;
    sign.setScale(H / (sign.height || H)).setOrigin(0.5, 0.5);
    const dw = sign.displayWidth;
    const dh = sign.displayHeight;

    // Nudge the sign inward so it's never jammed against the top/left edges.
    const margin = 10;
    const px = Phaser.Math.Clamp(s.x, margin + dw / 2, GAME_W - margin - dw / 2);
    const py = Phaser.Math.Clamp(s.y, 84 + dh / 2, GAME_H - dh / 2);

    const post = this.add.container(px, py, [sign]).setDepth(60); // above cars
    this.signalPost = post;

    // "N/5" over the green light (it sits ~38% down the sign art)
    const count = this.add
      .text(0, -dh * 0.125, "0/" + MAX_ON_TRACK, {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "12px",
        color: "#ffffff",
        stroke: "#0c3d16",
        strokeThickness: 4,
      })
      .setOrigin(0.5);
    post.add(count);
    this.signalCount = count;

    this.tweens.add({ targets: post, y: py - 5, duration: 700, yoyo: true, repeat: -1, ease: "Sine.inOut" });
  }

  // A smooth sandy clearing filling the ENTIRE interior of the ring road (user
  // 2026-07-25: no grass gap between road and mat). The fill tucks under the road
  // band — it sits BELOW the road (road at DEPTH_ROAD −50, mat at −60) so the road
  // always draws over it and the seam can never show.
  private buildGroundMat(_cols: number, _rows: number, roadW: number) {
    const tuck = Math.round(roadW * 0.5); // reach the road's centreline — fully under the band
    const x = this.beltLeft + roadW / 2 - tuck, y = this.beltTop + roadW / 2 - tuck;
    const w = (this.beltRight - this.beltLeft) - roadW + 2 * tuck;
    const h = (this.beltBottom - this.beltTop) - roadW + 2 * tuck;
    const rad = Math.max(10, this.roadRadius - roadW / 2 + tuck);
    const g = this.add.graphics().setDepth(-60); // above the forest bg, below the ROAD & tiles
    // Per-level theme: default DARK navy (bright tiles pop, like ref game); lightBoard
    // falls back to the old light sand mat (design comparison).
    const light = !!this.level.lightBoard;
    const base = light ? 0xdcc79c : 0x2b2f4a;   // sand vs deep navy
    const alt = light ? 0xd2bb8c : 0x323858;    // the OTHER caro tone (subtle, so bright tiles still pop)
    const gridLine = light ? 0xc9b184 : 0x232840; // faint cell-boundary line
    g.fillStyle(base, 1); g.fillRoundedRect(x, y, w, h, rad); // base board tone
    // Two-tone "caro" checkerboard filling the WHOLE mat (not just the tile grid) so a
    // small board like 15×15 doesn't look like a tiny caro square floating in a plain
    // navy panel. Cells are phase-aligned to the tile grid (gridX/gridY) so tiles sit
    // flush on the caro, and the whole thing is masked to the rounded-rect mat shape so
    // corners stay clean. Kept subtle so bright pixel-art tiles still pop on top.
    const cell = this.cell;
    const c0 = Math.floor((x - this.gridX) / cell), r0 = Math.floor((y - this.gridY) / cell);
    const c1 = Math.ceil((x + w - this.gridX) / cell), r1 = Math.ceil((y + h - this.gridY) / cell);
    g.fillStyle(alt, 1);
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        if (((r + c) & 1) === 0) continue; // only the "odd" cells → checker
        g.fillRect(this.gridX + c * cell, this.gridY + r * cell, cell, cell);
      }
    }
    // A faint lattice on top keeps every cell boundary crisp, across the whole mat.
    g.lineStyle(1, gridLine, light ? 0.4 : 0.35);
    for (let c = c0; c <= c1; c++) { const gx = this.gridX + c * cell; g.beginPath(); g.moveTo(gx, y); g.lineTo(gx, y + h); g.strokePath(); }
    for (let r = r0; r <= r1; r++) { const gy = this.gridY + r * cell; g.beginPath(); g.moveTo(x, gy); g.lineTo(x + w, gy); g.strokePath(); }
    // Clip everything (checker + lattice overflow) to the rounded-rect mat shape.
    const mk = this.make.graphics({ x: 0, y: 0 }, false);
    mk.fillStyle(0xffffff, 1); mk.fillRoundedRect(x, y, w, h, rad);
    g.setMask(mk.createGeometryMask());
  }

  // Assemble the rounded-rectangle road from sprite pieces: 4 tiled straight
  // edges + 4 rounded corners, matching the car track (belt rect + radius).
  private buildRoadLoop(roadW: number) {
    const L = this.beltLeft,
      R = this.beltRight,
      T = this.beltTop,
      B = this.beltBottom;
    const bw = R - L,
      bh = B - T,
      rad = this.roadRadius;

    // Draw the road as ONE seamless rounded-rectangle band (wooden-track look):
    // concentric rounded-rect strokes from wide/dark to narrow/light. Because
    // it is a single path, corners and edges are always perfectly flush.
    const g = this.add.graphics().setDepth(DEPTH_ROAD);
    const ring = (w: number, color: number, alpha = 1) => {
      g.lineStyle(w, color, alpha);
      g.strokeRoundedRect(L, T, bw, bh, rad);
    };
    ring(roadW + 6, 0x4a3016); // dark outline
    ring(roadW, 0xa9743d); // rail band (edges)
    ring(roadW - 9, 0xd8b47e); // tan road surface
    ring(roadW - 22, 0xe8cf9c, 0.9); // soft center highlight
  }

  // A single horizontal road band (pill-shaped, rounded ends), same wooden look.
  private buildRoadLine(roadW: number, y: number, x0: number, x1: number) {
    // Straight band with NO end caps — extend past both edges so the flat ends
    // run off-screen and the road looks like it spans the whole width.
    const ext = roadW;
    const left = x0 - ext;
    const w = x1 - x0 + 2 * ext;
    const g = this.add.graphics().setDepth(DEPTH_ROAD);
    const band = (inset: number, color: number, alpha = 1) => {
      const hh = roadW - 2 * inset;
      g.fillStyle(color, alpha);
      g.fillRect(left, y - hh / 2, w, hh);
    };
    band(-3, 0x4a3016); // dark outline (top/bottom edges)
    band(0, 0xa9743d); // rail band
    band(6, 0xd8b47e); // tan surface
    band(13, 0xe8cf9c, 0.9); // soft center highlight
  }

  // An INVERTED-U (⊓) road, open at the bottom: left leg → rounded top-left bend →
  // top bar → rounded top-right bend → right leg. Drawn as one open path stroked 4×
  // with the same wooden bands so the straights and both bends stay perfectly flush.
  private buildRoadArch(
    roadW: number,
    leftX: number,
    rightX: number,
    topY: number,
    bottomY: number,
    r: number,
  ) {
    const g = this.add.graphics().setDepth(DEPTH_ROAD);
    const trace = () => {
      g.beginPath();
      g.moveTo(leftX, bottomY); // bottom of the left leg
      g.lineTo(leftX, topY + r); // up the left leg
      g.arc(leftX + r, topY + r, r, -Math.PI, -Math.PI / 2, false); // TL bend (left→top)
      g.lineTo(rightX - r, topY); // across the top bar
      g.arc(rightX - r, topY + r, r, -Math.PI / 2, 0, false); // TR bend (top→right)
      g.lineTo(rightX, bottomY); // down the right leg
    };
    const stroke = (w: number, color: number, alpha = 1) => {
      g.lineStyle(w, color, alpha);
      trace();
      g.strokePath();
    };
    stroke(roadW + 6, 0x4a3016); // dark outline
    stroke(roadW, 0xa9743d); // rail band (edges)
    stroke(roadW - 9, 0xd8b47e); // tan road surface
    stroke(roadW - 22, 0xe8cf9c, 0.9); // soft center highlight
  }

  // A U (∪) road, open at the TOP: left leg → rounded bottom-left bend → bottom bar
  // → rounded bottom-right bend → right leg. The vertical mirror of buildRoadArch.
  private buildRoadU(
    roadW: number,
    leftX: number,
    rightX: number,
    topY: number,
    bottomY: number,
    r: number,
  ) {
    const g = this.add.graphics().setDepth(DEPTH_ROAD);
    const trace = () => {
      g.beginPath();
      g.moveTo(leftX, topY); // top of the left leg (open top)
      g.lineTo(leftX, bottomY - r); // down the left leg
      g.arc(leftX + r, bottomY - r, r, Math.PI, Math.PI / 2, true); // BL bend (left→bottom)
      g.lineTo(rightX - r, bottomY); // across the bottom bar
      g.arc(rightX - r, bottomY - r, r, Math.PI / 2, 0, true); // BR bend (bottom→right)
      g.lineTo(rightX, topY); // up the right leg
    };
    const stroke = (w: number, color: number, alpha = 1) => {
      g.lineStyle(w, color, alpha);
      trace();
      g.strokePath();
    };
    stroke(roadW + 6, 0x4a3016); // dark outline
    stroke(roadW, 0xa9743d); // rail band (edges)
    stroke(roadW - 9, 0xd8b47e); // tan road surface
    stroke(roadW - 22, 0xe8cf9c, 0.9); // soft center highlight
  }

  private cellCenter(r: number, c: number) {
    return {
      x: this.gridX + c * this.cell + this.cell / 2,
      y: this.gridY + r * this.cell + this.cell / 2,
    };
  }

  // A grid tile is a cute square "Slime" critter: a glossy rounded square in the
  // tile's color with a little face. Fills the cell so the grid reads as a mosaic.
  // A grid tile = a cute critter sprite (slime) in the tile's color.
  private makeKey(colorId: number, x: number, y: number, s: number) {
    const img = this.add.image(0, 0, `tile-${colorId}`).setDisplaySize(s * 1.15, s * 1.15); // faceless body ≈ cell → tiles sit flush (no overlap)
    const c = this.add.container(x, y, [img]);
    c.setSize(s, s);
    c.setData("body", img); // kept so the collect animation can bob the body alone
    return c;
  }

  // A hidden "?" slime — MECHANIC A+E (user 2026-07-26 prototype): show the tile in the
  // real colour's VALUE (greyscale by luminance) so the subject's light/dark FORM still
  // reads (the picture looks "not-yet-coloured", not scarred), while the HUE stays hidden
  // (the gameplay lever). A subtle "?" is sprinkled only on ~1/3 of hidden tiles (anchors)
  // instead of a bold glyph on every one. Real colour pops in on reveal (revealHiddenAround).
  private makeHiddenKey(x: number, y: number, s: number, realColor = 0, idx = 0) {
    void realColor;
    // UNIFORM cover (user 2026-07-26: value-greyscale leaked the hue — "dễ đoán quá"). All
    // hidden tiles share ONE muted slate tone → neither hue NOR value leaks, so the colour
    // is genuinely unknown, while a muted (non-white) tone + a sprinkled soft "?" still reads
    // as an intentional "covered/unrevealed" patch rather than a stark white scar.
    const img = this.add.image(0, 0, "tile-hidden").setDisplaySize(s * 1.15, s * 1.15).setTint(0x8a94a3);
    const L = 138; // fixed value → marker legibility below picks the light-tile branch consistently
    const c = this.add.container(x, y, [img]);
    c.setSize(s, s);
    c.setData("body", img);
    // E: a soft "?" on ~1/3 of tiles (deterministic sprinkle), value-adaptive for legibility.
    if (((idx * 2654435761) >>> 0) % 3 === 0) {
      const q = this.add
        .text(0, 0, "?", {
          fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: `${Math.round(s * 0.5)}px`,
          color: L > 150 ? "#2a2a34" : "#eef2f7",
          stroke: L > 150 ? "#ffffff" : "#2a2a34", strokeThickness: Math.max(2, Math.round(s * 0.06)),
        })
        .setOrigin(0.5)
        .setAlpha(0.5);
      c.add(q);
      c.setData("qmark", q);
    }
    return c;
  }

  // A cell was cleared → any adjacent hidden "?" slime gets revealed (its true colour
  // pops in). Called from every collect/clear path.
  private revealHiddenAround(cells: number[]) {
    if (this.hiddenSet.size === 0) return;
    const cols = this.level.cols, rows = this.level.rows;
    for (const idx of cells) {
      const r = Math.floor(idx / cols), c = idx % cols;
      const nb = [
        r > 0 ? idx - cols : -1,
        r < rows - 1 ? idx + cols : -1,
        c > 0 ? idx - 1 : -1,
        c < cols - 1 ? idx + 1 : -1,
      ];
      for (const j of nb) {
        if (j < 0 || !this.hiddenSet.has(j) || !this.keys[j]) continue;
        this.hiddenSet.delete(j);
        const tile = this.keys[j]!;
        const color = this.level.board[j];
        const body = tile.getData("body") as Phaser.GameObjects.Image;
        body.clearTint();
        body.setTexture(`tile-${color}`);
        // tile-* textures are uniform 128px, but setTexture still resets display size,
        // so re-apply the cell size.
        body.setDisplaySize(this.cell * 1.15, this.cell * 1.15);
        const q = tile.getData("qmark") as Phaser.GameObjects.Text | undefined;
        if (q) q.destroy();
        tile.setScale(0.6);
        this.tweens.add({ targets: tile, scale: 1, duration: 200, ease: "Back.out" });
        this.sparkle(tile.x, tile.y, COLORS[color]);
      }
    }
  }

  // A small white corner fold marking a 2-layer slime (a different colour hides under it).
  private markTwoLayer(tile: Phaser.GameObjects.Container, s: number) {
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 0.9);
    g.beginPath();
    g.moveTo(s * 0.5 - s * 0.3, -s * 0.5);
    g.lineTo(s * 0.5, -s * 0.5);
    g.lineTo(s * 0.5, -s * 0.5 + s * 0.3);
    g.closePath();
    g.fillPath();
    g.lineStyle(Math.max(1, s * 0.035), 0x2a2a3a, 0.55);
    g.strokePath();
    tile.add(g);
  }

  // An obstacle tile (hard/soft rock, or wood), `code` = BASE code. `tileSize` is its
  // footprint (cell for 1×1, cell*2 for a BIG 2×2). `cells` = every board index it
  // occupies, so collecting/breaking clears them all together. Occupies the cell(s) →
  // blocks line of sight.
  private makeObstacle(code: number, x: number, y: number, tileSize: number, cells: number[]) {
    const kind = obstacleKind(code);
    const key = kind === "hard" ? WALL_TEXTURE : kind === "soft" ? "rock-soft" : "wood";
    const img = this.add.image(0, 0, key).setDisplaySize(tileSize * 1.08, tileSize * 1.08);
    const c = this.add.container(x, y, [img]);
    c.setSize(tileSize, tileSize);
    c.setData("body", img);
    c.setData("obstacle", code);
    c.setData("cells", cells);
    if (kind === "soft") {
      // Soft rock shows its remaining hits (updated on each hit, gone when broken).
      const hp = softHp(code);
      c.setData("hp", hp);
      const num = this.add
        .text(0, 0, String(hp), {
          fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: `${Math.round(tileSize * 0.5)}px`,
          color: "#ffffff", stroke: "#3a250a", strokeThickness: Math.round(tileSize * 0.05),
        })
        .setOrigin(0.5);
      c.add(num);
      c.setData("hpText", num);
    }
    // While using placeholder art, stamp a readable label so it's obvious what it is.
    if (this.missingArt.has(key) && kind !== "soft") {
      const label = kind === "hard" ? "HARD\nROCK" : "WOOD";
      const t = this.add
        .text(0, 0, label, {
          fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: `${Math.round(tileSize * 0.22)}px`,
          color: "#ffffff", stroke: "#000000", strokeThickness: 3, align: "center",
        })
        .setOrigin(0.5);
      c.add(t);
    }
    return c;
  }

  // Build the ring of track nodes following the ROUNDED road (straight edges +
  // quarter-circle corners), counter-clockwise from the bottom-left. Matching the
  // road's corners keeps the cars on the tarmac as they turn.
  private buildTrack() {
    if (this.trackKind === "line") {
      // A single horizontal line: cars drive left→right, then park & re-enter.
      const y = this.beltTop;
      const n = Math.max(1, Math.round((this.beltRight - this.beltLeft) / TRACK_STEP));
      const nodes: TrackNode[] = [];
      for (let i = 0; i <= n; i++) {
        nodes.push({ x: this.beltLeft + ((this.beltRight - this.beltLeft) * i) / n, y });
      }
      this.track = nodes;
      this.startIndex = 0;
      return;
    }
    const left = this.beltLeft;
    const right = this.beltRight;
    const top = this.beltTop;
    const bottom = this.beltBottom;
    const r = this.roadRadius;
    const step = TRACK_STEP;
    const nodes: TrackNode[] = [];

    const line = (x0: number, y0: number, x1: number, y1: number) => {
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let i = 0; i < n; i++) nodes.push({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n });
    };
    const arc = (cx: number, cy: number, a0: number, a1: number) => {
      const n = Math.max(1, Math.round((Math.abs(a1 - a0) * r) / step));
      for (let i = 0; i < n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        nodes.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
    };

    if (this.trackKind === "arch") {
      // Inverted-U (⊓), traversed COUNTER-CLOCKWISE like the loop: start at the
      // BOTTOM-RIGHT, up the right leg → across the top (right→left) → down the left
      // leg. One-way; the car parks at the bottom-left.
      line(right, bottom, right, top + r); // right leg ↑
      arc(right - r, top + r, 0, -Math.PI / 2); // TR bend (right→top)
      line(right - r, top, left + r, top); // top bar ←
      arc(left + r, top + r, -Math.PI / 2, -Math.PI); // TL bend (top→left)
      line(left, top + r, left, bottom); // left leg ↓
      nodes.push({ x: left, y: bottom }); // final node — park here
      this.track = nodes;
      this.startIndex = 0;
      return;
    }

    if (this.trackKind === "u") {
      // U (∪), matching buildRoadU: down the left leg → BL/BR bends along the bottom
      // → up the right leg. One-way; the car parks at the top-right.
      line(left, top, left, bottom - r); // left leg ↓
      arc(left + r, bottom - r, Math.PI, Math.PI / 2); // BL bend (left→bottom)
      line(left + r, bottom, right - r, bottom); // bottom bar →
      arc(right - r, bottom - r, Math.PI / 2, 0); // BR bend (bottom→right)
      line(right, bottom - r, right, top); // right leg ↑
      nodes.push({ x: right, y: top }); // final node — park here
      this.track = nodes;
      this.startIndex = 0;
      return;
    }

    // Full loop (square / rect): CCW from bottom-left, hugging the rounded corners.
    line(left + r, bottom, right - r, bottom); // bottom edge →
    arc(right - r, bottom - r, Math.PI / 2, 0); // BR corner
    line(right, bottom - r, right, top + r); // right edge ↑
    arc(right - r, top + r, 0, -Math.PI / 2); // TR corner
    line(right - r, top, left + r, top); // top edge ←
    arc(left + r, top + r, -Math.PI / 2, -Math.PI); // TL corner
    line(left, top + r, left, bottom - r); // left edge ↓
    arc(left + r, bottom - r, Math.PI, Math.PI / 2); // BL corner

    this.track = nodes;
    this.startIndex = 0;
  }

  // ---- Zone 2: waiting slots -----------------------------------------

  private buildSlots(topY: number) {
    this.slotY = topY + SLOT_SIZE / 2;
    this.layoutSlots();
    if (this.trayMode && TRAY_BATCH && !this.slamMode) this.buildGoButton(); // slam: tap bays, no GO
  }

  // TRAY_BATCH: the GO button. Placeholder styling (user: "cần/button design sau"). The
  // bottom cluster is packed tight (bays almost touch the inventory), so it sits in the
  // RIGHT margin beside the bay row where there's guaranteed free space. Tapping launches
  // the whole batch. positionGoButton() keeps it beside the rightmost bay if the row grows.
  private buildGoButton() {
    const r = 24;
    const bg = this.add.circle(0, 0, r, 0x2ecc71, 1).setStrokeStyle(3, 0x1e8a4c, 1);
    bg.setInteractive({ useHandCursor: true });
    const label = this.add
      .text(0, 0, "GO", { fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "18px", color: "#ffffff" })
      .setOrigin(0.5);
    const btn = this.add.container(0, this.slotY, [bg, label]).setDepth(130);
    bg.on("pointerdown", () => this.launchBatch());
    this.goBtn = btn;
    this.goBtnBg = bg as unknown as Phaser.GameObjects.Rectangle;
    this.goBtnEnabled = true;
    this.positionGoButton();
    this.updateGoButton();
  }

  // Park the GO button just ABOVE the right end of the bay row, in the open strip between
  // the board and the bays. Anchored to fixed screen coords (NOT the bay geometry) so it
  // never shifts when the "Add" booster widens the row — with 6 bays the row spans almost
  // the full width and leaves no side margin, which used to make GO jump to the left.
  private positionGoButton() {
    if (!this.goBtn) return;
    const art = Math.round(SLOT_SIZE * 1.5);
    this.goBtn.setPosition(GAME_W - 40, this.slotY - art / 2 - 30);
  }

  // Enable GO when the batch isn't running and at least one car sits in the bays; grey it
  // out (and ignore taps) otherwise. Cheap to call every frame — only restyles on change.
  private updateGoButton() {
    if (!this.goBtn || !this.goBtnBg) return;
    const hasCar = this.slots.some((s) => s !== null);
    const on = !this.batchRunning && hasCar && !this.won && !this.lost && !this.handMode && !this.magnetMode && !this.tutPaused;
    if (on === this.goBtnEnabled) return;
    this.goBtnEnabled = on;
    const bg = this.goBtnBg as Phaser.GameObjects.Rectangle;
    bg.setFillStyle(on ? 0x2ecc71 : 0x9aa0a6, 1);
    bg.setStrokeStyle(3, on ? 0x1e8a4c : 0x6b6f73, 1);
    this.goBtn.setAlpha(on ? 1 : 0.6);
  }

  // (Re)position the waiting bays for the current slotCount, creating any new tile
  // sprites and sliding already-parked cars to their shifted positions. Called on
  // build and again whenever the "Add" booster grows the row.
  private layoutSlots() {
    // Render the tile bigger than the logical slot so its dirt centre comfortably
    // holds a parked car. Space the bays so their grass borders slightly overlap
    // into one continuous strip, centered.
    const art = Math.round(SLOT_SIZE * 1.5);
    const pitch = art - 8;
    const totalW = (this.slotCount - 1) * pitch;
    const startX = (GAME_W - totalW) / 2;

    this.slotXs = [];
    for (let i = 0; i < this.slotCount; i++) {
      const x = startX + i * pitch;
      this.slotXs.push(x);
      if (this.slotTiles[i]) {
        this.slotTiles[i].setPosition(x, this.slotY);
      } else {
        this.slotTiles[i] = this.add
          .image(x, this.slotY, "slot")
          .setDisplaySize(art, art)
          .setDepth(-10);
      }
    }

    // slide any parked car to its (possibly shifted) bay
    for (let i = 0; i < this.slots.length; i++) {
      const v = this.slots[i];
      if (v?.container.scene) {
        this.tweens.add({
          targets: v.container,
          x: this.slotXs[i],
          y: this.slotY,
          duration: 220,
          ease: "Cubic.out",
        });
      }
    }
    if (this.goBtn) this.positionGoButton(); // keep GO beside the (possibly grown) bay row
  }

  // Flash the waiting bays red when they're ALL full — a warning that the next car
  // forced to park will overflow the queue and lose the level. Call after any change
  // to which bays are occupied.
  // SLAM: a bay whose reserved car is OUT on the ray shows a DIMMED "parked car" (its own
  // colour) so the slot reads as taken/busy. A bay holding a real PARKED (returned) car
  // shows nothing extra (the real car is there).
  private updateSlotLocks() {
    if (!this.slamMode) return;
    for (let i = 0; i < this.slots.length; i++) {
      const v = this.slots[i];
      const out = !!v && (this.pending.includes(v) || this.active.some((a) => a.view === v));
      let ghost = this.slotLocks[i];
      if (out && v) {
        const key = `car-${v.chest.color}`;
        const tex = this.textures.exists(key) ? key : "car-0";
        if (!ghost) {
          ghost = this.add.image(this.slotXs[i] ?? 0, this.slotY, tex).setOrigin(0.5).setDepth(DEPTH_RUNNER + 6).setAlpha(0.4);
          ghost.setDisplaySize(SLOT_SIZE - 12, SLOT_SIZE - 12);
          this.slotLocks[i] = ghost;
        }
        ghost.setTexture(tex).setPosition(this.slotXs[i] ?? ghost.x, this.slotY).setVisible(true);
      } else if (ghost) {
        ghost.setVisible(false);
      }
    }
  }

  private updateSlotWarning() {
    // TRAY_BATCH: bays stay RESERVED (occupied) while the squad is out, but they LOOK empty
    // — don't flash the "full" warning during a run, only once cars have settled back.
    if (this.trayMode && TRAY_BATCH && this.batchRunning) {
      if (this.slotWarnActive) this.stopSlotWarning();
      return;
    }
    const occ = this.slots.reduce((n, s) => n + (s ? 1 : 0), 0);
    const full = this.slotCount > 0 && occ >= this.slotCount;
    if (full && !this.slotWarnActive) this.startSlotWarning();
    else if (!full && this.slotWarnActive) this.stopSlotWarning();
  }

  private startSlotWarning() {
    this.slotWarnActive = true;
    const art = Math.round(SLOT_SIZE * 1.5);
    for (let i = 0; i < this.slotCount; i++) {
      const ring = this.add
        .rectangle(this.slotXs[i], this.slotY, art - 6, art - 6)
        .setStrokeStyle(4, 0xff3b3b, 1)
        .setDepth(120);
      this.tweens.add({
        targets: ring,
        alpha: { from: 1, to: 0.12 },
        scale: { from: 1, to: 1.09 },
        duration: 440,
        yoyo: true,
        repeat: -1,
        ease: "Sine.inOut",
      });
      this.slotWarnG.push(ring);
    }
  }

  private stopSlotWarning() {
    this.slotWarnActive = false;
    for (const o of this.slotWarnG) {
      this.tweens.killTweensOf(o);
      o.destroy();
    }
    this.slotWarnG = [];
  }

  // Draws the moving cleats that make the Line read as a running conveyor.
  private animateBelt(dt: number) {
    const g = this.beltMarks;
    const N = this.track.length;
    if (!g || N === 0) return;
    this.beltOffset = (this.beltOffset + dt * BELT_SPEED) % N;
    g.clear();
    g.lineStyle(2.5, 0x5a5a76, 0.9);
    const half = this.beltThickness * 0.4;
    for (let k = 0; k < N; k += 2) {
      const p = (this.beltOffset + k) % N;
      const i = Math.floor(p) % N;
      const j = (i + 1) % N;
      const t = p - Math.floor(p);
      const ax = this.track[i].x;
      const ay = this.track[i].y;
      const bx = this.track[j].x;
      const by = this.track[j].y;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      let dx = bx - ax;
      let dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const px = -dy;
      const py = dx;
      g.lineBetween(x - px * half, y - py * half, x + px * half, y + py * half);
    }
  }

  // ---- Zone 3: chest inventory ---------------------------------------

  private buildInventory(topY: number, perRow: number, visRows: number) {
    this.invVisRows = visRows;
    this.invTop = topY + 6 + this.chestSize / 2;
    const rowW = (perRow - 1) * (this.chestSize + this.invGapX);
    this.invStartX = (GAME_W - rowW) / 2;

    // Distribute chests into `perRow` vertical queues (columns), filling
    // row by row so each column is a stack the player draws from the top.
    this.invColumns = Array.from({ length: perRow }, () => [] as ChestView[]);
    const byPair = new Map<number, ChestView[]>();
    this.level.chests.forEach((chest, i) => {
      const view = this.makeChestView(chest, 0, 0);
      const hit = view.container.getData("hit") as Phaser.GameObjects.Rectangle;
      hit.on("pointerdown", () => this.launchFromInventory(view));
      this.invColumns[i % perRow].push(view);
      // Collect all cars sharing a pairId into ONE ordered group (2=twin, 3=triple, …).
      if (chest.pairId != null) {
        const list = byPair.get(chest.pairId) ?? [];
        list.push(view);
        byPair.set(chest.pairId, list);
      }
    });
    // Finalise the groups: point every member at the shared, ordered member list.
    for (const list of byPair.values()) {
      if (list.length < 2) continue; // a lone pairId isn't a group
      for (const v of list) v.group = list;
      this.carGroups.push(list);
    }

    this.applyInventoryMask();
    this.layoutInventory(false);
  }

  // Clip the inventory to `invVisRows` full rows plus a peek of the next.
  private applyInventoryMask() {
    const rowStep = this.chestSize + this.invGapY;
    const maskTop = this.invTop - this.chestSize / 2 - 4;
    const maskBottom =
      this.invTop + (this.invVisRows - 1) * rowStep + this.chestSize / 2 + this.invPeek;
    this.invMaskBottom = maskBottom; // twin-rope: don't rope to a car clipped below this
    const mg = this.make.graphics();
    mg.fillStyle(0xffffff, 1);
    mg.fillRect(0, maskTop, GAME_W, maskBottom - maskTop);
    this.invMaskG = mg;
    this.invMask = mg.createGeometryMask();
  }

  // Lay out the column queues. Only the top chest of each column is clickable;
  // rows 1 & 2 stay fully bright, only row 3+ is dimmed (and the mask makes it peek/hide).
  private layoutInventory(animate: boolean) {
    for (let j = 0; j < this.invColumns.length; j++) {
      const col = this.invColumns[j];
      const x = this.invStartX + j * (this.chestSize + this.invGapX);
      for (let r = 0; r < col.length; r++) {
        const view = col[r];
        const y = this.invTop + r * (this.chestSize + this.invGapY);
        const front = r === 0;

        const hit = view.container.getData("hit") as Phaser.GameObjects.Rectangle;
        if (front) hit.setInteractive({ useHandCursor: true });
        else hit.disableInteractive();
        if (front) this.revealBuried(view); // buried car flips face-up on reaching the front
        view.container.setAlpha(r <= 1 ? 1 : 0.4); // rows 1 & 2 full; row 3+ dimmed
        if (this.invMask) view.container.setMask(this.invMask);

        if (animate) {
          this.tweens.add({ targets: view.container, x, y, duration: 220, ease: "Cubic.out" });
        } else {
          view.container.setPosition(x, y);
        }
      }
    }
  }

  // ---- Zone 4: boosters ----------------------------------------------

  private buildBoosters(topY: number, boostH: number) {
    this.boostBarTop = topY;
    this.boostBarH = boostH;
    this.boostBar = this.add.container(0, 0).setDepth(30);
    this.drawBoosters();
  }

  // (Re)draw the four booster buttons reflecting unlock / owned-count / price state.
  private drawBoosters() {
    if (!this.boostBar) return;
    this.boostBar.removeAll(true);
    const topY = this.boostBarTop;
    const size = Math.min(this.boostBarH - 26, 52);
    const iconY = topY + size / 2 + 2;
    const gap = 16;
    const totalW = BOOSTERS.length * size + (BOOSTERS.length - 1) * gap;
    const startX = (GAME_W - totalW) / 2 + size / 2;

    BOOSTERS.forEach((b, i) => {
      const x = startX + i * (size + gap);
      const unlocked = this.isBoosterUnlocked(b.key);
      const count = this.boosterCounts[b.key] ?? 0;
      const btn = this.add.image(x, iconY, b.img).setDisplaySize(size, size);
      this.boostBar!.add(btn);

      if (!unlocked) {
        // Locked until its unlock level: greyed out + lock + "Lv N".
        btn.setTint(0x555555).setAlpha(0.5);
        const lock = this.add.text(x, iconY, "🔒", { fontSize: "22px" }).setOrigin(0.5);
        const lv = this.add
          .text(x, iconY + size / 2 + 9, `Lv ${b.unlock}`, {
            fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "11px", color: "#8a8a8a",
          })
          .setOrigin(0.5);
        this.boostBar!.add(lock);
        this.boostBar!.add(lv);
        return;
      }

      // Unlocked → tappable.
      btn.setInteractive({ useHandCursor: true });
      btn.on("pointerdown", () => {
        this.tweens.add({ targets: btn, scale: btn.scale * 0.88, duration: 80, yoyo: true });
        this.runBooster(b.key);
      });
      // Owned-count badge on the icon's top-right corner — ALWAYS visible so the
      // player can see how many they have left right on the booster. Green when you
      // have some, red when empty.
      const bx = x + size / 2 - 3;
      const byy = iconY - size / 2 + 3;
      const dot = this.add.circle(bx, byy, 11, count > 0 ? 0x2f9f4a : 0xc0392b).setStrokeStyle(2, 0xffffff, 1);
      const dotN = this.add
        .text(bx, byy, String(count), {
          fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "13px", color: "#ffffff",
        })
        .setOrigin(0.5);
      this.boostBar!.add(dot);
      this.boostBar!.add(dotN);

      // When empty, also show the gold price below so the buy cost is clear.
      if (count === 0) {
        const cy = iconY + size / 2 + 22;
        const coin = this.add.circle(x - 12, cy, 6, 0xf9c22e).setStrokeStyle(1.5, 0xc98a10);
        const price = this.add
          .text(x - 2, cy, String(b.cost), {
            fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "12px", color: "#8a5a10",
          })
          .setOrigin(0, 0.5);
        this.boostBar!.add(coin);
        this.boostBar!.add(price);
      }
    });
  }

  private runBooster(key: string) {
    // Out of stock → tapping offers to BUY one with gold (explicit confirm) instead
    // of using. Buying tops up the inventory; the player taps again to use it. This
    // keeps buying separate from using so a failed precondition can't waste gold.
    if (!this.tutPaused && this.isBoosterUnlocked(key) && (this.boosterCounts[key] ?? 0) <= 0) {
      this.promptBuyBooster(key);
      return;
    }

    // If this tap is completing a booster tutorial, drop its spotlight & unpause first.
    const tut = this.tutBooster && this.tutBooster.key === key ? this.tutBooster : undefined;
    if (tut) {
      this.tutBooster = undefined;
      this.clearTutHint();
    }

    if (key === "add") this.boosterAdd();
    else if (key === "hand") this.boosterHand();
    else if (key === "refresh") this.boosterRefresh();
    else if (key === "magnet") this.boosterMagnet();

    // Chain to the next just-unlocked booster's tutorial (only when several unlocked
    // at once — normally there's just one per level).
    if (tut && tut.idx < tut.list.length - 1) {
      this.time.delayedCall(450, () => this.showBoosterTutorials(tut.list, tut.idx + 1));
    }
  }

  // Confirm-and-buy one booster with gold (shown when the player taps an empty one).
  // On buy, +1 goes into the inventory; the player taps again to actually use it.
  private promptBuyBooster(key: string) {
    const def = BOOSTERS.find((b) => b.key === key)!;
    this.tutPaused = true; // freeze the board behind the modal (proper modal behaviour)
    const D = 400;
    const pw = 300;
    const ph = 226;
    const x0 = GAME_W / 2 - pw / 2;
    const y0 = GAME_H / 2 - ph / 2;
    const dim = this.add
      .rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.6)
      .setDepth(D)
      .setInteractive();
    const panel = this.add.graphics().setDepth(D + 1);
    panel.fillStyle(0xf7edd0, 1);
    panel.fillRoundedRect(x0, y0, pw, ph, 20);
    panel.lineStyle(4, 0x8a5a12, 1);
    panel.strokeRoundedRect(x0, y0, pw, ph, 20);
    const objs: Phaser.GameObjects.GameObject[] = [dim, panel];

    const icon = this.add.image(GAME_W / 2, y0 + 56, def.img).setDisplaySize(60, 60).setDepth(D + 2);
    const title = this.add
      .text(GAME_W / 2, y0 + 104, `Buy ${def.label}?`, {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "20px", color: "#6a4a12",
      })
      .setOrigin(0.5)
      .setDepth(D + 2);
    const coin = this.add.circle(GAME_W / 2 - 22, y0 + 138, 11, 0xf9c22e).setStrokeStyle(2, 0xc98a10).setDepth(D + 2);
    const price = this.add
      .text(GAME_W / 2 - 6, y0 + 138, String(def.cost), {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "19px", color: "#8a5a10",
      })
      .setOrigin(0, 0.5)
      .setDepth(D + 2);
    objs.push(icon, title, coin, price);

    const close = () => {
      objs.forEach((o) => o.destroy());
      this.tutPaused = false; // unfreeze
    };
    const no = this.add
      .text(GAME_W / 2 - 66, y0 + ph - 30, "CANCEL", {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "15px", color: "#ffffff",
        backgroundColor: "#b0392b", padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(D + 2)
      .setInteractive({ useHandCursor: true });
    const yes = this.add
      .text(GAME_W / 2 + 56, y0 + ph - 30, "BUY", {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "15px", color: "#ffffff",
        backgroundColor: "#3a8a3a", padding: { x: 24, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(D + 2)
      .setInteractive({ useHandCursor: true });
    objs.push(no, yes);

    no.on("pointerdown", () => close());
    dim.on("pointerdown", () => close());
    yes.on("pointerdown", () => {
      if (this.gold < def.cost) {
        close();
        this.toast(`Need ${def.cost} gold`);
        return;
      }
      this.addGold(-def.cost);
      this.boosterCounts[key] = (this.boosterCounts[key] ?? 0) + 1;
      this.saveBoosterCounts();
      this.drawBoosters();
      close();
      this.toast(`${def.label} purchased! Tap to use.`);
    });
  }

  // ---- Booster inventory: owned counts + unlock gifts -----------------

  private loadBoosterCounts(): Record<string, number> {
    try {
      const raw = localStorage.getItem("pf_boost_counts");
      return raw ? (JSON.parse(raw) as Record<string, number>) : {};
    } catch {
      return {};
    }
  }
  private saveBoosterCounts() {
    try {
      localStorage.setItem("pf_boost_counts", JSON.stringify(this.boosterCounts));
    } catch {
      /* storage unavailable */
    }
  }
  private giftedSet(): Set<string> {
    try {
      return new Set((localStorage.getItem("pf_boost_gifted") ?? "").split(",").filter(Boolean));
    } catch {
      return new Set();
    }
  }
  // Available once gifted — i.e. once the player has reached its unlock level.
  private isBoosterUnlocked(key: string): boolean {
    return this.giftedSet().has(key);
  }

  // Entering a level: gift (once) every booster whose unlock level is now reached so
  // the player owns it — but only TUTORIALISE the ones unlocking EXACTLY at this level.
  // (Jumping ahead, e.g. testing straight to level 11, still grants the earlier
  // boosters but won't replay tutorials for levels you've already passed.)
  private checkBoosterUnlocks(levelNum: number) {
    const gifted = this.giftedSet();
    let changed = false;
    const freshTut: BoosterDef[] = [];
    for (const b of BOOSTERS) {
      if (levelNum >= b.unlock && !gifted.has(b.key)) {
        gifted.add(b.key);
        this.boosterCounts[b.key] = (this.boosterCounts[b.key] ?? 0) + FREE_GIFT; // free copies
        changed = true;
        if (b.unlock === levelNum) freshTut.push(b); // tutorial only at its own unlock level
      }
    }
    if (!changed) return;
    try {
      localStorage.setItem("pf_boost_gifted", [...gifted].join(","));
    } catch {
      /* storage unavailable */
    }
    this.saveBoosterCounts();
    this.drawBoosters();
    if (freshTut.length > 0) this.showBoosterTutorials(freshTut, 0);
  }

  // A modal explaining a just-unlocked booster (English). Chains through `list`.
  private showBoosterTutorials(list: BoosterDef[], idx: number) {
    if (idx >= list.length || this.won) return;
    this.tutPaused = true; // freeze the game behind the booster modal
    const b = list[idx];
    const D = 400;
    const pw = 320;
    const ph = 300;
    const x0 = GAME_W / 2 - pw / 2;
    const y0 = GAME_H / 2 - ph / 2;
    const dim = this.add
      .rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.6)
      .setDepth(D)
      .setInteractive();
    const panel = this.add.graphics().setDepth(D + 1);
    panel.fillStyle(0xf7edd0, 1);
    panel.fillRoundedRect(x0, y0, pw, ph, 20);
    panel.lineStyle(4, 0x8a5a12, 1);
    panel.strokeRoundedRect(x0, y0, pw, ph, 20);
    const icon = this.add.image(GAME_W / 2, y0 + 66, b.img).setDisplaySize(72, 72).setDepth(D + 2);
    const title = this.add
      .text(GAME_W / 2, y0 + 126, b.title, {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "21px", color: "#6a4a12",
      })
      .setOrigin(0.5)
      .setDepth(D + 2);
    const desc = this.add
      .text(GAME_W / 2, y0 + 178, b.desc, {
        fontFamily: "Arial, sans-serif", fontSize: "14px", color: "#6a4a12", align: "center",
        wordWrap: { width: pw - 44 },
      })
      .setOrigin(0.5)
      .setDepth(D + 2);
    const gift = this.add
      .text(GAME_W / 2, y0 + ph - 66, `🎁 You got ${FREE_GIFT} free!`, {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "15px", color: "#2a7a2a",
      })
      .setOrigin(0.5)
      .setDepth(D + 2);
    const ok = this.add
      .text(GAME_W / 2, y0 + ph - 32, "SHOW ME!", {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "16px", color: "#ffffff",
        backgroundColor: "#3a8a3a", padding: { x: 26, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(D + 2)
      .setInteractive({ useHandCursor: true });
    const kill = () => {
      [dim, panel, icon, title, desc, gift, ok].forEach((o) => o.destroy());
      this.tutPaused = false; // unfreeze
      // Now point at the REAL booster button and let the player tap it themselves.
      this.spotlightBooster(list, idx);
    };
    ok.on("pointerdown", kill);
    dim.on("pointerdown", kill);
  }

  // Highlight the actual booster button in the bar and wait for the player to tap it
  // (the tap runs the booster via its own handler; runBooster() clears this spotlight
  // and chains to the next unlocked booster's tutorial, if any).
  private spotlightBooster(list: BoosterDef[], idx: number) {
    const b = list[idx];
    const pos = this.boosterButtonPos(b.key);
    if (!pos) {
      // No button to point at (shouldn't happen) → just run it so the flow continues.
      this.time.delayedCall(80, () => this.runBooster(b.key));
      return;
    }
    this.tutBooster = { list, idx, key: b.key };
    const size = Math.min(this.boostBarH - 26, 52);
    this.showTutHint(pos.x, pos.y, "Tap this booster\nto use it!", size * 0.72);
  }

  // World position of a booster's button (mirrors the layout math in drawBoosters).
  private boosterButtonPos(key: string): { x: number; y: number } | null {
    const i = BOOSTERS.findIndex((b) => b.key === key);
    if (i < 0) return null;
    const size = Math.min(this.boostBarH - 26, 52);
    const iconY = this.boostBarTop + size / 2 + 2;
    const gap = 16;
    const totalW = BOOSTERS.length * size + (BOOSTERS.length - 1) * gap;
    const startX = (GAME_W - totalW) / 2 + size / 2;
    return { x: startX + i * (size + gap), y: iconY };
  }

  // Usable now = unlocked AND at least one owned. Buying (with gold) is a separate
  // step handled by promptBuyBooster when the player taps an empty booster.
  private canUseBooster(key: string): boolean {
    return this.isBoosterUnlocked(key) && (this.boosterCounts[key] ?? 0) > 0;
  }
  // Spend one from owned stock.
  private consumeBooster(key: string) {
    if ((this.boosterCounts[key] ?? 0) > 0) {
      this.boosterCounts[key] -= 1;
      this.saveBoosterCounts();
    }
    this.drawBoosters();
  }
  // Gate for immediate boosters: true if one is owned, else a hint to buy it.
  private affordToast(key: string): boolean {
    if (this.canUseBooster(key)) return true;
    const def = BOOSTERS.find((b) => b.key === key)!;
    this.toast(`Tap ${def.label} to buy one (${def.cost} 🪙)`);
    return false;
  }

  // "Add": grow the waiting row by one bay (max 6).
  private boosterAdd() {
    if (this.won) return;
    if (this.slotCount >= 6) {
      this.toast("Max 6 bays");
      return;
    }
    if (!this.affordToast("add")) return;
    this.consumeBooster("add");
    this.slotCount += 1;
    this.slots.push(null);
    this.layoutSlots();
    if (this.slotWarnActive) this.stopSlotWarning(); // a fresh empty bay clears the warning
    this.flashNewSlot(this.slotCount - 1); // draw the eye to the brand-new bay
    this.toast("+1 waiting bay!");
  }

  // Pulse a green ring on a bay a few times to call out that it's newly added.
  private flashNewSlot(index: number) {
    if (!this.slotXs[index]) return;
    const s = Math.round(SLOT_SIZE * 1.5) - 6;
    const ring = this.add
      .rectangle(this.slotXs[index], this.slotY, s, s)
      .setStrokeStyle(4, 0x3ad14a, 1)
      .setDepth(120);
    this.tweens.add({
      targets: ring,
      alpha: { from: 1, to: 0.1 },
      scale: { from: 1, to: 1.14 },
      duration: 360,
      yoyo: true,
      repeat: 4,
      ease: "Sine.inOut",
      onComplete: () => ring.destroy(),
    });
  }

  // "Hand": arm a one-shot tap that launches ANY car from the lineup queue (zone 3)
  // immediately, jumping the front-of-column rule. Charged only on a valid pick.
  private boosterHand() {
    if (this.won || this.handMode || this.magnetMode) return;
    const queued = this.invColumns.flat().filter((v) => v.container.scene);
    if (queued.length === 0) {
      this.toast("Queue is empty");
      return;
    }
    if (!this.affordToast("hand")) return;
    this.handMode = true;
    this.toast("Grab any car — a back-row one is best!");
    this.armHandHighlight(); // spotlight the buried back-row cars (Grab's best use)
    // Defer one tick so the tap that pressed the booster button isn't captured.
    this.time.delayedCall(40, () =>
      this.input.once("pointerdown", (p: Phaser.Input.Pointer) => {
        this.handMode = false;
        this.clearHandHighlight();
        let best: ChestView | null = null;
        let bestD = Infinity;
        for (const v of queued) {
          if (!v.container.scene) continue;
          const d = Phaser.Math.Distance.Between(p.worldX, p.worldY, v.container.x, v.container.y);
          if (d < bestD) {
            bestD = d;
            best = v;
          }
        }
        if (best && bestD < 40) {
          // Linked cars leave together, so EVERY member must be reachable near the
          // front: each must sit in the first two rows (row 1 or 2). Any deeper and the
          // group can't be pulled out cleanly — reject WITHOUT spending the booster.
          if (best.group) {
            const ok = this.groupOf(best).every((m) => {
              const p = this.findInInventory(m);
              return p && p.r <= 1;
            });
            if (!ok) {
              this.toast("Linked cars: all must be in the first 2 rows to grab them together");
              return;
            }
          }
          this.consumeBooster("hand");
          this.launchQueued(best);
          this.toast("Car sent!");
        } else {
          this.toast("Cancelled");
        }
      }),
    );
  }

  // Un-dim and ring the SECOND-row cars while Grab is armed, so the player sees the
  // cars they can pull straight up. (Only row 2 — row 3+ is barely visible, so
  // ringing it just looks like clutter peeking out.)
  private armHandHighlight() {
    this.clearHandHighlight();
    for (const col of this.invColumns) {
      const r = 1;
      if (col.length > r) {
        const v = col[r];
        if (!v.container.scene) continue;
        v.container.setAlpha(1); // un-dim so the buried car stands out
        const s = this.chestSize * 0.98;
        const ring = this.add
          .rectangle(v.container.x, v.container.y, s, s)
          .setStrokeStyle(3, 0xffe14a, 0.95)
          .setDepth(25);
        this.tweens.add({
          targets: ring,
          alpha: { from: 0.95, to: 0.3 },
          scale: { from: 1, to: 1.12 },
          duration: 480,
          yoyo: true,
          repeat: -1,
          ease: "Sine.inOut",
        });
        this.handMarks.push(ring);
      }
    }
  }

  private clearHandHighlight() {
    if (this.handMarks.length === 0) return;
    for (const o of this.handMarks) {
      this.tweens.killTweensOf(o);
      o.destroy();
    }
    this.handMarks = [];
    this.layoutInventory(false); // restore the dimmed back rows
  }

  // Launch a specific queued car regardless of its position in the column.
  private launchQueued(view: ChestView) {
    this.playPop(); // same "pop" feedback as a normal launch
    // Linked cars leave together (Hand booster bypasses the front-of-column rule).
    const group = this.groupOf(view);
    for (const v of group) {
      const p = this.findInInventory(v);
      if (!p) continue;
      p.col.splice(p.r, 1);
      const hit = v.container.getData("hit") as Phaser.GameObjects.Rectangle;
      hit.disableInteractive();
      v.container.clearMask();
      this.pending.push(v);
    }
    this.layoutInventory(true);
  }

  // "Refresh": re-colour the cars still in the lineup queue to random colours that
  // still exist on the board (each remaining colour gets at least one car if it
  // fits), so you can bring a colour you need to the front.
  private boosterRefresh() {
    if (this.won) return;
    // Only recolour ordinary colour cars (leave hammer/wood cars as they are).
    const cars = this.invColumns.flat().filter((v) => v.container.scene && (v.chest.kind ?? "color") === "color");
    if (cars.length === 0) {
      this.toast("Queue is empty");
      return;
    }
    // colours that still have uncollected SLIMES on the board (skip obstacles)
    const left: number[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < this.keys.length; i++) {
      if (this.keys[i]) {
        const c = this.level.board[i];
        if (c >= 0 && c < HARD_ROCK && !seen.has(c)) {
          seen.add(c);
          left.push(c);
        }
      }
    }
    if (left.length === 0) {
      this.toast("No slimes left");
      return;
    }
    if (!this.affordToast("refresh")) return;
    this.consumeBooster("refresh");

    // build an assignment that covers each remaining colour at least once, then
    // fills the rest at random; shuffle so positions are random.
    const assign: number[] = [];
    for (const c of left) if (assign.length < cars.length) assign.push(c);
    while (assign.length < cars.length) assign.push(left[Math.floor(Math.random() * left.length)]);
    for (let i = assign.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [assign[i], assign[j]] = [assign[j], assign[i]];
    }
    // Focus the lineup area (dim around it + a glowing frame) so the player's eye
    // goes there, then recolour the cars in a slow left-to-right "flip" wave.
    const total = (cars.length - 1) * 90 + 440;
    this.focusLineup(total + 350);
    cars.forEach((v, k) => {
      const baseX = v.container.scaleX;
      this.tweens.add({
        targets: v.container,
        scaleX: 0.08, // flip edge-on...
        duration: 200,
        delay: k * 90,
        ease: "Cubic.in",
        onComplete: () => {
          this.setCarColor(v, assign[k]); // ...swap the colour at the thin point...
          this.tweens.add({ targets: v.container, scaleX: baseX, duration: 240, ease: "Back.out" }); // ...flip back
        },
      });
    });
    this.time.delayedCall(total + 120, () => this.toast("Cars recolored!"));
  }

  // Briefly dim everything EXCEPT the lineup queue (zone 3), with a pulsing frame, so
  // the player notices a change is happening there. Auto-fades after `dur` ms. Purely
  // visual — not interactive, so it never blocks taps.
  private focusLineup(dur: number) {
    const cars = this.invColumns.flat().filter((v) => v.container.scene);
    if (cars.length === 0) return;
    const xs = cars.map((v) => v.container.x);
    const ys = cars.map((v) => v.container.y);
    const pad = this.chestSize * 0.85;
    const x0 = Math.max(0, Math.min(...xs) - pad);
    const y0 = Math.max(0, Math.min(...ys) - pad);
    const x1 = Math.min(GAME_W, Math.max(...xs) + pad);
    const y1 = Math.min(GAME_H, Math.max(...ys) + pad);
    const objs: Phaser.GameObjects.GameObject[] = [];
    const mat = (mx: number, my: number, mw: number, mh: number) => {
      if (mw <= 0 || mh <= 0) return;
      const r = this.add.rectangle(mx, my, mw, mh, 0x000000, 0).setOrigin(0, 0).setDepth(115);
      this.tweens.add({ targets: r, fillAlpha: 0.45, duration: 200 });
      objs.push(r);
    };
    mat(0, 0, GAME_W, y0); // above
    mat(0, y1, GAME_W, GAME_H - y1); // below
    mat(0, y0, x0, y1 - y0); // left
    mat(x1, y0, GAME_W - x1, y1 - y0); // right
    const frame = this.add
      .rectangle((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0)
      .setStrokeStyle(4, 0xffe14a, 1)
      .setDepth(116)
      .setAlpha(0);
    this.tweens.add({ targets: frame, alpha: 1, duration: 200 });
    this.tweens.add({ targets: frame, scale: 1.02, duration: 460, yoyo: true, repeat: -1, ease: "Sine.inOut" });
    objs.push(frame);
    this.time.delayedCall(dur, () => {
      for (const o of objs) {
        this.tweens.killTweensOf(o);
        this.tweens.add({ targets: o, alpha: 0, duration: 320, onComplete: () => o.destroy() });
      }
    });
  }

  // Recolour a car view to a colour id (swaps its sprite + updates its data).
  private setCarColor(view: ChestView, color: number) {
    view.chest.color = color;
    const key = `car-${color}`;
    const frame = this.textures.get(key).has("trim") ? "trim" : undefined;
    if (frame) view.carImg.setTexture(key, frame);
    else view.carImg.setTexture(key);
    view.carImg.setScale((this.chestSize * 1.15) / (view.carImg.height || this.chestSize));
  }

  // "Magnet": arm a one-shot tap on a board slime. A VIP car then appears and reels
  // in the CLUSTER of same-colour slimes connected (edge-to-edge) to the tapped one
  // — not every slime of that colour on the board.
  private boosterMagnet() {
    if (this.won || this.handMode || this.magnetMode) return;
    if (this.keysRemaining <= 0) {
      this.toast("No slimes left");
      return;
    }
    if (!this.affordToast("magnet")) return;
    this.magnetMode = true;
    this.toast("Tap a slime to pull its cluster");
    // Defer one tick so the tap that pressed the booster button isn't captured.
    this.time.delayedCall(40, () =>
      this.input.once("pointerdown", (p: Phaser.Input.Pointer) => {
        this.magnetMode = false;
        const idx = this.nearestSlime(p.worldX, p.worldY);
        if (idx < 0) {
          this.toast("Cancelled");
          return;
        }
        // Easy to mis-tap → confirm the picked cluster first.
        this.confirmMagnet(idx);
      }),
    );
  }

  // Nearest real slime cell to a world point, within ~1.3 cells — a forgiving tap
  // for the magnet, since small slimes are fiddly to hit dead-centre.
  private nearestSlime(wx: number, wy: number): number {
    const exact = this.slimeAt(wx, wy);
    if (exact >= 0) return exact;
    const { cols, rows } = this.level;
    const c0 = Math.floor((wx - this.gridX) / this.cell);
    const r0 = Math.floor((wy - this.gridY) / this.cell);
    let best = -1;
    let bestD = (this.cell * 1.3) ** 2;
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      for (let c = c0 - 1; c <= c0 + 1; c++) {
        if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
        const idx = r * cols + c;
        if (!this.keys[idx] || isObstacle(this.level.board[idx])) continue;
        const scx = this.gridX + c * this.cell + this.cell / 2;
        const scy = this.gridY + r * this.cell + this.cell / 2;
        const d = (wx - scx) ** 2 + (wy - scy) ** 2;
        if (d < bestD) {
          bestD = d;
          best = idx;
        }
      }
    }
    return best;
  }

  // Show the picked colour (swatch + slime + count) and ask the player to confirm
  // before the Magnet is actually spent. Cancel costs nothing. Game freezes so the
  // board (and thus the count) can't change under the player mid-decision.
  private confirmMagnet(startIdx: number) {
    const color = this.level.board[startIdx];
    const group = this.connectedSameColor(startIdx);
    const total = group.length;
    if (total === 0) {
      this.toast("No slimes there");
      return;
    }
    this.tutPaused = true;
    const D = 400;
    const pw = 300;
    const ph = 250;
    const x0 = GAME_W / 2 - pw / 2;
    const y0 = GAME_H / 2 - ph / 2;
    const dim = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.6).setDepth(D).setInteractive();
    const panel = this.add.graphics().setDepth(D + 1);
    panel.fillStyle(0xf7edd0, 1);
    panel.fillRoundedRect(x0, y0, pw, ph, 20);
    panel.lineStyle(4, 0x8a5a12, 1);
    panel.strokeRoundedRect(x0, y0, pw, ph, 20);
    const objs: Phaser.GameObjects.GameObject[] = [dim, panel];
    const hex = COLORS[color] ?? 0x888888;
    const swatch = this.add.circle(GAME_W / 2, y0 + 66, 40, hex).setStrokeStyle(4, shade(hex)).setDepth(D + 2);
    objs.push(swatch);
    if (this.textures.exists(`slime-${color}`)) {
      const sl = this.add.image(GAME_W / 2, y0 + 66, `slime-${color}`).setDisplaySize(60, 60).setDepth(D + 3);
      objs.push(sl);
    }
    const title = this.add
      .text(GAME_W / 2, y0 + 126, "Pull THIS color?", {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "20px", color: "#6a4a12",
      })
      .setOrigin(0.5)
      .setDepth(D + 2);
    const cnt = this.add
      .text(GAME_W / 2, y0 + 158, `${total} slime${total > 1 ? "s" : ""} will board the VIP car`, {
        fontFamily: "Arial, sans-serif", fontSize: "13px", color: "#6a4a12", align: "center",
        wordWrap: { width: pw - 44 },
      })
      .setOrigin(0.5)
      .setDepth(D + 2);
    objs.push(title, cnt);
    const close = () => {
      objs.forEach((o) => o.destroy());
      this.tutPaused = false;
    };
    const no = this.add
      .text(GAME_W / 2 - 66, y0 + ph - 32, "CANCEL", {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "15px", color: "#ffffff",
        backgroundColor: "#b0392b", padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(D + 2)
      .setInteractive({ useHandCursor: true });
    const yes = this.add
      .text(GAME_W / 2 + 60, y0 + ph - 32, "USE", {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "15px", color: "#ffffff",
        backgroundColor: "#3a8a3a", padding: { x: 22, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(D + 2)
      .setInteractive({ useHandCursor: true });
    objs.push(no, yes);
    no.on("pointerdown", () => {
      close();
      this.toast("Cancelled");
    });
    yes.on("pointerdown", () => {
      close();
      this.consumeBooster("magnet");
      this.spawnVipCollector(color, group);
    });
  }

  // All slimes orthogonally connected to `startIdx` that share its colour — a
  // flood-fill cluster where each cell touches the next by an EDGE. Obstacles,
  // empty cells and different colours break the connection.
  private connectedSameColor(startIdx: number): number[] {
    const { cols, rows } = this.level;
    const color = this.level.board[startIdx];
    if (color < 0 || !this.keys[startIdx] || isObstacle(color)) return [];
    const seen = new Set<number>([startIdx]);
    const stack = [startIdx];
    const out: number[] = [];
    while (stack.length) {
      const i = stack.pop()!;
      out.push(i);
      const r = Math.floor(i / cols);
      const c = i % cols;
      const neigh = [
        r > 0 ? i - cols : -1, // up
        r < rows - 1 ? i + cols : -1, // down
        c > 0 ? i - 1 : -1, // left
        c < cols - 1 ? i + 1 : -1, // right
      ];
      for (const n of neigh) {
        if (n < 0 || seen.has(n)) continue;
        if (this.keys[n] && this.level.board[n] === color) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    return out;
  }

  // Board cell index of the slime under a world point, or -1.
  private slimeAt(wx: number, wy: number): number {
    const { cols, rows } = this.level;
    const c = Math.floor((wx - this.gridX) / this.cell);
    const r = Math.floor((wy - this.gridY) / this.cell);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return -1;
    const idx = r * cols + c;
    // Magnet only works on real slimes, not obstacles.
    return this.keys[idx] && !isObstacle(this.level.board[idx]) ? idx : -1;
  }

  // A VIP car appears and reels in the given cluster of slimes, one every ~90ms,
  // then drives off once full (handled by the runner boarding code).
  private spawnVipCollector(color: number, group: number[]) {
    const remaining = group.filter((i) => this.keys[i] && this.level.board[i] === color);
    const total = remaining.length;
    if (total === 0) {
      this.toast("No slimes of that color");
      return;
    }
    const view = this.makeVipView(color, total);
    // Park the VIP car down near the waiting row, centred — slimes reel all the
    // way down to it (just above the waiting bays).
    const cx = GAME_W / 2;
    const cy = this.slotY - Math.round(this.chestSize * 0.85);
    view.container.setPosition(cx, cy);
    view.container.setDepth(DEPTH_RUNNER + 5);
    const baseScale = view.container.scale;
    view.container.setScale(baseScale * 0.2);
    this.tweens.add({ targets: view.container, scale: baseScale, duration: 300, ease: "Back.out" });

    // reel slimes in quickly, one at a time
    const timer = this.time.addEvent({
      delay: 90,
      loop: true,
      callback: () => {
        if (!view.container.scene) {
          timer.remove();
          return;
        }
        // Next still-present slime in the tapped cluster.
        let idx = -1;
        while (remaining.length) {
          const cand = remaining.shift()!;
          if (this.keys[cand] && this.level.board[cand] === color) {
            idx = cand;
            break;
          }
        }
        if (idx < 0) {
          timer.remove(); // whole cluster is already reeling in / gone
          return;
        }
        this.fireTo(view, idx); // slime runs to the VIP car; boards on arrival
      },
    });
    this.toast("VIP car incoming!");
  }

  // The VIP magnet car (bigger, premium sprite, its seat count on top).
  private makeVipView(color: number, count: number): ChestView {
    const w = this.chestSize;
    const container = this.add.container(0, 0);
    const frame = this.textures.get("car-vip").has("trim") ? "trim" : undefined;
    const img = frame ? this.add.image(0, 0, "car-vip", frame) : this.add.image(0, 0, "car-vip");
    img.setScale((w * 1.72) / (img.height || w)); // ~1.5x a normal car (1.15) — premium & big
    const countText = this.add
      .text(0, 0, String(count), {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: `${Math.round(w * 0.6)}px`,
        color: TEXT_LIGHT,
        stroke: "#00000099",
        strokeThickness: 6,
      })
      .setOrigin(0.5);
    container.add([img, countText]);
    return { chest: { color, count }, container, countText, carImg: img, inFlight: 0 };
  }

  // ---- Top HUD: settings (left) · level pill (center) · gold (right) ----

  private buildTopBar(levelNum: number) {
    const y = 32;
    const D = 40;

    // Settings button (left): a round red button with a white gear (real-game look).
    const sBtn = this.add
      .circle(30, y, 20, 0xe23b3b, 1)
      .setStrokeStyle(3, 0xffffff, 0.95)
      .setDepth(D)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(30, y - 1, "⚙", { fontFamily: "Arial, sans-serif", fontSize: "22px", color: "#ffffff" })
      .setOrigin(0.5)
      .setDepth(D + 1);
    sBtn.on("pointerdown", () => {
      this.tweens.add({ targets: sBtn, scale: 0.88, duration: 80, yoyo: true });
      this.openSettings();
    });

    // DEBUG "WIN" button (user 2026-07-27): instantly clear the level without playing —
    // a test convenience sitting in the free strip between the gear and the level pill.
    const winX = 105;
    const winPill = this.add.graphics().setDepth(D);
    winPill.fillStyle(0x4caf50, 1);
    winPill.fillRoundedRect(winX - 30, y - 14, 60, 28, 14);
    winPill.lineStyle(2, 0xffffff, 0.9);
    winPill.strokeRoundedRect(winX - 30, y - 14, 60, 28, 14);
    this.add
      .text(winX, y, "WIN", { fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "15px", color: "#ffffff" })
      .setOrigin(0.5)
      .setDepth(D + 2);
    const winHit = this.add
      .rectangle(winX, y, 60, 28, 0xffffff, 0.001)
      .setDepth(D + 3)
      .setInteractive({ useHandCursor: true });
    winHit.on("pointerdown", () => {
      if (this.won || this.lost) return;
      this.tweens.add({ targets: [winPill], scale: 0.9, duration: 80, yoyo: true });
      this.win();
    });

    // Level pill (center): red rounded pill with bold white text.
    const lvlText = this.add
      .text(GAME_W / 2, y, `LEVEL ${levelNum}`, {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "18px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setDepth(D + 2);
    const lpw = lvlText.width + 40;
    const lph = 34;
    const lpill = this.add.graphics().setDepth(D + 1);
    lpill.fillStyle(0xe23b3b, 1);
    lpill.fillRoundedRect(GAME_W / 2 - lpw / 2, y - lph / 2, lpw, lph, lph / 2);
    lpill.lineStyle(3, 0xffffff, 0.95);
    lpill.strokeRoundedRect(GAME_W / 2 - lpw / 2, y - lph / 2, lpw, lph, lph / 2);

    // Gold cluster (right): [coin  amount]  (+)
    const plusR = 13;
    const plusX = GAME_W - 16 - plusR;
    // rounded pill behind the coin + amount
    const pillRight = plusX - plusR - 6;
    const pillLeft = pillRight - 96;
    const pill = this.add.graphics().setDepth(D);
    pill.fillStyle(0x3a2a14, 0.85);
    pill.fillRoundedRect(pillLeft, y - 15, pillRight - pillLeft, 30, 15);
    pill.lineStyle(2, 0xffe9b0, 0.7);
    pill.strokeRoundedRect(pillLeft, y - 15, pillRight - pillLeft, 30, 15);

    // coin — plain golden disc + dark-gold rim (matches the Home coin, no letter)
    const coinX = pillLeft + 16;
    this.add.circle(coinX, y, 12, 0xf9c22e).setStrokeStyle(2, 0xc98a10).setDepth(D + 1);
    // amount (left-aligned, grows toward the plus)
    this.goldText = this.add
      .text(coinX + 15, y, String(this.gold), {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "17px",
        color: "#ffe9b0",
      })
      .setOrigin(0, 0.5)
      .setDepth(D + 2);

    // buy "+" button
    const plus = this.add
      .circle(plusX, y, plusR, 0x4caf50)
      .setStrokeStyle(2, 0xffffff, 0.85)
      .setDepth(D + 1)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(plusX, y - 1, "+", {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "20px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setDepth(D + 2);
    plus.on("pointerdown", () => {
      this.tweens.add({ targets: plus, scale: 0.85, duration: 80, yoyo: true });
      this.buyGold();
    });
  }

  private loadGold(): number {
    try {
      return parseInt(localStorage.getItem("pf_gold") ?? "0", 10) || 0;
    } catch {
      return 0;
    }
  }

  private saveGold() {
    try {
      localStorage.setItem("pf_gold", String(this.gold));
    } catch {
      /* storage unavailable — keep gold in-memory only */
    }
  }

  private addGold(n: number) {
    this.gold = Math.max(0, this.gold + n);
    this.saveGold();
    if (this.goldText) {
      this.goldText.setText(String(this.gold));
      this.tweens.add({ targets: this.goldText, scale: 1.35, duration: 120, yoyo: true });
    }
  }

  // First-clear reward gate: returns true (and records it) only the FIRST time a
  // given level is beaten, so replaying an easy level can't farm gold.
  private claimFirstClearReward(levelNum: number): boolean {
    try {
      const raw = localStorage.getItem("pf_rewarded") ?? "[]";
      const done = new Set<number>(JSON.parse(raw));
      if (done.has(levelNum)) return false;
      done.add(levelNum);
      localStorage.setItem("pf_rewarded", JSON.stringify([...done]));
      return true;
    } catch {
      return true; // storage unavailable — just award it (in-memory session)
    }
  }

  // Bump the saved progress so the level picker unlocks/star-marks levels.
  private unlockProgress(reached: number) {
    try {
      const cur = parseInt(localStorage.getItem("pf_progress") ?? "1", 10) || 1;
      if (reached > cur) localStorage.setItem("pf_progress", String(reached));
    } catch {
      /* storage unavailable — progress just won't persist */
    }
  }

  // Real store / IAP not wired up yet. For now the "+" hands out free gold with
  // no limit (testing convenience).
  private buyGold() {
    this.addGold(5000);
    this.toast("+5000 Gold");
  }

  // Minimal settings overlay (placeholder — sound/music toggles come later).
  private openSettings() {
    const D = 200;
    const pw = 300;
    const ph = 300;
    const x0 = GAME_W / 2 - pw / 2;
    const y0 = GAME_H / 2 - ph / 2;
    const dim = this.add
      .rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.5)
      .setDepth(D)
      .setInteractive();
    const panel = this.add.graphics().setDepth(D + 1);
    panel.fillStyle(0xf7edd0, 1);
    panel.fillRoundedRect(x0, y0, pw, ph, 18);
    panel.lineStyle(4, 0x8a5a12, 1);
    panel.strokeRoundedRect(x0, y0, pw, ph, 18);
    const title = this.add
      .text(GAME_W / 2, y0 + 34, "SETTINGS", {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "22px",
        color: "#6a4a12",
      })
      .setOrigin(0.5)
      .setDepth(D + 2);
    // Music + SFX toggles (procedural audio — no files, so no licensing).
    const mkToggle = (ty: number, label: string, get: () => boolean, set: (v: boolean) => void) => {
      const btn = this.add
        .text(GAME_W / 2, ty, "", {
          fontFamily: "Arial, sans-serif",
          fontStyle: "bold",
          fontSize: "15px",
          color: "#ffffff",
          padding: { x: 16, y: 7 },
        })
        .setOrigin(0.5)
        .setDepth(D + 2)
        .setInteractive({ useHandCursor: true });
      const refresh = () => {
        const on = get();
        btn.setText(`${label}: ${on ? "BẬT" : "TẮT"}`);
        btn.setBackgroundColor(on ? "#3a8a3a" : "#9a9a9a");
      };
      refresh();
      btn.on("pointerdown", () => {
        set(!get());
        refresh();
      });
      return btn;
    };
    Audio.unlock(); // opening settings is a user gesture — safe to init audio
    const sfxBtn = mkToggle(y0 + 90, "🔊 Sound FX", () => Audio.isSfxOn, (v) => Audio.setSfx(v));
    // Step guide (user 2026-07-30): default OFF; when ON the game points at the next move.
    const guideBtn = mkToggle(y0 + 132, "🧭 Chỉ dẫn từng bước", () => this.guideMode, (v) => {
      this.guideMode = v;
      try { localStorage.setItem("hopin_guide", v ? "1" : "0"); } catch { /* ignore */ }
      if (!v) this.clearGuidePointer();
    });

    // Jump back to the level picker.
    const select = this.add
      .text(GAME_W / 2, y0 + 198, "🗺  Levels", {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "16px",
        color: "#ffffff",
        backgroundColor: "#3a8a3a",
        padding: { x: 20, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(D + 2)
      .setInteractive({ useHandCursor: true });
    const close = this.add
      .text(GAME_W / 2, y0 + ph - 28, "Close", {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "16px",
        color: "#ffffff",
        backgroundColor: "#8a5a12",
        padding: { x: 18, y: 7 },
      })
      .setOrigin(0.5)
      .setDepth(D + 2)
      .setInteractive({ useHandCursor: true });
    const kill = () => {
      dim.destroy();
      panel.destroy();
      title.destroy();
      sfxBtn.destroy();
      guideBtn.destroy();
      select.destroy();
      close.destroy();
    };
    dim.on("pointerdown", kill);
    close.on("pointerdown", kill);
    select.on("pointerdown", () => this.scene.start("select"));
  }

  // Small contextual notice just above the waiting bays.
  private smallNotice(msg: string) {
    const y = this.slotY - SLOT_SIZE * 0.9;
    const t = this.add
      .text(GAME_W / 2, y, msg, {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "15px",
        color: "#fff2c8",
        stroke: "#8a2a10",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(320)
      .setScale(0.8);
    this.tweens.add({ targets: t, scale: 1, duration: 140, ease: "Back.out" });
    this.tweens.add({
      targets: t,
      y: y - 18,
      alpha: 0,
      delay: 650,
      duration: 480,
      ease: "Quad.out",
      onComplete: () => t.destroy(),
    });
  }

  // Too many cars on the road: bounce the "N/5" signal + a small notice.
  private trackFullNotice() {
    if (this.signalPost?.scene) {
      this.tweens.add({
        targets: this.signalPost,
        scale: 1.28,
        duration: 110,
        yoyo: true,
        repeat: 2,
        ease: "Quad.out",
      });
    }
    this.smallNotice(`Max ${MAX_ON_TRACK}/${MAX_ON_TRACK} cars on the track!`);
  }

  private toast(msg: string) {
    const y = GAME_H * 0.3;
    const label = this.add
      .text(0, 0, msg, {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "24px",
        color: "#fff8d0",
        align: "center",
      })
      .setOrigin(0.5);
    // rounded pill behind the text for a chunky, readable banner
    const pw = label.width + 48;
    const ph = label.height + 26;
    const bg = this.add.graphics();
    bg.fillStyle(0x3a250a, 0.9);
    bg.fillRoundedRect(-pw / 2, -ph / 2, pw, ph, ph / 2);
    bg.lineStyle(3, 0xffd98a, 0.95);
    bg.strokeRoundedRect(-pw / 2, -ph / 2, pw, ph, ph / 2);

    const box = this.add.container(GAME_W / 2, y, [bg, label]).setDepth(300);
    box.setScale(0.6);
    // pop in, hold, then float up and fade
    this.tweens.add({ targets: box, scale: 1, duration: 200, ease: "Back.out" });
    this.tweens.add({
      targets: box,
      y: y - GAME_H * 0.06,
      alpha: 0,
      delay: 700,
      duration: 650,
      ease: "Quad.out",
      onComplete: () => box.destroy(),
    });
  }

  // Register a tight "trim" frame around a sprite's non-transparent pixels, so the
  // art's transparent padding doesn't affect its on-screen size. Runs once per key.
  // Procedural placeholder slime for a colour that has no slime-*.png yet: a glossy
  // rounded square in the tile colour with a little face, matching the real art's read.
  // A FACELESS board tile: flat palette colour with a thin darker rim + a soft top
  // gloss for a little depth. No eyes/mouth — keeps the mosaic clean (faces live only
  // on the tray cars). Uniform 128px so setTexture on reveal needs no resize juggling.
  private makeTileTexture(key: string, col: number, size = 128) {
    if (this.textures.exists(key)) this.textures.remove(key);
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const r = size * 0.24;
    g.fillStyle(shade(col, 0.82), 1);
    g.fillRoundedRect(size * 0.03, size * 0.04, size * 0.94, size * 0.94, r); // thin rim
    g.fillStyle(col, 1);
    g.fillRoundedRect(size * 0.09, size * 0.08, size * 0.82, size * 0.82, r * 0.9); // flat body
    g.fillStyle(0xffffff, 0.18);
    g.fillRoundedRect(size * 0.18, size * 0.14, size * 0.5, size * 0.16, size * 0.09); // soft gloss
    // Two very small, very faint eyes — a hint of life without the noisy full face.
    g.fillStyle(0x2a2a34, 0.28);
    g.fillCircle(size * 0.42, size * 0.5, size * 0.032);
    g.fillCircle(size * 0.58, size * 0.5, size * 0.032);
    g.generateTexture(key, size, size);
    g.destroy();
  }

  private makeSlimeTexture(colorId: number, size = 128) {
    const key = `slime-${colorId}`;
    if (this.textures.exists(key)) this.textures.remove(key);
    const col = COLORS[colorId] ?? 0x888888;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const r = size * 0.24;
    // The tile reads as the FLAT palette colour: fill almost the whole square with it,
    // only a thin slightly-darker rim for depth (a heavy dark base/outline made dark
    // hues like navy/brown look black and mismatch the editor swatch).
    g.fillStyle(shade(col, 0.82), 1);
    g.fillRoundedRect(size * 0.03, size * 0.04, size * 0.94, size * 0.94, r); // thin rim
    g.fillStyle(col, 1);
    g.fillRoundedRect(size * 0.09, size * 0.08, size * 0.82, size * 0.82, r * 0.9); // body = flat colour
    g.fillStyle(0xffffff, 0.2);
    g.fillRoundedRect(size * 0.18, size * 0.14, size * 0.38, size * 0.16, size * 0.09); // soft gloss
    // small, soft eyes (not solid black) so the hue still dominates at tiny sizes
    g.fillStyle(0x33333c, 0.75);
    g.fillCircle(size * 0.41, size * 0.47, size * 0.042);
    g.fillCircle(size * 0.59, size * 0.47, size * 0.042);
    g.generateTexture(key, size, size);
    g.destroy();
  }

  // Simple hand-drawn stand-ins for the obstacle tiles + special cars until the real
  // PNGs are dropped into public/art. Called only for keys whose file didn't load.
  private makePlaceholderTexture(key: string, size = 128) {
    if (this.textures.exists(key)) this.textures.remove(key);
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const rr = size * 0.22;
    const tile = (fill: number, edge: number) => {
      g.fillStyle(edge, 1);
      g.fillRoundedRect(size * 0.05, size * 0.05, size * 0.9, size * 0.9, rr);
      g.fillStyle(fill, 1);
      g.fillRoundedRect(size * 0.09, size * 0.08, size * 0.82, size * 0.82, rr * 0.9);
    };
    const carBody = (fill: number) => {
      g.fillStyle(0x2f3237, 1);
      g.fillRoundedRect(size * 0.24, size * 0.34, size * 0.52, size * 0.5, size * 0.1); // shadow/base
      g.fillStyle(fill, 1);
      g.fillRoundedRect(size * 0.24, size * 0.3, size * 0.52, size * 0.5, size * 0.1); // body
      g.fillStyle(0xffffff, 0.85);
      g.fillCircle(size * 0.37, size * 0.4, size * 0.05); // headlights (eyes)
      g.fillCircle(size * 0.63, size * 0.4, size * 0.05);
    };
    switch (key) {
      case "rock-hard":
        tile(0x646b76, 0x3a3f47); // dark slate = "unbreakable"
        g.lineStyle(size * 0.03, 0x3a3f47, 0.9);
        g.beginPath();
        g.moveTo(size * 0.32, size * 0.24);
        g.lineTo(size * 0.5, size * 0.5);
        g.lineTo(size * 0.4, size * 0.72);
        g.strokePath();
        break;
      case "rock-soft":
        tile(0xd9c08a, 0xb0955a);
        break;
      case "rock-soft-cracked":
        tile(0xd9c08a, 0xb0955a);
        g.lineStyle(size * 0.045, 0x6a5326, 1);
        g.beginPath();
        g.moveTo(size * 0.5, size * 0.1);
        g.lineTo(size * 0.42, size * 0.44);
        g.lineTo(size * 0.6, size * 0.62);
        g.lineTo(size * 0.48, size * 0.9);
        g.strokePath();
        break;
      case "wood":
        tile(0xb5834a, 0x7c5628);
        g.lineStyle(size * 0.02, 0x7c5628, 0.9);
        g.lineBetween(size * 0.09, size * 0.42, size * 0.91, size * 0.42);
        g.lineBetween(size * 0.09, size * 0.66, size * 0.91, size * 0.66);
        break;
      case "car-hammer":
        carBody(0x9aa0a6);
        g.fillStyle(0x6a4a2a, 1);
        g.fillRect(size * 0.47, size * 0.1, size * 0.06, size * 0.24); // handle
        g.fillStyle(0x555b61, 1);
        g.fillRoundedRect(size * 0.36, size * 0.06, size * 0.28, size * 0.12, size * 0.03); // head
        break;
      case "car-wood":
        carBody(0x9c6b3f);
        g.fillStyle(0xdadada, 1);
        g.fillCircle(size * 0.5, size * 0.2, size * 0.14); // saw blade
        g.fillStyle(0x8a8a8a, 1);
        g.fillCircle(size * 0.5, size * 0.2, size * 0.05);
        break;
      default:
        tile(0xcccccc, 0x888888);
    }
    g.generateTexture(key, size, size);
    g.destroy();
  }

  private trimTexture(key: string) {
    const tex = this.textures.get(key);
    if (!tex || tex.key === "__MISSING" || tex.has("trim")) return;
    const src = tex.getSourceImage() as HTMLImageElement;
    const cw = src.width;
    const ch = src.height;
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(src, 0, 0);
    const data = ctx.getImageData(0, 0, cw, ch).data;
    const step = 3;
    let minX = cw;
    let minY = ch;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < ch; y += step) {
      for (let x = 0; x < cw; x += step) {
        if (data[(y * cw + x) * 4 + 3] > 12) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX <= minX || maxY <= minY) return;
    minX = Math.max(0, minX - step);
    minY = Math.max(0, minY - step);
    maxX = Math.min(cw - 1, maxX + step);
    maxY = Math.min(ch - 1, maxY + step);
    tex.add("trim", 0, minX, minY, maxX - minX, maxY - minY);
  }

  // ---- Chest rendering (a treasure chest) ----------------------------

  // A collector = a PRE-COLOURED car sprite picked by the chest's colour id (no
  // tint, so the baked outline / tyres / face stay crisp), with its seat count on
  // top. Auto-trimmed so any export size works. Rotated to follow the road.
  private makeChestView(chest: Chest, x: number, y: number): ChestView {
    const w = this.chestSize;
    const container = this.add.container(x, y).setDepth(DEPTH_CAR); // above the twin rope, below runners

    // Special cars use their own sprite; colour cars use the pre-coloured one.
    const key =
      chest.kind === "hammer" ? "car-hammer" : chest.kind === "wood" ? "car-wood" : `car-${chest.color}`;
    const hasTrim = this.textures.get(key).has("trim");
    const img = hasTrim ? this.add.image(0, 0, key, "trim") : this.add.image(0, 0, key);
    img.setScale((w * 1.15) / (img.height || w)); // car height ≈ collector size
    const carW = img.displayWidth;
    const carH = img.displayHeight;

    // Centered on the car body (y=0) so it stays put no matter how the car sprite
    // rotates — an offset looked fine facing up but drifted off the body once the
    // car turned to drive horizontally along the line.
    const countText = this.add
      .text(0, 0, String(chest.count), {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: `${Math.round(w * 0.42)}px`,
        color: TEXT_LIGHT,
        stroke: "#00000099",
        strokeThickness: 5,
      })
      .setOrigin(0.5);

    const hit = this.add
      .rectangle(0, 0, carW, carH, 0xffffff, 0.001)
      .setInteractive({ useHandCursor: true });

    container.add([img, countText, hit]);

    // Placeholder special cars get a readable tag above them so hammer vs wood is
    // obvious (removed automatically once real art replaces the texture).
    if ((chest.kind === "hammer" || chest.kind === "wood") && this.missingArt.has(key)) {
      const tag = chest.kind === "hammer" ? "HAMMER" : "WOOD";
      const t = this.add
        .text(0, -carH * 0.52, tag, {
          fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: `${Math.round(w * 0.2)}px`,
          color: "#ffffff", stroke: "#000000", strokeThickness: 3,
        })
        .setOrigin(0.5);
      container.add(t);
    }

    container.setData("hit", hit);
    const view: ChestView = { chest, container, countText, carImg: img, inFlight: 0 };

    // BURIED car ("xe chôn"): its REAL colour still shows but WASHED-OUT toward a soft
    // pale blue (user 2026-07-25: "vẫn hiển thị màu mờ… mặc định màu xanh nhẹ đi"), with
    // a bold "?" over it — so you get a faint hue hint but the exact colour + seat count
    // stay a mystery until it reaches the front of its column (see revealBuried).
    if (chest.buried) {
      img.setTintFill(BURIED_TINT); // solid light-blue silhouette — real colour fully hidden
                                    // (returns only on reveal: reaches column front, or tapped)
      countText.setVisible(false);
      const q = this.add
        .text(0, 0, "?", {
          fontFamily: "Arial, sans-serif",
          fontStyle: "bold",
          fontSize: `${Math.round(w * 0.62)}px`,
          color: "#ffffff",
          stroke: "#2a3550",
          strokeThickness: Math.max(3, Math.round(w * 0.11)),
        })
        .setOrigin(0.5);
      container.add(q);
      view.qMark = q;
    }
    return view;
  }

  // Flip a buried car face-up (called when it reaches the front of its column, or
  // as a safety right before it enters the track). Small pop so the reveal reads.
  private revealBuried(view: ChestView) {
    if (!view.chest.buried) return;
    view.chest.buried = false;
    view.carImg.clearTint();
    view.carImg.setAlpha(1); // undo the ghost — full real colour on reveal
    view.countText.setVisible(true);
    view.qMark?.destroy();
    view.qMark = undefined;
    this.tweens.add({
      targets: view.container,
      scaleX: { from: 1.18, to: 1 },
      scaleY: { from: 1.18, to: 1 },
      duration: 170,
      ease: "Back.out",
    });
  }

  // ---- Launching ------------------------------------------------------

  private findInInventory(view: ChestView): { col: ChestView[]; r: number } | null {
    for (const col of this.invColumns) {
      const r = col.indexOf(view);
      if (r >= 0) return { col, r };
    }
    return null;
  }

  private launchFromInventory(view: ChestView) {
    if (this.won || this.handMode || this.magnetMode) return; // a booster claims this tap
    const pos = this.findInInventory(view);
    if (!pos || pos.r !== 0) return; // only the front chest of a column launches

    // Linked cars leave together. A member is launchable when NO non-member sits ahead
    // of it in its column — so a same-column STACKED pair (rows 0,1) launches as one unit
    // (its rope stays a clean short vertical link even buried deep, user 2026-07-27), while
    // a member with a stranger in front still waits for that column to drain.
    const group = this.groupOf(view);
    for (const v of group) {
      const p = this.findInInventory(v);
      if (!p || !p.col.slice(0, p.r).every((c) => group.includes(c))) {
        this.smallNotice(group.length > 2 ? "Wait for all linked cars to reach the front!" : "Wait for both cars to reach the front!");
        return;
      }
    }

    // SLAM: a queue tap plays a TWO-HOP launch — the car hops up into a free waiting slot
    // (claiming it), then springs from the slot onto the ray. The slot stays RESERVED
    // (shown as "a car parked there") until the car fills & leaves; it returns there if it
    // can't fill. Needs a free slot AND room on the ray.
    if (this.slamMode) {
      const need = group.length;
      const freeSlots = this.slots.reduce((n, s) => n + (s ? 0 : 1), 0);
      if (freeSlots < need) { this.smallNotice("All waiting slots are locked!"); return; }
      if (this.active.length + this.pending.length + need > MAX_ON_TRACK) { this.trackFullNotice(); return; }
      this.playPop();
      // TELEMETRY: a queue tap is the player's core DECISION — log it with context (streamed live).
      const launchEv = { ev: "launch", t: Math.round((typeof performance !== "undefined" ? performance.now() : 0) - this.playStart), colors: group.map((v) => v.chest.color), counts: group.map((v) => v.chest.count), buried: group.some((v) => !!(v.chest as unknown as { buried?: boolean }).buried), freeSlotsBefore: freeSlots, onRay: this.active.length + this.pending.length, twin: group.length > 1 };
      this.playLog.push(launchEv);
      this.postLog(launchEv);
      for (const v of group) {
        const p = this.findInInventory(v)!;
        p.col.splice(p.r, 1);
        (v.container.getData("hit") as Phaser.GameObjects.Rectangle).disableInteractive();
        v.container.clearMask();
        this.revealBuried(v);
        const si = this.slots.findIndex((s) => s === null);
        this.parkIntoSlot(v, si); // HOP 1: queue → waiting slot (claims slots[si] = v)
        // HOP 2: once it's up in the slot, spring it onto the ray (slot stays reserved/locked).
        this.time.delayedCall(340, () => {
          if (this.won || this.lost) return;
          const parked = this.slots[si] === v && !this.pending.includes(v) && !this.active.some((a) => a.view === v);
          if (parked) this.relaunchFromSlot(si, true); // auto hop-2 of the queue launch — not a player bay tap (telemetry)
        });
      }
      this.notePeak();
      this.layoutInventory(true);
      this.updateSlotWarning();
      return;
    }

    // TRAY mode: a queue tap STAGES the car(s) into the waiting bays (fill 1→5), never
    // straight to the ray — the bay then auto-launches them when their colour is reachable
    // (see autoRelaunchBays). Needs a free bay per member; a group needs that many.
    if (this.trayMode) {
      if (TRAY_BATCH && this.batchRunning) { this.smallNotice("Wait — the batch is out collecting!"); return; } // bays locked mid-run
      const freeBays = this.slots.reduce((n, s) => n + (s ? 0 : 1), 0);
      if (freeBays < group.length) { this.trackFullNotice(); return; }
      this.playPop();
      group.forEach((v) => {
        const p = this.findInInventory(v)!;
        p.col.splice(p.r, 1);
        const hit = v.container.getData("hit") as Phaser.GameObjects.Rectangle;
        hit.disableInteractive();
        v.container.clearMask();
        this.revealBuried(v); // it's committed to a bay → flip any "?" face-up
        // Stage into the FIRST EMPTY bay (parkIntoSlot marks it occupied), NOT a left-packed
        // count — after a batch, emptied cars leave GAPS, so counting occupied bays could aim
        // a new car straight onto one that's already parked (user bug: all cars piled onto
        // the "20" bay). findIndex always lands each car in a genuinely free slot.
        const si = this.slots.findIndex((s) => s === null);
        if (si >= 0) this.parkIntoSlot(v, si);
      });
      this.layoutInventory(true);
      this.updateSlotWarning();
      return;
    }

    // Road must have room for the whole group (a triple needs 3 free slots, etc.).
    if (this.active.length + this.pending.length + group.length > MAX_ON_TRACK) {
      this.trackFullNotice();
      return;
    }

    this.playPop(); // same cheerful "pop" as sending a car out of a waiting bay
    for (const v of group) {
      const p = this.findInInventory(v)!;
      p.col.splice(p.r, 1); // r === 0 → front of its column
      const hit = v.container.getData("hit") as Phaser.GameObjects.Rectangle;
      hit.disableInteractive();
      v.container.clearMask(); // leaving the inventory viewport
      this.pending.push(v);
    }
    this.layoutInventory(true); // the chests below slide straight up
    if (this.tutStep === 1) {
      this.clearTutHint(); // step 1 done; wait for a car to park, then guide step 2
      this.tutStep = 2;
    } else if (this.tutStep === 8) {
      this.clearTutHint(); // twin intro done — player sent the pair off
      this.tutStep = 0;
    }
  }

  private relaunchFromSlot(slotIndex: number, auto = false) {
    if (this.won || this.handMode || this.magnetMode) return; // a booster claims this tap
    if (this.trayMode && !auto && !this.slamMode) return; // one-way bays: no manual relaunch (auto-fire only). SLAM: tapping a bay IS the launch.
    const view = this.slots[slotIndex];
    if (!view) return;
    this.disarmBay(view); // clear any "about to hop" bob before it actually launches
    // Linked cars relaunch together (all are parked side by side). Only the members
    // still parked in bays join — any that already left are skipped.
    const group = this.groupOf(view).filter((m) => this.slots.includes(m));
    if (this.active.length + this.pending.length + group.length > MAX_ON_TRACK) {
      this.trackFullNotice();
      return;
    }
    this.playPop(); // cheerful "pop" as the car springs out of its bay
    if (!auto) this.postLog({ ev: "bayTap", colors: group.map((m) => m.chest.color), counts: group.map((m) => m.chest.count), slot: slotIndex }); // slam: tapping a bay is the player's 2nd decision type
    for (const v of group) {
      const si = this.slots.indexOf(v);
      // TRAY mode: the car darts out to collect but its bay stays RESERVED (slots[si]
      // keeps pointing at it) so it returns to the SAME slot — matching the bot's
      // "collect from the bay, leave only when empty" model. Classic mode frees the slot.
      if (this.trayMode) { if (si >= 0) v.traySlot = si; }
      else if (si >= 0) this.slots[si] = null;
      (v.container.getData("hit") as Phaser.GameObjects.Rectangle).disableInteractive();
      // No in-place hop / hold: it goes straight to the ray. trySpawn glides it out
      // next frame — the glide itself IS the motion, so it feels immediate & smooth.
      this.pending.push(v);
    }
    if (this.tutStep === 3) {
      this.clearTutHint(); // tutorial complete
      this.tutStep = 0;
    }

    this.updateSlotWarning(); // a bay just freed → clear the full-queue warning
  }

  // TRAY_BATCH: launch the WHOLE batch — every car currently sitting in a bay darts out
  // onto the ray at once. Each keeps its bay RESERVED (traySlot) so a still-blocked car
  // returns to the same slot; emptied cars leave. The bays lock (batchRunning) until the
  // last batch car is off the ray. The squad chains laps while any member can still eat
  // (see canKeepCircling). GO is the only launch trigger in this mode — no auto-fire.
  private launchBatch() {
    if (!this.trayMode || !TRAY_BATCH) return;
    if (this.won || this.lost || this.handMode || this.magnetMode || this.tutPaused) return;
    if (this.batchRunning) return;
    const cars: ChestView[] = [];
    for (let i = 0; i < this.slots.length; i++) {
      const v = this.slots[i];
      if (v) cars.push(v);
    }
    if (cars.length === 0) return;
    this.playPop();
    this.batchRunning = true;
    for (let i = 0; i < this.slots.length; i++) {
      const v = this.slots[i];
      if (!v) continue;
      v.traySlot = i; // reserve this bay — the car returns here if still blocked
      this.disarmBay(v); // clear any leftover telegraph
      (v.container.getData("hit") as Phaser.GameObjects.Rectangle).disableInteractive();
      this.pending.push(v); // trySpawn glides it onto the ray next frames
    }
    this.batchLastProgress = this.time.now; // start the stale-timer
    this.updateGoButton();
    if (this.tutStep === 3) { this.clearTutHint(); this.tutStep = 0; }
  }

  // Synthesize a short "pop" via Web Audio (no audio asset needed).
  private playPop() {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      if (!this.audioCtx) this.audioCtx = new Ctx();
      const ctx = this.audioCtx;
      if (ctx.state === "suspended") void ctx.resume();
      const t0 = ctx.currentTime;
      // Body: a bright bubbly "pop" that springs UPWARD in pitch (matches the car
      // hopping up out of its bay), quick attack + short decay.
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(320, t0);
      osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.05);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.34, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.15);
      // Sparkle: a tiny high "ting" on top for crispness.
      const ping = ctx.createOscillator();
      const pg = ctx.createGain();
      ping.type = "triangle";
      ping.frequency.setValueAtTime(1500, t0 + 0.015);
      pg.gain.setValueAtTime(0.0001, t0 + 0.015);
      pg.gain.exponentialRampToValueAtTime(0.12, t0 + 0.025);
      pg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
      ping.connect(pg).connect(ctx.destination);
      ping.start(t0 + 0.015);
      ping.stop(t0 + 0.1);
    } catch {
      /* audio unavailable — ignore */
    }
  }

  // TRAY_BATCH: the whole batch (every bay car) must be able to roll out together, so the
  // ray cap rises to the bay count when the "Add" booster has grown it past 5 — otherwise a
  // 6th staged car would sit stuck in its bay waiting for a seat (looked like "the last car
  // launches much later"). Classic play keeps the hard 5-car cap.
  private onTrackCap(): number {
    return this.trayMode && TRAY_BATCH ? Math.max(MAX_ON_TRACK, this.slotCount) : MAX_ON_TRACK;
  }

  private trySpawn() {
    if (this.pending.length === 0) return;
    if (this.active.length >= this.onTrackCap()) return; // ray cap (5, or the bay count in batch mode)
    const head = this.pending[0];
    if (head.launchAt && this.time.now < head.launchAt) return; // still doing its launch hop
    const N = this.track.length;
    // SLAM: a car enters the ray at the node in line with the BAY it came from (directly
    // above its slot), not at the fixed Start — so it "rises straight up" from its slot.
    const start = (this.slamMode && !head.group && head.traySlot != null && this.slotXs[head.traySlot] != null)
      ? this.bayEntryNode(this.slotXs[head.traySlot]) : this.startIndex;

    // Linked cars roll onto the ray TOGETHER, spaced a few nodes apart, co-spawned in
    // one go (same glide duration) so none drifts ahead while a partner is still
    // gliding. The group's members sit contiguously at the front of the queue.
    let count = 1;
    if (head.group) {
      count = 0;
      for (const p of this.pending) {
        if (head.group.includes(p)) count++;
        else break;
      }
    }
    if (this.active.length + count > this.onTrackCap()) return;

    // Target node for each member: member 0 leads (furthest along); the rest trail by
    // TWIN_SPAWN_GAP each. So a group occupies startIndex .. startIndex+(count-1)*GAP.
    const posFor = (k: number) => {
      const raw = start + (count - 1 - k) * TWIN_SPAWN_GAP;
      return this.openTrack ? Math.min(raw, N - 1) : raw % N;
    };

    // Only roll on once EVERY node the group will occupy is clear of the cars already
    // circling. (Checking just the start node let a group's trailing members — 5 and 10
    // nodes back for a triple — spawn on top of a car sitting there, so linked cars
    // overlapped/hid others the moment they launched.)
    const clear = this.active.every((a) => {
      for (let k = 0; k < count; k++) {
        const d = (((a.pos - posFor(k)) % N) + N) % N;
        if (Math.min(d, N - d) < MIN_GAP) return false;
      }
      return true;
    });
    if (!clear) return;

    const members = this.pending.splice(0, count);
    if (count > 1) {
      let maxD = 0;
      members.forEach((m, k) => {
        const pos = posFor(k);
        maxD = Math.max(maxD, Phaser.Math.Distance.Between(m.container.x, m.container.y, this.lerpX(pos), this.lerpY(pos)));
      });
      const dur = Phaser.Math.Clamp(maxD * 0.8, 140, 260); // snappier group roll-on (user 2026-07-25: lên ray hơi chậm)
      members.forEach((m, k) => this.spawnCar(m, posFor(k), dur));
    } else {
      this.spawnCar(members[0], start);
    }
  }

  // SLAM: the track node closest to a bay's x-position, on the BOTTOM rail — a car
  // launched from that bay rises straight onto the ray here (and returns here).
  private bayEntryNode(slotX: number): number {
    let best = this.startIndex, bd = Infinity;
    for (let i = 0; i < this.track.length; i++) {
      const dx = this.track[i].x - slotX;
      const dy = this.track[i].y - this.beltBottom;
      const d = dx * dx + dy * dy * 4; // weight y so a bottom-edge node wins
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // Push one car onto the ray at `pos`, gliding it there from wherever it sits (a
  // waiting bay / the lineup) and growing it back to full size — instead of a
  // teleport. It only starts DRIVING once the glide finishes (entering → false).
  private spawnCar(view: ChestView, pos: number, dur?: number) {
    view.launchAt = undefined;
    this.revealBuried(view); // safety: a booster can pull a still-buried back car onto the track
    this.tweens.killTweensOf(view.container); // stop any lingering launch hop
    view.container.clearMask(); // leaving the inventory viewport (Grab can pull a masked back car)
    const tx = this.lerpX(pos);
    const ty = this.lerpY(pos);
    const a: ActiveChest = {
      view,
      pos,
      lastNode: Math.floor(pos),
      steps: 0,
      lastShot: 0,
      approaching: true, // drive in fast until the first slime is grabbed
      entering: true, // glide onto the ray first, then start driving
    };
    this.active.push(a);
    const dist = Phaser.Math.Distance.Between(view.container.x, view.container.y, tx, ty);
    this.tweens.add({
      targets: view.container,
      x: tx,
      y: ty,
      scale: 1,
      alpha: 1, // back-row lineup cars are dimmed — fade back to full on the way in
      duration: dur ?? Phaser.Math.Clamp(dist * 0.8, 120, 220), // ~35% faster (user 2026-07-25: lên ray hơi chậm)
      ease: "Cubic.out", // springs out fast from the bay, then eases in — feels instant
      onComplete: () => {
        a.entering = false; // hand off to the driving system
      },
    });
  }

  // ---- Main loop ------------------------------------------------------

  update(time: number, delta: number) {
    const dt = delta / 1000;
    this.animateBelt(dt); // the Line belt runs continuously
    this.drawTwinLinks(); // holding-hands link between twin cars
    if (this.won || this.lost) return;
    if (this.tutPaused) return; // frozen while a tutorial is guiding the player
    const N = this.track.length;
    if (N === 0) return;

    if (AUTO_CIRCLE || this.trayMode || this.slamMode) this.computeReachableColors(); // which colours can be shot right now
    this.updateGuide(); // step-guide pointer (no-op unless the setting is ON)
    this.trySpawn();
    this.autoRelaunchBays(); // parked cars self-relaunch when their colour is reachable again
    if (this.trayMode && TRAY_BATCH) { this.endBatchStaleCheck(time); this.endBatchIfDone(); this.updateGoButton(); }
    if (this.trayMode) this.checkTrayStuck(); // one-way bays: all 5 blocked & idle → lose
    if (this.slamMode) this.updateSlotLocks(); // show 🔒 on bays whose car is out on the ray

    // Live "cars on the ray" count on the start signal.
    if (this.signalCount) this.signalCount.setText(`${this.active.length}/${this.onTrackCap()}`);

    // Endgame speed-up: once the queue (zone 3) is empty, the in-play cars PICK
    // faster — a shorter cooldown PLUS grabbing every matching slime in sight each
    // tick — while their DRIVE speed stays exactly the same.
    const boost = this.queueEmpty();

    const groupStepped = new Set<ActiveChest>();
    for (const a of [...this.active]) {
      if (!this.active.includes(a)) continue; // pulled off by a group partner this frame
      if (groupStepped.has(a)) continue; // already advanced as part of a group this frame
      if (a.entering) continue; // still gliding onto the ray (tween-driven), not driving yet
      // Route done but slimes are still running to it (anywhere in the group): keep
      // DRIVING a bit further so they board on the ray (not chase it into a bay). Park
      // the moment the WHOLE group's runners are aboard.
      if (a.finishing && this.groupInFlight(a.view) <= 0) {
        this.parkChest(a);
        continue;
      }
      // Finished its route and holding-to-park: stay still until the group's last
      // runners board, THEN pull into a bay — so runners never chase it into the bay.
      if (a.parkPending) {
        if (this.groupInFlight(a.view) <= 0) this.parkChest(a);
        continue;
      }

      // Linked cars move as ONE rigid unit: every drivable member advances by the
      // SMALLEST allowed step, so spacing stays exactly constant and they travel at
      // identical speed (no catch-up wobble, no overlap). Works for 2, 3, … members.
      const mates = a.view.group
        ? this.active.filter((x) => a.view.group!.includes(x.view) && !x.parkPending && !x.entering)
        : [a];

      if (mates.length > 1) {
        let adv = Infinity;
        for (const m of mates) adv = Math.min(adv, this.freeAdvance(m, dt, boost));
        for (const m of mates) {
          if (!this.active.includes(m)) continue; // a partner parked the whole group already
          const parked = this.stepCar(m, adv, dt, boost);
          groupStepped.add(m);
          if (!parked && !m.finishing) this.tryShoot(m, time, boost);
        }
      } else {
        const parked = this.stepCar(a, this.freeAdvance(a, dt, boost), dt, boost);
        if (!parked && !a.finishing) this.tryShoot(a, time, boost); // finishing → just let last runners board
      }
    }

    this.updateRunners(dt);
  }

  // How far this car may advance this frame: a single uniform speed for EVERY car
  // (no "fresh car dashes in faster" — that read as jittery/uneven), clamped so it
  // never comes within MIN_GAP of another car. Same-group members are excluded — a
  // linked group's shared step is decided by the caller.
  private freeAdvance(a: ActiveChest, dt: number, boost: boolean): number {
    const N = this.track.length;
    const mates = a.view.group;
    let gapAhead = N;
    for (const b of this.active) {
      if (b === a) continue;
      if (mates && mates.includes(b.view)) continue; // group moves together, don't self-block
      const d = (((b.pos - a.pos) % N) + N) % N;
      if (d > 0 && d < gapAhead) gapAhead = d;
    }
    let adv = SPEED * (boost ? 2 : 1) * dt; // endgame (queue empty) → drive 2× faster too
    if (gapAhead - adv < MIN_GAP) adv = Math.max(0, gapAhead - MIN_GAP);
    return adv;
  }

  // Advance a car by `adv` nodes and steer its sprite. Handles reaching the end of an
  // open route / completing a ring lap → park (or hold for last runners). Returns true
  // if the car left the ray this frame (or is now holding to park) → skip its shooting.
  private stepCar(a: ActiveChest, adv: number, dt: number, boost: boolean): boolean {
    const N = this.track.length;
    if (adv <= 0) return false;
    if (this.openTrack) {
      // One-way line/U/arch: advance WITHOUT wrapping (no ring modulo) so the car
      // never teleports from the end back to the start.
      a.pos = Math.min(a.pos + adv, N - 1);
      while (a.lastNode < Math.floor(a.pos)) {
        a.lastNode++;
        a.steps++;
      }
      if (a.pos >= N - 1) {
        // Endgame (no cars left in the lineup) OR still-collectable (AUTO_CIRCLE): DON'T
        // retire to a bay — loop back to the entrance and keep hunting slimes.
        if (boost || this.canKeepCircling(a)) {
          a.pos = this.startIndex;
          a.lastNode = this.startIndex;
          a.steps = 0;
          a.view.container.setPosition(this.lerpX(a.pos), this.lerpY(a.pos));
          this.steerCar(a, dt);
          return false;
        }
        const end = this.track[N - 1];
        a.view.container.setPosition(end.x, end.y);
        this.steerCar(a, dt);
        if (this.groupInFlight(a.view) > 0) {
          a.parkPending = true;
          a.view.waiting = true; // last runners rush in
        } else this.parkChest(a);
        return true;
      }
      a.view.container.setPosition(this.lerpX(a.pos), this.lerpY(a.pos));
      this.steerCar(a, dt);
      return false;
    }
    a.pos = (a.pos + adv) % N;
    let guard = 0;
    while (a.lastNode !== Math.floor(a.pos) && guard++ < N) {
      a.lastNode = (a.lastNode + 1) % N;
      a.steps++;
      if (a.steps >= N) {
        // Completed a full loop without emptying. Endgame (lineup empty) OR still able
        // to collect more of its colour (AUTO_CIRCLE): keep looping instead of parking.
        if (boost || this.canKeepCircling(a)) {
          a.steps = 0;
          continue;
        }
        // Still have slimes running to it: DON'T stop — drive a bit further (up to one
        // more lap) so they board on the ray, then park (handled in the main loop the
        // moment inFlight hits 0). Only if that extra lap also elapses do we hold/park.
        if (this.groupInFlight(a.view) > 0 && !a.finishing) {
          a.finishing = true;
          a.view.waiting = true; // last runners rush in
          a.steps = 0;
          continue; // keep driving this frame
        }
        if (this.groupInFlight(a.view) > 0) {
          a.parkPending = true;
          a.view.waiting = true;
        } else this.parkChest(a);
        return true;
      }
    }
    a.view.container.setPosition(this.lerpX(a.pos), this.lerpY(a.pos));
    this.steerCar(a, dt);
    return false;
  }

  // Fire at same-colour targets in the car's line of sight, gated by the shot cooldown.
  private tryShoot(a: ActiveChest, time: number, boost: boolean) {
    const cooldown = boost ? SHOT_COOLDOWN / 3 : SHOT_COOLDOWN;
    if (time - a.lastShot < cooldown) return;
    let openSeats = a.view.chest.count - a.view.inFlight;
    if (openSeats <= 0) return;
    // Normal: grab up to TWO nearest slimes in sight per tick (snappier collecting, user
    // 2026-07-29). Boosted (queue empty): grab EVERY matching slime in the 3 lines of sight.
    const targets = this.findLosTargets(a);
    const take = boost ? targets.length : Math.min(2, targets.length);
    let fired = false;
    for (let k = 0; k < take && openSeats > 0; k++) {
      const idx = targets[k];
      if (!this.keys[idx]) continue; // already cleared this tick (e.g. same 2×2 unit)
      // In-place effects (no runner): soft rock cracks/shatters, wood pops.
      const code = this.level.board[idx];
      const kind = isObstacle(code) ? obstacleKind(code) : null;
      if (kind === "soft") this.hitSoftRock(a, idx);
      else if (kind === "wood") this.collectWood(a, idx);
      else this.fire(a, idx);
      openSeats--;
      fired = true;
    }
    if (fired) {
      a.lastShot = time;
      a.approaching = false; // first slime grabbed → back to normal drive speed
      if (this.batchRunning) this.batchLastProgress = time; // batch made progress → reset the stale-timer
    }
  }

  // True when the lineup queue (zone 3) has no cars left to launch — i.e. nothing
  // more will be pushed up. Used to speed up pickups for the in-play cars.
  private queueEmpty(): boolean {
    return !this.invColumns.some((col) => col.some((v) => v.container.scene));
  }

  // ---- Linked-car group helpers (twin = 2, triple = 3, …) -------------
  // All cars linked with `view`, in order; a solo car → just [view].
  private groupOf(view: ChestView): ChestView[] {
    return view.group ?? [view];
  }
  // Group members still in play (haven't driven off).
  private liveGroup(view: ChestView): ChestView[] {
    return this.groupOf(view).filter((m) => !m.left);
  }
  private isGrouped(view: ChestView): boolean {
    return !!view.group && view.group.length > 1;
  }
  // Total in-flight runners across the whole group — so a group never parks/leaves
  // while ANY member's critters are still running in.
  private groupInFlight(view: ChestView): number {
    return this.groupOf(view).reduce((n, m) => n + (m.left ? 0 : m.inFlight), 0);
  }

  // ---- Auto-drive helpers (AUTO_CIRCLE) -------------------------------
  // Colours that have at least one slime CURRENTLY REACHABLE — i.e. the first
  // occupied cell scanning inward from an edge (left/right/top/bottom) is a slime of
  // that colour, so a car of that colour can actually shoot it (blocked-behind slimes
  // don't count). Recomputed each frame in update(). This is the key signal: a car
  // keeps circling only while its colour is reachable, and parks (freeing the slot)
  // when it isn't — so blocked cars never hog the ray and deadlock the board.
  private reachableColors = new Set<number>();
  private computeReachableColors() {
    this.reachableColors.clear();
    const cols = this.level.cols, rows = this.level.rows;
    const board = this.level.board;
    const addHit = (hit: { idx: number; steps: number } | null) => {
      if (!hit) return;
      if (this.hiddenSet.has(hit.idx)) return; // a "?" slime isn't collectable yet
      const code = board[hit.idx];
      if (code >= 0 && code < HARD_ROCK) this.reachableColors.add(code); // exposed slime
    };
    // Cast the SAME 3 rays the car shoots (straight + two 45° diagonals) from every
    // lane of every edge the track actually runs along — so this matches real LOS
    // exactly (diagonals count), and edges the car never drives (e.g. a U's top) don't.
    const k = this.trackKind;
    const useBottom = k !== "arch"; // line / u / square / rect drive the bottom
    const useTop = k === "arch" || k === "square" || k === "rect";
    const useLeft = k === "u" || k === "arch" || k === "square" || k === "rect";
    const useRight = useLeft;
    for (let sc = 0; sc < cols; sc++) {
      if (useBottom) {
        addHit(this.rayHit(rows - 1, sc, -1, 0));
        addHit(this.rayHit(rows - 1, sc - 1, -1, -1));
        addHit(this.rayHit(rows - 1, sc + 1, -1, 1));
      }
      if (useTop) {
        addHit(this.rayHit(0, sc, 1, 0));
        addHit(this.rayHit(0, sc - 1, 1, -1));
        addHit(this.rayHit(0, sc + 1, 1, 1));
      }
    }
    for (let sr = 0; sr < rows; sr++) {
      if (useLeft) {
        addHit(this.rayHit(sr, 0, 0, 1));
        addHit(this.rayHit(sr - 1, 0, -1, 1));
        addHit(this.rayHit(sr + 1, 0, 1, 1));
      }
      if (useRight) {
        addHit(this.rayHit(sr, cols - 1, 0, -1));
        addHit(this.rayHit(sr - 1, cols - 1, -1, -1));
        addHit(this.rayHit(sr + 1, cols - 1, 1, -1));
      }
    }
  }

  // Can THIS one car still grab something right now: a normal colour car with an open
  // seat whose colour is currently reachable. (Obstacle cars are excluded from auto.)
  private carCanCollect(v: ChestView): boolean {
    if ((v.chest.kind ?? "color") !== "color") return false;
    if (v.chest.count - v.inFlight <= 0) return false; // no free seat to fill
    return this.reachableColors.has(v.chest.color);
  }

  // A car keeps circling (instead of parking) while it can still collect. Linked cars
  // move as ONE unit, so the whole group keeps going if ANY member can still collect.
  private canKeepCircling(a: ActiveChest): boolean {
    // TRAY_BATCH: the batch circles as ONE squad — NO member ever parks on its own at a
    // lap-end (an instantaneous "nothing reachable right now" is a transient: a teammate
    // mid-travel or a colour not yet peeled to the edge). The squad keeps looping until the
    // batch is genuinely stale (no collection by ANY member for a grace window) and then
    // ALL members park together (endBatchStaleCheck). So here: keep circling while running.
    // SLAM (user 2026-07-29/30): a car out on the ray KEEPS circling while it can still collect its
    // colour, instead of returning to its bay after one lap — only retires to the bay when nothing
    // is left to grab. Its bay stays reserved throughout (slam never auto-relaunches from bays).
    // ⚠ MUST be checked BEFORE the tray-batch branch: slam sets trayMode=true, so the old order
    // short-circuited to `batchRunning` (always false in slam) and cars never kept circling.
    if (this.slamMode) return this.liveGroup(a.view).some((m) => this.carCanCollect(m));
    if (this.trayMode && TRAY_BATCH) return this.batchRunning;
    if (!AUTO_CIRCLE) return false;
    return this.liveGroup(a.view).some((m) => this.carCanCollect(m));
  }

  // A parked bay car "wants out" when it has a seat, its colour is reachable again (an
  // outer ring was peeled), and no other active/pending car of that colour is already
  // handling it.
  private bayMemberWantsOut(c: ChestView): boolean {
    if (!this.carCanCollect(c)) return false;
    const color = c.chest.color;
    const sameColour = (x: ChestView) => x.chest.color === color && (x.chest.kind ?? "color") === "color";
    const busy =
      this.active.some((a) => sameColour(a.view) && a.view.chest.count > 0) ||
      this.pending.some((p) => sameColour(p) && p.chest.count > 0);
    return !busy;
  }

  // Mechanic 2: a parked car (or linked group) hops back onto the ray by itself when it
  // can collect again. Track cap (5) still applies — a triple needs 3 free slots, etc.
  // The car doesn't jump out instantly: it first BOBS in place for a beat (armBay) so
  // the player can SEE it's about to relaunch, then it launches (see the telegraph const).
  private autoRelaunchBays() {
    if (this.slamMode) return; // SLAM: bay cars launch ONLY when the player taps them, never auto
    if (this.trayMode && TRAY_BATCH) return; // batch tray: cars fire only via the GO button, never auto
    if (!AUTO_CIRCLE && !this.trayMode) return;
    if (this.tutStep > 0 || this.handMode || this.magnetMode) {
      this.disarmAllBays(); // tutorial/booster takes over — don't leave a car bobbing
      return;
    }

    // Pass 1: cancel the telegraph on any armed car that lost its work (e.g. another
    // car of that colour grabbed the slimes first) — it should stop bobbing.
    for (const v of this.slots) {
      if (!v || v.armAt === undefined) continue;
      if (!this.liveGroup(v).some((c) => this.bayMemberWantsOut(c))) this.disarmBay(v);
    }

    // Pass 2: arm the first eligible bay, or launch it once it's bobbed long enough.
    for (let i = 0; i < this.slots.length; i++) {
      const v = this.slots[i];
      if (!v) continue;
      // TRAY: a reserved bay still points at its car while that car is darting out on the
      // ray — don't try to re-launch a car that's already flying.
      if (this.trayMode && (this.active.some((a) => a.view === v) || this.pending.includes(v))) continue;
      if ((v.chest.kind ?? "color") !== "color") continue;
      // A linked group relaunches together. If a live member isn't also parked, leave
      // the group alone (don't split it) — let manual control handle that odd state.
      const live = this.liveGroup(v);
      if (live.some((m) => !this.slots.includes(m))) continue;
      if (this.active.length + this.pending.length + live.length > MAX_ON_TRACK) continue; // no room
      // relaunch if ANY member wants out (for a group, one member with work is enough)
      if (!live.some((c) => this.bayMemberWantsOut(c))) continue;

      if (v.armAt === undefined) {
        this.armBay(v); // start the "I'm about to hop out" bob
        return; // one bay per frame — next frames drive the timer / other bays
      }
      if (this.time.now - v.armAt < AUTO_RELAUNCH_TELEGRAPH_MS) return; // still bobbing
      this.disarmBay(v);
      this.relaunchFromSlot(i, true); // auto — handles the whole group itself
      return;
    }
  }

  // TRAY_BATCH: end the run when the squad is STALE — no member has collected anything for
  // BATCH_END_GRACE (so no more peeling is happening; the batch can't progress). Park every
  // still-circling car back to its reserved bay TOGETHER (emptied ones already drove off),
  // so a blocked car never drops out of the squad mid-run on a transient dead frame.
  private endBatchStaleCheck(time: number) {
    if (!this.batchRunning) return;
    if (this.pending.length > 0) return; // squad still rolling onto the ray
    if (this.active.length === 0) return; // endBatchIfDone will close it out
    if (this.active.some((a) => a.entering)) return; // a member still gliding on
    if (this.active.some((a) => this.groupInFlight(a.view) > 0)) return; // runners still boarding
    if (time - this.batchLastProgress < BATCH_END_GRACE) return; // collected recently → keep going
    // Batch done: return the whole squad to the bays LEFT-PACKED (adjacent, no gaps) — the
    // emptied cars already drove off, so the still-blocked ones queue up neatly from slot 0
    // for the next GO (user: "khi batch về hàng đợi thì các xe xếp cạnh nhau"). Packing here
    // also means the bays never carry mid-row gaps, so staging can't collide onto a taken bay.
    const squad = this.active.map((a) => a.view);
    for (const a of [...this.active]) { this.removeActive(a); a.view.waiting = false; }
    for (let i = 0; i < this.slots.length; i++) this.slots[i] = null; // drop stale reservations
    squad.forEach((v, i) => { v.traySlot = i; this.parkIntoSlot(v, i); });
  }

  // TRAY_BATCH: the batch is finished once every one of its cars is off the ray — the
  // blocked ones have returned to their bays and the emptied ones have driven away. Flip
  // the lock off so the player can stage more and press GO again.
  private endBatchIfDone() {
    if (!this.batchRunning) return;
    if (this.active.length > 0 || this.pending.length > 0) return; // squad still moving
    this.batchRunning = false;
    this.updateSlotWarning();
    this.updateGoButton();
  }

  // ---- STEP GUIDE (user 2026-07-30) --------------------------------------------------
  // "Lấy kết quả của con bot thắng": from the CURRENT board/queue/bay state, fork-simulate each
  // candidate move with the greedy solver — recommend the first move that opens a WINNING line.
  // Falls back to the plain greedy priority when no simulated candidate wins (bot-unwinnable spots).

  // Snapshot of the live game reduced to solver form. Cell colours come from the still-alive key
  // sprites (this.keys) so collected cells read as empty; layer2 bottoms that are still hidden
  // under a top tile are carried so the sim reveals them exactly like the game does.
  private captureSimState() {
    const cols = this.level.cols, rows = this.level.rows;
    const occ = new Array(cols * rows).fill(-1);
    for (let i = 0; i < cols * rows; i++) {
      const k = this.keys[i];
      if (k && k.scene) occ[i] = this.level.board[i];
    }
    // level.board/layer2 are mutated in place as tops are eaten (board[i] becomes the revealed
    // bottom, layer2[i] flips to -1) — so board+layer2 already ARE the current truth.
    const lay = this.level.layer2 ? this.level.layer2.map((v, i) => (v >= 0 && this.keys[i] && this.keys[i]!.scene ? v : -1)) : null;
    const queue = this.invColumns.map((col) => col.filter((v) => v.container.scene).map((v) => ({ color: v.chest.color, cap: Math.max(0, v.chest.count - v.inFlight), pid: v.chest.pairId ?? null })));
    const parked = this.slots.map((v) => (v ? { color: v.chest.color, cap: Math.max(0, v.chest.count - v.inFlight), pid: v.chest.pairId ?? null } : null));
    return { cols, rows, occ, lay, queue, parked };
  }

  // Greedy playout from a solver-form state; returns true if it clears the board. Mirrors the
  // Node-side solvable() priority: productive bay car → productive queue front (groups whole) →
  // dig longest column → stuck=lose. Layer2-aware. Bounded steps.
  // Randomised bay-aware ROLLOUT from a solver-form state ("lấy kết quả của con bot thắng"):
  // play to the end with light random tie-breaking; return whether it WON and the FIRST move
  // it made. computeGuideTarget runs many seeds and advises the first move of a winning line.
  private simRollout(
    s: { cols: number; rows: number; occ: number[]; lay: number[] | null; queue: { color: number; cap: number; pid: number | null }[][]; parked: ({ color: number; cap: number; pid: number | null } | null)[] },
    seed: number,
    forceFirst?: string,
  ): { win: boolean; first: string | null } {
    const { cols, rows } = s;
    let x = (seed >>> 0) || 1;
    const rng = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 0xffffffff; };
    const occ = s.occ.slice();
    const lay = s.lay ? s.lay.slice() : null;
    const queue = s.queue.map((c) => c.map((m) => ({ ...m })));
    const parked: ({ color: number; cap: number; pid: number | null } | null)[] = s.parked.map((p) => (p ? { ...p } : null));
    const isC = (v: number) => v >= 0 && v < 90;
    let remaining = occ.reduce((a, v) => a + (isC(v) ? 1 : 0), 0) + (lay ? lay.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0) : 0);
    const clearCell = (i: number) => { if (lay && lay[i] >= 0) { occ[i] = lay[i]; lay[i] = -1; } else occ[i] = -1; remaining--; };
    const exposed = (): Set<number> => {
      const E = new Set<number>();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) { const i = r * cols + c; if (isC(occ[i])) { E.add(i); break; } }
        for (let c = cols - 1; c >= 0; c--) { const i = r * cols + c; if (isC(occ[i])) { E.add(i); break; } }
      }
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) { const i = r * cols + c; if (isC(occ[i])) { E.add(i); break; } }
        for (let r = rows - 1; r >= 0; r--) { const i = r * cols + c; if (isC(occ[i])) { E.add(i); break; } }
      }
      return E;
    };
    const collect = (car: { color: number; cap: number }) => {
      for (;;) {
        if (car.cap <= 0) return;
        const E = exposed();
        let t = -1;
        for (const i of E) if (occ[i] === car.color) { t = i; break; }
        if (t < 0) return;
        clearCell(t); car.cap--;
      }
    };
    let first: string | null = null;
    let guard = 0;
    while (remaining > 0 && guard++ < 500) {
      // every productive BAY car eats (loop — one reveal can open another)
      let any = true;
      while (any) {
        any = false;
        const E = exposed(); const S = new Set<number>(); for (const i of E) S.add(occ[i]);
        for (let i = 0; i < parked.length; i++) {
          const p = parked[i];
          if (p && p.cap > 0 && S.has(p.color)) {
            if (!first) first = "bay" + i;
            collect(p); if (p.cap === 0) parked[i] = null;
            any = true; break;
          }
        }
        if (forceFirst && !first) break; // a forced first move must be the queue move below
      }
      if (remaining === 0) break;
      const E = exposed(); const S = new Set<number>(); for (const i of E) S.add(occ[i]);
      const freeBays = parked.filter((p) => p === null).length;
      // queue candidates (groups whole, front-prefix)
      const fronts: { j: number; group: { color: number; cap: number; pid: number | null }[] }[] = [];
      for (let j = 0; j < queue.length; j++) {
        const f = queue[j][0]; if (!f) continue;
        if (f.pid == null) { fronts.push({ j, group: [f] }); continue; }
        const members: { color: number; cap: number; pid: number | null }[] = [];
        let okG = true;
        for (let jj = 0; jj < queue.length; jj++) for (let r = 0; r < queue[jj].length; r++) { const c = queue[jj][r]; if (c.pid === f.pid) { if (queue[jj].slice(0, r).some((m) => m.pid !== f.pid)) okG = false; members.push(c); } }
        if (okG && members.length >= 2) fronts.push({ j, group: members });
      }
      const seenPid = new Set<number>();
      const uniq = fronts.filter((f) => { const pid = f.group[0].pid; if (pid == null) return true; if (seenPid.has(pid)) return false; seenPid.add(pid); return true; });
      const fit = uniq.filter((f) => freeBays >= f.group.length);
      if (!fit.length) return { win: false, first };
      let pick: { j: number; group: { color: number; cap: number; pid: number | null }[] } | undefined;
      if (forceFirst && !first) {
        // honour the forced first move (either a bay tap handled by caller-prepared state, or q<j>)
        if (forceFirst.startsWith("q")) {
          const j = parseInt(forceFirst.slice(1), 10);
          pick = fit.find((f) => f.j === j);
          if (!pick) return { win: false, first: null }; // forced move not available
        }
      }
      if (!pick) {
        const prods = fit.filter((f) => f.group.some((m) => m.cap > 0 && S.has(m.color)));
        const digs = fit.filter((f) => !f.group.some((m) => m.cap > 0 && S.has(m.color)));
        const opts: { f: typeof fit[number]; w: number }[] = [];
        for (const f of prods) opts.push({ f, w: freeBays >= 2 ? 8 : 3 });
        for (const f of digs) opts.push({ f, w: (freeBays >= 2 ? 2 : 0.5) + (f.group.length === 1 ? queue[f.j].length / 10 : 0) });
        let sum = 0; for (const o of opts) sum += o.w;
        let r = rng() * sum; pick = opts[0].f;
        for (const o of opts) { r -= o.w; if (r <= 0) { pick = o.f; break; } }
      }
      if (!first) first = "q" + pick.j + ":" + pick.group[0].color;
      for (const m of pick.group) { for (const col of queue) { const k = col.indexOf(m); if (k >= 0) { col.splice(k, 1); break; } } }
      for (const m of pick.group) collect(m);
      for (const m of pick.group) if (m.cap > 0) { const slot = parked.indexOf(null); if (slot >= 0) parked[slot] = m; }
    }
    return { win: remaining === 0, first };
  }

  private computeGuideTarget(): { key: string; x: number; y: number } | null {
    if (!this.slamMode) return null;
    // only advise on a QUIET board (no cars mid-flight) — the sim snapshot is exact then
    if (this.active.length > 0 || this.pending.length > 0) return null;
    const freeSlots = this.slots.reduce((n, s) => n + (s ? 0 : 1), 0);
    const base = this.captureSimState();
    type Cand = { key: string; x: number; y: number };
    const cands: Cand[] = [];
    for (let i = 0; i < this.slots.length; i++) {
      const v = this.slots[i];
      if (!v || !this.carCanCollect(v)) continue;
      cands.push({ key: "bay" + i, x: v.container.x, y: v.container.y });
    }
    const seen = new Set<ChestView>();
    for (let j = 0; j < this.invColumns.length; j++) {
      const head = this.invColumns[j][0];
      if (!head || !head.container.scene || seen.has(head)) continue;
      const group = this.groupOf(head);
      group.forEach((m) => seen.add(m));
      let ok = true;
      for (const m of group) {
        const p = this.findInInventory(m);
        if (!p || !p.col.slice(0, p.r).every((c) => group.includes(c))) { ok = false; break; }
      }
      if (!ok || freeSlots < group.length || this.active.length + this.pending.length + group.length > MAX_ON_TRACK) continue;
      cands.push({ key: "q" + j + ":" + head.chest.color, x: head.container.x, y: head.container.y });
    }
    if (!cands.length) return null;
    // A bay tap is always "productive by definition" here (carCanCollect gated) — any winning
    // rollout that STARTS by eating from a bay will report first="bay<i>". Strategy:
    //  1. STICKY: if the previous advice is still a candidate, try a few rollouts honouring it.
    //  2. Run up to ~24 free rollouts; the first WINNING line's first move becomes the advice.
    //  3. No winner → fallback: previous advice if still valid, else first candidate.
    const prevKey = this.guideKey.replace(/^[WF]/, "");
    const prev = cands.find((c) => c.key === prevKey);
    const baySeed = (this.time.now | 0) ^ 0x9e3779b9;
    if (prev) {
      for (let t = 0; t < 6; t++) {
        const force = prev.key.startsWith("q") ? "q" + parseInt(prev.key.slice(1), 10) : undefined;
        const st = prev.key.startsWith("bay") ? this.applyBayFirst(base, parseInt(prev.key.slice(3), 10)) : base;
        const r = this.simRollout(st, baySeed + t * 101, force);
        if (r.win) return { key: "W" + prev.key, x: prev.x, y: prev.y };
      }
    }
    for (let t = 0; t < 24; t++) {
      const r = this.simRollout(base, baySeed + 7919 + t * 137);
      if (r.win && r.first) {
        const c = cands.find((cc) => cc.key === r.first || (r.first!.startsWith("q") && cc.key.startsWith("q" + r.first!.slice(1).split(":")[0] + ":")));
        if (c) return { key: "W" + c.key, x: c.x, y: c.y };
      }
    }
    if (prev) return { key: "F" + prev.key, x: prev.x, y: prev.y };
    const pick = cands[0];
    return { key: "F" + pick.key, x: pick.x, y: pick.y };
  }

  // Clone the state with bay car <i> having eaten everything it currently can (a forced bay-tap
  // first move for the sticky check).
  private applyBayFirst(st: ReturnType<GameScene["captureSimState"]>, i: number): ReturnType<GameScene["captureSimState"]> {
    const s2 = { ...st, occ: st.occ.slice(), lay: st.lay ? st.lay.slice() : null, queue: st.queue.map((c) => c.map((m) => ({ ...m }))), parked: st.parked.map((p) => (p ? { ...p } : null)) };
    const p = s2.parked[i];
    if (!p) return s2;
    const isC = (v: number) => v >= 0 && v < 90;
    const exposed = (): Set<number> => {
      const E = new Set<number>();
      for (let r = 0; r < s2.rows; r++) {
        for (let c = 0; c < s2.cols; c++) { const k = r * s2.cols + c; if (isC(s2.occ[k])) { E.add(k); break; } }
        for (let c = s2.cols - 1; c >= 0; c--) { const k = r * s2.cols + c; if (isC(s2.occ[k])) { E.add(k); break; } }
      }
      for (let c = 0; c < s2.cols; c++) {
        for (let r = 0; r < s2.rows; r++) { const k = r * s2.cols + c; if (isC(s2.occ[k])) { E.add(k); break; } }
        for (let r = s2.rows - 1; r >= 0; r--) { const k = r * s2.cols + c; if (isC(s2.occ[k])) { E.add(k); break; } }
      }
      return E;
    };
    for (;;) {
      if (p.cap <= 0) break;
      const E = exposed();
      let t = -1;
      for (const k of E) if (s2.occ[k] === p.color) { t = k; break; }
      if (t < 0) break;
      if (s2.lay && s2.lay[t] >= 0) { s2.occ[t] = s2.lay[t]; s2.lay[t] = -1; } else s2.occ[t] = -1;
      p.cap--;
    }
    if (p.cap === 0) s2.parked[i] = null;
    return s2;
  }
  private clearGuidePointer() {
    if (this.guideHand) { this.tweens.killTweensOf(this.guideHand); this.guideHand.destroy(); this.guideHand = undefined; }
    if (this.guideRing) { this.tweens.killTweensOf(this.guideRing); this.guideRing.destroy(); this.guideRing = undefined; }
    this.guideKey = "";
  }

  private updateGuide() {
    if (!this.guideMode || !this.slamMode || this.won || this.lost || this.tutStep > 0 || this.handMode || this.magnetMode) {
      if (this.guideKey) this.clearGuidePointer();
      return;
    }
    if (this.time.now - this.guideAt < 600) return; // throttle (rollouts cost ~100-300ms worst-case)
    this.guideAt = this.time.now;
    const t = this.computeGuideTarget();
    if (!t) { if (this.guideKey) this.clearGuidePointer(); return; }
    if (t.key === this.guideKey && this.guideHand) {
      // same suggestion — just track the target's position (cars slide as the queue shifts)
      this.guideHand.setPosition(t.x, this.guideHand.y);
      if (this.guideRing) this.guideRing.setPosition(t.x, t.y);
      return;
    }
    this.clearGuidePointer();
    this.guideKey = t.key;
    this.postLog({ ev: "guide", key: t.key }); // telemetry: which move was advised (W=winning line, F=fallback)
    const D = 130; // above cars/ropes, below modals
    this.guideRing = this.add.circle(t.x, t.y, this.chestSize * 0.62).setStrokeStyle(4, 0xffe14a, 1).setDepth(D);
    this.tweens.add({ targets: this.guideRing, scale: 1.18, alpha: 0.45, duration: 620, yoyo: true, repeat: -1 });
    this.guideHand = this.add
      .text(t.x, t.y - this.chestSize * 0.95, "👇", { fontFamily: "Arial, sans-serif", fontSize: "30px" })
      .setOrigin(0.5, 1)
      .setDepth(D + 1);
    this.tweens.add({ targets: this.guideHand, y: t.y - this.chestSize * 0.7, duration: 430, yoyo: true, repeat: -1, ease: "sine.inout" });
  }

  // A queue car (or its whole linked group) that could REALLY launch right now: every member
  // sits at the front of its column (only fellow members ahead) AND the group fits in the free
  // bays AND the ray has room. Mirrors the tap handler's own checks — used by deadlock detection.
  private queueHasLaunchableMove(freeSlots: number): boolean {
    const seen = new Set<ChestView>();
    for (const col of this.invColumns) {
      const head = col[0];
      if (!head || !head.container.scene || seen.has(head)) continue;
      const group = this.groupOf(head);
      group.forEach((m) => seen.add(m));
      let ok = true;
      for (const m of group) {
        const p = this.findInInventory(m);
        if (!p || !p.col.slice(0, p.r).every((c) => group.includes(c))) { ok = false; break; }
      }
      if (!ok) continue;
      if (freeSlots >= group.length && this.active.length + this.pending.length + group.length <= MAX_ON_TRACK) return true;
    }
    return false;
  }

  // TRAY-mode lose. Batch mode: the bays are full of blocked cars, nothing is out on the
  // ray, there's nothing new to stage (no free bay / empty queue) and pressing GO would
  // collect nothing (no bay car's colour is reachable) → deadlock. Auto mode: original
  // check (no bay car reachable/armed → none will ever auto-launch).
  private checkTrayStuck() {
    if (this.won || this.lost || this.tutPaused) return;
    if (this.active.length > 0 || this.pending.length > 0) return; // cars still in motion
    if (this.slamMode) {
      // DEADLOCK: nothing is out on the ray, and no bay car can collect any slime. A queue move
      // must ACTUALLY be launchable — "free bay + queue not empty" isn't enough: with 1 free bay
      // and only twin/triple groups left (need 2-3 bays), the player is stuck but the old check
      // kept the game hanging forever (user 2026-07-30) → now that counts as a loss too.
      for (const v of this.slots) { if (v && this.carCanCollect(v)) return; } // a tappable move exists
      const freeSlots = this.slots.reduce((n, s) => n + (s ? 0 : 1), 0);
      if (freeSlots > 0 && this.queueHasLaunchableMove(freeSlots)) return; // a queue car/group fits
      if (this.slots.every((s) => s === null) && this.queueEmpty()) return; // no cars at all (pre-win frame)
      this.lose();
      return;
    }
    if (this.trayMode && TRAY_BATCH) {
      if (this.batchRunning) return; // squad still working
      // The player can still change the board by staging a fresh queue car (needs both a
      // free bay AND a car left in the queue). If so, not stuck.
      const freeBay = this.slots.some((s) => s === null);
      if (freeBay && !this.queueEmpty()) return;
      if (this.slots.every((s) => s === null)) return; // no cars at all (pre-win frame)
      // Otherwise GO is the only lever: if any bay car's colour is reachable, GO progresses.
      for (const v of this.slots) { if (v && this.carCanCollect(v)) return; }
      this.lose();
      return;
    }
    if (this.slots.some((s) => s === null)) return; // a free bay → the player can still act
    for (const v of this.slots) {
      if (!v) continue;
      if (v.armAt !== undefined) return; // one is about to hop out
      if (this.carCanCollect(v)) return; // one can still collect → it will auto-launch
    }
    this.lose();
  }

  // Start the pre-launch "tell": each parked group member springs up-and-down (a real
  // hop, not a subtle nudge) + pumps bigger, with a bouncing green ⬆ arrow above it and
  // a pulsing ring around the bay — so it's unmistakable the car is about to jump out.
  private armBay(view: ChestView) {
    for (const m of this.liveGroup(view)) {
      if (m.armAt !== undefined || !this.slots.includes(m)) continue;
      m.armAt = this.time.now;
      m.carImg.setData("baseScale", m.carImg.scale); // remember rest scale to snap back to
      const tweens: Phaser.Tweens.Tween[] = [];
      const fx: Phaser.GameObjects.GameObject[] = [];
      // 1) the car itself springs up (bigger, snappier hop than before) and pumps.
      tweens.push(
        this.tweens.add({ targets: m.carImg, y: -14, duration: 230, ease: "Quad.out", yoyo: true, repeat: -1, hold: 40 }),
      );
      tweens.push(
        this.tweens.add({ targets: m.carImg, scale: m.carImg.scale * 1.18, duration: 230, ease: "Sine.inOut", yoyo: true, repeat: -1 }),
      );
      const bx = m.container.x;
      const by = m.container.y;
      // 2) a bright up-arrow hopping above the car — the clearest "I'm coming up!" cue.
      const arrow = this.add
        .text(bx, by - SLOT_SIZE * 0.6, "⬆", {
          fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "28px",
          color: "#3ad24a", stroke: "#0a3d12", strokeThickness: 5,
        })
        .setOrigin(0.5)
        .setDepth(60);
      fx.push(arrow);
      tweens.push(
        this.tweens.add({ targets: arrow, y: arrow.y - 12, scale: { from: 0.85, to: 1.15 }, duration: 320, ease: "Sine.inOut", yoyo: true, repeat: -1 }),
      );
      // 3) a pulsing yellow ring around the bay to pull the eye toward it.
      const ring = this.add.circle(bx, by, SLOT_SIZE * 0.52).setStrokeStyle(3, 0xffe14a, 1).setDepth(59);
      fx.push(ring);
      tweens.push(
        this.tweens.add({ targets: ring, scale: 1.4, alpha: 0.15, duration: 620, ease: "Sine.out", yoyo: true, repeat: -1 }),
      );
      m.armTweens = tweens;
      m.armFx = fx;
    }
  }

  // Stop the telegraph, destroy its extra fx, and snap the car back to its resting pose.
  private disarmBay(view: ChestView) {
    for (const m of this.liveGroup(view)) {
      if (m.armAt === undefined) continue;
      m.armAt = undefined;
      m.armTweens?.forEach((t) => t.stop());
      m.armFx?.forEach((o) => o.destroy());
      m.armTweens = undefined;
      m.armFx = undefined;
      m.carImg.y = 0;
      const base = m.carImg.getData("baseScale");
      if (typeof base === "number") m.carImg.setScale(base);
    }
  }

  private disarmAllBays() {
    for (const v of this.slots) if (v && v.armAt !== undefined) this.disarmBay(v);
  }

  // Point the car sprite along the road, but SMOOTHLY. Two things make corners
  // read as fluid turns instead of stepped jumps:
  //  1. look-ahead — the heading aims at a point ~1.7 nodes down the track, so the
  //     car begins turning into a bend slightly before reaching it (like steering).
  //  2. exponential smoothing — the rotation eases toward that target each frame
  //     (frame-rate independent), rounding off the discrete per-segment angle steps.
  private steerCar(a: ActiveChest, dt: number) {
    const N = this.track.length;
    if (N < 2) return;
    const LOOK = 1.7; // nodes to look ahead
    const ahead = this.openTrack ? Math.min(a.pos + LOOK, N - 1) : a.pos + LOOK;
    const x0 = this.lerpX(a.pos);
    const y0 = this.lerpY(a.pos);
    const x1 = this.lerpX(ahead);
    const y1 = this.lerpY(ahead);
    const dx = x1 - x0;
    const dy = y1 - y0;
    // Degenerate span (e.g. clamped at the very end of an open track) → hold heading.
    if (dx * dx + dy * dy > 0.0004) {
      const target = Math.atan2(dy, dx);
      if (a.heading === undefined) {
        a.heading = target; // first frame: snap so the car enters facing the road
      } else {
        const s = 1 - Math.exp(-14 * dt); // higher = snappier, lower = floatier
        const diff = Phaser.Math.Angle.Wrap(target - a.heading);
        a.heading = Phaser.Math.Angle.Wrap(a.heading + diff * s);
      }
    }
    if (a.heading !== undefined) a.view.carImg.setRotation(a.heading + CAR_ART_FACING);
  }

  // The car shoots THREE rays into the grid from its belt edge: straight ahead
  // plus the two 45° diagonals. Each ray stops at the first (outermost) tile it
  // hits — a different-colour tile blocks that ray. Among the rays whose first
  // hit matches the car's colour, it grabs the NEAREST one. So a slime sitting
  // diagonally (not only straight ahead) is collectable too, while the clean
  // outside-in peeling still holds.
  // What a given car is allowed to collect from a board cell code:
  //   colour car → a slime of its own colour · hammer car → soft rock · wood car → wood.
  private chestWants(chest: Chest, code: number): boolean {
    if (chest.kind === "hammer") return isObstacle(code) && obstacleKind(code) === "soft";
    if (chest.kind === "wood") return isObstacle(code) && obstacleKind(code) === "wood";
    return code >= 0 && code < HARD_ROCK && code === chest.color; // a matching slime
  }

  private findLosTargets(a: ActiveChest): number[] {
    const chest = a.view.chest;
    const cx = a.view.container.x;
    const cy = a.view.container.y;
    const cols = this.level.cols;
    const rows = this.level.rows;
    const gx = this.gridX;
    const gy = this.gridY;
    const cell = this.cell;
    const gW = cols * cell;
    const gH = rows * cell;

    // which belt edge is the car on right now?
    const dB = Math.abs(cy - this.beltBottom);
    const dT = Math.abs(cy - this.beltTop);
    const dL = Math.abs(cx - this.beltLeft);
    const dR = Math.abs(cx - this.beltRight);
    const m = Math.min(dB, dT, dL, dR);

    // Three INDEPENDENT lines of sight from the car into the grid: straight ahead
    // plus the two 45° diagonals. Each diagonal starts one cell to the SIDE of the
    // straight line, so a slime blocking the straight-ahead cell does NOT block the
    // diagonals — a clear diagonal is always collectable on its own.
    const rays: Array<{ r: number; c: number; dr: number; dc: number }> = [];

    if (m === dB || m === dT) {
      // horizontal edge → column + diagonals; must be over the grid
      if (cx < gx || cx > gx + gW) return [];
      const sc = Math.min(cols - 1, Math.max(0, Math.floor((cx - gx) / cell)));
      const dr = m === dB ? -1 : 1; // bottom shoots up, top shoots down
      const sr = m === dB ? rows - 1 : 0;
      rays.push({ r: sr, c: sc, dr, dc: 0 }); // straight
      rays.push({ r: sr, c: sc - 1, dr, dc: -1 }); // diagonal (side start)
      rays.push({ r: sr, c: sc + 1, dr, dc: 1 }); // diagonal (side start)
    } else {
      // vertical edge → row + diagonals
      if (cy < gy || cy > gy + gH) return [];
      const sr = Math.min(rows - 1, Math.max(0, Math.floor((cy - gy) / cell)));
      const dc = m === dL ? 1 : -1; // left shoots right, right shoots left
      const sc = m === dL ? 0 : cols - 1;
      rays.push({ r: sr, c: sc, dr: 0, dc }); // straight
      rays.push({ r: sr - 1, c: sc, dr: -1, dc }); // diagonal (side start)
      rays.push({ r: sr + 1, c: sc, dr: 1, dc }); // diagonal (side start)
    }

    // Every matching slime hit by a ray, nearest first, de-duplicated. Callers take
    // just [0] normally, or all of them when the endgame pickup boost is on.
    const hits: Array<{ idx: number; steps: number }> = [];
    const seen = new Set<number>();
    for (const ray of rays) {
      const hit = this.rayHit(ray.r, ray.c, ray.dr, ray.dc);
      // A still-hidden "?" slime can never be targeted (its colour is unknown).
      if (hit && !this.hiddenSet.has(hit.idx) && this.chestWants(chest, this.level.board[hit.idx]) && !seen.has(hit.idx)) {
        seen.add(hit.idx);
        hits.push(hit);
      }
    }
    hits.sort((p, q) => p.steps - q.steps);
    return hits.map((h) => h.idx);
  }

  // Walk a ray across the grid from (startR,startC) stepping by (dr,dc); return
  // the first occupied cell (its board index + how many steps out it is), or null.
  private rayHit(
    startR: number,
    startC: number,
    dr: number,
    dc: number,
  ): { idx: number; steps: number } | null {
    const cols = this.level.cols;
    const rows = this.level.rows;
    const occ = (r: number, c: number) =>
      r >= 0 && r < rows && c >= 0 && c < cols && !!this.keys[r * cols + c];
    const diagonal = dr !== 0 && dc !== 0;
    let r = startR;
    let c = startC;
    let steps = 0;
    while (r >= 0 && r < rows && c >= 0 && c < cols) {
      const idx = r * cols + c;
      if (this.keys[idx]) return { idx, steps };
      // A diagonal step slips between two cells: (r,c+dc) and (r+dr,c). If BOTH
      // are occupied the diagonal is pinched shut — treat it as blocked so the
      // car can't reach a slime "through" a corner of other slimes.
      if (diagonal && occ(r, c + dc) && occ(r + dr, c)) return null;
      r += dr;
      c += dc;
      steps++;
    }
    return null;
  }

  private lerpX(pos: number) {
    const N = this.track.length;
    const i = Math.floor(pos) % N;
    const j = (i + 1) % N;
    return Phaser.Math.Linear(this.track[i].x, this.track[j].x, pos - Math.floor(pos));
  }

  private lerpY(pos: number) {
    const N = this.track.length;
    const i = Math.floor(pos) % N;
    const j = (i + 1) % N;
    return Phaser.Math.Linear(this.track[i].y, this.track[j].y, pos - Math.floor(pos));
  }

  // ---- Collect: the critter sprouts legs and runs to board its car --------

  private fire(a: ActiveChest, cellIdx: number) {
    this.fireTo(a.view, cellIdx);
  }

  // A hammer car strikes a soft rock: crack on the first hit, shatter on the second.
  // No runner boards — it's an in-place hit that consumes one of the car's swings.
  private hitSoftRock(a: ActiveChest, idx: number) {
    const key = this.keys[idx];
    if (!key) return;
    const view = a.view;
    view.chest.count = Math.max(0, view.chest.count - 1); // one swing spent
    view.countText.setText(String(view.chest.count));

    this.aimBeam(view.container.x, view.container.y, key.x, key.y, 0xcaa06a);

    const hp = ((key.getData("hp") as number) ?? 2) - 1;
    if (hp <= 0) {
      const cells = (key.getData("cells") as number[]) ?? [idx];
      for (const ci of cells) this.keys[ci] = null; // a 2×2 soft rock clears all four
      this.keysRemaining -= 1;
      this.revealHiddenAround(cells);
      this.explode(key.x, key.y, this.cell * 1.3, 12, 0xcaa06a, 6); // big rock burst
      key.destroy();
    } else {
      key.setData("hp", hp);
      const num = key.getData("hpText") as Phaser.GameObjects.Text | undefined;
      if (num) num.setText(String(hp)); // remaining hits
      const body = key.getData("body") as Phaser.GameObjects.Image;
      body.setTexture("rock-soft-cracked");
      body.setDisplaySize(key.width * 1.08, key.width * 1.08); // keep footprint after swap
      this.tweens.add({ targets: key, angle: 8, duration: 55, yoyo: true }); // shake
    }
    Audio.board();
    if (view.chest.count <= 0) this.finishCar(view); // out of swings → drive off
    if (this.keysRemaining <= 0 && this.runners.length === 0) this.win();
  }

  // A wood car grabs a wood block: it pops in place with a small burst (no runner).
  private collectWood(a: ActiveChest, idx: number) {
    const key = this.keys[idx];
    if (!key) return;
    const view = a.view;
    view.chest.count = Math.max(0, view.chest.count - 1);
    view.countText.setText(String(view.chest.count));
    this.aimBeam(view.container.x, view.container.y, key.x, key.y, 0x9a6b3f);
    const cells = (key.getData("cells") as number[]) ?? [idx];
    for (const ci of cells) this.keys[ci] = null;
    this.keysRemaining -= 1;
    this.revealHiddenAround(cells);
    this.explode(key.x, key.y, this.cell * 0.95, 8, 0xb5834a, 5); // small wood burst
    key.destroy();
    Audio.board();
    if (view.chest.count <= 0) this.finishCar(view);
    if (this.keysRemaining <= 0 && this.runners.length === 0) this.win();
  }

  // A burst of chips + a flash ring where an obstacle is destroyed/collected.
  private explode(x: number, y: number, radius: number, count: number, color: number, chip: number) {
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI * 2 * i) / count + (i % 2) * 0.5;
      const p = this.add.rectangle(x, y, chip, chip, color).setDepth(DEPTH_RUNNER + 1);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(ang) * radius,
        y: y + Math.sin(ang) * radius,
        angle: 180,
        alpha: 0,
        scale: 0.3,
        duration: 340,
        ease: "Quad.out",
        onComplete: () => p.destroy(),
      });
    }
    const ring = this.add.circle(x, y, radius * 0.5, color, 0.4).setDepth(DEPTH_RUNNER);
    this.tweens.add({
      targets: ring,
      scale: 1.8,
      alpha: 0,
      duration: 260,
      ease: "Quad.out",
      onComplete: () => ring.destroy(),
    });
  }

  // Send the slime at cellIdx running to board `view` (a normal car OR the VIP
  // magnet car). Shared by the line-of-sight pickup and the Magnet booster.
  private fireTo(view: ChestView, cellIdx: number) {
    const key = this.keys[cellIdx]!;
    // Clear EVERY cell this tile occupies (a 2×2 wood clears all four at once), but
    // it still counts as one collected unit / one seat.
    const cells = (key.getData("cells") as number[]) ?? [cellIdx];
    for (const ci of cells) this.keys[ci] = null;
    this.keysRemaining -= 1;
    this.revealHiddenAround(cells); // an opened side reveals any adjacent "?" slime
    view.inFlight += 1; // reserve a seat so the car won't over-collect while this one runs

    // Rare treat: the slime that fills this car's LAST seat (count → 0) has a
    // 1-in-100 chance to be a bigger "Nice!" slime.
    const nice = view.inFlight === view.chest.count && Math.random() < 0.02; // rare (~1 in 50) — was a leftover 0.5 test value that made slimes balloon constantly

    // Wood has no palette colour → use a wood-brown for its beam/sparkle/legs.
    const boardCode = this.level.board[cellIdx];
    const color = boardCode >= 0 && boardCode < HARD_ROCK ? COLORS[boardCode] : 0x9a6b3f;
    const s = this.cell;
    const legCol = shade(color, 0.5);

    // 2-LAYER slime: the collected top uncovers a DIFFERENT-colour bottom slime in the
    // same cell (a fresh tile pops in; keysRemaining already counted it). user 2026-07-24.
    const lay2 = this.level.layer2;
    if (lay2 && lay2[cellIdx] >= 0) {
      const bottom = lay2[cellIdx];
      lay2[cellIdx] = -1;
      this.level.board[cellIdx] = bottom;
      const cols2 = this.level.cols;
      const bx = this.gridX + ((cellIdx % cols2) + 0.5) * this.cell;
      const by = this.gridY + (Math.floor(cellIdx / cols2) + 0.5) * this.cell;
      const nk = this.makeKey(bottom, bx, by, this.cell);
      this.keys[cellIdx] = nk;
      nk.setScale(0.5);
      this.tweens.add({ targets: nk, scale: 1, duration: 170, ease: "Back.out" });
      this.sparkle(bx, by, COLORS[bottom]);
    }

    // quick "collect beam": a line flashes from the car to the critter it's
    // grabbing, then fades as the critter sets off running.
    this.aimBeam(view.container.x, view.container.y, key.x, key.y, color);

    // little puff where it sets off
    this.sparkle(key.x, key.y, color);

    // give the tile two legs and turn it into a runner chasing the car.
    // Legs are drawn growing DOWNWARD from y=0 and placed near the bottom edge so
    // they clearly poke out below the square (otherwise they hide inside it).
    const legL = this.add.graphics();
    const legR = this.add.graphics();
    for (const leg of [legL, legR]) {
      leg.fillStyle(legCol, 1);
      leg.fillRoundedRect(-s * 0.08, 0, s * 0.16, s * 0.3, s * 0.07);
    }
    key.addAt(legL, 0); // behind the body so only the part below the square shows
    key.addAt(legR, 0);
    key.setScale(1.08); // pop out of the grid a touch (updateRunners drives size from here)
    key.setDepth(DEPTH_RUNNER); // run above the grid tiles (still below foliage)

    this.runners.push({
      node: key,
      body: key.getData("body") as Phaser.GameObjects.Image,
      car: view,
      spd: RUN_START,
      legL,
      legR,
      phase: 0,
      tx: view.container.x,
      ty: view.container.y,
      nice,
    });
  }

  // Move each running critter toward its car, accelerating to catch it, legs
  // shuffling. It boards ONLY on arrival: that is when the seat count drops and,
  // if the car is now full, when the car drives off. Win when all have boarded.
  private updateRunners(dt: number) {
    const s = this.cell;
    for (const r of [...this.runners]) {
      const car = r.car;
      // Orphaned slime: its car already drove off (container/countText destroyed). Don't
      // let it keep running toward a ghost and grow into a big stranded blob on the board —
      // remove it at once. (Also avoids touching the car's destroyed text when it "boards".)
      if (car.left || !car.container.scene) {
        this.runners.splice(this.runners.indexOf(r), 1);
        r.node.destroy();
        if (this.keysRemaining <= 0 && this.runners.length === 0) this.win();
        continue;
      }
      // track the car's live position while it still exists (it keeps moving / may leave)
      if (car.container.scene) {
        r.tx = car.container.x;
        r.ty = car.container.y;
      }
      const dx = r.tx - r.node.x;
      const dy = r.ty - r.node.y;
      const dist = Math.hypot(dx, dy) || 1;
      const vx = dx / dist;
      const vy = dy / dist;

      // If the car has finished its route and is holding for its last runners, those
      // runners RUSH in (much faster) so the car doesn't sit there waiting.
      const rush = car.waiting ? 3 : 1;
      r.spd = Math.min(RUN_MAX * rush, r.spd + RUN_ACCEL * rush * dt);
      const step = r.spd * dt;
      const speedFrac = Phaser.Math.Clamp(r.spd / RUN_MAX, 0, 1); // 0..1, how fast it is going
      const closing = Phaser.Math.Clamp(1 - dist / (s * 3.2), 0, 1); // 0..1 as it nears the car

      // ---- running animation --------------------------------------------
      // legs churn faster the faster it runs; stride length grows with speed
      r.phase += dt * (12 + speedFrac * 34);
      const swing = Math.sin(r.phase);
      const stride = s * (0.08 + speedFrac * 0.16);
      const legTop = s * 0.42;
      r.legL.setPosition(-s * 0.2, legTop + swing * stride);
      r.legR.setPosition(s * 0.2, legTop - swing * stride);

      // body bobs up on each footfall (head bounce)
      const bob = Math.abs(swing) * s * (0.1 + speedFrac * 0.08);
      r.body.setPosition(0, -bob);

      // lean into the run, leaning harder as it strains to catch the car
      const lean = Phaser.Math.Clamp(vx, -1, 1) * (0.12 + speedFrac * 0.18 + closing * 0.14);
      r.node.rotation = lean + swing * 0.04;

      // squash & stretch along the travel direction — a determined reach in the
      // final sprint makes it read as "straining to catch up"
      const st = 0.05 + speedFrac * 0.06 + closing * 0.16;
      // ~20% bigger overall than before; still grows as it reaches the car; a rare
      // "Nice!" slime is 120% of that. sizeComp scales the tiny in-grid tile of a BIG
      // picture board up to the 25×25 standard, so runners look the SAME size near the
      // cars on every level (on boards ≤25 stdCell==cell → sizeComp is 1, no change).
      const sizeComp = this.cell > 0 ? this.stdCell / this.cell : 1;
      const base = 1.3 * (1 + closing * 0.72) * (r.nice ? 1.2 : 1) * sizeComp;
      if (Math.abs(vx) >= Math.abs(vy)) r.node.setScale(base * (1 + st), base * (1 - st * 0.6));
      else r.node.setScale(base * (1 - st * 0.6), base * (1 + st));

      // dust puff on each footfall while sprinting
      const sign = swing >= 0 ? 1 : -1;
      if (r.lastSwing !== undefined && sign !== r.lastSwing && speedFrac > 0.45) {
        this.footDust(r.node.x, r.node.y + s * 0.55);
      }
      r.lastSwing = sign;

      if (dist <= step + 8) {
        // reached the car → NOW it boards: seat count drops, legs gone
        this.runners.splice(this.runners.indexOf(r), 1);
        // juicy "hop aboard" pop: swell BIG (×1.7) with a bouncy overshoot as it
        // vanishes onto the car — reads as a satisfying "bụp" (user 2026-07-23).
        const n = r.node;
        this.tweens.add({
          targets: n,
          scaleX: n.scaleX * 1.7,
          scaleY: n.scaleY * 1.7,
          alpha: 0,
          duration: 140,
          ease: "Back.out",
          onComplete: () => n.destroy(),
        });
        car.inFlight = Math.max(0, car.inFlight - 1);
        car.chest.count = Math.max(0, car.chest.count - 1);
        car.countText.setText(String(car.chest.count));
        Audio.pop(); // soft light "munch" pop as the slime hops aboard (gentler than board())
        if (r.nice) this.niceEffect(car.container.x, car.container.y); // rare treat!
        if (car.container.scene) this.pulse(car.container);
        if (car.chest.count <= 0) {
          Audio.finish(); // little fanfare as the full car drives off
          this.finishCar(car); // full → drive off, only now
        }
        if (this.keysRemaining <= 0 && this.runners.length === 0) this.win();
      } else {
        r.node.x += vx * step;
        r.node.y += vy * step;
      }
    }
  }

  // A friendly "collect" spark when a car grabs a slime: a soft link that fades
  // fast, a happy pop-ring at the slime, and a few little stars (in the slime's
  // colour) reeled from the slime toward the car — like it's being picked up.
  private aimBeam(x0: number, y0: number, x1: number, y1: number, color: number) {
    // soft, gentle link (no harsh bolt)
    const g = this.add.graphics().setDepth(DEPTH_RUNNER + 1);
    g.lineStyle(5, color, 0.25);
    g.lineBetween(x0, y0, x1, y1);
    g.lineStyle(1.5, 0xffffff, 0.55);
    g.lineBetween(x0, y0, x1, y1);
    this.tweens.add({ targets: g, alpha: 0, duration: 200, ease: "Quad.out", onComplete: () => g.destroy() });

    // cheerful pop-ring at the slime
    const ring = this.add.circle(x1, y1, 7).setStrokeStyle(3, color, 0.9).setDepth(DEPTH_RUNNER + 2);
    this.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 340, ease: "Quad.out", onComplete: () => ring.destroy() });

    // little stars pop at the slime, then get gently reeled toward the car
    for (let i = 0; i < 4; i++) {
      const s = this.add.star(x1, y1, 5, 2.2, 4.6, color).setDepth(DEPTH_RUNNER + 2);
      const t = 0.4 + 0.5 * (i / 3); // travel partway to the car
      const tx = x1 + (x0 - x1) * t;
      const ty = y1 + (y0 - y1) * t;
      this.tweens.add({
        targets: s,
        x: tx,
        y: ty,
        scale: { from: 1.1, to: 0.2 },
        alpha: { from: 1, to: 0 },
        angle: 160,
        duration: 300 + i * 30,
        ease: "Quad.out",
        onComplete: () => s.destroy(),
      });
    }
  }

  // A small dust puff kicked up at a running critter's feet.
  private footDust(x: number, y: number) {
    const p = this.add.circle(x, y, 2.4, 0xffffff, 0.5).setDepth(DEPTH_RUNNER - 1);
    this.tweens.add({
      targets: p,
      y: y - 5,
      alpha: 0,
      scale: 0.3,
      duration: 260,
      ease: "Quad.out",
      onComplete: () => p.destroy(),
    });
  }

  private sparkle(x: number, y: number, color: number) {
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI * 2 * i) / 6;
      const p = this.add.circle(x, y, 3, color);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(ang) * 20,
        y: y + Math.sin(ang) * 20,
        alpha: 0,
        scale: 0.2,
        duration: 320,
        ease: "Quad.out",
        onComplete: () => p.destroy(),
      });
    }
  }

  private pulse(c: Phaser.GameObjects.Container) {
    this.tweens.add({ targets: c, scale: 1.14, duration: 80, yoyo: true });
  }

  // Draw the "holding hands" rope between consecutive members of each live linked
  // group (skipped when they are far apart, e.g. mid-transition, so no long line
  // stretches across screen). A triple gets two ropes, etc.
  private drawTwinLinks() {
    const g = this.twinLinkG;
    if (!g) return;
    g.clear();
    for (const group of this.carGroups) {
     for (let seg = 0; seg + 1 < group.length; seg++) {
      const a = group[seg];
      const b = group[seg + 1];
      if (a.left || b.left || !a.container.scene || !b.container.scene) continue;
      // Don't rope to a partner that's FULLY hidden below the inventory viewport (a deep back
      // queue row) — that's what made the rope stretch as a long chord to an off-screen car
      // (user 2026-07-26, L303). But a car in the PEEK row (half-visible, dimmed) must still
      // show its rope — the old centre-based check hid ropes on peeking twins, so the player
      // saw two linked cars with no rope (user 2026-07-30, L131). Clip on the car's TOP edge.
      const ropeClipY = this.invMaskBottom + this.chestSize / 2;
      const aVis = !(this.invMaskBottom > 0 && a.container.y > ropeClipY);
      const bVis = !(this.invMaskBottom > 0 && b.container.y > ropeClipY);
      if (!aVis || !bVis) {
        // One member visible, partner fully hidden (vertical pair at the viewport edge): draw a
        // short rope STUB pointing at the hidden partner so the visible car never looks unlinked
        // ("xe đôi không có dây" — user 2026-07-30); the full rope appears once both are on-screen.
        const vis = aVis ? a : bVis ? b : null;
        if (vis) {
          const hid = vis === a ? b : a;
          const vx = vis.container.x, vy = vis.container.y;
          const dx = hid.container.x - vx, dy = hid.container.y - vy;
          const dd = Math.hypot(dx, dy) || 1; const ux2 = dx / dd, uy2 = dy / dd;
          const r0 = (vis.carImg.displayWidth * (vis.container.scaleX || 1)) * 0.42;
          const sx = vx + ux2 * r0, sy = vy + uy2 * r0;
          g.lineStyle(6.5, 0xff9d5a, 0.85); g.lineBetween(sx, sy, sx + ux2 * 20, sy + uy2 * 20);
          g.lineStyle(2.2, 0xffe9cf, 0.7); g.lineBetween(sx, sy, sx + ux2 * 20, sy + uy2 * 20);
          g.fillStyle(0xfff3d0, 1); g.fillCircle(sx, sy, 5);
        }
        continue;
      }
      const ax = a.container.x, ay = a.container.y;
      const bx = b.container.x, by = b.container.y;
      const dist = Phaser.Math.Distance.Between(ax, ay, bx, by);
      // Backstop against a stray screen-spanning line (e.g. a mid-launch tween).
      if (dist < 1 || dist > GAME_W * 0.95) continue;

      // Anchor the rope on each car's EDGE facing its partner (not its centre), so the
      // rope lives in the GAP between the cars: a clean STRAIGHT link that never bows into
      // an arc and never overlaps a body / its centred seat number. Clamp each anchor to
      // its own side of the midpoint so even a snug pair still shows a short rope.
      const ux = (bx - ax) / dist, uy = (by - ay) / dist;
      const radOf = (v: ChestView) => (v.carImg.displayWidth * (v.container.scaleX || 1)) * 0.42;
      const half = dist / 2;
      const ra = Math.min(radOf(a), half - 1), rb = Math.min(radOf(b), half - 1);
      const ax2 = ax + ux * ra, ay2 = ay + uy * ra;
      const bx2 = bx - ux * rb, by2 = by - uy * rb;

      g.lineStyle(11, 0xff7a4d, 0.28); g.lineBetween(ax2, ay2, bx2, by2); // soft warm glow
      g.lineStyle(6.5, 0xff9d5a, 1);   g.lineBetween(ax2, ay2, bx2, by2); // main ribbon (warm coral-orange)
      g.lineStyle(2.2, 0xffe9cf, 0.9); g.lineBetween(ax2, ay2, bx2, by2); // bright highlight

      // rounded "hands" where the rope grips each car
      g.fillStyle(0xfff3d0, 1);
      g.fillCircle(ax2, ay2, 5);
      g.fillCircle(bx2, by2, 5);
     }
    }
  }

  // Rare celebration: a bouncy praise banner + a gold star burst at the car.
  private niceEffect(x: number, y: number) {
    const words = ["Nice!", "Great!", "Wow!", "Cool!"];
    const word = words[Math.floor(Math.random() * words.length)];
    const t = this.add
      .text(x, y - 8, word, {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold italic",
        fontSize: "30px",
        color: "#fff2a8",
        stroke: "#c8560a",
        strokeThickness: 7,
      })
      .setOrigin(0.5)
      .setDepth(320)
      .setScale(0.3)
      .setAngle(-8);
    this.tweens.add({ targets: t, scale: 1.2, duration: 220, ease: "Back.out" });
    this.tweens.add({
      targets: t,
      y: y - 54,
      alpha: 0,
      delay: 420,
      duration: 620,
      ease: "Quad.out",
      onComplete: () => t.destroy(),
    });
    // gold star burst
    for (let i = 0; i < 10; i++) {
      const ang = (Math.PI * 2 * i) / 10;
      const p = this.add.star(x, y, 5, 3, 7, 0xffe066).setDepth(319);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(ang) * 40,
        y: y + Math.sin(ang) * 40,
        angle: 180,
        alpha: 0,
        scale: 0.2,
        duration: 520,
        ease: "Quad.out",
        onComplete: () => p.destroy(),
      });
    }
  }

  private finishCar(view: ChestView) {
    if (view.left) return; // already leaving
    // Linked cars only leave when EVERY member is full — a finished one keeps travelling
    // (empty) alongside its group until the others fill too, then they all leave together.
    const mates = this.liveGroup(view);
    if (mates.some((m) => m.chest.count > 0)) return;
    for (const m of mates) this.leaveCar(m);
  }

  private leaveCar(view: ChestView) {
    if (view.left) return;
    view.left = true;
    this.disarmBay(view); // stop any telegraph bob so its child tweens don't outlive the car
    const ai = this.active.findIndex((a) => a.view === view);
    if (ai >= 0) this.active.splice(ai, 1);
    const si = this.slots.indexOf(view);
    if (si >= 0) this.slots[si] = null;
    this.tweens.add({
      targets: view.container,
      scale: 0.2,
      y: view.container.y - 26,
      alpha: 0,
      duration: 300,
      ease: "Back.in",
      onComplete: () => view.container.destroy(),
    });
  }

  private parkChest(a: ActiveChest) {
    // TRAY mode: a car that darted out returns to its RESERVED bay (never needs to find a
    // new slot, never loses here — the reservation guaranteed the space). Group members
    // return to their own reserved bays together.
    if (this.trayMode) {
      this.removeActive(a);
      a.view.waiting = false;
      const members = this.isGrouped(a.view) ? this.liveGroup(a.view) : [a.view];
      for (const m of members) {
        if (m === a.view) continue;
        const act = this.active.find((x) => x.view === m);
        if (act) { this.removeActive(act); m.waiting = false; }
      }
      for (const m of members) {
        let si = m.traySlot;
        if (si == null || this.slots[si] !== m) si = this.slots.findIndex((s) => s === null || s === m);
        if (si >= 0) { this.slots[si] = m; m.traySlot = si; this.parkIntoSlot(m, si); }
      }
      this.updateSlotWarning();
      return;
    }
    this.removeActive(a);
    a.view.waiting = false; // no longer waiting on runners
    this.disarmAllBays(); // bays are about to reshuffle (compactSlots) — clear any telegraph fx

    // Linked cars park TOGETHER and MUST sit side by side. Left-pack the cars already
    // waiting so the N rightmost bays are free & adjacent, then bay the group there.
    // If fewer than N bays are free the queue can't hold the group → game over.
    if (this.isGrouped(a.view)) {
      const members = this.liveGroup(a.view); // ordered, includes `a`
      const need = members.length;
      const total = this.slots.length;
      const occ = this.slots.reduce((n, s) => n + (s ? 1 : 0), 0);
      if (occ > total - need) {
        this.lose(a);
        return;
      }
      // pull any still-driving members off the ray so the whole group bays together
      for (const m of members) {
        if (m === a.view) continue;
        const act = this.active.find((x) => x.view === m);
        if (act) {
          this.removeActive(act);
          m.waiting = false;
        }
      }
      this.compactSlots(); // slide waiting cars left so bays occ..occ+need-1 are free
      members.forEach((m, k) => this.parkIntoSlot(m, occ + k));
      return;
    }

    const free = this.slots.findIndex((s) => s === null);
    if (free < 0) {
      // Waiting queue is full and yet another car needs a bay → game over.
      this.lose(a);
      return;
    }
    this.parkIntoSlot(a.view, free);
  }

  // Left-pack every parked car (order preserved) so any gaps end up on the right and
  // the free bays are contiguous. Used before parking a twin pair so it always lands
  // side by side. Moved cars slide over and have their relaunch tap rewired.
  private compactSlots() {
    const cars = this.slots.filter((s): s is ChestView => s !== null);
    for (let i = 0; i < this.slots.length; i++) this.slots[i] = null;
    cars.forEach((view, i) => {
      this.slots[i] = view;
      if (Math.abs(view.container.x - this.slotXs[i]) > 0.5) {
        this.tweens.add({
          targets: view.container,
          x: this.slotXs[i],
          y: this.slotY,
          duration: 240,
          ease: "Cubic.out",
        });
      }
      const hit = view.container.getData("hit") as Phaser.GameObjects.Rectangle;
      hit.removeAllListeners("pointerdown");
      hit.on("pointerdown", () => this.relaunchFromSlot(i));
    });
  }

  // Slide one car into a specific waiting bay and wire its relaunch tap.
  private parkIntoSlot(view: ChestView, slotIndex: number) {
    this.slots[slotIndex] = view;
    view.carImg.setRotation(0); // sit upright while parked in the waiting slot
    const dist = Phaser.Math.Distance.Between(
      view.container.x,
      view.container.y,
      this.slotXs[slotIndex],
      this.slotY,
    );
    this.tweens.add({
      targets: view.container,
      x: this.slotXs[slotIndex],
      y: this.slotY,
      scale: (SLOT_SIZE - 6) / this.chestSize,
      duration: Phaser.Math.Clamp(dist * 2.4, 480, 950), // slow, even pull-in
      ease: "Cubic.out",
    });
    const hit = view.container.getData("hit") as Phaser.GameObjects.Rectangle;
    hit.setInteractive({ useHandCursor: true });
    hit.removeAllListeners("pointerdown");
    hit.on("pointerdown", () => this.relaunchFromSlot(slotIndex));

    // Tutorial step 2: the first car to park → point the hand at its bay. Wait for
    // the slide-in tween to settle before dimming, so the spotlight lands on the car.
    if (this.tutStep === 2) {
      this.tutStep = 3;
      this.time.delayedCall(700, () => {
        if (this.tutStep === 3 && !this.won && !this.lost) {
          this.showTutHint(this.slotXs[slotIndex], this.slotY, "Tap the parked car\nto send it out again!", SLOT_SIZE * 0.9);
        }
      });
    }

    this.updateSlotWarning(); // may now be full → flash the bays
  }

  private removeActive(a: ActiveChest) {
    const i = this.active.indexOf(a);
    if (i >= 0) this.active.splice(i, 1);
  }

  // ---- Lose -----------------------------------------------------------

  private notePeak() { const u = this.slots.filter(Boolean).length; if (u > this.peakUsed) this.peakUsed = u; }
  // Stream ONE telemetry event to the dev server IMMEDIATELY (user 2026-07-30: log every move as it
  // happens — start/launch/bayTap — so an abandoned run still leaves its trail, not just win/lose).
  private postLog(obj: Record<string, unknown>) {
    if (!this.slamMode) return;
    const line = JSON.stringify({ lvl: this.levelNum, t: Math.round((typeof performance !== "undefined" ? performance.now() : 0) - this.playStart), ...obj });
    console.log("[HOPLOG] " + line);
    try { fetch("/api/hoplog", { method: "POST", headers: { "Content-Type": "application/json" }, body: line }).catch(() => { }); } catch { /* ignore */ }
  }
  private emitPlayLog(result: "win" | "lose") {
    if (!this.slamMode) return; // telemetry only for slam playtests
    this.notePeak();
    const summary = { lvl: this.levelNum, result, ms: Math.round((typeof performance !== "undefined" ? performance.now() : 0) - this.playStart), launches: this.playLog.length, peakBays: this.peakUsed, bays: this.slots.length, log: this.playLog };
    try { const arr = JSON.parse(localStorage.getItem("hopin_playlog") || "[]"); arr.push(summary); localStorage.setItem("hopin_playlog", JSON.stringify(arr)); } catch { /* ignore */ }
    this.postLog({ ev: "result", ...summary }); // final recap line (streamed like every other event)
  }

  private lose(pending?: ActiveChest) {
    if (this.won || this.lost) return;
    this.lost = true;
    this.emitPlayLog("lose");
    this.failedThisAttempt = true; // a loss means a later win is worth 1 rock, not 2
    Audio.finish(); // (placeholder sfx)

    // Let the queue-full board sit for a beat so the moment registers before the
    // curtain drops — popping the lose screen instantly felt abrupt (user 2026-07-24).
    this.time.delayedCall(650, () => this.showLoseModal(pending));
  }

  private showLoseModal(pending?: ActiveChest) {
    const REVIVE_COST = 900;
    const canAfford = this.gold >= REVIVE_COST;
    const cx = GAME_W / 2;
    const cy = GAME_H / 2;
    const objs: Phaser.GameObjects.GameObject[] = [];

    // Opaque cover with a soft warm-dark gradient (brown → near-black) instead of a
    // flat fill, so the popup reads on a moody backdrop.
    const cover = this.add.graphics().setDepth(399);
    cover.fillGradientStyle(0x3c2c22, 0x3c2c22, 0x140d09, 0x140d09, 1);
    cover.fillRect(cx - (GAME_W + 240) / 2, cy - (GAME_H + 240) / 2, GAME_W + 240, GAME_H + 240);
    objs.push(cover);
    const dim = this.add
      .rectangle(cx, cy, GAME_W + 240, GAME_H + 240, 0x000000, 0.001)
      .setDepth(400)
      .setInteractive();
    objs.push(dim);

    // Hero art ("OUT OF SPACE!" — already carries its own title & hint text).
    const imgSize = Math.min(GAME_W - 56, 300);
    const heroCY = cy - 92;
    let heroBottom = heroCY;
    if (this.textures.exists("out-of-space")) {
      const hero = this.add.image(cx, heroCY, "out-of-space").setDepth(401);
      const ts = imgSize / hero.width;
      hero.setScale(ts * 0.4);
      this.tweens.add({ targets: hero, scaleX: ts, scaleY: ts, duration: 360, ease: "Back.out" });
      heroBottom = heroCY + (hero.height * ts) / 2;
      objs.push(hero);
    } else {
      objs.push(
        this.add
          .text(cx, heroCY, "QUEUE FULL! 😵", {
            fontFamily: "Arial, sans-serif",
            fontStyle: "bold",
            fontSize: "23px",
            color: "#ffd0c4",
          })
          .setOrigin(0.5)
          .setDepth(401)
      );
      heroBottom = heroCY + 20;
    }

    // Small rounded button helper (rounded rect + centred label + invisible hit zone).
    const mkBtn = (
      bx: number,
      by: number,
      bw: number,
      bh: number,
      label: string,
      fill: number,
      stroke: number,
      onClick: () => void,
      enabled = true
    ) => {
      const r = Math.min(bh / 2, 16);
      const g = this.add.graphics().setDepth(402);
      g.fillStyle(enabled ? fill : 0xa39b8c, 1);
      g.fillRoundedRect(bx - bw / 2, by - bh / 2, bw, bh, r);
      g.lineStyle(3, enabled ? stroke : 0x7d766a, 1);
      g.strokeRoundedRect(bx - bw / 2, by - bh / 2, bw, bh, r);
      objs.push(g);
      objs.push(
        this.add
          .text(bx, by, label, {
            fontFamily: "Arial, sans-serif",
            fontStyle: "bold",
            fontSize: `${Math.round(bh * 0.34)}px`,
            color: enabled ? "#ffffff" : "#efe9dc",
            align: "center",
          })
          .setOrigin(0.5)
          .setDepth(403)
      );
      if (enabled) {
        const hit = this.add
          .rectangle(bx, by, bw, bh, 0xffffff, 0.001)
          .setDepth(404)
          .setInteractive({ useHandCursor: true });
        hit.on("pointerdown", onClick);
        objs.push(hit);
      }
    };

    const closeAll = () => objs.forEach((o) => o.destroy());

    // REVIVE: pay gold, clear the 5 waiting bays (cars drive up & off), then park
    // the car that couldn't fit — and resume play.
    const revive = () => {
      if (this.gold < REVIVE_COST) return;
      this.addGold(-REVIVE_COST);
      this.lost = false;
      closeAll();
      const parked = this.slots.filter(Boolean) as ChestView[];
      for (const v of parked) this.leaveCar(v); // drift up & leave → free the slot
      if (pending) this.parkChest(pending);
    };

    // Revive button (green, big). Greyed out with a hint if the player can't pay.
    const btnW = Math.min(GAME_W - 70, 280);
    const reviveY = heroBottom + 34;
    mkBtn(
      cx,
      reviveY,
      btnW,
      60,
      canAfford ? `REVIVE   ${REVIVE_COST} 🪙` : `Need ${REVIVE_COST} 🪙 to revive`,
      0x35b04a,
      0x1f7d33,
      revive,
      canAfford
    );

    // Secondary row: replay this level | back to Home.
    const gap = 14;
    const bw = (btnW - gap) / 2;
    const by = reviveY + 60;
    mkBtn(cx - gap / 2 - bw / 2, by, bw, 46, "Replay", 0xd98a2b, 0xa5610f, () => {
      closeAll();
      this.startLevel(this.levelNum);
    });
    mkBtn(cx + gap / 2 + bw / 2, by, bw, 46, "Home", 0x6d7b8a, 0x49525d, () => {
      closeAll();
      this.scene.start("select");
    });
  }

  // ---- Win ------------------------------------------------------------

  private win() {
    if (this.won) return;
    this.won = true;
    this.emitPlayLog("win");
    const next = this.levelNum + 1;
    // Gold is granted only the FIRST time a level is cleared (no replay farming).
    const firstClear = this.claimFirstClearReward(this.levelNum);
    const reward = firstClear ? 50 : 0;
    if (reward > 0) this.addGold(reward);
    this.unlockProgress(next); // record on the picker that this level is beaten

    // Lucky Clover event: award clovers + auto-grant any milestone rewards reached.
    // Unlocks after Level 10; every win from then on collects clovers (2 for a clean
    // first-try clear, else 1). isEventUnlocked() reads the progress we just saved.
    let cloverAward: ReturnType<typeof awardClovers> | undefined;
    if (this.levelNum >= EVENT_UNLOCK_LEVEL && isEventUnlocked() && !isEventComplete()) {
      cloverAward = awardClovers(cloversForWin(firstClear, this.failedThisAttempt));
      for (const m of cloverAward.granted) this.grantEventReward(m.reward);
    }
    // Hold on the freshly-cleared board for a beat before the curtain — popping the
    // victory screen the instant the last slime boards felt abrupt (user 2026-07-24).
    this.time.delayedCall(750, () => this.showWinModal(reward, cloverAward));
  }

  private showWinModal(reward: number, cloverAward: ReturnType<typeof awardClovers> | undefined) {
    const cx = GAME_W / 2;
    const cy = GAME_H / 2;
    // Opaque, over-sized cover that fully HIDES the game board/UI behind it. Soft
    // sunny gradient (warm cream → grass green) instead of a flat fill.
    const cover = this.add.graphics().setDepth(399);
    cover.fillGradientStyle(0xfdf6d0, 0xfdf6d0, 0xb7dd9a, 0xb7dd9a, 1);
    cover.fillRect(cx - (GAME_W + 240) / 2, cy - (GAME_H + 240) / 2, GAME_W + 240, GAME_H + 240);
    const dim = this.add
      .rectangle(cx, cy, GAME_W + 240, GAME_H + 240, 0x000000, 0.001)
      .setDepth(400)
      .setInteractive();

    // Hero art ("VICTORY" — already carries its own banner text). Pops in.
    const imgSize = Math.min(GAME_W - 40, 330);
    const heroCY = cy - 70;
    let heroBottom = heroCY;

    let hero: Phaser.GameObjects.Image | undefined;
    if (this.textures.exists("victory")) {
      hero = this.add.image(cx, heroCY, "victory").setDepth(401);
      const ts = imgSize / hero.width;
      hero.setScale(ts * 0.2);
      this.tweens.add({ targets: hero, scaleX: ts, scaleY: ts, duration: 440, ease: "Back.out" });
      heroBottom = heroCY + (hero.height * ts) / 2;
    }
    const t1 = this.textures.exists("victory")
      ? undefined
      : this.add
          .text(cx, heroCY, `LEVEL ${this.levelNum} COMPLETE! 🎉`, {
            fontFamily: "Arial, sans-serif",
            fontStyle: "bold",
            fontSize: "24px",
            color: "#2f6a2f",
          })
          .setOrigin(0.5)
          .setDepth(401);
    if (t1) heroBottom = heroCY + 18;

    // Stack the reward lines under the hero with a running cursor.
    const extra: Phaser.GameObjects.GameObject[] = [];
    const line = (y: number, msg: string, size: number, color: string, bold = true) =>
      this.add
        .text(cx, y, msg, {
          fontFamily: "Arial, sans-serif",
          fontStyle: bold ? "bold" : "normal",
          fontSize: `${size}px`,
          color,
          stroke: "#ffffff",
          strokeThickness: 3,
          align: "center",
        })
        .setOrigin(0.5)
        .setDepth(401);

    let infoY = heroBottom + 22;
    // Only show the "+50" line on a first clear; replays award nothing.
    if (reward > 0) {
      extra.push(line(infoY, `+${reward}  🪙`, 20, "#b5720a"));
      infoY += 30;
    }
    // Lucky Clover progress lines (only while the event is running).
    if (cloverAward) {
      extra.push(line(infoY, `+${cloverAward.gained}  ${CLOVER_ICON} ${EVENT_NAME}`, 18, "#2f7a34"));
      infoY += 26;
      for (const m of cloverAward.granted) {
        extra.push(line(infoY, `🎉 Reward: ${rewardLabel(m.reward)}`, 16, "#2a7a2a"));
        infoY += 24;
      }
      const p = cloverAward.progress;
      if (!p.done && p.next) {
        extra.push(line(infoY, `${p.remaining} more → ${rewardLabel(p.next.reward)}`, 13, "#3a6a3a", false));
        infoY += 24;
      } else if (p.done) {
        extra.push(line(infoY, `${EVENT_NAME} event complete! 🏆`, 14, "#2f7a34"));
        infoY += 24;
      }
    }

    const nextLevel = this.levelNum + 1;
    const t2 = this.add
      .text(cx, infoY + 12, `Tap for Level ${nextLevel}`, {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "15px",
        color: "#3a6a3a",
      })
      .setOrigin(0.5)
      .setDepth(401);
    // After finishing a level, go STRAIGHT into the next one (user 2026-07-27) instead of
    // returning to the Home map — keep the player in a continuous run.
    dim.on("pointerdown", () => {
      dim.destroy();
      cover.destroy();
      hero?.destroy();
      t1?.destroy();
      for (const o of extra) o.destroy();
      t2.destroy();
      this.startLevel(nextLevel);
    });
  }

  // ---- Lucky Clover: grant a milestone reward -------------------------

  private grantEventReward(r: EventReward) {
    if (r.kind === "gold") this.addGold(r.amount);
    else if (r.kind === "booster") this.grantEventBooster(r.key);
    else {
      this.addGold(r.gold);
      this.grantEventBooster(r.key);
    }
  }

  // Add one of a booster to the player's stock AND unlock it (gift), so an event
  // reward is usable even before its normal unlock level is reached.
  private grantEventBooster(key: string) {
    this.boosterCounts[key] = (this.boosterCounts[key] ?? 0) + 1;
    this.saveBoosterCounts();
    try {
      const g = new Set((localStorage.getItem("pf_boost_gifted") ?? "").split(",").filter(Boolean));
      g.add(key);
      localStorage.setItem("pf_boost_gifted", [...g].join(","));
    } catch {
      /* storage unavailable */
    }
    this.drawBoosters();
  }
}
