// ============================================================================
// ►► VISUAL RULES: the game board is DARK navy now. Picture-level backgrounds must
//    NOT be a dull light-grey fill. This builder defaults the bg to dark-neutral
//    id 12 so subjects pop. Read FEATURES.txt §20 before changing bg/theme logic.
// ============================================================================
// Batch level builder — ports tools/level-editor.html's image→board pipeline
// (buildFromImage + generateNCars) to Node/sharp so we can auto-generate the
// first few dozen levels from a folder of flat clip-art images.
//
//   node scripts/build-levels.mjs           → build + write designed.json + previews
//   node scripts/build-levels.mjs --dry     → build + previews only (no write)
//
// Rules (from the user, 2026-07-22):
//  • every 5th level = HARD, every 15th = SUPER-HARD (matches game's tiers)
//  • HARD = 8 colours, SUPER-HARD = 12 colours; images from  .../hard
//  • EASY  = ≤5 colours + VIVID ("màu tươi");  images from  .../easylevel
//  • L1 super-easy 2 colours · L2 3 · L3 3 · L4 4 · L5 hard-but-early → 5 colours
//  • EASY ≤10 cars;  HARD/SUPER more cars + messier order
//  • HARD/SUPER: sprinkle a few outside colours; bias tracks to U / straight
//  • tracks: L1 line · L2,L3 U · square + "2-line"(rect) only from L11
//  • ARCH (U-ngược) is PAUSED — never used.
// ============================================================================
import sharp from "sharp";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const EASY_DIR = path.join(ROOT, "public/art/level art/easylevel");
const HARD_DIR = path.join(ROOT, "public/art/level art/hard");
const OUT = path.join(ROOT, "src/levels/designed.json");
const PREVIEW_DIR = process.env.PREVIEW_DIR ||
  path.join(ROOT, "scripts/_level-preview");
const DRY = process.argv.includes("--dry");
// The shipped game is MANUAL (AUTO_CIRCLE disabled 2026-07-25 — auto-drive made difficulty
// binary/untunable), so the win-rate tester models manual play by DEFAULT. Set AUTODRIVE=1
// to measure the auto-drive variant. See playAverage()'s autoDrive branch.
const AUTO_DRIVE = process.env.AUTODRIVE === "1";
const N_LEVELS = 330; // …+ 15 rock-wall L301-315 + 15 no-wall 25×25 same-target L316-330 (user 2026-07-26)
// KID pack L200-300 (user 2026-07-24): easy levels for the user's child. The L2..L8
// difficulty cycle repeats (targets/skill from the CSV), subjects at max size, borders
// only in cool greens/blues (dịu mắt), twins everywhere + a triple every 10th level,
// occasional THIN 2-layer / hidden-"?" sprinkles. Always tier-"normal".
// HARD colour cap (user 2026-07-25): a board may NEVER exceed 12 distinct colours —
// more reads as visual noise. Config values above 12 are clamped here.
const MAX_COLORS = 12;
const KID_LO = 200, KID_HI = 300;
const isKid = (n) => n >= KID_LO && n <= KID_HI;
const COOL_IDS = [3, 4, 5, 15]; // green, teal, blue, light-blue — kid border palette
// --seedoff K: alternate deterministic seed family (used by the seed-sweep tuner to
// hunt a burial order whose win-rate lands in band on chaotic high-skill levels).
const SEED_OFF = (() => { const i = process.argv.indexOf("--seedoff"); return i >= 0 ? (parseInt(process.argv[i + 1], 10) || 0) : 0; })();

// ---- palette (must match src/game/palette.ts & editor BASE_COLORS) ----------
const BASE_HEX = [
  "#fe4038", "#fe8f28", "#fed734", "#37cb5c", "#2ac0cc", "#408afa", "#9756fd",
  "#fd55a5", "#ffffff", "#cbcbcb", "#4a4a4a", "#985828", "#262630", "#3050a0",
  "#e0b888", "#98d0f0", "#208038", "#f8c0c8", "#902030",
];
const hexToRgb = (h) => { h = h.replace("#", ""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
const baseRgb = BASE_HEX.map(hexToRgb);
const BASE_N = BASE_HEX.length;
const EMPTY = -1;
// BOARDSIZE= env overrides the grid size for a --only rebuild (default 25). The game
// auto-shrinks cells for boards >25 (GameScene STD=max(25,cols,rows)), so a single level
// can be bigger. Other levels keep their own cols/rows in designed.json.
// 2026-07-25: BOARD_SIZE is now MUTABLE — the main loop sets it per level from the
// CSV's "kích thước" column (picture-recipe levels), restoring DEFAULT_BOARD otherwise.
let BOARD_SIZE = Number(process.env.BOARDSIZE) || 25;
const DEFAULT_BOARD = BOARD_SIZE, IMG_INNER = BOARD_SIZE;
// Queue LINES ("3 line / 5 line xếp hàng", user 2026-07-25, from the reference game):
// how many vertical columns the chest inventory splits into — only column FRONTS are
// playable, so fewer lines = fewer choices per turn = harder. MUTABLE like BOARD_SIZE:
// the main loop sets it per level from the CSV "line" column (default 4, the game's
// classic layout); --report/--test1 pick each level's own `lanes` from designed.json.
// LANES= env overrides for a --only rebuild. All sim helpers default perRow to this.
const DEFAULT_LANES = 4;
let LANES = Number(process.env.LANES) || DEFAULT_LANES;
// "màu tươi": avoid the dark ids that read too dark — black 12, maroon/plum 18, dark
// grey 10, brown 11, dark blue 13, dark green 16, grey 9 (user 2026-07-24). All new
// colours (ensureColors, borders, vivid mapping) draw from BRIGHT only.
const DARK_IDS = new Set([9, 10, 11, 12, 13, 16, 18]);
const BRIGHT_IDS = []; for (let i = 0; i < BASE_N; i++) if (!DARK_IDS.has(i)) BRIGHT_IDS.push(i); // 0,1,2,3,4,5,6,7,8,14,15,17
// Leave an empty frame margin so slime never touches the road (user 2026-07-24).
const FILL_INSET = 2;
const SUBJECT_SIDE = BOARD_SIZE - 2 * FILL_INSET; // 21 — subject + fill stay inside this

// ---- deterministic RNG ------------------------------------------------------
function makeRng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; }; }

// ---- colour maths (verbatim from the editor) --------------------------------
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
    const box = boxes[bi];
    box.sort((a, b) => a[bch] - b[bch]);
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

// ---- background flood (corner-colour match, verbatim logic) -----------------
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

// ---- sampleGrid: area-average a source rect into a tw×th grid ----------------
// Replaces the editor's canvas drawImage; `src` is a preloaded raw RGBA buffer.
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

// ---- the port of buildFromImage --------------------------------------------
// opts: { mode:'game', vivid:bool, K:int }   (bgOpt fixed 'bo', autoCrop true)
function buildFromImage(src, IW, IH, opts) {
  const { mode, vivid, K, maxSide = IMG_INNER } = opts;
  const bgOpt = "bo";

  // crop to subject bbox (hi-res working pass)
  let rx = 0, ry = 0, rw = IW, rhi = IH;
  const LW = 140;
  let ww, wh;
  if (IW >= IH) { ww = LW; wh = Math.max(2, Math.round(LW * IH / IW)); }
  else { wh = LW; ww = Math.max(2, Math.round(LW * IW / IH)); }
  const wk = sampleGrid(src, IW, IH, 0, 0, IW, IH, ww, wh);
  const wbg = backgroundMask(wk.px, wk.alpha, ww, wh, 46);
  let minx = ww, miny = wh, maxx = -1, maxy = -1;
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
    const i = y * ww + x;
    if (!wbg[i] && wk.alpha[i] >= 128) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  }
  if (maxx >= minx) {
    const padX = Math.round((maxx - minx + 1) * 0.02) + 1, padY = Math.round((maxy - miny + 1) * 0.02) + 1;
    minx = Math.max(0, minx - padX); miny = Math.max(0, miny - padY);
    maxx = Math.min(ww - 1, maxx + padX); maxy = Math.min(wh - 1, maxy + padY);
    rx = minx / ww * IW; ry = miny / wh * IH; rw = (maxx - minx + 1) / ww * IW; rhi = (maxy - miny + 1) / wh * IH;
  }

  // segment the crop at high resolution
  const HS = Math.min(320, Math.max(128, maxSide * 8));
  let hw, hh;
  if (rw >= rhi) { hw = HS; hh = Math.max(2, Math.round(HS * rhi / rw)); }
  else { hh = HS; hw = Math.max(2, Math.round(HS * rw / rhi)); }
  const hi = sampleGrid(src, IW, IH, rx, ry, rw, rhi, hw, hh);
  const hmask = backgroundMask(hi.px, hi.alpha, hw, hh, 46);

  // final grid from crop aspect
  let cw, rh;
  if (rw >= rhi) { cw = maxSide; rh = Math.max(2, Math.round(maxSide * rhi / rw)); }
  else { rh = maxSide; cw = Math.max(2, Math.round(maxSide * rw / rhi)); }
  cw = Math.min(40, cw); rh = Math.min(40, rh);

  const N = cw * rh;
  const kind = new Array(N).fill("empty");
  const cellCol = new Array(N);
  for (let fy = 0; fy < rh; fy++) for (let fx = 0; fx < cw; fx++) {
    const hx0 = Math.floor(fx * hw / cw), hx1 = Math.max(hx0 + 1, Math.floor((fx + 1) * hw / cw));
    const hy0 = Math.floor(fy * hh / rh), hy1 = Math.max(hy0 + 1, Math.floor((fy + 1) * hh / rh));
    let subN = 0, bgN = 0; const ss = [0, 0, 0], bs = [0, 0, 0];
    for (let hy = hy0; hy < hy1; hy++) for (let hx = hx0; hx < hx1; hx++) {
      const h = hy * hw + hx;
      if (hi.alpha[h] < 128) continue;
      if (hmask[h]) { bgN++; bs[0] += hi.px[h][0]; bs[1] += hi.px[h][1]; bs[2] += hi.px[h][2]; }
      else { subN++; ss[0] += hi.px[h][0]; ss[1] += hi.px[h][1]; ss[2] += hi.px[h][2]; }
    }
    const fi = fy * cw + fx;
    if (subN + bgN === 0) continue;
    if (subN >= bgN) { kind[fi] = "sub"; cellCol[fi] = [ss[0] / subN, ss[1] / subN, ss[2] / subN]; }
    // bgOpt 'bo' → background cell stays EMPTY
  }

  const fg = [];
  for (let i = 0; i < N; i++) if (kind[i] === "sub") fg.push(i);
  if (fg.length === 0) return null;

  let board = new Array(N).fill(EMPTY);

  if (mode === "game" && vivid) {
    const VIVID = [0, 1, 2, 3, 4, 5, 6, 7, 15, 17].filter((id) => id < BASE_N); // bright, no dark
    const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    const vSorted = VIVID.slice().sort((a, b) => lum(baseRgb[b]) - lum(baseRgb[a]));
    let centers = kmeans(fg.map((i) => cellCol[i]), K, 10);
    const used = new Array(centers.length).fill(0);
    for (const i of fg) used[nearestIdx(cellCol[i], centers)]++;
    centers = centers.filter((_, j) => used[j] > 0);
    const M = centers.length;
    const order = centers.map((c, j) => j).sort((a, b) => lum(centers[b]) - lum(centers[a]));
    const clusterId = new Array(M);
    order.forEach((j, rank) => {
      const vi = M <= 1 ? 0 : Math.round(rank * (vSorted.length - 1) / (M - 1));
      clusterId[j] = vSorted[vi];
    });
    for (const i of fg) board[i] = clusterId[nearestIdx(cellCol[i], centers)];
  } else {
    // snap subject to the K most-representative GAME colours
    const cov = new Array(BASE_N).fill(0);
    for (const i of fg) cov[nearestIdx(cellCol[i], baseRgb)]++;
    const chosen = baseRgb.map((_, i) => i).filter((i) => cov[i] > 0).sort((a, b) => cov[b] - cov[a]).slice(0, K);
    const chosenRgb = chosen.map((id) => baseRgb[id]);
    for (const i of fg) board[i] = chosen[nearestIdx(cellCol[i], chosenRgb)];
  }

  // center the sub-grid into the fixed 25×25 canvas (bo → margins stay empty)
  const sub = board, sw = cw, sh = rh;
  const full = new Array(BOARD_SIZE * BOARD_SIZE).fill(EMPTY);
  const ox = Math.floor((BOARD_SIZE - sw) / 2), oy = Math.floor((BOARD_SIZE - sh) / 2);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) full[(oy + y) * BOARD_SIZE + (ox + x)] = sub[y * sw + x];
  return full;
}

// ---- PICTURE recipe (features.txt mục 13, user 2026-07-25) -------------------
// True-colour mosaic: crop subject, snap to the K most-used colours of the PIC
// palette (19 minus muddy 13/16/18 — KEEPS black/white/grey/brown so a penguin is
// black and a bear is brown), then FULL-FILL the inner square with ONE bright bg
// colour that contrasts every subject colour. 1-cell empty margin all around.
// Uses the CURRENT (per-level) BOARD_SIZE. Colours total = Ksub + 1 bg ≤ MAX_COLORS.
const PIC_DARK = new Set([13, 16, 18]);
const PIC_IDS = []; for (let i = 0; i < BASE_N; i++) if (!PIC_DARK.has(i)) PIC_IDS.push(i);
const PIC_RGB = PIC_IDS.map((id) => baseRgb[id]);
const PIC_MARGIN = 1; // empty cells at the border (SAFE_MARGIN in build-one.mjs)

// Set by buildPicture → read at level assembly to attach `lightBoard` to the level.
let _picLightBoard = false;

// AUTO board theme for a picture (FEATURES §20 RULE 4). `board` has subject cells (>=0)
// and EMPTY (-1) elsewhere (bg not yet filled). If the subject's PERIMETER (cells that
// touch the bg / grid edge) is mostly DARK, its outline would disappear on the dark
// board → return a LIGHT bg + lightBoard so the outline pops. Otherwise dark bg (id 12).
// PIC_BG env still overrides: PIC_BG=<id> forces an id (dark theme), PIC_BG=bright = the
// legacy light-board auto-contrast.
const _lum = (id) => { const c = baseRgb[id]; return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; };
const DARK_LUM = 95; // below this a tile reads as "dark" (id 12/10/13/18…)
// Board mat is ALWAYS dark caro now (user rule 2026-07-26). The picture BACKGROUND
// FILL is a BRIGHT panel colour — sky-blue by default — chosen distinct from every
// subject colour so it never merges with it and the subject (even a dark one) pops on
// a light panel instead of vanishing into the dark board. `lightBoard` is never set.
// Bright bg preference: sky-blue first, then other clearly-bright hues (no dark ids).
const BRIGHT_BG_PREF = [15, 4, 5, 17, 2, 1, 3, 7, 8, 6, 0, 14];
function choosePictureTheme(board, size) {
  const used = new Set(board.filter((v) => v >= 0));
  const PIC_BG = process.env.PIC_BG;
  if (PIC_BG != null) return { bgId: parseInt(PIC_BG, 10), lightBoard: false }; // manual override
  let bgId = BRIGHT_BG_PREF.find((id) => !used.has(id));
  if (bgId == null) bgId = 15; // subject somehow uses every bright hue
  return { bgId, lightBoard: false };
}

function buildPicture(src, IW, IH, K) {
  _picLightBoard = false;
  const maxSide = BOARD_SIZE - 2 * PIC_MARGIN;
  // crop to subject bbox (same working pass as buildFromImage)
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
  // segment at high res, then sample to the final sub-grid
  const HS = Math.min(320, Math.max(128, maxSide * 8)); let hw, hh;
  if (rw >= rhi) { hw = HS; hh = Math.max(2, Math.round(HS * rhi / rw)); } else { hh = HS; hw = Math.max(2, Math.round(HS * rw / rhi)); }
  const hi = sampleGrid(src, IW, IH, rx, ry, rw, rhi, hw, hh);
  const hmask = backgroundMask(hi.px, hi.alpha, hw, hh, 46);
  let cw, rh;
  if (rw >= rhi) { cw = maxSide; rh = Math.max(2, Math.round(maxSide * rhi / rw)); } else { rh = maxSide; cw = Math.max(2, Math.round(maxSide * rw / rhi)); }
  const N = cw * rh, kind = new Array(N).fill("empty"), cellCol = new Array(N);
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
  // snap subject to the K most-used PIC colours (true-colour: black/brown/white kept)
  const cov = new Array(PIC_IDS.length).fill(0);
  for (const i of fg) cov[nearestIdx(cellCol[i], PIC_RGB)]++;
  const pickIds = PIC_IDS.map((_, i) => i).filter((i) => cov[i] > 0).sort((a, b) => cov[b] - cov[a]).slice(0, Math.max(2, K));
  const pickRgb = pickIds.map((i) => PIC_RGB[i]);
  const sub = new Array(N).fill(EMPTY);
  for (const i of fg) sub[i] = PIC_IDS[pickIds[nearestIdx(cellCol[i], pickRgb)]];
  // centre into the BOARD_SIZE canvas
  const full = new Array(BOARD_SIZE * BOARD_SIZE).fill(EMPTY);
  const ox = Math.floor((BOARD_SIZE - cw) / 2), oy = Math.floor((BOARD_SIZE - rh) / 2);
  for (let y = 0; y < rh; y++) for (let x = 0; x < cw; x++) full[(oy + y) * BOARD_SIZE + (ox + x)] = sub[y * cw + x];
  // AUTO THEME (FEATURES §20 RULE 4): does the subject have a DARK OUTLINE? Look at the
  // subject's perimeter cells (those touching the bg/edge) — if most are dark, they'd
  // vanish on a dark board, so switch to a LIGHT bg + lightBoard so the outline pops.
  // A bright/light-edged subject keeps the dark bg (id 12) + dark board (float look).
  const { bgId, lightBoard } = choosePictureTheme(full, BOARD_SIZE);
  _picLightBoard = lightBoard;
  const lo = PIC_MARGIN, hi2 = BOARD_SIZE - 1 - PIC_MARGIN;
  for (let r = lo; r <= hi2; r++) for (let c = lo; c <= hi2; c++) {
    const i = r * BOARD_SIZE + c; if (full[i] === EMPTY) full[i] = bgId;
  }
  return full;
}

// ---- sprinkle a few outside colours (HARD/SUPER "vài màu bên ngoài") --------
function mixExtraColors(board, seed, frac) {
  const rng = makeRng(seed);
  const present = new Set(board.filter((v) => v >= 0));
  const candidates = [];
  for (let id = 0; id < BASE_N; id++) if (!present.has(id)) candidates.push(id);
  if (candidates.length === 0) return;
  const chosen = [];
  const nPick = Math.min(3, 1 + Math.floor(rng() * 3));
  for (let k = 0; k < nPick && candidates.length; k++) chosen.push(candidates.splice(Math.floor(rng() * candidates.length), 1)[0]);
  const idxs = [];
  for (let i = 0; i < board.length; i++) if (board[i] >= 0) idxs.push(i);
  const nChange = Math.max(1, Math.round(idxs.length * frac));
  for (let k = 0; k < nChange; k++) board[idxs[Math.floor(rng() * idxs.length)]] = chosen[Math.floor(rng() * chosen.length)];
}

// ---- difficulty ordering: bury outer-layer colours deeper -------------------
// A car only reaches tiles exposed to an edge the ROAD covers, and peeling is
// outside-in along those edges. We compute each colour's "outerness" (peel
// layer, 0 = outermost / reachable first) and push outer-colour cars deeper
// into the queue for harder levels — then simulate a 5-bay player to guarantee
// the level stays solvable, backing the burial off if it doesn't.
function trackEdges(track) {
  if (track === "line") return { L: false, R: false, T: false, B: true };
  if (track === "u") return { L: true, R: true, T: false, B: true };   // ∪ open top
  if (track === "arch") return { L: true, R: true, T: true, B: false }; // ⊓ open bottom
  return { L: true, R: true, T: true, B: true };                        // square / rect
}
// Ray directions a car fires INTO the grid — matches findLosTargets(): from each
// road edge, a straight ray plus the two 45° diagonals.
function raysFor(edges) {
  const dirs = [];
  const add = (dr, dc) => { if (!dirs.some((d) => d[0] === dr && d[1] === dc)) dirs.push([dr, dc]); };
  if (edges.B) { add(-1, 0); add(-1, -1); add(-1, 1); } // bottom shoots up
  if (edges.T) { add(1, 0); add(1, -1); add(1, 1); }    // top shoots down
  if (edges.L) { add(0, 1); add(-1, 1); add(1, 1); }    // left shoots right
  if (edges.R) { add(0, -1); add(-1, -1); add(1, -1); } // right shoots left
  return dirs;
}
// Tiles collectable NOW: first occupied cell along ANY straight-or-diagonal ray
// from a covered edge (a car of that colour can grab it this pass).
function exposedTiles(occ, cols, rows, edges) {
  const S = new Set();
  for (const [dr, dc] of raysFor(edges)) {
    const reach = new Uint8Array(cols * rows);
    // walk each ray line from the edge inward → process "behind" cell first
    for (let ri = 0; ri < rows; ri++) {
      const r = dr < 0 ? rows - 1 - ri : ri;
      for (let ci = 0; ci < cols; ci++) {
        const c = dc < 0 ? cols - 1 - ci : ci;
        const i = r * cols + c, br = r - dr, bc = c - dc;
        let rc;
        if (br < 0 || br >= rows || bc < 0 || bc >= cols) rc = 1;      // ray enters from the edge here
        else { const bi = br * cols + bc; rc = occ[bi] < 0 ? reach[bi] : 0; } // blocked by an occupied cell
        reach[i] = rc;
        if (rc && isColor(occ[i])) S.add(i); // first COLLECTABLE cell along this ray → exposed (a rock still blocks the ray via reach[] but is never a target)
      }
    }
  }
  return S;
}
// peel the board layer by layer under the track's reachability → layer per tile
function peelLayers(board, cols, rows, edges) {
  const occ = board.slice();
  const layer = new Array(board.length).fill(-1);
  let L = 0, remaining = occ.reduce((a, v) => a + (isColor(v) ? 1 : 0), 0), guard = 0;
  while (remaining > 0 && guard++ < board.length + 5) {
    const E = exposedTiles(occ, cols, rows, edges);
    if (E.size === 0) break;
    for (const i of E) { layer[i] = L; occ[i] = -1; remaining--; }
    L++;
  }
  for (let i = 0; i < occ.length; i++) if (occ[i] >= 0) layer[i] = L; // unreachable → deepest
  return layer;
}
function colorOuterness(board, layer) {
  const sum = new Map(), cnt = new Map();
  for (let i = 0; i < board.length; i++) {
    const v = board[i]; if (!isColor(v)) continue; // skip obstacles (rock walls)
    sum.set(v, (sum.get(v) || 0) + layer[i]); cnt.set(v, (cnt.get(v) || 0) + 1);
  }
  const out = new Map();
  for (const [c, s] of sum) out.set(c, s / cnt.get(c));
  return out;
}
// Greedy 5-bay player. Conservative: straight rays only, one collecting pass per
// launch on open tracks (line/u/arch), full peel on loop tracks (square/rect).
function solvable(board, cols, rows, order, track, bays = 5, perRow = LANES, layer2 = null) {
  const edges = trackEdges(track);
  const singlePass = track === "line" || track === "u" || track === "arch";
  const occ = board.slice();
  const lay = layer2 ? layer2.slice() : null; // 2-layer bottoms revealed on collect
  let remaining = occ.reduce((a, v) => a + (isColor(v) ? 1 : 0), 0) + (lay ? lay.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0) : 0);
  const clearCell = (i) => { if (lay && lay[i] >= 0) { occ[i] = lay[i]; lay[i] = -1; } else occ[i] = -1; remaining--; };
  const columns = Array.from({ length: perRow }, () => []);
  order.forEach((c, i) => columns[i % perRow].push({ color: c.color, cap: c.count }));
  const parked = [];
  const collect = (car) => {
    if (singlePass) {
      const E = exposedTiles(occ, cols, rows, edges);
      for (const i of E) { if (car.cap <= 0) break; if (occ[i] === car.color) { clearCell(i); car.cap--; } }
    } else {
      while (car.cap > 0) {
        const E = exposedTiles(occ, cols, rows, edges);
        let t = -1; for (const i of E) if (occ[i] === car.color) { t = i; break; }
        if (t < 0) break;
        clearCell(t); car.cap--;
      }
    }
  };
  let guard = 0;
  while (remaining > 0 && guard++ < order.length * 4 + 50) {
    const E = exposedTiles(occ, cols, rows, edges);
    const S = new Set(); for (const i of E) S.add(occ[i]);
    let car = null, place = null;
    for (const p of parked) if (S.has(p.color)) { car = p; place = "park"; break; }
    if (!car) for (let j = 0; j < perRow; j++) { const f = columns[j][0]; if (f && S.has(f.color)) { car = f; place = j; break; } }
    if (car) {
      collect(car);
      if (place === "park") { if (car.cap === 0) parked.splice(parked.indexOf(car), 1); }
      else { columns[place].shift(); if (car.cap > 0 && parked.length < bays) parked.push(car); }
      continue;
    }
    const fronts = [];
    for (let j = 0; j < perRow; j++) if (columns[j][0]) fronts.push(j);
    if (fronts.length === 0) return false;   // out of cars, tiles remain
    if (parked.length >= bays) return false; // bays full → stuck
    fronts.sort((a, b) => columns[b].length - columns[a].length);
    parked.push(columns[fronts[0]].shift());
  }
  return remaining === 0;
}
// ---- xe đôi (paired cars) ---------------------------------------------------
// A pair = two chests (different colours, different columns) that launch TOGETHER
// and only when BOTH are reachable (both column-fronts, or both parked). Stored
// as level.pairs = [[i,j],…] indexing into chests. Backward-compatible: a game
// that ignores `pairs` just sees two normal cars, so the level still solves.
// Perfect-player solver that respects the pair constraint (for the safety check).
// `groups` = array of index-arrays (each ≥2 members) that launch/park/leave together
// (2=twin, 3=triple, …). A greedy perfect-solver used to validate a level is winnable.
function solvablePairs(board, cols, rows, order, track, groups, bays = 5, perRow = LANES, layer2 = null) {
  const edges = trackEdges(track);
  const singlePass = track === "line" || track === "u" || track === "arch";
  const occ = board.slice();
  const lay = layer2 ? layer2.slice() : null; // 2-layer bottoms revealed on collect
  let remaining = occ.reduce((a, v) => a + (isColor(v) ? 1 : 0), 0) + (lay ? lay.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0) : 0);
  const clearCell = (i) => { if (lay && lay[i] >= 0) { occ[i] = lay[i]; lay[i] = -1; } else occ[i] = -1; remaining--; };
  const cars = order.map((c) => ({ color: c.color, cap: c.count, grouped: false }));
  const groupCars = (groups || []).map((idxs) => { const g = idxs.map((i) => cars[i]); g.forEach((c) => (c.grouped = true)); return g; });
  const columns = Array.from({ length: perRow }, () => []);
  cars.forEach((c, i) => columns[i % perRow].push(c));
  const parked = [];
  const collect = (car) => {
    if (singlePass) { const E = exposedTiles(occ, cols, rows, edges); for (const i of E) { if (car.cap <= 0) break; if (occ[i] === car.color) { clearCell(i); car.cap--; } } }
    else { while (car.cap > 0) { const E = exposedTiles(occ, cols, rows, edges); let t = -1; for (const i of E) if (occ[i] === car.color) { t = i; break; } if (t < 0) break; clearCell(t); car.cap--; } }
  };
  const isFront = (c) => columns.some((col) => col[0] === c);
  // A linked group is launchable when every member is either parked or has NO non-member
  // ahead of it in its column — so a same-column STACKED pair (front-prefix) launches as a
  // unit, matching the game (user 2026-07-27: xe đôi thẳng hàng chôn sâu được).
  const groupReady = (g) => g.every((c) => {
    if (parked.includes(c)) return true;
    for (const col of columns) { const k = col.indexOf(c); if (k >= 0) return col.slice(0, k).every((x) => g.includes(x)); }
    return false;
  });
  const removeCar = (c) => { for (const col of columns) { const k = col.indexOf(c); if (k >= 0) { col.splice(k, 1); return; } } const p = parked.indexOf(c); if (p >= 0) parked.splice(p, 1); };
  const TR = process.env.DEBUG_SOLVE && (groups || []).length > 0 && !globalThis.__traced; // trace ONE grouped solve
  if (TR) globalThis.__traced = true;
  let guard = 0;
  while (remaining > 0 && guard++ < order.length * 6 + 100) {
    const E = exposedTiles(occ, cols, rows, edges);
    const S = new Set(); for (const i of E) S.add(occ[i]);
    if (TR && guard < 80) console.error(`t${guard} rem${remaining} bay${parked.length} S=[${[...S].join(",")}] fronts=[${columns.map((c) => c[0] ? c[0].color + (c[0].grouped ? "G" : "") + ":" + c[0].cap : "-").join(" ")}]`);
    let moved = false;
    // 1) a productive READY group FIRST (all members fronts/parked) — groups must eat
    // before same-colour solo cars steal their tiles (capacities are exact; a starved
    // group would squat in the bays forever and wedge the level).
    for (const g of groupCars) {
      if (g.every((c) => c.cap === 0)) continue;
      if (!groupReady(g)) continue;
      if (!g.some((c) => c.cap > 0 && S.has(c.color))) continue; // a member that can STILL eat
      const own = g.filter((c) => parked.includes(c)).length;
      if (parked.length - own > bays - g.length) continue; // not enough bays to park the group
      for (const c of g) removeCar(c);
      for (const c of g) collect(c);
      if (!g.every((c) => c.cap === 0)) for (const c of g) parked.push(c); // park together
      moved = true; break;
    }
    if (moved) continue;
    // 2) a productive solo (ungrouped) car (parked first, then column fronts)
    const singles = [...parked.filter((c) => !c.grouped), ...columns.map((c) => c[0]).filter((c) => c && !c.grouped)];
    for (const c of singles) if (S.has(c.color)) {
      const wasParked = parked.includes(c);
      collect(c);
      if (c.cap === 0) removeCar(c); else if (!wasParked) { removeCar(c); if (parked.length < bays) parked.push(c); }
      moved = true; break;
    }
    if (moved) continue;
    // 3) park an ungrouped front to reveal deeper (grouped cars can't park alone)
    const np = [];
    for (let j = 0; j < perRow; j++) { const f = columns[j][0]; if (f && !f.grouped) np.push(j); }
    if (np.length && parked.length < bays) {
      np.sort((a, b) => columns[b].length - columns[a].length);
      parked.push(columns[np[0]].shift());
      continue;
    }
    // 4) last resort: launch a READY group into the bays even though it's not
    // productive yet (the real game allows this — it unblocks the group's columns).
    let sent = false;
    for (const g of groupCars) {
      if (g.every((c) => c.cap === 0)) continue;
      if (!groupReady(g)) continue; // all still in the queue, launchable as a unit
      if (parked.length > bays - g.length) continue;
      for (const c of g) removeCar(c);
      for (const c of g) collect(c); // may collect nothing — that's fine
      if (!g.every((c) => c.cap === 0)) for (const c of g) parked.push(c);
      sent = true; break;
    }
    if (!sent) { if (TR) console.error(`tFAIL guard${guard} rem${remaining} bay${parked.length} parked=[${parked.map((c) => c.color + (c.grouped ? "G" : "") + ":" + c.cap).join(" ")}]`); return false; }
  }
  return remaining === 0;
}
// Group candidates must be CONSECUTIVE chests in the SAME inventory row (so they land
// in adjacent columns — what the game's linked-car rendering expects). Places `triples`
// (3 adjacent cols) first, then `pairs` (2 adjacent cols) in the remaining slots. Each
// group needs all-different colours and must keep the level solvable.
function pickGroups(order, board, track, pairs, triples, perRow = LANES, layer2 = null) {
  const groups = [];
  const used = new Set();
  const sameRow = (...idx) => idx.every((i) => Math.floor(i / perRow) === Math.floor(idx[0] / perRow));
  // The burial order tends to place SAME-colour cars adjacent, which would forbid
  // every group. Fix a slot by SWAPPING in a later different-colour car (mutates
  // `order` — the caller measures the swapped order, so difficulty stays honest).
  const distinctify = (idx) => {
    for (let k = 1; k < idx.length; k++) {
      const seen = new Set(idx.slice(0, k).map((i) => order[i].color));
      if (!seen.has(order[idx[k]].color)) continue;
      let done = false;
      for (let j = idx[idx.length - 1] + 1; j < order.length && !done; j++) {
        if (used.has(j) || seen.has(order[j].color)) continue;
        [order[idx[k]], order[j]] = [order[j], order[idx[k]]];
        done = true;
      }
      if (!done) return false;
    }
    return new Set(idx.map((i) => order[i].color)).size === idx.length;
  };
  // Scan FRONT-first (user 2026-07-25: "xe đôi/ba xuất hiện SỚM, lúc vừa vào game") — place
  // each group in the SHALLOWEST row that still keeps the level solvable, so it sits near
  // the front of the queue and its members stay together (a deep same-row pair drifts apart
  // as its columns drain unevenly → looks split). The solvablePairs gate below still rejects
  // a front group that would wedge (its colours buried), so it just falls to the next row.
  // distinctify swaps cars at ARBITRARY later indices, so a partial (idx-only) revert would
  // duplicate/lose cars (a real bug that collapsed the palette). Snapshot the WHOLE order
  // and restore it fully whenever an attempt is rejected.
  const restore = (snapAll) => { for (let z = 0; z < order.length; z++) order[z] = snapAll[z]; };
  // Linked groups MUST stay in the first VISIBLE_ROWS rows of the inventory so their
  // connecting rope is always on-screen (the game masks row 4+ and then suppresses the
  // rope to a clipped partner → a buried twin shows NO rope). User rule 2026-07-26 (L9):
  // "xe đôi khác hàng thì xe sâu nhất tối đa hàng 3" — a car in row 4 roped to a front car
  // crosses diagonally and the rope is hidden. So cap every placement to rows 1-3.
  const VISIBLE_ROWS = 3;
  const rowCap = VISIBLE_ROWS * perRow; // exclusive index bound (rows 0..VISIBLE_ROWS-1)
  let nT = 0;
  const lastBase = Math.min(Math.floor((order.length - 3) / perRow) * perRow, rowCap - perRow);
  for (let base = 0; base <= lastBase && nT < (triples || 0); base += perRow) {
    const idx = [base, base + 1, base + 2];
    if (idx.some((i) => i + 1 > order.length || used.has(i)) || !sameRow(...idx)) continue;
    const snapAll = order.slice();
    if (!distinctify(idx)) { restore(snapAll); continue; }
    if (solvablePairs(board, BOARD_SIZE, BOARD_SIZE, order, track, [...groups, idx], 5, perRow, layer2)) { groups.push(idx); idx.forEach((i) => used.add(i)); nT++; }
    else restore(snapAll); // revert the swaps fully
  }
  let nP = 0;
  // FORCED deep-vertical pairs (env VERT_DEEP=N, user 2026-07-27): place N pairs as
  // same-column stacked pairs in the DEEPEST solvable slot (row ≥ 3) FIRST, to seed each
  // level with buried vertical twins. Runs before the shallow pass so those N are
  // guaranteed deep + vertical; the remaining pairs then fill shallow rows as usual.
  const forceVert = Math.min(Number(process.env.VERT_DEEP || 0), pairs || 0);
  for (let f = 0; f < forceVert; f++) {
    let placed = false;
    for (let a = order.length - perRow - 1; a >= 2 * perRow; a--) { // deep→shallow, row(a) ≥ 2
      const b = a + perRow;                                          // directly below (same column)
      if (used.has(a) || used.has(b) || b >= order.length) continue;
      const idx = [a, b];
      const snapAll = order.slice();
      if (!distinctify(idx)) { restore(snapAll); continue; }
      if (solvablePairs(board, BOARD_SIZE, BOARD_SIZE, order, track, [...groups, idx], 5, perRow, layer2)) { groups.push(idx); used.add(a); used.add(b); nP++; placed = true; break; }
      restore(snapAll);
    }
    if (!placed) break; // no deeper solvable slot → stop forcing
  }
  const lastPair = Math.min(Math.floor((order.length - 2) / 2) * 2, rowCap - 2);
  for (let i = 0; i <= lastPair && nP < (pairs || 0); i += 2) {
    if (i + 1 >= order.length || used.has(i) || used.has(i + 1) || !sameRow(i, i + 1)) continue;
    const idx = [i, i + 1];
    const snapAll = order.slice();
    if (!distinctify(idx)) { if (process.env.DEBUG_GROUPS) console.error(`  pair@${i}: distinctify FAIL`); restore(snapAll); continue; }
    if (solvablePairs(board, BOARD_SIZE, BOARD_SIZE, order, track, [...groups, idx], 5, perRow, layer2)) { groups.push(idx); used.add(i); used.add(i + 1); nP++; }
    else { if (process.env.DEBUG_GROUPS) console.error(`  pair@${i}: solvable FAIL`); restore(snapAll); } // revert the swaps fully
  }
  // VERTICAL-adjacent pairs (user 2026-07-27: "xe đôi thẳng hàng chôn sâu được"): a pair
  // stacked in the SAME column at consecutive depths (indices a & a+perRow) never drifts
  // apart as columns drain, so its rope stays a clean short vertical link at ANY depth.
  // Place remaining pairs this way (front-first) so deep twins can exist without a hidden
  // diagonal rope — the shallow-row cap above no longer forces a level to shed twins.
  for (let a = 0; a + perRow < order.length && nP < (pairs || 0); a++) {
    const b = a + perRow; // directly below a in the same column (a % perRow)
    if (used.has(a) || used.has(b)) continue;
    const idx = [a, b];
    const snapAll = order.slice();
    if (!distinctify(idx)) { restore(snapAll); continue; }
    if (solvablePairs(board, BOARD_SIZE, BOARD_SIZE, order, track, [...groups, idx], 5, perRow, layer2)) { groups.push(idx); used.add(a); used.add(b); nP++; }
    else restore(snapAll);
  }
  // (REMOVED 2026-07-27, user L9: the old EARLY cross-row fallback placed a pair at
  // different row AND different column — e.g. col3/row0 + col0/row1 — giving a LONG diagonal
  // rope spanning the board. A linked pair must be ADJACENT: same-row neighbouring columns
  // (horizontal, handled above) OR same-column neighbouring rows (vertical, handled above).
  // No diagonal placement. If neither fits, the level simply carries fewer pairs.)
  if (process.env.DEBUG_GROUPS) console.error(`  pickGroups: want P${pairs}/T${triples} → placed ${groups.length}`);
  return groups;
}

