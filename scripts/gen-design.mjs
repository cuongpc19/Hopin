// gen-design — DỰNG LẠI L2-46 theo level-design-guide.md + winratedesign1.csv (user 2026-08-05).
//
// Khác bộ tune cũ ở ba chỗ:
//   1. Target lấy từ winratedesign1.csv (cột `target`) chứ không tự bịa đường cong; ràng buộc
//      `max màu`, `minxe`, `xedoi` của từng level cũng lấy từ đó.
//   2. Thứ tự xe dựng theo BA HỒI (design-core.orderThreeAct) — mở / thắt / về — thay vì rắc
//      xe khó khắp hàng. Guide §0a: độ khó = độ lệch pha giữa thứ tự xe và thứ tự lộ màu.
//   3. CÓ CỬA NGHIỆM THU THỨ HAI: vị trí thua phải rơi vào 25-75% hành trình (guide §2b: thua
//      ở xe 6-15, không phải xe cuối). Bộ cũ chỉ chấm winrate nên độ khó dồn hết về cuối màn —
//      đo ngày 2026-08-05: thua ở 51-96% hành trình.
//
//   node scripts/gen-design.mjs --scan   (SHARD/NSHARD)  → JSON điểm từng nấc
//   node scripts/gen-design.mjs --pick f1.json f2.json … → chọn + ghi designed.json
import fs from "node:fs";
import { readD, writeD, isC, colorDepth, mkRng, addLayer2Clusters } from "./genlib.mjs";
import { gradeBatch } from "./calib.mjs";
import { orderByPeel, shiftEarly, lossProfile, positionPenalty, twinGapOk, twinShape } from "./design-core.mjs";

const LANES = 4;
const N_B = Number(process.env.N_B || 100);
const N_POS = Number(process.env.N_POS || 40);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",").map(Number)) : null;
const DRY = process.env.DRY === "1";

// ---- spec từ winratedesign1.csv ----------------------------------------------------------
const SPEC = (() => {
  const out = {};
  try {
    const t = fs.readFileSync("Manythings/Design winrate/winratedesign1.csv", "utf8").replace(/^﻿/, "").trim().split(/\r?\n/);
    const h = t[0].split(","), ix = (n) => h.indexOf(n);
    for (const line of t.slice(1)) {
      const c = line.split(",");
      const n = +c[ix("lvl")];
      if (!Number.isFinite(n)) continue;
      // Trần 90% (user 2026-08-05: "không 100% thì 90% cũng được"). Thước hiệu chuẩn bão hoà
      // ở 94% nên target 100% vốn không đo được; 90% vừa với tới vừa đúng ý "level nghỉ".
      out[n] = { target: Math.min(90, +c[ix("target")]), maxCol: +c[ix("max màu")], minCar: +c[ix("minxe")], twins: +c[ix("xedoi")] };
    }
  } catch { /* không có CSV thì dùng mặc định bên dưới */ }
  return out;
})();
const spec = (n) => SPEC[n] || { target: 20, maxCol: 12, minCar: 16, twins: 2 };

// SỐ XE là MỘT CHIỀU CỦA THANG, không phải hằng số. Guide §2e đã cảnh báo và đo 2026-08-05
// xác nhận: gộp xe to KHÔNG trung tính — L16 bản gốc 130 xe nhỏ đạt 80%, dựng lại 25 xe to
// rơi xuống 2% ở CẢ 24 nấc. Vài board chỉ giải được bằng xe nhỏ, nên để bộ chọn tự tìm.
//
// Số xe của mỗi nấc tính TỪ `minxe` của level trong CSV, không phải con số cố định — user
// 2026-08-05: "level 2,3,4 vẫn nhiều xe, cho ít xe và số slime thật lớn ở những level đầu".
// CSV cho L2 minxe=8, L3/L4 minxe=10, nên L2 ra ~8 xe × ~120 slime thay vì 25 xe × 40.
// Nấc xếp từ ÍT tới NHIỀU và bộ chọn ưu tiên nấc nhỏ khi hoà → luôn nghiêng về ít xe.
// ⚠ SÀN SLIME LÀ ƯU TIÊN, KHÔNG PHẢI CHẶN. Bản trước ép cap = max(30, ô/xe), nên với board
// 1369 ô thì cap luôn kẹt ở 30 = tối đa 46 xe, dù núm "số xe" vặn tới đâu. Nửa trên của thang
// không tồn tại, và tôi kết luận nhầm là "thêm xe không cứu được" (user bắt đúng 2026-08-05:
// "làm level dễ thì dễ mà"). Bỏ chặn thì L26 nhảy 5%→94%, L30 4%→66%, L20 9%→58%, L10 13%→55%.
// Giờ quét THẲNG theo sức chứa xe, xếp từ XE TO (ít xe, đỡ mệt tay) xuống XE NHỎ, và bộ chọn
// lấy nấc ĐẦU TIÊN đạt target → vẫn nghiêng về ít xe, nhưng không bao giờ chặn tính giải được.
const CAPS = (process.env.CAPS || "50,38,30,24,18,13,9").split(",").map(Number);

