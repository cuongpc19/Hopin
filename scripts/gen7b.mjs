// gen7b.mjs — PASS B của gen7: sửa 2 lỗi pass A (L151/152 chưa được đo vì slamgrade cụt range;
// "giữ bản cuối" thay vì bản TỐT NHẤT). Tái tạo deterministic từng attempt, đo đủ, chọn gần đích.
//  • L148/L149: áp lại attempt tốt nhất pass A (48→attempt1 57%, 149→attempt0 47%) + gắn "?"
//  • L151/L152: đo lại đủ 4 attempt (giờ slamgrade đã quét tới 160), chọn gần band 20-45
//  • L146/L147 (twin-heavy): sweep thêm cấu hình, tiêu chí nới [12,45] & twin gánh ≥15 điểm,
//    chọn final gần 25% nhất
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "src/levels/designed.json");
const LOG = path.join(ROOT, "scripts/_gen7b-log.txt");
const log = (s) => { console.log(s); fs.appendFileSync(LOG, s + "\n"); };
const mkRng = (s) => { let x = (s >>> 0) || 1; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 0xffffffff; }; };
const readD = () => JSON.parse(fs.readFileSync(OUT, "utf8"));
const writeD = (d) => { const s = {}; for (const k of Object.keys(d).map(Number).sort((a, b) => a - b)) s[k] = d[k]; fs.writeFileSync(OUT, JSON.stringify(s, null, 2)); };
const sh = (cmd, env) => execSync(cmd, { cwd: ROOT, env: { ...process.env, ...(env || {}) }, stdio: ["ignore", "pipe", "pipe"] }).toString();
const isC = (v) => v >= 0 && v < 90;

