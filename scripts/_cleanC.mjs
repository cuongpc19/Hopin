// GỠ ĐÁ VÀ SOCOLA khỏi bộ C, chỉ giữ lại TRANH (user 2026-08-18: "các level có socola và đá,
// thì giữ hình thôi, k cần socola và đá").
//
//   node scripts/_cleanC.mjs            # xem trước
//   WRITE=1 node scripts/_cleanC.mjs    # ghi
//
// SOCOLA dễ: `boxes` là một trường riêng, xoá đi là xong — ô slime dưới hộp vẫn nguyên vẹn.
//
// ⚠ ĐÁ THÌ KHÔNG. Mã 90 GHI ĐÈ lên ô màu, màu gốc mất hẳn, nên xoá đá chỉ để lại lỗ thủng giữa
// bức tranh. Phải LẤY LẠI BÀN TỪ LỊCH SỬ GIT ở commit trước lúc rải đá. Đã dò sẵn:
//   L73 → 07c9120   ·   L60 → f3e079e   ·   L251 → 1bf7c1c
// Lấp bằng màu hàng xóm cũng được nhưng sẽ vá víu; bản git là bức tranh thật.
import fs from "node:fs";
import { execSync } from "node:child_process";
import { readD, writeD } from "./genlib.mjs";

const PRE_ROCK = { 73: "07c9120", 60: "f3e079e", 251: "1bf7c1c" };
const d = readD();
const setC = JSON.parse(fs.readFileSync("scripts/_setC.json", "utf8"));
const cache = {};
const boardAt = (commit, lv) => {
  if (!cache[commit]) cache[commit] = JSON.parse(execSync(`git show ${commit}:src/levels/designed.json`, { maxBuffer: 1 << 30 }).toString());
  return cache[commit][lv];
};

const rows = [];
for (const r of setC) {
  const L = d[r.to];
  const rocks = L.board.filter((v) => v >= 90).length;
  const boxes = L.boxes?.length || 0;
  if (!rocks && !boxes) continue;
  const note = [];
  if (boxes) note.push(`bỏ ${boxes} hộp socola`);
  if (rocks) {
    const src = PRE_ROCK[r.from];
    if (!src) { note.push(`CÒN ${rocks} ô đá — chưa biết lấy bản nào`); }
    else {
      const old = boardAt(src, r.from);
      if (!old?.board || old.board.length !== L.board.length) note.push(`bản ${src} không khớp cỡ — BỎ QUA`);
      else note.push(`lấy lại ${rocks} ô từ ${src}`);
    }
  }
  rows.push({ ...r, rocks, boxes, note: note.join(", ") });
}
console.log("slot | ban goc | o moi  | xu ly");
for (const r of rows) console.log(`  ${String(r.s).padStart(2)} | L${String(r.from).padEnd(6)}| L${r.to} | ${r.note}`);
console.log(`\n${rows.length} ban can xu ly`);

if (process.env.WRITE !== "1") { console.log("\nxem truoc — dat WRITE=1 de ghi"); process.exit(0); }
for (const r of rows) {
  const L = d[r.to];
  if (r.boxes) delete L.boxes;
  if (r.rocks && PRE_ROCK[r.from]) {
    const old = boardAt(PRE_ROCK[r.from], r.from);
    if (old?.board && old.board.length === L.board.length) {
      let n = 0;
      for (let i = 0; i < L.board.length; i++) if (L.board[i] >= 90) { L.board[i] = old.board[i]; n++; }
      console.log(`L${r.to}: lay lai ${n} o tu ban cu`);
    }
  }
}
writeD(d);
console.log("\nda ghi. Hang xe se duoc dung lai o luot tune, nen bat bien ghe=o chua dung luc nay.");
