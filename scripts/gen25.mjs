// gen25.mjs — build 25 LEVEL ĐẦU GAME (slam mode) theo TARGET CSV CŨ (winratedesign1.csv).
//   • L1/L2: COPY y nguyên từ repo chính (bản tweak mới nhất) + slam:true.
//   • L3-25: build lại từ ẢNH CŨ của đúng slot (sliced/) qua gate mới (viền chữ nhật ≤30%,
//     ≥4 màu, phủ ≥30%); hỏng → ảnh dự phòng cùng kho.
//   • Gate tính năng theo CSV: twins theo cột xedoi; chôn xe "?" L5/L10 + L15+; 2-lớp L15+
//     (target thấp); slime "?" ẩn L21+; ĐÁ CỨNG L23-25 (walls T/TL/T).
//   • Thước đo: trip-sim (genlib.measure). Chấp nhận |đo - target| ≤ 7 (target 100 → ≥93).
// Chạy: node scripts/gen25.mjs            (toàn bộ)
//       ONLY=4,15 node scripts/gen25.mjs  (thử từng level)
import fs from "fs";
import path from "path";
import {
  ROOT, isC, mkRng, readD, writeD, measure, cellDepth, colorDepth, reCar, makeOrder,
  addLayer2Clustered, addLayer2Subject, addBuried, placeWalls, makeHidden,
  addGentleTwins, tuneTwinsCli, buildBoard, canonName,
} from "./genlib.mjs";

const LOG = path.join(ROOT, "scripts/_gen25-log.txt");
const log = (s) => { console.log(s); fs.appendFileSync(LOG, s + "\n"); };
const ART = "../Pixel Flow/public/art/level art/sliced";
const MAIN_DESIGNED = "../Pixel Flow/src/levels/designed.json";

// ---- bảng design từ CSV (winratedesign1.csv hàng 1-25) ----------------------
const DESIGN = [
  { lvl: 3, target: 81, size: 25, K: 6, minxe: 10, maxxe: 80, twins: 0, img: "2_owl_animals2.png" },
  { lvl: 4, target: 95, size: 25, K: 8, minxe: 10, maxxe: 80, twins: 2, img: "5_artist_heroes.png" },
  { lvl: 5, target: 70, size: 31, K: 12, minxe: 12, maxxe: 40, twins: 0, lanes: 3, buried: 0.25, img: "11_rocket_toys.png" },
  { lvl: 6, target: 98, size: 25, K: 11, minxe: 12, maxxe: 80, twins: 0, img: "10_parrot_animals.png" },
  { lvl: 7, target: 90, size: 25, K: 6, minxe: 12, maxxe: 80, twins: 0, img: "2_pinetree_flashcard.png" },
  { lvl: 8, target: 90, size: 25, K: 5, minxe: 7, maxxe: 80, twins: 1, twinFront: true, img: "2_star_flashcard.png" },
  { lvl: 9, target: 90, size: 25, K: 11, minxe: 12, maxxe: 80, twins: 1, img: "11_parakeet_animals.png" },
  // target 65→72 (playtest 2026-07-31: user thua 5/5 — CSV 65 quá gắt cho L10 đầu game;
  // đo trip-sim 72 ≈ cảm giác ~65 thật). Ảnh cũ candycane dồn 5 xe cùng màu đỏ → swing lớn.
  { lvl: 10, target: 72, size: 25, K: 10, minxe: 16, maxxe: 16, twins: 4, buried: 0.3, img: "11_robot_heroes.png" },
  { lvl: 11, target: 100, size: 31, K: 6, minxe: 16, maxxe: 80, twins: 0, img: "3_cactus_objects.png" },
  { lvl: 12, target: 85, size: 31, K: 5, minxe: 16, maxxe: 80, twins: 1, img: "11_turtle_sea.png" },
  { lvl: 13, target: 95, size: 31, K: 11, minxe: 16, maxxe: 80, twins: 0, img: "7_dino_animals1.png" },
  { lvl: 14, target: 85, size: 31, K: 12, minxe: 16, maxxe: 80, twins: 1, img: "7_doll_toys.png" },
  { lvl: 15, target: 50, size: 25, K: 12, minxe: 20, maxxe: 80, twins: 3, buried: 0.33, layer2: 0.3, img: "7_mushroom_heroes.png" },
  { lvl: 16, target: 100, size: 31, K: 6, minxe: 16, maxxe: 80, twins: 1, img: "3_dino_animals2.png" },
  { lvl: 17, target: 93, size: 31, K: 5, minxe: 16, maxxe: 80, twins: 0, buried: 0.15, img: "3_dolphin_flashcard.png" },
  { lvl: 18, target: 90, size: 31, K: 8, minxe: 11, maxxe: 80, twins: 1, buried: 0.15, img: "7_cat_animals1.png" },
  { lvl: 19, target: 80, size: 31, K: 12, minxe: 11, maxxe: 80, twins: 0, buried: 0.2, img: "7_owl_animals1.png" },
  // target 65→45 (user 2026-07-31): mốc khó giữa-game gắt hơn.
  { lvl: 20, target: 45, size: 31, K: 9, minxe: 20, maxxe: 80, twins: 2, layer2: 0.3, buried: 0.25, img: "8_rainbow_flashcard.png" },
  { lvl: 21, target: 100, size: 31, K: 6, minxe: 16, maxxe: 80, twins: 0, hidden: 0.1, buried: 0.15, img: "3_lamp_objects.png" },
  { lvl: 22, target: 85, size: 31, K: 10, minxe: 11, maxxe: 80, twins: 1, hidden: 0.1, buried: 0.2, img: "7_rainbow_animals2.png" },
  // target 90→95 (user 2026-08-01): level GIỚI THIỆU đá cứng nên hiền — bỏ xe "?" (người
  // thật phóng hớ, sim không đo được), giảm ô ẩn, giữ tường T + 2 twin nhẹ.
  { lvl: 23, target: 95, size: 30, K: 7, minxe: 16, maxxe: 80, twins: 2, walls: "T", hidden: 0.06, img: "5_bus_heroes.png" },
  // walls TL (CSV) bất khả thi trong SLAM: 2 cạnh chặn → mọi cấu hình ≈0% (đo 2026-07-31).
  // Hạ còn 1 tường T như L23 (vẫn giữ đá cứng), target 90 giữ nguyên — LỆCH CSV có chủ đích.
  // K hạ 10→7 (CSV là TRẦN màu): tường + nhiều màu ép trần winrate ~64-71 < target 90.
  { lvl: 24, target: 90, size: 26, K: 7, minxe: 16, maxxe: 80, twins: 2, walls: "T", hidden: 0.1, buried: 0.2, img: "7_robot_animals1.png" },
  // target 60→35 (user 2026-07-31): boss cuối pack. Trả lại layer2 (0.25 từng đo ~36%).
  { lvl: 25, target: 35, size: 30, K: 10, minxe: 15, maxxe: 80, twins: 0, walls: "T", layer2: 0.25, hidden: 0.12, buried: 0.25, img: "11_fruitbasket_food.png" },
];

