import { COLOR_COUNT } from "./palette";
import { DESIGNED_LEVELS } from "../levels/designed";

// A "chest" collects keys of its own color. `count` = how many keys it needs.
// `kind` picks what it can collect: "color" (default) grabs same-colour slimes,
// "hammer" breaks soft rocks (2 hits each), "wood" grabs wood blocks.
export interface Chest {
  color: number; // color id (index into COLORS); ignored for hammer/wood cars
  count: number;
  pairId?: number; // twin cars: two chests sharing a pairId always move together
  kind?: "color" | "hammer" | "wood";
  // BURIED ("xe chôn"): the car shows a dark "?" cover — colour & seat count hidden —
  // until it reaches the FRONT of its queue column, where it flips face-up. Pure
  // perception (the data keeps the real colour); the reveal happens in GameScene.
  buried?: boolean;
}

// Obstacle cell codes in `board` (kept well above the colour range 0..18 so old
// levels are unaffected). >= 90 means "obstacle".
//   90 = hard rock (1×1) · 95 = hard rock (2×2)  — never removable
//   92 = wood (1×1)      · 97 = wood (2×2)        — needs a wood car
//   soft rock carries HP in the ones digit: 1×1 = 100+hp (101..104), 2×2 = 200+hp (201..204)
/**
 * Level cuối CÓ THIẾT KẾ TAY. Số nào lớn hơn vẫn chơi được nhưng rơi vào bản dựng tự động.
 *
 * Ở đây chứ không ở `LevelSelectScene` vì `GameScene` cũng cần (sau ván thắng nó đi thẳng
 * sang level kế, và phải biết chỗ dừng), mà `LevelSelectScene` thì đã import từ `GameScene`
 * — nhập ngược lại là thành vòng.
 *
 * L1-586. Đường đi của con số này: 185 → 165 (bỏ 20 board ở L40-59, mọi thứ từ L60 lùi 20 bậc)
 * → 286 (đợt art thay 201 board từ L86 đã đưa dữ liệu lên 286 mà con số vẫn kẹt ở 165, 121 level
 * cuối nằm ngoài tầm với) → 586 (user 2026-08-14: 300 bàn emoji mới xếp vào L287-586).
 * Hàng xe của L36-586 dựng theo cùng một luật: mốc B 30-50 cho level chia hết cho 5, 60-100 cho
 * phần còn lại — xem hai commit "Rebuild every queue from level 36" và "Add 300 levels".
 */
export const LEVEL_COUNT = 586;

export const HARD_ROCK = 90;
export const BIG_HARD = 95;
export const WOOD = 92;
export const BIG_WOOD = 97;
export type ObstacleKind = "hard" | "soft" | "wood";
// Build a soft-rock code: hp = hits to break (1..4), big = the 2×2 variant.
export const softRock = (hp: number, big = false) => (big ? 200 : 100) + Math.max(1, Math.min(4, hp));

// ---- HỘP SOCOLA (chocolate box) ------------------------------------------------------------
// Một tấm socola N×N ĐÈ LÊN N² slime và giấu chúng đi. Mặt hộp có hai dải ruy băng bắt chéo
// (ngang + dọc, cắt nhau đúng Ô GIỮA vì N lẻ) và một mặt đồng hồ tròn màu kem in con số.
//
// LUẬT: con số = số slime phải ăn để hộp vỡ. Ruy băng quyết định slime nào được TÍNH —
// ruy băng một màu thì chỉ slime đúng màu đó trừ số, ruy băng CẦU VỒNG thì màu nào cũng trừ.
// Về 0 là hộp vỡ NGAY tại cú ăn đó, cả N² slime bên trong nhập vào bàn đúng ô nó đang chiếm.
//
// ⚠ Ô dưới hộp vẫn giữ MÀU THẬT trong `board` (hộp vỡ là lộ ra ngay, không phải sinh mới) —
// giống hệt cách `hidden` làm. Cái chặn tia + chặn ăn là `GameScene.boxAt`, KHÔNG phải mã ô.
// Nghĩa là bất biến ghế=ô KHÔNG đổi: slime dưới hộp vẫn phải có xe chở.
export const RAINBOW = -1; // ChocoBox.ribbon: mọi màu đều tính
export interface ChocoBox {
  /** board index của ô TRÊN-TRÁI. Cả khối n×n tính từ đây. */
  at: number;
  /**
   * Cạnh hộp, PHẢI LẺ để hai dải ruy băng cắt nhau đúng ô giữa và mặt đồng hồ ngồi lên ô đó.
   * 3-11. User 2026-08-14 cho gấp đôi cỡ cũ; 3 và 5 nhân đôi ra 6 và 10 đều CHẴN nên làm tròn
   * LÊN số lẻ → 7 và 11.
   */
  n: number;
  /** số slime hợp lệ còn phải ăn để vỡ hộp. */
  count: number;
  /** màu id được tính, hoặc RAINBOW (-1) = mọi màu. */
  ribbon: number;
}

