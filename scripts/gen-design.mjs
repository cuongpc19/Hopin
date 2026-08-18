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
import { orderByPeel, shiftEarly, absorbTiny, lossProfile, positionPenalty, twinGapOk, twinShape } from "./design-core.mjs";

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
// user 2026-08-06: "winrate cho level 3-9, cứ trên 90% nhé, 95% cũng được, miễn sao user bấm
// sướng tay" → đè lên cột target của CSV (CSV cho L3 81%, L5 70%). Thước bão hoà ở 94% nên 90
// ở đây nghĩa là "dễ hết mức đo được".
const EASY_RUN = { from: 3, to: 9, target: 90 };
// Đè target cho level không có trong CSV (L47+):  TGT="187:88,190:94,…"
const TGT = Object.fromEntries((process.env.TGT || "").split(",").filter(Boolean)
  .map((s) => s.split(":").map(Number)));
// PHƯƠNG ÁN C (dải 9101-9133) — mọi thứ tra theo SLOT nó sẽ chiếm, không theo số bàn.
//
// ⚠ ĐÂY LÀ CÁI BẪY. `SPEC` tra theo số level, mà 9101-9133 không có trong CSV nên nó rơi vào
// giá trị dự phòng `{target:20, maxCol:12, minCar:16, twins:2}` — tức MỌI ô của bộ C nhận 2
// cặp xe đôi, kể cả slot 2-7, trong khi user 2026-08-18 muốn xe đôi chỉ từ level 8. Lượt quét
// đầu đã chạy sai vì đúng chỗ này; phải tra qua slot thì spec, xe đôi và số xe tối thiểu mới
// đúng với chỗ level sẽ đứng.
const CSLOT = (() => {
  try {
    const m = new Map();
    for (const r of JSON.parse(fs.readFileSync("scripts/_setC.json", "utf8"))) m.set(r.to, r.s);
    return m;
  } catch { return new Map(); }
})();
const slotOf = (n) => CSLOT.get(n) ?? n;

const spec = (n) => {
  const k = slotOf(n);
  const s = SPEC[k] || { target: 20, maxCol: 12, minCar: 16, twins: 2 };
  if (TGT[n] != null) return { ...s, target: TGT[n] };
  return k >= EASY_RUN.from && k <= EASY_RUN.to ? { ...s, target: EASY_RUN.target } : s;
};

// ---- target trên THANG THÔ:  RAWTGT="15:40,20:40,25:40" ----------------------------------
// TGT đặt mốc cho con số ĐÃ HIỆU CHUẨN, tức trung bình của B và D rồi nắn. Nhược điểm: nó
// nhận cả những nấc mà hai mô hình cãi nhau to (L15 bản 3f34889: B=48, D=77 — trung bình 63
// trông đẹp, nhưng đó là trung bình của hai phỏng đoán trái ngược, không mô hình nào tin được).
// RAWTGT đòi CẢ HAI cùng đứng gần mốc: khoảng cách = max(|B−t|, |D−t|), nên nấc lệch pha giữa
// hai mô hình bị loại thẳng.
// ⚠ ĐÂY KHÔNG PHẢI WINRATE NGƯỜI THẬT. B = D = 40 nắn ra 26% (§2.1). Đặt RAWTGT nghĩa là
// đang nói chuyện trên thang bot, phải quy đổi trước khi so với target thiết kế.
const RAWTGT = Object.fromEntries((process.env.RAWTGT || "").split(",").filter(Boolean)
  .map((s) => s.split(":").map(Number)));
// DẢI, không phải một điểm:  BAND="80:10,35:5,25:5"  → khoá là GIÁ TRỊ TARGET, không phải số
// level. User 2026-08-13: "nhóm 80% khó đạt thì cứ đẩy về 70 hoặc 90%, dao động 10%" — nghĩa là
// rơi đâu trong dải cũng tính đạt, và khi đã đạt thì tiêu chí còn lại (ít xe, vị trí thua) mới
// là thứ quyết định. Không có BAND thì giữ nguyên nết cũ: khoảng cách tới đúng một điểm.
const BAND = Object.fromEntries((process.env.BAND || "").split(",").filter(Boolean)
  .map((s) => s.split(":").map(Number)));
