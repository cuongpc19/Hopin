// PHƯƠNG ÁN C — bộ 33 level mở đầu hoàn toàn mới (user 2026-08-18: "build thử 1 bản, với 33
// level hoàn toàn mới từ level 2-34... tìm 33 level đẹp nhất kích thước 25x25 và 31x31 từ
// level 50-500... winrate theo target winrate bản cũ").
//
//   node scripts/_buildC.mjs              # xem trước
//   WRITE=1 node scripts/_buildC.mjs      # chép sang dải 9101-9133
//
// ⚠ KHÔNG ĐỔI CHỖ GÌ TRONG GAME CHÍNH (user: "chưa cần đổi chỗ gì vội"). Bộ C nằm ở dải riêng
// 9101-9133, ô 9100+k ứng với SLOT k+1 của game thật. Bàn gốc ở L50-500 giữ nguyên tại chỗ —
// đây là bản CHÉP, nên hai nơi cùng tồn tại cho tới khi user quyết tráo.
//
// Chọn bàn: lọc bằng điểm đẹp của _pretty.mjs rồi CHỐT BẰNG MẮT qua _sheetC.mjs. Điểm đẹp một
// mình không dùng được — nó chấm cao bức tường gạch L283, đĩa mềm L279, quả trứng be L263.
//
// Target winrate lấy từ Manythings/level-config.csv, cột `target`, theo SỐ SLOT chứ không theo
// số bàn gốc.
import fs from "node:fs";
import { readD, writeD } from "./genlib.mjs";

const BASE = Number(process.env.BASE || 9100);
// 33 bàn đã chốt bằng mắt, xếp theo ĐIỂM ĐẸP TĂNG DẦN bên dưới.
//
// Bốn bàn user tự chọn (2026-08-18: "tôi thấy như 503, 575, 60, 502 khá là đẹp") thay cho bốn
// bàn yếu nhất của lượt lọc đầu — L261 (quyển sách đỏ, gần như một hình chữ nhật trơn), L208
// (đàn cá mảnh, vụn), L286 và L284 (mặt tiền cửa hàng / bệnh viện, đầy chi tiết li ti).
//
// ⚠ ĐIỂM ĐẸP XẾP BỐN BÀN NÀY THẤP, VÀ ĐIỂM SAI. Công thức cộng 3 điểm mỗi màu, nên bàn 6 màu
// như bông tulip L575 hay mặt mèo L60 bị dìm xuống dưới những bàn 11-12 màu đầy chi tiết vụn.
// Ở cỡ ô nhỏ thì ngược lại: chủ thể TO và ÍT MÀU mới đọc được ngay.
const PICKED = [52,61,62,142,111,492,395,273,109,181,188,171,243,251,223,67,
  176,182,192,81,73,162,79,252,268,282,256,254,168,
  60,575,503,502];
// Hai ô SIÊU KHÓ nhận hai bàn CÓ NHÂN VẬT rõ nhất, chọn bằng mắt chứ không theo điểm — đây là
// hai màn người chơi nhớ nhất trong đoạn mở đầu.
const HERO = [60, 503];

const d = readD();
const csv = fs.readFileSync("Manythings/level-config.csv", "utf8").trim().split(/\r?\n/);
const h = csv[0].split(",");
const iL = h.indexOf("lvl"), iT = h.indexOf("target"), iTier = h.indexOf("tier");
const cfgOf = {};
for (const line of csv.slice(1)) {
  const c = line.split(",");
  cfgOf[+c[iL]] = { target: +c[iT], tier: c[iTier] };
}

// Điểm đẹp — CÙNG công thức với _pretty.mjs, chép lại để file này chạy độc lập.
const isC = (v) => v >= 0 && v < 90;
function beauty(L) {
  const W = L.cols, H = L.rows, b = L.board, seen = new Array(b.length).fill(false);
  let tiny = 0, blobs = 0, cells = 0;
  for (let i = 0; i < b.length; i++) {
    if (!isC(b[i])) continue;
    cells++;
    if (seen[i]) continue;
    const c = b[i], st = [i]; seen[i] = true; let sz = 0;
    while (st.length) {
      const p = st.pop(); sz++; const x = p % W, y = (p / W) | 0;
      for (const [a, e] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (a < 0 || e < 0 || a >= W || e >= H) continue;
        const q = e * W + a;
        if (!seen[q] && b[q] === c) { seen[q] = true; st.push(q); }
      }
    }
    blobs++; if (sz <= 2) tiny++;
  }
  return +(new Set(b.filter(isC)).size * 3 + (blobs ? 1 - tiny / blobs : 0) * 40 + (cells / (W * H)) * 20).toFixed(1);
}

const cand = PICKED.map((n) => ({ n, score: beauty(d[n]), cols: d[n].cols }))
  .sort((a, b) => a.score - b.score);

// Slot 2..34. Hai ô SIÊU KHÓ (15, 30) nhận hai bàn đẹp nhất — chúng là hai màn người chơi nhớ
// nhất trong đoạn mở đầu, theo nết cũ của emoji-assign ("level khó là level đẹp nhất").
const SUPER = [15, 30];
const slots = [];
for (let s = 2; s <= 34; s++) slots.push(s);
const heroes = HERO.map((n) => cand.find((c) => c.n === n));
if (heroes.some((h) => !h)) { console.log("HERO co bàn khong nam trong PICKED"); process.exit(1); }
const rest = cand.filter((c) => !HERO.includes(c.n));
const assign = new Map();
SUPER.forEach((s, i) => assign.set(s, heroes[i]));
let k = 0;
for (const s of slots) { if (assign.has(s)) continue; assign.set(s, rest[k++]); }

console.log("slot | ban goc | co ban | diem | target | tier      | -> o moi");
const rows = [];
for (const s of slots) {
  const c = assign.get(s), t = cfgOf[s];
  const to = BASE + (s - 1);
  rows.push({ s, from: c.n, to, target: t.target, tier: t.tier });
  console.log(`  ${String(s).padStart(2)} | L${String(c.n).padEnd(6)}| ${c.cols}x${c.cols}  | ${String(c.score).padStart(4)} | `
    + `${String(t.target).padStart(6)} | ${t.tier.padEnd(9)} | L${to}`);
}
const dup = rows.filter((r) => d[r.to]);
if (dup.length) { console.log(`\n${dup.length} o dich DA CO SAN — dat BASE khac`); process.exit(1); }
console.log(`\n${rows.length} ban | ${rows.filter((r) => d[r.from].cols === 25).length} ban 25x25, ${rows.filter((r) => d[r.from].cols === 31).length} ban 31x31`);
console.log(`target: thap nhat ${Math.min(...rows.map((r) => r.target))}, cao nhat ${Math.max(...rows.map((r) => r.target))}`);

if (process.env.WRITE !== "1") { console.log("\nxem truoc — dat WRITE=1 de ghi"); process.exit(0); }
for (const r of rows) d[r.to] = JSON.parse(JSON.stringify(d[r.from]));
writeD(d);
fs.writeFileSync("scripts/_setC.json", JSON.stringify(rows, null, 1));
console.log(`\nda chep ${rows.length} ban sang ${BASE + 1}-${BASE + 33}, ban goc GIU NGUYEN`);
console.log(`ban do luu o scripts/_setC.json`);
