// gen2-46 — DỰNG LẠI CƠ CHẾ cho L2-46 theo spec user 2026-08-05.
//
// Board (tranh) giữ nguyên bố cục của commit 471566a; ở đây chỉ GỘP ĐỐM LẺ, dựng lại XE và
// đặt CƠ CHẾ. Spec:
//   • winrate: L5/L10 = 85% · L2-9 còn lại > 95% (khó tăng dần ở 5 level đầu) · L15 = 70% ·
//     level chia hết cho 5 từ L20 = 40% · còn lại 70-95% dốc dần, dễ ở đoạn đầu.
//   • GIẢM SỐ XE: bộ ảnh mới sinh ~10 ô/xe → 125-143 xe/level. Ở đây nhắm ~28 xe/level.
//   • layer2 CHỈ ở level chia hết cho 5 (hard/super-hard) và vừa phải.
//   • Độ khó dồn vào xe HÀNG 3-5; hàng 1-2 (người chơi nhìn thấy) và hàng 6+ để dễ.
//   • Xe đôi / xe úp giữ như cũ. Slime "?" (level.hidden) BỎ.
//
// ĐÒN BẨY ĐỘ KHÓ — đo ngày 2026-08-05, khác hẳn dự đoán ban đầu:
//   • Cỡ xe gần như KHÔNG ảnh hưởng. L20 dễ ở mọi cỡ (94%), L2 khó ở mọi cỡ. Nên có thể lấy
//     xe TO thoải mái để giảm số xe mà không đổi độ khó.
//   • Thứ tự xe phải theo ĐỘ SÂU NHỎ NHẤT của màu (lúc màu bắt đầu lộ), không phải trung
//     bình: L15 ở 10 màu là 73% thay vì 42%, L2 là 18% thay vì 2%.
//   • Thang chính là ĐỐM LẺ. Ảnh 10 màu để lại nhiều mảng 1-3 ô; mỗi màu rải rác sinh một xe
//     kén ăn, mà xe chỉ rời khi ĐẦY nên nó khoá bay và làm tắc bàn. Gộp hết đốm → L2 từ 17%
//     lên 94%. Gộp một PHẦN (frac) là thang mịn ở giữa.
//
// Thước: (B+D)/2 đã hiệu chuẩn (scripts/calib.mjs) — trần của nó là 94%, nên target ≥95%
// nghĩa là "dễ hết mức", không phải đo được 99%.
//
//   node scripts/gen2-46.mjs            · ONLY=5,10 … · DRY=1 … · STEPS=5 …
import { readD, writeD, isC, cellDepth, colorDepth, mkRng, addLayer2Clusters } from "./genlib.mjs";
import { gradeBatch } from "./calib.mjs";
import { despeckle } from "./despeckle.mjs";

const LANES = 4;
const CARS_WANT = Number(process.env.CARS_WANT || 28);
const MIN_BLOB = Number(process.env.MIN_BLOB || 6);
const N_B = Number(process.env.N_B || 100);
const STEPS = Number(process.env.STEPS || 5);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",").map(Number)) : null;
const DRY = process.env.DRY === "1";

export function target(n) {
  if (n === 5 || n === 10) return 85;
  if (n >= 2 && n <= 9) return { 2: 99, 3: 98, 4: 97, 6: 97, 7: 97, 8: 96, 9: 96 }[n];
  if (n === 15) return 70;
  if (n % 5 === 0) return 40;
  return Math.round(95 - ((n - 11) * 25) / 35);
}
const canTwins = (n) => n >= 8;
const canBuried = (n) => n >= 15;
const canLayer2 = (n) => n >= 15 && n % 5 === 0;