const offBand = (win, t) => Math.max(0, Math.abs(win - t) - (BAND[t] ?? 0));
const distTo = (r, n) => {
  const rt = RAWTGT[n];
  if (rt == null) return offBand(r.win, spec(n).target);
  if (r.b == null || r.d == null) return offBand(r.win, rt);   // bảng quét cũ, chưa có b/d
  return Math.max(offBand(r.b, rt), offBand(r.d, rt));
};

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
// Xe đôi tính theo SLOT: bộ C nằm ở 9101+, mà `n >= 8` thì số nào cũng thoả, nên nếu lấy số
// bàn thì slot 2-7 cũng mọc xe đôi (user: xe đôi sau level 8).
const TWIN_VERTICAL_ONLY = process.env.TWIN_VERTICAL_ONLY !== "0";
const twinCount = (n, sp) => {
  const k = slotOf(n);
  return sp.twins > 0 ? sp.twins : (k >= 8 && k % 2 === 0 ? 1 : 0);
};
const buriedCount = (t) => (t >= 85 ? 2 : t >= 60 ? 3 : 5);

// ---- thang độ khó: áp lực (xe lệch pha ở hồi thắt) × lớp-2 --------------------------------
// Guide §2c: tổng ô lớp-2 là knob chính, dốc ~1-2 điểm winrate/ô (0 ô ≈ 80%, 40 ô ≈ 25-40%).
// Ở đây lớp-2 chỉ dùng khi áp lực thứ-tự đã cạn, vì lớp-2 làm bàn NẶNG thêm (user: chơi mệt).

