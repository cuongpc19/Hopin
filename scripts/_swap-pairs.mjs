// TRÁO CHỖ từng CẶP level do user chỉ định (2026-08-15: "đổi level 36 thành level 109 nhé",
// "đổi level 101 với 44 nữa nhé").
//
//   node scripts/_swap-pairs.mjs                          # xem trước, dùng cặp mặc định
//   PAIRS=36:109,44:101 WRITE=1 node scripts/_swap-pairs.mjs
//
// TRÁO NGUYÊN OBJECT chứ không chỉ board — hàng xe đi theo bàn của nó nên bất biến ghế=ô tự
// động còn đúng ở cả hai phía. Chỉ đổi board (kiểu _to25) thì hàng xe cũ thuộc về bàn cũ và
// bắt buộc phải dựng lại toàn bộ.
//
// ⚠ ĐỘ KHÓ KHÔNG ĐI THEO BÀN. `levelDifficulty(n)` và dải tune đều tính từ SỐ level, không từ
// nội dung. Nên tráo hai ô CÙNG DẢI thì không phải tune lại; tráo qua ô khác dải (÷5 ↔ thường,
// hay dính dải socola/đá) thì bàn vừa chuyển tới đang nằm sai dải và PHẢI đo lại. Script tự
// kiểm và cảnh báo bên dưới thay vì để người chạy tự nhớ.
import { readD, writeD } from "./genlib.mjs";
import { cfg } from "./_tuneAll.mjs";

const PAIRS = (process.env.PAIRS || "36:109,44:101").split(",").filter(Boolean)
  .map((s) => s.split(":").map(Number));
const d = readD();

const stat = (n) => {
  const L = d[n];
  if (!L?.board) return null;
  const live = L.board.filter((v) => v >= 0 && v < 90);
  return {
    size: `${L.cols}x${L.rows}`, cells: live.length, cols: new Set(live).size,
    cars: L.chests.length, rocks: L.board.filter((v) => v >= 90).length,
    boxes: L.boxes?.length || 0,
  };
};

let bad = 0;
console.log("cap        | ban                                        | dai tune");
for (const [a, b] of PAIRS) {
  const sa = stat(a), sb = stat(b);
  if (!sa || !sb) { console.log(`L${a}<->L${b}: mot trong hai o TRONG — bo qua`); bad++; continue; }
  const ca = cfg(a), cb = cfg(b);
  const same = ca.lo === cb.lo && ca.hi === cb.hi;
  if (!same) bad++;
  console.log(`L${String(a).padEnd(4)}->L${String(b).padEnd(4)}| ${sa.size} ${String(sa.cells).padStart(3)}o ${String(sa.cols).padStart(2)}mau ${String(sa.cars).padStart(2)}xe`
    + `  <->  ${sb.size} ${String(sb.cells).padStart(3)}o ${String(sb.cols).padStart(2)}mau ${String(sb.cars).padStart(2)}xe`
    + ` | ${ca.lo}-${ca.hi} vs ${cb.lo}-${cb.hi} ${same ? "khop" : "*** LECH — PHAI DO LAI CA HAI ***"}`);
}

if (bad) console.log(`\n${bad} cap can chu y (xem dong ***)`);
if (process.env.WRITE !== "1") { console.log("\nxem truoc — dat WRITE=1 de ghi"); process.exit(0); }
for (const [a, b] of PAIRS) {
  if (!d[a]?.board || !d[b]?.board) continue;
  const t = d[a]; d[a] = d[b]; d[b] = t;
}
writeD(d);
console.log(`\nda trao ${PAIRS.length} cap — chay check-seats.mjs de xac nhan`);