// MẬT ĐỘ XE ĐÔI / XE "?" (user 2026-08-05: "thi thoảng thêm vài cái xe ?, xe đôi nhé.
// Level khó thì mật độ nhiều hơn"). Không gắn vào nấc thang nữa — đây là hằng số THIẾT KẾ
// của level, thang lo winrate bằng số xe / áp lực / lớp-2.
//   • Xe đôi: lấy cột `xedoi` của CSV làm gốc; CSV ghi 0 thì vẫn rắc 1 cặp ở level chẵn từ
//     L8 trở đi, để cơ chế xuất hiện đều chứ không biến mất cả chục level.
//   • Xe "?": sim BỎ QUA cờ buried (guide §0 gọi đúng nó là "lever giả"), nên thêm bao nhiêu
//     cũng không đổi winrate đo được — thuần tuý là đòn tâm lý. Rắc theo độ khó.
const twinCount = (n, sp) => (sp.twins > 0 ? sp.twins : (n >= 8 && n % 2 === 0 ? 1 : 0));
const buriedCount = (t) => (t >= 85 ? 2 : t >= 60 ? 3 : 5);

// ---- thang độ khó: áp lực (xe lệch pha ở hồi thắt) × lớp-2 --------------------------------
// Guide §2c: tổng ô lớp-2 là knob chính, dốc ~1-2 điểm winrate/ô (0 ô ≈ 80%, 40 ô ≈ 25-40%).
// Ở đây lớp-2 chỉ dùng khi áp lực thứ-tự đã cạn, vì lớp-2 làm bàn NẶNG thêm (user: chơi mệt).

function twinsInCrunch(L, nPairs, cdep, seed) {
  for (const c of L.chests) delete c.pairId;
  if (!nPairs) return 0;
  const rng = mkRng(seed);
  const N = L.chests.length;
  const lo = Math.max(4, Math.round(N * 0.22)), hi = Math.round(N * 0.62);  // chỉ trong hồi thắt
  const cand = [];
  // user 2026-08-05: ĐƯỢC khác hàng, miễn tối đa 2 xe chen giữa và hai hàng sát nhau
  for (let i = lo; i < hi; i++) for (let j = i + 1; j < Math.min(hi, i + LANES + 1); j++) {
    if (!twinGapOk(i, j, LANES)) continue;
    const a = L.chests[i], b = L.chests[j];
    if (a.color === b.color || a.color === 12 || b.color === 12) continue;  // §2b: cấm navy-12
    if (a.count < 12 || b.count < 12) continue;       // §1①: màu quá hiếm → deadlock
    // hình an toàn cho dây ĐƯỢC ƯU TIÊN TRƯỚC, chênh độ sâu chỉ xếp trong cùng một hình
    cand.push({ i, j, shape: twinShape(i, j, LANES), gap: Math.abs((cdep[a.color] || 0) - (cdep[b.color] || 0)) + rng() * 0.4 });
  }
  cand.sort((x, y) => y.shape - x.shape || y.gap - x.gap);
  const used = new Set(); let made = 0;
  for (const g of cand) {
    if (made >= nPairs) break;
    if (used.has(g.i) || used.has(g.j)) continue;
    L.chests[g.i].pairId = made; L.chests[g.j].pairId = made;
    used.add(g.i); used.add(g.j); made++;
  }
  return made;
}
// xe "?" — guide §0: chỉ có nghĩa khi ĐI KÈM áp lực ô chờ, nên gắn vào hồi thắt và theo pressure
function buriedInCrunch(L, want, seed) {
  for (const c of L.chests) delete c.buried;
  if (!want) return 0;
  const N = L.chests.length;
  const lo = Math.max(4, Math.round(N * 0.22)), hi = Math.round(N * 0.62);
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
  const sp = spec(n);
  L.slam = true; L.lanes = LANES;
  delete L.hidden;    // slime "?" — user bỏ 2026-08-05
  delete L.layer2;

  const cnt = {};
  for (const v of L.board) if (isC(v)) cnt[v] = (cnt[v] || 0) + 1;
  const bg = Number(Object.keys(cnt).sort((a, z) => cnt[z] - cnt[a])[0] ?? 12);
  const seed = n * 977 + 13;

  // lớp-2 theo CỤM một-màu (guide §2c: "theo nhóm, không loang lổ")
  if (rung.lay) addLayer2Clusters(L, seed, rung.lay, { bgColor: bg, maxClusters: 4 });

  // NỀN DỄ HOÀN HẢO: xe phát theo ĐÚNG TRÌNH TỰ BÀN ĐƯỢC BÓC → đầu hàng luôn có màu ăn được,
  // không kẹt bay được. Đo 2026-08-05: đưa L25 từ 7% lên 94%, L16 32%→94%, L6 41%→94%.
  // ĐỘ KHÓ: đẩy `pressure` xe từ nửa sau lên hồi giữa → tới trước khi màu của mình lộ.
  L.chests = shiftEarly(orderByPeel(L, rung.cap || CAPS[0], rung.merge ?? 0, rung.wave ?? 1), rung.pressure, seed);

  const cdep = colorDepth(L);
  twinsInCrunch(L, twinCount(n, sp), cdep, seed);
  buriedInCrunch(L, buriedCount(sp.target), seed);
  return L;
}