// ---- thang độ khó ------------------------------------------------------------------------
// Độ khó phải đến từ XE HÀNG 3-5 (spec), KHÔNG phải từ nhiễu bàn — nhiễu vừa trái spec vừa
// làm tranh xấu. Nên thang xếp theo BÀN SẠCH TRƯỚC: mỗi mức gộp-đốm chạy hết thang `deep`,
// và bộ chọn ưu tiên nấc có chỉ số NHỎ hơn khi hoà, tức bàn sạch hơn.
//   deep = số xe màu-sâu bị đẩy lên hàng 3-5 (chúng chưa ăn được → đỗ lì → khoá bay)
const DEEP_STEPS = [
  {},
  { deep: 1 },
  { deep: 2, twins: 1, buried: 2 },
  { deep: 3, twins: 2, buried: 3, lay: 40 },
  { deep: 4, twins: 3, buried: 4, lay: 80 },
  // Vài board nhỏ (vd L43) dễ ở CẢ 33 nấc đầu — thang phải với xuống thấp hơn. Đẩy 6-9 xe
  // màu-sâu lên hàng 3-5 là đủ khó: chúng đỗ lì, khoá bay, người chơi phải gỡ bằng hàng 1-2.
  { deep: 5, twins: 3, buried: 4, lay: 80 },
  { deep: 6, twins: 3, buried: 4, lay: 80 },
  { deep: 8, twins: 3, buried: 4, lay: 100 },
];
// FRACS/DEEPS: thang mịn hơn cho vài level cứng đầu, vd FRACS=1,0.85,0.7,0.5,0.35,0.2,0
const FRACS = (process.env.FRACS || "1,0.7,0.35,0").split(",").map(Number);
const DEEPS = process.env.DEEPS ? process.env.DEEPS.split(",").map(Number) : null;
// SEEDS: cùng thiết kế, khác cách sắp — chiều cuối cùng cho những board không có nấc nào
// rơi đúng target (vd L43 nhảy 89→94→52% theo `deep`, không có 72%).
const SEEDS = (process.env.SEEDS || "0").split(",").map(Number);
const RUNGS = [];
for (const seed of SEEDS) for (const frac of FRACS) for (const s of (DEEPS ? DEEPS.map((i) => DEEP_STEPS[i]) : DEEP_STEPS)) RUNGS.push({ frac, seed, ...s });

