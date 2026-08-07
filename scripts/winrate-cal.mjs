// winrate-cal — THƯỚC WINRATE ĐÃ HIỆU CHUẨN THEO VÁN THẬT.
//
// Vì sao có file này: cả 5 mô hình (A..E) đều đo MỘT CON BOT chơi, không phải người thật,
// nên chúng lệch có hệ thống. Chấm trên 67 ván thật ở 21 level, không mô hình đơn lẻ nào
// thắng nổi việc "đoán bừa một hằng số" (LL -46.4):
//     E -48.6 · D -54.3 · A -57.0 · B -74.2 · C -84.9
// Nhưng B và D lệch NGƯỢC CHIỀU nhau ở vùng khó — B quá bi quan (chấm L22/L24 = 1% trong
// khi user thắng 2/4 và 1/7), D quá lạc quan (chấm L24/L30 = 80/83%). Trung bình cộng rồi
// nắn bằng một đường logistic khớp trên ván thật thì đạt LL -39.4 (kiểm tra chéo
// leave-one-out, nên không tự lừa) — tốt hơn cả E thô, mà chạy 4 phút thay vì 3 tiếng.
//
// Đường hiệu chuẩn: logit(p_that) = A_CAL + B_CAL * logit((B+D)/2).
// B_CAL ≈ 1 nên thực chất nó chỉ là "bot lạc quan hơn người khoảng 0.66 logit" — trừ đi.
//
// ⚠ HỆ SỐ NÀY PHẢI KHỚP LẠI KHI CÓ THÊM VÁN THẬT. Chạy `node scripts/winrate-cal.mjs --fit`
// sau mỗi đợt playtest; nó đọc playlog.jsonl và in ra hệ số mới để dán vào đây.
//
//   node scripts/winrate-cal.mjs 33-46      → bảng winrate đã hiệu chuẩn
//   node scripts/winrate-cal.mjs --fit      → khớp lại hệ số từ playlog.jsonl
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { readD, levelFingerprint } from "./genlib.mjs";
import { measure2 } from "./simcore2.mjs";
import { A_CAL, B_CAL, logit as lg, sigmoid as sig, cal } from "./calib.mjs";

// Hệ số + hàm nắn sống ở scripts/calib.mjs — MỘT bản duy nhất, để tuner (gen2-46.mjs) và
// file này không trôi khỏi nhau.
const N = Number(process.env.N || 200);

// ---- ván thật từ playlog.jsonl: {lvl: [thắng, tổng]} ------------------------------------
// LỌC THEO VÂN TAY: từ 2026-08-07 mỗi dòng `result` mang `sig` = vân tay nội dung level lúc
// chơi. Ván có sig KHÁC bản đang nằm trong designed.json bị loại — trước đây chúng vẫn được
// đếm, nên `--fit` ghép ván trên board cũ với board mới (L15 đổi nội dung 5 lần trong một
// ngày). Ván CŨ không có sig cũng bị loại khi `sigOf` được truyền vào: không biết nó thuộc
// bản nào thì thà bỏ còn hơn nắn hệ số bằng dữ liệu lạc bản.
// STALE=1 để đếm tất, dùng khi chỉ muốn xem thống kê thô chứ không hiệu chuẩn.
function realGames(sigOf = null) {
  const out = {};
  const keepStale = process.env.STALE === "1" || !sigOf;
  let txt;
  try { txt = fs.readFileSync("playlog.jsonl", "utf8"); } catch { return out; }
  let dropped = 0, noSig = 0;
  for (const line of txt.trim().split(/\r?\n/)) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r == null || r.lvl == null || !r.result) continue;
    if (r.result !== "win" && r.result !== "lose") continue;   // bỏ ván về Home giữa chừng
    if (!keepStale) {
      const want = sigOf(r.lvl);
      if (r.sig == null) { noSig++; continue; }
      if (want != null && r.sig !== want) { dropped++; continue; }
    }
    out[r.lvl] = out[r.lvl] || [0, 0];
    out[r.lvl][1]++;
    if (r.result === "win") out[r.lvl][0]++;
  }
  if (!keepStale && (dropped || noSig))
    console.error(`(bo ${noSig} van khong co van tay + ${dropped} van tren ban cu)`);
  return out;
}