// ---- điểm: lệch target + phạt vị trí thua ------------------------------------------------
// Level ≥90% thì THUA Ở ĐÂU CŨNG ĐƯỢC (user 2026-08-05): nó gần như không thua, nên mẫu thua
// vừa bé vừa nhiễu, mà phạt vị trí lại kéo bộ chọn đi lệch khỏi target. Chỉ chấm vị trí thua
// ở những level thật sự có người thua.
const score = (win, lossAt, t) => Math.abs(win - t) + (t >= 90 || win >= 90 ? 0 : positionPenalty(lossAt));

const d = readD();
const nums = [];
for (let n = 2; n <= 46; n++) if (d[n] && (!ONLY || ONLY.has(n))) nums.push(n);

// ---- QUÉT HAI CHẶNG ----------------------------------------------------------------------
// Lưới đều tay 32 phương án × 45 level = 1440 phép đo là LÃNG PHÍ (user 2026-08-05 bắt đúng):
// level target 90% chỉ cần thử ĐÚNG MỘT phương án dễ nhất, trong khi 31 phương án còn lại đều
// nhằm làm level KHÓ HƠN — đi ngược hướng cần tìm. Và winrate gần như đơn điệu theo số xe /
// áp lực, nên đi từ đầu dễ rồi DỪNG khi vượt qua target là đủ.
//
//   --scan1  : mỗi level MỘT phương án dễ nhất  (45 phép đo)
//   --scan2  : chỉ những level trượt, leo thang từ dễ tới khó, dừng khi qua target
const EASIEST = { cap: CAPS[0], pressure: 0, lay: 0 };
// ⚠ SỐ XE KHÔNG ĐƠN ĐIỆU. Đo 2026-08-05: ở mức xe ÍT NHẤT (minxe của CSV) thì 18/29 level
// quá khó — L6 target 90% chỉ được 3%, L11/L16/L23/L26 đều 2% — trong khi chính L16 với 130
// xe nhỏ lại đạt 80%. Xe to = mỗi xe phải gom đủ nhiều ô cùng màu mới rời được ô chờ, nên
// board vụn màu thì xe to là bất khả thi. Vậy thang phải quét CẢ HAI CHIỀU của số xe.
const LADDER = [];
{
  const press = (process.env.PRESS || "0,1,2,3").split(",").map(Number);
  const lays = (process.env.LAY2 || "0,40").split(",").map(Number);
  const waves = (process.env.WAVES || "1,2,3").split(",").map(Number);
  const mr = Number(process.env.MAX_RUN || 99);
  for (const cap of CAPS) for (const wave of waves) for (const pressure of press) for (const lay of lays)
    LADDER.push({ cap, wave, pressure, lay, maxRun: mr });
}

if (process.argv.includes("--scan1")) {
  const Ls = nums.map((n) => build(d[n], n, EASIEST));
  console.error(`chang 1: ${nums.length} level, moi level 1 phuong an de nhat`);
  const g = gradeBatch(Ls, { n: N_B, tag: "s1" });
  console.log(JSON.stringify(nums.map((n, i) => ({ n, ri: -1, win: g[i].win, cars: Ls[i].chests.length, rung: EASIEST }))));
  process.exit(0);
}

