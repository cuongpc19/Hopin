// LẤP các ô TRỐNG trong tiến trình chính bằng tranh mới (user 2026-08-15: "các level bị lấy đi
// từ daily challenge: lấy ảnh chỗ khác để build lại level").
//
//   node scripts/_fill-empty.mjs                 # xem trước
//   WRITE=1 node scripts/_fill-empty.mjs         # ghi
//
// Env: PICK (file pick, mặc định pool-pick.json) · SLOTS (mặc định = mọi ô trống trong 1..586).
//
// Ô trống sinh ra khi 10 bàn được tách sang dải daily 9001-9010. Không có bàn thiết kế thì
// makeLevel() rơi về bản tự sinh (25×25 vòng đồng tâm) — game vẫn chạy nhưng mười chỗ ấy nhạt
// hẳn so với hàng xóm.
//
// XẾP ĐẸP DẦN THEO SỐ LEVEL: điểm thấp vào ô số nhỏ, điểm cao vào ô số lớn, theo nết cũ của
// emoji-assign.mjs ("level khó là level đẹp nhất"). Mười ô này nằm rải rác nên không cần lo
// hai bàn cùng chủ đề nằm cạnh nhau — chỗ gần nhau nhất cũng cách ba level.
//
// ⚠ CHỈ ĐẶT TRANH, KHÔNG TUNE. Hàng xe đi kèm bản pick là hàng thô của bộ dựng (88 xe cho bàn
// 31×31), chưa qua thang độ khó. Bắt buộc chạy _tuneAll --scan rồi --write cho đúng mười số này
// ngay sau đó, nếu không chúng vào game với độ khó ngẫu nhiên.
import fs from "node:fs";
import { readD, writeD } from "./genlib.mjs";

const D = "public/art/level art/emoji";
const PICK = process.env.PICK || "pool-pick.json";
const pool = JSON.parse(fs.readFileSync(`${D}/${PICK}`, "utf8"));
const d = readD();

const slots = process.env.SLOTS
  ? process.env.SLOTS.split(",").map(Number).filter(Boolean)
  : Array.from({ length: 586 }, (_, i) => i + 1).filter((n) => !d[n]);

const picks = Object.entries(pool)
  .map(([key, rec]) => ({ key, rec }))
  .sort((a, b) => a.rec.score - b.rec.score);

if (picks.length < slots.length) {
  console.log(`chi co ${picks.length} tranh cho ${slots.length} o trong — dung lai`);
  process.exit(1);
}

console.log(`${slots.length} o trong: ${slots.join(", ")}`);
console.log(`${picks.length} tranh trong ${PICK}\n`);
console.log("lv   | chu the                  | chu de     | co ban | mau | diem | xe tho");
const rows = [];
for (let i = 0; i < slots.length; i++) {
  const { key, rec } = picks[i];
  const L = rec.level;
  rows.push({ lv: slots[i], key, rec });
  console.log(`L${String(slots[i]).padEnd(4)}| ${rec.name.padEnd(25)}| ${String(rec.theme).padEnd(11)}| `
    + `${L.cols}x${L.rows}  | ${String(rec.colours).padStart(3)} | ${rec.score.toFixed(0).padStart(4)} | ${L.chests.length}`);
}

if (process.env.WRITE !== "1") { console.log("\nxem truoc — dat WRITE=1 de ghi"); process.exit(0); }
for (const r of rows) d[r.lv] = r.rec.level;
writeD(d);
fs.writeFileSync(`${D}/fill-empty.json`,
  JSON.stringify(rows.map((r) => ({ lv: r.lv, name: r.rec.name, theme: r.rec.theme, size: r.rec.level.cols, score: r.rec.score })), null, 1));
console.log(`\nda ghi ${rows.length} ban vao designed.json`);
console.log(`MOC TIEP (BAT BUOC): ONLY=${rows.map((r) => r.lv).join(",")} N_B=200 node scripts/scan-shards.mjs`);