function cellDepth(L) {
  const { cols, rows } = L; const occ = L.board.slice(); const idx = (r, c) => r * cols + c;
  const dep = new Array(occ.length).fill(-1); let layer = 0, alive = occ.filter(isC).length;
  while (alive > 0 && layer < 500) {
    const exp = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const i = idx(r, c); if (!isC(occ[i])) continue;
      if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1 || !isC(occ[idx(r - 1, c)]) || !isC(occ[idx(r + 1, c)]) || !isC(occ[idx(r, c - 1)]) || !isC(occ[idx(r, c + 1)])) exp.push(i); }
    if (!exp.length) break; for (const i of exp) { dep[i] = layer; occ[i] = -1; alive--; } layer++;
  }
  return dep;
}
function colorDepth(L) {
  const dep = cellDepth(L); const sum = {}, cnt = {};
  L.board.forEach((v, i) => { if (isC(v) && dep[i] >= 0) { sum[v] = (sum[v] || 0) + dep[i]; cnt[v] = (cnt[v] || 0) + 1; } });
  const res = {}; for (const k in cnt) res[k] = sum[k] / cnt[k]; return res;
}
function addLayer2Clustered(L, seed, frac) {
  const rng = mkRng(seed);
  const { cols } = L;
  const dep = cellDepth(L);
  const bgSet = new Set(); L.board.forEach((v, i) => { if (v === 12) bgSet.add(i); });
  const target = Math.round(bgSet.size * frac);
  const lay = new Array(L.board.length).fill(-1);
  if (target <= 0) { L.layer2 = null; return 0; }
  const subj = [...new Set(L.board.filter((v) => isC(v) && v !== 12))];
  const nClusters = Math.max(1, Math.min(3, Math.round(target / 25)));
  const seeds = [...bgSet].sort((a, b) => dep[a] - dep[b]).filter((_, i) => i % 3 === 0);
  let buried = 0, made = 0;
  const nb = (i) => [i - 1, i + 1, i - cols, i + cols].filter((j) => bgSet.has(j) && lay[j] < 0);
  for (let c = 0; c < nClusters && buried < target && seeds.length; c++) {
    const s0 = seeds[Math.floor(rng() * Math.min(seeds.length, 20))];
    if (s0 == null || lay[s0] >= 0) continue;
    const colour = rng() < 0.15 ? 12 : subj[Math.floor(rng() * subj.length)];
    const size = Math.min(target - buried, 18 + Math.floor(rng() * 12));
    const q = [s0]; lay[s0] = colour; let n = 1; buried++;
    while (q.length && n < size) {
      const cur = q.shift();
      for (const j of nb(cur)) { if (n >= size) break; lay[j] = colour; q.push(j); n++; buried++; }
    }
    made++;
  }
  L.layer2 = buried > 0 ? lay : null;
  return buried;
}
function reCar(L, seed) {
  const cnt = {};
  for (const v of L.board) if (isC(v)) cnt[v] = (cnt[v] || 0) + 1;
  if (L.layer2) for (const v of L.layer2) if (v >= 0) cnt[v] = (cnt[v] || 0) + 1;
  const cars = [];
  for (const [c, n0] of Object.entries(cnt)) {
    let n = n0; const col = +c;
    while (n > 0) {
      let take = n <= 36 ? n : 24 + Math.floor(mkRng(seed + col * 7 + n)() * 7);
      if (n - take > 0 && n - take < 12) take = n; if (take > 36) take = Math.ceil(n / 2);
      take = Math.min(take, n); cars.push({ color: col, count: take }); n -= take;
    }
  }
  return cars;
}
function makeOrder(cars, cdep, seed, navyHead, deepN) {
  const rng = mkRng(seed);
  const navy = cars.filter((c) => c.color === 12);
  const rest = cars.filter((c) => c.color !== 12);
  rest.sort((a, b) => ((cdep[a.color] || 0) + rng() * 2) - ((cdep[b.color] || 0) + rng() * 2));
  const deepPick = rest.map((c, i) => ({ c, i, d: cdep[c.color] || 0 })).sort((x, y) => y.d - x.d).slice(0, deepN);
  const picked = new Set(deepPick.map((x) => x.i));
  const base = rest.filter((_, i) => !picked.has(i));
  const order = [...navy.slice(0, navyHead), ...base];
  let pos = 3 + Math.floor(rng() * 3);
  for (const x of deepPick) { if (pos > order.length) pos = order.length; order.splice(pos, 0, x.c); pos += 2 + Math.floor(rng() * 4); }
  let p2 = 6 + Math.floor(rng() * 3);
  for (const nv of navy.slice(navyHead)) { if (p2 > order.length) p2 = order.length; order.splice(p2, 0, nv); p2 += 3 + Math.floor(rng() * 3); }
  return order;
}
const diagSolvable = (lvl) => /perfect-player = true/.test(sh(`node scripts/build-levels.mjs --diag ${lvl}`));
const botWin = (lvl) => {
  const out = sh(`node scripts/build-levels.mjs --slamgrade`, { MECH: "1", AUTODRIVE: "1", SKILL: "0.9", ONLY: String(lvl) });
  const m = out.match(new RegExp("^L" + lvl + "\\s+\\S+\\s+(\\d+)", "m"));
  return m ? +m[1] : -1;
};
function addBuried(L, dens, seed, lanes = 4) {
  for (const c of L.chests) delete c.buried;
  const start = 2 * lanes;
  const cand = [];
  for (let i = start; i < L.chests.length; i++) if (L.chests[i].pairId == null) cand.push(i);
  let s = seed >>> 0 || 1;
  for (let i = cand.length - 1; i > 0; i--) { s = (s * 1664525 + 1013904223) >>> 0; const j = s % (i + 1); [cand[i], cand[j]] = [cand[j], cand[i]]; }
  const want = Math.round(dens * cand.length);
  for (let m = 0; m < want && m < cand.length; m++) L.chests[cand[m]].buried = true;
  return want;
}
// tái tạo attempt MIXED của gen7 (deterministic y hệt pass A) rồi chạy tunetwins
function applyMixedAttempt(lvl, attempt) {
  const d = readD(); const L = d[lvl];
  delete L.layer2; for (const c of L.chests) { delete c.pairId; delete c.buried; }
  const frac = 0.15 + attempt * 0.04;
  addLayer2Clustered(L, lvl * 613 + attempt * 71 + 7, frac);
  const cdep = colorDepth(L);
  const cars = reCar(L, lvl * 31 + attempt);
  for (let seed = 1; seed <= 25; seed++) {
    L.chests = makeOrder(cars.map((c) => ({ ...c })), cdep, lvl * 7919 + seed * 137 + attempt * 17, 3, 2);
    writeD(d);
    if (diagSolvable(lvl)) {
      try { sh(`node scripts/build-levels.mjs --tunetwins`, { ONLY: String(lvl) }); } catch { /* */ }
      return true;
    }
  }
  return false;
}
const distTo = (w, lo, hi) => (w < lo ? lo - w : w > hi ? w - hi : 0);

fs.writeFileSync(LOG, "");

// ---- L148/L149: áp attempt tốt nhất pass A + "?" ----
for (const [lvl, attempt] of [[148, 1], [149, 0]]) {
  if (!applyMixedAttempt(lvl, attempt)) { log(`L${lvl}: áp attempt ${attempt} FAIL`); continue; }
  const w = botWin(lvl);
  const d = readD(); const nb = addBuried(d[lvl], 0.33, lvl * 131 + 7); writeD(d);
  log(`L${lvl}: áp attempt ${attempt} → bot ${w}% + ${nb} xe "?" ✓`);
}

