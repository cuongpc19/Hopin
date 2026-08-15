// TRÁO CHỖ hai bộ level (user 2026-08-14: "lấy 10 level này đổi chỗ cho 10 level bất kỳ, level
// từ 30-60, k bao gồm các level chia hết cho 5. Đổi chỗ cho nhau, k cần để ý winrate").
//
//   node scripts/_swap-pretty.mjs            # xem trước
//   WRITE=1 node scripts/_swap-pretty.mjs    # ghi
//
// TRÁO NGUYÊN OBJECT chứ không chỉ board. Nhờ vậy hàng xe đi theo bàn của nó, nên bất biến
// ghế=ô TỰ ĐỘNG còn đúng ở cả hai phía — khác hẳn lúc chỉ đổi board (như _to25), khi đó hàng xe
// cũ thuộc về bàn cũ và bắt buộc phải dựng lại.
//
// ⚠ ĐỘ KHÓ KHÔNG ĐI THEO. `levelDifficulty(n)` tính từ SỐ level chứ không từ nội dung, và dải
// tune cũng vậy. Nên một bàn ÷5 (đang nhắm B 26-43) chuyển sang ô L37 sẽ thành bàn khó nằm giữa
// khúc đầu game mà KHÔNG có nhãn HARD; ngược lại bàn dễ chuyển vào ô ÷5 sẽ đeo nhãn HARD mà
// chơi rất dễ. User đã chốt "k cần để ý winrate", nhưng đây là hệ quả cần biết trước.
import { readD, writeD, isC, mkRng } from "./genlib.mjs";

const SRC = (process.env.SRC || "553,340,197,267,281,575,578,561,271,285").split(",").map(Number);
const [R0, R1] = (process.env.RANGE || "30-60").split("-").map(Number);
const d = readD();

// Ô đích: level THƯỜNG (không ÷5) trong dải, và không trùng chính bộ nguồn.
const pool = Object.keys(d).map(Number)
  .filter((n) => n >= R0 && n <= R1 && n % 5 !== 0 && d[n]?.board && !SRC.includes(n))
  .sort((a, b) => a - b);
if (pool.length < SRC.length) { console.error(`chi co ${pool.length} o dich, can ${SRC.length}`); process.exit(1); }

const rng = mkRng(Number(process.env.SEED || 20260814));
const idx = pool.map((_, i) => i);
for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
const dst = idx.slice(0, SRC.length).map((i) => pool[i]).sort((a, b) => a - b);

const cells = (L) => L.board.filter(isC).length;
const cols = (L) => new Set(L.board.filter(isC)).size;
console.log("tranh dep            ->  o dich       | ban chuyen di                | ban chuyen ve");
const pairs = [];
for (let k = 0; k < SRC.length; k++) {
  const a = SRC[k], b = dst[k];
  const A = d[a], B = d[b];
  pairs.push({ a, b });
  const f = (L) => `${L.cols}x${L.rows} ${String(cells(L)).padStart(4)}o ${String(cols(L)).padStart(2)}mau ${String(L.chests.length).padStart(3)}xe`;
  console.log(`L${String(a).padEnd(4)}${a % 5 === 0 ? "(÷5)" : "    "} ->  L${String(b).padEnd(4)}      | ${f(A)} | ${f(B)}`);
}
const fives = SRC.filter((n) => n % 5 === 0);
if (fives.length) console.log(`\n⚠ ${fives.length} bàn nguồn là ÷5 (${fives.join(",")}): chúng đang nhắm B 26-43.`
  + ` Sang ô thường ở L30-60 sẽ là bàn KHÓ mà không có nhãn HARD, và bàn đi ngược lại sẽ đeo nhãn HARD mà dễ.`);

if (process.env.WRITE !== "1") { console.log("\nxem truoc — dat WRITE=1 de ghi"); process.exit(0); }
for (const { a, b } of pairs) { const t = d[a]; d[a] = d[b]; d[b] = t; }
writeD(d);
console.log(`\nda trao ${pairs.length} cap va ghi designed.json`);
