// genlib.mjs — helpers dùng chung cho gen25.mjs + rebuild-band.mjs (2026-07-30).
// THƯỚC ĐO ĐỘ KHÓ DUY NHẤT: trip-sim (simcore.rollout). KHÔNG dùng bot-MC/slamgrade/solvable cũ
// (đã bị chứng minh sai — xem Manythings/Design level/level-design-guide.md §7).
// Rule viền: border.mjs (chữ nhật bbox+1 ≤30% board, cấm màu sát ranh) — build-one.mjs áp sẵn.
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { makeState, rollout } from "./simcore.mjs";

export const ROOT = process.cwd();
export const OUT = path.join(ROOT, "src/levels/designed.json");
export const isC = (v) => v >= 0 && v < 90;
export const mkRng = (s) => { let x = (s >>> 0) || 1; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 0xffffffff; }; };
export const readD = () => JSON.parse(fs.readFileSync(OUT, "utf8"));
export const writeD = (d) => { const s = {}; for (const k of Object.keys(d).map(Number).sort((a, b) => a - b)) s[k] = d[k]; fs.writeFileSync(OUT, JSON.stringify(s, null, 2)); };
export const sh = (cmd, env) => execSync(cmd, { cwd: ROOT, env: { ...process.env, ...(env || {}) }, stdio: ["ignore", "pipe", "pipe"] }).toString();

// ---- khoá CHUẨN HOÁ tên ảnh -------------------------------------------------
// Kho sliced có 2 BẢN cùng một artwork: "2_elephant.png" (animals2/) và
// "2_elephant_animals2.png" (_simple/) — sổ cái theo basename không thấy trùng (bug
// 2026-07-31: L21 lấy đúng con voi của L2). Khoá chuẩn = "<số>_<tên>" khi tên bắt đầu
// bằng số (quy ước sliced); tên khác (Gemini/hard) giữ nguyên basename.
export const canonName = (p) => {
  const b = path.basename(p);
  const parts = b.replace(/\.(png|jpg)$/i, "").split("_");
  return /^\d+$/.test(parts[0]) && parts.length >= 2 ? parts[0] + "_" + parts[1] : b;
};

// ---- đo winrate trip-sim in-process (deterministic) -------------------------
export function measure(L, N = 48, seedBase = 7919) {
  const s0 = makeState(L);
  let wins = 0;
  for (let t = 1; t <= N; t++) if (rollout(s0, t * seedBase + 13).win) wins++;
  return Math.round((100 * wins) / N);
}

// ---- độ sâu bóc outside-in --------------------------------------------------
// ĐÁ (≥90) là VẬT ĐẶC VĨNH VIỄN: ô cạnh đá KHÔNG được tính là lộ từ phía đá (khác -1/mép).
export function cellDepth(L) {
  const { cols, rows } = L; const occ = L.board.slice(); const idx = (r, c) => r * cols + c;
  const solid = (v) => isC(v) || v >= 90;
  const dep = new Array(occ.length).fill(-1); let layer = 0, alive = occ.filter(isC).length;
  while (alive > 0 && layer < 500) {
    const exp = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = idx(r, c); if (!isC(occ[i])) continue;
      const open = (rr, cc) => rr < 0 || cc < 0 || rr >= rows || cc >= cols || !solid(occ[idx(rr, cc)]);
      if (open(r - 1, c) || open(r + 1, c) || open(r, c - 1) || open(r, c + 1)) exp.push(i);
    }
    if (!exp.length) break;
    for (const i of exp) { dep[i] = layer; occ[i] = -1; alive--; }
    layer++;
  }
  return dep;
}
export function colorDepth(L) {
  const dep = cellDepth(L); const sum = {}, cnt = {};
  L.board.forEach((v, i) => { if (isC(v) && dep[i] >= 0) { sum[v] = (sum[v] || 0) + dep[i]; cnt[v] = (cnt[v] || 0) + 1; } });
  const res = {}; for (const k in cnt) res[k] = sum[k] / cnt[k]; return res;
}

