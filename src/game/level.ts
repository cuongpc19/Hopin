import { COLOR_COUNT } from "./palette";
import { DESIGNED_LEVELS } from "../levels/designed";

// A "chest" collects keys of its own color. `count` = how many keys it needs.
export interface Chest {
  color: number; // color id (index into COLORS)
  count: number;
  pairId?: number; // twin cars: two chests sharing a pairId always move together
}

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
}

// Difficulty tiers: every 5th level is HARD, every 15th is SUPER-HARD.
export type Difficulty = "normal" | "hard" | "superhard";

export function levelDifficulty(n: number): Difficulty {
  if (n % 15 === 0) return "superhard";
  if (n % 5 === 0) return "hard";
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

export function makeLevel(levelNum = 1): Level {
  // Per-number default road shape; a designed level's own `track` overrides it.
  // (No "line" in the early levels; the inverted-U "arch" is disabled — use "u".)
  const defaultTrack: TrackKind = levelNum === 1 || levelNum === 2 ? "u" : "square";

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