// Order the cars at an EXACT burial strength (0 = outer-first/easy, →1 = inner-first/hard).
function orderAtBias(carList, board, track, bias, seed) {
  if (carList.length <= 1) return carList.slice();
  const edges = trackEdges(track);
  const layer = peelLayers(board, BOARD_SIZE, BOARD_SIZE, edges);
  const outer = colorOuterness(board, layer);
  let maxO = 0; for (const v of outer.values()) if (v > maxO) maxO = v;
  maxO = maxO || 1;
  const rng = makeRng(seed);
  const jit = carList.map(() => rng() * 0.06);
  const idx = carList.map((_, i) => i);
  idx.sort((a, b) => {
    const va = (outer.get(carList[a].color) || 0) / maxO, vb = (outer.get(carList[b].color) || 0) / maxO;
    const ka = (1 - bias) * va + bias * (1 - va) + jit[a];
    const kb = (1 - bias) * vb + bias * (1 - vb) + jit[b];
    return ka - kb;
  });
  return idx.map((i) => carList[i]);
}
function orderByDifficulty(carList, board, track, targetBias, seed) {
  if (carList.length <= 1) return { order: carList.slice(), bias: 0 };
  let bias = targetBias, order = orderAtBias(carList, board, track, bias, seed);
  while (bias > 0 && !solvable(board, BOARD_SIZE, BOARD_SIZE, order, track)) {
    bias = Math.max(0, Math.round((bias - 0.1) * 100) / 100);
    order = orderAtBias(carList, board, track, bias, seed);
  }
  return { order, bias };
}

// ---- average-skill tester ---------------------------------------------------
// Unlike solvable() (a perfect player), this models an intermediate human:
// it sometimes fails to spot a productive move and parks needlessly, and parks
// the wrong car under pressure — the two things that make real players lose a
// technically-winnable level. skill∈[0,1] (1≈perfect). Monte-Carlo over trials.
function playAverage(board, cols, rows, order, track, opts) {
  const { skill, bays, perRow, rng } = opts;
  // AUTO_CIRCLE (shipped default): once launched, cars self-manage — they keep circling
  // while their colour is reachable (never idling in a bay) and a parked car auto-hops
  // back onto the ray the moment its colour is reachable again. So the player makes NO
  // mistakes on the bay/relaunch axis; the only skill-gated choices left are the queue
  // launches (which column-front to send, and which front to park to reveal deeper cars).
  // Set opts.autoDrive = false to model the OLD manual "tap to park / relaunch" game.
  const autoDrive = opts.autoDrive !== false;
  const edges = trackEdges(track);
  const singlePass = track === "line" || track === "u" || track === "arch";
  const occ = board.slice();
  const lay = opts.layer2 ? opts.layer2.slice() : null; // 2-layer: bottom colour per cell (-1 none)
  let remaining = occ.reduce((a, v) => a + (isColor(v) ? 1 : 0), 0) + (lay ? lay.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0) : 0);
  const clearCell = (i) => { if (lay && lay[i] >= 0) { occ[i] = lay[i]; lay[i] = -1; } else occ[i] = -1; remaining--; };
  // Linked car GROUPS (2=twin, 3=triple, …): chests sharing a pairId launch / drive /
  // park / leave together. `grouped` marks a car as a group member (can't act alone).
  // BURIED "?" cars: colour HIDDEN from the player until launched (revealed on commit). In the
  // choice model the player can't score them by colour — launching one is a gamble that clogs a
  // bay if it turns out unreachable. `revealed` flips true once launched (then its colour is known).
  // IDEA B keeps buried cars VISIBLE for movement (revealed:true) — a hidden-info gamble makes the
  // sim non-monotonic (deterministic high-skill play wedges the same way every trial). Instead the
  // `buried` flag only RAISES the per-turn mistake probability (w_?), so difficulty stays monotonic.
  const cars = order.map((c) => ({ color: c.color, cap: c.count, grouped: false, buried: (opts.choiceModel || opts.ideaB) && !!c.buried, revealed: opts.ideaB ? true : !(opts.choiceModel && !!c.buried) }));
  // COGNITIVE LOAD (user 2026-07-29): a perfect player wins almost any solvable slam level, so
  // real difficulty = human ERROR, and error rises with how much the level asks you to TRACK —
  // hidden "?" cars, many colours, many cars. LOAD scales the softmax temperature so a rich /
  // confusing board makes more mistakes (lower winrate) than a simple one at the SAME skill.
  const _nCars = order.length || 1;
  const _nBuried = opts.choiceModel ? order.reduce((a, c) => a + (c.buried ? 1 : 0), 0) : 0;
  const _nColors = new Set(board.filter((v) => v >= 0 && v < 90)).size;
  const LOAD = 1 + (Number(process.env.LOAD_A) || 1.5) * (_nBuried / _nCars)
    + (Number(process.env.LOAD_B) || 0.8) * (_nColors / 12)
    + (Number(process.env.LOAD_C) || 0.4) * (_nCars / 20);
  const byPid = new Map();
  order.forEach((c, i) => { if (c.pairId != null) { (byPid.get(c.pairId) || byPid.set(c.pairId, []).get(c.pairId)).push(i); } });
  const groups = [];
  for (const idxs of byPid.values()) if (idxs.length >= 2) { const g = idxs.map((i) => cars[i]); g.forEach((c) => (c.grouped = true)); groups.push(g); }
  const columns = Array.from({ length: perRow }, () => []);
  cars.forEach((c, i) => columns[i % perRow].push(c));
  const parked = [];
  // BAY JUGGLE (user technique, 2026-07-25): with the bays full, a skilled player taps a
  // BLOCKED parked car back onto the ray right as another car is about to park — the
  // juggled car circles "uselessly" (still collecting if its colour opens mid-lap) and
  // re-parks when a bay frees. `circ` holds these circling cars; capped so the ray keeps
  // room for productive launches. Each use is timing-gated by skill.
  const circ = [];
  const CIRC_CAP = 4;      // hard ceiling on cars circling the ray at once
  const CIRC_EASY = 3;     // routine cap; keeping a 4th car out needs a rare fast-hands burst
  const CIRC_BURST = 0.4;  // chance even a good player sustains that 4th car ("thi thoảng lắm")
  let peak = 0;
  const gainOf = (color, E) => { let n = 0; for (const i of E) if (occ[i] === color) n++; return n; };
  const isFront = (c) => columns.some((col) => col[0] === c);
  // Launchable = parked, or no non-member ahead of it in its column (same-column stacked
  // pair launches as a unit → deep vertical twins, user 2026-07-27). Matches the game.
  const groupReady = (g) => g.every((c) => {
    if (parked.includes(c)) return true;
    for (const col of columns) { const k = col.indexOf(c); if (k >= 0) return col.slice(0, k).every((x) => g.includes(x)); }
    return false;
  });
  const removeCar = (c) => { for (const col of columns) { const k = col.indexOf(c); if (k >= 0) { col.splice(k, 1); return; } } let p = parked.indexOf(c); if (p >= 0) { parked.splice(p, 1); return; } p = circ.indexOf(c); if (p >= 0) circ.splice(p, 1); };
  const juggleOne = () => {
    if (process.env.NOJUGGLE === "1") return false; // SLAM: no "extra cars beyond bays" escape
    if (circ.length >= CIRC_CAP) return false; // no track room
    // Pushing out a 4th circling car is a rare "tay nhanh" burst, not routine.
    if (circ.length >= CIRC_EASY && rng() > CIRC_BURST) return false;
    // "đẩy nhanh 2-3 xe" (user): a rapid double-tap — the juggle only fails when BOTH
    // taps are mistimed, so effective success ≈ 1-(1-skill)².
    if (rng() > skill && rng() > skill) return false;
    const idx = parked.findIndex((c) => !c.grouped);
    if (idx >= 0) { circ.push(parked.splice(idx, 1)[0]); return true; }
    for (const g of groups) { // only groups parked → the whole group relaunches together
      if (g.every((c) => c.cap === 0) || !g.every((c) => parked.includes(c))) continue;
      if (circ.length + g.length > CIRC_CAP) continue;
      for (const c of g) { parked.splice(parked.indexOf(c), 1); circ.push(c); }
      return true;
    }
    return false;
  };
  const doCollect = (car) => {
    if (singlePass) { const E = exposedTiles(occ, cols, rows, edges); for (const i of E) { if (car.cap <= 0) break; if (occ[i] === car.color) { clearCell(i); car.cap--; } } }
    else { while (car.cap > 0) { const E = exposedTiles(occ, cols, rows, edges); let t = -1; for (const i of E) if (occ[i] === car.color) { t = i; break; } if (t < 0) break; clearCell(t); car.cap--; } }
  };
  // park a NON-grouped front (a linked group can't park a single member) — the only
  // way to reveal deeper columns.
  const parkOne = () => {
    const fronts = []; for (let j = 0; j < perRow; j++) { const f = columns[j][0]; if (f && !f.grouped) fronts.push(j); }
    if (fronts.length === 0 || parked.length >= bays) return false;
    let j;
    if (rng() > skill) j = fronts[Math.floor(rng() * fronts.length)];
    else { fronts.sort((a, b) => columns[b].length - columns[a].length); j = fronts[0]; }
    parked.push(columns[j].shift());
    return true;
  };
  // AUTO_CIRCLE: greedily play every already-committed car that can collect right now —
  // a productive parked SOLO, or a fully-parked productive GROUP — with NO player slip.
  // Models auto-relaunch-from-bays + keep-circling: a productive car never sits idle in a
  // bay, so bays only ever hold cars whose colour is currently BLOCKED. Loops because each
  // collect can expose more. Returns true if it made any progress.
  const autoRelaunch = () => {
    let progressed = false;
    for (;;) {
      const E = exposedTiles(occ, cols, rows, edges);
      const S = new Set(); for (const i of E) S.add(occ[i]);
      let acted = false;
      for (const c of parked) { // productive parked solo → relaunch & collect
        if (c.grouped || c.cap <= 0 || !S.has(c.color)) continue;
        doCollect(c);
        if (c.cap === 0) removeCar(c);
        acted = progressed = true; break;
      }
      if (acted) continue;
      for (const g of groups) { // fully-parked productive group → relaunch together
        if (g.every((c) => c.cap === 0)) continue;
        if (!g.every((c) => parked.includes(c))) continue;
        if (!g.some((c) => c.cap > 0 && S.has(c.color))) continue;
        for (const c of g) doCollect(c);
        if (g.every((c) => c.cap === 0)) for (const c of g) removeCar(c); // all empty → leave together
        acted = progressed = true; break;
      }
      if (!acted) break;
    }
    return progressed;
  };
  // ---- TRAY BATCH mode (user 2026-07-26 redesign): one-way bays, NO auto-fire, NO juggle.
  // The player STAGES cars into the bays (fill 1→5), then presses GO to launch the WHOLE
  // batch at once. The squad circles as one unit and keeps looping while ANY member can
  // still collect (a car peeling an outer ring surfaces a teammate's colour → the batch
  // chains) — modelled here as a fixed-point collect over all bay cars. When no member can
  // collect (fixed point), emptied cars leave and still-blocked cars stay in their bays for
  // the next batch. The ONLY player decisions are WHICH fronts to stage (skill-gated) and
  // implicitly WHEN to GO (this bot fills the bays greedily, then fires). Bays lock during a
  // run. Lose = bays full of blocked cars, nothing new to stage, and GO would collect
  // nothing. Fully deterministic given the staged set → an accurate win-rate gauge.
  if (opts.tray) {
    let g2 = 0;
    while (remaining > 0 && g2++ < order.length * 6 + 400) {
      if (parked.length > peak) peak = parked.length;
      // STAGE PHASE: greedily fill the bays from the queue. Stage a READY group whole (all
      // members at fronts) when it fits; else a solo front — prefer a REACHABLE one, else
      // dig the DEEPEST column to reveal more. skill-miss → a random front.
      let stagedAny = false;
      while (parked.length < bays) {
        const E = exposedTiles(occ, cols, rows, edges);
        const S = new Set(); for (const i of E) S.add(occ[i]);
        let staged = false;
        for (const g of groups) {
          if (g.every((c) => c.cap === 0) || !groupReady(g)) continue;
          if (parked.length + g.length > bays) continue;
          for (const c of g) { removeCar(c); parked.push(c); }
          staged = stagedAny = true; break;
        }
        if (staged) continue;
        const fronts = [];
        for (let j = 0; j < perRow; j++) { const f = columns[j][0]; if (f && !f.grouped) fronts.push({ j, f }); }
        if (!fronts.length) break; // nothing left to stage
        const reach = fronts.filter((x) => x.f.cap > 0 && S.has(x.f.color));
        let pick;
        if (reach.length) pick = (rng() > skill) ? fronts[Math.floor(rng() * fronts.length)] : reach.reduce((a, b) => (gainOf(b.f.color, E) > gainOf(a.f.color, E) ? b : a));
        else pick = (rng() > skill) ? fronts[Math.floor(rng() * fronts.length)] : fronts.reduce((a, b) => (columns[b.j].length > columns[a.j].length ? b : a));
        parked.push(columns[pick.j].shift());
        stagedAny = true;
      }

      // GO PHASE: fixed-point collect. Every bay car collects all reachable tiles of its
      // colour; repeat full passes until a pass collects nothing (peeling can chain).
      let collectedAny = false;
      for (;;) {
        let acted = false;
        for (const c of parked) {
          if (c.cap <= 0) continue;
          const before = c.cap;
          doCollect(c); // recomputes reachability internally, grabs all it can right now
          if (c.cap < before) { acted = collectedAny = true; }
        }
        if (!acted) break;
      }
      // Emptied cars leave the bays; a grouped car leaves only when its WHOLE group is empty.
      for (const c of [...parked]) {
        if (c.cap !== 0) continue;
        if (c.grouped) { const g = groups.find((gg) => gg.includes(c)); if (g && g.every((m) => m.cap === 0)) removeCar(c); }
        else removeCar(c);
      }

      // Couldn't stage anything new AND GO collected nothing → the board can't progress.
      if (!stagedAny && !collectedAny) break;
    }
    return { win: remaining === 0, peak };
  }

  let guard = 0;
  while (remaining > 0 && guard++ < order.length * 8 + 300) { // extra headroom: juggling adds turns
    if (parked.length > peak) peak = parked.length;
    if (autoDrive) { autoRelaunch(); if (remaining === 0) break; } // bays self-clear productive cars
    if (parked.length > peak) peak = parked.length;
    const E = exposedTiles(occ, cols, rows, edges);
    const S = new Set(); for (const i of E) S.add(occ[i]);
    // juggled circling cars: collect if their colour opened up mid-lap; re-park at lap
    // end when a bay is free; leave the game if emptied on the road.
    for (let i = circ.length - 1; i >= 0; i--) {
      const c = circ[i];
      if (c.cap > 0 && S.has(c.color)) doCollect(c);
      if (c.cap === 0) { circ.splice(i, 1); continue; }
      if (parked.length < bays) { parked.push(c); circ.splice(i, 1); }
    }
    const prod = [];
    // SLAM: a car FROM THE QUEUE (hàng Xếp) can only come up if a bay is FREE — it occupies
    // that bay the whole trip. A car ALREADY in a bay relaunches freely (keeps its bay). So
    // when all bays are full of blocked cars, only bay cars can act → the real deadlock risk.
    const queueCanEnter = !opts.slam || parked.length < bays;
    // productive solo cars (parked + column fronts) — only ones whose colour the player KNOWS
    // (not a still-covered "?" car).
    for (const p of parked) if (!p.grouped && p.revealed && S.has(p.color)) prod.push({ kind: "s", car: p, gain: gainOf(p.color, E) });
    if (queueCanEnter) for (let j = 0; j < perRow; j++) { const f = columns[j][0]; if (f && !f.grouped && f.revealed && S.has(f.color)) prod.push({ kind: "s", car: f, gain: gainOf(f.color, E) }); }
    // BURIED "?" fronts: colour unknown → the player can only GAMBLE. Expected value = P(its
    // colour is currently reachable) × a typical grab. If picked and it turns out blocked, it
    // parks and clogs a bay (handled at launch). More "?" cars → more blind gambles → more risk.
    let gambles = [];
    const GMARGIN = Number(process.env.GAMBLE_MARGIN) || 2; // keep a safety buffer — never gamble the level into deadlock
    if (opts.choiceModel && queueCanEnter && (bays - parked.length) >= GMARGIN) {
      // Bayesian belief: P(a hidden car's colour is currently reachable) ≈ fraction of the tiles
      // STILL on the board whose colour is exposed. A wiser gamble than a blind coin-flip.
      const remCount = new Map(); let totalRem = 0;
      for (const v of occ) if (v >= 0 && v < 90) { remCount.set(v, (remCount.get(v) || 0) + 1); totalRem++; }
      let pReach = 0; for (const c of S) pReach += (remCount.get(c) || 0); pReach = totalRem ? pReach / totalRem : 0;
      let meanGain = 0, ng = 0; for (const c of S) { meanGain += gainOf(c, E); ng++; } meanGain = ng ? meanGain / ng : 0;
      for (let j = 0; j < perRow; j++) { const f = columns[j][0]; if (f && !f.grouped && !f.revealed) gambles.push({ kind: "s", car: f, gain: pReach * meanGain, gamble: true }); }
    }
    // productive READY groups (ALL members at column-fronts or parked). Under auto-drive a
    // productive group is ALWAYS launchable — it circles the track & PEELS (freeing bays as
    // buried colours surface), needing bays only IF still blocked afterwards (handled at
    // launch). The manual game keeps the old "needs groupSize bays free up-front" gate.
    for (const g of groups) {
      if (g.every((c) => c.cap === 0)) continue;
      if (!groupReady(g)) continue;
      if (!g.some((c) => c.cap > 0 && S.has(c.color))) continue; // a member that can STILL eat
      const own = g.filter((c) => parked.includes(c)).length;
      const canPark = parked.length - own <= bays - g.length;
      const fullClear = g.every((c) => gainOf(c.color, E) >= c.cap);
      // SLAM: a queue group needs g.length FREE bays to come up (own members already hold theirs).
      if (opts.slam ? (own === g.length || canPark) : (autoDrive || canPark || fullClear)) prod.push({ kind: "g", g, gain: g.reduce((s, c) => s + gainOf(c.color, E), 0) });
    }
    if (prod.length || gambles.length) {
      const slip = rng() > skill;
      if (!autoDrive && slip && rng() < 0.4 && parkOne()) continue; // manual only: perception miss → needless park (auto-drive never needlessly parks)
      let ch;
      if (opts.choiceModel && opts.ideaB) {
        // IDEA B (user 2026-07-29): keep the mechanical cap-5 sim, but replace the FIXED skill
        // slip with a per-turn MISTAKE probability that RISES for hard situations (blind "?",
        // twin baggage, big-count commitment, buried "key" colour) and FALLS for an obvious safe
        // move — all gated by (1-skill) so higher skill is always ≥ as good (monotonic). When the
        // mistake fires the player takes the RISKY move of that situation (blind gamble / clog a
        // bay), so a hard situation actually "cắn". A level's winrate emerges from how often,
        // across 100 trials, the flow throws these hard situations at the player. Knobs are env-
        // tunable (IDEAB_*) and calibrated to real playtests (L114≈80, L115≈60, L130≈10).
        const W_EASY = Number(process.env.IDEAB_EASY ?? 0.6);
        const W_Q = Number(process.env.IDEAB_Q ?? 0.9);
        const W_DOI = Number(process.env.IDEAB_DOI ?? 0.9);
        const W_COUNT = Number(process.env.IDEAB_COUNT ?? 0.6);
        const W_CHON = Number(process.env.IDEAB_CHON ?? 0.7);
        const freeBays = bays - parked.length;
        // unlock(c): how many NEW tiles a colour would expose if its exposed tiles were peeled now.
        const unlockOf = (color) => {
          const o2 = occ.slice(); for (const i of E) if (o2[i] === color) o2[i] = -1;
          const E2 = exposedTiles(o2, cols, rows, edges);
          let n = 0; for (const i of E2) if (!E.has(i) && isColor(o2[i])) n++; return n;
        };
        const remCount = new Map(); for (const v of occ) if (isColor(v)) remCount.set(v, (remCount.get(v) || 0) + 1);

        // (1) w_? — buried "?" cars at/near the column fronts you must act on WITHOUT reading ahead;
        // worse when bays are tight. (Cars stay visible in the sim; the "?" only raises mistake odds.)
        let nBuriedFront = 0; for (let j = 0; j < perRow; j++) { const f = columns[j][0]; if (f && !f.grouped && f.buried) nBuriedFront++; }
        const bayPressure = Math.max(0, Math.min(1, (2 - freeBays) / 2));
        const kQ = W_Q * (Math.min(nBuriedFront, 2) / 2) * (0.4 + 0.6 * bayPressure);

        // (2) w_đôi — twins that force BAGGAGE: one member useful (∈S) while another is wasted (∉S),
        // so launching it grabs the needed half but clogs a bay with the unwanted half. More such
        // competing twins (which cục nợ to accept) + bigger counts → harder.
        const dilTwin = new Set(); let maxTwinCount = 0;
        for (const g of groups) {
          if (g.every((c) => c.cap === 0) || !groupReady(g)) continue;
          const useful = g.some((c) => c.revealed && c.cap > 0 && S.has(c.color));
          const waste = g.some((c) => c.revealed && c.cap > 0 && !S.has(c.color));
          if (useful && waste) { dilTwin.add(g); const cc = g.reduce((s, c) => s + c.cap, 0); if (cc > maxTwinCount) maxTwinCount = cc; }
        }
        const kDoi = W_DOI * (Math.min(dilTwin.size, 3) / 3) * Math.min(maxTwinCount / 60, 1);

        // (3) w_count — a big-count car to commit while the frontier already offers ≥2 colours
        // (a heavy, hard-to-undo choice made while juggling several options).
        let maxC = 0; for (const p of prod) if (p.kind === "s" && p.car.cap > maxC) maxC = p.car.cap;
        const kCount = W_COUNT * Math.max(0, Math.min(1, (maxC - 15) / 15)) * Math.max(0, Math.min(1, (S.size - 1) / 2));

        // (4) w_chôn — the useful colours are BURIED: the frontier is mostly "dead surface" (peeling
        // it opens nothing) across several colours, while a big colour sits un-exposed underneath —
        // the "A B C / D E F / X X X" trap where you must pick which dig-path reaches X.
        let lowSurface = 0; for (const c of S) if (unlockOf(c) <= 1) lowSurface++;
        let buriedBig = 0; for (const [col, ct] of remCount) if (!S.has(col) && ct > buriedBig) buriedBig = ct;
        const kChon = W_CHON * (S.size ? lowSurface / S.size : 0) * Math.max(0, Math.min(1, (S.size - 1) / 2)) * Math.min(1, buriedBig / 20);

        // easy: an obvious safe solo (empties this trip → never clogs a bay) and no ambiguity around it.
        let easy = 0;
        for (const p of prod) if (p.kind === "s" && p.car.revealed && S.has(p.car.color) && p.gain >= p.car.cap) { easy = 1; break; }
        if (nBuriedFront > 0 || dilTwin.size > 0) easy = 0;

        const pLo = Math.max(0, Math.min(1, (1 - skill) * (1 - W_EASY * easy + kQ + kDoi + kCount + kChon)));
        const mistake = rng() < pLo;

        // SMART play (no mistake): relaunch a bay car that empties > clean (non-baggage) twin >
        // clean solo (empties this trip, never clogs) > among the rest the SMALLEST blocker (least
        // bay clog), not raw max-gain — a skilled player minimises bay pressure, not tile count.
        const smart = (arr) => {
          const pick = (a) => { a.sort((x, y) => y.gain - x.gain); return a[0]; };
          const freeing = arr.filter((p) => p.kind === "s" && parked.includes(p.car) && p.gain >= p.car.cap);
          const grp = arr.filter((p) => p.kind === "g" && !dilTwin.has(p.g));
          const clean = arr.filter((p) => p.kind === "s" && p.gain >= p.car.cap);
          if (freeing.length) return pick(freeing);
          if (grp.length) return pick(grp);
          if (clean.length) return pick(clean);
          // only blockers left: take the one that clogs a bay the LEAST (smallest leftover cap)
          const rest = arr.slice().sort((a, b) => (a.kind === "s" ? a.car.cap - a.gain : 99) - (b.kind === "s" ? b.car.cap - b.gain : 99));
          return rest[0];
        };
        if (!mistake) {
          ch = smart(prod);
          // A skilled player won't wedge the LAST free bay with a car that stays blocked — they DIG
          // (park a front to reveal deeper cars) instead of clogging into deadlock. Keeps the
          // movement policy from wedging deterministically at high skill.
          if (ch.kind === "s" && !parked.includes(ch.car) && ch.gain < ch.car.cap && (bays - parked.length) <= 2 && parkOne()) continue;
        } else {
          // Mistake fired. If a HARD signal is active this turn, take ITS trap so it "cắn": commit a
          // baggage twin (clogs a bay with the unwanted half), or launch a big blocker, or — under
          // "?"/dig confusion — a blind random front (may be a blocker). Otherwise a mild random slip.
          const dil = prod.filter((p) => p.kind === "g" && dilTwin.has(p.g));
          const blockers = prod.filter((p) => p.kind === "s" && !parked.includes(p.car) && p.gain < p.car.cap);
          if (dil.length) ch = dil[Math.floor(rng() * dil.length)];
          else if ((kCount > 0.15 || nBuriedFront > 0 || kChon > 0.15) && blockers.length) ch = blockers.reduce((a, b) => (b.car.cap > a.car.cap ? b : a));
          else ch = prod[Math.floor(rng() * prod.length)];
        }
      } else if (opts.choiceModel) {
        // CHOICE MODEL (user 2026-07-29): the player picks by VISIBLE APPEAL, not perfect
        // bay-planning. Score = tiles grabbed now (gain) + small bonuses for "obvious good"
        // cues: a bay car that will EMPTY (frees a slot), a ready twin, and — the user's
        // "liếc xe ngay sau" — a queue front whose NEXT car in the column is also reachable
        // (digging reveals a usable car). Softmax(temperature T) turns skill into realistic
        // imperfection: T rises as skill drops, so a 0.75 player mostly grabs the best move
        // but sometimes takes an appealing-yet-bay-clogging one → real deadlock risk on
        // bay-locked / twin-heavy boards. Tunable via env TEMP / weights for calibration.
        const T = Math.max(0.4, (Number(process.env.TEMP) || 6) * (1 - skill) * LOAD);
        const BAYW = Number(process.env.BAYW) || 20; // how strongly the player keeps bays free
        const freeBays = bays - parked.length;
        const behindReach = (p) => {
          if (p.kind !== "s") return 0;
          for (const col of columns) { const k = col.indexOf(p.car); if (k >= 0) { const b = col[k + 1]; return b && S.has(b.color) ? 1 : 0; } }
          return 0; // a parked car has no "car behind"
        };
        // A decent player mostly keeps a bay FREE (so a blocked car always has somewhere to
        // wait / a queue car can still enter). Bay-safety dominates raw gain; temperature adds
        // occasional slips → real deadlock risk without the absurd over-clogging of the old score.
        const score = (p) => {
          let s = p.gain * 0.4;
          if (p.kind === "s") {
            const empties = p.gain >= p.car.cap;
            if (parked.includes(p.car)) { if (empties) s += BAYW; }        // relaunch a bay car that EMPTIES → frees a slot (best)
            else if (empties) s += BAYW * 0.6;                             // queue car that empties this trip → bay-neutral
            else s -= BAYW / Math.max(1, freeBays);                        // queue car that will BLOCK → clogs a bay (worse when bays scarce)
          } else if (p.kind === "g") s += BAYW * 0.3;                       // twins while ready
          s += 3 * behindReach(p);                                          // liếc xe sau
          return s;
        };
        const cand = prod.length ? prod : gambles; // play KNOWN moves first; only gamble on "?" when stuck
        const ws = cand.map((p) => Math.exp(score(p) / T));
        let sum = 0; for (const w of ws) sum += w;
        let r = rng() * sum, idx = 0;
        for (; idx < ws.length - 1; idx++) { r -= ws[idx]; if (r <= 0) break; }
        ch = cand[idx];
      } else if (!slip) {
        // Bay-aware smart play — keep waiting-bay space free so linked groups (which need
        // groupSize ADJACENT bays to park) never get wedged out by blocked solos. Priority:
        //  1) relaunch a PARKED car that will fully EMPTY → frees a bay
        //  2) a READY group → launch before another move buries a member (twins early)
        //  3) a solo that fully EMPTIES this visit → never needs a bay (bay-neutral)
        //  4) else the highest-gain move (peels the most → exposes more for everyone)
        const pick = (arr) => { arr.sort((a, b) => b.gain - a.gain); return arr[0]; };
        const freeing = prod.filter((p) => p.kind === "s" && parked.includes(p.car) && p.gain >= p.car.cap);
        const grp = prod.filter((p) => p.kind === "g");
        const clean = prod.filter((p) => p.kind === "s" && p.gain >= p.car.cap);
        ch = freeing.length ? pick(freeing) : grp.length ? pick(grp) : clean.length ? pick(clean) : pick(prod);
      } else ch = prod[Math.floor(rng() * prod.length)];
      if (ch.kind === "s") {
        const car = ch.car, wasParked = parked.includes(car);
        car.revealed = true;      // launching a "?" car reveals its colour (gamble resolved)
        removeCar(car);           // take it off the queue / out of its bay to circle the track
        doCollect(car);           // circle & peel its colour (a wrong gamble grabs nothing → it parks)
        if (autoDrive) autoRelaunch(); // peeling surfaced buried colours → parked cars self-clear, freeing bays
        if (car.cap > 0) {        // still blocked → it must wait in a bay
          if (parked.length < bays) parked.push(car);
          else if (juggleOne()) parked.push(car); // bay juggle: freed a slot just in time
          else if (!wasParked) return { win: false, peak }; // out of space
          else parked.push(car);  // it came from a bay → its slot is still counted
        }
      } else { // group: the whole group circles the track & peels together
        for (const c of ch.g) removeCar(c);
        for (const c of ch.g) doCollect(c);
        if (autoDrive) autoRelaunch(); // peeling frees bays before the group needs to park
        if (!ch.g.every((c) => c.cap === 0)) { // not all empty → the group waits together
          while (parked.length + ch.g.length > bays && juggleOne()) { /* bay juggle frees slots */ }
          if (parked.length + ch.g.length > bays) return { win: false, peak }; // out of space
          for (const c of ch.g) parked.push(c);
        }
      }
      continue;
    }
    if (parkOne()) continue;
    // Last resort (mirrors the real game): send a READY-but-unproductive group into
    // the bays to unblock its columns. If even that's impossible → stuck, lose.
    let sent = false;
    for (const g of groups) {
      if (g.every((c) => c.cap === 0)) continue;
      if (!groupReady(g)) continue;
      if (parked.length > bays - g.length) continue;
      for (const c of g) removeCar(c);
      for (const c of g) doCollect(c);
      if (!g.every((c) => c.cap === 0)) for (const c of g) parked.push(c);
      sent = true; break;
    }
    if (!sent) {
      // bay juggle as the final out: bays are wedged with blocked cars → rapidly tap up
      // to TWO back onto the ray (user pushes 2-3 in quick succession) so parkOne can
      // reveal deeper columns over the next turns.
      if (parked.length >= bays) { let jn = 0; while (jn < 2 && juggleOne()) jn++; if (jn > 0) continue; }
      if (process.env.TRACE === "1") {
        const E = exposedTiles(occ, cols, rows, edges); const S = new Set(); for (const i of E) S.add(occ[i]);
        const bayCol = parked.map((c) => c.color + ":" + c.cap + (c.grouped ? "G" : "")).join(" ");
        const frontCol = columns.map((col) => col[0] ? col[0].color + ":" + col[0].cap + (col[0].grouped ? "G" : "") : "-").join(" ");
        const rem = {}; for (const v of occ) if (v >= 0 && v < 90) rem[v] = (rem[v] || 0) + 1;
        const bayRem = parked.map((c) => c.color + "→" + (rem[c.color] || 0) + "left").join(" ");
        console.error(`LOSE g=${guard} rem=${remaining} bays=${parked.length}/${bays} [${bayCol}] fronts=[${frontCol}] exposed=[${[...S].join(",")}] bayColoursLeftOnBoard: ${bayRem}`);
      }
      return { win: false, peak };
    }
  }
  return { win: remaining === 0, peak };
}
function testerReport(board, cols, rows, order, track, { skill = 0.6, trials = 100, seed = 1, bays = 5, perRow = LANES, layer2 = null, autoDrive = AUTO_DRIVE, tray = false, slam = false, choiceModel = false, ideaB = false } = {}) {
  let wins = 0, peakSum = 0;
  for (let t = 0; t < trials; t++) {
    const rng = makeRng(seed + t * 7919 + 1);
    const r = playAverage(board, cols, rows, order, track, { skill, bays, perRow, rng, layer2, autoDrive, tray, slam, choiceModel, ideaB });
    if (r.win) wins++;
    peakSum += r.peak;
  }
  return { winRate: wins / trials, avgPeak: peakSum / trials };
}