function twinsInCrunch(L, nPairs, cdep, seed) {
  for (const c of L.chests) delete c.pairId;
  if (!nPairs) return 0;
  const rng = mkRng(seed);
  const N = L.chests.length;
  // Cửa sổ "hồi thắt". NỚI RA THEO SỐ CẶP: bản gốc cố định 22%-62% tức chỉ ~9 xe khi hàng có
  // 22 chiếc — ba cặp không có cách nào giãn ra trong đó, nên chúng chồng lấn và tạo thành một
  // khối 6 xe liền nhau đều bị buộc (user 2026-08-18: "xe đang hơi sát nhau quá"). Mỗi cặp
  // thêm thì nới trần ra 10% hàng xe, đủ chỗ để rải mà vẫn giữ trọng tâm ở hồi giữa.
  const lo = Math.max(4, Math.round(N * 0.22));
  // ⚠ CỬA SỔ PHẢI ĐỦ RỘNG CHO MỘT CẶP DỌC. Cặp dọc (i, i+LANES) là hình an toàn nhất — hai xe
  // luôn cùng cột nên dây luôn ngắn và thẳng, dù cột vơi tới đâu. Cửa sổ hẹp thì không có cặp
  // (i, i+LANES) nào lọt vào, và thuật toán buộc phải lấy hình có XE CHEN GIỮA — hình mà
  // `twinShape` gọi là "chỉ dùng khi không còn chỗ".
  // Đo trên L9134: cửa sổ 4-8 chỉ còn hai lựa chọn, cả hai đều có xe chen giữa; nới ra thì
  // (6,10) là cặp dọc hợp lệ (user 2026-08-18: "xe đôi nằm ở 2 hàng cách nhau 1 hàng ở giữa").
  const wantHi = Math.round(N * (0.62 + 0.10 * Math.max(0, nPairs - 1)));
  // Sàn = lo + 2*LANES, KHÔNG phải lo + LANES + 2. Vòng lặp dưới chạy `j < hi`, nên muốn cặp
  // dọc (i, i+LANES) lọt vào thì cần hi > i + LANES với vài giá trị i khác nhau — chừa vừa khít
  // một cái là chỉ có đúng một ứng viên, mà ứng viên đó rất dễ bị loại vì trùng màu hoặc vì xe
  // quá nhỏ (<12 ô). Đo trên L9134: sàn lo+LANES+2 cho cửa sổ 4-9, cặp dọc duy nhất (4,8) trùng
  // màu → lại rơi về hình có xe chen giữa. Sàn 2*LANES cho 4-11, và (6,10) hợp lệ.
  const hi = Math.min(N - 1, Math.max(wantHi, lo + 2 * LANES));
  const cand = [];
  // user 2026-08-05: ĐƯỢC khác hàng, miễn tối đa 2 xe chen giữa và hai hàng sát nhau
  for (let i = lo; i < hi; i++) for (let j = i + 1; j < Math.min(hi, i + LANES + 1); j++) {
    // CHỈ NHẬN HÌNH DỌC: cùng cột, hai hàng kề (j - i === LANES). Hàng chờ tiêu thụ THEO CỘT
    // nên hai xe cùng cột luôn dính nhau dù cột vơi tới đâu, dây luôn là đoạn dọc ngắn.
    //
    // Mọi hình khác đều bị user chê ba lần liên tiếp (2026-08-18): "xe đôi nằm ở 2 hàng cách
    // nhau 1 hàng ở giữa", "lại thành xe đôi cách nhau tận 2 hàng". Chúng hợp luật `twinGapOk`
    // nhưng nhìn thì dây kéo chéo hoặc vắt ngang cả hàng. Thà ĐẶT ÍT CẶP HƠN còn hơn đặt cặp xấu
    // — số cặp là con số thiết kế, còn cái dây là thứ người chơi nhìn thấy suốt ván.
    if (TWIN_VERTICAL_ONLY) { if (j - i !== LANES) continue; }
    else if (!twinGapOk(i, j, LANES)) continue;
    const a = L.chests[i], b = L.chests[j];
    if (a.color === b.color || a.color === 12 || b.color === 12) continue;  // §2b: cấm navy-12
    if (a.count < 12 || b.count < 12) continue;       // §1①: màu quá hiếm → deadlock
    // hình an toàn cho dây ĐƯỢC ƯU TIÊN TRƯỚC, chênh độ sâu chỉ xếp trong cùng một hình
    cand.push({ i, j, shape: twinShape(i, j, LANES), gap: Math.abs((cdep[a.color] || 0) - (cdep[b.color] || 0)) + rng() * 0.4 });
  }
  cand.sort((x, y) => y.shape - x.shape || y.gap - x.gap);
  const used = new Set();
  // ⚠ GIÃN CÁC CẶP RA. `used` một mình chỉ chặn đúng hai chỗ đã lấy, nên cặp sau đặt sát ngay
  // sau cặp trước vẫn hợp lệ — và vì bảng ứng viên xếp theo hình an toàn, chúng dồn hết vào
  // cùng một khúc. Đo được: slot 10 ra xe 6,7,8,10,11,12 và slot 24 ra 6,7,8,9, tức nửa hàng
  // xe bị buộc dính nhau (user 2026-08-18: "mấy level xe đang hơi sát nhau quá").
  const SPREAD = Number(process.env.TWIN_SPREAD || 3);
  const blocked = new Set();
  const place = (g, id) => {
    L.chests[g.i].pairId = id; L.chests[g.j].pairId = id;
    used.add(g.i); used.add(g.j);
    for (let k = g.i - SPREAD; k <= g.j + SPREAD; k++) blocked.add(k);
  };
  let made = 0;
  for (const g of cand) {
    if (made >= nPairs) break;
    if (used.has(g.i) || used.has(g.j)) continue;
    if (blocked.has(g.i) || blocked.has(g.j)) continue;
    place(g, made); made++;
  }
  // Nhánh dự phòng: hết chỗ giãn thì cho đặt sát nhau. VẪN chỉ trong danh sách ứng viên đã lọc
  // ở trên, nên khi TWIN_VERTICAL_ONLY bật thì nó cũng chỉ đặt được hình dọc — đặt sát nhau về
  // vị trí trong hàng, chứ không quay lại hình xấu.
  for (const g of cand) {
    if (made >= nPairs) break;
    if (used.has(g.i) || used.has(g.j)) continue;
    place(g, made); made++;
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
  L.chests = absorbTiny(shiftEarly(orderByPeel(L, rung.cap || CAPS[0], rung.merge ?? 0, rung.wave ?? 1), rung.pressure, seed), rung.minCar ?? Number(process.env.MINCAR || 0));

  const cdep = colorDepth(L);
  twinsInCrunch(L, twinCount(n, sp), cdep, seed);
  buriedInCrunch(L, buriedCount(sp.target), seed);
  return L;
}

// ---- điểm: lệch target + phạt vị trí thua ------------------------------------------------
// Level ≥90% thì THUA Ở ĐÂU CŨNG ĐƯỢC (user 2026-08-05): nó gần như không thua, nên mẫu thua
// vừa bé vừa nhiễu, mà phạt vị trí lại kéo bộ chọn đi lệch khỏi target. Chỉ chấm vị trí thua
// ở những level thật sự có người thua.
const score = (dist, win, lossAt, t) => dist + (t >= 90 || win >= 90 ? 0 : positionPenalty(lossAt));

const d = readD();
// Dải level quét. Trước đây khoá cứng 2-46 vì bộ này chỉ dựng chừng đó; từ 2026-08-13 cả bộ
// 165 level dùng chung một đường cong nên phải nới ra:  RANGE="4-165"
const [R0, R1] = (process.env.RANGE || "2-46").split("-").map(Number);
const nums = [];
for (let n = R0; n <= R1; n++) if (d[n] && (!ONLY || ONLY.has(n))) nums.push(n);

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
  // NGƯỠNG NUỐT XE VỤN là một TRỤC CỦA THANG, không phải hậu xử lý. Gộp xe vụn làm level DỄ đi
  // (ít xe đứng chờ hơn), nên nó phải được chọn CÙNG LÚC với cỡ xe / wave / áp lực thì mới vừa
  // bỏ được đuôi xe 1-5 slime vừa giữ winrate. Gộp sau khi đã chốt nấc thì level nào cũng lệch.
  const mins = (process.env.MINCAR_LADDER || "").split(",").filter((s) => s !== "").map(Number);
  const mr = Number(process.env.MAX_RUN || 99);
  for (const cap of CAPS) for (const wave of waves) for (const pressure of press) for (const lay of lays)
    for (const minCar of (mins.length ? mins : [undefined]))
      LADDER.push({ cap, wave, pressure, lay, maxRun: mr, ...(minCar === undefined ? {} : { minCar }) });
}