// ---- kho ảnh: tìm file theo tên trong sliced/** — dự phòng: cùng thư mục, chưa dùng ----
function listSliced() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(png|jpg)$/i.test(e.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, ART));
  return out;
}
const ALL_IMGS = listSliced();
// Sổ cái theo KHOÁ CHUẨN (canonName — gộp 2 bản cùng artwork khác tên).
const usedKeys = new Set();
// Ảnh đã có chủ: (a) SKIP_IMGS env, (b) mọi field `img` trong designed.json (gen25/rebuild-band
// ghi khi chốt level) — TRỪ ảnh của chính các level đang rerun (ONLY=…, nó được dùng lại ảnh
// của nó; BAN_SELF=1 để ép cả level rerun phải ĐỔI ảnh), (c) chủ thể L1/L2 (penguin/elephant).
const onlySet = process.env.ONLY ? new Set(process.env.ONLY.split(",").map(Number)) : null;
{
  const banSelf = process.env.BAN_SELF === "1";
  if (process.env.SKIP_IMGS) for (const s of process.env.SKIP_IMGS.split(",")) usedKeys.add(canonName(s.trim()));
  usedKeys.add(canonName("3_penguin_animals1.png")); usedKeys.add(canonName("2_elephant_animals2.png"));
  try {
    const d0 = readD();
    for (const k of Object.keys(d0)) if (d0[k] && d0[k].img && (banSelf || !(onlySet && onlySet.has(+k)))) usedKeys.add(canonName(d0[k].img));
  } catch { /* designed chưa có */ }
}
function imgCandidates(name) {
  // primary CŨNG phải qua lọc — mỗi ARTWORK chỉ 1 level (khoá chuẩn, kể cả ảnh "chính chủ").
  const free = (p) => !usedKeys.has(canonName(p));
  const primary = ALL_IMGS.filter((p) => path.basename(p) === name && free(p));
  const dir = primary.length ? path.dirname(primary[0]) : null;
  const sameDir = dir ? ALL_IMGS.filter((p) => path.dirname(p) === dir && free(p)) : [];
  const rest = ALL_IMGS.filter(free);
  return [...new Set([...primary, ...sameDir, ...rest])];
}