// ---- 2-LAYER slime generation ----------------------------------------------
// Stamp a rectangular patch of 2-layer cells onto the board: cells inside the patch
// whose top colour differs get a SINGLE bottom colour (clean look). Returns
// {layer2, count, bottom} or null if no viable patch. Placed centrally so the patch
// is buried (revealed mid-game). `frac` ≈ fraction of filled cells to cover.
// `pos` (or env L2POS): "center" = old centred patch (revealed late-game);
// "outer" = a RING BAND near the outside of the filled area — bottoms pop from the
// very FIRST peels, breaking the "obvious colour order" read on any picture
// (user 2026-07-25: "ảnh nào cũng làm khó được — layer 2 ngay từ vòng gần bên ngoài").
function makeLayer2(board, cols, rows, frac, seed, pos = process.env.L2POS || "center") {
  const rng = makeRng(seed);
  const filled = []; for (let i = 0; i < board.length; i++) if (board[i] >= 0 && board[i] < 90) filled.push(i);
  if (filled.length < 40) return null;
  const present = new Set(); for (const i of filled) present.add(board[i]);
  // bottom colours: bright colours ALREADY on the board (keeps the palette tight);
  // big patches split into TWO bottom colours (left/right halves) so no single colour's
  // cars swamp the bays — keeps group placement solvable on super levels.
  const cand = BRIGHT_IDS.filter((id) => present.has(id));
  const b1 = cand.length ? cand[Math.floor(rng() * cand.length)] : BRIGHT_IDS[0];
  let b2 = b1;
  if (cand.length > 1) { do { b2 = cand[Math.floor(rng() * cand.length)]; } while (b2 === b1); }
  // RICH bottom (user 2026-07-25): scatter MANY colours under the top instead of 1-2
  // tones, so difficulty comes from the HIDDEN palette — the visible top can stay
  // few-colour (clean look) yet peeling a big blob reveals a spread of colours, killing
  // the free parallel clears that made big-blob art easy. L2RICH=N → up to N bottom
  // colours (NEW brights first so total colours-in-play grows), each cell dodging its
  // top colour + already-stamped up/left neighbours. Bot models layer2 → measurable.
  const RICH = process.env.L2RICH != null ? Math.max(2, Math.floor(Number(process.env.L2RICH))) : 0;
  let richPal = null;
  if (RICH) {
    // Cap total colours-IN-PLAY at MAX_COLORS: only add as many NEW bright colours as
    // room allows (12 − top distinct), then REUSE existing top colours for the rest of
    // the rich palette (reuse doesn't grow the total). Too many colours-in-play + few
    // lanes wedges even the perfect solver, so this keeps rich layers solvable.
    const news = BRIGHT_IDS.filter((id) => !present.has(id));
    const olds = BRIGHT_IDS.filter((id) => present.has(id));
    const room = Math.max(0, MAX_COLORS - present.size);
    const pal = [...news.slice(0, room), ...olds];
    richPal = pal.slice(0, Math.min(RICH, pal.length));
    if (richPal.length < 2) richPal = null;
  }
  const layer2 = new Array(board.length).fill(-1);
  const counts = new Map();
  let count = 0;
  const pickRich = (i) => {
    const c = i % cols, up = i - cols, lf = i - 1;
    const bad = new Set([board[i]]);
    if (up >= 0 && layer2[up] >= 0) bad.add(layer2[up]);
    if (c > 0 && layer2[lf] >= 0) bad.add(layer2[lf]);
    const opts = richPal.filter((x) => !bad.has(x));
    const pool = opts.length ? opts : richPal.filter((x) => x !== board[i]);
    const src = pool.length ? pool : richPal;
    return src[Math.floor(rng() * src.length)];
  };
  const stamp = (i, bottom0) => {
    const bottom = richPal ? pickRich(i) : bottom0;
    if (board[i] >= 0 && board[i] < 90 && board[i] !== bottom) {
      layer2[i] = bottom; count++;
      counts.set(bottom, (counts.get(bottom) || 0) + 1);
    }
  };
  if (pos === "outer") {
    // ring distance of each FILLED cell from the outside of the filled region (BFS)
    const isFill = new Set(filled);
    const dist = new Map();
    let ring = [];
    for (const i of filled) {
      const r = Math.floor(i / cols), c = i % cols;
      const nb = [r > 0 ? i - cols : -1, r < rows - 1 ? i + cols : -1, c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1];
      if (nb.some((j) => j < 0 || !isFill.has(j))) { dist.set(i, 0); ring.push(i); }
    }
    let d = 0;
    while (ring.length) {
      const next = [];
      for (const i of ring) {
        const r = Math.floor(i / cols), c = i % cols;
        for (const j of [i - cols, i + cols, i - 1, i + 1]) {
          if (j < 0 || j >= board.length || !isFill.has(j) || dist.has(j)) continue;
          if (Math.abs((j % cols) - c) + Math.abs(Math.floor(j / cols) - r) !== 1) continue;
          dist.set(j, d + 1); next.push(j);
        }
      }
      ring = next; d++;
    }
    // fill rings 1,2,3,… outward-in (skip ring 0 so the very edge stays honest) until
    // ~frac of the filled cells carry a hidden bottom; alternate the 2 tones per ring.
    const target = Math.round(filled.length * frac);
    for (let rd = 1; count < target && rd <= d; rd++) {
      const cells = filled.filter((i) => dist.get(i) === rd);
      const bottom = rd % 2 === 1 ? b1 : b2;
      for (const i of cells) { if (count >= target) break; stamp(i, bottom); }
    }
  } else {
    // centred square patch sized to hit ~frac of filled cells (original behaviour)
    const side = Math.max(4, Math.round(Math.sqrt(filled.length * frac)));
    const twoTone = side * side > 40 && b2 !== b1;
    const r0 = Math.floor(rows / 2 - side / 2), c0 = Math.floor(cols / 2 - side / 2);
    for (let r = r0; r < r0 + side; r++) for (let c = c0; c < c0 + side; c++) {
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
      const i = r * cols + c;
      const bottom = twoTone && c >= c0 + side / 2 ? b2 : b1; // left half b1, right half b2
      stamp(i, bottom);
    }
  }
  return count >= 12 ? { layer2, count, counts } : null;
}

// ---- CLEAN two-layer picture (item 4, user 2026-07-25) ----------------------
// The random many-colour bottom (L2RICH) looks blotchy. Cleaner: split a full X-colour
// subject render into a Y-colour TOP + an (X−Y)-colour BOTTOM, both spatially coherent.
//   TOP    = the subject REDUCED to Y colours (a clean, flatter version — nice to look at)
//   BOTTOM = the detail colours reduction merged away, kept at each cell it changed
// Top & bottom palettes are DISJOINT (a merged colour vanishes from the top), so total
// colours-in-play = X while the visible surface shows only Y. Difficulty lives in the
// hidden detail, DECOUPLED from the top's colour count (user: "layer 1 chỉ Y màu, tô
// chủ thể theo X−Y màu còn lại làm layer dưới"). Returns {board:top, layer2, count, counts}.
function makeTwoLayerPicture(full, topY, seed) {
  const top = reduceColors(full.slice(), topY, seed);
  const layer2 = new Array(full.length).fill(-1);
  const counts = new Map();
  let count = 0;
  for (let i = 0; i < full.length; i++) {
    const v = full[i];
    if (v < 0 || v >= 90) continue;
    if (top[i] !== v) { layer2[i] = v; count++; counts.set(v, (counts.get(v) || 0) + 1); }
  }
  return { board: top, layer2, count, counts };
}

// ---- EDGE ROCK WALLS (user 2026-07-26) --------------------------------------
// Overwrite the outer row(s)/col(s) of the given edges with HARD ROCK (code 90), so the
// square track's rays from those edges hit rock and stop — the board plays like a U /
// arch / line (narrow frontier → few colours exposed at once → LOGIC over fast fingers,
// and fewer live slimes → not a slog). `edges` = a string with any of T B L R. Mutates
// `board`. Returns how many cells became rock. `thick` walls (default 1) block harder.
function placeWalls(board, cols, rows, edges, thick = 1) {
  if (!edges) return 0;
  const E = edges.toUpperCase();
  let n = 0;
  const rock = (r, c) => { if (r >= 0 && r < rows && c >= 0 && c < cols) { const i = r * cols + c; if (board[i] !== OBST) { board[i] = OBST; n++; } } };
  for (let t = 0; t < thick; t++) {
    if (E.includes("T")) for (let c = 0; c < cols; c++) rock(t, c);
    if (E.includes("B")) for (let c = 0; c < cols; c++) rock(rows - 1 - t, c);
    if (E.includes("L")) for (let r = 0; r < rows; r++) rock(r, t);
    if (E.includes("R")) for (let r = 0; r < rows; r++) rock(r, cols - 1 - t);
  }
  return n;
}

// ---- hidden "?" slime generation --------------------------------------------
// Pick interior cells (ALL 4 neighbours are slime) to start hidden: hidden[i] = the
// cell's real colour (board keeps the colour too — solver unaffected; hiding is a
// perception effect for the player). ~frac of eligible cells, spread by seed.
function makeHidden(board, cols, rows, frac, seed) {
  const rng = makeRng(seed);
  const hidden = new Array(board.length).fill(-1);
  const isSlime = (i) => board[i] >= 0 && board[i] < 90;
  const eligible = [];
  const elig = new Set();
  for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) {
    const i = r * cols + c;
    if (!isSlime(i)) continue;
    if (isSlime(i - cols) && isSlime(i + cols) && isSlime(i - 1) && isSlime(i + 1)) { eligible.push(i); elig.add(i); }
  }
  if (eligible.length < 8) return null;
  // CLUSTERED "?" (user 2026-07-25: "cho 1 mảng gần nhau, để xa nhau trông vô nghĩa").
  // Grow a FEW connected blobs (BFS from random seeds) instead of scattering single
  // cells — a compact patch reads as a deliberate covered area, not noise.
  const target = Math.max(8, Math.round(eligible.length * frac));
  const nb = (i) => { const r = Math.floor(i / cols), c = i % cols; return [r > 0 ? i - cols : -1, r < rows - 1 ? i + cols : -1, c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1]; };
  let count = 0;
  const blobs = Math.max(1, Math.round(target / 60)); // one blob per ~60 hidden cells
  let guard = 0;
  while (count < target && guard++ < blobs + 40) {
    // start a new blob at a random still-eligible, not-yet-hidden cell
    const seeds = eligible.filter((i) => hidden[i] < 0);
    if (!seeds.length) break;
    const start = seeds[Math.floor(rng() * seeds.length)];
    const frontier = [start];
    while (frontier.length && count < target) {
      // pop a random frontier cell → organic (non-square) blob shape
      const k = Math.floor(rng() * frontier.length);
      const i = frontier.splice(k, 1)[0];
      if (hidden[i] >= 0 || !elig.has(i)) continue;
      hidden[i] = board[i]; count++;
      for (const j of nb(i)) if (j >= 0 && elig.has(j) && hidden[j] < 0) frontier.push(j);
    }
  }
  return count >= 8 ? { hidden, count } : null;
}

// ---- the port of generateNCars ---------------------------------------------
// Split the board's tiles into exactly N single-colour cars (>= #colours), each
// colour's cars sharing its tiles evenly → returns the flat car list (unordered).
// `extra` = additional per-colour tile counts (e.g. 2-layer bottoms) folded in so
// capacity covers BOTH layers.
function allocateCars(board, N, extraCounts) {
  const counts = new Map();
  for (const id of board) if (isColor(id)) counts.set(id, (counts.get(id) || 0) + 1);
  if (extraCounts) for (const [c, n] of extraCounts) counts.set(c, (counts.get(c) || 0) + n);
  const colorsPresent = [...counts.keys()].sort((a, b) => a - b);
  if (colorsPresent.length === 0) return [];

  const totalKeys = [...counts.values()].reduce((a, b) => a + b, 0);
  const minCars = colorsPresent.length;
  const target = Math.max(minCars, Math.min(totalKeys, N | 0));

  const alloc = new Map(colorsPresent.map((c) => [c, 1]));
  let extra = target - minCars;
  const rema = colorsPresent.map((c) => { const ideal = (counts.get(c) / totalKeys) * extra; return { c, floor: Math.floor(ideal), frac: ideal - Math.floor(ideal) }; });
  rema.forEach((r) => { alloc.set(r.c, alloc.get(r.c) + r.floor); extra -= r.floor; });
  rema.sort((a, b) => b.frac - a.frac);
  for (const r of rema) { if (extra <= 0) break; if (alloc.get(r.c) < counts.get(r.c)) { alloc.set(r.c, alloc.get(r.c) + 1); extra--; } }
  while (extra > 0) { const room = colorsPresent.find((c) => alloc.get(c) < counts.get(c)); if (room === undefined) break; alloc.set(room, alloc.get(room) + 1); extra--; }

  const carList = [];
  for (const c of colorsPresent) {
    const cars = alloc.get(c), keys = counts.get(c);
    const base = Math.floor(keys / cars), rem = keys % cars;
    for (let i = 0; i < cars; i++) carList.push({ color: c, count: base + (i < rem ? 1 : 0) });
  }
  return carList;
}
function generateCars(board, N, opts) {
  const { bias = 0, seed = 1, track = "square" } = opts || {};
  const carList = allocateCars(board, N);
  if (carList.length === 0) return { chests: [], bias: 0 };
  const { order, bias: achieved } = orderByDifficulty(carList, board, track, bias, seed);
  return { chests: order, bias: achieved };
}
// Extract linked-car index-groups (size ≥2 → twin/triple) from an order's pairId stamps.
function groupsOf(order) {
  const m = new Map();
  order.forEach((c, i) => { if (c && c.pairId != null) (m.get(c.pairId) || m.set(c.pairId, []).get(c.pairId)).push(i); });
  const out = []; for (const idxs of m.values()) if (idxs.length >= 2) out.push(idxs);
  return out;
}
// BURY ("chôn xe", reference game 2026-07-25): stamp `buried: true` on ~frac of the
// cars that DON'T start on the front row (index ≥ LANES) — the game shows them as a
// dark "?" until they reach their column front. Linked groups are buried all-or-none
// (they share a row, like the reference's side-by-side "?" twins). Mutates `order`.
function buryCars(order, frac, seed) {
  const rng = makeRng(seed);
  const done = new Set(); // pairIds already decided
  let buried = 0;
  order.forEach((c, i) => {
    if (i < LANES) return; // initial front row always starts face-up
    if (c.pairId != null) {
      if (done.has(c.pairId)) return;
      done.add(c.pairId);
      const g = order.map((x, j) => ({ x, j })).filter(({ x }) => x.pairId === c.pairId);
      if (g.some(({ j }) => j < LANES)) return; // group touches the front row → stays open
      if (rng() < frac) { g.forEach(({ x }) => { x.buried = true; }); buried += g.length; }
    } else if (rng() < frac) { c.buried = true; buried++; }
  });
  return buried;
}
// Place `pairs` xe đôi + `triples` xe ba on an order (consecutive same-row cols) and
// stamp pairId. Returns a fresh order (copied) so the caller's carList is never mutated.
function withGroups(order, board, track, pairs, triples, layer2 = null) {
  const copy = order.map((c) => ({ ...c }));
  if (!pairs && !triples) return { order: copy, groups: [] };
  const groups = pickGroups(copy, board, track, pairs || 0, triples || 0, LANES, layer2);
  let pid = 0; for (const g of groups) { pid++; for (const i of g) copy[i].pairId = pid; }
  return { order: copy, groups };
}
// Sweep burial strength → order whose average-tester win% is closest to `target`.
// With `twins`>0 the xe đôi are placed on each candidate and the win% is measured
// WITH the twin constraint, so difficulty is tuned accounting for them.
function calibrateOrder(carList, board, cols, rows, track, target, { skill = 0.6, trials = 60, seed = 1, twins = 0, triples = 0, layer2 = null, tray = false, biases = [0, 0.08, 0.16, 0.24, 0.32, 0.4, 0.48, 0.56, 0.64, 0.72] } = {}) {
  let best = null;
  const wantGroups = (twins || 0) + (triples || 0);
  for (const b of biases) {
    const { order, groups } = withGroups(orderAtBias(carList, board, track, b, seed + 6), board, track, twins, triples, layer2);
    const ok = groups.length ? solvablePairs(board, cols, rows, order, track, groups, 5, LANES, layer2) : solvable(board, cols, rows, order, track, 5, LANES, layer2);
    if (!ok) continue;
    const win = Math.round(testerReport(board, cols, rows, order, track, { skill, trials, seed, layer2, tray }).winRate * 100);
    // Difficulty should come FROM the linked groups (user): a candidate that places
    // more of the requested twins/triples beats a slightly-closer-to-target one.
    const score = Math.max(0, wantGroups - groups.length) * 1000 + Math.abs(win - target);
    if (!best || score < best.score || (score === best.score && b < best.b)) best = { b, win, order, score };
  }
  if (!best) {
    const { order } = withGroups(orderAtBias(carList, board, track, 0, seed + 6), board, track, twins, triples, layer2);
    const win = Math.round(testerReport(board, cols, rows, order, track, { skill, trials, seed, layer2, tray }).winRate * 100);
    best = { b: 0, win, order, score: Math.abs(win - target) };
  }
  return best;
}

