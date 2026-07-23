import Phaser from "phaser";
import { COLORS, TEXT_LIGHT, shade } from "../game/palette";
import { makeLevel, type Chest, type Level, type TrackKind } from "../game/level";
import { Audio } from "../game/audio";

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
  twin?: ChestView; // twin car ("xe đôi"): always launches / parks / leaves with its partner
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
const SPEED = 10; // track nodes per second (car travel speed — slower = more pickups per lap)
const MIN_GAP = 5; // min spacing between cars, in nodes (bigger cars need more room)
const BELT_SPEED = 6; // Line belt cleats: nodes per second
const SHOT_COOLDOWN = 180; // ms: min gap between a car picking up two critters (faster pickup)
// Critter "run to the car" animation: sets off, accelerates to catch the moving
// car. RUN_MAX must comfortably exceed car speed (SPEED * TRACK_STEP px/s).
const RUN_START = 160;
const RUN_ACCEL = 560;
const RUN_MAX = 460;
// Direction the car sprite art faces, in radians (0 = right/East). Tune if the
// car points the wrong way as it drives: right=0, up=-PI/2, left=PI, down=PI/2.
const CAR_ART_FACING = Math.PI / 2; // car art faces UP (face at top); +90° so the face leads travel

// Draw-order layers: background < road < grid/cars < runners.
const DEPTH_BG = -100;
const DEPTH_ROAD = -50;
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
    key: "refresh", img: "booster-refresh", label: "Shuffle", cost: 1000, unlock: 16,
    title: "New Booster: Shuffle!",
    desc: "Re-rolls the colors of the queued cars, bringing up a color you need.",
  },
  {
    key: "magnet", img: "booster-magnet", label: "Magnet", cost: 2000, unlock: 21,
    title: "New Booster: Magnet!",
    desc: "Tap a slime and a VIP car reels in every slime of that color, ignoring blockers.",
  },
];
const FREE_GIFT = 3; // free copies granted the first time you reach a booster's unlock level

export class GameScene extends Phaser.Scene {
  private level!: Level;
  private levelNum = 1;
  private cell = 0;
  private chestSize = 48;
  private gridX = 0; // top-left of the grid area
  private gridY = 0;

  // keys[r*cols+c] = the key display object, or null once collected
  private keys: (Phaser.GameObjects.Container | null)[] = [];
  private keysRemaining = 0;

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
  private invMask?: Phaser.Display.Masks.GeometryMask;
  private invMaskG?: Phaser.GameObjects.Graphics;
  private slots: (ChestView | null)[] = [];
  private slotXs: number[] = [];
  private slotY = 0;
  private slotCount = SLOT_COUNT; // grows when the "Add" booster is used
  private slotTiles: Phaser.GameObjects.Image[] = []; // the bay sprites (re-laid on Add)
  private handMode = false; // "Hand" booster armed: next tap picks a queued car
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

  private signalCount?: Phaser.GameObjects.Text; // "N/5" on the start-signal's green light
  private signalPost?: Phaser.GameObjects.Container; // the whole start-signal (bounced when full)
  private twinPairs: [ChestView, ChestView][] = []; // linked "xe đôi" pairs
  private twinLinkG?: Phaser.GameObjects.Graphics; // the holding-hands link, redrawn each frame

  private won = false;
  private lost = false; // waiting queue overflowed → game over

  private gold = 0; // player's currency (persists across levels + reloads)
  private goldText?: Phaser.GameObjects.Text;