export const isObstacle = (v: number) => v >= HARD_ROCK;
export const isSoftRock = (v: number) => (v >= 101 && v <= 104) || (v >= 201 && v <= 204);
export const softHp = (v: number) => v % 10; // hits-to-break of a soft rock (1..4)
// "Big" 2×2 obstacles: place the code at the TOP-LEFT cell of a 2×2 block, the other
// three cells -1. The game expands it to fill (and block) all four cells.
export const isBigObstacle = (v: number) => v === BIG_HARD || v === BIG_WOOD || (v >= 201 && v <= 204);
export const obstacleKind = (v: number): ObstacleKind =>
  isSoftRock(v) ? "soft" : v === WOOD || v === BIG_WOOD ? "wood" : "hard";
export const isRemovable = (v: number) =>
  (v >= 0 && v < HARD_ROCK) || (isObstacle(v) && obstacleKind(v) !== "hard");

// The 5 road shapes a level can use. All wrap a unified critter grid; the road
// runs in the margin OUTSIDE the design cells (drawn a fixed width, ~car-sized).
//   line   — single bottom row (grid above)
//   u      — ∪, open at the top  (road: left + bottom + right)
//   arch   — ⊓, open at the bottom (road: left + top + right)
//   square — full loop ring (square grid)
//   rect   — full loop ring (rectangular grid)
export type TrackKind = "line" | "u" | "arch" | "square" | "rect";

export interface Level {
  cols: number;
  rows: number;
  // board[r * cols + c] = color id (a key), or -1 for an empty cell
  board: number[];
  // Chests available to launch (the level's inventory)
  chests: Chest[];
  // Road shape. The cell size auto-shrinks so any grid (up to ~40×40) fits.
  track?: TrackKind;
  // TWO-LAYER slimes: layer2[i] = the colour hidden UNDER cell i (or -1 / undefined).
  // Collecting the top slime reveals this bottom colour instead of clearing the cell.
  layer2?: number[];
  // HIDDEN "?" slimes: hidden[i] = the real colour of a covered cell (or -1). It shows
  // a "?" and can't be collected until a 4-neighbour opens, then its colour is revealed.
  hidden?: number[];
  // Queue LINES ("3 line / 5 line xếp hàng"): how many vertical columns the chest
  // inventory splits into (only the front of each column is clickable). Default 4.
  // Fewer lines = fewer choices per turn = harder.
  lanes?: number;
  // TRAY mode: one-way waiting bays. Clicking a queue car stages it into the next empty
  // bay (never straight to the ray); bay cars auto-launch when their colour is reachable,
  // with NO manual relaunch / juggle. Undefined/false = the classic game.
  tray?: boolean;
  // BOARD THEME: default is the dark navy mat (bright tiles pop). Set true to use the
  // old light sand mat instead (per-level override, e.g. for a design comparison).
  lightBoard?: boolean;
  // SLAM prototype (hop-in-slam): small board with BIG slimes (cell sized to the actual
  // board, not the 25× standard) + slower cars, so the "slime runs to the car" pickup
  // reads strongly. Later carries the waiting-slot lock + deadlock mechanic.
  slam?: boolean;
  // Number of waiting slots (bays). Default 5. Fewer = tighter = harder (a slam difficulty
  // lever — the tuner sets this per level to hit the target winrate).
  bays?: number;
  // HỘP SOCOLA: tấm n×n đè lên n² slime cho tới khi ăn đủ `count` slime hợp lệ. Xem ChocoBox.
  boxes?: ChocoBox[];
}

// Difficulty tiers: every 5th level is HARD, every 15th is SUPER-HARD.
export type Difficulty = "normal" | "hard" | "superhard";

// Hand-picked walls (user 2026-08-08). These are tuned to ~5% on purpose, as gates:
// levels the player is meant to grind at, opened up later if the numbers say so.
//
// They need an override because the rule below is purely arithmetic: L34 would come out
// "normal" and L35 only "hard", so a player would walk into a 4% level with no warning
// and read it as a broken game rather than a wall. Anything this hard MUST announce itself.
// Rút còn L35, đo 2026-08-13. L34 đã được mở từ tường 13% lên 94% nên gắn nhãn siêu khó là
// nói dối người chơi; L30 giờ chia hết 15 nên luật số học bên dưới đã lo. Riêng L35 vẫn đo
// được 4% và nằm trong dải L1-39 user giữ nguyên, nên nó vẫn cần lời cảnh báo.
const SUPER_GATES = new Set([35]);