// ---- per-level spec ---------------------------------------------------------
function difficulty(n) { if (n % 15 === 0) return "superhard"; if (n % 5 === 0) return "hard"; return "normal"; }
function colorsFor(n, diff) {
  if (diff === "superhard") return 12;
  if (n === 5) return 5;                 // hard tier but early → gentler
  if (diff === "hard") return 8;
  const explicit = { 1: 2, 2: 3, 3: 3, 4: 4, 6: 4 };
  return explicit[n] ?? 5;               // easy: ≤5
}
// How hard to bury the outer-layer colours (0 = easy peel order, →1 = inner-first).
// The 5-bay sim clamps this down per level if it would make the level unsolvable.
function biasFor(n, diff) {
  if (n <= 3) return 0;                                 // tutorial-friendly, stays easy
  if (diff === "superhard") return 0.78;
  if (diff === "hard") return 0.6;
  return Math.min(0.5, 0.15 + (n - 3) * 0.02);          // easy tiers ramp gently
}
// Target average-tester win-rate per level (user, 2026-07-23, updated for 100 levels).
// L1 ~100; L2-9 harder 60-80 (descending); easy L10+ ~90; hard ~62; super 15-35 (→25);
// the brutal every-30th (L30/60/90) ~10.
function targetWin(n, diff) {
  if (n === 1) return 100;
  if (n === 4) return 85;                                 // user override
  if (n <= 9) return Math.round(80 - (n - 2) * (20 / 7)); // L2=80 … L9=60
  if (n % 30 === 0) return 10;                             // L30/60/90 brutal
  if (diff === "superhard") return 25;                    // other super: 15-35 band
  if (diff === "hard") return 62;
  return 90;                                               // easy, L10+
}
function carsFor(n, diff, colors) {
  if (diff === "superhard") return colors * 2;   // 24
  if (diff === "hard") return colors * 2;         // 16 (L5: 10)
  return Math.min(10, colors * 2);                // easy ≤10
}
// arch ("u-ngược") is PAUSED. line/u before 11; square/rect ("2-line") from 11.
const TRACKS = {
  1: "line", 2: "u", 3: "u", 4: "u", 5: "u",
  6: "line", 7: "u", 8: "line", 9: "u", 10: "u",
  11: "square", 12: "rect", 13: "square", 14: "u", 15: "rect",
  16: "square", 17: "u", 18: "rect", 19: "square", 20: "u",
  21: "square", 22: "rect", 23: "square", 24: "u", 25: "rect",
  26: "square", 27: "rect", 28: "u", 29: "square", 30: "rect",
};

// ---- L1-10 slime-count ramp -------------------------------------------------
// Subject fills fewer/more cells by scaling it to a smaller/larger sub-grid
// (maxSide). Targets rise L1→L10; L1-5 are hard-capped at 100 slimes.
const EARLY_TARGET = [45, 60, 74, 86, 97, 125, 160, 195, 225, 260]; // L1..L10
// OBSTACLES: board codes >= OBST are hard-rock WALLS (never collected, never counted,
// permanently block rays) — used to wall off board edges into U / arch / line frontiers
// (user 2026-07-26). Only a COLOUR cell is 0..OBST-1.
const OBST = 90;
const isColor = (v) => v >= 0 && v < OBST;
const slimeCount = (board) => board.reduce((a, v) => a + (isColor(v) ? 1 : 0), 0);

function buildEarly(src, IW, IH, opts, n, prevCount) {
  const target = EARLY_TARGET[n - 1];
  const cap = n <= 5 ? 100 : Infinity;
  const cands = [];
  for (let ms = 6; ms <= 25; ms++) {
    const board = buildFromImage(src, IW, IH, { ...opts, maxSide: ms });
    if (board) cands.push({ ms, board, cnt: slimeCount(board) });
  }
  if (cands.length === 0) return null;
  // prefer: under cap AND strictly above the previous level → closest to target
  let pool = cands.filter((c) => c.cnt <= cap && c.cnt > prevCount);
  if (pool.length) { pool.sort((a, b) => Math.abs(a.cnt - target) - Math.abs(b.cnt - target)); return pool[0]; }
  // can't beat prev under the cap → take the biggest that still fits the cap
  const under = cands.filter((c) => c.cnt <= cap);
  if (under.length) { under.sort((a, b) => b.cnt - a.cnt); return under[0]; }
  cands.sort((a, b) => a.cnt - b.cnt); return cands[0];
}

// ---- difficulty tuning for the 100-level build ------------------------------
const distinctColors = (board) => new Set(board.filter(isColor)).size;
// Scatter fresh palette colours in until the board has ~targetColors distinct
// colours (each new colour ~6% of tiles) — the knob for making a level harder.
function ensureColors(board, targetColors, seed) {
  const b = board.slice();
  const idxs = []; for (let i = 0; i < b.length; i++) if (isColor(b[i])) idxs.push(i); // skip obstacles
  if (!idxs.length) return b;
  const rng = makeRng(seed);
  const present = new Set(b.filter(isColor));
  const avail = BRIGHT_IDS.filter((id) => !present.has(id)); // bright only — no dark colours
  let ai = 0;
  while (present.size < targetColors && ai < avail.length) {
    const nc = avail[ai++], chunk = Math.max(4, Math.round(idxs.length * 0.06));
    for (let t = 0; t < chunk; t++) b[idxs[Math.floor(rng() * idxs.length)]] = nc;
    present.add(nc);
  }
  return b;
}
// Reduce the board to at most `k` colours by repeatedly merging the least-common
// colour into its nearest surviving neighbour (by palette RGB) — used to make a
// level EASIER when it can't hit its target even at the fewest cars (user: "target
// khó quá thì giảm màu"). Keeps the picture recognizable (merges look-alikes).
function reduceColors(board, k, seed) {
  const b = board.slice();
  const rgbD = (a, c) => (a[0] - c[0]) ** 2 + (a[1] - c[1]) ** 2 + (a[2] - c[2]) ** 2;
  const present = () => { const s = new Set(); for (const v of b) if (isColor(v)) s.add(v); return [...s]; }; // skip obstacle codes (rock walls)
  let cols = present();
  while (cols.length > Math.max(1, k)) {
    const freq = new Map(cols.map((c) => [c, 0]));
    for (const v of b) if (v >= 0) freq.set(v, freq.get(v) + 1);
    const victim = cols.slice().sort((a, c) => freq.get(a) - freq.get(c))[0];
    let dst = null, bd = Infinity;
    for (const c of cols) { if (c === victim) continue; const d = rgbD(baseRgb[victim], baseRgb[c]); if (d < bd) { bd = d; dst = c; } }
    if (dst == null) break;
    for (let i = 0; i < b.length; i++) if (b[i] === victim) b[i] = dst;
    cols = present();
  }
  return b;
}
// Grow the subject outward by rings of slime in 2 mixed colours (a decorative border
// that also gives an outer peel ring). Adds up to `layers` rings, but stops early once
// the board fill reaches `fillTo` (0..1) if given — used to cover ≥70% of the board
// from L3 on (user 2026-07-23). All rings share the SAME 2 colours → a clean border.
// `inset` (default 0) leaves that many empty cells around the border so slime never
// touches the frame (user 2026-07-24: "slime sát viền quá").
// `palette` (optional) restricts the ring colours to that list — the kid pack passes
// COOL_IDS so borders are always soothing greens/blues (user 2026-07-24).
function addOuterLayers(board, cols, rows, layers, seed, fillTo, inset = 0, palette = null) {
  let b = board.slice();
  const rng = makeRng(seed);
  const present = new Set(b.filter((v) => v >= 0));
  const pool = palette || BRIGHT_IDS; // bright border colours only
  let avail = pool.filter((id) => !present.has(id));
  if (palette && avail.length < 2) avail = pool.slice(); // stay in-palette even if the subject reuses it
  const ring = [];
  for (let k = 0; k < 2 && avail.length; k++) ring.push(avail.splice(Math.floor(rng() * avail.length), 1)[0]);
  if (!ring.length) ring.push(...(palette ? palette.slice(0, 2) : [0, 3]));
  for (let layer = 0; layer < layers; layer++) {
    if (fillTo != null && slimeCount(b) / (cols * rows) >= fillTo) break;
    const toFill = [];
    for (let r = inset; r < rows - inset; r++) for (let c = inset; c < cols - inset; c++) {
      const i = r * cols + c; if (b[i] >= 0) continue;
      if ((r > 0 && b[i - cols] >= 0) || (r < rows - 1 && b[i + cols] >= 0) ||
          (c > 0 && b[i - 1] >= 0) || (c < cols - 1 && b[i + 1] >= 0)) toFill.push(i);
    }
    if (!toFill.length) break; // nothing more to grow within the inset area
    // Colour each border cell by its RECTANGULAR ring distance from the frame — thick
    // (3-cell) straight concentric bands aligned to the board, so the colours run in
    // clean straight lines, not a smudged organic blob (user 2026-07-24: "màu thẳng
    // hàng, tránh lem luốc, trộn ít").
    for (const i of toFill) {
      const rr = Math.floor(i / cols), cc = i % cols;
      const d = Math.min(rr, cc, rows - 1 - rr, cols - 1 - cc) - inset;
      b[i] = ring[Math.floor(Math.max(0, d) / 3) % ring.length];
    }
  }
  return b;
}
// Colours to seed a level with, given its win-rate target (lower target → more).
function baseColorsFor(target) {
  if (target >= 85) return 5;
  if (target >= 65) return 6;
  if (target >= 45) return 9;
  return 12; // super / brutal (ensureColors pushes higher during tuning)
}
// no arch (paused), no line (user 2026-07-23: all → U). Early levels use "u";
// loops appear from L10.
function trackFor(n, diff) {
  if (n <= 9) return "u";
  if (diff !== "normal") return (n % 2 === 0) ? "u" : "rect";
  return ["square", "rect", "u", "square", "rect"][n % 5];
}
// xe đôi per level: 2 on hard/super, 1 on even easy (from L8), else 0.
function twinsFor(n, diff) {
  if (n < 8) return 0;
  if (diff !== "normal") return 2;
  return (n % 2 === 0) ? 1 : 0;
}
// xe ba (triple, 3-car group): starts at L17; 1 on L20,25,30,45; the advanced pack
// (L101-120) gets one on every 3rd level (user 2026-07-24).
function triplesFor(n) {
  if (isKid(n)) return (n - KID_LO) % 10 === 6 ? 1 : 0; // thi thoảng xe ba
  if (n >= 101) return n % 3 === 0 ? 1 : 0;
  return n >= 17 && [20, 25, 30, 45].includes(n) ? 1 : 0;
}
// The ADVANCED pack L101-120 is all hard/super (every 5th = super).
function packDiff(n) {
  if (isKid(n)) return "normal"; // kid pack: always easy (targets come from the CSV cycle)
  if (n <= 100) return difficulty(n);
  return n % 5 === 0 ? "superhard" : "hard";
}
// 2-LAYER slime coverage per level: hard/super from L35 get a hidden bottom patch
// (~18% of the subject; super ~25%). L1-30 stay as approved (demo on L2 aside).
function layer2FracFor(n, diff, cfg) {
  if (process.env.L2FRAC != null) return Number(process.env.L2FRAC); // env override (e.g. add a 2-layer "màng" to a normally-flat level for extra difficulty)
  if (cfg && cfg.layer2Frac != null) return cfg.layer2Frac;
  if (isKid(n)) return (n - KID_LO) % 4 === 2 ? 0.10 : 0; // thi thoảng, mỏng — vẫn dễ
  if (n <= 45) { // design rule: 2-layer unlocked from L15; thickness scales with how HARD the target is (real slimes = friction), so low-target easy-tier levels still get bite
    if (n < 15) return 0;
    const tg = cfg && cfg.target != null ? cfg.target : (diff === "superhard" ? 20 : diff === "hard" ? 40 : 80);
    return tg <= 25 ? 0.26 : tg <= 40 ? 0.20 : tg <= 55 ? 0.14 : tg <= 70 ? 0.10 : tg <= 85 ? 0.07 : 0;
  }
  if (n >= 101) return diff === "superhard" ? 0.2 : 0.15; // advanced pack: always (thinner → smoother win landscape)
  if (n < 35 || diff === "normal") return 0;
  return diff === "superhard" ? 0.25 : 0.18;
}
// hidden "?" coverage: hard/super from L35, ~10% of interior cells (super ~14%).
function hiddenFracFor(n, diff, cfg) {
  if (cfg && cfg.hiddenFrac != null) return cfg.hiddenFrac;
  if (isKid(n)) return (n - KID_LO) % 5 === 3 ? 0.08 : 0; // thi thoảng "?" — nhẹ nhàng
  if (n <= 45) { // design rule: "?" unlocked from L21; more on harder targets (human-only friction)
    if (n < 21) return 0;
    const tg = cfg && cfg.target != null ? cfg.target : 80;
    return tg <= 40 ? 0.13 : tg <= 65 ? 0.09 : 0;
  }
  if (n >= 101) return diff === "superhard" ? 0.14 : 0.12; // advanced pack: always
  // hard/super from L20 (was L35): "?" hurts HUMANS but not the tester — the lever for
  // levels that measure on-target yet play too easy (user 2026-07-25: L20/25 vẫn dễ).
  if (n < 20 || diff === "normal") return 0;
  return diff === "superhard" ? 0.14 : 0.10;
}
// Land the tester's win-rate near `target`, MEASURED AT THIS LEVEL'S SKILL (ov.skill).
// Levers (user 2026-07-23): `max màu` is a colour CEILING — start there and REDUCE
// colours while the level is still too hard to reach target ("target khó quá thì giảm
// màu"); cars are swept within [colours .. min(maxxe, slime/3)] and the (count, order)
// closest to target is kept. xe đôi are placed & modelled per candidate.
function tuneToTarget(board0, track, target, n, diff, ov = {}) {
  const seed = n * 101 + 1 + (SEED_OFF * 7919); // --seedoff K explores alternate burial orders
  let twinsN = ov.twins != null ? ov.twins : twinsFor(n, diff);
  const triplesN = ov.triples != null ? ov.triples : 0; // xe ba (3-car groups)
  const skill = ov.skill != null ? ov.skill : 0.6;
  // 2-LAYER slimes: either a PRE-BUILT clean picture bottom (ov.layer2Pre, item 4 — top
  // is pinned, no colour-reduction), or ov.layer2Frac (0..1) covers ~that fraction with a
  // makeLayer2 patch. The tester/solver model the reveal; cars get extra capacity.
  const pinned = ov.layer2Pre != null; // clean two-layer → don't reshape the top board
  const L2 = pinned ? { layer2: ov.layer2Pre.layer2, count: ov.layer2Pre.count, counts: ov.layer2Pre.counts }
                    : (ov.layer2Frac ? makeLayer2(board0, BOARD_SIZE, BOARD_SIZE, ov.layer2Frac, seed + 11) : null);
  const l2extra = L2 ? L2.counts : null;
  const opt = { skill, trials: process.env.TUNE_TRIALS ? Number(process.env.TUNE_TRIALS) : 16, seed, twins: twinsN, triples: triplesN, layer2: L2 ? L2.layer2 : null, tray: !!ov.tray, biases: [0, 0.09, 0.18, 0.27, 0.36, 0.45, 0.54, 0.63, 0.72] };
  const slime = slimeCount(board0) + (L2 ? L2.count : 0); // bottoms add to the load
  // Slimes-per-car (car `count`) is the real feel knob: user wants count in 1..40 but
  // PREFERS 15..35 (ideal ≈ 25). So car count lives in [ceil(slime/40) .. floor(slime/12)]
  // and we bias selection toward the 15-35 band (cars ∈ [slime/35 .. slime/15]) nearest
  // the ideal ≈ slime/25. `minxe` is a hard floor that takes PRIORITY over `maxxe` (user
  // 2026-07-23). Difficulty comes from colours + burial (not tiny cars); too-hard → drop màu.
  const ceilColors = Math.min(MAX_COLORS, ov.colors != null ? ov.colors : baseColorsFor(target), Math.floor(slime / 3));

  const evalN = (board, N) => calibrateOrder(allocateCars(board, N, l2extra), board, BOARD_SIZE, BOARD_SIZE, track, target, opt);
  const sweepCars = (board) => {
    const lo = Math.max(distinctColors(board), ov.minCars != null ? ov.minCars : 0, Math.ceil(slime / 40)); // minxe + count≤40; minxe wins over maxxe
    const hi = Math.max(lo, Math.min(ov.maxCars != null ? ov.maxCars : 999, Math.floor(slime / 12)));
    const ideal = Math.max(lo, Math.min(hi, Math.round(slime / 25)));   // preferred ≈ 25 slimes/car
    const prefLo = Math.ceil(slime / 35), prefHi = Math.floor(slime / 15); // preferred count 15-35 band
    const cand = new Set([lo, hi, ideal, Math.max(lo, Math.min(hi, prefLo)), Math.max(lo, Math.min(hi, prefHi))]);
    const steps = Math.min(8, hi - lo);
    for (let s = 1; s < steps; s++) cand.add(lo + Math.round((hi - lo) * s / steps));
    const all = [...cand].sort((a, b) => a - b).map((N) => evalN(board, N));
    const within = all.filter((f) => Math.abs(f.win - target) <= 8);
    if (within.length) {
      // among on-target candidates prefer the most twins/triples placed (difficulty
      // should come from the groups), then car counts in the 15-35 band near ~25/car.
      const placed = (f) => groupsOf(f.order).length;
      const maxG = Math.max(...within.map(placed));
      const withG = within.filter((f) => placed(f) === maxG);
      const pref = withG.filter((f) => f.order.length >= prefLo && f.order.length <= prefHi);
      const pool = pref.length ? pref : withG;
      return pool.reduce((a, b) => (Math.abs(b.order.length - ideal) < Math.abs(a.order.length - ideal) ? b : a));
    }
    return all.reduce((a, b) => (b.score < a.score ? b : a)); // closest to target (score already prefers groups)
  };

  // Start at the colour ceiling; if still too hard, drop one colour at a time. With a
  // pinned clean two-layer (item 4) the TOP must keep its exact Y colours (the hidden
  // bottom carries the difficulty), so skip ensureColors + the colour-reduce sweep.
  let board = pinned ? board0.slice() : ensureColors(board0.slice(), ceilColors, seed + 3);
  let best = sweepCars(board), bestBoard = board;
  let k = distinctColors(board), guard = 0;
  while (!pinned && best.win < target - 8 && k > 2 && guard++ < 8) {
    k--;
    const b = reduceColors(board0.slice(), k, seed + 3);
    const f = sweepCars(b);
    if (Math.abs(f.win - target) < Math.abs(best.win - target)) { best = f; bestBoard = b; }
    if (f.win >= target - 8) break;
  }
  // HARD / SUPER still too EASY (colours + burial + cars can't reach the low target)?
  // Add xe đôi — the twin constraint (launch together, park 2 adjacent bays) ratchets
  // difficulty up. Bump one pair at a time until on target or the twin cap (user 2026-07-24).
  // Only AUTO-add twins when the config didn't pin a twin count. An explicit xedoi (incl.
  // 0) is respected — twins make the win-rate landscape binary/steep, so a level you want
  // smoothly tunable should set xedoi=0 and get its difficulty from colours + burial.
  const twinCap = ov.twins != null ? twinsN : (diff === "superhard" ? 6 : 4);
  let tg = 0;
  while (diff !== "normal" && best.win > target + 8 && twinsN < twinCap && tg++ < 6) {
    twinsN++;
    opt.twins = twinsN;
    const f = sweepCars(bestBoard);
    if (Math.abs(f.win - target) < Math.abs(best.win - target)) best = f;
    if (best.win <= target + 8) break;
  }
  return { board: bestBoard, chests: best.order, win: best.win, bias: best.b, layer2: L2 ? L2.layer2 : null };
}

// ---- preview PNG ------------------------------------------------------------
async function boardToPng(board, file, scale = 10) {
  const S = BOARD_SIZE * scale, buf = Buffer.alloc(S * S * 4);
  for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) {
    const v = board[r * BOARD_SIZE + c];
    const col = v >= OBST ? [110, 105, 100] : v >= 0 ? baseRgb[v] : [34, 34, 40]; // rock walls → grey
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const x = c * scale + dx, y = r * scale + dy, i = (y * S + x) * 4;
      buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = 255;
    }
  }
  await sharp(buf, { raw: { width: S, height: S, channels: 4 } }).png().toFile(file);
}

// ---- --pairs: mark xe đôi via Chest.pairId (matches the game's twin schema) ---
// Two chests sharing a pairId are twins; they must be CONSECUTIVE + same inventory
// row (adjacent columns). See [[twin-cars-mechanic]]. L8+; more on hard/super.
if (process.argv.includes("--pairs")) {
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  let total = 0, lvls = 0; let pid = 0;
  for (const k of Object.keys(data).map(Number).sort((a, b) => a - b)) {
    const L = data[k], track = L.track || "square", diff = difficulty(k);
    delete L.pairs; // remove the old (pre-pairId) representation
    for (const c of L.chests) delete c.pairId; // clean any previous run
    if (k < 8) continue;
    const want = diff === "superhard" ? 2 : diff === "hard" ? 2 : (k % 2 === 0 ? 1 : 0);
    const pairs = want > 0 ? pickGroups(L.chests, L.board, track, want, triplesFor(k)) : [];
    for (const g of pairs) { pid++; for (const i of g) L.chests[i].pairId = pid; }
    if (pairs.length) { lvls++; total += pairs.length; }
  }
  if (!DRY) { fs.writeFileSync(OUT, JSON.stringify(data, null, 2)); console.log(`✔ ${total} xe đôi (pairId) on ${lvls} levels (L8+) → ${path.relative(ROOT, OUT)}`); }
  else console.log(`(dry) ${total} xe đôi on ${lvls} levels`);
  process.exit(0);
}

// ---- --fix: adjust the levels ordering alone couldn't calibrate --------------
// Too-hard levels get MORE cars (more launches → easier); too-easy levels get
// ONE extra colour scattered in (more bay pressure → harder). Then re-calibrate
// the order to the target. Boards change only for the +colour levels.
if (process.argv.includes("--fix")) {
  const SKILL = Number(process.env.SKILL || 0.6);
  const TRIALS = Number(process.env.TRIALS || 60);
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const FIX = { 10: "cars", 20: "cars", 25: "color", 30: "color" };
  console.log(`Fix outliers — skill ${SKILL}, ${TRIALS} trials\n`);
  console.log("#   type   track  target before→after  detail");
  const changedBoards = [];
  for (const k of Object.keys(FIX).map(Number).sort((a, b) => a - b)) {
    const L = data[k], track = L.track || "square", diff = difficulty(k);
    const target = targetWin(k, diff);
    const before = Math.round(testerReport(L.board, L.cols, L.rows, L.chests, track, { skill: SKILL, trials: TRIALS, seed: k * 101 + 1 }).winRate * 100);
    let best, detail;
    if (FIX[k] === "cars") {
      const curN = L.chests.length;
      let pick = null;
      for (let N = curN + 2; N <= curN + 16; N += 2) {
        const carList = allocateCars(L.board, N);
        const b = calibrateOrder(carList, L.board, L.cols, L.rows, track, target, { skill: SKILL, trials: TRIALS, seed: k * 101 + 1 });
        if (!pick || Math.abs(b.win - target) < Math.abs(pick.win - target)) pick = { ...b, N };
        if (b.win >= target) break; // reached target; more cars only overshoots
      }
      best = pick; L.chests = pick.order.map((c) => ({ color: c.color, count: c.count }));
      detail = `${curN}→${pick.N} xe`;
    } else { // add ONE scattered colour, tuning how much of it to reach the target
      const present0 = new Set(L.board.filter((v) => v >= 0));
      let newCol = -1; for (let id = 0; id < BASE_N; id++) if (!present0.has(id)) { newCol = id; break; }
      let pick = null, pickBoard = null, pickFrac = 0;
      for (const frac of [0.08, 0.12, 0.16, 0.2]) {
        const board = L.board.slice();
        const rng = makeRng(k * 991 + 3);
        const idxs = []; for (let i = 0; i < board.length; i++) if (board[i] >= 0) idxs.push(i);
        const nChange = Math.max(6, Math.round(idxs.length * frac));
        for (let t = 0; t < nChange; t++) board[idxs[Math.floor(rng() * idxs.length)]] = newCol;
        const N = Math.max(L.chests.length, new Set(board.filter((v) => v >= 0)).size);
        const b = calibrateOrder(allocateCars(board, N), board, L.cols, L.rows, track, target, { skill: SKILL, trials: TRIALS, seed: k * 101 + 1 });
        if (!pick || Math.abs(b.win - target) < Math.abs(pick.win - target)) { pick = b; pickBoard = board; pickFrac = frac; }
        if (b.win <= target) break; // reached/below → more colour only overshoots
      }
      best = pick; L.board = pickBoard; changedBoards.push(k);
      L.chests = pick.order.map((c) => ({ color: c.color, count: c.count }));
      detail = `+1 màu (id ${newCol}), ${Math.round(pickFrac * 100)}%`;
    }
    console.log(String(k).padStart(2) + "  " + FIX[k].padEnd(6) + " " + track.padEnd(6) + " " +
      String(target).padStart(5) + " " + String(before).padStart(5) + "%→" + String(best.win).padStart(3) + "%  " + detail);
  }
  if (!DRY) {
    fs.writeFileSync(OUT, JSON.stringify(data, null, 2));
    for (const k of changedBoards) await boardToPng(data[k].board, path.join(PREVIEW_DIR, `L${String(k).padStart(2, "0")}.png`));
    console.log(`\n✔ written → ${path.relative(ROOT, OUT)}` + (changedBoards.length ? ` · boards changed (repreviewed): ${changedBoards.join(", ")}` : ""));
  } else console.log("\n(dry run — NOT written)");
  process.exit(0);
}

// ---- --calibrate: tune each level's car ORDER to hit its target win-rate ----
// Reads the CURRENT designed.json, keeps every board + track exactly as-is, and
// only re-orders the cars (the difficulty knob) so the average tester's win-rate
// lands near targetWin(). Writes back. Boards/tracks the user hand-edited survive.
if (process.argv.includes("--calibrate")) {
  const SKILL = Number(process.env.SKILL || 0.6);
  const TRIALS = Number(process.env.TRIALS || 60);
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const biases = [0, 0.08, 0.16, 0.24, 0.32, 0.4, 0.48, 0.56, 0.64, 0.72];
  console.log(`Auto-calibrate — skill ${SKILL}, ${TRIALS} trials, reorder cars only (boards/tracks kept)\n`);
  console.log("#   tier        track  target →win  bias  note");
  for (const k of Object.keys(data).map(Number).sort((a, b) => a - b)) {
    const L = data[k], track = L.track || "square", diff = difficulty(k);
    const cars = L.chests.map((c) => ({ color: c.color, count: c.count }));
    const target = targetWin(k, diff);
    let best = null, anySolvable = false;
    for (const b of biases) {
      const order = orderAtBias(cars, L.board, track, b, k * 101 + 7);
      if (!solvable(L.board, L.cols, L.rows, order, track)) continue;
      anySolvable = true;
      const win = Math.round(testerReport(L.board, L.cols, L.rows, order, track, { skill: SKILL, trials: TRIALS, seed: k * 101 + 1 }).winRate * 100);
      const score = Math.abs(win - target);
      // closest to target; on ties prefer the LOWER bias (least artificial burial)
      if (!best || score < best.score || (score === best.score && b < best.b)) best = { b, win, order, score };
    }
    if (!best) { // perfect solver can't clear it at any bias → keep easiest order, flag it
      const order = orderAtBias(cars, L.board, track, 0, k * 101 + 7);
      const win = Math.round(testerReport(L.board, L.cols, L.rows, order, track, { skill: SKILL, trials: TRIALS, seed: k * 101 + 1 }).winRate * 100);
      best = { b: 0, win, order, score: Math.abs(win - target) };
    }
    L.chests = best.order.map((c) => ({ color: c.color, count: c.count }));
    let note = "";
    if (!anySolvable) note = "⛔ KHÔNG giải được (perfect) — cần sửa board/xe";
    else if (best.win < target - 9) note = "⚠ khó hơn target — cần dễ board (bớt màu / thêm xe)";
    else if (best.win > target + 9) note = "⚠ dễ hơn target — ordering không hạ thêm được";
    console.log(String(k).padStart(2) + "  " + diff.padEnd(11) + " " + track.padEnd(6) + " " +
      String(target).padStart(4) + " " + String(best.win).padStart(4) + "%  " + best.b.toFixed(2) + "  " + note);
  }
  if (!DRY) {
    fs.writeFileSync(OUT, JSON.stringify(data, null, 2));
    console.log(`\n✔ re-ordered cars written → ${path.relative(ROOT, OUT)} (boards & tracks untouched)`);
  } else console.log("\n(dry run — designed.json NOT written)");
  process.exit(0);
}

