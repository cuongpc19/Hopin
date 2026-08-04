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
import { readD } from "./genlib.mjs";
import { measure2 } from "./simcore2.mjs";
import { A_CAL, B_CAL, logit as lg, sigmoid as sig, cal } from "./calib.mjs";

// Hệ số + hàm nắn sống ở scripts/calib.mjs — MỘT bản duy nhất, để tuner (gen2-46.mjs) và
// file này không trôi khỏi nhau.
const N = Number(process.env.N || 200);

// ---- ván thật từ playlog.jsonl: {lvl: [thắng, tổng]} ------------------------------------
function realGames() {
  const out = {};
  let txt;
  try { txt = fs.readFileSync("playlog.jsonl", "utf8"); } catch { return out; }
  for (const line of txt.trim().split(/\r?\n/)) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r == null || r.lvl == null || !r.result) continue;
    if (r.result !== "win" && r.result !== "lose") continue;   // bỏ ván về Home giữa chừng
    out[r.lvl] = out[r.lvl] || [0, 0];
    out[r.lvl][1]++;
    if (r.result === "win") out[r.lvl][0]++;
  }
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
  const R = realGames();
  const d = readD();
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
const R = realGames();

console.log(`Winrate da hieu chuan (B N=${N} + D, nan theo ${A_CAL.toFixed(3)}/${B_CAL.toFixed(3)})\n`);
// ⚠ playlog.jsonl KHONG ghi phien ban level, nen cot "van that" co the la van tren BAN DUNG CU
// neu level do da duoc dung lai sau do. Doi chieu voi git log cua src/levels/designed.json
// truoc khi tin cot nay.
console.log('lv  |  B  |  D  | tho | HIEU CHUAN | van that (co the la ban dung cu!)');
for (const n of live) {
  const raw = (B[n] + (D[n] ?? B[n])) / 2;
  const r = R[n];
  console.log(
    `L${String(n).padEnd(3)}| ${String(B[n]).padStart(3)} | ${String(D[n] ?? "-").padStart(3)} | ${String(Math.round(raw)).padStart(3)} |` +
    `    ${String(cal(raw)).padStart(3)}%    | ${r ? Math.round(100 * r[0] / r[1]) + "% (" + r[0] + "/" + r[1] + ")" : "-"}`
  );
}