// ---- chia xe theo màu (~20-30 con/xe) ---------------------------------------
// minCars: tách đôi xe to nhất tới khi đủ sàn; maxCars: gộp 2 xe cùng màu nhỏ nhất (≤36).
export function reCar(L, seed, opts = {}) {
  const { minCars = 0, maxCars = 99 } = opts;
  const cnt = {};
  for (const v of L.board) if (isC(v)) cnt[v] = (cnt[v] || 0) + 1;
  if (L.layer2) for (const v of L.layer2) if (v >= 0) cnt[v] = (cnt[v] || 0) + 1;
  const cars = [];
  for (const [c, n0] of Object.entries(cnt)) {
    let n = n0; const col = +c;
    while (n > 0) {
      let take = n <= 36 ? n : 24 + Math.floor(mkRng(seed + col * 7 + n)() * 7);
      if (n - take > 0 && n - take < 12) take = n;
      if (take > 36) take = Math.ceil(n / 2);
      take = Math.min(take, n); cars.push({ color: col, count: take }); n -= take;
    }
  }
  let guard = 0;
  while (cars.length < minCars && guard++ < 60) {
    cars.sort((a, b) => b.count - a.count);
    const big = cars[0];
    if (big.count < 8) break; // không tách xe bé tí
    const half = Math.floor(big.count / 2);
    cars.push({ color: big.color, count: big.count - half });
    big.count = half;
  }
  guard = 0;
  while (cars.length > maxCars && guard++ < 60) {
    let done = false;
    const byCol = {};
    cars.forEach((c, i) => (byCol[c.color] = byCol[c.color] || []).push(i));
    for (const idxs of Object.values(byCol)) {
      if (idxs.length < 2) continue;
      idxs.sort((a, b) => cars[a].count - cars[b].count);
      const [a, b] = idxs;
      if (cars[a].count + cars[b].count <= 36) {
        cars[a].count += cars[b].count; cars.splice(b, 1); done = true; break;
      }
    }
    if (!done) break;
  }
  return cars;
}

// ---- thứ tự xe --------------------------------------------------------------
// gentle: thứ tự ≈ thứ tự LỘ màu (nông→sâu, jitter nhẹ) → dễ, winrate cao.
// offbeat "lệch nhịp": bgHead xe màu-viền mở màn, deepN xe màu-SÂU splice sớm (car 3-9),
// xe viền còn lại rải giữa hàng — độ khó đến từ lệch pha thứ-tự-xe vs thứ-tự-lộ-màu.
export function makeOrder(cars, cdep, seed, opts = {}) {
  const { bgColor = 12, bgHead = 2, deepN = 2, gentle = false } = opts;
  const rng = mkRng(seed);
  if (gentle) {
    return cars.slice().sort((a, b) => ((cdep[a.color] || 0) + rng() * 1.2) - ((cdep[b.color] || 0) + rng() * 1.2));
  }
  const bg = cars.filter((c) => c.color === bgColor);
  const rest = cars.filter((c) => c.color !== bgColor);
  rest.sort((a, b) => ((cdep[a.color] || 0) + rng() * 2) - ((cdep[b.color] || 0) + rng() * 2));
  const deepPick = rest.map((c, i) => ({ c, i, d: cdep[c.color] || 0 })).sort((x, y) => y.d - x.d).slice(0, deepN);
  const picked = new Set(deepPick.map((x) => x.i));
  const base = rest.filter((_, i) => !picked.has(i));
  const order = [...bg.slice(0, bgHead), ...base];
  let pos = 3 + Math.floor(rng() * 3);
  for (const x of deepPick) { if (pos > order.length) pos = order.length; order.splice(pos, 0, x.c); pos += 2 + Math.floor(rng() * 4); }
  let p2 = 6 + Math.floor(rng() * 3);
  for (const nv of bg.slice(bgHead)) { if (p2 > order.length) p2 = order.length; order.splice(p2, 0, nv); p2 += 3 + Math.floor(rng() * 3); }
  return order;
}

