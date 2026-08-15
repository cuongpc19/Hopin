// Chuyển một dải level sang bàn 25×25 mà GIỮ NGUYÊN BỨC ẢNH (user 2026-08-14: "convert level
// 470-500, dùng ảnh cũ, convert sang kích thước 25x25").
//
//   MAP=scripts/_l470map.json node scripts/_to25.mjs           # xem trước
//   MAP=scripts/_l470map.json WRITE=1 node scripts/_to25.mjs   # ghi
//
// Không dựng lại ảnh từ PNG mà LẤY BẢN 25 CÓ SẴN trong kho pool — mỗi chủ thể đã được dựng ở
// nhiều cỡ, cùng một quy trình build-one nên cùng bảng màu, cùng luật viền. Chủ thể nào chưa có
// bản 25 thì dựng bổ sung trước bằng emoji-pool.mjs SIZES=25 (MARGIN=2 nếu trượt rule viền —
// bàn nhỏ thì chủ thể chiếm tỉ lệ lớn hơn nên dễ chạm viền hơn).
//
// ⚠ ĐỔI BOARD LÀ HÀNG XE CŨ VÔ HIỆU. Bất biến ghế=ô tính theo số ô từng màu, mà bàn 25×25 có
// ~500 ô so với ~1000 ô của bàn 35×35 — không dựng lại hàng xe thì check-seats đỏ ngay.
// layer2/hidden cũng bỏ: chúng là chỉ số ô của board cũ. _tuneAll sinh lại trước khi đo.
import fs from "node:fs";
import { readD, writeD, isC } from "./genlib.mjs";

const D = "public/art/level art/emoji";
// SIZE=25|31|35 — cỡ bàn đích. Mặc định 25 vì đó là lần chạy đầu; user 2026-08-14 xem xong bảo
// "mấy level 25x25 này xấu quá, có level 31x31 k" nên dải L470-500 chuyển tiếp sang 31.
const SIZE = Number(process.env.SIZE || 25);
const map = JSON.parse(fs.readFileSync(process.env.MAP || "scripts/_l470map.json", "utf8"));
const d = readD();

const at25 = {}; // chủ thể → board ở cỡ SIZE
for (const f of fs.readdirSync(D)) {
  if (!f.startsWith("pool") || !f.endsWith(".json") || f.includes("-pick")) continue;
  for (const v of Object.values(JSON.parse(fs.readFileSync(`${D}/${f}`, "utf8"))))
    if (v.size === SIZE && !at25[v.name]) at25[v.name] = v.level;
}

const rows = [], skip = [];
for (const [lv, name] of Object.entries(map)) {
  const L = d[lv], src = at25[name];
  if (!src) { skip.push(`L${lv}:${name} (chua co ban ${SIZE})`); continue; }
  if (L.boxes?.length) { skip.push(`L${lv}: co hop socola — doi co ban se lam hop lech, bo qua`); continue; }
  const cells = (b) => b.filter(isC).length;
  rows.push({ lv: Number(lv), name, from: `${L.cols}x${L.rows}`, oldCells: cells(L.board), newCells: cells(src.board),
    oldCols: new Set(L.board.filter(isC)).size, newCols: new Set(src.board.filter(isC)).size, src });
}
rows.sort((a, b) => a.lv - b.lv);

console.log("lv   | anh              | tu      | o slime      | so mau");
for (const r of rows)
  console.log(`L${r.lv} | ${r.name.padEnd(17)}| ${r.from.padEnd(8)}| ${String(r.oldCells).padStart(4)} -> ${String(r.newCells).padStart(4)} | ${r.oldCols} -> ${r.newCols}`);
console.log(`\n${rows.length} ban chuyen duoc${skip.length ? `, ${skip.length} bo qua:\n  ` + skip.join("\n  ") : ""}`);
const avg = (f) => (rows.reduce((s, r) => s + f(r), 0) / rows.length).toFixed(0);
console.log(`trung binh: o slime ${avg((r) => r.oldCells)} -> ${avg((r) => r.newCells)} | mau ${avg((r) => r.oldCols)} -> ${avg((r) => r.newCols)}`);

if (process.env.WRITE !== "1") { console.log("\nxem truoc — dat WRITE=1 de ghi"); process.exit(0); }
for (const r of rows) {
  const L = d[r.lv];
  L.cols = r.src.cols; L.rows = r.src.rows; L.board = [...r.src.board];
  delete L.layer2; delete L.hidden;   // chỉ số ô của board cũ, _tuneAll sinh lại
  L.chests = [...r.src.chests];       // tạm cho check-seats khỏi đỏ; _tuneAll dựng lại ngay sau
}
writeD(d);
console.log(`\nda chuyen ${rows.length} ban sang 25x25 va ghi designed.json`);
console.log("BUOC BAT BUOC TIEP: dung lai hang xe, neu khong ghe != o");
