// ►► VISUAL RULES (FEATURES.txt §20): board is DARK navy. Default bg fill = dark-neutral
//    id 12 so the bright subject pops (no dull light-grey mass). BG_ID=<id> / BG_ID=bright
//    override. For a LIGHT-board level set designed.json `lightBoard: true` on it.
//
// One-off: turn ONE character cell from a 5x2 grid image into a single level
// (a slime mosaic) and patch it into designed.json. Reuses the exact image->board
// logic (buildFromImage) from build-levels.mjs. For quick previews / testing.
//
//   node scripts/build-one.mjs <imagePath> <cellIndex 0..9> <level> [K] [SIZE]
//   e.g. node scripts/build-one.mjs "public/art/level art/1/1.png" 0 50 8 31
//
// cellIndex: 0..4 = top row (left->right), 5..9 = bottom row.
// SIZE = board cols/rows (25 = standard slime size; 31/39 = finer, slimes auto-shrink
//        in-game to stay inside the road — see GameScene STD/capCell). Also settable
//        via env BOARD (the positional arg wins when both are given).
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { applyBoxBorder, PREFER_DARK, PREFER_LIGHT } from "./border.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "src/levels/designed.json");
const [, , IMG = "public/art/level art/1/1.png", CELL = "0", LEVEL = "50", KK = "8", SIZE] = process.argv;
const cellIndex = parseInt(CELL, 10);
const levelNum = parseInt(LEVEL, 10);
const K = parseInt(KK, 10);
const COLS_GRID = 5, ROWS_GRID = 2;