// ---- --build-slam: BUILD + tune L101-115 from the CSV images, sweeping board SIZE (≤25,
// fast sim) × colours × lanes so each hits its target winrate at bays=5. Writes slam levels.
if (process.argv.includes("--build-slam")) {
  const CSVPATH = "C:/CuongPC/Game/Pixel Flow/Manythings/Design winrate/winratedesign1.csv";
  const SLICED = "C:/CuongPC/Game/Pixel Flow/public/art/level art/sliced";
  const TRIALS = Number(process.env.TRIALS || 40);
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(",").map(Number)) : null;
  const walk = (dir) => { let out = []; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) out = out.concat(walk(p)); else out.push(p); } return out; };
  const allImgs = walk(SLICED);
  const findImg = (name) => allImgs.find((p) => path.basename(p) === name);
  const rows = fs.readFileSync(CSVPATH, "utf8").split(/\r?\n/).slice(1);
  const specs = [];
  for (const line of rows) { const c = line.split(","); const lvl = parseInt(c[0], 10); if (!(lvl >= 1 && lvl <= 15)) continue; specs.push({ lvl, target: Number(c[2]), skill: Number(c[11]), img: c[16] }); }
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const sizes = process.env.SIZES ? process.env.SIZES.split(",").map(Number) : [16, 19, 22, 25];
  const Ks = process.env.KS ? process.env.KS.split(",").map(Number) : [3, 4, 5, 6, 7];
  const laneOpts = [4, 3];
  console.log(`Build-slam — ${TRIALS} trials, sweep size×K×lanes, bays=5\n`);
  console.log("lvl  target  →win   size  K  lanes  note");
  for (const sp of specs) {
    if (only && !only.has(100 + sp.lvl)) continue;
    const imgName = process.env.IMG || sp.img; // IMG env overrides the CSV image (swap a pathological subject)
    const imgPath = findImg(imgName);
    if (!imgPath) { console.log(`L${100 + sp.lvl}: img ${imgName} NOT FOUND`); continue; }
    const { data: raw, info } = await sharp(imgPath).ensureAlpha().resize(512, 512, { fit: "inside", withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
    let best = null;
    for (const size of sizes) {
      BOARD_SIZE = size;
      for (const K of Ks) {
        const board = buildPicture(raw, info.width, info.height, K);
        if (!board) continue;
        const cnt = {}; for (const v of board) if (v >= 0) cnt[v] = (cnt[v] || 0) + 1;
        const chests = []; for (const col of Object.keys(cnt)) { let r = cnt[col]; while (r > 0) { const n = Math.min(r, 10); chests.push({ color: +col, count: n }); r -= n; } }
        for (const lanes of laneOpts) {
          const win = Math.round(testerReport(board, size, size, chests, "square", { skill: sp.skill, trials: TRIALS, seed: sp.lvl * 101 + 1, tray: true, bays: 5, perRow: lanes }).winRate * 100);
          if (win <= 0) continue;
          const score = Math.abs(win - sp.target);
          if (!best || score < best.score || (score === best.score && lanes > best.lanes)) best = { size, K, lanes, win, board: board.slice(), chests, score };
        }
      }
    }
    if (!best) { console.log(`L${100 + sp.lvl}: no winnable build`); continue; }
    const L = { track: "square", cols: best.size, rows: best.size, board: best.board, chests: best.chests, slam: true };
    if (best.lanes !== DEFAULT_LANES) L.lanes = best.lanes;
    data[100 + sp.lvl] = L;
    const note = best.score <= 8 ? "✓" : (best.win < sp.target ? "⚠ khó hơn" : "⚠ dễ hơn");
    console.log(`${100 + sp.lvl}   ${String(sp.target).padStart(4)}   ${String(best.win).padStart(4)}   ${String(best.size).padStart(3)}  ${best.K}  ${best.lanes}     ${note}`);
  }
  const s = {}; for (const k of Object.keys(data).map(Number).sort((a, b) => a - b)) s[k] = data[k];
  fs.writeFileSync(OUT, JSON.stringify(s, null, 2));
  console.log(`\n✔ written → ${path.relative(ROOT, OUT)}`);
  process.exit(0);
}

// ---- --tune-slam: tune SLAM levels 100-114 to their per-level target+skill (from the
// L1-15 design CSV) by re-ordering/burying cars, graded with the SLAM (tray) winrate.
if (process.argv.includes("--tune-slam")) {
  const TRIALS = Number(process.env.TRIALS || 100);
  // Read the design targets+skill STRAIGHT from the user's CSV. L100+i ↔ CSV lvl 1+i.
  const CSVPATH = "C:/CuongPC/Game/Pixel Flow/Manythings/Design winrate/winratedesign1.csv";
  const rows = fs.readFileSync(CSVPATH, "utf8").split(/\r?\n/).slice(1);
  const SPEC = {};
  for (const line of rows) {
    const c = line.split(",");
    const lvl = parseInt(c[0], 10);
    if (!(lvl >= 1 && lvl <= 15)) continue;
    SPEC[100 + lvl] = { t: Number(c[2]), s: Number(c[11]) }; // L101↔L1 … L115↔L15; col3=target, col12=skill
  }
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const biases = [0];           // burial dropped for slam (weak/unreliable + slow); lanes is the lever
  const bayOpts = [5];          // bays ALWAYS 5 (Add booster → 6). Not a lever.
  const laneOpts = [4, 3];      // A: tune queue-lanes, minimum 3 (user 2026-07-27)
  console.log(`Tune-slam — ${TRIALS} trials, targets+skill FROM CSV, bays=5, search lanes{4,3}×burial\n`);
  console.log("lvl  target  skill  →win  bays lanes bias  note");
  for (const k of Object.keys(SPEC).map(Number)) {
    const L = data[k]; if (!L) continue;
    const track = L.track || "square";
    // CANONICAL car set (aggregate per colour → deterministic → idempotent tuning)
    const tot = new Map();
    for (const c of L.chests) tot.set(c.color, (tot.get(c.color) || 0) + c.count);
    const cars = [];
    for (const [color, total] of [...tot].sort((a, b) => a[0] - b[0])) { let r = total; while (r > 0) { const n = Math.min(r, 10); cars.push({ color, count: n }); r -= n; } }
    const { t: target, s: skill } = SPEC[k];
    let best = null;
    for (const lanes of laneOpts) {
      LANES = lanes;
      for (const bays of bayOpts) {
        for (const b of biases) {
          const order = orderAtBias(cars, L.board, track, b, k * 101 + 7);
          const win = Math.round(testerReport(L.board, L.cols, L.rows, order, track, { skill, trials: TRIALS, seed: k * 101 + 1, layer2: L.layer2 || null, tray: true, bays, perRow: lanes }).winRate * 100);
          if (win <= 0) continue;
          const score = Math.abs(win - target);
          // closest to target; tie → gentler design (more lanes, less burial)
          if (!best || score < best.score || (score === best.score && (lanes > best.lanes || (lanes === best.lanes && b < best.b)))) best = { b, bays, lanes, win, order, score };
        }
      }
    }
    if (!best) { LANES = laneOpts[laneOpts.length - 1]; const order = orderAtBias(cars, L.board, track, 0, k * 101 + 7); best = { b: 0, bays: 5, lanes: LANES, win: -1, order, score: 999 }; }
    L.chests = best.order.map((c) => ({ color: c.color, count: c.count }));
    if (best.bays !== 5) L.bays = best.bays; else delete L.bays;
    if (best.lanes !== DEFAULT_LANES) L.lanes = best.lanes; else delete L.lanes;
    let note = "";
    if (best.win < target - 8) note = "⚠ vẫn khó hơn target — cần bớt màu/board";
    else if (best.win > target + 8) note = "⚠ vẫn dễ hơn target";
    else note = "✓";
    console.log(String(k) + "   " + String(target).padStart(4) + "   " + skill.toFixed(1) + "   " + String(best.win).padStart(4) + "  " + String(best.bays).padStart(3) + "  " + String(best.lanes).padStart(4) + "  " + best.b.toFixed(1) + "  " + note);
  }
  if (!DRY) { fs.writeFileSync(OUT, JSON.stringify(data, null, 2)); console.log(`\n✔ written → ${path.relative(ROOT, OUT)}`); }
  process.exit(0);
}

// ---- --test: grade the CURRENT designed.json with the average tester --------
if (process.argv.includes("--test")) {
  const SKILL = Number(process.env.SKILL || 0.6);
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  console.log(`Average tester — skill ${SKILL}, 5 bays, 40 trials/level (no boosters)\n`);
  console.log("#   tier        track  win%  avgPeakBays");
  for (const k of Object.keys(data).map(Number).sort((a, b) => a - b)) {
    const L = data[k], track = L.track || "square";
    LANES = L.lanes || DEFAULT_LANES; // grade at the level's own queue-line count
    const r = testerReport(L.board, L.cols, L.rows, L.chests, track, { skill: SKILL, trials: 100, seed: k * 101 + 1 });
    const pct = Math.round(r.winRate * 100);
    const bar = "█".repeat(Math.round(pct / 5)).padEnd(20);
    console.log(String(k).padStart(2) + "  " + difficulty(k).padEnd(11) + " " + track.padEnd(6) + " " +
      String(pct).padStart(3) + "%  " + r.avgPeak.toFixed(1) + "  " + bar);
  }
  process.exit(0);
}

// ---- --tune-cars: fit each slam level's CARS (20-30 slimes each + twin count) to hit
// its target winrate under the choice model (skill 0.75). Board/image stay fixed; the
// lever is HOW MANY twin-pairs (xe đôi) — more twins = more bay-lock pressure = harder.
if (process.argv.includes("--tune-cars")) {
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const TARGET = { 101: 100, 102: 100, 103: 81, 104: 95, 105: 70, 106: 98, 107: 90, 108: 90, 109: 90, 110: 65, 111: 100, 112: 85, 113: 95, 114: 85, 115: 50,
    116: 100, 117: 93, 118: 90, 119: 80, 120: 65, 121: 100, 122: 85, 123: 90, 124: 90, 125: 60, 126: 100, 127: 80, 128: 75, 129: 75, 130: 45 };
  const SKILL = Number(process.env.SKILL) || 0.75;
  const TRIALS = Number(process.env.TRIALS) || 24;
  const ONLY = process.env.ONLY ? process.env.ONLY.split(",").map(Number) : null;
  const genCars = (board, layer2, seed, cmin, cmax) => {
    const rng = makeRng(seed); const cnt = new Map();
    for (const v of board) if (v >= 0 && v < 90) cnt.set(v, (cnt.get(v) || 0) + 1);
    if (layer2) for (const v of layer2) if (v >= 0) cnt.set(v, (cnt.get(v) || 0) + 1);
    const cars = [];
    for (const [color, total] of cnt) {
      let rem = total;
      while (rem > 0) {
        let c = Math.min(rem, cmin + Math.floor(rng() * (cmax - cmin + 1)));
        if (rem - c > 0 && rem - c < cmin) c = rem; // no tiny leftover car
        cars.push({ color, count: c }); rem -= c;
      }
    }
    return cars;
  };
  // round-robin by colour so the queue mixes colours (and twin pairs get 2 different colours)
  const interleave = (cars) => {
    const byCol = new Map(); for (const c of cars) { (byCol.get(c.color) || byCol.set(c.color, []).get(c.color)).push(c); }
    const lanes = [...byCol.values()]; const out = []; let any = true;
    while (any) { any = false; for (const l of lanes) if (l.length) { out.push(l.shift()); any = true; } }
    return out;
  };
  const withTwins = (order, t) => {
    const out = order.map((c) => ({ ...c })); delete out.pairId;
    for (const c of out) delete c.pairId;
    let made = 0;
    for (let i = 0; i + 1 < out.length && made < t; i += 2) { out[i].pairId = made + 1; out[i + 1].pairId = made + 1; made++; }
    return out;
  };
  const grade = (L, order, lanes) => { LANES = lanes; return Math.round(testerReport(L.board, L.cols, L.rows, order, L.track || "square", { skill: SKILL, trials: TRIALS, seed: 12345, layer2: L.layer2 || null, tray: false, autoDrive: true, slam: true, choiceModel: true, perRow: lanes, bays: 5 }).winRate * 100); };
  console.log(`Tune-cars — choice model, skill ${SKILL}, lever=carSize×twins @ lanes ${DEFAULT_LANES} (preferred 20-30)\n`);
  console.log("lvl  tgt  →win  car   twins order cars  note");
  // Difficulty ladder easy→hard: big cars/few twins first (keeps preferred 20-30 for easy
  // targets), then shrink cars + add twins for harder targets. Lanes stay at default — cutting
  // them cliffs the board to unwinnable (0%), a useless lever.
  const SIZES = [[24, 30], [18, 26], [12, 18], [8, 12], [5, 8]];
  const twinOpts = [0, 2, 4, 6, 8];
  for (let k = 101; k <= 130; k++) {
    if (ONLY && !ONLY.includes(k)) continue;
    const L = data[k]; if (!L) continue;
    const target = TARGET[k]; delete L.lanes;
    let best = null, done = false;
    // Pass 1 = interleaved (colours mixed → easy). Pass 2 = grouped (colours clustered →
    // forced order → hard). Only reach grouped if interleaved can't get low enough.
    for (const grouped of [false, true]) {
      if (best && best.win <= target + 8) break;
      for (let si = 0; si < SIZES.length && !done; si++) {
        const [cmin, cmax] = SIZES[si];
        const raw = genCars(L.board, L.layer2 || null, k * 777 + 3, cmin, cmax);
        const baseOrder = grouped ? raw : interleave(raw);
        for (const t of twinOpts) {
          if (t * 2 > baseOrder.length) break;
          const order = withTwins(baseOrder, t);
          const win = grade(L, order, DEFAULT_LANES);
          const score = Math.abs(win - target);
          if (!best || score < best.score) best = { grouped, si, t, win, order, score, cmin, cmax };
          if (win <= target) { done = true; break; }
        }
      }
      if (done) break;
    }
    L.chests = best.order;
    const note = best.score <= 8 ? "OK" : (best.win > target ? "vẫn dễ (nhiều màu)" : "hơi khó");
    console.log(`${k}  ${String(target).padStart(3)}  ${String(best.win).padStart(4)}  ${(best.cmin + "-" + best.cmax).padStart(5)}  ${String(best.t).padStart(4)}  ${(best.grouped ? "gộp" : "trộn").padStart(4)}  ${String(best.order.length).padStart(4)}  ${note}`);
  }
  const sorted = {}; for (const key of Object.keys(data).map(Number).sort((a, b) => a - b)) sorted[key] = data[key];
  fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2));
  console.log("\n✔ wrote tuned cars into designed.json");
  process.exit(0);
}

// DIRECT winrate model (user 2026-07-29). A perfect-memory player wins almost any SOLVABLE slam
// level (the mechanic rarely deadlocks with 5 bays), so a mechanical bay-lock sim is bimodal
// (0% or 100%) and useless for smooth targets. Instead: winrate = CEILING × COGNITIVE FACTOR.
//   • ceiling  = full-info careful play clears it? (~1 for solvable; <1 flags a logistics bug)
//   • load     = how much the level makes a HUMAN err: hidden "?" cars + colours + car count
//   • cog      = logistic(load): a smooth 100%→~0% curve as the board gets more confusing
// Params (LOAD_A/B/C, LOG_K/LOG_M) are calibrated to real playtests — few, each interpretable.
// ---- cognitive-load weights read from the user-editable CSV -------------------------
function parseCsvLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) { const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else { if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch; }
  }
  out.push(cur); return out;
}
let _WCACHE = null;
function loadWeights() {
  if (_WCACHE) return _WCACHE;
  const w = { LOG_M: 2.10, LOG_K: 2.45 };
  try {
    const p = path.join(ROOT, "..", "Pixel Flow", "Manythings", "Design winrate", "cognitive-load-weights.csv");
    const lines = fs.readFileSync(p, "utf8").split(/\r?\n/).slice(1).filter(Boolean);
    for (const line of lines) { const c = parseCsvLine(line); const key = c[0]; const val = Number(c[3]); const on = c[4];
      if (key && isFinite(val)) w[key] = (on === "0") ? 0 : val; }
  } catch { /* keep defaults */ }
  return (_WCACHE = w);
}
// palette (for colour-confusion factor)
const _PAL = ["#fe4038","#fe8f28","#fed734","#37cb5c","#2ac0cc","#408afa","#9756fd","#fd55a5","#ffffff","#cbcbcb","#4a4a4a","#985828","#262630","#3050a0","#e0b888","#98d0f0","#208038","#f8c0c8","#902030"]
  .map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
const _d2 = (a, b) => { const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return x * x + y * y + z * z; };

// ---- the ten cognitive-load factors, each normalised to ~[0,1] ----------------------
function cognitiveLoad(L, W) {
  const board = L.board, C = L.cols, R = L.rows, chests = L.chests;
  const track = L.track || "square";
  const filled = board.reduce((a, v) => a + (v >= 0 && v < 90 ? 1 : 0), 0) || 1;
  const nCars = chests.length || 1;
  const lanes = L.lanes || DEFAULT_LANES;
  const f = {};
  // ① buried, ② layer2, ③ hidden
  f.buried = chests.reduce((a, c) => a + (c.buried ? 1 : 0), 0) / nCars;
  f.layer2 = L.layer2 ? L.layer2.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0) / filled : 0;
  f.hidden = L.hidden ? L.hidden.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0) / filled : 0;
  // ④+⑤ frontier colour width — peel the board outside-in, average # distinct colours per layer
  {
    const edges = trackEdges(track), occ = board.slice(); let sum = 0, steps = 0, guard = 0;
    while (guard++ < 3000) {
      const E = exposedTiles(occ, C, R, edges); if (!E.size) break; // exposedTiles returns a Set
      const S = new Set(); for (const i of E) if (occ[i] >= 0 && occ[i] < 90) S.add(occ[i]);
      if (!S.size) break;
      sum += S.size; steps++;
      for (const i of E) if (occ[i] >= 0 && occ[i] < 90) occ[i] = -1; // clear this ring
    }
    f.roi_mau = Math.min(1, (steps ? sum / steps : 0) / 5); // ~5 colours at the frontier = max load
  }
  // ⑨ same colour buried across multiple lanes → "which lane to dig"
  {
    const byCol = new Map();
    chests.forEach((c, i) => { if (c.buried) { const ln = i % lanes; if (!byCol.has(c.color)) byCol.set(c.color, new Set()); byCol.get(c.color).add(ln); } });
    let s = 0; for (const set of byCol.values()) s += Math.max(0, set.size - 1);
    f.cung_mau_nhieu_hang = Math.min(1, s / Math.max(1, lanes));
  }
  // ② parallel twins sharing a colour → "which twin to pick", WEIGHTED by slime count
  // (a big-count twin is more painful to mis-choose). Also counts twins whose colours differ
  // but are all currently needed. Near 0 unless the level actually has ambiguous twins.
  {
    const groups = new Map();
    chests.forEach((c) => { if (c.pairId != null) { if (!groups.has(c.pairId)) groups.set(c.pairId, []); groups.get(c.pairId).push(c); } });
    const arr = [...groups.values()];
    let score = 0;
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const ci = new Set(arr[i].map((c) => c.color));
      if (arr[j].some((c) => ci.has(c))) { // share a colour → ambiguous choice
        const cnt = arr[i].concat(arr[j]).reduce((a, c) => a + c.count, 0);
        score += Math.min(1, cnt / 60); // big counts hurt more when you pick wrong
      }
    }
    f.xe_doi_giao_mau = Math.min(1, score);
  }
  // ③ BOARD order trap — "màu bị chôn ở dưới, giữa có màu không cần". Peel outside-in; for each
  // colour record the range of peel-layers it spans. A colour smeared across many layers means
  // you keep coming back to it (it re-buries needed colours) → real must-plan difficulty. This is
  // measured on the BOARD (peel structure), not the queue.
  {
    const edges = trackEdges(track), occ = board.slice();
    const first = new Map(), last = new Map(); let layer = 0, guard = 0;
    while (guard++ < 3000) {
      const E = exposedTiles(occ, C, R, edges); if (!E.size) break;
      const cs = new Set(); for (const i of E) if (occ[i] >= 0 && occ[i] < 90) cs.add(occ[i]);
      if (!cs.size) break;
      for (const c of cs) { if (!first.has(c)) first.set(c, layer); last.set(c, layer); }
      for (const i of E) if (occ[i] >= 0 && occ[i] < 90) occ[i] = -1;
      layer++;
    }
    let spread = 0, n = 0; for (const c of first.keys()) { spread += last.get(c) - first.get(c); n++; }
    f.bay_thu_tu = layer > 1 ? Math.min(1, (n ? spread / n : 0) / (layer - 1)) : 0;
  }
  // ⑥ twins, ⑧ colour confusion, length + raw colours
  f.xe_doi = chests.reduce((a, c) => a + (c.pairId != null ? 1 : 0), 0) / nCars;
  {
    const used = [...new Set(board.filter((v) => v >= 0 && v < 90))];
    let minD = Infinity;
    for (let i = 0; i < used.length; i++) for (let j = i + 1; j < used.length; j++) { const d = _d2(_PAL[used[i]], _PAL[used[j]]); if (d < minD) minD = d; }
    f.mau_nham = used.length < 2 ? 0 : Math.max(0, 1 - minD / 4000); // colours within ~63/chan = confusable
  }
  f.do_dai = Math.min(1.5, nCars / 25);
  f.so_mau_tho = new Set(board.filter((v) => v >= 0 && v < 90)).size / 12;
  // weighted sum
  let load = 0; for (const k in f) load += (W[k] || 0) * f[k];
  return { load, f };
}

function cogWinrate(L) {
  const W = loadWeights();
  LANES = L.lanes || DEFAULT_LANES;
  // ceiling: skill 0.95, full info (no choice model / no "?" blindness), no bay-lock → ~1 if solvable
  let ceil = 1;
  try { ceil = testerReport(L.board, L.cols, L.rows, L.chests, L.track || "square", { skill: 0.95, trials: 16, seed: 777, layer2: L.layer2 || null, tray: false, autoDrive: true, slam: false, choiceModel: false, bays: 5 }).winRate; }
  catch { ceil = 1; }
  const { load, f } = cognitiveLoad(L, W);
  const M = Number(process.env.LOG_M) || W.LOG_M || 2.10, K = Number(process.env.LOG_K) || W.LOG_K || 2.45;
  const cog = 1 / (1 + Math.exp(K * (load - M)));
  return { win: Math.round(ceil * cog * 100), ceil, load, cog, f };
}

// ---- IDEA B (user 2026-07-29) — MONOTONIC by construction --------------------------
// winrate = solvable × Π over the perfect-player line of (1 − (1−skill)·hazard_turn).
// We replay the SAME greedy line that solvablePairs() uses to prove a level winnable — it
// clears every solvable level without ever wedging, so removing player randomness (skill→1)
// can only HELP: the model is monotonic in skill by construction (the flaw that killed the
// Monte-Carlo version). Difficulty is entirely "lỡ tay": at each turn the player faces, a
// hazard rises with the four hard signals (blind "?", twin baggage, big-count-while-busy,
// buried key colour) and falls for an obvious-safe move — exactly the design we agreed.
//   hazard = clamp(w? + wđôi + wcount + wchôn − a·easy, 0, 1);  survival ×= 1 − (1−skill)·hazard
// Knobs (env, calibrated to playtests): IDEAB_EASY/Q/DOI/COUNT/CHON. `knobs` overrides env (for
// the calibrator); `ceilOverride` supplies a pre-measured ceil so a knob sweep skips the slow
// Monte-Carlo ceil each iteration (ceil is knob-independent).
const _CEIL_CACHE = new Map();
function ideaBCeil(L, key) {
  if (key != null && _CEIL_CACHE.has(key)) return _CEIL_CACHE.get(key);
  LANES = L.lanes || DEFAULT_LANES;
  // Measure ceil FORGIVINGLY (classic auto-drive, NOT slam bay-lock): ceil is meant to be pure
  // LOGISTICS headroom — "can a careful player collect every tile at all". Measuring under slam
  // bay-lock would false-negative solvable-but-tight big boards (the mechanical line wedges where a
  // smarter one wins) and wrongly ZERO a winnable level. Slam's bay pressure is carried by the
  // hazard model instead (its greedy line respects bays; w_count fires under bay pressure).
  let ceil = 1;
  try { ceil = testerReport(L.board, L.cols, L.rows, L.chests, L.track || "square", { skill: 0.92, trials: 20, seed: 777, layer2: L.layer2 || null, tray: false, autoDrive: true, slam: false, choiceModel: false, bays: 5 }).winRate; }
  catch { ceil = 1; }
  if (key != null) _CEIL_CACHE.set(key, ceil);
  return ceil;
}
function ideaBWinrate(L, skill, knobs, ceilOverride) {
  const track = L.track || "square";
  const cols = L.cols, rows = L.rows, bays = 5;
  const perRow = L.lanes || DEFAULT_LANES;
  const edges = trackEdges(track);
  const singlePass = track === "line" || track === "u" || track === "arch";
  // pairId groups (twins/triples) as index arrays — same shape solvablePairs expects
  const byPid = new Map();
  L.chests.forEach((c, i) => { if (c.pairId != null) { (byPid.get(c.pairId) || byPid.set(c.pairId, []).get(c.pairId)).push(i); } });
  const groupsIdx = [...byPid.values()].filter((g) => g.length >= 2);
  // CEIL = logistics headroom, measured softly (a careful, full-info, auto-drive player). Using a
  // soft Monte-Carlo avoids the greedy solver's FALSE negatives on big boards (it wedges where a
  // smarter line wins). ceil≈1 = clean logistics; ceil≈0 = the board itself is too tight to clear.
  const ceil = ceilOverride != null ? ceilOverride : ideaBCeil(L);
  if (ceil < 0.02) return { win: 0, ceil: 0, survival: 0, hard: 0 }; // logistics-broken → careful play can't clear

  // No W_EASY knob: in the event-based model "easy relief" is IMPLICIT — an obvious safe move simply
  // produces no hard-event (hz stays 0), so it never erodes survival. Only the 4 hard signals weigh in.
  const W_Q = knobs?.Q ?? Number(process.env.IDEAB_Q ?? 0.9);
  const W_DOI = knobs?.DOI ?? Number(process.env.IDEAB_DOI ?? 0.9);
  const W_COUNT = knobs?.COUNT ?? Number(process.env.IDEAB_COUNT ?? 0.6);
  const W_CHON = knobs?.CHON ?? Number(process.env.IDEAB_CHON ?? 0.7);

  const occ = L.board.slice();
  const lay = L.layer2 ? L.layer2.slice() : null;
  let remaining = occ.reduce((a, v) => a + (isColor(v) ? 1 : 0), 0) + (lay ? lay.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0) : 0);
  const clearCell = (i) => { if (lay && lay[i] >= 0) { occ[i] = lay[i]; lay[i] = -1; } else occ[i] = -1; remaining--; };
  const cars = L.chests.map((c) => ({ color: c.color, cap: c.count, grouped: false, buried: !!c.buried }));
  const groupCars = groupsIdx.map((idxs) => { const g = idxs.map((i) => cars[i]); g.forEach((c) => (c.grouped = true)); return g; });
  const columns = Array.from({ length: perRow }, () => []);
  cars.forEach((c, i) => columns[i % perRow].push(c));
  const parked = [];
  const gainOf = (color, E) => { let n = 0; for (const i of E) if (occ[i] === color) n++; return n; };
  const collect = (car) => {
    if (singlePass) { const E = exposedTiles(occ, cols, rows, edges); for (const i of E) { if (car.cap <= 0) break; if (occ[i] === car.color) { clearCell(i); car.cap--; } } }
    else { while (car.cap > 0) { const E = exposedTiles(occ, cols, rows, edges); let t = -1; for (const i of E) if (occ[i] === car.color) { t = i; break; } if (t < 0) break; clearCell(t); car.cap--; } }
  };
  const removeCar = (c) => { for (const col of columns) { const k = col.indexOf(c); if (k >= 0) { col.splice(k, 1); return; } } const p = parked.indexOf(c); if (p >= 0) parked.splice(p, 1); };
  const groupReady = (g) => g.every((c) => { if (parked.includes(c)) return true; for (const col of columns) { const k = col.indexOf(c); if (k >= 0) return col.slice(0, k).every((x) => g.includes(x)); } return false; });
  const unlockOf = (color, E) => { const o2 = occ.slice(); for (const i of E) if (o2[i] === color) o2[i] = -1; const E2 = exposedTiles(o2, cols, rows, edges); let n = 0; for (const i of E2) if (!E.has(i) && isColor(o2[i])) n++; return n; };

  let survival = 1, hardTurns = 0, guard = 0, peakBays = 0, tightTurns = 0;
  const sig = { q: 0, doi: 0, count: 0, chon: 0 };   // summed hazard contributed by each signal
  const nsig = { q: 0, doi: 0, count: 0, chon: 0 };  // # events per signal
  while (remaining > 0 && guard++ < L.chests.length * 6 + 100) {
    const E = exposedTiles(occ, cols, rows, edges);
    const S = new Set(); for (const i of E) S.add(occ[i]);
    const freeBays = bays - parked.length;
    if (parked.length > peakBays) peakBays = parked.length;   // how tight the bays ever get (perfect line)
    if (freeBays <= 1) tightTurns++;                          // turns spent at the deadlock edge

    const bayPressure = Math.max(0, Math.min(1, (2 - freeBays) / 2));
    // ---- CHOOSE the perfect-player greedy MOVE (identical priority to solvablePairs) ----
    // We first DECIDE the move, then attach a difficulty EVENT to it (counted ONCE), then execute.
    // Event-based (not per-turn) so a structure that lingers many turns isn't counted many times —
    // difficulty tracks the NUMBER of hard decisions, never the level's length.
    let pick = null; // {kind, g?|car?|j?}
    for (const g of groupCars) {
      if (g.every((c) => c.cap === 0) || !groupReady(g)) continue;
      if (!g.some((c) => c.cap > 0 && S.has(c.color))) continue;
      const own = g.filter((c) => parked.includes(c)).length;
      if (parked.length - own > bays - g.length) continue;
      pick = { kind: "group", g }; break;
    }
    if (!pick) {
      const singles = [...parked.filter((c) => !c.grouped), ...columns.map((c) => c[0]).filter((c) => c && !c.grouped)];
      for (const c of singles) if (c.cap > 0 && S.has(c.color)) { pick = { kind: "solo", car: c }; break; }
    }
    let nDigCols = 0;
    if (!pick) {
      const np = []; for (let j = 0; j < perRow; j++) { const f = columns[j][0]; if (f && !f.grouped) np.push(j); }
      nDigCols = np.length;
      if (np.length && parked.length < bays) { np.sort((a, b) => columns[b].length - columns[a].length); pick = { kind: "dig", j: np[0] }; }
    }
    if (!pick) {
      for (const g of groupCars) {
        if (g.every((c) => c.cap === 0) || !groupReady(g)) continue;
        if (parked.length > bays - g.length) continue;
        pick = { kind: "sendgroup", g }; break;
      }
    }
    if (!pick) break; // greedy line wedged early — use the hazards of the turns it DID play

    // ---- DIFFICULTY EVENT of the chosen move (the chance a HUMAN, not this perfect line, slips) ----
    // Each signal's contribution is tracked separately so calibration can SEE why a level is hard.
    let hz = 0;
    if (pick.kind === "solo") {
      // (1) w_? — launching a buried "?" car is a memory gamble; harder under bay pressure. Counted
      // ONCE per car (the first reveal) — relaunching it later isn't a gamble, you know its colour now.
      if (pick.car.buried && !pick.car._qSeen) { pick.car._qSeen = true; const c = W_Q * (0.5 + 0.5 * bayPressure); hz += c; sig.q += c; nsig.q++; }
      // (3) w_count — committing a big BLOCKER (won't empty now → locks a bay) at the PINCH point
      // (only ≤1 free bay left) with ≥3 colours tempting. Big cars are the norm, so this must be a
      // genuine crisis, not a routine commit — otherwise it re-fires every turn and conflates length.
      if (freeBays <= 1 && !parked.includes(pick.car) && gainOf(pick.car.color, E) < pick.car.cap) {
        const c = W_COUNT * Math.max(0, Math.min(1, (pick.car.cap - 18) / 12)) * Math.max(0, Math.min(1, (S.size - 2) / 2));
        if (c > 0) { hz += c; sig.count += c; nsig.count++; }
      }
    } else if (pick.kind === "group") {
      // (2) w_đôi — a twin forced to carry BAGGAGE: one member useful (∈S), another wasted (∉S) → clogs a bay.
      const g = pick.g;
      const useful = g.some((c) => c.cap > 0 && S.has(c.color)), waste = g.some((c) => c.cap > 0 && !S.has(c.color));
      if (useful && waste) { const c = W_DOI * Math.min(g.reduce((s, c) => s + c.cap, 0) / 60, 1); hz += c; sig.doi += c; nsig.doi++; }
    } else if (pick.kind === "dig") {
      // (4) w_chôn — the TRUE "ABC/DEF/XXX" trap: you're forced to dig, the WHOLE exposed frontier
      // is dead surface (peeling any of it opens nothing), a genuinely big colour sits buried under
      // it, and there are ≥2 columns to choose between (which row do I dig toward the key?). Routine
      // digging (some surface still opens things, or nothing valuable buried) is NOT this.
      let lowSurface = 0; for (const c of S) if (unlockOf(c, E) <= 1) lowSurface++;
      let buriedBig = 0; const rc = new Map(); for (const v of occ) if (isColor(v)) rc.set(v, (rc.get(v) || 0) + 1);
      for (const [col, ct] of rc) if (!S.has(col) && ct > buriedBig) buriedBig = ct;
      if (S.size >= 3 && lowSurface === S.size && buriedBig >= 15 && nDigCols >= 2) {
        const c = W_CHON * Math.max(0, Math.min(1, (nDigCols - 1) / 2)) * Math.min(1, buriedBig / 25);
        hz += c; sig.chon += c; nsig.chon++;
      }
    }
    if (hz > 0.05) { survival *= (1 - (1 - skill) * Math.min(1, hz)); hardTurns++; }

    // ---- EXECUTE the chosen move ----
    if (pick.kind === "group" || pick.kind === "sendgroup") {
      const g = pick.g; for (const c of g) removeCar(c); for (const c of g) collect(c);
      if (!g.every((c) => c.cap === 0)) for (const c of g) parked.push(c);
    } else if (pick.kind === "solo") {
      const c = pick.car, wasParked = parked.includes(c); collect(c);
      if (c.cap === 0) removeCar(c); else if (!wasParked) { removeCar(c); if (parked.length < bays) parked.push(c); }
    } else if (pick.kind === "dig") {
      parked.push(columns[pick.j].shift());
    }
  }
  // WEDGE: the natural greedy line got STUCK although ceil says the board IS clearable → it's a
  // tricky reroute puzzle. An average player mostly gets stuck too; only sharper play finds the
  // non-obvious escape → scale by skill (stays monotonic). Flagged so calibration can spot these.
  const cleared = remaining === 0;
  if (!cleared && ceil >= 0.02) survival *= skill;
  return { win: Math.round(ceil * survival * 100), ceil, survival, hard: hardTurns, cleared, sig, nsig, peakBays, tightTurns };
}

