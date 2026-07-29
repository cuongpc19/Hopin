// gen15.mjs — sinh 15 level slam L131-145, độ khó nhắm bot-MC thấp (10-40% người, mai calibrate
// bằng playtest log). Công thức rút từ playtest 2026-07-30:
//   • VÀNH NỀN navy (FILL_BG mặc định) — nhưng xe nền KHÔNG dồn ở đầu (bài học "6 xe đen đầu = ăn free")
//   • LAYER2 chôn màu DƯỚI ~40% ô nền (user: "chôn màu khác màu nền, 1 vài trường hợp chôn màu nền cũng ok")
//     → bóc nền mới lộ màu dưới → màu cần bị khoá thật sự
//   • Xe 20-30 slime; thứ tự LỆCH NHỊP: 2 navy mở màn, navy còn lại rải giữa, xe màu-sâu chen band 4-13
//     (thua rơi vào xe 6-15 theo luật user)
//   • Twin hợp lệ (ngang/dọc kề, không navy-12) qua --tunetwins
// Mỗi level: build-one → lọc ảnh (≥8 màu, fill ≥70%) → layer2 → chia xe → seed-search solvable → twin → đo bot.
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "src/levels/designed.json");
const LOG = path.join(ROOT, "scripts/_gen15-log.txt");
const log = (s) => { console.log(s); fs.appendFileSync(LOG, s + "\n"); };

const DIRS = [
  "../Pixel Flow/public/art/level art/3",
  "../Pixel Flow/public/art/level art/4",
  "../Pixel Flow/public/art/level art/hard",
];
const isImg = (f) => /\.(png|jpe?g)$/i.test(f);
const CANDIDATES = DIRS.flatMap((d) => { try { return fs.readdirSync(path.join(ROOT, d)).filter(isImg).map((f) => path.join(d, f)); } catch { return []; } });

const USED_IMAGES = new Set([ // đã dùng cho L110-115 — tránh trùng
  "Stitch.jpg", "Gemini_Generated_Image_icioj8icioj8icio.png", "Gemini_Generated_Image_vtwrydvtwrydvtwr.png",
  "Gemini_Generated_Image_nqbtw3nqbtw3nqbt.png", "Cute Mushroom Cartoon Drawing.jpg",
  "Chicken Giving A Thumbs Up, Chicken, Chicken Art, Cartoon PNG Transparent Image and Clipart for Free Download.jpg",
]);

const mkRng = (s) => { let x = (s >>> 0) || 1; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 0xffffffff; }; };
const readD = () => JSON.parse(fs.readFileSync(OUT, "utf8"));
const writeD = (d) => { const s = {}; for (const k of Object.keys(d).map(Number).sort((a, b) => a - b)) s[k] = d[k]; fs.writeFileSync(OUT, JSON.stringify(s, null, 2)); };
const sh = (cmd, env) => execSync(cmd, { cwd: ROOT, env: { ...process.env, ...(env || {}) }, stdio: ["ignore", "pipe", "pipe"] }).toString();

const isC = (v) => v >= 0 && v < 90;
function cellDepth(L) { // độ sâu bóc từng Ô (chỉ lớp trên)
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

// LAYER2: chôn màu dưới ~40% ô NỀN, ưu tiên ô lộ sớm (bất ngờ đến ở khúc đầu-giữa ván)
function addLayer2(L, seed) {
  const rng = mkRng(seed);
  const dep = cellDepth(L);
  const bg = []; L.board.forEach((v, i) => { if (v === 12) bg.push(i); });
  bg.sort((a, b) => dep[a] - dep[b]);
  const chosen = bg.slice(0, Math.round(bg.length * 0.4));
  const subj = [...new Set(L.board.filter((v) => isC(v) && v !== 12))];
  const lay = new Array(L.board.length).fill(-1);
  for (const i of chosen) lay[i] = rng() < 0.15 ? 12 : subj[Math.floor(rng() * subj.length)];
  L.layer2 = lay;
}

function reCar(L, seed) { // xe 20-30 slime, cap đủ cho CẢ 2 lớp
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

// thứ tự LỆCH NHỊP: 2 navy đầu → xe sâu chen band 3-10 → navy còn lại rải từ vị trí 6
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

fs.writeFileSync(LOG, "");
const LEVELS = []; for (let k = 131; k <= 145; k++) LEVELS.push(k);
let imgPtr = 0;
const usedNow = new Set();
const results = [];
for (const lvl of LEVELS) {
  let built = false;
  while (imgPtr < CANDIDATES.length && !built) {
    const img = CANDIDATES[imgPtr++];
    const bn = path.basename(img);
    if (USED_IMAGES.has(bn) || usedNow.has(bn)) continue;
    try { sh(`node scripts/build-one.mjs "${img}" -1 ${lvl} 12 25`); } catch { log(`L${lvl}: build lỗi ${bn}`); continue; }
    const d = readD(); const L = d[lvl]; if (!L) continue;
    const cols = new Set(L.board.filter((v) => isC(v))); const fill = L.board.filter(isC).length / L.board.length;
    if (cols.size < 8 || fill < 0.7) { log(`L${lvl}: bỏ ${bn} (màu ${cols.size}, fill ${(fill * 100) | 0}%)`); continue; }
    usedNow.add(bn);
    addLayer2(L, lvl * 613 + 7);
    const cdep = colorDepth(L);
    const cars = reCar(L, lvl * 31);
    L.slam = true; delete L.tray;
    let ok = false;
    for (let seed = 1; seed <= 30; seed++) {
      L.chests = makeOrder(cars.map((c) => ({ ...c })), cdep, lvl * 7919 + seed * 137);
      writeD(d);
      if (diagSolvable(lvl)) { ok = true; log(`L${lvl}: ${bn} — solvable seed ${seed} (${L.chests.length} xe, ${cols.size} màu, layer2 ${L.layer2.filter((v) => v >= 0).length} ô chôn)`); break; }
    }
    if (!ok) { log(`L${lvl}: ${bn} KHÔNG solvable sau 30 seed — thử ảnh khác`); usedNow.delete(bn); continue; }
    try { const t = sh(`node scripts/build-levels.mjs --tunetwins`, { ONLY: String(lvl) }); const m = t.match(new RegExp("^L" + lvl + ".*$", "m")); if (m) log("   twin: " + m[0].trim()); } catch { log("   twin: lỗi (bỏ qua)"); }
    const w = botWin(lvl);
    log(`   bot-MC(0.9) = ${w}%`);
    results.push({ lvl, img: bn, bot: w });
    built = true;
  }
  if (!built) log(`L${lvl}: HẾT ảnh phù hợp!`);
}
log("\n==== TỔNG KẾT ====");
for (const r of results) log(`L${r.lvl}  bot=${String(r.bot).padStart(3)}%  ${r.img}`);
log("✔ gen15 xong");