// ---- palette (must match src/game/palette.ts) -------------------------------
const BASE_HEX = [
  "#fe4038", "#fe8f28", "#fed734", "#37cb5c", "#2ac0cc", "#408afa", "#9756fd",
  "#fd55a5", "#ffffff", "#cbcbcb", "#4a4a4a", "#985828", "#262630", "#3050a0",
  "#e0b888", "#98d0f0", "#208038", "#f8c0c8", "#902030",
];
const hexToRgb = (h) => { h = h.replace("#", ""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
const baseRgb = BASE_HEX.map(hexToRgb);
const BASE_N = BASE_HEX.length;
const EMPTY = -1;
// Finer grid so the character is smooth. RULE: always keep SAFE_MARGIN empty cells
// at the board edge (slime must never sit right next to the road). The subject auto-
// shrinks so subject + bg halo + safe margin always fit — raising BG_PAD never pushes
// slime closer to the edge, it just makes the character a bit smaller.
// Default 25 = STANDARD slime size (same as every other level). Only set BOARD=31/39
// on a level you deliberately want finer (its slimes render smaller — a per-level choice).
const BOARD_SIZE = parseInt(SIZE ?? process.env.BOARD ?? "25", 10);
const SAFE_MARGIN = parseInt(process.env.MARGIN ?? "1", 10); // empty cells kept at the border (on top of the game's own road gap)
const FILL_BG = process.env.FILL_BG !== "0"; // thin solid-colour halo around the subject
const BG_PAD = Math.max(0, parseInt(process.env.BG_PAD ?? "2", 10)); // halo thickness (cells)
// Full-fill mode: the character fills the whole inner area (bg only fills the gaps/
// corners), so it doesn't sit small in the frame. BG_PAD no longer shrinks it.
const IMG_INNER = BOARD_SIZE - 2 * SAFE_MARGIN; // subject max side = fill area
// Drop only the MUDDY mid-tones that dull bright characters (dark-blue 13, dark-green
// 16, plum/maroon 18) so vivid colours stay fresh — but KEEP black 12, greys 9/10,
// brown 11, tan 14, white 8 so penguins / bears / robots keep their true colours.
const DARK_IDS = new Set([13, 16, 18]);
const BRIGHT_IDS = []; for (let i = 0; i < BASE_N; i++) if (!DARK_IDS.has(i)) BRIGHT_IDS.push(i);
const BRIGHT_RGB = BRIGHT_IDS.map((id) => baseRgb[id]);

// ---- verbatim helpers from build-levels.mjs ---------------------------------
const makeRng = (seed) => { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; }; };
const dist2 = (a, b) => { const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]; return dr * dr + dg * dg + db * db; };
function nearestIdx(rgb, list) { let best = 0, bd = Infinity; for (let i = 0; i < list.length; i++) { const d = dist2(rgb, list[i]); if (d < bd) { bd = d; best = i; } } return best; }
function medianCut(samples, K) {
  if (samples.length === 0) return [];
  let boxes = [samples.slice()];
  while (boxes.length < K) {
    let bi = -1, bspread = -1, bch = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]; if (b.length < 2) continue;
      const mn = [255, 255, 255], mx = [0, 0, 0];
      for (const p of b) for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; }
      const sp = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
      const m = Math.max(sp[0], sp[1], sp[2]);
      if (m > bspread) { bspread = m; bi = i; bch = sp.indexOf(m); }
    }
    if (bi < 0) break;
    const box = boxes[bi]; box.sort((a, b) => a[bch] - b[bch]);
    const mid = box.length >> 1;
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.map((b) => { const s = [0, 0, 0]; for (const p of b) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return [s[0] / b.length, s[1] / b.length, s[2] / b.length]; });
}
function kmeans(samples, K, iters) {
  let centers = medianCut(samples, K);
  if (centers.length === 0) return centers;
  for (let it = 0; it < iters; it++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const p of samples) { const j = nearestIdx(p, centers); sums[j][0] += p[0]; sums[j][1] += p[1]; sums[j][2] += p[2]; sums[j][3]++; }
    for (let j = 0; j < centers.length; j++) if (sums[j][3] > 0) centers[j] = [sums[j][0] / sums[j][3], sums[j][1] / sums[j][3], sums[j][2] / sums[j][3]];
  }
  return centers;
}
function backgroundMask(px, alpha, cw, rh, tol) {
  const N = cw * rh, mask = new Array(N).fill(false), TOL2 = (tol || 62) * (tol || 62);
  const corners = [0, cw - 1, (rh - 1) * cw, N - 1];
  const bg = [0, 0, 0];
  for (const c of corners) { bg[0] += px[c][0]; bg[1] += px[c][1]; bg[2] += px[c][2]; }
  bg[0] /= 4; bg[1] /= 4; bg[2] /= 4;
  const isBg = (i) => alpha[i] < 128 || dist2(px[i], bg) < TOL2;
  const q = [];
  const seed = (i) => { if (!mask[i] && isBg(i)) { mask[i] = true; q.push(i); } };
  for (let x = 0; x < cw; x++) { seed(x); seed((rh - 1) * cw + x); }
  for (let y = 0; y < rh; y++) { seed(y * cw); seed(y * cw + cw - 1); }
  while (q.length) {
    const i = q.pop(), x = i % cw, y = (i / cw) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= cw || ny >= rh) continue;
      const ni = ny * cw + nx;
      if (!mask[ni] && isBg(ni)) { mask[ni] = true; q.push(ni); }
    }
  }
  for (let i = 0; i < N; i++) if (alpha[i] < 128) mask[i] = true;
  return mask;
}
function sampleGrid(src, IW, IH, sx, sy, sw, sh, tw, th) {
  const px = new Array(tw * th), alpha = new Array(tw * th);
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const x0 = sx + (sw * tx) / tw, x1 = sx + (sw * (tx + 1)) / tw;
    const y0 = sy + (sh * ty) / th, y1 = sy + (sh * (ty + 1)) / th;
    let ix0 = Math.max(0, Math.floor(x0)), ix1 = Math.min(IW, Math.ceil(x1));
    let iy0 = Math.max(0, Math.floor(y0)), iy1 = Math.min(IH, Math.ceil(y1));
    if (ix1 <= ix0) ix1 = Math.min(IW, ix0 + 1);
    if (iy1 <= iy0) iy1 = Math.min(IH, iy0 + 1);
    let r = 0, g = 0, b = 0, a = 0, cnt = 0;
    for (let yy = iy0; yy < iy1; yy++) for (let xx = ix0; xx < ix1; xx++) {
      const i = (yy * IW + xx) * 4;
      r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; cnt++;
    }
    const j = ty * tw + tx;
    px[j] = [r / cnt, g / cnt, b / cnt]; alpha[j] = a / cnt;
  }
  return { px, alpha };
}
// buildFromImage (non-vivid path: snap subject to K nearest GAME colours) --------
function buildFromImage(src, IW, IH, opts) {
  const { K, maxSide = IMG_INNER } = opts;
  let rx = 0, ry = 0, rw = IW, rhi = IH;
  const LW = 140; let ww, wh;
  if (IW >= IH) { ww = LW; wh = Math.max(2, Math.round(LW * IH / IW)); } else { wh = LW; ww = Math.max(2, Math.round(LW * IW / IH)); }
  const wk = sampleGrid(src, IW, IH, 0, 0, IW, IH, ww, wh);
  const wbg = backgroundMask(wk.px, wk.alpha, ww, wh, 46);
  let minx = ww, miny = wh, maxx = -1, maxy = -1;
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) { const i = y * ww + x; if (!wbg[i] && wk.alpha[i] >= 128) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; } }
  if (maxx >= minx) {
    const padX = Math.round((maxx - minx + 1) * 0.02) + 1, padY = Math.round((maxy - miny + 1) * 0.02) + 1;
    minx = Math.max(0, minx - padX); miny = Math.max(0, miny - padY); maxx = Math.min(ww - 1, maxx + padX); maxy = Math.min(wh - 1, maxy + padY);
    rx = minx / ww * IW; ry = miny / wh * IH; rw = (maxx - minx + 1) / ww * IW; rhi = (maxy - miny + 1) / wh * IH;
  }
  const HS = Math.min(320, Math.max(128, maxSide * 8)); let hw, hh;
  if (rw >= rhi) { hw = HS; hh = Math.max(2, Math.round(HS * rhi / rw)); } else { hh = HS; hw = Math.max(2, Math.round(HS * rw / rhi)); }
  const hi = sampleGrid(src, IW, IH, rx, ry, rw, rhi, hw, hh);
  const hmask = backgroundMask(hi.px, hi.alpha, hw, hh, 46);
  let cw, rh;
  if (rw >= rhi) { cw = maxSide; rh = Math.max(2, Math.round(maxSide * rhi / rw)); } else { rh = maxSide; cw = Math.max(2, Math.round(maxSide * rw / rhi)); }
  cw = Math.min(40, cw); rh = Math.min(40, rh);
  const N = cw * rh; const kind = new Array(N).fill("empty"); const cellCol = new Array(N);
  for (let fy = 0; fy < rh; fy++) for (let fx = 0; fx < cw; fx++) {
    const hx0 = Math.floor(fx * hw / cw), hx1 = Math.max(hx0 + 1, Math.floor((fx + 1) * hw / cw));
    const hy0 = Math.floor(fy * hh / rh), hy1 = Math.max(hy0 + 1, Math.floor((fy + 1) * hh / rh));
    let subN = 0, bgN = 0; const ss = [0, 0, 0];
    for (let hy = hy0; hy < hy1; hy++) for (let hx = hx0; hx < hx1; hx++) {
      const h = hy * hw + hx; if (hi.alpha[h] < 128) continue;
      if (hmask[h]) bgN++; else { subN++; ss[0] += hi.px[h][0]; ss[1] += hi.px[h][1]; ss[2] += hi.px[h][2]; }
    }
    const fi = fy * cw + fx; if (subN + bgN === 0) continue;
    if (subN >= bgN) { kind[fi] = "sub"; cellCol[fi] = [ss[0] / subN, ss[1] / subN, ss[2] / subN]; }
  }
  const fg = []; for (let i = 0; i < N; i++) if (kind[i] === "sub") fg.push(i);
  if (fg.length === 0) return null;
  let board = new Array(N).fill(EMPTY);
  // snap subject to the K most-used BRIGHT game colours (hue-preserving + vivid)
  const cov = new Array(BRIGHT_IDS.length).fill(0);
  for (const i of fg) cov[nearestIdx(cellCol[i], BRIGHT_RGB)]++;
  const pick = BRIGHT_IDS.map((_, i) => i).filter((i) => cov[i] > 0).sort((a, b) => cov[b] - cov[a]).slice(0, K);
  const pickRgb = pick.map((i) => BRIGHT_RGB[i]);
  for (const i of fg) board[i] = BRIGHT_IDS[pick[nearestIdx(cellCol[i], pickRgb)]];
  // center into fixed 25x25 canvas (empty margins)
  const full = new Array(BOARD_SIZE * BOARD_SIZE).fill(EMPTY);
  const ox = Math.floor((BOARD_SIZE - cw) / 2), oy = Math.floor((BOARD_SIZE - rh) / 2);
  for (let y = 0; y < rh; y++) for (let x = 0; x < cw; x++) full[(oy + y) * BOARD_SIZE + (ox + x)] = board[y * cw + x];
  return full;
}