// ---- --slamgrade: one-process grade of L101-115 under the CORRECT slam model -------
// (non-tray auto-drive = the same algorithm that grades classic L1-15) + no-juggle
// (slam can't push extra cars beyond its 5 bays). Grades each at its DESIGN skill vs
// the L1-15 CSV target. TRIALS env (default 40) trades accuracy for speed on big boards.
if (process.argv.includes("--slamgrade")) {
  if (process.env.NOJUGGLE == null) process.env.NOJUGGLE = "1"; // slam: no "extra cars beyond bays" escape hatch (override with NOJUGGLE=0)
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const TRIALS = Number(process.env.TRIALS) || 40;
  const FIXED_SKILL = process.env.SKILL != null ? Number(process.env.SKILL) : 0.75; // user: average-good player, fixed
  // targets: L101-115 = classic L1-15; L116-130 = the 50→10% difficulty ramp (user 2026-07-29)
  const TG = { 101: 100, 102: 100, 103: 81, 104: 95, 105: 70, 106: 98, 107: 90, 108: 90, 109: 90, 110: 65, 111: 100, 112: 85, 113: 95, 114: 85, 115: 50,
    116: 50, 117: 50, 118: 45, 119: 40, 120: 40, 121: 35, 122: 30, 123: 30, 124: 25, 125: 20, 126: 20, 127: 15, 128: 15, 129: 10, 130: 10 };
  console.log(`Slam grade — DIRECT model: ceiling × logistic(cognitive load)\n`);
  console.log("lvl   tgt  →win   ceil  load  note");
  const only = process.env.ONLY ? process.env.ONLY.split(",").map(Number) : null;
  for (let k = 101; k <= 150; k++) {
    if (only && !only.includes(k)) continue;
    const L = data[k]; if (!L || !L.slam) continue;
    // MECH=1: grade with the OLD mechanical sim (skill-slip Monte Carlo) instead of cogWinrate,
    // to test "old algorithm + cap-5". Flags: NOLOCK (non-tray classic), NOJUGGLE (cap 5),
    // CHOICE (choice model), AUTODRIVE (reliable relaunch), SKILL.
    let win, ceil = 1, load = 0, f = {};
    if (process.env.IDEAB === "1") {
      // IDEA B (user 2026-07-29): monotonic-by-construction — solvable × Π(1−(1−skill)·hazard)
      // over the perfect-player line. FIXED_SKILL (design player). ceil = solvable (0/1).
      LANES = L.lanes || DEFAULT_LANES;
      const r = ideaBWinrate(L, FIXED_SKILL);
      win = r.win; ceil = r.ceil; load = r.hard; f = {};
    } else if (process.env.MECH === "1") {
      LANES = L.lanes || DEFAULT_LANES;
      const sk = Number(process.env.SKILL) || 0.7;
      const r = testerReport(L.board, L.cols, L.rows, L.chests, L.track || "square", { skill: sk, trials: 60, seed: k * 101 + 1, layer2: L.layer2 || null, tray: false, autoDrive: process.env.AUTODRIVE === "1", slam: process.env.NOLOCK !== "1", choiceModel: process.env.CHOICE === "1", bays: 5 });
      win = Math.round(r.winRate * 100);
    } else {
      ({ win, ceil, load, f } = cogWinrate(L));
    }
    const t = TG[k], gap = win - t;
    const note = Math.abs(gap) <= 8 ? "OK" : (gap > 0 ? "dễ +" + gap : "khó " + gap);
    if (process.env.FACTORS === "1") {
      const parts = Object.entries(f).filter(([, v]) => v >= 0).sort((a, b) => b[1] - a[1]).map(([k2, v]) => `${k2}=${v.toFixed(2)}`).join(" ");
      console.log(`L${k}  win=${win}  ceil=${Math.round(ceil * 100)}  load=${load.toFixed(2)}  | ${parts}`);
    } else {
      console.log(`L${k}  ${String(t).padStart(3)}  ${String(win).padStart(4)}   ${String(Math.round(ceil * 100)).padStart(3)}  ${load.toFixed(2)}  ${note}`);
    }
  }
  process.exit(0);
}

// ---- --ideacal: auto-CALIBRATE the 5 idea-B knobs (Q/DOI/COUNT/CHON/EASY) to the winrate
// targets, by coordinate descent. ideaBWinrate is deterministic (one greedy line) so grading is
// fast; ceil is knob-independent so we measure it ONCE per level and reuse. Run this the moment the
// remapped maps land: `IDEAB=1 node scripts/build-levels.mjs --ideacal`. Targets come from
// Manythings/Design winrate/slam-targets.csv (rows "level,target") if present, else the built-ins.
if (process.argv.includes("--ideacal")) {
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const SKILL = process.env.SKILL != null ? Number(process.env.SKILL) : 0.75;
  // targets — editable CSV overrides the built-in ramp
  const TG = { 101: 100, 102: 100, 103: 81, 104: 95, 105: 70, 106: 98, 107: 90, 108: 90, 109: 90, 110: 65, 111: 100, 112: 85, 113: 95, 114: 85, 115: 50,
    116: 50, 117: 50, 118: 45, 119: 40, 120: 40, 121: 35, 122: 30, 123: 30, 124: 25, 125: 20, 126: 20, 127: 15, 128: 15, 129: 10, 130: 10 };
  try {
    const p = path.join(ROOT, "..", "Pixel Flow", "Manythings", "Design winrate", "slam-targets.csv");
    const lines = fs.readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean);
    for (const ln of lines) { const [a, b] = ln.split(","); const lv = Number(a), tg = Number(b); if (lv >= 100 && isFinite(tg)) TG[lv] = tg; }
    console.log(`(targets loaded from slam-targets.csv)`);
  } catch { /* built-in ramp */ }
  const only = process.env.ONLY ? process.env.ONLY.split(",").map(Number) : null;
  // level set + one-time ceil per level (skip logistics-broken ceil≈0 — they can't be calibrated)
  const levels = [];
  for (let k = 101; k <= 130; k++) {
    if (only && !only.includes(k)) continue;
    const L = data[k]; if (!L || !L.slam || TG[k] == null) continue;
    const ceil = ideaBCeil(L, k);
    levels.push({ k, L, tg: TG[k], ceil });
  }
  const broken = levels.filter((x) => x.ceil < 0.02).map((x) => x.k);
  if (broken.length) console.log(`⚠ logistics-broken (ceil≈0, excluded from fit — need map fix): ${broken.join(", ")}`);
  const fit = levels.filter((x) => x.ceil >= 0.02);

  const KEYS = ["Q", "DOI", "COUNT", "CHON"];
  const GRID = { Q: [0, .4, .7, .9, 1.2, 1.6, 2, 2.5], DOI: [0, .4, .7, .9, 1.2, 1.6, 2, 2.5], COUNT: [0, .3, .6, .9, 1.2, 1.6, 2], CHON: [0, .3, .6, .9, 1.2, 1.6, 2] };
  let best = { Q: 0.9, DOI: 0.9, COUNT: 0.6, CHON: 0.7 };
  const err = (knobs) => {
    let e = 0;
    for (const x of fit) { const w = ideaBWinrate(x.L, SKILL, knobs, x.ceil).win; e += Math.abs(w - x.tg); }
    return e;
  };
  let cur = err(best);
  console.log(`\nCoordinate descent (skill ${SKILL}, ${fit.length} levels), start err=${cur} …`);
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (const key of KEYS) {
      let bv = best[key], be = cur;
      for (const v of GRID[key]) { const trial = { ...best, [key]: v }; const e = err(trial); if (e < be) { be = e; bv = v; } }
      if (bv !== best[key]) { best[key] = bv; cur = be; improved = true; }
    }
    console.log(`  pass ${pass + 1}: err=${cur}  { ${KEYS.map((k) => `${k}:${best[k]}`).join(", ")} }`);
    if (!improved) break;
  }
  console.log(`\nBEST knobs → mean abs error ${(cur / fit.length).toFixed(1)}%/level`);
  console.log(`  IDEAB_Q=${best.Q} IDEAB_DOI=${best.DOI} IDEAB_COUNT=${best.COUNT} IDEAB_CHON=${best.CHON}\n`);
  console.log("lvl  tgt win ceil   w_?        w_đôi      w_count    w_chôn    note   (hazardΣ×events)");
  for (const x of levels) {
    const r = ideaBWinrate(x.L, SKILL, best, x.ceil);
    const gap = r.win - x.tg;
    let note = x.ceil < 0.02 ? "BROKEN(ceil0)" : Math.abs(gap) <= 8 ? "OK" : (gap > 0 ? "dễ +" + gap : "khó " + gap);
    if (r.cleared === false && x.ceil >= 0.02) note += " ⚠wedge";
    const S = r.sig || { q: 0, doi: 0, count: 0, chon: 0 }, N = r.nsig || { q: 0, doi: 0, count: 0, chon: 0 };
    const fmt = (v, n) => (n ? `${v.toFixed(1)}×${n}` : "—").padEnd(10);
    console.log(`L${x.k} ${String(x.tg).padStart(4)}${String(r.win).padStart(4)}${String(Math.round(x.ceil * 100)).padStart(5)}  peak${r.peakBays}/5 tight${String(r.tightTurns).padStart(2)}  ${fmt(S.q, N.q)} ${fmt(S.doi, N.doi)} ${fmt(S.count, N.count)} ${fmt(S.chon, N.chon)} ${note}`);
  }
  process.exit(0);
}

// Shared analyzer for the twin-decision meter (used by --twincheck and --tunetwins). Pass chestsArg to
// evaluate a HYPOTHETICAL pairing without mutating the level. Returns {nDec, nTrivial, nMeaningful, ...}.
function analyzeTwins(L, chestsArg, opts = {}) {
  const _ch = chestsArg || L.chests;
  const allForks = !!opts.allForks; // true → measure EVERY decision fork, not just twin ones
  const track = L.track || "square", cols = L.cols, rows = L.rows, bays = 5, perRow = L.lanes || DEFAULT_LANES;
  const edges = trackEdges(track);
  const initState = () => {
    const cars = _ch.map((c) => ({ color: c.color, cap: c.count, pairId: c.pairId ?? null }));
    const columns = Array.from({ length: perRow }, () => []);
    cars.forEach((c, i) => columns[i % perRow].push(i));
    return { occ: L.board.slice(), cars, columns, parked: [] };
  };
  const clone = (s) => ({ occ: s.occ.slice(), cars: s.cars.map((c) => ({ ...c })), columns: s.columns.map((col) => col.slice()), parked: s.parked.slice() });
  const groupsOf = (s) => { const m = new Map(); s.cars.forEach((c, i) => { if (c.pairId != null) (m.get(c.pairId) || m.set(c.pairId, []).get(c.pairId)).push(i); }); return [...m.values()].filter((g) => g.length >= 2); };
  const remaining = (s) => s.occ.reduce((a, v) => a + (isColor(v) ? 1 : 0), 0);
  const collect = (s, ci) => { const car = s.cars[ci]; while (car.cap > 0) { const E = exposedTiles(s.occ, cols, rows, edges); let t = -1; for (const i of E) if (s.occ[i] === car.color) { t = i; break; } if (t < 0) break; s.occ[t] = -1; car.cap--; } };
  const removeCar = (s, ci) => { for (const col of s.columns) { const k = col.indexOf(ci); if (k >= 0) { col.splice(k, 1); return; } } const p = s.parked.indexOf(ci); if (p >= 0) s.parked.splice(p, 1); };
  const grouped = (s, ci) => s.cars[ci].pairId != null && groupsOf(s).some((g) => g.includes(ci));
  const groupReady = (s, g) => g.every((ci) => { if (s.parked.includes(ci)) return true; for (const col of s.columns) { const k = col.indexOf(ci); if (k >= 0) return col.slice(0, k).every((x) => g.includes(x)); } return false; });
  const moves = (s) => {
    const E = exposedTiles(s.occ, cols, rows, edges); const S = new Set(); for (const i of E) S.add(s.occ[i]);
    const gs = groupsOf(s), out = [];
    for (const g of gs) { if (g.every((ci) => s.cars[ci].cap === 0) || !groupReady(s, g)) continue;
      if (!g.some((ci) => s.cars[ci].cap > 0 && S.has(s.cars[ci].color))) continue;
      const own = g.filter((ci) => s.parked.includes(ci)).length; if (s.parked.length - own > bays - g.length) continue;
      out.push({ kind: "group", g }); }
    const gset = new Set(gs.flat());
    const singles = [...s.parked.filter((ci) => !gset.has(ci)), ...s.columns.map((c) => c[0]).filter((ci) => ci != null && !gset.has(ci))];
    for (const ci of singles) if (s.cars[ci].cap > 0 && S.has(s.cars[ci].color)) out.push({ kind: "solo", ci });
    return out;
  };
  const apply = (s, mv) => {
    if (mv.kind === "group") { for (const ci of mv.g) removeCar(s, ci); for (const ci of mv.g) collect(s, ci); if (!mv.g.every((ci) => s.cars[ci].cap === 0)) for (const ci of mv.g) s.parked.push(ci); }
    else { const ci = mv.ci, wasP = s.parked.includes(ci); collect(s, ci); if (s.cars[ci].cap === 0) removeCar(s, ci); else if (!wasP) { removeCar(s, ci); if (s.parked.length < bays) s.parked.push(ci); } }
  };
  const dig = (s) => { const np = []; for (let j = 0; j < perRow; j++) { const ci = s.columns[j][0]; if (ci != null && !grouped(s, ci)) np.push(j); } if (!np.length || s.parked.length >= bays) return false; np.sort((a, b) => s.columns[b].length - s.columns[a].length); s.parked.push(s.columns[np[0]].shift()); return true; };
  const finish = (s, guard0 = 0) => {
    let guard = guard0, peak = s.parked.length;
    while (remaining(s) > 0 && guard++ < _ch.length * 8 + 200) {
      if (s.parked.length > peak) peak = s.parked.length;
      const mv = moves(s); if (mv.length) { apply(s, mv[0]); continue; }
      if (dig(s)) continue;
      let sent = false; for (const g of groupsOf(s)) { if (g.every((ci) => s.cars[ci].cap === 0) || !groupReady(s, g)) continue; if (s.parked.length > bays - g.length) continue; for (const ci of g) removeCar(s, ci); for (const ci of g) collect(s, ci); if (!g.every((ci) => s.cars[ci].cap === 0)) for (const ci of g) s.parked.push(ci); sent = true; break; }
      if (!sent) break;
    }
    return { cleared: remaining(s) === 0, peak };
  };
  let s = initState(), guard = 0, nDec = 0, nTrivial = 0, meaningful = [];
  while (remaining(s) > 0 && guard++ < _ch.length * 8 + 200) {
    const mv = moves(s);
    if (mv.length) {
      const twinMoves = mv.filter((m) => m.kind === "group");
      const alts = mv.filter((m) => m.kind !== "group");
      // twin mode: fork only where a twin competes. allForks: fork EVERY ≥2-choice turn.
      const choices = allForks ? mv : (twinMoves.length ? [...twinMoves, ...(alts.length ? [alts[0]] : [])] : []);
      if (choices.length >= 2) {
        const outs = choices.map((c) => { const s2 = clone(s); apply(s2, c); return finish(s2, guard); });
        nDec++;
        const allClear = outs.every((o) => o.cleared);
        const peaks = outs.map((o) => o.peak); const spread = Math.max(...peaks) - Math.min(...peaks);
        if (allClear && spread <= 1) nTrivial++;
        else meaningful.push({ turn: guard, allClear, spread });
      }
      apply(s, mv[0]); continue;
    }
    if (dig(s)) continue;
    let sent = false; for (const g of groupsOf(s)) { if (g.every((ci) => s.cars[ci].cap === 0) || !groupReady(s, g)) continue; if (s.parked.length > bays - g.length) continue; for (const ci of g) removeCar(s, ci); for (const ci of g) collect(s, ci); if (!g.every((ci) => s.cars[ci].cap === 0)) for (const ci of g) s.parked.push(ci); sent = true; break; }
    if (!sent) break;
  }
  return { nDec, nTrivial, nMeaningful: meaningful.length, meaningful, cleared: remaining(s) === 0 };
}

// ---- --twincheck (user's idea 2026-07-29): does each TWIN create a REAL decision? At every point the
// bot can launch a twin AND has an alternative, we fork: try each choice, then finish with perfect play,
// and compare OUTCOMES. If every choice still clears with the same bay pressure → the twin is TRIVIAL
// (any choice is fine → no thinking). If a choice leads to deadlock / much worse pressure → MEANINGFUL
// (choosing wrong hurts). Reports per level how many twin decisions are trivial vs meaningful → an
// objective gauge of whether the twin design is too easy. Run: node scripts/build-levels.mjs --twincheck
if (process.argv.includes("--twincheck")) {
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const LEVELS = (process.env.ONLY ? process.env.ONLY.split(",") : []).map(Number);
  const analyze = (L) => {
    const track = L.track || "square", cols = L.cols, rows = L.rows, bays = 5, perRow = L.lanes || DEFAULT_LANES;
    const edges = trackEdges(track);
    const initState = () => {
      const cars = L.chests.map((c) => ({ color: c.color, cap: c.count, pairId: c.pairId ?? null }));
      const columns = Array.from({ length: perRow }, () => []);
      cars.forEach((c, i) => columns[i % perRow].push(i));
      return { occ: L.board.slice(), cars, columns, parked: [] };
    };
    const clone = (s) => ({ occ: s.occ.slice(), cars: s.cars.map((c) => ({ ...c })), columns: s.columns.map((col) => col.slice()), parked: s.parked.slice() });
    const groupsOf = (s) => { const m = new Map(); s.cars.forEach((c, i) => { if (c.pairId != null) (m.get(c.pairId) || m.set(c.pairId, []).get(c.pairId)).push(i); }); return [...m.values()].filter((g) => g.length >= 2); };
    const remaining = (s) => s.occ.reduce((a, v) => a + (isColor(v) ? 1 : 0), 0);
    const collect = (s, ci) => { const car = s.cars[ci]; while (car.cap > 0) { const E = exposedTiles(s.occ, cols, rows, edges); let t = -1; for (const i of E) if (s.occ[i] === car.color) { t = i; break; } if (t < 0) break; s.occ[t] = -1; car.cap--; } };
    const removeCar = (s, ci) => { for (const col of s.columns) { const k = col.indexOf(ci); if (k >= 0) { col.splice(k, 1); return; } } const p = s.parked.indexOf(ci); if (p >= 0) s.parked.splice(p, 1); };
    const grouped = (s, ci) => s.cars[ci].pairId != null && groupsOf(s).some((g) => g.includes(ci));
    const groupReady = (s, g) => g.every((ci) => { if (s.parked.includes(ci)) return true; for (const col of s.columns) { const k = col.indexOf(ci); if (k >= 0) return col.slice(0, k).every((x) => g.includes(x)); } return false; });
    // list the greedy candidate MOVES at a state, in perfect-player priority order
    const moves = (s) => {
      const E = exposedTiles(s.occ, cols, rows, edges); const S = new Set(); for (const i of E) S.add(s.occ[i]);
      const gs = groupsOf(s), out = [];
      for (const g of gs) { if (g.every((ci) => s.cars[ci].cap === 0) || !groupReady(s, g)) continue;
        if (!g.some((ci) => s.cars[ci].cap > 0 && S.has(s.cars[ci].color))) continue;
        const own = g.filter((ci) => s.parked.includes(ci)).length; if (s.parked.length - own > bays - g.length) continue;
        out.push({ kind: "group", g }); }
      const gset = new Set(gs.flat());
      const singles = [...s.parked.filter((ci) => !gset.has(ci)), ...s.columns.map((c) => c[0]).filter((ci) => ci != null && !gset.has(ci))];
      for (const ci of singles) if (s.cars[ci].cap > 0 && S.has(s.cars[ci].color)) out.push({ kind: "solo", ci });
      return out;
    };
    const apply = (s, mv) => {
      if (mv.kind === "group") { for (const ci of mv.g) removeCar(s, ci); for (const ci of mv.g) collect(s, ci); if (!mv.g.every((ci) => s.cars[ci].cap === 0)) for (const ci of mv.g) s.parked.push(ci); }
      else { const ci = mv.ci, wasP = s.parked.includes(ci); collect(s, ci); if (s.cars[ci].cap === 0) removeCar(s, ci); else if (!wasP) { removeCar(s, ci); if (s.parked.length < bays) s.parked.push(ci); } }
    };
    const dig = (s) => { const np = []; for (let j = 0; j < perRow; j++) { const ci = s.columns[j][0]; if (ci != null && !grouped(s, ci)) np.push(j); } if (!np.length || s.parked.length >= bays) return false; np.sort((a, b) => s.columns[b].length - s.columns[a].length); s.parked.push(s.columns[np[0]].shift()); return true; };
    // finish greedily (perfect line) from a state → {cleared, peak}
    const finish = (s, guard0 = 0) => {
      let guard = guard0, peak = s.parked.length;
      while (remaining(s) > 0 && guard++ < L.chests.length * 8 + 200) {
        if (s.parked.length > peak) peak = s.parked.length;
        const mv = moves(s); if (mv.length) { apply(s, mv[0]); continue; }
        if (dig(s)) continue;
        // sendgroup last resort
        let sent = false; for (const g of groupsOf(s)) { if (g.every((ci) => s.cars[ci].cap === 0) || !groupReady(s, g)) continue; if (s.parked.length > bays - g.length) continue; for (const ci of g) removeCar(s, ci); for (const ci of g) collect(s, ci); if (!g.every((ci) => s.cars[ci].cap === 0)) for (const ci of g) s.parked.push(ci); sent = true; break; }
        if (!sent) break;
      }
      return { cleared: remaining(s) === 0, peak };
    };
    // walk the main greedy line; at each twin decision, fork every choice and compare outcomes
    let s = initState(), guard = 0, nDec = 0, nTrivial = 0, meaningful = [];
    while (remaining(s) > 0 && guard++ < L.chests.length * 8 + 200) {
      const mv = moves(s);
      if (mv.length) {
        const twinMoves = mv.filter((m) => m.kind === "group");
        const alts = mv.filter((m) => m.kind !== "group");
        if (twinMoves.length && (alts.length || twinMoves.length > 1)) {
          // choices to compare: each launchable twin, plus the best alternative (defer the twin)
          const choices = [...twinMoves]; if (alts.length) choices.push(alts[0]);
          const outs = choices.map((c) => { const s2 = clone(s); apply(s2, c); return finish(s2, guard); });
          nDec++;
          const allClear = outs.every((o) => o.cleared);
          const peaks = outs.map((o) => o.peak); const spread = Math.max(...peaks) - Math.min(...peaks);
          if (allClear && spread <= 1) nTrivial++;
          else meaningful.push({ turn: guard, allClear, spread, why: !allClear ? "có lựa chọn THUA" : `ép ô lệch ${spread}` });
        }
        apply(s, mv[0]); continue;
      }
      if (dig(s)) continue;
      let sent = false; for (const g of groupsOf(s)) { if (g.every((ci) => s.cars[ci].cap === 0) || !groupReady(s, g)) continue; if (s.parked.length > bays - g.length) continue; for (const ci of g) removeCar(s, ci); for (const ci of g) collect(s, ci); if (!g.every((ci) => s.cars[ci].cap === 0)) for (const ci of g) s.parked.push(ci); sent = true; break; }
      if (!sent) break;
    }
    return { nDec, nTrivial, nMeaningful: meaningful.length, meaningful };
  };
  const list = LEVELS.length ? LEVELS : Object.keys(data).map(Number).filter((k) => data[k] && data[k].slam).sort((a, b) => a - b);
  console.log("Twin-decision check — mỗi chỗ gặp xe đôi, thử từng lựa chọn rồi so kết quả:\n");
  console.log("lvl  #quyết-định  trivial(dễ)  có-ý-nghĩa  verdict");
  for (const k of list) {
    const L = data[k]; if (!L || !L.slam) continue;
    const r = analyze(L);
    const verdict = r.nDec === 0 ? "không có ngã rẽ xe đôi" : r.nMeaningful === 0 ? "❌ TẤT CẢ xe đôi trivial (chọn sao cũng thắng)" : `✔ ${r.nMeaningful}/${r.nDec} quyết định có hậu quả`;
    console.log(`L${k}  ${String(r.nDec).padStart(6)}  ${String(r.nTrivial).padStart(9)}  ${String(r.nMeaningful).padStart(9)}   ${verdict}`);
  }
  process.exit(0);
}

// ---- --fixtwinrows: repair the "twin straddles two rows" bug (user 2026-07-29) — a twin whose two
// cars land in different rows (diagonal rope). Re-packs every level's car list so twin units never
// start at the last column; preserves pairings and the overall order (only nudges when needed).
if (process.argv.includes("--fixtwinrows")) {
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  let fixed = 0;
  for (let k = 101; k <= 130; k++) {
    const L = data[k]; if (!L || !L.slam) continue;
    const lanes = L.lanes || DEFAULT_LANES;
    // VERTICAL pairs (same column, i & i+lanes — commit 7c802fe) are valid and position-pinned; the
    // horizontal re-pack below would tear them apart, so skip any level that has one.
    const byp = {}; L.chests.forEach((c, i) => { if (c.pairId != null) (byp[c.pairId] = byp[c.pairId] || []).push(i); });
    const hasVertical = Object.values(byp).some((g) => g.length === 2 && g[1] - g[0] === lanes);
    if (hasVertical) continue;
    const units = []; for (let i = 0; i < L.chests.length; i++) { const c = L.chests[i]; if (c.pairId != null && i + 1 < L.chests.length && L.chests[i + 1].pairId === c.pairId) { units.push([c, L.chests[i + 1]]); i++; } else units.push([c]); }
    const out = [], pend = units.slice();
    while (pend.length) { let idx = 0; if (pend[0].length >= 2 && out.length % lanes === lanes - 1) { const si = pend.findIndex((u) => u.length === 1); if (si >= 0) idx = si; } out.push(...pend.splice(idx, 1)[0]); }
    if (JSON.stringify(out) !== JSON.stringify(L.chests)) { L.chests = out; fixed++; console.log(`L${k}: re-packed (twin row-straddle fixed)`); }
  }
  const sorted = {}; for (const key of Object.keys(data).map(Number).sort((a, b) => a - b)) sorted[key] = data[key];
  fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2));
  console.log(`\n✔ ${fixed} level(s) re-packed`);
  process.exit(0);
}

