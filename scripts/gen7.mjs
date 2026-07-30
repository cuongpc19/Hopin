// gen7.mjs — 7 level mới theo yêu cầu user 2026-07-30:
//   • L146-147: TWIN-HEAVY — 25×25, KHÔNG layer2, độ khó CHỦ YẾU từ xe đôi, target ~25%
//     (tiêu chí: baseline không-twin phải DỄ (bot ≥55%), gắn twin xong rơi về band 15-35%
//      → chứng minh twin là nguồn khó, không phải thứ khác)
//   • L148-152: MIXED — xe "?" + một ít layer2 (cụm nhỏ) + chôn xe (xe sâu chen sớm) + xe đôi,
//     target 20-40% (bot không mô phỏng "?" nên nhắm bot 20-45, "?" kéo người xuống thêm)
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "src/levels/designed.json");
const LOG = path.join(ROOT, "scripts/_gen7-log.txt");
const log = (s) => { console.log(s); fs.appendFileSync(LOG, s + "\n"); };
const mkRng = (s) => { let x = (s >>> 0) || 1; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 0xffffffff; }; };
const readD = () => JSON.parse(fs.readFileSync(OUT, "utf8"));
const writeD = (d) => { const s = {}; for (const k of Object.keys(d).map(Number).sort((a, b) => a - b)) s[k] = d[k]; fs.writeFileSync(OUT, JSON.stringify(s, null, 2)); };
const sh = (cmd, env) => execSync(cmd, { cwd: ROOT, env: { ...process.env, ...(env || {}) }, stdio: ["ignore", "pipe", "pipe"] }).toString();
const isC = (v) => v >= 0 && v < 90;

const DIRS = ["../Pixel Flow/public/art/level art/3", "../Pixel Flow/public/art/level art/4", "../Pixel Flow/public/art/level art/hard", "public/art/level art/1"];
const USED = new Set(["Stitch.jpg", "Gemini_Generated_Image_icioj8icioj8icio.png", "Gemini_Generated_Image_vtwrydvtwrydvtwr.png", "Gemini_Generated_Image_nqbtw3nqbtw3nqbt.png", "Cute Mushroom Cartoon Drawing.jpg", "Chicken Giving A Thumbs Up, Chicken, Chicken Art, Cartoon PNG Transparent Image and Clipart for Free Download.jpg", "Gemini_Generated_Image_77bcma77bcma77bc.png", "Gemini_Generated_Image_84v02m84v02m84v0.png", "Gemini_Generated_Image_99l57899l57899l5.png", "Gemini_Generated_Image_b0vnenb0vnenb0vn.png", "Gemini_Generated_Image_gakl8ngakl8ngakl.png", "Gemini_Generated_Image_77bcma77bcma77bc (1).png", "Gemini_Generated_Image_udanp6udanp6udan.png", "Adesivo De Um Foguete Espacial De Desenho Animado PNG , Clipart De Foguete, Clipart Espacial, Clipart De Adesivo PNG Imagem para download gratuito.jpg", "Adorable Penguin on Beige Background.jpg", "Cute bee on white background _ Premium AI-generated vector.jpg", "Free Cartoon Clipart.jpg", "Jungle Thema.jpg", "Kawaii Chibi Panda – Cute & Cozy.jpg", "Vector Free Snail Clipart Gary - Gary From Spongebob-free Download PNG Transparent With Clear Background ID 170599 _ TopPNG.jpg", "7_bear.png", "Gemini_Generated_Image_6777xb6777xb6777.png"]);
const isImg = (f) => /\.(png|jpe?g)$/i.test(f);
const CANDS = DIRS.flatMap((d) => { try { return fs.readdirSync(path.join(ROOT, d)).filter(isImg).filter((f) => !USED.has(f)).map((f) => path.join(d, f)); } catch { return []; } });

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
// xe "?": đặt buried lên xe KHÔNG-pairId từ hàng 3 trở đi (2 hàng đầu lộ để học level)
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
// build ảnh vào level (vành nền mặc định), lọc ≥8 màu / fill ≥70%
let imgPtr = 0;
function buildImage(lvl) {
  while (imgPtr < CANDS.length) {
    const img = CANDS[imgPtr++]; const bn = path.basename(img);
    try { sh(`node scripts/build-one.mjs "${img}" -1 ${lvl} 12 25`); } catch { continue; }
    const d = readD(); const L = d[lvl]; if (!L) continue;
    const cols = new Set(L.board.filter((v) => isC(v))); const fill = L.board.filter(isC).length / L.board.length;
    if (cols.size < 8 || fill < 0.7) { log(`L${lvl}: bỏ ${bn} (màu ${cols.size}, fill ${(fill * 100) | 0}%)`); continue; }
    log(`L${lvl}: ảnh ${bn} (${cols.size} màu)`);
    return true;
  }
  return false;
}

fs.writeFileSync(LOG, "");