// ---- simple car generation (per-colour split; not the full solvability tuner) --
function generateChests(board, seed) {
  const rng = makeRng(seed);
  const counts = new Map();
  for (const v of board) if (v >= 0) counts.set(v, (counts.get(v) || 0) + 1);
  const chests = [];
  for (const [color, total] of counts) {
    let rem = total;
    while (rem > 0) { const c = Math.min(rem, 8 + Math.floor(rng() * 5)); chests.push({ color, count: c }); rem -= c; }
  }
  return chests;
}

// ---- preview PNG (each cell = its palette colour) ---------------------------
async function boardToPng(board, file) {
  const CELL = 16, W = BOARD_SIZE * CELL;
  const buf = Buffer.alloc(W * W * 4, 0);
  for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) {
    const v = board[r * BOARD_SIZE + c];
    const [rr, gg, bb] = v >= 0 ? baseRgb[v] : [22, 40, 20];
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const px = ((r * CELL + y) * W + (c * CELL + x)) * 4;
      buf[px] = rr; buf[px + 1] = gg; buf[px + 2] = bb; buf[px + 3] = 255;
    }
  }
  await sharp(buf, { raw: { width: W, height: W, channels: 4 } }).png().toFile(file);
}

// ---- main -------------------------------------------------------------------
const { data, info } = await sharp(path.join(ROOT, IMG)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const IW = info.width, IH = info.height;
const cellW = Math.floor(IW / COLS_GRID), cellH = Math.floor(IH / ROWS_GRID);
const col = cellIndex % COLS_GRID, row = Math.floor(cellIndex / COLS_GRID);
const insetX = Math.round(cellW * 0.05);
const insetTop = Math.round(cellH * 0.04);
const insetBot = row === ROWS_GRID - 1 ? Math.round(cellH * 0.2) : Math.round(cellH * 0.04); // drop bottom-row labels
const cx = col * cellW + insetX, cy = row * cellH + insetTop;
const cw = cellW - 2 * insetX, ch = cellH - insetTop - insetBot;

// cellIndex < 0 = WHOLE-IMAGE mode: the picture is ONE single subject (clip-art), not a
// 5×2 sprite sheet, so use the entire image (buildFromImage still bg-removes + crops it).
let cellBuf, cbw, cbh;
if (cellIndex < 0) {
  cellBuf = data; cbw = IW; cbh = IH;
} else {
  cellBuf = await sharp(data, { raw: { width: IW, height: IH, channels: 4 } })
    .extract({ left: cx, top: cy, width: cw, height: ch }).raw().toBuffer();
  cbw = cw; cbh = ch;
}

const board = buildFromImage(cellBuf, cbw, cbh, { K, maxSide: IMG_INNER });
if (!board) { console.error("no subject found in cell"); process.exit(1); }

// Fill the background. AUTO THEME (FEATURES §20 RULE 4): if the subject has a DARK
// OUTLINE (its perimeter cells are mostly dark) it would vanish on the dark board → use
// a LIGHT bg + lightBoard so the outline pops; otherwise dark-neutral id 12 (bright
// subject floats on the dark board). Override: BG_ID=<id> forces one (dark theme);
// BG_ID=bright = legacy light-board auto-contrast.
let levelLightBoard = false;
if (FILL_BG) {
  const subCells = board.filter((v) => v >= 0);
  const used = [...new Set(subCells)];
  const usedRgb = used.map((id) => baseRgb[id]);
  const lum = (id) => { const c = baseRgb[id]; return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; };
  const mostDistinct = (cands) => { let best = cands[0], bd = -1; for (const id of cands) { let mn = Infinity; for (const c of usedRgb) { const d = dist2(baseRgb[id], c); if (d < mn) mn = d; } if (mn > bd) { bd = mn; best = id; } } return best; };
  let bgId = 12; // dark neutral default
  const BG_ID = process.env.BG_ID;
  if (BG_ID != null && BG_ID !== "bright") {
    bgId = parseInt(BG_ID, 10);
  } else if (BG_ID === "bright") {
    bgId = mostDistinct(BRIGHT_IDS.filter((id) => id !== 8 && id !== 14 && !used.includes(id)));
    levelLightBoard = true;
  } else {
    // detect dark outline: perimeter subject cells that are dark
    let perim = 0, dark = 0;
    for (let i = 0; i < board.length; i++) {
      if (board[i] < 0) continue;
      const r = (i / BOARD_SIZE) | 0, c = i % BOARD_SIZE;
      const edge = r === 0 || c === 0 || r === BOARD_SIZE - 1 || c === BOARD_SIZE - 1 ||
        board[i - 1] < 0 || board[i + 1] < 0 || board[i - BOARD_SIZE] < 0 || board[i + BOARD_SIZE] < 0;
      if (!edge) continue;
      perim++; if (lum(board[i]) < 95) dark++;
    }
    if (perim > 0 && dark / perim >= 0.45) {
      const LIGHT = [8, 9, 14, 15, 17].filter((id) => !used.includes(id));
      bgId = LIGHT.length ? mostDistinct(LIGHT) : 8;
      levelLightBoard = true;
      console.log(`dark outline detected (${Math.round(100 * dark / perim)}% perimeter) → light bg id ${bgId} + lightBoard`);
    }
  }
  // RULE VIỀN CHỐT (border.mjs): viền = CHỮ NHẬT bbox+1 đổ đầy (không halo, không thu
  // nhỏ chủ thể); tổng viền ≤30% board — vượt = ảnh KHÔNG ĐẠT (exit 2, caller đổi ảnh
  // gọn hơn); màu viền cấm trùng màu chủ thể SÁT ranh (8 hướng). bgId ở trên chỉ còn là
  // màu ƯU TIÊN đầu — adjacency ban vẫn thắng.
  const prefer = [bgId, ...(levelLightBoard ? PREFER_LIGHT : PREFER_DARK).filter((c) => c !== bgId)];
  const bres = applyBoxBorder(board, BOARD_SIZE, BOARD_SIZE, { margin: SAFE_MARGIN, prefer });
  if (!bres.ok) {
    console.error(`✗ viền ${bres.cells} ô = ${bres.pct}% board > 30% — ảnh KHÔNG ĐẠT rule viền (chọn ảnh chủ thể đặc/gọn hơn; KHÔNG thu nhỏ chủ thể)`);
    process.exit(2);
  }
  console.log(`viền chữ nhật id ${bres.fillColor}, ${bres.cells} ô = ${bres.pct}% board`);
}

const chests = generateChests(board, levelNum * 977 + 13);

const slimes = board.filter((v) => v >= 0).length;
const colors = new Set(board.filter((v) => v >= 0)).size;
console.log(`cell ${cellIndex} -> L${levelNum}: ${slimes} slimes, ${colors} colours, ${chests.length} cars`);

// patch designed.json (keep every other level)
const designed = JSON.parse(fs.readFileSync(OUT, "utf8"));
designed[levelNum] = { track: "square", cols: BOARD_SIZE, rows: BOARD_SIZE, board, chests };
if (levelLightBoard) designed[levelNum].lightBoard = true; // dark-outlined subject → light board (RULE 4)
const sorted = {};
for (const k of Object.keys(designed).map(Number).sort((a, b) => a - b)) sorted[k] = designed[k];
fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2));
console.log(`✔ wrote L${levelNum} into ${path.relative(ROOT, OUT)}`);

const prev = path.join(ROOT, "scripts/_level-preview", `one-L${levelNum}.png`);
fs.mkdirSync(path.dirname(prev), { recursive: true });
await boardToPng(board, prev);
console.log(`preview -> ${path.relative(ROOT, prev)}`);