if (process.argv.includes("--scan2")) {
  const SHARD = Number(process.env.SHARD || 0), NSHARD = Number(process.env.NSHARD || 1);
  const todo = (process.env.LEVELS || "").split(",").map(Number).filter(Boolean);
  const mine = todo.filter((_, i) => i % NSHARD === SHARD);
  const jobs = [];
  // lớp-2 CHỈ ở level khó (user 2026-08-05: "layer2 nếu có thì chỉ có ở level hard, super hard")
  for (const n of mine) LADDER.forEach((r, ri) => {
    if (r.lay > 0 && spec(n).target > 60) return;
    jobs.push({ n, ri, L: build(d[n], n, r) });
  });
  console.error(`chang 2 shard ${SHARD}: ${mine.length} level x ${LADDER.length} nac = ${jobs.length} phep do`);
  const g = gradeBatch(jobs.map((j) => j.L), { n: N_B, tag: "s2_" + SHARD });
  console.log(JSON.stringify(jobs.map((j, i) => ({ n: j.n, ri: j.ri, win: g[i].win, cars: j.L.chests.length, rung: LADDER[j.ri] }))));
  process.exit(0);
}

if (process.argv.includes("--pick")) {
  const files = process.argv.slice(process.argv.indexOf("--pick") + 1);
  const rows = files.flatMap((f) => JSON.parse(fs.readFileSync(f, "utf8")));
  const byLv = {};
  for (const r of rows) (byLv[r.n] = byLv[r.n] || []).push(r);

  console.log("Dung lai L2-46 theo level-design-guide + winratedesign1.csv\n");
  console.log('lv  | tgt | win  | thua@ | ap | lop2 | xe | doi | up | ghi chu');
  const out = {};
  for (const n of Object.keys(byLv).map(Number).sort((a, b) => a - b)) {
    const t = spec(n).target;
    // vòng 1: lọc theo winrate. vòng 2: chỉ những ứng viên đã gần target mới đo VỊ TRÍ THUA
    // (guide §2b) — đo lossProfile cho cả thang thì phí, mà lấy thẳng thang thì mất tiêu chí.
    const cands = byLv[n].slice().sort((a, b) => Math.abs(a.win - t) - Math.abs(b.win - t));
    // Dung sai 12 điểm chứ không 8: sai số của chính thước đã ~8 điểm, nên trong dải đó winrate
    // không phân biệt nổi — để VỊ TRÍ THUA và SỐ XE quyết định thì đúng ý user hơn (độ khó dồn
    // vào khúc giữa, ít xe). Siết về 8 từng loại mất nấc L15 thua@51% để lấy nấc thua@89%.
    let near = cands.filter((r) => Math.abs(r.win - t) <= 12);
    if (!near.length) near = cands.filter((r) => Math.abs(r.win - t) <= 20);
    const pool = (near.length ? near : cands).slice(0, 14);
    for (const r of pool) r.lossAt = lossProfile(build(d[n], n, r.rung)).lossAt;
    // hoà nhau thì ÍT XE THẮNG (user: "giảm thiểu số xe để chơi đỡ mệt"). 0.25đ/xe: chênh 20 xe
    // ăn đứt chênh 5 điểm winrate — mà 5 điểm thì nằm gọn trong sai số ~8 điểm của thước.
    const key = (r) => score(r.win, r.lossAt, t) + r.cars * 0.25;
    const best = pool.slice().sort((a, b) => key(a) - key(b) || a.ri - b.ri)[0];
    const L = build(d[n], n, best.rung);
    const lay = L.layer2 ? L.layer2.filter((v) => v >= 0).length : 0;
    const tw = new Set(L.chests.filter((c) => c.pairId != null).map((c) => c.pairId)).size;
    const bu = L.chests.filter((c) => c.buried).length;
    const note = [];
    if (Math.abs(best.win - t) > 10) note.push('winrate lech');
    if (best.lossAt != null && (best.lossAt < 25 || best.lossAt > 75)) note.push('thua o met cuoi');
    console.log(
      `L${String(n).padEnd(3)}| ${String(t).padStart(3)}% | ${String(best.win).padStart(3)}% |  ${String(best.lossAt ?? '-').padStart(3)}% |` +
      ` ${String(best.rung.pressure)}  | ${String(lay).padStart(4)} | ${String(L.chests.length).padStart(2)} | ${String(tw).padStart(3)} | ${String(bu).padStart(2)} | ${note.join(', ')}`
    );
    out[n] = L;
  }
  if (!DRY) { for (const n of Object.keys(out)) d[n] = out[n]; writeD(d); console.log("\nda ghi vao src/levels/designed.json"); }
  else console.log("\nDRY=1 — khong ghi");
  process.exit(0);
}

// Chỉ in hướng dẫn khi chạy TRỰC TIẾP — file này còn được import để lấy `build()`.
if (process.argv[1] && process.argv[1].split("\\").join("/").endsWith("gen-design.mjs")) {
  console.log("dung: --scan1 > s1.json ; --scan2 (LEVELS=..) > s2-*.json ; --pick s1.json s2-*.json");
  process.exit(1);
}
