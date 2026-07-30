// rebuild-band.mjs — DESIGN LẠI L131-152 (user 2026-07-30):
//   • Viền kiểu MỚI (chữ nhật bbox+1 ≤30% board — border.mjs qua build-one); ảnh vượt 30%
//     → THAY ảnh từ kho tồn (không thu nhỏ chủ thể).
//   • Cân dải winrate 10-40% (trip-sim): ramp 131→145 = 40→12; 146/147 twin-heavy ≈25
//     (twin phải GÁNH ≥12 điểm); 148→152 mixed ("?"+twin+chôn) = 30→14.
//   • Twin theo rule mới (tunetwins: ngang/dọc kề, khác màu, cấm navy-12 → dây luôn thấy).
// Chạy: node scripts/rebuild-band.mjs   |   ONLY=135 node scripts/rebuild-band.mjs
import fs from "fs";
import path from "path";
import {
  ROOT, isC, readD, writeD, measure, colorDepth, reCar, makeOrder,
  addLayer2Clusters, addBuried, tuneTwinsCli, buildBoard, canonName,
} from "./genlib.mjs";

const LOG = path.join(ROOT, "scripts/_rebuild-band-log.txt");
const log = (s) => { console.log(s); fs.appendFileSync(LOG, s + "\n"); };
const A3 = "../Pixel Flow/public/art/level art/3";
const A4 = "../Pixel Flow/public/art/level art/4";
const AH = "../Pixel Flow/public/art/level art/hard";
const A1 = "public/art/level art/1";

// ảnh gốc từng level (mapping từ đợt gen15/gen7) — vượt viền 30% thì lấy POOL
const IMG = {
  131: `${A3}/Gemini_Generated_Image_77bcma77bcma77bc.png`,
  132: `${A3}/Gemini_Generated_Image_84v02m84v02m84v0.png`,
  133: `${A3}/Gemini_Generated_Image_99l57899l57899l5.png`,
  134: `${A3}/Gemini_Generated_Image_b0vnenb0vnenb0vn.png`,
  135: `${A3}/Gemini_Generated_Image_gakl8ngakl8ngakl.png`,
  136: `${A4}/Gemini_Generated_Image_77bcma77bcma77bc (1).png`,
  137: `${A4}/Gemini_Generated_Image_udanp6udanp6udan.png`,
  138: `${AH}/Adesivo De Um Foguete Espacial De Desenho Animado PNG , Clipart De Foguete, Clipart Espacial, Clipart De Adesivo PNG Imagem para download gratuito.jpg`,
  139: `${AH}/Adorable Penguin on Beige Background.jpg`,
  140: `${AH}/Cute bee on white background _ Premium AI-generated vector.jpg`,
  141: `${AH}/Free Cartoon Clipart.jpg`,
  142: `${AH}/Jungle Thema.jpg`,
  143: `${AH}/Kawaii Chibi Panda – Cute & Cozy.jpg`,
  144: `${AH}/Vector Free Snail Clipart Gary - Gary From Spongebob-free Download PNG Transparent With Clear Background ID 170599 _ TopPNG.jpg`,
  145: `${A1}/7_bear.png`,
  146: `${A3}/Gemini_Generated_Image_cs8t6wcs8t6wcs8t.png`,
  147: `${A3}/Gemini_Generated_Image_gfqb76gfqb76gfqb.png`,
  148: `${A4}/Gemini_Generated_Image_hwv4j7hwv4j7hwv4.png`,
  149: `${A4}/Gemini_Generated_Image_nzeocznzeocznzeo.png`,
  150: `${A4}/Gemini_Generated_Image_svg8zisvg8zisvg8.png`,
  151: `${AH}/27232772742156475.jpg`,
  152: `${AH}/28569778882173851.jpg`,
};
// kho tồn thay thế (thứ tự ưu tiên: nhiều màu trước, ít màu cuối)
const POOL = [
  `${AH}/306878162131588004.jpg`,
  `${AH}/5136987070076682.jpg`,
  `${AH}/Airplane Taking Off Clipart Transparent Background, Airplane Clipart Plane Taking Off, Clipart, Take Off, Aircraft PNG Image For Free Download.jpg`,
  `${AH}/Birthday Hat Png.jpg`,
  `${A1}/3_frog.png`, `${A1}/3_penguin.png`, `${A1}/5_fish.png`, `${A1}/6_bee.png`,
  `${AH}/Adorable Cartoon Frog Illustration – Cute Kawaii Animal Art for Kids & Nursery.jpg`,
  `${AH}/Cute penguin flying with balloons cartoon vector illustration _ Premium AI-generated vector.jpg`,
  `${AH}/cartoon of a baby sheep.jpg`,
  `${AH}/Cute Cartoon Flower Clipart Illustration, Cute Cartoon Flowers, Kawaii Flower Clipart, Happy Flower Illustration PNG Transparent Image and Clipart for Free Download.jpg`,
  `${AH}/Frozen_ Olaf Clip Art_.jpg`,
  `${AH}/The Boss Baby Family Business PNG Cartoon Image.jpg`,
  `${AH}/492649954787770.jpg`,
];
// POOL MỞ RỘNG: kho sliced/ của mode cũ (L1-25 mới cũng lấy ở đây — mỗi ảnh chỉ 1 level).
const SLICED = "../Pixel Flow/public/art/level art/sliced";
function listSliced() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(png|jpg)$/i.test(e.name)) out.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, SLICED));
  return out;
}
// Sổ cái theo KHOÁ CHUẨN canonName (gộp 2 bản cùng artwork khác tên — bug L21/voi):
// ảnh gốc từng level + mọi `img` trong designed.json + 2 chủ thể L1/L2.
const usedNames = new Set([
  ...Object.values(IMG).map((p) => canonName(p)),
  canonName("3_penguin_animals1.png"), canonName("2_elephant_animals2.png"),
]);
{
  const d0 = readD();
  for (const k of Object.keys(d0)) if (d0[k] && d0[k].img) usedNames.add(canonName(d0[k].img));
}
const POOL_ALL = () => [...POOL, ...listSliced()].filter((p) => !usedNames.has(canonName(p)));

