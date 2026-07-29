// tune-band.mjs — cân dải độ khó L131-145 về band bot-MC ~8-40% (mai user playtest calibrate).
// easier: kéo thêm xe màu-NÔNG (kể cả navy) từ giữa lên đầu hàng → bớt lệch nhịp → dễ hơn.
// harder: chôn thêm LAYER2 dưới ô CHỦ THỂ lộ-sớm (ngoài ô nền đã chôn) + re-car + re-order lệch nhịp.
// L145: build bù từ ảnh trong worktree (public/art/level art/1).
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "src/levels/designed.json");
const LOG = path.join(ROOT, "scripts/_tuneband-log.txt");
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
function makeOrder(cars, cdep, seed) {
  const rng = mkRng(seed);
  const navy = cars.filter((c) => c.color === 12);
  const rest = cars.filter((c) => c.color !== 12);
  rest.sort((a, b) => ((cdep[a.color] || 0) + rng() * 2) - ((cdep[b.color] || 0) + rng() * 2));
  const deepPick = rest.map((c, i) => ({ c, i, d: cdep[c.color] || 0 })).sort((x, y) => y.d - x.d).slice(0, 2 + Math.floor(rng() * 3));
  const picked = new Set(deepPick.map((x) => x.i));
  const base = rest.filter((_, i) => !picked.has(i));
  const order = [...navy.slice(0, 2), ...base];
  let pos = 3 + Math.floor(rng() * 3);
  for (const x of deepPick) { if (pos > order.length) pos = order.length; order.splice(pos, 0, x.c); pos += 2 + Math.floor(rng() * 4); }
  let p2 = 6 + Math.floor(rng() * 3);
  for (const nv of navy.slice(2)) { if (p2 > order.length) p2 = order.length; order.splice(p2, 0, nv); p2 += 3 + Math.floor(rng() * 3); }
  return order;
}
const diagSolvable = (lvl) => /perfect-player = true/.test(sh(`node scripts/build-levels.mjs --diag ${lvl}`));
const botWin = (lvl) => {
  const out = sh(`node scripts/build-levels.mjs --slamgrade`, { MECH: "1", AUTODRIVE: "1", SKILL: "0.9", ONLY: String(lvl) });
  const m = out.match(new RegExp("^L" + lvl + "\\s+\\S+\\s+(\\d+)", "m"));
  return m ? +m[1] : -1;
};

// EASIER: kéo k xe màu-nông từ giữa lên vị trí 2.. (không đụng twin)
function easier(L, cdep, k) {
  const ch = L.chests.map((c) => ({ ...c }));
  const idxs = ch.map((c, i) => ({ c, i })).filter((x) => x.i > 4 && x.c.pairId == null)
    .sort((a, b) => (cdep[a.c.color] || 0) - (cdep[b.c.color] || 0)).slice(0, k).map((x) => x.i).sort((a, b) => b - a);
  const moved = [];
  for (const i of idxs) moved.push(ch.splice(i, 1)[0]);
  ch.splice(2, 0, ...moved.reverse());
  return ch;
}
// HARDER: chôn thêm layer2 dưới ô CHỦ THỂ lộ-sớm cho đủ ~want ô, rồi re-car + re-order
function harder(L, want, seed) {
  const dep = cellDepth(L);
  const lay = L.layer2 ? L.layer2.slice() : new Array(L.board.length).fill(-1);
  let have = lay.filter((v) => v >= 0).length;
  const rng = mkRng(seed);
  const subj = [...new Set(L.board.filter((v) => isC(v) && v !== 12))];
  const cand = [];
  L.board.forEach((v, i) => { if (isC(v) && lay[i] < 0 && dep[i] >= 1) cand.push(i); }); // depth≥1: không chôn ngay rìa ngoài cùng
  cand.sort((a, b) => dep[a] - dep[b]);
  for (const i of cand) { if (have >= want) break; lay[i] = rng() < 0.12 ? 12 : subj[Math.floor(rng() * subj.length)]; have++; }
  L.layer2 = lay;
}

fs.writeFileSync(LOG, "");
const TARGET_LO = 8, TARGET_HI = 45;
const d0 = readD();