// ---- xe: chia mỗi màu thành các xe ~cap ô ------------------------------------------------
// Bất biến: tổng sức chứa = tổng ô (kể cả lớp 2). Xe chỉ rời khi ĐẦY nên lệch một ô là level
// không thắng được — chia đúng theo số ô từng màu, không làm tròn.
function makeCars(L, cap) {
  const cnt = {};
  for (const v of L.board) if (isC(v)) cnt[v] = (cnt[v] || 0) + 1;
  if (L.layer2) for (const v of L.layer2) if (v >= 0) cnt[v] = (cnt[v] || 0) + 1;
  const cars = [];
  for (const [c, total] of Object.entries(cnt)) {
    const col = +c;
    const k = Math.max(1, Math.round(total / cap));
    const base = Math.floor(total / k);
    let rem = total - base * k;
    for (let i = 0; i < k; i++) { const e = rem > 0 ? 1 : 0; rem -= e; cars.push({ color: col, count: base + e }); }
  }
  return cars;
}
// độ sâu NHỎ NHẤT của mỗi màu = lúc nó bắt đầu ăn được (thứ tự xe hiền nhất)
function minDepth(L) {
  const dep = cellDepth(L); const mn = {};
  L.board.forEach((v, i) => { if (isC(v) && dep[i] >= 0) mn[v] = Math.min(mn[v] ?? 1e9, dep[i]); });
  if (L.layer2) L.layer2.forEach((v, i) => { if (v >= 0) mn[v] = Math.min(mn[v] ?? 1e9, (dep[i] >= 0 ? dep[i] : 0) + 1); });
  return mn;
}
// đẩy `nDeep` xe SÂU NHẤT lên hàng 3-5 — độ khó nằm đúng chỗ user muốn, hàng 1-2 vẫn dễ
function applyDeep(order, nDeep) {
  if (!nDeep) return order;
  const out = order.slice();
  const lo = 2 * LANES;
  if (out.length <= lo + 2) return out;
  const deep = [];
  for (let i = 0; i < nDeep && out.length > lo + 2; i++) deep.push(out.pop());
  const hi = Math.min(5 * LANES, out.length);
  const step = Math.max(1, Math.floor((hi - lo) / (deep.length + 1)));
  deep.forEach((c, i) => out.splice(Math.min(lo + step * (i + 1), out.length), 0, c));
  return out;
}
function twinsInCrunch(L, nPairs, cdep, seed) {
  for (const c of L.chests) delete c.pairId;
  if (!nPairs) return 0;
  const rng = mkRng(seed);
  const lo = 2 * LANES, hi = Math.min(5 * LANES, L.chests.length);
  const cand = [];
  for (let i = lo; i < hi - 1; i++) {
    if (i % LANES === LANES - 1) continue;
    const a = L.chests[i], b = L.chests[i + 1];
    if (a.color === b.color) continue;
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
function buriedInCrunch(L, want, seed) {
  for (const c of L.chests) delete c.buried;
  if (!want) return 0;
  const lo = 2 * LANES, hi = Math.min(5 * LANES, L.chests.length);
  const cand = [];
  for (let i = lo; i < hi; i++) if (L.chests[i].pairId == null) cand.push(i);
  let s = seed >>> 0 || 1;
  for (let i = cand.length - 1; i > 0; i--) { s = (s * 1664525 + 1013904223) >>> 0; const j = s % (i + 1); [cand[i], cand[j]] = [cand[j], cand[i]]; }
  const n = Math.min(want, cand.length);
  for (let m = 0; m < n; m++) L.chests[cand[m]].buried = true;
  return n;
}

export function build(src, n, rung) {
  const L = JSON.parse(JSON.stringify(src));
  L.slam = true;
  L.lanes = LANES;
  delete L.hidden;      // slime "?" — user bỏ (2026-08-05)
  delete L.layer2;

  despeckle(L, MIN_BLOB, rung.frac);

  const cnt = {};
  for (const v of L.board) if (isC(v)) cnt[v] = (cnt[v] || 0) + 1;
  const bg = Number(Object.keys(cnt).sort((a, z) => cnt[z] - cnt[a])[0] ?? 12);
  const seed = n * 977 + 13 + (rung.seed || 0) * 7919;

  if (canLayer2(n) && rung.lay) addLayer2Clusters(L, seed, rung.lay, { bgColor: bg, maxClusters: 4 });

  const cells = L.board.filter(isC).length + (L.layer2 ? L.layer2.filter((v) => v >= 0).length : 0);
  const md = minDepth(L);
  const rng = mkRng(seed);
  const cars = makeCars(L, Math.max(6, Math.round(cells / CARS_WANT)))
    .sort((a, b) => ((md[a.color] ?? 99) + rng() * 0.4) - ((md[b.color] ?? 99) + rng() * 0.4));
  L.chests = applyDeep(cars, rung.deep || 0);

  const cdep = colorDepth(L);
  if (canTwins(n) && rung.twins) twinsInCrunch(L, rung.twins, cdep, seed);
  if (canBuried(n) && rung.buried) buriedInCrunch(L, rung.buried, seed);
  return L;
}

// ---- QUÉT TOÀN THANG, không tìm nhị phân -------------------------------------------------
// Đo 2026-08-05: thang gộp-đốm KHÔNG đơn điệu (L2 đi 64→49→74→45→94% khi frac tăng). Gộp đốm
// nào trước làm đổi tính-với-tới-được của bàn theo kiểu nhảy cóc, chứ không phải nhiễu đo.
// Nên quét hết 16 nấc rồi chọn nấc gần target nhất; chia SHARD để chạy song song nhiều nhân.
//   SHARD=0 NSHARD=8 node scripts/gen2-46.mjs --scan > out-0.json
//   node scripts/gen2-46.mjs --pick out-0.json out-1.json …
import fs from "node:fs";
const d = readD();
const nums = [];
for (let n = 2; n <= 46; n++) if (d[n] && (!ONLY || ONLY.has(n))) nums.push(n);

if (process.argv.includes("--scan")) {
  const SHARD = Number(process.env.SHARD || 0), NSHARD = Number(process.env.NSHARD || 1);
  const mine = nums.filter((_, i) => i % NSHARD === SHARD);
  const jobs = [];
  for (const n of mine) RUNGS.forEach((r, ri) => jobs.push({ n, ri, L: build(d[n], n, r) }));
  console.error(`shard ${SHARD}: ${mine.length} level x ${RUNGS.length} nac = ${jobs.length} phep do`);
  const g = gradeBatch(jobs.map((j) => j.L), { n: N_B, tag: "s" + SHARD });
  console.log(JSON.stringify(jobs.map((j, i) => ({ n: j.n, ri: j.ri, ...g[i] }))));
  process.exit(0);
}

if (process.argv.includes("--pick")) {
  const files = process.argv.slice(process.argv.indexOf("--pick") + 1);
  const rows = files.flatMap((f) => JSON.parse(fs.readFileSync(f, "utf8")));
  const byLv = {};
  for (const r of rows) (byLv[r.n] = byLv[r.n] || []).push(r);
  // Chọn nấc: trong số các nấc CÁCH TARGET ≤ TOL, lấy nấc có chỉ số NHỎ NHẤT — tức bàn sạch
  // nhất, vì thang xếp theo frac giảm dần. Như vậy độ khó đến từ xe hàng 3-5 (đúng spec) chứ
  // không phải từ nhiễu bàn. Không nấc nào trong TOL thì đành lấy nấc gần target nhất.
  // (target ≥95% thì thước bão hoà ở 94%, nên "gần" tính theo khoảng cách tới 94.)
  const TOL = Number(process.env.TOL || 5);
  const dist = (w, t) => (t >= 95 ? Math.max(0, 94 - w) : Math.abs(w - t));
  const chosen = {};
  for (const n of Object.keys(byLv).map(Number)) {
    const t = target(n);
    const all = byLv[n];
    const near = all.filter((c) => dist(c.win, t) <= TOL);
    chosen[n] = near.length
      ? near.slice().sort((a, b) => a.ri - b.ri)[0]
      : all.slice().sort((a, b) => dist(a.win, t) - dist(b.win, t) || a.ri - b.ri)[0];
  }
  // đo lại nấc đã chọn ở N cao hơn — nấc thắng có thể chỉ là một lần đo may
  const lvs = Object.keys(chosen).map(Number).sort((a, b) => a - b);
  const Ls = lvs.map((n) => build(d[n], n, RUNGS[chosen[n].ri]));
  console.error(`nghiem thu lai ${Ls.length} level o N=200…`);
  const g = gradeBatch(Ls, { n: 200, trials: 120, tag: "v" });

  console.log(`\nDung lai L2-46 — thuoc (B+D)/2 da hieu chuan (tran 94%), ~${CARS_WANT} xe/level\n`);
  console.log('lv  | target | win  | rung | o    | lop2 | xe | doi | up | mau');
  const out = {};
  lvs.forEach((n, i) => {
    const L = Ls[i], b = g[i];
    const cells = L.board.filter(isC).length + (L.layer2 ? L.layer2.filter((v) => v >= 0).length : 0);
    const lay = L.layer2 ? L.layer2.filter((v) => v >= 0).length : 0;
    const tw = new Set(L.chests.filter((c) => c.pairId != null).map((c) => c.pairId)).size;
    const bu = L.chests.filter((c) => c.buried).length;
    const nc = new Set(L.board.filter(isC)).size;
    const t = target(n);
    const off = t >= 95 ? Math.max(0, 94 - b.win) : Math.abs(b.win - t);
    console.log(
      `L${String(n).padEnd(3)}|  ${String(t).padStart(3)}%  | ${String(b.win).padStart(3)}% |  ${String(chosen[n].ri).padStart(2)}  |` +
      ` ${String(cells).padStart(4)} | ${String(lay).padStart(4)} | ${String(L.chests.length).padStart(2)} | ${String(tw).padStart(3)} | ${String(bu).padStart(2)} | ${String(nc).padStart(3)}` +
      (off > 8 ? '  <-- lech' : '')
    );
    out[n] = L;
  });
  if (!DRY) { for (const n of lvs) d[n] = out[n]; writeD(d); console.log("\nda ghi vao src/levels/designed.json"); }
  else console.log("\nDRY=1 — khong ghi");
  process.exit(0);
}

console.log("dung: --scan (voi SHARD/NSHARD) roi --pick file1.json file2.json …");
process.exit(1);