// ---- layer2 (2-lớp) ---------------------------------------------------------
// Cụm dưới Ô VIỀN (bgColor): 1-maxClusters cụm BFS 18-32 ô, MỖI CỤM MỘT MÀU (rule "theo
// nhóm, không loang lổ" — user). ~15% cụm mang chính màu viền.
export function addLayer2Clustered(L, seed, frac, bgColor = 12, maxClusters = 3) {
  const rng = mkRng(seed);
  const { cols } = L;
  const dep = cellDepth(L);
  const bgSet = new Set(); L.board.forEach((v, i) => { if (v === bgColor) bgSet.add(i); });
  const target = Math.round(bgSet.size * frac);
  const lay = new Array(L.board.length).fill(-1);
  if (target <= 0) { L.layer2 = null; return 0; }
  const subj = [...new Set(L.board.filter((v) => isC(v) && v !== bgColor))];
  if (!subj.length) { L.layer2 = null; return 0; }
  const nClusters = Math.max(1, Math.min(maxClusters, Math.round(target / 25)));
  const seeds = [...bgSet].sort((a, b) => dep[a] - dep[b]).filter((_, i) => i % 3 === 0);
  let buried = 0;
  const nb = (i) => [i - 1, i + 1, i - cols, i + cols].filter((j) => bgSet.has(j) && lay[j] < 0);
  for (let c = 0; c < nClusters && buried < target && seeds.length; c++) {
    const s0 = seeds[Math.floor(rng() * Math.min(seeds.length, 20))];
    if (s0 == null || lay[s0] >= 0) continue;
    const colour = rng() < 0.15 ? bgColor : subj[Math.floor(rng() * subj.length)];
    const size = Math.min(target - buried, 18 + Math.floor(rng() * 12));
    const q = [s0]; lay[s0] = colour; let n = 1; buried++;
    while (q.length && n < size) {
      const cur = q.shift();
      for (const j of nb(cur)) { if (n >= size) break; lay[j] = colour; q.push(j); n++; buried++; }
    }
  }
  L.layer2 = buried > 0 ? lay : null;
  return buried;
}
// TỔNG QUÁT: chôn ĐÚNG want ô thành CỤM 14-30 ô MỘT MÀU (rule "theo nhóm, không loang lổ"),
// ưu tiên ô VIỀN lộ-sớm rồi tới ô CHỦ THỂ nông. Đây là CẦN CHỈNH ĐỘ KHÓ CHÍNH trên board
// viền-gọn (đo 2026-07-30: 40 ô ≈ 25-40%, 70 ô ≈ 6-10%, ≥100 ô = 0% — dốc ~1-2 điểm/ô).
export function addLayer2Clusters(L, seed, want, opts = {}) {
  const { bgColor = 12, maxClusters = 8 } = opts;
  const rng = mkRng(seed); const { cols } = L;
  if (want < 8) { L.layer2 = null; return 0; } // cụm < 8 ô = chấm lẻ loang lổ → thà bỏ hẳn
  const dep = cellDepth(L);
  const bgCells = [], subjCells = [];
  L.board.forEach((v, i) => { if (!isC(v)) return; if (v === bgColor) bgCells.push(i); else if (dep[i] >= 1) subjCells.push(i); });
  bgCells.sort((a, b) => dep[a] - dep[b]); subjCells.sort((a, b) => dep[a] - dep[b]);
  const cand = [...bgCells, ...subjCells];
  const candSet = new Set(cand);
  const subj = [...new Set(L.board.filter((v) => isC(v) && v !== bgColor))];
  if (!subj.length || !cand.length) { L.layer2 = null; return 0; }
  const lay = new Array(L.board.length).fill(-1);
  let buried = 0, guard = 0;
  const nb = (i) => [i - 1, i + 1, i - cols, i + cols].filter((j) => candSet.has(j) && lay[j] < 0);
  while (buried < want && guard++ < maxClusters + 20) {
    const open = cand.filter((i) => lay[i] < 0);
    if (!open.length) break;
    const s0 = open[Math.floor(rng() * Math.min(open.length, 25))];
    const colour = rng() < 0.15 ? bgColor : subj[Math.floor(rng() * subj.length)];
    const size = Math.min(want - buried, 14 + Math.floor(rng() * 16));
    const q = [s0]; lay[s0] = colour; let n = 1; buried++;
    while (q.length && n < size) {
      const cur = q.shift();
      for (const j of nb(cur)) { if (n >= size) break; lay[j] = colour; q.push(j); n++; buried++; }
    }
  }
  L.layer2 = buried > 0 ? lay : null;
  return buried;
}
// Chôn thêm dưới Ô CHỦ THỂ lộ-sớm (nâng khó khi cụm viền chưa đủ) — từ tune-band.
export function addLayer2Subject(L, want, seed, bgColor = 12) {
  const dep = cellDepth(L);
  const lay = L.layer2 ? L.layer2.slice() : new Array(L.board.length).fill(-1);
  let have = lay.filter((v) => v >= 0).length;
  const rng = mkRng(seed);
  const subj = [...new Set(L.board.filter((v) => isC(v) && v !== bgColor))];
  if (!subj.length) return have;
  const cand = [];
  L.board.forEach((v, i) => { if (isC(v) && lay[i] < 0 && dep[i] >= 1) cand.push(i); });
  cand.sort((a, b) => dep[a] - dep[b]);
  for (const i of cand) { if (have >= want) break; lay[i] = rng() < 0.12 ? bgColor : subj[Math.floor(rng() * subj.length)]; have++; }
  L.layer2 = lay;
  return have;
}