// target ramp (dải 10-40, ±6 nhưng kẹp cứng [10,40])
const TARGET = {
  131: 40, 132: 38, 133: 36, 134: 34, 135: 32, 136: 30, 137: 28, 138: 26, 139: 24,
  140: 22, 141: 20, 142: 17, 143: 15, 144: 13, 145: 12,
  146: 25, 147: 25,
  148: 30, 149: 26, 150: 22, 151: 18, 152: 14,
};
const KIND = (l) => (l <= 145 ? "ramp" : l <= 147 ? "twin" : "mixed");

function ladder(target) {
  if (target >= 32) return [{ bgHead: 2, deepN: 1 }, { bgHead: 2, deepN: 2 }, { bgHead: 3, deepN: 2 }, { gentle: true }];
  if (target >= 22) return [{ bgHead: 3, deepN: 2 }, { bgHead: 2, deepN: 2 }, { bgHead: 3, deepN: 3 }, { bgHead: 4, deepN: 3 }];
  return [{ bgHead: 3, deepN: 3 }, { bgHead: 4, deepN: 4 }, { bgHead: 5, deepN: 4 }, { bgHead: 3, deepN: 2 }];
}
const strip = (ch) => ch.map((c) => ({ color: c.color, count: c.count }));

fs.writeFileSync(LOG, "");
const only = process.env.ONLY ? new Set(process.env.ONLY.split(",").map(Number)) : null;

