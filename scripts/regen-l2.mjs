// regen-l2.mjs — làm lại LAYER2 của L131-145 theo CỤM (user 2026-07-30: "màu cũng nên theo nhóm,
// giảm phân bổ loang lổ") + tự cân về band bot 10-40% (playtest xác nhận bot% ≈ người% trên bộ này:
// L131 bot15↔người14, L132 5↔0, L134 3↔0, L135 0↔0 — bộ cũ quá gắt, đa số 0%).
// Giữ nguyên ẢNH + BOARD; chỉ đắp lại lớp chôn (cụm), chia lại xe, xếp lại thứ tự, đo, nới/siết.
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "src/levels/designed.json");
const LOG = path.join(ROOT, "scripts/_regenl2-log.txt");
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

// LAYER2 theo CỤM: gieo K hạt trên vùng NỀN (ưu tiên lộ sớm-vừa), BFS lan ra ô nền KỀ NHAU thành
// mảng liền ~size ô, MỖI CỤM MỘT MÀU (đa số màu chủ thể; ~1 cụm màu nền). Hết loang lổ.
function addLayer2Clustered(L, seed, frac) {
  const rng = mkRng(seed);
  const { cols } = L;
  const dep = cellDepth(L);
  const bgSet = new Set(); L.board.forEach((v, i) => { if (v === 12) bgSet.add(i); });
  const target = Math.round(bgSet.size * frac);
  const lay = new Array(L.board.length).fill(-1);
  if (target <= 0) { L.layer2 = null; return 0; }
  const subj = [...new Set(L.board.filter((v) => isC(v) && v !== 12))];
  const nClusters = Math.max(2, Math.min(5, Math.round(target / 25)));
  const seeds = [...bgSet].sort((a, b) => dep[a] - dep[b]).filter((_, i) => i % 3 === 0); // hạt lộ sớm-vừa
  let buried = 0, made = 0;
  const nb = (i) => [i - 1, i + 1, i - cols, i + cols].filter((j) => bgSet.has(j) && lay[j] < 0);
  for (let c = 0; c < nClusters && buried < target && seeds.length; c++) {
    const s0 = seeds[Math.floor(rng() * Math.min(seeds.length, 20))];
    if (s0 == null || lay[s0] >= 0) continue;
    const colour = (made === 0 && rng() < 0.5) || rng() < 0.12 ? 12 : subj[Math.floor(rng() * subj.length)];
    const size = Math.min(target - buried, 18 + Math.floor(rng() * 15)); // cụm 18-32 ô
    const q = [s0]; lay[s0] = colour; let n = 1; buried++;
    while (q.length && n < size) {
      const cur = q.shift();
      for (const j of nb(cur)) { if (n >= size) break; lay[j] = colour; q.push(j); n++; buried++; }
    }
    made++;
    seeds.splice(0, 0); // giữ danh sách; hạt kế lấy random đầu danh sách
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

// thứ tự lệch nhịp có "núm nới": navyHead = số xe navy mở màn (2 gắt … 5 dễ); deepN = số xe sâu chen sớm
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

fs.writeFileSync(LOG, "");
const LO = 10, HI = 40;
const results = [];
for (let lvl = 131; lvl <= 145; lvl++) {
  const d = readD(); const L = d[lvl];
  if (!L || !L.slam) { log(`L${lvl}: thiếu — bỏ`); continue; }
  delete L.layer2;
  for (const c of L.chests) delete c.pairId;
  // các nấc từ GẮT → DỄ: [frac chôn, navyHead, deepN]
  const KNOBS = [[0.4, 2, 4], [0.35, 3, 3], [0.3, 3, 2], [0.25, 4, 2], [0.2, 4, 1], [0.12, 5, 0]];
  let best = null;
  for (let ki = 0; ki < KNOBS.length; ki++) {
    const [frac, navyHead, deepN] = KNOBS[ki];
    const buried = addLayer2Clustered(L, lvl * 613 + ki * 71 + 7, frac);
    const cdep = colorDepth(L);
    const cars = reCar(L, lvl * 31 + ki);
    let ok = false;
    for (let seed = 1; seed <= 25; seed++) {
      L.chests = makeOrder(cars.map((c) => ({ ...c })), cdep, lvl * 7919 + seed * 137 + ki * 17, navyHead, deepN);
      writeD(d);
      if (diagSolvable(lvl)) { ok = true; break; }
    }
    if (!ok) { log(`L${lvl}: nấc ${ki} không solvable — thử nấc kế`); continue; }
    const w = botWin(lvl);
    log(`L${lvl}: nấc ${ki} (chôn ${buried} ô cụm, navyĐầu ${navyHead}, xeSâu ${deepN}) → bot ${w}%`);
    best = { ki, w, chests: JSON.parse(JSON.stringify(L.chests)), layer2: L.layer2 ? L.layer2.slice() : null };
    if (w >= LO && w <= HI) break; // trong band → chốt
    if (w > HI) break;             // đã vượt lên dễ — nấc trước gắt hơn; chốt nấc này (gần band nhất phía trên)
  }
  if (best) {
    L.chests = best.chests; L.layer2 = best.layer2; writeD(d);
    results.push({ lvl, w: best.w });
  } else { log(`L${lvl}: KHÔNG nấc nào solvable — giữ nguyên bản cũ (cần xem tay)`); results.push({ lvl, w: -1 }); }
}
log("\n==== BOT CUỐI (band muốn: 10-40) ====");
for (const r of results) log(`L${r.lvl}: bot=${r.w}%`);
log("✔ regen-l2 xong — chạy tunetwins bổ sung sau nếu muốn");
