// Gắn HỘP SOCOLA vào 3 level trong dải L501-504 (user 2026-08-14: "3 level từ 501-504, thêm
// obtacle socola, loại 1 màu và cầu vồng nhé. winrate tùy bạn chọn").
//
//   node scripts/_add-choco.mjs            # xem trước + đo B có/không hộp
//   WRITE=1 node scripts/_add-choco.mjs    # ghi designed.json
//
// Chọn ba bàn để lộ đủ HAI luật ruy băng và CẢ HAI cỡ hộp:
//   L501  5×5  CẦU VỒNG   — màu nào cũng trừ số, nên nó là bàn giới thiệu cơ chế
//   L502  5×5  MỘT MÀU    — 12 màu, chọn một màu KHÔNG phải nền để luật thật sự bắt phải tìm
//   L503  3×3  MỘT MÀU    — cỡ nhỏ, cho thấy hộp không phải lúc nào cũng to
//
// ⚠ ĐO ĐƯỢC RỒI MỚI GẮN. Trước hôm nay mô hình B không biết `boxes` là gì: nó coi ô dưới hộp
// là slime thường, tức đo một bàn KHÁC với bàn người chơi gặp. simcore.mjs vừa được dạy hộp
// (chặn ngắm + đếm số + vỡ hộp), kiểm bằng một hộp số 900 không thể mở → B tụt 100 → 0.
//
// Đặt ở ô TRỐNG-SLIME gần TÂM bàn nhất: hộp phải nằm trên chủ thể mới đọc ra là "che mất một
// mảng tranh"; nằm ở góc nền thì chỉ như một miếng dán.
import fs from "node:fs";
import { readD, writeD, isC } from "./genlib.mjs";
import { measure2 } from "./simcore2.mjs";

const RAINBOW = -1;
// ribbon: id màu, hoặc RAINBOW. count theo đúng khoảng khuyến nghị n²/4..n²/3.
const PLAN = [
  { n: 501, size: 5, ribbon: RAINBOW, count: 8 },
  { n: 502, size: 5, ribbon: 9, count: 7 },   // xám nhạt — 25 ô ngoài hộp, gấp 3.6 lần số cần
  { n: 503, size: 3, ribbon: 2, count: 3 },   // vàng — 58 ô ngoài hộp
];

const d = readD();
const NF = Number(process.env.N_FINAL || 200);

/** Mọi chỗ đặt được hộp n×n (toàn slime, không đá/ô trống), xếp GẦN TÂM trước. */
function spots(L, n) {
  const out = [];
  for (let r = 0; r <= L.rows - n; r++) for (let c = 0; c <= L.cols - n; c++) {
    let ok = true;
    for (let i = r; i < r + n && ok; i++) for (let j = c; j < c + n; j++) if (!isC(L.board[i * L.cols + j])) { ok = false; break; }
    if (!ok) continue;
    const dr = r + n / 2 - L.rows / 2, dc = c + n / 2 - L.cols / 2;
    out.push({ at: r * L.cols + c, r, c, d: dr * dr + dc * dc });
  }
  return out.sort((a, b) => a.d - b.d);
}

console.log("lv   | hop      | ruy bang        | so | B khong hop | B co hop | mau ngoai hop");
const applied = [];
for (const p of PLAN) {
  const L = d[p.n];
  if (!L?.board) { console.log(`L${p.n}: khong co board`); continue; }
  const sp = spots(L, p.size);
  if (!sp.length) { console.log(`L${p.n}: khong co cho dat hop ${p.size}x${p.size}`); continue; }
  const at = sp[0].at;
  const box = { at, n: p.size, count: p.count, ribbon: p.ribbon };
  const inBox = new Set();
  for (let i = sp[0].r; i < sp[0].r + p.size; i++) for (let j = sp[0].c; j < sp[0].c + p.size; j++) inBox.add(i * L.cols + j);
  let outside = 0;
  L.board.forEach((v, i) => { if (isC(v) && !inBox.has(i) && (p.ribbon === RAINBOW || v === p.ribbon)) outside++; });

  const before = measure2(JSON.parse(JSON.stringify({ ...L, boxes: undefined })), NF);
  const after = measure2(JSON.parse(JSON.stringify({ ...L, boxes: [box] })), NF);
  const rib = p.ribbon === RAINBOW ? "CAU VONG" : `mot mau id${p.ribbon}`;
  console.log(`L${String(p.n).padEnd(4)}| ${p.size}x${p.size} r${sp[0].r}c${sp[0].c}`.padEnd(24)
    + `| ${rib.padEnd(15)} | ${String(p.count).padStart(2)} | ${String(before).padStart(11)} | ${String(after).padStart(8)} | ${outside}`);
  applied.push({ n: p.n, box, outside });
}

if (process.env.WRITE !== "1") { console.log("\nxem truoc — dat WRITE=1 de ghi"); process.exit(0); }
for (const a of applied) d[a.n].boxes = [a.box];
writeD(d);
console.log(`\nda gan hop vao ${applied.length} level va ghi designed.json`);
console.log("kiem: node scripts/check-choco.mjs && node scripts/check-seats.mjs");
