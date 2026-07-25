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
const N_LEVELS = 120; // 100 main + 20 "advanced" hard/super (L101-120, user 2026-07-24)
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
function buildPicture(src, IW, IH, K) {
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
  // FULL-FILL bg: one bright colour most distinct from EVERY subject colour
  const used = [...new Set(full.filter((v) => v >= 0))];
  const usedRgb = used.map((id) => baseRgb[id]);
  const cands = PIC_IDS.filter((id) => id !== 8 && id !== 14 && !used.includes(id));
  let bgId = cands[0] ?? 3, bd = -1;
  for (const id of cands) {
    let mn = Infinity;
    for (const c of usedRgb) { const d = dist2(baseRgb[id], c); if (d < mn) mn = d; }
    if (mn > bd) { bd = mn; bgId = id; }
  }
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
        if (rc && occ[i] >= 0) S.add(i); // first occupied along this ray → exposed
      }
    }
  }
  return S;
}
// peel the board layer by layer under the track's reachability → layer per tile
function peelLayers(board, cols, rows, edges) {
  const occ = board.slice();
  const layer = new Array(board.length).fill(-1);
  let L = 0, remaining = occ.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0), guard = 0;
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
    const v = board[i]; if (v < 0) continue;
    sum.set(v, (sum.get(v) || 0) + layer[i]); cnt.set(v, (cnt.get(v) || 0) + 1);
  }
  const out = new Map();
  for (const [c, s] of sum) out.set(c, s / cnt.get(c));
  return out;
}
// Greedy 5-bay player. Conservative: straight rays only, one collecting pass per
// launch on open tracks (line/u/arch), full peel on loop tracks (square/rect).
function solvable(board, cols, rows, order, track, bays = 5, perRow = 4, layer2 = null) {
  const edges = trackEdges(track);
  const singlePass = track === "line" || track === "u" || track === "arch";
  const occ = board.slice();
  const lay = layer2 ? layer2.slice() : null; // 2-layer bottoms revealed on collect
  let remaining = occ.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0) + (lay ? lay.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0) : 0);
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
function solvablePairs(board, cols, rows, order, track, groups, bays = 5, perRow = 4, layer2 = null) {
  const edges = trackEdges(track);
  const singlePass = track === "line" || track === "u" || track === "arch";
  const occ = board.slice();
  const lay = layer2 ? layer2.slice() : null; // 2-layer bottoms revealed on collect
  let remaining = occ.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0) + (lay ? lay.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0) : 0);
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
  const removeCar = (c) => { for (const col of columns) if (col[0] === c) { col.shift(); return; } const p = parked.indexOf(c); if (p >= 0) parked.splice(p, 1); };
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
      if (!g.every((c) => isFront(c) || parked.includes(c))) continue;
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
      if (!g.every((c) => isFront(c))) continue; // all still in the queue, at fronts
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
function pickGroups(order, board, track, pairs, triples, perRow = 4, layer2 = null) {
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
  // Scan DEEP-first (end of the queue → front): a group at the very front blocks its
  // columns from turn one (its colours are still buried) and wedges the level; a deep
  // group surfaces mid-game when the board has opened up — challenging but winnable.
  let nT = 0;
  const lastBase = Math.floor((order.length - 3) / perRow) * perRow;
  for (let base = lastBase; base >= 0 && nT < (triples || 0); base -= perRow) {
    const idx = [base, base + 1, base + 2];
    if (idx.some((i) => i + 1 > order.length || used.has(i)) || !sameRow(...idx)) continue;
    const snap = idx.map((i) => order[i]);
    if (!distinctify(idx)) { idx.forEach((i, k) => (order[i] = snap[k])); continue; }
    if (solvablePairs(board, BOARD_SIZE, BOARD_SIZE, order, track, [...groups, idx], 5, 4, layer2)) { groups.push(idx); idx.forEach((i) => used.add(i)); nT++; }
    else idx.forEach((i, k) => (order[i] = snap[k])); // revert the swaps
  }
  let nP = 0;
  const lastPair = Math.floor((order.length - 2) / 2) * 2;
  for (let i = lastPair; i >= 0 && nP < (pairs || 0); i -= 2) {
    if (i + 1 >= order.length || used.has(i) || used.has(i + 1) || !sameRow(i, i + 1)) continue;
    const idx = [i, i + 1];
    const snap = idx.map((x) => order[x]);
    if (!distinctify(idx)) { if (process.env.DEBUG_GROUPS) console.error(`  pair@${i}: distinctify FAIL`); idx.forEach((x, k) => (order[x] = snap[k])); continue; }
    if (solvablePairs(board, BOARD_SIZE, BOARD_SIZE, order, track, [...groups, idx], 5, 4, layer2)) { groups.push(idx); used.add(i); used.add(i + 1); nP++; }
    else { if (process.env.DEBUG_GROUPS) console.error(`  pair@${i}: solvable FAIL`); idx.forEach((x, k) => (order[x] = snap[k])); } // revert the swaps
  }
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
  let remaining = occ.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0) + (lay ? lay.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0) : 0);
  const clearCell = (i) => { if (lay && lay[i] >= 0) { occ[i] = lay[i]; lay[i] = -1; } else occ[i] = -1; remaining--; };
  // Linked car GROUPS (2=twin, 3=triple, …): chests sharing a pairId launch / drive /
  // park / leave together. `grouped` marks a car as a group member (can't act alone).
  const cars = order.map((c) => ({ color: c.color, cap: c.count, grouped: false }));
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
  const CIRC_CAP = 3;
  let peak = 0;
  const gainOf = (color, E) => { let n = 0; for (const i of E) if (occ[i] === color) n++; return n; };
  const isFront = (c) => columns.some((col) => col[0] === c);
  const removeCar = (c) => { for (const col of columns) if (col[0] === c) { col.shift(); return; } let p = parked.indexOf(c); if (p >= 0) { parked.splice(p, 1); return; } p = circ.indexOf(c); if (p >= 0) circ.splice(p, 1); };
  const juggleOne = () => {
    if (circ.length >= CIRC_CAP || rng() > skill) return false; // no track room / mistimed
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
    // productive solo cars (parked + column fronts)
    for (const p of parked) if (!p.grouped && S.has(p.color)) prod.push({ kind: "s", car: p, gain: gainOf(p.color, E) });
    for (let j = 0; j < perRow; j++) { const f = columns[j][0]; if (f && !f.grouped && S.has(f.color)) prod.push({ kind: "s", car: f, gain: gainOf(f.color, E) }); }
    // productive READY groups (ALL members at column-fronts or parked). Under auto-drive a
    // productive group is ALWAYS launchable — it circles the track & PEELS (freeing bays as
    // buried colours surface), needing bays only IF still blocked afterwards (handled at
    // launch). The manual game keeps the old "needs groupSize bays free up-front" gate.
    for (const g of groups) {
      if (g.every((c) => c.cap === 0)) continue;
      if (!g.every((c) => isFront(c) || parked.includes(c))) continue;
      if (!g.some((c) => c.cap > 0 && S.has(c.color))) continue; // a member that can STILL eat
      const own = g.filter((c) => parked.includes(c)).length;
      const canPark = parked.length - own <= bays - g.length;
      const fullClear = g.every((c) => gainOf(c.color, E) >= c.cap);
      if (autoDrive || canPark || fullClear) prod.push({ kind: "g", g, gain: g.reduce((s, c) => s + gainOf(c.color, E), 0) });
    }
    if (prod.length) {
      const slip = rng() > skill;
      if (!autoDrive && slip && rng() < 0.4 && parkOne()) continue; // manual only: perception miss → needless park (auto-drive never needlessly parks)
      let ch;
      if (!slip) {
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
        removeCar(car);           // take it off the queue / out of its bay to circle the track
        doCollect(car);           // circle & peel its colour
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
      if (!g.every((c) => isFront(c))) continue;
      if (parked.length > bays - g.length) continue;
      for (const c of g) removeCar(c);
      for (const c of g) doCollect(c);
      if (!g.every((c) => c.cap === 0)) for (const c of g) parked.push(c);
      sent = true; break;
    }
    if (!sent) {
      // bay juggle as the final out: bays are wedged with blocked cars → tap one back
      // onto the ray so parkOne can reveal a deeper column next turn.
      if (parked.length >= bays && juggleOne()) continue;
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
function testerReport(board, cols, rows, order, track, { skill = 0.6, trials = 40, seed = 1, bays = 5, perRow = 4, layer2 = null, autoDrive = AUTO_DRIVE } = {}) {
  let wins = 0, peakSum = 0;
  for (let t = 0; t < trials; t++) {
    const rng = makeRng(seed + t * 7919 + 1);
    const r = playAverage(board, cols, rows, order, track, { skill, bays, perRow, rng, layer2, autoDrive });
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
function makeLayer2(board, cols, rows, frac, seed) {
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
  // centred square patch sized to hit ~frac of filled cells
  const side = Math.max(4, Math.round(Math.sqrt(filled.length * frac)));
  const twoTone = side * side > 40 && b2 !== b1;
  const r0 = Math.floor(rows / 2 - side / 2), c0 = Math.floor(cols / 2 - side / 2);
  const layer2 = new Array(board.length).fill(-1);
  const counts = new Map();
  let count = 0;
  for (let r = r0; r < r0 + side; r++) for (let c = c0; c < c0 + side; c++) {
    if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
    const i = r * cols + c;
    const bottom = twoTone && c >= c0 + side / 2 ? b2 : b1; // left half b1, right half b2
    if (board[i] >= 0 && board[i] < 90 && board[i] !== bottom) {
      layer2[i] = bottom; count++;
      counts.set(bottom, (counts.get(bottom) || 0) + 1);
    }
  }
  return count >= 12 ? { layer2, count, counts } : null;
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
  for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) {
    const i = r * cols + c;
    if (!isSlime(i)) continue;
    if (isSlime(i - cols) && isSlime(i + cols) && isSlime(i - 1) && isSlime(i + 1)) eligible.push(i);
  }
  let count = 0;
  for (const i of eligible) if (rng() < frac) { hidden[i] = board[i]; count++; }
  return count >= 8 ? { hidden, count } : null;
}

// ---- the port of generateNCars ---------------------------------------------
// Split the board's tiles into exactly N single-colour cars (>= #colours), each
// colour's cars sharing its tiles evenly → returns the flat car list (unordered).
// `extra` = additional per-colour tile counts (e.g. 2-layer bottoms) folded in so
// capacity covers BOTH layers.
function allocateCars(board, N, extraCounts) {
  const counts = new Map();
  for (const id of board) if (id >= 0) counts.set(id, (counts.get(id) || 0) + 1);
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
// Place `pairs` xe đôi + `triples` xe ba on an order (consecutive same-row cols) and
// stamp pairId. Returns a fresh order (copied) so the caller's carList is never mutated.
function withGroups(order, board, track, pairs, triples, layer2 = null) {
  const copy = order.map((c) => ({ ...c }));
  if (!pairs && !triples) return { order: copy, groups: [] };
  const groups = pickGroups(copy, board, track, pairs || 0, triples || 0, 4, layer2);
  let pid = 0; for (const g of groups) { pid++; for (const i of g) copy[i].pairId = pid; }
  return { order: copy, groups };
}
// Sweep burial strength → order whose average-tester win% is closest to `target`.
// With `twins`>0 the xe đôi are placed on each candidate and the win% is measured
// WITH the twin constraint, so difficulty is tuned accounting for them.
function calibrateOrder(carList, board, cols, rows, track, target, { skill = 0.6, trials = 60, seed = 1, twins = 0, triples = 0, layer2 = null, biases = [0, 0.08, 0.16, 0.24, 0.32, 0.4, 0.48, 0.56, 0.64, 0.72] } = {}) {
  let best = null;
  const wantGroups = (twins || 0) + (triples || 0);
  for (const b of biases) {
    const { order, groups } = withGroups(orderAtBias(carList, board, track, b, seed + 6), board, track, twins, triples, layer2);
    const ok = groups.length ? solvablePairs(board, cols, rows, order, track, groups, 5, 4, layer2) : solvable(board, cols, rows, order, track, 5, 4, layer2);
    if (!ok) continue;
    const win = Math.round(testerReport(board, cols, rows, order, track, { skill, trials, seed, layer2 }).winRate * 100);
    // Difficulty should come FROM the linked groups (user): a candidate that places
    // more of the requested twins/triples beats a slightly-closer-to-target one.
    const score = Math.max(0, wantGroups - groups.length) * 1000 + Math.abs(win - target);
    if (!best || score < best.score || (score === best.score && b < best.b)) best = { b, win, order, score };
  }
  if (!best) {
    const { order } = withGroups(orderAtBias(carList, board, track, 0, seed + 6), board, track, twins, triples, layer2);
    const win = Math.round(testerReport(board, cols, rows, order, track, { skill, trials, seed, layer2 }).winRate * 100);
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
const slimeCount = (board) => board.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0);

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
const distinctColors = (board) => new Set(board.filter((v) => v >= 0)).size;
// Scatter fresh palette colours in until the board has ~targetColors distinct
// colours (each new colour ~6% of tiles) — the knob for making a level harder.
function ensureColors(board, targetColors, seed) {
  const b = board.slice();
  const idxs = []; for (let i = 0; i < b.length; i++) if (b[i] >= 0) idxs.push(i);
  if (!idxs.length) return b;
  const rng = makeRng(seed);
  const present = new Set(b.filter((v) => v >= 0));
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
  const present = () => { const s = new Set(); for (const v of b) if (v >= 0) s.add(v); return [...s]; };
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
  if (n >= 101) return diff === "superhard" ? 0.2 : 0.15; // advanced pack: always (thinner → smoother win landscape)
  if (n < 35 || diff === "normal") return 0;
  return diff === "superhard" ? 0.25 : 0.18;
}
// hidden "?" coverage: hard/super from L35, ~10% of interior cells (super ~14%).
function hiddenFracFor(n, diff, cfg) {
  if (cfg && cfg.hiddenFrac != null) return cfg.hiddenFrac;
  if (isKid(n)) return (n - KID_LO) % 5 === 3 ? 0.08 : 0; // thi thoảng "?" — nhẹ nhàng
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
  // 2-LAYER slimes: ov.layer2Frac (0..1) covers ~that fraction of the subject with a
  // hidden bottom colour. The tester/solver model the reveal; cars get extra capacity.
  const L2 = ov.layer2Frac ? makeLayer2(board0, BOARD_SIZE, BOARD_SIZE, ov.layer2Frac, seed + 11) : null;
  const l2extra = L2 ? L2.counts : null;
  const opt = { skill, trials: 16, seed, twins: twinsN, triples: triplesN, layer2: L2 ? L2.layer2 : null, biases: [0, 0.18, 0.36, 0.54, 0.72] };
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

  // Start at the colour ceiling; if still too hard, drop one colour at a time.
  let board = ensureColors(board0.slice(), ceilColors, seed + 3);
  let best = sweepCars(board), bestBoard = board;
  let k = distinctColors(board), guard = 0;
  while (best.win < target - 8 && k > 2 && guard++ < 8) {
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
    const col = v >= 0 ? baseRgb[v] : [34, 34, 40];
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

// ---- --test: grade the CURRENT designed.json with the average tester --------
if (process.argv.includes("--test")) {
  const SKILL = Number(process.env.SKILL || 0.6);
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  console.log(`Average tester — skill ${SKILL}, 5 bays, 40 trials/level (no boosters)\n`);
  console.log("#   tier        track  win%  avgPeakBays");
  for (const k of Object.keys(data).map(Number).sort((a, b) => a - b)) {
    const L = data[k], track = L.track || "square";
    const r = testerReport(L.board, L.cols, L.rows, L.chests, track, { skill: SKILL, trials: 40, seed: k * 101 + 1 });
    const pct = Math.round(r.winRate * 100);
    const bar = "█".repeat(Math.round(pct / 5)).padEnd(20);
    console.log(String(k).padStart(2) + "  " + difficulty(k).padEnd(11) + " " + track.padEnd(6) + " " +
      String(pct).padStart(3) + "%  " + r.avgPeak.toFixed(1) + "  " + bar);
  }
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
  const r = testerReport(L.board, L.cols, L.rows, L.chests, L.track || "square", { skill, trials: 40, seed: k * 101 + 1, layer2: L.layer2 || null });
  console.log("WIN=" + Math.round(r.winRate * 100));
  process.exit(0);
}

// ---- --diag N: per-level diagnostic — colour/car coverage, solvable(), perfect-play trace.
// Flags levels where a board colour has fewer cars than slimes (unwinnable). ----
if (process.argv.includes("--diag")) {
  const k = parseInt(process.argv[process.argv.indexOf("--diag") + 1], 10);
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const L = data[k];
  const track = L.track || "square";
  const colors = {}; for (const v of L.board) if (v >= 0 && v < 90) colors[v] = (colors[v] || 0) + 1;
  const carCap = {}; for (const c of L.chests) carCap[c.color] = (carCap[c.color] || 0) + c.count;
  const pairs = L.chests.filter((c) => c.pairId != null).length;
  console.log(`L${k} track=${track} cols=${L.cols} colours=${Object.keys(colors).length} cars=${L.chests.length} pairIdChests=${pairs} layer2=${!!L.layer2} hidden=${!!L.hidden}`);
  console.log(`slime/colour:`, JSON.stringify(colors));
  console.log(`carCap/colour:`, JSON.stringify(carCap));
  // capacity sanity: every colour's cars must hold >= its slime count
  for (const c of Object.keys(colors)) if ((carCap[c] || 0) < colors[c]) console.log(`  ⚠ colour ${c}: cap ${carCap[c] || 0} < slimes ${colors[c]}`);
  const sv = solvable(L.board, L.cols, L.rows, L.chests, track, 5, 4, L.layer2 || null);
  console.log(`solvable() perfect-player = ${sv}`);
  const rng = makeRng(k * 101 + 1);
  const r = playAverage(L.board, L.cols, L.rows, L.chests, track, { skill: 1, bays: 5, perRow: 4, rng, layer2: L.layer2 || null, autoDrive: true });
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
    const beforeWin = Math.round(testerReport(L.board, L.cols, L.rows, L.chests, track, { skill, trials: 40, seed: id * 101 + 1, layer2: L.layer2 || null }).winRate * 100);
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
      const sv = solvable(L.board, L.cols, L.rows, order, track, 5, 4, L.layer2 || null);
      const win = Math.round(testerReport(L.board, L.cols, L.rows, order, track, { skill, trials: 40, seed: id * 101 + 1, layer2: L.layer2 || null }).winRate * 100);
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
    const r = testerReport(L.board, L.cols, L.rows, L.chests, track, { skill, trials: 40, seed: k * 101 + 1, layer2: L.layer2 || null });
    const win = Math.round(r.winRate * 100);
    let slime = 0; const cs = new Set(); for (const v of L.board) if (v >= 0) { slime++; cs.add(v); }
    const twins = new Set(L.chests.filter((x) => x.pairId != null).map((x) => x.pairId)).size;
    // perfect-solver check so broken (unwinnable-for-the-greedy) levels stand out
    const pr = groupsOf(L.chests);
    const solv = pr.length ? solvablePairs(L.board, L.cols, L.rows, L.chests, track, pr, 5, 4, L.layer2 || null)
                           : solvable(L.board, L.cols, L.rows, L.chests, track, 5, 4, L.layer2 || null);
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
function loadConfig(p) {
  if (!fs.existsSync(p)) { console.warn("⚠ config not found:", p); return null; }
  const num = (x) => (!x || x.toLowerCase() === "auto" || isNaN(+x)) ? null : +x;
  const csv = p.toLowerCase().endsWith(".csv");
  const map = new Map();
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const cols = csv ? t.split(",").map((s) => s.trim()) : t.split("|")[0].trim().split(/\s+/);
    // User layout: lvl,tier,target,max màu,maxxe,minxe,xedoi,track,max slim,slime_ref,win_ref,skill,xe_ref,màu_ref,kích thước
    const [lvl, , target, maxmau, maxxe, minxe, xedoi, track, maxslim, , , skill, , , size] = cols;
    const n = parseInt(lvl, 10); if (!n) continue; // skips the header row
    map.set(n, { target: num(target), colors: num(maxmau), maxCars: num(maxxe), minCars: num(minxe), twins: num(xedoi), track: (track && track.toLowerCase() !== "auto") ? track : null, maxSlime: num(maxslim), skill: num(skill), size: num(size) });
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
const SLICED = {};
for (const d of ["_simple", "_hard", "_superhard"]) {
  SLICED[d] = fs.existsSync(path.join(SLICED_ROOT, d)) ? fs.readdirSync(path.join(SLICED_ROOT, d)).filter(isImg).sort() : [];
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
  const diff = packDiff(n);
  const cfg = (CONFIG && CONFIG.get(n)) || {};
  // PICTURE recipe (features.txt mục 13, user 2026-07-25): any CSV row carrying a
  // "kích thước" gets the true-colour mosaic + solid-bg build at that board size.
  const picture = cfg.size != null && cfg.size >= 15;
  BOARD_SIZE = picture ? cfg.size : DEFAULT_BOARD; // per-level board size
  const target = cfg.target != null ? cfg.target : targetWin(n, diff);
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
    const Ksub = Math.max(2, Math.min(Kfile, (cfg.colors != null ? cfg.colors : MAX_COLORS) - 1, MAX_COLORS - 1));
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

  // From L3 on, COVER ≥70% of the board with slime: grow a decorative 2-colour border
  // around the subject until fill hits 70% (a subject already ≥70% gets none). If the
  // subject is small this becomes a filled square/rect — that's fine (user 2026-07-23).
  // L1-2 stay small/clean. Added BEFORE calibration so cars cover it & win-rate counts it.
  // FILL= env overrides the decorative-border coverage (default 0.70). Lower it for a
  // level whose difficulty must come from the SUBJECT, not a big trivial-to-collect border.
  // PICTURE levels skip this: their solid bg IS the frame (mục 13).
  const fillTo = process.env.FILL != null ? Number(process.env.FILL) : 0.70;
  if (!picture && n >= 3) board = addOuterLayers(board, BOARD_SIZE, BOARD_SIZE, 25, n * 191 + 5, fillTo, FILL_INSET, isKid(n) ? COOL_IDS : null);

  // RELIEF level (right after each hard/super — n%5==1): a super-easy breather. Cap the
  // whole board at ~6 colours so a car almost always matches the outer layer → slimes
  // stream in continuously & satisfyingly (target ~95%, big subject) — user 2026-07-23.
  // PICTURE levels skip it (merging mosaic colours would smear the character; their
  // CSV rows already carry the intended low colour count).
  if (!picture && n >= 6 && !isKid(n) && n % 5 === 1 && distinctColors(board) > 6) board = reduceColors(board, 6, n * 7 + 3);

  // A thin shape can still leave lots of empty margin even at full size — flag for review.
  const fill0 = slimeCount(board) / (BOARD_SIZE * BOARD_SIZE);
  const sparse = fill0 < 0.28 ? Math.round(fill0 * 100) : 0;

  const track = cfg.track || trackFor(n, diff);
  // Calibration skill: `SKILL=` env overrides the per-level cfg skill. Under AUTO_CIRCLE
  // the win-rate/skill curve INVERTS above ~0.75 (a pure-greedy queue-launch trap), so
  // calibrating hard levels at their old 0.9 chases a chaotic artifact — use ~0.65.
  const calSkill = process.env.SKILL != null ? Number(process.env.SKILL) : cfg.skill;
  // PICTURE levels pin the colour ceiling to the board's ACTUAL colours so ensureColors
  // never speckles extra colours onto the character (difficulty comes from burial/cars/
  // groups instead); reduceColors easing still applies when a level is too hard.
  const tuned = tuneToTarget(board, track, target, n, diff, { colors: picture ? distinctColors(board) : cfg.colors, maxCars: cfg.maxCars, minCars: cfg.minCars, twins: cfg.twins, triples: triplesFor(n), skill: calSkill, layer2Frac: layer2FracFor(n, diff, cfg) }); // → win ≈ target @ skill
  board = tuned.board;
  const chests = tuned.chests;

  levels[n] = { track, cols: BOARD_SIZE, rows: BOARD_SIZE, board, chests };
  if (tuned.layer2) levels[n].layer2 = tuned.layer2;
  // hidden "?" slimes: perception-only (board keeps the real colour) → stamped on the
  // FINAL board, after tuning; interior cells only so nothing hidden is edge-exposed.
  const hf = hiddenFracFor(n, diff, cfg);
  if (hf > 0) {
    const H = makeHidden(board, BOARD_SIZE, BOARD_SIZE, hf, n * 977 + 13);
    if (H) levels[n].hidden = H.hidden;
  }

  const pr = groupsOf(chests);
  const solved = pr.length ? solvablePairs(board, BOARD_SIZE, BOARD_SIZE, chests, track, pr, 5, 4, tuned.layer2) : solvable(board, BOARD_SIZE, BOARD_SIZE, chests, track, 5, 4, tuned.layer2);
  if (!solved) console.warn(`⚠ L${n}: perfect-solver could not clear it`);
  await boardToPng(board, path.join(PREVIEW_DIR, `L${String(n).padStart(2, "0")}.png`));
  const twinsN = new Set(chests.filter((c) => c.pairId != null).map((c) => c.pairId)).size;
  summary.push({ n, diff, target, win: tuned.win, skill: cfg.skill != null ? cfg.skill : 0.6, colors: distinctColors(board), slimes: slimeCount(board), cars: chests.length, twins: twinsN, track, file, solved, sparse });
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