// ---- thang cấu hình thứ tự xe theo target -----------------------------------
// WIDE=1 (pass đánh bóng): thêm cấu hình "tight" (ÍT xe hơn, sát sàn CSV — xe to vét trọn màu
// → DỄ hơn) và deepN cao hơn (KHÓ hơn) cho level lệch target.
const WIDE = process.env.WIDE === "1";
function ladder(target) {
  if (target >= 93) return [{ gentle: true }, { bgHead: 1, deepN: 0 }, { bgHead: 2, deepN: 1 },
    ...(WIDE ? [{ gentle: true, tight: true }, { bgHead: 1, deepN: 0, tight: true }, { bgHead: 2, deepN: 0, tight: true }] : [])];
  if (target >= 80) return [{ bgHead: 2, deepN: 0 }, { gentle: true }, { bgHead: 2, deepN: 1 }, { bgHead: 3, deepN: 2 },
    ...(WIDE ? [{ bgHead: 3, deepN: 3 }, { bgHead: 4, deepN: 3 }, { gentle: true, tight: true }, { bgHead: 2, deepN: 1, tight: true }] : [])];
  if (target >= 65) return [{ bgHead: 2, deepN: 1 }, { bgHead: 2, deepN: 2 }, { bgHead: 3, deepN: 3 }, { bgHead: 2, deepN: 0 },
    ...(WIDE ? [{ bgHead: 4, deepN: 4 }, { gentle: true }, { gentle: true, tight: true }, { bgHead: 2, deepN: 1, tight: true }] : [])];
  return [{ bgHead: 3, deepN: 2 }, { bgHead: 3, deepN: 3 }, { bgHead: 4, deepN: 4 }, { bgHead: 2, deepN: 2 },
    ...(WIDE ? [{ bgHead: 5, deepN: 5 }, { bgHead: 3, deepN: 2, tight: true }] : [])];
}
const SEEDS = +(process.env.SEEDS || 8);

const okDist = (t) => (t >= 100 ? 7 : 7); // |đo-target| chấp nhận
const strip = (ch) => ch.map((c) => ({ color: c.color, count: c.count }));

// ---- áp twins cho 1 ứng viên (đã writeD nếu cần CLI); trả về chests cuối ----
function applyTwins(d, D, cdep) {
  const L = d[D.lvl];
  if (!D.twins) return true;
  if (D.target >= 80) {
    const made = addGentleTwins(L, D.twins, D.lvl * 449 + 5, cdep, { forceFront: !!D.twinFront });
    return made >= Math.min(D.twins, 1);
  }
  writeD(d);
  tuneTwinsCli(D.lvl, D.twins);
  // chỉ copy CHESTS về (giữ nguyên identity của d[lvl] — L bên caller vẫn trỏ đúng object)
  const d2 = readD();
  d[D.lvl].chests = d2[D.lvl].chests;
  // CLI không ra cặp "meaningful" nào → vẫn phải có twin theo CSV: dùng cặp nhẹ
  if (!d[D.lvl].chests.some((c) => c.pairId != null)) addGentleTwins(d[D.lvl], D.twins, D.lvl * 449 + 5, cdep);
  return true;
}

// ================================ MAIN =======================================
fs.writeFileSync(LOG, "");
const only = process.env.ONLY ? new Set(process.env.ONLY.split(",").map(Number)) : null;

// ---- L1/L2: copy từ repo chính + slam ---------------------------------------
if (!only || only.has(1) || only.has(2)) {
  const main = JSON.parse(fs.readFileSync(path.join(ROOT, MAIN_DESIGNED), "utf8"));
  const d = readD();
  for (const k of [1, 2]) {
    if (only && !only.has(k)) continue;
    d[k] = JSON.parse(JSON.stringify(main[k]));
    d[k].slam = true; delete d[k].tray;
    writeD(d);
    const w = measure(d[k], 64);
    log(`L${k}: copy từ repo chính ✓ (${d[k].chests.length} xe) — trip-sim ${w}% (target 100)`);
  }
}