// ---- xe "?" (chôn xe — che màu/số tới khi lên đầu lane; perception-only) ----
export function addBuried(L, dens, seed, lanes = 4) {
  for (const c of L.chests) delete c.buried;
  const start = 2 * lanes; // 2 hàng đầu luôn ngửa để đọc được level
  const cand = [];
  for (let i = start; i < L.chests.length; i++) if (L.chests[i].pairId == null) cand.push(i);
  let s = seed >>> 0 || 1;
  for (let i = cand.length - 1; i > 0; i--) { s = (s * 1664525 + 1013904223) >>> 0; const j = s % (i + 1); [cand[i], cand[j]] = [cand[j], cand[i]]; }
  const want = Math.round(dens * cand.length);
  for (let m = 0; m < want && m < cand.length; m++) L.chests[cand[m]].buried = true;
  return Math.min(want, cand.length);
}

// ---- tường đá cạnh board (code 90) — port placeWalls từ build-levels --------
export function placeWalls(board, cols, rows, edges, thick = 1) {
  if (!edges) return 0;
  const E = edges.toUpperCase();
  let n = 0;
  const rock = (r, c) => { if (r >= 0 && r < rows && c >= 0 && c < cols) { const i = r * cols + c; if (board[i] !== 90) { board[i] = 90; n++; } } };
  for (let t = 0; t < thick; t++) {
    if (E.includes("T")) for (let c = 0; c < cols; c++) rock(t, c);
    if (E.includes("B")) for (let c = 0; c < cols; c++) rock(rows - 1 - t, c);
    if (E.includes("L")) for (let r = 0; r < rows; r++) rock(r, t);
    if (E.includes("R")) for (let r = 0; r < rows; r++) rock(r, cols - 1 - t);
  }
  return n;
}

// ---- slime "?" ẩn (blob trong lõi, min 8 ô) — port makeHidden từ build-levels
export function makeHidden(board, cols, rows, frac, seed) {
  const rng = mkRng(seed);
  const hidden = new Array(board.length).fill(-1);
  const isSlime = (i) => board[i] >= 0 && board[i] < 90;
  const eligible = []; const elig = new Set();
  for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) {
    const i = r * cols + c;
    if (!isSlime(i)) continue;
    if (isSlime(i - cols) && isSlime(i + cols) && isSlime(i - 1) && isSlime(i + 1)) { eligible.push(i); elig.add(i); }
  }
  if (eligible.length < 8) return null;
  const target = Math.max(8, Math.round(eligible.length * frac));
  const nb = (i) => { const r = Math.floor(i / cols), c = i % cols; return [r > 0 ? i - cols : -1, r < rows - 1 ? i + cols : -1, c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1]; };
  let count = 0;
  const blobs = Math.max(1, Math.round(target / 60));
  let guard = 0;
  while (count < target && guard++ < blobs + 40) {
    const seeds = eligible.filter((i) => hidden[i] < 0);
    if (!seeds.length) break;
    const start = seeds[Math.floor(rng() * seeds.length)];
    const frontier = [start];
    while (frontier.length && count < target) {
      const k = Math.floor(rng() * frontier.length);
      const i = frontier.splice(k, 1)[0];
      if (hidden[i] >= 0 || !elig.has(i)) continue;
      hidden[i] = board[i]; count++;
      for (const j of nb(i)) if (j >= 0 && elig.has(j) && hidden[j] < 0) frontier.push(j);
    }
  }
  return count >= 8 ? { hidden, count } : null;
}

