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
const N_LEVELS = 100;

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
const BOARD_SIZE = 25, IMG_INNER = 25;

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
    const VIVID = [1, 3, 4, 5, 6, 15, 17].filter((id) => id < BASE_N);
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
function solvable(board, cols, rows, order, track, bays = 5, perRow = 4) {
  const edges = trackEdges(track);
  const singlePass = track === "line" || track === "u" || track === "arch";
  const occ = board.slice();
  let remaining = occ.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0);
  const columns = Array.from({ length: perRow }, () => []);
  order.forEach((c, i) => columns[i % perRow].push({ color: c.color, cap: c.count }));
  const parked = [];
  const collect = (car) => {
    if (singlePass) {
      const E = exposedTiles(occ, cols, rows, edges);
      for (const i of E) { if (car.cap <= 0) break; if (occ[i] === car.color) { occ[i] = -1; remaining--; car.cap--; } }
    } else {
      while (car.cap > 0) {
        const E = exposedTiles(occ, cols, rows, edges);
        let t = -1; for (const i of E) if (occ[i] === car.color) { t = i; break; }
        if (t < 0) break;
        occ[t] = -1; remaining--; car.cap--;
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
function solvablePairs(board, cols, rows, order, track, pairs, bays = 5, perRow = 4) {
  const edges = trackEdges(track);
  const singlePass = track === "line" || track === "u" || track === "arch";
  const occ = board.slice();
  let remaining = occ.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0);
  const cars = order.map((c) => ({ color: c.color, cap: c.count, partner: -1 }));
  for (const [a, b] of pairs) { cars[a].partner = b; cars[b].partner = a; }
  const columns = Array.from({ length: perRow }, () => []);
  cars.forEach((c, i) => columns[i % perRow].push(c));
  const parked = [];
  const collect = (car) => {
    if (singlePass) { const E = exposedTiles(occ, cols, rows, edges); for (const i of E) { if (car.cap <= 0) break; if (occ[i] === car.color) { occ[i] = -1; remaining--; car.cap--; } } }
    else { while (car.cap > 0) { const E = exposedTiles(occ, cols, rows, edges); let t = -1; for (const i of E) if (occ[i] === car.color) { t = i; break; } if (t < 0) break; occ[t] = -1; remaining--; car.cap--; } }
  };
  const isFront = (c) => columns.some((col) => col[0] === c);
  const removeCar = (c) => { for (const col of columns) if (col[0] === c) { col.shift(); return; } const p = parked.indexOf(c); if (p >= 0) parked.splice(p, 1); };
  let guard = 0;
  while (remaining > 0 && guard++ < order.length * 6 + 100) {
    const E = exposedTiles(occ, cols, rows, edges);
    const S = new Set(); for (const i of E) S.add(occ[i]);
    let moved = false;
    // 1) a productive non-paired car (parked first, then column fronts)
    const singles = [...parked.filter((c) => c.partner < 0), ...columns.map((c) => c[0]).filter((c) => c && c.partner < 0)];
    for (const c of singles) if (S.has(c.color)) {
      const wasParked = parked.includes(c);
      collect(c);
      if (c.cap === 0) removeCar(c); else if (!wasParked) { removeCar(c); if (parked.length < bays) parked.push(c); }
      moved = true; break;
    }
    if (moved) continue;
    // 2) a productive READY pair (both fronts or both parked). Twins park together
    // into 2 adjacent bays — need ≥2 free (after reclaiming their own parked slots).
    for (const [a, b] of pairs) {
      const ca = cars[a], cb = cars[b];
      if (ca.cap === 0 && cb.cap === 0) continue;
      if (!((isFront(ca) || parked.includes(ca)) && (isFront(cb) || parked.includes(cb)))) continue;
      if (!(S.has(ca.color) || S.has(cb.color))) continue;
      const own = (parked.includes(ca) ? 1 : 0) + (parked.includes(cb) ? 1 : 0);
      if (parked.length - own > bays - 2) continue; // <2 bays free to park the twin
      removeCar(ca); removeCar(cb); collect(ca); collect(cb);
      if (!(ca.cap === 0 && cb.cap === 0)) { parked.push(ca); parked.push(cb); } // park together
      moved = true; break;
    }
    if (moved) continue;
    // 3) park a non-paired front to reveal deeper (paired cars can't park alone)
    const np = [];
    for (let j = 0; j < perRow; j++) { const f = columns[j][0]; if (f && f.partner < 0) np.push(j); }
    if (np.length === 0 || parked.length >= bays) return false;
    np.sort((a, b) => columns[b].length - columns[a].length);
    parked.push(columns[np[0]].shift());
  }
  return remaining === 0;
}
// Twin candidates must be CONSECUTIVE chests in the SAME inventory row (so they
// land in adjacent columns, same row — what the game's twin rendering expects):
// (0,1),(2,3) in row 0, (4,5),(6,7) in row 1, … i.e. even i with i%perRow < perRow-1.
function pickPairs(order, board, track, want, perRow = 4) {
  const pairs = [];
  // even i (perRow=4) always keeps i and i+1 in the same row → adjacent columns.
  for (let i = 0; i + 1 < order.length && pairs.length < want; i += 2) {
    const a = i, b = i + 1;
    if (order[a].color === order[b].color) continue;             // twins of two different colours
    if (solvablePairs(board, BOARD_SIZE, BOARD_SIZE, order, track, [...pairs, [a, b]])) pairs.push([a, b]);
  }
  return pairs;
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
  const edges = trackEdges(track);
  const singlePass = track === "line" || track === "u" || track === "arch";
  const occ = board.slice();
  let remaining = occ.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0);
  // cars with twin links (two chests sharing pairId are twins)
  const cars = order.map((c) => ({ color: c.color, cap: c.count, partner: -1 }));
  const byPid = new Map();
  order.forEach((c, i) => { if (c.pairId != null) { (byPid.get(c.pairId) || byPid.set(c.pairId, []).get(c.pairId)).push(i); } });
  const twins = []; // [carA, carB]
  for (const idxs of byPid.values()) if (idxs.length === 2) { cars[idxs[0]].partner = idxs[1]; cars[idxs[1]].partner = idxs[0]; twins.push([cars[idxs[0]], cars[idxs[1]]]); }
  const columns = Array.from({ length: perRow }, () => []);
  cars.forEach((c, i) => columns[i % perRow].push(c));
  const parked = [];
  let peak = 0;
  const gainOf = (color, E) => { let n = 0; for (const i of E) if (occ[i] === color) n++; return n; };
  const isFront = (c) => columns.some((col) => col[0] === c);
  const removeCar = (c) => { for (const col of columns) if (col[0] === c) { col.shift(); return; } const p = parked.indexOf(c); if (p >= 0) parked.splice(p, 1); };
  const doCollect = (car) => {
    if (singlePass) { const E = exposedTiles(occ, cols, rows, edges); for (const i of E) { if (car.cap <= 0) break; if (occ[i] === car.color) { occ[i] = -1; remaining--; car.cap--; } } }
    else { while (car.cap > 0) { const E = exposedTiles(occ, cols, rows, edges); let t = -1; for (const i of E) if (occ[i] === car.color) { t = i; break; } if (t < 0) break; occ[t] = -1; remaining--; car.cap--; } }
  };
  // park a NON-twin front (twins can't park alone) — the only way to reveal deeper
  const parkOne = () => {
    const fronts = []; for (let j = 0; j < perRow; j++) { const f = columns[j][0]; if (f && f.partner < 0) fronts.push(j); }
    if (fronts.length === 0 || parked.length >= bays) return false;
    let j;
    if (rng() > skill) j = fronts[Math.floor(rng() * fronts.length)];
    else { fronts.sort((a, b) => columns[b].length - columns[a].length); j = fronts[0]; }
    parked.push(columns[j].shift());
    return true;
  };
  let guard = 0;
  while (remaining > 0 && guard++ < order.length * 6 + 200) {
    if (parked.length > peak) peak = parked.length;
    const E = exposedTiles(occ, cols, rows, edges);
    const S = new Set(); for (const i of E) S.add(occ[i]);
    const prod = [];
    // productive non-twin cars (parked + column fronts)
    for (const p of parked) if (p.partner < 0 && S.has(p.color)) prod.push({ kind: "s", car: p, gain: gainOf(p.color, E) });
    for (let j = 0; j < perRow; j++) { const f = columns[j][0]; if (f && f.partner < 0 && S.has(f.color)) prod.push({ kind: "s", car: f, gain: gainOf(f.color, E) }); }
    // productive READY twins (both fronts or both parked). Offer only if it fully
    // collects OR there are 2 bays free to park the pair together.
    for (const [ca, cb] of twins) {
      if (ca.cap === 0 && cb.cap === 0) continue;
      const par = parked.includes(ca);
      if (!((isFront(ca) || par) && (isFront(cb) || parked.includes(cb)))) continue;
      if (!(S.has(ca.color) || S.has(cb.color))) continue;
      const own = (parked.includes(ca) ? 1 : 0) + (parked.includes(cb) ? 1 : 0);
      const canPark = parked.length - own <= bays - 2;
      const fullClear = gainOf(ca.color, E) >= ca.cap && gainOf(cb.color, E) >= cb.cap;
      if (canPark || fullClear) prod.push({ kind: "t", ca, cb, gain: gainOf(ca.color, E) + gainOf(cb.color, E) });
    }
    if (prod.length) {
      const slip = rng() > skill;
      if (slip && rng() < 0.4 && parkOne()) continue; // perception miss → needless park
      let ch;
      if (!slip) { prod.sort((a, b) => b.gain - a.gain); ch = prod[0]; }
      else ch = prod[Math.floor(rng() * prod.length)];
      if (ch.kind === "s") {
        const car = ch.car, wasParked = parked.includes(car);
        doCollect(car);
        if (car.cap === 0) removeCar(car);
        else if (!wasParked) { removeCar(car); if (parked.length < bays) parked.push(car); }
      } else { // twin: launch both together
        removeCar(ch.ca); removeCar(ch.cb); doCollect(ch.ca); doCollect(ch.cb);
        if (!(ch.ca.cap === 0 && ch.cb.cap === 0)) { parked.push(ch.ca); parked.push(ch.cb); } // room guaranteed
      }
      continue;
    }
    if (!parkOne()) return { win: false, peak };
  }
  return { win: remaining === 0, peak };
}
function testerReport(board, cols, rows, order, track, { skill = 0.6, trials = 40, seed = 1, bays = 5, perRow = 4 } = {}) {
  let wins = 0, peakSum = 0;
  for (let t = 0; t < trials; t++) {
    const rng = makeRng(seed + t * 7919 + 1);
    const r = playAverage(board, cols, rows, order, track, { skill, bays, perRow, rng });
    if (r.win) wins++;
    peakSum += r.peak;
  }
  return { winRate: wins / trials, avgPeak: peakSum / trials };
}

// ---- the port of generateNCars ---------------------------------------------
// Split the board's tiles into exactly N single-colour cars (>= #colours), each
// colour's cars sharing its tiles evenly → returns the flat car list (unordered).
function allocateCars(board, N) {
  const counts = new Map();
  for (const id of board) if (id >= 0) counts.set(id, (counts.get(id) || 0) + 1);
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
// Extract twin index-pairs from an order's pairId stamps.
function pairsOf(order) {
  const m = new Map();
  order.forEach((c, i) => { if (c && c.pairId != null) (m.get(c.pairId) || m.set(c.pairId, []).get(c.pairId)).push(i); });
  const out = []; for (const idxs of m.values()) if (idxs.length === 2) out.push(idxs);
  return out;
}
// Place `twins` xe đôi on an order (row-0/1 consecutive pairs) and stamp pairId.
// Returns a fresh order (copied) so the caller's carList is never mutated.
function withTwins(order, board, track, twins) {
  const copy = order.map((c) => ({ ...c }));
  if (!twins) return { order: copy, pairs: [] };
  const pairs = pickPairs(copy, board, track, twins);
  let pid = 0; for (const [a, b] of pairs) { pid++; copy[a].pairId = pid; copy[b].pairId = pid; }
  return { order: copy, pairs };
}
// Sweep burial strength → order whose average-tester win% is closest to `target`.
// With `twins`>0 the xe đôi are placed on each candidate and the win% is measured
// WITH the twin constraint, so difficulty is tuned accounting for them.
function calibrateOrder(carList, board, cols, rows, track, target, { skill = 0.6, trials = 60, seed = 1, twins = 0, biases = [0, 0.08, 0.16, 0.24, 0.32, 0.4, 0.48, 0.56, 0.64, 0.72] } = {}) {
  let best = null;
  for (const b of biases) {
    const { order, pairs } = withTwins(orderAtBias(carList, board, track, b, seed + 6), board, track, twins);
    const ok = pairs.length ? solvablePairs(board, cols, rows, order, track, pairs) : solvable(board, cols, rows, order, track);
    if (!ok) continue;
    const win = Math.round(testerReport(board, cols, rows, order, track, { skill, trials, seed }).winRate * 100);
    const score = Math.abs(win - target);
    if (!best || score < best.score || (score === best.score && b < best.b)) best = { b, win, order, score };
  }
  if (!best) {
    const { order } = withTwins(orderAtBias(carList, board, track, 0, seed + 6), board, track, twins);
    const win = Math.round(testerReport(board, cols, rows, order, track, { skill, trials, seed }).winRate * 100);
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
  const avail = []; for (let id = 0; id < BASE_N; id++) if (!present.has(id)) avail.push(id);
  let ai = 0;
  while (present.size < targetColors && ai < avail.length) {
    const nc = avail[ai++], chunk = Math.max(4, Math.round(idxs.length * 0.06));
    for (let t = 0; t < chunk; t++) b[idxs[Math.floor(rng() * idxs.length)]] = nc;
    present.add(nc);
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
// Adjust colours (harder) / car-count (easier) + order until the average tester's
// win-rate lands near `target`, WITH this level's xe đôi placed & modelled.
function tuneToTarget(board0, track, target, n, diff) {
  let board = board0.slice();
  const seed = n * 101 + 1;
  const twins = twinsFor(n, diff);
  const opt = { skill: 0.6, trials: 25, seed, twins, biases: [0, 0.12, 0.24, 0.36, 0.48, 0.6, 0.72] };
  const slime = slimeCount(board);
  // Constraints (user 2026-07-23): slime/xe ≥ 3 (cap cars at floor(slime/3));
  // L2-4 ≤20 xe; L2 ≤12 màu. Colour cap also kept ratio-feasible.
  const carCap = Math.min(Math.floor(slime / 3), (n >= 2 && n <= 4) ? 20 : Infinity);
  const colorCap = Math.min(n === 2 ? 12 : 18, Math.floor(slime / 3));
  const carN = () => Math.min(carCap, Math.max(distinctColors(board), distinctColors(board) * 2 + 2));
  let best = calibrateOrder(allocateCars(board, carN()), board, BOARD_SIZE, BOARD_SIZE, track, target, opt);
  // too easy → sprinkle in more colours to raise difficulty (up to the colour cap)
  let g = 0;
  while (best.win > target + 8 && distinctColors(board) < colorCap && g++ < 6) {
    board = ensureColors(board, Math.min(distinctColors(board) + 2, colorCap), seed + g * 17);
    best = calibrateOrder(allocateCars(board, carN()), board, BOARD_SIZE, BOARD_SIZE, track, target, opt);
  }
  // too hard → hand out more cars (more launches), but never below slime/xe = 3
  let easeN = carN(), g2 = 0;
  while (best.win < target - 8 && easeN < carCap && g2++ < 7) {
    easeN = Math.min(carCap, easeN + 3);
    const b2 = calibrateOrder(allocateCars(board, easeN), board, BOARD_SIZE, BOARD_SIZE, track, target, opt);
    if (Math.abs(b2.win - target) < Math.abs(best.win - target)) best = b2;
    if (b2.win >= target || easeN >= carCap) break;
  }
  return { board, chests: best.order, win: best.win, bias: best.b };
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
    const pairs = want > 0 ? pickPairs(L.chests, L.board, track, want) : [];
    for (const [a, b] of pairs) { pid++; L.chests[a].pairId = pid; L.chests[b].pairId = pid; }
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

fs.mkdirSync(PREVIEW_DIR, { recursive: true });
const levels = {};
const summary = [];
let prevEarly = 0; // running slime count so L1-10 stays strictly increasing

for (let n = 1; n <= N_LEVELS; n++) {
  const diff = difficulty(n);
  const target = targetWin(n, diff);
  const vivid = diff === "normal";                 // easy → màu tươi; hard/super → natural
  const hard = diff !== "normal";
  const pick = hard ? hardImages[hardPtr++ % hardImages.length] : easyImages[easyPtr++ % easyImages.length];
  const { dir, file } = pick;

  const { data, info } = await sharp(path.join(dir, file))
    .ensureAlpha()
    .resize(512, 512, { fit: "inside", withoutEnlargement: true })
    .raw().toBuffer({ resolveWithObject: true });

  const baseK = baseColorsFor(target);
  let board;
  if (n <= 10) {
    const r = buildEarly(data, info.width, info.height, { mode: "game", vivid, K: baseK }, n, prevEarly);
    if (!r) { console.warn(`L${n}: no subject found in ${file} — skipped`); continue; }
    board = r.board; prevEarly = r.cnt;
  } else {
    board = buildFromImage(data, info.width, info.height, { mode: "game", vivid, K: baseK });
    if (!board) { console.warn(`L${n}: no subject found in ${file} — skipped`); continue; }
  }

  const track = trackFor(n, diff);
  const tuned = tuneToTarget(board, track, target, n, diff); // colours/cars/order/xe-đôi → win ≈ target
  board = tuned.board;
  const chests = tuned.chests;

  levels[n] = { track, cols: BOARD_SIZE, rows: BOARD_SIZE, board, chests };

  const pr = pairsOf(chests);
  const solved = pr.length ? solvablePairs(board, BOARD_SIZE, BOARD_SIZE, chests, track, pr) : solvable(board, BOARD_SIZE, BOARD_SIZE, chests, track);
  if (!solved) console.warn(`⚠ L${n}: perfect-solver could not clear it`);
  await boardToPng(board, path.join(PREVIEW_DIR, `L${String(n).padStart(2, "0")}.png`));
  summary.push({ n, diff, target, win: tuned.win, colors: distinctColors(board), slimes: slimeCount(board), cars: chests.length, track, file, solved });
  if (n % 10 === 0) console.log(`  …built L${n} (${summary.filter((s) => s.solved).length}/${summary.length} solvable so far)`);
}

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
console.log(`previews → ${path.relative(ROOT, PREVIEW_DIR)}/L01.png … L${N_LEVELS}.png`);