// ---- --tuneorder: raise a level's THINK-SCORE by re-ordering cars so some DEEP-colour cars arrive
// EARLY (before their colour is exposed) → the player must HOLD them in bays while clearing shallow
// layers → real bay pressure + choices that matter. Tries moving K deepest-colour solo cars to the
// front (K=0..5), keeps the solvable ordering with the most meaningful decisions. Twins move as units.
// Surgical + bounded (≈6 evals/level), unlike an infeasible full search. Run with ONLY=… to target.
if (process.argv.includes("--tuneorder")) {
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const LEVELS = (process.env.ONLY ? process.env.ONLY.split(",") : ["109", "110", "129"]).map(Number);
  const depthOf = (L) => {
    const { cols, rows } = L, occ = L.board.slice(), idx = (r, c) => r * cols + c, isC = (v) => v >= 0 && v < 90;
    const sum = {}, cnt = {}; let layer = 0, alive = occ.filter(isC).length;
    while (alive > 0 && layer < 500) { const exp = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const i = idx(r, c); if (!isC(occ[i])) continue;
        if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1 || !isC(occ[idx(r - 1, c)]) || !isC(occ[idx(r + 1, c)]) || !isC(occ[idx(r, c - 1)]) || !isC(occ[idx(r, c + 1)])) exp.push(i); }
      if (!exp.length) break; for (const i of exp) { const col = occ[i]; sum[col] = (sum[col] || 0) + layer; cnt[col] = (cnt[col] || 0) + 1; occ[i] = -1; alive--; } layer++; }
    const res = {}; for (const k in cnt) res[k] = sum[k] / cnt[k]; return res;
  };
  for (const k of LEVELS) {
    const L = data[k]; if (!L || !L.slam) { console.log(`L${k} skip`); continue; }
    const lanes = L.lanes || DEFAULT_LANES, dep = depthOf(L);
    // units: twins (adjacent same pairId) stay together; solos single. Preserve current sequence.
    const units = []; for (let i = 0; i < L.chests.length; i++) { const c = L.chests[i]; if (c.pairId != null && i + 1 < L.chests.length && L.chests[i + 1].pairId === c.pairId) { units.push([c, L.chests[i + 1]]); i++; } else units.push([c]); }
    const isSolo = (u) => u.length === 1;
    const unitDepth = (u) => Math.max(...u.map((c) => dep[c.color] || 0));
    // ROW-AWARE flatten: a twin unit must not start at the LAST column (i%lanes==lanes-1) or its two
    // members fall in different rows (diagonal rope bug). When a twin would straddle, slot a solo in
    // first to bump alignment. Keeps every twin in adjacent columns of the SAME row.
    const flatten = (us) => {
      const out = [], pend = us.map((u) => u.map((c) => ({ ...c })));
      while (pend.length) {
        let idx = 0;
        if (pend[0].length >= 2 && out.length % lanes === lanes - 1) { const si = pend.findIndex((u) => u.length === 1); if (si >= 0) idx = si; }
        out.push(...pend.splice(idx, 1)[0]);
      }
      return out;
    };
    const evalOrder = (us) => {
      const ch = flatten(us);
      const byp = {}; ch.forEach((c, i) => { if (c.pairId != null) (byp[c.pairId] = byp[c.pairId] || []).push(i); });
      LANES = lanes;
      const ok = solvablePairs(L.board, L.cols, L.rows, ch, L.track || "square", Object.values(byp), 5, lanes, L.layer2 || null);
      if (!ok) return { ok: false };
      // CLEARABILITY GUARD: a perfect solver clearing isn't enough (solvablePairs can false-positive
      // into near-deadlock). Require a GOOD player (MC auto-drive, slam bay-lock) to clear it often
      // enough that it's fair, not a lock-up. Rejects the too-tight reorderings that ground the sim.
      const mc = testerReport(L.board, L.cols, L.rows, ch, L.track || "square", { skill: 0.9, trials: 8, seed: 4242, layer2: L.layer2 || null, tray: false, autoDrive: true, slam: true, choiceModel: false, bays: 5 }).winRate;
      if (mc < (Number(process.env.TUNE_GUARD) || 0.4)) return { ok: false }; // TUNE_GUARD lowers the floor (harder levels) — safe now that telemetry catches unfair ones
      const r = analyzeTwins(L, ch, { allForks: true });
      const loseForks = (r.meaningful || []).filter((m) => !m.allClear).length;
      return { ok: r.cleared, meaningful: r.nMeaningful, loseForks, nDec: r.nDec, mc, ch };
    };
    const base = evalOrder(units);
    // Score = LOSE-forks first (choices that actually LOSE — the real difficulty signal; bay-spread
    // alone proved ≠ difficulty), then meaningful count. Deep cars are INSERTED at unit positions
    // ~row1-row3 so the crunch lands at cars ~6-15 (user rule: lose mid-game, not at the very end).
    const score = (r) => (r.ok ? (r.loseForks || 0) * 100 + (r.meaningful || 0) : -1);
    let best = { K: 0, ...base, sc: score(base) };
    const solos = units.map((u, i) => ({ u, i })).filter((x) => isSolo(x.u)).sort((a, b) => unitDepth(b.u) - unitDepth(a.u));
    const deepPool = solos.slice(0, 8); // the 8 deepest solo cars are the candidate "hold me" pieces
    let s = (k * 2654435761) >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff);
    const TRIES = Number(process.env.TRIES) || 40;
    for (let t = 0; t < TRIES; t++) {
      const K = 1 + Math.floor(rnd() * Math.min(4, deepPool.length));
      const picks = deepPool.slice().sort(() => rnd() - 0.5).slice(0, K);
      const moveSet = new Set(picks.map((x) => x.i));
      const rest = units.filter((_, i) => !moveSet.has(i));
      const at = lanes + Math.floor(rnd() * Math.min(8, Math.max(1, rest.length - lanes))); // insert in the car-5..13 band
      const cand = [...rest.slice(0, at), ...picks.map((x) => x.u), ...rest.slice(at)];
      const r = evalOrder(cand);
      const sc = score(r);
      if (sc > best.sc) best = { K, order: cand, ...r, sc };
    }
    if (best.K > 0 && best.order) {
      L.chests = best.ch;
      console.log(`L${k}: base lose${base.loseForks || 0}/mean${base.meaningful || 0} → moved ${best.K} deep cars mid → LOSE-forks ${best.loseForks}, meaningful ${best.meaningful}/${best.nDec}, mc=${Math.round((best.mc || 0) * 100)}% ✓`);
    } else console.log(`L${k}: no reorder beat baseline (lose${base.loseForks || 0}/mean${base.meaningful || 0}) — kept as-is`);
  }
  const sorted = {}; for (const key of Object.keys(data).map(Number).sort((a, b) => a - b)) sorted[key] = data[key];
  fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2));
  console.log(`\n✔ wrote reordered cars into designed.json — verify with --thinkscore / --diag`);
  process.exit(0);
}

// ---- --thinkscore: whole-level "does it make you THINK" gauge — meaningful decisions across ALL
// forks (not just twins), via the same fork-and-compare meter. Low % = the flow is forced/obvious
// (launch front, collect, repeat) = trivial. Run: node scripts/build-levels.mjs --thinkscore
if (process.argv.includes("--thinkscore")) {
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const only = process.env.ONLY ? process.env.ONLY.split(",").map(Number) : null;
  const list = Object.keys(data).map(Number).filter((k) => data[k] && data[k].slam && (!only || only.includes(k))).sort((a, b) => a - b);
  console.log("Think-score — quyết định CÓ HẬU QUẢ trên MỌI ngã rẽ (fork mọi lượt ≥2 lựa chọn):\n");
  console.log("lvl   meaningful/tổng   %    verdict");
  for (const k of list) {
    const L = data[k]; const r = analyzeTwins(L, null, { allForks: true });
    const pct = r.nDec ? Math.round(100 * r.nMeaningful / r.nDec) : 0;
    // SPLIT the cause: a choice that actually LOSES (real difficulty) vs one that only shifts bay
    // pressure (spread>1). Bay pressure ≠ difficulty (L105 proof) — so LOSE-count is the honest signal.
    const loseN = (r.meaningful || []).filter((m) => !m.allClear).length;
    const spreadN = (r.meaningful || []).filter((m) => m.allClear).length;
    const verdict = r.nDec === 0 ? "không có ngã rẽ" : loseN === 0 ? "❌ không có nước THUA (dễ)" : "phải nghĩ";
    console.log(`L${k}   meaningful ${String(r.nMeaningful).padStart(3)}/${String(r.nDec).padEnd(3)} (${String(pct).padStart(3)}%)  | LỰA-SAI-THUA ${String(loseN).padStart(2)}  bay-spread ${String(spreadN).padStart(2)}  ${verdict}`);
  }
  process.exit(0);
}

// ---- --tunetwins: DIRECTED twin redesign — re-pair cars to MAXIMISE meaningful twin decisions
// (the --twincheck meter), keeping the level clearable. For each level: strip pairIds, score every
// adjacent same-row pair by how many meaningful decisions it creates ALONE, then greedily combine the
// pairs that keep raising the meaningful count without breaking clearability. This is the blind
// --repairtwins done RIGHT — optimising the real objective (does the choice matter?) not a proxy.
// Run: node scripts/build-levels.mjs --tunetwins  (ONLY=… to target levels)
if (process.argv.includes("--tunetwins")) {
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const LEVELS = (process.env.ONLY ? process.env.ONLY.split(",") : ["120", "124", "125", "129", "130"]).map(Number);
  for (const k of LEVELS) {
    const L = data[k]; if (!L || !L.slam) { console.log(`L${k} skip`); continue; }
    const lanes = L.lanes || DEFAULT_LANES;
    const base = L.chests.map((c) => { const x = { ...c }; delete x.pairId; return x; });
    const evalSet = (pairs) => { const ch = base.map((c) => ({ ...c })); pairs.forEach((p, idx) => { ch[p.a].pairId = idx; ch[p.b].pairId = idx; }); return { ch, r: analyzeTwins(L, ch) }; };
    // score each adjacent same-row diff-colour pair by meaningful decisions it makes on its own
    const cands = [];
    // Twins may sit ANY depth (user 2026-07-30). Valid shapes: HORIZONTAL (adjacent columns, same
    // row) or VERTICAL (same column, adjacent rows — commit 7c802fe stacked twins). Row gap ≤1 by
    // construction, so the rope stays short/visible as the queue pushes up. Only hard rule: no
    // navy-12 member — that car blends into the mat and the rope reads as "nối vào không khí".
    const tryPair = (a, b) => {
      if (base[a].color === base[b].color) return;
      if (base[a].color === 12 || base[b].color === 12) return;
      const { r } = evalSet([{ a, b }]);
      if (r.cleared && r.nMeaningful >= 1) cands.push({ a, b, m: r.nMeaningful });
    };
    for (let i = 0; i < base.length - 1; i++) { if (i % lanes !== lanes - 1) tryPair(i, i + 1); }         // horizontal
    for (let i = 0; i + lanes < base.length; i++) tryPair(i, i + lanes);                                  // vertical (stacked)
    cands.sort((x, y) => y.m - x.m);
    // greedily combine non-overlapping pairs, keep only additions that RAISE meaningful & stay clearable
    const used = new Set(); let chosen = [], curM = 0;
    for (const g of cands) {
      if (used.has(g.a) || used.has(g.b)) continue;
      const { r } = evalSet([...chosen, g]);
      if (r.cleared && r.nMeaningful > curM) { chosen.push(g); curM = r.nMeaningful; used.add(g.a); used.add(g.b); }
      if (chosen.length >= 6) break;
    }
    if (chosen.length) {
      const { ch, r } = evalSet(chosen);
      // final safety: perfect-solver clearance
      const byp = {}; ch.forEach((c, i) => { if (c.pairId != null) (byp[c.pairId] = byp[c.pairId] || []).push(i); });
      LANES = lanes;
      const ok = solvablePairs(L.board, L.cols, L.rows, ch, L.track || "square", Object.values(byp), 5, lanes, L.layer2 || null);
      if (ok) {
        L.chests = ch;
        const pairs = Object.values(byp).map((g) => g.map((i) => ch[i].color).join("+"));
        console.log(`L${k}: ${chosen.length} twins → ${r.nMeaningful}/${r.nDec} MEANINGFUL, solvable ✓   [${pairs.join(" ")}]`);
      } else console.log(`L${k}: best set failed solvablePairs (kept as-is)`);
    } else console.log(`L${k}: no meaningful+clearable pairing found (kept as-is)`);
  }
  const sorted = {}; for (const key of Object.keys(data).map(Number).sort((a, b) => a - b)) sorted[key] = data[key];
  fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2));
  console.log(`\n✔ wrote directed twins into designed.json — verify with --twincheck`);
  process.exit(0);
}

// ---- --repairtwins: REDESIGN twin pairs into real BAGGAGE twins (user 2026-07-29). The remap paired
// two abundant/co-exposed colours (both needed always) → zero decision. A twin bites only when one
// member is a SHALLOW colour (reachable early) and the other a DEEP colour (surfaces late): launching
// it grabs the shallow half but the deep half CLOGS a bay until its colour peels down to it → real bay
// pressure + a genuine "is it worth committing?" choice. This keeps every car's colour/count (so board
// needs are untouched) and only re-assigns pairId to the ADJACENT car-pairs with the biggest peel-depth
// gap, backing off the count until solvablePairs() confirms it still clears. ONLY=… TWINS=… to override.
if (process.argv.includes("--repairtwins")) {
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const LEVELS = (process.env.ONLY ? process.env.ONLY.split(",") : ["120", "124", "125", "129", "130"]).map(Number);
  // mean outside-in peel depth per colour (square boards): low = edge/early, high = core/late
  const depthOf = (L) => {
    const { cols, rows } = L, occ = L.board.slice(), idx = (r, c) => r * cols + c, isC = (v) => v >= 0 && v < 90;
    const sum = {}, cnt = {}; let layer = 0, alive = occ.filter(isC).length;
    while (alive > 0 && layer < 500) {
      const exp = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const i = idx(r, c); if (!isC(occ[i])) continue;
        if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1 || !isC(occ[idx(r - 1, c)]) || !isC(occ[idx(r + 1, c)]) || !isC(occ[idx(r, c - 1)]) || !isC(occ[idx(r, c + 1)])) exp.push(i); }
      if (!exp.length) break;
      for (const i of exp) { const col = occ[i]; sum[col] = (sum[col] || 0) + layer; cnt[col] = (cnt[col] || 0) + 1; occ[i] = -1; alive--; }
      layer++;
    }
    const res = {}; for (const k in cnt) res[k] = sum[k] / cnt[k]; return res;
  };
  for (const k of LEVELS) {
    const L = data[k]; if (!L || !L.slam) { console.log(`L${k} MISSING/not slam`); continue; }
    const lanes = L.lanes || DEFAULT_LANES, dep = depthOf(L);
    const tiles = {}; for (const v of L.board) if (v >= 0 && v < 90) tiles[v] = (tiles[v] || 0) + 1;
    const before = new Set(L.chests.filter((c) => c.pairId != null).map((c) => c.pairId)).size;
    // adjacent same-row car pairs. A GOOD baggage pair = a MODERATE depth gap (deep half surfaces a
    // few layers later, not never) with BOTH colours abundant (≥15 tiles → the deep half isn't a rare
    // centre dot that squats a bay forever and deadlocks). Score peaks near a gap of ~4 and decays.
    const scored = [];
    for (let i = 0; i < L.chests.length - 1; i++) { if (i % lanes === lanes - 1) continue;
      const ca = L.chests[i].color, cb = L.chests[i + 1].color; if (ca === cb) continue;
      if ((tiles[ca] || 0) < 15 || (tiles[cb] || 0) < 15) continue; // skip rare colours (permanent block)
      const gap = Math.abs((dep[ca] || 0) - (dep[cb] || 0));
      if (gap < 2) continue;
      const score = gap - Math.max(0, gap - 5) * 1.5; // reward gap up to ~5, penalise beyond
      scored.push({ a: i, b: i + 1, gap, score });
    }
    scored.sort((x, y) => y.score - x.score);
    const build = (cnt) => {
      const clone = JSON.parse(JSON.stringify(L.chests)); for (const c of clone) delete c.pairId;
      const used = new Set(); let pid = 0, made = 0, sumGap = 0;
      for (const s of scored) { if (made >= cnt) break; if (used.has(s.a) || used.has(s.b)) continue;
        clone[s.a].pairId = pid; clone[s.b].pairId = pid; pid++; used.add(s.a); used.add(s.b); made++; sumGap += s.gap; }
      return { clone, made, sumGap };
    };
    const TARGET = Number(process.env.TWINS) || before || 3;
    let best = null;
    for (let cnt = TARGET; cnt >= 0; cnt--) {
      const b = build(cnt);
      const byp = {}; b.clone.forEach((c, i) => { if (c.pairId != null) (byp[c.pairId] = byp[c.pairId] || []).push(i); });
      const groups = Object.values(byp).filter((g) => g.length >= 2);
      LANES = lanes;
      if (solvablePairs(L.board, L.cols, L.rows, b.clone, L.track || "square", groups, 5, lanes, L.layer2 || null)) { best = b; break; }
    }
    if (best && best.made > 0) {
      L.chests = best.clone;
      const pairs = []; const byp = {}; best.clone.forEach((c) => { if (c.pairId != null) (byp[c.pairId] = byp[c.pairId] || []).push(c); });
      for (const g of Object.values(byp)) pairs.push(g.map((c) => `${c.color}(d${(dep[c.color] || 0).toFixed(0)}):${c.count}`).join("+"));
      console.log(`L${k}: ${before}→${best.made} baggage twins, avgGap ${(best.sumGap / best.made).toFixed(1)}, solvable ✓`);
      console.log(`   ${pairs.join("   ")}`);
    } else console.log(`L${k}: no solvable baggage pairing found (kept as-is)`);
  }
  const sorted = {}; for (const key of Object.keys(data).map(Number).sort((a, b) => a - b)) sorted[key] = data[key];
  fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2));
  console.log(`\n✔ wrote redesigned twins into designed.json`);
  process.exit(0);
}

// ---- --smoothramp: SMOOTH the difficulty curve of the 12 slam target levels to a clean descending
// ramp by tuning each level's buried "?" COUNT (the main active lever) to hit its ramp target. Buried
// doesn't affect solvability/ceil, only the memory hazard — so this is a safe, reversible tune. Writes
// designed.json + slam-targets.csv. Run: IDEAB=1 node scripts/build-levels.mjs --smoothramp
if (process.argv.includes("--smoothramp")) {
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const KNOBS = { Q: 0.9, DOI: 0.9, COUNT: 0.6, CHON: 0.7 };
  const SKILL = 0.75, VIS_ROWS = 2, LANES_DEF = 4;
  // clean descending ramp (easy → hard) for the 12 designed target levels
  const RAMP = { 104: 90, 105: 84, 109: 78, 110: 72, 114: 66, 115: 58, 119: 50, 120: 42, 124: 34, 125: 26, 129: 18, 130: 10 };
  // place the first k eligible (past the first VIS_ROWS rows, non-paired) cars as buried, spread
  // deterministically — identical policy to add-buried.mjs so the "learn 2 rows then confusion" feel holds.
  const setBuried = (L, k) => {
    for (const c of L.chests) delete c.buried;
    const lanes = L.lanes || LANES_DEF, start = VIS_ROWS * lanes, cand = [];
    for (let i = start; i < L.chests.length; i++) if (L.chests[i].pairId == null) cand.push(i);
    let s = ((L._n || 0) * 131 + 7) >>> 0 || 1;
    for (let i = cand.length - 1; i > 0; i--) { s = (s * 1664525 + 1013904223) >>> 0; const j = s % (i + 1); [cand[i], cand[j]] = [cand[j], cand[i]]; }
    for (let m = 0; m < k && m < cand.length; m++) L.chests[cand[m]].buried = true;
    return cand.length;
  };
  console.log("Smooth ramp — tune buried '?' count per level to a clean descending curve:\n");
  console.log("lvl  tgt  buried  →win  note");
  const newTargets = [];
  for (const k of Object.keys(RAMP).map(Number)) {
    const L = data[k]; if (!L || !L.slam) { console.log(`L${k} MISSING`); continue; }
    L._n = k;
    const tg = RAMP[k], ceil = ideaBCeil(L, k);
    const maxB = setBuried(L, 0); // returns # eligible cars
    const cap = Math.floor(maxB * 0.6); // don't over-bury (>60% → luck, not skill)
    let best = 0, bestErr = 1e9, bestWin = 0;
    for (let b = 0; b <= cap; b++) {
      setBuried(L, b);
      const win = ideaBWinrate(L, SKILL, KNOBS, ceil).win;
      const e = Math.abs(win - tg);
      if (e < bestErr) { bestErr = e; best = b; bestWin = win; }
    }
    setBuried(L, best); delete L._n;
    const note = bestErr <= 6 ? "OK" : best >= cap ? `khó tối đa vẫn +${bestWin - tg}` : `±${bestWin - tg}`;
    console.log(`L${k}  ${String(tg).padStart(3)}  ${String(best).padStart(4)}/${maxB}  ${String(bestWin).padStart(4)}  ${note}`);
    newTargets.push(`${k},${bestWin}`);
  }
  const sorted = {}; for (const key of Object.keys(data).map(Number).sort((a, b) => a - b)) sorted[key] = data[key];
  for (const v of Object.values(sorted)) delete v._n;
  fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2));
  try { fs.writeFileSync(path.join(ROOT, "..", "Pixel Flow", "Manythings", "Design winrate", "slam-targets.csv"), newTargets.join("\n") + "\n"); } catch { /* ignore */ }
  console.log(`\n✔ wrote buried counts into designed.json + updated slam-targets.csv`);
  process.exit(0);
}

// ---- --ideatest: SELF-CONTAINED validation of the idea-B model on hand-built mini levels, so we
// can prove it reacts correctly + stays monotonic WITHOUT touching the (possibly in-flux) real maps.
if (process.argv.includes("--ideatest")) {
  // 5×5 concentric board: ring 0 (perimeter, 16) → ring 1 (8) → ring 2 (centre, 1). Peels outer→in.
  const ring5 = () => { const B = new Array(25); for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) B[r * 5 + c] = Math.min(r, c, 4 - r, 4 - c); return B; };
  const mk = (chests) => ({ track: "square", cols: 5, rows: 5, board: ring5(), chests, slam: true, lanes: 4 });
  const base = () => [{ color: 0, count: 8 }, { color: 0, count: 8 }, { color: 1, count: 8 }, { color: 2, count: 4 }];
  const SKS = [0.55, 0.70, 0.85, 0.95];
  const grade = (L) => SKS.map((sk) => String(ideaBWinrate(L, sk).win).padStart(3)).join(" ");
  const mono = (L) => { const v = SKS.map((sk) => ideaBWinrate(L, sk).win); let ok = true; for (let i = 1; i < v.length; i++) if (v[i] < v[i - 1] - 1) ok = false; return ok; };
  console.log("Idea-B self-test — 5×5 concentric board, cars clear outer→in.\n");
  console.log(`skills:                         ${SKS.map((s) => String(s).padStart(3)).join(" ")}`);

  // (baseline) no signals → near ceil, flat-high
  const L0 = mk(base());
  console.log(`baseline (no traps)           : ${grade(L0)}   mono=${mono(L0)}   [expect ~100, flat]`);

  // (w_?) mark the LAST n launched cars buried → winrate should DROP as buried rises, RISE with skill
  for (const nb of [1, 2, 3]) {
    const L = mk(base().map((c, i) => (i >= 4 - nb ? { ...c, buried: true } : c)));
    console.log(`w_? buried=${nb}                   : ${grade(L)}   mono=${mono(L)}   [expect lower as buried↑, rising L→R]`);
  }

  // (w_đôi) twin baggage: pair the ring-1 car (color 1, needed after outer peel) with a color-2 car
  // (not on the frontier while 0/1 are exposed) → launching drags the wasted colour into a bay.
  const twin = base(); twin[2] = { ...twin[2], pairId: 7 }; twin[3] = { ...twin[3], pairId: 7 };
  const Lt = mk(twin);
  console.log(`w_đôi twin baggage            : ${grade(Lt)}   mono=${mono(Lt)}   [expect < baseline]`);

  // isolate each knob: turn everything off but one, confirm ONLY that signal moves the number
  console.log("\nknob isolation (buried=2 board):");
  const Lb = mk(base().map((c, i) => (i >= 2 ? { ...c, buried: true } : c)));
  const off = { Q: 0, DOI: 0, COUNT: 0, CHON: 0 };
  console.log(`  all-off    : ${SKS.map((sk) => String(ideaBWinrate(Lb, sk, off).win).padStart(3)).join(" ")}   [~100: no signal weighted]`);
  console.log(`  only Q=1.5 : ${SKS.map((sk) => String(ideaBWinrate(Lb, sk, { ...off, Q: 1.5 }).win).padStart(3)).join(" ")}   [drops: w_? active]`);
  process.exit(0);
}

// ---- --test1 n: fast single-level grade (40 trials at the level's own skill) ------
if (process.argv.includes("--test1")) {
  const k = parseInt(process.argv[process.argv.indexOf("--test1") + 1], 10);
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const L = data[k];
  if (!L) { console.log("WIN=-1"); process.exit(0); }
  const ci = process.argv.indexOf("--config");
  const cfgPath = ci >= 0 && process.argv[ci + 1] && !process.argv[ci + 1].startsWith("--") ? path.join(ROOT, process.argv[ci + 1]) : null;
  const cfgm = cfgPath ? loadConfig(cfgPath) : null;
  const c = (cfgm && cfgm.get(k)) || {};
  const skill = process.env.SKILL != null ? Number(process.env.SKILL) : (c.skill != null ? c.skill : 0.6);
  LANES = L.lanes || DEFAULT_LANES; // grade at the level's own queue-line count
  const bays = Number(process.env.BAYS) || (L.bays || 5);
  const TR = Number(process.env.TRIALS) || 100;
  const r = testerReport(L.board, L.cols, L.rows, L.chests, L.track || "square", { skill, trials: TR, seed: k * 101 + 1, layer2: L.layer2 || null, tray: !!L.tray || !!L.slam, bays });
  console.log("WIN=" + Math.round(r.winRate * 100));
  if (L.slam) {
    const ad = testerReport(L.board, L.cols, L.rows, L.chests, L.track || "square", { skill, trials: 100, seed: k * 101 + 1, layer2: L.layer2 || null, tray: false, autoDrive: true, bays });
    console.log("WIN_AUTODRIVE=" + Math.round(ad.winRate * 100) + "  (skill=" + skill + " bays=" + bays + ")");
  }
  process.exit(0);
}

// ---- --diag N: per-level diagnostic — colour/car coverage, solvable(), perfect-play trace.
// Flags levels where a board colour has fewer cars than slimes (unwinnable). ----
if (process.argv.includes("--diag")) {
  const k = parseInt(process.argv[process.argv.indexOf("--diag") + 1], 10);
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const L = data[k];
  const track = L.track || "square";
  LANES = L.lanes || DEFAULT_LANES; // diagnose at the level's own queue-line count
  const colors = {}; for (const v of L.board) if (v >= 0 && v < 90) colors[v] = (colors[v] || 0) + 1;
  const carCap = {}; for (const c of L.chests) carCap[c.color] = (carCap[c.color] || 0) + c.count;
  const pairs = L.chests.filter((c) => c.pairId != null).length;
  console.log(`L${k} track=${track} cols=${L.cols} colours=${Object.keys(colors).length} cars=${L.chests.length} pairIdChests=${pairs} layer2=${!!L.layer2} hidden=${!!L.hidden}`);
  console.log(`slime/colour:`, JSON.stringify(colors));
  console.log(`carCap/colour:`, JSON.stringify(carCap));
  // capacity sanity: every colour's cars must hold >= its slime count
  for (const c of Object.keys(colors)) if ((carCap[c] || 0) < colors[c]) console.log(`  ⚠ colour ${c}: cap ${carCap[c] || 0} < slimes ${colors[c]}`);
  const sv = solvable(L.board, L.cols, L.rows, L.chests, track, 5, LANES, L.layer2 || null);
  console.log(`solvable() perfect-player = ${sv}`);
  const rng = makeRng(k * 101 + 1);
  const r = playAverage(L.board, L.cols, L.rows, L.chests, track, { skill: 1, bays: 5, perRow: LANES, rng, layer2: L.layer2 || null, autoDrive: true });
  console.log(`playAverage(skill=1, autoDrive) → win=${r.win} peakBays=${r.peak}`);
  process.exit(0);
}