// ---- L151/L152: đo đủ 4 attempt, chọn gần band [20,45] ----
for (const lvl of [151, 152]) {
  const scores = {};
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!applyMixedAttempt(lvl, attempt)) { log(`L${lvl}: attempt ${attempt} không solvable`); continue; }
    const w = botWin(lvl);
    scores[attempt] = w;
    log(`L${lvl}: attempt ${attempt} → bot ${w}%`);
  }
  let bestA = null, bestDist = 1e9;
  for (const [a, w] of Object.entries(scores)) { const dd = distTo(w, 20, 45); if (dd < bestDist) { bestDist = dd; bestA = +a; } }
  if (bestA == null) { log(`L${lvl}: không attempt nào dùng được`); continue; }
  applyMixedAttempt(lvl, bestA);
  const d = readD(); const nb = addBuried(d[lvl], 0.33, lvl * 131 + 7); writeD(d);
  log(`L${lvl}: CHỐT attempt ${bestA} (bot ${scores[bestA]}%) + ${nb} xe "?"`);
}

// ---- L146/L147: twin-heavy — sweep rộng, chọn final gần 25% với twin gánh ≥15 điểm ----
for (const lvl of [146, 147]) {
  const d0 = readD(); if (!d0[lvl] || !d0[lvl].slam) { log(`L${lvl}: thiếu`); continue; }
  let best = null; // {cfg, base, fin, dist, chests, layer2:null}
  const CFGS = [];
  for (const navyHead of [3, 4, 5]) for (const sb of [0, 1, 2]) CFGS.push({ navyHead, sb });
  for (const { navyHead, sb } of CFGS) {
    const d = readD(); const L = d[lvl];
    delete L.layer2; for (const c of L.chests) { delete c.pairId; delete c.buried; }
    const cdep = colorDepth(L);
    const cars = reCar(L, lvl * 31 + sb * 7);
    let ok = false;
    for (let seed = 1; seed <= 20; seed++) {
      L.chests = makeOrder(cars.map((c) => ({ ...c })), cdep, lvl * 7919 + seed * 137 + sb * 41 + navyHead * 5, navyHead, 0);
      writeD(d);
      if (diagSolvable(lvl)) { ok = true; break; }
    }
    if (!ok) continue;
    const base = botWin(lvl);
    if (base < 50) { log(`L${lvl}: cfg nh${navyHead}/s${sb} baseline ${base}% — bỏ (chưa đủ dễ)`); continue; }
    try { sh(`node scripts/build-levels.mjs --tunetwins`, { ONLY: String(lvl) }); } catch { /* */ }
    const fin = botWin(lvl);
    const gánh = base - fin;
    const dd = Math.abs(fin - 25);
    log(`L${lvl}: cfg nh${navyHead}/s${sb} — baseline ${base}% → twin ${fin}% (gánh ${gánh})`);
    if (fin >= 12 && fin <= 45 && gánh >= 15 && dd < (best ? best.dist : 1e9)) {
      const dNow = readD();
      best = { dist: dd, base, fin, chests: JSON.parse(JSON.stringify(dNow[lvl].chests)) };
      if (dd <= 5) break; // đủ sát 25%
    }
  }
  if (best) {
    const d = readD(); d[lvl].chests = best.chests; d[lvl].layer2 = null; delete d[lvl].layer2; writeD(d);
    log(`L${lvl}: ✓ CHỐT twin-heavy — baseline ${best.base}% → ${best.fin}% (twin gánh ${best.base - best.fin} điểm)`);
  } else log(`L${lvl}: vẫn chưa đạt — giữ bản hiện tại, cần xem tay`);
}

log("\n==== TỔNG KẾT GEN7B ====");
const d = readD();
for (let k = 146; k <= 152; k++) {
  const L = d[k]; if (!L || !L.slam) { log(`L${k}: THIẾU`); continue; }
  const tw = new Set(L.chests.filter((c) => c.pairId != null).map((c) => c.pairId)).size;
  const bu = L.chests.filter((c) => c.buried).length;
  const l2 = L.layer2 ? L.layer2.filter((v) => v >= 0).length : 0;
  log(`L${k}: ${L.chests.length} xe | ${tw} twin | ${bu} xe"?" | ${l2} ô chôn | bot ${botWin(k)}%`);
}
log("✔ gen7b xong");