  private startAt?: number; // level chosen on the picker (via scene.start("game", {level}))
  private missingSlime = new Set<number>(); // color ids whose slime-*.png is absent → drawn procedurally

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
    this.load.image("car-vip", "art/car-vip.png"); // golden/purple VIP car for the Magnet booster
    for (const b of ["add", "hand", "refresh", "magnet"]) {
      this.load.image(`booster-${b}`, `art/booster-${b}.png`);
    }
    // A colour whose slime-*.png doesn't exist yet (e.g. the expanded palette 11-18)
    // is drawn procedurally in create() so its tiles still render.
    this.load.on("loaderror", (file: Phaser.Loader.File) => {
      if (file.key.startsWith("slime-")) this.missingSlime.add(parseInt(file.key.slice(6), 10));
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
    this.gold = this.loadGold(); // starts at 0
    if (this.gold >= 1_000_000) {
      this.gold = 0; // clear the old dev top-up so the booster economy is real
      this.saveGold();
    }
    this.boosterCounts = this.loadBoosterCounts();
    // Draw a placeholder slime for any colour that has no slime art yet (palette 11-18).
    for (const i of this.missingSlime) this.makeSlimeTexture(i);
    // Auto-trim each car sprite's transparent padding → consistent on-screen size
    // regardless of how the art is exported (and rotation stays centred).
    for (let i = 0; i < COLORS.length; i++) this.trimTexture(`car-${i}`);
    this.trimTexture("car-vip");
    this.trimTexture("start-signal");
    // Keep the audio context unlocked (SFX only — no background music) in case the
    // game was opened directly without a prior gesture.
    Audio.unlock();
    this.input.on("pointerdown", () => Audio.unlock());

    // Level to start: picker choice > ?level=N (dev) > level 1.
    const q = parseInt(new URLSearchParams(location.search).get("level") ?? "", 10);
    const fromUrl = Number.isFinite(q) && q > 0 ? q : undefined;
    this.startLevel(this.startAt ?? fromUrl ?? 1);
  }

  private startLevel(levelNum: number) {
    this.levelNum = levelNum;
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
    this.handMode = false;
    this.magnetMode = false;
    this.keys = [];
    this.track = [];
    this.runners = [];
    this.won = false;
    this.lost = false;
    this.tutObjs = [];
    this.tutStep = 0;
    this.twinPairs = [];

    this.buildBackground();
    this.twinLinkG = this.add.graphics().setDepth(-1); // twin "hands" link (above road, below cars)

    this.level = makeLevel(levelNum);
    this.keysRemaining = this.level.board.filter((v) => v >= 0).length;

    // Top HUD (like the real Pixel Flow): settings (left) · level pill (center) ·
    // gold (right).
    this.buildTopBar(levelNum);

    const perRow = 4;
    const chest = CAR_SIZE;

    const hudH = 58; // top HUD strip
    const gTop = 10; // gap below the HUD
    const gBoard = 42; // breathing room between the board and the waiting slots
    const gSlots = 18;
    const gInv = 18;
    const boostH = 78;
    const margin = 6;

    // Bottom cluster (waiting slots → inventory → boosters) is capped at 40% of the
    // screen height — the board (zone 1) takes everything else. If the cap is tight,
    // the inventory shows fewer rows rather than shrinking the cars.
    const rowStep = chest + this.invGapY;
    const peek = Math.round(chest * 0.45);
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

    // Board absorbs the remaining height between the HUD and the bottom cluster.
    const topFixed = hudH + gTop + gBoard;
    let boardBudget = GAME_H - topFixed - bottomH - 2 * margin;
    boardBudget = Math.round(Math.min(Math.max(boardBudget, 220), GAME_H * 0.56));
    const m = this.computeMetrics(boardBudget);

    // Board sits just under the HUD; the bottom cluster is anchored to the screen
    // bottom (controls within thumb reach). Any slack falls between the two.
    const boardTop = hudH + gTop;
    this.buildBoard(boardTop, m); // zone 1

    let by = Math.max(boardTop + m.frameH + gBoard, GAME_H - margin - bottomH);
    this.buildSlots(by); // zone 2 (waiting slots)
    by += SLOT_SIZE + gSlots;

    this.buildInventory(by, perRow, visRows); // zone 3
    by += invH + gInv;

    this.buildBoosters(by, boostH); // zone 4

    // Gift + tutorialise any booster whose unlock level this level reaches.
    this.checkBoosterUnlocks(levelNum);

    if (levelNum === 1) this.startTutorial(); // gentle intro guidance
  }

  // ---- Level-1 tutorial ----------------------------------------------
  // Step 1: a bouncing hand points at the first queued car — "tap to send it".
  // Step 2: once a car has driven a lap and parked in a waiting bay, the hand
  // points there — "tap the parked car to send it out again". Ends on that tap.
  private startTutorial() {
    this.tutStep = 1;
    const front = this.invColumns.find((col) => col.length > 0)?.[0];
    if (!front) return;
    this.showTutHint(front.container.x, front.container.y, "Tap the car to send it off!");
  }

  private showTutHint(x: number, y: number, msg: string) {
    this.clearTutHint();
    const D = 260;
    const ring = this.add.circle(x, y, 32).setStrokeStyle(4, 0xffe14a, 1).setDepth(D);
    const hand = this.add
      .text(x + 20, y + 18, "👆", { fontSize: "36px" })
      .setOrigin(0.5)
      .setDepth(D + 1);
    const label = this.add
      .text(x, y - 52, msg, {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "15px",
        color: "#ffffff",
        backgroundColor: "#e23b3b",
        padding: { x: 12, y: 6 },
        align: "center",
      })
      .setOrigin(0.5)
      .setDepth(D + 1);
    this.tweens.add({ targets: ring, scale: 1.4, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });
    this.tweens.add({
      targets: hand,
      y: y + 30,
      duration: 560,
      yoyo: true,
      repeat: -1,
      ease: "Sine.inOut",
    });
    this.tutObjs = [ring, hand, label];
  }

  private clearTutHint() {
    for (const o of this.tutObjs) {
      this.tweens.killTweensOf(o);
      o.destroy();
    }
    this.tutObjs = [];
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

  // Full-screen forest-floor background image (bottom layer).
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

    const pad = 16; // outer margin from the frame edge to the road-centre box
    const gap = 8; // grass gap between a road and the grid (small → board fills more)
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
      // Largest CENTRED SQUARE loop that fits, sitting near the outer edge but
      // leaving a small margin so the whole road (outline included) stays visible.
      const edge = 12;
      const side = Math.min(GAME_W - roadW - 2 * edge, m.frameH - roadW - 2 * edge);
      this.beltLeft = cx - side / 2;
      this.beltRight = cx + side / 2;
      this.beltTop = cy - side / 2;
      this.beltBottom = cy + side / 2;
      this.roadRadius = Math.round(roadW * 1.1);
      // Cell size is computed for the STANDARD 25×25 board (not the actual cols/rows),
      // so every level renders slimes at the SAME size. A 25×25 board fills the ring;
      // a smaller board just occupies less of it, centred, at the same slime size.
      const STD = 25;
      const cb = Math.round(this.roadRadius * 0.3);
      const availW = this.beltRight - this.beltLeft - roadW - 2 * gap - cb;
      const availH = this.beltBottom - this.beltTop - roadW - 2 * gap - cb;
      this.cell = Math.max(6, Math.floor(Math.min(availW, availH) / STD));
      // small fill bump, capped by the road boundary (cb removed) so tiles never reach the road
      const capCell = Math.floor((this.beltRight - this.beltLeft - roadW - 2 * gap) / STD);
      this.cell = Math.min(Math.round(this.cell * 1.05), capCell);
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

    this.buildGroundMat(cols, rows);

    const keySize = this.cell;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const id = board[r * cols + c];
        if (id < 0) {
          this.keys.push(null);
          continue;
        }
        const { x, y } = this.cellCenter(r, c);
        this.keys.push(this.makeKey(id, x, y, keySize));
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

  // A smooth sandy/earth patch under the grid so the slimes stand on a defined clearing
  // (instead of blending into the grass) — a soft rim + top highlight, no gritty texture.
  private buildGroundMat(cols: number, rows: number) {
    const gw = cols * this.cell, gh = rows * this.cell;
    const pad = Math.round(this.cell * 0.85);
    const x = this.gridX - pad, y = this.gridY - pad, w = gw + 2 * pad, h = gh + 2 * pad;
    const rad = Math.round(this.cell * 1.3);
    const g = this.add.graphics().setDepth(-40); // above the forest bg, below the tiles
    g.fillStyle(0xb59468, 1); g.fillRoundedRect(x - 5, y + 3, w + 10, h + 10, rad + 5); // earth rim + drop shadow
    g.fillStyle(0xdcc79c, 1); g.fillRoundedRect(x, y, w, h, rad);                        // packed sand
    g.fillStyle(0xe8dab6, 0.45); g.fillRoundedRect(x + 5, y + 5, w - 10, Math.round(h * 0.4), rad - 3); // soft top light
    g.lineStyle(3, 0xc7ac7e, 0.9); g.strokeRoundedRect(x + 3, y + 3, w - 6, h - 6, rad - 2); // gentle inner edge
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
    const img = this.add.image(0, 0, `slime-${colorId}`).setDisplaySize(s * 1.15, s * 1.15); // body ≈ cell → tiles sit flush (no overlap)
    const c = this.add.container(x, y, [img]);
    c.setSize(s, s);
    c.setData("body", img); // kept so the collect animation can bob the body alone
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
    const byPair = new Map<number, ChestView>();
    this.level.chests.forEach((chest, i) => {
      const view = this.makeChestView(chest, 0, 0);
      const hit = view.container.getData("hit") as Phaser.GameObjects.Rectangle;
      hit.on("pointerdown", () => this.launchFromInventory(view));
      this.invColumns[i % perRow].push(view);
      // Link twin cars sharing a pairId (consecutive → adjacent columns, same row).
      if (chest.pairId != null) {
        const other = byPair.get(chest.pairId);
        if (other) {
          view.twin = other;
          other.twin = view;
          this.twinPairs.push([other, view]);
          byPair.delete(chest.pairId);
        } else {
          byPair.set(chest.pairId, view);
        }
      }
    });

    this.applyInventoryMask();
    this.layoutInventory(false);
  }

  // Clip the inventory to `invVisRows` full rows plus a peek of the next.
  private applyInventoryMask() {
    const rowStep = this.chestSize + this.invGapY;
    const maskTop = this.invTop - this.chestSize / 2 - 4;
    const maskBottom =
      this.invTop + (this.invVisRows - 1) * rowStep + this.chestSize / 2 + this.chestSize * 0.45;
    const mg = this.make.graphics();
    mg.fillStyle(0xffffff, 1);
    mg.fillRect(0, maskTop, GAME_W, maskBottom - maskTop);
    this.invMaskG = mg;
    this.invMask = mg.createGeometryMask();
  }

  // Lay out the column queues. Only the top chest of each column is clickable;
  // deeper chests are dimmed, and the mask makes row 3+ peek/hide.
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
        view.container.setAlpha(front ? 1 : r === 1 ? 0.7 : 0.4);
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
      const label = this.add
        .text(x, iconY + size / 2 + 8, b.label, {
          fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "11px", color: "#5a4a2a",
        })
        .setOrigin(0.5);
      this.boostBar!.add(label);

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
    if (key === "add") this.boosterAdd();
    else if (key === "hand") this.boosterHand();
    else if (key === "refresh") this.boosterRefresh();
    else if (key === "magnet") this.boosterMagnet();
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

  // Entering a level: gift (once) every booster whose unlock level is now reached,
  // then walk their tutorials one after another.
  private checkBoosterUnlocks(levelNum: number) {
    const gifted = this.giftedSet();
    const fresh: BoosterDef[] = [];
    for (const b of BOOSTERS) {
      if (levelNum >= b.unlock && !gifted.has(b.key)) {
        gifted.add(b.key);
        this.boosterCounts[b.key] = (this.boosterCounts[b.key] ?? 0) + FREE_GIFT; // free copies
        fresh.push(b);
      }
    }
    if (fresh.length === 0) return;
    try {
      localStorage.setItem("pf_boost_gifted", [...gifted].join(","));
    } catch {
      /* storage unavailable */
    }
    this.saveBoosterCounts();
    this.drawBoosters();
    this.showBoosterTutorials(fresh, 0);
  }

  // A modal explaining a just-unlocked booster (English). Chains through `list`.
  private showBoosterTutorials(list: BoosterDef[], idx: number) {
    if (idx >= list.length || this.won) return;
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
    const last = idx === list.length - 1;
    const ok = this.add
      .text(GAME_W / 2, y0 + ph - 32, "TRY IT NOW!", {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "16px", color: "#ffffff",
        backgroundColor: "#3a8a3a", padding: { x: 26, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(D + 2)
      .setInteractive({ useHandCursor: true });
    const kill = () => {
      [dim, panel, icon, title, desc, gift, ok].forEach((o) => o.destroy());
      if (!last) {
        this.showBoosterTutorials(list, idx + 1); // next unlocked booster's tutorial
      } else {
        // Let the player use the just-unlocked booster right away (one free go).
        this.time.delayedCall(80, () => this.runBooster(b.key));
      }
    };
    ok.on("pointerdown", kill);
    dim.on("pointerdown", kill);
  }

  // Can `key` be used now? (own one, or can afford to buy one at its gold price)
  private canUseBooster(key: string): boolean {
    if (!this.isBoosterUnlocked(key)) return false;
    if ((this.boosterCounts[key] ?? 0) > 0) return true;
    const def = BOOSTERS.find((b) => b.key === key)!;
    return this.gold >= def.cost;
  }
  // Spend one use: from owned stock if any, else buy one with gold.
  private consumeBooster(key: string) {
    if ((this.boosterCounts[key] ?? 0) > 0) {
      this.boosterCounts[key] -= 1;
      this.saveBoosterCounts();
    } else {
      const def = BOOSTERS.find((b) => b.key === key)!;
      this.addGold(-def.cost);
    }
    this.drawBoosters();
  }
  // Gate for immediate boosters: true if usable, else a toast explaining the cost.
  private affordToast(key: string): boolean {
    if (this.canUseBooster(key)) return true;
    const def = BOOSTERS.find((b) => b.key === key)!;
    this.toast(`Need ${def.cost} gold`);
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
    this.toast("+1 waiting bay!");
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
    this.toast("Tap a car in the queue to send it out");
    // Defer one tick so the tap that pressed the booster button isn't captured.
    this.time.delayedCall(40, () =>
      this.input.once("pointerdown", (p: Phaser.Input.Pointer) => {
        this.handMode = false;
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
          this.consumeBooster("hand");
          this.launchQueued(best);
          this.toast("Car sent!");
        } else {
          this.toast("Cancelled");
        }
      }),
    );
  }

  // Launch a specific queued car regardless of its position in the column.
  private launchQueued(view: ChestView) {
    // Twin cars leave together (Hand booster bypasses the front-of-column rule).
    const group = view.twin ? [view, view.twin] : [view];
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
    const cars = this.invColumns.flat().filter((v) => v.container.scene);
    if (cars.length === 0) {
      this.toast("Queue is empty");
      return;
    }
    // colours that still have uncollected slimes on the board
    const left: number[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < this.keys.length; i++) {
      if (this.keys[i]) {
        const c = this.level.board[i];
        if (!seen.has(c)) {
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
    cars.forEach((v, k) => {
      this.setCarColor(v, assign[k]);
      this.tweens.add({ targets: v.container, scale: v.container.scale * 1.16, duration: 130, yoyo: true, delay: (k % 8) * 15 });
    });
    this.toast("Cars recolored!");
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

  // "Magnet": arm a one-shot tap on a board slime. A VIP car then appears at the
  // board centre and slowly reels in every slime of that colour (ignores blockers).
  private boosterMagnet() {
    if (this.won || this.handMode || this.magnetMode) return;
    if (this.keysRemaining <= 0) {
      this.toast("No slimes left");
      return;
    }
    if (!this.affordToast("magnet")) return;
    this.magnetMode = true;
    this.toast("Tap a slime to pull all of its color");
    this.time.delayedCall(40, () =>
      this.input.once("pointerdown", (p: Phaser.Input.Pointer) => {
        this.magnetMode = false;
        const idx = this.slimeAt(p.worldX, p.worldY);
        if (idx < 0) {
          this.toast("Cancelled");
          return;
        }
        this.consumeBooster("magnet");
        this.spawnVipCollector(this.level.board[idx]);
      }),
    );
  }

  // Board cell index of the slime under a world point, or -1.
  private slimeAt(wx: number, wy: number): number {
    const { cols, rows } = this.level;
    const c = Math.floor((wx - this.gridX) / this.cell);
    const r = Math.floor((wy - this.gridY) / this.cell);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return -1;
    const idx = r * cols + c;
    return this.keys[idx] ? idx : -1;
  }

  // A VIP car hovers at the board centre and reels in all matching slimes, one
  // every ~220ms, then drives off once full (handled by the runner boarding code).
  private spawnVipCollector(color: number) {
    const total = this.keys.reduce(
      (n, k, i) => n + (k && this.level.board[i] === color ? 1 : 0),
      0,
    );
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
        const idx = this.findAnyColor(color);
        if (idx < 0) {
          timer.remove(); // all matching slimes are already reeling in / gone
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

  // First remaining slime of a given colour (any position), for the magnet.
  private findAnyColor(color: number): number {
    for (let i = 0; i < this.keys.length; i++) {
      if (this.keys[i] && this.level.board[i] === color) return i;
    }
    return -1;
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

    // coin
    const coinX = pillLeft + 16;
    this.add.circle(coinX, y, 10, 0xf9c22e).setStrokeStyle(2, 0xc98a10).setDepth(D + 1);
    this.add
      .text(coinX, y - 1, "G", {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "12px",
        color: "#8a5a10",
      })
      .setOrigin(0.5)
      .setDepth(D + 2);
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

  // Bump the saved progress so the level picker unlocks/star-marks levels.
  private unlockProgress(reached: number) {
    try {
      const cur = parseInt(localStorage.getItem("pf_progress") ?? "1", 10) || 1;
      if (reached > cur) localStorage.setItem("pf_progress", String(reached));
    } catch {
      /* storage unavailable — progress just won't persist */
    }
  }

  // Placeholder for a real store / in-app purchase. For now it grants a demo pack.
  private buyGold() {
    this.addGold(100);
    this.toast("+100 Gold");
  }

  // Minimal settings overlay (placeholder — sound/music toggles come later).
  private openSettings() {
    const D = 200;
    const pw = 300;
    const ph = 252;
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

    // Jump back to the level picker.
    const select = this.add
      .text(GAME_W / 2, y0 + 156, "🗺  Levels", {
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
    this.smallNotice(`Tối đa ${MAX_ON_TRACK}/${MAX_ON_TRACK} xe trên đường!`);
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
    const container = this.add.container(x, y);

    const key = `car-${chest.color}`;
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
    container.setData("hit", hit);
    return { chest, container, countText, carImg: img, inFlight: 0 };
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

    // Twin cars ("xe đôi") leave together — BOTH must be at the front of their
    // columns; otherwise wait for the lagging one to reach the front.
    const group = view.twin ? [view, view.twin] : [view];
    for (const v of group) {
      const p = this.findInInventory(v);
      if (!p || p.r !== 0) {
        this.smallNotice("Chờ cả 2 xe lên đầu hàng!");
        return;
      }
    }

    // Road must have room for the whole group (a twin needs 2 free slots).
    if (this.active.length + this.pending.length + group.length > MAX_ON_TRACK) {
      this.trackFullNotice();
      return;
    }

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
    }
  }

  private relaunchFromSlot(slotIndex: number) {
    if (this.won || this.handMode || this.magnetMode) return; // a booster claims this tap
    const view = this.slots[slotIndex];
    if (!view) return;
    // Twin cars relaunch together (both are parked side by side).
    const twinParked = !!view.twin && !view.twin.left && this.slots.includes(view.twin);
    const group = twinParked ? [view, view.twin!] : [view];
    if (this.active.length + this.pending.length + group.length > MAX_ON_TRACK) {
      this.trackFullNotice();
      return;
    }
    for (const v of group) {
      const si = this.slots.indexOf(v);
      if (si >= 0) this.slots[si] = null;
      (v.container.getData("hit") as Phaser.GameObjects.Rectangle).disableInteractive();
      this.pending.push(v);
    }
    if (this.tutStep === 3) {
      this.clearTutHint(); // tutorial complete
      this.tutStep = 0;
    }
  }

  private trySpawn() {
    if (this.pending.length === 0) return;
    if (this.active.length >= MAX_ON_TRACK) return; // at most 5 cars on the ray at once
    const N = this.track.length;
    const startClear = this.active.every((a) => {
      const d = (((a.pos - this.startIndex) % N) + N) % N;
      return Math.min(d, N - d) >= MIN_GAP;
    });
    if (!startClear) return;

    const view = this.pending.shift()!;
    const start = this.track[this.startIndex];
    view.container.setScale(1);
    view.container.setPosition(start.x, start.y);
    this.active.push({
      view,
      pos: this.startIndex,
      lastNode: this.startIndex,
      steps: 0,
      lastShot: 0,
      approaching: true, // drive in fast until the first slime is grabbed
    });
  }

  // ---- Main loop ------------------------------------------------------

  update(time: number, delta: number) {
    const dt = delta / 1000;
    this.animateBelt(dt); // the Line belt runs continuously
    this.drawTwinLinks(); // holding-hands link between twin cars
    if (this.won || this.lost) return;
    const N = this.track.length;
    if (N === 0) return;

    this.trySpawn();

    // Live "cars on the ray" count on the start signal.
    if (this.signalCount) this.signalCount.setText(`${this.active.length}/${MAX_ON_TRACK}`);

    // Endgame speed-up: once the queue (zone 3) is empty, the in-play cars PICK
    // faster — a shorter cooldown PLUS grabbing every matching slime in sight each
    // tick — while their DRIVE speed stays exactly the same.
    const boost = this.queueEmpty();

    for (const a of [...this.active]) {
      if (!this.active.includes(a)) continue; // pulled off by a twin partner this frame
      // Car has finished its route and is parked-in-waiting: hold still (no moving,
      // no firing) until the slimes already running to it have boarded, THEN pull
      // into a bay — so those slimes never chase the car across into the waiting bay.
      if (a.parkPending) {
        if (a.view.inFlight <= 0) this.parkChest(a);
        continue;
      }

      let gapAhead = N;
      for (const b of this.active) {
        if (b === a) continue;
        const d = (((b.pos - a.pos) % N) + N) % N;
        if (d > 0 && d < gapAhead) gapAhead = d;
      }
      // A just-spawned car drives in 2× until it grabs its first slime, so it isn't
      // slow crossing the empty grass before reaching the grid.
      const driveMul = a.approaching ? 2 : 1;
      let adv = SPEED * driveMul * dt;
      if (gapAhead - adv < MIN_GAP) adv = Math.max(0, gapAhead - MIN_GAP);

      if (adv > 0) {
        if (this.openTrack) {
          // One-way line/U/arch: advance WITHOUT wrapping (no ring modulo) so the
          // car never teleports from the end back to the start. When it reaches
          // the final node it pulls straight into a waiting bay from there.
          a.pos = Math.min(a.pos + adv, N - 1);
          while (a.lastNode < Math.floor(a.pos)) {
            a.lastNode++;
            a.steps++;
          }
          if (a.pos >= N - 1) {
            // reached the end: settle on the final node. If slimes are still running
            // to it, wait for them to board before pulling into a bay.
            const end = this.track[N - 1];
            a.view.container.setPosition(end.x, end.y);
            this.steerCar(a, dt);
            if (a.view.inFlight > 0) {
              a.parkPending = true;
              a.view.waiting = true; // last runners rush in
            } else this.parkChest(a);
            continue;
          }
          a.view.container.setPosition(this.lerpX(a.pos), this.lerpY(a.pos));
          this.steerCar(a, dt);
        } else {
          a.pos = (a.pos + adv) % N;
          let guard = 0;
          let parked = false;
          while (a.lastNode !== Math.floor(a.pos) && guard++ < N) {
            a.lastNode = (a.lastNode + 1) % N;
            a.steps++;
            if (a.steps >= N) {
              // Completed a full loop without emptying. If slimes are still running
              // to it, hold here until they board; otherwise park in a waiting slot.
              if (a.view.inFlight > 0) {
                a.parkPending = true;
                a.view.waiting = true; // last runners rush in
              } else this.parkChest(a);
              parked = true;
              break;
            }
          }
          if (parked) continue;
          a.view.container.setPosition(this.lerpX(a.pos), this.lerpY(a.pos));
          // Turn the sprite to follow the road, smoothed so corners look fluid
          // (only the sprite turns — the seat number stays upright).
          this.steerCar(a, dt);
        }
      }

      // Shoot at any same-color key with a clear line of sight (any angle), gated
      // by a cooldown. Once the queue (zone 3) is empty — no more cars left to send
      // up — the remaining in-play cars pick 3× faster so the endgame isn't a grind.
      const cooldown = boost ? SHOT_COOLDOWN / 3 : SHOT_COOLDOWN;
      if (time - a.lastShot >= cooldown) {
        // open seats = shown count minus critters already running to this car
        let openSeats = a.view.chest.count - a.view.inFlight;
        if (openSeats > 0) {
          // Normal: grab the single nearest slime in sight. Boosted (queue empty):
          // grab EVERY matching slime in the car's 3 lines of sight this tick, so it
          // clears faster without driving any faster.
          const targets = this.findLosTargets(a);
          const take = boost ? targets.length : Math.min(1, targets.length);
          let fired = false;
          for (let k = 0; k < take && openSeats > 0; k++) {
            this.fire(a, targets[k]);
            openSeats--;
            fired = true;
          }
          if (fired) {
            a.lastShot = time;
            a.approaching = false; // first slime grabbed → back to normal drive speed
          }
        }
      }
    }

    this.updateRunners(dt);
  }

  // True when the lineup queue (zone 3) has no cars left to launch — i.e. nothing
  // more will be pushed up. Used to speed up pickups for the in-play cars.
  private queueEmpty(): boolean {
    return !this.invColumns.some((col) => col.some((v) => v.container.scene));
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
  private findLosTargets(a: ActiveChest): number[] {
    const color = a.view.chest.color;
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
      if (hit && this.level.board[hit.idx] === color && !seen.has(hit.idx)) {
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

  // Send the slime at cellIdx running to board `view` (a normal car OR the VIP
  // magnet car). Shared by the line-of-sight pickup and the Magnet booster.
  private fireTo(view: ChestView, cellIdx: number) {
    const key = this.keys[cellIdx]!;
    this.keys[cellIdx] = null;
    this.keysRemaining -= 1;
    view.inFlight += 1; // reserve a seat so the car won't over-collect while this one runs

    // Rare treat: the slime that fills this car's LAST seat (count → 0) has a
    // 1-in-100 chance to be a bigger "Nice!" slime.
    const nice = view.inFlight === view.chest.count && Math.random() < 0.5; // 50% chance on a car's last slime

    const color = COLORS[this.level.board[cellIdx]];
    const s = this.cell;
    const legCol = shade(color, 0.5);

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
    key.setScale(1.08); // pop out of the grid a touch
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
      // grow up to +60% as it reaches the car; a rare "Nice!" slime is 120% of that
      const base = 1.08 * (1 + closing * 0.6) * (r.nice ? 1.2 : 1);
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
        // little "hop aboard" pop: swell 10% bigger as it vanishes onto the car
        const n = r.node;
        this.tweens.add({
          targets: n,
          scaleX: n.scaleX * 1.1,
          scaleY: n.scaleY * 1.1,
          alpha: 0,
          duration: 150,
          ease: "Back.out",
          onComplete: () => n.destroy(),
        });
        car.inFlight = Math.max(0, car.inFlight - 1);
        car.chest.count = Math.max(0, car.chest.count - 1);
        car.countText.setText(String(car.chest.count));
        Audio.board(); // cheerful blip as the slime hops aboard
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

  // A punchy LIGHTNING zap from the car to the critter it's grabbing: a jagged
  // bolt (coloured glow + white core) that flickers a few times, a muzzle spark at
  // the car, and a bright impact flash + ring at the slime.
  private aimBeam(x0: number, y0: number, x1: number, y1: number, color: number) {
    const g = this.add.graphics().setDepth(DEPTH_RUNNER + 2);
    const drawBolt = () => {
      g.clear();
      const main = this.boltPoints(x0, y0, x1, y1);
      g.lineStyle(8, color, 0.22); // soft outer glow
      this.strokePolyline(g, main);
      g.lineStyle(4, color, 0.7); // coloured body
      this.strokePolyline(g, main);
      g.lineStyle(1.6, 0xffffff, 1); // hot white core
      this.strokePolyline(g, main);
      // a couple of little forked branches for extra crackle
      for (let b = 0; b < 2; b++) {
        const t = 0.35 + b * 0.3;
        const bx = x0 + (x1 - x0) * t;
        const by = y0 + (y1 - y0) * t;
        const branch = this.boltPoints(bx, by, bx + (Math.random() * 2 - 1) * 18, by + (Math.random() * 2 - 1) * 18);
        g.lineStyle(1.4, 0xffffff, 0.8);
        this.strokePolyline(g, branch);
      }
    };
    drawBolt();

    // flicker: redraw a fresh jagged path a few times
    const flick = this.time.addEvent({ delay: 40, repeat: 3, callback: drawBolt });

    // muzzle spark at the car end
    const muzzle = this.add.circle(x0, y0, 6, 0xffffff, 0.9).setDepth(DEPTH_RUNNER + 2);
    this.tweens.add({ targets: muzzle, scale: 1.8, alpha: 0, duration: 200, ease: "Quad.out", onComplete: () => muzzle.destroy() });

    // impact flash + expanding ring at the slime
    const flash = this.add.circle(x1, y1, 9, 0xffffff, 0.95).setDepth(DEPTH_RUNNER + 2);
    this.tweens.add({ targets: flash, scale: 2.6, alpha: 0, duration: 280, ease: "Quad.out", onComplete: () => flash.destroy() });
    const ring = this.add.circle(x1, y1, 6).setStrokeStyle(3, color, 0.95).setDepth(DEPTH_RUNNER + 2);
    this.tweens.add({ targets: ring, scale: 3, alpha: 0, duration: 320, ease: "Quad.out", onComplete: () => ring.destroy() });

    // fade the whole bolt out, then clean up
    this.tweens.add({
      targets: g,
      alpha: 0,
      duration: 200,
      delay: 110,
      ease: "Quad.in",
      onComplete: () => {
        flick.remove();
        g.destroy();
      },
    });
  }

  // A jagged "lightning" path between two points: perpendicular jitter, largest in
  // the middle and tapering to 0 at both ends so it still hits car & slime cleanly.
  private boltPoints(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len;
    const py = dx / len; // perpendicular unit vector
    const segs = Math.max(4, Math.round(len / 16));
    const amp = Math.min(16, len * 0.18);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const off = i === 0 || i === segs ? 0 : (Math.random() * 2 - 1) * amp * Math.sin(Math.PI * t);
      pts.push({ x: x0 + dx * t + px * off, y: y0 + dy * t + py * off });
    }
    return pts;
  }

  private strokePolyline(g: Phaser.GameObjects.Graphics, pts: { x: number; y: number }[]) {
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.strokePath();
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

  // Draw the "holding hands" rope between each live twin pair (skipped when they
  // are far apart, e.g. mid-transition, so no long line stretches across screen).
  private drawTwinLinks() {
    const g = this.twinLinkG;
    if (!g) return;
    g.clear();
    for (const [a, b] of this.twinPairs) {
      if (a.left || b.left || !a.container.scene || !b.container.scene) continue;
      const ax = a.container.x;
      const ay = a.container.y;
      const bx = b.container.x;
      const by = b.container.y;
      if (Phaser.Math.Distance.Between(ax, ay, bx, by) > this.chestSize * 3.5) continue;
      g.lineStyle(4, 0xffcf6a, 0.95);
      g.lineBetween(ax, ay, bx, by);
      g.fillStyle(0xfff3d0, 1);
      g.fillCircle(ax + (bx - ax) / 3, ay + (by - ay) / 3, 3.5); // little hands
      g.fillCircle(ax + (2 * (bx - ax)) / 3, ay + (2 * (by - ay)) / 3, 3.5);
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
    // Twin cars only leave when BOTH are full — the finished one keeps travelling
    // (empty) alongside its partner until the partner fills too.
    const twin = view.twin;
    if (twin && !twin.left && twin.chest.count > 0) return;
    this.leaveCar(view);
    if (twin && !twin.left) this.leaveCar(twin);
  }

  private leaveCar(view: ChestView) {
    if (view.left) return;
    view.left = true;
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
    this.removeActive(a);
    a.view.waiting = false; // no longer waiting on runners

    // Twin cars park TOGETHER: pull the partner off the road too and bay them side
    // by side. Needs two free bays or the waiting queue overflows → game over.
    const twin = a.view.twin;
    if (twin && !twin.left) {
      const frees = this.freeSlots(2);
      if (frees.length < 2) {
        this.lose();
        return;
      }
      const twinActive = this.active.find((x) => x.view === twin);
      if (twinActive) {
        this.removeActive(twinActive);
        twin.waiting = false;
      }
      this.parkIntoSlot(a.view, frees[0]);
      this.parkIntoSlot(twin, frees[1]);
      return;
    }

    const free = this.slots.findIndex((s) => s === null);
    if (free < 0) {
      // Waiting queue is full and yet another car needs a bay → game over.
      this.lose();
      return;
    }
    this.parkIntoSlot(a.view, free);
  }

  // Up to n free waiting-bay indices (in order).
  private freeSlots(n: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.slots.length && out.length < n; i++) {
      if (this.slots[i] === null) out.push(i);
    }
    return out;
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

    // Tutorial step 2: the first car to park → point the hand at its bay.
    if (this.tutStep === 2) {
      this.tutStep = 3;
      this.showTutHint(this.slotXs[slotIndex], this.slotY, "Tap the parked car\nto send it out again!");
    }
  }

  private removeActive(a: ActiveChest) {
    const i = this.active.indexOf(a);
    if (i >= 0) this.active.splice(i, 1);
  }

  // ---- Lose -----------------------------------------------------------

  private lose() {
    if (this.won || this.lost) return;
    this.lost = true;
    Audio.finish(); // (placeholder sfx)
    const dim = this.add
      .rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.6)
      .setDepth(400)
      .setInteractive();
    this.add
      .text(GAME_W / 2, GAME_H / 2 - 34, "HÀNG ĐỢI ĐẦY! 😵", {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "24px",
        color: "#ffd0d0",
      })
      .setOrigin(0.5)
      .setDepth(401);
    this.add
      .text(GAME_W / 2, GAME_H / 2 + 12, "Chạm để chơi lại màn này", {
        fontFamily: "Arial, sans-serif",
        fontSize: "15px",
        color: "#ffe08a",
      })
      .setOrigin(0.5)
      .setDepth(401);
    dim.on("pointerdown", () => this.startLevel(this.levelNum));
  }

  // ---- Win ------------------------------------------------------------

  private win() {
    if (this.won) return;
    this.won = true;
    const next = this.levelNum + 1;
    const reward = 50; // flat gold earned for clearing a level
    this.addGold(reward);
    this.unlockProgress(next); // record on the picker that this level is beaten
    const dim = this.add
      .rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.55)
      .setInteractive();
    const t1 = this.add
      .text(GAME_W / 2, GAME_H / 2 - 40, `LEVEL ${this.levelNum} COMPLETE! 🎉`, {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "24px",
        color: TEXT_LIGHT,
      })
      .setOrigin(0.5);
    const tg = this.add
      .text(GAME_W / 2, GAME_H / 2 - 4, `+${reward}  🪙`, {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "20px",
        color: "#ffe14a",
      })
      .setOrigin(0.5);
    const t2 = this.add
      .text(GAME_W / 2, GAME_H / 2 + 30, "Tap to return home", {
        fontFamily: "Arial, sans-serif",
        fontSize: "15px",
        color: "#ffe08a",
      })
      .setOrigin(0.5);
    // After finishing a level, return to the Home map (not straight to the next).
    dim.on("pointerdown", () => {
      dim.destroy();
      t1.destroy();
      tg.destroy();
      t2.destroy();
      this.scene.start("select");
    });
  }
}