// ⚠ Ở ĐÂY TỪNG CÓ: `if (n >= 200 && n <= 300) return "normal"` — "kid pack: all easy".
// Bộ level dễ đó không còn: đợt art 2026-08-13 thay toàn bộ board từ L86 bằng 201 board emoji,
// và đợt tune 2026-08-14 dựng mọi level chia hết cho 5 tới L285 về mốc B 30-50, có cả lớp-2 và
// slime "?". Giữ dòng đó thì 17 level HARD và 6 level SUPER HARD trong dải 200-286 đi ra không
// mang nhãn nào — đúng cái mà chú thích SUPER_GATES bên trên gọi là "người chơi đọc thành game
// hỏng chứ không phải level khó".
export function levelDifficulty(n: number): Difficulty {
  if (SUPER_GATES.has(n)) return "superhard";
  if (n % 15 === 0) return "superhard";
  // "chia hết cho 5, TRÊN level 15" (user 2026-08-13) — L5 và L10 nằm trong khúc mở đầu,
  // dán nhãn HARD lên đó là doạ người chơi ở đúng chỗ họ hay bỏ nhất.
  if (n % 5 === 0 && n > 15) return "hard";
  return "normal";
}

// A concentric ring board (outer ring must be peeled before inner ones) — the
// default generated puzzle. Bigger & more colours for harder tiers.
function concentricBoard(size: number, maxColors: number): { cols: number; rows: number; board: number[] } {
  const board: number[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const ring = Math.min(r, c, size - 1 - r, size - 1 - c);
      board.push(Math.min(ring, maxColors - 1) % COLOR_COUNT);
    }
  }
  return { cols: size, rows: size, board };
}

// Deterministic pseudo-random so a given seed reproduces the same level.
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// Generate chests so total capacity per color >= number of keys of that color.
function generateChests(board: number[], seed: number): Chest[] {
  const rng = makeRng(seed);
  const counts = new Map<number, number>();
  for (const id of board) {
    if (id >= 0) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const chests: Chest[] = [];
  for (const [color, total] of counts) {
    let remaining = total;
    while (remaining > 0) {
      const count = Math.min(remaining, 4 + Math.floor(rng() * 5)); // 4..8
      chests.push({ color, count });
      remaining -= count;
    }
  }
  return chests;
}

// Isolated obstacle test level (open via ?level=999). Demonstrates all three
// obstacle types + the hammer & wood cars, without touching the real levels.
//   0 = outer slime ring · 91 = soft-rock ring · 3 = inner slimes · 92 = wood ·
//   90 = one hard rock that stays at the end.
function obstacleDemo(): Level {
  // 14×14: a slime border wrapping four 6×6 quadrants, each tiled with 2×2 (BIG)
  // obstacles — top-left = HARD, top-right = SOFT, bottom-left = WOOD, and the
  // bottom-right quadrant is ordinary 1×1 slimes.
  const N = 14;
  const board = new Array(N * N).fill(0); // slime-0 everywhere (border + carved below)
  for (let r = 1; r <= 12; r++) {
    for (let c = 1; c <= 12; c++) {
      board[r * N + c] = r >= 7 && c >= 7 ? 3 : -1; // slime quadrant, else clear for obstacles
    }
  }
  // Place a 2×2 BIG obstacle anchor every other cell (fills each quadrant: 3×3 = 9).
  const fill = (r0: number, c0: number, code: number) => {
    for (let r = r0; r < r0 + 6; r += 2)
      for (let c = c0; c < c0 + 6; c += 2) board[r * N + c] = code;
  };
  fill(1, 1, BIG_HARD); // top-left = hard rock
  fill(7, 1, BIG_WOOD); // bottom-left = wood
  // top-right = soft rocks with HP cycling 1..4 so the number readout is visible
  let k = 0;
  for (let r = 1; r < 7; r += 2)
    for (let c = 7; c < 13; c += 2) board[r * N + c] = softRock(1 + (k++ % 4), true);

  return {
    cols: N,
    rows: N,
    board,
    track: "square",
    chests: [
      { color: 0, count: 28 },
      { color: 0, count: 28 }, // 52 border slimes
      { color: 3, count: 20 },
      { color: 3, count: 20 }, // 36 inner slimes
      { color: 0, kind: "wood", count: 10 }, // 9 big wood units
      { color: 0, kind: "hammer", count: 14 },
      { color: 0, kind: "hammer", count: 14 }, // 9 soft rocks, HP 1..4 (~21 hits)
    ],
  };
}

// Isolated HỘP SOCOLA test level (mở bằng ?level=998). Một hộp 5×5 ruy băng XANH (chỉ slime
// xanh trừ số) và một hộp 3×3 ruy băng CẦU VỒNG (màu nào cũng trừ) trên cùng một bàn, để so
// hai luật cạnh nhau. Không đụng gì tới level thật.
function chocoDemo(): Level {
  const N = 15;
  const PAL = [0, 3, 5, 7]; // đỏ / lá / xanh dương / hồng — 4 màu, mỗi màu ~56 ô
  const board: number[] = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) board.push(PAL[(r * 2 + c) % PAL.length]);

  // count ≈ 1/4..1/3 số slime hộp giấu: 5×5 giấu 25 → 7 ; 3×3 giấu 9 → 3.
  const boxes: ChocoBox[] = [
    { at: 2 * N + 2, n: 5, count: 7, ribbon: 5 },
    { at: 10 * N + 9, n: 3, count: 3, ribbon: RAINBOW },
  ];

  // Ghế = ô, ĐÚNG BẰNG (xe chỉ rời bãi khi đầy 100%). Slime dưới hộp vẫn tính — hộp giấu chứ
  // không xoá — nên mọi màu đều đếm trên CẢ bàn.
  const counts = new Map<number, number>();
  for (const id of board) counts.set(id, (counts.get(id) ?? 0) + 1);
  const chests: Chest[] = [];
  for (const [color, total] of counts) {
    let left = total;
    while (left > 0) { const take = Math.min(left, 8); chests.push({ color, count: take }); left -= take; }
  }
  return { cols: N, rows: N, board, chests, track: "square", boxes };
}