// ---- mô hình D: gọi build-levels.mjs --mech-json -----------------------------------------
function modelD(nums) {
  const env = { ...process.env, LEVELS: nums.join(","), SKILL: process.env.SKILL || "0.75", TRIALS: process.env.TRIALS || "60" };
  const txt = execFileSync(process.execPath, ["scripts/build-levels.mjs", "--mech-json"], { env, encoding: "utf8", maxBuffer: 1e9 });
  const m = txt.match(/MECH_JSON (\{.*\})/);
  if (!m) throw new Error("khong doc duoc MECH_JSON");
  const j = JSON.parse(m[1]);
  const out = {};
  for (const k of nums) if (j[k] && j[k].win != null) out[k] = j[k].win;
  return out;
}

// ---- --fit: khớp lại A_CAL/B_CAL từ ván thật ---------------------------------------------
if (process.argv.includes("--fit")) {
  const d = readD();
  const R = realGames((n) => (d[n] ? levelFingerprint(d[n]) : null));
  const ks = Object.keys(R).map(Number).filter((k) => d[k] && R[k][1] > 0).sort((a, b) => a - b);
  if (ks.length < 5) { console.log("Chua du van that de khop (can >=5 level)."); process.exit(0); }
  console.log(`Khop tren ${ks.reduce((a, k) => a + R[k][1], 0)} van / ${ks.length} level: L${ks.join(", L")}`);
  const B = {}; for (const k of ks) B[k] = measure2(d[k], N);
  const D = modelD(ks);
  let a = 0, b = 1;
  for (let it = 0; it < 200000; it++) {
    let ga = 0, gb = 0;
    for (const k of ks) {
      if (D[k] == null) continue;
      const [w, n] = R[k], x = lg((B[k] + D[k]) / 2), p = sig(a + b * x);
      ga += w - n * p; gb += (w - n * p) * x;
    }
    a += 0.005 * ga / ks.length; b += 0.005 * gb / ks.length;
  }
  console.log(`\nHe so moi — dan vao dau file:\n  const A_CAL = ${a.toFixed(4)};\n  const B_CAL = ${b.toFixed(4)};`);
  process.exit(0);
}

// ---- chấm một dải level -------------------------------------------------------------------
const spec = process.argv[2] || "33-46";
const nums = spec.includes("-")
  ? (() => { const [x, y] = spec.split("-").map(Number); const r = []; for (let i = x; i <= y; i++) r.push(i); return r; })()
  : spec.split(",").map(Number);

const d = readD();
const live = nums.filter((n) => d[n]);
const B = {}; for (const n of live) B[n] = measure2(d[n], N);
const D = modelD(live);
const R = realGames((n) => (d[n] ? levelFingerprint(d[n]) : null));   // chỉ ván ĐÚNG bản
const RAll = realGames();                                            // mọi ván, kể cả bản cũ

console.log(`Winrate da hieu chuan (B N=${N} + D, nan theo ${A_CAL.toFixed(3)}/${B_CAL.toFixed(3)})\n`);
// Cột "dung ban" chỉ đếm ván có vân tay khớp bản đang nằm trong designed.json — đây là cột
// duy nhất được phép so với winrate. Cột "moi ban" gộp cả ván trên board cũ, để tham khảo.
console.log('lv  |  B  |  D  | tho | HIEU CHUAN | van dung ban | moi ban (ke ca ban cu)');
const pct = (r) => (r ? Math.round(100 * r[0] / r[1]) + "% (" + r[0] + "/" + r[1] + ")" : "-");
for (const n of live) {
  const raw = (B[n] + (D[n] ?? B[n])) / 2;
  console.log(
    `L${String(n).padEnd(3)}| ${String(B[n]).padStart(3)} | ${String(D[n] ?? "-").padStart(3)} | ${String(Math.round(raw)).padStart(3)} |` +
    `    ${String(cal(raw)).padStart(3)}%    | ${pct(R[n]).padStart(12)} | ${pct(RAll[n])}`
  );
}