if (process.argv.includes("--scan1")) {
  const Ls = nums.map((n) => build(d[n], n, EASIEST));
  console.error(`chang 1: ${nums.length} level, moi level 1 phuong an de nhat`);
  const g = gradeBatch(Ls, { n: N_B, tag: "s1" });
  console.log(JSON.stringify(nums.map((n, i) => ({ n, ri: -1, win: g[i].win, b: g[i].b, d: g[i].d, cars: Ls[i].chests.length, rung: EASIEST }))));
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
  // ghi CẢ B và D, không chỉ số đã nắn: chọn theo thang thô (RAWTGT) cần hai con số riêng, và
  // spread B−D là dấu hiệu nấc đó có đáng tin không.
  console.log(JSON.stringify(jobs.map((j, i) => ({ n: j.n, ri: j.ri, win: g[i].win, b: g[i].b, d: g[i].d, cars: j.L.chests.length, rung: LADDER[j.ri] }))));
  process.exit(0);
}

if (process.argv.includes("--pick")) {
  const files = process.argv.slice(process.argv.indexOf("--pick") + 1);
  const rows = files.flatMap((f) => JSON.parse(fs.readFileSync(f, "utf8")));
  const byLv = {};
  for (const r of rows) (byLv[r.n] = byLv[r.n] || []).push(r);

  const chosen = {};
  for (const n of Object.keys(byLv).map(Number).sort((a, b) => a - b)) {
    const t = spec(n).target;
    // vòng 1: lọc theo winrate. vòng 2: chỉ những ứng viên đã gần target mới đo VỊ TRÍ THUA
    // (guide §2b) — đo lossProfile cho cả thang thì phí, mà lấy thẳng thang thì mất tiêu chí.
    const cands = byLv[n].slice().sort((a, b) => distTo(a, n) - distTo(b, n));
    // Dung sai 12 điểm chứ không 8: sai số của chính thước đã ~8 điểm, nên trong dải đó winrate
    // không phân biệt nổi — để VỊ TRÍ THUA và SỐ XE quyết định thì đúng ý user hơn (độ khó dồn
    // vào khúc giữa, ít xe). Siết về 8 từng loại mất nấc L15 thua@51% để lấy nấc thua@89%.
    let near = cands.filter((r) => distTo(r, n) <= 12);
    if (!near.length) near = cands.filter((r) => distTo(r, n) <= 20);
    const pool = (near.length ? near : cands).slice(0, 14);
    for (const r of pool) r.lossAt = lossProfile(build(d[n], n, r.rung)).lossAt;
    // hoà nhau thì ÍT XE THẮNG (user: "giảm thiểu số xe để chơi đỡ mệt"). 0.25đ/xe: chênh 20 xe
    // ăn đứt chênh 5 điểm winrate — mà 5 điểm thì nằm gọn trong sai số ~8 điểm của thước.
    const key = (r) => score(distTo(r, n), r.win, r.lossAt, t) + r.cars * 0.25;
    chosen[n] = pool.slice().sort((a, b) => key(a) - key(b) || a.ri - b.ri)[0];
  }

  // ---- NUỐT XE VỤN: chọn ngưỡng LỚN NHẤT mà winrate không xê dịch quá dung sai -------------
  // Đuôi hàng toàn xe 1-10 slime là hệ quả của lịch bóc (ngoài dày, trong vụn), không phải ý đồ.
  // Ngưỡng phải ĐO chứ không đoán: gộp xe cùng màu có thể làm xe đứng chờ → kẹt bay.
  const MINCARS = (process.env.MINCARS || "0,10,18,28,40").split(",").map(Number);
  const lvls = Object.keys(chosen).map(Number).sort((a, b) => a - b);
  const jobs = [];
  for (const n of lvls) {
    // nấc đã tự mang ngưỡng (quét chung với winrate) thì GIỮ NGUYÊN, đừng quét đè lên
    const fixed = chosen[n].rung.minCar;
    for (const mc of (fixed == null ? MINCARS : [fixed])) jobs.push({ n, mc, L: build(d[n], n, { ...chosen[n].rung, minCar: mc }) });
  }
  console.error(`nuot xe vun: ${lvls.length} level x ${MINCARS.length} nguong = ${jobs.length} phep do`);
  const gm = gradeBatch(jobs.map((j) => j.L), { n: N_B, tag: "mincar" });
  const byMc = {};
  jobs.forEach((j, i) => { (byMc[j.n] = byMc[j.n] || []).push({ mc: j.mc, win: gm[i].win, b: gm[i].b, d: gm[i].d, L: j.L }); });

  console.log("Dung lai L2-46 theo level-design-guide + winratedesign1.csv\n");
  console.log('lv  | tgt | win  |  B  |  D  | thua@ | ap | lop2 | xe | nho | doi | up | ghi chu');
  const out = {};
  for (const n of lvls) {
    const t = spec(n).target, base = chosen[n];
    const tol = Math.max(12, distTo(base, n));
    const okMc = byMc[n].filter((v) => distTo(v, n) <= tol);
    // Dự phòng phải là "nấc GẦN target nhất trong những cái đã đo", KHÔNG phải "cái có mc===0".
    // Khi nấc thắng đã tự mang `minCar` thì byMc[n] chỉ có ĐÚNG một phần tử với mc đó; lọc
    // mc===0 ra mảng rỗng → `.slice(-1)[0]` là undefined → TypeError, và cả lượt pick chết
    // giữa chừng nên KHÔNG GHI GÌ. Lần 2026-08-07 nó bỏ dở 32 level normal mà chỉ báo lỗi ở
    // cuối log; `check-seats.mjs` mới là thứ phát hiện ra (L72 lệch ghế).
    const pickMc = okMc.length
      ? okMc[okMc.length - 1]
      : byMc[n].slice().sort((a, b) => distTo(a, n) - distTo(b, n))[0];
    const L = pickMc.L;
    const lossAt = lossProfile(L).lossAt;
    const lay = L.layer2 ? L.layer2.filter((v) => v >= 0).length : 0;
    const tw = new Set(L.chests.filter((c) => c.pairId != null).map((c) => c.pairId)).size;
    const bu = L.chests.filter((c) => c.buried).length;
    const tiny = L.chests.filter((c) => c.count < 10).length;
    const note = [];
    if (distTo(pickMc, n) > 10) note.push('winrate lech');
    if (RAWTGT[n] != null && Math.abs(pickMc.b - pickMc.d) > 25) note.push('B/D cai nhau');
    if (lossAt != null && (lossAt < 25 || lossAt > 75)) note.push('thua o met cuoi');
    console.log(
      `L${String(n).padEnd(3)}| ${String(RAWTGT[n] ?? t).padStart(3)}${RAWTGT[n] != null ? '~' : '%'} | ${String(pickMc.win).padStart(3)}% |` +
      ` ${String(pickMc.b ?? '-').padStart(3)} | ${String(pickMc.d ?? '-').padStart(3)} |  ${String(lossAt ?? '-').padStart(3)}% |` +
      ` ${String(base.rung.pressure)}  | ${String(lay).padStart(4)} | ${String(L.chests.length).padStart(2)} |` +
      ` ${String(tiny).padStart(3)} | ${String(tw).padStart(3)} | ${String(bu).padStart(2)} | ${note.join(', ')}`
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