export function makeLevel(levelNum = 1): Level {
  if (levelNum === 999) return obstacleDemo();
  if (levelNum === 998) return chocoDemo();

  // Every level uses the SQUARE ring road now (U/arch/line shapes were dropped);
  // a designed level's own `track` still overrides this if it ever sets one.
  const defaultTrack: TrackKind = "square";

  // Hand-designed level for this number takes priority; otherwise fall back to
  // the procedurally-generated placeholder so the game still has infinite levels.
  const designed = DESIGNED_LEVELS[levelNum];
  if (designed) {
    // Defensive copies so the scene can mutate freely without touching the source.
    return {
      cols: designed.cols,
      rows: designed.rows,
      board: [...designed.board],
      chests: designed.chests.map((c) => ({ ...c })),
      track: designed.track ?? defaultTrack,
      layer2: designed.layer2 ? [...designed.layer2] : undefined,
      hidden: designed.hidden ? [...designed.hidden] : undefined,
      lanes: designed.lanes,
      tray: designed.tray,
      lightBoard: designed.lightBoard,
      slam: designed.slam,
      bays: designed.bays,
      // Bản sao SÂU: `count` bị đếm ngược trong lúc chơi, dùng chung object thì chơi lại
      // level đó lần hai sẽ thấy hộp đã mở sẵn.
      boxes: designed.boxes ? designed.boxes.map((b) => ({ ...b })) : undefined,
    };
  }

  // Generated fallback — always the standard 25×25 square (only the colour count
  // varies by difficulty) so every level shares the same board & slime size.
  const diff = levelDifficulty(levelNum);
  const maxColors = diff === "superhard" ? 7 : diff === "hard" ? 6 : 5;
  const { cols, rows, board } = concentricBoard(25, maxColors);
  const chests = generateChests(board, levelNum);
  return { cols, rows, board, chests, track: "square" };
}

// ---- VÂN TAY NỘI DUNG LEVEL ---------------------------------------------------------------
// playlog.jsonl chỉ ghi SỐ level, nên khi một level được dựng lại thì các ván cũ vẫn nằm đó
// dưới cùng con số — `winrate-cal.mjs --fit` ghép ván trên board CŨ với board MỚI và nắn ra hệ
// số sai. L15 đã đổi nội dung 5 lần trong ngày 2026-08-06/07 (146 → 63 → 19 → 15 → 22 xe).
// Ghi thêm vân tay này vào dòng `result` để lọc được ván nào thuộc bản nào.
// ⚠ `scripts/genlib.mjs levelFingerprint()` phải giữ ĐÚNG chuỗi chuẩn hoá và ĐÚNG thuật toán
// này, nếu không hai bên ra hai hash khác nhau và bộ lọc coi như mọi ván đều lạc bản.
export function levelFingerprint(l: Pick<Level, "cols" | "rows" | "board" | "chests" | "layer2">): string {
  const s = `${l.cols}x${l.rows}|${l.board.join(",")}|`
    + `${l.chests.map((c) => `${c.color}:${c.count}`).join(",")}|`
    + `${l.layer2 ? l.layer2.join(",") : ""}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
