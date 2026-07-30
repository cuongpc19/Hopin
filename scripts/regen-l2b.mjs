// regen-l2b.mjs — PASS 2 của regen-l2: sửa bug "break sớm ghi đè nấc tốt". Với mỗi level thử đủ
// các nấc cần thiết (tái tạo deterministic đúng seed pass 1), đo bot, CHỌN nấc gần band [10,40]
// nhất. Nấc đã biết từ pass 1 thì áp lại thẳng, không đo lại.
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "src/levels/designed.json");
const LOG = path.join(ROOT, "scripts/_regenl2b-log.txt");
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
  const nClusters = Math.max(2, Math.min(5, Math.round(target / 25)));
  const seeds = [...bgSet].sort((a, b) => dep[a] - dep[b]).filter((_, i) => i % 3 === 0);
  let buried = 0, made = 0;
  const nb = (i) => [i - 1, i + 1, i - cols, i + cols].filter((j) => bgSet.has(j) && lay[j] < 0);
  for (let c = 0; c < nClusters && buried < target && seeds.length; c++) {
    const s0 = seeds[Math.floor(rng() * Math.min(seeds.length, 20))];
    if (s0 == null || lay[s0] >= 0) continue;
    const colour = (made === 0 && rng() < 0.5) || rng() < 0.12 ? 12 : subj[Math.floor(rng() * subj.length)];
    const size = Math.min(target - buried, 18 + Math.floor(rng() * 15));
    const q = [s0]; lay[s0] = colour; let n = 1; buried++;
    while (q.length && n < size) {
      const cur = q.shift();
      for (const j of nb(cur)) { if (n >= size) break; lay[j] = colour; q.push(j); n++; buried++; }
    }
    made++;
    seeds.splice(0, 0);
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
const KNOBS = [[0.4, 2, 4], [0.35, 3, 3], [0.3, 3, 2], [0.25, 4, 2], [0.2, 4, 1], [0.12, 5, 0]];
// áp nấc ki cho level (tái tạo deterministic pass 1). Trả {ok, w?, chests, layer2}
function applyKnob(d, lvl, ki, measure) {
  const L = d[lvl];
  delete L.layer2; for (const c of L.chests) delete c.pairId;
  const [frac, navyHead, deepN] = KNOBS[ki];
  addLayer2Clustered(L, lvl * 613 + ki * 71 + 7, frac);
  const cdep = colorDepth(L);
  const cars = reCar(L, lvl * 31 + ki);
  for (let seed = 1; seed <= 25; seed++) {
    L.chests = makeOrder(cars.map((c) => ({ ...c })), cdep, lvl * 7919 + seed * 137 + ki * 17, navyHead, deepN);
    writeD(d);
    if (diagSolvable(lvl)) return { ok: true, w: measure ? botWin(lvl) : null };
  }
  return { ok: false };
}
const dist = (w) => (w < 10 ? 10 - w : w > 40 ? w - 40 : 0);

fs.writeFileSync(LOG, "");
// PLAN: known = các (nấc→bot%) đã đo pass 1; try = nấc cần đo thêm
const PLAN = {
  131: { known: { 0: 100 }, try: [1, 2, 3, 4, 5] },
  132: { known: { 0: 95 }, try: [1, 2, 3, 4, 5] },
  133: { known: { 0: 2, 1: 0, 2: 0, 3: 2, 4: 8, 5: 100 }, try: [] },
  134: { known: { 0: 8, 1: 98 }, try: [2, 3] },
  135: { known: { 0: 82 }, try: [1, 2, 3, 4, 5] },
  136: { known: { 0: 100 }, try: [1, 2, 3, 4, 5] },
  137: { known: { 0: 2, 1: 7, 2: 10 }, try: [] },
  138: { known: { 0: 12 }, try: [] },
  139: { known: { 0: 85 }, try: [1, 2, 3, 4, 5] },
  140: { known: { 0: 17 }, try: [] },
  141: { known: { 0: 95 }, try: [1, 2, 3, 4, 5] },
  142: { known: { 0: 0, 1: 0, 2: 0, 3: 50 }, try: [4, 5] },
  143: { known: { 0: 93 }, try: [1, 2, 3, 4, 5] },
  144: { known: { 0: 0, 1: 7, 2: 78 }, try: [3] },
  145: { known: { 0: 12 }, try: [] },
};
const final = [];
for (const [lvlS, p] of Object.entries(PLAN)) {
  const lvl = +lvlS;
  const scores = { ...p.known };
  const d = readD();
  if (!d[lvl] || !d[lvl].slam) { log(`L${lvl}: thiếu`); continue; }
  for (const ki of p.try) {
    const r = applyKnob(d, lvl, ki, true);
    if (r.ok) { scores[ki] = r.w; log(`L${lvl}: nấc ${ki} → bot ${r.w}%`); }
    else log(`L${lvl}: nấc ${ki} không solvable`);
  }
  // chọn nấc tốt nhất
  let bestKi = null, bestD = 1e9;
  for (const [ki, w] of Object.entries(scores)) { const dd = dist(w); if (dd < bestD) { bestD = dd; bestKi = +ki; } }
  const r = applyKnob(d, lvl, bestKi, false); // áp lại (không đo)
  if (!r.ok) { log(`L${lvl}: áp nấc ${bestKi} LỖI solvable (lạ) — thử đo lại`); continue; }
  log(`L${lvl}: CHỐT nấc ${bestKi} (bot ${scores[bestKi]}%)`);
  final.push({ lvl, ki: bestKi, w: scores[bestKi] });
}
log("\n==== CHỐT CUỐI (band 10-40) ====");
for (const f of final) log(`L${f.lvl}: nấc ${f.ki} → bot ${f.w}%`);
log("✔ regen-l2b xong");