for (let lvl = 131; lvl <= 152; lvl++) {
  if (only && !only.has(lvl)) continue;
  const t0 = Date.now();
  const target = TARGET[lvl];
  const kind = KIND(lvl);
  // ---- 1. board mới (viền chữ nhật); vượt 30% → pool (kho tồn + sliced chưa dùng) ----
  const tryImgs = [IMG[lvl], ...POOL_ALL()];
  let built = null;
  let minColors = 8;
  for (let pass = 0; pass < 2 && !built; pass++, minColors = 6) {
    for (const img of tryImgs) {
      if (!fs.existsSync(path.join(ROOT, img))) { continue; }
      const res = buildBoard(img, lvl, 12, 25);
      if (!res.ok) { if (img === IMG[lvl]) log(`L${lvl}: ảnh gốc vượt viền 30% (exit ${res.exit}) → thay ảnh`); continue; }
      const d = readD(); const L = d[lvl];
      const colors = new Set(L.board.filter(isC)).size;
      const fill = L.board.filter(isC).length;
      if (colors < minColors || fill < 200) { continue; }
      built = { img, res, d };
      break;
    }
  }
  if (!built) { log(`L${lvl}: ✗ không ảnh nào đạt gate — GIỮ level cũ`); continue; }
  usedNames.add(canonName(built.img));
  const { d } = built; const L = d[lvl];
  L.img = path.basename(built.img); // sổ cái ảnh-đã-dùng cho các lần chạy sau
  const bgColor = built.res.bgColor;
  L.slam = true; delete L.tray;

  // ---- 2. BISECTION tổng ô layer2 (cần chỉnh chính trên board viền-gọn: dốc ~1-2 điểm/ô,
  // 40 ô ≈ band giữa, ≥100 ô = 0%) rồi quét cấu hình quanh điểm tìm được ----
  // mixed: bisect nhắm target+8 vì twins sẽ kéo xuống thêm ~5-15 điểm sau đó.
  const bisectTarget = target + (kind === "mixed" ? 8 : 0);
  let wantMid = 0;
  if (kind !== "twin") {
    let lo = 0, hi = 140; // trần 100 không đủ với subject nhỏ (L141 kẹt 41% ở want=100)
    for (let it = 0; it < 6; it++) {
      const mid = Math.round((lo + hi) / 2);
      addLayer2Clusters(L, lvl * 613 + 11, mid, { bgColor });
      const cdep = colorDepth(L);
      let s = 0;
      for (let seed = 1; seed <= 3; seed++) {
        const cars = reCar(L, lvl * 31 + seed * 7, { minCars: 12 });
        L.chests = makeOrder(cars, cdep, lvl * 7919 + seed * 137, { bgColor, bgHead: 3, deepN: 2 });
        s += measure(L, 14);
      }
      const w = s / 3;
      if (process.env.DEBUG) console.log(`  [dbg] L${lvl} bisect want=${mid} → ~${Math.round(w)}%`);
      if (w > bisectTarget) lo = mid; else hi = mid;
    }
    wantMid = Math.round((lo + hi) / 2);
  }
  const wants = kind === "twin" ? [0] : [...new Set([wantMid, Math.max(0, wantMid - 6), wantMid + 6])];
  let best = null;
  outer:
  for (const wv of wants) {
    addLayer2Clusters(L, lvl * 613 + 11, wv, { bgColor });
    const cdep = colorDepth(L);
    for (const cfg of ladder(target)) {
      for (let seed = 1; seed <= 8; seed++) {
        const cars = reCar(L, lvl * 31 + seed * 7, { minCars: 12 });
        L.chests = makeOrder(cars, cdep, lvl * 7919 + seed * 137, { bgColor, ...cfg });
        const quick = measure(L, 14);
        if (process.env.DEBUG) console.log(`  [dbg] L${lvl} want=${wv} cfg=${cfg.gentle ? "gentle" : cfg.bgHead + "/" + cfg.deepN} seed=${seed} quick=${quick}`);
        if (Math.abs(quick - target) > 16) continue;
        let base = -1, full;
        if (kind === "ramp") {
          full = measure(L, 64);
        } else {
          base = measure(L, 40);
          if (kind === "twin" && base < 35) continue; // baseline phải đủ dễ để twin gánh
          writeD(d);
          tuneTwinsCli(lvl, 6);
          const d2 = readD(); d[lvl].chests = d2[lvl].chests;
          if (!d[lvl].chests.some((c) => c.pairId != null)) { L.chests = strip(L.chests); continue; }
          full = measure(d[lvl], 64);
          // twin-heavy: ảnh sliced ít màu hơn ảnh Gemini gốc → nới gánh 12→8 (2026-07-31,
          // L146/147 fail cả 2 vòng với ≥12)
          if (kind === "twin" && base - full < 8) { L.chests = strip(d[lvl].chests); continue; }
        }
        const inBand = full >= 10 && full <= 40;
        const dist = Math.abs(full - target) + (inBand ? 0 : 50);
        if (!best || dist < best.dist) best = { dist, full, base, chests: JSON.parse(JSON.stringify(d[lvl].chests)), layer2: d[lvl].layer2 ? d[lvl].layer2.slice() : null };
        if (dist <= 3) break outer;
        if (kind !== "ramp") L.chests = strip(d[lvl].chests);
      }
    }
    if (best && best.dist <= 6) break;
  }
  if (!best) { log(`L${lvl}: ✗ không cấu hình nào vào band — GIỮ bản build thô (cần xem tay)`); writeD(d); continue; }
  L.chests = best.chests;
  L.layer2 = best.layer2;
  if (L.layer2 === null) delete L.layer2;
  if (kind === "mixed") addBuried(L, 0.33, lvl * 131 + 7, L.lanes || 4);
  writeD(d);
  const tw = new Set(L.chests.filter((c) => c.pairId != null).map((c) => c.pairId)).size;
  const bu = L.chests.filter((c) => c.buried).length;
  const l2 = L.layer2 ? L.layer2.filter((v) => v >= 0).length : 0;
  const gánh = best.base >= 0 ? ` (baseline ${best.base}%, twin gánh ${best.base - best.full})` : "";
  log(`L${lvl}: ${path.basename(built.img).slice(0, 40)} ✓ viền id${bgColor} ${built.res.borderPct}% | ${L.chests.length} xe ${tw} twin ${bu}"?" ${l2}chôn | trip-sim ${best.full}%${gánh} (target ${target}) [${Math.round((Date.now() - t0) / 1000)}s]`);
}
log("✔ rebuild-band xong");