// ---- xe đôi NHẸ (level dễ: dạy cơ chế, không cần "meaningful") --------------
// Cặp NGANG kề nhau cùng hàng, KHÁC màu, KHÔNG navy-12 (rule dây nhìn thấy); ưu tiên cặp
// màu NÔNG (phóng sớm ăn được ngay — dạy đúng lúc). forceFront: cặp ở index 0-1 (tutorial L8
// spotlight cần cả nhóm ở hàng đầu).
export function addGentleTwins(L, nPairs, seed, cdep, opts = {}) {
  const lanes = L.lanes || 4;
  const rng = mkRng(seed);
  for (const c of L.chests) delete c.pairId;
  if (nPairs <= 0) return 0;
  const cand = [];
  for (let i = 0; i < L.chests.length - 1; i++) {
    if (i % lanes === lanes - 1) continue;
    const a = L.chests[i], b = L.chests[i + 1];
    if (a.color === b.color || a.color === 12 || b.color === 12) continue;
    const d = Math.max(cdep[a.color] || 0, cdep[b.color] || 0);
    cand.push({ i, d, front: i < lanes });
  }
  if (!cand.length) return 0;
  cand.sort((x, y) => (x.d + rng()) - (y.d + rng())); // nông trước
  if (opts.forceFront) cand.sort((x, y) => (y.front ? 1 : 0) - (x.front ? 1 : 0) || x.d - y.d);
  const used = new Set(); let made = 0;
  for (const g of cand) {
    if (made >= nPairs) break;
    if (used.has(g.i) || used.has(g.i + 1)) continue;
    L.chests[g.i].pairId = made; L.chests[g.i + 1].pairId = made;
    used.add(g.i); used.add(g.i + 1); made++;
  }
  return made;
}

// ---- xe đôi HÀNH-LÝ (baggage): ghép cặp NGANG kề nhau LỆCH ĐỘ SÂU màu nhất --
// Nửa nông ăn được ngay, nửa sâu CHIẾM Ô CHỜ tới khi màu nó lộ → áp lực bay thật (gánh
// dương trong trip-sim). Khác tunetwins (meaningful-fork meter — hay ra gánh âm trên
// board sliced, 2026-07-31). Rule dây: khác màu, cấm navy-12, cùng hàng kề cột.
export function addBaggageTwins(L, nPairs, cdep, seed = 1) {
  const lanes = L.lanes || 4;
  const rng = mkRng(seed);
  for (const c of L.chests) delete c.pairId;
  if (nPairs <= 0) return 0;
  const cand = [];
  for (let i = 0; i < L.chests.length - 1; i++) {
    if (i % lanes === lanes - 1) continue;
    const a = L.chests[i], b = L.chests[i + 1];
    if (a.color === b.color || a.color === 12 || b.color === 12) continue;
    cand.push({ i, gap: Math.abs((cdep[a.color] || 0) - (cdep[b.color] || 0)) + rng() * 0.5 });
  }
  cand.sort((x, y) => y.gap - x.gap);
  const used = new Set(); let made = 0;
  for (const g of cand) {
    if (made >= nPairs) break;
    if (used.has(g.i) || used.has(g.i + 1)) continue;
    L.chests[g.i].pairId = made; L.chests[g.i + 1].pairId = made;
    used.add(g.i); used.add(g.i + 1); made++;
  }
  return made;
}

// ---- xe đôi KHÓ qua tunetwins CLI (đo meaningful-decision, cap TWINCAP) -----
export function tuneTwinsCli(lvl, cap) {
  try { sh(`node scripts/build-levels.mjs --tunetwins`, { ONLY: String(lvl), TWINCAP: String(cap) }); return true; }
  catch { return false; }
}

// ---- build board từ ảnh qua build-one (viền chữ nhật mới) -------------------
// Trả {ok, borderPct, bgColor, lightBoard} — ok=false khi ảnh vượt 30% (exit 2) / lỗi khác.
export function buildBoard(img, lvl, K, size) {
  try {
    const out = sh(`node scripts/build-one.mjs "${img}" -1 ${lvl} ${K} ${size}`);
    const m = out.match(/viền chữ nhật id (\d+), (\d+) ô = (\d+)% board/);
    return { ok: true, bgColor: m ? +m[1] : 12, borderCells: m ? +m[2] : 0, borderPct: m ? +m[3] : 0 };
  } catch (e) {
    return { ok: false, exit: e.status ?? -1 };
  }
}