// ---- L146-147: TWIN-HEAVY ----
for (const lvl of [146, 147]) {
  if (!buildImage(lvl)) { log(`L${lvl}: hết ảnh!`); continue; }
  const d = readD(); const L = d[lvl];
  L.slam = true; delete L.tray; L.layer2 = null; delete L.layer2;
  const cdep = colorDepth(L);
  const cars = reCar(L, lvl * 31);
  let done = false;
  for (let attempt = 0; attempt < 4 && !done; attempt++) {
    const navyHead = 3 + (attempt % 2); // baseline phải DỄ: nhiều navy mở màn, không xe sâu
    let ok = false;
    for (let seed = 1; seed <= 25; seed++) {
      L.chests = makeOrder(cars.map((c) => ({ ...c })), cdep, lvl * 7919 + seed * 137 + attempt * 29, navyHead, 0);
      writeD(d);
      if (diagSolvable(lvl)) { ok = true; break; }
    }
    if (!ok) continue;
    const base = botWin(lvl);
    if (base < 55) { log(`L${lvl}: attempt ${attempt} baseline ${base}% chưa đủ dễ — thử lại`); continue; }
    // gắn twin bằng meter (tối đa 6 cặp) rồi đo lại
    try { const t = sh(`node scripts/build-levels.mjs --tunetwins`, { ONLY: String(lvl) }); const m = t.match(new RegExp("^L" + lvl + ".*$", "m")); if (m) log("   " + m[0].trim()); } catch { /* */ }
    const fin = botWin(lvl);
    log(`L${lvl}: attempt ${attempt} — baseline ${base}% → sau twin ${fin}%`);
    if (fin >= 12 && fin <= 40 && base - fin >= 20) { log(`L${lvl}: ✓ TWIN-HEAVY đạt (khó chủ yếu từ xe đôi)`); done = true; }
  }
  if (!done) log(`L${lvl}: chưa đạt tiêu chí twin-heavy — giữ bản cuối (xem tay sau)`);
}

// ---- L148-152: MIXED (? + layer2 nhỏ + chôn xe + twin) ----
for (const lvl of [148, 149, 150, 151, 152]) {
  if (!buildImage(lvl)) { log(`L${lvl}: hết ảnh!`); continue; }
  const d = readD(); const L = d[lvl];
  L.slam = true; delete L.tray;
  let done = false;
  for (let attempt = 0; attempt < 4 && !done; attempt++) {
    const frac = 0.15 + attempt * 0.04;         // layer2 nhỏ: ~25-45 ô
    const navyHead = 3;
    const deepN = 2;                             // chôn xe: 2 xe màu-sâu chen sớm
    addLayer2Clustered(L, lvl * 613 + attempt * 71 + 7, frac);
    const cdep = colorDepth(L);
    const cars = reCar(L, lvl * 31 + attempt);
    let ok = false;
    for (let seed = 1; seed <= 25; seed++) {
      L.chests = makeOrder(cars.map((c) => ({ ...c })), cdep, lvl * 7919 + seed * 137 + attempt * 17, navyHead, deepN);
      writeD(d);
      if (diagSolvable(lvl)) { ok = true; break; }
    }
    if (!ok) { log(`L${lvl}: attempt ${attempt} không solvable`); continue; }
    try { const t = sh(`node scripts/build-levels.mjs --tunetwins`, { ONLY: String(lvl) }); const m = t.match(new RegExp("^L" + lvl + ".*$", "m")); if (m) log("   " + m[0].trim()); } catch { /* */ }
    const w = botWin(lvl);
    log(`L${lvl}: attempt ${attempt} (chôn≈${L.layer2 ? L.layer2.filter((v) => v >= 0).length : 0} ô) → bot ${w}%`);
    if (w >= 20 && w <= 45) {
      const d2 = readD(); const L2 = d2[lvl];
      const nb = addBuried(L2, 0.33, lvl * 131 + 7);
      writeD(d2);
      log(`L${lvl}: ✓ MIXED đạt — bot ${w}% + ${nb} xe "?" (bot không tính "?" → người sẽ thấp hơn chút)`);
      done = true;
    }
  }
  if (!done) {
    // vẫn gắn "?" cho bản cuối để đủ thành phần
    const d2 = readD(); const L2 = d2[lvl];
    if (L2 && L2.slam) { const nb = addBuried(L2, 0.33, lvl * 131 + 7); writeD(d2); log(`L${lvl}: ngoài band — vẫn gắn ${nb} xe "?" (xem tay sau)`); }
  }
}

log("\n==== TỔNG KẾT GEN7 ====");
const d = readD();
for (let k = 146; k <= 152; k++) {
  const L = d[k]; if (!L || !L.slam) { log(`L${k}: THIẾU`); continue; }
  const tw = new Set(L.chests.filter((c) => c.pairId != null).map((c) => c.pairId)).size;
  const bu = L.chests.filter((c) => c.buried).length;
  const l2 = L.layer2 ? L.layer2.filter((v) => v >= 0).length : 0;
  log(`L${k}: ${L.chests.length} xe | ${tw} twin | ${bu} xe"?" | ${l2} ô chôn`);
}
log("✔ gen7 xong");