// ---- --fixcars 45,60: regenerate a level's CARS to match its EXISTING board+layer2 --
// Preserves board / picture / hidden / layer2 / track exactly — only rebuilds the chests
// so every colour (top + layer2 bottom) has enough capacity. Fixes levels that shipped
// with uncollectable colours (a build-time board/car desync). `--dry` previews only.
if (process.argv.includes("--fixcars")) {
  const arg = process.argv[process.argv.indexOf("--fixcars") + 1] || "";
  const ids = arg.split(",").map(Number).filter((n) => n > 0);
  const ci = process.argv.indexOf("--config");
  const cfgPath = ci >= 0 && process.argv[ci + 1] && !process.argv[ci + 1].startsWith("--") ? path.join(ROOT, process.argv[ci + 1]) : null;
  const cfg = cfgPath ? loadConfig(cfgPath) : null;
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const needOf = (L) => { const m = new Map(); for (const v of L.board) if (v >= 0 && v < 90) m.set(v, (m.get(v) || 0) + 1); if (L.layer2) for (const v of L.layer2) if (v >= 0) m.set(v, (m.get(v) || 0) + 1); return m; };
  const missing = (L) => { const nd = needOf(L); const car = new Map(); for (const c of L.chests) if ((c.kind || "color") === "color") car.set(c.color, (car.get(c.color) || 0) + c.count); const bad = []; for (const [c, n] of nd) if ((car.get(c) || 0) < n) bad.push(`${c}:${car.get(c) || 0}/${n}`); return bad; };
  for (const id of ids) {
    const L = data[id];
    if (!L) { console.log(`L${id} MISSING`); continue; }
    const track = L.track || "square";
    const skill = (cfg && cfg.get(id) && cfg.get(id).skill != null) ? cfg.get(id).skill : 0.6;
    const diff = difficulty(id);
    const target = (cfg && cfg.get(id) && cfg.get(id).target != null) ? cfg.get(id).target : targetWin(id, diff);
    const beforeBad = missing(L);
    const beforeWin = Math.round(testerReport(L.board, L.cols, L.rows, L.chests, track, { skill, trials: 100, seed: id * 101 + 1, layer2: L.layer2 || null }).winRate * 100);
    let l2counts = null;
    if (L.layer2) { l2counts = new Map(); for (const v of L.layer2) if (v >= 0) l2counts.set(v, (l2counts.get(v) || 0) + 1); }
    const nd = needOf(L); const totalNeed = [...nd.values()].reduce((a, b) => a + b, 0);
    const minN = nd.size, maxN = Math.min(72, Math.max(minN + 4, Math.floor(totalNeed / 3)));
    // more cars = smaller cars = less bay pressure = easier. Sweep N, pick the order whose
    // auto-drive win-rate lands closest to target (prefer solvable, then fewer cars).
    const cands = new Set([minN, L.chests.length]);
    for (let n = minN; n <= maxN; n += Math.max(1, Math.round((maxN - minN) / 12))) cands.add(n);
    let best = null;
    for (const N of [...cands].filter((n) => n >= minN && n <= maxN).sort((a, b) => a - b)) {
      const carList = allocateCars(L.board, N, l2counts);
      const { order, bias } = orderByDifficulty(carList, L.board, track, biasFor(id, diff), id * 101 + 1);
      const sv = solvable(L.board, L.cols, L.rows, order, track, 5, LANES, L.layer2 || null);
      const win = Math.round(testerReport(L.board, L.cols, L.rows, order, track, { skill, trials: 100, seed: id * 101 + 1, layer2: L.layer2 || null }).winRate * 100);
      const score = Math.abs(win - target) - (sv ? 3 : 0); // small bonus for solvable
      if (!best || score < best.score) best = { N, order, bias, sv, win, score };
    }
    L.chests = best.order;
    const afterBad = missing(L);
    console.log(`L${id} ${diff} (target ${target}%): ${best.N} cars, bias ${best.bias}`);
    console.log(`  coverage: before ${beforeBad.length ? "MISSING[" + beforeBad.join(" ") + "]" : "ok"} → after ${afterBad.length ? "STILL MISSING[" + afterBad.join(" ") + "]" : "ok ✅"}`);
    console.log(`  solvable=${best.sv}  winrate ${beforeWin}% → ${best.win}%  (skill ${skill}, ${AUTO_DRIVE ? "auto-drive" : "manual"})`);
  }
  if (!DRY && ids.length) { fs.writeFileSync(OUT, JSON.stringify(data, null, 2)); console.log(`\nwrote ${OUT}`); }
  else console.log(`\n(dry run — nothing written)`);
  process.exit(0);
}

// ---- --report: grade CURRENT designed.json at EACH LEVEL'S OWN skill (from cfg) --
// 40 trials/level, twin-aware. Writes report.json for downstream CSV/summary use.
if (process.argv.includes("--report")) {
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const ci = process.argv.indexOf("--config");
  const cfgPath = ci >= 0 && process.argv[ci + 1] && !process.argv[ci + 1].startsWith("--") ? path.join(ROOT, process.argv[ci + 1]) : null;
  const cfg = cfgPath ? loadConfig(cfgPath) : null;
  // --only n1,n2 limits the report to those levels (big boards are slow to grade).
  const oi = process.argv.indexOf("--only");
  const onlySet = oi >= 0 && process.argv[oi + 1] ? new Set(process.argv[oi + 1].split(",").map(Number)) : null;
  const out = [];
  console.log("#    skill  tgt→win  slime  xe màu đôi track");
  for (const k of Object.keys(data).map(Number).sort((a, b) => a - b)) {
    if (onlySet && !onlySet.has(k)) continue;
    const L = data[k], track = L.track || "square";
    const c = (cfg && cfg.get(k)) || {};
    const skill = c.skill != null ? c.skill : 0.6;
    LANES = L.lanes || DEFAULT_LANES; // grade at the level's own queue-line count
    const r = testerReport(L.board, L.cols, L.rows, L.chests, track, { skill, trials: Number(process.env.TRIALS) || 100, seed: k * 101 + 1, layer2: L.layer2 || null, tray: !!L.tray });
    const win = Math.round(r.winRate * 100);
    let slime = 0; const cs = new Set(); for (const v of L.board) if (v >= 0) { slime++; cs.add(v); }
    const twins = new Set(L.chests.filter((x) => x.pairId != null).map((x) => x.pairId)).size;
    // perfect-solver check so broken (unwinnable-for-the-greedy) levels stand out
    const pr = groupsOf(L.chests);
    const solv = pr.length ? solvablePairs(L.board, L.cols, L.rows, L.chests, track, pr, 5, LANES, L.layer2 || null)
                           : solvable(L.board, L.cols, L.rows, L.chests, track, 5, LANES, L.layer2 || null);
    out.push({ n: k, skill, target: c.target ?? null, win, slime, cars: L.chests.length, colors: cs.size, twins, track, solv });
    const gap = c.target != null ? win - c.target : 0;
    const flag = (solv ? "" : " ⛔") + (c.target != null && Math.abs(gap) >= 12 ? (gap < 0 ? " 🔴" : " 🔵") : "");
    console.log("L" + String(k).padStart(3) + "  " + String(skill).padStart(4) + "  " +
      String(c.target ?? "  ").padStart(3) + "→" + String(win).padStart(3) + "%  " +
      String(slime).padStart(5) + " " + String(L.chests.length).padStart(3) + " " +
      String(cs.size).padStart(3) + " " + String(twins).padStart(3) + " " + track + flag);
  }
  fs.writeFileSync(path.join(PREVIEW_DIR, "report.json"), JSON.stringify(out));
  console.log(`\n→ report.json (${out.length} levels)`);
  process.exit(0);
}

// ---- optional per-level overrides from a config file (CSV or whitespace txt) --
// Columns: lvl,tier,target,max màu,maxxe,xedoi,track,max slim,slime_ref,win_ref,skill.
// "auto"/blank leaves that lever to the default logic. Use with `--config [path]`.
//   max màu  = trần số màu (đòn bẩy độ khó; build giảm dưới mức này nếu quá khó)
//   maxxe    = trần số xe trong khay
//   minxe    = sàn số xe (để level không quá ít xe, trông buồn cười)
//   max slim = trần số slime (co nhỏ chủ thể cho vừa)
//   skill    = skill người chơi giả định cho level đó → target đo ở skill này
function tierToDiff(t) { const s = (t || "").toLowerCase().trim(); return s.startsWith("super") ? "superhard" : s.startsWith("hard") ? "hard" : s ? "normal" : null; }
// Design rows carry "Có đá cứng?" (yes/no) instead of an explicit wall-edge string.
// Turn that into an edge pattern scaled by difficulty: easy = top only (gentlest),
// hard = two edges, super = three edges (only one open → line frontier, hardest).
function wallEdgesForDesign(diff) { return diff === "superhard" ? "TLR" : diff === "hard" ? "TL" : "T"; }
// Buried cars ("?") for the L1-45 design: perception-only (tester win-rate unchanged) —
// adds HUMAN difficulty. Normally unlocked from L15, but the genuinely-hard EARLY levels
// (target ≤ 50, e.g. L5/L10) may bury from L5 so they aren't trivially readable, while the
// gentle early showcase levels (target > 50) stay clean until L15 (user 2026-07-26).
function buryForDesign(n, target) {
  if (target == null || n > 45) return 0;
  const floor = target <= 50 ? 5 : 15;
  if (n < floor) return 0;
  return target <= 40 ? 0.6 : target <= 70 ? 0.4 : 0;
}
function loadConfig(p) {
  if (!fs.existsSync(p)) { console.warn("⚠ config not found:", p); return null; }
  const num = (x) => (x == null || String(x).toLowerCase() === "auto" || String(x).trim() === "" || isNaN(+x)) ? null : +x;
  const csv = p.toLowerCase().endsWith(".csv");
  const map = new Map();
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const cols = csv ? t.split(",").map((s) => s.trim()) : t.split("|")[0].trim().split(/\s+/);
    const n = parseInt(cols[0], 10); if (!n) continue; // skips the header row
    const tier = cols[1];
    // DESIGN format (human): ends at kích thước="25x25" + "Có đá cứng?"; detect by the AxB size cell.
    const design = /\d\s*[x×]\s*\d/i.test(cols[14] || "");
    let target, maxmau, maxxe, minxe, xedoi, track, maxslim, skill, size, lanes, bury, l1, tray, img, walls;
    if (design) {
      // …,kích thước,Có đá cứng?,[img],[lanes],[walls]  — last 3 optional (persist art & special configs)
      [, , target, maxmau, maxxe, minxe, xedoi, track, maxslim, , , skill] = cols;
      size = parseInt(String(cols[14]).split(/[x×]/i)[0], 10) || null;
      const rock = (cols[15] || "").trim().toLowerCase();
      const wallOv = (cols[18] || "").trim(); // explicit edge override (e.g. "T") wins over the Có/Không auto-derive
      walls = /[TBLR]/i.test(wallOv) ? wallOv.toUpperCase()
            : /^(có|co|yes|y|1|x|true)/i.test(rock) ? wallEdgesForDesign(tierToDiff(tier)) : null;
      img = (cols[16] && cols[16].trim()) ? cols[16].trim() : null;   // specific subject image
      lanes = (cols[17] != null && String(cols[17]).trim() !== "" && !isNaN(+cols[17])) ? +cols[17] : null;
      bury = l1 = null; tray = 0;
    } else {
      // BUILD format: ...,kích thước(num),line,chôn,l1,tray,img,walls
      [, , target, maxmau, maxxe, minxe, xedoi, track, maxslim, , , skill, , , size, lanes, bury, l1, tray, img, walls] = cols;
      size = num(size);
      walls = (walls && /[TBLRtblr]/.test(walls)) ? walls.trim().toUpperCase() : null;
      tray = (tray != null && String(tray).trim() === "1") ? 1 : 0;
      img = (img && img.trim()) ? img.trim() : null;
    }
    map.set(n, { tier, diff: tierToDiff(tier), target: num(target), colors: num(maxmau), maxCars: num(maxxe), minCars: num(minxe), twins: num(xedoi), track: (track && track.toLowerCase() !== "auto") ? track : null, maxSlime: num(maxslim), skill: num(skill), size: (typeof size === "number" ? size : num(size)), lanes: num(lanes), bury: num(bury), l1: num(l1), tray: tray ? 1 : 0, img, walls });
  }
  console.log(`config: ${map.size} levels from ${path.relative(ROOT, p)}`);
  return map;
}
const CONFIG = (() => {
  const i = process.argv.indexOf("--config");
  if (i < 0) return null;
  const arg = process.argv[i + 1];
  if (arg && !arg.startsWith("--")) return loadConfig(path.join(ROOT, arg));
  for (const cand of ["Manythings/level-config.csv", "level-config.csv", "level-config.txt"]) {
    if (fs.existsSync(path.join(ROOT, cand))) return loadConfig(path.join(ROOT, cand));
  }
  return loadConfig(path.join(ROOT, "Manythings/level-config.csv"));
})();

// ---- main -------------------------------------------------------------------
const isImg = (f) => /\.(png|jpe?g|webp)$/i.test(f);
// Dropped: their non-white backgrounds survived the flood (filled ~80% of the board).
const EXCLUDE = new Set([
  "Avocado Cartoon Art.jpg",
  "Green Mountain Landscape Illustration.jpg",
]);
// Simple cute clip-art borrowed from the hard folder to top up the easy pool.
const FILLER_HINTS = ["Flower", "Cute bee", "Mushroom", "baby sheep", "Adorable Cartoon Frog"];

const easyFiles = fs.readdirSync(EASY_DIR).filter(isImg).filter((f) => !EXCLUDE.has(f)).sort();
const hardFiles = fs.readdirSync(HARD_DIR).filter(isImg).filter((f) => !EXCLUDE.has(f)).sort();

// how many easy vs hard slots do we need?
let easyNeed = 0; for (let n = 1; n <= N_LEVELS; n++) if (difficulty(n) === "normal") easyNeed++;
// reserve fillers from the hard folder for any shortfall in the easy pool
const fillerCount = Math.max(0, easyNeed - easyFiles.length);
const fillers = [];
for (const hint of FILLER_HINTS) {
  if (fillers.length >= fillerCount) break;
  const f = hardFiles.find((x) => x.includes(hint) && !fillers.includes(x));
  if (f) fillers.push(f);
}
const easyImages = [...easyFiles.map((f) => ({ dir: EASY_DIR, file: f })),
                    ...fillers.map((f) => ({ dir: HARD_DIR, file: f }))];
const hardImages = hardFiles.filter((f) => !fillers.includes(f)).map((f) => ({ dir: HARD_DIR, file: f }));
let easyPtr = 0, hardPtr = 0;

// PICTURE-recipe image library (features.txt mục 13): pre-sliced single characters,
// filename prefix = TRUE colour count. Few colours → easy pool, many → hard pools.
// Pool per level chosen by the CSV colour ceiling: ≤6 → _simple, 7-9 → _hard, ≥10 → _superhard.
const SLICED_ROOT = path.join(ROOT, "public/art/level art/sliced");
// Images explicitly assigned to a level via the CSV "img" column are RESERVED — the
// pointer-based pool must skip them so they don't ALSO leak onto other levels.
const RESERVED_IMGS = new Set();
if (CONFIG) for (const c of CONFIG.values()) if (c.img) RESERVED_IMGS.add(c.img);
const SLICED = {};
for (const d of ["_simple", "_hard", "_superhard"]) {
  SLICED[d] = fs.existsSync(path.join(SLICED_ROOT, d)) ? fs.readdirSync(path.join(SLICED_ROOT, d)).filter(isImg).filter((f) => !RESERVED_IMGS.has(f)).sort() : [];
}
const slicedPtr = { _simple: 0, _hard: 0, _superhard: 0 };
const slicedPoolFor = (colors) => (colors == null || colors <= 6) ? "_simple" : colors <= 9 ? "_hard" : "_superhard";

fs.mkdirSync(PREVIEW_DIR, { recursive: true });
const levels = {};
const summary = [];
let prevEarly = 0; // running slime count so L1-10 stays strictly increasing

// `--only 7,13,28` rebuilds just those levels (keeping the rest of designed.json).
// The image pointer still advances every iteration so each level keeps its picture.
const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  if (i < 0 || !process.argv[i + 1]) return null;
  const set = new Set(process.argv[i + 1].split(",").map((x) => parseInt(x, 10)).filter(Boolean));
  const prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
  for (const k of Object.keys(prev)) levels[Number(k)] = prev[k]; // seed with existing
  console.log(`--only: rebuilding ${[...set].sort((a, b) => a - b).join(",")} (keeping others)`);
  return set;
})();

const LEVEL_NUMS = [];
for (let n = 1; n <= N_LEVELS; n++) LEVEL_NUMS.push(n);
for (let n = KID_LO; n <= KID_HI; n++) LEVEL_NUMS.push(n); // kid pack rides the same pipeline
for (const n of LEVEL_NUMS) {
  const cfg = (CONFIG && CONFIG.get(n)) || {};
  const diff = cfg.diff || packDiff(n); // design CSV "tier" wins when present
  // PICTURE recipe (features.txt mục 13, user 2026-07-25): any CSV row carrying a
  // "kích thước" gets the true-colour mosaic + solid-bg build at that board size.
  const picture = cfg.size != null && cfg.size >= 15;
  // per-level board size; BOARDSIZE= env forces it on a --only rebuild (e.g. try 26×26)
  BOARD_SIZE = picture ? (process.env.BOARDSIZE ? Number(process.env.BOARDSIZE) : cfg.size) : DEFAULT_BOARD;
  // Queue lines per level: CSV "line" column (LANES= env wins on a --only rebuild).
  LANES = process.env.LANES != null ? Number(process.env.LANES)
        : (cfg.lanes >= 2 && cfg.lanes <= 6) ? cfg.lanes : DEFAULT_LANES;
  // TRAY mode (one-way bays) for this level: CSV "tray" col or TRAY= env. Affects both
  // the calibration model (tray win-rate) and the shipped level flag.
  const trayOn = process.env.TRAY != null ? process.env.TRAY === "1" : cfg.tray === 1;
  // TARGET= env overrides the win-rate target for a --only rebuild (else CSV / auto curve).
  const target = process.env.TARGET != null ? Number(process.env.TARGET) : (cfg.target != null ? cfg.target : targetWin(n, diff));
  const vivid = true;                              // màu tươi mọi level, tránh màu tối (user 2026-07-24)
  const hard = diff !== "normal";
  const pick = hard ? hardImages[hardPtr++ % hardImages.length] : easyImages[easyPtr++ % easyImages.length];
  let { dir, file } = pick;
  // sliced pool pointer advances for EVERY picture level so --only keeps assignments stable
  if (picture) {
    const pool = slicedPoolFor(cfg.colors);
    const files = SLICED[pool];
    if (files.length) { dir = path.join(SLICED_ROOT, pool); file = files[slicedPtr[pool]++ % files.length]; }
  }
  // Per-level image from the CSV "img" column (a sliced filename like "7_train_toys.png",
  // found across the sliced pools) — lets a single batch build assign a specific subject
  // to every level. Applied to ALL levels (not just --only), before the IMG env override.
  if (picture && cfg.img) {
    for (const pool of ["_superhard", "_hard", "_simple"]) {
      const cand = path.join(SLICED_ROOT, pool, cfg.img);
      if (fs.existsSync(cand)) { dir = path.join(SLICED_ROOT, pool); file = cfg.img; break; }
    }
  }
  if (ONLY && !ONLY.has(n)) continue; // pointer already advanced → other levels unchanged
  // IMG=path/to.png forces THIS (--only) level to use a specific image instead of the
  // pointer-assigned one — e.g. to give one level a denser many-colour subject.
  if (ONLY && process.env.IMG) { const p = path.join(ROOT, process.env.IMG); dir = path.dirname(p); file = path.basename(p); }

  const { data, info } = await sharp(path.join(dir, file))
    .ensureAlpha()
    .resize(512, 512, { fit: "inside", withoutEnlargement: true })
    .raw().toBuffer({ resolveWithObject: true });

  const baseK = cfg.colors != null ? cfg.colors : baseColorsFor(target);
  let board = null;
  if (picture) {
    // Mosaic: subject snapped to (filename-K, capped by CSV màu − 1 for the bg) true
    // colours, centred, bg full-filled — no decorative border, no maxSlime shrink
    // (the SIZE column dictates the slime count; max slim is ignored here).
    const Kfile = parseInt(file, 10) || 6; // "6_train_toys.png" → 6 true colours
    // COLORS= env lifts the mosaic colour cap on a --only rebuild so a richer image keeps
    // ALL its (contiguous → solvable) colours even when the design "max màu" is low.
    const colCap = process.env.COLORS != null ? Number(process.env.COLORS) : (cfg.colors != null ? cfg.colors : MAX_COLORS);
    const Ksub = Math.max(2, Math.min(Kfile, colCap - 1, MAX_COLORS - 1));
    board = buildPicture(data, info.width, info.height, Ksub);
  } else if (cfg.maxSlime != null) {
    // legacy recipe: subject as large as possible under the slime cap
    for (let ms = SUBJECT_SIDE; ms >= 6; ms--) {
      const b = buildFromImage(data, info.width, info.height, { mode: "game", vivid, K: baseK, maxSide: ms });
      if (!b) continue;
      board = b;
      if (slimeCount(b) <= cfg.maxSlime) break; // largest size that fits the cap
    }
  } else {
    board = buildFromImage(data, info.width, info.height, { mode: "game", vivid, K: baseK, maxSide: SUBJECT_SIDE });
  }
  if (!board) { console.warn(`L${n}: no subject found in ${file} — skipped`); continue; }

  // CLEAN two-layer (item 4, user 2026-07-25): if a top-layer colour count Y is given
  // (CSV "l1" or env L1COLORS) and it's below the picture's X colours, split into a
  // Y-colour clean TOP + an (X−Y)-colour hidden BOTTOM (the subject's detail). Difficulty
  // then lives in the hidden layer, so the visible surface can stay few-colour & pretty.
  // EDGE ROCK WALLS (user 2026-07-26): wall off some board edges (CSV "walls" col, e.g.
  // T / TLR / TB, or env WALLS) into a U / arch / line frontier — narrow frontier = LOGIC
  // over fast fingers, and fewer live slimes = not a slog. Placed BEFORE the two-layer
  // split (rock is excluded from it) and BEFORE tuning so win-rate/solver see the frontier.
  const wallEdges = process.env.WALLS != null ? process.env.WALLS : cfg.walls;
  const walledN = (picture && wallEdges) ? placeWalls(board, BOARD_SIZE, BOARD_SIZE, wallEdges, Number(process.env.WALLTHICK) || 1) : 0;

  let layer2Pre = null;
  const l1y = process.env.L1COLORS != null ? Number(process.env.L1COLORS) : cfg.l1;
  if (picture && l1y != null && l1y >= 2 && l1y < distinctColors(board)) {
    const split = makeTwoLayerPicture(board, l1y, n * 101 + 7);
    if (split && split.count >= 12) { board = split.board; layer2Pre = split; }
  }

  // From L3 on, COVER ≥70% of the board with slime: grow a decorative 2-colour border
  // around the subject until fill hits 70% (a subject already ≥70% gets none). If the
  // subject is small this becomes a filled square/rect — that's fine (user 2026-07-23).
  // L1-2 stay small/clean. Added BEFORE calibration so cars cover it & win-rate counts it.
  // FILL= env overrides the decorative-border coverage (default 0.70). Lower it for a
  // level whose difficulty must come from the SUBJECT, not a big trivial-to-collect border.
  // PICTURE levels skip this: their solid bg IS the frame (mục 13).
  const fillTo = process.env.FILL != null ? Number(process.env.FILL) : 0.70;
  // MAXLAYERS= caps how many decorative border RINGS grow around the subject (default 25 ≈
  // unlimited → fills to `fillTo`). Set e.g. 2 to keep only a thin frame on a small subject
  // instead of ballooning the border to fill a big board (user 2026-07-25).
  const maxLayers = process.env.MAXLAYERS != null ? Number(process.env.MAXLAYERS) : 25;
  if (!picture && n >= 3) board = addOuterLayers(board, BOARD_SIZE, BOARD_SIZE, maxLayers, n * 191 + 5, fillTo, FILL_INSET, isKid(n) ? COOL_IDS : null);

  // RELIEF level (right after each hard/super — n%5==1): a super-easy breather. Cap the
  // whole board at ~6 colours so a car almost always matches the outer layer → slimes
  // stream in continuously & satisfyingly (target ~95%, big subject) — user 2026-07-23.
  // PICTURE levels skip it (merging mosaic colours would smear the character; their
  // CSV rows already carry the intended low colour count).
  if (!picture && n >= 6 && !isKid(n) && n % 5 === 1 && distinctColors(board) > 6) board = reduceColors(board, 6, n * 7 + 3);

  // A thin shape can still leave lots of empty margin even at full size — flag for review.
  const fill0 = slimeCount(board) / (BOARD_SIZE * BOARD_SIZE);
  const sparse = fill0 < 0.28 ? Math.round(fill0 * 100) : 0;

  const track = process.env.TRACK || cfg.track || trackFor(n, diff); // TRACK= env forces a track for --only
  // Calibration skill: `SKILL=` env overrides the per-level cfg skill. Under AUTO_CIRCLE
  // the win-rate/skill curve INVERTS above ~0.75 (a pure-greedy queue-launch trap), so
  // calibrating hard levels at their old 0.9 chases a chaotic artifact — use ~0.65.
  const calSkill = process.env.SKILL != null ? Number(process.env.SKILL) : cfg.skill;
  // PICTURE levels pin the colour ceiling to the board's ACTUAL colours so ensureColors
  // never speckles extra colours onto the character (difficulty comes from burial/cars/
  // groups instead); reduceColors easing still applies when a level is too hard.
  // Tuner colour ceiling = the subject's OWN colours for a picture level (never speckle
  // extra colours on — that scatters uncollectable single cells and breaks solvability).
  // Twins are introduced at L8 (game's TWIN_INTRO): never place them earlier even if a CSV
  // row asks for xe đôi (user 2026-07-26: L4 must not have twins).
  // VERT_DEEP=N floors the twin count so each eligible level carries ≥N pairs for the
  // forced deep-vertical seeding in pickGroups (still gated off before L8).
  const minPairs = process.env.VERT_DEEP ? Number(process.env.VERT_DEEP) : 0;
  const twinsWanted = (n < 8 && !isKid(n)) ? 0 : Math.max(cfg.twins || 0, minPairs);
  const tuned = tuneToTarget(board, track, target, n, diff, { colors: picture ? distinctColors(board) : cfg.colors, maxCars: cfg.maxCars, minCars: cfg.minCars, twins: twinsWanted, triples: triplesFor(n), skill: calSkill, layer2Frac: layer2Pre ? 0 : layer2FracFor(n, diff, cfg), layer2Pre, tray: trayOn }); // → win ≈ target @ skill
  board = tuned.board;
  const chests = tuned.chests;

  // "Chôn xe": bury ~frac of the back-row cars face-down ("?" until they surface).
  // PERCEPTION-ONLY for the tester — its greedy choices only ever read column fronts
  // (always revealed) — so the measured win-rate is unchanged; burial adds HUMAN
  // difficulty on top, exactly like the hidden "?" slimes. BURY= env overrides.
  const buryFrac0 = process.env.BURY != null ? Number(process.env.BURY) : (cfg.bury != null ? cfg.bury : buryForDesign(n, cfg.target));
  const buryFrac = buryFrac0 > 1 ? buryFrac0 / 100 : buryFrac0; // accept 60 or 0.6
  const buriedN = buryFrac > 0 ? buryCars(chests, buryFrac, n * 313 + 7) : 0;

  levels[n] = { track, cols: BOARD_SIZE, rows: BOARD_SIZE, board, chests };
  if (picture && _picLightBoard) levels[n].lightBoard = true; // dark-outlined subject → light board (RULE 4)
  if (LANES !== DEFAULT_LANES) levels[n].lanes = LANES; // queue-line count (game defaults to 4)
  if (trayOn) levels[n].tray = true; // one-way TRAY mode (bays fill 1→5, no pull-out)
  if (tuned.layer2) levels[n].layer2 = tuned.layer2;
  // hidden "?" slimes: perception-only (board keeps the real colour) → stamped on the
  // FINAL board, after tuning; interior cells only so nothing hidden is edge-exposed.
  const hf = hiddenFracFor(n, diff, cfg);
  if (hf > 0) {
    const H = makeHidden(board, BOARD_SIZE, BOARD_SIZE, hf, n * 977 + 13);
    if (H) levels[n].hidden = H.hidden;
  }

  const pr = groupsOf(chests);
  const solved = pr.length ? solvablePairs(board, BOARD_SIZE, BOARD_SIZE, chests, track, pr, 5, LANES, tuned.layer2) : solvable(board, BOARD_SIZE, BOARD_SIZE, chests, track, 5, LANES, tuned.layer2);
  if (!solved) console.warn(`⚠ L${n}: perfect-solver could not clear it`);
  await boardToPng(board, path.join(PREVIEW_DIR, `L${String(n).padStart(2, "0")}.png`));
  const twinsN = new Set(chests.filter((c) => c.pairId != null).map((c) => c.pairId)).size;
  summary.push({ n, diff, target, win: tuned.win, skill: cfg.skill != null ? cfg.skill : 0.6, colors: distinctColors(board), slimes: slimeCount(board), cars: chests.length, twins: twinsN, lanes: LANES, buried: buriedN, track, file, solved, sparse });
  if (n % 10 === 0) console.log(`  …built L${n} (${summary.filter((s) => s.solved).length}/${summary.length} solvable so far)`);
}
if (!DRY) fs.writeFileSync(path.join(PREVIEW_DIR, "summary.json"), JSON.stringify(summary));

// ---- write designed.json ----------------------------------------------------
if (!DRY) {
  const sorted = {};
  for (const k of Object.keys(levels).map(Number).sort((a, b) => a - b)) sorted[k] = levels[k];
  fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2));
  console.log(`\n✔ wrote ${Object.keys(sorted).length} levels → ${path.relative(ROOT, OUT)}`);
} else {
  console.log("\n(dry run — designed.json not written)");
}

// ---- report -----------------------------------------------------------------
console.log("\n#    tier        col slime cars track  target→win  image");
for (const s of summary) {
  const flag = Math.abs(s.win - s.target) > 12 ? " ⚠" : "";
  console.log(
    String(s.n).padStart(3) + "  " +
    s.diff.padEnd(11) + " " +
    String(s.colors).padStart(3) + " " +
    String(s.slimes).padStart(5) + " " +
    String(s.cars).padStart(4) + " " +
    s.track.padEnd(6) + " " +
    (String(s.target).padStart(4) + "→" + String(s.win).padStart(3) + "%").padEnd(11) + " " +
    s.file.slice(0, 26) + flag
  );
}
const solvedCount = summary.filter((s) => s.solved).length;
console.log(`\nsolvable (perfect): ${solvedCount}/${summary.length}`);
const sparseLv = summary.filter((s) => s.sparse);
console.log(`\nLEVEL CÒN TRỐNG (hình mỏng, đã to hết cỡ — ${sparseLv.length} level):`);
console.log(sparseLv.map((s) => `L${s.n}(${s.sparse}%)`).join("  ") || "  (none — mọi board ≥28%)");
console.log(`previews → ${path.relative(ROOT, PREVIEW_DIR)}/L01.png … L${N_LEVELS}.png`);
