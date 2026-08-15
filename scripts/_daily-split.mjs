// TÁCH các bàn thử thách ra khỏi tiến trình chính (user 2026-08-15: "daily challenge k liên
// quan gì đến level mà user đang chơi... coi như hiện tại các level đó đang trống trong tiến
// trình chính, tôi sẽ bổ sung sau").
//
//   node scripts/_daily-split.mjs            # xem trước
//   WRITE=1 node scripts/_daily-split.mjs    # ghi
//
// Chép 10 bàn sang dải 9001-9010 rồi XOÁ bản gốc. Vì sao 9001 chứ không phải 587: dải ngay sau
// LEVEL_COUNT sẽ bị nuốt ngay lần đầu game chính dài thêm, mà lúc ấy hai bộ chồng số nhau và
// không có gì báo. 9001 thì mãi mãi không đụng.
//
// Ô cũ để TRỐNG chứ không lấp: makeLevel() không thấy số nào trong designed.json thì rơi về bản
// dựng tự động (bàn 25×25 vòng đồng tâm), nên game vẫn chơi được liền mạch — chỉ là 10 chỗ ấy
// tạm thời nhạt. User sẽ bổ sung sau.
import { readD, writeD } from "./genlib.mjs";

const SRC = (process.env.SRC || "511,535,555,508,550,497,435,570,580,567").split(",").map(Number);
const BASE = Number(process.env.BASE || 9001);
const d = readD();

const rows = [];
for (let i = 0; i < SRC.length; i++) {
  const from = SRC[i], to = BASE + i;
  const L = d[from];
  if (!L?.board) { console.log(`L${from}: khong co board, bo qua`); continue; }
  if (d[to]) { console.log(`L${to} DA CO SAN — dung lai, dat BASE khac`); process.exit(1); }
  rows.push({ from, to, cols: L.cols, cells: L.board.filter((v) => v >= 0 && v < 90).length, cars: L.chests.length });
}

console.log("bac | tu    -> sang  | co ban | o slime | xe");
rows.forEach((r, i) =>
  console.log(` ${String(i).padStart(2)} | L${String(r.from).padEnd(5)}-> L${r.to} | ${r.cols}x${r.cols}  | ${String(r.cells).padStart(4)}    | ${r.cars}`));
console.log(`\n${rows.length} ban. Sau khi tach, ${rows.map((r) => "L" + r.from).join(", ")} se TRONG trong tien trinh chinh`);
console.log("  -> makeLevel() se dung ban TU SINH cho may so do (ban 25x25 vong dong tam)");

if (process.env.WRITE !== "1") { console.log("\nxem truoc — dat WRITE=1 de ghi"); process.exit(0); }
for (const r of rows) { d[r.to] = d[r.from]; delete d[r.from]; }
writeD(d);
console.log(`\nda chep sang ${BASE}-${BASE + rows.length - 1} va xoa ban goc`);
console.log(`CAP NHAT src/game/daily.ts: DAILY_LEVELS = [${rows.map((r) => r.to).join(", ")}]`);