// ---- L145 build bù từ ảnh worktree ----
if (!d0[145] || !d0[145].slam) {
  const IMGS = ["public/art/level art/1/7_bear.png", "public/art/level art/1/3_penguin.png", "public/art/level art/1/6_bee.png", "public/art/level art/1/5_fish.png", "public/art/level art/1/3_frog.png"];
  for (const img of IMGS) {
    try { sh(`node scripts/build-one.mjs "${img}" -1 145 12 25`); } catch { continue; }
    const d = readD(); const L = d[145]; if (!L) continue;
    const cols = new Set(L.board.filter((v) => isC(v)));
    if (cols.size < 8) { log(`L145: bỏ ${path.basename(img)} (màu ${cols.size})`); continue; }
    // chôn nền + chủ thể tới ~110 ô
    const dep = cellDepth(L); const rng = mkRng(145 * 613 + 7);
    const bg = []; L.board.forEach((v, i) => { if (v === 12) bg.push(i); });
    bg.sort((a, b) => dep[a] - dep[b]);
    const lay = new Array(L.board.length).fill(-1);
    const subj = [...new Set(L.board.filter((v) => isC(v) && v !== 12))];
    for (const i of bg.slice(0, Math.round(bg.length * 0.4))) lay[i] = rng() < 0.15 ? 12 : subj[Math.floor(rng() * subj.length)];
    L.layer2 = lay;
    harder(L, 110, 145 * 7 + 1);
    const cdep = colorDepth(L); const cars = reCar(L, 145 * 31);
    L.slam = true; delete L.tray;
    let ok = false;
    for (let seed = 1; seed <= 30; seed++) {
      L.chests = makeOrder(cars.map((c) => ({ ...c })), cdep, 145 * 7919 + seed * 137);
      writeD(d);
      if (diagSolvable(145)) { ok = true; break; }
    }
    if (!ok) { log(`L145: ${path.basename(img)} không solvable`); continue; }
    const w = botWin(145);
    log(`L145: ${path.basename(img)} ✓ bot=${w}%`);
    break;
  }
}

// ---- cân band từng level ----
const PLAN = [
  { lvl: 131, cur: 5 }, { lvl: 132, cur: 5 }, { lvl: 133, cur: 0 }, { lvl: 134, cur: 0 }, { lvl: 135, cur: 7 },
  { lvl: 136, cur: 78 }, { lvl: 137, cur: 0 }, { lvl: 138, cur: 93 }, { lvl: 139, cur: 100 }, { lvl: 140, cur: 0 },
  { lvl: 141, cur: 0 }, { lvl: 142, cur: 0 }, { lvl: 143, cur: 92 }, { lvl: 144, cur: 13 },
];
for (const p of PLAN) {
  const { lvl } = p;
  let w = p.cur;
  if (w >= TARGET_LO && w <= TARGET_HI) { log(`L${lvl}: bot=${w}% — trong band, giữ`); continue; }
  const d = readD(); const L = d[lvl]; if (!L || !L.slam) { log(`L${lvl}: thiếu — bỏ`); continue; }
  const cdep = colorDepth(L);
  if (w < TARGET_LO) {
    // quá gắt → kéo dần xe nông lên đầu
    let done = false;
    for (const k of [2, 4, 6, 8]) {
      const bak = JSON.stringify(L.chests);
      L.chests = easier(L, cdep, k);
      writeD(d);
      if (!diagSolvable(lvl)) { L.chests = JSON.parse(bak); writeD(d); continue; }
      const w2 = botWin(lvl);
      log(`L${lvl}: easier k=${k} → bot=${w2}%`);
      if (w2 >= TARGET_LO) { done = true; if (w2 > TARGET_HI + 20) { L.chests = JSON.parse(bak); writeD(d); log(`L${lvl}: quá tay, lùi lại`); done = false; continue; } break; }
    }
    if (!done) log(`L${lvl}: vẫn gắt — giữ bản cuối (mai log người quyết)`);
  } else {
    // quá dễ → chôn thêm + re-order
    let done = false;
    for (const want of [110, 150]) {
      harder(L, want, lvl * 7 + want);
      const cars = reCar(L, lvl * 31 + want);
      const cdep2 = colorDepth(L);
      let ok = false;
      for (let seed = 1; seed <= 25; seed++) {
        L.chests = makeOrder(cars.map((c) => ({ ...c })), cdep2, lvl * 7919 + seed * 331 + want);
        writeD(d);
        if (diagSolvable(lvl)) { ok = true; break; }
      }
      if (!ok) { log(`L${lvl}: harder want=${want} không solvable — thử tiếp`); continue; }
      const w2 = botWin(lvl);
      log(`L${lvl}: harder chôn=${want} → bot=${w2}%`);
      if (w2 <= TARGET_HI) { done = true; break; }
    }
    if (!done) log(`L${lvl}: vẫn dễ — giữ bản cuối`);
  }
}
log("\n==== BOT CUỐI ====");
for (let k = 131; k <= 145; k++) { const d = readD(); if (d[k] && d[k].slam) log(`L${k}: bot=${botWin(k)}%`); }
log("✔ tune-band xong");