// ---- L3-25 ------------------------------------------------------------------
for (const D of DESIGN) {
  if (only && !only.has(D.lvl)) continue;
  const t0 = Date.now();
  let built = null;
  for (const img of imgCandidates(D.img)) {
    const rel = path.relative(ROOT, img);
    const res = buildBoard(rel, D.lvl, D.K, D.size);
    if (!res.ok) { log(`L${D.lvl}: ${path.basename(img)} — viền/lỗi (exit ${res.exit}) → thử ảnh khác`); continue; }
    const d = readD(); const L = d[D.lvl];
    const colors = new Set(L.board.filter(isC)).size;
    const fill = L.board.filter(isC).length;
    if (colors < 4) { log(`L${D.lvl}: ${path.basename(img)} — chỉ ${colors} màu → bỏ`); continue; }
    if (fill < 0.3 * D.size * D.size) { log(`L${D.lvl}: ${path.basename(img)} — phủ ${fill} ô quá thưa → bỏ`); continue; }
    built = { img, res, d };
    break;
  }
  if (!built) { log(`L${D.lvl}: ✗ HẾT ảnh đạt gate — cần ảnh mới`); continue; }
  usedKeys.add(canonName(built.img));
  const { d } = built; const L = d[D.lvl];
  const bgColor = built.res.bgColor;
  L.slam = true; delete L.tray;
  if (D.lanes) L.lanes = D.lanes;
  if (D.walls) placeWalls(L.board, L.cols, L.rows, D.walls);
  if (D.hidden) {
    const h = makeHidden(L.board, L.cols, L.rows, D.hidden, D.lvl * 733 + 11);
    if (h) L.hidden = h.hidden;
  }

  // pha layer2: thử các mức quanh design để kéo về target
  const l2base = D.layer2 || 0;
  const phases = l2base > 0 ? [l2base, Math.max(0.08, l2base - 0.1), l2base + 0.12] : [0];
  let best = null;
  for (const frac of phases) {
    if (frac > 0) addLayer2Clustered(L, D.lvl * 613 + Math.round(frac * 100), frac, bgColor);
    else L.layer2 = null;
    const cdep = colorDepth(L);
    for (const cfg of ladder(D.target)) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const cars = reCar(L, D.lvl * 31 + seed * 7, { minCars: D.minxe, maxCars: cfg.tight ? D.minxe + 4 : D.maxxe });
        L.chests = makeOrder(cars, cdep, D.lvl * 7919 + seed * 137, { bgColor, ...cfg });
        const quick = measure(L, 14);
        if (process.env.DEBUG) console.log(`  [dbg] L${D.lvl} cfg=${cfg.gentle ? "gentle" : cfg.bgHead + "/" + cfg.deepN}${cfg.tight ? "+tight" : ""} seed=${seed} quick=${quick}`);
        if (Math.abs(quick - D.target) > 16 && !(D.target >= 95 && quick >= 90)) continue;
        // ứng viên — áp twins rồi đo kỹ
        if (!applyTwins(d, D, cdep)) continue;
        const full = measure(d[D.lvl], 64);
        const dist = Math.abs(full - D.target);
        if (!best || dist < best.dist) best = { dist, full, frac, chests: JSON.parse(JSON.stringify(d[D.lvl].chests)), layer2: d[D.lvl].layer2 ? d[D.lvl].layer2.slice() : null };
        if (dist <= 3) break;
        d[D.lvl].chests = L.chests = strip(d[D.lvl].chests); // gỡ pairId thử tiếp
      }
      if (best && best.dist <= 3) break;
    }
    if (best && best.dist <= okDist(D.target)) break;
  }
  if (!best) { log(`L${D.lvl}: ✗ không cấu hình nào gần target ${D.target} — giữ bản build thô`); writeD(d); continue; }
  L.img = path.basename(built.img); // ghi lại ảnh dùng (pass sau đọc để tránh trùng)
  L.chests = best.chests; L.layer2 = best.layer2;
  if (L.layer2 === null) delete L.layer2;
  if (D.buried) addBuried(L, D.buried, D.lvl * 131 + 7, L.lanes || 4);
  writeD(d);
  const tw = new Set(L.chests.filter((c) => c.pairId != null).map((c) => c.pairId)).size;
  const bu = L.chests.filter((c) => c.buried).length;
  const l2 = L.layer2 ? L.layer2.filter((v) => v >= 0).length : 0;
  const hid = L.hidden ? L.hidden.filter((v) => v >= 0).length : 0;
  const wall = L.board.filter((v) => v >= 90).length;
  log(`L${D.lvl}: ${path.basename(built.img)} ✓ viền id${bgColor} ${built.res.borderPct}% | ${L.chests.length} xe ${tw} twin ${bu}"?" ${l2}chôn ${hid}ẩn ${wall}đá | trip-sim ${best.full}% (target ${D.target}) [${Math.round((Date.now() - t0) / 1000)}s]`);
}
log("✔ gen25 xong");
